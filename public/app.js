"use strict";

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const state={
  token:sessionStorage.getItem("kh_token")||"",
  user:null,
  language:localStorage.getItem("kh_language")==="hu"?"hu":"en",
  view:(location.hash||"#workshop").slice(1)||"workshop",
  clients:[],selectedClientId:null,intake:[],users:[],
  cmsPages:[],cmsPage:"home",cmsLanguage:"en",cmsDraft:{},landing:[],clockTimer:null,
  notifications:[],notificationPreferences:null,notificationTimer:null,notificationSource:null,notificationReconnectTimer:null,notificationSeen:new Set(),notificationInitialized:false,notificationUiBound:false
};
const activeViews=new Set(["workshop","planned","intake","master","finance","documents","cms","profile"]);
const tr=(en,hu)=>state.language==="hu"?hu:en;
const initials=name=>String(name||"KH").split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase();
const roleLabel=role=>role==="WORKER"?tr("Technician","Technikus"):role==="SUPERADMIN"?tr("Super Admin","Szuperadmin"):role==="ADMIN"?tr("Admin","Admin"):role==="MANAGER"?tr("Manager","Menedzser"):role||"";

const chromeText={
  login_copy:["Sign in to the Klavierhaus internal workspace.","Jelentkezz be a Klavierhaus belső munkafelületére."],
  email:["Email","E-mail"],password:["Password","Jelszó"],sign_in:["Sign in","Bejelentkezés"],
  account_activation:["ACCOUNT ACTIVATION","FIÓK AKTIVÁLÁS"],confirm_login:["Confirm your login","Erősítsd meg a belépést"],
  six_digit_code:["6-digit code","6 jegyű kód"],activate:["Activate","Aktiválás"],resend_code:["Send a new code","Új kód küldése"],back_to_login:["Back to login","Vissza a belépéshez"],
  nav_workshop:["Workshop & Calendar","Műhely & Naptár"],nav_intake:["Intake","Igényfelmérés"],nav_planned:["Planned Jobs","Tervezett munkák"],
  nav_master:["Master Data","Törzsadatok"],nav_finance:["Finance","Pénzügy"],nav_documents:["Documents","Dokumentumok"],nav_cms:["Website CMS","Weboldal CMS"],
  mobile_workshop:["Workshop","Műhely"],mobile_planned:["Planned","Tervezett"],mobile_intake:["Intake","Igény"],mobile_master:["Master","Törzs"],
  mobile_finance:["Finance","Pénzügy"],mobile_profile:["Profile","Profil"],new_york_time:["New York time","New York-i idő"]
};
function applyChromeLanguage(){
  document.documentElement.lang=state.language;
  $$("[data-i18n]").forEach(node=>{
    const pair=chromeText[node.dataset.i18n];
    if(pair)node.textContent=state.language==="hu"?pair[1]:pair[0];
  });
  const toggle=$("#languageToggle");if(toggle)toggle.textContent=state.language==="en"?"HU":"EN";
  const profile=$("#profileButton");if(profile)profile.setAttribute("aria-label",tr("Profile and settings","Profil és beállítások"));
  const close=$("#appDialog [data-dialog-close]");if(close)close.setAttribute("aria-label",tr("Close","Bezárás"));
  updateNewYorkClock();
}
function setLanguage(language){
  state.language=language==="hu"?"hu":"en";
  localStorage.setItem("kh_language",state.language);
  applyChromeLanguage();
  if(!$("#appShell")?.classList.contains("hidden"))void renderView();
}
function toast(message,type=""){
  const host=$("#toastRegion"),item=document.createElement("div");
  item.className=`toast ${type}`;item.textContent=String(message||"");
  host.append(item);setTimeout(()=>item.remove(),4200);
}
function humanError(error){
  const code=String(error?.message||error||"");
  const map={
    AUTH_REQUIRED:["Your session has expired.","A munkamenet lejárt."],INVALID_TOKEN:["Your session has expired.","A munkamenet lejárt."],SESSION_REVOKED:["Your session has expired.","A munkamenet lejárt."],
    CLIENT_NAME_REQUIRED:["Client name is required.","Az ügyfél neve kötelező."],INVALID_CLIENT_EMAIL:["Invalid client email.","Érvénytelen ügyfél e-mail."],
    PIANO_BRAND_REQUIRED:["Piano brand is required.","A zongora márkája kötelező."],PIANO_DETAILS_REQUIRED:["Piano details are required.","A zongora adatai szükségesek."],
    REPORTED_ISSUE_REQUIRED:["Describe the requested service or issue.","A hiba vagy igény leírása kötelező."],INVALID_PIANO_ID:["The selected piano does not belong to this client.","A kiválasztott zongora nem ehhez az ügyfélhez tartozik."],
    PERMISSION_DENIED:["You do not have permission for this action.","Nincs jogosultság ehhez a művelethez."],ADMIN_REQUIRED:["Admin permission is required.","Admin jogosultság szükséges."],
    JOB_TITLE_REQUIRED:["Job title is required.","A munka megnevezése kötelező."],JOB_MUST_BE_ACTIVATED:["Activate and schedule this job first.","A munkát előbb aktiválni és ütemezni kell."],
    TECHNICIAN_REQUIRED_FOR_SCHEDULE:["Choose a technician before scheduling.","Ütemezéshez technikust kell választani."],SCHEDULE_CONFLICT:["This technician already has an overlapping job.","A technikusnak ebben az időpontban már van másik munkája."],
    INTAKE_JOB_ALREADY_EXISTS:["A planned job already exists for this intake.","Ehhez az igényhez már tartozik tervezett munka."],JOB_ASSIGNED_TO_ANOTHER_TECHNICIAN:["This job is assigned to another technician.","A munka másik technikushoz van rendelve."],
    ADMIN_CLOSEOUT_REQUIRED:["Admin approval is required to complete the job.","A munkát Admin zárhatja le."],JOB_NOT_READY_FOR_CLOSEOUT:["Move the job to Admin Approval first.","A munkát előbb Admin Jóváhagyás fázisba kell tenni."],
    JOB_NOT_READY_FOR_INVOICE:["The job is not ready for invoicing.","A munka még nem számlázható."],JOB_CANCELLED:["This job was cancelled.","A munka megszakításra került."],
    CANCEL_REASON_REQUIRED:["A reason is required.","Az ok megadása kötelező."],INVALID_HANDOFF_COST:["Costs cannot be negative.","A költség nem lehet negatív."],
    INVOICE_ITEMS_REQUIRED:["Add at least one invoice line.","Adj hozzá legalább egy számlatételt."],INVOICE_ITEM_DESCRIPTION_REQUIRED:["Invoice line description is required.","A számlatétel megnevezése kötelező."],
    INVALID_INVOICE_ITEM_QUANTITY:["Quantity must be greater than zero.","A mennyiség legyen nagyobb nullánál."],INVALID_INVOICE_ITEM_PRICE:["Invalid invoice line price.","Érvénytelen egységár."],
    ONLY_DRAFT_INVOICE_EDITABLE:["Only draft invoices can be edited.","Csak a piszkozat számla módosítható."],CLIENT_EMAIL_REQUIRED:["The client has no email address.","Az ügyfélhez nincs e-mail cím."],
    EMAIL_DELIVERY_NOT_CONFIGURED:["Email delivery is not configured.","Az e-mail küldés nincs konfigurálva."],EMAIL_DELIVERY_FAILED:["Invoice email delivery failed. The invoice remains pending.","A számla e-mail küldése sikertelen. A számla várakozó maradt."],
    INVOICE_NOT_SENT:["Only a sent invoice can be marked paid.","Csak elküldött számla jelölhető fizetettnek."],INVALID_PAYMENT_METHOD:["Choose a valid payment method.","Válassz érvényes fizetési módot."],
    PAID_INVOICE_CANNOT_BE_CANCELLED:["A paid invoice cannot be cancelled.","Fizetett számla nem érvényteleníthető."],PARTNER_HAS_INVOICES:["This partner is linked to invoices.","A partner számlához kapcsolódik."],
    SUPERADMIN_REQUIRED:["Super Admin permission is required.","Super Admin jogosultság szükséges."],INVALID_INTAKE_MEDIA_TYPE:["Use a supported photo or video file.","Támogatott fotó- vagy videófájlt válassz."],
    TOO_MANY_INTAKE_MEDIA:["Maximum 20 media files are allowed.","Legfeljebb 20 médiafájl csatolható."],INVALID_INTAKE_MEDIA_URL:["Invalid media attachment.","Érvénytelen médiacsatolmány."],
    INVALID_THEME:["Choose light or dark mode.","Válassz világos vagy sötét módot."],
    INTAKE_CATALOG_REQUIRED_FIELDS:["Category and both English/Hungarian titles are required.","A kategória, valamint az angol és magyar megnevezés kötelező."],
    INVALID_INTAKE_CATALOG_PRICE:["The assessment price is invalid.","Az igényfelmérési ár érvénytelen."],
    INTAKE_CATALOG_ITEM_NOT_FOUND:["The selected assessment item no longer exists.","A kiválasztott igényfelmérési tétel már nem létezik."],
    INVALID_RECEIPT_FILE_TYPE:["Upload an image, PDF or supported office document.","Képet, PDF-et vagy támogatott irodai dokumentumot tölts fel."],
    RECEIPT_FILE_REQUIRED:["Choose a receipt or document first.","Előbb válassz nyugtát vagy dokumentumot."],
    CANNOT_DELETE_SELF:["You cannot delete your own account.","A saját felhasználói fiókodat nem törölheted."],
    LAST_ADMIN_CANNOT_BE_DELETED:["The last active Admin cannot be deleted.","Az utolsó aktív Admin nem törölhető."],
    HIDDEN_OWNER_PROTECTED:["This protected owner account cannot be deleted.","Ez a védett tulajdonosi fiók nem törölhető."],
    WORKFLOW_REQUIRES_ACTIVE_PHASE:["Choose at least one working phase before Completed.","A Lezárva előtt legalább egy munkafázist válassz."],
    WORKFLOW_LABEL_REQUIRED:["Both English and Hungarian workflow names are required.","Az angol és magyar fázisnév is kötelező."],
    CURRENT_WORKFLOW_PHASE_REQUIRED:["The current phase cannot be removed from an active workflow.","Az aktuális fázis nem távolítható el az aktív munkafolyamatból."],
    INVALID_BLOCKER_CODE:["Choose a valid delay reason.","Válassz érvényes elakadási okot."],
    INVALID_WORKFLOW_DUE_AT:["The phase deadline is invalid.","A fázis határideje érvénytelen."],
    JOB_NOT_READY_FOR_CLOSEOUT:["Complete the remaining enabled phases first.","Előbb zárd le a még aktív munkafázisokat."],
    INVALID_WORKFLOW_BUCKET:["Choose Active or Closed workflows.","Válaszd az Aktív vagy Lezárt munkafolyamatokat."],
    INVOICE_DELETE_REQUIRES_DRAFT_OR_CANCELLED:["Only draft or cancelled invoices can be removed to the archive.","Csak piszkozat vagy érvénytelenített számla helyezhető át az archívumba."],
    INVALID_ARCHIVE_CATEGORY:["Choose a valid archive category.","Válassz érvényes archív kategóriát."],
    ARCHIVE_TITLE_REQUIRED:["Enter a title for the archive record.","Adj címet az archivált tételnek."],
    INVALID_ARCHIVE_FILE_TYPE:["Use a supported document or image file.","Támogatott dokumentum- vagy képfájlt válassz."],
    ARCHIVE_DOCUMENT_NOT_FOUND:["The archive record no longer exists.","Az archív tétel már nem létezik."],
    ARCHIVE_FILE_NOT_FOUND:["The archived file is not available.","Az archivált fájl nem érhető el."],
    WORKFLOW_FIXED_STAGE_REQUIRED:["Received, Admin Approval and Completed are required.","A Beérkezett, Admin jóváhagyás és Lezárva fázis kötelező."],
    WORKFLOW_STAGE_LIMIT_REACHED:["The workflow already has the maximum seven phases.","A munkafolyamat már elérte a legfeljebb hét fázist."],
    INVALID_WORKFLOW_STAGE_ORDER:["The workflow phase order is invalid.","A munkafázisok sorrendje érvénytelen."],
    WORKFLOW_FIXED_STAGE_ORDER:["Received must stay first and Admin Approval must stay last.","A Beérkezettnek elsőnek, az Admin jóváhagyásnak utolsónak kell maradnia."],
    WORKFLOW_STAGE_NOT_REMOVABLE:["This system workflow phase cannot be removed.","Ez a rendszerfázis nem távolítható el."],
    WORKFLOW_STAGE_IN_USE:["Move the active job out of this phase before removing it.","A fázis eltávolítása előtt helyezd át az aktív munkát másik fázisba."],
    WORKFLOW_START_STAGE_FIXED:["The Received phase is the fixed workflow start.","A Beérkezett fázis a munkafolyamat rögzített kezdete."],
    WORKFLOW_PHASE_NOT_AVAILABLE:["The selected workflow phase is not available for this job.","A kiválasztott munkafázis ennél a munkánál nem érhető el."],
    WORKFLOW_PHASE_ALREADY_COMPLETED:["That workflow phase has already been completed.","Ez a munkafázis már lezárult."],
    WORKFLOW_PHASES_REMAINING:["Complete the remaining intermediate phases before Admin Approval.","Az Admin jóváhagyás előtt zárd le a még nyitott köztes fázisokat."],
    INVALID_CLOSED_WORKFLOW_TYPE:["Choose Completed or Cancelled workflows.","Válassz a Lezárt vagy Törölt munkafolyamatok közül."],
    INVALID_RESPONSIBLE_USER_ID:["Choose an active workflow responsible person.","Válassz aktív munkafolyamat-felelőst."]
  };
  const pair=map[code];
  return pair?(state.language==="hu"?pair[1]:pair[0]):code.replaceAll("_"," ");
}
async function api(url,options={}){
  const headers={Accept:"application/json",...(options.headers||{})};
  if(state.token)headers.Authorization=`Bearer ${state.token}`;
  if(options.body!==undefined&&!(options.body instanceof FormData)&&!headers["Content-Type"])headers["Content-Type"]="application/json";
  const response=await fetch(url,{...options,headers,cache:"no-store"});
  const type=response.headers.get("content-type")||"";
  const data=type.includes("application/json")?await response.json().catch(()=>({})):await response.text();
  if(!response.ok){
    if(response.status===401&&state.token){clearSession();showLogin();}
    const error=new Error(data?.error||`HTTP_${response.status}`);error.status=response.status;error.payload=data;throw error;
  }
  return data;
}
function setSession(payload){
  state.token=payload.token;state.user=payload.user;
  sessionStorage.setItem("kh_token",state.token);sessionStorage.setItem("kh_user",JSON.stringify(state.user));
}
function clearSession(){
  state.token="";state.user=null;sessionStorage.removeItem("kh_token");sessionStorage.removeItem("kh_user");
  clearInterval(state.notificationTimer);state.notificationTimer=null;clearTimeout(state.notificationReconnectTimer);state.notificationReconnectTimer=null;state.notificationSource?.close?.();state.notificationSource=null;state.notifications=[];state.notificationInitialized=false;state.notificationSeen=new Set();updateAppBadge(0);closeNotificationDrawer();
}
function showLogin(){$("#loginScreen").classList.remove("hidden");$("#appShell").classList.add("hidden");}
function updateNewYorkClock(){
  const now=new Date(),locale=state.language==="hu"?"hu-HU":"en-US";
  const time=$("#newYorkClock"),date=$("#newYorkDate");
  if(time)time.textContent=new Intl.DateTimeFormat(locale,{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:state.language!=="hu"}).format(now);
  if(date)date.textContent=new Intl.DateTimeFormat(locale,{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric",year:"numeric"}).format(now);
}
function startNewYorkClock(){
  updateNewYorkClock();
  if(state.clockTimer)clearInterval(state.clockTimer);
  state.clockTimer=setInterval(updateNewYorkClock,1000);
}
function showApp(){
  $("#loginScreen").classList.add("hidden");$("#appShell").classList.remove("hidden");
  $("#profileInitials").textContent=initials(state.user?.name);
  startNewYorkClock();initNotificationCenter();
}
function notificationText(row,field){
  return String(state.language==="hu"?(row?.[field+"_hu"]||row?.[field+"_en"]||""):(row?.[field+"_en"]||row?.[field+"_hu"]||""));
}
function notificationDate(value){
  if(!value)return "";
  try{return new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));}
  catch(_error){return String(value||"");}
}
function notificationSeverityIcon(value){
  return ({URGENT:"!",WARNING:"!",SUCCESS:"✓",INFO:"•"})[String(value||"INFO").toUpperCase()]||"•";
}
function updateAppBadge(count){
  const value=Math.max(0,Number(count)||0);
  const badge=$("#notificationBadge");if(badge){badge.hidden=value<=0;badge.textContent=value>99?"99+":String(value);}
  try{
    if(value>0&&navigator.setAppBadge)void navigator.setAppBadge(value);
    else if(value<=0&&navigator.clearAppBadge)void navigator.clearAppBadge();
  }catch(_error){}
}
function playNotificationSound(){
  if(!state.notificationPreferences?.sound_enabled)return;
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
    const ctx=new AudioCtx(),gain=ctx.createGain();gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.12,ctx.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.42);gain.connect(ctx.destination);
    const a=ctx.createOscillator(),b=ctx.createOscillator();a.type="sine";b.type="sine";a.frequency.setValueAtTime(660,ctx.currentTime);b.frequency.setValueAtTime(880,ctx.currentTime+.12);a.connect(gain);b.connect(gain);a.start();b.start(ctx.currentTime+.12);a.stop(ctx.currentTime+.22);b.stop(ctx.currentTime+.42);setTimeout(()=>ctx.close().catch(()=>{}),700);
  }catch(_error){}
}
function notificationCard(row){
  const title=notificationText(row,"title"),body=notificationText(row,"body"),severity=String(row.severity||"INFO").toLowerCase();
  return `<article class="notification-card severity-${esc(severity)} ${row.read_at?"is-read":"is-unread"}" data-notification-card="${esc(row.id)}">
    <button class="notification-card-close" type="button" data-notification-snooze="${esc(row.id)}" title="${tr("Dismiss for 3 hours","Bezárás 3 órára")}" aria-label="${tr("Dismiss for 3 hours","Bezárás 3 órára")}">×</button>
    <div class="notification-card-icon" aria-hidden="true">${esc(notificationSeverityIcon(row.severity))}</div>
    <div class="notification-card-body"><div class="notification-card-title"><strong>${esc(title)}</strong><small>${esc(notificationDate(row.created_at))}</small></div>
      ${body?`<p>${esc(body)}</p>`:""}
      <div class="notification-card-actions">
        <button class="text-button" type="button" data-notification-remind="${esc(row.id)}">${tr("Remind later","Értesíts később")}</button>
        <button class="primary-button compact-button" type="button" data-notification-done="${esc(row.id)}">✓ ${tr("Done","Tudomásul vettem")}</button>
      </div>
    </div>
  </article>`;
}
function renderNotificationDrawer(){
  const list=$("#notificationList");if(!list)return;
  const rows=state.notifications||[];
  list.innerHTML=rows.length?rows.map(notificationCard).join(""):`<div class="notification-empty"><span>✓</span><strong>${tr("You're up to date.","Minden naprakész.")}</strong><p>${tr("No active notifications need attention.","Nincs aktív értesítés, amellyel foglalkozni kell.")}</p></div>`;
  const title=$("#notificationDrawerTitle");if(title)title.textContent=tr("Notifications","Értesítések");
  const soundLabel=$("#notificationSoundLabel");if(soundLabel)soundLabel.textContent=tr("Sound","Hang");
  const snoozeAll=$("#notificationSnoozeAll");if(snoozeAll)snoozeAll.textContent=tr("Dismiss all · 3h","Összes bezárása · 3 óra");
  const sound=$("#notificationSoundToggle");if(sound)sound.checked=Boolean(state.notificationPreferences?.sound_enabled);
  $$("[data-notification-snooze]",list).forEach(button=>button.addEventListener("click",async event=>{event.stopPropagation();await snoozeNotification(button.dataset.notificationSnooze,3);}));
  $$("[data-notification-done]",list).forEach(button=>button.addEventListener("click",async event=>{event.stopPropagation();await acknowledgeNotification(button.dataset.notificationDone);}));
  $$("[data-notification-remind]",list).forEach(button=>button.addEventListener("click",event=>{event.stopPropagation();openNotificationReminder(button.dataset.notificationRemind);}));
  $$("[data-notification-card]",list).forEach(card=>card.addEventListener("click",async event=>{
    if(event.target.closest("button,input"))return;const id=card.dataset.notificationCard,row=rows.find(item=>String(item.id)===String(id));
    try{await api("/api/notifications/"+encodeURIComponent(id)+"/read",{method:"POST",body:"{}"});}catch(_error){}
    if(row?.action_url){
      closeNotificationDrawer({restoreFocus:false});
      if(row.action_url.includes("private=1")){state.view="workshop";state.r2WorkshopMode="workflow";void renderView().then(()=>r2LoadPrivateAppointments?.());}
      else if(row.action_url.startsWith("#"))navTo(row.action_url.slice(1));
    }
    card.classList.remove("is-unread");card.classList.add("is-read");
  }));
}
async function refreshNotifications({allowSound=true}={}){
  if(!state.token||!state.user)return;
  try{
    const payload=await api("/api/notifications");
    const rows=Array.isArray(payload.notifications)?payload.notifications:[],previous=state.notificationSeen;
    state.notifications=rows;state.notificationPreferences=payload.preferences||state.notificationPreferences;
    const ids=new Set(rows.map(row=>String(row.id))),newRows=state.notificationInitialized?rows.filter(row=>!previous.has(String(row.id))):[];
    state.notificationSeen=ids;state.notificationInitialized=true;
    updateAppBadge(payload.active_count??rows.length);renderNotificationDrawer();
    if(allowSound&&newRows.length)playNotificationSound();
  }catch(_error){}
}
function stopNotificationRealtime(){
  clearTimeout(state.notificationReconnectTimer);state.notificationReconnectTimer=null;
  state.notificationSource?.close?.();state.notificationSource=null;
}
function scheduleNotificationRealtime(){
  if(!state.token||!state.user||state.notificationReconnectTimer)return;
  state.notificationReconnectTimer=setTimeout(()=>{state.notificationReconnectTimer=null;void startNotificationRealtime();},2000);
}
async function startNotificationRealtime(){
  if(!state.token||!state.user||!("EventSource" in window))return;
  stopNotificationRealtime();
  try{
    const ticket=await api("/api/notifications/realtime-ticket",{method:"POST",body:"{}"});
    if(!ticket?.ticket)return scheduleNotificationRealtime();
    const source=new EventSource("/api/notifications/stream?ticket="+encodeURIComponent(ticket.ticket));state.notificationSource=source;
    source.addEventListener("ready",event=>{try{const payload=JSON.parse(event.data||"{}");if(Number.isFinite(Number(payload.active_count)))updateAppBadge(payload.active_count);}catch(_error){}});
    source.addEventListener("notification",()=>void refreshNotifications());
    source.onerror=()=>{if(state.notificationSource===source){source.close();state.notificationSource=null;scheduleNotificationRealtime();}};
  }catch(_error){scheduleNotificationRealtime();}
}
function openNotificationDrawer(){
  const layer=$("#notificationLayer"),drawer=$("#notificationDrawer"),bell=$("#notificationBell");if(!layer||!drawer)return;
  clearTimeout(layer._hideTimer);layer.hidden=false;layer.setAttribute("aria-hidden","false");drawer.setAttribute("aria-hidden","false");
  if(bell)bell.setAttribute("aria-expanded","true");document.documentElement.classList.add("notification-layer-open");
  requestAnimationFrame(()=>requestAnimationFrame(()=>{layer.classList.add("open");drawer.classList.add("open");drawer.focus({preventScroll:true});}));
  void refreshNotifications({allowSound:false});void ensurePushSubscription();
}
function closeNotificationDrawer({restoreFocus=true}={}){
  const layer=$("#notificationLayer"),drawer=$("#notificationDrawer"),bell=$("#notificationBell");if(!layer||!drawer)return;
  clearTimeout(layer._hideTimer);layer.classList.remove("open");drawer.classList.remove("open");drawer.setAttribute("aria-hidden","true");
  if(bell)bell.setAttribute("aria-expanded","false");document.documentElement.classList.remove("notification-layer-open");
  const finish=()=>{if(!layer.classList.contains("open")){layer.hidden=true;layer.setAttribute("aria-hidden","true");if(restoreFocus&&bell&&!$("#loginScreen")?.classList.contains("hidden"))return;if(restoreFocus&&bell)bell.focus({preventScroll:true});}};
  layer._hideTimer=setTimeout(finish,window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?0:300);
}
async function snoozeNotification(id,hours=3,until=null){
  try{await api("/api/notifications/"+encodeURIComponent(id)+"/snooze",{method:"POST",body:JSON.stringify(until?{until}:{hours})});await refreshNotifications({allowSound:false});}
  catch(error){toast(humanError(error),"error");}
}
async function acknowledgeNotification(id){
  try{const card=$(`[data-notification-card="${CSS.escape(String(id))}"]`);card?.classList.add("is-leaving");await api("/api/notifications/"+encodeURIComponent(id)+"/acknowledge",{method:"POST",body:"{}"});setTimeout(()=>void refreshNotifications({allowSound:false}),180);}
  catch(error){toast(humanError(error),"error");}
}
function openNotificationReminder(id){
  const now=new Date(Date.now()+3*3600000),pad=value=>String(value).padStart(2,"0");
  const initial=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  openDialog({title:tr("Remind me later","Értesíts később"),eyebrow:tr("NOTIFICATION","ÉRTESÍTÉS"),body:`<form id="notificationReminderForm" class="form-grid"><label class="field full"><span>${tr("Show this notification again at","Az értesítés újra megjelenjen ekkor")}</span><input name="until" type="datetime-local" value="${esc(initial)}" required></label><div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button type="submit" class="primary-button">${tr("Schedule reminder","Emlékeztető beállítása")}</button></div></form>`});
  $("#notificationReminderForm").addEventListener("submit",async event=>{event.preventDefault();const value=event.currentTarget.elements.until.value,date=new Date(value);if(Number.isNaN(date.getTime()))return;closeDialog();await snoozeNotification(id,3,date.toISOString());});
}
async function setNotificationSound(enabled){
  try{const pref=await api("/api/notifications/preferences/sound",{method:"PUT",body:JSON.stringify({sound_enabled:Boolean(enabled)})});state.notificationPreferences=pref;renderNotificationDrawer();if(enabled)playNotificationSound();}
  catch(error){toast(humanError(error),"error");}
}
function base64UrlToUint8(value){
  const padding="=".repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/"),raw=atob(base64);return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
}
async function ensurePushSubscription(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window)||!state.token)return;
  try{
    const config=await api("/api/push/config");if(!config.enabled||!config.public_key)return;
    let permission=Notification.permission;
    if(permission==="default")permission=await Notification.requestPermission();
    if(permission!=="granted")return;
    const registration=await navigator.serviceWorker.ready;let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToUint8(config.public_key)});
    await api("/api/push/subscriptions",{method:"POST",body:JSON.stringify({subscription:subscription.toJSON()})});
  }catch(_error){}
}
function bindNotificationUi(){
  if(state.notificationUiBound)return;state.notificationUiBound=true;
  $("#notificationBell")?.addEventListener("click",()=>$("#notificationLayer")?.classList.contains("open")?closeNotificationDrawer():openNotificationDrawer());
  $("#notificationDrawerClose")?.addEventListener("click",()=>closeNotificationDrawer());$("#notificationBackdrop")?.addEventListener("click",()=>closeNotificationDrawer());
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&$("#notificationLayer")?.classList.contains("open")){event.preventDefault();closeNotificationDrawer();}});
  $("#notificationSoundToggle")?.addEventListener("change",event=>setNotificationSound(event.target.checked));
  $("#notificationSnoozeAll")?.addEventListener("click",async()=>{
    try{await api("/api/notifications/snooze-all",{method:"POST",body:JSON.stringify({hours:3})});closeNotificationDrawer();await refreshNotifications({allowSound:false});toast(tr("Notifications will return in 3 hours.","Az értesítések 3 óra múlva újra megjelennek."),"success");}
    catch(error){toast(humanError(error),"error");}
  });
  navigator.serviceWorker?.addEventListener?.("message",event=>{if(event.data?.type==="NOTIFICATION_OPENED"&&event.data?.id)void api("/api/notifications/"+encodeURIComponent(event.data.id)+"/read",{method:"POST",body:"{}"}).catch(()=>{});});
}
function initNotificationCenter(){
  if(!state.token||!state.user)return;
  bindNotificationUi();clearInterval(state.notificationTimer);state.notificationTimer=setInterval(()=>void refreshNotifications(),60000);
  void refreshNotifications({allowSound:false});void startNotificationRealtime();
  if("Notification" in window&&Notification.permission==="granted")void ensurePushSubscription();
}

