const crypto = require("crypto");

const PROVIDER = "GOOGLE";
const INTEGRATION_ID = "CAL-GOOGLE-WORK";
const DEFAULT_CALENDAR_EMAIL = "klavierhauswork@gmail.com";
const REVIEW_STATES = new Set(["NEEDS_REVIEW", "REVIEWED", "SOURCE_CHANGED", "SOURCE_CANCELLED", "INVALID", "IGNORED"]);

function createGoogleCalendarIntegration(options) {
  const {
    db,
    rid,
    stableJobKey,
    nyLocalDateTime,
    findScheduleConflicts,
    getJob,
    createNotification,
    logger = console,
    env = process.env,
    fetchImpl = global.fetch
  } = options;

  const config = {
    clientId: String(env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: String(env.GOOGLE_CLIENT_SECRET || "").trim(),
    encryptionSecret: String(env.GOOGLE_TOKEN_ENCRYPTION_KEY || "").trim(),
    calendarId: String(env.GOOGLE_CALENDAR_ID || DEFAULT_CALENDAR_EMAIL).trim(),
    centralEmail: String(env.GOOGLE_CALENDAR_CENTRAL_EMAIL || DEFAULT_CALENDAR_EMAIL).trim(),
    appBaseUrl: String(env.APP_BASE_URL || "").trim().replace(/\/$/, ""),
    redirectUri: String(env.GOOGLE_REDIRECT_URI || "").trim(),
    webhookUrl: String(env.GOOGLE_CALENDAR_WEBHOOK_URL || "").trim(),
    pollIntervalMs: Math.max(60000, Number(env.GOOGLE_CALENDAR_POLL_INTERVAL_MS || 120000)),
    lookbackDays: Math.max(1, Number(env.GOOGLE_CALENDAR_INITIAL_LOOKBACK_DAYS || 30)),
    authUrl: String(env.GOOGLE_OAUTH_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth"),
    tokenUrl: String(env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token"),
    apiBase: String(env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com/calendar/v3").replace(/\/$/, "")
  };
  if (!config.redirectUri && config.appBaseUrl) config.redirectUri = `${config.appBaseUrl}/api/google-calendar/oauth/callback`;
  if (!config.webhookUrl && config.appBaseUrl) config.webhookUrl = `${config.appBaseUrl}/api/google-calendar/webhook`;

  const configured = Boolean(config.clientId && config.clientSecret && config.encryptionSecret.length >= 32 && config.redirectUri && fetchImpl);
  const encryptionKey = config.encryptionSecret ? crypto.createHash("sha256").update(config.encryptionSecret).digest() : null;
  let syncPromise = null;
  let pollTimer = null;
  let watchTimer = null;

  function wallClockMinutes(startTime,endTime){
    const toValue=(value)=>{
      const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      return match?Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5])):NaN;
    };
    const start=toValue(startTime),end=toValue(endTime);
    return Number.isFinite(start)&&Number.isFinite(end)&&end>start?Math.round((end-start)/60000):0;
  }

  function encrypt(value) {
    if (!value) return null;
    if (!encryptionKey) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY_REQUIRED");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  function decrypt(value) {
    if (!value) return "";
    if (!encryptionKey) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY_REQUIRED");
    const [version, ivPart, tagPart, encryptedPart] = String(value).split(".");
    if (version !== "v1" || !ivPart || !tagPart || !encryptedPart) throw new Error("INVALID_ENCRYPTED_GOOGLE_TOKEN");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedPart, "base64url")), decipher.final()]).toString("utf8");
  }

  function integrationRow() {
    return db.prepare("SELECT * FROM calendar_integrations WHERE provider=?").get(PROVIDER) || null;
  }

  function upsertBaseIntegration(userId = null) {
    db.prepare(`INSERT INTO calendar_integrations(id,provider,central_email,calendar_id,status,connected_by_user_id)
      VALUES(?,?,?,?, 'DISCONNECTED', ?)
      ON CONFLICT(provider) DO UPDATE SET central_email=excluded.central_email,calendar_id=excluded.calendar_id,updated_at=CURRENT_TIMESTAMP`)
      .run(INTEGRATION_ID, PROVIDER, config.centralEmail, config.calendarId, userId);
    return integrationRow();
  }

  function publicStatus() {
    const row = integrationRow();
    return {
      configured,
      connected: Boolean(row && row.status === "CONNECTED" && row.refresh_token_encrypted),
      status: row?.status || "DISCONNECTED",
      central_email: config.centralEmail,
      calendar_id: row?.calendar_id || config.calendarId,
      calendar_summary: row?.calendar_summary || "Klavierhaus Work",
      last_sync_at: row?.last_sync_at || null,
      last_error: row?.last_error || null,
      channel_expires_at: row?.channel_expires_at || null,
      redirect_uri: config.redirectUri || null,
      webhook_enabled: Boolean(config.webhookUrl && /^https:\/\//i.test(config.webhookUrl)),
      direction: "GOOGLE_TO_ERP"
    };
  }

  function createAuthUrl(userId) {
    if (!configured) throw new Error("GOOGLE_CALENDAR_NOT_CONFIGURED");
    db.prepare("DELETE FROM calendar_oauth_states WHERE expires_at<=?").run(new Date().toISOString());
    const state = crypto.randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO calendar_oauth_states(state,user_id,expires_at) VALUES(?,?,?)")
      .run(state, userId, new Date(Date.now() + 10 * 60 * 1000).toISOString());
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state
    });
    return `${config.authUrl}?${params}`;
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_error) { body = { raw: text }; }
    if (!response.ok) {
      const error = new Error(body.error_description || body.error?.message || body.error || `GOOGLE_HTTP_${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async function exchangeToken(params) {
    const response = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params)
    });
    return readJsonResponse(response);
  }

  async function handleOAuthCallback(code, state) {
    if (!configured) throw new Error("GOOGLE_CALENDAR_NOT_CONFIGURED");
    const stateRow = db.prepare("SELECT * FROM calendar_oauth_states WHERE state=?").get(String(state || ""));
    db.prepare("DELETE FROM calendar_oauth_states WHERE state=?").run(String(state || ""));
    if (!stateRow || Date.parse(stateRow.expires_at) <= Date.now()) throw new Error("INVALID_OR_EXPIRED_OAUTH_STATE");
    if (!code) throw new Error("GOOGLE_OAUTH_CODE_MISSING");
    const token = await exchangeToken({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code"
    });
    const existing = upsertBaseIntegration(stateRow.user_id);
    const refreshToken = token.refresh_token || decrypt(existing.refresh_token_encrypted || "");
    if (!refreshToken) throw new Error("GOOGLE_REFRESH_TOKEN_MISSING");
    const expiry = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
    db.prepare(`UPDATE calendar_integrations SET status='CONNECTED',access_token_encrypted=?,refresh_token_encrypted=?,token_expiry=?,
      sync_token=NULL,last_error=NULL,connected_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?`)
      .run(encrypt(token.access_token), encrypt(refreshToken), expiry, stateRow.user_id, PROVIDER);
    startTimers();
    setImmediate(() => syncNow("OAUTH_CONNECTED").catch((error) => logger.warn("Google initial sync failed:", error.message)));
    return publicStatus();
  }

  async function accessToken(forceRefresh = false) {
    const row = integrationRow();
    if (!row || row.status !== "CONNECTED" || !row.refresh_token_encrypted) throw new Error("GOOGLE_CALENDAR_NOT_CONNECTED");
    if (!forceRefresh && row.access_token_encrypted && Date.parse(row.token_expiry || "") > Date.now() + 60000) {
      return decrypt(row.access_token_encrypted);
    }
    const token = await exchangeToken({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: decrypt(row.refresh_token_encrypted),
      grant_type: "refresh_token"
    });
    const expiry = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
    db.prepare("UPDATE calendar_integrations SET access_token_encrypted=?,token_expiry=?,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE provider=?")
      .run(encrypt(token.access_token), expiry, PROVIDER);
    return token.access_token;
  }

  async function googleRequest(path, init = {}, retry = true) {
    const token = await accessToken(false);
    const response = await fetchImpl(`${config.apiBase}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` }
    });
    if (response.status === 401 && retry) {
      await accessToken(true);
      return googleRequest(path, init, false);
    }
    return readJsonResponse(response);
  }

  function eventDateTime(part, end = false) {
    if (part?.dateTime) {
      const date = new Date(part.dateTime);
      return Number.isFinite(date.getTime()) ? nyLocalDateTime(date) : null;
    }
    if (part?.date && /^\d{4}-\d{2}-\d{2}$/.test(part.date)) return `${part.date}T${end ? "10:00" : "09:00"}`;
    return null;
  }

  function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }

  function mappedUser(event) {
    const email = normalizeEmail(event.creator?.email);
    if (!email) return null;
    return db.prepare("SELECT id,name,email,calendar_color FROM users WHERE status='Active' AND lower(trim(google_calendar_email))=? LIMIT 1").get(email) || null;
  }

  function importedInstructions(event) {
    const attendees = Array.isArray(event.attendees) ? event.attendees.map((item) => item.email || item.displayName).filter(Boolean).join(", ") : "";
    return [
      "[Google Calendar import / Google Naptár-import]",
      `Summary / Cím: ${event.summary || ""}`,
      `Description / Leírás: ${event.description || ""}`,
      `Location / Helyszín: ${event.location || ""}`,
      `Start / Kezdés: ${event.start?.dateTime || event.start?.date || ""}`,
      `End / Befejezés: ${event.end?.dateTime || event.end?.date || ""}`,
      `Creator / Létrehozó: ${event.creator?.email || event.creator?.displayName || ""}`,
      `Organizer / Szervező: ${event.organizer?.email || event.organizer?.displayName || ""}`,
      `Attendees / Résztvevők: ${attendees}`,
      `Google link / Google-hivatkozás: ${event.htmlLink || ""}`,
      `External event ID / Külső eseményazonosító: ${event.id || ""}`
    ].join("\n");
  }

  function adminUsers() {
    return db.prepare("SELECT id,name FROM users WHERE status='Active' AND (role='ADMIN' OR COALESCE(is_superadmin,0)=1)").all();
  }

  function notifyAdmins(type, event, job, titleEn, titleHu, bodyEn, bodyHu, suffix = "") {
    for (const admin of adminUsers()) {
      createNotification({
        recipientUserId: admin.id,
        type,
        job,
        titleEn,
        titleHu,
        bodyEn,
        bodyHu,
        metadata: { google_event_id: event.id, job_id: job?.id || null },
        eventKey: `${type}:${event.id}:${admin.id}:${suffix || event.etag || event.updated || "v1"}`
      });
    }
  }

  function notifyAssignee(type, event, job, titleEn, titleHu, bodyEn, bodyHu, suffix = "") {
    if (!job?.assigned_user_id) return;
    createNotification({
      recipientUserId: job.assigned_user_id,
      type,
      job,
      titleEn,
      titleHu,
      bodyEn,
      bodyHu,
      metadata: { google_event_id: event.id, job_id: job.id },
      eventKey: `${type}:${event.id}:${job.assigned_user_id}:${suffix || event.etag || event.updated || "v1"}`
    });
  }

  function upsertExternalEvent(event, values) {
    const existing = db.prepare("SELECT * FROM external_calendar_events WHERE provider=? AND calendar_id=? AND external_event_id=?")
      .get(PROVIDER, config.calendarId, event.id);
    const id = existing?.id || rid("GCE");
    const reviewStatus = REVIEW_STATES.has(values.reviewStatus) ? values.reviewStatus : (existing?.review_status || "NEEDS_REVIEW");
    db.prepare(`INSERT INTO external_calendar_events(
      id,provider,calendar_id,external_event_id,external_recurring_event_id,external_status,event_etag,creator_email,organizer_email,job_id,
      review_status,conflict_flag,raw_json,source_updated_at,reviewed_at,reviewed_by_user_id,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(provider,calendar_id,external_event_id) DO UPDATE SET
      external_recurring_event_id=excluded.external_recurring_event_id,external_status=excluded.external_status,event_etag=excluded.event_etag,
      creator_email=excluded.creator_email,organizer_email=excluded.organizer_email,job_id=excluded.job_id,review_status=excluded.review_status,
      conflict_flag=excluded.conflict_flag,raw_json=excluded.raw_json,source_updated_at=excluded.source_updated_at,
      reviewed_at=COALESCE(excluded.reviewed_at,external_calendar_events.reviewed_at),
      reviewed_by_user_id=COALESCE(excluded.reviewed_by_user_id,external_calendar_events.reviewed_by_user_id),updated_at=CURRENT_TIMESTAMP`)
      .run(
        id, PROVIDER, config.calendarId, event.id, event.recurringEventId || null, event.status || "confirmed", event.etag || null,
        normalizeEmail(event.creator?.email), normalizeEmail(event.organizer?.email), values.jobId || null, reviewStatus,
        values.conflictFlag ? 1 : 0, values.rawJson === null ? null : JSON.stringify(event), event.updated || null,
        values.reviewedAt || null, values.reviewedByUserId || null
      );
    return db.prepare("SELECT * FROM external_calendar_events WHERE id=?").get(id);
  }

  function processCancelledEvent(event, existing) {
    if (!existing) {
      upsertExternalEvent(event, { jobId: null, reviewStatus: "SOURCE_CANCELLED", conflictFlag: false });
      return { flagged: 1 };
    }
    if (existing.review_status === "IGNORED") return {};
    const job = existing.job_id ? getJob(existing.job_id) : null;
    upsertExternalEvent(event, { jobId: existing.job_id, reviewStatus: "SOURCE_CANCELLED", conflictFlag: existing.conflict_flag });
    if (job) {
      const bodyEn = `${job.title} · The Google source event was cancelled. The ERP job was kept for administrator review.`;
      const bodyHu = `${job.title} · A forrásként szolgáló Google-eseményt törölték. Az ERP-munka megmaradt adminisztrátori ellenőrzésre.`;
      notifyAdmins("GOOGLE_EVENT_CANCELLED", event, job, "Google event cancelled", "Google-esemény törölve", bodyEn, bodyHu, event.updated);
      notifyAssignee("GOOGLE_EVENT_CANCELLED", event, job, "Google event cancelled", "Google-esemény törölve", bodyEn, bodyHu, event.updated);
    }
    return { flagged: 1 };
  }

  function processEvent(event) {
    if (!event?.id) return {};
    const existing = db.prepare("SELECT * FROM external_calendar_events WHERE provider=? AND calendar_id=? AND external_event_id=?")
      .get(PROVIDER, config.calendarId, event.id);
    if (existing?.review_status === "IGNORED") return {};
    if (event.status === "cancelled") return processCancelledEvent(event, existing);

    const startTime = eventDateTime(event.start, false);
    const endTime = event.start?.date && !event.start?.dateTime ? `${event.start.date}T10:00` : eventDateTime(event.end, true);
    if (!startTime || !endTime || Date.parse(endTime) <= Date.parse(startTime)) {
      upsertExternalEvent(event, { jobId: existing?.job_id || null, reviewStatus: "INVALID", conflictFlag: false });
      notifyAdmins("GOOGLE_EVENT_INVALID", event, null, "Google event needs correction", "Javítandó Google-esemény", event.summary || event.id, event.summary || event.id, event.updated);
      return { flagged: 1 };
    }

    const assignee = mappedUser(event);
    if (existing?.job_id) {
      const job = getJob(existing.job_id);
      if (!job) {
        upsertExternalEvent(event, { jobId: null, reviewStatus: "IGNORED", conflictFlag: false, rawJson: null });
        return {};
      }
      const sourceChanged = existing.event_etag && event.etag && existing.event_etag !== event.etag;
      if (["REVIEWED", "SOURCE_CHANGED", "SOURCE_CANCELLED"].includes(existing.review_status)) {
        const state = sourceChanged ? "SOURCE_CHANGED" : existing.review_status;
        upsertExternalEvent(event, { jobId: job.id, reviewStatus: state, conflictFlag: existing.conflict_flag });
        if (sourceChanged) {
          const bodyEn = `${job.title} · Google changed after ERP review; ERP data was not overwritten.`;
          const bodyHu = `${job.title} · A Google-esemény az ERP-ellenőrzés után változott; az ERP-adatok nem íródtak felül.`;
          notifyAdmins("GOOGLE_EVENT_SOURCE_CHANGED", event, job, "Reviewed Google event changed", "Ellenőrzött Google-esemény megváltozott", bodyEn, bodyHu, event.etag);
        }
        return sourceChanged ? { flagged: 1 } : {};
      }

      const effectiveAssignee = job.assigned_user_id ? { id: job.assigned_user_id, name: job.assigned_to } : assignee;
      const conflicts = effectiveAssignee ? findScheduleConflicts(effectiveAssignee.id, effectiveAssignee.name, startTime, endTime, job.id) : [];
      const plannedMinutes=wallClockMinutes(startTime,endTime);
      db.prepare(`UPDATE jobs SET title=?,start_time=?,end_time=?,instructions=?,planned_minutes=?,planned_hours=?,
        assigned_user_id=?,assigned_to=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(
          String(event.summary || "Google Calendar event / Google Naptár-esemény").trim(), startTime, endTime, importedInstructions(event),
          plannedMinutes,plannedMinutes/60,
          effectiveAssignee?.id || null, effectiveAssignee?.name || "Unassigned / Nincs hozzárendelve", job.id
        );
      const updated = getJob(job.id);
      upsertExternalEvent(event, { jobId: job.id, reviewStatus: "NEEDS_REVIEW", conflictFlag: conflicts.length > 0 });
      if (conflicts.length) notifyAdmins("GOOGLE_EVENT_CONFLICT", event, updated, "Google event has a schedule conflict", "A Google-esemény időpontja ütközik", updated.title, updated.title, event.etag);
      return { updated: 1, flagged: conflicts.length ? 1 : 0 };
    }

    const conflicts = assignee ? findScheduleConflicts(assignee.id, assignee.name, startTime, endTime) : [];
    const jobId = rid("J");
    db.prepare(`INSERT INTO jobs(
      id,job_key,workflow_root_id,workflow_step_no,workflow_status,title,job_type,assigned_user_id,assigned_to,created_by,
      priority,status,start_time,end_time,timezone,planned_amount,planned_hours,planned_minutes,travel_minutes,service_address,instructions
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        jobId, stableJobKey(), jobId, 1, "ACTIVE", String(event.summary || "Google Calendar event / Google Naptár-esemény").trim(),
        "Standalone", assignee?.id || null, assignee?.name || "Unassigned / Nincs hozzárendelve", "Google Calendar",
        "Medium", "Open", startTime, endTime, "America/New_York", 0, wallClockMinutes(startTime,endTime)/60, wallClockMinutes(startTime,endTime), 0, "", importedInstructions(event)
      );
    const job = getJob(jobId);
    upsertExternalEvent(event, { jobId, reviewStatus: "NEEDS_REVIEW", conflictFlag: conflicts.length > 0 });
    const reviewBodyEn = `${job.title} · Imported from ${event.creator?.email || "Google Calendar"}; administrator review is required.`;
    const reviewBodyHu = `${job.title} · Importálva innen: ${event.creator?.email || "Google Naptár"}; adminisztrátori ellenőrzés szükséges.`;
    notifyAdmins("GOOGLE_EVENT_REVIEW_REQUIRED", event, job, "Google job needs review", "Google-munka ellenőrzésre vár", reviewBodyEn, reviewBodyHu, event.etag);
    notifyAssignee("GOOGLE_EVENT_IMPORTED", event, job, "New Google Calendar job", "Új Google Naptár-munka", reviewBodyEn, reviewBodyHu, event.etag);
    if (conflicts.length) {
      const bodyEn = `${job.title} · This employee already has another job in the same time range.`;
      const bodyHu = `${job.title} · Ennek a munkatársnak ugyanebben az időszakban már van másik munkája.`;
      notifyAdmins("GOOGLE_EVENT_CONFLICT", event, job, "Google event has a schedule conflict", "A Google-esemény időpontja ütközik", bodyEn, bodyHu, event.etag);
      notifyAssignee("GOOGLE_EVENT_CONFLICT", event, job, "Schedule conflict needs review", "Időpontütközés ellenőrzése szükséges", bodyEn, bodyHu, event.etag);
    }
    return { imported: 1, flagged: conflicts.length || !assignee ? 1 : 0 };
  }

  const processEventTransaction = db.transaction(processEvent);

  async function fetchCalendarMetadata() {
    const encoded = encodeURIComponent(config.calendarId);
    const calendar = await googleRequest(`/calendars/${encoded}`);
    db.prepare("UPDATE calendar_integrations SET calendar_summary=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?")
      .run(calendar.summary || "Klavierhaus Work", PROVIDER);
  }

  async function performSync(triggerType) {
    if (!configured) throw new Error("GOOGLE_CALENDAR_NOT_CONFIGURED");
    const row = integrationRow();
    if (!row || row.status !== "CONNECTED") throw new Error("GOOGLE_CALENDAR_NOT_CONNECTED");
    const logId = rid("GSL");
    db.prepare("INSERT INTO calendar_sync_log(id,integration_id,trigger_type,status) VALUES(?,?,?,'RUNNING')")
      .run(logId, row.id, triggerType);
    let imported = 0, updated = 0, flagged = 0;
    try {
      if (!row.calendar_summary) await fetchCalendarMetadata();
      let pageToken = null;
      let nextSyncToken = null;
      let useSyncToken = row.sync_token || "";
      do {
        const params = new URLSearchParams({ showDeleted: "true", singleEvents: "true", maxResults: "2500" });
        if (useSyncToken) params.set("syncToken", useSyncToken);
        else params.set("timeMin", new Date(Date.now() - config.lookbackDays * 86400000).toISOString());
        if (pageToken) params.set("pageToken", pageToken);
        let payload;
        try {
          payload = await googleRequest(`/calendars/${encodeURIComponent(config.calendarId)}/events?${params}`);
        } catch (error) {
          if (error.status === 410 && useSyncToken) {
            db.prepare("UPDATE calendar_integrations SET sync_token=NULL WHERE provider=?").run(PROVIDER);
            useSyncToken = "";
            pageToken = null;
            continue;
          }
          throw error;
        }
        for (const event of payload.items || []) {
          const result = processEventTransaction(event);
          imported += Number(result.imported || 0);
          updated += Number(result.updated || 0);
          flagged += Number(result.flagged || 0);
        }
        pageToken = payload.nextPageToken || null;
        nextSyncToken = payload.nextSyncToken || nextSyncToken;
      } while (pageToken);
      db.prepare(`UPDATE calendar_integrations SET sync_token=COALESCE(?,sync_token),last_sync_at=CURRENT_TIMESTAMP,last_error=NULL,
        status='CONNECTED',updated_at=CURRENT_TIMESTAMP WHERE provider=?`).run(nextSyncToken, PROVIDER);
      db.prepare("UPDATE calendar_sync_log SET status='SUCCESS',imported_count=?,updated_count=?,flagged_count=?,completed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(imported, updated, flagged, logId);
      return { ok: true, imported, updated, flagged, status: publicStatus() };
    } catch (error) {
      db.prepare("UPDATE calendar_integrations SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?")
        .run(String(error.message || error).slice(0, 1000), PROVIDER);
      db.prepare("UPDATE calendar_sync_log SET status='FAILED',details=?,completed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(String(error.message || error).slice(0, 2000), logId);
      throw error;
    }
  }

  function syncNow(triggerType = "MANUAL") {
    if (syncPromise) return syncPromise;
    syncPromise = performSync(triggerType).finally(() => { syncPromise = null; });
    return syncPromise;
  }

  async function registerWatch() {
    const row = integrationRow();
    if (!row || row.status !== "CONNECTED" || !config.webhookUrl || !/^https:\/\//i.test(config.webhookUrl)) return null;
    if (Date.parse(row.channel_expires_at || "") > Date.now() + 24 * 60 * 60 * 1000) return row;
    const channelId = crypto.randomUUID();
    const channelToken = crypto.randomBytes(24).toString("base64url");
    const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000;
    const watched = await googleRequest(`/calendars/${encodeURIComponent(config.calendarId)}/events/watch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: channelId, type: "web_hook", address: config.webhookUrl, token: channelToken, expiration: String(expiration) })
    });
    db.prepare(`UPDATE calendar_integrations SET channel_id=?,resource_id=?,channel_token=?,channel_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?`)
      .run(channelId, watched.resourceId || null, channelToken, new Date(Number(watched.expiration || expiration)).toISOString(), PROVIDER);
    return integrationRow();
  }

  function handleWebhook(headers) {
    const row = integrationRow();
    const channelId = String(headers["x-goog-channel-id"] || "");
    const channelToken = String(headers["x-goog-channel-token"] || "");
    const resourceId = String(headers["x-goog-resource-id"] || "");
    if (!row || !channelId || channelId !== row.channel_id || channelToken !== row.channel_token || (row.resource_id && resourceId !== row.resource_id)) return false;
    setImmediate(() => syncNow("WEBHOOK").catch((error) => logger.warn("Google webhook sync failed:", error.message)));
    return true;
  }

  async function disconnect() {
    stopTimers();
    db.prepare(`UPDATE calendar_integrations SET status='DISCONNECTED',access_token_encrypted=NULL,refresh_token_encrypted=NULL,token_expiry=NULL,
      sync_token=NULL,channel_id=NULL,resource_id=NULL,channel_token=NULL,channel_expires_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE provider=?`).run(PROVIDER);
    db.prepare("DELETE FROM calendar_oauth_states").run();
    return publicStatus();
  }

  function markReviewed(jobId, userId) {
    const external = db.prepare("SELECT * FROM external_calendar_events WHERE job_id=? AND provider=?").get(jobId, PROVIDER);
    if (!external) throw new Error("GOOGLE_CALENDAR_EVENT_NOT_FOUND");
    if (external.review_status === "SOURCE_CANCELLED") throw new Error("GOOGLE_SOURCE_EVENT_CANCELLED");
    const job = getJob(jobId);
    if (!job) throw new Error("JOB_NOT_FOUND");
    if (!job.assigned_user_id) throw new Error("GOOGLE_EVENT_ASSIGNEE_REQUIRED");
    const conflicts = job.assigned_user_id ? findScheduleConflicts(job.assigned_user_id, job.assigned_to, job.start_time, job.end_time, job.id) : [];
    if (conflicts.length) throw new Error("GOOGLE_EVENT_CONFLICT_UNRESOLVED");
    db.prepare(`UPDATE external_calendar_events SET review_status='REVIEWED',conflict_flag=?,reviewed_at=CURRENT_TIMESTAMP,
      reviewed_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(conflicts.length ? 1 : 0, userId, external.id);
    return getJob(jobId);
  }

  function ignoreDeletedJob(jobId) {
    db.prepare(`UPDATE external_calendar_events SET job_id=NULL,review_status='IGNORED',conflict_flag=0,raw_json=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE provider=? AND job_id=?`).run(PROVIDER, jobId);
  }

  function stopTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (watchTimer) clearInterval(watchTimer);
    pollTimer = null;
    watchTimer = null;
  }

  function startTimers() {
    stopTimers();
    if (!configured || !publicStatus().connected) return;
    pollTimer = setInterval(() => syncNow("POLL").catch((error) => logger.warn("Google polling sync failed:", error.message)), config.pollIntervalMs);
    pollTimer.unref?.();
    if (config.webhookUrl && /^https:\/\//i.test(config.webhookUrl)) {
      setImmediate(() => registerWatch().catch((error) => logger.warn("Google watch registration failed:", error.message)));
      watchTimer = setInterval(() => registerWatch().catch((error) => logger.warn("Google watch renewal failed:", error.message)), 12 * 60 * 60 * 1000);
      watchTimer.unref?.();
    }
  }

  upsertBaseIntegration();
  startTimers();

  return {
    config: { centralEmail: config.centralEmail, calendarId: config.calendarId, redirectUri: config.redirectUri },
    status: publicStatus,
    createAuthUrl,
    handleOAuthCallback,
    syncNow,
    registerWatch,
    handleWebhook,
    disconnect,
    markReviewed,
    ignoreDeletedJob,
    stop: stopTimers,
    _test: { encrypt, decrypt, processEvent }
  };
}

module.exports = { createGoogleCalendarIntegration };
