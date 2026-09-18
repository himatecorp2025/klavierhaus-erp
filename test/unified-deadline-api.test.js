"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const projectRoot = path.join(__dirname, "..");
const dueAt = (hours) => {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setUTCMinutes(Math.ceil(date.getUTCMinutes() / 15) * 15, 0, 0);
  return date.toISOString().slice(0, 16);
};
async function waitForServer(baseUrl) {
  const limit = Date.now() + 15000;
  while (Date.now() < limit) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not become ready");
}
async function request(baseUrl, endpoint, { token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_error) { payload = { raw }; }
  return { status: response.status, payload };
}

test("unified deadline API keeps workflow, calendar, finance and user snoozes in sync", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-unified-deadline-"));
  const dbPath = path.join(tempRoot, "deadline.sqlite");
  const init = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], { cwd: projectRoot, env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: path.join(tempRoot, "backups") }, encoding: "utf8" });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);
  const db = new Database(dbPath);
  const passwordHash = bcrypt.hashSync("DeadlinePassword7", 4);
  const insertUser = db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,'Active',0,?)");
  insertUser.run("U-DEADLINE-ADMIN", "Deadline Admin", "deadline-admin@example.com", passwordHash, "ADMIN", 0);
  insertUser.run("U-DEADLINE-WORKER", "Deadline Worker", "deadline-worker@example.com", passwordHash, "WORKER", 0);
  db.prepare("INSERT INTO contacts(id,name,email,phone) VALUES('C-DEADLINE','Deadline Client','deadline-client@example.com','+12125550123')").run();
  db.prepare("INSERT INTO pianos(id,display_name,brand,model,serial_no,owner_contact_id) VALUES('P-DEADLINE','Deadline Steinway','Steinway','B','DL-001','C-DEADLINE')").run();
  db.close();

  process.env.PORT = "0";
  process.env.DB_PATH = dbPath;
  process.env.BACKUP_DIR = path.join(tempRoot, "backups");
  process.env.UPLOAD_DIR = path.join(tempRoot, "uploads");
  process.env.JWT_SECRET = "unified-deadline-test-secret-with-safe-length";
  const { startServer, db: serverDb } = require(path.join(projectRoot, "server", "index.js"));
  const server = startServer(0);
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await waitForServer(baseUrl);
  const login = async (email) => (await request(baseUrl, "/api/login", { method: "POST", body: { email, password: "DeadlinePassword7" } })).payload.token;
  const adminToken = await login("deadline-admin@example.com");
  const workerToken = await login("deadline-worker@example.com");

  const initialDue = dueAt(4);
  const created = await request(baseUrl, "/api/workflows", { token: adminToken, method: "POST", body: {
    client_id: "C-DEADLINE", piano_id: "P-DEADLINE", mode: "ON_SITE", title: "Unified notification workflow", final_due_at: initialDue,
    first_stage_assignee_id: "U-DEADLINE-WORKER", stage_assignee_ASSESSMENT: "U-DEADLINE-WORKER", stage_due_ASSESSMENT: initialDue, stage_card_title_ASSESSMENT: "Notification test phase"
  } });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const workflowId = created.payload.id;
  const stage = created.payload.stages.find((item) => item.stage_code === "ASSESSMENT");
  assert.ok(stage?.id);

  const workerActive = await request(baseUrl, "/api/notifications/active", { token: workerToken });
  assert.equal(workerActive.status, 200);
  const stageNotification = workerActive.payload.notifications.find((item) => item.entity_type === "WORKFLOW_STAGE" && item.entity_id === stage.id);
  assert.ok(stageNotification, JSON.stringify(workerActive.payload));
  assert.equal(stageNotification.instrument_context, "Steinway B");
  assert.equal(stageNotification.client_context, "Deadline Client");
  assert.equal(stageNotification.responsible_name, "Deadline Worker");
  assert.ok(stageNotification.calendar_job_id, "Every active workflow phase is represented in the calendar");

  const snooze = await request(baseUrl, "/api/notifications/snooze", { token: workerToken, method: "POST", body: { entity_type: "WORKFLOW_STAGE", entity_id: stage.id } });
  assert.equal(snooze.status, 200, JSON.stringify(snooze.payload));
  assert.equal(snooze.payload.hours, 3);
  assert.equal(serverDb.prepare("SELECT user_id FROM notification_snooze_log WHERE entity_type='WORKFLOW_STAGE' AND entity_id=?").get(stage.id).user_id, "U-DEADLINE-WORKER");
  const afterWorkerSnooze = await request(baseUrl, "/api/notifications/active", { token: workerToken });
  assert.equal(afterWorkerSnooze.payload.notifications.some((item) => item.entity_id === stage.id), false);
  const adminStillSees = await request(baseUrl, "/api/notifications/active", { token: adminToken });
  assert.equal(adminStillSees.payload.notifications.some((item) => item.entity_id === stage.id), true, "A worker snooze must not hide an admin's card");

  const rescheduledDue = dueAt(48);
  const rescheduled = await request(baseUrl, "/api/notifications/reschedule", { token: adminToken, method: "POST", body: { entity_type: "WORKFLOW_STAGE", entity_id: stage.id, target_date: rescheduledDue, reason: "Client requested a new workshop appointment" } });
  assert.equal(rescheduled.status, 200, JSON.stringify(rescheduled.payload));
  const afterReschedule = await request(baseUrl, `/api/workflows/${workflowId}`, { token: adminToken });
  const updatedStage = afterReschedule.payload.stages.find((item) => item.id === stage.id);
  assert.equal(updatedStage.due_at, rescheduledDue);
  const linkedJob = serverDb.prepare("SELECT id,status,end_time FROM jobs WHERE id=?").get(updatedStage.calendar_job_id);
  assert.equal(linkedJob.end_time, rescheduledDue);
  assert.equal(serverDb.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='WORKFLOW_STAGE_RESCHEDULED_FROM_NOTIFICATION' AND record_id=?").get(stage.id).count, 1);

  const completeStage = await request(baseUrl, "/api/notifications/complete", { token: workerToken, method: "POST", body: { entity_type: "WORKFLOW_STAGE", entity_id: stage.id } });
  assert.equal(completeStage.status, 200, JSON.stringify(completeStage.payload));
  const completedStage = serverDb.prepare("SELECT status,financial_status,completed_at FROM workflow_stages WHERE id=?").get(stage.id);
  const completedLinkedJob = serverDb.prepare("SELECT status,financial_status FROM jobs WHERE id=?").get(updatedStage.calendar_job_id);
  assert.equal(completedStage.status, "COMPLETED");
  assert.equal(completedStage.financial_status, "CLOSED");
  assert.ok(completedStage.completed_at);
  assert.equal(completedLinkedJob.status, "Completed");
  assert.equal(completedLinkedJob.financial_status, "POSTED");

  const standaloneStart = dueAt(6);
  const standaloneEnd = dueAt(7);
  serverDb.prepare("INSERT INTO jobs(id,job_key,title,job_type,client_id,client_name,piano_id,piano_name,assigned_user_id,assigned_to,created_by_user_id,created_by,status,start_time,end_time,timezone) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("J-DEADLINE-STANDALONE", "J-DEADLINE-STANDALONE", "Standalone notification completion", "Standalone", "C-DEADLINE", "Deadline Client", "P-DEADLINE", "Deadline Steinway", "U-DEADLINE-WORKER", "Deadline Worker", "U-DEADLINE-ADMIN", "Deadline Admin", "Open", standaloneStart, standaloneEnd, "America/New_York");
  const standaloneComplete = await request(baseUrl, "/api/notifications/complete", { token: workerToken, method: "POST", body: { entity_type: "CALENDAR_JOB", entity_id: "J-DEADLINE-STANDALONE" } });
  assert.equal(standaloneComplete.status, 200, JSON.stringify(standaloneComplete.payload));
  assert.deepEqual(serverDb.prepare("SELECT status,financial_status FROM jobs WHERE id='J-DEADLINE-STANDALONE'").get(), { status: "Completed", financial_status: "POSTED" });
});
