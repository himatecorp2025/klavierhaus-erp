"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { inspectImageFile } = require("./upload-middleware");
const { pages, routeDefinitions, globalCopy } = require("../website/server/site-content");

const LANGUAGES = new Set(["en", "hu"]);
const PAGE_KEYS = new Set(["global", ...Object.keys(routeDefinitions)]);
const MAX_DOCUMENT_BYTES = 300000;
const PAGE_ROUTE_SETTINGS_KEY = "website_page_route_settings";
const WEBSITE_DESIGN_SETTINGS_KEY = "website_design_settings";
const DESIGN_COLOR_KEYS = ["black", "ivory", "cream", "gold", "gold_bright", "muted", "line"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeContentDefaults(defaultValue, storedValue) {
  if (Array.isArray(defaultValue)) return Array.isArray(storedValue) ? storedValue : clone(defaultValue);
  if (defaultValue && typeof defaultValue === "object") {
    const storedObject = storedValue && typeof storedValue === "object" && !Array.isArray(storedValue) ? storedValue : {};
    return Object.fromEntries(Object.entries(defaultValue).map(([key, value]) => [
      key,
      Object.prototype.hasOwnProperty.call(storedObject, key) ? mergeContentDefaults(value, storedObject[key]) : clone(value)
    ]).concat(Object.entries(storedObject).filter(([key]) => !Object.prototype.hasOwnProperty.call(defaultValue, key))));
  }
  return storedValue === undefined ? defaultValue : storedValue;
}

function normalizeLanguage(value) {
  return value === "hu" ? "hu" : "en";
}

function normalizeRoute(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  if (normalized.includes("//") || normalized.includes("?") || normalized.includes("#") || normalized.includes("..")) throw new Error("INVALID_WEBSITE_ROUTE");
  return normalized === "/hu" ? "/hu/" : normalized.replace(/\/$/, "") || "/";
}

function defaultPageRoutes() {
  return Object.fromEntries(Object.entries(routeDefinitions).map(([key, routes]) => [key, { en: routes.en, hu: routes.hu }]));
}

function parsePageRoutes(raw) {
  const defaults = defaultPageRoutes();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    for (const [key, routes] of Object.entries(defaults)) {
      defaults[key] = { en: normalizeRoute(parsed?.[key]?.en, routes.en), hu: normalizeRoute(parsed?.[key]?.hu, routes.hu) };
    }
  } catch (_error) { /* bundled routes remain the safe fallback */ }
  return defaults;
}

function defaultWebsiteDesignSettings() {
  return { black: "#080807", ivory: "#f2efe8", cream: "#e8e1d5", gold: "#b79a60", gold_bright: "#d9bd7a", muted: "#aaa49a", line: "rgba(183,154,96,.28)", display: "Cormorant Garamond", sans: "Inter", logo_url: "" };
}

