"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {EventEmitter}=require("node:events");
const Database=require("better-sqlite3");
const {createNotificationCenter}=require("../server/notification-center");

function fixture(){
  const db=new Database(":memory:");
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,status TEXT NOT NULL,role TEXT DEFAULT 'WORKER',is_superadmin INTEGER DEFAULT 0);
    CREATE TABLE notification_preferences(
      user_id TEXT PRIMARY KEY,notifications_enabled INTEGER NOT NULL DEFAULT 1,sound_enabled INTEGER NOT NULL DEFAULT 1,
      disabled_by_user_id TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notification_events(
      id TEXT PRIMARY KEY,category TEXT,entity_type TEXT,entity_id TEXT,title_en TEXT,title_hu TEXT,body_en TEXT,body_hu TEXT,
      action_url TEXT,severity TEXT,created_by_user_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT
    );
    CREATE TABLE notification_recipients(
      notification_id TEXT,user_id TEXT,read_at TEXT,snoozed_until TEXT,acknowledged_at TEXT,
      PRIMARY KEY(notification_id,user_id)
    );
    CREATE TABLE push_subscriptions(
      id TEXT PRIMARY KEY,user_id TEXT,endpoint TEXT UNIQUE,p256dh TEXT,auth_secret TEXT,user_agent TEXT,
      last_sent_at TEXT,last_error TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare("INSERT INTO users(id,status) VALUES('U1','Active'),('U2','Active')").run();
  return {db,notifications:createNotificationCenter({db,env:{}})};
}

class FakeResponse extends EventEmitter{
  constructor(){super();this.statusCode=0;this.headers={};this.chunks=[];}
  status(code){this.statusCode=code;return this;}
  setHeader(name,value){this.headers[name]=value;}
  flushHeaders(){}
  write(chunk){this.chunks.push(String(chunk));return true;}
}

test("explicit recipient receives the notification and other users do not",()=>{
  const {db,notifications}=fixture();
  const event=notifications.emit({category:"TEST",entityType:"JOB",entityId:"J1",titleEn:"Assigned job",recipients:["U1"]});
  const recipients=db.prepare("SELECT user_id FROM notification_recipients WHERE notification_id=? ORDER BY user_id").all(event.id).map(row=>row.user_id);
  assert.deepEqual(recipients,["U1"]);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notification_recipients WHERE notification_id=? AND user_id=\'U1\'").get(event.id).count,1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notification_recipients WHERE notification_id=? AND user_id=\'U2\'").get(event.id).count,0);
});

test("realtime stream publishes only to the addressed user",()=>{
  const {notifications}=fixture();
  const one=new FakeResponse(),two=new FakeResponse();
  assert.equal(notifications.attachRealtime(notifications.issueRealtimeTicket("U1").ticket,one),true);
  assert.equal(notifications.attachRealtime(notifications.issueRealtimeTicket("U2").ticket,two),true);
  one.chunks.length=0;two.chunks.length=0;
  notifications.emit({category:"TEST",entityType:"JOB",entityId:"J2",titleEn:"Realtime",recipients:["U1"]});
  assert.match(one.chunks.join(""),/event: notification/);
  assert.equal(two.chunks.join("").includes("event: notification"),false);
  one.emit("close");two.emit("close");
});

test("audit-derived assignment targets the assigned user",()=>{
  const {db,notifications}=fixture();
  const event=notifications.fromAudit({
    action:"UPDATE",module:"jobs",recordId:"J3",user:{id:"U2",name:"Manager"},
    newValue:{assigned_user_id:"U1"}
  });
  const recipients=db.prepare("SELECT user_id FROM notification_recipients WHERE notification_id=?").all(event.id).map(row=>row.user_id);
  assert.deepEqual(recipients,["U1"]);
});


test("audit notifications describe actor action object changes and carry record deep links",()=>{
  const {db,notifications}=fixture();
  const event=notifications.fromAudit({
    action:"UPDATE",module:"clients",recordId:"42",user:{id:"U2",name:"Alex"},
    oldValue:{name:"Paul Mills",phone:"old",address:"Old address"},
    newValue:{name:"Paul Mills",phone:"new",address:"New address"}
  });
  assert.match(event.title_en,/Alex updated client Paul Mills/);
  assert.match(event.body_en,/phone/);
  assert.match(event.body_en,/address/);
  assert.equal(event.action_url,"/?view=master&client=42");
  const stored=db.prepare("SELECT * FROM notification_events WHERE id=?").get(event.id);
  assert.equal(stored.action_url,"/?view=master&client=42");
});

test("deleted client and intake notifications navigate to their archived records",()=>{
  const {notifications}=fixture();
  const client=notifications.fromAudit({
    action:"DELETE",module:"clients",recordId:"42",user:{id:"U2",name:"Alex"},
    oldValue:{name:"Paul Mills"},newValue:{name:"Paul Mills",archive_document_id:700,category:"deleted_client"}
  });
  assert.match(client.title_en,/Alex deleted client Paul Mills/);
  assert.equal(client.action_url,"/?view=documents&category=deleted_client&archive=700");

  const intake=notifications.fromAudit({
    action:"DELETE",module:"intake",recordId:"9",user:{id:"U2",name:"Alex"},
    oldValue:{lead:{id:9,client_name:"Paul Mills",piano_brand:"Steinway",piano_model:"B",reported_issue:"Tuning"}},
    newValue:{archive_document_id:701,category:"deleted_intake"}
  });
  assert.match(intake.title_en,/deleted an intake request/);
  assert.match(intake.body_en,/Paul Mills/);
  assert.match(intake.body_en,/Steinway B/);
  assert.equal(intake.action_url,"/?view=documents&category=deleted_intake&archive=701");
});

test("paid invoice notification contains amount invoice client and finance deep link",()=>{
  const {notifications}=fixture();
  const event=notifications.fromAudit({
    action:"MARK_PAID",module:"invoices",recordId:"77",user:{id:"U2",name:"Alex"},
    oldValue:{invoice_number:"KH-1048",counterparty_name:"Paul Mills",total_amount:2000,status:"sent"},
    newValue:{invoice_number:"KH-1048",counterparty_name:"Paul Mills",total_amount:2000,status:"paid",payment_method:"Check"}
  });
  assert.equal(event.title_en,"Invoice payment recorded");
  assert.match(event.body_en,/Alex/);
  assert.match(event.body_en,/\$2,000\.00/);
  assert.match(event.body_en,/KH-1048/);
  assert.match(event.body_en,/Paul Mills/);
  assert.equal(event.action_url,"/?view=finance&invoice=77");
});
