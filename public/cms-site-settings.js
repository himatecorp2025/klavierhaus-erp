"use strict";

// Dedicated CMS editors. Invoice issuer address remains independent.
async function v6CmsMountSiteControls(pageKey) {
  const host = document.querySelector("#cmsSiteControls");
  if (!host) return;
  const showNavigation = pageKey === "global";
  const showContact = pageKey === "global" || pageKey === "contact";
  const showBrands = pageKey === "pianos";
  if (!showNavigation && !showContact && !showBrands) return;
  host.replaceChildren();

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function heading(title, description) {
    const div = element("div", "cms-site-section-title");
    div.append(element("h3", "", title), element("p", "", description));
    return div;
  }
  function field(label, value, { type = "text", maxLength = 250, placeholder = "" } = {}) {
    const wrapper = element("label", "cms-site-field");
    wrapper.appendChild(element("span", "", label));
    const input = document.createElement("input");
    input.type = type;
    input.maxLength = maxLength;
    input.value = String(value || "");
    input.placeholder = placeholder;
    wrapper.appendChild(input);
    return { wrapper, input };
  }
  function action(label, onClick, className = "secondary-button") {
    const button = element("button", className, label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }
  async function save(url, payload, callback, button) {
    if (button) button.disabled = true;
    try {
      await api(url, { method: "PUT", body: JSON.stringify(payload) });
      toast(tr("Website settings saved.", "A weboldal beállításait mentettük."), "success");
      if (callback) await callback();
    } catch (error) { toast(humanError(error), "error"); }
    finally { if (button && button.isConnected) button.disabled = false; }
  }

  if (showBrands) {
    const panel = element("section", "panel cms-site-panel");
    const result = await api("/api/website-piano-brands");
    const brands = result.items || [];
    panel.appendChild(heading(tr("Manage Piano Brands", "Zongoramárkák kezelése"),
      tr("Create a brand before adding pianos. Rename it without changing its web address; archive it without deleting its pianos.",
        "Hozz létre márkát a zongorák feltöltése előtt. Az átnevezés megtartja a webcímet, az archiválás nem törli a zongorákat.")));
    const controls = element("div", "cms-site-toolbar");
    controls.append(action("+ " + tr("Add piano brand", "Új zongoramárka"), () => openBrandEditor(null), "primary-button"));
    panel.append(controls);
    const list = element("div", "cms-brand-editor-list");
    for (const brand of brands) {
      const card = element("article", "cms-brand-editor-row" + (brand.archived ? " is-archived" : ""));
      const text = element("div", "cms-brand-editor-title");
      text.append(element("strong", "", brand.name),
        element("small", "", String(brand.piano_count || 0) + " " + tr("pianos", "zongora") + " · " + (brand.archived ? tr("Archived", "Archiválva") : tr("Active", "Aktív"))));
      card.appendChild(text);
      const buttons = element("div", "cms-brand-editor-buttons");
      if (brand.archived) {
        buttons.append(action(tr("Restore", "Visszaállítás"), async () => {
          try {
            await api("/api/website-piano-brands/" + encodeURIComponent(brand.slug) + "/restore", { method: "POST", body: "{}" });
            toast(tr("Brand restored.", "A márka visszaállítva."), "success");
            await reloadCMS();
          } catch (error) { toast(humanError(error), "error"); }
        }));
      } else {
        buttons.append(action(tr("Rename / Edit", "Átnevezés / Szerkesztés"), () => openBrandEditor(brand)));
        buttons.append(action(tr("Archive", "Archiválás"), async () => {
          if (!confirm(tr("Archive this brand? Its showroom pianos will be hidden, but never deleted.",
            "Archiválod ezt a márkát? A hozzá tartozó bemutatótermi zongorák el lesznek rejtve, de nem törlődnek."))) return;
          try {
            await api("/api/website-piano-brands/" + encodeURIComponent(brand.slug), { method: "DELETE" });
            toast(tr("Brand archived safely.", "A márka biztonságosan archiválva."), "success");
            await reloadCMS();
          } catch (error) { toast(humanError(error), "error"); }
        }, "text-button danger-text"));
      }
      card.append(buttons);
      list.append(card);
    }
    if (!brands.length) list.append(element("p", "cms-empty", tr("No piano brands yet.", "Még nincs zongoramárka.")));
    panel.append(list);
    host.append(panel);
  }

  async function reloadCMS() {
    await v6RefreshCmsSidebarMeta();
    await v6LoadCmsPage();
  }
  function openBrandEditor(brand) {
    let coverUrl = brand?.cover_url || "";
    openDialog({
      title: brand ? tr("Edit piano brand", "Zongoramárka szerkesztése") : tr("New piano brand", "Új zongoramárka"),
      eyebrow: tr("PIANO PAGE", "ZONGORAOLDAL"),
      body: '<form id="cmsBrandForm" class="form-grid">' +
        '<label class="field full"><span>' + tr("Brand name", "Márkanév") + ' *</span><input name="name" maxlength="120" required></label>' +
        '<label class="field full"><span>' + tr("Optional cover image URL", "Opcionális borítókép URL") + '</span><input name="cover_url" maxlength="1000" placeholder="/uploads/website/..."></label>' +
        '<label class="file-picker full"><input id="cmsBrandCoverUpload" type="file" accept="image/*"><span>↑ ' +
        tr("Upload brand cover photo", "Márka borítókép feltöltése") + '</span></label>' +
        '<div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>' +
        tr("Cancel", "Mégse") + '</button><button type="submit" class="primary-button">' +
        tr("Save brand", "Márka mentése") + '</button></div></form>'
    });
    const form = document.querySelector("#cmsBrandForm");
    form.elements.name.value = brand?.name || "";
    form.elements.cover_url.value = coverUrl;
    form.querySelector("#cmsBrandCoverUpload")?.addEventListener("change", async (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      try {
        const result = await v6UploadWebsiteImage(file);
        coverUrl = result.absolute_url || result.image_url || "";
        form.elements.cover_url.value = coverUrl;
        toast(tr("Cover uploaded.", "Borítókép feltöltve."), "success");
      } catch (error) { toast(humanError(error), "error"); }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      const data = { name: form.elements.name.value.trim(), cover_url: form.elements.cover_url.value.trim() };
      try {
        await api("/api/website-piano-brands" + (brand ? "/" + encodeURIComponent(brand.slug) : ""), {
          method: brand ? "PUT" : "POST", body: JSON.stringify(data)
        });
        closeDialog();
        toast(tr("Piano brand saved.", "A zongoramárka mentve."), "success");
        await reloadCMS();
      } catch (error) { toast(humanError(error), "error"); }
      finally { if (button.isConnected) button.disabled = false; }
    });
  }

  if (showNavigation || showContact) {
    const data = await api("/api/website-presentation");
    if (showNavigation) {
      let items = (data.navigation || []).map((item) => ({ ...item }));
      const panel = element("section", "panel cms-site-panel");
      panel.append(heading(tr("Header navigation menu", "Felső navigációs menü"),
        tr("Reorder the links left-to-right and edit both languages. Web addresses remain unchanged.",
          "Állítsd be a menüpontok balról jobbra haladó sorrendjét és mindkét nyelvű nevét. A webcímek nem változnak.")));
      const list = element("div", "cms-site-nav-list");
      const foot = element("div", "cms-site-toolbar");
      const saveButton = action(tr("Save navigation", "Menüsorrend mentése"), () => {
        save("/api/website-presentation/navigation", { items }, reloadCMS, saveButton);
      }, "primary-button");
      foot.append(saveButton);
      panel.append(list, foot);
      host.append(panel);
      function renderNavigation() {
        list.replaceChildren();
        items.forEach((item, index) => {
          const row = element("div", "cms-site-nav-row");
          row.append(element("span", "cms-public-order-position", String(index + 1)));
          const fields = element("div", "cms-site-nav-fields");
          const en = field(tr("English title", "Angol név"), item.label_en, { maxLength: 80 });
          const hu = field(tr("Hungarian title", "Magyar név"), item.label_hu, { maxLength: 80 });
          en.input.addEventListener("input", () => { item.label_en = en.input.value; });
          hu.input.addEventListener("input", () => { item.label_hu = hu.input.value; });
          fields.append(en.wrapper, hu.wrapper);
          row.append(fields);
          for (const [offset, symbol, title] of [[-1, "↑", tr("Move left", "Balra")], [1, "↓", tr("Move right", "Jobbra")]]) {
            const next = action(symbol, () => {
              items.splice(index + offset, 0, items.splice(index, 1)[0]);
              renderNavigation();
            }, "cms-public-order-arrow");
            next.disabled = index + offset < 0 || index + offset >= items.length;
            next.title = title;
            next.setAttribute("aria-label", title + ": " + item.label_en);
            row.append(next);
          }
          list.append(row);
        });
      }
      renderNavigation();
    }
    if (showContact) {
      const config = structuredClone(data.contact || {});
      const panel = element("section", "panel cms-site-panel");
      panel.append(heading(tr("Public footer & contact information", "Publikus lábléc és kapcsolati adatok"),
        tr("These showroom details appear in the footer, contact page and mobile header. They do NOT change invoicing or registered company addresses.",
          "Ezek a galériaadatok a láblécben, a Contact oldalon és a mobil fejlécben jelennek meg. NEM módosítják a számlázási vagy székhelyadatokat.")));
      const grid = element("div", "cms-site-contact-grid");
      for (const [key, en, hu] of [
        ["display_name", "Public business name", "Publikus cégnév"],
        ["venue_name", "Showroom / gallery name", "Bemutatóterem / galéria neve"],
        ["street_address", "Showroom street address", "Bemutatóterem utcacíme"],
        ["address_line2", "Floor, unit or extra address", "Emelet / iroda / további cím"],
        ["city", "City", "Város"], ["region", "State / region", "Állam / régió"],
        ["postal_code", "Postal code", "Irányítószám"], ["country", "Country", "Ország"],
        ["phone", "Public telephone", "Publikus telefonszám"], ["email", "Public email", "Publikus e-mail"]
      ]) {
        const f = field(tr(en, hu), config[key] || "", { type: key === "email" ? "email" : "text", maxLength: 250 });
        f.input.required = ["display_name", "street_address", "city", "phone", "email"].includes(key);
        f.input.addEventListener("input", () => { config[key] = f.input.value; });
        grid.append(f.wrapper);
      }
      panel.append(grid);
      const socialTitle = element("h4", "cms-site-social-title", tr("Social media links", "Közösségi média hivatkozások"));
      const socialGrid = element("div", "cms-site-contact-grid");
      for (const name of ["instagram", "facebook", "youtube", "linkedin", "tiktok"]) {
        const link = field(name[0].toUpperCase() + name.slice(1), config.social?.[name] || "", {
          type: "url", maxLength: 500, placeholder: "https://"
        });
        link.input.addEventListener("input", () => {
          config.social ||= {};
          config.social[name] = link.input.value;
        });
        socialGrid.append(link.wrapper);
      }
      panel.append(socialTitle, socialGrid);
      const foot = element("div", "cms-site-toolbar");
      const saveButton = action(tr("Save public contact & footer", "Kapcsolati adatok és lábléc mentése"), () => {
        if (!grid.querySelectorAll("input").length || [...panel.querySelectorAll("input")].some((input) => !input.checkValidity())) {
          [...panel.querySelectorAll("input")].find((input) => !input.checkValidity())?.reportValidity();
          return;
        }
        save("/api/website-presentation/contact", config, reloadCMS, saveButton);
      }, "primary-button");
      foot.append(saveButton);
      panel.append(foot);
      host.append(panel);
    }
  }
}
