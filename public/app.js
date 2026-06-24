
let token=localStorage.getItem("kh_token");
let user=JSON.parse(localStorage.getItem("kh_user")||"null");
let currentWeekStart=startOfWeek(new Date());

const navs={
 ADMIN:[["scheduler","Scheduler / Naptár"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["knowledge_base","Knowledge Base / Tudásbázis"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["accounts","General Ledger / Főkönyv"],["users","Users / Felhasználók"]],
 MANAGER:[["scheduler","Scheduler / Naptár"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["knowledge_base","Knowledge Base / Tudásbázis"],["finance","Finance / Pénzügy"],["income_statement","Income Statement / Eredménykimutatás"],["accounts","General Ledger / Főkönyv"],["users","Users / Felhasználók"]],
 WORKER:[["scheduler","Scheduler / Naptár"],["contacts","Clients / Ügyfelek"],["pianos","Pianos / Zongorák"],["knowledge_base","Knowledge Base / Tudásbázis"]]
};

const schemas={
contacts:{api:"contacts",title:"Clients / Ügyfelek",fields:[["name","Client name / Ügyfél neve *"],["company","Company / Cég"],["type","Type / Típus"],["email","Email"],["phone","Phone / Telefonszám"],["address","Address / Cím"],["priority","Priority / Prioritás","select",["Critical","Urgent","High","Medium","Low"]],["status","Status / Státusz"],["owner","Owner / Felelős"],["relationship_holder","Relationship holder / Kapcsolatgazda"],["loss_risk","Loss risk / Elvesztési kockázat","select",["High","Medium","Low","Unknown"]],["last_contact","Last contact / Utolsó kapcsolat","date"],["next_step","Next step / Következő lépés"],["notes","Notes / Megjegyzés","textarea"]],cols:["id","name","phone","address","last_contact","next_step"]},
pianos:{api:"pianos",title:"Pianos / Zongorák",fields:[["brand","Brand / Márka"],["model","Model / Típus"],["serial_no","Serial No. / Gyári szám"],["year","Year / Év","number"],["ownership","Ownership / Tulajdon"],["owner_contact_id","Owner Contact ID / Ügyfél ID"],["location","Location / Helyszín"],["estimated_value","Estimated value / Becsült érték","number"],["status","Status / Státusz"],["notes","Notes / Megjegyzés","textarea"]],cols:["id","brand","model","serial_no","owner_contact_id","location","estimated_value","status"]},
knowledge_base:{api:"knowledge_base",title:"Knowledge Base / Tudásbázis",fields:[["title","Title / Cím"],["category","Category / Kategória"],["content_type","Content type / Tartalomtípus"],["body","Body / Tartalom","textarea"],["stored_path","Attachment path / Melléklet útvonal"],["owner","Owner / Felelős"],["amount","Amount / Összeg","number"],["payment_method","Payment method / Fizetési mód"],["invoice_number","Invoice number / Számlaszám"],["priority","Priority / Prioritás","select",["Critical","Urgent","High","Medium","Low"]]],cols:["id","title","category","owner","amount","payment_method","invoice_number","stored_path","created_at"]}
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
function req(t){return `${t} <span class="required">*</span>`}
async function render(v){if(v==="scheduler")return renderScheduler();if(v==="income_statement")return renderIncomeStatement();if(v==="finance")return renderFinance();if(v==="accounts")return renderAccounts();if(v==="users")return renderUsers();return renderTable(v)}

async function renderScheduler(){
 const jobs=await api("/api/jobs");
 const week=[0,1,2,3,4,5,6].map(i=>addDays(currentWeekStart,i));
 const hours=Array.from({length:15},(_,i)=>i+7);
 const weekEnd=addDays(currentWeekStart,7);
 const shown=jobs.filter(j=>{let d=new Date(j.start_time);return d>=currentWeekStart&&d<weekEnd});
 let html=`<div class="panel"><div class="toolbar"><div><h3>Weekly Scheduler / Heti naptár</h3><p class="muted">${fmtDate(currentWeekStart)} – ${fmtDate(addDays(currentWeekStart,6))} · America/New_York</p></div><div><button class="small" onclick="moveWeek(-1)">← Previous / Előző</button><button class="small" onclick="goThisWeek()">This week / Aktuális hét</button><button class="small" onclick="moveWeek(1)">Next / Következő →</button><button onclick="openJob()">+ Add Job / Új munka</button></div></div><div class="calendar-wrap"><div class="calendar-grid"><div class="cal-head time-head">Time</div>`;
 html+=week.map(d=>`<div class="cal-head"><b>${d.toLocaleDateString("en-US",{weekday:"short"})}</b><br><span>${fmtDate(d)}</span></div>`).join("");
 for(const h of hours){html+=`<div class="cal-time">${String(h).padStart(2,"0")}:00</div>`;for(const day of week){const pf=`${fmtDate(day)}T${String(h).padStart(2,"0")}:00`;html+=`<div class="cal-cell" onclick="openJob('${pf}')">`;html+=shown.filter(j=>sameDay(j.start_time,day)&&new Date(j.start_time).getHours()===h).map(j=>`<div class="cal-event ${j.priority}" onclick='event.stopPropagation();openJobDetails(${esc(j)})'><strong>${hhmm(j.start_time)}–${hhmm(j.end_time)}</strong><br>${j.assigned_to} · ${j.title}<br><small>${j.job_type||""} · ${money(j.planned_amount)} · ${j.status}</small></div>`).join("");html+=`</div>`}}
 html+=`</div></div></div>`;$("#scheduler").innerHTML=html;
}
function moveWeek(n){currentWeekStart=addDays(currentWeekStart,7*n);renderScheduler()} function goThisWeek(){currentWeekStart=startOfWeek(new Date());renderScheduler()}

async function openJob(prefill=""){
 const start=prefill||localDT(new Date());
 let e=new Date(start);e.setHours(e.getHours()+3);
 let end=localDT(e);

 let contacts=[]; let pianos=[];
 try{ contacts=await api("/api/contacts"); }catch(e){}
 try{ pianos=await api("/api/pianos"); }catch(e){}

 const clientOptions=contacts.map(c=>`<option value="${(c.name||"").replaceAll('"',"&quot;")}">${c.phone||""} ${c.address||""}</option>`).join("");
 const pianoOptions=pianos.map(p=>`<option value="${(`${p.brand||""} ${p.model||""}`).trim().replaceAll('"',"&quot;")}">${p.serial_no||""} ${p.location||""}</option>`).join("");

 $("#modal").classList.remove("hidden");
 $("#modalTitle").textContent="New Job / Új munka";
 $("#form").innerHTML=`<div class="form-grid">
<div class="field full"><label>${req("Job title / Munka neve")}</label><input name="title" required placeholder="Piano tuning / Zongorahangolás"></div>

<div class="field"><label>${req("Standalone or part-work / Önálló munka vagy részmunka")}</label>
<select name="job_type" id="jobType" onchange="toggleInstructionsField()">
<option value="Standalone">Standalone / Önálló munka</option>
<option value="Part-work">Part-work / Részmunka</option>
</select></div>

<div class="field"><label>${req("Assigned to / Felelős")}</label>
<select name="assigned_to" required>
<option>Károly</option><option>Alex</option><option>Paul</option><option>Misi</option><option>Said</option>
</select></div>

<div class="field"><label>${req("Client name / Ügyfél neve")}</label>
<input name="client_name" list="clientList" required placeholder="Start typing client name / Kezdd el írni az ügyfél nevét">
<datalist id="clientList">${clientOptions}</datalist></div>

<div class="field"><label>${req("Piano name / Zongora neve")}</label>
<input name="piano_name" list="pianoList" required placeholder="Steinway D, Yamaha U1...">
<datalist id="pianoList">${pianoOptions}</datalist></div>

<div class="field"><label>${req("Start / Kezdés")}</label><input name="start_time" type="datetime-local" value="${start}" required></div>
<div class="field"><label>${req("End / Befejezés")}</label><input name="end_time" type="datetime-local" value="${end}" required></div>

<div class="field"><label>Estimated amount / Előzetes összeg</label><input name="planned_amount" type="number" value="0"></div>
<div class="field"><label>Pricing basis / Díjmegállapítás módja</label>
<input name="pricing_basis" placeholder="Phone quote / Telefonos ajánlat, Email quote / E-mail ajánlat, Fixed agreement / Fix megállapodás"></div>

<div class="field"><label>Planned hours / Tervezett óra</label><input name="planned_hours" type="number" value="3"></div>
<div class="field"><label>${req("Service address / Cím")}</label><input name="service_address" required></div>

<div class="field full hidden" id="instructionsField"><label>Remaining tasks / Hátralévő feladatok</label>
<textarea name="instructions" placeholder="Csak részmunka esetén: milyen feladat marad még hátra?"></textarea></div>
</div>
<div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel / Mégse</button><button>Create job / Munka létrehozása</button></div>`;

 $("#form").onsubmit=async ev=>{
   ev.preventDefault();
   let b=Object.fromEntries(new FormData(ev.target));
   ["planned_amount","planned_hours"].forEach(k=>b[k]=Number(b[k]||0));
   b.travel_minutes=0;
   b.priority="Medium";
   b.client_id=null;
   b.piano_id=null;

   const matchedClient=contacts.find(c=>(c.name||"").trim().toLowerCase()===(b.client_name||"").trim().toLowerCase());
   if(matchedClient){
     b.client_id=matchedClient.id;
     if(!b.service_address && matchedClient.address) b.service_address=matchedClient.address;
   }

   const matchedPiano=pianos.find(p=>(`${p.brand||""} ${p.model||""}`).trim().toLowerCase()===(b.piano_name||"").trim().toLowerCase());
   if(matchedPiano) b.piano_id=matchedPiano.id;

   try{
     await api("/api/jobs",{method:"POST",body:JSON.stringify(b)});
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
function openJobDetails(j){$("#modal").classList.remove("hidden");$("#modalTitle").textContent="Job details / Munka részletei";$("#form").innerHTML=`<div class="work-card"><h4>${badge(j.priority)} ${j.title}</h4><p><b>Assigned / Felelős:</b> ${j.assigned_to}</p><p><b>Client / Ügyfél:</b> ${j.client_name||j.client_id||""}</p><p><b>Piano / Zongora:</b> ${j.piano_name||j.piano_id||""}</p><p><b>Time / Idő:</b> ${j.start_time} → ${j.end_time}</p><p><b>Address / Cím:</b> ${j.service_address||""}</p><p><b>Estimated / Előzetes:</b> ${money(j.planned_amount)} · ${j.pricing_basis||""}</p><p><b>Status / Státusz:</b> ${badge(j.status)}</p><p>${j.instructions||""}</p></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Close / Bezár</button><button type="button" onclick='openReassign(${esc(j)})'>Reassign / Átadás</button>${j.status==="Completed"?"":`<button type="button" onclick='openCloseJob(${esc(j)})'>Close job / Lezárás</button>`}</div>`;$("#form").onsubmit=e=>e.preventDefault()}
function openReassign(j){$("#modalTitle").textContent="Reassign job / Munka átadása";$("#form").innerHTML=`<div class="form-grid"><div class="field"><label>${req("New assigned to / Új felelős")}</label><select name="assigned_to"><option>Károly</option><option>Alex</option><option>Paul</option><option>Misi</option><option>Said</option></select></div><div class="field full"><label>Reassignment note / Átadási megjegyzés</label><textarea name="reassignment_note"></textarea></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Save / Mentés</button></div>`;$("#form").onsubmit=async e=>{e.preventDefault();try{await api(`/api/jobs/${j.id}`,{method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});closeModal();renderScheduler()}catch(err){alert(err.message)}}}
function openCloseJob(j){$("#modalTitle").textContent="Close Job / Munka lezárása";$("#form").innerHTML=`<p class="muted">Billed amount / Számlázandó összeg kötelező. Ha 0, nem kell fájl. Ha nagyobb mint 0, fizetési mód és számla/csekk fájl kötelező.</p><div class="form-grid">
<div class="field"><label>${req("Close type / Lezárás típusa")}</label><select name="close_type" id="closeType" onchange="toggleNextJob()"><option>Full</option><option>Partial</option></select></div>
<div class="field"><label>${req("Billed amount / Számlázandó összeg")}</label><input name="billed_amount" type="number" value="${j.planned_amount||0}" required></div>
<div class="field"><label>Payment method / Fizetési mód</label><select name="payment_method"><option value="">No payment / Nincs fizetés</option><option>Cash</option><option>Check</option><option>Bank Transfer</option><option>Credit Card</option><option>Invoice</option></select></div>
<div class="field"><label>Invoice number / Számla vagy csekk szám</label><input name="invoice_number"></div><div class="field"><label>Invoice/check file / Számla vagy csekk fájl</label><input name="file" type="file"></div>
<div class="field full"><label>${req("Close description / Elvégzett munka leírása")}</label><textarea name="close_description" required></textarea></div>
<div id="nextJobFields" class="field full hidden"><h3>Next job / Következő feladat</h3><div class="form-grid"><div class="field full"><label>${req("Next title / Következő feladat neve")}</label><input name="next_title"></div><div class="field"><label>${req("Next assigned to / Következő felelős")}</label><select name="next_assigned_to"><option>Károly</option><option>Alex</option><option>Paul</option><option>Misi</option><option>Said</option></select></div><div class="field"><label>Next priority</label><select name="next_priority"><option>Critical</option><option>Urgent</option><option>High</option><option selected>Medium</option><option>Low</option></select></div><div class="field"><label>${req("Next start / Következő kezdés")}</label><input name="next_start_time" type="datetime-local"></div><div class="field"><label>${req("Next end / Következő befejezés")}</label><input name="next_end_time" type="datetime-local"></div><div class="field"><label>Next planned amount</label><input name="next_planned_amount" type="number" value="0"></div><div class="field full"><label>Next pricing basis / Következő díjmegállapítás</label><input name="next_pricing_basis"></div><div class="field full"><label>Next address / Következő cím</label><input name="next_service_address" value="${j.service_address||""}"></div><div class="field full"><label>Next instructions / Következő teendők</label><textarea name="next_instructions"></textarea></div></div></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Save closeout / Lezárás mentése</button></div>`;
$("#form").onsubmit=async e=>{e.preventDefault();let fd=new FormData(e.target);let billed=Number(fd.get("billed_amount"));let file=fd.get("file");if(billed>0&&(!file||!file.name)){alert("Számla/csekk fájl kötelező, ha az összeg nagyobb mint 0.");return}try{await api(`/api/jobs/${j.id}/close`,{method:"POST",body:fd});closeModal();renderScheduler()}catch(err){alert(err.message)}}}
function toggleNextJob(){document.getElementById("nextJobFields").classList.toggle("hidden",document.getElementById("closeType").value!=="Partial")}
async function renderTable(key){let s=schemas[key],data=await api("/api/"+s.api);$("#"+key).innerHTML=`<div class="panel"><div class="toolbar"><h3>${s.title}</h3><div><button class="small" onclick="exportTable('${key}')">Export CSV</button><button onclick="openForm('${key}')">+ Add / Új</button></div></div><div class="table-wrap"><table><thead><tr>${s.cols.map(c=>`<th>${c}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${data.map(r=>`<tr>${s.cols.map(c=>`<td>${c.includes("amount")||c.includes("value")?money(r[c]):r[c]??""}</td>`).join("")}<td>${key==="contacts"?`<button class="small" onclick="clientProfile('${r.id}')">Profile</button>`:""}<button class="small" onclick='openForm("${key}",${esc(r)})'>Edit</button></td></tr>`).join("")}</tbody></table></div></div>`}
async function clientProfile(id){let p=await api(`/api/client-profile/${id}`);$("#modal").classList.remove("hidden");$("#modalTitle").textContent="Client profile / Ügyfélprofil";$("#form").innerHTML=`<div class="work-card"><h4>${p.client.name} · ${p.client.id}</h4><p><b>Phone / Telefon:</b> ${p.client.phone||""}</p><p><b>Address / Cím:</b> ${p.client.address||""}</p><p><b>Last visit / Utolsó látogatás:</b> ${p.lastVisit||""}</p><p><b>Last job / Legutóbbi munka:</b> ${p.lastJob||""}</p><h3>Pianos / Zongorák</h3>${p.pianos.map(x=>`<p>${x.brand||""} ${x.model||""} · ${x.serial_no||""}</p>`).join("")||"<p>No pianos</p>"}<h3>Jobs / Munkák</h3>${p.jobs.map(x=>`<p>${x.start_time} · ${x.title} · ${x.assigned_to} · ${x.status}</p>`).join("")||"<p>No jobs</p>"}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Close</button></div>`;$("#form").onsubmit=e=>e.preventDefault()}
function openForm(key,row=null){let s=schemas[key];$("#modal").classList.remove("hidden");$("#modalTitle").textContent=(row?"Edit ":"Add ")+s.title;$("#form").innerHTML=`<div class="form-grid">${s.fields.map(f=>field(f,row?.[f[0]])).join("")}</div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Save</button></div>`;$("#form").onsubmit=async e=>{e.preventDefault();let body=Object.fromEntries(new FormData(e.target));s.fields.forEach(f=>{if(f[2]==="number")body[f[0]]=Number(body[f[0]]||0)});try{if(row)await api(`/api/${s.api}/${row.id}`,{method:"PUT",body:JSON.stringify(body)});else await api(`/api/${s.api}`,{method:"POST",body:JSON.stringify(body)});closeModal();render(key)}catch(err){alert(err.message)}}}
function field(f,val=""){let[name,label,type,opts]=f;if(type==="textarea")return `<div class="field full"><label>${label}</label><textarea name="${name}">${val||""}</textarea></div>`;if(type==="select")return `<div class="field"><label>${label}</label><select name="${name}">${opts.map(o=>`<option ${o==val?"selected":""}>${o}</option>`).join("")}</select></div>`;return `<div class="field"><label>${label}</label><input name="${name}" type="${type||"text"}" value="${val??""}"></div>`}
function closeModal(){$("#modal").classList.add("hidden")}
function exportTable(key){api("/api/"+key).then(data=>{if(!data.length){alert("No data");return}let h=Object.keys(data[0]);let csv=[h.join(","),...data.map(r=>h.map(x=>`"${String(r[x]??"").replaceAll('"','""')}"`).join(","))].join("\n");let a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`${key}.csv`;a.click()})}
async function renderFinance(){let e=await api("/api/finance/entries");$("#finance").innerHTML=`<div class="panel"><h3>Finance / Pénzügy</h3><p class="muted">Managers: read-only / Menedzserek: csak megtekintés. Admin: pénzügyi módosítás.</p><div class="table-wrap"><table><thead><tr><th>Date</th><th>Job</th><th>Client</th><th>Piano</th><th>Amount</th><th>Payment method</th><th>Invoice status</th><th>Invoice/check no.</th><th>Lines</th></tr></thead><tbody>${e.map(x=>`<tr><td>${x.entry_date}</td><td>${x.job_title||x.job_id||""}</td><td>${x.client_name||""}</td><td>${x.piano_name||""}</td><td>${money(x.billed_amount||x.lines.reduce((s,l)=>s+Number(l.credit||0),0))}</td><td>${x.payment_method||""}</td><td>${x.invoice_status||""}</td><td>${x.invoice_number||""}</td><td>${x.lines.map(l=>`${l.account_code}: D ${money(l.debit)} / C ${money(l.credit)}`).join("<br>")}</td></tr>`).join("")}</tbody></table></div></div>`}
async function renderIncomeStatement(){let d=await api("/api/income-statement");let acct=c=>d.trialBalance.filter(a=>a.category===c);let rows=arr=>arr.map(a=>`<div class="cf-row"><span>${a.name_en}<br><small>${a.name_hu}</small></span><b>${money(a.balance)}</b></div>`).join("")||"<p class='muted'>No data</p>";$("#income_statement").innerHTML=`<div class="grid kpis"><div class="kpi"><span>Open jobs / Nyitott munkák</span><strong>${d.counts.openJobs}</strong></div><div class="kpi"><span>Closed jobs / Lezárt munkák</span><strong>${d.counts.completedJobs}</strong></div><div class="kpi"><span>Revenue / Bevétel</span><strong>${money(d.totals.revenue)}</strong></div><div class="kpi"><span>Profit / Eredmény</span><strong>${money(d.totals.profit)}</strong></div></div><div class="cashflow-sheet"><div class="cf-box"><h3>Income / Bevételek</h3>${rows(acct("REVENUE"))}</div><div class="cf-box"><h3>Expenses / Kiadások</h3>${rows(acct("EXPENSE"))}<div class="cf-total"><span>Monthly Cash Flow / Havi készpénzáramlás</span><b>${money(d.totals.profit)}</b></div></div><div class="cf-box"><h3>Assets / Eszközök</h3>${rows(acct("ASSET"))}</div><div class="cf-box"><h3>Liabilities / Források</h3>${rows(acct("LIABILITY"))}<div class="cf-total"><span>Net Worth / Nettó vagyon</span><b>${money(d.totals.netWorth)}</b></div></div></div>`}
async function renderAccounts(){let d=await api("/api/income-statement");$("#accounts").innerHTML=`<div class="panel"><h3>General Ledger / Főkönyv</h3><div class="table-wrap"><table><thead><tr><th>Code</th><th>Account</th><th>Category</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${d.trialBalance.map(a=>`<tr><td>${a.code}</td><td>${a.name_en}<br>${a.name_hu}</td><td>${a.category}</td><td>${money(a.debit_total)}</td><td>${money(a.credit_total)}</td><td>${money(a.balance)}</td></tr>`).join("")}</tbody></table></div></div>`}
async function renderUsers(){let u=await api("/api/users");$("#users").innerHTML=`<div class="panel"><div class="toolbar"><h3>Users / Felhasználók</h3><button onclick="openUser()">+ Add user</button></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>${u.map(x=>`<tr><td>${x.name}</td><td>${x.email}</td><td>${x.role}</td><td>${x.status}</td></tr>`).join("")}</tbody></table></div></div>`}
function openUser(){$("#modal").classList.remove("hidden");$("#modalTitle").textContent="Add user / Felhasználó hozzáadása";let roleOptions=user.role==="ADMIN"?["ADMIN","MANAGER","WORKER"]:["MANAGER","WORKER"];$("#form").innerHTML=`<div class="form-grid"><div class="field"><label>Name / Név</label><input name="name" required></div><div class="field"><label>Email</label><input name="email" required></div><div class="field"><label>Password / Jelszó</label><input name="password" required></div><div class="field"><label>Role / Jogosultság</label><select name="role">${roleOptions.map(r=>`<option>${r}</option>`).join("")}</select></div></div><div class="actions"><button type="button" class="ghost-btn" onclick="closeModal()">Cancel</button><button>Create user</button></div>`;$("#form").onsubmit=async e=>{e.preventDefault();try{await api("/api/users",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});closeModal();renderUsers()}catch(err){alert(err.message)}}}
if(token)boot();
