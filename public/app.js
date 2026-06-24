
let token=localStorage.getItem("kh_token");
let user=JSON.parse(localStorage.getItem("kh_user")||"null");
let currentWeekStart=startOfWeek(new Date());

const navs={
 ADMIN:[["scheduler","Scheduler / Naptár"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["accounts","General Ledger / Főkönyv"],["users","Users / Felhasználók"]],
 MANAGER:[["scheduler","Scheduler / Naptár"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["accounts","General Ledger / Főkönyv"],["users","Users / Felhasználók"]],
 WORKER:[["scheduler","Scheduler / Naptár"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["closed_jobs","Closed Jobs / Lezárt munkák"],["knowledge_base","Invoices / Számlák"]]
};

const schemas={
contacts:{api:"contacts",title:"Clients / Ügyfelek",fields:[["name","Client name / Ügyfél neve *"],["company","Company / Cég"],["type","Type / Típus"],["email","Email"],["phone","Phone / Telefonszám"],["address","Address / Cím"],["owner","Relationship owner / Kapcsolattartó gazda"],["last_contact","Last contact / Utolsó kapcsolat","date"],["next_step","Next step / Következő lépés"],["notes","Notes / Megjegyzés","textarea"]],cols:["id","name","phone","address","last_contact","next_step"]},
pianos:{api:"pianos",title:"Pianos / Zongorák",fields:[["brand","Brand / Márka"],["model","Model / Típus / modell"],["serial_no","Serial No. / Gyári szám"],["ownership_type","Ownership / Tulajdon","select",["Customer owned","Company owned"]],["owner_contact_id","Owner Contact ID / Ügyfél ID"],["location","Location / Helyszín"],["estimated_value","Estimated value / Becsült érték - csak céges tulajdonnál","number"]],cols:["id","brand","model","serial_no","ownership_type","owner_contact_id","location","estimated_value"]},
knowledge_base:{api:"knowledge_base",title:"Invoices / Számlák",fields:[["title","Title / Cím"],["category","Category / Kategória"],["content_type","Content type / Tartalomtípus"],["body","Body / Tartalom","textarea"],["stored_path","Attachment path / Melléklet útvonal"],["owner","Relationship owner / Kapcsolattartó gazda"],["amount","Amount / Összeg","number"],["payment_method","Payment method / Fizetési mód"],["invoice_number","Invoice number / Számlaszám"],],cols:["id","title","category","owner","amount","payment_method","invoice_number","stored_path","created_at"]}
};

const $=s=>document.querySelector(s);
const api=(url,opt={})=>fetch(url,{...opt,headers:{...(opt.body instanceof FormData?{}:{"Content-Type":"application/json"}),Authorization:"Bearer "+token,...(opt.headers||{})}}).then(async r=>{const text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch(e){j={error:text||"Non-JSON response"}}if(!r.ok)throw new Error(j.error||`API ${r.status}`);return j});

$("#loginForm").onsubmit=async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.target));const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(fd)}).then(r=>r.json());if(r.token){token=r.token;user=r.user;localStorage.setItem("kh_token",token);localStorage.setItem("kh_user",JSON.stringify(user));boot()}else alert("Login failed")};
$("#logoutBtn").onclick=()=>{localStorage.clear();location.reload()};

function boot(){if(!token)return;$("#login").classList.add("hidden");$("#app").classList.remove("hidden");$("#userInfo").textContent=`${user.name} · ${user.role}`;let nav=navs[user.role]||navs.WORKER;$("#nav").innerHTML=nav.map((n,i)=>`<button class="nav-btn ${i?'':'active'}" data-v="${n[0]}">${n[1]}</button>`).join("");$("#nav").onclick=e=>{let b=e.target.closest("button");if(!b)return;document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.v).classList.add("active");$("#pageTitle").textContent=b.textContent;render(b.dataset.v)};render("scheduler")}
function money(n){return "$"+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}
function badge(v){let c=String(v||"").split(" ")[0];return `<span class="badge ${c}">${v||""}</span>`}
function fmtDate(d){return d.toISOString().slice(0,10)}
function startOfWeek(d){let x=new Date(d);let day=x.getDay();let diff=(day===0?-6:1-day);x.setDate(x.getDate()+diff);x.setHours(0,0,0,0);return x}
function addDays(d,n){let x=new Date(d);x.setDate(x.getDate()+n);return x}
function localDT(d){let x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,16)}
function hhmm(s){let d=new Date(s);return d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"America/New_York"})}
function sameDay(a,b){return fmtDate(new Date(a))===fmtDate(new Date(b))}
function esc(o){return JSON.stringify(o).replaceAll("'","&#39;")}
function jobRef(j){return j?.job_key || j?.id || j?.job_id || ""}
function req(t){return `${t} <span class="required">*</span>`}
function ensureView(id){let el=$("#"+id);if(!el){el=document.createElement("section");el.id=id;el.className="view";document.querySelector(".main").appendChild(el)}return el}
async function render(v){ensureView(v);if(v==="scheduler")return renderScheduler();if(v==="income_statement")return renderIncomeStatement();if(v==="closed_jobs")return renderClosedJobs();if(v==="finance")return renderFinance();if(v==="accounts")return renderAccounts();if(v==="users")return renderUsers();return renderTable(v)}

