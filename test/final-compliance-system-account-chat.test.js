"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Klavierhaus System account chrome separates login, profile and settings",()=>{
  const html=read("public/index.html"),app=read("public/app.js"),v6=read("public/v6.js"),schema=read("server/schema.sql"),admin=read("server/admin-ux-v6.js");
  assert.match(html,/<title>Klavierhaus System<\/title>/);
  assert.doesNotMatch(html,/id="loginThemeToggle"/);
  assert.match(html,/id="profileMenu"/);
  assert.match(html,/data-profile-menu="profile"/);
  assert.match(html,/data-profile-menu="settings"/);
  assert.match(html,/data-profile-menu="logout"/);
  assert.match(html,/id="headerWelcome"/);
  assert.match(app,/KLAVIERHAUS SYSTEM/);
  assert.match(app,/"settings"/);
  assert.match(v6,/document\.documentElement\.dataset\.theme="dark"/);
  assert.match(v6,/login_logo_url/);
  assert.match(v6,/async function renderSettings/);
  assert.match(v6,/\/api\/me\/profile-image/);
  assert.match(v6,/Welcome to the Klavierhaus System/);
  assert.match(schema,/language_preference TEXT NOT NULL DEFAULT 'en'/);
  assert.match(schema,/profile_image_url TEXT/);
  assert.match(admin,/app\.put\("\/api\/me\/profile"/);
  assert.match(admin,/app\.post\("\/api\/me\/profile-image"/);
  assert.match(admin,/route:"login-logo"/);
});

test("full Website factory reset is rendered only for Superadmin",()=>{
  const v6=read("public/v6.js"),backend=read("server/website-backup-reset.js");
  assert.match(v6,/recovery-danger-card/);
  assert.match(v6,/isSuper\?/);
  assert.doesNotMatch(v6,/Superadmin permission required\./);
  assert.match(backend,/requireSuperadmin/);
  assert.match(backend,/login_logo_url/);
});

test("public customer service matches the approved Messenger interaction contract",()=>{
  const server=read("website/server/index.js"),client=read("website/public/app.js"),css=read("website/public/styles.css"),conversation=read("server/website-conversations.js"),upload=read("server/upload-middleware.js");
  assert.match(server,/Klavierhaus Customer Service/);
  assert.match(server,/data-chat-camera/);
  assert.match(server,/data-chat-photo-input/);
  assert.match(server,/data-chat-voice/);
  assert.match(server,/data-chat-emoji/);
  assert.match(server,/enterkeyhint="send"/);
  assert.doesNotMatch(server,/customer-chat__send-button/);
  assert.match(server,/camera=\(self\), microphone=\(self\)/);
  assert.match(client,/MediaRecorder/);
  assert.match(client,/kind==="video"\?60000:300000/);
  assert.match(client,/customerChatPendingFiles/);
  assert.match(client,/customer-chat__message-time/);
  assert.match(client,/video\.controls=true/);
  assert.match(client,/audio\.controls=true/);
  assert.match(css,/approved Messenger reference/);
  assert.match(css,/grid-template-columns:2\.8rem 2\.8rem 2\.8rem minmax\(0,1fr\)/);
  assert.match(css,/background:linear-gradient\(145deg,#e0c27f,#c6a45d\)/);
  assert.match(conversation,/Welcome to Klavierhaus Customer Service/);
  assert.match(conversation,/!body&&!\(req\.files\|\|\[\]\)\.length/);
  assert.match(upload,/video\/mp4/);
  assert.match(upload,/audio\/webm/);
});
