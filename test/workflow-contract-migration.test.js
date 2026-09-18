'use strict';
// Populated 42-schema upgrade test. The fixture is inert historical SQL, never runtime code.
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const Database=require('better-sqlite3'),{migrateWorkflowContract}=require('../server/workflow-contract-migration');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'kh-v42-upgrade-'));
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
function baseline(name){
 const db=new Database(path.join(temp,name+'.sqlite'));db.pragma('foreign_keys=ON');db.pragma('journal_mode=WAL');
 db.exec(fs.readFileSync(path.join(root,'server/schema.sql'),'utf8'));db.exec(fs.readFileSync(path.join(__dirname,'fixtures/workflow-v42-schema.sql'),'utf8'));
 require('../server/workshop-workflow').registerWorkshopWorkflowRoutes({app:new Proxy({},{get:()=>()=>{}}),db,auth:()=>{},permit:()=>()=>{}});
 db.exec(`INSERT INTO users(id,name,email,password_hash,role,status) VALUES('M','Main','m@example.invalid','fixture','MANAGER','Active'),('W','Worker','w@example.invalid','fixture','WORKER','Active');
 INSERT INTO contacts(id,name) VALUES('C','Preserved client');INSERT INTO pianos(id,brand,model,owner_contact_id) VALUES('P','Steinway','B','C');
 INSERT INTO wf2_workflows(id,workflow_key,title,client_id,piano_id,creator_user_id,main_responsible_user_id,mode,start_at,final_due_at) VALUES('WF','KEY','Existing 42 workflow','C','P','M','M','INBOUND','2027-10-01T09:15','2027-10-20T17:45');
 INSERT INTO wf2_phases(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,responsible_user_id,title,due_at) VALUES('PH','WF','INBOUND',0,'Intake','Intake','W','Existing phase','2027-10-19T10:15');
 INSERT INTO wf2_tasks(id,phase_id,title,due_at) VALUES('T','PH','Preserved task','2027-10-18T10:45');
 INSERT INTO wf2_task_assignees(task_id,user_id) VALUES('T','M'),('T','W');
 INSERT INTO wf2_checklist(id,phase_id,task_id,title) VALUES('CK','PH','T','Preserved checklist');
 INSERT INTO wf2_documents(id,phase_id,task_id,original_name,stored_name,mime_type,size_bytes,sha256,uploaded_by) VALUES('DOC','PH','T','note.txt','note-fixture.txt','text/plain',5,'fixture','M');
 INSERT INTO wf2_costs(id,phase_id,title,category,amount_cents,charge_cents,created_by) VALUES('COST','PH','Existing material','MATERIAL',1599,0,'M');
 INSERT INTO jobs(id,job_key,title,assigned_to,start_time,end_time) VALUES('J','J','Existing task appointment','W','2027-10-18T10:45','2027-10-18T11:15'),('NORMAL','NORMAL','Unrelated appointment','W','2027-10-11T09:15','2027-10-11T10:15');
 INSERT INTO wf2_calendar_links(id,workflow_id,entity_type,entity_id,job_id) VALUES('L','WF','TASK','T','J');
 INSERT OR IGNORE INTO accounts(code,name_en,name_hu,category,normal_side) VALUES('1010','Cash','Cash','ASSET','DEBIT'),('3000','Equity','Equity','EQUITY','CREDIT');
 INSERT INTO journal_entries(id,entry_date,description,status) VALUES('JE','2027-10-01','Preserved general ledger','POSTED');
 INSERT INTO journal_lines(id,entry_id,account_code,debit,credit) VALUES('JL1','JE','1010',25,0),('JL2','JE','3000',0,25);`);
 return db;
}
function protectedData(db){return JSON.stringify(Object.fromEntries(['contacts','pianos','jobs','journal_entries','journal_lines','wf2_task_assignees','wf2_checklist','wf2_documents'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()])));}
test('migration 01 populated original schema retains tasks, assignees, documents, appointments and journals',()=>{
 const db=baseline('populated');try{
 const before=protectedData(db);migrateWorkflowContract(db);db.exec(fs.readFileSync(path.join(root,'server/workflow-v2-schema.sql'),'utf8'));migrateWorkflowContract(db);
 assert.equal(protectedData(db),before);assert.equal(db.prepare('SELECT title FROM workshop_subtasks WHERE id=?').get('T').title,'Preserved task');
 assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='wf2_tasks'").get(),undefined);
 for(const table of ['wf2_task_assignees','wf2_checklist','wf2_documents'])assert.ok(db.pragma('foreign_key_list('+table+')').some(x=>x.table==='workshop_subtasks'));
 assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
 }finally{db.close();}
});
test('migration 02 real startup creates pre-migration backup; repeated startup preserves rows and quarter-hour history',()=>{
 let db=baseline('startup');const filename=db.name;const originalTask=db.prepare('SELECT * FROM wf2_tasks WHERE id=?').get('T');const journal=JSON.stringify(db.prepare('SELECT * FROM journal_lines ORDER BY id').all());db.close();
 const run=()=>spawnSync(process.execPath,['server/init-db.js'],{cwd:root,env:{...process.env,DB_PATH:filename,BACKUP_DIR:path.join(temp,'backups')},encoding:'utf8'});
 for(let i=0;i<2;i++){const r=run();assert.equal(r.status,0,r.stderr+'\n'+r.stdout);}
 db=new Database(filename);db.pragma('foreign_keys=ON');try{
 const upgradedTask=db.prepare('SELECT * FROM workshop_subtasks WHERE id=?').get('T');
 assert.equal(upgradedTask.planned_cost_cents,null);assert.equal(upgradedTask.planned_cost_category,'OTHER');
 const preservedColumns=Object.fromEntries(Object.keys(originalTask).map(key=>[key,upgradedTask[key]]));
 assert.deepEqual(preservedColumns,{...originalTask});
 assert.equal(db.prepare('SELECT start_at FROM wf2_workflows WHERE id=?').get('WF').start_at,'2027-10-01T09:15');
 assert.equal(db.prepare('SELECT start_time FROM jobs WHERE id=?').get('J').start_time,'2027-10-18T10:45');
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM journal_lines ORDER BY id').all()),journal);
 assert.equal(db.pragma('journal_mode',{simple:true}),'wal');assert.deepEqual(db.pragma('foreign_key_check'),[]);
 const backups=fs.readdirSync(path.join(temp,'backups')).filter(x=>x.endsWith('.sqlite'));assert.ok(backups.length>=1);
 const backup=new Database(path.join(temp,'backups',backups[0]));try{assert.equal(backup.prepare('SELECT title FROM wf2_tasks WHERE id=?').get('T').title,'Preserved task');}finally{backup.close();}
 }finally{db.close();}
});
test('migration 03 ambiguous parallel task models fail closed without dropping either table',()=>{
 const db=baseline('ambiguous');try{db.exec('CREATE TABLE workshop_subtasks(id TEXT PRIMARY KEY)');const before=protectedData(db);
 assert.throws(()=>migrateWorkflowContract(db),/WORKFLOW_SUBTASK_MIGRATION_AMBIGUOUS/);assert.equal(protectedData(db),before);assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='wf2_tasks'").get());
 assert.ok(!db.pragma('table_info(wf2_workflows)').some(x=>x.name==='finance_locked'));}finally{db.close();}
});
test('migration 04 disabled foreign keys are rejected before any schema change',()=>{
 const db=baseline('fk');try{db.pragma('foreign_keys=OFF');assert.throws(()=>migrateWorkflowContract(db),/WORKFLOW_FOREIGN_KEYS_REQUIRED/);assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='wf2_tasks'").get());}finally{db.close();}
});
test('migration 05 historical completed workflow receives financial lock',()=>{
 const db=baseline('closed');try{db.exec("UPDATE wf2_workflows SET status='COMPLETED' WHERE id='WF'");migrateWorkflowContract(db);assert.equal(db.prepare("SELECT finance_locked FROM wf2_workflows WHERE id='WF'").get().finance_locked,1);}finally{db.close();}
});
