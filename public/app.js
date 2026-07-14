
let token=localStorage.getItem("kh_token");
let user=JSON.parse(localStorage.getItem("kh_user")||"null");
let currentWeekStart=startOfWeek(new Date());
let currentView="scheduler";
let currentLang="en";
let currentTheme="dark";
let currentSchedulerWorker=null;
let currentClientStatusFilter="ALL";
let currentClientPage=1;
let showOnlyMissingClientData=false;
const CLIENTS_PER_PAGE=25;
let currentPianoPage=1;
const PIANOS_PER_PAGE=25;
let currentPianoSearch="";
let currentPianoOwnershipFilter="ALL";
let currentPianoMinValue="";
let currentPianoMaxValue="";
let pianoOwnerContactsCache=[];
let schedulerWorkersCache=null;
let userPermissions={all:false,permissions:[]};

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
   appTitle:"Klavierhaus Work Management",loginSubtitle:"Calendar-first job management",email:"Email",password:"Password",login:"Login",logout:"Logout",deleteEverything:"Delete Everything",operations:"New York time based operations",logoutIn:"Logout in",securityLogout:"Security logout: you have been signed out after 10 minutes without clicking.",
   scheduler:"Scheduler",planned_jobs:"Planned Jobs",contacts:"Clients",pianos:"Pianos",closed_jobs:"Closed Jobs",knowledge_base:"Invoices",finance:"Finance",income_statement:"Income Statement",inventory:"Inventory",users:"Users", audit_log:"Audit Log", settings:"Settings", today:"Today", more:"More", newJob:"New Job", calendar:"Calendar", all:"All", workerFilter:"Worker", failed:"Failed", noClosedJobs:"No closed jobs yet", actions:"Actions", searchClients:"Search clients by name, address, or piano", searchPlaceholder:"Type at least 3 characters...", themeDark:"Dark", themeLight:"Light", myProfile:"My profile", phone:"Phone", address:"Address", newPassword:"New password", leaveEmpty:"Leave empty to keep current", saveChanges:"Save changes", createUser:"Create user", editUser:"Edit user", addUser:"Add user", customerStatus:"Status", ownerClient:"Owner", buyerLead:"Buyer lead", ownerBuyerLead:"Owner + buyer lead", generalContact:"General"
 },
 hu:{
   appTitle:"Klavierhaus munkakezelő rendszer",loginSubtitle:"Naptárközpontú munkakezelés",email:"Email",password:"Jelszó",login:"Belépés",logout:"Kilépés",deleteEverything:"Mindent töröl",operations:"New York-i időzóna szerinti működés",logoutIn:"Automatikus kilépés",securityLogout:"Biztonsági kijelentkezés: 10 perc kattintás nélküli inaktivitás miatt kijelentkeztettünk.",
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
  if(token && currentView) render(currentView); else applyLanguageToDOM();
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
  updateCountdownDisplay();
}
function splitBilingualText(text){
  if(!text || !text.includes(" / ")) return text;
  if(/\bD\s*\$?\d/i.test(text) || /\bC\s*\$?\d/i.test(text)) return text;
  const parts=text.split(" / ");
  if(parts.length<2) return text;
  return currentLang==="hu" ? parts.slice(1).join(" / ").trim() : parts[0].trim();
}
function applyLanguageToDOM(root=document.body){
  if(!root) return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
    if(!node.nodeValue || !node.nodeValue.includes(" / ")) return NodeFilter.FILTER_REJECT;
    const p=node.parentElement;
    if(!p || ["SCRIPT","STYLE","TEXTAREA"].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }});
  const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n=>{n.nodeValue=splitBilingualText(n.nodeValue)});
  document.querySelectorAll("input[placeholder],textarea[placeholder],button[title]").forEach(el=>{
    if(el.placeholder) el.placeholder=splitBilingualText(el.placeholder);
    if(el.title) el.title=splitBilingualText(el.title);
  });
  const loginBrandName=document.querySelector(".login-card [data-brand-name]");
  if(loginBrandName) loginBrandName.textContent=branding.company_name||"Klavierhaus";
  const sub=document.querySelector(".login-card p"); if(sub) sub.textContent=tr("loginSubtitle");
  const passLabel=document.querySelector('label[for="password"], #loginForm label:nth-of-type(2)'); if(passLabel) passLabel.textContent=tr("password");
  const loginBtn=document.querySelector("#loginForm button"); if(loginBtn) loginBtn.textContent=tr("login");
  const subtitle=document.getElementById("headerSubtitle"); if(subtitle) subtitle.textContent=tr("operations");
  const logoutBtn=document.getElementById("logoutBtn"); if(logoutBtn) logoutBtn.textContent=tr("logout");
  const delBtn=document.getElementById("deleteEverythingBtn"); if(delBtn) delBtn.textContent=tr("deleteEverything");
  updateLanguageButtons();
  updateThemeButtons();
  const themeDark=document.getElementById("themeDarkBtn"); if(themeDark) themeDark.title=tr("themeDark");
  const themeLight=document.getElementById("themeLightBtn"); if(themeLight) themeLight.title=tr("themeLight");
  updateCountdownDisplay();
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
const $=s=>document.querySelector(s);
const api=(url,opt={})=>fetch(url,{...opt,headers:{...(opt.body instanceof FormData?{}:{"Content-Type":"application/json"}),Authorization:"Bearer "+token,...(opt.headers||{})}}).then(async r=>{const text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch(e){j={error:text||"Non-JSON response"}}if(!r.ok)throw new Error(j.error||`API ${r.status}`);return j});

$("#loginForm").onsubmit=async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.target));const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(fd)}).then(r=>r.json());if(r.token){token=r.token;user=r.user;localStorage.setItem("kh_token",token);localStorage.setItem("kh_user",JSON.stringify(user));loadLanguage();boot()}else alert(currentLang==="hu"?"Sikertelen belépés":"Login failed")};
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
  inactivityTimer = setTimeout(()=>{
    alert(tr("securityLogout"));
    logoutNow();
  }, INACTIVITY_LIMIT_MS);
  countdownInterval=setInterval(updateCountdownDisplay,1000);
  updateCountdownDisplay();
}
document.addEventListener("click", resetInactivityTimer, true);

async function deleteEverything(){
  if(!isSuperadmin()) return alert(bi("Superadmin only","Csak szuperadmin"));
  const first = confirm(bi("WARNING\n\nThis will permanently delete ALL business data from the system.\n\nThis action cannot be undone.\n\nContinue?","FIGYELMEZTETÉS\n\nEz véglegesen töröl MINDEN üzleti adatot a rendszerből.\n\nA művelet nem visszavonható.\n\nFolytatod?"));
  if(!first) return;
  const typed = prompt(bi("Final confirmation\n\nType exactly: DELETE EVERYTHING","Végső megerősítés\n\nÍrd be pontosan: DELETE EVERYTHING"));
  if(typed !== "DELETE EVERYTHING"){
    alert(bi("Confirmation text did not match. Nothing was deleted.","A megerősítő szöveg nem egyezett. Semmi nem törlődött."));
    return;
  }
  try{
    await api("/api/system/delete-everything",{method:"POST",body:JSON.stringify({confirmation:typed})});
    alert(bi("All business data has been deleted. You will be logged out.","Minden üzleti adat törölve lett. Most kijelentkeztetünk."));
    logoutNow();
  }catch(err){alert(err.message)}
}

