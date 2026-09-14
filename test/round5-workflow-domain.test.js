"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { registerWorkshopWorkflowRoutes } = require("../server/workshop-workflow");

function fakeApp() {
  const routes = new Map();
  const app = { routes };
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (route, ...handlers) => { routes.set(`${method.toUpperCase()} ${route}`, handlers.at(-1)); };
  }
  return app;
}
function responseCapture() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}
function invoke(handler, { params = {}, body = {}, user } = {}) {
  const req = { params, body, query: {}, user: user || { id: "U1", name: "Admin", role: "ADMIN", is_superadmin: 0 } };
  const res = responseCapture();
  handler(req, res);
  return res;
}

test("Round 5 workflow creation and active-stage assignment stay linked to the central Job domain", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(path.join(__dirname, "..", "server", "schema.sql"), "utf8"));
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES('U1','Admin','admin@example.com','x','ADMIN','Active',0,0)").run();
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES('U2','Worker','worker@example.com','x','WORKER','Active',0,0)").run();
  db.prepare("INSERT INTO contacts(id,name,email) VALUES('C1','Client','client@example.com')").run();
  db.prepare("INSERT INTO pianos(id,display_name,brand,model,owner_contact_id) VALUES('P1','Steinway B','Steinway','B','C1')").run();

  const app = fakeApp();
  let seq = 0;
  registerWorkshopWorkflowRoutes({
    app, db,
    auth: (_req, _res, next) => next?.(),
    permit: () => (_req, _res, next) => next?.(),
    requireSuperadmin: (_req, _res, next) => next?.(),
    rid: (prefix) => `${prefix}-${++seq}`,
    nowISO: () => "2032-08-04T12:00:00.000Z",
    upload: { single: () => (_req, _res, next) => next?.() },
    notifyUser: () => {}
  });

  const create = app.routes.get("POST /api/workflows");
  assert.ok(create);
  const created = invoke(create, { body: {
    client_id: "C1",
    piano_id: "P1",
    mode: "ON_SITE",
    title: "Workflow domain job",
    description: "Workflow notes",
    final_due_at: "2032-08-04T15:00",
    first_stage_assignee_id: "U1"
  }});
  assert.equal(created.statusCode, 201, JSON.stringify(created.payload));
  assert.ok(created.payload.job_id);
  const linked = db.prepare("SELECT * FROM jobs WHERE id=?").get(created.payload.job_id);
  assert.equal(linked.workflow_id, created.payload.id);
  assert.equal(linked.client_id, "C1");
  assert.equal(linked.piano_id, "P1");
  assert.equal(linked.assigned_user_id, "U1");
  assert.equal(linked.notes, "Workflow notes");
  assert.equal(linked.timezone, "America/New_York");

  const firstStage = created.payload.stages.find((stage) => stage.status !== "NOT_REQUIRED");
  assert.ok(firstStage);
  const patchStage = app.routes.get("PATCH /api/workflows/:id/stages/:stageId");
  const started = invoke(patchStage, { params: { id: created.payload.id, stageId: firstStage.id }, body: {
    status: "IN_PROGRESS",
    assigned_user_id: "U2",
    reassignment_reason: "Worker starts the current phase"
  }});
  assert.equal(started.statusCode, 200, JSON.stringify(started.payload));
  const relinked = db.prepare("SELECT assigned_user_id,assigned_to FROM jobs WHERE id=?").get(created.payload.job_id);
  assert.equal(relinked.assigned_user_id, "U2");
  assert.equal(relinked.assigned_to, "Worker");

  const invalid = invoke(create, { body: {
    client_id: "C1", piano_id: "P1", mode: "ON_SITE", title: "Invalid grid",
    final_due_at: "2032-08-04T15:07", first_stage_assignee_id: "U1"
  }});
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.payload.error, "INVALID_TIME_STEP");
  db.close();
});
