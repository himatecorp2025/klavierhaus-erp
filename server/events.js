const crypto = require("node:crypto");
const QRCode = require("qrcode");

const EVENT_ACCESS_TYPES = new Set(["PUBLIC_PAID", "PUBLIC_FREE", "INVITE_ONLY", "INTERNAL"]);
const EVENT_STATUSES = new Set(["DRAFT", "PUBLISHED", "RESCHEDULED", "CANCELLED", "COMPLETED", "CLOSED"]);
const PUBLIC_STATUSES = ["PUBLISHED", "RESCHEDULED", "CANCELLED"];
const ACTIVE_TICKET_STATUSES = ["VALID", "USED"];
const REFUND_STATUSES = new Set(["REQUESTED", "APPROVED", "REJECTED", "PROCESSED"]);
const NY_TIME_ZONE = "America/New_York";
const REFUND_WINDOW_MS = 48 * 60 * 60 * 1000;

function cleanText(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function validSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanText(value, 160));
}

function safeJson(value, fallback = []) {
  if (Array.isArray(value)) return JSON.stringify(value);
  try {
    const parsed = JSON.parse(String(value || ""));
    return JSON.stringify(Array.isArray(parsed) ? parsed : fallback);
  } catch (_error) {
    return JSON.stringify(fallback);
  }
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function fingerprint(value) {
  return tokenHash(value).slice(0, 16);
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function formatInTimeZone(date, timeZone = NY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date).reduce((output, part) => {
    output[part.type] = part.value;
    return output;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function localNewYorkToUtc(value) {
  const match = cleanText(value, 40).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const desiredWallClock = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let candidate = desiredWallClock;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const rendered = formatInTimeZone(new Date(candidate));
    const renderedMatch = rendered.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    const renderedWallClock = Date.UTC(
      Number(renderedMatch[1]), Number(renderedMatch[2]) - 1, Number(renderedMatch[3]),
      Number(renderedMatch[4]), Number(renderedMatch[5])
    );
    candidate += desiredWallClock - renderedWallClock;
  }
  const date = new Date(candidate);
  if (formatInTimeZone(date) !== `${year}-${month}-${day}T${hour}:${minute}`) return null;
  return date;
}

function normalizeEventTimes(startValue, endValue) {
  const start = localNewYorkToUtc(startValue);
  const end = localNewYorkToUtc(endValue);
  if (!start || !end) return { error: "INVALID_EVENT_TIME" };
  if (Number(startValue.slice(14, 16)) % 5 !== 0 || Number(endValue.slice(14, 16)) % 5 !== 0) {
    return { error: "INVALID_TIME_STEP" };
  }
  if (end.getTime() <= start.getTime()) return { error: "EVENT_END_MUST_FOLLOW_START" };
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function normalizeOptionalDate(value) {
  if (value === null || value === undefined || String(value).trim() === "") return { value: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: "INVALID_SALES_TIME" };
  return { value: date.toISOString() };
}

function publicEventRow(row, language, capacity) {
  const lang = language === "hu" ? "hu" : "en";
  return {
    id: row.id,
    event_key: row.event_key,
    slug: row[`slug_${lang}`],
    alternate_slug: row[`slug_${lang === "hu" ? "en" : "hu"}`],
    title: row[`title_${lang}`],
    short_description: row[`short_description_${lang}`] || "",
    description: row[`description_${lang}`] || "",
    category: row[`category_name_${lang}`] || "",
    category_code: row.category_code,
    access_type: row.access_type,
    status: row.status,
    performer_name: row.performer_name || "",
    hero_image_url: row.hero_image_url || "",
    gallery: JSON.parse(row.gallery_json || "[]"),
    venue: {
      name: row.venue_name,
      street: row.venue_street,
      city: row.venue_city,
      region: row.venue_region,
      postal_code: row.venue_postal_code,
      country: row.venue_country
    },
    timezone: row.timezone,
    start_at: row.start_at,
    end_at: row.end_at,
    previous_start_at: row.previous_start_at || null,
    start_local: formatInTimeZone(new Date(row.start_at), row.timezone),
    end_local: formatInTimeZone(new Date(row.end_at), row.timezone),
    capacity_total: Number(row.capacity_total),
    capacity_remaining: capacity.remaining,
    sold_out: capacity.remaining <= 0,
    price_cents: Number(row.price_cents || 0),
    currency: row.currency,
    sales_start_at: row.sales_start_at || null,
    sales_end_at: row.sales_end_at || null,
    published_at: row.published_at
  };
}

function createEventService({ db, qrSecret }) {
  const selectEventSql = `SELECT e.*,c.code AS category_code,c.name_en AS category_name_en,c.name_hu AS category_name_hu
    FROM events e JOIN event_categories c ON c.id=e.category_id`;

  function eventById(id) {
    return db.prepare(`${selectEventSql} WHERE e.id=?`).get(id) || null;
  }

  function ticketCounts(eventId) {
    const rows = db.prepare(`SELECT source_type,status,COUNT(*) AS count FROM event_tickets WHERE event_id=? GROUP BY source_type,status`).all(eventId);
    const output = { occupied: 0, valid: 0, used: 0, void: 0, refunded: 0, invitation: 0, complimentary: 0, purchase: 0 };
    for (const row of rows) {
      const count = Number(row.count || 0);
      if (ACTIVE_TICKET_STATUSES.includes(row.status)) output.occupied += count;
      output[String(row.status || "").toLowerCase()] = (output[String(row.status || "").toLowerCase()] || 0) + count;
      const sourceKey = ({ INVITATION: "invitation", COMPLIMENTARY: "complimentary", PURCHASE: "purchase" })[row.source_type];
      if (sourceKey && ACTIVE_TICKET_STATUSES.includes(row.status)) output[sourceKey] += count;
    }
    return output;
  }

  function capacity(eventId) {
    const event = eventById(eventId);
    if (!event) return null;
    const counts = ticketCounts(eventId);
    return { total: Number(event.capacity_total), occupied: counts.occupied, remaining: Math.max(0, Number(event.capacity_total) - counts.occupied), counts };
  }

  function eventResponse(row) {
    const cap = capacity(row.id);
    return {
      ...row,
      gallery: JSON.parse(row.gallery_json || "[]"),
      start_local: formatInTimeZone(new Date(row.start_at), row.timezone),
      end_local: formatInTimeZone(new Date(row.end_at), row.timezone),
      previous_start_local: row.previous_start_at ? formatInTimeZone(new Date(row.previous_start_at), row.timezone) : null,
      capacity: cap,
      gallery_json: undefined,
      closure_snapshot: row.closure_snapshot_json ? JSON.parse(row.closure_snapshot_json) : null,
      closure_snapshot_json: undefined
    };
  }

  function validateEventInput(body, existing = null) {
    const merged = { ...(existing || {}), ...(body || {}) };
    const required = ["category_id", "access_type", "slug_en", "slug_hu", "title_en", "title_hu", "venue_name", "venue_street", "venue_city", "venue_region", "venue_postal_code"];
    if (required.some((field) => !cleanText(merged[field]))) return { error: "REQUIRED_EVENT_FIELDS" };
    if (!EVENT_ACCESS_TYPES.has(merged.access_type)) return { error: "INVALID_EVENT_ACCESS_TYPE" };
    if (!validSlug(merged.slug_en) || !validSlug(merged.slug_hu)) return { error: "INVALID_EVENT_SLUG" };
    const category = db.prepare("SELECT id,active FROM event_categories WHERE id=?").get(merged.category_id);
    if (!category || !Number(category.active)) return { error: "EVENT_CATEGORY_NOT_AVAILABLE" };
    const times = normalizeEventTimes(merged.start_local || merged.start_at, merged.end_local || merged.end_at);
    if (times.error) return times;
    const capacityTotal = Number(merged.capacity_total);
    if (!Number.isInteger(capacityTotal) || capacityTotal <= 0 || capacityTotal > 100000) return { error: "INVALID_EVENT_CAPACITY" };
    const priceCents = Number(merged.price_cents || 0);
    if (!Number.isInteger(priceCents) || priceCents < 0) return { error: "INVALID_EVENT_PRICE" };
    if (merged.access_type !== "PUBLIC_PAID" && priceCents !== 0) return { error: "NON_PAID_EVENT_PRICE_MUST_BE_ZERO" };
    if (existing) {
      const cap = capacity(existing.id);
      if (capacityTotal < cap.occupied) return { error: "CAPACITY_BELOW_OCCUPIED" };
    }
    const salesStart = normalizeOptionalDate(merged.sales_start_at);
    const salesEnd = normalizeOptionalDate(merged.sales_end_at);
    if (salesStart.error || salesEnd.error) return { error: "INVALID_SALES_TIME" };
    if (salesStart.value && salesEnd.value && new Date(salesEnd.value).getTime() <= new Date(salesStart.value).getTime()) return { error: "INVALID_SALES_TIME_RANGE" };
    if (salesEnd.value && new Date(salesEnd.value).getTime() > new Date(times.startAt).getTime()) return { error: "SALES_END_AFTER_EVENT_START" };
    return {
      value: {
        category_id: cleanText(merged.category_id, 100), access_type: merged.access_type,
        slug_en: cleanText(merged.slug_en, 160), slug_hu: cleanText(merged.slug_hu, 160),
        title_en: cleanText(merged.title_en, 300), title_hu: cleanText(merged.title_hu, 300),
        short_description_en: cleanText(merged.short_description_en, 700), short_description_hu: cleanText(merged.short_description_hu, 700),
        description_en: cleanText(merged.description_en, 20000), description_hu: cleanText(merged.description_hu, 20000),
        performer_name: cleanText(merged.performer_name, 300), hero_image_url: cleanText(merged.hero_image_url, 1000),
        gallery_json: safeJson(merged.gallery ?? merged.gallery_json, []), venue_name: cleanText(merged.venue_name, 300),
        venue_street: cleanText(merged.venue_street, 300), venue_city: cleanText(merged.venue_city, 160),
        venue_region: cleanText(merged.venue_region, 100), venue_postal_code: cleanText(merged.venue_postal_code, 40),
        venue_country: cleanText(merged.venue_country || "US", 2).toUpperCase(), timezone: NY_TIME_ZONE,
        start_at: times.startAt, end_at: times.endAt, capacity_total: capacityTotal, price_cents: priceCents,
        currency: "USD", sales_start_at: salesStart.value, sales_end_at: salesEnd.value
      }
    };
  }

  function createTicket({ eventId, invitationId = null, sourceType, buyerName = "", attendeeName, contactEmail, priceCents = 0, userId = null }) {
    const event = eventById(eventId);
    if (!event) throw Object.assign(new Error("EVENT_NOT_FOUND"), { status: 404 });
    if (["CANCELLED", "CLOSED"].includes(event.status)) throw Object.assign(new Error("EVENT_NOT_AVAILABLE"), { status: 409 });
    const cap = capacity(eventId);
    if (cap.remaining < 1) throw Object.assign(new Error("EVENT_SOLD_OUT"), { status: 409 });
    const id = newId("EVTKT");
    const publicCode = crypto.randomBytes(18).toString("base64url");
    db.prepare(`INSERT INTO event_tickets(id,event_id,invitation_id,source_type,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,created_by_user_id)
      VALUES(?,?,?,?,?,?,?,?, 'VALID',?,'USD',?)`).run(id, eventId, invitationId, sourceType, cleanText(buyerName, 200), cleanText(attendeeName, 200), normalizeEmail(contactEmail), publicCode, Number(priceCents || 0), userId);
    return db.prepare("SELECT * FROM event_tickets WHERE id=?").get(id);
  }

  function qrToken(ticket) {
    const body = `KH1.${ticket.public_code}`;
    const signature = crypto.createHmac("sha256", qrSecret).update(body).digest("base64url");
    return `${body}.${signature}`;
  }

  function verifyQrToken(value) {
    const match = cleanText(value, 400).match(/^KH1\.([A-Za-z0-9_-]{20,80})\.([A-Za-z0-9_-]{30,80})$/);
    if (!match) return null;
    const [, publicCode, suppliedSignature] = match;
    const body = `KH1.${publicCode}`;
    const expected = crypto.createHmac("sha256", qrSecret).update(body).digest("base64url");
    if (!timingSafeEqualText(suppliedSignature, expected)) return null;
    return db.prepare("SELECT * FROM event_tickets WHERE public_code=?").get(publicCode) || null;
  }

  function refundEligibility(event, requestedAt = new Date()) {
    if (event.status === "CANCELLED") return { eligible: true, code: "EVENT_CANCELLED" };
    const deadline = new Date(event.start_at).getTime() - REFUND_WINDOW_MS;
    if (requestedAt.getTime() < deadline) return { eligible: true, code: event.status === "RESCHEDULED" ? "RESCHEDULED_BEFORE_48H" : "CUSTOMER_BEFORE_48H" };
    return { eligible: false, code: "WITHIN_48_HOURS" };
  }

  return { selectEventSql, eventById, eventResponse, validateEventInput, capacity, ticketCounts, createTicket, qrToken, verifyQrToken, refundEligibility };
}

function registerEventRoutes(options) {
  const { app, db, auth, permit, requireSuperadmin, audit, transactionalEmail } = options;
  const qrSecret = String(options.qrSecret || "");
  if (qrSecret.length < 32) throw new Error("EVENT_QR_SECRET must be at least 32 characters long");
  const websiteBaseUrl = String(options.websiteBaseUrl || "https://klavierhaus-home.onrender.com").replace(/\/$/, "");
  const erpBaseUrl = String(options.erpBaseUrl || "https://klavierhaus-erp.onrender.com").replace(/\/$/, "");
  const service = createEventService({ db, qrSecret });
  const admin = permit("ADMIN");

  function sendError(res, error, fallback = "EVENT_OPERATION_FAILED") {
    const code = cleanText(error?.message || fallback, 120) || fallback;
    const status = Number(error?.status || ({ EVENT_NOT_FOUND: 404, EVENT_SOLD_OUT: 409, EVENT_ALREADY_CLOSED: 409 }[code] || 400));
    res.status(status).json({ error: code });
  }

  function ensureMutable(event, res) {
    if (!event) { res.status(404).json({ error: "EVENT_NOT_FOUND" }); return false; }
    if (event.status === "CLOSED") { res.status(409).json({ error: "EVENT_ALREADY_CLOSED" }); return false; }
    if (event.status === "CANCELLED") { res.status(409).json({ error: "EVENT_NOT_AVAILABLE" }); return false; }
    return true;
  }

  app.get("/api/public/events", (req, res) => {
    const language = req.query.lang === "hu" ? "hu" : "en";
    const includePast = String(req.query.include_past || "false") === "true";
    const placeholders = PUBLIC_STATUSES.map(() => "?").join(",");
    const rows = db.prepare(`${service.selectEventSql}
      WHERE e.published_at IS NOT NULL AND e.access_type IN ('PUBLIC_PAID','PUBLIC_FREE')
        AND e.status IN (${placeholders}) ${includePast ? "" : "AND e.end_at>=?"}
      ORDER BY e.start_at`).all(...PUBLIC_STATUSES, ...(includePast ? [] : [new Date().toISOString()]));
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json(rows.map((row) => publicEventRow(row, language, service.capacity(row.id))));
  });

  app.get("/api/public/events/:slug", (req, res) => {
    const language = req.query.lang === "hu" ? "hu" : "en";
    const column = language === "hu" ? "slug_hu" : "slug_en";
    const placeholders = PUBLIC_STATUSES.map(() => "?").join(",");
    const row = db.prepare(`${service.selectEventSql} WHERE e.${column}=? AND e.published_at IS NOT NULL
      AND e.access_type IN ('PUBLIC_PAID','PUBLIC_FREE') AND e.status IN (${placeholders})`).get(req.params.slug, ...PUBLIC_STATUSES);
    if (!row) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json(publicEventRow(row, language, service.capacity(row.id)));
  });

  app.get("/api/public/event-invitations/:token", (req, res) => {
    const invitation = db.prepare(`SELECT i.id,i.guest_name,i.language,i.status,e.title_en,e.title_hu,e.start_at,e.end_at,e.venue_name,e.status AS event_status
      FROM event_invitations i JOIN events e ON e.id=i.event_id WHERE i.token_hash=?`).get(tokenHash(req.params.token));
    if (!invitation) return res.status(404).json({ error: "INVITATION_NOT_FOUND" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...invitation, start_local: formatInTimeZone(new Date(invitation.start_at)), end_local: formatInTimeZone(new Date(invitation.end_at)) });
  });

  app.post("/api/public/event-invitations/:token/respond", (req, res) => {
    const decision = cleanText(req.body?.decision, 20).toUpperCase();
    if (!["ACCEPT", "DECLINE"].includes(decision)) return res.status(400).json({ error: "INVALID_INVITATION_DECISION" });
    try {
      const result = db.transaction(() => {
        const invitation = db.prepare("SELECT * FROM event_invitations WHERE token_hash=?").get(tokenHash(req.params.token));
        if (!invitation) throw Object.assign(new Error("INVITATION_NOT_FOUND"), { status: 404 });
        if (invitation.status !== "PENDING") throw Object.assign(new Error("INVITATION_ALREADY_ANSWERED"), { status: 409 });
        const event = service.eventById(invitation.event_id);
        if (!event || ["CANCELLED", "CLOSED"].includes(event.status)) throw Object.assign(new Error("EVENT_NOT_AVAILABLE"), { status: 409 });
        if (decision === "DECLINE") {
          db.prepare("UPDATE event_invitations SET status='DECLINED',declined_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'").run(invitation.id);
          return { status: "DECLINED" };
        }
        const ticket = service.createTicket({ eventId: event.id, invitationId: invitation.id, sourceType: "INVITATION", attendeeName: invitation.guest_name, contactEmail: invitation.guest_email });
        db.prepare("UPDATE event_invitations SET status='ACCEPTED',accepted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'").run(invitation.id);
        return { status: "ACCEPTED", ticket_code: ticket.public_code };
      })();
      res.json(result);
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/public/event-refund-requests", (req, res) => {
    const ticketCode = cleanText(req.body?.ticket_code, 100);
    const email = normalizeEmail(req.body?.email);
    const reason = cleanText(req.body?.reason, 3000);
    if (!ticketCode || !validEmail(email) || !reason) return res.status(400).json({ error: "REQUIRED_REFUND_FIELDS" });
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE public_code=? AND lower(trim(contact_email))=?").get(ticketCode, email);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    if (!["VALID", "USED"].includes(ticket.status)) return res.status(409).json({ error: "TICKET_NOT_REFUNDABLE" });
    if (db.prepare("SELECT 1 FROM event_refund_requests WHERE ticket_id=? AND status IN ('REQUESTED','APPROVED')").get(ticket.id)) return res.status(409).json({ error: "REFUND_ALREADY_REQUESTED" });
    const event = service.eventById(ticket.event_id);
    const eligibility = service.refundEligibility(event, new Date());
    const id = newId("EVRFD");
    db.prepare(`INSERT INTO event_refund_requests(id,event_id,ticket_id,requester_name,requester_email,reason,status,eligibility_code,eligible)
      VALUES(?,?,?,?,?,?,'REQUESTED',?,?)`).run(id, event.id, ticket.id, cleanText(req.body?.name, 200), email, reason, eligibility.code, eligibility.eligible ? 1 : 0);
    res.status(201).json({ id, status: "REQUESTED", eligible: eligibility.eligible, eligibility_code: eligibility.code });
  });

  app.get("/api/event-categories", auth, admin, (_req, res) => {
    res.json(db.prepare("SELECT * FROM event_categories ORDER BY sort_order,name_en").all());
  });

  app.post("/api/event-categories", auth, admin, (req, res) => {
    const code = cleanText(req.body?.code, 80).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    const nameEn = cleanText(req.body?.name_en, 160);
    const nameHu = cleanText(req.body?.name_hu, 160);
    if (!code || !nameEn || !nameHu) return res.status(400).json({ error: "REQUIRED_FIELDS" });
    const id = newId("EVC");
    try {
      db.prepare("INSERT INTO event_categories(id,code,name_en,name_hu,sort_order,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?)")
        .run(id, code, nameEn, nameHu, Number(req.body?.sort_order || 0), req.user.id, req.user.id);
      res.status(201).json(db.prepare("SELECT * FROM event_categories WHERE id=?").get(id));
    } catch (error) { sendError(res, Object.assign(new Error(String(error.message).includes("UNIQUE") ? "EVENT_CATEGORY_ALREADY_EXISTS" : "EVENT_CATEGORY_CREATE_FAILED"), { status: 409 })); }
  });

  app.put("/api/event-categories/:id", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM event_categories WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "EVENT_CATEGORY_NOT_FOUND" });
    const nameEn = cleanText(req.body?.name_en ?? before.name_en, 160);
    const nameHu = cleanText(req.body?.name_hu ?? before.name_hu, 160);
    if (!nameEn || !nameHu) return res.status(400).json({ error: "REQUIRED_FIELDS" });
    db.prepare("UPDATE event_categories SET name_en=?,name_hu=?,active=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(nameEn, nameHu, req.body?.active === undefined ? before.active : (req.body.active ? 1 : 0), Number(req.body?.sort_order ?? before.sort_order), req.user.id, before.id);
    const after = db.prepare("SELECT * FROM event_categories WHERE id=?").get(before.id);
    audit(req, "UPDATE", "events", before.id, before, after, 1, "Event category updated");
    res.json(after);
  });

  app.delete("/api/event-categories/:id", auth, requireSuperadmin, (req, res) => {
    if (db.prepare("SELECT 1 FROM events WHERE category_id=? LIMIT 1").get(req.params.id)) return res.status(409).json({ error: "EVENT_CATEGORY_IN_USE" });
    const result = db.prepare("DELETE FROM event_categories WHERE id=?").run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: "EVENT_CATEGORY_NOT_FOUND" });
    res.json({ ok: true });
  });

  app.get("/api/events", auth, admin, (_req, res) => {
    const rows = db.prepare(`${service.selectEventSql} ORDER BY e.start_at DESC`).all();
    res.json(rows.map(service.eventResponse));
  });

  app.get("/api/events/:id", auth, admin, (req, res) => {
    const row = service.eventById(req.params.id);
    if (!row) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    const invitations = db.prepare("SELECT id,event_id,guest_name,guest_email,language,status,delivery_status,sent_at,accepted_at,declined_at,revoked_at,created_at FROM event_invitations WHERE event_id=? ORDER BY created_at DESC").all(row.id);
    const tickets = db.prepare("SELECT id,event_id,invitation_id,source_type,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,checked_in_at,created_at FROM event_tickets WHERE event_id=? ORDER BY created_at DESC").all(row.id);
    const refunds = db.prepare("SELECT * FROM event_refund_requests WHERE event_id=? ORDER BY requested_at DESC").all(row.id);
    res.json({ ...service.eventResponse(row), invitations, tickets, refunds });
  });

  app.post("/api/events", auth, admin, (req, res) => {
    const validation = service.validateEventInput(req.body);
    if (validation.error) return res.status(400).json({ error: validation.error });
    const value = validation.value;
    const id = newId("EVT");
    const eventKey = `EV-${new Date().getUTCFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    try {
      db.prepare(`INSERT INTO events(id,event_key,category_id,access_type,status,slug_en,slug_hu,title_en,title_hu,short_description_en,short_description_hu,description_en,description_hu,performer_name,hero_image_url,gallery_json,venue_name,venue_street,venue_city,venue_region,venue_postal_code,venue_country,timezone,start_at,end_at,capacity_total,price_cents,currency,sales_start_at,sales_end_at,created_by_user_id,updated_by_user_id)
        VALUES(@id,@event_key,@category_id,@access_type,'DRAFT',@slug_en,@slug_hu,@title_en,@title_hu,@short_description_en,@short_description_hu,@description_en,@description_hu,@performer_name,@hero_image_url,@gallery_json,@venue_name,@venue_street,@venue_city,@venue_region,@venue_postal_code,@venue_country,@timezone,@start_at,@end_at,@capacity_total,@price_cents,@currency,@sales_start_at,@sales_end_at,@created_by_user_id,@updated_by_user_id)`)
        .run({ id, event_key: eventKey, ...value, created_by_user_id: req.user.id, updated_by_user_id: req.user.id });
      const created = service.eventById(id);
      audit(req, "CREATE", "events", id, null, created, 1, "Event draft created");
      res.status(201).json(service.eventResponse(created));
    } catch (error) { sendError(res, Object.assign(new Error(String(error.message).includes("UNIQUE") ? "EVENT_SLUG_ALREADY_USED" : "EVENT_CREATE_FAILED"), { status: 409 })); }
  });

  app.put("/api/events/:id", auth, admin, (req, res) => {
    const before = service.eventById(req.params.id);
    if (!ensureMutable(before, res)) return;
    const validation = service.validateEventInput(req.body, service.eventResponse(before));
    if (validation.error) return res.status(400).json({ error: validation.error });
    const value = validation.value;
    try {
      db.prepare(`UPDATE events SET category_id=@category_id,access_type=@access_type,slug_en=@slug_en,slug_hu=@slug_hu,title_en=@title_en,title_hu=@title_hu,short_description_en=@short_description_en,short_description_hu=@short_description_hu,description_en=@description_en,description_hu=@description_hu,performer_name=@performer_name,hero_image_url=@hero_image_url,gallery_json=@gallery_json,venue_name=@venue_name,venue_street=@venue_street,venue_city=@venue_city,venue_region=@venue_region,venue_postal_code=@venue_postal_code,venue_country=@venue_country,timezone=@timezone,start_at=@start_at,end_at=@end_at,capacity_total=@capacity_total,price_cents=@price_cents,currency=@currency,sales_start_at=@sales_start_at,sales_end_at=@sales_end_at,updated_by_user_id=@updated_by_user_id,updated_at=CURRENT_TIMESTAMP WHERE id=@id`)
        .run({ id: before.id, ...value, updated_by_user_id: req.user.id });
      const after = service.eventById(before.id);
      audit(req, "UPDATE", "events", before.id, before, after, 1, "Event updated");
      res.json(service.eventResponse(after));
    } catch (error) { sendError(res, Object.assign(new Error(String(error.message).includes("UNIQUE") ? "EVENT_SLUG_ALREADY_USED" : "EVENT_UPDATE_FAILED"), { status: 409 })); }
  });

  app.post("/api/events/:id/publish", auth, admin, (req, res) => {
    const before = service.eventById(req.params.id);
    if (!ensureMutable(before, res)) return;
    if (before.status !== "DRAFT") return res.status(409).json({ error: "EVENT_ALREADY_PUBLISHED" });
    if (!cleanText(before.short_description_en) || !cleanText(before.short_description_hu) || !cleanText(before.description_en) || !cleanText(before.description_hu)) return res.status(400).json({ error: "BILINGUAL_EVENT_CONTENT_REQUIRED" });
    if (before.access_type === "PUBLIC_PAID" && Number(before.price_cents) <= 0) return res.status(400).json({ error: "PAID_EVENT_PRICE_REQUIRED" });
    db.prepare("UPDATE events SET status='PUBLISHED',published_at=COALESCE(published_at,CURRENT_TIMESTAMP),updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, before.id);
    const after = service.eventById(before.id);
    audit(req, "PUBLISH", "events", before.id, before, after, 1, "Event published");
    res.json(service.eventResponse(after));
  });

  app.post("/api/events/:id/reschedule", auth, admin, (req, res) => {
    const before = service.eventById(req.params.id);
    if (!ensureMutable(before, res)) return;
    if (!before.published_at || before.status === "DRAFT") return res.status(409).json({ error: "ONLY_PUBLISHED_EVENT_CAN_BE_RESCHEDULED" });
    const times = normalizeEventTimes(req.body?.start_local, req.body?.end_local);
    if (times.error) return res.status(400).json({ error: times.error });
    db.prepare("UPDATE events SET previous_start_at=start_at,start_at=?,end_at=?,status='RESCHEDULED',updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(times.startAt, times.endAt, req.user.id, before.id);
    const after = service.eventById(before.id);
    audit(req, "RESCHEDULE", "events", before.id, before, after, 1, "Event rescheduled");
    res.json(service.eventResponse(after));
  });

  app.post("/api/events/:id/cancel", auth, admin, (req, res) => {
    const before = service.eventById(req.params.id);
    if (!ensureMutable(before, res)) return;
    db.prepare("UPDATE events SET status='CANCELLED',updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, before.id);
    const after = service.eventById(before.id);
    audit(req, "CANCEL", "events", before.id, before, after, 1, cleanText(req.body?.reason, 1000));
    res.json(service.eventResponse(after));
  });

  app.post("/api/events/:id/complete", auth, admin, (req, res) => {
    const before = service.eventById(req.params.id);
    if (!ensureMutable(before, res)) return;
    if (new Date(before.end_at).getTime() > Date.now()) return res.status(409).json({ error: "EVENT_HAS_NOT_ENDED" });
    db.prepare("UPDATE events SET status='COMPLETED',updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, before.id);
    const after = service.eventById(before.id);
    audit(req, "COMPLETE", "events", before.id, before, after, 1, "Event marked completed");
    res.json(service.eventResponse(after));
  });

  app.post("/api/events/:id/close", auth, admin, (req, res) => {
    const event = service.eventById(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    const existing = db.prepare("SELECT * FROM event_closures WHERE event_id=?").get(event.id);
    if (existing) return res.status(409).json({ error: "EVENT_ALREADY_CLOSED", closure: JSON.parse(existing.snapshot_json) });
    const force = Boolean(req.body?.force) && (req.user.role === "SUPERADMIN" || Number(req.user.is_superadmin || 0) === 1);
    if (new Date(event.end_at).getTime() > Date.now() && !force) return res.status(409).json({ error: "EVENT_HAS_NOT_ENDED" });
    const snapshot = db.transaction(() => {
      const counts = service.ticketCounts(event.id);
      const invitationCounts = Object.fromEntries(db.prepare("SELECT status,COUNT(*) count FROM event_invitations WHERE event_id=? GROUP BY status").all(event.id).map((row) => [row.status, Number(row.count)]));
      const refundCounts = Object.fromEntries(db.prepare("SELECT status,COUNT(*) count FROM event_refund_requests WHERE event_id=? GROUP BY status").all(event.id).map((row) => [row.status, Number(row.count)]));
      const report = { event_id: event.id, event_key: event.event_key, closed_at: new Date().toISOString(), capacity_total: Number(event.capacity_total), tickets: counts, invitations: invitationCounts, refunds: refundCounts, attended: counts.used, no_show: counts.valid, test_mode: true, finance_connected: false };
      db.prepare("INSERT INTO event_closures(id,event_id,snapshot_json,closed_by_user_id) VALUES(?,?,?,?)").run(newId("EVCLS"), event.id, JSON.stringify(report), req.user.id);
      db.prepare("UPDATE events SET status='CLOSED',closed_at=CURRENT_TIMESTAMP,closed_by_user_id=?,closure_snapshot_json=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(req.user.id, JSON.stringify(report), req.user.id, event.id);
      return report;
    })();
    audit(req, "CLOSE", "events", event.id, event, snapshot, 1, "Event closed once");
    res.json(snapshot);
  });

  app.delete("/api/events/:id", auth, requireSuperadmin, (req, res) => {
    const event = service.eventById(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    const dependencies = db.prepare(`SELECT
      (SELECT COUNT(*) FROM event_invitations WHERE event_id=?) invitations,
      (SELECT COUNT(*) FROM event_tickets WHERE event_id=?) tickets,
      (SELECT COUNT(*) FROM event_checkins WHERE event_id=?) checkins,
      (SELECT COUNT(*) FROM event_refund_requests WHERE event_id=?) refunds`).get(event.id, event.id, event.id, event.id);
    if (event.status !== "DRAFT" || Object.values(dependencies).some((count) => Number(count) > 0)) return res.status(409).json({ error: "EVENT_RETENTION_REQUIRED", dependencies });
    db.prepare("DELETE FROM events WHERE id=?").run(event.id);
    res.json({ ok: true });
  });

  app.get("/api/events/:id/invitations", auth, admin, (req, res) => {
    res.json(db.prepare("SELECT id,event_id,guest_name,guest_email,language,status,delivery_status,sent_at,accepted_at,declined_at,revoked_at,created_at FROM event_invitations WHERE event_id=? ORDER BY created_at DESC").all(req.params.id));
  });

  app.post("/api/events/:id/invitations", auth, admin, async (req, res) => {
    const event = service.eventById(req.params.id);
    if (!ensureMutable(event, res)) return;
    const guestName = cleanText(req.body?.guest_name, 200);
    const guestEmail = normalizeEmail(req.body?.guest_email);
    const language = req.body?.language === "hu" ? "hu" : "en";
    if (!guestName || !validEmail(guestEmail)) return res.status(400).json({ error: "VALID_GUEST_REQUIRED" });
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const id = newId("EVINV");
    try {
      db.prepare(`INSERT INTO event_invitations(id,event_id,guest_name,guest_email,language,status,token_hash,delivery_status,created_by_user_id,updated_by_user_id)
        VALUES(?,?,?,?,?,'PENDING',?,'PENDING',?,?)`).run(id, event.id, guestName, guestEmail, language, tokenHash(rawToken), req.user.id, req.user.id);
    } catch (error) {
      return sendError(res, Object.assign(new Error(String(error.message).includes("UNIQUE") ? "INVITATION_ALREADY_EXISTS" : "INVITATION_CREATE_FAILED"), { status: 409 }));
    }
    let delivery = { status: "NOT_CONFIGURED" };
    if (transactionalEmail?.sendEventInvitation) {
      try {
        const invitationUrl = `${websiteBaseUrl}${language === "hu" ? "/hu/meghivas/" : "/invitation/"}${encodeURIComponent(rawToken)}`;
        const sent = await transactionalEmail.sendEventInvitation({ to: guestEmail, name: guestName, event, language, invitationUrl, idempotencyKey: `event-invitation-${id}` });
        delivery = { status: "ACCEPTED", providerMessageId: sent.providerMessageId };
      } catch (error) { delivery = { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED" }; }
    }
    db.prepare("UPDATE event_invitations SET delivery_status=?,provider_message_id=?,sent_at=CASE WHEN ?='ACCEPTED' THEN CURRENT_TIMESTAMP ELSE sent_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(delivery.status, delivery.providerMessageId || null, delivery.status, id);
    const result = db.prepare("SELECT id,event_id,guest_name,guest_email,language,status,delivery_status,sent_at,created_at FROM event_invitations WHERE id=?").get(id);
    audit(req, "CREATE", "events", id, null, result, 1, "Event invitation created");
    res.status(201).json({ ...result, invitation_url: delivery.status === "ACCEPTED" ? undefined : `${websiteBaseUrl}${language === "hu" ? "/hu/meghivas/" : "/invitation/"}${encodeURIComponent(rawToken)}` });
  });

  app.post("/api/events/invitations/:id/revoke", auth, admin, (req, res) => {
    const invitation = db.prepare("SELECT * FROM event_invitations WHERE id=?").get(req.params.id);
    if (!invitation) return res.status(404).json({ error: "INVITATION_NOT_FOUND" });
    if (invitation.status === "REVOKED") return res.json({ ok: true, status: "REVOKED" });
    db.transaction(() => {
      db.prepare("UPDATE event_tickets SET status='VOID',voided_at=CURRENT_TIMESTAMP,voided_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE invitation_id=? AND status='VALID'").run(req.user.id, invitation.id);
      db.prepare("UPDATE event_invitations SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, invitation.id);
    })();
    res.json({ ok: true, status: "REVOKED" });
  });

  app.post("/api/events/:id/complimentary-tickets", auth, admin, (req, res) => {
    const event = service.eventById(req.params.id);
    if (!ensureMutable(event, res)) return;
    const attendeeName = cleanText(req.body?.attendee_name, 200);
    const email = normalizeEmail(req.body?.contact_email);
    if (!attendeeName || !validEmail(email)) return res.status(400).json({ error: "VALID_GUEST_REQUIRED" });
    try {
      const ticket = db.transaction(() => service.createTicket({ eventId: event.id, sourceType: "COMPLIMENTARY", attendeeName, contactEmail: email, userId: req.user.id }))();
      res.status(201).json({ ...ticket, qr_token: service.qrToken(ticket) });
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/events/:id/tickets", auth, admin, (req, res) => {
    res.json(db.prepare("SELECT id,event_id,source_type,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,checked_in_at,created_at FROM event_tickets WHERE event_id=? ORDER BY attendee_name").all(req.params.id));
  });

  app.get("/api/events/tickets/:id/qr.svg", auth, admin, async (req, res) => {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    const admissionUrl = `${erpBaseUrl}/?eventCheckIn=${encodeURIComponent(service.qrToken(ticket))}`;
    const svg = await QRCode.toString(admissionUrl, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#080807", light: "#f7f3e8" } });
    res.setHeader("Cache-Control", "private, no-store");
    res.type("image/svg+xml").send(svg);
  });

  app.post("/api/events/check-in", auth, admin, (req, res) => {
    const rawToken = cleanText(req.body?.qr_token, 400);
    const scannedTicket = service.verifyQrToken(rawToken);
    try {
      const result = db.transaction(() => {
        const ticket = scannedTicket ? db.prepare("SELECT * FROM event_tickets WHERE id=?").get(scannedTicket.id) : null;
        if (!ticket) {
          db.prepare("INSERT INTO event_checkins(id,result,token_fingerprint,performed_by_user_id,details) VALUES(?,'INVALID',?,?,?)")
            .run(newId("EVCHK"), fingerprint(rawToken), req.user.id, "Unknown or invalid QR token");
          return { accepted: false, result: "INVALID" };
        }
        if (ticket.status === "USED") {
          db.prepare("INSERT INTO event_checkins(id,event_id,ticket_id,result,token_fingerprint,performed_by_user_id,details) VALUES(?,?,?,'ALREADY_USED',?,?,?)")
            .run(newId("EVCHK"), ticket.event_id, ticket.id, fingerprint(rawToken), req.user.id, ticket.checked_in_at || "");
          return { accepted: false, result: "ALREADY_USED", ticket };
        }
        if (ticket.status !== "VALID") {
          db.prepare("INSERT INTO event_checkins(id,event_id,ticket_id,result,token_fingerprint,performed_by_user_id,details) VALUES(?,?,?,'VOID',?,?,?)")
            .run(newId("EVCHK"), ticket.event_id, ticket.id, fingerprint(rawToken), req.user.id, ticket.status);
          return { accepted: false, result: "VOID", ticket };
        }
        db.prepare("UPDATE event_tickets SET status='USED',checked_in_at=CURRENT_TIMESTAMP,checked_in_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='VALID'").run(req.user.id, ticket.id);
        db.prepare("INSERT INTO event_checkins(id,event_id,ticket_id,result,token_fingerprint,performed_by_user_id,details) VALUES(?,?,?,'ACCEPTED',?,?,?)")
          .run(newId("EVCHK"), ticket.event_id, ticket.id, fingerprint(rawToken), req.user.id, "First successful admission");
        return { accepted: true, result: "ACCEPTED", ticket: db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticket.id) };
      })();
      res.status(result.accepted ? 200 : 409).json(result);
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/events/tickets/:id/revert-check-in", auth, admin, (req, res) => {
    const before = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(req.params.id);
    if (!before) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    if (before.status !== "USED") return res.status(409).json({ error: "TICKET_NOT_CHECKED_IN" });
    const reason = cleanText(req.body?.reason, 1000) || "Administrative correction";
    db.transaction(() => {
      db.prepare("UPDATE event_tickets SET status='VALID',checked_in_at=NULL,checked_in_by_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='USED'").run(before.id);
      db.prepare("INSERT INTO event_checkins(id,event_id,ticket_id,result,performed_by_user_id,details) VALUES(?,?,?,'REVERTED',?,?)")
        .run(newId("EVCHK"), before.event_id, before.id, req.user.id, reason);
    })();
    const after = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(before.id);
    audit(req, "REVERT_CHECK_IN", "events", before.event_id, before, after, 1, reason);
    res.json({ ok: true, ticket: after });
  });

  app.get("/api/events/:id/refund-requests", auth, admin, (req, res) => {
    res.json(db.prepare(`SELECT r.*,t.public_code,t.attendee_name,t.status AS ticket_status FROM event_refund_requests r
      JOIN event_tickets t ON t.id=r.ticket_id WHERE r.event_id=? ORDER BY r.requested_at DESC`).all(req.params.id));
  });

  app.put("/api/events/refund-requests/:id", auth, admin, (req, res) => {
    const request = db.prepare("SELECT * FROM event_refund_requests WHERE id=?").get(req.params.id);
    if (!request) return res.status(404).json({ error: "REFUND_REQUEST_NOT_FOUND" });
    const status = cleanText(req.body?.status, 30).toUpperCase();
    if (!REFUND_STATUSES.has(status) || status === "PROCESSED") return res.status(400).json({ error: "INVALID_REFUND_STATUS" });
    if (status === "APPROVED" && !Number(request.eligible)) return res.status(409).json({ error: "REFUND_NOT_ELIGIBLE" });
    db.prepare("UPDATE event_refund_requests SET status=?,resolution_note=?,resolved_at=CURRENT_TIMESTAMP,resolved_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(status, cleanText(req.body?.resolution_note, 2000), req.user.id, request.id);
    res.json(db.prepare("SELECT * FROM event_refund_requests WHERE id=?").get(request.id));
  });

  return service;
}

module.exports = {
  EVENT_ACCESS_TYPES,
  EVENT_STATUSES,
  REFUND_WINDOW_MS,
  createEventService,
  formatInTimeZone,
  localNewYorkToUtc,
  normalizeEventTimes,
  registerEventRoutes,
  tokenHash
};
