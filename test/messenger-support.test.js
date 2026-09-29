"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {supportState,builtInHolidays}=require("../server/support-calendar");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

function fakeDb(rows=[]){return {prepare(){return {all(){return rows;}};}};}

test("New York support calendar opens weekdays 9-17 and closes for weekends and holidays",()=>{
  const db=fakeDb();
  assert.equal(supportState({db,date:new Date("2026-09-28T14:00:00Z")}).open,true); // Monday 10:00 ET
  assert.equal(supportState({db,date:new Date("2026-09-28T22:00:00Z")}).open,false); // 18:00 ET
  assert.equal(supportState({db,date:new Date("2026-09-27T14:00:00Z")}).reason,"WEEKEND");
  assert.equal(builtInHolidays(2026).has("2026-07-03"),true); // observed Independence Day
  assert.equal(builtInHolidays(2026).has("2026-04-03"),true); // Good Friday
});

test("Manual support holiday overrides are honored",()=>{
  const closed=fakeDb([{holiday_date:"2026-09-28",enabled:1,label:"Staff training"}]);
  assert.equal(supportState({db:closed,date:new Date("2026-09-28T14:00:00Z")}).reason,"HOLIDAY");
  const forcedOpen=fakeDb([{holiday_date:"2026-07-03",enabled:0,label:"Open by exception"}]);
  assert.equal(supportState({db:forcedOpen,date:new Date("2026-07-03T14:00:00Z")}).open,true);
});

test("Public Messenger exposes only the approved seven topics and styled attachments",()=>{
  const website=read("website/server/index.js");
  const select=website.match(/<select name="category">([\s\S]*?)<\/select>/)?.[1]||"";
  const values=[...select.matchAll(/option value="([A-Z_]+)"/g)].map(match=>match[1]);
  assert.deepEqual(values,["SERVICE","TECHNICAL","PIANO","REPAIR","PRIVATE_CONSULTATION","BILLING","OTHER"]);
  assert.doesNotMatch(select,/TICKET|REFUND|EVENT|GENERAL/);
  assert.match(website,/customer-chat__file-picker/);
  assert.match(read("website/public/styles.css"),/\.customer-chat__file-picker/);
  assert.match(read("website/public/app.js"),/data-proposal-decision/);
  assert.match(read("website/public/app.js"),/\/api\/site\/support-status/);
});

test("ERP Messenger is a dedicated view and mobile Planned moves under compact More",()=>{
  const html=read("public/index.html"),app=read("public/app.js"),v6=read("public/v6.js"),css=read("public/styles.css"),messenger=read("public/messenger.js"),sw=read("public/service-worker.js");
  const mobile=html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)?.[0]||"";
  assert.match(mobile,/data-nav="workshop"/);
  assert.match(mobile,/data-nav="messenger"/);
  assert.match(mobile,/data-nav="intake"/);
  assert.match(mobile,/data-nav="master"/);
  assert.match(mobile,/id="mobileMoreButton"/);
  assert.doesNotMatch(mobile,/data-nav="planned"/);
  assert.equal((mobile.match(/<button/g)||[]).length,5);
  assert.match(html,/data-nav="intake"[\s\S]*data-nav="messenger"[\s\S]*data-nav="planned"/);
  assert.match(app,/state\.view==="messenger"/);
  assert.match(app,/renderMessenger\(\)/);
  assert.match(v6,/data-nav="planned"/);
  assert.doesNotMatch(v6,/function v6OpenMore\(\)\{[\s\S]{0,120}openDialog/);
  assert.match(css,/\.mobile-more-popover\{position:fixed/);
  assert.match(css,/max-height:min\(62vh,470px\)/);
  assert.match(messenger,/\/api\/customer-conversations/);
  assert.match(messenger,/Propose appointment/);
  assert.match(messenger,/Create \/ edit Intake/);
  assert.match(sw,/"\/messenger\.js"/);
});

test("Intake required-work cards use compact More-like two-column mobile cards",()=>{
  const css=read("public/styles.css");
  assert.match(css,/New Intake work cards use the same compact card language as More/);
  assert.match(css,/Intake work selectors deliberately mirror the More-menu card language/);\n  assert.match(css,/\.assessment-option-icon/);
  assert.match(css,/@media\(max-width:700px\)[\s\S]*\.assessment-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(css,/\.assessment-option>input\[type="checkbox"\]\{position:absolute/);
});

test("Canonical Messenger backend routes assignment, notifications, appointments and manual Intake creation",()=>{
  const backend=read("server/website-conversations.js"),schema=read("server/schema.sql"),index=read("server/index.js");
  assert.match(backend,/PUBLIC_CATEGORIES=new Set\(\["SERVICE","TECHNICAL","PIANO","REPAIR","PRIVATE_CONSULTATION","BILLING","OTHER"\]\)/);
  assert.match(backend,/actionUrl:"#messenger"/);
  assert.match(backend,/recipients:supportRecipients\(row\.assigned_user_id\)/);
  assert.match(backend,/\/api\/customer-conversations\/:id\/appointment-proposals/);
  assert.match(backend,/\/api\/customer-conversations\/:id\/intake-draft/);
  assert.match(backend,/INTAKE_REQUIRES_REVIEW/);
  assert.match(backend,/source_conversation_id/);
  assert.doesNotMatch(backend.slice(backend.indexOf("appointment-proposals/:proposalId/respond"),backend.indexOf("attachments/:attachmentId")) ,/INSERT INTO private_appointments/);
  assert.doesNotMatch(backend,/INSERT INTO jobs/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS customer_appointment_proposals/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS support_holidays/);
  assert.match(index,/registerWebsiteConversationRoutes\(\{[\s\S]*transactionalEmail[\s\S]*websiteBaseUrl/);
});


test("Messenger private requests require staff approval while accepted Klavierhaus proposals auto-finalize to calendar",()=>{
  const messenger=read("public/messenger.js"),privateApi=read("server/private-appointments.js"),conversation=read("server/website-conversations.js"),schema=read("server/schema.sql"),css=read("public/styles.css");
  assert.match(css,/\.messenger-status-cards/);
  assert.match(css,/\.messenger-status-card/);
  assert.match(messenger,/Private requests/);
  assert.doesNotMatch(messenger,/Finalize & add to calendar/);
  assert.match(messenger,/Approve & add to calendar/);
  assert.match(privateApi,/CREATE|private_appointment_requests/);
  assert.match(privateApi,/\/api\/private-appointment-requests\/\:id\/approve/);
  assert.match(privateApi,/\/appointment-proposals\/\:proposalId\/finalize/);
  assert.match(conversation,/auto_finalized:true/);
  assert.match(conversation,/INSERT INTO private_appointments/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS private_appointment_requests/);
  assert.match(schema,/duration_min INTEGER NOT NULL DEFAULT 60/);
  assert.match(schema,/expires_at TEXT/);
});
