"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  defaultLandingSections, normalizeLandingSections, verifyBalanceSheet, pianoAge,
  solarThemeForHour, workflowCalendarGate, workflowStatus
} = require("../server/round8-domain");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Section Manager & Reorder + Menu Sync", () => {
  const defaults = defaultLandingSections();
  assert.deepEqual(defaults.map(x => x.section_key), ["hero","featured_pianos","craftsmanship","salon_events","testimonials","contact_cta"]);
  const reordered = normalizeLandingSections([
    {section_key:"salon_events",is_active:0,order_index:0}, {section_key:"hero",is_active:1,order_index:1},
    {section_key:"featured_pianos",is_active:1,order_index:2}, {section_key:"craftsmanship",is_active:1,order_index:3},
    {section_key:"testimonials",is_active:1,order_index:4}, {section_key:"contact_cta",is_active:1,order_index:5}
  ]);
  assert.equal(reordered[0].section_key, "salon_events"); assert.equal(reordered[0].is_active, 0);
  const server = read("server/website-content.js");
  assert.match(server, /app\.put\("\/api\/landing-sections", auth, admin/);
  assert.match(server, /sectionForNav = \{ events:"salon_events", pianos:"featured_pianos", services:"craftsmanship", contact:"contact_cta" \}/);
  const publicServer = read("website/server/index.js");
  assert.match(publicServer, /landing\.filter\(\(row\) => Number\(row\.is_active\) === 1\).*order_index/s);
});

test("Piano Age", () => {
  assert.equal(pianoAge(1928, 2026), 98);
  assert.equal(pianoAge(2030, 2026), null);
  const catalog = read("server/website-catalog.js");
  assert.match(catalog, /value\.build_year/); assert.match(read("website/server/index.js"), /years old/);
});

test("Balance Sheet Integrity", () => {
  assert.deepEqual(verifyBalanceSheet(1000, 400, 600).balanced, true);
  const bad = verifyBalanceSheet(1000, 400, 550); assert.equal(bad.balanced, false); assert.equal(bad.absolute_difference, 50);
  assert.match(read("public/app.js"), /balance-integrity/); assert.match(read("server/index.js"), /balanceAudit/);
});

test("Solar Theme Contract", () => {
  assert.equal(solarThemeForHour(7), "light"); assert.equal(solarThemeForHour(18), "light"); assert.equal(solarThemeForHour(19), "dark"); assert.equal(solarThemeForHour(3), "dark");
  const app = read("website/public/app.js"), css = read("website/public/styles.css");
  assert.match(app, /America\/New_York/); assert.match(app, /theme_preference/); assert.match(css, /#F9F8F5/i); assert.match(css, /#F4F1EA/i);
});

test("Workflow Calendar Gate & Status Colors", () => {
  assert.equal(workflowCalendarGate({assigned_user_id:"U1",due_at:"2026-09-20T10:00"}), true);
  assert.equal(workflowCalendarGate({assigned_user_id:"",due_at:"2026-09-20T10:00"}), false);
  assert.equal(workflowCalendarGate({assigned_user_id:"U1",due_at:""}), false);
  assert.equal(workflowStatus({status:"IN_PROGRESS",due_at:"2026-09-20T10:00"},"2026-09-14").colorClass,"status-orange");
  assert.equal(workflowStatus({status:"IN_PROGRESS",due_at:"2026-09-10T10:00"},"2026-09-14").colorClass,"status-red");
  assert.equal(workflowStatus({status:"COMPLETED",due_at:"2026-09-10T10:00"},"2026-09-14").colorClass,"status-green");
  const workflow = read("server/workshop-workflow.js");
  assert.match(workflow, /s\.due_at IS NOT NULL/); assert.match(workflow, /s\.assigned_user_id IS NOT NULL/);
});

test("Workshop Toggle State", () => {
  const app = read("public/app.js");
  assert.match(app, /function workshopToggleArchived\(\)\{workshopWorkflowPrevious=!workshopWorkflowPrevious/);
  assert.match(app, /Back to current active works/); assert.match(app, /Vissza a jelenlegi aktív munkákhoz/);
  assert.doesNotMatch(app.slice(app.lastIndexOf("async function renderWorkshopWorkflow"), app.indexOf("async function renderToday", app.lastIndexOf("async function renderWorkshopWorkflow")) > 0 ? app.indexOf("async function renderToday", app.lastIndexOf("async function renderWorkshopWorkflow")) : undefined), /workflowDateMove\(-1\)|workflowDateMove\(1\)/);
  assert.match(app, /workshopOpenCalendar\(\).*currentSchedulerEntryFilter="WORKFLOW"/);
});

test("Round 8 schema and UI contracts", () => {
  const schema=read("server/schema.sql"), admin=read("public/app.js");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS landing_sections/); assert.match(schema,/build_year INTEGER/);
  assert.match(admin,/Home sections/); assert.match(admin,/Concerts \/ Events/); assert.match(admin,/Workshop Tasks/);
});
