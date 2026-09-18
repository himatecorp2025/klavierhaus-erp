"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SCHEDULE_INTERVAL_MINUTES,
  JOB_TIMEZONE,
  isValidTimeRange,
  isScheduleTime,
  isScheduleDurationHours,
  timeRangeMinutes,
  createJobDomain
} = require("../server/job-domain");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function fakeFinancialDb() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      if (/SELECT \* FROM financial_items WHERE source_type=\? AND source_id=\?/i.test(sql)) {
        return { get: (type, id) => rows.find((row) => row.source_type === type && row.source_id === id) };
      }
      if (/INSERT INTO financial_items/i.test(sql)) {
        return { run: (...values) => {
          const [id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,source_type,source_id,created_by] = values;
          rows.push({ id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,source_type,source_id,created_by });
          return { changes: 1 };
        }};
      }
      if (/SELECT \* FROM financial_items WHERE id=\?/i.test(sql)) {
        return { get: (id) => rows.find((row) => row.id === id) };
      }
      throw new Error(`Unexpected SQL in fake DB: ${sql}`);
    }
  };
}

test("Round 5 uses one 15-minute New York scheduling contract", () => {
  assert.equal(SCHEDULE_INTERVAL_MINUTES, 15);
  assert.equal(JOB_TIMEZONE, "America/New_York");
  assert.equal(isScheduleTime("2032-08-04T14:00"), true);
  assert.equal(isScheduleTime("2032-08-04T14:15"), true);
  assert.equal(isScheduleTime("2032-08-04T14:07"), false);
  assert.equal(isValidTimeRange("2032-08-04T14:00", "2032-08-04T15:30"), true);
  assert.equal(timeRangeMinutes("2032-08-04T14:00", "2032-08-04T15:30"), 90);
  assert.equal(isScheduleDurationHours(1.5), true);
  assert.equal(isScheduleDurationHours(1.1), false);
});

test("closed-job revenue posting is idempotent and keeps revenue positive", () => {
  const db = fakeFinancialDb();
  let counter = 0;
  const domain = createJobDomain({ db, rid: () => `FI-${++counter}`, balanceAccountFromPaymentMethod: () => "BANK" });
  const job = { id:"J-1", title:"Concert tuning", client_id:"C-1", client_name:"Client", piano_id:"P-1", piano_name:"Steinway", completed_at:"2032-08-04T18:00:00Z" };
  const first = domain.postClosedJobRevenue(job, { logId:"LOG-1", billedAmount:1200, paymentMethod:"Bank Transfer / ACH", createdBy:"Admin" });
  const second = domain.postClosedJobRevenue(job, { logId:"LOG-2", billedAmount:1200, paymentMethod:"Bank Transfer / ACH", createdBy:"Admin" });
  assert.equal(first.id, second.id);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].main_type, "INCOME");
  assert.equal(db.rows[0].amount, 1200);
  assert.equal(db.rows[0].source_type, "JOB_REVENUE");
  assert.equal(db.rows[0].source_id, "JOB_REVENUE:J-1");
});

test("calendar, workflow, client, piano and notes share the central Job domain", () => {
  const server = read("server/index.js");
  const workflow = read("server/workshop-workflow.js");
  const domain = read("server/job-domain.js");
  const google = read("server/google-calendar.js");
  const schema = read("server/schema.sql");
  assert.match(server, /app\.patch\("\/api\/jobs\/:id\/schedule"/);
  assert.match(server, /normalizeJobRelationships/);
  assert.match(server, /CLIENT_NOT_FOUND/);
  assert.match(server, /PIANO_NOT_FOUND/);
  assert.match(domain, /JOB_NOT_MOVABLE/);
  assert.match(server, /b\.notes\|\|planned\.notes/);
  assert.match(workflow, /job_id/);
  assert.match(workflow, /workflow_id/);
  assert.match(workflow, /closeoutJobOrchestration/);
  assert.match(workflow, /syncLinkedJobAssignee/);
  assert.match(google, /notes=\?/);
  assert.match(google, /GOOGLE_EVENT_CLIENT_REQUIRED/);
  assert.match(google, /GOOGLE_EVENT_PIANO_REQUIRED/);
  assert.match(schema, /notes TEXT/);
  assert.match(schema, /workflow_id TEXT/);
  assert.match(schema, /job_id TEXT/);
});

test("scheduler supports drag, worker transfer, resize, rollback path and Notes preview", () => {
  const app = read("public/app.js");
  const styles = read("public/styles.css");
  assert.match(app, /beginSchedulerDrag/);
  assert.match(app, /handleSchedulerDrop/);
  assert.match(app, /handleSchedulerWorkerDrop/);
  assert.match(app, /beginSchedulerResize/);
  assert.match(app, /\/api\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/schedule/);
  assert.match(app, /catch\(error\)\{showError\(error\);await renderScheduler\(\)/);
  assert.match(app, /event-card-notes/);
  assert.match(styles, /-webkit-line-clamp:2/);
});

test("New Job can create a missing client and register a piano inline without losing the draft", () => {
  const {entry}=require('./helpers/master-data-entry-fixture');
  const draft={title:'Tuning',notes:'Retain instructions',start_time:'2032-08-04T10:00',piano_name:'B-211'};
  const before=JSON.stringify(draft);let clientSaved=null,pianoSaved=null,cancelled=false;
  const openClient=entry('openNestedClientModal',(kind,row,options)=>{
    assert.equal(kind,'contacts');assert.equal(options.prefill.name,'New client');
    options.onSaved({id:'C1',name:'New client'});options.onCancelled();return null;
  });
  openClient({prefillName:'New client',draft,onSaved:(client,retained)=>{clientSaved=client.id;assert.equal(retained,draft);},onCancelled:retained=>{cancelled=true;assert.equal(retained,draft);}});
  const openPiano=entry('openNestedJobPianoModal',(kind,row,options)=>{
    assert.equal(kind,'pianos');assert.equal(options.prefill.owner_contact_id,'C1');
    options.onSaved({id:'P1',owner_contact_id:'C1'});return null;
  });
  openPiano({client:{id:clientSaved},draft,onSaved:piano=>{pianoSaved=piano.id;}});
  assert.equal(clientSaved,'C1');assert.equal(pianoSaved,'P1');assert.equal(cancelled,true);assert.equal(JSON.stringify(draft),before);
});

test("current-time line and week calculations use the New York date source", () => {
  const app = read("public/app.js");
  assert.match(app, /timeZone:"America\/New_York"/);
  assert.match(app, /function nyDateParts/);
  assert.match(app, /line\.dataset\.date!==now\.date/);
  assert.match(app, /function startOfWeek\(value\)/);
});
