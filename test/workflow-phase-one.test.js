"use strict";
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {once}=require('node:events');
const Database=require('better-sqlite3');
const jwt=require('jsonwebtoken');
const {ARCHIVE_TABLES,RETIRED_TABLES,retireLegacyWorkflow,installWorkflowDeletionGuards,workflowPurgePlan,purgeWorkflowHistory}=require('../server/workflow-retirement');
const {createInvoiceEngine}=require('../server/business-operations');
const {createWorkflowFinance}=require('../server/workflow-finance');
const root=path.resolve(__dirname,'..');
const schema=fs.readFileSync(path.join(root,'server/schema.sql'),'utf8');
const exists=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const count=(db,name)=>db.prepare(`SELECT count(*) n FROM ${name}`).get().n;
const nowDate=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const actor={id:'U-SA',name:'Test superadmin',role:'SUPERADMIN',is_superadmin:1};
function fresh(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(schema);installWorkflowDeletionGuards(db);return db;}
function people(db){
 for(const [id,role,superFlag] of [['U-SA','ADMIN',1],['U-A','ADMIN',0],['U-M','MANAGER',0],['U-W','WORKER',0]])db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,is_superadmin) VALUES(?,?,?,'test-not-a-login-hash',?,'Active',?)").run(id,id,`${id}@example.invalid`,role,superFlag);
 db.exec("INSERT INTO contacts(id,name) VALUES('C','Protected client');INSERT INTO pianos(id,display_name,brand,model,owner_contact_id) VALUES('P','Protected piano','Steinway','B','C')");
}
function legacy(){
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');
 if(process.env.WORKFLOW_BASELINE_ZIP){
  const zip=new(require('adm-zip'))(process.env.WORKFLOW_BASELINE_ZIP);
  const entry=zip.getEntry('klavierhaus-erp-develop/server/schema.sql');assert.ok(entry,'40-es ZIP schema required');db.exec(entry.getData().toString());
 }else{
  db.exec(schema);
  for(const [oldName,newName] of Object.entries(ARCHIVE_TABLES))db.exec(`ALTER TABLE ${newName} RENAME TO ${oldName}`);
  db.exec(`CREATE TABLE workflow_materials(id TEXT PRIMARY KEY, workflow_id TEXT REFERENCES workshop_workflows(id),inventory_item_id TEXT, status TEXT,requested_quantity REAL,consumed_quantity REAL);
   CREATE TABLE workshop_subtasks(id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES workshop_workflows(id));
   CREATE TABLE workflow_documents(id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES workshop_workflows(id));
   CREATE TABLE workflow_stage_transfers(id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES workshop_workflows(id));
   CREATE TABLE workflow_audit_events(id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES workshop_workflows(id));`);
 }
 people(db);return db;
}
function seedWorkflow(db,old=false){
 const w=old?'workshop_workflows':'workflow_finance_sources',p=old?'workflow_stages':'workflow_finance_phases';
 db.prepare(`INSERT INTO ${w}(id,workflow_key,client_id,piano_id,mode,title,final_due_at) VALUES('WF','WF-TEST','C','P','INBOUND','Retired work','2026-09-18T17:00')`).run();
 db.prepare(`INSERT INTO ${p}(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,assigned_user_id,due_at) VALUES('ST','WF','INBOUND',0,'Intake','Beérkezés','U-A','2026-09-18T09:00')`).run();
 return db.prepare(`SELECT * FROM ${w} WHERE id='WF'`).get();
}
function invoice(db,id,source,sourceId,amount=100){db.prepare("INSERT INTO invoices(id,direction,invoice_number,issue_date,source_type,source_id,subtotal,total_amount,status,client_id) VALUES(?,'receivable',?,'2026-09-18',?,?,?,?,'issued','C')").run(id,`INV-${id}`,source,sourceId,amount,amount);}
function phaseLine(db,amount=100){db.prepare("INSERT INTO workflow_finance_lines(id,workflow_id,stage_id,line_type,category,title,amount) VALUES('L','WF','ST','COST','LABOR','Cost',?)").run(amount);return db.prepare("SELECT * FROM workflow_finance_lines WHERE id='L'").get();}
function purge(db){return purgeWorkflowHistory({db,actor,confirmation:'DELETE ALL WORKFLOWS'});}

