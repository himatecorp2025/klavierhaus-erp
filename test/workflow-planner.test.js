'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
let f;before(()=>f=require('./helpers/workflow-planner-fixture').fixture());after(()=>f?.close());
const error=(fn,code)=>assert.throws(fn,e=>e.message===code);
test('planner 01 creator can atomically plan tasks assigned to other people',()=>{
 const w=f.create(),p=w.stages[0],t=p.tasks[0];assert.equal(w.creator_user_id,'C');assert.equal(w.main_responsible_user_id,'M');assert.equal(p.responsible_user_id,'F');assert.deepEqual(t.assignee_ids,['T','T2']);assert.equal(w.calendar.length,4);assert.equal(w.permissions.close_workflow,false);assert.equal(p.progress.total,1);
});
test('planner 02 inactive phases create neither tasks nor calendar events',()=>{
 const w=f.create({phases:[{stage_code:'INBOUND',enabled:false,tasks:[{title:'Must not exist',assignee_ids:['NOT-A-USER']}]},{stage_code:'ASSESSMENT',enabled:true,tasks:[]}]});assert.equal(w.stages.length,1);assert.equal(w.stages[0].stage_code,'ASSESSMENT');assert.equal(w.calendar.length,3);
});
test('planner 03 exact task and phase deadline equality is allowed',()=>{
 const w=f.create({phases:[{stage_code:'MECHANICS',due_at:'2027-10-10T17:00',tasks:[f.task({due_at:'2027-10-10T17:00'})]}]});assert.equal(w.stages[0].tasks[0].due_at,w.final_due_at);
});
test('planner 04 invalid final task rolls back workflow phases assignments audit and calendar',()=>{
 const before=f.snapshot();error(()=>f.create({phases:[{stage_code:'INBOUND',tasks:[f.task()]},{stage_code:'MECHANICS',due_at:'2027-10-06T17:00',tasks:[f.task(),f.task({due_at:'2027-10-06T17:30'})]}]}),'WORKFLOW_TASK_OUTSIDE_DATES');assert.equal(f.snapshot(),before);
});
test('planner 05 invalid assignee leaves no partial workflow',()=>{
 const before=f.snapshot();error(()=>f.create({phases:[{stage_code:'INBOUND',tasks:[f.task({assignee_ids:['T','MISSING']})]}]}),'WORKFLOW_ACTIVE_USER_REQUIRED');assert.equal(f.snapshot(),before);
});
test('planner 06 optional catalog is separated by phase and never auto-inserted',()=>{
 const options=f.engine.options();assert.equal(Object.keys(options.task_catalog).length,7);assert.ok(options.task_catalog.MECHANICS.length);const w=f.create({phases:[{stage_code:'MECHANICS'}]});assert.equal(w.stages[0].tasks.length,0);
});
test('planner 07 wrong-phase and repeated template IDs are rejected transactionally',()=>{
 for(const tasks of [[f.task({template_id:'INBOUND-1'})],[f.task({template_id:'MECHANICS-1'}),f.task({template_id:'MECHANICS-1'})]]){const before=f.snapshot();error(()=>f.create({phases:[{stage_code:'MECHANICS',tasks}]}),'WORKFLOW_TASK_SELECTION_INVALID');assert.equal(f.snapshot(),before);}
});
test('planner 08 custom task description and multiple assignees persist in the real task table',()=>{
 const w=f.create({phases:[{stage_code:'INBOUND',tasks:[f.task({description:'Custom work instructions',assignee_ids:['T','T2','T']})]}]});const t=w.stages[0].tasks[0];assert.equal(t.description,'Custom work instructions');assert.deepEqual(t.assignee_ids,['T','T2']);assert.equal(f.db.prepare('SELECT title FROM workshop_subtasks WHERE id=?').get(t.id).title,'Key repair');
});
test('planner 09 task without explicit assignees defaults to the phase responsible',()=>{
 const w=f.create({phases:[{stage_code:'INBOUND',responsible_user_id:'F',tasks:[{title:'Custom'}]}]});assert.deepEqual(w.stages[0].tasks[0].assignee_ids,['F']);assert.equal(w.stages[0].tasks[0].due_at,w.final_due_at);
});
test('planner 10 repeated create request does not duplicate tasks or appointments',()=>{
 const a=f.create({request_key:'planner-idempotency'}),snapshot=f.snapshot(),b=f.create({request_key:'planner-idempotency'});assert.equal(a.id,b.id);assert.equal(f.snapshot(),snapshot);
});
test('planner 11 one person can be creator main phase and task owner through closeout',()=>{
 let w=f.create({main_responsible_user_id:'M',phases:[{stage_code:'MECHANICS',tasks:[{title:'Solo'}]}]},'M');const p=w.stages[0],t=p.tasks[0];assert.equal(p.responsible_user_id,'M');assert.deepEqual(t.assignee_ids,['M']);f.engine.completeTask(w.id,p.id,t.id,{},f.user('M'));f.engine.closePhase(w.id,p.id,{},f.user('M'));assert.equal(f.engine.closeWorkflow(w.id,{},f.user('M')).status,'COMPLETED');
});
test('planner 12 main can close phase without its responsible signing off',()=>{
 const w=f.create(),p=w.stages[0];f.engine.completeTask(w.id,p.id,p.tasks[0].id,{},f.user('T'));const done=f.engine.closePhase(w.id,p.id,{},f.user('M'));assert.equal(done.stages[0].completed_by,'M');error(()=>f.engine.closeWorkflow(w.id,{},f.user('F')),'WORKFLOW_FORBIDDEN');
});
test('planner 13 main may not change final deadline through workflow update',()=>{
 const w=f.create(),before=f.snapshot();error(()=>f.engine.update(w.id,{final_due_at:'2027-10-11T17:00'},f.user('M')),'WORKFLOW_FORBIDDEN');assert.equal(f.snapshot(),before);
});
test('planner 14 final calendar job still completes for main but cannot be rescheduled',()=>{
 const w=f.create(),job=w.calendar.find(j=>j.entity_type==='FINAL');assert.equal(f.engine.jobRights(job.job_id,f.user('M')),true);assert.equal(f.engine.canReschedule(job.job_id,f.user('M')),false);error(()=>f.engine.rescheduleJob(job.job_id,{target_date:'2027-10-11T17:00'},f.user('M')),'WORKFLOW_FORBIDDEN');const row=f.engine.calendarRow(f.db.prepare('SELECT * FROM jobs WHERE id=?').get(job.job_id),f.user('M'));assert.equal(row.wf2_can_reschedule,false);assert.equal(row.wf2_can_edit,true);
});
test('planner 15 admin and superadmin final deadline changes need no manual reason',()=>{
 const w=f.create();assert.equal(f.engine.update(w.id,{final_due_at:'2027-10-11T17:00'},f.user('A')).final_due_at,'2027-10-11T17:00');assert.equal(f.engine.update(w.id,{final_due_at:'2027-10-11T17:00',reason:'Customer approved new deadline'},f.user('A')).final_due_at,'2027-10-11T17:00');assert.equal(f.engine.update(w.id,{final_due_at:'2027-10-12T17:00'},f.user('S')).final_due_at,'2027-10-12T17:00');
});
test('planner 16 subresponsible edits own deadline only within phase bounds',()=>{
 const w=f.create(),p=w.stages[0],t=p.tasks[0];assert.equal(f.engine.saveTask(w.id,p.id,t.id,{due_at:p.due_at},f.user('T')).stages[0].tasks[0].due_at,p.due_at);error(()=>f.engine.saveTask(w.id,p.id,t.id,{due_at:'2027-10-06T17:30'},f.user('T')),'WORKFLOW_TASK_OUTSIDE_DATES');error(()=>f.engine.saveTask(w.id,p.id,t.id,{due_at:'2027-10-06T16:00'},f.user('X')),'WORKFLOW_FORBIDDEN');
});
test('planner 17 phase responsible can edit own phase and tasks, not other phases',()=>{
 const w=f.create({phases:[{stage_code:'MECHANICS',responsible_user_id:'F',tasks:[f.task()]},{stage_code:'INBOUND',responsible_user_id:'M'}]}),p=w.stages.find(p=>p.stage_code==='MECHANICS'),other=w.stages.find(p=>p.stage_code==='INBOUND');f.engine.updatePhase(w.id,p.id,{due_at:'2027-10-07T17:00'},f.user('F'));error(()=>f.engine.updatePhase(w.id,other.id,{due_at:'2027-10-07T17:00'},f.user('F')),'WORKFLOW_FORBIDDEN');
});
test('planner 18 moving parent earlier is blocked, with exact conflicting task',()=>{
 const w=f.create(),p=w.stages[0],before=f.snapshot();assert.throws(()=>f.engine.updatePhase(w.id,p.id,{due_at:'2027-10-04T17:00'},f.user('F')),e=>e.code==='WORKFLOW_TASK_OUTSIDE_DATES'&&e.details.task_id===p.tasks[0].id&&e.details.title==='Key repair');assert.equal(f.snapshot(),before);
});
test('planner 19 coordinated schedule saves shorter parent and task atomically',()=>{
 const w=f.create(),p=w.stages[0],t=p.tasks[0];const next=f.engine.updateSchedule(w.id,{version:w.version,phases:[{id:p.id,due_at:'2027-10-04T17:00'}],tasks:[{id:t.id,due_at:'2027-10-04T16:30'}]},f.user('F'));assert.equal(next.stages[0].due_at,'2027-10-04T17:00');assert.equal(next.stages[0].tasks[0].due_at,'2027-10-04T16:30');assert.equal(next.calendar.find(j=>j.entity_id===t.id).start_time,'2027-10-04T16:30');
});
test('planner 20 coordinated schedule rejects stale version and cross-workflow IDs',()=>{
 const w=f.create(),other=f.create(),before=f.snapshot();error(()=>f.engine.updateSchedule(w.id,{version:w.version-1,phases:[]},f.user('M')),'WORKFLOW_VERSION_CONFLICT');error(()=>f.engine.updateSchedule(w.id,{version:w.version,tasks:[{id:other.stages[0].tasks[0].id,due_at:'2027-10-03T09:00'}]},f.user('M')),'WORKFLOW_PHASE_NOT_FOUND');assert.equal(f.snapshot(),before);
});
test('planner 21 coordinated schedule denies final change for nonadmin',()=>{
 const w=f.create(),before=f.snapshot();error(()=>f.engine.updateSchedule(w.id,{version:w.version,final_due_at:'2027-10-11T17:00'},f.user('M')),'WORKFLOW_FORBIDDEN');assert.equal(f.snapshot(),before);
});
test('planner 22 creation snapshots physical location rather than billing address',()=>{
 const w=f.create({mode:'ON_SITE',service_address:'Confirmed service site'});assert.equal(w.piano_location_name,'Studio');assert.equal(w.piano_location_address,'Studio address');assert.equal(w.service_address,'Confirmed service site');f.db.prepare("UPDATE contacts SET address='New billing address' WHERE id='CL'").run();assert.equal(f.engine.detail(w.id,f.user('M')).piano_location_address,'Studio address');
});
test('planner 23 owner brand and model are mandatory but serial is optional',()=>{
 for(const body of [{brand:'Test',model:'A'},{owner_contact_id:'CL',brand:'',model:'A'},{owner_contact_id:'CL',brand:'Test',model:''}])error(()=>f.piano.create(body),body.owner_contact_id?'PIANO_CORE_FIELDS_REQUIRED':'PIANO_OWNER_REQUIRED');const p=f.piano.create({owner_contact_id:'CL',brand:'Test',model:'A'});assert.equal(p.serial_no,'');assert.equal(p.build_year,null);
});
test('planner 24 identical brand/model without serial creates separate instruments',()=>{
 const body={owner_contact_id:'CL',brand:'Test',model:'Same'};const a=f.piano.create(body),b=f.piano.create(body);assert.notEqual(a.id,b.id);assert.equal(a.brand,b.brand);assert.equal(a.model,b.model);
});
test('planner 25 duplicate nonempty serial is rejected case-insensitively',()=>{
 f.piano.create({owner_contact_id:'CL',brand:'Test',model:'Serial',serial_no:'ABC123'});const before=f.snapshot();error(()=>f.piano.create({owner_contact_id:'CL',brand:'Test',model:'Serial',serial_no:' abc123 '}),'PIANO_SERIAL_ALREADY_EXISTS');assert.equal(f.snapshot(),before);
});
test('planner 26 physical address is never silently copied from the client',()=>{
 const a=f.piano.create({owner_contact_id:'CL',brand:'Test',model:'No address'});assert.equal(a.location,'');assert.equal(a.piano_location_address,'');const b=f.piano.create({owner_contact_id:'CL',brand:'Test',model:'Explicit address',same_as_client_address:true});assert.equal(b.location,f.db.prepare("SELECT address FROM contacts WHERE id='CL'").get().address);
});
test('planner 27 owner piano relationship and has_piano update commit together',()=>{
 const p=f.piano.create({owner_contact_id:'EMPTY',brand:'Test',model:'Location',location_name:'Hall',piano_location_address:'Hall address'});assert.equal(p.location_name,'Hall');assert.equal(p.piano_location_address,'Hall address');assert.equal(f.db.prepare("SELECT has_piano FROM contacts WHERE id='EMPTY'").get().has_piano,1);assert.ok(f.db.prepare('SELECT id FROM client_pianos WHERE piano_id=? AND client_id=?').get(p.id,'EMPTY'));
});
test('planner 28 existing piano association cannot transfer another client ownership',()=>{
 const before=f.snapshot();error(()=>f.piano.linkOwned('CL','OTHER'),'PIANO_OWNER_MISMATCH');assert.equal(f.snapshot(),before);assert.equal(f.piano.read('OTHER').owner_contact_id,'CL2');
});
test('planner 29 missing owner relationship is repaired idempotently, preserving other pianos',()=>{
 f.db.prepare("DELETE FROM client_pianos WHERE piano_id='P2'").run();f.piano.linkOwned('CL','P2');f.piano.linkOwned('CL','P2');assert.equal(f.db.prepare("SELECT count(*) n FROM client_pianos WHERE piano_id='P2' AND client_id='CL'").get().n,1);assert.equal(f.piano.read('P1').location_name,'Studio');
});
test('planner 30 an injected relationship failure rolls back piano AND catalog writes',()=>{
 f.db.exec("CREATE TRIGGER fail_test_relation BEFORE INSERT ON client_pianos WHEN NEW.location_name='FAIL_TEST' BEGIN SELECT RAISE(ABORT,'TEST_RELATION_FAILURE'); END;");const before=f.snapshot();assert.throws(()=>f.piano.create({owner_contact_id:'CL',brand:'New rollback brand',model:'Rollback model',location_name:'FAIL_TEST'}),/TEST_RELATION_FAILURE/);assert.equal(f.snapshot(),before);f.db.exec('DROP TRIGGER fail_test_relation');
});
test('planner 31 workflow option records contain searchable identities and separate locations',()=>{
 const o=f.engine.options();assert.ok(o.clients.find(c=>c.id==='CL').email);assert.equal(o.pianos.find(p=>p.id==='P1').location_name,'Studio');assert.equal(o.pianos.find(p=>p.id==='P2').piano_location_address,'Home address');assert.equal(o.ui_contract,'UI12');
});
test('planner 32 WAL foreign keys and zero orphan records are preserved',()=>{
 assert.equal(f.db.pragma('foreign_keys',{simple:true}),1);assert.equal(f.db.pragma('journal_mode',{simple:true}),'wal');assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
});

test('planner 33 unrelated user cannot touch a schedule with no changes',()=>{
 const w=f.create(),before=f.snapshot();assert.throws(()=>f.engine.updateSchedule(w.id,{version:w.version},f.user('X')),/WORKFLOW_FORBIDDEN/);assert.equal(f.snapshot(),before);
});
test('planner 34 unchanged foreign phase cannot bypass authorization',()=>{
 const w=f.create(),before=f.snapshot();assert.throws(()=>f.engine.updateSchedule(w.id,{version:w.version,phases:[{id:w.stages[0].id,due_at:w.stages[0].due_at}]},f.user('T')),/WORKFLOW_FORBIDDEN/);assert.equal(f.snapshot(),before);
});
