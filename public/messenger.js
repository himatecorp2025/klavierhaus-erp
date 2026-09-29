"use strict";

const MESSENGER_STATUS_LABELS={
  OPEN:["Open","Nyitott"],PENDING_STAFF:["Needs reply","Válaszra vár"],PENDING_CUSTOMER:["Waiting for customer","Ügyfélre vár"],CLOSED:["Closed","Lezárt"]
};
const messengerCategoryLabel=value=>({
  SERVICE:tr("Service enquiry","Szolgáltatás igénybevétele"),
  TECHNICAL:tr("Technical problem","Technikai probléma"),
  PIANO:tr("Piano & showroom","Zongora és bemutatóterem"),
  REPAIR:tr("Repair & service","Javítás és szerviz"),
  PRIVATE_CONSULTATION:tr("Private visit / appointment","Privát látogatás / időpont"),
  BILLING:tr("Billing","Számlázás"),
  OTHER:tr("Other","Egyéb ügy")
}[String(value||"").toUpperCase()]||String(value||""));

function messengerDate(value,{timeOnly=false}={}){
  if(!value)return "—";const date=new Date(value);if(Number.isNaN(date.getTime()))return "—";
  return new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{
    timeZone:"America/New_York",...(timeOnly?{timeStyle:"short"}:{dateStyle:"medium",timeStyle:"short"})
  }).format(date);
}
function messengerStatusLabel(value){const pair=MESSENGER_STATUS_LABELS[value]||[value,value];return state.language==="hu"?pair[1]:pair[0];}
function messengerSupportBadge(status){
  return `<span class="messenger-live-badge ${status?.open?"is-live":""}">${status?.open?"●":"○"} ${status?.open?tr("Live support","Élő ügyfélszolgálat"):tr("Offline support","Offline ügyfélszolgálat")} · 9–17 ET</span>`;
}
function stopMessengerRefresh(){clearInterval(state.messengerTimer);state.messengerTimer=null;}

async function renderMessenger({preserveSelection=true}={}){
  stopMessengerRefresh();
  const workspace=$("#workspace");
  workspace.innerHTML=pageHead(tr("Messenger","Messenger"),tr("Customer support, live conversations and private appointments in one workspace.","Ügyfélszolgálat, élő beszélgetések és privát időpontok egy munkafelületen."))+loading();
  try{
    const [inbox,appointments]=await Promise.all([api("/api/customer-conversations"),api("/api/private-appointments?status=SCHEDULED")]);
    state.messengerConversations=inbox.conversations||[];
    state.messengerAppointments=appointments||[];
    if(!preserveSelection||!state.messengerConversationId||!state.messengerConversations.some(row=>row.id===state.messengerConversationId)){
      state.messengerConversationId=state.messengerConversations[0]?.id||null;
    }
    workspace.innerHTML=pageHead(tr("Messenger","Messenger"),tr("Customer support, live conversations and private appointments in one workspace.","Ügyfélszolgálat, élő beszélgetések és privát időpontok egy munkafelületen."),messengerSupportBadge(inbox.support))+
      `<section class="messenger-shell">
        <aside class="panel messenger-inbox">
          <div class="messenger-inbox-head"><div><span class="eyebrow">${tr("INBOX","BEÉRKEZETT")}</span><strong>${state.messengerConversations.filter(row=>row.status!=="CLOSED").length}</strong></div><button id="messengerRefresh" class="icon-button" type="button" aria-label="${tr("Refresh","Frissítés")}">↻</button></div>
          <div class="messenger-filters">
            <button type="button" data-messenger-filter="all" class="active">${tr("All","Mind")}</button>
            <button type="button" data-messenger-filter="PENDING_STAFF">${tr("Needs reply","Válaszra vár")}</button>
            <button type="button" data-messenger-filter="PENDING_CUSTOMER">${tr("Waiting","Várakozik")}</button>
            <button type="button" data-messenger-filter="appointments">${tr("Appointments","Időpontok")}</button>
          </div>
          <div id="messengerList" class="messenger-list"></div>
        </aside>
        <main class="panel messenger-thread" id="messengerThread"><div class="empty-state">${tr("Select a conversation.","Válassz beszélgetést.")}</div></main>
        <aside class="panel messenger-context" id="messengerContext"><div class="empty-state">${tr("Conversation details appear here.","Itt jelennek meg a beszélgetés részletei.")}</div></aside>
      </section>`;
    bindMessengerShell();
    renderMessengerList("all");
    if(state.messengerConversationId)await openMessengerConversation(state.messengerConversationId);
    state.messengerTimer=setInterval(()=>{if(state.view==="messenger")void refreshMessengerInboxSilently();else stopMessengerRefresh();},5000);
  }catch(error){workspace.innerHTML=pageHead(tr("Messenger","Messenger"),"")+ `<section class="panel empty-state">${esc(humanError(error))}</section>`;}
}