test('Phase I / 01: fresh schema, FK references and all seven configuration phases',()=>{
 const db=fresh();try{people(db);db.exec("INSERT INTO jobs(id,title,assigned_to,start_time,end_time) VALUES('J','Ordinary calendar work','U-A','2026-09-18T09:00','2026-09-18T10:00')");assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');for(const name of [...Object.keys(ARCHIVE_TABLES),...RETIRED_TABLES])assert.equal(exists(db,name),false,name);for(const name of Object.values(ARCHIVE_TABLES))assert.ok(exists(db,name),name);}finally{db.close();}
});
test('Phase I / 02: v40 migration archives finance, removes old tables, protects ordinary jobs and master records',()=>{
 const db=legacy();try{
  seedWorkflow(db,true);db.exec("INSERT INTO jobs(id,job_key,title,job_type,start_time,end_time,status,assigned_to) VALUES('GEN','WFJOB-WF-TEST','Generated','Workflow','2026-09-18T09:00','2026-09-18T10:00','Open','U-A');UPDATE workshop_workflows SET job_id='GEN' WHERE id='WF';INSERT INTO jobs(id,title,workshop_workflow_id,workflow_id,status,assigned_to,start_time,end_time) VALUES('MAN','Manual linked work','WF','WF','Open','U-A','2026-09-18T09:00','2026-09-18T10:00')");
  invoice(db,'FW','workflow','WF');invoice(db,'FM','manual','MANUAL');const protectedBefore=['users','contacts','pianos','invoices'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]);
  const upgradeDir=fs.mkdtempSync(path.join(os.tmpdir(),'kh-nonempty-upgrade-')),upgradePath=path.join(upgradeDir,'legacy.sqlite');fs.writeFileSync(upgradePath,db.serialize());
  const upgradeEnv={...process.env,DB_PATH:upgradePath,BACKUP_DIR:path.join(upgradeDir,'backups')};
  for(let pass=0;pass<2;pass++){const init=spawnSync(process.execPath,['server/init-db.js'],{cwd:root,env:upgradeEnv,encoding:'utf8'});assert.equal(init.status,0,init.stderr||init.stdout);}
  const upgraded=new Database(upgradePath);assert.equal(count(upgraded,'workflow_finance_sources'),1);assert.equal(count(upgraded,'invoices'),2);assert.equal(upgraded.prepare("SELECT status FROM jobs WHERE id='MAN'").get().status,'Open');assert.deepEqual(upgraded.pragma('foreign_key_check'),[]);upgraded.close();assert.ok(fs.readdirSync(upgradeEnv.BACKUP_DIR).some(name=>name.endsWith('.sqlite')));
  const result=retireLegacyWorkflow(db);assert.equal(result.archived_workflows,1);assert.equal(result.retired_calendar_jobs,1);db.exec(schema);installWorkflowDeletionGuards(db);
  for(const [table,expected] of protectedBefore)assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),expected,table);
  assert.equal(db.prepare("SELECT status FROM jobs WHERE id='GEN'").get().status,'Cancelled');assert.equal(db.prepare("SELECT status,workshop_workflow_id FROM jobs WHERE id='MAN'").get().status,'Open');assert.equal(db.prepare("SELECT workshop_workflow_id FROM jobs WHERE id='MAN'").get().workshop_workflow_id,null);
  assert.equal(count(db,'workflow_finance_sources'),1);for(const name of [...Object.keys(ARCHIVE_TABLES),...RETIRED_TABLES])assert.equal(exists(db,name),false,name);assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(retireLegacyWorkflow(db).migrated,false);
 }finally{db.close();}
});
test('Phase I / 03: pre-calendar_job_id migration is safe before indexed new schema',()=>{
 const db=legacy();try{seedWorkflow(db,true);db.exec('DROP INDEX IF EXISTS idx_workflow_stage_calendar_job');db.exec('ALTER TABLE workflow_stages DROP COLUMN calendar_job_id');retireLegacyWorkflow(db);assert.doesNotThrow(()=>db.exec(schema));assert.ok(db.pragma('table_info(workflow_finance_phases)').some(c=>c.name==='calendar_job_id'));}finally{db.close();}
});
test('Phase I / 04: ambiguous ownership stops migration atomically',()=>{
 const db=legacy();try{seedWorkflow(db,true);db.exec('CREATE TABLE workflow_finance_sources(id TEXT PRIMARY KEY)');assert.throws(()=>retireLegacyWorkflow(db),/WORKFLOW_MIGRATION_AMBIGUOUS_TABLES/);assert.ok(exists(db,'workflow_stages'));assert.equal(count(db,'workshop_workflows'),1);assert.deepEqual(db.pragma('foreign_key_check'),[]);}finally{db.close();}
});
test('Phase I rollback after ALTER TABLE preserves the original schema and reservation',()=>{
 const db=legacy();try{seedWorkflow(db,true);db.exec("INSERT INTO inventory_items(id,item_name,quantity,reserved_quantity) VALUES('INV','Shared stock',10,1)");
 const columns=db.pragma('table_info(workflow_materials)').map(c=>c.name),values={id:'M',workflow_id:'WF',inventory_item_id:'INV',status:'RESERVED',requested_quantity:3,consumed_quantity:0,source_type:'CENTRAL_INVENTORY',item_name:'Test stock'};const fields=Object.keys(values).filter(k=>columns.includes(k));db.prepare('INSERT INTO workflow_materials('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...fields.map(f=>values[f]));
 assert.throws(()=>retireLegacyWorkflow(db),/WORKFLOW_INVENTORY_RESERVATION_MISMATCH/);assert.ok(exists(db,'workshop_workflows'));assert.ok(exists(db,'workflow_stages'));assert.equal(exists(db,'workflow_finance_sources'),false);assert.equal(db.prepare("SELECT reserved_quantity FROM inventory_items WHERE id='INV'").get().reserved_quantity,1);assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();}
});
test('Phase I / 05: zero-dollar workflow invoices create no document, sequence or financial row',()=>{
 const db=fresh();try{people(db);const workflow=seedWorkflow(db);const engine=createInvoiceEngine({db});const stages=db.prepare('SELECT * FROM workflow_finance_phases').all();
  assert.equal(engine.createWorkflowInvoice({workflow,stages,lines:[]}),null);
  assert.equal(engine.createInvoice({direction:'receivable',sourceType:'workflow',sourceId:'WF',items:[{quantity:1,unit_price:0}]}),null);
  assert.equal(engine.createInvoice({direction:'receivable',sourceType:'workflow',sourceId:'WF',items:[{quantity:1,unit_price:100,total_price:0}]}),null);
  assert.equal(engine.createWorkflowPayableInvoice({workflow,line:{id:'Z',amount:0},partner:{id:'Z'}}),null);
  db.prepare("INSERT INTO workflow_retired_calendar_jobs(job_id,workflow_id,snapshot_json) VALUES('OLD-J','WF','{}')").run();assert.deepEqual(engine.createJobInvoices({job:{id:'OLD-J',billed_amount:0}}),[]);
  assert.equal(count(db,'invoices'),0);assert.equal(count(db,'invoice_items'),0);assert.equal(count(db,'invoice_sequences'),0);assert.equal(count(db,'financial_items'),0);
 }finally{db.close();}
});
test('Phase I / 06: positive phase invoice and balanced WIP/release financial contracts preserved',()=>{
 const db=fresh();try{people(db);const workflow=seedWorkflow(db);phaseLine(db,125);let seq=0;db.exec("INSERT INTO accounts(code,name_en,name_hu,category,normal_side) VALUES('1010','Cash','Pénztár','ASSET','DEBIT'),('5000','Cost','Költség','EXPENSE','DEBIT')");const finance=createWorkflowFinance({db,rid:p=>`${p}-${++seq}`});
  db.transaction(()=>finance.postWipForLine(db.prepare("SELECT * FROM workflow_finance_lines WHERE id='L'").get(),workflow,actor))();
  db.transaction(()=>finance.releaseWipForLine(db.prepare("SELECT * FROM workflow_finance_lines WHERE id='L'").get(),workflow,actor))();
  const stale={...db.prepare("SELECT * FROM workflow_finance_lines WHERE id='L'").get(),wip_journal_entry_id:null};finance.postWipForLine(stale,workflow,actor);assert.equal(count(db,'journal_entries'),2);for(const row of db.prepare('SELECT entry_id,sum(debit) d,sum(credit) c FROM journal_lines GROUP BY entry_id').all())assert.equal(row.d,row.c);
  const engine=createInvoiceEngine({db});const bill=engine.createWorkflowInvoice({workflow,lines:db.prepare('SELECT * FROM workflow_finance_lines').all(),paymentMethod:'Cash'});assert.equal(bill.subtotal,125);assert.equal(bill.items.length,1);assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();}
});
test('Phase I / 07: proven orphan workflow invoices purged, shared schema and unrelated money preserved',()=>{
 const db=fresh();try{people(db);invoice(db,'WF-ORPHAN','workflow','DELETED-WORKFLOW');invoice(db,'MANUAL','manual','STAYS');db.exec("INSERT INTO financial_items(id,item_date,title,amount,main_type,source_type,source_id) VALUES('FW','2026-09-18','Retired',100,'INCOME','WORKFLOW_INVOICE_REVENUE','WORKFLOW_INVOICE_REVENUE:DELETED-WORKFLOW'),('FM','2026-09-18','Protected',250,'INCOME','MANUAL_INVOICE','MANUAL')");const invoiceBefore=db.prepare("SELECT * FROM invoices WHERE id='MANUAL'").get(),financialBefore=db.prepare("SELECT * FROM financial_items WHERE id='FM'").get();
  const result=purge(db);assert.equal(result.counts.invoices,1);assert.deepEqual(db.prepare("SELECT * FROM invoices WHERE id='MANUAL'").get(),invoiceBefore);assert.deepEqual(db.prepare("SELECT * FROM financial_items WHERE id='FM'").get(),financialBefore);assert.equal(count(db,'workflow_financial_delete_scope'),0);assert.throws(()=>db.prepare("DELETE FROM invoices WHERE id='MANUAL'").run(),/IMMUTABLE/);assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();}
});
test('Phase I full purge cascades archived phases, cost lines and proven generated calendar jobs only',()=>{
 const db=fresh();try{people(db);seedWorkflow(db);phaseLine(db,75);invoice(db,'WI','workflow','WF');invoice(db,'KEEP','manual','KEEP');
 db.exec("INSERT INTO jobs(id,title,assigned_to,start_time,end_time) VALUES('GEN','Generated','U-A','2026-09-18T09:00','2026-09-18T10:00');INSERT INTO workflow_retired_calendar_jobs(job_id,workflow_id,snapshot_json) VALUES('GEN','WF','{}');UPDATE workflow_finance_phases SET calendar_job_id='GEN';UPDATE workflow_finance_sources SET job_id='GEN'");
 purge(db);assert.equal(count(db,'workflow_finance_sources'),0);assert.equal(count(db,'workflow_finance_phases'),0);assert.equal(count(db,'workflow_finance_lines'),0);assert.equal(count(db,'workflow_retired_calendar_jobs'),0);assert.equal(count(db,'jobs'),0);assert.equal(count(db,'invoices'),1);assert.equal(count(db,'contacts'),1);assert.equal(count(db,'pianos'),1);assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();}
});
test('Phase I / 08: purge checks Superadmin, typed confirmation and shared references',()=>{
 const db=fresh();try{people(db);seedWorkflow(db);invoice(db,'I','workflow','WF');db.exec("INSERT INTO jobs(id,title,invoice_id,assigned_to,start_time,end_time) VALUES('SHARED','Unrelated job','I','U-A','2026-09-18T09:00','2026-09-18T10:00')");assert.throws(()=>purgeWorkflowHistory({db,actor:{id:'U-A',role:'ADMIN'},confirmation:'DELETE ALL WORKFLOWS'}),/SUPERADMIN_REQUIRED/);assert.throws(()=>purgeWorkflowHistory({db,actor,confirmation:'YES'}),/CONFIRMATION/);assert.throws(()=>purge(db),/WORKFLOW_SHARED_INVOICE_JOB/);assert.equal(count(db,'invoices'),1);assert.equal(count(db,'workflow_finance_sources'),1);assert.equal(count(db,'workflow_financial_delete_scope'),0);}finally{db.close();}
});
test('Phase I / 09: closed-month financial data is not partially removed',()=>{
 const db=fresh();try{people(db);invoice(db,'I','workflow','OLD');const cols=db.pragma('table_info(financial_statement_snapshots)');const names=cols.filter(c=>(c.notnull||c.name==='period')&&!c.dflt_value).map(c=>c.name);const values=names.map(name=>name==='period'?'2026-09':name==='snapshot_json'?'{}':name.includes('total')?0:'test');db.prepare(`INSERT INTO financial_statement_snapshots(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).run(...values);assert.throws(()=>purge(db),/WORKFLOW_CLOSED_PERIOD_REVIEW_REQUIRED/);assert.equal(count(db,'invoices'),1);assert.equal(count(db,'financial_statement_snapshots'),1);assert.equal(count(db,'workflow_financial_delete_scope'),0);}finally{db.close();}
});

let server,db,base,temp,secret='phase-one-local-test-secret-at-least-32-characters';
const tokens={};
async function request(endpoint,{id='U-SA',method='GET',body}={}){
 const res=await fetch(base+endpoint,{method,headers:{Authorization:`Bearer ${tokens[id]||''}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const raw=await res.text();let payload;try{payload=JSON.parse(raw);}catch{payload=raw;}return {status:res.status,payload};
}
before(async()=>{
 temp=fs.mkdtempSync(path.join(os.tmpdir(),'kh-phase1-test-'));
 Object.assign(process.env,{DB_PATH:path.join(temp,'test.sqlite'),BACKUP_DIR:path.join(temp,'backups'),UPLOAD_DIR:path.join(temp,'uploads'),JWT_SECRET:secret,PORT:'0'});
 const init=spawnSync(process.execPath,['server/init-db.js'],{cwd:root,env:process.env,encoding:'utf8'});assert.equal(init.status,0,init.stderr);
 const setup=new Database(process.env.DB_PATH);people(setup);setup.prepare("INSERT INTO jobs(id,job_key,title,client_id,piano_id,assigned_user_id,assigned_to,status,start_time,end_time,payment_method,planned_amount,planned_hours) VALUES('J-TEST','J-TEST','Notification test','C','P','U-A','U-A','Open',?,?,'Cash',50,1)").run(`${nowDate()}T09:00`,`${nowDate()}T10:00`);setup.close();
 const app=require('../server/index');db=app.db;server=app.startServer(0);await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
 for(const id of ['U-SA','U-A','U-M','U-W'])tokens[id]=jwt.sign({id,session_version:0,role:id==='U-SA'?'SUPERADMIN':id==='U-A'?'ADMIN':id==='U-M'?'MANAGER':'WORKER'},secret,{expiresIn:'1h'});
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db?.open)db.close();});
test('Phase I / 10: real authenticated API returns empty shell, seven phases, no old modal routes',async()=>{
 for(const id of ['U-SA','U-A','U-M','U-W']){const r=await request('/api/workshop-shell',{id});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.payload.stages.length,7);assert.deepEqual(r.payload.workflows,[]);assert.equal(r.payload.creation_enabled,false);}
 assert.equal((await request('/api/workshop-shell',{id:'NONE'})).status,401);
 for(const method of ['GET','POST','PUT','DELETE'])assert.equal((await request('/api/workflows/old',{method})).status,410);
 assert.deepEqual((await request('/api/workshop-shell/calendar')).payload,[]);
 assert.equal((await request('/api/workshop-shell/purge-preview',{id:'U-A'})).status,403);
 assert.equal((await request('/api/workshop-shell/cards/old',{id:'U-W',method:'DELETE'})).status,403);
 assert.equal((await request('/api/workshop-shell/cards/old',{id:'U-A',method:'DELETE'})).status,404);
});
test('Phase I / 11: phase settings save, validation, audit and restart persistence',async()=>{
 const stages=(await request('/api/workshop-shell/phases')).payload.stages;stages[0].name_hu='Teszt beérkezés';
 assert.equal((await request('/api/workshop-shell/phases',{id:'U-W',method:'PUT',body:{stages}})).status,403);
 assert.equal((await request('/api/workshop-shell/phases',{id:'U-A',method:'PUT',body:{stages}})).status,200);
 assert.equal(db.prepare("SELECT count(*) n FROM audit_log WHERE action='PHASE_DEFINITIONS_UPDATED'").get().n,1);
 const invalid=stages.map(s=>({...s,sort_order:0}));assert.equal((await request('/api/workshop-shell/phases',{method:'PUT',body:{stages:invalid}})).status,400);
 const restarted=spawnSync(process.execPath,['server/init-db.js'],{cwd:root,env:process.env,encoding:'utf8'});assert.equal(restarted.status,0,restarted.stderr);assert.equal((await request('/api/workshop-shell/phases')).payload.stages[0].name_hu,'Teszt beérkezés');assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('journal_mode',{simple:true}),'wal');
});
test('Phase I / 12: notification load, close-all and isolated exact 3-hour snooze',async()=>{
 const initial=await request('/api/notifications/active',{id:'U-A'});assert.equal(initial.status,200);assert.ok(initial.payload.notifications.some(r=>r.entity_id==='J-TEST'));assert.ok(initial.payload.notifications.every(r=>r.entity_type!=='WORKFLOW_STAGE'));
 const start=Date.now(),snooze=await request('/api/notifications/snooze-all',{id:'U-A',method:'POST',body:{}});assert.equal(snooze.status,200,JSON.stringify(snooze));const until=Date.parse(snooze.payload.snoozed_until);assert.ok(until>=start+10800000&&until<=Date.now()+10800000);
 assert.equal((await request('/api/notifications/active',{id:'U-A'})).payload.notifications.length,0);assert.ok((await request('/api/notifications/active',{id:'U-M'})).payload.notifications.some(r=>r.entity_id==='J-TEST'));assert.equal(db.prepare("SELECT count(*) n FROM notification_snooze_log WHERE user_id='U-A'").get().n,initial.payload.notifications.length);
 db.prepare("UPDATE notification_snooze_log SET snoozed_until='2000-01-01T00:00:00.000Z' WHERE user_id='U-A'").run();assert.ok((await request('/api/notifications/active',{id:'U-A'})).payload.notifications.length);
});
test('Phase I / 13: reschedule persists calendar and audit, rejects unauthorized and invalid times',async()=>{
 const body={entity_type:'CALENDAR_JOB',entity_id:'J-TEST',target_date:`${nowDate()}T11:00`,reason:'Phase one notification test'};
 assert.equal((await request('/api/notifications/reschedule',{id:'U-W',method:'POST',body})).status,404);
 assert.equal((await request('/api/notifications/reschedule',{id:'U-A',method:'POST',body:{...body,target_date:`${nowDate()}T11:07`}})).status,400);
 const moved=await request('/api/notifications/reschedule',{id:'U-A',method:'POST',body});assert.equal(moved.status,200,JSON.stringify(moved));assert.equal(db.prepare("SELECT start_time FROM jobs WHERE id='J-TEST'").get().start_time,body.target_date);assert.ok(db.prepare("SELECT count(*) n FROM audit_log WHERE action='NOTIFICATION_RESCHEDULE'").get().n);
});
test('Phase I / 14: calendar notification completion posts finances once and disappears',async()=>{
 db.prepare("UPDATE jobs SET billed_amount=50 WHERE id='J-TEST'").run();const body={entity_type:'CALENDAR_JOB',entity_id:'J-TEST'};const completed=await request('/api/notifications/complete',{id:'U-A',method:'POST',body});assert.equal(completed.status,200,JSON.stringify(completed));const job=db.prepare("SELECT * FROM jobs WHERE id='J-TEST'").get();assert.equal(job.status,'Completed');assert.equal(job.financial_status,'POSTED');assert.equal(db.prepare("SELECT amount FROM financial_items WHERE source_type='JOB_REVENUE' AND source_id='JOB_REVENUE:J-TEST'").get().amount,50);assert.equal(db.prepare("SELECT subtotal FROM invoices WHERE source_type='job' AND source_id='J-TEST' AND direction='receivable'").get().subtotal,50);const totals=[count(db,'financial_items'),count(db,'invoices')];assert.equal((await request('/api/notifications/complete',{id:'U-A',method:'POST',body})).status,200);assert.deepEqual([count(db,'financial_items'),count(db,'invoices')],totals);assert.ok((await request('/api/notifications/active')).payload.notifications.every(r=>r.entity_id!=='J-TEST'));assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('Phase I / 15: JS renderer, handler delegation, shell contracts and scoped CSS (not visual layout)',async()=>{
 await require('./helpers/workflow-phase-one-renderer.cjs').verifyRenderer((await request('/api/workshop-shell/phases')).payload.stages);
 const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'),css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 assert.doesNotMatch(app,/function (?:openWorkflowDetails|openWorkflowCreate|renderWorkflowDrawer|workflowCreateForm)\b/);assert.doesNotMatch(app,/api\(['"`]\/api\/workflows(?:['"`/])/);assert.doesNotMatch(css,/\.workflow-(?:details|drawer|create-phase|next-stage)[\w-]*\s*[{,]/);assert.match(app,/function adminDatePickerOpen/);assert.match(app,/function bindWorkflowBrandCombobox/);assert.match(html,/workshop-shell\.js/);assert.match(css,/flex:0 0 320px/);assert.match(css,/\.unified-notification-reschedule-popover\{inset:auto 1\.5rem auto auto/);
 const handler=app.slice(app.indexOf('function bindDeadlineNotificationDelegation()'),app.indexOf('function initDeadlineNotificationEngine()'));assert.ok(handler.indexOf("==='snooze-all'")<handler.indexOf("if(!card||!row)return"));
});
