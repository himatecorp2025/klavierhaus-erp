"use strict";

const R2_STAGES=[
  {key:"received",en:"Received / Scheduled",hu:"Beérkezett / Ütemezve",position:1},
  {key:"in_progress",en:"In Progress",hu:"Folyamatban",position:2},
  {key:"qa_review",en:"QA / Handoff",hu:"Minőségellenőrzés / Átadás",position:3},
  {key:"admin_approval",en:"Admin Approval",hu:"Admin jóváhagyás",position:4},
  {key:"completed",en:"Completed",hu:"Lezárva",position:5}
];
const R2_TZ="America/New_York";
const R2_DAY_START=7*60;
const R2_DAY_END=20*60;
const R2_SLOT_MIN=15;
const R2_SLOT_HEIGHT=18;
const R2_PX_PER_MIN=R2_SLOT_HEIGHT/R2_SLOT_MIN;
const R2_BLOCKERS={
  material_procurement:["Material procurement","Anyagbeszerzés"],
  parts_procurement:["Parts procurement","Alkatrészbeszerzés"],
  material_issue:["Material issue","Anyaghiba"],
  waiting_client:["Waiting for client","Ügyfélre vár"],
  waiting_technician:["Waiting for technician","Technikusra vár"],
  waiting_admin:["Waiting for admin approval","Admin jóváhagyásra vár"],
  waiting_invoice:["Waiting for invoicing","Számlázásra vár"],
  other:["Other","Egyéb"]
};
const r2IsAdmin=()=>["ADMIN","SUPERADMIN"].includes(state.user?.role);

