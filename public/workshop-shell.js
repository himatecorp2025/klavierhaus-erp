// Phase I shell controller. No creation/details modal and no operational workflow API.
function workflowShellCardNotice(event){event?.preventDefault?.();event?.stopPropagation?.();showToast(bi('Workflow details will be rebuilt in Phase II.','A workflow részletező a II. fázisban készül el.'),'info');}
function workflowShellOpenCards(workflowId){
 const workflow=workshopWorkflowRows.find(w=>String(w.id)===String(workflowId));
 if(isMobileAppViewport()&&workflow){workflowMobileDeckState={workflowId:String(workflowId),index:0};void renderWorkshopWorkflow();return;}
 workflowShellCardNotice();
}
function workflowMatchesBoardFilters(workflow){
 if(workshopWorkflowAssigneeFilter!=='ALL'&&!(workflow.stages||[]).some(s=>s.assigned_user_id===workshopWorkflowAssigneeFilter))return false;
 if(workshopWorkflowOverdueOnly&&!(workflow.stages||[]).some(s=>s.is_overdue))return false;
 if(workshopWorkflowStatusFilter!=='ALL'&&!(workflow.stages||[]).some(s=>workflowEffectiveStatus(s)===workshopWorkflowStatusFilter))return false;
 return !workshopWorkflowPrevious||String(workflow.final_due_at||'').slice(0,10)<=workshopWorkflowDate;
}
async function workshopToggleArchived(){workshopWorkflowPrevious=!workshopWorkflowPrevious;workshopWorkflowSelectedId='';workflowMobileDeckState=null;workflowPersistPreviousState();await renderWorkshopWorkflow();}
async function openWorkflowStageSettings(){
 if(!isAdmin())return;
 try{
  const payload=await api('/api/workshop-shell/phases');
  const form=document.getElementById('form');
  document.getElementById('modalTitle').textContent=bi('Workflow phase settings','Workflow fázisbeállítások');
  form.innerHTML=`<section id="workflowPhaseSettings">${payload.stages.map(stage=>`<div class="workflow-config-row" data-code="${htmlText(stage.code)}"><label>${bi('English name','Angol név')}<input name="phase_name_en" value="${htmlText(stage.name_en)}" required maxlength="200"></label><label>${bi('Hungarian name','Magyar név')}<input name="phase_name_hu" value="${htmlText(stage.name_hu)}" required maxlength="200"></label><label>${bi('Order','Sorrend')}<input name="phase_order" type="number" min="1" max="7" step="1" value="${Number(stage.sort_order)+1}" required></label></div>`).join('')}<div class="actions"><button type="button" data-phase-save>${bi('Save settings','Beállítások mentése')}</button><button type="button" class="ghost-btn" onclick="closeModal()">${bi('Cancel','Mégse')}</button></div><p role="alert" data-phase-error></p></section>`;
  document.getElementById('modal').classList.remove('hidden');
  const save=async event=>{
   event.preventDefault();if(!form.reportValidity())return;
   const button=form.querySelector('[data-phase-save]');button.disabled=true;
   const stages=[...form.querySelectorAll('[data-code]')].map(row=>({code:row.dataset.code,name_en:row.querySelector('[name="phase_name_en"]').value.trim(),name_hu:row.querySelector('[name="phase_name_hu"]').value.trim(),sort_order:Number(row.querySelector('[name="phase_order"]').value)-1}));
   try{await api('/api/workshop-shell/phases',{method:'PUT',body:JSON.stringify({stages})});form.onsubmit=null;closeModal();await renderWorkshopWorkflow();showToast(bi('Phase settings saved.','Fázisbeállítások mentve.'),'success');}catch(error){form.querySelector('[data-phase-error]').textContent=error.message||String(error);button.disabled=false;}
  };
  form.onsubmit=save;form.querySelector('[data-phase-save]').onclick=save;
 }catch(error){showError(error);}
}
async function workflowPurgeAll(){
 if(!isSuperadmin())return showError('PERMISSION_DENIED');
 try{
  const counts=await api('/api/workshop-shell/purge-preview');
  const approved=await appConfirm(`${bi('Permanently delete workshop history and its proven financial records?','Véglegesen törlöd a műhelyelőzményeket és az igazoltan hozzájuk tartozó pénzügyi adatokat?')}\n${bi('Invoices','Számlák')}: ${counts.invoices}; ${bi('Ledger entries','Könyvelési tételek')}: ${counts.journal_entries}; ${bi('Financial items','Pénzügyi sorok')}: ${counts.financial_items}`,{type:'error'});
  if(!approved)return;
  const confirmation=await appPrompt('DELETE ALL WORKFLOWS',{type:'error'});
  if(confirmation!=='DELETE ALL WORKFLOWS')return;
  await api('/api/workshop-shell/purge',{method:'POST',body:JSON.stringify({confirmation})});await renderWorkshopWorkflow();
  showToast(bi('Workflow data deleted. Other modules were preserved.','Workflow-adatok törölve. A többi modul megmaradt.'),'success');
 }catch(error){showError(error);}
}
async function workflowSuperDelete(id){
 if(!isSuperadmin())return showError('PERMISSION_DENIED');
 try{
  const counts=await api(`/api/workshop-shell/purge-preview?id=${encodeURIComponent(id)}`);
  if(!await appConfirm(`${bi('Delete workflow and its financial records?','Törlöd a workflow-t és pénzügyi adatait?')} ${counts.invoices} ${bi('invoice(s)','számla')}`,{type:'error'}))return;
  const phrase=`DELETE WORKFLOW ${id}`,confirmation=await appPrompt(phrase,{type:'error'});if(confirmation!==phrase)return;
  await api('/api/workshop-shell/purge',{method:'POST',body:JSON.stringify({workflow_id:id,confirmation})});
  if(currentView==='closed_jobs')await render('closed_jobs');else await renderWorkshopWorkflow();
 }catch(error){showError(error);}
}
