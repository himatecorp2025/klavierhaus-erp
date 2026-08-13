"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { inspectImageFile } = require("./upload-middleware");
const { pages, routeDefinitions, globalCopy } = require("../website/server/site-content");

const LANGUAGES = new Set(["en", "hu"]);
const PAGE_KEYS = new Set(["global", ...Object.keys(routeDefinitions)]);
const MAX_DOCUMENT_BYTES = 300000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLanguage(value) {
  return value === "hu" ? "hu" : "en";
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
    return parsed && typeof parsed === "object" ? parsed : fallbackPage(pageKey, language);
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

  app.get("/api/public/website-content/:pageKey", (req, res) => {
    const pageKey = String(req.params.pageKey || "");
    const language = normalizeLanguage(req.query.lang);
    if (!PAGE_KEYS.has(pageKey) || !fallbackPage(pageKey, language)) return res.status(404).json({ error: "WEBSITE_PAGE_NOT_FOUND" });
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate, stale-while-revalidate=60");
    res.json(pageResponse(pageKey, language));
  });

  app.get("/api/website-content/pages", auth, admin, (_req, res) => {
    res.json({
      website_base_url: websiteBaseUrl,
      pages: [...PAGE_KEYS].filter((pageKey) => fallbackPage(pageKey, "en") || fallbackPage(pageKey, "hu")).map((pageKey) => ({
        page_key: pageKey,
        routes: routeDefinitions[pageKey] || { en: "/", hu: "/hu/" },
        title_en: pageKey === "global" ? "Global navigation & footer" : (fallbackPage(pageKey, "en")?.seo?.title || pageKey),
        title_hu: pageKey === "global" ? "Globális navigáció és lábléc" : (fallbackPage(pageKey, "hu")?.seo?.title || pageKey)
      }))
    });
  });

  app.get("/api/website-content/:pageKey", auth, admin, (req, res) => {
    const pageKey = String(req.params.pageKey || "");
    const language = normalizeLanguage(req.query.lang);
    if (!PAGE_KEYS.has(pageKey) || !fallbackPage(pageKey, language)) return res.status(404).json({ error: "WEBSITE_PAGE_NOT_FOUND" });
    res.setHeader("Cache-Control", "no-store");
    res.json(pageResponse(pageKey, language));
  });

  app.put("/api/website-content/:pageKey", auth, admin, (req, res) => {
    const pageKey = String(req.params.pageKey || "");
    const language = String(req.body?.language || "");
    if (!PAGE_KEYS.has(pageKey) || !LANGUAGES.has(language) || !fallbackPage(pageKey, language)) return res.status(404).json({ error: "WEBSITE_PAGE_NOT_FOUND" });
    let content;
    try {
      content = sanitizeContent(req.body?.content);
      if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("INVALID_WEBSITE_CONTENT");
      if (pageKey === "global") {
        if (!Array.isArray(content.nav) || !content.footerStatement) throw new Error("WEBSITE_REQUIRED_CONTENT");
      } else if (!content.seo?.title || !content.seo?.description || !content.hero?.title) throw new Error("WEBSITE_REQUIRED_CONTENT");
      const serialized = JSON.stringify(content);
      if (Buffer.byteLength(serialized, "utf8") > MAX_DOCUMENT_BYTES) throw new Error("WEBSITE_CONTENT_TOO_LARGE");
      const before = pageResponse(pageKey, language);
      db.prepare(`INSERT INTO website_content_pages(page_key,language,content_json,version,updated_by_user_id,published_at,updated_at)
        VALUES(?,?,?,1,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(page_key,language) DO UPDATE SET content_json=excluded.content_json,version=website_content_pages.version+1,updated_by_user_id=excluded.updated_by_user_id,published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
        .run(pageKey, language, serialized, req.user.id);
      const after = pageResponse(pageKey, language);
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
  fallbackPage,
  normalizeLanguage,
  parseStoredPage,
  registerWebsiteContentRoutes,
  sanitizeContent
};
