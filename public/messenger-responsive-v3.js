"use strict";

/* Messenger Responsive V3
   UI-only orchestration layered over the canonical Messenger domain functions.
   Loaded after messenger.js and before v6.js boot().
*/

const messengerLegacyOpenConversation=openMessengerConversation;
const messengerLegacyOpenRequest=openMessengerRequest;
const messengerLegacyOpenAppointment=openMessengerAppointment;

function messengerCompactMode(){return Boolean(window.matchMedia&&window.matchMedia("(max-width:700px)").matches);}
function messengerContextDrawerMode(){return Boolean(window.matchMedia&&window.matchMedia("(max-width:1180px)").matches);}
function messengerSearchValue(){return String(state.messengerSearch||"").trim().toLowerCase();}
function messengerSearchMatch(){
  const q=messengerSearchValue();if(!q)return true;
  return Array.from(arguments).some(value=>String(value||"").toLowerCase().includes(q));
}
function messengerInitials(name){
  return String(name||"KH").split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase()||"KH";
}
function messengerPeople(){
  const map=new Map();
  for(const row of state.messengerConversations||[]){
    const name=String(row.name||row.email||tr("Website visitor","Weboldali látogató"));
    const email=String(row.email||"").trim();
    const key=(email?"email:"+email.toLowerCase():"name:"+name.toLowerCase());
    if(!map.has(key))map.set(key,{key:key,name:name,email:email,last_activity_at:row.last_activity_at||row.created_at,conversation_id:row.id,count:1});
    else map.get(key).count+=1;
  }
  return Array.from(map.values());
}
function messengerNotifications(){
  return (state.notifications||[]).filter(row=>{
    const entity=String(row.entity_type||row.entityType||"").toUpperCase();
    const category=String(row.category||row.notification_type||"").toUpperCase();
    const action=String(row.action_url||"").toLowerCase();
    return entity.includes("CUSTOMER_CONVERSATION")||entity.includes("PRIVATE_APPOINTMENT")||category.includes("PRIVATE_APPOINTMENT")||category.includes("DIRECT_MESSAGE")||action.includes("messenger");
  });
}
function messengerSectionLabel(section){
  return ({
    inbox:tr("Inbox","Beérkezett"),
    people:tr("People","Emberek"),
    waiting:tr("Waiting","Várakozók"),
    private:tr("Private","Privát"),
    notifications:tr("Notifications","Értesítések"),
    closed:tr("Closed","Lezárt")
  })[section]||tr("Inbox","Beérkezett");
}
function messengerNavIcon(key){
  const icons={
    inbox:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"></path><path d="m4 7 8 6 8-6"></path></svg>',
    people:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3.5 19a5.5 5.5 0 0 1 11 0"></path><circle cx="17" cy="9" r="2.4"></circle><path d="M15.5 14.5a4.5 4.5 0 0 1 5 4.5"></path></svg>',
    waiting:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3 2"></path></svg>',
    private:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v15H5z"></path><path d="M8 3v4M16 3v4M5 9h14"></path><path d="m9 14 2 2 4-4"></path></svg>',
    notifications:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17h10l-1.2-2.1V11a3.8 3.8 0 0 0-7.6 0v3.9L7 17Z"></path><path d="M10 19a2 2 0 0 0 4 0"></path></svg>',
    closed:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="m8.5 12 2.2 2.2 4.8-5"></path></svg>'
  };
  return icons[key]||icons.inbox;
}
function messengerNavCounts(){
  const rows=state.messengerConversations||[];
  return {
    inbox:rows.filter(row=>row.status!=="CLOSED").length,
    people:messengerPeople().length,
    waiting:rows.filter(row=>row.status==="PENDING_STAFF"&&Number(row.waiting_after_hours||0)===1).length,
    private:(state.messengerRequests||[]).filter(row=>["REQUESTED","PROPOSED"].includes(row.status)).length+(state.messengerAppointments||[]).length,
    notifications:messengerNotifications().length,
    closed:rows.filter(row=>row.status==="CLOSED").length
  };
}
messengerStatusCards=function(){
  const active=state.messengerSection||"inbox",counts=messengerNavCounts();
  return ["inbox","people","waiting","private","notifications","closed"].map(key=>{
    const label=messengerSectionLabel(key),count=Number(counts[key]||0);
    return '<button type="button" class="messenger-status-card messenger-nav-button '+(active===key?"active":"")+'" data-messenger-filter="'+key+'" title="'+esc(label)+'" aria-label="'+esc(label)+'" aria-pressed="'+String(active===key)+'">'+
      '<span class="messenger-nav-glyph">'+messengerNavIcon(key)+'</span>'+
      '<b class="messenger-nav-count" '+(count?"":"hidden")+'>'+count+'</b>'+
    '</button>';
  }).join("");
};
function messengerUpdateSectionHeader(section){
  const title=$("#messengerSectionTitle"),count=$("#messengerSectionCount");
  const counts=messengerNavCounts();if(title)title.textContent=messengerSectionLabel(section);if(count)count.textContent=String(counts[section]||0);
}
function messengerShowList(){
  const shell=$("#messengerShell");shell?.classList.remove("show-thread","show-context");
  document.documentElement.classList.remove("messenger-thread-open");
}
function messengerShowThread(){
  const shell=$("#messengerShell");shell?.classList.add("show-thread");shell?.classList.remove("show-context");
  if(messengerCompactMode())document.documentElement.classList.add("messenger-thread-open");
}
function messengerShowContext(){
  const shell=$("#messengerShell");if(!shell)return;
  shell.classList.add("show-context");
  if(messengerCompactMode())document.documentElement.classList.add("messenger-thread-open");
}
function messengerHideContext(){
  const shell=$("#messengerShell");shell?.classList.remove("show-context");
  if(messengerCompactMode())shell?.classList.add("show-thread");
}
function messengerBindPaneControls(){
  $("#messengerMobileBack")?.addEventListener("click",messengerShowList);
  $("#messengerMobileInfo")?.addEventListener("click",messengerShowContext);
  $("#messengerContextBack")?.addEventListener("click",messengerHideContext);
}
function messengerDecorateActivePane(){
  const thread=$("#messengerThread"),context=$("#messengerContext");if(!thread||!context)return;
  let head=thread.querySelector(".messenger-thread-head");
  if(head){
    if(!head.querySelector("#messengerMobileBack"))head.insertAdjacentHTML("afterbegin",'<button id="messengerMobileBack" class="messenger-pane-button messenger-mobile-back" type="button" aria-label="'+esc(tr("Back to conversations","Vissza a beszélgetésekhez"))+'">←</button>');
    if(!head.querySelector("#messengerMobileInfo"))head.insertAdjacentHTML("beforeend",'<button id="messengerMobileInfo" class="messenger-pane-button messenger-mobile-info" type="button" aria-label="'+esc(tr("Conversation details","Beszélgetés részletei"))+'">ⓘ</button>');
  }else if(!thread.querySelector(".messenger-detail-mobile-head")){
    thread.insertAdjacentHTML("afterbegin",'<header class="messenger-detail-mobile-head"><button id="messengerMobileBack" class="messenger-pane-button" type="button" aria-label="'+esc(tr("Back","Vissza"))+'">←</button><strong>'+esc(messengerSectionLabel(state.messengerSection||"private"))+'</strong><button id="messengerMobileInfo" class="messenger-pane-button" type="button" aria-label="'+esc(tr("Details and actions","Részletek és műveletek"))+'">ⓘ</button></header>');
  }
  if(!context.querySelector("#messengerContextBack"))context.insertAdjacentHTML("afterbegin",'<button id="messengerContextBack" class="messenger-context-back" type="button">← '+esc(tr("Conversation","Beszélgetés"))+'</button>');
  messengerBindPaneControls();
  const messages=thread.querySelector(".messenger-messages");if(messages)requestAnimationFrame(()=>{messages.scrollTop=messages.scrollHeight;});
}
function messengerConversationRowsForSection(section){
  const rows=state.messengerConversations||[];
  if(section==="closed")return rows.filter(row=>row.status==="CLOSED");
  if(section==="waiting")return rows.filter(row=>row.status==="PENDING_STAFF"&&Number(row.waiting_after_hours||0)===1);
  return rows.filter(row=>row.status!=="CLOSED");
}
function messengerConversationRow(row){
  const unread=Number(row.unread_count||0)>0&&String(row.last_message_direction||"").toUpperCase()==="CUSTOMER";
  const name=row.name||row.email||tr("Website visitor","Weboldali látogató");
  const preview=(String(row.last_message_direction||"").toUpperCase()==="STAFF"?tr("You: ","Te: "):"")+String(row.last_message||messengerCategoryLabel(row.category)||"");
  const waiting=Number(row.waiting_after_hours||0)===1&&row.status==="PENDING_STAFF";
  return '<button class="messenger-list-item messenger-conversation-row '+(row.id===state.messengerConversationId?"active ":"")+(unread?"is-unread":"")+'" type="button" data-messenger-conversation="'+esc(row.id)+'">'+
    '<span class="messenger-avatar" aria-hidden="true">'+esc(messengerInitials(name))+'</span>'+
    '<span class="messenger-list-copy"><span class="messenger-list-top"><strong>'+esc(name)+'</strong><small>'+esc(messengerDate(row.last_message_at||row.last_activity_at||row.created_at,{timeOnly:true}))+'</small></span>'+
    '<span class="messenger-preview">'+esc(preview)+'</span>'+
    '<span class="messenger-list-meta"><em class="status-pill">'+esc(waiting?tr("After hours","Zárvatartás után"):messengerStatusLabel(row.status))+'</em>'+(unread?'<span class="messenger-reply-waiting" aria-label="'+esc(tr("Waiting for staff reply","Munkatársi válaszra vár"))+'">'+messengerNavIcon("waiting")+'</span>':"")+'</span></span>'+
  '</button>';
}
function messengerRenderPeople(host){
  const rows=messengerPeople().filter(row=>messengerSearchMatch(row.name,row.email));
  host.innerHTML=rows.map(row=>'<button class="messenger-list-item messenger-person-row" type="button" data-messenger-person="'+esc(row.key)+'" data-messenger-person-conversation="'+esc(row.conversation_id)+'">'+
    '<span class="messenger-avatar" aria-hidden="true">'+esc(messengerInitials(row.name))+'</span>'+
    '<span class="messenger-list-copy"><span class="messenger-list-top"><strong>'+esc(row.name)+'</strong><small>'+esc(messengerDate(row.last_activity_at,{timeOnly:true}))+'</small></span>'+
    '<span class="messenger-preview">'+esc(row.email||tr("Email unavailable","Nincs e-mail"))+'</span>'+
    '<span class="messenger-person-history">'+row.count+' '+esc(row.count===1?tr("conversation","beszélgetés"):tr("conversations","beszélgetés"))+'</span></span>'+
  '</button>').join("")||'<div class="empty-state">'+esc(tr("No previous Messenger contacts.","Nincs korábbi Messenger-kapcsolat."))+'</div>';
  $$("[data-messenger-person-conversation]",host).forEach(button=>button.addEventListener("click",()=>openMessengerConversation(button.dataset.messengerPersonConversation)));
}
function messengerRenderPrivate(host){
  const requests=(state.messengerRequests||[]).filter(row=>["REQUESTED","PROPOSED"].includes(row.status)&&messengerSearchMatch(row.name,row.email,row.appointment_type));
  const appointments=(state.messengerAppointments||[]).filter(row=>messengerSearchMatch(row.name,row.email,row.appointment_type));
  const requestHtml=requests.map(row=>'<button class="messenger-list-item messenger-private-row" type="button" data-messenger-request="'+esc(row.id)+'"><span class="messenger-avatar messenger-avatar-private" aria-hidden="true">◷</span><span class="messenger-list-copy"><span class="messenger-list-top"><strong>'+esc(row.name)+'</strong><small>'+esc(messengerDate(row.requested_at,{timeOnly:true}))+'</small></span><span class="messenger-preview">'+esc(row.appointment_type.replaceAll("_"," "))+'</span><span class="messenger-list-meta"><em class="status-pill">'+esc(row.status)+'</em><small>'+Number(row.requested_duration_min||60)+' '+esc(tr("min","perc"))+'</small></span></span></button>').join("");
  const appointmentHtml=appointments.map(row=>'<button class="messenger-list-item messenger-private-row" type="button" data-messenger-appointment="'+esc(row.id)+'"><span class="messenger-avatar messenger-avatar-private" aria-hidden="true">✓</span><span class="messenger-list-copy"><span class="messenger-list-top"><strong>'+esc(row.name)+'</strong><small>'+esc(messengerDate(row.scheduled_at,{timeOnly:true}))+'</small></span><span class="messenger-preview">'+esc(messengerDate(row.scheduled_at))+'</span><span class="messenger-list-meta"><em class="status-pill">'+esc(tr("Scheduled","Naptárban"))+'</em><small>'+Number(row.duration_min||60)+' '+esc(tr("min","perc"))+'</small></span></span></button>').join("");
  host.innerHTML=(requestHtml?'<div class="messenger-list-section-label">'+esc(tr("Requests & proposals","Kérések és javaslatok"))+'</div>'+requestHtml:"")+(appointmentHtml?'<div class="messenger-list-section-label">'+esc(tr("Scheduled","Naptárban"))+'</div>'+appointmentHtml:"")||'<div class="empty-state">'+esc(tr("No private appointment activity.","Nincs privát időpont-aktivitás."))+'</div>';
  $$("[data-messenger-request]",host).forEach(button=>button.addEventListener("click",()=>openMessengerRequest(button.dataset.messengerRequest)));
  $$("[data-messenger-appointment]",host).forEach(button=>button.addEventListener("click",()=>openMessengerAppointment(button.dataset.messengerAppointment)));
}
function messengerRenderNotifications(host){
  const rows=messengerNotifications().filter(row=>messengerSearchMatch(notificationText(row,"title"),notificationText(row,"body")));
  host.innerHTML=rows.map(row=>{
    const title=notificationText(row,"title"),body=notificationText(row,"body"),entity=String(row.entity_type||"");
    return '<button class="messenger-list-item messenger-notification-row '+(row.read_at?"":"is-unread")+'" type="button" data-messenger-notification="'+esc(row.id)+'" data-messenger-notification-entity="'+esc(entity)+'" data-messenger-notification-entity-id="'+esc(row.entity_id||"")+'">'+
      '<span class="messenger-avatar messenger-avatar-notification" aria-hidden="true">'+esc(notificationSeverityIcon(row.severity))+'</span>'+
      '<span class="messenger-list-copy"><span class="messenger-list-top"><strong>'+esc(title)+'</strong><small>'+esc(notificationDate(row.created_at))+'</small></span><span class="messenger-preview">'+esc(body)+'</span></span></button>';
  }).join("")||'<div class="empty-state">'+esc(tr("No Messenger notifications need attention.","Nincs figyelmet igénylő Messenger-értesítés."))+'</div>';
  $$("[data-messenger-notification]",host).forEach(button=>button.addEventListener("click",async()=>{
    const row=rows.find(item=>String(item.id)===String(button.dataset.messengerNotification));if(!row)return;
    try{await api("/api/notifications/"+encodeURIComponent(row.id)+"/read",{method:"POST",body:"{}"});}catch(_error){}
    if(String(row.entity_type||"").toUpperCase()==="CUSTOMER_CONVERSATION"&&row.entity_id){
      state.messengerSection="inbox";await openMessengerConversation(row.entity_id);return;
    }
    if(row.action_url)await notificationNavigate(row);
  }));
}
renderMessengerList=function(section){
  section=section||state.messengerSection||"inbox";state.messengerSection=section;
  const host=$("#messengerList");if(!host)return;messengerUpdateSectionHeader(section);
  if(section==="people"){messengerRenderPeople(host);return;}
  if(section==="private"){messengerRenderPrivate(host);return;}
  if(section==="notifications"){messengerRenderNotifications(host);return;}
  const rows=messengerConversationRowsForSection(section).filter(row=>messengerSearchMatch(row.name,row.email,row.last_message,row.category));
  host.innerHTML=rows.map(messengerConversationRow).join("")||'<div class="empty-state">'+esc(section==="waiting"?tr("No after-hours messages are waiting for staff.","Nincs zárvatartáson kívüli, válaszra váró üzenet."):tr("No conversations in this view.","Ebben a nézetben nincs beszélgetés."))+'</div>';
  $$("[data-messenger-conversation]",host).forEach(button=>button.addEventListener("click",()=>openMessengerConversation(button.dataset.messengerConversation)));
};
function messengerBindNavButtons(){
  $$("[data-messenger-filter]").forEach(button=>button.addEventListener("click",()=>{
    const section=button.dataset.messengerFilter;state.messengerSection=section;state.messengerSearch="";
    const search=$("#messengerListSearch");if(search)search.value="";
    $$("[data-messenger-filter]").forEach(item=>{item.classList.toggle("active",item===button);item.setAttribute("aria-pressed",String(item===button));});
    messengerShowList();renderMessengerList(section);
  }));
}
bindMessengerShell=function(){
  messengerBindNavButtons();
  $("#messengerListSearch")?.addEventListener("input",event=>{state.messengerSearch=event.currentTarget.value;renderMessengerList(state.messengerSection||"inbox");});
};
renderMessenger=async function(options){
  options=options||{};const preserveSelection=options.preserveSelection!==false;
  stopMessengerRefresh();document.documentElement.classList.remove("messenger-thread-open");
  const workspace=$("#workspace");workspace.innerHTML=pageHead(tr("Messenger","Messenger"),tr("Customer conversations and private appointments.","Ügyfélbeszélgetések és privát időpontok."))+loading();
  try{
    const results=await Promise.all([
      api("/api/customer-conversations"),
      api("/api/private-appointments?status=SCHEDULED"),
      api("/api/private-appointment-requests"),
      api("/api/notifications").catch(()=>null)
    ]);
    const inbox=results[0],appointments=results[1],requests=results[2],notificationPayload=results[3];
    state.messengerConversations=inbox.conversations||[];state.messengerAppointments=appointments||[];state.messengerRequests=requests||[];
    if(notificationPayload&&Array.isArray(notificationPayload.notifications))state.notifications=notificationPayload.notifications;
    state.messengerSection=["inbox","people","waiting","private","notifications","closed"].includes(state.messengerSection)?state.messengerSection:"inbox";
    if(!preserveSelection||!state.messengerConversationId||!state.messengerConversations.some(row=>row.id===state.messengerConversationId))state.messengerConversationId=state.messengerConversations.find(row=>row.status!=="CLOSED")?.id||state.messengerConversations[0]?.id||null;
    state.messengerConversationSnapshot="";
    workspace.innerHTML=pageHead(tr("Messenger","Messenger"),tr("Live customer conversations, contacts, after-hours queue and private appointments.","Élő ügyfélbeszélgetések, kapcsolatok, zárvatartási várólista és privát időpontok."),messengerSupportBadge(inbox.support))+
      '<div class="messenger-status-cards messenger-nav" role="toolbar" aria-label="'+esc(tr("Messenger sections","Messenger nézetek"))+'">'+messengerStatusCards()+'</div>'+
      '<section class="messenger-shell" id="messengerShell">'+
        '<aside class="panel messenger-inbox"><div class="messenger-inbox-head"><div><span class="eyebrow">MESSENGER</span><strong id="messengerSectionTitle">'+esc(messengerSectionLabel(state.messengerSection))+'</strong></div><span class="messenger-section-count" id="messengerSectionCount">'+Number(messengerNavCounts()[state.messengerSection]||0)+'</span></div>'+
        '<div class="messenger-list-search"><input id="messengerListSearch" type="search" value="'+esc(state.messengerSearch||"")+'" placeholder="'+esc(tr("Search conversations or people…","Beszélgetés vagy személy keresése…"))+'" aria-label="'+esc(tr("Search Messenger","Keresés a Messengerben"))+'"></div>'+
        '<div id="messengerList" class="messenger-list"></div></aside>'+
        '<main class="panel messenger-thread" id="messengerThread"><div class="empty-state">'+esc(tr("Select a conversation.","Válassz beszélgetést."))+'</div></main>'+
        '<aside class="panel messenger-context" id="messengerContext"><div class="empty-state">'+esc(tr("Customer details and actions appear here.","Itt jelennek meg az ügyféladatok és műveletek."))+'</div></aside>'+
      '</section>';
    bindMessengerShell();renderMessengerList(state.messengerSection);
    if(!messengerCompactMode()&&state.messengerConversationId)await openMessengerConversation(state.messengerConversationId,{quiet:true});
    else messengerShowList();
    state.messengerTimer=setInterval(()=>{if(state.view==="messenger")void refreshMessengerInboxSilently();else stopMessengerRefresh();},2000);
  }catch(error){workspace.innerHTML=pageHead(tr("Messenger","Messenger"),"")+'<section class="panel empty-state">'+esc(humanError(error))+'</section>';}
};
refreshMessengerInboxSilently=async function(){
  try{
    const activeId=state.messengerConversationId,shell=$("#messengerShell");
    const threadVisible=Boolean(activeId)&&(!messengerCompactMode()||shell?.classList.contains("show-thread")||shell?.classList.contains("show-context"));
    const results=await Promise.all([
      api("/api/customer-conversations"),
      api("/api/private-appointments?status=SCHEDULED"),
      api("/api/private-appointment-requests"),
      threadVisible?api("/api/customer-conversations/"+encodeURIComponent(activeId)):Promise.resolve(null),
      api("/api/notifications").catch(()=>null)
    ]);
    const inbox=results[0],appointments=results[1],requests=results[2],conversation=results[3],notificationPayload=results[4];
    state.messengerConversations=inbox.conversations||[];state.messengerAppointments=appointments||[];state.messengerRequests=requests||[];
    if(notificationPayload&&Array.isArray(notificationPayload.notifications))state.notifications=notificationPayload.notifications;
    const active=state.messengerSection||"inbox";renderMessengerList(active);
    const nav=document.querySelector(".messenger-status-cards");if(nav){nav.innerHTML=messengerStatusCards();messengerBindNavButtons();}
    if(conversation&&activeId===state.messengerConversationId){
      const signature=messengerConversationSignature(conversation),form=$("#messengerReplyForm"),draft=String(form?.elements?.message?.value||""),files=form?.elements?.attachments?.files?.length||0,busy=Boolean(draft||files||(form&&form.contains(document.activeElement)));
      if(signature!==state.messengerConversationSnapshot&&!busy)await openMessengerConversation(activeId,{quiet:true,preloaded:conversation});
    }
  }catch(_error){}
};
openMessengerConversation=async function(id,options){
  await messengerLegacyOpenConversation(id,options||{});
  messengerDecorateActivePane();messengerShowThread();
};
openMessengerRequest=function(id){
  messengerLegacyOpenRequest(id);messengerDecorateActivePane();messengerShowThread();
};
openMessengerAppointment=function(id){
  messengerLegacyOpenAppointment(id);messengerDecorateActivePane();messengerShowThread();
};
