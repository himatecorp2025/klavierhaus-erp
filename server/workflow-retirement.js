"use strict";

// Phase I only: financial/history custody, not a new operational workflow engine.
const ARCHIVE_TABLES = Object.freeze({
  workshop_workflows: "workflow_finance_sources",
  workflow_stages: "workflow_finance_phases",
  workflow_financial_lines: "workflow_finance_lines",
  workflow_closed_jobs: "workflow_finance_closures",
  workflow_stage_definitions: "workshop_phase_definitions"
});
const RETIRED_TABLES = ["workshop_subtasks", "workflow_stage_transfers", "workflow_materials", "workflow_documents", "workflow_audit_events"];
const exists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const rows = (db, name) => exists(db, name) ? db.prepare(`SELECT * FROM ${name}`).all() : [];
const failure = (code, details) => Object.assign(new Error(code), { code, status:409, details });

function retireLegacyWorkflow(db) {
  if (!exists(db, "workshop_workflows") && !Object.keys(ARCHIVE_TABLES).some(name => exists(db, name))) return { migrated:false };
  if (exists(db, "wf2_workflows") && exists(db, "workshop_subtasks")) throw failure("WORKFLOW_MIGRATION_MIXED_GENERATIONS");
  return db.transaction(() => {
    for (const [oldName, newName] of Object.entries(ARCHIVE_TABLES)) {
      if (exists(db, oldName) && exists(db, newName)) throw failure("WORKFLOW_MIGRATION_AMBIGUOUS_TABLES", {oldName,newName});
    }
    const sources=rows(db,"workshop_workflows"), stages=rows(db,"workflow_stages");
    const sourceIds=new Set(sources.map(row=>row.id));
    const jobs=rows(db,"jobs"), retiredJobs=[];
    for (const job of jobs) {
      const phase=stages.find(stage=>stage.calendar_job_id===job.id);
      const source=sources.find(w=>w.job_id===job.id);
      const generatedPhase=phase && job.job_type==='Workshop phase' && String(job.job_key||'').startsWith('WFSTAGE-');
      const generatedRoot=source && job.job_type==='Workflow' && job.job_key===`WFJOB-${source.workflow_key}`;
      if (generatedPhase || generatedRoot) retiredJobs.push({job,workflowId:generatedPhase?phase.workflow_id:source.id});
    }
    // Renaming automatically retargets SQLite FKs in the shared jobs/inspection tables.
    // Core source rows remain available to invoices and historical lookups, never to active operations.
    for (const [oldName,newName] of Object.entries(ARCHIVE_TABLES)) {
      if (exists(db,oldName)) {
        const before=db.prepare(`SELECT COUNT(*) n FROM ${oldName}`).get().n;
        db.exec(`ALTER TABLE ${oldName} RENAME TO ${newName}`);
        if(db.prepare(`SELECT COUNT(*) n FROM ${newName}`).get().n!==before)throw failure('WORKFLOW_ARCHIVE_COUNT_MISMATCH');
      }
    }
    db.exec(`CREATE TABLE IF NOT EXISTS workflow_retired_calendar_jobs (
      job_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      retired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const insert=db.prepare("INSERT OR IGNORE INTO workflow_retired_calendar_jobs(job_id,workflow_id,snapshot_json) VALUES(?,?,?)");
    for(const {job,workflowId} of retiredJobs) {
      insert.run(job.id,workflowId,JSON.stringify(job));
      // Do not reopen financially closed jobs or allow retired appointments to block availability.
      if(!['Completed','Failed','Cancelled'].includes(job.status))db.prepare("UPDATE jobs SET status='Cancelled' WHERE id=?").run(job.id);
    }
    // Shared client/piano/job rows stay intact. Only old workshop links are detached.
    if(exists(db,'jobs')) {
      const columns=new Set(db.pragma('table_info(jobs)').map(c=>c.name));
      for(const field of ['workflow_id','workshop_workflow_id'].filter(name=>columns.has(name)))
        for(const id of sourceIds)db.prepare(`UPDATE jobs SET ${field}=NULL WHERE ${field}=?`).run(id);
    }
    if(exists(db,'notification_snooze_log'))db.prepare("DELETE FROM notification_snooze_log WHERE entity_type='WORKFLOW_STAGE'").run();
    if(exists(db,'notifications')) {
      for(const note of db.prepare("SELECT id,metadata_json FROM notifications WHERE json_valid(metadata_json)").all()) {
        const meta=JSON.parse(note.metadata_json);
        if(sourceIds.has(meta?.workflow_id) || stages.some(s=>s.id===meta?.stage_id))db.prepare('DELETE FROM notifications WHERE id=?').run(note.id);
      }
    }
    // Inventory is shared: release this workflow's reservation, not other reservations or stock.
    for(const material of rows(db,'workflow_materials')) {
      if(material.status==='RESERVED'&&material.inventory_item_id) {
        const item=db.prepare('SELECT reserved_quantity FROM inventory_items WHERE id=?').get(material.inventory_item_id);
        const release=Math.max(0,Number(material.requested_quantity||0)-Number(material.consumed_quantity||0));
        if(item && release>Number(item.reserved_quantity||0))throw failure('WORKFLOW_INVENTORY_RESERVATION_MISMATCH',{id:material.id});
        if(item)db.prepare('UPDATE inventory_items SET reserved_quantity=reserved_quantity-? WHERE id=?').run(release,material.inventory_item_id);
      }
    }
    for(const name of RETIRED_TABLES)if(exists(db,name))db.exec(`DROP TABLE ${name}`);
    if(exists(db,'workflow_finance_phases')) {
      const columns=db.prepare('PRAGMA table_info(workflow_finance_phases)').all();
      if(!columns.some(c=>c.name==='calendar_job_id'))db.exec('ALTER TABLE workflow_finance_phases ADD COLUMN calendar_job_id TEXT');
    }
    const errors=db.pragma('foreign_key_check');
    if(errors.length)throw failure('WORKFLOW_RETIREMENT_FOREIGN_KEYS',errors);
    return {migrated:true,archived_workflows:sources.length,archived_phases:stages.length,retired_calendar_jobs:retiredJobs.length};
  })();
}

function installWorkflowDeletionGuards(db) {
 return db.transaction(() => {
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_financial_delete_scope (
    entity_table TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY(entity_table,entity_id))`);
  const guarded=[
    ['invoices','trg_invoices_immutable_delete','IMMUTABLE_INVOICE_RECORD','id'],
    ['invoice_adjustments','trg_invoice_adjustments_immutable_delete','IMMUTABLE_INVOICE_ADJUSTMENT','id'],
    ['invoice_credit_memos','trg_invoice_credit_memos_immutable_delete','IMMUTABLE_CREDIT_MEMO','id'],
    ['financial_item_adjustments','trg_financial_item_adjustments_immutable_delete','IMMUTABLE_FINANCIAL_ITEM_ADJUSTMENT','id'],
    ['financial_item_voids','trg_financial_item_voids_immutable_delete','IMMUTABLE_FINANCIAL_ITEM_VOID','financial_item_id']
  ];
  for(const [table,trigger,error,key] of guarded)if(exists(db,table))db.exec(`
    DROP TRIGGER IF EXISTS ${trigger};
    CREATE TRIGGER ${trigger} BEFORE DELETE ON ${table}
    WHEN NOT EXISTS(SELECT 1 FROM workflow_financial_delete_scope WHERE entity_table='${table}' AND entity_id=OLD.${key})
    BEGIN SELECT RAISE(ABORT,'${error}'); END;`);
  if(exists(db,'financial_items'))db.exec(`
    DROP TRIGGER IF EXISTS trg_financial_items_direct_immutable_delete;
    CREATE TRIGGER trg_financial_items_direct_immutable_delete BEFORE DELETE ON financial_items
    WHEN COALESCE(OLD.source_type,'') NOT IN ('JOB_REVENUE','DAILY_RATE','TECHNICIAN_EXTRA_COMPENSATION','MANUAL_INVOICE','WORKFLOW_INVOICE_REVENUE','WORKFLOW_INVOICE_MATERIAL','event_payment_refund','event_manual_ticket_refund','event_manual_ticket','event_payment','closed_job','job_close_revenue')
    AND NOT EXISTS(SELECT 1 FROM workflow_financial_delete_scope WHERE entity_table='financial_items' AND entity_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_ITEM'); END;`);
 })();
}

