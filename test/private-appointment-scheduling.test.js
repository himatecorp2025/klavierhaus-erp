"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const Database=require("better-sqlite3");
const {availability,assertAvailable,interval,BUFFER_MIN}=require("../server/private-appointment-scheduling");

function fixture(){
  const db=new Database(":memory:");
  db.exec(`
    CREATE TABLE private_appointments(
      id TEXT PRIMARY KEY,
      scheduled_at TEXT NOT NULL,
      scheduled_end_at TEXT,
      duration_min INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'SCHEDULED'
    );
    CREATE TABLE customer_appointment_proposals(
      id TEXT PRIMARY KEY,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL,
      private_appointment_id TEXT,
      expires_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE private_appointment_requests(
      id TEXT PRIMARY KEY,
      requested_at TEXT NOT NULL,
      requested_duration_min INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'REQUESTED',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

test("private appointments default to 60 minutes and accept longer 15-minute increments",()=>{
  assert.equal(interval({startsAt:"2035-08-20T14:00:00.000Z"}).duration_min,60);
  assert.equal(interval({startsAt:"2035-08-20T14:00:00.000Z",duration:90}).duration_min,90);
  assert.equal(interval({startsAt:"2035-08-20T14:00:00.000Z",duration:120}).ends_at,"2035-08-20T16:00:00.000Z");
  assert.throws(()=>interval({startsAt:"2035-08-20T14:00:00.000Z",duration:65}),/INVALID_PRIVATE_APPOINTMENT_DURATION/);
});

test("scheduled private appointments require a 15-minute gap before the next appointment",()=>{
  const db=fixture();
  db.prepare("INSERT INTO private_appointments(id,scheduled_at,scheduled_end_at,duration_min,status) VALUES('PA-1',?,?,60,'SCHEDULED')")
    .run("2035-08-20T14:00:00.000Z","2035-08-20T15:00:00.000Z");
  assert.equal(BUFFER_MIN,15);
  assert.equal(availability(db,{startsAt:"2035-08-20T15:00:00.000Z",duration:60}).ok,false);
  assert.equal(availability(db,{startsAt:"2035-08-20T15:14:00.000Z",duration:60}).ok,false);
  assert.equal(availability(db,{startsAt:"2035-08-20T15:15:00.000Z",duration:60}).ok,true);
  assert.throws(()=>assertAvailable(db,{startsAt:"2035-08-20T13:30:00.000Z",duration:60}),/PRIVATE_APPOINTMENT_CONFLICT/);
});

test("active appointment proposals are soft holds and expired proposals release the slot",()=>{
  const db=fixture(),future=new Date(Date.now()+60*60*1000).toISOString(),past=new Date(Date.now()-60*60*1000).toISOString();
  db.prepare("INSERT INTO customer_appointment_proposals(id,starts_at,ends_at,status,expires_at) VALUES('APR-1',?,?, 'PROPOSED',?)")
    .run("2035-08-20T18:00:00.000Z","2035-08-20T19:00:00.000Z",future);
  const held=availability(db,{startsAt:"2035-08-20T18:30:00.000Z",duration:60});
  assert.equal(held.ok,false);assert.equal(held.conflict_type,"PROPOSAL");

  db.prepare("UPDATE customer_appointment_proposals SET expires_at=? WHERE id='APR-1'").run(past);
  const released=availability(db,{startsAt:"2035-08-20T18:30:00.000Z",duration:60});
  assert.equal(released.ok,true);
  assert.equal(db.prepare("SELECT status FROM customer_appointment_proposals WHERE id='APR-1'").get().status,"CANCELLED");
});


test("recent public requests temporarily hold the selected slot and approval can exclude its own hold",()=>{
  const db=fixture();
  db.prepare("INSERT INTO private_appointment_requests(id,requested_at,requested_duration_min,status) VALUES('PAR-1',?,?, 'REQUESTED')")
    .run("2035-08-20T16:00:00.000Z",60);
  const held=availability(db,{startsAt:"2035-08-20T16:00:00.000Z",duration:60});
  assert.equal(held.ok,false);assert.equal(held.conflict_type,"REQUEST");
  assert.equal(held.code,"PRIVATE_APPOINTMENT_REQUEST_HOLD_CONFLICT");
  assert.equal(availability(db,{startsAt:"2035-08-20T16:00:00.000Z",duration:60,excludeRequestId:"PAR-1"}).ok,true);
  db.prepare("UPDATE private_appointment_requests SET created_at=datetime('now','-3 days') WHERE id='PAR-1'").run();
  assert.equal(availability(db,{startsAt:"2035-08-20T16:00:00.000Z",duration:60}).ok,true);
});
