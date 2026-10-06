const crypto = require("crypto");

const PROVIDER = "GOOGLE";
const INTEGRATION_ID = "CAL-GOOGLE-WORK";
const DEFAULT_CALENDAR_EMAIL = "klavierhauswork@gmail.com";
const FORBIDDEN_NON_KLAVIERHAUS_CALENDAR = "himatecorp2025@gmail.com";
const REVIEW_STATES = new Set(["NEEDS_REVIEW", "REVIEWED", "SOURCE_CHANGED", "SOURCE_CANCELLED", "INVALID", "IGNORED"]);

function createGoogleCalendarIntegration(options) {
  const {
    db,
    rid,
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
  const normalizedCentralEmail = config.centralEmail.toLowerCase();
  const normalizedCalendarId = config.calendarId.toLowerCase();
  if (normalizedCentralEmail !== DEFAULT_CALENDAR_EMAIL) throw new Error("GOOGLE_CALENDAR_CENTRAL_EMAIL_MUST_BE_KLAVIERHAUS_WORK");
  if (normalizedCalendarId === FORBIDDEN_NON_KLAVIERHAUS_CALENDAR || normalizedCalendarId === "primary") throw new Error("GOOGLE_CALENDAR_SOURCE_NOT_ALLOWED");

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
    const before = integrationRow();
    const calendarChanged = Boolean(before?.calendar_id && before.calendar_id !== config.calendarId);
    db.prepare(`INSERT INTO calendar_integrations(id,provider,central_email,calendar_id,status,connected_by_user_id)
      VALUES(?,?,?,?, 'DISCONNECTED', ?)
      ON CONFLICT(provider) DO UPDATE SET
        central_email=excluded.central_email,
        calendar_id=excluded.calendar_id,
        calendar_summary=CASE WHEN calendar_integrations.calendar_id<>excluded.calendar_id THEN NULL ELSE calendar_integrations.calendar_summary END,
        sync_token=CASE WHEN calendar_integrations.calendar_id<>excluded.calendar_id THEN NULL ELSE calendar_integrations.sync_token END,
        channel_id=CASE WHEN calendar_integrations.calendar_id<>excluded.calendar_id THEN NULL ELSE calendar_integrations.channel_id END,
        resource_id=CASE WHEN calendar_integrations.calendar_id<>excluded.calendar_id THEN NULL ELSE calendar_integrations.resource_id END,
        channel_token=CASE WHEN calendar_integrations.calendar_id<>excluded.calendar_id THEN NULL ELSE calendar_integrations.channel_token END,
        channel_expires_at=CASE WHEN calendar_integrations.calendar_id<>excluded.calendar_id THEN NULL ELSE calendar_integrations.channel_expires_at END,
        updated_at=CURRENT_TIMESTAMP`)
      .run(INTEGRATION_ID, PROVIDER, config.centralEmail, config.calendarId, userId);
    if (calendarChanged) logger.info?.(`Google Calendar source changed to ${config.calendarId}; incremental sync state reset.`);
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
      direction: "GOOGLE_TO_ERP",
      source_locked: true,
      source_account: DEFAULT_CALENDAR_EMAIL
    };
  }

  function runtimeEnabled() {
    try {
      const master = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='system_integrations_enabled'").get()?.setting_value;
      const provider = db.prepare("SELECT enabled FROM system_integration_health WHERE provider='GOOGLE_CALENDAR'").get()?.enabled;
      return master !== "0" && Number(provider ?? 1) === 1;
    } catch (_error) { return true; }
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

  function createTestAuthUrl(userId) {
    if (!configured) throw new Error("GOOGLE_CALENDAR_NOT_CONFIGURED");
    if (!runtimeEnabled()) throw new Error("GOOGLE_CALENDAR_INTEGRATION_DISABLED");
    const rawState = crypto.randomBytes(32).toString("base64url");
    const state = `KHIT.${rawState}`;
    const stateHash = crypto.createHash("sha256").update(state).digest("hex");
    db.prepare("DELETE FROM system_integration_test_tokens WHERE expires_at<=?").run(new Date().toISOString());
    db.prepare("INSERT INTO system_integration_test_tokens(state_hash,provider,requested_by_user_id,expires_at) VALUES(?,'GOOGLE_CALENDAR',?,?)")
      .run(stateHash, userId, new Date(Date.now() + 10 * 60 * 1000).toISOString());
    const params = new URLSearchParams({
      client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events", access_type: "online", prompt: "consent", state
    });
    return `${config.authUrl}?${params}`;
  }

  function isTestState(state) {
    const value = String(state || "");
    if (!value.startsWith("KHIT.")) return false;
    const stateHash = crypto.createHash("sha256").update(value).digest("hex");
    const row = db.prepare("SELECT 1 FROM system_integration_test_tokens WHERE state_hash=? AND provider='GOOGLE_CALENDAR' AND expires_at>?").get(stateHash, new Date().toISOString());
    return Boolean(row);
  }

  async function handleTestOAuthCallback(code, state) {
    if (!configured) throw new Error("GOOGLE_CALENDAR_NOT_CONFIGURED");
    const stateHash = crypto.createHash("sha256").update(String(state || "")).digest("hex");
    const row = db.prepare("SELECT * FROM system_integration_test_tokens WHERE state_hash=? AND provider='GOOGLE_CALENDAR'").get(stateHash);
    if (!row || Date.parse(row.expires_at) <= Date.now()) throw new Error("INVALID_OR_EXPIRED_TEST_OAUTH_STATE");
    if (!code) throw new Error("GOOGLE_OAUTH_CODE_MISSING");
    const token = await exchangeToken({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" });
    if (!token.access_token) throw new Error("GOOGLE_TEST_ACCESS_TOKEN_MISSING");
    const expiry = new Date(Date.now() + Math.min(Number(token.expires_in || 600) * 1000, 10 * 60 * 1000)).toISOString();
    db.prepare("UPDATE system_integration_test_tokens SET access_token_encrypted=?,expires_at=? WHERE state_hash=?").run(encrypt(token.access_token), expiry, stateHash);
    return { ok: true, expires_at: expiry };
  }

  function consumeTestAccessToken(userId) {
    const row = db.prepare("SELECT * FROM system_integration_test_tokens WHERE provider='GOOGLE_CALENDAR' AND requested_by_user_id=? AND access_token_encrypted IS NOT NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1").get(userId, new Date().toISOString());
    if (!row) throw Object.assign(new Error("GOOGLE_CALENDAR_TEST_WRITE_AUTH_REQUIRED"), { status: 409 });
    db.prepare("DELETE FROM system_integration_test_tokens WHERE state_hash=?").run(row.state_hash);
    return decrypt(row.access_token_encrypted);
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
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    if (part?.date && /^\d{4}-\d{2}-\d{2}$/.test(part.date)) {
      const hour = end ? 10 : 9;
      const probe = new Date(`${part.date}T${String(hour).padStart(2,"0")}:00:00Z`);
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23" }).formatToParts(probe);
      const map = Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
      const represented = Date.UTC(+map.year,+map.month-1,+map.day,+map.hour,+map.minute);
      const desired = Date.UTC(+part.date.slice(0,4),+part.date.slice(5,7)-1,+part.date.slice(8,10),hour,0);
      return new Date(probe.getTime() + desired - represented).toISOString();
    }
    return null;
  }

  function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
  function cleanText(value, max = 8000) { return String(value || "").replace(/\u0000/g, "").trim().slice(0, max); }
  function normalized(value) { return cleanText(value, 4000).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9@.]+/g, " ").replace(/\s+/g," ").trim(); }
  function durationMinutes(start,end){ const delta=(Date.parse(end)-Date.parse(start))/60000; return Number.isFinite(delta)&&delta>0?Math.max(15,Math.round(delta)):60; }
  function eventEmails(event){
    return [...new Set([event.creator?.email,event.organizer?.email,...(Array.isArray(event.attendees)?event.attendees.map(x=>x?.email):[])].map(normalizeEmail).filter(Boolean))];
  }
  function mappedUser(event) {
    for (const email of eventEmails(event)) {
      const row=db.prepare(`SELECT id,name,email,calendar_color FROM users WHERE status='Active' AND COALESCE(hidden_user,0)=0
        AND lower(trim(COALESCE(NULLIF(google_calendar_email,''),email)))=? LIMIT 1`).get(email);
      if(row)return row;
    }
    return null;
  }
  function sourceText(event){ return normalized([event.summary,event.description,event.location,eventEmails(event).join(" ")].filter(Boolean).join(" \n ")); }
  function matchClient(event){
    const emails=eventEmails(event), rows=db.prepare("SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY id").all(), exact=[];
    for(const row of rows){ if(row.email&&emails.includes(normalizeEmail(row.email)))exact.push(row); }
    if(exact.length===1)return exact[0]; if(exact.length>1)return null;
    const hay=sourceText(event), hits=rows.filter(row=>[row.name,row.company_name,row.contact_name].some(v=>{const n=normalized(v);return n.length>=5&&hay.includes(n);}));
    return hits.length===1?hits[0]:null;
  }
  function pianoLabel(row){ return normalized([row.brand,row.model,row.serial_number].filter(Boolean).join(" ")); }
  function matchPiano(event,client){
    if(!client)return null; const rows=db.prepare("SELECT * FROM pianos WHERE client_id=? ORDER BY id").all(client.id);
    if(rows.length===1)return rows[0]; const hay=sourceText(event);
    const serial=rows.filter(row=>row.serial_number&&hay.includes(normalized(row.serial_number))); if(serial.length===1)return serial[0];
    const labels=rows.filter(row=>{const label=pianoLabel(row);return label.length>=4&&hay.includes(label);}); return labels.length===1?labels[0]:null;
  }
  function importedInstructions(event) {
    const attendees = Array.isArray(event.attendees) ? event.attendees.map((item) => item.email || item.displayName).filter(Boolean).join(", ") : "";
    return ["[Google Calendar import / Google Naptár-import]",`Summary / Cím: ${event.summary || ""}`,`Description / Leírás: ${event.description || ""}`,`Location / Helyszín: ${event.location || ""}`,`Start / Kezdés: ${event.start?.dateTime || event.start?.date || ""}`,`End / Befejezés: ${event.end?.dateTime || event.end?.date || ""}`,`Creator / Létrehozó: ${event.creator?.email || event.creator?.displayName || ""}`,`Organizer / Szervező: ${event.organizer?.email || event.organizer?.displayName || ""}`,`Attendees / Résztvevők: ${attendees}`,`Google link / Google-hivatkozás: ${event.htmlLink || ""}`,`External event ID / Külső eseményazonosító: ${event.id || ""}`].join("\n");
  }
  function adminUsers() { return db.prepare("SELECT id,name FROM users WHERE status='Active' AND COALESCE(hidden_user,0)=0 AND role='ADMIN'").all(); }
  function notifyAdmins(type,event,job,titleEn,titleHu,bodyEn,bodyHu,suffix=""){ for(const admin of adminUsers())createNotification({recipientUserId:admin.id,type,job,titleEn,titleHu,bodyEn,bodyHu,metadata:{google_event_id:event.id,job_id:job?.id||null},eventKey:`${type}:${event.id}:${admin.id}:${suffix||event.etag||event.updated||"v1"}`}); }
  function notifyAssignee(type,event,job,titleEn,titleHu,bodyEn,bodyHu,suffix=""){ const uid=job?.assigned_technician_id;if(!uid)return;createNotification({recipientUserId:uid,type,job,titleEn,titleHu,bodyEn,bodyHu,metadata:{google_event_id:event.id,job_id:job.id},eventKey:`${type}:${event.id}:${uid}:${suffix||event.etag||event.updated||"v1"}`}); }
  function upsertExternalEvent(event, values) {
    const existing=db.prepare("SELECT * FROM external_calendar_events WHERE provider=? AND calendar_id=? AND external_event_id=?").get(PROVIDER,config.calendarId,event.id),id=existing?.id||rid("GCE"),reviewStatus=REVIEW_STATES.has(values.reviewStatus)?values.reviewStatus:(existing?.review_status||"NEEDS_REVIEW");
    db.prepare(`INSERT INTO external_calendar_events(id,provider,calendar_id,external_event_id,external_recurring_event_id,external_status,event_etag,creator_email,organizer_email,job_id,review_status,conflict_flag,raw_json,source_updated_at,reviewed_at,reviewed_by_user_id,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider,calendar_id,external_event_id) DO UPDATE SET external_recurring_event_id=excluded.external_recurring_event_id,external_status=excluded.external_status,event_etag=excluded.event_etag,creator_email=excluded.creator_email,organizer_email=excluded.organizer_email,job_id=excluded.job_id,review_status=excluded.review_status,conflict_flag=excluded.conflict_flag,raw_json=excluded.raw_json,source_updated_at=excluded.source_updated_at,reviewed_at=COALESCE(excluded.reviewed_at,external_calendar_events.reviewed_at),reviewed_by_user_id=COALESCE(excluded.reviewed_by_user_id,external_calendar_events.reviewed_by_user_id),updated_at=CURRENT_TIMESTAMP`)
      .run(id,PROVIDER,config.calendarId,event.id,event.recurringEventId||null,event.status||"confirmed",event.etag||null,normalizeEmail(event.creator?.email),normalizeEmail(event.organizer?.email),values.jobId||null,reviewStatus,values.conflictFlag?1:0,values.rawJson===null?null:JSON.stringify(event),event.updated||null,values.reviewedAt||null,values.reviewedByUserId||null);
    return db.prepare("SELECT * FROM external_calendar_events WHERE id=?").get(id);
  }
  function getJobRow(id){ return id?db.prepare(`SELECT j.*,u.name assigned_technician_name,u.calendar_color assigned_technician_color,c.name client_name,p.brand piano_brand,p.model piano_model,p.serial_number piano_serial_number FROM jobs j LEFT JOIN users u ON u.id=j.assigned_technician_id LEFT JOIN clients c ON c.id=j.client_id LEFT JOIN pianos p ON p.id=j.piano_id WHERE j.id=?`).get(id):null; }
  function conflictsFor(userId,start,end,excludeId=null){
    if(!userId)return []; const a=Date.parse(start),b=Date.parse(end);return db.prepare("SELECT id,scheduled_at,estimated_duration_min FROM jobs WHERE assigned_technician_id=? AND cancelled_at IS NULL AND stage NOT IN ('planned','completed') AND scheduled_at IS NOT NULL").all(userId).filter(row=>Number(row.id)!==Number(excludeId)&&Date.parse(row.scheduled_at)<b&&(Date.parse(row.scheduled_at)+Number(row.estimated_duration_min||120)*60000)>a);
  }
  function createRound2Job(event,{client,piano,assignee,startTime,endTime}){
    const owner=assignee||adminUsers()[0]||null,duration=durationMinutes(startTime,endTime),location=cleanText(event.location,1200),title=cleanText(event.summary||"Google Calendar event / Google Naptár-esemény",240)||"Google Calendar event";
    const info=db.prepare(`INSERT INTO jobs(client_id,piano_id,title,description,location_type,site_address,scheduled_at,estimated_duration_min,stage,workflow_stage_key,workflow_owner_user_id,assigned_technician_id,internal_notes,created_by_user_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?, 'received','received',?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(client.id,piano.id,title,cleanText(event.description,10000)||null,location?"on_site":"workshop",location||null,startTime,duration,owner?.id||null,assignee?.id||null,importedInstructions(event),owner?.id||null);
    const id=Number(info.lastInsertRowid),year=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric"}).format(new Date(startTime));db.prepare("UPDATE jobs SET job_code=? WHERE id=?").run(`KH-${year}-${String(id).padStart(5,"0")}`,id);
    const baselinePhases=new Set(["received","admin_approval","completed"]);
    const defs=db.prepare("SELECT stage_key,position FROM workflow_stage_definitions WHERE active=1 ORDER BY position,stage_key").all(),insert=db.prepare(`INSERT OR IGNORE INTO job_workflow_phases(job_id,stage_key,position,enabled,starts_at,responsible_user_id,activated_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
    for(const def of defs){
      const enabled=baselinePhases.has(def.stage_key)?1:0;
      insert.run(id,def.stage_key,def.position,enabled,enabled&&def.stage_key==="received"?startTime:null,assignee?.id||null,enabled&&def.stage_key==="received"?new Date().toISOString():null);
    }
    return getJobRow(id);
  }
  function processCancelledEvent(event,existing){ const job=getJobRow(existing?.job_id);upsertExternalEvent(event,{jobId:existing?.job_id||null,reviewStatus:"SOURCE_CANCELLED",conflictFlag:Boolean(existing?.conflict_flag)});if(job)notifyAdmins("GOOGLE_EVENT_CANCELLED",event,job,"Google event cancelled","Google-esemény törölve",`${job.title} · ERP job kept for review.`,`${job.title} · Az ERP-munka megmaradt ellenőrzésre.`,event.updated);return {flagged:1}; }
  function processEvent(event){
    if(!event?.id)return {};const existing=db.prepare("SELECT * FROM external_calendar_events WHERE provider=? AND calendar_id=? AND external_event_id=?").get(PROVIDER,config.calendarId,event.id);if(existing?.review_status==="IGNORED")return {};if(event.status==="cancelled")return processCancelledEvent(event,existing);
    const startTime=eventDateTime(event.start,false),endTime=eventDateTime(event.end,true);if(!startTime||!endTime||Date.parse(endTime)<=Date.parse(startTime)){upsertExternalEvent(event,{jobId:existing?.job_id||null,reviewStatus:"INVALID",conflictFlag:false});return {flagged:1};}
    const sourceChanged=Boolean(existing?.event_etag&&event.etag&&existing.event_etag!==event.etag),linked=getJobRow(existing?.job_id);
    if(linked&&["REVIEWED","SOURCE_CHANGED","SOURCE_CANCELLED"].includes(existing.review_status)){upsertExternalEvent(event,{jobId:linked.id,reviewStatus:sourceChanged?"SOURCE_CHANGED":existing.review_status,conflictFlag:Boolean(existing.conflict_flag)});if(sourceChanged)notifyAdmins("GOOGLE_EVENT_SOURCE_CHANGED",event,linked,"Reviewed Google event changed","Ellenőrzött Google-esemény megváltozott",`${linked.title} · ERP data was not overwritten.`,`${linked.title} · Az ERP-adatok nem íródtak felül.`,event.etag);return sourceChanged?{flagged:1}:{};}
    const assignee=mappedUser(event),client=matchClient(event),piano=matchPiano(event,client);
    if(!linked&&client&&piano){const conflicts=conflictsFor(assignee?.id,startTime,endTime),job=createRound2Job(event,{client,piano,assignee,startTime,endTime});upsertExternalEvent(event,{jobId:job.id,reviewStatus:"REVIEWED",conflictFlag:conflicts.length>0,reviewedAt:new Date().toISOString()});notifyAdmins("GOOGLE_EVENT_IMPORTED",event,job,"Google Calendar job imported","Google Naptár-munka importálva",`${job.title} · Added to Klavierhaus Calendar.`,`${job.title} · Hozzáadva a Klavierhaus naptárhoz.`,event.etag);notifyAssignee("GOOGLE_EVENT_IMPORTED",event,job,"New Google Calendar job","Új Google Naptár-munka",job.title,job.title,event.etag);return {imported:1,flagged:conflicts.length?1:0};}
    upsertExternalEvent(event,{jobId:linked?.id||null,reviewStatus:"NEEDS_REVIEW",conflictFlag:false});notifyAdmins("GOOGLE_EVENT_REVIEW_REQUIRED",event,linked,"Google job needs review","Google-munka ellenőrzésre vár",event.summary||event.id,event.summary||event.id,event.etag);return {updated:existing?1:0,imported:existing?0:1,flagged:1};
  }

  const processEventTransaction = db.transaction(processEvent);

  async function fetchCalendarMetadata() {
    const encoded = encodeURIComponent(config.calendarId);
    const calendar = await googleRequest(`/calendars/${encoded}`);
    if (calendar?.id && String(calendar.id).trim().toLowerCase() !== normalizedCalendarId) throw new Error("GOOGLE_CALENDAR_SOURCE_MISMATCH");
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
      return { ok: true, imported, updated, flagged, source_calendar_id: config.calendarId, source_account: DEFAULT_CALENDAR_EMAIL, status: publicStatus() };
    } catch (error) {
      db.prepare("UPDATE calendar_integrations SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?")
        .run(String(error.message || error).slice(0, 1000), PROVIDER);
      db.prepare("UPDATE calendar_sync_log SET status='FAILED',details=?,completed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(String(error.message || error).slice(0, 2000), logId);
      throw error;
    }
  }

  function syncNow(triggerType = "MANUAL") {
    if (!runtimeEnabled()) return Promise.resolve({ ok: false, disabled: true, status: publicStatus() });
    if (syncPromise) return syncPromise;
    syncPromise = performSync(triggerType).finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function syncIfStale(triggerType = "CALENDAR_VIEW", maxAgeMs = 30000) {
    const status = publicStatus();
    if (!runtimeEnabled() || !configured || !status.connected) return Promise.resolve({ ok: false, skipped: true, status });
    const lastSyncMs = Date.parse(status.last_sync_at || "");
    if (Number.isFinite(lastSyncMs) && Date.now() - lastSyncMs < Math.max(0, Number(maxAgeMs || 0))) {
      return Promise.resolve({ ok: true, skipped: true, fresh: true, status });
    }
    return syncNow(triggerType);
  }

  async function registerWatch() {
    if (!runtimeEnabled()) return null;
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
    if (!runtimeEnabled()) return false;
    const row = integrationRow();
    const channelId = String(headers["x-goog-channel-id"] || "");
    const channelToken = String(headers["x-goog-channel-token"] || "");
    const resourceId = String(headers["x-goog-resource-id"] || "");
    if (!row || !channelId || channelId !== row.channel_id || channelToken !== row.channel_token || (row.resource_id && resourceId !== row.resource_id)) return false;
    setImmediate(() => syncNow("WEBHOOK").catch((error) => logger.warn("Google webhook sync failed:", error.message)));
    return true;
  }


  async function testConnection(writeAccessToken = "") {
    const token = String(writeAccessToken || "").trim();
    if (!token) throw Object.assign(new Error("GOOGLE_CALENDAR_TEST_WRITE_AUTH_REQUIRED"), { status: 409 });
    const start = new Date(Date.now() + 5 * 60 * 1000);
    const end = new Date(start.getTime() + 5 * 60 * 1000);
    let createdId = "";
    let deleted = false;
    try {
      const createResponse = await fetchImpl(`${config.apiBase}/calendars/${encodeURIComponent(config.calendarId)}/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: "Klavierhaus ERP integration test (temporary)",
          description: "Created and deleted automatically by System Activation & Integrations.",
          start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }
        })
      });
      const created = await readJsonResponse(createResponse);
      createdId = String(created?.id || "");
      if (!createdId) throw new Error("GOOGLE_CALENDAR_TEST_EVENT_CREATE_FAILED");
      const deleteResponse = await fetchImpl(`${config.apiBase}/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(createdId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      deleted = deleteResponse.ok || deleteResponse.status === 204 || deleteResponse.status === 410;
      if (!deleted) throw new Error(`GOOGLE_CALENDAR_TEST_EVENT_DELETE_FAILED:HTTP_${deleteResponse.status}`);
      return { live_data: true, temporary_event_created: true, temporary_event_deleted: true, event_id: createdId };
    } finally {
      if (createdId && !deleted) {
        for (let attempt = 0; attempt < 3 && !deleted; attempt += 1) {
          try {
            const cleanup = await fetchImpl(`${config.apiBase}/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(createdId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
            deleted = cleanup.ok || cleanup.status === 204 || cleanup.status === 404 || cleanup.status === 410;
          } catch (_error) {}
        }
      }
    }
  }

  async function disconnect() {
    stopTimers();
    db.prepare(`UPDATE calendar_integrations SET status='DISCONNECTED',access_token_encrypted=NULL,refresh_token_encrypted=NULL,token_expiry=NULL,
      sync_token=NULL,channel_id=NULL,resource_id=NULL,channel_token=NULL,channel_expires_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE provider=?`).run(PROVIDER);
    db.prepare("DELETE FROM calendar_oauth_states").run();
    return publicStatus();
  }

  function reviewEvent(externalId, payload, userId) {
    const external=db.prepare("SELECT * FROM external_calendar_events WHERE provider=? AND (id=? OR external_event_id=?)").get(PROVIDER,String(externalId),String(externalId));
    if(!external)throw Object.assign(new Error("GOOGLE_CALENDAR_EVENT_NOT_FOUND"),{status:404});if(external.review_status==="SOURCE_CANCELLED")throw new Error("GOOGLE_SOURCE_EVENT_CANCELLED");
    const event=JSON.parse(external.raw_json||"{}"),startTime=eventDateTime(event.start,false),endTime=eventDateTime(event.end,true);if(!startTime||!endTime)throw new Error("GOOGLE_EVENT_INVALID_TIME");
    const client=db.prepare("SELECT * FROM clients WHERE id=? AND deleted_at IS NULL").get(Number(payload?.client_id));if(!client)throw new Error("GOOGLE_EVENT_CLIENT_REQUIRED");
    const piano=db.prepare("SELECT * FROM pianos WHERE id=? AND client_id=?").get(Number(payload?.piano_id),client.id);if(!piano)throw new Error("GOOGLE_EVENT_PIANO_REQUIRED");
    const assigneeId=String(payload?.assigned_technician_id||mappedUser(event)?.id||"").trim(),assignee=assigneeId?db.prepare("SELECT id,name,email,calendar_color FROM users WHERE id=? AND status='Active' AND COALESCE(hidden_user,0)=0").get(assigneeId):null;
    let job=getJobRow(external.job_id);if(!job)job=createRound2Job(event,{client,piano,assignee,startTime,endTime});
    else db.prepare("UPDATE jobs SET client_id=?,piano_id=?,assigned_technician_id=?,workflow_owner_user_id=COALESCE(workflow_owner_user_id,?),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(client.id,piano.id,assignee?.id||null,assignee?.id||userId,job.id);
    const conflicts=conflictsFor(assignee?.id,startTime,endTime,job.id);db.prepare(`UPDATE external_calendar_events SET job_id=?,review_status='REVIEWED',conflict_flag=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(job.id,conflicts.length?1:0,userId,external.id);return getJobRow(job.id);
  }
  function calendarEntries({from,to,technicianId=""}={}){
    const fromMs=Date.parse(from),toMs=Date.parse(to),rows=db.prepare(`SELECT * FROM external_calendar_events WHERE provider=? AND job_id IS NULL AND review_status IN ('NEEDS_REVIEW','INVALID') AND external_status<>'cancelled' ORDER BY source_updated_at,imported_at`).all(PROVIDER),out=[];
    for(const row of rows){let event;try{event=JSON.parse(row.raw_json||"{}");}catch(_e){continue;}const start=eventDateTime(event.start,false),end=eventDateTime(event.end,true);if(!start||!end||Date.parse(start)>=toMs||Date.parse(end)<=fromMs)continue;const assignee=mappedUser(event);if(technicianId&&String(assignee?.id||"")!==String(technicianId))continue;out.push({id:`google:${row.id}`,google_calendar_pending:true,google_external_id:row.id,calendar_review_status:row.review_status,title:cleanText(event.summary||"Google Calendar event",240),description:cleanText(event.description,10000),location_type:event.location?"on_site":"workshop",site_address:cleanText(event.location,1200),scheduled_at:start,scheduled_end:end,estimated_duration_min:durationMinutes(start,end),stage:"received",workflow_status:"needs_review",client_name:"Google · Needs review",assigned_technician_id:assignee?.id||null,assigned_technician_name:assignee?.name||"Unassigned",assigned_technician_color:assignee?.calendar_color||"#c99a45",google_creator_email:normalizeEmail(event.creator?.email),google_attendees:eventEmails(event),google_link:event.htmlLink||""});}return out;
  }
  function ignoreEvent(externalId){const row=db.prepare("SELECT id,job_id FROM external_calendar_events WHERE provider=? AND (id=? OR external_event_id=?)").get(PROVIDER,String(externalId),String(externalId));if(!row)throw Object.assign(new Error("GOOGLE_CALENDAR_EVENT_NOT_FOUND"),{status:404});if(row.job_id)throw new Error("GOOGLE_EVENT_ALREADY_LINKED");db.prepare("UPDATE external_calendar_events SET review_status='IGNORED',conflict_flag=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);return {ok:true};}

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
    if (!runtimeEnabled()) return;
    if (!configured || !publicStatus().connected) return;
    setImmediate(() => syncNow("STARTUP").catch((error) => logger.warn("Google startup sync failed:", error.message)));
    pollTimer = setInterval(() => syncNow("POLL").catch((error) => logger.warn("Google polling sync failed:", error.message)), config.pollIntervalMs);
    pollTimer.unref?.();
    if (config.webhookUrl && /^https:\/\//i.test(config.webhookUrl)) {
      setImmediate(() => registerWatch().catch((error) => logger.warn("Google watch registration failed:", error.message)));
      watchTimer = setInterval(() => registerWatch().catch((error) => logger.warn("Google watch renewal failed:", error.message)), 12 * 60 * 60 * 1000);
      watchTimer.unref?.();
    }
  }

  upsertBaseIntegration();
  const startupStatus=publicStatus();
  logger.info?.("Google Calendar runtime", {
    configured: startupStatus.configured,
    connected: startupStatus.connected,
    status: startupStatus.status,
    runtime_enabled: runtimeEnabled(),
    calendar_id: startupStatus.calendar_id,
    central_email: startupStatus.central_email,
    webhook_enabled: startupStatus.webhook_enabled
  });
  startTimers();

  return {
    config: { centralEmail: config.centralEmail, calendarId: config.calendarId, redirectUri: config.redirectUri },
    status: publicStatus,
    createAuthUrl,
    createTestAuthUrl,
    isTestState,
    handleTestOAuthCallback,
    consumeTestAccessToken,
    handleOAuthCallback,
    syncNow,
    syncIfStale,
    registerWatch,
    handleWebhook,
    disconnect,
    testConnection,
    reviewEvent,
    calendarEntries,
    ignoreEvent,
    ignoreDeletedJob,
    stop: stopTimers,
    start: startTimers,
    _test: { encrypt, decrypt, processEvent }
  };
}

module.exports = { createGoogleCalendarIntegration };
