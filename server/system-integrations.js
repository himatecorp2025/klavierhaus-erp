"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PROVIDERS = Object.freeze(["GOOGLE_CALENDAR", "GA4", "CLARITY", "SEARCH_CONSOLE", "RESEND", "STRIPE"]);
const LEGACY_PROVIDERS = new Set(["GA4", "CLARITY", "SEARCH_CONSOLE"]);
const SECRET_PROVIDERS = new Set(["GA4", "RESEND", "STRIPE"]);
const PROVIDER_PERMISSIONS = Object.freeze({ view: "system_integrations.view", edit: "system_integrations.edit", test: "system_integrations.test" });
const BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function clean(value, max = 20000) { return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max); }
function parseJson(value, fallback = {}) { try { return JSON.parse(value || ""); } catch (_error) { return fallback; } }
function tableExists(db, name) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function isSuperadmin(user) { return Boolean(user && (user.role === "SUPERADMIN" || Number(user.is_superadmin || 0) === 1)); }
function providerOrThrow(value) { const provider = clean(value, 80).toUpperCase(); if (!PROVIDERS.includes(provider)) throw Object.assign(new Error("INTEGRATION_PROVIDER_NOT_FOUND"), { status: 404 }); return provider; }
function keyFromSecret(value) { return crypto.createHash("sha256").update(String(value || "")).digest(); }
function encryptionSecret(env = process.env) { return clean(env.SYSTEM_INTEGRATION_ENCRYPTION_KEY, 5000); }
function encryptionReady(env = process.env) { return encryptionSecret(env).length >= 32; }
function encryptionKey(env = process.env) { if (!encryptionReady(env)) throw Object.assign(new Error("SYSTEM_INTEGRATION_ENCRYPTION_KEY_REQUIRED"), { status: 503 }); return keyFromSecret(encryptionSecret(env)); }
function encryptWithKey(value, key) { if (!value) return null; const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); const payload = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]); return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${payload.toString("base64url")}`; }
function decryptWithKey(value, key) { if (!value) return ""; const [version, iv, tag, payload] = String(value).split("."); if (version !== "v1" || !iv || !tag || !payload) throw new Error("INVALID_ENCRYPTED_INTEGRATION_SECRET"); const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8"); }
function encrypt(value, env = process.env) { return encryptWithKey(value, encryptionKey(env)); }
function legacySecrets(env = process.env) { return [...new Set([env.MARKETING_TOKEN_ENCRYPTION_KEY, env.GOOGLE_TOKEN_ENCRYPTION_KEY, env.JWT_SECRET].map((v) => clean(v, 5000)).filter((v) => v.length >= 1))]; }
function decryptCompatible(value, env = process.env) {
  if (!value) return "";
  const candidates = [];
  if (encryptionReady(env)) candidates.push(encryptionSecret(env));
  candidates.push(...legacySecrets(env));
  let lastError;
  for (const secret of [...new Set(candidates)]) {
    try { return decryptWithKey(value, keyFromSecret(secret)); } catch (error) { lastError = error; }
  }
  throw lastError || new Error("INTEGRATION_SECRET_DECRYPT_FAILED");
}
function createIntegrationCipher(env = process.env) { return { encrypt: (value) => encrypt(value, env), decrypt: (value) => decryptCompatible(value, env), ready: () => encryptionReady(env) }; }
function secretHint(value) { const raw = String(value || ""); return raw ? `••••••••${raw.slice(-4)}` : ""; }
function secretRow(db, provider) { return db.prepare("SELECT * FROM system_integration_secrets WHERE provider=?").get(provider) || null; }
function healthRow(db, provider) { return db.prepare("SELECT * FROM system_integration_health WHERE provider=?").get(provider) || null; }
function ensureHealth(db, provider, userId = null) { db.prepare("INSERT OR IGNORE INTO system_integration_health(provider,enabled,status,updated_by_user_id) VALUES(?,1,'DISCONNECTED',?)").run(provider, userId); return healthRow(db, provider); }
function getSetting(db, key, fallback = "") { return db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(key)?.setting_value ?? fallback; }
function setSetting(db, key, value, userName = "") { db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(key, String(value), userName); }
function systemEnabled(db) { return getSetting(db, "system_integrations_enabled", "1") !== "0"; }
function providerEnabled(db, provider) { return Number(ensureHealth(db, provider).enabled ?? 1) === 1; }
function permissionAllowed(db, user, permission) { if (isSuperadmin(user)) return true; if (!user || user.role !== "ADMIN") return false; const row = db.prepare("SELECT enabled FROM role_permissions WHERE role=? AND permission=?").get(user.role, permission); return row ? Number(row.enabled) === 1 : true; }
function requirePermission(db, permission) { return (req, res, next) => permissionAllowed(db, req.user, permission) ? next() : res.status(403).json({ error: "PERMISSION_DENIED", permission }); }

function normalizedConfig(provider, config = {}, env = process.env) {
  const source = config && typeof config === "object" ? config : {};
  if (provider === "GOOGLE_CALENDAR") return { calendar_id: clean(source.calendar_id || env.GOOGLE_CALENDAR_ID || "klavierhauswork@gmail.com", 500), central_email: clean(source.central_email || env.GOOGLE_CALENDAR_CENTRAL_EMAIL || "klavierhauswork@gmail.com", 500) };
  if (provider === "GA4") return { measurement_id: clean(source.measurement_id, 80) };
  if (provider === "CLARITY") return { project_id: clean(source.project_id, 80) };
  if (provider === "SEARCH_CONSOLE") return { property_url: clean(source.property_url, 1000) };
  if (provider === "RESEND") return { from_email: clean(source.from_email || env.EMAIL_FROM, 500), event_from_email: clean(source.event_from_email || env.EVENT_EMAIL_FROM, 500), reply_to: clean(source.reply_to || env.EMAIL_REPLY_TO, 500) };
  if (provider === "STRIPE") return { publishable_key: clean(source.publishable_key, 500), mode: "sandbox" };
  return {};
}
function providerConfig(db, provider, env = process.env) { const row = secretRow(db, provider); return normalizedConfig(provider, parseJson(row?.public_config_json, {}), env); }
function secretBundle(db, provider, env = process.env) { const row = secretRow(db, provider); if (!row?.encrypted_secret) return {}; const raw = decryptCompatible(row.encrypted_secret, env); const parsed = parseJson(raw, null); if (parsed && typeof parsed === "object") return parsed; return provider === "STRIPE" ? { secret_key: raw } : provider === "RESEND" ? { api_key: raw } : { api_secret: raw }; }
function hasProviderSecret(db, provider) { return Boolean(secretRow(db, provider)?.encrypted_secret); }

function migrateLegacyIntegrationSecrets(db, env = process.env) {
  if (!encryptionReady(env) || !tableExists(db, "website_integration_settings")) return { migrated: 0, skipped: true };
  let migrated = 0;
  const tx = db.transaction(() => {
    for (const provider of ["GA4", "CLARITY", "SEARCH_CONSOLE"]) {
      const legacy = db.prepare("SELECT * FROM website_integration_settings WHERE provider=?").get(provider);
      if (!legacy) continue;
      const existing = secretRow(db, provider);
      let encrypted = existing?.encrypted_secret || null;
      let hint = existing?.secret_hint || "";
      if (!encrypted && legacy.encrypted_secret) {
        const plain = decryptCompatible(legacy.encrypted_secret, env);
        encrypted = encrypt(JSON.stringify(provider === "GA4" ? { api_secret: plain } : { token: plain }), env);
        hint = secretHint(plain);
      }
      db.prepare(`INSERT INTO system_integration_secrets(provider,public_config_json,encrypted_secret,secret_hint,updated_by_user_id,updated_at)
        VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(provider) DO UPDATE SET public_config_json=CASE WHEN system_integration_secrets.public_config_json='{}' THEN excluded.public_config_json ELSE system_integration_secrets.public_config_json END,
          encrypted_secret=COALESCE(system_integration_secrets.encrypted_secret,excluded.encrypted_secret),secret_hint=CASE WHEN system_integration_secrets.secret_hint IS NULL OR system_integration_secrets.secret_hint='' THEN excluded.secret_hint ELSE system_integration_secrets.secret_hint END,updated_at=CURRENT_TIMESTAMP`)
        .run(provider, legacy.public_config_json || "{}", encrypted, hint, legacy.updated_by_user_id || null);
      ensureHealth(db, provider, legacy.updated_by_user_id || null);
      migrated += 1;
    }
    // Re-encrypt Google marketing OAuth token bundle in place with the dedicated key after successfully decrypting with any legacy key.
    const oauth = db.prepare("SELECT * FROM website_integration_settings WHERE provider='GOOGLE_OAUTH'").get();
    if (oauth?.encrypted_secret) {
      const plain = decryptCompatible(oauth.encrypted_secret, env);
      db.prepare("UPDATE website_integration_settings SET encrypted_secret=?,updated_at=CURRENT_TIMESTAMP WHERE provider='GOOGLE_OAUTH'").run(encrypt(plain, env));
    }
  });
  tx();
  return { migrated, skipped: false };
}

function publicProvider(db, provider, env = process.env) {
  const health = ensureHealth(db, provider); const config = providerConfig(db, provider, env); const enabled = Number(health.enabled ?? 1) === 1;
  let status = enabled ? health.status : "DISABLED";
  let lastError = health.last_error || null; let lastSyncAt = null;
  if (provider === "GOOGLE_CALENDAR") { const row = db.prepare("SELECT status,last_sync_at,last_error FROM calendar_integrations WHERE provider='GOOGLE'").get(); if (enabled && row?.status === "CONNECTED" && status !== "ERROR") status = "CONNECTED"; lastError = lastError || row?.last_error || null; lastSyncAt = row?.last_sync_at || null; }
  return { provider, enabled, status, config, has_secret: SECRET_PROVIDERS.has(provider) && hasProviderSecret(db, provider), secret_hint: secretRow(db, provider)?.secret_hint || "", last_tested_at: health.last_tested_at, last_success_at: health.last_success_at, last_connection_at: health.last_connection_at, last_error: lastError, last_sync_at: lastSyncAt };
}
function writeHealth(db, provider, ok, error = null, connected = true, userId = null) { ensureHealth(db, provider, userId); db.prepare(`UPDATE system_integration_health SET status=?,last_tested_at=CURRENT_TIMESTAMP,last_success_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_success_at END,last_connection_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_connection_at END,last_error=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?`).run(ok ? (connected ? "CONNECTED" : "CONFIGURED") : "ERROR", ok ? 1 : 0, ok && connected ? 1 : 0, ok ? null : clean(error, 1000), userId, provider); }
async function jsonFetch(url, init = {}) { const response = await fetch(url, init); const text = await response.text(); let body = {}; try { body = text ? JSON.parse(text) : {}; } catch (_error) { body = { raw: text }; } if (!response.ok) { const error = new Error(clean(body.error_description || body.error?.message || body.error || `HTTP_${response.status}`, 500)); error.status = response.status; error.body = body; throw error; } return { response, body, text }; }
async function marketingGoogleAccessToken(db, env = process.env) { const row = db.prepare("SELECT * FROM website_integration_settings WHERE provider='GOOGLE_OAUTH'").get(); if (!row?.encrypted_secret || row.status !== "CONNECTED") throw new Error("GOOGLE_OAUTH_NOT_CONNECTED"); const value = parseJson(decryptCompatible(row.encrypted_secret, env), null); if (!value?.tokens?.access_token) throw new Error("GOOGLE_OAUTH_NOT_CONNECTED"); if (Number(value.tokens.expires_at || 0) > Date.now() + 60000) return value.tokens.access_token; if (!value.tokens.refresh_token) throw new Error("GOOGLE_OAUTH_REFRESH_TOKEN_MISSING"); const config = parseJson(row.public_config_json); const { body: refreshed } = await jsonFetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clean(config.client_id), client_secret: value.client_secret, refresh_token: value.tokens.refresh_token, grant_type: "refresh_token" }) }); if (!refreshed.access_token) throw new Error("GOOGLE_OAUTH_REFRESH_FAILED"); value.tokens = { ...value.tokens, ...refreshed, expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 }; db.prepare("UPDATE website_integration_settings SET encrypted_secret=?,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE provider='GOOGLE_OAUTH'").run(encrypt(JSON.stringify(value), env)); return value.tokens.access_token; }

async function testProvider({ db, provider, body, googleCalendar, env }) {
  if (!systemEnabled(db)) throw Object.assign(new Error("SYSTEM_INTEGRATIONS_DISABLED"), { status: 409 });
  if (!providerEnabled(db, provider)) throw Object.assign(new Error("INTEGRATION_PROVIDER_DISABLED"), { status: 409 });
  const config = providerConfig(db, provider, env);
  if (provider === "GOOGLE_CALENDAR") { const token = googleCalendar.consumeTestAccessToken(body?.user_id); return googleCalendar.testConnection(token); }
  if (provider === "GA4") { const secret = secretBundle(db, provider, env).api_secret || ""; if (!/^G-[A-Z0-9]{4,20}$/i.test(config.measurement_id) || !secret) throw new Error("GA4_CONFIGURATION_INCOMPLETE"); const { body: result } = await jsonFetch(`https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(config.measurement_id)}&api_secret=${encodeURIComponent(secret)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: `kh-integration-test-${Date.now()}`, events: [{ name: "system_integration_test", params: { engagement_time_msec: 1, session_id: "1" } }] }) }); const severe = (result.validationMessages || []).filter((item) => String(item.validationCode || "").toUpperCase().includes("INVALID")); if (severe.length) throw new Error(clean(severe[0].description || severe[0].validationCode, 500)); return { live_data: false, validation_level: "measurement_protocol_credentials", validation_messages: result.validationMessages || [] }; }
  if (provider === "CLARITY") { if (!/^[A-Za-z0-9_-]{4,80}$/.test(config.project_id)) throw new Error("CLARITY_PROJECT_ID_REQUIRED"); const { response, text } = await jsonFetch(`https://www.clarity.ms/tag/${encodeURIComponent(config.project_id)}`, { redirect: "follow" }); if (!text || !text.includes(config.project_id)) throw new Error("CLARITY_TAG_PROJECT_MISMATCH"); return { live_data: false, validation_level: "tag_delivery", script_status: response.status, project_id_confirmed: true }; }
  if (provider === "SEARCH_CONSOLE") { const token = await marketingGoogleAccessToken(db, env); const { body: sitesResult } = await jsonFetch("https://www.googleapis.com/webmasters/v3/sites", { headers: { Authorization: `Bearer ${token}` } }); const sites = sitesResult.siteEntry || []; const property = clean(config.property_url, 1000); if (!property) throw new Error("SEARCH_CONSOLE_PROPERTY_REQUIRED"); if (!sites.some((site) => clean(site.siteUrl, 1000) === property)) throw new Error("SEARCH_CONSOLE_PROPERTY_NOT_AVAILABLE"); const endDate = new Date(); const startDate = new Date(Date.now() - 3 * 86400000); const date = (d) => d.toISOString().slice(0, 10); const { body: analytics } = await jsonFetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: date(startDate), endDate: date(endDate), rowLimit: 1 }) }); return { live_data: true, property_access: true, search_analytics_access: true, sample_rows: Array.isArray(analytics.rows) ? analytics.rows.length : 0 }; }
  if (provider === "RESEND") { const bundle = secretBundle(db, provider, env); const testEmail = clean(body?.test_email, 500).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) throw new Error("VALID_TEST_EMAIL_REQUIRED"); if (!bundle.api_key || !clean(config.from_email)) throw new Error("RESEND_CONFIGURATION_INCOMPLETE"); const { body: result } = await jsonFetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${bundle.api_key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: config.from_email, to: [testEmail], subject: "Klavierhaus ERP integration test", text: `System Activation & Integrations test succeeded at ${new Date().toISOString()}.` }) }); return { live_data: true, provider_message_id: result.id || null, test_email: testEmail }; }
  if (provider === "STRIPE") { const bundle = secretBundle(db, provider, env); const secret = bundle.secret_key || ""; if (!/^sk_test_[A-Za-z0-9]+/.test(secret) && !/^rk_test_[A-Za-z0-9]+/.test(secret)) throw new Error("STRIPE_SANDBOX_KEY_REQUIRED"); const { body: account } = await jsonFetch("https://api.stripe.com/v1/account", { headers: { Authorization: `Bearer ${secret}` } }); if (account.livemode) throw new Error("STRIPE_LIVE_MODE_REJECTED"); return { live_data: true, account_id: account.id || null, livemode: false }; }
  throw new Error("INTEGRATION_TEST_NOT_IMPLEMENTED");
}