async function boot(){
 if(!token)return;
 await loadBranding();
 loadLanguage();
 loadTheme();
 $("#login").classList.add("hidden");
 $("#app").classList.remove("hidden");
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
 render(isMobileAppViewport()?"today":"scheduler");
 applyLanguageToDOM();
}
function toggleSidebar(){document.body.classList.toggle("sidebar-collapsed")}
function money(n){return "$"+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}
function badge(v){let c=String(v||"").split(" ")[0];return `<span class="badge ${c}">${v||""}</span>`}
function fmtDate(d){return d.toISOString().slice(0,10)}
function startOfWeek(d){let x=new Date(d);let day=x.getDay();let diff=(day===0?-6:1-day);x.setDate(x.getDate()+diff);x.setHours(0,0,0,0);return x}
function addDays(d,n){let x=new Date(d);x.setDate(x.getDate()+n);return x}
function localDT(d){
 let x=new Date(d);
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"}).formatToParts(x).reduce((a,p)=>{a[p.type]=p.value;return a},{});
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function hhmm(s){let d=new Date(s);return d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"America/New_York"})}
function sameDay(a,b){return fmtDate(new Date(a))===fmtDate(new Date(b))}
function esc(o){return JSON.stringify(o).replaceAll("'","&#39;")}
function jobRef(j){return j?.job_key || j?.id || j?.job_id || ""}
function req(t){return `${t} <span class="required">*</span>`}
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
  return workers.map(w=>`<option value="${String(w.id).replaceAll('"','&quot;')}" ${String(selectedId)===String(w.id)||(!selectedId&&String(selectedName)===String(w.name))?"selected":""}>${w.name}</option>`).join("");
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
const knownWorkerColorIndexes={"Károly":0,"Karoly":0,"Alex":1,"Misi":2,"Paul":3,"Pol":3,"Said":4};
function workerColorInfo(name){
  const n=String(name||"").trim();
  if(Object.prototype.hasOwnProperty.call(knownWorkerColorIndexes,n)) return workerColorPalette[knownWorkerColorIndexes[n]];
  const workers=(schedulerWorkersCache||[]).map(w=>String(w.name||"").trim()).filter(Boolean);
  const idx=workers.indexOf(n);
  const start=5;
  if(idx>=0) return workerColorPalette[(start+idx)%workerColorPalette.length];
  let h=0; for(let i=0;i<n.length;i++) h=(h*31+n.charCodeAt(i))>>>0;
  return workerColorPalette[(start+h)%workerColorPalette.length];
}
function workerColor(name){ return workerColorInfo(name).hex; }
function workerFilterLabel(value, workers=[]){
  if(value==="ALL") return `🟢 ◎ ${bi("All Jobs","Minden munka")}`;
  if(value==="COMPLETED") return `🟢 ✓ ${bi("Completed","Elvégzett")}`;
  if(value==="FAILED") return `🔴 ✕ ${bi("Failed / Overdue","Sikertelen / lejárt")}`;
  const id=String(value||"").replace(/^worker:/,"");
  const name=(workers.find(w=>String(w.id)===id)||{}).name||id;
  const info=workerColorInfo(name);
  return `${info.dot} ● ${name}`;
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
 if(status==="Failed" || isOverdueJob(j)) return "Failed";
 if(status==="Completed" || String(j.workflow_status||"")==="COMPLETED") return "Completed";
 if(status==="Partially completed" || String(j.workflow_status||"")==="IN_PROGRESS") return "PartiallyCompleted";
 return "WorkerColor";
}
function calendarStatusIcon(j){
 const cls=calendarEventClass(j);
 if(cls==="Completed") return "✓";
 if(cls==="Failed") return "!";
 return "◷";
}
function calendarEventStyle(j){ const cls=calendarEventClass(j); return cls==="WorkerColor" ? `style="--event-color:${workerColor(j.assigned_to)}"` : ""; }

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
 forceShowView(v);
 const pageTitle=document.getElementById("pageTitle");
 if(pageTitle) pageTitle.textContent=navLabel(v);
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
 else await renderTable(v);
 applyLanguageToDOM();
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
function mobileViewIcon(view){ return ({planned_jobs:"🗂",closed_jobs:"✅",knowledge_base:"🧾",finance:"💵",income_statement:"📊",inventory:"📦",users:"👤",audit_log:"🧾",settings:"⚙️",scheduler:"📅"})[view]||"•"; }
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
  const jobs=await api("/api/jobs"); await loadSchedulerWorkers();
  const date=nyDateKey(), dayStart=7*60, dayEnd=22*60, total=dayEnd-dayStart;
  const mine=jobs.filter(j=>String(j.start_time||"").slice(0,10)===date && (!user?.id || !j.assigned_user_id || String(j.assigned_user_id)===String(user.id)));
  const layout=calendarLayout(mine,dayStart,dayEnd);
  const quarter=Array.from({length:(dayEnd-dayStart)/15+1},(_,i)=>{const min=dayStart+i*15;return `<i class="${min%60===0?'hour':''}" style="top:${((min-dayStart)/total)*100}%"></i>`}).join('');
  const times=Array.from({length:(dayEnd-dayStart)/60+1},(_,i)=>{const min=dayStart+i*60;return `<span style="top:${((min-dayStart)/total)*100}%">${String(Math.floor(min/60)).padStart(2,'0')}:00</span>`}).join('');
  const events=layout.map(x=>{const j=x.event,top=((x.start-dayStart)/total)*100,height=((x.end-x.start)/total)*100,left=(x.lane/x.lanes)*100,width=100/x.lanes;return `<button type="button" class="timeline-event ${calendarEventClass(j)}" ${calendarEventStyle(j)} style="${calendarEventStyle(j).replace(/^style=\"|\"$/g,'')};top:${top}%;height:${height}%;left:${left}%;width:calc(${width}% - 4px)" onclick='openJobDetails(${esc(j)})'><strong>${String(j.start_time||'').slice(11,16)}–${String(j.end_time||'').slice(11,16)}</strong><b>${j.title||''}</b><small>${j.client_name||''}</small><span class="event-status">${calendarEventClass(j)==='Completed'?'✓':'◷'}</span></button>`}).join('');
  target.innerHTML=`<div class="mobile-today-shell">${mobileBackHeader(bi('Today','Ma'))}<section class="today-hero"><div><span>${bi('Today in New York','Ma New Yorkban')}</span><h2>${new Intl.DateTimeFormat(currentLang==='hu'?'hu-HU':'en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric'}).format(new Date())}</h2></div><div class="today-clock"><strong>${currentNYTimeString()}</strong><small>America/New_York</small></div></section><div class="today-list-head"><h2>${bi('My daily calendar','Napi naptáram')}</h2><button type="button" onclick="render('scheduler')">${bi('Full calendar','Teljes naptár')} →</button></div><div class="daily-calendar-scroll"><div class="daily-calendar"><div class="timeline-times">${times}</div><div class="timeline-day daily-day" data-date="${date}" onclick="handleDailySlotClick(event,'${date}',${dayStart},${dayEnd})"><div class="quarter-grid">${quarter}</div><div class="current-time-line" data-date="${date}" data-day-start="${dayStart}" data-day-end="${dayEnd}"><span></span></div>${events}</div></div></div></div>`;
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
 const jobs=await api("/api/jobs");
 const workers=await loadSchedulerWorkers();
 const visibleJobs=jobs.filter(j=>{
   if(currentSchedulerWorker==="ALL") return true;
   if(currentSchedulerWorker==="COMPLETED") return String(j.status||"")==="Completed";
   if(currentSchedulerWorker==="FAILED") return String(j.status||"")==="Failed" || isOverdueJob(j);
   if(String(currentSchedulerWorker).startsWith("worker:")) return String(j.assigned_user_id||"")===String(currentSchedulerWorker).slice(7);
   return String(j.assigned_to||"")===currentSchedulerWorker;
 });
 const week=[0,1,2,3,4,5,6].map(i=>addDays(currentWeekStart,i));
 const weekDates=week.map(d=>fmtDate(d));
 const dayStart=7*60, dayEnd=22*60, totalMinutes=dayEnd-dayStart;
 const baseOptions=["ALL","COMPLETED","FAILED"].map(v=>`<option value="${v}" ${currentSchedulerWorker===v?"selected":""}>${workerFilterLabel(v,workers)}</option>`).join("");
 const workerOptions=workers.map(w=>{const val=`worker:${String(w.id).replaceAll('"','&quot;')}`;return `<option value="${val}" ${currentSchedulerWorker===val?"selected":""}>${workerFilterLabel(val,workers)}</option>`}).join("");
 let html=`<div class="panel scheduler-panel"><div class="toolbar scheduler-toolbar"><div><h3>${bi("Weekly Scheduler","Heti naptár")}</h3><p class="muted">${weekDates[0]} – ${weekDates[6]} · America/New_York</p><div class="ny-time-box"><span>${bi("Current New York time","Aktuális New York-i idő")}</span><strong id="currentNYClock">${currentNYTimeString()}</strong></div></div><div class="scheduler-actions"><label class="inline-label">${tr("workerFilter")}<select class="worker-filter-select" onchange="currentSchedulerWorker=this.value;renderScheduler()">${baseOptions}${workerOptions}</select></label><button class="small" onclick="moveWeek(-1)">← ${bi("Previous","Előző")}</button><button class="small" onclick="goThisWeek()">${bi("This week","Aktuális hét")}</button><button class="small" onclick="moveWeek(1)">${bi("Next","Következő")} →</button><button onclick="openJob()">+ ${bi("Add Job","Új munka")}</button></div></div>
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
     html+=`<button type="button" class="timeline-event ${calendarEventClass(j)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);width:calc(${width}% - 4px);${calendarEventClass(j)==='WorkerColor'?`--event-color:${workerColor(j.assigned_to)};`:''}" onclick='event.stopPropagation();openJobDetails(${esc(j)})'><span class="event-status">${calendarStatusIcon(j)}</span><strong>${String(j.start_time||"").slice(11,16)}–${String(j.end_time||"").slice(11,16)}</strong><b>${htmlText(j.title||"")}</b><small>${htmlText(j.assigned_to||"")}</small></button>`;
   }
   html+=`</div>`;
 }
 html+=`</div></div><div class="scheduler-legend"><span class="legend-active">◷ ${bi("Scheduled / active","Ütemezett / aktív")}</span><span class="legend-partial">◷ ${bi("Part completed, workflow continues","Rész kész, folyamatban")}</span><span class="legend-complete">✓ ${bi("Fully completed","Teljesen lezárt")}</span><span class="legend-failed">! ${bi("Failed / overdue","Sikertelen / lejárt")}</span></div></div>`;
 $("#scheduler").innerHTML=html;
 updateNYClock(); updateCurrentTimeLine();
 clearInterval(window.__khTimelineTimer); window.__khTimelineTimer=setInterval(()=>{updateNYClock();updateCurrentTimeLine()},60000);
 applyLanguageToDOM();
}
function moveWeek(n){currentWeekStart=addDays(currentWeekStart,7*n);renderScheduler()} function goThisWeek(){currentWeekStart=startOfWeek(new Date());renderScheduler()}

async function openJob(prefill="", row=null){
 const start=row?.start_time || prefill || localDT(new Date());
 let e=new Date(start);e.setHours(e.getHours()+3);
 let end=row?.end_time || localDT(e);

 let contacts=[]; let pianos=[];
 try{ contacts=await api("/api/contacts"); }catch(e){}
 try{ pianos=await api("/api/pianos"); }catch(e){}
 await loadSchedulerWorkers();

 const clientOptions=contacts.map(c=>`<option value="${(c.name||"").replaceAll('"',"&quot;")}">${c.phone||""} ${c.address||""}</option>`).join("");
 const pianoOptions=pianos.map(p=>`<option value="${(`${p.brand||""} ${p.model||""}`).trim().replaceAll('"',"&quot;")}">${p.serial_no||""} ${p.location||""}</option>`).join("");

 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=row ? bi("Edit Job","Munka szerkesztése") : bi("New Job","Új munka");
 $("#form").innerHTML=`<div class="form-grid">
<div class="field"><label>${req("Job title / Munka neve")}</label><input name="title" value="${row?.title||""}" required placeholder="Piano tuning / Zongorahangolás"></div>
<div class="field"><label>${req("Assigned to / Felelős")}</label>
<select name="assigned_user_id" required>
${workerSelectOptions(row?.assigned_user_id,row?.assigned_to)}
</select></div>

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

<div class="field"><label>${req("Start / Kezdés")}</label><input id="jobStart" name="start_time" type="datetime-local" value="${start}" required></div>
<div class="field"><label>${req("End / Befejezés")}</label><input id="jobEnd" name="end_time" type="datetime-local" value="${end}" required></div>

<div class="field"><label>Estimated amount / Előzetes összeg</label><input name="planned_amount" type="number" value="${row?.planned_amount||0}"></div>
<div class="field"><label>Pricing basis / Díjmegállapítás módja</label>
<input name="pricing_basis" value="${row?.pricing_basis||""}" placeholder="Phone quote / Telefonos ajánlat, Email quote / E-mail ajánlat, Fixed agreement / Fix megállapodás"></div>

<div class="field"><label>Planned hours / Tervezett óra</label><input id="plannedHours" name="planned_hours" type="number" value="${row?.planned_hours||3}" step="0.25"></div>
<div class="field"><label>${req("Service address / Cím")}</label><input id="serviceAddressInput" name="service_address" value="${row?.service_address||""}" required></div>

<div class="field full ${row?.job_type==="Part-work"?"":"hidden"}" id="instructionsField"><label>Remaining tasks / Hátralévő feladatok</label>
<textarea name="instructions" placeholder="Csak részmunka esetén: milyen feladat marad még hátra?">${row?.instructions||""}</textarea></div>
</div>
<div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>${row?"Save changes / Módosítás mentése":"Create job / Munka létrehozása"}</button></div>`;

 const startInput=document.getElementById("jobStart");
 const endInput=document.getElementById("jobEnd");
 const hoursInput=document.getElementById("plannedHours");
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

 function setEndFromHours(){
   const s=startInput.value;
   const h=Number(hoursInput.value||0);
   if(!s || !h) return;
   let d=new Date(s);
   d.setMinutes(d.getMinutes()+Math.round(h*60));
   endInput.value=localDT(d);
 }
 function setHoursFromTimes(){
   if(!startInput.value || !endInput.value) return;
   const diff=(new Date(endInput.value)-new Date(startInput.value))/(1000*60*60);
   if(diff>0) hoursInput.value=(Math.round(diff*100)/100).toString();
 }
 hoursInput.addEventListener("change", setEndFromHours);
 startInput.addEventListener("change", ()=>{validateDateField(startInput); setEndFromHours();});
 endInput.addEventListener("change", ()=>{validateDateField(endInput); setHoursFromTimes();});

 toggleInstructionsField();
 applyLanguageToDOM(document.getElementById("modal"));

 $("#form").onsubmit=async ev=>{
   ev.preventDefault();
   let b=Object.fromEntries(new FormData(ev.target));

   if(!validateDateField(startInput) || !validateDateField(endInput)) return;
   if(new Date(b.end_time)<=new Date(b.start_time)){alert(bi("End must be after start.","A befejezés nem lehet korábbi, mint a kezdés."));return}
   if(b.job_type==="Part-work" && !(b.instructions||"").trim()){
     alert(bi("Remaining tasks are required for part-work.","Részmunka esetén a hátralévő feladatok megadása kötelező."));
     return;
   }
   ["planned_amount","planned_hours"].forEach(k=>b[k]=Number(b[k]||0));
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
     await renderScheduler();
   }catch(err){alert(err.message)}
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
 if(!val){alert(bi("Please enter the exact date.","Kérlek, add meg pontosan a dátumot.")); return false}
 if(!/^\d{4}$/.test(year)){alert(bi("Year must be exactly 4 digits.","Az évszám pontosan 4 számjegyből álljon.")); return false}
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
function openJobDetails(j){
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=bi("Job details","Munka részletei");
 const phone=j.client_phone ? `<a href="tel:${String(j.client_phone).replaceAll(" ","")}" class="phone-link">${j.client_phone}</a>` : "";
 const closed=isClosedJobStatus(j.status) || String(j.status||"")==="Cancelled";
 const actionButtons=[`<button type="button" class="ghost-btn" onclick="closeModal()">Close / Bezár</button>`];
 actionButtons.push(`<button type="button" class="ghost-btn" onclick="openWorkflowHistory('${jobRef(j)}')">${bi("Workflow history","Munkafolyamat")}</button>`);
 if(!closed){
   actionButtons.push(`<button type="button" onclick='openJob("",${esc(j)})'>Edit job / Munka szerkesztése</button>`);
   actionButtons.push(`<button type="button" onclick='openCloseJob(${esc(j)})'>Close job / Lezárás</button>`);
 }
 if(isSuperadmin()) actionButtons.push(`<button type="button" class="danger-btn" onclick="deleteJob('${jobRef(j)}')">Delete job / Munka törlése</button>`);
 $("#form").innerHTML=`<div class="work-card">
 <h4>${badge(j.priority)} ${j.title}</h4>
 <p class="muted"><b>Job key / Munkaazonosító:</b> ${j.job_key||j.id||""}</p><p><b>Work category / Munkakategória:</b> ${j.job_type==="Part-work" ? "Part-work / Részmunka" : "Standalone / Önálló munka"}</p>
 <p><b>Assigned / Felelős:</b> ${j.assigned_to}</p>
 <p><b>Client / Ügyfél:</b> ${j.client_name||j.client_id||""}</p>
 <p><b>Phone / Telefon:</b> ${phone}</p>
 <p><b>Piano / Zongora:</b> ${j.piano_name||j.piano_id||""}</p>
 <p><b>Time / Idő:</b> ${j.start_time} → ${j.end_time}</p>
 <p><b>Address / Cím:</b> ${j.service_address||""}</p>
 <p><b>Estimated / Előzetes:</b> ${money(j.planned_amount)} · ${j.pricing_basis||""}</p>
 <p><b>Status / Státusz:</b> ${badge(j.status)}</p>
 ${closed?`<p class="muted"><b>View only / Csak megtekintés:</b> ez a munka már lezárt vagy részlezárt.</p>`:""}
 ${j.job_type==="Part-work"?`<p><b>Remaining tasks / Hátralévő feladatok:</b><br>${j.instructions||""}</p>`:""}
 </div>
 <div class="actions">${actionButtons.join("")}</div>`;
 $("#form").onsubmit=e=>e.preventDefault()
}
async function openWorkflowHistory(id){
 try{
   const data=await api(`/api/jobs/${encodeURIComponent(id)}/workflow`);
   $("#modal").classList.remove("hidden"); $("#modalTitle").textContent=bi("Workflow history","Munkafolyamat története");
   $("#form").innerHTML=`<div class="workflow-history">${data.steps.map((j,i)=>`<article class="workflow-step ${calendarEventClass(j)}"><div class="workflow-step-index">${i+1}</div><div><h4>${calendarStatusIcon(j)} ${htmlText(j.title||"")}</h4><p><b>${htmlText(j.assigned_to||"")}</b> · ${String(j.start_time||"").replace("T"," ")} – ${String(j.end_time||"").replace("T"," ")}</p><p class="muted">${bi("Status","Státusz")}: ${htmlText(j.status||"")} · ${bi("Step","Lépés")}: ${j.workflow_step_no||i+1}</p>${j.close_notes?`<p>${htmlText(j.close_notes)}</p>`:""}</div></article>`).join("")}</div><div class="actions"><button type="button" onclick="closeModal()">${bi("Close","Bezárás")}</button></div>`;
   $("#form").onsubmit=e=>e.preventDefault();
 }catch(err){alert(err.message)}
}
async function deleteJob(id){
 if(!isSuperadmin()) return alert(bi("Superadmin only","Csak szuperadmin"));
 if(!confirm(bi("Delete this job from the visible system?","Töröljük ezt a munkát a látható rendszerből?"))) return;
 try{await api(`/api/jobs/${encodeURIComponent(id)}`,{method:"DELETE"}); closeModal(); await renderScheduler();}catch(err){alert(err.message)}
}
async function openReassign(j){
 await loadSchedulerWorkers();
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=bi("Reassign job","Munka átadása");
 $("#form").innerHTML=`<div class="form-grid">
 <div class="field"><label>${req("Current responsible / Jelenlegi felelős")}</label><input value="${j.assigned_to||""}" disabled></div>
 <div class="field"><label>${req("New responsible / Új felelős")}</label>
 <select name="assigned_user_id" required>
 ${workerSelectOptions(j.assigned_user_id,j.assigned_to)}
 </select></div>
 <div class="field full"><label>Reassignment note / Átadási megjegyzés</label><textarea name="reassignment_note" placeholder="Átadás vagy visszavétel oka / Reason for reassignment or take-back"></textarea></div>
 </div>
 <div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Reassign only / Csak átadás</button></div>`;
 $("#form").onsubmit=async e=>{
   e.preventDefault();
   try{
     const body=Object.fromEntries(new FormData(e.target));
     body.id=j.id; body.job_id=j.id; body.job_key=j.job_key; body.client_id=j.client_id; body.client_name=j.client_name; body.piano_name=j.piano_name; body.title=j.title;
     await api(`/api/jobs/${encodeURIComponent(jobRef(j))}/reassign`,{method:"PUT",body:JSON.stringify(body)});
     closeModal();
     await renderScheduler();
   }catch(err){alert(err.message)}
 }
}
function openCloseJob(j){$("#modalTitle").textContent=bi("Close Job","Munka lezárása");$("#form").innerHTML=`<p class="muted">Billed amount / Számlázandó összeg kötelező. Ha 0, nem kell fájl. Ha nagyobb mint 0, fizetési mód és számla/csekk fájl kötelező.</p><div class="form-grid">
<div class="field"><label>${req("Close type / Lezárás típusa")}</label><select name="close_type" id="closeType" onchange="toggleNextJob()"><option>Full</option><option>Partial</option><option>Failed</option></select></div>
<div class="field"><label>${req("Billed amount / Számlázandó összeg")}</label><input name="billed_amount" type="number" value="${j.planned_amount||0}" required></div>
<div class="field"><label>${req("Payment method / Fizetési mód")}</label><select name="payment_method" required><option value="">Select payment method / Válassz fizetési módot</option><option>Cash</option><option>Check</option><option>Bank Transfer</option><option>Credit Card</option><option>Invoice</option><option>Warranty Work</option></select></div>
<div class="field"><label>Invoice number / Számla vagy csekk szám</label><input name="invoice_number"></div><div class="field"><label>Invoice/check file / Számla vagy csekk fájl</label><input name="file" type="file"></div>
<div class="field full"><label>${req("Close description / Elvégzett munka leírása")}</label><textarea name="close_description" required></textarea></div>
<div id="nextJobFields" class="field full hidden"><h3>Next job / Következő feladat</h3><div class="form-grid"><div class="field full"><label>${req("Next title / Következő feladat neve")}</label><input name="next_title"></div><div class="field"><label>${req("Next assigned to / Következő felelős")}</label><select name="next_assigned_user_id">${workerSelectOptions(j.assigned_user_id,j.assigned_to)}</select></div><div class="field"><label>Next priority</label><select name="next_priority"><option>Critical</option><option>Urgent</option><option>High</option><option selected>Medium</option><option>Low</option></select></div><div class="field"><label>${req("Next start / Következő kezdés")}</label><input name="next_start_time" type="datetime-local"></div><div class="field"><label>${req("Next end / Következő befejezés")}</label><input name="next_end_time" type="datetime-local"></div><div class="field"><label>Next planned amount</label><input name="next_planned_amount" type="number" value="0"></div><div class="field full"><label>Next pricing basis / Következő díjmegállapítás</label><input name="next_pricing_basis"></div><div class="field full"><label>Next address / Következő cím</label><input name="next_service_address" value="${j.service_address||""}"></div><div class="field full"><label>Next instructions / Következő teendők</label><textarea name="next_instructions"></textarea></div></div></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Save closeout / Lezárás mentése</button></div>`;
$("#form").onsubmit=async e=>{e.preventDefault();let fd=new FormData(e.target);let billed=Number(fd.get("billed_amount"));let file=fd.get("file");let payment=fd.get("payment_method");if(billed>0&&!payment){alert(bi("Payment method is required when billed amount is greater than zero.","Fizetési mód kötelező, ha az összeg nagyobb mint 0."));return}if(billed>0&&(!file||!file.name)){alert(bi("An invoice/check file is required when the amount is greater than zero.","Számla/csekk fájl kötelező, ha az összeg nagyobb mint 0."));return}
if(file && file.name && !isAllowedInvoiceFile(file.name)){alert(bi("Only PDF, JPG, JPEG or PNG files are allowed.","Csak PDF, JPG, JPEG vagy PNG fájl tölthető fel."));return}
fd.append("id",j.id||""); fd.append("job_id",j.id||""); fd.append("job_key",j.job_key||""); fd.append("client_id",j.client_id||""); fd.append("client_name",j.client_name||""); fd.append("piano_name",j.piano_name||""); fd.append("title",j.title||"");
fd.append("id",j.id||""); fd.append("job_id",j.id||""); fd.append("job_key",j.job_key||""); fd.append("client_id",j.client_id||""); fd.append("client_name",j.client_name||""); fd.append("piano_name",j.piano_name||""); fd.append("title",j.title||"");
if(fd.get("close_type")==="Full"&&!confirm(bi("Close the entire workflow? Every earlier linked part-work will also become fully completed.","Lezárod a teljes munkafolyamatot? Minden korábbi kapcsolódó részmunka is teljesen lezárttá válik."))) return;
try{await api(`/api/jobs/${encodeURIComponent(jobRef(j))}/close`,{method:"POST",body:fd});closeModal();renderScheduler()}catch(err){alert(err.message)}}}
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
 top.addEventListener("scroll",()=>{if(syncing)return;syncing=true;bottom.scrollLeft=top.scrollLeft;syncing=false;});
 bottom.addEventListener("scroll",()=>{if(syncing)return;syncing=true;top.scrollLeft=bottom.scrollLeft;syncing=false;});
 syncWidth();
 if(window.ResizeObserver){const ro=new ResizeObserver(syncWidth);ro.observe(table);ro.observe(bottom);}
}
async function deleteAllPianos(){
 if(!isSuperadmin())return showError(bi("Superadmin only.","Csak szuperadmin használhatja ezt a funkciót."));
 const confirmed=confirm(bi(
  "Delete every piano, all piano-import history, and all stored piano import fingerprints? Clients and other modules will remain. This cannot be undone.",
  "Töröljük az összes zongorát, a teljes zongoraimport-előzményt és minden tárolt zongoraimport-azonosítót? Az ügyfelek és más modulok megmaradnak. A művelet nem vonható vissza."
 ));
 if(!confirmed)return;
 try{
  const result=await api('/api/pianos',{method:'DELETE'});
  currentPianoImportAnalysis=null;
  currentPianoPage=1;
  currentPianoSearch="";
  currentPianoOwnershipFilter="ALL";
  currentPianoMinValue="";
  currentPianoMaxValue="";
  alert(bi(
   `Piano module reset completed. Deleted pianos: ${Number(result.deletedPianos||0)}.`,
   `A zongoramodul teljes törlése elkészült. Törölt zongorák: ${Number(result.deletedPianos||0)}.`
  ));
  await Promise.all([renderPianos(),render('contacts')]);
 }catch(err){showError(err.message)}
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
 $("#pianos").innerHTML=`<div class="panel piano-list-panel"><div class="toolbar"><h3>${bi("Pianos","Zongorák")}</h3><div class="toolbar-actions">${isAdmin()?`<button class="small" onclick="openPianoImportModal()">${bi("Import Excel","Excel import")}</button>`:""}<button class="small" onclick="exportTable('pianos')">Export CSV</button><button onclick="openForm('pianos')">+ ${bi("Add","Új")}</button>${resetButton}</div></div><div class="piano-filter-grid piano-filter-grid-no-status"><label>${bi("Search","Keresés")}<input id="pianoSearchInput" value="${htmlText(currentPianoSearch)}" placeholder="${bi("Client, piano, serial number or address","Ügyfél, zongora, gyári szám vagy cím")}" oninput="currentPianoSearch=this.value;currentPianoPage=1;renderPianos()"></label><label>${bi("Ownership","Tulajdon")}<select onchange="currentPianoOwnershipFilter=this.value;currentPianoPage=1;renderPianos()">${ownerOptionHtml}</select></label><label>${bi("Minimum value (USD)","Minimum érték (USD)")}<input type="number" min="0" value="${htmlText(currentPianoMinValue)}" oninput="currentPianoMinValue=this.value;currentPianoPage=1;renderPianos()"></label><label>${bi("Maximum value (USD)","Maximum érték (USD)")}<input type="number" min="0" value="${htmlText(currentPianoMaxValue)}" oninput="currentPianoMaxValue=this.value;currentPianoPage=1;renderPianos()"></label><div class="piano-filter-actions"><button type="button" class="small ghost-btn" onclick="clearPianoFilters()">${bi("Clear filters","Szűrők törlése")}</button></div></div>${pagination}<div class="table-scroll-top" id="pianosScrollTop" aria-label="${bi("Horizontal table scroll","Vízszintes táblázatgörgetés")}"><div class="table-scroll-spacer"></div></div><div class="table-wrap contacts-table-wrap pianos-table-wrap" id="pianosTableWrap"><table><thead><tr>${cols.map(c=>`<th>${label[c]}</th>`).join("")}<th>${bi("Actions","Műveletek")}</th></tr></thead><tbody>${pageRows.map(r=>`<tr><td class="piano-owner-cell ${!r.owner_contact_id?'piano-owner-unidentified':''}">${htmlText(pianoOwnerLabel(r))}</td><td>${htmlText(pianoDisplayName(r))}</td><td>${htmlText(r.serial_no||'—')}</td><td>${mapLink(r.location)||'—'}</td><td>${htmlText(r.ownership_type||r.ownership||'—')}</td><td>${money(r.estimated_value)}</td><td class="piano-actions"><button class="small" onclick="pianoInfo('${r.id}')">${bi("Info","Információ")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteGenericResource('pianos','${r.id}')">${bi("Delete","Törlés")}</button>`:""}</td></tr>`).join("")||`<tr><td colspan="7" class="muted">${bi("No matching pianos","Nincs találat")}</td></tr>`}</tbody></table></div>${pagination}</div>`;
 const input=document.getElementById("pianoSearchInput");if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}
 requestAnimationFrame(setupPianoTableScroll);
 applyLanguageToDOM();
}
async function pianoInfo(id){
 const [pianos,contacts]=await Promise.all([api('/api/pianos'),api('/api/contacts')]);
 const p=pianos.find(x=>String(x.id)===String(id));if(!p)return showError(bi('Piano not found.','A zongora nem található.'));
 const owner=contacts.find(c=>String(c.id)===String(p.owner_contact_id));
 $("#modal").classList.remove("hidden");$("#modalTitle").textContent=bi("Piano information","Zongora információ");
 const importInfo=isAdmin()?`<details class="piano-import-info"><summary>${bi("Import information","Importálási információk")}</summary><p><b>${bi("External reference","Külső referencia")}:</b> ${htmlText(p.external_reference||'—')}</p><p><b>${bi("Import source","Importforrás")}:</b> ${htmlText(p.import_source||'—')}</p><p><b>${bi("Import batch","Importköteg")}:</b> ${htmlText(p.import_batch_id||'—')}</p><p><b>${bi("Owner resolution","Tulajdonosi feloldás")}:</b> ${htmlText(p.owner_resolution||'—')}</p><p><b>${bi("Original description","Eredeti leírás")}:</b> ${htmlText(p.original_description||'—')}</p></details>`:'';
 $("#form").innerHTML=`<div class="work-card piano-info-card"><div class="piano-info-grid"><p><b>Piano ID:</b> ${htmlText(p.id)}</p><p><b>${bi("Client / owner","Ügyfél / tulajdonos")}:</b> ${htmlText(owner?.name||pianoOwnerLabel(p))}</p><p><b>${bi("Piano","Zongora")}:</b> ${htmlText(pianoDisplayName(p))}</p><p><b>${bi("Serial number","Gyári szám")}:</b> ${htmlText(p.serial_no||'—')}</p><p><b>${bi("Brand","Márka")}:</b> ${htmlText(p.brand||'—')}</p><p><b>${bi("Model","Modell")}:</b> ${htmlText(p.model||'—')}</p><p><b>${bi("Year","Év")}:</b> ${htmlText(p.year||'—')}</p><p><b>${bi("Location","Helyszín")}:</b> ${mapLink(p.location)||'—'}</p><p><b>${bi("Ownership","Tulajdon")}:</b> ${htmlText(p.ownership_type||p.ownership||'—')}</p><p><b>${bi("Estimated value","Becsült érték")}:</b> ${money(p.estimated_value)}</p><p class="full"><b>${bi("Notes","Megjegyzés")}:</b> ${htmlText(p.notes||'—')}</p></div>${importInfo}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Close","Bezár")}</button>${!p.owner_contact_id?`<button type="button" class="small" onclick="openPianoEdit('${p.id}',true)">${bi("Assign customer","Ügyfél hozzárendelése")}</button>`:''}<button type="button" onclick="openPianoEdit('${p.id}')">${bi("Edit","Szerkesztés")}</button></div>`;
 $("#form").onsubmit=e=>e.preventDefault();applyLanguageToDOM(document.getElementById('modal'));
}
async function openPianoEdit(id,focusOwner=false){
 const pianos=await api('/api/pianos');const p=pianos.find(x=>String(x.id)===String(id));if(!p)return;
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
 top.addEventListener("scroll",()=>{if(syncing)return;syncing=true;bottom.scrollLeft=top.scrollLeft;syncing=false;});
 bottom.addEventListener("scroll",()=>{if(syncing)return;syncing=true;top.scrollLeft=bottom.scrollLeft;syncing=false;});
 syncWidth();
 if(window.ResizeObserver){const ro=new ResizeObserver(syncWidth);ro.observe(table);ro.observe(bottom);}
}

