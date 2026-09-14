"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  defaultLandingSections, normalizeLandingSections, verifyBalanceSheet, pianoAge,
  solarThemeForHour, workflowCalendarGate, workflowStatus
} = require("../server/round8-domain");
const { hardDeleteWorkflowData, purgeAllWorkflowData } = require("../server/workshop-workflow");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
class MemoryWorkflowDb {
  constructor() {
    this.state = {
      workflows: [
        { id: "WF-1", title: "First" },
        { id: "WF-2", title: "Second" }
      ],
      stages: [
        { id: "S-1", workflow_id: "WF-1" },
        { id: "S-2", workflow_id: "WF-1" },
        { id: "S-3", workflow_id: "WF-2" }
      ],
      jobs: [
        { id: "J-1", workflow_id: "WF-1" },
        { id: "J-2", workflow_id: "WF-2" },
        { id: "J-3", workflow_id: null }
      ],
      knowledge: [
        { id: "K-1", workflow_id: "WF-1" },
        { id: "K-2", workflow_id: "WF-2" }
      ],
      materials: []
    };
    this.transactionCalls = 0;
  }
  transaction(fn) {
    return () => {
      const before = clone(this.state);
      this.transactionCalls += 1;
      try { return fn(); }
      catch (error) { this.state = before; throw error; }
    };
  }
  prepare(sql) {
    const normalized = String(sql).replace(/\s+/g, " ").trim();
    const db = this;
    return {
      get(...args) {
        if (normalized.startsWith("SELECT * FROM workshop_workflows WHERE id=?")) return db.state.workflows.find((row) => row.id === args[0]);
        if (normalized.startsWith("SELECT COUNT(*) AS count FROM workflow_stages WHERE workflow_id=?")) return { count: db.state.stages.filter((row) => row.workflow_id === args[0]).length };
        if (normalized === "SELECT COUNT(*) AS count FROM workshop_workflows") return { count: db.state.workflows.length };
        if (normalized === "SELECT COUNT(*) AS count FROM workflow_stages") return { count: db.state.stages.length };
        throw new Error(`Unhandled get SQL: ${normalized}`);
      },
      all(...args) {
        if (normalized === "SELECT id FROM workshop_workflows") return db.state.workflows.map(({ id }) => ({ id }));
        if (normalized.startsWith("SELECT id,inventory_item_id,requested_quantity,consumed_quantity,status FROM workflow_materials WHERE workflow_id=?")) return db.state.materials.filter((row) => row.workflow_id === args[0]);
        throw new Error(`Unhandled all SQL: ${normalized}`);
      },
      run(...args) {
        if (normalized.startsWith("UPDATE jobs SET workflow_id=NULL")) {
          const only = normalized.includes("WHERE workflow_id=?") ? args[0] : null;
          let changes = 0;
          db.state.jobs.forEach((row) => { if (row.workflow_id && (only === null || row.workflow_id === only)) { row.workflow_id = null; changes += 1; } });
          return { changes };
        }
        if (normalized.startsWith("UPDATE knowledge_base SET workflow_id=NULL")) {
          const only = normalized.includes("WHERE workflow_id=?") ? args[0] : null;
          let changes = 0;
          db.state.knowledge.forEach((row) => { if (row.workflow_id && (only === null || row.workflow_id === only)) { row.workflow_id = null; changes += 1; } });
          return { changes };
        }
        if (normalized === "DELETE FROM workflow_stages WHERE workflow_id=?") {
          const before = db.state.stages.length;
          db.state.stages = db.state.stages.filter((row) => row.workflow_id !== args[0]);
          return { changes: before - db.state.stages.length };
        }
        if (normalized === "DELETE FROM workflow_stages") {
          const changes = db.state.stages.length; db.state.stages = []; return { changes };
        }
        if (normalized === "DELETE FROM workshop_workflows WHERE id=?") {
          const before = db.state.workflows.length;
          db.state.workflows = db.state.workflows.filter((row) => row.id !== args[0]);
          return { changes: before - db.state.workflows.length };
        }
        if (normalized === "DELETE FROM workshop_workflows") {
          const changes = db.state.workflows.length; db.state.workflows = []; return { changes };
        }
        if (normalized.startsWith("UPDATE inventory_items SET reserved_quantity=")) return { changes: 0 };
        throw new Error(`Unhandled run SQL: ${normalized}`);
      }
    };
  }
}

