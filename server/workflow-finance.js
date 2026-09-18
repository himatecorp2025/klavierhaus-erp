"use strict";
// Preserved financial posting contract, separated from the retired modal/API.
function createWorkflowFinance({db,rid,nowISO=()=>new Date().toISOString()}) {
const numeric=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const roundMoney=v=>Math.round((numeric(v)+Number.EPSILON)*100)/100;
const clean=(v,max=10000)=>String(v??"").trim().slice(0,max);
const validId=v=>clean(v,160);
const error=code=>Object.assign(new Error(code),{code});
  function ensureWorkflowAccountingAccounts() {
    try {
      const insert = db.prepare("INSERT OR IGNORE INTO accounts(code,name_en,name_hu,category,normal_side) VALUES(?,?,?,?,?)");
      insert.run("1310", "Work in Progress Inventory", "Befejezetlen termelés (WIP)", "ASSET", "DEBIT");
      insert.run("6990", "Loss on Abandoned Work", "Megszakított munka vesztesége", "EXPENSE", "DEBIT");
    } catch (_error) {
      // The accounts table is created by init-db before this route module is registered.
    }
  }

  function postWorkflowJournal({ line, workflow, actor, field, accountingStatus, debitAccount, creditAccount, description, memo }) {
    const allowedFields = new Set(["wip_journal_entry_id", "final_journal_entry_id", "writeoff_journal_entry_id"]);
    if (!allowedFields.has(field)) throw error("WORKFLOW_ACCOUNTING_FIELD_INVALID");
    const persisted=db.prepare('SELECT * FROM workflow_finance_lines WHERE id=? AND workflow_id=?').get(line?.id||'',workflow.id);
    if(!persisted)throw error('WORKFLOW_FINANCIAL_SOURCE_NOT_FOUND');
    line=persisted;
    const amount = roundMoney(line?.amount);
    if (!(amount > 0)) return null;
    const existingId = validId(line?.[field]);
    if (existingId) return db.prepare("SELECT * FROM journal_entries WHERE id=?").get(existingId) || { id: existingId };
    ensureWorkflowAccountingAccounts();
    const entryId = rid("WJE");
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,client_id,piano_id,job_id,payment_method,status,created_by)
      VALUES(?,?,?,?,?,?,?,'POSTED',?)`).run(
      entryId, nowISO().slice(0, 10), clean(description, 1000), workflow.client_id || null, workflow.piano_id || null,
      workflow.job_id || null, "", actor?.name || actor?.id || "System"
    );
    db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)")
      .run(rid("WJL"), entryId, debitAccount, amount, 0, clean(memo, 1000));
    db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)")
      .run(rid("WJL"), entryId, creditAccount, 0, amount, clean(memo, 1000));
    db.prepare(`UPDATE workflow_finance_lines SET ${field}=?,accounting_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(entryId, accountingStatus, line.id);
    return db.prepare("SELECT * FROM journal_entries WHERE id=?").get(entryId);
  }

  function postWipForLine(line, workflow, actor) {
    if (!line || String(line.line_type || "").toUpperCase() !== "COST" || String(line.accounting_status || "WIP") === "WRITTEN_OFF") return null;
    return postWorkflowJournal({
      line, workflow, actor, field: "wip_journal_entry_id", accountingStatus: "WIP", debitAccount: "1310",
      creditAccount: line.partner_id ? "2000" : "1010",
      description: `WIP internal cost: ${line.title} (${workflow.workflow_key || workflow.id})`,
      memo: "Debit Work in Progress; credit Accounts Payable or Cash"
    });
  }

  function releaseWipForLine(line, workflow, actor) {
    if (!line || String(line.line_type || "").toUpperCase() !== "COST" || String(line.accounting_status || "") === "WRITTEN_OFF") return null;
    const current = line.wip_journal_entry_id ? line : (db.prepare("SELECT * FROM workflow_finance_lines WHERE id=?").get(line.id) || line);
    if (!current.wip_journal_entry_id) postWipForLine(current, workflow, actor);
    const refreshed = db.prepare("SELECT * FROM workflow_finance_lines WHERE id=?").get(line.id);
    return postWorkflowJournal({
      line: refreshed, workflow, actor, field: "final_journal_entry_id", accountingStatus: "RELEASED", debitAccount: "5000", creditAccount: "1310",
      description: `WIP released to restoration cost: ${refreshed.title} (${workflow.workflow_key || workflow.id})`,
      memo: "Debit Cost of Goods Sold; credit Work in Progress"
    });
  }

  function writeOffWipForLine(line, workflow, actor, reason) {
    if (!line || String(line.line_type || "").toUpperCase() !== "COST" || String(line.accounting_status || "") === "WRITTEN_OFF") return null;
    let current = db.prepare("SELECT * FROM workflow_finance_lines WHERE id=?").get(line.id) || line;
    if (!current.wip_journal_entry_id) {
      postWipForLine(current, workflow, actor);
      current = db.prepare("SELECT * FROM workflow_finance_lines WHERE id=?").get(line.id) || current;
    }
    return postWorkflowJournal({
      line: current, workflow, actor, field: "writeoff_journal_entry_id", accountingStatus: "WRITTEN_OFF", debitAccount: "6990", creditAccount: "1310",
      description: `Loss write-off for abandoned workflow work: ${current.title} (${workflow.workflow_key || workflow.id})`,
      memo: clean(reason, 1000) || "Debit Loss on Abandoned Work; credit Work in Progress"
    });
  }

  function writeOffStageWip(stage, workflow, actor, reason) {
    const lines = db.prepare("SELECT * FROM workflow_finance_lines WHERE workflow_id=? AND stage_id=? AND line_type='COST' ORDER BY created_at,id").all(workflow.id, stage.id);
    const entries = [];
    for (const line of lines) {
      const entry = writeOffWipForLine(line, workflow, actor, reason);
      if (entry) entries.push(entry.id);
    }
    return { lines, journal_entry_ids: entries, total: roundMoney(lines.filter((line) => String(line.accounting_status || "") !== "WRITTEN_OFF").reduce((sum, line) => sum + numeric(line.amount), 0)) };
  }


return {postWipForLine:db.transaction(postWipForLine),releaseWipForLine:db.transaction(releaseWipForLine),writeOffWipForLine:db.transaction(writeOffWipForLine),writeOffStageWip:db.transaction(writeOffStageWip),ensureWorkflowAccountingAccounts};
}
module.exports={createWorkflowFinance};
