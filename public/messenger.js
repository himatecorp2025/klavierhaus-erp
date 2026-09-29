"use strict";

const MESSENGER_STATUS_LABELS={
  OPEN:["Open","Nyitott"],PENDING_STAFF:["Needs reply","Válaszra vár"],PENDING_CUSTOMER:["Waiting for customer","Ügyfélre vár"],CLOSED:["Closed","Lezárt"]
};
const messengerCategoryLabel=value=>({
  SERVICE:tr("Service enquiry","Szolgáltatás igénybevétele"),TECHNICAL:tr("Technical problem","Technikai probléma"),
  PIANO:tr("Piano & showroom","Zongora és bemutatóterem"),REPAIR:tr("Repair & service","Javítás és szerviz"),
  PRIVATE_CONSULTATION:tr("Private visit / appointment","Privát látogatás / időpont"),BILLING:tr("Billing","Számlázás"),OTHER:tr("Other","Egyéb ügy")
}[String(value||"").toUpperCase()]||String(value||""));
function messengerDate(value,{timeOnly=false}={}){
  if(!value)return "—";const date=new Date(value);if(Number.isNaN(date.getTime()))return "—";
  return new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",...(timeOnly?{timeStyle:"short"}:{dateStyle:"medium",timeStyle:"short"})}).format(date);
}
function messengerLocalInput(value){
  const date=value instanceof Date?value:new Date(value);if(Number.isNaN(date.getTime()))return "";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"})
    .formatToParts(date).reduce((out,part)=>(out[part.type]=part.value,out),{});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour==="24"?"00":parts.hour}:${parts.minute}`;
}
function messengerStatusLabel(value){const pair=MESSENGER_STATUS_LABELS[value]||[value,value];return state.language==="hu"?pair[1]:pair[0];}
function messengerSupportBadge(status){return `<span class="messenger-live-badge ${status?.open?"is-live":""}">${status?.open?"●":"○"} ${status?.open?tr("Live support","Élő ügyfélszolgálat"):tr("Offline support","Offline ügyfélszolgálat")} · 9–17 ET</span>`;}
function stopMessengerRefresh(){clearInterval(state.messengerTimer);state.messengerTimer=null;}
function messengerDurationOptions(selected=60){return [60,90,120,180].map(value=>`<option value="${value}" ${Number(selected)===value?"selected":""}>${value} ${tr("min","perc")}</option>`).join("");}
function messengerStatusCards(){
  const rows=state.messengerConversations||[],requests=state.messengerRequests||[],appointments=state.messengerAppointments||[];
  const counts={
    all:rows.filter(row=>row.status!=="CLOSED").length,
    PENDING_STAFF:rows.filter(row=>row.status==="PENDING_STAFF").length,
    PENDING_CUSTOMER:rows.filter(row=>row.status==="PENDING_CUSTOMER").length,
    requests:requests.filter(row=>["REQUESTED","PROPOSED"].includes(row.status)).length,
    appointments:appointments.length,
    CLOSED:rows.filter(row=>row.status==="CLOSED").length
  };
  const cards=[
    ["all","✦",tr("Inbox","Beérkezett")],["PENDING_STAFF","↩",tr("Needs reply","Válaszra vár")],
    ["PENDING_CUSTOMER","⌛",tr("Waiting","Ügyfélre vár")],["requests","◷",tr("Private requests","Privát kérések")],
    ["appointments","✓",tr("Scheduled","Naptárban")],["CLOSED","○",tr("Closed","Lezárt")]
  ];
  return cards.map(([key,icon,label],index)=>`<button type="button" class="messenger-status-card ${index===0?"active":""}" data-messenger-filter="${key}"><span>${icon}</span><strong>${counts[key]||0}</strong><small>${label}</small></button>`).join("");
}

async function renderMessenger({preserveSelection=true}={}){
  stopMessengerRefresh();const workspace=$("#workspace");
  workspace.innerHTML=pageHead(tr("Messenger","Messenger"),tr("Customer support, private requests and confirmed appointments in one workspace.","Ügyfélszolgálat, privát időpontkérések és jóváhagyott időpontok egy munkafelületen."))+loading();
  try{
    const [inbox,appointments,requests]=await Promise.all([
      api("/api/customer-conversations"),api("/api/private-appointments?status=SCHEDULED"),api("/api/private-appointment-requests")
    ]);
    state.messengerConversations=inbox.conversations||[];state.messengerAppointments=appointments||[];state.messengerRequests=requests||[];
    if(!preserveSelection||!state.messengerConversationId||!state.messengerConversations.some(row=>row.id===state.messengerConversationId))state.messengerConversationId=state.messengerConversations[0]?.id||null;
    workspace.innerHTML=pageHead(tr("Messenger","Messenger"),tr("Customer support, live conversations and approval-gated private appointments.","Ügyfélszolgálat, élő beszélgetések és jóváhagyáshoz kötött privát időpontok."),messengerSupportBadge(inbox.support))+
      `<div class="messenger-status-cards">${messengerStatusCards()}</div>
      <section class="messenger-shell">
        <aside class="panel messenger-inbox"><div class="messenger-inbox-head"><div><span class="eyebrow">${tr("MESSENGER QUEUE","MESSENGER VÁRÓLISTA")}</span><strong>${state.messengerConversations.filter(row=>row.status!=="CLOSED").length}</strong></div><button id="messengerRefresh" class="icon-button" type="button" aria-label="${tr("Refresh","Frissítés")}">↻</button></div><div id="messengerList" class="messenger-list"></div></aside>
        <main class="panel messenger-thread" id="messengerThread"><div class="empty-state">${tr("Select a conversation or request.","Válassz beszélgetést vagy időpontkérést.")}</div></main>
        <aside class="panel messenger-context" id="messengerContext"><div class="empty-state">${tr("Details and actions appear here.","Itt jelennek meg a részletek és műveletek.")}</div></aside>
      </section>`;
    bindMessengerShell();renderMessengerList("all");if(state.messengerConversationId)await openMessengerConversation(state.messengerConversationId);
    state.messengerTimer=setInterval(()=>{if(state.view==="messenger")void refreshMessengerInboxSilently();else stopMessengerRefresh();},5000);
  }catch(error){workspace.innerHTML=pageHead(tr("Messenger","Messenger"),"")+ `<section class="panel empty-state">${esc(humanError(error))}</section>`;}
}
function renderMessengerList(filter="all"){
  const host=$("#messengerList");if(!host)return;
  if(filter==="requests"){
    const rows=(state.messengerRequests||[]).filter(row=>["REQUESTED","PROPOSED"].includes(row.status));
    host.innerHTML=rows.map(row=>`<button class="messenger-list-item messenger-request-row" type="button" data-messenger-request="${esc(row.id)}"><span class="messenger-list-top"><strong>${esc(row.name)}</strong><small>${esc(messengerDate(row.requested_at,{timeOnly:true}))}</small></span><span>${esc(row.appointment_type.replaceAll("_"," "))}</span><small>${esc(messengerDate(row.requested_at))} · ${Number(row.requested_duration_min||60)} ${tr("min","perc")}</small><span class="messenger-list-meta"><em class="status-pill">${esc(row.status)}</em></span></button>`).join("")||`<div class="empty-state">${tr("No private appointment requests awaiting action.","Nincs feldolgozásra váró privát időpontkérés.")}</div>`;
    $$("[data-messenger-request]",host).forEach(button=>button.addEventListener("click",()=>openMessengerRequest(button.dataset.messengerRequest)));return;
  }
  if(filter==="appointments"){
    host.innerHTML=(state.messengerAppointments||[]).map(row=>`<button class="messenger-list-item messenger-appointment-row" type="button" data-messenger-appointment="${esc(row.id)}"><span class="messenger-list-top"><strong>${esc(row.name)}</strong><small>${esc(messengerDate(row.scheduled_at,{timeOnly:true}))}</small></span><span>${esc(row.appointment_type?.replaceAll("_"," ")||"Private appointment")}</span><small>${esc(messengerDate(row.scheduled_at))} · ${Number(row.duration_min||60)} ${tr("min","perc")}</small></button>`).join("")||`<div class="empty-state">${tr("No scheduled private appointments.","Nincs naptárba helyezett privát időpont.")}</div>`;
    $$("[data-messenger-appointment]",host).forEach(button=>button.addEventListener("click",()=>openMessengerAppointment(button.dataset.messengerAppointment)));return;
  }
  const rows=(state.messengerConversations||[]).filter(row=>filter==="all"?(row.status!=="CLOSED"):row.status===filter);
  host.innerHTML=rows.map(row=>`<button class="messenger-list-item ${row.id===state.messengerConversationId?"active":""}" type="button" data-messenger-conversation="${esc(row.id)}"><span class="messenger-list-top"><strong>${esc(row.name||row.email||tr("Website visitor","Weboldali látogató"))}</strong><small>${esc(messengerDate(row.last_activity_at||row.created_at,{timeOnly:true}))}</small></span><span>${esc(messengerCategoryLabel(row.category))}</span><small>${esc(row.last_message||"")}</small><span class="messenger-list-meta"><em class="status-pill">${esc(messengerStatusLabel(row.status))}</em>${Number(row.unread_count||0)>0?`<b>${Number(row.unread_count)}</b>`:""}</span></button>`).join("")||`<div class="empty-state">${tr("No conversations in this view.","Ebben a nézetben nincs beszélgetés.")}</div>`;
  $$("[data-messenger-conversation]",host).forEach(button=>button.addEventListener("click",()=>openMessengerConversation(button.dataset.messengerConversation)));
}
function bindMessengerShell(){
  $("#messengerRefresh")?.addEventListener("click",()=>renderMessenger());
  $$("[data-messenger-filter]").forEach(button=>button.addEventListener("click",()=>{$$("[data-messenger-filter]").forEach(item=>item.classList.toggle("active",item===button));renderMessengerList(button.dataset.messengerFilter);}));
}
async function refreshMessengerInboxSilently(){
  try{
    const [inbox,appointments,requests]=await Promise.all([api("/api/customer-conversations"),api("/api/private-appointments?status=SCHEDULED"),api("/api/private-appointment-requests")]);
    state.messengerConversations=inbox.conversations||[];state.messengerAppointments=appointments||[];state.messengerRequests=requests||[];
    const active=document.querySelector("[data-messenger-filter].active")?.dataset.messengerFilter||"all";renderMessengerList(active);
    const cards=document.querySelector(".messenger-status-cards");if(cards){cards.innerHTML=messengerStatusCards();$$("[data-messenger-filter]",cards).forEach(button=>{button.classList.toggle("active",button.dataset.messengerFilter===active);button.addEventListener("click",()=>{$$("[data-messenger-filter]").forEach(item=>item.classList.toggle("active",item===button));renderMessengerList(button.dataset.messengerFilter);});});}
  }catch(_error){}
}

async function openMessengerConversation(id,{quiet=false}={}){
  state.messengerConversationId=id;$$("[data-messenger-conversation]").forEach(button=>button.classList.toggle("active",button.dataset.messengerConversation===id));
  const [conversation,users]=await Promise.all([api(`/api/customer-conversations/${encodeURIComponent(id)}`),state.users?.length?Promise.resolve(state.users):api("/api/users")]);
  if(!state.users?.length)state.users=users;const thread=$("#messengerThread"),context=$("#messengerContext");if(!thread||!context)return;
  const proposalCards=(conversation.appointment_proposals||[]).map(proposal=>{
    const duration=Math.round((new Date(proposal.ends_at)-new Date(proposal.starts_at))/60000),accepted=proposal.status==="ACCEPTED"&&!proposal.private_appointment_id,scheduled=Boolean(proposal.private_appointment_id);
    return `<article class="messenger-proposal-card ${proposal.status.toLowerCase()}"><strong>${tr("Appointment proposal","Időpontjavaslat")}</strong><p>${esc(messengerDate(proposal.starts_at))} · ${duration} ${tr("min","perc")}</p><small>${scheduled?tr("Scheduled in calendar","Naptárba helyezve"):accepted?tr("Customer accepted · staff finalization required","Ügyfél elfogadta · staff véglegesítés szükséges"):esc(proposal.status)}</small>${accepted?`<button class="primary-button compact-button" type="button" data-finalize-proposal="${esc(proposal.id)}">${tr("Finalize & add to calendar","Véglegesítés és naptárba helyezés")}</button>`:""}</article>`;
  }).join("");
  thread.innerHTML=`<header class="messenger-thread-head"><div><span class="eyebrow">${esc(messengerCategoryLabel(conversation.category))}</span><h2>${esc(conversation.name||conversation.email||tr("Website visitor","Weboldali látogató"))}</h2><p>${esc(conversation.email||"")}</p></div><span class="status-pill">${esc(messengerStatusLabel(conversation.status))}</span></header><div class="messenger-messages">${(conversation.messages||[]).map(message=>`<article class="messenger-message ${message.direction==="STAFF"?"staff":"customer"}"><div><strong>${esc(message.sender_name||"")}</strong><small>${esc(messengerDate(message.created_at))}</small></div><p>${esc(message.body)}</p>${(message.attachments||[]).map(file=>`<a target="_blank" rel="noopener" href="${esc(file.url)}">↳ ${esc(file.original_name||file.stored_name)}</a>`).join("")}</article>`).join("")}${proposalCards}</div><form id="messengerReplyForm" class="messenger-reply"><textarea name="message" rows="3" maxlength="5000" required placeholder="${tr("Write a reply…","Írj választ…")}"></textarea><button class="primary-button" type="submit">↗ ${tr("Send reply","Válasz küldése")}</button></form>`;
  const assignees=(state.users||[]).filter(user=>user.status==="Active"&&["ADMIN","MANAGER","WORKER","SUPERADMIN"].includes(user.role));
  context.innerHTML=`<div class="messenger-context-section"><span class="eyebrow">${tr("CUSTOMER","ÜGYFÉL")}</span><h3>${esc(conversation.name||"—")}</h3><p>${esc(conversation.email||"—")}</p><p>${esc(conversation.source_path||"")}</p></div><div class="messenger-context-section"><label class="field"><span>${tr("Assigned to","Felelős")}</span><select id="messengerAssignee"><option value="">${tr("Support queue","Support várólista")}</option>${assignees.map(user=>`<option value="${esc(user.id)}" ${conversation.assigned_user_id===user.id?"selected":""}>${esc(user.name)} · ${esc(user.role)}</option>`).join("")}</select></label><div class="messenger-context-actions"><button id="messengerTake" class="secondary-button" type="button">${tr("Take conversation","Beszélgetés átvétele")}</button><button id="messengerClose" class="secondary-button" type="button">${conversation.status==="CLOSED"?tr("Reopen","Újranyitás"):tr("Close","Lezárás")}</button></div></div><div class="messenger-context-section"><span class="eyebrow">${tr("NEXT ACTION","KÖVETKEZŐ LÉPÉS")}</span><button id="messengerProposeAppointment" class="secondary-button" type="button">◷ ${tr("Propose appointment","Időpont javaslata")}</button><button id="messengerCreateIntake" class="secondary-button" type="button">＋ ${conversation.linked_intake?tr("Edit linked Intake","Kapcsolt igény szerkesztése"):tr("Create / edit Intake","Igény létrehozása / szerkesztése")}</button></div>${(conversation.private_appointments||[]).length?`<div class="messenger-context-section"><span class="eyebrow">${tr("CONFIRMED APPOINTMENTS","JÓVÁHAGYOTT IDŐPONTOK")}</span>${conversation.private_appointments.map(item=>`<div class="messenger-mini-card"><strong>${esc(messengerDate(item.scheduled_at))}</strong><small>${Number(item.duration_min||60)} ${tr("min","perc")} · ${esc(item.status)}</small></div>`).join("")}</div>`:""}`;
  bindMessengerConversation(conversation);
  $$("[data-finalize-proposal]",thread).forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;try{await api(`/api/customer-conversations/${conversation.id}/appointment-proposals/${button.dataset.finalizeProposal}/finalize`,{method:"POST",body:JSON.stringify({})});toast(tr("Appointment finalized and added to calendar.","Időpont véglegesítve és naptárba helyezve."),"success");await openMessengerConversation(conversation.id);await refreshMessengerInboxSilently();}catch(error){button.disabled=false;toast(humanError(error),"error");}}));
  if(!quiet)renderMessengerList(document.querySelector("[data-messenger-filter].active")?.dataset.messengerFilter||"all");
}
function bindMessengerConversation(conversation){
  $("#messengerReplyForm")?.addEventListener("submit",async event=>{event.preventDefault();const message=String(new FormData(event.currentTarget).get("message")||"").trim();if(!message)return;const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;try{await api(`/api/customer-conversations/${conversation.id}/reply`,{method:"POST",body:JSON.stringify({message})});await openMessengerConversation(conversation.id);await refreshMessengerInboxSilently();}catch(error){button.disabled=false;toast(humanError(error),"error");}});
  $("#messengerTake")?.addEventListener("click",async()=>{try{await api(`/api/customer-conversations/${conversation.id}/assign`,{method:"PUT",body:JSON.stringify({assigned_user_id:state.user.id})});await openMessengerConversation(conversation.id);}catch(error){toast(humanError(error),"error");}});
  $("#messengerAssignee")?.addEventListener("change",async event=>{try{await api(`/api/customer-conversations/${conversation.id}/assign`,{method:"PUT",body:JSON.stringify({assigned_user_id:event.target.value||state.user.id})});await openMessengerConversation(conversation.id,{quiet:true});}catch(error){toast(humanError(error),"error");}});
  $("#messengerClose")?.addEventListener("click",async()=>{const next=conversation.status==="CLOSED"?"OPEN":"CLOSED";try{await api(`/api/customer-conversations/${conversation.id}/status`,{method:"PUT",body:JSON.stringify({status:next})});await openMessengerConversation(conversation.id);await refreshMessengerInboxSilently();}catch(error){toast(humanError(error),"error");}});
  $("#messengerProposeAppointment")?.addEventListener("click",()=>openMessengerAppointmentProposal(conversation));
  $("#messengerCreateIntake")?.addEventListener("click",async()=>{
    try{
      if(conversation.linked_intake){state.pendingIntakeEditId=conversation.linked_intake.id;navTo("intake");return;}
      const draft=await api(`/api/customer-conversations/${conversation.id}/intake-draft`);
      await openIntakeDialog({seed:draft,sourceConversationId:conversation.id,onSaved:async()=>{toast(tr("Intake saved from Messenger.","Igényfelmérés elmentve a Messengerből."),"success");navTo("intake");}});
    }catch(error){toast(humanError(error),"error");}
  });
}
function openMessengerAppointmentProposal(conversation){
  const defaultStart=new Date(Date.now()+24*60*60*1000);defaultStart.setMinutes(Math.ceil(defaultStart.getMinutes()/15)*15,0,0);const start=messengerLocalInput(defaultStart);
  openDialog({title:tr("Propose appointment","Időpont javaslata"),eyebrow:"MESSENGER",body:`<form id="messengerAppointmentForm" class="form-grid"><label class="field"><span>${tr("Type","Típus")}</span><select name="appointment_type"><option value="PRIVATE_VISIT">${tr("Private visit","Privát látogatás")}</option><option value="PIANO_VIEWING">${tr("Piano viewing","Zongora megtekintés")}</option><option value="SERVICE_CONSULTATION">${tr("Service consultation","Szerviz konzultáció")}</option></select></label><label class="field"><span>${tr("Phone","Telefon")}</span><input name="phone"></label><label class="field"><span>${tr("Starts","Kezdés")}</span><input name="starts_at" type="datetime-local" step="900" value="${start}" required></label><label class="field"><span>${tr("Duration","Időtartam")}</span><select name="duration_min">${messengerDurationOptions(60)}</select></label><label class="field full"><span>${tr("Note","Megjegyzés")}</span><textarea name="note"></textarea></label><div class="detail-note full">${tr("The proposed slot is held temporarily. Customer acceptance still requires staff finalization before it enters the calendar.","A javasolt idősáv ideiglenesen foglalt. Az ügyfél elfogadása után staff véglegesítés kell a naptárba helyezéshez.")}</div><div class="form-actions full"><button class="secondary-button" type="button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Send proposal","Javaslat küldése")}</button></div></form>`});
  $("#messengerAppointmentForm").addEventListener("submit",async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.duration_min=Number(body.duration_min||60);try{await api(`/api/customer-conversations/${conversation.id}/appointment-proposals`,{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Appointment proposal sent with a temporary hold.","Időpontjavaslat elküldve ideiglenes foglalással."),"success");await openMessengerConversation(conversation.id);}catch(error){toast(humanError(error),"error");}});
}

function openMessengerRequest(id){
  const row=(state.messengerRequests||[]).find(item=>String(item.id)===String(id));if(!row)return;const thread=$("#messengerThread"),context=$("#messengerContext");if(!thread||!context)return;
  thread.innerHTML=`<div class="messenger-request-detail"><span class="eyebrow">${tr("PRIVATE APPOINTMENT REQUEST","PRIVÁT IDŐPONTKÉRÉS")}</span><h2>${esc(row.name)}</h2><p class="messenger-appointment-time">${esc(messengerDate(row.requested_at))}</p><dl><dt>${tr("Requested duration","Kért időtartam")}</dt><dd>${Number(row.requested_duration_min||60)} ${tr("min","perc")}</dd><dt>Email</dt><dd>${esc(row.email)}</dd><dt>${tr("Phone","Telefon")}</dt><dd>${esc(row.phone)}</dd><dt>${tr("Context","Kapcsolat")}</dt><dd>${esc(row.piano_title_en||row.service_title_en||row.appointment_type.replaceAll("_"," "))}</dd><dt>${tr("Note","Megjegyzés")}</dt><dd>${esc(row.note||"—")}</dd></dl></div>`;
  context.innerHTML=`<div class="messenger-context-section"><span class="eyebrow">${tr("STAFF REVIEW","STAFF JÓVÁHAGYÁS")}</span><p>${tr("Nothing enters the calendar until a staff member approves or finalizes it.","Semmi nem kerül a naptárba staff jóváhagyás vagy véglegesítés nélkül.")}</p><button id="approvePrivateRequest" class="primary-button" type="button">✓ ${tr("Approve & add to calendar","Jóváhagyás és naptárba helyezés")}</button><button id="proposePrivateRequest" class="secondary-button" type="button">◷ ${tr("Propose another time","Másik időpont javaslata")}</button><button id="declinePrivateRequest" class="secondary-button danger-text" type="button">${tr("Decline request","Kérés elutasítása")}</button></div>`;
  $("#approvePrivateRequest").addEventListener("click",()=>openPrivateRequestReview(row,"approve"));
  $("#proposePrivateRequest").addEventListener("click",()=>openPrivateRequestReview(row,"propose"));
  $("#declinePrivateRequest").addEventListener("click",async()=>{if(!confirm(tr("Decline this private appointment request?","Elutasítod ezt a privát időpontkérést?")))return;try{await api(`/api/private-appointment-requests/${row.id}/decline`,{method:"POST",body:JSON.stringify({})});toast(tr("Request declined and customer notified.","Kérés elutasítva, ügyfél értesítve."),"success");await renderMessenger({preserveSelection:false});}catch(error){toast(humanError(error),"error");}});
}
function openPrivateRequestReview(row,mode){
  openDialog({title:mode==="approve"?tr("Approve private appointment","Privát időpont jóváhagyása"):tr("Propose another time","Másik időpont javaslata"),eyebrow:"PRIVATE APPOINTMENT",body:`<form id="privateRequestReviewForm" class="form-grid"><label class="field"><span>${tr("Starts","Kezdés")}</span><input name="scheduled_at" type="datetime-local" step="900" value="${esc(messengerLocalInput(row.requested_at))}" required></label><label class="field"><span>${tr("Duration","Időtartam")}</span><select name="duration_min">${messengerDurationOptions(row.requested_duration_min||60)}</select></label><label class="field full"><span>${tr("Assigned to","Felelős")}</span><select name="assigned_user_id"><option value="">${tr("Current staff member","Aktuális munkatárs")}</option>${(state.users||[]).filter(user=>user.status==="Active").map(user=>`<option value="${esc(user.id)}">${esc(user.name)}</option>`).join("")}</select></label><div class="detail-note full">${tr("Private appointments are separated by at least 15 minutes. The selected duration may be 60, 90, 120 or 180 minutes.","A privát időpontok között legalább 15 perc szabad idő marad. Az időtartam 60, 90, 120 vagy 180 perc lehet.")}</div><div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${mode==="approve"?tr("Approve & schedule","Jóváhagyás és naptárba helyezés"):tr("Send proposal","Javaslat küldése")}</button></div></form>`});
  $("#privateRequestReviewForm").addEventListener("submit",async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.duration_min=Number(body.duration_min||60);if(!body.assigned_user_id)delete body.assigned_user_id;try{const result=await api(`/api/private-appointment-requests/${row.id}/${mode==="approve"?"approve":"propose"}`,{method:"POST",body:JSON.stringify(mode==="approve"?{scheduled_at:body.scheduled_at,duration_min:body.duration_min,assigned_user_id:body.assigned_user_id}:{starts_at:body.scheduled_at,duration_min:body.duration_min,assigned_user_id:body.assigned_user_id})});closeDialog();toast(mode==="approve"?tr("Appointment approved and added to calendar.","Időpont jóváhagyva és naptárba helyezve."):tr("Alternative time sent to the customer.","Másik időpont elküldve az ügyfélnek."),"success");await renderMessenger({preserveSelection:false});if(mode==="propose"&&result.conversation_id)await openMessengerConversation(result.conversation_id);}catch(error){toast(humanError(error),"error");}});
}
function openMessengerAppointment(id){
  const row=(state.messengerAppointments||[]).find(item=>item.id===id);if(!row)return;
  $("#messengerThread").innerHTML=`<div class="messenger-appointment-detail"><span class="eyebrow">${tr("PRIVATE APPOINTMENT","PRIVÁT IDŐPONT")}</span><h2>${esc(row.name)}</h2><p class="messenger-appointment-time">${esc(messengerDate(row.scheduled_at))}</p><dl><dt>${tr("Duration","Időtartam")}</dt><dd>${Number(row.duration_min||60)} ${tr("min","perc")}</dd><dt>${tr("Type","Típus")}</dt><dd>${esc(row.appointment_type.replaceAll("_"," "))}</dd><dt>${tr("Assigned","Felelős")}</dt><dd>${esc(row.assigned_user_name||"—")}</dd><dt>${tr("Note","Megjegyzés")}</dt><dd>${esc(row.note||"—")}</dd></dl></div>`;
  $("#messengerContext").innerHTML=`<div class="messenger-context-section"><span class="eyebrow">${tr("CALENDAR","NAPTÁR")}</span><button class="primary-button" type="button" data-nav="workshop">${tr("Open calendar","Naptár megnyitása")}</button></div>`;
  $("#messengerContext [data-nav]")?.addEventListener("click",()=>navTo("workshop"));
}
