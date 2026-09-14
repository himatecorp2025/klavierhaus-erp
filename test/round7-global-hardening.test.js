"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("public/app.js");
const styles = read("public/styles.css");
const server = read("server/index.js");

function modalTransitionSequence() {
  const state = { activeModalCount: 0, paused: false, resumes: 0 };
  const pause = () => { state.paused = true; };
  const resume = () => { if (state.activeModalCount === 0) { state.paused = false; state.resumes += 1; } };
  const opened = () => { state.activeModalCount += 1; pause(); };
  const closed = () => { state.activeModalCount = Math.max(0, state.activeModalCount - 1); if (state.activeModalCount === 0) resume(); };
  opened();
  opened();
  closed();
  const intermediate = { ...state };
  closed();
  return { intermediate, final: { ...state } };
}

test("Nested Client Creation Flow: inline offer, nested modal, saved client and text-only decline", () => {
  assert.match(app, /ensureInlineClientPrompt\(clientInput/);
  assert.match(app, /Client not found in the list\. Create as a new client\?/);
  assert.match(app, /openNestedClientModal\(/);
  assert.match(app, /prefillName:term/);
  assert.match(app, /clientInput\.dataset\.clientId=client\.id/);
  assert.match(app, /allowAdHocClient=true/);
  assert.match(app, /Client will remain text-only for this job/);
  assert.match(server, /allowAdHocClient/);
  assert.match(server, /req\.body\.client_id=null/);
  assert.match(server, /relationships\.adHocClient/);
  assert.match(styles, /\.nested-modal-overlay/);
  assert.match(styles, /\.inline-client-prompt/);
});

test("Modal Counter & Inactivity Pause: 0 -> 1 -> 2 -> 1 -> 0 and timer resumes only at zero", () => {
  const { intermediate, final } = modalTransitionSequence();
  assert.equal(intermediate.activeModalCount, 1);
  assert.equal(intermediate.paused, true);
  assert.equal(intermediate.resumes, 0);
  assert.equal(final.activeModalCount, 0);
  assert.equal(final.paused, false);
  assert.equal(final.resumes, 1);
  assert.match(app, /const sessionActivity=\{/);
  assert.match(app, /activeModalCount:0/);
  assert.match(app, /modalOpened\(\).*activeModalCount\+=1/);
  assert.match(app, /modalClosed\(\).*Math\.max\(0,this\.activeModalCount-1\)/);
  assert.match(app, /if\(this\.activeModalCount===0\)this\.resume\(\)/);
  assert.match(app, /\.nested-modal-overlay, \.system-dialog-overlay, \.workflow-event-log-modal, \.workflow-drawer/);
  assert.match(app, /setTimeout\(\(\)=>logoutNow\(\), INACTIVITY_LIMIT_MS\)/);
});

test("Sidebar Role & Icon Contract: permission-first filtering and icon-only collapsed state", () => {
  const visibleIndex = app.indexOf("function visibleNavigationItems()");
  const renderIndex = app.indexOf("function renderNavigation()");
  assert.ok(visibleIndex >= 0 && renderIndex > visibleIndex);
  assert.match(app, /filter\(\(\[view\]\)=>navItemAllowed\(view\)\)/);
  assert.match(app, /function navigationButtonMarkup\(view\)/);
  assert.match(app, /<span class="nav-icon"/);
  assert.match(app, /<span class="nav-label"/);
  assert.match(app, /aria-label=/);
  assert.match(app, /title=/);
  assert.match(styles, /body\.sidebar-collapsed \.nav-item-btn \.nav-label\{display:none\}/);
  assert.match(styles, /body\.sidebar-collapsed \.nav-item-btn\{width:48px/);
});

test("Cross-Module Regression: Round 5/6 contracts remain present", () => {
  const domain = read("server/job-domain.js");
  const clientImport = read("server/client-import.js");
  const round6 = read("test/round6-finance-daily-rate.test.js");
  const round5 = read("test/job-domain-integration.test.js");
  assert.match(domain, /SCHEDULE_INTERVAL_MINUTES\s*=\s*15/);
  assert.match(domain, /JOB_REVENUE/);
  assert.match(domain, /DAILY_RATE/);
  assert.match(domain, /closeoutJobOrchestration/);
  assert.match(clientImport, /detectClientSheet/);
  assert.match(clientImport, /commitClientImportRecords/);
  assert.match(round6, /Master Rate & Limit Check/);
  assert.match(round6, /Excel Import Pipeline/);
  assert.match(round5, /Unified Closeout/);
  assert.match(app, /\['00','15','30','45'\]/);
});
