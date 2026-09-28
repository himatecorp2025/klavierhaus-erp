"use strict";

const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
function gitBlobSha(file){
  const data=fs.readFileSync(path.join(root,file));
  return crypto.createHash("sha1").update(Buffer.from(`blob ${data.length}\0`)).update(data).digest("hex");
}

test("Round 2 keeps protected website/CMS server modules byte-identical",()=>{
  const expected={
    "server/website-platform.js":"8a10313eb02bdd41fdc434d1f5a9bdbe7ca7d1e7",
    "server/website-content.js":"3886ff1e4b4261dd8512781fc833c6c8cd796ce5",
    "server/website-catalog.js":"18ebe2d0663d2c4dfd995f1732a504b6555a8b98",
    "server/upload-middleware.js":"64444c043a3a1b646032a5ca5c10569d37806938"
  };
  for(const [file,sha] of Object.entries(expected))assert.equal(gitBlobSha(file),sha,`${file} changed despite zero-modification policy`);
});

test("Round 2 uses one jobs table and exactly five workflow states",()=>{
  const schema=read("server/schema.sql");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS jobs\s*\(/);
  assert.match(schema,/CHECK\(status IN \('planned','scheduled','in_progress','blocked','ready_for_closeout'\)\)/);
  assert.match(schema,/scheduled_start TEXT/);
  assert.match(schema,/scheduled_end TEXT/);
  assert.match(schema,/assigned_technician_id TEXT/);
  assert.match(schema,/timezone TEXT NOT NULL DEFAULT 'America\/New_York'/);
  for(const duplicate of ["calendar_jobs","workshop_jobs","workflow_jobs","planned_jobs"]){
    assert.doesNotMatch(schema,new RegExp(`CREATE TABLE IF NOT EXISTS ${duplicate}\\s*\\(`));
  }
});

test("Round 2 route module owns Planned Jobs, Workshop and Calendar APIs",()=>{
  const source=read("server/round2-workflow.js"),server=read("server/index.js");
  assert.match(server,/registerRound2WorkflowRoutes/);
  for(const route of ["/api/jobs","/api/planned-jobs","/api/workshop","/api/calendar","/api/intake/:id/create-job"])assert.ok(source.includes(route),route);
  for(const state of ["planned","scheduled","in_progress","blocked","ready_for_closeout"])assert.ok(source.includes(`key: "${state}"`),state);
  assert.doesNotMatch(server,/registerWorkshopWorkflowRoutes|registerWorkflowV2|registerBusinessOperationsRoutes|createJobDomain/);
});


test("Round 2 PWA activates Planned Jobs and Workshop while Finance remains Round 3",()=>{
  const html=read("public/index.html"),app=read("public/app.js"),round2=read("public/round2.js"),css=read("public/styles.css"),sw=read("public/service-worker.js");
  assert.match(html,/data-nav="workshop"/);
  assert.match(html,/data-nav="planned"/);
  assert.match(html,/Pénzügy<small>3\. kör<\/small>/);
  assert.ok(html.includes("/round2.js"));
  for(const label of ["Tervezett","Ütemezett","Folyamatban","Blokkolva","Lezárásra vár"])assert.ok(round2.includes(label),label);
  assert.match(round2,/\/api\/planned-jobs/);
  assert.match(round2,/\/api\/workshop/);
  assert.match(round2,/\/api\/calendar/);
  assert.match(round2,/data-drop-stage/);
  assert.match(css,/\.workflow-board/);
  assert.match(css,/\.calendar-grid/);
  assert.match(css,/min-height:48px/);
  assert.match(sw,/klavierhaus-round2-shell-v1/);
  assert.match(app,/createJobFromIntake/);
});
