"use strict";

const crypto = require("node:crypto");
const { slugify } = require("./events");

function cleanText(value, max = 20000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback ? 1 : 0;
  return [true, 1, "1", "true", "on", "yes"].includes(value) ? 1 : 0;
}

function imageUrl(value, erpBaseUrl) {
  const path = cleanText(value, 1000);
  return path.startsWith("/uploads/") && erpBaseUrl ? `${erpBaseUrl}${path}` : path;
}

function localized(row, language, erpBaseUrl) {
  const lang = language === "hu" ? "hu" : "en";
  let gallery;
  try { gallery = row.gallery_json ? JSON.parse(row.gallery_json) : undefined; } catch (_error) { gallery = []; }
  const value = {
    id: row.id,
    slug: row[`slug_${lang}`] || "",
    alternate_slug: row[`slug_${lang === "hu" ? "en" : "hu"}`] || "",
    title: row[`title_${lang}`] || "",
    summary: row[`summary_${lang}`] || "",
    description: row[`description_${lang}`] || "",
    role: row[`role_${lang}`] || "",
    quote: row[`quote_${lang}`] || "",
    image_url: imageUrl(row.image_url || row.portrait_url, erpBaseUrl),
    image_alt: row[`image_alt_${lang}`] || row[`portrait_alt_${lang}`] || row[`title_${lang}`] || row.person_name || "Klavierhaus",
    gallery
  };
  if (row.person_name !== undefined) value.person_name = row.person_name;
  if (row.brand !== undefined) value.brand = row.brand;
  if (row.model !== undefined) value.model = row.model;
  if (row.availability_status !== undefined) value.availability_status = row.availability_status;
  if (row.featured !== undefined) value.featured = Number(row.featured) === 1;
  return value;
}

