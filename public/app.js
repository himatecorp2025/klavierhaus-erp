
let token=localStorage.getItem("kh_token");
let user=JSON.parse(localStorage.getItem("kh_user")||"null");
let currentWeekStart=startOfWeek(new Date());

const baseNav=[
["dashboard","Dashboard / Vezérlőpult"],["scheduler","Scheduler / Naptár"],["contacts","CRM / Ügyfelek"],["pianos","Pianos / Zongorák"],["projects","Projects / Projektek"],["phases","Project Phases / Projektfázisok"],["tasks","Tasks / Feladatok"],["documents","Documents & Invoices / Dokumentumok és számlák"],["completed_projects","Completed Projects / Lezárt projektek"],["knowledge_base","Knowledge Base / Tudásbázis"],["finance","Finance / Pénzügy"],["accounts","Trial Balance / Főkönyvi kivonat"],["users","Users / Felhasználók"]];
const roleNav={ADMIN:baseNav,MANAGER:baseNav.filter(x=>x[0]!=="users"),STAFF:baseNav.filter(x=>!["contacts","finance","accounts","users"].includes(x[0])),VIEWER:baseNav.filter(x=>["dashboard","scheduler","documents","completed_projects","knowledge_base"].includes(x[0]))};

const schemas={
contacts:{api:"contacts",title:"CRM / Ügyfelek",fields:[["name","Name / Név"],["company","Company / Cég"],["type","Type / Típus"],["email","Email"],["phone","Phone"],["priority","Priority / Prioritás","select",["Critical","Urgent","High","Medium","Low"]],["status","Status"],["owner","Owner / Felelős"],["relationship_holder","Relationship holder / Kapcsolatgazda"],["loss_risk","Loss risk / Elvesztési kockázat","select",["High","Medium","Low","Unknown"]],["last_contact","Last contact / Utolsó kapcsolat","date"],["next_step","Next step / Következő lépés"],["notes","Notes / Megjegyzés","textarea"]],cols:["id","name","company","priority","status","relationship_holder","loss_risk","next_step"]},
pianos:{api:"pianos",title:"Piano Registry / Zongora regiszter",fields:[["brand","Brand / Márka"],["model","Model"],["serial_no","Serial No. / Gyári szám"],["year","Year / Év","number"],["ownership","Ownership / Tulajdonjog"],["owner_contact_id","Owner Contact ID"],["location","Location"],["estimated_value","Estimated value","number"],["status","Status"],["notes","Notes","textarea"]],cols:["id","brand","model","serial_no","ownership","location","estimated_value","status"]},
projects:{api:"projects",title:"Projects / Projektek",fields:[["piano_id","Piano ID"],["client_id","Client ID"],["name","Project name / Projekt neve"],["type","Type / Típus","select",["Full restoration","Tuning","Concert prep","In-home voicing","Emergency service","Repair","Piano evaluation","Sale","Rental"]],["manager","Manager","select",["Károly","Alex","Paul","Misi","Said"]],["priority","Priority","select",["Critical","Urgent","High","Medium","Low"]],["status","Status","select",["Not started","In progress","Waiting","Completed","Blocked"]],["start_date","Start","date"],["due_date","Due date","date"],["planned_revenue","Planned revenue","number"],["actual_revenue","Actual revenue","number"],["planned_cost","Planned cost","number"],["actual_cost","Actual cost","number"],["location_type","Location type / Helyszín típusa","select",["Workshop","Client site","Concert venue"]],["service_address","Service address / Szerviz cím"],["customer_phone","Customer phone"],["customer_email","Customer email"],["notes","Notes","textarea"]],cols:["id","piano_id","client_id","name","type","manager","priority","status","due_date","planned_revenue","actual_revenue"]},
phases:{api:"phases",title:"Project Phases / Projektfázisok",fields:[["project_id","Project ID *"],["phase_name","Phase name / Fázis neve *"],["phase_type","Phase type / Fázis típusa"],["sequence_no","Sequence / Sorrend","number"],["assigned_to","Assigned to / Felelős","select",["Károly","Alex","Paul","Misi","Said"]],["priority","Priority / Prioritás","select",["Critical","Urgent","High","Medium","Low"]],["status","Status","select",["Open","In progress","Waiting","Completed","Blocked"]],["planned_start","Planned start / Tervezett kezdés","date"],["planned_end","Planned end / Tervezett zárás","date"],["appointment_start","Calendar start / Naptár kezdés","datetime-local"],["appointment_end","Calendar end / Naptár vége","datetime-local"],["service_address","Service address / Cím"],["planned_amount","Planned amount / Tervezett összeg *","number"],["notes","Notes / Megjegyzés","textarea"]],cols:["id","project_id","phase_name","sequence_no","assigned_to","priority","status","appointment_start","appointment_end","planned_amount","billed_amount"]},
tasks:{api:"tasks",title:"Tasks / Feladatok",fields:[["project_id","Project ID"],["phase_id","Phase ID"],["task_type","Task type"],["assigned_to","Assigned to","select",["Károly","Alex","Paul","Misi","Said"]],["priority","Priority","select",["Critical","Urgent","High","Medium","Low"]],["status","Status","select",["Open","In progress","Waiting","Completed","Blocked"]],["due_date","Due date","date"],["appointment_start","Appointment start","datetime-local"],["appointment_end","Appointment end","datetime-local"],["service_address","Service address"],["planned_hours","Planned hours","number"],["actual_hours","Actual hours","number"],["notes","Notes","textarea"]],cols:["id","project_id","phase_id","task_type","assigned_to","priority","status","appointment_start","appointment_end","planned_hours","actual_hours"]},
documents:{api:"documents",title:"Documents & Invoices / Dokumentumok és számlák",fields:[["related_type","Related type"],["related_id","Related ID"],["title","Title"],["doc_type","Document type"],["doc_date","Date","date"],["url","URL / Path"],["owner","Owner"],["amount","Amount","number"],["payment_method","Payment method"],["invoice_number","Invoice number"],["notes","Notes","textarea"]],cols:["id","related_type","related_id","title","doc_type","doc_date","owner","amount","payment_method","invoice_number","stored_path"]},
knowledge_base:{api:"knowledge_base",title:"Knowledge Base / Tudásbázis",fields:[["title","Title / Cím"],["category","Category / Kategória"],["brand","Brand / Márka"],["content_type","Content type","select",["Note","Video","Photo","PDF","Audio","Procedure","Completed Project"]],["url","URL / Path"],["owner","Owner"],["priority","Priority","select",["Critical","Urgent","High","Medium","Low"]],["project_id","Project ID"],["phase_id","Phase ID"],["body","Body / Tartalom","textarea"]],cols:["id","title","category","brand","content_type","owner","priority","project_id"]}
};

