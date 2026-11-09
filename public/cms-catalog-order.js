"use strict";

// Standalone CMS catalog-order controls: position 1 is the first card from the left.
// Cards in the storefront use the same order on the home and catalog pages.
function v6CmsPianoBrandSlug(value) {
  const source = String(value || "").trim();
  if (/^steinway/i.test(source)) return "steinway";
  if (/^fazioli/i.test(source)) return "fazioli";
  if (/^(bösendorfer|bosendorfer)/i.test(source)) return "bosendorfer";
  return source.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function v6CmsOrderNode(tagName, className, textContent) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function v6CmsOrderMount(host, config, data, reload) {
  const target = host.querySelector("#cmsPublicOrder");
  if (!target || !data || !Array.isArray(data.items)) return;
  const type = config.type === "service" ? "services" : "pianos";
  const rows = new Map(data.items.map((item) => [item.id, item]));
  let currentIds = data.items.map((item) => item.id);
  let savedIds = currentIds.slice();
  let saving = false;

  const panel = v6CmsOrderNode("section", "cms-public-order-panel");
  panel.setAttribute("aria-label", tr("Public display order", "Publikus megjelenítési sorrend"));
  const header = v6CmsOrderNode("div", "cms-public-order-head");
  const intro = v6CmsOrderNode("div", "cms-public-order-intro");
  intro.appendChild(v6CmsOrderNode("span", "eyebrow",
    tr("PUBLIC DISPLAY ORDER", "PUBLIKUS MEGJELENÍTÉSI SORREND")));
  intro.appendChild(v6CmsOrderNode("h3", "", type === "pianos"
    ? tr("Piano brand positions", "Zongoramárkák sorrendje")
    : tr("Service positions", "Szolgáltatások sorrendje")));
  intro.appendChild(v6CmsOrderNode("p", "",
    type === "pianos"
      ? tr("The first brand below appears on the left, followed by positions 2, 3 and so on. Applies to the homepage and Piano page.",
        "Az első márka jelenik meg bal oldalon, majd a 2., 3. stb. pozíció. A főoldalra és a Piano oldalra is érvényes.")
      : tr("Position 1 is the leftmost visible service card. Applies to the homepage and Services page.",
        "Az 1. pozíció a bal szélső látható szolgáltatáskártya. A főoldalra és a Services oldalra is érvényes.")));
  header.appendChild(intro);
  header.appendChild(v6CmsOrderNode("span", "cms-public-order-count",
    String(rows.size) + " " + tr("published groups / items", "publikus csoport / elem")));
  panel.appendChild(header);

  const list = v6CmsOrderNode("ol", "cms-public-order-list");
  list.setAttribute("aria-label", tr("Display order", "Megjelenítési sorrend"));
  panel.appendChild(list);
  const footer = v6CmsOrderNode("div", "cms-public-order-footer");
  const message = v6CmsOrderNode("p", "cms-public-order-feedback",
    tr("Move items using arrows or select a position, then save.", "Nyilakkal vagy pozícióválasztással rendezd az elemeket, majd ments."));
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  const saveButton = v6CmsOrderNode("button", "primary-button",
    tr("Save display order", "Megjelenítési sorrend mentése"));
  saveButton.type = "button";
  footer.appendChild(message);
  footer.appendChild(saveButton);
  panel.appendChild(footer);
  target.replaceChildren(panel);

  function changed() {
    return currentIds.some((id, index) => id !== savedIds[index]);
  }
  function render(focusId) {
    list.replaceChildren();
    currentIds.forEach((id, index) => {
      const item = rows.get(id);
      const row = v6CmsOrderNode("li", "cms-public-order-item");
      row.appendChild(v6CmsOrderNode("span", "cms-public-order-position", String(index + 1)));
      const description = v6CmsOrderNode("div", "cms-public-order-name");
      description.appendChild(v6CmsOrderNode("strong", "", item.label || id));
      if (type === "pianos") {
        description.appendChild(v6CmsOrderNode("small", "",
          String(item.count || 0) + " " + tr("published pianos", "publikált zongora")));
      }
      row.appendChild(description);
      const actions = v6CmsOrderNode("div", "cms-public-order-actions");
      const positionLabel = v6CmsOrderNode("label", "cms-public-order-choice");
      positionLabel.appendChild(v6CmsOrderNode("span", "", tr("Position", "Pozíció")));
      const select = v6CmsOrderNode("select", "");
      select.setAttribute("aria-label", (item.label || id) + " - " + tr("position", "pozíció"));
      select.dataset.cmsOrderId = id;
      currentIds.forEach((_other, optionIndex) => {
        const option = v6CmsOrderNode("option", "", String(optionIndex + 1));
        option.value = String(optionIndex);
        option.selected = optionIndex === index;
        select.appendChild(option);
      });
      select.disabled = saving;
      select.addEventListener("change", () => {
        const destination = Number(select.value);
        move(index, destination, id);
      });
      positionLabel.appendChild(select);
      actions.appendChild(positionLabel);
      for (const [delta, arrow, name] of [
        [-1, "↑", tr("Move up", "Feljebb")],
        [1, "↓", tr("Move down", "Lejjebb")]
      ]) {
        const button = v6CmsOrderNode("button", "cms-public-order-arrow", arrow);
        button.type = "button";
        button.disabled = saving || index + delta < 0 || index + delta >= currentIds.length;
        button.setAttribute("aria-label", name + ": " + (item.label || id));
        button.addEventListener("click", () => move(index, index + delta, id));
        actions.appendChild(button);
      }
      row.appendChild(actions);
      list.appendChild(row);
    });
    saveButton.disabled = saving || !changed();
    if (focusId) {
      const focusable = Array.from(list.querySelectorAll("select")).find((node) => node.dataset.cmsOrderId === focusId);
      focusable?.focus();
    }
  }
  function move(from, to, id) {
    if (saving || !Number.isInteger(to) || to < 0 || to >= currentIds.length || to === from) return;
    currentIds.splice(to, 0, currentIds.splice(from, 1)[0]);
    message.textContent = changed()
      ? tr("Unsaved order. Save to update both public pages.", "Nem mentett sorrend. Mentsd a két publikus oldal frissítéséhez.")
      : tr("Order unchanged.", "A sorrend nem változott.");
    render(id);
  }
  saveButton.addEventListener("click", async () => {
    if (saving || !changed()) return;
    saving = true;
    message.textContent = tr("Saving display order...", "Megjelenítési sorrend mentése...");
    render();
    try {
      const result = await api("/api/website-catalog-order/" + type, {
        method: "PUT",
        body: JSON.stringify({ ids: currentIds })
      });
      if (!Array.isArray(result?.items) || result.items.length !== currentIds.length) {
        throw new Error("DISPLAY_ORDER_SAVE_INCOMPLETE");
      }
      savedIds = result.items.map((item) => item.id);
      currentIds = savedIds.slice();
      toast(tr("Public display order saved.", "Publikus sorrend mentve."), "success");
      await reload();
    } catch (error) {
      message.textContent = humanError(error);
      toast(humanError(error), "error");
    } finally {
      saving = false;
      if (target.isConnected) render();
    }
  });
  render();
}


function v6CmsInstrumentOrderMount(target,data,reload){
  const items=Array.isArray(data?.items)?data.items:[],names=new Map(items.map(row=>[row.id,row.label]));
  let ids=items.map(row=>row.id),saved=ids.slice(),saving=false;
  const section=document.createElement("section");section.className="cms-public-order-panel";
  section.innerHTML=`<div class="cms-public-order-head"><div class="cms-public-order-intro"><span class="eyebrow">${tr("INDIVIDUAL PIANO ORDER","EGYEDI ZONGORASORREND")}</span><h3>${tr("Arrange all showroom instruments","Összes bemutatótermi zongora rendezése")}</h3><p>${tr("Set positions for every piano. Brand positions are controlled above; each brand keeps this instrument order.","Állítsd be minden zongora sorrendjét. A márkák sorrendje fent állítható; a márkákon belül ez a sorrend érvényes.")}</p></div></div><ol class="cms-public-order-list"></ol><div class="cms-public-order-footer"><p class="cms-public-order-feedback" role="status"></p><button type="button" class="primary-button">${tr("Save piano order","Zongorasorrend mentése")}</button></div>`;
  target.appendChild(section);
  const list=section.querySelector("ol"),message=section.querySelector(".cms-public-order-feedback"),button=section.querySelector("button.primary-button");
  const change=(from,to)=>{
    if(saving||to<0||to>=ids.length||from===to)return;
    ids.splice(to,0,ids.splice(from,1)[0]);render();
  };
  function render(){
    list.replaceChildren();
    ids.forEach((id,index)=>{
      const li=document.createElement("li");li.className="cms-public-order-item";
      const position=document.createElement("span");position.className="cms-public-order-position";position.textContent=String(index+1);
      const title=document.createElement("span");title.className="cms-public-order-name";title.textContent=names.get(id)||id;
      const actions=document.createElement("span");actions.className="cms-public-order-actions";
      for(const [symbol,delta,description] of [["↑",-1,"Move up"],["↓",1,"Move down"]]){
        const move=document.createElement("button");move.type="button";move.className="secondary-button";move.textContent=symbol;move.setAttribute("aria-label",description);move.disabled=saving||index+delta<0||index+delta>=ids.length;move.addEventListener("click",()=>change(index,index+delta));actions.appendChild(move);
      }
      const select=document.createElement("select");select.setAttribute("aria-label",tr("Position","Pozíció"));
      ids.forEach((_,i)=>{const option=document.createElement("option");option.value=String(i);option.textContent=String(i+1);option.selected=i===index;select.appendChild(option);});
      select.disabled=saving;select.addEventListener("change",()=>change(index,Number(select.value)));actions.appendChild(select);
      li.append(position,title,actions);list.appendChild(li);
    });
    button.disabled=saving||ids.every((id,i)=>saved[i]===id);
    message.textContent=button.disabled&&!saving?"":tr("Unsaved piano order","Nem mentett zongorasorrend");
  }
  button.addEventListener("click",async()=>{
    if(saving)return;saving=true;render();
    try{
      const response=await api("/api/website-catalog-order/instruments",{method:"PUT",body:JSON.stringify({ids})});
      if(response?.items?.length!==ids.length)throw Error("PIANO_ORDER_SAVE_INCOMPLETE");
      saved=ids.slice();toast(tr("Piano order saved.","Zongorasorrend mentve."),"success");await reload();
    }catch(error){message.textContent=humanError(error);toast(humanError(error),"error");}
    finally{saving=false;if(target.isConnected)render();}
  });
  render();
}
