"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createJobDomain, SCHEDULE_INTERVAL_MINUTES, isScheduleTime } = require("../server/job-domain");
const { detectClientSheet, commitClientImportRecords } = require("../server/client-import");

function ridFactory() { let n = 0; return (prefix) => `${prefix}-${++n}`; }
function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT DEFAULT 'Active');
    CREATE TABLE employee_daily_rates(user_id TEXT NOT NULL,rate REAL NOT NULL,currency TEXT NOT NULL DEFAULT 'USD',effective_date TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,created_by TEXT,PRIMARY KEY(user_id,effective_date));
    CREATE TABLE jobs(
      id TEXT PRIMARY KEY,title TEXT,job_key TEXT,status TEXT DEFAULT 'Open',workflow_status TEXT DEFAULT 'ACTIVE',workflow_id TEXT,
      client_id TEXT,client_name TEXT,piano_id TEXT,piano_name TEXT,assigned_user_id TEXT,assigned_to TEXT,start_time TEXT,end_time TEXT,timezone TEXT,
      planned_minutes INTEGER DEFAULT 0,planned_hours REAL DEFAULT 0,completed_at TEXT,finalized_at TEXT,financial_status TEXT DEFAULT 'OPEN',financial_ledger_id TEXT,closed_at TEXT,
      daily_rate_enabled INTEGER DEFAULT 0,daily_rate_allocated_amount REAL DEFAULT 0,daily_rate_date TEXT,technician_extra_compensation REAL DEFAULT 0,
      last_reassigned_by TEXT,last_reassigned_by_user_id TEXT,reassignment_note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE workshop_workflows(id TEXT PRIMARY KEY,final_due_at TEXT,current_status TEXT DEFAULT 'ACTIVE',financial_status TEXT DEFAULT 'OPEN',financial_closed_at TEXT,financial_closed_by_user_id TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE workflow_stages(id TEXT PRIMARY KEY,workflow_id TEXT,stage_code TEXT,due_at TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE financial_items(
      id TEXT PRIMARY KEY,item_date TEXT,title TEXT,description TEXT,amount REAL,main_type TEXT,category TEXT,recurrence TEXT,payment_method TEXT,balance_account TEXT,
      job_id TEXT,client_id TEXT,piano_id TEXT,source_type TEXT,source_id TEXT,created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_financial_source ON financial_items(source_type,source_id) WHERE source_type IS NOT NULL AND source_type<>'' AND source_id IS NOT NULL AND source_id<>'';
    CREATE TABLE contacts(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,company TEXT,type TEXT,email TEXT,phone TEXT,address TEXT,billing_address TEXT,priority TEXT,status TEXT,owner TEXT,relationship_holder TEXT,loss_risk TEXT,
      last_contact TEXT,next_step TEXT,notes TEXT,has_piano INTEGER DEFAULT 0,interested_buying INTEGER DEFAULT 0,external_reference TEXT,import_source TEXT,import_batch_id TEXT
    );
    CREATE TABLE import_batches(id TEXT PRIMARY KEY,status TEXT,imported_clients INTEGER DEFAULT 0,skipped_duplicates INTEGER DEFAULT 0,missing_data_clients INTEGER DEFAULT 0,failed_rows INTEGER DEFAULT 0,completed_at TEXT,summary_json TEXT);
  `);
  return db;
}

function seedUsersAndRates(db) {
  db.prepare("INSERT INTO users(id,name,status) VALUES('U1','Alice','Active'),('U2','Bob','Active')").run();
  db.prepare("INSERT INTO employee_daily_rates(user_id,rate,currency,effective_date,created_by) VALUES(?,?,?,?,?)").run("U1",350,"USD","2026-01-01","ADMIN");
  db.prepare("INSERT INTO employee_daily_rates(user_id,rate,currency,effective_date,created_by) VALUES(?,?,?,?,?)").run("U2",150,"USD","2026-01-01","ADMIN");
}

test("Scheduler keeps the 15-minute backend contract while New Job uses the shared half-hour picker", () => {
  assert.equal(SCHEDULE_INTERVAL_MINUTES, 15);
  assert.equal(isScheduleTime("2026-09-14T10:00"), true);
  assert.equal(isScheduleTime("2026-09-14T10:15"), true);
  assert.equal(isScheduleTime("2026-09-14T10:30"), true);
  assert.equal(isScheduleTime("2026-09-14T10:45"), true);
  assert.equal(isScheduleTime("2026-09-14T10:31"), false);
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(app, /function halfHourOptions/);
  assert.match(app, /jobDateTimePickerMarkup\('jobStart'/);
  assert.match(app, /jobDateTimePickerMarkup\('jobEnd'/);
  assert.match(app, /07:00 AM–09:00 PM/);
  assert.match(app, /Planned duration/);
  const jobForm = app.slice(app.indexOf('async function openJob('), app.indexOf('function toggleInstructionsField()', app.indexOf('async function openJob(')));
  assert.match(jobForm, /Job title \/ Munka neve/);
  assert.match(jobForm, /Service address \/ Cím/);
  assert.match(jobForm, /Daily Rate\?/);
  assert.match(jobForm, /Daily Rate Allocation/);
  assert.doesNotMatch(jobForm, /Pricing basis \/ Díjmegállapítás módja/);
});

test("Fixed $300 base: one activation per technician/day and duplicate Daily Rate stays enabled at $0", () => {
  const db = makeDb();
  seedUsersAndRates(db);
  const domain = createJobDomain({ db, rid: ridFactory() });
  db.prepare(`INSERT INTO jobs(id,title,status,assigned_user_id,assigned_to,start_time,end_time,daily_rate_enabled,daily_rate_allocated_amount,daily_rate_date) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run("J-OLD","Existing","Open","U1","Alice","2026-09-14T08:00","2026-09-14T10:00",1,200,"2026-09-14");
  domain.rebalanceDailyRateAllocations({ userId: "U1", dateStr: "2026-09-14" });
  const first = db.prepare("SELECT daily_rate_enabled,daily_rate_allocated_amount FROM jobs WHERE id='J-OLD'").get();
  assert.equal(first.daily_rate_enabled, 1);
  assert.equal(first.daily_rate_allocated_amount, 300);
  const summary = domain.dailyRateAllocationSummary({ userId: "U1", dateStr: "2026-09-14" });
  assert.equal(summary.limit, 300);
  assert.equal(summary.allocated, 300);
  assert.equal(summary.available, 0);
  const duplicate = domain.validateDailyRateAllocation({ userId: "U1", dateStr: "2026-09-14", jobId: "J-NEW", enabled: true });
  assert.equal(duplicate.requested, 0);
  assert.equal(duplicate.base_rate_already_activated, true);
  const otherTechnician = domain.dailyRateAllocationSummary({ userId: "U2", dateStr: "2026-09-14" });
  assert.equal(otherTechnician.available, 300);
  assert.equal(otherTechnician.suggested_allocation, 300);
  db.close();
});

test("Date/employee move rebalances both days and releases the old technician base immediately", () => {
  const db = makeDb();
  seedUsersAndRates(db);
  const domain = createJobDomain({ db, rid: ridFactory() });
  db.prepare(`INSERT INTO jobs(id,title,status,assigned_user_id,assigned_to,start_time,end_time,timezone,planned_minutes,planned_hours,daily_rate_enabled,daily_rate_allocated_amount,daily_rate_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("J-MOVE","Move me","Open","U1","Alice","2026-09-14T10:00","2026-09-14T11:00","America/New_York",60,1,1,300,"2026-09-14");
  db.prepare(`INSERT INTO jobs(id,title,status,assigned_user_id,assigned_to,start_time,end_time,daily_rate_enabled,daily_rate_allocated_amount,daily_rate_date) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run("J-U2","Bob existing","Open","U2","Bob","2026-09-15T08:00","2026-09-15T09:00",1,300,"2026-09-15");
  const moved = domain.patchJobSchedule({ jobId: "J-MOVE", startTime: "2026-09-15T10:00", endTime: "2026-09-15T11:00", assignedUser: { id: "U2", name: "Bob" }, actor: { id: "ADMIN", name: "Admin" }, findConflicts: () => [] }).job;
  assert.equal(moved.assigned_user_id, "U2");
  assert.equal(moved.daily_rate_date, "2026-09-15");
  assert.equal(moved.daily_rate_allocated_amount, 0);
  assert.equal(domain.dailyRateAllocationSummary({ userId: "U1", dateStr: "2026-09-14" }).available, 300);
  assert.equal(domain.dailyRateAllocationSummary({ userId: "U2", dateStr: "2026-09-15", excludeJobId: "J-MOVE" }).available, 0);
  db.close();
});

test("Idempotent accounting: daily base and field-service compensation post as separate technician expenses", () => {
  const db = makeDb();
  seedUsersAndRates(db);
  const domain = createJobDomain({ db, rid: ridFactory() });
  db.prepare(`INSERT INTO jobs(id,title,status,assigned_user_id,assigned_to,start_time,end_time,client_id,piano_id,financial_status,daily_rate_enabled,daily_rate_allocated_amount,daily_rate_date,technician_extra_compensation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("J-CLOSE","Revenue job","Open","U1","Alice","2026-09-14T10:00","2026-09-14T11:00","C1","P1","OPEN",1,300,"2026-09-14",80);
  const close = () => domain.closeoutJobOrchestration({
    jobId: "J-CLOSE", actor: { id: "ADMIN", name: "Admin" }, complete: true,
    financialEntries: ({ job }) => [{ itemDate: "2026-09-14", title: "Job revenue", amount: 500, mainType: "INCOME", category: "SERVICE_REVENUE", sourceType: "JOB_REVENUE", sourceId: `JOB_REVENUE:${job.id}` }]
  });
  close(); close();
  const rows = db.prepare("SELECT * FROM financial_items ORDER BY source_type").all();
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.source_type === "JOB_REVENUE").amount, 500);
  assert.equal(rows.find((r) => r.source_type === "DAILY_RATE").amount, 300);
  assert.equal(rows.find((r) => r.source_type === "TECHNICIAN_EXTRA_COMPENSATION").amount, 80);
  db.close();
});

test("Excel Import Pipeline: name-independent mapping and transactional commit", () => {
  const detected = detectClientSheet([{ name: "Customers September", rows: [["Customer Name","E-mail","Telephone","Address"],["Jane Doe","jane@example.com","2125550100","1 Main St"]] }]);
  assert.ok(detected);
  assert.equal(detected.sheet.name, "Customers September");
  assert.equal(detected.mapping.name, 0);
  assert.equal(detected.mapping.email, 1);
  assert.equal(detected.mapping.phone, 2);
  const db = makeDb();
  db.prepare("INSERT INTO import_batches(id,status) VALUES('B1','PREVIEW')").run();
  const records = [
    { category: "NEW", externalReference: "X1", name: "Jane Doe", email: "jane@example.com", phone: "2125550100", serviceAddress: "1 Main St", billingAddress: "", contactFullName: "Jane", nextStep: "", notes: "", hasMissingData: false },
    { category: "NEW", externalReference: "X2", name: "John Doe", email: "john@example.com", phone: "2125550101", serviceAddress: "2 Main St", billingAddress: "", contactFullName: "John", nextStep: "", notes: "", hasMissingData: false }
  ];
  const result = commitClientImportRecords(db, { records, source: "CLIENT_EXCEL_IMPORT", batchId: "B1" });
  assert.equal(result.importedClients, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM contacts").get().c, 2);
  assert.equal(db.prepare("SELECT status FROM import_batches WHERE id='B1'").get().status, "COMPLETED");
  db.exec(`DELETE FROM contacts; UPDATE import_batches SET status='PREVIEW',imported_clients=0; CREATE TRIGGER fail_second BEFORE INSERT ON contacts WHEN NEW.name='Boom' BEGIN SELECT RAISE(ABORT,'boom'); END;`);
  const failing = [{ ...records[0], externalReference: "Y1" }, { ...records[1], externalReference: "Y2", name: "Boom" }];
  assert.throws(() => commitClientImportRecords(db, { records: failing, source: "CLIENT_EXCEL_IMPORT", batchId: "B1" }));
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM contacts").get().c, 0);
  db.close();
});
