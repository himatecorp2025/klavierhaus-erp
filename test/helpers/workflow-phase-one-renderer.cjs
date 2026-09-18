"use strict";
// JavaScript renderer/handler tests, NOT browser layout or visual tests.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),Module=require('node:module');
const embedded=new Module('phase1-acorn');embedded._compile(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],'phase1-acorn.js');
const app=fs.readFileSync(path.join(__dirname,'../../public/app.js'),'utf8');
const declarations=embedded.exports.parse(app,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration').map(n=>app.slice(n.start,n.end)).join('\n');
const shell=fs.readFileSync(path.join(__dirname,'../../public/workshop-shell.js'),'utf8');
async function verifyRenderer(stages){
 const box={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};const errors=[];
 const ctx=vm.createContext({console,Date,Intl,URL,URLSearchParams,setTimeout,clearTimeout,window:{matchMedia:()=>({matches:false})},document:{querySelectorAll:()=>[]},currentLang:'hu',workshopWorkflowDate:'2026-09-18',workshopWorkflowSelectedId:'',workshopWorkflowSelectedStageId:'',workshopWorkflowPrevious:false,workshopWorkflowAssigneeFilter:'ALL',workshopWorkflowStatusFilter:'ALL',workshopWorkflowOverdueOnly:false,workflowMobileDeckState:null});
 vm.runInContext(declarations+'\n'+shell,ctx);
 Object.assign(ctx,{ensureView:()=>box,api:async url=>url==='/api/workshop/v2/phases'?{stages}:{workflows:[]},loadSchedulerWorkers:async()=>[],isAdmin:()=>true,isSuperadmin:()=>true,decorateWorkflowToolbar:()=>{},workflowBindDatePicker:()=>{},bindJobDateTimePickers:()=>{},workflowBindMobileSwipe:()=>{},updateNYClock:()=>{},applyLanguageToDOM:()=>{},showError:e=>errors.push(String(e)),currentNYTimeString:()=> '10:00'});
 await ctx.renderWorkshopWorkflow();assert.deepEqual(errors,[]);assert.equal((box.innerHTML.match(/class="workflow-stage-heading"/g)||[]).length,7);assert.match(box.innerHTML,/workflow-phase-two/);assert.match(box.innerHTML,/onclick="WorkshopV2.create\(\)"/);assert.doesNotMatch(box.innerHTML,/workflow-drawer|workflow-details-modal-overlay/);
 ctx.pianoReferenceMeta=()=>'';ctx.workshopWorkflowDefinitions=stages;
 const history=ctx.workflowBoardRow({id:'WF-HISTORY',client_name:'Protected Client',brand:'Steinway',model:'B',title:'Archived source',final_due_at:'2026-09-18T17:00',stages:[]});assert.equal((history.match(/class="workflow-stage-dropzone/g)||[]).length,7);assert.match(history,/Steinway B/);
 const row={id:'calendar_job-J',entity_type:'CALENDAR_JOB',entity_id:'J',title:'A <safe> job',client_context:'Client',instrument_context:'Piano',responsible_name:'Owner',target_date:'2026-09-18T09:00'};
 const markup=ctx.unifiedDeadlineCardMarkup(row);assert.equal((markup.match(/data-unified-notification-action=/g)||[]).length,3);assert.match(markup,/A &lt;safe&gt; job/);assert.match(markup,/data-unified-notification-close/);
 const calls=[],handlers=[];const root={dataset:{},contains:()=>true,addEventListener:(_name,cb)=>handlers.push(cb)};
 Object.assign(ctx,{document:{getElementById:id=>id==='floating-notifications-container'?root:null},deadlineNotifications:[row],snoozeAllDeadlineNotifications:()=>calls.push('all'),snoozeDeadlineNotification:()=>calls.push('snooze'),completeDeadlineNotification:()=>calls.push('complete'),openQuickRescheduleScheduler:()=>calls.push('reschedule')});
 ctx.bindDeadlineNotificationDelegation();ctx.bindDeadlineNotificationDelegation();assert.equal(handlers.length,1,'Delegation survives repeated initialization');
 const trigger=(action,close=false)=>{const control={dataset:{unifiedNotificationAction:action},closest:()=>{if(action==='snooze-all')throw Error('Bulk button must not require a card');return {dataset:{unifiedNotificationCard:row.id}};}};handlers[0]({preventDefault(){},target:{closest:selector=>selector==='[data-unified-notification-close]'?(close?control:null):selector==='[data-unified-notification-action]'?(close?null:control):null}});};
 trigger('snooze-all');trigger('complete');trigger('reschedule');trigger('snooze');trigger('',true);assert.deepEqual(calls,['all','complete','reschedule','snooze','snooze']);
 return {empty_shell:'PASS',history_markup:'PASS',notification_markup:'PASS',delegation:'PASS',visual_layout:'NOT_RUN'};
}
module.exports={verifyRenderer};