function workflowPurgePlan(db, workflowId=null) {
  const all=workflowId===null, sources=rows(db,'workflow_finance_sources').filter(w=>all||w.id===workflowId);
  const ids=new Set(sources.map(w=>w.id));if(workflowId)ids.add(workflowId);
  const phases=rows(db,'workflow_finance_phases').filter(s=>ids.has(s.workflow_id));
  const lines=rows(db,'workflow_finance_lines').filter(l=>ids.has(l.workflow_id));
  const lineIds=new Set(lines.map(l=>l.id));
  const calendar=rows(db,'workflow_retired_calendar_jobs').filter(j=>all||ids.has(j.workflow_id));
  const jobIds=new Set(calendar.map(j=>j.job_id));
  const invoices=rows(db,'invoices').filter(i=>
    (i.source_type==='workflow' && String(i.source_id||'').trim() && (all||ids.has(i.source_id)||[...lineIds].some(id=>i.source_id===`WORKFLOW_LINE:${id}`))) ||
    (i.source_type==='job'&&jobIds.has(i.source_id)));
  const invoiceIds=new Set(invoices.map(i=>i.id));
  for(const line of lines)if(line.payable_invoice_id&&!invoiceIds.has(line.payable_invoice_id))throw failure('WORKFLOW_SHARED_INVOICE',{id:line.payable_invoice_id});
  // Do not erase a workflow invoice referenced by another source/workflow.
  if(rows(db,'jobs').some(j=>invoiceIds.has(j.invoice_id)&&!jobIds.has(j.id)))throw failure('WORKFLOW_SHARED_INVOICE_JOB');
  if(rows(db,'workflow_finance_lines').some(l=>!ids.has(l.workflow_id)&&invoiceIds.has(l.payable_invoice_id)))throw failure('WORKFLOW_SHARED_INVOICE_LINE');
  const mirrors=new Set(lines.map(l=>l.posted_financial_item_id).filter(Boolean));
  const financial=rows(db,'financial_items').filter(f=>mirrors.has(f.id)||
    (['WORKFLOW_INVOICE_REVENUE','WORKFLOW_INVOICE_MATERIAL'].includes(f.source_type) && (all||[...ids].some(id=>f.source_id===`${f.source_type}:${id}`))) ||
    (jobIds.has(f.job_id)&&['JOB_REVENUE','DAILY_RATE','TECHNICIAN_EXTRA_COMPENSATION','closed_job','job_close_revenue'].includes(f.source_type)));
  const financialIds=new Set(financial.map(f=>f.id));
  if(rows(db,'workflow_finance_lines').some(l=>!ids.has(l.workflow_id)&&financialIds.has(l.posted_financial_item_id)))throw failure('WORKFLOW_SHARED_FINANCIAL_ITEM');
  if(rows(db,'jobs').some(j=>!jobIds.has(j.id)&&financialIds.has(j.financial_ledger_id)))throw failure('WORKFLOW_SHARED_FINANCIAL_JOB');
  // Adjustments/reversals may be shared or affect a closed period: preserve, don't guess.
  const adjustments=rows(db,'financial_item_adjustments').filter(a=>[a.financial_item_id,a.reversal_item_id,a.replacement_item_id].some(id=>financialIds.has(id)));
  const voids=rows(db,'financial_item_voids').filter(v=>financialIds.has(v.financial_item_id)||financialIds.has(v.reversal_item_id));
  if(adjustments.length||voids.length)throw failure('WORKFLOW_FINANCIAL_ADJUSTMENT_REVIEW_REQUIRED');
  const journalIds=new Set(lines.flatMap(l=>[l.wip_journal_entry_id,l.final_journal_entry_id,l.writeoff_journal_entry_id]).filter(Boolean));
  if(rows(db,'workflow_finance_lines').some(l=>!ids.has(l.workflow_id)&&[l.wip_journal_entry_id,l.final_journal_entry_id,l.writeoff_journal_entry_id].some(id=>journalIds.has(id))))throw failure('WORKFLOW_SHARED_JOURNAL');
  const journals=rows(db,'journal_entries').filter(j=>journalIds.has(j.id));
  if(journals.some(j=>j.job_id&&!jobIds.has(j.job_id)))throw failure('WORKFLOW_SHARED_JOURNAL_JOB');
  const creditMemos=rows(db,'invoice_credit_memos').filter(c=>invoiceIds.has(c.invoice_id));
  if(invoices.some(i=>i.deferred_event_id))throw failure('WORKFLOW_SHARED_EVENT_INVOICE');
  if(creditMemos.some(c=>c.event_id))throw failure('WORKFLOW_SHARED_EVENT_CREDIT');
  const closedPeriods=new Set(rows(db,'financial_statement_snapshots').map(s=>s.period));
  const latestClosedPeriod=[...closedPeriods].filter(Boolean).sort().at(-1);
  const dates=[...invoices.flatMap(i=>[i.issue_date,i.paid_at,i.revenue_recognition_date]),...financial.map(f=>f.item_date),...journals.map(j=>j.entry_date),...creditMemos.flatMap(c=>[c.memo_date,c.revenue_effect_date])];
  if(latestClosedPeriod&&dates.some(date=>date&&String(date).slice(0,7)<=latestClosedPeriod))throw failure('WORKFLOW_CLOSED_PERIOD_REVIEW_REQUIRED');
  return {sources,phases,lines,calendar,invoices,financial,journals,creditMemos,ids,jobIds,invoiceIds};
}

