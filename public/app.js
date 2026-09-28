"use strict";

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const esc=(value)=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const state={
  token:sessionStorage.getItem("kh_token")||"",
  user:null,
  view:(location.hash||"#workshop").slice(1)||"workshop",
  clients:[],selectedClientId:null,intake:[],users:[],
  cmsPages:[],cmsPage:"home",cmsLanguage:"en",landing:[]
};
const activeViews=new Set(["workshop","planned","intake","master","cms","profile"]);
const roleLabel=(role)=>role==="WORKER"?"Technikus":role==="SUPERADMIN"?"Super Admin":role==="ADMIN"?"Admin":role==="MANAGER"?"Manager":role||"";
const initials=(name)=>String(name||"KH").split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase();

function toast(message,type=""){
  const host=$("#toastRegion"),item=document.createElement("div");
  item.className=`toast ${type}`;item.textContent=String(message||"");
  host.append(item);setTimeout(()=>item.remove(),4200);
}
function humanError(error){
  const code=String(error?.message||error||"");
  const map={
    AUTH_REQUIRED:"A munkamenet lejárt.",INVALID_TOKEN:"A munkamenet lejárt.",SESSION_REVOKED:"A munkamenet lejárt.",
    CLIENT_NAME_REQUIRED:"Az ügyfél neve kötelező.",INVALID_CLIENT_EMAIL:"Érvénytelen ügyfél e-mail.",
    PIANO_BRAND_REQUIRED:"A zongora márkája kötelező.",REPORTED_ISSUE_REQUIRED:"A hiba vagy igény leírása kötelező.",
    CLIENT_NAME_REQUIRED:"Az ügyfél neve szükséges a konverzióhoz.",PIANO_DETAILS_REQUIRED:"A konverzióhoz add meg a zongora márkáját.",
    INVALID_PIANO_ID:"A kiválasztott zongora nem ehhez az ügyfélhez tartozik.",PERMISSION_DENIED:"Nincs jogosultság ehhez a művelethez.",
    JOB_TITLE_REQUIRED:"A munka megnevezése kötelező.",INVALID_JOB_STATUS:"Érvénytelen munkastátusz.",
    TECHNICIAN_REQUIRED_FOR_SCHEDULE:"Ütemezéshez technikust kell választani.",TECHNICIAN_REQUIRED_FOR_STATUS:"Ehhez a státuszhoz technikus szükséges.",
    SCHEDULE_REQUIRED_FOR_STATUS:"A munkát előbb ütemezni kell.",SCHEDULE_CONFLICT:"A technikusnak ebben az időpontban már van másik munkája.",
    BLOCKED_REASON_REQUIRED:"A blokkolás okát add meg.",INVALID_SCHEDULE_RANGE:"A befejezésnek a kezdés után kell lennie.",
    INTAKE_MUST_BE_CONVERTED:"Az igényt előbb törzsadattá kell konvertálni.",INTAKE_JOB_ALREADY_EXISTS:"Ehhez az igényhez már tartozik munka."
  };
  return map[code]||code.replaceAll("_"," ");
}
async function api(url,options={}){
  const headers={Accept:"application/json",...(options.headers||{})};
  if(state.token)headers.Authorization=`Bearer ${state.token}`;
  if(options.body!==undefined && !(options.body instanceof FormData) && !headers["Content-Type"])headers["Content-Type"]="application/json";
  const response=await fetch(url,{...options,headers,cache:"no-store"});
  const type=response.headers.get("content-type")||"";
  const data=type.includes("application/json")?await response.json().catch(()=>({})):await response.text();
  if(!response.ok){
    if([401].includes(response.status) && state.token){clearSession();showLogin();}
    const error=new Error(data?.error||`HTTP_${response.status}`);error.status=response.status;error.payload=data;throw error;
  }
  return data;
}
function setSession(payload){
  state.token=payload.token;state.user=payload.user;
  sessionStorage.setItem("kh_token",state.token);
  sessionStorage.setItem("kh_user",JSON.stringify(state.user));
}
function clearSession(){
  state.token="";state.user=null;
  sessionStorage.removeItem("kh_token");sessionStorage.removeItem("kh_user");
}
function showLogin(){
  $("#loginScreen").classList.remove("hidden");$("#appShell").classList.add("hidden");
}
function showApp(){
  $("#loginScreen").classList.add("hidden");$("#appShell").classList.remove("hidden");
  $("#profileInitials").textContent=initials(state.user?.name);
}
async function loadBranding(){
  try{
    const b=await fetch("/api/public/branding",{cache:"no-store"}).then(r=>r.json());
    for(const img of [$("#loginBrandLogo"),$("#headerBrandLogo")])if(img&&b.logo_url)img.src=`${b.logo_url}${b.logo_url.includes("?")?"&":"?"}v=${encodeURIComponent(b.branding_version||"1")}`;
    document.title=`${b.company_name||"Klavierhaus"} ERP`;
  }catch(_error){}
}

