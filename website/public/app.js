
let token=localStorage.getItem("kh_token");
let user=JSON.parse(localStorage.getItem("kh_user")||"null");
let pendingAccountActivation=null;
let currentWeekStart=startOfWeek(new Date());
let currentView="scheduler";
let currentLang="en";
let currentTheme="dark";
let currentSchedulerWorker=null;
let currentClientStatusFilter="ALL";
let currentClientPage=1;
let currentClientSearch="";
let showOnlyMissingClientData=false;
const CLIENTS_PER_PAGE=25;
let currentPianoPage=1;
const PIANOS_PER_PAGE=25;
let currentPianoSearch="";
let currentPianoOwnershipFilter="ALL";
let currentPianoMinValue="";
let currentPianoMaxValue="";
let mobileClientFiltersOpen=false;
let mobilePianoFiltersOpen=false;
let mobileFinanceFiltersOpen=false;
let pianoOwnerContactsCache=[];
let schedulerWorkersCache=null;
let userPermissions={all:false,permissions:[]};
let notificationPollTimer=null;
let notificationUnreadCount=0;
let notificationGateResolved=false;
let notificationGateBusy=false;
let currentNotifications=[];
let currentTimeLineInterval=null;
let calendarAutoRefreshBusy=false;
let jobDetailsRequestSequence=0;
let contactsRenderTimer=null;
let pianosRenderTimer=null;
const apiResponseCache=new Map();
const CACHEABLE_MASTER_ENDPOINTS=new Set(["/api/contacts","/api/pianos","/api/schedule-workers"]);

const navs={
 SUPERADMIN:[["scheduler","Scheduler / Naptár"],["planned_jobs","Planned Jobs / Tervezett munkák"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["inventory","Inventory / Leltár"],["users","Users / Felhasználók"],["audit_log","Audit Log / Módosítási napló"],["settings","Settings / Beállítások"]],
 ADMIN:[["scheduler","Scheduler / Naptár"],["planned_jobs","Planned Jobs / Tervezett munkák"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["inventory","Inventory / Leltár"],["users","Users / Felhasználók"],["audit_log","Audit Log / Módosítási napló"],["settings","Settings / Beállítások"]],
 MANAGER:[["scheduler","Scheduler / Naptár"],["planned_jobs","Planned Jobs / Tervezett munkák"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["inventory","Inventory / Leltár"],["users","Users / Felhasználók"]],
 WORKER:[["scheduler","Scheduler / Naptár"],["planned_jobs","Planned Jobs / Tervezett munkák"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["inventory","Inventory / Leltár"],["users","Users / Felhasználók"]]
};

const schemas={
contacts:{api:"contacts",title:"Clients / Ügyfelek",fields:[["name","Client name / Ügyfél neve *"],["company","Company / Cég"],["type","Type / Típus"],["email","Email"],["phone","Phone / Telefonszám"],["address","Address / Cím"],["billing_address","Billing address / Számlázási cím"],["has_piano","Has piano? / Van zongorája?","select",[["0","No / Nem"],["1","Yes / Igen"]]],["interested_buying","Interested in buying? / Vásárlási érdeklődő?","select",[["0","No / Nem"],["1","Yes / Igen"]]],["interest_brand","Interested brand / Érdeklődött márka"],["interest_model","Interested model / Érdeklődött modell"],["interest_budget","Budget / Keretösszeg","number"],["interest_timeline","Timeline / Várható vásárlási idő"],["interest_notes","Purchase interest notes / Vásárlási érdeklődés megjegyzés","textarea"],["owner","Relationship owner / Kapcsolattartó gazda"],["last_contact","Last contact / Utolsó kapcsolat","date"],["next_step","Next step / Következő lépés"],["notes","Notes / Megjegyzés","textarea"]],cols:["customer_status_icon","name","phone","email","address","last_contact","next_step"]},
pianos:{api:"pianos",title:"Pianos / Zongorák",fields:[["display_name","Piano name / description / Zongora neve / leírás"],["brand","Brand / Márka"],["model","Model / Típus / modell"],["serial_no","Serial No. / Gyári szám"],["year","Year / Év","number"],["ownership_type","Ownership / Tulajdon","select",["Customer owned","Company owned","Consignment","Rental","Unknown"]],["owner_contact_id","Owner client / Tulajdonos ügyfél"],["location","Location / Helyszín"],["estimated_value","Estimated value / Becsült érték","number"],["notes","Notes / Megjegyzés","textarea"]],cols:["display_name","serial_no","location","ownership_type","estimated_value"]},
knowledge_base:{api:"knowledge_base",title:"Invoices / Számlák",fields:[["title","Title / Cím"],["category","Category / Kategória"],["content_type","Content type / Tartalomtípus"],["body","Body / Tartalom","textarea"],["stored_path","Attachment path / Melléklet útvonal"],["owner","Relationship owner / Kapcsolattartó gazda"],["amount","Amount / Összeg","number"],["payment_method","Payment method / Fizetési mód"],["invoice_number","Invoice number / Számlaszám"],],cols:["id","title","category","owner","amount","payment_method","invoice_number","stored_path","created_at"]}
};

const inventoryMainCategories=[
 "Piano / Zongora","Upright Piano / Pianínó","Piano Part / Zongoraalkatrész","Tool / Munkaeszköz","Machine / Gép","Equipment / Berendezés","Material / Anyag","Accessory / Tartozék","Office Asset / Irodai eszköz","Other / Egyéb"
];
const pianoPartCategories=[
 "Keyboard / Billentyűzet","Keys / Billentyűk","Action Mechanism / Mechanika","Hammer / Kalapács","Hammer Felt / Kalapácsfilc","Damper / Tompító","Damper Felt / Tompítófilc","Strings / Húrok","Bass Strings / Basszushúrok","Treble Strings / Magas húrok","Soundboard / Rezonánslap","Bridge / Híd","Pinblock / Hangolótőke","Tuning Pins / Hangolószegek","Agraffes / Agraffok","Cast Iron Frame / Öntöttvas keret","Pedals / Pedálok","Sustain Pedal / Jobb pedál","Soft Pedal / Bal pedál","Sostenuto Pedal / Középső pedál","Cabinet / Bútorzat","Lid / Fedél","Music Desk / Kottatartó","Legs / Lábak","Casters / Görgők","Bench / Zongoraszék","Other Piano Part / Egyéb zongoraalkatrész"
];
const acquisitionTypes=["Purchased / Vásárolt","Manufactured / Gyártott","Donated / Adomány","Transferred / Átvett","Existing stock / Meglévő készlet","Other / Egyéb"];
const inventoryConditions=["New / Új","Used / Használt","Needs Repair / Javítandó","Under Repair / Javítás alatt","Refurbished / Felújított","Broken / Hibás","Scrap / Selejt"];
const inventoryStatuses=["In Stock / Készleten","In Use / Használatban","Reserved / Lefoglalva","Installed / Beépítve","Sold / Eladva","Disposed / Selejtezve","Lost / Elveszett"];

const plannedJobTypes=["Blocked existing / Meglévő, de megakadt","Planned new / Tervezett, még nem lefixált"];
const plannedJobStatuses=["Blocked / Elakadt","Waiting for client / Ügyfélre vár","Waiting for parts / Alkatrészre vár","Need quote / Árajánlat szükséges","Ready to schedule / Időzíthető","Converted / Naptárba helyezve","Archived / Archivált","Cancelled / Törölve"];
const plannedJobProbabilities=["100% - Biztos","75% - Nagyon valószínű","50% - Közepes","25% - Bizonytalan"];


const staticTranslations={
 en:{
   appTitle:"Klavierhaus Work Management",loginSubtitle:"Calendar-first job management",email:"Email",password:"Password",login:"Login",logout:"Logout",deleteEverything:"Delete Everything",operations:"New York time based operations",logoutIn:"Logout in",securityLogout:"Security logout: you have been signed out after 10 minutes without clicking.",activationTitle:"Verify your account",activationDescription:"Enter the six-digit code sent to your contact email.",activationCode:"Activation code",activationVerify:"Verify and continue",activationResend:"Send a new code",activationBack:"Back to login",activationRecipient:"Code sent to",
   scheduler:"Scheduler",planned_jobs:"Planned Jobs",contacts:"Clients",pianos:"Pianos",closed_jobs:"Closed Jobs",knowledge_base:"Invoices",finance:"Finance",income_statement:"Income Statement",inventory:"Inventory",users:"Users", audit_log:"Audit Log", settings:"Settings", today:"Today", more:"More", newJob:"New Job", calendar:"Calendar", all:"All", workerFilter:"Worker", failed:"Failed", noClosedJobs:"No closed jobs yet", actions:"Actions", searchClients:"Search clients by name, address, or piano", searchPlaceholder:"Type at least 3 characters...", themeDark:"Dark", themeLight:"Light", myProfile:"My profile", phone:"Phone", address:"Address", newPassword:"New password", leaveEmpty:"Leave empty to keep current", saveChanges:"Save changes", createUser:"Create user", editUser:"Edit user", addUser:"Add user", customerStatus:"Status", ownerClient:"Owner", buyerLead:"Buyer lead", ownerBuyerLead:"Owner + buyer lead", generalContact:"General"
 },
 hu:{
   appTitle:"Klavierhaus munkakezelő rendszer",loginSubtitle:"Naptárközpontú munkakezelés",email:"Email",password:"Jelszó",login:"Belépés",logout:"Kilépés",deleteEverything:"Mindent töröl",operations:"New York-i időzóna szerinti működés",logoutIn:"Automatikus kilépés",securityLogout:"Biztonsági kijelentkezés: 10 perc kattintás nélküli inaktivitás miatt kijelentkeztettünk.",activationTitle:"Fiók ellenőrzése",activationDescription:"Add meg a kapcsolattartási e-mail-címedre küldött hatjegyű kódot.",activationCode:"Aktiválókód",activationVerify:"Ellenőrzés és belépés",activationResend:"Új kód küldése",activationBack:"Vissza a belépéshez",activationRecipient:"A kód címzettje",
   scheduler:"Naptár",planned_jobs:"Tervezett munkák",contacts:"Ügyfelek",pianos:"Zongorák",closed_jobs:"Lezárt munkák",knowledge_base:"Számlák",finance:"Pénzügy",income_statement:"Eredménykimutatás",inventory:"Leltár",users:"Felhasználók", audit_log:"Módosítási napló", settings:"Beállítások", today:"Ma", more:"Továbbiak", newJob:"Új munka", calendar:"Naptár", all:"Minden", workerFilter:"Munkatárs", failed:"Sikertelen", noClosedJobs:"Még nincs lezárt munka", actions:"Műveletek", searchClients:"Ügyfelek keresése név, cím vagy zongora alapján", searchPlaceholder:"Írj be legalább 3 karaktert...", themeDark:"Sötét", themeLight:"Világos", myProfile:"Adataim", phone:"Telefonszám", address:"Lakcím", newPassword:"Új jelszó", leaveEmpty:"Hagyd üresen, ha marad", saveChanges:"Módosítás mentése", createUser:"Felhasználó létrehozása", editUser:"Felhasználó szerkesztése", addUser:"Felhasználó hozzáadása", customerStatus:"Státusz", ownerClient:"Birtokló", buyerLead:"Érdeklődő", ownerBuyerLead:"Birtokló + érdeklődő", generalContact:"Általános"
 }
};
let branding={company_name:'Klavierhaus',short_name:'KH ERP',logo_url:'/icons/icon-512.png',login_background_url:'',branding_version:'1'};
let currentAuditType='WORK';
let viewHistory=[];
function userLangKey(){return user?.id ? `kh_lang_${user.id}` : "kh_lang_guest";}
function loadLanguage(){currentLang=localStorage.getItem(userLangKey())||"en"; if(!["en","hu"].includes(currentLang)) currentLang="en";}
function setLanguage(lang){
  currentLang=lang==="hu"?"hu":"en";
  localStorage.setItem(userLangKey(),currentLang);
  updateLanguageButtons();
  renderNavigation();
  updateStaticChromeLanguage();
  updateMobileNavigationLanguage();
  if(token && currentView) render(currentView); else applyLanguageToDOM(document.getElementById("login"));
}
function tr(key){return (staticTranslations[currentLang]&&staticTranslations[currentLang][key])||staticTranslations.en[key]||key;}
function navLabel(view){return tr(view)||view;}
function renderNavigation(){
  if(!token || !user || !document.getElementById("nav")) return;
  const nav=(navs[user.role]||navs.WORKER).filter(n=>(n[0]==="settings" ? isAdmin() : n[0]==="audit_log" ? (isAdmin()||userPermissions.all||userPermissions.permissions.includes("audit.view")) : (userPermissions.all || userPermissions.permissions.includes(`${n[0]}.view`))));
  const navEl=document.getElementById("nav");
  navEl.innerHTML=nav.map(n=>`<button class="nav-btn ${n[0]===currentView?"active":""}" data-v="${n[0]}">${navLabel(n[0])}</button>`).join("");
}
function updateStaticChromeLanguage(){
  const logout=document.getElementById("logoutBtn"); if(logout) logout.textContent=tr("logout");
  const del=document.getElementById("deleteEverythingBtn"); if(del) del.textContent=tr("deleteEverything");
  const subtitle=document.getElementById("headerSubtitle"); if(subtitle) subtitle.textContent=tr("operations");
  const title=document.getElementById("pageTitle"); if(title && currentView) title.textContent=navLabel(currentView);
  document.documentElement.lang=currentLang==="hu"?"hu":"en";
  updateLoginPasswordToggle();
  updateActivationLanguage();
  updateCountdownDisplay();
}
function splitBilingualText(text){
  if(!text || !text.includes(" / ")) return text;
  if(/\bD\s*\$?\d/i.test(text) || /\bC\s*\$?\d/i.test(text)) return text;
  const parts=text.split(" / ");
  if(parts.length<2) return text;
  return currentLang==="hu" ? parts.slice(1).join(" / ").trim() : parts[0].trim();
}
function looksLikeBilingualUiText(text){
 if(!text||!text.includes(" / "))return false;
 const hu=text.split(" / ").slice(1).join(" / ").trim();
 return /[áéíóöőúüű]/i.test(hu)||/^(?:Nem|Igen|Magyar|Bank|Modell|Export|Admin|Manager|Worker|ID|USD|Telefon|Hely|Zongora|Mechanika|Agraffok|Elakadt|Tartalom|Hitelek|Elveszett|Anyag|Havi|Egyszeri|Tulajdon|Lefoglalva|Selejt|Eladva|Rezsi|Munka|Mentett)(?:\b|\s|$)/i.test(hu);
}
function currentLanguageRoot(){
  if(!token)return document.getElementById("login");
  return document.getElementById(currentView)||document.getElementById("app");
}
function applyLanguageToDOM(root=currentLanguageRoot()){
  if(!root) return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
    if(!node.nodeValue || !looksLikeBilingualUiText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
    const p=node.parentElement;
    if(!p || ["SCRIPT","STYLE","TEXTAREA"].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
    if(p.closest("[data-i18n-exempt]")) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }});
  const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n=>{n.nodeValue=splitBilingualText(n.nodeValue)});
  root.querySelectorAll?.("input[placeholder],textarea[placeholder],[title],[aria-label]").forEach(el=>{
    if(el.placeholder) el.placeholder=splitBilingualText(el.placeholder);
    if(el.title) el.title=splitBilingualText(el.title);
    if(el.getAttribute("aria-label"))el.setAttribute("aria-label",splitBilingualText(el.getAttribute("aria-label")));
  });
  const loginBrandName=document.querySelector(".login-card [data-brand-name]");
  if(loginBrandName) loginBrandName.textContent=branding.company_name||"Klavierhaus";
  const sub=document.querySelector(".login-card p"); if(sub) sub.textContent=tr("loginSubtitle");
  const passLabel=document.querySelector('label[for="password"], #loginForm label:nth-of-type(2)'); if(passLabel) passLabel.textContent=tr("password");
  const loginBtn=document.querySelector('#loginForm button[type="submit"]'); if(loginBtn) loginBtn.textContent=tr("login");
  updateActivationLanguage();
  const subtitle=document.getElementById("headerSubtitle"); if(subtitle) subtitle.textContent=tr("operations");
  const logoutBtn=document.getElementById("logoutBtn"); if(logoutBtn) logoutBtn.textContent=tr("logout");
  const delBtn=document.getElementById("deleteEverythingBtn"); if(delBtn) delBtn.textContent=tr("deleteEverything");
  updateLanguageButtons();
  updateThemeButtons();
  const themeDark=document.getElementById("themeDarkBtn"); if(themeDark) themeDark.title=tr("themeDark");
  const themeLight=document.getElementById("themeLightBtn"); if(themeLight) themeLight.title=tr("themeLight");
  updateCountdownDisplay();
  syncAllCustomSelects();
}
function updateLanguageButtons(){
  const en=document.getElementById("langEnBtn"), hu=document.getElementById("langHuBtn");
  if(en) en.classList.toggle("active",currentLang==="en");
  if(hu) hu.classList.toggle("active",currentLang==="hu");
}

function userThemeKey(){return user?.id ? `kh_theme_${user.id}` : "kh_theme_guest";}
function loadTheme(){currentTheme=localStorage.getItem(userThemeKey())||"dark"; if(!["dark","light"].includes(currentTheme)) currentTheme="dark"; applyTheme();}
function setTheme(theme){currentTheme=theme==="light"?"light":"dark"; localStorage.setItem(userThemeKey(),currentTheme); applyTheme();}
function applyTheme(){document.documentElement.setAttribute("data-theme",currentTheme); updateThemeButtons();}
function updateThemeButtons(){
  const dark=document.getElementById("themeDarkBtn"), light=document.getElementById("themeLightBtn");
  if(dark) dark.classList.toggle("active",currentTheme==="dark");
  if(light) light.classList.toggle("active",currentTheme==="light");
}

async function loadBranding(){
 try{branding=await fetch('/api/public/branding',{cache:'no-store'}).then(r=>r.json());}catch(e){}
 applyBranding();
}
function versionedBrandAsset(url){
 const base=url||''; if(!base)return '';
 return `${base}${base.includes('?')?'&':'?'}v=${encodeURIComponent(branding.branding_version||Date.now())}`;
}
function applyBranding(){
 const logo=versionedBrandAsset(branding.logo_url||'/icons/icon-512.png');
 document.querySelectorAll('[data-brand-name]').forEach(el=>el.textContent=branding.company_name||'Klavierhaus');
 document.querySelectorAll('[data-brand-logo]').forEach(el=>{
  if(el.tagName==='IMG'){
   if(el.src!==new URL(logo,location.href).href) el.src=logo;
   return;
  }
  let img=el.querySelector('img');
  if(!img){img=document.createElement('img');img.alt='';el.replaceChildren(img);}
  if(img.src!==new URL(logo,location.href).href) img.src=logo;
 });
 const login=document.querySelector('.login-page');
 if(login){const bg=versionedBrandAsset(branding.login_background_url||'');login.style.setProperty('--login-background',bg?`url("${bg}")`:'none');login.classList.toggle('has-brand-background',!!bg);}
 document.title=(branding.company_name||'Klavierhaus')+' Work Management';
 const apple=document.querySelector('meta[name="apple-mobile-web-app-title"]'); if(apple) apple.content=branding.short_name||branding.company_name;
 const manifest=document.querySelector('link[rel="manifest"]'); if(manifest) manifest.href=`/manifest.webmanifest?v=${encodeURIComponent(branding.branding_version||Date.now())}`;
 const appleIcon=document.querySelector('link[rel="apple-touch-icon"]'); if(appleIcon) appleIcon.href=logo;
}
function isStandalonePWA(){return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;}
function requiresMandatoryDeviceNotifications(){return isStandalonePWA() && window.matchMedia('(max-width: 900px)').matches;}
const $=s=>document.querySelector(s);
function invalidateMasterDataCache(url=""){
 const path=String(url||"").split("?")[0];
 if(path.startsWith("/api/contacts")||path.startsWith("/api/imports/contacts")){apiResponseCache.delete("/api/contacts");apiResponseCache.delete("/api/pianos");}
 if(path.startsWith("/api/pianos")||path.startsWith("/api/imports/pianos")){apiResponseCache.delete("/api/pianos");apiResponseCache.delete("/api/contacts");}
 if(path.startsWith("/api/users")){apiResponseCache.delete("/api/schedule-workers");schedulerWorkersCache=null;}
}
async function apiRequest(url,opt={}){
 const response=await fetch(url,{...opt,headers:{...(opt.body instanceof FormData?{}:{"Content-Type":"application/json"}),Authorization:"Bearer "+token,...(opt.headers||{})}});
 const text=await response.text();let body={};
 try{body=text?JSON.parse(text):{}}catch(_error){body={error:text||"Non-JSON response"}}
 if(!response.ok){const error=new Error(body.error||`API ${response.status}`);error.details=body;error.status=response.status;throw error}
 return body;
}
async function api(url,opt={}){
 const method=String(opt.method||"GET").toUpperCase();
 const cacheKey=String(url).split("?")[0];
 if(method==="GET"&&CACHEABLE_MASTER_ENDPOINTS.has(cacheKey)&&String(url)===cacheKey&&opt.masterCache!==false){
  const now=Date.now(),cached=apiResponseCache.get(cacheKey);
  if(cached?.data&&cached.expiresAt>now)return cached.data;
  if(cached?.promise)return cached.promise;
  const promise=apiRequest(url,opt).then(data=>{apiResponseCache.set(cacheKey,{data,expiresAt:Date.now()+60000});return data;}).catch(error=>{apiResponseCache.delete(cacheKey);throw error;});
  apiResponseCache.set(cacheKey,{promise,expiresAt:now+60000});
  return promise;
 }
 const data=await apiRequest(url,opt);
 if(method!=="GET")invalidateMasterDataCache(url);
 return data;
}

let systemDialogQueue=Promise.resolve();
function systemDialogTitle(type){
 const titles={success:bi("Success","Sikeres művelet"),error:bi("Error","Hiba"),warning:bi("Warning","Figyelmeztetés"),info:bi("Information","Tájékoztatás")};
 return titles[type]||titles.info;
}
function enqueueSystemDialog({message="",title="",type="info",mode="alert",inputType="text",initialValue="",confirmText="",cancelText=""}={}){
 const open=()=>new Promise(resolve=>{
  closeCustomSelect();
  const previous=document.activeElement;
  const overlay=document.createElement("div");
  overlay.className=`system-dialog-overlay system-dialog-${type}`;
  overlay.innerHTML=`<section class="system-dialog" role="dialog" aria-modal="true" aria-labelledby="systemDialogTitle"><div class="system-dialog-heading"><span class="system-dialog-icon" aria-hidden="true">${type==="success"?"✓":type==="error"?"!":type==="warning"?"!":"i"}</span><h3 id="systemDialogTitle"></h3></div><p class="system-dialog-message"></p>${mode==="prompt"?`<input class="system-dialog-input" type="${inputType==="password"?"password":"text"}" autocomplete="${inputType==="password"?"current-password":"off"}">`:""}<div class="system-dialog-actions">${mode!=="alert"?`<button type="button" class="ghost-btn system-dialog-cancel"></button>`:""}<button type="button" class="system-dialog-confirm ${type==="error"||type==="warning"?"danger-btn":""}"></button></div></section>`;
  overlay.querySelector("h3").textContent=title||systemDialogTitle(type);
  overlay.querySelector(".system-dialog-message").textContent=String(message||"");
  const input=overlay.querySelector(".system-dialog-input");
  if(input) input.value=initialValue||"";
  const confirm=overlay.querySelector(".system-dialog-confirm");
  const cancel=overlay.querySelector(".system-dialog-cancel");
  confirm.textContent=confirmText||bi(mode==="alert"?"OK":"Continue",mode==="alert"?"Rendben":"Folytatás");
  if(cancel) cancel.textContent=cancelText||bi("Cancel","Mégse");
  const finish=value=>{
   document.removeEventListener("keydown",onKeyDown,true);
   overlay.classList.remove("show");
   setTimeout(()=>overlay.remove(),180);
   if(previous&&typeof previous.focus==="function") setTimeout(()=>previous.focus({preventScroll:true}),0);
   resolve(value);
  };
  const onKeyDown=event=>{
   if(event.key==="Escape" && mode!=="alert"){event.preventDefault();finish(mode==="prompt"?null:false);}
   if(event.key==="Enter" && (mode!=="prompt"||document.activeElement===input)){event.preventDefault();finish(mode==="prompt"?input.value:true);}
   if(event.key==="Tab"){
    const focusable=[...overlay.querySelectorAll("button,input")].filter(el=>!el.disabled);
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
   }
  };
  confirm.addEventListener("click",()=>finish(mode==="prompt"?input.value:true));
  cancel?.addEventListener("click",()=>finish(mode==="prompt"?null:false));
  overlay.addEventListener("click",event=>{if(event.target===overlay&&mode!=="alert")finish(mode==="prompt"?null:false);});
  document.addEventListener("keydown",onKeyDown,true);
  document.body.appendChild(overlay);
  requestAnimationFrame(()=>overlay.classList.add("show"));
  setTimeout(()=>input?.focus()||confirm.focus(),30);
 });
 const result=systemDialogQueue.then(open,open);
 systemDialogQueue=result.then(()=>undefined,()=>undefined);
 return result;
}
function appAlert(message,type="info",title=""){return enqueueSystemDialog({message,title,type,mode:"alert"});}
function appConfirm(message,{type="warning",title="",confirmText="",cancelText=""}={}){return enqueueSystemDialog({message,title,type,mode:"confirm",confirmText,cancelText});}
function appPrompt(message,{type="warning",title="",inputType="text",initialValue="",confirmText="",cancelText=""}={}){return enqueueSystemDialog({message,title,type,mode:"prompt",inputType,initialValue,confirmText,cancelText});}


/* Unified custom dropdown system.
   Native <select> elements remain in the form for validation and submission,
   while this accessible UI provides one consistent, readable design everywhere. */
let activeCustomSelect=null;
let customSelectObserver=null;
let customSelectSequence=0;
let customSelectValueHooksInstalled=false;

function installCustomSelectValueHooks(){
 if(customSelectValueHooksInstalled)return;
 customSelectValueHooksInstalled=true;
 ["value","selectedIndex"].forEach(property=>{
  const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,property);
  if(!descriptor?.get || !descriptor?.set || descriptor.configurable===false)return;
  try{
   Object.defineProperty(HTMLSelectElement.prototype,property,{
    configurable:descriptor.configurable,
    enumerable:descriptor.enumerable,
    get:descriptor.get,
    set(value){descriptor.set.call(this,value);queueMicrotask(()=>syncCustomSelect(this));}
   });
  }catch(error){console.warn(`Custom select ${property} synchronization unavailable:`,error.message);}
 });
}
function visibleSelectOptions(select){
 return Array.from(select.options).filter(option=>!option.hidden && option.style.display!=="none");
}
function selectedOptionText(select){
 const option=select.options[select.selectedIndex] || visibleSelectOptions(select)[0];
 return option ? option.textContent.trim() : bi("Select","Válassz");
}
function selectOptionContentMarkup(option){
 const label=option?option.textContent.trim():bi("Select","Válassz");
 const color=String(option?.dataset?.color||"").trim();
 const swatch=/^#[0-9a-f]{6}$/i.test(color)?`<i class="select-color-swatch" style="--select-color:${color}" aria-hidden="true"></i>`:"";
 return `${swatch}<span>${htmlText(label)}</span>`;
}
function syncCustomSelect(select){
 if(!select || !select._customSelectButton)return;
 const button=select._customSelectButton;
 const value=button.querySelector('.custom-select-value');
 const option=select.options[select.selectedIndex] || visibleSelectOptions(select)[0];
 if(value)value.innerHTML=selectOptionContentMarkup(option);
 button.disabled=!!select.disabled;
 button.classList.toggle('is-placeholder',!select.value);
 button.setAttribute('aria-disabled',String(!!select.disabled));
 if(activeCustomSelect?.select===select) renderCustomSelectMenu(select);
}
function syncAllCustomSelects(root=document){
 root.querySelectorAll?.('select[data-custom-select-enhanced="true"]').forEach(syncCustomSelect);
}
function cleanupOrphanCustomSelects(){
 document.querySelectorAll('.custom-select-shell').forEach(shell=>{
  const id=shell.dataset.selectId;
  const select=id?document.getElementById(id):null;
  if(!select || !select.isConnected)shell.remove();
 });
}
function closeCustomSelect({restoreFocus=false}={}){
 if(!activeCustomSelect)return;
 const {button,menu}=activeCustomSelect;
 menu.remove();
 button.classList.remove('open');
 button.setAttribute('aria-expanded','false');
 activeCustomSelect=null;
 if(restoreFocus && button.isConnected)button.focus({preventScroll:true});
}
function positionCustomSelectMenu(select,menu){
 const button=select._customSelectButton;
 if(!button || !menu.isConnected)return;
 const rect=button.getBoundingClientRect();
 const viewportHeight=window.visualViewport?.height || window.innerHeight;
 const viewportWidth=window.visualViewport?.width || window.innerWidth;
 const edge=10;
 const preferredMax=Math.min(360,Math.max(190,viewportHeight*.46));
 menu.style.width=`${Math.max(rect.width,180)}px`;
 menu.style.maxWidth=`${Math.max(180,viewportWidth-edge*2)}px`;
 menu.style.left=`${Math.min(Math.max(edge,rect.left),Math.max(edge,viewportWidth-Math.max(rect.width,180)-edge))}px`;
 menu.style.maxHeight=`${preferredMax}px`;
 menu.classList.remove('opens-up');
 menu.style.top=`${rect.bottom+6}px`;
 requestAnimationFrame(()=>{
  if(!menu.isConnected)return;
  const menuHeight=Math.min(menu.scrollHeight,preferredMax);
  const below=viewportHeight-rect.bottom-edge;
  const above=rect.top-edge;
  if(below<Math.min(menuHeight,220) && above>below){
   menu.classList.add('opens-up');
   menu.style.top=`${Math.max(edge,rect.top-menuHeight-6)}px`;
  }else{
   menu.style.top=`${Math.min(rect.bottom+6,viewportHeight-menuHeight-edge)}px`;
  }
 });
}
function renderCustomSelectMenu(select){
 if(!activeCustomSelect || activeCustomSelect.select!==select)return;
 const menu=activeCustomSelect.menu;
 const options=visibleSelectOptions(select);
 menu.replaceChildren();
 options.forEach((option,index)=>{
  const item=document.createElement('button');
  item.type='button';
  item.className='custom-select-option';
  item.setAttribute('role','option');
  item.setAttribute('aria-selected',String(option.selected));
  item.disabled=option.disabled;
  item.dataset.value=option.value;
  item.innerHTML=`<span class="custom-select-option-label">${selectOptionContentMarkup(option)}</span>${option.selected?'<span class="custom-select-check" aria-hidden="true">✓</span>':''}`;
  item.addEventListener('click',event=>{
   event.preventDefault();
   if(option.disabled)return;
   select.value=option.value;
   Array.from(select.options).forEach(o=>o.selected=(o===option));
   select.dispatchEvent(new Event('input',{bubbles:true}));
   select.dispatchEvent(new Event('change',{bubbles:true}));
   syncCustomSelect(select);
   closeCustomSelect({restoreFocus:true});
  });
  item.addEventListener('keydown',event=>{
   const items=Array.from(menu.querySelectorAll('.custom-select-option:not(:disabled)'));
   const pos=items.indexOf(item);
   if(event.key==='ArrowDown'){event.preventDefault();items[(pos+1)%items.length]?.focus();}
   if(event.key==='ArrowUp'){event.preventDefault();items[(pos-1+items.length)%items.length]?.focus();}
   if(event.key==='Home'){event.preventDefault();items[0]?.focus();}
   if(event.key==='End'){event.preventDefault();items.at(-1)?.focus();}
   if(event.key==='Escape'){event.preventDefault();closeCustomSelect({restoreFocus:true});}
  });
  menu.appendChild(item);
 });
 if(!options.length){
  const empty=document.createElement('div');
  empty.className='custom-select-empty';
  empty.textContent=bi('No options available','Nincs választható lehetőség');
  menu.appendChild(empty);
 }
 positionCustomSelectMenu(select,menu);
 requestAnimationFrame(()=>{
  const selected=menu.querySelector('.custom-select-option[aria-selected="true"]');
  selected?.scrollIntoView({block:'nearest'});
 });
}
function openCustomSelect(select){
 if(!select || select.disabled)return;
 syncCustomSelect(select);
 if(activeCustomSelect?.select===select){closeCustomSelect({restoreFocus:true});return;}
 closeCustomSelect();
 const button=select._customSelectButton;
 const menu=document.createElement('div');
 menu.className='custom-select-menu';
 menu.id=`custom-select-menu-${++customSelectSequence}`;
 menu.setAttribute('role','listbox');
 menu.setAttribute('aria-label',select.getAttribute('aria-label')||select.name||bi('Options','Lehetőségek'));
 document.body.appendChild(menu);
 button.classList.add('open');
 button.setAttribute('aria-expanded','true');
 button.setAttribute('aria-controls',menu.id);
 activeCustomSelect={select,button,menu};
 renderCustomSelectMenu(select);
 requestAnimationFrame(()=>{
  const selected=menu.querySelector('.custom-select-option[aria-selected="true"]');
  (selected || menu.querySelector('.custom-select-option:not(:disabled)'))?.focus({preventScroll:true});
 });
}
function enhanceCustomSelect(select){
 if(!(select instanceof HTMLSelectElement) || select.dataset.customSelectEnhanced==='true')return;
 if(select.multiple || select.size>1)return;
 if(!select.id)select.id=`kh-select-${++customSelectSequence}`;
 select.dataset.customSelectEnhanced='true';
 select.classList.add('custom-select-native');
 const shell=document.createElement('div');
 shell.className='custom-select-shell';
 shell.dataset.selectId=select.id;
 const button=document.createElement('button');
 button.type='button';
 button.className='custom-select-trigger';
 button.setAttribute('aria-haspopup','listbox');
 button.setAttribute('aria-expanded','false');
 button.innerHTML='<span class="custom-select-value"></span><span class="custom-select-arrow" aria-hidden="true">⌄</span>';
 shell.appendChild(button);
 select.insertAdjacentElement('afterend',shell);
 select._customSelectButton=button;
 select._customSelectShell=shell;
 button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openCustomSelect(select);});
 button.addEventListener('keydown',event=>{
  if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();openCustomSelect(select);}
  if(event.key==='Escape')closeCustomSelect({restoreFocus:true});
 });
 select.addEventListener('change',()=>syncCustomSelect(select));
 select.addEventListener('invalid',event=>{event.preventDefault();select._customSelectButton?.focus({preventScroll:false});select._customSelectButton?.classList.add('invalid');setTimeout(()=>select._customSelectButton?.classList.remove('invalid'),1400);});
 select.form?.addEventListener('reset',()=>setTimeout(()=>syncCustomSelect(select),0),{once:false});
 syncCustomSelect(select);
}
function enhanceCustomSelects(root=document){
 if(root instanceof HTMLSelectElement)enhanceCustomSelect(root);
 root.querySelectorAll?.('select').forEach(enhanceCustomSelect);
 cleanupOrphanCustomSelects();
}
function initCustomSelectSystem(){
 if(customSelectObserver)return;
 installCustomSelectValueHooks();
 enhanceCustomSelects(document);
 customSelectObserver=new MutationObserver(mutations=>{
  let needsCleanup=false;
  mutations.forEach(mutation=>{
   if(mutation.type==='childList'){
    mutation.addedNodes.forEach(node=>{
     if(node.nodeType===1)enhanceCustomSelects(node);
    });
    if(mutation.removedNodes.length)needsCleanup=true;
    if(mutation.target instanceof HTMLSelectElement)syncCustomSelect(mutation.target);
   }
   if(mutation.type==='attributes' && mutation.target instanceof HTMLSelectElement)syncCustomSelect(mutation.target);
   if(mutation.type==='characterData'){
    const select=mutation.target.parentElement?.closest?.('select');
    if(select)syncCustomSelect(select);
   }
  });
  if(needsCleanup)cleanupOrphanCustomSelects();
 });
 customSelectObserver.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','style']});
 document.addEventListener('change',event=>{if(event.target instanceof HTMLSelectElement)syncCustomSelect(event.target);},true);
 document.addEventListener('pointerdown',event=>{
  if(!activeCustomSelect)return;
  if(activeCustomSelect.menu.contains(event.target) || activeCustomSelect.button.contains(event.target))return;
  closeCustomSelect();
 },true);
 document.addEventListener('keydown',event=>{if(event.key==='Escape')closeCustomSelect({restoreFocus:true});});
 window.addEventListener('resize',()=>closeCustomSelect());
 window.visualViewport?.addEventListener('resize',()=>closeCustomSelect());
 document.addEventListener('scroll',event=>{if(activeCustomSelect && (event.target===activeCustomSelect.menu || activeCustomSelect.menu.contains(event.target)))return;closeCustomSelect();},true);
}

function updatePasswordVisibilityToggle(password,toggle){
 if(!password||!toggle)return;
 const visible=password.type==="text";
 toggle.classList.toggle("active",visible);
 toggle.classList.toggle("password-visible",visible);
 toggle.classList.toggle("password-hidden",!visible);
 toggle.setAttribute("aria-pressed",String(visible));
 toggle.setAttribute("aria-label",visible?bi("Hide password","Jelszó elrejtése"):bi("Show password","Jelszó megjelenítése"));
 toggle.setAttribute("title",visible?bi("Hide password","Jelszó elrejtése"):bi("Show password","Jelszó megjelenítése"));
 if(!toggle.querySelector(".password-eye-icon"))toggle.innerHTML='<svg class="password-eye-icon" aria-hidden="true" viewBox="0 0 24 24"><path class="password-eye-shape" d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle class="password-eye-shape" cx="12" cy="12" r="2.7"/><path class="password-eye-slash" d="M3 3l18 18"/></svg>';
}
function initializePasswordVisibilityToggle(password,toggle){
 if(!password||!toggle)return;
 password.type="password";
 toggle.onclick=()=>{
  password.type=password.type==="password"?"text":"password";
  updatePasswordVisibilityToggle(password,toggle);
  password.focus({preventScroll:true});
 };
 updatePasswordVisibilityToggle(password,toggle);
}
function updateLoginPasswordToggle(){
 updatePasswordVisibilityToggle(document.getElementById("loginPassword"),document.getElementById("toggleLoginPassword"));
}
function initLoginExperience(){
 const form=document.getElementById("loginForm");
 const email=document.getElementById("loginEmail");
 const password=document.getElementById("loginPassword");
 const toggle=document.getElementById("toggleLoginPassword");
 if(email && !email.value){email.value=localStorage.getItem("kh_last_login_email")||"";}
 if(toggle && password){
  initializePasswordVisibilityToggle(password,toggle);
 }
 if(form){form.addEventListener("animationend",()=>{}, {once:true});}
 const code=document.getElementById("activationCode");
 if(code)code.addEventListener("input",()=>{code.value=code.value.replace(/\D/g,"").slice(0,6);});
}

