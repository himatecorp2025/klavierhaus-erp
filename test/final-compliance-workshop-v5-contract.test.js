"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Workshop v5 visual contracts cover calendar, CMS, bilingual chrome and modal behavior",()=>{
  const index=read("public/index.html"),app=read("public/app.js"),round2=read("public/round2.js"),css=read("public/styles.css");
  assert.match(index,/id="newYorkClock"/);
  assert.match(index,/id="newYorkDate"/);
  assert.match(index,/class="header-tools"/);
  assert.match(index,/data-dialog-close/);
  assert.doesNotMatch(index,/<form method="dialog" class="dialog-card"/);

  assert.match(app,/structuredClone\(page\.content\|\|\{\}\)/);
  assert.match(app,/cmsRenderNode/);
  assert.match(app,/cms-repeater/);
  assert.match(app,/Edit team member/);
  assert.match(app,/Csapattag szerkesztése/);
  assert.doesNotMatch(app,/id="cmsJson"/);
  assert.doesNotMatch(app,/Invalid JSON/);
  assert.match(app,/New York-i idő/);

  assert.match(round2,/data-calendar-mode="day"/);
  assert.match(round2,/data-calendar-mode="week"/);
  assert.match(round2,/data-calendar-mode="month"/);
  assert.match(round2,/R2_DAY_START=7\*60/);
  assert.match(round2,/R2_DAY_END=20\*60/);
  assert.match(round2,/R2_SLOT_MIN=15/);
  assert.match(round2,/setTimeout\(\(\)=>activate\(event,"move"\),1500\)/);
  assert.match(round2,/event-resize-handle/);
  assert.match(round2,/calendar-drag-tip/);
  assert.match(round2,/calendar-now-line/);
  assert.match(round2,/workflow_stage|workflow phases|Workflow phases/i);
  assert.match(round2,/Completed is always mandatory/);
  assert.match(round2,/Lezárva mindig kötelező/);
  assert.match(round2,/api\/workshop\/overview/);
  assert.match(round2,/api\/workflow\/settings/);
  assert.match(round2,/api\/jobs\/\$\{job\.id\}\/schedule/);

  assert.match(css,/--kh-gold/);
  assert.match(css,/\.time-day-column/);
  assert.match(css,/repeating-linear-gradient/);
  assert.match(css,/\.month-calendar-grid/);
  assert.match(css,/\.workshop-kpis/);
  assert.match(css,/\.cms-visual-fields/);
});

test("Website directory and protected website backend remain untouched by Workshop v5 branch",()=>{
  const workflow=read(".github/workflows/ci.yml");
  assert.match(workflow,/public-website-verify/);
  for(const file of ["server/website-platform.js","server/website-content.js","server/website-catalog.js","server/upload-middleware.js"]){
    assert.ok(fs.existsSync(path.join(root,file)),file);
  }
});