function renderMessengerList(filter="all"){
  const host=$("#messengerList");if(!host)return;
  if(filter==="appointments"){
    host.innerHTML=(state.messengerAppointments||[]).map(row=>`<button class="messenger-list-item messenger-appointment-row" type="button" data-messenger-appointment="${esc(row.id)}"><span class="messenger-list-top"><strong>${esc(row.name)}</strong><small>${esc(messengerDate(row.scheduled_at,{timeOnly:true}))}</small></span><span>${esc(row.appointment_type?.replaceAll("_"," ")||"Private appointment")}</span><small>${esc(messengerDate(row.scheduled_at))}</small></button>`).join("")||`<div class="empty-state">${tr("No upcoming private appointments.","Nincs közelgő privát időpont.")}</div>`;
    $$("[data-messenger-appointment]",host).forEach(button=>button.addEventListener("click",()=>openMessengerAppointment(button.dataset.messengerAppointment)));
    return;
  }
  const rows=(state.messengerConversations||[]).filter(row=>filter==="all"||row.status===filter);
  host.innerHTML=rows.map(row=>`<button class="messenger-list-item ${row.id===state.messengerConversationId?"active":""}" type="button" data-messenger-conversation="${esc(row.id)}">
    <span class="messenger-list-top"><strong>${esc(row.name||row.email||tr("Website visitor","Weboldali látogató"))}</strong><small>${esc(messengerDate(row.last_activity_at||row.created_at,{timeOnly:true}))}</small></span>
    <span>${esc(messengerCategoryLabel(row.category))}</span>
    <small>${esc(row.last_message||"")}</small>
    <span class="messenger-list-meta"><em class="status-pill">${esc(messengerStatusLabel(row.status))}</em>${Number(row.unread_count||0)>0?`<b>${Number(row.unread_count)}</b>`:""}</span>
  </button>`).join("")||`<div class="empty-state">${tr("No conversations in this filter.","Ebben a szűrőben nincs beszélgetés.")}</div>`;
  $$("[data-messenger-conversation]",host).forEach(button=>button.addEventListener("click",()=>openMessengerConversation(button.dataset.messengerConversation)));
}

function bindMessengerShell(){
  $("#messengerRefresh")?.addEventListener("click",()=>renderMessenger());
  $$("[data-messenger-filter]").forEach(button=>button.addEventListener("click",()=>{
    $$("[data-messenger-filter]").forEach(item=>item.classList.toggle("active",item===button));renderMessengerList(button.dataset.messengerFilter);
  }));
}

async function refreshMessengerInboxSilently(){
  try{
    const inbox=await api("/api/customer-conversations"),oldSelected=state.messengerConversationId;
    state.messengerConversations=inbox.conversations||[];renderMessengerList(document.querySelector("[data-messenger-filter].active")?.dataset.messengerFilter||"all");
    if(oldSelected&&state.messengerConversations.some(row=>row.id===oldSelected)&&$("#messengerThread"))await openMessengerConversation(oldSelected,{quiet:true});
  }catch(_error){}
}