function updateActivationLanguage(){
 const mapping={activationTitle:"activationTitle",activationDescription:"activationDescription",activationCodeLabel:"activationCode",activationVerifyButton:"activationVerify",activationResendButton:"activationResend",activationBackButton:"activationBack"};
 Object.entries(mapping).forEach(([id,key])=>{const element=document.getElementById(id);if(element)element.textContent=tr(key);});
 const recipient=document.getElementById("activationRecipient");
 if(recipient)recipient.textContent=pendingAccountActivation?.contactEmailMasked?`${tr("activationRecipient")}: ${pendingAccountActivation.contactEmailMasked}`:"";
}
function showAccountActivationStep(result){
 pendingAccountActivation={token:String(result.activation_token||""),contactEmailMasked:String(result.contact_email_masked||"")};
 document.getElementById("loginForm")?.classList.add("hidden");
 document.getElementById("activationForm")?.classList.remove("hidden");
 const code=document.getElementById("activationCode");if(code){code.value="";code.focus({preventScroll:true});}
 updateActivationLanguage();
}
function showLoginStep(){
 pendingAccountActivation=null;
 document.getElementById("activationForm")?.classList.add("hidden");
 document.getElementById("loginForm")?.classList.remove("hidden");
 const code=document.getElementById("activationCode");if(code)code.value="";
 document.getElementById("loginEmail")?.focus({preventScroll:true});
}
function completeLoginSession(result,email=""){
 token=result.token;user=result.user;
 localStorage.setItem("kh_token",token);
 localStorage.setItem("kh_user",JSON.stringify(user));
 if(email)localStorage.setItem("kh_last_login_email",email);
 pendingAccountActivation=null;
 loadLanguage();boot();
}

$("#loginForm").onsubmit=async e=>{
 e.preventDefault();
 const fd=Object.fromEntries(new FormData(e.target));
 fd.email=String(fd.email||"").trim().toLowerCase();
 try{
  const response=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(fd)});
  const r=await response.json().catch(()=>({error:"INVALID_LOGIN"}));
  if(!response.ok)return showError(r.error||"INVALID_LOGIN");
  if(r.activation_required){localStorage.setItem("kh_last_login_email",fd.email);return showAccountActivationStep(r);}
  if(!r.token)return showError("INVALID_LOGIN");
  completeLoginSession(r,fd.email);
 }catch(_error){showError("LOGIN_SERVICE_UNAVAILABLE");}
};
$("#activationForm").onsubmit=async e=>{
 e.preventDefault();
 if(!pendingAccountActivation?.token)return showLoginStep();
 const activationCode=String(document.getElementById("activationCode")?.value||"").trim();
 if(!/^\d{6}$/.test(activationCode))return showError("INVALID_ACTIVATION_CODE");
 try{
  const response=await fetch("/api/account-activation/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({activation_token:pendingAccountActivation.token,activation_code:activationCode})});
  const result=await response.json().catch(()=>({error:"INVALID_ACTIVATION_CODE"}));
  if(!response.ok)return showError(result.error||"INVALID_ACTIVATION_CODE");
  completeLoginSession(result,localStorage.getItem("kh_last_login_email")||"");
 }catch(_error){showError("LOGIN_SERVICE_UNAVAILABLE");}
};
$("#activationResendButton").onclick=async()=>{
 if(!pendingAccountActivation?.token)return showLoginStep();
 const button=document.getElementById("activationResendButton");button.disabled=true;
 try{
  const response=await fetch("/api/account-activation/resend",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({activation_token:pendingAccountActivation.token})});
  const result=await response.json().catch(()=>({error:"EMAIL_DELIVERY_FAILED"}));
  if(!response.ok)return showError(result.error||"EMAIL_DELIVERY_FAILED");
  pendingAccountActivation.token=String(result.activation_token||pendingAccountActivation.token);
  pendingAccountActivation.contactEmailMasked=String(result.contact_email_masked||pendingAccountActivation.contactEmailMasked);
  document.getElementById("activationCode").value="";updateActivationLanguage();
  showToast(bi("A new activation code has been sent.","Az új aktiválókódot elküldtük."),"success");
 }catch(_error){showError("EMAIL_DELIVERY_FAILED");}finally{button.disabled=false;}
};
$("#activationBackButton").onclick=showLoginStep;
$("#logoutBtn").onclick=()=>logoutNow();

const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
let inactivityTimer = null;
let countdownInterval = null;
let logoutAt = 0;
function logoutNow(){
  if(token){try{fetch('/api/logout',{method:'POST',headers:{Authorization:'Bearer '+token},keepalive:true});}catch(e){}}
  localStorage.removeItem("kh_token");
  localStorage.removeItem("kh_user");
  location.reload();
}
function updateCountdownDisplay(){
  const el=document.getElementById("sessionCountdown");
  if(!el || !token) return;
  const remaining=Math.max(0, logoutAt-Date.now());
  const totalSeconds=Math.ceil(remaining/1000);
  const mm=String(Math.floor(totalSeconds/60)).padStart(2,"0");
  const ss=String(totalSeconds%60).padStart(2,"0");
  el.textContent=`${tr("logoutIn")}: ${mm}:${ss}`;
  el.classList.toggle("warning", remaining<=60000);
}
function resetInactivityTimer(){
  if(!token) return;
  if(isStandalonePWA()){ if(inactivityTimer)clearTimeout(inactivityTimer); if(countdownInterval)clearInterval(countdownInterval); const el=document.getElementById("sessionCountdown"); if(el)el.style.display="none"; return; }
  logoutAt=Date.now()+INACTIVITY_LIMIT_MS;
  if(inactivityTimer) clearTimeout(inactivityTimer);
  if(countdownInterval) clearInterval(countdownInterval);
  inactivityTimer = setTimeout(async()=>{
    await appAlert(tr("securityLogout"),"warning");
    logoutNow();
  }, INACTIVITY_LIMIT_MS);
  countdownInterval=setInterval(updateCountdownDisplay,1000);
  updateCountdownDisplay();
}
document.addEventListener("click", resetInactivityTimer, true);

async function deleteEverything(){
  if(!isSuperadmin()) return showError("PERMISSION_DENIED");
  const first = await appConfirm(bi("WARNING\n\nThis will permanently delete ALL business data from the system.\n\nThis action cannot be undone.\n\nContinue?","FIGYELMEZTETÉS\n\nEz véglegesen töröl MINDEN üzleti adatot a rendszerből.\n\nA művelet nem visszavonható.\n\nFolytatod?"),{type:"error",confirmText:bi("Delete everything","Minden törlése")});
  if(!first) return;
  const typed = await appPrompt(bi("Final confirmation\n\nType exactly: DELETE EVERYTHING","Végső megerősítés\n\nÍrd be pontosan: DELETE EVERYTHING"),{type:"error",confirmText:bi("Confirm deletion","Törlés megerősítése")});
  if(typed !== "DELETE EVERYTHING"){
    await appAlert(bi("Confirmation text did not match. Nothing was deleted.","A megerősítő szöveg nem egyezett. Semmi nem törlődött."),"warning");
    return;
  }
  try{
    await api("/api/system/delete-everything",{method:"POST",body:JSON.stringify({confirmation:typed})});
    await appAlert(bi("All business data has been deleted. You will be logged out.","Minden üzleti adat törölve lett. Most kijelentkeztetünk."),"success");
    logoutNow();
  }catch(err){showError(err)}
}

function isCompactViewport(){return window.matchMedia("(max-width: 900px)").matches;}
function toggleMobileFilterPanel(panelId,buttonId,stateName){
  const panel=document.getElementById(panelId),button=document.getElementById(buttonId);
  if(!panel)return;
  const opening=!panel.classList.contains("open");
  panel.classList.toggle("open",opening);
  if(button){button.classList.toggle("active",opening);button.setAttribute("aria-expanded",String(opening));}
  if(stateName==="contacts")mobileClientFiltersOpen=opening;
  if(stateName==="pianos")mobilePianoFiltersOpen=opening;
  if(stateName==="finance")mobileFinanceFiltersOpen=opening;
}
function formatFinanceDate(value){
  if(!value)return "";
  const d=new Date(String(value).length===10?`${value}T12:00:00`:value);
  if(Number.isNaN(d.getTime()))return htmlText(value);
  return new Intl.DateTimeFormat(currentLang==="hu"?"hu-HU":"en-US",{year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
}
function openMyProfile(){openUser(user,true);}

function getNotificationDeviceId(){
 let value=localStorage.getItem('kh_notification_device_id');
 if(!value){value=`dev-${crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2)}`;localStorage.setItem('kh_notification_device_id',value);}
 return value;
}
function notificationPlatform(){
 const ua=navigator.userAgent||'';
 if(/iPhone|iPad|iPod/i.test(ua))return 'ios';
 if(/Android/i.test(ua))return 'android';
 if(/Windows/i.test(ua))return 'windows';
 if(/Macintosh|Mac OS X/i.test(ua))return 'macos';
 return 'other';
}
function notificationStatusFromClient(subscription){
 if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))return 'UNSUPPORTED';
 if(Notification.permission==='denied')return 'BLOCKED';
 if(Notification.permission==='granted'&&subscription)return 'ENABLED';
 return 'NOT_CONFIGURED';
}
function notificationGateCopy(status){
 const hu=currentLang==='hu';
 const base={
  NOT_CONFIGURED:[hu?'Munkaértesítések engedélyezése':'Enable work notifications',hu?'Az értesítések kötelezők a munkák, időpontváltozások, belső üzenetek és emlékeztetők fogadásához.':'Notifications are required to receive job assignments, schedule changes, internal messages and reminders.'],
  BLOCKED:[hu?'Az értesítések le vannak tiltva':'Notifications are blocked',hu?'Engedélyezd a Klavierhaus ERP értesítéseit az eszköz vagy a böngésző beállításaiban, majd nyomd meg az Ellenőrzés gombot.':'Enable notifications for Klavierhaus ERP in your device or browser settings, then press Check again.'],
  UNSUPPORTED:[hu?'Az eszköz nem támogatja a kötelező értesítéseket':'Required notifications are not supported',hu?'Ezen az eszközön vagy böngészőben a Web Push nem érhető el. Használj támogatott Chrome, Edge vagy kezdőképernyőre telepített iOS PWA környezetet.':'Web Push is unavailable on this device or browser. Use a supported Chrome, Edge, or installed iOS Home Screen PWA environment.'],
  SERVER_NOT_CONFIGURED:[hu?'A push szolgáltatás nincs beállítva':'Push service is not configured',hu?'A rendszergazdának be kell állítania a VAPID kulcsokat a szerveren.':'The administrator must configure the VAPID keys on the server.'],
  TESTING:[hu?'Értesítési kapcsolat ellenőrzése':'Testing notification connection',hu?'Tesztértesítést küldünk erre az eszközre.':'A test notification is being sent to this device.'],
  SUCCESS:[hu?'Értesítések engedélyezve':'Notifications enabled',hu?'Ez az eszköz készen áll a munkaértesítések fogadására.':'This device is ready to receive work notifications.']
 };
 return base[status]||base.NOT_CONFIGURED;
}
function notificationHelpHtml(){
 const platform=notificationPlatform(),hu=currentLang==='hu';
 if(platform==='android')return `<h3>${hu?'Android / Chrome':'Android / Chrome'}</h3><ol><li>${hu?'Nyisd meg a böngésző webhelybeállításait.':'Open the browser site settings.'}</li><li>${hu?'Válaszd az Értesítések lehetőséget.':'Choose Notifications.'}</li><li>${hu?'Állítsd Engedélyezve állapotra, majd térj vissza és ellenőrizd újra.':'Set it to Allow, return here, and check again.'}</li></ol>`;
 if(platform==='ios')return `<h3>iPhone / iPad</h3><ol><li>${hu?'Telepítsd az ERP-t a kezdőképernyőre a Megosztás → Főképernyőhöz adás funkcióval.':'Install the ERP to the Home Screen using Share → Add to Home Screen.'}</li><li>${hu?'Nyisd meg a telepített alkalmazást.':'Open the installed app.'}</li><li>${hu?'Az iOS beállításaiban engedélyezd az értesítéseket a Klavierhaus számára.':'Enable Klavierhaus notifications in iOS Settings.'}</li></ol>`;
 return `<h3>${hu?'Asztali böngésző':'Desktop browser'}</h3><ol><li>${hu?'Nyisd meg a webhely információs ikonját a címsorban.':'Open the site information icon in the address bar.'}</li><li>${hu?'Az Értesítések beállítást állítsd Engedélyezve értékre.':'Set Notifications to Allow.'}</li><li>${hu?'Térj vissza, majd kattints az Ellenőrzés gombra.':'Return and click Check again.'}</li></ol>`;
}
function showNotificationActivationGate(status,detail=''){
 const gate=document.getElementById('notificationActivationGate'),app=document.getElementById('app');
 if(!gate)return;
 const [title,text]=notificationGateCopy(status);
 document.getElementById('notificationGateTitle').textContent=title;
 document.getElementById('notificationGateText').textContent=text;
 document.getElementById('notificationGateStatus').textContent=detail||'';
 const enableButton=document.getElementById('notificationGateEnable'),checkButton=document.getElementById('notificationGateCheck'),helpButton=document.getElementById('notificationGateHelp'),logoutButton=document.getElementById('notificationGateLogout');
 if(enableButton){enableButton.textContent=bi('Enable notifications','Értesítések engedélyezése');enableButton.classList.toggle('hidden',['BLOCKED','UNSUPPORTED','SERVER_NOT_CONFIGURED','TESTING','SUCCESS'].includes(status));}
 if(checkButton)checkButton.textContent=bi('Check again','Ellenőrzés újra');
 if(helpButton)helpButton.textContent=bi('How to enable notifications','Értesítések engedélyezésének lépései');
 if(logoutButton)logoutButton.textContent=bi('Log out','Kijelentkezés');
 gate.classList.remove('hidden');app?.classList.add('hidden');document.body.classList.add('notification-gate-open');
}
function hideNotificationActivationGate(){
 document.getElementById('notificationActivationGate')?.classList.add('hidden');
 document.body.classList.remove('notification-gate-open');
 notificationGateResolved=true;
}
async function getCurrentPushSubscription(){
 if(!('serviceWorker'in navigator)||!('PushManager'in window))return null;
 const registration=await navigator.serviceWorker.ready;
 return registration.pushManager.getSubscription();
}
async function reportPushStatus(status,subscription=null){
 try{return await api('/api/push/status',{method:'POST',body:JSON.stringify({device_id:getNotificationDeviceId(),status,endpoint:subscription?.endpoint||'',platform:notificationPlatform(),language:currentLang})});}catch(_e){return null;}
}
async function ensureSubscriptionRegisteredForCurrentUser(subscription){
 if(!subscription)return null;
 return api('/api/push/subscribe',{method:'POST',body:JSON.stringify({subscription,language:currentLang,device_id:getNotificationDeviceId(),platform:notificationPlatform()})});
}
async function waitForActivationTest(token,timeoutMs=15000){
 const started=Date.now();
 while(Date.now()-started<timeoutMs){
  const result=await api(`/api/push/test/${encodeURIComponent(token)}`).catch(()=>null);
  if(result?.verified)return true;
  if(result?.status==='FAILED')return false;
  await new Promise(resolve=>setTimeout(resolve,750));
 }
 return false;
}
async function verifyPushDelivery(subscription){
 const response=await api('/api/push/test',{method:'POST',body:JSON.stringify({device_id:getNotificationDeviceId(),endpoint:subscription.endpoint})});
 if(response.verified)return true;
 if(!response.token)return false;
 showNotificationActivationGate('TESTING');
 return waitForActivationTest(response.token);
}
async function evaluateMandatoryNotificationGate({showGate=true}={}){
 if(!requiresMandatoryDeviceNotifications()){
  hideNotificationActivationGate();
  return true;
 }
 let config;
 try{config=await api('/api/notifications/config');}catch(error){if(showGate)showNotificationActivationGate('SERVER_NOT_CONFIGURED',error.message);return false;}
 if(!config.configured){if(showGate)showNotificationActivationGate('SERVER_NOT_CONFIGURED');return false;}
 let subscription=null;
 try{subscription=await getCurrentPushSubscription();}catch(_e){}
 const status=notificationStatusFromClient(subscription);
 await reportPushStatus(status,subscription);
 if(status==='ENABLED'){
  try{
   let check=await api('/api/push/check',{method:'POST',body:JSON.stringify({device_id:getNotificationDeviceId(),endpoint:subscription.endpoint})});
   if(!check?.subscribed){await ensureSubscriptionRegisteredForCurrentUser(subscription);check=await api('/api/push/check',{method:'POST',body:JSON.stringify({device_id:getNotificationDeviceId(),endpoint:subscription.endpoint})});}
   if(check?.verified){hideNotificationActivationGate();return true;}
   const verified=await verifyPushDelivery(subscription);
   if(verified){showNotificationActivationGate('SUCCESS');await new Promise(resolve=>setTimeout(resolve,900));hideNotificationActivationGate();return true;}
  }catch(error){if(showGate)showNotificationActivationGate('NOT_CONFIGURED',error.message);return false;}
 }
 if(showGate)showNotificationActivationGate(status);
 return false;
}
async function enableMandatoryNotifications(){
 if(notificationGateBusy)return;notificationGateBusy=true;
 try{
  const key=await api('/api/push/public-key');
  if(!key.configured||!key.publicKey){showNotificationActivationGate('SERVER_NOT_CONFIGURED');return;}
  if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window)){showNotificationActivationGate('UNSUPPORTED');return;}
  const permission=await Notification.requestPermission();
  if(permission!=='granted'){await reportPushStatus(permission==='denied'?'BLOCKED':'NOT_CONFIGURED');showNotificationActivationGate(permission==='denied'?'BLOCKED':'NOT_CONFIGURED');return;}
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key.publicKey)});
  await api('/api/push/subscribe',{method:'POST',body:JSON.stringify({subscription,language:currentLang,device_id:getNotificationDeviceId(),platform:notificationPlatform()})});
  const ok=await evaluateMandatoryNotificationGate({showGate:true});
  if(ok){document.getElementById('app')?.classList.remove('hidden');render(isMobileAppViewport()?'today':'scheduler');showToast(bi('Notifications enabled successfully.','Az értesítések sikeresen engedélyezve.'),'success');}
 }catch(error){showNotificationActivationGate(Notification.permission==='denied'?'BLOCKED':'NOT_CONFIGURED',error.message);}finally{notificationGateBusy=false;}
}
function initNotificationActivationGate(){
 const enable=document.getElementById('notificationGateEnable'),check=document.getElementById('notificationGateCheck'),help=document.getElementById('notificationGateHelp'),logout=document.getElementById('notificationGateLogout'),panel=document.getElementById('notificationGateHelpPanel');
 if(enable)enable.onclick=enableMandatoryNotifications;
 if(check)check.onclick=async()=>{const ok=await evaluateMandatoryNotificationGate({showGate:true});if(ok){document.getElementById('app')?.classList.remove('hidden');render(isMobileAppViewport()?'today':'scheduler');}};
 if(help)help.onclick=()=>{panel.innerHTML=notificationHelpHtml();panel.classList.toggle('hidden');};
 if(logout)logout.onclick=logoutNow;
 const recheck=async()=>{if(!token||document.visibilityState==='hidden'||!requiresMandatoryDeviceNotifications())return;const gate=document.getElementById('notificationActivationGate');const wasLocked=gate&&!gate.classList.contains('hidden');const ok=await evaluateMandatoryNotificationGate({showGate:true});const app=document.getElementById('app');if(!ok){app?.classList.add('hidden');return;}app?.classList.remove('hidden');if(wasLocked)render(currentView||(isMobileAppViewport()?'today':'scheduler'),{noHistory:true});};
 document.addEventListener('visibilitychange',recheck);
 window.addEventListener('focus',recheck);
 window.addEventListener('pageshow',recheck);
}

async function boot(){
 if(!token)return;
 await loadBranding();
 loadLanguage();
 loadTheme();
 $("#login").classList.add("hidden");
 // Application visibility is controlled by the mandatory notification gate.
 document.body.classList.add("sidebar-collapsed");
 const sb=document.getElementById("sidebarToggle");
 if(sb) sb.onclick=toggleSidebar;
 $("#userInfo").textContent=`${user.name} · ${user.role}`;
 try{userPermissions=await api("/api/my-permissions");}catch(e){userPermissions={all:isSuperadmin(),permissions:[]};}
 renderNavigation();
 updateStaticChromeLanguage();
 const danger=document.getElementById("deleteEverythingBtn");
 if(danger) danger.classList.toggle("hidden", !isSuperadmin());
 resetInactivityTimer();
 $("#nav").onclick=e=>{
   let b=e.target.closest("button");
   if(!b)return;
   document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));
   b.classList.add("active");
   $("#pageTitle").textContent=b.textContent;
   render(b.dataset.v);
 };
 initMobileAppShell();
 initCustomSelectSystem();
 initNotificationCenter();
 initNotificationActivationGate();
 const notificationsReady=await evaluateMandatoryNotificationGate({showGate:true});
 if(notificationsReady){
   document.getElementById('app')?.classList.remove('hidden');
   render(isMobileAppViewport()?"today":"scheduler");
 }
 const googleResult=new URLSearchParams(location.search).get('googleCalendar');
 if(googleResult){
   setTimeout(()=>showToast(googleResult==='connected'?bi('Google Calendar connected. The first synchronization has started.','A Google Naptár csatlakoztatva. Az első szinkronizálás elindult.'):bi('Google Calendar could not be connected.','A Google Naptár csatlakoztatása nem sikerült.'),googleResult==='connected'?'success':'error'),300);
   history.replaceState({},'',location.pathname);
 }
 applyLanguageToDOM();
}
function toggleSidebar(){document.body.classList.toggle("sidebar-collapsed")}
function money(n){return "$"+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}
function badge(v){let c=String(v||"").split(" ")[0];return `<span class="badge ${c}">${v||""}</span>`}
function fmtDate(d){return d.toISOString().slice(0,10)}
function startOfWeek(d){let x=new Date(d);let day=x.getDay();let diff=(day===0?-6:1-day);x.setDate(x.getDate()+diff);x.setHours(0,0,0,0);return x}
function addDays(d,n){let x=new Date(d);x.setDate(x.getDate()+n);return x}
function addDaysToDateKey(value,n){const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function jobsRangeUrl(fromDate,toDateExclusive){return `/api/jobs?from=${encodeURIComponent(`${fromDate}T00:00`)}&to=${encodeURIComponent(`${toDateExclusive}T00:00`)}`}
function localDT(d){
 let x=new Date(d);
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"}).formatToParts(x).reduce((a,p)=>{a[p.type]=p.value;return a},{});
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function localDateTimeParts(value){
 const match=String(value||"").trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
 if(!match)return null;
 const parts={year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),hour:Number(match[4]),minute:Number(match[5])};
 const stamp=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);
 const date=new Date(stamp);
 if(date.getUTCFullYear()!==parts.year||date.getUTCMonth()!==parts.month-1||date.getUTCDate()!==parts.day||date.getUTCHours()!==parts.hour||date.getUTCMinutes()!==parts.minute)return null;
 return {...parts,stamp};
}
function formatWallClockDateTime(stamp){
 const date=new Date(stamp),pad=value=>String(value).padStart(2,"0");
 return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
function addWallClockMinutes(value,minutes){
 const parts=localDateTimeParts(value);
 return parts?formatWallClockDateTime(parts.stamp+Math.round(Number(minutes)||0)*60000):"";
}
function wallClockDifferenceMinutes(start,end){
 const a=localDateTimeParts(start),b=localDateTimeParts(end);
 return a&&b?Math.round((b.stamp-a.stamp)/60000):NaN;
}
function roundWallClockUp(value,step=5){
 const parts=localDateTimeParts(value);if(!parts)return value;
 const remainder=parts.minute%step;
 return remainder===0?formatWallClockDateTime(parts.stamp):formatWallClockDateTime(parts.stamp+(step-remainder)*60000);
}
function isFiveMinuteDateTime(value){const parts=localDateTimeParts(value);return Boolean(parts)&&parts.minute%5===0;}
function formatDurationInput(minutes){const safe=Math.max(0,Math.round(Number(minutes)||0));return `${Math.floor(safe/60)}:${String(safe%60).padStart(2,"0")}`;}
function formatDurationLabel(minutes){
 const safe=Math.max(0,Math.round(Number(minutes)||0)),hours=Math.floor(safe/60),mins=safe%60;
 return currentLang==="hu"?`${hours} óra${mins?` ${mins} perc`:""}`:`${hours} h${mins?` ${mins} min`:""}`;
}
function parseDurationInput(value){
 const raw=String(value||"").trim();
 if(/^\d+$/.test(raw))return Number(raw)*60;
 const match=raw.match(/^(\d{1,3})[:.]([0-5]\d)$/);
 if(!match)return NaN;
 const minutes=Number(match[1])*60+Number(match[2]);
 return Number(match[2])%5===0?minutes:NaN;
}
function hhmm(s){let d=new Date(s);return d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"America/New_York"})}
function sameDay(a,b){return fmtDate(new Date(a))===fmtDate(new Date(b))}
function esc(o){return JSON.stringify(o).replaceAll("'","&#39;")}
function jobRef(j){return j?.job_key || j?.id || j?.job_id || ""}
function req(t){return `${splitBilingualText(t)} <span class="required">*</span>`}
function isSuperadmin(){return user && (user.role==="SUPERADMIN" || Number(user.is_superadmin||0)===1)}
function isAdmin(){return user && (user.role==="ADMIN" || isSuperadmin())}
function bi(en,hu){return currentLang==="hu"?hu:en}
function parenLabel(str){ const m=String(str||"").match(/^\s*(.*?)\s*\((.*?)\)\s*$/); return m ? (currentLang==="hu"?m[2]:m[1]) : String(str||""); }
async function loadSchedulerWorkers(){
  if(!schedulerWorkersCache){
    try{ schedulerWorkersCache=await api("/api/schedule-workers"); }catch(e){ schedulerWorkersCache=[]; }
  }
  if(currentSchedulerWorker===null){
    const mine=(schedulerWorkersCache||[]).find(w=>String(w.id)===String(user?.id));
    currentSchedulerWorker=mine?`worker:${mine.id}`:"ALL";
  }
  return schedulerWorkersCache;
}
function workerById(id){return (schedulerWorkersCache||[]).find(w=>String(w.id)===String(id));}
function workerDisplayName(id,fallback=""){return workerById(id)?.name||fallback||"";}
function workerSelectOptions(selectedId="", selectedName=""){
  const workers=schedulerWorkersCache||[];
  return workers.map(w=>`<option value="${String(w.id).replaceAll('"','&quot;')}" data-worker-name="${String(w.name||"").replaceAll('"','&quot;')}" data-color="${workerColor(w.name,w.calendar_color)}" ${String(selectedId)===String(w.id)||(!selectedId&&String(selectedName)===String(w.name))?"selected":""}>${htmlText(w.name)}</option>`).join("");
}
function resetWorkerAvailabilityLabels(select){
 if(!select)return;
 [...select.options].forEach(option=>{option.textContent=option.dataset.workerName||workerById(option.value)?.name||option.textContent.split(" — ")[0];});
 const hint=select.closest(".field")?.querySelector(".worker-availability-hint");if(hint)hint.textContent="";
 syncCustomSelect(select);
}
async function refreshWorkerAvailability(select,startInput,endInput,excludeJobId=""){
 if(!select)return;
 const start=startInput?.value||"",end=endInput?.value||"";
 if(!start||!end||new Date(end)<=new Date(start)){resetWorkerAvailabilityLabels(select);return;}
 const requestKey=`${start}|${end}|${excludeJobId}|${Date.now()}`;select.dataset.availabilityRequest=requestKey;
 try{
  const params=new URLSearchParams({start_time:start,end_time:end});if(excludeJobId)params.set("exclude_job_id",excludeJobId);
  const availability=await api(`/api/schedule-workers/availability?${params}`);
  if(select.dataset.availabilityRequest!==requestKey)return;
  const byId=new Map(availability.map(row=>[String(row.id),row]));
  [...select.options].forEach(option=>{
   const row=byId.get(String(option.value));const name=option.dataset.workerName||row?.name||option.textContent.split(" — ")[0];
   option.dataset.workerName=name;
   option.textContent=row?`${name} — ${row.available?bi("Available","Szabad"):bi("Busy","Foglalt")}`:name;
  });
  const selected=byId.get(String(select.value));
  const hint=select.closest(".field")?.querySelector(".worker-availability-hint");
  if(hint){hint.classList.toggle("busy",selected?.available===false);hint.textContent=selected?(selected.available?bi("Available for the selected time.","A kiválasztott időpontban szabad."):bi("Busy for the selected time. Choose another employee or time.","A kiválasztott időpontban foglalt. Válassz másik munkatársat vagy időpontot.")):"";}
  syncCustomSelect(select);
 }catch(_error){
  if(select.dataset.availabilityRequest!==requestKey)return;
  resetWorkerAvailabilityLabels(select);
  const hint=select.closest(".field")?.querySelector(".worker-availability-hint");if(hint)hint.textContent=bi("Availability could not be checked.","A foglaltságot nem sikerült ellenőrizni.");
 }
}
function bindWorkerAvailability(select,startInput,endInput,excludeJobId=""){
 if(!select||!startInput||!endInput)return;
 const refresh=()=>refreshWorkerAvailability(select,startInput,endInput,excludeJobId);
 [select,startInput,endInput].forEach(element=>{if(typeof element?.addEventListener==="function"){element.addEventListener("change",refresh);element.addEventListener("input",refresh);}});
 refresh();
}
const workerColorPalette=[
  {hex:"#2563EB",dot:"🔵",name:"Blue"},
  {hex:"#7C3AED",dot:"🟣",name:"Purple"},
  {hex:"#EA580C",dot:"🟠",name:"Orange"},
  {hex:"#EAB308",dot:"🟡",name:"Yellow"},
  {hex:"#92400E",dot:"🟤",name:"Brown"},
  {hex:"#0891B2",dot:"🔷",name:"Teal"},
  {hex:"#DB2777",dot:"🌸",name:"Pink"},
  {hex:"#4338CA",dot:"🔹",name:"Indigo"},
  {hex:"#65A30D",dot:"🫒",name:"Olive"},
  {hex:"#C2410C",dot:"🟧",name:"Deep orange"},
  {hex:"#0F766E",dot:"🟩",name:"Deep teal"},
  {hex:"#A16207",dot:"🟨",name:"Amber"}
];
const reservedCalendarColors=["#F59E0B","#22C55E","#EF4444","#6B7280"];
const knownWorkerColorIndexes={"Károly":0,"Karoly":0,"Alex":1,"Misi":2,"Paul":3,"Pol":3,"Said":4};
function workerColorInfo(name){
  const n=String(name||"").trim();
  const stored=(schedulerWorkersCache||[]).find(w=>String(w.name||"").trim()===n)?.calendar_color;
  if(/^#[0-9a-f]{6}$/i.test(String(stored||""))) return {hex:String(stored).toUpperCase(),dot:"●",name:"Custom"};
  if(Object.prototype.hasOwnProperty.call(knownWorkerColorIndexes,n)) return workerColorPalette[knownWorkerColorIndexes[n]];
  const workers=(schedulerWorkersCache||[]).map(w=>String(w.name||"").trim()).filter(Boolean);
  const idx=workers.indexOf(n);
  const start=5;
  if(idx>=0) return workerColorPalette[(start+idx)%workerColorPalette.length];
  let h=0; for(let i=0;i<n.length;i++) h=(h*31+n.charCodeAt(i))>>>0;
  return workerColorPalette[(start+h)%workerColorPalette.length];
}
function workerColor(name,storedColor=""){ return /^#[0-9a-f]{6}$/i.test(String(storedColor||""))?String(storedColor).toUpperCase():workerColorInfo(name).hex; }
function workerFilterLabel(value, workers=[]){
  if(value==="ALL") return `◎ ${bi("All Jobs","Minden munka")}`;
  if(value==="COMPLETED") return `✓ ${bi("Completed","Elvégzett")}`;
  if(value==="FAILED") return `! ${bi("Failed or overdue","Sikertelen vagy lejárt")}`;
  const id=String(value||"").replace(/^worker:/,"");
  const name=(workers.find(w=>String(w.id)===id)||{}).name||id;
  return name;
}
function schedulerFilterOptions(workers=[]){
 const statusColors={ALL:"#7DD3FC",COMPLETED:"#22C55E",FAILED:"#EF4444"};
 const base=["ALL","COMPLETED","FAILED"].map(value=>`<option value="${value}" data-color="${statusColors[value]}" ${currentSchedulerWorker===value?"selected":""}>${workerFilterLabel(value,workers)}</option>`);
 const workerOptions=workers.map(worker=>{const value=`worker:${String(worker.id).replaceAll('"','&quot;')}`;return `<option value="${value}" data-color="${workerColor(worker.name,worker.calendar_color)}" ${currentSchedulerWorker===value?"selected":""}>${htmlText(workerFilterLabel(value,workers))}</option>`});
 return [...base,...workerOptions].join("");
}
function filterJobsForScheduler(jobs=[]){
 return jobs.filter(job=>{
  if(currentSchedulerWorker==="ALL") return true;
  if(currentSchedulerWorker==="COMPLETED") return String(job.status||"")==="Completed" || String(job.workflow_status||"")==="COMPLETED";
  if(currentSchedulerWorker==="FAILED") return String(job.status||"")==="Failed" || isOverdueJob(job);
  if(String(currentSchedulerWorker).startsWith("worker:")) return String(job.assigned_user_id||"")===String(currentSchedulerWorker).slice(7);
  return String(job.assigned_to||"")===String(currentSchedulerWorker||"");
 });
}
function nyNowLocalString(){ return localDT(new Date()); }
function currentNYTimeString(){
  try{return new Intl.DateTimeFormat(currentLang==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:currentLang!=="hu"}).format(new Date());}
  catch(e){return new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});}
}
function updateNYClock(){ const el=document.getElementById("currentNYClock"); if(el) el.textContent=currentNYTimeString(); }
setInterval(updateNYClock,30000);
function isClosedJobStatus(status){ return ["Completed","Partially completed","Failed"].includes(String(status||"")); }
function isOverdueJob(j){ return !isClosedJobStatus(j.status) && String(j.end_time||"") && String(j.end_time).slice(0,16) < nyNowLocalString(); }
function calendarEventClass(j){
 const status=String(j.status||"");
 if(status==="Failed") return "Failed";
 if(isOverdueJob(j)) return "Overdue";
 if(status==="Completed" || String(j.workflow_status||"")==="COMPLETED") return "Completed";
 if(status==="Partially completed" || String(j.workflow_status||"")==="IN_PROGRESS") return "PartiallyCompleted";
 return "WorkerColor";
}
function calendarStatusIcon(j){
 const cls=calendarEventClass(j);
 if(cls==="Completed") return "✓";
 if(cls==="Failed" || cls==="Overdue") return "!";
 if(j.calendar_source==='GOOGLE' && (Number(j.calendar_conflict_flag||0)===1 || ['SOURCE_CHANGED','SOURCE_CANCELLED','INVALID'].includes(String(j.calendar_review_status||'')))) return "!";
 if(j.calendar_source==='GOOGLE' && String(j.calendar_review_status||'')==='NEEDS_REVIEW') return "?";
 return "◷";
}
function calendarIntegrationClass(j){
 if(j.calendar_source!=='GOOGLE')return '';
 if(Number(j.calendar_conflict_flag||0)===1 || ['SOURCE_CHANGED','SOURCE_CANCELLED','INVALID'].includes(String(j.calendar_review_status||'')))return ' GoogleAttention';
 if(String(j.calendar_review_status||'')==='NEEDS_REVIEW')return ' GoogleNeedsReview';
 return '';
}
function calendarEventStyle(j){ const cls=calendarEventClass(j); return cls==="WorkerColor" ? `style="--event-color:${workerColor(j.assigned_to,j.assigned_calendar_color)}"` : ""; }
function calendarCardAmount(j){
 const billed=Number(j?.billed_amount||0),planned=Number(j?.planned_amount||0);
 if(isClosedJobStatus(j?.status) && billed>0) return money(billed);
 if(planned>0) return money(planned);
 return "—";
}
function calendarEventDensityClass(j){
 const start=new Date(j?.start_time||0).getTime(),end=new Date(j?.end_time||0).getTime();
 const minutes=Number.isFinite(start)&&Number.isFinite(end)&&end>start?(end-start)/60000:0;
 if(minutes<45) return " EventCompact";
 if(minutes<90) return " EventMedium";
 return " EventDetailed";
}
function calendarEventCardMarkup(j){
 const time=`${String(j?.start_time||"").slice(11,16)}–${String(j?.end_time||"").slice(11,16)}`;
 const client=String(j?.client_name||"—"),amount=calendarCardAmount(j);
 const responsible=String(j?.assigned_to||"—"),address=String(j?.service_address||"—");
 return `<strong class="event-card-time">${htmlText(time)}</strong><b class="event-card-title">${htmlText(j?.title||"")}</b><small class="event-card-primary">${htmlText(client)} · ${htmlText(amount)}</small><small class="event-card-secondary">${htmlText(responsible)} · ${htmlText(address)}</small><span class="event-status">${calendarStatusIcon(j)}</span>`;
}