const $=s=>document.querySelector(s);
const api=(url,opt={})=>fetch(url,{...opt,headers:{...(opt.body instanceof FormData?{}:{"Content-Type":"application/json"}),Authorization:"Bearer "+token,...(opt.headers||{})}}).then(async r=>{
  const text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch(e){j={error:text||"Non-JSON server response"}}
  if(!r.ok){console.error("API ERROR",url,r.status,j);throw new Error(j.error || `API error ${r.status}`)}
  return j;
});

$("#loginForm").onsubmit=async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.target));const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(fd)}).then(r=>r.json());if(r.token){token=r.token;user=r.user;localStorage.setItem("kh_token",token);localStorage.setItem("kh_user",JSON.stringify(user));boot()}else alert("Login failed")};
$("#logoutBtn").onclick=()=>{localStorage.clear();location.reload()};

function boot(){
 if(!token)return;
 $("#login").classList.add("hidden");$("#app").classList.remove("hidden");
 $("#userInfo").textContent=`${user.name} · ${user.role}`;
 let nav=roleNav[user.role]||roleNav.VIEWER;
 $("#nav").innerHTML=nav.map((n,i)=>`<button class="nav-btn ${i?'':'active'}" data-v="${n[0]}">${n[1]}</button>`).join("");
 $("#nav").onclick=e=>{let b=e.target.closest("button");if(!b)return;document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.v).classList.add("active");$("#pageTitle").textContent=b.textContent;render(b.dataset.v)};
 render(nav[0][0]);
}
function money(n){return "$"+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}
function badge(v){let c=String(v||"").split(" ")[0];return `<span class="badge ${c}">${v||""}</span>`}
function fmtDate(d){return d.toISOString().slice(0,10)}
function startOfWeek(d){let x=new Date(d);let day=x.getDay();let diff=(day===0?-6:1-day);x.setDate(x.getDate()+diff);x.setHours(0,0,0,0);return x}
function addDays(d,n){let x=new Date(d);x.setDate(x.getDate()+n);return x}
function hhmm(s){if(!s)return"";let d=new Date(s);return d.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"America/New_York"})}
function sameDay(a,b){return fmtDate(new Date(a))===fmtDate(new Date(b))}
function escapeAttr(obj){return JSON.stringify(obj).replaceAll("'","&#39;")}
function localDT(d){let x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,16)}
function requiredLabel(t){return `${t} <span class="required">*</span>`}