async function openMessengerConversation(id,{quiet=false}={}){
  state.messengerConversationId=id;
  $$("[data-messenger-conversation]").forEach(button=>button.classList.toggle("active",button.dataset.messengerConversation===id));
  const [conversation,users]=await Promise.all([api(`/api/customer-conversations/${encodeURIComponent(id)}`),state.users?.length?Promise.resolve(state.users):api("/api/users")]);
  if(!state.users?.length)state.users=users;
  const thread=$("#messengerThread"),context=$("#messengerContext");if(!thread||!context)return;
  thread.innerHTML=`<header class="messenger-thread-head"><div><span class="eyebrow">${esc(messengerCategoryLabel(conversation.category))}</span><h2>${esc(conversation.name||conversation.email||tr("Website visitor","Weboldali látogató"))}</h2><p>${esc(conversation.email||"")}</p></div><span class="status-pill">${esc(messengerStatusLabel(conversation.status))}</span></header>
    <div class="messenger-messages">${(conversation.messages||[]).map(message=>`<article class="messenger-message ${message.direction==="STAFF"?"staff":"customer"}"><div><strong>${esc(message.sender_name||"")}</strong><small>${esc(messengerDate(message.created_at))}</small></div><p>${esc(message.body)}</p>${(message.attachments||[]).map(file=>`<a target="_blank" rel="noopener" href="${esc(file.url)}">↳ ${esc(file.original_name||file.stored_name)}</a>`).join("")}</article>`).join("")}
      ${(conversation.appointment_proposals||[]).map(proposal=>`<article class="messenger-proposal-card ${proposal.status.toLowerCase()}"><strong>${tr("Appointment proposal","Időpontjavaslat")}</strong><p>${esc(messengerDate(proposal.starts_at))} – ${esc(messengerDate(proposal.ends_at,{timeOnly:true}))} ET</p><small>${esc(proposal.status)}</small></article>`).join("")}
    </div>
    <form id="messengerReplyForm" class="messenger-reply"><textarea name="message" rows="3" maxlength="5000" required placeholder="${tr("Write a reply…","Írj választ…")}"></textarea><button class="primary-button" type="submit">↗ ${tr("Send reply","Válasz küldése")}</button></form>`;
  const assignees=(state.users||[]).filter(user=>user.status==="Active"&&["ADMIN","MANAGER","WORKER","SUPERADMIN"].includes(user.role));
  context.innerHTML=`<div class="messenger-context-section"><span class="eyebrow">${tr("CUSTOMER","ÜGYFÉL")}</span><h3>${esc(conversation.name||"—")}</h3><p>${esc(conversation.email||"—")}</p><p>${esc(conversation.source_path||"")}</p></div>
    <div class="messenger-context-section"><label class="field"><span>${tr("Assigned to","Felelős")}</span><select id="messengerAssignee"><option value="">${tr("Support queue","Support várólista")}</option>${assignees.map(user=>`<option value="${esc(user.id)}" ${conversation.assigned_user_id===user.id?"selected":""}>${esc(user.name)} · ${esc(user.role)}</option>`).join("")}</select></label>
      <div class="messenger-context-actions"><button id="messengerTake" class="secondary-button" type="button">${tr("Take conversation","Beszélgetés átvétele")}</button><button id="messengerClose" class="secondary-button" type="button">${conversation.status==="CLOSED"?tr("Reopen","Újranyitás"):tr("Close","Lezárás")}</button></div></div>
    <div class="messenger-context-section"><span class="eyebrow">${tr("NEXT ACTION","KÖVETKEZŐ LÉPÉS")}</span><button id="messengerProposeAppointment" class="secondary-button" type="button">◷ ${tr("Propose appointment","Időpont javaslata")}</button><button id="messengerCreateIntake" class="secondary-button" type="button">＋ ${conversation.linked_intake?tr("Open linked Intake","Kapcsolt igény megnyitása"):tr("Create Intake","Igényfelmérés létrehozása")}</button></div>
    ${(conversation.private_appointments||[]).length?`<div class="messenger-context-section"><span class="eyebrow">${tr("CONFIRMED APPOINTMENTS","JÓVÁHAGYOTT IDŐPONTOK")}</span>${conversation.private_appointments.map(item=>`<div class="messenger-mini-card"><strong>${esc(messengerDate(item.scheduled_at))}</strong><small>${esc(item.status)}</small></div>`).join("")}</div>`:""}`;
  bindMessengerConversation(conversation);
  if(!quiet)renderMessengerList(document.querySelector("[data-messenger-filter].active")?.dataset.messengerFilter||"all");
}

