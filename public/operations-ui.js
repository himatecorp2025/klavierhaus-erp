"use strict";

async function loadOperationalProfiles({refresh=false}={}){
  if(refresh||!state.staffSkills?.length)state.staffSkills=await api("/api/staff-skills");
  if(refresh||!state.workProfiles?.length)state.workProfiles=await api("/api/work-profiles");
  return {skills:state.staffSkills,profiles:state.workProfiles};
}
function operationalSkillLabel(skill){
  return state.language==="hu"?(skill?.name_hu||skill?.name_en||""):(skill?.name_en||skill?.name_hu||"");
}
function operationalManagerScopeLabel(scope){
  return scope==="INSIDE"?tr("Inside Manager","Belső menedzser"):scope==="OUTSIDE"?tr("Outside Manager","Külső menedzser"):"";
}
function operationalProfileFor(userId){return (state.workProfiles||[]).find(row=>String(row.id)===String(userId))||null;}
function operationalTeamProfileMarkup(user){
  const profile=operationalProfileFor(user?.id),chips=[];
  if(user?.role==="MANAGER"&&profile?.manager_scope)chips.push('<span class="work-profile-chip manager">'+esc(operationalManagerScopeLabel(profile.manager_scope))+'</span>');
  for(const skill of profile?.skills||[])chips.push('<span class="work-profile-chip">'+esc(operationalSkillLabel(skill))+'</span>');
  return chips.length?'<div class="work-profile-chips">'+chips.join("")+'</div>':"";
}
function operationalSkillOptions(selected="",allowEmpty=true){
  let html=allowEmpty?'<option value="">'+tr("No specific job role","Nincs külön munkakör")+'</option>':"";
  html+=(state.staffSkills||[]).filter(row=>Number(row.active)!==0).map(skill=>'<option value="'+skill.id+'" '+(String(skill.id)===String(selected||"")?"selected":"")+'>'+esc(operationalSkillLabel(skill))+'</option>').join("");
  return html;
}
async function createOperationalSkillInline(seed="",onSaved=null){
  const mini=openMiniDialog({title:tr("New job role","Új munkakör"),eyebrow:tr("PROFESSIONAL SKILL","SZAKMAI KOMPETENCIA"),body:`<form id="quickSkillForm" class="form-grid">
    <label class="field full"><span>${tr("English name","Angol név")} *</span><input name="name_en" required value="${esc(seed)}"></label>
    <label class="field full"><span>${tr("Hungarian name","Magyar név")}</span><input name="name_hu"></label>
    <label class="field full"><span>${tr("Description","Leírás")}</span><textarea name="description_en"></textarea></label>
    <div class="form-actions full"><button class="secondary-button" type="button" data-mini-close>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Create job role","Munkakör létrehozása")}</button></div>
  </form>`});
  mini.root.querySelector("#quickSkillForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));
    try{const saved=await api("/api/staff-skills",{method:"POST",body:JSON.stringify(body)});await loadOperationalProfiles({refresh:true});mini.close();toast(tr("Job role created.","Munkakör létrehozva."),"success");if(typeof onSaved==="function")onSaved(saved);}
    catch(error){toast(humanError(error),"error");}
  });
}
function milestoneDaysRemaining(dashboard){
  if(!dashboard?.end_date)return null;const end=new Date(dashboard.end_date+"T23:59:59"),diff=Math.ceil((end-Date.now())/86400000);return diff;
}
function milestoneIconSvg(kind="piano"){
  const icons={
    dashboard:'<path d="M3 11.5 12 4l9 7.5V21H3z"/><path d="M9 21v-6h6v6"/>',
    jobs:'<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M9 6V4h6v2M8 11h8M8 15h5"/>',
    clients:'<circle cx="12" cy="8" r="3.2"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
    inventory:'<path d="M4 7h16v13H4zM7 4h10l3 3H4z"/><path d="M9 12h6"/>',
    finance:'<path d="M5 20V9M12 20V4M19 20v-7"/><path d="M3 20h18"/>',
    reports:'<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 13h8M8 17h6"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.6a7 7 0 0 0-.8-1.8l1-1.9-2.1-2.1-1.9 1a7 7 0 0 0-1.8-.8L10.5 2h-3l-.6 2.3a7 7 0 0 0-1.8.8l-1.9-1L1.1 6.2l1 1.9a7 7 0 0 0-.8 1.8L0 10.5v3l2.3.6a7 7 0 0 0 .8 1.8l-1 1.9 2.1 2.1 1.9-1a7 7 0 0 0 1.8.8l.6 2.3h3l.6-2.3a7 7 0 0 0 1.8-.8l1.9 1 2.1-2.1-1-1.9a7 7 0 0 0 .8-1.8z" transform="translate(2 -1) scale(.85)"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.8 2c-1 .7-1.6 1.1-1.6 2.4M12 17h.01"/>',
    clipboard:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2M9 10h6M9 14h6M9 18h4"/>',
    piano:'<path d="M3 15h18M5 15V8l11-4 4 4v7M8 15v5M18 15v5"/><path d="M5 11h14M9 9v6"/>',
    document:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>',
    tools:'<path d="m5 19 6-6M13 11l5-5M14 5l5 5M4 6l5 5M3 4l2-2 6 6-2 2z"/>',
    flag:'<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    search:'<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    location:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    user:'<circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[kind]||icons.piano}</svg>`;
}
function milestonePianoArt(kind="grand"){
  if(kind==="action")return `<svg viewBox="0 0 640 220" aria-hidden="true"><defs><linearGradient id="ma" x1="0" x2="1"><stop stop-color="#1c130a"/><stop offset=".5" stop-color="#bb7b25"/><stop offset="1" stop-color="#f0bf63"/></linearGradient></defs><rect width="640" height="220" rx="18" fill="#120f0c"/><path d="M0 180C150 96 310 86 640 12v208H0z" fill="url(#ma)" opacity=".55"/><g stroke="#f2c36d" stroke-width="4" opacity=".75">${Array.from({length:18},(_,i)=>`<path d="M${16+i*36} 205  ${110+i*26} 65"/>`).join("")}</g><path d="M0 183h640" stroke="#f3c772" stroke-width="8"/></svg>`;
  return `<svg viewBox="0 0 620 300" aria-hidden="true"><defs><linearGradient id="pg" x1="0" x2="1"><stop stop-color="#090a0a"/><stop offset="1" stop-color="#423120"/></linearGradient></defs><rect width="620" height="300" rx="20" fill="transparent"/><path d="M210 92c105-67 247-79 335-31-42 15-83 36-118 68H256z" fill="url(#pg)"/><path d="M199 126h253c22 0 39 17 39 39v27H174l25-66Z" fill="#121313"/><path d="M188 192h317v21H177z" fill="#23170d"/><path d="M232 212v72M450 212v72" stroke="#171717" stroke-width="12"/><path d="m308 92 192-74" stroke="#b88439" stroke-width="8"/><path d="M505 18v174" stroke="#2f2417" stroke-width="7"/><path d="M205 157h224" stroke="#ead7a6" stroke-width="8"/><g stroke="#222" stroke-width="2">${Array.from({length:18},(_,i)=>`<path d="M${215+i*12} 153v12"/>`).join("")}</g></svg>`;
}
function milestoneImageMarkup(url,kind,alt=""){
  return url?`<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`:`<div class="milestone-generated-art ${kind}">${milestonePianoArt(kind)}</div>`;
}
function milestoneLocalized(row,key,fallback=""){
  return state.language==="hu"?(row?.[key+"_hu"]||row?.[key+"_en"]||fallback):(row?.[key+"_en"]||row?.[key+"_hu"]||fallback);
}
function milestoneStepFallback(index){
  const rows=[
    ["Intake","Igényfelvétel","Register client, piano details and initial request.","Ügyfél, zongoraadatok és kezdeti igény rögzítése.","clipboard"],
    ["Assessment","Felmérés","On-site inspection, condition report and measurements.","Helyszíni felmérés, állapotjelentés és mérések.","piano"],
    ["Quote","Ajánlat","Prepare service plan and send quote to client.","Szervizterv és ajánlat elkészítése az ügyfélnek.","document"],
    ["Workshop","Műhely","Service, regulation, repairs and quality checks.","Szerviz, szabályozás, javítások és minőségellenőrzés.","tools"],
    ["Delivery & Follow-up","Átadás és utánkövetés","Return piano, final tuning and follow-up with client.","Zongora átadása, végső hangolás és utánkövetés.","flag"]
  ];
  const r=rows[index]||rows[0];return {title_en:r[0],title_hu:r[1],description_en:r[2],description_hu:r[3],icon:r[4],completed:false,sort_order:index};
}
async function renderMilestone(){
  if(window.innerWidth<700){state.view="workshop";history.replaceState({},"","#workshop");return renderWorkshop();}
  const workspace=$("#workspace"),payload=await api("/api/milestone",{memoryCacheMs:0});state.milestone=payload;
  const d=payload.dashboard||{},raw=payload.steps||[],steps=Array.from({length:5},(_,i)=>({...milestoneStepFallback(i),...(raw[i]||{}),sort_order:i}));
  const title=milestoneLocalized(d,"title",tr("Steinway B — Concert Grand","Steinway B — koncertzongora"));
  const subtitle=milestoneLocalized(d,"subtitle",tr("Track the progress of this piano service from intake to completion.","Kövesd a zongoraszerviz folyamatát az igényfelvételtől az átadásig."));
  const craftTitle=milestoneLocalized(d,"craft_title",tr("Exceptional Pianos. Lasting Legacies.","Kivételes zongorák. Maradandó örökség."));
  const craftBody=milestoneLocalized(d,"craft_body",tr("Precision service for extraordinary instruments.","Precíz szerviz kivételes hangszerekhez."));
  const quote=milestoneLocalized(d,"quote",tr("Caring for extraordinary instruments and the people who play them.","Gondoskodás a kivételes hangszerekről és azokról, akik játszanak rajtuk."));
  const logo=$("#headerBrandLogo")?.src||"/icons/icon-192.png",user=state.user||{},avatar=user.profile_image_url||"";
  const stepIcons=["clipboard","piano","document","tools","flag"];
  workspace.innerHTML=`<div class="milestone-showcase">
    <aside class="ms-sidebar">
      <button class="ms-brand" type="button" data-ms-nav="milestone"><img src="${esc(logo)}" alt=""><span><strong>KLAVIERHAUS</strong><small>PIANO SERVICE</small></span></button>
      <nav class="ms-nav" aria-label="Milestone navigation">
        <button type="button" data-ms-nav="milestone">${milestoneIconSvg("dashboard")}<span>Dashboard</span></button>
        <button type="button" class="active" data-ms-nav="planned">${milestoneIconSvg("jobs")}<span>Jobs</span></button>
        <button type="button" data-ms-nav="master">${milestoneIconSvg("clients")}<span>Clients</span></button>
        <button type="button" data-ms-nav="workshop">${milestoneIconSvg("calendar")}<span>Calendar</span></button>
        <button type="button" data-ms-nav="settings">${milestoneIconSvg("inventory")}<span>Inventory</span></button>
        <button type="button" data-ms-nav="finance">${milestoneIconSvg("finance")}<span>Finances</span></button>
        <button type="button" data-ms-nav="documents">${milestoneIconSvg("reports")}<span>Reports</span></button>
      </nav>
      <div class="ms-nav ms-nav-bottom"><button type="button" data-ms-nav="settings">${milestoneIconSvg("settings")}<span>Settings</span></button><button type="button" data-ms-nav="profile">${milestoneIconSvg("help")}<span>Help</span></button></div>
    </aside>
    <section class="ms-stage">
      <header class="ms-topbar">
        <label class="ms-search">${milestoneIconSvg("search")}<input id="milestoneGlobalSearch" type="search" placeholder="Search clients, jobs, or instruments…"></label>
        <div class="ms-account"><button class="ms-bell" id="milestoneBell" type="button">${milestoneIconSvg("bell")}<i></i></button><button class="ms-profile" id="milestoneProfileShortcut" type="button">${avatar?`<img src="${esc(avatar)}" alt="">`:`<span>${esc(initials(user.name||"KH"))}</span>`}<b>${esc(user.name||"Admin")}<small>${esc(user.role||"Admin")}</small></b><em>⌄</em></button></div>
      </header>
      <main class="ms-content">
        <section class="ms-job-head">
          <div class="ms-job-copy"><span class="ms-reference">${esc(d.reference_code||"JOB #1042")}</span><h1>${esc(title)}</h1><div class="ms-meta-row">
            <div>${milestoneIconSvg("user")}<span><small>Client</small><strong>${esc(d.client_name||"Klavierhaus Client")}</strong></span></div>
            <div>${milestoneIconSvg("location")}<span><small>Location</small><strong>${esc(d.location_label||"New York")}</strong></span></div>
            <div>${milestoneIconSvg("calendar")}<span><small>Scheduled</small><strong>${esc(d.scheduled_label||d.start_date||"Not set")}</strong></span></div>
            <span class="ms-status-dot">● ${esc(d.status_label||"In Progress")}</span>
          </div></div>
          <div class="ms-job-art">${milestoneImageMarkup(d.hero_media_url,"grand",title)}</div>
        </section>
        <section class="ms-milestone-panel">
          <div class="ms-panel-head"><div><h2>Service Milestones</h2><p>${esc(subtitle)}</p></div><button type="button" id="milestoneDetailsButton">View Details <span>⌄</span></button></div>
          <div class="ms-timeline">
            <div class="ms-timeline-line"></div>
            ${steps.map((step,index)=>{const st=milestoneLocalized(step,"title",milestoneStepFallback(index).title_en),desc=milestoneLocalized(step,"description",milestoneStepFallback(index).description_en),kind=stepIcons[index];return `<article class="ms-step ms-step-${index+1} ${step.completed?"done":""}"><div class="ms-step-node"><span>${milestoneIconSvg(step.icon&&stepIcons.includes(step.icon)?step.icon:kind)}</span></div><b>${String(index+1).padStart(2,"0")}</b><h3>${esc(st)}</h3><p>${esc(desc)}</p></article>`;}).join("")}
          </div>
        </section>
        <section class="ms-info-grid">
          <article class="ms-info-card"><header>${milestoneIconSvg("clients")}<strong>Client</strong></header><h3>${esc(d.client_name||"Klavierhaus Client")}</h3><dl><dt>Type</dt><dd>${esc(d.client_type||"Client")}</dd><dt>Contact</dt><dd>${esc(d.client_contact||"—")}</dd></dl><button type="button" data-ms-nav="master">View Client <span>→</span></button></article>
          <article class="ms-info-card ms-instrument"><header>${milestoneIconSvg("piano")}<strong>Instrument</strong></header><div class="ms-instrument-art">${milestoneImageMarkup(d.instrument_media_url,"grand",d.instrument_name||"Piano")}</div><h3>${esc(d.instrument_name||"Steinway & Sons")}</h3><dl><dt>Serial No.</dt><dd>${esc(d.instrument_serial||"—")}</dd><dt>Year</dt><dd>${esc(d.instrument_year||"—")}</dd></dl></article>
          <article class="ms-info-card"><header>${milestoneIconSvg("calendar")}<strong>Schedule</strong></header><dl class="ms-schedule-list"><dt>Workshop Slot</dt><dd>${esc(d.schedule_range||[d.start_date,d.end_date].filter(Boolean).join(" – ")||"Not set")}</dd><dt>Delivery (Est.)</dt><dd>${esc(d.delivery_estimate||d.end_date||"Not set")}</dd></dl><button type="button" data-ms-nav="workshop">Open Calendar <span>→</span></button></article>
          <article class="ms-info-card ms-status-card"><header>${milestoneIconSvg("finance")}<strong>Status</strong></header><ul>${steps.map((step,index)=>`<li class="${step.completed?"complete":(!step.completed&&steps.slice(0,index).every(s=>s.completed)?"current":"pending")}"><i>${step.completed?"✓":""}</i><span>${esc(milestoneLocalized(step,"title",milestoneStepFallback(index).title_en))}</span></li>`).join("")}</ul></article>
        </section>
        <section class="ms-footer-grid">
          <article class="ms-craft"><div class="ms-craft-image">${milestoneImageMarkup(d.craft_media_url,"action",craftTitle)}</div><div><span>OUR CRAFT</span><h2>${esc(craftTitle)}</h2><p>${esc(craftBody)}</p><i></i></div></article>
          <article class="ms-quote"><div>${milestoneImageMarkup(d.quote_media_url,"grand",quote)}</div><blockquote>“${esc(quote)}”</blockquote></article>
        </section>
      </main>
    </section>
  </div>`;
  $$('[data-ms-nav]',workspace).forEach(button=>button.addEventListener('click',()=>navTo(button.dataset.msNav)));
  $("#milestoneBell")?.addEventListener("click",()=>$("#notificationBell")?.click());
  $("#milestoneProfileShortcut")?.addEventListener("click",()=>navTo("profile"));
  $("#milestoneDetailsButton")?.addEventListener("click",()=>["ADMIN","SUPERADMIN"].includes(state.user?.role)?openMilestoneEditor(payload):null);
  $("#milestoneGlobalSearch")?.addEventListener("keydown",event=>{if(event.key!=="Enter")return;const q=event.currentTarget.value.trim();if(!q)return;state.masterSearch=q;navTo("master");});
}
function operationsMilestoneProfileCard(){
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role))return "";
  return `<section class="panel milestone-admin-card" id="milestoneAdminCard"><div class="panel-head"><div><span class="eyebrow">${tr("MILESTONE HOME","MÉRFÖLDKŐ KEZDŐOLDAL")}</span><h2>${tr("Service Milestones dashboard","Service Milestones irányítópult")}</h2><p>${tr("The approved layout is fixed. Edit content, status and imagery without changing the five-step design.","A jóváhagyott elrendezés fix. A tartalom, státusz és képek szerkeszthetők az ötlépéses design megváltoztatása nélkül.")}</p></div><button class="secondary-button" id="editMilestoneBtn" type="button">${tr("Edit content","Tartalom szerkesztése")}</button></div><div id="milestoneAdminPreview" class="milestone-admin-preview"></div></section>`;
}
async function bindOperationsMilestoneProfile(){
  const button=$("#editMilestoneBtn"),preview=$("#milestoneAdminPreview");if(!button&&!preview)return;
  const payload=await api("/api/milestone",{memoryCacheMs:0});state.milestone=payload;
  if(preview){const d=payload.dashboard||{};preview.innerHTML='<strong>'+esc(milestoneLocalized(d,"title",tr("Service Milestones","Szerviz mérföldkövek")))+'</strong><span>'+Number(payload.completed_count||0)+' / 5 '+tr("completed","teljesítve")+'</span>';}
  button?.addEventListener("click",()=>openMilestoneEditor(payload));
}
function milestoneStepEditorMarkup(step={},index=0){
  const base={...milestoneStepFallback(index),...step};
  return `<article class="milestone-step-editor" data-milestone-step><header><strong>${String(index+1).padStart(2,"0")} · ${tr("Milestone","Mérföldkő")}</strong><span>${esc(base.icon||"")}</span></header><div class="form-grid">
    <label class="field"><span>Title EN *</span><input name="step_title_en" required value="${esc(base.title_en||"")}"></label><label class="field"><span>Cím HU</span><input name="step_title_hu" value="${esc(base.title_hu||"")}"></label>
    <label class="field full"><span>Description EN</span><textarea name="step_description_en">${esc(base.description_en||"")}</textarea></label><label class="field full"><span>Leírás HU</span><textarea name="step_description_hu">${esc(base.description_hu||"")}</textarea></label>
    <label class="field"><span>${tr("Target date","Céldátum")}</span><input name="step_target_date" type="date" value="${esc(base.target_date||"")}"></label><label class="field"><span>${tr("Icon key","Ikonkulcs")}</span><select name="step_icon">${["clipboard","piano","document","tools","flag"].map(k=>`<option value="${k}" ${k===(base.icon||milestoneStepFallback(index).icon)?"selected":""}>${k}</option>`).join("")}</select></label>
    <label class="field"><span>${tr("Image / GIF","Kép / GIF")}</span><input name="step_media_file" type="file" accept="image/*,.gif"><input name="step_media_url" type="hidden" value="${esc(base.media_url||"")}"></label>
    <label class="cms-toggle-row"><span><strong>${tr("Completed","Teljesítve")}</strong></span><input name="step_completed" type="checkbox" ${base.completed?"checked":""}></label>
  </div></article>`;
}
async function uploadMilestoneFile(file){if(!file)return "";const form=new FormData();form.append("file",file);return (await api("/api/milestone/media",{method:"POST",body:form})).url||"";}
function openMilestoneEditor(payload){
  const d=payload?.dashboard||{},raw=payload?.steps||[],steps=Array.from({length:5},(_,i)=>({...milestoneStepFallback(i),...(raw[i]||{})}));
  const mediaField=(label,name,current)=>`<label class="field"><span>${label}</span><input name="${name}_file" type="file" accept="image/*,.gif"><input name="${name}_url" type="hidden" value="${esc(current||"")}"></label>`;
  openDialog({title:tr("Edit Service Milestones dashboard","Service Milestones irányítópult szerkesztése"),eyebrow:tr("FIXED APPROVED DESIGN · CONTENT ONLY","FIX JÓVÁHAGYOTT DESIGN · CSAK TARTALOM"),variant:"wide",body:`<form id="milestoneEditor" class="form-grid milestone-showcase-editor">
    <label class="field"><span>Reference</span><input name="reference_code" value="${esc(d.reference_code||"JOB #1042")}"></label><label class="field"><span>Status</span><input name="status_label" value="${esc(d.status_label||"In Progress")}"></label>
    <label class="field"><span>Title EN *</span><input name="title_en" required value="${esc(d.title_en||"")}"></label><label class="field"><span>Cím HU</span><input name="title_hu" value="${esc(d.title_hu||"")}"></label>
    <label class="field full"><span>Milestone subtitle EN</span><input name="subtitle_en" value="${esc(d.subtitle_en||"")}"></label><label class="field full"><span>Mérföldkő alcím HU</span><input name="subtitle_hu" value="${esc(d.subtitle_hu||"")}"></label>
    <label class="field"><span>Client name</span><input name="client_name" value="${esc(d.client_name||"")}"></label><label class="field"><span>Client type</span><input name="client_type" value="${esc(d.client_type||"")}"></label><label class="field"><span>Client contact</span><input name="client_contact" value="${esc(d.client_contact||"")}"></label><label class="field"><span>Location</span><input name="location_label" value="${esc(d.location_label||"")}"></label>
    <label class="field"><span>Scheduled label</span><input name="scheduled_label" value="${esc(d.scheduled_label||"")}"></label><label class="field"><span>Workshop slot</span><input name="schedule_range" value="${esc(d.schedule_range||"")}"></label><label class="field"><span>Delivery estimate</span><input name="delivery_estimate" value="${esc(d.delivery_estimate||"")}"></label><label class="field"><span>Instrument</span><input name="instrument_name" value="${esc(d.instrument_name||"")}"></label>
    <label class="field"><span>Serial No.</span><input name="instrument_serial" value="${esc(d.instrument_serial||"")}"></label><label class="field"><span>Year</span><input name="instrument_year" value="${esc(d.instrument_year||"")}"></label>
    ${mediaField(tr("Header piano image","Fejléc zongorakép"),"hero_media",d.hero_media_url)}${mediaField(tr("Instrument image","Hangszerkép"),"instrument_media",d.instrument_media_url)}${mediaField(tr("Craft image","Műhely kép"),"craft_media",d.craft_media_url)}${mediaField(tr("Quote image","Idézet kép"),"quote_media",d.quote_media_url)}
    <label class="field"><span>Craft title EN</span><input name="craft_title_en" value="${esc(d.craft_title_en||"")}"></label><label class="field"><span>Craft title HU</span><input name="craft_title_hu" value="${esc(d.craft_title_hu||"")}"></label><label class="field full"><span>Craft copy EN</span><textarea name="craft_body_en">${esc(d.craft_body_en||"")}</textarea></label><label class="field full"><span>Craft copy HU</span><textarea name="craft_body_hu">${esc(d.craft_body_hu||"")}</textarea></label>
    <label class="field full"><span>Quote EN</span><textarea name="quote_en">${esc(d.quote_en||"")}</textarea></label><label class="field full"><span>Idézet HU</span><textarea name="quote_hu">${esc(d.quote_hu||"")}</textarea></label>
    <section class="full milestone-step-editor-list" id="milestoneStepEditors">${steps.map(milestoneStepEditorMarkup).join("")}</section>
    <div class="form-actions full"><button class="secondary-button" type="button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Publish content","Tartalom publikálása")}</button></div>
  </form>`});
  const form=$("#milestoneEditor"),host=$("#milestoneStepEditors");
  form.addEventListener("submit",async event=>{
    event.preventDefault();const submit=event.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;
    try{
      const upload=async name=>{const file=event.currentTarget.elements[name+"_file"]?.files?.[0];return file?await uploadMilestoneFile(file):(event.currentTarget.elements[name+"_url"]?.value||"");};
      const rows=$$("[data-milestone-step]",host),stepPayload=[];
      for(let index=0;index<5;index++){const row=rows[index],get=name=>row.querySelector('[name="'+name+'"]'),file=get("step_media_file")?.files?.[0];let media=get("step_media_url")?.value||"";if(file)media=await uploadMilestoneFile(file);stepPayload.push({title_en:get("step_title_en")?.value||"",title_hu:get("step_title_hu")?.value||"",description_en:get("step_description_en")?.value||"",description_hu:get("step_description_hu")?.value||"",target_date:get("step_target_date")?.value||null,icon:get("step_icon")?.value||milestoneStepFallback(index).icon,media_url:media,completed:Boolean(get("step_completed")?.checked),sort_order:index});}
      const fd=Object.fromEntries(new FormData(event.currentTarget));
      const body={dashboard:{title_en:fd.title_en,title_hu:fd.title_hu,subtitle_en:fd.subtitle_en,subtitle_hu:fd.subtitle_hu,quote_en:fd.quote_en,quote_hu:fd.quote_hu,reference_code:fd.reference_code,status_label:fd.status_label,client_name:fd.client_name,client_type:fd.client_type,client_contact:fd.client_contact,location_label:fd.location_label,scheduled_label:fd.scheduled_label,schedule_range:fd.schedule_range,delivery_estimate:fd.delivery_estimate,instrument_name:fd.instrument_name,instrument_serial:fd.instrument_serial,instrument_year:fd.instrument_year,craft_title_en:fd.craft_title_en,craft_title_hu:fd.craft_title_hu,craft_body_en:fd.craft_body_en,craft_body_hu:fd.craft_body_hu,hero_media_url:await upload("hero_media"),instrument_media_url:await upload("instrument_media"),craft_media_url:await upload("craft_media"),quote_media_url:await upload("quote_media")},steps:stepPayload};
      await api("/api/milestone",{method:"PUT",body:JSON.stringify(body)});closeDialog();toast(tr("Milestone dashboard published.","Mérföldkő irányítópult publikálva."),"success");await bindOperationsMilestoneProfile();if(state.view==="milestone")await renderMilestone();
    }catch(error){submit.disabled=false;toast(humanError(error),"error");}
  });
}
function operationsSkillsSettingsCard(users=[]){
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role))return "";
  return `<section class="panel staff-skill-center"><div class="panel-head"><div><span class="eyebrow">${tr("WORK PROFILES","MUNKAKÖRÖK")}</span><h2>${tr("Professional roles & competencies","Szakmai munkakörök és kompetenciák")}</h2><p>${tr("System permissions stay separate from the work each person can perform.","A rendszerjogosultság külön marad attól, hogy ki milyen munkát végezhet.")}</p></div><button id="newStaffSkillBtn" class="secondary-button" type="button">＋ ${tr("Job role","Munkakör")}</button></div>
    <div class="staff-skill-grid">${(state.staffSkills||[]).map(skill=>`<button type="button" class="staff-skill-card" data-edit-staff-skill="${skill.id}"><strong>${esc(operationalSkillLabel(skill))}</strong><small>${esc(skill.code)} · ${Number(skill.user_count||0)} ${tr("people","fő")}</small></button>`).join("")}</div>
    <div class="staff-profile-overview">${users.map(user=>`<div><strong>${esc(user.name)}</strong>${operationalTeamProfileMarkup(user)||'<small>'+tr("No professional roles assigned","Nincs szakmai munkakör hozzárendelve")+'</small>'}</div>`).join("")}</div>
  </section>`;
}
async function bindOperationsSkillsSettings(){
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role))return;
  $("#newStaffSkillBtn")?.addEventListener("click",()=>createOperationalSkillInline("",()=>renderSettings()));
  $$("[data-edit-staff-skill]").forEach(button=>button.addEventListener("click",()=>openStaffSkillEditor((state.staffSkills||[]).find(skill=>String(skill.id)===button.dataset.editStaffSkill))));
}
function openStaffSkillEditor(skill){
  if(!skill)return;
  openDialog({title:tr("Edit job role","Munkakör szerkesztése"),eyebrow:tr("PROFESSIONAL SKILL","SZAKMAI KOMPETENCIA"),body:`<form id="staffSkillEditor" class="form-grid"><label class="field"><span>Name EN *</span><input name="name_en" required value="${esc(skill.name_en||"")}"></label><label class="field"><span>Név HU</span><input name="name_hu" value="${esc(skill.name_hu||"")}"></label><label class="field full"><span>Description EN</span><textarea name="description_en">${esc(skill.description_en||"")}</textarea></label><label class="field full"><span>Leírás HU</span><textarea name="description_hu">${esc(skill.description_hu||"")}</textarea></label><label class="cms-toggle-row full"><span>${tr("Active","Aktív")}</span><input name="active" type="checkbox" ${skill.active?"checked":""}></label><div class="form-actions full"><button class="secondary-button" type="button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save","Mentés")}</button></div></form>`});
  $("#staffSkillEditor").addEventListener("submit",async event=>{event.preventDefault();const fd=new FormData(event.currentTarget),body=Object.fromEntries(fd);body.active=event.currentTarget.elements.active.checked;try{await api("/api/staff-skills/"+skill.id,{method:"PUT",body:JSON.stringify(body)});await loadOperationalProfiles({refresh:true});closeDialog();await renderSettings();}catch(error){toast(humanError(error),"error");}});
}
function operationsExportRecoveryCard(){
  return `<section class="panel recovery-scope-card database-export-card"><span class="eyebrow">${tr("COMPLETE DATA EXPORT","TELJES ADATEXPORT")}</span><h3>${tr("Download full database workbook","Teljes adatbázis letöltése")}</h3><p>${tr("Exports every operational database table into a structured XLSX workbook with one sheet per table, preserved IDs and relationships, plus a schema manifest.","Minden operatív adatbázistáblát strukturált XLSX munkafüzetbe exportál, táblánként külön lappal, megőrzött ID-kapcsolatokkal és séma-manifesttel.")}</p><small class="database-export-security-note">${tr("Authentication secrets such as password hashes and tokens are securely redacted; business and relationship data remain complete.","A hitelesítési titkok, például jelszóhash-ek és tokenek biztonsági okból maszkolva vannak; az üzleti és kapcsolati adatok hiánytalanok.")}</small><button class="primary-button" id="downloadFullDatabaseExport" type="button">↓ XLSX ${tr("Full database","Teljes adatbázis")}</button></section>`;
}
function bindOperationsExportRecovery(){
  $("#downloadFullDatabaseExport")?.addEventListener("click",async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      const response=await fetch("/api/system-export.xlsx",{headers:{Authorization:"Bearer "+state.token}});
      if(!response.ok){let payload={};try{payload=await response.json();}catch(_error){}throw new Error(payload.error||"DATABASE_EXPORT_FAILED");}
      const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a"),header=response.headers.get("content-disposition")||"",match=header.match(/filename="([^"]+)"/);link.href=url;link.download=match?.[1]||"klavierhaus-full-database.xlsx";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(tr("Full database export downloaded.","A teljes adatbázis-export letöltve."),"success");
    }catch(error){toast(humanError(error),"error");}finally{button.disabled=false;}
  });
}