async function loadBranding(){
  try{
    const branding=await fetch("/api/public/branding",{cache:"no-store"}).then(response=>response.json());
    for(const img of [$("#loginBrandLogo"),$("#headerBrandLogo")])if(img&&branding.logo_url)img.src=`${branding.logo_url}${branding.logo_url.includes("?")?"&":"?"}v=${encodeURIComponent(branding.branding_version||"1")}`;
    document.title=`${branding.company_name||"Klavierhaus"} ERP`;
  }catch(_error){}
}
function navTo(view){
  if(!activeViews.has(view))return;
  state.view=view;history.replaceState({},"",`#${view}`);
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
  $("#languageToggle")?.addEventListener("click",()=>setLanguage(state.language==="en"?"hu":"en"));
}
function loading(){return `<div class="loading">${tr("Loading…","Betöltés…")}</div>`;}
function pageHead(title,subtitle,actions=""){return `<header class="page-head"><div><span class="eyebrow">KLAVIERHAUS ERP</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="page-actions">${actions}</div></header>`;}
function openDialog({title,eyebrow="",body}){
  $("#dialogTitle").textContent=title;$("#dialogEyebrow").textContent=eyebrow;$("#dialogBody").innerHTML=body;
  const dialog=$("#appDialog");if(!dialog.open)dialog.showModal();return dialog;
}
function closeDialog(){const dialog=$("#appDialog");if(dialog?.open)dialog.close();}
document.addEventListener("click",event=>{
  if(event.target.closest("[data-dialog-close],[data-close-dialog]")){event.preventDefault();closeDialog();}
});
$("#appDialog").addEventListener("click",event=>{if(event.target===$("#appDialog"))closeDialog();});
$("#appDialog").addEventListener("cancel",event=>{event.preventDefault();closeDialog();});

