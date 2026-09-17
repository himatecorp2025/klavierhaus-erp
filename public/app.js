
function safeStoredJson(key,fallback=null){
  try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}
  catch(error){console.warn(`Invalid localStorage JSON for ${key}; clearing stale value.`,error);localStorage.removeItem(key);return fallback;}
}
let token=localStorage.getItem("kh_token");
let user=safeStoredJson("kh_user",null);
let pendingAccountActivation=null;
let currentWeekStart=startOfWeek(new Date());
let currentView="workshop_workflow";
let navigationHomeNeutral=false;
let currentLang="en";
let currentSchedulerWorker=null;
let currentSchedulerEntryFilter="ALL";
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
let jobDraftState=null;
let activeModalCancelHandler=null;
let contactsRenderTimer=null;
let pianosRenderTimer=null;
let contactsRenderData={data:[],pianos:[]};
let pianosRenderData=[];
const apiResponseCache=new Map();
const CACHEABLE_MASTER_ENDPOINTS=new Set(["/api/contacts","/api/pianos","/api/schedule-workers"]);

const navs={
 SUPERADMIN:[["workshop_workflow","Workshop Workflow / Műhely workflow"],["scheduler","Scheduler / Naptár"],["planned_jobs","Planned Jobs / Tervezett munkák"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["invoice_documents","Invoices Documents / Számladokumentumok"],["inventory","Inventory / Leltár"],["events","Events / Események"],["users","Users / Felhasználók"],["audit_log","Audit Log / Módosítási napló"],["settings","Settings / Beállítások"]],
 ADMIN:[["workshop_workflow","Workshop Workflow / Műhely workflow"],["scheduler","Scheduler / Naptár"],["planned_jobs","Planned Jobs / Tervezett munkák"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["invoice_documents","Invoices Documents / Számladokumentumok"],["inventory","Inventory / Leltár"],["events","Events / Események"],["users","Users / Felhasználók"],["audit_log","Audit Log / Módosítási napló"],["settings","Settings / Beállítások"]],
 MANAGER:[["workshop_workflow","Workshop Workflow / Műhely workflow"],["scheduler","Scheduler / Naptár"],["planned_jobs","Planned Jobs / Tervezett munkák"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["invoice_documents","Invoices Documents / Számladokumentumok"],["inventory","Inventory / Leltár"],["digital_attendance","Digital Attendance / Digitális jelenlétiív"],["customer_inbox","Customer Inbox / Ügyfélüzenetek"],["users","Users / Felhasználók"]],
 WORKER:[["workshop_workflow","Workshop Workflow / Műhely workflow"],["scheduler","Scheduler / Naptár"],["planned_jobs","Planned Jobs / Tervezett munkák"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["inventory","Inventory / Leltár"],["digital_attendance","Digital Attendance / Digitális jelenlétiív"],["customer_inbox","Customer Inbox / Ügyfélüzenetek"],["users","Users / Felhasználók"]]
};

const adminNavGroups=[
 {id:"finance_invoicing",icon:"$",label:["Finance & Invoicing","Pénzügy és számlázás"],items:[
  ["finance","Balance Sheet","Mérleg",""],
  ["income_statement","Income Statement","Eredménykimutatás",""],
  ["invoice_documents","Invoices Documents","Számladokumentumok",""]
 ]},
 {id:"technical",icon:"⚙",label:["Technical Operation","Technikai működés"],items:[
  ["audit_log","Audit Log","Módosítási napló","🧾"],
  ["backups","Backups","Biztonsági mentések","⛁"],
  ["pianos","Client Piano","Ügyfélzongorák",""],
  ["contacts","Clients","Ügyfelek","👥"],
  ["closed_jobs","Closed Jobs","Lezárt munkák","✅"],
  ["knowledge_base","Company Documents Archive","Céges dokumentumtár",""],
  ["company_data","Corporate Data","Cégadatok","▥"],
  ["inventory","Inventory","Leltár","📦"],
  ["partners","Partners","Partnerek",""],
  ["planned_jobs","Planned Jobs","Tervezett munkák","🗂"],
  ["scheduler","Scheduler","Naptár",""],
  ["website_services","Services","Szolgáltatások","♟"],
  ["settings","Settings","Beállítások","⚙"],
  ["system_integrations","System Activation & Integrations","Rendszeraktiválás és integrációk","⌁"],
  ["users","Users","Felhasználók","👤"],
  ["workshop_workflow","Workshop Workflow","Műhely workflow","▦"]
 ]},
 {id:"marketing",icon:"✦",label:["Marketing","Marketing"],items:[
  ["marketing_overview","Campaign Overview","Kampányáttekintő","◫"],
  ["customer_inbox","Customer Inbox","Ügyfélüzenetek","▣"],
  ["website_reviews","Reviews","Vélemények","❝"],
  ["campaigns_utm","Campaigns & UTM","Kampányok és UTM-kódok","⌁"],
  ["leads","Leads","Érdeklődők","♧"],
  ["tracking_cookies","Tracking & Cookies","Követési és cookie-beállítások","◍"],
  ["seo_keywords","SEO & Keywords","SEO és kulcsszavak","⌕"],
  ["heatmap","Consent Heatmap","Hozzájárulásos hőtérkép","◌"]
 ]},
 {id:"website_events",icon:"◈",label:["Website & Events","Weboldal és események"],items:[
  ["website_artists","Artists","Művészek","◉"],
  ["website_contacts","Contacts","Kapcsolatfelvételek","⌂"],
  ["digital_attendance","Digital Attendance","Digitális jelenlétiív","☑"],
  ["events","Events","Események","🎟"],
  ["event_guest_list","Guest Data","Vendégadatok",""],
  ["event_invitations","Invitations","Meghívások","✉"],
  ["media_library","Media Library","Médiatár","▧"],
  ["pages_content","Pages & Content","Oldalak és tartalmak","▤"],
  ["publish_preview","Publish & Preview","Publikálás és előnézet","◌"],
  ["showroom_pianos","Showroom Pianos","Bemutatott zongorák","♬"],
  ["event_tickets","Ticket Reservation","Jegyfoglalás",""]
 ]}
];
const adminNavigationItems=adminNavGroups.flatMap(group=>group.items.map(([view,en,hu])=>[view,`${en} / ${hu}`]));
const adminNavigationLabels=Object.fromEntries([
 ...adminNavGroups.map(group=>[group.id,`${group.label[0]} / ${group.label[1]}`]),
 ...adminNavigationItems
]);
const adminNavigationIcons=Object.fromEntries(adminNavGroups.flatMap(group=>group.items.map(([view,en,hu,icon])=>[view,icon])));
function adminGroupForView(view){return adminNavGroups.find(group=>group.id===view||group.items.some(item=>item[0]===view));}
function externalRouteForView(view){return view==="finance"?"balance_sheet":view;}
function internalViewFromRoute(route){return route==="balance_sheet"?"finance":route;}
function adminViewEnabled(view){
 const group=adminGroupForView(view);
 if(!group||isSuperadmin())return true;
 if(adminModuleState[group.id]===false)return false;
 return group.id===view||adminCardState[view]!==false;
}

const STANDARD_PAYMENT_METHODS=["Credit Card","Bank Transfer / ACH","Zelle","Check","Payment Link","PayPal","Cash"];
function standardPaymentMethodOptions(selected=""){return `<option value="">${bi("Select payment method","Válassz fizetési módot")}</option>`+STANDARD_PAYMENT_METHODS.map(method=>`<option value="${htmlText(method)}" ${method===selected?"selected":""}>${htmlText(method)}</option>`).join("");}
function billingIcon(name,className=""){
 const common=`class="billing-svg-icon ${htmlText(className)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"`;
 const icons={
  eye:`<svg ${common}><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></svg>`,
  check:`<svg ${common}><path d="m5 12.5 4.2 4.2L19.5 6.5"/></svg>`,
  close:`<svg ${common}><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  calendar:`<svg ${common}><path d="M6 3v3M18 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>`,
  download:`<svg ${common}><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg>`,
  print:`<svg ${common}><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/></svg>`
 };
 return icons[name]||"";
}
function adminPremiumIcon(view,fallback=""){
 const common='class="admin-premium-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
 const paths={
  event_tickets:'<path d="M4 7.5h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4v-3Z"/><path d="M9 7.5v10M15 7.5v10"/>',
  event_guest_list:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.7-3.4 2.7-5 5.5-5s4.8 1.6 5.5 5M17 8h4M17 12h4M17 16h4"/>',
  pianos:'<path d="M4 5h16v14H4zM7 5v8M11 5v8M15 5v8M19 5v8M6 13v6M10 13v6M14 13v6M18 13v6"/>',
  finance:'<path d="M4 6h16v12H4zM7 9h4M7 13h2M16.5 9.5a2 2 0 1 0 0 4 2 2 0 1 1 0 4M16.5 8v11"/>',
  income_statement:'<path d="M5 20V10M10 20V4M15 20v-7M20 20V7"/><path d="M3 20h19"/>',
  knowledge_base:'<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6"/>',
  invoice_documents:'<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6"/>',
  partners:'<path d="M8.5 11.5 11 14a1.4 1.4 0 0 0 2 0l4-4"/><path d="m3.5 9 4.2-4.2 4.1 1.4M20.5 9l-4.2-4.2-4.1 1.4M4 9l-1.5 1.5L7 15l2-2M20 9l1.5 1.5L17 15l-2-2"/>',
  scheduler:'<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M7 14h3M14 14h3M7 17h3"/>'
 };
 return paths[view]?`<svg ${common}>${paths[view]}</svg>`:fallback;
}
function chooseStandardPaymentMethod({title,initialValue="Cash",confirmText}={}){
 return new Promise(resolve=>{
  document.getElementById("paymentMethodChooserOverlay")?.remove();
  const overlay=document.createElement("div");overlay.id="paymentMethodChooserOverlay";overlay.className="nested-modal-overlay payment-method-chooser-overlay";
  overlay.innerHTML=`<section class="nested-modal-card payment-method-chooser-card" role="dialog" aria-modal="true"><header><h3>${htmlText(title||bi("Select payment method","Válassz fizetési módot"))}</h3><button type="button" class="modal-close ghost-btn" data-payment-cancel>${billingIcon("close")}</button></header><div class="payment-method-chooser-body"><label>${bi("Payment Method","Fizetési mód")}<select data-payment-method>${standardPaymentMethodOptions(STANDARD_PAYMENT_METHODS.includes(initialValue)?initialValue:"Cash")}</select></label><div class="actions"><button type="button" class="ghost-btn" data-payment-cancel>${bi("Cancel","Mégse")}</button><button type="button" data-payment-confirm>${billingIcon("check")} ${htmlText(confirmText||bi("Continue","Folytatás"))}</button></div></div></section>`;
  const finish=value=>{overlay.remove();resolve(value||null)};overlay.querySelectorAll("[data-payment-cancel]").forEach(button=>button.addEventListener("click",()=>finish(null)));overlay.addEventListener("click",event=>{if(event.target===overlay)finish(null)});overlay.querySelector("[data-payment-confirm]").addEventListener("click",()=>{const value=overlay.querySelector("[data-payment-method]")?.value||"";if(!STANDARD_PAYMENT_METHODS.includes(value))return showError(new Error("INVALID_PAYMENT_METHOD"));finish(value)});document.body.appendChild(overlay);overlay.querySelector("[data-payment-method]")?.focus();
 });
}
function parseFinancialNumber(value){
 const raw=String(value??"").trim().replace(/\s+/g,"");if(!raw)return 0;
 let normalized=raw;
 if(raw.includes(",")&&raw.includes(".")){normalized=raw.lastIndexOf(",")>raw.lastIndexOf(".")?raw.replace(/\./g,"").replace(",", "."):raw.replace(/,/g,"");}
 else if(raw.includes(",")) normalized=raw.replace(",", ".");
 const number=Number(normalized);return Number.isFinite(number)?number:NaN;
}
function roundFinancial(value){const number=Number(value||0);return Number.isFinite(number)?Math.round((number+Number.EPSILON)*100)/100:0;}

const schemas={
contacts:{api:"contacts",title:"Clients / Ügyfelek",fields:[["name","Client name / Ügyfél neve *"],["company","Company / Cég"],["type","Type / Típus"],["email","Email"],["phone","Phone / Telefonszám"],["address","Address / Cím"],["billing_address","Billing address / Számlázási cím"],["tax_id","Tax ID / Adószám"],["has_piano","Has piano? / Van zongorája?","select",[["0","No / Nem"],["1","Yes / Igen"]]],["interested_buying","Interested in buying? / Vásárlási érdeklődő?","select",[["0","No / Nem"],["1","Yes / Igen"]]],["interest_brand","Interested brand / Érdeklődött márka"],["interest_model","Interested model / Érdeklődött modell"],["interest_budget","Budget / Keretösszeg","number"],["interest_timeline","Timeline / Várható vásárlási idő"],["interest_notes","Purchase interest notes / Vásárlási érdeklődés megjegyzés","textarea"],["owner","Relationship owner / Kapcsolattartó gazda"],["last_contact","Last contact / Utolsó kapcsolat","date"],["next_step","Next step / Következő lépés"],["notes","Notes / Megjegyzés","textarea"]],cols:["customer_status_icon","name","phone","email","address","last_contact","next_step"]},
pianos:{api:"pianos",title:"Pianos / Zongorák",fields:[["display_name","Piano name / description / Zongora neve / leírás"],["brand","Brand / Márka"],["model","Model / Típus / modell"],["serial_no","Serial No. / Gyári szám"],["finish","Finish / Kivitel / Szín"],["year","Year / Év","number"],["build_year","Build year / Gyártási év","number"],["size_cm","Size (cm) / Méret (cm)"],["size_in","Size (inch) / Méret (inch)"],["ownership_type","Ownership / Tulajdon","select",["Customer owned","Company owned","Consignment","Rental","Unknown"]],["owner_contact_id","Owner client / Tulajdonos ügyfél"],["location","Location / Helyszín"],["estimated_value","Estimated value / Becsült érték","number"],["notes","Notes / Megjegyzés","textarea"]],cols:["display_name","serial_no","location","ownership_type","estimated_value"]},
knowledge_base:{api:"knowledge_base",title:"Invoices / Számlák",fields:[["title","Title / Cím"],["category","Category / Kategória"],["content_type","Content type / Tartalomtípus"],["body","Body / Tartalom","textarea"],["stored_path","Attachment path / Melléklet útvonal"],["owner","Relationship owner / Kapcsolattartó gazda"],["amount","Amount / Összeg","number"],["payment_method","Payment method / Fizetési mód","select",["",...STANDARD_PAYMENT_METHODS]],["invoice_number","Invoice number / Számlaszám"],],cols:["id","title","category","owner","amount","payment_method","invoice_number","stored_path","created_at"]}
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
   scheduler:"Scheduler",planned_jobs:"Planned Jobs",contacts:"Clients",pianos:"Pianos",closed_jobs:"Closed Jobs",knowledge_base:"Company Documents Archive",finance:"Balance Sheet",income_statement:"Income Statement",invoice_documents:"Invoices Documents",inventory:"Inventory",events:"Events",users:"Users", audit_log:"Audit Log", settings:"Settings", today:"Today", more:"More", newJob:"New Job", calendar:"Calendar", all:"All", workerFilter:"Worker", failed:"Failed", noClosedJobs:"No closed jobs yet", actions:"Actions", searchClients:"Search clients by name, address, or piano", searchPlaceholder:"Search as you type...", myProfile:"My profile", phone:"Phone", address:"Address", newPassword:"New password", leaveEmpty:"Leave empty to keep current", saveChanges:"Save changes", createUser:"Create user", editUser:"Edit user", addUser:"Add user", customerStatus:"Status", ownerClient:"Owner", buyerLead:"Buyer lead", ownerBuyerLead:"Owner + buyer lead", generalContact:"General"
 },
 hu:{
   appTitle:"Klavierhaus munkakezelő rendszer",loginSubtitle:"Naptárközpontú munkakezelés",email:"Email",password:"Jelszó",login:"Belépés",logout:"Kilépés",deleteEverything:"Mindent töröl",operations:"New York-i időzóna szerinti működés",logoutIn:"Automatikus kilépés",securityLogout:"Biztonsági kijelentkezés: 10 perc kattintás nélküli inaktivitás miatt kijelentkeztettünk.",activationTitle:"Fiók ellenőrzése",activationDescription:"Add meg a kapcsolattartási e-mail-címedre küldött hatjegyű kódot.",activationCode:"Aktiválókód",activationVerify:"Ellenőrzés és belépés",activationResend:"Új kód küldése",activationBack:"Vissza a belépéshez",activationRecipient:"A kód címzettje",
   scheduler:"Naptár",planned_jobs:"Tervezett munkák",contacts:"Ügyfelek",pianos:"Zongorák",closed_jobs:"Lezárt munkák",knowledge_base:"Céges dokumentumtár",finance:"Mérleg",income_statement:"Eredménykimutatás",invoice_documents:"Számladokumentumok",inventory:"Leltár",events:"Események",users:"Felhasználók", audit_log:"Módosítási napló", settings:"Beállítások", today:"Ma", more:"Továbbiak", newJob:"Új munka", calendar:"Naptár", all:"Minden", workerFilter:"Munkatárs", failed:"Sikertelen", noClosedJobs:"Még nincs lezárt munka", actions:"Műveletek", searchClients:"Ügyfelek keresése név, cím vagy zongora alapján", searchPlaceholder:"Gépelés közbeni keresés...", myProfile:"Adataim", phone:"Telefonszám", address:"Lakcím", newPassword:"Új jelszó", leaveEmpty:"Hagyd üresen, ha marad", saveChanges:"Módosítás mentése", createUser:"Felhasználó létrehozása", editUser:"Felhasználó szerkesztése", addUser:"Felhasználó hozzáadása", customerStatus:"Státusz", ownerClient:"Birtokló", buyerLead:"Érdeklődő", ownerBuyerLead:"Birtokló + érdeklődő", generalContact:"Általános"
 }
};
let branding={company_name:'Klavierhaus',short_name:'KH ERP',logo_url:'/icons/icon-512.png',login_background_url:'',branding_version:'1'};
let adminModuleState={};
let adminCardState={};
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
function navLabel(view){return splitBilingualText(adminNavigationLabels[view]||tr(view)||view);}
function navItemAllowed(view){
 if(!adminViewEnabled(view))return false;
 if(isAdmin())return true;
 if(view==="customer_inbox")return ["MANAGER","WORKER"].includes(user?.role);
 if(view==="audit_log")return userPermissions.all||userPermissions.permissions.includes("audit.view");
 return userPermissions.all||userPermissions.permissions.includes(`${view}.view`);
}
function visibleNavigationItems(){
 if(isAdmin())return adminNavGroups.filter(group=>adminModuleState[group.id]!==false||isSuperadmin()).map(group=>[group.id,`${group.label[0]} / ${group.label[1]}`]);
 return (navs[user?.role]||navs.WORKER).filter(([view])=>navItemAllowed(view));
}
function adminGroupButtonMarkup(group){
 const label=currentLang==='hu'?group.label[1]:group.label[0],disabled=adminModuleState[group.id]===false,active=!navigationHomeNeutral&&adminGroupForView(currentView)?.id===group.id;
 return `<button type="button" class="nav-btn admin-group-btn ${active?'active':''} ${disabled?'is-disabled':''}" data-v="${group.id}" title="${htmlText(label)}" aria-label="${htmlText(label)}"><span class="nav-icon" aria-hidden="true">${group.icon}</span><span class="nav-label">${htmlText(label)}</span>${disabled?'<span class="nav-disabled-dot" aria-hidden="true">•</span>':''}</button>`;
}

async function loadAdminModuleState(){try{const payload=await api('/api/admin/modules');adminModuleState=Object.fromEntries((payload.modules||[]).map(item=>[item.key,Boolean(item.enabled)]));adminCardState=Object.fromEntries((payload.cards||[]).map(item=>[item.key,Boolean(item.enabled)]));window.__adminModules=payload;}catch(error){if(isAuthenticationError(error))throw error;adminModuleState={};adminCardState={};}}
function navigationIcon(view){const fallback=adminNavigationIcons[view]||({workshop_workflow:"▦",planned_jobs:"🗂",contacts:"👥",closed_jobs:"✅",inventory:"📦",events:"🎟",users:"👤",audit_log:"🧾",settings:"⚙",digital_attendance:"☑",customer_inbox:"▣"}[view]||"•");return adminPremiumIcon(view,fallback);}
function navigationButtonMarkup(view){const label=navLabel(view),icon=navigationIcon(view),active=!navigationHomeNeutral&&view===currentView;return `<button type="button" class="nav-btn nav-item-btn ${active?"active":""}" data-v="${view}" title="${htmlText(label)}" aria-label="${htmlText(label)}"><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${htmlText(label)}</span></button>`;}
function syncNavigationActiveState(){
 const groupId=!navigationHomeNeutral&&isAdmin()?adminGroupForView(currentView)?.id||"":"";
 document.querySelectorAll("#nav .nav-btn").forEach(button=>{
  const active=!navigationHomeNeutral&&(isAdmin()?button.dataset.v===groupId:button.dataset.v===currentView);
  button.classList.toggle("active",active);
  if(active)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");
 });
 updateMobileNavigationActive();
}
function renderNavigation(){
  if(!token || !user || !document.getElementById("nav")) return;
  const navEl=document.getElementById("nav");
  if(isAdmin()) navEl.innerHTML=adminNavGroups.filter(group=>adminModuleState[group.id]!==false||isSuperadmin()).map(adminGroupButtonMarkup).join('');
  else navEl.innerHTML=visibleNavigationItems().map(([view])=>navigationButtonMarkup(view)).join("");
  syncNavigationActiveState();
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
  updateCountdownDisplay();
  syncAllCustomSelects();
}
function updateLanguageButtons(){
  const en=document.getElementById("langEnBtn"), hu=document.getElementById("langHuBtn");
  if(en) en.classList.toggle("active",currentLang==="en");
  if(hu) hu.classList.toggle("active",currentLang==="hu");
}

function enforceDarkAppearance(){
  document.documentElement.removeAttribute("data-theme");
  try{
    localStorage.removeItem("kh_theme_guest");
    if(user?.id)localStorage.removeItem(`kh_theme_${user.id}`);
  }catch(_error){}
}

const API_REQUEST_TIMEOUT_MS=12000;
const BOOT_WATCHDOG_MS=30000;
function requestTimeoutError(url,timeoutMs){const error=new Error(`REQUEST_TIMEOUT:${url}`);error.code='REQUEST_TIMEOUT';error.timeoutMs=timeoutMs;return error;}
async function fetchWithTimeout(url,opt={},timeoutMs=API_REQUEST_TIMEOUT_MS){
 const controller=new AbortController();
 const externalSignal=opt.signal;
 let externallyAborted=false;
 const abortFromExternal=()=>{externallyAborted=true;controller.abort(externalSignal?.reason);};
 if(externalSignal){if(externalSignal.aborted)abortFromExternal();else externalSignal.addEventListener('abort',abortFromExternal,{once:true});}
 const timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||API_REQUEST_TIMEOUT_MS));
 try{return await fetch(url,{...opt,signal:controller.signal});}
 catch(error){if(controller.signal.aborted&&!externallyAborted)throw requestTimeoutError(url,timeoutMs);throw error;}
 finally{clearTimeout(timer);if(externalSignal)externalSignal.removeEventListener?.('abort',abortFromExternal);}
}
async function loadBranding(){
 try{
  const response=await fetchWithTimeout('/api/public/branding',{cache:'no-store'},8000);
  if(response.ok)branding=await response.json();
 }catch(error){console.warn('Branding unavailable during bootstrap:',error?.message||error);}
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
function isAuthenticationError(error){return Number(error?.status||0)===401||error?.code==="AUTH_EXPIRED";}
function showCleanLoginState(message=""){
  hideNotificationActivationGate?.();
  document.getElementById("app")?.classList.add("hidden");
  document.getElementById("notificationActivationGate")?.classList.add("hidden");
  const login=document.getElementById("login");if(login)login.classList.remove("hidden");
  document.body.classList.remove("notification-gate-open");
  const form=document.getElementById("loginForm");if(form)form.classList.remove("hidden");
  document.getElementById("activationForm")?.classList.add("hidden");
  const submit=document.getElementById("loginSubmitButton");if(submit)submit.disabled=false;
  if(message){
    const card=document.querySelector(".login-card");
    if(card){let status=document.getElementById("loginSessionStatus");if(!status){status=document.createElement("p");status.id="loginSessionStatus";status.className="login-session-status";card.appendChild(status);}status.textContent=message;}
  }
}
function clearAuthenticationState(message=""){
  token=null;user=null;userPermissions={all:false,permissions:[]};
  apiResponseCache.clear();schedulerWorkersCache=null;
  localStorage.removeItem("kh_token");localStorage.removeItem("kh_user");
  try{sessionActivity?.destroy?.();}catch(_error){}
  if(countdownInterval){clearInterval(countdownInterval);countdownInterval=null;}
  applicationBooting=false;applicationBootPromise=null;
  showCleanLoginState(message||bi("Your session expired. Please sign in again.","A munkamenet lejárt. Jelentkezz be újra."));
}
async function validateAuthenticatedSession(){
  if(!token){clearAuthenticationState();return null;}
  try{
    const freshUser=await apiRequest("/api/me",{masterCache:false,timeoutMs:8000,skipAuthReset:true});
    if(!freshUser||!freshUser.id){const error=new Error("INVALID_SESSION_USER");error.code="AUTH_EXPIRED";error.status=401;throw error;}
    user=freshUser;localStorage.setItem("kh_user",JSON.stringify(user));return user;
  }catch(error){
    if(isAuthenticationError(error)){clearAuthenticationState();error.code="AUTH_EXPIRED";}
    throw error;
  }
}
async function apiRequest(url,opt={}){
 const timeoutMs=Math.max(1000,Number(opt.timeoutMs)||API_REQUEST_TIMEOUT_MS);
 const requestOptions={...opt};delete requestOptions.timeoutMs;delete requestOptions.masterCache;const skipAuthReset=Boolean(requestOptions.skipAuthReset);delete requestOptions.skipAuthReset;
 const response=await fetchWithTimeout(url,{...requestOptions,headers:{...(requestOptions.body instanceof FormData?{}:{"Content-Type":"application/json"}),Authorization:"Bearer "+token,...(requestOptions.headers||{})}},timeoutMs);
 const text=await response.text();let body={};
 try{body=text?JSON.parse(text):{}}catch(_error){body={error:text||"Non-JSON response"}}
 if(!response.ok){const error=new Error(body.error||`API ${response.status}`);error.details=body;error.status=response.status;if(response.status===401){error.code="AUTH_EXPIRED";if(!skipAuthReset)clearAuthenticationState();}throw error}
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
 if(select.dataset.nativeSelect==='true' || select.multiple || select.size>1)return;
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
 applicationBootPromise=null;applicationBooting=false;
 apiResponseCache.clear();schedulerWorkersCache=null;
 token=String(result?.token||"");user=result?.user||null;
 if(!token||!user?.id)return showError("INVALID_LOGIN");
 localStorage.setItem("kh_token",token);
 localStorage.setItem("kh_user",JSON.stringify(user));
 if(email)localStorage.setItem("kh_last_login_email",email);
 pendingAccountActivation=null;
 navigationHomeNeutral=true;
 forceWorkflowHomeOnBoot=true;
 enforceDarkAppearance();
 loadLanguage();
 void boot().catch(handleApplicationBootstrapError);
}

const loginFormElement=document.getElementById("loginForm");
if(loginFormElement)loginFormElement.onsubmit=async e=>{
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
const activationFormElement=document.getElementById("activationForm");
if(activationFormElement)activationFormElement.onsubmit=async e=>{
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
const activationResendElement=document.getElementById("activationResendButton");
if(activationResendElement)activationResendElement.onclick=async()=>{
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
const activationBackElement=document.getElementById("activationBackButton");if(activationBackElement)activationBackElement.onclick=showLoginStep;
const logoutElement=document.getElementById("logoutBtn");if(logoutElement)logoutElement.onclick=()=>logoutNow();

const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
let countdownInterval = null;
function logoutNow(){
  stopDigitalAttendanceLiveSync?.();
  if(token){try{fetch('/api/logout',{method:'POST',headers:{Authorization:'Bearer '+token},keepalive:true});}catch(e){}}
  localStorage.removeItem("kh_token");
  localStorage.removeItem("kh_user");
  location.reload();
}
function createSessionActivityController({timeoutMs=10*60*1000,setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,onTimeout=()=>{},canRun=()=>true,onStateChange=()=>{}}={}){
  let timer=null,deadline=0,remainingMs=timeoutMs;
  const notify=()=>onStateChange(controller.snapshot());
  const controller={
    activeModalCount:0,paused:false,
    resetTimer(){
      if(timer){clearTimer(timer);timer=null;}
      if(!canRun()){deadline=0;remainingMs=timeoutMs;notify();return null;}
      this.paused=false;remainingMs=timeoutMs;deadline=now()+timeoutMs;
      timer=setTimer(()=>{timer=null;deadline=0;remainingMs=0;notify();onTimeout();},timeoutMs);
      notify();return timer;
    },
    pause(){
      if(this.paused)return;
      remainingMs=deadline?Math.max(0,deadline-now()):timeoutMs;
      this.paused=true;if(timer){clearTimer(timer);timer=null;}deadline=0;notify();
    },
    resume(){if(this.activeModalCount>0||!canRun())return null;return this.resetTimer();},
    touch(){if(!canRun()||this.activeModalCount>0||this.paused)return null;return this.resetTimer();},
    modalOpened(){this.activeModalCount+=1;this.pause();return this.activeModalCount;},
    modalClosed(){this.activeModalCount=Math.max(0,this.activeModalCount-1);if(this.activeModalCount===0)this.resume();else notify();return this.activeModalCount;},
    setModalCount(count){
      const next=Math.max(0,Number(count)||0),previous=this.activeModalCount;
      if(next===previous){if(next>0&&!this.paused)this.pause();return this.activeModalCount;}
      this.activeModalCount=next;
      if(next>0){if(!this.paused)this.pause();else notify();}
      else this.resume();
      return this.activeModalCount;
    },
    remaining(){return this.paused?remainingMs:(deadline?Math.max(0,deadline-now()):remainingMs);},
    snapshot(){return {activeModalCount:this.activeModalCount,paused:this.paused,remainingMs:this.remaining(),timerActive:Boolean(timer)};},
    destroy(){if(timer){clearTimer(timer);timer=null;}deadline=0;this.activeModalCount=0;this.paused=false;remainingMs=timeoutMs;notify();}
  };
  return controller;
}
function updateCountdownDisplay(){
  const el=document.getElementById("sessionCountdown");
  if(!el || !token) return;
  const remaining=sessionActivity.remaining();
  const totalSeconds=Math.ceil(remaining/1000);
  const mm=String(Math.floor(totalSeconds/60)).padStart(2,"0");
  const ss=String(totalSeconds%60).padStart(2,"0");
  el.style.display="";
  el.textContent=sessionActivity.paused?`${tr("logoutIn")}: PAUSED`:`${tr("logoutIn")}: ${mm}:${ss}`;
  el.classList.toggle("warning", !sessionActivity.paused&&remaining<=60000);
}
const sessionActivity=createSessionActivityController({
  timeoutMs:INACTIVITY_LIMIT_MS,
  onTimeout:()=>logoutNow(),
  canRun:()=>Boolean(token),
  onStateChange:()=>updateCountdownDisplay()
});
sessionActivity.observer=null;
sessionActivity.visibleModalCount=function(){const roots=[...document.querySelectorAll('#modal:not(.hidden), .nested-modal-overlay, .system-dialog-overlay, .workflow-event-log-modal, .workflow-drawer')];const extras=[...document.querySelectorAll('[role="dialog"]')].filter(el=>!el.closest('#modal,.nested-modal-overlay,.system-dialog-overlay,.workflow-event-log-modal,.workflow-drawer'));const visible=el=>{const style=getComputedStyle(el);return style.display!=="none"&&style.visibility!=="hidden"&&!el.classList.contains("hidden");};return new Set([...roots,...extras].filter(visible)).size;};
sessionActivity.syncModalState=function(){this.setModalCount(this.visibleModalCount());};
sessionActivity.install=function(){
 if(this.observer||!document.body)return;
 let syncQueued=false;
 const scheduleSync=()=>{if(syncQueued)return;syncQueued=true;queueMicrotask(()=>{syncQueued=false;this.syncModalState();});};
 this.observer=new MutationObserver(scheduleSync);
 this.observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','aria-hidden']});
 this.syncModalState();
};
window.sessionActivity=sessionActivity;
function resetInactivityTimer({force=false}={}){
  if(!token)return;
  if(sessionActivity.activeModalCount>0&&!force){sessionActivity.pause();return;}
  sessionActivity.resetTimer();
  if(countdownInterval)clearInterval(countdownInterval);
  countdownInterval=setInterval(updateCountdownDisplay,1000);
  updateCountdownDisplay();
}
document.addEventListener("click",()=>sessionActivity.touch(),true);
document.addEventListener("keydown",()=>sessionActivity.touch(),true);
document.addEventListener("input",()=>sessionActivity.touch(),true);

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
  if(ok){document.getElementById('app')?.classList.remove('hidden');render('workshop_workflow');showToast(bi('Notifications enabled successfully.','Az értesítések sikeresen engedélyezve.'),'success');}
 }catch(error){showNotificationActivationGate(Notification.permission==='denied'?'BLOCKED':'NOT_CONFIGURED',error.message);}finally{notificationGateBusy=false;}
}
function initNotificationActivationGate(){
 const enable=document.getElementById('notificationGateEnable'),check=document.getElementById('notificationGateCheck'),help=document.getElementById('notificationGateHelp'),logout=document.getElementById('notificationGateLogout'),panel=document.getElementById('notificationGateHelpPanel');
 if(enable)enable.onclick=enableMandatoryNotifications;
 if(check)check.onclick=async()=>{const ok=await evaluateMandatoryNotificationGate({showGate:true});if(ok){document.getElementById('app')?.classList.remove('hidden');render('workshop_workflow');}};
 if(help)help.onclick=()=>{panel.innerHTML=notificationHelpHtml();panel.classList.toggle('hidden');};
 if(logout)logout.onclick=logoutNow;
 const recheck=async()=>{if(!token||document.visibilityState==='hidden'||!requiresMandatoryDeviceNotifications())return;const gate=document.getElementById('notificationActivationGate');const wasLocked=gate&&!gate.classList.contains('hidden');const ok=await evaluateMandatoryNotificationGate({showGate:true});const app=document.getElementById('app');if(!ok){app?.classList.add('hidden');return;}app?.classList.remove('hidden');if(wasLocked)render(currentView||'workshop_workflow',{noHistory:true});};
 document.addEventListener('visibilitychange',recheck);
 window.addEventListener('focus',recheck);
 window.addEventListener('pageshow',recheck);
}
function initBrandHomeButton(){
 const button=document.getElementById('brandHomeButton');
 if(button)button.onclick=()=>{navigationHomeNeutral=true;closeModal();render('workshop_workflow',{homeNavigation:true});};
}

let applicationBootPromise=null;
let applicationBooting=false;
let forceWorkflowHomeOnBoot=false;
function bootstrapStatusMarkup(message,detail=""){return `<div class="panel app-recovery-panel" role="status"><h3>${htmlText(message)}</h3>${detail?`<p class="muted">${htmlText(detail)}</p>`:""}</div>`;}
function showApplicationBootstrapState(message=bi("Loading workspace…","Munkaterület betöltése…"),detail=""){
 const app=document.getElementById("app"),target=ensureView("workshop_workflow");
 app?.classList.remove("hidden");
 forceShowView("workshop_workflow");
 target.classList.remove("i18n-rendering");
 target.innerHTML=bootstrapStatusMarkup(message,detail);
}
function handleApplicationBootstrapError(error){
 console.error("Application bootstrap failed",error);
 applicationBooting=false;applicationBootPromise=null;
 if(isAuthenticationError(error)||!token){clearAuthenticationState();return null;}
 hideNotificationActivationGate();
 document.getElementById("login")?.classList.add("hidden");
 document.getElementById("app")?.classList.remove("hidden");
 document.body.classList.add("sidebar-collapsed");
 try{renderNavigation();updateStaticChromeLanguage();updateSidebarToggle();}catch(_error){}
 const target=forceShowView("workshop_workflow");
 target.classList.remove("i18n-rendering");
 const message=error?.code==="REQUEST_TIMEOUT"?bi("The server did not answer in time.","A szerver nem válaszolt időben."):bi("The application could not finish loading.","Az alkalmazás betöltése nem fejeződött be.");
 target.innerHTML=`<div class="panel app-recovery-panel"><h2>${message}</h2><p>${bi("Your session is still available. You can retry the startup safely.","A munkameneted megmaradt. A betöltést biztonságosan újrapróbálhatod.")}</p><p class="danger-text">${htmlText(error?.message||String(error||"BOOT_FAILED"))}</p><div class="actions"><button type="button" onclick="retryApplicationBoot()">${bi("Retry loading","Betöltés újrapróbálása")}</button><button type="button" class="ghost-btn" onclick="logoutNow()">${bi("Log out","Kijelentkezés")}</button></div></div>`;
 updateCountdownDisplay();
 return null;
}
function retryApplicationBoot(){applicationBootPromise=null;applicationBooting=false;showApplicationBootstrapState();void boot().catch(handleApplicationBootstrapError);}
async function boot(){
 if(!token)return null;
 if(applicationBootPromise)return applicationBootPromise;
 applicationBooting=true;
 applicationBootPromise=(async()=>{
  const watchdog=new Promise((_,reject)=>setTimeout(()=>{const error=new Error("BOOT_TIMEOUT");error.code="BOOT_TIMEOUT";reject(error);},BOOT_WATCHDOG_MS));
  const run=(async()=>{
   await loadBranding();
   loadLanguage();
   enforceDarkAppearance();
   try{await validateAuthenticatedSession();}catch(error){if(isAuthenticationError(error))return false;throw error;}
   document.getElementById("login")?.classList.add("hidden");
   showApplicationBootstrapState();
   document.body.classList.add("sidebar-collapsed");
   const sb=document.getElementById("sidebarToggle");
   if(sb)sb.onclick=toggleSidebar;
   initBrandHomeButton();
   updateSidebarToggle();
   const userInfo=document.getElementById("userInfo");
   if(userInfo)userInfo.textContent=`${user?.name||""} · ${user?.role||""}`;
   try{userPermissions=await api("/api/my-permissions");}catch(error){if(isAuthenticationError(error))return false;console.warn("Permissions unavailable during bootstrap:",error?.message||error);userPermissions={all:isSuperadmin(),permissions:[]};}
   await loadAdminModuleState();
   const requestedBootView=viewFromLocation();
   const bootToNeutralHome=forceWorkflowHomeOnBoot||!requestedBootView;
   if(bootToNeutralHome)navigationHomeNeutral=true;
   renderNavigation();
   updateStaticChromeLanguage();
   const danger=document.getElementById("deleteEverythingBtn");
   if(danger)danger.classList.toggle("hidden",!isSuperadmin());
   resetInactivityTimer();
   sessionActivity.install();
   initViewHistory();
   const nav=document.getElementById("nav");
   if(nav)nav.onclick=e=>{
    const b=e.target.closest("button");if(!b?.dataset.v)return;
    void render(b.dataset.v,{navigationActivate:true});
   };
   initMobileAppShell();
   initCustomSelectSystem();
   initAdminDatePickerSystem();
   initNotificationCenter();
   initNotificationActivationGate();
   const notificationsReady=await evaluateMandatoryNotificationGate({showGate:true});
   if(notificationsReady){
    document.getElementById("app")?.classList.remove("hidden");
    const bootView=forceWorkflowHomeOnBoot?"workshop_workflow":(requestedBootView||"workshop_workflow");
    forceWorkflowHomeOnBoot=false;
    await render(bootView,{noHistory:true,replaceHistory:true,homeNavigation:bootToNeutralHome});
   }else{
    const gate=document.getElementById("notificationActivationGate");
    const gateVisible=Boolean(gate&&!gate.classList.contains("hidden"));
    if(!gateVisible){throw new Error("NOTIFICATION_GATE_UNAVAILABLE");}
   }
   const googleResult=new URLSearchParams(location.search).get("googleCalendar");
   if(googleResult){
    setTimeout(()=>showToast(googleResult==="connected"?bi("Google Calendar connected. The first synchronization has started.","A Google Naptár csatlakoztatva. Az első szinkronizálás elindult."):bi("Google Calendar could not be connected.","A Google Naptár csatlakoztatása nem sikerült."),googleResult==="connected"?"success":"error"),300);
    history.replaceState({},"",location.pathname);
   }
   applyLanguageToDOM();
   applicationBooting=false;
   return true;
  })();
  return Promise.race([run,watchdog]);
 })();
 try{return await applicationBootPromise;}
 catch(error){return handleApplicationBootstrapError(error);}
 finally{if(!applicationBooting)applicationBootPromise=null;}
}
function updateSidebarToggle(){
 const button=document.getElementById("sidebarToggle");
 if(!button)return;
 const collapsed=document.body.classList.contains("sidebar-collapsed");
 button.textContent=collapsed?"☰":"×";
 button.setAttribute("aria-expanded",String(!collapsed));
 button.setAttribute("aria-label",collapsed?"Open menu":"Close menu");
}
function toggleSidebar(){document.body.classList.toggle("sidebar-collapsed");updateSidebarToggle();}
function money(n){return "$"+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}
function badge(v){let c=String(v||"").split(" ")[0];return `<span class="badge ${c}">${v||""}</span>`}
function fmtDate(d){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)}
function dateKeyToUtcDate(key){return new Date(`${String(key).slice(0,10)}T12:00:00Z`)}
function dateKeyFromAny(value){if(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}/.test(value))return value.slice(0,10);return fmtDate(value instanceof Date?value:new Date(value))}
function startOfWeek(value){const key=dateKeyFromAny(value),d=dateKeyToUtcDate(key),day=d.getUTCDay(),diff=day===0?-6:1-day;d.setUTCDate(d.getUTCDate()+diff);return d}
function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x}
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
const SCHEDULE_INTERVAL_MINUTES=15;
function roundWallClockUp(value,step=SCHEDULE_INTERVAL_MINUTES){
 const parts=localDateTimeParts(value);if(!parts)return value;
 const remainder=parts.minute%step;
 return remainder===0?formatWallClockDateTime(parts.stamp):formatWallClockDateTime(parts.stamp+(step-remainder)*60000);
}
function isFiveMinuteDateTime(value){const parts=localDateTimeParts(value);return Boolean(parts)&&parts.minute%SCHEDULE_INTERVAL_MINUTES===0;}
function roundWallClockToQuarter(value){
 const parts=localDateTimeParts(value);if(!parts)return value;
 const rounded=Math.round(parts.minute/SCHEDULE_INTERVAL_MINUTES)*SCHEDULE_INTERVAL_MINUTES;
 const base=parts.stamp-parts.minute*60000;
 return formatWallClockDateTime(base+rounded*60000);
}
function quarterHourPickerMarkup(id,name,label,value,{preserveExact=false,step=String(SCHEDULE_INTERVAL_MINUTES*60)}={}){
 const normalized=preserveExact&&localDateTimeParts(value)?String(value).slice(0,16):roundWallClockToQuarter(value),parts=localDateTimeParts(normalized)||localDateTimeParts(roundWallClockUp(newYorkNowLocal()));
 const date=`${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}`,hour=String(parts.hour).padStart(2,'0'),minute=String(parts.minute).padStart(2,'0');
 const hours=Array.from({length:24},(_,i)=>String(i).padStart(2,'0')).map(v=>`<option value="${v}" ${v===hour?'selected':''}>${v}</option>`).join('');
 const allowedMinutes=['00','15','30','45'];if(preserveExact&&!allowedMinutes.includes(minute))allowedMinutes.push(minute);allowedMinutes.sort();
 const minutes=allowedMinutes.map(v=>`<option value="${v}" ${v===minute?'selected':''}>${v}</option>`).join('');
 return `<div class="field quarter-hour-field"><label>${label}</label><input id="${id}" name="${name}" type="hidden" value="${normalized}" data-step="${htmlText(step)}"><div class="quarter-hour-picker" data-quarter-picker="${id}"><input type="date" data-q-date value="${date}" aria-label="${bi('Date','Dátum')}"><select data-q-hour aria-label="${bi('Hour','Óra')}">${hours}</select><span>:</span><select data-q-minute aria-label="${bi('Minute','Perc')}">${minutes}</select></div></div>`;
}
function bindQuarterHourPicker(id,onChange){
 const hidden=document.getElementById(id),box=document.querySelector(`[data-quarter-picker="${id}"]`);if(!hidden||!box)return;
 const date=box.querySelector('[data-q-date]'),hour=box.querySelector('[data-q-hour]'),minute=box.querySelector('[data-q-minute]');
 const sync=()=>{if(!date.value)return;hidden.value=`${date.value}T${hour.value}:${minute.value}`;hidden.dispatchEvent(new Event('change',{bubbles:true}));if(onChange)onChange(hidden.value);};
 [date,hour,minute].forEach(el=>el.addEventListener('change',sync));
}
function formatAmericanDate(dateKey){
 const match=String(dateKey||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return match?`${match[2]}/${match[3]}/${match[1]}`:'';
}
function parseAmericanDate(value){
 const match=String(value||'').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!match)return null;
 const month=Number(match[1]),day=Number(match[2]),year=Number(match[3]);if(month<1||month>12||day<1||day>31)return null;
 const stamp=new Date(Date.UTC(year,month-1,day,12));if(stamp.getUTCFullYear()!==year||stamp.getUTCMonth()!==month-1||stamp.getUTCDate()!==day)return null;
 return `${match[3]}-${match[1]}-${match[2]}`;
}
function time12Label(hhmm){
 const [rawHour,rawMinute]=String(hhmm||'00:00').split(':').map(Number),suffix=rawHour>=12?'PM':'AM',hour=rawHour%12||12;
 return `${String(hour).padStart(2,'0')}:${String(rawMinute||0).padStart(2,'0')} ${suffix}`;
}
function halfHourOptions(selected='10:00'){
 const opts=[];for(let minutes=7*60;minutes<=21*60;minutes+=30){const value=`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;opts.push(`<option value="${value}" ${value===selected?'selected':''}>${time12Label(value)}</option>`);}return opts.join('');
}
function snapHalfHourTime(value,fallback='10:00'){
 const match=String(value||'').match(/T(\d{2}):(\d{2})/);if(!match)return fallback;
 let minutes=Number(match[1])*60+Number(match[2]);minutes=Math.round(minutes/30)*30;minutes=Math.max(7*60,Math.min(21*60,minutes));return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}
function jobClockIconMarkup(){return `<span class="job-time-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5v5l3.25 2"></path></svg></span>`;}
function compactDateTimeControlMarkup(id,name,value,{defaultTime='10:00',required=false,disabled=false,allowEmpty=false,dataAttr=""}={}){
 const parts=value?localDateTimeParts(value):null,fallback=!allowEmpty&&!parts?localDateTimeParts(newYorkNowLocal()):null,source=parts||fallback;
 const dateKey=source?`${source.year}-${String(source.month).padStart(2,'0')}-${String(source.day).padStart(2,'0')}`:"",time=snapHalfHourTime(value,defaultTime),normalized=dateKey?`${dateKey}T${time}`:"";
 const safeId=htmlText(id),disabledAttr=disabled?' disabled':'',requiredAttr=required?' required':'',nameAttr=name?` name="${htmlText(name)}"`:"",dataAttribute=dataAttr?` ${dataAttr}`:"";
 return `<input id="${safeId}"${nameAttr} type="hidden" value="${htmlText(normalized)}"${disabledAttr}${dataAttribute}><div class="job-datetime-control" data-job-datetime="${safeId}" data-job-allow-empty="${allowEmpty?'true':'false'}"><div class="job-date-entry"><input type="text" inputmode="numeric" autocomplete="off" data-job-date value="${dateKey?formatAmericanDate(dateKey):''}" placeholder="MM/DD/YYYY" pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"${requiredAttr}${disabledAttr} aria-label="${bi('Date MM/DD/YYYY','D\u00e1tum MM/DD/YYYY')}"><button type="button" class="job-date-picker-button" data-job-date-button aria-label="${bi('Open calendar','Napt\u00e1r megnyit\u00e1sa')}" aria-haspopup="dialog"${disabledAttr}>${adminDatePickerIcon()}</button></div><div class="job-time-entry">${jobClockIconMarkup()}<select data-job-time data-native-select="true" aria-label="${bi('Time','Id\u0151')}"${disabledAttr}>${halfHourOptions(time)}</select></div></div>`;
}
function jobDateTimePickerMarkup(id,name,label,value,{defaultTime='10:00'}={}){
 return `<div class="field job-datetime-field"><label>${label}</label>${compactDateTimeControlMarkup(id,name,value,{defaultTime,required:true})}<small class="job-date-format-hint">MM/DD/YYYY · 07:00 AM–09:00 PM</small></div>`;
}
function setJobDateTimePickerDisabled(id,disabled){
 const hidden=document.getElementById(id),box=document.querySelector(`[data-job-datetime="${id}"]`);if(!hidden||!box)return;
 hidden.disabled=Boolean(disabled);box.classList.toggle('is-disabled',Boolean(disabled));
 box.querySelectorAll('[data-job-date],[data-job-time],[data-job-date-button]').forEach(control=>{control.disabled=Boolean(disabled);});
}
function bindJobDateTimePicker(id,onChange){
 const hidden=document.getElementById(id),box=document.querySelector(`[data-job-datetime="${id}"]`);if(!hidden||!box)return;
 if(hidden.dataset.jobDateBound==='true'){setJobDateTimePickerDisabled(id,hidden.disabled);return;}
 hidden.dataset.jobDateBound='true';
 const date=box.querySelector('[data-job-date]'),time=box.querySelector('[data-job-time]'),dateButton=box.querySelector('[data-job-date-button]'),allowEmpty=box.dataset.jobAllowEmpty==='true';
 const sync=()=>{const raw=String(date.value||'').trim();if(!raw&&allowEmpty){date.setCustomValidity('');hidden.value='';hidden.dispatchEvent(new Event('change',{bubbles:true}));if(onChange)onChange(hidden.value);return;}const dateKey=parseAmericanDate(raw);date.setCustomValidity(dateKey?'':bi('Use MM/DD/YYYY format.','Use MM/DD/YYYY format.'));if(!dateKey)return;hidden.value=`${dateKey}T${time.value}`;hidden.dispatchEvent(new Event('change',{bubbles:true}));if(onChange)onChange(hidden.value);};
 const datePickerAdapter={type:'date',value:'',get disabled(){return Boolean(date.disabled);},dispatchEvent(event){if(event?.type==='change'&&this.value){date.value=formatAmericanDate(this.value);sync();}return true;}};
 const openCalendar=()=>{if(date.disabled)return;datePickerAdapter.value=parseAmericanDate(date.value)||nyDateKey();adminDatePickerOpen(datePickerAdapter,dateButton||date);};
 date.addEventListener('change',sync);date.addEventListener('blur',sync);date.addEventListener('click',openCalendar);time.addEventListener('change',sync);dateButton?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openCalendar();});
 setJobDateTimePickerDisabled(id,hidden.disabled);
}
function bindJobDateTimePickers(root=document){root.querySelectorAll?.('[data-job-datetime]').forEach(box=>bindJobDateTimePicker(box.dataset.jobDatetime));}
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
 return Number(match[2])%SCHEDULE_INTERVAL_MINUTES===0?minutes:NaN;
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
    currentSchedulerWorker="ALL";
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
  const isWorkflow=["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(job.calendar_entry_type);
  if(currentSchedulerEntryFilter==="CALENDAR" && isWorkflow)return false;
  if(currentSchedulerEntryFilter==="WORKFLOW" && !isWorkflow)return false;
  if(job.calendar_entry_type==="KLAVIERHAUS_EVENT") return true;
  if(isWorkflow)return currentSchedulerWorker==="ALL" || currentSchedulerWorker==="COMPLETED"&&String(job.status)==="Completed" || currentSchedulerWorker==="FAILED"&&String(job.status)==="Overdue" || String(currentSchedulerWorker).startsWith("worker:")&&String(job.assigned_user_id||"")===String(currentSchedulerWorker).slice(7);
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
function updateNYClock(){ const el=document.getElementById("currentNYClock"); if(el) el.textContent=currentNYTimeString(); document.querySelectorAll("[data-workflow-ny-clock]").forEach(clock=>{clock.textContent=currentNYTimeString();}); }
setInterval(updateNYClock,30000);
function isClosedJobStatus(status){ return ["Completed","Partially completed","Failed"].includes(String(status||"")); }
function isOverdueJob(j){ return !isClosedJobStatus(j.status) && String(j.end_time||"") && String(j.end_time).slice(0,16) < nyNowLocalString(); }
function calendarEventClass(j){
 if(j?.calendar_entry_type==="KLAVIERHAUS_EVENT") return "KlavierhausEvent";
 if(["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(j?.calendar_entry_type)) return j.workflow_color_state==="CLOSED"?"Completed":j.workflow_color_state==="OVERDUE"?"Overdue":"WorkflowTask";
 const status=String(j.status||"");
 if(status==="Failed") return "Failed";
 if(isOverdueJob(j)) return "Overdue";
 if(status==="Completed" || String(j.workflow_status||"")==="COMPLETED") return "Completed";
 if(status==="Partially completed" || String(j.workflow_status||"")==="IN_PROGRESS") return "PartiallyCompleted";
 return "WorkerColor";
}
function calendarStatusIcon(j){
 if(j?.calendar_entry_type==="KLAVIERHAUS_EVENT") return String(j.status||"")==="CANCELLED" ? "!" : "◆";
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
function calendarTypeIconMarkup(j){
 const isWorkflow=["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(j?.calendar_entry_type);
 const label=isWorkflow?bi("Workshop workflow","M\u0171hely workflow"):bi("Scheduled customer job","\u00dctemezett \u00fcgyf\u00e9lmunka");
 return `<span class="calendar-type-badge ${isWorkflow?'is-workflow':'is-job'}" title="${htmlText(label)}" aria-label="${htmlText(label)}"><span aria-hidden="true">${isWorkflow?"🔨":"⚙️"}</span></span>`;
}
function calendarEventCardMarkup(j){
 const time=`${String(j?.start_time||"").slice(11,16)}–${String(j?.end_time||"").slice(11,16)}`;
 if(["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(j?.calendar_entry_type)){
  return `${calendarTypeIconMarkup(j)}<span class="kh-event-ribbon">${bi("WORKSHOP TASK","WORKFLOW MUNKA")}</span><strong class="event-card-time">${htmlText(String(j?.start_time||"").slice(11,16))}</strong><b class="event-card-title">${htmlText(j.title||"")}</b><small class="event-card-primary">${htmlText(j.piano_name||j.client_name||"")}</small><small class="event-card-secondary">${htmlText(j.client_name||"")}${j.workflow_key?` · ${htmlText(j.workflow_key)}`:""}</small><span class="event-status">${calendarStatusIcon(j)}</span>`;
 }
 if(j?.calendar_entry_type==="KLAVIERHAUS_EVENT"){
  const title=currentLang==="hu"?(j.title_hu||j.title_en):(j.title_en||j.title_hu);
  const label=bi("KLAVIERHAUS EVENT","KLAVIERHAUS ESEMÉNY");
  const status=String(j.status||"")==="CANCELLED"?` · ${bi("CANCELLED","TÖRÖLVE")}`:"";
  return `<span class="kh-event-ribbon">${label}${status}</span><strong class="event-card-time">${htmlText(time)}</strong><b class="event-card-title">${htmlText(title||"")}</b><small class="event-card-primary">${htmlText(j.performer_name||bi("Artist to be announced","A művész hamarosan"))}</small><small class="event-card-secondary">${htmlText(j.venue_name||"Klavierhaus")}</small><span class="event-status">${calendarStatusIcon(j)}</span>`;
 }
 const client=String(j?.client_name||"—"),amount=calendarCardAmount(j);
 const responsible=String(j?.assigned_to||"—"),address=String(j?.service_address||"—"),notes=String(j?.notes||"").trim();
 const linkedWorkflowId=String(j?.linked_workshop_workflow_id||j?.workshop_workflow_id||j?.workflow_id||"");const workflowLink=linkedWorkflowId?`<span class="calendar-workshop-link" title="${bi("Open linked Workshop Workflow","Kapcsolt Workshop Workflow megnyitása")}" onclick="openLinkedWorkshopWorkflow('${htmlText(linkedWorkflowId)}',event)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 17l5-5 3 3 4-7M16 8h2v2"/></svg></span>`:"";
 return `${calendarTypeIconMarkup(j)}${workflowLink}<strong class="event-card-time">${htmlText(time)}</strong><b class="event-card-title">${htmlText(j?.title||"")}</b><small class="event-card-primary">${htmlText(client)} · ${htmlText(amount)}</small><small class="event-card-secondary">${htmlText(responsible)} · ${htmlText(address)}</small>${notes?`<small class="event-card-notes" title="${htmlText(notes)}">${htmlText(notes)}</small>`:""}<span class="event-status">${calendarStatusIcon(j)}</span>`;
}

async function loadCalendarEntries(fromDate,toDateExclusive){
 const from=`${fromDate}T00:00`,to=`${toDateExclusive}T00:00`;
 const [jobs,events,workflowDeadlines]=await Promise.all([
  api(jobsRangeUrl(fromDate,toDateExclusive)),
  api(`/api/calendar-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  api(`/api/workflows/calendar-deadlines?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDateExclusive)}`).catch(()=>[])
 ]);
 return [...jobs,...events,...workflowDeadlines];
}

async function openCalendarEntry(row){
 if(["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(row?.calendar_entry_type)){
  await openSchedulerWorkflowDrawer(row);return;
 }
 if(row?.calendar_entry_type!=="KLAVIERHAUS_EVENT")return openJobDetails(row);
 const event=await api(`/api/calendar-events/${encodeURIComponent(row.event_id)}`);
 const title=currentLang==="hu"?(event.title_hu||event.title_en):(event.title_en||event.title_hu);
 const description=currentLang==="hu"?(event.description_hu||event.description_en):(event.description_en||event.description_hu);
 const publicUrl=currentLang==="hu"?event.public_url_hu:event.public_url_en;
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=bi("Klavierhaus event","Klavierhaus esemény");
 $("#form").innerHTML=`<article class="internal-event-detail"><span class="internal-event-badge">◆ ${bi("KLAVIERHAUS EVENT","KLAVIERHAUS ESEMÉNY")}</span><h2>${htmlText(title)}</h2><dl><div><dt>${bi("When","Időpont")}</dt><dd>${htmlText(String(event.start_local||"").replace("T"," "))} – ${htmlText(String(event.end_local||"").replace("T"," "))}</dd></div><div><dt>${bi("Artist","Művész")}</dt><dd>${htmlText(event.performer_name||bi("Artist to be announced","A művész hamarosan"))}</dd></div><div><dt>${bi("Venue","Helyszín")}</dt><dd>${htmlText(event.venue_name||"Klavierhaus")}<br>${htmlText(event.venue_address||"")}</dd></div><div><dt>${bi("Status","Állapot")}</dt><dd>${htmlText(eventStatusLabel(event.status))}</dd></div><div><dt>${bi("Availability","Elérhetőség")}</dt><dd>${Number(event.capacity_remaining||0)} / ${Number(event.capacity_total||0)}</dd></div></dl>${description?`<p>${htmlText(description)}</p>`:""}<div class="actions">${publicUrl?`<a class="button ghost-btn" href="${htmlText(publicUrl)}" target="_blank" rel="noopener noreferrer">${bi("Public event page","Nyilvános eseményoldal")} ↗</a>`:""}${event.can_manage?`<button type="button" onclick="manageCalendarEvent('${htmlText(event.id)}')">${bi("Manage event","Esemény kezelése")}</button>`:""}<button type="button" class="ghost-btn" onclick="closeModal()">${bi("Close","Bezárás")}</button></div><p class="muted">${bi("Internal calendar only — this event is not synchronized to Google Calendar.","Csak a belső naptárban jelenik meg — az esemény nem szinkronizálódik a Google Naptárral.")}</p></article>`;
 applyLanguageToDOM(document.getElementById("modal"));
}

async function manageCalendarEvent(id){
 closeModal();
 await render("events");
 await openEventDetails(id);
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
 if(!adminViewEnabled(v))return showError(bi("This workspace is disabled by the superadmin.","Ezt a munkaterületet a szuperadmin kikapcsolta."));
 if(v!="digital_attendance")stopDigitalAttendanceLiveSync?.();
 const enteringScheduler=v==="scheduler"&&currentView!=="scheduler";
 const changedView=currentView && currentView!==v;
 if(opts.homeNavigation===true)navigationHomeNeutral=true;else if(opts.navigationActivate===true||changedView)navigationHomeNeutral=false;
 if(enteringScheduler){currentSchedulerWorker="ALL";currentSchedulerEntryFilter="ALL";}
 if(changedView && !opts.noHistory){
  viewHistory.push(currentView);
  history.pushState({khView:v},"",`#${encodeURIComponent(externalRouteForView(v))}`);
 }
 if(opts.replaceHistory || (!location.hash && !changedView)) history.replaceState({khView:v},"",`#${encodeURIComponent(externalRouteForView(v))}`);
 currentView=v;
 document.body.dataset.currentView=v;
 const target=forceShowView(v);
 target.classList.add("i18n-rendering");
 const pageTitle=document.getElementById("pageTitle");
 if(pageTitle) pageTitle.textContent=navLabel(v);
 updateMobileGlobalNotificationBell();
 try{
  if(v==="today") await renderToday();
  else if(v==="workshop_workflow") await renderWorkshopWorkflow();
  else if(v==="scheduler") await renderScheduler();
  else if(v==="planned_jobs") await renderPlannedJobs();
  else if(v==="closed_jobs") await renderClosedJobs();
  else if(v==="income_statement") await renderIncomeStatement();
  else if(v==="finance") await renderFinance();
  else if(v==="invoice_documents") await renderInvoiceDocuments();
  else if(v==="knowledge_base") await renderCompanyDocumentsArchive();
  else if(v==="partners") await renderPartners();
  else if(v==="inventory") await renderInventory();
  else if(v==="events") await renderEvents();
  else if(adminNavGroups.some(group=>group.id===v)) await renderAdminGroupLanding(v);
  else if(v==="pages_content") await renderWebsiteDesign("pages_content");
  else if(v==="website_services") await renderWebsiteServices();
  else if(v==="showroom_pianos") await renderShowroomPianos();
  else if(v==="website_reviews") await renderWebsiteReviews();
  else if(v==="website_artists") await renderWebsiteArtists();
  else if(v==="media_library") await renderWebsiteMedia();
  else if(v==="website_contacts"||v==="leads") await renderWebsiteLeads(v);
  else if(v==="customer_inbox") await renderCustomerInbox();
  else if(v==="company_data") await renderCompanyData();
  else if(v==="system_integrations") await renderSystemIntegrations();
  else if(v==="publish_preview") await renderPublishPreview();
  else if(v==="marketing_overview") await renderMarketingOverview();
  else if(v==="campaigns_utm") await renderMarketingCampaigns();
  else if(v==="tracking_cookies") await renderMarketingIntegrations();
  else if(v==="seo_keywords") await renderMarketingSeo();
  else if(v==="heatmap") await renderMarketingHeatmap();
  else if(v==="digital_attendance") await renderDigitalAttendance();
  else if(["event_tickets","event_invitations"].includes(v)) await renderEventWorkspace(v);
  else if(v==="event_guest_list") await renderGuestData();
  else if(v==="backups") await renderBackupsView();
  else if(v==="users") await renderUsers();
  else if(v==="audit_log") await renderAuditLog();
  else if(v==="settings") await renderSettings();
  else if(v==="pianos") await renderPianos();
  else if(v==="notifications") await renderNotifications();
  else await renderTable(v);
  ensureViewBackHeader(target,v);
  applyLanguageToDOM(target);
  enhanceCustomSelects(target);
  enhanceAdminDatePickers(target);
 }catch(error){
  console.error(`View render failed: ${v}`,error);
  if(isAuthenticationError(error)||!token){clearAuthenticationState();return;}
  target.innerHTML=`<div class="panel app-recovery-panel"><h3>${bi("This view could not be loaded.","A nézet betöltése nem sikerült.")}</h3><p class="danger-text">${htmlText(error?.message||String(error))}</p><div class="actions"><button type="button" onclick="render('${htmlText(v)}',{noHistory:true})">${bi("Retry","Újrapróbálás")}</button><button type="button" class="ghost-btn" onclick="render('workshop_workflow',{noHistory:true})">${bi("Open Workshop","Műhely megnyitása")}</button></div></div>`;
 }finally{
  target.classList.remove("i18n-rendering");
  syncNavigationActiveState();
 }
}


const rootWorkspaceViews=new Set(["today","workshop_workflow","scheduler"]);
function viewFromLocation(){const raw=decodeURIComponent(String(location.hash||"").replace(/^#/,""));const normalized=raw&&/^[a-z0-9_]+$/i.test(raw)?raw:null;return normalized?internalViewFromRoute(normalized):null;}
function ensureViewBackHeader(target,view){
 if(rootWorkspaceViews.has(view)||target.querySelector(".page-back-header,.mobile-page-title"))return;
 const canGoBack=viewHistory.length>0;
 const header=document.createElement("div");
 header.className="page-back-header";
 header.innerHTML=`<button type="button" class="mobile-back-btn ${canGoBack?"":"is-hidden"}" onclick="goBackView()" aria-label="${bi('Back','Vissza')}" ${canGoBack?"":"tabindex=\"-1\""}>‹</button><h2>${htmlText(navLabel(view))}</h2>`;
 target.prepend(header);
}
function initViewHistory(){
 if(window.__khViewHistoryBound)return;
 window.__khViewHistoryBound=true;
 window.addEventListener("popstate",event=>{
  const previous=event.state?.khView||viewFromLocation();
  if(!previous)return;
  if(viewHistory.length)viewHistory.pop();
  render(previous,{noHistory:true});
 });
}
function goBackView(){
 const previous=viewHistory.pop();
 if(previous){history.replaceState({khView:previous},"",`#${encodeURIComponent(previous)}`);render(previous,{noHistory:true});return;}
 if(!rootWorkspaceViews.has(currentView))render("workshop_workflow",{noHistory:true,replaceHistory:true});
}
function mobileBackHeader(title){const canGoBack=viewHistory.length>0;return `<div class="page-back-header"><button type="button" class="mobile-back-btn ${canGoBack?"":"is-hidden"}" onclick="goBackView()" aria-label="${bi('Back','Vissza')}" ${canGoBack?"":"tabindex=\"-1\""}>‹</button><h2>${title}</h2></div>`;}
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
  document.querySelectorAll(".mobile-nav-btn[data-mobile-view]").forEach(btn=>btn.classList.toggle("active",!navigationHomeNeutral&&btn.dataset.mobileView===currentView));
  const more=document.getElementById("mobileMoreBtn");
  if(more) more.classList.toggle("active",!navigationHomeNeutral&&!["today","contacts","pianos"].includes(currentView));
}
function closeMobileMore(){ const sheet=document.getElementById("mobileMoreSheet"); if(sheet){sheet.classList.add("hidden");sheet.setAttribute("aria-hidden","true");document.body.classList.remove("mobile-sheet-open");} }
function openMobileMore(){
  const sheet=document.getElementById("mobileMoreSheet"), items=document.getElementById("mobileMoreItems"); if(!sheet||!items)return;
  const all=visibleNavigationItems().filter(n=>!['contacts','pianos'].includes(n[0]));
  items.innerHTML=all.map(n=>`<button type="button" class="mobile-more-item ${!navigationHomeNeutral&&currentView===n[0]?'active':''}" data-more-view="${n[0]}"><span>${mobileViewIcon(n[0])}</span><b>${navLabel(n[0])}</b></button>`).join("")+`<button type="button" class="mobile-more-item" id="mobileProfileBtn"><span>👤</span><b>${tr('myProfile')}</b></button><button type="button" class="mobile-more-item" id="mobileLogoutBtn"><span>↪</span><b>${tr('logout')}</b></button>`;
  sheet.classList.remove("hidden");sheet.setAttribute("aria-hidden","false");document.body.classList.add("mobile-sheet-open");
  items.querySelectorAll("[data-more-view]").forEach(btn=>btn.onclick=()=>{closeMobileMore();render(btn.dataset.moreView,{navigationActivate:true});});
  const profile=document.getElementById("mobileProfileBtn"); if(profile) profile.onclick=()=>{closeMobileMore();openMyProfile();};
  const logout=document.getElementById("mobileLogoutBtn"); if(logout) logout.onclick=()=>logoutNow();
}
function mobileViewIcon(view){ const groupIcon=({website_events:"◈",marketing:"✦",technical:"⚙"})[view];return groupIcon||navigationIcon(view); }

let workshopWorkflowDate=nyDateKey();
let workshopWorkflowSelectedId="";
let workshopWorkflowSelectedStageId="";
let workshopWorkflowPrevious=false;
let workshopWorkflowRows=[];
let workshopWorkflowDefinitions=[];
let workshopWorkflowWorkers=[];
let workshopWorkflowPlannedJobs=[];
let workshopWorkflowPartners=[];
let workflowPianoBrands=[];
let workshopWorkflowAssigneeFilter="ALL";
let workshopWorkflowStatusFilter="ALL";
let workshopWorkflowOverdueOnly=false;
const workflowInspectionSubmissions=new Set();

function sanitizeSafeText(value,fallback=""){if(value===null||value===undefined)return fallback;const text=String(value).trim();return !text||/^(undefined|null)$/i.test(text)||text==="—"?fallback:text;}
function workflowSafeText(value,fallback=""){return sanitizeSafeText(value,fallback);}
function workflowStageLabel(stage){return workflowSafeText(currentLang==="hu"?(stage?.name_snapshot_hu||stage?.name_snapshot_en):(stage?.name_snapshot_en||stage?.name_snapshot_hu),bi("Work phase","Munkafázis"));}
function workflowPianoLabel(piano){const brand=workflowSafeText(piano?.brand),model=workflowSafeText(piano?.model),primary=[brand,model].filter(Boolean).join(" ").trim();if(primary)return primary;const serial=workflowSafeText(piano?.serial_no||piano?.serial_number);return serial||bi("Unknown piano","Ismeretlen hangszer");}
function workflowEffectiveStatus(stage){return stage?.effective_status||((stage?.is_overdue&&!["COMPLETED","NOT_REQUIRED","ABORTED"].includes(stage?.status))?"OVERDUE":(stage?.status==="WAITING"&&stage?.assigned_user_id?"ASSIGNED":stage?.status));}
function workflowStatusLabel(status){return ({WAITING:bi("Waiting for assignment","Kiosztásra vár"),ASSIGNED:bi("Assigned","Kiosztva"),IN_PROGRESS:bi("In progress","Folyamatban"),COMPLETED:bi("Completed","Kész"),OVERDUE:bi("Overdue","Lejárt"),BLOCKED:bi("Blocked","Blokkolva"),NOT_REQUIRED:bi("Not relevant","Nem releváns"),ABORTED:bi("Interrupted","Megszakítva")})[status]||status;}
function workflowStatusClass(status){return String(status||"").toLowerCase().replaceAll("_","-");}
function workflowDateText(value){return String(value||"").replace("T"," ");}
function workflowDateOnlyText(value){return workflowDateText(value).split(" ")[0]||"—";}
function workflowCardDateText(value){
 if(!value)return "—";
 try{return new Intl.DateTimeFormat(currentLang==="hu"?"hu-HU":"en-US",{timeZone:"UTC",year:"numeric",month:"short",day:"numeric"}).format(new Date(`${String(value).slice(0,16)}:00Z`));}
 catch(_error){return workflowDateOnlyText(value);}
}
function workflowCardDateTimeText(value){
 if(!value)return "—";
 try{return new Intl.DateTimeFormat(currentLang==="hu"?"hu-HU":"en-US",{timeZone:"UTC",year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(`${String(value).slice(0,16)}:00Z`));}
 catch(_error){return workflowDateText(value);}
}
function workflowBoardDateLabel(value){
 const parts=String(value||"").split("-").map(Number);
 if(parts.length!==3||parts.some(Number.isNaN))return String(value||"");
 try{return new Intl.DateTimeFormat(currentLang==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",year:"numeric",month:"long",day:"numeric"}).format(new Date(Date.UTC(parts[0],parts[1]-1,parts[2],12)));}
 catch(_error){return String(value||"");}
}
function workflowNYZoneLabel(value=""){
 try{const raw=String(value||"").slice(0,16),date=raw?new Date(`${raw}:00Z`):new Date();return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",timeZoneName:"short"}).formatToParts(date).find(part=>part.type==="timeZoneName")?.value||"New York";}
 catch(_error){return "New York";}
}
function workflowCardDueText(value){if(!value)return "—";return `${workflowCardDateText(value)} – ${String(value).slice(11,16)} ${workflowNYZoneLabel(value)}`;}
function workflowToolbarIcon(kind){
 const paths={
  "chevron-left":'<path d="m14.5 5-7 7 7 7"/>',
  "chevron-right":'<path d="m9.5 5 7 7-7 7"/>',
  "today":'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  "date":'<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M8 3v5M16 3v5M4 10h16M8 13h3M8 17h3M14 13h2M14 17h2"/>',
  "calendar-grid":'<rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M7 2.8v4M17 2.8v4M3.5 9h17M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2M14.5 16.5h2"/>',
  "history":'<path d="M4.5 8.5A8 8 0 1 1 4 13"/><path d="M4.5 4.5v4h4M12 8v4l3 2"/>',
  "settings":'<path d="m12 3 1.1 1.9 2.2.5 1.8-1.1 1.8 1.8-1.1 1.8.5 2.2 1.9 1.1v2.6l-1.9 1.1-.5 2.2 1.1 1.8-1.8 1.8-1.8-1.1-2.2.5L12 21h-2.6l-1.1-1.9-2.2-.5-1.8 1.1-1.8-1.8 1.1-1.8-.5-2.2L1.2 13v-2.6l1.9-1.1.5-2.2-1.1-1.8 1.8-1.8 1.8 1.1 2.2-.5L9.4 3H12Z"/><circle cx="10.7" cy="11.7" r="2.6"/>',
  "plus":'<path d="M12 5v14M5 12h14"/>'
 };
 return `<svg class="workflow-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[kind]||paths.date}</svg>`;
}
let activeAdminDatePicker=null;
let adminDatePickerObserver=null;
function adminDatePickerIcon(){return '<svg class="admin-date-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M7.5 14h2M12 14h2M16.5 14h.01M7.5 17.5h2M12 17.5h2M16.5 17.5h.01"/></svg>';}
function adminDatePickerInputType(input){return input?.type==="datetime-local"?"datetime-local":"date";}
function adminDatePickerDateKey(value){const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})/);return match?match[0]:"";}
function adminDatePickerMonthKey(value){const dateKey=adminDatePickerDateKey(value);return dateKey?dateKey.slice(0,7):nyDateKey().slice(0,7);}
function adminDatePickerParseKey(value){const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);if(!year||month<1||month>12||day<1||day>31)return null;return {year,month,day};}
function adminDatePickerMonthParts(monthKey){const match=String(monthKey||"").match(/^(\d{4})-(\d{2})$/);return match?{year:Number(match[1]),month:Number(match[2])}:adminDatePickerMonthParts(nyDateKey().slice(0,7));}
function adminDatePickerMonthOffset(monthKey,offset){const parts=adminDatePickerMonthParts(monthKey);const date=new Date(Date.UTC(parts.year,parts.month-1+Number(offset||0),1));return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;}
function adminDatePickerMonthLabel(monthKey){const parts=adminDatePickerMonthParts(monthKey);try{return new Intl.DateTimeFormat(currentLang==="hu"?"hu-HU":"en-US",{timeZone:"UTC",year:"numeric",month:"long"}).format(new Date(Date.UTC(parts.year,parts.month-1,1)));}catch(_error){return monthKey;}}
function adminDatePickerDisplayValue(input){
 const value=String(input?.value||"");
 const key=adminDatePickerDateKey(value),parts=adminDatePickerParseKey(key);
 if(!parts)return bi("Choose a date","Válassz dátumot");
 try{
  const options={timeZone:"UTC",year:"numeric",month:"long",day:"numeric"};
  if(adminDatePickerInputType(input)==="datetime-local"){options.hour="2-digit";options.minute="2-digit";options.hour12=false;}
  const time=adminDatePickerInputType(input)==="datetime-local"?(value.slice(11,16)||"00:00"):"12:00";
  return new Intl.DateTimeFormat(currentLang==="hu"?"hu-HU":"en-US",options).format(new Date(`${key}T${time}:00Z`));
 }catch(_error){return value.replace("T"," ");}
}
function adminDatePickerWeekdays(){return Array.from({length:7},(_,index)=>{const date=new Date(Date.UTC(2024,0,1+index));try{return new Intl.DateTimeFormat(currentLang==="hu"?"hu-HU":"en-US",{timeZone:"UTC",weekday:"short"}).format(date).replace(/\.$/,"");}catch(_error){return ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][index];}});}
function adminDatePickerSetValue(input,key){
 const type=adminDatePickerInputType(input),time=String(input.value||"").slice(11,16)||"09:00";
 const value=type==="datetime-local"?`${key}T${time}`:key;
 input.value=value;
 input.dispatchEvent(new Event("input",{bubbles:true}));
 input.dispatchEvent(new Event("change",{bubbles:true}));
}
function adminDatePickerSync(input){
 const control=input?.closest?.(".admin-date-control"),trigger=control?.querySelector(".admin-date-control-trigger"),value=trigger?.querySelector(".admin-date-control-value");
 if(!control||!trigger||!value)return;
 value.textContent=adminDatePickerDisplayValue(input);
 trigger.disabled=Boolean(input.disabled);
 trigger.setAttribute("aria-expanded",String(activeAdminDatePicker?.input===input));
 control.classList.toggle("is-disabled",Boolean(input.disabled));
 control.classList.toggle("has-value",Boolean(input.value));
}
function adminDatePickerPosition(state){
 const anchor=state?.anchor,popover=state?.popover;if(!anchor||!popover)return;
 const rect=anchor.getBoundingClientRect(),width=Math.min(360,window.innerWidth-24),height=popover.offsetHeight||420;
 let left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top=rect.bottom+8;
 if(top+height>window.innerHeight-12&&rect.top-height-8>=12)top=rect.top-height-8;
 popover.style.left=`${Math.round(left)}px`;popover.style.top=`${Math.round(top)}px`;popover.style.width=`${Math.round(width)}px`;
}
function adminDatePickerClose(){
 const state=activeAdminDatePicker;if(!state)return;
 state.anchor?.setAttribute("aria-expanded","false");
 state.popover?.remove();
 activeAdminDatePicker=null;
 adminDatePickerSync(state.input);
}
function adminDatePickerMarkup(state){
 const input=state.input,monthKey=state.monthKey,parts=adminDatePickerMonthParts(monthKey),selected=adminDatePickerDateKey(input.value),selectedParts=adminDatePickerParseKey(selected),today=nyDateKey();
 const firstWeekday=(new Date(Date.UTC(parts.year,parts.month-1,1)).getUTCDay()+6)%7,daysInMonth=new Date(Date.UTC(parts.year,parts.month,0)).getUTCDate();
 const blanks=Array.from({length:firstWeekday},()=>'<span class="admin-date-picker-empty" aria-hidden="true"></span>').join("");
 const days=Array.from({length:daysInMonth},(_,index)=>{const day=index+1,key=`${parts.year}-${String(parts.month).padStart(2,"0")}-${String(day).padStart(2,"0")}`,classes=[key===selected?"is-selected":"",key===today?"is-today":""].filter(Boolean).join(" ");return `<button type="button" class="admin-date-picker-day ${classes}" data-date-picker-day="${key}" aria-label="${htmlText(key)}" ${key===selected?'aria-current="date"':''}>${day}</button>`;}).join("");
 const weekdays=adminDatePickerWeekdays().map(day=>`<span>${htmlText(day)}</span>`).join("");
 const dateTime=adminDatePickerInputType(input)==="datetime-local",time=dateTime?(String(input.value||"").slice(11,16)||"09:00"):"";
 return `<section class="admin-date-picker-popover-card" role="dialog" aria-modal="false" aria-label="${bi("Choose date","Dátum kiválasztása")}"><header class="admin-date-picker-header"><button type="button" class="admin-date-picker-nav" data-date-picker-month="-1" aria-label="${bi("Previous month","Előző hónap")}">‹</button><div><strong>${htmlText(adminDatePickerMonthLabel(monthKey))}</strong><small>${htmlText(parts.year)}</small></div><button type="button" class="admin-date-picker-nav" data-date-picker-month="1" aria-label="${bi("Next month","Következő hónap")}">›</button></header><div class="admin-date-picker-actions"><button type="button" class="admin-date-picker-today" data-date-picker-today>${bi("Today","Ma")}</button></div><div class="admin-date-picker-weekdays">${weekdays}</div><div class="admin-date-picker-grid">${blanks}${days}</div>${dateTime?`<div class="admin-date-picker-time"><label>${bi("Time","Időpont")}<input type="time" data-date-picker-time value="${htmlText(time)}"></label><button type="button" class="admin-date-picker-done" data-date-picker-done>${bi("Done","Kész")}</button></div>`:""}</section>`;
}
function adminDatePickerRender(state){
 if(!state?.popover)return;
 state.popover.innerHTML=adminDatePickerMarkup(state);
 state.popover.querySelectorAll("[data-date-picker-month]").forEach(button=>button.addEventListener("click",()=>{state.monthKey=adminDatePickerMonthOffset(state.monthKey,Number(button.dataset.datePickerMonth));adminDatePickerRender(state);}));
 state.popover.querySelector("[data-date-picker-today]")?.addEventListener("click",()=>{adminDatePickerClose();adminDatePickerSetValue(state.input,nyDateKey());});
 state.popover.querySelectorAll("[data-date-picker-day]").forEach(button=>button.addEventListener("click",()=>{const key=button.dataset.datePickerDay;if(adminDatePickerInputType(state.input)==="date"){adminDatePickerClose();adminDatePickerSetValue(state.input,key);}else{adminDatePickerSetValue(state.input,key);if(activeAdminDatePicker!==state)return;state.monthKey=key.slice(0,7);adminDatePickerRender(state);}}));
 const time=state.popover.querySelector("[data-date-picker-time]");if(time)time.addEventListener("change",()=>{const key=adminDatePickerDateKey(state.input.value)||nyDateKey();state.input.value=`${key}T${time.value||"09:00"}`;state.input.dispatchEvent(new Event("input",{bubbles:true}));state.input.dispatchEvent(new Event("change",{bubbles:true}));adminDatePickerSync(state.input);});
 state.popover.querySelector("[data-date-picker-done]")?.addEventListener("click",adminDatePickerClose);
 adminDatePickerPosition(state);
}
function adminDatePickerOpen(input,anchor){
 if(!input||input.disabled)return;
 if(activeAdminDatePicker?.input===input){adminDatePickerClose();return;}
 adminDatePickerClose();
 const popover=document.createElement("div");popover.className="admin-date-picker-popover";popover.id=`adminDatePicker_${Date.now()}`;document.body.appendChild(popover);
 const state={input,anchor:anchor||input.closest(".admin-date-control"),popover,monthKey:adminDatePickerMonthKey(input.value)};activeAdminDatePicker=state;
 state.anchor?.setAttribute("aria-controls",popover.id);state.anchor?.setAttribute("aria-expanded","true");adminDatePickerRender(state);adminDatePickerSync(input);
}
function workflowOpenDatePicker(inputOrId,anchor){const input=typeof inputOrId==="string"?document.getElementById(inputOrId):inputOrId;adminDatePickerOpen(input,anchor||input?.closest?.(".workflow-date-picker"));}
function workflowBindDatePicker(box){
 const picker=box?.querySelector(".workflow-date-picker"),input=picker?.querySelector(".workflow-date-input"),text=picker?.querySelector(".workflow-date-text"),button=picker?.querySelector(".workflow-date-picker-button");
 if(!picker||!input||picker.dataset.adminDatePickerBound==="true")return;
 picker.dataset.adminDatePickerBound="true";input.dataset.adminDatePickerEnhanced="true";
 const syncText=()=>{if(text)text.value=formatAmericanDate(input.value)||text.value;};
 const commitText=()=>{if(!text)return;const key=parseAmericanDate(text.value);text.setCustomValidity(key?'':bi('Use MM/DD/YYYY format.','Használd az MM/DD/YYYY formátumot.'));if(!key)return;input.value=key;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
 const openPicker=event=>{event?.preventDefault?.();event?.stopPropagation?.();workflowOpenDatePicker(input,button||picker);};
 text?.addEventListener('change',commitText);text?.addEventListener('blur',commitText);text?.addEventListener('click',openPicker);
 button?.addEventListener('click',openPicker);
 input.addEventListener('input',syncText);input.addEventListener('change',syncText);
 syncText();
}
function adminDatePickerEnhanceInput(input){
 if(!input||input.dataset.adminDatePickerEnhanced==="true"||input.closest(".workflow-date-picker"))return;
 const parent=input.parentElement;if(!parent)return;
 const control=document.createElement("span");control.className="admin-date-control";parent.insertBefore(control,input);control.appendChild(input);input.dataset.adminDatePickerEnhanced="true";input.classList.add("admin-date-input-native");input.tabIndex=-1;
 const trigger=document.createElement("button");trigger.type="button";trigger.className="admin-date-control-trigger";trigger.setAttribute("aria-haspopup","dialog");trigger.setAttribute("aria-label",(input.getAttribute("aria-label")||input.closest("label")?.textContent||bi("Choose a date","Dátum kiválasztása")).replace(/\s+/g," ").trim());trigger.innerHTML=`<span class="admin-date-control-value"></span><span class="admin-date-control-icon" aria-hidden="true">${adminDatePickerIcon()}</span>`;control.appendChild(trigger);
 trigger.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();adminDatePickerOpen(input,trigger);});trigger.addEventListener("keydown",event=>{if(event.key!=="Enter"&&event.key!==" ")return;event.preventDefault();adminDatePickerOpen(input,trigger);});input.addEventListener("input",()=>adminDatePickerSync(input));input.addEventListener("change",()=>adminDatePickerSync(input));input.addEventListener("invalid",()=>{trigger.classList.add("is-invalid");trigger.focus({preventScroll:true});setTimeout(()=>trigger.classList.remove("is-invalid"),1500);});adminDatePickerSync(input);
}
function enhanceAdminDatePickers(root=document){
 const inputs=[];if(root instanceof HTMLInputElement&&root.matches('input[type="date"],input[type="datetime-local"]'))inputs.push(root);else root.querySelectorAll?.('input[type="date"],input[type="datetime-local"]').forEach(input=>inputs.push(input));inputs.forEach(adminDatePickerEnhanceInput);
}
function initAdminDatePickerSystem(){
 if(adminDatePickerObserver)return;
 enhanceAdminDatePickers(document);
 adminDatePickerObserver=new MutationObserver(mutations=>mutations.forEach(mutation=>mutation.addedNodes.forEach(node=>{if(node.nodeType===1)enhanceAdminDatePickers(node);})));
 adminDatePickerObserver.observe(document.body,{childList:true,subtree:true});
 document.addEventListener("pointerdown",event=>{if(!activeAdminDatePicker)return;if(activeAdminDatePicker.popover?.contains(event.target)||activeAdminDatePicker.anchor?.contains(event.target))return;adminDatePickerClose();},true);
 document.addEventListener("keydown",event=>{if(event.key==="Escape"&&activeAdminDatePicker)adminDatePickerClose();},true);
 window.addEventListener("resize",()=>{if(activeAdminDatePicker)adminDatePickerPosition(activeAdminDatePicker);});
 document.addEventListener("scroll",event=>{if(activeAdminDatePicker&&!activeAdminDatePicker.popover?.contains(event.target))adminDatePickerClose();},true);
}
function decorateWorkflowToolbar(box){
 const actions=box?.querySelector(".workflow-day-actions");
 if(!actions)return;
 const addIcon=(button,kind,stripPattern=null)=>{if(!button)return;if(stripPattern){const node=[...button.childNodes].find(item=>item.nodeType===Node.TEXT_NODE&&String(item.textContent||"").trim());if(node)node.textContent=String(node.textContent||"").replace(stripPattern,"").replace(/^\s+/,"");}if(!button.querySelector(".workflow-control-icon"))button.insertAdjacentHTML("afterbegin",workflowToolbarIcon(kind));};
 addIcon(actions.querySelector("[data-workflow-archive-toggle]"),"history",/^▣\s*/);
 addIcon(actions.querySelector("[data-workflow-open-calendar]"),"calendar-grid",/^▣\s*/);
 addIcon(actions.querySelector(".workflow-stage-settings"),"settings",/^⚙\s*/);
 const datePicker=actions.querySelector(".workflow-date-picker");
 if(datePicker){const dateIcon=datePicker.querySelector(".workflow-date-picker-icon");if(dateIcon&&!dateIcon.querySelector(".workflow-control-icon"))dateIcon.innerHTML=workflowToolbarIcon("date");}
 const newButton=box.querySelector(".workflow-new-btn");if(newButton&&!newButton.querySelector(".workflow-control-icon"))newButton.insertAdjacentHTML("afterbegin",workflowToolbarIcon("plus"));
}

function workflowWorkerOptions(selected=""){return `<option value="">${bi("Unassigned","Nincs felelős")}</option>${workshopWorkflowWorkers.map(worker=>`<option value="${htmlText(worker.id)}" ${String(worker.id)===String(selected)?"selected":""}>${htmlText(worker.name)} · ${htmlText(worker.role||"")}</option>`).join("")}`;}
function workflowStageCard(stage){
 const effective=workflowEffectiveStatus(stage);
 if(effective==="NOT_REQUIRED")return `<button type="button" class="workflow-stage-empty workflow-stage-empty--inactive" aria-label="${bi("Activate phase","Fázis aktiválása")}" onclick="openWorkshopWorkflow('${htmlText(stage.workflow_id)}','${htmlText(stage.id)}')">—</button>`;
 const title=workflowSafeText(stage?.card_title||stage?.custom_title||stage?.title,workflowStageLabel(stage)),assignee=workflowSafeText(stage?.assigned_to,bi("Unassigned","Nincs felelős")),due=stage?.due_at?workflowCardDueText(stage.due_at):"—",shortDescription=workflowSafeText(stage?.details),notes=workflowSafeText(stage?.notes);
 const noteText=[shortDescription,notes].filter(Boolean).join(" · "),activeBell=!['COMPLETED','NOT_REQUIRED','ABORTED'].includes(String(stage.status||""));
 const bell=activeBell&&noteText?`<span class="workflow-note-bell" title="${htmlText(noteText)}" aria-label="${bi("Card notes","Kártyamegjegyzés")}: ${htmlText(noteText)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></span>`:"";
 const avatar=(assignee&&assignee!=="—")?`<span class="workflow-assignee-avatar" aria-hidden="true">${htmlText(String(assignee).trim().charAt(0).toUpperCase())}</span>`:"";
 const icon=effective==="COMPLETED"?'<span class="workflow-status-icon workflow-status-icon--complete" aria-hidden="true">✓</span>':effective==="OVERDUE"?'<span class="workflow-status-icon workflow-status-icon--overdue" aria-hidden="true">!</span>':'<span class="workflow-status-dot" aria-hidden="true"></span>';
 return `<button type="button" class="workflow-stage-card status-${workflowStatusClass(effective)}${stage.is_overdue?" is-overdue":""}" onclick="openWorkshopWorkflow('${htmlText(stage.workflow_id)}','${htmlText(stage.id)}')"><span class="workflow-stage-card-inner">${bell}<span class="workflow-stage-status">${icon}<em>${htmlText(workflowStatusLabel(effective))}</em></span><strong class="workflow-stage-due${effective==="OVERDUE"?" is-overdue":""}">${htmlText(due)}</strong><b class="workflow-stage-title">${htmlText(title)}</b><span class="workflow-stage-card-footer">${avatar}<span class="workflow-stage-assignee">${htmlText(assignee)}</span><span class="workflow-stage-document" aria-hidden="true">▤</span></span></span></button>`;
}
function workflowBoardRow(workflow){
 const piano=workflowPianoLabel(workflow)||workflowSafeText(workflow?.piano_display_name)||workflowSafeText(workflow?.piano_id,bi("Unknown piano","Ismeretlen hangszer"));
 const workflowTitle=workflowSafeText(workflow?.title),clientName=workflowSafeText(workflow?.client_name),serialValue=workflowSafeText(workflow?.serial_no),workflowKey=workflowSafeText(workflow?.workflow_key);
 const text=[workflowTitle,clientName,piano,serialValue,workflowKey].filter(Boolean).join(" ").toLowerCase();
 const serial=serialValue?`#${serialValue}`:"";
 const finalDue=workflow.final_due_at?workflowCardDateTimeText(workflow.final_due_at):"—";
 const superDelete=isSuperadmin()?`<button type="button" class="small danger-btn" onclick="event.stopPropagation();workflowSuperDelete('${htmlText(workflow.id)}')">${bi("Delete Workflow","Workflow Törlése")}</button>`:"";
 return `<article class="workflow-row" data-workflow-search="${htmlText(text)}"><div class="workflow-piano-cell"><div class="workflow-piano-visual" aria-hidden="true"><span>♬</span></div><div class="workflow-piano-copy"><div class="workflow-piano-facts"><strong class="workflow-piano-name">${htmlText(piano)}</strong><span class="workflow-client-name">${htmlText(sanitizeSafeText(workflow.client_name,"—"))}</span><span class="workflow-piano-reference-meta">${htmlText(pianoReferenceMeta(workflow)||serial||"—")}</span><b class="workflow-final-deadline">${htmlText(finalDue)}</b></div><div class="workflow-row-actions"><button type="button" class="workflow-row-open" onclick="openWorkshopWorkflow('${htmlText(workflow.id)}','__workflow__')">${bi("Workflow details","Workflow részletei")} →</button>${superDelete}</div></div></div><div class="workflow-stage-grid">${(workflow.stages||[]).map(workflowStageCard).join("")}</div></article>`;
}
function workflowStageEditor(stage){
 const canEditDue=isAdmin();
 const statusOptions=["WAITING","IN_PROGRESS","COMPLETED","BLOCKED","NOT_REQUIRED","ABORTED"].map(status=>`<option value="${status}" ${status===stage.status?"selected":""}>${htmlText(workflowStatusLabel(status))}</option>`).join("");
 return `<div class="workflow-stage-editor"><div class="workflow-stage-editor-head"><span class="workflow-stage-order">${Number(stage.stage_order)+1}</span><div><strong>${htmlText(workflowStageLabel(stage))}</strong><small>${stage.assigned_to?htmlText(stage.assigned_to):bi("Unassigned","Nincs felelős")}</small></div><span class="badge status-${workflowStatusClass(stage.status)}">${htmlText(workflowStatusLabel(stage.status))}</span></div><div class="workflow-stage-editor-grid"><label>${bi("Status","Státusz")}<select id="workflowStatus_${htmlText(stage.id)}">${statusOptions}</select></label><label>${bi("Responsible","Felelős")}<select id="workflowAssignee_${htmlText(stage.id)}">${workflowWorkerOptions(stage.assigned_user_id||"")}</select></label><label>${bi("Deadline","Határidő")}${compactDateTimeControlMarkup(`workflowDue_${stage.id}`,"",stage.due_at||"",{defaultTime:"10:00",allowEmpty:true,disabled:!canEditDue})}</label><label>${bi("Card title","Egyedi kártyacím")}<input id="workflowCardTitle_${htmlText(stage.id)}" value="${htmlText(stage.card_title||"")}" maxlength="240"></label><label class="field-full">${bi("Short description","Rövid leírás")}<textarea id="workflowDetails_${htmlText(stage.id)}" rows="2" readonly aria-readonly="true">${htmlText(stage.details||"")}</textarea></label><label class="field-full">${bi("Notes","Megjegyzések")}<textarea id="workflowNotes_${htmlText(stage.id)}" rows="2">${htmlText(stage.notes||"")}</textarea></label></div>${workflowPlannedJobsEnabled()&&stage.stage_order===0&&stage.preliminary_inspection?`<div class="workflow-prelim-grid"><span>${bi("Preliminary view","Előzetes megtekintés")}: ${htmlText(stage.preliminary_inspection)}</span><span>${bi("Preliminary assessment","Előzetes állapotfelmérés")}: ${htmlText(stage.preliminary_assessment)}</span><span>${bi("Preliminary quote","Előzetes árajánlat")}: ${htmlText(stage.preliminary_quote)}</span><span>${bi("Preliminary meeting","Előzetes megbeszélés")}: ${htmlText(stage.preliminary_meeting)}</span></div>`:""}<div class="workflow-stage-editor-actions"><button type="button" class="small" onclick="workflowSaveStage('${htmlText(stage.workflow_id)}','${htmlText(stage.id)}')">${bi("Save phase","Fázis mentése")}</button><button type="button" class="small ghost-btn" onclick="workflowTransferStage('${htmlText(stage.workflow_id)}','${htmlText(stage.id)}')">${bi("Transfer with reason","Átadás indoklással")}</button></div></div>`;
}
function workflowEventParsedValue(value){
 if(value===null||value===undefined||value==="")return null;
 try{return typeof value==="string"?JSON.parse(value):value;}catch(_error){return String(value);}
}
function workflowEventScalarText(value){
 if(value===null||value===undefined||value==="")return "—";
 if(typeof value==="boolean")return value?bi("Yes","Igen"):bi("No","Nem");
 return workflowDateText(String(value));
}
function workflowEventValueText(value){
 const parsed=workflowEventParsedValue(value);
 if(parsed===null)return "";
 if(typeof parsed!=="object"||Array.isArray(parsed))return workflowEventScalarText(parsed);
 const fields=[
  ["status",bi("status","státusz")],
  ["effective_status",bi("effective status","effektív státusz")],
  ["assigned_to",bi("responsible","felelős")],
  ["assigned_user_name",bi("responsible","felelős")],
  ["due_at",bi("deadline","határidő")],
  ["card_title",bi("card title","kártyacím")],
  ["details",bi("short description","rövid leírás")],
  ["notes",bi("notes","megjegyzések")],
  ["financial_status",bi("financial status","pénzügyi állapot")],
  ["started_at",bi("started","kezdés")],
  ["completed_at",bi("completed","lezárás")],
  ["block_reason",bi("block reason","blokkolás oka")]
 ];
 const summary=fields.filter(([key])=>parsed[key]!==undefined&&parsed[key]!==null&&parsed[key]!=="").map(([key,label])=>`${label}: ${workflowEventScalarText(parsed[key])}`);
 return summary.length?summary.join(" · "):JSON.stringify(parsed);
}
function workflowEventActionLabel(action){
 return ({
  WORKFLOW_STAGE_CREATED:bi("Phase created","Fázis létrehozva"),
  WORKFLOW_STAGE_UPDATED:bi("Phase updated","Fázis módosítva"),
  WORKFLOW_STAGE_TRANSFERRED:bi("Phase transferred","Fázis átadva"),
  WORKFLOW_STAGE_ASSIGNEE_INHERITED:bi("Responsible inherited automatically","Felelős automatikusan öröklődött"),
  WORKFLOW_STAGE_ACTIVATED:bi("Phase activated","Fázis aktiválva"),
  WORKFLOW_STAGE_ABORTED:bi("Phase interrupted","Fázis megszakítva"),
  WORKFLOW_STAGE_FINANCIAL_CLOSED:bi("Phase finances closed","Fázis pénzügyei lezárva"),
  WORKFLOW_FINANCIAL_LINE_ADDED:bi("Financial line added","Pénzügyi tétel hozzáadva"),
  WORKFLOW_FINANCIAL_LINE_UPDATED:bi("Financial line updated","Pénzügyi tétel módosítva"),
  WORKFLOW_FINANCIAL_LINE_DELETED:bi("Financial line deleted","Pénzügyi tétel törölve"),
  WORKFLOW_MATERIAL_ADDED:bi("Material added","Anyag hozzáadva"),
  WORKFLOW_MATERIAL_UPDATED:bi("Material updated","Anyag módosítva"),
  WORKFLOW_MATERIAL_DELETED:bi("Material deleted","Anyag törölve")
 })[action]||String(action||bi("Workflow update","Workflow-frissítés"));
}
function workflowEventChangeText(event){
 const oldValue=workflowEventParsedValue(event?.old_value),newValue=workflowEventParsedValue(event?.new_value);
 if(oldValue&&newValue&&typeof oldValue==="object"&&!Array.isArray(oldValue)&&typeof newValue==="object"&&!Array.isArray(newValue)){
  const fields=[
   ["status",bi("status","státusz")],
   ["assigned_to",bi("responsible","felelős")],
   ["assigned_user_name",bi("responsible","felelős")],
   ["due_at",bi("deadline","határidő")],
   ["card_title",bi("card title","kártyacím")],
   ["details",bi("short description","rövid leírás")],
   ["notes",bi("notes","megjegyzések")],
   ["financial_status",bi("financial status","pénzügyi állapot")],
   ["started_at",bi("started","kezdés")],
   ["completed_at",bi("completed","lezárás")],
   ["block_reason",bi("block reason","blokkolás oka")]
  ];
  const changes=[],seen=new Set();
  for(const [key,label] of fields){
   if(seen.has(key))continue;
   seen.add(key);
   if(String(oldValue[key]??"")!==String(newValue[key]??""))changes.push(`${label}: ${workflowEventScalarText(oldValue[key])} → ${workflowEventScalarText(newValue[key])}`);
  }
  if(changes.length)return changes.join(" · ");
 }
 const oldText=workflowEventValueText(event?.old_value),newText=workflowEventValueText(event?.new_value);
 return oldText||newText?`${oldText?` ${bi("from","erről")}: ${oldText}`:""}${newText?` ${bi("to","erre")}: ${newText}`:""}`:"";
}
function workflowEventLogMarkup(stage,limit=3){
 const allEvents=Array.isArray(stage?.event_log)?stage.event_log:[],events=limit===0?allEvents:allEvents.slice(0,limit);
 return events.length?`<div class="workflow-event-log">${events.map(event=>{const change=workflowEventChangeText(event);return `<div class="workflow-event-log-row"><span class="workflow-event-dot"></span><div><b>${htmlText(workflowEventActionLabel(event.action))}</b><small>${htmlText(workflowDateText(event.created_at||""))} · ${htmlText(event.user_name||"—")}</small><p>${htmlText(event.details||"")}${change?`<span class="workflow-event-log-change">${htmlText(change)}</span>`:""}</p></div></div>`;}).join("")}</div>`:`<p class="muted">${bi("No phase events yet.","Ehhez a fázishoz még nincs eseménynapló.")}</p>`;
}
function workflowCloseFullEventLog(){
 const overlay=document.querySelector(".workflow-event-log-modal");
 if(!overlay)return;
 if(overlay.workflowEscapeHandler)document.removeEventListener("keydown",overlay.workflowEscapeHandler,true);
 document.body.classList.remove("workflow-event-log-open");
 overlay.remove();
}
function workflowStageEventUser(stage,predicate){
 const event=(Array.isArray(stage?.event_log)?stage.event_log:[]).find(predicate);
 return event?.user_name||"—";
}
function workflowStageClosedBy(stage){
 return workflowStageEventUser(stage,event=>{
  const value=workflowEventParsedValue(event?.new_value);
  return event?.action==="WORKFLOW_STAGE_ABORTED"||Boolean(event?.action==="WORKFLOW_STAGE_UPDATED"&&value&&typeof value==="object"&&!Array.isArray(value)&&value.status==="COMPLETED");
 });
}
function workflowStageTransferText(stage){
 const event=(Array.isArray(stage?.event_log)?stage.event_log:[]).find(item=>["WORKFLOW_STAGE_TRANSFERRED","WORKFLOW_STAGE_ASSIGNEE_INHERITED"].includes(item?.action));
 if(!event)return "—";
 const actor=event.user_name||"—",details=event.details||workflowEventChangeText(event);
 return `${workflowDateText(event.created_at||"")} · ${actor}${details?` · ${details}`:""}`;
}
function workflowFullEventLogField(label,value,extraClass=""){
 const display=sanitizeSafeText(value,"—");
 return `<div class="workflow-full-log-field${extraClass?` ${extraClass}`:""}"><span>${htmlText(label)}</span><b>${htmlText(display)}</b></div>`;
}
function workflowFullEventLogPhaseMarkup(workflow,stage){
 const effective=workflowEffectiveStatus(stage),events=Array.isArray(stage?.event_log)?stage.event_log:[],status=workflowStatusLabel(effective);
 const title=stage.card_title||bi("No custom card title","Nincs egyedi kártyacím");
 const due=stage.due_at?workflowCardDateTimeText(stage.due_at):bi("Not planned","Nincs tervezett határidő");
 const started=stage.started_at?workflowDateText(stage.started_at):bi("Not started","Még nem kezdődött el");
 const completed=stage.completed_at?workflowDateText(stage.completed_at):bi("Not completed","Még nincs lezárva");
 const modified=stage.updated_at?workflowDateText(stage.updated_at):bi("Not available","Nem áll rendelkezésre");
 const noEvents=bi("No phase events yet.","Még nem történt esemény");
 return `<section class="workflow-full-log-phase status-${workflowStatusClass(effective)}${effective==="NOT_REQUIRED"?" is-not-required":""}"><header class="workflow-full-log-phase-head"><div class="workflow-full-log-phase-title"><span class="workflow-stage-order">${Number(stage.stage_order)+1}</span><div><p class="event-kicker">${bi("Workflow phase","Workflow-fázis")}</p><h3>${htmlText(workflowStageLabel(stage))}</h3><small>${htmlText(status)}</small></div></div><strong class="workflow-full-log-status">${htmlText(status)}</strong></header><div class="workflow-full-log-fields">${workflowFullEventLogField(bi("Card title","Egyedi kártyacím"),title)}${workflowFullEventLogField(bi("Responsible","Felelős"),stage.assigned_to||bi("Unassigned","Nincs kiosztva"))}${workflowFullEventLogField(bi("Deadline","Határidő"),due,stage.is_overdue?"is-overdue":"")}${workflowFullEventLogField(bi("Started","Kezdés"),started)}${workflowFullEventLogField(bi("Completed","Lezárás"),completed)}${workflowFullEventLogField(bi("Last modified","Utolsó módosítás"),modified)}${workflowFullEventLogField(bi("Closed by","Lezárta"),["COMPLETED","ABORTED"].includes(stage.status)?workflowStageClosedBy(stage):"—")}${workflowFullEventLogField(bi("Transfer / inheritance","Átadás / öröklés"),workflowStageTransferText(stage))}</div><div class="workflow-full-log-description"><span>${bi("Short description","Rövid leírás")}</span><p>${htmlText(stage.details||bi("No short description recorded.","Nincs rögzített rövid leírás."))}</p></div><section class="workflow-full-log-history"><div class="workflow-full-log-history-head"><h4>${bi("Phase event history","Fázison belüli eseménytörténet")}</h4><span>${events.length}</span></div>${events.length?workflowEventLogMarkup(stage,0):`<p class="workflow-full-log-empty">${noEvents}</p>`}</section></section>`;
}
function workflowShowFullEventLog(workflowId){
 const workflow=workshopWorkflowRows.find(row=>String(row.id)===String(workflowId));
 const stages=(workflow?.stages||[]).slice().sort((a,b)=>Number(a.stage_order)-Number(b.stage_order));
 if(!workflow||!stages.length)return;
 workflowCloseFullEventLog();
 const overlay=document.createElement("div");
 overlay.className="workflow-event-log-modal";
 overlay.setAttribute("aria-hidden","true");
 const workflowName=workflowSafeText(workflow?.title,workflowSafeText(workflow?.workflow_key,bi("Workshop workflow","Műhely workflow")));
 const piano=workflowSafeText(workflow?.piano_display_name,workflowSafeText(workflow?.piano_id,"—"));
 const finalDeadline=workflow.final_due_at?workflowCardDateTimeText(workflow.final_due_at):bi("Not set","Nincs megadva");
 overlay.innerHTML=`<section class="workflow-event-log-modal-card workflow-full-log-modal-card" role="dialog" aria-modal="true" aria-labelledby="workflowEventLogModalTitle"><header><div><p class="event-kicker">${htmlText(workflow.workflow_key||"")}</p><h2 id="workflowEventLogModalTitle">${bi("Full workflow history","Teljes workflow-eseménynapló")}</h2><p>${htmlText(workflowName)}</p></div><button type="button" class="workflow-event-log-modal-close" aria-label="${bi("Close","Bezárás")}" data-workflow-event-log-close>×</button></header><div class="workflow-event-log-modal-scroll"><div class="workflow-full-log-summary">${workflowFullEventLogField(bi("Piano","Zongora"),piano)}${workflowFullEventLogField(bi("Client / owner","Ügyfél / tulajdonos"),workflow.client_name||"—")}${workflowFullEventLogField(bi("Main responsible","Fő felelős"),workflow.workflow_owner_name||"—")}${workflowFullEventLogField(bi("Final customer deadline","Végső ügyfélhatáridő"),finalDeadline,workflow.is_overdue?"is-overdue":"")}</div><div class="workflow-full-log-heading"><div><p class="event-kicker">${bi("Seven phases","Hét fázis")}</p><h3>${bi("Past, current and planned workflow","Múltbeli, aktuális és tervezett workflow")}</h3></div><span>${stages.length}</span></div><div class="workflow-full-log-phases">${stages.map(stage=>workflowFullEventLogPhaseMarkup(workflow,stage)).join("")}</div></div></section>`;
 const close=()=>workflowCloseFullEventLog();
 overlay.querySelector("[data-workflow-event-log-close]")?.addEventListener("click",close);
 overlay.addEventListener("click",event=>{if(event.target===overlay)close();});
 overlay.workflowEscapeHandler=event=>{if(event.key==="Escape"){event.preventDefault();close();}};
 document.addEventListener("keydown",overlay.workflowEscapeHandler,true);
 document.body.appendChild(overlay);
 document.body.classList.add("workflow-event-log-open");
 requestAnimationFrame(()=>{overlay.classList.add("is-visible");overlay.setAttribute("aria-hidden","false");});
 setTimeout(()=>overlay.querySelector("[data-workflow-event-log-close]")?.focus(),30);
}
function workflowFinancialLineMarkup(line, workflowId){const vendor=line.partner_name?` · ${htmlText(line.partner_name)}${line.payable_invoice_number?` · ${htmlText(line.payable_invoice_number)}`:""}`:"";return `<div class="workflow-line-list-row"><span>${htmlText(line.title)} · ${htmlText(line.category)} · ${htmlText(line.billing_status||"CHARGEABLE")}${vendor}</span><b class="${line.line_type==='COST'?"amount-negative":"amount-positive"}">${line.line_type==='COST'?"−":"+"}${money(line.amount||0)}</b>${line.payable_invoice_id?`<span class="status-pill ok">VND</span>`:`<button type="button" class="icon-btn small" onclick="workflowEditFinancialLine('${htmlText(workflowId)}','${htmlText(line.id)}')" aria-label="${bi("Edit financial line","Pénzügyi tétel szerkesztése")}">✎</button>`}</div>`;}
function workflowInspectionPanelMarkup(workflow){
 const intakeDone=workflow.intake_inspection_status&&workflow.intake_inspection_status!=="PENDING"&&workflow.intake_pdf_path,dispatchDone=workflow.dispatch_inspection_status&&workflow.dispatch_inspection_status!=="PENDING"&&workflow.dispatch_pdf_path;
 const link=(path,label)=>path?`<a class="workflow-inspection-link" href="${htmlText(path)}" target="_blank" rel="noopener">${htmlText(label)} ↗</a>`:"";
 return `<section class="workflow-detail-block workflow-inspection-panel"><div class="workflow-block-head"><h3>${bi("Logistics & condition inspections","Logisztikai és állapotfelmérések")}</h3><span>${intakeDone&&dispatchDone?bi("Complete","Teljes"):bi("Documentation required","Dokumentáció szükséges")}</span></div><div class="workflow-inspection-grid"><article class="workflow-inspection-card"><h4>${bi("1. Intake Inspection","1. Beérkezési állapotfelmérés")}</h4><p>${bi("Status","Állapot")}: <b>${htmlText(workflow.intake_inspection_status||"PENDING")}</b>${workflow.intake_inspected_by?` · ${htmlText(workflow.intake_inspected_by)}`:""}</p>${link(workflow.intake_pdf_path,bi("Intake PDF","Beérkezési PDF"))}${intakeDone?"":`<label class="workflow-inspection-question"><input id="workflowIntakeConfirm_${htmlText(workflow.id)}" type="checkbox"> ${bi("Has the piano been inspected upon arrival (exterior cabinet & interior mechanism)?","Megtörtént a zongora beérkezéskori külső és belső állapotfelmérése?")}</label><label>${bi("Condition","Állapot")}<select id="workflowIntakeStatus_${htmlText(workflow.id)}"><option value="FLAWLESS">${bi("Flawless / Pristine","Hibátlan / kifogástalan")}</option><option value="PRE_EXISTING_DAMAGE">${bi("Pre-existing Damage Found","Korábbi sérülés található")}</option></select></label><label>${req(bi("Intake receipt PDF","Átvételi jegyzőkönyv PDF"))}<input id="workflowIntakePdf_${htmlText(workflow.id)}" class="workflow-file-upload-control" type="file" accept="application/pdf,.pdf"></label><label>${bi("Damage photos","Sérülésfotók")}<input id="workflowIntakePhotos_${htmlText(workflow.id)}" class="workflow-file-upload-control" type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"></label><button id="workflowIntakeSave_${htmlText(workflow.id)}" type="button" class="small" onclick="workflowUploadInspection('${htmlText(workflow.id)}','intake')">${bi("Save intake inspection","Beérkezési állapot mentése")}</button>`}</article><article class="workflow-inspection-card"><h4>${bi("2. Dispatch / Outgoing Inspection","2. Kiszállítási állapotfelmérés")}</h4><p>${bi("Status","Állapot")}: <b>${htmlText(workflow.dispatch_inspection_status||"PENDING")}</b>${workflow.dispatch_inspected_by?` · ${htmlText(workflow.dispatch_inspected_by)}`:""}</p>${link(workflow.dispatch_pdf_path,bi("Dispatch PDF","Kiadási PDF"))}${dispatchDone?"":`<label class="workflow-inspection-question"><input id="workflowDispatchConfirm_${htmlText(workflow.id)}" type="checkbox"> ${bi("Has the piano been inspected and approved for delivery (exterior & interior verified)?","Megtörtént és jóvá lett hagyva a kiszállítás előtti külső és belső ellenőrzés?")}</label><label>${bi("Condition","Állapot")}<select id="workflowDispatchStatus_${htmlText(workflow.id)}"><option value="APPROVED">${bi("Approved for delivery","Kiszállításra jóváhagyva")}</option><option value="ISSUE_FOUND">${bi("Issue found","Probléma található")}</option></select></label><label>${req(bi("Dispatch / handover PDF","Kiszállítási / átadás-átvételi PDF"))}<input id="workflowDispatchPdf_${htmlText(workflow.id)}" class="workflow-file-upload-control" type="file" accept="application/pdf,.pdf"></label><button id="workflowDispatchSave_${htmlText(workflow.id)}" type="button" class="small" onclick="workflowUploadInspection('${htmlText(workflow.id)}','dispatch')">${bi("Save dispatch inspection","Kiadási állapot mentése")}</button>`}</article></div></section>`;
}
async function workflowUploadInspection(workflowId,type){
 const isIntake=type==="intake",submissionKey=`${workflowId}:${type}`,button=document.getElementById(`${isIntake?"workflowIntakeSave":"workflowDispatchSave"}_${workflowId}`);
 if(workflowInspectionSubmissions.has(submissionKey))return;
 try{
  const confirmed=document.getElementById(`${isIntake?"workflowIntakeConfirm":"workflowDispatchConfirm"}_${workflowId}`)?.checked;if(!confirmed)return showError(isIntake?bi("Confirm the arrival inspection first.","Előbb igazold a beérkezési állapotfelmérést."):bi("Confirm the outgoing inspection first.","Előbb igazold a kiszállítási állapotfelmérést."));
  const pdf=document.getElementById(`${isIntake?"workflowIntakePdf":"workflowDispatchPdf"}_${workflowId}`)?.files?.[0];if(!pdf)return showError(bi("A PDF document is required.","PDF dokumentum kötelező."));
  workflowInspectionSubmissions.add(submissionKey);if(button){button.disabled=true;button.setAttribute("aria-busy","true");}
  const data=new FormData();data.append("status",document.getElementById(`${isIntake?"workflowIntakeStatus":"workflowDispatchStatus"}_${workflowId}`)?.value||(isIntake?"FLAWLESS":"APPROVED"));data.append("pdf",pdf);if(isIntake)[...(document.getElementById(`workflowIntakePhotos_${workflowId}`)?.files||[])].forEach(file=>data.append("photos",file));
  await api(`/api/workflows/${encodeURIComponent(workflowId)}/inspections/${type}`,{method:"POST",body:data});showToast(isIntake?bi("Intake inspection saved.","A beérkezési állapot mentve."):bi("Dispatch inspection saved.","A kiadási állapot mentve."),"success");workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId="__workflow__";await renderWorkshopWorkflow();
 }catch(error){showError(error);}
 finally{workflowInspectionSubmissions.delete(submissionKey);if(button?.isConnected){button.disabled=false;button.removeAttribute("aria-busy");}}
}
function workflowOverviewDrawerMarkup(workflow){
 const stages=workflow.stages||[],canFinalize=isAdmin(),canDelete=isAdmin()&&workflow.financial_status!=="CLOSED",canSuperDelete=isSuperadmin();
 return `<div class="workflow-summary-grid"><div><span>${bi("Status","Állapot")}</span><b>${htmlText(sanitizeSafeText(workflow.current_status,""))}</b></div><div><span>${bi("Mode","Munkamód")}</span><b>${workflow.mode==="ON_SITE"?bi("On site","Helyszíni"):bi("Inbound","Beszállítandó")}</b></div><div><span>${bi("Final customer deadline","Végső ügyfélhatáridő")}</span><b class="${workflow.is_overdue?"danger-text":""}">${htmlText(workflowDateText(workflow.final_due_at))}</b></div><div><span>${bi("Main responsible","Fő felelős")}</span><b>${htmlText(sanitizeSafeText(workflow.workflow_owner_name,"—"))}</b></div></div>${workflowInspectionPanelMarkup(workflow)}<div class="workflow-detail-block"><h3>${bi("Workflow description","Workflow leírása")}</h3><p>${htmlText(sanitizeSafeText(workflow.description,bi("No description yet.","Még nincs leírás.")))}</p><p class="muted">${htmlText(sanitizeSafeText(workflow.current_location,""))}${workflow.transport_address?` · ${htmlText(sanitizeSafeText(workflow.transport_address,""))}`:""}</p></div><div class="workflow-detail-block"><div class="workflow-block-head"><h3>${bi("Phases overview","Fázisáttekintés")}</h3><span>${stages.filter(stage=>stage.status!=="NOT_REQUIRED").length} ${bi("active","aktív")}</span></div><div class="workflow-overview-stages">${stages.map(stage=>`<button type="button" class="workflow-overview-stage status-${workflowStatusClass(workflowEffectiveStatus(stage))}" onclick="openWorkshopWorkflow('${htmlText(workflow.id)}','${htmlText(stage.id)}')"><b>${Number(stage.stage_order)+1}. ${htmlText(workflowStageLabel(stage))}</b><span>${htmlText(workflowStatusLabel(workflowEffectiveStatus(stage)))}</span><small>${bi("Responsible","Felelős")}: ${htmlText(sanitizeSafeText(stage.assigned_to,bi("Unassigned","Nincs kiosztva")))} · ${bi("Deadline","Határidő")}: ${htmlText(workflowDateText(stage.due_at||"—"))}</small></button>`).join("")}</div></div><div class="workflow-detail-block"><div class="workflow-block-head"><h3>${bi("Financial summary","Pénzügyi összesítés")}</h3><span>${money(workflow.finance_summary?.net_total||0)}</span></div><p>${bi("Revenue","Bevétel")}: ${money(workflow.finance_summary?.revenue_total||0)} · ${bi("Costs","Költségek")}: ${money(workflow.finance_summary?.cost_total||0)}</p></div><div class="workflow-drawer-actions">${canFinalize?`<button type="button" onclick="workflowFinalize('${htmlText(workflow.id)}')">${bi("Financially close workflow","Workflow pénzügyi lezárása")}</button>`:""}${canDelete?`<button type="button" class="danger-btn" onclick="workflowSecondaryDelete('${htmlText(workflow.id)}')">${bi("Scrap / close workflow","Workflow selejtezése / lezárása")}</button>`:""}${canSuperDelete?`<button type="button" class="danger-btn" onclick="workflowSuperDelete('${htmlText(workflow.id)}')">${bi("Delete Workflow","Workflow Törlése")}</button>`:""}</div>`;
}
function workflowDrawerMarkup(workflow, selectedStageId=""){
 if(!workflow)return "";
 const stage=selectedStageId&&selectedStageId!=="__workflow__"?(workflow.stages||[]).find(item=>String(item.id)===String(selectedStageId)):null;
 return `<aside class="workflow-drawer" role="dialog" aria-label="${bi("Workflow details","Workflow részletei")}"><div class="workflow-drawer-head"><button type="button" class="workflow-drawer-back ghost-btn" onclick="closeWorkshopWorkflow()" aria-label="${bi("Back","Vissza")}">‹</button><div class="workflow-drawer-head-copy"><p class="event-kicker">${stage?`${Number(stage.stage_order)+1}. ${htmlText(workflowStageLabel(stage))}`:htmlText(sanitizeSafeText(workflow.workflow_key,""))}</p><h2>${stage?bi("Workflow details","Munkafolyamat részletei"):bi("Workflow details","Workflow részletei")}</h2>${stage?"":`<p class="muted">${htmlText(workflowPianoLabel(workflow)||workflowSafeText(workflow?.piano_display_name)||workflowSafeText(workflow?.piano_id,bi("Unknown piano","Ismeretlen hangszer")))} · ${htmlText(workflowSafeText(workflow?.client_name,"—"))}</p>`}</div><button type="button" class="modal-close ghost-btn" onclick="closeWorkshopWorkflow()" aria-label="${bi("Close","Bezárás")}">×</button></div><div class="workflow-drawer-scroll">${stage?workflowPhaseDrawerMarkup(workflow,stage):workflowOverviewDrawerMarkup(workflow)}</div></aside>`;
}

function openWorkshopWorkflow(id,stageId="__workflow__"){
 const nextId=String(id||""),nextStage=String(stageId||"__workflow__");
 if(workshopWorkflowSelectedId===nextId&&workshopWorkflowSelectedStageId===nextStage){closeWorkshopWorkflow();return;}
 workshopWorkflowSelectedId=nextId;workshopWorkflowSelectedStageId=nextStage;renderWorkshopWorkflow();
}
function closeWorkshopWorkflow(){workshopWorkflowSelectedId="";workshopWorkflowSelectedStageId="";renderWorkshopWorkflow();}
function renderWorkshopPrevious(){workshopWorkflowPrevious=true;workshopWorkflowSelectedId="";workshopWorkflowSelectedStageId="";renderWorkshopWorkflow();}
function workflowPlannedJobsEnabled(){return adminModuleState.technical!==false&&adminCardState.planned_jobs!==false;}
function workflowPlannedJobIsOpen(job){const status=String(job?.status||"").toLowerCase();return !["converted","archived","cancelled","canceled","completed","closed"].some(token=>status.includes(token));}
function refreshWorkflowPlannedJobOptions(){
 const field=document.getElementById("workflowPlannedJobField"),select=document.getElementById("workflowPlannedJobSelect");
 if(!field||!select||!workflowPlannedJobsEnabled())return;
 const clientId=document.querySelector('[name="client_id"]')?.value||"",pianoId=document.querySelector('[name="piano_id"]')?.value||"";
 const rows=(workshopWorkflowPlannedJobs||[]).filter(job=>{
  if(!workflowPlannedJobIsOpen(job))return false;
  const jobClient=String(job.client_id||""),jobPiano=String(job.piano_id||"");
  const clientConflict=Boolean(jobClient&&clientId&&jobClient!==String(clientId)),pianoConflict=Boolean(jobPiano&&pianoId&&jobPiano!==String(pianoId));
  if(clientConflict||pianoConflict)return false;
  return Boolean((clientId&&jobClient===String(clientId))||(pianoId&&jobPiano===String(pianoId)));
 });
 const current=select.value;
 select.innerHTML=`<option value="">${bi("No planned work","Nincs tervezett munka")}</option>${rows.map(job=>`<option value="${htmlText(job.id)}">${htmlText(job.title||job.planned_key||job.id)}${job.client_name?` · ${htmlText(job.client_name)}`:""}</option>`).join("")}`;
 if(rows.some(job=>String(job.id)===String(current)))select.value=current;
 field.classList.toggle("has-matches",rows.length>0);
}
async function openWorkflowCreate(){
 await openWorkflowCreateBase();
 workshopWorkflowPlannedJobs=[];
 if(!workflowPlannedJobsEnabled())return;
 try{
  workshopWorkflowPlannedJobs=await api("/api/planned-jobs?include_all=1");
  const form=$("#workflowCreateForm"),grid=form?.querySelector(".form-grid");
  if(grid){const field=document.createElement("div");field.id="workflowPlannedJobField";field.className="field workflow-planned-job-field";field.innerHTML=`<label>${bi("Planned work link (optional)","Tervezett munka kapcsolása (opcionális)")}</label><select id="workflowPlannedJobSelect" name="planned_job_id"><option value="">${bi("No planned work","Nincs tervezett munka")}</option></select>`;grid.insertBefore(field,grid.children[2]||null);refreshWorkflowPlannedJobOptions();}
 }catch(_error){workshopWorkflowPlannedJobs=[];document.getElementById("workflowPlannedJobField")?.remove();}
}
function workflowCreatePhaseChecklistMarkup(){
 return `<div class="workflow-create-phase-checklist"><div class="workflow-checklist-heading"><div><h3>${bi("Required workflow phases","Szükséges workflow-fázisok")}</h3><p class="muted">${bi("Select the phases required for this work. Unselected phases remain visible as not relevant.","Jelöld ki a munkához szükséges fázisokat. A ki nem választott fázisok nem releváns állapotban láthatók maradnak.")}</p></div></div>${workshopWorkflowDefinitions.slice().sort((a,b)=>a.sort_order-b.sort_order).map((stage,index)=>`<div class="workflow-create-phase-row" data-stage-code="${htmlText(stage.code)}" data-stage-order="${Number(stage.sort_order)}"><div class="workflow-create-phase-left"><label class="workflow-phase-toggle"><input type="checkbox" name="stage_enabled_${htmlText(stage.code)}" value="1" checked onchange="refreshWorkflowCreatePhaseFields()"><span><strong>${Number(stage.sort_order)+1}. ${htmlText(currentLang==="hu"?stage.name_hu:stage.name_en)}</strong><small>${stage.code==="FINAL_HANDOVER"?bi("The final stage follows the immutable customer deadline.","A végső fázis a nem módosítható ügyfélhatáridőt követi."):bi("Optional phase for this workflow.","A workflow-ban opcionálisan választható fázis.")}</small></span></label><label class="workflow-create-phase-deadline">${bi("Phase deadline","Fázishatáridő")}${compactDateTimeControlMarkup(`workflowCreateDue_${stage.code}`,`stage_due_${stage.code}`,"",{defaultTime:"10:00",allowEmpty:true,disabled:stage.code==="FINAL_HANDOVER",dataAttr:"data-phase-due"})}</label></div><div class="workflow-create-phase-right"><label>${bi("Card title (optional)","Kártya címe (opcionális)")}<input name="stage_card_title_${htmlText(stage.code)}" data-phase-card-title maxlength="240"></label><label>${bi("Responsible","Felelős")}<select name="stage_assignee_${htmlText(stage.code)}" data-phase-assignee>${workflowWorkerOptions(index===0?user?.id||"":"")}</select></label><label class="workflow-create-phase-short-description">${bi("Short description","Rövid leírás")}<textarea name="stage_details_${htmlText(stage.code)}" data-phase-short-description rows="3" maxlength="2000" placeholder="${bi("Card notes...","Card notes...")}"></textarea></label></div></div>`).join("")}</div>`;
}
function refreshWorkflowCreatePhaseFields(){
 const form=$("#form"),mode=form?.querySelector('[name="mode"]')?.value||"INBOUND";
 if(!form)return;
 const rows=[...form.querySelectorAll(".workflow-create-phase-row")];
 rows.forEach(row=>{
  const code=row.dataset.stageCode,checkbox=row.querySelector('input[type="checkbox"]'),cardTitle=row.querySelector('[data-phase-card-title]'),assignee=row.querySelector('[data-phase-assignee]'),due=row.querySelector('[data-phase-due]'),shortDescription=row.querySelector('[data-phase-short-description]'),disabled=mode==="ON_SITE"&&code==="INBOUND";
  if(disabled){checkbox.checked=false;checkbox.disabled=true;}else checkbox.disabled=false;
  const active=checkbox.checked&&!checkbox.disabled;
  if(assignee)assignee.disabled=!active;
  if(cardTitle)cardTitle.disabled=!active;
  if(shortDescription)shortDescription.disabled=!active;
  if(due)setJobDateTimePickerDisabled(due.id,!active||code==="FINAL_HANDOVER");
  row.classList.toggle("is-inactive",!active);
 });
 const first=rows.find(row=>row.querySelector('input[type="checkbox"]:checked:not(:disabled)'));
 rows.forEach(row=>{const assignee=row.querySelector('[data-phase-assignee]'),note=row.querySelector(".workflow-first-phase-note");if(assignee)assignee.required=row===first;if(note)note.remove();});
 if(first){const note=document.createElement("small");note.className="workflow-first-phase-note";note.textContent=bi("Required responsible for the first active phase","Az első aktív fázis felelőse kötelező");first.querySelector("[data-phase-assignee]")?.parentElement.append(note);}
 refreshWorkflowCreateSubmitState();
}
let workflowCreateContacts=[];
let workflowCreatePianos=[];
function workflowSearchText(value){return String(value||"").trim().toLocaleLowerCase();}
function workflowPianoPrimary(p){return workflowPianoLabel(p);}
function workflowPianoSecondary(p){const parts=[];if(p?.serial_no)parts.push(`Serial: #${p.serial_no}`);if(p?.finish)parts.push(`Finish: ${p.finish}`);return parts.join(" · ")||bi("No serial / finish recorded","Nincs rögzített sorozatszám / kivitel");}
function workflowBrandComboboxMarkup(name="brand",value="",suggestionId="workflowBrandSuggestions"){return `<div class="workflow-brand-combobox"><input name="${name}" value="${htmlText(value)}" autocomplete="off" required data-workflow-brand-input data-workflow-brand-box="${htmlText(suggestionId)}"><div id="${htmlText(suggestionId)}" class="workflow-typeahead-results hidden"></div></div>`;}
function bindWorkflowBrandCombobox(scope=document){scope.querySelectorAll('[data-workflow-brand-input]').forEach(input=>{const box=scope.querySelector(`#${CSS.escape(input.dataset.workflowBrandBox||'')}`);if(!box)return;const render=()=>{const raw=String(input.value||'').trim(),term=raw.toLocaleLowerCase(),matches=workflowPianoBrands.filter(name=>!term||String(name).toLocaleLowerCase().includes(term)).slice(0,8),exact=workflowPianoBrands.some(name=>String(name).toLocaleLowerCase()===term);box.innerHTML=matches.map(name=>`<button type="button" class="workflow-typeahead-option" data-brand-choice="${htmlText(name)}"><strong>${htmlText(name)}</strong></button>`).join('')+(!exact&&raw?`<button type="button" class="workflow-typeahead-add" data-brand-create>+ ${htmlText(bi(`Add "${raw}" as new brand`,`"${raw}" új márkaként hozzáadása`))}</button>`:'');box.classList.toggle('hidden',!box.innerHTML);box.querySelectorAll('[data-brand-choice]').forEach(btn=>btn.addEventListener('mousedown',event=>{event.preventDefault();input.value=btn.dataset.brandChoice||'';box.classList.add('hidden');}));box.querySelector('[data-brand-create]')?.addEventListener('mousedown',async event=>{event.preventDefault();if(!raw)return;try{const saved=await api('/api/piano-brands',{method:'POST',body:JSON.stringify({brand_name:raw})});const brandName=String(saved?.brand_name||raw).trim();if(brandName&&!workflowPianoBrands.some(name=>String(name).toLocaleLowerCase()===brandName.toLocaleLowerCase()))workflowPianoBrands.push(brandName);input.value=brandName;box.classList.add('hidden');showToast(bi('Piano brand added to the reference list.','A zongoramárka bekerült a referencia-listába.'),'success');}catch(error){showError(error);}});};input.addEventListener('input',render);input.addEventListener('focus',render);input.addEventListener('blur',()=>setTimeout(()=>box.classList.add('hidden'),180));});}
function workflowRenderEntitySuggestions(kind){
 const input=document.getElementById(kind==="client"?"workflowClientSearch":"workflowPianoSearch"),box=document.getElementById(kind==="client"?"workflowClientSuggestions":"workflowPianoSuggestions");if(!input||!box)return;
 const term=workflowSearchText(input.value);
 if(input.dataset.selectedLabel&&workflowSearchText(input.dataset.selectedLabel)!==term){input.dataset.selectedId="";input.dataset.selectedLabel="";const hidden=document.querySelector(`[name="${kind}_id"]`);if(hidden)hidden.value="";if(kind==="client"){const piano=document.getElementById("workflowPianoSearch");if(piano){piano.value="";piano.dataset.selectedId="";piano.dataset.selectedLabel="";}const pianoHidden=document.querySelector('[name="piano_id"]');if(pianoHidden)pianoHidden.value="";}refreshWorkflowPlannedJobOptions();}
 const selectedClientId=document.querySelector('[name="client_id"]')?.value||"";
 const source=kind==="client"?workflowCreateContacts:workflowCreatePianos.filter(p=>!selectedClientId||String(p.owner_contact_id||p.client_id||"")===String(selectedClientId));
 const rows=(term?source.filter(item=>{const hay=kind==="client"?[item.name,item.email,item.phone]:[item.brand,item.model,item.serial_no,item.finish,item.display_name];return hay.some(value=>workflowSearchText(value).includes(term));}):source).slice(0,8);
 const markup=rows.map(item=>{const primary=kind==="client"?String(item.name||""):workflowPianoPrimary(item),secondary=kind==="client"?[item.email,item.phone].filter(Boolean).join(" · "):workflowPianoSecondary(item);return `<button type="button" class="workflow-typeahead-option" data-workflow-${kind}-id="${htmlText(item.id)}"><strong>${htmlText(primary)}</strong><small>${htmlText(secondary||"—")}</small></button>`;}).join("");
 const addClient=kind==="client"&&term&&!rows.length?`<button type="button" class="workflow-typeahead-add" data-workflow-add-client>+ ${bi("Add New Client","Új ügyfél hozzáadása")}</button>`:"";
 const addPiano=kind==="piano"&&selectedClientId&&term&&!rows.length?`<button type="button" class="workflow-typeahead-add" data-workflow-add-piano>+ ${bi("Add New Piano","Új zongora hozzáadása")}</button>`:"";
 box.innerHTML=markup+addClient+addPiano;box.classList.toggle("hidden",!(markup||addClient||addPiano));
 box.querySelectorAll(`[data-workflow-${kind}-id]`).forEach(button=>button.addEventListener("click",()=>{const id=button.getAttribute(`data-workflow-${kind}-id`),item=source.find(x=>String(x.id)===String(id));if(!item)return;const label=kind==="client"?String(item.name||""):workflowPianoPrimary(item);input.value=label;input.dataset.selectedId=id;input.dataset.selectedLabel=label;const hidden=document.querySelector(`[name="${kind}_id"]`);if(hidden)hidden.value=id;box.classList.add("hidden");if(kind==="client"){const piano=document.getElementById("workflowPianoSearch");if(piano){piano.value="";piano.dataset.selectedId="";piano.dataset.selectedLabel="";}const pianoHidden=document.querySelector('[name="piano_id"]');if(pianoHidden)pianoHidden.value="";workflowRenderEntitySuggestions("piano");}refreshWorkflowPlannedJobOptions();}));
 box.querySelector('[data-workflow-add-client]')?.addEventListener("click",()=>openWorkflowInlineClientModal(input.value));
 box.querySelector('[data-workflow-add-piano]')?.addEventListener("click",()=>openWorkflowInlinePianoModal(selectedClientId,input.value));
}
const workflowTypeaheadTimers={client:null,piano:null};
function scheduleWorkflowTypeahead(kind,immediate=false){clearTimeout(workflowTypeaheadTimers[kind]);workflowTypeaheadTimers[kind]=setTimeout(()=>workflowRenderEntitySuggestions(kind),immediate?0:275);}
function bindWorkflowTypeaheads(){["client","piano"].forEach(kind=>{const input=document.getElementById(kind==="client"?"workflowClientSearch":"workflowPianoSearch");if(!input)return;input.addEventListener("input",()=>scheduleWorkflowTypeahead(kind));input.addEventListener("focus",()=>scheduleWorkflowTypeahead(kind,true));input.addEventListener("blur",()=>setTimeout(()=>document.getElementById(kind==="client"?"workflowClientSuggestions":"workflowPianoSuggestions")?.classList.add("hidden"),180));});}
function openWorkflowInlineClientModal(prefill=""){
 const overlay=document.createElement("div");overlay.className="nested-modal-overlay";overlay.dataset.workflowInlineClient="1";overlay.innerHTML=`<section class="nested-modal-card" role="dialog" aria-modal="true"><div class="modal-header"><h3>${bi("Add New Client","Új ügyfél")}</h3><button type="button" class="modal-close" data-inline-close>×</button></div><form><div class="form-grid"><div class="field"><label>${req(bi("Name","Név"))}</label><input name="name" value="${htmlText(prefill)}" required></div><div class="field"><label>${bi("Email","E-mail")}</label><input name="email" type="email"></div><div class="field"><label>${bi("Phone","Telefon")}</label><input name="phone"></div><div class="field full"><label>${req(bi("Street Address","Utca, házszám, emelet/ajtó"))}</label><input name="address_line1" required></div><div class="field"><label>${req(bi("City","Város"))}</label><input name="city" required></div><div class="field"><label>${req(bi("State","Állam / Megye"))}</label><input name="state" required></div><div class="field"><label>${req(bi("Postal / ZIP Code","Irányítószám"))}</label><input name="postal_code" required></div><div class="field"><label>${req(bi("Country","Ország"))}</label><input name="country" value="United States" required></div><div class="field full"><label>${bi("Does this client own/have a piano?","Van ennek az ügyfélnek zongorája?")}<select name="has_piano" onchange="this.closest('form').querySelector('[data-inline-piano-fields]').classList.toggle('hidden',this.value!=='1')"><option value="0">${bi("No","Nem")}</option><option value="1">${bi("Yes","Igen")}</option></select></label></div><div class="field full hidden" data-inline-piano-fields><div class="form-grid"><div class="field workflow-typeahead-field"><label>${req(bi("Manufacturer / Brand","Gyártó / Márka"))}</label>${workflowBrandComboboxMarkup("make","","workflowInlineClientBrandSuggestions")}</div><div class="field"><label>${req(bi("Model","Modell"))}</label><input name="model"></div><div class="field"><label>${req(bi("Serial Number","Sorozatszám"))}</label><input name="serial_number"></div><div class="field"><label>${bi("Finish / Color","Kivitel / Szín")}</label><input name="finish"></div></div></div></div><div class="actions"><button type="button" class="ghost-btn" data-inline-close>${bi("Cancel","Mégse")}</button><button type="submit">${bi("Create and select","Létrehozás és kiválasztás")}</button></div></form></section>`;
 const close=()=>overlay.remove();overlay.querySelectorAll('[data-inline-close]').forEach(btn=>btn.addEventListener("click",close));overlay.addEventListener("click",e=>{if(e.target===overlay)close();});overlay.querySelector("form").addEventListener("submit",async e=>{e.preventDefault();try{const body=Object.fromEntries(new FormData(e.currentTarget));body.has_piano=body.has_piano==="1";if(body.has_piano&&(!body.make?.trim()||!body.model?.trim()||!body.serial_number?.trim()))return showError(bi("Manufacturer, model and serial number are required for the piano.","A zongorához a gyártó, modell és sorozatszám kötelező."));const result=await api("/api/workflow/inline-client-piano",{method:"POST",body:JSON.stringify(body)});workflowCreateContacts.push(result.client);if(result.piano)workflowCreatePianos.push(result.piano);if(result.piano?.brand&&!workflowPianoBrands.some(name=>workflowSearchText(name)===workflowSearchText(result.piano.brand)))workflowPianoBrands.push(result.piano.brand);const clientInput=document.getElementById("workflowClientSearch"),clientHidden=document.querySelector('[name="client_id"]');if(clientInput){clientInput.value=result.client.name;clientInput.dataset.selectedId=result.client.id;clientInput.dataset.selectedLabel=result.client.name;}if(clientHidden)clientHidden.value=result.client.id;if(result.piano){const pianoInput=document.getElementById("workflowPianoSearch"),pianoHidden=document.querySelector('[name="piano_id"]'),label=workflowPianoPrimary(result.piano);if(pianoInput){pianoInput.value=label;pianoInput.dataset.selectedId=result.piano.id;pianoInput.dataset.selectedLabel=label;}if(pianoHidden)pianoHidden.value=result.piano.id;}refreshWorkflowPlannedJobOptions();close();showToast(bi("Client created and selected.","Az ügyfél létrejött és kiválasztásra került."),"success");}catch(error){showError(error);}});document.body.appendChild(overlay);applyLanguageToDOM(overlay);bindWorkflowBrandCombobox(overlay);setTimeout(()=>overlay.querySelector('[name="name"]')?.focus(),20);
}
function openWorkflowInlinePianoModal(clientId,prefill=""){
 const client=workflowCreateContacts.find(c=>String(c.id)===String(clientId));if(!client)return showError(bi("Select a client first.","Előbb válassz ügyfelet."));const overlay=document.createElement("div");overlay.className="nested-modal-overlay";overlay.dataset.workflowInlinePiano="1";overlay.innerHTML=`<section class="nested-modal-card" role="dialog" aria-modal="true"><div class="modal-header"><h3>${bi("Add New Piano","Új zongora")}</h3><button type="button" class="modal-close" data-inline-close>×</button></div><form><p class="muted">${htmlText(client.name||"")}</p><div class="form-grid"><div class="field workflow-typeahead-field"><label>${req(bi("Brand","Márka"))}</label>${workflowBrandComboboxMarkup("brand","","workflowInlinePianoBrandSuggestions")}</div><div class="field"><label>${req(bi("Model","Modell"))}</label><input name="model" value="${htmlText(prefill)}" required></div><div class="field"><label>${req(bi("Serial Number","Sorozatszám"))}</label><input name="serial_no" required></div><div class="field"><label>${bi("Finish / Color","Kivitel / Szín")}</label><input name="finish"></div></div><div class="actions"><button type="button" class="ghost-btn" data-inline-close>${bi("Cancel","Mégse")}</button><button type="submit">${bi("Create and select","Létrehozás és kiválasztás")}</button></div></form></section>`;const close=()=>overlay.remove();overlay.querySelectorAll('[data-inline-close]').forEach(btn=>btn.addEventListener("click",close));overlay.querySelector("form").addEventListener("submit",async e=>{e.preventDefault();try{const body=Object.fromEntries(new FormData(e.currentTarget));const piano=await api(`/api/contacts/${encodeURIComponent(client.id)}/pianos`,{method:"POST",body:JSON.stringify(body)});workflowCreatePianos.push({...piano,owner_contact_id:client.id,client_id:client.id});if(piano?.brand&&!workflowPianoBrands.some(name=>workflowSearchText(name)===workflowSearchText(piano.brand)))workflowPianoBrands.push(piano.brand);const input=document.getElementById("workflowPianoSearch"),hidden=document.querySelector('[name="piano_id"]'),label=workflowPianoPrimary(piano);if(input){input.value=label;input.dataset.selectedId=piano.id;input.dataset.selectedLabel=label;}if(hidden)hidden.value=piano.id;refreshWorkflowPlannedJobOptions();close();showToast(bi("Piano created and selected.","A zongora létrejött és kiválasztásra került."),"success");}catch(error){showError(error);}});document.body.appendChild(overlay);applyLanguageToDOM(overlay);bindWorkflowBrandCombobox(overlay);
}
function workflowInspectionDamageWarning(select){const warning=document.getElementById("workflowIntakeDamageWarning");if(warning)warning.classList.toggle("hidden",select.value!=="PRE_EXISTING_DAMAGE");}
async function openWorkflowCreateBase(){
 const [contacts,pianos,workers,definitionsPayload,brands]=await Promise.all([api("/api/contacts"),api("/api/pianos"),loadSchedulerWorkers(),api("/api/workflow/stage-definitions"),api("/api/piano-brands").catch(()=>[])]);
 workflowCreateContacts=contacts||[];workflowCreatePianos=pianos||[];workshopWorkflowWorkers=workers||[];workshopWorkflowDefinitions=definitionsPayload.stages||[];workflowPianoBrands=brands||[];
 $("#modal").classList.remove("hidden");$("#modalTitle").textContent=bi("New workshop workflow","Új műhely-workflow");
 $("#form").innerHTML=`<div id="workflowCreateForm"><div class="form-grid"><div class="field workflow-typeahead-field"><label>${req("Client / Ügyfél")}</label><input id="workflowClientSearch" type="search" autocomplete="off" placeholder="${bi("Type name, email or phone…","Gépelj nevet, e-mailt vagy telefonszámot…")}"><input type="hidden" name="client_id" required><div id="workflowClientSuggestions" class="workflow-typeahead-results hidden"></div></div><div class="field workflow-typeahead-field"><label>${req("Piano / Zongora")}</label><input id="workflowPianoSearch" type="search" autocomplete="off" placeholder="${bi("Type brand, model or serial…","Gépelj márkát, modellt vagy sorozatszámot…")}"><input type="hidden" name="piano_id" required><div id="workflowPianoSuggestions" class="workflow-typeahead-results hidden"></div></div><div class="field"><label>${req("Work title / Munka neve")}</label><input name="title" required></div><div class="field"><label>${req("Mode / Munkamód")}</label><select name="mode" onchange="refreshWorkflowCreatePhaseFields();document.getElementById('workflowIntakeBlock')?.classList.toggle('hidden',this.value!=='INBOUND');refreshWorkflowCreateSubmitState()"><option value="INBOUND">${bi("Inbound transport required","Beszállítandó zongora")}</option><option value="ON_SITE">${bi("On-site work","Helyszínen végzett munka")}</option></select></div>${jobDateTimePickerMarkup("workflowFinalDue","final_due_at",req("Final customer deadline / Végső ügyfélhatáridő"),"",{defaultTime:"10:00"})}<div class="field"><label class="form-label">${bi("Main responsible","Fő felelős")} <span class="required">*</span></label><input value="${htmlText(sanitizeSafeText(user?.name,""))}" readonly></div><div class="field"><label class="form-label">${bi("Transport address","Szállítási cím")}</label><input name="transport_address"></div><div class="field"><label class="form-label">${bi("Current location","Jelenlegi helyszín")}</label><input name="current_location"></div><div class="field full"><label class="form-label">${bi("Description","Leírás")}</label><textarea name="description"></textarea></div><div class="field full">${workflowCreatePhaseChecklistMarkup()}</div><section id="workflowIntakeBlock" class="field full workflow-inspection-create"><h3>${bi("Intake Inspection","Beérkezési állapotfelmérés")}</h3><label class="workflow-inspection-question"><input id="workflowIntakeConfirmed" type="checkbox" onchange="refreshWorkflowCreateSubmitState()"> ${bi("Has the piano been inspected upon arrival (exterior cabinet & interior mechanism)?","Megtörtént a zongora beérkezéskori külső és belső állapotfelmérése?")}</label><div class="form-grid"><div class="field"><label>${req(bi("Condition","Állapot"))}<select id="workflowIntakeStatus" onchange="workflowInspectionDamageWarning(this)"><option value="FLAWLESS">${bi("Flawless / Pristine","Hibátlan / kifogástalan")}</option><option value="PRE_EXISTING_DAMAGE">${bi("Pre-existing Damage Found","Korábbi sérülés található")}</option></select></label></div><div class="field"><label>${req(bi("Intake receipt / bill of lading PDF","Átvételi jegyzőkönyv / fuvarlevél PDF"))}<input id="workflowIntakePdf" class="workflow-file-upload-control" type="file" accept="application/pdf,.pdf" onchange="refreshWorkflowCreateSubmitState()"></label></div><div class="field full"><label>${bi("Damage photos (optional JPG/PNG/WEBP)","Sérülésfotók (opcionális JPG/PNG/WEBP)")}<input id="workflowIntakePhotos" class="workflow-file-upload-control" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple></label><p id="workflowIntakeDamageWarning" class="workflow-inspection-warning hidden">${bi("Pre-existing damage selected: attach photos whenever available to protect the intake record.","Korábbi sérülést jelöltél: lehetőség szerint csatolj fényképeket a beérkezési állapot dokumentálásához.")}</p></div></div></section><div class="field full"><h3>${bi("Inbound preliminary checks","Beszállítás előtti előzetes ellenőrzések")}</h3></div>${[["preliminary_inspection","Preliminary view","Előzetes megtekintés"],["preliminary_assessment","Preliminary assessment","Előzetes állapotfelmérés"],["preliminary_quote","Preliminary quote","Előzetes árajánlat"],["preliminary_meeting","Preliminary meeting","Előzetes megbeszélés"]].map(([key,en,hu])=>`<div class="field"><label>${bi(en,hu)}<select name="${key}"><option value="NOT_REQUIRED">${bi("Not required","Nem szükséges")}</option><option value="DONE">${bi("Done","Megtörtént")}</option><option value="NOT_DONE">${bi("Not done","Nem történt meg")}</option></select></label></div>`).join("")}<div class="field"><label>${bi("Preliminary quote amount / Előzetes árajánlat összege","Előzetes árajánlat összege")}<input name="preliminary_quote_amount" type="number" min="0" step="0.01" value="0"></label></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Cancel","Mégse")}</button><button id="workflowCreateSubmit" type="submit">${bi("Create workflow","Workflow létrehozása")}</button></div></div>`;
 $("#form").onsubmit=event=>{event.preventDefault();submitWorkflowCreate(event.currentTarget);};bindJobDateTimePickers($("#form"));bindWorkflowTypeaheads();refreshWorkflowCreatePhaseFields();refreshWorkflowCreateSubmitState();
}
function refreshWorkflowCreateSubmitState(){const form=$("#workflowCreateForm"),button=document.getElementById("workflowCreateSubmit");if(!form||!button)return;const inbound=form.querySelector('[name="mode"]')?.value==="INBOUND";const confirmed=document.getElementById("workflowIntakeConfirmed")?.checked,pdf=document.getElementById("workflowIntakePdf")?.files?.[0];button.disabled=Boolean(inbound&&(!confirmed||!pdf));button.title=button.disabled?bi("Confirm the intake inspection and select the mandatory PDF first.","Előbb igazold a beérkezési állapotfelmérést és válaszd ki a kötelező PDF-et."):"";}
async function submitWorkflowCreate(form=$("#form")){
 try{
  const formData=new FormData(form),clientId=document.querySelector('[name="client_id"]')?.value,pianoId=document.querySelector('[name="piano_id"]')?.value;
  if(!clientId||!pianoId)return showError(bi("Select a client and piano from the predictive search.","Válassz ügyfelet és zongorát a prediktív keresőből."));
  formData.set("client_id",clientId);formData.set("piano_id",pianoId);
  const inbound=formData.get("mode")==="INBOUND",confirmed=document.getElementById("workflowIntakeConfirmed")?.checked,pdf=document.getElementById("workflowIntakePdf")?.files?.[0],photos=[...(document.getElementById("workflowIntakePhotos")?.files||[])],status=document.getElementById("workflowIntakeStatus")?.value||"FLAWLESS";
  if(inbound&&!confirmed)return showError(bi("Confirm the arrival inspection before creating an inbound workflow.","Beszállítandó workflow létrehozása előtt igazold a beérkezési állapotfelmérést."));
  if(inbound&&!pdf)return showError(bi("The intake PDF is mandatory.","A beérkezési PDF kötelező."));
  formData.set("intake_confirmed",confirmed?"1":"0");formData.set("intake_status",status);
  if(inbound&&pdf)formData.set("intake_pdf",pdf,pdf.name);
  photos.forEach(file=>formData.append("intake_photos",file,file.name));
  const workflow=await api("/api/workflows",{method:"POST",body:formData,timeoutMs:30000});
  closeModal();showToast(bi("Workflow created.","A workflow létrejött."),"success");workshopWorkflowPrevious=false;workshopWorkflowSelectedId=workflow.id||"";workshopWorkflowSelectedStageId="__workflow__";await renderWorkshopWorkflow();
 }catch(error){showError(error);}
}
async function workflowSaveStage(workflowId,stageId){try{const dueInput=$(`#workflowDue_${stageId}`),body={status:$(`#workflowStatus_${stageId}`)?.value,details:$(`#workflowDetails_${stageId}`)?.value,due_at:dueInput&&!dueInput.disabled?dueInput.value||undefined:undefined,assigned_user_id:$(`#workflowAssignee_${stageId}`)?.value||undefined};await api(`/api/workflows/${workflowId}/stages/${stageId}`,{method:"PATCH",body:JSON.stringify(body)});showToast(bi("Phase saved.","A fázis mentve."),"success");await renderWorkshopWorkflow();}catch(error){showError(error);}}
async function workflowTransferStage(workflowId,stageId){const toUser=$(`#workflowAssignee_${stageId}`)?.value||"";if(!toUser)return showError({message:bi("Select a responsible person first.","Előbb válassz felelőst.")});const reason=await appPrompt(bi("Why is this phase being transferred?","Miért kerül átadásra ez a fázis?"),{type:"warning"});if(!reason?.trim())return;try{await api(`/api/workflows/${workflowId}/stages/${stageId}/transfer`,{method:"POST",body:JSON.stringify({to_user_id:toUser,reason})});showToast(bi("Phase transferred.","A fázis átadva."),"success");await renderWorkshopWorkflow();}catch(error){showError(error);}}
async function workflowAddFinancialLine(workflowId){const title=$("#workflowFinanceTitle")?.value.trim(),amount=Number($("#workflowFinanceAmount")?.value||0),line_type=$("#workflowFinanceType")?.value,category=$("#workflowFinanceCategory")?.value;if(!title||amount<0)return showError({message:bi("Line title and amount are required.","A tétel neve és összege kötelező.")});try{await api(`/api/workflows/${workflowId}/financial-lines`,{method:"POST",body:JSON.stringify({title,amount,line_type,category})});await renderWorkshopWorkflow();}catch(error){showError(error);}}
async function workflowFinalize(id){const paymentMethod=await chooseStandardPaymentMethod({title:bi("Workflow invoice payment method","Workflow-számla fizetési módja"),initialValue:"Bank Transfer / ACH",confirmText:bi("Use payment method","Fizetési mód használata")});if(!paymentMethod)return;const reason=await appPrompt(bi("Enter closure reason. Required for a zero-result workflow.","Add meg a lezárás indokát. Nulla eredményű workflow-nál kötelező."),{type:"warning"});if(reason===null)return;try{const result=await api(`/api/workflows/${id}/finalize`,{method:"POST",body:JSON.stringify({closure_reason:reason,payment_method:paymentMethod})});showToast(`${bi("Workflow closed and draft invoice prepared.","A workflow lezárva, a számlatervezet elkészült.")} · ${paymentMethod}`,"success");workshopWorkflowSelectedId="";await renderWorkshopWorkflow();if(result?.draft_invoice?.id)await reviewWorkflowDraftInvoice(result.draft_invoice.id);}catch(error){showError(error);}}
async function workflowSecondaryDelete(id){const reason=await appPrompt(bi("Enter the operational cancellation or scrapping reason.","Add meg a megszakítás vagy selejtezés indokát."),{type:"warning"});if(!reason?.trim())return;if(!await appConfirm(bi("Remove this workflow from active operations? History and audit remain.","Kikerüljön ez a workflow az aktív működésből? Az előzmény és audit megmarad."),{type:"warning"}))return;try{await api(`/api/workflows/${id}/secondary-delete`,{method:"POST",body:JSON.stringify({reason})});workshopWorkflowSelectedId="";showToast(bi("Workflow operationally closed.","A workflow operatívan lezárva."),"success");await renderWorkshopWorkflow();}catch(error){showError(error);}}
async function workflowSuperDelete(id){if(!isSuperadmin())return showError("PERMISSION_DENIED");const confirmed=await appConfirm(bi("Are you sure you want to permanently delete this workflow and all related phases?","Biztosan véglegesen törölni szeretnéd ezt a workflow-t és a hozzá kapcsolódó fázisokat?"),{type:"error",confirmText:bi("Delete Workflow","Workflow Törlése")});if(!confirmed)return;try{await api(`/api/workflows/${id}`,{method:"DELETE",body:JSON.stringify({reason:"SUPERADMIN_CONFIRMED_HARD_DELETE"})});workshopWorkflowSelectedId="";workshopWorkflowSelectedStageId="";showToast(bi("Workflow permanently deleted.","A workflow véglegesen törölve."),"success");await renderWorkshopWorkflow();}catch(error){showError(error);}}
async function workflowPurgeAll(){if(!isSuperadmin())return showError("PERMISSION_DENIED");const first=await appConfirm(bi("WARNING: This permanently deletes ALL active and completed workshop workflows. Continue?","FIGYELEM: Ez a művelet véglegesen törli az ÖSSZES folyamatban lévő és lezárt műhely-workflow-t! Folytatod?"),{type:"error",confirmText:bi("Continue","Folytatás")});if(!first)return;const phrase="DELETE ALL WORKFLOWS";const typed=await appPrompt(`${bi("Type the confirmation phrase to continue","A folytatáshoz írd be a megerősítő kifejezést")}: ${phrase}`,{type:"error",confirmText:bi("Purge All Workflows","Összes Workflow Törlése")});if(String(typed||"").trim()!==phrase)return showError(bi("Confirmation phrase did not match.","A megerősítő kifejezés nem egyezett."));try{const result=await api("/api/workflows/purge-all",{method:"POST",body:JSON.stringify({confirmation:phrase})});workshopWorkflowSelectedId="";workshopWorkflowSelectedStageId="";workshopWorkflowPrevious=false;showToast(`${bi("All workflows deleted.","Minden workflow törölve.")} ${Number(result.deleted_workflows||0)}`,"success");await renderWorkshopWorkflow();}catch(error){showError(error);}}
async function workflowHandleNextStageActivation(workflowId,activation){
 if(!activation)return;
 const nextStage=activation.stage;
 if(activation.mode!=="CONFIRM"||!nextStage)return;
 if(!activation.current_assignee_id){
   workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=nextStage.id;
   showToast(bi("The next phase is ready. Assign a responsible person before starting it.","A következő fázis készen áll. Indítás előtt adj meg felelőst."),"warning");
   await renderWorkshopWorkflow();
   return;
 }
 const keepResponsible=await appConfirm(`${bi("The next phase is ready:","A következő fázis készen áll:")} ${workflowStageLabel(nextStage)}. ${bi("Should the current responsible person continue?","Folytassa a jelenlegi felelős?")}`,{type:"warning",confirmText:bi("Yes, continue","Igen, folytassa")});
 if(!keepResponsible){
   workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=nextStage.id;
   showToast(bi("Assign the next responsible person in the phase panel.","A következő felelőst a fázis részletezőjében adhatod meg."),"warning");
   await renderWorkshopWorkflow();
   return;
 }
 try{
  await api(`/api/workflows/${workflowId}/stages/${nextStage.id}/activate`,{method:"POST",body:JSON.stringify({start_now:true,assigned_user_id:activation.current_assignee_id})});
  showToast(bi("Next phase activated.","A következő fázis aktiválva."),"success");
  workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=nextStage.id;
  await renderWorkshopWorkflow();
 }catch(error){showError(error);}
}
function workflowOpenNextStageDialog(workflowId,activation){
 return new Promise(resolve=>{
  const nextStage=activation?.stage;
  if(!nextStage)return resolve(null);
  const inheritedId=String(activation.inherited_assignee_id||"");
  const defaultAssignee=String(activation.current_assignee_id||inheritedId||"");
  const canEditDue=isAdmin()||(user?.role==="MANAGER"&&nextStage.stage_order<6);
  const overlay=document.createElement("div");
  overlay.className="workflow-next-stage-modal";
  overlay.innerHTML=`<section class="workflow-next-stage-card" role="dialog" aria-modal="true" aria-labelledby="workflowNextStageTitle"><header><div><p class="event-kicker">${bi("Next active phase","Következő aktív fázis")}</p><h2 id="workflowNextStageTitle">${htmlText(workflowStageLabel(nextStage))}</h2><p>${bi("The phase is ready to start.","A fázis készen áll az indításra.")}</p></div><button type="button" class="workflow-next-stage-close" data-workflow-next-cancel aria-label="${bi("Cancel","Mégse")}">×</button></header><div class="workflow-next-stage-body"><label>${bi("Responsible","Felelős")}<select data-workflow-next-assignee>${workflowWorkerOptions(defaultAssignee)}</select></label><label>${bi("Phase deadline","Fázishatáridő")}${compactDateTimeControlMarkup(`workflowNextDue_${nextStage.id}`,"",nextStage.due_at||"",{defaultTime:"10:00",allowEmpty:true,disabled:!canEditDue,dataAttr:"data-workflow-next-due"})}</label><p class="workflow-next-stage-hint">${inheritedId?bi("The previous phase responsible is selected by default. Choose another person only if the work is being handed over.","Az előző fázis felelőse alapértelmezetten ki van választva. Csak átadás esetén válassz másik személyt."):bi("Select the person who will start this phase.","Válaszd ki a fázist megkezdő felelőst.")}</p><p class="workflow-next-stage-error" data-workflow-next-error role="alert"></p></div><footer><button type="button" class="ghost-btn" data-workflow-next-cancel>${bi("Cancel","Mégse")}</button><button type="button" class="workflow-next-stage-confirm" data-workflow-next-confirm>${bi("Activate phase","Fázis aktiválása")}</button></footer></section>`;
  const finish=value=>{
   document.removeEventListener("keydown",onKeyDown,true);
   overlay.classList.remove("is-visible");
   setTimeout(()=>overlay.remove(),180);
   resolve(value);
  };
  const onKeyDown=event=>{if(event.key==="Escape"){event.preventDefault();finish(null);}};
  overlay.querySelectorAll("[data-workflow-next-cancel]").forEach(button=>button.addEventListener("click",()=>finish(null)));
  overlay.addEventListener("click",event=>{if(event.target===overlay)finish(null);});
  overlay.querySelector("[data-workflow-next-confirm]")?.addEventListener("click",()=>{
   const assignedUserId=overlay.querySelector("[data-workflow-next-assignee]")?.value||"",error=overlay.querySelector("[data-workflow-next-error]");
   if(!assignedUserId){if(error)error.textContent=bi("Select a responsible person before activation.","Az aktiválás előtt válassz felelőst.");return;}
   finish({assignedUserId,dueAt:canEditDue?overlay.querySelector("[data-workflow-next-due]")?.value||"":""});
  });
  document.addEventListener("keydown",onKeyDown,true);
  document.body.appendChild(overlay);
  bindJobDateTimePicker(`workflowNextDue_${nextStage.id}`);
  requestAnimationFrame(()=>overlay.classList.add("is-visible"));
  setTimeout(()=>overlay.querySelector("[data-workflow-next-assignee]")?.focus(),30);
 });
}
async function workflowHandleNextStageActivation(workflowId,activation){
 if(!activation||activation.mode!=="CONFIRM"||!activation.stage)return;
 const nextStage=activation.stage,selection=await workflowOpenNextStageDialog(workflowId,activation);
 workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=nextStage.id;
 if(!selection){await renderWorkshopWorkflow();return;}
 const inheritedId=String(activation.inherited_assignee_id||""),existingId=String(nextStage.assigned_user_id||""),selectedId=String(selection.assignedUserId||"");
 const baselineId=existingId||inheritedId,hasManualChange=Boolean(baselineId&&selectedId!==baselineId);
 let reason="";
 if(hasManualChange){
  const entered=await appPrompt(bi("Why is the next phase being assigned to another person?","Miért kerül a következő fázis másik személyhez?"),{type:"warning"});
  if(!entered?.trim()){await renderWorkshopWorkflow();return;}
  reason=entered.trim();
 }
 const body={start_now:true,assigned_user_id:selectedId};
 if(!existingId&&inheritedId&&selectedId===inheritedId){body.assignment_mode="INHERIT_PREVIOUS";body.source_stage_id=activation.source_stage_id;}
 else if(existingId&&selectedId===existingId)body.assignment_mode="KEEP_EXISTING";
 else body.assignment_mode="MANUAL";
 if(reason)body.reason=reason;
 if(selection.dueAt)body.due_at=selection.dueAt;
 try{
  await api(`/api/workflows/${workflowId}/stages/${nextStage.id}/activate`,{method:"POST",body:JSON.stringify(body)});
  showToast(bi("Next phase activated.","A következő fázis aktiválva."),"success");
  await renderWorkshopWorkflow();
 }catch(error){showError(error);}
}
async function workflowSaveStage(workflowId,stageId){
 try{
  const workflow=workshopWorkflowRows.find(row=>String(row.id)===String(workflowId)),stage=workflow?.stages?.find(item=>String(item.id)===String(stageId));
  const dueInput=$(`#workflowDue_${stageId}`),assignedUserId=$(`#workflowAssignee_${stageId}`)?.value||"",body={status:$(`#workflowStatus_${stageId}`)?.value,card_title:$(`#workflowCardTitle_${stageId}`)?.value.trim(),notes:$(`#workflowNotes_${stageId}`)?.value||"",due_at:dueInput&&!dueInput.disabled?dueInput.value||undefined:undefined,assigned_user_id:assignedUserId||undefined};
  if(stage&&assignedUserId&&String(assignedUserId)!==String(stage.assigned_user_id||"")){
   const reason=await appPrompt(bi("Why is this phase being transferred?","Miért kerül átadásra ez a fázis?"),{type:"warning"});
   if(!reason?.trim())return;
   body.reassignment_reason=reason.trim();
  }
  const response=await api(`/api/workflows/${workflowId}/stages/${stageId}`,{method:"PATCH",body:JSON.stringify(body)});
  showToast(bi("Phase saved.","A fázis mentve."),"success");
  await workflowHandleNextStageActivation(workflowId,response.next_stage_activation);
  if(!response.next_stage_activation){workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=stageId;await renderWorkshopWorkflow();}
 }catch(error){showError(error);}
}
async function workflowTransferStage(workflowId,stageId){
 const toUser=$(`#workflowAssignee_${stageId}`)?.value||"";
 if(!toUser)return showError({message:bi("Select a responsible person first.","Előbb válassz felelőst.")});
 const reason=await appPrompt(bi("Why is this phase being transferred?","Miért kerül átadásra ez a fázis?"),{type:"warning"});
 if(!reason?.trim())return;
 try{await api(`/api/workflows/${workflowId}/stages/${stageId}/transfer`,{method:"POST",body:JSON.stringify({to_user_id:toUser,reason:reason.trim()})});showToast(bi("Phase transferred.","A fázis átadva."),"success");workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=stageId;await renderWorkshopWorkflow();}catch(error){showError(error);}
}
async function workflowActivateStage(workflowId,stageId){
 const workflow=workshopWorkflowRows.find(row=>String(row.id)===String(workflowId)),stage=workflow?.stages?.find(item=>String(item.id)===String(stageId));
 if(!stage)return;
 const activate=await appConfirm(`${bi("Add this phase to the active workflow?","Felvedded ezt a fázist az aktív workflow-ba?")} ${workflowStageLabel(stage)}`,{type:"warning",confirmText:bi("Activate phase","Fázis aktiválása")});
 if(!activate)return;
 const assignedUserId=$(`#workflowAssignee_${stageId}`)?.value||stage.assigned_user_id||undefined,dueInput=$(`#workflowDue_${stageId}`),body={assigned_user_id:assignedUserId,start_now:false};
 if(dueInput&&!dueInput.disabled&&dueInput.value)body.due_at=dueInput.value;
 try{await api(`/api/workflows/${workflowId}/stages/${stageId}/activate`,{method:"POST",body:JSON.stringify(body)});showToast(bi("Phase activated.","A fázis aktiválva."),"success");workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=stageId;await renderWorkshopWorkflow();}catch(error){showError(error);}
}
async function workflowAbortStage(workflowId,stageId){
 const reason=await appPrompt(bi("Why is this phase being interrupted?","Miért szakad meg ez a fázis?"),{type:"warning"});
 if(!reason?.trim())return;
 try{await api(`/api/workflows/${workflowId}/stages/${stageId}/abort`,{method:"POST",body:JSON.stringify({reason:reason.trim()})});showToast(bi("Phase interrupted.","A fázis megszakítva."),"success");workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=stageId;await renderWorkshopWorkflow();}catch(error){showError(error);}
}
async function workflowAddFinancialLine(workflowId,stageId=""){
 const title=$("#workflowFinanceTitle")?.value.trim(),amount=parseFinancialNumber($("#workflowFinanceAmount")?.value||0),category=$("#workflowFinanceCategory")?.value||"OTHER",billing_status=$("#workflowFinanceBillingStatus")?.value||"CHARGEABLE",partner_id=$("#workflowFinancePartner")?.value||"";
 if(!title||!Number.isFinite(amount)||amount<0)return showError({message:bi("Description and Unit Price USD are required.","A megnevezés és a Unit Price USD kötelező.")});
 try{const created=await api(`/api/workflows/${workflowId}/financial-lines`,{method:"POST",body:JSON.stringify({stage_id:stageId||undefined,title,description:title,unit_price:amount,amount,category,billing_status,partner_id:partner_id||undefined})});showToast(created?.line?.payable_invoice_number?`${bi("Phase cost added and partner bill created.","A fázisköltség és a partneri VND bizonylat létrejött.")} · ${created.line.payable_invoice_number}`:bi("Phase cost added.","A fázisköltség hozzáadva."),"success");workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=stageId||"__workflow__";await renderWorkshopWorkflow();}catch(error){showError(error);}
}
async function workflowEditFinancialLine(workflowId,lineId){
 const workflow=workshopWorkflowRows.find(row=>String(row.id)===String(workflowId)),line=workflow?.financial_lines?.find(item=>String(item.id)===String(lineId));
 if(!line)return;
 const title=await appPrompt(bi("Financial line title","Pénzügyi tétel neve"),{initialValue:line.title});
 if(title===null||!title.trim())return;
 const amount=await appPrompt(bi("Financial line amount","Pénzügyi tétel összege"),{inputType:"number",initialValue:String(line.amount||0)});
 if(amount===null||amount.trim()===""||Number(amount)<0)return;
 try{await api(`/api/workflows/${workflowId}/financial-lines/${lineId}`,{method:"PATCH",body:JSON.stringify({title:title.trim(),amount:Number(amount)})});showToast(bi("Financial line updated.","A pénzügyi tétel módosítva."),"success");workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=line.stage_id||"__workflow__";await renderWorkshopWorkflow();}catch(error){showError(error);}
}
async function workflowCloseStageFinance(workflowId,stageId){
 const reason=await appPrompt(bi("Optional phase finance closure note","Opcionális fázis-pénzügyi lezárási megjegyzés"),{initialValue:""});
 if(reason===null)return;
 try{await api(`/api/workflows/${workflowId}/stages/${stageId}/financial-close`,{method:"POST",body:JSON.stringify({reason:reason.trim()})});showToast(bi("Phase finances closed.","A fázis pénzügyei lezárva."),"success");workshopWorkflowSelectedId=workflowId;workshopWorkflowSelectedStageId=stageId;await renderWorkshopWorkflow();}catch(error){showError(error);}
}
async function openWorkflowStageSettingsBase(){if(!isAdmin())return;const rows=await api("/api/workflow/stage-definitions");$("#modal").classList.remove("hidden");$("#modalTitle").textContent=bi("Workflow stage settings","Workflow fázisbeállítások");$("#form").innerHTML=`<form id="workflowStageSettingsForm">${rows.stages.map(stage=>`<div class="workflow-config-row"><input type="hidden" name="code" value="${htmlText(stage.code)}"><label>${bi("English name","Angol név")}<input name="name_en" value="${htmlText(stage.name_en)}"></label><label>${bi("Hungarian name","Magyar név")}<input name="name_hu" value="${htmlText(stage.name_hu)}"></label><label>${bi("Order","Sorrend")}<input name="sort_order" type="number" min="0" value="${Number(stage.sort_order)}"></label><label><input name="active" type="checkbox" ${stage.active!==0?"checked":""}> ${bi("Active","Aktív")}</label></div>`).join("")}<div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Cancel","Mégse")}</button><button type="button" onclick="saveWorkflowStageSettings()">${bi("Save settings","Beállítások mentése")}</button></div></form>`;}
async function openWorkflowStageSettings(){await openWorkflowStageSettingsBase();const form=$("#workflowStageSettingsForm"),actions=form?.querySelector(".actions");if(!form||!actions)return;const add=document.createElement("button");add.type="button";add.className="small ghost-btn";add.textContent=bi("Add phase","Fázis hozzáadása");add.onclick=()=>{const row=document.createElement("div");row.className="workflow-config-row";row.innerHTML=`<label>${bi("Code","Kód")}<input name="code" required placeholder="CUSTOM_PHASE"></label><label>${bi("English name","Angol név")}<input name="name_en" required></label><label>${bi("Hungarian name","Magyar név")}<input name="name_hu" required></label><label>${bi("Order","Sorrend")}<input name="sort_order" type="number" min="0" value="${form.querySelectorAll(".workflow-config-row").length}"></label><label><input name="active" type="checkbox" checked> ${bi("Active","Aktív")}</label>`;form.insertBefore(row,actions);};actions.insertBefore(add,actions.firstChild);}
async function saveWorkflowStageSettings(){const rows=[...document.querySelectorAll("#workflowStageSettingsForm .workflow-config-row")].map(row=>({code:row.querySelector('[name="code"]').value,name_en:row.querySelector('[name="name_en"]').value,name_hu:row.querySelector('[name="name_hu"]').value,sort_order:Number(row.querySelector('[name="sort_order"]').value),active:row.querySelector('[name="active"]').checked}));try{await api("/api/workflow/stage-definitions",{method:"PUT",body:JSON.stringify({stages:rows})});closeModal();showToast(bi("Stage settings saved.","A fázisbeállítások mentve."),"success");await renderWorkshopWorkflow();}catch(error){showError(error);}}

/* Reference drawer pass: one selected phase, one readable source of truth. */
function workflowPhasePianoContextMarkup(workflow){
 const piano=workflowPianoLabel(workflow)||workflowSafeText(workflow?.piano_display_name)||workflowSafeText(workflow?.piano_id,bi("Unknown piano","Ismeretlen hangszer"));
 const serial=workflow.serial_no?`#${workflow.serial_no}`:"";
 return `<section class="workflow-drawer-piano-context"><div class="workflow-drawer-piano-visual" aria-hidden="true"><span>♬</span></div><div><strong>${htmlText(piano)} ${htmlText(serial)}</strong><p>◉ ${bi("Owner","Tulajdonos")}: <b>${htmlText(sanitizeSafeText(workflow.client_name,"—"))}</b></p><p>${bi("Client","Ügyfél")}: <b>${htmlText(sanitizeSafeText(workflow.client_name,"—"))}</b></p></div></section>`;
}
function workflowPhaseDrawerMarkup(workflow,stage){
 const effective=workflowEffectiveStatus(stage);
 const canEditDue=isAdmin();
 const stageLines=(workflow.financial_lines||[]).filter(line=>String(line.stage_id||"")===String(stage.id)&&line.line_type==="COST");
 const phaseSubtotal=roundFinancial(stageLines.reduce((sum,line)=>{const status=String(line.billing_status||"CHARGEABLE").toUpperCase();const amount=Number(line.amount||0);if(status==="CHARGEABLE")return sum+amount;if(status==="CREDIT")return sum-amount;return sum;},0));
 const nextStage=(workflow.stages||[]).find(item=>item.stage_order>stage.stage_order&&item.status!=="NOT_REQUIRED");
 const activeStages=(workflow.stages||[]).filter(item=>item.status!=="NOT_REQUIRED");
 const finalReady=isAdmin()&&activeStages.length>0&&activeStages.every(item=>["COMPLETED","ABORTED"].includes(item.status));
 const statusOptions=["WAITING","IN_PROGRESS","COMPLETED","BLOCKED"].map(status=>`<option value="${status}" ${status===stage.status?"selected":""}>${htmlText(workflowStatusLabel(status))}</option>`).join("");
 const nextPhase=nextStage?`<select class="workflow-readonly-select" disabled><option>${htmlText(workflowStageLabel(nextStage))}</option></select><small>${nextStage.assigned_to?htmlText(nextStage.assigned_to):bi("Responsible not assigned","Nincs felelős kijelölve")}${nextStage.due_at?` · ${htmlText(workflowCardDateTimeText(nextStage.due_at))}`:""}</small>`:`<p class="muted">${bi("No further active phase.","Nincs további aktív fázis.")}</p>`;
 const financialLines=stageLines.length?stageLines.map(line=>workflowFinancialLineMarkup(line,workflow.id)).join(""):`<p class="muted">${bi("No phase financial lines yet.","Ehhez a fázishoz még nincs pénzügyi tétel.")}</p>`;
 const eventLog=`<section class="workflow-detail-block workflow-event-log-block"><div class="workflow-block-head"><h3>${bi("Event log","Eseménynapló")}</h3><button type="button" class="workflow-text-link" data-workflow-event-log-trigger data-workflow-id="${htmlText(workflow.id)}">${bi("Show all","Összes megjelenítése")} <span aria-hidden="true">↗</span></button></div>${workflowEventLogMarkup(stage,3)}</section>`;
 return `${workflowPhasePianoContextMarkup(workflow)}<div class="workflow-phase-fields-grid"><label>${bi("Current phase","Aktuális fázis")}<select class="workflow-readonly-select" disabled><option>${Number(stage.stage_order)+1}. ${htmlText(workflowStageLabel(stage))}</option></select></label><label>${bi("Status","Státusz")}<select id="workflowStatus_${htmlText(stage.id)}">${statusOptions}</select></label><label>${bi("Responsible worker","Felelős munkatárs")}<select id="workflowAssignee_${htmlText(stage.id)}">${workflowWorkerOptions(stage.assigned_user_id||"")}</select></label><label>${bi("Deadline","Határidő")}${compactDateTimeControlMarkup(`workflowDue_${stage.id}`,"",stage.due_at||"",{defaultTime:"10:00",allowEmpty:true,disabled:stage.stage_code==="FINAL_HANDOVER"||!canEditDue})}</label></div><label class="workflow-phase-detail-field">${bi("Short description","Rövid leírás")}<textarea id="workflowDetails_${htmlText(stage.id)}" rows="3" readonly aria-readonly="true" placeholder="${bi("No short description recorded.","Nincs rögzített rövid leírás.")}">${htmlText(stage.details||"")}</textarea></label><label class="workflow-phase-detail-field">${bi("Notes","Megjegyzések")}<textarea id="workflowNotes_${htmlText(stage.id)}" rows="3" placeholder="${bi("Card notes shown by the bell icon…","A harang ikonnál megjelenő kártyamegjegyzés…")}">${htmlText(stage.notes||"")}</textarea></label>${workflowPlannedJobsEnabled()&&stage.stage_code==="INBOUND"&&stage.preliminary_inspection?`<div class="workflow-prelim-grid"><span>${bi("Preliminary view","Előzetes megtekintés")}: ${htmlText(stage.preliminary_inspection)}</span><span>${bi("Preliminary assessment","Előzetes állapotfelmérés")}: ${htmlText(stage.preliminary_assessment)}</span><span>${bi("Preliminary quote","Előzetes árajánlat")}: ${htmlText(stage.preliminary_quote)}</span><span>${bi("Preliminary meeting","Előzetes megbeszélés")}: ${htmlText(stage.preliminary_meeting)}</span></div>`:""}<div class="workflow-phase-split"><section><h3>${bi("Phase subtotal","Fázis részösszeg")}</h3><strong class="workflow-material-status">${money(phaseSubtotal)}</strong><p>${bi("Manual phase costs only; no inventory or quantity link.","Csak manuális fázisköltségek; nincs leltár- vagy mennyiségkapcsolat.")}</p></section><section><h3>${bi("Pass to next phase","Továbbadás következő fázisba")}</h3>${nextPhase}<textarea class="workflow-next-phase-note" rows="2" placeholder="${bi("Required note for handover…","Írd be az átadás okát…")}"></textarea></section></div>${eventLog}<details class="workflow-drawer-disclosure"><summary>${bi("Phase costs","Fázisköltségek")} <span>${stage.financial_status==="CLOSED"?bi("Closed","Lezárva"):bi("Open","Nyitva")}</span></summary><div class="workflow-inline-form workflow-phase-cost-form"><input id="workflowFinanceTitle" placeholder="${bi("Description","Megnevezés")}"><input id="workflowFinanceAmount" type="text" inputmode="decimal" value="" placeholder="${bi("Unit Price USD","Unit Price USD")}"><select id="workflowFinanceCategory"><option value="OTHER">${bi("Internal / Other","Belső / Egyéb")}</option><option value="MATERIAL">${bi("Material","Anyag")}</option><option value="TRANSPORT">${bi("Transport","Szállítás")}</option><option value="CONTRACTOR">${bi("Subcontractor","Alvállalkozó")}</option></select><select id="workflowFinanceBillingStatus"><option value="CHARGEABLE">CHARGEABLE</option><option value="WARRANTY">WARRANTY</option><option value="FREE">FREE</option><option value="CREDIT">CREDIT</option></select><select id="workflowFinancePartner"><option value="">${bi("No external partner","Nincs külső partner")}</option>${workshopWorkflowPartners.map(partner=>`<option value="${htmlText(partner.id)}">${htmlText(partner.company_name)}</option>`).join("")}</select><button type="button" class="small" onclick="workflowAddFinancialLine('${htmlText(workflow.id)}','${htmlText(stage.id)}')">+ ${bi("Add cost","Költség hozzáadása")}</button></div><div class="workflow-line-list">${financialLines}</div>${isAdmin()&&stage.financial_status!=="CLOSED"&&["COMPLETED","ABORTED"].includes(stage.status)?`<button type="button" class="small" onclick="workflowCloseStageFinance('${htmlText(workflow.id)}','${htmlText(stage.id)}')">${bi("Close phase finances","Fázis pénzügyi lezárása")}</button>`:""}</details><div class="workflow-phase-secondary-actions">${!["COMPLETED","NOT_REQUIRED","ABORTED"].includes(stage.status)?`<button type="button" class="ghost-btn small" onclick="workflowAbortStage('${htmlText(stage.workflow_id)}','${htmlText(stage.id)}')">${bi("Interrupt phase","Fázis megszakítása")}</button>`:""}${stage.status==="NOT_REQUIRED"?`<button type="button" class="ghost-btn small" onclick="workflowActivateStage('${htmlText(stage.workflow_id)}','${htmlText(stage.id)}')">${bi("Activate phase","Fázis aktiválása")}</button>`:""}</div><div class="workflow-drawer-actions workflow-phase-actions"><button type="button" class="ghost-btn" onclick="workflowSaveStage('${htmlText(stage.workflow_id)}','${htmlText(stage.id)}')">${bi("Save","Mentés")}</button><button type="button" class="workflow-transfer-btn" onclick="workflowTransferStage('${htmlText(stage.workflow_id)}','${htmlText(stage.id)}')">${bi("Transfer","Átadás")}</button><button type="button" class="workflow-complete-btn" onclick="workflowCompleteStage('${htmlText(stage.workflow_id)}','${htmlText(stage.id)}')" ${stage.status==="COMPLETED"?"disabled":""}>${bi("Close","Lezárás")}</button></div><section class="workflow-final-closure ${finalReady?"is-ready":"is-locked"}"><div><span class="workflow-final-lock" aria-hidden="true">${finalReady?"✓":"▣"}</span><div><h3>${bi("Final closure","Végleges lezárás")}</h3><p>${finalReady?bi("All active phases are complete. Open phase finances will be auto-closed in one transaction.","Minden aktív fázis kész. A nyitott fázispénzügyek egy tranzakcióban automatikusan lezáródnak."):bi("Final closure is available after all active phases are completed.","A végleges lezárás minden aktív fázis befejezése után érhető el.")}</p></div></div><button type="button" class="workflow-final-close-btn" onclick="workflowFinalize('${htmlText(workflow.id)}')" ${finalReady?"":"disabled"}>${bi("Finalise","Végleges lezárás")}</button></section>`;
}
async function workflowCompleteStage(workflowId,stageId){const statusInput=$(`#workflowStatus_${stageId}`);if(statusInput)statusInput.value="COMPLETED";await workflowSaveStage(workflowId,stageId);}
function workflowDateMove(days){workshopWorkflowDate=addDaysToDateKey(workshopWorkflowDate,days);renderWorkshopWorkflow();}
function workflowMatchesBoardFilters(workflow){
 const stages=workflow.stages||[];
 const assigneeMatches=workshopWorkflowAssigneeFilter==="ALL"||stages.some(stage=>String(stage.assigned_user_id||"")===String(workshopWorkflowAssigneeFilter));
 const statusMatches=workshopWorkflowStatusFilter==="ALL"||stages.some(stage=>workflowEffectiveStatus(stage)===workshopWorkflowStatusFilter);
 const overdueMatches=!workshopWorkflowOverdueOnly||Boolean(workflow.is_overdue||stages.some(stage=>stage.is_overdue));
 return assigneeMatches&&statusMatches&&overdueMatches;
}
function workflowFilterWorkerOptions(){return `<option value="ALL">${bi("All","Összes")}</option>${workshopWorkflowWorkers.map(worker=>`<option value="${htmlText(worker.id)}" ${String(workshopWorkflowAssigneeFilter)===String(worker.id)?"selected":""}>${htmlText(worker.name)}</option>`).join("")}`;}
function workflowFilterStatusOptions(){return `<option value="ALL">${bi("All","Összes")}</option>${[["ASSIGNED","Assigned","Kiosztva"],["IN_PROGRESS","In progress","Folyamatban"],["COMPLETED","Completed","Kész"],["OVERDUE","Overdue","Lejárt"],["WAITING","Waiting","Várakozik"],["BLOCKED","Blocked","Blokkolva"]].map(([value,en,hu])=>`<option value="${value}" ${workshopWorkflowStatusFilter===value?"selected":""}>${bi(en,hu)}</option>`).join("")}`;}
function workflowEnsurePhaseCardTitleField(workflow){
 const stageId=String(workshopWorkflowSelectedStageId||"");
 if(!workflow||!stageId||stageId==="__workflow__")return;
 const stage=(workflow.stages||[]).find(item=>String(item.id)===stageId),grid=document.querySelector(".workflow-phase-fields-grid");
 if(!stage||!grid||grid.querySelector("[data-workflow-card-title]"))return;
 const label=document.createElement("label");label.dataset.workflowCardTitle="true";label.append(document.createTextNode(bi("Card title","Egyedi kártyacím")));
 const input=document.createElement("input");input.id=`workflowCardTitle_${stage.id}`;input.maxLength=240;input.value=stage.card_title||"";input.placeholder=bi("Optional title","Opcionális cím");label.append(input);grid.append(label);
}
function workshopOpenCalendar(){currentSchedulerEntryFilter="ALL";currentWeekStart=startOfWeek(workshopWorkflowDate);render("scheduler",{navigationActivate:true});}
function workshopToggleArchived(){workshopWorkflowPrevious=!workshopWorkflowPrevious;workshopWorkflowSelectedId="";workshopWorkflowSelectedStageId="";renderWorkshopWorkflow();}
async function renderWorkshopWorkflow(){
 const box=ensureView("workshop_workflow");
 try{
  const [workflowPayload,definitionPayload,workers,partners]=await Promise.all([api(`/api/workflows?include_closed=1&status=${workshopWorkflowPrevious?"COMPLETED":"ACTIVE"}`),api("/api/workflow/stage-definitions"),loadSchedulerWorkers(),api("/api/workflows-partners/options").catch(()=>[])]);
  workshopWorkflowRows=workflowPayload.workflows||[];workshopWorkflowDefinitions=definitionPayload.stages||[];workshopWorkflowWorkers=workers||[];workshopWorkflowPartners=partners||[];
  if(workshopWorkflowSelectedId&&!workshopWorkflowRows.some(row=>String(row.id)===String(workshopWorkflowSelectedId))){workshopWorkflowSelectedId="";workshopWorkflowSelectedStageId="";}
  const visibleRows=workshopWorkflowRows.filter(workflowMatchesBoardFilters),selected=workshopWorkflowRows.find(row=>String(row.id)===String(workshopWorkflowSelectedId));
  const stageDefinitions=workshopWorkflowDefinitions.filter(stage=>stage.active!==0).sort((a,b)=>a.sort_order-b.sort_order);
  const stageHead=stageDefinitions.map(stage=>`<span class="workflow-stage-heading"><strong>${Number(stage.sort_order)+1}.</strong><b>${htmlText(currentLang==="hu"?stage.name_hu:stage.name_en)}</b></span>`).join("");
  const board=visibleRows.map(workflowBoardRow).join("");
  const emptyBoard=`<div class="workflow-empty"><strong>${bi("No workflows in this view.","Ebben a nézetben nincs workflow.")}</strong><p>${bi("Create the first workshop workflow from a client piano.","Hozd létre az első műhely-workflow-t egy ügyfélzongorához.")}</p></div>`;
  box.innerHTML=`<div class="workflow-shell${selected?" has-workflow-drawer":""}"><section class="panel workflow-board-panel"><header class="workflow-toolbar"><div class="workflow-toolbar-copy"><h2>${bi("Workshop Workflow","Műhely Workflow")}</h2><p>${bi("Quality. Heritage. Forward.","Minőség. Hagyomány. Tovább.")}</p></div><div class="workflow-toolbar-clock" aria-label="${bi("New York date and time","New York-i dátum és idő")}"><strong>${htmlText(workflowBoardDateLabel(workshopWorkflowDate))}</strong><span>New York (${htmlText(workflowNYZoneLabel())}) <time data-workflow-ny-clock>${htmlText(currentNYTimeString())}</time></span></div></header><div class="workflow-board-controls"><div class="workflow-day-actions"><div class="workflow-date-picker workflow-date-picker--primary" title="${bi("Choose reference date","Referencia dátum kiválasztása")}"><input class="workflow-date-text" type="text" inputmode="numeric" autocomplete="off" value="${formatAmericanDate(workshopWorkflowDate)}" placeholder="MM/DD/YYYY" aria-label="${bi("Reference date MM/DD/YYYY","Referencia dátum MM/DD/YYYY")}"><button type="button" class="workflow-date-picker-button" aria-label="${bi("Open calendar","Naptár megnyitása")}" aria-haspopup="dialog"><span class="workflow-date-picker-icon" aria-hidden="true">${workflowToolbarIcon("date")}</span></button><input class="workflow-date-input" type="hidden" value="${htmlText(workshopWorkflowDate)}" onchange="workshopWorkflowDate=this.value||nyDateKey();renderWorkshopWorkflow()"></div><button type="button" data-workflow-archive-toggle class="ghost-btn ${workshopWorkflowPrevious?"active-state-btn":""}" onclick="workshopToggleArchived()">▣ ${workshopWorkflowPrevious?bi("Back to current active works","Vissza a jelenlegi aktív munkákhoz"):bi("Previous works","Korábbi munkák")}</button><button type="button" data-workflow-open-calendar class="ghost-btn" onclick="workshopOpenCalendar()">▣ ${bi("Open calendar","Naptár megnyitása")}</button>${isAdmin()?`<button type="button" class="ghost-btn workflow-stage-settings" onclick="openWorkflowStageSettings()">⚙ ${bi("Stage settings","Fázisbeállítások")}</button>`:""}${isSuperadmin()?`<button type="button" class="danger-btn" onclick="workflowPurgeAll()">${bi("Purge All Workflows","Összes Workflow Törlése")}</button>`:""}</div><div class="workflow-board-filter-row"><label>${bi("Responsible","Felelős")}<select onchange="workshopWorkflowAssigneeFilter=this.value;renderWorkshopWorkflow()">${workflowFilterWorkerOptions()}</select></label><label>${bi("Status","Státusz")}<select onchange="workshopWorkflowStatusFilter=this.value;renderWorkshopWorkflow()">${workflowFilterStatusOptions()}</select></label><label class="workflow-overdue-toggle"><span>${bi("Overdue only","Csak lejárt")}</span><input type="checkbox" ${workshopWorkflowOverdueOnly?"checked":""} onchange="workshopWorkflowOverdueOnly=this.checked;renderWorkshopWorkflow()"><i aria-hidden="true"></i></label><button type="button" class="workflow-new-btn" onclick="openWorkflowCreate()">＋ ${bi("New workflow","Új munkafolyamat")}</button></div></div><div class="workflow-board-scroll"><div class="workflow-board-head"><div class="workflow-piano-heading">${bi("Pianos","Zongorák")}</div><div class="workflow-stage-head">${stageHead}</div></div>${board||emptyBoard}</div></section>${workflowDrawerMarkup(selected,workshopWorkflowSelectedStageId)}</div>`;
  decorateWorkflowToolbar(box);
  workflowBindDatePicker(box);
  bindJobDateTimePickers(box);
  box.querySelector(".workflow-shell")?.style.setProperty("--workflow-stage-count",String(Math.max(1,stageDefinitions.length)));
  box.querySelectorAll("[data-workflow-event-log-trigger]").forEach(button=>{button.onclick=()=>workflowShowFullEventLog(button.dataset.workflowId);});
  workflowEnsurePhaseCardTitleField(selected);
  updateNYClock();applyLanguageToDOM(box);
 }catch(error){box.innerHTML=`<div class="panel"><p class="danger-text">${htmlText(error.message||error)}</p></div>`;showError(error);}
}
function openWorkshopWorkflow(id,stageId="__workflow__"){
 const nextId=String(id||""),nextStage=String(stageId||"__workflow__"),workflow=workshopWorkflowRows.find(row=>String(row.id)===nextId),stage=workflow?.stages?.find(item=>String(item.id)===nextStage);
 if(stage?.status==="NOT_REQUIRED"){
  appConfirm(`${bi("Add this phase to the active workflow?","Felveszed ezt a fázist az aktív workflow-ba?")} ${workflowStageLabel(stage)}`,{type:"warning",confirmText:bi("Activate phase","Fázis aktiválása")}).then(confirmed=>{if(confirmed)workflowActivateStage(nextId,nextStage);});
  return;
 }
 if(workshopWorkflowSelectedId===nextId&&workshopWorkflowSelectedStageId===nextStage){closeWorkshopWorkflow();return;}
 workshopWorkflowSelectedId=nextId;workshopWorkflowSelectedStageId=nextStage;renderWorkshopWorkflow();
}
function initMobileAppShell(){
  const nav=document.getElementById("mobileBottomNav"); if(!nav)return;
  nav.querySelectorAll("[data-mobile-view]").forEach(btn=>btn.onclick=()=>render(btn.dataset.mobileView,{navigationActivate:true}));
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
  const jobs=await loadCalendarEntries(date,addDaysToDateKey(date,1)); const workers=await loadSchedulerWorkers();
  const dayStart=7*60, dayEnd=22*60, total=dayEnd-dayStart;
  const dailyJobs=filterJobsForScheduler(jobs).filter(j=>String(j.start_time||"").slice(0,10)===date);
  const layout=calendarLayout(dailyJobs,dayStart,dayEnd);
  const quarter=Array.from({length:(dayEnd-dayStart)/15+1},(_,i)=>{const min=dayStart+i*15;return `<i class="${min%60===0?'hour':''}" style="top:${((min-dayStart)/total)*100}%"></i>`}).join('');
  const times=Array.from({length:(dayEnd-dayStart)/60+1},(_,i)=>{const min=dayStart+i*60;return `<span style="top:${((min-dayStart)/total)*100}%">${String(Math.floor(min/60)).padStart(2,'0')}:00</span>`}).join('');
  const events=layout.map(x=>{const j=x.event,top=((x.start-dayStart)/total)*100,height=((x.end-x.start)/total)*100,left=(x.lane/x.lanes)*100,width=100/x.lanes;const colorStyle=calendarEventClass(j)==='WorkerColor'?`--event-color:${workerColor(j.assigned_to,j.assigned_calendar_color)};`:'';return `<button type="button" class="timeline-event ${calendarEventClass(j)}${calendarIntegrationClass(j)}${calendarEventDensityClass(j)}" style="${colorStyle}top:${top}%;height:${height}%;left:${left}%;width:calc(${width}% - 4px)" onclick='openCalendarEntry(${esc(j)})'>${calendarEventCardMarkup(j)}</button>`}).join('');
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
let schedulerDragState=null;
let schedulerPointerDrag=null;
let schedulerTouchDrag=null;
let schedulerSuppressClickUntil=0;
let schedulerWorkflowDrawerState=null;
function schedulerDragPayload(job){
 return {
  id:job.id||job.job_id,
  workflow_id:job.workflow_id||"",
  stage_id:job.stage_id||(["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(job.calendar_entry_type)?job.id:"")||"",
  calendar_entry_type:job.calendar_entry_type||"",
  start_time:job.start_time,
  end_time:job.end_time,
  assigned_user_id:job.assigned_user_id||"",
  assigned_to:job.assigned_to||"",
  stage_status:job.stage_status||job.status||""
 };
}
function schedulerEntryDurationMinutes(payload){
 const diff=wallClockDifferenceMinutes(payload?.start_time,payload?.end_time);
 if(["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(payload?.calendar_entry_type))return Math.max(SCHEDULE_INTERVAL_MINUTES,diff||60);
 return Math.max(SCHEDULE_INTERVAL_MINUTES,diff||SCHEDULE_INTERVAL_MINUTES);
}
function schedulerDragDateLabel(dateKey){
 try{
  const [year,month,day]=String(dateKey||"").split("-").map(Number);
  const date=new Date(Date.UTC(year,month-1,day,12));
  return new Intl.DateTimeFormat(currentLang==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(date);
 }catch(_error){return String(dateKey||"");}
}
function schedulerDurationLabel(minutes){
 const safe=Math.max(0,Math.round(Number(minutes)||0)),hours=Math.floor(safe/60),mins=safe%60;
 if(currentLang==="hu")return `${hours} óra ${String(mins).padStart(2,"0")} perc`;
 return `${hours} ${hours===1?"hour":"hours"} ${String(mins).padStart(2,"0")} min`;
}
function ensureSchedulerDragHud(){
 let hud=document.getElementById("schedulerDragHud");
 if(!hud){hud=document.createElement("div");hud.id="schedulerDragHud";hud.className="scheduler-drag-hud";hud.setAttribute("role","status");hud.setAttribute("aria-live","polite");document.body.appendChild(hud);}
 return hud;
}
function updateSchedulerDragHud(target){
 const hud=ensureSchedulerDragHud();
 if(!target){hud.classList.remove("is-visible");return;}
 const duration=schedulerEntryDurationMinutes((schedulerPointerDrag||schedulerTouchDrag)?.payload);
 const start=dateTimeFromDateAndMinutes(target.date,target.minutes),end=addWallClockMinutes(start,duration);
 hud.innerHTML=`<strong>${htmlText(schedulerDragDateLabel(target.date))}</strong><span>${htmlText(time12Label(start.slice(11,16)))} – ${htmlText(time12Label(end.slice(11,16)))}</span><small>${htmlText(schedulerDurationLabel(duration))}</small>`;
 hud.classList.add("is-visible");
}
function schedulerTargetFromPoint(clientX,clientY,dragState=schedulerPointerDrag){
 const elements=document.elementsFromPoint(clientX,clientY);
 const workerTarget=elements.map(el=>el.closest?.(".scheduler-worker-drop")).find(Boolean);
 if(workerTarget)return {workerId:String(workerTarget.dataset.workerId||""),workerTarget};
 const day=elements.map(el=>el.closest?.(".timeline-day")).find(Boolean);
 if(!day)return null;
 const rect=day.getBoundingClientRect(),dayStart=Number(day.dataset.dayStart||420),dayEnd=Number(day.dataset.dayEnd||1320),span=dayEnd-dayStart;
 const cardTopY=clientY-Number(dragState?.grabOffsetY||0);
 const raw=dayStart+((cardTopY-rect.top)/Math.max(1,rect.height))*span;
 const duration=schedulerEntryDurationMinutes(dragState?.payload);
 const latest=Math.max(dayStart,dayEnd-Math.min(duration,dayEnd-dayStart));
 const minutes=Math.max(dayStart,Math.min(latest,Math.round(raw/SCHEDULE_INTERVAL_MINUTES)*SCHEDULE_INTERVAL_MINUTES));
 return {date:String(day.dataset.date||""),minutes,day,rect};
}
function positionSchedulerDragGhost(state,clientX,clientY){
 if(!state?.ghost)return;
 state.lastClientX=clientX;state.lastClientY=clientY;if(state.rafId)return;
 state.rafId=requestAnimationFrame(()=>{state.rafId=0;if(!state.ghost)return;state.ghost.style.transform=`translate3d(${Math.round(state.lastClientX-state.startX)}px,${Math.round(state.lastClientY-state.startY)}px,0)`;});
}
function schedulerAutoScroll(clientX,clientY){
 const scroll=document.querySelector(".timeline-scroll");if(!scroll)return;
 const rect=scroll.getBoundingClientRect(),edge=58,speed=18;
 if(clientX<rect.left+edge)scroll.scrollLeft-=speed;else if(clientX>rect.right-edge)scroll.scrollLeft+=speed;
 if(clientY<rect.top+edge)scroll.scrollTop-=speed;else if(clientY>rect.bottom-edge)scroll.scrollTop+=speed;
}
function beginSchedulerPointerDrag(event,job){
 if(event.pointerType==="touch")return;
 if(event.button!==undefined&&event.button!==0)return;
 if(event.target.closest(".timeline-resize-handle"))return;
 if(!isMovableSchedulerEntry(job))return;
 const card=event.currentTarget,rect=card.getBoundingClientRect();
 schedulerPointerDrag={payload:schedulerDragPayload(job),card,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,grabOffsetY:event.clientY-rect.top,started:false,ghost:null,target:null};
 try{card.setPointerCapture?.(event.pointerId);}catch(_error){}
 const move=moveEvent=>{
  const state=schedulerPointerDrag;if(!state||moveEvent.pointerId!==state.pointerId)return;
  const distance=Math.hypot(moveEvent.clientX-state.startX,moveEvent.clientY-state.startY);
  if(!state.started&&distance<5)return;
  if(!state.started){
   state.started=true;document.body.classList.add("scheduler-dragging");card.classList.add("is-pointer-drag-source");
   const ghost=card.cloneNode(true);ghost.removeAttribute("onclick");ghost.removeAttribute("onpointerdown");ghost.querySelectorAll("[onpointerdown]").forEach(el=>el.removeAttribute("onpointerdown"));
   ghost.classList.add("scheduler-drag-ghost");ghost.style.position="fixed";ghost.style.left=`${rect.left}px`;ghost.style.top=`${rect.top}px`;ghost.style.width=`${rect.width}px`;ghost.style.height=`${Math.max(rect.height,56)}px`;ghost.style.margin="0";document.body.appendChild(ghost);state.ghost=ghost;
  }
  moveEvent.preventDefault();schedulerAutoScroll(moveEvent.clientX,moveEvent.clientY);positionSchedulerDragGhost(state,moveEvent.clientX,moveEvent.clientY);
  document.querySelectorAll(".timeline-day.is-drag-target,.scheduler-worker-drop.is-drag-target").forEach(el=>el.classList.remove("is-drag-target"));
  state.target=schedulerTargetFromPoint(moveEvent.clientX,moveEvent.clientY,state);
  if(state.target?.day)state.target.day.classList.add("is-drag-target");if(state.target?.workerTarget)state.target.workerTarget.classList.add("is-drag-target");
  updateSchedulerDragHud(state.target?.date?state.target:null);
 };
 const finish=async upEvent=>{
  const state=schedulerPointerDrag;if(!state||upEvent.pointerId!==state.pointerId)return;
  window.removeEventListener("pointermove",move,true);window.removeEventListener("pointerup",finish,true);window.removeEventListener("pointercancel",cancel,true);
  if(state.started){upEvent.preventDefault();schedulerSuppressClickUntil=Date.now()+350;}
  const target=state.target,payload=state.payload;
  cleanupSchedulerPointerDrag();
  if(!state.started||!target)return;
  if(target.workerId){await commitSchedulerAssigneeMove(payload,target.workerId);return;}
  const duration=schedulerEntryDurationMinutes(payload),start=dateTimeFromDateAndMinutes(target.date,target.minutes),end=addWallClockMinutes(start,duration);
  if(["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(payload.calendar_entry_type))await commitWorkflowSchedulerMove(payload,start);else await commitSchedulerMove(payload.id,start,end,payload.assigned_user_id,"calendar_pointer_drag");
 };
 const cancel=cancelEvent=>{if(!schedulerPointerDrag||cancelEvent.pointerId!==schedulerPointerDrag.pointerId)return;window.removeEventListener("pointermove",move,true);window.removeEventListener("pointerup",finish,true);window.removeEventListener("pointercancel",cancel,true);cleanupSchedulerPointerDrag();};
 window.addEventListener("pointermove",move,{capture:true,passive:false});window.addEventListener("pointerup",finish,{capture:true,once:false});window.addEventListener("pointercancel",cancel,{capture:true,once:false});
}
function createSchedulerDragGhost(state){
 if(!state?.card||state.ghost)return;
 const rect=state.card.getBoundingClientRect(),ghost=state.card.cloneNode(true);ghost.removeAttribute("onclick");ghost.removeAttribute("onpointerdown");ghost.removeAttribute("ontouchstart");ghost.removeAttribute("ontouchmove");ghost.removeAttribute("ontouchend");ghost.removeAttribute("ontouchcancel");ghost.querySelectorAll("[onpointerdown],[ontouchstart],[ontouchmove],[ontouchend],[ontouchcancel]").forEach(el=>{el.removeAttribute("onpointerdown");el.removeAttribute("ontouchstart");el.removeAttribute("ontouchmove");el.removeAttribute("ontouchend");el.removeAttribute("ontouchcancel");});ghost.classList.add("scheduler-drag-ghost");ghost.style.position="fixed";ghost.style.left=`${rect.left}px`;ghost.style.top=`${rect.top}px`;ghost.style.width=`${rect.width}px`;ghost.style.height=`${Math.max(rect.height,56)}px`;ghost.style.margin="0";document.body.appendChild(ghost);state.ghost=ghost;state.started=true;document.body.classList.add("scheduler-dragging");state.card.classList.add("is-pointer-drag-source");
}
function beginSchedulerTouchLongPress(event,job){
 if(!isMovableSchedulerEntry(job)||event.touches?.length!==1)return;
 const card=event.currentTarget,touch=event.touches[0],rect=card.getBoundingClientRect();
 cleanupSchedulerTouchDrag();
 schedulerTouchDrag={payload:schedulerDragPayload(job),card,startX:touch.clientX,startY:touch.clientY,lastClientX:touch.clientX,lastClientY:touch.clientY,grabOffsetY:touch.clientY-rect.top,activated:false,started:false,cancelled:false,ghost:null,target:null,timer:null};
 schedulerTouchDrag.timer=setTimeout(()=>{const state=schedulerTouchDrag;if(!state||state.cancelled)return;state.activated=true;state.card.classList.add("is-touch-drag-ready");},1500);
}
function moveSchedulerTouchLongPress(event){
 const state=schedulerTouchDrag;if(!state||event.touches?.length!==1)return;const touch=event.touches[0];
 if(!state.activated){clearTimeout(state.timer);state.timer=null;state.cancelled=true;state.card?.classList.remove("is-touch-drag-ready");schedulerTouchDrag=null;return;}
 event.preventDefault();if(!state.started)createSchedulerDragGhost(state);schedulerAutoScroll(touch.clientX,touch.clientY);positionSchedulerDragGhost(state,touch.clientX,touch.clientY);
 document.querySelectorAll(".timeline-day.is-drag-target,.scheduler-worker-drop.is-drag-target").forEach(el=>el.classList.remove("is-drag-target"));state.target=schedulerTargetFromPoint(touch.clientX,touch.clientY,state);if(state.target?.day)state.target.day.classList.add("is-drag-target");if(state.target?.workerTarget)state.target.workerTarget.classList.add("is-drag-target");updateSchedulerDragHud(state.target?.date?state.target:null);
}
async function finishSchedulerTouchLongPress(event){
 const state=schedulerTouchDrag;if(!state)return;if(state.timer)clearTimeout(state.timer);if(state.activated)schedulerSuppressClickUntil=Date.now()+500;const target=state.target,payload=state.payload,started=state.started;cleanupSchedulerTouchDrag();if(!started||!target)return;if(target.workerId){await commitSchedulerAssigneeMove(payload,target.workerId);return;}const duration=schedulerEntryDurationMinutes(payload),start=dateTimeFromDateAndMinutes(target.date,target.minutes),end=addWallClockMinutes(start,duration);if(["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(payload.calendar_entry_type))await commitWorkflowSchedulerMove(payload,start);else await commitSchedulerMove(payload.id,start,end,payload.assigned_user_id,"calendar_touch_long_press_drag");
}
function cancelSchedulerTouchLongPress(){cleanupSchedulerTouchDrag();}
function cleanupSchedulerTouchDrag(){
 const state=schedulerTouchDrag;if(state?.timer)clearTimeout(state.timer);if(state?.rafId)cancelAnimationFrame(state.rafId);if(state?.ghost)state.ghost.remove();if(state?.card)state.card.classList.remove("is-touch-drag-ready","is-pointer-drag-source");document.querySelectorAll(".timeline-day.is-drag-target,.scheduler-worker-drop.is-drag-target").forEach(el=>el.classList.remove("is-drag-target"));document.body.classList.remove("scheduler-dragging");updateSchedulerDragHud(null);schedulerTouchDrag=null;
}
function cleanupSchedulerPointerDrag(){
 const state=schedulerPointerDrag;if(state?.rafId)cancelAnimationFrame(state.rafId);if(state?.ghost)state.ghost.remove();if(state?.card)state.card.classList.remove("is-pointer-drag-source");
 document.querySelectorAll(".timeline-day.is-drag-target,.scheduler-worker-drop.is-drag-target").forEach(el=>el.classList.remove("is-drag-target"));
 document.body.classList.remove("scheduler-dragging");updateSchedulerDragHud(null);schedulerPointerDrag=null;schedulerDragState=null;
}
function schedulerEventClick(event,row){event.stopPropagation();if(Date.now()<schedulerSuppressClickUntil)return;openCalendarEntry(row);}
async function commitWorkflowSchedulerMove(payload,start){
 try{
  if(!payload.workflow_id||!payload.stage_id)throw new Error(bi("Workflow stage reference is missing.","Hiányzik a workflow-fázis hivatkozása."));
  await api(`/api/workflows/${encodeURIComponent(payload.workflow_id)}/stages/${encodeURIComponent(payload.stage_id)}`,{method:"PATCH",body:JSON.stringify({due_at:start})});
  await renderScheduler();return true;
 }catch(error){showError(error);await renderScheduler();return false;}
}
async function commitSchedulerAssigneeMove(payload,userId){
 if(["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(payload.calendar_entry_type)){
  const worker=workerById(userId);
  try{await api(`/api/workflows/${encodeURIComponent(payload.workflow_id)}/stages/${encodeURIComponent(payload.stage_id)}`,{method:"PATCH",body:JSON.stringify({assigned_user_id:userId,reassignment_reason:bi("Calendar drag reassignment","Naptári húzással történő átadás")})});await renderScheduler();return true;}catch(error){showError(error);await renderScheduler();return false;}
 }
 return commitSchedulerMove(payload.id,payload.start_time,payload.end_time,userId,"calendar_worker_pointer_drag");
}
function beginSchedulerDrag(event,job){event.preventDefault();}
function endSchedulerDrag(){cleanupSchedulerPointerDrag();}
function schedulerDropMinutes(event,target){
 const rect=target.getBoundingClientRect(),dayStart=Number(target.dataset.dayStart||420),dayEnd=Number(target.dataset.dayEnd||1320),span=dayEnd-dayStart;
 const raw=dayStart+((event.clientY-rect.top)/Math.max(1,rect.height))*span;
 return Math.max(dayStart,Math.min(dayEnd-SCHEDULE_INTERVAL_MINUTES,Math.round(raw/SCHEDULE_INTERVAL_MINUTES)*SCHEDULE_INTERVAL_MINUTES));
}
function dateTimeFromDateAndMinutes(date,minutes){return `${date}T${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;}
async function commitSchedulerMove(jobId,start,end,assignedUserId,source="calendar_drag"){
 try{
  const saved=await api(`/api/jobs/${encodeURIComponent(jobId)}/schedule`,{method:"PATCH",body:JSON.stringify({start_time:start,end_time:end,assigned_user_id:assignedUserId,source})});
  await refreshCalendarAfterMutation(saved);return saved;
 }catch(error){showError(error);await renderScheduler();return null;}
}
async function handleSchedulerDrop(event,date){event.preventDefault();}
async function handleSchedulerWorkerDrop(event,userId){event.preventDefault();event.stopPropagation();}
function beginSchedulerResize(event,job,dayStart,dayEnd){
 if(event.pointerType==="touch")return;
 event.preventDefault();event.stopPropagation();
 if(job?.calendar_entry_type)return;
 const card=event.currentTarget.closest(".timeline-event"),day=card?.closest(".timeline-day");if(!card||!day)return;
 const initialY=event.clientY,initialEnd=minutesFromTime(job.end_time),startMinutes=minutesFromTime(job.start_time),rect=day.getBoundingClientRect(),span=dayEnd-dayStart;
 const move=e=>{const delta=((e.clientY-initialY)/Math.max(1,rect.height))*span,next=Math.max(startMinutes+SCHEDULE_INTERVAL_MINUTES,Math.min(dayEnd,Math.round((initialEnd+delta)/SCHEDULE_INTERVAL_MINUTES)*SCHEDULE_INTERVAL_MINUTES));card.style.height=`${Math.max(1.67,((next-startMinutes)/span)*100)}%`;card.dataset.resizeEnd=String(next);};
 const up=async()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);const next=Number(card.dataset.resizeEnd||initialEnd);delete card.dataset.resizeEnd;const end=dateTimeFromDateAndMinutes(String(job.start_time).slice(0,10),next);await commitSchedulerMove(job.id,job.start_time,end,job.assigned_user_id,"calendar_resize");};
 window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});
}

function isMovableSchedulerJob(job){return !job?.calendar_entry_type && !['Completed','Partially completed','Failed','Cancelled'].includes(String(job?.status||''));}
function isMovableSchedulerEntry(job){
 if(isMovableSchedulerJob(job))return true;
 if(!["WORKFLOW_DEADLINE","WORKFLOW_TASK"].includes(job?.calendar_entry_type))return false;
 if(["Completed","Cancelled"].includes(String(job?.status||"")))return false;
 return isAdmin()||String(user?.role||"").toUpperCase()==="MANAGER";
}
function schedulerWorkflowDrawerMarkup(workflow,stageId=""){
 return workflowDrawerMarkup(workflow,stageId).replaceAll("closeWorkshopWorkflow()","closeSchedulerWorkflowDrawer()").replaceAll("openWorkshopWorkflow(","openSchedulerWorkflowStage(");
}
async function openSchedulerWorkflowDrawer(row){
 const workflowId=String(row?.workflow_id||"");if(!workflowId)return;
 try{
  const workflow=await api(`/api/workflows/${encodeURIComponent(workflowId)}`),stageId=String(row?.stage_id||row?.id||"__workflow__");
  schedulerWorkflowDrawerState={workflow,stageId};
  let host=document.getElementById("schedulerWorkflowDrawerHost");if(!host){host=document.createElement("div");host.id="schedulerWorkflowDrawerHost";host.className="scheduler-workflow-drawer-host";document.body.appendChild(host);}
  host.innerHTML=`<div class="workflow-shell has-workflow-drawer scheduler-workflow-shell">${schedulerWorkflowDrawerMarkup(workflow,stageId)}</div>`;host.classList.add("is-open");sessionActivity?.syncModalState?.();
 }catch(error){showError(error);}
}
function openSchedulerWorkflowStage(workflowId,stageId="__workflow__"){
 if(!schedulerWorkflowDrawerState?.workflow||String(schedulerWorkflowDrawerState.workflow.id)!==String(workflowId))return;
 schedulerWorkflowDrawerState.stageId=String(stageId||"__workflow__");const host=document.getElementById("schedulerWorkflowDrawerHost");if(host)host.innerHTML=`<div class="workflow-shell has-workflow-drawer scheduler-workflow-shell">${schedulerWorkflowDrawerMarkup(schedulerWorkflowDrawerState.workflow,schedulerWorkflowDrawerState.stageId)}</div>`;
}
function closeSchedulerWorkflowDrawer(){const host=document.getElementById("schedulerWorkflowDrawerHost");if(host){host.classList.remove("is-open");host.innerHTML="";}schedulerWorkflowDrawerState=null;sessionActivity?.syncModalState?.();}

async function renderScheduler(){
 const week=[0,1,2,3,4,5,6].map(i=>addDays(currentWeekStart,i));
 const weekDates=week.map(d=>fmtDate(d));
 const jobs=await loadCalendarEntries(weekDates[0],addDaysToDateKey(weekDates[6],1));
 const workers=await loadSchedulerWorkers();
 const visibleJobs=filterJobsForScheduler(jobs);
 const dayStart=7*60, dayEnd=22*60, totalMinutes=dayEnd-dayStart;
 let html=`<div class="panel scheduler-panel"><div class="toolbar scheduler-toolbar"><div><h3>${bi("Weekly Scheduler","Heti naptár")}</h3><p class="muted">${weekDates[0]} – ${weekDates[6]} · America/New_York</p><div class="ny-time-box"><span>${bi("Current New York time","Aktuális New York-i idő")}</span><strong id="currentNYClock">${currentNYTimeString()}</strong></div></div><div class="scheduler-actions"><label class="inline-label">${bi("Work type","Munkatípus")}<select onchange="currentSchedulerEntryFilter=this.value;renderScheduler()"><option value="ALL" ${currentSchedulerEntryFilter==="ALL"?"selected":""}>${bi("All jobs","Összes munka")}</option><option value="CALENDAR" ${currentSchedulerEntryFilter==="CALENDAR"?"selected":""}>${bi("Calendar jobs only","Csak naptári jobok")}</option><option value="WORKFLOW" ${currentSchedulerEntryFilter==="WORKFLOW"?"selected":""}>${bi("Workshop Tasks","Workflow munkák")}</option></select></label><label class="inline-label">${tr("workerFilter")}<select class="worker-filter-select" onchange="currentSchedulerWorker=this.value;renderScheduler()">${schedulerFilterOptions(workers)}</select></label><button class="small" onclick="moveWeek(-1)">← ${bi("Previous","Előző")}</button><button class="small" onclick="goThisWeek()">${bi("This week","Aktuális hét")}</button><button class="small" onclick="moveWeek(1)">${bi("Next","Következő")} →</button><button onclick="openJob()">+ ${bi("Add Job","Új munka")}</button></div></div>
 <div class="scheduler-legend"><span class="legend-klavierhaus-event">◆ ${bi("Klavierhaus event","Klavierhaus esemény")}</span><span class="legend-active">◷ ${bi("Active — employee color","Aktív — munkavállalói szín")}</span><span class="legend-partial">◷ ${bi("Part completed, workflow continues","Rész kész, folyamatban")}</span><span class="legend-complete">✓ ${bi("Fully completed","Teljesen lezárt")}</span><span class="legend-overdue">! ${bi("Overdue, not closed","Lejárt, nincs lezárva")}</span><span class="legend-failed">! ${bi("Failed","Sikertelen")}</span></div>
 <div class="timeline-scroll"><div class="timeline-calendar"><div class="timeline-corner">${bi("Time","Idő")}</div>${week.map(d=>`<div class="timeline-day-head"><b>${d.toLocaleDateString(currentLang==="hu"?"hu-HU":"en-US",{weekday:"short",timeZone:"America/New_York"})}</b><span>${fmtDate(d)}</span></div>`).join("")}
 <div class="timeline-times">${Array.from({length:16},(_,i)=>`<span style="top:${(i*60/totalMinutes)*100}%">${String(i+7).padStart(2,"0")}:00</span>`).join("")}</div>`;
 for(const day of week){
   const dayStr=fmtDate(day); const events=visibleJobs.filter(j=>String(j.start_time||"").slice(0,10)===dayStr);
   const placed=calendarLayout(events,dayStart,dayEnd);
   html+=`<div class="timeline-day" data-date="${dayStr}" data-day-start="${dayStart}" data-day-end="${dayEnd}" onclick="if(event.target===this){const r=this.getBoundingClientRect();const mins=${dayStart}+Math.round(((event.clientY-r.top)/r.height)*${totalMinutes}/SCHEDULE_INTERVAL_MINUTES)*SCHEDULE_INTERVAL_MINUTES;openJob('${dayStr}T'+String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0'))}">
    <div class="quarter-grid">${Array.from({length:60},(_,i)=>`<i style="top:${(i/60)*100}%" class="${i%4===0?'hour':''}"></i>`).join("")}</div>
    <div class="current-time-line" data-date="${dayStr}" data-day-start="${dayStart}" data-day-end="${dayEnd}"><span></span></div>`;
   for(const item of placed){
     const j=item.event; const top=((item.start-dayStart)/totalMinutes)*100; const height=Math.max(1.67,((item.end-item.start)/totalMinutes)*100);
     const width=100/item.lanes; const left=item.lane*width;
     html+=`<button type="button" class="timeline-event ${calendarEventClass(j)}${calendarIntegrationClass(j)}${calendarEventDensityClass(j)}" style="top:${top}%;height:${height}%;left:calc(${left}% + 2px);width:calc(${width}% - 4px);${calendarEventClass(j)==='WorkerColor'?`--event-color:${workerColor(j.assigned_to,j.assigned_calendar_color)};`:''}" ${isMovableSchedulerEntry(j)?`data-scheduler-movable="true" onpointerdown='beginSchedulerPointerDrag(event,${esc(j)})' ontouchstart='beginSchedulerTouchLongPress(event,${esc(j)})' ontouchmove='moveSchedulerTouchLongPress(event)' ontouchend='finishSchedulerTouchLongPress(event)' ontouchcancel='cancelSchedulerTouchLongPress(event)'`:""} onclick='schedulerEventClick(event,${esc(j)})'>${calendarEventCardMarkup(j)}${isMovableSchedulerJob(j)?`<span class="timeline-resize-handle" onpointerdown='beginSchedulerResize(event,${esc(j)},${dayStart},${dayEnd})' aria-hidden="true"></span>`:""}</button>`;
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
 if(job?.start_time && currentView==="scheduler") currentWeekStart=startOfWeek(job.start_time);
 if(currentView==="today") return renderToday();
 if(currentView==="scheduler") return renderScheduler();
 return null;
}
function moveWeek(n){currentWeekStart=addDays(currentWeekStart,7*n);renderScheduler()} function goThisWeek(){currentWeekStart=startOfWeek(new Date());renderScheduler()}
setInterval(async()=>{
 if(!token||document.visibilityState==='hidden'||calendarAutoRefreshBusy||!['today','scheduler'].includes(currentView))return;
 calendarAutoRefreshBusy=true;
 try{if(currentView==='today')await renderToday();else if(currentView==='scheduler')await renderScheduler();}catch(error){console.error('Calendar auto-refresh failed:',error);const target=document.getElementById('content')||document.querySelector('.view');if(target){let warning=document.getElementById('calendarRefreshWarning');if(!warning){warning=document.createElement('div');warning.id='calendarRefreshWarning';warning.className='error';warning.setAttribute('role','status');target.prepend(warning);}warning.textContent=bi('Calendar refresh failed. Displayed data may be stale.','A naptár frissítése sikertelen. A megjelenített adatok elavultak lehetnek.');}}finally{calendarAutoRefreshBusy=false;}
},15000);

async function openJobPianoCreate(client,draft){
 const suggested=String(draft?.piano_name||"").trim();
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=bi("Add piano for job","Zongora hozzáadása a munkához");
 $("#form").innerHTML=`<div class="form-grid"><div class="field full"><p class="muted">${bi("The client exists, but the selected piano is not in the ERP yet. Create it now; the job draft will be preserved.","Az ügyfél létezik, de a kiválasztott zongora még nincs az ERP-ben. Hozd létre most; a munka piszkozata megmarad.")}</p></div><div class="field"><label>${bi("Piano name / description","Zongora neve / leírás")}</label><input name="display_name" value="${htmlText(suggested)}" required></div><div class="field"><label>${bi("Brand","Márka")}</label><input name="brand"></div><div class="field"><label>${bi("Model","Típus")}</label><input name="model"></div><div class="field"><label>${bi("Serial No.","Gyári szám")}</label><input name="serial_no"></div><div class="field"><label>${bi("Location","Helyszín")}</label><input name="location" value="${htmlText(draft?.service_address||client?.address||"")}"></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="openJob('${htmlText(draft?.start_time||"")}',null,${esc(draft||{})})">${bi("Back","Vissza")}</button><button>${bi("Create piano and continue","Zongora létrehozása és folytatás")}</button></div>`;
 $("#form").onsubmit=async event=>{event.preventDefault();try{const body=Object.fromEntries(new FormData(event.target));body.owner_contact_id=client.id;body.ownership_type="Customer owned";const piano=await api("/api/pianos",{method:"POST",body:JSON.stringify(body)});await openJob(draft.start_time,null,{...draft,client_id:client.id,client_name:client.name,client_phone:client.phone||draft.client_phone,piano_id:piano.id,piano_name:piano.display_name||`${piano.brand||""} ${piano.model||""}`.trim()});}catch(error){showError(error)}};
 applyLanguageToDOM(document.getElementById("modal"));
}

function closeNestedPianoModal(){document.querySelector(".nested-modal-overlay[data-nested-piano]")?.remove();}
function openNestedJobPianoModal({client,draft={},onSaved}={}){
 if(!client?.id){showError("CLIENT_REQUIRED_FOR_PIANO");return null;}
 closeNestedPianoModal();
 const overlay=document.createElement("div");overlay.className="nested-modal-overlay";overlay.dataset.nestedPiano="1";
 const suggested=String(draft?.piano_name||"").trim();
 overlay.innerHTML=`<section class="nested-modal-card nested-piano-card" role="dialog" aria-modal="true" aria-labelledby="nestedPianoTitle"><div class="modal-header"><h3 id="nestedPianoTitle">${bi("Register New Piano for this Client","Új zongora rögzítése ehhez az ügyfélhez")}</h3><button type="button" class="modal-close" data-piano-cancel aria-label="${bi("Close","Bezárás")}">×</button></div><form class="nested-piano-form"><p class="muted">${htmlText(client.name||"")}</p><div class="form-grid"><div class="field"><label>${req(bi("Brand","Márka"))}</label><input name="brand" required autocomplete="off"></div><div class="field"><label>${req(bi("Model","Típus / Modell"))}</label><input name="model" value="${htmlText(suggested)}" required autocomplete="off"></div><div class="field"><label>${req(bi("Serial Number","Sorozatszám"))}</label><input name="serial_no" required autocomplete="off"></div><div class="field"><label>${bi("Finish / Color","Kivitel / Szín")}</label><input name="finish" autocomplete="off"></div></div><div class="actions"><button type="button" class="ghost-btn" data-piano-cancel>${bi("Cancel","Mégse")}</button><button type="submit">${bi("Register piano","Zongora rögzítése")}</button></div></form></section>`;
 const cancel=()=>closeNestedPianoModal();overlay.querySelectorAll("[data-piano-cancel]").forEach(button=>button.addEventListener("click",cancel));overlay.addEventListener("click",event=>{if(event.target===overlay)cancel();});
 overlay.querySelector("form").addEventListener("submit",async event=>{event.preventDefault();try{const body=Object.fromEntries(new FormData(event.currentTarget));body.display_name=`${String(body.brand||"").trim()} ${String(body.model||"").trim()}`.trim();body.location=String(draft?.service_address||client.address||"").trim();const piano=await api(`/api/contacts/${encodeURIComponent(client.id)}/pianos`,{method:"POST",body:JSON.stringify(body)});closeNestedPianoModal();if(typeof onSaved==="function")await onSaved(piano);}catch(error){showError(error);}});
 document.body.appendChild(overlay);applyLanguageToDOM(overlay);setTimeout(()=>overlay.querySelector('[name="brand"]')?.focus(),20);return overlay;
}

function createNestedClientStateMachine(initialDraft={}){
 let draft={...(initialDraft||{})},mode="idle";
 return {
  begin(term,nextDraft=draft){draft={...(nextDraft||{}),client_name:String(term||"").trim(),allow_ad_hoc_client:false};mode="creating";return {...draft};},
  decline(term,nextDraft=draft){draft={...(nextDraft||{}),client_id:"",client_name:String(term||"").trim(),allow_ad_hoc_client:true};mode="adhoc";return {...draft};},
  saved(client){draft={...draft,client_id:client?.id||"",client_name:client?.name||draft.client_name||"",client_phone:client?.phone||draft.client_phone||"",service_address:client?.address||draft.service_address||"",allow_ad_hoc_client:false};mode="saved";return {...draft};},
  cancelled(){mode="cancelled";return {...draft};},
  snapshot(){return {...draft};},
  get mode(){return mode;}
 };
}
function entityFormFieldsMarkup(key,row=null,initial={}){const s=schemas[key],pianoId=key==="pianos"&&row?`<div class="field"><label>Piano ID</label><input value="${htmlText(row.id||'')}" readonly></div>`:"";return `<div class="form-grid">${pianoId}${s.fields.map(f=>field(f,initial?.[f[0]])).join("")}</div>${key==="contacts"?'<div id="contactPianoSection"></div>':''}`;}
function collectEntityFormBody(key,form){const s=schemas[key],body=Object.fromEntries(new FormData(form));s.fields.forEach(f=>{if(f[2]==="number")body[f[0]]=Number(body[f[0]]||0)});if(key==="contacts"){body.has_piano=Number(body.has_piano||0);body.interested_buying=Number(body.interested_buying||0);}return body;}
async function saveEntityFormRecord(key,row,form){const s=schemas[key],body=collectEntityFormBody(key,form);let saved;if(row)saved=await api(`/api/${s.api}/${row.id}`,{method:"PUT",body:JSON.stringify(body)});else saved=await api(`/api/${s.api}`,{method:"POST",body:JSON.stringify(body)});if(key==="contacts"){const clientId=(row&&row.id)||saved.id,scope=form.closest('.nested-modal-overlay,#modal')||document,allPianoChecks=[...scope.querySelectorAll('input[name="client_piano_ids"]')],ids=allPianoChecks.filter(x=>x.checked).map(x=>x.value);if(clientId&&allPianoChecks.length)await api(`/api/contacts/${clientId}/pianos`,{method:"PUT",body:JSON.stringify({piano_ids:ids})});}return saved;}

function captureJobDraftFromForm(){const form=document.getElementById("form");if(!form)return jobDraftState?{...jobDraftState}:{};const body=Object.fromEntries(new FormData(form));const start=document.getElementById("jobStart")?.value,end=document.getElementById("jobEnd")?.value;if(start)body.start_time=start;if(end)body.end_time=end;body.daily_rate_enabled=Boolean(document.getElementById("jobDailyRateEnabled")?.checked);body.daily_rate_allocated_amount=Number(document.getElementById("jobDailyRateAmount")?.value||0);return body;}
function closeNestedClientModal(result=null){const overlay=document.querySelector(".nested-modal-overlay[data-nested-client]");if(overlay)overlay.remove();return result;}
function openNestedClientModal({prefillName="",draft,onSaved,onCancelled,stateMachine=null}={}){
 const overlay=document.createElement("div"),initial={name:prefillName};
 overlay.className="nested-modal-overlay";overlay.dataset.nestedClient="1";
 overlay.innerHTML=`<section class="nested-modal-card" role="dialog" aria-modal="true" aria-labelledby="nestedClientTitle"><div class="modal-header"><h3 id="nestedClientTitle">${bi("Add Client","Új ügyfél")}</h3><button type="button" class="modal-close" data-nested-cancel aria-label="${bi("Close","Bezárás")}">×</button></div><form class="nested-client-form">${entityFormFieldsMarkup("contacts",null,initial)}<div class="actions"><button type="button" class="ghost-btn" data-nested-cancel>${bi("Cancel","Mégse")}</button><button type="submit">${bi("Save","Mentés")}</button></div></form></section>`;
 let onKey=null,finished=false;
 const cleanup=()=>{if(onKey)document.removeEventListener('keydown',onKey,true);closeNestedClientModal();};
 const cancel=()=>{if(finished)return;finished=true;const restored=stateMachine?stateMachine.cancelled():(draft||{});cleanup();if(typeof onCancelled==="function")onCancelled(restored);};
 overlay.querySelectorAll('[data-nested-cancel]').forEach(btn=>btn.addEventListener('click',cancel));
 overlay.addEventListener('click',e=>{if(e.target===overlay)cancel();});
 overlay.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();if(finished)return;try{const saved=await saveEntityFormRecord('contacts',null,e.target);finished=true;const restored=stateMachine?stateMachine.saved(saved):(draft||{});cleanup();if(typeof onSaved==="function")await onSaved(saved,restored);}catch(error){showError(error);}});
 document.body.appendChild(overlay);setupContactFormBehavior(null);applyLanguageToDOM(overlay);
 onKey=e=>{if(e.key==='Escape'){e.preventDefault();cancel();}};document.addEventListener('keydown',onKey,true);
 setTimeout(()=>overlay.querySelector('[name="name"]')?.focus(),20);return overlay;
}
function ensureInlineClientPrompt(clientInput,{contacts,onYes,onNo}){let box=document.getElementById('inlineUnknownClientPrompt');if(!box){box=document.createElement('div');box.id='inlineUnknownClientPrompt';box.className='inline-client-prompt hidden';clientInput.closest('.field')?.appendChild(box);}const refresh=()=>{const term=String(clientInput.value||'').trim(),matched=contacts.some(c=>String(c.name||'').trim().toLowerCase()===term.toLowerCase());if(term.length<=2||matched||clientInput.dataset.declinedClientTerm===term){box.classList.add('hidden');box.innerHTML='';return;}box.classList.remove('hidden');box.innerHTML=`<span>${bi('Client not found in the list. Create as a new client?','Ügyfél nem található a listában. Létrehozod új ügyfélként?')}</span><div><button type="button" class="small" data-client-create-yes>${bi('Yes','Igen')}</button><button type="button" class="ghost-btn small" data-client-create-no>${bi('No','Nem')}</button></div>`;box.querySelector('[data-client-create-yes]').onclick=()=>{clientInput.dataset.declinedClientTerm='';onYes(term);};box.querySelector('[data-client-create-no]').onclick=()=>{clientInput.dataset.declinedClientTerm=term;box.classList.add('hidden');onNo(term);};};clientInput.addEventListener('input',()=>{if(clientInput.dataset.declinedClientTerm&&clientInput.dataset.declinedClientTerm!==String(clientInput.value||'').trim())clientInput.dataset.declinedClientTerm='';refresh();});clientInput.addEventListener('blur',()=>setTimeout(refresh,120));refresh();return box;}

function bindPredictiveInput(input,box,getItems,{search,label,secondary,onSelect,emptyAction}={}){
 if(!input||!box)return;
 const render=()=>{const term=String(input.value||"").trim().toLocaleLowerCase(),items=(getItems?.()||[]).filter(item=>!term||String(search?.(item)||"").toLocaleLowerCase().includes(term)).slice(0,8);const html=items.map(item=>`<button type="button" class="workflow-typeahead-option" data-predictive-id="${htmlText(item.id)}"><strong>${htmlText(label?.(item)||"")}</strong><small>${htmlText(secondary?.(item)||"—")}</small></button>`).join("");box.innerHTML=html+(!items.length&&term&&emptyAction?`<button type="button" class="workflow-typeahead-add" data-predictive-empty>+ ${htmlText(emptyAction.label)}</button>`:"");box.classList.toggle("hidden",!box.innerHTML);box.querySelectorAll('[data-predictive-id]').forEach(btn=>btn.addEventListener("mousedown",event=>{event.preventDefault();const item=(getItems?.()||[]).find(x=>String(x.id)===String(btn.dataset.predictiveId));if(item){onSelect?.(item);box.classList.add("hidden");}}));box.querySelector('[data-predictive-empty]')?.addEventListener("mousedown",event=>{event.preventDefault();emptyAction.run?.(input.value);box.classList.add("hidden");});};
 input.addEventListener("input",render);input.addEventListener("focus",render);input.addEventListener("blur",()=>setTimeout(()=>box.classList.add("hidden"),180));
}
function openLinkedWorkshopWorkflow(workflowId,event=null){event?.stopPropagation?.();event?.preventDefault?.();workshopWorkflowSelectedId=String(workflowId||"");workshopWorkflowSelectedStageId="__workflow__";navigationHomeNeutral=false;render("workshop_workflow",{navigationActivate:true});}

async function openJob(prefill="", row=null, draft=null){
 const source=draft||row||{};
 let allowAdHocClient=Boolean(source?.allow_ad_hoc_client||(!source?.client_id&&source?.client_name));
 const existingMinutes=Number(source?.planned_minutes)>0?Number(source.planned_minutes):Math.max(30,wallClockDifferenceMinutes(source?.start_time,source?.end_time)||180);
 const requestedDate=String(source?.start_time||prefill||newYorkNowLocal()).slice(0,10);
 const startSource=source?.start_time?String(source.start_time).slice(0,16):`${requestedDate}T10:00`;
 const start=`${requestedDate}T${snapHalfHourTime(startSource,'10:00')}`;
 const rawEnd=source?.end_time?String(source.end_time).slice(0,16):addWallClockMinutes(start,existingMinutes||180);
 const endDate=String(rawEnd||start).slice(0,10)||requestedDate;
 const end=`${endDate}T${snapHalfHourTime(rawEnd,'13:00')}`;
 const [contacts,pianos,workflowPayload]=await Promise.all([api("/api/contacts").catch(()=>[]),api("/api/pianos").catch(()=>[]),api("/api/workflows").catch(()=>({workflows:[]})),loadSchedulerWorkers().catch(()=>[])]).then(results=>[results[0],results[1],results[2]]);
 const openWorkflows=Array.isArray(workflowPayload)?workflowPayload:(workflowPayload?.workflows||[]),existingWorkflowId=String(source?.linked_workshop_workflow_id||source?.workshop_workflow_id||source?.workflow_id||"");
 const clientOptions=contacts.map(c=>`<option value="${htmlText(c.name||'')}">${htmlText(`${c.phone||''} ${c.address||''}`)}</option>`).join('');
 const pianoOptions=pianos.map(p=>`<option value="${htmlText(pianoDisplayName(p))}">${htmlText(workflowPianoSecondary(p))}</option>`).join('');
 const dailyEnabled=Number(source?.daily_rate_enabled||0)===1||source?.daily_rate_enabled===true;
 const dailyAmount=Number(source?.daily_rate_allocated_amount||0);

 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=row ? bi("Edit Job","Munka szerkesztése") : bi("New Job","Új munka");
 $("#form").innerHTML=`<div class="form-grid job-form-grid">
<div class="field"><label>${req("Job title / Munka neve")}</label><input name="title" value="${htmlText(source?.title||'')}" required placeholder="Piano tuning / Zongorahangolás"></div>
<div class="field"><label>${req("Assigned to / Felelős")}</label><select id="jobAssignedUser" name="assigned_user_id" required>${workerSelectOptions(source?.assigned_user_id,source?.assigned_to)}</select><small class="worker-availability-hint" aria-live="polite"></small></div>
<div class="field"><label>${req("Standalone or part-work / Önálló munka vagy részmunka")}</label><select name="job_type" id="jobType" onchange="toggleInstructionsField()"><option value="Standalone" ${source?.job_type==="Standalone"?"selected":""}>Standalone / Önálló munka</option><option value="Part-work" ${source?.job_type==="Part-work"?"selected":""}>Part-work / Részmunka</option></select></div>

<div class="field"><label>${req("Client name / Ügyfél neve")}</label><input id="clientNameInput" name="client_name" list="clientList" value="${htmlText(source?.client_name||'')}" required placeholder="${bi('Start typing client name','Kezdd el írni az ügyfél nevét')}"><datalist id="clientList">${clientOptions}</datalist><div id="jobClientSuggestions" class="workflow-typeahead-results hidden"></div></div>
<div class="field"><label>${bi("Piano name / Zongora neve","Zongora neve")}</label><input id="pianoNameInput" name="piano_name" list="pianoList" value="${htmlText(source?.piano_name||'')}" placeholder="Steinway D, Yamaha U1..."><datalist id="pianoList">${pianoOptions}</datalist><div id="jobPianoSuggestions" class="workflow-typeahead-results hidden"></div><div id="inlinePianoRegistrationPrompt" class="inline-piano-register-prompt hidden"></div></div>
<div class="field"><label>${bi('Client phone','Ügyfél telefonszáma')}</label><input id="clientPhoneInput" name="client_phone" value="${htmlText(source?.client_phone||'')}" placeholder="+1..."></div>

<div class="field"><label>${req("Service address / Cím")}</label><input id="serviceAddressInput" name="service_address" value="${htmlText(source?.service_address||'')}" required></div>
${jobDateTimePickerMarkup('jobStart','start_time',req('Start / Kezdés'),start,{defaultTime:'10:00'})}
${jobDateTimePickerMarkup('jobEnd','end_time',req('End / Befejezés'),end,{defaultTime:'13:00'})}

<div class="field"><label>${bi('Estimated amount','Előzetes összeg')}</label><input name="planned_amount" type="number" min="0" step="0.01" value="${Number(source?.planned_amount||0)}"></div>
<div class="field"><label>${bi('Technician field-service compensation','Technikusi kiszállási munkadíj / jutalék')}</label><input name="technician_extra_compensation" type="number" min="0" step="0.01" value="${Number(source?.technician_extra_compensation||0)}"><small class="muted">${bi('Additional technician income above the fixed $300 daily base.','A fix $300 napidíjon felüli külön technikusi jövedelem.')}</small></div>
<div class="field daily-rate-toggle-field"><label>${bi('Daily Rate?','Napidíjas?')}</label><label class="daily-rate-switch"><input id="jobDailyRateEnabled" name="daily_rate_enabled" type="checkbox" value="1" ${dailyEnabled?'checked':''}><span class="daily-rate-switch-track" aria-hidden="true"><span class="daily-rate-switch-thumb"></span></span><span class="daily-rate-switch-label">${bi('Use contractor daily-rate allocation','Alvállalkozói napidíjkeret használata')}</span></label></div>
<div class="field daily-rate-allocation-field ${dailyEnabled?'':'hidden'}" id="dailyRateAllocationField"><label>${bi('Daily Rate Allocation','Napidíj-allokáció')}</label><input id="jobDailyRateAmount" name="daily_rate_allocated_amount" type="number" min="0" step="0.01" value="${dailyAmount}" readonly ${dailyEnabled?'':'disabled'}><small id="jobDailyRateCapacity" class="daily-rate-capacity muted">${bi('Daily rate disabled.','Napidíj kikapcsolva.')}</small></div>
<div class="field full job-workflow-link"><label class="job-workflow-toggle"><input id="jobAttachWorkflow" type="checkbox" ${existingWorkflowId?'checked':''}> <span>${bi('Attach / Create Workshop Workflow','Workshop Workflow csatolása / létrehozása')}</span></label><small>${bi('Optional · Requires Workshop Workflow','Opcionális · Workshop Workflow szükséges')}</small><div id="jobWorkflowOptions" class="job-workflow-options ${existingWorkflowId?'':'hidden'}"><label>${bi('Workflow action','Workflow művelet')}<select id="jobWorkflowAction"><option value="CREATE">${bi('Create new workflow','Új workflow létrehozása')}</option><option value="ATTACH" ${existingWorkflowId?'selected':''}>${bi('Attach existing open workflow','Meglévő nyitott workflow csatolása')}</option></select></label><label id="jobWorkflowExistingField" class="${existingWorkflowId?'':'hidden'}">${bi('Open workflow','Nyitott workflow')}<select id="jobExistingWorkflow"><option value="">${bi('Select workflow','Válassz workflow-t')}</option>${openWorkflows.map(w=>`<option value="${htmlText(w.id)}" ${String(w.id)===existingWorkflowId?'selected':''}>${htmlText(w.workflow_key||w.id)} · ${htmlText(w.client_name||'')} · ${htmlText(workflowPianoPrimary(w))}</option>`).join('')}</select></label></div></div>

<div class="field full ${source?.job_type==="Part-work"?"":"hidden"}" id="instructionsField"><label>${bi('Remaining tasks','Hátralévő feladatok')}</label><textarea name="instructions">${htmlText(source?.instructions||'')}</textarea></div>
<div class="field full"><label>${bi("Notes","Megjegyzés")}</label><textarea name="notes" rows="4" placeholder="${bi('Additional job notes','További megjegyzés a munkához')}">${htmlText(source?.notes||'')}</textarea></div>
<div class="field full planned-duration-readout"><strong id="plannedDurationLabel">${bi('Planned duration','Tervezett időtartam')}: ${formatDurationLabel(existingMinutes||180)}</strong><input id="plannedHours" name="planned_hours" type="hidden" value="${(existingMinutes||180)/60}"><input id="plannedMinutes" name="planned_minutes" type="hidden" value="${existingMinutes||180}"></div>
</div>
<div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button>${row?bi('Save changes','Módosítás mentése'):bi('Create job','Munka létrehozása')}</button></div>`;

 const startInput=document.getElementById("jobStart"),endInput=document.getElementById("jobEnd"),assignedInput=document.getElementById("jobAssignedUser"),hoursInput=document.getElementById("plannedHours"),minutesInput=document.getElementById("plannedMinutes"),durationLabel=document.getElementById("plannedDurationLabel"),clientInput=document.getElementById("clientNameInput"),phoneInput=document.getElementById("clientPhoneInput"),addressInput=document.getElementById("serviceAddressInput"),pianoInput=document.getElementById("pianoNameInput"),dailyToggle=document.getElementById('jobDailyRateEnabled'),dailyAmountInput=document.getElementById('jobDailyRateAmount'),capacityLabel=document.getElementById('jobDailyRateCapacity');

 const selectedClient=()=>contacts.find(x=>(x.name||"").trim().toLowerCase()===(clientInput.value||"").trim().toLowerCase())||null;
 const ownedPianosForClient=client=>client?pianos.filter(p=>String(p.owner_contact_id||"")===String(client.id)||String(p.client_id||"")===String(client.id)):[];
 function renderClientPianoOptions(client){const list=document.getElementById("pianoList"),owned=ownedPianosForClient(client);if(list)list.innerHTML=owned.map(p=>`<option value="${htmlText(pianoDisplayName(p))}">${htmlText(workflowPianoSecondary(p))}</option>`).join('');return owned;}
 function refreshInlinePianoRegistration(){const box=document.getElementById("inlinePianoRegistrationPrompt"),client=selectedClient(),term=String(pianoInput.value||"").trim(),owned=ownedPianosForClient(client),match=owned.find(p=>String(p.display_name||`${p.brand||""} ${p.model||""}`.trim()).trim().toLowerCase()===term.toLowerCase());if(match){pianoInput.dataset.pianoId=match.id;box?.classList.add("hidden");if(box)box.innerHTML="";return;}pianoInput.dataset.pianoId="";const shouldOffer=Boolean(client&&(term||owned.length===0));if(!box)return;box.classList.toggle("hidden",!shouldOffer);box.innerHTML=shouldOffer?`<button type="button" class="ghost-btn small" data-register-job-piano>+ ${bi("Register New Piano for this Client","Új zongora rögzítése ehhez az ügyfélhez")}</button>`:"";box.querySelector("[data-register-job-piano]")?.addEventListener("click",()=>{const draftState=captureJobDraftFromForm();openNestedJobPianoModal({client,draft:draftState,onSaved:piano=>{pianos.push({...piano,owner_contact_id:client.id,client_id:client.id});renderClientPianoOptions(client);pianoInput.value=piano.display_name||`${piano.brand||""} ${piano.model||""}`.trim();pianoInput.dataset.pianoId=piano.id;refreshInlinePianoRegistration();showToast(bi("Piano registered and selected.","A zongora rögzítve és kiválasztva."),"success");}});});}
 function applyClientSelection(forceAutofill=false){const client=selectedClient();if(!client){clientInput.dataset.clientId="";renderClientPianoOptions(null);refreshInlinePianoRegistration();return null;}const changed=String(clientInput.dataset.clientId||"")!==String(client.id);clientInput.dataset.clientId=client.id;if(forceAutofill||changed){phoneInput.value=client.phone||"";addressInput.value=client.address||"";if(changed){pianoInput.value="";pianoInput.dataset.pianoId="";}}renderClientPianoOptions(client);refreshInlinePianoRegistration();return client;}
 if(source?.client_id)clientInput.dataset.clientId=String(source.client_id);if(source?.piano_id)pianoInput.dataset.pianoId=String(source.piano_id);renderClientPianoOptions(selectedClient());refreshInlinePianoRegistration();
 clientInput.addEventListener("change",()=>applyClientSelection(true));clientInput.addEventListener("input",()=>{const client=selectedClient();if(!client||String(client.id)!==String(clientInput.dataset.clientId||""))clientInput.dataset.clientId="";refreshInlinePianoRegistration();});pianoInput.addEventListener("input",refreshInlinePianoRegistration);pianoInput.addEventListener("change",refreshInlinePianoRegistration);
 ensureInlineClientPrompt(clientInput,{contacts,onYes:(term)=>{const flow=createNestedClientStateMachine(captureJobDraftFromForm());jobDraftState=flow.begin(term,captureJobDraftFromForm());openNestedClientModal({prefillName:term,draft:jobDraftState,stateMachine:flow,onSaved:(client,draftState)=>{allowAdHocClient=false;jobDraftState=null;contacts.push(client);clientInput.value=draftState.client_name||client.name||term;phoneInput.value=draftState.client_phone||'';addressInput.value=draftState.service_address||'';clientInput.dataset.clientId=draftState.client_id||client.id;renderClientPianoOptions(client);refreshInlinePianoRegistration();showToast(bi('Client created and linked.','Ügyfél létrehozva és összekapcsolva.'),'success');},onCancelled:(draftState)=>{jobDraftState=null;clientInput.value=draftState.client_name||term;phoneInput.value=draftState.client_phone||phoneInput.value||'';addressInput.value=draftState.service_address||addressInput.value||'';}});},onNo:(term)=>{const flow=createNestedClientStateMachine(captureJobDraftFromForm()),draftState=flow.decline(term,captureJobDraftFromForm());allowAdHocClient=true;jobDraftState=draftState;clientInput.value=draftState.client_name||term;clientInput.dataset.clientId='';showToast(bi('Client will remain text-only for this job.','Az ügyfél ennél a munkánál csak szöveges adat marad.'),'info');}});

 bindPredictiveInput(clientInput,document.getElementById("jobClientSuggestions"),()=>contacts,{search:c=>[c.name,c.email,c.phone].filter(Boolean).join(" "),label:c=>c.name||"",secondary:c=>[c.email,c.phone].filter(Boolean).join(" · "),onSelect:c=>{allowAdHocClient=false;clientInput.value=c.name||"";clientInput.dataset.clientId=c.id;applyClientSelection(true);},emptyAction:{label:bi("Add New Client","Új ügyfél hozzáadása"),run:term=>{const flow=createNestedClientStateMachine(captureJobDraftFromForm());jobDraftState=flow.begin(term,captureJobDraftFromForm());openNestedClientModal({prefillName:term,draft:jobDraftState,stateMachine:flow,onSaved:(client,draftState)=>{allowAdHocClient=false;jobDraftState=null;contacts.push(client);clientInput.value=client.name||term;clientInput.dataset.clientId=client.id;phoneInput.value=client.phone||"";addressInput.value=client.address||"";renderClientPianoOptions(client);refreshInlinePianoRegistration();},onCancelled:()=>{jobDraftState=null;}});}}});
 bindPredictiveInput(pianoInput,document.getElementById("jobPianoSuggestions"),()=>ownedPianosForClient(selectedClient()),{search:p=>[p.brand,p.model,p.serial_no,p.finish,p.display_name].filter(Boolean).join(" "),label:p=>pianoDisplayName(p),secondary:p=>workflowPianoSecondary(p),onSelect:p=>{pianoInput.value=pianoDisplayName(p);pianoInput.dataset.pianoId=p.id;refreshInlinePianoRegistration();}});
 const attachWorkflow=document.getElementById("jobAttachWorkflow"),workflowOptions=document.getElementById("jobWorkflowOptions"),workflowAction=document.getElementById("jobWorkflowAction"),existingField=document.getElementById("jobWorkflowExistingField");const refreshWorkflowOptions=()=>{workflowOptions?.classList.toggle("hidden",!attachWorkflow?.checked);existingField?.classList.toggle("hidden",!attachWorkflow?.checked||workflowAction?.value!=="ATTACH");};attachWorkflow?.addEventListener("change",refreshWorkflowOptions);workflowAction?.addEventListener("change",refreshWorkflowOptions);refreshWorkflowOptions();

 function recalculateDuration(){const minutes=wallClockDifferenceMinutes(startInput.value,endInput.value);if(minutes>0){minutesInput.value=String(minutes);hoursInput.value=String(minutes/60);durationLabel.textContent=`${bi('Planned duration','Tervezett időtartam')}: ${formatDurationLabel(minutes)}`;}else{durationLabel.textContent=`${bi('Planned duration','Tervezett időtartam')}: —`;}}
 async function refreshDailyRateCapacity(){
   const enabled=dailyToggle.checked,allocationField=document.getElementById('dailyRateAllocationField');dailyAmountInput.disabled=!enabled;if(allocationField)allocationField.classList.toggle('hidden',!enabled);
   if(!enabled){dailyAmountInput.value='0';capacityLabel.textContent=bi('Daily rate disabled.','Napidíj kikapcsolva.');return null;}
   const userId=assignedInput.value,date=String(startInput.value||'').slice(0,10);if(!userId||!date){capacityLabel.textContent=bi('Select employee and date.','Válassz munkavállalót és dátumot.');return null;}
   try{const q=new URLSearchParams({date});if(row?.id)q.set('job_id',row.id);const cap=await api(`/api/employee-daily-rates/${encodeURIComponent(userId)}/capacity?${q}`);const allocation=Number(cap.suggested_allocation||0);dailyAmountInput.value=String(allocation);capacityLabel.dataset.available=String(cap.available||0);capacityLabel.dataset.suggestedAllocation=String(allocation);if(cap.base_rate_already_activated)capacityLabel.textContent=`${bi('Daily base already activated by an earlier job. This job allocation','A napi alapdíj egy korábbi munkánál már aktiválva lett. Ennek a munkának az allokációja')}: ${money(0)}`;else if(cap.current_owns_base)capacityLabel.textContent=`${bi('This job carries the technician daily base','Ez a munka hordozza a technikus napi alapdíját')}: ${money(300)}`;else capacityLabel.textContent=`${bi('Available technician daily base','Elérhető technikusi napi alapdíj')}: ${money(300)} · ${bi('This job will activate it once.','Ez a munka egyszer aktiválja.')}`;return cap;}catch(error){capacityLabel.dataset.available='0';capacityLabel.textContent=String(error.message||error);return null;}
 }
 bindJobDateTimePicker('jobStart',()=>{recalculateDuration();refreshDailyRateCapacity();});bindJobDateTimePicker('jobEnd',recalculateDuration);
 startInput.addEventListener('change',()=>{recalculateDuration();refreshDailyRateCapacity();});endInput.addEventListener('change',recalculateDuration);assignedInput.addEventListener('change',refreshDailyRateCapacity);dailyToggle.addEventListener('change',refreshDailyRateCapacity);
 bindWorkerAvailability(assignedInput,startInput,endInput,row?.id||"");
 toggleInstructionsField();recalculateDuration();await refreshDailyRateCapacity();applyLanguageToDOM(document.getElementById("modal"));

 $("#form").onsubmit=async ev=>{
   ev.preventDefault();let b=Object.fromEntries(new FormData(ev.target));
   if(!validateDateField(startInput)||!validateDateField(endInput))return;if(wallClockDifferenceMinutes(b.start_time,b.end_time)<=0){showError("INVALID_TIME_RANGE");return}
   const timesUnchanged=Boolean(row?.id&&String(b.start_time||'').slice(0,16)===String(row.start_time||'').slice(0,16)&&String(b.end_time||'').slice(0,16)===String(row.end_time||'').slice(0,16));
   if(!timesUnchanged&&(!isFiveMinuteDateTime(b.start_time)||!isFiveMinuteDateTime(b.end_time))){showError("INVALID_TIME_STEP");return}
   const plannedMinutes=wallClockDifferenceMinutes(b.start_time,b.end_time);if(!Number.isFinite(plannedMinutes)||plannedMinutes<SCHEDULE_INTERVAL_MINUTES){showError("INVALID_PLANNED_DURATION");return}
   if(b.job_type==="Part-work"&&!(b.instructions||"").trim()){appAlert(bi("Remaining tasks are required for part-work.","Részmunka esetén a hátralévő feladatok megadása kötelező."),"warning");return;}
   b.planned_minutes=plannedMinutes;b.planned_hours=plannedMinutes/60;b.planned_amount=Number(b.planned_amount||0);b.technician_extra_compensation=Math.max(0,Number(b.technician_extra_compensation||0));b.travel_minutes=0;b.priority=row?.priority||"Medium";b.daily_rate_enabled=dailyToggle.checked;b.daily_rate_allocated_amount=dailyToggle.checked?Number(dailyAmountInput.value||0):0;
   if(dailyToggle.checked){const cap=await refreshDailyRateCapacity();if(!cap)return;b.daily_rate_allocated_amount=Number(cap.suggested_allocation||0);}
   if(row?.id){b.id=row.id;b.job_id=row.id;}if(row?.job_key)b.job_key=row.job_key;b.client_id=clientInput.dataset.clientId||null;b.piano_id=pianoInput.dataset.pianoId||null;b.allow_ad_hoc_client=allowAdHocClient;
   const matchedClient=contacts.find(c=>(c.name||"").trim().toLowerCase()===(b.client_name||"").trim().toLowerCase());if(matchedClient){b.client_id=matchedClient.id;b.allow_ad_hoc_client=false;}
   const ownedPianos=matchedClient?ownedPianosForClient(matchedClient):[];const matchedPiano=allowAdHocClient?null:ownedPianos.find(p=>String(p.display_name||`${p.brand||""} ${p.model||""}`.trim()).trim().toLowerCase()===(b.piano_name||"").trim().toLowerCase());if(matchedPiano)b.piano_id=matchedPiano.id;else if(!String(b.piano_name||"").trim())b.piano_id=null;
   if(!matchedClient&&!allowAdHocClient){const flow=createNestedClientStateMachine(b);jobDraftState=flow.begin(b.client_name,b);openNestedClientModal({prefillName:b.client_name,draft:jobDraftState,stateMachine:flow,onSaved:(client,draftState)=>{jobDraftState=null;return openJob(draftState.start_time,null,draftState);},onCancelled:(draftState)=>{jobDraftState=null;return openJob(draftState.start_time,null,draftState);}});return;}
   if(String(b.piano_name||"").trim()&&!matchedPiano&&!allowAdHocClient){openNestedJobPianoModal({client:matchedClient,draft:b,onSaved:piano=>{pianos.push({...piano,owner_contact_id:matchedClient.id,client_id:matchedClient.id});pianoInput.value=piano.display_name||`${piano.brand||""} ${piano.model||""}`.trim();pianoInput.dataset.pianoId=piano.id;refreshInlinePianoRegistration();}});return;}
   try{let saved=row?await api(`/api/jobs/${encodeURIComponent(jobRef(row))}`,{method:"PUT",body:JSON.stringify(b)}):await api("/api/jobs",{method:"POST",body:JSON.stringify(b)});const jobId=saved.id||saved.job_id||jobRef(saved);const wantsWorkflow=document.getElementById("jobAttachWorkflow")?.checked;if(wantsWorkflow){const action=document.getElementById("jobWorkflowAction")?.value||"CREATE",payload={action};if(action==="ATTACH"){payload.workflow_id=document.getElementById("jobExistingWorkflow")?.value||"";if(!payload.workflow_id)throw new Error(bi("Select an open workflow to attach.","Válassz csatolandó nyitott workflow-t."));}else{payload.title=b.title;payload.final_due_at=b.end_time;payload.notes=b.notes||"";}const linked=await api(`/api/jobs/${encodeURIComponent(jobId)}/workshop-workflow`,{method:"POST",body:JSON.stringify(payload)});saved={...saved,workshop_workflow_id:linked.workflow?.id||null,linked_workshop_workflow_id:linked.workflow?.id||null};}else if(existingWorkflowId){await api(`/api/jobs/${encodeURIComponent(jobId)}/workshop-workflow`,{method:"POST",body:JSON.stringify({action:"DETACH"})});saved={...saved,workshop_workflow_id:null,linked_workshop_workflow_id:null};}currentWeekStart=startOfWeek(saved.start_time||b.start_time);closeModal();await refreshCalendarAfterMutation(saved);}catch(err){showError(err)}
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
  <p><b>${bi('Estimated','Előzetes összeg')}:</b> ${money(j.planned_amount)}</p>
  <p><b>${bi('Daily Rate','Napidíj')}:</b> ${Number(j.daily_rate_enabled||0)===1?`${bi('Yes','Igen')} · ${money(j.daily_rate_allocated_amount||0)} · ${htmlText(j.daily_rate_date||'')}`:bi('No','Nem')}</p>
  <p><b>${bi('Status','Státusz')}:</b> <span class="badge ${htmlText(String(j.status||'').split(' ')[0])}">${htmlText(jobStatusLabel(j.status))}</span></p>
  ${closed?`<p class="muted"><b>${bi('View only','Csak megtekintés')}:</b> ${bi('This job has already been closed or partially closed.','Ez a munka már lezárt vagy részlegesen lezárt.')}</p>`:''}
  ${instructions}
  ${j.notes?`<p><b>${bi('Notes','Megjegyzés')}:</b><br><span data-i18n-exempt>${htmlText(j.notes).replaceAll('\n','<br>')}</span></p>`:''}
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
function openCloseJob(j){$("#modalTitle").textContent=bi("Close Job","Munka lezárása");$("#form").innerHTML=`<p class="muted">${bi("The approved billed amount is authoritative. Closing the job automatically generates the customer invoice and, when applicable, the contractor payable.","A jóváhagyott számlázandó összeg a mérvadó. A munka lezárása automatikusan létrehozza az ügyfélszámlát és szükség esetén a partneri kötelezettséget.")}</p><div class="form-grid">
<div class="field"><label>${req("Close type / Lezárás típusa")}</label><select name="close_type" id="closeType" onchange="toggleNextJob()"><option>Full</option><option>Partial</option><option>Failed</option></select></div>
<div class="field"><label>${req("Billed amount / Számlázandó összeg")}</label><input name="billed_amount" type="number" value="${j.planned_amount||0}" required></div>
<div class="field"><label>${req("Payment method / Fizetési mód")}</label><select name="payment_method" required>${standardPaymentMethodOptions()}</select></div>

<div class="field full"><label>${req("Close description / Elvégzett munka leírása")}</label><textarea name="close_description" required></textarea></div>
<div id="nextJobFields" class="field full hidden"><h3>Next job / Következő feladat</h3><div class="form-grid"><div class="field full"><label>${req("Next title / Következő feladat neve")}</label><input name="next_title"></div><div class="field"><label>${req("Next assigned to / Következő felelős")}</label><select id="nextAssignedUser" name="next_assigned_user_id">${workerSelectOptions(j.assigned_user_id,j.assigned_to)}</select><small class="worker-availability-hint" aria-live="polite"></small></div><div class="field"><label>Next priority / Következő prioritás</label><select name="next_priority"><option>Critical</option><option>Urgent</option><option>High</option><option selected>Medium</option><option>Low</option></select></div><div class="field"><label>${req("Next start / Következő kezdés")}</label><input id="nextJobStart" name="next_start_time" type="datetime-local" step="900"></div><div class="field"><label>${req("Next end / Következő befejezés")}</label><input id="nextJobEnd" name="next_end_time" type="datetime-local" step="900"></div><div class="field"><label>Next planned amount / Következő tervezett összeg</label><input name="next_planned_amount" type="number" value="0"></div><div class="field full"><label>Next pricing basis / Következő díjmegállapítás</label><input name="next_pricing_basis"></div><div class="field full"><label>Next address / Következő cím</label><input name="next_service_address" value="${j.service_address||""}"></div><div class="field full"><label>Next instructions / Következő teendők</label><textarea name="next_instructions"></textarea></div><div class="field full"><label>Next notes / Következő megjegyzés</label><textarea name="next_notes"></textarea></div></div></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Save closeout / Lezárás mentése</button></div>`;
bindWorkerAvailability(document.getElementById("nextAssignedUser"),document.getElementById("nextJobStart"),document.getElementById("nextJobEnd"));
$("#form").onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),body=Object.fromEntries(fd.entries()),billed=Number(body.billed_amount),payment=body.payment_method;if(billed>0&&!payment){appAlert(bi("Payment method is required when billed amount is greater than zero.","Fizetési mód kötelező, ha az összeg nagyobb mint 0."),"warning");return}
if(body.close_type==="Partial"){
 const required=["next_title","next_assigned_user_id","next_start_time","next_end_time"];
 if(required.some(field=>!body[field])){showError("PARTIAL_CLOSE_NEXT_JOB_REQUIRED");return;}
 if(wallClockDifferenceMinutes(body.next_start_time,body.next_end_time)<=0){showError("INVALID_TIME_RANGE");return;}
 if(!isFiveMinuteDateTime(body.next_start_time)||!isFiveMinuteDateTime(body.next_end_time)){showError("INVALID_TIME_STEP");return;}
}
Object.assign(body,{id:j.id||"",job_id:j.id||"",job_key:j.job_key||"",client_id:j.client_id||"",client_name:j.client_name||"",piano_name:j.piano_name||"",title:j.title||""});
if(body.close_type==="Full"&&!await appConfirm(bi("Close the entire workflow? Every earlier linked part-work will also become fully completed.","Lezárod a teljes munkafolyamatot? Minden korábbi kapcsolódó részmunka is teljesen lezárttá válik."),{type:"warning",confirmText:bi("Close entire workflow","Teljes munkafolyamat lezárása")})) return;
try{const saved=await api(`/api/jobs/${encodeURIComponent(jobRef(j))}/close`,{method:"POST",body:JSON.stringify(body)});closeModal();await refreshCalendarAfterMutation(saved)}catch(err){showError(err)}}}
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
 const clean=[p?.brand,p?.model].filter(Boolean).join(" ").trim();
 return String(clean||p?.display_name||p?.original_description||bi("Unknown piano","Ismeretlen zongora"));
}
function pianoAgeValue(buildYear){
 const year=Number(buildYear),currentYear=new Date().getFullYear();
 return Number.isInteger(year)&&year>0&&year<=currentYear?currentYear-year:null;
}
function pianoAgeText(p){
 const age=pianoAgeValue(p?.build_year);
 if(age===null)return "";
 return currentLang==="hu"?`${p.build_year} (${age} éves)`: `${p.build_year} (${age} ${age===1?"year old":"years old"})`;
}
function pianoSizeText(p){
 if(p?.size_display)return String(p.size_display);
 const cm=String(p?.size_cm||"").trim(),inch=String(p?.size_in||"").trim();
 return [cm?`${cm} cm`:"",inch?`(${inch})`:""].filter(Boolean).join(" ");
}
function pianoReferenceMeta(p,{includeSerial=true}={}){
 const parts=[];
 if(includeSerial&&p?.serial_no)parts.push(`Serial: #${p.serial_no}`);
 if(p?.model){const size=pianoSizeText(p);parts.push(`${bi("Model","Modell")} ${p.model}${size?` (${size.replace(/^([^()]+) \((.+)\)$/,'$1 / $2')})`:""}`);}
 else if(pianoSizeText(p))parts.push(pianoSizeText(p));
 if(p?.finish)parts.push(`${bi("Finish","Kivitel")}: ${p.finish}`);
 if(p?.build_year)parts.push(pianoAgeText(p));
 return parts.filter(Boolean).join(" · ");
}
async function uploadSteinwayReferenceExcel(){
 if(!isAdmin())return showError("PERMISSION_DENIED");
 const input=document.createElement("input");
 input.type="file";
 input.accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
 input.onchange=async()=>{
  const file=input.files?.[0];
  if(!file)return;
  const form=new FormData();
  form.append("file",file);
  try{
   const result=await api("/api/pianos/import-reference",{method:"POST",body:form});
   await appAlert(result?.message||"141 serial reference rows detected, 8 Steinway models detected. Import successful.","success");
  }catch(error){
   const details=error?.details||{};
   const extra=details.detected_serial_rows!=null?` · ${bi("Detected serial rows","Felismert sorozatszám-sorok")}: ${details.detected_serial_rows} · ${bi("Models","Modellek")}: ${details.detected_model_rows??0}`:"";
   showError({message:`${bi("Steinway reference import failed","A Steinway referencia importálása sikertelen")}: ${error?.message||error}${extra}`});
  }
 };
 input.click();
}
async function pianoReferenceLookup({serial="",brand="",model="",q=""}={}){
 const params=new URLSearchParams();
 if(serial)params.set("serial",serial);
 if(brand)params.set("brand",brand);
 if(model)params.set("model",model);
 if(q)params.set("q",q);
 return api(`/api/pianos/lookup?${params.toString()}`);
}
function applyPianoReferenceToForm(form,result){
 if(!form||!result)return;
 const set=(name,value)=>{const field=form.querySelector(`[name="${name}"]`);if(field&&value!==null&&value!==undefined&&String(value)!==""&&field.dataset.manualOverride!=="1")field.value=value;};
 const piano=result.match_type==="EXISTING_RECORD"&&result.piano?result.piano:null;
 if(piano){set("brand",piano.brand);set("model",piano.model);set("build_year",piano.build_year||piano.year);set("size_cm",piano.size_cm);set("size_in",piano.size_in||piano.size_inch);}
 else{set("brand",result.brand);set("model",result.model);set("build_year",result.build_year);set("size_cm",result.size_cm);set("size_in",result.size_inch);}
 const status=form.querySelector("[data-steinway-reference-status],[data-piano-reference-status]");
 if(status){
  const source=result.match_type==="EXISTING_RECORD"?bi("Existing piano found","Meglévő zongora található"):result.match_type==="REFERENCE_SUGGESTION"?bi("Steinway reference matched","Steinway referencia találat"):bi("No reference match","Nincs referencia találat");
  const year=result.build_year||piano?.build_year||piano?.year||null;
  status.textContent=`${source}${year?` · ${pianoAgeText({build_year:year})}`:""}`;
  status.dataset.matchType=result.match_type||"";
  status.dataset.existingPianoId=result.existing_piano_id||piano?.id||"";
 }
}
let steinwayLookupTimer=null;
function bindSteinwayReferenceForm(root=document,options={}){
 const names={brandName:"brand",modelName:"model",serialName:"serial_no",yearName:"build_year",cmName:"size_cm",inchName:"size_in",...options};
 const serial=root.querySelector(`[name="${names.serialName}"]`),brand=root.querySelector(`[name="${names.brandName}"]`),model=root.querySelector(`[name="${names.modelName}"]`);
 if(!serial&&!brand&&!model)return;
 [names.brandName,names.modelName,names.yearName,names.cmName,names.inchName].map(name=>root.querySelector(`[name="${name}"]`)).filter(Boolean).forEach(field=>field.addEventListener("input",event=>{if(event.isTrusted)field.dataset.manualOverride="1";}));
 const schedule=()=>{
  clearTimeout(steinwayLookupTimer);
  steinwayLookupTimer=setTimeout(async()=>{
   const serialValue=serial?.value.trim()||"",brandValue=brand?.value.trim()||"",modelValue=model?.value.trim()||"";
   if(!serialValue&&!brandValue&&!modelValue)return;
   try{applyPianoReferenceToForm(root,await pianoReferenceLookup({serial:serialValue,brand:brandValue,model:modelValue}));}catch(_error){}
  },180);
 };
 [serial,brand,model].filter(Boolean).forEach(field=>{field.addEventListener("input",schedule);field.addEventListener("change",schedule);field.addEventListener("blur",schedule);});
 schedule();
}
async function deletePianoPermanently(id){
 if(!isSuperadmin())return showError(bi("Superadmin only.","Csak szuperadmin törölhet véglegesen zongorát."));
 const ok=await appConfirm(bi("Permanently delete this piano and detach all related references? This cannot be undone.","Véglegesen törlöd ezt a zongorát és lecsatolod az összes kapcsolódó hivatkozását? A művelet nem vonható vissza."),{type:"error",confirmText:bi("Delete Piano","Zongora törlése")});
 if(!ok)return;
 try{await api(`/api/pianos/${encodeURIComponent(id)}`,{method:"DELETE"});closeModal();showToast(bi("Piano permanently deleted.","A zongora véglegesen törölve."),"success");await renderPianos();}catch(error){showError(error);}
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
 if(search){search.removeAttribute("oninput");search.oninput=()=>{currentPianoSearch=search.value;currentPianoPage=1;renderPianoResults();};}
 const numbers=[...document.querySelectorAll("#pianoFilterPanel input[type=number]")];
 if(numbers[0]){numbers[0].removeAttribute("oninput");numbers[0].oninput=()=>{currentPianoMinValue=numbers[0].value;currentPianoPage=1;renderPianoResults();};}
 if(numbers[1]){numbers[1].removeAttribute("oninput");numbers[1].oninput=()=>{currentPianoMaxValue=numbers[1].value;currentPianoPage=1;renderPianoResults();};}
}
async function renderPianos(){
 const data=await api("/api/pianos");
 pianosRenderData=Array.isArray(data)?data:[];
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
 $("#pianos").innerHTML=`<div class="panel piano-list-panel"><div class="toolbar"><h3>${bi("Pianos","Zongorák")}</h3><div class="toolbar-actions">${isAdmin()?`<button class="small" onclick="openPianoImportModal()">${bi("Import Excel","Excel import")}</button><button class="small ghost-btn" onclick="uploadSteinwayReferenceExcel()">${bi("Import Steinway Reference","Steinway referencia import")}</button>`:""}<button class="small" onclick="exportTable('pianos')">Export CSV</button><button onclick="openForm('pianos')">+ ${bi("Add","Új")}</button>${resetButton}</div></div><button id="pianoFilterToggle" type="button" class="mobile-filter-toggle" aria-expanded="${mobilePianoFiltersOpen}" onclick="toggleMobileFilterPanel('pianoFilterPanel','pianoFilterToggle','pianos')">⌕ ${bi("Filters","Szűrők")}</button><div id="pianoFilterPanel" class="piano-filter-grid piano-filter-grid-no-status mobile-collapsible-filter ${mobilePianoFiltersOpen?"open":""}"><label>${bi("Search","Keresés")}<input id="pianoSearchInput" value="${htmlText(currentPianoSearch)}" placeholder="${bi("Client, piano, serial number or address","Ügyfél, zongora, gyári szám vagy cím")}"></label><label>${bi("Ownership","Tulajdon")}<select onchange="currentPianoOwnershipFilter=this.value;currentPianoPage=1;renderPianos()">${ownerOptionHtml}</select></label><label>${bi("Minimum value (USD)","Minimum érték (USD)")}<input type="number" min="0" value="${htmlText(currentPianoMinValue)}"></label><label>${bi("Maximum value (USD)","Maximum érték (USD)")}<input type="number" min="0" value="${htmlText(currentPianoMaxValue)}"></label><div class="piano-filter-actions"><button type="button" class="small ghost-btn" onclick="clearPianoFilters()">${bi("Clear filters","Szűrők törlése")}</button></div></div>${pagination}<div class="table-scroll-top" id="pianosScrollTop" aria-label="${bi("Horizontal table scroll","Vízszintes táblázatgörgetés")}"><div class="table-scroll-spacer"></div></div><div class="table-wrap contacts-table-wrap pianos-table-wrap" id="pianosTableWrap"><table><thead><tr>${cols.map(c=>`<th>${label[c]}</th>`).join("")}<th>${bi("Actions","Műveletek")}</th></tr></thead><tbody>${pageRows.map(r=>`<tr><td class="piano-owner-cell ${!r.owner_contact_id?'piano-owner-unidentified':''}">${htmlText(pianoOwnerLabel(r))}</td><td>${htmlText(pianoDisplayName(r))}</td><td>${htmlText(r.serial_no||'—')}</td><td>${mapLink(r.location)||'—'}</td><td>${htmlText(r.ownership_type||r.ownership||'—')}</td><td>${money(r.estimated_value)}</td><td class="piano-actions"><button class="small" onclick="pianoInfo('${r.id}')">${bi("Info","Információ")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteGenericResource('pianos','${r.id}')">${bi("Delete","Törlés")}</button>`:""}</td></tr>`).join("")||`<tr><td colspan="7" class="muted">${bi("No matching pianos","Nincs találat")}</td></tr>`}</tbody></table></div>${pagination}</div>`;
 bindPianoFilterDebounce();
 requestAnimationFrame(setupPianoTableScroll);
 applyLanguageToDOM();
}
function pianoResultState(data=pianosRenderData){
 const min=currentPianoMinValue===""?null:Number(currentPianoMinValue),max=currentPianoMaxValue===""?null:Number(currentPianoMaxValue);
 const filtered=(Array.isArray(data)?data:[]).filter(p=>{
  if(!pianoSearchMatch(p,currentPianoSearch))return false;
  if(currentPianoOwnershipFilter!=="ALL"&&pianoOwnershipGroup(p)!==currentPianoOwnershipFilter)return false;
  const value=Number(p.estimated_value||0);
  if(min!==null&&(!Number.isFinite(value)||value<min))return false;
  if(max!==null&&(!Number.isFinite(value)||value>max))return false;
  return true;
 });
 const totalPages=Math.max(1,Math.ceil(filtered.length/PIANOS_PER_PAGE));
 currentPianoPage=Math.min(Math.max(1,currentPianoPage),totalPages);
 const start=(currentPianoPage-1)*PIANOS_PER_PAGE;
 return {pageRows:filtered.slice(start,start+PIANOS_PER_PAGE),pagination:pianoPaginationHtml(currentPianoPage,totalPages,filtered.length)};
}
function renderPianoResults(){
 const state=pianoResultState();
 const tbody=document.querySelector("#pianosTableWrap tbody");
 if(tbody)tbody.innerHTML=state.pageRows.map(r=>`<tr><td class="piano-owner-cell ${!r.owner_contact_id?'piano-owner-unidentified':''}">${htmlText(pianoOwnerLabel(r))}</td><td>${htmlText(pianoDisplayName(r))}</td><td>${htmlText(r.serial_no||'—')}</td><td>${mapLink(r.location)||'—'}</td><td>${htmlText(r.ownership_type||r.ownership||'—')}</td><td>${money(r.estimated_value)}</td><td class="piano-actions"><button class="small" onclick="pianoInfo('${r.id}')">${bi("Info","Információ")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteGenericResource('pianos','${r.id}')">${bi("Delete","Törlés")}</button>`:""}</td></tr>`).join("")||`<tr><td colspan="7" class="muted">${bi("No matching pianos","Nincs találat")}</td></tr>`;
 document.querySelectorAll("#pianos .client-pagination").forEach(pagination=>{pagination.outerHTML=state.pagination;});
}
async function pianoInfo(id){
 let p,history=[];try{[p,history]=await Promise.all([api(`/api/pianos/${encodeURIComponent(id)}`),api(`/api/pianos/${encodeURIComponent(id)}/inspection-history`).catch(()=>[])]);}catch(_error){return showError(bi('Piano not found.','A zongora nem található.'));}
 const owner={name:p.owner_name};$("#modal").classList.remove("hidden");$("#modalTitle").textContent=bi("Piano information","Zongora információ");
 const importInfo=isAdmin()?`<details class="piano-import-info"><summary>${bi("Import information","Importálási információk")}</summary><p><b>${bi("External reference","Külső referencia")}:</b> ${htmlText(p.external_reference||'—')}</p><p><b>${bi("Import source","Importforrás")}:</b> ${htmlText(p.import_source||'—')}</p><p><b>${bi("Import batch","Importköteg")}:</b> ${htmlText(p.import_batch_id||'—')}</p><p><b>${bi("Owner resolution","Tulajdonosi feloldás")}:</b> ${htmlText(p.owner_resolution||'—')}</p><p><b>${bi("Original description","Eredeti leírás")}:</b> ${htmlText(p.original_description||'—')}</p></details>`:'';
 const inspectionHistory=`<section class="piano-inspection-history"><h3>${bi("Inspection History","Állapotfelmérési előzmények")}</h3>${history.length?history.map(item=>`<article><div><strong>${htmlText(item.inspection_type||"")}</strong><span>${htmlText(item.inspection_status||"")}</span><small>${htmlText(item.inspected_at||item.created_at||"")} · ${htmlText(item.inspected_by||"—")}</small></div><a href="${htmlText(item.file_path)}" target="_blank" rel="noopener">${htmlText(item.original_filename||bi("Open document","Dokumentum megnyitása"))} ↗</a></article>`).join(""):`<p class="muted">${bi("No inspection history yet.","Még nincs állapotfelmérési előzmény.")}</p>`}</section>`;
 $("#form").innerHTML=`<div class="work-card piano-info-card"><div class="piano-info-grid"><p><b>Piano ID:</b> ${htmlText(p.id)}</p><p><b>${bi("Client / owner","Ügyfél / tulajdonos")}:</b> ${htmlText(owner?.name||pianoOwnerLabel(p))}</p><p><b>${bi("Piano","Zongora")}:</b> ${htmlText(pianoDisplayName(p))}</p><p><b>${bi("Serial number","Gyári szám")}:</b> ${htmlText(p.serial_no||'—')}</p><p><b>${bi("Brand","Márka")}:</b> ${htmlText(p.brand||'—')}</p><p><b>${bi("Model","Modell")}:</b> ${htmlText(p.model||'—')}</p><p><b>${bi("Finish","Kivitel")}:</b> ${htmlText(p.finish||'—')}</p><p><b>${bi("Year","Év")}:</b> ${htmlText(p.year||'—')}</p><p><b>${bi("Build year","Gyártási év")}:</b> ${htmlText(p.build_year?pianoAgeText(p):'—')}</p><p><b>${bi("Size","Méret")}:</b> ${htmlText(pianoSizeText(p)||'—')}</p><p><b>${bi("Location","Helyszín")}:</b> ${mapLink(p.location)||'—'}</p><p><b>${bi("Ownership","Tulajdon")}:</b> ${htmlText(p.ownership_type||p.ownership||'—')}</p><p><b>${bi("Estimated value","Becsült érték")}:</b> ${money(p.estimated_value)}</p><p class="full"><b>${bi("Notes","Megjegyzés")}:</b> ${htmlText(p.notes||'—')}</p></div>${inspectionHistory}${importInfo}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Close","Bezár")}</button>${!p.owner_contact_id?`<button type="button" class="small" onclick="openPianoEdit('${p.id}',true)">${bi("Assign customer","Ügyfél hozzárendelése")}</button>`:''}<button type="button" onclick="openPianoEdit('${p.id}')">${bi("Edit","Szerkesztés")}</button>${isSuperadmin()?`<button type="button" class="danger-btn" onclick="deletePianoPermanently('${p.id}')">${bi("Delete Piano","Zongora törlése")}</button>`:""}</div>`;$("#form").onsubmit=e=>e.preventDefault();applyLanguageToDOM(document.getElementById('modal'));
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
 const grid=document.querySelector('#form .form-grid');
 if(grid&&!grid.querySelector('[data-steinway-reference-status]'))grid.insertAdjacentHTML('beforeend',`<div class="field full steinway-reference-status"><small data-steinway-reference-status></small></div>`);
 bindSteinwayReferenceForm(document.getElementById('form'));
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
 contactsRenderData={data,pianos};
 const previousSearch=currentClientSearch;
 const q=previousSearch.trim().toLowerCase();
 const pianosByOwner=new Map();
 pianos.forEach(p=>{const key=String(p.owner_contact_id||"");if(!key)return;const rows=pianosByOwner.get(key)||[];rows.push(p);pianosByOwner.set(key,rows);});
 const enriched=data.map(c=>({...c,_ownedPianoCount:(pianosByOwner.get(String(c.id))||[]).length}));
 const missingCount=enriched.filter(clientHasMissingCoreData).length;
 const filtered=enriched.filter(c=>{
   if(showOnlyMissingClientData && !clientHasMissingCoreData(c)) return false;
   if(currentClientStatusFilter!=="ALL" && customerStatusCode(c)!==currentClientStatusFilter) return false;
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
 $("#contacts").innerHTML=`<div class="panel"><div class="toolbar"><h3>${bi("Clients","Ügyfelek")}</h3><div class="toolbar-actions">${isAdmin()?`<button class="small" onclick="openClientImportModal()">${bi("Import Excel","Excel import")}</button>`:""}<button type="button" class="small missing-data-btn ${showOnlyMissingClientData?"active":""}" ${missingCount===0?"disabled":""} onclick="toggleMissingClientData()">${bi("Missing Data","Hiányzó adatok")} (${missingCount})</button><button class="small" onclick="exportTable('contacts')">Export CSV</button><button onclick="openForm('contacts')">+ ${bi("Add","Új")}</button></div></div><button id="clientFilterToggle" type="button" class="mobile-filter-toggle" aria-expanded="${mobileClientFiltersOpen}" onclick="toggleMobileFilterPanel('clientFilterPanel','clientFilterToggle','contacts')">⌕ ${bi("Filters","Szűrők")}</button><div id="clientFilterPanel" class="client-search client-search-grid mobile-collapsible-filter ${mobileClientFiltersOpen?"open":""}"><label>${tr("searchClients")}<input id="clientSearchInput" value="${previousSearch.replaceAll('"','&quot;')}" placeholder="${tr("searchPlaceholder")}"></label><label>${tr("customerStatus")}<select id="clientStatusFilter" onchange="currentClientStatusFilter=this.value;currentClientPage=1;render('contacts')">${customerStatusOptions()}</select></label></div><p class="muted customer-status-help">🎹 ${tr("ownerClient")} · 🛒 ${tr("buyerLead")} · 🎹🛒 ${tr("ownerBuyerLead")} · 👤 ${tr("generalContact")}</p>${pagination}<div class="table-scroll-top" id="contactsScrollTop" aria-label="${bi("Horizontal table scroll","Vízszintes táblázatgörgetés")}"><div class="table-scroll-spacer"></div></div><div class="table-wrap contacts-table-wrap" id="contactsTableWrap"><table><thead><tr>${s.cols.map(c=>`<th>${headerLabel('contacts',c)}</th>`).join("")}<th>${bi("Actions","Műveletek")}</th></tr></thead><tbody>${pageRows.map(r=>`<tr>${s.cols.map(c=>`<td>${cellValue('contacts',c,r)}</td>`).join("")}<td><button class="small" onclick="clientProfile('${r.id}')">${bi("Profile","Adatlap")}</button><button class="small" onclick='openForm("contacts",${esc(r)})'>${bi("Edit","Szerkesztés")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteGenericResource('contacts','${r.id}')">${bi("Delete","Törlés")}</button>`:""}</td></tr>`).join("")||`<tr><td colspan="${s.cols.length+1}" class="muted">${bi("No matching clients","Nincs találat")}</td></tr>`}</tbody></table></div>${pagination}</div>`;
 const input=document.getElementById("clientSearchInput");
 if(input){input.removeAttribute("oninput");input.oninput=()=>{currentClientSearch=input.value;currentClientPage=1;renderContactResults();};}
 requestAnimationFrame(setupContactTableScroll);
}
function contactsRowsMarkup(pageRows){
 const s=schemas.contacts;
 return pageRows.map(r=>`<tr>${s.cols.map(c=>`<td>${cellValue('contacts',c,r)}</td>`).join("")}<td><button class="small" onclick="clientProfile('${r.id}')">${bi("Profile","Adatlap")}</button><button class="small" onclick='openForm("contacts",${esc(r)})'>${bi("Edit","Szerkesztés")}</button>${isSuperadmin()?` <button class="small danger-btn" onclick="deleteGenericResource('contacts','${r.id}')">${bi("Delete","Törlés")}</button>`:""}</td></tr>`).join("")||`<tr><td colspan="${s.cols.length+1}" class="muted">${bi("No matching clients","Nincs találat")}</td></tr>`;
}
function contactResultState(){
 const {data,pianos}=contactsRenderData;
 const q=currentClientSearch.trim().toLowerCase();
 const pianosByOwner=new Map();
 pianos.forEach(p=>{const key=String(p.owner_contact_id||"");if(!key)return;const rows=pianosByOwner.get(key)||[];rows.push(p);pianosByOwner.set(key,rows);});
 const enriched=data.map(c=>({...c,_ownedPianoCount:(pianosByOwner.get(String(c.id))||[]).length}));
 const filtered=enriched.filter(c=>{
  if(showOnlyMissingClientData&&!clientHasMissingCoreData(c))return false;
  if(currentClientStatusFilter!=="ALL"&&customerStatusCode(c)!==currentClientStatusFilter)return false;
  const owned=pianosByOwner.get(String(c.id))||[];
  const hay=[c.name,c.company,c.email,c.phone,c.address,c.notes,customerStatusTitle(c),...owned.flatMap(p=>[p.brand,p.model,p.display_name,p.serial_no])].join(" ").toLowerCase();
  return hay.includes(q);
 });
 const totalPages=Math.max(1,Math.ceil(filtered.length/CLIENTS_PER_PAGE));
 currentClientPage=Math.min(Math.max(1,currentClientPage),totalPages);
 const start=(currentClientPage-1)*CLIENTS_PER_PAGE;
 return {pageRows:filtered.slice(start,start+CLIENTS_PER_PAGE),pagination:clientPaginationHtml(currentClientPage,totalPages,filtered.length)};
}
function renderContactResults(){
 const state=contactResultState();
 const tbody=document.querySelector("#contactsTableWrap tbody");
 if(tbody)tbody.innerHTML=contactsRowsMarkup(state.pageRows);
 document.querySelectorAll("#contacts .client-pagination").forEach(pagination=>{pagination.outerHTML=state.pagination;});
}
async function deleteGenericResource(key,id){
 if(!isSuperadmin()) return showError("PERMISSION_DENIED");
 const s=schemas[key];
 if(!s || !await appConfirm(bi("Delete this item?","Töröljük ezt a tételt?"),{type:"error",confirmText:bi("Delete","Törlés")})) return;
 try{await api(`/api/${s.api}/${encodeURIComponent(id)}`,{method:"DELETE"}); await render(key);}catch(err){showError(err)}
}
function htmlText(value){const rawValue=value==null?"":String(value).trim();const safe=sanitizeSafeText(value,rawValue==="—"?"—":"");return String(safe).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
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
 $("#form").innerHTML=`<div class="work-card"><h4><span class="customer-status-icon">${customerStatusIcon({...p.client,_ownedPianoCount:p.pianos.length})}</span> ${p.client.name} · ${p.client.id}</h4>${phoneProfileHtml(p.client.phone)}<p><b>${bi("Email","E-mail")}:</b> ${emailLink(p.client.email)}</p><p><b>${bi("Address","Cím")}:</b> ${mapLink(p.client.address)}</p><p><b>${bi("Billing address","Számlázási cím")}:</b> ${p.client.billing_address||"—"}</p><p><b>${bi("Last visit","Utolsó látogatás")}:</b> ${p.lastVisit||""}</p><p><b>${bi("Last job","Legutóbbi munka")}:</b> ${p.lastJob||""}</p>${interest}<h3>${bi("Pianos","Zongorák")}</h3>${p.pianos.map(x=>`<div class="client-piano-reference"><b>${htmlText(x.display_name||`${x.brand||""} ${x.model||""}`)}</b><span>${htmlText(pianoReferenceMeta(x)||x.ownership_type||x.ownership||"Customer owned")}</span></div>`).join("")||`<p>${bi("No pianos linked","Nincs kapcsolt zongora")}</p>`}<div id="clientPianoProfileTools"></div><h3>${bi("Jobs","Munkák")}</h3>${p.jobs.map(x=>`<p>${x.start_time} · ${x.title} · ${x.assigned_to} · ${x.status}</p>`).join("")||`<p>${bi("No jobs","Nincs munka")}</p>`}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Close","Bezár")}</button></div>`;
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
 $('#form').innerHTML=`<div class="client-import-intro"><p>${bi('Select an XLSX workbook. The ERP detects the client sheet by column structure, analyzes it first, then lets you preview and commit the import.','Válassz XLSX munkafüzetet. Az ERP oszlopszerkezet alapján felismeri az ügyféllapot, először elemzi, majd előnézet után importálható.')}</p><p class="muted">${bi('Only administrators and superadministrators can use bulk import.','A tömeges importot csak admin és szuperadmin használhatja.')}</p></div><div class="form-grid"><div class="field full"><label>${bi('Excel file (.xlsx)','Excel-fájl (.xlsx)')}</label><input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></div></div><div id="clientImportResult"></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button>${bi('Analyze file','Fájl elemzése')}</button></div>`;
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
  const friendly=msg==='NO_IMPORTABLE_CLIENT_SHEET'?bi('No sheet with a recognizable client-data structure was found.','Nem található felismerhető ügyféladat-struktúrájú munkalap.'):msg==='IMPORT_READY_EMPTY'?bi('The detected client-data sheet is empty.','A felismert ügyféladat-lap üres.'):msg==='INVALID_EXCEL_FILE'?bi('Only XLSX files are accepted.','Csak XLSX-fájl tölthető fel.'):msg==='FILE_ALREADY_IMPORTED'?bi('This file has already been imported.','Ezt a fájlt már korábban importálták.'):msg;
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

function openForm(key,row=null,options={}){let s=schemas[key];const initial={...(options.prefill||{}),...(row||{})};activeModalCancelHandler=typeof options.onCancelled==="function"?options.onCancelled:null;$("#modal").classList.remove("hidden");$("#modalTitle").textContent=(row?bi("Edit","Szerkesztés")+" ":bi("Add","Új")+" ")+splitBilingualText(s.title);$("#form").innerHTML=`${entityFormFieldsMarkup(key,row,initial)}<div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi("Cancel","Mégse")}</button><button>${bi("Save","Mentés")}</button></div>`;
 if(key==="contacts") setupContactFormBehavior(row);
 if(key==="pianos") setupPianoFormBehavior(row);
 applyLanguageToDOM(document.getElementById("modal"));
 $("#form").onsubmit=async e=>{e.preventDefault();try{const saved=await saveEntityFormRecord(key,row,e.target);activeModalCancelHandler=null;closeModal();if(typeof options.onSaved==="function")await options.onSaved(saved);else render(key)}catch(err){showError(err)}}}

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
 const renderAddForm = () => `<div class="inline-piano-form"><h4>+ ${bi("New owned piano","Új birtokolt zongora")}</h4><div class="form-grid"><div class="field"><label>${bi("Brand","Márka")}</label><input id="newPianoBrand"></div><div class="field"><label>${bi("Model","Típus")}</label><input id="newPianoModel"></div><div class="field"><label>${bi("Serial No.","Gyári szám")}</label><input id="newPianoSerial"></div><div class="field"><label>${bi("Build year","Gyártási év")}</label><input id="newPianoBuildYear" type="number" min="1700" max="2100"></div><div class="field"><label>${bi("Size (cm)","Méret (cm)")}</label><input id="newPianoSizeCm"></div><div class="field"><label>${bi("Size (inch)","Méret (inch)")}</label><input id="newPianoSizeIn"></div><div class="field"><label>${bi("Location","Helyszín")}</label><input id="newPianoLocation"></div><div class="field"><label>${bi("Ownership","Tulajdon")}</label><select id="newPianoOwnership" onchange="document.getElementById('newPianoValueBox').classList.toggle('hidden',this.value!=='Company owned')"><option value="Customer owned">${bi("Customer owned","Ügyfél tulajdona")}</option><option value="Company owned">${bi("Company owned","Céges tulajdon")}</option></select></div><div class="field hidden" id="newPianoValueBox"><label>${bi("Estimated value","Becsült érték")}</label><input id="newPianoValue" type="number" value="0"></div></div><button type="button" class="small" onclick="addInlinePianoToClient('${row?.id||""}')">${bi("Save new piano","Új zongora mentése")}</button></div>`;
 if(!row?.id){$("#clientPianoSelector").innerHTML=`<p class="muted">${bi("Save the client first, then edit the client to choose pianos.","Új ügyfélnél előbb mentsd az ügyfelet, utána szerkesztésben választható zongora.")}</p>`;return}
 try{const all=await api("/api/pianos"); const selected=all.filter(p=>p.owner_contact_id===row.id).map(p=>p.id); $("#clientPianoSelector").innerHTML=`<p class="muted">${bi("Select existing pianos or add a new owned piano. Purchase interests are not added here.","Válassz meglévő zongorát, vagy adj hozzá új birtokolt zongorát. A vásárlási érdeklődés nem kerül ide.")}</p><div class="dropdown-checks">${all.map(p=>`<label class="check-row"><input type="checkbox" name="client_piano_ids" value="${p.id}" ${selected.includes(p.id)?"checked":""}> ${p.display_name||`${p.brand||""} ${p.model||""}`} · ${p.serial_no||""} · ${p.ownership_type||p.ownership||""} ${p.owner_name?`· ${p.owner_name}`:""}</label>`).join("") || `<p class='muted'>${bi("No pianos in database","Nincs zongora az adatbázisban")}</p>`}</div>${renderAddForm()}`;}catch(e){$("#clientPianoSelector").innerHTML=`<p class="muted">${bi("Could not load pianos","Nem sikerült betölteni a zongorákat")}</p>${renderAddForm()}`}
 bindInlineClientPianoReference();
 applyLanguageToDOM(document.getElementById("clientPianoSelector"));
}
async function lookupInlineClientPianoReference(){
 const brand=$("#newPianoBrand")?.value||"",model=$("#newPianoModel")?.value||"",serial=$("#newPianoSerial")?.value||"";
 if(!isSteinwayClientBrand(brand))return;
 try{const result=await api(`/api/steinway-reference/lookup?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}&serial_no=${encodeURIComponent(serial)}`);
  const year=$("#newPianoBuildYear"),cm=$("#newPianoSizeCm"),inch=$("#newPianoSizeIn");
  if(year&&result.build_year&&year.dataset.manualOverride!=="1")year.value=result.build_year;
  if(cm&&result.size_cm&&cm.dataset.manualOverride!=="1")cm.value=result.size_cm;
  if(inch&&result.size_in&&inch.dataset.manualOverride!=="1")inch.value=result.size_in;
 }catch(_error){}
}
function bindInlineClientPianoReference(){
 ["newPianoBrand","newPianoModel","newPianoSerial"].forEach(id=>document.getElementById(id)?.addEventListener("input",()=>{clearTimeout(steinwayLookupTimer);steinwayLookupTimer=setTimeout(lookupInlineClientPianoReference,180);}));
 ["newPianoBuildYear","newPianoSizeCm","newPianoSizeIn"].forEach(id=>document.getElementById(id)?.addEventListener("input",event=>{event.currentTarget.dataset.manualOverride="1";}));
}

async function addInlinePianoToClient(clientId){
 if(!clientId){appAlert(bi("Save the client first.","Előbb mentsd az ügyfelet."),"warning");return}
 const brand=$("#newPianoBrand")?.value || "", model=$("#newPianoModel")?.value || "", serial_no=$("#newPianoSerial")?.value || "", build_year=$("#newPianoBuildYear")?.value||null, size_cm=$("#newPianoSizeCm")?.value||null, size_in=$("#newPianoSizeIn")?.value||null, location=$("#newPianoLocation")?.value || "", ownership_type=$("#newPianoOwnership")?.value || "Customer owned", estimated_value=Number($("#newPianoValue")?.value || 0);
 if(!brand && !model){appAlert(bi("Enter at least a brand or model.","Legalább márkát vagy modellt adj meg."),"warning");return}
 if(ownership_type==="Company owned" && estimated_value<=0){appAlert(bi("Estimated value is required for a company-owned piano.","Céges zongoránál kötelező a becsült érték."),"warning");return}
 try{
   const existing=await api(`/api/contacts/${clientId}/pianos`).catch(()=>[]);
   const similar=existing.find(p=>String(p.brand||"").trim().toLowerCase()===brand.trim().toLowerCase() && String(p.model||"").trim().toLowerCase()===model.trim().toLowerCase() && (!serial_no || String(p.serial_no||"").trim().toLowerCase()===serial_no.trim().toLowerCase()));
   if(similar){
     const ok=await appConfirm(bi("This client already has a similar piano. Add another one anyway?","Az ügyfélnek már van hasonló zongorája. Hozzáadsz még egyet?"));
     if(!ok) return;
   }
   await api(`/api/contacts/${clientId}/pianos`,{method:"POST",body:JSON.stringify({brand,model,serial_no,build_year,size_cm,size_in,location,ownership_type,estimated_value})});
   await api(`/api/contacts/${clientId}`,{method:"PUT",body:JSON.stringify({has_piano:1})}).catch(()=>{});
   await attachClientPianoSelector({id:clientId,has_piano:1});
 }catch(err){showError(err)}
}

function closeModal(){const onCancelled=activeModalCancelHandler;activeModalCancelHandler=null;stopEventDetailsAttendanceLiveSync?.();stopDigitalAttendanceLiveSync?.();digitalAttendanceSelectedEventId='';$("#modal").classList.remove("digital-attendance-modal-shell");$("#modal").classList.add("hidden");if(typeof onCancelled==="function")setTimeout(()=>onCancelled(),0)}
function exportTable(key){api("/api/"+key).then(data=>{if(!data.length){appAlert(bi("No data","Nincs adat"),"info");return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`${key}.csv`;a.click()})}
const financialCategoryOptions={
 INCOME:[
   ["SERVICE_REVENUE","Service Revenue / Szolgáltatási bevétel"],
   ["PIANO_SALE","Piano Sale Revenue / Zongoraeladás bevétele"],
   ["PIANO_RENTAL_LEASE","Piano Rental & Lease / Zongorabérlet és lízing"],
   ["HALL_SALON_RENTAL","Hall & Salon Rental / Terem- és szalonbérlet"],
   ["PRACTICE_REHEARSAL_FEES","Practice & Rehearsal Fees / Gyakorlási és próbadíjak"],
   ["INTEREST_INCOME","Interest Income / Kamatbevétel"],
   ["ROYALTY_CONTRACT_INCOME","Royalty & Contract Income / Jogdíj és szerződéses bevétel"],
   ["PASSIVE_REVENUE","Legacy Passive Revenue / Korábbi passzív bevétel"],
   ["OTHER_INCOME","Other Non-Operating Income / Egyéb működésen kívüli bevétel"]
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
   ["PREPAID_EXPENSE","Prepaid Expenses / Aktív időbeli elhatárolások"],
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
   ["SALES_TAX_REMITTANCE","Sales Tax Remittance / Forgalmi adó befizetés"],
   ["OTHER_SHORT_TERM_SOURCE","Other Short-Term Sources / Egyéb rövid lejáratú források"]
 ],
 EQUITY:[
   ["OWNER_OPENING_EQUITY","Owner's Opening Equity / Tulajdonosi nyitó tőke"],
   ["OWNER_EQUITY","Owner Equity / Saját tőke"],
   ["OTHER_SOURCE","Other Sources / Egyéb forrás"]
 ]
};
const balanceAccountOptions=[
 ["","Automatic balancing counterpart / Automatikus könyvelési ellenoldal"],
 ["ASSET_HEADER","--- Assets / Eszközök ---"],
 ["CASH","Cash / Készpénz"],
 ["BANK","Bank Account / Bankszámla"],
 ["CHECKS","Undeposited Checks / Befizetés előtti csekkek"],
 ["AR","Accounts Receivable / Vevőkövetelés"],
 ["INVENTORY","Inventory / Készlet"],
 ["PREPAID_EXPENSE","Prepaid Expenses / Aktív időbeli elhatárolások"],
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
 return standardPaymentMethodOptions(selected);
}

function optionsFrom(list,selected=""){
 return list.map(x=>`<option value="${x[0]}" ${x[0]===selected?"selected":""} ${String(x[0]).endsWith("_HEADER")?"disabled":""}>${splitBilingualText(x[1])}</option>`).join("");
}
function invoiceMoney(value){return Number(value||0).toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2})}
let manualInvoiceState=null;
let invoiceDocumentsBucket="active";
function manualInvoiceDate(offsetDays=0){const date=new Date();date.setUTCDate(date.getUTCDate()+offsetDays);return date.toISOString().slice(0,10)}
function closeOverlayById(id){document.getElementById(id)?.remove()}
function manualInvoiceCounterpartyRows(){if(!manualInvoiceState)return[];const type=manualInvoiceState.direction==='payable'?'partner':'client';return manualInvoiceState.counterparties.filter(row=>row.type===type)}
function manualInvoiceCounterpartyLabel(row){return row?`${row.display_name||row.official_name||''}${row.type==='partner'?` · ${bi('Partner','Partner')}`:` · ${bi('Client','Ügyfél')}`}`:''}
function closeManualInvoiceCounterpartyMenu(){const menu=document.getElementById('manualCounterpartyMenu'),search=document.getElementById('manualCounterpartySearch');menu?.classList.add('hidden');search?.setAttribute('aria-expanded','false')}
function manualInvoiceRenderCounterpartyMenu(term=''){
 const menu=document.getElementById('manualCounterpartyMenu'),search=document.getElementById('manualCounterpartySearch');if(!menu||!search)return;
 if(document.activeElement!==search){closeManualInvoiceCounterpartyMenu();return;}
 const query=String(term||'').trim().toLowerCase();const rows=manualInvoiceCounterpartyRows().filter(row=>!query||[row.display_name,row.official_name,row.billing_address,row.tax_id,row.contact_person,row.contact_email,row.contact_phone].some(value=>String(value||'').toLowerCase().includes(query))).slice(0,60);
 const addLabel=manualInvoiceState?.direction==='payable'?bi('Add New Partner...','Új partner hozzáadása...'):bi('Add New Client...','Új ügyfél hozzáadása...');
 const exactMatch=query&&manualInvoiceCounterpartyRows().some(row=>[row.display_name,row.official_name].some(value=>String(value||'').trim().toLowerCase()===query));const missingLabel=manualInvoiceState?.direction==='payable'?bi('Partner not found. Create now?','Partner nem található. Létrehozod most?'):bi('Client not found. Create now?','Ügyfél nem található. Létrehozod most?');const addAction=query&&!exactMatch?`<div class="manual-counterparty-create"><p>${missingLabel}</p><button type="button" class="manual-counterparty-add" onclick="openInlineCounterpartyFromInvoice()">+ ${addLabel}</button></div>`:'';
 menu.innerHTML=`${rows.map(row=>`<button type="button" class="manual-counterparty-option" onclick="selectManualInvoiceCounterparty('${row.type}','${htmlText(row.id)}')"><strong>${htmlText(row.display_name||row.official_name)}</strong><small>${htmlText(row.billing_address||row.contact_email||'')}</small></button>`).join('')||`<p class="manual-counterparty-empty">${bi('No matching counterparty.','Nincs megfelelő találat.')}</p>`}${addAction}`;
 menu.classList.remove('hidden');search.setAttribute('aria-expanded','true');
}
function filterManualInvoiceCounterparties(value){const selected=manualInvoiceSelectedCounterparty();if(selected&&String(value||'')!==manualInvoiceCounterpartyLabel(selected)){manualInvoiceState.selectedType='';manualInvoiceState.selectedId='';const partnerId=document.querySelector('#manualInvoiceForm [name="partner_id"]'),clientId=document.querySelector('#manualInvoiceForm [name="client_id"]');if(partnerId)partnerId.value='';if(clientId)clientId.value='';updateManualInvoiceCounterpartyDetails();const search=document.getElementById('manualCounterpartySearch');if(search)search.value=value||'';}manualInvoiceRenderCounterpartyMenu(value)}
function manualInvoiceSelectedCounterparty(){return manualInvoiceState?.counterparties?.find(row=>row.type===manualInvoiceState.selectedType&&String(row.id)===String(manualInvoiceState.selectedId))||null}
function updateManualInvoiceCounterpartyDetails(){
 const row=manualInvoiceSelectedCounterparty(),box=document.getElementById('manualCounterpartyDetails'),search=document.getElementById('manualCounterpartySearch');
 if(search&&row)search.value=manualInvoiceCounterpartyLabel(row);
 if(box)box.innerHTML=row?`<div><span>${bi('Official name','Hivatalos név')}</span><b>${htmlText(row.official_name||'—')}</b></div><div><span>${bi('Billing address','Számlázási cím')}</span><b>${htmlText(row.billing_address||'—')}</b></div><div><span>${bi('Tax ID','Adószám')}</span><b>${htmlText(row.tax_id||'—')}</b></div><div><span>${bi('Contact','Kapcsolattartó')}</span><b>${htmlText(row.contact_person||'—')}</b></div><div><span>Email</span><b>${htmlText(row.contact_email||'—')}</b></div><div><span>${bi('Phone','Telefon')}</span><b>${htmlText(row.contact_phone||'—')}</b></div>`:`<p class="muted">${manualInvoiceState?.direction==='payable'?bi('Select a partner to populate billing data.','Válassz partnert a számlázási adatok betöltéséhez.'):bi('Select a client to populate billing data.','Válassz ügyfelet a számlázási adatok betöltéséhez.')}</p>`;
}
function selectManualInvoiceCounterparty(type,id){
 if(!manualInvoiceState)return;const expected=manualInvoiceState.direction==='payable'?'partner':'client';if(type!==expected)return;
 const row=manualInvoiceState.counterparties.find(item=>item.type===type&&String(item.id)===String(id));if(!row)return;
 manualInvoiceState.selectedType=type;manualInvoiceState.selectedId=id;closeManualInvoiceCounterpartyMenu();
 const partnerId=document.querySelector('#manualInvoiceForm [name="partner_id"]'),clientId=document.querySelector('#manualInvoiceForm [name="client_id"]');if(partnerId)partnerId.value=type==='partner'?id:'';if(clientId)clientId.value=type==='client'?id:'';
 const tax=document.getElementById('manualTaxRate');if(tax)tax.value=Number(row.default_tax_rate||0).toFixed(2);updateManualInvoiceCounterpartyDetails();recalculateManualInvoice();
}
function setManualInvoiceDirection(direction){
 if(!manualInvoiceState||!['receivable','payable'].includes(direction))return;manualInvoiceState.direction=direction;
 document.querySelectorAll('#manualInvoiceOverlay [data-invoice-direction]').forEach(button=>button.classList.toggle('active',button.dataset.invoiceDirection===direction));
 const card=document.querySelector('#manualInvoiceOverlay .manual-invoice-card');if(card){card.classList.toggle('receivable',direction==='receivable');card.classList.toggle('payable',direction==='payable');}
 const selected=manualInvoiceSelectedCounterparty(),expected=direction==='payable'?'partner':'client';if(selected?.type!==expected){manualInvoiceState.selectedType='';manualInvoiceState.selectedId='';const partnerId=document.querySelector('#manualInvoiceForm [name="partner_id"]'),clientId=document.querySelector('#manualInvoiceForm [name="client_id"]');if(partnerId)partnerId.value='';if(clientId)clientId.value='';const search=document.getElementById('manualCounterpartySearch');if(search)search.value='';}
 const search=document.getElementById('manualCounterpartySearch'),label=document.getElementById('manualCounterpartyLabel');if(label)label.textContent=direction==='payable'?`${bi('Partner','Partner')} *`:`${bi('Client','Ügyfél')} *`;if(search)search.placeholder=direction==='payable'?bi('Search partners...','Partnerek keresése...'):bi('Search clients...','Ügyfelek keresése...');
 updateManualInvoiceCounterpartyDetails();if(document.activeElement===search)manualInvoiceRenderCounterpartyMenu(search.value||'');else closeManualInvoiceCounterpartyMenu();
 const prefix=document.getElementById('manualInvoicePreviewNumber');if(prefix)prefix.textContent=`${direction==='payable'?'VND':'INV'}-${new Date().getFullYear()}-XXXX`;
}
function manualInvoiceDateControl(name,value,label){
 return `<div class="workflow-date-picker manual-invoice-date-picker"><input class="workflow-date-text" type="text" inputmode="numeric" autocomplete="off" value="${htmlText(formatAmericanDate(value))}" placeholder="MM/DD/YYYY" aria-label="${htmlText(label)}" aria-required="true"><button type="button" class="workflow-date-picker-button" aria-label="${bi('Open calendar','Naptár megnyitása')}" aria-haspopup="dialog"><span class="workflow-date-picker-icon" aria-hidden="true">${billingIcon('calendar')}</span></button><input class="workflow-date-input" type="hidden" name="${htmlText(name)}" value="${htmlText(value)}"></div>`;
}
function bindManualInvoiceDateField(field){
 workflowBindDatePicker(field);const picker=field?.querySelector('.manual-invoice-date-picker'),text=picker?.querySelector('.workflow-date-text'),input=picker?.querySelector('.workflow-date-input');if(!text||!input)return;
 const syncTypedValue=()=>{const key=parseAmericanDate(text.value);text.setCustomValidity(key?'':bi('Use MM/DD/YYYY format.','Használd az MM/DD/YYYY formátumot.'));text.classList.toggle('manual-field-invalid',!key);text.setAttribute('aria-invalid',String(!key));input.value=key||'';};
 text.addEventListener('input',syncTypedValue);text.addEventListener('change',syncTypedValue);input.addEventListener('change',()=>{text.classList.remove('manual-field-invalid');text.setAttribute('aria-invalid','false')});
}
function validateManualInvoiceSummary({focusInvalid=false}={}){
 const input=document.querySelector('#manualInvoiceForm [name="summary"]');if(!input)return false;const invalid=String(input.value||'').trim().length<3;input.classList.toggle('manual-field-invalid',invalid);input.setAttribute('aria-invalid',String(invalid));if(invalid&&focusInvalid)input.focus({preventScroll:false});return !invalid;
}
function validateManualInvoiceFormState(){
 const summaryOk=validateManualInvoiceSummary(),itemsOk=validateManualInvoiceItems({focusInvalid:false}),button=document.getElementById('manualInvoiceSaveButton');if(button)button.disabled=!(summaryOk&&itemsOk);return summaryOk&&itemsOk;
}
function manualItemPaymentOptions(selected=''){return `<option value="">${bi('Use invoice default','Számla alapbeállítása')}</option>`+STANDARD_PAYMENT_METHODS.map(method=>`<option value="${htmlText(method)}" ${method===selected?'selected':''}>${htmlText(method)}</option>`).join('')}
function manualItemStatusOptions(selected=''){const normalized=String(selected||'').toLowerCase();return `<option value="">${bi('Use invoice default','Számla alapbeállítása')}</option><option value="Pending" ${normalized==='pending'?'selected':''}>Pending</option><option value="Paid" ${normalized==='paid'?'selected':''}>Paid</option>`}
function manualInvoiceItemMarkup(item={}){const quantity=Math.max(1,Math.trunc(parseFinancialNumber(item.quantity??1)||1)),unit=roundFinancial(parseFinancialNumber(item.unit_price??0)||0);return `<div class="manual-invoice-item" data-manual-item><input name="item_description" required aria-required="true" minlength="3" placeholder="${bi('Service / item description','Szolgáltatás / tétel megnevezése')}" value="${htmlText(item.item_description||'')}" oninput="clearManualItemDescriptionError(this);validateManualInvoiceFormState()"><input name="quantity" type="number" min="1" step="1" value="${quantity}" inputmode="numeric" oninput="recalculateManualInvoice()"><input name="unit_price" type="text" inputmode="decimal" value="${unit.toFixed(2)}" oninput="recalculateManualInvoice()" onblur="normalizeManualDecimalInput(this)"><output data-line-total>${invoiceMoney(roundFinancial(quantity*unit))}</output><button type="button" class="icon-action danger-btn manual-remove-item" title="${bi('Remove item','Tétel törlése')}" aria-label="${bi('Remove item','Tétel törlése')}" onclick="removeManualInvoiceItem(this)">${billingIcon('close')}</button><div class="manual-item-settlement"><label><span>${bi('Item payment method','Tétel fizetési módja')}</span><select name="item_payment_method" data-native-select="true" onchange="refreshManualPaymentLinkVisibility();recalculateManualInvoice()">${manualItemPaymentOptions(item.payment_method||'')}</select></label><label><span>${bi('Item financial status','Tétel pénzügyi státusza')}</span><select name="item_financial_status" data-native-select="true" onchange="recalculateManualInvoice()">${manualItemStatusOptions(item.financial_status||'')}</select></label></div></div>`}
function addManualInvoiceItem(item={}){const host=document.getElementById('manualInvoiceItems');if(!host)return;host.insertAdjacentHTML('beforeend',manualInvoiceItemMarkup(item));refreshManualPaymentLinkVisibility();recalculateManualInvoice();validateManualInvoiceFormState()}
function removeManualInvoiceItem(button){const row=button.closest('[data-manual-item]'),host=document.getElementById('manualInvoiceItems');if(row&&host&&host.children.length>1)row.remove();refreshManualPaymentLinkVisibility();recalculateManualInvoice();validateManualInvoiceFormState()}
function clearManualItemDescriptionError(input){if(String(input?.value||'').trim().length>=3){input?.classList.remove('manual-field-invalid');input?.setAttribute('aria-invalid','false')}}
function normalizeManualDecimalInput(input){const value=parseFinancialNumber(input?.value);if(input&&Number.isFinite(value)&&value>=0)input.value=roundFinancial(value).toFixed(2);recalculateManualInvoice()}
function manualInvoiceLineItems(){return [...document.querySelectorAll('#manualInvoiceItems [data-manual-item]')].map(row=>({item_description:row.querySelector('[name="item_description"]')?.value?.trim()||'',quantity:Number(row.querySelector('[name="quantity"]')?.value||0),unit_price:parseFinancialNumber(row.querySelector('[name="unit_price"]')?.value),payment_method:row.querySelector('[name="item_payment_method"]')?.value||'',financial_status:row.querySelector('[name="item_financial_status"]')?.value||''}))}
function validateManualInvoiceItems({focusInvalid=true}={}){const rows=[...document.querySelectorAll('#manualInvoiceItems [data-manual-item]')];let firstInvalid=null;for(const row of rows){const description=row.querySelector('[name="item_description"]'),quantity=row.querySelector('[name="quantity"]'),unit=row.querySelector('[name="unit_price"]');const missingDescription=String(description?.value||'').trim().length<3;description?.classList.toggle('manual-field-invalid',missingDescription);if(description)description.setAttribute('aria-invalid',String(missingDescription));const qty=Number(quantity?.value||0),price=parseFinancialNumber(unit?.value);const badNumbers=!Number.isInteger(qty)||qty<1||!Number.isFinite(price)||price<0;if(missingDescription&&!firstInvalid)firstInvalid=description;if(badNumbers&&!firstInvalid)firstInvalid=!Number.isInteger(qty)||qty<1?quantity:unit;}if(firstInvalid&&focusInvalid)firstInvalid.focus({preventScroll:false});return !firstInvalid}
function recalculateManualInvoice(){
 const items=manualInvoiceLineItems(),subtotal=roundFinancial(items.reduce((sum,item)=>sum+(Number.isInteger(item.quantity)&&item.quantity>=1&&Number.isFinite(item.unit_price)?roundFinancial(item.quantity*item.unit_price):0),0)),rate=Math.max(0,parseFinancialNumber(document.getElementById('manualTaxRate')?.value||0)),tax=roundFinancial(subtotal*rate/100),total=roundFinancial(subtotal+tax);
 [...document.querySelectorAll('#manualInvoiceItems [data-manual-item]')].forEach((row,index)=>{const item=items[index],out=row.querySelector('[data-line-total]');if(out)out.textContent=invoiceMoney(roundFinancial((item?.quantity||0)*(Number.isFinite(item?.unit_price)?item.unit_price:0)));});
 const values={manualSubtotal:subtotal,manualTaxBase:subtotal,manualTaxAmount:tax,manualTotal:total};Object.entries(values).forEach(([id,value])=>{const node=document.getElementById(id);if(node)node.textContent=invoiceMoney(value)});const taxLabel=document.getElementById('manualTaxLabel');if(taxLabel)taxLabel.textContent=`${bi('TAX','ADÓ')} (${roundFinancial(rate).toFixed(2)}%)`;validateManualInvoiceFormState();
}
function refreshManualPaymentLinkVisibility(){const field=document.getElementById('manualPaymentLinkField'),form=document.getElementById('manualInvoiceForm');if(!field||!form)return;const methods=[form.querySelector('[name="payment_method"]')?.value||'',...form.querySelectorAll('[name="item_payment_method"]')].map(node=>typeof node==='string'?node:node.value);field.classList.toggle('hidden',!methods.includes('Payment Link'))}
function toggleManualPaymentLink(){refreshManualPaymentLinkVisibility()}
function syncManualInvoiceFinancialStatus(value){const due=document.querySelector('#manualInvoiceForm [name="due_date"]');if(due)due.required=String(value||'').toLowerCase()==='pending'}
function collectManualInvoicePayload(){
 const form=document.getElementById('manualInvoiceForm'),counterparty=manualInvoiceSelectedCounterparty();if(!form||!counterparty)throw new Error(bi('Select the client or partner before continuing.','A folytatás előtt válassz ügyfelet vagy partnert.'));
 if(!validateManualInvoiceSummary({focusInvalid:true}))throw new Error(bi('Summary must contain at least 3 characters.','Az összefoglalónak legalább 3 karaktert kell tartalmaznia.'));
 if(!validateManualInvoiceItems())throw new Error(bi('Every service / item description must contain at least 3 characters, with a valid quantity and unit price.','Minden tétel megnevezésének legalább 3 karaktert kell tartalmaznia, valamint érvényes mennyiség és egységár szükséges.'));
 const data=Object.fromEntries(new FormData(form).entries()),items=manualInvoiceLineItems();
 if(!items.length||roundFinancial(items.reduce((sum,item)=>sum+item.quantity*item.unit_price,0))<=0)throw new Error(bi('Invoice total must be greater than zero.','A számla végösszegének nullánál nagyobbnak kell lennie.'));
 if(!STANDARD_PAYMENT_METHODS.includes(data.payment_method))throw new Error(bi('Select a valid payment method.','Válassz érvényes fizetési módot.'));
 if(!['Pending','Paid'].includes(data.financial_status))throw new Error(bi('Select a valid financial status.','Válassz érvényes pénzügyi státuszt.'));
 if(items.some(item=>item.payment_method&&!STANDARD_PAYMENT_METHODS.includes(item.payment_method)))throw new Error('INVALID_ITEM_PAYMENT_METHOD');
 if(items.some(item=>item.financial_status&&!['Pending','Paid'].includes(item.financial_status)))throw new Error('INVALID_ITEM_FINANCIAL_STATUS');
 if(!data.issue_date||!data.due_date)throw new Error(bi('Issue Date and Due Date are required.','A kiállítás dátuma és az esedékesség kötelező.'));
 if(data.financial_status==='Pending'&&!data.due_date)throw new Error('INVOICE_DUE_DATE_REQUIRED');
 const usesPaymentLink=data.payment_method==='Payment Link'||items.some(item=>item.payment_method==='Payment Link');if(usesPaymentLink&&data.payment_link_url&&!/^https:\/\//i.test(data.payment_link_url))throw new Error('PAYMENT_LINK_URL_INVALID');
 const taxRate=parseFinancialNumber(data.tax_rate);if(!Number.isFinite(taxRate)||taxRate<0)throw new Error('INVALID_TAX_RATE');
 return {direction:manualInvoiceState.direction,counterparty_type:counterparty.type,counterparty_id:counterparty.id,partner_id:counterparty.type==='partner'?counterparty.id:null,client_id:counterparty.type==='client'?counterparty.id:null,counterparty_name:counterparty.official_name||counterparty.display_name||'',counterparty_address:counterparty.billing_address||'',counterparty_tax_id:counterparty.tax_id||'',issue_date:data.issue_date,due_date:data.due_date,summary:data.summary||'',tax_rate:roundFinancial(taxRate),payment_method:data.payment_method,payment_link_url:usesPaymentLink?(data.payment_link_url||''):'',financial_status:data.financial_status,notes:data.notes||'',items:items.map(item=>({...item,unit_price:roundFinancial(item.unit_price),payment_method:item.payment_method||data.payment_method,financial_status:item.financial_status||data.financial_status})),counterparty};
}
function manualInvoicePreviewMarkup(invoice,{draft=false}={}){
 const items=invoice.items||[],subtotal=roundFinancial(invoice.subtotal??items.reduce((sum,item)=>sum+Number(item.quantity||0)*Number(item.unit_price||0),0)),rate=roundFinancial(invoice.tax_rate||0),tax=roundFinancial(invoice.tax_amount??subtotal*rate/100),total=roundFinancial(invoice.total_amount??subtotal+tax),counterparty=invoice.counterparty||{},status=invoice.financial_status||((invoice.status==='paid')?'Paid':'Pending');
 const number=draft?`${invoice.direction==='payable'?'VND':'INV'}-${String(invoice.issue_date||manualInvoiceDate()).slice(0,4)}-XXXX · ${bi('assigned on save','mentéskor kerül kiosztásra')}`:invoice.invoice_number;
 const workflowPhaseInvoice=!draft&&invoice.source_type==='workflow'&&invoice.direction==='receivable';
 const tableHead=workflowPhaseInvoice?`<tr><th>${bi('Phase','Fázis')}</th><th>${bi('Phase subtotal','Fázis részösszeg')}</th></tr>`:`<tr><th>${bi('Description','Megnevezés')}</th><th>${bi('Qty','Menny.')}</th><th>${bi('Unit Price','Egységár')}</th><th>${bi('Line Total','Sorösszeg')}</th></tr>`;
 const tableRows=workflowPhaseInvoice?items.map(item=>`<tr><td>${htmlText(item.item_description)}</td><td>${invoiceMoney(item.total_price??item.unit_price??0)}</td></tr>`).join(''):items.map(item=>{const itemMethod=item.payment_method||invoice.payment_method||'—',itemStatus=item.financial_status?(String(item.financial_status).toLowerCase()==='paid'?'Paid':'Pending'):status;return `<tr><td>${htmlText(item.item_description)}<small class="manual-line-settlement">${bi('Payment','Fizetés')}: ${htmlText(itemMethod)} · ${bi('Status','Státusz')}: ${htmlText(itemStatus)}</small></td><td>${Number(item.quantity||0)}</td><td>${invoiceMoney(item.unit_price)}</td><td>${invoiceMoney(item.total_price??Number(item.quantity||0)*Number(item.unit_price||0))}</td></tr>`}).join('');
 return `<div class="invoice-preview manual-rendered-invoice ${invoice.direction==='payable'?'payable':'receivable'}"><div class="manual-preview-brand"><div><span class="event-kicker">Klavierhaus · New York</span><h2>${invoice.direction==='payable'?bi('Vendor Bill','Bejövő bizonylat'):bi('Invoice','Kimenő számla')}</h2></div><strong>${htmlText(number||'')}</strong></div><div class="invoice-preview-grid"><div><span>${bi('Bill To / Vendor','Vevő / partner')}</span><b>${htmlText(invoice.counterparty_name||counterparty.official_name||'—')}</b><small>${htmlText(invoice.counterparty_address||counterparty.billing_address||'')}</small><small>${htmlText((invoice.counterparty_tax_id||counterparty.tax_id)?`Tax ID: ${invoice.counterparty_tax_id||counterparty.tax_id}`:'')}</small></div><div><span>${bi('Dates','Dátumok')}</span><b>${htmlText(invoice.issue_date||'')}</b><small>${bi('Due','Esedékes')}: ${htmlText(invoice.due_date||'—')}</small></div></div>${invoice.summary?`<p class="manual-preview-summary"><b>${bi('Summary','Összefoglaló')}:</b> ${htmlText(invoice.summary)}</p>`:''}<table class="${workflowPhaseInvoice?'workflow-phase-invoice-table':''}"><thead>${tableHead}</thead><tbody>${tableRows}</tbody></table><div class="manual-preview-footer"><div class="manual-preview-terms"><p><b>${bi('Default Payment Method','Alapértelmezett fizetési mód')}:</b> ${htmlText(invoice.payment_method||'—')}</p>${invoice.payment_link_url?`<p><b>${bi('Payment Link','Fizetési link')}:</b> ${htmlText(invoice.payment_link_url)}</p>`:''}<p><b>${bi('Default Payment Status','Alapértelmezett fizetési állapot')}:</b> ${htmlText(status)}</p>${invoice.notes?`<p><b>${bi('Notes','Megjegyzés')}:</b> ${htmlText(invoice.notes)}</p>`:''}</div><div class="invoice-preview-total"><span>${bi('Subtotal','Részösszeg')}</span><b>${invoiceMoney(subtotal)}</b><span>${bi('Taxable Base','Adóalap')}</span><b>${invoiceMoney(subtotal)}</b><span>${bi('Tax','Adó')} (${rate.toFixed(2)}%)</span><b>${invoiceMoney(tax)}</b><span>${bi('Total USD','Végösszeg USD')}</span><strong>${invoiceMoney(total)}</strong></div></div></div>`;
}
function previewManualInvoiceDraft(){
 try{const payload=collectManualInvoicePayload(),subtotal=roundFinancial(payload.items.reduce((sum,item)=>sum+item.quantity*item.unit_price,0)),tax=roundFinancial(subtotal*payload.tax_rate/100);closeOverlayById('manualInvoicePreviewOverlay');const overlay=document.createElement('div');overlay.id='manualInvoicePreviewOverlay';overlay.className='nested-modal-overlay manual-preview-overlay';overlay.innerHTML=`<section class="nested-modal-card manual-preview-card" role="dialog" aria-modal="true"><header><h3>${billingIcon('eye')} ${bi('Preview Invoice','Számla előnézet')}</h3><button type="button" class="modal-close ghost-btn" onclick="closeOverlayById('manualInvoicePreviewOverlay')">${billingIcon('close')}</button></header>${manualInvoicePreviewMarkup({...payload,subtotal,tax_amount:tax,total_amount:roundFinancial(subtotal+tax)},{draft:true})}<div class="actions"><button type="button" onclick="closeOverlayById('manualInvoicePreviewOverlay')">${bi('Back to editing','Vissza a szerkesztéshez')}</button></div></section>`;document.body.appendChild(overlay);}catch(error){showError(error.message||error)}
}
async function refreshManualInvoiceCounterparties(select={}){
 const data=await api('/api/invoice-counterparties');manualInvoiceState.counterparties=data.all||[...(data.partners||[]),...(data.clients||[])];
 if(select?.id&&select?.type){manualInvoiceState.selectedType=select.type;manualInvoiceState.selectedId=select.id;}updateManualInvoiceCounterpartyDetails();closeManualInvoiceCounterpartyMenu();
}
async function openManualInvoiceModal(){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 try{
  const data=await api('/api/invoice-counterparties');manualInvoiceState={direction:'receivable',counterparties:data.all||[...(data.partners||[]),...(data.clients||[])],selectedType:'',selectedId:''};closeOverlayById('manualInvoiceOverlay');const overlay=document.createElement('div');overlay.id='manualInvoiceOverlay';overlay.className='nested-modal-overlay manual-invoice-overlay';overlay.innerHTML=`<section class="nested-modal-card manual-invoice-card receivable" role="dialog" aria-modal="true" aria-labelledby="manualInvoiceTitle"><header><div><p class="event-kicker">Billing & Finance</p><h2 id="manualInvoiceTitle">+ ${bi('Create Invoice / Bill','Számla / bizonylat létrehozása')}</h2></div><button type="button" class="modal-close ghost-btn" onclick="closeOverlayById('manualInvoiceOverlay')">${billingIcon('close')}</button></header><form id="manualInvoiceForm"><input type="hidden" name="partner_id" value=""><input type="hidden" name="client_id" value=""><div class="manual-direction-toggle"><button type="button" class="active" data-invoice-direction="receivable" onclick="setManualInvoiceDirection('receivable')">${bi('Receivable / Outgoing','Receivable / Kimenő')}</button><button type="button" data-invoice-direction="payable" onclick="setManualInvoiceDirection('payable')">${bi('Payable / Incoming','Payable / Bejövő')}</button></div><div class="manual-invoice-grid"><div class="field full manual-counterparty-field"><label id="manualCounterpartyLabel">${bi('Client','Ügyfél')} *</label><input id="manualCounterpartySearch" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="manualCounterpartyMenu" aria-expanded="false" placeholder="${bi('Search clients...','Ügyfelek keresése...')}" onfocus="manualInvoiceRenderCounterpartyMenu(this.value)" oninput="filterManualInvoiceCounterparties(this.value)"><div id="manualCounterpartyMenu" class="manual-counterparty-menu hidden" role="listbox"></div></div><div id="manualCounterpartyDetails" class="manual-counterparty-details full"></div><div class="field manual-invoice-date-field"><label>${bi('Issue Date','Kiállítás dátuma')} *</label>${manualInvoiceDateControl('issue_date',manualInvoiceDate(),bi('Issue Date','Kiállítás dátuma'))}</div><div class="field manual-invoice-date-field"><label>${bi('Due Date','Esedékesség')} *</label>${manualInvoiceDateControl('due_date',manualInvoiceDate(30),bi('Due Date','Esedékesség'))}</div><div class="field full"><label>${bi('Summary','Összefoglaló')} *</label><input name="summary" required minlength="3" maxlength="2000" aria-required="true" aria-invalid="true" oninput="validateManualInvoiceFormState()" placeholder="${bi('Service, project or billing reference','Szolgáltatás, projekt vagy számlázási hivatkozás')}"></div></div><div class="manual-item-section"><div class="manual-section-head"><div><h3>${bi('Line Items','Tételsorok')}</h3><p>${bi('Each description is required. Payment and status can inherit the invoice default or be overridden per line.','Minden tétel megnevezése kötelező. A fizetési mód és státusz örökölhető a számláról vagy tételenként felülírható.')}</p></div><button type="button" class="small" onclick="addManualInvoiceItem()">+ ${bi('Add Item','Tétel hozzáadása')}</button></div><div class="manual-item-head"><span>${bi('Description','Megnevezés')}</span><span>${bi('Qty','Menny.')}</span><span>${bi('Unit Price','Egységár')}</span><span>${bi('Line Total','Sorösszeg')}</span><span></span></div><div id="manualInvoiceItems"></div></div><div class="manual-invoice-bottom"><div class="manual-payment-fields"><div class="field"><label>${bi('Payment Method','Fizetési mód')} *</label><select id="manualPaymentMethod" class="manual-native-select" name="payment_method" data-native-select="true" required>${standardPaymentMethodOptions()}</select></div><div id="manualPaymentLinkField" class="field hidden"><label>${bi('Payment Link URL','Fizetési link URL')}</label><input name="payment_link_url" type="url" placeholder="https://..."></div><div class="field"><label>${bi('Financial Status','Pénzügyi státusz')} *</label><select id="manualFinancialStatus" class="manual-native-select" name="financial_status" data-native-select="true" required><option value="Pending">Pending</option><option value="Paid">Paid</option></select></div><div class="field"><label>${bi('Tax %','Adó %')}</label><input id="manualTaxRate" name="tax_rate" type="text" inputmode="decimal" value="0.00" oninput="recalculateManualInvoice()" onblur="normalizeManualDecimalInput(this)"></div><div class="field full"><label>${bi('Notes','Megjegyzés')}</label><textarea name="notes" rows="3" maxlength="5000" placeholder="${bi('Invoice footer note, references or payment instructions','Számlazáradék, hivatkozás vagy fizetési instrukció')}"></textarea></div></div><div class="manual-totals"><div><span>${bi('Subtotal','Részösszeg')}</span><b id="manualSubtotal">$0.00</b></div><div><span>${bi('Taxable Base','Adóalap')}</span><b id="manualTaxBase">$0.00</b></div><div><span id="manualTaxLabel">${bi('TAX','ADÓ')} (0.00%)</span><b id="manualTaxAmount">$0.00</b></div><div class="total"><span>${bi('Total USD','Végösszeg USD')}</span><strong id="manualTotal">$0.00</strong></div></div></div><div class="manual-invoice-actions"><span class="manual-number-hint">${bi('Number assigned only on save','A sorszám csak mentéskor kerül kiosztásra')}: <b id="manualInvoicePreviewNumber">INV-${new Date().getFullYear()}-XXXX</b></span><div><button id="manualInvoicePreviewButton" type="button" class="ghost-btn">${billingIcon('eye')} ${bi('Preview Invoice','Számla előnézet')}</button><button id="manualInvoiceSaveButton" type="submit" disabled>${billingIcon('check')} ${bi('Save Invoice / Bill','Számla / bizonylat mentése')}</button></div></div></form></section>`;document.body.appendChild(overlay);overlay.querySelectorAll('.manual-invoice-date-field').forEach(bindManualInvoiceDateField);addManualInvoiceItem({quantity:1,unit_price:0});updateManualInvoiceCounterpartyDetails();validateManualInvoiceFormState();
  const form=document.getElementById('manualInvoiceForm'),method=form.querySelector('[name="payment_method"]'),status=form.querySelector('[name="financial_status"]'),search=document.getElementById('manualCounterpartySearch');
  method.addEventListener('change',()=>{refreshManualPaymentLinkVisibility();recalculateManualInvoice()});status.addEventListener('change',event=>syncManualInvoiceFinancialStatus(event.currentTarget.value));document.getElementById('manualInvoicePreviewButton')?.addEventListener('click',event=>{event.preventDefault();previewManualInvoiceDraft()});
  search?.addEventListener('blur',()=>setTimeout(()=>{const field=document.querySelector('#manualInvoiceOverlay .manual-counterparty-field');if(field&&!field.contains(document.activeElement))closeManualInvoiceCounterpartyMenu()},0));
  const outsideClose=event=>{const field=document.querySelector('#manualInvoiceOverlay .manual-counterparty-field');if(field&&!field.contains(event.target))closeManualInvoiceCounterpartyMenu()};overlay.addEventListener('pointerdown',outsideClose);overlay.addEventListener('touchstart',outsideClose,{passive:true});
  syncManualInvoiceFinancialStatus(status.value);refreshManualPaymentLinkVisibility();form.onsubmit=saveManualInvoice;
 }catch(error){showError(error)}
}
async function saveManualInvoice(event){event.preventDefault();try{const payload=collectManualInvoicePayload(),created=await api('/api/invoices/manual',{method:'POST',body:JSON.stringify(payload)});closeOverlayById('manualInvoicePreviewOverlay');closeOverlayById('manualInvoiceOverlay');showToast(`${created.invoice_number} · ${bi('saved','mentve')}`,'success');await renderInvoiceDocuments(String(created.issue_date||'').slice(0,7)||currentMonthKey());await previewInvoice(created.id);}catch(error){showError(error.message||error)}}
function openInlinePartnerFromInvoice(){return openInlineCounterpartyFromInvoice('partner')}
function openInlineCounterpartyFromInvoice(forceType=''){
 if(!manualInvoiceState)return;const type=forceType|| (manualInvoiceState.direction==='payable'?'partner':'client');if(type==='partner'&&manualInvoiceState.direction!=='payable')return; if(type==='client'&&manualInvoiceState.direction!=='receivable')return;
 closeOverlayById('inlineInvoicePartnerOverlay');const isPartner=type==='partner',overlay=document.createElement('div');overlay.id='inlineInvoicePartnerOverlay';overlay.className='nested-modal-overlay inline-partner-overlay';const title=isPartner?bi('Add New Partner','Új partner hozzáadása'):bi('Add New Client','Új ügyfél hozzáadása');const nameField=isPartner?`<div class="field full"><label>${bi('Official company name','Hivatalos cégnév')} *</label><input name="company_name" required></div>`:`<div class="field full"><label>${bi('Client name','Ügyfél neve')} *</label><input name="name" required></div>`;const contactField=isPartner?`<div class="field"><label>${bi('Contact person','Kapcsolattartó')}</label><input name="contact_person"></div>`:'';const emailName=isPartner?'contact_email':'email',phoneName=isPartner?'contact_phone':'phone';overlay.innerHTML=`<section class="nested-modal-card inline-partner-card" role="dialog" aria-modal="true"><header><h3>+ ${title}</h3><button type="button" class="modal-close ghost-btn" onclick="closeOverlayById('inlineInvoicePartnerOverlay')">${billingIcon('close')}</button></header><form id="inlineInvoicePartnerForm"><div class="form-grid">${nameField}<div class="field full"><label>${bi('Billing address','Számlázási cím')}</label><input name="billing_address"></div><div class="field"><label>${bi('Tax ID','Adószám')}</label><input name="tax_id"></div>${isPartner?`<div class="field"><label>${bi('Default Tax %','Alapértelmezett adó %')}</label><input name="default_tax_rate" type="text" inputmode="decimal" value="0.00"></div>`:''}${contactField}<div class="field"><label>Email</label><input name="${emailName}" type="email"></div><div class="field"><label>${bi('Phone','Telefon')}</label><input name="${phoneName}"></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeOverlayById('inlineInvoicePartnerOverlay')">${bi('Cancel','Mégse')}</button><button type="submit">${isPartner?bi('Save & Select Partner','Mentés és partner kiválasztása'):bi('Save & Select Client','Mentés és ügyfél kiválasztása')}</button></div></form></section>`;document.body.appendChild(overlay);document.getElementById('inlineInvoicePartnerForm').onsubmit=async event=>{event.preventDefault();try{const body=Object.fromEntries(new FormData(event.target).entries());if(!isPartner){body.status='Active';body.type='Client';body.address=body.billing_address||'';}const saved=await api(isPartner?'/api/partners':'/api/contacts',{method:'POST',body:JSON.stringify(body)});closeOverlayById('inlineInvoicePartnerOverlay');await refreshManualInvoiceCounterparties({type,id:saved.id});selectManualInvoiceCounterparty(type,saved.id);showToast(isPartner?bi('Partner added and selected.','Partner hozzáadva és kiválasztva.'):bi('Client added and selected.','Ügyfél hozzáadva és kiválasztva.'),'success');}catch(error){showError(error.message||error)}};
}
async function renderCompanyDocumentsArchive(){
 let rows=[];const existingSearch=document.getElementById('companyDocumentSearch')?.value||'',existingCategory=document.getElementById('companyDocumentCategoryFilter')?.value||'';
 try{const q=[];if(existingSearch)q.push(`search=${encodeURIComponent(existingSearch)}`);if(existingCategory)q.push(`category=${encodeURIComponent(existingCategory)}`);rows=await api(`/api/company-documents${q.length?'?'+q.join('&'):''}`);}catch(error){return showError(error)}
 const categories=['Contract','Permit','Technical Documentation','Other Company Document'];
 const categoryLabel=value=>({Contract:bi('Contract','Szerződés'),Permit:bi('Permit','Engedély'),'Technical Documentation':bi('Technical Documentation','Műszaki dokumentáció'),'Other Company Document':bi('Other Company Document','Egyéb céges irat')})[value]||value;
 $('#knowledge_base').innerHTML=`${mobileBackHeader(bi('Company Documents Archive','Céges dokumentumtár'))}<div class="panel company-documents-shell"><div class="toolbar"><div><p class="event-kicker">Technical Operation</p><h2>${bi('Company Documents Archive','Céges dokumentumtár')}</h2><p class="muted">${bi('Contracts, agreements, permits and technical company documents with signed-date metadata.','Szerződések, megállapodások, engedélyek és műszaki céges iratok kötési dátummal.')}</p></div></div><form id="companyDocumentUploadForm" class="company-document-form" onsubmit="uploadCompanyDocument(event)"><div id="companyDocumentDropzone" class="company-document-dropzone" tabindex="0" role="button" onclick="document.getElementById('companyDocumentFile').click()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('companyDocumentFile').click()}" ondragover="event.preventDefault();this.classList.add('is-dragover')" ondragleave="this.classList.remove('is-dragover')" ondrop="handleCompanyDocumentDrop(event)"><strong>${bi('Drag & Drop company document here','Húzd ide a céges dokumentumot')}</strong><span>${bi('or browse files','vagy tallózz a fájlok között')}</span><small>PDF · DOC · DOCX · XLS · XLSX · JPG · PNG · WEBP</small><input id="companyDocumentFile" name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" hidden required onchange="updateCompanyDocumentFileName(this.files?.[0])"><b id="companyDocumentFileName"></b></div><div class="form-grid company-document-metadata"><div class="field full"><label>${bi('Document Title','Dokumentum neve / Címe')} *</label><input name="title" required></div><div class="field"><label>${bi('Effective / Signed Date','Érvényességi / Kötési dátum')} *</label><input name="effective_date" type="date" required></div><div class="field"><label>${bi('Category','Kategória')} *</label><select name="category" required><option value="">${bi('Select category','Válassz kategóriát')}</option>${categories.map(category=>`<option value="${htmlText(category)}">${htmlText(categoryLabel(category))}</option>`).join('')}</select></div></div><div class="actions"><button type="submit">+ ${bi('Upload Document','Dokumentum feltöltása')}</button></div></form><div class="company-document-filters"><input id="companyDocumentSearch" type="search" value="${htmlText(existingSearch)}" placeholder="${bi('Search documents...','Dokumentumok keresése...')}" oninput="scheduleCompanyDocumentFilter()"><select id="companyDocumentCategoryFilter" onchange="renderCompanyDocumentsArchive()"><option value="">${bi('All categories','Minden kategória')}</option>${categories.map(category=>`<option value="${htmlText(category)}" ${category===existingCategory?'selected':''}>${htmlText(categoryLabel(category))}</option>`).join('')}</select></div><div class="table-wrap company-document-table"><table><thead><tr><th>${bi('Document Title','Dokumentum címe')}</th><th>${bi('Category','Kategória')}</th><th>${bi('Effective / Signed Date','Kötési dátum')}</th><th>${bi('Uploaded','Feltöltve')}</th><th>${bi('Uploaded By','Feltöltő')}</th><th>${bi('Actions','Műveletek')}</th></tr></thead><tbody>${rows.map(row=>`<tr><td><b>${htmlText(row.title)}</b><small>${htmlText(row.original_filename||'')}</small></td><td>${htmlText(categoryLabel(row.category))}</td><td>${htmlText(row.effective_date||'—')}</td><td>${htmlText(String(row.created_at||'').replace('T',' ').slice(0,19))}</td><td>${htmlText(row.owner||'—')}</td><td><div class="invoice-actions"><button type="button" class="icon-action" title="${bi('Preview','Előnézet')}" onclick="openCompanyDocumentPreview(decodeURIComponent('${encodeURIComponent(String(row.stored_path||'')).replace(/'/g,'%27')}'),decodeURIComponent('${encodeURIComponent(String(row.title||'')).replace(/'/g,'%27')}'),decodeURIComponent('${encodeURIComponent(String(row.mime_type||'')).replace(/'/g,'%27')}'),decodeURIComponent('${encodeURIComponent(String(row.original_filename||'')).replace(/'/g,'%27')}'))">${billingIcon('eye')}</button><a class="icon-action" href="${htmlText(row.stored_path||'#')}" download="${htmlText(row.original_filename||'document')}" title="${bi('Download','Letöltés')}">${billingIcon('download')}</a></div></td></tr>`).join('')||`<tr><td colspan="6" class="empty-state">${bi('No company documents found.','Nem található céges dokumentum.')}</td></tr>`}</tbody></table></div></div>`;
}
let companyDocumentFilterTimer=null;
function scheduleCompanyDocumentFilter(){clearTimeout(companyDocumentFilterTimer);companyDocumentFilterTimer=setTimeout(()=>renderCompanyDocumentsArchive(),250);}
function updateCompanyDocumentFileName(file){const el=document.getElementById('companyDocumentFileName');if(el)el.textContent=file?.name||'';}
function handleCompanyDocumentDrop(event){event.preventDefault();event.currentTarget.classList.remove('is-dragover');const file=event.dataTransfer?.files?.[0];if(!file)return;const input=document.getElementById('companyDocumentFile');if(!input)return;const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;updateCompanyDocumentFileName(file);}
async function uploadCompanyDocument(event){event.preventDefault();const form=event.currentTarget,body=new FormData(form);try{const response=await fetch('/api/company-documents',{method:'POST',headers:{Authorization:`Bearer ${token}`},body});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);showToast(bi('Company document uploaded.','Céges dokumentum feltöltve.'),'success');await renderCompanyDocumentsArchive();}catch(error){showError(error.message||error)}}
function openCompanyDocumentPreview(storedPath,title,mimeType='',filename=''){
 if(!storedPath)return showError(bi('Document file is unavailable.','A dokumentumfájl nem érhető el.'));
 closeOverlayById('companyDocumentPreviewOverlay');const overlay=document.createElement('div');overlay.id='companyDocumentPreviewOverlay';overlay.className='nested-modal-overlay company-document-preview-overlay';const canEmbed=/pdf|image/i.test(mimeType)||/\.(pdf|png|jpe?g|webp)$/i.test(filename||storedPath);overlay.innerHTML=`<section class="nested-modal-card company-document-preview-card" role="dialog" aria-modal="true"><header><h3>${htmlText(title||filename||bi('Document Preview','Dokumentum előnézet'))}</h3><button type="button" class="modal-close ghost-btn" onclick="closeOverlayById('companyDocumentPreviewOverlay')">${billingIcon('close')}</button></header>${canEmbed?`<iframe src="${htmlText(storedPath)}" title="${htmlText(title||filename||'Document preview')}"></iframe>`:`<div class="company-document-office-preview"><p>${bi('This office document is stored securely. Use Download to open it in its native application.','Ez az irodai dokumentum biztonságosan tárolva van. A Letöltés gombbal nyisd meg a natív alkalmazásában.')}</p><strong>${htmlText(filename||'')}</strong></div>`}<div class="actions"><a class="button-like" href="${htmlText(storedPath)}" download="${htmlText(filename||'document')}">${billingIcon('download')} ${bi('Download','Letöltés')}</a><button type="button" class="ghost-btn" onclick="closeOverlayById('companyDocumentPreviewOverlay')">${bi('Close','Bezárás')}</button></div></section>`;document.body.appendChild(overlay);
}

let financialStatementPeriodsCache=null;
async function loadFinancialStatementPeriods(force=false){
 if(financialStatementPeriodsCache&&!force)return financialStatementPeriodsCache;
 financialStatementPeriodsCache=await api('/api/financial-statements/periods');
 return financialStatementPeriodsCache;
}
function financialStatementArchiveMarkup(periods,statement){
 const title=statement==='balance-sheet'?bi('Closed monthly Balance Sheets','Lezárt havi mérlegek'):bi('Closed monthly Income Statements','Lezárt havi eredménykimutatások');
 return `<div class="panel financial-statement-archive"><div class="toolbar"><div><h3>${title}</h3><p class="muted">${bi('Official month-end snapshots are immutable and begin with August 2026.','A hivatalos hóvégi pillanatképek nem módosíthatók, és 2026 augusztusától érhetők el.')}</p></div></div><div class="table-wrap"><table><thead><tr><th>${bi('Period','Időszak')}</th><th>${bi('Period end','Időszak vége')}</th><th>${bi('Closed in New York time','Lezárás New York-i idő szerint')}</th><th>PDF</th></tr></thead><tbody>${(periods||[]).map(row=>`<tr><td><b>${htmlText(row.period)}</b></td><td>${htmlText(row.period_end||'')}</td><td>${htmlText(row.closed_at_local||'')}</td><td><button class="small" onclick="downloadFinancialStatementPdf('${statement}','${htmlText(row.period)}')">${billingIcon('download')} PDF</button></td></tr>`).join('')||`<tr><td colspan="4" class="muted">${bi('No closed financial periods yet.','Még nincs lezárt pénzügyi időszak.')}</td></tr>`}</tbody></table></div></div>`;
}
async function downloadFinancialStatementPdf(statement,period=''){
 try{
  const endpoint=period?`/api/financial-statements/${encodeURIComponent(statement)}/${encodeURIComponent(period)}.pdf`:`/api/financial-statements/${encodeURIComponent(statement)}/realtime.pdf`;
  const response=await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||`HTTP ${response.status}`);
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`klavierhaus-${statement}-${period?`${period}-closed`:`${currentMonthKey()}-realtime`}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){showError(error)}
}
let openingBalanceDraftItems=[];
function openingBalanceRowsMarkup(){
 return openingBalanceDraftItems.map((item,index)=>`<div class="opening-balance-custom-row" data-opening-index="${index}"><input data-opening-name value="${htmlText(item.item_name||'')}" placeholder="${bi('Item name','Tétel megnevezése')}" oninput="syncOpeningBalanceDraft()"><select data-opening-type onchange="syncOpeningBalanceDraft()"><option value="ASSET" ${item.item_type==='ASSET'?'selected':''}>Asset</option><option value="LIABILITY" ${item.item_type==='LIABILITY'?'selected':''}>Liability</option><option value="EQUITY" ${item.item_type==='EQUITY'?'selected':''}>Equity</option></select><input data-opening-amount type="number" step="0.01" min="0" value="${Number(item.amount||0).toFixed(2)}" oninput="syncOpeningBalanceDraft()"><button type="button" class="small danger-btn" onclick="removeOpeningBalanceItem(${index})">×</button></div>`).join('');
}
function syncOpeningBalanceDraft(){
 const rows=[...document.querySelectorAll('[data-opening-index]')];
 openingBalanceDraftItems=rows.map(row=>({item_name:row.querySelector('[data-opening-name]')?.value||'',item_type:row.querySelector('[data-opening-type]')?.value||'ASSET',amount:Number(row.querySelector('[data-opening-amount]')?.value||0)}));
 updateOpeningBalanceDifference();
}
function addOpeningBalanceItem(){syncOpeningBalanceDraft();openingBalanceDraftItems.push({item_name:'',item_type:'ASSET',amount:0});const box=document.getElementById('openingBalanceCustomItems');if(box)box.innerHTML=openingBalanceRowsMarkup();updateOpeningBalanceDifference();}
function removeOpeningBalanceItem(index){syncOpeningBalanceDraft();openingBalanceDraftItems.splice(index,1);const box=document.getElementById('openingBalanceCustomItems');if(box)box.innerHTML=openingBalanceRowsMarkup();updateOpeningBalanceDifference();}
function openingBalanceFormPayload(){
 syncOpeningBalanceDraft();
 return {effective_date:document.getElementById('openingEffectiveDate')?.value||'',opening_cash_bank:Number(document.getElementById('openingCash')?.value||0),opening_accounts_receivable:Number(document.getElementById('openingAR')?.value||0),opening_accounts_payable:Number(document.getElementById('openingAP')?.value||0),opening_retained_earnings_equity:Number(document.getElementById('openingEquity')?.value||0),items:openingBalanceDraftItems};
}
function updateOpeningBalanceDifference(){
 const el=document.getElementById('openingBalanceDifference');if(!el)return;
 const cash=Number(document.getElementById('openingCash')?.value||0),ar=Number(document.getElementById('openingAR')?.value||0),ap=Number(document.getElementById('openingAP')?.value||0),equity=Number(document.getElementById('openingEquity')?.value||0);
 let customAssets=0,customLiabilities=0,customEquity=0;
 for(const item of openingBalanceDraftItems){const amount=roundFinancial(Number(item.amount||0));if(item.item_type==='ASSET')customAssets=roundFinancial(customAssets+amount);else if(item.item_type==='LIABILITY')customLiabilities=roundFinancial(customLiabilities+amount);else customEquity=roundFinancial(customEquity+amount);}
 const assets=roundFinancial(cash+ar+customAssets),sources=roundFinancial(ap+equity+customLiabilities+customEquity),difference=roundFinancial(assets-sources),balanced=Math.abs(difference)<0.01;
 el.className=`opening-balance-integrity ${balanced?'is-balanced':'is-unbalanced'}`;el.innerHTML=`<strong>${balanced?bi('Balanced','Kiegyensúlyozott'):bi('Out of balance','Nincs egyensúlyban')}</strong><span>${bi('Assets','Eszközök')}: ${invoiceMoney(assets)} · ${bi('Liabilities + Equity','Kötelezettségek + saját tőke')}: ${invoiceMoney(sources)} · ${bi('Difference','Eltérés')}: ${invoiceMoney(difference)}</span>`;
}
async function openOpeningBalanceModal(){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 const payload=await api('/api/opening-balance');if(payload.locked){return showError(bi('Opening Balance is permanently locked because the first official financial period has already been closed. Use a current-period capital or adjusting entry instead.','A nyitóegyenleg véglegesen zárolva van, mert az első hivatalos pénzügyi időszak már lezárult. Használj aktuális időszaki tőke- vagy helyesbítő tételt.'));}const row=payload.openingBalance||{};openingBalanceDraftItems=(row.items||[]).map(item=>({...item}));
 $('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Set / Edit Opening Balance','Nyitóegyenleg beállítása / szerkesztése');
 $('#form').innerHTML=`<div class="opening-balance-form"><p class="muted">${bi('Enter the accountant-approved opening position. Saving is allowed only when Assets = Liabilities + Equity to the cent.','Add meg a könyvelő által jóváhagyott nyitópozíciót. Mentés csak fillérre kiegyensúlyozott mérleg esetén lehetséges.')}</p><div class="form-grid"><div class="field"><label>${req(bi('Opening date','Nyitó dátum'))}</label><input id="openingEffectiveDate" name="effective_date" type="date" value="${htmlText(row.effective_date||'2026-08-01')}" required></div><div class="field"><label>${bi('Opening Cash & Bank Balance','Nyitó készpénz- és bankállomány')}</label><input id="openingCash" type="number" step="0.01" min="0" value="${Number(row.opening_cash_bank||0).toFixed(2)}" oninput="updateOpeningBalanceDifference()"></div><div class="field"><label>${bi('Opening Accounts Receivable','Nyitó vevőkövetelések')}</label><input id="openingAR" type="number" step="0.01" min="0" value="${Number(row.opening_accounts_receivable||0).toFixed(2)}" oninput="updateOpeningBalanceDifference()"></div><div class="field"><label>${bi('Opening Accounts Payable','Nyitó szállítói tartozások')}</label><input id="openingAP" type="number" step="0.01" min="0" value="${Number(row.opening_accounts_payable||0).toFixed(2)}" oninput="updateOpeningBalanceDifference()"></div><div class="field"><label>${bi('Opening Retained Earnings / Equity','Nyitó eredménytartalék / saját tőke')}</label><input id="openingEquity" type="number" step="0.01" value="${Number(row.opening_retained_earnings_equity||0).toFixed(2)}" oninput="updateOpeningBalanceDifference()"></div></div><div class="opening-balance-custom-head"><h4>${bi('Custom opening items','Egyedi nyitótételek')}</h4><button type="button" class="small ghost-btn" onclick="addOpeningBalanceItem()">+ ${bi('Add Custom Opening Item','Egyedi nyitótétel hozzáadása')}</button></div><div id="openingBalanceCustomItems" class="opening-balance-custom-items">${openingBalanceRowsMarkup()}</div><div id="openingBalanceDifference"></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Save Opening Balance','Nyitóegyenleg mentése')}</button></div>`;
 $('#form').onsubmit=saveOpeningBalance;setTimeout(updateOpeningBalanceDifference,0);
}
async function saveOpeningBalance(event){
 event.preventDefault();
 try{const body=openingBalanceFormPayload();await api('/api/opening-balance',{method:'PUT',body:JSON.stringify(body)});closeModal();financialStatementPeriodsCache=null;showToast(bi('Opening balance saved.','Nyitóegyenleg mentve.'),'success');await renderFinance();}catch(error){showError(error)}
}
async function renderFinance(){
 const month=currentMonthKey();let data=null,periods=[];
 try{[data,periods]=await Promise.all([loadMonthlyIncomeStatement(month),loadFinancialStatementPeriods(true)]);}catch(error){return showError(error)}
 const balance=data?.balanceSheet||{},audit=data?.balanceAudit||{},opening=data?.openingBalance;
 const operatingBalance=roundFinancial(Number(balance.cashBankAccounts||0)+Number(balance.accountsReceivable||0)-Number(balance.accountsPayable||0));
 const balanced=Boolean(audit.balanced);
 $('#finance').innerHTML=`<div class="panel finance-panel finance-dashboard"><div class="toolbar"><div><p class="event-kicker">Finance & Invoicing</p><h2>${bi('Balance Sheet','Mérleg')}</h2><p class="muted">${bi('Official US GAAP balance sheet. Current values are real-time; closed months are immutable snapshots below.','Hivatalos US GAAP mérleg. A jelenlegi értékek valós idejűek; a lezárt hónapok alul nem módosítható pillanatképként érhetők el.')}</p>${opening?`<p class="muted">${bi('Opening position','Nyitópozíció')}: <b>${htmlText(opening.effective_date||'')}</b></p>`:''}</div><div class="toolbar-actions">${isAdmin()?`<button type="button" class="ghost-btn" onclick="openOpeningBalanceModal()">${bi('Set / Edit Opening Balance','Nyitóegyenleg beállítása / szerkesztése')}</button>`:''}<button type="button" onclick="downloadFinancialStatementPdf('balance-sheet')">${billingIcon('download')} ${bi('Export Real-Time PDF','Valós idejű PDF export')}</button><button class="ghost-btn" type="button" onclick="render('invoice_documents')">${bi('Open Invoices Documents','Invoices Documents megnyitása')}</button><button class="ghost-btn" type="button" onclick="render('income_statement')">${bi('Open Income Statement','Eredménykimutatás megnyitása')}</button></div></div><div class="invoice-kpi-grid finance-dashboard-kpis"><div class="invoice-kpi revenue"><span>${bi('Cash & Bank Accounts','Készpénz és bankszámlák')}</span><strong>${invoiceMoney(balance.cashBankAccounts||0)}</strong></div><div class="invoice-kpi"><span>${bi('Accounts Receivable','Vevőkövetelések')}</span><strong>${invoiceMoney(balance.accountsReceivable||0)}</strong></div><div class="invoice-kpi payable"><span>${bi('Accounts Payable','Szállítói kötelezettségek')}</span><strong>${invoiceMoney(balance.accountsPayable||0)}</strong></div><div class="invoice-kpi net ${operatingBalance<0?'negative':'positive'}"><span>${bi('Operating Balance','Operatív egyenleg')}</span><strong>${operatingBalance<0?'-':'+'}${invoiceMoney(Math.abs(operatingBalance))}</strong></div></div><div class="finance-dashboard-grid balance-sheet-official-grid"><section class="panel finance-dashboard-card balance-sheet-column"><div class="workflow-block-head"><h3>${bi('ASSETS','ESZKÖZÖK')}</h3></div><div class="finance-dashboard-lines"><div><span>${bi('Cash & Bank Accounts','Készpénz és bankszámlák')}</span><b>${invoiceMoney(balance.cashBankAccounts||0)}</b></div><div><span>${bi('Accounts Receivable (AR)','Vevőkövetelések (AR)')}</span><b>${invoiceMoney(balance.accountsReceivable||0)}</b></div><div><span>${bi('Equipment / Inventory / Prepaid & Other Assets','Berendezés / készlet / aktív időbeli elhatárolás és egyéb eszközök')}</span><b>${invoiceMoney(balance.manualAssets||0)}</b></div><div class="balance-sheet-total"><strong>${bi('TOTAL ASSETS','ÖSSZES ESZKÖZ')}</strong><b>${invoiceMoney(balance.totalAssets||0)}</b></div></div></section><section class="panel finance-dashboard-card balance-sheet-column"><div class="workflow-block-head"><h3>${bi('LIABILITIES & EQUITY','KÖTELEZETTSÉGEK ÉS SAJÁT TŐKE')}</h3></div><div class="finance-dashboard-lines"><div><span>${bi('Accounts Payable (AP)','Szállítói kötelezettségek (AP)')}</span><b>${invoiceMoney(balance.accountsPayable||0)}</b></div><div><span>${bi('Sales Tax Payable','Fizetendő forgalmi adó')}</span><b>${invoiceMoney(balance.salesTaxPayable||0)}</b></div><div><span>${bi('Deferred Revenue / Contract Liability','Halasztott bevétel / szerződéses kötelezettség')}</span><b>${invoiceMoney(balance.deferredRevenue||0)}</b></div><div><span>${bi('Loans / Notes Payable & Other Liabilities','Hitelek / váltótartozások és egyéb kötelezettségek')}</span><b>${invoiceMoney(balance.manualLiabilities||0)}</b></div><div><span>${bi('Opening Retained Earnings / Equity','Nyitó eredménytartalék / saját tőke')}</span><b>${invoiceMoney(balance.ownersOpeningEquity||0)}</b></div><div><span>${bi('Retained Earnings / Current Net Income','Eredménytartalék / aktuális nettó eredmény')}</span><b>${invoiceMoney(balance.currentPeriodNetIncome||0)}</b></div><div><span>${bi('Other Equity','Egyéb saját tőke')}</span><b>${invoiceMoney(balance.manualEquity||0)}</b></div><div class="balance-sheet-total"><strong>${bi('TOTAL LIABILITIES & EQUITY','ÖSSZES KÖTELEZETTSÉG ÉS SAJÁT TŐKE')}</strong><b>${invoiceMoney(balance.totalLiabilitiesEquity||0)}</b></div></div></section></div><div class="balance-integrity ${balanced?'is-balanced':'is-unbalanced'}" role="status"><strong>${balanced?`<span class="balance-check-icon" aria-hidden="true">✓</span> ${bi('Balanced (In Balance: $0.00 difference)','Kiegyensúlyozott (Eltérés: $0.00)')}`:`${bi('Out of Balance','Eltérés a mérlegben')}: ${invoiceMoney(audit.absolute_difference||0)}`}</strong><span>${bi('Assets = Liabilities + Equity','Eszközök = Kötelezettségek + Saját tőke')}</span></div></div>${financialStatementArchiveMarkup(periods,'balance-sheet')}`;
}

async function renderInvoiceDocuments(selectedMonth=""){
 const month=selectedMonth||document.getElementById('invoiceMonth')?.value||currentMonthKey();
 let payload={invoices:[],summary:{revenue:0,payables:0,net:0}};
 try{payload=await api(`/api/invoices?bucket=${encodeURIComponent(invoiceDocumentsBucket)}`);}catch(error){showError(error);}
 const rows=payload.invoices||[],receivables=rows.filter(row=>row.direction==='receivable'),payables=rows.filter(row=>row.direction==='payable');
 const summary=payload.summary||{revenue:0,payables:0,net:0},net=Number(summary.net||0);
 const statusLabel=row=>{const status=String(row.lifecycle_status||row.status||'');return status==='Pending'?bi('Pending','Függőben'):status==='Paid'?bi('Paid','Fizetve'):status==='Overdue'?bi('Overdue','Lejárt'):status==='Void'?bi('Void','Stornózott'):status==='Draft'?bi('Draft','Tervezet'):status;};
 const statusClass=row=>`status-${String(row.lifecycle_status||row.status||'pending').toLowerCase().replace(/[^a-z]+/g,'-')}`;
 const invoiceTable=(items,direction)=>`<div class="invoice-pane ${direction}"><div class="invoice-pane-head"><div><span class="event-kicker">${direction==='receivable'?bi('Receivables','Követelések'):bi('Payables','Kötelezettségek')}</span><h3>${direction==='receivable'?bi('Outgoing invoices','Kimenő számlák'):bi('Incoming invoices','Bejövő számlák')}</h3></div><strong>${invoiceMoney(items.reduce((sum,row)=>sum+Number(['void','draft'].includes(String(row.status||'').toLowerCase())?0:row.total_amount||0),0))}</strong></div><div class="invoice-list">${items.map(row=>`<article class="invoice-row ${row.status==='void'?'void':''} ${statusClass(row)}"><div class="invoice-main"><b>${htmlText(row.counterparty_name||row.summary||'—')}</b><span>${htmlText(row.invoice_number||'')}</span><small>${htmlText(row.summary||'')} · <span class="invoice-status-badge ${statusClass(row)}">${htmlText(statusLabel(row))}</span>${row.due_date?` · ${bi('Due','Esedékes')}: ${htmlText(row.due_date)}`:''}</small></div><div class="invoice-amount">${invoiceMoney(row.total_amount||0)}</div><div class="invoice-actions"><button class="icon-action" title="View" onclick="previewInvoice('${row.id}')">${billingIcon('eye')}</button><button class="icon-action" title="Download PDF" onclick="downloadInvoicePdf('${row.id}','${htmlText(row.invoice_number||'invoice')}')">${billingIcon('download')}</button>${invoiceDocumentsBucket==='archive'&&isAdmin()?`<button class="icon-action" title="Edit Invoice Details" onclick="openInvoiceAdjustment('${row.id}')">✎</button>`:''}${invoiceDocumentsBucket==='active'?`${row.status==='draft'&&isAdmin()?`<button class="icon-action primary-action" title="Review / Issue" onclick="reviewWorkflowDraftInvoice('${row.id}')">✓</button>`:''}<button class="icon-action" title="Print" onclick="printInvoice('${row.id}')">${billingIcon('print')}</button>${row.status!=='void'&&row.status!=='draft'?`<button class="icon-action danger-btn" title="Void" onclick="voidInvoice('${row.id}')">🚫</button>`:''}`:''}</div></article>`).join('')||`<div class="empty-state">${invoiceDocumentsBucket==='archive'?bi('No archived invoices.','Nincs archivált számla.'):bi('No active invoices.','Nincs aktív számla.')}</div>`}</div></div>`;
 $('#invoice_documents').innerHTML=`<div class="panel finance-panel invoice-workspace"><div class="toolbar"><div><p class="event-kicker">Finance & Invoicing</p><h2>${bi('Invoices Documents','Számladokumentumok')}</h2><p class="muted">${bi('Active and archived receivables / payables with audited corrections and PDF output.','Aktív és archivált követelések / kötelezettségek auditált korrekcióval és PDF-kimenettel.')}</p></div><div class="invoice-toolbar"><input id="invoiceMonth" type="month" value="${htmlText(month)}"><button class="small" onclick="downloadMonthlyInvoiceReport()">⬇️ ${bi('Export Monthly Statement (PDF)','Havi kimutatás exportálása (PDF)')}</button>${isAdmin()?`<button class="small primary-action" onclick="openManualInvoiceModal()">+ ${bi('Create Invoice / Bill','Számla / bizonylat létrehozása')}</button>`:''}</div></div><div class="invoice-lifecycle-tabs" role="tablist"><button type="button" class="${invoiceDocumentsBucket==='active'?'active':''}" onclick="setInvoiceDocumentsBucket('active')">${bi('Active Invoices','Aktív számlák')}</button><button type="button" class="${invoiceDocumentsBucket==='archive'?'active':''}" onclick="setInvoiceDocumentsBucket('archive')">${bi('Archived Invoices','Archivált számlák')}</button></div><div class="invoice-kpi-grid"><div class="invoice-kpi revenue"><span>${bi('Visible Receivables','Látható követelések')}</span><strong>${invoiceMoney(summary.revenue||0)}</strong></div><div class="invoice-kpi payable"><span>${bi('Visible Payables','Látható kötelezettségek')}</span><strong>${invoiceMoney(summary.payables||0)}</strong></div><div class="invoice-kpi net ${net<0?'negative':'positive'}"><span>${bi('Net Balance','Nettó egyenleg')}</span><strong>${net<0?'-':'+'}${invoiceMoney(Math.abs(net))}</strong></div></div><div class="invoice-split">${invoiceTable(receivables,'receivable')}${invoiceTable(payables,'payable')}</div></div>`;
}
async function setInvoiceDocumentsBucket(bucket){invoiceDocumentsBucket=bucket==='archive'?'archive':'active';await renderInvoiceDocuments();}
async function renderInvoiceDocumentsMonth(month){await renderInvoiceDocuments(month||currentMonthKey());}

function openPurgeAllInvoicesModal(){appAlert(bi('Financial documents are immutable. Issued invoices and bills can only be voided with a documented adjustment reason.','A pénzügyi bizonylatok megváltoztathatatlanok. A kiadott számlák és bizonylatok kizárólag dokumentált indoklással stornózhatók.'),'info');}

async function issueDraftInvoice(id){try{const reason=await appPrompt(bi('Approval / issue note','Jóváhagyási / kiállítási megjegyzés'),{initialValue:bi('Workflow draft approved and issued','Workflow számlatervezet jóváhagyva és kiállítva')});if(reason===null)return;const issued=await api(`/api/invoices/${encodeURIComponent(id)}/issue`,{method:'POST',body:JSON.stringify({reason})});closeModal();showToast(`${issued.invoice_number} · ${bi('issued','kiállítva')}`,'success');await renderInvoiceDocuments();await previewInvoice(issued.id);}catch(error){showError(error)}}
async function reviewWorkflowDraftInvoice(id){if(!isAdmin())return showError('PERMISSION_DENIED');try{const row=await api(`/api/invoices/${encodeURIComponent(id)}`);$('#modal').classList.remove('hidden');$('#modalTitle').textContent=`${bi('Workflow Invoice Draft','Workflow számlatervezet')} · ${row.invoice_number}`;$('#form').innerHTML=`${manualInvoicePreviewMarkup(row)}<div class="actions"><button type="button" class="ghost-btn" onclick="openInvoiceAdjustment('${row.id}')">${bi('Edit Draft','Tervezet szerkesztése')}</button><button type="button" class="primary-action" onclick="issueDraftInvoice('${row.id}')">${bi('Issue Invoice','Számla kiállítása')}</button><button type="button" onclick="closeModal()">${bi('Close','Bezárás')}</button></div>`;}catch(error){showError(error)}}

async function previewInvoice(id){try{const row=await api(`/api/invoices/${encodeURIComponent(id)}`);$('#modal').classList.remove('hidden');$('#modalTitle').textContent=`${row.invoice_number} · ${row.direction==='payable'?bi('Payable','Kötelezettség'):bi('Receivable','Követelés')}`;$('#form').innerHTML=`${manualInvoicePreviewMarkup(row)}<div class="actions"><button type="button" class="ghost-btn" onclick="downloadInvoicePdf('${row.id}','${htmlText(row.invoice_number||'invoice')}')">${billingIcon('download')} ${bi('Download PDF','PDF letöltése')}</button><button type="button" class="ghost-btn" onclick="printInvoice('${row.id}')">${billingIcon('print')} ${bi('Print','Nyomtatás')}</button><button type="button" onclick="closeModal()">${billingIcon('close')} ${bi('Close','Bezárás')}</button></div>`;}catch(error){showError(error)}}

async function openInvoiceAdjustment(id){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 try{
  const row=await api(`/api/invoices/${encodeURIComponent(id)}`);
  $('#modal').classList.remove('hidden');$('#modalTitle').textContent=`${bi('Edit Invoice Details','Számlaadatok módosítása')} · ${row.invoice_number}`;
  const itemRows=(row.items||[]).map((item,index)=>`<div class="invoice-adjustment-item" data-adjust-item><div class="field full"><label>${bi('Description','Megnevezés')}</label><input name="item_description" value="${htmlText(item.item_description||'')}" required minlength="3"></div><div class="field"><label>${bi('Qty','Menny.')}</label><input name="quantity" type="number" min="0.0001" step="0.0001" value="${Number(item.quantity||1)}"></div><div class="field"><label>${bi('Unit Price','Egységár')}</label><input name="unit_price" type="text" inputmode="decimal" value="${Number(item.unit_price||0).toFixed(2)}"></div><input type="hidden" name="line_type" value="${htmlText(item.line_type||'custom')}"><input type="hidden" name="payment_method" value="${htmlText(item.payment_method||'')}"><input type="hidden" name="financial_status" value="${htmlText(item.financial_status||'')}"></div>`).join('');
  $('#form').innerHTML=`<div class="invoice-adjustment-warning">${bi('This is an audited financial correction. The invoice number will not change.','Ez auditált pénzügyi korrekció. A bizonylatszám nem változik.')}</div><div class="form-grid"><div class="field"><label>${bi('Invoice Number','Számlaszám')}</label><input value="${htmlText(row.invoice_number)}" disabled></div><div class="field"><label>${bi('Payment Method','Fizetési mód')}</label><select name="payment_method">${STANDARD_PAYMENT_METHODS.map(method=>`<option value="${htmlText(method)}" ${method===row.payment_method?'selected':''}>${htmlText(method)}</option>`).join('')}</select></div><div class="field"><label>${bi('Issue Date','Kiállítás dátuma')}</label><input name="issue_date" type="date" value="${htmlText(row.issue_date||'')}" required></div><div class="field"><label>${bi('Due Date','Esedékesség')}</label><input name="due_date" type="date" value="${htmlText(row.due_date||'')}" required></div><div class="field full"><label>${bi('Summary','Összefoglaló')}</label><input name="summary" value="${htmlText(row.summary||'')}" minlength="3" required></div><div class="field"><label>${bi('Tax %','Adó %')}</label><input name="tax_rate" type="text" inputmode="decimal" value="${Number(row.tax_rate||0).toFixed(2)}"></div><div class="field"><label>${bi('Financial Status','Pénzügyi státusz')}</label>${row.status==='draft'?`<input value="${bi('Draft - issue separately','Tervezet - külön kell kiállítani')}" disabled>`:`<select name="financial_status" ${row.status==='void'?'disabled':''}><option value="Pending" ${row.status!=='paid'?'selected':''}>Pending</option><option value="Paid" ${row.status==='paid'?'selected':''}>Paid</option></select>`}</div><div class="field full"><label>${bi('Notes','Megjegyzés')}</label><textarea name="notes">${htmlText(row.notes||'')}</textarea></div></div><h3>${bi('Invoice Items','Számlatételek')}</h3><div class="invoice-adjustment-items">${itemRows}</div><div class="field full adjustment-reason-field"><label>${bi('Reason for Adjustment','Módosítás oka')} *</label><textarea name="reason" required minlength="5" placeholder="${bi('Minimum 5 characters','Minimum 5 karakter')}"></textarea></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="button" onclick="saveInvoiceAdjustment('${row.id}')">${bi('Save Audited Adjustment','Auditált módosítás mentése')}</button></div>`;
 }catch(error){showError(error)}
}
async function saveInvoiceAdjustment(id){
 try{
  const form=$('#form'),data=Object.fromEntries(new FormData(form).entries());
  if(String(data.reason||'').trim().length<5)throw new Error(bi('Reason for Adjustment must contain at least 5 characters.','A módosítás okának legalább 5 karaktert kell tartalmaznia.'));
  data.items=[...form.querySelectorAll('[data-adjust-item]')].map(block=>({item_description:block.querySelector('[name="item_description"]')?.value||'',quantity:block.querySelector('[name="quantity"]')?.value||1,unit_price:block.querySelector('[name="unit_price"]')?.value||0,line_type:block.querySelector('[name="line_type"]')?.value||'custom',payment_method:block.querySelector('[name="payment_method"]')?.value||'',financial_status:block.querySelector('[name="financial_status"]')?.value||''}));
  if(!data.items.length||data.items.some(item=>String(item.item_description).trim().length<3))throw new Error(bi('Every invoice item requires a valid description.','Minden számlatételhez érvényes megnevezés szükséges.'));
  const updated=await api(`/api/invoices/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(data)});closeModal();showToast(`${updated.invoice_number} · ${bi('adjustment saved','módosítás mentve')}`,'success');await renderInvoiceDocuments();await previewInvoice(updated.id);
 }catch(error){showError(error.message||error)}
}

async function downloadInvoicePdf(id,number='invoice'){const response=await fetch(`/api/invoices/${encodeURIComponent(id)}/pdf`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)return showError((await response.json()).error);const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${number}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function printInvoice(id){const response=await fetch(`/api/invoices/${encodeURIComponent(id)}/pdf`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)return showError((await response.json()).error);const blob=await response.blob(),url=URL.createObjectURL(blob),win=window.open(url,'_blank');if(win)win.addEventListener('load',()=>win.print(),{once:true});setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function voidInvoice(id){if(!await appConfirm(bi('Void this invoice? The record will remain visible and in the financial audit trail.','Stornózod ezt a számlát? A rekord látható és a pénzügyi auditnaplóban megmarad.'),{type:'error',confirmText:bi('Void invoice','Számla stornózása')}))return;const reason=await appPrompt(bi('Reason','Indok'),{type:'error'});if(reason===null)return;try{await api(`/api/invoices/${encodeURIComponent(id)}/void`,{method:'POST',body:JSON.stringify({reason})});await renderInvoiceDocuments();}catch(error){showError(error)}}
async function hardDeleteInvoice(id){return voidInvoice(id)}
async function rebillInvoiceSource(sourceType,sourceId){const method=await chooseStandardPaymentMethod({title:bi('Payment method for re-invoicing','Fizetési mód az újraszámlázáshoz'),initialValue:'Bank Transfer / ACH',confirmText:bi('Create invoice','Számla létrehozása')});if(!method)return;try{const result=await api('/api/invoices/rebill-source',{method:'POST',body:JSON.stringify({source_type:sourceType,source_id:sourceId,payment_method:method})});showToast((result.invoices||[]).map(row=>row.invoice_number).join(', ')||bi('Invoice created.','Számla létrehozva.'),'success');await renderInvoiceDocuments();}catch(error){showError(error)}}
async function purgeAllInvoices(){return showError({message:'IMMUTABLE_FINANCIAL_RECORDS'})}
async function downloadMonthlyInvoiceReport(){const month=$('#invoiceMonth')?.value||currentMonthKey();const response=await fetch(`/api/invoices/monthly/report.pdf?month=${encodeURIComponent(month)}`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)return showError((await response.json()).error);const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`klavierhaus-monthly-financial-${month}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

async function renderPartners(){
 let partners=[];try{partners=await api('/api/partners');}catch(error){return showError(error)}
 $('#partners').innerHTML=`${mobileBackHeader(bi('Partners','Partnerek'))}<div class="panel partners-shell"><div class="toolbar"><div><p class="event-kicker">Technical Operation</p><h2>${bi('Partners','Partnerek')}</h2><p class="muted">${bi('Partner companies and contractor assignments used by payable invoices.','Partnercégek és bedolgozói hozzárendelések a bejövő bizonylatokhoz.')}</p></div><button onclick="openPartnerEditor()">+ ${bi('New Partner','Új partner')}</button></div><div class="partner-grid">${partners.map(row=>`<article class="partner-card"><div><span class="status-pill ${row.status==='active'?'ok':'muted'}">${htmlText(row.status)}</span><h3>${htmlText(row.company_name)}</h3><p>${htmlText(row.contact_person||'')} ${row.contact_email?`· ${htmlText(row.contact_email)}`:''}</p></div><dl><div><dt>${bi('Tax ID','Adószám')}</dt><dd>${htmlText(row.tax_id||'—')}</dd></div><div><dt>${bi('Default tax','Alapértelmezett adó')}</dt><dd>${Number(row.default_tax_rate||0).toFixed(2)}%</dd></div><div><dt>${bi('Contractors','Bedolgozók')}</dt><dd>${row.contractor_count||0}</dd></div><div><dt>${bi('Invoices','Bizonylatok')}</dt><dd>${row.invoice_count||0}</dd></div></dl><div class="actions"><button class="small" onclick="openPartnerEditor('${row.id}')">${bi('Edit','Szerkesztés')}</button><button class="small danger-btn" onclick="deletePartner('${row.id}')">${isSuperadmin()?bi('Delete','Törlés'):bi('Deactivate','Inaktiválás')}</button></div></article>`).join('')||`<div class="empty-state">${bi('No partners yet.','Még nincs partner.')}</div>`}</div></div>`;
}
async function openPartnerEditor(id=''){let row={status:'active',default_tax_rate:0,contractors:[]};if(id)row=await api(`/api/partners/${encodeURIComponent(id)}`);let users=[];try{users=await api('/api/users');}catch(_error){}const selected=new Set((row.contractors||[]).map(x=>x.user_id).filter(Boolean));$('#modal').classList.remove('hidden');$('#modalTitle').textContent=id?bi('Edit Partner','Partner szerkesztése'):bi('New Partner','Új partner');$('#form').innerHTML=`<div class="form-grid"><div class="field"><label>${req(bi('Company name','Cégnév'))}</label><input name="company_name" value="${htmlText(row.company_name||'')}" required></div><div class="field"><label>${bi('Tax ID','Adószám')}</label><input name="tax_id" value="${htmlText(row.tax_id||'')}"></div><div class="field full"><label>${bi('Billing address','Számlázási cím')}</label><input name="billing_address" value="${htmlText(row.billing_address||'')}"></div><div class="field"><label>${bi('Contact person','Kapcsolattartó')}</label><input name="contact_person" value="${htmlText(row.contact_person||'')}"></div><div class="field"><label>Email</label><input name="contact_email" type="email" value="${htmlText(row.contact_email||'')}"></div><div class="field"><label>${bi('Phone','Telefon')}</label><input name="contact_phone" value="${htmlText(row.contact_phone||'')}"></div><div class="field"><label>${bi('Default tax rate %','Alapértelmezett adó %')}</label><input name="default_tax_rate" type="text" inputmode="decimal" value="${roundFinancial(Number(row.default_tax_rate||0)).toFixed(2)}"></div><div class="field"><label>${bi('Status','Állapot')}</label><select name="status"><option value="active" ${row.status==='active'?'selected':''}>active</option><option value="inactive" ${row.status==='inactive'?'selected':''}>inactive</option></select></div><div class="field full"><label>${bi('Assigned contractors','Hozzárendelt bedolgozók')}</label><div class="partner-user-picker">${users.map(u=>`<label><input type="checkbox" name="partner_user" value="${u.id}" ${selected.has(u.id)?'checked':''}> ${htmlText(u.name||u.email||u.id)}</label>`).join('')}</div></div></div><div class="actions"><button type="button" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="button" onclick="savePartner('${id}')">${bi('Save','Mentés')}</button></div>`;}
async function savePartner(id=''){const form=$('#form'),data=Object.fromEntries(new FormData(form).entries());data.default_tax_rate=Number(data.default_tax_rate||0);data.user_ids=[...form.querySelectorAll('input[name="partner_user"]:checked')].map(x=>x.value);try{await api(id?`/api/partners/${encodeURIComponent(id)}`:'/api/partners',{method:id?'PATCH':'POST',body:JSON.stringify(data)});closeModal();await renderPartners();}catch(error){showError(error)}}
async function deletePartner(id){if(!await appConfirm(isSuperadmin()?bi('Permanently delete this partner?','Véglegesen törlöd ezt a partnert?'):bi('Deactivate this partner?','Inaktiválod ezt a partnert?'),{type:'error'}))return;try{await api(`/api/partners/${encodeURIComponent(id)}`,{method:'DELETE'});await renderPartners();}catch(error){showError(error)}}

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
   ${isEdit?`<div class="field full adjustment-reason-field"><label>${req(bi("Reason for Adjustment","Módosítás oka"))}</label><textarea name="reason" minlength="5" required placeholder="${bi("Minimum 5 characters. Closed-period changes are posted into the current open period.","Minimum 5 karakter. A lezárt időszakot érintő korrekció az aktuális nyitott időszakban kerül elszámolásra.")}"></textarea></div>`:""}
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>${isEdit?"Save audited adjustment / Auditált módosítás mentése":"Create item / Tétel létrehozása"}</button></div>`;
 $("#form").onsubmit=async e=>{
   e.preventDefault();
   const body=Object.fromEntries(new FormData(e.target));
   body.amount=Number(body.amount||0);
   if(isEdit&&String(body.reason||'').trim().length<5)return showError(bi('Reason for Adjustment must contain at least 5 characters.','A módosítás okának legalább 5 karaktert kell tartalmaznia.'));
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
 if(!await appConfirm(bi("Void this financial item? The original record will remain permanently in the audit trail and a current-period reversal will remove its accounting effect.","Stornózod ezt a pénzügyi tételt? Az eredeti rekord véglegesen megmarad az auditnaplóban, és egy aktuális időszaki ellenkönyvelés vezeti ki a számviteli hatását."),{type:"error",confirmText:bi("Void item","Tétel stornózása")})) return;
 const reason=await appPrompt(bi("Reason for Adjustment (minimum 5 characters)","Módosítás oka (minimum 5 karakter)"),{type:"error"});
 if(reason===null)return;if(String(reason||'').trim().length<5)return showError(bi('Reason for Adjustment must contain at least 5 characters.','A módosítás okának legalább 5 karaktert kell tartalmaznia.'));
 try{await api(`/api/financial-items/${id}`,{method:"DELETE",body:JSON.stringify({reason:String(reason).trim()})});await renderFinance()}catch(err){showError(err)}
}
function currentMonthKey(){
 return newYorkNowLocal().slice(0,7);
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
 const lineRows=(arr,fallback)=>arr?.length?arr.map(a=>`<div class="cf-line"><span>${currentLang==='hu'?(a.name_hu||a.name_en):(a.name_en||a.name_hu)}</span><b>${money(a.balance)}</b></div>`).join(''):`<div class="cf-line empty"><span>${fallback}</span><b>—</b></div>`;
 const operatingRows=lineRows(d.operatingRevenueAccounts,bi('No operating revenue activity','Nincs üzemi árbevételi mozgás'));
 const passiveRows=lineRows(d.passiveIncomeAccounts,bi('No passive or non-operating income','Nincs passzív vagy működésen kívüli bevétel'));
 const expenseRows=lineRows(d.expenseAccounts,bi('No expense activity','Nincs költségmozgás'));
 const cash=d.cashFlow||{};
 const trial=includeTrial?`<div class="panel income-trial-table no-print-break"><h3>${bi('Technical Summary','Technikai összesítő')}</h3><div class="table-wrap"><table><thead><tr><th>${bi('Code','Kód')}</th><th>${bi('Account','Számla')}</th><th>${bi('Category','Kategória')}</th><th>${bi('Debit','Tartozik')}</th><th>${bi('Credit','Követel')}</th><th>${bi('Balance','Egyenleg')}</th></tr></thead><tbody>${d.trialBalance.map(a=>`<tr><td>${a.code}</td><td>${a.name_en}<br><small>${a.name_hu}</small></td><td>${a.category}</td><td>${money(a.debit_total)}</td><td>${money(a.credit_total)}</td><td>${money(a.balance)}</td></tr>`).join('')||`<tr><td colspan="6" class="muted">${bi('No ledger data','Nincs főkönyvi adat')}</td></tr>`}</tbody></table></div></div>`:'';
 return `<div class="grid kpis income-statement-kpis"><div class="kpi"><span>${bi('Operating Revenue','Üzemi árbevétel')}</span><strong>${money(d.totals.operatingRevenue||0)}</strong></div><div class="kpi"><span>${bi('Passive & Non-Operating Income','Passzív és működésen kívüli bevétel')}</span><strong>${money(d.totals.passiveNonOperatingIncome||0)}</strong></div><div class="kpi"><span>${bi('Expenses','Kiadások')}</span><strong>${money(d.totals.expenses||0)}</strong></div><div class="kpi"><span>${bi('Net Income','Nettó eredmény')}</span><strong>${money(d.totals.profit||0)}</strong></div></div><div class="cashflow-layout"><div class="cf-main-title"><h2>${bi('Income Statement','Eredménykimutatás')}</h2><p>${bi('Accrual P&L with a monthly cash roll-forward','Időbeli elhatárolásos P&L havi pénzeszköz-gördítéssel')}</p></div><div class="cf-upper"><div class="cf-left-stack"><div class="cf-card"><div class="cf-card-head">${bi('Operating Revenue','Üzemi árbevétel')}</div><div class="cf-card-body">${operatingRows}<div class="cf-rule"></div><div class="cf-line total"><span>${bi('Total Operating Revenue','Összes üzemi árbevétel')}</span><b>${money(d.totals.operatingRevenue||0)}</b></div></div></div><div class="cf-card"><div class="cf-card-head">${bi('Expenses','Kiadások')}</div><div class="cf-card-body">${expenseRows}<div class="cf-rule"></div><div class="cf-line total"><span>${bi('Total Expenses','Összes kiadás')}</span><b>${money(d.totals.expenses||0)}</b></div></div></div></div><div class="cf-right-stack"><div class="cf-card cf-bookkeeper"><div class="cf-card-head">${bi('Passive & Non-Operating Income','Passzív és működésen kívüli bevétel')}</div><div class="cf-card-body">${passiveRows}<div class="cf-rule"></div><div class="cf-line total"><span>${bi('Total Passive & Non-Operating Income','Összes passzív és működésen kívüli bevétel')}</span><b>${money(d.totals.passiveNonOperatingIncome||0)}</b></div></div></div><div class="cf-card"><div class="cf-card-head">${bi('Net Income','Nettó eredmény')}</div><div class="cf-card-body"><div class="cf-line cashflow"><span>${bi('Operating + Non-Operating − Expenses','Üzemi + passzív − kiadások')}</span><b>${money(d.totals.profit||0)}</b></div></div></div></div></div><div class="cf-card cash-roll-forward"><div class="cf-card-head">${bi('Monthly Cash Flow Roll-Forward','Havi pénzáramlás-gördítés')}</div><div class="cf-card-body cash-roll-forward-grid"><div class="cf-line"><span>${bi('Beginning Balance','Előző havi nyitó egyenleg')}</span><b>${money(cash.beginningBalance||0)}</b></div><div class="cf-line"><span>${bi('Net Cash Flow','Tárgyhavi nettó pénzáramlás')}</span><b>${money(cash.netCashFlow||0)}</b></div><div class="cf-line total"><span>${bi('Ending Balance','Tárgyhavi záró egyenleg')}</span><b>${money(cash.endingBalance||0)}</b></div></div></div></div>${trial}`;
}

async function renderIncomeStatement(){
 const currentMonth=currentMonthKey();let d=null,periods=[];
 try{[d,periods]=await Promise.all([loadMonthlyIncomeStatement(currentMonth),loadFinancialStatementPeriods(true)]);}catch(error){return showError(error)}
 $('#income_statement').innerHTML=`<div class="panel no-print"><div class="toolbar"><div><p class="event-kicker">Finance & Invoicing</p><h2>${bi('Income Statement','Eredménykimutatás')}</h2><p class="muted">${bi('Current period is real-time. Closed monthly statements are immutable and downloadable below.','A jelenlegi időszak valós idejű. A lezárt havi kimutatások nem módosíthatók és alul letölthetők.')}</p><p class="muted">${bi('Current month','Aktuális hónap')}: <b>${d.month}</b> · ${bi('Generated','Lekérés ideje')}: <b>${new Date(d.generatedAt).toLocaleString()}</b></p></div><div class="toolbar-actions">${isAdmin()?`<button class="ghost-btn" onclick="openEmployeeDailyRates()">${bi('Employee Daily Rates','Munkavállalói napidíjak')}</button>`:''}<button onclick="downloadFinancialStatementPdf('income-statement')">${billingIcon('download')} ${bi('Export Real-Time PDF','Valós idejű PDF export')}</button></div></div></div><div id="incomeStatementCurrent" data-month="${d.month}">${renderIncomeSheetHTML(d,false)}</div>${financialStatementArchiveMarkup(periods,'income-statement')}`;
}

async function openEmployeeDailyRates(){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 const date=newYorkNowLocal().slice(0,10),data=await api(`/api/employee-daily-rates?date=${encodeURIComponent(date)}`);
 $('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Contractor Daily Rates','Alvállalkozói napidíjak');
 $('#form').innerHTML=`<div class="daily-rate-admin"><p class="muted">${bi('Rates are effective-dated. Changing a master rate never overwrites historical job allocations.','A napidíjak hatálydátumosak. A master napidíj módosítása nem írja felül a korábbi munkák allokációját.')}</p><div class="field"><label>${bi('Effective date','Hatály kezdete')}</label><input id="dailyRateEffectiveDate" type="date" value="${date}"></div><div class="table-wrap"><table><thead><tr><th>${bi('Employee','Munkavállaló')}</th><th>${bi('Role','Szerepkör')}</th><th>${bi('Daily Rate','Napidíj')}</th><th>${bi('Currency','Pénznem')}</th><th>${bi('Action','Művelet')}</th></tr></thead><tbody>${(data.employees||[]).map(e=>`<tr data-daily-user="${htmlText(e.id)}"><td>${htmlText(e.name||e.email||e.id)}</td><td>${htmlText(e.role||'')}</td><td><input data-rate type="number" min="0" step="0.01" value="${Number(e.rate||0)}"></td><td><input data-currency maxlength="3" value="${htmlText(e.currency||'USD')}"></td><td><button type="button" class="small" onclick="saveEmployeeDailyRate('${htmlText(e.id)}')">${bi('Save','Mentés')}</button></td></tr>`).join('')}</tbody></table></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Close','Bezárás')}</button></div>`;
 applyLanguageToDOM(document.getElementById('modal'));
}
async function saveEmployeeDailyRate(userId){
 const row=document.querySelector(`[data-daily-user="${CSS.escape(String(userId))}"]`);if(!row)return;
 const rate=Number(row.querySelector('[data-rate]')?.value||0),currency=String(row.querySelector('[data-currency]')?.value||'USD').trim().toUpperCase(),effective_date=document.getElementById('dailyRateEffectiveDate')?.value||newYorkNowLocal().slice(0,10);
 try{await api(`/api/employee-daily-rates/${encodeURIComponent(userId)}`,{method:'PUT',body:JSON.stringify({rate,currency,effective_date})});showToast(bi('Daily rate saved.','Napidíj mentve.'),'success');}catch(error){showError(error)}
}

async function exportIncomeStatementPDF(month=currentMonthKey()){return downloadFinancialStatementPdf("income-statement",month===currentMonthKey()?"":month);}
async function exportBalanceSheetPDF(month=""){return downloadFinancialStatementPdf("balance-sheet",month);}

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
 if(String(id||"").startsWith("WF-")) return workflowSuperDelete(id);
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
 const estimatedMinutes=Math.max(SCHEDULE_INTERVAL_MINUTES,Math.round(Number(row?.estimated_hours||2)*60/SCHEDULE_INTERVAL_MINUTES)*SCHEDULE_INTERVAL_MINUTES);
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
   <div class="field"><label>${bi("Estimated duration","Tervezett időtartam")}</label><input id="plannedEstimatedDuration" type="text" inputmode="numeric" value="${formatDurationInput(estimatedMinutes)}" pattern="[0-9]{1,3}[:.][0-5][0-9]" placeholder="3:15" required><input name="estimated_hours" type="hidden" value="${estimatedMinutes/60}"><small>${bi("Format: hours:minutes, in 15-minute steps.","Formátum: óra:perc, 15 perces lépésekben.")}</small></div>
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
   if(!Number.isFinite(durationMinutes)||durationMinutes<SCHEDULE_INTERVAL_MINUTES){showError("INVALID_PLANNED_DURATION");return;}
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
 const plannedMinutes=Math.max(SCHEDULE_INTERVAL_MINUTES,Math.round(Number(x.estimated_hours||2)*60/SCHEDULE_INTERVAL_MINUTES)*SCHEDULE_INTERVAL_MINUTES);
 const start=roundWallClockUp(newYorkNowLocal(),SCHEDULE_INTERVAL_MINUTES);const end=addWallClockMinutes(start,plannedMinutes);
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Convert to Scheduled Job / Áthelyezés naptárba";
 $("#form").innerHTML=`<p class="muted">A rendszer backend oldalon ellenőrzi, hogy a kiválasztott felelős szabad-e az adott időintervallumban.</p><div class="form-grid">
   <div class="field"><label>${req("Title / Munka neve")}</label><input name="title" value="${x.title||""}" required></div>
   <div class="field"><label>${req("Assigned to / Felelős")}</label><select id="convertAssignedUser" name="assigned_user_id">${workerSelectOptions(x.preferred_assigned_user_id,x.preferred_assigned_to)}</select><small class="worker-availability-hint" aria-live="polite"></small></div>
   <div class="field"><label>${req("Start / Kezdés")}</label><input id="convertJobStart" name="start_time" type="datetime-local" value="${start}" step="900" required></div>
   <div class="field"><label>${req("End / Befejezés")}</label><input id="convertJobEnd" name="end_time" type="datetime-local" value="${end}" step="900" required></div>
   <div class="field"><label>Final agreed amount / Végleges megbeszélt összeg</label><input name="planned_amount" type="number" value="${x.expected_revenue||0}"></div>
   <div class="field"><label>${bi("Planned duration","Tervezett időtartam")}</label><input id="convertPlannedDuration" type="text" inputmode="numeric" value="${formatDurationInput(plannedMinutes)}" pattern="[0-9]{1,3}[:.][0-5][0-9]" placeholder="3:15" required><input id="convertPlannedHours" name="planned_hours" type="hidden" value="${plannedMinutes/60}"><input id="convertPlannedMinutes" name="planned_minutes" type="hidden" value="${plannedMinutes}"></div>
   <div class="field full"><label>${req("Service address / Cím")}</label><input name="service_address" value="${x.service_address||""}" required></div>
   <div class="field full"><label>Instructions / Instrukció</label><textarea name="instructions">${x.next_step||x.notes||""}</textarea></div>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Convert / Naptárba helyezés</button></div>`;
 const convertStart=document.getElementById("convertJobStart"),convertEnd=document.getElementById("convertJobEnd"),convertDuration=document.getElementById("convertPlannedDuration");
 const syncEnd=()=>{const minutes=parseDurationInput(convertDuration.value);if(Number.isFinite(minutes)&&minutes>=SCHEDULE_INTERVAL_MINUTES){document.getElementById("convertPlannedMinutes").value=String(minutes);document.getElementById("convertPlannedHours").value=String(minutes/60);convertEnd.value=addWallClockMinutes(convertStart.value,minutes);}};
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
   if(!Number.isFinite(durationMinutes)||durationMinutes<SCHEDULE_INTERVAL_MINUTES){showError("INVALID_PLANNED_DURATION");return;}
   try{const r=await api(`/api/planned-jobs/${x.id}/convert`,{method:"POST",body:JSON.stringify(body)}); await appAlert(`${bi("Scheduled job created","Naptári munka létrejött")}: ${r.job?.job_key||r.job?.id||""}`,"success"); closeModal(); currentWeekStart=startOfWeek(body.start_time); await renderScheduler();}catch(err){showError(err)}
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
async function renderNotificationAcknowledgements(){
 try{
  const rows=await api('/api/notifications/acknowledgements');
  $('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Acknowledgement history','Nyugtázási előzmények');
  $('#form').innerHTML=`<div class="notification-acknowledgement-history"><p class="muted">${bi('Notifications acknowledged by you are listed here.','Az általad tudomásul vett értesítések itt találhatók.')}</p><div class="table-wrap"><table><thead><tr><th>${bi('Notification','Értesítés')}</th><th>${bi('Acknowledged','Tudomásul véve')}</th></tr></thead><tbody>${rows.length?rows.map(row=>`<tr><td>${htmlText(notificationText(row,'title'))}</td><td>${htmlText(row.acknowledged_at||row.created_at||'')}</td></tr>`).join(''):`<tr><td colspan="2">${bi('No acknowledged notifications.','Nincs nyugtázott értesítés.')}</td></tr>`}</tbody></table></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Close','Bezárás')}</button></div></div>`;
 }catch(error){showError(error)}
}
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
 const pushButton=`<button type="button" class="small" onclick="enablePushNotifications()">${bi('Enable push notifications','Push értesítések engedélyezése')}</button><button type="button" class="small ghost-btn" onclick="renderNotificationAcknowledgements()">${bi('Acknowledgement history','Nyugtázási előzmények')}</button>`;
 const cards=currentNotifications.map(row=>`<button type="button" class="notification-card" onclick="openNotificationDetail('${row.id}')"><span class="notification-card-icon">${notificationIcon(row.notification_type)}</span><span><strong>${htmlText(notificationText(row,'title'))}</strong><p>${htmlText(notificationText(row,'body'))}</p><small>${htmlText(formatNotificationTime(row.created_at))}</small></span></button>`).join('');
 box.innerHTML=`${mobileBackHeader(bi('Notifications','Értesítések'))}<div class="panel notification-center"><div class="toolbar"><h3>${bi('Notifications','Értesítések')}</h3>${pushButton}</div>${cards||`<div class="empty-notifications"><div class="empty-notifications-icon">🔔</div><h3>${bi('No notifications','Nincsenek értesítések')}</h3><p>${bi('You currently have no active notifications.','Jelenleg nincs aktív értesítésed.')}</p></div>`}</div>`;
}
function parseNotificationMetadata(row){try{return JSON.parse(row?.metadata_json||'{}')}catch(_e){return {}}}
async function openNotificationDetail(id){
 const row=currentNotifications.find(n=>String(n.id)===String(id));if(!row)return;
 const meta=parseNotificationMetadata(row);
 $('#modal').classList.remove('hidden');$('#modalTitle').textContent=notificationText(row,'title')||bi('Notification','Értesítés');
 const jobButton=row.related_job_id?`<button type="button" class="ghost-btn" onclick="openNotificationJob('${row.related_job_id}')">${bi('Open related job','Kapcsolódó munka megnyitása')}</button>`:'';
 $('#form').innerHTML=`<div class="notification-detail"><button type="button" class="notification-detail__close" onclick="closeModal()" aria-label="${bi('Close','Bezárás')}">×</button><div class="notification-detail-meta"><span>${notificationIcon(row.notification_type)}</span><small>${htmlText(formatNotificationTime(row.created_at))}</small></div><p>${htmlText(notificationText(row,'body'))}</p>${row.sender_name?`<p class="muted"><strong>${bi('Sender','Feladó')}:</strong> ${htmlText(row.sender_name)}</p>`:''}${meta.client_name?`<p class="muted"><strong>${bi('Client','Ügyfél')}:</strong> ${htmlText(meta.client_name)}</p>`:''}<div class="actions">${jobButton}<button type="button" onclick="acknowledgeNotification('${row.id}')">${bi('Acknowledged','Tudomásul vettem')}</button></div></div>`;
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
 const preferenceFields=selfProfile?`<div class="field profile-preferences"><label>${bi("Language","Nyelv")}</label><select name="profile_language"><option value="en" ${currentLang==="en"?"selected":""}>American English</option><option value="hu" ${currentLang==="hu"?"selected":""}>Magyar</option></select></div><div class="field full profile-role-info"><label>${bi("Role","Szerepkör")}</label><input value="${htmlText(row?.role||user?.role||"")}" disabled></div>`:"";
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
   delete body.profile_language;
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
    if(selfProfile&&selectedLanguage)setLanguage(selectedLanguage);
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
 en:{PERMISSION_DENIED:"You do not have permission to perform this action.",REQUIRED_FIELDS:"Please complete all required fields.",INVALID_FILE_TYPE:"The selected file is not a valid PDF, JPG, JPEG, or PNG file.",FILE_TOO_LARGE:"The selected file exceeds the 20 MB size limit.",INVALID_PASSWORD:"The password is incorrect.",BACKUP_NOT_FOUND:"The selected backup could not be found.",RESTORE_CONFIRMATION_REQUIRED:"Type RESTORE BACKUP exactly to confirm the restore.",SUPERADMIN_PERMISSIONS_FIXED:"Superadmin permissions cannot be reduced.",PWA_LOGO_REQUIREMENTS:"Use a PNG, JPG, or JPEG image at least 192×192 pixels. Non-square images are automatically centered on a square canvas for the PWA icon.",INVALID_TIME_RANGE:"The end time must be later than the start time. Past dates and times are allowed.",INVALID_TIME_STEP:"Times must use 15-minute steps (00, 15, 30, 45).",INVALID_PLANNED_DURATION:"Enter the planned duration as hours:minutes in 15-minute steps (for example 3:15).",INVALID_USER_ROLE:"Select Administrator, Manager, or Worker as the role.",INVALID_CALENDAR_COLOR:"Select a valid calendar color.",RESERVED_CALENDAR_COLOR:"This color is reserved for job statuses. Choose a different employee color.",JOB_ALREADY_CLOSED:"This job step has already been closed and cannot be closed again.",WORKFLOW_ALREADY_FINALIZED:"This workflow has already been fully closed.",PARTIAL_CLOSE_NEXT_JOB_REQUIRED:"A partial close requires the complete next job, including its responsible employee and time range."},
 hu:{PERMISSION_DENIED:"Nincs jogosultságod ehhez a művelethez.",REQUIRED_FIELDS:"Kérlek, tölts ki minden kötelező mezőt.",INVALID_FILE_TYPE:"A kiválasztott fájl nem érvényes PDF-, JPG-, JPEG- vagy PNG-fájl.",FILE_TOO_LARGE:"A kiválasztott fájl meghaladja a 20 MB-os mérethatárt.",INVALID_PASSWORD:"A megadott jelszó hibás.",BACKUP_NOT_FOUND:"A kiválasztott biztonsági mentés nem található.",RESTORE_CONFIRMATION_REQUIRED:"A visszaállításhoz pontosan ezt írd be: RESTORE BACKUP.",SUPERADMIN_PERMISSIONS_FIXED:"A szuperadmin jogosultságai nem csökkenthetők.",PWA_LOGO_REQUIREMENTS:"Legalább 192×192 képpontos PNG-, JPG- vagy JPEG-képet használj. A nem négyzetes képet a rendszer automatikusan négyzetes PWA-ikonba igazítja.",INVALID_TIME_RANGE:"A befejezés időpontjának későbbinek kell lennie a kezdésnél. Korábbi dátum és időpont megadható.",INVALID_TIME_STEP:"Az időpontokat 15 perces lépésekben add meg (00, 15, 30, 45).",INVALID_PLANNED_DURATION:"A tervezett időtartamot óra:perc formában, 15 perces lépésekben add meg (például 3:15).",INVALID_USER_ROLE:"Szerepkörként Admin, Manager vagy Worker választható.",INVALID_CALENDAR_COLOR:"Válassz érvényes naptárszínt.",RESERVED_CALENDAR_COLOR:"Ez a szín a munkaállapotok számára van lefoglalva. Válassz másik munkavállalói színt.",JOB_ALREADY_CLOSED:"Ezt a munkalépést már lezárták, ezért nem zárható le újra.",WORKFLOW_ALREADY_FINALIZED:"Ezt a teljes munkafolyamatot már véglegesen lezárták.",PARTIAL_CLOSE_NEXT_JOB_REQUIRED:"Részleges lezáráskor kötelező a következő munka, a felelős munkatárs és az időintervallum teljes megadása."}
};
Object.assign(friendlyErrors.en,{WORKFLOW_TRANSFER_REASON_REQUIRED:"A transfer reason is required when the next phase is assigned to a different person.",WORKFLOW_AUTO_ASSIGNMENT_INVALID:"The next phase could not inherit the previous responsible person. Reload the workflow and try again.",WORKFLOW_AUTO_ASSIGNMENT_CONFLICT:"The next phase was changed by another user. Reload the workflow and try again.",WORKFLOW_ASSIGNMENT_MODE_INVALID:"The selected workflow assignment mode is not valid.",WORKFLOW_STAGE_BLOCKED_BY_PREVIOUS_STAGE:"This phase cannot start until the previous active phase is completed.",WORKFLOW_RESPONSIBLE_REQUIRED_TO_START:"Select a responsible person before starting the phase.",INVALID_STAGE_DEADLINE:"Enter a valid phase deadline.",STAGE_DEADLINE_NOT_ALLOWED:"You do not have permission to change this phase deadline.",FINAL_DEADLINE_IMMUTABLE:"The final customer deadline cannot be changed here."});
Object.assign(friendlyErrors.hu,{WORKFLOW_TRANSFER_REASON_REQUIRED:"Másik személy kijelölésekor az átadás indokát is meg kell adni.",WORKFLOW_AUTO_ASSIGNMENT_INVALID:"A következő fázis nem tudta automatikusan örökölni az előző felelőst. Töltsd újra a workflow-t, majd próbáld újra.",WORKFLOW_AUTO_ASSIGNMENT_CONFLICT:"A következő fázist közben másik felhasználó módosította. Töltsd újra a workflow-t, majd próbáld újra.",WORKFLOW_ASSIGNMENT_MODE_INVALID:"A kiválasztott workflow-hozzárendelési mód érvénytelen.",WORKFLOW_STAGE_BLOCKED_BY_PREVIOUS_STAGE:"Ez a fázis addig nem indítható, amíg az előző aktív fázis le nem zárul.",WORKFLOW_RESPONSIBLE_REQUIRED_TO_START:"A fázis indítása előtt válassz felelőst.",INVALID_STAGE_DEADLINE:"Adj meg érvényes fázishatáridőt.",STAGE_DEADLINE_NOT_ALLOWED:"Nincs jogosultságod ennek a fázishatáridőnek a módosításához.",FINAL_DEADLINE_IMMUTABLE:"A végső ügyfélhatáridő itt nem módosítható."});
Object.assign(friendlyErrors.en,{ATTENDANCE_CONFLICT:"This attendance sheet changed in another employee’s session. Reload the latest state and try again.",ATTENDANCE_CLOSED:"This attendance sheet is closed. An administrator must reopen it before changes can be made.",ATTENDANCE_ALREADY_CLOSED:"This attendance sheet is already closed.",ATTENDANCE_NOT_CLOSED:"This attendance sheet is not closed.",ATTENDANCE_NOT_STARTED:"Start an attendance mode before using the attendance sheet.",ATTENDANCE_PAUSED:"Attendance input is paused. Resume the sheet before changing a guest status.",ATTENDANCE_PAPER_MODE:"This event is in paper attendance mode. An administrator must switch it back to digital mode first.",ATTENDANCE_OPERATOR_REQUIRED:"You are not allowed to operate attendance sheets.",ATTENDANCE_MODE_SWITCH_ADMIN_REQUIRED:"Only an administrator can switch the attendance mode.",ATTENDANCE_MODE_SWITCH_REQUIRES_RESET:"The digital attendance sheet already contains changes. It cannot be switched to paper mode.",INVALID_ATTENDANCE_MODE:"Select a valid attendance mode.",INVALID_ATTENDANCE_STATUS:"Select a valid attendance status.",TICKET_NOT_ACTIVE:"This ticket is not active and cannot be marked as present.",DIGITAL_ATTENDANCE_NOT_CLOSED:"The digital attendance sheet must be closed before its final PDF can be exported.",ATTENDANCE_STREAM_FAILED:"The live attendance connection failed. The sheet will retry automatically.",ATTENDANCE_STREAM_UNAVAILABLE:"The live attendance connection is unavailable."});
Object.assign(friendlyErrors.hu,{ATTENDANCE_CONFLICT:"Egy másik munkatárs közben módosította ezt a jelenlétiívet. Töltsd be a legfrissebb állapotot, majd próbáld újra.",ATTENDANCE_CLOSED:"Ez a jelenlétiív le van zárva. Módosítás előtt egy adminisztrátornak újra kell nyitnia.",ATTENDANCE_ALREADY_CLOSED:"Ez a jelenlétiív már le van zárva.",ATTENDANCE_NOT_CLOSED:"Ez a jelenlétiív nincs lezárva.",ATTENDANCE_NOT_STARTED:"A jelenlétiív használata előtt indíts el egy jelenléti módot.",ATTENDANCE_PAUSED:"A jelenlétiív rögzítése szünetel. Vendégállapot módosítása előtt folytasd a jelenlétiívet.",ATTENDANCE_PAPER_MODE:"Ez az esemény papíralapú jelenléti módban van. Előbb egy adminisztrátornak vissza kell kapcsolnia digitális módra.",ATTENDANCE_OPERATOR_REQUIRED:"Nincs jogosultságod jelenlétiívet kezelni.",ATTENDANCE_MODE_SWITCH_ADMIN_REQUIRED:"A jelenléti módot csak adminisztrátor válthatja át.",ATTENDANCE_MODE_SWITCH_REQUIRES_RESET:"A digitális jelenlétiív már tartalmaz módosításokat, ezért nem váltható papíralapú módra.",INVALID_ATTENDANCE_MODE:"Válassz érvényes jelenléti módot.",INVALID_ATTENDANCE_STATUS:"Válassz érvényes jelenléti állapotot.",TICKET_NOT_ACTIVE:"Ez a jegy nem aktív, ezért nem jelölhető megérkezettként.",DIGITAL_ATTENDANCE_NOT_CLOSED:"A végleges PDF-export előtt le kell zárni a digitális jelenlétiívet.",ATTENDANCE_STREAM_FAILED:"Az élő jelenléti kapcsolat megszakadt. A rendszer automatikusan újrapróbálkozik.",ATTENDANCE_STREAM_UNAVAILABLE:"Az élő jelenléti kapcsolat nem érhető el."});
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
  en:{INVALID_GOOGLE_CALENDAR_EMAIL:"Enter a valid Google Calendar email address.",GOOGLE_CALENDAR_EMAIL_ALREADY_USED:"This Google Calendar email is already assigned to another employee.",GOOGLE_EVENT_ASSIGNEE_REQUIRED:"Assign the imported event to an active employee before completing the review.",GOOGLE_EVENT_CLIENT_REQUIRED:"Select a client before completing the Google Calendar review.",GOOGLE_EVENT_PIANO_REQUIRED:"Select a client piano before completing the Google Calendar review.",GOOGLE_EVENT_TIME_ALIGNMENT_REQUIRED:"Adjust the imported event to a 15-minute calendar interval before completing the review.",GOOGLE_EVENT_CONFLICT_UNRESOLVED:"Resolve the schedule conflict before completing the review.",GOOGLE_SOURCE_EVENT_CANCELLED:"The Google source event was cancelled. Edit or delete the ERP job as appropriate.",GOOGLE_CALENDAR_NOT_CONFIGURED:"The Google Calendar server settings are incomplete.",GOOGLE_CALENDAR_NOT_CONNECTED:"Google Calendar is not connected."},
  hu:{INVALID_GOOGLE_CALENDAR_EMAIL:"Adj meg érvényes Google Naptár e-mail-címet.",GOOGLE_CALENDAR_EMAIL_ALREADY_USED:"Ez a Google Naptár e-mail-cím már egy másik munkatárshoz tartozik.",GOOGLE_EVENT_ASSIGNEE_REQUIRED:"Az ellenőrzés befejezése előtt rendeld az importált eseményt aktív munkatárshoz.",GOOGLE_EVENT_CLIENT_REQUIRED:"A Google Naptár-ellenőrzés befejezése előtt válassz ügyfelet.",GOOGLE_EVENT_PIANO_REQUIRED:"A Google Naptár-ellenőrzés befejezése előtt válassz ügyfélzongorát.",GOOGLE_EVENT_TIME_ALIGNMENT_REQUIRED:"A Google Naptár-ellenőrzés befejezése előtt igazítsd az eseményt 15 perces naptárintervallumra.",GOOGLE_EVENT_CONFLICT_UNRESOLVED:"Az ellenőrzés befejezése előtt oldd fel az időpontütközést.",GOOGLE_SOURCE_EVENT_CANCELLED:"A forrásként szolgáló Google-eseményt törölték. Szükség szerint módosítsd vagy töröld az ERP-munkát.",GOOGLE_CALENDAR_NOT_CONFIGURED:"A Google Naptár szerverbeállításai hiányosak.",GOOGLE_CALENDAR_NOT_CONNECTED:"A Google Naptár nincs csatlakoztatva."}
 };
 if(googleErrors[currentLang]?.[code])return googleErrors[currentLang][code];
 const eventErrors={
    en:{REQUIRED_EVENT_FIELDS:"Complete every required event field.",INVALID_EVENT_ACCESS_TYPE:"Select a valid event access type.",INVALID_EVENT_SLUG:"Use lowercase letters, numbers, and hyphens in both event URLs.",EVENT_CATEGORY_NOT_AVAILABLE:"Select an active event category.",EVENT_ARTIST_NOT_FOUND:"Select an existing artist profile.",EVENT_END_MUST_FOLLOW_START:"The event end must be later than its start.",INVALID_EVENT_CAPACITY:"Enter a whole-number capacity greater than zero.",INVALID_EVENT_PRICE:"Enter a valid non-negative ticket price.",NON_PAID_EVENT_PRICE_MUST_BE_ZERO:"Only a public paid event can have a ticket price.",CAPACITY_BELOW_OCCUPIED:"Capacity cannot be reduced below the number of issued valid tickets.",INVALID_SALES_TIME:"Enter a valid ticket-sales date and time.",INVALID_SALES_TIME_RANGE:"Ticket sales must end after they begin.",SALES_END_AFTER_EVENT_START:"Ticket sales cannot end after the event begins.",EVENT_NOT_FOUND:"The selected event could not be found.",EVENT_SOLD_OUT:"No places remain for this event.",EVENT_ALREADY_CLOSED:"This event has already been closed and cannot be closed again.",EVENT_ALREADY_PUBLISHED:"This event has already been published.",EVENT_NOT_PUBLISHED:"This event is not currently published.",EVENT_UNPUBLISH_HAS_DEPENDENCIES:"This event has bookings or related records and cannot be unpublished.",EVENT_SLUG_ALREADY_USED:"One of the event URLs is already in use.",BILINGUAL_EVENT_CONTENT_REQUIRED:"Add both American English and Hungarian short and long descriptions before publishing.",PAID_EVENT_PRICE_REQUIRED:"A paid event must have a ticket price greater than zero.",ONLY_PUBLISHED_EVENT_CAN_BE_RESCHEDULED:"Only a published event can be rescheduled.",EVENT_HAS_NOT_ENDED:"The event cannot be closed before its scheduled end.",EVENT_RETENTION_REQUIRED:"This event must be retained because it is published, closed, or has related records.",VALID_GUEST_REQUIRED:"Enter the guest’s name and a valid email address.",INVITATION_ALREADY_EXISTS:"This guest already has an invitation to the event.",INVITATION_NOT_FOUND:"The invitation could not be found.",INVITATION_ALREADY_ANSWERED:"This invitation has already been answered.",EVENT_NOT_AVAILABLE:"The event is cancelled, closed, or otherwise no longer available.",TICKET_NOT_FOUND:"The ticket could not be found.",REQUIRED_REFUND_FIELDS:"Enter the ticket ID, matching email address, and refund reason.",TICKET_NOT_REFUNDABLE:"This ticket cannot receive a refund request.",REFUND_ALREADY_REQUESTED:"A refund request already exists for this ticket.",REFUND_NOT_ELIGIBLE:"This request is outside the approved refund rules.",REFUND_REQUEST_NOT_FOUND:"The refund request could not be found.",INVALID_REFUND_STATUS:"Select a valid refund decision."},
    hu:{REQUIRED_EVENT_FIELDS:"Tölts ki minden kötelező eseménymezőt.",INVALID_EVENT_ACCESS_TYPE:"Válassz érvényes esemény-hozzáférési módot.",INVALID_EVENT_SLUG:"Mindkét esemény-URL-ben kisbetűket, számokat és kötőjeleket használj.",EVENT_CATEGORY_NOT_AVAILABLE:"Válassz aktív eseménykategóriát.",EVENT_ARTIST_NOT_FOUND:"Válassz létező művészprofilt.",EVENT_END_MUST_FOLLOW_START:"Az esemény befejezésének későbbinek kell lennie a kezdésnél.",INVALID_EVENT_CAPACITY:"Nullánál nagyobb egész számként add meg a férőhelyet.",INVALID_EVENT_PRICE:"Adj meg érvényes, nem negatív jegyárat.",NON_PAID_EVENT_PRICE_MUST_BE_ZERO:"Csak nyilvános fizetős eseménynek lehet jegyára.",CAPACITY_BELOW_OCCUPIED:"A férőhely nem csökkenthető a már kiadott érvényes jegyek száma alá.",INVALID_SALES_TIME:"Adj meg érvényes jegyértékesítési dátumot és időpontot.",INVALID_SALES_TIME_RANGE:"A jegyértékesítés végének későbbinek kell lennie a kezdeténél.",SALES_END_AFTER_EVENT_START:"A jegyértékesítés nem zárulhat az esemény kezdése után.",EVENT_NOT_FOUND:"A kiválasztott esemény nem található.",EVENT_SOLD_OUT:"Erre az eseményre már nincs szabad hely.",EVENT_ALREADY_CLOSED:"Ezt az eseményt már lezárták, ezért nem zárható le újra.",EVENT_ALREADY_PUBLISHED:"Ezt az eseményt már publikálták.",EVENT_NOT_PUBLISHED:"Ezt az eseményt jelenleg nem publikálták.",EVENT_UNPUBLISH_HAS_DEPENDENCIES:"Az eseményhez kapcsolódó foglalások vagy rekordok miatt a publikálás nem vonható vissza.",EVENT_SLUG_ALREADY_USED:"Az egyik esemény-URL már használatban van.",BILINGUAL_EVENT_CONTENT_REQUIRED:"Publikálás előtt add meg az amerikai angol és magyar rövid és hosszú leírást is.",PAID_EVENT_PRICE_REQUIRED:"A fizetős esemény jegyárának nullánál nagyobbnak kell lennie.",ONLY_PUBLISHED_EVENT_CAN_BE_RESCHEDULED:"Csak publikált esemény helyezhető át másik időpontra.",EVENT_HAS_NOT_ENDED:"Az esemény a tervezett befejezése előtt nem zárható le.",EVENT_RETENTION_REQUIRED:"Az eseményt meg kell őrizni, mert publikált, lezárt vagy kapcsolódó rekordjai vannak.",VALID_GUEST_REQUIRED:"Add meg a vendég nevét és érvényes e-mail-címét.",INVITATION_ALREADY_EXISTS:"Ennek a vendégnek már van meghívása az eseményre.",INVITATION_NOT_FOUND:"A meghívás nem található.",INVITATION_ALREADY_ANSWERED:"Erre a meghívásra már érkezett válasz.",EVENT_NOT_AVAILABLE:"Az eseményt lemondták, lezárták vagy más okból már nem érhető el.",TICKET_NOT_FOUND:"A jegy nem található.",REQUIRED_REFUND_FIELDS:"Add meg a jegyazonosítót, a hozzá tartozó e-mail-címet és a visszatérítés okát.",TICKET_NOT_REFUNDABLE:"Ehhez a jegyhez nem kérhető visszatérítés.",REFUND_ALREADY_REQUESTED:"Ehhez a jegyhez már tartozik visszatérítési igény.",REFUND_NOT_ELIGIBLE:"Az igény nem felel meg az elfogadott visszatérítési szabályoknak.",REFUND_REQUEST_NOT_FOUND:"A visszatérítési igény nem található.",INVALID_REFUND_STATUS:"Válassz érvényes visszatérítési döntést."}
 };
 Object.assign(eventErrors.en,{EVENT_HAS_NOT_ENDED:"The event may be closed by an administrator before its scheduled end.",CONTACT_NOT_FOUND:"The selected customer could not be found.",GUEST_NAME_REQUIRED:"Enter a guest name or select an existing customer.",INVALID_REFUND_REASON:"Select one of the allowed refund reasons.",ONLY_ON_SITE_TICKETS_CAN_BE_PAID_HERE:"Only an on-site reservation can be paid through this action.",ON_SITE_PRICE_REQUIRED:"The on-site ticket must have a positive price.",ON_SITE_RESERVATION_EXPIRED:"The on-site reservation payment deadline has passed.",TICKET_INVOICE_REQUIRES_PAID_PRICE:"An invoice is available only for a paid ticket with a positive price."});
 Object.assign(eventErrors.hu,{EVENT_HAS_NOT_ENDED:"Az eseményt az adminisztrátor a tervezett befejezés előtt is lezárhatja.",CONTACT_NOT_FOUND:"A kiválasztott ügyfél nem található.",GUEST_NAME_REQUIRED:"Adj meg vendégnevet, vagy válassz meglévő ügyfelet.",INVALID_REFUND_REASON:"Válassz az engedélyezett visszatérítési okok közül.",ONLY_ON_SITE_TICKETS_CAN_BE_PAID_HERE:"Ezzel a művelettel csak helyszíni foglalás fizethető ki.",ON_SITE_PRICE_REQUIRED:"A helyszíni jegynek pozitív árral kell rendelkeznie.",ON_SITE_RESERVATION_EXPIRED:"A helyszíni foglalás fizetési határideje lejárt.",TICKET_INVOICE_REQUIRES_PAID_PRICE:"Számla csak pozitív árú, kifizetett jegyhez készíthető."});
 const eventUploadErrors={
  en:{EVENT_IMAGE_REQUIRED:"Upload an event image before saving or publishing.",INVALID_EVENT_IMAGE_TYPE:"Use a JPG or PNG event image.",INVALID_EVENT_IMAGE:"The selected file is not a valid event image.",EVENT_IMAGE_TOO_SMALL:"The event image must be at least 1600×900 pixels."},
  hu:{EVENT_IMAGE_REQUIRED:"Mentés vagy publikálás előtt tölts fel eseményképet.",INVALID_EVENT_IMAGE_TYPE:"JPG vagy PNG formátumú eseményképet használj.",INVALID_EVENT_IMAGE:"A kiválasztott fájl nem érvényes eseménykép.",EVENT_IMAGE_TOO_SMALL:"Az eseménykép mérete legalább 1600×900 pixel legyen."}
 };
 const eventCommerceErrors={
  en:{EVENT_CANCEL_REQUIRED:"This event already has invitations, bookings, tickets, payments, or other retained records. Cancel the event instead; its financial history cannot be deleted.",EVENT_CANCELLATION_REASON_REQUIRED:"Enter the organizer’s cancellation notice.",EVENT_DELETION_REASON_REQUIRED:"Enter a deletion reason before removing the event.",STRIPE_SANDBOX_NOT_CONFIGURED:"Stripe Sandbox is not configured on the ERP service.",EVENT_NOT_AVAILABLE_FOR_CHECKOUT:"This event is not available for ticket checkout.",INVALID_TICKET_QUANTITY:"Enter a valid whole number of tickets.",STRIPE_PAYMENT_NOT_FOUND:"No Stripe Sandbox payment is linked to this ticket.",STRIPE_REFUND_FAILED:"The Stripe Sandbox refund could not be completed.",INVALID_STRIPE_WEBHOOK:"Stripe rejected the webhook signature."},
  hu:{EVENT_CANCEL_REQUIRED:"Az eseményhez már meghívás, foglalás, jegy, fizetés vagy más megőrzendő rekord tartozik. Az eseményt le kell mondani; pénzügyi előzménye nem törölhető.",EVENT_CANCELLATION_REASON_REQUIRED:"Add meg a szervező lemondási tájékoztatását.",EVENT_DELETION_REASON_REQUIRED:"A törlés előtt add meg a törlési indokot.",STRIPE_SANDBOX_NOT_CONFIGURED:"A Stripe Sandbox nincs beállítva az ERP-szolgáltatásban.",EVENT_NOT_AVAILABLE_FOR_CHECKOUT:"Ehhez az eseményhez jelenleg nem indítható jegyvásárlás.",INVALID_TICKET_QUANTITY:"Érvényes egész jegydarabszámot adj meg.",STRIPE_PAYMENT_NOT_FOUND:"A jegyhez nem tartozik Stripe Sandbox-fizetés.",STRIPE_REFUND_FAILED:"A Stripe Sandbox-visszatérítés nem hajtható végre.",INVALID_STRIPE_WEBHOOK:"A Stripe elutasította a webhook aláírását."}
 };
 if(eventCommerceErrors[currentLang]?.[code])return eventCommerceErrors[currentLang][code];
 if(eventUploadErrors[currentLang]?.[code])return eventUploadErrors[currentLang][code];
 if(eventErrors[currentLang]?.[code])return eventErrors[currentLang][code];
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
 const labels={'scheduler.view':bi('View scheduler','Naptár megtekintése'),'planned_jobs.view':bi('View planned jobs','Tervezett munkák megtekintése'),'contacts.view':bi('View clients','Ügyfelek megtekintése'),'pianos.view':bi('View pianos','Zongorák megtekintése'),'closed_jobs.view':bi('View closed jobs','Lezárt munkák megtekintése'),'knowledge_base.view':bi('View company documents archive','Céges dokumentumtár megtekintése'),'finance.view':bi('View balance sheet','Mérleg megtekintése'),'income_statement.view':bi('View income statement','Eredménykimutatás megtekintése'),'inventory.view':bi('View inventory','Leltár megtekintése'),'users.view':bi('View users','Felhasználók megtekintése'),'users.create':bi('Add employees','Munkavállaló hozzáadása'),'users.roles':bi('Assign or remove roles','Szerepkör adása vagy elvétele'),'permissions.manage':bi('Manage role permissions','Szerepkör-jogosultságok kezelése'),'audit.view':bi('View audit log','Módosítási napló megtekintése')};
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

let eventAdminRows=[];
let eventAdminCategories=[];
let eventAdminArtists=[];
let eventAdminSelectedId=null;
let eventInterestRows=[];
let individualTicketContacts=[];

function eventAccessLabel(value){return ({PUBLIC_PAID:bi('Public · paid','Nyilvános · fizetős'),PUBLIC_FREE:bi('Public · free','Nyilvános · ingyenes'),INVITE_ONLY:bi('Invitation only','Meghívásos'),INTERNAL:bi('Internal','Belső')})[value]||value;}
function eventStatusLabel(value){return ({DRAFT:bi('Not published','Nincs publikálva'),PUBLISHED:bi('Published','Publikálva'),RESCHEDULED:bi('Rescheduled','Áthelyezve'),CANCELLED:bi('Cancelled by organizer','Szervező által lemondva'),COMPLETED:bi('Completed','Befejeződött'),CLOSED:bi('Closed','Lezárva')})[value]||value;}
function eventDateLabel(value){if(!value)return '—';return new Intl.DateTimeFormat(currentLang==='hu'?'hu-HU':'en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
function eventCapacityLabel(row){const capacity=row.capacity||{};return `${Number(capacity.occupied||0)} / ${Number(capacity.total||row.capacity_total||0)}`;}
function eventPriceLabel(row){return row.access_type==='PUBLIC_PAID'?`$${(Number(row.price_cents||0)/100).toFixed(2)}`:bi('No charge','Díjmentes');}
function eventDescriptionPreview(row,max=190){const text=String(currentLang==='hu'?(row.description_hu||row.short_description_hu||''):(row.description_en||row.short_description_en||'')).replace(/\s+/g,' ').trim();return text.length>max?`${text.slice(0,max).replace(/\s+\S*$/,'').trim()}…`:text;}
function eventImagePreviewUrl(value){const url=adminAssetUrl(value);return url?`${url}${url.includes('?')?'&':'?'}v=${Date.now()}`:'';}
function eventLocalInput(value){if(!value)return '';const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'}).formatToParts(new Date(value)).reduce((out,part)=>({...out,[part.type]:part.value}),{});return `${parts.year}-${parts.month}-${parts.day}T${parts.hour==='24'?'00':parts.hour}:${parts.minute}`;}
function eventCategoryOptions(selected=''){return eventAdminCategories.filter(item=>Number(item.active)||item.id===selected).map(item=>`<option value="${htmlText(item.id)}" ${item.id===selected?'selected':''}>${htmlText(currentLang==='hu'?item.name_hu:item.name_en)}</option>`).join('');}
function eventArtistOptions(selected=''){return `<option value="">${bi('Unlisted or no linked artist','Nem listázott vagy nincs kapcsolt művész')}</option>`+eventAdminArtists.map(item=>`<option value="${htmlText(item.id)}" data-name="${htmlText(item.name)}" ${item.id===selected?'selected':''}>${htmlText(item.name)}</option>`).join('');}

async function renderEvents(){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 [eventAdminRows,eventAdminCategories,eventInterestRows,eventAdminArtists]=await Promise.all([api('/api/events'),api('/api/event-categories'),api('/api/event-repeat-interest'),api('/api/website-artists')]);
 const box=$('#events');
 box.innerHTML=`${mobileBackHeader(bi('Events','Események'))}<div class="panel event-admin-shell"><div class="toolbar event-toolbar"><div><p class="event-kicker">${bi('Website & events · protected workspace','Weboldal és események · védett munkaterület')}</p><h2>${bi('Events','Események')}</h2><p class="muted">${bi('Public, invitation-only and internal cultural programmes. Paid tickets use Stripe Sandbox test mode only.','Nyilvános, meghívásos és belső kulturális programok. A fizetős jegyek kizárólag Stripe Sandbox tesztüzemben működnek.')}</p></div><button type="button" onclick="openEventEditor()">＋ ${bi('New event','Új esemény')}</button></div>
 <div class="event-admin-grid">${eventAdminRows.length?eventAdminRows.map(row=>{const interest=eventInterestRows.find(item=>item.event_id===row.id);return `<article class="event-admin-card">${row.hero_image_url?`<img class="event-admin-card__image" src="${htmlText(eventImagePreviewUrl(row.hero_image_url))}" alt="">`:''}<div class="event-card-top"><span class="event-status event-status--${String(row.status||'').toLowerCase()}">${htmlText(eventStatusLabel(row.status))}</span><span>${htmlText(row.event_key)}</span></div><h3>${htmlText(currentLang==='hu'?row.title_hu:row.title_en)}</h3>${row.custom_type?`<p class="event-card-type">${htmlText(row.custom_type)}</p>`:''}<p class="event-card-date">${htmlText(eventDateLabel(row.start_at))}</p>${eventDescriptionPreview(row)?`<p>${htmlText(eventDescriptionPreview(row))}</p>`:''}<dl><div><dt>${bi('Access','Hozzáférés')}</dt><dd>${htmlText(eventAccessLabel(row.access_type))}</dd></div><div><dt>${bi('Capacity','Férőhely')}</dt><dd>${eventCapacityLabel(row)}</dd></div><div><dt>${bi('Price','Ár')}</dt><dd>${eventPriceLabel(row)}</dd></div>${interest?`<div><dt>${bi('Return requests','Újraigénylések')}</dt><dd>${Number(interest.request_count||0)}</dd></div>${interest.hours_to_sell_out!==null?`<div><dt>${bi('Time to sell out','Teltházig eltelt idő')}</dt><dd>${Number(interest.hours_to_sell_out).toFixed(2)} h</dd></div>`:''}`:''}</dl><div class="actions"><button type="button" class="small" onclick="openEventDetails('${htmlText(row.id)}')">${bi('Manage','Kezelés')}</button><button type="button" class="small ghost-btn" onclick="openEventEditor('${htmlText(row.id)}')">${bi('Edit','Szerkesztés')}</button>${interest?`<button type="button" class="small ghost-btn" onclick="downloadEventInterest('${htmlText(row.id)}')">CSV</button><button type="button" class="small" onclick="relaunchEvent('${htmlText(row.id)}')">${bi('Create new date','Új időpont létrehozása')}</button>`:''}</div></article>`}).join(''):`<div class="empty-state"><h3>${bi('No events yet','Még nincs esemény')}</h3><p>${bi('Create the first bilingual Klavierhaus cultural event.','Hozd létre az első kétnyelvű Klavierhaus kulturális eseményt.')}</p></div>`}</div></div>`;
}

function openEventEditor(id=null){
 const row=id?eventAdminRows.find(item=>item.id===id):null;
 const tomorrow=addDaysToDateKey(nyDateKey(),1);
 const start=row?.start_local||`${tomorrow}T19:00`,end=row?.end_local||`${tomorrow}T21:00`;
 $('#modal').classList.remove('hidden');$('#modalTitle').textContent=row?bi('Edit event','Esemény szerkesztése'):bi('New event','Új esemény');
 const hasImage=Boolean(row?.hero_image_url);
 $('#form').innerHTML=`<div class="event-form-intro"><strong>${bi('Titles are bilingual. Event descriptions are optional, and public URLs are generated automatically.','A címek kétnyelvűek. Az eseményleírások opcionálisak, a nyilvános URL-eket pedig a rendszer automatikusan készíti el.')}</strong><span>${bi('All times use America/New_York.','Minden időpont az America/New_York időzónát használja.')}</span></div><div class="form-grid event-form-grid">
 <div class="field"><label>${bi('Category','Kategória')} *</label><select name="category_id" required>${eventCategoryOptions(row?.category_id||eventAdminCategories[0]?.id||'')}</select></div>
 <div class="field"><label>${bi('Custom event type / style (optional)','Egyéni eseménytípus / stílus (opcionális)')}</label><input name="custom_type" value="${htmlText(row?.custom_type||'')}" maxlength="160" placeholder="${bi('For example: Chamber recital','Például: kamarazenei est')}"><small>${bi('If provided, this label is shown on admin, public event pages and event documents.','Ha megadod, ez a megnevezés jelenik meg az adminban, a nyilvános eseményoldalon és az eseménydokumentumokon.')}</small></div>
 <div class="field"><label>${bi('Access','Hozzáférés')} *</label><select name="access_type" required onchange="syncEventPerformerRequirement(this.form)">${['PUBLIC_PAID','PUBLIC_FREE','INVITE_ONLY','INTERNAL'].map(value=>`<option value="${value}" ${row?.access_type===value?'selected':''}>${htmlText(eventAccessLabel(value))}</option>`).join('')}</select></div>
 <div class="field"><label>Title · English *</label><input name="title_en" value="${htmlText(row?.title_en||'')}" required></div>
 <div class="field"><label>Cím · Magyar *</label><input name="title_hu" value="${htmlText(row?.title_hu||'')}" required></div>
 <div class="field full"><label>Event description · English <span class="muted">(${bi('optional','opcionális')})</span></label><textarea name="description_en" rows="7">${htmlText(row?.description_en||row?.short_description_en||'')}</textarea></div>
 <div class="field full"><label>Eseményleírás · Magyar <span class="muted">(${bi('optional','opcionális')})</span></label><textarea name="description_hu" rows="7">${htmlText(row?.description_hu||row?.short_description_hu||'')}</textarea></div>

 <div class="field"><label>${bi('Linked artist profile','Kapcsolt művészprofil')}</label><select name="artist_id" onchange="syncEventArtist(this.form)">${eventArtistOptions(row?.artist_id||'')}</select><small>${bi('The stable artist ID keeps the event connected when the artist is renamed.','A stabil művészazonosító névváltoztatáskor is megtartja a kapcsolatot.')}</small></div>
 <div class="field"><label>${bi('Performer / artist','Fellépő / művész')} <span data-performer-required>*</span></label><input name="performer_name" value="${htmlText(row?.performer_name||'')}"><small>${bi('Choose a profile above or enter an unlisted performer.','Válassz profilt fent, vagy adj meg nem listázott fellépőt.')}</small></div>
	 <div class="field full event-image-field"><label>${bi('Event image','Eseménykép')} *</label>${hasImage?`<img id="eventImagePreview" class="event-image-preview" src="${htmlText(eventImagePreviewUrl(row.hero_image_url))}" alt="${bi('Current event image','Jelenlegi eseménykép')}">`:`<div id="eventImagePlaceholder" class="event-image-placeholder">${bi('Select an elegant event or artist photograph.','Válassz elegáns esemény- vagy művészfotót.')}</div>`}<input id="eventImageInput" name="event_image" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" ${hasImage?'':'required'} onchange="previewEventImage(this)"><small>${bi('Required. JPG or PNG, at least 1600×900 px; the uploaded copy is optimized to a 16:9 image.','Kötelező. JPG vagy PNG, legalább 1600×900 px; a feltöltött példányt a rendszer 16:9 arányú képpé optimalizálja.')}</small></div>
	 <div class="field"><label>Image alternative text · English</label><input name="hero_image_alt_en" value="${htmlText(row?.hero_image_alt_en||row?.title_en||'')}"></div>
	 <div class="field"><label>Kép alternatív szövege · Magyar</label><input name="hero_image_alt_hu" value="${htmlText(row?.hero_image_alt_hu||row?.title_hu||'')}"></div>
 <div class="field"><label>${bi('Start','Kezdés')} *</label><input name="start_local" type="datetime-local" step="300" value="${htmlText(start)}" required></div>
 <div class="field"><label>${bi('End','Befejezés')} *</label><input name="end_local" type="datetime-local" step="300" value="${htmlText(end)}" required></div>
 <div class="field"><label>${bi('Total capacity','Teljes férőhely')} *</label><input name="capacity_total" type="number" min="1" step="1" value="${Number(row?.capacity_total||40)}" required></div>
 <div class="field"><label>${bi('Special ticket capacity','Speciális jegyek férőhelye')}</label><input name="special_capacity_total" type="number" min="0" step="1" value="${Number(row?.special_capacity_total||0)}"><small>${bi('VIP, invitation, complimentary and manual tickets use this pool when it is limited.','A VIP-, meghívásos-, tisztelet- és manuális jegyek ezt a keretet használják, ha korlátozott.')}</small></div>
 <div class="field"><label>${bi('Special ticket limit','Speciális jegykorlát')}</label><select name="special_capacity_unlimited"><option value="1" ${Number(row?.special_capacity_unlimited??1)===1?'selected':''}>${bi('Unlimited','Korlátlan')}</option><option value="0" ${Number(row?.special_capacity_unlimited??1)===0?'selected':''}>${bi('Use special capacity','Speciális férőhely használata')}</option></select></div>
 <div class="field"><label>${bi('Ticket price · USD','Jegyár · USD')}</label><input name="price_dollars" type="number" min="0" step="0.01" value="${(Number(row?.price_cents||0)/100).toFixed(2)}"></div>
 <div class="field"><label>${bi('Sales open · New York time','Értékesítés kezdete · New York-i idő')}</label><input name="sales_start_at" type="datetime-local" step="300" value="${htmlText(eventLocalInput(row?.sales_start_at))}"><small>${bi('Optional. Empty means sales can start immediately after publishing.','Opcionális. Üresen hagyva a publikálástól értékesíthető.')}</small></div>
 <div class="field"><label>${bi('Sales close · New York time','Értékesítés vége · New York-i idő')}</label><input name="sales_end_at" type="datetime-local" step="300" value="${htmlText(eventLocalInput(row?.sales_end_at))}"><small>${bi('Must be before the event starts.','Az esemény kezdete előtt kell lennie.')}</small></div>
 <div class="field"><label>${bi('Venue name','Helyszín neve')} *</label><input name="venue_name" value="${htmlText(row?.venue_name||'Klavierhaus')}" required></div>
 <div class="field"><label>${bi('Street address','Utca, házszám')} *</label><input name="venue_street" value="${htmlText(row?.venue_street||'790 11th Avenue')}" required></div>
 <div class="field"><label>${bi('City','Város')} *</label><input name="venue_city" value="${htmlText(row?.venue_city||'New York')}" required></div>
 <div class="field"><label>${bi('State','Állam')} *</label><input name="venue_region" value="${htmlText(row?.venue_region||'NY')}" required></div>
 <div class="field"><label>${bi('Postal code','Irányítószám')} *</label><input name="venue_postal_code" value="${htmlText(row?.venue_postal_code||'10019')}" required></div>
 <div class="field"><label>${bi('Country','Ország')} *</label><input name="venue_country" value="${htmlText(row?.venue_country||'US')}" maxlength="2" required></div>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button>${row?.status==='DRAFT'||!row?`<button type="submit" class="ghost-btn" value="draft">${bi('Save without publishing','Mentés közzététel nélkül')}</button><button type="submit" value="publish">${bi('Save and publish','Mentés és publikálás')}</button>`:`<button type="submit" value="save">${bi('Save changes','Módosítások mentése')}</button>`}</div>`;
 $('#form').onsubmit=event=>saveEventEditor(event,row?.id||null);syncEventPerformerRequirement($('#form'));applyLanguageToDOM(document.getElementById('modal'));enhanceCustomSelects(document.getElementById('modal'));
}
function syncEventPerformerRequirement(form){const access=form?.querySelector('[name="access_type"]')?.value||'',input=form?.querySelector('[name="performer_name"]'),required=access.startsWith('PUBLIC_');if(input)input.required=required;form?.querySelector('[data-performer-required]')?.classList.toggle('hidden',!required);}
function syncEventArtist(form){const select=form?.querySelector('[name="artist_id"]'),input=form?.querySelector('[name="performer_name"]'),name=select?.selectedOptions?.[0]?.dataset?.name||'';if(name&&input)input.value=name;syncEventPerformerRequirement(form);}

async function prepareEventImageFile(file){
 if(!file)return null;
 if(!/^image\//i.test(String(file.type||''))&&!/\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp)$/i.test(file.name||''))throw new Error('INVALID_EVENT_IMAGE_TYPE');
 let image;
 try{image=await readImageFile(file);}catch(_error){return file;}
 if(image.naturalWidth<1600||image.naturalHeight<900)throw new Error('EVENT_IMAGE_TOO_SMALL');
 const targetWidth=1920,targetHeight=1080,sourceRatio=image.naturalWidth/image.naturalHeight,targetRatio=16/9;
 let sourceWidth=image.naturalWidth,sourceHeight=image.naturalHeight,sourceX=0,sourceY=0;
 if(sourceRatio>targetRatio){sourceWidth=Math.round(sourceHeight*targetRatio);sourceX=Math.round((image.naturalWidth-sourceWidth)/2);}else if(sourceRatio<targetRatio){sourceHeight=Math.round(sourceWidth/targetRatio);sourceY=Math.round((image.naturalHeight-sourceHeight)/2);}
 const canvas=document.createElement('canvas');canvas.width=targetWidth;canvas.height=targetHeight;
 canvas.getContext('2d').drawImage(image,sourceX,sourceY,sourceWidth,sourceHeight,0,0,targetWidth,targetHeight);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.88));if(!blob)throw new Error('INVALID_EVENT_IMAGE');
 return new File([blob],`klavierhaus-event-${Date.now()}.jpg`,{type:'image/jpeg'});
}
async function previewEventImage(input){
 try{
  const file=input?.files?.[0];if(!file)return;
  const prepared=await prepareEventImageFile(file),url=URL.createObjectURL(prepared);
  let preview=$('#eventImagePreview');if(!preview){preview=document.createElement('img');preview.id='eventImagePreview';preview.className='event-image-preview';preview.alt=bi('Event image preview','Eseménykép előnézete');input.parentElement.insertBefore(preview,input);$('#eventImagePlaceholder')?.remove();}
  if(preview.dataset.previewUrl)URL.revokeObjectURL(preview.dataset.previewUrl);preview.dataset.previewUrl=url;preview.src=url;
 }catch(error){input.value='';showError(error);}
}

async function saveEventEditor(event,id){
 event.preventDefault();
 const submitAction=event.submitter?.value||'save',formData=new FormData(event.target),rawImage=formData.get('event_image');
 try{
	  if(rawImage instanceof File&&rawImage.size){const prepared=await prepareEventImageFile(rawImage);formData.set('event_image',prepared,prepared.name);}else formData.delete('event_image');
	  formData.set('capacity_total',String(Number(formData.get('capacity_total'))));formData.set('special_capacity_total',String(Number(formData.get('special_capacity_total')||0)));formData.set('special_capacity_unlimited',String(formData.get('special_capacity_unlimited')||'1'));formData.set('price_cents',String(Math.round(Number(formData.get('price_dollars')||0)*100)));formData.delete('price_dollars');
	  formData.set('publish_now',submitAction==='publish'?'1':'0');
	  await api(id?`/api/events/${encodeURIComponent(id)}`:'/api/events',{method:id?'PUT':'POST',body:formData});
  closeModal();showToast(submitAction==='publish'?bi('Event saved and published.','Az esemény elmentve és publikálva.'):bi('Event saved.','Esemény elmentve.'),'success');await renderEvents();
 }catch(error){showError(error)}
}

function invitationRowsHtml(rows){return rows.length?rows.map(row=>`<tr><td>${htmlText(row.guest_name)}</td><td>${htmlText(row.guest_email)}</td><td>${htmlText(row.status)}</td><td>${htmlText(row.delivery_status||'')}</td><td>${row.status==='PENDING'?`<button type="button" class="small danger-btn" onclick="revokeEventInvitation('${htmlText(row.id)}')">${bi('Revoke','Visszavonás')}</button>`:''}</td></tr>`).join(''):`<tr><td colspan="5">${bi('No invitations.','Nincs meghívás.')}</td></tr>`;}
 function ticketRowsHtml(rows){return rows.length?rows.map(row=>{const onSite=row.ticket_variant==='ON_SITE',pendingPaid=['ON_SITE','PUBLIC_PAID'].includes(row.ticket_variant)&&Number(row.price_cents||0)>0&&row.payment_status!=='PAID'&&!['VOID','REFUNDED'].includes(row.status);return `<tr><td>${htmlText(row.attendee_name)}</td><td>${htmlText(row.ticket_variant||row.source_type)}</td><td>${htmlText(row.status)}${Number(row.price_cents||0)>0?` · ${htmlText(row.payment_status||'')} · ${htmlText(row.payment_method||'')}`:''}</td><td>${htmlText(row.public_code)}</td><td><button type="button" class="small ghost-btn" onclick="editEventGuestName('${htmlText(row.id)}','${htmlText(row.attendee_name)}')">${bi('Edit name','Név javítása')}</button> <button type="button" class="small" onclick="downloadEventTicketDocument('${htmlText(row.id)}','front')">${bi('Front PDF','Előlap PDF')}</button> <button type="button" class="small" onclick="downloadEventTicketDocument('${htmlText(row.id)}','back')">${bi('Back PDF','Hátlap PDF')}</button> <button type="button" class="small" onclick="downloadEventTicketDocument('${htmlText(row.id)}','full')">${bi('Full PDF','Teljes PDF')}</button> <button type="button" class="small ghost-btn" onclick="emailEventTicketFront('${htmlText(row.id)}')">${bi('Email front','Előlap e-mailben')}</button>${row.payment_status==='PAID'&&Number(row.price_cents||0)>0?` <button type="button" class="small ghost-btn" onclick="downloadEventTicketInvoice('${htmlText(row.id)}')">${bi('Invoice','Számla')}</button>`:''}${pendingPaid?` <button type="button" class="small" onclick="markEventTicketPaid('${htmlText(row.id)}')">${bi('Mark paid','Fizetve')}</button>`:''}${!['VOID','REFUNDED'].includes(row.status)&&(row.source_type!=='PURCHASE'||onSite)?` <button type="button" class="small danger-btn" onclick="voidEventTicket('${htmlText(row.id)}')">${bi('Void','Érvénytelenít')}</button>`:''}</td></tr>`}).join(''):`<tr><td colspan="5">${bi('No tickets.','Nincs jegy.')}</td></tr>`;}
 function refundRowsHtml(rows){return rows.length?rows.map(row=>`<tr><td>${htmlText(row.requester_email)}</td><td>${htmlText(row.eligibility_code)}</td><td>${htmlText(row.status)}</td><td>${row.status==='REQUESTED'?`<button type="button" class="small" onclick="resolveEventRefund('${htmlText(row.id)}','APPROVED')">${bi('Approve','Jóváhagyás')}</button> <button type="button" class="small danger-btn" onclick="resolveEventRefund('${htmlText(row.id)}','REJECTED')">${bi('Reject','Elutasítás')}</button> <button type="button" class="small danger-btn" onclick="markEventRefundNoShow('${htmlText(row.id)}')">${bi('No-show','Nem jelent meg')}</button>`:''}</td></tr>`).join(''):`<tr><td colspan="4">${bi('No refund requests.','Nincs visszatérítési igény.')}</td></tr>`;}
function paymentRowsHtml(rows){return rows.length?rows.map(row=>`<tr><td>${htmlText(row.purchaser_name||'')}</td><td>${htmlText(row.purchaser_email||'')}</td><td>${Number(row.quantity||0)}</td><td>${(Number(row.amount_total||0)/100).toFixed(2)} ${htmlText(row.currency||'USD')}</td><td>${htmlText(row.status)}</td><td>${row.test_mode?bi('TEST MODE','TESZTÜZEM'):bi('Live','Éles')}</td><td><button type="button" class="small ghost-btn" onclick="downloadPaymentInvoice('${htmlText(row.id)}')">${bi('Invoice PDF','Számla PDF')}</button> <button type="button" class="small" onclick="resendInvoiceDocument('${htmlText(row.id)}')">${bi('Resend invoice','Számla újraküldése')}</button></td></tr>`).join(''):`<tr><td colspan="7">${bi('No Stripe Sandbox payments.','Nincs Stripe Sandbox-fizetés.')}</td></tr>`;}

async function downloadPaymentInvoice(paymentId){
 try{
  const response=await fetch(`/api/event-payments/${encodeURIComponent(paymentId)}/invoice.pdf`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'INVOICE_PDF_FAILED');
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`klavierhaus-invoice-${paymentId}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){showError(error)}
}
async function resendInvoiceDocument(paymentId){
 try{
  const result=await api(`/api/event-payments/${encodeURIComponent(paymentId)}/invoice/resend`,{method:'POST',body:'{}'});
  showToast(result.delivery?.status==='SENT'?bi('Invoice sent by email.','A számla e-mailben elküldve.'):bi('Invoice delivery is not configured.','A számla-kézbesítés nincs beállítva.'),result.delivery?.status==='SENT'?'success':'warning');
 }catch(error){showError(error)}
}
async function downloadCustomerConversationReport(id){
 try{
  const response=await fetch(`/api/customer-conversations/${encodeURIComponent(id)}/report`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'HELPDESK_REPORT_FAILED');
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`klavierhaus-helpdesk-${id}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){showError(error)}
}

async function downloadEventTicketDocument(ticketId, mode='full'){
 try{
  const normalized=['front','back','full'].includes(String(mode).toLowerCase())?String(mode).toLowerCase():'full';
  const response=await fetch(`/api/events/tickets/${encodeURIComponent(ticketId)}/${normalized}.pdf`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'TICKET_PDF_FAILED');
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`klavierhaus-ticket-${ticketId}-${normalized}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){showError(error)}
}
async function emailEventTicketFront(ticketId){
 try{
  const result=await api(`/api/events/tickets/${encodeURIComponent(ticketId)}/documents`,{method:'POST',body:JSON.stringify({mode:'front',email_front:true})});
  showToast(result.email?.status==='SENT'?bi('Ticket front sent by email.','A jegy előlapja e-mailben elküldve.'):bi('Ticket saved. Email delivery is not configured.','A jegy mentve. Az e-mail-kézbesítés nincs beállítva.'),result.email?.status==='SENT'?'success':'warning');
 }catch(error){showError(error)}
}
async function downloadEventTicketInvoice(ticketId){
 try{
  const response=await fetch(`/api/events/tickets/${encodeURIComponent(ticketId)}/invoice.pdf`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'TICKET_INVOICE_FAILED');
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`klavierhaus-ticket-invoice-${ticketId}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){showError(error)}
}
async function markEventTicketPaid(ticketId){
 const paymentMethod=await chooseStandardPaymentMethod({title:bi('Ticket payment method','Jegyfizetés módja'),initialValue:'Cash',confirmText:bi('Mark paid','Fizetve')});if(!paymentMethod)return;
 try{await api(`/api/events/tickets/${encodeURIComponent(ticketId)}/pay`,{method:'POST',body:JSON.stringify({payment_method:paymentMethod})});showToast(`${bi('Ticket marked paid and finalized.','A jegy fizetettre állítva és véglegesítve.')} · ${paymentMethod}`,'success');if(eventAdminSelectedId)await openEventDetails(eventAdminSelectedId);}catch(error){showError(error)}
}
function syncIndividualTicketPrice(value){
 const event=eventAdminRows.find(row=>row.id===value),input=$('#individualTicketPrice');
 if(event&&input&&['PUBLIC_PAID','ON_SITE'].includes($('#individualTicketVariant')?.value))input.value=(Number(event.price_cents||0)/100).toFixed(2);
}
function syncIndividualTicketVariant(value){
 const variant=String(value||'').toUpperCase(),eventId=$('#individualTicketEvent')?.value||'',price=$('#individualTicketPrice'),status=document.querySelector('#form [name="payment_status"]'),method=document.querySelector('#form [name="payment_method"]');
 if(['VIP','INVITATION','COMPLIMENTARY','PUBLIC_FREE','MANUAL'].includes(variant)){if(price)price.value='0.00';if(status)status.value='NOT_REQUIRED';}
 else if(variant==='ON_SITE'){syncIndividualTicketPrice(eventId);if(status)status.value='PENDING';if(method)method.value='Cash';}
 else if(variant==='PUBLIC_PAID'){syncIndividualTicketPrice(eventId);if(status)status.value='PAID';}
}
function updateIndividualTicketEventSummary(value){
 const event=eventAdminRows.find(row=>row.id===value);if(!event)return;
 const capacity=event.capacity||{};
 const values={individualTicketEventType:event.custom_type||event.event_type||event.access_type||'—',individualTicketEventDate:eventDateLabel(event.start_at),individualTicketEventLocation:[event.venue_name,event.venue_city,event.venue_region].filter(Boolean).join(', ')||'—',individualTicketEventCapacity:`${Number(capacity.occupied||0)} / ${Number(capacity.total||event.capacity_total||0)} · ${Number(capacity.remaining||0)} ${bi('public places left','nyilvános szabad hely')}`,individualTicketEventStatus:eventStatusLabel(event.status)};
 Object.entries(values).forEach(([id,value])=>{const input=$(`#${id}`);if(input)input.value=value});
 syncIndividualTicketPrice(value);
}
function fillIndividualTicketCustomer(value){
 const contact=individualTicketContacts.find(row=>row.id===value);if(!contact)return;
 const name=$('#individualTicketName'),email=$('#individualTicketEmail'),buyer=$('#individualTicketBuyer');
 if(name&&!name.value)name.value=contact.name||'';
 if(email&&!email.value)email.value=contact.email||'';
 if(buyer&&!buyer.value)buyer.value=contact.name||'';
}
async function openIndividualTicketModal(eventId=''){
 try{
  if(!eventAdminRows.length)eventAdminRows=await api('/api/events');
  individualTicketContacts=await api('/api/contacts').catch(()=>[]);
  const rows=eventAdminRows.filter(row=>!['CANCELLED','CLOSED'].includes(row.status));
  if(!rows.length)return appAlert(bi('No open event is available for a new ticket.','Nincs nyitott esemény új jegyhez.'),'warning');
  const selected=rows.some(row=>row.id===eventId)?eventId:rows[0].id,event=rows.find(row=>row.id===selected);
  $('#modal').classList.remove('hidden');$('#modal').classList.remove('digital-attendance-modal-shell');$('#modalTitle').textContent=bi('New individual ticket','Új egyedi jegy');
  $('#form').innerHTML=`<div class="event-form-intro"><strong>${bi('Create one operational ticket and generate its front, back and full documents.','Hozz létre egy operatív jegyet, és készítsd el az előlap-, hátlap- és teljes dokumentumot.')}</strong><span>${bi('Special tickets use the separate special-capacity pool when it is limited. On-site tickets receive documents only after payment.','A speciális jegyek korlátozott esetben külön férőhelykeretet használnak. Helyszíni jegy csak fizetés után kap dokumentumot.')}</span></div><div class="form-grid event-form-grid">
 <div class="field full"><label>${bi('Event','Esemény')} *</label><select id="individualTicketEvent" name="event_id" onchange="updateIndividualTicketEventSummary(this.value)">${rows.map(row=>`<option value="${htmlText(row.id)}" ${row.id===selected?'selected':''}>${htmlText(currentLang==='hu'?row.title_hu:row.title_en)} · ${htmlText(eventDateLabel(row.start_at))}</option>`).join('')}</select></div>
 <div class="field"><label>${bi('Event type','Eseménytípus')}</label><input id="individualTicketEventType" readonly value="${htmlText(event.custom_type||event.access_type||'—')}"></div><div class="field"><label>${bi('Event date','Esemény dátuma')}</label><input id="individualTicketEventDate" readonly value="${htmlText(eventDateLabel(event.start_at))}"></div>
 <div class="field"><label>${bi('Location','Helyszín')}</label><input id="individualTicketEventLocation" readonly value="${htmlText([event.venue_name,event.venue_city,event.venue_region].filter(Boolean).join(', ')||'—')}"></div><div class="field"><label>${bi('Capacity','Kapacitás')}</label><input id="individualTicketEventCapacity" readonly value="${htmlText(`${Number(event.capacity?.occupied||0)} / ${Number(event.capacity?.total||event.capacity_total||0)}`)}"></div>
 <div class="field"><label>${bi('Event status','Eseményállapot')}</label><input id="individualTicketEventStatus" readonly value="${htmlText(eventStatusLabel(event.status))}"></div>
 <div class="field"><label>${bi('Ticket variant','Jegytípus')} *</label><select id="individualTicketVariant" name="ticket_variant" onchange="syncIndividualTicketVariant(this.value)"><option value="PUBLIC_PAID">${bi('Public paid','Nyilvános fizetős')}</option><option value="PUBLIC_FREE">${bi('Public free','Nyilvános ingyenes')}</option><option value="VIP">VIP</option><option value="INVITATION">${bi('Invitation','Meghívásos')}</option><option value="COMPLIMENTARY">${bi('Complimentary','Tiszteletjegy')}</option><option value="MANUAL">${bi('Manual','Manuális')}</option><option value="ON_SITE">${bi('On-site payment','Helyszíni fizetés')}</option></select></div>
 <div class="field full"><label>${bi('Existing customer','Meglévő ügyfél')}</label><select name="contact_id" onchange="fillIndividualTicketCustomer(this.value)"><option value="">${bi('New guest','Új vendég')}</option>${individualTicketContacts.map(contact=>`<option value="${htmlText(contact.id)}">${htmlText(contact.name)}${contact.email?` · ${htmlText(contact.email)}`:''}</option>`).join('')}</select></div>
 <div class="field"><label>${bi('Salutation','Megszólítás')}</label><select name="salutation"><option value=""></option><option>Mr.</option><option>Mrs.</option><option>Ms.</option><option>Dr.</option><option>Prof.</option></select></div><div class="field"><label>${bi('First name(s)','Keresztnév(ek)')}</label><input name="first_names" maxlength="120" placeholder="${bi('Max two names','Legfeljebb két név')}"></div>
 <div class="field"><label>${bi('Surname component(s)','Vezetéknév-elemek')}</label><input name="surnames" maxlength="120" placeholder="${bi('Max two components','Legfeljebb két elem')}"></div><div class="field"><label>${bi('Suffix','Utótag')}</label><input name="suffix" maxlength="30" placeholder="Jr."></div>
 <div class="field full"><label>${bi('Original full guest name','Eredeti teljes vendégnév')}</label><input id="individualTicketName" name="attendee_name" maxlength="500" placeholder="${bi('Required for a new guest if name fields are empty','Új vendégnél kötelező, ha a névmezők üresek')}"></div>
 <div class="field"><label>Email</label><input id="individualTicketEmail" name="contact_email" type="email" autocomplete="email"></div><div class="field"><label>${bi('Buyer name','Vásárló neve')}</label><input id="individualTicketBuyer" name="buyer_name" maxlength="500"></div>
 <div class="field"><label>${bi('Price · USD','Ár · USD')}</label><input id="individualTicketPrice" name="price_dollars" type="number" min="0" step="0.01" value="${(Number(event.price_cents||0)/100).toFixed(2)}"></div>
 <div class="field"><label>${bi('Payment status','Fizetési állapot')}</label><select name="payment_status"><option value="PAID">${bi('Paid','Fizetve')}</option><option value="PENDING">${bi('Pending / reserved','Függő / lefoglalt')}</option><option value="NOT_REQUIRED">${bi('Not required','Nem szükséges')}</option></select></div>
 <div class="field"><label>${bi('Payment method','Fizetési mód')}</label><select name="payment_method">${standardPaymentMethodOptions('Cash')}</select></div>
 <label class="check-row full"><input type="checkbox" name="send_email" value="1"> ${bi('Send the front document by email after creation','Az előlap e-mailes kiküldése létrehozás után')}</label>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Create ticket','Jegy létrehozása')}</button></div>`;
  $('#form').onsubmit=event=>saveIndividualTicket(event);applyLanguageToDOM(document.getElementById('modal'));enhanceCustomSelects(document.getElementById('modal'));
 }catch(error){showError(error)}
}
async function saveIndividualTicket(event){
 event.preventDefault();const formData=new FormData(event.target),body=Object.fromEntries(formData.entries());body.price_cents=Math.round(Number(body.price_dollars||0)*100);delete body.price_dollars;body.send_email=formData.has('send_email');
 try{
  await api('/api/events/individual-tickets',{method:'POST',body:JSON.stringify(body)});closeModal();showToast(bi('Individual ticket created and documents generated.','Az egyedi jegy létrejött, a dokumentumok elkészültek.'),'success');await renderEventWorkspace('event_tickets');
 }catch(error){showError(error)}
}

async function openEventDetails(id){
 stopEventDetailsAttendanceLiveSync();const row=await api(`/api/events/${encodeURIComponent(id)}`);eventAdminSelectedId=id;
 $('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Event management','Eseménykezelés');
 const canPublish=row.status==='DRAFT',canUnpublish=['PUBLISHED','RESCHEDULED'].includes(row.status),canEdit=!['CLOSED','CANCELLED'].includes(row.status),canClose=row.status!=='CLOSED';
 $('#form').innerHTML=`<div class="event-detail-head"><div><span class="event-status event-status--${String(row.status).toLowerCase()}">${htmlText(eventStatusLabel(row.status))}</span><h2>${htmlText(currentLang==='hu'?row.title_hu:row.title_en)}</h2><p>${htmlText(eventDateLabel(row.start_at))} · ${htmlText(row.venue_name)}</p></div><div class="event-capacity-ring"><strong>${Number(row.capacity?.remaining||0)}</strong><span>${bi('places left','szabad hely')}</span></div></div>
 <div class="event-command-bar">${canEdit?`<button type="button" class="small" onclick="openEventEditor('${htmlText(row.id)}')">${bi('Edit','Szerkesztés')}</button><button type="button" class="small" onclick="openIndividualTicketModal('${htmlText(row.id)}')">${bi('New individual ticket','Új egyedi jegy')}</button>`:''}${canPublish?`<button type="button" class="small" onclick="publishEvent('${htmlText(row.id)}')">${bi('Publish','Publikálás')}</button>`:''}${canUnpublish?`<button type="button" class="small ghost-btn" onclick="unpublishEvent('${htmlText(row.id)}')">${bi('Unpublish','Publikálás visszavonása')}</button>`:''}${row.published_at&&canEdit?`<button type="button" class="small ghost-btn" onclick="rescheduleEvent('${htmlText(row.id)}','${htmlText(row.start_local)}','${htmlText(row.end_local)}')">${bi('Reschedule','Áthelyezés')}</button><button type="button" class="small danger-btn" onclick="cancelEvent('${htmlText(row.id)}')">${bi('Cancel event','Esemény lemondása')}</button>`:''}${row.relaunch_source_event_id&&row.published_at?`<button type="button" class="small" onclick="notifyEventInterest('${htmlText(row.relaunch_source_event_id)}','${htmlText(row.id)}')">${bi('Notify waiting audience','Várakozó érdeklődők értesítése')}</button>`:''}${canClose?`<button type="button" class="small ghost-btn" onclick="closeEventRecord('${htmlText(row.id)}')">${bi('Close event','Esemény lezárása')}</button>`:''}<button type="button" class="small danger-btn" onclick="deleteEventRecord('${htmlText(row.id)}')">${isSuperadmin()?bi('Delete permanently','Végleges törlés'):bi('Delete event','Esemény törlése')}</button></div>
 ${canEdit?`<div class="event-detail-grid"><section class="event-operation-card"><h3>${bi('Invitation','Meghívás')}</h3><div class="form-grid compact"><div class="field"><label>${bi('Guest name','Vendég neve')}</label><input id="eventInviteName"></div><div class="field"><label>Email</label><input id="eventInviteEmail" type="email"></div><div class="field"><label>${bi('Language','Nyelv')}</label><select id="eventInviteLanguage"><option value="en">English</option><option value="hu">Magyar</option></select></div></div><button type="button" onclick="createEventInvitation('${htmlText(row.id)}')">${bi('Send invitation','Meghívás küldése')}</button></section>
 <section class="event-operation-card"><h3>${bi('Complimentary ticket','Tiszteletjegy')}</h3><div class="form-grid compact"><div class="field"><label>${bi('Guest name','Vendég neve')}</label><input id="eventCompName"></div><div class="field"><label>Email</label><input id="eventCompEmail" type="email"></div></div><button type="button" onclick="createComplimentaryTicket('${htmlText(row.id)}')">${bi('Issue ticket','Jegy kiadása')}</button></section>
 </div>`:''}
 <div class="event-data-section"><h3>${bi('Invitations','Meghívások')}</h3><div class="table-wrap"><table><thead><tr><th>${bi('Guest','Vendég')}</th><th>Email</th><th>${bi('Status','Állapot')}</th><th>${bi('Delivery','Kézbesítés')}</th><th>${bi('Actions','Műveletek')}</th></tr></thead><tbody>${invitationRowsHtml(row.invitations||[])}</tbody></table></div></div>
 <div class="event-data-section"><div class="toolbar"><h3>${bi('Tickets and guest list','Jegyek és vendéglista')}</h3><div class="toolbar-actions">${canEdit?`<button type="button" class="small" onclick="openIndividualTicketModal('${htmlText(row.id)}')">${bi('New individual ticket','Új egyedi jegy')}</button>`:''}<button type="button" class="small" onclick="downloadGuestListPdf('${htmlText(row.id)}')">${bi('Export A4 PDF','A4 PDF export')}</button></div></div><div class="table-wrap"><table><thead><tr><th>${bi('Guest','Vendég')}</th><th>${bi('Source','Forrás')}</th><th>${bi('Status','Állapot')}</th><th>${bi('Ticket ID','Jegyazonosító')}</th><th>${bi('Actions','Műveletek')}</th></tr></thead><tbody>${ticketRowsHtml(row.tickets||[])}</tbody></table></div></div>
 <div class="event-data-section"><h3>${bi('Stripe Sandbox payments','Stripe Sandbox-fizetések')} · ${row.stripe?.enabled?bi('TEST MODE active','TESZTÜZEM aktív'):bi('not configured','nincs beállítva')}</h3><div class="table-wrap"><table><thead><tr><th>${bi('Purchaser','Vásárló')}</th><th>Email</th><th>${bi('Quantity','Darab')}</th><th>${bi('Total','Összeg')}</th><th>${bi('Status','Állapot')}</th><th>${bi('Mode','Mód')}</th><th>${bi('Actions','Műveletek')}</th></tr></thead><tbody>${paymentRowsHtml(row.payments||[])}</tbody></table></div></div>
 <div class="event-data-section"><h3>${bi('Refund requests','Visszatérítési igények')}</h3><div class="table-wrap"><table><thead><tr><th>Email</th><th>${bi('Eligibility','Jogosultság')}</th><th>${bi('Status','Állapot')}</th><th>${bi('Actions','Műveletek')}</th></tr></thead><tbody>${refundRowsHtml(row.refunds||[])}</tbody></table></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Close','Bezárás')}</button></div>`;
 const ticketSection=[...document.querySelectorAll('#form .event-data-section')].find(section=>section.textContent.includes('Tickets and guest list')||section.textContent.includes('Jegyek és vendéglista'));
 const attendancePanel=document.createElement('section');attendancePanel.id='eventAttendancePanel';attendancePanel.className='event-data-section attendance-panel';attendancePanel.innerHTML=`<div class="toolbar"><div><h3>${bi('Digital attendance','Digitális érkeztetés')}</h3><p class="muted">${bi('Tablet-friendly manual checklist. Click once to mark present; click again to correct a mistake.','Táblagépre optimalizált kézi checklist. Egy kattintás az érkezés, újabb kattintás a javítás.')}</p></div><div class="toolbar-actions"><button type="button" class="small" onclick="downloadGuestListPdf('${htmlText(row.id)}')">${bi('Export A4 PDF','A4 PDF export')}</button>${canClose?`<button type="button" class="small danger-btn" onclick="closeEventAttendance('${htmlText(row.id)}')">${bi('Close guest list','Vendéglista lezárása')}</button>`:''}</div></div><div class="attendance-panel__body"><p class="muted">${bi('Loading attendance…','Érkeztetés betöltése…')}</p></div>`;
 if(ticketSection)ticketSection.before(attendancePanel);else document.getElementById('form').prepend(attendancePanel);
 if(!canEdit)document.querySelectorAll('#form .event-data-section button').forEach(button=>{if(!String(button.getAttribute('onclick')||'').includes('download'))button.remove();});
 $('#form').onsubmit=event=>event.preventDefault();applyLanguageToDOM(document.getElementById('modal'));enhanceCustomSelects(document.getElementById('modal'));await loadEventAttendancePanel(row.id);startEventDetailsAttendanceLiveSync(row.id);
}

async function eventMutation(url,body={},success=''){try{await api(url,{method:'POST',body:JSON.stringify(body)});if(success)showToast(success,'success');await renderEvents();if(eventAdminSelectedId)await openEventDetails(eventAdminSelectedId);}catch(error){showError(error)}}
async function publishEvent(id){if(await appConfirm(bi('Publish this event on the public website?','Publikáljuk az eseményt a nyilvános weboldalon?')))eventMutation(`/api/events/${id}/publish`,{},bi('Event published.','Esemény publikálva.'));}
async function unpublishEvent(id){if(await appConfirm(bi('Remove this event from the public website? It remains an editable draft.','Eltávolítjuk az eseményt a nyilvános weboldalról? Szerkeszthető piszkozatként megmarad.')))eventMutation(`/api/events/${id}/unpublish`,{},bi('Event unpublished.','A publikálás visszavonva.'));}
async function rescheduleEvent(id,start,end){const nextStart=await appPrompt(bi('Enter the new start in YYYY-MM-DDTHH:MM format.','Add meg az új kezdést ÉÉÉÉ-HH-NNTÓÓ:PP formában.'),{initialValue:start});if(!nextStart)return;const nextEnd=await appPrompt(bi('Enter the new end in YYYY-MM-DDTHH:MM format.','Add meg az új befejezést ÉÉÉÉ-HH-NNTÓÓ:PP formában.'),{initialValue:end});if(!nextEnd)return;eventMutation(`/api/events/${id}/reschedule`,{start_local:nextStart,end_local:nextEnd},bi('Event rescheduled.','Esemény áthelyezve.'));}
async function cancelEvent(id){const reason=await appPrompt(bi('Reason for cancellation','A lemondás oka'));if(reason===null)return;eventMutation(`/api/events/${id}/cancel`,{reason},bi('Event cancelled.','Esemény lemondva.'));}
async function closeEventRecord(id){if(await appConfirm(bi('Finalize attendance and close this event? This operation cannot be repeated.','Véglegesítjük a megjelenéseket és lezárjuk az eseményt? A művelet nem ismételhető meg.')))await closeEventAttendance(id);}
function attendanceTicketMarkup(ticket,closed,paused){
 const search=String(`${ticket.attendee_name||''} ${ticket.contact_email||''} ${ticket.public_code||''}`).toLowerCase(),status=String(ticket.attendance_status||'NOT_ARRIVED').toUpperCase(),checked=status==='PRESENT',deleted=status==='DELETED';
 return `<article class="attendance-ticket-row ${deleted?'is-deleted':''}" data-attendance-row data-search="${htmlText(search)}"><label class="attendance-check"><input type="checkbox" ${checked?'checked':''} ${closed||paused||deleted?'disabled':''} onchange="setEventCheckIn('${htmlText(ticket.id)}',this.checked)"><span class="attendance-check__box" aria-hidden="true">${checked?'✓':''}</span><span><strong>${htmlText(ticket.attendee_name)}</strong><small>${htmlText(ticket.contact_email||'')}</small></span></label><span class="attendance-ticket-code">${htmlText(ticket.public_code)}</span><span class="attendance-ticket-status ${checked?'is-present':''}">${deleted?bi('Deleted','Törölt'):checked?bi('Present','Megérkezett'):bi('Not checked in','Még nem érkezett meg')}</span>${!closed&&!paused&&!deleted?`<button type="button" class="small danger-btn" onclick="deleteDigitalAttendanceGuest('${htmlText(ticket.id)}')">${bi('Delete','Törlés')}</button>`:''}</article>`;
}
function renderAttendancePanel(data,id){
 const panel=$('#eventAttendancePanel .attendance-panel__body');if(!panel)return;eventDetailsAttendanceState=data;
 const total=Number(data.totals?.total||0),present=Number(data.totals?.present||0),noShow=Number(data.totals?.no_show||0),closed=Boolean(data.closed),paused=Boolean(data.paused);
 const controls=data.can_pause?`<button type="button" class="small ghost-btn" onclick="pauseDigitalAttendance('${htmlText(id)}')">${bi('Pause attendance','Jelenlétiív szüneteltetése')}</button>`:data.can_resume?`<button type="button" class="small ghost-btn" onclick="resumeDigitalAttendance('${htmlText(id)}')">${bi('Resume attendance','Jelenlétiív folytatása')}</button>`:'';
 panel.innerHTML=`<div class="attendance-panel__controls">${controls}</div>${paused?`<div class="attendance-closed-notice"><strong>${bi('Attendance paused','Jelenlétiív szüneteltetve')}</strong><span>${bi('Input is paused until an attendance operator resumes it.','A rögzítés szünetel, amíg egy érkeztetést kezelő munkatárs folytatja.')}</span></div>`:''}<div class="attendance-kpis"><span><strong>${total}</strong><small>${bi('Tickets','Jegyek')}</small></span><span><strong>${present}</strong><small>${bi('Present','Megérkezett')}</small></span><span><strong>${noShow}</strong><small>${bi('Not checked in','Nem érkezett meg')}</small></span></div><label class="attendance-search"><span>${bi('Search guest, email or ticket ID','Vendég, e-mail vagy jegyazonosító keresése')}</span><input type="search" oninput="filterAttendanceRows(this.value)" placeholder="${bi('Start typing…','Kezdj el gépelni…')}"></label>${closed?`<div class="attendance-closed-notice"><strong>${bi('Guest list closed','Vendéglista lezárva')}</strong><span>${bi('This attendance snapshot is final and cannot be edited.','Ez az attendance snapshot végleges, nem módosítható.')}</span>${data.report?`<pre>${htmlText(JSON.stringify(data.report,null,2))}</pre>`:''}</div>`:`<p class="attendance-hint">${bi('A second click removes the green check and writes a correction to the audit log.','A második kattintás törli a zöld pipát, és javítást ír a módosítási naplóba.')}</p>`}<div class="attendance-ticket-list">${data.tickets?.length?data.tickets.map(ticket=>attendanceTicketMarkup(ticket,closed,paused)).join(''):`<div class="empty-state">${bi('No active tickets found.','Nincs aktív jegy.')}</div>`}</div>`;
}
async function loadEventAttendancePanel(id){try{const data=await api(`/api/events/${encodeURIComponent(id)}/attendance`);renderAttendancePanel(data,id);}catch(error){const panel=$('#eventAttendancePanel .attendance-panel__body');if(panel)panel.innerHTML=`<p class="error-text">${htmlText(error.message||'ATTENDANCE_LOAD_FAILED')}</p>`;}}
function filterAttendanceRows(value){const query=String(value||'').toLowerCase().trim();document.querySelectorAll('#eventAttendancePanel [data-attendance-row],#digital_attendance [data-attendance-row],#modal.digital-attendance-modal-shell [data-attendance-row]').forEach(row=>row.classList.toggle('hidden',Boolean(query)&&!row.dataset.search.includes(query)));}
async function setEventCheckIn(ticketId,checked){try{const result=await api(`/api/events/tickets/${encodeURIComponent(ticketId)}/check-in`,{method:'POST',body:JSON.stringify({checked_in:Boolean(checked),expected_revision:eventDetailsAttendanceState?.session?.revision})});if(result.state)renderAttendancePanel(result.state,eventAdminSelectedId);showToast(checked?bi('Guest marked present.','A vendég megérkezett.'):bi('Check-in corrected.','Az érkeztetés javítva.'),'success');}catch(error){if(error.details?.state)renderAttendancePanel(error.details.state,eventAdminSelectedId);showError(error);}}
async function closeEventAttendance(id,force=false){
 if(!force&&!await appConfirm(bi('Finalize this guest list? The digital attendance report will become read-only.','Lezárjuk ezt a vendéglistát? A digitális attendance report ezután csak olvasható lesz.')))return;
 try{const report=await api(`/api/events/${encodeURIComponent(id)}/attendance/close`,{method:'POST',body:JSON.stringify(force?{force:true}:{})});showToast(`${bi('Attendance report created.','Attendance report elkészült.')}: ${Number(report.tickets?.present||0)}/${Number(report.tickets?.total||0)}`,'success');await renderEvents();await openEventDetails(id);}catch(error){showError(error);}
}
async function voidEventTicket(ticketId){if(!await appConfirm(bi('Void this invitation or complimentary ticket? Its capacity will be released.','Érvénytelenítjük ezt a meghívó- vagy tiszteletjegyet? A férőhely felszabadul.')))return;try{await api(`/api/events/tickets/${encodeURIComponent(ticketId)}/void`,{method:'POST',body:'{}'});showToast(bi('Ticket voided and capacity released.','A jegy érvénytelenítve, a férőhely felszabadult.'),'success');if(eventAdminSelectedId)await openEventDetails(eventAdminSelectedId);}catch(error){showError(error)}}
async function deleteEventRecord(id){const superadmin=isSuperadmin(),question=superadmin?bi('Permanently delete this event and every related event record?','Véglegesen töröljük az eseményt és minden kapcsolódó eseményrekordot?'):bi('Delete this event? If bookings or financial records exist, use organizer cancellation instead.','Töröljük az eseményt? Ha foglalási vagy pénzügyi rekord tartozik hozzá, helyette szervezői lemondást kell használni.');if(!await appConfirm(question,{type:'error',confirmText:superadmin?bi('Delete permanently','Végleges törlés'):bi('Delete event','Esemény törlése')}))return;const reason=await appPrompt(bi('Required deletion reason','Kötelező törlési indok'),{type:'error'});if(reason===null||!String(reason).trim())return;if(superadmin){const confirmation=await appPrompt(bi('Type DELETE EVENT to confirm permanent deletion.','A végleges törléshez írd be: DELETE EVENT'),{type:'error',confirmText:bi('Confirm permanent deletion','Végleges törlés megerősítése')});if(confirmation!=='DELETE EVENT')return;}try{await api(`/api/events/${id}`,{method:'DELETE',body:JSON.stringify({reason:String(reason).trim()})});eventAdminSelectedId=null;closeModal();showToast(bi('Event deleted.','Esemény törölve.'),'success');await renderEvents();}catch(error){showError(error)}}
async function downloadEventInterest(id){const response=await fetch(`/api/event-repeat-interest/${encodeURIComponent(id)}.csv`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)return showError((await response.json()).error);const blob=await response.blob(),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`event-interest-${id}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}
async function relaunchEvent(id){const source=eventAdminRows.find(row=>row.id===id);if(!source)return;const start=await appPrompt(bi('New start time (YYYY-MM-DDTHH:MM, New York time)','Új kezdés (ÉÉÉÉ-HH-NNTÓÓ:PP, New York-i idő)'),{initialValue:String(source.start_local||'')});if(!start)return;const end=await appPrompt(bi('New end time (YYYY-MM-DDTHH:MM, New York time)','Új befejezés (ÉÉÉÉ-HH-NNTÓÓ:PP, New York-i idő)'),{initialValue:String(source.end_local||'')});if(!end)return;try{const created=await api(`/api/events/${encodeURIComponent(id)}/relaunch`,{method:'POST',body:JSON.stringify({start_local:start,end_local:end})});showToast(bi('A new editable event draft was created. Publish it after review.','Új szerkeszthető eseménypiszkozat készült. Ellenőrzés után publikáld.'),'success');await renderEvents();openEventEditor(created.id);}catch(error){showError(error)}}
async function notifyEventInterest(sourceId,newEventId){if(!await appConfirm(bi('Send the bilingual new-date announcement to every not-yet-notified requester?','Kiküldjük a kétnyelvű új időpont értesítést minden még nem értesített érdeklődőnek?')))return;try{const result=await api(`/api/events/${encodeURIComponent(sourceId)}/notify-interest`,{method:'POST',body:JSON.stringify({new_event_id:newEventId})});await appAlert(`${bi('Sent','Elküldve')}: ${Number(result.sent||0)} · ${bi('Failed','Sikertelen')}: ${Number(result.failed||0)}`,result.failed?'warning':'success');}catch(error){showError(error)}}
async function createEventInvitation(id){const guest_name=$('#eventInviteName')?.value,guest_email=$('#eventInviteEmail')?.value,language=$('#eventInviteLanguage')?.value;await eventMutation(`/api/events/${id}/invitations`,{guest_name,guest_email,language},bi('Invitation created.','Meghívás létrehozva.'));}
async function revokeEventInvitation(id){if(await appConfirm(bi('Revoke this invitation?','Visszavonjuk ezt a meghívást?')))eventMutation(`/api/events/invitations/${id}/revoke`,{},bi('Invitation revoked.','Meghívás visszavonva.'));}
async function createComplimentaryTicket(id){const attendee_name=$('#eventCompName')?.value,contact_email=$('#eventCompEmail')?.value;await eventMutation(`/api/events/${id}/complimentary-tickets`,{attendee_name,contact_email},bi('Complimentary ticket issued.','Tiszteletjegy kiadva.'));}
async function editEventGuestName(ticketId,currentName){const attendee_name=await appPrompt(bi('Correct guest name','Vendégnév javítása'),{initialValue:currentName});if(!attendee_name||attendee_name.trim()===currentName.trim())return;try{await api(`/api/events/tickets/${encodeURIComponent(ticketId)}`,{method:'PUT',body:JSON.stringify({attendee_name})});showToast(bi('Guest name updated.','A vendégnév frissült.'),'success');if(eventAdminSelectedId)await openEventDetails(eventAdminSelectedId);}catch(error){showError(error)}}
async function downloadGuestListPdf(id){try{const state=await api(`/api/events/${encodeURIComponent(id)}/attendance`);if(!state.mode){const ok=await appConfirm(bi('This export starts PAPER attendance mode. Digital check-in will be unavailable until an administrator switches the event back to digital. Continue?','Ez az export PAPÍR jelenléti módot indít. A digitális érkeztetés letiltódik, amíg egy adminisztrátor vissza nem vált digitális módra. Folytatod?'),{type:'warning',confirmText:bi('Start paper mode','Papír mód indítása')});if(!ok)return;await api(`/api/events/${encodeURIComponent(id)}/attendance/mode`,{method:'POST',body:JSON.stringify({mode:'PAPER'})});}else if(state.mode==='DIGITAL'&&!state.closed)throw new Error('DIGITAL_ATTENDANCE_NOT_CLOSED');const response=await fetch(`/api/events/${encodeURIComponent(id)}/guest-list.pdf?lang=en`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error((await response.json()).error||'GUEST_LIST_PDF_FAILED');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`klavierhaus-guest-list-${id}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){if(error.message==='DIGITAL_ATTENDANCE_NOT_CLOSED')return appAlert(bi('Digital attendance must be closed before the final PDF can be exported.','A végleges PDF-export előtt le kell zárni a digitális jelenlétiívet.'),'warning');showError(error)}}
async function resolveEventRefund(id,status){const note=await appPrompt(status==='APPROVED'?bi('Approval note','Jóváhagyási megjegyzés'):bi('Reason for rejection','Elutasítás oka'));if(note===null)return;try{await api(`/api/events/refund-requests/${id}`,{method:'PUT',body:JSON.stringify({status,resolution_note:note})});if(eventAdminSelectedId)await openEventDetails(eventAdminSelectedId);}catch(error){showError(error)}}
async function markEventRefundNoShow(id){const note=await appPrompt(bi('No-show note','Nem megjelenés megjegyzése'));if(note===null)return;try{await api(`/api/events/refund-requests/${id}`,{method:'PUT',body:JSON.stringify({status:'REJECTED',no_show:true,review_note:note})});if(eventAdminSelectedId)await openEventDetails(eventAdminSelectedId);}catch(error){showError(error)}}

let digitalAttendanceSelectedEventId='';
let digitalAttendanceStateCache=new Map();
let digitalAttendanceLiveAbortController=null;
let digitalAttendanceLiveEventId='';
let eventDetailsAttendanceLiveAbortController=null;
let eventDetailsAttendanceLiveEventId='';
let eventDetailsAttendanceState=null;
function isAttendanceOperator(){return Boolean(user&&(user.role==='SUPERADMIN'||user.role==='ADMIN'||user.role==='MANAGER'||user.role==='WORKER'));}
function stopDigitalAttendanceLiveSync(){if(digitalAttendanceLiveAbortController){digitalAttendanceLiveAbortController.abort();digitalAttendanceLiveAbortController=null;}digitalAttendanceLiveEventId='';}
function stopEventDetailsAttendanceLiveSync(){if(eventDetailsAttendanceLiveAbortController){eventDetailsAttendanceLiveAbortController.abort();eventDetailsAttendanceLiveAbortController=null;}eventDetailsAttendanceLiveEventId='';eventDetailsAttendanceState=null;}
function startEventDetailsAttendanceLiveSync(eventId){
 stopEventDetailsAttendanceLiveSync();eventDetailsAttendanceLiveEventId=String(eventId);const controller=new AbortController();eventDetailsAttendanceLiveAbortController=controller;
 const consume=async()=>{let retry=500;while(!controller.signal.aborted&&eventDetailsAttendanceLiveEventId===String(eventId)&&!$('#modal')?.classList.contains('hidden')){
  try{const response=await fetch('/api/events/'+encodeURIComponent(eventId)+'/attendance/stream',{headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'},cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('ATTENDANCE_STREAM_FAILED');const reader=response.body?.getReader();if(!reader)throw new Error('ATTENDANCE_STREAM_UNAVAILABLE');const decoder=new TextDecoder();let buffer='';
   while(!controller.signal.aborted){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const blocks=buffer.split(/\n\n/);buffer=blocks.pop()||'';for(const block of blocks){const data=block.split(/\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('');if(!data)continue;try{const state=JSON.parse(data);eventDetailsAttendanceState=state;renderAttendancePanel(state,eventId);}catch(_error){}}}retry=500;
  }catch(error){if(controller.signal.aborted)break;await new Promise(resolve=>setTimeout(resolve,retry));retry=Math.min(retry*2,8000);}
 }};
 consume();
}
function injectAttendanceCustomType(state,root){
 const customType=String(state?.event?.custom_type||'').trim();
 if(!customType||!root)return;
 root.querySelectorAll('.digital-attendance-sheet__header > div:last-child').forEach(header=>{
  if(header.querySelector('.digital-attendance-sheet__type'))return;
  const type=document.createElement('p');type.className='digital-attendance-sheet__type';type.textContent=customType;
  const title=header.querySelector('h2');if(title)header.insertBefore(type,title);
 });
}
function applyDigitalAttendanceLiveState(state){
 if(!state?.event?.id)return;
 digitalAttendanceStateCache.set(state.event.id,state);
 const box=$('#digital_attendance');if(!box)return;
 renderDigitalAttendanceStateLists(box);
 if(state.event.id===digitalAttendanceSelectedEventId){
  const sheet=document.querySelector('#modal.digital-attendance-modal-shell .digital-attendance-modal-content'),previousSearch=sheet?.querySelector('input[type="search"]')?.value||'';
  if(sheet){sheet.innerHTML=digitalAttendanceSheetMarkup(state);injectAttendanceCustomType(state,sheet);const search=sheet.querySelector('input[type="search"]');if(search){search.value=previousSearch;filterAttendanceRows(previousSearch);}}
 }
}
async function startDigitalAttendanceLiveSync(eventId){
 stopDigitalAttendanceLiveSync();digitalAttendanceLiveEventId=String(eventId);const controller=new AbortController();digitalAttendanceLiveAbortController=controller;
 const consume=async()=>{let retry=500;while(!controller.signal.aborted&&digitalAttendanceLiveEventId===String(eventId)&&currentView==='digital_attendance'){
  try{const response=await fetch('/api/events/'+encodeURIComponent(eventId)+'/attendance/stream',{headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'},cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('ATTENDANCE_STREAM_FAILED');const reader=response.body?.getReader();if(!reader)throw new Error('ATTENDANCE_STREAM_UNAVAILABLE');const decoder=new TextDecoder();let buffer='';
   while(!controller.signal.aborted){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const blocks=buffer.split(/\n\n/);buffer=blocks.pop()||'';for(const block of blocks){const data=block.split(/\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('');if(!data)continue;try{applyDigitalAttendanceLiveState(JSON.parse(data));}catch(_error){}}}retry=500;
  }catch(error){if(controller.signal.aborted)break;await new Promise(resolve=>setTimeout(resolve,retry));retry=Math.min(retry*2,8000);}
 }};
 consume();
}
function attendanceDateLabel(value,timeZone='America/New_York'){try{return new Intl.DateTimeFormat('en-US',{timeZone,dateStyle:'long',timeStyle:'short'}).format(new Date(value));}catch(_error){return String(value||'');}}
function attendanceModeLabel(mode,status=''){return status==='PAUSED'?bi('Paused','Szüneteltetve'):mode==='PAPER'?bi('Paper mode','Papíralapú mód'):mode==='DIGITAL'?bi('Digital mode','Digitális mód'):bi('Not started','Nincs elindítva');}
function attendanceStateStartTime(state){const value=new Date(state?.event?.start_at||'').getTime();return Number.isFinite(value)?value:Number.MAX_SAFE_INTEGER;}
function attendanceStateSearchText(state){const event=state?.event||{};return [event.title_en,event.title_hu,event.start_at,event.start_local,attendanceDateLabel(event.start_at,event.timezone||'America/New_York'),event.venue_name].filter(Boolean).join(' ').toLocaleLowerCase();}
function attendanceStatesSorted(){return Array.from(digitalAttendanceStateCache.values()).sort((a,b)=>attendanceStateStartTime(a)-attendanceStateStartTime(b)||String(a?.event?.id||'').localeCompare(String(b?.event?.id||'')));}
function digitalAttendanceSectionsMarkup(){
 const states=attendanceStatesSorted(),active=states.filter(state=>!state.closed),closed=states.filter(state=>state.closed);
 const activeCards=active.length?active.map(attendanceEventCardMarkup).join(''):`<div class="digital-attendance-empty">${bi('No active events.','Nincs aktív esemény.')}</div>`;
 const closedCards=closed.length?closed.map(attendanceEventCardMarkup).join(''):`<div class="digital-attendance-empty">${bi('No closed events.','Nincs lezárt esemény.')}</div>`;
 return `<section class="digital-attendance-section digital-attendance-section--active"><div class="digital-attendance-section__heading"><div><p class="event-kicker">${bi('Attendance workspace','Jelenléti munkaterület')}</p><h3>${bi('Active events','Aktív események')}</h3><p class="muted">${bi('Events are ordered by their earliest start time. An elapsed event remains editable until an administrator closes the attendance sheet.','Az események a legkorábbi kezdési időpont szerint jelennek meg. A már lezajlott esemény az adminisztratív lezárásig szerkeszthető marad.')}</p></div></div><div class="digital-attendance-event-grid">${activeCards}</div></section><section class="digital-attendance-section digital-attendance-section--closed"><div class="digital-attendance-section__heading"><div><p class="event-kicker">${bi('Final records','Végleges rekordok')}</p><h3>${bi('Closed events','Lezárt események')}</h3><p class="muted">${bi('Closed events are read-only. Only the final attendance PDF can be downloaded.','A lezárt események csak olvashatók. Kizárólag a végleges jelenlétiív PDF-je tölthető le.')}</p></div><label class="digital-attendance-closed-search"><span>${bi('Search by title or date','Keresés cím vagy dátum alapján')}</span><input type="search" data-digital-attendance-closed-search placeholder="${bi('Title or date…','Cím vagy dátum…')}" autocomplete="off"></label></div><div class="digital-attendance-closed-list">${closedCards}</div></section>`;
}
function filterDigitalAttendanceClosedEvents(value){
 const query=String(value||'').trim().toLocaleLowerCase();
 document.querySelectorAll('#digital_attendance [data-closed-attendance-card]').forEach(card=>card.classList.toggle('hidden',Boolean(query)&&!card.dataset.search.includes(query)));
}
function renderDigitalAttendanceStateLists(box){
 const lists=box?.querySelector('[data-digital-attendance-state-lists]');
 if(!lists)return;
 const previousSearch=lists.querySelector('[data-digital-attendance-closed-search]')?.value||'';
 lists.innerHTML=digitalAttendanceSectionsMarkup();
 const search=lists.querySelector('[data-digital-attendance-closed-search]');
 if(search){search.value=previousSearch;search.addEventListener('input',()=>filterDigitalAttendanceClosedEvents(search.value));filterDigitalAttendanceClosedEvents(previousSearch);}
}
function attendanceEventCardMarkup(state){
 const event=state.event||{},title=currentLang==='hu'?(event.title_hu||event.title_en||'Klavierhaus event'):(event.title_en||event.title_hu||'Klavierhaus event'),selected=digitalAttendanceSelectedEventId===event.id,adminCanClose=isAdmin(),eventId=htmlText(event.id),eventDate=attendanceDateLabel(event.start_at,event.timezone||'America/New_York'),eventSearch=htmlText(attendanceStateSearchText(state));
 if(state.closed){return `<article class="digital-attendance-closed-card" data-closed-attendance-card data-search="${eventSearch}"><div class="digital-attendance-closed-card__summary"><strong>${htmlText(title)}</strong><span>${htmlText(eventDate)}</span><span>${htmlText(event.venue_name||'Klavierhaus')}</span><span>${Number(state.totals?.total||0)} ${bi('participants','résztvevő')}</span><span class="event-status event-status--closed">${bi('EVENT CLOSED','ESEMÉNY LEZÁRVA')}</span><span class="digital-attendance-closed-card__admin">${bi('Admin approved closure','Admin által jóváhagyva')}</span><button type="button" class="small" onclick="downloadDigitalAttendancePdf('${eventId}')">${bi('Download PDF','PDF letöltése')}</button></div></article>`;}
 const elapsed=Number.isFinite(new Date(event.end_at||'').getTime())&&new Date(event.end_at).getTime()<=Date.now();
 return `<article class="digital-attendance-event-card ${selected?'is-selected':''}" data-attendance-active-card data-search="${eventSearch}"><div class="digital-attendance-event-card__top"><span class="event-status">${htmlText(attendanceModeLabel(state.mode,state.status))}</span>${elapsed?`<span class="event-status event-status--closed">${bi('EVENT TIME PASSED','AZ ESEMÉNY IDEJE LEJÁRT')}</span>`:''}<span>${Number(state.totals?.total||0)} ${bi('guests','vendég')}</span></div><h3>${htmlText(title)}</h3><p>${htmlText(eventDate)}</p><p>${htmlText(event.venue_name||'Klavierhaus')}</p><dl><div><dt>${bi('Guests','Vendégek')}</dt><dd>${Number(state.totals?.total||0)}</dd></div><div><dt>${bi('Arrived','Megérkezett')}</dt><dd>${Number(state.totals?.present||0)}</dd></div><div><dt>${bi('Not arrived','Nem érkezett')}</dt><dd>${Number(state.totals?.no_show||0)}</dd></div><div><dt>${bi('Deleted','Törölt')}</dt><dd>${Number(state.totals?.deleted||0)}</dd></div></dl><div class="actions digital-attendance-event-card__actions"><button type="button" class="small" onclick="openDigitalAttendance('${eventId}')">${bi('Open attendance sheet','Jelenlétiív megnyitása')}</button><button type="button" class="small ghost-btn" onclick="downloadDigitalAttendancePdf('${eventId}')">${bi('PDF export','PDF-export')}</button>${state.paper&&adminCanClose?`<button type="button" class="small ghost-btn" onclick="switchDigitalAttendance('${eventId}')">${bi('Switch to digital','Váltás digitális módra')}</button>`:''}${state.can_pause?`<button type="button" class="small ghost-btn" onclick="pauseDigitalAttendance('${eventId}')">${bi('Pause','Szüneteltetés')}</button>`:''}${state.can_resume?`<button type="button" class="small ghost-btn" onclick="resumeDigitalAttendance('${eventId}')">${bi('Resume','Folytatás')}</button>`:''}${state.can_close&&adminCanClose?`<button type="button" class="small danger-btn" onclick="closeDigitalAttendance('${eventId}')">${bi('Close','Lezárás')}</button>`:''}</div></article>`;
}
function digitalAttendanceRowMarkup(ticket,state){
 const status=String(ticket.attendance_status||'NOT_ARRIVED').toUpperCase(),present=status==='PRESENT',deleted=status==='DELETED',closed=Boolean(state.closed),paused=Boolean(state.paused),search=String((ticket.attendee_name||'')+' '+(ticket.contact_email||'')+' '+(ticket.ticket_type||'')+' '+(ticket.public_code||'')).toLowerCase();
 const disabled=closed||paused||state.paper;
 const detailId=`attendance-details-${String(ticket.id).replace(/[^A-Za-z0-9_-]/g,'_')}`;
 return '<article class="digital-attendance-row '+(present?'is-present ':'')+(deleted?'is-deleted ':'')+(closed&&!present?'is-closed-not-arrived':'')+'" data-attendance-row data-search="'+htmlText(search)+'"><div class="digital-attendance-row__guest"><strong>'+htmlText(ticket.attendee_name||'—')+'</strong><button type="button" class="small ghost-btn attendance-details-toggle" aria-expanded="false" aria-controls="'+htmlText(detailId)+'" onclick="toggleAttendanceDetails(this)">Details</button><div id="'+htmlText(detailId)+'" class="digital-attendance-row__details hidden"><dl><div><dt>EMAIL</dt><dd>'+htmlText(ticket.contact_email||'—')+'</dd></div><div><dt>TICKET TYPE</dt><dd>'+htmlText(ticket.ticket_type||ticket.source_type||'—')+'</dd></div><div><dt>TICKET CODE</dt><dd>'+htmlText(ticket.public_code||'—')+'</dd></div><div><dt>TICKET STATUS</dt><dd>'+htmlText(ticket.ticket_status||'—')+'</dd></div><div><dt>ATTENDANCE</dt><dd>'+htmlText(deleted?'DELETED':present?'PRESENT':'NOT ARRIVED')+'</dd></div></dl></div></div><div class="digital-attendance-status">'+(deleted?'DELETED':present?'PRESENT':'NOT ARRIVED')+'</div><div class="attendance-ticket-actions"><label class="digital-attendance-check" title="'+(present?bi('Mark not arrived','Megjelölés: nem érkezett'):bi('Mark arrived','Megjelölés: megérkezett'))+'"><input type="checkbox" '+(present?'checked':'')+' '+(disabled?'disabled':'')+' onchange="setDigitalAttendanceStatus(\''+htmlText(ticket.id)+'\',this.checked?\'PRESENT\':\'NOT_ARRIVED\')"><span aria-hidden="true">'+(present?'✓':'')+'</span></label><button type="button" class="digital-attendance-delete" title="'+bi('Delete guest','Vendég törlése')+'" aria-label="'+bi('Delete guest','Vendég törlése')+'" '+(disabled||deleted?'disabled':'')+' onclick="deleteDigitalAttendanceGuest(\''+htmlText(ticket.id)+'\')">×</button></div></article>';
}
function toggleAttendanceDetails(button){
 const details=button?.closest('.digital-attendance-row')?.querySelector('.digital-attendance-row__details');
 if(!details)return;
 const open=details.classList.toggle('hidden')===false;
 button.setAttribute('aria-expanded',open?'true':'false');
}
function digitalAttendanceSheetMarkup(state){
 const event=state.event||{},title=event.title_en||event.title_hu||'Klavierhaus event',rows=state.tickets||[],closed=Boolean(state.closed),paper=state.mode==='PAPER',pageSize=12,pageCount=Math.max(1,Math.ceil(rows.length/pageSize));
 const controls='<div class="digital-attendance-sheet__toolbar"><div class="digital-attendance-sheet__counts"><span><b>'+Number(state.totals?.total||0)+'</b><small>GUESTS</small></span><span><b>'+Number(state.totals?.present||0)+'</b><small>ARRIVED</small></span><span><b>'+Number(state.totals?.no_show||0)+'</b><small>NOT ARRIVED</small></span><span><b>'+Number(state.totals?.deleted||0)+'</b><small>DELETED</small></span></div><input type="search" placeholder="Search guest, email or code" aria-label="Search guest, email or code" oninput="filterAttendanceRows(this.value)"></div>'+(paper?'<div class="digital-attendance-notice is-paper"><strong>PAPER ATTENDANCE MODE</strong><span>This event is being managed on paper. Digital check-in is disabled until an administrator switches the event back to digital mode.</span></div>':'')+(state.paused?'<div class="digital-attendance-notice is-paused"><strong>ATTENDANCE PAUSED</strong><span>Input is paused. An authorized attendance operator can resume it.</span></div>':'')+(closed?'<div class="digital-attendance-notice is-closed"><strong>ATTENDANCE CLOSED</strong><span>This final attendance sheet is read-only. An administrator can reopen it if a correction is required.</span></div>':'')+'<div class="digital-attendance-sheet__controls">'+(state.can_pause?'<button type="button" class="small ghost-btn" onclick="pauseDigitalAttendance(\''+htmlText(event.id)+'\')">Pause attendance</button>':'')+(state.can_resume?'<button type="button" class="small ghost-btn" onclick="resumeDigitalAttendance(\''+htmlText(event.id)+'\')">Resume attendance</button>':'')+'</div>';
 const pages=Array.from({length:pageCount},(_,index)=>{const pageRows=rows.slice(index*pageSize,(index+1)*pageSize);return '<section class="digital-attendance-sheet" aria-label="Digital attendance sheet page '+(index+1)+'"><header class="digital-attendance-sheet__header"><div class="digital-attendance-sheet__brand"><img src="'+htmlText(branding.logo_url||'/icons/icon-512.png')+'" alt="Klavierhaus logo"><span>KLAVIERHAUS</span></div><div><p class="digital-attendance-sheet__eyebrow">GUEST LIST</p><h2>'+htmlText(title)+'</h2><p>'+htmlText(attendanceDateLabel(event.start_at,event.timezone||'America/New_York'))+' · '+htmlText(event.venue_name||'Klavierhaus')+'</p></div></header><div class="digital-attendance-table"><div class="digital-attendance-table__head"><span>GUEST NAME</span><span>STATUS</span><span>ACTIONS</span></div><div class="digital-attendance-table__body">'+(pageRows.length?pageRows.map(ticket=>digitalAttendanceRowMarkup(ticket,state)).join(''):'<div class="digital-attendance-empty">NO REGISTERED GUESTS</div>')+'</div></div><footer class="digital-attendance-sheet__footer"><span>KLAVIERHAUS · NEW YORK | FRANCE</span><span>'+ (index+1)+' / '+pageCount+'</span></footer></section>';}).join('');
 return '<div class="digital-attendance-modal-content">'+controls+'<div class="digital-attendance-pages">'+pages+'</div></div>';
}
function openDigitalAttendanceModal(state){
 const modal=$('#modal');
 modal.classList.add('digital-attendance-modal-shell');
 modal.classList.remove('hidden');
 $('#modalTitle').textContent='Digital Attendance';
 $('#form').innerHTML=digitalAttendanceSheetMarkup(state);
 injectAttendanceCustomType(state,document.getElementById('form'));
 applyLanguageToDOM(modal);
}
async function renderDigitalAttendance(){
 if(!isAttendanceOperator())return showError('PERMISSION_DENIED');
 const box=$('#digital_attendance');
 box.innerHTML=mobileBackHeader(bi('Digital Attendance','Digitális jelenlétiív'))+'<div class="panel digital-attendance-shell"><div class="toolbar"><div><p class="event-kicker">'+bi('Website & Events','Weboldal és események')+'</p><h2>'+bi('Digital Attendance','Digitális jelenlétiív')+'</h2><p class="muted">'+bi('Select an event card to open its PDF-style interactive attendance sheet.','Válassz eseménykártyát a PDF-stílusú interaktív jelenlétiív megnyitásához.')+'</p></div><button type="button" class="ghost-btn" onclick="renderDigitalAttendance()">'+bi('Refresh','Frissítés')+'</button></div><div data-digital-attendance-state-lists><div class="digital-attendance-loading">'+bi('Loading events…','Események betöltése…')+'</div></div></div>';
 try{
  digitalAttendanceStateCache.clear();
  const events=await api('/api/events'),states=await Promise.all(events.map(async event=>{const state=await api('/api/events/'+encodeURIComponent(event.id)+'/attendance');digitalAttendanceStateCache.set(event.id,state);return state;}));
  renderDigitalAttendanceStateLists(box);
  if(digitalAttendanceSelectedEventId){const selected=digitalAttendanceStateCache.get(digitalAttendanceSelectedEventId);if(selected){openDigitalAttendanceModal(selected);startDigitalAttendanceLiveSync(digitalAttendanceSelectedEventId);}}
 }catch(error){const lists=box.querySelector('[data-digital-attendance-state-lists]');if(lists)lists.innerHTML='<p class="error-text">'+htmlText(localizedErrorMessage(error))+'</p>';}
 applyLanguageToDOM(box);
}
async function openDigitalAttendance(id){
 try{
  const current=await api('/api/events/'+encodeURIComponent(id)+'/attendance');
  if(!current.mode&&current.status!=='CLOSED')await api('/api/events/'+encodeURIComponent(id)+'/attendance/mode',{method:'POST',body:JSON.stringify({mode:'DIGITAL'})});
  digitalAttendanceSelectedEventId=id;await renderDigitalAttendance();
 }catch(error){showError(error)}
}
async function switchDigitalAttendance(id){
 if(!await appConfirm(bi('Switch this event from PAPER to DIGITAL attendance? The paper list should no longer be used for check-in.','Átváltod ezt az eseményt PAPÍR módból DIGITÁLIS jelenlétiívre? A papíralapú lista ezután ne legyen használva érkeztetésre.'),{type:'warning',confirmText:bi('Switch to digital','Váltás digitális módra')}))return;
 try{await api('/api/events/'+encodeURIComponent(id)+'/attendance/mode',{method:'POST',body:JSON.stringify({mode:'DIGITAL'})});digitalAttendanceSelectedEventId=id;await renderDigitalAttendance();}catch(error){showError(error)}
}
async function downloadDigitalAttendancePdf(id){
 return downloadGuestListPdf(id);
}
async function setDigitalAttendanceStatus(ticketId,status){
 const state=digitalAttendanceStateCache.get(digitalAttendanceSelectedEventId),expectedRevision=state?.session?.revision;
 try{const result=await api('/api/events/tickets/'+encodeURIComponent(ticketId)+'/attendance-status',{method:'POST',body:JSON.stringify({status,expected_revision:expectedRevision})});if(result.state)applyDigitalAttendanceLiveState(result.state);showToast(result.attendance_status==='PRESENT'?bi('Guest marked arrived.','A vendég megérkezett.'):bi('Guest marked not arrived.','A vendég visszaállítva: nem érkezett meg.'),'success');}catch(error){if(error.details?.state)applyDigitalAttendanceLiveState(error.details.state);showError(error);}
}
async function deleteDigitalAttendanceGuest(ticketId){
 if(!await appConfirm(bi('Mark this guest as deleted? The record will remain visible and no automatic refund will be started.','Töröljük ezt a vendéget? A rekord látható marad, és automatikus visszatérítés nem indul.'),{type:'warning',confirmText:bi('Mark deleted','Töröltként jelölöm')}))return;
 await setDigitalAttendanceStatus(ticketId,'DELETED');
}
async function pauseDigitalAttendance(id){try{const state=await api('/api/events/'+encodeURIComponent(id)+'/attendance/pause',{method:'POST',body:'{}'});applyDigitalAttendanceLiveState(state);if(eventDetailsAttendanceLiveEventId===String(id))renderAttendancePanel(state,id);showToast(bi('Attendance input paused.','A jelenlétiív rögzítése szünetel.'),'success');}catch(error){showError(error)}}
async function resumeDigitalAttendance(id){try{const state=await api('/api/events/'+encodeURIComponent(id)+'/attendance/resume',{method:'POST',body:'{}'});applyDigitalAttendanceLiveState(state);if(eventDetailsAttendanceLiveEventId===String(id))renderAttendancePanel(state,id);showToast(bi('Attendance input resumed.','A jelenlétiív rögzítése folytatódik.'),'success');}catch(error){showError(error)}}
async function closeDigitalAttendance(id){
 if(!await appConfirm(bi('Close this digital attendance sheet? It will become read-only and the final PDF export will be enabled.','Lezárod ezt a digitális jelenlétiívet? Ezután csak olvasható lesz és engedélyeződik a végleges PDF-export.'),{type:'warning',confirmText:bi('Close attendance','Jelenlétiív lezárása')}))return;
 try{await api('/api/events/'+encodeURIComponent(id)+'/attendance/close',{method:'POST',body:'{}'});const state=await api('/api/events/'+encodeURIComponent(id)+'/attendance');applyDigitalAttendanceLiveState(state);showToast(bi('Attendance sheet closed.','A jelenlétiív lezárva.'),'success');}catch(error){showError(error)}
}
async function reopenDigitalAttendance(id){
 if(!await appConfirm(bi('Reopen this attendance sheet for correction?','Újranyitod a jelenlétiívet javítás céljából?'),{type:'warning',confirmText:bi('Reopen attendance','Jelenlétiív újranyitása')}))return;
 try{const state=await api('/api/events/'+encodeURIComponent(id)+'/attendance/reopen',{method:'POST',body:'{}'});applyDigitalAttendanceLiveState(state);showToast(bi('Attendance sheet reopened.','A jelenlétiív újranyitva.'),'success');}catch(error){showError(error)}
}
let websiteServiceRows=[];
let showroomPianoRows=[];
let websiteReviewRows=[];

async function uploadWebsiteCollectionImage(file){
 if(!(file instanceof File)||!file.size)return '';
 const data=new FormData();data.set('website_image',file,file.name);
 const uploaded=await api('/api/website-content/image',{method:'POST',body:data});
 return uploaded.absolute_url||uploaded.image_url||'';
}
function websiteGalleryText(value){
 let rows=value;
 if(!Array.isArray(rows)){try{rows=JSON.parse(String(value||'[]'))}catch(_error){rows=[]}}
 return (Array.isArray(rows)?rows:[]).map(item=>{const entry=typeof item==='string'?{url:item}:item||{};return [entry.url||entry.image_url||'',entry.alt_en||'',entry.alt_hu||''].join(' | ')}).filter(line=>line.split('|')[0].trim()).join('\n');
}
function adminAssetUrl(value){
 const raw=String(value||'').trim();
 if(!raw)return '';
 if(/^(?:https?:|data:|blob:|\/\/)/i.test(raw))return raw;
 return `/${raw.replace(/^\.?\//,'').replace(/^\/+/,'')}`;
}
function adminImagePreviewMarkup(value,alt='',className=''){
 const url=adminAssetUrl(value),label=htmlText(alt||bi('Image','Kép'));
 return `<div class="admin-image-frame ${htmlText(className)}">${url?`<img src="${htmlText(url)}" alt="${label}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`:''}<span class="admin-image-placeholder"${url?' hidden':''}>${bi('Image unavailable','A kép nem tölthető be')}</span></div>`;
}
async function websiteGalleryPayload(data){
 const gallery=String(data.get('gallery_text')||'').split(/\r?\n/).map(line=>{const [url,alt_en='',alt_hu='']=line.split('|').map(value=>value.trim());return url?{url,alt_en,alt_hu}:null}).filter(Boolean);
 for(const file of data.getAll('gallery_images'))if(file instanceof File&&file.size)gallery.push({url:await uploadWebsiteCollectionImage(file),alt_en:'',alt_hu:''});
 return gallery;
}
function publicCatalogCard(row,type){
 const title=currentLang==='hu'?row.title_hu:row.title_en;
 const summary=currentLang==='hu'?row.summary_hu:row.summary_en;
 const status=type==='piano'?htmlText(row.availability_status):Number(row.visible)?bi('Visible','Látható'):bi('Hidden','Rejtett');
 return `<article class="website-catalog-admin-card">${adminImagePreviewMarkup(row.image_url,title,'catalog-image') }<div><span class="event-status">${status}</span>${Number(row.featured)?`<span class="event-status">${bi('Featured','Kiemelt')}</span>`:''}<h3>${htmlText(title)}</h3>${type==='piano'?`<p class="muted">${htmlText([row.brand,row.model].filter(Boolean).join(' · '))}</p>`:''}<p>${htmlText(summary||'')}</p><small>${htmlText(row.slug_en||'')} · ${htmlText(row.slug_hu||'')}</small></div><div class="actions"><button type="button" class="small" onclick="${type==='piano'?'openShowroomPianoEditor':'openWebsiteServiceEditor'}('${htmlText(row.id)}')">${bi('Edit','Szerkesztés')}</button><button type="button" class="small danger-btn" onclick="deleteWebsiteCatalogRecord('${type}','${htmlText(row.id)}')">${bi('Delete','Törlés')}</button></div></article>`;
}
async function renderWebsiteServices(){
 if(!isAdmin())return showError('PERMISSION_DENIED');websiteServiceRows=await api('/api/website-services');const box=$('#website_services');
 box.innerHTML=`${mobileBackHeader(bi('Services','Szolgáltatások'))}<div class="panel website-catalog-admin"><div class="toolbar"><div><p class="event-kicker">${bi('Technical Operation','Technikai működés')}</p><h2>${bi('Services','Szolgáltatások')}</h2><p class="muted">${bi('Bilingual, price-free service cards with a private consultation call to action.','Kétnyelvű, ár nélküli szolgáltatáskártyák privát konzultációs felhívással.')}</p></div><button type="button" onclick="openWebsiteServiceEditor()">＋ ${bi('New service','Új szolgáltatás')}</button></div><div class="website-catalog-admin-grid">${websiteServiceRows.length?websiteServiceRows.map(row=>publicCatalogCard(row,'service')).join(''):`<div class="empty-state">${bi('No editable services yet.','Még nincs szerkeszthető szolgáltatás.')}</div>`}</div></div>`;
}
function openWebsiteServiceEditor(id=''){
 const row=websiteServiceRows.find(item=>item.id===id)||{};$('#modal').classList.remove('hidden');$('#modalTitle').textContent=id?bi('Edit service','Szolgáltatás szerkesztése'):bi('New service','Új szolgáltatás');
 $('#form').innerHTML=`<div class="form-grid"><div class="field"><label>Title · English *</label><input name="title_en" value="${htmlText(row.title_en||'')}" required></div><div class="field"><label>Cím · Magyar *</label><input name="title_hu" value="${htmlText(row.title_hu||'')}" required></div><div class="field full"><label>Summary · English</label><textarea name="summary_en">${htmlText(row.summary_en||'')}</textarea></div><div class="field full"><label>Összefoglaló · Magyar</label><textarea name="summary_hu">${htmlText(row.summary_hu||'')}</textarea></div><div class="field full"><label>Description · English</label><textarea name="description_en" rows="7">${htmlText(row.description_en||'')}</textarea></div><div class="field full"><label>Leírás · Magyar</label><textarea name="description_hu" rows="7">${htmlText(row.description_hu||'')}</textarea></div><div class="field full event-image-field">${row.image_url?`<img src="${htmlText(row.image_url)}" alt="">`:''}<label>${bi('Service image','Szolgáltatás képe')} *</label><input name="image" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" ${row.image_url?'':'required'}><input name="image_url" type="hidden" value="${htmlText(row.image_url||'')}"></div><div class="field"><label>Image alt · English</label><input name="image_alt_en" value="${htmlText(row.image_alt_en||'')}"></div><div class="field"><label>Kép alt · Magyar</label><input name="image_alt_hu" value="${htmlText(row.image_alt_hu||'')}"></div><div class="field"><label>${bi('Order','Sorrend')}</label><input name="sort_order" type="number" value="${Number(row.sort_order||0)}"></div><label class="check-row"><input name="visible" type="checkbox" ${row.visible===0?'':'checked'}> ${bi('Visible','Látható')}</label><label class="check-row"><input name="featured" type="checkbox" ${Number(row.featured)?'checked':''}> ${bi('Featured','Kiemelt')}</label></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Save service','Szolgáltatás mentése')}</button></div>`;
 $('#form').onsubmit=event=>saveWebsiteService(event,id);applyLanguageToDOM(document.getElementById('modal'));
}
async function saveWebsiteService(event,id=''){
 event.preventDefault();try{const data=new FormData(event.target),file=data.get('image'),body=Object.fromEntries(data);delete body.image;if(file instanceof File&&file.size)body.image_url=await uploadWebsiteCollectionImage(file);body.visible=data.has('visible');body.featured=data.has('featured');body.sort_order=Number(body.sort_order||0);body.build_year=Number(body.build_year)||null;await api(id?`/api/website-services/${encodeURIComponent(id)}`:'/api/website-services',{method:id?'PUT':'POST',body:JSON.stringify(body)});closeModal();showToast(bi('Service published.','A szolgáltatás publikálva.'),'success');await renderWebsiteServices();}catch(error){showError(error)}
}

async function renderShowroomPianos(){
 if(!isAdmin())return showError('PERMISSION_DENIED');showroomPianoRows=await api('/api/showroom-pianos');const box=$('#showroom_pianos');
 box.innerHTML=`${mobileBackHeader(bi('Showroom Pianos','Bemutatott zongorák'))}<div class="panel website-catalog-admin"><div class="toolbar"><div><p class="event-kicker">${bi('Website & events','Weboldal és események')}</p><h2>${bi('Showroom pianos','Bemutatott zongorák')}</h2><p class="muted">${bi('These instruments are independent from customer-owned pianos. No public price is displayed.','Ezek a hangszerek elkülönülnek az ügyfélzongoráktól. Nyilvános ár nem jelenik meg.')}</p></div><button type="button" onclick="openShowroomPianoEditor()">＋ ${bi('New showroom piano','Új bemutatott zongora')}</button></div><div class="website-catalog-admin-grid">${showroomPianoRows.length?showroomPianoRows.map(row=>publicCatalogCard(row,'piano')).join(''):`<div class="empty-state">${bi('No showroom pianos yet.','Még nincs bemutatott zongora.')}</div>`}</div></div>`;
}
function openShowroomPianoEditor(id=''){
 const row=showroomPianoRows.find(item=>item.id===id)||{};$('#modal').classList.remove('hidden');$('#modalTitle').textContent=id?bi('Edit showroom piano','Bemutatott zongora szerkesztése'):bi('New showroom piano','Új bemutatott zongora');
 $('#form').innerHTML=`<div class="form-grid"><div class="field"><label>${bi('Brand','Márka')} *</label><input name="brand" value="${htmlText(row.brand||'')}" required></div><div class="field"><label>${bi('Model','Modell')}</label><input name="model" value="${htmlText(row.model||'')}"></div><div class="field"><label>${bi('Serial number','Gyári szám')}</label><input name="serial_no" value="${htmlText(row.serial_no||'')}"></div><div class="field"><label>${bi('Build year','Gyártási év')}</label><input name="build_year" type="number" min="1700" max="2100" value="${htmlText(row.build_year||'')}"></div><div class="field"><label>${bi('Size (cm)','Méret (cm)')}</label><input name="size_cm" value="${htmlText(row.size_cm||'')}"></div><div class="field"><label>${bi('Size (inch)','Méret (inch)')}</label><input name="size_in" value="${htmlText(row.size_in||'')}"></div><div class="field full steinway-reference-status"><small data-steinway-reference-status></small></div><div class="field"><label>Title · English *</label><input name="title_en" value="${htmlText(row.title_en||'')}" required></div><div class="field"><label>Cím · Magyar *</label><input name="title_hu" value="${htmlText(row.title_hu||'')}" required></div><div class="field full"><label>Summary · English</label><textarea name="summary_en">${htmlText(row.summary_en||'')}</textarea></div><div class="field full"><label>Összefoglaló · Magyar</label><textarea name="summary_hu">${htmlText(row.summary_hu||'')}</textarea></div><div class="field full"><label>Description · English</label><textarea name="description_en" rows="7">${htmlText(row.description_en||'')}</textarea></div><div class="field full"><label>Leírás · Magyar</label><textarea name="description_hu" rows="7">${htmlText(row.description_hu||'')}</textarea></div><div class="field full"><label>${bi('Gallery order — one line per image: URL | English alt | Hungarian alt','Galéria sorrendje — képenként egy sor: URL | angol alt | magyar alt')}</label><textarea name="gallery_text" rows="6">${htmlText(websiteGalleryText(row.gallery_json))}</textarea><small>${bi('Reorder lines to reorder; remove a line to delete an image.','A sorok átrendezésével módosítható a sorrend; egy sor törlésével eltávolítható a kép.')}</small></div><div class="field full event-image-field"><label>${bi('Add gallery images','Galériaképek hozzáadása')}</label><input name="gallery_images" type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png"></div><div class="field full event-image-field">${row.image_url?`<img src="${htmlText(row.image_url)}" alt="">`:''}<label>${bi('Piano image','Zongora képe')} *</label><input name="image" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" ${row.image_url?'':'required'}><input name="image_url" type="hidden" value="${htmlText(row.image_url||'')}"></div><div class="field"><label>Image alt · English</label><input name="image_alt_en" value="${htmlText(row.image_alt_en||'')}"></div><div class="field"><label>Kép alt · Magyar</label><input name="image_alt_hu" value="${htmlText(row.image_alt_hu||'')}"></div><div class="field"><label>${bi('Availability','Elérhetőség')}</label><select name="availability_status">${['AVAILABLE','RESERVED','SOLD','HIDDEN'].map(value=>`<option value="${value}" ${row.availability_status===value?'selected':''}>${value}</option>`).join('')}</select></div><div class="field"><label>${bi('Order','Sorrend')}</label><input name="sort_order" type="number" value="${Number(row.sort_order||0)}"></div><label class="check-row"><input name="published" type="checkbox" ${row.published===0?'':'checked'}> ${bi('Published','Publikált')}</label><label class="check-row"><input name="featured" type="checkbox" ${Number(row.featured)?'checked':''}> ${bi('Featured','Kiemelt')}</label></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Save piano','Zongora mentése')}</button></div>`;
 bindSteinwayReferenceForm(document.getElementById('form'));$('#form').onsubmit=event=>saveShowroomPiano(event,id);applyLanguageToDOM(document.getElementById('modal'));enhanceCustomSelects(document.getElementById('modal'));
}
async function saveShowroomPiano(event,id=''){
 event.preventDefault();try{const data=new FormData(event.target),file=data.get('image'),body=Object.fromEntries(data);delete body.image;delete body.gallery_images;delete body.gallery_text;if(file instanceof File&&file.size)body.image_url=await uploadWebsiteCollectionImage(file);body.gallery=await websiteGalleryPayload(data);body.published=data.has('published');body.featured=data.has('featured');body.sort_order=Number(body.sort_order||0);await api(id?`/api/showroom-pianos/${encodeURIComponent(id)}`:'/api/showroom-pianos',{method:id?'PUT':'POST',body:JSON.stringify(body)});closeModal();showToast(bi('Showroom piano published.','A bemutatott zongora publikálva.'),'success');await renderShowroomPianos();}catch(error){showError(error)}
}

async function renderWebsiteReviews(){
 if(!isAdmin())return showError('PERMISSION_DENIED');websiteReviewRows=await api('/api/website-reviews');const box=$('#website_reviews');
 box.innerHTML=`${mobileBackHeader(bi('Reviews','Vélemények'))}<div class="panel website-catalog-admin"><div class="toolbar"><div><p class="event-kicker">${bi('Marketing · social proof','Marketing · társadalmi bizonyíték')}</p><h2>${bi('Reviews','Vélemények')}</h2><p class="muted">${bi('Portrait-led bilingual reviews displayed in the public carousel.','Portréval ellátott kétnyelvű vélemények a nyilvános lapozható szekcióban.')}</p></div><button type="button" onclick="openWebsiteReviewEditor()">＋ ${bi('New review','Új vélemény')}</button></div><div class="website-catalog-admin-grid">${websiteReviewRows.length?websiteReviewRows.map(row=>`<article class="website-review-admin-card"><img src="${htmlText(row.portrait_url)}" alt=""><div><span class="event-status">${Number(row.visible)?bi('Visible','Látható'):bi('Hidden','Rejtett')}</span><h3>${htmlText(row.person_name)}</h3><p class="muted">${htmlText(currentLang==='hu'?row.role_hu:row.role_en)}</p><blockquote>${htmlText(currentLang==='hu'?row.quote_hu:row.quote_en)}</blockquote></div><div class="actions"><button type="button" class="small" onclick="openWebsiteReviewEditor('${htmlText(row.id)}')">${bi('Edit','Szerkesztés')}</button><button type="button" class="small danger-btn" onclick="deleteWebsiteCatalogRecord('review','${htmlText(row.id)}')">${bi('Delete','Törlés')}</button></div></article>`).join(''):`<div class="empty-state">${bi('No reviews yet.','Még nincs vélemény.')}</div>`}</div></div>`;
}
function openWebsiteReviewEditor(id=''){
 const row=websiteReviewRows.find(item=>item.id===id)||{};$('#modal').classList.remove('hidden');$('#modalTitle').textContent=id?bi('Edit review','Vélemény szerkesztése'):bi('New review','Új vélemény');
 $('#form').innerHTML=`<div class="form-grid"><div class="field"><label>${bi('Name','Név')} *</label><input name="person_name" value="${htmlText(row.person_name||'')}" required></div><div class="field"><label>${bi('Related event ID (optional)','Kapcsolódó eseményazonosító (opcionális)')}</label><input name="linked_event_id" value="${htmlText(row.linked_event_id||'')}"></div><div class="field"><label>Role · English</label><input name="role_en" value="${htmlText(row.role_en||'')}"></div><div class="field"><label>Szerep · Magyar</label><input name="role_hu" value="${htmlText(row.role_hu||'')}"></div><div class="field full"><label>Review · English *</label><textarea name="quote_en" rows="5" required>${htmlText(row.quote_en||'')}</textarea></div><div class="field full"><label>Vélemény · Magyar *</label><textarea name="quote_hu" rows="5" required>${htmlText(row.quote_hu||'')}</textarea></div><div class="field full event-image-field">${row.portrait_url?`<img class="website-review-preview" src="${htmlText(row.portrait_url)}" alt="">`:''}<label>${bi('Portrait','Portré')} *</label><input name="image" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" ${row.portrait_url?'':'required'}><input name="portrait_url" type="hidden" value="${htmlText(row.portrait_url||'')}"></div><div class="field"><label>Portrait alt · English</label><input name="portrait_alt_en" value="${htmlText(row.portrait_alt_en||'')}"></div><div class="field"><label>Portré alt · Magyar</label><input name="portrait_alt_hu" value="${htmlText(row.portrait_alt_hu||'')}"></div><div class="field"><label>${bi('Order','Sorrend')}</label><input name="sort_order" type="number" value="${Number(row.sort_order||0)}"></div><label class="check-row"><input name="visible" type="checkbox" ${row.visible===0?'':'checked'}> ${bi('Visible','Látható')}</label></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Save review','Vélemény mentése')}</button></div>`;
 $('#form').onsubmit=event=>saveWebsiteReview(event,id);applyLanguageToDOM(document.getElementById('modal'));
}
async function saveWebsiteReview(event,id=''){
 event.preventDefault();try{const data=new FormData(event.target),file=data.get('image'),body=Object.fromEntries(data);delete body.image;if(file instanceof File&&file.size)body.portrait_url=await uploadWebsiteCollectionImage(file);body.visible=data.has('visible');body.sort_order=Number(body.sort_order||0);await api(id?`/api/website-reviews/${encodeURIComponent(id)}`:'/api/website-reviews',{method:id?'PUT':'POST',body:JSON.stringify(body)});closeModal();showToast(bi('Review published.','A vélemény publikálva.'),'success');await renderWebsiteReviews();}catch(error){showError(error)}
}
async function deleteWebsiteCatalogRecord(type,id){
 if(!await appConfirm(bi('Delete this website record permanently?','Véglegesen töröljük ezt a weboldali rekordot?'),{type:'error',confirmText:bi('Delete','Törlés')}))return;
 const route=type==='review'?'website-reviews':type==='piano'?'showroom-pianos':'website-services';try{await api(`/api/${route}/${encodeURIComponent(id)}`,{method:'DELETE'});showToast(bi('Record deleted.','A rekord törölve.'),'success');if(type==='review')await renderWebsiteReviews();else if(type==='piano')await renderShowroomPianos();else await renderWebsiteServices();}catch(error){showError(error)}
}

let websiteArtistRows=[];
let websiteMediaRows=[];
function websiteAssetUrl(value){return adminAssetUrl(value);}
function websiteAdminCard(row,type){
 const title=type==='artist'?row.name:row.file_name;
 const image=type==='artist'?row.portrait_url:row.file_url;
 const meta=type==='artist'?(currentLang==='hu'?row.role_hu:row.role_en):`${row.width||0}×${row.height||0} · ${Math.round(Number(row.file_size||0)/1024)} KB`;
 return `<article class="website-catalog-admin-card">${adminImagePreviewMarkup(image,title,'catalog-image')}<div><span class="event-status">${type==='artist'?(Number(row.published)?bi('Published','Publikált'):bi('Draft','Piszkozat')):htmlText(row.usage_type||'GENERAL')}</span><h3>${htmlText(title)}</h3><p class="muted">${htmlText(meta||'')}</p></div><div class="actions"><button type="button" class="small" onclick="${type==='artist'?'openWebsiteArtistEditor':'openWebsiteMediaEditor'}('${htmlText(row.id)}')">${bi('Edit','Szerkesztés')}</button>${type==='artist'?`<button type="button" class="small danger-btn" onclick="deleteWebsiteArtist('${htmlText(row.id)}')">${bi('Delete','Törlés')}</button>`:`<button type="button" class="small danger-btn" onclick="deleteWebsiteMedia('${htmlText(row.id)}')">${bi('Delete','Törlés')}</button>`}</div></article>`;
}
async function renderWebsiteArtists(){
 if(!isAdmin())return showError('PERMISSION_DENIED');websiteArtistRows=await api('/api/website-artists');const box=$('#website_artists');
 box.innerHTML=`${mobileBackHeader(bi('Artists','Művészek'))}<div class="panel website-catalog-admin"><div class="toolbar"><div><p class="event-kicker">${bi('Website & events','Weboldal és események')}</p><h2>${bi('Artists','Művészek')}</h2><p class="muted">${bi('Portrait-led bilingual profiles connected to public programmes.','Portréval ellátott kétnyelvű profilok, a nyilvános programokhoz kapcsolva.')}</p></div><button type="button" onclick="openWebsiteArtistEditor()">＋ ${bi('New artist','Új művész')}</button></div><div class="website-catalog-admin-grid">${websiteArtistRows.length?websiteArtistRows.map(row=>websiteAdminCard(row,'artist')).join(''):`<div class="empty-state">${bi('No artist profiles yet.','Még nincs művészprofil.')}</div>`}</div></div>`;applyLanguageToDOM(box);
}
function openWebsiteArtistEditor(id=''){
 const row=websiteArtistRows.find(item=>item.id===id)||{};$('#modal').classList.remove('hidden');$('#modalTitle').textContent=id?bi('Edit artist','Művész szerkesztése'):bi('New artist','Új művész');
 $('#form').innerHTML=`<div class="form-grid"><div class="field full"><label>${bi('Artist name','Művész neve')} *</label><input name="name" value="${htmlText(row.name||'')}" required></div><div class="field"><label>Role · English</label><input name="role_en" value="${htmlText(row.role_en||'')}"></div><div class="field"><label>Szerep · Magyar</label><input name="role_hu" value="${htmlText(row.role_hu||'')}"></div><div class="field full"><label>Biography · English</label><textarea name="biography_en" rows="6">${htmlText(row.biography_en||'')}</textarea></div><div class="field full"><label>Életrajz · Magyar</label><textarea name="biography_hu" rows="6">${htmlText(row.biography_hu||'')}</textarea></div><div class="field full"><label>${bi('Gallery order — one line per image: URL | English alt | Hungarian alt','Galéria sorrendje — képenként egy sor: URL | angol alt | magyar alt')}</label><textarea name="gallery_text" rows="6">${htmlText(websiteGalleryText(row.gallery_json))}</textarea><small>${bi('Reorder lines to reorder; remove a line to delete an image.','A sorok átrendezésével módosítható a sorrend; egy sor törlésével eltávolítható a kép.')}</small></div><div class="field full event-image-field"><label>${bi('Add gallery images','Galériaképek hozzáadása')}</label><input name="gallery_images" type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png"></div><div class="field full event-image-field">${row.portrait_url?`<img class="website-review-preview" src="${htmlText(row.portrait_url)}" alt="">`:''}<label>${bi('Portrait — drop or select JPG/PNG','Portré — húzd ide vagy válassz JPG/PNG képet')} *</label><input name="image" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" ${row.portrait_url?'':'required'}><input name="portrait_url" type="hidden" value="${htmlText(row.portrait_url||'')}"></div><div class="field"><label>Image alt · English</label><input name="portrait_alt_en" value="${htmlText(row.portrait_alt_en||'')}"></div><div class="field"><label>Kép alt · Magyar</label><input name="portrait_alt_hu" value="${htmlText(row.portrait_alt_hu||'')}"></div><div class="field"><label>${bi('Order','Sorrend')}</label><input name="sort_order" type="number" value="${Number(row.sort_order||0)}"></div><label class="check-row"><input name="featured" type="checkbox" ${row.featured===0?'':'checked'}> ${bi('Featured','Kiemelt')}</label><label class="check-row"><input name="published" type="checkbox" ${row.published===0?'':'checked'}> ${bi('Published','Publikált')}</label></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Save artist','Művész mentése')}</button></div>`;
 $('#form').onsubmit=event=>saveWebsiteArtist(event,id);applyLanguageToDOM(document.getElementById('modal'));enhanceWebsiteFileInputs(document.getElementById('modal'));
}
async function saveWebsiteArtist(event,id=''){event.preventDefault();try{const data=new FormData(event.target),file=data.get('image'),body=Object.fromEntries(data);delete body.image;delete body.gallery_images;delete body.gallery_text;if(file instanceof File&&file.size)body.portrait_url=await uploadWebsiteCollectionImage(file);body.gallery=await websiteGalleryPayload(data);body.featured=data.has('featured');body.published=data.has('published');body.sort_order=Number(body.sort_order||0);await api(id?`/api/website-artists/${encodeURIComponent(id)}`:'/api/website-artists',{method:id?'PUT':'POST',body:JSON.stringify(body)});closeModal();showToast(bi('Artist saved.','A művész mentve.'),'success');await renderWebsiteArtists();}catch(error){showError(error)}}
async function deleteWebsiteArtist(id){if(!await appConfirm(bi('Delete this artist profile?','Töröljük ezt a művészprofilt?'),{type:'error',confirmText:bi('Delete','Törlés')}))return;try{await api(`/api/website-artists/${encodeURIComponent(id)}`,{method:'DELETE'});showToast(bi('Artist deleted.','A művész törölve.'),'success');await renderWebsiteArtists();}catch(error){showError(error)}}

async function renderWebsiteMedia(){
 if(!isAdmin())return showError('PERMISSION_DENIED');websiteMediaRows=await api('/api/website-media');const box=$('#media_library');
 box.innerHTML=`${mobileBackHeader(bi('Media Library','Médiatár'))}<div class="panel website-catalog-admin"><div class="toolbar"><div><p class="event-kicker">${bi('Website & events','Weboldal és események')}</p><h2>${bi('Media Library','Médiatár')}</h2><p class="muted">${bi('Reusable images with bilingual alternative text.','Újra felhasználható képek kétnyelvű alternatív szöveggel.')}</p></div><button type="button" onclick="openWebsiteMediaUpload()">＋ ${bi('Upload image','Kép feltöltése')}</button></div><div class="website-catalog-admin-grid">${websiteMediaRows.length?websiteMediaRows.map(row=>websiteAdminCard(row,'media')).join(''):`<div class="empty-state">${bi('No uploaded media yet.','Még nincs feltöltött média.')}</div>`}</div></div>`;applyLanguageToDOM(box);
}
function openWebsiteMediaUpload(){
 $('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Upload media','Média feltöltése');$('#form').innerHTML=`<div class="form-grid"><div class="field full event-image-field"><label>${bi('Image — drag and drop or select','Kép — húzd ide vagy válaszd ki')} *</label><input name="website_image" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" required></div><div class="field"><label>Alt · English</label><input name="alt_en" required></div><div class="field"><label>Alt · Magyar</label><input name="alt_hu" required></div><div class="field"><label>${bi('Usage','Felhasználás')}</label><select name="usage_type"><option value="GENERAL">${bi('General','Általános')}</option><option value="ARTIST">${bi('Artist','Művész')}</option><option value="PIANO">${bi('Piano','Zongora')}</option><option value="EVENT">${bi('Event','Esemény')}</option><option value="SERVICE">${bi('Service','Szolgáltatás')}</option></select></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Upload','Feltöltés')}</button></div>`;$('#form').onsubmit=uploadWebsiteMedia;applyLanguageToDOM(document.getElementById('modal'));enhanceWebsiteFileInputs(document.getElementById('modal'));
}
async function uploadWebsiteMedia(event){event.preventDefault();try{await api('/api/website-media',{method:'POST',body:new FormData(event.target)});closeModal();showToast(bi('Image uploaded.','A kép feltöltve.'),'success');await renderWebsiteMedia();}catch(error){showError(error)}}
function openWebsiteMediaEditor(id){const row=websiteMediaRows.find(item=>item.id===id);if(!row)return;$('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Edit media metadata','Médiaadatok szerkesztése');$('#form').innerHTML=`<div class="form-grid"><div class="field full"><img class="website-review-preview" src="${htmlText(row.file_url)}" alt=""></div><div class="field"><label>Alt · English</label><input name="alt_en" value="${htmlText(row.alt_en||'')}"></div><div class="field"><label>Alt · Magyar</label><input name="alt_hu" value="${htmlText(row.alt_hu||'')}"></div><div class="field"><label>${bi('Usage','Felhasználás')}</label><input name="usage_type" value="${htmlText(row.usage_type||'GENERAL')}"></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Save','Mentés')}</button></div>`;$('#form').onsubmit=async event=>{event.preventDefault();try{await api(`/api/website-media/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(event.target))) });closeModal();await renderWebsiteMedia();}catch(error){showError(error)}};}
async function deleteWebsiteMedia(id){if(!await appConfirm(bi('Permanently delete this media file? Existing pages that use it must be updated separately.','Véglegesen töröljük ezt a médiafájlt? Az ezt használó oldalakat külön kell módosítani.'),{type:'error',confirmText:bi('Delete media','Média törlése')}))return;try{await api(`/api/website-media/${encodeURIComponent(id)}`,{method:'DELETE'});showToast(bi('Media deleted.','A média törölve.'),'success');await renderWebsiteMedia();}catch(error){showError(error)}}



const SYSTEM_INTEGRATION_NAMES={GOOGLE_CALENDAR:'Google Calendar',GA4:'Google Analytics 4',CLARITY:'Microsoft Clarity',SEARCH_CONSOLE:'Google Search Console',RESEND:'Resend',STRIPE:'Stripe Sandbox'};
function systemIntegrationConfigFields(row){const p=row.provider,c=row.config||{},disabled=!window.__systemIntegrations?.enabled||!row.enabled||!window.__systemIntegrations?.can_edit?'disabled':'';if(p==='GOOGLE_CALENDAR')return `<label>${bi('Calendar ID (environment-managed)','Naptár-azonosító (környezeti beállítás)')}<input value="${htmlText(c.calendar_id||'')}" disabled></label><label>${bi('Central email (environment-managed)','Központi e-mail (környezeti beállítás)')}<input value="${htmlText(c.central_email||'')}" disabled></label>`;if(p==='GA4')return `<label>Measurement ID<input data-system-config="measurement_id" ${disabled} value="${htmlText(c.measurement_id||'')}" placeholder="G-XXXXXXXX"></label>`;if(p==='CLARITY')return `<label>Project ID<input data-system-config="project_id" ${disabled} value="${htmlText(c.project_id||'')}"></label>`;if(p==='SEARCH_CONSOLE')return `<label>${bi('Property URL','Tulajdon URL')}<input data-system-config="property_url" ${disabled} value="${htmlText(c.property_url||'')}" placeholder="https://example.com/ or sc-domain:example.com"></label>`;if(p==='RESEND')return `<label>From<input data-system-config="from_email" ${disabled} value="${htmlText(c.from_email||'')}"></label><label>Event From<input data-system-config="event_from_email" ${disabled} value="${htmlText(c.event_from_email||'')}"></label><label>Reply-to<input data-system-config="reply_to" ${disabled} value="${htmlText(c.reply_to||'')}"></label>`;if(p==='STRIPE')return `<label>${bi('Publishable key','Publikus kulcs')}<input data-system-config="publishable_key" ${disabled} value="${htmlText(c.publishable_key||'')}" placeholder="pk_test_..."></label>`;return '';}
function systemSecretFields(row){if(!['GA4','RESEND','STRIPE'].includes(row.provider))return '';const disabled=!window.__systemIntegrations?.enabled||!row.enabled||!window.__systemIntegrations?.can_edit?'disabled':'';const eye=window.__systemIntegrations?.can_reveal?`<button type="button" class="ghost-btn" data-system-action="reveal" aria-label="${bi('Show secret for 30 seconds','Titok megjelenítése 30 másodpercre')}">👁</button>`:'';if(row.provider==='STRIPE')return `<label class="system-secret-field">Stripe secret key<div class="system-secret-input"><input type="password" data-system-secret="secret_key" ${disabled} autocomplete="new-password" placeholder="${htmlText(row.secret_hint||'sk_test_••••')}">${eye}</div></label><label class="system-secret-field">Webhook secret<div class="system-secret-input"><input type="password" data-system-secret="webhook_secret" ${disabled} autocomplete="new-password" placeholder="whsec_••••"></div></label>`;const key=row.provider==='RESEND'?'api_key':'api_secret';return `<label class="system-secret-field">${bi('Secret / API key','Titok / API-kulcs')}<div class="system-secret-input"><input type="password" data-system-secret="${key}" ${disabled} autocomplete="new-password" placeholder="${htmlText(row.secret_hint||'')}">${eye}</div></label>`;}
function systemIntegrationCard(row){const payload=window.__systemIntegrations||{},actionsDisabled=!payload.enabled||!row.enabled,testEmail=row.provider==='RESEND'?`<label>${bi('Test email address','Teszt e-mail-cím')}<input type="email" data-system-test-email ${actionsDisabled?'disabled':''}></label>`:'';const providerToggle=isSuperadmin()?`<label class="system-provider-toggle"><input type="checkbox" data-system-action="toggle-provider" ${row.enabled?'checked':''}> ${row.enabled?bi('Enabled','Bekapcsolva'):bi('Disabled','Kikapcsolva')}</label>`:'';return `<article class="system-integration-card ${row.enabled?'':'is-disabled'}" data-provider="${htmlText(row.provider)}"><header><div><p class="event-kicker">${htmlText(SYSTEM_INTEGRATION_NAMES[row.provider]||row.provider)}</p><h3>${htmlText(row.status||'DISCONNECTED')}</h3></div>${providerToggle}<span class="integration-status ${row.status==='CONNECTED'?'connected':row.status==='ERROR'?'error':'disconnected'}">${htmlText(row.status||'DISCONNECTED')}</span></header><div class="system-integration-grid">${systemIntegrationConfigFields(row)}${systemSecretFields(row)}${testEmail}</div><dl class="system-integration-meta"><div><dt>${bi('Last test','Utolsó teszt')}</dt><dd>${htmlText(row.last_tested_at||'—')}</dd></div><div><dt>${bi('Last successful test','Utolsó sikeres teszt')}</dt><dd>${htmlText(row.last_success_at||'—')}</dd></div><div><dt>${bi('Last connection','Utolsó kapcsolat')}</dt><dd>${htmlText(row.last_connection_at||'—')}</dd></div><div><dt>${bi('Last error','Utolsó hiba')}</dt><dd>${htmlText(row.last_error||'—')}</dd></div></dl><footer class="actions"><button type="button" data-system-action="save" ${actionsDisabled||!payload.can_edit?'disabled':''}>${bi('Save','Mentés')}</button>${row.provider==='GOOGLE_CALENDAR'&&isSuperadmin()?`<button type="button" class="ghost-btn" onclick="connectGoogleCalendar()" ${actionsDisabled?'disabled':''}>${bi('Connect / reconnect','Csatlakoztatás / újracsatlakoztatás')}</button>`:''}<button type="button" class="ghost-btn" data-system-action="test" ${actionsDisabled||!payload.can_test?'disabled':''}>${bi('Run test','Teszt futtatása')}</button>${isSuperadmin()&&['GA4','RESEND','STRIPE'].includes(row.provider)?`<button type="button" class="ghost-btn" data-system-action="clear-secret" ${actionsDisabled?'disabled':''}>${bi('Clear secret','Titok törlése')}</button>`:''}${isSuperadmin()?`<button type="button" class="danger-btn" data-system-action="delete">${bi('Delete integration','Integráció törlése')}</button>`:''}</footer></article>`;}
async function renderSystemIntegrations(){if(!isAdmin())return showError('PERMISSION_DENIED');const box=$('#system_integrations');try{const payload=await api('/api/system-integrations');window.__systemIntegrations=payload;box.innerHTML=`${mobileBackHeader(bi('System Activation & Integrations','Rendszeraktiválás és integrációk'))}<div class="panel system-integrations-page"><div class="toolbar"><div><p class="event-kicker">Technical Operation</p><h2>${bi('System Activation & Integrations','Rendszeraktiválás és integrációk')}</h2><p class="muted">${bi('Centralized provider activation, encrypted secrets, tests and connection health.','Központi szolgáltatóaktiválás, titkosított kulcsok, tesztek és kapcsolatállapot.')}</p></div>${isSuperadmin()?`<label class="system-master-toggle"><input id="systemIntegrationsEnabled" type="checkbox" ${payload.enabled?'checked':''}> ${payload.enabled?bi('System enabled','Rendszer bekapcsolva'):bi('System disabled','Rendszer kikapcsolva')}</label>`:`<strong>${payload.enabled?bi('Enabled by Superadmin','Superadmin által bekapcsolva'):bi('Disabled by Superadmin','Superadmin által kikapcsolva')}</strong>`}</div>${payload.encryption_ready?'':`<div class="settings-warning">${bi('Dedicated SYSTEM_INTEGRATION_ENCRYPTION_KEY is not configured. Secret changes are unavailable, but the ERP remains operational.','A dedikált SYSTEM_INTEGRATION_ENCRYPTION_KEY nincs beállítva. A titkok módosítása nem elérhető, az ERP azonban tovább működik.')}</div>`}<div class="system-integration-cards">${(payload.providers||[]).map(systemIntegrationCard).join('')}</div></div>`;document.getElementById('systemIntegrationsEnabled')?.addEventListener('change',async event=>{try{await api('/api/system-integrations/control',{method:'PUT',body:JSON.stringify({enabled:event.target.checked})});await renderSystemIntegrations();}catch(error){showError(error)}});box.querySelectorAll('.system-integration-card').forEach(card=>card.addEventListener('click',handleSystemIntegrationAction));applyLanguageToDOM(box);const qs=new URLSearchParams(location.search);if(qs.get('googleCalendarTest')==='authorized'){history.replaceState({},'',location.pathname);setTimeout(()=>runGoogleCalendarAuthorizedTest(),50);}}catch(error){showError(error);}}
function systemCardConfig(card){return Object.fromEntries([...card.querySelectorAll('[data-system-config]')].map(input=>[input.dataset.systemConfig,input.value.trim()]));}
function systemCardSecrets(card){return Object.fromEntries([...card.querySelectorAll('[data-system-secret]')].filter(input=>input.value).map(input=>[input.dataset.systemSecret,input.value]));}
async function runGoogleCalendarAuthorizedTest(){try{await api('/api/system-integrations/GOOGLE_CALENDAR/test',{method:'POST',body:'{}'});showToast(bi('Temporary Google Calendar event was created and deleted successfully.','Az ideiglenes Google Calendar esemény létrehozása és törlése sikeres.'),'success');await renderSystemIntegrations();}catch(error){showError(error);}}
async function handleSystemIntegrationAction(event){const button=event.target.closest('[data-system-action]');if(!button)return;const card=button.closest('.system-integration-card'),provider=card?.dataset.provider;if(!provider)return;button.disabled=true;try{if(button.dataset.systemAction==='toggle-provider'){await api(`/api/system-integrations/${encodeURIComponent(provider)}/enabled`,{method:'PUT',body:JSON.stringify({enabled:button.checked})});await renderSystemIntegrations();return;}if(button.dataset.systemAction==='save'){await api(`/api/system-integrations/${encodeURIComponent(provider)}`,{method:'PUT',body:JSON.stringify({config:systemCardConfig(card),secrets:systemCardSecrets(card)})});showToast(bi('Integration saved and applied to the running service.','Integráció mentve és alkalmazva a futó szolgáltatásra.'),'success');await renderSystemIntegrations();}else if(button.dataset.systemAction==='test'){const test_email=card.querySelector('[data-system-test-email]')?.value||'';try{await api(`/api/system-integrations/${encodeURIComponent(provider)}/test`,{method:'POST',body:JSON.stringify({test_email})});showToast(bi('Integration test succeeded.','Az integrációs teszt sikeres.'),'success');await renderSystemIntegrations();}catch(error){if(provider==='GOOGLE_CALENDAR'&&String(error.message||error).includes('GOOGLE_CALENDAR_TEST_WRITE_AUTH_REQUIRED')){const auth=await api('/api/system-integrations/GOOGLE_CALENDAR/test-auth-url');location.href=auth.url;return;}throw error;}}else if(button.dataset.systemAction==='reveal'){const inputs=[...card.querySelectorAll('[data-system-secret]')];if(inputs.some(input=>input.dataset.revealed==='true')){inputs.forEach(input=>{input.type='password';input.value='';input.dataset.revealed='false'});button.textContent='👁';return;}const result=await api(`/api/system-integrations/${encodeURIComponent(provider)}/secret`),secrets=result.secrets||{};inputs.forEach(input=>{input.type='text';input.value=secrets[input.dataset.systemSecret]||'';input.dataset.revealed='true'});button.textContent='◉';setTimeout(()=>{inputs.forEach(input=>{if(input.dataset.revealed==='true'){input.type='password';input.value='';input.dataset.revealed='false'}});button.textContent='👁';},Math.min(30000,Number(result.expires_in_seconds||30)*1000));}else if(button.dataset.systemAction==='clear-secret'){if(await appConfirm(bi('Remove the stored secret for this integration?','Töröljük az integráció tárolt titkát?'),{type:'warning',confirmText:bi('Clear secret','Titok törlése')})){await api(`/api/system-integrations/${encodeURIComponent(provider)}`,{method:'PUT',body:JSON.stringify({config:systemCardConfig(card),clear_secret:true})});await renderSystemIntegrations();}}else if(button.dataset.systemAction==='delete'){const preview=await api(`/api/system-integrations/${encodeURIComponent(provider)}/delete-preview`,{method:'POST',body:'{}'}),counts=Object.entries(preview.counts||{}).map(([key,value])=>`${key}: ${value}`).join('\n'),typed=await appPrompt(`${bi('An external safety backup will be created. Records:','Külső biztonsági mentés készül. Rekordok:')}\n${counts}\n\n${bi('Type exactly','Írd be pontosan')}: ${preview.confirmation_text}`,{type:'error',confirmText:bi('Delete integration','Integráció törlése')});if(typed!==preview.confirmation_text)return;const result=await api(`/api/system-integrations/${encodeURIComponent(provider)}`,{method:'DELETE',body:JSON.stringify({confirmation_token:preview.confirmation_token,confirmation_text:typed})});await appAlert(`${bi('Integration deleted and verified. Backup ID','Integráció törölve és ellenőrizve. Mentésazonosító')}: ${result.backup_id}`,'success');await renderSystemIntegrations();}}catch(error){showError(error);}finally{if(button.isConnected)button.disabled=false;}}

async function renderWebsiteLeads(view='website_contacts',status=''){
 if(!isAdmin())return showError('PERMISSION_DENIED');const leadStatuses=['NEW','CONTACTED','IN_DISCUSSION','APPOINTMENT_SCHEDULED','CLOSED','REJECTED'],[rows,leadWorkers]=await Promise.all([api(`/api/website-contact-leads${status?`?status=${encodeURIComponent(status)}`:''}`),api('/api/schedule-workers')]),box=$(`#${view}`);window.__websiteLeadWorkers=leadWorkers;
 box.innerHTML=`${mobileBackHeader(bi('Website contacts','Weboldali érdeklődők'))}<div class="panel"><div class="toolbar"><div><p class="event-kicker">${bi('Website & events','Weboldal és események')}</p><h2>${bi('Contact requests','Kapcsolatfelvételek')}</h2><p class="muted">${bi('Real enquiries only. No enquiry automatically becomes an ERP calendar job.','Csak valós érdeklődések. Egyik érdeklődésből sem lesz automatikusan ERP-naptármunka.')}</p></div><label>${bi('Status filter','Állapotszűrő')}<select onchange="renderWebsiteLeads('${htmlText(view)}',this.value)"><option value="">${bi('All statuses','Minden állapot')}</option>${leadStatuses.map(value=>`<option value="${value}" ${status===value?'selected':''}>${value}</option>`).join('')}</select></label></div><div class="table-wrap"><table><thead><tr><th>${bi('Created','Létrehozva')}</th><th>${bi('Name','Név')}</th><th>${bi('Contact','Elérhetőség')}</th><th>${bi('Request','Megkeresés')}</th><th>${bi('Status','Állapot')}</th><th>${bi('Actions','Műveletek')}</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${htmlText(row.created_at||'')}</td><td>${htmlText(row.name)}</td><td>${htmlText(row.email)}<br>${htmlText(row.phone||'')}</td><td>${htmlText(row.message||row.lead_type)}</td><td>${htmlText(row.status)}</td><td><button class="small" onclick="openWebsiteLead('${htmlText(row.id)}','${htmlText(view)}')">${bi('Manage','Kezelés')}</button></td></tr>`).join('')||`<tr><td colspan="6">${bi('No contact requests.','Nincs kapcsolatfelvétel.')}</td></tr>`}</tbody></table></div></div>`;window.__websiteLeads=rows;applyLanguageToDOM(box);
}
function openWebsiteLead(id,view){const row=(window.__websiteLeads||[]).find(item=>item.id===id),leadWorkers=window.__websiteLeadWorkers||[];if(!row)return;$('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Manage contact request','Kapcsolatfelvétel kezelése');const details=[[bi('Piano','Zongora'),[row.piano_brand,row.piano_model].filter(Boolean).join(' ')],[bi('Address','Cím'),row.service_address],[bi('Preferred time','Kapcsolatfelvétel ideje'),row.preferred_time],[bi('Event date','Rendezvény dátuma'),row.event_date],[bi('Event venue','Rendezvény helyszíne'),row.event_venue],[bi('Rental duration','Bérlés időtartama'),row.rental_duration],[bi('Instrument requirements','Hangszerigény'),row.instrument_requirements]].filter(([,value])=>value).map(([label,value])=>`<p><b>${htmlText(label)}:</b> ${htmlText(value)}</p>`).join('');$('#form').innerHTML=`<div class="form-grid"><div class="field full"><p><b>${htmlText(row.name)}</b><br>${htmlText(row.email)} · ${htmlText(row.phone||'')}</p>${details}<p><b>${bi('Message','Megjegyzés')}:</b> ${htmlText(row.message||'')}</p></div><div class="field"><label>${bi('Status','Állapot')}</label><select name="status">${['NEW','CONTACTED','IN_DISCUSSION','APPOINTMENT_SCHEDULED','CLOSED','REJECTED'].map(value=>`<option ${row.status===value?'selected':''}>${value}</option>`).join('')}</select></div><div class="field"><label>${bi('Assigned colleague','Felelős munkatárs')}</label><select name="assigned_user_id"><option value="">${bi('Unassigned','Nincs kijelölve')}</option>${leadWorkers.map(worker=>`<option value="${htmlText(worker.id)}" ${row.assigned_user_id===worker.id?'selected':''}>${htmlText(worker.name)}</option>`).join('')}</select></div><div class="field"><label>${bi('Contact date','Kapcsolatfelvétel dátuma')}</label><input name="contact_date" type="datetime-local" value="${htmlText(String(row.contact_date||'').slice(0,16))}"></div><div class="field"><label>${bi('Agreed appointment','Egyeztetett időpont')}</label><input name="agreed_appointment_at" type="datetime-local" value="${htmlText(String(row.agreed_appointment_at||'').slice(0,16))}"></div><div class="field full"><label>${bi('Internal notes','Belső megjegyzés')}</label><textarea name="internal_notes" rows="5">${htmlText(row.internal_notes||'')}</textarea></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Save','Mentés')}</button></div>`;$('#form').onsubmit=async event=>{event.preventDefault();try{await api(`/api/website-contact-leads/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});closeModal();await renderWebsiteLeads(view);}catch(error){showError(error)}};}

function integrationCard(row){
 const labels={GA4:'Google Analytics 4',SEARCH_CONSOLE:'Google Search Console',GOOGLE_OAUTH:'Google OAuth',CLARITY:'Microsoft Clarity'};
 return `<article class="integration-admin-card"><div><p class="event-kicker">${htmlText(labels[row.provider]||row.provider)}</p><h3>${htmlText(row.status||'DISCONNECTED')}</h3><p class="muted">${row.last_tested_at?`${bi('Last test','Utolsó teszt')}: ${htmlText(row.last_tested_at)}`:bi('Not tested yet.','Még nem volt tesztelve.')}</p>${row.last_error?`<p class="error-text">${htmlText(row.last_error)}</p>`:''}</div><div class="actions"><button class="small" onclick="openMarketingIntegration('${htmlText(row.provider)}')">${bi('Configure','Beállítás')}</button><button class="small ghost-btn" onclick="testMarketingIntegration('${htmlText(row.provider)}')">${bi('Test','Teszt')}</button>${row.provider==='GOOGLE_OAUTH'&&isSuperadmin()?`<button class="small" onclick="connectMarketingGoogle()">${row.status==='CONNECTED'?bi('Reconnect','Újracsatlakoztatás'):bi('Connect Google','Google csatlakoztatása')}</button>`:''}${row.provider==='GOOGLE_OAUTH'&&row.status==='CONNECTED'?`<button class="small ghost-btn" onclick="syncMarketingGoogleResources()">${bi('Sync resources','Erőforrások szinkronja')}</button>`:''}</div></article>`;
}
async function renderMarketingOverview(){
 if(!isAdmin())return showError('PERMISSION_DENIED');const data=await api('/api/marketing/overview'),box=$('#marketing_overview');
 const metrics=data.metrics||[],leadTotal=(data.leads||[]).reduce((sum,row)=>sum+Number(row.count||0),0),moduleCards=(window.__adminModules?.modules||[]).map(module=>`<article class="admin-module-card"><div><p class="event-kicker">${htmlText(module.group)}</p><h3>${htmlText(currentLang==='hu'?module.label_hu:module.label_en)}</h3><span class="integration-status ${module.enabled?'connected':'disconnected'}">${module.enabled?bi('Enabled','Bekapcsolva'):bi('Disabled','Kikapcsolva')}</span></div>${isSuperadmin()?`<button type="button" class="small ${module.enabled?'danger-btn':'ghost-btn'}" onclick="toggleAdminModule('${htmlText(module.key)}',${module.enabled?'false':'true'})">${module.enabled?bi('Disable','Kikapcsolás'):bi('Enable','Bekapcsolás')}</button>`:''}</article>`).join('');
 box.innerHTML=`${mobileBackHeader(bi('Campaign Overview','Kampányáttekintő'))}<div class="panel marketing-shell"><div class="toolbar"><div><p class="event-kicker">${bi('Verified data only','Csak ellenőrzött adatok')}</p><h2>${bi('Campaign Overview','Kampányáttekintő')}</h2><p class="muted">${bi('Disconnected providers remain visibly disconnected; this dashboard never invents performance data.','A nem csatlakoztatott szolgáltatók láthatóan leválasztva maradnak; ez az áttekintő nem talál ki teljesítményadatokat.')}</p></div><div class="actions"><button class="ghost-btn" onclick="installWebsiteSamples()">${bi('Install editable samples','Szerkeszthető minták telepítése')}</button>${isSuperadmin()?`<button class="danger-btn" onclick="removeWebsiteSamples()">${bi('Remove sample content','Mintatartalom eltávolítása')}</button>`:''}</div></div><section class="admin-module-grid">${moduleCards}</section><div class="marketing-kpis"><article><small>${bi('Website leads','Weboldali érdeklődők')}</small><strong>${leadTotal}</strong></article><article><small>${bi('Event return requests','Esemény-újraigénylések')}</small><strong>${Number(data.event_interest?.requests||0)}</strong></article><article><small>${bi('Consented measured actions','Hozzájárult mért műveletek')}</small><strong>${metrics.reduce((sum,row)=>sum+Number(row.count||0),0)}</strong></article></div><div class="integration-admin-grid">${(data.integrations||[]).map(integrationCard).join('')}</div><div class="table-wrap"><table><thead><tr><th>${bi('Measured action','Mért művelet')}</th><th>${bi('Count','Darab')}</th><th>${bi('Anonymous sessions','Anonim munkamenetek')}</th></tr></thead><tbody>${metrics.map(row=>`<tr><td>${htmlText(row.event_name)}</td><td>${Number(row.count||0)}</td><td>${Number(row.unique_sessions||0)}</td></tr>`).join('')||`<tr><td colspan="3">${bi('No consented first-party measurements yet.','Még nincs hozzájárult belső mérési adat.')}</td></tr>`}</tbody></table></div></div>`;applyLanguageToDOM(box);
}
async function toggleAdminModule(key,enabled){if(!isSuperadmin())return showError('SUPERADMIN_REQUIRED');try{await api(`/api/admin/modules/${encodeURIComponent(key)}`,{method:'PUT',body:JSON.stringify({enabled})});await loadAdminModuleState();renderNavigation();await render(currentView,{noHistory:true});}catch(error){showError(error)}}
// Automatic and manual sample installation are intentionally unavailable.
async function removeWebsiteSamples(){if(!await appConfirm(bi('Remove only the marked sample website records? Customer pianos and real ERP data remain untouched.','Csak a megjelölt weboldali mintarecordokat távolítsuk el? Az ügyfélzongorák és a valós ERP-adatok érintetlenek maradnak.'),{type:'error',confirmText:bi('Remove samples','Minták eltávolítása')}))return;try{await api('/api/demo-content',{method:'DELETE'});showToast(bi('Sample content removed.','A mintatartalom eltávolítva.'),'success');await renderMarketingOverview();}catch(error){showError(error)}}
async function renderMarketingIntegrations(){if(!isAdmin())return showError('PERMISSION_DENIED');const rows=await api('/api/marketing/integrations'),box=$('#tracking_cookies');window.__marketingIntegrations=rows;box.innerHTML=`${mobileBackHeader(bi('Tracking & Cookies','Követési és cookie-beállítások'))}<div class="panel"><div class="toolbar"><div><p class="event-kicker">${bi('Consent-first integrations','Hozzájárulás-alapú integrációk')}</p><h2>${bi('Tracking & provider connections','Követés és szolgáltatói kapcsolatok')}</h2><p class="muted">${bi('Public tracking scripts load only after the visitor’s explicit choice. Secret configuration is restricted to the superadmin.','A nyilvános mérőkódok csak a látogató kifejezett választása után töltődnek be. Titkos beállítást kizárólag a szuperadmin módosíthat.')}</p></div></div><div class="integration-admin-grid">${rows.map(integrationCard).join('')}</div></div>`;applyLanguageToDOM(box)}
function integrationFields(provider,row){const config=row?.config||{};if(provider==='GA4')return `<div class="field full"><label>GA4 Measurement ID</label><input name="measurement_id" value="${htmlText(config.measurement_id||'')}" placeholder="G-XXXXXXXXXX"></div>`;if(provider==='CLARITY')return `<div class="field full"><label>Microsoft Clarity Project ID</label><input name="project_id" value="${htmlText(config.project_id||'')}"></div>`;if(provider==='SEARCH_CONSOLE')return `<div class="field full"><label>Search Console property</label><input name="property_url" value="${htmlText(config.property_url||'')}" placeholder="sc-domain:klavierhaus.com"></div>`;return `<div class="field full"><label>Google OAuth Client ID</label><input name="client_id" value="${htmlText(config.client_id||'')}" placeholder="...apps.googleusercontent.com"></div><div class="field full"><label>Google OAuth Client Secret</label><input name="secret" type="password" autocomplete="new-password" placeholder="${row?.has_secret?bi('Leave empty to keep the stored secret','Hagyd üresen a tárolt titok megtartásához'):''}"></div>`;}
async function openMarketingIntegration(provider){if(!isSuperadmin())return showError('PERMISSION_DENIED');const rows=window.__marketingIntegrations||await api('/api/marketing/integrations'),row=rows.find(item=>item.provider===provider)||{provider,config:{}};$('#modal').classList.remove('hidden');$('#modalTitle').textContent=`${provider} · ${bi('configuration','beállítás')}`;$('#form').innerHTML=`<div class="form-grid">${integrationFields(provider,row)}</div><p class="muted">${bi('Secrets are encrypted at rest and never returned to the browser.','A titkok titkosítva tárolódnak, és soha nem kerülnek vissza a böngészőbe.')}</p><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${bi('Save configuration','Beállítás mentése')}</button></div>`;$('#form').onsubmit=async event=>{event.preventDefault();const raw=Object.fromEntries(new FormData(event.target)),secret=raw.secret||'';delete raw.secret;try{await api(`/api/marketing/integrations/${provider}`,{method:'PUT',body:JSON.stringify({config:raw,secret})});closeModal();showToast(bi('Integration configuration saved.','Az integráció beállítása mentve.'),'success');await renderMarketingIntegrations();}catch(error){showError(error)}};}
async function testMarketingIntegration(provider){try{const result=await api(`/api/marketing/integrations/${provider}/test`,{method:'POST',body:'{}'});showToast(result.live_data?bi('Live connection verified.','Az élő kapcsolat ellenőrizve.'):bi('Configuration format verified; no live data was requested.','A beállítás formátuma ellenőrizve; élő adatlekérés nem történt.'),'success');if(currentView==='tracking_cookies')await renderMarketingIntegrations();}catch(error){showError(error)}}
async function connectMarketingGoogle(){try{const result=await api('/api/marketing/google/connect',{method:'POST',body:'{}'});location.href=result.authorization_url;}catch(error){showError(error)}}
async function syncMarketingGoogleResources(){try{const result=await api('/api/marketing/google/resources');await appAlert(`${bi('Live Google resources','Élő Google-erőforrások')}: Search Console ${(result.search_console_sites||[]).length}, GA4 ${(result.analytics_accounts||[]).length}`,'success');}catch(error){showError(error)}}

async function renderMarketingCampaigns(){if(!isAdmin())return showError('PERMISSION_DENIED');const rows=await api('/api/marketing/campaigns'),box=$('#campaigns_utm');window.__marketingCampaigns=rows;box.innerHTML=`${mobileBackHeader(bi('Campaigns & UTM','Kampányok és UTM-kódok'))}<div class="panel"><div class="toolbar"><div><h2>${bi('Campaign URL builder','Kampány URL-készítő')}</h2><p class="muted">${bi('Create consistent, traceable links without fabricating campaign results.','Készíts egységesen követhető linkeket kitalált kampányeredmények nélkül.')}</p></div><button onclick="openMarketingCampaignEditor()">＋ ${bi('New campaign','Új kampány')}</button></div><div class="table-wrap"><table><thead><tr><th>${bi('Campaign','Kampány')}</th><th>UTM</th><th>${bi('Destination','Cél')}</th><th>${bi('Actions','Műveletek')}</th></tr></thead><tbody>${rows.map(row=>{const url=new URL(row.destination_url);[['utm_source',row.utm_source],['utm_medium',row.utm_medium],['utm_campaign',row.utm_campaign],['utm_term',row.utm_term],['utm_content',row.utm_content]].forEach(([key,value])=>{if(value)url.searchParams.set(key,value)});return `<tr><td>${htmlText(row.name)}${Number(row.active)?'':` <span class="muted">${bi('Inactive','Inaktív')}</span>`}</td><td>${htmlText(row.utm_campaign)}</td><td>${htmlText(row.destination_url)}</td><td><button class="small" onclick='navigator.clipboard.writeText(${JSON.stringify(url.toString())});showToast(bi("Link copied.","Hivatkozás másolva."),"success")'>${bi('Copy','Másolás')}</button> <button class="small ghost-btn" onclick="openMarketingCampaignEditor('${htmlText(row.id)}')">${bi('Edit','Szerkesztés')}</button> <button class="small danger-btn" onclick="deleteMarketingCampaign('${htmlText(row.id)}')">${bi('Delete','Törlés')}</button></td></tr>`}).join('')||`<tr><td colspan="4">${bi('No campaigns yet.','Még nincs kampány.')}</td></tr>`}</tbody></table></div></div>`;applyLanguageToDOM(box)}
function openMarketingCampaignEditor(id=''){const row=(window.__marketingCampaigns||[]).find(item=>item.id===id)||{};$('#modal').classList.remove('hidden');$('#modalTitle').textContent=id?bi('Edit campaign','Kampány szerkesztése'):bi('New campaign','Új kampány');$('#form').innerHTML=`<div class="form-grid"><div class="field"><label>${bi('Name','Név')} *</label><input name="name" value="${htmlText(row.name||'')}" required></div><div class="field"><label>${bi('Destination URL','Cél URL')} *</label><input name="destination_url" type="url" value="${htmlText(row.destination_url||'')}" required></div><div class="field"><label>utm_source</label><input name="utm_source" value="${htmlText(row.utm_source||'')}"></div><div class="field"><label>utm_medium</label><input name="utm_medium" value="${htmlText(row.utm_medium||'')}"></div><div class="field"><label>utm_campaign *</label><input name="utm_campaign" value="${htmlText(row.utm_campaign||'')}" required></div><div class="field"><label>utm_term</label><input name="utm_term" value="${htmlText(row.utm_term||'')}"></div><div class="field"><label>utm_content</label><input name="utm_content" value="${htmlText(row.utm_content||'')}"></div><label class="check-row"><input name="active" type="checkbox" ${row.active===0?'':'checked'}> ${bi('Active','Aktív')}</label></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button><button type="submit">${id?bi('Save','Mentés'):bi('Create','Létrehozás')}</button></div>`;$('#form').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target),body={...Object.fromEntries(data),active:data.has('active')};try{await api(id?`/api/marketing/campaigns/${encodeURIComponent(id)}`:'/api/marketing/campaigns',{method:id?'PUT':'POST',body:JSON.stringify(body)});closeModal();await renderMarketingCampaigns();}catch(error){showError(error)}};}
async function deleteMarketingCampaign(id){if(!await appConfirm(bi('Delete this campaign link?','Töröljük ezt a kampányhivatkozást?'),{type:'error',confirmText:bi('Delete','Törlés')}))return;try{await api(`/api/marketing/campaigns/${encodeURIComponent(id)}`,{method:'DELETE'});await renderMarketingCampaigns();}catch(error){showError(error)}}

async function renderPublishPreview(){
 if(!isAdmin())return showError('PERMISSION_DENIED');const meta=await api('/api/website-content/pages'),box=$('#publish_preview');
 const rows=await Promise.all((meta.pages||[]).flatMap(page=>['en','hu'].map(async language=>{const versions=await api(`/api/website-content/${encodeURIComponent(page.page_key)}/versions?lang=${language}`);return {page,language,versions}})));
 window.__websiteVersionRows=rows;
 box.innerHTML=`${mobileBackHeader(bi('Publish & Preview','Publikálás és előnézet'))}<div class="panel"><div class="toolbar"><div><p class="event-kicker">${bi('Immutable version history','Megváltoztathatatlan verziótörténet')}</p><h2>${bi('Draft, preview and publication','Piszkozat, előnézet és publikálás')}</h2><p class="muted">${bi('A preview is noindex and expires. Publishing atomically replaces only the selected language version.','Az előnézet noindex és lejár. A publikálás atomikusan csak a kiválasztott nyelvi verziót cseréli.')}</p></div></div><div class="version-admin-list">${rows.map(({page,language,versions})=>`<section class="version-admin-card"><h3>${htmlText(page.page_key)} · ${language.toUpperCase()}</h3>${versions.length?versions.slice(0,8).map(version=>`<div><span>v${Number(version.version)} · ${htmlText(version.status)}</span><small>${htmlText(version.created_at||'')}</small><div class="actions"><button class="small ghost-btn" onclick="previewWebsiteVersion('${htmlText(page.page_key)}','${htmlText(version.id)}')">${bi('Preview','Előnézet')}</button>${version.status!=='PUBLISHED'?`<button class="small" onclick="publishWebsiteVersion('${htmlText(page.page_key)}','${htmlText(version.id)}')">${bi('Publish','Publikálás')}</button>`:''}<button class="small ghost-btn" onclick="restoreWebsiteVersion('${htmlText(page.page_key)}','${htmlText(version.id)}')">${bi('Restore as draft','Visszaállítás piszkozatként')}</button></div></div>`).join(''):`<p class="muted">${bi('No saved versions.','Nincs mentett verzió.')}</p>`}</section>`).join('')}</div></div>`;applyLanguageToDOM(box);
}
async function previewWebsiteVersion(page,id){try{const result=await api(`/api/website-content/${encodeURIComponent(page)}/versions/${encodeURIComponent(id)}/preview-link`,{method:'POST',body:JSON.stringify({hours:24})});$('#modal').classList.remove('hidden');$('#modalTitle').textContent=bi('Website preview','Weboldal-előnézet');$('#form').innerHTML=`<div class="website-preview-modal"><iframe title="${bi('Website preview','Weboldal-előnézet')}" src="${htmlText(result.preview_url)}" loading="eager"></iframe></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Close','Bezárás')}</button></div>`;}catch(error){showError(error)}}
async function publishWebsiteVersion(page,id){if(!await appConfirm(bi('Publish this exact version?','Publikáljuk pontosan ezt a verziót?')))return;try{await api(`/api/website-content/${encodeURIComponent(page)}/versions/${encodeURIComponent(id)}/publish`,{method:'POST',body:'{}'});showToast(bi('Version published.','A verzió publikálva.'),'success');await renderPublishPreview();}catch(error){showError(error)}}
async function restoreWebsiteVersion(page,id){try{await api(`/api/website-content/${encodeURIComponent(page)}/versions/${encodeURIComponent(id)}/restore`,{method:'POST',body:'{}'});showToast(bi('Historical content restored as a new draft.','A korábbi tartalom új piszkozatként visszaállt.'),'success');await renderPublishPreview();}catch(error){showError(error)}}

function enhanceWebsiteFileInputs(root=document){
 root.querySelectorAll('input[type="file"]:not([data-drop-ready])').forEach(input=>{
  input.dataset.dropReady='1';if((input.accept||'').includes('image/'))input.accept='image/*,.jpg,.jpeg,.png,.webp,.gif,.avif,.heic,.heif,.tif,.tiff,.bmp';const host=input.closest('.event-image-field,.website-design-field,.field')||input.parentElement;if(!host)return;host.classList.add('website-drop-zone');
  input.addEventListener('change',()=>{const file=input.files?.[0];if(!file)return;let preview=host.querySelector('.website-upload-preview');if(!preview){preview=document.createElement('img');preview.className='website-upload-preview';preview.alt='';host.insertBefore(preview,input);}if(file.type.startsWith('image/')||/\.(avif|heic|heif|tiff?|bmp)$/i.test(file.name)){const url=URL.createObjectURL(file);preview.onload=()=>URL.revokeObjectURL(url);preview.src=url;preview.hidden=false;}else{preview.hidden=true;}});
  const setState=value=>host.classList.toggle('is-dragging',value);
  ['dragenter','dragover'].forEach(type=>host.addEventListener(type,event=>{event.preventDefault();setState(true)}));
  ['dragleave','drop'].forEach(type=>host.addEventListener(type,event=>{event.preventDefault();setState(false)}));
  host.addEventListener('drop',event=>{const files=event.dataTransfer?.files;if(!files?.length)return;const transfer=new DataTransfer();[...files].forEach(file=>transfer.items.add(file));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
 });
}

let guestDataRows=[];
function guestDataAverage(row){
 if(row.average_paid_price_cents===null||row.average_paid_price_cents===undefined)return '—';
 return `${(Number(row.average_paid_price_cents||0)/100).toFixed(2)} ${htmlText(row.currency||'USD')}`;
}
function guestDataHistoryMarkup(row){
 return row.events?.length?`<details class="guest-data-history"><summary>${bi('View event history','Eseményelőzmények megtekintése')}</summary><ul>${row.events.map(event=>`<li><strong>${htmlText(currentLang==='hu'?event.title_hu:event.title_en)}</strong><span>${htmlText(eventDateLabel(event.start_at))} · ${htmlText(event.venue_name||'Klavierhaus')}</span><span>${event.attended?bi('Present','Megjelent'):bi('Not marked present','Nem jelölt megjelenés')} · ${Number(event.ticket_count||0)} ${bi('ticket(s)','jegy')}</span></li>`).join('')}</ul></details>`:`<span class="muted">${bi('No event history','Nincs eseményelőzmény')}</span>`;
}
function filterGuestDataRows(){
 const query=String($('#guestDataSearch')?.value||'').toLowerCase().trim(),eventId=$('#guestDataEvent')?.value||'';let visible=0;
 document.querySelectorAll('#guest_data .guest-data-row').forEach(row=>{const show=(!query||row.dataset.search.includes(query))&&(!eventId||row.dataset.events.split(',').includes(eventId));row.classList.toggle('hidden',!show);if(show)visible+=1;});
 $('#guestDataFilteredEmpty')?.classList.toggle('hidden',visible>0);
}
async function downloadGuestDataPdf(){
 const params=new URLSearchParams({lang:currentLang});const search=$('#guestDataSearch')?.value||'',eventId=$('#guestDataEvent')?.value||'';if(search)params.set('search',search);if(eventId)params.set('event_id',eventId);
 try{const response=await fetch(`/api/guest-data.pdf?${params.toString()}`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error((await response.json()).error||'GUEST_DATA_PDF_FAILED');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`klavierhaus-guest-data-${currentLang}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){showError(error)}
}
async function renderGuestData(){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 const data=await api('/api/guest-data'),box=$('#event_guest_list');guestDataRows=data.guests||[];
 const eventOptions=(data.events||[]).map(event=>`<option value="${htmlText(event.id)}">${htmlText(currentLang==='hu'?event.title_hu:event.title_en)}</option>`).join('');
 const rows=guestDataRows.map(row=>`<tr class="guest-data-row" data-search="${htmlText([row.name,row.email,...(row.events||[]).flatMap(event=>[event.title_en,event.title_hu,event.venue_name])].join(' ').toLowerCase())}" data-events="${htmlText((row.events||[]).map(event=>event.id).join(','))}"><td><strong>${htmlText(row.name)}</strong><div>${htmlText(row.email||'—')}</div></td><td>${Number(row.event_count||0)}</td><td>${Number(row.ticket_count||0)}</td><td>${Number(row.paid_ticket_count||0)}</td><td>${htmlText(guestDataAverage(row))}</td><td>${guestDataHistoryMarkup(row)}</td></tr>`).join('');
 box.innerHTML=`${mobileBackHeader(bi('Guest Data','Vendégadatok'))}<div class="panel guest-data-shell"><div class="toolbar"><div><p class="event-kicker">${bi('Website & events · static guest records','Weboldal és események · statikus vendégadatok')}</p><h2>${bi('Guest Data','Vendégadatok')}</h2><p class="muted">${bi('Search guest records, review event history and calculate the average of actually paid tickets. This is not a check-in workspace.','Keresd a vendégrekordokat, nézd meg az eseményelőzményeket, és számítsd ki a ténylegesen fizetett jegyek átlagárát. Ez nem érkeztetési munkaterület.')}</p></div><button type="button" class="ghost-btn" onclick="downloadGuestDataPdf()">${bi('Export PDF','PDF export')}</button></div><div class="form-grid compact guest-data-filters"><div class="field"><label>${bi('Search guests or events','Vendégek vagy események keresése')}</label><input id="guestDataSearch" type="search" oninput="filterGuestDataRows()" placeholder="${bi('Name, email or event…','Név, e-mail vagy esemény…')}"></div><div class="field"><label>${bi('Event','Esemény')}</label><select id="guestDataEvent" onchange="filterGuestDataRows()"><option value="">${bi('All events','Minden esemény')}</option>${eventOptions}</select></div></div><div class="table-wrap"><table><thead><tr><th>${bi('Guest','Vendég')}</th><th>${bi('Events','Események')}</th><th>${bi('Tickets','Jegyek')}</th><th>${bi('Paid tickets','Fizetett jegyek')}</th><th>${bi('Paid average','Fizetett átlagár')}</th><th>${bi('History','Előzmények')}</th></tr></thead><tbody id="guestDataRows">${rows||`<tr><td colspan="6">${bi('No guest records match this workspace.','Nincs vendégrekord ebben a munkaterületben.')}</td></tr>`}</tbody></table></div><p class="empty-state hidden" id="guestDataFilteredEmpty">${bi('No records match the selected filters.','Nincs a szűrésnek megfelelő rekord.')}</p><p class="muted guest-data-note">${bi('The paid average excludes free, VIP, invitation, complimentary and refunded tickets.','A fizetett átlagár nem tartalmazza a díjmentes, VIP-, meghívásos, tisztelet- és refundolt jegyeket.')}</p></div>`;
 applyLanguageToDOM(box);enhanceCustomSelects(box);
}

async function renderEventWorkspace(view){
 if(!isAdmin())return showError('PERMISSION_DENIED');const events=await api('/api/events'),details=await Promise.all(events.map(row=>api(`/api/events/${encodeURIComponent(row.id)}`))),box=$(`#${view}`),titles={event_tickets:["Tickets & Reservations","Jegyek és foglalások"],event_invitations:["Invitations","Meghívások"],event_guest_list:["Guest Data","Vendégadatok"]},title=titles[view];
 const eventOptions=details.map(row=>`<option value="${htmlText(row.id)}">${htmlText(currentLang==='hu'?row.title_hu:row.title_en)}</option>`).join('');
 let records=[];
 if(view==='event_tickets')records=details.flatMap(event=>(event.tickets||[]).map(ticket=>({event,ticket,status:ticket.status,search:[ticket.attendee_name,ticket.contact_email,ticket.public_code,ticket.source_type].join(' ')})));
 if(view==='event_invitations')records=details.flatMap(event=>(event.invitations||[]).map(invitation=>({event,invitation,status:invitation.status,search:[invitation.guest_name,invitation.guest_email,invitation.delivery_status].join(' ')})));
 if(view==='event_guest_list')records=details.map(event=>({event,status:event.status,search:[event.title_en,event.title_hu,event.performer_name].join(' ')}));
 const statuses=[...new Set(records.map(item=>item.status).filter(Boolean))].sort();
 const tableRows=records.map(record=>{const event=record.event,titleText=currentLang==='hu'?event.title_hu:event.title_en,common=`class="event-workspace-row" data-event="${htmlText(event.id)}" data-status="${htmlText(record.status||'')}" data-search="${htmlText(`${titleText} ${record.search||''}`.toLowerCase())}"`;
 if(view==='event_tickets'){const row=record.ticket;return `<tr ${common}><td>${htmlText(titleText)}</td><td>${htmlText(row.original_guest_name||row.attendee_name)}</td><td>${htmlText(row.contact_email||'')}</td><td>${htmlText(row.ticket_variant||row.source_type)}</td><td>${htmlText(row.status)}</td><td><button class="small ghost-btn" onclick="editWorkspaceGuestName('${htmlText(row.id)}','${htmlText(row.attendee_name)}','${htmlText(view)}')">${bi('Edit name','Név javítása')}</button> <button class="small" onclick="downloadEventTicketDocument('${htmlText(row.id)}','front')">${bi('Front','Előlap')}</button> <button class="small" onclick="downloadEventTicketDocument('${htmlText(row.id)}','back')">${bi('Back','Hátlap')}</button> <button class="small" onclick="downloadEventTicketDocument('${htmlText(row.id)}','full')">${bi('Full','Teljes')}</button> <button class="small" onclick="openEventDetails('${htmlText(event.id)}')">${bi('Details','Részletek')}</button></td></tr>`;}
  if(view==='event_invitations'){const row=record.invitation;return `<tr ${common}><td>${htmlText(titleText)}</td><td>${htmlText(row.guest_name)}</td><td>${htmlText(row.guest_email)}</td><td>${htmlText(row.status)}</td><td>${htmlText(row.delivery_status||'')}</td><td>${row.status==='PENDING'?`<button class="small danger-btn" onclick="revokeWorkspaceInvitation('${htmlText(row.id)}','${htmlText(view)}')">${bi('Revoke','Visszavonás')}</button> `:''}<button class="small" onclick="openEventDetails('${htmlText(event.id)}')">${bi('Details','Részletek')}</button></td></tr>`;}
  const count=(event.tickets||[]).filter(ticket=>['VALID','USED'].includes(ticket.status)).length;return `<tr ${common}><td>${htmlText(titleText)}</td><td>${htmlText(eventDateLabel(event.start_at))}</td><td>${count}</td><td>${htmlText(event.status)}</td><td><button class="small" onclick="openEventDetails('${htmlText(event.id)}')">${bi('Open list','Lista megnyitása')}</button> <button class="small ghost-btn" onclick="downloadGuestListPdf('${htmlText(event.id)}')">${bi('Export PDF','PDF export')}</button></td></tr>`;
 }).join('');
 const heads=view==='event_tickets'?[bi('Event','Esemény'),bi('Guest','Vendég'),'Email',bi('Source','Forrás'),bi('Status','Állapot'),bi('Actions','Műveletek')]:view==='event_invitations'?[bi('Event','Esemény'),bi('Guest','Vendég'),'Email',bi('Status','Állapot'),bi('Delivery','Kézbesítés'),bi('Actions','Műveletek')]:[bi('Event','Esemény'),bi('Date','Dátum'),bi('Guests','Vendégek'),bi('Status','Állapot'),bi('Actions','Műveletek')];
 const exportAction=view==='event_guest_list'?`<button type="button" class="ghost-btn" data-guest-list-export onclick="exportGuestListFromWorkspace('${view}')">${bi('Export PDF','PDF export')}</button>`:'';
 const createTicketAction=view==='event_tickets'?`<button type="button" onclick="openIndividualTicketModal()">＋ ${bi('New individual ticket','Új egyedi jegy')}</button>`:'';
 box.innerHTML=`${mobileBackHeader(bi(title[0],title[1]))}<div class="panel event-admin-shell"><div class="toolbar"><div><p class="event-kicker">${bi('Website & events','Weboldal és események')}</p><h2>${bi(title[0],title[1])}</h2><p class="muted">${bi('Search, filter and manage operational records directly.','Keresd, szűrd és kezeld közvetlenül az operatív rekordokat.')}</p></div><div class="toolbar-actions">${createTicketAction}${exportAction}</div></div><div class="form-grid compact event-workspace-filters"><div class="field"><label>${bi('Search','Keresés')}</label><input id="${view}Search" type="search" oninput="filterEventWorkspaceRows('${view}')"></div><div class="field"><label>${bi('Event','Esemény')}</label><select id="${view}Event" onchange="filterEventWorkspaceRows('${view}')"><option value="">${bi('All events','Minden esemény')}</option>${eventOptions}</select></div><div class="field"><label>${bi('Status','Állapot')}</label><select id="${view}Status" onchange="filterEventWorkspaceRows('${view}')"><option value="">${bi('All statuses','Minden állapot')}</option>${statuses.map(status=>`<option value="${htmlText(status)}">${htmlText(status)}</option>`).join('')}</select></div></div><div class="table-wrap"><table><thead><tr>${heads.map(head=>`<th>${htmlText(head)}</th>`).join('')}</tr></thead><tbody id="${view}Rows">${tableRows||`<tr><td colspan="${heads.length}">${bi('No records match this workspace.','Nincs rekord ebben a munkaterületben.')}</td></tr>`}</tbody></table></div><p class="empty-state hidden" id="${view}FilteredEmpty">${bi('No records match the selected filters.','Nincs a szűrésnek megfelelő rekord.')}</p></div>`;enhanceCustomSelects(box);
}
function exportGuestListFromWorkspace(view='event_guest_list'){
 const eventId=$(`#${view}Event`)?.value||'';
 if(!eventId)return showToast(bi('Select an event before exporting the guest list.','Export előtt válassz ki egy eseményt.'),'error');
 return downloadGuestListPdf(eventId);
}
function filterEventWorkspaceRows(view){const search=String($(`#${view}Search`)?.value||'').toLowerCase().trim(),eventId=$(`#${view}Event`)?.value||'',status=$(`#${view}Status`)?.value||'';let visible=0;document.querySelectorAll(`#${view}Rows .event-workspace-row`).forEach(row=>{const show=(!search||row.dataset.search.includes(search))&&(!eventId||row.dataset.event===eventId)&&(!status||row.dataset.status===status);row.classList.toggle('hidden',!show);if(show)visible+=1});$(`#${view}FilteredEmpty`)?.classList.toggle('hidden',visible>0)}
async function editWorkspaceGuestName(ticketId,currentName,view){const attendee_name=await appPrompt(bi('Correct guest name','Vendégnév javítása'),{initialValue:currentName});if(!attendee_name||attendee_name.trim()===currentName.trim())return;try{await api(`/api/events/tickets/${encodeURIComponent(ticketId)}`,{method:'PUT',body:JSON.stringify({attendee_name})});showToast(bi('Guest name updated.','A vendégnév frissült.'),'success');await renderEventWorkspace(view);}catch(error){showError(error)}}
async function revokeWorkspaceInvitation(invitationId,view){if(!await appConfirm(bi('Revoke this invitation?','Visszavonjuk ezt a meghívást?')))return;try{await api(`/api/events/invitations/${encodeURIComponent(invitationId)}/revoke`,{method:'POST',body:'{}'});showToast(bi('Invitation revoked.','Meghívás visszavonva.'),'success');await renderEventWorkspace(view);}catch(error){showError(error)}}

let customerInboxRows=[];
let customerInboxSelected=null;
let customerInboxSearch="";
let customerInboxStatusFilter="";
let customerInboxCategoryFilter="";
let customerInboxKnownIds=new Set();
let customerInboxAlertIds=new Set();
let customerInboxPollTimer=null;
function canAccessHelpdesk(){return isAdmin()||["MANAGER","WORKER"].includes(user?.role);}
function customerConversationStatusLabel(status){return ({OPEN:'Open / Nyitott',PENDING_CUSTOMER:'Waiting for customer / Ügyfélre vár',PENDING_STAFF:'Needs staff reply / Munkatársi válaszra vár',CLOSED:'Closed / Lezárt'})[status]||status||'';}
function customerConversationCategoryLabel(category){return ({SERVICE:'Services / Szolgáltatások',PIANO:'Piano / showroom / Zongora / showroom',EVENT:'Events / Események',REFUND:'Refund / payment / Visszatérítés / fizetés',PRIVATE_CONSULTATION:'Private consultation / Privát konzultáció',TECHNICAL:'Technical issue / Technikai probléma',TICKET:'Ticket problem / Jegyprobléma',BILLING:'Billing / Számlázás',REPAIR:'Repair / service / Javítás / szerviz',GENERAL:'General question / Általános kérdés',OTHER:'Other / Egyéb'})[category]||category||'';}
function customerConversationAuditLabel(event){return ({CREATED:'Conversation created / Beszélgetés létrehozva',CUSTOMER_MESSAGE:'Customer message / Ügyfélüzenet',REOPENED_BY_CUSTOMER:'Reopened by customer / Ügyfél újranyitotta',STAFF_MESSAGE:'Staff reply / Munkatársi válasz',ASSIGNED:'Assignment changed / Hozzárendelés módosítva',STATUS_CHANGED:'Status changed / Állapot módosítva',CLOSED:'Closed / Lezárva',REOPENED:'Reopened / Újranyitva',AUTO_CLOSED:'Automatically closed / Automatikusan lezárva'})[event.event_type]||event.event_type||'Event';}
function customerConversationRowsForDisplay(){
 const query=customerInboxSearch.toLowerCase().trim();
 return customerInboxRows.filter(row=>{const hay=`${row.id||""} ${row.name||""} ${row.email||""} ${row.category||""}`.toLowerCase();return (!query||hay.includes(query))&&(!customerInboxStatusFilter||row.status===customerInboxStatusFilter)&&(!customerInboxCategoryFilter||row.category===customerInboxCategoryFilter);});
}
function playHelpdeskAlert(){
 if(localStorage.getItem("kh_helpdesk_sound_enabled")==="false")return;
 try{const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return;const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="sine";osc.frequency.value=740;gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.12,ctx.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.42);osc.connect(gain).connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.45);window.setTimeout(()=>ctx.close?.(),600);}catch(_error){}
}
function customerInboxAlertNewRows(rows){
 const unread=rows.filter(row=>Number(row.unread_count||0)>0&&customerInboxSelected?.id!==row.id);
 const fresh=unread.filter(row=>!customerInboxKnownIds.has(row.id)&&!customerInboxAlertIds.has(row.id));
 fresh.forEach(row=>customerInboxAlertIds.add(row.id));
 if(fresh.length)playHelpdeskAlert();
 rows.forEach(row=>customerInboxKnownIds.add(row.id));
}
function customerInboxListMarkup(){
 const rows=customerConversationRowsForDisplay();
 return rows.length?rows.map(row=>`<button type="button" class="customer-inbox-row ${customerInboxSelected?.id===row.id?'is-selected':''}" onclick="openCustomerConversation('${htmlText(row.id)}')"><span class="customer-inbox-row__top"><strong>${htmlText(row.name||'Guest / Vendég')}</strong><small>${htmlText(row.email||'Anonymous / Anonim')}</small>${Number(row.unread_count||0)?`<b class="customer-inbox-unread">${Number(row.unread_count)}</b>`:''}</span><span class="customer-inbox-row__bottom"><span>${htmlText(customerConversationCategoryLabel(row.category))}</span><span>${htmlText(customerConversationStatusLabel(row.status))}</span></span><time>${htmlText(row.last_message_at||row.updated_at||'')}</time></button>`).join(''):`<div class="empty-state"><h3>${bi('No customer conversations','Nincs ügyfélbeszélgetés')}</h3><p>${bi('New website messages will appear here.','Az új weboldali üzenetek itt jelennek meg.')}</p></div>`;
}
function customerInboxDetailMarkup(){
 if(!customerInboxSelected)return `<div class="customer-inbox-empty"><span class="admin-ia-card__icon">▣</span><h3>${bi('Select a conversation','Válassz beszélgetést')}</h3><p class="muted">${bi('Choose a customer message from the list to read and answer it.','Válassz ki egy ügyfélüzenetet a listából az olvasáshoz és válaszadáshoz.')}</p></div>`;
 const row=customerInboxSelected, messages=row.messages||[], assigneeOptions=(schedulerWorkersCache||[]).map(worker=>`<option value="${htmlText(worker.id)}" ${String(worker.id)===String(row.assigned_user_id)?'selected':''}>${htmlText(worker.name)}</option>`).join('');
 const auditEvents=(row.audit_events||[]);
 const auditMarkup=auditEvents.length?`<details class="customer-inbox-audit"><summary>${bi('Audit log','Auditnapló')} (${auditEvents.length})</summary><div class="customer-inbox-audit__list">${auditEvents.map(event=>`<article><strong>${htmlText(customerConversationAuditLabel(event))}</strong><time>${htmlText(event.created_at||'')}</time><span>${htmlText(event.actor_name||event.actor_role||'System / Rendszer')}${event.from_status||event.to_status?` · ${htmlText(event.from_status||'—')} → ${htmlText(event.to_status||'—')}`:''}</span>${event.details?`<small>${htmlText(typeof event.details==='string'?event.details:JSON.stringify(event.details))}</small>`:''}</article>`).join('')}</div></details>`:'';
 return `<div class="customer-inbox-detail"><div class="toolbar"><div><p class="event-kicker">${htmlText(customerConversationCategoryLabel(row.category))}</p><h3>${htmlText(row.name||'Guest / Vendég')}</h3><p class="muted">${htmlText(row.email||'Anonymous / Anonim')}${row.source_path?` · ${htmlText(row.source_path)}`:''}</p></div><div class="toolbar-actions"><button type="button" class="small ghost-btn" onclick="downloadCustomerConversationReport('${htmlText(row.id)}')">${bi('Download PDF report','PDF-riport letöltése')}</button><select id="customerConversationStatus" onchange="updateCustomerConversationStatus('${htmlText(row.id)}',this.value)">${['OPEN','PENDING_CUSTOMER','PENDING_STAFF','CLOSED'].map(status=>`<option value="${status}" ${row.status===status?'selected':''}>${htmlText(customerConversationStatusLabel(status))}</option>`).join('')}</select></div></div><div class="customer-inbox-assignment"><span>${bi('Assigned worker','Hozzárendelt munkatárs')}: <strong>${htmlText(row.assigned_user_name||'—')}</strong></span>${isAdmin()?`<select onchange="assignCustomerConversation('${htmlText(row.id)}',this.value)"><option value="">${bi('Unassigned','Nincs hozzárendelve')}</option>${assigneeOptions}</select>`:''}</div><div class="customer-message-list">${messages.length?messages.map(message=>`<article class="customer-message customer-message--${message.direction==='STAFF'?'staff':'customer'}"><div class="customer-message__meta"><strong>${htmlText(message.sender_name||'Klavierhaus')}</strong><time>${htmlText(message.created_at||'')}</time></div><p>${htmlText(message.body)}</p>${(message.attachments||[]).map(attachment=>`<a class="customer-message__attachment" href="${htmlText(attachment.url||'#')}" target="_blank" rel="noopener">↳ ${htmlText(attachment.original_name||attachment.stored_name||'Attachment')}</a>`).join('')}</article>`).join(''):`<p class="muted">${bi('No messages yet.','Még nincs üzenet.')}</p>`}</div>${auditMarkup}${row.status==='CLOSED'?`<div class="customer-inbox-closed-actions"><p class="muted">${bi('This conversation is closed. Reopening requires a reason.','A beszélgetés lezárt. Az újranyitáshoz indok szükséges.')}</p><button type="button" class="small" onclick="reopenCustomerConversation('${htmlText(row.id)}')">${bi('Reopen conversation','Beszélgetés újranyitása')}</button></div>`:`<form class="customer-inbox-reply" onsubmit="sendCustomerInboxReply(event,'${htmlText(row.id)}')"><label>${bi('Reply to customer','Válasz az ügyfélnek')}<textarea name="message" rows="5" required placeholder="${bi('Write a clear reply…','Írj világos választ…')}"></textarea></label><label>${bi('Attachments','Csatolmányok')}<input name="attachments" type="file" multiple accept="image/*,.heic,.heif,.avif,.pdf,.doc,.docx"></label><div class="actions"><button type="submit">${bi('Send reply','Válasz küldése')}</button></div></form>`}</div>`;
}
async function refreshCustomerInbox({initial=false}={}){
 if(!canAccessHelpdesk())return;
 const query=customerInboxSearch.trim();
 const params=new URLSearchParams();if(query)params.set('q',query);if(customerInboxStatusFilter)params.set('status',customerInboxStatusFilter);
 customerInboxRows=await api(`/api/customer-conversations${params.toString()?`?${params}`:''}`);
 customerInboxAlertNewRows(customerInboxRows);
 const box=$('#customer_inbox');if(!box)return;
 if(customerInboxSelected&&!customerInboxRows.some(row=>row.id===customerInboxSelected.id))customerInboxSelected=null;
 const list=box.querySelector('#customerInboxRows'),count=box.querySelector('[data-customer-inbox-count]');if(list)list.innerHTML=customerInboxListMarkup();if(count)count.textContent=String(customerConversationRowsForDisplay().length);
 if(initial&&customerInboxSelected)await openCustomerConversation(customerInboxSelected.id,{preserveView:true});
}
async function renderCustomerInbox(){
 if(!canAccessHelpdesk())return showError('PERMISSION_DENIED');
 if(customerInboxPollTimer)window.clearInterval(customerInboxPollTimer);
 const workersPromise=loadSchedulerWorkers();
 await refreshCustomerInbox({initial:true});
 const box=$('#customer_inbox');if(!box)return;
 box.innerHTML=`${mobileBackHeader(bi('Customer Inbox','Ügyfélüzenetek'))}<div class="panel customer-inbox-shell"><div class="toolbar"><div><p class="event-kicker">${bi('Marketing · customer communication','Marketing · ügyfélkommunikáció')}</p><h2>${bi('Customer Inbox','Ügyfélüzenetek')}</h2><p class="muted">${bi('Every role can open Helpdesk; cases are scoped by routing and assignment.','A Helpdesk minden szerepkör számára elérhető; az ügyek routing és hozzárendelés szerint szűrtek.')}</p></div><div class="toolbar-actions"><label class="helpdesk-sound-toggle"><input type="checkbox" ${localStorage.getItem('kh_helpdesk_sound_enabled')!=='false'?'checked':''} onchange="localStorage.setItem('kh_helpdesk_sound_enabled',String(this.checked))"> ${bi('Sound alerts','Hangjelzés')}</label><button type="button" class="ghost-btn" onclick="renderCustomerInbox()">${bi('Refresh','Frissítés')}</button></div></div><div class="form-grid compact customer-inbox-filters"><label>${bi('Search','Keresés')}<input id="customerInboxSearch" type="search" value="${htmlText(customerInboxSearch)}" oninput="customerInboxSearch=this.value;refreshCustomerInbox()"></label><label>${bi('Status','Állapot')}<select onchange="customerInboxStatusFilter=this.value;refreshCustomerInbox()"><option value="">${bi('All statuses','Minden állapot')}</option>${['OPEN','PENDING_CUSTOMER','PENDING_STAFF','CLOSED'].map(status=>`<option value="${status}" ${customerInboxStatusFilter===status?'selected':''}>${htmlText(customerConversationStatusLabel(status))}</option>`).join('')}</select></label><label>${bi('Category','Kategória')}<select onchange="customerInboxCategoryFilter=this.value;refreshCustomerInbox()"><option value="">${bi('All categories','Minden kategória')}</option>${[...new Set(customerInboxRows.map(row=>row.category))].filter(Boolean).map(category=>`<option value="${htmlText(category)}" ${customerInboxCategoryFilter===category?'selected':''}>${htmlText(customerConversationCategoryLabel(category))}</option>`).join('')}</select></label></div><div class="customer-inbox-layout"><section class="customer-inbox-list"><div class="customer-inbox-list__header"><strong>${bi('Conversations','Beszélgetések')}</strong><span data-customer-inbox-count>${customerConversationRowsForDisplay().length}</span></div><div id="customerInboxRows">${customerInboxListMarkup()}</div></section><section id="customerInboxDetail">${customerInboxDetailMarkup()}</section></div></div>`;
 await workersPromise; if(customerInboxSelected)box.querySelector('#customerInboxDetail').innerHTML=customerInboxDetailMarkup();
 applyLanguageToDOM(box);
 customerInboxPollTimer=window.setInterval(()=>{if(currentView==='customer_inbox')refreshCustomerInbox();},3500);
}
async function openCustomerConversation(id,opts={}){
 try{customerInboxAlertIds.delete(id);customerInboxSelected=await api(`/api/customer-conversations/${encodeURIComponent(id)}`);const box=$('#customer_inbox');if(!box)return;if(!opts.preserveView)box.querySelector('#customerInboxRows').innerHTML=customerInboxListMarkup();box.querySelector('#customerInboxDetail').innerHTML=customerInboxDetailMarkup();applyLanguageToDOM(box.querySelector('#customerInboxDetail'));}catch(error){showError(error)}
}
async function sendCustomerInboxReply(event,id){
 event.preventDefault();const formData=new FormData(event.target),message=String(formData.get('message')||'').trim(),files=[...(event.target.elements.attachments?.files||[])];if(!message)return;if(files.length>10||files.some(file=>file.size>50*1024*1024))return showError('CUSTOMER_ATTACHMENT_INVALID');formData.set('message',message);
 try{const result=await api(`/api/customer-conversations/${encodeURIComponent(id)}/messages`,{method:'POST',body:formData});customerInboxSelected=result.conversation;showToast(result.delivery?.status==='SENT'?bi('Reply sent and emailed.','A válasz elküldve és e-mailben kiküldve.'):bi('Reply saved. Email delivery is not configured.','A válasz mentve. Az e-mail-kézbesítés nincs beállítva.'),result.delivery?.status==='SENT'?'success':'warning');await refreshCustomerInbox();openCustomerConversation(id);}catch(error){showError(error)}
}
async function updateCustomerConversationStatus(id,status){const previous=customerInboxSelected?.status||'';let body={status};if(status==='CLOSED'){body.closure_note=await appPrompt(bi('Closure note','Lezárási megjegyzés'),{initialValue:''});if(!body.closure_note)return renderCustomerInbox();}if(previous==='CLOSED'&&status!=='CLOSED'){body.reopen_reason=await appPrompt(bi('Reopen reason','Újranyitási indok'),{initialValue:''});if(!body.reopen_reason)return renderCustomerInbox();}try{customerInboxSelected=await api(`/api/customer-conversations/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});await refreshCustomerInbox();openCustomerConversation(id);}catch(error){showError(error)}}
async function reopenCustomerConversation(id){return updateCustomerConversationStatus(id,'OPEN');}
async function assignCustomerConversation(id,assigned_user_id){try{customerInboxSelected=await api(`/api/customer-conversations/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({assigned_user_id})});showToast(bi('Conversation assigned.','A beszélgetés hozzárendelve.'),'success');await refreshCustomerInbox();openCustomerConversation(id);}catch(error){showError(error)}}

async function renderCompanyData(){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 const data=await api('/api/settings/company-data'),box=$('#company_data');
 const field=(name,label,type='text',wide=false)=>`<div class="field ${wide?'full':''}"><label>${label}</label><input name="${name}" type="${type}" value="${htmlText(data[name]||'')}" ${name==='email'?'autocomplete="email"':''}></div>`;
 box.innerHTML=`${mobileBackHeader(bi('Company Data','Cégadatok'))}<div class="panel company-data-shell"><div class="toolbar"><div><p class="event-kicker">${bi('Technical operation · invoicing identity','Technikai működés · számlázási adatok')}</p><h2>${bi('Company Data','Cégadatok')}</h2><p class="muted">${bi('These values are used on paid event invoices. The legal address is required before a document can be issued.','Ezek az adatok kerülnek a fizetős események számláira. A hivatalos cím kötelező, mielőtt bizonylat kiállítható.')}</p></div><span class="integration-status connected">${htmlText(data.invoice_currency||'USD')}</span></div><form data-company-form><div class="form-grid">${field('legal_name',bi('Legal company name *','Hivatalos cégnév *'), 'text',true)}${field('trade_name',bi('Trade name','Kereskedelmi név'))}${field('tax_id',bi('Tax ID / EIN','Adóazonosító / EIN'))}${field('logo_url',bi('Logo URL','Logó URL'), 'url',true)}${field('address_line1',bi('Address line 1 *','Cím 1. sora *'), 'text',true)}${field('address_line2',bi('Address line 2','Cím 2. sora'), 'text',true)}${field('city',bi('City *','Város *'))}${field('state',bi('State *','Állam *'))}${field('postal_code',bi('ZIP / postal code *','Irányítószám *'))}${field('country',bi('Country *','Ország *'))}${field('email',bi('Billing email','Számlázási e-mail'), 'email')}${field('phone',bi('Phone','Telefonszám'), 'tel')}${field('invoice_prefix',bi('Invoice prefix','Számlaszám-előtag'))}${field('invoice_currency',bi('Invoice currency','Számla pénzneme'))}${field('invoice_payment_terms',bi('Payment terms','Fizetési feltételek'), 'text',true)}${field('invoice_footer',bi('Invoice footer','Számla lábléc'), 'text',true)}</div><div class="actions"><button type="submit">${bi('Save company data','Cégadatok mentése')}</button></div></form></div>`;
 box.querySelector('[data-company-form]').onsubmit=async event=>{event.preventDefault();try{await api('/api/settings/company-data',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});showToast(bi('Company data saved.','A cégadatok mentve.'),'success');await renderCompanyData();}catch(error){showError(error)}};
 applyLanguageToDOM(box);
}
async function renderBackupsView(){
 if(!isAdmin())return showError('PERMISSION_DENIED');const rows=await api('/api/backups'),box=$('#backups');box.innerHTML=`${mobileBackHeader(bi('Backups','Biztonsági mentések'))}<div class="panel"><div class="toolbar"><h2>${bi('Backups','Biztonsági mentések')}</h2>${isSuperadmin()?`<button onclick="createBackupNow()">${bi('Create backup now','Mentés készítése most')}</button>`:''}</div><p class="muted">${isSuperadmin()?bi('Creation, download and restore are restricted to the superadmin.','A létrehozás, letöltés és visszaállítás kizárólag a szuperadmin joga.'):bi('Administrators can view the backup register only.','Az adminok kizárólag a mentési listát tekinthetik meg.')}</p><div class="table-wrap"><table><thead><tr><th>${bi('Created','Létrehozva')}</th><th>${bi('File','Fájl')}</th><th>${bi('Status','Állapot')}</th><th>${bi('Actions','Műveletek')}</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${htmlText(row.created_at||'')}</td><td>${htmlText(row.file_name||'')}</td><td>${htmlText(row.status||'')}</td><td>${isSuperadmin()?`<button class="small" onclick="downloadBackup('${htmlText(row.id)}')">${bi('Download','Letöltés')}</button> <button class="small danger-btn" onclick="restoreBackup('${htmlText(row.id)}')">${bi('Restore','Visszaállítás')}</button>`:bi('View only','Csak megtekintés')}</td></tr>`).join('')||`<tr><td colspan="4">${bi('No backups yet.','Még nincs biztonsági mentés.')}</td></tr>`}</tbody></table></div></div>`;
}
const adminCardDescriptions=Object.fromEntries(adminNavGroups.flatMap(group=>group.items.map(([view,en,hu])=>[view,[`Open and manage ${en.toLowerCase()} records.`,`${hu} rekordjait és műveleteit kezeli.`]])));
Object.assign(adminCardDescriptions,{
 pages_content:['Edit bilingual public page text, sections and SEO content.','A kétnyelvű nyilvános oldalszövegeket, szekciókat és SEO-tartalmat szerkeszti.'],
 website_services:['Create and publish the service cards shown on the public website.','A nyilvános weboldalon megjelenő szolgáltatáskártyákat kezeli és publikálja.'],
 showroom_pianos:['Manage the public showroom piano cards and image galleries.','A nyilvános bemutatótermi zongorakártyákat és képgalériákat kezeli.'],
 website_artists:['Manage published artist profiles, portraits and bilingual biographies.','A publikált művészprofilokat, portrékat és kétnyelvű bemutatkozásokat kezeli.'],
 media_library:['Upload and organize public website media with bilingual alt text.','A nyilvános weboldal médiáját és kétnyelvű alt szövegeit kezeli.'],
 events:['Create, edit, publish and close Klavierhaus events.','Klavierhaus-eseményeket hoz létre, szerkeszt, publikál és zár le.'],
 event_tickets:['Review ticket reservations, ticket status and event ticket actions.','A jegyfoglalásokat, jegystátuszokat és eseményjegy-műveleteket kezeli.'],
 event_invitations:['Create, send and revoke event invitations.','Eseménymeghívásokat hoz létre, küld és von vissza.'],
 event_guest_list:['Review static guest records, event history and paid-ticket averages.','Statikus vendégadatokat, eseményelőzményeket és fizetett jegyátlagokat mutat.'],
 digital_attendance:['Open the PDF-style attendance sheet and record arrivals in real time.','A PDF-stílusú jelenlétiívet nyitja meg, és valós időben rögzíti az érkezéseket.'],
 website_contacts:['Review and manage website contact requests and leads.','A weboldali kapcsolatfelvételeket és érdeklődőket kezeli.'],
 customer_inbox:['Read, assign, answer and close customer helpdesk conversations.','Ügyfél-helpdesk beszélgetéseket olvas, oszt ki, válaszol meg és zár le.'],
 publish_preview:['Preview, publish and restore approved public website versions.','A jóváhagyott nyilvános weboldalverziókat előnézetben megtekinti, publikálja és visszaállítja.'],
 marketing_overview:['Review the verified marketing and measurement overview.','A hitelesített marketing- és mérési áttekintést mutatja.'],
 website_reviews:['Manage bilingual public reviews, portraits and visibility.','A kétnyelvű nyilvános véleményeket, portrékat és láthatóságot kezeli.'],
 campaigns_utm:['Create traceable campaign links with consistent UTM parameters.','Követhető kampányhivatkozásokat és egységes UTM-paramétereket készít.'],
 leads:['Manage website leads through their contact and conversion stages.','A weboldali érdeklődőket kezeli a kapcsolatfelvételtől a lezárásig.'],
 tracking_cookies:['Configure consent-based analytics, Clarity and Search Console connections.','A hozzájárulás-alapú analitikai, Clarity- és Search Console-kapcsolatokat kezeli.'],
 seo_keywords:['Edit page SEO titles, descriptions, keywords and structured content.','Az oldalak SEO-címeit, leírásait, kulcsszavait és strukturált tartalmát szerkeszti.'],
 heatmap:['Review consented interaction and first-party heatmap measurements.','A hozzájárulással rögzített interakciós és első fél által mért hőtérképadatokat mutatja.'],
 scheduler:['Review the daily and weekly internal work calendar.','A napi és heti belső munkanaptárt mutatja.'],
 planned_jobs:['Track planned work that is not yet on the active calendar.','A még aktív naptárba nem helyezett tervezett munkákat kezeli.'],
 contacts:['Review all client and customer relationship records.','Az összes ügyfél- és ügyfélkapcsolati rekordot mutatja.'],
 pianos:['Review Klavierhaus-managed customer piano records and ownership.','A Klavierhaus által kezelt ügyfélzongorák és tulajdonosi adataik találhatók itt.'],
 inventory:['Track inventory items, condition, location and status.','A leltári tételek állapotát, helyét és státuszát kezeli.'],
 closed_jobs:['Review completed and closed operational jobs.','A befejezett és lezárt operatív munkákat mutatja.'],
 knowledge_base:['Company contracts, permits, agreements and technical documents.','Céges szerződések, engedélyek, megállapodások és műszaki dokumentumok.'],
 finance:['Review the operating balance, cashflow and core financial KPIs.','Az operatív egyenleget, cashflow-t és fő pénzügyi KPI-kat mutatja.'],
 invoice_documents:['Manage receivables, payables, manual invoices, previews and invoice PDFs.','A követeléseket, kötelezettségeket, kézi számlákat, előnézeteket és számla-PDF-eket kezeli.'],
 income_statement:['Review income statement periods and their financial effect.','Az eredménykimutatási időszakokat és pénzügyi hatásukat mutatja.'],
 users:['Manage staff accounts, roles and personal settings.','A munkatársi fiókokat, jogosultságokat és személyes beállításokat kezeli.'],
 audit_log:['Review the auditable history of operational changes.','Az operatív módosítások naplózott történetét mutatja.'],
 backups:['Review and manage database backups according to role permissions.','A szerepkör szerinti adatbázis-mentéseket mutatja és kezeli.'],
 settings:['Manage application settings and operating preferences.','Az alkalmazás beállításait és működési preferenciáit kezeli.'],
 company_data:['Maintain the legal company identity used on invoices and documents.','A számlákon és dokumentumokon használt hivatalos cégadatokat kezeli.']
});
function adminCardIsEnabled(groupId,key){return adminModuleState[groupId]!==false&&adminCardState[key]!==false;}
function bindAdminGroupLanding(box){
 const search=box.querySelector("[data-admin-card-search]");
 const filter=()=>{
  const query=String(search?.value||"").trim().toLowerCase();
  box.querySelectorAll("[data-admin-card]").forEach(card=>card.classList.toggle("hidden",Boolean(query)&&!card.dataset.search.includes(query)));
 };
 search?.addEventListener("input",filter);
 box.querySelectorAll("[data-admin-card]").forEach(card=>{
  const open=()=>{if(card.dataset.enabled==="true")render(card.dataset.view);};
  card.addEventListener("click",event=>{if(event.target.closest("button"))return;open();});
  card.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&!event.target.closest("button")){event.preventDefault();open();}});
 });
 box.querySelectorAll("[data-admin-card-open]").forEach(button=>button.addEventListener("click",()=>{if(button.dataset.enabled==="true")render(button.dataset.view);}));
 box.querySelectorAll("[data-admin-card-toggle]").forEach(button=>button.addEventListener("click",async event=>{
  event.stopPropagation();
  await toggleAdminModule(button.dataset.moduleKey,button.dataset.enabled!=="true");
 }));
 box.querySelectorAll("[data-admin-group-toggle]").forEach(button=>button.addEventListener("click",async event=>{
  event.stopPropagation();
  await toggleAdminModule(button.dataset.moduleKey,button.dataset.enabled!=="true");
 }));
}
async function renderAdminGroupLanding(groupId){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 const group=adminNavGroups.find(item=>item.id===groupId); if(!group)return showError('MODULE_NOT_FOUND');
 if(!isSuperadmin()&&!adminViewEnabled(groupId))return showError('MODULE_DISABLED');
 const box=ensureView(groupId),groupEnabled=adminModuleState[group.id]!==false;
 const label=currentLang==='hu'?group.label[1]:group.label[0];
 const visibleItems=group.items.filter(([view])=>isSuperadmin()||adminCardIsEnabled(group.id,view));
 const cards=visibleItems.map(([view,en,hu,icon])=>{
  const enabled=adminCardIsEnabled(group.id,view),cardLabel=currentLang==='hu'?hu:en;
  const description=adminCardDescriptions[view];
  return `<article class="admin-ia-card ${enabled?'':'is-disabled'}" data-admin-card data-view="${view}" data-enabled="${enabled}" data-search="${htmlText(`${en} ${hu}`.toLowerCase())}" tabindex="0" role="button" aria-disabled="${enabled?'false':'true'}"><div class="admin-ia-card__head"><span class="admin-ia-card__icon" aria-hidden="true">${adminPremiumIcon(view,icon)}</span><div><p class="event-kicker">${htmlText(label)}</p><h3>${htmlText(cardLabel)}</h3></div></div><p class="admin-ia-card__description">${enabled?(description?bi(description[0],description[1]):bi('Open this workspace','Munkaterület megnyitása')):bi('This card is disabled by the superadmin.','Ezt a kártyát a szuperadmin kikapcsolta.')}</p><div class="admin-ia-card__actions"><button type="button" class="small admin-ia-open" data-admin-card-open data-view="${view}" data-enabled="${enabled}" ${enabled?'':'disabled'}>${bi('Open','Megnyitás')}</button>${isSuperadmin()?`<button type="button" class="small ${enabled?'danger-btn':'ghost-btn'}" data-admin-card-toggle data-module-key="${view}" data-enabled="${enabled}">${enabled?bi('Disable card','Kártya kikapcsolása'):bi('Enable card','Kártya bekapcsolása')}</button>`:''}</div></article>`;
 }).join('');
 box.innerHTML=`${mobileBackHeader(label)}<div class="panel admin-ia-shell"><div class="admin-ia-heading"><div><p class="event-kicker">${bi('Admin workspace','Admin munkaterület')}</p><h2>${htmlText(label)}</h2><p class="muted">${bi('Choose a workspace from the cards below. The sidebar contains the four primary areas.','Válassz munkaterületet az alábbi kártyák közül. Az oldalsáv kizárólag a négy fő területet tartalmazza.')}</p></div>${isSuperadmin()?`<button type="button" class="${groupEnabled?'danger-btn':'ghost-btn'}" data-admin-group-toggle data-module-key="${group.id}" data-enabled="${groupEnabled}">${groupEnabled?bi('Disable area','Terület kikapcsolása'):bi('Enable area','Terület bekapcsolása')}</button>`:''}</div><div class="admin-ia-controls"><label class="admin-ia-search"><span>${bi('Search workspaces','Munkaterületek keresése')}</span><input type="search" data-admin-card-search placeholder="${bi('Search by name…','Keresés név alapján…')}" autocomplete="off"></label><span class="admin-ia-status ${groupEnabled?'':'is-disabled'}">${groupEnabled?bi('Area enabled','Terület bekapcsolva'):bi('Area disabled','Terület kikapcsolva')}</span></div><div class="admin-card-grid">${cards}</div></div>`;
 bindAdminGroupLanding(box);
}
async function renderAdminModuleOverview(view){
 if(!isAdmin())return showError('PERMISSION_DENIED');const box=$(`#${view}`),label=navLabel(view),isMarketing=adminNavGroups.find(group=>group.id==="marketing")?.items.some(item=>item[0]===view),websiteBase=websiteDesignMeta?.website_base_url||'';
 box.innerHTML=`${mobileBackHeader(label)}<div class="panel admin-module-overview"><p class="event-kicker">${isMarketing?bi('Marketing workspace','Marketing munkaterület'):bi('Website & events','Weboldal és események')}</p><h2>${htmlText(label)}</h2><p>${isMarketing?bi('This navigation destination is reserved for the approved analytics and SEO integration phase. No fabricated metrics are displayed before the verified provider connection is available.','Ez a menüpont a jóváhagyott analitikai és SEO-integrációs szakasz számára van fenntartva. Ellenőrzött szolgáltatói kapcsolat előtt nem jelenítünk meg kitalált mérőszámokat.'):bi('The approved destination is now part of the final information architecture. Its operational records are managed through Events or Pages & Content until the dedicated workflow is connected.','A jóváhagyott menüpont már a végleges információs architektúra része. Az operatív rekordok a külön munkafolyamat bekötéséig az Események vagy a Pages & Content felületen kezelhetők.')}</p><div class="actions"><button type="button" onclick="render('${isMarketing?'website_reviews':'pages_content'}')">${isMarketing?bi('Open reviews','Vélemények megnyitása'):bi('Open website editor','Weboldalszerkesztő megnyitása')}</button>${websiteBase?`<a class="button ghost-btn" href="${htmlText(websiteBase)}" target="_blank" rel="noopener noreferrer">${bi('Open public website','Nyilvános weboldal megnyitása')} ↗</a>`:''}</div></div>`;
}

let websiteDesignMeta=null;
let websiteDesignPage='home';
let websiteLandingSections=[];
let websiteLandingDragKey='';
let websiteDesignLanguage='en';
let websiteDesignDocument=null;
let websiteDesignTarget='pages_content';
let websiteDesignDraftId='';
let websiteDesignDirty=false;
let websiteThemeSettings={};

function websiteDesignLabel(key){
 const labels={seo:bi('Search appearance (SEO)','Keresési megjelenés (SEO)'),hero:bi('Hero section','Hero szekció'),sections:bi('Page sections','Oldalszekciók'),title:bi('Title','Cím'),description:bi('Description','Leírás'),eyebrow:bi('Eyebrow','Felső címke'),lead:bi('Lead text','Bevezető szöveg'),body:bi('Body text','Törzsszöveg'),image:bi('Image','Kép'),imageAlt:bi('Image alternative text','Kép alternatív szövege'),quote:bi('Review / quotation','Vélemény / idézet'),attribution:bi('Attribution','Szerző'),intro:bi('Introduction','Bevezető'),items:bi('Cards','Kártyák'),label:bi('Link label','Linkfelirat'),note:bi('Note','Megjegyzés'),paragraphs:bi('Paragraphs','Bekezdések'),list:bi('List','Lista'),details:bi('Details','Részletek'),value:bi('Value','Érték')};
 return labels[key]||String(key).replace(/_/g,' ').replace(/\b\w/g,character=>character.toUpperCase());
}
function websiteDesignPath(path){return htmlText(JSON.stringify(path));}
function websiteDesignSetPath(path,value){let target=websiteDesignDocument;for(let i=0;i<path.length-1;i+=1)target=target[path[i]];target[path.at(-1)]=value;}
function websiteDesignUpdate(input){const path=JSON.parse(input.dataset.contentPath);websiteDesignSetPath(path,input.type==='checkbox'?input.checked:input.value);websiteDesignDirty=true;websiteDesignDraftId='';}
function websiteDesignEditorNode(value,path=[],key='content'){
 const structural=new Set(['template','type','id','key','href','reverse']);
 if(structural.has(key))return '';
 if(Array.isArray(value))return `<fieldset class="website-design-group"><legend>${htmlText(websiteDesignLabel(key))}</legend>${value.map((item,index)=>websiteDesignEditorNode(item,[...path,index],`${key}_${index+1}`)).join('')}</fieldset>`;
 if(value&&typeof value==='object')return `<fieldset class="website-design-group"><legend>${htmlText(websiteDesignLabel(key))}</legend>${Object.entries(value).map(([childKey,item])=>websiteDesignEditorNode(item,[...path,childKey],childKey)).join('')}</fieldset>`;
 if(typeof value==='boolean')return `<label class="website-design-toggle"><input type="checkbox" data-content-path="${websiteDesignPath(path)}" ${value?'checked':''} onchange="websiteDesignUpdate(this)"><span>${htmlText(websiteDesignLabel(key))}</span></label>`;
 const stringValue=String(value??''),isImage=/image$/i.test(key)&&!/(alt)$/i.test(key),longText=stringValue.length>90||/(description|lead|body|quote|intro|paragraph|note)/i.test(key);
 return `<div class="field website-design-field ${isImage?'website-design-image-field':''}"><label>${htmlText(websiteDesignLabel(key))}</label>${isImage&&stringValue?`<img src="${htmlText(stringValue)}" alt="" loading="lazy">`:''}${longText?`<textarea rows="${Math.min(10,Math.max(3,Math.ceil(stringValue.length/90)))}" data-content-path="${websiteDesignPath(path)}" oninput="websiteDesignUpdate(this)">${htmlText(stringValue)}</textarea>`:`<input value="${htmlText(stringValue)}" data-content-path="${websiteDesignPath(path)}" oninput="websiteDesignUpdate(this)">`}${isImage?`<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" data-content-path="${websiteDesignPath(path)}" onchange="uploadWebsiteDesignImage(this)"><small>${bi('Upload JPG or PNG (minimum 600×400 px), or edit the URL above.','Tölts fel JPG vagy PNG képet (minimum 600×400 px), vagy módosítsd a fenti URL-t.')}</small>`:''}</div>`;
}

function websiteDesignTabs(){const tabs=[['home','Home'],['events','Concerts / Events'],['pianos','Catalog'],['story','About'],['contact','Contact']];return `<div class="website-page-tabs">${tabs.map(([key,label])=>`<button type="button" class="${websiteDesignPage===key?'active':''}" onclick="changeWebsiteDesignPage('${key}')">${label}</button>`).join('')}</div>`;}
function landingSectionLabel(key){return ({hero:'Hero',featured_pianos:'Featured Pianos',craftsmanship:'Craftsmanship',salon_events:'Salon Events',testimonials:'Testimonials',contact_cta:'Contact CTA'})[key]||key;}
function landingSectionManager(){if(websiteDesignPage!=='home')return '';return `<section class="landing-section-manager"><div class="workflow-block-head"><div><h3>${bi('Home sections','Főoldali szekciók')}</h3><p class="muted">${bi('Drag cards to reorder. Toggle controls both the public block and its related navigation link.','Húzd a kártyákat a sorrend módosításához. A kapcsoló a publikus blokkot és a kapcsolódó navigációs linket is vezérli.')}</p></div><button type="button" onclick="saveLandingSections()">${bi('Save section order','Szekciósorrend mentése')}</button></div><div class="landing-section-list">${websiteLandingSections.map(row=>`<article class="landing-section-card" draggable="true" data-landing-key="${htmlText(row.section_key)}" ondragstart="websiteLandingDragKey='${htmlText(row.section_key)}'" ondragover="event.preventDefault()" ondrop="reorderLandingSection('${htmlText(row.section_key)}')"><span class="landing-drag" aria-hidden="true">⋮⋮</span><strong>${htmlText(landingSectionLabel(row.section_key))}</strong><label class="landing-toggle"><input type="checkbox" ${Number(row.is_active)===1?'checked':''} onchange="toggleLandingSection('${htmlText(row.section_key)}',this.checked)"><span>${Number(row.is_active)===1?bi('On','Be'):bi('Off','Ki')}</span></label></article>`).join('')}</div></section>`;}
async function toggleLandingSection(key,active){const row=websiteLandingSections.find(item=>item.section_key===key);if(row)row.is_active=active?1:0;await saveLandingSections();}
async function reorderLandingSection(targetKey){if(!websiteLandingDragKey||websiteLandingDragKey===targetKey)return;const from=websiteLandingSections.findIndex(row=>row.section_key===websiteLandingDragKey),to=websiteLandingSections.findIndex(row=>row.section_key===targetKey);if(from<0||to<0)return;const [row]=websiteLandingSections.splice(from,1);websiteLandingSections.splice(to,0,row);websiteLandingSections.forEach((item,index)=>item.order_index=index);websiteLandingDragKey='';await saveLandingSections();}
async function saveLandingSections(){try{websiteLandingSections=await api('/api/landing-sections',{method:'PUT',body:JSON.stringify({sections:websiteLandingSections})});renderWebsiteDesignEditor();showToast(bi('Landing sections saved.','A főoldali szekciók mentve.'),'success');}catch(error){showError(error)}}
function websiteDesignPageOptions(){return (websiteDesignMeta?.pages||[]).map(page=>`<option value="${htmlText(page.page_key)}" ${page.page_key===websiteDesignPage?'selected':''}>${htmlText(currentLang==='hu'?page.title_hu:page.title_en)}</option>`).join('');}
function websiteDesignPreviewUrl(){const selected=(websiteDesignMeta?.pages||[]).find(page=>page.page_key===websiteDesignPage),route=selected?.routes?.[websiteDesignLanguage]||'/';return `${String(websiteDesignMeta?.website_base_url||'').replace(/\/$/,'')}${route}`;}
function websiteDesignRouteEditor(){const page=(websiteDesignMeta?.pages||[]).find(item=>item.page_key===websiteDesignPage),routes=page?.routes||{};if(!page||websiteDesignPage==='global')return '';return `<div class="website-design-route-editor"><label>${bi('English URL slug','Angol URL-slug')}<input id="websiteRouteEn" value="${htmlText(routes.en||'')}" pattern="/[A-Za-z0-9/_-]+" required></label><label>${bi('Hungarian URL slug','Magyar URL-slug')}<input id="websiteRouteHu" value="${htmlText(routes.hu||'')}" pattern="/[A-Za-z0-9/_-]+" required></label><button type="button" class="small ghost-btn" onclick="saveWebsiteDesignRoutes()">${bi('Save URLs','URL-ek mentése')}</button></div>`;}
function websiteThemeEditor(){const fields=[['black','Page background','Oldal háttér'],['ivory','Primary text','Elsődleges szöveg'],['cream','Secondary text','Másodlagos szöveg'],['gold','Gold accent','Arany kiemelés'],['gold_bright','Bright gold','Világos arany'],['muted','Muted text','Halvány szöveg']];return `<fieldset class="website-theme-editor"><legend>${bi('Global visual design','Globális vizuális dizájn')}</legend><div class="website-theme-grid">${fields.map(([key,en,hu])=>`<label>${bi(en,hu)}<span><input type="color" data-theme-key="${key}" value="${/^#[0-9a-f]{6}$/i.test(websiteThemeSettings[key]||'')?websiteThemeSettings[key]:'#080807'}"><input data-theme-text="${key}" value="${htmlText(websiteThemeSettings[key]||'')}" maxlength="20"></span></label>`).join('')}<label>${bi('Display font','Címbetű')}<input data-theme-text="display" value="${htmlText(websiteThemeSettings.display||'')}" maxlength="100"></label><label>${bi('Body font','Törzsszöveg betűje')}<input data-theme-text="sans" value="${htmlText(websiteThemeSettings.sans||'')}" maxlength="100"></label><label class="website-theme-wide">${bi('Logo URL','Logó URL')}<input data-theme-text="logo_url" value="${htmlText(websiteThemeSettings.logo_url||'')}" maxlength="500"></label></div><button type="button" class="small" onclick="saveWebsiteThemeSettings()">${bi('Save global design','Globális dizájn mentése')}</button></fieldset>`;}
async function saveWebsiteThemeSettings(){const body={...websiteThemeSettings};document.querySelectorAll('[data-theme-text]').forEach(input=>{body[input.dataset.themeText]=input.value;});document.querySelectorAll('[data-theme-key]').forEach(input=>{body[input.dataset.themeKey]=input.value;});try{websiteThemeSettings=await api('/api/website-design-settings',{method:'PUT',body:JSON.stringify(body)});renderWebsiteDesignEditor();showToast(bi('Global visual design saved.','A globális vizuális dizájn mentve.'),'success');}catch(error){showError(error)}}
async function saveWebsiteDesignRoutes(){try{const response=await api(`/api/website-content/${encodeURIComponent(websiteDesignPage)}/routes`,{method:'PUT',body:JSON.stringify({en:$('#websiteRouteEn')?.value,hu:$('#websiteRouteHu')?.value})});const page=(websiteDesignMeta.pages||[]).find(item=>item.page_key===websiteDesignPage);if(page)page.routes=response.routes;showToast(bi('Public URLs saved.','A publikus URL-ek mentve.'),'success');}catch(error){showError(error)}}
function renderWebsiteDesignEditor(){
 const box=$(`#${websiteDesignTarget}`);if(!box||!websiteDesignDocument)return;
 box.innerHTML=`${mobileBackHeader(bi('Pages & Content','Oldalak és tartalmak'))}<div class="panel website-design-shell">${websiteDesignTabs()}<div class="toolbar website-design-toolbar"><div><p class="event-kicker">${bi('Website & events · controlled publication','Weboldal és események · ellenőrzött publikálás')}</p><h2>${bi('Pages & Content','Oldalak és tartalmak')}</h2><p class="muted">${bi('Edit every public page and SEO field. Save a draft, review its expiring noindex preview, then publish that exact version.','Szerkeszd az összes nyilvános oldalt és SEO-mezőt. Ments piszkozatot, ellenőrizd a lejáró noindex előnézetet, majd publikáld pontosan azt a verziót.')}</p></div><div class="actions"><button type="button" class="ghost-btn" onclick="saveWebsiteDesignDraft()">${bi('Save draft','Piszkozat mentése')}</button><button type="button" class="ghost-btn" onclick="previewCurrentWebsiteDraft()">${bi('Preview draft','Piszkozat előnézete')} ↗</button><button type="button" onclick="publishCurrentWebsiteDraft()">${bi('Publish saved draft','Mentett piszkozat publikálása')}</button></div></div>${websiteThemeEditor()}<div class="website-design-controls"><label>${bi('Page','Oldal')}<select onchange="changeWebsiteDesignPage(this.value)">${websiteDesignPageOptions()}</select></label><label>${bi('Content language','Tartalom nyelve')}<select onchange="changeWebsiteDesignLanguage(this.value)"><option value="en" ${websiteDesignLanguage==='en'?'selected':''}>American English</option><option value="hu" ${websiteDesignLanguage==='hu'?'selected':''}>Magyar</option></select></label><span class="event-status">${websiteDesignDirty?bi('Unsaved changes','Nem mentett módosítás'):websiteDesignDraftId?bi('Draft saved','Piszkozat mentve'):bi('Published source','Publikált forrás')}</span></div>${landingSectionManager()}${websiteDesignRouteEditor()}<div class="website-design-editor">${websiteDesignEditorNode(websiteDesignDocument,[],'page')}</div><div class="website-design-savebar"><button type="button" class="ghost-btn" onclick="saveWebsiteDesignDraft()">${bi('Save draft','Piszkozat mentése')}</button><button type="button" onclick="publishCurrentWebsiteDraft()">${bi('Publish saved draft','Mentett piszkozat publikálása')}</button></div></div>`;
 applyLanguageToDOM(box);enhanceCustomSelects(box);enhanceWebsiteFileInputs(box);
}
async function loadWebsiteDesignDocument(){const result=await api(`/api/website-content/${encodeURIComponent(websiteDesignPage)}?lang=${websiteDesignLanguage}`);websiteDesignDocument=result.content;websiteDesignDraftId='';websiteDesignDirty=false;renderWebsiteDesignEditor();}
async function renderWebsiteDesign(target='pages_content'){if(!isAdmin())return showError('PERMISSION_DENIED');websiteDesignTarget=target;websiteDesignLanguage=currentLang==='hu'?'hu':'en';[websiteDesignMeta,websiteThemeSettings,websiteLandingSections]=await Promise.all([api('/api/website-content/pages'),api('/api/website-design-settings').catch(()=>({})),api('/api/landing-sections').catch(()=>[])]);if(!(websiteDesignMeta.pages||[]).some(page=>page.page_key===websiteDesignPage))websiteDesignPage=websiteDesignMeta.pages?.[0]?.page_key||'home';await loadWebsiteDesignDocument();}
async function changeWebsiteDesignPage(value){websiteDesignPage=value;await loadWebsiteDesignDocument();}
async function changeWebsiteDesignLanguage(value){websiteDesignLanguage=value==='hu'?'hu':'en';await loadWebsiteDesignDocument();}
async function uploadWebsiteDesignImage(input){try{const file=input.files?.[0];if(!file)return;const data=new FormData();data.set('website_image',file);const uploaded=await api('/api/website-content/image',{method:'POST',body:data});websiteDesignSetPath(JSON.parse(input.dataset.contentPath),uploaded.absolute_url||uploaded.image_url);websiteDesignDirty=true;websiteDesignDraftId='';renderWebsiteDesignEditor();showToast(bi('Image uploaded. Save a draft before preview or publication.','A kép feltöltve. Előnézet vagy publikálás előtt ments piszkozatot.'),'success');}catch(error){input.value='';showError(error)}}
async function saveWebsiteDesignDraft(){try{const row=await api(`/api/website-content/${encodeURIComponent(websiteDesignPage)}/drafts`,{method:'POST',body:JSON.stringify({language:websiteDesignLanguage,content:websiteDesignDocument})});websiteDesignDraftId=row.id;websiteDesignDirty=false;renderWebsiteDesignEditor();showToast(`${bi('Draft saved','Piszkozat mentve')} · v${Number(row.version||0)}`,'success');return row;}catch(error){showError(error);return null}}
async function ensureWebsiteDesignDraft(){if(websiteDesignDirty||!websiteDesignDraftId){const row=await saveWebsiteDesignDraft();return row?.id||''}return websiteDesignDraftId}
async function previewCurrentWebsiteDraft(){const id=await ensureWebsiteDesignDraft();if(!id)return;await previewWebsiteVersion(websiteDesignPage,id)}
async function publishCurrentWebsiteDraft(){const id=await ensureWebsiteDesignDraft();if(!id)return;if(!await appConfirm(bi('Publish this reviewed draft atomically?','Publikáljuk ezt az ellenőrzött piszkozatot atomikusan?')))return;try{await api(`/api/website-content/${encodeURIComponent(websiteDesignPage)}/versions/${encodeURIComponent(id)}/publish`,{method:'POST',body:'{}'});showToast(bi('Website version published.','A weboldalverzió publikálva.'),'success');await loadWebsiteDesignDocument();}catch(error){showError(error)}}
async function saveWebsiteDesign(){return publishCurrentWebsiteDraft()}

async function renderAuditLog(){
 if(!isAdmin()&&!userPermissions.permissions.includes('audit.view')&&!userPermissions.all)return showError('PERMISSION_DENIED');
 const rows=await api(`/api/audit-log?limit=1000&type=${currentAuditType}`); const box=$('#audit_log');
 box.innerHTML=`${mobileBackHeader(bi('Audit Log','Módosítási napló'))}<div class="panel"><div class="audit-type-switch"><button class="${currentAuditType==='WORK'?'active':''}" onclick="setAuditType('WORK')">${bi('Work Audit','Munkaaudit')}</button><button class="${currentAuditType==='TECHNICAL'?'active':''}" onclick="setAuditType('TECHNICAL')">${bi('Technical Audit','Technikai audit')}</button></div><div class="toolbar"><h3>${currentAuditType==='WORK'?bi('Work Audit','Munkaaudit'):bi('Technical Audit','Technikai audit')}</h3><div>${isSuperadmin()?`<button class="small" onclick="downloadAuditLog()">${bi('Export CSV','CSV export')}</button><button class="small danger-btn" onclick="clearAuditLog()">${bi('Delete current log','Aktuális napló törlése')}</button>`:''}</div></div><div class="table-wrap"><table><thead><tr><th>${bi('Time','Idő')}</th><th>${bi('User','Felhasználó')}</th><th>${bi('Role','Szerepkör')}</th><th>${bi('Action','Művelet')}</th><th>${bi('Module','Modul')}</th><th>ID</th><th>${bi('Old value','Régi érték')}</th><th>${bi('New value','Új érték')}</th><th>${bi('Details','Részletek')}</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.event_time||''}</td><td>${x.user_name||''}</td><td>${x.user_role||''}</td><td>${x.action||''}</td><td>${x.module||''}</td><td>${x.record_id||''}</td><td>${x.old_value||''}</td><td>${x.new_value||''}</td><td>${x.details||''}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function setAuditType(type){currentAuditType=type==='TECHNICAL'?'TECHNICAL':'WORK';renderAuditLog();}
async function setRolePermission(role,permission,enabled){try{await api('/api/settings/permissions',{method:'PUT',body:JSON.stringify({role,permission,enabled})});}catch(e){showError(e);renderSettings();}}
async function downloadAuditLog(){const r=await fetch(`/api/audit-log/export?type=${currentAuditType}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return showError((await r.json()).error);const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=currentAuditType==='WORK'?'work-audit.csv':'technical-audit.csv';a.click();URL.revokeObjectURL(a.href);}
async function clearAuditLog(){if(!isSuperadmin())return;if(await appConfirm(bi('Delete the complete audit log?','Töröljük a teljes módosítási naplót?'),{type:'error',confirmText:bi('Delete log','Napló törlése')})){await api(`/api/audit-log?type=${currentAuditType}`,{method:'DELETE'});renderSettings();}}
async function createBackupNow(){try{await api('/api/backups',{method:'POST'});await appAlert(bi('Backup created successfully.','A biztonsági mentés elkészült.'),'success');currentView==='backups'?renderBackupsView():renderSettings();}catch(e){showError(e)}}
async function downloadBackup(id){const r=await fetch(`/api/backups/${id}/download`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return showError((await r.json()).error);const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=r.headers.get('content-disposition')?.match(/filename="?([^";]+)/)?.[1]||'backup.sqlite';a.click();URL.revokeObjectURL(a.href);}
async function restoreBackup(id){const confirmation=await appPrompt(bi('Type RESTORE BACKUP to continue.','A folytatáshoz írd be: RESTORE BACKUP'),{type:'error',confirmText:bi('Continue','Folytatás')});if(confirmation!=='RESTORE BACKUP')return;const password=await appPrompt(bi('Enter your password.','Add meg a jelszavad.'),{type:'warning',inputType:'password',confirmText:bi('Restore backup','Mentés visszaállítása')});if(password===null)return;try{await api(`/api/backups/${id}/restore`,{method:'POST',body:JSON.stringify({confirmation,password})});await appAlert(bi('Backup restored. Restart the server now.','A mentés visszaállt. Most indítsd újra a szervert.'),'success');logoutNow();}catch(e){showError(e)}}

function initLocalizedModalRendering(){
 const modal=document.getElementById("modal"),form=document.getElementById("form");
 if(!modal||!form||window.__khModalLanguageObserver)return;
 const observer=new MutationObserver(()=>{
  modal.classList.add("i18n-rendering");
  queueMicrotask(()=>{
   applyLanguageToDOM(modal);
   enhanceWebsiteFileInputs(modal);
   modal.classList.remove("i18n-rendering");
  });
 });
 observer.observe(form,{childList:true});
 window.__khModalLanguageObserver=observer;
}

initLoginExperience();
initLocalizedModalRendering();
window.addEventListener("unhandledrejection",event=>{if(applicationBooting){console.error("Unhandled rejection during bootstrap",event.reason);handleApplicationBootstrapError(event.reason||new Error("BOOT_UNHANDLED_REJECTION"));}});
window.addEventListener("error",event=>{if(applicationBooting){console.error("Unhandled error during bootstrap",event.error||event.message);handleApplicationBootstrapError(event.error||new Error(event.message||"BOOT_UNHANDLED_ERROR"));}});
if(token){loadLanguage();enforceDarkAppearance();void boot().catch(handleApplicationBootstrapError);}else{loadLanguage();enforceDarkAppearance();applyLanguageToDOM(document.getElementById("login"));loadBranding().then(()=>applyLanguageToDOM(document.getElementById("login")));}





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
const marketingSeoPages=[['home','Home','Főoldal'],['story','Our story','Történetünk'],['pianos','Pianos','Zongorák'],['steinway','Steinway pianos','Steinway zongorák'],['services','Services','Szolgáltatások'],['restoration','Restoration','Felújítás'],['tuning','Tuning','Hangolás'],['concert','Concert piano','Koncertzongora'],['artists','Artists','Művészek'],['events','Events','Események'],['salon','Salon','Szalon'],['mission','Culture','Kultúra'],['contact','Contact','Kapcsolat'],['privacy','Privacy','Adatvédelem'],['ticketTerms','Ticket terms','Jegyvásárlási feltételek']];
function seoKeywordText(value){return (Array.isArray(value)?value:[]).join('\n')}
async function renderMarketingSeo(){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 const settings=await api('/api/marketing/seo'),box=$('#seo_keywords');window.__marketingSeo=settings;
 const disabled='';
 const pageFields=marketingSeoPages.map(([key,en,hu])=>`<div class="field seo-page-keywords"><label>${bi(en,hu)}</label><textarea name="page_en_${key}" rows="3"${disabled}>${htmlText(seoKeywordText(settings.page_keywords_en?.[key]))}</textarea><small>English</small><textarea name="page_hu_${key}" rows="3"${disabled}>${htmlText(seoKeywordText(settings.page_keywords_hu?.[key]))}</textarea><small>Magyar</small></div>`).join('');
 box.innerHTML=`${mobileBackHeader(bi('SEO & Keywords','SEO és kulcsszavak'))}<div class="panel marketing-shell"><div class="toolbar"><div><p class="event-kicker">${bi('Search visibility controls','Keresési láthatóság beállításai')}</p><h2>${bi('SEO & Keywords','SEO és kulcsszavak')}</h2><p class="muted">${bi('Set the phrases the website should target by language and page. The public renderer keeps visible copy natural and publishes the targets through page metadata and structured data.','Állítsd be nyelvenként és oldalonként azokat a kifejezéseket, amelyekre a weboldal célozzon. A nyilvános renderer természetes szöveget tart meg, a célokat pedig oldalmetaadatban és strukturált adatokban publikálja.')}</p></div><span class="integration-status connected">${settings.enabled?bi('Enabled','Bekapcsolva'):bi('Disabled','Kikapcsolva')}</span></div><form class="seo-settings-form" data-seo-form><div class="form-grid"><div class="field full"><label>${bi('Global English keywords — one phrase per line','Globális angol kulcsszavak — soronként egy kifejezés')}</label><textarea name="global_keywords_en" rows="5"${disabled}>${htmlText(seoKeywordText(settings.global_keywords_en))}</textarea></div><div class="field full"><label>${bi('Global Hungarian keywords — one phrase per line','Globális magyar kulcsszavak — soronként egy kifejezés')}</label><textarea name="global_keywords_hu" rows="5"${disabled}>${htmlText(seoKeywordText(settings.global_keywords_hu))}</textarea></div><label class="check-row"><input name="enabled" type="checkbox" ${settings.enabled?'checked':''}${disabled}> ${bi('Publish SEO targets','SEO-célok publikálása')}</label></div><h3>${bi('Optional page-specific targets','Opcionális oldalankénti célok')}</h3><p class="muted">${bi('Page keywords are added to the global list for that page. Do not repeat phrases unnaturally in visible copy.','Az oldalankénti kulcsszavak az adott oldal globális listájához adódnak. Ne ismételd őket természetellenesen a látható szövegben.')}</p><div class="seo-page-grid">${pageFields}</div><div class="actions"><button type="submit"${disabled}>${bi('Save SEO settings','SEO-beállítások mentése')}</button></div></form><aside class="seo-guidance"><strong>${bi('Important: Google does not rank pages because of a keyword list alone.','Fontos: a Google önmagában egy kulcsszólista miatt nem sorolja előre az oldalt.')}</strong><span>${bi('Ranking depends on useful content, technical accessibility, relevance, links, speed and search intent. This module keeps title, description, headings and structured data aligned with your chosen targets without keyword stuffing.','A helyezést a hasznos tartalom, a technikai elérhetőség, a relevancia, a hivatkozások, a sebesség és a keresési szándék együtt határozza meg. Ez a modul a címet, leírást, címsorokat és strukturált adatokat hangolja össze a választott célokkal, kulcsszóhalmozás nélkül.')}</span></aside></div>`;
 const seoToolbar=box.querySelector('.marketing-shell>.toolbar');if(seoToolbar){const actions=document.createElement('div');actions.className='toolbar-actions';actions.innerHTML=`<button type="button" class="ghost-btn" onclick="runMarketingSeoAudit()">${bi('Run SEO audit','SEO-audit futtatása')}</button>`;seoToolbar.appendChild(actions);}
 const seoAuditPanel=document.createElement('section');seoAuditPanel.id='seoAuditPanel';seoAuditPanel.className='seo-audit-panel';seoAuditPanel.innerHTML=`<h3>${bi('Content and metadata audit','Tartalmi és metaadat-audit')}</h3><p class="muted">${bi('Run the deterministic audit to see missing titles, descriptions or target keywords.','Futtasd a determinisztikus auditot a hiányzó címek, leírások vagy célkulcsszavak ellenőrzéséhez.')}</p>`;box.querySelector('.marketing-shell')?.appendChild(seoAuditPanel);
 applyLanguageToDOM(box);
 box.querySelector('[data-seo-form]')?.addEventListener('submit',async event=>{
  event.preventDefault();if(!isAdmin())return showError('PERMISSION_DENIED');
  const data=new FormData(event.currentTarget),body={enabled:data.has('enabled'),global_keywords_en:String(data.get('global_keywords_en')||''),global_keywords_hu:String(data.get('global_keywords_hu')||''),page_keywords_en:{},page_keywords_hu:{}};
  marketingSeoPages.forEach(([key])=>{body.page_keywords_en[key]=String(data.get(`page_en_${key}`)||'');body.page_keywords_hu[key]=String(data.get(`page_hu_${key}`)||'')});
  try{await api('/api/marketing/seo',{method:'PUT',body:JSON.stringify(body)});showToast(bi('SEO settings saved.','A SEO-beállítások mentve.'),'success');await renderMarketingSeo();}catch(error){showError(error)}
 });
}
async function runMarketingSeoAudit(){
 try{const result=await api('/api/marketing/seo/audit'),panel=$('#seoAuditPanel');if(!panel)return;const pages=result.pages||[];panel.innerHTML=`<div class="toolbar"><div><h3>${bi('Content and metadata audit','Tartalmi és metaadat-audit')}</h3><p class="muted">${bi('This checks editable metadata and keyword targets. It does not promise a Google ranking.','Ez a szerkeszthető metaadatokat és kulcsszócélokat ellenőrzi. Google-helyezést nem ígér.')}</p></div><span class="integration-status connected">${pages.length} ${bi('pages','oldal')}</span></div><div class="seo-audit-table table-wrap"><table><thead><tr><th>${bi('Page','Oldal')}</th><th>EN</th><th>HU</th></tr></thead><tbody>${pages.map(page=>`<tr><td><strong>${htmlText(page.page_key)}</strong></td>${page.languages.map(language=>`<td><span class="seo-score ${language.score===100?'is-good':'is-warning'}">${Number(language.score)}%</span><small>${Number(language.keyword_count)} ${bi('keywords','kulcsszó')}${language.issues.length?` · ${htmlText(language.issues.join(', '))}`:` · ${bi('OK','Rendben')}`}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">${htmlText(result.note||'')}</p>`;applyLanguageToDOM(panel);}catch(error){showError(error)}
}
async function renderMarketingHeatmap(days=30,sourcePath=''){
 if(!isAdmin())return showError('PERMISSION_DENIED');
 const query=new URLSearchParams({days:String(days)});if(sourcePath)query.set('path',sourcePath);
 const data=await api(`/api/marketing/heatmap?${query.toString()}`),box=$('#heatmap');
 const max=Math.max(1,...(data.cells||[]).map(cell=>Number(cell.value)||0));
 const exitMax=Math.max(1,...(data.exit_cells||[]).map(cell=>Number(cell.value)||0));
 const cells=(data.cells||[]).map(cell=>`<span class="heatmap-cell" style="grid-column:${Number(cell.x)+1};grid-row:${Number(cell.y)+1};--heat:${Math.min(1,Math.max(.08,Number(cell.value||0)/max)).toFixed(3)}" title="${Number(cell.value||0)} pointer samples"></span>`).join('');
 const exits=(data.exit_cells||[]).map(cell=>`<span class="heatmap-cell heatmap-cell--exit" style="grid-column:${Number(cell.x)+1};grid-row:${Number(cell.y)+1};--heat:${Math.min(1,Math.max(.12,Number(cell.value||0)/exitMax)).toFixed(3)}" title="${Number(cell.value||0)} estimated last interactions"></span>`).join('');
 const pathOptions=(data.paths||[]).map(row=>`<option value="${htmlText(row.source_path||'')}" ${sourcePath===row.source_path?'selected':''}>${htmlText(row.source_path||'/')} · ${Number(row.batches||0)} batches</option>`).join('');
 const total=data.totals||{};
 box.innerHTML=`${mobileBackHeader(bi('Consent Heatmap','Hozzájárulásos hőtérkép'))}<div class="panel marketing-shell"><div class="toolbar"><div><p class="event-kicker">${bi('Privacy-first behaviour signal','Adatvédelmi szempontú viselkedési jel')}</p><h2>${bi('Consent Heatmap','Hozzájárulásos hőtérkép')}</h2><p class="muted">${bi('Only coarse, consented pointer cells are stored. No keystrokes, form values, names or raw coordinates are collected. Last interaction is an estimate, not a proof of abandonment.','Csak durva, hozzájárulással gyűjtött kurzorcellák kerülnek tárolásra. Billentyűleütést, űrlapértéket, nevet vagy nyers koordinátát nem gyűjtünk. Az utolsó interakció becslés, nem bizonyíték az oldal elhagyására.')}</p></div></div><form class="heatmap-filters" data-heatmap-form><label>${bi('Period','Időszak')}<select name="days"><option value="7" ${days===7?'selected':''}>7 ${bi('days','nap')}</option><option value="30" ${days===30?'selected':''}>30 ${bi('days','nap')}</option><option value="90" ${days===90?'selected':''}>90 ${bi('days','nap')}</option></select></label><label>${bi('Page','Oldal')}<select name="path"><option value="">${bi('All pages','Minden oldal')}</option>${pathOptions}</select></label><button type="submit">${bi('Refresh','Frissítés')}</button></form><div class="marketing-kpis heatmap-kpis"><article><small>${bi('Batches','Mérési csomagok')}</small><strong>${Number(total.batches||0)}</strong></article><article><small>${bi('Unique sessions','Egyedi munkamenetek')}</small><strong>${Number(total.unique_sessions||0)}</strong></article><article><small>${bi('Max scroll','Legnagyobb görgetés')}</small><strong>${Math.round(Number(total.max_scroll_ratio||0)*100)}%</strong></article><article><small>${bi('Average time','Átlagos idő')}</small><strong>${Math.round(Number(total.average_duration_ms||0)/1000)}s</strong></article></div><div class="heatmap-legend"><span><i class="heatmap-legend__move"></i>${bi('Pointer activity','Kurzoraktivitás')}</span><span><i class="heatmap-legend__exit"></i>${bi('Estimated last interaction','Becsült utolsó interakció')}</span></div><div class="heatmap-surface" aria-label="${bi('Consent heatmap','Hozzájárulásos hőtérkép')}">${cells}${exits}</div><p class="muted heatmap-note">${bi('The surface is normalized to 24 × 32 cells and is aggregated by page path over the selected period. Use it together with Analytics and Clarity; it cannot identify an individual visitor.','A felület 24 × 32 cellára normalizált, és az adott időszak oldalútvonalai szerint összesített adat. Használd az Analytics és a Clarity adataival együtt; egyéni látogatót nem azonosít.')}</p></div>`;
 applyLanguageToDOM(box);
 box.querySelector('[data-heatmap-form]')?.addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget);renderMarketingHeatmap(Number(form.get('days')||30),String(form.get('path')||''))});
}
