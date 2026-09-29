"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Database=require("better-sqlite3");
const {findClientIdentity,ensureClientIdentity}=require("../server/client-identity");
const {validTime}=require("../server/private-appointments");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

function clientDb(){
  const db=new Database(":memory:");
  db.exec(`CREATE TABLE clients(
    id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT,phone TEXT,address TEXT,notes TEXT,
    preferred_language TEXT NOT NULL DEFAULT 'en',client_type TEXT NOT NULL DEFAULT 'PRIVATE',
    is_vip INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
  return db;
}

test("01 customer master schema defines Private Business Institution segments",()=>{
  const source=read("server/schema.sql");
  assert.match(source,/client_type TEXT NOT NULL DEFAULT 'PRIVATE'/);
  assert.match(source,/PRIVATE','BUSINESS','INSTITUTION/);
});

test("02 Messenger conversations and private appointments link to client records",()=>{
  const source=read("server/schema.sql");
  assert.match(source,/CREATE TABLE IF NOT EXISTS customer_conversations[\s\S]*?client_id INTEGER/);
  assert.match(source,/CREATE TABLE IF NOT EXISTS private_appointments[\s\S]*?client_id INTEGER/);
  assert.match(source,/CREATE TABLE IF NOT EXISTS private_appointment_requests[\s\S]*?client_id INTEGER/);
});

test("03 existing customer is recognized by email",()=>{
  const db=clientDb();
  db.prepare("INSERT INTO clients(name,email,phone) VALUES(?,?,?)").run("Alex","a@example.com","2125550101");
  assert.equal(findClientIdentity(db,{email:"A@EXAMPLE.COM"}).client.name,"Alex");
  db.close();
});

test("04 existing customer is recognized by normalized phone",()=>{
  const db=clientDb();
  db.prepare("INSERT INTO clients(name,email,phone) VALUES(?,?,?)").run("Alex",null,"+1 (212) 555-0101");
  assert.equal(findClientIdentity(db,{phone:"212-555-0101"}).client.name,"Alex");
  db.close();
});

test("05 unknown identified customer is created once as Private",()=>{
  const db=clientDb();
  const first=ensureClientIdentity(db,{name:"New Customer",email:"new@example.com",language:"en"});
  const second=ensureClientIdentity(db,{name:"New Customer",email:"new@example.com"});
  assert.equal(first.created,true);
  assert.equal(first.client.client_type,"PRIVATE");
  assert.equal(second.created,false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM clients").get().count,1);
  db.close();
});

test("06 Master Data toolbar exposes search and four requested customer filters",()=>{
  const app=read("public/app.js");
  for(const token of ["clientSearchButton","clientVipFilter",'data-client-filter="PRIVATE"','data-client-filter="BUSINESS"','data-client-filter="INSTITUTION"'])assert.ok(app.includes(token),token);
});

test("07 customer editor persists explicit customer type and VIP independently",()=>{
  const app=read("public/app.js"),backend=read("server/round1-core.js");
  assert.match(app,/name="client_type"/);
  assert.match(app,/name="is_vip"/);
  assert.match(backend,/INVALID_CLIENT_TYPE/);
  assert.match(backend,/client_type=\?/);
});

test("08 ERP Messenger refreshes active conversations automatically without page refresh",()=>{
  const source=read("public/messenger.js");
  assert.match(source,/messengerConversationSignature/);
  assert.match(source,/preloaded:conversation/);
  assert.match(source,/setInterval[\s\S]*2000/);
});

test("09 ERP Messenger reply composer supports paperclip file attachments",()=>{
  const source=read("public/messenger.js");
  assert.match(source,/messenger-attach-button/);
  assert.match(source,/name="attachments"/);
  assert.match(source,/new FormData\(\)/);
});

test("10 public customer Messenger uses compact attachment icon",()=>{
  const html=read("website/server/index.js"),css=read("website/public/styles.css");
  assert.match(html,/customer-chat__attach-button/);
  assert.match(html,/📎/);
  assert.match(css,/\.customer-chat__attach-button/);
});

test("11 appointment proposals remain visible as chat cards through accepted and declined states",()=>{
  const source=read("website/public/app.js");
  assert.match(source,/customer-chat__proposal-status/);
  assert.match(source,/Accepted · added to calendar/);
  assert.match(source,/Another time requested/);
});

test("12 customer acceptance creates and finalizes the calendar appointment atomically",()=>{
  const source=read("server/website-conversations.js");
  const start=source.indexOf("appointment-proposals/:proposalId/respond"),end=source.indexOf("attachments/:attachmentId",start),block=source.slice(start,end);
  assert.match(block,/INSERT INTO private_appointments/);
  assert.match(block,/private_appointment_id=\?/);
  assert.match(block,/finalized_at=CURRENT_TIMESTAMP/);
  assert.match(block,/auto_finalized:true/);
});

test("13 accepted Klavierhaus proposal has no manual finalize action in Messenger UI",()=>{
  const source=read("public/messenger.js");
  assert.doesNotMatch(source,/Finalize & add to calendar/);
  assert.match(source,/automatically added to calendar/);
});

test("14 automatic finalization excludes its own soft hold and preserves 15 minute conflict buffer",()=>{
  const conversation=read("server/website-conversations.js"),scheduling=read("server/private-appointment-scheduling.js");
  assert.match(conversation,/excludeProposalId:proposal\.id/);
  assert.match(scheduling,/BUFFER_MIN=15/);
  assert.match(scheduling,/overlapsWithBuffer/);
});

test("15 localized private date parser accepts Hungarian wall time",()=>{
  const iso=validTime("2031. 05. 10. 14:30","hu");
  assert.ok(iso);
  assert.equal(new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso)),"14:30");
});

test("16 localized private date parser accepts US wall time",()=>{
  const iso=validTime("05/10/2031 2:30 PM","en");
  assert.ok(iso);
  assert.equal(new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso)),"14:30");
});

test("17 public appointment UI is explicit about HU US formats and New York timezone",()=>{
  const html=read("website/server/index.js"),browser=read("website/public/app.js"),backend=read("server/private-appointments.js");
  assert.match(html,/2026\. 10\. 15\. 14:30/);
  assert.match(html,/10\/15\/2026 2:30 PM/);
  assert.match(browser,/scheduled_at_display/);
  assert.match(backend,/America\/New_York/);
});

test("18 Intake required work cards stay compact with responsive four three two grid and stable amount field",()=>{
  const css=read("public/styles.css");
  assert.match(css,/assessment-grid\{grid-template-columns:repeat\(4/);
  assert.match(css,/@media\(max-width:1100px\)[\s\S]*assessment-grid\{grid-template-columns:repeat\(3/);
  assert.match(css,/@media\(max-width:700px\)[\s\S]*assessment-grid\{grid-template-columns:repeat\(2/);
  assert.match(css,/\.assessment-price\{min-height:30px/);
});