async function renderContactsTable(data){
 const pianos=await api("/api/pianos").catch(()=>[]);
 const previousSearch=document.getElementById("clientSearchInput")?.value||"";
 const q=previousSearch.trim().toLowerCase();
 const enriched=data.map(c=>({...c,_ownedPianoCount:pianos.filter(p=>p.owner_contact_id===c.id).length}));
 const missingCount=enriched.filter(clientHasMissingCoreData).length;
 const filtered=enriched.filter(c=>{
   if(showOnlyMissingClientData && !clientHasMissingCoreData(c)) return false;
   if(currentClientStatusFilter!=="ALL" && customerStatusCode(c)!==currentClientStatusFilter) return false;
   if(q.length<3) return true;
   const owned=pianos.filter(p=>p.owner_contact_id===c.id);
   const hay=[c.name,c.company,c.email,c.phone,c.address,c.notes,customerStatusTitle(c),...owned.flatMap(p=>[p.brand,p.model,p.display_name,p.serial_no])].join(" ").toLowerCase();
   return hay.includes(q);
 });
 const totalPages=Math.max(1,Math.ceil(filtered.length/CLIENTS_PER_PAGE));
 currentClientPage=Math.min(Math.max(1,currentClientPage),totalPages);
 const start=(currentClientPage-1)*CLIENTS_PER_PAGE;
 const pageRows=filtered.slice(start,start+CLIENTS_PER_PAGE);
 const pagination=clientPaginationHtml(currentClientPage,totalPages,filtered.length);
 const s=schemas.contacts;
 $("#contacts").innerHTML=`<div class="panel"><div class="toolbar"><h3>${bi("Clients","Ügyfelek")}</h3><div class="toolbar-actions">${isAdmin()?`<button class="small" onclick="openClientImportModal()">${bi("Import Excel","Excel import")}</button>`:""}<button type="button" class="small missing-data-btn ${showOnlyMissingClientData?"active":""}" ${missingCount===0?"disabled":""} onclick="toggleMissingClientData()">${bi("Missing Data","Hiányzó adatok")} (${missingCount})</button><button class="small" onclick="exportTable('contacts')">Export CSV</button><button onclick="openForm('contacts')">+ ${bi("Add","Új")}</button></div></div><div class="client-search client-search-grid"><label>${tr("searchClients")}<input id="clientSearchInput" value="${previousSearch.replaceAll('"','&quot;')}" placeholder="${tr("searchPlaceholder")}" oninput="currentClientPage=1;render('contacts')"></label><label>${tr("customerStatus")}<select id="clientStatusFilter" onchange="currentClientStatusFilter=this.value;currentClientPage=1;render('contacts')">${customerStatusOptions()}</select></label></div><p class="muted customer-status-help">🎹 ${tr("ownerClient")} · 🛒 ${tr("buyerLead")} · 🎹🛒 ${tr("ownerBuyerLead")} · 👤 ${tr("generalContact")}</p>${pagination}<div class="table-scroll-top" id="contactsScrollTop" aria-label="${bi("Horizontal table scroll","Vízszintes táblázatgörgetés")}"><div class="table-scroll-spacer"></div></div><div class="table-wrap contacts-table-wrap" id="contactsTableWrap"><table><thead><tr>${s.cols.map(c=>`<th>${headerLabel('contacts',c)}</th>`).join("")}<th>${bi("Actions","Műveletek")}</th></tr></thead><tbody>${pageRows.map(r=>`<tr>${s.cols.map(c=>`<td>${cellValue('contacts',c,r)}</td>`).join("")}<td><button class="small" onclick="clientProfile('${r.id}')">${bi("Profile","Adatlap")}</button><button class="small" onclick='openForm("contacts",${esc(r)})'>${bi("Edit","Szerkesztés")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteGenericResource('contacts','${r.id}')">${bi("Delete","Törlés")}</button>`:""}</td></tr>`).join("")||`<tr><td colspan="${s.cols.length+1}" class="muted">${bi("No matching clients","Nincs találat")}</td></tr>`}</tbody></table></div>${pagination}</div>`;
 const input=document.getElementById("clientSearchInput"); if(input){ input.focus(); input.setSelectionRange(input.value.length,input.value.length); }
 requestAnimationFrame(setupContactTableScroll);
}
async function deleteGenericResource(key,id){
 if(!isSuperadmin()) return alert(bi("Superadmin only","Csak szuperadmin"));
 const s=schemas[key];
 if(!s || !confirm(bi("Delete this item?","Töröljük ezt a tételt?"))) return;
 try{await api(`/api/${s.api}/${encodeURIComponent(id)}`,{method:"DELETE"}); await render(key);}catch(err){alert(err.message)}
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
 if(!(body.brand||body.model)){alert(bi("Enter at least a brand or model.","Legalább márkát vagy típust adj meg."));return}
 try{await api(`/api/contacts/${clientId}/pianos`,{method:"POST",body:JSON.stringify(body)});await clientProfile(clientId)}catch(err){alert(err.message)}
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
 const ok=confirm(bi(`Import ${count} clients?\n\n${missing} clients will be imported with missing basic data. Possible duplicates and invalid rows will be skipped.`,`Importálod a(z) ${count} ügyfelet?\n\n${missing} ügyfél hiányos alapadatokkal kerül be. A lehetséges duplikációkat és hibás sorokat a rendszer kihagyja.`));
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
 const ok=confirm(bi(`Import ${count} pianos?\n\n${Number(s.clientsChangingToOwner||0)} clients will change to Owner status. ${Number(s.newUnidentifiedOwner||0)} pianos will have an unidentified owner.`,`Importálod a(z) ${count} zongorát?\n\n${Number(s.clientsChangingToOwner||0)} ügyfél Owner státuszra vált. ${Number(s.newUnidentifiedOwner||0)} zongora ismeretlen tulajdonossal kerül be.`));if(!ok)return;
 const button=document.getElementById('pianoImportCommitBtn');if(button){button.disabled=true;button.textContent=bi('Importing…','Importálás…');}
 try{const result=await api(`/api/imports/pianos/${encodeURIComponent(data.batchId)}/commit`,{method:'POST',body:JSON.stringify({confirm:true})});renderPianoImportCompleted(result);await Promise.all([render('pianos'),render('contacts')]);}catch(err){const code=String(err.message||'');const friendly=code==='PIANO_IMPORT_FAILED'?bi('The piano import failed. No partial import was kept.','A zongoraimport sikertelen. Részleges import nem maradt az adatbázisban.'):code;showError(friendly);if(button){button.disabled=false;button.textContent=bi(`Import ${count} pianos`,`${count} zongora importálása`);}}
}
function renderPianoImportCompleted(result){const box=document.getElementById('pianoImportResult');if(!box)return;box.innerHTML=`<div class="import-completed"><div class="import-completed-icon">✓</div><h3>${bi('Piano import completed','A zongoraimport befejeződött')}</h3><div class="import-summary-grid"><div class="import-stat newClients"><span>${bi('Imported pianos','Importált zongorák')}</span><strong>${Number(result.importedPianos||0)}</strong></div><div class="import-stat"><span>${bi('Clients updated as owners','Owner státuszra frissített ügyfelek')}</span><strong>${Number(result.updatedClients||0)}</strong></div><div class="import-stat missingDataClients"><span>${bi('Unidentified owner','Ismeretlen tulajdonos')}</span><strong>${Number(result.unidentifiedOwnerPianos||0)}</strong></div><div class="import-stat possibleDuplicates"><span>${bi('Skipped duplicates','Kihagyott duplikációk')}</span><strong>${Number(result.skippedAlreadyImported||0)+Number(result.skippedPossibleDuplicates||0)}</strong></div><div class="import-stat"><span>${bi('Client not found','Ügyfél nem található')}</span><strong>${Number(result.clientNotFound||0)}</strong></div><div class="import-stat invalidRows"><span>${bi('Invalid/failed rows','Hibás sorok')}</span><strong>${Number(result.invalidRows||0)+Number(result.failedRows||0)}</strong></div></div><div class="actions"><button type="button" onclick="closeModal();render('pianos')">${bi('View pianos','Zongorák megtekintése')}</button></div></div>`;}

function openForm(key,row=null){let s=schemas[key];$("#modal").classList.remove("hidden");$("#modalTitle").textContent=(row?bi("Edit","Szerkesztés")+" ":bi("Add","Új")+" ")+splitBilingualText(s.title);const pianoId=key==="pianos"&&row?`<div class="field"><label>Piano ID</label><input value="${htmlText(row.id||'')}" readonly></div>`:"";$("#form").innerHTML=`<div class="form-grid">${pianoId}${s.fields.map(f=>field(f,row?.[f[0]])).join("")}</div><div id="contactPianoSection"></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Cancel","Mégse")}</button><button>${bi("Save","Mentés")}</button></div>`;
 if(key==="contacts") setupContactFormBehavior(row);
 if(key==="pianos") setupPianoFormBehavior(row);
 applyLanguageToDOM(document.getElementById("modal"));
 $("#form").onsubmit=async e=>{e.preventDefault();let body=Object.fromEntries(new FormData(e.target));s.fields.forEach(f=>{if(f[2]==="number")body[f[0]]=Number(body[f[0]]||0)});if(key==="contacts"){body.has_piano=Number(body.has_piano||0);body.interested_buying=Number(body.interested_buying||0);}try{let saved;
if(row) saved=await api(`/api/${s.api}/${row.id}`,{method:"PUT",body:JSON.stringify(body)}); else saved=await api(`/api/${s.api}`,{method:"POST",body:JSON.stringify(body)});
if(key==="contacts"){const clientId=(row&&row.id)||saved.id; const allPianoChecks=[...document.querySelectorAll('input[name="client_piano_ids"]')]; const ids=allPianoChecks.filter(x=>x.checked).map(x=>x.value); if(clientId && allPianoChecks.length) await api(`/api/contacts/${clientId}/pianos`,{method:"PUT",body:JSON.stringify({piano_ids:ids})});}
closeModal();render(key)}catch(err){alert(err.message)}}}
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
 if(!clientId){alert(bi("Save the client first.","Előbb mentsd az ügyfelet."));return}
 const brand=$("#newPianoBrand")?.value || "", model=$("#newPianoModel")?.value || "", serial_no=$("#newPianoSerial")?.value || "", location=$("#newPianoLocation")?.value || "", ownership_type=$("#newPianoOwnership")?.value || "Customer owned", estimated_value=Number($("#newPianoValue")?.value || 0);
 if(!brand && !model){alert(bi("Enter at least a brand or model.","Legalább márkát vagy modellt adj meg."));return}
 if(ownership_type==="Company owned" && estimated_value<=0){alert(bi("Estimated value is required for a company-owned piano.","Céges zongoránál kötelező a becsült érték."));return}
 try{
   const existing=await api(`/api/contacts/${clientId}/pianos`).catch(()=>[]);
   const similar=existing.find(p=>String(p.brand||"").trim().toLowerCase()===brand.trim().toLowerCase() && String(p.model||"").trim().toLowerCase()===model.trim().toLowerCase() && (!serial_no || String(p.serial_no||"").trim().toLowerCase()===serial_no.trim().toLowerCase()));
   if(similar){
     const ok=confirm(bi("This client already has a similar piano. Add another one anyway?","Az ügyfélnek már van hasonló zongorája. Hozzáadsz még egyet?") );
     if(!ok) return;
   }
   await api(`/api/contacts/${clientId}/pianos`,{method:"POST",body:JSON.stringify({brand,model,serial_no,location,ownership_type,estimated_value})});
   await api(`/api/contacts/${clientId}`,{method:"PUT",body:JSON.stringify({has_piano:1})}).catch(()=>{});
   await attachClientPianoSelector({id:clientId,has_piano:1});
 }catch(err){alert(err.message)}
}

