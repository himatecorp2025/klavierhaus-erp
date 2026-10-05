"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("job scheduling uses hidden year, compact month/day and 30-minute New York business-time choices",()=>{
  const ui=read("public/round2.js"),api=read("server/round2-workflow.js"),css=read("public/styles.css");
  assert.match(ui,/const R2_JOB_SLOT_MIN=30/);
  assert.match(ui,/class="r2-date-month"/);
  assert.match(ui,/class="r2-date-day"/);
  assert.match(ui,/type="hidden" name="'\+esc\(name\)\+'_year"/);
  assert.match(ui,/minutes\+=slotMinutes/);
  assert.match(ui,/startMinutes=R2_DAY_START,endMinutes=R2_DAY_END/);
  assert.match(ui,/r2SnapJobMinutes/);
  assert.doesNotMatch(ui,/type="datetime-local"/);
  assert.match(api,/minute%30!==0/);
  assert.match(api,/clock<7\*60\|\|clock>20\*60/);
  assert.match(css,/\.r2-compact-datetime/);
});

test("workflow jobs persist customer phase prices and deposit finance",()=>{
  const schema=read("server/schema.sql"),api=read("server/round2-workflow.js"),finance=read("server/round3-finance.js"),ui=read("public/round2.js");
  assert.match(schema,/deposit_amount REAL NOT NULL DEFAULT 0/);
  assert.match(schema,/customer_price REAL NOT NULL DEFAULT 0/);
  assert.match(api,/phase_customer_total/);
  assert.match(api,/balance_due/);
  assert.match(ui,/Customer price/);
  assert.match(ui,/Deposit received/);
  assert.match(ui,/data-workflow-finance-summary/);
  assert.match(finance,/Deposit received/);
  assert.match(finance,/customer_price/);
});

test("planned, calendar and workflow job creation expose job-specific add-phase controls",()=>{
  const ui=read("public/round2.js"),api=read("server/round2-workflow.js");
  assert.match(ui,/workflow-job-phase-adder/);
  assert.doesNotMatch(ui,/workflowEntry&&r2IsAdmin\(\)/);
  assert.match(ui,/job_specific:true/);
  assert.match(ui,/workflow-phases\/custom/);
  assert.match(api,/app\.post\("\/api\/jobs\/\:id\/workflow-phases\/custom"/);
  assert.match(api,/VALUES\(\?,\?,\?,\?,\x27intermediate\x27,0,1/);
});

test("arrival and delivery timing has a three-hour minimum in UI and API",()=>{
  const ui=read("public/round2.js"),api=read("server/round2-workflow.js"),app=read("public/app.js");
  assert.match(ui,/WORKFLOW_LOGISTICS_MINIMUM_WINDOW/);
  assert.match(ui,/r2WallAddMinutes\(start,180\)/);
  assert.match(api,/minutes<180/);
  assert.match(api,/WORKFLOW_LOGISTICS_MINIMUM_WINDOW/);
  assert.match(app,/WORKFLOW_LOGISTICS_MINIMUM_WINDOW/);
});

test("public header renders persistent phone and email actions on desktop and mobile with cache busting",()=>{
  const server=read("website/server/index.js"),css=read("website/public/styles.css");
  const header=server.match(/<header class="site-header"[\s\S]*?<\/header>/)?.[0]||"";
  assert.match(header,/header-quick-contact--mobile/);
  assert.match(header,/header-quick-contact--desktop/);
  assert.match(header,/brand\.phoneHref/);
  assert.match(header,/brand\.emailHref/);
  assert.match(server,/calendar-contact-header-20261005-2/);
  assert.match(css,/\.header-quick-contact[\s\S]*visibility: visible[\s\S]*opacity: 1/);
});
