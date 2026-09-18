"use strict";

// Additive upgrade: no historical journal, invoice or workflow is rewritten.
function migrateWorkflowExperience(db) {
  const hasTable = table => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  const add = (table, name, definition) => {
    if (hasTable(table) && !db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  db.transaction(() => {
    add('wf2_workflows', 'expected_revenue_cents', 'INTEGER CHECK(expected_revenue_cents IS NULL OR expected_revenue_cents>=0)');
    add('wf2_workflows', 'finance_reset', 'INTEGER NOT NULL DEFAULT 0 CHECK(finance_reset IN(0,1))');
    add('workshop_subtasks', 'planned_cost_cents', 'INTEGER CHECK(planned_cost_cents IS NULL OR planned_cost_cents>=0)');
    add('workshop_subtasks', 'planned_cost_category', "TEXT NOT NULL DEFAULT 'OTHER'");
    add('wf2_costs', 'task_id', 'TEXT REFERENCES workshop_subtasks(id) ON DELETE SET NULL');
    add('wf2_costs', 'incurred_at', 'TEXT');
    add('wf2_costs', 'note', "TEXT NOT NULL DEFAULT ''");
    add('invoices', 'document_status', "TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK(document_status IN('NOT_REQUIRED','MISSING','ATTACHED','GENERATED'))");
    add('invoices', 'workflow_outcome', "TEXT NOT NULL DEFAULT ''");
    for (const table of ['jobs', 'event_payments', 'event_tickets']) add(table, 'finance_reset', 'INTEGER NOT NULL DEFAULT 0 CHECK(finance_reset IN(0,1))');
    db.exec(`CREATE TABLE IF NOT EXISTS wf_card_events (
      id TEXT PRIMARY KEY, card_type TEXT NOT NULL CHECK(card_type IN('WORKFLOW','PHASE','CALENDAR_JOB')),
      card_id TEXT NOT NULL, workflow_id TEXT, title TEXT NOT NULL, old_status TEXT NOT NULL, new_status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS wf_card_event_recipients (
      event_id TEXT NOT NULL REFERENCES wf_card_events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dismissed_at TEXT, PRIMARY KEY(event_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wf_card_recipient ON wf_card_event_recipients(user_id,dismissed_at);
    CREATE TABLE IF NOT EXISTS invoice_supporting_documents (
      invoice_id TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
      stored_name TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
      document_kind TEXT NOT NULL CHECK(document_kind IN('ATTACHED','GENERATED')),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    add('wf_card_events', 'title_en', "TEXT NOT NULL DEFAULT ''");
    add('wf_card_events', 'title_hu', "TEXT NOT NULL DEFAULT ''");
  })();
}
module.exports = { migrateWorkflowExperience };