function uniqueSlug(db, table, column, title, excludeId = "") {
  const base = slugify(title);
  let candidate = base;
  let sequence = 2;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=? AND id<>? LIMIT 1`).get(candidate, excludeId)) {
    candidate = `${base}-${sequence}`;
    sequence += 1;
  }
  return candidate;
}

function registerWebsiteCatalogRoutes({ app, db, auth, permit, audit, erpBaseUrl = "" }) {
  const admin = permit("ADMIN");
  const baseUrl = String(erpBaseUrl || "").replace(/\/$/, "");

  function sendError(res, error, fallback) {
    const code = cleanText(error?.message || fallback, 120) || fallback;
    res.status(String(error?.message || "").includes("UNIQUE") ? 409 : 400).json({ error: code });
  }

  app.get("/api/public/website-reviews", (req, res) => {
    const language = req.query.lang === "hu" ? "hu" : "en";
    const rows = db.prepare(`SELECT r.*,e.slug_en AS event_slug_en,e.slug_hu AS event_slug_hu
      FROM website_reviews r LEFT JOIN events e ON e.id=r.linked_event_id
      WHERE r.visible=1 ORDER BY r.sort_order,r.created_at`).all();
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json(rows.map((row) => ({ ...localized({ ...row, image_url: row.portrait_url }, language, baseUrl), event_slug: row[`event_slug_${language}`] || null })));
  });

  app.get("/api/public/showroom-pianos", (req, res) => {
    const language = req.query.lang === "hu" ? "hu" : "en";
    const rows = db.prepare("SELECT * FROM website_showroom_pianos WHERE published=1 AND availability_status<>'HIDDEN' ORDER BY featured DESC,sort_order,created_at").all();
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json(rows.map((row) => localized(row, language, baseUrl)));
  });

  app.get("/api/public/showroom-pianos/:slug", (req, res) => {
    const language = req.query.lang === "hu" ? "hu" : "en";
    const column = language === "hu" ? "slug_hu" : "slug_en";
    const row = db.prepare(`SELECT * FROM website_showroom_pianos WHERE ${column}=? AND published=1 AND availability_status<>'HIDDEN'`).get(req.params.slug);
    if (!row) return res.status(404).json({ error: "SHOWROOM_PIANO_NOT_FOUND" });
    res.json(localized(row, language, baseUrl));
  });

  app.get("/api/public/website-services", (req, res) => {
    const language = req.query.lang === "hu" ? "hu" : "en";
    const rows = db.prepare("SELECT * FROM website_services WHERE visible=1 ORDER BY featured DESC,sort_order,created_at").all();
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json(rows.map((row) => localized(row, language, baseUrl)));
  });

  app.get("/api/public/website-services/:slug", (req, res) => {
    const language = req.query.lang === "hu" ? "hu" : "en";
    const column = language === "hu" ? "slug_hu" : "slug_en";
    const row = db.prepare(`SELECT * FROM website_services WHERE ${column}=? AND visible=1`).get(req.params.slug);
    if (!row) return res.status(404).json({ error: "WEBSITE_SERVICE_NOT_FOUND" });
    res.json(localized(row, language, baseUrl));
  });

  app.get("/api/website-reviews", auth, admin, (_req, res) => {
    res.json(db.prepare("SELECT * FROM website_reviews ORDER BY sort_order,created_at").all());
  });

  app.post("/api/website-reviews", auth, admin, (req, res) => {
    const value = {
      id: newId("WREV"), person_name: cleanText(req.body?.person_name, 200),
      role_en: cleanText(req.body?.role_en, 300), role_hu: cleanText(req.body?.role_hu, 300),
      quote_en: cleanText(req.body?.quote_en, 5000), quote_hu: cleanText(req.body?.quote_hu, 5000),
      portrait_url: cleanText(req.body?.portrait_url, 1000), portrait_alt_en: cleanText(req.body?.portrait_alt_en, 500),
      portrait_alt_hu: cleanText(req.body?.portrait_alt_hu, 500), linked_event_id: cleanText(req.body?.linked_event_id, 120) || null,
      visible: bool(req.body?.visible, true), sort_order: Number(req.body?.sort_order || 0), user_id: req.user.id
    };
    if (!value.person_name || !value.quote_en || !value.quote_hu || !value.portrait_url) return res.status(400).json({ error: "REVIEW_REQUIRED_FIELDS" });
    try {
      db.prepare(`INSERT INTO website_reviews(id,person_name,role_en,role_hu,quote_en,quote_hu,portrait_url,portrait_alt_en,portrait_alt_hu,linked_event_id,visible,sort_order,created_by_user_id,updated_by_user_id)
        VALUES(@id,@person_name,@role_en,@role_hu,@quote_en,@quote_hu,@portrait_url,@portrait_alt_en,@portrait_alt_hu,@linked_event_id,@visible,@sort_order,@user_id,@user_id)`).run(value);
      const row = db.prepare("SELECT * FROM website_reviews WHERE id=?").get(value.id);
      audit(req, "CREATE", "website_reviews", row.id, null, row, 1, "Public review created");
      res.status(201).json(row);
    } catch (error) { sendError(res, error, "REVIEW_CREATE_FAILED"); }
  });

  app.put("/api/website-reviews/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM website_reviews WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "REVIEW_NOT_FOUND" });
    const value = { ...before, ...req.body };
    value.person_name = cleanText(value.person_name, 200); value.quote_en = cleanText(value.quote_en, 5000); value.quote_hu = cleanText(value.quote_hu, 5000); value.portrait_url = cleanText(value.portrait_url, 1000);
    if (!value.person_name || !value.quote_en || !value.quote_hu || !value.portrait_url) return res.status(400).json({ error: "REVIEW_REQUIRED_FIELDS" });
    db.prepare(`UPDATE website_reviews SET person_name=?,role_en=?,role_hu=?,quote_en=?,quote_hu=?,portrait_url=?,portrait_alt_en=?,portrait_alt_hu=?,linked_event_id=?,visible=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(value.person_name, cleanText(value.role_en, 300), cleanText(value.role_hu, 300), value.quote_en, value.quote_hu, value.portrait_url, cleanText(value.portrait_alt_en, 500), cleanText(value.portrait_alt_hu, 500), cleanText(value.linked_event_id, 120) || null, bool(value.visible, true), Number(value.sort_order || 0), req.user.id, before.id);
    const after = db.prepare("SELECT * FROM website_reviews WHERE id=?").get(before.id);
    audit(req, "UPDATE", "website_reviews", before.id, before, after, 1, "Public review updated");
    res.json(after);
  });

  app.delete("/api/website-reviews/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM website_reviews WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "REVIEW_NOT_FOUND" });
    db.prepare("DELETE FROM website_reviews WHERE id=?").run(before.id);
    audit(req, "DELETE", "website_reviews", before.id, before, null, 1, "Public review deleted");
    res.json({ ok: true });
  });

  function catalogRoutes({ route, table, prefix, notFound, required, statuses = null }) {
    app.get(`/api/${route}`, auth, admin, (_req, res) => res.json(db.prepare(`SELECT * FROM ${table} ORDER BY sort_order,created_at`).all()));
    app.post(`/api/${route}`, auth, admin, (req, res) => {
      const body = req.body || {};
      if (required.some((field) => !cleanText(body[field]))) return res.status(400).json({ error: `${prefix}_REQUIRED_FIELDS` });
      const id = newId(prefix); const slugEn = uniqueSlug(db, table, "slug_en", body.title_en); const slugHu = uniqueSlug(db, table, "slug_hu", body.title_hu);
      const common = {
        id, slug_en: slugEn, slug_hu: slugHu, title_en: cleanText(body.title_en, 300), title_hu: cleanText(body.title_hu, 300),
        summary_en: cleanText(body.summary_en, 2000), summary_hu: cleanText(body.summary_hu, 2000), description_en: cleanText(body.description_en), description_hu: cleanText(body.description_hu),
        image_url: cleanText(body.image_url, 1000), image_alt_en: cleanText(body.image_alt_en, 500), image_alt_hu: cleanText(body.image_alt_hu, 500),
        featured: bool(body.featured), sort_order: Number(body.sort_order || 0), user_id: req.user.id
      };
      try {
        if (table === "website_showroom_pianos") {
          const status = cleanText(body.availability_status || "AVAILABLE", 30).toUpperCase();
          if (!statuses.has(status)) return res.status(400).json({ error: "INVALID_SHOWROOM_STATUS" });
          db.prepare(`INSERT INTO website_showroom_pianos(id,slug_en,slug_hu,brand,model,title_en,title_hu,summary_en,summary_hu,description_en,description_hu,image_url,image_alt_en,image_alt_hu,gallery_json,availability_status,featured,published,sort_order,created_by_user_id,updated_by_user_id)
            VALUES(@id,@slug_en,@slug_hu,@brand,@model,@title_en,@title_hu,@summary_en,@summary_hu,@description_en,@description_hu,@image_url,@image_alt_en,@image_alt_hu,'[]',@availability_status,@featured,@published,@sort_order,@user_id,@user_id)`)
            .run({ ...common, brand: cleanText(body.brand, 200), model: cleanText(body.model, 200), availability_status: status, published: bool(body.published, true) });
        } else {
          db.prepare(`INSERT INTO website_services(id,slug_en,slug_hu,title_en,title_hu,summary_en,summary_hu,description_en,description_hu,image_url,image_alt_en,image_alt_hu,visible,featured,sort_order,created_by_user_id,updated_by_user_id)
            VALUES(@id,@slug_en,@slug_hu,@title_en,@title_hu,@summary_en,@summary_hu,@description_en,@description_hu,@image_url,@image_alt_en,@image_alt_hu,@visible,@featured,@sort_order,@user_id,@user_id)`)
            .run({ ...common, visible: bool(body.visible, true) });
        }
        const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
        audit(req, "CREATE", route, id, null, row, 1, `${route} record created`);
        res.status(201).json(row);
      } catch (error) { sendError(res, error, `${prefix}_CREATE_FAILED`); }
    });
    app.put(`/api/${route}/:id`, auth, admin, (req, res) => {
      const before = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
      if (!before) return res.status(404).json({ error: notFound });
      const body = { ...before, ...(req.body || {}) };
      if (required.some((field) => !cleanText(body[field]))) return res.status(400).json({ error: `${prefix}_REQUIRED_FIELDS` });
      const slugEn = body.title_en === before.title_en ? before.slug_en : uniqueSlug(db, table, "slug_en", body.title_en, before.id);
      const slugHu = body.title_hu === before.title_hu ? before.slug_hu : uniqueSlug(db, table, "slug_hu", body.title_hu, before.id);
      if (table === "website_showroom_pianos") {
        const status = cleanText(body.availability_status || "AVAILABLE", 30).toUpperCase();
        if (!statuses.has(status)) return res.status(400).json({ error: "INVALID_SHOWROOM_STATUS" });
        db.prepare(`UPDATE website_showroom_pianos SET slug_en=?,slug_hu=?,brand=?,model=?,title_en=?,title_hu=?,summary_en=?,summary_hu=?,description_en=?,description_hu=?,image_url=?,image_alt_en=?,image_alt_hu=?,availability_status=?,featured=?,published=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(slugEn, slugHu, cleanText(body.brand, 200), cleanText(body.model, 200), cleanText(body.title_en, 300), cleanText(body.title_hu, 300), cleanText(body.summary_en, 2000), cleanText(body.summary_hu, 2000), cleanText(body.description_en), cleanText(body.description_hu), cleanText(body.image_url, 1000), cleanText(body.image_alt_en, 500), cleanText(body.image_alt_hu, 500), status, bool(body.featured), bool(body.published, true), Number(body.sort_order || 0), req.user.id, before.id);
      } else {
        db.prepare(`UPDATE website_services SET slug_en=?,slug_hu=?,title_en=?,title_hu=?,summary_en=?,summary_hu=?,description_en=?,description_hu=?,image_url=?,image_alt_en=?,image_alt_hu=?,visible=?,featured=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(slugEn, slugHu, cleanText(body.title_en, 300), cleanText(body.title_hu, 300), cleanText(body.summary_en, 2000), cleanText(body.summary_hu, 2000), cleanText(body.description_en), cleanText(body.description_hu), cleanText(body.image_url, 1000), cleanText(body.image_alt_en, 500), cleanText(body.image_alt_hu, 500), bool(body.visible, true), bool(body.featured), Number(body.sort_order || 0), req.user.id, before.id);
      }
      const after = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(before.id);
      audit(req, "UPDATE", route, before.id, before, after, 1, `${route} record updated`);
      res.json(after);
    });
    app.delete(`/api/${route}/:id`, auth, admin, (req, res) => {
      const before = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
      if (!before) return res.status(404).json({ error: notFound });
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(before.id);
      audit(req, "DELETE", route, before.id, before, null, 1, `${route} record deleted; ERP client pianos were not touched`);
      res.json({ ok: true });
    });
  }

  catalogRoutes({ route: "showroom-pianos", table: "website_showroom_pianos", prefix: "SHOWROOM_PIANO", notFound: "SHOWROOM_PIANO_NOT_FOUND", required: ["brand", "title_en", "title_hu", "image_url"], statuses: new Set(["AVAILABLE", "RESERVED", "SOLD", "HIDDEN"]) });
  catalogRoutes({ route: "website-services", table: "website_services", prefix: "WEBSITE_SERVICE", notFound: "WEBSITE_SERVICE_NOT_FOUND", required: ["title_en", "title_hu", "image_url"] });
}

module.exports = { registerWebsiteCatalogRoutes };
