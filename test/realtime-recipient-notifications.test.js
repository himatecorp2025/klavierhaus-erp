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
  assert.equal(notifications.list("U1").notifications.some(row=>row.id===event.id),true);
  assert.equal(notifications.list("U2").notifications.some(row=>row.id===event.id),false);
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
