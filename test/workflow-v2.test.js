"use strict";
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),{once}=require('node:events');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'kh-wf2-'));
const secret='workflow-phase-two-isolated-test-secret-123456789';let db,server,base;const tokens={};
const nowDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=offset=>new Date(Date.parse(nowDay+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
async function req(url,{actor='A',method='GET',body,raw=false}={}){const response=await fetch(base+url,{method,headers:{Authorization:'Bearer '+(tokens[actor]||''),...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const data=raw?await response.text():await response.json();return {status:response.status,data};}
const url='/api/workshop/v2';
before(async()=>{
 Object.assign(process.env,{DB_PATH:path.join(temp,'db.sqlite'),BACKUP_DIR:path.join(temp,'backups'),UPLOAD_DIR:path.join(temp,'uploads'),JWT_SECRET:secret,PORT:'0'});
 const init=spawnSync(process.execPath,['server/init-db.js'],{cwd:root,env:process.env,encoding:'utf8'});assert.equal(init.status,0,init.stderr||init.stdout);
 const setup=new Database(process.env.DB_PATH);for(const [key,role,flag] of [['SA','ADMIN',1],['A','ADMIN',0],['M','MANAGER',0],['W','WORKER',0],['W2','WORKER',0]]){setup.prepare("INSERT INTO users(id,name,email,password_hash,role,status,is_superadmin) VALUES(?,?,?,'not-a-password',?,'Active',?)").run(key,key,key+'@example.invalid',role,flag);tokens[key]=jwt.sign({id:key,role,session_version:0},secret,{expiresIn:'2h'});}
 setup.exec("INSERT INTO contacts(id,name) VALUES('C','Client');INSERT INTO pianos(id,brand,model,owner_contact_id) VALUES('P','Steinway','B','C');INSERT INTO jobs(id,title,assigned_user_id,assigned_to,start_time,end_time) VALUES('NORMAL','Protected job','A','A','2026-10-10T09:00','2026-10-10T10:00')");setup.close();
 const app=require('../server/index');db=app.db;server=app.startServer(0);await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db?.open)db.close();});
async function create(actor='W',extra={}){const response=await req(url+'/workflows',{actor,method:'POST',body:{title:'New workflow',client_id:'C',piano_id:'P',mode:'INBOUND',main_responsible_user_id:'M',start_at:day(0)+'T08:00',final_due_at:day(7)+'T17:00',...extra}});assert.equal(response.status,200,JSON.stringify(response.data));return response.data;}
const phasePath=(w,p)=>`${url}/workflows/${w.id}/phases/${p.id}`;
test('01: Phase I retirement is present; new schema, seven phases, protected records and old routes',async()=>{
 for(const table of ['workshop_workflows','workflow_stages','workshop_subtasks','workflow_documents','workflow_materials'])assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),undefined);
 const result=await req(url+'/options',{actor:'W'});assert.equal(result.status,200);assert.equal(result.data.stages.length,7);assert.ok(result.data.users.some(u=>u.id==='W'));
 assert.equal((await req('/api/workflows/old')).status,410);assert.equal((await req(url+'/options',{actor:'NONE'})).status,401);assert.equal(db.pragma('journal_mode',{simple:true}),'wal');assert.equal(db.pragma('foreign_keys',{simple:true}),1);
});
test('02: worker creates for another main owner; creator has no implicit management rights',async()=>{
 const w=await create();assert.equal(w.creator_user_id,'W');assert.equal(w.main_responsible_user_id,'M');assert.equal(w.stages.length,7);assert.equal(w.calendar.length,2);assert.equal(w.permissions.edit_workflow,false);assert.ok(w.stages.every(p=>p.responsible_user_id==='M'));
 assert.equal((await req(url+'/workflows/'+w.id,{actor:'W',method:'PUT',body:{title:'Forbidden'}})).status,403);assert.equal((await req(url+'/workflows/'+w.id+'/close',{actor:'W',method:'POST',body:{}})).status,403);
 const own=await create('W',{main_responsible_user_id:'W'});assert.equal(own.permissions.close_workflow,true);
});
test('03: main owner changes phase responsibility; exactly one responsible is enforced',async()=>{
 const w=await create(),p=w.stages[0];let r=await req(phasePath(w,p),{actor:'M',method:'PUT',body:{responsible_user_id:'W'}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.stages[0].responsible_user_id,'W');
 r=await req(phasePath(w,p),{actor:'W',method:'PUT',body:{responsible_user_id:'W2'}});assert.equal(r.status,403);
 r=await req(phasePath(w,p),{actor:'M',method:'PUT',body:{responsible_user_id:''}});assert.equal(r.status,400);
 assert.equal((await req(phasePath(w,w.stages[1]),{actor:'W',method:'PUT',body:{title:'Other phase'}})).status,403);
});
test('04: task multi-assignment, default owner and restricted subresponsible editing',async()=>{
 const w=await create(),p=w.stages[0];let r=await req(phasePath(w,p)+'/tasks',{actor:'M',method:'POST',body:{title:'Strings',due_at:day(1)+'T10:00',assignee_ids:['W','W2','W']}});assert.equal(r.status,200);let t=r.data.stages[0].tasks[0];assert.deepEqual(t.assignee_ids,['W','W2']);
 assert.equal((await req(phasePath(w,p)+'/tasks/'+t.id,{actor:'W',method:'PUT',body:{title:'Strings updated',due_at:day(2)+'T10:00'}})).status,200);
 assert.equal((await req(phasePath(w,p)+'/tasks/'+t.id,{actor:'W',method:'PUT',body:{assignee_ids:['W']}})).status,403);
 r=await req(phasePath(w,p)+'/tasks',{actor:'M',method:'POST',body:{title:'Default'}});assert.equal(r.status,200);assert.deepEqual(r.data.stages[0].tasks[1].assignee_ids,['M']);
 assert.equal((await req(phasePath(w,p)+'/tasks',{actor:'W',method:'POST',body:{title:'No creation'}})).status,403);
});
test('05: invalid wall dates, DST gap, deadline hierarchy and transaction rollback',async()=>{
 const w=await create(),p=w.stages[0];const before=db.prepare('SELECT COUNT(*) n FROM wf2_calendar_links WHERE workflow_id=?').get(w.id).n;
 let r=await req(phasePath(w,p),{actor:'M',method:'PUT',body:{due_at:day(9)+'T09:00'}});assert.equal(r.status,409);assert.equal(db.prepare('SELECT due_at FROM wf2_phases WHERE id=?').get(p.id).due_at,null);assert.equal(db.prepare('SELECT COUNT(*) n FROM wf2_calendar_links WHERE workflow_id=?').get(w.id).n,before);
 for(const value of ['2027-02-30T10:00','2027-03-14T02:30',day(1)+'T10:07'])assert.equal((await req(phasePath(w,p),{actor:'M',method:'PUT',body:{due_at:value}})).status,400);
 assert.equal((await req(phasePath(w,p),{actor:'M',method:'PUT',body:{due_at:day(2)+'T10:00'}})).status,200);
 assert.equal((await req(phasePath(w,p)+'/tasks',{actor:'M',method:'POST',body:{title:'Too late',due_at:day(3)+'T10:00'}})).status,409);
});
test('06: optimistic concurrency rejects stale saves without lost updates',async()=>{
 const w=await create();assert.equal((await req(url+'/workflows/'+w.id,{actor:'M',method:'PUT',body:{version:w.version,title:'First'}})).status,200);
 const r=await req(url+'/workflows/'+w.id,{actor:'M',method:'PUT',body:{version:w.version,title:'Stale'}});assert.equal(r.status,409);assert.equal(db.prepare('SELECT title FROM wf2_workflows WHERE id=?').get(w.id).title,'First');
});
test('07: calendar → phase and notification → task synchronization use ownership, no duplicates',async()=>{
 const w=await create(),p=w.stages[0];let r=await req(phasePath(w,p),{actor:'M',method:'PUT',body:{responsible_user_id:'W',due_at:day(3)+'T10:00'}});assert.equal(r.status,200);const job=r.data.calendar.find(l=>l.entity_id===p.id).job_id;
 assert.equal((await req('/api/jobs/'+job+'/schedule',{actor:'W2',method:'PATCH',body:{start_time:day(4)+'T10:00'}})).status,403);
 r=await req('/api/jobs/'+job+'/schedule',{actor:'W',method:'PATCH',body:{start_time:day(4)+'T10:00',end_time:day(4)+'T10:15'}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(db.prepare('SELECT due_at FROM wf2_phases WHERE id=?').get(p.id).due_at,day(4)+'T10:00');
 r=await req(phasePath(w,p)+'/tasks',{actor:'W',method:'POST',body:{title:'Tuning',due_at:day(1)+'T09:00',assignee_ids:['W2']}});assert.equal(r.status,200);const t=r.data.stages[0].tasks[0],tj=r.data.calendar.find(l=>l.entity_id===t.id).job_id;
 r=await req('/api/notifications/reschedule',{actor:'W2',method:'POST',body:{entity_type:'CALENDAR_JOB',entity_id:tj,target_date:day(2)+'T09:00',reason:'Task moved'}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(db.prepare('SELECT due_at FROM wf2_tasks WHERE id=?').get(t.id).due_at,day(2)+'T09:00');
 assert.equal(db.prepare('SELECT count(*) n FROM wf2_calendar_links WHERE entity_id=?').get(t.id).n,1);assert.ok(db.prepare("SELECT count(*) n FROM wf2_audit WHERE workflow_id=? AND action='RESCHEDULE'").get(w.id).n>=2);
 const jobRead=await req('/api/jobs/'+tj,{actor:'W2'});assert.equal(jobRead.data.wf2_workflow_id,w.id);
});
test('08: mandatory task/checklist gates and approving another assignee preserve assignment',async()=>{
 const w=await create(),p=w.stages[0];let r=await req(phasePath(w,p)+'/tasks',{actor:'M',method:'POST',body:{title:'Misi work',assignee_ids:['W']}});const t=r.data.stages[0].tasks[0];
 r=await req(phasePath(w,p)+'/checklist',{actor:'M',method:'POST',body:{title:'Inspect',task_id:t.id,required:true}});const c=r.data.stages[0].checklist[0];
 assert.equal((await req(phasePath(w,p)+'/close',{actor:'M',method:'POST',body:{}})).status,409);
 assert.equal((await req(phasePath(w,p)+'/tasks/'+t.id+'/complete',{actor:'W',method:'POST',body:{}})).status,409);
 assert.equal((await req(phasePath(w,p)+'/checklist/'+c.id,{actor:'W',method:'PUT',body:{checked:true}})).status,200);
 assert.equal((await req(phasePath(w,p)+'/tasks/'+t.id+'/complete',{actor:'A',method:'POST',body:{}})).status,400);
 r=await req(phasePath(w,p)+'/tasks/'+t.id+'/complete',{actor:'A',method:'POST',body:{reason:'I verified completion'}});assert.equal(r.status,200);const approved=r.data.stages[0].tasks[0];assert.equal(approved.approved_by,'A');assert.deepEqual(approved.assignee_ids,['W']);assert.ok(r.data.audit.some(a=>a.action==='TASK_APPROVED_FOR_ASSIGNEES'));
 assert.equal((await req(phasePath(w,p)+'/close',{actor:'W',method:'POST',body:{}})).status,403);
});
test('09: manual phase costs post balanced WIP, closeout invoices positive charges once',async()=>{
 const w=await create(),p=w.stages[0];let r=await req(phasePath(w,p)+'/costs',{actor:'M',method:'POST',body:{title:'Labor',category:'LABOR',amount:100,charge_amount:175}});assert.equal(r.status,200,JSON.stringify(r.data));
 r=await req(phasePath(w,p)+'/close',{actor:'M',method:'POST',body:{}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.stages[0].financial_status,'CLOSED');assert.equal(r.data.status,'ACTIVE');
 for(const row of db.prepare('SELECT entry_id,sum(debit) d,sum(credit) c FROM journal_lines GROUP BY entry_id').all())assert.equal(row.d,row.c);
 for(const other of w.stages.slice(1))assert.equal((await req(phasePath(w,other)+'/close',{actor:'M',method:'POST',body:{}})).status,200);
 r=await req(url+'/workflows/'+w.id+'/close',{actor:'M',method:'POST',body:{payment_method:'Cash'}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.status,'COMPLETED');assert.ok(r.data.invoice_id);
 const bill=db.prepare('SELECT * FROM invoices WHERE id=?').get(r.data.invoice_id);assert.equal(bill.subtotal,175);assert.equal(bill.tax_amount,0);assert.equal(db.prepare("SELECT amount FROM financial_items WHERE source_type='WORKFLOW_INVOICE_REVENUE' AND source_id=?").get('WORKFLOW_INVOICE_REVENUE:'+w.id).amount,175);
 const before=db.prepare('SELECT count(*) n FROM invoices').get().n;assert.equal((await req(url+'/workflows/'+w.id+'/close',{actor:'M',method:'POST',body:{payment_method:'Cash'}})).status,200);assert.equal(db.prepare('SELECT count(*) n FROM invoices').get().n,before);
});
test('10: zero-valued workflow closes without invoice number or financial item',async()=>{
 const w=await create('W',{main_responsible_user_id:'W'}),count=db.prepare('SELECT count(*) n FROM invoices').get().n;
 for(const p of w.stages)assert.equal((await req(phasePath(w,p)+'/close',{actor:'W',method:'POST',body:{}})).status,200);
 const r=await req(url+'/workflows/'+w.id+'/close',{actor:'W',method:'POST',body:{}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.invoice_id,null);assert.equal(db.prepare('SELECT count(*) n FROM invoices').get().n,count);
});
test('11: Admin override requires reason and confirmation; Superadmin needs neither',async()=>{
 const w=await create();const blocked=await req(url+'/workflows/'+w.id+'/close',{actor:'M',method:'POST',body:{}});assert.equal(blocked.status,409);assert.equal(blocked.data.error,'WORKFLOW_INCOMPLETE');assert.equal(blocked.data.details.phases[0].responsible,'M');
 assert.equal((await req(url+'/workflows/'+w.id+'/close',{actor:'A',method:'POST',body:{override:true}})).status,400);
 let r=await req(url+'/workflows/'+w.id+'/close',{actor:'A',method:'POST',body:{override:true,reason:'Accepted by administrator'}});assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.audit.some(a=>a.action==='WORKFLOW_OVERRIDE_CLOSE'));
 const s=await create();r=await req(url+'/workflows/'+s.id+'/close',{actor:'SA',method:'POST',body:{}});assert.equal(r.status,200);assert.ok(!r.data.audit.some(a=>a.actor_user_id==='SA'));
});
test('12: document upload/download, checklist deletion and unauthorized writes',async()=>{
 const w=await create(),p=w.stages[0],form=new FormData();form.append('file',new Blob(['%PDF-1.4\nDocument'],{type:'application/pdf'}),'inspection.pdf');
 let r=await req(phasePath(w,p)+'/documents',{actor:'W2',method:'POST',body:form});assert.equal(r.status,403);
 r=await req(phasePath(w,p)+'/documents',{actor:'M',method:'POST',body:form});assert.equal(r.status,200,JSON.stringify(r.data));const d=r.data.stages[0].documents[0];assert.equal(d.original_name,'inspection.pdf');
 const download=await req(url+'/documents/'+d.id,{actor:'W',raw:true});assert.equal(download.status,200);assert.ok(download.data.startsWith('%PDF-'));
 assert.equal((await req(phasePath(w,p)+'/documents/'+d.id,{actor:'W2',method:'DELETE',body:{}})).status,403);
 assert.equal((await req(phasePath(w,p)+'/documents/'+d.id,{actor:'M',method:'DELETE',body:{}})).status,200);
});
test('13: Admin single-card delete, owner restoration and Superadmin purge preserve shared data',async()=>{
 const w=await create(),p=w.stages[0];assert.equal((await req(phasePath(w,p),{actor:'M',method:'DELETE',body:{reason:'Delete card'}})).status,403);
 let r=await req(phasePath(w,p),{actor:'A',method:'DELETE',body:{reason:'Obsolete phase'}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.stages.length,6);
 r=await req(`${url}/workflows/${w.id}/phases/${p.stage_code}/create`,{actor:'M',method:'POST',body:{}});assert.equal(r.status,200);assert.equal(r.data.stages.length,7);
 assert.equal((await req(url+'/purge',{actor:'A',method:'POST',body:{workflow_id:w.id,confirmation:'DELETE WORKFLOW '+w.id}})).status,403);
 r=await req(url+'/purge',{actor:'SA',method:'POST',body:{workflow_id:w.id,confirmation:'DELETE WORKFLOW '+w.id}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(db.prepare('SELECT * FROM wf2_workflows WHERE id=?').get(w.id),undefined);assert.ok(db.prepare("SELECT id FROM jobs WHERE id='NORMAL'").get());assert.ok(db.prepare("SELECT id FROM contacts WHERE id='C'").get());assert.ok(db.prepare("SELECT id FROM pianos WHERE id='P'").get());assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('14: phase settings bilingual names, order, colors, required flag and persisted restart',async()=>{
 const stages=(await req(url+'/phases')).data.stages;stages[0]={...stages[0],name_hu:'Beérkezés új',color:'#123456',required:0,enabled:1,default_status:'IN_PROGRESS'};
 assert.equal((await req(url+'/phases',{actor:'W',method:'PUT',body:{stages}})).status,403);
 assert.equal((await req(url+'/phases',{actor:'A',method:'PUT',body:{stages}})).status,200);
 const init=spawnSync(process.execPath,['server/init-db.js'],{cwd:root,env:process.env,encoding:'utf8'});assert.equal(init.status,0,init.stderr);
 const after=(await req(url+'/phases')).data.stages[0];assert.equal(after.color,'#123456');assert.equal(after.name_hu,'Beérkezés új');assert.equal(after.required,0);
});
test('15: workflow notification snooze is user-specific, close-all and exact expiry',async()=>{
 const w=await create(),job=w.calendar.find(l=>l.entity_type==='FINAL').job_id;
 let r=await req('/api/notifications/active',{actor:'M'});assert.equal(r.status,200);assert.ok(r.data.notifications.some(n=>n.entity_id===job));
 const now=Date.now();r=await req('/api/notifications/snooze-all',{actor:'M',method:'POST',body:{}});assert.equal(r.status,200);assert.ok(Date.parse(r.data.snoozed_until)>=now+10800000);assert.ok(Date.parse(r.data.snoozed_until)<=Date.now()+10800000);
 assert.ok(!(await req('/api/notifications/active',{actor:'M'})).data.notifications.some(n=>n.entity_id===job));assert.ok((await req('/api/notifications/active',{actor:'A'})).data.notifications.some(n=>n.entity_id===job));
});
test('16: notifications complete task/phase without auto-closing workflow',async()=>{
 const w=await create(),p=w.stages[0];let r=await req(phasePath(w,p),{actor:'M',method:'PUT',body:{due_at:day(1)+'T10:00'}});const j=r.data.calendar.find(l=>l.entity_id===p.id).job_id;
 r=await req('/api/notifications/complete',{actor:'M',method:'POST',body:{entity_type:'CALENDAR_JOB',entity_id:j}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(db.prepare('SELECT status FROM wf2_phases WHERE id=?').get(p.id).status,'COMPLETED');assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(j).status,'Completed');assert.equal(db.prepare('SELECT status FROM wf2_workflows WHERE id=?').get(w.id).status,'ACTIVE');
 const start=w.calendar.find(l=>l.entity_type==='START').job_id;assert.equal((await req('/api/notifications/complete',{actor:'M',method:'POST',body:{entity_type:'CALENDAR_JOB',entity_id:start}})).status,200);assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(start).status,'Completed');
});
test('17: real DOM forms, date grid, role-specific controls, API writes and calendar editor reuse (no visual layout)',{skip:!process.env.HAPPY_DOM_MODULE},async()=>{
 const result=await require('./helpers/workflow-v2-ui.cjs').verifyWorkflowUI({base,tokens,day});assert.ok(result.http_calls>10);assert.equal(result.dom,true);
});
test('18: positive financial closeout rollback, rebill uses client price, targeted purge preserves unrelated money',async()=>{
 const w=await create(),p=w.stages[0];
 assert.equal((await req(phasePath(w,p)+'/costs',{actor:'M',method:'POST',body:{title:'Internal 70, client 190',amount:70,charge_amount:190}})).status,200);
 const before=db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
 let r=await req(url+'/workflows/'+w.id+'/close',{actor:'A',method:'POST',body:{override:true,reason:'Validated administrator override'}});
 assert.equal(r.status,400);assert.equal(db.prepare('SELECT status FROM wf2_workflows WHERE id=?').get(w.id).status,'ACTIVE');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,before);assert.equal(db.prepare('SELECT COUNT(*) n FROM workflow_finance_lines WHERE workflow_id=?').get(w.id).n,0);
 r=await req(url+'/workflows/'+w.id+'/close',{actor:'A',method:'POST',body:{override:true,reason:'Validated administrator override',payment_method:'Cash'}});assert.equal(r.status,200,JSON.stringify(r.data));const invoiceId=r.data.invoice_id;
 r=await req('/api/invoices/'+invoiceId+'/void',{actor:'A',method:'POST',body:{reason:'Correct payment method'}});assert.equal(r.status,200,JSON.stringify(r.data));
 r=await req('/api/invoices/rebill-source',{actor:'A',method:'POST',body:{source_type:'workflow',source_id:w.id,payment_method:'Cash'}});assert.equal(r.status,409,'A void invoice remains a billed historical source under the protected invoice rules');
 // A legitimately unbilled completed source must use client charges, not internal costs.
 const unbilled=await create(),up=unbilled.stages[0];
 assert.equal((await req(phasePath(unbilled,up)+'/costs',{actor:'M',method:'POST',body:{title:'Imported unbilled source',amount:70,charge_amount:190}})).status,200);
 assert.equal((await req(phasePath(unbilled,up)+'/close',{actor:'M',method:'POST',body:{}})).status,200);
 db.prepare("UPDATE workflow_finance_sources SET current_status='COMPLETED' WHERE id=?").run(unbilled.id);
 db.prepare("UPDATE wf2_workflows SET status='COMPLETED' WHERE id=?").run(unbilled.id);
 r=await req('/api/invoices/rebill-source',{actor:'A',method:'POST',body:{source_type:'workflow',source_id:unbilled.id,payment_method:'Cash'}});assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.invoices[0].subtotal,190);
 const unrelated=db.prepare("SELECT id,amount,source_id FROM financial_items WHERE source_id<>? ORDER BY id").all('WORKFLOW_INVOICE_REVENUE:'+w.id);
 r=await req(url+'/purge',{actor:'SA',method:'POST',body:{workflow_id:w.id,confirmation:'DELETE WORKFLOW '+w.id}});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices WHERE source_id=?').get(w.id).n,0);assert.deepEqual(db.prepare("SELECT id,amount,source_id FROM financial_items ORDER BY id").all(),unrelated);assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('19: deleting a task/phase cleans its own document files; approval notifies assignees',async()=>{
 const w=await create(),p=w.stages[0];let r=await req(phasePath(w,p)+'/tasks',{actor:'M',method:'POST',body:{title:'Documented work',assignee_ids:['W']}});
 const t=r.data.stages[0].tasks[0],form=new FormData();form.append('task_id',t.id);form.append('file',new Blob(['proof']), 'proof.txt');
 r=await req(phasePath(w,p)+'/documents',{actor:'W',method:'POST',body:form});assert.equal(r.status,200);
 const stored=db.prepare('SELECT stored_name FROM wf2_documents WHERE task_id=?').get(t.id).stored_name,file=path.join(temp,'workflow-documents-v2',stored);assert.ok(fs.existsSync(file));
 r=await req(phasePath(w,p)+'/tasks/'+t.id+'/complete',{actor:'A',method:'POST',body:{reason:'Completion verified by admin'}});assert.equal(r.status,200);
 assert.ok(db.prepare("SELECT 1 FROM notifications WHERE recipient_user_id='W' AND notification_type='WORKFLOW_APPROVAL' AND json_extract(metadata_json,'$.task_id')=?").get(t.id));
 assert.equal((await req(phasePath(w,p)+'/tasks/'+t.id,{actor:'M',method:'DELETE',body:{}})).status,200);assert.equal(fs.existsSync(file),false);
 const phaseFile=new FormData();phaseFile.append('file',new Blob(['phase proof']),'phase.txt');r=await req(phasePath(w,p)+'/documents',{actor:'M',method:'POST',body:phaseFile});assert.equal(r.status,200);
 const saved=db.prepare('SELECT stored_name FROM wf2_documents WHERE phase_id=?').get(p.id).stored_name;
 r=await req(phasePath(w,p),{actor:'A',method:'DELETE',body:{reason:'Remove test phase'}});assert.equal(r.status,200);assert.equal(fs.existsSync(path.join(temp,'workflow-documents-v2',saved)),false);
});
test('20: historical custody is read-only; calendar metadata and reassignment cannot bypass responsibility',async()=>{
 db.prepare("INSERT INTO workflow_finance_sources(id,workflow_key,client_id,piano_id,mode,title,final_due_at,current_status,created_by_user_id) VALUES('HISTORY','HISTORY','C','P','INBOUND','Preserved history',?,'COMPLETED','A')").run(day(0)+'T17:00');
 db.exec("INSERT INTO workflow_finance_phases(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,assigned_user_id,status) VALUES('HISTORY-P','HISTORY','INBOUND',0,'Intake','Beérkezés','A','COMPLETED')");
 let r=await req(url+'/workflows?status=COMPLETED',{actor:'W'});assert.ok(r.data.workflows.some(w=>w.id==='HISTORY'&&w.historical));
 r=await req(url+'/workflows/HISTORY',{actor:'A'});assert.equal(r.status,200);assert.equal(r.data.permissions.edit_workflow,false);assert.equal((await req(url+'/workflows/HISTORY',{actor:'A',method:'PUT',body:{title:'No rewrite'}})).status,404);
 const w=await create(),p=w.stages[0];r=await req(phasePath(w,p),{actor:'M',method:'PUT',body:{due_at:day(3)+'T10:00',responsible_user_id:'W'}});const jid=r.data.calendar.find(c=>c.entity_id===p.id).job_id;
 r=await req('/api/jobs/'+jid,{actor:'W2'});assert.equal(r.data.wf2_can_edit,false);assert.equal(r.data.calendar_entry_type,'WORKFLOW_V2');
 assert.equal((await req('/api/jobs/'+jid,{actor:'W'})).data.wf2_can_edit,true);
 r=await req('/api/jobs/'+jid+'/schedule',{actor:'W',method:'PATCH',body:{start_time:day(4)+'T10:00',assigned_user_id:'W2'}});assert.equal(r.status,409);assert.equal(db.prepare('SELECT responsible_user_id,due_at FROM wf2_phases WHERE id=?').get(p.id).responsible_user_id,'W');assert.equal(db.prepare('SELECT due_at FROM wf2_phases WHERE id=?').get(p.id).due_at,day(3)+'T10:00');
 assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('21: close-all survives identical timestamp/random values without snooze primary-key collisions',async()=>{
 const w=await create('W2',{main_responsible_user_id:'W2'}),p=w.stages[0];
 for(let i=0;i<5;i++)assert.equal((await req(phasePath(w,p)+'/tasks',{actor:'W2',method:'POST',body:{title:'Bulk '+i,due_at:day(2)+'T10:00'}})).status,200);
 const clock=Date.now,random=Math.random,fixed=Date.now();
 try{
  Date.now=()=>fixed;Math.random=()=>0;
  const r=await req('/api/notifications/snooze-all',{actor:'W2',method:'POST',body:{}});
  assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.count>=7);assert.equal(Date.parse(r.data.snoozed_until),fixed+10800000);
 }finally{Date.now=clock;Math.random=random;}
 assert.equal((await req('/api/notifications/active',{actor:'W2'})).data.notifications.length,0);
 const ids=db.prepare("SELECT id FROM notification_snooze_log WHERE user_id='W2'").all().map(r=>r.id);
 assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>/^NSZ-[0-9a-f-]{36}$/.test(id)));
});
