"use strict";

const R2_STAGES=[
  {key:"planned",label:"Tervezett"},
  {key:"scheduled",label:"Ütemezett"},
  {key:"in_progress",label:"Folyamatban"},
  {key:"blocked",label:"Blokkolva"},
  {key:"ready_for_closeout",label:"Lezárásra vár"}
];
const R2_TZ="America/New_York";

function r2StatusLabel(status){
  return R2_STAGES.find(stage=>stage.key===status)?.label||status||"";
}
function r2PriorityLabel(priority){
  return priority==="urgent"?"Sürgős":priority==="low"?"Alacsony":"Normál";
}
function r2SafeColor(value){
  const color=String(value||"");
  return /^#[0-9a-f]{6}$/i.test(color)?color:"#66707b";
}
function r2NyParts(date){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:R2_TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
}
function r2IsoToNyInput(value){
  if(!value)return "";
  const p=r2NyParts(new Date(value));
  return p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute;
}
function r2NyInputToIso(value){
  const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(!match)throw new Error("INVALID_SCHEDULE_TIME");
  const wanted={year:+match[1],month:+match[2],day:+match[3],hour:+match[4],minute:+match[5]};
  let guess=Date.UTC(wanted.year,wanted.month-1,wanted.day,wanted.hour,wanted.minute);
  for(let i=0;i<3;i+=1){
    const p=r2NyParts(new Date(guess));
    const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
    const desired=Date.UTC(wanted.year,wanted.month-1,wanted.day,wanted.hour,wanted.minute);
    guess+=desired-represented;
  }
  return new Date(guess).toISOString();
}
function r2FormatDateTime(value){
  if(!value)return "Nincs ütemezve";
  return new Intl.DateTimeFormat("hu-HU",{timeZone:R2_TZ,month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
}
function r2NyDate(value){
  const p=r2NyParts(new Date(value));
  return p.year+"-"+p.month+"-"+p.day;
}
function r2Today(){
  return r2NyDate(new Date().toISOString());
}
function r2DateAdd(dateString,days){
  const d=new Date(dateString+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function r2WeekStart(dateString){
  const d=new Date(dateString+"T12:00:00Z");
  const offset=(d.getUTCDay()+6)%7;
  d.setUTCDate(d.getUTCDate()-offset);
  return d.toISOString().slice(0,10);
}
function r2WeekRange(anchor){
  const startDate=r2WeekStart(anchor||r2Today());
  const endDate=r2DateAdd(startDate,7);
  return {
    startDate,
    endDate,
    from:r2NyInputToIso(startDate+"T00:00"),
    to:r2NyInputToIso(endDate+"T00:00")
  };
}
function r2DefaultInput(offsetMinutes){
  const date=new Date(Date.now()+offsetMinutes*60000);
  date.setMinutes(Math.ceil(date.getMinutes()/15)*15,0,0);
  return r2IsoToNyInput(date.toISOString());
}
function r2TechnicianOptions(selected){
  return (state.users||[]).filter(user=>["WORKER","MANAGER","ADMIN"].includes(user.role)).map(user=>
    "<option value='"+esc(user.id)+"' "+(String(user.id)===String(selected||"")?"selected":"")+">"+esc(user.name)+" · "+esc(roleLabel(user.role))+"</option>"
  ).join("");
}
function r2StatusOptions(selected){
  return R2_STAGES.map(stage=>"<option value='"+stage.key+"' "+(stage.key===selected?"selected":"")+">"+stage.label+"</option>").join("");
}
function intakeAction(row){
  if(row.status==="new")return "<button class='secondary-button convert-button' type='button' data-convert-id='"+row.id+"'>Konvertálás</button>";
  if(row.job_id)return "<button class='secondary-button convert-button' type='button' data-nav='workshop'>✓ "+esc(row.job_code||("Munka #"+row.job_id))+"</button>";
  return "<button class='primary-button convert-button' type='button' data-plan-intake='"+row.id+"'>＋ Tervezett munka</button>";
}
async function createJobFromIntake(id){
  try{
    const result=await api("/api/intake/"+encodeURIComponent(id)+"/create-job",{method:"POST",body:JSON.stringify({})});
    toast(result.idempotent?"A tervezett munka már létezett.":"Tervezett munka létrehozva.","success");
    navTo("planned");
  }catch(error){toast(humanError(error),"error");}
}

function r2JobCard(job,compact=false){
  const piano=[job.piano_brand,job.piano_model].filter(Boolean).join(" ");
  const schedule=job.scheduled_start?r2FormatDateTime(job.scheduled_start)+" – "+new Intl.DateTimeFormat("hu-HU",{timeZone:R2_TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(job.scheduled_end)):"Nincs ütemezve";
  return "<article class='job-card priority-"+esc(job.priority)+"' draggable='"+(!compact)+"' data-job-id='"+job.id+"'>"+
    "<div class='job-card-top'><span class='job-code'>"+esc(job.job_code||("#"+job.id))+"</span><span class='priority-chip "+esc(job.priority)+"'>"+esc(r2PriorityLabel(job.priority))+"</span></div>"+
    "<h3>"+esc(job.title)+"</h3>"+
    "<p class='job-party'>"+esc(job.client_name)+" · "+esc(piano||"Zongora")+"</p>"+
    (job.description?"<p class='job-description'>"+esc(job.description)+"</p>":"")+
    "<div class='job-meta'><span>👤 "+esc(job.assigned_technician_name||"Nincs technikus")+"</span><span>🕒 "+esc(schedule)+"</span><span>"+(job.service_location==="on_site"?"⌂ Helyszíni":"♬ Műhely")+"</span></div>"+
    (job.blocked_reason?"<div class='blocked-note'>"+esc(job.blocked_reason)+"</div>":"")+
    "<div class='job-actions'>"+
      "<button class='text-button' type='button' data-edit-job='"+job.id+"'>Szerkesztés</button>"+
      "<button class='secondary-button' type='button' data-schedule-job='"+job.id+"'>"+(job.scheduled_start?"Átütemezés":"Ütemezés")+"</button>"+
      (compact?"":"<select class='job-status-select' data-job-status='"+job.id+"' aria-label='Munkastátusz'>"+r2StatusOptions(job.status)+"</select>")+
    "</div></article>";
}
function r2BindJobActions(root,jobs,refresh){
  $$("[data-edit-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenEditJob(jobs.find(job=>Number(job.id)===Number(button.dataset.editJob)),refresh)));
  $$("[data-schedule-job]",root).forEach(button=>button.addEventListener("click",()=>r2OpenSchedule(jobs.find(job=>Number(job.id)===Number(button.dataset.scheduleJob)),refresh)));
  $$("[data-job-status]",root).forEach(select=>select.addEventListener("change",async()=>{
    const job=jobs.find(item=>Number(item.id)===Number(select.dataset.jobStatus));
    const next=select.value;
    if(next==="scheduled"&&!job.scheduled_start){select.value=job.status;return r2OpenSchedule(job,refresh);}
    if(next==="blocked"){select.value=job.status;return r2OpenBlocked(job,refresh);}
    await r2SetStatus(job,next,refresh);
  }));
}
async function r2SetStatus(job,status,refresh){
  try{
    await api("/api/jobs/"+job.id+"/status",{method:"PATCH",body:JSON.stringify({status})});
    toast("Státusz frissítve: "+r2StatusLabel(status)+".","success");
    await refresh();
  }catch(error){toast(humanError(error),"error");await refresh();}
}
function r2OpenBlocked(job,refresh){
  openDialog({title:"Munka blokkolása",eyebrow:job.job_code||"MUNKA",body:
    "<form id='blockedEditor' class='form-grid'><div class='detail-note full'>"+esc(job.title)+"</div>"+
    "<label class='field full'><span>Blokkolás oka *</span><textarea name='blocked_reason' required autofocus>"+esc(job.blocked_reason||"")+"</textarea></label>"+
    "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>Mégse</button><button class='primary-button' type='submit'>Blokkolás</button></div></form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#blockedEditor").addEventListener("submit",async event=>{
    event.preventDefault();
    try{
      const body=Object.fromEntries(new FormData(event.currentTarget));body.status="blocked";
      await api("/api/jobs/"+job.id+"/status",{method:"PATCH",body:JSON.stringify(body)});
      closeDialog();toast("Munka blokkolva.","success");await refresh();
    }catch(error){toast(humanError(error),"error");}
  });
}
async function r2OpenSchedule(job,refresh){
  if(!state.users?.length)await loadUsers();
  const start=job.scheduled_start?r2IsoToNyInput(job.scheduled_start):r2DefaultInput(60);
  const end=job.scheduled_end?r2IsoToNyInput(job.scheduled_end):r2DefaultInput(120);
  openDialog({title:job.scheduled_start?"Munka átütemezése":"Munka ütemezése",eyebrow:job.job_code||"NAPTÁR",body:
    "<form id='scheduleEditor' class='form-grid'>"+
      "<div class='detail-note full'><strong>"+esc(job.title)+"</strong><br>"+esc(job.client_name+" · "+[job.piano_brand,job.piano_model].filter(Boolean).join(" "))+"</div>"+
      "<label class='field full'><span>Technikus *</span><select name='assigned_technician_id' required><option value=''>Válassz technikust</option>"+r2TechnicianOptions(job.assigned_technician_id)+"</select></label>"+
      "<label class='field'><span>Kezdés · New York *</span><input name='scheduled_start' type='datetime-local' step='900' value='"+esc(start)+"' required></label>"+
      "<label class='field'><span>Befejezés · New York *</span><input name='scheduled_end' type='datetime-local' step='900' value='"+esc(end)+"' required></label>"+
      "<div class='form-actions full'>"+(job.scheduled_start?"<button type='button' id='clearScheduleBtn' class='danger-button'>Ütemezés törlése</button>":"")+
      "<button type='button' class='secondary-button' data-close-dialog>Mégse</button><button class='primary-button' type='submit'>Mentés</button></div>"+
    "</form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#clearScheduleBtn")?.addEventListener("click",async()=>{
    try{await api("/api/jobs/"+job.id+"/schedule",{method:"PATCH",body:JSON.stringify({clear:true})});closeDialog();toast("Ütemezés törölve.","success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
  $("#scheduleEditor").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=Object.fromEntries(new FormData(event.currentTarget));
    try{
      const body={assigned_technician_id:form.assigned_technician_id,scheduled_start:r2NyInputToIso(form.scheduled_start),scheduled_end:r2NyInputToIso(form.scheduled_end)};
      await api("/api/jobs/"+job.id+"/schedule",{method:"PATCH",body:JSON.stringify(body)});
      closeDialog();toast("Naptár frissítve.","success");await refresh();
    }catch(error){
      const conflict=error.payload?.conflict;
      toast(conflict?"Ütközés: "+(conflict.job_code||conflict.title)+" · "+r2FormatDateTime(conflict.scheduled_start):humanError(error),"error");
    }
  });
}
async function r2OpenEditJob(job,refresh){
  if(!state.users?.length)await loadUsers();
  openDialog({title:"Munka szerkesztése",eyebrow:job.job_code||"MUNKA",body:
    "<form id='jobEditForm' class='form-grid'>"+
      "<label class='field full'><span>Megnevezés *</span><input name='title' value='"+esc(job.title)+"' required autofocus></label>"+
      "<label class='field full'><span>Leírás</span><textarea name='description'>"+esc(job.description||"")+"</textarea></label>"+
      "<label class='field'><span>Prioritás</span><select name='priority'><option value='low' "+(job.priority==="low"?"selected":"")+">Alacsony</option><option value='normal' "+(job.priority==="normal"?"selected":"")+">Normál</option><option value='urgent' "+(job.priority==="urgent"?"selected":"")+">Sürgős</option></select></label>"+
      "<label class='field'><span>Helyszín</span><select name='service_location'><option value='workshop' "+(job.service_location==="workshop"?"selected":"")+">Műhely</option><option value='on_site' "+(job.service_location==="on_site"?"selected":"")+">Helyszíni</option></select></label>"+
      "<label class='field full'><span>Technikus</span><select name='assigned_technician_id'><option value=''>Nincs kiosztva</option>"+r2TechnicianOptions(job.assigned_technician_id)+"</select></label>"+
      "<label class='field full'><span>Szervizcím</span><input name='service_address' value='"+esc(job.service_address||"")+"'></label>"+
      "<label class='field full'><span>Belső megjegyzés</span><textarea name='internal_notes'>"+esc(job.internal_notes||"")+"</textarea></label>"+
      "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>Mégse</button><button class='primary-button' type='submit'>Mentés</button></div>"+
    "</form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#jobEditForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));
    try{await api("/api/jobs/"+job.id,{method:"PUT",body:JSON.stringify(body)});closeDialog();toast("Munka frissítve.","success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
async function r2OpenCreateJob(refresh){
  const [clients,users]=await Promise.all([loadClients(),loadUsers()]);
  if(!clients.length){toast("Előbb hozz létre ügyfelet és zongorát a Törzsadatokban.","error");return;}
  openDialog({title:"Új tervezett munka",eyebrow:"PLANNED JOBS",body:
    "<form id='jobCreateForm' class='form-grid'>"+
      "<label class='field'><span>Ügyfél *</span><select id='jobClientSelect' name='client_id' required>"+clients.map(client=>"<option value='"+client.id+"'>"+esc(client.name)+"</option>").join("")+"</select></label>"+
      "<label class='field'><span>Zongora *</span><select id='jobPianoSelect' name='piano_id' required></select></label>"+
      "<label class='field full'><span>Megnevezés *</span><input name='title' required autofocus></label>"+
      "<label class='field full'><span>Leírás</span><textarea name='description'></textarea></label>"+
      "<label class='field'><span>Prioritás</span><select name='priority'><option value='low'>Alacsony</option><option value='normal' selected>Normál</option><option value='urgent'>Sürgős</option></select></label>"+
      "<label class='field'><span>Helyszín</span><select name='service_location'><option value='workshop'>Műhely</option><option value='on_site'>Helyszíni</option></select></label>"+
      "<label class='field full'><span>Technikus</span><select name='assigned_technician_id'><option value=''>Később osztom ki</option>"+r2TechnicianOptions("")+"</select></label>"+
      "<label class='field full'><span>Szervizcím (helyszíni munkánál)</span><input name='service_address'></label>"+
      "<label class='field full'><span>Belső megjegyzés</span><textarea name='internal_notes'></textarea></label>"+
      "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>Mégse</button><button class='primary-button' type='submit'>Tervezett munka létrehozása</button></div>"+
    "</form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  async function loadPianos(){
    const clientId=$("#jobClientSelect").value;
    const pianos=await api("/api/clients/"+encodeURIComponent(clientId)+"/pianos");
    $("#jobPianoSelect").innerHTML=pianos.length?pianos.map(piano=>"<option value='"+piano.id+"'>"+esc([piano.brand,piano.model,piano.serial_number].filter(Boolean).join(" · "))+"</option>").join(""):"<option value=''>Nincs zongora – előbb add hozzá a Törzsadatokban</option>";
    $("#jobPianoSelect").disabled=!pianos.length;
  }
  $("#jobClientSelect").addEventListener("change",()=>loadPianos().catch(error=>toast(humanError(error),"error")));
  await loadPianos();
  $("#jobCreateForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));
    if(!body.piano_id){toast("A munkához zongora szükséges.","error");return;}
    try{await api("/api/jobs",{method:"POST",body:JSON.stringify(body)});closeDialog();toast("Tervezett munka létrehozva.","success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}

async function renderPlanned(){
  const workspace=$("#workspace");
  const [jobs]=await Promise.all([api("/api/planned-jobs"),loadUsers()]);
  state.r2Planned=jobs;
  const urgent=jobs.filter(job=>job.priority==="urgent").length;
  const assigned=jobs.filter(job=>job.assigned_technician_id).length;
  workspace.innerHTML=pageHead("Tervezett munkák","Ütemezés előtti munkák. Innen kerülnek egyetlen lépéssel a Műhely & Naptár közös vezérlőbe.","<button id='newJobBtn' class='primary-button' type='button'>＋ Új munka</button>")+
    "<div class='stats-grid'><div class='stat-card'><small>Tervezett</small><strong>"+jobs.length+"</strong></div><div class='stat-card'><small>Sürgős</small><strong>"+urgent+"</strong></div><div class='stat-card'><small>Technikussal</small><strong>"+assigned+"</strong></div><div class='stat-card'><small>Ütemezetlen</small><strong>"+jobs.length+"</strong></div></div>"+
    "<div class='planned-toolbar'><div class='search-field'><input id='plannedSearch' type='search' placeholder='Munka, ügyfél, zongora vagy kód…'></div><button id='openWorkshopBtn' class='secondary-button' type='button'>Műhely & Naptár →</button></div>"+
    "<div id='plannedList' class='planned-grid'></div>";
  $("#newJobBtn").addEventListener("click",()=>r2OpenCreateJob(renderPlanned));
  $("#openWorkshopBtn").addEventListener("click",()=>navTo("workshop"));
  $("#plannedSearch").addEventListener("input",r2RenderPlannedList);
  r2RenderPlannedList();
}
function r2RenderPlannedList(){
  const host=$("#plannedList");if(!host)return;
  const q=String($("#plannedSearch")?.value||"").trim().toLowerCase();
  const jobs=(state.r2Planned||[]).filter(job=>!q||[job.job_code,job.title,job.client_name,job.piano_brand,job.piano_model,job.description].filter(Boolean).join(" ").toLowerCase().includes(q));
  host.innerHTML=jobs.length?jobs.map(job=>r2JobCard(job,true)).join(""):"<section class='panel empty-state'>Nincs tervezett munka.</section>";
  r2BindJobActions(host,jobs,renderPlanned);
}

function r2WorkshopColumn(column){
  return "<section class='workflow-column stage-"+column.key+"' data-drop-stage='"+column.key+"'><header><div><span class='eyebrow'>WORKFLOW</span><h2>"+esc(column.label)+"</h2></div><span class='column-count'>"+column.jobs.length+"</span></header><div class='workflow-stack'>"+
    (column.jobs.length?column.jobs.map(job=>r2JobCard(job,false)).join(""):"<div class='workflow-empty'>Húzz ide munkát, vagy válts státuszt.</div>")+
    "</div></section>";
}
function r2BindBoardDrag(root,jobs){
  $$("[data-job-id]",root).forEach(card=>card.addEventListener("dragstart",event=>{event.dataTransfer.setData("text/job-id",card.dataset.jobId);event.dataTransfer.effectAllowed="move";card.classList.add("dragging");}));
  $$("[data-job-id]",root).forEach(card=>card.addEventListener("dragend",()=>card.classList.remove("dragging")));
  $$("[data-drop-stage]",root).forEach(column=>{
    column.addEventListener("dragover",event=>{event.preventDefault();column.classList.add("drag-over");});
    column.addEventListener("dragleave",()=>column.classList.remove("drag-over"));
    column.addEventListener("drop",async event=>{
      event.preventDefault();column.classList.remove("drag-over");
      const job=jobs.find(item=>String(item.id)===event.dataTransfer.getData("text/job-id"));
      if(!job||job.status===column.dataset.dropStage)return;
      if(column.dataset.dropStage==="scheduled"&&!job.scheduled_start)return r2OpenSchedule(job,renderWorkshop);
      if(column.dataset.dropStage==="blocked")return r2OpenBlocked(job,renderWorkshop);
      await r2SetStatus(job,column.dataset.dropStage,renderWorkshop);
    });
  });
}
function r2CalendarDay(date,jobs){
  const dayName=new Intl.DateTimeFormat("hu-HU",{weekday:"short"}).format(new Date(date+"T12:00:00Z"));
  const dayLabel=new Intl.DateTimeFormat("hu-HU",{month:"short",day:"numeric"}).format(new Date(date+"T12:00:00Z"));
  const rows=jobs.filter(job=>r2NyDate(job.scheduled_start)===date);
  return "<section class='calendar-day'><header><strong>"+esc(dayName)+"</strong><span>"+esc(dayLabel)+"</span></header><div class='calendar-day-body'>"+
    (rows.length?rows.map(job=>"<button type='button' class='calendar-job' data-calendar-job='"+job.id+"' style='--tech-color:"+r2SafeColor(job.assigned_technician_color)+"'><strong>"+esc(new Intl.DateTimeFormat("hu-HU",{timeZone:R2_TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(job.scheduled_start)))+"</strong><span>"+esc(job.title)+"</span><small>"+esc(job.assigned_technician_name||"—")+" · "+esc(job.client_name)+"</small></button>").join(""):"<div class='calendar-empty'>—</div>")+
    "</div></section>";
}
async function r2RenderCalendar(jobsFromWorkshop){
  const host=$("#calendarHost");if(!host)return;
  const range=r2WeekRange(state.r2Week||r2Today());
  const tech=state.r2CalendarTechnician||"";
  const data=await api("/api/calendar?from="+encodeURIComponent(range.from)+"&to="+encodeURIComponent(range.to)+(tech?"&technician_id="+encodeURIComponent(tech):""));
  const jobs=data.jobs||[];
  const days=Array.from({length:7},(_,index)=>r2DateAdd(range.startDate,index));
  host.innerHTML="<div class='calendar-toolbar'><div class='calendar-nav'><button id='prevWeekBtn' class='secondary-button' type='button'>←</button><button id='todayWeekBtn' class='secondary-button' type='button'>Ma</button><button id='nextWeekBtn' class='secondary-button' type='button'>→</button></div>"+
    "<strong>"+esc(new Intl.DateTimeFormat("hu-HU",{month:"long",day:"numeric"}).format(new Date(range.startDate+"T12:00:00Z")))+" – "+esc(new Intl.DateTimeFormat("hu-HU",{month:"long",day:"numeric"}).format(new Date(r2DateAdd(range.endDate,-1)+"T12:00:00Z")))+"</strong>"+
    "<select id='calendarTechFilter' aria-label='Technikus szűrő'><option value=''>Minden technikus</option>"+r2TechnicianOptions(tech)+"</select></div>"+
    "<div class='calendar-scroll'><div class='calendar-grid'>"+days.map(date=>r2CalendarDay(date,jobs)).join("")+"</div></div>";
  $("#prevWeekBtn").addEventListener("click",()=>{state.r2Week=r2DateAdd(range.startDate,-7);r2RenderCalendar(jobsFromWorkshop);});
  $("#todayWeekBtn").addEventListener("click",()=>{state.r2Week=r2Today();r2RenderCalendar(jobsFromWorkshop);});
  $("#nextWeekBtn").addEventListener("click",()=>{state.r2Week=r2DateAdd(range.startDate,7);r2RenderCalendar(jobsFromWorkshop);});
  $("#calendarTechFilter").addEventListener("change",event=>{state.r2CalendarTechnician=event.target.value;r2RenderCalendar(jobsFromWorkshop);});
  $$("[data-calendar-job]",host).forEach(button=>button.addEventListener("click",()=>{
    const id=Number(button.dataset.calendarJob);
    const job=jobsFromWorkshop.find(item=>Number(item.id)===id)||jobs.find(item=>Number(item.id)===id);
    if(job)r2OpenSchedule(job,renderWorkshop);
  }));
}

async function renderWorkshop(){
  const workspace=$("#workspace");
  const [data]=await Promise.all([api("/api/workshop"),loadUsers()]);
  state.r2Workshop=data;state.r2Week=state.r2Week||r2Today();
  const counts=Object.fromEntries((data.columns||[]).map(column=>[column.key,column.jobs.length]));
  workspace.innerHTML=pageHead("Műhely & Naptár","Egyetlen Job-domain vezérli az öt oszlopos workflow-t és a New York-i naptárt.","<button id='workshopNewJobBtn' class='primary-button' type='button'>＋ Új munka</button>")+
    "<div class='workflow-stats'>"+R2_STAGES.map(stage=>"<div class='stat-card'><small>"+stage.label+"</small><strong>"+(counts[stage.key]||0)+"</strong></div>").join("")+"</div>"+
    "<div class='workflow-scroll'><div id='workflowBoard' class='workflow-board'>"+(data.columns||[]).map(r2WorkshopColumn).join("")+"</div></div>"+
    "<section class='panel calendar-panel'><div class='panel-head'><div><span class='eyebrow'>AMERICA/NEW_YORK</span><h2>Naptár</h2></div><span class='badge'>Ugyanazok a jobs rekordok</span></div><div id='calendarHost'>"+loading()+"</div></section>";
  $("#workshopNewJobBtn").addEventListener("click",()=>r2OpenCreateJob(renderWorkshop));
  const board=$("#workflowBoard");
  r2BindJobActions(board,data.jobs||[],renderWorkshop);
  r2BindBoardDrag(board,data.jobs||[]);
  await r2RenderCalendar(data.jobs||[]);
}

void boot();