function bindMessengerConversation(conversation){
  $("#messengerReplyForm")?.addEventListener("submit",async event=>{
    event.preventDefault();const message=String(new FormData(event.currentTarget).get("message")||"").trim();if(!message)return;
    const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
    try{await api(`/api/customer-conversations/${conversation.id}/reply`,{method:"POST",body:JSON.stringify({message})});await openMessengerConversation(conversation.id);await refreshMessengerInboxSilently();}
    catch(error){button.disabled=false;toast(humanError(error),"error");}
  });
  $("#messengerTake")?.addEventListener("click",async()=>{try{await api(`/api/customer-conversations/${conversation.id}/assign`,{method:"PUT",body:JSON.stringify({assigned_user_id:state.user.id})});await openMessengerConversation(conversation.id);}catch(error){toast(humanError(error),"error");}});
  $("#messengerAssignee")?.addEventListener("change",async event=>{try{await api(`/api/customer-conversations/${conversation.id}/assign`,{method:"PUT",body:JSON.stringify({assigned_user_id:event.target.value||state.user.id})});await openMessengerConversation(conversation.id,{quiet:true});}catch(error){toast(humanError(error),"error");}});
  $("#messengerClose")?.addEventListener("click",async()=>{const next=conversation.status==="CLOSED"?"OPEN":"CLOSED";try{await api(`/api/customer-conversations/${conversation.id}/status`,{method:"PUT",body:JSON.stringify({status:next})});await openMessengerConversation(conversation.id);await refreshMessengerInboxSilently();}catch(error){toast(humanError(error),"error");}});
  $("#messengerProposeAppointment")?.addEventListener("click",()=>openMessengerAppointmentProposal(conversation));
  $("#messengerCreateIntake")?.addEventListener("click",async()=>{
    if(conversation.linked_intake){navTo("intake");return;}
    try{await api(`/api/customer-conversations/${conversation.id}/create-intake`,{method:"POST",body:JSON.stringify({})});toast(tr("Intake created from Messenger.","Igényfelmérés létrehozva a Messengerből."),"success");navTo("intake");}
    catch(error){toast(humanError(error),"error");}
  });
}

function openMessengerAppointmentProposal(conversation){
  const defaultStart=new Date(Date.now()+24*60*60*1000);defaultStart.setMinutes(Math.ceil(defaultStart.getMinutes()/15)*15,0,0);
  const local=value=>{const d=new Date(value);const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"}).formatToParts(d).reduce((o,p)=>(o[p.type]=p.value,o),{});return `${parts.year}-${parts.month}-${parts.day}T${parts.hour==="24"?"00":parts.hour}:${parts.minute}`;};
  const start=local(defaultStart),end=local(new Date(defaultStart.getTime()+60*60*1000));
  openDialog({title:tr("Propose appointment","Időpont javaslata"),eyebrow:"MESSENGER",body:`<form id="messengerAppointmentForm" class="form-grid"><label class="field"><span>${tr("Type","Típus")}</span><select name="appointment_type"><option value="PRIVATE_VISIT">${tr("Private visit","Privát látogatás")}</option><option value="PIANO_VIEWING">${tr("Piano viewing","Zongora megtekintés")}</option><option value="SERVICE_CONSULTATION">${tr("Service consultation","Szerviz konzultáció")}</option></select></label><label class="field"><span>${tr("Phone","Telefon")}</span><input name="phone"></label><label class="field"><span>${tr("Starts","Kezdés")}</span><input name="starts_at" type="datetime-local" value="${start}" required></label><label class="field"><span>${tr("Ends","Befejezés")}</span><input name="ends_at" type="datetime-local" value="${end}" required></label><label class="field full"><span>${tr("Note","Megjegyzés")}</span><textarea name="note"></textarea></label><div class="form-actions full"><button class="secondary-button" type="button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Send proposal","Javaslat küldése")}</button></div></form>`});
  $("#messengerAppointmentForm").addEventListener("submit",async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));try{await api(`/api/customer-conversations/${conversation.id}/appointment-proposals`,{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Appointment proposal sent.","Időpontjavaslat elküldve."),"success");await openMessengerConversation(conversation.id);}catch(error){toast(humanError(error),"error");}});
}
function openMessengerAppointment(id){
  const row=(state.messengerAppointments||[]).find(item=>item.id===id);if(!row)return;
  $("#messengerThread").innerHTML=`<div class="messenger-appointment-detail"><span class="eyebrow">${tr("PRIVATE APPOINTMENT","PRIVÁT IDŐPONT")}</span><h2>${esc(row.name)}</h2><p class="messenger-appointment-time">${esc(messengerDate(row.scheduled_at))}</p><dl><dt>${tr("Type","Típus")}</dt><dd>${esc(row.appointment_type.replaceAll("_"," "))}</dd><dt>${tr("Assigned","Felelős")}</dt><dd>${esc(row.assigned_user_name||"—")}</dd><dt>${tr("Note","Megjegyzés")}</dt><dd>${esc(row.note||"—")}</dd></dl></div>`;
  $("#messengerContext").innerHTML=`<div class="messenger-context-section"><span class="eyebrow">${tr("CALENDAR","NAPTÁR")}</span><button class="primary-button" type="button" data-nav="workshop">${tr("Open calendar","Naptár megnyitása")}</button></div>`;
  $("#messengerContext [data-nav]")?.addEventListener("click",()=>navTo("workshop"));
}
