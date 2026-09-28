"use strict";

const R2_STAGES=[
  {key:"received",en:"Received / Scheduled",hu:"Beérkezett / Ütemezve"},
  {key:"in_progress",en:"In Progress",hu:"Folyamatban"},
  {key:"qa_review",en:"QA / Handoff",hu:"Minőségellenőrzés / Átadás"},
  {key:"admin_approval",en:"Admin Approval",hu:"Admin Jóváhagyás"},
  {key:"completed",en:"Completed",hu:"Lezárva"}
];
const R2_TZ="America/New_York";
const r2IsAdmin=()=>["ADMIN","SUPERADMIN"].includes(state.user?.role);

function r2StageLabel(stage){const row=R2_STAGES.find(item=>item.key===stage);return row?tr(row.en,row.hu):stage||"";}
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
function r2WeekStart(dateString){const d=new Date(dateString+"T12:00:00Z"),offset=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-offset);return d.toISOString().slice(0,10);}
function r2Range(anchor,mode){
  const date=anchor||r2Today();
  if(mode==="day"){const next=r2DateAdd(date,1);return {startDate:date,endDate:next,days:[date],from:r2NyInputToIso(date+"T00:00"),to:r2NyInputToIso(next+"T00:00")};}
  const start=r2WeekStart(date),end=r2DateAdd(start,7);return {startDate:start,endDate:end,days:Array.from({length:7},(_,i)=>r2DateAdd(start,i)),from:r2NyInputToIso(start+"T00:00"),to:r2NyInputToIso(end+"T00:00")};
}
function r2FormatDateTime(value){
  if(!value)return tr("Not scheduled","Nincs ütemezve");
  return new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{timeZone:R2_TZ,month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
}
function r2DefaultInput(dateKey=null){
  if(dateKey)return dateKey+"T09:00";
  const date=new Date(Date.now()+60*60000);date.setMinutes(Math.ceil(date.getMinutes()/15)*15,0,0);return r2IsoToNyInput(date);
}
function r2TechnicianOptions(selected=""){
  return (state.users||[]).filter(user=>["WORKER","MANAGER","ADMIN"].includes(user.role)).map(user=>`<option value="${esc(user.id)}" ${String(user.id)===String(selected||"")?"selected":""}>${esc(user.name)} · ${esc(roleLabel(user.role))}</option>`).join("");
}
function r2JobPiano(job){return [job.piano_brand,job.piano_model,job.piano_serial_number].filter(Boolean).join(" · ");}

function r2PlannedCard(job){
  return `<article class="job-card planned-card" data-job-id="${job.id}">
    <div class="job-card-top"><span class="job-code">${esc(job.job_code||("#"+job.id))}</span><span class="priority-chip">${tr("PLANNED","TERVEZETT")}</span></div>
    <h3>${esc(job.title)}</h3><p class="job-party">${esc(job.client_name)} · ${esc(r2JobPiano(job))}</p>
    ${job.description?`<p class="job-description">${esc(job.description)}</p>`:""}
    <div class="job-meta"><span>👤 ${esc(job.assigned_technician_name||tr("Unassigned","Nincs technikus"))}</span><span>⏱ ${Number(job.estimated_duration_min||120)} min</span><span>${job.location_type==="on_site"?"⌂ "+tr("On site","Helyszíni"):"♬ "+tr("Workshop","Műhely")}</span></div>
    <div class="job-actions"><button class="primary-button" type="button" data-activate-job="${job.id}">${tr("Activate & Schedule","Aktiválás és ütemezés")}</button><button class="text-button" type="button" data-edit-job="${job.id}">${tr("Edit","Szerkesztés")}</button>${r2IsAdmin()?`<button class="danger-button" type="button" data-cancel-job="${job.id}">${tr("Cancel","Megszakítás")}</button>`:""}</div>
  </article>`;
}
async function renderPlanned(){
  const workspace=$("#workspace"),[jobs]=await Promise.all([api("/api/jobs/pipeline"),loadUsers(),loadClients()]);
  state.r2Planned=jobs;
  workspace.innerHTML=pageHead(tr("Planned Jobs","Tervezett munkák"),tr("Negotiation and unscheduled work stays outside the active workshop until you activate it.","A tárgyalás alatt álló, ütemezetlen munka nem kerül az aktív műhelybe, amíg nem aktiválod."),
    `<button id="newPlannedBtn" class="primary-button" type="button">＋ ${tr("New Planned Job","Új tervezett munka")}</button>`)+
    `<div class="stats-grid"><div class="stat-card"><small>${tr("Pipeline","Pipeline")}</small><strong>${jobs.length}</strong></div><div class="stat-card"><small>${tr("Unassigned","Nincs kiosztva")}</small><strong>${jobs.filter(job=>!job.assigned_technician_id).length}</strong></div><div class="stat-card"><small>${tr("On site","Helyszíni")}</small><strong>${jobs.filter(job=>job.location_type==="on_site").length}</strong></div><div class="stat-card"><small>${tr("Workshop","Műhely")}</small><strong>${jobs.filter(job=>job.location_type==="workshop").length}</strong></div></div>
    <div class="planned-toolbar"><div class="search-field"><input id="plannedSearch" type="search" placeholder="${tr("Search job, client or piano…","Keresés munka, ügyfél vagy zongora alapján…")}"></div><button id="openWorkshopBtn" class="secondary-button" type="button">${tr("Workshop & Calendar","Műhely & Naptár")} →</button></div>
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
  $$("[data-cancel-job]",host).forEach(button=>button.addEventListener("click",()=>r2OpenCancel(jobs.find(job=>Number(job.id)===Number(button.dataset.cancelJob)),renderPlanned)));
}
async function r2OpenCreateJob(refresh=renderPlanned,defaults={}){
  const [clients]=await Promise.all([loadClients(),loadUsers()]);
  if(!clients.length){toast(tr("Create a client and piano first.","Előbb hozz létre ügyfelet és zongorát."),"error");return;}
  const scheduled=Boolean(defaults.date);
  openDialog({title:scheduled?tr("New scheduled job","Új ütemezett munka"):tr("New Planned Job","Új tervezett munka"),eyebrow:scheduled?"CALENDAR":"PIPELINE",body:`<form id="jobCreateForm" class="form-grid">
    <label class="field"><span>${tr("Client","Ügyfél")} *</span><select id="jobClientSelect" name="client_id" required>${clients.map(client=>`<option value="${client.id}">${esc(client.name)}</option>`).join("")}</select></label>
    <label class="field"><span>${tr("Piano","Zongora")} *</span><select id="jobPianoSelect" name="piano_id" required></select></label>
    <label class="field full"><span>${tr("Job title","Munka megnevezése")} *</span><input name="title" required autofocus></label>
    <label class="field full"><span>${tr("Description","Leírás")}</span><textarea name="description"></textarea></label>
    <label class="field"><span>${tr("Location","Helyszín")}</span><select name="location_type"><option value="workshop">${tr("Workshop","Műhely")}</option><option value="on_site">${tr("On site","Helyszíni")}</option></select></label>
    <label class="field"><span>${tr("Duration","Időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="120"></label>
    <label class="field full"><span>${tr("Service address","Szervizcím")}</span><input name="site_address"></label>
    ${scheduled?`<label class="field"><span>${tr("Start · New York","Kezdés · New York")} *</span><input name="scheduled_at" type="datetime-local" step="900" value="${esc(r2DefaultInput(defaults.date))}" required></label><label class="field"><span>${tr("Technician","Technikus")} *</span><select name="assigned_technician_id" required><option value="">${tr("Choose technician","Válassz technikust")}</option>${r2TechnicianOptions("")}</select></label>`:""}
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${scheduled?tr("Create & schedule","Létrehozás és ütemezés"):tr("Create Planned Job","Tervezett munka létrehozása")}</button></div>
  </form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  async function loadPianos(){
    const id=$("#jobClientSelect").value,pianos=await api(`/api/clients/${id}/pianos`);
    $("#jobPianoSelect").innerHTML=pianos.length?pianos.map(piano=>`<option value="${piano.id}">${esc([piano.brand,piano.model,piano.serial_number].filter(Boolean).join(" · "))}</option>`).join(""):`<option value="">${tr("No piano — add one in Master Data","Nincs zongora — add hozzá a Törzsadatokban")}</option>`;
    $("#jobPianoSelect").disabled=!pianos.length;
  }
  $("#jobClientSelect").addEventListener("change",()=>loadPianos().catch(error=>toast(humanError(error),"error")));await loadPianos();
  $("#jobCreateForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.client_id=Number(body.client_id);body.piano_id=Number(body.piano_id);body.estimated_duration_min=Number(body.estimated_duration_min||120);
    if(scheduled)body.scheduled_at=r2NyInputToIso(body.scheduled_at);if(!body.assigned_technician_id)delete body.assigned_technician_id;
    try{await api("/api/jobs",{method:"POST",body:JSON.stringify(body)});closeDialog();toast(scheduled?tr("Job added to the active calendar.","Munka bekerült az aktív naptárba."):tr("Planned Job created.","Tervezett munka létrehozva."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
async function r2OpenActivate(job){
  if(!state.users?.length)await loadUsers();
  openDialog({title:tr("Activate & Schedule","Aktiválás és ütemezés"),eyebrow:job.job_code||"PIPELINE",body:`<form id="activateJobForm" class="form-grid">
    <div class="detail-note full"><strong>${esc(job.title)}</strong><br>${esc(job.client_name+" · "+r2JobPiano(job))}</div>
    <label class="field full"><span>${tr("Technician","Technikus")} *</span><select name="assigned_technician_id" required><option value="">${tr("Choose technician","Válassz technikust")}</option>${r2TechnicianOptions(job.assigned_technician_id)}</select></label>
    <label class="field"><span>${tr("Start · New York","Kezdés · New York")} *</span><input name="scheduled_at" type="datetime-local" step="900" value="${r2DefaultInput()}" required></label>
    <label class="field"><span>${tr("Duration","Időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="${Number(job.estimated_duration_min||120)}"></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Activate","Aktiválás")}</button></div></form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#activateJobForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.scheduled_at=r2NyInputToIso(body.scheduled_at);body.estimated_duration_min=Number(body.estimated_duration_min||120);
    try{await api(`/api/jobs/activate/${job.id}`,{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Job activated and scheduled.","Munka aktiválva és ütemezve."),"success");navTo("workshop");}
    catch(error){toast(error.payload?.conflict?tr("Schedule conflict with ","Ütemezési ütközés: ")+(error.payload.conflict.job_code||error.payload.conflict.title):humanError(error),"error");}
  });
}
async function r2OpenEditJob(job,refresh){
  if(!state.users?.length)await loadUsers();
  openDialog({title:tr("Edit job","Munka szerkesztése"),eyebrow:job.job_code||"JOB",body:`<form id="jobEditForm" class="form-grid">
    <label class="field full"><span>${tr("Title","Megnevezés")} *</span><input name="title" value="${esc(job.title)}" required></label>
    <label class="field full"><span>${tr("Description","Leírás")}</span><textarea name="description">${esc(job.description||"")}</textarea></label>
    <label class="field"><span>${tr("Location","Helyszín")}</span><select name="location_type"><option value="workshop" ${job.location_type==="workshop"?"selected":""}>${tr("Workshop","Műhely")}</option><option value="on_site" ${job.location_type==="on_site"?"selected":""}>${tr("On site","Helyszíni")}</option></select></label>
    <label class="field"><span>${tr("Duration","Időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="${Number(job.estimated_duration_min||120)}"></label>
    <label class="field full"><span>${tr("Technician","Technikus")}</span><select name="assigned_technician_id"><option value="">${tr("Unassigned","Nincs kiosztva")}</option>${r2TechnicianOptions(job.assigned_technician_id)}</select></label>
    <label class="field full"><span>${tr("Internal notes","Belső megjegyzés")}</span><textarea name="internal_notes">${esc(job.internal_notes||"")}</textarea></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save","Mentés")}</button></div></form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#jobEditForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.estimated_duration_min=Number(body.estimated_duration_min||120);if(!body.assigned_technician_id)body.assigned_technician_id="";
    try{await api(`/api/jobs/${job.id}`,{method:"PUT",body:JSON.stringify(body)});closeDialog();toast(tr("Job updated.","Munka frissítve."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
async function r2OpenSchedule(job,refresh=renderWorkshop){
  if(!state.users?.length)await loadUsers();
  openDialog({title:tr("Schedule job","Munka ütemezése"),eyebrow:job.job_code||"CALENDAR",body:`<form id="scheduleJobForm" class="form-grid">
    <div class="detail-note full"><strong>${esc(job.title)}</strong><br>${esc(job.client_name+" · "+r2JobPiano(job))}</div>
    <label class="field full"><span>${tr("Technician","Technikus")} *</span><select name="assigned_technician_id" required><option value="">${tr("Choose technician","Válassz technikust")}</option>${r2TechnicianOptions(job.assigned_technician_id)}</select></label>
    <label class="field"><span>${tr("Start · New York","Kezdés · New York")} *</span><input name="scheduled_at" type="datetime-local" step="900" value="${esc(job.scheduled_at?r2IsoToNyInput(job.scheduled_at):r2DefaultInput())}" required></label>
    <label class="field"><span>${tr("Duration","Időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="${Number(job.estimated_duration_min||120)}"></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save schedule","Ütemezés mentése")}</button></div></form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#scheduleJobForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.scheduled_at=r2NyInputToIso(body.scheduled_at);body.estimated_duration_min=Number(body.estimated_duration_min||120);
    try{await api(`/api/jobs/${job.id}/schedule`,{method:"PATCH",body:JSON.stringify(body)});closeDialog();toast(tr("Schedule updated.","Ütemezés frissítve."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r2OpenHandoff(job,refresh=renderWorkshop){
  const next=job.stage==="received"?"in_progress":job.stage==="in_progress"?"qa_review":job.stage==="qa_review"?"admin_approval":null;
  if(!next){toast(tr("This phase must be closed by Admin.","Ezt a fázist Admin zárja le."),"error");return;}
  openDialog({title:tr("Complete Phase / Handoff","Fázis lezárása / Átadás"),eyebrow:`${r2StageLabel(job.stage)} → ${r2StageLabel(next)}`,body:`<form id="handoffForm" class="form-grid">
    <div class="detail-note full">${tr("All fields below are optional. If you do not choose the next responsible person, the current technician continues automatically.","Az alábbi mezők mind opcionálisak. Ha nem jelölsz ki következő felelőst, automatikusan a jelenlegi technikus viszi tovább.")}</div>
    <label class="field"><span>${tr("Labor / daily fee","Munkadíj / napi díj")} (USD)</span><input name="phase_labor_cost" type="number" min="0" step="0.01" value="0"></label>
    <label class="field"><span>${tr("Material cost","Anyagköltség")} (USD)</span><input name="phase_material_cost" type="number" min="0" step="0.01" value="0"></label>
    <label class="field full"><span>${tr("Internal handoff note","Belső átadási jegyzet")}</span><textarea name="phase_note"></textarea></label>
    <label class="field full"><span>${tr("Next responsible","Következő felelős")}</span><select name="assigned_to_user_id"><option value="">${tr("Keep current technician","Jelenlegi technikus marad")}</option>${r2TechnicianOptions("")}</select></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Complete phase","Fázis lezárása")}</button></div></form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#handoffForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.phase_labor_cost=Number(body.phase_labor_cost||0);body.phase_material_cost=Number(body.phase_material_cost||0);if(!body.assigned_to_user_id)delete body.assigned_to_user_id;
    try{await api(`/api/jobs/${job.id}/handoff`,{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Phase completed.","Fázis lezárva."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r2OpenCancel(job,refresh=renderWorkshop){
  openDialog({title:tr("Cancel workflow","Munkafolyamat megszakítása"),eyebrow:job.job_code||"ADMIN",body:`<form id="cancelJobForm" class="form-grid">
    <div class="detail-note full">${tr("The job will disappear from the active calendar and workflow. Recorded labor/material remains as an incurred cost. The closing Admin is stored in the audit history.","A munka eltűnik az aktív naptárból és workflow-ból. A már rögzített költségek megmaradnak költségként, a lezáró Admin neve pedig auditálva lesz.")}</div>
    <label class="field"><span>${tr("Initiated by","Kezdeményező")}</span><select name="party"><option value="client">${tr("Client","Ügyfél")}</option><option value="klavierhaus">Klavierhaus</option><option value="other">${tr("Other","Egyéb")}</option></select></label>
    <label class="field full"><span>${tr("Reason","Ok")} *</span><textarea name="reason" required></textarea></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Back","Vissza")}</button><button class="danger-button" type="submit">${tr("Cancel workflow","Munkafolyamat megszakítása")}</button></div></form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#cancelJobForm").addEventListener("submit",async event=>{
    event.preventDefault();try{await api(`/api/jobs/${job.id}/cancel`,{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast(tr("Workflow cancelled.","Munkafolyamat megszakítva."),"success");await refresh();}catch(error){toast(humanError(error),"error");}
  });
}

function r2WorkflowCard(job){
  const completed=job.stage==="completed";
  return `<article class="job-card stage-card" draggable="${!completed}" data-job-id="${job.id}">
    <div class="job-card-top"><span class="job-code">${esc(job.job_code||("#"+job.id))}</span><span class="priority-chip">${esc(r2StageLabel(job.stage))}</span></div>
    <h3>${esc(job.title)}</h3><p class="job-party">${esc(job.client_name)} · ${esc(r2JobPiano(job))}</p>
    <div class="job-meta"><span>👤 ${esc(job.assigned_technician_name||tr("Unassigned","Nincs felelős"))}</span><span>🕒 ${esc(r2FormatDateTime(job.scheduled_at))}</span><span>💵 ${Number(job.total_labor_cost||0).toFixed(2)} · 🧰 ${Number(job.total_material_cost||0).toFixed(2)}</span></div>
    ${completed?`<div class="completed-note">✓ ${tr("Closed by","Lezárta")}: ${esc(job.completed_by_name||"Admin")}</div>`:""}
    <div class="job-actions">${!completed&&job.stage!=="admin_approval"?`<button class="primary-button" type="button" data-handoff-job="${job.id}">${tr("Complete Phase / Handoff","Fázis lezárása / Átadás")}</button>`:""}
      ${!completed&&job.stage==="admin_approval"&&r2IsAdmin()?`<button class="primary-button" type="button" data-closeout-job="${job.id}">${tr("Complete & Invoice","Lezárás és számla")}</button>`:""}
      ${!completed?`<button class="text-button" type="button" data-schedule-job="${job.id}">${tr("Schedule","Ütemezés")}</button>`:""}
      ${!completed&&r2IsAdmin()?`<button class="danger-button" type="button" data-cancel-job="${job.id}">${tr("Cancel","Megszakítás")}</button>`:""}
    </div></article>`;
}
function r2BindWorkflowActions(root,jobs){
  $$("[data-handoff-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenHandoff(jobs.find(job=>Number(job.id)===Number(button.dataset.handoffJob)))));
  $$("[data-schedule-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenSchedule(jobs.find(job=>Number(job.id)===Number(button.dataset.scheduleJob)))));
  $$("[data-cancel-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenCancel(jobs.find(job=>Number(job.id)===Number(button.dataset.cancelJob)))));
  $$("[data-closeout-job]",root).forEach(button=>button.addEventListener("click",()=>{const job=jobs.find(item=>Number(item.id)===Number(button.dataset.closeoutJob));if(typeof r3OpenCloseout==="function")r3OpenCloseout(job,renderWorkshop);}));
}
function r2WorkflowColumn(column){
  const label=state.language==="hu"?column.label_hu:column.label_en;
  return `<section class="workflow-column stage-${column.key}" data-drop-stage="${column.key}"><header><div><span class="eyebrow">WORKFLOW</span><h2>${esc(label)}</h2></div><span class="column-count">${column.jobs.length}</span></header><div class="workflow-stack">${column.jobs.length?column.jobs.map(r2WorkflowCard).join(""):`<div class="workflow-empty">${tr("No jobs in this phase.","Nincs munka ebben a fázisban.")}</div>`}</div></section>`;
}
function r2BindDrag(root,jobs){
  $$("[data-job-id]",root).forEach(card=>card.addEventListener("dragstart",event=>{event.dataTransfer.setData("text/job-id",card.dataset.jobId);card.classList.add("dragging");}));
  $$("[data-job-id]",root).forEach(card=>card.addEventListener("dragend",()=>card.classList.remove("dragging")));
  $$("[data-drop-stage]",root).forEach(column=>{
    column.addEventListener("dragover",event=>event.preventDefault());
    column.addEventListener("drop",event=>{
      event.preventDefault();const job=jobs.find(item=>String(item.id)===event.dataTransfer.getData("text/job-id"));
      if(!job||job.stage===column.dataset.dropStage)return;
      const next=job.stage==="received"?"in_progress":job.stage==="in_progress"?"qa_review":job.stage==="qa_review"?"admin_approval":null;
      if(column.dataset.dropStage!==next){toast(tr("Jobs move forward one phase at a time.","A munka egyszerre egy fázissal léptethető tovább."),"error");return;}
      r2OpenHandoff(job);
    });
  });
}
function r2CalendarJob(job){
  return `<button type="button" class="calendar-job location-${esc(job.location_type)}" data-calendar-job="${job.id}"><strong>${esc(new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{timeZone:R2_TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(job.scheduled_at)))}</strong><span>${esc(job.title)}</span><small>${esc(job.client_name)} · ${esc(job.assigned_technician_name||"—")}</small></button>`;
}
function r2CalendarDay(date,jobs){
  const dateObj=new Date(date+"T12:00:00Z"),weekday=new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{weekday:"short"}).format(dateObj),label=new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{month:"short",day:"numeric"}).format(dateObj);
  const rows=jobs.filter(job=>r2NyDate(job.scheduled_at)===date);
  return `<section class="calendar-day"><header><div><strong>${esc(weekday)}</strong><span>${esc(label)}</span></div><button class="icon-button" type="button" data-new-calendar-job="${date}" aria-label="${tr("New job","Új munka")}">＋</button></header><div class="calendar-day-body">${rows.length?rows.map(r2CalendarJob).join(""):`<div class="calendar-empty">${tr("No jobs","Nincs munka")}</div>`}</div></section>`;
}
async function r2RenderCalendar(jobsFromWorkflow){
  const host=$("#workshopContent");if(!host)return;
  state.r2CalendarMode=state.r2CalendarMode||localStorage.getItem("kh_calendar_mode")||"week";
  state.r2CalendarDate=state.r2CalendarDate||r2Today();
  const range=r2Range(state.r2CalendarDate,state.r2CalendarMode),tech=state.r2CalendarTech||"";
  const data=await api(`/api/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}${tech?`&technician_id=${encodeURIComponent(tech)}`:""}`);
  host.innerHTML=`<div class="calendar-toolbar"><div class="calendar-nav"><button id="calendarPrev" class="secondary-button" type="button">←</button><button id="calendarToday" class="secondary-button" type="button">${tr("Today","Ma")}</button><button id="calendarNext" class="secondary-button" type="button">→</button></div>
    <div class="segmented-control compact"><button type="button" data-calendar-mode="day" class="${state.r2CalendarMode==="day"?"active":""}">${tr("Day","Nap")}</button><button type="button" data-calendar-mode="week" class="${state.r2CalendarMode==="week"?"active":""}">${tr("Week","Hét")}</button></div>
    <select id="calendarTechFilter"><option value="">${tr("All technicians","Minden technikus")}</option>${r2TechnicianOptions(tech)}</select></div>
    <div class="calendar-scroll"><div class="calendar-grid ${state.r2CalendarMode==="day"?"day-mode":""}">${range.days.map(date=>r2CalendarDay(date,data.jobs||[])).join("")}</div></div>`;
  $("#calendarPrev").addEventListener("click",()=>{state.r2CalendarDate=r2DateAdd(range.startDate,state.r2CalendarMode==="day"?-1:-7);void r2RenderCalendar(jobsFromWorkflow);});
  $("#calendarToday").addEventListener("click",()=>{state.r2CalendarDate=r2Today();void r2RenderCalendar(jobsFromWorkflow);});
  $("#calendarNext").addEventListener("click",()=>{state.r2CalendarDate=r2DateAdd(range.startDate,state.r2CalendarMode==="day"?1:7);void r2RenderCalendar(jobsFromWorkflow);});
  $$("[data-calendar-mode]",host).forEach(button=>button.addEventListener("click",()=>{state.r2CalendarMode=button.dataset.calendarMode;localStorage.setItem("kh_calendar_mode",state.r2CalendarMode);void r2RenderCalendar(jobsFromWorkflow);}));
  $("#calendarTechFilter").addEventListener("change",event=>{state.r2CalendarTech=event.target.value;void r2RenderCalendar(jobsFromWorkflow);});
  $$("[data-new-calendar-job]",host).forEach(button=>button.addEventListener("click",()=>r2OpenCreateJob(renderWorkshop,{date:button.dataset.newCalendarJob})));
  $$("[data-calendar-job]",host).forEach(button=>button.addEventListener("click",()=>{const id=Number(button.dataset.calendarJob),job=jobsFromWorkflow.find(row=>Number(row.id)===id)||data.jobs.find(row=>Number(row.id)===id);if(job)r2OpenSchedule(job);}));
}
async function r2RenderWorkflow(data){
  const host=$("#workshopContent");if(!host)return;
  host.innerHTML=`<div class="workflow-scroll"><div id="workflowBoard" class="workflow-board">${(data.columns||[]).map(r2WorkflowColumn).join("")}</div></div>`;
  const board=$("#workflowBoard");r2BindWorkflowActions(board,data.jobs||[]);r2BindDrag(board,data.jobs||[]);
}
async function renderWorkshop(){
  const workspace=$("#workspace"),[data]=await Promise.all([api("/api/jobs/workflow"),loadUsers()]);
  state.r2Workflow=data;state.r2WorkshopMode=state.r2WorkshopMode||localStorage.getItem("kh_workshop_mode")||"calendar";
  workspace.innerHTML=pageHead(tr("Workshop & Calendar","Műhely & Naptár"),tr("One data model, two views. Switch instantly between the operational calendar and the five-stage workflow.","Egy adatmodell, két nézet. Azonnali váltás az operatív naptár és az ötfázisú workflow között."),
    `<button id="workshopNewJob" class="primary-button" type="button">＋ ${tr("New job","Új munka")}</button>`)+
    `<div class="workshop-master-switch"><div class="segmented-control large"><button type="button" data-workshop-mode="calendar" class="${state.r2WorkshopMode==="calendar"?"active":""}">📅 ${tr("Calendar View","Naptár nézet")}</button><button type="button" data-workshop-mode="workflow" class="${state.r2WorkshopMode==="workflow"?"active":""}">📋 ${tr("Workflow Board","Workflow tábla")}</button></div></div><div id="workshopContent">${loading()}</div>`;
  $("#workshopNewJob").addEventListener("click",()=>r2OpenCreateJob(renderWorkshop,{date:state.r2WorkshopMode==="calendar"?state.r2CalendarDate||r2Today():null}));
  $$("[data-workshop-mode]").forEach(button=>button.addEventListener("click",async()=>{
    state.r2WorkshopMode=button.dataset.workshopMode;localStorage.setItem("kh_workshop_mode",state.r2WorkshopMode);
    $$("[data-workshop-mode]").forEach(item=>item.classList.toggle("active",item===button));
    if(state.r2WorkshopMode==="calendar")await r2RenderCalendar(data.jobs||[]);else await r2RenderWorkflow(data);
  }));
  if(state.r2WorkshopMode==="calendar")await r2RenderCalendar(data.jobs||[]);else await r2RenderWorkflow(data);
}
// Finance extension starts boot() after registering closeout behavior.
