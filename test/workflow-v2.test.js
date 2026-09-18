"use strict";
// UI12 domain integration: real schema, real SQLite transactions and invoice engine.
// Run with Node 20.18.0 and the lockfile-installed better-sqlite3 dependency.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),Database=require('better-sqlite3');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'kh-ui12-'));
let db,engine;
const day=n=>'2027-10-'+String(n).padStart(2,'0');
const user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const one=(sql,...args)=>db.prepare(sql).get(...args);
const all=(sql,...args)=>db.prepare(sql).all(...args);
const error=(fn,code)=>assert.throws(fn,e=>e.code===code||e.message===code,code);
const total=(account,w)=>Number(one(`SELECT COALESCE(SUM(j.debit-j.credit),0) n FROM journal_lines j JOIN workflow_finance_lines l ON j.entry_id IN(l.wip_journal_entry_id,l.final_journal_entry_id,l.writeoff_journal_entry_id) WHERE l.workflow_id=? AND j.account_code=?`,w.id,account).n.toFixed(2));
const wip=w=>total('1400-WIP-INVENTORY',w),loss=w=>total('6900-LOSS-ON-ABANDONED-WORK',w);
const create=(extra={},actor='C0')=>engine.create({title:'UI12 isolated workflow',expected_revenue:0,client_id:'C',piano_id:'P',main_responsible_user_id:'M',start_at:day(1)+'T09:00',final_due_at:day(30)+'T17:00',phases:[{stage_code:'INBOUND',enabled:true}],...extra},user(actor));
const task=(w,extra={},actor='M')=>engine.saveTask(w.id,w.stages[0].id,null,{title:'Tune piano',assignee_ids:['W','W2'],...extra},user(actor)).stages[0].tasks.at(-1);
const cost=(w,extra={},actor='M')=>engine.saveCost(w.id,w.stages[0].id,null,{title:'Material',category:'MATERIAL',amount:123.45,...extra},user(actor)).stages[0].costs.at(-1);
const state=()=>JSON.stringify(Object.fromEntries(['wf2_workflows','wf2_phases','workshop_subtasks','wf2_costs','wf2_audit','jobs','wf2_calendar_links','workflow_finance_lines','journal_entries','journal_lines','invoices','financial_items'].map(table=>[table,all('SELECT * FROM '+table+' ORDER BY rowid')])));
before(()=>{
 const file=path.join(temp,'db.sqlite');
 const r=spawnSync(process.execPath,['server/init-db.js'],{cwd:root,env:{...process.env,DB_PATH:file,BACKUP_DIR:path.join(temp,'backups')},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr||r.stdout);
 db=new Database(file);db.pragma('foreign_keys=ON');db.pragma('journal_mode=WAL');
 for(const [id,role,sa] of [['SA','ADMIN',1],['A','ADMIN',0],['M','MANAGER',0],['W','WORKER',0],['W2','WORKER',0],['X','WORKER',0],['C0','WORKER',0]])db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,is_superadmin) VALUES(?,?,?,'test-only',?,'Active',?)").run(id,id,id+'@example.invalid',role,sa);
 db.exec("INSERT INTO contacts(id,name,phone) VALUES('C','Owner Client','+12125550100'),('C2','Other Client','+12125550200');INSERT INTO pianos(id,brand,model,owner_contact_id) VALUES('P','Steinway & Sons','Model B-211','C');INSERT INTO client_pianos(client_id,piano_id) VALUES('C2','P');INSERT INTO jobs(id,title,assigned_user_id,assigned_to,start_time,end_time) VALUES('NORMAL','Protected normal job','W','W','2027-10-10T09:00','2027-10-10T10:00')");
 require('../server/workshop-workflow').registerWorkshopWorkflowRoutes({app:new Proxy({},{get:()=>()=>{}}),db,auth:()=>{},permit:()=>()=>{}});
 engine=require('../server/workflow-v2').createWorkflowV2({db,invoiceEngine:require('../server/business-operations').createInvoiceEngine({db})});
});
after(()=>{if(db?.open)db.close();fs.rmSync(temp,{recursive:true,force:true});});

