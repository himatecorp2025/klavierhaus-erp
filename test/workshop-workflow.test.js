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

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not become ready");
}

async function request(baseUrl, endpoint, { token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: { Authorization: token ? `Bearer ${token}` : "", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch (_error) { payload = { raw: text }; }
  return { status: response.status, payload };
}

test("workshop workflow lifecycle enforces stage, deadline, material, finance and deletion rules", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-workshop-workflow-"));
  const dbPath = path.join(tempRoot, "workflow.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const uploadDir = path.join(tempRoot, "uploads");
  const secret = "workflow-test-secret-longer-than-32-characters";
  const init = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], { cwd: projectRoot, env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir }, encoding: "utf8" });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);
  const db = new Database(dbPath);
  const passwordHash = bcrypt.hashSync("WorkflowPassword7", 4);
  const userInsert = db.prepare(`INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,'Active',0,?)`);
  userInsert.run("U-SA-WF", "Workflow Superadmin", "workflow-superadmin@example.com", passwordHash, "ADMIN", 1);
  userInsert.run("U-ADMIN-WF", "Workflow Admin", "workflow-admin@example.com", passwordHash, "ADMIN", 0);
  userInsert.run("U-MANAGER-WF", "Workflow Manager", "workflow-manager@example.com", passwordHash, "MANAGER", 0);
  userInsert.run("U-STAFF-WF", "Workflow Staff", "workflow-staff@example.com", passwordHash, "WORKER", 0);
  db.prepare("INSERT INTO contacts(id,name,email) VALUES('C-WF','Workflow Client','client@example.com')").run();
  db.prepare("INSERT INTO pianos(id,display_name,brand,model,serial_no,owner_contact_id,location) VALUES('P-WF','Steinway Workshop Piano','Steinway','B','WF-001','C-WF','Client home')").run();
  db.prepare("INSERT INTO inventory_items(id,item_name,quantity,unit,status) VALUES('I-WF','Replacement string',4,'pcs','In Stock')").run();
  db.prepare("INSERT INTO planned_jobs(id,planned_key,title,client_id,piano_id,status) VALUES('PLN-WF','PLN-WF-0001','Planned restoration','C-WF','P-WF','Ready to schedule')").run();
  db.close();
  process.env.PORT = "0";
  process.env.DB_PATH = dbPath;
  process.env.BACKUP_DIR = backupDir;
  process.env.UPLOAD_DIR = uploadDir;
  process.env.JWT_SECRET = secret;
  const { startServer, db: serverDb } = require(path.join(projectRoot, "server", "index.js"));
  const server = startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  await waitForServer(baseUrl);

  const login = async (email) => (await request(baseUrl, "/api/login", { method: "POST", body: { email, password: "WorkflowPassword7" } })).payload.token;
  const superToken = await login("workflow-superadmin@example.com");
  const adminToken = await login("workflow-admin@example.com");
  const managerToken = await login("workflow-manager@example.com");
  const staffToken = await login("workflow-staff@example.com");

  const definitions = await request(baseUrl, "/api/workflow/stage-definitions", { token: staffToken });
  assert.equal(definitions.status, 200);
  assert.equal(definitions.payload.stages.length, 7);
  assert.deepEqual(definitions.payload.stages.map((stage) => stage.code), ["INBOUND", "ASSESSMENT", "ACOUSTICS", "MECHANICS", "VOICING", "FINISH", "FINAL_HANDOVER"]);

  const created = await request(baseUrl, "/api/workflows", { token: managerToken, method: "POST", body: {
    client_id: "C-WF", piano_id: "P-WF", planned_job_id: "PLN-WF", mode: "INBOUND", title: "WF API lifecycle", final_due_at: "2099-09-30T17:00",
    preliminary_inspection: "DONE", preliminary_assessment: "NOT_DONE", preliminary_quote: "NOT_REQUIRED", preliminary_meeting: "DONE",
    first_stage_assignee_id: "U-MANAGER-WF",
    stage_card_title_INBOUND: "Arrival from client home",
    stage_assignee_INBOUND: "U-MANAGER-WF",
    stage_assignee_ASSESSMENT: "U-STAFF-WF",
    stage_assignee_ACOUSTICS: "U-STAFF-WF",
    stage_assignee_MECHANICS: "U-MANAGER-WF",
    stage_assignee_VOICING: "U-STAFF-WF",
    stage_assignee_FINISH: "U-MANAGER-WF",
    stage_assignee_FINAL_HANDOVER: "U-ADMIN-WF"
  } });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const workflowId = created.payload.id;
  const inbound = created.payload.stages.find((stage) => stage.stage_order === 0);
  const assessment = created.payload.stages.find((stage) => stage.stage_order === 1);
  assert.equal(inbound.status, "WAITING");
  assert.equal(inbound.effective_status, "ASSIGNED");
  assert.equal(inbound.card_title, "Arrival from client home");
  assert.equal(created.payload.workflow_owner_id, "U-MANAGER-WF");
  assert.equal(assessment.status, "WAITING");
  assert.equal(assessment.assigned_user_id, "U-STAFF-WF");

  const blocked = await request(baseUrl, `/api/workflows/${workflowId}/stages/${assessment.id}`, { token: staffToken, method: "PATCH", body: { status: "IN_PROGRESS", details: "Cannot start before arrival" } });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.payload.error, "WORKFLOW_STAGE_BLOCKED_BY_PREVIOUS_STAGE");

  const arrived = await request(baseUrl, `/api/workflows/${workflowId}/stages/${inbound.id}`, { token: staffToken, method: "PATCH", body: { status: "COMPLETED", details: "Piano received" } });
  assert.equal(arrived.status, 200, JSON.stringify(arrived.payload));
  const renamed = await request(baseUrl, `/api/workflows/${workflowId}/stages/${inbound.id}`, { token: staffToken, method: "PATCH", body: { card_title: "Piano received at Klavierhaus" } });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.payload));
  assert.equal(renamed.payload.stages.find((stage) => stage.id === inbound.id).card_title, "Piano received at Klavierhaus");
  const started = await request(baseUrl, `/api/workflows/${workflowId}/stages/${assessment.id}`, { token: staffToken, method: "PATCH", body: { status: "IN_PROGRESS", details: "Detailed assessment started" } });
  assert.equal(started.status, 200, JSON.stringify(started.payload));

  const staffDeadline = await request(baseUrl, `/api/workflows/${workflowId}/stages/${assessment.id}`, { token: staffToken, method: "PATCH", body: { due_at: "2099-09-10T12:00" } });
  assert.equal(staffDeadline.status, 400);
  assert.equal(staffDeadline.payload.error, "STAGE_DEADLINE_NOT_ALLOWED");
  const managerDeadline = await request(baseUrl, `/api/workflows/${workflowId}/stages/${assessment.id}`, { token: managerToken, method: "PATCH", body: { due_at: "2099-09-10T12:00" } });
  assert.equal(managerDeadline.status, 200, JSON.stringify(managerDeadline.payload));
  const managerFinalDeadline = await request(baseUrl, `/api/workflows/${workflowId}`, { token: managerToken, method: "PATCH", body: { final_due_at: "2099-10-01T17:00" } });
  assert.equal(managerFinalDeadline.status, 400);
  assert.equal(managerFinalDeadline.payload.error, "FINAL_DEADLINE_IMMUTABLE");

  const reserved = await request(baseUrl, `/api/workflows/${workflowId}/materials`, { token: staffToken, method: "POST", body: { source_type: "CENTRAL_INVENTORY", inventory_item_id: "I-WF", item_name: "Replacement string", requested_quantity: 2, unit_cost: 12 } });
  assert.equal(reserved.status, 201, JSON.stringify(reserved.payload));
  const inventoryDb = new Database(dbPath, { readonly: true });
  const inventoryAfterReserve = inventoryDb.prepare("SELECT quantity,reserved_quantity FROM inventory_items WHERE id='I-WF'").get();
  inventoryDb.close();
  assert.equal(inventoryAfterReserve.quantity, 4);
  assert.equal(inventoryAfterReserve.reserved_quantity, 2);

  const ownStock = await request(baseUrl, `/api/workflows/${workflowId}/materials`, { token: staffToken, method: "POST", body: { source_type: "OWN_STOCK", item_name: "Technician stock felt", requested_quantity: 1, unit_cost: 45 } });
  assert.equal(ownStock.status, 201);
  const revenue = await request(baseUrl, `/api/workflows/${workflowId}/financial-lines`, { token: managerToken, method: "POST", body: { line_type: "REVENUE", category: "LABOR", title: "Assessment labor", amount: 850 } });
  assert.equal(revenue.status, 201);
  const cost = await request(baseUrl, `/api/workflows/${workflowId}/financial-lines`, { token: staffToken, method: "POST", body: { line_type: "COST", category: "MATERIAL", title: "Replacement material", amount: 69 } });
  assert.equal(cost.status, 201);

  const stages = (await request(baseUrl, `/api/workflows/${workflowId}`, { token: staffToken })).payload.stages;
  for (const stage of stages.filter((item) => item.stage_order > 0)) {
    const result = await request(baseUrl, `/api/workflows/${workflowId}/stages/${stage.id}`, { token: staffToken, method: "PATCH", body: { status: stage.stage_order === 1 ? "COMPLETED" : "IN_PROGRESS" } });
    assert.equal(result.status, 200, `${stage.stage_order}: ${JSON.stringify(result.payload)}`);
    if (stage.stage_order > 1) {
      const completed = await request(baseUrl, `/api/workflows/${workflowId}/stages/${stage.id}`, { token: staffToken, method: "PATCH", body: { status: "COMPLETED" } });
      assert.equal(completed.status, 200, `${stage.stage_order} completion: ${JSON.stringify(completed.payload)}`);
    }
  }
  const finalStage = (await request(baseUrl, `/api/workflows/${workflowId}`, { token: staffToken })).payload.stages.find((stage) => stage.stage_order === 6);
  assert.equal(finalStage.status, "COMPLETED");
  const completedWorkflow = (await request(baseUrl, `/api/workflows/${workflowId}`, { token: staffToken })).payload;
  for (const stage of completedWorkflow.stages.filter((item) => item.status !== "NOT_REQUIRED")) {
    const closedStageFinance = await request(baseUrl, `/api/workflows/${workflowId}/stages/${stage.id}/financial-close`, { token: adminToken, method: "POST", body: { reason: "Reviewed in workflow test" } });
    assert.equal(closedStageFinance.status, 200, `${stage.stage_order} finance close: ${JSON.stringify(closedStageFinance.payload)}`);
  }
  const managerFinalize = await request(baseUrl, `/api/workflows/${workflowId}/finalize`, { token: managerToken, method: "POST", body: { closure_reason: "Manager may not post financial close" } });
  assert.equal(managerFinalize.status, 403);
  const finalized = await request(baseUrl, `/api/workflows/${workflowId}/finalize`, { token: adminToken, method: "POST", body: { closure_reason: "Completed restoration with itemized lines" } });
  assert.equal(finalized.status, 200, JSON.stringify(finalized.payload));
  assert.equal(finalized.payload.financial_status, "CLOSED");
  assert.equal(finalized.payload.finance_summary.net_total, 781);

  const closed = await request(baseUrl, "/api/closed-jobs", { token: staffToken });
  assert.equal(closed.status, 200);
  assert.ok(closed.payload.some((row) => row.workflow_id === workflowId));
  const managerDelete = await request(baseUrl, `/api/workflows/${workflowId}`, { token: managerToken, method: "DELETE", body: { reason: "Not allowed" } });
  assert.equal(managerDelete.status, 403);
  const superDelete = await request(baseUrl, `/api/workflows/${workflowId}`, { token: superToken, method: "DELETE", body: { reason: "Verified permanent test deletion" } });
  assert.equal(superDelete.status, 200, JSON.stringify(superDelete.payload));
  const afterDeleteDb = new Database(dbPath, { readonly: true });
  assert.equal(afterDeleteDb.prepare("SELECT COUNT(*) AS count FROM workshop_workflows WHERE id=?").get(workflowId).count, 0);
  assert.equal(afterDeleteDb.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='SUPERADMIN_WORKFLOW_DELETE' AND record_id=?").get(workflowId).count, 1);
  assert.deepEqual(afterDeleteDb.prepare("SELECT quantity,reserved_quantity FROM inventory_items WHERE id='I-WF'").get(), { quantity: 4, reserved_quantity: 0 });
  afterDeleteDb.close();

  const customDefinitions = await request(baseUrl, "/api/workflow/stage-definitions", { token: adminToken, method: "PUT", body: { stages: [...definitions.payload.stages.map((stage) => ({ code: stage.code, name_en: stage.name_en, name_hu: stage.name_hu, sort_order: stage.sort_order, active: stage.active !== 0 })), { code: "CUSTOM_QA", name_en: "Quality Gate", name_hu: "Minőségellenőrzés", sort_order: 7, active: true }] } });
  assert.equal(customDefinitions.status, 200, JSON.stringify(customDefinitions.payload));
  assert.ok(customDefinitions.payload.stages.some((stage) => stage.code === "CUSTOM_QA"));
});
