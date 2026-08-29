"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { inspectImageFile } = require("./upload-middleware");
const { normalizeEventTimes, slugify } = require("./events");
const { SAMPLE_VERSION_KEY, installSampleContent } = require("./sample-content");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDERS = new Set(["GA4", "SEARCH_CONSOLE", "GOOGLE_OAUTH", "CLARITY"]);
const LEAD_STATUSES = new Set(["NEW", "CONTACTED", "IN_DISCUSSION", "APPOINTMENT_SCHEDULED", "CLOSED", "REJECTED"]);

function clean(value, max = 20000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function identifier(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function flag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback ? 1 : 0;
  return [true, 1, "1", "true", "yes", "on"].includes(value) ? 1 : 0;
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ""); } catch (_error) { return fallback; }
}

function normalizeGallery(value, maxItems = 12) {
  const source = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(source)) return [];
  return source.slice(0, maxItems).map((item) => {
    const entry = typeof item === "string" ? { url: item } : (item && typeof item === "object" ? item : {});
    const url = clean(entry.url || entry.image_url, 1000);
    if (!url || (!/^https?:\/\//i.test(url) && !url.startsWith("/"))) return null;
    return { url, alt_en: clean(entry.alt_en, 500), alt_hu: clean(entry.alt_hu, 500) };
  }).filter(Boolean);
}

function localizedGallery(value, language, fallbackAlt) {
  return normalizeGallery(value).map((item) => ({ url: item.url, alt: item[language === "hu" ? "alt_hu" : "alt_en"] || fallbackAlt }));
}

function absoluteAsset(value, erpBaseUrl) {
  const src = clean(value, 1000);
  return src.startsWith("/uploads/") && erpBaseUrl ? `${erpBaseUrl}${src}` : src;
}

function uniqueSlug(db, table, column, value, excludeId = "") {
  const base = slugify(value);
  let result = base;
  let sequence = 2;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=? AND id<>?`).get(result, excludeId)) result = `${base}-${sequence++}`;
  return result;
}

function localizedArtist(row, language, baseUrl) {
  const lang = language === "hu" ? "hu" : "en";
  return {
    id: row.id,
    slug: row[`slug_${lang}`],
    alternate_slug: row[`slug_${lang === "hu" ? "en" : "hu"}`],
    name: row.name,
    role: row[`role_${lang}`] || "",
    biography: row[`biography_${lang}`] || "",
    portrait_url: absoluteAsset(row.portrait_url, baseUrl),
    portrait_alt: row[`portrait_alt_${lang}`] || row.name,
    gallery: localizedGallery(row.gallery_json, lang, row.name),
    featured: Number(row.featured) === 1
  };
}

function createCipher(secret) {
  const key = crypto.createHash("sha256").update(String(secret || "")).digest();
  return {
    encrypt(value) {
      if (!value) return null;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const payload = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
      return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${payload.toString("base64url")}`;
    },
    decrypt(value) {
      if (!value) return "";
      const [version, iv, tag, payload] = String(value).split(".");
      if (version !== "v1" || !iv || !tag || !payload) throw new Error("INVALID_ENCRYPTED_INTEGRATION_SECRET");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
    }
  };
}