test('01 real initialization: WAL, FK, canonical task table, exact seven definitions',()=>{
 assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.equal(db.pragma('journal_mode',{simple:true}),'wal');
 assert.ok(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workshop_subtasks'"));assert.equal(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wf2_tasks'"),undefined);
 assert.equal(engine.definitions().length,7);assert.equal(engine.options().interval_minutes,30);assert.equal(engine.options().ui_contract,'UI12');
 for(const name of ['creator_user_id','main_responsible_user_id'])assert.equal(db.pragma('table_info(wf2_workflows)').find(c=>c.name===name).notnull,1);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('02 creator and main owner are distinct; creator has no implicit editing/closing rights',()=>{
 const w=create();assert.equal(w.creator_user_id,'C0');assert.equal(w.main_responsible_user_id,'M');assert.equal(w.permissions.edit_workflow,false);
 error(()=>engine.update(w.id,{title:'Forbidden'},user('C0')),'WORKFLOW_FORBIDDEN');error(()=>engine.closeWorkflow(w.id,{},user('C0')),'WORKFLOW_FORBIDDEN');
 assert.equal(engine.detail(w.id,user('M')).permissions.close_workflow,true);
});
test('03 seven independent phase selections create only enabled rows and calendar links',()=>{
 const defs=engine.definitions(),w=create({phases:defs.map((d,i)=>({stage_code:d.code,enabled:i%2===0}))});
 assert.equal(w.stages.length,4);assert.equal(w.calendar.length,6);assert.deepEqual(w.stages.map(p=>p.stage_code),defs.filter((_,i)=>i%2===0).map(d=>d.code));
 const full=create({phases:undefined});assert.equal(full.stages.length,7);assert.equal(full.calendar.length,9);
 const empty=create({phases:[]});assert.equal(empty.stages.length,0);assert.equal(empty.calendar.length,2);
});
test('04 creation is atomic and idempotent; invalid final phase leaves no partial workflow',()=>{
 const before=state();error(()=>create({phases:[{stage_code:'INBOUND',enabled:true},{stage_code:'ASSESSMENT',enabled:true,responsible_user_id:'MISSING'}]}),'WORKFLOW_ACTIVE_USER_REQUIRED');assert.equal(state(),before);
 error(()=>create({phases:[{stage_code:'INBOUND'},{stage_code:'INBOUND'}]}),'WORKFLOW_PHASE_SELECTION_INVALID');
 const first=create({request_key:'idempotent-42'}),second=create({request_key:'idempotent-42'});assert.equal(first.id,second.id);assert.equal(second.calendar.length,3);
});
test('05 phase owner is exactly one; main handover no longer needs a reason',()=>{
 const w=create({phases:undefined}),p=w.stages[0];
 assert.equal(engine.updatePhase(w.id,p.id,{responsible_user_id:'W'},user('M')).stages[0].responsible_user_id,'W');
 const d=engine.updatePhase(w.id,p.id,{responsible_user_id:'W',transfer_reason:'Assigned to technician'},user('M'));assert.equal(d.stages[0].responsible_user_id,'W');
 error(()=>engine.updatePhase(w.id,p.id,{responsible_user_id:'W2',transfer_reason:'Another technician'},user('W')),'WORKFLOW_FORBIDDEN');
 error(()=>engine.updatePhase(w.id,w.stages[1].id,{title:'Other phase'},user('W')),'WORKFLOW_FORBIDDEN');
 assert.throws(()=>db.prepare('UPDATE wf2_phases SET responsible_user_id=NULL WHERE id=?').run(p.id),/NOT NULL/);
});
test('06 task assignees are multiple, deduplicated, nonempty and default to phase owner',()=>{
 const w=create(),t=task(w,{assignee_ids:['W','W2','W']});assert.deepEqual(t.assignee_ids,['W','W2']);
 const defaultTask=task(w,{assignee_ids:undefined});assert.deepEqual(defaultTask.assignee_ids,['M']);
 error(()=>task(w,{assignee_ids:[]}),'WORKFLOW_ASSIGNEES_REQUIRED');assert.equal(one('SELECT count(*) n FROM workshop_subtasks WHERE phase_id=?',w.stages[0].id).n,2);
});
test('07 subresponsible can change own due date but cannot change content or assignees',()=>{
 const w=create(),p=w.stages[0],t=task(w,{due_at:day(5)+'T10:00'});
 engine.saveTask(w.id,p.id,t.id,{due_at:day(6)+'T10:30'},user('W'));
 assert.equal(one('SELECT due_at FROM workshop_subtasks WHERE id=?',t.id).due_at,day(6)+'T10:30');
 for(const body of [{title:'Wrong'},{assignee_ids:['X']},{required:false}])error(()=>engine.saveTask(w.id,p.id,t.id,body,user('W')),'WORKFLOW_FORBIDDEN');
 error(()=>engine.completeTask(w.id,p.id,t.id,{},user('X')),'WORKFLOW_FORBIDDEN');
 error(()=>engine.closePhase(w.id,p.id,{},user('W')),'WORKFLOW_FORBIDDEN');
});
test('08 all cross-workflow and cross-phase IDs are rejected without side effects',()=>{
 const a=create(),b=create(),t=task(a),before=state();
 error(()=>engine.updatePhase(b.id,a.stages[0].id,{title:'IDOR'},user('M')),'WORKFLOW_PHASE_NOT_FOUND');
 error(()=>engine.saveTask(b.id,b.stages[0].id,t.id,{title:'IDOR'},user('M')),'WORKFLOW_TASK_NOT_FOUND');assert.equal(state(),before);
});
test('09 admin mutations need no reason; automatic override audit remains itemized',()=>{
 const w=create(),p=w.stages[0],t=task(w),c=engine.checklist(w.id,p.id,null,{title:'Required inspection',task_id:t.id},user('M')).stages[0].checklist[0];
 assert.equal(engine.update(w.id,{title:'Admin change'},user('A')).title,'Admin change');
 error(()=>engine.closeWorkflow(w.id,{reason:'Emergency override'},user('A')),'WORKFLOW_OVERRIDE_CONFIRMATION_REQUIRED');
 const result=engine.closeWorkflow(w.id,{reason:'Emergency override',override:true},user('A'));assert.equal(result.status,'COMPLETED');
 const entries=all("SELECT * FROM wf2_audit WHERE workflow_id=? AND actor_user_id='A'",w.id);
 assert.ok(entries.some(a=>a.entity_id===t.id));assert.ok(entries.some(a=>a.entity_id===c.id));assert.ok(entries.filter(a=>a.action.includes('COMPLETE')).every(a=>a.reason==='Emergency override'));
});
test('10 superadmin overrides without required reason, retaining automatic change audit',()=>{
 const w=create();task(w);const before=one('SELECT count(*) n FROM wf2_audit WHERE workflow_id=?',w.id).n;
 assert.equal(engine.closeWorkflow(w.id,{},user('SA')).status,'COMPLETED');assert.ok(one('SELECT count(*) n FROM wf2_audit WHERE workflow_id=?',w.id).n>before);
});
test('11 strict half-hour validation rejects quarter-hours, invalid dates and DST gaps',()=>{
 const {localTime}=require('../server/workflow-v2');
 for(const value of ['2027-02-30T10:00','2027-10-02T09:15','2027-10-02T09:45','2027-10-02T24:00'])error(()=>localTime(value),'WORKFLOW_TIME_INVALID');
 error(()=>localTime('2027-03-14T02:30'),'WORKFLOW_TIME_DST_GAP');assert.equal(localTime('2027-10-02T09:30'),'2027-10-02T09:30');
 const before=state();error(()=>create({start_at:day(1)+'T09:15'}),'WORKFLOW_TIME_INVALID');assert.equal(state(),before);
});
test('11b new workflow rejects a start date before the current New York day without side effects',()=>{
 const before=state();error(()=>create({start_at:'2025-01-01T09:00',final_due_at:'2025-01-02T17:00'}),'WORKFLOW_START_BEFORE_TODAY');assert.equal(state(),before);
});
test('12 phase/task date hierarchy rollback includes data, calendar and audit',()=>{
 const w=create(),p=w.stages[0],before=state();
 error(()=>engine.updatePhase(w.id,p.id,{due_at:'2027-11-01T09:00'},user('M')),'WORKFLOW_PHASE_OUTSIDE_DATES');assert.equal(state(),before);
 engine.updatePhase(w.id,p.id,{due_at:day(8)+'T10:00'},user('M'));const second=state();
 error(()=>task(w,{due_at:day(9)+'T09:00'}),'WORKFLOW_TASK_OUTSIDE_DATES');assert.equal(state(),second);
});
test('13 optimistic version rejects stale changes and preserves first save',()=>{
 const w=create();engine.update(w.id,{version:w.version,title:'First edit'},user('M'));const before=state();
 error(()=>engine.update(w.id,{version:w.version,title:'Lost edit'},user('M')),'WORKFLOW_VERSION_CONFLICT');assert.equal(state(),before);
});
test('14 calendar rescheduling obeys all three responsibility levels without duplicate jobs',()=>{
 const w=create({phases:undefined}),p=w.stages[0];engine.updatePhase(w.id,p.id,{responsible_user_id:'W',transfer_reason:'Technician assignment'},user('M'));
 let detail=engine.detail(w.id,user('M')),phaseJob=detail.calendar.find(j=>j.entity_id===p.id).job_id;
 error(()=>engine.rescheduleJob(phaseJob,{start_time:day(9)+'T10:00'},user('W2')),'WORKFLOW_FORBIDDEN');
 engine.rescheduleJob(phaseJob,{start_time:day(9)+'T10:30'},user('W'));assert.equal(one('SELECT due_at FROM wf2_phases WHERE id=?',p.id).due_at,day(9)+'T10:30');
 const t=task(w,{due_at:day(5)+'T10:00',assignee_ids:['W2']},'W'),tj=engine.detail(w.id,user('M')).calendar.find(j=>j.entity_id===t.id).job_id;
 engine.rescheduleJob(tj,{target_date:day(6)+'T10:30'},user('W2'));
 assert.equal(one('SELECT due_at FROM workshop_subtasks WHERE id=?',t.id).due_at,day(6)+'T10:30');
 assert.equal(one('SELECT COUNT(*) n FROM wf2_calendar_links WHERE entity_id=?',t.id).n,1);
 const row=engine.calendarRow(one('SELECT * FROM jobs WHERE id=?',tj),user('W2'));assert.equal(row.wf2_phase_id,p.id);assert.equal(row.wf2_can_edit,true);
 error(()=>engine.rescheduleJob(tj,{target_date:day(7)+'T10:15'},user('W2')),'WORKFLOW_TIME_INVALID');
 error(()=>engine.rescheduleJob(tj,{target_date:day(7)+'T10:00',assigned_user_id:'X'},user('W2')),'WORKFLOW_ASSIGN_IN_DETAILS');
});
test('15 checklist gates task and phase; progress uses completed task rows',()=>{
 const w=create(),p=w.stages[0],t=task(w),d=engine.checklist(w.id,p.id,null,{title:'Inspect',task_id:t.id},user('M')),check=d.stages[0].checklist[0];
 error(()=>engine.completeTask(w.id,p.id,t.id,{},user('W')),'WORKFLOW_CHECKLIST_INCOMPLETE');
 engine.checklist(w.id,p.id,check.id,{checked:true},user('W'));const done=engine.completeTask(w.id,p.id,t.id,{},user('W'));
 assert.equal(done.stages[0].progress.completed,1);assert.equal(done.stages[0].progress.total,1);assert.deepEqual(done.stages[0].tasks[0].assignee_ids,['W','W2']);
 assert.equal(engine.closePhase(w.id,p.id,{},user('M')).status,'ACTIVE');assert.equal(engine.closeWorkflow(w.id,{},user('M')).status,'COMPLETED');
});
test('16 reopen remains admin-only without a mandatory reason',()=>{
 const w=create(),p=w.stages[0],t=task(w);engine.completeTask(w.id,p.id,t.id,{},user('W'));engine.closePhase(w.id,p.id,{},user('M'));
 error(()=>engine.reopenTask(w.id,p.id,t.id,{},user('M')),'WORKFLOW_FORBIDDEN');assert.equal(engine.reopenTask(w.id,p.id,t.id,{},user('A')).stages[0].tasks[0].status,'OPEN');
 const d=engine.reopenTask(w.id,p.id,t.id,{reason:'Quality control recheck'},user('A'));assert.equal(d.stages[0].status,'IN_PROGRESS');assert.equal(d.stages[0].tasks[0].status,'OPEN');
});
test('17 costs remain internal until whole workflow finalization',()=>{
 const w=create(),c=cost(w);assert.equal(c.approval_status,'APPROVED');assert.equal(c.finance_line_id,null);assert.equal(wip(w),0);
 assert.equal(one('SELECT count(*) n FROM workflow_finance_lines WHERE workflow_id=?',w.id).n,0);assert.equal(one('SELECT status FROM wf2_phases WHERE id=?',w.stages[0].id).status,'WAITING');
});

test('18 phase-owner cost requires main approval; subresponsible cannot post costs',()=>{
 const w=create(),p=w.stages[0];engine.updatePhase(w.id,p.id,{responsible_user_id:'W',transfer_reason:'Delegate phase responsibility'},user('M'));
 const c=cost(w,{},'W');assert.equal(c.approval_status,'PENDING');assert.equal(wip(w),0);
 error(()=>engine.closePhase(w.id,p.id,{},user('W')),'WORKFLOW_COST_APPROVAL_REQUIRED');error(()=>engine.approveCost(w.id,p.id,c.id,{},user('W')),'WORKFLOW_FORBIDDEN');
 engine.approveCost(w.id,p.id,c.id,{},user('M'));engine.closePhase(w.id,p.id,{},user('W'));assert.equal(wip(w),0);
});
test('19 injected terminal ledger failure rolls back invoice, sources, audit and calendar',()=>{
 const w=create();cost(w);engine.closePhase(w.id,w.stages[0].id,{},user('M'));const before=state();db.exec("CREATE TEMP TRIGGER ui12_fail_post BEFORE INSERT ON journal_lines BEGIN SELECT RAISE(ABORT,'TEST_LEDGER_FAILURE'); END");
 try{assert.throws(()=>engine.closeWorkflow(w.id,{},user('M')),/TEST_LEDGER_FAILURE/);}finally{db.exec('DROP TRIGGER ui12_fail_post');}assert.equal(state(),before);
});

test('20 abandonment needs confirmation; posts balanced loss once, retaining all history',()=>{
 const w=create();cost(w);const before=state();error(()=>engine.abandonWorkflow(w.id,{},user('M')),'WORKFLOW_DELETE_CONFIRMATION_REQUIRED');assert.equal(state(),before);
 let d=engine.abandonWorkflow(w.id,{confirmed:true,reason:'Customer cancelled restoration'},user('M'));assert.equal(d.status,'ABORTED');assert.equal(wip(w),0);assert.equal(loss(w),123.45);
 const n=one('SELECT count(*) n FROM journal_entries').n;engine.abandonWorkflow(w.id,{confirmed:true},user('M'));assert.equal(one('SELECT count(*) n FROM journal_entries').n,n);
 assert.ok(one('SELECT * FROM wf2_workflows WHERE id=?',w.id));assert.ok(d.calendar.every(j=>j.status==='Cancelled'));
});
test('21 deleting workflow is loss-posting soft delete; unrelated job survives',()=>{
 const w=create();cost(w,{amount:64.75});const protectedRow=JSON.stringify(one("SELECT * FROM jobs WHERE id='NORMAL'"));
 const d=engine.abandonWorkflow(w.id,{confirmed:true,reason:'Delete cancelled workflow'},user('M'),true);assert.equal(d.status,'DELETED');assert.equal(loss(w),64.75);assert.equal(wip(w),0);
 assert.equal(JSON.stringify(one("SELECT * FROM jobs WHERE id='NORMAL'")),protectedRow);assert.ok(one('SELECT * FROM workflow_finance_sources WHERE id=?',w.id));
 assert.equal(engine.list(user('M')).some(x=>x.id===w.id),false);
});
test('22 removing a phase retains its actual costs internally until final settlement',()=>{
 const w=create(),p=w.stages[0];cost(w);task(w);const d=engine.deletePhase(w.id,p.id,{confirmed:true},user('M'));
 assert.equal(d.stages[0].status,'NOT_REQUIRED');assert.equal(loss(w),0);assert.equal(d.financial_summary.actual_cost_cents,12345);
 engine.closeWorkflow(w.id,{},user('M'));assert.equal(total('5000',w),123.45);assert.deepEqual(db.pragma('foreign_key_check'),[]);
});

test('23 unposted actual cost can be edited or voided, without recording fictitious loss',()=>{
 const w=create(),p=w.stages[0],c=cost(w);engine.saveCost(w.id,p.id,c.id,{amount:99},user('M'));
 engine.saveCost(w.id,p.id,c.id,{confirmed:true},user('M'),true);assert.equal(wip(w),0);assert.equal(loss(w),0);
 engine.closePhase(w.id,p.id,{},user('M'));const d=engine.closeWorkflow(w.id,{},user('M'));assert.equal(d.invoice_id,null);
});

test('24 workflow final settlement posts once; payment error rolls back invoice and journal',()=>{
 const w=create({expected_revenue:200}),p=w.stages[0];cost(w,{amount:123.45});engine.closePhase(w.id,p.id,{},user('M'));const before=state();
 error(()=>engine.closeWorkflow(w.id,{},user('M')),'PAYMENT_METHOD_REQUIRED');assert.equal(state(),before);
 const d=engine.closeWorkflow(w.id,{payment_method:'Bank Transfer / ACH'},user('M'));assert.equal(d.status,'COMPLETED');assert.ok(d.invoice_id);assert.equal(wip(w),0);assert.equal(total('5000',w),123.45);
 const n=one('SELECT count(*) n FROM journal_entries').n;engine.closeWorkflow(w.id,{},user('M'));assert.equal(one('SELECT count(*) n FROM journal_entries').n,n);
 assert.equal(one("SELECT count(*) n FROM invoices WHERE source_type='workflow' AND source_id=?",w.id).n,1);
});
test('25 operational reopen cannot duplicate invoice, release or allow writeoff of released costs',()=>{
 const w=create({expected_revenue:150}),p=w.stages[0];cost(w,{amount:123.45});engine.closePhase(w.id,p.id,{},user('M'));const closed=engine.closeWorkflow(w.id,{payment_method:'Cash'},user('M'));
 engine.reopenWorkflow(w.id,{reason:'Operational inspection retry'},user('A'));engine.reopenPhase(w.id,p.id,{reason:'Operational inspection retry'},user('A'));
 error(()=>cost(w),'WORKFLOW_PHASE_FINANCE_CLOSED');error(()=>engine.abandonWorkflow(w.id,{confirmed:true},user('M')),'WORKFLOW_RELEASED_COST_REQUIRES_ADJUSTMENT');
 engine.closePhase(w.id,p.id,{},user('M'));const n=one('SELECT count(*) n FROM journal_entries').n;const again=engine.closeWorkflow(w.id,{},user('M'));assert.equal(again.invoice_id,closed.invoice_id);assert.equal(one('SELECT count(*) n FROM journal_entries').n,n);
});
test('26 owner/client identity and actual piano model are returned without duplicate labels',()=>{
 const a=create(),b=create({client_id:'C2'});assert.equal(a.brand,'Steinway & Sons');assert.equal(a.model,'Model B-211');assert.equal(a.owner_is_client,true);assert.equal(b.owner_is_client,false);assert.equal(b.owner_name,'Owner Client');assert.equal(b.client_name,'Other Client');
});
test('27 main transfer changes calendar ownership but never creator identity',()=>{
 const w=create();const d=engine.update(w.id,{main_responsible_user_id:'W',transfer_reason:'Transfer overall responsibility'},user('M'));assert.equal(d.creator_user_id,'C0');assert.equal(d.main_responsible_user_id,'W');
 for(const j of d.calendar.filter(j=>['START','FINAL'].includes(j.entity_type)))assert.equal(one('SELECT assigned_user_id FROM jobs WHERE id=?',j.job_id).assigned_user_id,'W');
 error(()=>engine.update(w.id,{title:'Former owner'},user('M')),'WORKFLOW_FORBIDDEN');
});
test('28 calendar completion delegates task and final closure to the same domain',()=>{
 const w=create(),p=w.stages[0],t=task(w),d=engine.detail(w.id,user('M')),taskJob=d.calendar.find(j=>j.entity_id===t.id).job_id,finalJob=d.calendar.find(j=>j.entity_type==='FINAL').job_id;
 engine.completeJob(taskJob,{},user('W2'));assert.equal(one('SELECT status FROM workshop_subtasks WHERE id=?',t.id).status,'COMPLETED');
 error(()=>engine.completeJob(finalJob,{},user('W2')),'WORKFLOW_FORBIDDEN');engine.closePhase(w.id,p.id,{},user('M'));assert.equal(engine.completeJob(finalJob,{},user('M')).status,'COMPLETED');
});
test('29 active migration is idempotent and never rewrites legacy quarter-hour appointments',()=>{
 const w=create();db.prepare('UPDATE wf2_workflows SET start_at=? WHERE id=?').run(day(1)+'T09:15',w.id);
 const migrate=require('../server/workflow-contract-migration').migrateWorkflowContract;migrate(db);migrate(db);
 assert.equal(one('SELECT start_at FROM wf2_workflows WHERE id=?',w.id).start_at,day(1)+'T09:15');assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('30 complete integration database has balanced entries and no orphan keys',()=>{
 const bad=all('SELECT entry_id,ROUND(SUM(debit-credit),2) delta FROM journal_lines GROUP BY entry_id HAVING ABS(SUM(debit-credit))>0.0001');assert.deepEqual(bad,[]);assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(one("SELECT title FROM jobs WHERE id='NORMAL'").title,'Protected normal job');
});

test('31 deleted task appointments are retired and cannot fall through to ordinary job authorization',()=>{
 const w=create(),t=task(w),before=engine.detail(w.id,user('M')),j=before.calendar.find(j=>j.entity_id===t.id);
 engine.deleteTask(w.id,w.stages[0].id,t.id,{confirmed:true},user('M'));
 assert.equal(engine.link(j.job_id),undefined);assert.ok(engine.retiredJob(j.job_id));assert.equal(engine.jobRights(j.job_id,user('SA')),false);
 assert.equal(one('SELECT status FROM jobs WHERE id=?',j.job_id).status,'Cancelled');assert.equal(engine.calendarRow(one('SELECT * FROM jobs WHERE id=?',j.job_id),user('M')).wf2_can_edit,false);
 error(()=>engine.rescheduleJob(j.job_id,{start_time:day(10)+'T12:00'},user('M')),'WORKFLOW_CALENDAR_LINK_NOT_FOUND');
});
test('32 half-hour event duration crosses the New York spring gap without nonexistent local end time',()=>{
 const w=create({start_at:'2027-03-14T01:30',final_due_at:'2027-03-15T17:00',phases:[]});const start=w.calendar.find(j=>j.entity_type==='START');assert.equal(start.end_time,'2027-03-14T03:00');
});
