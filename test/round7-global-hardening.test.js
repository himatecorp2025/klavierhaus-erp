"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("public/app.js");
const styles = read("public/styles.css");

function extractNamedFunction(source, name) {
  const endings = {
    createSessionActivityController: "\nfunction updateCountdownDisplay",
    createNestedClientStateMachine: "\nfunction entityFormFieldsMarkup"
  };
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist in public/app.js`);
  const ending = endings[name];
  assert.ok(ending, `No extraction boundary configured for ${name}`);
  const end = source.indexOf(ending, start);
  assert.ok(end > start, `${name} extraction boundary must exist`);
  return source.slice(start, end).trim();
}

function loadFunction(name, extras = {}) {
  const source = extractNamedFunction(app, name);
  return vm.runInNewContext(`(${source})`, { ...extras });
}

function fakeClock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + Number(delay || 0) }); return id; },
    clearTimer(id) { timers.delete(id); },
    tick(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due; timers.delete(id); now = timer.at; timer.fn();
      }
      now = target;
    },
    pending: () => timers.size
  };
}

function makeSessionController({ isPWA = false, timeoutMs = 600000 } = {}) {
  const createController = loadFunction("createSessionActivityController");
  const clock = fakeClock();
  let loggedOut = 0;
  const controller = createController({
    timeoutMs,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    onTimeout: () => { loggedOut += 1; },
    canRun: () => true,
    onStateChange: () => {},
    isStandalonePWA: () => isPWA
  });
  return { controller, clock, loggedOut: () => loggedOut };
}

function runChildTest(relativePath) {
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", relativePath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" }
  });
  assert.equal(result.status, 0, `${relativePath} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result.stdout;
}

test("Universal Timeout Suite: browser és standalone PWA módban is lefut a kötelező timeout", () => {
  for (const isPWA of [false, true]) {
    const { controller, clock, loggedOut } = makeSessionController({ isPWA, timeoutMs: 100 });
    controller.resetTimer();
    assert.equal(controller.snapshot().timerActive, true);
    clock.tick(99);
    assert.equal(loggedOut(), 0);
    clock.tick(1);
    assert.equal(loggedOut(), 1, `${isPWA ? "PWA" : "browser"} módban is kötelező a kijelentkeztetés`);
  }
  const resetSource = app.slice(app.indexOf("function resetInactivityTimer"), app.indexOf('document.addEventListener("click"', app.indexOf("function resetInactivityTimer")));
  assert.doesNotMatch(resetSource, /isStandalonePWA\s*\(/, "A session timeout nem tartalmazhat PWA bypass-t");
});

test("Modal Lifecycle & Counter Suite: a tényleges session controller 0 -> 1 -> 2 -> 1 -> 0 állapotot kezel", () => {
  const { controller, clock, loggedOut } = makeSessionController({ timeoutMs: 100 });
  controller.resetTimer();
  assert.equal(controller.activeModalCount, 0);
  controller.modalOpened();
  assert.equal(controller.activeModalCount, 1);
  assert.equal(controller.paused, true);
  controller.modalOpened();
  assert.equal(controller.activeModalCount, 2);
  clock.tick(500);
  assert.equal(loggedOut(), 0, "Nyitott nested modal alatt a timernek szünetelnie kell");
  controller.modalClosed();
  assert.equal(controller.activeModalCount, 1);
  assert.equal(controller.paused, true);
  clock.tick(500);
  assert.equal(loggedOut(), 0, "2 -> 1 átmenetnél a timer nem indulhat újra");
  controller.modalClosed();
  assert.equal(controller.activeModalCount, 0);
  assert.equal(controller.paused, false);
  clock.tick(99);
  assert.equal(loggedOut(), 0);
  clock.tick(1);
  assert.equal(loggedOut(), 1, "Csak az utolsó modal bezárása után indul új teljes timeout");
});

test("Nested Client State Machine Suite: Unknown -> Nem/Igen -> Save/Cancel draftmegőrzéssel", () => {
  const createStateMachine = loadFunction("createNestedClientStateMachine");
  const original = { title: "Tuning", assigned_user_id: "U1", start_time: "2032-08-04T10:00", end_time: "2032-08-04T11:00", notes: "Megjegyzés", planned_amount: 250 };

  const declineFlow = createStateMachine(original);
  const declined = declineFlow.decline("Ad-hoc Ügyfél", original);
  assert.equal(declineFlow.mode, "adhoc");
  assert.equal(declined.client_name, "Ad-hoc Ügyfél");
  assert.equal(declined.client_id, "");
  assert.equal(declined.allow_ad_hoc_client, true);
  assert.equal(declined.notes, "Megjegyzés");

  const saveFlow = createStateMachine(original);
  const creating = saveFlow.begin("Új Ügyfél", original);
  assert.equal(saveFlow.mode, "creating");
  assert.equal(creating.notes, original.notes);
  const saved = saveFlow.saved({ id: "C99", name: "Új Ügyfél", phone: "555-0199", address: "1 Main St" });
  assert.equal(saveFlow.mode, "saved");
  assert.equal(saved.client_id, "C99");
  assert.equal(saved.client_name, "Új Ügyfél");
  assert.equal(saved.client_phone, "555-0199");
  assert.equal(saved.service_address, "1 Main St");
  assert.equal(saved.notes, original.notes);
  assert.equal(saved.start_time, original.start_time);

  const cancelFlow = createStateMachine(original);
  cancelFlow.begin("Mégse Ügyfél", original);
  const cancelled = cancelFlow.cancelled();
  assert.equal(cancelFlow.mode, "cancelled");
  assert.equal(cancelled.title, original.title);
  assert.equal(cancelled.notes, original.notes);
  assert.equal(cancelled.start_time, original.start_time);
  assert.equal(cancelled.client_name, "Mégse Ügyfél");

  // Check actual shared-dialog delegation, not the removed inline renderer text.
  const open=require('./helpers/master-data-entry-fixture').entry('openNestedClientModal',(kind,row,options)=>{
    assert.equal(kind,'contacts');assert.equal(row,null);assert.equal(options.prefill.name,'Shared client');
    options.onSaved({id:'CS',name:'Shared client'});return null;
  });
  let sharedResult;
  open({prefillName:'Shared client',draft:original,stateMachine:saveFlow,onSaved:(client,retained)=>{sharedResult=retained;}});
  assert.equal(sharedResult.client_id,'CS');assert.equal(sharedResult.notes,original.notes);

});

test("Sidebar Role & Icon Contract: permission-first filtering, collapsed icon-only és accessibility", () => {
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

test("Active Cross-Module Verification: Round 5 és Round 6 funkcionális tesztek ténylegesen lefutnak", () => {
  runChildTest("test/job-domain-integration.test.js");
  runChildTest("test/round6-finance-daily-rate.test.js");
});
