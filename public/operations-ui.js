"use strict";

async function loadOperationalProfiles({refresh=false}={}){
  if(refresh||!state.staffSkills?.length)state.staffSkills=await api("/api/staff-skills");
  if(refresh||!state.workProfiles?.length)state.workProfiles=await api("/api/work-profiles");
  return {skills:state.staffSkills,profiles:state.workProfiles};
}
function operationalSkillLabel(skill){
  return state.language==="hu"?(skill?.name_hu||skill?.name_en||""):(skill?.name_en||skill?.name_hu||"");
}
function operationalManagerScopeLabel(scope){
  return scope==="INSIDE"?tr("Inside Manager","Belső menedzser"):scope==="OUTSIDE"?tr("Outside Manager","Külső menedzser"):"";
}
function operationalProfileFor(userId){return (state.workProfiles||[]).find(row=>String(row.id)===String(userId))||null;}
function operationalTeamProfileMarkup(user){
  const profile=operationalProfileFor(user?.id),chips=[];
  if(user?.role==="MANAGER"&&profile?.manager_scope)chips.push('<span class="work-profile-chip manager">'+esc(operationalManagerScopeLabel(profile.manager_scope))+'</span>');
  for(const skill of profile?.skills||[])chips.push('<span class="work-profile-chip">'+esc(operationalSkillLabel(skill))+'</span>');
  return chips.length?'<div class="work-profile-chips">'+chips.join("")+'</div>':"";
}
function operationalSkillOptions(selected="",allowEmpty=true){
  let html=allowEmpty?'<option value="">'+tr("No specific job role","Nincs külön munkakör")+'</option>':"";
  html+=(state.staffSkills||[]).filter(row=>Number(row.active)!==0).map(skill=>'<option value="'+skill.id+'" '+(String(skill.id)===String(selected||"")?"selected":"")+'>'+esc(operationalSkillLabel(skill))+'</option>').join("");
  return html;
}
async function createOperationalSkillInline(seed="",onSaved=null){
  const mini=openMiniDialog({title:tr("New job role","Új munkakör"),eyebrow:tr("PROFESSIONAL SKILL","SZAKMAI KOMPETENCIA"),body:`<form id="quickSkillForm" class="form-grid">
    <label class="field full"><span>${tr("English name","Angol név")} *</span><input name="name_en" required value="${esc(seed)}"></label>
    <label class="field full"><span>${tr("Hungarian name","Magyar név")}</span><input name="name_hu"></label>
    <label class="field full"><span>${tr("Description","Leírás")}</span><textarea name="description_en"></textarea></label>
    <div class="form-actions full"><button class="secondary-button" type="button" data-mini-close>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Create job role","Munkakör létrehozása")}</button></div>
  </form>`});
  mini.root.querySelector("#quickSkillForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));
    try{const saved=await api("/api/staff-skills",{method:"POST",body:JSON.stringify(body)});await loadOperationalProfiles({refresh:true});mini.close();toast(tr("Job role created.","Munkakör létrehozva."),"success");if(typeof onSaved==="function")onSaved(saved);}
    catch(error){toast(humanError(error),"error");}
  });
}
function milestoneDaysRemaining(dashboard){
  if(!dashboard?.end_date)return null;const end=new Date(dashboard.end_date+"T23:59:59"),diff=Math.ceil((end-Date.now())/86400000);return diff;
}
function milestoneMediaMarkup(url,icon,alt=""){
  if(url)return '<img src="'+esc(url)+'" alt="'+esc(alt)+'" loading="lazy">';
  return '<span class="milestone-fallback-icon" aria-hidden="true">'+esc(icon||"◆")+'</span>';
}
async function renderMilestone(){
  if(window.innerWidth<700){state.view="workshop";history.replaceState({},"","#workshop");return renderWorkshop();}
  const workspace=$("#workspace"),payload=await api("/api/milestone",{memoryCacheMs:0});state.milestone=payload;
  const dashboard=payload.dashboard||{},steps=payload.steps||[],stepPercent=Math.round(Number(payload.step_progress||0)*100),timePercent=Math.round(Number(payload.time_progress||0)*100),days=milestoneDaysRemaining(dashboard),allDone=Boolean(payload.completed_all);
  const title=state.language==="hu"?(dashboard.title_hu||dashboard.title_en):(dashboard.title_en||dashboard.title_hu),quote=state.language==="hu"?(dashboard.quote_hu||dashboard.quote_en):(dashboard.quote_en||dashboard.quote_hu);
  const next=payload.next_step,nextTitle=next?(state.language==="hu"?(next.title_hu||next.title_en):(next.title_en||next.title_hu)):"";
  workspace.innerHTML=`<div class="milestone-view ${allDone?"milestone-complete":""}">
    <section class="milestone-hero">
      <div class="milestone-hero-media">${milestoneMediaMarkup(dashboard.hero_media_url,dashboard.hero_icon,title)}</div>
      <div class="milestone-hero-overlay"></div>
      <div class="milestone-hero-content">
        <span class="eyebrow">${tr("KLAVIERHAUS MILESTONE","KLAVIERHAUS MÉRFÖLDKŐ")}</span>
        <h1>${esc(title||tr("Our next milestone","A következő mérföldkő"))}</h1>
        ${quote?`<blockquote>“${esc(quote)}”</blockquote>`:""}
        <div class="milestone-target-row"><span>${esc(dashboard.target_label||"Klavierhaus")}</span>${dashboard.start_date?'<small>'+esc(dashboard.start_date)+'</small>':""}<b>→</b>${dashboard.end_date?'<small>'+esc(dashboard.end_date)+'</small>':""}</div>
      </div>
      ${allDone?'<div class="milestone-celebration"><span>✦</span><strong>'+tr("GOAL ACHIEVED","A CÉLT ELÉRTÜK")+'</strong><span>✦</span></div>':""}
    </section>
    <section class="milestone-status-grid">
      <article><span>${tr("Milestones completed","Teljesített mérföldkövek")}</span><strong>${Number(payload.completed_count||0)} / ${Number(payload.total_count||0)}</strong><div class="milestone-progress"><i style="width:${stepPercent}%"></i></div><small>${stepPercent}%</small></article>
      <article><span>${tr("Time elapsed","Eltelt idő")}</span><strong>${timePercent}%</strong><div class="milestone-progress time"><i style="width:${timePercent}%"></i></div><small>${days===null?tr("No deadline set","Nincs határidő"):days>=0?tr(`${days} days remaining`,`${days} nap van hátra`):tr(`${Math.abs(days)} days past target`,`${Math.abs(days)} nappal a célidő után`)}</small></article>
      <article class="milestone-next"><span>${tr("Next focus","Következő fókusz")}</span><strong>${esc(nextTitle||tr("Everything completed","Minden teljesítve"))}</strong><small>${next?.target_date?esc(next.target_date):tr("Keep moving forward.","Haladjunk tovább.")}</small></article>
    </section>
    <section class="milestone-roadmap">
      <div class="milestone-road-line" aria-hidden="true"><i style="width:${stepPercent}%"></i></div>
      ${steps.length?steps.map((step,index)=>{
        const stepTitle=state.language==="hu"?(step.title_hu||step.title_en):(step.title_en||step.title_hu),desc=state.language==="hu"?(step.description_hu||step.description_en):(step.description_en||step.description_hu);
        return `<article class="milestone-step ${step.completed?"done":""} ${!step.completed&&next?.id===step.id?"current":""}" style="--step-index:${index}">
          <div class="milestone-step-marker">${step.completed?"✓":index+1}</div>
          <div class="milestone-step-card"><div class="milestone-step-media">${milestoneMediaMarkup(step.media_url,step.icon,stepTitle)}</div><div><span class="eyebrow">${step.completed?tr("COMPLETED","TELJESÍTVE"):next?.id===step.id?tr("NEXT","KÖVETKEZŐ"):tr("UPCOMING","KÖVETKEZIK")}</span><h3>${esc(stepTitle)}</h3>${desc?`<p>${esc(desc)}</p>`:""}${step.target_date?`<small>${esc(step.target_date)}</small>`:""}</div></div>
        </article>`;
      }).join(""):`<div class="milestone-empty">${tr("An administrator can build the company roadmap from Profile.","Az adminisztrátor a Profil oldalon állíthatja össze a vállalati mérföldköveket.")}</div>`}
    </section>
  </div>`;
}
function operationsMilestoneProfileCard(){
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role))return "";
  return `<section class="panel milestone-admin-card" id="milestoneAdminCard"><div class="panel-head"><div><span class="eyebrow">${tr("MILESTONE HOME","MÉRFÖLDKŐ KEZDŐOLDAL")}</span><h2>${tr("Company goal experience","Vállalati célélmény")}</h2><p>${tr("Edit the visual roadmap seen by everyone on tablet and desktop.","Szerkeszd a tablet- és asztali nézetben mindenki által látható vizuális céloldalt.")}</p></div><button class="secondary-button" id="editMilestoneBtn" type="button">${tr("Edit milestone","Mérföldkő szerkesztése")}</button></div><div id="milestoneAdminPreview" class="milestone-admin-preview"></div></section>`;
}
async function bindOperationsMilestoneProfile(){
  const button=$("#editMilestoneBtn"),preview=$("#milestoneAdminPreview");if(!button&&!preview)return;
  const payload=await api("/api/milestone",{memoryCacheMs:0});state.milestone=payload;
  if(preview){const d=payload.dashboard||{};preview.innerHTML='<strong>'+esc(state.language==="hu"?(d.title_hu||d.title_en):(d.title_en||d.title_hu))+'</strong><span>'+Number(payload.completed_count||0)+' / '+Number(payload.total_count||0)+' '+tr("completed","teljesítve")+'</span>';}
  button?.addEventListener("click",()=>openMilestoneEditor(payload));
}
function milestoneStepEditorMarkup(step={},index=0){
  return `<article class="milestone-step-editor" data-milestone-step>
    <header><strong>${tr("Milestone","Mérföldkő")} ${index+1}</strong><button type="button" class="text-button danger-text" data-remove-milestone-step>× ${tr("Remove","Törlés")}</button></header>
    <div class="form-grid"><label class="field"><span>Title EN *</span><input name="step_title_en" required value="${esc(step.title_en||"")}"></label><label class="field"><span>Cím HU</span><input name="step_title_hu" value="${esc(step.title_hu||"")}"></label>
    <label class="field full"><span>Description EN</span><textarea name="step_description_en">${esc(step.description_en||"")}</textarea></label><label class="field full"><span>Leírás HU</span><textarea name="step_description_hu">${esc(step.description_hu||"")}</textarea></label>
    <label class="field"><span>${tr("Target date","Céldátum")}</span><input name="step_target_date" type="date" value="${esc(step.target_date||"")}"></label><label class="field"><span>${tr("Icon / emoji","Ikon / emoji")}</span><input name="step_icon" value="${esc(step.icon||"")}"></label>
    <label class="field"><span>${tr("Image / GIF","Kép / GIF")}</span><input name="step_media_file" type="file" accept="image/*,.gif"><input name="step_media_url" type="hidden" value="${esc(step.media_url||"")}"></label>
    <label class="cms-toggle-row"><span><strong>${tr("Completed","Teljesítve")}</strong></span><input name="step_completed" type="checkbox" ${step.completed?"checked":""}></label></div>
  </article>`;
}
async function uploadMilestoneFile(file){if(!file)return "";const form=new FormData();form.append("file",file);return (await api("/api/milestone/media",{method:"POST",body:form})).url||"";}
function openMilestoneEditor(payload){
  const d=payload?.dashboard||{},steps=payload?.steps||[];
  openDialog({title:tr("Edit milestone experience","Mérföldkő-élmény szerkesztése"),eyebrow:tr("ADMIN · COMPANY GOAL","ADMIN · VÁLLALATI CÉL"),variant:"wide",body:`<form id="milestoneEditor" class="form-grid">
    <label class="field"><span>Title EN *</span><input name="title_en" required value="${esc(d.title_en||"")}"></label><label class="field"><span>Cím HU</span><input name="title_hu" value="${esc(d.title_hu||"")}"></label>
    <label class="field full"><span>Quote EN</span><textarea name="quote_en">${esc(d.quote_en||"")}</textarea></label><label class="field full"><span>Idézet HU</span><textarea name="quote_hu">${esc(d.quote_hu||"")}</textarea></label>
    <label class="field"><span>${tr("Start date","Kezdődátum")}</span><input name="start_date" type="date" value="${esc(d.start_date||"")}"></label><label class="field"><span>${tr("End target","Végcél dátuma")}</span><input name="end_date" type="date" value="${esc(d.end_date||"")}"></label>
    <label class="field"><span>${tr("Goal label","Cél megnevezése")}</span><input name="target_label" value="${esc(d.target_label||"")}"></label><label class="field"><span>${tr("Hero icon / emoji","Hero ikon / emoji")}</span><input name="hero_icon" value="${esc(d.hero_icon||"")}"></label>
    <label class="field full"><span>${tr("Hero image / GIF","Hero kép / GIF")}</span><input name="hero_file" type="file" accept="image/*,.gif"><input name="hero_media_url" type="hidden" value="${esc(d.hero_media_url||"")}"></label>
    <section class="full milestone-step-editor-list" id="milestoneStepEditors">${steps.map(milestoneStepEditorMarkup).join("")}</section>
    <button class="secondary-button full" type="button" id="addMilestoneStep">＋ ${tr("Add milestone","Mérföldkő hozzáadása")}</button>
    <div class="form-actions full"><button class="secondary-button" type="button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Publish milestone","Mérföldkő publikálása")}</button></div>
  </form>`});
  const form=$("#milestoneEditor"),host=$("#milestoneStepEditors");
  const bindRemove=()=>$$("[data-remove-milestone-step]",host).forEach(button=>{if(button.dataset.bound)return;button.dataset.bound="1";button.addEventListener("click",()=>button.closest("[data-milestone-step]")?.remove());});bindRemove();
  $("#addMilestoneStep")?.addEventListener("click",()=>{const wrap=document.createElement("div");wrap.innerHTML=milestoneStepEditorMarkup({},$$("[data-milestone-step]",host).length);host.append(wrap.firstElementChild);bindRemove();});
  form.addEventListener("submit",async event=>{
    event.preventDefault();const submit=event.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;
    try{
      let heroUrl=event.currentTarget.elements.hero_media_url.value||"";const heroFile=event.currentTarget.elements.hero_file.files?.[0];if(heroFile)heroUrl=await uploadMilestoneFile(heroFile);
      const rows=$$("[data-milestone-step]",host),stepPayload=[];
      for(let index=0;index<rows.length;index++){
        const row=rows[index],get=name=>row.querySelector('[name="'+name+'"]'),file=get("step_media_file")?.files?.[0];let media=get("step_media_url")?.value||"";if(file)media=await uploadMilestoneFile(file);
        stepPayload.push({title_en:get("step_title_en")?.value||"",title_hu:get("step_title_hu")?.value||"",description_en:get("step_description_en")?.value||"",description_hu:get("step_description_hu")?.value||"",target_date:get("step_target_date")?.value||null,icon:get("step_icon")?.value||"",media_url:media,completed:Boolean(get("step_completed")?.checked),sort_order:index});
      }
      const body={dashboard:{title_en:event.currentTarget.elements.title_en.value,title_hu:event.currentTarget.elements.title_hu.value,quote_en:event.currentTarget.elements.quote_en.value,quote_hu:event.currentTarget.elements.quote_hu.value,start_date:event.currentTarget.elements.start_date.value||null,end_date:event.currentTarget.elements.end_date.value||null,target_label:event.currentTarget.elements.target_label.value,hero_icon:event.currentTarget.elements.hero_icon.value,hero_media_url:heroUrl},steps:stepPayload};
      await api("/api/milestone",{method:"PUT",body:JSON.stringify(body)});closeDialog();toast(tr("Milestone published.","Mérföldkő publikálva."),"success");await bindOperationsMilestoneProfile();
    }catch(error){submit.disabled=false;toast(humanError(error),"error");}
  });
}
function operationsSkillsSettingsCard(users=[]){
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role))return "";
  return `<section class="panel staff-skill-center"><div class="panel-head"><div><span class="eyebrow">${tr("WORK PROFILES","MUNKAKÖRÖK")}</span><h2>${tr("Professional roles & competencies","Szakmai munkakörök és kompetenciák")}</h2><p>${tr("System permissions stay separate from the work each person can perform.","A rendszerjogosultság külön marad attól, hogy ki milyen munkát végezhet.")}</p></div><button id="newStaffSkillBtn" class="secondary-button" type="button">＋ ${tr("Job role","Munkakör")}</button></div>
    <div class="staff-skill-grid">${(state.staffSkills||[]).map(skill=>`<button type="button" class="staff-skill-card" data-edit-staff-skill="${skill.id}"><strong>${esc(operationalSkillLabel(skill))}</strong><small>${esc(skill.code)} · ${Number(skill.user_count||0)} ${tr("people","fő")}</small></button>`).join("")}</div>
    <div class="staff-profile-overview">${users.map(user=>`<div><strong>${esc(user.name)}</strong>${operationalTeamProfileMarkup(user)||'<small>'+tr("No professional roles assigned","Nincs szakmai munkakör hozzárendelve")+'</small>'}</div>`).join("")}</div>
  </section>`;
}
async function bindOperationsSkillsSettings(){
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role))return;
  $("#newStaffSkillBtn")?.addEventListener("click",()=>createOperationalSkillInline("",()=>renderSettings()));
  $$("[data-edit-staff-skill]").forEach(button=>button.addEventListener("click",()=>openStaffSkillEditor((state.staffSkills||[]).find(skill=>String(skill.id)===button.dataset.editStaffSkill))));
}
function openStaffSkillEditor(skill){
  if(!skill)return;
  openDialog({title:tr("Edit job role","Munkakör szerkesztése"),eyebrow:tr("PROFESSIONAL SKILL","SZAKMAI KOMPETENCIA"),body:`<form id="staffSkillEditor" class="form-grid"><label class="field"><span>Name EN *</span><input name="name_en" required value="${esc(skill.name_en||"")}"></label><label class="field"><span>Név HU</span><input name="name_hu" value="${esc(skill.name_hu||"")}"></label><label class="field full"><span>Description EN</span><textarea name="description_en">${esc(skill.description_en||"")}</textarea></label><label class="field full"><span>Leírás HU</span><textarea name="description_hu">${esc(skill.description_hu||"")}</textarea></label><label class="cms-toggle-row full"><span>${tr("Active","Aktív")}</span><input name="active" type="checkbox" ${skill.active?"checked":""}></label><div class="form-actions full"><button class="secondary-button" type="button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save","Mentés")}</button></div></form>`});
  $("#staffSkillEditor").addEventListener("submit",async event=>{event.preventDefault();const fd=new FormData(event.currentTarget),body=Object.fromEntries(fd);body.active=event.currentTarget.elements.active.checked;try{await api("/api/staff-skills/"+skill.id,{method:"PUT",body:JSON.stringify(body)});await loadOperationalProfiles({refresh:true});closeDialog();await renderSettings();}catch(error){toast(humanError(error),"error");}});
}
function operationsExportRecoveryCard(){
  return `<section class="panel recovery-scope-card database-export-card"><span class="eyebrow">${tr("COMPLETE DATA EXPORT","TELJES ADATEXPORT")}</span><h3>${tr("Download full database workbook","Teljes adatbázis letöltése")}</h3><p>${tr("Exports every operational database table into a structured XLSX workbook with one sheet per table, preserved IDs and relationships, plus a schema manifest.","Minden operatív adatbázistáblát strukturált XLSX munkafüzetbe exportál, táblánként külön lappal, megőrzött ID-kapcsolatokkal és séma-manifesttel.")}</p><button class="primary-button" id="downloadFullDatabaseExport" type="button">↓ XLSX ${tr("Full database","Teljes adatbázis")}</button></section>`;
}
function bindOperationsExportRecovery(){
  $("#downloadFullDatabaseExport")?.addEventListener("click",async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      const response=await fetch("/api/system-export.xlsx",{headers:{Authorization:"Bearer "+state.token}});
      if(!response.ok){let payload={};try{payload=await response.json();}catch(_error){}throw new Error(payload.error||"DATABASE_EXPORT_FAILED");}
      const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a"),header=response.headers.get("content-disposition")||"",match=header.match(/filename="([^"]+)"/);link.href=url;link.download=match?.[1]||"klavierhaus-full-database.xlsx";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(tr("Full database export downloaded.","A teljes adatbázis-export letöltve."),"success");
    }catch(error){toast(humanError(error),"error");}finally{button.disabled=false;}
  });
}