async function renderScheduler(){
 const jobs=await api("/api/jobs");
 const week=[0,1,2,3,4,5,6].map(i=>addDays(currentWeekStart,i));
 const hours=Array.from({length:15},(_,i)=>i+7);
 const weekDates=week.map(d=>fmtDate(d));

 let html=`<div class="panel"><div class="toolbar"><div><h3>Weekly Scheduler / Heti naptár</h3><p class="muted">${weekDates[0]} – ${weekDates[6]} · America/New_York</p></div><div><button class="small" onclick="moveWeek(-1)">← Previous / Előző</button><button class="small" onclick="goThisWeek()">This week / Aktuális hét</button><button class="small" onclick="moveWeek(1)">Next / Következő →</button><button onclick="openJob()">+ Add Job / Új munka</button></div></div><div class="calendar-wrap"><div class="calendar-grid"><div class="cal-head time-head">Time</div>`;
 html+=week.map(d=>`<div class="cal-head"><b>${d.toLocaleDateString("en-US",{weekday:"short"})}</b><br><span>${fmtDate(d)}</span></div>`).join("");

 for(const h of hours){
   html+=`<div class="cal-time">${String(h).padStart(2,"0")}:00</div>`;
   for(const day of week){
     const dayStr=fmtDate(day);
     const pf=`${dayStr}T${String(h).padStart(2,"0")}:00`;
     html+=`<div class="cal-cell" onclick="openJob('${pf}')">`;
     html+=jobs
       .filter(j=>{
          const datePart=String(j.start_time||"").slice(0,10);
          const hourPart=Number(String(j.start_time||"").slice(11,13));
          return datePart===dayStr && hourPart===h;
       })
       .map(j=>`<div class="cal-event ${j.status==="Completed"?"Completed":(j.priority||"Medium")}" onclick='event.stopPropagation();openJobDetails(${esc(j)})'><strong>${String(j.start_time||"").slice(11,16)}–${String(j.end_time||"").slice(11,16)}</strong><br>${j.assigned_to} · ${j.title}<br><small>${j.job_type||""} · ${money(j.planned_amount)} · ${j.status}</small></div>`)
       .join("");
     html+=`</div>`;
   }
 }
 html+=`</div></div></div>`;
 $("#scheduler").innerHTML=html;
}
function moveWeek(n){currentWeekStart=addDays(currentWeekStart,7*n);renderScheduler()} function goThisWeek(){currentWeekStart=startOfWeek(new Date());renderScheduler()}

