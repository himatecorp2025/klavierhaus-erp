"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");
const AdmZip=require("adm-zip");
const {createWorkbook}=require("../server/operations-enhancements");

const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("staff professional roles are separate from system permissions and persist on workflow phases",()=>{
  const schema=read("server/schema.sql"),init=read("server/init-db.js"),api=read("server/operations-enhancements.js"),workflow=read("server/round2-workflow.js"),ui=read("public/round2.js"),app=read("public/app.js"),v6=read("public/v6.js");
  assert.match(schema,/manager_scope TEXT CHECK\(manager_scope IS NULL OR manager_scope IN \('INSIDE','OUTSIDE'\)\)/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS staff_skills\s*\(/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS user_staff_skills\s*\(/);
  assert.match(schema,/responsibility_skill_id INTEGER/);
  assert.match(init,/OUTSIDE_TUNING/);
  assert.match(init,/WORKSHOP_COORDINATION/);
  assert.match(api,/\/api\/staff-skills/);
  assert.match(api,/\/api\/work-profiles/);
  assert.match(api,/\/api\/users\/:id\/work-profile/);
  assert.match(workflow,/responsibility_skill_id/);
  assert.match(workflow,/ensureUserSkill/);
  assert.match(ui,/Job role \/ task/);
  assert.match(ui,/data-phase-skill/);
  assert.match(ui,/data-add-phase-skill/);
  assert.match(ui,/responsibility_skill_id/);
  assert.match(ui,/r2PhaseSkillLabel/);
  assert.match(app,/Manager type/);
  assert.match(app,/Inside Manager/);
  assert.match(app,/Outside Manager/);
  assert.match(app,/skill_ids/);
  assert.match(v6,/operationsSkillsSettingsCard/);
});

test("Milestone is the desktop and tablet home while phone stays on Workshop",()=>{
  const app=read("public/app.js"),html=read("public/index.html"),ops=read("public/operations-ui.js"),css=read("public/styles.css"),api=read("server/operations-enhancements.js"),schema=read("server/schema.sql");
  assert.match(app,/view:\(location\.hash\|\|"#milestone"\)/);
  assert.match(app,/activeViews=new Set\(\["milestone","workshop"/);
  assert.match(app,/if\(view==="milestone"&&window\.innerWidth<700\)view="workshop"/);
  assert.match(app,/if\(state\.view==="milestone"\)await renderMilestone\(\)/);
  assert.match(html,/href="#milestone" data-nav="milestone"/);
  assert.match(html,/id="mobileBrandButton"[\s\S]{0,120}data-nav="milestone"/);
  assert.match(html,/\/operations-ui\.js/);
  assert.match(ops,/async function renderMilestone/);
  assert.match(ops,/GOAL ACHIEVED/);
  assert.match(ops,/openMilestoneEditor/);
  assert.match(ops,/step_progress/);
  assert.match(css,/\.milestone-hero/);
  assert.match(css,/\.milestone-roadmap/);
  assert.match(css,/@media\(max-width:699px\)[\s\S]{0,120}\.milestone-view\{display:none!important\}/);
  assert.match(api,/\/api\/milestone/);
  assert.match(api,/\/api\/milestone\/media/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS milestone_dashboard/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS milestone_steps/);
});

test("VIP clients have explicit last-contacted tracking and a three-month warning",()=>{
  const schema=read("server/schema.sql"),init=read("server/init-db.js"),core=read("server/round1-core.js"),app=read("public/app.js"),css=read("public/styles.css");
  assert.match(schema,/last_contacted_at TEXT/);
  assert.match(init,/last_contacted_at/);
  assert.match(core,/last_contacted_at/);
  assert.match(core,/vip_followup_due/);
  assert.match(app,/Last contacted/);
  assert.match(app,/vipFollowupWarning/);
  assert.match(app,/vip-followup-warning/);
  assert.match(css,/\.vip-followup-warning/);
});

test("complete database export creates a structured native XLSX workbook",()=>{
  const api=read("server/operations-enhancements.js"),v6=read("public/v6.js");
  assert.match(api,/\/api\/system-export\.xlsx/);
  assert.match(api,/SELECT name,sql FROM sqlite_master/);
  assert.match(api,/Manifest/);
  assert.match(api,/schema_sql/);
  assert.match(api,/Content-Disposition/);
  assert.match(v6,/operationsExportRecoveryCard/);
  const buffer=createWorkbook([
    {name:"Manifest",headers:["table_name","row_count"],rows:[{table_name:"clients",row_count:1}]},
    {name:"clients",headers:["id","name"],rows:[{id:1,name:"Test Client"}]}
  ]);
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0,2).toString(),"PK");
  const zip=new AdmZip(buffer),entries=zip.getEntries().map(entry=>entry.entryName);
  assert.ok(entries.includes("xl/workbook.xml"));
  assert.ok(entries.includes("xl/worksheets/sheet1.xml"));
  assert.ok(entries.includes("xl/worksheets/sheet2.xml"));
  const workbook=zip.readAsText("xl/workbook.xml");
  assert.match(workbook,/Manifest/);
  assert.match(workbook,/clients/);
});

test("final theme normalization covers legacy fixed-light admin surfaces and narrows invoice quantity",()=>{
  const css=read("public/styles.css"),round3=read("public/round3.js");
  assert.match(css,/OPERATIONS V37/);
  assert.match(css,/\.dialog-card,[\s\S]{0,1000}background:var\(--surface\)!important/);
  assert.match(css,/\.invoice-line\{[\s\S]{0,200}grid-template-columns:minmax\(105px,.62fr\) minmax\(240px,1.65fr\) 72px minmax\(145px,.8fr\) 42px!important/);
  assert.match(css,/\[data-line-quantity\][\s\S]{0,120}max-width:72px!important/);
  assert.match(css,/\.typeahead-menu,[\s\S]{0,600}background:var\(--surface\)!important/);
  assert.match(css,/:root\[data-theme="dark"\] input\[type="date"\]/);
  assert.match(round3,/data-line-quantity/);
  assert.match(round3,/data-line-price/);
});
