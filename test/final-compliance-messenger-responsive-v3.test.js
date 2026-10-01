"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Messenger V3 loads after canonical Messenger and before application boot",()=>{
  const html=read("public/index.html"),sw=read("public/service-worker.js");
  assert.match(html,/\/messenger\.js"[\s\S]*\/messenger-responsive-v3\.js"[\s\S]*\/v6\.js"/);
  assert.match(sw,/klavierhaus-admin-v32-workflow-canonical-sync/);
  assert.match(sw,/"\/messenger-responsive-v3\.js"/);
});

test("Messenger V3 uses exactly the approved six icon sections",()=>{
  const source=read("public/messenger-responsive-v3.js");
  assert.match(source,/\["inbox","people","waiting","private","notifications","closed"\]/);
  for(const label of ["Inbox","People","Waiting","Private","Notifications","Closed"])assert.ok(source.includes(label),label);
  assert.doesNotMatch(source,/data-messenger-filter=\"PENDING_CUSTOMER\"/);
  assert.doesNotMatch(source,/data-messenger-filter=\"PENDING_STAFF\"/);
  assert.match(source,/messengerNavIcon/);
  assert.match(source,/messenger-nav-button/);
});

test("Inbox unread emphasis and after-hours Waiting are driven by backend data",()=>{
  const backend=read("server/website-conversations.js"),source=read("public/messenger-responsive-v3.js");
  assert.match(backend,/last_message_direction/);
  assert.match(backend,/last_customer_message_at/);
  assert.match(backend,/waiting_after_hours/);
  assert.match(backend,/supportState\(\{db,env,date:stamp\}\)/);
  assert.match(source,/last_message_direction/);
  assert.match(source,/unread_count/);
  assert.match(source,/waiting_after_hours/);
  assert.match(source,/is-unread/);
});

test("People, Private and Messenger notifications are first-class list views",()=>{
  const source=read("public/messenger-responsive-v3.js");
  assert.match(source,/function messengerPeople\(/);
  assert.match(source,/"email:"\+email\.toLowerCase/);
  assert.match(source,/conversation_id:row\.id/);
  assert.match(source,/function messengerRenderPrivate\(/);
  assert.match(source,/REQUESTED","PROPOSED/);
  assert.match(source,/function messengerNotifications\(/);
  assert.match(source,/CUSTOMER_CONVERSATION/);
  assert.match(source,/PRIVATE_APPOINTMENT/);
});

test("Admin Messenger is viewport-bound with mobile list thread context navigation",()=>{
  const source=read("public/messenger-responsive-v3.js"),css=read("public/styles.css"),app=read("public/app.js");
  assert.match(source,/messengerShowList/);
  assert.match(source,/messengerShowThread/);
  assert.match(source,/messengerShowContext/);
  assert.match(source,/messengerMobileBack/);
  assert.match(source,/messengerMobileInfo/);
  assert.match(css,/--kh-visual-viewport-height/);
  assert.match(css,/\.messenger-shell\.show-thread \.messenger-thread/);
  assert.match(css,/\.messenger-shell\.show-context \.messenger-context/);
  assert.match(css,/html\.messenger-thread-open \.mobile-nav\{display:none!important\}/);
  assert.match(app,/syncVisualViewportHeight/);
  assert.match(app,/messenger-workspace/);
});

test("all touch form controls use the iOS-safe font contract without disabling pinch zoom",()=>{
  const css=read("public/styles.css"),html=read("public/index.html");
  assert.match(css,/@media\(max-width:1024px\),\(pointer:coarse\)[\s\S]*select,textarea,\[contenteditable="true"\]\{font-size:16px!important\}/);
  assert.match(html,/width=device-width,initial-scale=1,viewport-fit=cover/);
  assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
});

test("public Messenger tracks Safari visualViewport and pins composer inside the keyboard viewport",()=>{
  const app=read("website/public/app.js"),css=read("website/public/styles.css"),server=read("website/server/index.js");
  assert.match(app,/window\.visualViewport/);
  assert.match(app,/--kh-chat-visual-height/);
  assert.match(app,/customerChatMobileMode/);
  assert.match(app,/customer-chat-open/);
  assert.match(css,/var\(--kh-chat-visual-height,100dvh\)/);
  assert.match(css,/grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(css,/html\.customer-chat-open,html\.customer-chat-open body/);
  assert.match(css,/@media\(max-width:1024px\),\(pointer:coarse\)[\s\S]*font-size:16px!important/);
  assert.match(server,/viewport-fit=cover/);
});