async function renderView(){
  const workspace=$("#workspace");workspace.innerHTML=loading();
  try{
    if(state.view==="workshop")await renderWorkshop();
    else if(state.view==="planned")await renderPlanned();
    else if(state.view==="master")await renderMaster();
    else if(state.view==="finance")await renderFinance();
    else if(state.view==="documents")await renderDocuments();
    else if(state.view==="cms")await renderCms();
    else if(state.view==="profile")await renderProfile();
    else await renderIntake();
    workspace.focus({preventScroll:true});
    $$(".nav-item[data-nav],.mobile-nav [data-nav]").forEach(button=>button.classList.toggle("active",button.dataset.nav===state.view));
  }catch(error){
    workspace.innerHTML=`<section class="panel empty-state"><strong>${tr("The view could not be loaded.","Nem sikerült betölteni a nézetet.")}</strong><p>${esc(humanError(error))}</p><button class="secondary-button" type="button" id="retryView">${tr("Retry","Újrapróbálás")}</button></section>`;
    $("#retryView")?.addEventListener("click",()=>renderView());
  }
}
async function loadClients(query=""){state.clients=await api(`/api/clients${query?`?q=${encodeURIComponent(query)}`:""}`);return state.clients;}
async function loadUsers(){state.users=await api("/api/users");return state.users;}

