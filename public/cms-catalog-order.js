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