function navTo(view){
  if(!activeViews.has(view))return;
  state.view=view;history.replaceState({}, "", `#${view}`);
  $$(".nav-item[data-nav],.mobile-nav [data-nav]").forEach(button=>button.classList.toggle("active",button.dataset.nav===view));
  void renderView();
}
function bindNavigation(){
  document.addEventListener("click",event=>{
    const button=event.target.closest("[data-nav]");
    if(!button||button.disabled)return;
    event.preventDefault();navTo(button.dataset.nav);
  });
  window.addEventListener("hashchange",()=>{const view=location.hash.slice(1);if(activeViews.has(view)){state.view=view;void renderView();}});
}

function loading(){return '<div class="loading">Betöltés…</div>';}
function pageHead(title,subtitle,actions=""){return `<header class="page-head"><div><span class="eyebrow">KLAVIERHAUS ERP</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="page-actions">${actions}</div></header>`;}
function openDialog({title,eyebrow="",body}){
  $("#dialogTitle").textContent=title;$("#dialogEyebrow").textContent=eyebrow;$("#dialogBody").innerHTML=body;
  const dialog=$("#appDialog");if(!dialog.open)dialog.showModal();return dialog;
}
function closeDialog(){const dialog=$("#appDialog");if(dialog.open)dialog.close();}
$("#appDialog").addEventListener("click",event=>{if(event.target===$("#appDialog"))closeDialog();});

async function renderView(){
  const workspace=$("#workspace");workspace.innerHTML=loading();
  try{
    if(state.view==="workshop")await renderWorkshop();
    else if(state.view==="planned")await renderPlanned();
    else if(state.view==="master")await renderMaster();
    else if(state.view==="cms")await renderCms();
    else if(state.view==="profile")await renderProfile();
    else await renderIntake();
    workspace.focus({preventScroll:true});
    $$(".nav-item[data-nav],.mobile-nav [data-nav]").forEach(button=>button.classList.toggle("active",button.dataset.nav===state.view));
  }catch(error){
    workspace.innerHTML=`<section class="panel empty-state"><strong>Nem sikerült betölteni a nézetet.</strong><p>${esc(humanError(error))}</p><button class="secondary-button" type="button" id="retryView">Újrapróbálás</button></section>`;
    $("#retryView")?.addEventListener("click",()=>renderView());
  }
}

async function loadClients(query=""){
  state.clients=await api(`/api/clients${query?`?q=${encodeURIComponent(query)}`:""}`);
  return state.clients;
}
async function loadUsers(){state.users=await api("/api/users");return state.users;}