async function render(v){
 if(v==="dashboard")return renderDashboard();
 if(v==="scheduler")return renderScheduler();
 if(v==="finance")return renderFinance();
 if(v==="accounts")return renderAccounts();
 if(v==="users")return renderUsers();
 if(v==="completed_projects")return renderCompletedProjects();
 return renderTable(v);
}
async function renderDashboard(){let d=await api("/api/dashboard");$("#dashboard").innerHTML=`<div class="grid kpis">${[["Assets / Eszközök",money(d.totals.assets)],["Liabilities / Kötelezettségek",money(d.totals.liabilities)],["Profit / Eredmény",money(d.totals.profit)],["Open phases / Nyitott fázis",d.counts.openPhases||0]].map(x=>`<div class="kpi"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join("")}</div><div class="grid two"><div class="panel"><h3>Financial Statement / Pénzügyi áttekintés</h3>${d.trialBalance.length?statement(d):"<p class='muted'>Staff view: financial statement hidden / Staff nézet: pénzügy rejtve</p>"}</div><div class="panel"><h3>Critical alerts / Kritikus jelzések</h3>${alerts(d.alerts)}</div></div>`}
function statement(d){return `<div class="statement"><div class="box"><h3>Assets / Eszközök</h3>${rows(d.trialBalance.filter(a=>a.category==="ASSET"))}<div class="row total"><span>Total Assets</span><b>${money(d.totals.assets)}</b></div></div><div class="box"><h3>Liabilities & Equity / Források</h3>${rows(d.trialBalance.filter(a=>["LIABILITY","EQUITY"].includes(a.category)))}<div class="row total"><span>Net Worth</span><b>${money(d.totals.netWorth)}</b></div></div><div class="box"><h3>Revenue / Bevétel</h3>${rows(d.trialBalance.filter(a=>a.category==="REVENUE"))}</div><div class="box"><h3>Expenses / Költségek</h3>${rows(d.trialBalance.filter(a=>a.category==="EXPENSE"))}</div></div>`}
function rows(arr){return arr.map(a=>`<div class="row"><span>${a.code} · ${a.name_en}<br><small class="muted">${a.name_hu}</small></span><b>${money(a.balance)}</b></div>`).join("")||"<p class='muted'>No data</p>"}
function alerts(a){let out=[...a.criticalContacts.map(x=>`Critical contact: ${x.name}`),...a.overdueTasks.map(x=>`Overdue phase: ${x.phase_name || x.id}`)];return out.length?out.map(x=>`<div class="alert">${x}</div>`).join(""):"<p class='muted'>No critical alert / Nincs kritikus jelzés</p>"}

async function renderScheduler(){
 const events=await api("/api/scheduler");
 const week=[0,1,2,3,4,5,6].map(i=>addDays(currentWeekStart,i));
 const hours=Array.from({length:15},(_,i)=>i+7);
 const weekEnd=addDays(currentWeekStart,7);
 const shown=events.filter(e=>{const d=new Date(e.event_start);return d>=currentWeekStart && d<weekEnd});
 $("#scheduler").innerHTML=`
 <div class="panel">
   <div class="toolbar">
     <div><h3>Weekly Scheduler / Heti naptár</h3><p class="muted">${fmtDate(currentWeekStart)} – ${fmtDate(addDays(currentWeekStart,6))} · America/New_York</p></div>
     <div>
       <button class="small" onclick="moveWeek(-1)">← Previous week / Előző hét</button>
       <button class="small" onclick="goThisWeek()">This week / Aktuális hét</button>
       <button class="small" onclick="moveWeek(1)">Next week / Következő hét →</button>
       ${user.role==="VIEWER"?"":`<button onclick="openCalendarPhase()">+ Add phase/job / Új fázis vagy munka</button>`}
     </div>
   </div>
   <div class="calendar-wrap">
     <div class="calendar-grid">
       <div class="cal-head time-head">Time</div>
       ${week.map(d=>`<div class="cal-head"><b>${d.toLocaleDateString("en-US",{weekday:"short"})}</b><br><span>${fmtDate(d)}</span></div>`).join("")}
       ${hours.map(h=>`<div class="cal-time">${String(h).padStart(2,"0")}:00</div>${week.map(day=>`<div class="cal-cell" onclick="openCalendarPhase('${fmtDate(day)}T${String(h).padStart(2,"0")}:00')">${eventsForCell(shown,day,h)}</div>`).join("")}`).join("")}
     </div>
   </div>
 </div>`;
}
function eventsForCell(events,day,hour){
 return events.filter(e=>{const d=new Date(e.event_start);return sameDay(d,day) && d.getHours()===hour}).map(e=>`<div class="cal-event ${String(e.event_type||'Task')} ${String(e.priority||'Medium').split(' ')[0]}" onclick='event.stopPropagation();openEventDetails(${escapeAttr(e)})'><strong>${hhmm(e.event_start)}–${hhmm(e.event_end)}</strong><br>${e.assigned_to||""} · ${e.title||""}<br><small>${e.event_type||"Task"} · ${money(e.planned_amount||0)}</small></div>`).join("");
}
function moveWeek(n){currentWeekStart=addDays(currentWeekStart,7*n);renderScheduler()}
function goThisWeek(){currentWeekStart=startOfWeek(new Date());renderScheduler()}
function openEventDetails(e){
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Calendar item / Naptári elem";
 $("#form").innerHTML=`<div class="work-card"><h4>${badge(e.priority)} ${e.title}</h4><p><b>Type / Típus:</b> ${e.event_type||"Task"}</p><p><b>Assigned / Felelős:</b> ${e.assigned_to||""}</p><p><b>Time / Idő:</b> ${e.event_start} → ${e.event_end}</p><p><b>Address / Cím:</b> ${e.service_address||""}</p><p><b>Planned amount / Tervezett összeg:</b> ${money(e.planned_amount||0)}</p><p><b>Status / Státusz:</b> ${badge(e.status)}</p><p class="muted">Phase ID: ${e.phase_id||""} · Project ID: ${e.project_id||""}</p></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Close / Bezárás</button>${e.phase_id && e.status!=="Completed" ? `<button type="button" onclick="loadPhaseAndComplete('${e.phase_id}')">Close phase / Fázis lezárása</button>` : ""}</div>`;
 $("#form").onsubmit=e=>e.preventDefault();
}
async function loadPhaseAndComplete(phaseId){const phases=await api("/api/phases");const ph=phases.find(x=>x.id===phaseId);if(!ph){alert("Phase not found");return}openCompletePhase(ph)}

function openCalendarPhase(prefillStart=""){
 const start = prefillStart || localDT(new Date());
 const endDate = new Date(start); endDate.setHours(endDate.getHours()+3);
 const end = localDT(endDate);
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="New project phase / Új projektfázis";
 $("#form").innerHTML=`<div class="form-grid">
  <div class="field"><label>${requiredLabel("Project ID / Projekt ID")}</label><input name="project_id" placeholder="PR-001" required></div>
  <div class="field"><label>${requiredLabel("Phase name / Fázis neve")}</label><input name="phase_name" placeholder="Tuning / Hangolás" required></div>
  <div class="field"><label>Phase type / Fázis típusa</label><select name="phase_type"><option>Tuning</option><option>Polishing</option><option>Action regulation</option><option>Voicing</option><option>String replacement</option><option>Evaluation</option><option>Delivery</option></select></div>
  <div class="field"><label>Sequence / Sorrend</label><input name="sequence_no" type="number" value="1"></div>
  <div class="field"><label>${requiredLabel("Assigned to / Felelős")}</label><select name="assigned_to" required><option>Károly</option><option>Alex</option><option>Paul</option><option>Misi</option><option>Said</option></select></div>
  <div class="field"><label>Priority / Prioritás</label><select name="priority"><option>Critical</option><option>Urgent</option><option>High</option><option selected>Medium</option><option>Low</option></select></div>
  <div class="field"><label>${requiredLabel("Calendar start / Naptár kezdés")}</label><input name="appointment_start" type="datetime-local" value="${start}" required></div>
  <div class="field"><label>${requiredLabel("Calendar end / Naptár vége")}</label><input name="appointment_end" type="datetime-local" value="${end}" required></div>
  <div class="field"><label>${requiredLabel("Planned amount / Tervezett összeg")}</label><input name="planned_amount" type="number" value="0" required></div>
  <div class="field full"><label>Service address / Cím</label><input name="service_address"></div>
  <div class="field full"><label>Notes / Megjegyzés</label><textarea name="notes"></textarea></div>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Create phase / Fázis létrehozása</button></div>`;
 $("#form").onsubmit=async e=>{
   e.preventDefault();const f=Object.fromEntries(new FormData(e.target)); const date=f.appointment_start.slice(0,10);
   try{
     await api("/api/phases",{method:"POST",body:JSON.stringify({project_id:f.project_id,phase_name:f.phase_name,phase_type:f.phase_type,sequence_no:Number(f.sequence_no||1),assigned_to:f.assigned_to,priority:f.priority,status:"Open",planned_start:date,planned_end:date,appointment_start:f.appointment_start,appointment_end:f.appointment_end,timezone:"America/New_York",service_address:f.service_address,planned_amount:Number(f.planned_amount||0),notes:f.notes})});
     closeModal();renderScheduler();
   }catch(err){alert(err.message)}
 };
}
function openCompletePhase(ph){
 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="Close phase / Fázis lezárása";
 $("#form").innerHTML=`<p class="muted">A billed amount / számlázandó összeg kötelező. Ha nincs számlázás, írj 0-t. Ha az összeg nagyobb mint 0, a számla/csekk feltöltése kötelező.</p>
 <div class="form-grid">
 <div class="field"><label>${requiredLabel("Billed amount / Számlázandó összeg")}</label><input name="billed_amount" type="number" value="${ph.planned_amount||0}" required></div>
 <div class="field"><label>Payment method / Fizetési mód</label><select name="payment_method"><option value="">No payment / Nincs fizetés</option><option>Cash</option><option>Check</option><option>Bank Transfer</option><option>Credit Card</option><option>Invoice</option></select></div>
 <div class="field"><label>Invoice status / Számla státusz</label><select name="invoice_status"><option>Not billable</option><option>Invoiced</option><option>Paid</option></select></div>
 <div class="field"><label>Invoice/check number / Számla vagy csekk szám</label><input name="invoice_number"></div>
 <div class="field"><label>Invoice/check file / Számla vagy csekk fájl</label><input name="file" type="file"><small class="muted">Kötelező, ha az összeg nagyobb mint 0.</small></div>
 <div class="field full"><label>${requiredLabel("Completion notes / Lezárási megjegyzés")}</label><textarea name="completion_notes" required></textarea></div>
 </div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Close phase / Fázis lezárása</button></div>`;
 $("#form").onsubmit=async e=>{
   e.preventDefault();let fd=new FormData(e.target);
   const billed=Number(fd.get("billed_amount"));
   const file=fd.get("file");
   if(Number.isNaN(billed)){alert("Billed amount is required. Use 0 if not billable.");return}
   if(billed>0 && (!file || !file.name)){alert("Számla/csekk feltöltése kötelező, ha az összeg nagyobb mint 0.");return}
   try{await api(`/api/phases/${ph.id}/complete`,{method:"POST",body:fd});closeModal();renderScheduler()}catch(err){alert(err.message)}
 };
}

async function renderTable(key){let s=schemas[key],data=await api("/api/"+s.api);$("#"+key).innerHTML=`<div class="panel"><div class="toolbar"><h3>${s.title}</h3><div>${["documents","knowledge_base"].includes(key)?`<button class="small" onclick="exportTable('${key}')">Export CSV</button>`:""}<button onclick="openForm('${key}')">+ Add / Új</button></div></div><div class="table-wrap"><table><thead><tr>${s.cols.map(c=>`<th>${c}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${data.map(r=>`<tr>${s.cols.map(c=>`<td>${["priority","status","loss_risk"].includes(c)?badge(r[c]):(c.includes("revenue")||c.includes("cost")||c.includes("value")||c.includes("amount")?money(r[c]):r[c]??"")}</td>`).join("")}<td>${key==="projects"?`<button class="small" onclick="workflow('${r.id}')">Generate phases</button>`:""}${key==="phases"&&r.status!=="Completed"?`<button class="small" onclick='openCompletePhase(${escapeAttr(r)})'>Close phase</button>`:""}<button class="small" onclick='openForm("${key}",${escapeAttr(r)})'>Edit</button></td></tr>`).join("")}</tbody></table></div></div>`}
function openForm(key,row=null){let s=schemas[key];$("#modal").classList.remove("hidden");$("#modalTitle").textContent=(row?"Edit ":"Add ")+s.title;$("#form").innerHTML=`<div class="form-grid">${s.fields.map(f=>field(f,row?.[f[0]])).join("")}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Save</button></div>`;$("#form").onsubmit=async e=>{e.preventDefault();let body=Object.fromEntries(new FormData(e.target));s.fields.forEach(f=>{if(f[2]==="number")body[f[0]]=Number(body[f[0]]||0)});if(row)await api(`/api/${s.api}/${row.id}`,{method:"PUT",body:JSON.stringify(body)});else await api(`/api/${s.api}`,{method:"POST",body:JSON.stringify(body)});closeModal();render(key)}}
function field(f,val=""){let[name,label,type,opts]=f;if(type==="textarea")return `<div class="field full"><label>${label}</label><textarea name="${name}">${val||""}</textarea></div>`;if(type==="select")return `<div class="field"><label>${label}</label><select name="${name}">${opts.map(o=>`<option ${o==val?"selected":""}>${o}</option>`).join("")}</select></div>`;return `<div class="field"><label>${label}</label><input name="${name}" type="${type||"text"}" value="${val??""}"></div>`}
function closeModal(){$("#modal").classList.add("hidden")}
async function workflow(id){try{await api(`/api/projects/${id}/generate-workflow`,{method:"POST",body:JSON.stringify({})});alert("Project phases generated / Projektfázisok létrehozva");render("phases")}catch(e){alert(e.message)}}
function exportTable(key){api("/api/"+key).then(data=>{const rows=data; if(!rows.length){alert("No data");return} const headers=Object.keys(rows[0]); const csv=[headers.join(","),...rows.map(r=>headers.map(h=>`"${String(r[h]??"").replaceAll('"','""')}"`).join(","))].join("\n"); const blob=new Blob([csv],{type:"text/csv"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`${key}.csv`; a.click();})}
async function renderCompletedProjects(){let data=await api("/api/projects");let rows=data.filter(p=>p.status==="Completed");$("#completed_projects").innerHTML=`<div class="panel"><div class="toolbar"><h3>Completed Projects / Lezárt projektek</h3><button class="small" onclick="exportCompletedProjects()">Export CSV</button></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Manager</th><th>Actual revenue</th><th>Notes</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${p.id}</td><td>${p.name}</td><td>${p.type}</td><td>${p.manager}</td><td>${money(p.actual_revenue)}</td><td>${p.notes||""}</td></tr>`).join("")}</tbody></table></div></div>`}
async function exportCompletedProjects(){let data=await api("/api/projects");let rows=data.filter(p=>p.status==="Completed");if(!rows.length){alert("No completed projects");return}const headers=Object.keys(rows[0]);const csv=[headers.join(","),...rows.map(r=>headers.map(h=>`"${String(r[h]??"").replaceAll('"','""')}"`).join(","))].join("\n");const blob=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="completed_projects.csv";a.click();}
async function renderAccounts(){let d=await api("/api/dashboard");$("#accounts").innerHTML=`<div class="panel"><h3>Trial Balance / Főkönyvi kivonat</h3><div class="table-wrap"><table><thead><tr><th>Code</th><th>Account</th><th>Category</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${d.trialBalance.map(a=>`<tr><td>${a.code}</td><td>${a.name_en}<br><small>${a.name_hu}</small></td><td>${a.category}</td><td>${money(a.debit_total)}</td><td>${money(a.credit_total)}</td><td>${money(a.balance)}</td></tr>`).join("")}</tbody></table></div></div>`}
async function renderFinance(){let accounts=await api("/api/accounts");let entries=await api("/api/finance/entries");$("#finance").innerHTML=`<div class="panel"><div class="toolbar"><h3>Journal Entries / Könyvelési tételek</h3><button onclick="openJournal()">+ Balanced entry / Kiegyenlített tétel</button></div><p class="muted">API rejects unbalanced debit/credit. / Az API elutasítja a nem egyező Tartozik/Követel tételeket.</p><div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Lines</th><th>Total</th></tr></thead><tbody>${entries.map(e=>`<tr><td>${e.entry_date}</td><td>${e.description||""}</td><td>${e.lines.map(l=>`${l.account_code}: D ${money(l.debit)} / C ${money(l.credit)}`).join("<br>")}</td><td>${money(e.lines.reduce((s,l)=>s+Number(l.debit||0),0))}</td></tr>`).join("")}</tbody></table></div></div>`;window._accounts=accounts}
function openJournal(){let acc=(window._accounts||[]);$("#modal").classList.remove("hidden");$("#modalTitle").textContent="New journal entry / Új könyvelési tétel";let opts=acc.map(a=>`<option value="${a.code}">${a.code} · ${a.name_en} / ${a.name_hu}</option>`).join("");$("#form").innerHTML=`<div class="form-grid"><div class="field"><label>Date</label><input name="entry_date" type="date"></div><div class="field"><label>Payment method</label><input name="payment_method"></div><div class="field full"><label>Description</label><input name="description"></div><div class="field"><label>Debit account / Tartozik számla</label><select name="debit_account">${opts}</select></div><div class="field"><label>Credit account / Követel számla</label><select name="credit_account">${opts}</select></div><div class="field"><label>Amount / Összeg</label><input name="amount" type="number"></div><div class="field full"><label>Memo</label><textarea name="memo"></textarea></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Save balanced entry</button></div>`;$("#form").onsubmit=async e=>{e.preventDefault();let f=Object.fromEntries(new FormData(e.target));let amount=Number(f.amount||0);await api("/api/finance/entries",{method:"POST",body:JSON.stringify({entry_date:f.entry_date,description:f.description,payment_method:f.payment_method,lines:[{account_code:f.debit_account,debit:amount,credit:0,memo:f.memo},{account_code:f.credit_account,debit:0,credit:amount,memo:f.memo}]})});closeModal();renderFinance()}}
async function renderUsers(){let data=await api("/api/users");$("#users").innerHTML=`<div class="panel"><h3>Users / Felhasználók</h3><p class="muted">ADMIN: Károly, Alex · MANAGER: Paul, Misi · STAFF: Said</p><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${data.map(u=>`<tr><td>${u.name}</td><td>${u.email}</td><td>${badge(u.role)}</td></tr>`).join("")}</tbody></table></div></div>`}
if(token)boot();