function ensureView(id){
 let el=document.getElementById(id);
 if(!el){
   el=document.createElement("section");
   el.id=id;
   el.className="view";
   const main=document.querySelector(".main") || document.querySelector("main") || document.body;
   main.appendChild(el);
 }
 return el;
}
function forceShowView(id){
 document.querySelectorAll(".view").forEach(v=>{
   v.classList.remove("active");
   v.classList.add("hidden");
   v.style.display="none";
 });
 const el=ensureView(id);
 el.classList.add("active");
 el.classList.remove("hidden");
 el.style.display="block";
 return el;
}
async function render(v,opts={}){
 if(currentView && currentView!==v && !opts.noHistory) viewHistory.push(currentView);
 currentView=v;
 document.body.dataset.currentView=v;
 const target=forceShowView(v);
 target.classList.add("i18n-rendering");
 const pageTitle=document.getElementById("pageTitle");
 if(pageTitle) pageTitle.textContent=navLabel(v);
 updateMobileGlobalNotificationBell();
 try{
  if(v==="today") await renderToday();
  else if(v==="scheduler") await renderScheduler();
  else if(v==="planned_jobs") await renderPlannedJobs();
  else if(v==="closed_jobs") await renderClosedJobs();
  else if(v==="income_statement") await renderIncomeStatement();
  else if(v==="finance") await renderFinance();
  else if(v==="inventory") await renderInventory();
  else if(v==="users") await renderUsers();
  else if(v==="audit_log") await renderAuditLog();
  else if(v==="settings") await renderSettings();
  else if(v==="pianos") await renderPianos();
  else if(v==="notifications") await renderNotifications();
  else await renderTable(v);
  applyLanguageToDOM(target);
  enhanceCustomSelects(target);
 }finally{
  target.classList.remove("i18n-rendering");
 }
}


function goBackView(){const previous=viewHistory.pop();render(previous||'today',{noHistory:true});}
function mobileBackHeader(title){return isMobileAppViewport()?`<div class="mobile-page-title"><button type="button" class="mobile-back-btn" onclick="goBackView()" aria-label="Back">‹</button><h2>${title}</h2></div>`:'';}
function isMobileAppViewport(){ return window.matchMedia("(max-width: 900px)").matches; }
function nyDateKey(date=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date).reduce((a,p)=>{a[p.type]=p.value;return a},{});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function mobileTimeRange(j){ return `${String(j.start_time||"").slice(11,16)}–${String(j.end_time||"").slice(11,16)}`; }
function mobileJobAddressLink(address){ return address?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`:""; }
function updateMobileNavigationLanguage(){
  document.querySelectorAll("[data-mobile-label]").forEach(el=>{el.textContent=tr(el.dataset.mobileLabel)});
  const title=document.getElementById("mobileMoreTitle"); if(title) title.textContent=tr("more");
  updateMobileNavigationActive();
}
function updateMobileNavigationActive(){
  document.querySelectorAll(".mobile-nav-btn[data-mobile-view]").forEach(btn=>btn.classList.toggle("active",btn.dataset.mobileView===currentView));
  const more=document.getElementById("mobileMoreBtn");
  if(more) more.classList.toggle("active",!["today","contacts","pianos"].includes(currentView));
}
function closeMobileMore(){ const sheet=document.getElementById("mobileMoreSheet"); if(sheet){sheet.classList.add("hidden");sheet.setAttribute("aria-hidden","true");document.body.classList.remove("mobile-sheet-open");} }
function openMobileMore(){
  const sheet=document.getElementById("mobileMoreSheet"), items=document.getElementById("mobileMoreItems"); if(!sheet||!items)return;
  const all=(navs[user?.role]||navs.WORKER).filter(n=>!['contacts','pianos'].includes(n[0]) && (n[0]==="settings"?isAdmin():n[0]==="audit_log"?(isAdmin()||userPermissions.all||userPermissions.permissions.includes("audit.view")):(userPermissions.all||userPermissions.permissions.includes(`${n[0]}.view`))));
  const top=`<button type="button" class="mobile-more-item ${currentView==='scheduler'?'active':''}" data-more-view="scheduler"><span>📅</span><b>${tr('calendar')}</b></button>`;
  items.innerHTML=top+all.filter(n=>n[0]!=="scheduler").map(n=>`<button type="button" class="mobile-more-item ${currentView===n[0]?'active':''}" data-more-view="${n[0]}"><span>${mobileViewIcon(n[0])}</span><b>${navLabel(n[0])}</b></button>`).join("")+`<button type="button" class="mobile-more-item" id="mobileProfileBtn"><span>👤</span><b>${tr('myProfile')}</b></button><button type="button" class="mobile-more-item" id="mobileLogoutBtn"><span>↪</span><b>${tr('logout')}</b></button>`;
  sheet.classList.remove("hidden");sheet.setAttribute("aria-hidden","false");document.body.classList.add("mobile-sheet-open");
  items.querySelectorAll("[data-more-view]").forEach(btn=>btn.onclick=()=>{closeMobileMore();render(btn.dataset.moreView);});
  const profile=document.getElementById("mobileProfileBtn"); if(profile) profile.onclick=()=>{closeMobileMore();openMyProfile();};
  const logout=document.getElementById("mobileLogoutBtn"); if(logout) logout.onclick=()=>logoutNow();
}
function mobileViewIcon(view){ return ({planned_jobs:"🗂",closed_jobs:"✅",knowledge_base:"🧾",finance:"💵",income_statement:"📊",inventory:"📦",users:"👤",audit_log:"🧾",settings:"⚙️",notifications:"🔔",scheduler:"📅"})[view]||"•"; }
function initMobileAppShell(){
  const nav=document.getElementById("mobileBottomNav"); if(!nav)return;
  nav.querySelectorAll("[data-mobile-view]").forEach(btn=>btn.onclick=()=>render(btn.dataset.mobileView));
  const add=document.getElementById("mobileAddJobBtn"); if(add) add.onclick=()=>openJob();
  const more=document.getElementById("mobileMoreBtn"); if(more) more.onclick=openMobileMore;
  const close=document.getElementById("mobileMoreClose"); if(close) close.onclick=closeMobileMore;
  const backdrop=document.querySelector("#mobileMoreSheet .mobile-sheet-backdrop"); if(backdrop) backdrop.onclick=closeMobileMore;
  window.addEventListener("resize",()=>{ if(!isMobileAppViewport()&&currentView==="today") render("scheduler"); });
  updateMobileNavigationLanguage();
}
async function renderToday(){
  const target=ensureView("today");
  const date=nyDateKey();
  const jobs=await api(jobsRangeUrl(date,addDaysToDateKey(date,1))); const workers=await loadSchedulerWorkers();
  const dayStart=7*60, dayEnd=22*60, total=dayEnd-dayStart;
  const dailyJobs=filterJobsForScheduler(jobs).filter(j=>String(j.start_time||"").slice(0,10)===date);
  const layout=calendarLayout(dailyJobs,dayStart,dayEnd);
  const quarter=Array.from({length:(dayEnd-dayStart)/15+1},(_,i)=>{const min=dayStart+i*15;return `<i class="${min%60===0?'hour':''}" style="top:${((min-dayStart)/total)*100}%"></i>`}).join('');
  const times=Array.from({length:(dayEnd-dayStart)/60+1},(_,i)=>{const min=dayStart+i*60;return `<span style="top:${((min-dayStart)/total)*100}%">${String(Math.floor(min/60)).padStart(2,'0')}:00</span>`}).join('');
  const events=layout.map(x=>{const j=x.event,top=((x.start-dayStart)/total)*100,height=((x.end-x.start)/total)*100,left=(x.lane/x.lanes)*100,width=100/x.lanes;const colorStyle=calendarEventClass(j)==='WorkerColor'?`--event-color:${workerColor(j.assigned_to,j.assigned_calendar_color)};`:'';return `<button type="button" class="timeline-event ${calendarEventClass(j)}${calendarIntegrationClass(j)}${calendarEventDensityClass(j)}" style="${colorStyle}top:${top}%;height:${height}%;left:${left}%;width:calc(${width}% - 4px)" onclick='openJobDetails(${esc(j)})'>${calendarEventCardMarkup(j)}</button>`}).join('');
  target.innerHTML=`<div class="mobile-today-shell"><div class="today-page-header"><h2>${bi('Today','Ma')}</h2>${notificationBellMarkup('mobileTodayNotificationBell')}</div><section class="today-hero"><div><span>${bi('Today in New York','Ma New Yorkban')}</span><h2>${new Intl.DateTimeFormat(currentLang==='hu'?'hu-HU':'en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric'}).format(new Date())}</h2></div><div class="today-clock"><strong>${currentNYTimeString()}</strong><small>America/New_York</small></div></section><div class="today-list-head"><h2>${bi('My daily calendar','Napi naptáram')}</h2><div class="today-calendar-actions"><label class="today-worker-filter"><span>${tr('workerFilter')}</span><select class="worker-filter-select" aria-label="${tr('workerFilter')}" onchange="currentSchedulerWorker=this.value;renderToday()">${schedulerFilterOptions(workers)}</select></label><button type="button" onclick="render('scheduler')">${bi('Full calendar','Teljes naptár')} →</button></div></div><div class="daily-calendar-scroll"><div class="daily-calendar"><div class="timeline-times">${times}</div><div class="timeline-day daily-day" data-date="${date}" onclick="handleDailySlotClick(event,'${date}',${dayStart},${dayEnd})"><div class="quarter-grid">${quarter}</div><div class="current-time-line" data-date="${date}" data-day-start="${dayStart}" data-day-end="${dayEnd}"><span></span></div>${events}</div></div></div></div>`;
  updateCurrentTimeLine(); clearInterval(currentTimeLineInterval); currentTimeLineInterval=setInterval(updateCurrentTimeLine,60000); updateMobileNavigationActive();
}
function handleDailySlotClick(event,date,dayStart,dayEnd){if(event.target.closest('.timeline-event'))return;const rect=event.currentTarget.getBoundingClientRect();const ratio=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));let mins=Math.round((dayStart+ratio*(dayEnd-dayStart))/15)*15;mins=Math.min(dayEnd-15,Math.max(dayStart,mins));const hh=String(Math.floor(mins/60)).padStart(2,'0'),mm=String(mins%60).padStart(2,'0');openJob();setTimeout(()=>{const form=document.querySelector('.modal form');if(!form)return;const start=form.querySelector('[name="start_time"]');if(start)start.value=`${date}T${hh}:${mm}`;},50);}

function minutesFromTime(value){
 const m=String(value||"").slice(11,16).match(/^(\d{2}):(\d{2})$/);
 return m?Number(m[1])*60+Number(m[2]):0;
}
function calendarLayout(events,dayStart,dayEnd){
 const sorted=[...events].sort((a,b)=>minutesFromTime(a.start_time)-minutesFromTime(b.start_time)||minutesFromTime(a.end_time)-minutesFromTime(b.end_time));
 const active=[]; const placed=[];
 for(const event of sorted){
   const start=Math.max(dayStart,minutesFromTime(event.start_time));
   const end=Math.min(dayEnd,Math.max(start+15,minutesFromTime(event.end_time)));
   for(let i=active.length-1;i>=0;i--) if(active[i].end<=start) active.splice(i,1);
   const used=new Set(active.map(x=>x.lane)); let lane=0; while(used.has(lane)) lane++;
   const item={event,start,end,lane}; active.push(item); placed.push(item);
 }
 for(const item of placed){
   const overlaps=placed.filter(x=>x.start<item.end && x.end>item.start);
   item.lanes=Math.max(1,...overlaps.map(x=>x.lane+1));
 }
 return placed;
}
function nyDateParts(date=new Date()){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"}).formatToParts(date).reduce((a,p)=>{a[p.type]=p.value;return a},{});
 return {date:`${parts.year}-${parts.month}-${parts.day}`,minutes:Number(parts.hour)*60+Number(parts.minute),label:`${parts.hour}:${parts.minute}`};
}
function updateCurrentTimeLine(){
 const now=nyDateParts();
 document.querySelectorAll(".current-time-line").forEach(line=>{
   if(line.dataset.date!==now.date){line.classList.add("hidden");return;}
   const start=Number(line.dataset.dayStart||420), end=Number(line.dataset.dayEnd||1320);
   if(now.minutes<start||now.minutes>end){line.classList.add("hidden");return;}
   line.classList.remove("hidden");
   line.style.top=`${((now.minutes-start)/(end-start))*100}%`;
   const label=line.querySelector("span"); if(label) label.textContent=now.label;
 });
}
async function renderScheduler(){
 const week=[0,1,2,3,4,5,6].map(i=>addDays(currentWeekStart,i));
 const weekDates=week.map(d=>fmtDate(d));
 const jobs=await api(jobsRangeUrl(weekDates[0],addDaysToDateKey(weekDates[6],1)));
 const workers=await loadSchedulerWorkers();
 const visibleJobs=filterJobsForScheduler(jobs);
 const dayStart=7*60, dayEnd=22*60, totalMinutes=dayEnd-dayStart;
 let html=`<div class="panel scheduler-panel"><div class="toolbar scheduler-toolbar"><div><h3>${bi("Weekly Scheduler","Heti naptár")}</h3><p class="muted">${weekDates[0]} – ${weekDates[6]} · America/New_York</p><div class="ny-time-box"><span>${bi("Current New York time","Aktuális New York-i idő")}</span><strong id="currentNYClock">${currentNYTimeString()}</strong></div></div><div class="scheduler-actions"><label class="inline-label">${tr("workerFilter")}<select class="worker-filter-select" onchange="currentSchedulerWorker=this.value;renderScheduler()">${schedulerFilterOptions(workers)}</select></label><button class="small" onclick="moveWeek(-1)">← ${bi("Previous","Előző")}</button><button class="small" onclick="goThisWeek()">${bi("This week","Aktuális hét")}</button><button class="small" onclick="moveWeek(1)">${bi("Next","Következő")} →</button><button onclick="openJob()">+ ${bi("Add Job","Új munka")}</button></div></div>
 <div class="scheduler-legend"><span class="legend-active">◷ ${bi("Active — employee color","Aktív — munkavállalói szín")}</span><span class="legend-partial">◷ ${bi("Part completed, workflow continues","Rész kész, folyamatban")}</span><span class="legend-complete">✓ ${bi("Fully completed","Teljesen lezárt")}</span><span class="legend-overdue">! ${bi("Overdue, not closed","Lejárt, nincs lezárva")}</span><span class="legend-failed">! ${bi("Failed","Sikertelen")}</span></div>
 <div class="timeline-scroll"><div class="timeline-calendar"><div class="timeline-corner">${bi("Time","Idő")}</div>${week.map(d=>`<div class="timeline-day-head"><b>${d.toLocaleDateString(currentLang==="hu"?"hu-HU":"en-US",{weekday:"short"})}</b><span>${fmtDate(d)}</span></div>`).join("")}
 <div class="timeline-times">${Array.from({length:16},(_,i)=>`<span style="top:${(i*60/totalMinutes)*100}%">${String(i+7).padStart(2,"0")}:00</span>`).join("")}</div>`;
 for(const day of week){
   const dayStr=fmtDate(day); const events=visibleJobs.filter(j=>String(j.start_time||"").slice(0,10)===dayStr);
   const placed=calendarLayout(events,dayStart,dayEnd);
   html+=`<div class="timeline-day" data-date="${dayStr}" onclick="if(event.target===this){const r=this.getBoundingClientRect();const mins=${dayStart}+Math.round(((event.clientY-r.top)/r.height)*${totalMinutes}/15)*15;openJob('${dayStr}T'+String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0'))}">
    <div class="quarter-grid">${Array.from({length:60},(_,i)=>`<i style="top:${(i/60)*100}%" class="${i%4===0?'hour':''}"></i>`).join("")}</div>
    <div class="current-time-line" data-date="${dayStr}" data-day-start="${dayStart}" data-day-end="${dayEnd}"><span></span></div>`;
   for(const item of placed){
     const j=item.event; const top=((item.start-dayStart)/totalMinutes)*100; const height=Math.max(1.67,((item.end-item.start)/totalMinutes)*100);
     const width=100/item.lanes; const left=item.lane*width;
     html+=`<button type="button" class="timeline-event ${calendarEventClass(j)}${calendarIntegrationClass(j)}${calendarEventDensityClass(j)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);width:calc(${width}% - 4px);${calendarEventClass(j)==='WorkerColor'?`--event-color:${workerColor(j.assigned_to,j.assigned_calendar_color)};`:''}" onclick='event.stopPropagation();openJobDetails(${esc(j)})'>${calendarEventCardMarkup(j)}</button>`;
   }
   html+=`</div>`;
 }
 html+=`</div></div></div>`;
 $("#scheduler").innerHTML=html;
 updateNYClock(); updateCurrentTimeLine();
 clearInterval(window.__khTimelineTimer); window.__khTimelineTimer=setInterval(()=>{updateNYClock();updateCurrentTimeLine()},60000);
 applyLanguageToDOM();
}
async function refreshCalendarAfterMutation(job=null){
 if(job?.start_time && currentView==="scheduler") currentWeekStart=startOfWeek(new Date(job.start_time));
 if(currentView==="today") return renderToday();
 if(currentView==="scheduler") return renderScheduler();
 return null;
}
function moveWeek(n){currentWeekStart=addDays(currentWeekStart,7*n);renderScheduler()} function goThisWeek(){currentWeekStart=startOfWeek(new Date());renderScheduler()}
setInterval(async()=>{
 if(!token||document.visibilityState==='hidden'||calendarAutoRefreshBusy||!['today','scheduler'].includes(currentView))return;
 calendarAutoRefreshBusy=true;
 try{if(currentView==='today')await renderToday();else if(currentView==='scheduler')await renderScheduler();}catch(_error){}finally{calendarAutoRefreshBusy=false;}
},15000);

async function openJob(prefill="", row=null){
 const existingMinutes=Number(row?.planned_minutes)>0?Number(row.planned_minutes):Math.round(Number(row?.planned_hours||3)*60);
 const start=row?.start_time || roundWallClockUp(prefill || newYorkNowLocal(),5);
 const end=row?.end_time || addWallClockMinutes(start,existingMinutes||180);
 const preservesExistingExactTime=Boolean(row?.id&&(!isFiveMinuteDateTime(start)||!isFiveMinuteDateTime(end)));
 const dateTimeStep=preservesExistingExactTime?"any":"300";

 const [contacts,pianos]=await Promise.all([
  api("/api/contacts").catch(()=>[]),
  api("/api/pianos").catch(()=>[]),
  loadSchedulerWorkers().catch(()=>[])
 ]).then(results=>[results[0],results[1]]);

 const clientOptions=contacts.map(c=>`<option value="${(c.name||"").replaceAll('"',"&quot;")}">${c.phone||""} ${c.address||""}</option>`).join("");
 const pianoOptions=pianos.map(p=>`<option value="${(`${p.brand||""} ${p.model||""}`).trim().replaceAll('"',"&quot;")}">${p.serial_no||""} ${p.location||""}</option>`).join("");

 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=row ? bi("Edit Job","Munka szerkesztése") : bi("New Job","Új munka");
 $("#form").innerHTML=`<div class="form-grid">
<div class="field"><label>${req("Job title / Munka neve")}</label><input name="title" value="${row?.title||""}" required placeholder="Piano tuning / Zongorahangolás"></div>
<div class="field"><label>${req("Assigned to / Felelős")}</label>
<select id="jobAssignedUser" name="assigned_user_id" required>
${workerSelectOptions(row?.assigned_user_id,row?.assigned_to)}
</select><small class="worker-availability-hint" aria-live="polite"></small></div>

<div class="field"><label>${req("Standalone or part-work / Önálló munka vagy részmunka")}</label>
<select name="job_type" id="jobType" onchange="toggleInstructionsField()">
<option value="Standalone" ${row?.job_type==="Standalone"?"selected":""}>Standalone / Önálló munka</option>
<option value="Part-work" ${row?.job_type==="Part-work"?"selected":""}>Part-work / Részmunka</option>
</select></div>

<div class="field"><label>${req("Client name / Ügyfél neve")}</label>
<input id="clientNameInput" name="client_name" list="clientList" value="${row?.client_name||""}" required placeholder="Start typing client name / Kezdd el írni az ügyfél nevét">
<datalist id="clientList">${clientOptions}</datalist></div>

<div class="field"><label>${req("Piano name / Zongora neve")}</label>
<input id="pianoNameInput" name="piano_name" list="pianoList" value="${row?.piano_name||""}" required placeholder="Steinway D, Yamaha U1...">
<datalist id="pianoList">${pianoOptions}</datalist></div>

<div class="field"><label>Client phone / Ügyfél telefonszáma</label><input id="clientPhoneInput" name="client_phone" value="${row?.client_phone||""}" placeholder="+1..."></div>

<div class="field"><label>${req("Start / Kezdés")}</label><input id="jobStart" name="start_time" type="datetime-local" value="${start}" step="${dateTimeStep}" required></div>
<div class="field"><label>${req("End / Befejezés")}</label><input id="jobEnd" name="end_time" type="datetime-local" value="${end}" step="${dateTimeStep}" required></div>

<div class="field"><label>Estimated amount / Előzetes összeg</label><input name="planned_amount" type="number" value="${row?.planned_amount||0}"></div>
<div class="field"><label>Pricing basis / Díjmegállapítás módja</label>
<input name="pricing_basis" value="${row?.pricing_basis||""}" placeholder="Phone quote / Telefonos ajánlat, Email quote / E-mail ajánlat, Fixed agreement / Fix megállapodás"></div>

<div class="field"><label>${bi("Planned duration","Tervezett időtartam")}</label><input id="plannedDuration" type="text" inputmode="numeric" value="${formatDurationInput(existingMinutes||180)}" pattern="[0-9]{1,3}[:.][0-5][0-9]" placeholder="3:05" required><input id="plannedHours" name="planned_hours" type="hidden" value="${Number(row?.planned_hours||((existingMinutes||180)/60))}"><input id="plannedMinutes" name="planned_minutes" type="hidden" value="${existingMinutes||180}"><small>${bi("Format: hours:minutes, in 5-minute steps (for example 3:05).","Formátum: óra:perc, 5 perces lépésekben (például 3:05).")}</small></div>
<div class="field"><label>${req("Service address / Cím")}</label><input id="serviceAddressInput" name="service_address" value="${row?.service_address||""}" required></div>

<div class="field full ${row?.job_type==="Part-work"?"":"hidden"}" id="instructionsField"><label>Remaining tasks / Hátralévő feladatok</label>
<textarea name="instructions" placeholder="Csak részmunka esetén: milyen feladat marad még hátra?">${row?.instructions||""}</textarea></div>
</div>
<div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>${row?"Save changes / Módosítás mentése":"Create job / Munka létrehozása"}</button></div>`;

 const startInput=document.getElementById("jobStart");
 const endInput=document.getElementById("jobEnd");
 const assignedInput=document.getElementById("jobAssignedUser");
 const hoursInput=document.getElementById("plannedHours");
 const minutesInput=document.getElementById("plannedMinutes");
 const durationInput=document.getElementById("plannedDuration");
 const clientInput=document.getElementById("clientNameInput");
 const phoneInput=document.getElementById("clientPhoneInput");
 const addressInput=document.getElementById("serviceAddressInput");
 const pianoInput=document.getElementById("pianoNameInput");

 function fillClientData(){
   const c=contacts.find(x=>(x.name||"").trim().toLowerCase()===(clientInput.value||"").trim().toLowerCase());
   if(!c) return;
   phoneInput.value=c.phone||phoneInput.value||"";
   addressInput.value=c.address||addressInput.value||"";
   const ownedList=pianos.filter(p=>p.owner_contact_id===c.id);
   if(ownedList.length){
     const list=document.getElementById("pianoList");
     if(list) list.innerHTML=ownedList.map(p=>`<option value="${(p.display_name||`${p.brand||""} ${p.model||""}`.trim()).replaceAll('"',"&quot;")}">${p.serial_no||""} ${p.location||""}</option>`).join("");
     const owned=ownedList[0];
     if(!pianoInput.value) pianoInput.value=(owned.display_name||`${owned.brand||""} ${owned.model||""}`).trim();
   }
 }
 clientInput.addEventListener("change", fillClientData);
 clientInput.addEventListener("blur", fillClientData);

 function setEndFromDuration(){
   const s=startInput.value;
   const minutes=parseDurationInput(durationInput.value);
   if(!s || !Number.isFinite(minutes) || minutes<5) return;
   minutesInput.value=String(minutes);
   hoursInput.value=String(minutes/60);
   endInput.value=addWallClockMinutes(s,minutes);
 }
 function setDurationFromTimes(){
   if(!startInput.value || !endInput.value) return;
   const minutes=wallClockDifferenceMinutes(startInput.value,endInput.value);
   if(minutes>0){durationInput.value=formatDurationInput(minutes);minutesInput.value=String(minutes);hoursInput.value=String(minutes/60);}
 }
 durationInput.addEventListener("change",setEndFromDuration);
 startInput.addEventListener("change",()=>{validateDateField(startInput);setEndFromDuration();});
 endInput.addEventListener("change",()=>{validateDateField(endInput);setDurationFromTimes();});
 bindWorkerAvailability(assignedInput,startInput,endInput,row?.id||"");

 toggleInstructionsField();
 applyLanguageToDOM(document.getElementById("modal"));

 $("#form").onsubmit=async ev=>{
   ev.preventDefault();
   let b=Object.fromEntries(new FormData(ev.target));

   if(!validateDateField(startInput) || !validateDateField(endInput)) return;
   if(wallClockDifferenceMinutes(b.start_time,b.end_time)<=0){showError("INVALID_TIME_RANGE");return}
   const timesUnchanged=Boolean(row?.id&&b.start_time===row.start_time&&b.end_time===row.end_time);
   if(!timesUnchanged&&(!isFiveMinuteDateTime(b.start_time)||!isFiveMinuteDateTime(b.end_time))){showError("INVALID_TIME_STEP");return}
   const plannedMinutes=timesUnchanged?wallClockDifferenceMinutes(b.start_time,b.end_time):parseDurationInput(durationInput.value);
   if(!Number.isFinite(plannedMinutes)||plannedMinutes<5){showError("INVALID_PLANNED_DURATION");return}
   if(b.job_type==="Part-work" && !(b.instructions||"").trim()){
     appAlert(bi("Remaining tasks are required for part-work.","Részmunka esetén a hátralévő feladatok megadása kötelező."),"warning");
     return;
   }
   b.planned_minutes=plannedMinutes;b.planned_hours=plannedMinutes/60;b.planned_amount=Number(b.planned_amount||0);
   b.travel_minutes=0;
   b.priority=row?.priority||"Medium";
   if(row?.id){ b.id=row.id; b.job_id=row.id; } if(row?.job_key){ b.job_key=row.job_key; }
   b.client_id=row?.client_id||null;
   b.piano_id=row?.piano_id||null;

   const matchedClient=contacts.find(c=>(c.name||"").trim().toLowerCase()===(b.client_name||"").trim().toLowerCase());
   if(matchedClient){
     b.client_id=matchedClient.id;
     if(!b.client_phone && matchedClient.phone) b.client_phone=matchedClient.phone;
     if(!b.service_address && matchedClient.address) b.service_address=matchedClient.address;
   }
   const matchedPiano=pianos.find(p=>(`${p.brand||""} ${p.model||""}`).trim().toLowerCase()===(b.piano_name||"").trim().toLowerCase());
   if(matchedPiano) b.piano_id=matchedPiano.id;

   try{
     const saved=row ? await api(`/api/jobs/${encodeURIComponent(jobRef(row))}`,{method:"PUT",body:JSON.stringify(b)}) : await api("/api/jobs",{method:"POST",body:JSON.stringify(b)});
     console.log("Saved job / Mentett munka:", saved);
     currentWeekStart=startOfWeek(new Date(saved.start_time || b.start_time));
     closeModal();
     await refreshCalendarAfterMutation(saved);
   }catch(err){showError(err)}
 };
}

