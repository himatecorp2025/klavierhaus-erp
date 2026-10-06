"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Database=require("better-sqlite3");
const {createGoogleCalendarIntegration}=require("../server/google-calendar");

function setup(){
  const db=new Database(":memory:");db.pragma("foreign_keys=ON");db.exec(fs.readFileSync(path.join(__dirname,"..","server","schema.sql"),"utf8"));
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,google_calendar_email,calendar_color,hidden_user,is_superadmin) VALUES('A','Admin','admin@kh.test','x','ADMIN','Active','admin.calendar@gmail.com','#123456',0,0)").run();
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,google_calendar_email,calendar_color,hidden_user,is_superadmin) VALUES('W','Worker','worker@kh.test','x','WORKER','Active','worker.calendar@gmail.com','#654321',0,0)").run();
  db.prepare("INSERT INTO clients(id,name,email,client_type) VALUES(1,'Concert Client','client@example.com','INDIVIDUAL')").run();
  db.prepare("INSERT INTO pianos(id,client_id,brand,model,serial_number) VALUES(1,1,'Steinway','D','555111')").run();
  for(const [key,pos,type] of [['received',1,'start'],['in_progress',2,'intermediate'],['qa_review',3,'intermediate'],['admin_approval',4,'approval'],['completed',5,'completed']])db.prepare("INSERT INTO workflow_stage_definitions(stage_key,position,label_en,label_hu,stage_type,active,removable) VALUES(?,?,?,?,?,1,0)").run(key,pos,key,key,type);
  let n=0;const integration=createGoogleCalendarIntegration({db,rid:p=>`${p}-${++n}`,createNotification:()=>{},env:{GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_TOKEN_ENCRYPTION_KEY:'01234567890123456789012345678901',APP_BASE_URL:'https://erp.test',GOOGLE_CALENDAR_ID:'klavierhauswork@gmail.com',GOOGLE_CALENDAR_CENTRAL_EMAIL:'klavierhauswork@gmail.com'},fetchImpl:async()=>{throw new Error('network not expected')}});
  return {db,integration};
}
function event(id,{summary='Concert Client Steinway D tuning',description='client@example.com · concert preparation',creator='worker.calendar@gmail.com',etag='"v1"'}={}){return {id,etag,status:'confirmed',summary,description,location:'123 Piano Street',creator:{email:creator},organizer:{email:'klavierhauswork@gmail.com'},start:{dateTime:'2032-08-04T14:00:00-04:00'},end:{dateTime:'2032-08-04T16:00:00-04:00'},updated:'2032-08-01T12:00:00Z'};}

test('Google Calendar event auto-creates a Round 2 calendar job and workflow when client and piano are unambiguous',()=>{
  const {db,integration}=setup();const result=integration._test.processEvent(event('auto-1'));assert.equal(result.imported,1);
  const job=db.prepare("SELECT * FROM jobs").get();assert.equal(job.client_id,1);assert.equal(job.piano_id,1);assert.equal(job.assigned_technician_id,'W');assert.equal(job.stage,'received');assert.ok(job.scheduled_at.endsWith('Z'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM job_workflow_phases WHERE job_id=?").get(job.id).n,5);
  const source=db.prepare("SELECT * FROM external_calendar_events WHERE external_event_id='auto-1'").get();assert.equal(source.review_status,'REVIEWED');assert.equal(source.job_id,job.id);
  integration.stop();db.close();
});

test('Unresolved Google event is exposed in calendar and can be reviewed into a Round 2 workflow',()=>{
  const {db,integration}=setup();integration._test.processEvent(event('pending-1',{summary:'Unknown customer service',description:'Needs a piano visit'}));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM jobs").get().n,0);const source=db.prepare("SELECT * FROM external_calendar_events WHERE external_event_id='pending-1'").get();assert.equal(source.review_status,'NEEDS_REVIEW');
  const entries=integration.calendarEntries({from:'2032-08-04T00:00:00Z',to:'2032-08-05T23:59:59Z'});assert.equal(entries.length,1);assert.equal(entries[0].google_calendar_pending,true);
  const job=integration.reviewEvent(source.id,{client_id:1,piano_id:1,assigned_technician_id:'W'},'A');assert.equal(job.client_id,1);assert.equal(job.piano_id,1);assert.equal(job.stage,'received');
  assert.equal(db.prepare("SELECT review_status FROM external_calendar_events WHERE id=?").get(source.id).review_status,'REVIEWED');
  integration.stop();db.close();
});

test('Google source edits after review do not overwrite finalized ERP job data',()=>{
  const {db,integration}=setup();integration._test.processEvent(event('stable-1'));const source=db.prepare("SELECT * FROM external_calendar_events WHERE external_event_id='stable-1'").get(),job=db.prepare("SELECT * FROM jobs WHERE id=?").get(source.job_id);
  db.prepare("UPDATE jobs SET title='ERP finalized title' WHERE id=?").run(job.id);integration._test.processEvent(event('stable-1',{summary:'Changed in Google',etag:'"v2"'}));
  assert.equal(db.prepare("SELECT title FROM jobs WHERE id=?").get(job.id).title,'ERP finalized title');assert.equal(db.prepare("SELECT review_status FROM external_calendar_events WHERE id=?").get(source.id).review_status,'SOURCE_CHANGED');
  integration.stop();db.close();
});