function saveProvider(db, provider, body, user, env = process.env) {
  const config = normalizedConfig(provider, body?.config || {}, env); const existing = secretRow(db, provider); let encrypted = existing?.encrypted_secret || null; let hint = existing?.secret_hint || "";
  if (body?.clear_secret === true) { encrypted = null; hint = ""; }
  const secrets = body?.secrets && typeof body.secrets === "object" ? body.secrets : {};
  const legacySecret = clean(body?.secret, 20000);
  let bundle = existing?.encrypted_secret ? secretBundle(db, provider, env) : {};
  if (provider === "GA4" && (legacySecret || secrets.api_secret !== undefined)) bundle.api_secret = clean(secrets.api_secret ?? legacySecret, 20000);
  if (provider === "RESEND" && (legacySecret || secrets.api_key !== undefined)) bundle.api_key = clean(secrets.api_key ?? legacySecret, 20000);
  if (provider === "STRIPE") { if (legacySecret || secrets.secret_key !== undefined) bundle.secret_key = clean(secrets.secret_key ?? legacySecret, 20000); if (secrets.webhook_secret !== undefined) bundle.webhook_secret = clean(secrets.webhook_secret, 20000); }
  if (SECRET_PROVIDERS.has(provider) && Object.keys(bundle).length && body?.clear_secret !== true) { if (!encryptionReady(env)) throw Object.assign(new Error("SYSTEM_INTEGRATION_ENCRYPTION_KEY_REQUIRED"), { status: 503 }); encrypted = encrypt(JSON.stringify(bundle), env); hint = secretHint(bundle.api_secret || bundle.api_key || bundle.secret_key || ""); }
  db.prepare(`INSERT INTO system_integration_secrets(provider,public_config_json,encrypted_secret,secret_hint,updated_by_user_id,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(provider) DO UPDATE SET public_config_json=excluded.public_config_json,encrypted_secret=excluded.encrypted_secret,secret_hint=excluded.secret_hint,updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP`)
    .run(provider, JSON.stringify(config), encrypted, hint, user.id);
  ensureHealth(db, provider, user.id); db.prepare("UPDATE system_integration_health SET status=CASE WHEN enabled=1 THEN 'CONFIGURED' ELSE 'DISCONNECTED' END,last_error=NULL,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?").run(user.id, provider);
}
function revealProviderSecret(db, provider, env = process.env) { if (!SECRET_PROVIDERS.has(provider)) throw Object.assign(new Error("INTEGRATION_SECRET_NOT_REVEALABLE"), { status: 404 }); const bundle = secretBundle(db, provider, env); if (provider === "GA4") return { api_secret: bundle.api_secret || "" }; if (provider === "RESEND") return { api_key: bundle.api_key || "" }; return { secret_key: bundle.secret_key || "", webhook_secret: bundle.webhook_secret || "" }; }
function countProviderRecords(db, provider) { const counts = { health: healthRow(db, provider) ? 1 : 0, secret_settings: secretRow(db, provider) ? 1 : 0, legacy_marketing_settings: 0, calendar_connection: 0, imported_calendar_events_preserved: 0 }; if (LEGACY_PROVIDERS.has(provider)) counts.legacy_marketing_settings = db.prepare("SELECT COUNT(*) c FROM website_integration_settings WHERE provider=?").get(provider).c; if (provider === "GOOGLE_CALENDAR") { counts.calendar_connection = db.prepare("SELECT COUNT(*) c FROM calendar_integrations WHERE provider='GOOGLE'").get().c; counts.imported_calendar_events_preserved = tableExists(db, "external_calendar_events") ? db.prepare("SELECT COUNT(*) c FROM external_calendar_events WHERE provider='GOOGLE'").get().c : 0; } return counts; }
function backupDirectory(env = process.env) { return path.join(clean(env.BACKUP_DIR || path.join(__dirname, "backups"), 2000), "system-integrations"); }
function cleanupBackups(db, env = process.env) { const cutoff = new Date(Date.now() - BACKUP_RETENTION_MS).toISOString(); const rows = db.prepare("SELECT id,backup_file_path FROM system_integration_backups WHERE created_at<?").all(cutoff); for (const row of rows) { try { if (row.backup_file_path) fs.rmSync(row.backup_file_path, { force: true }); } catch (_e) {} } db.prepare("DELETE FROM system_integration_backups WHERE created_at<?").run(cutoff); }
function createExternalBackup(db, provider, snapshot, userId, env = process.env) { const dir = backupDirectory(env); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const id = `SIBAK-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`; const file = path.join(dir, `${id}.json`); const payload = JSON.stringify({ id, provider, created_at: new Date().toISOString(), snapshot }, null, 2); fs.writeFileSync(file, payload, { mode: 0o600 }); const sha = crypto.createHash("sha256").update(payload).digest("hex"); db.prepare("INSERT INTO system_integration_backups(id,provider,snapshot_json,backup_file_path,backup_sha256,created_by_user_id) VALUES(?,?,?,?,?,?)").run(id, provider, JSON.stringify(snapshot), file, sha, userId); cleanupBackups(db, env); return { id, file, sha }; }

