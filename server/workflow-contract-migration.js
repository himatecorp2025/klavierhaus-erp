"use strict";

// Additive UI12 planner upgrade of the supplied 44 archive, retaining prior migrations.
// Never disable foreign keys,
// rewrite appointments, drop posted journals, or manufacture a responsible user.
function migrateWorkflowContract(db) {
  const exists = name => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const columns = table => new Set(db.pragma(`table_info(${table})`).map(row => row.name));
  const add = (table, name, definition) => {
    if (exists(table) && !columns(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  if (db.pragma("foreign_keys", { simple: true }) !== 1) throw new Error("WORKFLOW_FOREIGN_KEYS_REQUIRED");
  return db.transaction(() => {
    if (exists("wf2_tasks")) {
      if (exists("workshop_subtasks")) throw new Error("WORKFLOW_SUBTASK_MIGRATION_AMBIGUOUS");
      // SQLite retargets the assignee/checklist/document foreign keys atomically.
      db.exec("ALTER TABLE wf2_tasks RENAME TO workshop_subtasks");
      db.exec("DROP INDEX IF EXISTS idx_wf2_tasks_phase");
    }
    for (const [name, type] of [
      ["piano_location_name", "TEXT NOT NULL DEFAULT ''"],
      ["piano_location_address", "TEXT NOT NULL DEFAULT ''"],
      ["service_address", "TEXT NOT NULL DEFAULT ''"],
      ["request_key", "TEXT"], ["aborted_at", "TEXT"], ["deleted_at", "TEXT"],
      ["abandonment_reason", "TEXT NOT NULL DEFAULT ''"],
      ["finance_locked", "INTEGER NOT NULL DEFAULT 0 CHECK(finance_locked IN(0,1))"]
    ]) add("wf2_workflows", name, type);
    for (const [name, type] of [
      ["approval_status", "TEXT NOT NULL DEFAULT 'APPROVED' CHECK(approval_status IN('PENDING','APPROVED'))"],
      ["approved_by", "TEXT REFERENCES users(id) ON DELETE RESTRICT"], ["approved_at", "TEXT"],
      ["voided_at", "TEXT"], ["void_reason", "TEXT NOT NULL DEFAULT ''"]
    ]) add("wf2_costs", name, type);
    if (exists("wf2_workflows")) {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_wf2_request_key ON wf2_workflows(request_key) WHERE request_key IS NOT NULL");
      db.exec("UPDATE wf2_workflows SET finance_locked=1 WHERE status='COMPLETED'");
    }
    if (exists("workshop_subtasks")) db.exec("CREATE INDEX IF NOT EXISTS idx_workshop_subtasks_phase ON workshop_subtasks(phase_id,status)");
    const problems = db.pragma("foreign_key_check");
    if (problems.length) throw Object.assign(new Error("WORKFLOW_MIGRATION_FOREIGN_KEYS"), { details: problems });
    return { contract: "UI12", subtasks: exists("workshop_subtasks"), foreign_keys: 1 };
  })();
}
module.exports = { migrateWorkflowContract };
