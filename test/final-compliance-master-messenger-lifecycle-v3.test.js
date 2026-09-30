"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Messenger schema stores customer activity cycles for deduplicated notifications",()=>{
  const schema=read("server/schema.sql"),init=read("server/init-db.js");
  assert.match(schema,/activity_cycle INTEGER NOT NULL DEFAULT 1/);
  assert.match(schema,/last_notified_activity_cycle INTEGER NOT NULL DEFAULT 0/);
  assert.match(init,/ensureColumn\("customer_conversations","activity_cycle"/);
  assert.match(init,/ensureColumn\("customer_conversations","last_notified_activity_cycle"/);
});

test("public Messenger closes stale sessions after exactly five minutes and requires identity reauthentication",()=>{
  const backend=read("server/website-conversations.js");
  assert.match(backend,/CUSTOMER_INACTIVITY_MS=5\*60\*1000/);
  assert.match(backend,/closure_note='CUSTOMER_INACTIVITY'/);
  assert.match(backend,/CONVERSATION_REAUTH_REQUIRED/);
  assert.match(backend,/required_fields:\["name","email","category"\]/);
  assert.match(backend,/function matchingConversation\(name,mail,category\)/);
  assert.match(backend,/normalizedIdentityName\(row\.name\)===normalized/);
  assert.match(backend,/activity_cycle=\?/);
  assert.match(backend,/CUSTOMER_IDENTITY_MATCH/);
});

test("customer notifications are once per activity cycle and staff reopen waits for the customer reply",()=>{
  const backend=read("server/website-conversations.js");
  assert.match(backend,/function notifyConversationOnce/);
  assert.match(backend,/if\(notified>=cycle\)return false/);
  assert.match(backend,/last_notified_activity_cycle=\?/);
  assert.match(backend,/if\(wasClosed\|\|customerMessageId\)notifyConversationOnce/);
  assert.match(backend,/reopening=row\.status==="CLOSED"&&status!=="CLOSED"/);
  assert.match(backend,/STAFF_REOPENED/);
  assert.match(backend,/notifyConversationOnce\(after,\{titleEn:"Customer reply"/);
  assert.doesNotMatch(backend,/function notifyConversation\(/);
});

test("outside support hours the first staff message explains 9 to 5 availability but chat remains writable",()=>{
  const backend=read("server/website-conversations.js");
  assert.match(backend,/Our customer service team is currently unavailable and is available from 9:00 AM to 5:00 PM New York time/);
  assert.match(backend,/Ügyfélszolgálatunk jelenleg nem elérhető\. Munkatársaink 9:00 és 17:00 között érhetők el/);
  assert.match(backend,/sendOfflineAutoReply/);
  assert.match(backend,/outside_support_hours:!support\.open/);
});

test("public Messenger has no visible send control or duplicate message label and has a close button",()=>{
  const html=read("website/server/index.js"),browser=read("website/public/app.js");
  const start=html.indexOf('<div class="customer-chat__composer" data-chat-composer hidden>'),end=html.indexOf('<div class="customer-chat__recording"',start),composer=html.slice(start,end);
  assert.ok(start>=0);
  assert.match(html,/data-chat-panel-close/);
  assert.match(composer,/enterkeyhint="send"/);
  assert.match(composer,/aria-label="\$\{escapeHtml\(chatCopy\.message\)\}"/);
  assert.doesNotMatch(composer,/data-chat-hidden-submit|customer-chat__send-button/);
  assert.doesNotMatch(composer,/<label class="sr-only" for="customer-chat-message">/);
  assert.match(browser,/if\(event\.key==="Enter"&&!event\.shiftKey&&!event\.isComposing\)/);
  assert.match(browser,/data-chat-panel-close/);
  assert.match(browser,/setCustomerChatPanel\(false\)/);
});

test("public Messenger never exceeds the viewport and touch inputs use 16px to prevent focus zoom",()=>{
  const css=read("website/public/styles.css");
  assert.match(css,/width:min\(32rem,calc\(100dvw - 2rem\)\)/);
  assert.match(css,/max-width:calc\(100dvw - 2rem\)/);
  assert.match(css,/\.customer-chat__panel\{[\s\S]*?max-width:100%!important/);
  assert.match(css,/@media\(max-width:1024px\),\(pointer:coarse\)[\s\S]*?font-size:16px!important/);
  assert.match(css,/@media\(max-width:600px\)[\s\S]*?width:100dvw!important[\s\S]*?height:100dvh!important/);
});

test("closed public threads return to the identity form and resume with name email topic",()=>{
  const browser=read("website/public/app.js");
  assert.match(browser,/function showCustomerConversationClosed/);
  assert.match(browser,/clearCustomerConversationSession/);
  assert.match(browser,/name, email address, and the same topic again/);
  assert.match(browser,/nevét, e-mail-címét és ugyanazt az ügyet/);
  assert.match(browser,/conversation\.status==="CLOSED"/);
});

test("CMS Login logo has preview upload backend persistence and login application",()=>{
  const v6=read("public/v6.js"),backend=read("server/admin-ux-v6.js"),server=read("server/index.js");
  assert.match(v6,/v6BrandAssetCard\("loginLogo"/);
  assert.match(v6,/kind==="loginLogo"\)await uploadBranding\("\/api\/settings\/branding\/login-logo",file\)/);
  assert.match(v6,/const loginUrl=branding\.login_logo_url\|\|branding\.erp_logo_dark_url\|\|branding\.logo_url/);
  assert.match(v6,/v6BrandAssetUrl\(url\)/);
  assert.match(backend,/\{route:"login-logo",key:"login_logo_url",min:192\}/);
  assert.match(server,/login_logo_url:setting\("login_logo_url",legacyLogo\)/);
});

test("Master Data production reconcile is versioned to rerun the relationship repair",()=>{
  const init=read("server/init-db.js"),reconcile=read("server/master-data-reconcile.js"),schema=read("server/schema.sql");
  assert.match(init,/2026-09-30-full-33-column-3/);
  assert.match(reconcile,/function repairSourceRelationships/);
  assert.match(reconcile,/UPDATE pianos SET client_id=\?,updated_at=CURRENT_TIMESTAMP/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS master_data_source_rows/);
  assert.match(schema,/raw_sha256 TEXT NOT NULL/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS master_data_client_field_values/);
  assert.match(schema,/last_visit TEXT/);
  assert.match(reconcile,/MASTER_IMPORT_CONTRACT/);
  assert.match(reconcile,/preservedNonEmptyValues/);
});

test("four client segments are canonical throughout schema API and Master Data UI",()=>{
  const schema=read("server/schema.sql"),api=read("server/round1-core.js"),identity=read("server/client-identity.js"),app=read("public/app.js");
  assert.match(schema,/client_type TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK\(client_type IN \('INDIVIDUAL','PARTNER','BUSINESS','INSTITUTION'\)\)/);
  assert.match(api,/CLIENT_TYPES=new Set\(\["INDIVIDUAL","PARTNER","BUSINESS","INSTITUTION"\]\)/);
  assert.match(identity,/\["INDIVIDUAL","PARTNER","BUSINESS","INSTITUTION"\]/);
  for(const type of ["INDIVIDUAL","PARTNER","BUSINESS","INSTITUTION"])assert.ok(app.includes('masterToolButton("'+type+'"')||app.includes('option value="'+type+'"'),type);
});