async function renderMaster(){
  const workspace=$("#workspace");
  await loadClients();
  if(!state.selectedClientId && state.clients.length)state.selectedClientId=Number(state.clients[0].id);
  workspace.innerHTML=`${pageHead("Törzsadatok","Ügyfelek és a hozzájuk tartozó zongorák egyetlen, gyors felületen.",'<button id="addClientBtn" class="primary-button" type="button">＋ Új ügyfél</button>')}
    <div class="master-layout">
      <section class="panel">
        <div class="panel-head"><div class="search-field"><input id="clientSearch" type="search" placeholder="Név, e-mail vagy telefon…" aria-label="Ügyfél keresése"></div></div>
        <div id="clientList" class="client-list"></div>
      </section>
      <section id="clientDetail" class="panel client-detail"></section>
    </div>`;
  $("#addClientBtn").addEventListener("click",()=>openClientDialog());
  $("#clientSearch").addEventListener("input",debounce(async event=>{
    await loadClients(event.target.value);renderClientList();
    if(state.selectedClientId&&!state.clients.some(c=>Number(c.id)===Number(state.selectedClientId)))state.selectedClientId=state.clients[0]?.id||null;
    await renderClientDetail();
  },180));
  renderClientList();await renderClientDetail();
}
function renderClientList(){
  const host=$("#clientList");if(!host)return;
  if(!state.clients.length){host.innerHTML='<div class="empty-state">Nincs találat.</div>';return;}
  host.innerHTML=state.clients.map(client=>`<button type="button" class="client-row ${Number(client.id)===Number(state.selectedClientId)?"active":""}" data-client-id="${client.id}">
    <span><strong>${esc(client.name)}</strong><small>${esc([client.email,client.phone].filter(Boolean).join(" · ")||"Nincs elérhetőség")}</small></span><span class="count">${Number(client.piano_count||0)}</span>
  </button>`).join("");
  $$("[data-client-id]",host).forEach(button=>button.addEventListener("click",async()=>{state.selectedClientId=Number(button.dataset.clientId);renderClientList();await renderClientDetail();}));
}
async function renderClientDetail(){
  const host=$("#clientDetail");if(!host)return;
  const client=state.clients.find(row=>Number(row.id)===Number(state.selectedClientId));
  if(!client){host.innerHTML='<div class="empty-state">Válassz ügyfelet a listából.</div>';return;}
  host.innerHTML=loading();
  const pianos=await api(`/api/clients/${encodeURIComponent(client.id)}/pianos`);
  host.innerHTML=`<div class="detail-title"><div><span class="eyebrow">ÜGYFÉL #${client.id}</span><h2>${esc(client.name)}</h2></div><div class="page-actions"><button id="editClientBtn" class="secondary-button" type="button">Szerkesztés</button><button id="addPianoBtn" class="primary-button" type="button">＋ Zongora</button></div></div>
    <div class="contact-line">${client.email?`<span class="contact-pill">✉ ${esc(client.email)}</span>`:""}${client.phone?`<span class="contact-pill">☎ ${esc(client.phone)}</span>`:""}${client.address?`<span class="contact-pill">⌂ ${esc(client.address)}</span>`:""}</div>
    ${client.notes?`<div class="detail-note">${esc(client.notes)}</div>`:""}
    <div class="panel-head" style="padding-left:0;padding-right:0;margin-top:18px"><h3>Zongorák</h3><span class="badge">${pianos.length} db</span></div>
    <div class="piano-grid">${pianos.length?pianos.map(piano=>pianoCard(piano)).join(""):'<div class="empty-state">Ehhez az ügyfélhez még nincs zongora.</div>'}</div>`;
  $("#editClientBtn").addEventListener("click",()=>openClientDialog(client));
  $("#addPianoBtn").addEventListener("click",()=>openPianoDialog(client));
}
function pianoCard(piano){
  return `<article class="piano-card"><h3>${esc([piano.brand,piano.model].filter(Boolean).join(" "))}</h3><dl>
    <dt>Gyári szám</dt><dd>${esc(piano.serial_number||"—")}</dd>
    <dt>Kivitel</dt><dd>${esc(piano.finish||"—")}</dd>
    <dt>Hely / megjegyzés</dt><dd>${esc(piano.location_notes||"—")}</dd>
  </dl><div class="service-history"><strong>Szerviztörténet</strong><br>${piano.last_serviced_at?`Utolsó szerviz: ${esc(piano.last_serviced_at)}`:"Még nincs rögzített szervizdátum."}</div></article>`;
}
function clientForm(client={}){
  return `<form id="clientEditor" class="form-grid">
    <label class="field"><span>Név *</span><input name="name" value="${esc(client.name||"")}" required autofocus></label>
    <label class="field"><span>E-mail</span><input name="email" type="email" value="${esc(client.email||"")}"></label>
    <label class="field"><span>Telefon</span><input name="phone" value="${esc(client.phone||"")}"></label>
    <label class="field"><span>Cím</span><input name="address" value="${esc(client.address||"")}"></label>
    <label class="field full"><span>Megjegyzés</span><textarea name="notes">${esc(client.notes||"")}</textarea></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>Mégse</button><button type="submit" class="primary-button">Mentés</button></div>
  </form>`;
}
function openClientDialog(client=null){
  openDialog({title:client?"Ügyfél szerkesztése":"Új ügyfél",eyebrow:"TÖRZSADATOK",body:clientForm(client||{})});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#clientEditor").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));
    try{
      const saved=await api(client?`/api/clients/${client.id}`:"/api/clients",{method:client?"PUT":"POST",body:JSON.stringify(body)});
      state.selectedClientId=Number(saved.id);closeDialog();toast("Ügyfél mentve.","success");await renderMaster();
    }catch(error){toast(humanError(error),"error");}
  });
}
function openPianoDialog(client){
  openDialog({title:"Új zongora",eyebrow:client.name,body:`<form id="pianoEditor" class="form-grid">
    <label class="field"><span>Márka *</span><input name="brand" required autofocus placeholder="Steinway & Sons"></label>
    <label class="field"><span>Modell</span><input name="model" placeholder="B-211"></label>
    <label class="field"><span>Gyári szám</span><input name="serial_number"></label>
    <label class="field"><span>Kivitel</span><input name="finish" placeholder="Ebony"></label>
    <label class="field full"><span>Hely / megjegyzés</span><textarea name="location_notes"></textarea></label>
    <label class="field"><span>Utolsó szerviz</span><input name="last_serviced_at" type="date"></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>Mégse</button><button class="primary-button" type="submit">Zongora mentése</button></div>
  </form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#pianoEditor").addEventListener("submit",async event=>{
    event.preventDefault();
    try{await api(`/api/clients/${client.id}/pianos`,{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast("Zongora hozzáadva.","success");await renderClientDetail();}
    catch(error){toast(humanError(error),"error");}
  });
}

async function renderIntake(){
  const workspace=$("#workspace");
  const [intake,clients,users]=await Promise.all([api("/api/intake"),loadClients(),loadUsers()]);
  state.intake=intake;
  const open=intake.filter(x=>x.status==="new"),urgent=open.filter(x=>x.estimated_urgency==="urgent");
  workspace.innerHTML=`${pageHead("Igényfelmérés","Minden beérkező munkaigény egy helyen, egy kattintással törzsadattá alakítható.",'<button id="newIntakeBtn" class="primary-button" type="button">＋ Új igény</button>')}
    <div class="stats-grid">
      <div class="stat-card"><small>Nyitott igény</small><strong>${open.length}</strong></div>
      <div class="stat-card"><small>Sürgős</small><strong>${urgent.length}</strong></div>
      <div class="stat-card"><small>Konvertált</small><strong>${intake.filter(x=>x.status==="converted").length}</strong></div>
      <div class="stat-card"><small>Ügyfél</small><strong>${clients.length}</strong></div>
    </div>
    <div class="intake-toolbar"><div class="search-field"><input id="intakeSearch" type="search" placeholder="Keresés név, probléma vagy kontakt alapján…"></div>
      <select id="intakeStatusFilter" aria-label="Státusz"><option value="">Minden státusz</option><option value="new">Új</option><option value="converted">Konvertált</option><option value="archived">Archivált</option></select></div>
    <div id="intakeList" class="intake-list"></div>`;
  $("#newIntakeBtn").addEventListener("click",openIntakeDialog);
  $("#intakeSearch").addEventListener("input",renderIntakeList);
  $("#intakeStatusFilter").addEventListener("change",renderIntakeList);
  renderIntakeList();
}
function renderIntakeList(){
  const host=$("#intakeList");if(!host)return;
  const q=String($("#intakeSearch")?.value||"").trim().toLowerCase(),status=$("#intakeStatusFilter")?.value||"";
  const rows=state.intake.filter(row=>(!status||row.status===status)&&(!q||`${row.raw_client_name||""} ${row.client_name||""} ${row.raw_contact||""} ${row.reported_issue||""}`.toLowerCase().includes(q)));
  if(!rows.length){host.innerHTML='<section class="panel empty-state">Nincs megjeleníthető igény.</section>';return;}
  host.innerHTML=rows.map(row=>`<article class="intake-card ${esc(row.estimated_urgency)}">
    <div class="urgency-bar"></div><div><h3>${esc(row.client_name||row.raw_client_name||"Új érdeklődő")}</h3><p>${esc(row.reported_issue)}</p>
      <div class="intake-meta"><span class="badge ${esc(row.estimated_urgency)}">${row.estimated_urgency==="urgent"?"Sürgős":row.estimated_urgency==="low"?"Alacsony":"Normál"}</span>
      <span class="badge">${row.service_location==="on_site"?"Helyszíni":"Műhely"}</span>
      ${row.raw_contact?`<span class="badge">${esc(row.raw_contact)}</span>`:""}
      ${row.assigned_technician_name?`<span class="badge">👤 ${esc(row.assigned_technician_name)}</span>`:""}
      ${row.status==="converted"?'<span class="badge converted">Konvertált</span>':""}</div></div>
    ${intakeAction(row)}
  </article>`).join("");
  $("[data-convert-id]",host).forEach(button=>button.addEventListener("click",()=>openConvertDialog(state.intake.find(row=>Number(row.id)===Number(button.dataset.convertId)))));
  $("[data-plan-intake]",host).forEach(button=>button.addEventListener("click",()=>createJobFromIntake(Number(button.dataset.planIntake))));
}
function openIntakeDialog(){
  const technicianOptions=state.users.filter(u=>["WORKER","MANAGER","ADMIN"].includes(u.role)).map(u=>`<option value="${esc(u.id)}">${esc(u.name)} · ${esc(roleLabel(u.role))}</option>`).join("");
  const clientOptions=state.clients.map(c=>`<option value="${esc(c.name)}"></option>`).join("");
  openDialog({title:"Új igény",eyebrow:"IGÉNYFELMÉRÉS",body:`<form id="intakeEditor" class="form-grid">
    <label class="field full"><span>Meglévő ügyfél keresése</span><input id="intakeClientSearch" name="client_name" list="clientDatalist" autocomplete="off" placeholder="Kezdj el gépelni…"><datalist id="clientDatalist">${clientOptions}</datalist></label>
    <input type="hidden" name="client_id" id="intakeClientId">
    <label class="field"><span>Új / nyers név</span><input name="raw_client_name"></label>
    <label class="field"><span>Kontakt</span><input name="raw_contact" placeholder="telefon vagy e-mail"></label>
    <label class="field"><span>Helyszín</span><select name="service_location"><option value="workshop">Műhely</option><option value="on_site">Helyszíni</option></select></label>
    <label class="field"><span>Sürgősség</span><select name="estimated_urgency"><option value="low">Alacsony</option><option value="normal" selected>Normál</option><option value="urgent">Sürgős</option></select></label>
    <label class="field full"><span>Technikus</span><select name="assigned_technician_id"><option value="">Nincs kiosztva</option>${technicianOptions}</select></label>
    <label class="field full"><span>Jelzett probléma / igény *</span><textarea name="reported_issue" required autofocus></textarea></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>Mégse</button><button class="primary-button" type="submit">Igény rögzítése</button></div>
  </form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#intakeClientSearch").addEventListener("input",event=>{
    const match=state.clients.find(c=>c.name.toLowerCase()===event.target.value.trim().toLowerCase());
    $("#intakeClientId").value=match?.id||"";
  });
  $("#intakeEditor").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));delete body.client_name;
    if(!body.client_id)delete body.client_id;if(!body.assigned_technician_id)delete body.assigned_technician_id;
    try{await api("/api/intake",{method:"POST",body:JSON.stringify(body)});closeDialog();toast("Igény rögzítve.","success");await renderIntake();}
    catch(error){toast(humanError(error),"error");}
  });
}
async function openConvertDialog(lead){
  let pianos=[];
  if(lead.client_id)pianos=await api(`/api/clients/${lead.client_id}/pianos`);
  const pianoOptions=pianos.map(p=>`<option value="${p.id}">${esc([p.brand,p.model,p.serial_number].filter(Boolean).join(" · "))}</option>`).join("");
  openDialog({title:"Igény konvertálása",eyebrow:"1 KATTINTÁSOS KONVERZIÓ",body:`<form id="convertEditor" class="form-grid">
    <div class="full detail-note">${esc(lead.reported_issue)}</div>
    ${lead.client_id?`<div class="full"><strong>Ügyfél:</strong> ${esc(lead.client_name||lead.raw_client_name||lead.client_id)}</div>`:`
      <label class="field"><span>Ügyfél neve *</span><input name="client_name" value="${esc(lead.raw_client_name||"")}" required></label>
      <label class="field"><span>E-mail</span><input name="client_email" type="email" value="${esc(/@/.test(lead.raw_contact||"")?lead.raw_contact:"")}"></label>
      <label class="field"><span>Telefon</span><input name="client_phone" value="${esc(!/@/.test(lead.raw_contact||"")?lead.raw_contact:"")}"></label>
      <label class="field"><span>Cím</span><input name="client_address"></label>`}
    ${lead.piano_id?'<div class="full"><strong>A lead már zongorához kapcsolódik.</strong></div>':`
      ${pianos.length?`<label class="field full"><span>Meglévő zongora (opcionális)</span><select name="piano_id"><option value="">Új zongora létrehozása</option>${pianoOptions}</select></label>`:""}
      <label class="field"><span>Új zongora márkája *</span><input name="brand" placeholder="Steinway & Sons"></label>
      <label class="field"><span>Modell</span><input name="model"></label>
      <label class="field"><span>Gyári szám</span><input name="serial_number"></label>
      <label class="field"><span>Kivitel</span><input name="finish"></label>
      <label class="field full"><span>Hely / megjegyzés</span><textarea name="location_notes"></textarea></label>`}
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>Mégse</button><button type="submit" class="primary-button">Konvertálás</button></div>
  </form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#convertEditor").addEventListener("submit",async event=>{
    event.preventDefault();const form=Object.fromEntries(new FormData(event.currentTarget));
    const body={};
    if(!lead.client_id)body.client={name:form.client_name,email:form.client_email,phone:form.client_phone,address:form.client_address};
    if(!lead.piano_id){
      if(form.piano_id)body.piano_id=Number(form.piano_id);
      else body.piano={brand:form.brand,model:form.model,serial_number:form.serial_number,finish:form.finish,location_notes:form.location_notes};
    }
    try{await api(`/api/intake/${lead.id}/convert`,{method:"POST",body:JSON.stringify(body)});closeDialog();toast("Igény konvertálva.","success");await renderIntake();}
    catch(error){toast(humanError(error),"error");}
  });
}

async function renderCms(){
  const workspace=$("#workspace");
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role)){
    workspace.innerHTML=`${pageHead("Weboldal CMS","A landing page szerkesztése admin jogosultsághoz kötött.")}<section class="panel empty-state">Nincs jogosultságod a CMS-hez.</section>`;return;
  }
  const meta=await api("/api/website-content/pages");
  state.cmsPages=meta.pages||[];if(!state.cmsPages.some(p=>p.page_key===state.cmsPage))state.cmsPage=state.cmsPages[0]?.page_key||"home";
  workspace.innerHTML=`${pageHead("Weboldal CMS","A meglévő publikus weboldal kép-, szöveg- és landing-szekció kezelése.")}
    <div class="cms-layout">
      <aside class="panel cms-sidebar" id="cmsPageList">${state.cmsPages.map(page=>`<button class="cms-page-button ${page.page_key===state.cmsPage?"active":""}" data-cms-page="${esc(page.page_key)}" type="button">${esc(page.title_en||page.page_key)}</button>`).join("")}</aside>
      <section class="panel cms-editor" id="cmsEditor">${loading()}</section>
    </div>`;
  $$("[data-cms-page]").forEach(button=>button.addEventListener("click",async()=>{state.cmsPage=button.dataset.cmsPage;$$("[data-cms-page]").forEach(x=>x.classList.toggle("active",x===button));await loadCmsPage();}));
  await loadCmsPage();
}
async function loadCmsPage(){
  const host=$("#cmsEditor");host.innerHTML=loading();
  const [page,landing]=await Promise.all([
    api(`/api/website-content/${encodeURIComponent(state.cmsPage)}?lang=${state.cmsLanguage}`),
    api("/api/landing-sections").catch(()=>[])
  ]);
  state.landing=Array.isArray(landing)?landing:[];
  host.innerHTML=`<div class="cms-toolbar"><div><span class="eyebrow">OLDAL</span><h2 style="margin:0">${esc(state.cmsPage)}</h2></div>
    <label class="field" style="display:flex;align-items:center;gap:8px"><span>Nyelv</span><select id="cmsLanguage"><option value="en" ${state.cmsLanguage==="en"?"selected":""}>English</option><option value="hu" ${state.cmsLanguage==="hu"?"selected":""}>Magyar</option></select></label></div>
    <label class="field"><span>Tartalom JSON</span><textarea id="cmsJson" spellcheck="false">${esc(JSON.stringify(page.content||{},null,2))}</textarea></label>
    <div class="form-actions"><button id="saveCmsBtn" class="primary-button" type="button">Mentés és publikálás</button></div>
    <div class="cms-upload"><label class="field"><span>Kép feltöltése a meglévő website media API-val</span><input id="cmsImageFile" type="file" accept="image/*"></label><button id="uploadCmsImage" class="secondary-button" type="button">Kép feltöltése</button><div id="imageUploadResult" class="muted full"></div></div>
    ${state.cmsPage==="home"?`<div style="margin-top:22px"><div class="panel-head" style="padding-left:0;padding-right:0"><h3>Landing szekciók</h3><button id="saveLandingBtn" class="secondary-button" type="button">Szekciók mentése</button></div>
      <div id="landingList" class="landing-list">${state.landing.map((row,index)=>`<label class="landing-row"><input type="checkbox" data-landing-key="${esc(row.section_key)}" ${Number(row.is_active)===1?"checked":""}><span>${esc(row.section_key)}</span><small>#${index+1}</small></label>`).join("")}</div></div>`:""}`;
  $("#cmsLanguage").addEventListener("change",async event=>{state.cmsLanguage=event.target.value;await loadCmsPage();});
  $("#saveCmsBtn").addEventListener("click",async()=>{
    let content;try{content=JSON.parse($("#cmsJson").value);}catch(_error){toast("A JSON formátum hibás.","error");return;}
    try{await api(`/api/website-content/${encodeURIComponent(state.cmsPage)}`,{method:"PUT",body:JSON.stringify({language:state.cmsLanguage,content})});toast("Weboldal tartalma publikálva.","success");}
    catch(error){toast(humanError(error),"error");}
  });
  $("#uploadCmsImage").addEventListener("click",async()=>{
    const file=$("#cmsImageFile").files?.[0];if(!file){toast("Válassz képet.","error");return;}
    const form=new FormData();form.set("image",file);
    try{const result=await api("/api/website-content/image",{method:"POST",body:form});$("#imageUploadResult").innerHTML=`Feltöltve: <code>${esc(result.image_url)}</code> <button id="copyImageUrl" class="text-button" type="button">Másolás</button>`;$("#copyImageUrl").addEventListener("click",()=>navigator.clipboard?.writeText(result.image_url));toast("Kép feltöltve.","success");}
    catch(error){toast(humanError(error),"error");}
  });
  $("#saveLandingBtn")?.addEventListener("click",async()=>{
    const sections=$$("[data-landing-key]").map((box,index)=>({section_key:box.dataset.landingKey,is_active:box.checked?1:0,order_index:index}));
    try{await api("/api/landing-sections",{method:"PUT",body:JSON.stringify({sections})});toast("Landing szekciók mentve.","success");}
    catch(error){toast(humanError(error),"error");}
  });
}

async function renderProfile(){
  const workspace=$("#workspace"),users=await loadUsers();
  const canManage=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  workspace.innerHTML=`${pageHead("Profil & Beállítások","Saját fiók, csapattagok és kijelentkezés.",canManage?'<button id="newUserBtn" class="primary-button" type="button">＋ Új felhasználó</button>':"")}
    <div class="profile-grid">
      <section class="panel profile-card"><div class="profile-avatar">${esc(initials(state.user?.name))}</div><h2>${esc(state.user?.name)}</h2><p class="muted">${esc(state.user?.email||"")}</p><span class="role-chip">${esc(roleLabel(state.user?.role))}</span>
        <div class="form-actions" style="justify-content:flex-start"><button id="logoutBtn" class="danger-button" type="button">Kijelentkezés</button></div></section>
      <section class="panel"><div class="panel-head"><h2>Csapat</h2><span class="badge">${users.length} fő</span></div><div class="team-list">${users.map(user=>`<div class="team-row"><span><strong>${esc(user.name)}</strong><small>${esc(user.email||user.contact_email||"")}</small></span><span class="role-chip">${esc(roleLabel(user.role))}</span></div>`).join("")}</div></section>
    </div>
    <div style="margin-top:16px" class="coming-grid">
      <article class="coming-card"><span>📋</span><h3>Műhely &amp; Naptár</h3><p class="muted">Aktív · 5 oszlopos workflow és közös naptár.</p></article>
      <article class="coming-card"><span>⏳</span><h3>Tervezett munkák</h3><p class="muted">Aktív · ütemezés előtti munkák.</p></article>
      <article class="coming-card"><span>💰</span><h3>Pénzügy</h3><p class="muted">A 3. körben aktiváljuk.</p></article>
    </div>`;
  $("#logoutBtn").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"});}catch(_error){}clearSession();showLogin();});
  $("#newUserBtn")?.addEventListener("click",openUserDialog);
}
function openUserDialog(){
  openDialog({title:"Új felhasználó",eyebrow:"FELHASZNÁLÓKEZELÉS",body:`<form id="userEditor" class="form-grid">
    <label class="field"><span>Név *</span><input name="name" required autofocus></label>
    <label class="field"><span>Szerepkör *</span><select name="role"><option value="WORKER">Technikus</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></label>
    <label class="field"><span>Belépési e-mail *</span><input name="email" type="email" required></label>
    <label class="field"><span>Kapcsolati e-mail *</span><input name="contact_email" type="email" required></label>
    <label class="field"><span>Telefon</span><input name="phone"></label><label class="field"><span>Cím</span><input name="address"></label>
    <label class="field"><span>Ideiglenes jelszó *</span><input name="password" type="password" minlength="8" required></label>
    <label class="field"><span>Jelszó újra *</span><input name="password_confirmation" type="password" minlength="8" required></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>Mégse</button><button class="primary-button" type="submit">Felhasználó létrehozása</button></div>
  </form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#userEditor").addEventListener("submit",async event=>{
    event.preventDefault();
    try{await api("/api/users",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast("Felhasználó létrehozva.","success");await renderProfile();}
    catch(error){toast(humanError(error),"error");}
  });
}

function debounce(fn,wait=180){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait);};}

$("#loginForm").addEventListener("submit",async event=>{
  event.preventDefault();const button=$('button[type="submit"]',event.currentTarget);button.disabled=true;
  try{
    const payload=await api("/api/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});
    if(payload.activation_required){
      sessionStorage.setItem("kh_activation_token",payload.activation_token);
      $("#loginForm").classList.add("hidden");$("#activationForm").classList.remove("hidden");
      $("#activationHint").textContent=`A kódot ide küldtük: ${payload.contact_email_masked||"a kapcsolati e-mail címre"}`;
      $("#activationCode").focus();return;
    }
    setSession(payload);showApp();await renderView();
  }catch(error){toast(humanError(error),"error");}
  finally{button.disabled=false;}
});
$("#activationForm").addEventListener("submit",async event=>{
  event.preventDefault();
  try{
    const payload=await api("/api/account-activation/verify",{method:"POST",body:JSON.stringify({activation_token:sessionStorage.getItem("kh_activation_token"),activation_code:$("#activationCode").value})});
    sessionStorage.removeItem("kh_activation_token");setSession(payload);showApp();await renderView();
  }catch(error){toast(humanError(error),"error");}
});
$("#resendActivationBtn").addEventListener("click",async()=>{
  try{const payload=await api("/api/account-activation/resend",{method:"POST",body:JSON.stringify({activation_token:sessionStorage.getItem("kh_activation_token")})});sessionStorage.setItem("kh_activation_token",payload.activation_token);toast("Új aktiváló kód elküldve.","success");}
  catch(error){toast(humanError(error),"error");}
});
$("#backToLoginBtn").addEventListener("click",()=>{$("#activationForm").classList.add("hidden");$("#loginForm").classList.remove("hidden");sessionStorage.removeItem("kh_activation_token");});

async function boot(){
  await loadBranding();bindNavigation();
  if(!state.token){showLogin();return;}
  try{state.user=await api("/api/me");showApp();if(!activeViews.has(state.view))state.view="workshop";await renderView();}
  catch(_error){clearSession();showLogin();}
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/service-worker.js").catch(()=>{}),{once:true});
}
// Round 2 UI extension invokes boot() after its functions are registered.
