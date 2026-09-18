"use strict";

// A ledger entry is never edited or removed by workflow UI operations.
const WIP_ACCOUNT = "1400-WIP-INVENTORY";
const LOSS_ACCOUNT = "6900-LOSS-ON-ABANDONED-WORK";
function createWorkflowFinance({ db, rid, nowISO = () => new Date().toISOString() }) {
  const clean = (value, length = 1000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, length);
  const money = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  const fault = code => Object.assign(new Error(code), { code, status: 409 });
  function ensureWorkflowAccountingAccounts() {
    const insert = db.prepare("INSERT OR IGNORE INTO accounts(code,name_en,name_hu,category,normal_side) VALUES(?,?,?,?,?)");
    insert.run(WIP_ACCOUNT, "Work in Progress Inventory", "Befejezetlen m\u0171helymunka", "ASSET", "DEBIT");
    insert.run(LOSS_ACCOUNT, "Loss on Abandoned Work", "Megszak\u00edtott m\u0171helymunka vesztes\u00e9ge", "EXPENSE", "DEBIT");
  }
  function persisted(line, workflow) {
    const current = db.prepare("SELECT * FROM workflow_finance_lines WHERE id=? AND workflow_id=?").get(line?.id || "", workflow.id);
    if (!current) throw fault("WORKFLOW_FINANCIAL_SOURCE_NOT_FOUND");
    return current;
  }
  function openPeriod() {
    if (db.prepare("SELECT 1 FROM financial_statement_snapshots WHERE period>=? LIMIT 1").get(nowISO().slice(0, 7))) throw fault("WORKFLOW_CLOSED_PERIOD_REVIEW_REQUIRED");
  }
  function originalWipAccount(line) {
    // Old 42 journals used 1310. Credit that same asset when releasing old WIP;
    // never rename a historical account or silently move an existing balance.
    const row = line.wip_journal_entry_id && db.prepare("SELECT account_code FROM journal_lines WHERE entry_id=? AND debit>0 ORDER BY id LIMIT 1").get(line.wip_journal_entry_id);
    return row?.account_code || WIP_ACCOUNT;
  }
  function post({ line, workflow, actor, field, status, debit, credit, description, memo }) {
    if (!["wip_journal_entry_id", "final_journal_entry_id", "writeoff_journal_entry_id"].includes(field)) throw fault("WORKFLOW_ACCOUNTING_FIELD_INVALID");
    line = persisted(line, workflow);
    if (line[field]) {
      const existing = db.prepare("SELECT * FROM journal_entries WHERE id=?").get(line[field]);
      if (!existing) throw fault("WORKFLOW_JOURNAL_LINK_BROKEN");
      return existing;
    }
    const amount = money(line.amount);
    if (!(amount > 0)) return null;
    openPeriod();
    ensureWorkflowAccountingAccounts();
    const entryId = rid("WJE");
    db.prepare("INSERT INTO journal_entries(id,entry_date,description,client_id,piano_id,job_id,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?,'POSTED',?)")
      .run(entryId, nowISO().slice(0, 10), clean(description), workflow.client_id || null, workflow.piano_id || null, workflow.job_id || null, "", actor?.name || actor?.id || "System");
    const insert = db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)");
    insert.run(rid("WJL"), entryId, debit, amount, 0, clean(memo));
    insert.run(rid("WJL"), entryId, credit, 0, amount, clean(memo));
    db.prepare(`UPDATE workflow_finance_lines SET ${field}=?,accounting_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(entryId, status, line.id);
    return db.prepare("SELECT * FROM journal_entries WHERE id=?").get(entryId);
  }
  function postWipForLine(input, workflow, actor) {
    if (!input || input.line_type !== "COST") return null;
    const line = persisted(input, workflow);
    if (line.accounting_status === "WRITTEN_OFF") return null;
    return post({ line, workflow, actor, field: "wip_journal_entry_id", status: "WIP", debit: WIP_ACCOUNT,
      credit: line.partner_id ? "2000" : "1010", description: `WIP internal cost: ${line.title} (${workflow.workflow_key || workflow.id})`, memo: "Debit workshop WIP; credit accounts payable or cash" });
  }
  function releaseWipForLine(input, workflow, actor) {
    if (!input || input.line_type !== "COST") return null;
    let line = persisted(input, workflow);
    if (line.accounting_status === "WRITTEN_OFF") return null;
    if (line.final_journal_entry_id) return db.prepare("SELECT * FROM journal_entries WHERE id=?").get(line.final_journal_entry_id);
    if (!line.wip_journal_entry_id) postWipForLine(line, workflow, actor);
    line = persisted(line, workflow);
    return post({ line, workflow, actor, field: "final_journal_entry_id", status: "RELEASED", debit: "5000", credit: originalWipAccount(line),
      description: `Completed workshop cost: ${line.title} (${workflow.workflow_key || workflow.id})`, memo: "Debit cost of goods sold; credit the original WIP account" });
  }
  function writeOffWipForLine(input, workflow, actor, reason) {
    if (!input || input.line_type !== "COST") return null;
    let line = persisted(input, workflow);
    if (line.accounting_status === "WRITTEN_OFF") return null;
    // Completed, invoiced work is not uncompleted WIP. An accounting correction
    // must not be smuggled in through an operational delete button.
    if (line.accounting_status === "RELEASED" || line.final_journal_entry_id) throw fault("WORKFLOW_RELEASED_COST_REQUIRES_ADJUSTMENT");
    if (!line.wip_journal_entry_id) postWipForLine(line, workflow, actor);
    line = persisted(line, workflow);
    return post({ line, workflow, actor, field: "writeoff_journal_entry_id", status: "WRITTEN_OFF", debit: LOSS_ACCOUNT, credit: originalWipAccount(line),
      description: `Abandoned workshop loss: ${line.title} (${workflow.workflow_key || workflow.id})`, memo: clean(reason) || "Debit realized workshop loss; credit the original WIP account" });
  }
  function settleInternalLine(input, workflow, actor, {aborted=false,reason=""}={}) {
    const line=persisted(input,workflow);
    if (line.final_journal_entry_id || line.writeoff_journal_entry_id) return null;
    if (line.wip_journal_entry_id) return aborted ? writeOffWipForLine(line,workflow,actor,reason) : releaseWipForLine(line,workflow,actor);
    // New workflows accrue actual outlays only at terminal settlement. A cost
    // is payable, not cash-paid, until the separate payment process records it.
    return post({line,workflow,actor,field:aborted?"writeoff_journal_entry_id":"final_journal_entry_id",
      status:aborted?"WRITTEN_OFF":"RELEASED",debit:aborted?LOSS_ACCOUNT:"5000",credit:"2000",
      description:`${aborted?"Aborted":"Completed"} workflow cost: ${line.title} (${workflow.id})`,memo:aborted?clean(reason):"Actual workflow cost accrued at final completion; unpaid"});
  }
  function writeOffStageWip(stage, workflow, actor, reason) {
    const lines = db.prepare("SELECT * FROM workflow_finance_lines WHERE workflow_id=? AND stage_id=? AND line_type='COST' ORDER BY created_at,id").all(workflow.id, stage.id);
    const journalIds = [];
    let total = 0;
    for (const line of lines) {
      if (line.accounting_status === "WRITTEN_OFF") continue;
      const entry = writeOffWipForLine(line, workflow, actor, reason);
      if (entry) { journalIds.push(entry.id); total += Number(line.amount || 0); }
    }
    return { lines, journal_entry_ids: journalIds, total: money(total) };
  }
  return { settleInternalLine: db.transaction(settleInternalLine), postWipForLine: db.transaction(postWipForLine), releaseWipForLine: db.transaction(releaseWipForLine),
    writeOffWipForLine: db.transaction(writeOffWipForLine), writeOffStageWip: db.transaction(writeOffStageWip), ensureWorkflowAccountingAccounts };
}
module.exports = { createWorkflowFinance, WIP_ACCOUNT, LOSS_ACCOUNT };