function applyRuntimeProvider({ db, provider, services, googleCalendar, env }) {
  const active = systemEnabled(db) && providerEnabled(db, provider);
  if (provider === "GOOGLE_CALENDAR") { if (active) googleCalendar.start?.(); else googleCalendar.stop?.(); return; }
  if (provider === "RESEND" && services?.transactionalEmail?.reconfigure) { const config = providerConfig(db, provider, env); const bundle = hasProviderSecret(db, provider) && encryptionReady(env) ? secretBundle(db, provider, env) : {}; services.transactionalEmail.reconfigure({ apiKey: bundle.api_key ?? env.RESEND_API_KEY, from: config.from_email || env.EMAIL_FROM, eventFrom: config.event_from_email || env.EVENT_EMAIL_FROM, replyTo: config.reply_to || env.EMAIL_REPLY_TO, enabled: active }); }
  if (provider === "STRIPE" && services?.stripeSandbox?.reconfigure) { const bundle = hasProviderSecret(db, provider) && encryptionReady(env) ? secretBundle(db, provider, env) : {}; services.stripeSandbox.reconfigure({ secretKey: bundle.secret_key ?? env.STRIPE_SECRET_KEY, webhookSecret: bundle.webhook_secret ?? env.STRIPE_WEBHOOK_SECRET, enabled: active }); }
}
function applyRuntimeState(options) { for (const provider of ["GOOGLE_CALENDAR", "RESEND", "STRIPE"]) applyRuntimeProvider({ ...options, provider }); }
function hydrateRuntimeSecrets(db, env = process.env) { if (!encryptionReady(env) || !tableExists(db, "system_integration_secrets")) return { ready: encryptionReady(env), hydrated: 0 }; let hydrated = 0; for (const [provider, key, bundleKey] of [["RESEND", "RESEND_API_KEY", "api_key"], ["STRIPE", "STRIPE_SECRET_KEY", "secret_key"], ["STRIPE", "STRIPE_WEBHOOK_SECRET", "webhook_secret"]]) { try { const value = secretBundle(db, provider, env)[bundleKey]; if (value) { env[key] = value; hydrated += 1; } } catch (_error) {} } return { ready: true, hydrated }; }

