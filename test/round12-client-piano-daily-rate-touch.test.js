"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TECHNICIAN_DAILY_BASE_RATE } = require("../server/job-domain");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const app = read("public/app.js");
const styles = read("public/styles.css");
const server = read("server/index.js");
const schema = read("server/schema.sql");
const initDb = read("server/init-db.js");
const domain = read("server/job-domain.js");
const finance = read("server/business-operations.js");

test("client phone/address edits persist to the central contact without stale form fallback", () => {
  assert.match(server, /function syncClientContactFromJob\(clientId,body=\{\}\)/);
  assert.match(server, /hasOwnProperty\.call\(body,"client_phone"\)/);
  assert.match(server, /hasOwnProperty\.call\(body,"service_address"\)/);
  assert.match(server, /syncClientContactFromJob\(data\.client_id,data\)/);
  assert.match(server, /syncClientContactFromJob\(updated\.client_id,req\.body\)/);
  assert.doesNotMatch(app, /clientInput\.addEventListener\("blur",\s*fillClientData/);
  assert.match(app, /b\.client_id=clientInput\.dataset\.clientId\|\|null/);
  assert.doesNotMatch(app, /b\.client_id=clientInput\.dataset\.clientId\|\|source\?\.client_id/);
});

test("inline piano registration writes pianos plus client_pianos and immediately selects the new instrument", () => {
  // This contract used to require a serial and a specific inline SQL call.
  // The approved 44 contract uses the shared transactional writer with optional serial.
  const f = require('./helpers/workflow-planner-fixture').fixture();
  try {
    const saved=f.piano.create({owner_contact_id:'CL',brand:'Steinway & Sons',model:'B-211',serial_no:''});
    assert.equal(f.db.prepare('SELECT owner_contact_id FROM pianos WHERE id=?').get(saved.id).owner_contact_id,'CL');
    assert.equal(f.db.prepare('SELECT piano_id FROM client_pianos WHERE client_id=? AND piano_id=?').get('CL',saved.id).piano_id,saved.id);
    let selected=null;
    const open=require('./helpers/master-data-entry-fixture').entry('openNestedJobPianoModal',(kind,row,options)=>{
      assert.equal(kind,'pianos');assert.equal(row,null);assert.equal(options.prefill.owner_contact_id,'CL');
      options.onSaved(saved);return saved;
    });
    open({client:{id:'CL'},onSaved:piano=>{selected=piano.id;}});
    assert.equal(selected,saved.id);
    assert.throws(()=>f.piano.create({owner_contact_id:'CL',brand:'',model:'B-211'}),/PIANO_CORE_FIELDS_REQUIRED/);
    assert.throws(()=>f.piano.create({owner_contact_id:'CL',brand:'Steinway & Sons',model:''}),/PIANO_CORE_FIELDS_REQUIRED/);
  } finally {f.close();}
});

test("daily rate is fixed at $300 per technician/day, duplicates remain enabled at $0, and moves/deletes rebalance", () => {
  assert.equal(TECHNICIAN_DAILY_BASE_RATE, 300);
  assert.match(domain, /const TECHNICIAN_DAILY_BASE_RATE = 300/);
  assert.match(domain, /const suggested = currentOwnsBase \? TECHNICIAN_DAILY_BASE_RATE : \(alreadyActivated \? 0 : TECHNICIAN_DAILY_BASE_RATE\)/);
  assert.match(domain, /function rebalanceDailyRateAllocations/);
  assert.match(domain, /row\.id === winner\?\.id \? TECHNICIAN_DAILY_BASE_RATE : 0/);
  assert.match(domain, /if \(bucketChanged && job\.assigned_user_id && previousDate\) rebalanceDailyRateAllocations/);
  assert.match(server, /dailyRateBuckets=\[job,\.\.\.childJobs\]/);
  assert.match(server, /jobDomain\.rebalanceDailyRateAllocations\(bucket\)/);
  assert.match(app, /Daily base already activated by an earlier job/);
  assert.match(app, /money\(0\)/);
});

test("field-service compensation is additive to the $300 base and reverses cleanly when a payable is voided", () => {
  assert.match(schema, /technician_extra_compensation REAL NOT NULL DEFAULT 0/);
  assert.match(app, /name="technician_extra_compensation"/);
  assert.match(app, /Additional technician income above the fixed \$300 daily base/);
  assert.match(domain, /sourceType: "TECHNICIAN_EXTRA_COMPENSATION"/);
  assert.match(finance, /const contractorTotal = money\(dailyRateAmount \+ extraCompensation\)/);
  assert.match(finance, /Field-service compensation/);
  assert.match(finance, /DELETE FROM financial_items WHERE source_type='TECHNICIAN_EXTRA_COMPENSATION'/);
});

test("touch scheduler drag requires a 1500ms long press, cancels on pre-activation movement, and has no haptic/pulse", () => {
  assert.match(app, /function beginSchedulerTouchLongPress/);
  assert.match(app, /setTimeout\(\(\)=>\{[^]*?is-touch-drag-ready[^]*?\},1500\)/);
  assert.match(app, /if\(!state\.activated\)\{clearTimeout\(state\.timer\)/);
  assert.match(app, /if\(event\.pointerType==="touch"\)return/);
  assert.match(app, /ontouchstart='beginSchedulerTouchLongPress/);
  assert.match(app, /ontouchmove='moveSchedulerTouchLongPress/);
  assert.match(styles, /\.timeline-event\.is-touch-drag-ready/);
  assert.match(styles, /animation:none!important/);
  assert.doesNotMatch(app, /navigator\.vibrate|vibrate\(/);
});

test("desktop pointer drag remains immediate while touch resize is disabled", () => {
  const pointerStart = app.indexOf("function beginSchedulerPointerDrag");
  const touchStart = app.indexOf("function beginSchedulerTouchLongPress");
  assert.ok(pointerStart >= 0 && touchStart > pointerStart);
  assert.match(app.slice(pointerStart, touchStart), /event\.pointerType==="touch"/);
  assert.match(app, /function beginSchedulerResize\(event,job,dayStart,dayEnd\)\{\s*if\(event\.pointerType==="touch"\)return/);
  assert.match(styles, /@media \(pointer:coarse\),\(hover:none\)/);
  assert.match(styles, /touch-action:pan-x pan-y/);
});