async function renderMaster(){
  const workspace=$("#workspace");await loadClients();
  if(!state.selectedClientId&&state.clients.length)state.selectedClientId=Number(state.clients[0].id);
  workspace.innerHTML=pageHead(tr("Master Data","Törzsadatok"),tr("Clients, pianos and service history in one fast view.","Ügyfelek, zongorák és szerviztörténet egyetlen gyors nézetben."),
    `<button id="addClientBtn" class="primary-button" type="button">＋ ${tr("New client","Új ügyfél")}</button>`)+
    `<div class="master-layout"><section class="panel"><div class="panel-head client-list-toolbar"><div class="search-field"><input id="clientSearch" type="search" placeholder="${tr("Name, email or phone…","Név, e-mail vagy telefon…")}"></div><button id="clientVipFilter" class="secondary-button ${state.clientVipOnly?"active":""}" type="button">★ VIP</button></div><div id="clientList" class="client-list"></div></section><section id="clientDetail" class="panel client-detail"></section></div>`;
  $("#addClientBtn").addEventListener("click",()=>openClientDialog());
  $("#clientVipFilter").addEventListener("click",()=>{state.clientVipOnly=!state.clientVipOnly;renderMaster();});
  $("#clientSearch").addEventListener("input",debounce(async event=>{
    await loadClients(event.target.value);renderClientList();
    if(state.selectedClientId&&!state.clients.some(client=>Number(client.id)===Number(state.selectedClientId)))state.selectedClientId=state.clients[0]?.id||null;
    await renderClientDetail();
  },180));
  renderClientList();await renderClientDetail();
}
function renderClientList(){
  const host=$("#clientList");if(!host)return;
  const rows=(state.clients||[]).filter(client=>!state.clientVipOnly||Number(client.is_vip||0)===1);
  if(!rows.length){host.innerHTML=`<div class="empty-state">${tr("No results.","Nincs találat.")}</div>`;return;}
  host.innerHTML=rows.map(client=>`<button type="button" class="client-row ${Number(client.id)===Number(state.selectedClientId)?"active":""}" data-client-id="${client.id}">
    <span><strong>${Number(client.is_vip||0)===1?'<span class="vip-client-star" title="VIP">★</span> ':""}${esc(client.name)}</strong><small>${esc([client.email,client.phone].filter(Boolean).join(" · ")||tr("No contact details","Nincs elérhetőség"))}</small></span><span class="count">${Number(client.piano_count||0)}</span>
  </button>`).join("");
  $$("[data-client-id]",host).forEach(button=>button.addEventListener("click",async()=>{state.selectedClientId=Number(button.dataset.clientId);renderClientList();await renderClientDetail();}));
}
async function renderClientDetail(){
  const host=$("#clientDetail");if(!host)return;
  const client=state.clients.find(row=>Number(row.id)===Number(state.selectedClientId));
  if(!client){host.innerHTML=`<div class="empty-state">${tr("Select a client.","Válassz ügyfelet.")}</div>`;return;}
  host.innerHTML=loading();
  const [pianos,jobs]=await Promise.all([api(`/api/clients/${client.id}/pianos`),api(`/api/clients/${client.id}/jobs`).catch(()=>[])]);
  host.innerHTML=`<div class="detail-title"><div><span class="eyebrow">${tr("CLIENT","ÜGYFÉL")} #${client.id}</span><h2>${Number(client.is_vip||0)===1?'<span class="vip-client-star" title="VIP">★</span> ':""}${esc(client.name)}</h2></div><div class="page-actions"><button id="editClientBtn" class="secondary-button" type="button">${tr("Edit","Szerkesztés")}</button><button id="addPianoBtn" class="primary-button" type="button">＋ ${tr("Piano","Zongora")}</button></div></div>
    <div class="contact-line">${client.email?`<span class="contact-pill">✉ ${esc(client.email)}</span>`:""}${client.phone?`<span class="contact-pill">☎ ${esc(client.phone)}</span>`:""}${client.address?`<span class="contact-pill">⌂ ${esc(client.address)}</span>`:""}</div>
    ${client.notes?`<div class="detail-note">${esc(client.notes)}</div>`:""}
    <div class="panel-head inline-panel-head"><h3>${tr("Pianos","Zongorák")}</h3><span class="badge">${pianos.length}</span></div>
    <div class="piano-grid">${pianos.length?pianos.map(piano=>pianoCard(piano)).join(""):`<div class="empty-state">${tr("No piano is linked to this client yet.","Ehhez az ügyfélhez még nincs zongora.")}</div>`}</div>
    <div class="panel-head inline-panel-head"><h3>${tr("Service history","Szerviztörténet")}</h3><span class="badge">${jobs.length}</span></div>
    <div class="service-history-list">${jobs.length?jobs.map(job=>`<article class="history-row"><div><strong>${esc(job.job_code||job.title)}</strong><small>${esc(job.title)} · ${esc(job.piano_brand||"")} ${esc(job.piano_model||"")}</small></div><span class="badge">${job.cancelled_at?tr("Cancelled","Megszakítva"):job.stage==="completed"?tr("Completed","Lezárva"):esc(job.stage)}</span>${job.completed_by_name?`<small>${tr("Closed by","Lezárta")}: ${esc(job.completed_by_name)}</small>`:""}</article>`).join(""):`<div class="empty-state">${tr("No service history yet.","Még nincs szerviztörténet.")}</div>`}</div>`;
  $("#editClientBtn").addEventListener("click",()=>openClientDialog(client));
  $("#addPianoBtn").addEventListener("click",()=>openPianoDialog(client));
}
function pianoCard(piano){
  return `<article class="piano-card"><h3>${esc([piano.brand,piano.model].filter(Boolean).join(" "))}</h3><dl>
    <dt>${tr("Serial","Gyári szám")}</dt><dd>${esc(piano.serial_number||"—")}</dd>
    <dt>${tr("Finish","Kivitel")}</dt><dd>${esc(piano.finish||"—")}</dd>
    <dt>${tr("Location","Hely / megjegyzés")}</dt><dd>${esc(piano.location_notes||"—")}</dd>
  </dl><div class="service-history"><strong>${tr("Last service","Utolsó szerviz")}</strong><br>${piano.last_serviced_at?esc(piano.last_serviced_at):tr("No recorded service date.","Nincs rögzített szervizdátum.")}</div></article>`;
}
function clientForm(client={}){
  return `<form id="clientEditor" class="form-grid">
    <label class="field"><span>${tr("Name","Név")} *</span><input name="name" value="${esc(client.name||"")}" required autofocus></label>
    <label class="field"><span>Email</span><input name="email" type="email" value="${esc(client.email||"")}"></label>
    <label class="field"><span>${tr("Phone","Telefon")}</span><input name="phone" value="${esc(client.phone||"")}"></label>
    <label class="field"><span>${tr("Address","Cím")}</span><input name="address" value="${esc(client.address||"")}"></label>
    <label class="field full"><span>${tr("Notes","Megjegyzés")}</span><textarea name="notes">${esc(client.notes||"")}</textarea></label>
    <label class="cms-toggle-row full vip-toggle-row"><span><strong>★ VIP</strong><small>${tr("Mark this client as a VIP client.","Jelöld VIP ügyfélként.")}</small></span><input name="is_vip" type="checkbox" ${Number(client.is_vip||0)===1?"checked":""}></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button type="submit" class="primary-button">${tr("Save","Mentés")}</button></div>
  </form>`;
}
function openClientDialog(client=null){
  openDialog({title:client?tr("Edit client","Ügyfél szerkesztése"):tr("New client","Új ügyfél"),eyebrow:tr("MASTER DATA","TÖRZSADATOK"),body:clientForm(client||{})});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#clientEditor").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.is_vip=Boolean(event.currentTarget.elements.is_vip?.checked);
    try{
      const saved=await api(client?`/api/clients/${client.id}`:"/api/clients",{method:client?"PUT":"POST",body:JSON.stringify(body)});
      state.selectedClientId=Number(saved.id);closeDialog();toast(tr("Client saved.","Ügyfél mentve."),"success");await renderMaster();
    }catch(error){toast(humanError(error),"error");}
  });
}
function openPianoDialog(client){
  openDialog({title:tr("New piano","Új zongora"),eyebrow:client.name,body:`<form id="pianoEditor" class="form-grid">
    <label class="field"><span>${tr("Brand","Márka")} *</span><input name="brand" required autofocus placeholder="Steinway & Sons"></label>
    <label class="field"><span>${tr("Model","Modell")}</span><input name="model" placeholder="B-211"></label>
    <label class="field"><span>${tr("Serial","Gyári szám")}</span><input name="serial_number"></label>
    <label class="field"><span>${tr("Finish","Kivitel")}</span><input name="finish" placeholder="Ebony"></label>
    <label class="field full"><span>${tr("Piano location / notes","Zongora helye / megjegyzés")}</span><textarea name="location_notes"></textarea></label>
    <label class="field"><span>${tr("Last service","Utolsó szerviz")}</span><input name="last_serviced_at" type="date"></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save piano","Zongora mentése")}</button></div>
  </form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#pianoEditor").addEventListener("submit",async event=>{
    event.preventDefault();
    try{await api(`/api/clients/${client.id}/pianos`,{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast(tr("Piano added.","Zongora hozzáadva."),"success");await renderClientDetail();}
    catch(error){toast(humanError(error),"error");}
  });
}

async function renderIntake(){
  const workspace=$("#workspace");
  const [intake,clients]=await Promise.all([api("/api/intake"),loadClients(),loadUsers()]);
  state.intake=intake;
  const open=intake.filter(row=>["new","under_review"].includes(row.status)),urgent=open.filter(row=>row.estimated_urgency==="urgent");
  workspace.innerHTML=pageHead(tr("Intake","Igényfelmérés"),tr("Incoming requests, media and one-step conversion to Planned Jobs.","Beérkező igények, média és egyetlen lépéses konverzió a Tervezett munkákhoz."),
    `<button id="newIntakeBtn" class="primary-button" type="button">＋ ${tr("New intake","Új igény")}</button>`)+
    `<div class="stats-grid"><div class="stat-card"><small>${tr("Open","Nyitott")}</small><strong>${open.length}</strong></div><div class="stat-card"><small>${tr("Urgent","Sürgős")}</small><strong>${urgent.length}</strong></div><div class="stat-card"><small>${tr("Converted","Konvertált")}</small><strong>${intake.filter(row=>row.status==="converted").length}</strong></div><div class="stat-card"><small>${tr("Clients","Ügyfelek")}</small><strong>${clients.length}</strong></div></div>
    <div class="intake-toolbar"><div class="search-field"><input id="intakeSearch" type="search" placeholder="${tr("Search name, issue or contact…","Keresés név, probléma vagy kontakt alapján…")}"></div>
    <select id="intakeStatusFilter"><option value="">${tr("All statuses","Minden státusz")}</option><option value="new">${tr("New","Új")}</option><option value="under_review">${tr("Under review","Ellenőrzés alatt")}</option><option value="converted">${tr("Converted","Konvertált")}</option><option value="archived">${tr("Archived","Archivált")}</option></select></div>
    <div id="intakeList" class="intake-list"></div>`;
  $("#newIntakeBtn").addEventListener("click",openIntakeDialog);
  $("#intakeSearch").addEventListener("input",renderIntakeList);$("#intakeStatusFilter").addEventListener("change",renderIntakeList);renderIntakeList();
}
function intakeStatusLabel(status){
  return ({new:tr("New","Új"),under_review:tr("Under review","Ellenőrzés alatt"),converted:tr("Converted","Konvertált"),archived:tr("Archived","Archivált")})[status]||status;
}
function renderIntakeList(){
  const host=$("#intakeList");if(!host)return;
  const q=String($("#intakeSearch")?.value||"").trim().toLowerCase(),status=$("#intakeStatusFilter")?.value||"";
  const rows=state.intake.filter(row=>(!status||row.status===status)&&(!q||`${row.raw_client_name||""} ${row.client_name||""} ${row.raw_contact||""} ${row.reported_issue||""}`.toLowerCase().includes(q)));
  if(!rows.length){host.innerHTML=`<section class="panel empty-state">${tr("No intake requests to display.","Nincs megjeleníthető igény.")}</section>`;return;}
  host.innerHTML=rows.map(row=>`<article class="intake-card ${esc(row.estimated_urgency)}">
    <div class="urgency-bar"></div><div><h3>${esc(row.client_name||row.raw_client_name||tr("New prospect","Új érdeklődő"))}</h3><p>${esc(row.reported_issue)}</p>
      <div class="intake-meta"><span class="badge ${esc(row.estimated_urgency)}">${row.estimated_urgency==="urgent"?tr("Urgent","Sürgős"):row.estimated_urgency==="low"?tr("Low","Alacsony"):tr("Normal","Normál")}</span>
      <span class="badge">${row.service_location==="on_site"?tr("On site","Helyszíni"):tr("Workshop","Műhely")}</span><span class="badge">${esc(intakeStatusLabel(row.status))}</span>
      ${row.raw_contact?`<span class="badge">${esc(row.raw_contact)}</span>`:""}${row.assigned_technician_name?`<span class="badge">👤 ${esc(row.assigned_technician_name)}</span>`:""}
      ${Array.isArray(row.media_urls)&&row.media_urls.length?`<span class="badge">📎 ${row.media_urls.length}</span>`:""}</div></div>
    ${row.job_id?`<button class="secondary-button" type="button" data-nav="planned">✓ ${esc(row.job_code||tr("Planned Job","Tervezett munka"))}</button>`:row.status!=="archived"?`<button class="primary-button" type="button" data-convert-job="${row.id}">${tr("Convert to Planned Job","Konvertálás Tervezett Munkává")}</button>`:""}
  </article>`).join("");
  $$("[data-convert-job]",host).forEach(button=>button.addEventListener("click",()=>openConvertToJobDialog(state.intake.find(row=>Number(row.id)===Number(button.dataset.convertJob)))));
}
function clientSuggestionMarkup(clients){
  return clients.slice(0,8).map(client=>`<button type="button" class="typeahead-option" data-intake-client="${client.id}"><strong>${esc(client.name)}</strong><small>${esc([client.email,client.phone].filter(Boolean).join(" · "))}</small></button>`).join("");
}
async function openIntakeDialog(){
  const technicianOptions=state.users.filter(user=>["WORKER","MANAGER","ADMIN"].includes(user.role)).map(user=>`<option value="${esc(user.id)}">${esc(user.name)} · ${esc(roleLabel(user.role))}</option>`).join("");
  openDialog({title:tr("New intake","Új igény"),eyebrow:"INTAKE",body:`<form id="intakeEditor" class="form-grid">
    <label class="field full typeahead-field"><span>${tr("Find existing client — name, phone or email","Meglévő ügyfél — név, telefon vagy e-mail")}</span><input id="intakeClientSearch" autocomplete="off" placeholder="${tr("Start typing…","Kezdj el gépelni…")}"><div id="intakeClientSuggestions" class="typeahead-menu hidden"></div></label>
    <input type="hidden" name="client_id" id="intakeClientId">
    <label class="field full hidden" id="intakePianoField"><span>${tr("Client piano","Ügyfél zongorája")}</span><select name="piano_id" id="intakePianoSelect"></select></label>
    <label class="field"><span>${tr("New / raw client name","Új / nyers név")}</span><input name="raw_client_name" id="rawClientName"></label>
    <label class="field"><span>${tr("Contact","Kontakt")}</span><input name="raw_contact" id="rawContact" placeholder="${tr("phone or email","telefon vagy e-mail")}"></label>
    <label class="field"><span>${tr("Service location","Helyszín")}</span><select name="service_location"><option value="workshop">${tr("Workshop","Műhely")}</option><option value="on_site">${tr("On site","Helyszíni")}</option></select></label>
    <label class="field"><span>${tr("Urgency","Sürgősség")}</span><select name="estimated_urgency"><option value="low">${tr("Low","Alacsony")}</option><option value="normal" selected>${tr("Normal","Normál")}</option><option value="urgent">${tr("Urgent","Sürgős")}</option></select></label>
    <label class="field full"><span>${tr("Technician","Technikus")}</span><select name="assigned_technician_id"><option value="">${tr("Unassigned","Nincs kiosztva")}</option>${technicianOptions}</select></label>
    <label class="field full"><span>${tr("Requested service / issue","Jelzett probléma / igény")} *</span><textarea name="reported_issue" required autofocus></textarea></label>
    <label class="field full"><span>${tr("Photos / videos","Fotók / videók")}</span><input id="intakeMediaFiles" type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm"></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save intake","Igény rögzítése")}</button></div>
  </form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  const search=$("#intakeClientSearch"),suggestions=$("#intakeClientSuggestions"),clientId=$("#intakeClientId"),pianoField=$("#intakePianoField"),pianoSelect=$("#intakePianoSelect");
  async function selectClient(client){
    clientId.value=client.id;search.value=client.name;suggestions.classList.add("hidden");
    $("#rawClientName").value=client.name;$("#rawContact").value=client.email||client.phone||"";
    const pianos=await api(`/api/clients/${client.id}/pianos`);
    pianoField.classList.remove("hidden");
    pianoSelect.innerHTML=`<option value="">${tr("Select later / new piano","Később választom / új zongora")}</option>`+pianos.map(piano=>`<option value="${piano.id}">${esc([piano.brand,piano.model,piano.serial_number].filter(Boolean).join(" · "))}</option>`).join("");
  }
  search.addEventListener("input",debounce(async event=>{
    const q=event.target.value.trim();clientId.value="";pianoField.classList.add("hidden");
    if(q.length<2){suggestions.classList.add("hidden");return;}
    const clients=await loadClients(q);suggestions.innerHTML=clientSuggestionMarkup(clients);suggestions.classList.toggle("hidden",!clients.length);
    $$("[data-intake-client]",suggestions).forEach(button=>button.addEventListener("click",()=>selectClient(clients.find(client=>Number(client.id)===Number(button.dataset.intakeClient)))));
  },160));
  $("#intakeEditor").addEventListener("submit",async event=>{
    event.preventDefault();const form=event.currentTarget,body=Object.fromEntries(new FormData(form));
    if(!body.client_id)delete body.client_id;if(!body.piano_id)delete body.piano_id;if(!body.assigned_technician_id)delete body.assigned_technician_id;
    let uploaded=[];
    try{
      const files=[...$("#intakeMediaFiles").files||[]];
      if(files.length){const data=new FormData();files.forEach(file=>data.append("media",file));uploaded=(await api("/api/intake/media",{method:"POST",body:data})).urls||[];}
      body.media_urls=[...new Set(uploaded)];
      await api("/api/intake",{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Intake saved.","Igény rögzítve."),"success");await renderIntake();
    }catch(error){toast(humanError(error),"error");}
  });
}
async function openConvertToJobDialog(lead){
  let pianos=lead.client_id?await api(`/api/clients/${lead.client_id}/pianos`):[];
  const pianoOptions=pianos.map(piano=>`<option value="${piano.id}">${esc([piano.brand,piano.model,piano.serial_number].filter(Boolean).join(" · "))}</option>`).join("");
  openDialog({title:tr("Convert to Planned Job","Konvertálás Tervezett Munkává"),eyebrow:tr("ZERO DUPLICATE ENTRY","ZERO DUPLIKÁLT ADAT"),body:`<form id="convertJobEditor" class="form-grid">
    <div class="full detail-note">${esc(lead.reported_issue)}</div>
    ${lead.client_id?`<div class="full"><strong>${tr("Client","Ügyfél")}:</strong> ${esc(lead.client_name||lead.raw_client_name||lead.client_id)}</div>`:`
      <label class="field"><span>${tr("Client name","Ügyfél neve")} *</span><input name="client_name" value="${esc(lead.raw_client_name||"")}" required></label>
      <label class="field"><span>${tr("Piano location / address","Zongora helye / cím")} *</span><input name="client_address" required></label>
      <label class="field"><span>Email</span><input name="client_email" type="email" value="${esc(/@/.test(lead.raw_contact||"")?lead.raw_contact:"")}"></label>
      <label class="field"><span>${tr("Phone","Telefon")}</span><input name="client_phone" value="${esc(!/@/.test(lead.raw_contact||"")?lead.raw_contact:"")}"></label>`}
    ${lead.piano_id?`<div class="full"><strong>${tr("Piano already linked.","A zongora már kapcsolva van.")}</strong></div>`:`
      ${pianos.length?`<label class="field full"><span>${tr("Existing piano","Meglévő zongora")}</span><select name="piano_id"><option value="">${tr("Create new piano","Új zongora létrehozása")}</option>${pianoOptions}</select></label>`:""}
      <label class="field"><span>${tr("Piano brand","Zongora márkája")} *</span><input name="brand" placeholder="Steinway & Sons"></label>
      <label class="field"><span>${tr("Model","Modell")}</span><input name="model"></label>
      <label class="field"><span>${tr("Serial","Gyári szám")}</span><input name="serial_number"></label>
      <label class="field"><span>${tr("Piano location","Zongora helye")}</span><input name="location_notes"></label>`}
    <label class="field full"><span>${tr("Planned job title","Tervezett munka címe")}</span><input name="title" value="${esc(lead.reported_issue)}"></label>
    <label class="field"><span>${tr("Estimated duration","Becsült időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="120"></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Convert to Planned Job","Konvertálás Tervezett Munkává")}</button></div>
  </form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#convertJobEditor").addEventListener("submit",async event=>{
    event.preventDefault();const form=Object.fromEntries(new FormData(event.currentTarget)),body={title:form.title,estimated_duration_min:Number(form.estimated_duration_min||120)};
    if(!lead.client_id)body.client={name:form.client_name,email:form.client_email,phone:form.client_phone,address:form.client_address};
    if(!lead.piano_id){if(form.piano_id)body.piano_id=Number(form.piano_id);else body.piano={brand:form.brand,model:form.model,serial_number:form.serial_number,location_notes:form.location_notes||form.client_address};}
    try{
      const result=await api(`/api/intake/${lead.id}/convert-to-job`,{method:"POST",body:JSON.stringify(body)});
      closeDialog();toast(result.idempotent?tr("Planned Job already existed.","A tervezett munka már létezett."):tr("Planned Job created.","Tervezett munka létrehozva."),"success");navTo("planned");
    }catch(error){toast(humanError(error),"error");}
  });
}

async function renderCms(){
  const workspace=$("#workspace");
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role)){workspace.innerHTML=pageHead(tr("Website CMS","Weboldal CMS"),tr("Admin access required.","Admin jogosultság szükséges."))+`<section class="panel empty-state">${tr("No CMS permission.","Nincs CMS jogosultság.")}</section>`;return;}
  const meta=await api("/api/website-content/pages");state.cmsPages=meta.pages||[];
  if(!state.cmsPages.some(page=>page.page_key===state.cmsPage))state.cmsPage=state.cmsPages[0]?.page_key||"home";
  workspace.innerHTML=pageHead(tr("Website CMS","Weboldal CMS"),tr("Edit the protected public website through a visual content editor — no code or JSON required.","A védett publikus weboldal tartalmának vizuális szerkesztése — kód és JSON nélkül."))+
    `<div class="cms-layout"><aside class="panel cms-sidebar" id="cmsPageList">${state.cmsPages.map(page=>`<button class="cms-page-button ${page.page_key===state.cmsPage?"active":""}" data-cms-page="${esc(page.page_key)}" type="button">${esc(state.language==="hu"?(page.title_hu||page.title_en||page.page_key):(page.title_en||page.page_key))}</button>`).join("")}</aside><section class="panel cms-editor" id="cmsEditor">${loading()}</section></div>`;
  $$("[data-cms-page]").forEach(button=>button.addEventListener("click",async()=>{state.cmsPage=button.dataset.cmsPage;await renderCms();}));
  await loadCmsPage();
}
const CMS_LABELS={
  title:["Title","Cím"],subtitle:["Subtitle","Alcím"],heading:["Heading","Címsor"],eyebrow:["Eyebrow","Kiemelő felirat"],
  text:["Text","Szöveg"],body:["Body text","Törzsszöveg"],description:["Description","Leírás"],name:["Name","Név"],role:["Role","Szerepkör"],
  quote:["Quote","Idézet"],label:["Label","Felirat"],button_text:["Button text","Gomb felirata"],button_label:["Button label","Gomb felirata"],
  button_url:["Button link","Gomb hivatkozása"],cta_label:["CTA label","CTA felirata"],cta_url:["CTA link","CTA hivatkozása"],
  image_url:["Image","Kép"],image:["Image","Kép"],alt:["Alternative text","Alternatív képszöveg"],url:["Link","Hivatkozás"],
  email:["Email","E-mail"],phone:["Phone","Telefon"],address:["Address","Cím"],items:["Items","Elemek"],sections:["Sections","Szekciók"]
};
function cmsFieldLabel(key,index=0){
  const normalized=String(key||"").toLowerCase(),pair=CMS_LABELS[normalized];
  if(pair)return state.language==="hu"?pair[1]:pair[0];
  const clean=String(key||"").replace(/[_-]+/g," ").replace(/\b\w/g,ch=>ch.toUpperCase());
  return clean||`${tr("Item","Elem")} ${index+1}`;
}
function cmsPathAttr(path){return encodeURIComponent(JSON.stringify(path));}
function cmsPathDecode(value){try{return JSON.parse(decodeURIComponent(value));}catch(_error){return [];}}
function cmsGetPath(root,path){return path.reduce((value,key)=>value?.[key],root);}
function cmsSetPath(root,path,value){
  if(!path.length)return;
  let node=root;for(let i=0;i<path.length-1;i+=1)node=node[path[i]];
  node[path[path.length-1]]=value;
}
function cmsEmptyClone(value){
  if(Array.isArray(value))return [];
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,cmsEmptyClone(item)]));
  if(typeof value==="boolean")return false;
  if(typeof value==="number")return 0;
  return "";
}
function cmsRenderNode(value,path=[],key="",index=0){
  const label=cmsFieldLabel(key,index);
  if(Array.isArray(value)){
    return `<section class="cms-fieldset"><div class="cms-fieldset-head"><div><strong>${esc(label)}</strong><small>${value.length} ${tr("items","elem")}</small></div><button type="button" class="secondary-button" data-cms-add="${cmsPathAttr(path)}">＋ ${tr("Add","Hozzáadás")}</button></div><div class="cms-repeater">${value.map((item,itemIndex)=>`<article class="cms-repeat-item"><div class="cms-repeat-head"><strong>${esc(cmsFieldLabel(key,itemIndex))} #${itemIndex+1}</strong><button class="text-button danger-text" type="button" data-cms-remove="${cmsPathAttr([...path,itemIndex])}">${tr("Remove","Eltávolítás")}</button></div>${cmsRenderNode(item,[...path,itemIndex],key,itemIndex)}</article>`).join("")||`<div class="cms-empty">${tr("No items yet.","Még nincs elem.")}</div>`}</div></section>`;
  }
  if(value&&typeof value==="object"){
    return `<section class="cms-fieldset"><div class="cms-fieldset-head"><strong>${esc(label)}</strong></div><div class="cms-object-grid">${Object.entries(value).map(([childKey,child],childIndex)=>cmsRenderNode(child,[...path,childKey],childKey,childIndex)).join("")}</div></section>`;
  }
  if(typeof value==="boolean"){
    return `<label class="cms-toggle-row"><span>${esc(label)}</span><input type="checkbox" data-cms-path="${cmsPathAttr(path)}" ${value?"checked":""}></label>`;
  }
  const str=String(value??""),urlField=/url|link|image/i.test(key),longField=/text|body|description|quote|content/i.test(key)||str.length>120;
  if(longField)return `<label class="field cms-primitive"><span>${esc(label)}</span><textarea data-cms-path="${cmsPathAttr(path)}">${esc(str)}</textarea></label>`;
  return `<label class="field cms-primitive"><span>${esc(label)}</span><input data-cms-path="${cmsPathAttr(path)}" type="${urlField?"url":"text"}" value="${esc(str)}"></label>`;
}
function bindCmsVisualEditor(){
  const host=$("#cmsVisualFields");if(!host)return;
  $$("[data-cms-path]",host).forEach(input=>input.addEventListener(input.type==="checkbox"?"change":"input",event=>{
    const path=cmsPathDecode(event.currentTarget.dataset.cmsPath),old=cmsGetPath(state.cmsDraft,path);
    const value=event.currentTarget.type==="checkbox"?event.currentTarget.checked:typeof old==="number"?Number(event.currentTarget.value||0):event.currentTarget.value;
    cmsSetPath(state.cmsDraft,path,value);
  }));
  $$("[data-cms-remove]",host).forEach(button=>button.addEventListener("click",()=>{
    const path=cmsPathDecode(button.dataset.cmsRemove),index=Number(path.at(-1)),parent=cmsGetPath(state.cmsDraft,path.slice(0,-1));
    if(Array.isArray(parent)){parent.splice(index,1);renderCmsDraftFields();}
  }));
  $$("[data-cms-add]",host).forEach(button=>button.addEventListener("click",()=>{
    const path=cmsPathDecode(button.dataset.cmsAdd),arr=cmsGetPath(state.cmsDraft,path);
    if(Array.isArray(arr)){arr.push(arr.length?cmsEmptyClone(arr[0]):"");renderCmsDraftFields();}
  }));
}
function renderCmsDraftFields(){
  const host=$("#cmsVisualFields");if(!host)return;
  const entries=Object.entries(state.cmsDraft||{});
  host.innerHTML=entries.length?entries.map(([key,value],index)=>cmsRenderNode(value,[key],key,index)).join(""):`<div class="cms-empty">${tr("This page currently has no editable content fields.","Ezen az oldalon jelenleg nincs szerkeszthető tartalmi mező.")}</div>`;
  bindCmsVisualEditor();
}
async function loadCmsPage(){
  const host=$("#cmsEditor");host.innerHTML=loading();
  const page=await api(`/api/website-content/${encodeURIComponent(state.cmsPage)}?lang=${state.cmsLanguage}`);
  state.cmsDraft=structuredClone(page.content||{});
  const meta=state.cmsPages.find(item=>item.page_key===state.cmsPage)||{};
  host.innerHTML=`<div class="cms-toolbar"><div><span class="eyebrow">${tr("VISUAL PAGE EDITOR","VIZUÁLIS OLDALSZERKESZTŐ")}</span><h2>${esc(state.language==="hu"?(meta.title_hu||meta.title_en||state.cmsPage):(meta.title_en||state.cmsPage))}</h2></div><label class="field cms-language-field"><span>${tr("Content language","Tartalom nyelve")}</span><select id="cmsLanguage"><option value="en" ${state.cmsLanguage==="en"?"selected":""}>${tr("English","Angol")}</option><option value="hu" ${state.cmsLanguage==="hu"?"selected":""}>Magyar</option></select></label></div>
    <div id="cmsVisualFields" class="cms-visual-fields"></div>
    <div class="cms-publish-bar"><span>${tr("Changes are published to the existing protected website content API.","A módosítások a meglévő, védett weboldal-tartalmi API-n keresztül kerülnek publikálásra.")}</span><button id="saveCmsBtn" class="primary-button" type="button">${tr("Save & publish","Mentés és publikálás")}</button></div>
    <div class="cms-upload"><label class="field"><span>${tr("Upload image","Kép feltöltése")}</span><input id="cmsImageFile" type="file" accept="image/*"></label><button id="uploadCmsImage" class="secondary-button" type="button">${tr("Upload","Feltöltés")}</button><div id="imageUploadResult" class="muted full"></div></div>`;
  renderCmsDraftFields();
  $("#cmsLanguage").addEventListener("change",async event=>{state.cmsLanguage=event.target.value;await loadCmsPage();});
  $("#saveCmsBtn").addEventListener("click",async()=>{try{await api(`/api/website-content/${encodeURIComponent(state.cmsPage)}`,{method:"PUT",body:JSON.stringify({language:state.cmsLanguage,content:state.cmsDraft})});toast(tr("Website content published.","Weboldal tartalma publikálva."),"success");}catch(error){toast(humanError(error),"error");}});
  $("#uploadCmsImage").addEventListener("click",async()=>{const file=$("#cmsImageFile").files?.[0];if(!file){toast(tr("Choose an image.","Válassz képet."),"error");return;}const form=new FormData();form.set("image",file);try{const result=await api("/api/website-content/image",{method:"POST",body:form});$("#imageUploadResult").innerHTML=`<strong>${tr("Uploaded image URL","Feltöltött kép hivatkozása")}:</strong> <code>${esc(result.image_url)}</code>`;toast(tr("Image uploaded.","Kép feltöltve."),"success");}catch(error){toast(humanError(error),"error");}});
}

async function renderProfile(){
  const workspace=$("#workspace"),users=await loadUsers(),canManage=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  workspace.innerHTML=pageHead(tr("Profile & Settings","Profil és beállítások"),tr("Your account, team and application language.","Saját fiók, csapat és alkalmazásnyelv."),canManage?`<button id="newUserBtn" class="primary-button" type="button">＋ ${tr("New user","Új felhasználó")}</button>`:"")+
    `<div class="profile-grid"><section class="panel profile-card"><div class="profile-avatar">${esc(initials(state.user?.name))}</div><h2>${esc(state.user?.name)}</h2><p class="muted">${esc(state.user?.email||"")}</p><span class="role-chip">${esc(roleLabel(state.user?.role))}</span><div class="form-actions"><button id="logoutBtn" class="danger-button" type="button">${tr("Sign out","Kijelentkezés")}</button></div></section>
    <section class="panel"><div class="panel-head"><h2>${tr("Team","Csapat")}</h2><span class="badge">${users.length}</span></div><div class="team-list">${users.map(user=>`<div class="team-row"><span><strong>${esc(user.name)}</strong><small>${esc(user.email||user.contact_email||"")}</small></span><span class="role-chip">${esc(roleLabel(user.role))}</span>${canManage?`<button class="secondary-button team-edit-button" type="button" data-edit-user="${esc(user.id)}">${tr("Edit","Szerkesztés")}</button>`:""}</div>`).join("")}</div></section></div>`;
  $("#logoutBtn").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"});}catch(_error){}clearSession();showLogin();});
  $("#newUserBtn")?.addEventListener("click",()=>void openUserDialog());
  $("[data-edit-user]").forEach(button=>button.addEventListener("click",()=>void openUserDialog(users.find(user=>String(user.id)===button.dataset.editUser))));
}
async function openUserDialog(user=null){
  const editing=Boolean(user),isSelf=editing&&String(user.id)===String(state.user?.id),canManageNotifications=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  let notificationDelivery=true;
  if(editing&&canManageNotifications){
    try{const pref=await api("/api/admin/users/"+encodeURIComponent(user.id)+"/notification-delivery");notificationDelivery=Boolean(pref.notifications_enabled);}
    catch(_error){notificationDelivery=true;}
  }
  openDialog({title:editing?tr("Edit team member","Csapattag szerkesztése"):tr("New user","Új felhasználó"),eyebrow:tr("USER MANAGEMENT","FELHASZNÁLÓKEZELÉS"),body:`<form id="userEditor" class="form-grid">
    <label class="field"><span>${tr("Name","Név")} *</span><input name="name" value="${esc(user?.name||"")}" required autofocus></label>
    <label class="field"><span>${tr("Role","Szerepkör")} *</span><select name="role"><option value="WORKER" ${user?.role==="WORKER"?"selected":""}>${tr("Technician","Technikus")}</option><option value="MANAGER" ${user?.role==="MANAGER"?"selected":""}>${tr("Manager","Menedzser")}</option><option value="ADMIN" ${user?.role==="ADMIN"?"selected":""}>${tr("Admin","Admin")}</option></select></label>
    <label class="field"><span>${tr("Login email","Belépési e-mail")} *</span><input name="email" type="email" value="${esc(user?.email||"")}" required></label>
    <label class="field"><span>${tr("Contact email","Kapcsolati e-mail")} ${editing?"":"*"}</span><input name="contact_email" type="email" value="${esc(user?.contact_email||"")}" ${editing?"":"required"}></label>
    <label class="field"><span>${tr("Phone","Telefon")}</span><input name="phone" value="${esc(user?.phone||"")}"></label>
    <label class="field"><span>${tr("Status","Státusz")}</span><select name="status" ${isSelf?"disabled":""}><option value="Active" ${user?.status!=="Inactive"?"selected":""}>${tr("Active","Aktív")}</option><option value="Inactive" ${user?.status==="Inactive"?"selected":""}>${tr("Inactive","Inaktív")}</option></select></label>
    ${editing&&canManageNotifications?`<label class="cms-toggle-row full notification-delivery-admin"><span><strong>${tr("Notifications","Értesítések")}</strong><small>${tr("Only an administrator can disable notification delivery for this employee.","Az értesítések kézbesítését csak adminisztrátor tilthatja le ennél a munkavállalónál.")}</small></span><input name="notifications_enabled" type="checkbox" ${notificationDelivery?"checked":""}></label>`:""}
    <label class="field full"><span>${tr("Address","Cím")}</span><input name="address" value="${esc(user?.address||"")}"></label>
    <label class="field"><span>${editing?tr("New password (optional)","Új jelszó (opcionális)"):tr("Temporary password","Ideiglenes jelszó")} ${editing?"":"*"}</span><input name="password" type="password" minlength="8" ${editing?"":"required"}></label>
    <label class="field"><span>${editing?tr("Confirm new password","Új jelszó újra"):tr("Confirm password","Jelszó újra")} ${editing?"":"*"}</span><input name="password_confirmation" type="password" minlength="8" ${editing?"":"required"}></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${editing?tr("Save changes","Módosítások mentése"):tr("Create user","Felhasználó létrehozása")}</button></div></form>`});
  $("#userEditor").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));
    if(editing&&!body.password){delete body.password;delete body.password_confirmation;}
    if(editing&&isSelf)delete body.status;
    const notificationsEnabled=editing&&canManageNotifications?Boolean(event.currentTarget.elements.notifications_enabled?.checked):null;
    delete body.notifications_enabled;
    try{
      const updated=await api(editing?`/api/users/${encodeURIComponent(user.id)}`:"/api/users",{method:editing?"PUT":"POST",body:JSON.stringify(body)});
      if(editing&&canManageNotifications)await api("/api/admin/users/"+encodeURIComponent(user.id)+"/notification-delivery",{method:"PUT",body:JSON.stringify({notifications_enabled:notificationsEnabled})});
      closeDialog();toast(editing?tr("Team member updated.","Csapattag frissítve."):tr("User created.","Felhasználó létrehozva."),"success");
      if(editing&&isSelf){state.user={...state.user,...updated};$("#profileInitials").textContent=initials(state.user.name);}
      await renderProfile();
    }catch(error){toast(humanError(error),"error");}
  });
}

function debounce(fn,wait=180){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait);};}

$("#loginForm").addEventListener("submit",async event=>{
  event.preventDefault();const button=$('button[type="submit"]',event.currentTarget);button.disabled=true;
  try{
    const payload=await api("/api/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});
    if(payload.activation_required){
      sessionStorage.setItem("kh_activation_token",payload.activation_token);$("#loginForm").classList.add("hidden");$("#activationForm").classList.remove("hidden");
      $("#activationHint").textContent=tr(`We sent the code to ${payload.contact_email_masked||"your contact email"}.`,`A kódot ide küldtük: ${payload.contact_email_masked||"a kapcsolati e-mail címre"}.`);$("#activationCode").focus();return;
    }
    setSession(payload);showApp();await renderView();
  }catch(error){toast(humanError(error),"error");}finally{button.disabled=false;}
});
$("#activationForm").addEventListener("submit",async event=>{
  event.preventDefault();
  try{const payload=await api("/api/account-activation/verify",{method:"POST",body:JSON.stringify({activation_token:sessionStorage.getItem("kh_activation_token"),activation_code:$("#activationCode").value})});sessionStorage.removeItem("kh_activation_token");setSession(payload);showApp();await renderView();}
  catch(error){toast(humanError(error),"error");}
});
$("#resendActivationBtn").addEventListener("click",async()=>{try{const payload=await api("/api/account-activation/resend",{method:"POST",body:JSON.stringify({activation_token:sessionStorage.getItem("kh_activation_token")})});sessionStorage.setItem("kh_activation_token",payload.activation_token);toast(tr("A new activation code was sent.","Új aktiváló kód elküldve."),"success");}catch(error){toast(humanError(error),"error");}});
$("#backToLoginBtn").addEventListener("click",()=>{$("#activationForm").classList.add("hidden");$("#loginForm").classList.remove("hidden");sessionStorage.removeItem("kh_activation_token");});

async function boot(){
  applyChromeLanguage();startNewYorkClock();await loadBranding();bindNavigation();
  if(!state.token){showLogin();return;}
  try{state.user=await api("/api/me");showApp();if(!activeViews.has(state.view))state.view="workshop";await renderView();}
  catch(_error){clearSession();showLogin();}
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/service-worker.js").catch(()=>{}),{once:true});
}
// Final compliance extensions invoke boot() after workflow and finance functions are registered.