function purgeWorkflowHistory({db,actor,workflowId=null,confirmation}) {
  if(!actor?.id||!(actor.role==='SUPERADMIN'||Number(actor.is_superadmin)===1))throw Object.assign(new Error('SUPERADMIN_REQUIRED'),{status:403});
  if(confirmation!==(workflowId?`DELETE WORKFLOW ${workflowId}`:'DELETE ALL WORKFLOWS'))throw Object.assign(new Error('WORKFLOW_DELETE_CONFIRMATION_REQUIRED'),{status:400});
  return db.transaction(() => {
    const plan=workflowPurgePlan(db,workflowId),counts={};
    if(db.prepare('SELECT 1 FROM workflow_financial_delete_scope LIMIT 1').get())throw failure('WORKFLOW_DELETE_SCOPE_NOT_EMPTY');
    const allow=db.prepare('INSERT INTO workflow_financial_delete_scope(entity_table,entity_id) VALUES(?,?)');
    const remove=(table,key,id,scoped=false)=>{
      if(scoped)allow.run(table,id);
      const n=db.prepare(`DELETE FROM ${table} WHERE ${key}=?`).run(id).changes;counts[table]=(counts[table]||0)+n;
    };
    for(const invoice of plan.invoices) {
      for(const row of db.prepare('SELECT id FROM invoice_adjustments WHERE invoice_id=?').all(invoice.id))remove('invoice_adjustments','id',row.id,true);
      for(const row of plan.creditMemos.filter(c=>c.invoice_id===invoice.id))remove('invoice_credit_memos','id',row.id,true);
      remove('invoices','id',invoice.id,true);
    }
    for(const row of plan.financial)remove('financial_items','id',row.id,true);
    for(const row of plan.journals)remove('journal_entries','id',row.id);
    for(const id of plan.ids) {
      // Keep the shared piano inspection records and knowledge library; detach only their retired workflow reference.
      for(const table of ['piano_inspection_history','knowledge_base'])if(exists(db,table))db.prepare(`UPDATE ${table} SET workflow_id=NULL WHERE workflow_id=?`).run(id);
      db.prepare("UPDATE jobs SET workflow_id=CASE WHEN workflow_id=? THEN NULL ELSE workflow_id END,workshop_workflow_id=CASE WHEN workshop_workflow_id=? THEN NULL ELSE workshop_workflow_id END WHERE workflow_id=? OR workshop_workflow_id=?").run(id,id,id,id);
      remove('workflow_finance_sources','id',id);
    }
    for(const entry of plan.calendar) {
      // A surviving non-workflow financial source may still use this job; never delete its source.
      const protectedSource=db.prepare("SELECT 1 FROM invoices WHERE source_type='job' AND source_id=? LIMIT 1").get(entry.job_id);
      const protectedFinancial=db.prepare('SELECT 1 FROM financial_items WHERE job_id=? LIMIT 1').get(entry.job_id);
      const protectedJournal=db.prepare('SELECT 1 FROM journal_entries WHERE job_id=? LIMIT 1').get(entry.job_id);
      if(protectedSource||protectedFinancial||protectedJournal)throw failure('WORKFLOW_CALENDAR_FINANCIAL_REFERENCE_REMAINS',{id:entry.job_id});
      remove('jobs','id',entry.job_id);
      remove('workflow_retired_calendar_jobs','job_id',entry.job_id);
    }
    db.prepare('DELETE FROM workflow_financial_delete_scope').run();
    if(db.pragma('foreign_key_check').length)throw failure('WORKFLOW_DELETE_FOREIGN_KEYS');
    return {ok:true,deleted_workflows:plan.sources.length,deleted_stages:plan.phases.length,counts};
  })();
}

module.exports={ARCHIVE_TABLES,RETIRED_TABLES,retireLegacyWorkflow,installWorkflowDeletionGuards,workflowPurgePlan,purgeWorkflowHistory};