function registerWebsitePlatformRoutes(options) {
  const {
    app, db, auth, permit, requireSuperadmin, audit, websiteImageUpload, websiteImageDir,
    erpBaseUrl = "", websiteBaseUrl = "", transactionalEmail, env = process.env
  } = options;
  const admin = permit("ADMIN");
  const baseUrl = String(erpBaseUrl || "").replace(/\/$/, "");
  const publicWebsiteUrl = String(websiteBaseUrl || "").replace(/\/$/, "");
  const sampleAsset = (fileName) => `${publicWebsiteUrl}/assets/media/${fileName}`;
  const upload = websiteImageUpload.single("website_image");
  const deviceSecret = clean(env.WEBSITE_DEVICE_SECRET || env.JWT_SECRET);
  const cipher = createCipher(env.MARKETING_TOKEN_ENCRYPTION_KEY || env.GOOGLE_TOKEN_ENCRYPTION_KEY || env.JWT_SECRET);
  const recentRequests = new Map();

  function rateLimited(key, limit = 8, windowMs = 60000) {
    const now = Date.now();
    const values = (recentRequests.get(key) || []).filter((time) => now - time < windowMs);
    values.push(now);
    recentRequests.set(key, values);
    return values.length > limit;
  }

  function sendError(res, error, fallback = "WEBSITE_OPERATION_FAILED") {
    const code = clean(error?.message || fallback, 120) || fallback;
    const status = Number(error?.status || (code.includes("NOT_FOUND") ? 404 : code.includes("DUPLICATE") ? 409 : 400));
    res.status(status).json({ error: code });
  }

  app.get("/api/public/website-artists", (req, res) => {
    const language = req.query.lang === "hu" ? "hu" : "en";
    const rows = db.prepare("SELECT * FROM website_artists WHERE published=1 ORDER BY featured DESC,sort_order,created_at").all();
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json(rows.map((row) => localizedArtist(row, language, baseUrl)));
  });

  app.get("/api/public/website-artists/:slug", (req, res) => {
    const language = req.query.lang === "hu" ? "hu" : "en";
    const column = language === "hu" ? "slug_hu" : "slug_en";
    const row = db.prepare(`SELECT * FROM website_artists WHERE ${column}=? AND published=1`).get(req.params.slug);
    if (!row) return res.status(404).json({ error: "WEBSITE_ARTIST_NOT_FOUND" });
    const events = db.prepare(`SELECT id,slug_en,slug_hu,title_en,title_hu,start_at,status FROM events
      WHERE (artist_id=? OR (artist_id IS NULL AND performer_name=?)) AND published_at IS NOT NULL ORDER BY start_at`).all(row.id, row.name);
    res.json({ ...localizedArtist(row, language, baseUrl), events: events.map((event) => ({ id: event.id, slug: event[`slug_${language}`], title: event[`title_${language}`], start_at: event.start_at, status: event.status })) });
  });

  app.get("/api/website-artists", auth, admin, (_req, res) => res.json(db.prepare("SELECT * FROM website_artists ORDER BY sort_order,created_at").all()));

  app.post("/api/website-artists", auth, admin, (req, res) => {
    const body = req.body || {};
    const name = clean(body.name, 200);
    const portrait = clean(body.portrait_url, 1000);
    if (!name || !portrait) return res.status(400).json({ error: "ARTIST_NAME_AND_IMAGE_REQUIRED" });
    const value = {
      id: identifier("WART"), name,
      slug_en: uniqueSlug(db, "website_artists", "slug_en", body.slug_en || name),
      slug_hu: uniqueSlug(db, "website_artists", "slug_hu", body.slug_hu || name),
      role_en: clean(body.role_en, 500), role_hu: clean(body.role_hu, 500),
      biography_en: clean(body.biography_en), biography_hu: clean(body.biography_hu),
      portrait_url: portrait, portrait_alt_en: clean(body.portrait_alt_en, 500), portrait_alt_hu: clean(body.portrait_alt_hu, 500),
      gallery_json: JSON.stringify(normalizeGallery(body.gallery ?? body.gallery_json)),
      featured: flag(body.featured), published: flag(body.published, true), sort_order: Number(body.sort_order || 0), user_id: req.user.id
    };
    db.prepare(`INSERT INTO website_artists(id,slug_en,slug_hu,name,role_en,role_hu,biography_en,biography_hu,portrait_url,portrait_alt_en,portrait_alt_hu,gallery_json,featured,published,sort_order,created_by_user_id,updated_by_user_id)
      VALUES(@id,@slug_en,@slug_hu,@name,@role_en,@role_hu,@biography_en,@biography_hu,@portrait_url,@portrait_alt_en,@portrait_alt_hu,@gallery_json,@featured,@published,@sort_order,@user_id,@user_id)`).run(value);
    const row = db.prepare("SELECT * FROM website_artists WHERE id=?").get(value.id);
    audit(req, "CREATE", "website_artists", row.id, null, row, 1, "Public artist created");
    res.status(201).json(row);
  });

  app.put("/api/website-artists/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM website_artists WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "WEBSITE_ARTIST_NOT_FOUND" });
    const body = { ...before, ...(req.body || {}) };
    if (!clean(body.name) || !clean(body.portrait_url)) return res.status(400).json({ error: "ARTIST_NAME_AND_IMAGE_REQUIRED" });
    const slugEn = before.name === body.name ? before.slug_en : uniqueSlug(db, "website_artists", "slug_en", body.name, before.id);
    const slugHu = before.name === body.name ? before.slug_hu : uniqueSlug(db, "website_artists", "slug_hu", body.name, before.id);
    db.prepare(`UPDATE website_artists SET slug_en=?,slug_hu=?,name=?,role_en=?,role_hu=?,biography_en=?,biography_hu=?,portrait_url=?,portrait_alt_en=?,portrait_alt_hu=?,gallery_json=?,featured=?,published=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(slugEn, slugHu, clean(body.name, 200), clean(body.role_en, 500), clean(body.role_hu, 500), clean(body.biography_en), clean(body.biography_hu), clean(body.portrait_url, 1000), clean(body.portrait_alt_en, 500), clean(body.portrait_alt_hu, 500), JSON.stringify(normalizeGallery(body.gallery ?? body.gallery_json)), flag(body.featured), flag(body.published, true), Number(body.sort_order || 0), req.user.id, before.id);
    const after = db.prepare("SELECT * FROM website_artists WHERE id=?").get(before.id);
    audit(req, "UPDATE", "website_artists", before.id, before, after, 1, "Public artist updated");
    res.json(after);
  });

  app.delete("/api/website-artists/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM website_artists WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "WEBSITE_ARTIST_NOT_FOUND" });
    db.prepare("DELETE FROM website_artists WHERE id=?").run(before.id);
    audit(req, "DELETE", "website_artists", before.id, before, null, 1, "Public artist deleted");
    res.json({ ok: true });
  });

  app.get("/api/website-media", auth, admin, (_req, res) => res.json(db.prepare("SELECT * FROM website_media ORDER BY created_at DESC").all()));
  app.post("/api/website-media", auth, admin, upload, (req, res) => {
    if (!req.file) return res.status(400).json({ error: "WEBSITE_IMAGE_REQUIRED" });
    const details = inspectImageFile(req.file.path);
    if (!details || details.width < 600 || details.height < 400) {
      try { fs.unlinkSync(req.file.path); } catch (_error) {}
      return res.status(400).json({ error: details ? "WEBSITE_IMAGE_TOO_SMALL" : "INVALID_WEBSITE_IMAGE" });
    }
    const row = {
      id: identifier("WMED"), file_url: `/uploads/website/${path.basename(req.file.path)}`, file_name: clean(req.file.originalname, 500),
      mime_type: details.type, width: details.width, height: details.height, file_size: Number(req.file.size || 0),
      alt_en: clean(req.body?.alt_en, 500), alt_hu: clean(req.body?.alt_hu, 500), usage_type: clean(req.body?.usage_type || "GENERAL", 60).toUpperCase(), user_id: req.user.id
    };
    db.prepare(`INSERT INTO website_media(id,file_url,file_name,mime_type,width,height,file_size,alt_en,alt_hu,usage_type,created_by_user_id)
      VALUES(@id,@file_url,@file_name,@mime_type,@width,@height,@file_size,@alt_en,@alt_hu,@usage_type,@user_id)`).run(row);
    audit(req, "UPLOAD", "website_media", row.id, null, row, 1, "Website media uploaded");
    res.status(201).json({ ...row, absolute_url: `${baseUrl}${row.file_url}` });
  });
  app.put("/api/website-media/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM website_media WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "WEBSITE_MEDIA_NOT_FOUND" });
    db.prepare("UPDATE website_media SET alt_en=?,alt_hu=?,usage_type=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(clean(req.body?.alt_en, 500), clean(req.body?.alt_hu, 500), clean(req.body?.usage_type || before.usage_type, 60).toUpperCase(), before.id);
    res.json(db.prepare("SELECT * FROM website_media WHERE id=?").get(before.id));
  });
  app.delete("/api/website-media/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM website_media WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "WEBSITE_MEDIA_NOT_FOUND" });
    const fileName = path.basename(clean(before.file_url, 1000));
    const diskPath = path.resolve(websiteImageDir, fileName);
    const safeRoot = `${path.resolve(websiteImageDir)}${path.sep}`;
    if (!diskPath.startsWith(safeRoot)) return res.status(400).json({ error: "INVALID_WEBSITE_MEDIA_PATH" });
    try { fs.unlinkSync(diskPath); } catch (error) { if (error.code !== "ENOENT") return sendError(res, error, "WEBSITE_MEDIA_FILE_DELETE_FAILED"); }
    db.prepare("DELETE FROM website_media WHERE id=?").run(before.id);
    audit(req, "DELETE", "website_media", before.id, before, null, 1, "Website media deleted");
    res.json({ ok: true });
  });

  app.post("/api/public/contact-leads", (req, res) => {
    const ipKey = clean(req.ip || req.socket?.remoteAddress, 120);
    if (rateLimited(`lead:${ipKey}`, 5, 10 * 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    const body = req.body || {};
    const name = clean(body.name, 200); const email = clean(body.email, 320).toLowerCase();
    if (!name || !EMAIL_PATTERN.test(email) || !flag(body.consent_contact)) return res.status(400).json({ error: "VALID_CONTACT_AND_CONSENT_REQUIRED" });
    const serviceId = clean(body.service_id, 120) || null;
    const phone = clean(body.phone, 80);
    const serviceAddress = clean(body.service_address, 1000);
    if (serviceId) {
      const service = db.prepare("SELECT slug_en,slug_hu,title_en,title_hu FROM website_services WHERE id=? AND visible=1").get(serviceId);
      if (!service) return res.status(400).json({ error: "WEBSITE_SERVICE_NOT_AVAILABLE" });
      if (!phone || !serviceAddress || !clean(body.preferred_time, 240)) return res.status(400).json({ error: "SERVICE_PHONE_ADDRESS_AND_TIME_REQUIRED" });
      const concertService = /concert|koncert/i.test(`${service.slug_en} ${service.slug_hu} ${service.title_en} ${service.title_hu}`);
      if (concertService && [body.event_date, body.event_venue, body.instrument_requirements, body.rental_duration].some((value) => !clean(value, 3000))) {
        return res.status(400).json({ error: "CONCERT_SERVICE_DETAILS_REQUIRED" });
      }
    }
    const row = {
      id: identifier("LEAD"), lead_type: clean(body.lead_type || "SERVICE_CALLBACK", 40).toUpperCase(), name, email,
      phone, service_id: serviceId, message: clean(body.message, 5000),
      piano_brand: clean(body.piano_brand, 160), piano_model: clean(body.piano_model, 160),
      service_address: serviceAddress, preferred_time: clean(body.preferred_time, 240),
      event_date: clean(body.event_date, 80), event_venue: clean(body.event_venue, 1000),
      instrument_requirements: clean(body.instrument_requirements, 3000),
      rental_duration: clean(body.rental_duration, 300),
      preferred_contact: ["EMAIL", "PHONE", "EITHER"].includes(clean(body.preferred_contact, 20).toUpperCase()) ? clean(body.preferred_contact, 20).toUpperCase() : "EMAIL",
      language: body.language === "hu" ? "hu" : "en", consent_contact: 1, consent_marketing: flag(body.consent_marketing),
      source_path: clean(body.source_path, 1000), utm_source: clean(body.utm_source, 500), utm_medium: clean(body.utm_medium, 500), utm_campaign: clean(body.utm_campaign, 500)
    };
    db.prepare(`INSERT INTO website_contact_leads(id,lead_type,name,email,phone,service_id,piano_brand,piano_model,service_address,preferred_time,event_date,event_venue,instrument_requirements,rental_duration,message,preferred_contact,language,consent_contact,consent_marketing,source_path,utm_source,utm_medium,utm_campaign)
      VALUES(@id,@lead_type,@name,@email,@phone,@service_id,@piano_brand,@piano_model,@service_address,@preferred_time,@event_date,@event_venue,@instrument_requirements,@rental_duration,@message,@preferred_contact,@language,@consent_contact,@consent_marketing,@source_path,@utm_source,@utm_medium,@utm_campaign)`).run(row);
    res.status(201).json({ ok: true, id: row.id });
  });
  app.get("/api/website-contact-leads", auth, admin, (req, res) => {
    const status = clean(req.query.status, 20).toUpperCase();
    res.json(status && LEAD_STATUSES.has(status) ? db.prepare("SELECT * FROM website_contact_leads WHERE status=? ORDER BY created_at DESC").all(status) : db.prepare("SELECT * FROM website_contact_leads ORDER BY created_at DESC").all());
  });
  app.put("/api/website-contact-leads/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM website_contact_leads WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "WEBSITE_LEAD_NOT_FOUND" });
    const status = clean(req.body?.status || before.status, 40).toUpperCase();
    if (!LEAD_STATUSES.has(status)) return res.status(400).json({ error: "INVALID_LEAD_STATUS" });
    const assignee = clean(req.body?.assigned_user_id, 120) || null;
    if (assignee && !db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assignee)) return res.status(400).json({ error: "INVALID_LEAD_ASSIGNEE" });
    const contactDate = clean(req.body?.contact_date, 40) || null;
    const appointment = clean(req.body?.agreed_appointment_at, 40) || null;
    if (contactDate && Number.isNaN(new Date(contactDate).getTime())) return res.status(400).json({ error: "INVALID_LEAD_CONTACT_DATE" });
    if (appointment && Number.isNaN(new Date(appointment).getTime())) return res.status(400).json({ error: "INVALID_LEAD_APPOINTMENT" });
    if (status === "APPOINTMENT_SCHEDULED" && !appointment) return res.status(400).json({ error: "LEAD_APPOINTMENT_REQUIRED" });
    db.prepare("UPDATE website_contact_leads SET status=?,assigned_user_id=?,internal_notes=?,contact_date=?,agreed_appointment_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(status, assignee, clean(req.body?.internal_notes, 10000), contactDate, appointment, before.id);
    const after = db.prepare("SELECT * FROM website_contact_leads WHERE id=?").get(before.id);
    audit(req, "UPDATE", "website_leads", before.id, before, after, 1, "Website lead updated");
    res.json(after);
  });

  app.get("/api/public/device-token", (req, res) => {
    const nonce = crypto.randomBytes(24).toString("base64url");
    const signature = crypto.createHmac("sha256", deviceSecret).update(nonce).digest("base64url");
    res.setHeader("Cache-Control", "no-store");
    res.json({ device_token: `${nonce}.${signature}` });
  });

  function deviceHash(value) {
    const [nonce, signature] = clean(value, 300).split(".");
    if (!nonce || !signature) return "";
    const expected = crypto.createHmac("sha256", deviceSecret).update(nonce).digest("base64url");
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return "";
    return crypto.createHmac("sha256", deviceSecret).update(`repeat:${nonce}`).digest("hex");
  }

  app.post("/api/public/events/:eventId/repeat-interest", async (req, res) => {
    const event = db.prepare("SELECT id,status,end_at,sold_out_at,title_en,title_hu,slug_en,slug_hu FROM events WHERE id=? AND published_at IS NOT NULL").get(req.params.eventId);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    if (!event.sold_out_at && new Date(event.end_at).getTime() > Date.now() && !["COMPLETED", "CLOSED"].includes(event.status)) return res.status(409).json({ error: "EVENT_INTEREST_NOT_AVAILABLE" });
    const email = clean(req.body?.email, 320).toLowerCase(); const hash = deviceHash(req.body?.device_token);
    if (!EMAIL_PATTERN.test(email) || !hash || !flag(req.body?.notify_event)) return res.status(400).json({ error: "VALID_EMAIL_DEVICE_AND_CONSENT_REQUIRED" });
    if (rateLimited(`repeat:${hash}`, 5, 60 * 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    try {
      const row = { id: identifier("EREQ"), event_id: event.id, email_normalized: email, device_hash: hash, language: req.body?.language === "hu" ? "hu" : "en", notify_event: 1, marketing_consent: flag(req.body?.marketing_consent), source_path: clean(req.body?.source_path, 1000) };
      db.prepare(`INSERT INTO event_repeat_requests(id,event_id,email_normalized,device_hash,language,notify_event,marketing_consent,source_path)
        VALUES(@id,@event_id,@email_normalized,@device_hash,@language,@notify_event,@marketing_consent,@source_path)`).run(row);
      let delivery = "NOT_CONFIGURED";
      if (transactionalEmail?.configured && transactionalEmail?.sendEventInterestConfirmation) {
        try {
          await transactionalEmail.sendEventInterestConfirmation({ to: email, event, language: row.language, websiteBaseUrl, idempotencyKey: `event-interest-${row.id}` });
          delivery = "SENT";
        } catch (_error) { delivery = "FAILED"; }
      }
      res.status(201).json({ ok: true, delivery });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "REPEAT_INTEREST_ALREADY_RECORDED" });
      sendError(res, error);
    }
  });

  app.get("/api/event-repeat-interest", auth, admin, (_req, res) => {
    res.json(db.prepare(`SELECT e.id AS event_id,e.title_en,e.title_hu,e.start_at,e.published_at,e.sold_out_at,COUNT(r.id) AS request_count,
      CASE WHEN e.published_at IS NOT NULL AND e.sold_out_at IS NOT NULL THEN ROUND((julianday(e.sold_out_at)-julianday(e.published_at))*24,2) ELSE NULL END AS hours_to_sell_out,
      COUNT(DISTINCT r.email_normalized) AS unique_emails,MIN(r.created_at) AS first_request_at,MAX(r.created_at) AS latest_request_at
      FROM events e LEFT JOIN event_repeat_requests r ON r.event_id=e.id GROUP BY e.id HAVING COUNT(r.id)>0 ORDER BY request_count DESC,e.start_at DESC`).all());
  });
  app.get("/api/event-repeat-interest/:eventId.csv", auth, admin, (req, res) => {
    const rows = db.prepare("SELECT email_normalized,language,marketing_consent,created_at FROM event_repeat_requests WHERE event_id=? ORDER BY created_at").all(req.params.eventId);
    const csv = ["email,language,marketing_consent,created_at", ...rows.map((row) => [row.email_normalized, row.language, row.marketing_consent, row.created_at].map((value) => `\"${String(value).replaceAll('"', '""')}\"`).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename=event-interest-${clean(req.params.eventId, 80)}.csv`); res.send(`\ufeff${csv}`);
  });

  app.post("/api/events/:eventId/relaunch", auth, admin, (req, res) => {
    const source = db.prepare("SELECT * FROM events WHERE id=?").get(req.params.eventId);
    if (!source) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    const times = normalizeEventTimes(req.body?.start_local || req.body?.start_at, req.body?.end_local || req.body?.end_at);
    if (times.error) return res.status(400).json({ error: times.error });
    const id = identifier("EVT");
    const value = {
      id, event_key: `EV-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`, category_id: source.category_id, access_type: source.access_type,
      slug_en: uniqueSlug(db, "events", "slug_en", `${source.title_en}-new-date`), slug_hu: uniqueSlug(db, "events", "slug_hu", `${source.title_hu}-uj-idopont`),
      title_en: source.title_en, title_hu: source.title_hu, short_description_en: source.short_description_en, short_description_hu: source.short_description_hu,
      description_en: source.description_en, description_hu: source.description_hu, artist_id: source.artist_id, performer_name: source.performer_name, hero_image_url: source.hero_image_url,
      hero_image_alt_en: source.hero_image_alt_en, hero_image_alt_hu: source.hero_image_alt_hu, gallery_json: source.gallery_json || "[]", venue_name: source.venue_name,
      venue_street: source.venue_street, venue_city: source.venue_city, venue_region: source.venue_region, venue_postal_code: source.venue_postal_code,
      venue_country: source.venue_country, timezone: source.timezone, start_at: times.startAt, end_at: times.endAt, capacity_total: source.capacity_total,
      price_cents: source.price_cents, currency: source.currency, refund_policy_version: source.refund_policy_version, user_id: req.user.id
    };
    db.prepare(`INSERT INTO events(id,event_key,category_id,access_type,status,slug_en,slug_hu,title_en,title_hu,short_description_en,short_description_hu,description_en,description_hu,artist_id,performer_name,hero_image_url,hero_image_alt_en,hero_image_alt_hu,gallery_json,venue_name,venue_street,venue_city,venue_region,venue_postal_code,venue_country,timezone,start_at,end_at,capacity_total,price_cents,currency,refund_policy_version,relaunch_source_event_id,created_by_user_id,updated_by_user_id)
      VALUES(@id,@event_key,@category_id,@access_type,'DRAFT',@slug_en,@slug_hu,@title_en,@title_hu,@short_description_en,@short_description_hu,@description_en,@description_hu,@artist_id,@performer_name,@hero_image_url,@hero_image_alt_en,@hero_image_alt_hu,@gallery_json,@venue_name,@venue_street,@venue_city,@venue_region,@venue_postal_code,@venue_country,@timezone,@start_at,@end_at,@capacity_total,@price_cents,@currency,@refund_policy_version,@source_event_id,@user_id,@user_id)`).run({ ...value, source_event_id: source.id });
    const created = db.prepare("SELECT * FROM events WHERE id=?").get(id);
    audit(req, "RELAUNCH_DRAFT", "events", id, { source_event_id: source.id }, created, 1, "New event draft created from audience demand");
    res.status(201).json(created);
  });

  app.post("/api/events/:eventId/notify-interest", auth, admin, async (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id=? AND relaunch_source_event_id=? AND published_at IS NOT NULL AND status IN ('PUBLISHED','RESCHEDULED')").get(req.body?.new_event_id, req.params.eventId);
    if (!event) return res.status(409).json({ error: "PUBLISHED_RELAUNCH_EVENT_REQUIRED" });
    const requests = db.prepare("SELECT * FROM event_repeat_requests WHERE event_id=? AND notify_event=1 AND notified_at IS NULL ORDER BY created_at").all(req.params.eventId);
    let sent = 0; let failed = 0;
    for (const request of requests) {
      let status = "NOT_CONFIGURED";
      try {
        if (transactionalEmail?.configured && transactionalEmail?.sendEventReturnAnnouncement) {
          await transactionalEmail.sendEventReturnAnnouncement({ to: request.email_normalized, event, language: request.language, websiteBaseUrl, idempotencyKey: `event-return-${request.id}-${event.id}` });
          status = "SENT"; sent += 1;
        } else failed += 1;
      } catch (_error) { status = "FAILED"; failed += 1; }
      db.prepare("UPDATE event_repeat_requests SET notified_at=CASE WHEN ?='SENT' THEN CURRENT_TIMESTAMP ELSE notified_at END,notification_event_id=?,delivery_status=? WHERE id=?").run(status, event.id, status, request.id);
    }
    audit(req, "NOTIFY_INTEREST", "events", req.params.eventId, null, { new_event_id: event.id, requested: requests.length, sent, failed }, 1, "Audience relaunch notification completed");
    res.json({ requested: requests.length, sent, failed });
  });

  app.post("/api/public/tracking-events", (req, res) => {
    if (!flag(req.body?.analytics_consent)) return res.status(204).end();
    const token = deviceHash(req.body?.device_token);
    if (!token) return res.status(400).json({ error: "INVALID_DEVICE_TOKEN" });
    if (rateLimited(`track:${token}`, 60, 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
    db.prepare(`INSERT INTO website_tracking_events(id,event_name,anonymous_session_hash,source_path,language,event_id,metadata_json,analytics_consent,marketing_consent)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(identifier("MTRK"), clean(req.body?.event_name, 120), token, clean(req.body?.source_path, 1000), req.body?.language === "hu" ? "hu" : "en", clean(req.body?.event_id, 120) || null, JSON.stringify(metadata).slice(0, 10000), 1, flag(req.body?.marketing_consent));
    res.status(201).json({ ok: true });
  });

  app.get("/api/public/tracking-config", (_req, res) => {
    const rows = db.prepare("SELECT provider,status,public_config_json FROM website_integration_settings WHERE provider IN ('GA4','CLARITY') AND status IN ('CONFIGURED','CONNECTED')").all();
    const output = { ga4_measurement_id: "", clarity_project_id: "" };
    for (const row of rows) {
      const config = parseJson(row.public_config_json);
      if (row.provider === "GA4" && /^G-[A-Z0-9]{4,20}$/i.test(clean(config.measurement_id))) output.ga4_measurement_id = clean(config.measurement_id);
      if (row.provider === "CLARITY" && /^[A-Za-z0-9_-]{4,80}$/.test(clean(config.project_id))) output.clarity_project_id = clean(config.project_id);
    }
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json(output);
  });

  app.get("/api/marketing/overview", auth, admin, (_req, res) => {
    const integrations = db.prepare("SELECT provider,status,public_config_json,last_tested_at,last_sync_at,last_error,updated_at FROM website_integration_settings ORDER BY provider").all().map((row) => ({ ...row, public_config: parseJson(row.public_config_json) }));
    const metrics = db.prepare(`SELECT event_name,COUNT(*) AS count,COUNT(DISTINCT anonymous_session_hash) AS unique_sessions FROM website_tracking_events
      WHERE created_at>=datetime('now','-30 days') GROUP BY event_name ORDER BY count DESC`).all();
    const leads = db.prepare("SELECT status,COUNT(*) AS count FROM website_contact_leads GROUP BY status").all();
    const eventInterest = db.prepare("SELECT COUNT(*) AS requests,COUNT(DISTINCT email_normalized) AS unique_emails FROM event_repeat_requests").get();
    res.json({ integrations, metrics, leads, event_interest: eventInterest, note: "Only consented first-party measurements are shown. Disconnected providers never return fabricated data." });
  });

  app.get("/api/marketing/integrations", auth, admin, (_req, res) => res.json(PROVIDERS.size ? [...PROVIDERS].map((provider) => {
    const row = db.prepare("SELECT * FROM website_integration_settings WHERE provider=?").get(provider);
    return row ? { provider, status: row.status, config: parseJson(row.public_config_json), has_secret: Boolean(row.encrypted_secret), last_tested_at: row.last_tested_at, last_sync_at: row.last_sync_at, last_error: row.last_error } : { provider, status: "DISCONNECTED", config: {}, has_secret: false };
  }) : []));

  app.put("/api/marketing/integrations/:provider", auth, requireSuperadmin, (req, res) => {
    const provider = clean(req.params.provider, 40).toUpperCase();
    if (!PROVIDERS.has(provider)) return res.status(404).json({ error: "INTEGRATION_PROVIDER_NOT_FOUND" });
    const config = req.body?.config && typeof req.body.config === "object" ? req.body.config : {};
    const secret = clean(req.body?.secret, 10000);
    db.prepare(`INSERT INTO website_integration_settings(provider,status,public_config_json,encrypted_secret,updated_by_user_id,updated_at)
      VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider) DO UPDATE SET status=excluded.status,public_config_json=excluded.public_config_json,
      encrypted_secret=CASE WHEN excluded.encrypted_secret IS NULL THEN website_integration_settings.encrypted_secret ELSE excluded.encrypted_secret END,updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP`)
      .run(provider, "CONFIGURED", JSON.stringify(config).slice(0, 20000), secret ? cipher.encrypt(secret) : null, req.user.id);
    audit(req, "CONFIGURE", "marketing_integrations", provider, null, { provider, config, has_secret: Boolean(secret) }, 1, "Marketing integration configured; secret omitted from audit");
    res.json({ provider, status: "CONFIGURED", config, has_secret: Boolean(secret || db.prepare("SELECT encrypted_secret FROM website_integration_settings WHERE provider=?").get(provider)?.encrypted_secret) });
  });

  app.post("/api/marketing/integrations/:provider/test", auth, admin, async (req, res) => {
    const provider = clean(req.params.provider, 40).toUpperCase();
    const row = db.prepare("SELECT * FROM website_integration_settings WHERE provider=?").get(provider);
    if (!row) return res.status(404).json({ error: "INTEGRATION_NOT_CONFIGURED" });
    const config = parseJson(row.public_config_json);
    let valid = false;
    if (provider === "GA4") valid = /^G-[A-Z0-9]{4,20}$/i.test(clean(config.measurement_id));
    if (provider === "SEARCH_CONSOLE") valid = /^https?:\/\//.test(clean(config.property_url)) || clean(config.property_url).startsWith("sc-domain:");
    if (provider === "CLARITY") valid = /^[A-Za-z0-9_-]{4,80}$/.test(clean(config.project_id));
    if (provider === "GOOGLE_OAUTH") valid = /\.apps\.googleusercontent\.com$/.test(clean(config.client_id)) && Boolean(row.encrypted_secret);
    const nextStatus = valid ? (row.status === "CONNECTED" ? "CONNECTED" : "CONFIGURED") : "ERROR";
    db.prepare("UPDATE website_integration_settings SET status=?,last_tested_at=CURRENT_TIMESTAMP,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?")
      .run(nextStatus, valid ? null : "INVALID_OR_INCOMPLETE_CONFIGURATION", provider);
    res.status(valid ? 200 : 400).json({ ok: valid, provider, status: nextStatus, live_data: false });
  });
  app.post("/api/marketing/google/connect", auth, requireSuperadmin, (req, res) => {
    const row = db.prepare("SELECT * FROM website_integration_settings WHERE provider='GOOGLE_OAUTH'").get();
    const config = parseJson(row?.public_config_json);
    if (!row || !/\.apps\.googleusercontent\.com$/.test(clean(config.client_id)) || !row.encrypted_secret) return res.status(400).json({ error: "GOOGLE_OAUTH_NOT_CONFIGURED" });
    const rawState = crypto.randomBytes(32).toString("base64url");
    const stateHash = crypto.createHash("sha256").update(rawState).digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare("DELETE FROM website_integration_oauth_states WHERE expires_at<=CURRENT_TIMESTAMP").run();
    db.prepare("INSERT INTO website_integration_oauth_states(state_hash,provider,user_id,expires_at) VALUES(?,'GOOGLE',?,?)").run(stateHash, req.user.id, expiresAt);
    const redirectUri = `${baseUrl}/api/marketing/google/callback`;
    const query = new URLSearchParams({
      client_id: clean(config.client_id), redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent",
      include_granted_scopes: "true", state: rawState,
      scope: "openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly"
    });
    res.json({ authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`, redirect_uri: redirectUri, expires_at: expiresAt });
  });

  app.get("/api/marketing/google/callback", async (req, res) => {
    const stateHash = crypto.createHash("sha256").update(clean(req.query.state, 500)).digest("hex");
    const state = db.prepare("SELECT * FROM website_integration_oauth_states WHERE state_hash=? AND expires_at>CURRENT_TIMESTAMP").get(stateHash);
    if (!state || !clean(req.query.code, 3000)) return res.status(400).send("Google OAuth state expired or invalid.");
    db.prepare("DELETE FROM website_integration_oauth_states WHERE state_hash=?").run(stateHash);
    const row = db.prepare("SELECT * FROM website_integration_settings WHERE provider='GOOGLE_OAUTH'").get();
    const config = parseJson(row?.public_config_json);
    let storedSecret;
    try { storedSecret = cipher.decrypt(row?.encrypted_secret); } catch (_error) { return res.status(400).send("Google OAuth secret cannot be decrypted."); }
    const prior = parseJson(storedSecret, null);
    const clientSecret = typeof prior === "object" && prior?.client_secret ? prior.client_secret : storedSecret;
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: clean(req.query.code, 3000), client_id: clean(config.client_id), client_secret: clientSecret, redirect_uri: `${baseUrl}/api/marketing/google/callback`, grant_type: "authorization_code" }) });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) throw new Error(clean(tokens.error_description || tokens.error || "GOOGLE_TOKEN_EXCHANGE_FAILED", 500));
      tokens.expires_at = Date.now() + Number(tokens.expires_in || 3600) * 1000;
      db.prepare("UPDATE website_integration_settings SET status='CONNECTED',encrypted_secret=?,last_tested_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE provider='GOOGLE_OAUTH'")
        .run(cipher.encrypt(JSON.stringify({ client_secret: clientSecret, tokens })));
      res.redirect(`${baseUrl}/?marketing=google-connected`);
    } catch (error) {
      db.prepare("UPDATE website_integration_settings SET status='ERROR',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE provider='GOOGLE_OAUTH'").run(clean(error.message, 500));
      res.status(502).send("Google OAuth token exchange failed.");
    }
  });

  async function googleAccessToken() {
    const row = db.prepare("SELECT * FROM website_integration_settings WHERE provider='GOOGLE_OAUTH'").get();
    if (!row?.encrypted_secret || row.status !== "CONNECTED") throw new Error("GOOGLE_OAUTH_NOT_CONNECTED");
    const value = parseJson(cipher.decrypt(row.encrypted_secret), null);
    if (!value?.tokens?.access_token) throw new Error("GOOGLE_OAUTH_NOT_CONNECTED");
    if (Number(value.tokens.expires_at || 0) > Date.now() + 60000) return value.tokens.access_token;
    if (!value.tokens.refresh_token) throw new Error("GOOGLE_OAUTH_REFRESH_TOKEN_MISSING");
    const config = parseJson(row.public_config_json);
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clean(config.client_id), client_secret: value.client_secret, refresh_token: value.tokens.refresh_token, grant_type: "refresh_token" }) });
    const refreshed = await response.json();
    if (!response.ok || !refreshed.access_token) throw new Error("GOOGLE_OAUTH_REFRESH_FAILED");
    value.tokens = { ...value.tokens, ...refreshed, expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 };
    db.prepare("UPDATE website_integration_settings SET encrypted_secret=?,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE provider='GOOGLE_OAUTH'").run(cipher.encrypt(JSON.stringify(value)));
    return value.tokens.access_token;
  }

  app.get("/api/marketing/google/resources", auth, admin, async (_req, res) => {
    try {
      const accessToken = await googleAccessToken();
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [sitesResponse, accountsResponse] = await Promise.all([
        fetch("https://www.googleapis.com/webmasters/v3/sites", { headers }),
        fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", { headers })
      ]);
      const sites = sitesResponse.ok ? await sitesResponse.json() : { siteEntry: [] };
      const accounts = accountsResponse.ok ? await accountsResponse.json() : { accountSummaries: [] };
      db.prepare("UPDATE website_integration_settings SET last_sync_at=CURRENT_TIMESTAMP,last_error=NULL WHERE provider='GOOGLE_OAUTH'").run();
      res.json({ search_console_sites: sites.siteEntry || [], analytics_accounts: accounts.accountSummaries || [], live_data: true });
    } catch (error) { res.status(502).json({ error: clean(error.message || "GOOGLE_RESOURCE_SYNC_FAILED", 120) }); }
  });
  app.delete("/api/marketing/integrations/:provider", auth, requireSuperadmin, (req, res) => {
    const provider = clean(req.params.provider, 40).toUpperCase();
    if (!PROVIDERS.has(provider)) return res.status(404).json({ error: "INTEGRATION_PROVIDER_NOT_FOUND" });
    db.prepare("DELETE FROM website_integration_settings WHERE provider=?").run(provider);
    res.json({ ok: true });
  });

  app.get("/api/marketing/campaigns", auth, admin, (_req, res) => res.json(db.prepare("SELECT * FROM marketing_campaigns ORDER BY updated_at DESC").all()));
  app.post("/api/marketing/campaigns", auth, admin, (req, res) => {
    const body = req.body || {};
    if (!clean(body.name) || !clean(body.utm_campaign) || !/^https?:\/\//.test(clean(body.destination_url))) return res.status(400).json({ error: "CAMPAIGN_REQUIRED_FIELDS" });
    const row = { id: identifier("MCMP"), name: clean(body.name, 300), utm_source: clean(body.utm_source, 200), utm_medium: clean(body.utm_medium, 200), utm_campaign: clean(body.utm_campaign, 200), utm_term: clean(body.utm_term, 200), utm_content: clean(body.utm_content, 200), destination_url: clean(body.destination_url, 1500), active: flag(body.active, true), user_id: req.user.id };
    db.prepare(`INSERT INTO marketing_campaigns(id,name,utm_source,utm_medium,utm_campaign,utm_term,utm_content,destination_url,active,created_by_user_id)
      VALUES(@id,@name,@utm_source,@utm_medium,@utm_campaign,@utm_term,@utm_content,@destination_url,@active,@user_id)`).run(row);
    res.status(201).json(db.prepare("SELECT * FROM marketing_campaigns WHERE id=?").get(row.id));
  });
  app.put("/api/marketing/campaigns/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM marketing_campaigns WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "MARKETING_CAMPAIGN_NOT_FOUND" });
    const body = { ...before, ...(req.body || {}) };
    if (!clean(body.name) || !clean(body.utm_campaign) || !/^https?:\/\//.test(clean(body.destination_url))) return res.status(400).json({ error: "CAMPAIGN_REQUIRED_FIELDS" });
    db.prepare(`UPDATE marketing_campaigns SET name=?,utm_source=?,utm_medium=?,utm_campaign=?,utm_term=?,utm_content=?,destination_url=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(clean(body.name, 300), clean(body.utm_source, 200), clean(body.utm_medium, 200), clean(body.utm_campaign, 200), clean(body.utm_term, 200), clean(body.utm_content, 200), clean(body.destination_url, 1500), flag(body.active, true), before.id);
    const after = db.prepare("SELECT * FROM marketing_campaigns WHERE id=?").get(before.id);
    audit(req, "UPDATE", "marketing_campaigns", before.id, before, after, 1, "Marketing campaign updated");
    res.json(after);
  });
  app.delete("/api/marketing/campaigns/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM marketing_campaigns WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "MARKETING_CAMPAIGN_NOT_FOUND" });
    db.prepare("DELETE FROM marketing_campaigns WHERE id=?").run(before.id);
    audit(req, "DELETE", "marketing_campaigns", before.id, before, null, 1, "Marketing campaign deleted");
    res.json({ ok: true });
  });

  app.post("/api/demo-content/install", auth, admin, (req, res) => {
    const sharedInstall = installSampleContent({ db, userId: req.user.id, updatedBy: req.user.name || req.user.id, publicWebsiteUrl });
    if (sharedInstall.alreadyInstalled) return res.status(409).json({ error: "SAMPLE_CONTENT_ALREADY_INSTALLED" });
    audit(req, "INSTALL", "website_sample_content", "v2", null, sharedInstall.installed, 1, "Editable bilingual public sample content installed");
    return res.status(201).json({ ok: true, installed: sharedInstall.installed });
  });

  app.delete("/api/demo-content", auth, requireSuperadmin, (req, res) => {
    const dependencies = db.prepare(`SELECT COUNT(*) AS count FROM event_tickets WHERE event_id LIKE 'SAMPLE-EVENT-%'`).get().count;
    if (Number(dependencies) > 0) return res.status(409).json({ error: "SAMPLE_EVENTS_HAVE_TRANSACTIONAL_DEPENDENCIES" });
    const removed = db.transaction(() => {
      const result = {};
      result.events = db.prepare("DELETE FROM events WHERE is_sample=1").run().changes;
      result.artists = db.prepare("DELETE FROM website_artists WHERE is_sample=1").run().changes;
      result.pianos = db.prepare("DELETE FROM website_showroom_pianos WHERE is_sample=1").run().changes;
      result.services = db.prepare("DELETE FROM website_services WHERE is_sample=1").run().changes;
      result.reviews = db.prepare("DELETE FROM website_reviews WHERE is_sample=1").run().changes;
      db.prepare("DELETE FROM app_settings WHERE setting_key='website_sample_content_v1'").run();
      db.prepare("DELETE FROM app_settings WHERE setting_key=?").run(SAMPLE_VERSION_KEY);
      return result;
    })();
    res.json({ ok: true, removed });
  });
}

module.exports = { registerWebsitePlatformRoutes, localizedArtist, createCipher };