test("Website & Landing Manager: section toggle/order, menu sync, solar theme and piano age", () => {
  const defaults = defaultLandingSections();
  assert.deepEqual(defaults.map((x) => x.section_key), ["hero","featured_pianos","craftsmanship","salon_events","testimonials","contact_cta"]);
  const reordered = normalizeLandingSections([
    {section_key:"salon_events",is_active:0,order_index:0}, {section_key:"hero",is_active:1,order_index:1},
    {section_key:"featured_pianos",is_active:1,order_index:2}, {section_key:"craftsmanship",is_active:1,order_index:3},
    {section_key:"testimonials",is_active:1,order_index:4}, {section_key:"contact_cta",is_active:1,order_index:5}
  ]);
  assert.equal(reordered[0].section_key, "salon_events");
  assert.equal(reordered[0].is_active, 0);
  const content = read("server/website-content.js");
  assert.match(content, /app\.put\("\/api\/landing-sections", auth, admin/);
  assert.match(content, /sectionForNav = \{ events:"salon_events", pianos:"featured_pianos", services:"craftsmanship", contact:"contact_cta" \}/);
  const publicServer = read("website/server/index.js");
  assert.match(publicServer, /landing\.filter\(\(row\) => Number\(row\.is_active\) === 1\).*order_index/s);
  assert.equal(solarThemeForHour(7), "light");
  assert.equal(solarThemeForHour(18), "light");
  assert.equal(solarThemeForHour(19), "dark");
  const websiteApp = read("website/public/app.js"), css = read("website/public/styles.css");
  assert.match(websiteApp, /America\/New_York/); assert.match(websiteApp, /theme_preference/); assert.match(css, /#F9F8F5/i); assert.match(css, /#F4F1EA/i);
  assert.equal(pianoAge(1928, 2026), 98); assert.equal(pianoAge(2030, 2026), null);
  assert.match(read("server/website-catalog.js"), /value\.build_year/); assert.match(publicServer, /years old/);
});

test("Balance Sheet Integrity: balanced and out-of-balance states", () => {
  assert.equal(verifyBalanceSheet(1000, 400, 600).balanced, true);
  const bad = verifyBalanceSheet(1000, 400, 550);
  assert.equal(bad.balanced, false); assert.equal(bad.absolute_difference, 50);
  assert.match(read("public/app.js"), /balance-integrity/); assert.match(read("server/index.js"), /balanceAudit/);
});

test("Workflow calendar gate, colors and workshop header state", () => {
  assert.equal(workflowCalendarGate({assigned_user_id:"U1",due_at:"2026-09-20T10:00"}), true);
  assert.equal(workflowCalendarGate({assigned_user_id:"",due_at:"2026-09-20T10:00"}), false);
  assert.equal(workflowCalendarGate({assigned_user_id:"U1",due_at:""}), false);
  assert.equal(workflowStatus({status:"IN_PROGRESS",due_at:"2026-09-20T10:00"},"2026-09-14").colorClass,"status-orange");
  assert.equal(workflowStatus({status:"IN_PROGRESS",due_at:"2026-09-10T10:00"},"2026-09-14").colorClass,"status-red");
  assert.equal(workflowStatus({status:"COMPLETED",due_at:"2026-09-10T10:00"},"2026-09-14").colorClass,"status-green");
  const workflow = read("server/workshop-workflow.js"), app = read("public/app.js");
  assert.match(workflow, /s\.due_at IS NOT NULL/); assert.match(workflow, /s\.assigned_user_id IS NOT NULL/);
  assert.match(app, /function workshopToggleArchived\(\)\{workshopWorkflowPrevious=!workshopWorkflowPrevious/);
  assert.match(app, /Back to current active works/); assert.match(app, /Vissza a jelenlegi aktív munkákhoz/);
  const currentRender = app.slice(app.lastIndexOf("async function renderWorkshopWorkflow"));
  assert.doesNotMatch(currentRender, /workflowDateMove\(-1\)|workflowDateMove\(1\)/);
  assert.doesNotMatch(currentRender, /onclick="workshopWorkflowDate=nyDateKey\(\);renderWorkshopWorkflow\(\)"/);
  assert.match(app, /data-date-picker-today/);
  assert.match(app, /workshopOpenCalendar\(\).*currentSchedulerEntryFilter="WORKFLOW"/);
});

test("Superadmin Workflow Törlés: hard delete, detach and purge run transactionally", () => {
  const db = new MemoryWorkflowDb();
  const singleAudit = [];
  const single = hardDeleteWorkflowData({ db, workflowId: "WF-1", audit: (entry) => singleAudit.push(entry) });
  assert.equal(single.workflow.id, "WF-1");
  assert.equal(single.stageCount, 2);
  assert.equal(db.transactionCalls, 1);
  assert.deepEqual(db.state.workflows.map((row) => row.id), ["WF-2"]);
  assert.deepEqual(db.state.stages.map((row) => row.id), ["S-3"]);
  assert.equal(db.state.jobs.find((row) => row.id === "J-1").workflow_id, null);
  assert.equal(db.state.jobs.find((row) => row.id === "J-2").workflow_id, "WF-2");
  assert.equal(db.state.knowledge.find((row) => row.id === "K-1").workflow_id, null);
  assert.equal(singleAudit.length, 1);

  const purgeAudit = [];
  const purged = purgeAllWorkflowData({ db, audit: (entry) => purgeAudit.push(entry) });
  assert.equal(purged.workflowCount, 1);
  assert.equal(purged.stageCount, 1);
  assert.equal(db.transactionCalls, 2);
  assert.equal(db.state.workflows.length, 0);
  assert.equal(db.state.stages.length, 0);
  assert.equal(db.state.jobs.every((row) => row.workflow_id === null), true);
  assert.equal(db.state.knowledge.every((row) => row.workflow_id === null), true);
  assert.deepEqual(purgeAudit, [{ workflowCount: 1, stageCount: 1 }]);

  const source = read("server/workshop-workflow.js"), index = read("server/index.js"), app = read("public/app.js");
  assert.match(source, /app\.delete\("\/api\/workflows\/:id", auth, requireSuperadmin/);
  assert.match(source, /app\.post\("\/api\/workflows\/purge-all", auth, requireSuperadmin/);
  assert.match(source, /UPDATE jobs SET workflow_id=NULL/);
  assert.match(source, /PURGE_ALL_WORKFLOWS/);
  assert.match(index, /function requireSuperadmin\(req,res,next\)\{ return isSuperadminUser\(req\.user\) \? next\(\) : res\.status\(403\)/);
  assert.match(app, /isSuperadmin\(\)\?`<button[^`]*workflowPurgeAll\(\)/s);
  assert.match(app, /isSuperadmin\(\)\?`<button[^`]*workflowSuperDelete/s);
  assert.match(app, /DELETE ALL WORKFLOWS/);
});

test("Round 8 schema and UI contracts remain intact", () => {
  const schema=read("server/schema.sql"), admin=read("public/app.js");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS landing_sections/); assert.match(schema,/build_year INTEGER/);
  assert.match(admin,/Home sections/); assert.match(admin,/Concerts \/ Events/); assert.match(admin,/Workshop Tasks/);
});
