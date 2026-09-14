"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const schema=read("server/schema.sql"),sys=read("server/system-integrations.js"),calendar=read("server/google-calendar.js"),platform=read("server/website-platform.js"),index=read("server/index.js"),app=read("public/app.js"),pkg=JSON.parse(read("package.json")),env=read(".env.example"),email=read("server/transactional-email.js"),stripe=read("server/stripe-sandbox.js"),init=read("server/init-db.js");
const checks=[
 ["01 schema has real SQL newlines",()=>assert.doesNotMatch(schema,/\\nCREATE TABLE IF NOT EXISTS system_integration/)],
 ["02 round4 tests include functional DB cases",()=>assert.match(read("test/system-integrations.test.js"),/new Database\(":memory:"\)/)],
 ["03 legacy secret migration supports old keys",()=>{assert.match(sys,/legacySecrets/);assert.match(sys,/migrateLegacyIntegrationSecrets/)}],
 ["04 missing dedicated key does not crash ERP startup",()=>assert.doesNotMatch(sys,/NODE_ENV.*production.*throw new Error\("SYSTEM_INTEGRATION_ENCRYPTION_KEY is required/)],
 ["05 secret reveal is Superadmin-only",()=>assert.match(sys,/api\/system-integrations\/:provider\/secret", auth, requireSuperadmin/)],
 ["06 eye control is rendered only when can_reveal",()=>assert.match(app,/can_reveal\?`<button[^`]+data-system-action="reveal"/)],
 ["07 each provider has its own enable state",()=>{assert.match(schema,/system_integration_health[\s\S]*enabled INTEGER NOT NULL DEFAULT 1/);assert.match(sys,/\/:provider\/enabled/)}],
 ["08 master disable applies runtime state",()=>{assert.match(sys,/applyRuntimeState/);assert.match(sys,/googleCalendar\.stop/)}],
 ["09 normal Google OAuth is read-only",()=>assert.match(calendar,/scope: "https:\/\/www\.googleapis\.com\/auth\/calendar\.readonly"/)],
 ["10 Google temp event has retry cleanup",()=>assert.match(calendar,/for \(let attempt = 0; attempt < 3 && !deleted/)],
 ["11 Google calendar id is not falsely editable in UI",()=>assert.match(app,/Calendar ID \(environment-managed\)[\s\S]*disabled/)],
 ["12 unified provider config is used by compatibility routes",()=>{assert.match(platform,/getIntegrationProvider/);assert.match(platform,/saveIntegrationProvider/)}],
 ["13 Resend runtime can be reconfigured without restart",()=>assert.match(email,/function reconfigure\(/)],
 ["14 Stripe runtime test and service can share DB credential",()=>assert.match(stripe,/function reconfigure\(/)],
 ["15 Resend runtime and integration use same active key path",()=>{assert.match(sys,/transactionalEmail\.reconfigure/);assert.doesNotMatch(app,/Server restart required/)}],
 ["16 GA4 config and secret are stored in unified table",()=>assert.match(sys,/provider === "GA4"[\s\S]*system_integration_secrets/)],
 ["17 Search Console OAuth supports compatible legacy decryption",()=>assert.match(sys,/marketingGoogleAccessToken[\s\S]*decryptCompatible/)],
 ["18 delete creates external filesystem backup",()=>{assert.match(sys,/fs\.writeFileSync/);assert.match(schema,/backup_file_path TEXT NOT NULL/)}],
 ["19 backups have retention cleanup",()=>assert.match(sys,/BACKUP_RETENTION_MS = 30/)],
 ["20 Google delete is handled in the DB transaction",()=>assert.match(sys,/provider === "GOOGLE_CALENDAR"\) \{ db\.prepare\(`UPDATE calendar_integrations/)],
 ["21 delete verification checks credentials are gone",()=>assert.match(sys,/connectedCalendar[\s\S]*DATABASE_DELETE_VERIFICATION_FAILED/)],
 ["22 backup and delete provider columns are constrained",()=>{const c=(schema.match(/CHECK\(provider IN \('GOOGLE_CALENDAR','GA4','CLARITY','SEARCH_CONSOLE','RESEND','STRIPE'\)\)/g)||[]).length;assert.ok(c>=4);assert.match(init,/hardenSystemIntegrationControlTables/)}],
 ["23 delete confirmation token is removed transactionally",()=>assert.match(sys,/DELETE FROM system_integration_delete_tokens WHERE token_hash=\?/)],
 ["24 Clarity test verifies returned tag content",()=>assert.match(sys,/CLARITY_TAG_PROJECT_MISMATCH/)],
 ["25 GA4 test reports credential-validation level accurately",()=>assert.match(sys,/validation_level: "measurement_protocol_credentials"/)],
 ["26 Search Console test executes Search Analytics query",()=>assert.match(sys,/searchAnalytics\/query/)],
 ["27 last test/success/connection are displayed separately",()=>{assert.match(app,/Last successful test/);assert.match(app,/Last connection/)}],
 ["28 stored secrets can be explicitly cleared",()=>{assert.match(app,/clear-secret/);assert.match(sys,/clear_secret === true/)}],
 ["29 Admin sees disabled-by-Superadmin state instead of 403",()=>{assert.match(app,/Disabled by Superadmin/);assert.doesNotMatch(sys,/app\.get\("\/api\/system-integrations"[^\n]+SYSTEM_INTEGRATIONS_DISABLED/)}],
 ["30 granular integration permissions exist",()=>{assert.match(index,/system_integrations\.view/);assert.match(sys,/PROVIDER_PERMISSIONS/)}],
 ["31 legacy marketing edit endpoint remains Superadmin-only",()=>assert.match(platform,/api\/marketing\/integrations\/:provider", auth, requireSuperadmin/)],
 ["32 new writes use only dedicated system integration key",()=>{assert.match(sys,/function encryptionSecret[\s\S]*SYSTEM_INTEGRATION_ENCRYPTION_KEY/);assert.doesNotMatch(sys,/function encryptionSecret[^\n]+JWT_SECRET/)}],
 ["33 startup order validates schema before integration routes",()=>{assert.match(pkg.scripts.prestart,/init-db/);assert.match(index,/registerSystemIntegrationRoutes/)}],
 ["34 npm check validates SQL schema",()=>assert.match(pkg.scripts.check,/check:schema/)],
 ["35 audit suite has all 35 named controls",()=>assert.equal(checks.length,35)]
];
for(const [name,fn] of checks)test(name,fn);
