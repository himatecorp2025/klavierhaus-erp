"use strict";
// Executable DOM/event/HTTP tests. Happy DOM does not perform visual layout.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function verifyWorkflowUI({base,tokens,day}){
 const {Window}=await import(process.env.HAPPY_DOM_MODULE||'happy-dom');
 const window=new Window({url:base,settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true}}),document=window.document;
 const calls=[],failures=[];let pending=0,views=0;
 Object.assign(window,{user:{id:'M',name:'M'},token:tokens.M,currentLang:'hu',currentView:'workshop_workflow',htmlText:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),bi:(en,hu)=>hu,nyDateKey:()=>day(0),workflowStatusLabel:s=>s,showError:e=>failures.push(String(e)),renderWorkshopWorkflow:async()=>{views++;},renderScheduler:async()=>{views++;},renderToday:async()=>{views++;},refreshDeadlineNotifications:async()=>{views++;}});
 window.api=async(url,opt={})=>{pending++;calls.push({url,method:opt.method||'GET',body:typeof opt.body==='string'?JSON.parse(opt.body):null});try{const r=await fetch(base+url,{...opt,headers:{Authorization:'Bearer '+window.token,'Content-Type':'application/json',...(opt.headers||{})}}),data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error),{details:data,status:r.status});return data;}finally{pending--;}};
 // Native dialog visual top-layer behavior is outside this DOM emulator's scope.
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 // Happy DOM 20 computes decimal steps using floating-point remainder (50 % .01).
 // Correct only this emulator defect; retain all other native validity checks.
 const originalStep=Object.getOwnPropertyDescriptor(window.ValidityState.prototype,'stepMismatch').get;
 Object.defineProperty(window.ValidityState.prototype,'stepMismatch',{get(){
  const e=this.element;if(e?.type==='number'&&e.step==='0.01'){
   const steps=(Number(e.value)-Number(e.min||0))*100;
   return Math.abs(steps-Math.round(steps))>1e-7;
  }return originalStep.call(this);
 }});
 window.eval(fs.readFileSync(path.resolve(__dirname,'../../public/workshop-v2.js'),'utf8'));
 const ui=window.WorkshopV2;
 async function settle(){for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,5));if(pending===0){await new Promise(r=>setTimeout(r,10));if(pending===0)return;}}throw Error('UI request did not finish');}
 const change=(node,value)=>{node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));};
 const submit=async form=>{form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle();};
 const click=async node=>{assert.ok(node,'click target exists');node.click();await settle();};
 function date(form,name,value){const box=form.querySelector(`[data-date-name="${name}"]`);assert.ok(box);box.querySelector('[data-date-action=toggle]').click();ui.dateRender(box,value.slice(0,7));const button=box.querySelector(`[data-day="${value.slice(0,10)}"]`);assert.ok(button,'date day rendered');button.click();change(box.querySelector('[data-date-time]'),value.slice(11));assert.equal(box.querySelector('input').value,value);box.querySelector('[data-date-action=done]').click();}
 try{
  await ui.create();let form=document.querySelector('[data-wf-form=create]');assert.ok(form);change(form.querySelector('[name=client_id]'),'C');change(form.querySelector('[name=piano_id]'),'P');change(form.querySelector('[name=title]'),'DOM-created workflow');
  date(form,'start_at',day(0)+'T08:00');date(form,'final_due_at',day(7)+'T17:00');const first=form.querySelector('[data-create-phase]');date(first,'due_at',day(5)+'T12:00');
  await submit(form);assert.equal(document.querySelector('[data-wf-form=create]'),null);assert.ok(document.querySelector('[data-wf-form=phase]'),'details replaces creation');assert.ok(document.querySelector('#wf2-heading').textContent.includes('DOM-created'));
  let workflow=(await window.api('/api/workshop/v2/workflows')).workflows.find(w=>w.title==='DOM-created workflow');assert.ok(workflow);assert.equal(workflow.start_at,day(0)+'T08:00');assert.equal(workflow.stages[0].due_at,day(5)+'T12:00');
  form=document.querySelector('[data-wf-form=task]');change(form.querySelector('[name=title]'),'Task from DOM');date(form,'due_at',day(2)+'T10:00');for(const option of form.querySelector('[name=assignee_ids]').options)option.selected=['W','W2'].includes(option.value);await submit(form);
  workflow=await window.api('/api/workshop/v2/workflows/'+workflow.id);assert.deepEqual(workflow.stages[0].tasks[0].assignee_ids,['W','W2']);
  form=document.querySelector('[data-wf-form=cost]');change(form.querySelector('[name=title]'),'DOM labor');change(form.querySelector('[name=amount]'),'50');change(form.querySelector('[name=charge_amount]'),'80');change(form.querySelector('[name=category]'),'LABOR');await submit(form);assert.ok(document.querySelector('[data-cost-id]:not([data-cost-id=""])'),JSON.stringify({error:document.querySelector('[data-wf-error]')?.textContent,calls:calls.slice(-3),valid:form.checkValidity(),invalid:[...form.querySelectorAll('input,select,textarea')].filter(e=>!e.checkValidity()).map(e=>({html:e.outerHTML,value:e.value,stepMismatch:e.validity.stepMismatch,valueMissing:e.validity.valueMissing}))}));
  form=document.querySelector('[data-wf-form=checklist]');change(form.querySelector('[name=title]'),'Final inspection');await submit(form);await click(document.querySelector('[data-check-id]'));workflow=await window.api('/api/workshop/v2/workflows/'+workflow.id);assert.equal(workflow.stages[0].checklist[0].checked,1);
  const host=document.createElement('div');document.body.append(host);ui.mountDate(host,'test-notification-date',day(3)+'T11:00');change(host.querySelector('[data-date-time]'),'11:45');assert.equal(document.getElementById('test-notification-date').value,day(3)+'T11:45');host.remove();
  // The same real editor is opened by a calendar object, not another modal implementation.
  await ui.openCalendar({wf2_workflow_id:workflow.id,wf2_entity_type:'PHASE',wf2_entity_id:workflow.stages[0].id});assert.equal(document.querySelectorAll('#workflow-v2-dialog').length,1);assert.equal(document.querySelector('[data-wf-form=phase] [name=title]').value,workflow.stages[0].title);
  window.token=tokens.W;window.user={id:'W',name:'W'};await ui.open(workflow.id);assert.ok(document.querySelector('[data-wf-form=phase] fieldset').disabled);const own=document.querySelector('[data-wf-form=task][data-task-id]:not([data-task-id=""])');assert.ok(!own.querySelector('fieldset').disabled);assert.equal(document.querySelector('[data-wf-form=closeout]'),null);
  date(own,'due_at',day(3)+'T10:00');await submit(own);workflow=await window.api('/api/workshop/v2/workflows/'+workflow.id);assert.equal(workflow.stages[0].tasks[0].due_at,day(3)+'T10:00');
  // Admin settings use the new modal/controller, with usable form submission.
  window.token=tokens.A;window.user={id:'A',name:'A'};await ui.settings();form=document.querySelector('[data-wf-form=settings]');assert.equal(form.querySelectorAll('[data-setting-code]').length,7);change(form.querySelector('[name=name_hu]'),'DOM fázis');await submit(form);assert.equal(document.getElementById('workflow-v2-dialog').open,false);
  // Execute the actual delegated notification renderer/controller against real HTTP.
  const appSource=fs.readFileSync(path.resolve(__dirname,'../../public/app.js'),'utf8');
  Object.assign(window,{adminDatePickerClose:()=>{},clientFollowUpDateValue:v=>v,nyNowLocalString:()=>day(0)+'T09:00',contactsRenderData:{data:[]},currentView:'workshop_workflow'});
  document.body.insertAdjacentHTML('beforeend','<div id="floating-notifications-container" class="global-notification-stack"></div><div id="pwa-tasks-badge"></div>');
  window.eval("var deadlineNotifications=[],deadlineNotificationPollTimer=null;"+appSource.slice(appSource.indexOf('function updateDeadlineTaskBadge('),appSource.indexOf('function notificationBellMarkup(')));
  await window.refreshDeadlineNotifications();window.bindDeadlineNotificationDelegation();
  let card=document.querySelector('[data-unified-notification-card]');assert.ok(card);
  assert.equal(card.querySelectorAll('[data-unified-notification-action]').length,3);
  await click(card.querySelector('[data-unified-notification-action=reschedule]'));
  assert.ok(document.querySelector('#unified-notification-reschedule-popover .wf2-days'));
  assert.equal(document.querySelectorAll('#unified-notification-reschedule-popover').length,1);window.closeQuickRescheduleScheduler();
  const closedId=card.dataset.entityId;await click(card.querySelector('[data-unified-notification-close]'));
  assert.ok(!(await window.api('/api/notifications/active')).notifications.some(n=>n.entity_id===closedId));
  await click(document.querySelector('[data-unified-notification-action=snooze-all]'));
  assert.equal((await window.api('/api/notifications/active')).notifications.length,0,JSON.stringify({calls:calls.slice(-8),errors:failures,local:window.eval('deadlineNotifications.length')}));
  window.token=tokens.W;window.user={id:'W',name:'W'};await window.refreshDeadlineNotifications();
  assert.ok(document.querySelector('[data-unified-notification-card]:not(.is-leaving)'),'another account keeps its notifications');
  // Actual swipe handler: horizontal changes phase; vertical scrolling does not.
  const start=appSource.indexOf('function workflowBindMobileSwipe('),end=appSource.indexOf('\n}\n',start)+3;
  window.eval('var workflowMobileDeckState={index:0},workflowMobileSwipeSuppressClickUntil=0;'+appSource.slice(start,end));
  const deck=document.createElement('div');deck.innerHTML='<div data-workflow-mobile-deck><span data-workflow-mobile-counter></span><div class="workflow-mobile-deck-viewport"><div class="workflow-mobile-deck-track"><div class="workflow-mobile-deck-slide"></div><div class="workflow-mobile-deck-slide"></div></div></div><div class="workflow-mobile-deck-dots"><i></i><i></i></div></div>';document.body.append(deck);window.workflowBindMobileSwipe(deck);
  const viewport=deck.querySelector('.workflow-mobile-deck-viewport'),touch=(type,x,y)=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:[{clientX:x,clientY:y}]});viewport.dispatchEvent(e);return e;};
  touch('touchstart',200,100);touch('touchmove',70,105);touch('touchend',70,105);assert.equal(deck.querySelector('[data-workflow-mobile-counter]').textContent,'2 / 2');
  touch('touchstart',70,100);assert.equal(touch('touchmove',85,230).defaultPrevented,false);touch('touchend',85,230);assert.equal(deck.querySelector('[data-workflow-mobile-counter]').textContent,'2 / 2');
  touch('touchstart',60,100);touch('touchmove',200,105);touch('touchend',200,105);assert.equal(deck.querySelector('[data-workflow-mobile-counter]').textContent,'1 / 2');
  // Execute the new calendar filter and drag permission branches, preserving ordinary jobs.
  const funcs=[['function filterJobsForScheduler(','function nyNowLocalString('],['function isMovableSchedulerJob(','async function renderScheduler(']];
  window.eval('var currentSchedulerEntryFilter="WORKFLOW",currentSchedulerWorker="ALL";');
  for(const [a,b] of funcs)window.eval(appSource.slice(appSource.indexOf(a),appSource.indexOf(b,appSource.indexOf(a))));
  const calendar=(await window.api('/api/jobs')).find(j=>j.wf2_entity_type==='TASK'&&j.wf2_workflow_id===workflow.id);
  assert.ok(calendar);assert.equal(window.isMovableSchedulerEntry(calendar),true);assert.equal(window.filterJobsForScheduler([calendar,{id:'normal'}]).length,1);
  assert.equal(window.isMovableSchedulerEntry({...calendar,wf2_can_edit:false}),false);
  window.eval('currentSchedulerEntryFilter="CALENDAR";');assert.equal(window.filterJobsForScheduler([calendar,{id:'normal'}])[0].id,'normal');
  assert.ok(views>6,'mutations refresh board/calendar and notifications');assert.deepEqual(failures,[]);assert.equal(document.querySelector('[data-wf-error]')?.textContent||'','');
  return {http_calls:calls.length,view_refreshes:views,dom:true,visual_layout:false};
 }finally{await window.happyDOM.close();}
}
module.exports={verifyWorkflowUI};
