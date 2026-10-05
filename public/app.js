"use strict";

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const state={
  token:sessionStorage.getItem("kh_token")||"",
  user:null,
  serviceSuspended:false,
  serviceStatusUpdatedAt:"",
  language:localStorage.getItem("kh_language")==="hu"?"hu":"en",
  view:(location.hash||"#workshop").slice(1)||"workshop",
  clients:[],selectedClientId:null,clientMasterFilter:"ALL",masterMode:"CLIENTS",masterSearchOpen:false,masterSearch:"",masterDetailKind:"CLIENT",masterDirty:false,pianos:[],selectedPianoId:null,duplicateReviews:[],duplicatePendingCount:0,selectedDuplicateReviewId:null,intake:[],users:[],
  cmsPages:[],cmsPage:"home",cmsLanguage:"en",cmsDraft:{},landing:[],clockTimer:null,
  notifications:[],notificationPreferences:null,notificationTimer:null,notificationSource:null,notificationReconnectTimer:null,notificationSeen:new Set(),notificationInitialized:false,notificationUiBound:false
};
const activeViews=new Set(["workshop","messenger","planned","intake","master","finance","documents","cms","profile","settings"]);
const tr=(en,hu)=>state.language==="hu"?hu:en;
const initials=name=>String(name||"KH").split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase();
const roleLabel=role=>role==="WORKER"?tr("Technician","Technikus"):role==="SUPERADMIN"?tr("Super Admin","Szuperadmin"):role==="ADMIN"?tr("Admin","Admin"):role==="MANAGER"?tr("Manager","Menedzser"):role||"";

