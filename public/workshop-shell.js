// Preserved board entry points. All editors use the new controller.
function workflowShellCardNotice(event,workflowId,phaseId){event?.preventDefault?.();event?.stopPropagation?.();return WorkshopV2.open(workflowId,phaseId);}
function workflowShellOpenCards(workflowId){return WorkshopV2.open(workflowId);}
function workflowMatchesBoardFilters(workflow){
 if(workshopWorkflowAssigneeFilter!=='ALL'&&workflow.main_responsible_user_id!==workshopWorkflowAssigneeFilter&&!(workflow.stages||[]).some(s=>s.assigned_user_id===workshopWorkflowAssigneeFilter||(s.tasks||[]).some(t=>(t.assignee_ids||[]).includes(workshopWorkflowAssigneeFilter))))return false;
 if(workshopWorkflowOverdueOnly&&!(workflow.stages||[]).some(s=>s.is_overdue))return false;
 if(workshopWorkflowStatusFilter!=='ALL'&&!(workflow.stages||[]).some(s=>workflowEffectiveStatus(s)===workshopWorkflowStatusFilter))return false;
 return !workshopWorkflowPrevious||String(workflow.final_due_at||'').slice(0,10)<=workshopWorkflowDate;
}
async function workshopToggleArchived(){workshopWorkflowPrevious=!workshopWorkflowPrevious;workshopWorkflowSelectedId='';workflowMobileDeckState=null;workflowPersistPreviousState();await renderWorkshopWorkflow();}
function openWorkflowStageSettings(){return WorkshopV2.settings();}
function workflowPurgeAll(){return WorkshopV2.purge();}
function workflowSuperDelete(id){return WorkshopV2.purge(id);}