function closeModal(){$("#modal").classList.add("hidden")}
function exportTable(key){api("/api/"+key).then(data=>{if(!data.length){alert(bi("No data","Nincs adat"));return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`${key}.csv`;a.click()})}
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
 return ["","Cash","Check","Bank Transfer","Credit Card","Invoice","Other"].map(x=>`<option value="${x}" ${x===selected?"selected":""}>${x||"Select / Válassz"}</option>`).join("");
}
function optionsFrom(list,selected=""){
 return list.map(x=>`<option value="${x[0]}" ${x[0]===selected?"selected":""} ${String(x[0]).endsWith("_HEADER")?"disabled":""}>${x[1]}</option>`).join("");
}
async function renderFinance(){
 const currentMonth=currentMonthKey();
 let items=[];
 try{items=await api("/api/financial-items");}catch(e){items=[];}
 const totalIncome=items.filter(x=>x.main_type==="INCOME").reduce((s,x)=>s+Number(x.amount||0),0);
 const passiveIncome=items.filter(x=>x.main_type==="INCOME"&&x.recurrence==="MONTHLY").reduce((s,x)=>s+Number(x.amount||0),0);
 const totalExpenses=items.filter(x=>x.main_type==="EXPENSE").reduce((s,x)=>s+Number(x.amount||0),0);
 const assets=items.filter(x=>x.main_type==="ASSET").reduce((s,x)=>s+Number(x.amount||0),0);
 const sources=items.filter(x=>x.main_type==="LIABILITY"||x.main_type==="EQUITY").reduce((s,x)=>s+Number(x.amount||0),0);
 $("#finance").innerHTML=`<div class="panel finance-panel">
   <div class="toolbar">
     <div>
       <h3>Finance / Pénzügy</h3>
       <p class="muted">Tételes pénzügyi napló. Innen számol az eredménykimutatás és a mérleg.</p>
     </div>
     <div><button class="small" onclick="exportFinancialItemsCSV()">Export CSV</button> <button onclick="openFinancialItem()">+ New Financial Item / Új pénzügyi tétel</button></div>
   </div>
   <div class="finance-filters">
     <label>${bi("Month","Hónap")} <input id="finFilterMonth" type="month" value="${currentMonth}"></label>
     <label>Type / Típus <select id="finFilterType"><option value="">All / Összes</option><option value="INCOME">Income / Bevétel</option><option value="EXPENSE">Expense / Kiadás</option><option value="ASSET">Asset / Eszköz</option><option value="LIABILITY">Liability / Kötelezettség</option><option value="EQUITY">Equity / Saját tőke</option></select></label>
     <label>Recurrence / Ismétlődés <select id="finFilterRec"><option value="">All / Összes</option><option value="ONE_TIME">One-time / Egyszeri</option><option value="MONTHLY">Monthly / Havi</option></select></label>
     <button class="small" onclick="applyFinanceFilters()">Filter / Szűrés</button>
     <button class="small ghost-btn" onclick="clearFinanceFilters()">Clear / Törlés</button>
   </div>
   <div id="financeTableBox">${financeTableHTML(items)}</div>
 </div>`;
}
function financeTableHTML(items){
 return `<div class="table-wrap"><table><thead><tr>
   <th>Date / Dátum</th><th>Title / Megnevezés</th><th>Type / Típus</th><th>Category / Kategória</th><th>Recurrence / Ismétlődés</th><th>Payment / Fizetés</th><th>Balance impact / Mérleghatás</th><th>Amount / Összeg</th><th>Actions / Műveletek</th>
 </tr></thead><tbody>${items.map(x=>`<tr>
   <td>${x.item_date||""}</td>
   <td><b>${x.title||""}</b><br><small>${x.description||""}</small></td>
   <td>${mainTypeLabel(x.main_type)}</td>
   <td>${finLabel(x.category)}</td>
   <td>${recurrenceLabel(x.recurrence)}</td>
   <td>${x.payment_method||""}</td>
   <td>${finLabel(x.balance_account)}</td>
   <td>${signedAmountHTML(x)}</td>
   <td><button class="small" onclick='openFinancialItem(${esc(x)})'>Edit / Szerkesztés</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteFinancialItem('${x.id}')">Delete / Törlés</button>`:""}</td>
 </tr>`).join("") || `<tr><td colspan="9" class="muted">No financial items yet / Még nincs pénzügyi tétel.</td></tr>`}</tbody></table></div>`;
}
function exportFinancialItemsCSV(){
 api("/api/financial-items").then(data=>{if(!data.length){alert(bi("No data","Nincs adat"));return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="financial_items.csv";a.click()})
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
   <div class="field"><label>${req("Title / Megnevezés")}</label><input name="title" value="${row?.title||""}" required placeholder="Piano sale, tuning, rent..."></div>
   <div class="field"><label>${req("Amount / Összeg")}</label><input name="amount" type="number" min="0" step="0.01" value="${row?.amount||0}" required></div>
   <div class="field"><label>${req("Category / Kategória")}</label><select name="category" id="financialCategory">${optionsFrom(categoryList,row?.category||"")}</select></div>
   <div class="field"><label>${req("Recurrence / Ismétlődés")}</label><select name="recurrence"><option value="ONE_TIME" ${row?.recurrence!=="MONTHLY"?"selected":""}>One-time / Egyszeri</option><option value="MONTHLY" ${row?.recurrence==="MONTHLY"?"selected":""}>Monthly / Havi</option></select></div>
   <div class="field"><label>Payment method / Fizetési mód</label><select name="payment_method">${paymentOptions(row?.payment_method||"")}</select></div>
   <div class="field"><label>Balance account / Mérlegoldali hatás</label><select name="balance_account">${optionsFrom(balanceAccountOptions,row?.balance_account||"")}</select></div>
   <div class="field"><label>Job ID / Munka ID</label><input name="job_id" value="${row?.job_id||""}"></div>
   <div class="field"><label>Client ID / Ügyfél ID</label><input name="client_id" value="${row?.client_id||""}"></div>
   <div class="field"><label>Piano ID / Zongora ID</label><input name="piano_id" value="${row?.piano_id||""}"></div>
   <div class="field full"><label>Description / Leírás</label><textarea name="description" placeholder="Rövid magyarázat, hogy később is egyértelmű legyen.">${row?.description||""}</textarea></div>
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
   }catch(err){alert(err.message)}
 };
}
function refreshFinancialCategoryOptions(){
 const t=$("#financialMainType")?.value||"INCOME";
 const cat=$("#financialCategory");
 if(cat) cat.innerHTML=optionsFrom(financialCategoryOptions[t]||financialCategoryOptions.INCOME,"");
}
async function deleteFinancialItem(id){
 if(!confirm(bi("Delete this financial item?","Biztosan törlöd ezt a pénzügyi tételt?"))) return;
 try{await api(`/api/financial-items/${id}`,{method:"DELETE"});await renderFinance()}catch(err){alert(err.message)}
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
 if(!isSuperadmin()) return alert(bi("Superadmin only","Csak szuperadmin"));
 if(!confirm(bi("Delete this closed job and linked visible records?","Töröljük ezt a lezárt munkát és kapcsolódó látható tételeit?"))) return;
 try{await api(`/api/closed-jobs/${encodeURIComponent(id)}`,{method:"DELETE"}); await renderClosedJobs();}catch(err){alert(err.message)}
}
function exportClosedJobs(){
 api("/api/closed-jobs").then(data=>{
   if(!data.length){alert(bi("No data","Nincs adat"));return}
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
 await loadSchedulerWorkers();
 const contacts=await api("/api/contacts").catch(()=>[]);
 const pianos=await api("/api/pianos").catch(()=>[]);
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
   <div class="field"><label>Estimated hours / Tervezett óraszám</label><input name="estimated_hours" type="number" step="0.25" value="${row?.estimated_hours||2}"></div>
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
   body.expected_revenue=Number(body.expected_revenue||0); body.estimated_hours=Number(body.estimated_hours||0);
   const c=contacts.find(x=>(x.name||"").trim().toLowerCase()===(body.client_name||"").trim().toLowerCase()); if(c) body.client_id=c.id;
   const p=pianos.find(x=>(x.display_name||`${x.brand||""} ${x.model||""}`.trim()).trim().toLowerCase()===(body.piano_name||"").trim().toLowerCase()); if(p) body.piano_id=p.id;
   try{if(isEdit) await api(`/api/planned-jobs/${row.id}`,{method:"PUT",body:JSON.stringify(body)}); else await api("/api/planned-jobs",{method:"POST",body:JSON.stringify(body)}); closeModal(); await renderPlannedJobs();}catch(err){alert(err.message)}
 };
}
function openPlannedJobDetails(x){
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Planned job details / Tervezett munka részletei";
 $("#form").innerHTML=`<div class="work-card">
   <h4>${x.planned_key||""} · ${x.title||""}</h4>
   <p><b>Type / Típus:</b> ${x.planned_type||""}</p><p><b>Client / Ügyfél:</b> ${x.client_name||""}</p><p><b>Phone / Telefon:</b> ${x.client_phone||""}</p><p><b>Piano / Zongora:</b> ${x.piano_name||""}</p><p><b>Address / Cím:</b> ${x.service_address||""}</p><p><b>Responsible / Felelős:</b> ${workerDisplayName(x.preferred_assigned_user_id,x.preferred_assigned_to)||""}</p><p><b>Priority / Prioritás:</b> ${badge(x.priority||"Medium")}</p><p><b>Status / Állapot:</b> ${x.status||""}</p><p><b>Expected revenue / Várható bevétel:</b> ${money(x.expected_revenue||0)} · <b>Probability:</b> ${plannedProbabilityNumber(x)}% · <b>Weighted:</b> ${money(plannedWeightedRevenue(x))}</p><p><b>Estimated hours / Tervezett óraszám:</b> ${x.estimated_hours||""}</p><p><b>Target date / Cél dátum:</b> ${x.target_date||""}</p><p><b>Block reason / Elakadás oka:</b> ${x.block_reason||""}</p><p><b>Next step / Következő lépés:</b> ${x.next_step||""}</p><p><b>Notes / Megjegyzés:</b><br>${x.notes||""}</p>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Close / Bezár</button><button type="button" onclick='openPlannedJob(${esc(x)})'>Edit / Szerkesztés</button><button type="button" onclick='openConvertPlannedJob(${esc(x)})'>Convert to Scheduled Job / Áthelyezés naptárba</button>${isSuperadmin()?`<button type="button" class="danger" onclick="archivePlannedJob('${x.id}')">Delete / Törlés</button>`:`<button type="button" class="danger" onclick="archivePlannedJob('${x.id}')">Archive / Archiválás</button>`}</div>`;
 $("#form").onsubmit=e=>e.preventDefault();
}
async function openConvertPlannedJob(x){
 await loadSchedulerWorkers();
 const start=localDT(new Date()); let endD=new Date(); endD.setHours(endD.getHours()+Number(x.estimated_hours||2)); const end=localDT(endD);
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Convert to Scheduled Job / Áthelyezés naptárba";
 $("#form").innerHTML=`<p class="muted">A rendszer backend oldalon ellenőrzi, hogy a kiválasztott felelős szabad-e az adott időintervallumban.</p><div class="form-grid">
   <div class="field"><label>${req("Title / Munka neve")}</label><input name="title" value="${x.title||""}" required></div>
   <div class="field"><label>${req("Assigned to / Felelős")}</label><select name="assigned_user_id">${workerSelectOptions(x.preferred_assigned_user_id,x.preferred_assigned_to)}</select></div>
   <div class="field"><label>${req("Start / Kezdés")}</label><input name="start_time" type="datetime-local" value="${start}" required></div>
   <div class="field"><label>${req("End / Befejezés")}</label><input name="end_time" type="datetime-local" value="${end}" required></div>
   <div class="field"><label>Final agreed amount / Végleges megbeszélt összeg</label><input name="planned_amount" type="number" value="${x.expected_revenue||0}"></div>
   <div class="field"><label>Planned hours / Tervezett óra</label><input name="planned_hours" type="number" step="0.25" value="${x.estimated_hours||2}"></div>
   <div class="field full"><label>${req("Service address / Cím")}</label><input name="service_address" value="${x.service_address||""}" required></div>
   <div class="field full"><label>Instructions / Instrukció</label><textarea name="instructions">${x.next_step||x.notes||""}</textarea></div>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Convert / Naptárba helyezés</button></div>`;
 $("#form").onsubmit=async e=>{
   e.preventDefault();
   const body=Object.fromEntries(new FormData(e.target));
   body.planned_amount=Number(body.planned_amount||0); body.planned_hours=Number(body.planned_hours||0);
   try{const r=await api(`/api/planned-jobs/${x.id}/convert`,{method:"POST",body:JSON.stringify(body)}); alert(`${bi("Scheduled job created","Naptári munka létrejött")}: ${r.job?.job_key||r.job?.id||""}`); closeModal(); currentWeekStart=startOfWeek(new Date(body.start_time)); await renderScheduler();}catch(err){alert(err.message)}
 };
}
async function archivePlannedJob(id){
 if(!confirm(bi("Archive this planned job?","Archiváljuk ezt a tervezett munkát?")))return;
 try{await api(`/api/planned-jobs/${id}`,{method:"DELETE"}); closeModal(); await renderPlannedJobs();}catch(err){alert(err.message)}
}
function exportPlannedJobsCSV(){
 api("/api/planned-jobs?include_all=1").then(data=>{if(!data.length){alert(bi("No data","Nincs adat"));return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="planned_jobs.csv";a.click()})
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
   <td><button class="small" onclick='openInventoryItem(${esc(x)})'>Edit / Szerkesztés</button> <button class="small danger-btn" onclick="deleteInventoryItem('${x.id}')">Delete / Törlés</button></td>
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
   }catch(err){alert(err.message)}
 };
}
async function deleteInventoryItem(id){
 if(!confirm(bi("Delete this inventory item?","Töröljük ezt a leltári tételt?")))return;
 try{await api(`/api/inventory/${id}`,{method:"DELETE"}); await renderInventory();}catch(err){alert(err.message)}
}
async function markInventoryCompleted(){
 if(!confirm(bi("Mark the quarterly inventory as completed today?","Leltár elvégezve mai dátummal?")))return;
 try{const r=await api("/api/inventory/complete",{method:"POST",body:JSON.stringify({})}); alert(`Inventory completed. Next due: ${r.nextDue}`); await renderInventory();}catch(err){alert(err.message)}
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

async function renderUsers(){
 let u=await api("/api/users");
 const canAdd=isAdmin();
 const rows=u.map(x=>{
   const isMe=x.id===user.id;
   const profileBtn=isMe?`<button class="small" onclick='openUser(${esc(x)},true)'>${tr("myProfile")}</button>`:"";
   const editBtn=isAdmin()?` <button class="small" onclick='openUser(${esc(x)},false)'>${tr("editUser")}</button>`:"";
   const deleteBtn=isSuperadmin()?` <button class="small danger-btn" onclick="deleteUser('${x.id}')">${bi("Delete","Törlés")}</button>`:"";
   return `<tr><td>${x.name||""}</td><td>${x.email||""}</td><td>${x.role||""}</td><td>${x.phone||""}</td><td>${x.address||""}</td><td>${x.status||""}</td><td>${profileBtn}${editBtn}${deleteBtn}</td></tr>`;
 }).join("");
 $("#users").innerHTML=`<div class="panel"><div class="toolbar"><h3>${tr("users")}</h3>${canAdd?`<button onclick="openUser(null,false)">+ ${tr("addUser")}</button>`:""}</div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>${tr("phone")}</th><th>${tr("address")}</th><th>Status</th><th>${tr("actions")}</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
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
 let roleOptions=["ADMIN","MANAGER","WORKER","VIEWER"];
 const roleField = canFullEdit || !isEdit ? `<div class="field"><label>${bi("Role","Szerepkör")}</label><select name="role">${roleOptions.map(r=>`<option ${row?.role===r?"selected":""}>${r}</option>`).join("")}</select></div>` : "";
 const statusField = canFullEdit ? `<div class="field"><label>Status</label><select name="status"><option ${row?.status==="Active"?"selected":""}>Active</option><option ${row?.status==="Inactive"?"selected":""}>Inactive</option></select></div>` : "";
 $("#form").innerHTML=`<div class="form-grid"><div class="field"><label>Name</label><input name="name" value="${row?.name||""}" required></div><div class="field"><label>Email</label><input name="email" value="${row?.email||""}" required></div><div class="field"><label>${isEdit?tr("newPassword"):tr("password")}</label><input name="password" type="password" ${isEdit?"":"required"}></div><div class="field"><label>${tr("phone")}</label><input name="phone" value="${row?.phone||""}"></div><div class="field full"><label>${tr("address")}</label><input name="address" value="${row?.address||""}"></div>${roleField}${statusField}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Cancel","Mégse")}</button><button>${isEdit?tr("saveChanges"):tr("createUser")}</button></div>`;
 $("#form").onsubmit=async e=>{e.preventDefault();try{let body=Object.fromEntries(new FormData(e.target));if(isEdit&&!body.password)delete body.password;let saved;if(isEdit)saved=await api(`/api/users/${row.id}`,{method:"PUT",body:JSON.stringify(body)});else saved=await api("/api/users",{method:"POST",body:JSON.stringify(body)});if(isEdit&&row.id===user.id){user={...user,...saved};localStorage.setItem("kh_user",JSON.stringify(user));document.getElementById("userInfo").textContent=`${user.name} · ${user.role}`;}schedulerWorkersCache=null;currentSchedulerWorker=null;closeModal();renderUsers();}catch(err){showError(err.message)}};
}
async function deleteUser(id){if(!isSuperadmin())return showError("PERMISSION_DENIED");if(!confirm(bi("Delete this user permanently?","Véglegesen töröljük ezt a felhasználót?")))return;try{await api(`/api/users/${id}`,{method:"DELETE"});await renderUsers();}catch(err){showError(err.message)}}

const friendlyErrors={
 en:{PERMISSION_DENIED:"You do not have permission to perform this action.",REQUIRED_FIELDS:"Please complete all required fields.",INVALID_FILE_TYPE:"The selected file is not a valid PDF, JPG, JPEG, or PNG file.",FILE_TOO_LARGE:"The selected file exceeds the 20 MB size limit.",INVALID_PASSWORD:"The password is incorrect.",BACKUP_NOT_FOUND:"The selected backup could not be found.",RESTORE_CONFIRMATION_REQUIRED:"Type RESTORE BACKUP exactly to confirm the restore.",SUPERADMIN_PERMISSIONS_FIXED:"Superadmin permissions cannot be reduced.",PWA_LOGO_REQUIREMENTS:"Use a PNG, JPG, or JPEG image at least 192×192 pixels. Non-square images are automatically centered on a square canvas for the PWA icon."},
 hu:{PERMISSION_DENIED:"Nincs jogosultságod ehhez a művelethez.",REQUIRED_FIELDS:"Kérlek, tölts ki minden kötelező mezőt.",INVALID_FILE_TYPE:"A kiválasztott fájl nem érvényes PDF-, JPG-, JPEG- vagy PNG-fájl.",FILE_TOO_LARGE:"A kiválasztott fájl meghaladja a 20 MB-os mérethatárt.",INVALID_PASSWORD:"A megadott jelszó hibás.",BACKUP_NOT_FOUND:"A kiválasztott biztonsági mentés nem található.",RESTORE_CONFIRMATION_REQUIRED:"A visszaállításhoz pontosan ezt írd be: RESTORE BACKUP.",SUPERADMIN_PERMISSIONS_FIXED:"A superadmin jogosultságai nem csökkenthetők.",PWA_LOGO_REQUIREMENTS:"Legalább 192×192 képpontos PNG-, JPG- vagy JPEG-képet használj. A nem négyzetes képet a rendszer automatikusan négyzetes PWA-ikonba igazítja."}
};
function showError(code){alert((friendlyErrors[currentLang]||friendlyErrors.en)[code]||code||bi("An unexpected error occurred.","Váratlan hiba történt."));}
async function renderSettings(){
 if(!isAdmin()) return showError('PERMISSION_DENIED');
 const box=$("#settings"), p=await api('/api/settings/permissions'), b=await api('/api/settings/branding');
 const labels={'scheduler.view':bi('View scheduler','Naptár megtekintése'),'planned_jobs.view':bi('View planned jobs','Tervezett munkák megtekintése'),'contacts.view':bi('View clients','Ügyfelek megtekintése'),'pianos.view':bi('View pianos','Zongorák megtekintése'),'closed_jobs.view':bi('View closed jobs','Lezárt munkák megtekintése'),'knowledge_base.view':bi('View invoices','Számlák megtekintése'),'finance.view':bi('View finance','Pénzügy megtekintése'),'income_statement.view':bi('View income statement','Eredménykimutatás megtekintése'),'inventory.view':bi('View inventory','Leltár megtekintése'),'users.view':bi('View users','Felhasználók megtekintése'),'users.create':bi('Add employees','Munkavállaló hozzáadása'),'users.roles':bi('Assign or remove roles','Szerepkör adása vagy elvétele'),'permissions.manage':bi('Manage role permissions','Szerepkör-jogosultságok kezelése'),'audit.view':bi('View audit log','Módosítási napló megtekintése')};
 const matrix=p.roles.filter(r=>r!=='SUPERADMIN').map(role=>`<div class="permission-card"><h4>${role}</h4>${p.permissions.map(pm=>{const row=p.rows.find(x=>x.role===role&&x.permission===pm);return `<label class="permission-row"><input type="checkbox" ${row?.enabled?'checked':''} onchange="setRolePermission('${role}','${pm}',this.checked)"><span>${labels[pm]||pm}</span></label>`}).join('')}</div>`).join('');
 let backups='';if(isSuperadmin()){const rows=await api('/api/backups');backups=`<div class="panel"><div class="toolbar"><h3>${bi('Backups','Biztonsági mentések')}</h3><button onclick="createBackupNow()">${bi('Create backup now','Mentés készítése most')}</button></div><div class="table-wrap"><table><tbody>${rows.map(x=>`<tr><td>${x.created_at||''}</td><td>${x.file_name}</td><td><button class="small" onclick="downloadBackup('${x.id}')">${bi('Download','Letöltés')}</button><button class="small danger-btn" onclick="restoreBackup('${x.id}')">${bi('Restore','Visszaállítás')}</button></td></tr>`).join('')}</tbody></table></div></div>`}
 box.innerHTML=`${mobileBackHeader(bi('Settings','Beállítások'))}<div class="panel branding-panel"><h3>${bi('Branding','Arculat')}</h3><div class="branding-preview"><img src="${versionedBrandAsset(b.logo_url)}" alt="logo"><div><b>${b.company_name}</b><small>${b.short_name}</small></div></div><form onsubmit="saveBranding(event)" class="form-grid"><label>${bi('Company name','Cégnév')}<input name="company_name" value="${String(b.company_name||'').replaceAll('"','&quot;')}" required></label><label>${bi('Short app name','Rövid alkalmazásnév')}<input name="short_name" value="${String(b.short_name||'').replaceAll('"','&quot;')}" required></label><div class="actions"><button type="submit">${bi('Save identity','Arculat mentése')}</button></div></form><form onsubmit="uploadBrandLogo(event)" class="branding-logo-form"><input id="brandingLogoInput" type="file" name="logo" accept="image/png,image/jpeg,.jpg,.jpeg" onchange="previewBrandLogo(this)" required><small class="branding-upload-help">${bi('PNG, JPG, or JPEG; minimum 192×192 px. Non-square images are automatically padded to a square icon.','PNG, JPG vagy JPEG; minimum 192×192 px. A nem négyzetes képet a rendszer automatikusan négyzetes ikonba igazítja.')}</small><button type="submit">${bi('Upload logo and PWA icon','Logó és PWA-ikon feltöltése')}</button><button type="button" class="small" onclick="resetBrandLogo()">${bi('Restore KH logo','KH-logó visszaállítása')}</button></form><hr><h4>${bi('Login background','Bejelentkezési háttérkép')}</h4><div class="login-background-preview" style="${b.login_background_url?`background-image:linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.25)),url('${versionedBrandAsset(b.login_background_url)}')`:''}"></div><form onsubmit="uploadLoginBackground(event)" class="branding-logo-form"><input type="file" name="background" accept="image/png,image/jpeg,.jpg,.jpeg" required><button type="submit">${bi('Upload login background','Bejelentkezési háttérkép feltöltése')}</button><button type="button" class="small" onclick="resetLoginBackground()">${bi('Restore default background','Alapértelmezett háttér visszaállítása')}</button></form></div><div class="panel"><h3>${bi('Roles and Permissions','Szerepkörök és jogosultságok')}</h3><div class="permission-grid">${matrix}</div></div>${backups}`;
}
async function saveBranding(e){e.preventDefault();const body=Object.fromEntries(new FormData(e.target));branding=await api('/api/settings/branding',{method:'PUT',body:JSON.stringify(body)});applyBranding();alert(bi('Branding saved.','Arculat elmentve.'));renderSettings();}
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
 }catch(err){input.value='';showError(err.message)}
}
async function uploadBrandLogo(e){
 e.preventDefault();
 try{
  const input=e.target.querySelector('input[name="logo"]');
  const prepared=await prepareBrandLogoFile(input?.files?.[0]);
  const fd=new FormData(); fd.append('logo',prepared,prepared.name);
  branding=await api('/api/settings/branding/logo',{method:'POST',body:fd});
  await loadBranding();
  alert(bi('Logo updated. Reinstall the PWA to refresh the home-screen icon.','A logó frissült. A kezdőképernyős ikon frissítéséhez telepítsd újra a PWA-t.'));
  renderSettings();
 }catch(err){showError(err.message)}
}
async function resetBrandLogo(){branding=await api('/api/settings/branding/reset-logo',{method:'POST'});await loadBranding();renderSettings();}
async function uploadLoginBackground(e){e.preventDefault();const fd=new FormData(e.target);branding=await api('/api/settings/branding/background',{method:'POST',body:fd});await loadBranding();alert(bi('Login background updated.','A bejelentkezési háttérkép frissült.'));renderSettings();}
async function resetLoginBackground(){branding=await api('/api/settings/branding/reset-background',{method:'POST'});await loadBranding();renderSettings();}
async function renderAuditLog(){
 if(!isAdmin()&&!userPermissions.permissions.includes('audit.view')&&!userPermissions.all)return showError('PERMISSION_DENIED');
 const rows=await api(`/api/audit-log?limit=1000&type=${currentAuditType}`); const box=$('#audit_log');
 box.innerHTML=`${mobileBackHeader(bi('Audit Log','Módosítási napló'))}<div class="panel"><div class="audit-type-switch"><button class="${currentAuditType==='WORK'?'active':''}" onclick="setAuditType('WORK')">${bi('Work Audit','Munkaaudit')}</button><button class="${currentAuditType==='TECHNICAL'?'active':''}" onclick="setAuditType('TECHNICAL')">${bi('Technical Audit','Technikai audit')}</button></div><div class="toolbar"><h3>${currentAuditType==='WORK'?bi('Work Audit','Munkaaudit'):bi('Technical Audit','Technikai audit')}</h3><div>${isSuperadmin()?`<button class="small" onclick="downloadAuditLog()">${bi('Export CSV','CSV export')}</button><button class="small danger-btn" onclick="clearAuditLog()">${bi('Delete current log','Aktuális napló törlése')}</button>`:''}</div></div><div class="table-wrap"><table><thead><tr><th>${bi('Time','Idő')}</th><th>${bi('User','Felhasználó')}</th><th>${bi('Role','Szerepkör')}</th><th>${bi('Action','Művelet')}</th><th>${bi('Module','Modul')}</th><th>ID</th><th>${bi('Old value','Régi érték')}</th><th>${bi('New value','Új érték')}</th><th>${bi('Details','Részletek')}</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.event_time||''}</td><td>${x.user_name||''}</td><td>${x.user_role||''}</td><td>${x.action||''}</td><td>${x.module||''}</td><td>${x.record_id||''}</td><td>${x.old_value||''}</td><td>${x.new_value||''}</td><td>${x.details||''}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function setAuditType(type){currentAuditType=type==='TECHNICAL'?'TECHNICAL':'WORK';renderAuditLog();}
async function setRolePermission(role,permission,enabled){try{await api('/api/settings/permissions',{method:'PUT',body:JSON.stringify({role,permission,enabled})});}catch(e){showError(e.message);renderSettings();}}
async function downloadAuditLog(){const r=await fetch(`/api/audit-log/export?type=${currentAuditType}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return showError((await r.json()).error);const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=currentAuditType==='WORK'?'work-audit.csv':'technical-audit.csv';a.click();URL.revokeObjectURL(a.href);}
async function clearAuditLog(){if(!isSuperadmin())return;if(confirm(bi('Delete the complete audit log?','Töröljük a teljes módosítási naplót?'))){await api(`/api/audit-log?type=${currentAuditType}`,{method:'DELETE'});renderSettings();}}
async function createBackupNow(){try{await api('/api/backups',{method:'POST'});alert(bi('Backup created successfully.','A biztonsági mentés elkészült.'));renderSettings();}catch(e){showError(e.message)}}
async function downloadBackup(id){const r=await fetch(`/api/backups/${id}/download`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return showError((await r.json()).error);const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=r.headers.get('content-disposition')?.match(/filename="?([^";]+)/)?.[1]||'backup.sqlite';a.click();URL.revokeObjectURL(a.href);}
async function restoreBackup(id){const confirmation=prompt(bi('Type RESTORE BACKUP to continue.','A folytatáshoz írd be: RESTORE BACKUP'));if(confirmation!=='RESTORE BACKUP')return;const password=prompt(bi('Enter your password.','Add meg a jelszavad.'));try{const r=await api(`/api/backups/${id}/restore`,{method:'POST',body:JSON.stringify({confirmation,password})});alert(bi('Backup restored. Restart the server now.','A mentés visszaállt. Most indítsd újra a szervert.'));logoutNow();}catch(e){showError(e.message)}}


if(token){loadLanguage();loadTheme();boot();}else{loadLanguage();loadTheme();loadBranding().then(applyLanguageToDOM);}





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