function toggleInstructionsField(){
 const t=document.getElementById("jobType")?.value;
 const el=document.getElementById("instructionsField");
 if(el) el.classList.toggle("hidden", t!=="Part-work");
}
function validateDateField(input){
 const val=input.value||"";
 const year=val.slice(0,4);
 if(!val){appAlert(bi("Please enter the exact date.","Kérlek, add meg pontosan a dátumot."),"warning"); return false}
 if(!/^\d{4}$/.test(year)){appAlert(bi("Year must be exactly 4 digits.","Az évszám pontosan 4 számjegyből álljon."),"warning"); return false}
 return true;
}
function newYorkNowLocal(){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"}).formatToParts(new Date()).reduce((a,p)=>{a[p.type]=p.value;return a},{});
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function isPastDate(value){
 if(!value) return false;
 return String(value).slice(0,16) < newYorkNowLocal();
}

function toggleInstructionsField(){
 const t=document.getElementById("jobType")?.value;
 const el=document.getElementById("instructionsField");
 if(el) el.classList.toggle("hidden", t!=="Part-work");
}
function googleImportDateTime(value){
 const raw=String(value||'').trim();
 if(!raw)return '—';
 try{
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return new Intl.DateTimeFormat(currentLang==='hu'?'hu-HU':'en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));
  const parsed=new Date(raw);if(Number.isNaN(parsed.getTime()))return raw;
  return new Intl.DateTimeFormat(currentLang==='hu'?'hu-HU':'en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(parsed);
 }catch(_error){return raw}
}
function googleImportDetailsMarkup(imported){
 if(!imported)return '';
 const attendees=Array.isArray(imported.attendees)?imported.attendees.filter(Boolean):[];
 const row=(label,value,extraClass='')=>`<div class="google-import-row ${extraClass}"><dt>${label}</dt><dd data-i18n-exempt>${value||'—'}</dd></div>`;
 return `<section class="google-import-details" aria-label="${bi('Imported Google event details','Importált Google-esemény adatai')}">
  <h4>${bi('Imported Google event details','Importált Google-esemény adatai')}</h4>
  <dl>
   ${row(bi('Event title','Esemény címe'),htmlText(imported.title))}
   ${row(bi('Description','Leírás'),htmlText(imported.description).replaceAll('\n','<br>'),'google-import-description')}
   ${row(bi('Location','Helyszín'),htmlText(imported.location))}
   ${row(bi('Start','Kezdés'),htmlText(googleImportDateTime(imported.start_time)))}
   ${row(bi('End','Befejezés'),htmlText(googleImportDateTime(imported.end_time)))}
   ${row(bi('Creator','Létrehozó'),htmlText(imported.creator))}
   ${attendees.length?row(bi('Attendees','Résztvevők'),htmlText(attendees.join(', '))):''}
  </dl>
 </section>`;
}
function jobStatusLabel(status){
 const labels={Open:bi('Open','Nyitott'),Completed:bi('Completed','Teljesen lezárt'),'Partially completed':bi('Partially completed','Részlegesen lezárt'),Failed:bi('Failed','Sikertelen'),Cancelled:bi('Cancelled','Törölt')};
 return labels[String(status||'')]||String(status||'');
}
function renderJobDetails(j){
 const phone=j.client_phone?`<a href="tel:${htmlText(String(j.client_phone).replace(/\s+/g,''))}" class="phone-link" data-i18n-exempt>${htmlText(j.client_phone)}</a>`:'—';
 const closed=isClosedJobStatus(j.status)||String(j.status||'')==='Cancelled';
 const googleState=String(j.calendar_review_status||'');
 const googleStateLabel={NEEDS_REVIEW:bi('Needs review','Ellenőrzésre vár'),REVIEWED:bi('Reviewed','Ellenőrizve'),SOURCE_CHANGED:bi('Google source changed after review','A Google-forrás az ellenőrzés után megváltozott'),SOURCE_CANCELLED:bi('Google source event cancelled — ERP job kept','A Google-forrásesemény törölve — az ERP-munka megmaradt'),INVALID:bi('Invalid Google event','Hibás Google-esemény')}[googleState]||googleState;
 const googleAttention=Number(j.calendar_conflict_flag||0)===1||['SOURCE_CHANGED','SOURCE_CANCELLED','INVALID'].includes(googleState);
 const showGoogleBanner=j.calendar_source==='GOOGLE'&&(!j.calendar_reviewed_at||googleAttention);
 const googleBanner=showGoogleBanner?`<div class="google-calendar-banner ${googleAttention?'attention':'review'}"><strong>${googleAttention?bi('Google Calendar warning','Google Naptár-figyelmeztetés'):bi('Google Calendar import','Google Naptár-import')}</strong><span>${htmlText(googleStateLabel)}</span>${Number(j.calendar_conflict_flag||0)===1?`<small>! ${bi('Schedule conflict: choose another employee or time before review.','Időpontütközés: ellenőrzés előtt válassz másik munkatársat vagy időpontot.')}</small>`:''}</div>`:'';
 const actionJob={...j};delete actionJob.calendar_import;
 const actionButtons=[`<button type="button" class="ghost-btn" onclick="closeModal()">${bi('Close','Bezárás')}</button>`];
 actionButtons.push(`<button type="button" class="ghost-btn" onclick="openWorkflowHistory('${jobRef(j)}')">${bi('Workflow history','Munkafolyamat')}</button>`);
 if(!closed){
  actionButtons.push(`<button type="button" onclick='openJob("",${esc(actionJob)})'>${bi('Edit job','Munka szerkesztése')}</button>`);
  actionButtons.push(`<button type="button" onclick='openCloseJob(${esc(actionJob)})'>${bi('Close job','Munka lezárása')}</button>`);
 }
 if(j.calendar_source==='GOOGLE'&&isAdmin()&&!j.calendar_reviewed_at&&googleState!=='REVIEWED'&&googleState!=='SOURCE_CANCELLED')actionButtons.push(`<button type="button" onclick="reviewGoogleCalendarJob('${jobRef(j)}')">${bi('Mark as reviewed','Ellenőrzés befejezése')}</button>`);
 if(isSuperadmin())actionButtons.push(`<button type="button" class="danger-btn" onclick="deleteJob('${jobRef(j)}')">${bi('Delete job','Munka törlése')}</button>`);
 const instructions=j.calendar_source!=='GOOGLE'&&j.instructions?`<p><b>${bi('Instructions','Utasítások')}:</b><br><span data-i18n-exempt>${htmlText(j.instructions).replaceAll('\n','<br>')}</span></p>`:'';
 $("#form").innerHTML=`${googleBanner}${googleImportDetailsMarkup(j.calendar_import)}<div class="work-card">
  <h4>${badge(j.priority)} <span data-i18n-exempt>${htmlText(j.title||'')}</span></h4>
  <p class="muted"><b>${bi('Job key','Munkaazonosító')}:</b> <span data-i18n-exempt>${htmlText(j.job_key||j.id||'')}</span></p>
  <p><b>${bi('Work category','Munkakategória')}:</b> ${j.job_type==='Part-work'?bi('Part-work','Részmunka'):bi('Standalone','Önálló munka')}</p>
  <p><b>${bi('Assigned','Felelős')}:</b> <span data-i18n-exempt>${htmlText(j.assigned_to||'—')}</span></p>
  <p><b>${bi('Client','Ügyfél')}:</b> <span data-i18n-exempt>${htmlText(j.client_name||j.client_id||'—')}</span></p>
  <p><b>${bi('Phone','Telefon')}:</b> ${phone}</p>
  <p><b>${bi('Piano','Zongora')}:</b> <span data-i18n-exempt>${htmlText(j.piano_name||j.piano_id||'—')}</span></p>
  <p><b>${bi('Time','Idő')}:</b> <span data-i18n-exempt>${htmlText(j.start_time||'—')} → ${htmlText(j.end_time||'—')}</span></p>
  <p><b>${bi('Planned duration','Tervezett időtartam')}:</b> <span data-i18n-exempt>${formatDurationLabel(Number(j.planned_minutes)>0?Number(j.planned_minutes):Math.round(Number(j.planned_hours||0)*60))}</span></p>
  <p><b>${bi('Address','Cím')}:</b> <span data-i18n-exempt>${htmlText(j.service_address||'—')}</span></p>
  <p><b>${bi('Estimated','Előzetes összeg')}:</b> ${money(j.planned_amount)}${j.pricing_basis?` · <span data-i18n-exempt>${htmlText(splitBilingualText(j.pricing_basis))}</span>`:''}</p>
  <p><b>${bi('Status','Státusz')}:</b> <span class="badge ${htmlText(String(j.status||'').split(' ')[0])}">${htmlText(jobStatusLabel(j.status))}</span></p>
  ${closed?`<p class="muted"><b>${bi('View only','Csak megtekintés')}:</b> ${bi('This job has already been closed or partially closed.','Ez a munka már lezárt vagy részlegesen lezárt.')}</p>`:''}
  ${instructions}
 </div><div class="actions">${actionButtons.join('')}</div>`;
 $("#form").onsubmit=e=>e.preventDefault();
}
async function openJobDetails(summary){
 const requestId=++jobDetailsRequestSequence;
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=bi('Job details','Munka részletei');
 $("#form").innerHTML=`<div class="modal-loading" aria-live="polite">${bi('Loading job details…','Munkarészletek betöltése…')}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Close','Bezárás')}</button></div>`;
 $("#form").onsubmit=e=>e.preventDefault();
 try{
  const detailed=await api(`/api/jobs/${encodeURIComponent(jobRef(summary))}`);
  if(requestId!==jobDetailsRequestSequence)return;
  renderJobDetails(detailed);
 }catch(error){
  if(requestId!==jobDetailsRequestSequence)return;
  showError(error);
 }
}
async function reviewGoogleCalendarJob(id){
 try{const reviewed=await api(`/api/jobs/${encodeURIComponent(id)}/calendar-review`,{method:'POST'});closeModal();await refreshCalendarAfterMutation(reviewed);showToast(bi('Google Calendar job reviewed.','A Google Naptár-munka ellenőrizve.'),'success');}catch(error){showError(error)}
}
async function openWorkflowHistory(id){
 try{
   const data=await api(`/api/jobs/${encodeURIComponent(id)}/workflow`);
   $("#modal").classList.remove("hidden"); $("#modalTitle").textContent=bi("Workflow history","Munkafolyamat története");
   $("#form").innerHTML=`<div class="workflow-history">${data.steps.map((j,i)=>`<article class="workflow-step ${calendarEventClass(j)}"><div class="workflow-step-index">${i+1}</div><div><h4>${calendarStatusIcon(j)} ${htmlText(j.title||"")}</h4><p><b>${htmlText(j.assigned_to||"")}</b> · ${String(j.start_time||"").replace("T"," ")} – ${String(j.end_time||"").replace("T"," ")}</p><p class="muted">${bi("Status","Státusz")}: ${htmlText(j.status||"")} · ${bi("Step","Lépés")}: ${j.workflow_step_no||i+1}</p>${j.close_notes?`<p>${htmlText(j.close_notes)}</p>`:""}</div></article>`).join("")}</div><div class="actions"><button type="button" onclick="closeModal()">${bi("Close","Bezárás")}</button></div>`;
   $("#form").onsubmit=e=>e.preventDefault();
 }catch(err){showError(err)}
}
async function deleteJob(id){
 if(!isSuperadmin()) return showError("PERMISSION_DENIED");
 if(!await appConfirm(bi("Delete this job from the visible system?","Töröljük ezt a munkát a látható rendszerből?"),{type:"error",confirmText:bi("Delete","Törlés")})) return;
 try{await api(`/api/jobs/${encodeURIComponent(id)}`,{method:"DELETE"}); closeModal(); await refreshCalendarAfterMutation();}catch(err){showError(err)}
}
async function openReassign(j){
 await loadSchedulerWorkers();
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=bi("Reassign job","Munka átadása");
 $("#form").innerHTML=`<div class="form-grid">
 <div class="field"><label>${req("Current responsible / Jelenlegi felelős")}</label><input value="${j.assigned_to||""}" disabled></div>
 <div class="field"><label>${req("New responsible / Új felelős")}</label>
 <select id="reassignWorker" name="assigned_user_id" required>
 ${workerSelectOptions(j.assigned_user_id,j.assigned_to)}
 </select><small class="worker-availability-hint" aria-live="polite"></small></div>
 <div class="field full"><label>Reassignment note / Átadási megjegyzés</label><textarea name="reassignment_note" placeholder="Átadás vagy visszavétel oka / Reason for reassignment or take-back"></textarea></div>
 </div>
 <div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Reassign only / Csak átadás</button></div>`;
 bindWorkerAvailability(document.getElementById("reassignWorker"),{value:j.start_time},{value:j.end_time},j.id||"");
 $("#form").onsubmit=async e=>{
   e.preventDefault();
   try{
     const body=Object.fromEntries(new FormData(e.target));
     body.id=j.id; body.job_id=j.id; body.job_key=j.job_key; body.client_id=j.client_id; body.client_name=j.client_name; body.piano_name=j.piano_name; body.title=j.title;
     const saved=await api(`/api/jobs/${encodeURIComponent(jobRef(j))}/reassign`,{method:"PUT",body:JSON.stringify(body)});
     closeModal();
     await refreshCalendarAfterMutation(saved);
   }catch(err){showError(err)}
 }
}
function openCloseJob(j){$("#modalTitle").textContent=bi("Close Job","Munka lezárása");$("#form").innerHTML=`<p class="muted">Billed amount / Számlázandó összeg kötelező. Ha 0, nem kell fájl. Ha nagyobb mint 0, fizetési mód és számla/csekk fájl kötelező.</p><div class="form-grid">
<div class="field"><label>${req("Close type / Lezárás típusa")}</label><select name="close_type" id="closeType" onchange="toggleNextJob()"><option>Full</option><option>Partial</option><option>Failed</option></select></div>
<div class="field"><label>${req("Billed amount / Számlázandó összeg")}</label><input name="billed_amount" type="number" value="${j.planned_amount||0}" required></div>
<div class="field"><label>${req("Payment method / Fizetési mód")}</label><select name="payment_method" required><option value="">Select payment method / Válassz fizetési módot</option><option>Cash</option><option>Check</option><option>Bank Transfer</option><option>Credit Card</option><option>Invoice</option><option>Warranty Work</option></select></div>
<div class="field"><label>Invoice number / Számla vagy csekk szám</label><input name="invoice_number"></div><div class="field"><label>Invoice/check file / Számla vagy csekk fájl</label><input name="file" type="file"></div>
<div class="field full"><label>${req("Close description / Elvégzett munka leírása")}</label><textarea name="close_description" required></textarea></div>
<div id="nextJobFields" class="field full hidden"><h3>Next job / Következő feladat</h3><div class="form-grid"><div class="field full"><label>${req("Next title / Következő feladat neve")}</label><input name="next_title"></div><div class="field"><label>${req("Next assigned to / Következő felelős")}</label><select id="nextAssignedUser" name="next_assigned_user_id">${workerSelectOptions(j.assigned_user_id,j.assigned_to)}</select><small class="worker-availability-hint" aria-live="polite"></small></div><div class="field"><label>Next priority / Következő prioritás</label><select name="next_priority"><option>Critical</option><option>Urgent</option><option>High</option><option selected>Medium</option><option>Low</option></select></div><div class="field"><label>${req("Next start / Következő kezdés")}</label><input id="nextJobStart" name="next_start_time" type="datetime-local" step="300"></div><div class="field"><label>${req("Next end / Következő befejezés")}</label><input id="nextJobEnd" name="next_end_time" type="datetime-local" step="300"></div><div class="field"><label>Next planned amount / Következő tervezett összeg</label><input name="next_planned_amount" type="number" value="0"></div><div class="field full"><label>Next pricing basis / Következő díjmegállapítás</label><input name="next_pricing_basis"></div><div class="field full"><label>Next address / Következő cím</label><input name="next_service_address" value="${j.service_address||""}"></div><div class="field full"><label>Next instructions / Következő teendők</label><textarea name="next_instructions"></textarea></div></div></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Save closeout / Lezárás mentése</button></div>`;
bindWorkerAvailability(document.getElementById("nextAssignedUser"),document.getElementById("nextJobStart"),document.getElementById("nextJobEnd"));
$("#form").onsubmit=async e=>{e.preventDefault();let fd=new FormData(e.target);let billed=Number(fd.get("billed_amount"));let file=fd.get("file");let payment=fd.get("payment_method");if(billed>0&&!payment){appAlert(bi("Payment method is required when billed amount is greater than zero.","Fizetési mód kötelező, ha az összeg nagyobb mint 0."),"warning");return}if(billed>0&&(!file||!file.name)){appAlert(bi("An invoice/check file is required when the amount is greater than zero.","Számla/csekk fájl kötelező, ha az összeg nagyobb mint 0."),"warning");return}
if(file && file.name && !isAllowedInvoiceFile(file.name)){appAlert(bi("Only PDF, JPG, JPEG or PNG files are allowed.","Csak PDF, JPG, JPEG vagy PNG fájl tölthető fel."),"warning");return}
if(fd.get("close_type")==="Partial"){
 const required=["next_title","next_assigned_user_id","next_start_time","next_end_time"];
 if(required.some(field=>!fd.get(field))){showError("PARTIAL_CLOSE_NEXT_JOB_REQUIRED");return;}
 if(wallClockDifferenceMinutes(fd.get("next_start_time"),fd.get("next_end_time"))<=0){showError("INVALID_TIME_RANGE");return;}
 if(!isFiveMinuteDateTime(fd.get("next_start_time"))||!isFiveMinuteDateTime(fd.get("next_end_time"))){showError("INVALID_TIME_STEP");return;}
}
fd.append("id",j.id||""); fd.append("job_id",j.id||""); fd.append("job_key",j.job_key||""); fd.append("client_id",j.client_id||""); fd.append("client_name",j.client_name||""); fd.append("piano_name",j.piano_name||""); fd.append("title",j.title||"");
fd.append("id",j.id||""); fd.append("job_id",j.id||""); fd.append("job_key",j.job_key||""); fd.append("client_id",j.client_id||""); fd.append("client_name",j.client_name||""); fd.append("piano_name",j.piano_name||""); fd.append("title",j.title||"");
if(fd.get("close_type")==="Full"&&!await appConfirm(bi("Close the entire workflow? Every earlier linked part-work will also become fully completed.","Lezárod a teljes munkafolyamatot? Minden korábbi kapcsolódó részmunka is teljesen lezárttá válik."),{type:"warning",confirmText:bi("Close entire workflow","Teljes munkafolyamat lezárása")})) return;
try{const saved=await api(`/api/jobs/${encodeURIComponent(jobRef(j))}/close`,{method:"POST",body:fd});closeModal();await refreshCalendarAfterMutation(saved)}catch(err){showError(err)}}}
function isAllowedInvoiceFile(name){return /\.(pdf|jpg|jpeg|png)$/i.test(name||"")}
function toggleNextJob(){document.getElementById("nextJobFields").classList.toggle("hidden",document.getElementById("closeType").value!=="Partial")}
function headerLabel(key,c){
 const map={
   contacts:{customer_status_icon:"Status / Státusz",id:"Client ID / Ügyfél ID",name:"Client name / Ügyfél neve",phone:"Phone / Telefon",email:"Email / E-mail",address:"Address / Cím",last_contact:"Last visit / Utolsó látogatás",next_step:"Next step / Következő lépés"},
   pianos:{id:"Piano ID / Zongora ID",brand:"Brand / Márka",model:"Model / Típus",serial_no:"Serial No. / Gyári szám",owner_contact_id:"Owner client ID / Tulajdonos ügyfél ID",location:"Location / Helyszín",estimated_value:"Estimated value / Becsült érték",status:"Status / Státusz"},
   knowledge_base:{id:"ID",title:"Title / Cím",category:"Category / Kategória",owner:"Owner / Felelős",amount:"Amount / Összeg",payment_method:"Payment method / Fizetési mód",invoice_number:"Invoice/check number / Számla vagy csekk szám",stored_path:"Attachment / Melléklet",created_at:"Created / Létrehozva"}
 };
 return map[key]?.[c] || c;
}

function pianoDisplayName(p){
 return String(p.display_name||`${p.brand||""} ${p.model||""}`.trim()||p.original_description||bi("Unknown piano","Ismeretlen zongora"));
}
function pianoOwnerLabel(p){
 if(p.owner_name) return p.owner_name;
 const group=pianoOwnershipGroup(p);
 if(group==="COMPANY_OWNED") return bi("Klavierhaus / Company piano","Klavierhaus / Céges zongora");
 if(group==="CONSIGNMENT") return bi("Consignment","Bizományos");
 if(group==="RENTAL") return bi("Rental","Bérelt");
 return bi("Unidentified owner","Ismeretlen tulajdonos");
}
function pianoOwnershipGroup(p){
 const ownership=String(p.ownership_type||p.ownership||"").trim().toLowerCase();
 const resolution=String(p.owner_resolution||"").trim().toUpperCase();
 if(p.owner_contact_id) return "MATCHED_CLIENT";
 if(resolution==="COMPANY_OWNED"||ownership.includes("company")) return "COMPANY_OWNED";
 if(resolution==="COMPANY_REVIEW"||resolution==="CONSIGNMENT"||ownership.includes("consign")) return "CONSIGNMENT";
 if(resolution==="RENTAL"||ownership.includes("rental")) return "RENTAL";
 return "UNIDENTIFIED_OWNER";
}
function pianoSearchMatch(p,q){
 const raw=String(q||"").trim().toLowerCase();
 if(!raw) return true;
 const hay=[p.brand,p.model,p.display_name,p.original_description,p.serial_no,p.location,p.owner_address,p.owner_name,p.client_name,p.status,p.ownership_type,p.ownership].join(" ").toLowerCase();
 return hay.includes(raw);
}
function pianoPaginationHtml(page,totalPages,totalItems){
 if(totalPages<=1) return `<div class="client-pagination single"><span>${bi("Showing","Megjelenítve")} ${totalItems}</span></div>`;
 const pages=new Set([1,totalPages,page-2,page-1,page,page+1,page+2]);
 const valid=[...pages].filter(x=>x>=1&&x<=totalPages).sort((a,b)=>a-b);
 let last=0,buttons="";
 valid.forEach(p=>{if(last&&p-last>1)buttons+=`<span class="page-gap">…</span>`;buttons+=`<button type="button" class="page-btn ${p===page?"active":""}" onclick="setPianoPage(${p})">${p}</button>`;last=p;});
 return `<div class="client-pagination"><button type="button" class="page-btn" ${page<=1?"disabled":""} onclick="setPianoPage(${page-1})">‹</button>${buttons}<button type="button" class="page-btn" ${page>=totalPages?"disabled":""} onclick="setPianoPage(${page+1})">›</button><span class="page-summary">${bi("Page","Oldal")} ${page}/${totalPages} · ${totalItems} ${bi("pianos","zongora")}</span></div>`;
}
function setPianoPage(page){currentPianoPage=Math.max(1,Number(page)||1);renderPianos();}
function clearPianoFilters(){currentPianoSearch="";currentPianoOwnershipFilter="ALL";currentPianoMinValue="";currentPianoMaxValue="";currentPianoPage=1;renderPianos();}
function setupPianoTableScroll(){
 const top=document.getElementById("pianosScrollTop"),bottom=document.getElementById("pianosTableWrap"),spacer=top?.querySelector(".table-scroll-spacer"),table=bottom?.querySelector("table");
 if(!top||!bottom||!spacer||!table)return;
 const syncWidth=()=>{spacer.style.width=`${table.scrollWidth}px`;top.classList.toggle("hidden-scroll",table.scrollWidth<=bottom.clientWidth+1);};
 let syncing=false;
 top.addEventListener("scroll",()=>{if(syncing)return;syncing=true;requestAnimationFrame(()=>{bottom.scrollLeft=top.scrollLeft;syncing=false;});},{passive:true});
 bottom.addEventListener("scroll",()=>{if(syncing)return;syncing=true;requestAnimationFrame(()=>{top.scrollLeft=bottom.scrollLeft;syncing=false;});},{passive:true});
 syncWidth();
 if(window.ResizeObserver){const ro=new ResizeObserver(syncWidth);ro.observe(table);ro.observe(bottom);}
}
async function deleteAllPianos(){
 if(!isSuperadmin())return showError(bi("Superadmin only.","Csak szuperadmin használhatja ezt a funkciót."));
 const confirmed=await appConfirm(bi(
  "Delete every piano, all piano-import history, and all stored piano import fingerprints? Clients and other modules will remain. This cannot be undone.",
  "Töröljük az összes zongorát, a teljes zongoraimport-előzményt és minden tárolt zongoraimport-azonosítót? Az ügyfelek és más modulok megmaradnak. A művelet nem vonható vissza."
 ),{type:"error",confirmText:bi("Delete all pianos","Összes zongora törlése")});
 if(!confirmed)return;
 try{
  const result=await api('/api/pianos',{method:'DELETE'});
  currentPianoImportAnalysis=null;
  currentPianoPage=1;
  currentPianoSearch="";
  currentPianoOwnershipFilter="ALL";
  currentPianoMinValue="";
  currentPianoMaxValue="";
  await appAlert(bi(
   `Piano module reset completed. Deleted pianos: ${Number(result.deletedPianos||0)}.`,
   `A zongoramodul teljes törlése elkészült. Törölt zongorák: ${Number(result.deletedPianos||0)}.`
  ),"success");
  await renderPianos();
 }catch(err){showError(err)}
}
function schedulePianosRender(){
 clearTimeout(pianosRenderTimer);
 pianosRenderTimer=setTimeout(()=>render("pianos",{noHistory:true}),275);
}
function bindPianoFilterDebounce(){
 const search=document.getElementById("pianoSearchInput");
 if(search)search.oninput=()=>{currentPianoSearch=search.value;currentPianoPage=1;schedulePianosRender();};
 const numbers=[...document.querySelectorAll("#pianoFilterPanel input[type=number]")];
 if(numbers[0])numbers[0].oninput=()=>{currentPianoMinValue=numbers[0].value;currentPianoPage=1;schedulePianosRender();};
 if(numbers[1])numbers[1].oninput=()=>{currentPianoMaxValue=numbers[1].value;currentPianoPage=1;schedulePianosRender();};
}
async function renderPianos(){
 const data=await api("/api/pianos");
 const min=currentPianoMinValue===""?null:Number(currentPianoMinValue),max=currentPianoMaxValue===""?null:Number(currentPianoMaxValue);
 const ownershipCounts=data.reduce((acc,p)=>{const key=pianoOwnershipGroup(p);acc[key]=(acc[key]||0)+1;return acc;},{ALL:data.length});
 const filtered=data.filter(p=>{
   if(!pianoSearchMatch(p,currentPianoSearch))return false;
   if(currentPianoOwnershipFilter!=="ALL"&&pianoOwnershipGroup(p)!==currentPianoOwnershipFilter)return false;
   const value=Number(p.estimated_value||0);
   if(min!==null&&(!Number.isFinite(value)||value<min))return false;
   if(max!==null&&(!Number.isFinite(value)||value>max))return false;
   return true;
 });
 const totalPages=Math.max(1,Math.ceil(filtered.length/PIANOS_PER_PAGE));
 currentPianoPage=Math.min(Math.max(1,currentPianoPage),totalPages);
 const start=(currentPianoPage-1)*PIANOS_PER_PAGE,pageRows=filtered.slice(start,start+PIANOS_PER_PAGE);
 const pagination=pianoPaginationHtml(currentPianoPage,totalPages,filtered.length);
 const cols=["owner_name","display_name","serial_no","location","ownership_type","estimated_value"];
 const label={owner_name:bi("Client / Owner","Ügyfél / tulajdonos"),display_name:bi("Piano","Zongora"),serial_no:bi("Serial No.","Gyári szám"),location:bi("Location","Helyszín"),ownership_type:bi("Ownership","Tulajdon"),estimated_value:bi("Estimated value","Becsült érték")};
 const ownerOptions=[
  ['ALL',bi('All pianos','Összes zongora')],
  ['MATCHED_CLIENT',bi('Linked to client','Ügyfélhez kapcsolt')],
  ['UNIDENTIFIED_OWNER',bi('Unidentified owner','Ismeretlen tulajdonos')],
  ['COMPANY_OWNED',bi('Company pianos','Céges zongorák')],
  ['CONSIGNMENT',bi('Consignment','Bizományos')],
  ['RENTAL',bi('Rental','Bérelt')]
 ];
 const ownerOptionHtml=ownerOptions.map(([v,t])=>`<option value="${v}" ${currentPianoOwnershipFilter===v?"selected":""}>${t} (${Number(ownershipCounts[v]||0)})</option>`).join("");
 const resetButton=isSuperadmin()?`<button type="button" class="small danger-btn piano-reset-btn" onclick="deleteAllPianos()">${bi("Delete all pianos","Összes zongora törlése")}</button>`:"";
 $("#pianos").innerHTML=`<div class="panel piano-list-panel"><div class="toolbar"><h3>${bi("Pianos","Zongorák")}</h3><div class="toolbar-actions">${isAdmin()?`<button class="small" onclick="openPianoImportModal()">${bi("Import Excel","Excel import")}</button>`:""}<button class="small" onclick="exportTable('pianos')">Export CSV</button><button onclick="openForm('pianos')">+ ${bi("Add","Új")}</button>${resetButton}</div></div><button id="pianoFilterToggle" type="button" class="mobile-filter-toggle" aria-expanded="${mobilePianoFiltersOpen}" onclick="toggleMobileFilterPanel('pianoFilterPanel','pianoFilterToggle','pianos')">⌕ ${bi("Filters","Szűrők")}</button><div id="pianoFilterPanel" class="piano-filter-grid piano-filter-grid-no-status mobile-collapsible-filter ${mobilePianoFiltersOpen?"open":""}"><label>${bi("Search","Keresés")}<input id="pianoSearchInput" value="${htmlText(currentPianoSearch)}" placeholder="${bi("Client, piano, serial number or address","Ügyfél, zongora, gyári szám vagy cím")}" oninput="currentPianoSearch=this.value;currentPianoPage=1;renderPianos()"></label><label>${bi("Ownership","Tulajdon")}<select onchange="currentPianoOwnershipFilter=this.value;currentPianoPage=1;renderPianos()">${ownerOptionHtml}</select></label><label>${bi("Minimum value (USD)","Minimum érték (USD)")}<input type="number" min="0" value="${htmlText(currentPianoMinValue)}" oninput="currentPianoMinValue=this.value;currentPianoPage=1;renderPianos()"></label><label>${bi("Maximum value (USD)","Maximum érték (USD)")}<input type="number" min="0" value="${htmlText(currentPianoMaxValue)}" oninput="currentPianoMaxValue=this.value;currentPianoPage=1;renderPianos()"></label><div class="piano-filter-actions"><button type="button" class="small ghost-btn" onclick="clearPianoFilters()">${bi("Clear filters","Szűrők törlése")}</button></div></div>${pagination}<div class="table-scroll-top" id="pianosScrollTop" aria-label="${bi("Horizontal table scroll","Vízszintes táblázatgörgetés")}"><div class="table-scroll-spacer"></div></div><div class="table-wrap contacts-table-wrap pianos-table-wrap" id="pianosTableWrap"><table><thead><tr>${cols.map(c=>`<th>${label[c]}</th>`).join("")}<th>${bi("Actions","Műveletek")}</th></tr></thead><tbody>${pageRows.map(r=>`<tr><td class="piano-owner-cell ${!r.owner_contact_id?'piano-owner-unidentified':''}">${htmlText(pianoOwnerLabel(r))}</td><td>${htmlText(pianoDisplayName(r))}</td><td>${htmlText(r.serial_no||'—')}</td><td>${mapLink(r.location)||'—'}</td><td>${htmlText(r.ownership_type||r.ownership||'—')}</td><td>${money(r.estimated_value)}</td><td class="piano-actions"><button class="small" onclick="pianoInfo('${r.id}')">${bi("Info","Információ")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteGenericResource('pianos','${r.id}')">${bi("Delete","Törlés")}</button>`:""}</td></tr>`).join("")||`<tr><td colspan="7" class="muted">${bi("No matching pianos","Nincs találat")}</td></tr>`}</tbody></table></div>${pagination}</div>`;
 const input=document.getElementById("pianoSearchInput");if(input&&!isCompactViewport()){input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);}
 bindPianoFilterDebounce();
 requestAnimationFrame(setupPianoTableScroll);
 applyLanguageToDOM();
}
async function pianoInfo(id){
 let p;try{p=await api(`/api/pianos/${encodeURIComponent(id)}`);}catch(_error){return showError(bi('Piano not found.','A zongora nem található.'));}
 const owner={name:p.owner_name};
 $("#modal").classList.remove("hidden");$("#modalTitle").textContent=bi("Piano information","Zongora információ");
 const importInfo=isAdmin()?`<details class="piano-import-info"><summary>${bi("Import information","Importálási információk")}</summary><p><b>${bi("External reference","Külső referencia")}:</b> ${htmlText(p.external_reference||'—')}</p><p><b>${bi("Import source","Importforrás")}:</b> ${htmlText(p.import_source||'—')}</p><p><b>${bi("Import batch","Importköteg")}:</b> ${htmlText(p.import_batch_id||'—')}</p><p><b>${bi("Owner resolution","Tulajdonosi feloldás")}:</b> ${htmlText(p.owner_resolution||'—')}</p><p><b>${bi("Original description","Eredeti leírás")}:</b> ${htmlText(p.original_description||'—')}</p></details>`:'';
 $("#form").innerHTML=`<div class="work-card piano-info-card"><div class="piano-info-grid"><p><b>Piano ID:</b> ${htmlText(p.id)}</p><p><b>${bi("Client / owner","Ügyfél / tulajdonos")}:</b> ${htmlText(owner?.name||pianoOwnerLabel(p))}</p><p><b>${bi("Piano","Zongora")}:</b> ${htmlText(pianoDisplayName(p))}</p><p><b>${bi("Serial number","Gyári szám")}:</b> ${htmlText(p.serial_no||'—')}</p><p><b>${bi("Brand","Márka")}:</b> ${htmlText(p.brand||'—')}</p><p><b>${bi("Model","Modell")}:</b> ${htmlText(p.model||'—')}</p><p><b>${bi("Year","Év")}:</b> ${htmlText(p.year||'—')}</p><p><b>${bi("Location","Helyszín")}:</b> ${mapLink(p.location)||'—'}</p><p><b>${bi("Ownership","Tulajdon")}:</b> ${htmlText(p.ownership_type||p.ownership||'—')}</p><p><b>${bi("Estimated value","Becsült érték")}:</b> ${money(p.estimated_value)}</p><p class="full"><b>${bi("Notes","Megjegyzés")}:</b> ${htmlText(p.notes||'—')}</p></div>${importInfo}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Close","Bezár")}</button>${!p.owner_contact_id?`<button type="button" class="small" onclick="openPianoEdit('${p.id}',true)">${bi("Assign customer","Ügyfél hozzárendelése")}</button>`:''}<button type="button" onclick="openPianoEdit('${p.id}')">${bi("Edit","Szerkesztés")}</button></div>`;
 $("#form").onsubmit=e=>e.preventDefault();applyLanguageToDOM(document.getElementById('modal'));
}
async function openPianoEdit(id,focusOwner=false){
 let p;try{p=await api(`/api/pianos/${encodeURIComponent(id)}`);}catch(_error){return;}
 openForm('pianos',p);
 if(focusOwner)setTimeout(()=>document.getElementById('pianoOwnerFilter')?.focus(),150);
}
async function setupPianoFormBehavior(row){
 const ownerField=document.querySelector('[data-field="owner_contact_id"]');if(!ownerField)return;
 const current=String(row?.owner_contact_id||'');
 try{pianoOwnerContactsCache=await api('/api/contacts');}catch(e){pianoOwnerContactsCache=[];}
 ownerField.innerHTML=`<label>${bi("Owner client","Tulajdonos ügyfél")}</label><input id="pianoOwnerFilter" type="search" placeholder="${bi("Search by client name, email, phone or address","Keresés ügyfélnév, e-mail, telefon vagy cím alapján")}" oninput="filterPianoOwnerOptions(this.value)"><select id="pianoOwnerSelect" name="owner_contact_id"><option value="">${bi("No linked client / unidentified or company-owned","Nincs kapcsolt ügyfél / ismeretlen vagy céges")}</option>${pianoOwnerContactsCache.map(c=>`<option value="${htmlText(c.id)}" ${String(c.id)===current?'selected':''}>${htmlText(c.name||'')} · ${htmlText(c.address||c.email||c.phone||'')}</option>`).join('')}</select>`;
 const ownership=document.querySelector('[name="ownership_type"]');const ownerSelect=document.getElementById('pianoOwnerSelect');
 const sync=()=>{if(ownerSelect?.value&&ownership)ownership.value='Customer owned';};
 ownerSelect?.addEventListener('change',sync);
 ownership?.addEventListener('change',()=>{if(ownership.value!=='Customer owned'&&ownerSelect)ownerSelect.value='';});
}
function filterPianoOwnerOptions(value){
 const select=document.getElementById('pianoOwnerSelect');if(!select)return;
 const q=String(value||'').trim().toLowerCase();
 [...select.options].forEach((o,i)=>{if(i===0){o.hidden=false;return;}const c=pianoOwnerContactsCache.find(x=>String(x.id)===String(o.value));const hay=[c?.name,c?.email,c?.phone,c?.address].join(' ').toLowerCase();o.hidden=!!q&&!hay.includes(q);});
}

async function renderTable(key){
 let s=schemas[key],data=await api("/api/"+s.api);
 if(key==="contacts") return renderContactsTable(data);
 $("#"+key).innerHTML=`<div class="panel"><div class="toolbar"><h3>${splitBilingualText(s.title)}</h3><div><button class="small" onclick="exportTable('${key}')">Export CSV</button><button onclick="openForm('${key}')">+ ${bi("Add","Új")}</button></div></div><div class="table-wrap"><table><thead><tr>${s.cols.map(c=>`<th>${headerLabel(key,c)}</th>`).join("")}<th>${bi("Actions","Műveletek")}</th></tr></thead><tbody>${data.map(r=>`<tr>${s.cols.map(c=>`<td>${cellValue(key,c,r)}</td>`).join("")}<td><button class="small" onclick='openForm("${key}",${esc(r)})'>${bi("Edit","Szerkesztés")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteGenericResource('${key}','${r.id}')">${bi("Delete","Törlés")}</button>`:""}</td></tr>`).join("")}</tbody></table></div></div>`
}
function boolVal(v){ return v===1 || v==="1" || v===true || String(v||"").toLowerCase()==="yes"; }
function customerStatusCode(c){
 const has=boolVal(c.has_piano) || Number(c._ownedPianoCount||0)>0;
 const interested=boolVal(c.interested_buying);
 if(has && interested) return "OWNER_BUYER";
 if(has) return "OWNER";
 if(interested) return "BUYER";
 return "GENERAL";
}
function customerStatusIcon(c){
 const code=customerStatusCode(c);
 return ({OWNER:"🎹",BUYER:"🛒",OWNER_BUYER:"🎹🛒",GENERAL:"👤"})[code]||"👤";
}
function customerStatusTitle(c){
 const code=customerStatusCode(c);
 return ({OWNER:tr("ownerClient"),BUYER:tr("buyerLead"),OWNER_BUYER:tr("ownerBuyerLead"),GENERAL:tr("generalContact")})[code]||tr("generalContact");
}
function customerStatusOptions(){
 const opts=[
   ["ALL",bi("All","Összes")],
   ["OWNER",`🎹 ${tr("ownerClient")}`],
   ["BUYER",`🛒 ${tr("buyerLead")}`],
   ["OWNER_BUYER",`🎹🛒 ${tr("ownerBuyerLead")}`],
   ["GENERAL",`👤 ${tr("generalContact")}`]
 ];
 return opts.map(o=>`<option value="${o[0]}" ${currentClientStatusFilter===o[0]?"selected":""}>${o[1]}</option>`).join("");
}
function splitPhoneSegments(value){
 const raw=String(value||"").replace(/\r/g,"\n").trim();
 if(!raw) return [];
 return raw
  .replace(/\s+(?=(?:phone|mobile|cell(?:\s*#)?|fax|home|work|office)\s*[:#]?)/gi,"\n")
  .split(/\n|;|\|/)
  .map(x=>x.trim())
  .filter(Boolean);
}
function normalizeUsPhone(candidate){
 let digits=String(candidate||"").replace(/\D/g,"");
 if(digits.length===11 && digits.startsWith("1")) digits=digits.slice(1);
 if(digits.length!==10) return null;
 return {digits,display:`(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`,dial:`+1${digits}`};
}
function parseClientPhones(value){
 const segments=splitPhoneSegments(value);
 const mobile=[],phone=[],fax=[],seen=new Set();
 const numberPattern=/(?:\+?1[\s().-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/g;
 segments.forEach(segment=>{
  const lower=segment.toLowerCase();
  const type=/fax/.test(lower)?"fax":/(mobile|cell)/.test(lower)?"mobile":"phone";
  const matches=segment.match(numberPattern)||[];
  matches.forEach(match=>{
   const parsed=normalizeUsPhone(match);
   if(!parsed || seen.has(parsed.digits)) return;
   seen.add(parsed.digits);
   ({mobile,phone,fax})[type].push(parsed);
  });
 });
 const callable=[...mobile,...phone];
 return {mobile,phone,fax,callable,primary:callable[0]||null,additionalCount:Math.max(0,callable.length-1),raw:String(value||"").trim()};
}
function clientHasMissingCoreData(client){
 const phones=parseClientPhones(client.phone);
 return (!phones.primary && !String(client.email||"").trim()) || !String(client.address||"").trim();
}
function setClientPage(page){currentClientPage=Math.max(1,Number(page)||1);render("contacts");}
function toggleMissingClientData(){showOnlyMissingClientData=!showOnlyMissingClientData;currentClientPage=1;render("contacts");}
function clientPaginationHtml(page,totalPages,totalItems){
 if(totalPages<=1) return `<div class="client-pagination single"><span>${bi("Showing","Megjelenítve")} ${totalItems}</span></div>`;
 const pages=new Set([1,totalPages,page-2,page-1,page,page+1,page+2]);
 const valid=[...pages].filter(x=>x>=1&&x<=totalPages).sort((a,b)=>a-b);
 let last=0,buttons="";
 valid.forEach(p=>{if(last && p-last>1)buttons+=`<span class="page-gap">…</span>`;buttons+=`<button type="button" class="page-btn ${p===page?"active":""}" onclick="setClientPage(${p})">${p}</button>`;last=p;});
 return `<div class="client-pagination"><button type="button" class="page-btn" ${page<=1?"disabled":""} onclick="setClientPage(${page-1})">‹</button>${buttons}<button type="button" class="page-btn" ${page>=totalPages?"disabled":""} onclick="setClientPage(${page+1})">›</button><span class="page-summary">${bi("Page","Oldal")} ${page}/${totalPages} · ${totalItems} ${bi("clients","ügyfél")}</span></div>`;
}
function setupContactTableScroll(){
 const top=document.getElementById("contactsScrollTop"),bottom=document.getElementById("contactsTableWrap"),spacer=top?.querySelector(".table-scroll-spacer"),table=bottom?.querySelector("table");
 if(!top||!bottom||!spacer||!table) return;
 const syncWidth=()=>{spacer.style.width=`${table.scrollWidth}px`;top.classList.toggle("hidden-scroll",table.scrollWidth<=bottom.clientWidth+1);};
 let syncing=false;
 top.addEventListener("scroll",()=>{if(syncing)return;syncing=true;requestAnimationFrame(()=>{bottom.scrollLeft=top.scrollLeft;syncing=false;});},{passive:true});
 bottom.addEventListener("scroll",()=>{if(syncing)return;syncing=true;requestAnimationFrame(()=>{top.scrollLeft=bottom.scrollLeft;syncing=false;});},{passive:true});
 syncWidth();
 if(window.ResizeObserver){const ro=new ResizeObserver(syncWidth);ro.observe(table);ro.observe(bottom);}
}
function scheduleContactsRender(){
 clearTimeout(contactsRenderTimer);
 contactsRenderTimer=setTimeout(()=>render("contacts",{noHistory:true}),275);
}

async function renderContactsTable(data){
 const pianos=await api("/api/pianos").catch(()=>[]);
 const previousSearch=currentClientSearch;
 const q=previousSearch.trim().toLowerCase();
 const pianosByOwner=new Map();
 pianos.forEach(p=>{const key=String(p.owner_contact_id||"");if(!key)return;const rows=pianosByOwner.get(key)||[];rows.push(p);pianosByOwner.set(key,rows);});
 const enriched=data.map(c=>({...c,_ownedPianoCount:(pianosByOwner.get(String(c.id))||[]).length}));
 const missingCount=enriched.filter(clientHasMissingCoreData).length;
 const filtered=enriched.filter(c=>{
   if(showOnlyMissingClientData && !clientHasMissingCoreData(c)) return false;
   if(currentClientStatusFilter!=="ALL" && customerStatusCode(c)!==currentClientStatusFilter) return false;
   if(q.length<3) return true;
   const owned=pianosByOwner.get(String(c.id))||[];
   const hay=[c.name,c.company,c.email,c.phone,c.address,c.notes,customerStatusTitle(c),...owned.flatMap(p=>[p.brand,p.model,p.display_name,p.serial_no])].join(" ").toLowerCase();
   return hay.includes(q);
 });
 const totalPages=Math.max(1,Math.ceil(filtered.length/CLIENTS_PER_PAGE));
 currentClientPage=Math.min(Math.max(1,currentClientPage),totalPages);
 const start=(currentClientPage-1)*CLIENTS_PER_PAGE;
 const pageRows=filtered.slice(start,start+CLIENTS_PER_PAGE);
 const pagination=clientPaginationHtml(currentClientPage,totalPages,filtered.length);
 const s=schemas.contacts;
 $("#contacts").innerHTML=`<div class="panel"><div class="toolbar"><h3>${bi("Clients","Ügyfelek")}</h3><div class="toolbar-actions">${isAdmin()?`<button class="small" onclick="openClientImportModal()">${bi("Import Excel","Excel import")}</button>`:""}<button type="button" class="small missing-data-btn ${showOnlyMissingClientData?"active":""}" ${missingCount===0?"disabled":""} onclick="toggleMissingClientData()">${bi("Missing Data","Hiányzó adatok")} (${missingCount})</button><button class="small" onclick="exportTable('contacts')">Export CSV</button><button onclick="openForm('contacts')">+ ${bi("Add","Új")}</button></div></div><button id="clientFilterToggle" type="button" class="mobile-filter-toggle" aria-expanded="${mobileClientFiltersOpen}" onclick="toggleMobileFilterPanel('clientFilterPanel','clientFilterToggle','contacts')">⌕ ${bi("Filters","Szűrők")}</button><div id="clientFilterPanel" class="client-search client-search-grid mobile-collapsible-filter ${mobileClientFiltersOpen?"open":""}"><label>${tr("searchClients")}<input id="clientSearchInput" value="${previousSearch.replaceAll('"','&quot;')}" placeholder="${tr("searchPlaceholder")}" oninput="currentClientPage=1;render('contacts')"></label><label>${tr("customerStatus")}<select id="clientStatusFilter" onchange="currentClientStatusFilter=this.value;currentClientPage=1;render('contacts')">${customerStatusOptions()}</select></label></div><p class="muted customer-status-help">🎹 ${tr("ownerClient")} · 🛒 ${tr("buyerLead")} · 🎹🛒 ${tr("ownerBuyerLead")} · 👤 ${tr("generalContact")}</p>${pagination}<div class="table-scroll-top" id="contactsScrollTop" aria-label="${bi("Horizontal table scroll","Vízszintes táblázatgörgetés")}"><div class="table-scroll-spacer"></div></div><div class="table-wrap contacts-table-wrap" id="contactsTableWrap"><table><thead><tr>${s.cols.map(c=>`<th>${headerLabel('contacts',c)}</th>`).join("")}<th>${bi("Actions","Műveletek")}</th></tr></thead><tbody>${pageRows.map(r=>`<tr>${s.cols.map(c=>`<td>${cellValue('contacts',c,r)}</td>`).join("")}<td><button class="small" onclick="clientProfile('${r.id}')">${bi("Profile","Adatlap")}</button><button class="small" onclick='openForm("contacts",${esc(r)})'>${bi("Edit","Szerkesztés")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteGenericResource('contacts','${r.id}')">${bi("Delete","Törlés")}</button>`:""}</td></tr>`).join("")||`<tr><td colspan="${s.cols.length+1}" class="muted">${bi("No matching clients","Nincs találat")}</td></tr>`}</tbody></table></div>${pagination}</div>`;
 const input=document.getElementById("clientSearchInput");
 if(input){input.oninput=()=>{currentClientSearch=input.value;currentClientPage=1;scheduleContactsRender();};}
 if(input&&!isCompactViewport()){ input.focus({preventScroll:true}); input.setSelectionRange(input.value.length,input.value.length); }
 requestAnimationFrame(setupContactTableScroll);
}
async function deleteGenericResource(key,id){
 if(!isSuperadmin()) return showError("PERMISSION_DENIED");
 const s=schemas[key];
 if(!s || !await appConfirm(bi("Delete this item?","Töröljük ezt a tételt?"),{type:"error",confirmText:bi("Delete","Törlés")})) return;
 try{await api(`/api/${s.api}/${encodeURIComponent(id)}`,{method:"DELETE"}); await render(key);}catch(err){showError(err)}
}
function htmlText(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
function phoneLink(value){
 const parsed=parseClientPhones(value);
 if(!parsed.primary) return "";
 const extra=parsed.additionalCount?`<span class="phone-more" title="${bi("Additional phone numbers are available in the client profile","További telefonszámok az ügyfél adatlapon találhatók")}">+${parsed.additionalCount}</span>`:"";
 return `<span class="phone-summary"><a class="contact-link phone-link" href="tel:${parsed.primary.dial}">${htmlText(parsed.primary.display)}</a>${extra}</span>`;
}
function phoneProfileHtml(value){
 const parsed=parseClientPhones(value);
 const lines=[];
 if(parsed.primary) lines.push(`<p><b>${bi("Primary phone","Elsődleges telefonszám")}:</b> <a class="contact-link phone-link" href="tel:${parsed.primary.dial}">${htmlText(parsed.primary.display)}</a></p>`);
 parsed.mobile.slice(parsed.primary&&parsed.mobile[0]?.digits===parsed.primary.digits?1:0).forEach(x=>lines.push(`<p><b>${bi("Mobile","Mobil")}:</b> <a class="contact-link phone-link" href="tel:${x.dial}">${htmlText(x.display)}</a></p>`));
 parsed.phone.filter(x=>!parsed.primary||x.digits!==parsed.primary.digits).forEach(x=>lines.push(`<p><b>${bi("Additional phone","További telefonszám")}:</b> <a class="contact-link phone-link" href="tel:${x.dial}">${htmlText(x.display)}</a></p>`));
 parsed.fax.forEach(x=>lines.push(`<p><b>${bi("Fax","Fax")}:</b> ${htmlText(x.display)}</p>`));
 if(parsed.raw) lines.push(`<details class="original-phone-data"><summary>${bi("Original imported phone data","Eredeti importált telefonadat")}</summary><pre>${htmlText(parsed.raw)}</pre></details>`);
 return lines.join("")||`<p><b>${bi("Phone","Telefon")}:</b> —</p>`;
}
function emailLink(value){const raw=String(value||"").trim();if(!raw)return "";return `<a class="contact-link email-link" href="mailto:${encodeURIComponent(raw)}">${htmlText(raw)}</a>`;}
function mapLink(value){const raw=String(value||"").trim();if(!raw)return "";return `<a class="contact-link map-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(raw)}" target="_blank" rel="noopener noreferrer">${htmlText(raw)}</a>`;}
function cellValue(key,c,r){
 if(key==="contacts" && c==="customer_status_icon") return `<span class="customer-status-icon" title="${customerStatusTitle(r)}">${customerStatusIcon(r)}</span>`;
 if(key==="contacts" && c==="phone") return phoneLink(r[c]);
 if(key==="contacts" && c==="email") return emailLink(r[c]);
 if(key==="contacts" && c==="address") return mapLink(r[c]);
 if((c.includes("amount")||c.includes("value"))) return money(r[c]);
 if(c==="stored_path" && r[c]) return `<a href="${r[c]}" target="_blank">Download / Letöltés</a>`;
 return r[c]??"";
}
async function clientProfile(id){
 let p=await api(`/api/client-profile/${id}`);
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=bi("Client profile","Ügyfélprofil");
 const interest=boolVal(p.client.interested_buying) ? `<h3>${bi("Purchase Interest","Vásárlási érdeklődés")}</h3><p><b>${bi("Brand","Márka")}:</b> ${p.client.interest_brand||""}</p><p><b>${bi("Model","Típus")}:</b> ${p.client.interest_model||""}</p><p><b>${bi("Budget","Keretösszeg")}:</b> ${money(p.client.interest_budget||0)}</p><p><b>${bi("Timeline","Időzítés")}:</b> ${p.client.interest_timeline||""}</p><p><b>${bi("Notes","Megjegyzés")}:</b> ${p.client.interest_notes||""}</p>` : "";
 $("#form").innerHTML=`<div class="work-card"><h4><span class="customer-status-icon">${customerStatusIcon({...p.client,_ownedPianoCount:p.pianos.length})}</span> ${p.client.name} · ${p.client.id}</h4>${phoneProfileHtml(p.client.phone)}<p><b>${bi("Email","E-mail")}:</b> ${emailLink(p.client.email)}</p><p><b>${bi("Address","Cím")}:</b> ${mapLink(p.client.address)}</p><p><b>${bi("Billing address","Számlázási cím")}:</b> ${p.client.billing_address||"—"}</p><p><b>${bi("Last visit","Utolsó látogatás")}:</b> ${p.lastVisit||""}</p><p><b>${bi("Last job","Legutóbbi munka")}:</b> ${p.lastJob||""}</p>${interest}<h3>${bi("Pianos","Zongorák")}</h3>${p.pianos.map(x=>`<p>${x.display_name||`${x.brand||""} ${x.model||""}`} · ${x.serial_no||""} · ${x.ownership_type||x.ownership||"Customer owned"}</p>`).join("")||`<p>${bi("No pianos linked","Nincs kapcsolt zongora")}</p>`}<div id="clientPianoProfileTools"></div><h3>${bi("Jobs","Munkák")}</h3>${p.jobs.map(x=>`<p>${x.start_time} · ${x.title} · ${x.assigned_to} · ${x.status}</p>`).join("")||`<p>${bi("No jobs","Nincs munka")}</p>`}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Close","Bezár")}</button></div>`;
 $("#form").onsubmit=e=>e.preventDefault();
 renderClientPianoProfileTools(p.client.id);
}
async function addPianoToClient(clientId){
 const form=document.getElementById("pianoAddForm");
 const body=Object.fromEntries(new FormData(form));
 if(!(body.brand||body.model)){appAlert(bi("Enter at least a brand or model.","Legalább márkát vagy típust adj meg."),"warning");return}
 try{await api(`/api/contacts/${clientId}/pianos`,{method:"POST",body:JSON.stringify(body)});await clientProfile(clientId)}catch(err){showError(err)}
}

let currentClientImportAnalysis=null;
function clientImportReasonLabel(code){
 const labels={MISSING_CLIENT_NAME:bi('Missing client name','Hiányzó ügyfélnév'),NOT_READY:bi('Review Status is not Ready','A Review Status nem Ready'),MISSING_EXTERNAL_REFERENCE:bi('Missing external reference','Hiányzó külső referencia'),DUPLICATE_REFERENCE_IN_FILE:bi('Duplicate external reference in file','Duplikált külső referencia a fájlban'),EXTERNAL_REFERENCE_MATCH:bi('Already imported external reference','Már importált külső referencia'),EMAIL_MATCH:bi('Matching email in ERP','Egyező e-mail az ERP-ben'),PHONE_MATCH:bi('Matching phone in ERP','Egyező telefonszám az ERP-ben'),NAME_ADDRESS_MATCH:bi('Matching name and address in ERP','Egyező név és cím az ERP-ben')};
 return labels[code]||code||'';
}
function clientImportCategoryLabel(code){return ({NEW:bi('New client','Új ügyfél'),ALREADY_IMPORTED:bi('Already imported','Már importálva'),POSSIBLE_DUPLICATE:bi('Possible duplicate','Lehetséges duplikáció'),INVALID:bi('Invalid row','Hibás sor')})[code]||code;}
function openClientImportModal(){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 currentClientImportAnalysis=null;
 $('#modal').classList.remove('hidden');
 $('#modalTitle').textContent=bi('Import clients from Excel','Ügyfelek importálása Excelből');
 $('#form').innerHTML=`<div class="client-import-intro"><p>${bi('Select the cleaned XLSX workbook. This step only analyzes the Import Ready sheet and does not save clients.','Válaszd ki a tisztított XLSX munkafüzetet. Ez a lépés csak elemzi az Import Ready lapot, ügyfelet még nem ment.')}</p><p class="muted">${bi('Only administrators and superadministrators can use bulk import.','A tömeges importot csak admin és szuperadmin használhatja.')}</p></div><div class="form-grid"><div class="field full"><label>${bi('Excel file (.xlsx)','Excel-fájl (.xlsx)')}</label><input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></div></div><div id="clientImportResult"></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button>${bi('Analyze file','Fájl elemzése')}</button></div>`;
 $('#form').onsubmit=analyzeClientImport;
 applyLanguageToDOM(document.getElementById('modal'));
}
async function analyzeClientImport(e){
 e.preventDefault();
 const file=e.target.querySelector('input[name="file"]')?.files?.[0];
 if(!file)return showError(bi('Select an XLSX file.','Válassz ki egy XLSX-fájlt.'));
 const button=e.target.querySelector('button[type="submit"],.actions button:last-child');
 if(button){button.disabled=true;button.textContent=bi('Analyzing…','Elemzés…');}
 try{
  const fd=new FormData();fd.append('file',file,file.name);
  currentClientImportAnalysis=await api('/api/imports/clients/analyze',{method:'POST',body:fd});
  renderClientImportSummary(currentClientImportAnalysis);
 }catch(err){
  const msg=String(err.message||'');
  const friendly=msg==='IMPORT_READY_SHEET_MISSING'?bi('The workbook does not contain an Import Ready sheet.','A munkafüzet nem tartalmaz Import Ready lapot.'):msg==='IMPORT_READY_EMPTY'?bi('The Import Ready sheet is empty.','Az Import Ready lap üres.'):msg==='INVALID_EXCEL_FILE'?bi('Only XLSX files are accepted.','Csak XLSX-fájl tölthető fel.'):msg==='FILE_ALREADY_IMPORTED'?bi('This file has already been imported.','Ezt a fájlt már korábban importálták.'):msg;
  showError(friendly);
 }finally{if(button){button.disabled=false;button.textContent=bi('Analyze file','Fájl elemzése');}}
}
function renderClientImportSummary(data){
 const box=document.getElementById('clientImportResult');if(!box)return;
 const s=data.summary;
 const cards=[['totalRows',bi('Rows found','Talált sorok')],['newClients',bi('New clients','Új ügyfelek')],['alreadyImported',bi('Already imported','Már importálva')],['possibleDuplicates',bi('Possible duplicates','Lehetséges duplikációk')],['missingDataClients',bi('Missing-data clients','Hiányos adatú ügyfelek')],['invalidRows',bi('Invalid rows','Hibás sorok')]];
 box.innerHTML=`<div class="import-summary"><div class="import-file"><b>${bi('File','Fájl')}:</b> ${htmlText(s.filename||'')}<br><span class="muted">${bi('Preview batch','Előnézeti köteg')}: ${htmlText(data.batchId||'')}</span></div><div class="import-summary-grid">${cards.map(([k,l])=>`<button type="button" class="import-stat ${k}" onclick="showClientImportCategory('${k}')"><span>${l}</span><strong>${Number(s[k]||0)}</strong></button>`).join('')}</div><div id="clientImportCategory"></div><div class="import-preview-note">${bi('The analysis is complete. Only NEW clients will be imported; possible duplicates and invalid rows will be skipped.','Az elemzés elkészült. Csak az ÚJ ügyfelek kerülnek importálásra; a lehetséges duplikációkat és hibás sorokat a rendszer kihagyja.')}</div><div class="actions import-final-actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="button" id="clientImportCommitBtn" onclick="commitClientImport()" ${Number(s.newClients||0)<1?'disabled':''}>${bi(`Import ${Number(s.newClients||0)} clients`,`${Number(s.newClients||0)} ügyfél importálása`)}</button></div></div>`;
 showClientImportCategory('newClients');
}

async function commitClientImport(){
 const data=currentClientImportAnalysis;if(!data?.batchId)return showError(bi('Analyze the file before importing.','Importálás előtt elemezd a fájlt.'));
 const summary=data.summary||{};const count=Number(summary.newClients||0);const missing=Number(summary.missingDataClients||0);
 if(count<1)return showError(bi('There are no new clients to import.','Nincs importálható új ügyfél.'));
 const ok=await appConfirm(bi(`Import ${count} clients?\n\n${missing} clients will be imported with missing basic data. Possible duplicates and invalid rows will be skipped.`,`Importálod a(z) ${count} ügyfelet?\n\n${missing} ügyfél hiányos alapadatokkal kerül be. A lehetséges duplikációkat és hibás sorokat a rendszer kihagyja.`),{confirmText:bi("Import clients","Ügyfelek importálása")});
 if(!ok)return;
 const button=document.getElementById('clientImportCommitBtn');
 if(button){button.disabled=true;button.textContent=bi('Importing…','Importálás…');}
 try{
  const result=await api(`/api/imports/clients/${encodeURIComponent(data.batchId)}/commit`,{method:'POST',body:JSON.stringify({confirm:true})});
  currentClientImportAnalysis={...data,completed:true,importResult:result};
  renderClientImportCompleted(result);
  await render('contacts');
 }catch(err){
  const code=String(err.message||'');
  const friendly=code==='IMPORT_BATCH_ALREADY_COMPLETED'?bi('This preview has already been imported.','Ezt az előnézetet már importálták.'):code==='IMPORT_BATCH_NOT_READY'?bi('This import preview is no longer ready. Analyze the file again.','Ez az importelőnézet már nem használható. Elemezd újra a fájlt.'):code==='IMPORT_PREVIEW_DATA_MISSING'?bi('The preview data is missing. Analyze the file again.','Az előnézeti adatok hiányoznak. Elemezd újra a fájlt.'):code==='CLIENT_IMPORT_FAILED'?bi('The import failed. No partial client import was kept.','Az importálás sikertelen. Részleges ügyfélimport nem maradt az adatbázisban.'):code;
  showError(friendly);
  if(button){button.disabled=false;button.textContent=bi(`Import ${count} clients`,`${count} ügyfél importálása`);}
 }
}
function renderClientImportCompleted(result){
 const box=document.getElementById('clientImportResult');if(!box)return;
 box.innerHTML=`<div class="import-completed"><div class="import-completed-icon">✓</div><h3>${bi('Import completed successfully','Az importálás sikeresen befejeződött')}</h3><div class="import-summary-grid"><div class="import-stat newClients"><span>${bi('Imported clients','Importált ügyfelek')}</span><strong>${Number(result.importedClients||0)}</strong></div><div class="import-stat missingDataClients"><span>${bi('Imported with missing data','Hiányos adatokkal importálva')}</span><strong>${Number(result.missingDataClients||0)}</strong></div><div class="import-stat possibleDuplicates"><span>${bi('Skipped duplicates','Kihagyott duplikációk')}</span><strong>${Number(result.skippedDuplicates||0)}</strong></div><div class="import-stat invalidRows"><span>${bi('Failed rows','Hibás sorok')}</span><strong>${Number(result.failedRows||0)}</strong></div></div><p class="muted">${bi('The client list has been refreshed. The same completed file cannot be imported again.','Az ügyféllista frissült. Ugyanez a befejezett fájl nem importálható újra.')}</p><div class="actions"><button type="button" onclick="closeModal();render('contacts')">${bi('View clients','Ügyfelek megtekintése')}</button></div></div>`;
}
function showClientImportCategory(kind){
 const data=currentClientImportAnalysis;if(!data)return;
 const map={newClients:r=>r.category==='NEW',alreadyImported:r=>r.category==='ALREADY_IMPORTED',possibleDuplicates:r=>r.category==='POSSIBLE_DUPLICATE',invalidRows:r=>r.category==='INVALID',missingDataClients:r=>r.category==='NEW'&&r.hasMissingData,totalRows:()=>true};
 const rows=data.records.filter(map[kind]||map.totalRows);
 const box=document.getElementById('clientImportCategory');if(!box)return;
 box.innerHTML=`<div class="import-category-head"><b>${bi('Preview records','Előnézeti rekordok')}</b><span>${rows.length}</span></div><div class="table-wrap import-preview-table"><table><thead><tr><th>${bi('Row','Sor')}</th><th>${bi('Client','Ügyfél')}</th><th>${bi('Phone','Telefon')}</th><th>${bi('Email','E-mail')}</th><th>${bi('Address','Cím')}</th><th>${bi('External reference','Külső referencia')}</th><th>${bi('Category','Kategória')}</th><th>${bi('Reason','Indok')}</th></tr></thead><tbody>${rows.slice(0,250).map(r=>`<tr><td>${r.rowNumber||''}</td><td>${htmlText(r.name||'')}</td><td>${htmlText(r.phone||'')}</td><td>${htmlText(r.email||'')}</td><td>${htmlText(r.serviceAddress||'')}</td><td>${htmlText(r.externalReference||'')}</td><td>${clientImportCategoryLabel(r.category)}</td><td>${clientImportReasonLabel(r.reason)}${r.missingFields?.length?`<div class="muted">${bi('Missing','Hiányzik')}: ${r.missingFields.map(x=>x==='Phone or Email'?bi('Phone or email','Telefon vagy e-mail'):bi('Address','Cím')).join(', ')}</div>`:''}${r.match?`<div class="muted">${bi('ERP match','ERP-egyezés')}: ${htmlText(r.match.name||r.match.id||'')}</div>`:''}</td></tr>`).join('')||`<tr><td colspan="8" class="muted">${bi('No records in this category.','Nincs rekord ebben a kategóriában.')}</td></tr>`}</tbody></table></div>${rows.length>250?`<p class="muted">${bi('Showing the first 250 records.','Az első 250 rekord látható.')}</p>`:''}`;
}


let currentPianoImportAnalysis=null;
function pianoImportReasonLabel(code){
 const labels={IMPORT_DECISION_NOT_IMPORT:bi('Import Decision is not Import','Az Import Decision nem Import'),MISSING_PIANO_EXTERNAL_REFERENCE:bi('Missing piano external reference','Hiányzó zongora-külső referencia'),DUPLICATE_REFERENCE_IN_FILE:bi('Duplicate piano reference in file','Duplikált zongorareferencia a fájlban'),MISSING_PIANO_DESCRIPTION:bi('Missing piano description','Hiányzó zongoraleírás'),EXTERNAL_REFERENCE_MATCH:bi('Already imported piano reference','Már importált zongorareferencia'),UNIDENTIFIED_OWNER_ALLOWED:bi('Unidentified owner allowed','Ismeretlen tulajdonos engedélyezve'),CLIENT_EXTERNAL_REFERENCE_NOT_FOUND:bi('Client external reference not found','Az ügyfél külső referenciája nem található'),OWNER_DESCRIPTION_MATCH:bi('Similar piano already exists for this client','Hasonló zongora már létezik ennél az ügyfélnél')};return labels[code]||code||'';
}
function pianoImportCategoryLabel(code){return ({NEW_MATCHED:bi('New matched piano','Új, kapcsolt zongora'),NEW_UNIDENTIFIED_OWNER:bi('Unidentified owner','Ismeretlen tulajdonos'),ALREADY_IMPORTED:bi('Already imported','Már importálva'),CLIENT_NOT_FOUND:bi('Client not found','Ügyfél nem található'),POSSIBLE_DUPLICATE:bi('Possible duplicate','Lehetséges duplikáció'),INVALID:bi('Invalid row','Hibás sor')})[code]||code;}
function openPianoImportModal(){
 if(!isAdmin())return showError('PERMISSION_DENIED');currentPianoImportAnalysis=null;$('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Import pianos from Excel','Zongorák importálása Excelből');
 $('#form').innerHTML=`<div class="client-import-intro"><p>${bi('Select the finalized workbook. The system analyzes only the Piano Import Ready sheet before saving anything.','Válaszd ki a végleges munkafüzetet. A rendszer mentés előtt kizárólag a Piano Import Ready lapot elemzi.')}</p><p class="muted">${bi('Clients are linked only by their external reference; names are never guessed.','Az ügyfelek kizárólag külső referencia alapján kapcsolódnak; név alapján nincs találgatás.')}</p></div><div class="form-grid"><div class="field full"><label>${bi('Excel file (.xlsx)','Excel-fájl (.xlsx)')}</label><input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></div></div><div id="pianoImportResult"></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button>${bi('Analyze file','Fájl elemzése')}</button></div>`;
 $('#form').onsubmit=analyzePianoImport;applyLanguageToDOM(document.getElementById('modal'));
}
async function analyzePianoImport(e){
 e.preventDefault();const file=e.target.querySelector('input[name="file"]')?.files?.[0];if(!file)return showError(bi('Select an XLSX file.','Válassz ki egy XLSX-fájlt.'));
 const button=e.target.querySelector('button[type="submit"],.actions button:last-child');if(button){button.disabled=true;button.textContent=bi('Analyzing…','Elemzés…');}
 try{const fd=new FormData();fd.append('file',file,file.name);currentPianoImportAnalysis=await api('/api/imports/pianos/analyze',{method:'POST',body:fd});renderPianoImportSummary(currentPianoImportAnalysis);}catch(err){const code=String(err.message||'');const friendly=code==='IMPORT_READY_SHEET_MISSING'?bi('The workbook does not contain a Piano Import Ready sheet.','A munkafüzet nem tartalmaz Piano Import Ready lapot.'):code==='PIANO_IMPORT_READY_EMPTY'?bi('The Piano Import Ready sheet is empty.','A Piano Import Ready lap üres.'):code==='FILE_ALREADY_IMPORTED'?bi('This piano file has already been imported.','Ezt a zongorafájlt már korábban importálták.'):code;showError(friendly);}finally{if(button){button.disabled=false;button.textContent=bi('Analyze file','Fájl elemzése');}}
}
function renderPianoImportSummary(data){
 const box=document.getElementById('pianoImportResult');if(!box)return;const s=data.summary;const cards=[['totalRows',bi('Rows found','Talált sorok')],['newMatched',bi('New matched','Új, kapcsolt')],['newUnidentifiedOwner',bi('Unidentified owner','Ismeretlen tulajdonos')],['alreadyImported',bi('Already imported','Már importálva')],['clientNotFound',bi('Client not found','Ügyfél nem található')],['possibleDuplicates',bi('Possible duplicates','Lehetséges duplikációk')],['invalidRows',bi('Invalid rows','Hibás sorok')],['clientsReceivingPianos',bi('Clients receiving pianos','Zongorát kapó ügyfelek')],['clientsChangingToOwner',bi('Changing to Owner','Owner státuszra vált')]];
 box.innerHTML=`<div class="import-summary"><div class="import-file"><b>${bi('File','Fájl')}:</b> ${htmlText(s.filename||'')}<br><span class="muted">${bi('Preview batch','Előnézeti köteg')}: ${htmlText(data.batchId||'')}</span></div><div class="import-summary-grid">${cards.map(([k,l])=>`<button type="button" class="import-stat ${k}" onclick="showPianoImportCategory('${k}')"><span>${l}</span><strong>${Number(s[k]||0)}</strong></button>`).join('')}</div><div id="pianoImportCategory"></div>${data.multiplePianoClients?.length?`<div class="import-preview-note"><b>${bi('Clients receiving multiple pianos','Több zongorát kapó ügyfelek')}:</b> ${data.multiplePianoClients.map(x=>`${htmlText(x.name)} (${x.count})`).join(', ')}</div>`:''}<div class="import-preview-note">${bi('Only new matched and explicitly unidentified-owner pianos will be imported. Existing, duplicate, missing-client and invalid records will be skipped.','Csak az új kapcsolt és kifejezetten ismeretlen tulajdonosú zongorák kerülnek importálásra. A meglévő, duplikált, ügyfél nélküli és hibás rekordokat a rendszer kihagyja.')}</div><div class="actions import-final-actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="button" id="pianoImportCommitBtn" onclick="commitPianoImport()" ${Number(s.newMatched||0)+Number(s.newUnidentifiedOwner||0)<1?'disabled':''}>${bi(`Import ${Number(s.newMatched||0)+Number(s.newUnidentifiedOwner||0)} pianos`,`${Number(s.newMatched||0)+Number(s.newUnidentifiedOwner||0)} zongora importálása`)}</button></div></div>`;showPianoImportCategory('newMatched');
}
function showPianoImportCategory(kind){
 const data=currentPianoImportAnalysis;if(!data)return;const map={newMatched:r=>r.category==='NEW_MATCHED',newUnidentifiedOwner:r=>r.category==='NEW_UNIDENTIFIED_OWNER',alreadyImported:r=>r.category==='ALREADY_IMPORTED',clientNotFound:r=>r.category==='CLIENT_NOT_FOUND',possibleDuplicates:r=>r.category==='POSSIBLE_DUPLICATE',invalidRows:r=>r.category==='INVALID',totalRows:()=>true,clientsReceivingPianos:r=>r.category==='NEW_MATCHED',clientsChangingToOwner:r=>r.category==='NEW_MATCHED'&&r.client&&!Number(r.client.has_piano||0)};const rows=data.records.filter(map[kind]||map.totalRows);const box=document.getElementById('pianoImportCategory');if(!box)return;
 box.innerHTML=`<div class="import-category-head"><b>${bi('Preview records','Előnézeti rekordok')}</b><span>${rows.length}</span></div><div class="table-wrap import-preview-table"><table><thead><tr><th>${bi('Row','Sor')}</th><th>${bi('Piano reference','Zongorareferencia')}</th><th>${bi('Client','Ügyfél')}</th><th>${bi('Description','Leírás')}</th><th>${bi('Location','Helyszín')}</th><th>${bi('Category','Kategória')}</th><th>${bi('Reason','Indok')}</th></tr></thead><tbody>${rows.slice(0,250).map(r=>`<tr><td>${r.rowNumber||''}</td><td>${htmlText(r.externalReference||'')}</td><td>${htmlText(r.clientName||r.client?.name||'')}</td><td>${htmlText(r.description||'')}</td><td>${htmlText(r.location||'')}</td><td>${pianoImportCategoryLabel(r.category)}</td><td>${pianoImportReasonLabel(r.reason)}${r.match?`<div class="muted">${bi('ERP match','ERP-egyezés')}: ${htmlText(r.match.display_name||r.match.id||'')}</div>`:''}</td></tr>`).join('')||`<tr><td colspan="7" class="muted">${bi('No records in this category.','Nincs rekord ebben a kategóriában.')}</td></tr>`}</tbody></table></div>`;
}
async function commitPianoImport(){
 const data=currentPianoImportAnalysis;if(!data?.batchId)return showError(bi('Analyze the file before importing.','Importálás előtt elemezd a fájlt.'));const s=data.summary||{};const count=Number(s.newMatched||0)+Number(s.newUnidentifiedOwner||0);if(count<1)return showError(bi('There are no new pianos to import.','Nincs importálható új zongora.'));
 const ok=await appConfirm(bi(`Import ${count} pianos?\n\n${Number(s.clientsChangingToOwner||0)} clients will change to Owner status. ${Number(s.newUnidentifiedOwner||0)} pianos will have an unidentified owner.`,`Importálod a(z) ${count} zongorát?\n\n${Number(s.clientsChangingToOwner||0)} ügyfél Owner státuszra vált. ${Number(s.newUnidentifiedOwner||0)} zongora ismeretlen tulajdonossal kerül be.`),{confirmText:bi("Import pianos","Zongorák importálása")});if(!ok)return;
 const button=document.getElementById('pianoImportCommitBtn');if(button){button.disabled=true;button.textContent=bi('Importing…','Importálás…');}
 try{const result=await api(`/api/imports/pianos/${encodeURIComponent(data.batchId)}/commit`,{method:'POST',body:JSON.stringify({confirm:true})});renderPianoImportCompleted(result);await renderPianos();}catch(err){const code=String(err.message||'');const friendly=code==='PIANO_IMPORT_FAILED'?bi('The piano import failed. No partial import was kept.','A zongoraimport sikertelen. Részleges import nem maradt az adatbázisban.'):code;showError(friendly);if(button){button.disabled=false;button.textContent=bi(`Import ${count} pianos`,`${count} zongora importálása`);}}
}
function renderPianoImportCompleted(result){const box=document.getElementById('pianoImportResult');if(!box)return;box.innerHTML=`<div class="import-completed"><div class="import-completed-icon">✓</div><h3>${bi('Piano import completed','A zongoraimport befejeződött')}</h3><div class="import-summary-grid"><div class="import-stat newClients"><span>${bi('Imported pianos','Importált zongorák')}</span><strong>${Number(result.importedPianos||0)}</strong></div><div class="import-stat"><span>${bi('Clients updated as owners','Owner státuszra frissített ügyfelek')}</span><strong>${Number(result.updatedClients||0)}</strong></div><div class="import-stat missingDataClients"><span>${bi('Unidentified owner','Ismeretlen tulajdonos')}</span><strong>${Number(result.unidentifiedOwnerPianos||0)}</strong></div><div class="import-stat possibleDuplicates"><span>${bi('Skipped duplicates','Kihagyott duplikációk')}</span><strong>${Number(result.skippedAlreadyImported||0)+Number(result.skippedPossibleDuplicates||0)}</strong></div><div class="import-stat"><span>${bi('Client not found','Ügyfél nem található')}</span><strong>${Number(result.clientNotFound||0)}</strong></div><div class="import-stat invalidRows"><span>${bi('Invalid/failed rows','Hibás sorok')}</span><strong>${Number(result.invalidRows||0)+Number(result.failedRows||0)}</strong></div></div><div class="actions"><button type="button" onclick="closeModal();render('pianos')">${bi('View pianos','Zongorák megtekintése')}</button></div></div>`;}

function openForm(key,row=null){let s=schemas[key];$("#modal").classList.remove("hidden");$("#modalTitle").textContent=(row?bi("Edit","Szerkesztés")+" ":bi("Add","Új")+" ")+splitBilingualText(s.title);const pianoId=key==="pianos"&&row?`<div class="field"><label>Piano ID</label><input value="${htmlText(row.id||'')}" readonly></div>`:"";$("#form").innerHTML=`<div class="form-grid">${pianoId}${s.fields.map(f=>field(f,row?.[f[0]])).join("")}</div><div id="contactPianoSection"></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Cancel","Mégse")}</button><button>${bi("Save","Mentés")}</button></div>`;
 if(key==="contacts") setupContactFormBehavior(row);
 if(key==="pianos") setupPianoFormBehavior(row);
 applyLanguageToDOM(document.getElementById("modal"));
 $("#form").onsubmit=async e=>{e.preventDefault();let body=Object.fromEntries(new FormData(e.target));s.fields.forEach(f=>{if(f[2]==="number")body[f[0]]=Number(body[f[0]]||0)});if(key==="contacts"){body.has_piano=Number(body.has_piano||0);body.interested_buying=Number(body.interested_buying||0);}try{let saved;
if(row) saved=await api(`/api/${s.api}/${row.id}`,{method:"PUT",body:JSON.stringify(body)}); else saved=await api(`/api/${s.api}`,{method:"POST",body:JSON.stringify(body)});
if(key==="contacts"){const clientId=(row&&row.id)||saved.id; const allPianoChecks=[...document.querySelectorAll('input[name="client_piano_ids"]')]; const ids=allPianoChecks.filter(x=>x.checked).map(x=>x.value); if(clientId && allPianoChecks.length) await api(`/api/contacts/${clientId}/pianos`,{method:"PUT",body:JSON.stringify({piano_ids:ids})});}
closeModal();render(key)}catch(err){showError(err)}}}
function field(f,val=""){let[name,label,type,opts]=f;const cls=`field field-${name} ${type==="textarea"?"full":""}`;if(type==="textarea")return `<div class="${cls}" data-field="${name}"><label>${label}</label><textarea name="${name}">${val||""}</textarea></div>`;if(type==="select")return `<div class="${cls}" data-field="${name}"><label>${label}</label><select name="${name}" onchange="if(typeof updateContactConditionalUI==='function')updateContactConditionalUI()">${opts.map(o=>{const value=Array.isArray(o)?o[0]:o;const text=Array.isArray(o)?o[1]:o;return `<option value="${value}" ${String(value)===String(val??"")?"selected":""}>${text}</option>`}).join("")}</select></div>`;return `<div class="${cls}" data-field="${name}"><label>${label}</label><input name="${name}" type="${type||"text"}" value="${val??""}"></div>`}

function updateContactConditionalUI(){
 const has=String(document.querySelector('[name="has_piano"]')?.value||"0")==="1";
 const interested=String(document.querySelector('[name="interested_buying"]')?.value||"0")==="1";
 ["interest_brand","interest_model","interest_budget","interest_timeline","interest_notes"].forEach(n=>{const el=document.querySelector(`[data-field="${n}"]`); if(el) el.classList.toggle("hidden",!interested);});
 const ps=document.getElementById("contactPianoSection"); if(ps) ps.classList.toggle("hidden",!has);
}
function setupContactFormBehavior(row){
 const has=document.querySelector('[name="has_piano"]');
 const interested=document.querySelector('[name="interested_buying"]');
 if(has) has.addEventListener("change",updateContactConditionalUI);
 if(interested) interested.addEventListener("change",updateContactConditionalUI);
 if(row?.id) attachClientPianoSelector(row);
 else { const ps=document.getElementById("contactPianoSection"); if(ps) ps.innerHTML=`<div class="panel inline-piano-form"><p class="muted">${bi("Save the client first, then edit the client to link or add owned pianos.","Előbb mentsd az ügyfelet, utána szerkesztésben lehet birtokolt zongorát kapcsolni vagy hozzáadni.")}</p></div>`; }
 updateContactConditionalUI();
}

async function renderClientPianoProfileTools(clientId){
 const box=document.getElementById("clientPianoProfileTools");
 if(!box) return;
 box.innerHTML=`<div class="inline-piano-form"><button type="button" class="small" onclick="showClientPianoManagement('${clientId}')">${bi("Manage owned pianos","Birtokolt zongorák kezelése")}</button></div>`;
}
async function showClientPianoManagement(clientId){
 const box=document.getElementById("clientPianoProfileTools");
 if(!box) return;
 box.innerHTML=`<div id="contactPianoSection"></div>`;
 await attachClientPianoSelector({id:clientId,has_piano:1});
 updateContactConditionalUI();
}

async function attachClientPianoSelector(row){
 const mount=document.getElementById("contactPianoSection");
 const container=document.createElement("div"); container.className="field full";
 container.innerHTML=`<label>${bi("Owned pianos","Birtokolt zongorák")}</label><div id="clientPianoSelector" class="multi-box"><p class="muted">${bi("Loading pianos...","Zongorák betöltése...")}</p></div>`;
 const target=mount || $("#form .form-grid"); if(target){ target.innerHTML=""; target.appendChild(container); }
 const renderAddForm = () => `<div class="inline-piano-form"><h4>+ ${bi("New owned piano","Új birtokolt zongora")}</h4><div class="form-grid"><div class="field"><label>${bi("Brand","Márka")}</label><input id="newPianoBrand"></div><div class="field"><label>${bi("Model","Típus")}</label><input id="newPianoModel"></div><div class="field"><label>${bi("Serial No.","Gyári szám")}</label><input id="newPianoSerial"></div><div class="field"><label>${bi("Location","Helyszín")}</label><input id="newPianoLocation"></div><div class="field"><label>${bi("Ownership","Tulajdon")}</label><select id="newPianoOwnership" onchange="document.getElementById('newPianoValueBox').classList.toggle('hidden',this.value!=='Company owned')"><option value="Customer owned">${bi("Customer owned","Ügyfél tulajdona")}</option><option value="Company owned">${bi("Company owned","Céges tulajdon")}</option></select></div><div class="field hidden" id="newPianoValueBox"><label>${bi("Estimated value","Becsült érték")}</label><input id="newPianoValue" type="number" value="0"></div></div><button type="button" class="small" onclick="addInlinePianoToClient('${row?.id||""}')">${bi("Save new piano","Új zongora mentése")}</button></div>`;
 if(!row?.id){$("#clientPianoSelector").innerHTML=`<p class="muted">${bi("Save the client first, then edit the client to choose pianos.","Új ügyfélnél előbb mentsd az ügyfelet, utána szerkesztésben választható zongora.")}</p>`;return}
 try{const all=await api("/api/pianos"); const selected=all.filter(p=>p.owner_contact_id===row.id).map(p=>p.id); $("#clientPianoSelector").innerHTML=`<p class="muted">${bi("Select existing pianos or add a new owned piano. Purchase interests are not added here.","Válassz meglévő zongorát, vagy adj hozzá új birtokolt zongorát. A vásárlási érdeklődés nem kerül ide.")}</p><div class="dropdown-checks">${all.map(p=>`<label class="check-row"><input type="checkbox" name="client_piano_ids" value="${p.id}" ${selected.includes(p.id)?"checked":""}> ${p.display_name||`${p.brand||""} ${p.model||""}`} · ${p.serial_no||""} · ${p.ownership_type||p.ownership||""} ${p.owner_name?`· ${p.owner_name}`:""}</label>`).join("") || `<p class='muted'>${bi("No pianos in database","Nincs zongora az adatbázisban")}</p>`}</div>${renderAddForm()}`;}catch(e){$("#clientPianoSelector").innerHTML=`<p class="muted">${bi("Could not load pianos","Nem sikerült betölteni a zongorákat")}</p>${renderAddForm()}`}
 applyLanguageToDOM(document.getElementById("clientPianoSelector"));
}
async function addInlinePianoToClient(clientId){
 if(!clientId){appAlert(bi("Save the client first.","Előbb mentsd az ügyfelet."),"warning");return}
 const brand=$("#newPianoBrand")?.value || "", model=$("#newPianoModel")?.value || "", serial_no=$("#newPianoSerial")?.value || "", location=$("#newPianoLocation")?.value || "", ownership_type=$("#newPianoOwnership")?.value || "Customer owned", estimated_value=Number($("#newPianoValue")?.value || 0);
 if(!brand && !model){appAlert(bi("Enter at least a brand or model.","Legalább márkát vagy modellt adj meg."),"warning");return}
 if(ownership_type==="Company owned" && estimated_value<=0){appAlert(bi("Estimated value is required for a company-owned piano.","Céges zongoránál kötelező a becsült érték."),"warning");return}
 try{
   const existing=await api(`/api/contacts/${clientId}/pianos`).catch(()=>[]);
   const similar=existing.find(p=>String(p.brand||"").trim().toLowerCase()===brand.trim().toLowerCase() && String(p.model||"").trim().toLowerCase()===model.trim().toLowerCase() && (!serial_no || String(p.serial_no||"").trim().toLowerCase()===serial_no.trim().toLowerCase()));
   if(similar){
     const ok=await appConfirm(bi("This client already has a similar piano. Add another one anyway?","Az ügyfélnek már van hasonló zongorája. Hozzáadsz még egyet?"));
     if(!ok) return;
   }
   await api(`/api/contacts/${clientId}/pianos`,{method:"POST",body:JSON.stringify({brand,model,serial_no,location,ownership_type,estimated_value})});
   await api(`/api/contacts/${clientId}`,{method:"PUT",body:JSON.stringify({has_piano:1})}).catch(()=>{});
   await attachClientPianoSelector({id:clientId,has_piano:1});
 }catch(err){showError(err)}
}

function closeModal(){$("#modal").classList.add("hidden")}
function exportTable(key){api("/api/"+key).then(data=>{if(!data.length){appAlert(bi("No data","Nincs adat"),"info");return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`${key}.csv`;a.click()})}
const financialCategoryOptions={
 INCOME:[
   ["SERVICE_REVENUE","Service Revenue / Szolgáltatási bevétel"],
   ["PIANO_SALE","Piano Sale Revenue / Zongoraeladás bevétele"],
   ["PASSIVE_REVENUE","Recurring Revenue / Ismétlődő bevétel"],
   ["OTHER_INCOME","Other Income / Egyéb bevétel"]
 ],
 EXPENSE:[
   ["MATERIALS","Materials Expense / Anyagköltség"],
   ["CONTRACTOR","Contractor Labor / Alvállalkozói munkadíj"],
   ["TRANSPORT","Transportation / Szállítás"],
   ["RENT","Rent / Bérleti díj"],
   ["INSURANCE","Insurance / Biztosítás"],
   ["TAX","Taxes / Adók"],
   ["OTHER_EXPENSE","Other Expense / Egyéb kiadás"]
 ],
 ASSET:[
   ["CASH","Cash / Készpénz"],
   ["BANK","Bank Account / Bankszámla"],
   ["CHECKS","Undeposited Checks / Befizetés előtti csekkek"],
   ["AR","Accounts Receivable / Vevőkövetelés"],
   ["INVENTORY","Inventory / Készlet"],
   ["COMPANY_PIANOS","Company Pianos / Céges zongorák"],
   ["TOOLS","Tools and Equipment / Szerszámok és berendezések"],
   ["OTHER_ASSET","Other Assets / Egyéb eszközök"]
 ],
 LIABILITY:[
   ["LOAN","Loans Payable / Hitelek"],
   ["BANK_LOAN","Bank Loan / Bankkölcsön"],
   ["INSURANCE_LIABILITY","Insurance Liabilities / Biztosítási kötelezettségek"],
   ["OTHER_LONG_TERM_SOURCE","Other Long-Term Sources / Egyéb hosszú lejáratú források"],
   ["AP","Accounts Payable / Szállítói tartozás"],
   ["CHECK_PAYABLE","Check Payables / Csekkes tartozás"],
   ["RENT_PAYABLE","Rent / Bérleti díj"],
   ["UTILITIES_PAYABLE","Utilities / Rezsi"],
   ["SHORT_TERM_OPERATING","Short-Term Operating Expenses / Rövid lejáratú működési kiadások"],
   ["OTHER_SHORT_TERM_SOURCE","Other Short-Term Sources / Egyéb rövid lejáratú források"]
 ],
 EQUITY:[
   ["OWNER_EQUITY","Owner Equity / Saját tőke"],
   ["OTHER_SOURCE","Other Sources / Egyéb forrás"]
 ]
};
const balanceAccountOptions=[
 ["","No automatic balance impact / Nincs automatikus mérleghatás"],
 ["ASSET_HEADER","--- Assets / Eszközök ---"],
 ["CASH","Cash / Készpénz"],
 ["BANK","Bank Account / Bankszámla"],
 ["CHECKS","Undeposited Checks / Befizetés előtti csekkek"],
 ["AR","Accounts Receivable / Vevőkövetelés"],
 ["INVENTORY","Inventory / Készlet"],
 ["COMPANY_PIANOS","Company Pianos / Céges zongorák"],
 ["TOOLS","Tools and Equipment / Szerszámok és berendezések"],
 ["OTHER_ASSET","Other Assets / Egyéb eszközök"],
 ["SOURCE_HEADER","--- Sources / Források ---"],
 ["LOAN","Loans Payable / Hitelek"],
 ["BANK_LOAN","Bank Loan / Bankkölcsön"],
 ["INSURANCE_LIABILITY","Insurance Liabilities / Biztosítási kötelezettségek"],
 ["OTHER_LONG_TERM_SOURCE","Other Long-Term Sources / Egyéb hosszú lejáratú források"],
 ["AP","Accounts Payable / Szállítói tartozás"],
 ["CHECK_PAYABLE","Check Payables / Csekkes tartozás"],
 ["RENT_PAYABLE","Rent / Bérleti díj"],
 ["UTILITIES_PAYABLE","Utilities / Rezsi"],
 ["SHORT_TERM_OPERATING","Short-Term Operating Expenses / Rövid lejáratú működési kiadások"],
 ["OWNER_EQUITY","Owner Equity / Saját tőke"],
 ["OTHER_SOURCE","Other Sources / Egyéb forrás"]
];
function finLabel(value){
 const all=[...financialCategoryOptions.INCOME,...financialCategoryOptions.EXPENSE,...financialCategoryOptions.ASSET,...financialCategoryOptions.LIABILITY,...financialCategoryOptions.EQUITY,...balanceAccountOptions];
 return all.find(x=>x[0]===value)?.[1] || value || "";
}
function mainTypeLabel(v){return ({INCOME:"Income / Bevétel",EXPENSE:"Expense / Kiadás",ASSET:"Asset / Eszköz",LIABILITY:"Liability / Kötelezettség",EQUITY:"Equity / Saját tőke"})[v]||v||""}
function recurrenceLabel(v){return v==="MONTHLY"?"Monthly / Havi":"One-time / Egyszeri"}
function signedAmountHTML(item){
 const t=String(item?.main_type||"").toUpperCase();
 const positive=t==="INCOME" || t==="ASSET";
 const sign=positive?"+":"-";
 const cls=positive?"amount-positive":"amount-negative";
 return `<span class="${cls}">${sign} ${money(Math.abs(Number(item?.amount||0)))}</span>`;
}
function paymentOptions(selected=""){
 const labels={"":bi("Select","Válassz"),Cash:bi("Cash","Készpénz"),Check:bi("Check","Csekk"),"Bank Transfer":bi("Bank Transfer","Banki átutalás"),"Credit Card":bi("Credit Card","Bankkártya"),Invoice:bi("Invoice","Számla"),Other:bi("Other","Egyéb")};return ["","Cash","Check","Bank Transfer","Credit Card","Invoice","Other"].map(x=>`<option value="${x}" ${x===selected?"selected":""}>${labels[x]}</option>`).join("");
}
function optionsFrom(list,selected=""){
 return list.map(x=>`<option value="${x[0]}" ${x[0]===selected?"selected":""} ${String(x[0]).endsWith("_HEADER")?"disabled":""}>${splitBilingualText(x[1])}</option>`).join("");
}
async function renderFinance(){
 const currentMonth=currentMonthKey();
 let items=[];
 try{items=await api("/api/financial-items");}catch(e){items=[];}
 $("#finance").innerHTML=`<div class="panel finance-panel">
   <div class="toolbar">
     <div><h3>${bi("Finance","Pénzügy")}</h3><p class="muted">${bi("Detailed financial register used by the income statement and balance overview.","Tételes pénzügyi napló, amelyből az eredménykimutatás és a mérleg készül.")}</p></div>
     <div><button class="small" onclick="exportFinancialItemsCSV()">${bi("Export CSV","CSV export")}</button> <button onclick="openFinancialItem()">+ ${bi("New financial item","Új pénzügyi tétel")}</button></div>
   </div>
   <button id="financeFilterToggle" type="button" class="mobile-filter-toggle" aria-expanded="${mobileFinanceFiltersOpen}" onclick="toggleMobileFilterPanel('financeFilterPanel','financeFilterToggle','finance')">⌕ ${bi("Filters","Szűrők")}</button>
   <div id="financeFilterPanel" class="finance-filters mobile-collapsible-filter ${mobileFinanceFiltersOpen?"open":""}">
     <label>${bi("Month","Hónap")} <input id="finFilterMonth" type="month" value="${currentMonth}"></label>
     <label>${bi("Type","Típus")} <select id="finFilterType"><option value="">${bi("All","Összes")}</option><option value="INCOME">${bi("Income","Bevétel")}</option><option value="EXPENSE">${bi("Expense","Kiadás")}</option><option value="ASSET">${bi("Asset","Eszköz")}</option><option value="LIABILITY">${bi("Liability","Kötelezettség")}</option><option value="EQUITY">${bi("Equity","Saját tőke")}</option></select></label>
     <label>${bi("Recurrence","Ismétlődés")} <select id="finFilterRec"><option value="">${bi("All","Összes")}</option><option value="ONE_TIME">${bi("One-time","Egyszeri")}</option><option value="MONTHLY">${bi("Monthly","Havi")}</option></select></label>
     <button class="small" onclick="applyFinanceFilters()">${bi("Filter","Szűrés")}</button>
     <button class="small ghost-btn" onclick="clearFinanceFilters()">${bi("Clear","Törlés")}</button>
   </div>
   <div id="financeTableBox">${financeTableHTML(items)}</div>
 </div>`;
}
function financeTableHTML(items){
 return `<div class="table-wrap finance-table-wrap"><table><thead><tr>
   <th>${bi("Date","Dátum")}</th><th>${bi("Title","Megnevezés")}</th><th>${bi("Type","Típus")}</th><th>${bi("Category","Kategória")}</th><th>${bi("Recurrence","Ismétlődés")}</th><th>${bi("Payment","Fizetés")}</th><th>${bi("Balance impact","Mérleghatás")}</th><th>${bi("Amount","Összeg")}</th><th>${bi("Actions","Műveletek")}</th>
 </tr></thead><tbody>${items.map(x=>`<tr>
   <td class="finance-date-cell">${formatFinanceDate(x.item_date)}</td>
   <td><b>${htmlText(x.title||"")}</b><br><small>${htmlText(x.description||"")}</small></td>
   <td>${mainTypeLabel(x.main_type)}</td><td>${finLabel(x.category)}</td><td>${recurrenceLabel(x.recurrence)}</td><td>${htmlText(x.payment_method||"")}</td><td>${finLabel(x.balance_account)}</td><td>${signedAmountHTML(x)}</td>
   <td><button class="small" onclick='openFinancialItem(${esc(x)})'>${bi("Edit","Szerkesztés")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteFinancialItem('${x.id}')">${bi("Delete","Törlés")}</button>`:""}</td>
 </tr>`).join("") || `<tr><td colspan="9" class="muted">${bi("No financial items yet.","Még nincs pénzügyi tétel.")}</td></tr>`}</tbody></table></div>`;
}
function exportFinancialItemsCSV(){
 api("/api/financial-items").then(data=>{if(!data.length){appAlert(bi("No data","Nincs adat"),"info");return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="financial_items.csv";a.click()})
}
async function applyFinanceFilters(){
 const q=[];
 const m=$("#finFilterMonth")?.value; const t=$("#finFilterType")?.value; const r=$("#finFilterRec")?.value;
 if(m) q.push("month="+encodeURIComponent(m));
 if(t) q.push("main_type="+encodeURIComponent(t));
 if(r) q.push("recurrence="+encodeURIComponent(r));
 const items=await api("/api/financial-items"+(q.length?"?"+q.join("&"):""));
 $("#financeTableBox").innerHTML=financeTableHTML(items);
}
async function clearFinanceFilters(){
 if($("#finFilterMonth")) $("#finFilterMonth").value="";
 if($("#finFilterType")) $("#finFilterType").value="";
 if($("#finFilterRec")) $("#finFilterRec").value="";
 const items=await api("/api/financial-items");
 $("#financeTableBox").innerHTML=financeTableHTML(items);
}
function openFinancialItem(row=null){
 const isEdit=!!row;
 const selectedType=row?.main_type||"INCOME";
 const categoryList=financialCategoryOptions[selectedType]||financialCategoryOptions.INCOME;
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=isEdit?bi("Edit Financial Item","Pénzügyi tétel szerkesztése"):bi("New Financial Item","Új pénzügyi tétel");
 $("#form").innerHTML=`<div class="form-grid financial-form">
   <div class="field"><label>${req("Date / Dátum")}</label><input name="item_date" type="date" value="${row?.item_date||fmtDate(new Date())}" required></div>
   <div class="field"><label>${req("Main type / Fő típus")}</label><select name="main_type" id="financialMainType" onchange="refreshFinancialCategoryOptions()">
     <option value="INCOME" ${selectedType==="INCOME"?"selected":""}>Income / Bevétel</option>
     <option value="EXPENSE" ${selectedType==="EXPENSE"?"selected":""}>Expense / Kiadás</option>
     <option value="ASSET" ${selectedType==="ASSET"?"selected":""}>Asset / Eszköz</option>
     <option value="LIABILITY" ${selectedType==="LIABILITY"?"selected":""}>Liability / Kötelezettség</option>
     <option value="EQUITY" ${selectedType==="EQUITY"?"selected":""}>Equity / Saját tőke</option>
   </select></div>
   <div class="field"><label>${req("Title / Megnevezés")}</label><input name="title" value="${row?.title||""}" required placeholder="${bi("Piano sale, tuning, rent...","Zongoraeladás, hangolás, bérleti díj...")}"></div>
   <div class="field"><label>${req("Amount / Összeg")}</label><input name="amount" type="number" min="0" step="0.01" value="${row?.amount||0}" required></div>
   <div class="field"><label>${req("Category / Kategória")}</label><select name="category" id="financialCategory">${optionsFrom(categoryList,row?.category||"")}</select></div>
   <div class="field"><label>${req("Recurrence / Ismétlődés")}</label><select name="recurrence"><option value="ONE_TIME" ${row?.recurrence!=="MONTHLY"?"selected":""}>One-time / Egyszeri</option><option value="MONTHLY" ${row?.recurrence==="MONTHLY"?"selected":""}>Monthly / Havi</option></select></div>
   <div class="field"><label>Payment method / Fizetési mód</label><select name="payment_method">${paymentOptions(row?.payment_method||"")}</select></div>
   <div class="field"><label>Balance account / Mérlegoldali hatás</label><select name="balance_account">${optionsFrom(balanceAccountOptions,row?.balance_account||"")}</select></div>
   <div class="field"><label>Job ID / Munka ID</label><input name="job_id" value="${row?.job_id||""}"></div>
   <div class="field"><label>Client ID / Ügyfél ID</label><input name="client_id" value="${row?.client_id||""}"></div>
   <div class="field"><label>Piano ID / Zongora ID</label><input name="piano_id" value="${row?.piano_id||""}"></div>
   <div class="field full"><label>Description / Leírás</label><textarea name="description" placeholder="${bi("Short explanation for future reference.","Rövid magyarázat, hogy később is egyértelmű legyen.")}">${row?.description||""}</textarea></div>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>${isEdit?"Save changes / Módosítás mentése":"Create item / Tétel létrehozása"}</button></div>`;
 $("#form").onsubmit=async e=>{
   e.preventDefault();
   const body=Object.fromEntries(new FormData(e.target));
   body.amount=Number(body.amount||0);
   try{
     if(isEdit) await api(`/api/financial-items/${row.id}`,{method:"PUT",body:JSON.stringify(body)});
     else await api("/api/financial-items",{method:"POST",body:JSON.stringify(body)});
     closeModal();
     await renderFinance();
   }catch(err){showError(err)}
 };
}
function refreshFinancialCategoryOptions(){
 const t=$("#financialMainType")?.value||"INCOME";
 const cat=$("#financialCategory");
 if(cat) cat.innerHTML=optionsFrom(financialCategoryOptions[t]||financialCategoryOptions.INCOME,"");
}
async function deleteFinancialItem(id){
 if(!await appConfirm(bi("Delete this financial item?","Biztosan törlöd ezt a pénzügyi tételt?"),{type:"error",confirmText:bi("Delete","Törlés")})) return;
 try{await api(`/api/financial-items/${id}`,{method:"DELETE"});await renderFinance()}catch(err){showError(err)}
}
function currentMonthKey(){
 const d=new Date();
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function previousMonths(count=24){
 const arr=[];
 const d=new Date();
 d.setDate(1);
 for(let i=1;i<=count;i++){
   const x=new Date(d);
   x.setMonth(d.getMonth()-i);
   arr.push(`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`);
 }
 return arr;
}
async function loadMonthlyIncomeStatement(month){
 return await api(`/api/income-statement/monthly?month=${encodeURIComponent(month)}`);
}
function renderIncomeSheetHTML(d, includeTrial=true){
 const acct=c=>d.trialBalance.filter(a=>a.category===c);

 const lineRows=(arr,fallback)=>arr.length
   ? arr.map(a=>`<div class="cf-line"><span>${currentLang==="hu"?(a.name_hu||a.name_en):(a.name_en||a.name_hu)}</span><b>${money(a.balance)}</b></div>`).join("")
   : fallback.map(x=>`<div class="cf-line empty"><span>${parenLabel(x)}</span><b>—</b></div>`).join("");

 const fallbackIncome=[
   "Service Revenue (Szolgáltatási bevétel)",
   "Interest Income (Kamatbevétel)",
   "Dividend Income (Osztalékbevétel)",
   "Real Estate Income (Ingatlanbevétel)",
   "Business Income (Üzleti bevétel)",
   "Other Income (Egyéb bevétel)"
 ];
 const fallbackExpenses=[
   "Taxes (Adók)",
   "Materials Expense (Anyagköltség)",
   "Contractor Labor (Alvállalkozói munkadíj)",
   "Transportation (Szállítás)",
   "Rent (Bérleti díj)",
   "Insurance (Biztosítás)",
   "Repair Expense (Javítási költség)",
   "Other Expense (Egyéb költség)"
 ];
 const fallbackAssets=[
   "Cash (Készpénz)",
   "Bank Account (Bankszámla)",
   "Undeposited Checks (Befizetés előtti csekkek)",
   "Accounts Receivable (Vevőkövetelés)",
   "Inventory (Készlet)",
   "Company Pianos (Céges zongorák)",
   "Tools and Equipment (Szerszámok és berendezések)",
   "Other Assets (Egyéb eszközök)"
 ];
 const fallbackSources=[
   "Loans Payable (Hitelek)",
   "Bank Loan (Bankkölcsön)",
   "Insurance Liabilities (Biztosítási kötelezettségek)",
   "Other Long-Term Sources (Egyéb hosszú lejáratú források)",
   "Accounts Payable (Szállítói tartozás)",
   "Check Payables (Csekkes tartozás)",
   "Rent (Bérleti díj)",
   "Utilities (Rezsi)",
   "Short-Term Operating Expenses (Rövid lejáratú működési kiadások)",
   "Owner Equity (Saját tőke)",
   "Other Sources (Egyéb forrás)"
 ];

 const incomeRows=lineRows(acct("REVENUE"),fallbackIncome);
 const expenseRows=lineRows(acct("EXPENSE"),fallbackExpenses);
 const assetRows=lineRows(acct("ASSET"),fallbackAssets);
 const sourceRows=lineRows([...acct("LIABILITY"),...acct("EQUITY")],fallbackSources);

 const trial=includeTrial?`<div class="panel income-trial-table no-print-break">
   <h3>${bi("Technical Summary","Technikai összesítő")}</h3>
   <p class="muted">${bi("General Ledger has been removed. This section is kept only for export compatibility.","A Főkönyv funkció törölve lett, ez csak export-kompatibilitási hely.")}</p>
   <div class="table-wrap"><table>
     <thead><tr><th>${bi("Code","Kód")}</th><th>${bi("Account","Számla")}</th><th>${bi("Category","Kategória")}</th><th>${bi("Debit","Tartozik")}</th><th>${bi("Credit","Követel")}</th><th>${bi("Balance","Egyenleg")}</th></tr></thead>
     <tbody>${d.trialBalance.map(a=>`<tr><td>${a.code}</td><td>${a.name_en}<br><small>${a.name_hu}</small></td><td>${a.category}</td><td>${money(a.debit_total)}</td><td>${money(a.credit_total)}</td><td>${money(a.balance)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">${bi("No ledger data","Nincs főkönyvi adat")}</td></tr>`}</tbody>
   </table></div>
 </div>`:"";

 return `<div class="grid kpis">
   <div class="kpi"><span>${bi("Revenue","Bevétel")}</span><strong>${money(d.totals.revenue)}</strong></div>
   <div class="kpi"><span>${bi("Expenses","Kiadások")}</span><strong>${money(d.totals.expenses)}</strong></div>
   <div class="kpi"><span>${bi("Assets","Eszközök")}</span><strong>${money(d.totals.assets||0)}</strong></div>
   <div class="kpi"><span>${bi("Sources","Források")}</span><strong>${money(d.totals.sources||((d.totals.liabilities||0)+(d.totals.equity||0)))}</strong></div>
 </div>

 <div class="cashflow-layout">
   <div class="cf-main-title">
     <h2>${bi("Income Statement","Eredménykimutatás")}</h2>
     <p>${bi("Cashflow-style monthly business overview","Cashflow-jellegű havi vállalati áttekintés")}</p>
   </div>

   <div class="cf-upper">
     <div class="cf-left-stack">
       <div class="cf-card">
         <div class="cf-card-head">${bi("Income ($/month)","Bevételek ($/hó)")}</div>
         <div class="cf-card-body">${incomeRows}</div>
       </div>

       <div class="cf-card">
         <div class="cf-card-head">${bi("Expenses ($/month)","Kiadások ($/hó)")}</div>
         <div class="cf-card-body">${expenseRows}</div>
       </div>
     </div>

     <div class="cf-right-stack">
       <div class="cf-card cf-bookkeeper">
         <div class="cf-card-head">${bi("Bookkeeper","Könyvvizsgáló")}</div>
         <div class="cf-card-body">
           <div class="cf-line big"><span>${bi("Passive Income","Passzív jövedelem")}</span><b>${money(d.totals.passiveIncome||0)}</b></div>
           <div class="cf-rule"></div>
           <div class="cf-line total"><span>${bi("Total Income","Összes bevétel")}</span><b>${money(d.totals.revenue)}</b></div>
         </div>
       </div>

       <div class="cf-card cf-cashflow">
         <div class="cf-card-body">
           <div class="cf-line total"><span>${bi("Total Expenses","Összes kiadás")}</span><b>${money(d.totals.expenses)}</b></div>
           <div class="cf-rule"></div>
           <div class="cf-line cashflow"><span>${bi("Monthly Cash Flow","Havi készpénzáramlás")}</span><b>${money(d.totals.profit)}</b></div>
         </div>
       </div>
     </div>
   </div>

   <div class="cf-balance-title">${bi("Balance Sheet","Mérleg")}</div>

   <div class="cf-balance">
     <div class="cf-card">
       <div class="cf-card-head cf-card-head-sum"><span>${bi("Assets ($)","Eszközök ($)")}</span><b>${money(d.totals.assets||0)}</b></div>
       <div class="cf-card-body">${assetRows}</div>
     </div>

     <div class="cf-card">
       <div class="cf-card-head cf-card-head-sum"><span>${bi("Sources ($)","Források ($)")}</span><b>${money(d.totals.sources||((d.totals.liabilities||0)+(d.totals.equity||0)))}</b></div>
       <div class="cf-card-body">${sourceRows}</div>
     </div>
   </div>

   <div class="cf-footer cf-footer-grid">
     <div class="cf-line total"><span>${bi("Total Assets","Összes eszköz")}</span><b>${money(d.totals.assets||0)}</b></div>
     <div class="cf-line total"><span>${bi("Total Sources","Összes forrás")}</span><b>${money(d.totals.sources||((d.totals.liabilities||0)+(d.totals.equity||0)))}</b></div>
     <div class="cf-line total"><span>${bi("Net Worth","Nettó vagyon")}</span><b>${money(d.totals.netWorth)}</b></div>
   </div>
 </div>${trial}`;
}

async function renderIncomeStatement(){
 const currentMonth=currentMonthKey();
 const d=await loadMonthlyIncomeStatement(currentMonth);
 const past=await Promise.all(previousMonths(12).map(m=>loadMonthlyIncomeStatement(m).catch(()=>null)));
 const pastRows=past.filter(Boolean);

 $("#income_statement").innerHTML=`<div class="panel no-print">
   <div class="toolbar">
     <div>
       <h3>${bi("Current monthly export","Aktuális havi export")}</h3>
       <p class="muted">${bi("Current month","Aktuális hónap")}: <b>${d.month}</b> · ${bi("Period start","Időszak kezdete")}: <b>${d.monthStart}</b> · ${bi("Generated","Lekérés ideje")}: <b>${new Date(d.generatedAt).toLocaleString()}</b></p>
     </div>
     <button onclick="exportIncomeStatementPDF('${d.month}')">${bi("Export current month PDF","Aktuális hónap PDF export")}</button>
   </div>
 </div>

 <div id="incomeStatementCurrent" data-month="${d.month}">
   ${renderIncomeSheetHTML(d,false)}
 </div>

 <div class="panel no-print">
   <div class="toolbar"><h3>${bi("Previous monthly income statements","Korábbi havi eredménykimutatások")}</h3></div>
   <div class="table-wrap"><table>
     <thead><tr><th>${bi("Month","Hónap")}</th><th>${bi("Period start","Időszak kezdete")}</th><th>${bi("Revenue","Bevétel")}</th><th>${bi("Expenses","Kiadások")}</th><th>${bi("Profit","Eredmény")}</th><th>Export</th></tr></thead>
     <tbody>${pastRows.map(x=>`<tr><td>${x.month}</td><td>${x.monthStart}</td><td>${money(x.totals.revenue)}</td><td>${money(x.totals.expenses)}</td><td>${money(x.totals.profit)}</td><td><button class="small" onclick="exportIncomeStatementPDF('${x.month}')">PDF</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">${bi("No previous monthly data","Nincs korábbi havi adat.")}</td></tr>`}</tbody>
   </table></div>
 </div>`;
}
async function exportIncomeStatementPDF(month=currentMonthKey()){
 const d=await loadMonthlyIncomeStatement(month);
 const generated=new Date().toLocaleString();
 const filename=`income_statement_${month}_${new Date().toISOString().replace(/[:.]/g,"-")}.pdf`;
 const html=renderIncomeSheetHTML(d,true);
 const win=window.open("", "_blank");
 win.document.write(`<!doctype html><html><head><title>${filename}</title><style>
   :root{--bg:#07101d;--panel:#0d1b2e;--panel-2:#13243b;--panel2:#13243b;--text:#f4f7fb;--muted:#9fb0c7;--line:#27405f;--blue:#4aa3ff;--green:#2ecc71;--red:#ff5b5b;--orange:#ff9f43;--purple:#b084f5;--shadow:0 12px 35px rgba(0,0,0,.25)}
   *{box-sizing:border-box}
   body{font-family:Inter,Arial,sans-serif;background:var(--bg);color:var(--text);padding:22px;margin:0}
   .pdf-meta{background:var(--panel);border:1px solid var(--line);border-radius:16px;margin-bottom:18px;padding:18px;box-shadow:var(--shadow)}
   .pdf-meta h1{margin:0 0 8px;font-size:24px}.pdf-meta p{margin:4px 0;color:var(--muted)}
   .grid{display:grid;gap:14px}.kpis{grid-template-columns:repeat(4,1fr);margin-bottom:18px}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;box-shadow:var(--shadow)}
   .kpi span{color:var(--muted);display:block}.kpi strong{font-size:26px}
   .panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:18px;box-shadow:var(--shadow)}
   .cashflow-layout{display:flex;flex-direction:column;gap:18px;margin-top:18px}.cf-main-title{text-align:center;padding:4px 0 0}.cf-main-title h2{font-size:30px;margin:0 0 4px}.cf-main-title p{margin:0;color:var(--muted)}
   .cf-upper{display:grid;grid-template-columns:1.05fr .95fr;gap:22px;align-items:stretch}.cf-left-stack,.cf-right-stack{display:flex;flex-direction:column;gap:18px}
   .cf-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:var(--shadow)}
   .cf-card-head{background:var(--panel-2);border-bottom:1px solid var(--line);padding:12px 16px;font-size:18px;font-weight:900}.cf-card-head span{color:var(--muted);font-weight:700;font-size:14px}.cf-card-head-sum{display:flex;justify-content:space-between;gap:14px}.cf-card-head-sum b{font-size:19px}
   .cf-card-body{padding:14px 18px}.cf-line{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:end;border-bottom:1px solid rgba(148,163,184,.22);padding:8px 0;min-height:34px}.cf-line span{font-weight:650}.cf-line small{color:var(--muted);font-weight:600}.cf-line b{font-variant-numeric:tabular-nums}.cf-line.big{min-height:88px;align-items:center;font-size:19px;border-bottom:0}.cf-line.total{font-size:18px;font-weight:900;border-bottom:0}.cf-line.cashflow{font-size:19px;font-weight:950;border-bottom:0}.cf-rule{height:2px;background:var(--line);margin:18px 0}.cf-bookkeeper{min-height:270px}.cf-cashflow{min-height:190px;display:flex;flex-direction:column;justify-content:center}.cf-balance-title{text-align:center;font-size:30px;font-weight:950;margin-top:8px}.cf-balance{display:grid;grid-template-columns:1fr 1fr;gap:22px}.cf-footer{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:10px 18px;box-shadow:var(--shadow)}.cf-footer-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid var(--line);padding:7px;text-align:left}th{background:var(--panel-2)}.muted{color:var(--muted)}
   @media print{body{background:#fff;color:#111;padding:12px}.pdf-meta,.kpi,.panel,.cf-card,.cf-footer{box-shadow:none;break-inside:avoid}.pdf-meta,.kpi,.panel,.cf-card,.cf-footer{background:#fff;color:#111;border-color:#aaa}.cf-card-head,th{background:#eee;color:#111}.cf-main-title p,.muted,.cf-card-head span,.cf-line small{color:#555}.no-print{display:none!important}.cf-upper,.cf-balance{grid-template-columns:1fr 1fr}.kpis{grid-template-columns:repeat(4,1fr)}}
 </style></head><body>
   <div class="pdf-meta">
     <h1>Klavierhaus - Monthly Income Statement / Havi eredménykimutatás</h1>
     <p><b>${bi("Month","Hónap")}:</b> ${d.month}</p>
     <p><b>${bi("Period start","Időszak kezdete")}:</b> ${d.monthStart}</p>
     <p><b>Generated / Letöltés időbélyege:</b> ${generated}</p>
   </div>
   ${html}
   <script>window.onload=function(){document.title=${JSON.stringify(filename)};setTimeout(()=>window.print(),250);}</script>
 </body></html>`);
 win.document.close();
}

async function renderClosedJobs(){
 const target=forceShowView("closed_jobs");
 let rows=[];
 try{ rows=await api("/api/closed-jobs"); }catch(e){ rows=[]; }
 const headers=[bi("Job ID","Munkaazonosító"),bi("Job name","Munka neve"),bi("Client","Ügyfél"),bi("Piano","Zongora"),bi("Type","Típus"),bi("Responsible at close","Felelős lezáráskor"),bi("Closed by","Lezárta"),bi("Closed at","Lezárás ideje"),bi("Amount","Összeg"),bi("Payment method","Fizetési mód"),bi("Invoice/check","Számla/csekk"),bi("Description","Leírás"),bi("Actions","Műveletek")];
 const tableRows = rows.length ? rows.map(r=>`<tr>
   <td>${r.job_key||r.job_id||""}</td><td>${r.title||""}</td><td>${r.client_name||""}</td><td>${r.piano_name||""}</td><td>${r.close_type||r.job_type||""}</td><td>${r.responsible_at_close||""}</td><td>${r.closed_by||""}</td><td>${r.closed_at||""}</td><td>${money(r.billed_amount)}</td><td>${r.payment_method||""}</td><td>${r.document_path?`<a href="${r.document_path}" target="_blank">${bi("Download","Letöltés")}</a>`:""}</td><td>${r.close_description||""}</td><td>${isSuperadmin()?`<button class="small danger-btn" onclick="deleteClosedJob('${r.log_id}')">${bi("Delete","Törlés")}</button>`:""}</td>
 </tr>`).join("") : `<tr><td colspan="13" class="muted">${tr("noClosedJobs")}</td></tr>`;
 target.innerHTML=`<div class="panel"><div class="toolbar"><h3>${bi("Closed Jobs","Lezárt munkák")}</h3><button class="small" onclick="exportClosedJobs()">Export CSV</button></div><div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div></div>`;
}
async function deleteClosedJob(id){
 if(!isSuperadmin()) return showError("PERMISSION_DENIED");
 if(!await appConfirm(bi("Delete this closed job and linked visible records?","Töröljük ezt a lezárt munkát és kapcsolódó látható tételeit?"),{type:"error",confirmText:bi("Delete","Törlés")})) return;
 try{await api(`/api/closed-jobs/${encodeURIComponent(id)}`,{method:"DELETE"}); await renderClosedJobs();}catch(err){showError(err)}
}
function exportClosedJobs(){
 api("/api/closed-jobs").then(data=>{
   if(!data.length){appAlert(bi("No data","Nincs adat"),"info");return}
   let h=Object.keys(data[0]);
   let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");
   let a=document.createElement("a");
   a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
   a.download="closed_jobs.csv";
   a.click();
 });
}

function optionTags(arr,val=""){
 return arr.map(o=>`<option value="${String(o).replaceAll('"','&quot;')}" ${o===val?"selected":""}>${o}</option>`).join("");
}
function invValue(x){return (Number(x.purchase_price||0)||Number(x.manufacturing_cost||0)||0)*Number(x.quantity||1)}
function invStatusBadge(status){
 const st=String(status||"");
 const cls=st.includes("Sold")||st.includes("Disposed")||st.includes("Lost")?"Low":(st.includes("Reserved")?"Urgent":"Medium");
 return `<span class="badge ${cls}">${st}</span>`;
}

function plannedRevenue(x){return Number(x.expected_revenue||0)}
function plannedProbabilityNumber(x){
 const raw=String(x.probability||"100");
 const m=raw.match(/(100|75|50|25)/);
 return m?Number(m[1]):100;
}
function plannedWeightedRevenue(x){return plannedRevenue(x)*plannedProbabilityNumber(x)/100}
function plannedTypeKind(x){
 const t=String(x.planned_type||"").toLowerCase();
 if(t.includes("blocked")||t.includes("megakadt")) return "blocked";
 return "planned";
}
function plannedCard(x){
 const statusLine=x.block_reason || x.status || "";
 return `<div class="planned-card ${plannedTypeKind(x)}" onclick='openPlannedJobDetails(${esc(x)})'>
   <div class="planned-title">${x.title||"Untitled / Névtelen"}</div>
   <div class="planned-meta"><b>Client / Ügyfél:</b> ${x.client_name||"—"}</div>
   <div class="planned-meta"><b>Responsible / Felelős:</b> ${workerDisplayName(x.preferred_assigned_user_id,x.preferred_assigned_to)||"—"}</div>
   <div class="planned-meta"><b>Priority / Prioritás:</b> ${badge(x.priority||"Medium")}</div>
   <div class="planned-meta"><b>Status / Állapot:</b> ${statusLine||"—"}</div>
   <div class="planned-money"><b>Expected / Várható:</b> ${money(x.expected_revenue||0)} <small>${plannedProbabilityNumber(x)}%</small></div>
 </div>`;
}
async function renderPlannedJobs(){
 const target=forceShowView("planned_jobs");
 let rows=[];
 try{rows=await api("/api/planned-jobs");}catch(e){rows=[];}
 const active=rows.filter(x=>!["Converted / Naptárba helyezve","Archived / Archivált","Cancelled / Törölve"].includes(x.status));
 const blocked=active.filter(x=>plannedTypeKind(x)==="blocked");
 const planned=active.filter(x=>plannedTypeKind(x)==="planned");
 const blockedTotal=blocked.reduce((s,x)=>s+plannedRevenue(x),0);
 const plannedTotal=planned.reduce((s,x)=>s+plannedRevenue(x),0);
 const blockedWeighted=blocked.reduce((s,x)=>s+plannedWeightedRevenue(x),0);
 const plannedWeighted=planned.reduce((s,x)=>s+plannedWeightedRevenue(x),0);
 const canExport=["ADMIN","SUPERADMIN"].includes(user.role);
 target.innerHTML=`<div class="panel">
   <div class="toolbar">
     <div><h3>Planned Jobs / Tervezett munkák</h3><p class="muted">Pipeline before calendar scheduling / Naptár előtti munkatervezési lista</p></div>
     <div><button onclick="openPlannedJob()">+ Add planned job / Új tervezett munka</button>${canExport?` <button class="small" onclick="exportPlannedJobsCSV()">Export CSV</button>`:""}</div>
   </div>
   <div class="planned-board">
     <div class="planned-column">
       <div class="planned-column-head"><h3>Existing but blocked / Meglévő, de megakadt</h3><p>Total expected / Összes várható: <b>${money(blockedTotal)}</b></p><p>Weighted / Súlyozott: <b>${money(blockedWeighted)}</b></p></div>
       <div class="planned-list">${blocked.map(plannedCard).join("")||`<p class="muted">No blocked jobs / Nincs megakadt munka.</p>`}</div>
     </div>
     <div class="planned-column">
       <div class="planned-column-head"><h3>Planned, not fixed yet / Tervezett, még nem lefixált</h3><p>Total expected / Összes várható: <b>${money(plannedTotal)}</b></p><p>Weighted / Súlyozott: <b>${money(plannedWeighted)}</b></p></div>
       <div class="planned-list">${planned.map(plannedCard).join("")||`<p class="muted">No planned jobs / Nincs tervezett munka.</p>`}</div>
     </div>
   </div>
 </div>`;
 window.__plannedJobs=rows;
}
async function openPlannedJob(row=null){
 const [contacts,pianos]=await Promise.all([api("/api/contacts").catch(()=>[]),api("/api/pianos").catch(()=>[]),loadSchedulerWorkers().catch(()=>[])]).then(results=>[results[0],results[1]]);
 const estimatedMinutes=Math.max(5,Math.round(Number(row?.estimated_hours||2)*60/5)*5);
 const clientOptions=contacts.map(c=>`<option value="${(c.name||"").replaceAll('"',"&quot;")}">${c.phone||""} ${c.address||""}</option>`).join("");
 const pianoOptions=pianos.map(p=>`<option value="${(p.display_name||`${p.brand||""} ${p.model||""}`.trim()).replaceAll('"',"&quot;")}">${p.serial_no||""} ${p.location||""}</option>`).join("");
 const isEdit=!!row;
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=isEdit?"Edit planned job / Tervezett munka szerkesztése":"New planned job / Új tervezett munka";
 $("#form").innerHTML=`<div class="form-grid">
   <div class="field"><label>${req("Type / Típus")}</label><select name="planned_type">${optionTags(plannedJobTypes,row?.planned_type||plannedJobTypes[1])}</select></div>
   <div class="field"><label>${req("Title / Munka neve")}</label><input name="title" value="${row?.title||""}" required></div>
   <div class="field"><label>${req("Client / Ügyfél")}</label><input id="plannedClientName" name="client_name" list="plannedClientList" value="${row?.client_name||""}" required><datalist id="plannedClientList">${clientOptions}</datalist></div>
   <div class="field"><label>Client phone / Telefon</label><input id="plannedClientPhone" name="client_phone" value="${row?.client_phone||""}"></div>
   <div class="field"><label>Piano / Zongora</label><input name="piano_name" list="plannedPianoList" value="${row?.piano_name||""}"><datalist id="plannedPianoList">${pianoOptions}</datalist></div>
   <div class="field"><label>Address / Cím</label><input id="plannedAddress" name="service_address" value="${row?.service_address||""}"></div>
   <div class="field"><label>Preferred responsible / Tervezett felelős</label><select name="preferred_assigned_user_id">${workerSelectOptions(row?.preferred_assigned_user_id,row?.preferred_assigned_to)}</select></div>
   <div class="field"><label>Priority / Prioritás</label><select name="priority">${["Critical","Urgent","High","Medium","Low"].map(n=>`<option ${row?.priority===n?"selected":""}>${n}</option>`).join("")}</select></div>
   <div class="field"><label>Expected revenue / Várható bevétel</label><input name="expected_revenue" type="number" value="${row?.expected_revenue||0}"></div>
   <div class="field"><label>Probability / Valószínűség</label><select name="probability">${optionTags(plannedJobProbabilities,row?.probability||plannedJobProbabilities[0])}</select></div>
   <div class="field"><label>${bi("Estimated duration","Tervezett időtartam")}</label><input id="plannedEstimatedDuration" type="text" inputmode="numeric" value="${formatDurationInput(estimatedMinutes)}" pattern="[0-9]{1,3}[:.][0-5][0-9]" placeholder="3:05" required><input name="estimated_hours" type="hidden" value="${estimatedMinutes/60}"><small>${bi("Format: hours:minutes, in 5-minute steps.","Formátum: óra:perc, 5 perces lépésekben.")}</small></div>
   <div class="field"><label>Target date / Cél dátum</label><input name="target_date" type="date" value="${row?.target_date||""}"></div>
   <div class="field"><label>Status / Állapot</label><select name="status">${optionTags(plannedJobStatuses,row?.status||plannedJobStatuses[1])}</select></div>
   <div class="field full"><label>Block reason / Elakadás oka</label><input name="block_reason" value="${row?.block_reason||""}" placeholder="Waiting for parts / Alkatrészre vár, client delay..."></div>
   <div class="field full"><label>Next step / Következő lépés</label><input name="next_step" value="${row?.next_step||""}"></div>
   <div class="field full"><label>Notes / Megjegyzés</label><textarea name="notes">${row?.notes||""}</textarea></div>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Save / Mentés</button></div>`;
 const clientInput=document.getElementById("plannedClientName"), phoneInput=document.getElementById("plannedClientPhone"), addressInput=document.getElementById("plannedAddress");
 function fillClient(){const c=contacts.find(x=>(x.name||"").trim().toLowerCase()===(clientInput.value||"").trim().toLowerCase()); if(c){phoneInput.value=c.phone||phoneInput.value||""; addressInput.value=c.address||addressInput.value||"";}}
 clientInput.addEventListener("change",fillClient); clientInput.addEventListener("blur",fillClient);
 $("#form").onsubmit=async e=>{
   e.preventDefault();
   const body=Object.fromEntries(new FormData(e.target));
   const durationMinutes=parseDurationInput(document.getElementById("plannedEstimatedDuration")?.value);
   if(!Number.isFinite(durationMinutes)||durationMinutes<5){showError("INVALID_PLANNED_DURATION");return;}
   body.expected_revenue=Number(body.expected_revenue||0); body.estimated_hours=durationMinutes/60;
   const c=contacts.find(x=>(x.name||"").trim().toLowerCase()===(body.client_name||"").trim().toLowerCase()); if(c) body.client_id=c.id;
   const p=pianos.find(x=>(x.display_name||`${x.brand||""} ${x.model||""}`.trim()).trim().toLowerCase()===(body.piano_name||"").trim().toLowerCase()); if(p) body.piano_id=p.id;
   try{if(isEdit) await api(`/api/planned-jobs/${row.id}`,{method:"PUT",body:JSON.stringify(body)}); else await api("/api/planned-jobs",{method:"POST",body:JSON.stringify(body)}); closeModal(); await renderPlannedJobs();}catch(err){showError(err)}
 };
}
function openPlannedJobDetails(x){
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Planned job details / Tervezett munka részletei";
 $("#form").innerHTML=`<div class="work-card">
   <h4>${x.planned_key||""} · ${x.title||""}</h4>
   <p><b>Type / Típus:</b> ${x.planned_type||""}</p><p><b>Client / Ügyfél:</b> ${x.client_name||""}</p><p><b>Phone / Telefon:</b> ${x.client_phone||""}</p><p><b>Piano / Zongora:</b> ${x.piano_name||""}</p><p><b>Address / Cím:</b> ${x.service_address||""}</p><p><b>Responsible / Felelős:</b> ${workerDisplayName(x.preferred_assigned_user_id,x.preferred_assigned_to)||""}</p><p><b>Priority / Prioritás:</b> ${badge(x.priority||"Medium")}</p><p><b>Status / Állapot:</b> ${x.status||""}</p><p><b>Expected revenue / Várható bevétel:</b> ${money(x.expected_revenue||0)} · <b>Probability:</b> ${plannedProbabilityNumber(x)}% · <b>Weighted:</b> ${money(plannedWeightedRevenue(x))}</p><p><b>Estimated duration / Tervezett időtartam:</b> <span data-i18n-exempt>${formatDurationLabel(Math.round(Number(x.estimated_hours||0)*60))}</span></p><p><b>Target date / Cél dátum:</b> ${x.target_date||""}</p><p><b>Block reason / Elakadás oka:</b> ${x.block_reason||""}</p><p><b>Next step / Következő lépés:</b> ${x.next_step||""}</p><p><b>Notes / Megjegyzés:</b><br>${x.notes||""}</p>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Close / Bezár</button><button type="button" onclick='openPlannedJob(${esc(x)})'>Edit / Szerkesztés</button><button type="button" onclick='openConvertPlannedJob(${esc(x)})'>Convert to Scheduled Job / Áthelyezés naptárba</button>${isSuperadmin()?`<button type="button" class="danger" onclick="archivePlannedJob('${x.id}')">Delete / Törlés</button>`:`<button type="button" class="danger" onclick="archivePlannedJob('${x.id}')">Archive / Archiválás</button>`}</div>`;
 $("#form").onsubmit=e=>e.preventDefault();
}
async function openConvertPlannedJob(x){
 await loadSchedulerWorkers();
 const plannedMinutes=Math.max(5,Math.round(Number(x.estimated_hours||2)*60/5)*5);
 const start=roundWallClockUp(newYorkNowLocal(),5);const end=addWallClockMinutes(start,plannedMinutes);
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Convert to Scheduled Job / Áthelyezés naptárba";
 $("#form").innerHTML=`<p class="muted">A rendszer backend oldalon ellenőrzi, hogy a kiválasztott felelős szabad-e az adott időintervallumban.</p><div class="form-grid">
   <div class="field"><label>${req("Title / Munka neve")}</label><input name="title" value="${x.title||""}" required></div>
   <div class="field"><label>${req("Assigned to / Felelős")}</label><select id="convertAssignedUser" name="assigned_user_id">${workerSelectOptions(x.preferred_assigned_user_id,x.preferred_assigned_to)}</select><small class="worker-availability-hint" aria-live="polite"></small></div>
   <div class="field"><label>${req("Start / Kezdés")}</label><input id="convertJobStart" name="start_time" type="datetime-local" value="${start}" step="300" required></div>
   <div class="field"><label>${req("End / Befejezés")}</label><input id="convertJobEnd" name="end_time" type="datetime-local" value="${end}" step="300" required></div>
   <div class="field"><label>Final agreed amount / Végleges megbeszélt összeg</label><input name="planned_amount" type="number" value="${x.expected_revenue||0}"></div>
   <div class="field"><label>${bi("Planned duration","Tervezett időtartam")}</label><input id="convertPlannedDuration" type="text" inputmode="numeric" value="${formatDurationInput(plannedMinutes)}" pattern="[0-9]{1,3}[:.][0-5][0-9]" placeholder="3:05" required><input id="convertPlannedHours" name="planned_hours" type="hidden" value="${plannedMinutes/60}"><input id="convertPlannedMinutes" name="planned_minutes" type="hidden" value="${plannedMinutes}"></div>
   <div class="field full"><label>${req("Service address / Cím")}</label><input name="service_address" value="${x.service_address||""}" required></div>
   <div class="field full"><label>Instructions / Instrukció</label><textarea name="instructions">${x.next_step||x.notes||""}</textarea></div>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Convert / Naptárba helyezés</button></div>`;
 const convertStart=document.getElementById("convertJobStart"),convertEnd=document.getElementById("convertJobEnd"),convertDuration=document.getElementById("convertPlannedDuration");
 const syncEnd=()=>{const minutes=parseDurationInput(convertDuration.value);if(Number.isFinite(minutes)&&minutes>=5){document.getElementById("convertPlannedMinutes").value=String(minutes);document.getElementById("convertPlannedHours").value=String(minutes/60);convertEnd.value=addWallClockMinutes(convertStart.value,minutes);}};
 const syncDuration=()=>{const minutes=wallClockDifferenceMinutes(convertStart.value,convertEnd.value);if(minutes>0){convertDuration.value=formatDurationInput(minutes);document.getElementById("convertPlannedMinutes").value=String(minutes);document.getElementById("convertPlannedHours").value=String(minutes/60);}};
 convertDuration.addEventListener("change",syncEnd);convertStart.addEventListener("change",syncEnd);convertEnd.addEventListener("change",syncDuration);
 bindWorkerAvailability(document.getElementById("convertAssignedUser"),convertStart,convertEnd);
 $("#form").onsubmit=async e=>{
   e.preventDefault();
   const body=Object.fromEntries(new FormData(e.target));
   const durationMinutes=parseDurationInput(convertDuration.value);
   body.planned_amount=Number(body.planned_amount||0);body.planned_minutes=durationMinutes;body.planned_hours=durationMinutes/60;
   if(wallClockDifferenceMinutes(body.start_time,body.end_time)<=0){showError("INVALID_TIME_RANGE");return;}
   if(!isFiveMinuteDateTime(body.start_time)||!isFiveMinuteDateTime(body.end_time)){showError("INVALID_TIME_STEP");return;}
   if(!Number.isFinite(durationMinutes)||durationMinutes<5){showError("INVALID_PLANNED_DURATION");return;}
   try{const r=await api(`/api/planned-jobs/${x.id}/convert`,{method:"POST",body:JSON.stringify(body)}); await appAlert(`${bi("Scheduled job created","Naptári munka létrejött")}: ${r.job?.job_key||r.job?.id||""}`,"success"); closeModal(); currentWeekStart=startOfWeek(new Date(body.start_time)); await renderScheduler();}catch(err){showError(err)}
 };
}
async function archivePlannedJob(id){
 if(!await appConfirm(bi("Archive this planned job?","Archiváljuk ezt a tervezett munkát?"),{confirmText:bi("Archive","Archiválás")}))return;
 try{await api(`/api/planned-jobs/${id}`,{method:"DELETE"}); closeModal(); await renderPlannedJobs();}catch(err){showError(err)}
}
function exportPlannedJobsCSV(){
 api("/api/planned-jobs?include_all=1").then(data=>{if(!data.length){appAlert(bi("No data","Nincs adat"),"info");return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="planned_jobs.csv";a.click()})
}

async function renderInventory(){
 const target=forceShowView("inventory");
 let items=[]; let status={};
 try{items=await api("/api/inventory");}catch(e){items=[];}
 try{status=await api("/api/inventory/check-status");}catch(e){status={};}
 const locations=[...new Set(items.map(x=>x.location).filter(Boolean))].sort();
 const dueClass=status.status==="OVERDUE"?"danger-text":(status.status==="DUE_SOON"?"warning-text":"");
 const canExport=user.role==="ADMIN"||user.role==="SUPERADMIN";
 target.innerHTML=`<div class="panel inventory-check-panel">
   <div class="toolbar">
     <div>
       <h3>Inventory / Leltár</h3>
       <p class="muted">Belső eszköz-, alkatrész-, gép- és anyagnyilvántartás.</p>
     </div>
     <div><button onclick="openInventoryItem()">+ Add inventory item / Új leltári tétel</button>${canExport?` <button class="small" onclick="exportInventoryPDF()">Export Inventory PDF / Leltár PDF</button>`:""}</div>
   </div>
   <div class="inventory-status-grid">
     <div class="kpi"><span>Next inventory check / Következő leltár</span><strong class="${dueClass}">${status.nextDue||"—"}</strong></div>
     <div class="kpi"><span>Status / Állapot</span><strong class="${dueClass}">${status.status==="OVERDUE"?"Overdue / Lejárt":status.status==="DUE_SOON"?"Due soon / Esedékes":"OK"}</strong></div>
     <div class="kpi"><span>Last inventory / Utolsó leltár</span><strong>${status.lastInventory?.check_date||"—"}</strong><small>${status.lastInventory?.completed_by||""}</small></div>
     <div class="kpi"><span>Total value / Összes érték</span><strong>${money(items.reduce((s,x)=>s+invValue(x),0))}</strong></div>
   </div>
   <div class="actions left-actions"><button type="button" onclick="markInventoryCompleted()">✓ Mark Inventory Completed / Leltár elvégezve</button></div>
 </div>
 <div class="panel">
   <div class="toolbar"><h3>Inventory Items / Leltári tételek</h3><button class="small" onclick="clearInventoryFilters()">Clear filters / Szűrők törlése</button></div>
   <div class="finance-filters inventory-filters">
     <input id="invSearch" placeholder="Search / Keresés" oninput="applyInventoryFilters()">
     <select id="invMainCategory" onchange="applyInventoryFilters()"><option value="">All main categories / Minden főkategória</option>${optionTags(inventoryMainCategories)}</select>
     <select id="invPartCategory" onchange="applyInventoryFilters()"><option value="">All piano parts / Minden zongoraalkatrész</option>${optionTags(pianoPartCategories)}</select>
     <select id="invStatus" onchange="applyInventoryFilters()"><option value="">All statuses / Minden státusz</option>${optionTags(inventoryStatuses)}</select>
     <select id="invCondition" onchange="applyInventoryFilters()"><option value="">All conditions / Minden állapot</option>${optionTags(inventoryConditions)}</select>
     <select id="invLocation" onchange="applyInventoryFilters()"><option value="">All locations / Minden hely</option>${optionTags(locations)}</select>
   </div>
   <div id="inventoryTableWrap"></div>
 </div>`;
 renderInventoryTable(items);
 window.__inventoryItems=items;
}
function renderInventoryTable(items){
 const wrap=document.getElementById("inventoryTableWrap");
 if(!wrap)return;
 const rows=items.map(x=>`<tr>
   <td><b>${x.inventory_id||""}</b></td>
   <td>${x.item_name||""}<br><small class="muted">${x.notes||""}</small></td>
   <td>${x.main_category||""}</td>
   <td>${x.piano_part_category||""}</td>
   <td>${Number(x.quantity||0)} ${x.unit||""}</td>
   <td>${x.condition_status||""}</td>
   <td>${x.location||""}</td>
   <td>${invStatusBadge(x.status)}</td>
   <td>${money(x.purchase_price||0)}</td>
   <td>${money(x.manufacturing_cost||0)}</td>
   <td>${money(invValue(x))}</td>
   <td><button class="small" onclick='openInventoryItem(${esc(x)})'>Edit / Szerkesztés</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteInventoryItem('${x.id}')">Delete / Törlés</button>`:""}</td>
 </tr>`).join("");
 wrap.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Inventory ID / Leltár ID</th><th>Name / Név</th><th>Main category / Főkategória</th><th>Piano part / Zongoraalkatrész</th><th>Qty / Mennyiség</th><th>Condition / Állapot</th><th>Location / Hely</th><th>Status / Státusz</th><th>Purchase / Beszerzés</th><th>Manufacturing / Gyártás</th><th>Total value / Összérték</th><th>Actions / Műveletek</th></tr></thead><tbody>${rows||`<tr><td colspan="12" class="muted">No inventory items / Nincs leltári tétel.</td></tr>`}</tbody></table></div>`;
}
function applyInventoryFilters(){
 const all=window.__inventoryItems||[];
 const q=(document.getElementById("invSearch")?.value||"").toLowerCase().trim();
 const mc=document.getElementById("invMainCategory")?.value||"";
 const pc=document.getElementById("invPartCategory")?.value||"";
 const st=document.getElementById("invStatus")?.value||"";
 const co=document.getElementById("invCondition")?.value||"";
 const lo=document.getElementById("invLocation")?.value||"";
 const filtered=all.filter(x=>{
   const hay=[x.inventory_id,x.item_name,x.main_category,x.piano_part_category,x.supplier,x.manufacturer,x.location,x.notes].join(" ").toLowerCase();
   return (!q||hay.includes(q)) && (!mc||x.main_category===mc) && (!pc||x.piano_part_category===pc) && (!st||x.status===st) && (!co||x.condition_status===co) && (!lo||x.location===lo);
 });
 renderInventoryTable(filtered);
}
function clearInventoryFilters(){["invSearch","invMainCategory","invPartCategory","invStatus","invCondition","invLocation"].forEach(id=>{const el=document.getElementById(id); if(el) el.value="";}); applyInventoryFilters();}
async function openInventoryItem(row=null){
 const isEdit=!!row;
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=isEdit?"Edit inventory item / Leltári tétel szerkesztése":"New inventory item / Új leltári tétel";
 $("#form").innerHTML=`<div class="form-grid">
   <div class="field"><label>Inventory ID / Leltár azonosító</label><input value="${row?.inventory_id||"Automatically generated / Automatikusan generált"}" disabled></div>
   <div class="field"><label>${req("Item name / Tétel neve")}</label><input name="item_name" value="${row?.item_name||""}" required></div>
   <div class="field"><label>${req("Main category / Főkategória")}</label><select name="main_category">${optionTags(inventoryMainCategories,row?.main_category||"Other / Egyéb")}</select></div>
   <div class="field"><label>Piano part category / Zongoraalkatrész kategória</label><select name="piano_part_category"><option value="">—</option>${optionTags(pianoPartCategories,row?.piano_part_category||"")}</select></div>
   <div class="field"><label>Item type / Tétel típusa</label><input name="item_type" value="${row?.item_type||""}"></div>
   <div class="field"><label>Acquisition type / Beszerzés módja</label><select name="acquisition_type">${optionTags(acquisitionTypes,row?.acquisition_type||"Existing stock / Meglévő készlet")}</select></div>
   <div class="field"><label>Supplier / Beszállító</label><input name="supplier" value="${row?.supplier||""}"></div>
   <div class="field"><label>Manufacturer / Gyártó</label><input name="manufacturer" value="${row?.manufacturer||""}"></div>
   <div class="field"><label>Purchase price / Beszerzési ár</label><input name="purchase_price" type="number" step="0.01" value="${row?.purchase_price||0}"></div>
   <div class="field"><label>Manufacturing cost / Gyártási költség</label><input name="manufacturing_cost" type="number" step="0.01" value="${row?.manufacturing_cost||0}"></div>
   <div class="field"><label>Quantity / Darabszám</label><input name="quantity" type="number" step="0.01" value="${row?.quantity||1}"></div>
   <div class="field"><label>Unit / Mértékegység</label><input name="unit" value="${row?.unit||"piece"}"></div>
   <div class="field"><label>Condition / Állapot</label><select name="condition_status">${optionTags(inventoryConditions,row?.condition_status||"Used / Használt")}</select></div>
   <div class="field"><label>Location / Hely</label><input name="location" value="${row?.location||""}" placeholder="Workshop shelf A / Műhely polc A"></div>
   <div class="field"><label>Status / Státusz</label><select name="status">${optionTags(inventoryStatuses,row?.status||"In Stock / Készleten")}</select></div>
   <div class="field full"><label>Notes / Megjegyzés</label><textarea name="notes">${row?.notes||""}</textarea></div>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Save / Mentés</button></div>`;
 $("#form").onsubmit=async e=>{
   e.preventDefault();
   const body=Object.fromEntries(new FormData(e.target));
   ["purchase_price","manufacturing_cost","quantity"].forEach(k=>body[k]=Number(body[k]||0));
   try{
     if(isEdit) await api(`/api/inventory/${row.id}`,{method:"PUT",body:JSON.stringify(body)});
     else await api("/api/inventory",{method:"POST",body:JSON.stringify(body)});
     closeModal(); await renderInventory();
   }catch(err){showError(err)}
 };
}
async function deleteInventoryItem(id){
 if(!isSuperadmin())return showError("PERMISSION_DENIED");
 if(!await appConfirm(bi("Delete this inventory item?","Töröljük ezt a leltári tételt?"),{type:"error",confirmText:bi("Delete","Törlés")}))return;
 try{await api(`/api/inventory/${id}`,{method:"DELETE"}); await renderInventory();}catch(err){showError(err)}
}
async function markInventoryCompleted(){
 if(!await appConfirm(bi("Mark the quarterly inventory as completed today?","Leltár elvégezve mai dátummal?"),{confirmText:bi("Mark completed","Megjelölés elvégzettként")}))return;
 try{const r=await api("/api/inventory/complete",{method:"POST",body:JSON.stringify({})}); await appAlert(bi(`Inventory completed. Next due: ${r.nextDue}`,`A leltár elvégezve. Következő esedékesség: ${r.nextDue}`),"success"); await renderInventory();}catch(err){showError(err)}
}
async function exportInventoryPDF(){
 const items=await api("/api/inventory");
 const status=await api("/api/inventory/check-status").catch(()=>({}));
 const totalValue=items.reduce((s,x)=>s+invValue(x),0);
 const generated=new Date().toLocaleString("en-US",{timeZone:"America/New_York"});
 const rows=items.map(x=>`<tr><td>${x.inventory_id||""}</td><td>${x.item_name||""}</td><td>${x.main_category||""}</td><td>${x.piano_part_category||""}</td><td>${Number(x.quantity||0)} ${x.unit||""}</td><td>${x.condition_status||""}</td><td>${x.location||""}</td><td>${x.status||""}</td><td>${money(x.purchase_price||0)}</td><td>${money(x.manufacturing_cost||0)}</td><td>${money(invValue(x))}</td><td>${x.notes||""}</td></tr>`).join("");
 const win=window.open("","_blank");
 win.document.write(`<!doctype html><html><head><title>Klavierhaus Inventory Report</title><style>body{font-family:Arial,sans-serif;color:#111;padding:24px}h1{margin-bottom:4px}.meta{border-bottom:2px solid #111;margin-bottom:16px;padding-bottom:10px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #999;padding:5px;text-align:left;vertical-align:top}th{background:#eee}.summary{display:flex;gap:18px;margin:12px 0}.box{border:1px solid #999;padding:10px;border-radius:6px}</style></head><body><div class="meta"><h1>Klavierhaus Inventory Report / Leltárjelentés</h1><p><b>Inventory date / Leltár dátuma:</b> ${status.today||""}</p><p><b>Generated / Export ideje:</b> ${generated}</p><p><b>Exported by / Exportálta:</b> ${user.name}</p></div><div class="summary"><div class="box"><b>Total items / Tételek száma:</b> ${items.length}</div><div class="box"><b>Total estimated value / Összes becsült érték:</b> ${money(totalValue)}</div><div class="box"><b>Next inventory / Következő leltár:</b> ${status.nextDue||""}</div></div><table><thead><tr><th>Inventory ID</th><th>Item name</th><th>Main category</th><th>Piano part</th><th>Quantity</th><th>Condition</th><th>Location</th><th>Status</th><th>Purchase price</th><th>Manufacturing cost</th><th>Total value</th><th>Notes</th></tr></thead><tbody>${rows||`<tr><td colspan="12">No inventory items.</td></tr>`}</tbody></table><script>window.onload=function(){window.print();}</script></body></html>`);
 win.document.close();
}


function notificationBellMarkup(id='notificationBell'){
 return `<button id="${id}" class="notification-bell" type="button" aria-label="${bi('Notifications','Értesítések')}" title="${bi('Notifications','Értesítések')}" onclick="openNotifications()">🔔<span class="notification-badge ${notificationUnreadCount>0?'':'hidden'}">${notificationUnreadCount||0}</span></button>`;
}
function notificationText(row,field){
 const languageField=currentLang==='hu'?`${field}_hu`:`${field}_en`;
 return row?.custom_message || row?.[languageField] || row?.[`${field}_en`] || row?.[`${field}_hu`] || '';
}
function notificationIcon(type){
 return ({DIRECT_MESSAGE:'✎',JOB_ASSIGNED:'＋',JOB_TRANSFERRED:'⇄',SUBTASK_TRANSFERRED:'↳',JOB_UPDATED:'✦',JOB_DELETED:'✕',JOB_STARTING_IN_ONE_HOUR:'◷'})[type]||'🔔';
}
function formatNotificationTime(value){
 if(!value)return '';
 const d=new Date(String(value).replace(' ','T')+'Z');
 if(Number.isNaN(d.getTime()))return String(value);
 return new Intl.DateTimeFormat(currentLang==='hu'?'hu-HU':'en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(d);
}
async function syncSystemAppBadge(count){
 const safeCount=Math.max(0,Number(count||0));
 try{
  if('setAppBadge' in navigator){
   if(safeCount>0) await navigator.setAppBadge(safeCount);
   else if('clearAppBadge' in navigator) await navigator.clearAppBadge();
  }
 }catch(error){console.debug('App badge API unavailable:',error?.message||error);}
 try{
  if('serviceWorker' in navigator){
   const registration=await navigator.serviceWorker.ready;
   const worker=navigator.serviceWorker.controller||registration.active||registration.waiting;
   worker?.postMessage({type:'SET_BADGE',count:safeCount});
  }
 }catch(error){console.debug('Service worker badge sync unavailable:',error?.message||error);}
}
function setNotificationBadges(count){
 notificationUnreadCount=Math.max(0,Number(count||0));
 document.querySelectorAll('.notification-badge').forEach(b=>{b.textContent=notificationUnreadCount;b.classList.toggle('hidden',notificationUnreadCount===0);});
 void syncSystemAppBadge(notificationUnreadCount);
}
async function refreshNotificationCount(){
 if(!token)return;
 try{const result=await api('/api/notifications/count');setNotificationBadges(result.count);}catch(error){console.warn('Notification count unavailable:',error.message);}
}
function updateMobileGlobalNotificationBell(){
 const bell=document.getElementById('mobileGlobalNotificationBell');
 if(!bell)return;
 const mobile=isMobileAppViewport();
 const useLocalHeader=currentView==='today'||currentView==='notifications';
 bell.classList.toggle('hidden',!mobile||useLocalHeader||!token);
 bell.onclick=openNotifications;
}
function openNotifications(){closeMobileMore();render('notifications');}
function initNotificationCenter(){
 const desktop=document.getElementById('desktopNotificationBell');if(desktop)desktop.onclick=openNotifications;const mobileGlobal=document.getElementById('mobileGlobalNotificationBell');if(mobileGlobal)mobileGlobal.onclick=openNotifications;updateMobileGlobalNotificationBell();
 if(notificationPollTimer)clearInterval(notificationPollTimer);
 refreshNotificationCount();notificationPollTimer=setInterval(()=>{if(document.visibilityState!=="hidden")refreshNotificationCount()},30000);
 if(!window.__khNotificationSwListenerBound){navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='OPEN_NOTIFICATIONS')openNotifications();if(event.data?.type==='NOTIFICATION_COUNT')setNotificationBadges(event.data.count);});window.__khNotificationSwListenerBound=true;}
 if(new URLSearchParams(location.search).get('openNotifications')==='1')setTimeout(openNotifications,100);if(!window.__khNotificationResizeBound){window.addEventListener('resize',updateMobileGlobalNotificationBell,{passive:true});window.__khNotificationResizeBound=true;}
 if(!window.__khNotificationVisibilityBound){document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshNotificationCount()});window.__khNotificationVisibilityBound=true;}
}
async function renderNotifications(){
 const box=ensureView('notifications');
 try{currentNotifications=await api('/api/notifications');setNotificationBadges(currentNotifications.length);}catch(error){box.innerHTML=`<div class="panel"><p>${htmlText(error.message)}</p></div>`;return;}
 const pushButton=`<button type="button" class="small" onclick="enablePushNotifications()">${bi('Enable push notifications','Push értesítések engedélyezése')}</button>`;
 const cards=currentNotifications.map(row=>`<button type="button" class="notification-card" onclick="openNotificationDetail('${row.id}')"><span class="notification-card-icon">${notificationIcon(row.notification_type)}</span><span><strong>${htmlText(notificationText(row,'title'))}</strong><p>${htmlText(notificationText(row,'body'))}</p><small>${htmlText(formatNotificationTime(row.created_at))}</small></span></button>`).join('');
 box.innerHTML=`${mobileBackHeader(bi('Notifications','Értesítések'))}<div class="panel notification-center"><div class="toolbar"><h3>${bi('Notifications','Értesítések')}</h3>${pushButton}</div>${cards||`<div class="empty-notifications"><div class="empty-notifications-icon">🔔</div><h3>${bi('No notifications','Nincsenek értesítések')}</h3><p>${bi('You currently have no active notifications.','Jelenleg nincs aktív értesítésed.')}</p></div>`}</div>`;
}
function parseNotificationMetadata(row){try{return JSON.parse(row?.metadata_json||'{}')}catch(_e){return {}}}
async function openNotificationDetail(id){
 const row=currentNotifications.find(n=>String(n.id)===String(id));if(!row)return;
 const meta=parseNotificationMetadata(row);
 $('#modal').classList.remove('hidden');$('#modalTitle').textContent=notificationText(row,'title')||bi('Notification','Értesítés');
 const jobButton=row.related_job_id?`<button type="button" class="ghost-btn" onclick="openNotificationJob('${row.related_job_id}')">${bi('Open related job','Kapcsolódó munka megnyitása')}</button>`:'';
 $('#form').innerHTML=`<div class="notification-detail"><button type="button" class="notification-detail-close" onclick="closeModal()" aria-label="${bi('Close','Bezárás')}">×</button><div class="notification-detail-meta"><span>${notificationIcon(row.notification_type)}</span><small>${htmlText(formatNotificationTime(row.created_at))}</small></div><p>${htmlText(notificationText(row,'body'))}</p>${row.sender_name?`<p class="muted"><strong>${bi('Sender','Feladó')}:</strong> ${htmlText(row.sender_name)}</p>`:''}${meta.client_name?`<p class="muted"><strong>${bi('Client','Ügyfél')}:</strong> ${htmlText(meta.client_name)}</p>`:''}<div class="actions">${jobButton}<button type="button" onclick="acknowledgeNotification('${row.id}')">${bi('Acknowledged','Tudomásul vettem')}</button></div></div>`;
}
async function acknowledgeNotification(id){
 try{const ack=await api(`/api/notifications/${encodeURIComponent(id)}/acknowledge`,{method:'POST'});if(navigator.serviceWorker?.ready){navigator.serviceWorker.ready.then(reg=>reg.active?.postMessage({type:'ACKNOWLEDGE_NOTIFICATION',notificationId:id,count:Number(ack.count||0)})).catch(()=>{});}closeModal();currentNotifications=currentNotifications.filter(n=>String(n.id)!==String(id));setNotificationBadges(Number(ack.count??currentNotifications.length));await renderNotifications();}catch(error){showError(error);}
}
async function openNotificationJob(jobId){
 try{const job=await api(`/api/jobs/${encodeURIComponent(jobId)}`);closeModal();openJobDetails(job);}catch(error){showError(error);}
}
async function openDirectMessage(selectedUser=null){
 let users=[];try{users=await api('/api/users');}catch(error){return showError(error);}
 const active=users.filter(u=>String(u.status||'Active')==='Active');
 $('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Send message','Üzenet küldése');
 $('#form').innerHTML=`<div class="form-grid"><div class="field full"><label>${bi('Recipient','Címzett')}</label><select name="recipient_user_id" required>${active.map(u=>`<option value="${htmlText(u.id)}" ${String(selectedUser?.id||'')===String(u.id)?'selected':''}>${htmlText(u.name)} · ${htmlText(u.email||'')}</option>`).join('')}</select></div><div class="field full"><label>${bi('Message','Üzenet')}</label><textarea name="message" maxlength="250" rows="6" required oninput="updateMessageCounter(this)"></textarea><small id="messageCharacterCounter" class="character-counter">0 / 250</small></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Send','Küldés')}</button></div>`;
 enhanceCustomSelects($('#form'));
 $('#form').onsubmit=async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(event.target));try{await api('/api/notifications/message',{method:'POST',body:JSON.stringify(body)});closeModal();showToast(bi('Message sent.','Az üzenet elküldve.'),'success');if(String(body.recipient_user_id)===String(user.id))await refreshNotificationCount();}catch(error){showError(error);}};
}
function updateMessageCounter(textarea){const counter=document.getElementById('messageCharacterCounter');if(counter)counter.textContent=`${textarea.value.length} / 250`;}
function urlBase64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
async function enablePushNotifications(){return enableMandatoryNotifications();}
async function renderUsers(){
 let u=await api("/api/users");
 const canAdd=isAdmin();
 const rows=u.map(x=>{
   const isMe=x.id===user.id;
   const profileBtn=isMe?`<button class="small" onclick='openUser(${esc(x)},true)'>${tr("myProfile")}</button>`:"";
   const editBtn=isAdmin()?` <button class="small" onclick='openUser(${esc(x)},false)'>${tr("editUser")}</button>`:"";
   const messageBtn=` <button class="small icon-message-btn" title="${bi("Send message","Üzenet küldése")}" aria-label="${bi("Send message","Üzenet küldése")}" onclick='openDirectMessage(${esc(x)})'>✎</button>`;
   const deleteBtn=isSuperadmin()?` <button class="small danger-btn" onclick="deleteUser('${x.id}')">${bi("Delete","Törlés")}</button>`:"";
   const resendBtn=isAdmin()&&x.activation_status==="PENDING"?` <button class="small" onclick="resendUserActivation('${x.id}')">${bi("Resend activation code","Aktiválókód újraküldése")}</button>`:"";
   const color=workerColor(x.name,x.calendar_color);
   const activation=x.activation_status==="PENDING"?bi("Pending activation","Aktiválásra vár"):bi("Verified","Ellenőrzött");
   return `<tr><td>${htmlText(x.name||"")}</td><td>${htmlText(x.email||"")}</td><td>${htmlText(x.contact_email||"")}</td><td>${htmlText(x.google_calendar_email||"")}</td><td>${htmlText(x.role||"")}</td><td><span class="user-color-cell"><i class="user-color-swatch" style="--user-color:${color}" aria-hidden="true"></i><span>${color}</span></span></td><td>${htmlText(x.phone||"")}</td><td>${htmlText(x.address||"")}</td><td>${htmlText(x.status||"")}</td><td><span class="activation-status ${x.activation_status==="PENDING"?"pending":"verified"}">${activation}</span></td><td>${profileBtn}${editBtn}${messageBtn}${resendBtn}${deleteBtn}</td></tr>`;
 }).join("");
 $("#users").innerHTML=`<div class="panel"><div class="toolbar"><h3>${tr("users")}</h3>${canAdd?`<button onclick="openUser(null,false)">+ ${tr("addUser")}</button>`:""}</div><div class="table-wrap"><table><thead><tr><th>${bi("Name","Név")}</th><th>${bi("ERP login email","ERP belépési e-mail")}</th><th>${bi("Contact email","Kapcsolattartási e-mail")}</th><th>${bi("Google Calendar email","Google Naptár e-mail")}</th><th>${bi("Role","Szerepkör")}</th><th>${bi("Calendar color","Naptárszín")}</th><th>${tr("phone")}</th><th>${tr("address")}</th><th>${bi("Status","Állapot")}</th><th>${bi("Account verification","Fiókellenőrzés")}</th><th>${tr("actions")}</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
 applyLanguageToDOM(document.getElementById("users"));
}
function openUser(row=null, selfProfile=false){
 const isEdit=!!row;
 const canFullEdit=isAdmin() && isEdit && !selfProfile;
 const canCreate=!isEdit && isAdmin();
 if(!isEdit && !canCreate) return showError("PERMISSION_DENIED");
 if(isEdit && !canFullEdit && row.id!==user.id) return showError("PERMISSION_DENIED");
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=isEdit?(selfProfile?tr("myProfile"):tr("editUser")):tr("addUser");
 let roleOptions=["ADMIN","MANAGER","WORKER"];
 const roleField = canFullEdit || !isEdit ? `<div class="field"><label>${bi("Role","Szerepkör")}</label><select name="role">${roleOptions.map(r=>`<option ${row?.role===r?"selected":""}>${r}</option>`).join("")}</select></div>` : "";
 const statusField = canFullEdit ? `<div class="field"><label>${bi("Status","Állapot")}</label><select name="status"><option ${row?.status==="Active"?"selected":""}>Active</option><option ${row?.status==="Inactive"?"selected":""}>Inactive</option></select></div>` : "";
 const colorField = (canFullEdit || canCreate) ? `<div class="field calendar-color-field"><label>${bi("Calendar color","Naptárszín")}</label><input name="calendar_color" type="color" value="${workerColor(row?.name||"",row?.calendar_color||"#0891B2")}" required><small class="calendar-color-help">${bi("Reserved status colors cannot be selected: orange, green, red and gray.","A lefoglalt állapotszínek nem választhatók: narancssárga, zöld, piros és szürke.")}</small></div>` : "";
 const preferenceFields=selfProfile?`<div class="field profile-preferences"><label>${bi("Language","Nyelv")}</label><select name="profile_language"><option value="en" ${currentLang==="en"?"selected":""}>American English</option><option value="hu" ${currentLang==="hu"?"selected":""}>Magyar</option></select></div><div class="field profile-preferences"><label>${bi("Appearance","Megjelenés")}</label><select name="profile_theme"><option value="dark" ${currentTheme==="dark"?"selected":""}>${bi("Dark","Sötét")}</option><option value="light" ${currentTheme==="light"?"selected":""}>${bi("Light","Világos")}</option></select></div><div class="field full profile-role-info"><label>${bi("Role","Szerepkör")}</label><input value="${htmlText(row?.role||user?.role||"")}" disabled></div>`:"";
 const passwordRequired=isEdit?"":"required";
 const passwordHelp=isEdit?`<small>${tr("leaveEmpty")}</small>`:"";
 const passwordFields=`<div class="field user-password-field"><label for="userPassword">${isEdit?tr("newPassword"):tr("password")}</label><div class="password-field"><input id="userPassword" name="password" type="password" autocomplete="new-password" ${passwordRequired}><button id="toggleUserPassword" class="password-toggle" type="button" aria-label="${bi("Show password","Jelszó megjelenítése")}" title="${bi("Show password","Jelszó megjelenítése")}" aria-pressed="false"></button></div>${passwordHelp}</div><div class="field user-password-field"><label for="userPasswordConfirmation">${isEdit?bi("Confirm new password","Új jelszó megerősítése"):bi("Confirm password","Jelszó megerősítése")}</label><div class="password-field"><input id="userPasswordConfirmation" name="password_confirmation" type="password" autocomplete="new-password" ${passwordRequired}><button id="toggleUserPasswordConfirmation" class="password-toggle" type="button" aria-label="${bi("Show password","Jelszó megjelenítése")}" title="${bi("Show password","Jelszó megjelenítése")}" aria-pressed="false"></button></div>${passwordHelp}</div>`;
 const contactEmailRequired=!isEdit||row?.activation_status==="PENDING"?"required":"";
 $("#form").innerHTML=`<div class="form-grid"><div class="field"><label>${bi("Name","Név")}</label><input name="name" value="${htmlText(row?.name||"")}" required></div><div class="field"><label>${bi("ERP login email","ERP belépési e-mail")}</label><input name="email" type="email" value="${htmlText(row?.email||"")}" required autocomplete="username" autocapitalize="none" spellcheck="false"><small>${bi("This may be an internal .local address used only for ERP login.","Ez lehet kizárólag ERP-belépéshez használt belső .local cím.")}</small></div><div class="field full"><label>${bi("Real contact and activation email","Valódi kapcsolattartási és aktiválási e-mail")}</label><input name="contact_email" type="email" value="${htmlText(row?.contact_email||"")}" ${contactEmailRequired} autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="employee@example.com"><small>${bi("The one-time activation code is sent here. A .local address cannot be used.","Az egyszeri aktiválókód erre a címre érkezik. .local cím itt nem használható.")}</small></div><div class="field full"><label>${bi("Google Calendar email","Google Naptár e-mail")}</label><input name="google_calendar_email" type="email" value="${htmlText(row?.google_calendar_email||"")}" placeholder="${bi("Example: employee@gmail.com","Példa: munkatars@gmail.com")}"><small>${bi("Events created with this address in the shared Klavierhaus Work calendar are assigned to this employee.","A közös Klavierhaus Work naptárban ezzel a címmel létrehozott események ehhez a munkatárshoz kerülnek.")}</small></div>${passwordFields}<div class="field"><label>${tr("phone")}</label><input name="phone" value="${htmlText(row?.phone||"")}"></div><div class="field full"><label>${tr("address")}</label><input name="address" value="${htmlText(row?.address||"")}"></div>${roleField}${statusField}${colorField}${preferenceFields}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Cancel","Mégse")}</button><button>${isEdit?tr("saveChanges"):tr("createUser")}</button></div>`;
 initializePasswordVisibilityToggle(document.getElementById("userPassword"),document.getElementById("toggleUserPassword"));
 initializePasswordVisibilityToggle(document.getElementById("userPasswordConfirmation"),document.getElementById("toggleUserPasswordConfirmation"));
 $("#form").onsubmit=async e=>{
  e.preventDefault();
  try{
   let body=Object.fromEntries(new FormData(e.target));
   const selectedLanguage=body.profile_language;
   const selectedTheme=body.profile_theme;
   delete body.profile_language;delete body.profile_theme;
   body.email=String(body.email||"").trim().toLowerCase();
   body.contact_email=String(body.contact_email||"").trim().toLowerCase();
   if(body.password!==body.password_confirmation)return showError("PASSWORD_CONFIRMATION_MISMATCH");
   const passwordChanged=Boolean(body.password);
   if(isEdit&&!passwordChanged){delete body.password;delete body.password_confirmation;}
   if(body.calendar_color){body.calendar_color=String(body.calendar_color).toUpperCase();if(reservedCalendarColors.includes(body.calendar_color))return showError("RESERVED_CALENDAR_COLOR");}
   let saved;
   if(isEdit)saved=await api(`/api/users/${row.id}`,{method:"PUT",body:JSON.stringify(body)});
   else saved=await api("/api/users",{method:"POST",body:JSON.stringify(body)});
   const {password_updated:_passwordUpdated,email_delivery_error:_deliveryError,activation_delivery_status:_deliveryStatus,...savedUser}=saved;
   if(isEdit&&row.id===user.id){
    user={...user,...savedUser};localStorage.setItem("kh_user",JSON.stringify(user));document.getElementById("userInfo").textContent=`${user.name} · ${user.role}`;
    if(selfProfile){if(selectedLanguage)setLanguage(selectedLanguage);if(selectedTheme)setTheme(selectedTheme);}
   }
   schedulerWorkersCache=null;currentSchedulerWorker=null;closeModal();
   if(!isEdit&&saved.activation_delivery_status!=="ACCEPTED")showToast(bi("User created, but the activation email was not sent. Configure email delivery, then use Resend activation code.","A felhasználó létrejött, de az aktiváló e-mail nem ment ki. Állítsd be az e-mail-küldést, majd használd az Aktiválókód újraküldése gombot."),"error");
   else showToast(isEdit?(passwordChanged?bi("User and password updated successfully.","A felhasználó és a jelszó módosítása sikeres."):bi("User updated successfully.","A felhasználó módosítása sikeres.")):bi("User created and the activation code was sent.","A felhasználó létrejött, az aktiválókódot elküldtük."),"success");
   if(currentView==="users"&&isAdmin())renderUsers();
  }catch(err){showError(err);}
 };
}
async function resendUserActivation(id){
 if(!isAdmin())return showError("PERMISSION_DENIED");
 if(!await appConfirm(bi("Send a new activation code? The previous code will become invalid.","Küldjünk új aktiválókódot? A korábbi kód érvénytelenné válik."),{type:"warning",confirmText:bi("Send new code","Új kód küldése")}))return;
 try{await api(`/api/users/${encodeURIComponent(id)}/resend-activation`,{method:"POST"});showToast(bi("A new activation code has been sent.","Az új aktiválókódot elküldtük."),"success");await renderUsers();}catch(error){showError(error);}
}
async function deleteUser(id){if(!isSuperadmin())return showError("PERMISSION_DENIED");if(!await appConfirm(bi("Delete this user permanently?","Véglegesen töröljük ezt a felhasználót?"),{type:"error",confirmText:bi("Delete permanently","Végleges törlés")}))return;try{await api(`/api/users/${id}`,{method:"DELETE"});await renderUsers();}catch(err){showError(err)}}

const friendlyErrors={
 en:{PERMISSION_DENIED:"You do not have permission to perform this action.",REQUIRED_FIELDS:"Please complete all required fields.",INVALID_FILE_TYPE:"The selected file is not a valid PDF, JPG, JPEG, or PNG file.",FILE_TOO_LARGE:"The selected file exceeds the 20 MB size limit.",INVALID_PASSWORD:"The password is incorrect.",BACKUP_NOT_FOUND:"The selected backup could not be found.",RESTORE_CONFIRMATION_REQUIRED:"Type RESTORE BACKUP exactly to confirm the restore.",SUPERADMIN_PERMISSIONS_FIXED:"Superadmin permissions cannot be reduced.",PWA_LOGO_REQUIREMENTS:"Use a PNG, JPG, or JPEG image at least 192×192 pixels. Non-square images are automatically centered on a square canvas for the PWA icon.",INVALID_TIME_RANGE:"The end time must be later than the start time. Past dates and times are allowed.",INVALID_TIME_STEP:"Times must use 5-minute steps (00, 05, 10, ...).",INVALID_PLANNED_DURATION:"Enter the planned duration as hours:minutes in 5-minute steps (for example 3:05).",INVALID_USER_ROLE:"Select Administrator, Manager, or Worker as the role.",INVALID_CALENDAR_COLOR:"Select a valid calendar color.",RESERVED_CALENDAR_COLOR:"This color is reserved for job statuses. Choose a different employee color.",JOB_ALREADY_CLOSED:"This job step has already been closed and cannot be closed again.",WORKFLOW_ALREADY_FINALIZED:"This workflow has already been fully closed.",PARTIAL_CLOSE_NEXT_JOB_REQUIRED:"A partial close requires the complete next job, including its responsible employee and time range."},
 hu:{PERMISSION_DENIED:"Nincs jogosultságod ehhez a művelethez.",REQUIRED_FIELDS:"Kérlek, tölts ki minden kötelező mezőt.",INVALID_FILE_TYPE:"A kiválasztott fájl nem érvényes PDF-, JPG-, JPEG- vagy PNG-fájl.",FILE_TOO_LARGE:"A kiválasztott fájl meghaladja a 20 MB-os mérethatárt.",INVALID_PASSWORD:"A megadott jelszó hibás.",BACKUP_NOT_FOUND:"A kiválasztott biztonsági mentés nem található.",RESTORE_CONFIRMATION_REQUIRED:"A visszaállításhoz pontosan ezt írd be: RESTORE BACKUP.",SUPERADMIN_PERMISSIONS_FIXED:"A szuperadmin jogosultságai nem csökkenthetők.",PWA_LOGO_REQUIREMENTS:"Legalább 192×192 képpontos PNG-, JPG- vagy JPEG-képet használj. A nem négyzetes képet a rendszer automatikusan négyzetes PWA-ikonba igazítja.",INVALID_TIME_RANGE:"A befejezés időpontjának későbbinek kell lennie a kezdésnél. Korábbi dátum és időpont megadható.",INVALID_TIME_STEP:"Az időpontokat 5 perces lépésekben add meg (00, 05, 10, ...).",INVALID_PLANNED_DURATION:"A tervezett időtartamot óra:perc formában, 5 perces lépésekben add meg (például 3:05).",INVALID_USER_ROLE:"Szerepkörként Admin, Manager vagy Worker választható.",INVALID_CALENDAR_COLOR:"Válassz érvényes naptárszínt.",RESERVED_CALENDAR_COLOR:"Ez a szín a munkaállapotok számára van lefoglalva. Válassz másik munkavállalói színt.",JOB_ALREADY_CLOSED:"Ezt a munkalépést már lezárták, ezért nem zárható le újra.",WORKFLOW_ALREADY_FINALIZED:"Ezt a teljes munkafolyamatot már véglegesen lezárták.",PARTIAL_CLOSE_NEXT_JOB_REQUIRED:"Részleges lezáráskor kötelező a következő munka, a felelős munkatárs és az időintervallum teljes megadása."}
};
function showToast(message,type="info"){
 let host=document.querySelector('.toast-host');if(!host){host=document.createElement('div');host.className='toast-host';document.body.appendChild(host);}
 const toast=document.createElement('div');toast.className=`app-toast ${type}`;toast.innerHTML=`<span>${type==='error'?'!':type==='success'?'✓':'i'}</span><p>${htmlText(message)}</p>`;host.appendChild(toast);requestAnimationFrame(()=>toast.classList.add('show'));setTimeout(()=>{toast.classList.remove('show');setTimeout(()=>toast.remove(),250)},3200);
}
function localizedErrorMessage(error){
 const code=String(error?.message||error||"");const details=error?.details||{};
 const userManagementErrors={
  en:{INVALID_LOGIN:"Login failed. Check your email address and password.",ACCOUNT_INACTIVE:"This user account is inactive. Contact an administrator.",ACCOUNT_ROLE_INVALID:"This account has an invalid role. Contact the superadministrator.",USER_EMAIL_CONFLICT:"More than one account uses this email address. The superadministrator must resolve the duplicate before login.",USER_EMAIL_ALREADY_USED:"This ERP email address is already assigned to another user.",INVALID_USER_EMAIL:"Enter a valid ERP login email address.",INVALID_CONTACT_EMAIL:"Enter a real contact email address. Internal .local addresses cannot receive activation messages.",CONTACT_EMAIL_ALREADY_USED:"This contact email address is already assigned to another user.",ACTIVATION_CONTACT_EMAIL_MISSING:"This account has no valid contact email. Ask an administrator to add one.",INVALID_ACTIVATION_SESSION:"The activation session is no longer valid. Return to login and sign in again.",INVALID_ACTIVATION_CODE:"Enter the correct six-digit activation code.",ACTIVATION_ALREADY_COMPLETED:"This account is already verified. Return to login.",ACTIVATION_NOT_REQUIRED:"This account does not require activation.",ACTIVATION_TEMPORARILY_LOCKED:"Too many incorrect codes were entered. Try again in 15 minutes.",ACTIVATION_RESEND_TOO_SOON:"Please wait one minute before requesting another activation code.",EMAIL_DELIVERY_NOT_CONFIGURED:"Transactional email is not configured on the server. Contact the superadministrator.",EMAIL_DELIVERY_FAILED:"The activation email could not be sent. Please try again or contact the superadministrator.",USER_CREATE_FAILED:"The user could not be created. No partial user record was saved.",USER_NOT_FOUND:"The selected user could not be found.",PASSWORD_CONFIRMATION_MISMATCH:"The two password fields must match exactly, including uppercase and lowercase letters.",PASSWORD_UPDATE_FAILED:"The password could not be saved. No changes were applied.",USER_UPDATE_FAILED:"The user could not be updated. No changes were applied.",LOGIN_SERVICE_UNAVAILABLE:"The login service is temporarily unavailable. Please try again."},
  hu:{INVALID_LOGIN:"Sikertelen belépés. Ellenőrizd az e-mail-címet és a jelszót.",ACCOUNT_INACTIVE:"Ez a felhasználói fiók inaktív. Fordulj egy adminisztrátorhoz.",ACCOUNT_ROLE_INVALID:"A fiók szerepköre érvénytelen. Fordulj a szuperadminisztrátorhoz.",USER_EMAIL_CONFLICT:"Ehhez az e-mail-címhez több fiók tartozik. A belépés előtt a szuperadminisztrátornak fel kell oldania a duplikációt.",USER_EMAIL_ALREADY_USED:"Ez az ERP e-mail-cím már egy másik felhasználóhoz tartozik.",INVALID_USER_EMAIL:"Adj meg érvényes ERP belépési e-mail-címet.",INVALID_CONTACT_EMAIL:"Adj meg valódi kapcsolattartási e-mail-címet. A belső .local címekre nem küldhető aktiváló üzenet.",CONTACT_EMAIL_ALREADY_USED:"Ez a kapcsolattartási e-mail-cím már egy másik felhasználóhoz tartozik.",ACTIVATION_CONTACT_EMAIL_MISSING:"Ehhez a fiókhoz nincs érvényes kapcsolattartási e-mail-cím. Kérd egy adminisztrátor segítségét.",INVALID_ACTIVATION_SESSION:"Az aktiválási munkamenet már nem érvényes. Térj vissza, majd jelentkezz be újra.",INVALID_ACTIVATION_CODE:"Add meg a helyes, hatjegyű aktiválókódot.",ACTIVATION_ALREADY_COMPLETED:"Ezt a fiókot már ellenőrizték. Térj vissza a belépéshez.",ACTIVATION_NOT_REQUIRED:"Ehhez a fiókhoz nem szükséges aktiválás.",ACTIVATION_TEMPORARILY_LOCKED:"Túl sok hibás kódot adtál meg. Próbáld újra 15 perc múlva.",ACTIVATION_RESEND_TOO_SOON:"Új aktiválókód kérése előtt várj egy percet.",EMAIL_DELIVERY_NOT_CONFIGURED:"A tranzakciós e-mail-küldés nincs beállítva a szerveren. Fordulj a szuperadminisztrátorhoz.",EMAIL_DELIVERY_FAILED:"Az aktiváló e-mailt nem sikerült elküldeni. Próbáld újra, vagy fordulj a szuperadminisztrátorhoz.",USER_CREATE_FAILED:"A felhasználót nem sikerült létrehozni. Részleges felhasználói rekord nem maradt az adatbázisban.",USER_NOT_FOUND:"A kiválasztott felhasználó nem található.",PASSWORD_CONFIRMATION_MISMATCH:"A két jelszómezőnek pontosan egyeznie kell, a kis- és nagybetűket is beleértve.",PASSWORD_UPDATE_FAILED:"A jelszó mentése sikertelen. A rendszer nem alkalmazta a módosításokat.",USER_UPDATE_FAILED:"A felhasználó módosítása sikertelen. A rendszer nem alkalmazta a módosításokat.",LOGIN_SERVICE_UNAVAILABLE:"A bejelentkezési szolgáltatás átmenetileg nem érhető el. Próbáld újra."}
 };
 if(userManagementErrors[currentLang]?.[code])return userManagementErrors[currentLang][code];
 const googleErrors={
  en:{INVALID_GOOGLE_CALENDAR_EMAIL:"Enter a valid Google Calendar email address.",GOOGLE_CALENDAR_EMAIL_ALREADY_USED:"This Google Calendar email is already assigned to another employee.",GOOGLE_EVENT_ASSIGNEE_REQUIRED:"Assign the imported event to an active employee before completing the review.",GOOGLE_EVENT_CONFLICT_UNRESOLVED:"Resolve the schedule conflict before completing the review.",GOOGLE_SOURCE_EVENT_CANCELLED:"The Google source event was cancelled. Edit or delete the ERP job as appropriate.",GOOGLE_CALENDAR_NOT_CONFIGURED:"The Google Calendar server settings are incomplete.",GOOGLE_CALENDAR_NOT_CONNECTED:"Google Calendar is not connected."},
  hu:{INVALID_GOOGLE_CALENDAR_EMAIL:"Adj meg érvényes Google Naptár e-mail-címet.",GOOGLE_CALENDAR_EMAIL_ALREADY_USED:"Ez a Google Naptár e-mail-cím már egy másik munkatárshoz tartozik.",GOOGLE_EVENT_ASSIGNEE_REQUIRED:"Az ellenőrzés befejezése előtt rendeld az importált eseményt aktív munkatárshoz.",GOOGLE_EVENT_CONFLICT_UNRESOLVED:"Az ellenőrzés befejezése előtt oldd fel az időpontütközést.",GOOGLE_SOURCE_EVENT_CANCELLED:"A forrásként szolgáló Google-eseményt törölték. Szükség szerint módosítsd vagy töröld az ERP-munkát.",GOOGLE_CALENDAR_NOT_CONFIGURED:"A Google Naptár szerverbeállításai hiányosak.",GOOGLE_CALENDAR_NOT_CONNECTED:"A Google Naptár nincs csatlakoztatva."}
 };
 if(googleErrors[currentLang]?.[code])return googleErrors[currentLang][code];
 if(code==="SELF_SCHEDULE_CONFLICT"){
  const c=details.conflict||{};
  return bi(`You cannot take this job because you already have another job at this time${c.title?`: ${c.title}`:""}.`,`Ezt a munkát nem veheted fel, mert erre az időpontra már van másik munkád${c.title?`: ${c.title}`:""}.`);
 }
 if(code==="WORKER_SCHEDULE_CONFLICT"){
  const c=details.conflict||{},name=details.assigned_name||c.assigned_to||bi("The selected employee","A kiválasztott munkatárs");
  const interval=c.start_time&&c.end_time?`${String(c.start_time).replace("T"," ")} – ${String(c.end_time).replace("T"," ")}`:"";
  return bi(`${name} already has another job${interval?` at ${interval}`:""}${c.title?`: ${c.title}`:""}.`,`${name} munkatársnak${interval?` ${interval} között`:""} már van másik munkája${c.title?`: ${c.title}`:""}.`);
 }
 const friendly=(friendlyErrors[currentLang]||friendlyErrors.en)[code];
 if(friendly)return friendly;
 if(code.includes(" / "))return splitBilingualText(code);
 return code||bi("An unexpected error occurred.","Váratlan hiba történt.");
}
function showError(error){return appAlert(localizedErrorMessage(error),"error");}
async function renderSettings(){
 if(!isAdmin()) return showError('PERMISSION_DENIED');
 const box=$("#settings"), [p,b,g]=await Promise.all([api('/api/settings/permissions'),api('/api/settings/branding'),api('/api/google-calendar/status')]);
 const labels={'scheduler.view':bi('View scheduler','Naptár megtekintése'),'planned_jobs.view':bi('View planned jobs','Tervezett munkák megtekintése'),'contacts.view':bi('View clients','Ügyfelek megtekintése'),'pianos.view':bi('View pianos','Zongorák megtekintése'),'closed_jobs.view':bi('View closed jobs','Lezárt munkák megtekintése'),'knowledge_base.view':bi('View invoices','Számlák megtekintése'),'finance.view':bi('View finance','Pénzügy megtekintése'),'income_statement.view':bi('View income statement','Eredménykimutatás megtekintése'),'inventory.view':bi('View inventory','Leltár megtekintése'),'users.view':bi('View users','Felhasználók megtekintése'),'users.create':bi('Add employees','Munkavállaló hozzáadása'),'users.roles':bi('Assign or remove roles','Szerepkör adása vagy elvétele'),'permissions.manage':bi('Manage role permissions','Szerepkör-jogosultságok kezelése'),'audit.view':bi('View audit log','Módosítási napló megtekintése')};
 const matrix=p.roles.filter(r=>r!=='SUPERADMIN').map(role=>`<div class="permission-card"><h4>${role}</h4>${p.permissions.map(pm=>{const row=p.rows.find(x=>x.role===role&&x.permission===pm);return `<label class="permission-row"><input type="checkbox" ${row?.enabled?'checked':''} onchange="setRolePermission('${role}','${pm}',this.checked)"><span>${labels[pm]||pm}</span></label>`}).join('')}</div>`).join('');
 const backupRows=await api('/api/backups');
 const backups=`<div class="panel"><div class="toolbar"><h3>${bi('Backups','Biztonsági mentések')}</h3>${isSuperadmin()?`<button onclick="createBackupNow()">${bi('Create backup now','Mentés készítése most')}</button>`:''}</div><div class="table-wrap"><table><thead><tr><th>${bi('Created','Létrehozva')}</th><th>${bi('File','Fájl')}</th><th>${bi('Status','Állapot')}</th><th>${bi('Actions','Műveletek')}</th></tr></thead><tbody>${backupRows.map(x=>`<tr><td>${x.created_at||''}</td><td>${x.file_name}</td><td>${x.status||''}</td><td>${isSuperadmin()?`<button class="small" onclick="downloadBackup('${x.id}')">${bi('Download','Letöltés')}</button><button class="small danger-btn" onclick="restoreBackup('${x.id}')">${bi('Restore','Visszaállítás')}</button>`:`<span class="muted">${bi('View only','Csak megtekintés')}</span>`}</td></tr>`).join('')||`<tr><td colspan="4" class="muted">${bi('No backups yet.','Még nincs biztonsági mentés.')}</td></tr>`}</tbody></table></div></div>`;
 const googleCard=`<div class="panel google-calendar-settings"><div class="toolbar"><div><h3>${bi('Google Calendar integration','Google Naptár-integráció')}</h3><p class="muted">${bi('One-way: Google → ERP. ERP changes are never sent back to Google.','Egyirányú: Google → ERP. Az ERP-módosítások soha nem kerülnek vissza a Google-be.')}</p></div><span class="integration-status ${g.connected?'connected':'disconnected'}">${g.connected?bi('Connected','Csatlakoztatva'):bi('Disconnected','Nincs csatlakoztatva')}</span></div><div class="integration-details"><p><b>${bi('Shared calendar','Közös naptár')}:</b> ${htmlText(g.calendar_summary||'Klavierhaus Work')}</p><p><b>${bi('Central account','Központi fiók')}:</b> ${htmlText(g.central_email||'klavierhauswork@gmail.com')}</p><p><b>${bi('Last synchronization','Utolsó szinkronizálás')}:</b> ${htmlText(g.last_sync_at||bi('Not yet','Még nem történt'))}</p>${g.last_error?`<p class="integration-error"><b>${bi('Last error','Utolsó hiba')}:</b> ${htmlText(g.last_error)}</p>`:''}</div>${!g.configured?`<div class="settings-warning">${bi('Server setup is incomplete. Add the GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_ENCRYPTION_KEY and APP_BASE_URL environment variables, then restart Render.','A szerverbeállítás hiányos. Add hozzá a GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_ENCRYPTION_KEY és APP_BASE_URL környezeti változókat, majd indítsd újra a Render szolgáltatást.')}</div>`:''}<div class="actions">${isSuperadmin()&&g.configured&&!g.connected?`<button onclick="connectGoogleCalendar()">${bi('Connect Google Calendar','Google Naptár csatlakoztatása')}</button>`:''}${g.connected?`<button onclick="syncGoogleCalendarNow()">${bi('Synchronize now','Szinkronizálás most')}</button>`:''}${isSuperadmin()&&g.connected?`<button class="danger-btn" onclick="disconnectGoogleCalendar()">${bi('Disconnect','Leválasztás')}</button>`:''}</div><small>${bi('Employees must create work events in the shared Klavierhaus Work calendar. Their profile Google Calendar email determines the initial assignee.','A munkatársaknak a közös Klavierhaus Work naptárban kell létrehozniuk a munkaeseményeket. A profiljuk Google Naptár e-mail-címe határozza meg a kezdeti felelőst.')}</small></div>`;
 box.innerHTML=`${mobileBackHeader(bi('Settings','Beállítások'))}${googleCard}<div class="panel branding-panel"><h3>${bi('Branding','Arculat')}</h3><div class="branding-preview"><img src="${versionedBrandAsset(b.logo_url)}" alt="logo"><div><b>${b.company_name}</b><small>${b.short_name}</small></div></div><form onsubmit="saveBranding(event)" class="form-grid"><label>${bi('Company name','Cégnév')}<input name="company_name" value="${String(b.company_name||'').replaceAll('"','&quot;')}" required></label><label>${bi('Short app name','Rövid alkalmazásnév')}<input name="short_name" value="${String(b.short_name||'').replaceAll('"','&quot;')}" required></label><div class="actions"><button type="submit">${bi('Save identity','Arculat mentése')}</button></div></form><form onsubmit="uploadBrandLogo(event)" class="branding-logo-form"><input id="brandingLogoInput" type="file" name="logo" accept="image/png,image/jpeg,.jpg,.jpeg" onchange="previewBrandLogo(this)" required><small class="branding-upload-help">${bi('PNG, JPG, or JPEG; minimum 192×192 px. Non-square images are automatically padded to a square icon.','PNG, JPG vagy JPEG; minimum 192×192 px. A nem négyzetes képet a rendszer automatikusan négyzetes ikonba igazítja.')}</small><button type="submit">${bi('Upload logo and PWA icon','Logó és PWA-ikon feltöltése')}</button><button type="button" class="small" onclick="resetBrandLogo()">${bi('Restore KH logo','KH-logó visszaállítása')}</button></form><hr><h4>${bi('Login background','Bejelentkezési háttérkép')}</h4><div class="login-background-preview" style="${b.login_background_url?`background-image:linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.25)),url('${versionedBrandAsset(b.login_background_url)}')`:''}"></div><form onsubmit="uploadLoginBackground(event)" class="branding-logo-form"><input type="file" name="background" accept="image/png,image/jpeg,.jpg,.jpeg" required><button type="submit">${bi('Upload login background','Bejelentkezési háttérkép feltöltése')}</button><button type="button" class="small" onclick="resetLoginBackground()">${bi('Restore default background','Alapértelmezett háttér visszaállítása')}</button></form></div><div class="panel"><h3>${bi('Roles and Permissions','Szerepkörök és jogosultságok')}</h3><div class="permission-grid">${matrix}</div></div>${backups}`;
}
async function connectGoogleCalendar(){try{const result=await api('/api/google-calendar/auth-url');location.href=result.url;}catch(error){showError(error)}}
async function syncGoogleCalendarNow(){try{const result=await api('/api/google-calendar/sync',{method:'POST'});showToast(bi(`Synchronization complete: ${result.imported} imported, ${result.updated} updated, ${result.flagged} flagged.`,`Szinkronizálás kész: ${result.imported} importálva, ${result.updated} frissítve, ${result.flagged} megjelölve.`),'success');renderSettings();}catch(error){showError(error)}}
async function disconnectGoogleCalendar(){if(!isSuperadmin())return;if(!await appConfirm(bi('Disconnect the central Google Calendar account? Imported ERP jobs will be kept.','Leválasztod a központi Google Naptár-fiókot? Az importált ERP-munkák megmaradnak.'),{type:'warning',confirmText:bi('Disconnect','Leválasztás')}))return;try{await api('/api/google-calendar/disconnect',{method:'DELETE'});showToast(bi('Google Calendar disconnected.','A Google Naptár leválasztva.'),'success');renderSettings();}catch(error){showError(error)}}
async function saveBranding(e){e.preventDefault();const body=Object.fromEntries(new FormData(e.target));branding=await api('/api/settings/branding',{method:'PUT',body:JSON.stringify(body)});applyBranding();showToast(bi('Branding saved.','Arculat elmentve.'),'success');renderSettings();}
function readImageFile(file){
 return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};
  img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('INVALID_FILE_TYPE'))};
  img.src=url;
 });
}
async function prepareBrandLogoFile(file){
 if(!file) throw new Error('INVALID_FILE_TYPE');
 if(!['image/png','image/jpeg'].includes(file.type) && !/\.(png|jpe?g)$/i.test(file.name||'')) throw new Error('INVALID_FILE_TYPE');
 const img=await readImageFile(file);
 if(img.naturalWidth<192 || img.naturalHeight<192) throw new Error('PWA_LOGO_REQUIREMENTS');
 const side=Math.max(img.naturalWidth,img.naturalHeight);
 const canvas=document.createElement('canvas');
 canvas.width=side; canvas.height=side;
 const ctx=canvas.getContext('2d');
 ctx.clearRect(0,0,side,side);
 const x=(side-img.naturalWidth)/2, y=(side-img.naturalHeight)/2;
 ctx.drawImage(img,x,y,img.naturalWidth,img.naturalHeight);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',0.95));
 if(!blob) throw new Error('INVALID_FILE_TYPE');
 const clean=(file.name||'company-logo').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]+/gi,'-');
 return new File([blob],`${clean || 'company-logo'}-square.png`,{type:'image/png'});
}
async function previewBrandLogo(input){
 const file=input?.files?.[0]; if(!file)return;
 try{
  const prepared=await prepareBrandLogoFile(file);
  const url=URL.createObjectURL(prepared);
  const img=document.querySelector('.branding-preview img');
  if(img){const old=img.dataset.previewUrl;if(old)URL.revokeObjectURL(old);img.dataset.previewUrl=url;img.src=url;}
 }catch(err){input.value='';showError(err)}
}
async function uploadBrandLogo(e){
 e.preventDefault();
 try{
  const input=e.target.querySelector('input[name="logo"]');
  const prepared=await prepareBrandLogoFile(input?.files?.[0]);
  const fd=new FormData(); fd.append('logo',prepared,prepared.name);
  branding=await api('/api/settings/branding/logo',{method:'POST',body:fd});
  await loadBranding();
  await appAlert(bi('Logo updated. Reinstall the PWA to refresh the home-screen icon.','A logó frissült. A kezdőképernyős ikon frissítéséhez telepítsd újra a PWA-t.'),'success');
  renderSettings();
 }catch(err){showError(err)}
}
async function resetBrandLogo(){branding=await api('/api/settings/branding/reset-logo',{method:'POST'});await loadBranding();renderSettings();}
async function uploadLoginBackground(e){e.preventDefault();const fd=new FormData(e.target);branding=await api('/api/settings/branding/background',{method:'POST',body:fd});await loadBranding();showToast(bi('Login background updated.','A bejelentkezési háttérkép frissült.'),'success');renderSettings();}
async function resetLoginBackground(){branding=await api('/api/settings/branding/reset-background',{method:'POST'});await loadBranding();renderSettings();}
async function renderAuditLog(){
 if(!isAdmin()&&!userPermissions.permissions.includes('audit.view')&&!userPermissions.all)return showError('PERMISSION_DENIED');
 const rows=await api(`/api/audit-log?limit=1000&type=${currentAuditType}`); const box=$('#audit_log');
 box.innerHTML=`${mobileBackHeader(bi('Audit Log','Módosítási napló'))}<div class="panel"><div class="audit-type-switch"><button class="${currentAuditType==='WORK'?'active':''}" onclick="setAuditType('WORK')">${bi('Work Audit','Munkaaudit')}</button><button class="${currentAuditType==='TECHNICAL'?'active':''}" onclick="setAuditType('TECHNICAL')">${bi('Technical Audit','Technikai audit')}</button></div><div class="toolbar"><h3>${currentAuditType==='WORK'?bi('Work Audit','Munkaaudit'):bi('Technical Audit','Technikai audit')}</h3><div>${isSuperadmin()?`<button class="small" onclick="downloadAuditLog()">${bi('Export CSV','CSV export')}</button><button class="small danger-btn" onclick="clearAuditLog()">${bi('Delete current log','Aktuális napló törlése')}</button>`:''}</div></div><div class="table-wrap"><table><thead><tr><th>${bi('Time','Idő')}</th><th>${bi('User','Felhasználó')}</th><th>${bi('Role','Szerepkör')}</th><th>${bi('Action','Művelet')}</th><th>${bi('Module','Modul')}</th><th>ID</th><th>${bi('Old value','Régi érték')}</th><th>${bi('New value','Új érték')}</th><th>${bi('Details','Részletek')}</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.event_time||''}</td><td>${x.user_name||''}</td><td>${x.user_role||''}</td><td>${x.action||''}</td><td>${x.module||''}</td><td>${x.record_id||''}</td><td>${x.old_value||''}</td><td>${x.new_value||''}</td><td>${x.details||''}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function setAuditType(type){currentAuditType=type==='TECHNICAL'?'TECHNICAL':'WORK';renderAuditLog();}
async function setRolePermission(role,permission,enabled){try{await api('/api/settings/permissions',{method:'PUT',body:JSON.stringify({role,permission,enabled})});}catch(e){showError(e);renderSettings();}}
async function downloadAuditLog(){const r=await fetch(`/api/audit-log/export?type=${currentAuditType}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return showError((await r.json()).error);const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=currentAuditType==='WORK'?'work-audit.csv':'technical-audit.csv';a.click();URL.revokeObjectURL(a.href);}
async function clearAuditLog(){if(!isSuperadmin())return;if(await appConfirm(bi('Delete the complete audit log?','Töröljük a teljes módosítási naplót?'),{type:'error',confirmText:bi('Delete log','Napló törlése')})){await api(`/api/audit-log?type=${currentAuditType}`,{method:'DELETE'});renderSettings();}}
async function createBackupNow(){try{await api('/api/backups',{method:'POST'});await appAlert(bi('Backup created successfully.','A biztonsági mentés elkészült.'),'success');renderSettings();}catch(e){showError(e)}}
async function downloadBackup(id){const r=await fetch(`/api/backups/${id}/download`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return showError((await r.json()).error);const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=r.headers.get('content-disposition')?.match(/filename="?([^";]+)/)?.[1]||'backup.sqlite';a.click();URL.revokeObjectURL(a.href);}
async function restoreBackup(id){const confirmation=await appPrompt(bi('Type RESTORE BACKUP to continue.','A folytatáshoz írd be: RESTORE BACKUP'),{type:'error',confirmText:bi('Continue','Folytatás')});if(confirmation!=='RESTORE BACKUP')return;const password=await appPrompt(bi('Enter your password.','Add meg a jelszavad.'),{type:'warning',inputType:'password',confirmText:bi('Restore backup','Mentés visszaállítása')});if(password===null)return;try{await api(`/api/backups/${id}/restore`,{method:'POST',body:JSON.stringify({confirmation,password})});await appAlert(bi('Backup restored. Restart the server now.','A mentés visszaállt. Most indítsd újra a szervert.'),'success');logoutNow();}catch(e){showError(e)}}

function initLocalizedModalRendering(){
 const modal=document.getElementById("modal"),form=document.getElementById("form");
 if(!modal||!form||window.__khModalLanguageObserver)return;
 const observer=new MutationObserver(()=>{
  modal.classList.add("i18n-rendering");
  queueMicrotask(()=>{
   applyLanguageToDOM(modal);
   modal.classList.remove("i18n-rendering");
  });
 });
 observer.observe(form,{childList:true});
 window.__khModalLanguageObserver=observer;
}

initLoginExperience();
initLocalizedModalRendering();
if(token){loadLanguage();loadTheme();boot();}else{loadLanguage();loadTheme();applyLanguageToDOM(document.getElementById("login"));loadBranding().then(()=>applyLanguageToDOM(document.getElementById("login")));}





(function incomeStatementCashflowLayoutStyle(){
 const s=document.createElement("style");
 s.textContent=`
 .cashflow-layout{display:flex;flex-direction:column;gap:18px;margin-top:18px;}
 .cf-main-title{text-align:center;padding:4px 0 0;}
 .cf-main-title h2{font-size:30px;margin:0 0 4px;}
 .cf-main-title p{margin:0;color:var(--muted);}
 .cf-upper{display:grid;grid-template-columns:1.05fr .95fr;gap:22px;align-items:stretch;}
 .cf-left-stack{display:flex;flex-direction:column;gap:18px;}
 .cf-right-stack{display:flex;flex-direction:column;gap:18px;}
 .cf-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:var(--shadow);}
 .cf-card-head{background:var(--panel-2);border-bottom:1px solid var(--line);padding:12px 16px;font-size:18px;font-weight:900;}
 .cf-card-head span{color:var(--muted);font-weight:700;font-size:14px;}
 .cf-card-body{padding:14px 18px;}
 .cf-line{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:end;border-bottom:1px solid rgba(148,163,184,.22);padding:8px 0;min-height:34px;}
 .cf-line span{font-weight:650;}
 .cf-line small{color:var(--muted);font-weight:600;}
 .cf-line b{font-variant-numeric:tabular-nums;}
 .cf-line.empty b{color:var(--muted);}
 .cf-line.big{min-height:92px;align-items:center;font-size:19px;border-bottom:0;}
 .cf-line.total{font-size:18px;font-weight:900;border-bottom:0;}
 .cf-line.cashflow{font-size:19px;font-weight:950;border-bottom:0;}
 .cf-rule{height:2px;background:var(--line);margin:18px 0;}
 .cf-bookkeeper{min-height:285px;}
 .cf-cashflow{min-height:210px;display:flex;flex-direction:column;justify-content:center;}
 .cf-balance-title{text-align:center;font-size:30px;font-weight:950;margin-top:8px;}
 .cf-balance{display:grid;grid-template-columns:1fr 1fr;gap:22px;}
 .cf-footer{max-width:560px;margin-left:auto;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:10px 18px;box-shadow:var(--shadow);}
 .no-print-break{break-inside:avoid;}
 @media(max-width:980px){
   .cf-upper,.cf-balance{grid-template-columns:1fr;}
   .cf-footer{max-width:none;width:auto;}
 }
 `;
 document.head.appendChild(s);
})();

(function forceCompletedGreenStyle(){const s=document.createElement("style");s.textContent=".cal-event.Completed,.badge.Completed{background:var(--green)!important;color:#07101d!important;}";document.head.appendChild(s);})();