function registerSystemIntegrationRoutes(options) {
  const { app, db, auth, requireSuperadmin, audit, googleCalendar, services = {}, env = process.env } = options;
  if (!tableExists(db, "system_integration_health")) throw new Error("SYSTEM_INTEGRATION_SCHEMA_MISSING");
  for (const provider of PROVIDERS) ensureHealth(db, provider);
  try { migrateLegacyIntegrationSecrets(db, env); } catch (error) { console.warn("Legacy integration credential migration deferred:", error.message); }
  const view = requirePermission(db, PROVIDER_PERMISSIONS.view), edit = requirePermission(db, PROVIDER_PERMISSIONS.edit), test = requirePermission(db, PROVIDER_PERMISSIONS.test);
  applyRuntimeState({ db, services, googleCalendar, env });

  app.get("/api/system-integrations", auth, view, (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({ enabled: systemEnabled(db), can_toggle: isSuperadmin(req.user), can_edit: permissionAllowed(db, req.user, PROVIDER_PERMISSIONS.edit), can_test: permissionAllowed(db, req.user, PROVIDER_PERMISSIONS.test), can_reveal: isSuperadmin(req.user), encryption_ready: encryptionReady(env), providers: PROVIDERS.map((provider) => publicProvider(db, provider, env)) }); });
  app.put("/api/system-integrations/control", auth, requireSuperadmin, (req, res) => { const before = systemEnabled(db), enabled = Boolean(req.body?.enabled); setSetting(db, "system_integrations_enabled", enabled ? "1" : "0", req.user.name || "SUPERADMIN"); applyRuntimeState({ db, services, googleCalendar, env }); audit(req, "UPDATE", "system_integrations", "master", { enabled: before }, { enabled }, 1, "System integrations master activation changed"); res.json({ enabled }); });
  app.put("/api/system-integrations/:provider/enabled", auth, requireSuperadmin, (req, res) => { try { const provider = providerOrThrow(req.params.provider), enabled = Boolean(req.body?.enabled); ensureHealth(db, provider, req.user.id); db.prepare("UPDATE system_integration_health SET enabled=?,status=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?").run(enabled ? 1 : 0, "DISCONNECTED", req.user.id, provider); applyRuntimeProvider({ db, provider, services, googleCalendar, env }); audit(req, "UPDATE", "system_integrations", provider, null, { enabled }, 1, "Provider activation changed"); res.json(publicProvider(db, provider, env)); } catch (error) { res.status(error.status || 400).json({ error: error.message }); } });
  app.put("/api/system-integrations/:provider", auth, edit, (req, res) => { try { if (!systemEnabled(db) && !isSuperadmin(req.user)) return res.status(409).json({ error: "SYSTEM_INTEGRATIONS_DISABLED" }); const provider = providerOrThrow(req.params.provider); saveProvider(db, provider, req.body || {}, req.user, env); applyRuntimeProvider({ db, provider, services, googleCalendar, env }); audit(req, "CONFIGURE", "system_integrations", provider, null, { provider, config: req.body?.config || {}, secret_changed: Boolean(req.body?.secret || req.body?.secrets || req.body?.clear_secret) }, 1, "Integration configured; secrets omitted from audit"); res.json(publicProvider(db, provider, env)); } catch (error) { res.status(error.status || 400).json({ error: error.message || "INTEGRATION_SAVE_FAILED" }); } });
  app.get("/api/system-integrations/:provider/secret", auth, requireSuperadmin, (req, res) => { try { const provider = providerOrThrow(req.params.provider), secrets = revealProviderSecret(db, provider, env); res.setHeader("Cache-Control", "no-store, max-age=0"); res.setHeader("Pragma", "no-cache"); res.json({ provider, secrets, expires_in_seconds: 30 }); } catch (error) { res.status(error.status || 400).json({ error: error.message || "SECRET_REVEAL_FAILED" }); } });
  app.get("/api/system-integrations/GOOGLE_CALENDAR/test-auth-url", auth, test, (req, res) => { try { res.json({ url: googleCalendar.createTestAuthUrl(req.user.id) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  app.post("/api/system-integrations/:provider/test", auth, test, async (req, res) => { let provider; try { provider = providerOrThrow(req.params.provider); const details = await testProvider({ db, provider, body: { ...(req.body || {}), user_id: req.user.id }, googleCalendar, env }); writeHealth(db, provider, true, null, true, req.user.id); res.json({ ok: true, provider, integration: publicProvider(db, provider, env), details }); } catch (error) { if (provider) writeHealth(db, provider, false, error.message, false, req.user.id); res.status(error.status || 502).json({ ok: false, provider, error: clean(error.message || "INTEGRATION_TEST_FAILED", 500) }); } });
  app.post("/api/system-integrations/:provider/delete-preview", auth, requireSuperadmin, (req, res) => { try { const provider = providerOrThrow(req.params.provider), counts = countProviderRecords(db, provider), raw = crypto.randomBytes(24).toString("base64url"), hash = crypto.createHash("sha256").update(raw).digest("hex"), expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); db.prepare("DELETE FROM system_integration_delete_tokens WHERE expires_at<=?").run(new Date().toISOString()); db.prepare("INSERT INTO system_integration_delete_tokens(token_hash,provider,requested_by_user_id,record_counts_json,expires_at) VALUES(?,?,?,?,?)").run(hash, provider, req.user.id, JSON.stringify(counts), expiresAt); res.json({ provider, counts, confirmation_token: raw, confirmation_text: `DELETE ${provider}`, expires_at: expiresAt, preserved: provider === "GOOGLE_CALENDAR" ? ["external_calendar_events", "calendar_sync_log"] : [] }); } catch (error) { res.status(error.status || 400).json({ error: error.message }); } });
  app.delete("/api/system-integrations/:provider", auth, requireSuperadmin, (req, res) => { try { const provider = providerOrThrow(req.params.provider), raw = clean(req.body?.confirmation_token, 1000), typed = clean(req.body?.confirmation_text, 200); if (!raw || typed !== `DELETE ${provider}`) return res.status(400).json({ error: "TWO_STEP_CONFIRMATION_REQUIRED" }); const hash = crypto.createHash("sha256").update(raw).digest("hex"), token = db.prepare("SELECT * FROM system_integration_delete_tokens WHERE token_hash=? AND provider=? AND requested_by_user_id=?").get(hash, provider, req.user.id); if (!token || Date.parse(token.expires_at) <= Date.now()) return res.status(400).json({ error: "DELETE_CONFIRMATION_EXPIRED" }); const snapshot = { provider, counts: parseJson(token.record_counts_json), health: healthRow(db, provider), secret: secretRow(db, provider), legacy: LEGACY_PROVIDERS.has(provider) ? db.prepare("SELECT * FROM website_integration_settings WHERE provider=?").get(provider) : null, calendar: provider === "GOOGLE_CALENDAR" ? db.prepare("SELECT * FROM calendar_integrations WHERE provider='GOOGLE'").get() : null }; const backup = createExternalBackup(db, provider, snapshot, req.user.id, env); const tx = db.transaction(() => { db.prepare("DELETE FROM system_integration_health WHERE provider=?").run(provider); db.prepare("DELETE FROM system_integration_secrets WHERE provider=?").run(provider); if (LEGACY_PROVIDERS.has(provider)) db.prepare("DELETE FROM website_integration_settings WHERE provider=?").run(provider); if (provider === "GOOGLE_CALENDAR") { db.prepare(`UPDATE calendar_integrations SET status='DISCONNECTED',access_token_encrypted=NULL,refresh_token_encrypted=NULL,token_expiry=NULL,sync_token=NULL,channel_id=NULL,resource_id=NULL,channel_token=NULL,channel_expires_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE provider='GOOGLE'`).run(); db.prepare("DELETE FROM calendar_oauth_states").run(); db.prepare("DELETE FROM system_integration_test_tokens WHERE provider='GOOGLE_CALENDAR'").run(); } db.prepare("DELETE FROM system_integration_delete_tokens WHERE token_hash=?").run(hash); }); tx(); ensureHealth(db, provider, req.user.id); db.prepare("UPDATE system_integration_health SET enabled=0,status='DISCONNECTED',updated_by_user_id=? WHERE provider=?").run(req.user.id, provider); applyRuntimeProvider({ db, provider, services, googleCalendar, env }); const verification = countProviderRecords(db, provider); const connectedCalendar = provider === "GOOGLE_CALENDAR" ? db.prepare("SELECT COUNT(*) c FROM calendar_integrations WHERE provider='GOOGLE' AND (status='CONNECTED' OR access_token_encrypted IS NOT NULL OR refresh_token_encrypted IS NOT NULL)").get().c : 0; if (verification.secret_settings || verification.legacy_marketing_settings || connectedCalendar) return res.status(500).json({ error: "DATABASE_DELETE_VERIFICATION_FAILED", verification, backup_id: backup.id }); res.json({ ok: true, provider, backup_id: backup.id, backup_sha256: backup.sha, verification, preserved: provider === "GOOGLE_CALENDAR" ? ["external_calendar_events", "calendar_sync_log"] : [] }); } catch (error) { res.status(error.status || 400).json({ error: error.message || "INTEGRATION_DELETE_FAILED" }); } });
}

module.exports = { PROVIDERS, PROVIDER_PERMISSIONS, encrypt, decryptCompatible, encryptionReady, createIntegrationCipher, migrateLegacyIntegrationSecrets, hydrateRuntimeSecrets, registerSystemIntegrationRoutes, saveIntegrationProvider: saveProvider, getIntegrationProvider: publicProvider, testIntegrationProvider: testProvider, _test: { normalizedConfig, providerConfig, secretBundle, saveProvider, publicProvider, permissionAllowed, providerEnabled, createExternalBackup, cleanupBackups, applyRuntimeProvider, systemEnabled } };