function parseDesignSettings(raw) {
  const value = defaultWebsiteDesignSettings();
  try { const parsed = JSON.parse(raw || "{}"); for (const key of DESIGN_COLOR_KEYS) if (/^#[0-9a-f]{6}$/i.test(String(parsed[key] || ""))) value[key] = String(parsed[key]); for (const key of ["display", "sans"]) if (/^[A-Za-z0-9 ,.'-]{1,100}$/.test(String(parsed[key] || ""))) value[key] = String(parsed[key]); if (/^(?:https?:\/\/|\/)\S{1,500}$/i.test(String(parsed.logo_url || ""))) value.logo_url = String(parsed.logo_url); } catch (_error) { /* defaults */ }
  return value;
}

function fallbackPage(pageKey, language) {
  if (pageKey === "global") return clone(globalCopy[normalizeLanguage(language)] || null);
  return clone(pages[normalizeLanguage(language)]?.[pageKey] || null);
}

function sanitizeContent(value, depth = 0) {
  if (depth > 12) throw new Error("WEBSITE_CONTENT_TOO_DEEP");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return value.replace(/\u0000/g, "").slice(0, 30000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeContent(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => {
      const safeKey = String(key).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
      if (!safeKey || ["__proto__", "prototype", "constructor"].includes(safeKey)) throw new Error("INVALID_WEBSITE_CONTENT_KEY");
      return [safeKey, sanitizeContent(item, depth + 1)];
    }));
  }
  return "";
}

function parseStoredPage(row, pageKey, language) {
  if (!row) return fallbackPage(pageKey, language);
  try {
    const parsed = JSON.parse(row.content_json);
    return parsed && typeof parsed === "object" ? mergeContentDefaults(fallbackPage(pageKey, language), parsed) : fallbackPage(pageKey, language);
  } catch (_error) {
    return fallbackPage(pageKey, language);
  }
}

function registerWebsiteContentRoutes(options) {
  const { app, db, auth, permit, audit, websiteImageUpload, websiteImageDir } = options;
  const admin = permit("ADMIN");
  const uploadImage = websiteImageUpload ? websiteImageUpload.single("website_image") : (_req, _res, next) => next();
  const websiteBaseUrl = String(options.websiteBaseUrl || "https://klavierhaus-home.onrender.com").replace(/\/$/, "");

  function pageRow(pageKey, language) {
    return db.prepare("SELECT * FROM website_content_pages WHERE page_key=? AND language=?").get(pageKey, language) || null;
  }

  function pageRoutes() {
    return parsePageRoutes(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(PAGE_ROUTE_SETTINGS_KEY)?.setting_value);
  }
  function designSettings() { return parseDesignSettings(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(WEBSITE_DESIGN_SETTINGS_KEY)?.setting_value); }

  function pageResponse(pageKey, language) {
    const row = pageRow(pageKey, language);
    return {
      page_key: pageKey,
      language,
      content: parseStoredPage(row, pageKey, language),
      version: Number(row?.version || 0),
      updated_at: row?.updated_at || null,
      source: row ? "database" : "bundled"
    };
  }

  function validateDocument(pageKey, language, candidate) {
    if (!PAGE_KEYS.has(pageKey) || !LANGUAGES.has(language) || !fallbackPage(pageKey, language)) throw new Error("WEBSITE_PAGE_NOT_FOUND");
    const content = sanitizeContent(candidate);
    if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("INVALID_WEBSITE_CONTENT");
    if (pageKey === "global") {
      if (!Array.isArray(content.nav) || !content.footerStatement) throw new Error("WEBSITE_REQUIRED_CONTENT");
    } else if (!content.seo?.title || !content.seo?.description || !content.hero?.title) throw new Error("WEBSITE_REQUIRED_CONTENT");
    const serialized = JSON.stringify(content);
    if (Buffer.byteLength(serialized, "utf8") > MAX_DOCUMENT_BYTES) throw new Error("WEBSITE_CONTENT_TOO_LARGE");
    return { content, serialized };
  }

  function createVersion(pageKey, language, serialized, userId, status = "DRAFT") {
    const next = Number(db.prepare("SELECT COALESCE(MAX(version),0)+1 AS version FROM website_content_versions WHERE page_key=? AND language=?").get(pageKey, language).version);
    const id = `WCV-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`INSERT INTO website_content_versions(id,page_key,language,version,content_json,status,created_by_user_id,published_by_user_id,published_at)
      VALUES(?,?,?,?,?,?,?,CASE WHEN ?='PUBLISHED' THEN ? ELSE NULL END,CASE WHEN ?='PUBLISHED' THEN CURRENT_TIMESTAMP ELSE NULL END)`)
      .run(id, pageKey, language, next, serialized, status, userId, status, userId, status);
    return db.prepare("SELECT * FROM website_content_versions WHERE id=?").get(id);
  }

  function publishVersion(row, userId) {
    return db.transaction(() => {
      db.prepare("UPDATE website_content_versions SET status='ARCHIVED' WHERE page_key=? AND language=? AND status='PUBLISHED'").run(row.page_key, row.language);
      db.prepare("UPDATE website_content_versions SET status='PUBLISHED',published_by_user_id=?,published_at=CURRENT_TIMESTAMP WHERE id=?").run(userId, row.id);
      db.prepare(`INSERT INTO website_content_pages(page_key,language,content_json,version,updated_by_user_id,published_at,updated_at)
        VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(page_key,language) DO UPDATE SET content_json=excluded.content_json,version=excluded.version,updated_by_user_id=excluded.updated_by_user_id,published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
        .run(row.page_key, row.language, row.content_json, row.version, userId);
      return pageResponse(row.page_key, row.language);
    })();
  }

  app.get("/api/public/website-content/:pageKey", (req, res) => {
    const pageKey = String(req.params.pageKey || "");
    const language = normalizeLanguage(req.query.lang);
    if (!PAGE_KEYS.has(pageKey) || !fallbackPage(pageKey, language)) return res.status(404).json({ error: "WEBSITE_PAGE_NOT_FOUND" });
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate, stale-while-revalidate=60");
    res.json(pageResponse(pageKey, language));
  });

  app.get("/api/public/website-preview/:token", (req, res) => {
    const tokenHash = crypto.createHash("sha256").update(String(req.params.token || "")).digest("hex");
    const row = db.prepare(`SELECT v.* FROM website_preview_tokens t JOIN website_content_versions v ON v.id=t.version_id
      WHERE t.token_hash=? AND t.expires_at>CURRENT_TIMESTAMP`).get(tokenHash);
    if (!row) return res.status(404).json({ error: "WEBSITE_PREVIEW_EXPIRED_OR_NOT_FOUND" });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.json({ page_key: row.page_key, language: row.language, content: parseStoredPage(row, row.page_key, row.language), version: row.version, preview: true, expires_at: db.prepare("SELECT expires_at FROM website_preview_tokens WHERE token_hash=?").get(tokenHash).expires_at });
  });

  app.get("/api/website-content/pages", auth, admin, (_req, res) => {
    res.json({
      website_base_url: websiteBaseUrl,
      pages: [...PAGE_KEYS].filter((pageKey) => fallbackPage(pageKey, "en") || fallbackPage(pageKey, "hu")).map((pageKey) => ({
        page_key: pageKey,
        routes: pageRoutes()[pageKey] || routeDefinitions[pageKey] || { en: "/", hu: "/hu/" },
        title_en: pageKey === "global" ? "Global navigation & footer" : (fallbackPage(pageKey, "en")?.seo?.title || pageKey),
        title_hu: pageKey === "global" ? "Globális navigáció és lábléc" : (fallbackPage(pageKey, "hu")?.seo?.title || pageKey)
      }))
    });
  });

  app.get("/api/public/website-page-settings", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate, stale-while-revalidate=60");
    res.json({ routes: pageRoutes() });
  });
  app.get("/api/public/website-design-settings", (_req, res) => { res.setHeader("Cache-Control", "public, max-age=0, must-revalidate, stale-while-revalidate=60"); res.json(designSettings()); });
  app.get("/api/website-design-settings", auth, admin, (_req, res) => res.json(designSettings()));
  app.put("/api/website-design-settings", auth, admin, (req, res) => {
    const before = designSettings(); const candidate = { ...before, ...req.body };
    const after = parseDesignSettings(JSON.stringify(candidate));
    db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(WEBSITE_DESIGN_SETTINGS_KEY, JSON.stringify(after), req.user.name || req.user.id);
    audit(req, "UPDATE_WEBSITE_DESIGN", "website", WEBSITE_DESIGN_SETTINGS_KEY, before, after, 1, "Website visual settings updated"); res.json(after);
  });

  app.put("/api/website-content/:pageKey/routes", auth, admin, (req, res) => {
    const pageKey = String(req.params.pageKey || "");
    if (!PAGE_KEYS.has(pageKey) || pageKey === "global") return res.status(404).json({ error: "WEBSITE_PAGE_NOT_FOUND" });
    const current = pageRoutes();
    try {
      const routes = { en: normalizeRoute(req.body?.en, current[pageKey]?.en), hu: normalizeRoute(req.body?.hu, current[pageKey]?.hu) };
      for (const [key, value] of Object.entries(current)) if (key !== pageKey && (value.en === routes.en || value.hu === routes.hu || value.en === routes.hu || value.hu === routes.en)) throw new Error("WEBSITE_ROUTE_ALREADY_USED");
      const before = current[pageKey]; current[pageKey] = routes;
      db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(PAGE_ROUTE_SETTINGS_KEY, JSON.stringify(current), req.user.name || req.user.id);
      audit(req, "UPDATE_WEBSITE_ROUTE", "website", pageKey, before, routes, 1, "Public website route updated");
      res.json({ page_key: pageKey, routes });
    } catch (error) { res.status(400).json({ error: String(error.message || "INVALID_WEBSITE_ROUTE") }); }
  });

  app.get("/api/website-content/:pageKey", auth, admin, (req, res) => {
    const pageKey = String(req.params.pageKey || "");
    const language = normalizeLanguage(req.query.lang);
    if (!PAGE_KEYS.has(pageKey) || !fallbackPage(pageKey, language)) return res.status(404).json({ error: "WEBSITE_PAGE_NOT_FOUND" });
    res.setHeader("Cache-Control", "no-store");
    res.json(pageResponse(pageKey, language));
  });

  app.get("/api/website-content/:pageKey/versions", auth, admin, (req, res) => {
    const pageKey = String(req.params.pageKey || "");
    const language = normalizeLanguage(req.query.lang);
    if (!PAGE_KEYS.has(pageKey)) return res.status(404).json({ error: "WEBSITE_PAGE_NOT_FOUND" });
    res.json(db.prepare(`SELECT id,page_key,language,version,status,created_by_user_id,published_by_user_id,created_at,published_at
      FROM website_content_versions WHERE page_key=? AND language=? ORDER BY version DESC`).all(pageKey, language));
  });

  app.post("/api/website-content/:pageKey/drafts", auth, admin, (req, res) => {
    const pageKey = String(req.params.pageKey || "");
    const language = String(req.body?.language || "");
    try {
      const validated = validateDocument(pageKey, language, req.body?.content);
      const row = createVersion(pageKey, language, validated.serialized, req.user.id, "DRAFT");
      audit(req, "SAVE_DRAFT", "website", `${pageKey}:${language}:${row.version}`, null, { version: row.version }, 1, "Website content draft saved");
      res.status(201).json({ ...row, content: validated.content, content_json: undefined });
    } catch (error) { res.status(error.message === "WEBSITE_PAGE_NOT_FOUND" ? 404 : 400).json({ error: String(error.message || "INVALID_WEBSITE_CONTENT").slice(0, 120) }); }
  });

  app.post("/api/website-content/:pageKey/versions/:versionId/preview-link", auth, admin, (req, res) => {
    const row = db.prepare("SELECT * FROM website_content_versions WHERE id=? AND page_key=?").get(req.params.versionId, req.params.pageKey);
    if (!row) return res.status(404).json({ error: "WEBSITE_CONTENT_VERSION_NOT_FOUND" });
    const hours = Math.min(72, Math.max(1, Number(req.body?.hours || 24)));
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO website_preview_tokens(token_hash,version_id,expires_at,created_by_user_id) VALUES(?,?,?,?)")
      .run(tokenHash, row.id, expiresAt, req.user.id);
    res.status(201).json({ preview_url: `${websiteBaseUrl}/preview/${rawToken}`, api_url: `${String(options.erpBaseUrl || "").replace(/\/$/, "")}/api/public/website-preview/${rawToken}`, expires_at: expiresAt });
  });

  app.post("/api/website-content/:pageKey/versions/:versionId/publish", auth, admin, (req, res) => {
    const row = db.prepare("SELECT * FROM website_content_versions WHERE id=? AND page_key=?").get(req.params.versionId, req.params.pageKey);
    if (!row) return res.status(404).json({ error: "WEBSITE_CONTENT_VERSION_NOT_FOUND" });
    const before = pageResponse(row.page_key, row.language);
    const after = publishVersion(row, req.user.id);
    audit(req, "PUBLISH_WEBSITE_CONTENT", "website", `${row.page_key}:${row.language}`, before, after, 1, "Selected website content version published atomically");
    res.json(after);
  });

  app.post("/api/website-content/:pageKey/versions/:versionId/restore", auth, admin, (req, res) => {
    const row = db.prepare("SELECT * FROM website_content_versions WHERE id=? AND page_key=?").get(req.params.versionId, req.params.pageKey);
    if (!row) return res.status(404).json({ error: "WEBSITE_CONTENT_VERSION_NOT_FOUND" });
    const restored = createVersion(row.page_key, row.language, row.content_json, req.user.id, "DRAFT");
    audit(req, "RESTORE_DRAFT", "website", `${row.page_key}:${row.language}:${restored.version}`, { restored_from: row.version }, { version: restored.version }, 1, "Historical version restored as new draft");
    res.status(201).json({ id: restored.id, page_key: restored.page_key, language: restored.language, version: restored.version, status: restored.status, content: parseStoredPage(restored, restored.page_key, restored.language) });
  });

  app.put("/api/website-content/:pageKey", auth, admin, (req, res) => {
    const pageKey = String(req.params.pageKey || "");
    const language = String(req.body?.language || "");
    if (!PAGE_KEYS.has(pageKey) || !LANGUAGES.has(language) || !fallbackPage(pageKey, language)) return res.status(404).json({ error: "WEBSITE_PAGE_NOT_FOUND" });
    let content;
    try {
      const validated = validateDocument(pageKey, language, req.body?.content);
      content = validated.content;
      const serialized = validated.serialized;
      const before = pageResponse(pageKey, language);
      const version = createVersion(pageKey, language, serialized, req.user.id, "DRAFT");
      const after = publishVersion(version, req.user.id);
      audit(req, "PUBLISH_WEBSITE_CONTENT", "website", `${pageKey}:${language}`, before, after, 1, "Website content saved and published atomically");
      res.json(after);
    } catch (error) {
      res.status(400).json({ error: String(error.message || "INVALID_WEBSITE_CONTENT").slice(0, 120) });
    }
  });

  app.post("/api/website-content/image", auth, admin, uploadImage, (req, res) => {
    if (!req.file) return res.status(400).json({ error: "WEBSITE_IMAGE_REQUIRED" });
    const details = inspectImageFile(req.file.path);
    if (!details || details.width < 600 || details.height < 400) {
      try { fs.unlinkSync(req.file.path); } catch (_error) {}
      return res.status(400).json({ error: details ? "WEBSITE_IMAGE_TOO_SMALL" : "INVALID_WEBSITE_IMAGE" });
    }
    const imageUrl = `/uploads/website/${path.basename(req.file.path)}`;
    audit(req, "UPLOAD_WEBSITE_IMAGE", "website", path.basename(req.file.path), null, { image_url: imageUrl, ...details }, 1, "Website design image uploaded");
    res.status(201).json({ image_url: imageUrl, absolute_url: `${String(options.erpBaseUrl || "").replace(/\/$/, "")}${imageUrl}`, ...details });
  });
}

module.exports = {
  PAGE_KEYS,
  PAGE_ROUTE_SETTINGS_KEY,
  WEBSITE_DESIGN_SETTINGS_KEY,
  fallbackPage,
  defaultPageRoutes,
  defaultWebsiteDesignSettings,
  normalizeLanguage,
  normalizeRoute,
  parsePageRoutes,
  parseDesignSettings,
  parseStoredPage,
  registerWebsiteContentRoutes,
  sanitizeContent
};