async function openJob(prefill="", row=null){
 const start=row?.start_time || prefill || localDT(new Date());
 let e=new Date(start);e.setHours(e.getHours()+3);
 let end=row?.end_time || localDT(e);

 let contacts=[]; let pianos=[];
 try{ contacts=await api("/api/contacts"); }catch(e){}
 try{ pianos=await api("/api/pianos"); }catch(e){}

 const clientOptions=contacts.map(c=>`<option value="${(c.name||"").replaceAll('"',"&quot;")}">${c.phone||""} ${c.address||""}</option>`).join("");
 const pianoOptions=pianos.map(p=>`<option value="${(`${p.brand||""} ${p.model||""}`).trim().replaceAll('"',"&quot;")}">${p.serial_no||""} ${p.location||""}</option>`).join("");

 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent=row ? "Edit Job / Munka szerkesztése" : "New Job / Új munka";
 $("#form").innerHTML=`<div class="form-grid">
<div class="field"><label>${req("Job title / Munka neve")}</label><input name="title" value="${row?.title||""}" required placeholder="Piano tuning / Zongorahangolás"></div>
<div class="field"><label>${req("Assigned to / Felelős")}</label>
<select name="assigned_to" required>
${["Károly","Alex","Paul","Misi","Said"].map(n=>`<option ${row?.assigned_to===n?"selected":""}>${n}</option>`).join("")}
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

 $("#form").onsubmit=async ev=>{
   ev.preventDefault();
   let b=Object.fromEntries(new FormData(ev.target));

   if(!validateDateField(startInput) || !validateDateField(endInput)) return;
   if(new Date(b.end_time)<=new Date(b.start_time)){alert("A befejezés nem lehet korábbi, mint a kezdés. / End must be after start.");return}
   if(isPastDate(b.start_time)){
     const ok=confirm("Visszamenőleges dátumot adtál meg. Biztosan ezt akarod? / You entered a past date. Are you sure?");
     if(!ok) return;
   }

   if(b.job_type==="Part-work" && !(b.instructions||"").trim()){
     alert("Részmunka esetén a hátralévő feladatok megadása kötelező. / Remaining tasks are required for part-work.");
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
 if(!val){alert("Kérlek, add meg pontosan a dátumot. / Please enter the exact date."); return false}
 if(!/^\d{4}$/.test(year)){alert("Az évszám pontosan 4 számjegyből álljon. / Year must be exactly 4 digits."); return false}
 return true;
}
function isPastDate(value){
 const d=new Date(value);
 const now=new Date();
 return d.getTime() < now.getTime();
}

function toggleInstructionsField(){
 const t=document.getElementById("jobType")?.value;
 const el=document.getElementById("instructionsField");
 if(el) el.classList.toggle("hidden", t!=="Part-work");
}
function openJobDetails(j){
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Job details / Munka részletei";
 const phone=j.client_phone ? `<a href="tel:${String(j.client_phone).replaceAll(" ","")}" class="phone-link">${j.client_phone}</a>` : "";
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
 ${j.job_type==="Part-work"?`<p><b>Remaining tasks / Hátralévő feladatok:</b><br>${j.instructions||""}</p>`:""}
 </div>
 <div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Close / Bezár</button>${j.status==="Completed"?"":`<button type="button" onclick='openJob("",${esc(j)})'>Edit job / Munka szerkesztése</button>`}${j.status==="Completed"?"":`<button type="button" onclick='openCloseJob(${esc(j)})'>Close job / Lezárás</button>`}</div>`;
 $("#form").onsubmit=e=>e.preventDefault()
}
function openReassign(j){
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Reassign job / Munka átadása";
 $("#form").innerHTML=`<div class="form-grid">
 <div class="field"><label>${req("Current responsible / Jelenlegi felelős")}</label><input value="${j.assigned_to||""}" disabled></div>
 <div class="field"><label>${req("New responsible / Új felelős")}</label>
 <select name="assigned_to" required>
 ${["Károly","Alex","Paul","Misi","Said"].map(n=>`<option ${j.assigned_to===n?"selected":""}>${n}</option>`).join("")}
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
function openCloseJob(j){$("#modalTitle").textContent="Close Job / Munka lezárása";$("#form").innerHTML=`<p class="muted">Billed amount / Számlázandó összeg kötelező. Ha 0, nem kell fájl. Ha nagyobb mint 0, fizetési mód és számla/csekk fájl kötelező.</p><div class="form-grid">
<div class="field"><label>${req("Close type / Lezárás típusa")}</label><select name="close_type" id="closeType" onchange="toggleNextJob()"><option>Full</option><option>Partial</option></select></div>
<div class="field"><label>${req("Billed amount / Számlázandó összeg")}</label><input name="billed_amount" type="number" value="${j.planned_amount||0}" required></div>
<div class="field"><label>${req("Payment method / Fizetési mód")}</label><select name="payment_method" required><option value="">Select payment method / Válassz fizetési módot</option><option>Cash</option><option>Check</option><option>Bank Transfer</option><option>Credit Card</option><option>Invoice</option><option>Warranty Work</option></select></div>
<div class="field"><label>Invoice number / Számla vagy csekk szám</label><input name="invoice_number"></div><div class="field"><label>Invoice/check file / Számla vagy csekk fájl</label><input name="file" type="file"></div>
<div class="field full"><label>${req("Close description / Elvégzett munka leírása")}</label><textarea name="close_description" required></textarea></div>
<div id="nextJobFields" class="field full hidden"><h3>Next job / Következő feladat</h3><div class="form-grid"><div class="field full"><label>${req("Next title / Következő feladat neve")}</label><input name="next_title"></div><div class="field"><label>${req("Next assigned to / Következő felelős")}</label><select name="next_assigned_to"><option>Károly</option><option>Alex</option><option>Paul</option><option>Misi</option><option>Said</option></select></div><div class="field"><label>Next priority</label><select name="next_priority"><option>Critical</option><option>Urgent</option><option>High</option><option selected>Medium</option><option>Low</option></select></div><div class="field"><label>${req("Next start / Következő kezdés")}</label><input name="next_start_time" type="datetime-local"></div><div class="field"><label>${req("Next end / Következő befejezés")}</label><input name="next_end_time" type="datetime-local"></div><div class="field"><label>Next planned amount</label><input name="next_planned_amount" type="number" value="0"></div><div class="field full"><label>Next pricing basis / Következő díjmegállapítás</label><input name="next_pricing_basis"></div><div class="field full"><label>Next address / Következő cím</label><input name="next_service_address" value="${j.service_address||""}"></div><div class="field full"><label>Next instructions / Következő teendők</label><textarea name="next_instructions"></textarea></div></div></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Save closeout / Lezárás mentése</button></div>`;
$("#form").onsubmit=async e=>{e.preventDefault();let fd=new FormData(e.target);let billed=Number(fd.get("billed_amount"));let file=fd.get("file");let payment=fd.get("payment_method");if(!payment){alert("Fizetési mód kötelező. / Payment method is required.");return}if(billed>0&&(!file||!file.name)){alert("Számla/csekk fájl kötelező, ha az összeg nagyobb mint 0.");return}
if(file && file.name && !isAllowedInvoiceFile(file.name)){alert("Csak PDF, JPG, JPEG vagy PNG fájl tölthető fel. / Only PDF, JPG, JPEG or PNG files are allowed.");return}
fd.append("id",j.id||""); fd.append("job_id",j.id||""); fd.append("job_key",j.job_key||""); fd.append("client_id",j.client_id||""); fd.append("client_name",j.client_name||""); fd.append("piano_name",j.piano_name||""); fd.append("title",j.title||"");
fd.append("id",j.id||""); fd.append("job_id",j.id||""); fd.append("job_key",j.job_key||""); fd.append("client_id",j.client_id||""); fd.append("client_name",j.client_name||""); fd.append("piano_name",j.piano_name||""); fd.append("title",j.title||"");
try{await api(`/api/jobs/${encodeURIComponent(jobRef(j))}/close`,{method:"POST",body:fd});closeModal();renderScheduler()}catch(err){alert(err.message)}}}
function isAllowedInvoiceFile(name){return /\.(pdf|jpg|jpeg|png)$/i.test(name||"")}
function toggleNextJob(){document.getElementById("nextJobFields").classList.toggle("hidden",document.getElementById("closeType").value!=="Partial")}
function headerLabel(key,c){
 const map={
   contacts:{id:"Client ID / Ügyfél ID",name:"Client name / Ügyfél neve",phone:"Phone / Telefon",address:"Address / Cím",last_contact:"Last visit / Utolsó látogatás",next_step:"Next step / Következő lépés"},
   pianos:{id:"Piano ID / Zongora ID",brand:"Brand / Márka",model:"Model / Típus",serial_no:"Serial No. / Gyári szám",owner_contact_id:"Owner client ID / Tulajdonos ügyfél ID",location:"Location / Helyszín",estimated_value:"Estimated value / Becsült érték",status:"Status / Státusz"},
   knowledge_base:{id:"ID",title:"Title / Cím",category:"Category / Kategória",owner:"Owner / Felelős",amount:"Amount / Összeg",payment_method:"Payment method / Fizetési mód",invoice_number:"Invoice/check number / Számla vagy csekk szám",stored_path:"Attachment / Melléklet",created_at:"Created / Létrehozva"}
 };
 return map[key]?.[c] || c;
}
async function renderTable(key){
 let s=schemas[key],data=await api("/api/"+s.api);
 $("#"+key).innerHTML=`<div class="panel"><div class="toolbar"><h3>${s.title}</h3><div><button class="small" onclick="exportTable('${key}')">Export CSV</button><button onclick="openForm('${key}')">+ Add / Új</button></div></div><div class="table-wrap"><table><thead><tr>${s.cols.map(c=>`<th>${headerLabel(key,c)}</th>`).join("")}<th>Actions / Műveletek</th></tr></thead><tbody>${data.map(r=>`<tr>${s.cols.map(c=>`<td>${cellValue(key,c,r)}</td>`).join("")}<td>${key==="contacts"?`<button class="small" onclick="clientProfile('${r.id}')">Profile / Adatlap</button>`:""}<button class="small" onclick='openForm("${key}",${esc(r)})'>Edit / Szerkesztés</button></td></tr>`).join("")}</tbody></table></div></div>`
}
function cellValue(key,c,r){
 if((c.includes("amount")||c.includes("value"))) return money(r[c]);
 if(c==="stored_path" && r[c]) return `<a href="${r[c]}" target="_blank">Download / Letöltés</a>`;
 return r[c]??"";
}
async function clientProfile(id){
 let p=await api(`/api/client-profile/${id}`);
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Client profile / Ügyfélprofil";
 $("#form").innerHTML=`<div class="work-card"><h4>${p.client.name} · ${p.client.id}</h4><p><b>Phone / Telefon:</b> ${p.client.phone||""}</p><p><b>Address / Cím:</b> ${p.client.address||""}</p><p><b>Last visit / Utolsó látogatás:</b> ${p.lastVisit||""}</p><p><b>Last job / Legutóbbi munka:</b> ${p.lastJob||""}</p><h3>Pianos / Zongorák</h3>${p.pianos.map(x=>`<p>${x.display_name||`${x.brand||""} ${x.model||""}`} · ${x.serial_no||""} · ${x.ownership_type||x.ownership||"Customer owned"}</p>`).join("")||"<p>No pianos</p>"}<h3>Jobs / Munkák</h3>${p.jobs.map(x=>`<p>${x.start_time} · ${x.title} · ${x.assigned_to} · ${x.status}</p>`).join("")||"<p>No jobs</p>"}</div><div class="panel"><h3>Add piano to client / Zongora hozzáadása ügyfélhez</h3><div class="form-grid"><div class="field"><label>Brand / Márka</label><input name="brand" form="pianoAddForm"></div><div class="field"><label>Model / Típus</label><input name="model" form="pianoAddForm"></div><div class="field"><label>Serial No. / Gyári szám</label><input name="serial_no" form="pianoAddForm"></div><div class="field"><label>Ownership / Tulajdon</label><select name="ownership_type" form="pianoAddForm" onchange="document.getElementById('clientPianoValueBox').classList.toggle('hidden',this.value!=='Company owned')"><option>Customer owned</option><option>Company owned</option></select></div><div class="field"><label>Location / Helyszín</label><input name="location" form="pianoAddForm" value="${p.client.address||""}"></div><div class="field hidden" id="clientPianoValueBox"><label>Estimated value / Becsült érték</label><input name="estimated_value" type="number" form="pianoAddForm" value="0"></div></div></div><form id="pianoAddForm"></form><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Close</button><button type="button" onclick="addPianoToClient('${p.client.id}')">Add piano / Zongora hozzáadása</button></div>`;
 $("#form").onsubmit=e=>e.preventDefault()
}
async function addPianoToClient(clientId){
 const form=document.getElementById("pianoAddForm");
 const body=Object.fromEntries(new FormData(form));
 if(!(body.brand||body.model)){alert("Legalább márkát vagy típust adj meg. / Enter at least brand or model.");return}
 try{await api(`/api/contacts/${clientId}/pianos`,{method:"POST",body:JSON.stringify(body)});await clientProfile(clientId)}catch(err){alert(err.message)}
}
function openForm(key,row=null){let s=schemas[key];$("#modal").classList.remove("hidden");$("#modalTitle").textContent=(row?"Edit ":"Add ")+s.title;$("#form").innerHTML=`<div class="form-grid">${s.fields.map(f=>field(f,row?.[f[0]])).join("")}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Save</button></div>`;
 if(key==="contacts"){ attachClientPianoSelector(row); }
 $("#form").onsubmit=async e=>{e.preventDefault();let body=Object.fromEntries(new FormData(e.target));s.fields.forEach(f=>{if(f[2]==="number")body[f[0]]=Number(body[f[0]]||0)});try{let saved;
if(row) saved=await api(`/api/${s.api}/${row.id}`,{method:"PUT",body:JSON.stringify(body)}); else saved=await api(`/api/${s.api}`,{method:"POST",body:JSON.stringify(body)});
if(key==="contacts"){const clientId=(row&&row.id)||saved.id; const ids=[...document.querySelectorAll('input[name="client_piano_ids"]:checked')].map(x=>x.value); if(clientId) await api(`/api/contacts/${clientId}/pianos`,{method:"PUT",body:JSON.stringify({piano_ids:ids})});}
closeModal();render(key)}catch(err){alert(err.message)}}}
function field(f,val=""){let[name,label,type,opts]=f;if(type==="textarea")return `<div class="field full"><label>${label}</label><textarea name="${name}">${val||""}</textarea></div>`;if(type==="select")return `<div class="field"><label>${label}</label><select name="${name}">${opts.map(o=>`<option ${o==val?"selected":""}>${o}</option>`).join("")}</select></div>`;return `<div class="field"><label>${label}</label><input name="${name}" type="${type||"text"}" value="${val??""}"></div>`}

async function attachClientPianoSelector(row){
 const container=document.createElement("div"); container.className="field full";
 container.innerHTML=`<label>Pianos / Zongorái</label><div id="clientPianoSelector" class="multi-box"><p class="muted">Loading pianos / Zongorák betöltése...</p></div>`;
 const grid=$("#form .form-grid"); if(grid) grid.appendChild(container);
 const renderAddForm = () => `<div class="inline-piano-form"><h4>+ New piano / Új zongora</h4><div class="form-grid"><div class="field"><label>Brand / Márka</label><input id="newPianoBrand"></div><div class="field"><label>Model / Típus / modell</label><input id="newPianoModel"></div><div class="field"><label>Serial No. / Gyári szám</label><input id="newPianoSerial"></div><div class="field"><label>Location / Helyszín</label><input id="newPianoLocation"></div><div class="field"><label>Ownership / Tulajdon</label><select id="newPianoOwnership" onchange="document.getElementById('newPianoValueBox').classList.toggle('hidden',this.value!=='Company owned')"><option>Customer owned</option><option>Company owned</option></select></div><div class="field hidden" id="newPianoValueBox"><label>Estimated value / Becsült érték</label><input id="newPianoValue" type="number" value="0"></div></div><button type="button" class="small" onclick="addInlinePianoToClient('${row?.id||""}')">Save new piano / Új zongora mentése</button></div>`;
 if(!row?.id){$("#clientPianoSelector").innerHTML=`<p class="muted">Új ügyfélnél előbb mentsd az ügyfelet, utána szerkesztésben választható zongora.</p>`;return}
 try{const all=await api("/api/pianos"); const selected=all.filter(p=>p.owner_contact_id===row.id).map(p=>p.id); $("#clientPianoSelector").innerHTML=`<div class="dropdown-checks">${all.map(p=>`<label class="check-row"><input type="checkbox" name="client_piano_ids" value="${p.id}" ${selected.includes(p.id)?"checked":""}> ${p.display_name||`${p.brand||""} ${p.model||""}`} · ${p.serial_no||""} · ${p.ownership_type||p.ownership||""}</label>`).join("") || "<p class='muted'>No pianos in database / Nincs zongora az adatbázisban.</p>"}</div>${renderAddForm()}`;}catch(e){$("#clientPianoSelector").innerHTML=`<p class="muted">Could not load pianos / Nem sikerült betölteni a zongorákat.</p>${renderAddForm()}`}
}
async function addInlinePianoToClient(clientId){
 if(!clientId){alert("Előbb mentsd az ügyfelet. / Save the client first.");return}
 const brand=$("#newPianoBrand")?.value || "", model=$("#newPianoModel")?.value || "", serial_no=$("#newPianoSerial")?.value || "", location=$("#newPianoLocation")?.value || "", ownership_type=$("#newPianoOwnership")?.value || "Customer owned", estimated_value=Number($("#newPianoValue")?.value || 0);
 if(!brand && !model){alert("Legalább márkát vagy modellt adj meg. / Enter at least brand or model.");return}
 if(ownership_type==="Company owned" && estimated_value<=0){alert("Céges zongoránál kötelező a becsült érték. / Estimated value is required for company-owned piano.");return}
 try{await api(`/api/contacts/${clientId}/pianos`,{method:"POST",body:JSON.stringify({brand,model,serial_no,location,ownership_type,estimated_value})});await attachClientPianoSelector({id:clientId})}catch(err){alert(err.message)}
}

function closeModal(){$("#modal").classList.add("hidden")}
function exportTable(key){api("/api/"+key).then(data=>{if(!data.length){alert("No data");return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`${key}.csv`;a.click()})}
async function renderFinance(){let e=await api("/api/finance/entries");$("#finance").innerHTML=`<div class="panel"><h3>Finance / Pénzügy</h3><p class="muted">Managers: read-only / Menedzserek: csak megtekintés. Admin: pénzügyi módosítás.</p><div class="table-wrap"><table><thead><tr><th>Date</th><th>Job</th><th>Client</th><th>Piano</th><th>Amount</th><th>Payment method</th><th>Invoice status</th><th>Invoice/check no.</th><th>Lines</th></tr></thead><tbody>${e.map(x=>`<tr><td>${x.entry_date}</td><td>${x.job_title||x.job_id||""}</td><td>${x.client_name||""}</td><td>${x.piano_name||""}</td><td>${money(x.billed_amount||x.lines.reduce((s,l)=>s+Number(l.credit||0),0))}</td><td>${x.payment_method||""}</td><td>${x.invoice_status||""}</td><td>${x.invoice_number||""}</td><td>${x.lines.map(l=>`${l.account_code}: D ${money(l.debit)} / C ${money(l.credit)}`).join("<br>")}</td></tr>`).join("")}</tbody></table></div></div>`}
async function renderIncomeStatement(){let d=await api("/api/income-statement");let acct=c=>d.trialBalance.filter(a=>a.category===c);let rows=arr=>arr.map(a=>`<div class="cf-row"><span>${a.name_en}<br><small>${a.name_hu}</small></span><b>${money(a.balance)}</b></div>`).join("")||"<p class='muted'>No data</p>";$("#income_statement").innerHTML=`<div class="grid kpis"><div class="kpi"><span>Open jobs / Nyitott munkák</span><strong>${d.counts.openJobs}</strong></div><div class="kpi"><span>Closed jobs / Lezárt munkák</span><strong>${d.counts.completedJobs}</strong></div><div class="kpi"><span>Revenue / Bevétel</span><strong>${money(d.totals.revenue)}</strong></div><div class="kpi"><span>Profit / Eredmény</span><strong>${money(d.totals.profit)}</strong></div></div><div class="cashflow-sheet"><div class="cf-box"><h3>Income / Bevételek</h3>${rows(acct("REVENUE"))}</div><div class="cf-box"><h3>Expenses / Kiadások</h3>${rows(acct("EXPENSE"))}<div class="cf-total"><span>Monthly Cash Flow / Havi készpénzáramlás</span><b>${money(d.totals.profit)}</b></div></div><div class="cf-box"><h3>Assets / Eszközök</h3>${rows(acct("ASSET"))}</div><div class="cf-box"><h3>Liabilities / Források</h3>${rows(acct("LIABILITY"))}<div class="cf-total"><span>Net Worth / Nettó vagyon</span><b>${money(d.totals.netWorth)}</b></div></div></div>`}
async function renderAccounts(){
 let d=await api("/api/income-statement");
 $("#accounts").innerHTML=`<div class="panel"><div class="toolbar"><h3>General Ledger / Főkönyv</h3>${user.role==="ADMIN"?`<button onclick="openLedgerEntry()">+ Add ledger entry / Új főkönyvi tétel</button>`:""}</div><div class="table-wrap"><table><thead><tr><th>Code / Kód</th><th>Account / Számla</th><th>Category / Kategória</th><th>Debit / Tartozik</th><th>Credit / Követel</th><th>Balance / Egyenleg</th></tr></thead><tbody>${d.trialBalance.map(a=>`<tr><td>${a.code}</td><td>${a.name_en}<br>${a.name_hu}</td><td>${a.category}</td><td>${money(a.debit_total)}</td><td>${money(a.credit_total)}</td><td>${money(a.balance)}</td></tr>`).join("")}</tbody></table></div></div>`
}
async function openLedgerEntry(){
 const accounts=await api("/api/accounts");
 const opts=accounts.map(a=>`<option value="${a.code}">${a.code} · ${a.name_en} / ${a.name_hu}</option>`).join("");
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Add ledger entry / Új főkönyvi tétel";
 $("#form").innerHTML=`<p class="muted">Admin-only manual ledger entry. Debit and credit must balance. / Csak admin kézi főkönyvi tétel. A Tartozik és Követel oldalnak egyeznie kell.</p>
 <div class="form-grid">
 <div class="field"><label>${req("Date / Dátum")}</label><input name="entry_date" type="date" value="${fmtDate(new Date())}" required></div>
 <div class="field"><label>Payment method / Fizetési mód</label><select name="payment_method"><option>Cash</option><option>Check</option><option>Bank Transfer</option><option>Credit Card</option><option>Invoice</option><option>Adjustment</option></select></div>
 <div class="field full"><label>${req("Description / Leírás")}</label><input name="description" required></div>
 <div class="field"><label>${req("Debit account / Tartozik számla")}</label><select name="debit_account">${opts}</select></div>
 <div class="field"><label>${req("Credit account / Követel számla")}</label><select name="credit_account">${opts}</select></div>
 <div class="field"><label>${req("Amount / Összeg")}</label><input name="amount" type="number" required></div>
 <div class="field full"><label>Memo / Megjegyzés</label><textarea name="memo"></textarea></div>
 </div>
 <div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Save balanced entry / Kiegyenlített tétel mentése</button></div>`;
 $("#form").onsubmit=async e=>{
   e.preventDefault();
   const f=Object.fromEntries(new FormData(e.target));
   const amount=Number(f.amount||0);
   if(amount<=0){alert("Az összegnek nagyobbnak kell lennie nullánál. / Amount must be greater than zero.");return}
   try{
     await api("/api/finance/entries",{method:"POST",body:JSON.stringify({
       entry_date:f.entry_date,description:f.description,payment_method:f.payment_method,
       lines:[
         {account_code:f.debit_account,debit:amount,credit:0,memo:f.memo},
         {account_code:f.credit_account,debit:0,credit:amount,memo:f.memo}
       ]
     })});
     closeModal();renderAccounts();
   }catch(err){alert(err.message)}
 };
}
async function renderClosedJobs(){
 const rows=await api("/api/closed-jobs");
 const tableRows = rows.length ? rows.map(r=>`<tr><td>${r.job_key||r.job_id||""}</td><td>${r.title||""}</td><td>${r.client_name||""}</td><td>${r.piano_name||""}</td><td>${r.close_type||r.job_type||""}</td><td>${r.responsible_at_close||""}</td><td>${r.closed_by||""}</td><td>${r.closed_at||""}</td><td>${money(r.billed_amount)}</td><td>${r.payment_method||""}</td><td>${r.document_path?`<a href="${r.document_path}" target="_blank">Download / Letöltés</a>`:""}</td><td>${r.close_description||""}</td></tr>`).join("") : `<tr><td colspan="12" class="muted">Még nincs lezárt munka. / No closed jobs yet.</td></tr>`;
 $("#closed_jobs").innerHTML=`<div class="panel"><div class="toolbar"><h3>Closed Jobs / Lezárt munkák</h3><button class="small" onclick="exportClosedJobs()">Export CSV</button></div><div class="table-wrap"><table><thead><tr><th>Job key / Munkaazonosító</th><th>Job / Munka neve</th><th>Client / Ügyfél</th><th>Piano / Zongora</th><th>Type / Típus</th><th>Responsible at close / Felelős lezáráskor</th><th>Closed by / Lezárta</th><th>Closed at / Lezárás ideje</th><th>Amount / Összeg</th><th>Payment / Fizetési mód</th><th>Invoice/check / Számla vagy csekk</th><th>Description / Leírás</th></tr></thead><tbody>${tableRows}</tbody></table></div></div>`;
}
function exportClosedJobs(){api("/api/closed-jobs").then(data=>{if(!data.length){alert("No data");return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="closed_jobs.csv";a.click()})}

async function renderUsers(){let u=await api("/api/users");$("#users").innerHTML=`<div class="panel"><div class="toolbar"><h3>Users / Felhasználók</h3><button onclick="openUser()">+ Add user</button></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>${u.map(x=>`<tr><td>${x.name}</td><td>${x.email}</td><td>${x.role}</td><td>${x.status}</td></tr>`).join("")}</tbody></table></div></div>`}
function openUser(){$("#modal").classList.remove("hidden");$("#modalTitle").textContent="Add user / Felhasználó hozzáadása";let roleOptions=user.role==="ADMIN"?["ADMIN","MANAGER","WORKER"]:["MANAGER","WORKER"];$("#form").innerHTML=`<div class="form-grid"><div class="field"><label>Name / Név</label><input name="name" required></div><div class="field"><label>Email</label><input name="email" required></div><div class="field"><label>Password / Jelszó</label><input name="password" required></div><div class="field"><label>Role / Jogosultság</label><select name="role">${roleOptions.map(r=>`<option>${r}</option>`).join("")}</select></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Create user</button></div>`;$("#form").onsubmit=async e=>{e.preventDefault();try{await api("/api/users",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});closeModal();renderUsers()}catch(err){alert(err.message)}}}
if(token)boot();

(function forceCompletedGreenStyle(){const s=document.createElement("style");s.textContent=".cal-event.Completed,.badge.Completed{background:var(--green)!important;color:#07101d!important;}";document.head.appendChild(s);})();