const chromeText={
  login_copy:["Sign in to the Klavierhaus internal workspace.","Jelentkezz be a Klavierhaus belső munkafelületére."],
  service_suspended_title:["SERVICE SUSPENDED","A SZOLGÁLTATÁS SZÜNETEL"],
  service_suspended_body:["The service is suspended due to an outstanding payment. Only the Super Admin can sign in.","A szolgáltatás díjhátralék miatt szünetel. Kizárólag a szuperadmin jelentkezhet be."],
  email:["Email","E-mail"],password:["Password","Jelszó"],sign_in:["Sign in","Bejelentkezés"],
  account_activation:["ACCOUNT ACTIVATION","FIÓK AKTIVÁLÁS"],confirm_login:["Confirm your login","Erősítsd meg a belépést"],
  six_digit_code:["6-digit code","6 jegyű kód"],activate:["Activate","Aktiválás"],resend_code:["Send a new code","Új kód küldése"],back_to_login:["Back to login","Vissza a belépéshez"],
  nav_workshop:["Workshop & Calendar","Műhely & Naptár"],nav_intake:["Intake","Igényfelmérés"],nav_messenger:["Messenger","Messenger"],nav_planned:["Planned Jobs","Tervezett munkák"],
  nav_master:["Master Data","Törzsadatok"],nav_finance:["Finance","Pénzügy"],nav_documents:["Documents","Dokumentumok"],nav_cms:["Website CMS","Weboldal CMS"],
  mobile_workshop:["Workshop","Műhely"],mobile_messenger:["Messenger","Messenger"],mobile_planned:["Planned","Tervezett"],mobile_intake:["Intake","Igény"],mobile_master:["Master","Törzs"],
  mobile_finance:["Finance","Pénzügy"],mobile_more:["More","Továbbiak"],mobile_profile:["Profile","Profil"],new_york_time:["New York time","New York-i idő"]
};
function applyChromeLanguage(){
  document.documentElement.lang=state.language;
  $$("[data-i18n]").forEach(node=>{
    const pair=chromeText[node.dataset.i18n];
    if(pair)node.textContent=state.language==="hu"?pair[1]:pair[0];
  });
  const toggle=$("#languageToggle");if(toggle)toggle.textContent=state.language==="en"?"HU":"EN";
  const profile=$("#profileButton");if(profile)profile.setAttribute("aria-label",tr("Account menu","Fiókmenü"));
  const welcome=$("#headerWelcome");if(welcome&&state.user)welcome.textContent=tr(`Welcome to the Klavierhaus System, ${state.user.name}.`,`Üdvözöllek a Klavierhaus rendszerében, ${state.user.name}.`);
  const close=$("#appDialog [data-dialog-close]");if(close)close.setAttribute("aria-label",tr("Close","Bezárás"));
  updateNewYorkClock();
}
function setLanguage(language,{save=true}={}){
  state.language=language==="hu"?"hu":"en";
  localStorage.setItem("kh_language",state.language);
  if(state.user)state.user.language_preference=state.language;
  applyChromeLanguage();
  if(save&&state.user)void api("/api/me/preferences",{method:"PUT",body:JSON.stringify({language:state.language})}).catch(error=>toast(humanError(error),"error"));
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
    SERVICE_SUSPENDED:["The service is suspended due to an outstanding payment. Only the Super Admin can sign in.","A szolgáltatás díjhátralék miatt szünetel. Kizárólag a szuperadmin jelentkezhet be."],
    SERVICE_SUSPENSION_STATE_REQUIRED:["Choose whether the service should be active or suspended.","Válaszd ki, hogy a szolgáltatás aktív vagy szüneteltetett legyen."],
    SERVICE_SUSPENSION_CONFIRMATION_REQUIRED:["Confirm the service access change.","Erősítsd meg a szolgáltatás-hozzáférés módosítását."],
    HIDDEN_OWNER_SELF_SERVICE_ONLY:["The protected Super Admin account can only be changed from its own profile.","A védett szuperadmin fiók kizárólag a saját profiljából módosítható."],
    USER_EMAIL_ALREADY_USED:["This email address is already used by another account.","Ezt az e-mail címet már másik fiók használja."],
    CLIENT_NAME_REQUIRED:["Client name is required.","Az ügyfél neve kötelező."],INVALID_CLIENT_EMAIL:["Invalid client email.","Érvénytelen ügyfél e-mail."],INVALID_CLIENT_TYPE:["Choose Individual, Partner, Business or Institution.","Válassz Magánszemély, Partner, Üzleti vagy Intézményi típust."],
    PIANO_BRAND_REQUIRED:["Piano brand is required.","A zongora márkája kötelező."],PIANO_DETAILS_REQUIRED:["Piano details are required.","A zongora adatai szükségesek."],MASTER_DATA_INTEGRITY_FAILED:["The import was rolled back because the complete 33-column Master Data contract did not pass.","Az import vissza lett vonva, mert a teljes 33 oszlopos törzsadat-kontraktus ellenőrzése nem ment át."],MASTER_DATA_CSV_FORMAT_UNSUPPORTED:["Use the required Klavierhaus 33-column source CSV.","A kötelező Klavierhaus 33 oszlopos forrás-CSV-t használd."],
    REPORTED_ISSUE_REQUIRED:["Describe the requested service or issue.","A hiba vagy igény leírása kötelező."],INVALID_PIANO_ID:["The selected piano does not belong to this client.","A kiválasztott zongora nem ehhez az ügyfélhez tartozik."],
    PERMISSION_DENIED:["You do not have permission for this action.","Nincs jogosultság ehhez a művelethez."],ADMIN_REQUIRED:["Admin permission is required.","Admin jogosultság szükséges."],
    JOB_TITLE_REQUIRED:["Job title is required.","A munka megnevezése kötelező."],JOB_MUST_BE_ACTIVATED:["Activate and schedule this job first.","A munkát előbb aktiválni és ütemezni kell."],
    TECHNICIAN_REQUIRED_FOR_SCHEDULE:["Choose a technician before scheduling.","Ütemezéshez technikust kell választani."],SCHEDULE_CONFLICT:["This technician already has an overlapping job.","A technikusnak ebben az időpontban már van másik munkája."],
    INTAKE_JOB_ALREADY_EXISTS:["A planned job already exists for this intake.","Ehhez az igényhez már tartozik tervezett munka."],
    CLIENT_EMAIL_REQUIRED:["A valid customer email is required for this action.","Ehhez a művelethez érvényes ügyfél e-mail szükséges."],JOB_ASSIGNED_TO_ANOTHER_TECHNICIAN:["This job is assigned to another technician.","A munka másik technikushoz van rendelve."],
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
    DUPLICATE_REVIEW_NOT_FOUND:["This duplicate review no longer exists.","Ez a duplikációs ellenőrzés már nem létezik."],
    DUPLICATE_REVIEW_ALREADY_RESOLVED:["This duplicate review has already been resolved.","Ez a duplikációs ellenőrzés már lezárult."],
    INVALID_PRIMARY_CLIENT:["Choose which customer record should remain active.","Válaszd ki, melyik ügyfélrekord maradjon aktív."],
    ARCHIVED_CLIENT_NOT_FOUND:["The archived client record was not found.","Az archivált ügyfélrekord nem található."],
    ARCHIVED_CLIENT_RECORD_MISSING:["The archived customer cannot be restored because the underlying record is missing.","Az archivált ügyfél nem állítható vissza, mert az alaprekord hiányzik."],
    WORKFLOW_FIXED_STAGE_REQUIRED:["Received, Admin Approval and Completed are required.","A Beérkezett, Admin jóváhagyás és Lezárva fázis kötelező."],
    WORKFLOW_STAGE_LIMIT_REACHED:["The workflow already has the maximum seven phases.","A munkafolyamat már elérte a legfeljebb hét fázist."],
    WORKFLOW_PHASE_END_BEFORE_START:["The phase completion must be later than its start.","A fázis befejezése csak a kezdés után lehet."],
    WORKFLOW_LOGISTICS_MINIMUM_WINDOW:["Arrival and delivery phases require at least a three-hour time window.","A beérkezési és kiszállítási fázisokhoz legalább háromórás időablak szükséges."],
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
function readServiceBootstrap(){
  const node=$("#khServiceBootstrap");if(!node)return null;
  try{return JSON.parse(node.textContent||"{}");}catch(_error){return null;}
}
function applyServiceStatus(payload){
  if(!payload||typeof payload!=="object")return;
  const suspended=payload.suspended===true||payload.available===false||String(payload.status||"").toUpperCase()==="SUSPENDED";
  state.serviceSuspended=suspended;state.serviceStatusUpdatedAt=payload.updated_at||state.serviceStatusUpdatedAt||"";
  const notice=$("#serviceSuspensionNotice");if(notice)notice.classList.toggle("hidden",!suspended);
  applyChromeLanguage();
}
async function refreshServiceStatus(){
  try{
    const response=await fetch("/api/public/service-status",{cache:"no-store",headers:{Accept:"application/json"}});
    if(!response.ok)return state.serviceSuspended;
    const payload=await response.json();applyServiceStatus(payload);return state.serviceSuspended;
  }catch(_error){return state.serviceSuspended;}
}
const API_MEMORY_CACHE_MS=750;
const API_MEMORY_CACHE_LIMIT=120;
const apiInflightGets=new Map();
const apiRecentGets=new Map();
function clearApiMemoryCache(){apiRecentGets.clear();}
function pruneApiMemoryCache(now=Date.now()){
  for(const [key,row] of apiRecentGets)if(now-row.at>API_MEMORY_CACHE_MS*4)apiRecentGets.delete(key);
  while(apiRecentGets.size>API_MEMORY_CACHE_LIMIT)apiRecentGets.delete(apiRecentGets.keys().next().value);
}
async function api(url,options={}){
  const method=String(options.method||"GET").toUpperCase(),dedupe=method==="GET"&&options.body===undefined;
  const memoryCacheMs=dedupe?Math.max(0,Number(options.memoryCacheMs??API_MEMORY_CACHE_MS)||0):0;
  const requestKey=dedupe?`${state.token||"anon"}:${url}`:"";
  if(requestKey&&memoryCacheMs>0){
    const cached=apiRecentGets.get(requestKey),now=Date.now();
    if(cached&&now-cached.at<=memoryCacheMs)return cached.value;
    if(cached)apiRecentGets.delete(requestKey);
  }
  if(requestKey&&apiInflightGets.has(requestKey))return apiInflightGets.get(requestKey);
  const request=(async()=>{
    const requestOptions={...options};delete requestOptions.memoryCacheMs;
    const headers={Accept:"application/json",...(requestOptions.headers||{})};
    if(state.token)headers.Authorization=`Bearer ${state.token}`;
    if(requestOptions.body!==undefined&&!(requestOptions.body instanceof FormData)&&!headers["Content-Type"])headers["Content-Type"]="application/json";
    const response=await fetch(url,{...requestOptions,headers,cache:"no-store"});
    const type=response.headers.get("content-type")||"";
    const data=type.includes("application/json")?await response.json().catch(()=>({})):await response.text();
    if(!response.ok){
      if(data?.error==="SERVICE_SUSPENDED"){
        applyServiceStatus({suspended:true,status:"SUSPENDED"});
        if(state.token){clearSession();showLogin();}
      }else if(response.status===401&&state.token){clearSession();showLogin();}
      const error=new Error(data?.error||`HTTP_${response.status}`);error.status=response.status;error.payload=data;throw error;
    }
    if(method!=="GET")clearApiMemoryCache();
    else if(requestKey&&memoryCacheMs>0){apiRecentGets.set(requestKey,{at:Date.now(),value:data});pruneApiMemoryCache();}
    return data;
  })();
  if(!requestKey)return request;
  apiInflightGets.set(requestKey,request);
  try{return await request;}
  finally{if(apiInflightGets.get(requestKey)===request)apiInflightGets.delete(requestKey);}
}
function setSession(payload){
  clearApiMemoryCache();
  state.token=payload.token;state.user=payload.user;
  if(payload.service_suspended!==undefined)applyServiceStatus({suspended:Boolean(payload.service_suspended),status:payload.service_suspended?"SUSPENDED":"ACTIVE"});
  if(state.serviceSuspended&&(state.user?.role==="SUPERADMIN"||Number(state.user?.is_superadmin||0)===1)){state.view="profile";history.replaceState({},"","#profile");}
  sessionStorage.setItem("kh_token",state.token);sessionStorage.setItem("kh_user",JSON.stringify(state.user));
}
function clearSession(){
  clearApiMemoryCache();apiInflightGets.clear();
  state.token="";state.user=null;sessionStorage.removeItem("kh_token");sessionStorage.removeItem("kh_user");
  clearInterval(state.notificationTimer);state.notificationTimer=null;clearTimeout(state.notificationReconnectTimer);state.notificationReconnectTimer=null;state.notificationSource?.close?.();state.notificationSource=null;state.notifications=[];state.notificationInitialized=false;state.notificationSeen=new Set();updateAppBadge(0);closeNotificationDrawer();
}
function showLogin(){$("#loginScreen").classList.remove("hidden");$("#appShell").classList.add("hidden");void refreshServiceStatus();}
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
function syncVisualViewportHeight(){
  const viewport=window.visualViewport,height=Math.max(320,Math.round(viewport?.height||window.innerHeight||document.documentElement.clientHeight||0));
  document.documentElement.style.setProperty("--kh-visual-viewport-height",height+"px");
  document.documentElement.style.setProperty("--kh-visual-viewport-top",Math.max(0,Math.round(viewport?.offsetTop||0))+"px");
}
syncVisualViewportHeight();
window.visualViewport?.addEventListener("resize",syncVisualViewportHeight,{passive:true});
window.visualViewport?.addEventListener("scroll",syncVisualViewportHeight,{passive:true});
window.addEventListener("orientationchange",()=>setTimeout(syncVisualViewportHeight,80),{passive:true});
function showApp(){
  $("#loginScreen").classList.add("hidden");$("#appShell").classList.remove("hidden");
  $("#profileInitials").textContent=initials(state.user?.name);
  const avatar=$("#profileAvatarImage");if(avatar){if(state.user?.profile_image_url){avatar.src=state.user.profile_image_url;avatar.hidden=false;$("#profileInitials").hidden=true;}else{avatar.hidden=true;$("#profileInitials").hidden=false;}}
  const welcome=$("#headerWelcome");if(welcome)welcome.textContent=tr(`Welcome to the Klavierhaus System, ${state.user?.name||""}.`,`Üdvözöllek a Klavierhaus rendszerében, ${state.user?.name||""}.`);
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
        ${row.action_url?`<button class="secondary-button compact-button" type="button" data-notification-view="${esc(row.id)}">↗ ${tr("View","Megnyitás")}</button>`:""}
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
  list.querySelectorAll("[data-notification-remind]").forEach(button=>button.addEventListener("click",event=>{event.stopPropagation();openNotificationReminder(button.dataset.notificationRemind);}));
  list.querySelectorAll("[data-notification-view]").forEach(button=>button.addEventListener("click",async event=>{
    event.stopPropagation();const row=rows.find(item=>String(item.id)===String(button.dataset.notificationView));if(!row)return;
    try{await api("/api/notifications/"+encodeURIComponent(row.id)+"/read",{method:"POST",body:"{}"});}catch(_error){}
    await notificationNavigate(row);
  }));
  list.querySelectorAll("[data-notification-card]").forEach(card=>card.addEventListener("click",async event=>{
    if(event.target.closest("button,input"))return;const id=card.dataset.notificationCard,row=rows.find(item=>String(item.id)===String(id));
    try{await api("/api/notifications/"+encodeURIComponent(id)+"/read",{method:"POST",body:"{}"});}catch(_error){}
    if(row?.action_url)await notificationNavigate(row);
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
    document.title=`${branding.company_name||"Klavierhaus"} System`;
  }catch(_error){}
}
function syncNavigationState(view=state.view){
  $$(".nav-item[data-nav],.mobile-nav [data-nav]").forEach(button=>button.classList.toggle("active",button.dataset.nav===view));
  $("#mobileMoreButton")?.classList.toggle("active",["planned","finance","documents","cms","profile"].includes(view));
}
async function masterSaveCurrentInlineForm({renderAfter=false}={}){
  const clientForm=$("#clientInlineForm"),pianoForm=$("#pianoInlineForm");
  if(clientForm){
    if(!clientForm.reportValidity())return false;
    const body=Object.fromEntries(new FormData(clientForm));body.is_vip=Boolean(clientForm.elements.is_vip?.checked);
    try{
      const saved=await api(`/api/clients/${state.selectedClientId}`,{method:"PUT",body:JSON.stringify(body)});
      const index=state.clients.findIndex(row=>Number(row.id)===Number(saved.id));
      if(index>=0)state.clients[index]={...state.clients[index],...saved};
      state.selectedClientId=Number(saved.id);setMasterDirty(false);toast(tr("Client saved.","Ügyfél mentve."),"success");
      if(renderAfter)await renderMaster();
      return true;
    }catch(error){toast(humanError(error),"error");return false;}
  }
  if(pianoForm){
    if(!pianoForm.reportValidity())return false;
    const body=Object.fromEntries(new FormData(pianoForm));body.client_id=body.client_id?Number(body.client_id):null;if(body.build_year==="")body.build_year=null;
    try{
      const saved=await api(`/api/pianos/${state.selectedPianoId}`,{method:"PUT",body:JSON.stringify(body)});
      const index=state.pianos.findIndex(row=>Number(row.id)===Number(saved.id));
      if(index>=0)state.pianos[index]={...state.pianos[index],...saved};
      state.selectedPianoId=Number(saved.id);setMasterDirty(false);toast(tr("Piano saved.","Zongora mentve."),"success");
      if(renderAfter){await renderMaster();openMasterMobileDetail();}
      return true;
    }catch(error){toast(humanError(error),"error");return false;}
  }
  return false;
}
function masterUnsavedDecision(){
  return new Promise(resolve=>{
    const dialog=openDialog({
      title:tr("Unsaved changes","Nem mentett módosítások"),
      eyebrow:tr("MASTER DATA","TÖRZSADATOK"),
      body:`<div class="master-unsaved-dialog"><p>${tr("You have unsaved changes. What would you like to do?","Nem mentett módosításaid vannak. Mit szeretnél tenni?")}</p><div class="form-actions master-unsaved-actions"><button class="primary-button" type="button" data-master-unsaved-action="save">${tr("Save","Mentés")}</button><button class="danger-button" type="button" data-master-unsaved-action="discard">${tr("Discard changes","Módosítások elvetése")}</button><button class="secondary-button" type="button" data-master-unsaved-action="cancel">${tr("Cancel","Mégse")}</button></div></div>`
    });
    let settled=false;
    const finish=decision=>{
      if(settled)return;settled=true;
      dialog.removeEventListener("click",onClick);dialog.removeEventListener("close",onClose);
      if(dialog.open)dialog.close();
      resolve(decision);
    };
    const onClick=event=>{
      const button=event.target.closest("[data-master-unsaved-action]");if(!button)return;
      event.preventDefault();finish(button.dataset.masterUnsavedAction);
    };
    const onClose=()=>finish("cancel");
    dialog.addEventListener("click",onClick);
    dialog.addEventListener("close",onClose,{once:true});
  });
}
async function masterConfirmDiscard(){
  if(!state.masterDirty)return true;
  const decision=await masterUnsavedDecision();
  if(decision==="discard"){setMasterDirty(false);return true;}
  if(decision==="save")return masterSaveCurrentInlineForm({renderAfter:false});
  return false;
}
async function navTo(view){
  if(!activeViews.has(view))return;
  if(state.view==="master"&&view!=="master"&&!(await masterConfirmDiscard()))return;
  state.view=view;history.replaceState({},"",`#${view}`);
  if(typeof v6CloseMore==="function")v6CloseMore();
  syncNavigationState(view);
  return renderView();
}
function consumeDeepLink(){
  const params=new URLSearchParams(location.search),view=params.get("view");
  if(!view||!activeViews.has(view))return false;
  state.view=view;
  if(view==="master"){
    const clientId=Number(params.get("client")||0),pianoId=Number(params.get("piano")||0);
    if(clientId){state.selectedClientId=clientId;state.clientMasterFilter="ALL";state.masterSearch="";state.masterMode="CLIENTS";state.masterDetailKind="CLIENT";}
    if(pianoId){state.selectedPianoId=pianoId;state.masterSearch="";state.masterMode="PIANOS";state.masterDetailKind="PIANO";}
  }else if(view==="intake"){
    const intakeId=Number(params.get("intake")||0);if(intakeId)state.pendingIntakeEditId=intakeId;
  }else if(view==="documents"){
    const category=params.get("category"),archiveId=Number(params.get("archive")||0);
    if(category)state.archiveCategory=category;if(archiveId)state.pendingArchiveId=archiveId;
  }else if(view==="finance"){
    const invoiceId=Number(params.get("invoice")||0);if(invoiceId)state.pendingNotificationInvoiceId=invoiceId;
  }else if(view==="workshop"){
    const jobId=Number(params.get("job")||0);if(jobId)state.pendingNotificationJobId=jobId;
  }
  history.replaceState({},"",`#${view}`);return true;
}
async function notificationNavigate(row){
  if(!row?.action_url)return;
  let url;try{url=new URL(row.action_url,location.origin);}catch(_error){return;}
  const view=url.searchParams.get("view");
  if(view&&activeViews.has(view)){
    history.replaceState({},"",url.pathname+url.search+url.hash);consumeDeepLink();closeNotificationDrawer({restoreFocus:false});await renderView();return;
  }
  if(url.hash&&activeViews.has(url.hash.slice(1))){closeNotificationDrawer({restoreFocus:false});await navTo(url.hash.slice(1));}
}
function bindNavigation(){
  document.addEventListener("click",event=>{
    const button=event.target.closest("[data-nav]");
    if(!button||button.disabled)return;
    event.preventDefault();void navTo(button.dataset.nav);
  });
  window.addEventListener("hashchange",async()=>{const view=location.hash.slice(1);if(activeViews.has(view)){if(state.view==="master"&&view!=="master"&&!(await masterConfirmDiscard())){history.replaceState({},"",`#${state.view}`);return;}state.view=view;void renderView();}});
  window.addEventListener("beforeunload",event=>{if(state.masterDirty){event.preventDefault();event.returnValue="";}});
  $("#languageToggle")?.addEventListener("click",()=>setLanguage(state.language==="en"?"hu":"en"));
}
function loading(){return `<div class="loading">${tr("Loading…","Betöltés…")}</div>`;}
function pageHead(title,subtitle,actions=""){return `<header class="page-head"><div><span class="eyebrow">KLAVIERHAUS SYSTEM</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="page-actions">${actions}</div></header>`;}
function openDialog({title,eyebrow="",body,variant=""}){
  $("#dialogTitle").textContent=title;$("#dialogEyebrow").textContent=eyebrow;$("#dialogBody").innerHTML=body;
  const dialog=$("#appDialog");dialog.classList.toggle("app-dialog--wide",variant==="wide");if(!dialog.open)dialog.showModal();return dialog;
}
function closeDialog(){const dialog=$("#appDialog");if(dialog?.open)dialog.close();}
document.addEventListener("click",event=>{
  if(event.target.closest("[data-dialog-close],[data-close-dialog]")){event.preventDefault();closeDialog();}
});
$("#appDialog").addEventListener("click",event=>{if(event.target===$("#appDialog"))closeDialog();});
$("#appDialog").addEventListener("cancel",event=>{event.preventDefault();closeDialog();});

async function renderView(){
  consumeDeepLink();
  document.documentElement.classList.remove("messenger-thread-open");
  $("#appShell")?.classList.toggle("messenger-mode",state.view==="messenger");
  const workspace=$("#workspace");workspace.classList.toggle("messenger-workspace",state.view==="messenger");workspace.innerHTML=loading();
  try{
    if(state.view==="workshop")await renderWorkshop();
    else if(state.view==="messenger")await renderMessenger();
    else if(state.view==="planned")await renderPlanned();
    else if(state.view==="master")await renderMaster();
    else if(state.view==="finance")await renderFinance();
    else if(state.view==="documents")await renderDocuments();
    else if(state.view==="cms")await renderCms();
    else if(state.view==="profile")await renderProfile();
    else if(state.view==="settings")await renderSettings();
    else await renderIntake();
    workspace.focus({preventScroll:true});
    syncNavigationState(state.view);
  }catch(error){
    workspace.innerHTML=`<section class="panel empty-state"><strong>${tr("The view could not be loaded.","Nem sikerült betölteni a nézetet.")}</strong><p>${esc(humanError(error))}</p><button class="secondary-button" type="button" id="retryView">${tr("Retry","Újrapróbálás")}</button></section>`;
    $("#retryView")?.addEventListener("click",()=>renderView());
  }
}
async function loadClients(query=""){state.clients=await api(`/api/clients${query?`?q=${encodeURIComponent(query)}`:""}`);return state.clients;}
async function loadUsers(){state.users=await api("/api/users");return state.users;}

function masterIconSvg(kind){
  const paths={
    SEARCH:'<circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path>',
    CLIENTS:'<path d="M4 19v-1.5A4.5 4.5 0 0 1 8.5 13h3A4.5 4.5 0 0 1 16 17.5V19"></path><circle cx="10" cy="7" r="3"></circle><path d="M17 13a4 4 0 0 1 3 3.9V19M16 4.5a3 3 0 0 1 0 5.8"></path>',
    VIP:'<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path>',
    INDIVIDUAL:'<circle cx="12" cy="8" r="3.5"></circle><path d="M5 20a7 7 0 0 1 14 0"></path>',
    PARTNER:'<path d="M8 12l2.2 2.2L16 8.5"></path><path d="M4 11.5 8 7l4 3.5L16 7l4 4.5v7H4z"></path>',
    BUSINESS:'<path d="M4 21V7l8-4v18M12 9h8v12M7 9h2M7 13h2M7 17h2M15 12h2M15 16h2M3 21h18"></path>',
    INSTITUTION:'<path d="m3 9 9-5 9 5M5 10h14M6 10v8M10 10v8M14 10v8M18 10v8M4 18h16M3 21h18"></path>',
    PIANOS:'<path d="M3 5h18v14H3z"></path><path d="M6 5v9M10 5v9M14 5v9M18 5v9M3 14h18"></path><path d="M8 14v3M12 14v3M16 14v3"></path>',
    DUPLICATES:'<path d="M8 7a4 4 0 1 1 4 4H8a4 4 0 1 1 0-8h4"></path><path d="M16 17a4 4 0 1 1-4-4h4a4 4 0 1 1 0 8h-4"></path><path d="M9 9l6 6M15 9l-6 6"></path>'
  };
  return `<svg class="master-tool-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[kind]||paths.CLIENTS}</svg>`;
}
function masterToolButton(kind,label,active=false,count=null){
  const badge=Number.isFinite(Number(count))&&Number(count)>0?`<span class="master-tool-badge">${Number(count)}</span>`:"";
  return `<button class="master-tool-button ${active?"active":""}" type="button" data-master-tool="${kind}" aria-label="${esc(label)}" title="${esc(label)}">${masterIconSvg(kind)}${badge}</button>`;
}
function clientTypeLabel(value){
  return ({INDIVIDUAL:tr("Individual","Magánszemély"),PARTNER:tr("Professional partner","Szakmai partner"),BUSINESS:tr("Business","Vállalkozások"),INSTITUTION:tr("Institution","Intézmények")})[String(value||"INDIVIDUAL").toUpperCase()]||tr("Individual","Magánszemély");
}
function masterInlineEditable(){
  return window.innerWidth>=1024&&navigator.maxTouchPoints<=1&&!/iPad|Android|Mobile|Tablet/i.test(navigator.userAgent||"");
}
function setMasterDirty(value=true){state.masterDirty=Boolean(value);}
function masterMapUrl(address){
  const destination=encodeURIComponent(String(address||"").trim());
  if(!destination)return "";
  const apple=/Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(navigator.userAgent||"");
  return apple?`https://maps.apple.com/?saddr=Current+Location&daddr=${destination}`:`https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}
function openMasterMap(address){
  const url=masterMapUrl(address);if(!url){toast(tr("No address for this customer.","Az ügyfélhez nem tartozik cím."),"error");return;}
  window.open(url,"_blank","noopener,noreferrer");
}
function masterPendingText(){return tr("Data pending","Adatpótlásra vár");}
function masterDateInputValue(value){
  const raw=String(value??"").trim();if(!raw)return "";
  let match=raw.match(/^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})[.]?(?:[T\s].*)?$/);
  if(match){const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),probe=new Date(Date.UTC(year,month-1,day));if(probe.getUTCFullYear()===year&&probe.getUTCMonth()===month-1&&probe.getUTCDate()===day)return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;}
  match=raw.match(/^(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{4})[.]?$/);
  if(match){const first=Number(match[1]),second=Number(match[2]),year=Number(match[3]),month=state.language==="hu"?second:first,day=state.language==="hu"?first:second,probe=new Date(Date.UTC(year,month-1,day));if(probe.getUTCFullYear()===year&&probe.getUTCMonth()===month-1&&probe.getUTCDate()===day)return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;}
  const parsed=new Date(raw);if(Number.isFinite(parsed.getTime()))return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth()+1).padStart(2,"0")}-${String(parsed.getUTCDate()).padStart(2,"0")}`;
  return "";
}
function masterValue(value,{brand=false}={}){
  const textValue=String(value??"").trim();
  return textValue||(brand?"No brand":masterPendingText());
}
function masterPendingClass(value){return String(value??"").trim()?"":" master-data-pending";}
function masterReviewBadge(client){
  const count=Number(client?.piano_review_count||0);
  return count>0?`<span class="master-review-badge" title="${esc(tr("Data conflict needs review","Adatütközés ellenőrzésre vár"))}">!<small>${count}</small></span>`:"";
}
function masterClientFormAddress(form){
  if(!form)return "";
  return ["street","city","district","postcode","country"].map(name=>String(form.elements?.[name]?.value||"").trim()).filter(Boolean).join(", ");
}
function clientStructuredFields(client={}){
  return `
    <div class="master-form-section full"><strong>${tr("Identity","Személy / szervezet")}</strong><small>${tr("Every source field is retained. Empty values remain editable.","Minden forrásmezőt megőrzünk. A hiányzó adatok utólag szerkeszthetők.")}</small></div>
    <label class="field"><span>${tr("Display name","Megjelenített név")}</span><input name="name" value="${esc(client.name==="Data pending"?"":client.name||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("First name","Keresztnév")}</span><input name="first_name" value="${esc(client.first_name||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Last name","Vezetéknév")}</span><input name="last_name" value="${esc(client.last_name||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Company name","Cégnév")}</span><input name="company_name" value="${esc(client.company_name||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Contact name","Kapcsolattartó neve")}</span><input name="contact_name" value="${esc(client.contact_name||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>Email</span><input name="email" type="email" value="${esc(client.email||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Mobile phone","Mobiltelefon")}</span><input name="mobile_phone" value="${esc(client.mobile_phone||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Landline phone","Vezetékes telefon")}</span><input name="line_phone" value="${esc(client.line_phone||"")}" placeholder="${esc(masterPendingText())}"></label>
    <div class="master-form-section full"><strong>${tr("Address","Cím")}</strong></div>
    <label class="field full"><span>${tr("Street","Utca, házszám")}</span><input name="street" value="${esc(client.street||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("City","Város")}</span><input name="city" value="${esc(client.city||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("District / State","Kerület / állam")}</span><input name="district" value="${esc(client.district||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Postcode","Irányítószám")}</span><input name="postcode" value="${esc(client.postcode||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Country","Ország")}</span><input name="country" value="${esc(client.country||"")}" placeholder="${esc(masterPendingText())}"></label>
    <div class="master-form-section full"><strong>${tr("Legacy notes","Korábbi megjegyzések")}</strong></div>
    <label class="field full"><span>${tr("Notes","Megjegyzés")}</span><textarea name="notes" placeholder="${esc(masterPendingText())}">${esc(client.notes||"")}</textarea></label>
    <label class="field full"><span>${tr("Short memo to name","Rövid név-memó")}</span><textarea name="short_memo_to_name" placeholder="${esc(masterPendingText())}">${esc(client.short_memo_to_name||"")}</textarea></label>
    <label class="field"><span>${tr("Client type","Ügyféltípus")}</span><select name="client_type"><option value="INDIVIDUAL" ${String(client.client_type||"INDIVIDUAL")==="INDIVIDUAL"?"selected":""}>${tr("Individual","Magánszemély")}</option><option value="PARTNER" ${client.client_type==="PARTNER"?"selected":""}>${tr("Professional partner","Szakmai partner")}</option><option value="BUSINESS" ${client.client_type==="BUSINESS"?"selected":""}>${tr("Business","Vállalkozás")}</option><option value="INSTITUTION" ${client.client_type==="INSTITUTION"?"selected":""}>${tr("Institution","Intézmény")}</option></select></label>
    <label class="cms-toggle-row full vip-toggle-row"><span><strong>★ VIP</strong></span><input name="is_vip" type="checkbox" ${Number(client.is_vip||0)===1?"checked":""}></label>`;
}
function pianoStructuredFields(piano={},ownerId=null,{includeReview=false}={}){
  const selectedOwnerId=Number((ownerId??piano.client_id)||0)||null;
  return `
    <div class="master-form-section full"><strong>${tr("Ownership & identification","Tulajdonos és azonosítás")}</strong><small>${tr("Missing values never hide the piano; they stay editable as data pending.","A hiányzó mezők miatt a zongora nem tűnik el; adatpótlásra váró, szerkeszthető mezők maradnak.")}</small></div>
    <label class="field"><span>${tr("Owner","Tulajdonos")}</span><select name="client_id"><option value="" ${selectedOwnerId?"":"selected"}>${masterPendingText()}</option>${state.clients.map(row=>`<option value="${row.id}" ${Number(row.id)===Number(selectedOwnerId)?"selected":""}>${esc(row.name)}</option>`).join("")}</select></label>
    <label class="field"><span>${tr("Category","Kategória")}</span><input name="category" value="${esc(piano.category||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Brand","Márka")}</span><input name="brand" value="${esc(piano.brand&&piano.brand!=="No brand"?piano.brand:"")}" placeholder="No brand"></label>
    <label class="field"><span>${tr("Model","Modell")}</span><input name="model" value="${esc(piano.model||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Size","Méret")}</span><input name="size_display" value="${esc(piano.size_display||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Color","Szín")}</span><input name="color" value="${esc(piano.color||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Serial number","Gyári szám")}</span><input name="serial_number" value="${esc(piano.serial_number||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Year built","Gyártási év")}</span><input name="build_year" type="number" min="1700" max="2100" value="${esc(piano.build_year||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Finish","Kivitel")}</span><input name="finish" value="${esc(piano.finish||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field full"><span>${tr("Instrument note","Hangszer-megjegyzés")}</span><textarea name="notes" placeholder="${esc(masterPendingText())}">${esc(piano.notes||"")}</textarea></label>
    <div class="master-form-section full"><strong>${tr("Purchase & warranty","Vásárlás és garancia")}</strong></div>
    <label class="field"><span>${tr("Date of purchase","Vásárlás dátuma")}</span><input name="date_of_purchase" type="date" data-calendar-date lang="${state.language==="hu"?"hu-HU":"en-US"}" value="${esc(masterDateInputValue(piano.date_of_purchase))}"></label>
    <label class="field"><span>${tr("Warranty","Garancia")}</span><input name="warranty" value="${esc(piano.warranty||"")}" placeholder="${esc(masterPendingText())}"></label>
    <div class="master-form-section full"><strong>${tr("Service information","Szervizinformáció")}</strong></div>
    <label class="field"><span>${tr("Last service date","Utolsó szerviz dátuma")}</span><input name="last_serviced_at" type="date" data-calendar-date lang="${state.language==="hu"?"hu-HU":"en-US"}" value="${esc(masterDateInputValue(piano.last_serviced_at))}"></label>
    <label class="field"><span>${tr("Last service title","Utolsó szerviz címe")}</span><input name="last_service_title" value="${esc(piano.last_service_title||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field full"><span>${tr("Last service description","Utolsó szerviz leírása")}</span><textarea name="last_service_description" placeholder="${esc(masterPendingText())}">${esc(piano.last_service_description||"")}</textarea></label>
    <label class="field"><span>${tr("Next service date","Következő szerviz dátuma")}</span><input name="next_service_date" type="date" data-calendar-date lang="${state.language==="hu"?"hu-HU":"en-US"}" value="${esc(masterDateInputValue(piano.next_service_date))}"></label>
    <div class="master-form-section full"><strong>${tr("Latest environment information","Legutóbbi környezeti adatok")}</strong></div>
    <label class="field"><span>${tr("Frequency","Frekvencia")}</span><input name="latest_info_frequency" value="${esc(piano.latest_info_frequency||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Humidity","Páratartalom")}</span><input name="latest_info_humidity" value="${esc(piano.latest_info_humidity||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field"><span>${tr("Temperature","Hőmérséklet")}</span><input name="latest_info_temperature" value="${esc(piano.latest_info_temperature||"")}" placeholder="${esc(masterPendingText())}"></label>
    <label class="field full"><span>${tr("Piano-specific location","Zongora külön helye")}</span><textarea name="location_notes" placeholder="${esc(tr("Leave blank to use the customer's address.","Hagyd üresen az ügyfél címének használatához."))}">${esc(piano.location_notes||"")}</textarea><small>${tr("Blank = customer address automatically.","Üresen hagyva automatikusan az ügyfél címe jelenik meg.")}</small></label>
    ${includeReview&&piano.review_id?`<input type="hidden" name="review_id" value="${piano.review_id}">`:""}`;
}
function masterReadonlyItem(label,value,{full=false,brand=false,extra=""}={}){
  const present=String(value??"").trim(),display=masterValue(value,{brand});
  return `<div class="${full?"full":""}"><span>${esc(label)}</span><strong class="${present?"":"master-data-pending"}">${esc(display)}</strong>${extra}</div>`;
}

async function renderMaster(){
  if(masterQuery())state.masterSearchOpen=true;
  const workspace=$("#workspace"),canReviewDuplicates=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  const [,pianoOverview,duplicatePayload]=await Promise.all([
    loadClients(),
    api("/api/master-data/piano-overview"),
    canReviewDuplicates?api("/api/client-duplicates").catch(()=>({pending_count:0,cases:[]})):Promise.resolve({pending_count:0,cases:[]})
  ]);
  state.pianos=Array.isArray(pianoOverview?.classified)?pianoOverview.classified:[];
  state.pianoReviews=Array.isArray(pianoOverview?.review)?pianoOverview.review:[];
  state.pianoOverview=pianoOverview?.totals||{classified:state.pianos.length,review:state.pianoReviews.length,total_entities:state.pianos.length,source_rows:0,source_groups:0,owner_linked:state.pianos.filter(row=>row.client_id).length,owner_pending:state.pianos.filter(row=>!row.client_id).length};
  state.masterMigration=pianoOverview?.migration||{ok:false,status:"AWAITING_SOURCE",rows:0};
  state.duplicateReviews=Array.isArray(duplicatePayload?.cases)?duplicatePayload.cases:[];
  state.duplicatePendingCount=Number(duplicatePayload?.pending_count||state.duplicateReviews.length);
  if(!canReviewDuplicates&&state.masterMode==="DUPLICATES")state.masterMode="CLIENTS";
  if(!state.selectedClientId&&state.clients.length)state.selectedClientId=Number(state.clients[0].id);
  if(!state.selectedPianoId&&state.pianos.length)state.selectedPianoId=Number(state.pianos[0].id);
  if(!state.selectedDuplicateReviewId&&state.duplicateReviews.length)state.selectedDuplicateReviewId=Number(state.duplicateReviews[0].id);
  if(state.selectedDuplicateReviewId&&!state.duplicateReviews.some(row=>Number(row.id)===Number(state.selectedDuplicateReviewId)))state.selectedDuplicateReviewId=Number(state.duplicateReviews[0]?.id||0)||null;
  const filter=state.clientMasterFilter||"ALL",mode=state.masterMode||"CLIENTS";
  workspace.innerHTML=pageHead(tr("Master Data","Törzsadatok"),tr("Clients and pianos in one editable workspace. Every source field remains available.","Ügyfelek és zongorák egyetlen szerkeszthető munkafelületen. Minden forrásadatmező elérhető."),
    `<button id="addClientBtn" class="primary-button" type="button">＋ ${tr("New client","Új ügyfél")}</button>`)+
    `<div class="master-layout" id="masterLayout">
      <section class="panel master-list-panel">
        <div class="master-toolbar">
          <div class="master-tools" role="toolbar" aria-label="${tr("Master Data filters","Törzsadat szűrők")}">
            ${masterToolButton("SEARCH",tr("Search","Keresés"),state.masterSearchOpen)}
            ${masterToolButton("CLIENTS",tr("All clients","Összes ügyfél"),mode==="CLIENTS"&&filter==="ALL")}
            ${masterToolButton("VIP","VIP",mode==="CLIENTS"&&filter==="VIP")}
            ${masterToolButton("INDIVIDUAL",tr("Individuals","Magánszemélyek"),mode==="CLIENTS"&&filter==="INDIVIDUAL")}
            ${masterToolButton("PARTNER",tr("Partners","Partnerek"),mode==="CLIENTS"&&filter==="PARTNER")}
            ${masterToolButton("BUSINESS",tr("Business","Vállalkozások"),mode==="CLIENTS"&&filter==="BUSINESS")}
            ${masterToolButton("INSTITUTION",tr("Institution","Intézmények"),mode==="CLIENTS"&&filter==="INSTITUTION")}
            ${masterToolButton("PIANOS",tr("Pianos","Zongorák"),mode==="PIANOS")}
            ${canReviewDuplicates?masterToolButton("DUPLICATES",tr("Possible duplicates","Vélelmezett duplikációk"),mode==="DUPLICATES",state.duplicatePendingCount):""}
          </div>
          <div class="master-search-reveal ${state.masterSearchOpen?"open":""}" id="masterSearchReveal">
            <input id="masterSearch" type="search" value="${esc(state.masterSearch||"")}" placeholder="${mode==="PIANOS"?tr("Piano, serial, owner or service data…","Zongora, gyári szám, tulajdonos vagy szervizadat…"):mode==="DUPLICATES"?tr("Search duplicate candidates…","Keresés a duplikációjelöltek között…"):tr("Name, company, email, phone or address…","Név, cég, e-mail, telefon vagy cím…")}" aria-label="${tr("Search Master Data","Keresés a törzsadatokban")}">
          </div>
        </div>
        <div id="masterList" class="client-list master-list"></div>
      </section>
      <section id="clientDetail" class="panel client-detail master-detail"></section>
    </div>`;
  $("#addClientBtn").addEventListener("click",async()=>{if(await masterConfirmDiscard())openClientDialog();});
  $$("[data-master-tool]").forEach(button=>button.addEventListener("click",()=>void handleMasterTool(button.dataset.masterTool)));
  $("#masterSearch")?.addEventListener("input",event=>{state.masterSearch=event.currentTarget.value;state.masterSearchOpen=true;updateMasterToolbar();renderMasterList();});
  renderMasterList();await renderMasterDetail();
}
function updateMasterToolbar(){
  const searchActive=Boolean(state.masterSearchOpen||masterQuery()),reveal=$("#masterSearchReveal");reveal?.classList.toggle("open",searchActive);
  const active=state.masterMode==="PIANOS"?"PIANOS":state.masterMode==="DUPLICATES"?"DUPLICATES":state.clientMasterFilter||"ALL";
  $$("[data-master-tool]").forEach(button=>{const kind=button.dataset.masterTool;button.classList.toggle("active",kind==="SEARCH"?searchActive:(kind==="CLIENTS"?active==="ALL":kind===active));});
}
async function handleMasterTool(kind){
  if(kind!=="SEARCH"&&!(await masterConfirmDiscard()))return;
  if(kind==="SEARCH"){
    if(state.masterSearchOpen){
      if(masterQuery()){state.masterSearch="";const input=$("#masterSearch");if(input)input.value="";renderMasterList();void renderMasterDetail();}
      state.masterSearchOpen=false;
    }else state.masterSearchOpen=true;
    updateMasterToolbar();if(state.masterSearchOpen)requestAnimationFrame(()=>$("#masterSearch")?.focus());return;
  }
  state.masterSearchOpen=Boolean(masterQuery());
  if(kind==="PIANOS"){
    state.masterMode="PIANOS";state.masterDetailKind="PIANO";
    if(!filteredMasterPianos().some(piano=>Number(piano.id)===Number(state.selectedPianoId)))state.selectedPianoId=Number(filteredMasterPianos()[0]?.id||state.pianos[0]?.id||0)||null;
  }else if(kind==="DUPLICATES"){
    state.masterMode="DUPLICATES";state.masterDetailKind="DUPLICATE";
    if(!filteredDuplicateReviews().some(row=>Number(row.id)===Number(state.selectedDuplicateReviewId)))state.selectedDuplicateReviewId=Number(filteredDuplicateReviews()[0]?.id||0)||null;
  }else{
    state.masterMode="CLIENTS";state.clientMasterFilter=kind==="CLIENTS"?"ALL":kind;state.masterDetailKind="CLIENT";
    if(!filteredMasterClients().some(client=>Number(client.id)===Number(state.selectedClientId)))state.selectedClientId=Number(filteredMasterClients()[0]?.id||0)||null;
  }
  updateMasterToolbar();renderMasterList();void renderMasterDetail();
}
function masterQuery(){return String(state.masterSearch||"").trim().toLowerCase();}
function masterSearchNormalize(value){return String(value??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function masterSearchMatch(values,q){
  const haystack=masterSearchNormalize(values.filter(value=>value!==null&&value!==undefined).join(" ")),normalized=masterSearchNormalize(q);
  if(!normalized)return true;
  const tokens=normalized.split(/\s+/).filter(token=>token.length>1||/^\d+$/.test(token));
  return (tokens.length?tokens:[normalized]).every(token=>haystack.includes(token));
}
function masterClientSearchValues(client={}){
  return [client.name,client.first_name,client.last_name,client.company_name,client.contact_name,client.email,client.phone,client.mobile_phone,client.line_phone,client.address,client.street,client.city,client.district,client.postcode,client.country,client.notes,client.short_memo_to_name,client.last_visit,client.source_client_id,client.source_client_ids,client.source_row_numbers];
}
function masterPianoSearchValues(piano={}){
  return [piano.category,piano.brand,piano.model,piano.serial_number,piano.finish,piano.effective_location,piano.location_notes,piano.size_display,piano.color,piano.build_year,piano.notes,piano.date_of_purchase,piano.warranty,piano.last_serviced_at,piano.last_service_title,piano.last_service_description,piano.next_service_date,piano.latest_info_frequency,piano.latest_info_humidity,piano.latest_info_temperature,piano.source_instrument_id,piano.source_client_id,piano.source_row_number,piano.source_name];
}
function filteredMasterClients(){
  const filter=state.clientMasterFilter||"ALL",q=masterQuery();
  return (state.clients||[]).filter(client=>{
    const typeMatch=filter==="ALL"||(filter==="VIP"?Number(client.is_vip||0)===1:String(client.client_type||"INDIVIDUAL").toUpperCase()===filter);
    if(!typeMatch)return false;
    if(!q)return true;
    if(masterSearchMatch(masterClientSearchValues(client),q))return true;
    return (state.pianos||[]).some(piano=>Number(piano.client_id)===Number(client.id)&&masterSearchMatch(masterPianoSearchValues(piano),q));
  });
}
function filteredMasterPianos(){
  const q=masterQuery();
  return (state.pianos||[]).filter(piano=>{
    if(!q)return true;
    if(masterSearchMatch(masterPianoSearchValues(piano),q))return true;
    const owner=(state.clients||[]).find(client=>Number(client.id)===Number(piano.client_id));
    if(owner&&masterSearchMatch(masterClientSearchValues(owner),q))return true;
    return masterSearchMatch([piano.client_name,piano.client_first_name,piano.client_last_name,piano.client_company_name,piano.client_contact_name,piano.client_email,piano.client_phone,piano.client_mobile_phone,piano.client_line_phone,piano.client_address,piano.client_street,piano.client_city,piano.client_district,piano.client_postcode,piano.client_country,piano.client_notes,piano.client_short_memo],q);
  });
}
function filteredMasterPianoReviews(){
  const q=masterQuery();return (state.pianoReviews||[]).filter(item=>!q||[item.source_brand,item.source_model,item.source_serial_number,item.source_build_year,item.client_name,item.client_address,item.source_note].some(value=>String(value||"").toLowerCase().includes(q)));
}
function duplicateReviewSearchValues(row={}){
  const a=row.client_a||{},b=row.client_b||{};
  return [...masterClientSearchValues(a),...masterClientSearchValues(b),...(row.match_fields||[]),row.status,row.id];
}
function filteredDuplicateReviews(){
  const q=masterQuery();return (state.duplicateReviews||[]).filter(row=>!q||masterSearchMatch(duplicateReviewSearchValues(row),q));
}
function duplicateRelationshipTotal(client={}){
  return Object.values(client.relationship_counts||{}).reduce((sum,value)=>sum+Number(value||0),0);
}
function renderDuplicateReviewList(){
  const host=$("#masterList");if(!host)return;const rows=filteredDuplicateReviews();
  const summary=`<div class="duplicate-review-summary"><div><strong>${Number(state.duplicatePendingCount||0)}</strong><span>${tr("duplicate cases remaining","duplikációs eset van hátra")}</span></div><button class="secondary-button" type="button" id="duplicateRescan">${tr("Re-scan","Újraellenőrzés")}</button></div>`;
  host.innerHTML=summary+(rows.length?rows.map(row=>`<button class="duplicate-review-row ${Number(row.id)===Number(state.selectedDuplicateReviewId)?"active":""}" type="button" data-duplicate-review-id="${row.id}">
    <span class="duplicate-review-names"><strong>${esc(row.client_a?.name||("#"+row.client_a_id))}</strong><b>↔</b><strong>${esc(row.client_b?.name||("#"+row.client_b_id))}</strong></span>
    <small>${tr("Matching data","Egyező adatok")}: ${esc((row.match_fields||[]).map(duplicateFieldLabel).join(" · "))}</small>
    <span class="duplicate-review-meta"><span class="badge">${Number(row.match_count||0)} ${tr("matches","egyezés")}</span><span>${tr("Linked records","Kapcsolatok")}: ${duplicateRelationshipTotal(row.client_a)+duplicateRelationshipTotal(row.client_b)}</span>${row.status==="REVIEW_LATER"?`<span class="badge">${tr("Review later","Későbbre hagyva")}</span>`:""}</span>
  </button>`).join(""):`<div class="empty-state">${tr("No possible client duplicates remain.","Nincs több vélelmezett ügyfélduplikáció.")}</div>`);
  $("#duplicateRescan")?.addEventListener("click",async()=>{try{await api("/api/client-duplicates/rescan",{method:"POST",body:"{}"});toast(tr("Duplicate review queue refreshed.","A duplikációs ellenőrzőlista frissült."),"success");await renderMaster();}catch(error){toast(humanError(error),"error");}});
  $$("[data-duplicate-review-id]",host).forEach(button=>button.addEventListener("click",()=>{state.selectedDuplicateReviewId=Number(button.dataset.duplicateReviewId);renderDuplicateReviewList();void renderDuplicateReviewDetail();openMasterMobileDetail();}));
}
function duplicateFieldLabel(field){
  return ({name:tr("Name","Név"),email:"Email",phone:tr("Phone","Telefon"),address:tr("Address","Cím"),postcode:tr("Postcode","Irányítószám"),city:tr("City","Város"),company_name:tr("Company","Cég"),contact_name:tr("Contact","Kapcsolattartó")})[field]||field;
}
function duplicateClientValue(client,field){
  if(field==="phone")return client.phone||client.mobile_phone||client.line_phone||"";
  if(field==="address")return client.address||[client.street,client.city,client.district,client.postcode,client.country].filter(Boolean).join(", ");
  return client[field]||"";
}
function duplicateClientReviewCard(client,matchFields=[]){
  const fields=["name","company_name","contact_name","email","phone","address","postcode","city"];
  const counts=client.relationship_counts||{},sources=client.source_refs||[];
  return `<section class="duplicate-client-card"><div class="duplicate-client-head"><span class="eyebrow">${tr("CLIENT","ÜGYFÉL")} #${esc(client.id)}</span><h3>${esc(client.name||"—")}</h3><span class="badge">${esc(clientTypeLabel(client.client_type))}</span></div>
    <div class="duplicate-field-list">${fields.map(field=>{const value=duplicateClientValue(client,field),matched=matchFields.includes(field);return `<div class="${matched?"is-match":""}"><small>${esc(duplicateFieldLabel(field))}</small><strong>${esc(value||tr("Data pending","Adatpótlásra vár"))}</strong>${matched?`<span>✓ ${tr("match","egyezik")}</span>`:""}</div>`;}).join("")}</div>
    <div class="duplicate-relation-grid"><span><strong>${Number(counts.pianos||0)}</strong><small>${tr("Pianos","Zongorák")}</small></span><span><strong>${Number(counts.jobs||0)}</strong><small>Jobs</small></span><span><strong>${Number(counts.invoices||0)}</strong><small>${tr("Invoices","Számlák")}</small></span><span><strong>${Number(counts.intakes||0)}</strong><small>Intake</small></span><span><strong>${Number(counts.conversations||0)}</strong><small>Messenger</small></span><span><strong>${Number(counts.appointments||0)}</strong><small>${tr("Appointments","Időpontok")}</small></span></div>
    <div class="duplicate-source-refs"><small>${tr("Source references","Forráshivatkozások")}</small><strong>${sources.length?sources.map(row=>esc(row.source_name+" · "+row.source_client_id)).join("<br>"):tr("Legacy / no source reference","Legacy / nincs forráshivatkozás")}</strong></div>
  </section>`;
}
async function renderDuplicateReviewDetail(){
  const host=$("#clientDetail");if(!host)return;
  const row=(state.duplicateReviews||[]).find(item=>Number(item.id)===Number(state.selectedDuplicateReviewId));
  if(!row){host.innerHTML=`<div class="empty-state">${tr("Select a duplicate case.","Válassz duplikációs esetet.")}</div>`;return;}
  const a=row.client_a||{},b=row.client_b||{},matches=row.match_fields||[];
  host.innerHTML=`<button class="master-back-button" type="button" data-master-back>← ${tr("Back","Vissza")}</button>
    <div class="detail-title duplicate-detail-title"><div><span class="eyebrow">${tr("DUPLICATE REVIEW","DUPLIKÁCIÓ ELLENŐRZÉS")} #${row.id}</span><h2>${tr("Possible same customer","Lehetséges azonos ügyfél")}</h2><p>${tr("Nothing is deleted automatically. Choose the record to keep only after reviewing both sides.","Semmi nem törlődik automatikusan. Csak az összehasonlítás után válaszd ki a megtartandó rekordot.")}</p></div><span class="badge">${Number(row.match_count||0)} ${tr("matching fields","egyező adat")}</span></div>
    <div class="duplicate-match-strip">${matches.map(field=>`<span>✓ ${esc(duplicateFieldLabel(field))}</span>`).join("")}</div>
    <div class="duplicate-compare-grid">${duplicateClientReviewCard(a,matches)}${duplicateClientReviewCard(b,matches)}</div>
    <div class="duplicate-review-actions">
      <button class="primary-button" type="button" data-duplicate-merge-primary="${a.id}">${tr("Keep","Megtartás")} #${a.id} · ${esc(a.name||"")}</button>
      <button class="primary-button" type="button" data-duplicate-merge-primary="${b.id}">${tr("Keep","Megtartás")} #${b.id} · ${esc(b.name||"")}</button>
      <button class="secondary-button" type="button" id="duplicateNotSame">${tr("Not duplicate","Nem duplikáció")}</button>
      <button class="secondary-button" type="button" id="duplicateReviewLater">${tr("Review later","Később ellenőrzöm")}</button>
    </div>
    <div class="detail-note">${tr("When records are merged, every linked piano, job, intake, invoice, Messenger conversation, appointment and source reference is moved to the kept customer. The duplicate record is archived under Documents → Deleted clients and remains restorable.","Összevonáskor minden kapcsolt zongora, munka, igény, számla, Messenger-beszélgetés, időpont és forráshivatkozás átkerül a megtartott ügyfélhez. A duplikált rekord a Dokumentumok → Törölt ügyfelek közé kerül, és visszaállítható marad.")}</div>`;
  $("[data-master-back]",host)?.addEventListener("click",()=>closeMasterMobileDetail());
  $$("[data-duplicate-merge-primary]",host).forEach(button=>button.addEventListener("click",async()=>{
    const primaryId=Number(button.dataset.duplicateMergePrimary),primary=primaryId===Number(a.id)?a:b,duplicate=primaryId===Number(a.id)?b:a;
    if(!window.confirm(tr(`Keep ${primary.name||("#"+primaryId)} and archive ${duplicate.name||("#"+duplicate.id)} as a merged duplicate? All linked records will move to the kept customer.`,`${primary.name||("#"+primaryId)} maradjon meg, és ${duplicate.name||("#"+duplicate.id)} kerüljön archívumba összevont duplikációként? Minden kapcsolódó rekord átkerül a megtartott ügyfélhez.`)))return;
    try{await api(`/api/client-duplicates/${row.id}/merge`,{method:"POST",body:JSON.stringify({primary_client_id:primaryId})});toast(tr("Duplicate merged and archived.","A duplikáció összevonva és archiválva."),"success");state.selectedDuplicateReviewId=null;await renderMaster();}catch(error){toast(humanError(error),"error");}
  }));
  $("#duplicateNotSame")?.addEventListener("click",async()=>{try{await api(`/api/client-duplicates/${row.id}/not-duplicate`,{method:"POST",body:JSON.stringify({})});toast(tr("Marked as separate customers.","Külön ügyfélként megjelölve."),"success");state.selectedDuplicateReviewId=null;await renderMaster();}catch(error){toast(humanError(error),"error");}});
  $("#duplicateReviewLater")?.addEventListener("click",async()=>{try{await api(`/api/client-duplicates/${row.id}/later`,{method:"POST",body:JSON.stringify({})});toast(tr("Kept in the review queue.","Az eset az ellenőrzőlistán marad."),"success");await renderMaster();}catch(error){toast(humanError(error),"error");}});
}
function renderMasterList(){if(state.masterMode==="PIANOS")renderPianoList();else if(state.masterMode==="DUPLICATES")renderDuplicateReviewList();else renderClientList();}
function contactActionButton(client,kind){
  const isEmail=kind==="email",available=isEmail?Boolean(client.email):Boolean(client.phone),label=isEmail?tr("Email","E-mail"):kind==="message"?tr("Messages","Üzenetek"):tr("Phone","Telefon");
  const icon=isEmail?'<path d="M3 6h18v12H3z"></path><path d="m4 7 8 6 8-6"></path>':kind==="message"?'<path d="M4 5h16v11H9l-5 4V5Z"></path>':'<path d="M7 3h3l1.5 4-2 1.5a15 15 0 0 0 6 6L17 12.5l4 1.5v3c0 2-1 4-4 4C9 20 4 15 3 7c0-3 2-4 4-4Z"></path>';
  return `<button class="client-contact-action ${available?"":"is-unavailable"}" type="button" data-client-contact="${kind}" data-client-id="${client.id}" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`;
}
function renderClientList(){
  const host=$("#masterList");if(!host)return;const rows=filteredMasterClients();
  if(!rows.length){host.innerHTML=`<div class="empty-state">${tr("No clients match this view.","Nincs a nézetnek megfelelő ügyfél.")}</div>`;return;}
  host.innerHTML=rows.map(client=>`<article class="client-row ${Number(client.id)===Number(state.selectedClientId)&&state.masterDetailKind==="CLIENT"?"active":""}">
    <button type="button" class="client-row-select" data-client-id="${client.id}">
      <span><strong>${Number(client.is_vip||0)===1?'<span class="vip-client-star" title="VIP">★</span> ':""}${esc(masterValue(client.name))} ${masterReviewBadge(client)}</strong><small>${esc(clientTypeLabel(client.client_type))} · ${esc(masterValue(client.address))}</small><small>${tr("Last visit","Utolsó látogatás")}: ${esc(masterValue(client.last_visit))}</small></span>
      <span class="count">${Number(client.piano_count||0)}</span>
    </button>
    <div class="client-quick-actions" aria-label="${tr("Customer communication","Ügyfél kommunikáció")}">${contactActionButton(client,"email")}${contactActionButton(client,"message")}${contactActionButton(client,"phone")}</div>
  </article>`).join("");
  $$("[data-client-id]",host).forEach(button=>button.addEventListener("click",async()=>{if(!(await masterConfirmDiscard()))return;state.selectedClientId=Number(button.dataset.clientId);state.masterDetailKind="CLIENT";renderClientList();await renderClientDetail();openMasterMobileDetail();}));
  $$("[data-client-contact]",host).forEach(button=>button.addEventListener("click",()=>runClientContactAction(Number(button.dataset.clientId),button.dataset.clientContact)));
}
function runClientContactAction(clientId,kind){
  const client=state.clients.find(row=>Number(row.id)===Number(clientId));if(!client)return;
  if(kind==="email"){if(!client.email){toast(tr("No email address for this customer.","Az ügyfélhez nem tartozik e-mail-cím."),"error");return;}window.location.href=`mailto:${client.email}`;return;}
  if(!client.phone){toast(tr("No phone number for this customer.","Az ügyfélhez nem tartozik telefonszám."),"error");return;}
  const phone=String(client.phone).replace(/[^\d+]/g,"");window.location.href=kind==="message"?`sms:${phone}`:`tel:${phone}`;
}
function renderPianoList(){
  const host=$("#masterList");if(!host)return;
  const rows=filteredMasterPianos(),reviews=filteredMasterPianoReviews(),totals=state.pianoOverview||{},migration=state.masterMigration||{};
  const summary=`<div class="master-piano-summary">
    <span><strong>${Number(totals.total_entities??(state.pianos||[]).length)}</strong><small>${tr("visible instruments","látható hangszer")}</small></span>
    <span><strong>${Number(totals.owner_linked??(state.pianos||[]).filter(row=>row.client_id).length)}</strong><small>${tr("owner linked","tulajdonoshoz kapcsolva")}</small></span>
    <span class="${Number(totals.owner_pending||0)>0?"needs-review":""}"><strong>${Number(totals.owner_pending??(state.pianos||[]).filter(row=>!row.client_id).length)}</strong><small>${tr("owner data pending","tulajdonos adatpótlásra vár")}</small></span>
    ${Number(totals.review||0)>0?`<span class="needs-review"><strong>${Number(totals.review)}</strong><small>${tr("data conflicts","adatütközés")}</small></span>`:""}
    ${migration.ok?`<span><strong>${Number(migration.rows||0)}/339</strong><small>${tr("source contract verified","forráskontraktus ellenőrizve")}</small></span>`:`<span class="import-missing needs-review"><strong>${Number(migration.rows||0)}/339</strong><small>${migration.status==="INCOMPLETE"?tr("source import incomplete","forrásimport hiányos"):tr("master CSV awaiting import","a master CSV importra vár")}</small></span>`}
  </div>`;
  if(!rows.length&&!reviews.length){host.innerHTML=summary+`<div class="empty-state">${tr("No pianos match this view.","Nincs a nézetnek megfelelő zongora.")}</div>`;return;}
  const visible=rows.map(piano=>`<button type="button" class="piano-list-row ${Number(piano.id)===Number(state.selectedPianoId)?"active":""}" data-master-piano-id="${piano.id}">
    <strong>${esc([masterValue(piano.brand,{brand:true}),piano.model].filter(Boolean).join(" "))}</strong>
    <small>${tr("Size / color / year","Méret / szín / év")}: ${esc([masterValue(piano.size_display),masterValue(piano.color),masterValue(piano.build_year)].join(" · "))}</small>
    <small>${tr("Serial","Gyári szám")}: <span class="${masterPendingClass(piano.serial_number)}">${esc(masterValue(piano.serial_number))}</span>${piano.source_instrument_id?` · ${tr("Source ID","Forrás-ID")}: ${esc(piano.source_instrument_id)}`:""}</small>
    <small>${tr("Owner","Tulajdonos")}: <span class="${masterPendingClass(piano.client_name)}">${esc(masterValue(piano.client_name))}</span></small>
    <small>${tr("Last service","Utolsó szerviz")}: <span class="${masterPendingClass(piano.last_serviced_at)}">${esc(masterValue(piano.last_serviced_at))}</span>${piano.last_service_title?` · ${esc(piano.last_service_title)}`:""}</small>
    <small>${tr("Location","Hely")}: <span class="${masterPendingClass(piano.effective_location)}">${esc(masterValue(piano.effective_location))}</span></small>
  </button>`).join("");
  const conflicts=reviews.map(item=>`<button type="button" class="piano-list-row piano-review-row" data-master-review-id="${item.id}">
    <span class="piano-review-title"><b class="master-review-alert">!</b><strong>${esc([item.source_brand,item.source_model].filter(Boolean).join(" ")||"No brand")}</strong></span>
    <small>${tr("Data conflict needs review","Adatütközés ellenőrzésre vár")}</small>
    <small>${tr("Serial","Gyári szám")}: ${esc(masterValue(item.source_serial_number))}</small>
    <small>${tr("Owner","Tulajdonos")}: ${esc(masterValue(item.client_name))}</small>
  </button>`).join("");
  host.innerHTML=summary+visible+conflicts;
  $$("[data-master-piano-id]",host).forEach(button=>button.addEventListener("click",async()=>{if(!(await masterConfirmDiscard()))return;state.selectedPianoId=Number(button.dataset.masterPianoId);state.masterDetailKind="PIANO";renderPianoList();await renderPianoDetail();openMasterMobileDetail();}));
  $$("[data-master-review-id]",host).forEach(button=>button.addEventListener("click",async()=>{if(!(await masterConfirmDiscard()))return;const item=(state.pianoReviews||[]).find(row=>Number(row.id)===Number(button.dataset.masterReviewId));if(!item)return;openPianoDialog(null,null,item);}));
}
function openMasterMobileDetail(){$("#masterLayout")?.classList.add("detail-open");}
function closeMasterMobileDetail(){$("#masterLayout")?.classList.remove("detail-open");}
async function renderMasterDetail(){if(state.masterMode==="DUPLICATES"||state.masterDetailKind==="DUPLICATE")return renderDuplicateReviewDetail();if(state.masterDetailKind==="PIANO"||state.masterMode==="PIANOS")return renderPianoDetail();return renderClientDetail();}
async function renderClientDetail(){
  const host=$("#clientDetail");if(!host)return;
  const client=state.clients.find(row=>Number(row.id)===Number(state.selectedClientId));
  if(!client){host.innerHTML=`<div class="empty-state">${tr("Select a client.","Válassz ügyfelet.")}</div>`;return;}
  host.innerHTML=loading();
  const [pianos,jobs,reviews]=await Promise.all([api(`/api/clients/${client.id}/pianos`),api(`/api/clients/${client.id}/jobs`).catch(()=>[]),api(`/api/clients/${client.id}/piano-review`).catch(()=>[])]);
  const inline=masterInlineEditable(),canDeleteClient=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  const reviewMarkup=reviews.length?`<section class="master-review-panel"><div class="master-review-panel-head"><span class="master-review-alert">!</span><div><strong>${tr("Data conflict needs review","Adatütközés ellenőrzésre vár")}</strong><small>${tr("These records remain visible; the review only flags contradictory source data.","A rekordok továbbra is láthatók; az ellenőrzés csak az ellentmondó forrásadatot jelzi.")}</small></div></div>${reviews.map(item=>`<article class="master-review-item"><div><strong>${esc([item.source_brand,item.source_model].filter(Boolean).join(" ")||"No brand")}</strong><small>${esc([item.source_serial_number?tr("Serial","Gyári szám")+": "+item.source_serial_number:"",item.source_note].filter(Boolean).join(" · "))}</small></div><button class="secondary-button" type="button" data-classify-review="${item.id}">${tr("Review","Ellenőrzés")}</button></article>`).join("")}</section>`:"";
  const editable=`<form id="clientInlineForm" class="master-inline-form">${clientStructuredFields(client)}</form>`;
  const readonly=`<div class="piano-detail-grid master-client-detail-grid">
    ${masterReadonlyItem(tr("Display name","Megjelenített név"),client.name)}
    ${masterReadonlyItem(tr("First name","Keresztnév"),client.first_name)}
    ${masterReadonlyItem(tr("Last name","Vezetéknév"),client.last_name)}
    ${masterReadonlyItem(tr("Company name","Cégnév"),client.company_name)}
    ${masterReadonlyItem(tr("Contact name","Kapcsolattartó neve"),client.contact_name)}
    ${masterReadonlyItem("Email",client.email)}
    ${masterReadonlyItem(tr("Mobile phone","Mobiltelefon"),client.mobile_phone)}
    ${masterReadonlyItem(tr("Landline phone","Vezetékes telefon"),client.line_phone)}
    ${masterReadonlyItem(tr("Street","Utca, házszám"),client.street,{full:true})}
    ${masterReadonlyItem(tr("City","Város"),client.city)}
    ${masterReadonlyItem(tr("District / State","Kerület / állam"),client.district)}
    ${masterReadonlyItem(tr("Postcode","Irányítószám"),client.postcode)}
    ${masterReadonlyItem(tr("Country","Ország"),client.country)}
    ${masterReadonlyItem(tr("Notes","Megjegyzés"),client.notes,{full:true})}
    ${masterReadonlyItem(tr("Short memo to name","Rövid név-memó"),client.short_memo_to_name,{full:true})}
    ${masterReadonlyItem(tr("Last visit","Utolsó látogatás"),client.last_visit)}
  </div>`;
  host.innerHTML=`<button class="master-back-button" type="button" data-master-back>← ${tr("Back","Vissza")}</button>
    <div class="detail-title"><div><span class="eyebrow">${tr("CLIENT","ÜGYFÉL")} #${client.id}</span><h2>${Number(client.is_vip||0)===1?'<span class="vip-client-star" title="VIP">★</span> ':""}${esc(masterValue(client.name))} ${masterReviewBadge(client)}</h2></div><div class="page-actions">${inline?`<button id="saveClientBtn" class="primary-button" type="button">${tr("Save","Mentés")}</button>`:`<button id="editClientBtn" class="secondary-button" type="button">${tr("Edit","Szerkesztés")}</button>`}<button id="addPianoBtn" class="secondary-button" type="button">＋ ${tr("Piano","Zongora")}</button>${canDeleteClient?`<button id="deleteClientBtn" class="danger-button" type="button">${tr("Delete client","Ügyfél törlése")}</button>`:""}</div></div>
    ${inline?editable:readonly}
    ${client.address?`<button class="secondary-button master-address-route" type="button" data-open-map>↗ ${tr("Open route","Útvonal megnyitása")} · ${esc(client.address)}</button>`:""}
    ${reviewMarkup}
    <div class="panel-head inline-panel-head"><h3>${tr("Pianos","Zongorák")}</h3><span class="badge">${pianos.length}</span></div>
    <div class="piano-grid">${pianos.length?pianos.map(piano=>pianoCard(piano)).join(""):`<div class="empty-state">${tr("No piano is linked to this client yet.","Ehhez az ügyfélhez még nincs zongora kapcsolva.")}</div>`}</div>
    <div class="panel-head inline-panel-head"><h3>${tr("Service history","Szerviztörténet")}</h3><span class="badge">${jobs.length}</span></div>
    <div class="service-history-list">${jobs.length?jobs.map(job=>`<article class="history-row"><div><strong>${esc(job.job_code||job.title)}</strong><small>${esc(job.title)} · ${esc(job.piano_brand||"")} ${esc(job.piano_model||"")}</small></div><span class="badge">${job.cancelled_at?tr("Cancelled","Megszakítva"):job.stage==="completed"?tr("Completed","Lezárva"):esc(job.stage)}</span>${job.completed_by_name?`<small>${tr("Closed by","Lezárta")}: ${esc(job.completed_by_name)}</small>`:""}</article>`).join(""):`<div class="empty-state">${tr("No service history yet.","Még nincs szerviztörténet.")}</div>`}</div>`;
  $("[data-master-back]")?.addEventListener("click",async()=>{if(await masterConfirmDiscard())closeMasterMobileDetail();});
  $("#editClientBtn")?.addEventListener("click",()=>openClientDialog(client));
  $("#addPianoBtn")?.addEventListener("click",async()=>{if(await masterConfirmDiscard())openPianoDialog(client);});
  $("#deleteClientBtn")?.addEventListener("click",async()=>{
    if(!(await masterConfirmDiscard()))return;
    const confirmed=window.confirm(tr(
      `Permanently remove ${client.name} from active Master Data? The full client snapshot will be stored under Documents → Deleted clients.`,
      `Véglegesen törlöd ${client.name} ügyfelet az aktív törzsadatokból? A teljes ügyfél-snapshot a Dokumentumok → Törölt ügyfelek közé kerül.`
    ));
    if(!confirmed)return;
    try{
      await api(`/api/clients/${client.id}`,{method:"DELETE",body:JSON.stringify({})});
      state.selectedClientId=null;state.masterDetailKind="CLIENT";state.archiveCategory="deleted_client";closeMasterMobileDetail();
      toast(tr("Client deleted and archived.","Az ügyfél törölve és archiválva."),"success");await renderMaster();
    }catch(error){toast(humanError(error),"error");}
  });
  $$("[data-open-map]",host).forEach(button=>button.addEventListener("click",()=>openMasterMap(inline?masterClientFormAddress($("#clientInlineForm")):client.address)));
  $$("[data-classify-review]",host).forEach(button=>button.addEventListener("click",async()=>{const item=reviews.find(row=>Number(row.id)===Number(button.dataset.classifyReview));if(await masterConfirmDiscard())openPianoDialog(client,null,item);}));
  $$("[data-piano-card]",host).forEach(button=>button.addEventListener("click",async()=>{if(!(await masterConfirmDiscard()))return;state.selectedPianoId=Number(button.dataset.pianoCard);state.masterDetailKind="PIANO";await renderPianoDetail();openMasterMobileDetail();}));
  const form=$("#clientInlineForm");
  if(form){form.addEventListener("input",()=>setMasterDirty(true));form.addEventListener("change",()=>setMasterDirty(true));$("#saveClientBtn")?.addEventListener("click",()=>void masterSaveCurrentInlineForm({renderAfter:true}));form.addEventListener("submit",event=>{event.preventDefault();void masterSaveCurrentInlineForm({renderAfter:true});});}
}
function pianoCard(piano){
  return `<button class="piano-card" type="button" data-piano-card="${piano.id}"><h3>${esc([masterValue(piano.brand,{brand:true}),piano.model].filter(Boolean).join(" "))}</h3><dl>
    <dt>${tr("Category","Kategória")}</dt><dd class="${masterPendingClass(piano.category)}">${esc(masterValue(piano.category))}</dd>
    <dt>${tr("Serial","Gyári szám")}</dt><dd class="${masterPendingClass(piano.serial_number)}">${esc(masterValue(piano.serial_number))}</dd>
    <dt>${tr("Color","Szín")}</dt><dd class="${masterPendingClass(piano.color)}">${esc(masterValue(piano.color))}</dd>
    <dt>${tr("Owner","Tulajdonos")}</dt><dd class="${masterPendingClass(piano.client_name)}">${esc(masterValue(piano.client_name))}</dd>
  </dl><div class="service-history"><strong>${tr("Last service","Utolsó szerviz")}</strong><br><span class="${masterPendingClass(piano.last_serviced_at)}">${esc(masterValue(piano.last_serviced_at))}</span>${piano.last_service_title?` · ${esc(piano.last_service_title)}`:""}</div></button>`;
}
async function renderPianoDetail(){
  const host=$("#clientDetail");if(!host)return;
  const piano=state.pianos.find(row=>Number(row.id)===Number(state.selectedPianoId));
  if(!piano){host.innerHTML=`<div class="empty-state">${tr("Select a piano.","Válassz zongorát.")}</div>`;return;}
  const client=state.clients.find(row=>Number(row.id)===Number(piano.client_id)),effective=piano.location_notes||client?.address||piano.client_address||"",inline=masterInlineEditable();
  const editable=`<form id="pianoInlineForm" class="master-inline-form piano-inline-form">${pianoStructuredFields(piano,piano.client_id)}</form>`;
  const readonly=`<div class="piano-detail-grid">
    ${masterReadonlyItem(tr("Owner","Tulajdonos"),client?.name||piano.client_name)}
    ${masterReadonlyItem(tr("Category","Kategória"),piano.category)}
    ${masterReadonlyItem(tr("Brand","Márka"),piano.brand,{brand:true})}
    ${masterReadonlyItem(tr("Model","Modell"),piano.model)}
    ${masterReadonlyItem(tr("Size","Méret"),piano.size_display)}
    ${masterReadonlyItem(tr("Color","Szín"),piano.color)}
    ${masterReadonlyItem(tr("Serial number","Gyári szám"),piano.serial_number)}
    ${masterReadonlyItem(tr("Year built","Gyártási év"),piano.build_year)}
    ${masterReadonlyItem(tr("Finish","Kivitel"),piano.finish)}
    ${masterReadonlyItem(tr("Date of purchase","Vásárlás dátuma"),piano.date_of_purchase)}
    ${masterReadonlyItem(tr("Warranty","Garancia"),piano.warranty)}
    ${masterReadonlyItem(tr("Last service date","Utolsó szerviz dátuma"),piano.last_serviced_at)}
    ${masterReadonlyItem(tr("Last service title","Utolsó szerviz címe"),piano.last_service_title)}
    ${masterReadonlyItem(tr("Last service description","Utolsó szerviz leírása"),piano.last_service_description,{full:true})}
    ${masterReadonlyItem(tr("Next service date","Következő szerviz dátuma"),piano.next_service_date)}
    ${masterReadonlyItem(tr("Frequency","Frekvencia"),piano.latest_info_frequency)}
    ${masterReadonlyItem(tr("Humidity","Páratartalom"),piano.latest_info_humidity)}
    ${masterReadonlyItem(tr("Temperature","Hőmérséklet"),piano.latest_info_temperature)}
    ${masterReadonlyItem(tr("Location","Hely"),effective,{full:true,extra:`<small>${piano.location_notes?tr("Piano-specific location","Zongorához megadott külön hely"):client?.address?tr("Inherited from customer address","Az ügyfél címéből örökölve"):masterPendingText()}</small>`})}
    ${masterReadonlyItem(tr("Instrument note","Hangszer-megjegyzés"),piano.notes,{full:true})}
  </div>`;
  host.innerHTML=`<button class="master-back-button" type="button" data-master-back>← ${tr("Back","Vissza")}</button>
    <div class="detail-title"><div><span class="eyebrow">${tr("PIANO","ZONGORA")} #${piano.id}</span><h2>${esc([masterValue(piano.brand,{brand:true}),piano.model].filter(Boolean).join(" "))}</h2></div><div class="page-actions">${inline?`<button id="savePianoBtn" class="primary-button" type="button">${tr("Save","Mentés")}</button>`:`<button id="editPianoBtn" class="primary-button" type="button">${tr("Edit piano","Zongora szerkesztése")}</button>`}</div></div>
    ${inline?editable:readonly}
`;
  $("[data-master-back]")?.addEventListener("click",async()=>{if(!(await masterConfirmDiscard()))return;if(state.masterMode==="CLIENTS"){state.masterDetailKind="CLIENT";void renderClientDetail();}else closeMasterMobileDetail();});
  $("#editPianoBtn")?.addEventListener("click",()=>openPianoDialog(client,piano));
  const form=$("#pianoInlineForm");
  if(form){form.addEventListener("input",()=>setMasterDirty(true));form.addEventListener("change",()=>setMasterDirty(true));$("#savePianoBtn")?.addEventListener("click",()=>void masterSaveCurrentInlineForm({renderAfter:true}));form.addEventListener("submit",event=>{event.preventDefault();void masterSaveCurrentInlineForm({renderAfter:true});});}
}
function clientForm(client={}){
  return `<form id="clientEditor" class="form-grid">${clientStructuredFields(client)}<div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button type="submit" class="primary-button">${tr("Save","Mentés")}</button></div></form>`;
}
function openClientDialog(client=null){
  openDialog({title:client?tr("Edit client","Ügyfél szerkesztése"):tr("New client","Új ügyfél"),eyebrow:tr("MASTER DATA","TÖRZSADATOK"),body:clientForm(client||{})});
  $("#clientEditor").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.is_vip=Boolean(event.currentTarget.elements.is_vip?.checked);
    try{const saved=await api(client?`/api/clients/${client.id}`:"/api/clients",{method:client?"PUT":"POST",body:JSON.stringify(body)});state.selectedClientId=Number(saved.id);state.masterMode="CLIENTS";state.masterDetailKind="CLIENT";closeDialog();toast(tr("Client saved.","Ügyfél mentve."),"success");await renderMaster();}
    catch(error){toast(humanError(error),"error");}
  });
}
function openPianoDialog(client=null,piano=null,review=null){
  const reviewSeed=review?{review_id:review.id,client_id:review.client_id||null,brand:review.source_brand||"No brand",model:review.source_model||"",serial_number:review.source_serial_number||"",build_year:review.source_build_year||"",notes:review.source_note||""}:{};
  const seed={...reviewSeed,...(piano||{})},selectedOwnerId=piano?.client_id??client?.id??review?.client_id??null;
  openDialog({title:piano?tr("Edit piano","Zongora szerkesztése"):review?tr("Review piano data","Zongoraadat ellenőrzése"):tr("New piano","Új zongora"),eyebrow:client?.name||tr("MASTER DATA","TÖRZSADATOK"),body:`<form id="pianoEditor" class="form-grid">${pianoStructuredFields(seed,selectedOwnerId,{includeReview:true})}<div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save piano","Zongora mentése")}</button></div></form>`});
  $("#pianoEditor").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.client_id=body.client_id?Number(body.client_id):null;if(body.build_year==="")body.build_year=null;if(body.review_id)body.review_id=Number(body.review_id);
    try{
      const saved=await api(piano?`/api/pianos/${piano.id}`:"/api/pianos",{method:piano?"PUT":"POST",body:JSON.stringify(body)});
      state.selectedPianoId=Number(saved.id);state.masterDetailKind="PIANO";closeDialog();toast(piano?tr("Piano updated.","Zongora frissítve."):tr("Piano saved.","Zongora mentve."),"success");await renderMaster();openMasterMobileDetail();
    }catch(error){toast(humanError(error),"error");}
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
  $$("[data-edit-user]").forEach(button=>button.addEventListener("click",()=>void openUserDialog(users.find(user=>String(user.id)===button.dataset.editUser))));
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
  applyServiceStatus(readServiceBootstrap()||{});applyChromeLanguage();startNewYorkClock();await loadBranding();bindNavigation();
  if(!state.token){showLogin();return;}
  try{
    state.user=await api("/api/me");
    if(state.serviceSuspended&&(state.user?.role==="SUPERADMIN"||Number(state.user?.is_superadmin||0)===1)){state.view="profile";history.replaceState({},"","#profile");}
    showApp();if(!activeViews.has(state.view))state.view="workshop";await renderView();
  }catch(_error){clearSession();showLogin();}
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/service-worker.js").catch(()=>{}),{once:true});
}
// Final compliance extensions invoke boot() after workflow and finance functions are registered.
