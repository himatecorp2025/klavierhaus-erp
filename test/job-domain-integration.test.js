"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createJobDomain } = require("../server/job-domain");
const { createGoogleCalendarIntegration } = require("../server/google-calendar");

const root = path.join(__dirname, "..");
const schema = fs.readFileSync(path.join(root, "server", "schema.sql"), "utf8");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function dbWithSchema() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  return db;
}
function seedPeople(db) {
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,calendar_color,google_calendar_email,hidden_user,is_superadmin) VALUES('U1','Admin','admin@example.com','x','ADMIN','Active','#2563EB','admin.calendar@gmail.com',0,0)").run();
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,calendar_color,google_calendar_email,hidden_user,is_superadmin) VALUES('U2','Worker','worker@example.com','x','WORKER','Active','#0891B2','worker.calendar@gmail.com',0,0)").run();
  db.prepare("INSERT INTO contacts(id,name,email,status) VALUES('C1','Client','client@example.com','Active')").run();
  db.prepare("INSERT INTO pianos(id,display_name,brand,model,owner_contact_id,status) VALUES('P1','Steinway D','Steinway','D','C1','Active')").run();
}

function googleSetup() {
  const db = dbWithSchema();
  seedPeople(db);
  let seq = 0;
  const rid = (prefix) => `${prefix}-${++seq}`;
  const getJob = (id) => db.prepare(`SELECT j.*,u.calendar_color assigned_calendar_color,e.review_status calendar_review_status,e.conflict_flag calendar_conflict_flag
    FROM jobs j LEFT JOIN users u ON u.id=j.assigned_user_id LEFT JOIN external_calendar_events e ON e.job_id=j.id WHERE j.id=?`).get(id);
  const findScheduleConflicts = (userId, _name, start, end, exclude = null) => {
    let sql = "SELECT * FROM jobs WHERE assigned_user_id=? AND status<>'Cancelled' AND ?<end_time AND ?>start_time";
    const params = [userId, start, end];
    if (exclude) { sql += " AND id<>?"; params.push(exclude); }
    return db.prepare(sql).all(...params);
  };
  const integration = createGoogleCalendarIntegration({
    db, rid, stableJobKey: () => `JK-${++seq}`,
    nyLocalDateTime: (date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(" ", "T"),
    findScheduleConflicts, getJob, createNotification: () => {},
    env: { GOOGLE_CLIENT_ID:"client", GOOGLE_CLIENT_SECRET:"secret", GOOGLE_TOKEN_ENCRYPTION_KEY:"separate-test-encryption-key-at-least-32-chars", APP_BASE_URL:"https://erp.example.com", GOOGLE_CALENDAR_ID:"klavierhauswork@gmail.com", GOOGLE_CALENDAR_CENTRAL_EMAIL:"klavierhauswork@gmail.com" },
    fetchImpl: async () => { throw new Error("unexpected network request"); }
  });
  return { db, integration, getJob };
}
function googleEvent() {
  return { id:"event-review", etag:'"v1"', status:"confirmed", summary:"Concert prep", description:"Full Google description", location:"123 Piano Street", creator:{email:"worker.calendar@gmail.com"}, organizer:{email:"klavierhauswork@gmail.com"}, start:{dateTime:"2032-08-04T14:00:00-04:00"}, end:{dateTime:"2032-08-04T16:00:00-04:00"}, updated:"2032-08-01T12:00:00Z" };
}

test("Unified Closeout: direct Job és Workflow ugyanazt az orchestration service-t és idempotens postingot használja", () => {
  const db = dbWithSchema(); seedPeople(db); let seq = 0;
  db.prepare("INSERT INTO jobs(id,title,client_id,client_name,piano_id,piano_name,assigned_user_id,assigned_to,status,start_time,end_time,workflow_id) VALUES('J1','Unified close','C1','Client','P1','Steinway D','U2','Worker','Open','2032-08-04T14:00','2032-08-04T16:00','WF1')").run();
  db.prepare("INSERT INTO workshop_workflows(id,workflow_key,client_id,piano_id,mode,job_id,title,current_status,financial_status,final_due_at) VALUES('WF1','WF-1','C1','P1','ON_SITE','J1','Unified close','ACTIVE','OPEN','2032-08-04T16:00')").run();
  const domain = createJobDomain({ db, rid:(prefix)=>`${prefix}-${++seq}` });
  const entry = { itemDate:"2032-08-04", title:"Revenue", amount:500, mainType:"INCOME", category:"SERVICE_REVENUE", sourceType:"job_close_revenue", sourceId:"JOB_CLOSE:J1" };
  const direct = domain.closeoutJobOrchestration({ jobId:"J1", source:"DIRECT", actor:{id:"U1",name:"Admin"}, closeType:"Full", financialEntries:[entry], now:"2032-08-04T16:00:00.000Z" });
  assert.equal(direct.job.status, "Completed"); assert.equal(direct.job.financial_status, "POSTED");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM financial_items WHERE source_id='JOB_CLOSE:J1'").get().n, 1);
  const workflow = domain.closeoutJobOrchestration({ jobId:"J1", source:"WORKFLOW", actor:{id:"U1",name:"Admin"}, closeType:"Full", financialEntries:[entry], now:"2032-08-04T16:05:00.000Z" });
  assert.equal(workflow.idempotent, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM financial_items WHERE source_id='JOB_CLOSE:J1'").get().n, 1);
  assert.equal(db.prepare("SELECT current_status FROM workshop_workflows WHERE id='WF1'").get().current_status, "COMPLETED");
  const server = read("server/index.js"), workflows = read("server/workshop-workflow.js");
  assert.match(server, /jobDomain\.closeoutJobOrchestration\(/);
  assert.match(workflows, /domain\.closeoutJobOrchestration\(/);
  db.close();
});

test("Schedule Patch: 15 perces validáció, collision és rollback", () => {
  const db = dbWithSchema(); seedPeople(db); let seq = 0;
  db.prepare("INSERT INTO jobs(id,title,assigned_user_id,assigned_to,status,start_time,end_time) VALUES('J1','Movable','U2','Worker','Open','2032-08-04T09:00','2032-08-04T10:00')").run();
  db.prepare("INSERT INTO jobs(id,title,assigned_user_id,assigned_to,status,start_time,end_time) VALUES('J2','Blocker','U2','Worker','Open','2032-08-04T11:00','2032-08-04T12:00')").run();
  const domain = createJobDomain({ db, rid:(prefix)=>`${prefix}-${++seq}` });
  const conflicts=(uid,_name,start,end,exclude)=>db.prepare("SELECT * FROM jobs WHERE assigned_user_id=? AND id<>? AND ?<end_time AND ?>start_time").all(uid,exclude,start,end);
  assert.throws(()=>domain.patchJobSchedule({jobId:"J1",startTime:"2032-08-04T10:07",endTime:"2032-08-04T10:45",assignedUser:{id:"U2",name:"Worker"},actor:{id:"U1",name:"Admin"},findConflicts:conflicts}),/INVALID_TIME_STEP/);
  assert.equal(db.prepare("SELECT start_time FROM jobs WHERE id='J1'").get().start_time,"2032-08-04T09:00");
  assert.throws(()=>domain.patchJobSchedule({jobId:"J1",startTime:"2032-08-04T11:15",endTime:"2032-08-04T11:45",assignedUser:{id:"U2",name:"Worker"},actor:{id:"U1",name:"Admin"},findConflicts:conflicts}),/SCHEDULE_CONFLICT/);
  assert.equal(db.prepare("SELECT start_time FROM jobs WHERE id='J1'").get().start_time,"2032-08-04T09:00");
  const moved=domain.patchJobSchedule({jobId:"J1",startTime:"2032-08-04T12:15",endTime:"2032-08-04T13:00",assignedUser:{id:"U2",name:"Worker"},actor:{id:"U1",name:"Admin"},findConflicts:conflicts});
  assert.equal(moved.job.start_time,"2032-08-04T12:15"); assert.equal(moved.job.planned_minutes,45); db.close();
});

test("Google Review-Gate: import PENDING_REVIEW, majd kötelező mezők után aktív Job", () => {
  const { db, integration, getJob } = googleSetup();
  const imported=integration._test.processEvent(googleEvent()); assert.equal(imported.imported,1);
  const external=db.prepare("SELECT * FROM external_calendar_events WHERE external_event_id='event-review'").get();
  let job=getJob(external.job_id); assert.equal(job.status,"PENDING_REVIEW"); assert.equal(job.workflow_status,"PENDING_REVIEW"); assert.equal(job.notes,"Full Google description");
  assert.throws(()=>integration.markReviewed(job.id,"U1"),/GOOGLE_EVENT_CLIENT_REQUIRED/);
  db.prepare("UPDATE jobs SET client_id='C1',client_name='Client',piano_id='P1',piano_name='Steinway D' WHERE id=?").run(job.id);
  job=integration.markReviewed(job.id,"U1"); assert.equal(job.status,"Open"); assert.equal(job.workflow_status,"ACTIVE"); assert.equal(getJob(job.id).calendar_review_status,"REVIEWED");
  integration.stop(); db.close();
});

test("Behavior & Draft Preservation: New Client mentés és Cancel/bezárás is visszatölti a Job draftot", () => {
  const app=read("public/app.js");
  assert.match(app,/let jobDraftState=null/);
  assert.match(app,/onCancelled:\(\)=>reopenDraft\(\)/);
  assert.match(app,/activeModalCancelHandler=typeof options\.onCancelled===\"function\"/);
  assert.match(app,/function closeModal\(\)\{const onCancelled=activeModalCancelHandler/);
  assert.match(app,/if\(typeof onCancelled===\"function\"\)setTimeout\(\(\)=>onCancelled\(\),0\)/);
});