function r2Definitions(){return state.r2Workflow?.stages?.length?state.r2Workflow.stages:R2_STAGES.map(row=>({key:row.key,label_en:row.en,label_hu:row.hu,position:row.position}));}
function r2StageLabel(stage){const row=r2Definitions().find(item=>item.key===stage)||R2_STAGES.find(item=>item.key===stage);return row?state.language==="hu"?(row.label_hu||row.hu):(row.label_en||row.en):stage||"";}
function r2BlockerLabel(code){const pair=R2_BLOCKERS[code];return pair?(state.language==="hu"?pair[1]:pair[0]):tr("No delay reason","Nincs elakadás-ok");}
function r2NyParts(date){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:R2_TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  return Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
}
function r2IsoToNyInput(value){
  if(!value)return "";
  const p=r2NyParts(new Date(value));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function r2NyInputToIso(value){
  const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(!match)throw new Error("INVALID_SCHEDULE_TIME");
  const wanted={year:+match[1],month:+match[2],day:+match[3],hour:+match[4],minute:+match[5]};
  let guess=Date.UTC(wanted.year,wanted.month-1,wanted.day,wanted.hour,wanted.minute);
  for(let i=0;i<3;i+=1){
    const p=r2NyParts(new Date(guess)),represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute),desired=Date.UTC(wanted.year,wanted.month-1,wanted.day,wanted.hour,wanted.minute);
    guess+=desired-represented;
  }
  return new Date(guess).toISOString();
}
function r2NyDate(value){const p=r2NyParts(new Date(value));return `${p.year}-${p.month}-${p.day}`;}
function r2Today(){return r2NyDate(new Date());}
function r2DateAdd(dateString,days){const d=new Date(dateString+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function r2MonthAdd(dateString,months){const [y,m,d]=dateString.split("-").map(Number),date=new Date(Date.UTC(y,m-1+months,Math.min(d,28),12));return date.toISOString().slice(0,10);}
function r2WeekStart(dateString){const d=new Date(dateString+"T12:00:00Z"),offset=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-offset);return d.toISOString().slice(0,10);}
function r2Range(anchor,mode){
  const date=anchor||r2Today();
  if(mode==="day"){const next=r2DateAdd(date,1);return {startDate:date,endDate:next,days:[date],from:r2NyInputToIso(date+"T00:00"),to:r2NyInputToIso(next+"T00:00")};}
  if(mode==="month"){
    const first=date.slice(0,8)+"01",start=r2WeekStart(first),end=r2DateAdd(start,42);
    return {startDate:start,endDate:end,days:Array.from({length:42},(_,i)=>r2DateAdd(start,i)),from:r2NyInputToIso(start+"T00:00"),to:r2NyInputToIso(end+"T00:00"),month:first.slice(0,7)};
  }
  const start=r2WeekStart(date),end=r2DateAdd(start,7);return {startDate:start,endDate:end,days:Array.from({length:7},(_,i)=>r2DateAdd(start,i)),from:r2NyInputToIso(start+"T00:00"),to:r2NyInputToIso(end+"T00:00")};
}
function r2FormatDateTime(value){
  if(!value)return tr("Not scheduled","Nincs ütemezve");
  return new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{timeZone:R2_TZ,month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
}
function r2FormatDate(dateKey,options={month:"short",day:"numeric"}){
  return new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",options).format(new Date(dateKey+"T12:00:00Z"));
}
function r2DefaultInput(dateKey=null){
  if(dateKey)return dateKey+"T09:00";
  const date=new Date(Date.now()+60*60000);date.setMinutes(Math.ceil(date.getMinutes()/15)*15,0,0);return r2IsoToNyInput(date);
}
function r2TechnicianOptions(selected=""){
  return (state.users||[]).filter(user=>["WORKER","MANAGER","ADMIN"].includes(user.role)).map(user=>`<option value="${esc(user.id)}" ${String(user.id)===String(selected||"")?"selected":""}>${esc(user.name)} · ${esc(roleLabel(user.role))}</option>`).join("");
}
function r2JobPiano(job){return [job.piano_brand,job.piano_model,job.piano_serial_number].filter(Boolean).join(" · ");}
function r2Money(value){return new Intl.NumberFormat(state.language==="hu"?"hu-HU":"en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value||0));}
function r2TimeMinutes(value){const p=r2NyParts(new Date(value));return Number(p.hour)*60+Number(p.minute);}
function r2Pad(value){return String(value).padStart(2,"0");}
function r2MinutesInput(date,minutes){const safe=Math.max(0,Math.min(1439,minutes)),h=Math.floor(safe/60),m=safe%60;return `${date}T${r2Pad(h)}:${r2Pad(m)}`;}
function r2SnapMinutes(value){return Math.round(value/R2_SLOT_MIN)*R2_SLOT_MIN;}

function r2WorkflowPlanRows(plan=null){
  const map=new Map((plan||[]).map(row=>[row.stage_key,row]));
  return r2Definitions().map(stage=>{
    const existing=map.get(stage.key),enabled=stage.key==="completed"?true:(existing?Boolean(existing.enabled):true),due=existing?.due_at?r2IsoToNyInput(existing.due_at):"";
    return `<div class="workflow-plan-row" data-workflow-phase="${stage.key}">
      <label class="workflow-phase-toggle"><input type="checkbox" name="phase_${stage.key}" ${enabled?"checked":""} ${stage.key==="completed"?"disabled":""}><span><strong>${esc(state.language==="hu"?stage.label_hu:stage.label_en)}</strong><small>${stage.key==="completed"?tr("Mandatory final endpoint","Kötelező végpont"):tr("Include this phase","Fázis használata")}</small></span></label>
      <label class="field"><span>${tr("Expected completion","Várható befejezés")}</span><input type="datetime-local" step="900" name="due_${stage.key}" value="${esc(due)}"></label>
    </div>`;
  }).join("");
}
function r2ReadWorkflowPlan(form){
  return r2Definitions().map(stage=>{
    const enabled=stage.key==="completed"?true:Boolean(form.querySelector(`[name="phase_${stage.key}"]`)?.checked);
    const dueValue=form.querySelector(`[name="due_${stage.key}"]`)?.value||"";
    return {stage_key:stage.key,enabled,due_at:dueValue?r2NyInputToIso(dueValue):null};
  });
}

function r2PlannedCard(job){
  return `<article class="job-card planned-card" data-job-id="${job.id}">
    <div class="job-card-top"><span class="job-code">${esc(job.job_code||("#"+job.id))}</span><span class="priority-chip">${tr("PLANNED","TERVEZETT")}</span></div>
    <h3>${esc(job.title)}</h3><p class="job-party">${esc(job.client_name)} · ${esc(r2JobPiano(job))}</p>
    ${job.description?`<p class="job-description">${esc(job.description)}</p>`:""}
    <div class="job-meta"><span>👤 ${esc(job.assigned_technician_name||tr("Unassigned","Nincs technikus"))}</span><span>⏱ ${Number(job.estimated_duration_min||120)} min</span><span>${job.location_type==="on_site"?"⌂ "+tr("On site","Helyszíni"):"♬ "+tr("Workshop","Műhely")}</span></div>
    <div class="phase-chip-row">${(job.workflow_phases||[]).filter(p=>p.enabled).map(p=>`<span class="phase-chip">${esc(r2StageLabel(p.stage_key))}</span>`).join("")}</div>
    <div class="job-actions"><button class="primary-button" type="button" data-activate-job="${job.id}">${tr("Activate & Schedule","Aktiválás és ütemezés")}</button><button class="text-button" type="button" data-edit-job="${job.id}">${tr("Edit","Szerkesztés")}</button>${r2IsAdmin()?`<button class="text-button" type="button" data-plan-job="${job.id}">${tr("Workflow","Munkafolyamat")}</button><button class="danger-button" type="button" data-cancel-job="${job.id}">${tr("Cancel","Megszakítás")}</button>`:""}</div>
  </article>`;
}
async function renderPlanned(){
  const workspace=$("#workspace"),[jobs]=await Promise.all([api("/api/jobs/pipeline"),loadUsers(),loadClients(),api("/api/workflow/settings").then(settings=>{state.r2Workflow={...(state.r2Workflow||{}),stages:settings.stages};})]);
  state.r2Planned=jobs;
  workspace.innerHTML=pageHead(tr("Planned Jobs","Tervezett munkák"),tr("Negotiation and unscheduled work stays outside the active workshop until you activate it.","A tárgyalás alatt álló, ütemezetlen munka nem kerül az aktív műhelybe, amíg nem aktiválod."),
    `<button id="newPlannedBtn" class="primary-button" type="button">＋ ${tr("New Planned Job","Új tervezett munka")}</button>`)+
    `<div class="stats-grid"><div class="stat-card"><small>${tr("Pipeline","Tervezési lista")}</small><strong>${jobs.length}</strong></div><div class="stat-card"><small>${tr("Unassigned","Nincs kiosztva")}</small><strong>${jobs.filter(job=>!job.assigned_technician_id).length}</strong></div><div class="stat-card"><small>${tr("On site","Helyszíni")}</small><strong>${jobs.filter(job=>job.location_type==="on_site").length}</strong></div><div class="stat-card"><small>${tr("Workshop","Műhely")}</small><strong>${jobs.filter(job=>job.location_type==="workshop").length}</strong></div></div>
    <div class="planned-toolbar"><div class="search-field"><input id="plannedSearch" type="search" placeholder="${tr("Search job, client or piano…","Keresés munka, ügyfél vagy zongora alapján…")}"></div><button id="openWorkshopBtn" class="secondary-button" type="button">${tr("Workshop & Calendar","Műhely és naptár")} →</button></div>
    <div id="plannedList" class="planned-grid"></div>`;
  $("#newPlannedBtn").addEventListener("click",()=>r2OpenCreateJob(renderPlanned));
  $("#openWorkshopBtn").addEventListener("click",()=>navTo("workshop"));
  $("#plannedSearch").addEventListener("input",r2RenderPlannedList);r2RenderPlannedList();
}
function r2RenderPlannedList(){
  const host=$("#plannedList");if(!host)return;
  const q=String($("#plannedSearch")?.value||"").trim().toLowerCase();
  const jobs=(state.r2Planned||[]).filter(job=>!q||[job.job_code,job.title,job.client_name,job.piano_brand,job.piano_model,job.description].filter(Boolean).join(" ").toLowerCase().includes(q));
  host.innerHTML=jobs.length?jobs.map(r2PlannedCard).join(""):`<section class="panel empty-state">${tr("No Planned Jobs.","Nincs tervezett munka.")}</section>`;
  $$("[data-activate-job]",host).forEach(button=>button.addEventListener("click",()=>r2OpenActivate(jobs.find(job=>Number(job.id)===Number(button.dataset.activateJob)))));
  $$("[data-edit-job]",host).forEach(button=>button.addEventListener("click",()=>r2OpenEditJob(jobs.find(job=>Number(job.id)===Number(button.dataset.editJob)),renderPlanned)));
  $$("[data-plan-job]",host).forEach(button=>button.addEventListener("click",()=>r2OpenWorkflowPlan(jobs.find(job=>Number(job.id)===Number(button.dataset.planJob)),renderPlanned)));
  $$("[data-cancel-job]",host).forEach(button=>button.addEventListener("click",()=>r2OpenCancel(jobs.find(job=>Number(job.id)===Number(button.dataset.cancelJob)),renderPlanned)));
}

async function r2OpenCreateJob(refresh=renderPlanned,defaults={}){
  const [clients,,settings]=await Promise.all([loadClients(),loadUsers().then(()=>null),api("/api/workflow/settings")]);
  state.r2Workflow={...(state.r2Workflow||{}),stages:settings.stages};
  if(!clients.length){toast(tr("Create a client and piano first.","Előbb hozz létre ügyfelet és zongorát."),"error");return;}
  const scheduled=Boolean(defaults.date);
  openDialog({title:scheduled?tr("New scheduled job","Új ütemezett munka"):tr("New Planned Job","Új tervezett munka"),eyebrow:scheduled?tr("CALENDAR","NAPTÁR"):tr("PIPELINE","TERVEZÉS"),body:`<form id="jobCreateForm" class="form-grid">
    <label class="field"><span>${tr("Client","Ügyfél")} *</span><select id="jobClientSelect" name="client_id" required>${clients.map(client=>`<option value="${client.id}">${esc(client.name)}</option>`).join("")}</select></label>
    <label class="field"><span>${tr("Piano","Zongora")} *</span><select id="jobPianoSelect" name="piano_id" required></select></label>
    <label class="field full"><span>${tr("Job title","Munka megnevezése")} *</span><input name="title" required autofocus></label>
    <label class="field full"><span>${tr("Description","Leírás")}</span><textarea name="description"></textarea></label>
    <label class="field"><span>${tr("Location","Helyszín")}</span><select name="location_type"><option value="workshop">${tr("Workshop","Műhely")}</option><option value="on_site">${tr("On site","Helyszíni")}</option></select></label>
    <label class="field"><span>${tr("Duration","Időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="120"></label>
    <label class="field full"><span>${tr("Service address","Szervizcím")}</span><input name="site_address"></label>
    ${scheduled?`<label class="field"><span>${tr("Start · New York","Kezdés · New York")} *</span><input name="scheduled_at" type="datetime-local" step="900" value="${esc(defaults.datetime||r2DefaultInput(defaults.date))}" required></label><label class="field"><span>${tr("Technician","Technikus")} *</span><select name="assigned_technician_id" required><option value="">${tr("Choose technician","Válassz technikust")}</option>${r2TechnicianOptions("")}</select></label>`:""}
    <section class="full workflow-plan-editor"><div class="panel-head inline-panel-head"><div><h3>${tr("Workflow phases","Munkafázisok")}</h3><p>${tr("Choose the phases this job actually needs. Completed is always mandatory.","Jelöld ki, mely fázisokra van szüksége ennek a munkának. A Lezárva mindig kötelező.")}</p></div></div>${r2WorkflowPlanRows()}</section>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${scheduled?tr("Create & schedule","Létrehozás és ütemezés"):tr("Create Planned Job","Tervezett munka létrehozása")}</button></div>
  </form>`});
  async function loadPianos(){
    const id=$("#jobClientSelect").value,pianos=await api(`/api/clients/${id}/pianos`);
    $("#jobPianoSelect").innerHTML=pianos.length?pianos.map(piano=>`<option value="${piano.id}">${esc([piano.brand,piano.model,piano.serial_number].filter(Boolean).join(" · "))}</option>`).join(""):`<option value="">${tr("No piano — add one in Master Data","Nincs zongora — add hozzá a Törzsadatokban")}</option>`;
    $("#jobPianoSelect").disabled=!pianos.length;
  }
  $("#jobClientSelect").addEventListener("change",()=>loadPianos().catch(error=>toast(humanError(error),"error")));await loadPianos();
  $("#jobCreateForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.client_id=Number(body.client_id);body.piano_id=Number(body.piano_id);body.estimated_duration_min=Number(body.estimated_duration_min||120);
    body.workflow_phases=r2ReadWorkflowPlan(event.currentTarget);
    if(scheduled)body.scheduled_at=r2NyInputToIso(body.scheduled_at);if(!body.assigned_technician_id)delete body.assigned_technician_id;
    try{await api("/api/jobs",{method:"POST",body:JSON.stringify(body)});closeDialog();toast(scheduled?tr("Job added to the active calendar.","Munka bekerült az aktív naptárba."):tr("Planned Job created.","Tervezett munka létrehozva."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
async function r2OpenActivate(job){
  if(!state.users?.length)await loadUsers();
  openDialog({title:tr("Activate & Schedule","Aktiválás és ütemezés"),eyebrow:job.job_code||tr("PIPELINE","TERVEZÉS"),body:`<form id="activateJobForm" class="form-grid">
    <div class="detail-note full"><strong>${esc(job.title)}</strong><br>${esc(job.client_name+" · "+r2JobPiano(job))}</div>
    <label class="field full"><span>${tr("Technician","Technikus")} *</span><select name="assigned_technician_id" required><option value="">${tr("Choose technician","Válassz technikust")}</option>${r2TechnicianOptions(job.assigned_technician_id)}</select></label>
    <label class="field"><span>${tr("Start · New York","Kezdés · New York")} *</span><input name="scheduled_at" type="datetime-local" step="900" value="${r2DefaultInput()}" required></label>
    <label class="field"><span>${tr("Duration","Időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="${Number(job.estimated_duration_min||120)}"></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Activate","Aktiválás")}</button></div></form>`});
  $("#activateJobForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.scheduled_at=r2NyInputToIso(body.scheduled_at);body.estimated_duration_min=Number(body.estimated_duration_min||120);
    try{await api(`/api/jobs/activate/${job.id}`,{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Job activated and scheduled.","Munka aktiválva és ütemezve."),"success");navTo("workshop");}
    catch(error){toast(error.payload?.conflict?tr("Schedule conflict with ","Ütemezési ütközés: ")+(error.payload.conflict.job_code||error.payload.conflict.title):humanError(error),"error");}
  });
}
async function r2OpenEditJob(job,refresh){
  if(!state.users?.length)await loadUsers();
  openDialog({title:tr("Edit job","Munka szerkesztése"),eyebrow:job.job_code||tr("JOB","MUNKA"),body:`<form id="jobEditForm" class="form-grid">
    <label class="field full"><span>${tr("Title","Megnevezés")} *</span><input name="title" value="${esc(job.title)}" required></label>
    <label class="field full"><span>${tr("Description","Leírás")}</span><textarea name="description">${esc(job.description||"")}</textarea></label>
    <label class="field"><span>${tr("Location","Helyszín")}</span><select name="location_type"><option value="workshop" ${job.location_type==="workshop"?"selected":""}>${tr("Workshop","Műhely")}</option><option value="on_site" ${job.location_type==="on_site"?"selected":""}>${tr("On site","Helyszíni")}</option></select></label>
    <label class="field"><span>${tr("Duration","Időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="${Number(job.estimated_duration_min||120)}"></label>
    <label class="field full"><span>${tr("Technician","Technikus")}</span><select name="assigned_technician_id"><option value="">${tr("Unassigned","Nincs kiosztva")}</option>${r2TechnicianOptions(job.assigned_technician_id)}</select></label>
    <label class="field full"><span>${tr("Internal notes","Belső megjegyzés")}</span><textarea name="internal_notes">${esc(job.internal_notes||"")}</textarea></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save","Mentés")}</button></div></form>`});
  $("#jobEditForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.estimated_duration_min=Number(body.estimated_duration_min||120);if(!body.assigned_technician_id)body.assigned_technician_id="";
    try{await api(`/api/jobs/${job.id}`,{method:"PUT",body:JSON.stringify(body)});closeDialog();toast(tr("Job updated.","Munka frissítve."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
async function r2OpenSchedule(job,refresh=renderWorkshop){
  if(!state.users?.length)await loadUsers();
  openDialog({title:tr("Schedule job","Munka ütemezése"),eyebrow:job.job_code||tr("CALENDAR","NAPTÁR"),body:`<form id="scheduleJobForm" class="form-grid">
    <div class="detail-note full"><strong>${esc(job.title)}</strong><br>${esc(job.client_name+" · "+r2JobPiano(job))}</div>
    <label class="field full"><span>${tr("Technician","Technikus")} *</span><select name="assigned_technician_id" required><option value="">${tr("Choose technician","Válassz technikust")}</option>${r2TechnicianOptions(job.assigned_technician_id)}</select></label>
    <label class="field"><span>${tr("Start · New York","Kezdés · New York")} *</span><input name="scheduled_at" type="datetime-local" step="900" value="${esc(job.scheduled_at?r2IsoToNyInput(job.scheduled_at):r2DefaultInput())}" required></label>
    <label class="field"><span>${tr("Duration","Időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="${Number(job.estimated_duration_min||120)}"></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save schedule","Ütemezés mentése")}</button></div></form>`});
  $("#scheduleJobForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.scheduled_at=r2NyInputToIso(body.scheduled_at);body.estimated_duration_min=Number(body.estimated_duration_min||120);
    try{await api(`/api/jobs/${job.id}/schedule`,{method:"PATCH",body:JSON.stringify(body)});closeDialog();toast(tr("Schedule updated.","Ütemezés frissítve."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r2OpenWorkflowPlan(job,refresh=renderWorkshop){
  if(!r2IsAdmin())return;
  openDialog({title:tr("Workflow configuration","Munkafolyamat beállítása"),eyebrow:job.job_code||tr("WORKFLOW","MUNKAFOLYAMAT"),body:`<form id="workflowPlanForm">
    <div class="detail-note"><strong>${esc(job.title)}</strong><br>${tr("Future phases can be activated or removed while the job is running. Completed remains mandatory.","A még el nem ért fázisok futás közben is hozzáadhatók vagy kikapcsolhatók. A Lezárva kötelező marad.")}</div>
    <div class="workflow-plan-editor">${r2WorkflowPlanRows(job.workflow_phases)}</div>
    <div class="form-actions"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save workflow","Munkafolyamat mentése")}</button></div></form>`});
  $("#workflowPlanForm").addEventListener("submit",async event=>{
    event.preventDefault();try{await api(`/api/jobs/${job.id}/workflow-phases`,{method:"PUT",body:JSON.stringify({phases:r2ReadWorkflowPlan(event.currentTarget)})});closeDialog();toast(tr("Workflow updated.","Munkafolyamat frissítve."),"success");await refresh();}catch(error){toast(humanError(error),"error");}
  });
}
function r2OpenBlocker(job,refresh=renderWorkshop){
  const phase=job.current_phase||{};
  openDialog({title:tr("Deadline & delay reason","Határidő és elakadás oka"),eyebrow:r2StageLabel(job.stage),body:`<form id="blockerForm" class="form-grid">
    <label class="field full"><span>${tr("Expected completion","Várható befejezés")}</span><input name="due_at" type="datetime-local" step="900" value="${esc(phase.due_at?r2IsoToNyInput(phase.due_at):"")}"></label>
    <label class="field full"><span>${tr("Delay / blocker reason","Elakadás / késés oka")}</span><select name="blocker_code"><option value="">${tr("No blocker","Nincs elakadás")}</option>${Object.entries(R2_BLOCKERS).map(([code,pair])=>`<option value="${code}" ${phase.blocker_code===code?"selected":""}>${esc(state.language==="hu"?pair[1]:pair[0])}</option>`).join("")}</select></label>
    <label class="field full"><span>${tr("Internal note","Belső megjegyzés")}</span><textarea name="blocker_note">${esc(phase.blocker_note||"")}</textarea></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save","Mentés")}</button></div></form>`});
  $("#blockerForm").addEventListener("submit",async event=>{
    event.preventDefault();const form=Object.fromEntries(new FormData(event.currentTarget)),body={due_at:form.due_at?r2NyInputToIso(form.due_at):null,blocker_code:form.blocker_code||null,blocker_note:form.blocker_note||null};
    try{await api(`/api/jobs/${job.id}/workflow-phases/${encodeURIComponent(job.stage)}`,{method:"PATCH",body:JSON.stringify(body)});closeDialog();toast(tr("Workflow status updated.","Munkafolyamat állapota frissítve."),"success");await refresh();}catch(error){toast(humanError(error),"error");}
  });
}
function r2OpenHandoff(job,refresh=renderWorkshop){
  const next=job.next_stage;
  if(!next||next==="completed"){toast(tr("This job is ready for Admin closeout.","A munka adminisztrátori lezárásra kész."),"error");return;}
  openDialog({title:tr("Complete Phase / Handoff","Fázis lezárása / Átadás"),eyebrow:`${r2StageLabel(job.stage)} → ${r2StageLabel(next)}`,body:`<form id="handoffForm" class="form-grid">
    <div class="detail-note full">${tr("All fields below are optional. If you do not choose the next responsible person, the current technician continues automatically.","Az alábbi mezők mind opcionálisak. Ha nem jelölsz ki következő felelőst, automatikusan a jelenlegi technikus viszi tovább.")}</div>
    <label class="field"><span>${tr("Labor / daily fee","Munkadíj / napi díj")} (USD)</span><input name="phase_labor_cost" type="number" min="0" step="0.01" value="0"></label>
    <label class="field"><span>${tr("Material cost","Anyagköltség")} (USD)</span><input name="phase_material_cost" type="number" min="0" step="0.01" value="0"></label>
    <label class="field full"><span>${tr("Internal handoff note","Belső átadási jegyzet")}</span><textarea name="phase_note"></textarea></label>
    <label class="field full"><span>${tr("Next responsible","Következő felelős")}</span><select name="assigned_to_user_id"><option value="">${tr("Keep current technician","Jelenlegi technikus marad")}</option>${r2TechnicianOptions("")}</select></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Complete phase","Fázis lezárása")}</button></div></form>`});
  $("#handoffForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.phase_labor_cost=Number(body.phase_labor_cost||0);body.phase_material_cost=Number(body.phase_material_cost||0);if(!body.assigned_to_user_id)delete body.assigned_to_user_id;
    try{await api(`/api/jobs/${job.id}/handoff`,{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Phase completed.","Fázis lezárva."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r2OpenCancel(job,refresh=renderWorkshop){
  openDialog({title:tr("Cancel workflow","Munkafolyamat megszakítása"),eyebrow:job.job_code||tr("ADMIN","ADMIN"),body:`<form id="cancelJobForm" class="form-grid">
    <div class="detail-note full">${tr("The job will disappear from the active calendar and workflow. Recorded labor/material remains an incurred cost.","A munka eltűnik az aktív naptárból és munkafolyamatból. A már rögzített munka- és anyagköltség megmarad.")}</div>
    <label class="field"><span>${tr("Cancelled by","Megszakítás kezdeményezője")}</span><select name="party"><option value="client">${tr("Client","Ügyfél")}</option><option value="klavierhaus">Klavierhaus</option><option value="other">${tr("Other","Egyéb")}</option></select></label>
    <label class="field full"><span>${tr("Reason","Indok")} *</span><textarea name="reason" required></textarea></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Keep job","Munka megtartása")}</button><button class="danger-button" type="submit">${tr("Cancel workflow","Munkafolyamat megszakítása")}</button></div></form>`});
  $("#cancelJobForm").addEventListener("submit",async event=>{event.preventDefault();try{await api(`/api/jobs/${job.id}/cancel`,{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast(tr("Workflow cancelled.","Munkafolyamat megszakítva."),"success");await refresh();}catch(error){toast(humanError(error),"error");}});
}

function r2WorkflowCard(job){
  const overdue=job.current_phase?.due_at&&new Date(job.current_phase.due_at)<new Date()&&job.stage!=="completed";
  return `<article class="job-card stage-card ${overdue?"is-overdue":""}" draggable="true" data-job-id="${job.id}">
    <div class="job-card-top"><span class="job-code">${esc(job.job_code||("#"+job.id))}</span><span class="priority-chip">${esc(r2StageLabel(job.stage))}</span></div>
    <h3>${esc(job.title)}</h3><p class="job-party">${esc(job.client_name)} · ${esc(r2JobPiano(job))}</p>
    <div class="job-meta"><span>🗓 ${esc(r2FormatDateTime(job.scheduled_at))}</span><span>👤 ${esc(job.assigned_technician_name||tr("Unassigned","Nincs technikus"))}</span><span>💵 ${esc(r2Money(Number(job.total_labor_cost||0)+Number(job.total_material_cost||0)))}</span></div>
    ${job.current_phase?.due_at?`<div class="workflow-due ${overdue?"overdue":""}">${tr("Due","Határidő")}: ${esc(r2FormatDateTime(job.current_phase.due_at))}</div>`:""}
    ${job.current_phase?.blocker_code?`<div class="blocked-note">⚠ ${esc(r2BlockerLabel(job.current_phase.blocker_code))}${job.current_phase.blocker_note?` · ${esc(job.current_phase.blocker_note)}`:""}</div>`:""}
    ${job.stage==="completed"?`<div class="completed-note">✓ ${tr("Closed by","Lezárta")}: ${esc(job.completed_by_name||"Admin")}</div>`:""}
    <div class="job-actions">
      ${job.stage!=="completed"&&job.ready_for_closeout&&r2IsAdmin()?`<button class="primary-button closeout-button" type="button" data-closeout-job="${job.id}">${tr("Complete & Invoice","Lezárás és számlázás")}</button>`:""}
      ${job.stage!=="completed"&&!job.ready_for_closeout?`<button class="primary-button" type="button" data-handoff-job="${job.id}">${tr("Complete phase","Fázis lezárása")}</button>`:""}
      ${job.stage!=="completed"?`<button class="text-button" type="button" data-schedule-job="${job.id}">${tr("Schedule","Ütemezés")}</button><button class="text-button" type="button" data-blocker-job="${job.id}">${tr("Deadline / blocker","Határidő / elakadás")}</button>`:""}
      ${r2IsAdmin()&&job.stage!=="completed"?`<button class="text-button" type="button" data-plan-job="${job.id}">${tr("Workflow","Munkafolyamat")}</button><button class="danger-button" type="button" data-cancel-job="${job.id}">${tr("Cancel","Megszakítás")}</button>`:""}
    </div>
  </article>`;
}
function r2BindWorkflowActions(root,jobs){
  $$("[data-handoff-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenHandoff(jobs.find(job=>Number(job.id)===Number(button.dataset.handoffJob)))));
  $$("[data-schedule-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenSchedule(jobs.find(job=>Number(job.id)===Number(button.dataset.scheduleJob)))));
  $$("[data-blocker-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenBlocker(jobs.find(job=>Number(job.id)===Number(button.dataset.blockerJob)))));
  $$("[data-plan-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenWorkflowPlan(jobs.find(job=>Number(job.id)===Number(button.dataset.planJob)))));
  $$("[data-cancel-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenCancel(jobs.find(job=>Number(job.id)===Number(button.dataset.cancelJob)))));
  $$("[data-closeout-job]",root).forEach(button=>button.addEventListener("click",()=>{const job=jobs.find(item=>Number(item.id)===Number(button.dataset.closeoutJob));if(typeof r3OpenCloseout==="function")r3OpenCloseout(job,renderWorkshop);}));
}
function r2WorkflowColumn(column){
  const label=state.language==="hu"?column.label_hu:column.label_en;
  return `<section class="workflow-column stage-${column.key}" data-drop-stage="${column.key}"><header><div><span class="eyebrow">${tr("WORKFLOW","MUNKAFOLYAMAT")}</span><h2>${esc(label)}</h2></div><span class="column-count">${column.jobs.length}</span></header><div class="workflow-stack">${column.jobs.length?column.jobs.map(r2WorkflowCard).join(""):`<div class="workflow-empty">${tr("No jobs in this phase.","Nincs munka ebben a fázisban.")}</div>`}</div></section>`;
}
function r2BindDrag(root,jobs){
  $$("[data-job-id]",root).forEach(card=>card.addEventListener("dragstart",event=>{event.dataTransfer.setData("text/job-id",card.dataset.jobId);card.classList.add("dragging");}));
  $$("[data-job-id]",root).forEach(card=>card.addEventListener("dragend",()=>card.classList.remove("dragging")));
  $$("[data-drop-stage]",root).forEach(column=>{
    column.addEventListener("dragover",event=>event.preventDefault());
    column.addEventListener("drop",event=>{
      event.preventDefault();const job=jobs.find(item=>String(item.id)===event.dataTransfer.getData("text/job-id"));
      if(!job||job.stage===column.dataset.dropStage)return;
      if(column.dataset.dropStage!==job.next_stage){toast(tr("Move the job only to its next enabled phase.","A munka csak a következő aktív fázisba mozgatható."),"error");return;}
      if(job.next_stage==="completed"){if(r2IsAdmin()&&typeof r3OpenCloseout==="function")r3OpenCloseout(job,renderWorkshop);else toast(tr("Admin closeout is required.","Adminisztrátori lezárás szükséges."),"error");return;}
      r2OpenHandoff(job);
    });
  });
}
function r2OpenStageSettings(){
  if(!r2IsAdmin())return;
  const stages=r2Definitions();
  openDialog({title:tr("Workflow stage names","Munkafázisok elnevezése"),eyebrow:tr("WORKFLOW SETTINGS","MUNKAFOLYAMAT-BEÁLLÍTÁSOK"),body:`<form id="stageSettingsForm" class="stage-settings-form">${stages.map(stage=>`<section class="stage-setting-row" data-stage-key="${stage.key}"><strong>${stage.position}. ${esc(state.language==="hu"?stage.label_hu:stage.label_en)}</strong><label class="field"><span>${tr("English name","Angol név")}</span><input name="en_${stage.key}" value="${esc(stage.label_en)}" required></label><label class="field"><span>${tr("Hungarian name","Magyar név")}</span><input name="hu_${stage.key}" value="${esc(stage.label_hu)}" required></label></section>`).join("")}<div class="form-actions"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save names","Elnevezések mentése")}</button></div></form>`});
  $("#stageSettingsForm").addEventListener("submit",async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget),body={stages:stages.map(stage=>({key:stage.key,label_en:fd.get("en_"+stage.key),label_hu:fd.get("hu_"+stage.key)}))};
    try{await api("/api/workflow/settings",{method:"PUT",body:JSON.stringify(body)});closeDialog();toast(tr("Workflow names updated.","Munkafázisok neve frissítve."),"success");await renderWorkshop();}catch(error){toast(humanError(error),"error");}
  });
}

function r2CalendarTitle(range,mode){
  if(mode==="day")return r2FormatDate(range.startDate,{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  if(mode==="month")return r2FormatDate(state.r2CalendarDate,{year:"numeric",month:"long"});
  return `${r2FormatDate(range.startDate,{month:"short",day:"numeric"})} – ${r2FormatDate(r2DateAdd(range.endDate,-1),{year:"numeric",month:"short",day:"numeric"})}`;
}
function r2EventSegment(job,date){
  const startDate=r2NyDate(job.scheduled_at),endDate=r2NyDate(job.scheduled_end||new Date(new Date(job.scheduled_at).getTime()+Number(job.estimated_duration_min||120)*60000).toISOString());
  if(date<startDate||date>endDate)return null;
  let start=startDate===date?r2TimeMinutes(job.scheduled_at):R2_DAY_START;
  let end=endDate===date?r2TimeMinutes(job.scheduled_end||new Date(new Date(job.scheduled_at).getTime()+Number(job.estimated_duration_min||120)*60000).toISOString()):R2_DAY_END;
  if(endDate!==startDate&&endDate===date&&end===0)end=0;
  start=Math.max(R2_DAY_START,start);end=Math.min(R2_DAY_END,end);
  if(end<=R2_DAY_START||start>=R2_DAY_END||end<=start)return null;
  return {start,end,top:(start-R2_DAY_START)*R2_PX_PER_MIN,height:Math.max(R2_SLOT_HEIGHT,(end-start)*R2_PX_PER_MIN),isStart:startDate===date,isEnd:endDate===date};
}
function r2CalendarEvent(job,date){
  const segment=r2EventSegment(job,date);if(!segment)return "";
  const color=job.assigned_technician_color||"#8d6a2c";
  return `<button type="button" class="calendar-event-block location-${esc(job.location_type)} ${segment.isStart?"segment-start":""} ${segment.isEnd?"segment-end":""}" data-calendar-job="${job.id}" data-calendar-date="${date}" style="--event-top:${segment.top}px;--event-height:${segment.height}px;--tech-color:${esc(color)}">
    <strong>${segment.isStart?esc(new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{timeZone:R2_TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(job.scheduled_at))):"↳"} · ${esc(job.title)}</strong>
    <span>${esc(job.client_name)} · ${esc(job.assigned_technician_name||"—")}</span>
    <small>${esc(r2StageLabel(job.stage))}</small>
    ${segment.isEnd?'<i class="event-resize-handle" data-resize-job aria-hidden="true"></i>':""}
  </button>`;
}
function r2CurrentLine(date){
  if(date!==r2Today())return "";
  const now=r2NyParts(new Date()),minutes=Number(now.hour)*60+Number(now.minute);
  if(minutes<R2_DAY_START||minutes>R2_DAY_END)return "";
  return `<div class="calendar-now-line" data-now-line style="--now-top:${(minutes-R2_DAY_START)*R2_PX_PER_MIN}px"><span></span></div>`;
}
function r2RenderTimeGrid(range,jobs){
  const labels=Array.from({length:14},(_,index)=>7+index);
  return `<div class="time-calendar mode-${state.r2CalendarMode}" style="--calendar-columns:${range.days.length}">
    <div class="time-calendar-scroll">
      <div class="time-calendar-inner" style="--calendar-columns:${range.days.length}">
        <div class="time-calendar-head"><div class="time-gutter-head">NYC</div>${range.days.map(date=>`<button type="button" class="time-day-head" data-new-calendar-job="${date}"><strong>${esc(r2FormatDate(date,{weekday:"short"}))}</strong><span>${esc(r2FormatDate(date,{month:"short",day:"numeric"}))}</span></button>`).join("")}</div>
        <div class="time-calendar-body">
          <div class="time-gutter">${labels.map(hour=>`<span style="top:${(hour*60-R2_DAY_START)*R2_PX_PER_MIN}px">${r2Pad(hour)}:00</span>`).join("")}</div>
          <div class="time-day-columns">${range.days.map(date=>`<section class="time-day-column" data-calendar-date="${date}">${r2CurrentLine(date)}${jobs.map(job=>r2CalendarEvent(job,date)).join("")}</section>`).join("")}</div>
        </div>
      </div>
    </div>
  </div>`;
}
function r2JobTouchesDate(job,date){
  const start=r2NyDate(job.scheduled_at),end=r2NyDate(job.scheduled_end||new Date(new Date(job.scheduled_at).getTime()+Number(job.estimated_duration_min||120)*60000).toISOString());
  return date>=start&&date<=end;
}
function r2RenderMonthGrid(range,jobs){
  const currentMonth=state.r2CalendarDate.slice(0,7);
  const weekdays=Array.from({length:7},(_,i)=>r2DateAdd(r2WeekStart("2026-09-28"),i));
  return `<div class="month-calendar"><div class="month-weekdays">${weekdays.map(date=>`<div>${esc(r2FormatDate(date,{weekday:"short"}))}</div>`).join("")}</div><div class="month-calendar-grid">${range.days.map(date=>{
    const rows=jobs.filter(job=>r2JobTouchesDate(job,date));
    return `<section class="month-day-cell ${date.slice(0,7)===currentMonth?"":"outside-month"} ${date===r2Today()?"today":""}" data-calendar-date="${date}"><header><button type="button" data-new-calendar-job="${date}">${Number(date.slice(-2))}</button></header><div class="month-events">${rows.slice(0,5).map(job=>`<button type="button" class="month-event-pill" data-calendar-job="${job.id}" data-calendar-date="${date}" style="--tech-color:${esc(job.assigned_technician_color||"#8d6a2c")}"><strong>${esc(new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{timeZone:R2_TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(job.scheduled_at)))}</strong> ${esc(job.title)}</button>`).join("")}${rows.length>5?`<small>+${rows.length-5} ${tr("more","további")}</small>`:""}</div></section>`;
  }).join("")}</div></div>`;
}
function r2UpdateCalendarNowLine(){
  $$("[data-now-line]").forEach(line=>{
    const column=line.closest("[data-calendar-date]");if(!column||column.dataset.calendarDate!==r2Today()){line.hidden=true;return;}
    const p=r2NyParts(new Date()),minutes=Number(p.hour)*60+Number(p.minute);
    line.hidden=minutes<R2_DAY_START||minutes>R2_DAY_END;line.style.setProperty("--now-top",`${(minutes-R2_DAY_START)*R2_PX_PER_MIN}px`);
  });
}
async function r2MoveCalendarJob(job,targetDate,targetMinutes=null,newDuration=null){
  let minutes=targetMinutes;
  if(minutes===null){minutes=r2TimeMinutes(job.scheduled_at);}
  minutes=Math.max(0,Math.min(23*60+45,r2SnapMinutes(minutes)));
  const body={scheduled_at:r2NyInputToIso(r2MinutesInput(targetDate,minutes)),estimated_duration_min:Number(newDuration||job.estimated_duration_min||120),assigned_technician_id:job.assigned_technician_id};
  await api(`/api/jobs/${job.id}/schedule`,{method:"PATCH",body:JSON.stringify(body)});
}
function r2BindCalendarPointer(host,jobs){
  let gesture=null;
  function clean(){
    if(!gesture)return;
    clearTimeout(gesture.timer);gesture.ghost?.remove();gesture.tip?.remove();document.body.classList.remove("calendar-drag-active");gesture=null;
  }
  function targetAt(x,y){
    const node=document.elementFromPoint(x,y)?.closest?.("[data-calendar-date]");
    return node||null;
  }
  function activate(event,mode){
    if(!gesture||gesture.active)return;
    gesture.active=true;gesture.mode=mode||gesture.mode;document.body.classList.add("calendar-drag-active");
    gesture.card.classList.add("calendar-source-moving");
    const rect=gesture.card.getBoundingClientRect(),ghost=gesture.card.cloneNode(true);
    ghost.classList.add("calendar-drag-ghost");ghost.style.width=rect.width+"px";ghost.style.height=rect.height+"px";document.body.append(ghost);gesture.ghost=ghost;
    const tip=document.createElement("div");tip.className="calendar-drag-tip";document.body.append(tip);gesture.tip=tip;
    if(navigator.vibrate&&event.pointerType!=="mouse")navigator.vibrate(20);
  }
  function update(event){
    if(!gesture)return;
    const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
    if(!gesture.active&&gesture.pointerType==="mouse"&&Math.hypot(dx,dy)>4)activate(event,gesture.mode);
    if(!gesture.active)return;
    event.preventDefault();
    if(gesture.ghost){gesture.ghost.style.left=`${event.clientX+14}px`;gesture.ghost.style.top=`${event.clientY+14}px`;}
    if(gesture.mode==="resize"){
      const delta=r2SnapMinutes(dy/R2_PX_PER_MIN),duration=Math.max(15,Number(gesture.job.estimated_duration_min||120)+delta);
      gesture.targetDuration=duration;gesture.tip.textContent=`${tr("Duration","Időtartam")}: ${Math.floor(duration/60)}h ${duration%60}m`;
    }else{
      const target=targetAt(event.clientX,event.clientY);if(!target)return;
      gesture.targetDate=target.dataset.calendarDate;
      if(state.r2CalendarMode==="month"){
        gesture.targetMinutes=r2TimeMinutes(gesture.job.scheduled_at);
      }else{
        const rect=target.getBoundingClientRect(),minute=R2_DAY_START+r2SnapMinutes((event.clientY-rect.top)/R2_PX_PER_MIN);
        gesture.targetMinutes=Math.max(R2_DAY_START,Math.min(R2_DAY_END-R2_SLOT_MIN,minute));
      }
      gesture.tip.textContent=`${r2FormatDate(gesture.targetDate,{month:"short",day:"numeric"})} · ${r2Pad(Math.floor(gesture.targetMinutes/60))}:${r2Pad(gesture.targetMinutes%60)}`;
    }
    gesture.tip.style.left=`${event.clientX+20}px`;gesture.tip.style.top=`${event.clientY+20}px`;
  }
  async function finish(event){
    if(!gesture)return;
    const current=gesture;clearTimeout(current.timer);
    current.card.classList.remove("calendar-source-moving");
    if(!current.active){clean();const job=current.job;if(event.type==="pointerup")r2OpenSchedule(job);return;}
    try{
      if(current.mode==="resize")await r2MoveCalendarJob(current.job,r2NyDate(current.job.scheduled_at),r2TimeMinutes(current.job.scheduled_at),current.targetDuration||current.job.estimated_duration_min);
      else if(current.targetDate)await r2MoveCalendarJob(current.job,current.targetDate,current.targetMinutes);
      toast(current.mode==="resize"?tr("Duration updated.","Időtartam frissítve."):tr("Job moved in the calendar.","Munka áthelyezve a naptárban."),"success");
    }catch(error){toast(humanError(error),"error");}
    clean();await r2RenderCalendar(state.r2Workflow?.jobs||[]);
  }
  $$("[data-calendar-job]",host).forEach(card=>{
    card.addEventListener("pointerdown",event=>{
      if(event.button!==undefined&&event.button!==0)return;
      const job=jobs.find(row=>String(row.id)===String(card.dataset.calendarJob));if(!job||job.stage==="completed")return;
      const resize=Boolean(event.target.closest("[data-resize-job]"));
      gesture={card,job,startX:event.clientX,startY:event.clientY,pointerType:event.pointerType,active:false,mode:resize?"resize":"move",timer:null,targetDate:null,targetMinutes:null,targetDuration:null,ghost:null,tip:null};
      if(resize||event.pointerType==="mouse"){if(resize)activate(event,"resize");}
      else gesture.timer=setTimeout(()=>activate(event,"move"),1500);
      card.setPointerCapture?.(event.pointerId);
    });
    card.addEventListener("pointermove",update,{passive:false});
    card.addEventListener("pointerup",finish);
    card.addEventListener("pointercancel",()=>{gesture?.card?.classList.remove("calendar-source-moving");clean();});
  });
}
function r2BindCalendarCreate(host){
  $$("[data-calendar-date]",host).forEach(column=>column.addEventListener("click",event=>{
    if(event.target.closest("[data-calendar-job],[data-new-calendar-job],.calendar-now-line"))return;
    const date=column.dataset.calendarDate;if(!date)return;
    if(state.r2CalendarMode==="month"){r2OpenCreateJob(renderWorkshop,{date});return;}
    const rect=column.getBoundingClientRect();
    const minutes=Math.max(R2_DAY_START,Math.min(R2_DAY_END-R2_SLOT_MIN,R2_DAY_START+r2SnapMinutes((event.clientY-rect.top)/R2_PX_PER_MIN)));
    r2OpenCreateJob(renderWorkshop,{date,datetime:r2MinutesInput(date,minutes)});
  }));
}
async function r2RenderCalendar(){
  const host=$("#workshopContent");if(!host)return;
  state.r2CalendarMode=state.r2CalendarMode||localStorage.getItem("kh_calendar_mode")||"week";
  if(!["day","week","month"].includes(state.r2CalendarMode))state.r2CalendarMode="week";
  state.r2CalendarDate=state.r2CalendarDate||r2Today();
  const range=r2Range(state.r2CalendarDate,state.r2CalendarMode),tech=state.r2CalendarTech||"";
  const data=await api(`/api/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}${tech?`&technician_id=${encodeURIComponent(tech)}`:""}`);
  host.innerHTML=`<section class="panel calendar-panel"><div class="calendar-toolbar"><div class="calendar-nav"><button id="calendarPrev" class="secondary-button" type="button" aria-label="${tr("Previous","Előző")}">←</button><button id="calendarToday" class="secondary-button" type="button">${tr("Today","Ma")}</button><button id="calendarNext" class="secondary-button" type="button" aria-label="${tr("Next","Következő")}">→</button></div>
    <strong class="calendar-range-title">${esc(r2CalendarTitle(range,state.r2CalendarMode))}</strong>
    <div class="calendar-toolbar-right"><div class="segmented-control compact"><button type="button" data-calendar-mode="day" class="${state.r2CalendarMode==="day"?"active":""}">${tr("Day","Nap")}</button><button type="button" data-calendar-mode="week" class="${state.r2CalendarMode==="week"?"active":""}">${tr("Week","Hét")}</button><button type="button" data-calendar-mode="month" class="${state.r2CalendarMode==="month"?"active":""}">${tr("Month","Hónap")}</button></div><select id="calendarTechFilter"><option value="">${tr("All technicians","Minden technikus")}</option>${r2TechnicianOptions(tech)}</select></div></div>
    <div class="calendar-drag-help">${tr("Desktop: drag events to another time/day and resize from the lower edge. Mobile: press and hold for 1.5 seconds, then drag.","Asztali gépen húzd az eseményt másik időpontra/napra, az alsó élén pedig méretezheted. Mobilon tartsd nyomva 1,5 másodpercig, majd húzd át.")}</div>
    ${state.r2CalendarMode==="month"?r2RenderMonthGrid(range,data.jobs||[]):r2RenderTimeGrid(range,data.jobs||[])}
  </section>`;
  const move=delta=>{state.r2CalendarDate=state.r2CalendarMode==="month"?r2MonthAdd(state.r2CalendarDate,delta):r2DateAdd(range.startDate,state.r2CalendarMode==="day"?delta:delta*7);void r2RenderCalendar();};
  $("#calendarPrev").addEventListener("click",()=>move(-1));$("#calendarToday").addEventListener("click",()=>{state.r2CalendarDate=r2Today();void r2RenderCalendar();});$("#calendarNext").addEventListener("click",()=>move(1));
  $$("[data-calendar-mode]",host).forEach(button=>button.addEventListener("click",()=>{state.r2CalendarMode=button.dataset.calendarMode;localStorage.setItem("kh_calendar_mode",state.r2CalendarMode);void r2RenderCalendar();}));
  $("#calendarTechFilter").addEventListener("change",event=>{state.r2CalendarTech=event.target.value;void r2RenderCalendar();});
  $$("[data-new-calendar-job]",host).forEach(button=>button.addEventListener("click",event=>{event.stopPropagation();r2OpenCreateJob(renderWorkshop,{date:button.dataset.newCalendarJob});}));
  r2BindCalendarPointer(host,data.jobs||[]);r2BindCalendarCreate(host);r2UpdateCalendarNowLine();
  clearInterval(state.r2NowTimer);state.r2NowTimer=setInterval(r2UpdateCalendarNowLine,30000);
}
async function r2RenderWorkflow(data){
  const host=$("#workshopContent");if(!host)return;
  host.innerHTML=`<div class="workflow-scroll"><div id="workflowBoard" class="workflow-board">${(data.columns||[]).map(r2WorkflowColumn).join("")}</div></div>`;
  const board=$("#workflowBoard");r2BindWorkflowActions(board,data.jobs||[]);r2BindDrag(board,data.jobs||[]);
}
function r2OverviewRows(key,overview){
  const rows=overview?.details?.[key]||[];
  if(!rows.length)return `<div class="empty-state">${tr("No records in this category.","Nincs tétel ebben a kategóriában.")}</div>`;
  return `<div class="overview-table-wrap"><table class="overview-table"><thead><tr><th>${tr("Job","Munka")}</th><th>${tr("Client / Piano","Ügyfél / Zongora")}</th><th>${tr("Phase","Fázis")}</th><th>${tr("Responsible","Felelős")}</th><th>${tr("Schedule / Due","Időpont / Határidő")}</th><th>${tr("Financial","Pénzügy")}</th><th>${tr("Issue","Probléma")}</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${esc(row.job_code||("#"+row.id))}</strong><small>${esc(row.title)}</small></td><td>${esc(row.client_name)}<small>${esc(r2JobPiano(row))}</small></td><td>${esc(r2StageLabel(row.stage))}</td><td>${esc(row.assigned_technician_name||"—")}</td><td>${esc(r2FormatDateTime(row.scheduled_at))}<small>${row.current_phase?.due_at?esc(r2FormatDateTime(row.current_phase.due_at)):"—"}</small></td><td>${esc(r2Money(row.financial_total??(Number(row.total_labor_cost||0)+Number(row.total_material_cost||0))))}</td><td>${row.invoice_issue?esc(row.invoice_issue==="awaiting_closeout"?tr("Waiting for admin closeout","Admin lezárásra vár"):row.invoice_issue==="invoice_draft"?tr("Invoice draft not sent","Piszkozat számla nincs kiküldve"):tr("Sent invoice open","Kiküldött számla nyitott")):esc(r2BlockerLabel(row.current_phase?.blocker_code))}</td></tr>`).join("")}</tbody></table></div>`;
}
function r2OpenOverview(key,overview){
  const labels={
    active_workflows:[tr("Active workflows","Aktív munkafolyamatok"),tr("ACTIVITY","AKTIVITÁS")],
    overdue_workflows:[tr("Overdue / stuck workflows","Lejárt / elakadt munkafolyamatok"),tr("ATTENTION","FIGYELMET IGÉNYEL")],
    active_financial:[tr("Active work financial volume","Aktív munkák pénzügyi volumene"),tr("FINANCE","PÉNZÜGY")],
    open_invoice_actions:[tr("Open invoice actions","Folyamatban lévő számlák"),tr("INVOICING","SZÁMLÁZÁS")]
  };
  openDialog({title:labels[key]?.[0]||tr("Workshop details","Műhely részletei"),eyebrow:labels[key]?.[1]||"WORKSHOP",body:r2OverviewRows(key,overview)});
}
async function renderWorkshop(){
  const workspace=$("#workspace"),[data,overview]=await Promise.all([api("/api/jobs/workflow"),api("/api/workshop/overview"),loadUsers()]);
  state.r2Workflow=data;state.r2Overview=overview;state.r2WorkshopMode=state.r2WorkshopMode||localStorage.getItem("kh_workshop_mode")||"calendar";
  workspace.innerHTML=pageHead(tr("Workshop & Calendar","Műhely és naptár"),tr("Operational control center for calendar, workflow, deadlines and financial follow-up.","Operatív vezérlőpult naptárhoz, munkafolyamathoz, határidőkhöz és pénzügyi utánkövetéshez."),
    `<button id="workshopNewJob" class="primary-button" type="button">＋ ${tr("New job","Új munka")}</button>${r2IsAdmin()?`<button id="workflowSettingsBtn" class="secondary-button" type="button">⚙ ${tr("Workflow names","Fázisnevek")}</button>`:""}`)+
    `<div class="workshop-kpis">
      <button class="workshop-kpi" type="button" data-overview-key="active_workflows"><span>${tr("Active workflows","Aktív munkafolyamatok")}</span><strong>${Number(overview.kpis.active_workflows||0)}</strong><small>${tr("currently running","jelenleg fut")}</small></button>
      <button class="workshop-kpi attention" type="button" data-overview-key="overdue_workflows"><span>${tr("Overdue / stuck","Lejárt / elakadt")}</span><strong>${Number(overview.kpis.overdue_workflows||0)}</strong><small>${tr("needs attention","beavatkozást igényel")}</small></button>
      <button class="workshop-kpi finance" type="button" data-overview-key="active_financial"><span>${tr("Active financial volume","Aktív pénzügyi volumen")}</span><strong>${esc(r2Money(overview.kpis.active_financial_total))}</strong><small>${tr("labor + materials","munka + anyag")}</small></button>
      <button class="workshop-kpi invoice" type="button" data-overview-key="open_invoice_actions"><span>${tr("Open invoice actions","Folyamatban lévő számlák")}</span><strong>${Number(overview.kpis.open_invoice_actions||0)}</strong><small>${tr("closeout / draft / sent","lezárás / piszkozat / kiküldött")}</small></button>
    </div>
    <div class="workshop-master-switch"><div class="segmented-control large"><button type="button" data-workshop-mode="calendar" class="${state.r2WorkshopMode==="calendar"?"active":""}">📅 ${tr("Calendar","Naptár")}</button><button type="button" data-workshop-mode="workflow" class="${state.r2WorkshopMode==="workflow"?"active":""}">📋 ${tr("Workflow","Munkafolyamat")}</button></div></div><div id="workshopContent">${loading()}</div>`;
  $("#workshopNewJob").addEventListener("click",()=>r2OpenCreateJob(renderWorkshop,{date:state.r2WorkshopMode==="calendar"?state.r2CalendarDate||r2Today():null}));
  $("#workflowSettingsBtn")?.addEventListener("click",r2OpenStageSettings);
  $$("[data-overview-key]").forEach(button=>button.addEventListener("click",()=>r2OpenOverview(button.dataset.overviewKey,overview)));
  $$("[data-workshop-mode]").forEach(button=>button.addEventListener("click",async()=>{
    state.r2WorkshopMode=button.dataset.workshopMode;localStorage.setItem("kh_workshop_mode",state.r2WorkshopMode);
    $$("[data-workshop-mode]").forEach(item=>item.classList.toggle("active",item===button));
    if(state.r2WorkshopMode==="calendar")await r2RenderCalendar();else await r2RenderWorkflow(data);
  }));
  if(state.r2WorkshopMode==="calendar")await r2RenderCalendar();else await r2RenderWorkflow(data);
}
// Finance extension starts boot() after registering closeout behavior.
