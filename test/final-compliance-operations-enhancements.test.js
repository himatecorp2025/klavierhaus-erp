"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");
const os=require("node:os");
const {spawnSync}=require("node:child_process");
const Database=require("better-sqlite3");
const AdmZip=require("adm-zip");
const {createWorkbook,excelSafeTable}=require("../server/operations-enhancements");

const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("staff professional roles are separate from system permissions and persist on workflow phases",()=>{
  const schema=read("server/schema.sql"),init=read("server/init-db.js"),api=read("server/operations-enhancements.js"),workflow=read("server/round2-workflow.js"),ui=read("public/round2.js"),app=read("public/app.js"),v6=read("public/v6.js");
  assert.match(schema,/manager_scope TEXT CHECK\(manager_scope IS NULL OR manager_scope IN \('INSIDE','OUTSIDE'\)\)/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS staff_skills\s*\(/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS user_staff_skills\s*\(/);
  assert.match(schema,/responsibility_skill_id INTEGER/);
  assert.match(schema,/primary_skill_id INTEGER/);
  assert.match(init,/OUTSIDE_TUNING/);
  assert.match(init,/WORKSHOP_COORDINATION/);
  assert.match(api,/\/api\/staff-skills/);
  assert.match(api,/\/api\/work-profiles/);
  assert.match(api,/\/api\/users\/:id\/work-profile/);
  assert.match(workflow,/responsibility_skill_id/);
  assert.match(workflow,/ensureUserSkill/);
  assert.match(workflow,/primary_skill_id/);
  assert.match(ui,/Job role \/ task/);
  assert.match(ui,/Primary job role/);
  assert.match(ui,/data-phase-skill/);
  assert.match(ui,/data-add-phase-skill/);
  assert.match(ui,/responsibility_skill_id/);
  assert.match(ui,/r2PhaseSkillLabel/);
  assert.match(app,/Manager type/);
  assert.match(app,/Inside Manager/);
  assert.match(app,/Outside Manager/);
  assert.match(app,/skill_ids/);
  assert.doesNotMatch(v6,/operationsSkillsSettingsCard\(users\)/);
  assert.match(v6,/primary_skill_id/);
});

test("Milestone is the desktop and tablet home while phone stays on Workshop",()=>{
  const app=read("public/app.js"),html=read("public/index.html"),ops=read("public/operations-ui.js"),css=read("public/styles.css"),api=read("server/operations-enhancements.js"),schema=read("server/schema.sql");
  assert.match(app,/view:\(location\.hash\|\|"#milestone"\)/);
  assert.match(app,/activeViews=new Set\(\["milestone","workshop"/);
  assert.match(app,/if\(view==="milestone"&&window\.innerWidth<700\)view="workshop"/);
  assert.match(app,/function routeFreshSessionHome\(\)/);
  assert.match(app,/state\.view=window\.innerWidth<700\?"workshop":"milestone"/);
  assert.match(app,/setSession\(payload\);routeFreshSessionHome\(\);showApp\(\);await renderView\(\)/);
  assert.match(app,/if\(state\.view==="milestone"\)await renderMilestone\(\)/);
  assert.match(html,/href="#milestone" data-nav="milestone"/);
  assert.match(html,/id="mobileBrandButton"[\s\S]{0,120}data-nav="milestone"/);
  assert.match(html,/\/operations-ui\.js/);
  assert.match(ops,/async function renderMilestone/);
  assert.match(ops,/milestone-roadmap-page/);
  assert.match(ops,/Service Milestones/);
  assert.match(ops,/MILESTONE_ICON_LIBRARY/);
  assert.match(ops,/addMajorMilestone/);
  assert.match(ops,/addMinorMilestone/);
  assert.match(ops,/step_parent_uid/);
  assert.match(ops,/data-milestone-action="instruments"/);
  assert.match(ops,/bindGlobalCommandSearch/);
  assert.match(ops,/\/api\/global-search/);
  assert.match(ops,/openMilestoneEditor/);
  assert.match(ops,/milestoneDirectMediaManager/);
  assert.match(ops,/uploadMilestoneSlot/);
  assert.match(ops,/uploadMilestoneStepDirect/);
  assert.match(ops,/roadmap-connector/);
  assert.match(ops,/milestoneIconPickerMarkup/);
  assert.match(ops,/data-add-child-milestone/);
  assert.match(ops,/roadmap-achievement-badge/);
  assert.match(api,/MILESTONE_PARENT_REQUIRED/);
  const v6=read("public/v6.js");
  assert.match(v6,/operationsMilestoneProfileCard/);
  assert.match(v6,/bindOperationsMilestoneProfile/);
  assert.match(v6,/admin&&typeof operationsMilestoneProfileCard/);
  assert.match(ops,/roadmap-node-image/);
  assert.match(ops,/d\.instrument_media_url\?`<div class="ms-instrument-art"/);
  assert.match(ops,/tr\("Planned Jobs","Tervezett munkák"\)/);
  assert.match(css,/Enterprise roadmap shell/);
  assert.match(css,/\.ms-roadmap-track/);
  assert.match(css,/Milestone fidelity v3/);
  assert.match(css,/\.roadmap-connector/);
  assert.match(css,/\.milestone-icon-picker-grid/);
  assert.match(css,/\.milestone-achieved/);
  assert.match(css,/milestone-achievement-pulse/);
  assert.match(css,/\.milestone-direct-media-grid/);
  assert.match(css,/\.roadmap-substeps/);
  assert.match(css,/\.global-search-shell/);
  assert.match(css,/\.app-shell\.milestone-showcase-mode>\.app-sidebar\{display:grid!important\}/);
  assert.match(api,/\/api\/milestone/);
  assert.match(api,/\/api\/milestone\/media/);
  assert.match(api,/\/api\/milestone\/media-slot\/:slot/);
  assert.match(api,/\/api\/milestone\/steps\/:uid\/media/);
  assert.match(api,/milestoneMediaColumns/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS milestone_dashboard/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS milestone_steps/);
  assert.match(schema,/reference_code TEXT NOT NULL DEFAULT 'GROWTH ROADMAP'/);
  assert.match(schema,/instrument_media_url TEXT/);
  assert.match(schema,/craft_media_url TEXT/);
  assert.match(schema,/parent_uid TEXT/);
  assert.match(schema,/step_kind TEXT NOT NULL DEFAULT 'major'/);
  assert.match(schema,/link_view TEXT/);
});

test("Milestone roadmap migration upgrades an existing production table before canonical indexes",()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-milestone-migration-")),dbPath=path.join(temp,"legacy.sqlite"),backupDir=path.join(temp,"backups");
  const db=new Database(dbPath);
  db.exec(`CREATE TABLE milestone_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_en TEXT NOT NULL,
    title_hu TEXT,
    description_en TEXT,
    description_hu TEXT,
    target_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    icon TEXT,
    media_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by_user_id TEXT,
    updated_by_user_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO milestone_steps(title_en,title_hu,sort_order) VALUES('Legacy milestone','Régi mérföldkő',0);`);
  db.close();
  const run=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env:{...process.env,DB_PATH:dbPath,BACKUP_DIR:backupDir},encoding:"utf8"});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const migrated=new Database(dbPath,{readonly:true});
  const cols=new Set(migrated.prepare('PRAGMA table_info("milestone_steps")').all().map(row=>row.name));
  assert.ok(cols.has("parent_uid"));
  assert.ok(cols.has("step_kind"));
  assert.ok(cols.has("link_view"));
  assert.equal(migrated.prepare("SELECT title_en FROM milestone_steps ORDER BY id LIMIT 1").get().title_en,"Legacy milestone");
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_milestone_steps_parent'").get());
  migrated.close();
  fs.rmSync(temp,{recursive:true,force:true});
});

test("VIP clients have explicit last-contacted tracking and a three-month warning",()=>{
  const schema=read("server/schema.sql"),init=read("server/init-db.js"),core=read("server/round1-core.js"),app=read("public/app.js"),css=read("public/styles.css");
  assert.match(schema,/last_contacted_at TEXT/);
  assert.match(init,/last_contacted_at/);
  assert.match(core,/last_contacted_at/);
  assert.match(core,/vip_followup_due/);
  assert.match(app,/Last contacted/);
  assert.match(app,/name="last_contacted_at" type="date"/);
  assert.match(app,/vipFollowupWarning/);
  assert.match(app,/vip-followup-warning/);
  assert.match(css,/\.vip-followup-warning/);
});

test("complete database export creates a structured native XLSX workbook and protects authentication secrets",()=>{
  const api=read("server/operations-enhancements.js"),v6=read("public/v6.js"),ops=read("public/operations-ui.js");
  assert.match(api,/\/api\/system-export\.xlsx/);
  assert.match(api,/SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name/);
  assert.match(api,/Manifest/);
  assert.match(api,/schema_sql/);
  assert.match(api,/Export Notes/);
  assert.match(api,/__part_2/);
  assert.match(api,/Content-Disposition/);
  assert.match(api,/password_hash/);
  assert.match(api,/password\|secret\|token\|code_hash\|otp_hash\|activation_hash/);
  assert.match(api,/\[REDACTED\]/);
  assert.doesNotMatch(api,/password\|secret\|token\|code_hash\|signature/);
  assert.match(v6,/operationsExportRecoveryCard/);
  assert.match(v6,/bindOperationsExportRecovery/);
  assert.match(ops,/Authentication secrets such as password hashes and tokens are securely redacted/);
  assert.match(ops,/business and relationship data remain complete/);
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
  const safe=excelSafeTable(["content"],[{content:"x".repeat(65010)}]);
  assert.deepEqual(safe.headers,["content","content__part_2","content__part_3"]);
  assert.equal(safe.rows[0].content.length,30000);
  assert.equal(safe.rows[0].content__part_2.length,30000);
  assert.equal(safe.rows[0].content__part_3.length,5010);
});

test("final theme normalization covers legacy fixed-light admin surfaces and narrows invoice quantity",()=>{
  const css=read("public/styles.css"),round3=read("public/round3.js");
  assert.match(css,/OPERATIONS V37/);
  assert.match(css,/OPERATIONS V38/);
  assert.match(css,/\.dialog-card,[\s\S]{0,1000}background:var\(--surface\)!important/);
  assert.match(css,/\.nav-item:hover:not\(:disabled\),[\s\S]{0,500}background:var\(--surface-2\)!important/);
  assert.match(css,/\.calendar-event-block\{[\s\S]{0,450}background:color-mix\(in srgb,var\(--tech-color\) 11%,var\(--surface\)\)!important/);
  assert.match(css,/\.month-day-cell\.outside-month,[\s\S]{0,450}background:var\(--surface-2\)!important/);
  assert.match(css,/\.overview-table th,[\s\S]{0,450}background:var\(--surface-2\)!important/);
  assert.match(css,/\.cms-upload code\{[\s\S]{0,220}background:var\(--surface-3\)!important/);
  assert.match(css,/\.invoice-line\{[\s\S]{0,200}grid-template-columns:minmax\(105px,.62fr\) minmax\(240px,1.65fr\) 72px minmax\(145px,.8fr\) 42px!important/);
  assert.match(css,/\[data-line-quantity\][\s\S]{0,120}max-width:72px!important/);
  assert.match(css,/\.typeahead-menu,[\s\S]{0,600}background:var\(--surface\)!important/);
  assert.match(css,/\.invoice-detail-kpis>div,[\s\S]{0,1000}background:var\(--surface\)!important/);
  assert.match(css,/\.database-export-card/);
  assert.match(css,/\.database-export-security-note/);
  assert.match(css,/\.vip-followup-warning/);
  assert.match(css,/\.milestone-view/);
  assert.match(css,/:root\[data-theme="dark"\] input\[type="date"\]/);
  assert.match(round3,/data-line-quantity/);
  assert.match(round3,/data-line-price/);
});

test("admin surfaces wire Milestone editing into Settings, retain user-level skill editing and keep complete export recovery",()=>{
  const v6=read("public/v6.js"),ops=read("public/operations-ui.js"),app=read("public/app.js");
  assert.match(v6,/operationsMilestoneProfileCard/);
  assert.match(v6,/bindOperationsMilestoneProfile/);
  assert.match(v6,/admin&&typeof operationsMilestoneProfileCard/);
  assert.doesNotMatch(v6,/operationsSkillsSettingsCard\(users\)/);
  assert.doesNotMatch(v6,/bindOperationsSkillsSettings\(\)/);
  assert.match(v6,/primary_skill_id/);
  assert.match(app,/skill_ids/);
  assert.match(v6,/operationsExportRecoveryCard/);
  assert.match(v6,/bindOperationsExportRecovery/);
  assert.match(ops,/function operationsMilestoneProfileCard/);
  assert.match(ops,/function operationsExportRecoveryCard/);
});
