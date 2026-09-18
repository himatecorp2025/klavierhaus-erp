-- UI12 workflow contract. One operational model; immutable financial custody is separate.
CREATE TABLE IF NOT EXISTS wf2_workflows (
 id TEXT PRIMARY KEY, workflow_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 client_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
 piano_id TEXT NOT NULL REFERENCES pianos(id) ON DELETE RESTRICT,
 creator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 main_responsible_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 mode TEXT NOT NULL CHECK(mode IN ('INBOUND','ON_SITE')),
 start_at TEXT NOT NULL, final_due_at TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED')),
 piano_location_name TEXT NOT NULL DEFAULT '',
 piano_location_address TEXT NOT NULL DEFAULT '',
 service_address TEXT NOT NULL DEFAULT '',
 request_key TEXT,
 aborted_at TEXT, deleted_at TEXT, abandonment_reason TEXT NOT NULL DEFAULT '',
 finance_locked INTEGER NOT NULL DEFAULT 0 CHECK(finance_locked IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1, invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
 completed_at TEXT, completed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(start_at<=final_due_at)
);
CREATE TABLE IF NOT EXISTS wf2_phase_options (
 code TEXT PRIMARY KEY REFERENCES workshop_phase_definitions(code) ON DELETE RESTRICT,
 color TEXT NOT NULL DEFAULT '#B88A44', required INTEGER NOT NULL DEFAULT 1 CHECK(required IN(0,1)),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 default_status TEXT NOT NULL DEFAULT 'WAITING' CHECK(default_status IN('WAITING','IN_PROGRESS','BLOCKED'))
);
CREATE TABLE IF NOT EXISTS wf2_phases (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES wf2_workflows(id) ON DELETE CASCADE,
 stage_code TEXT NOT NULL REFERENCES workshop_phase_definitions(code) ON DELETE RESTRICT,
 stage_order INTEGER NOT NULL, name_snapshot_en TEXT NOT NULL, name_snapshot_hu TEXT NOT NULL,
 responsible_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_at TEXT,
 required INTEGER NOT NULL DEFAULT 1 CHECK(required IN(0,1)),
 status TEXT NOT NULL DEFAULT 'WAITING' CHECK(status IN('WAITING','IN_PROGRESS','BLOCKED','COMPLETED','NOT_REQUIRED')),
 financial_status TEXT NOT NULL DEFAULT 'OPEN' CHECK(financial_status IN('OPEN','CLOSED')),
 completed_at TEXT, completed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
 UNIQUE(workflow_id,stage_code), UNIQUE(id,workflow_id)
);
CREATE TABLE IF NOT EXISTS workshop_subtasks (
 id TEXT PRIMARY KEY, phase_id TEXT NOT NULL REFERENCES wf2_phases(id) ON DELETE CASCADE,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_at TEXT,
 required INTEGER NOT NULL DEFAULT 1 CHECK(required IN(0,1)),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','COMPLETED')),
 completed_by TEXT REFERENCES users(id) ON DELETE RESTRICT, completed_at TEXT,
 approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT, approval_reason TEXT
);
CREATE TABLE IF NOT EXISTS wf2_task_assignees (
 task_id TEXT NOT NULL REFERENCES workshop_subtasks(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, PRIMARY KEY(task_id,user_id)
);
CREATE TABLE IF NOT EXISTS wf2_costs (
 id TEXT PRIMARY KEY, phase_id TEXT NOT NULL REFERENCES wf2_phases(id) ON DELETE CASCADE,
 title TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN('LABOR','MATERIAL','TRANSPORT','PURCHASE','CONTRACTOR','OTHER')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), charge_cents INTEGER NOT NULL CHECK(charge_cents>=0),
 billing_status TEXT NOT NULL DEFAULT 'CHARGEABLE' CHECK(billing_status IN('CHARGEABLE','WARRANTY','FREE','COMPENSATION','CREDIT')),
 partner_id TEXT REFERENCES partners(id) ON DELETE RESTRICT,
 finance_line_id TEXT REFERENCES workflow_finance_lines(id) ON DELETE SET NULL,
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 approval_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK(approval_status IN('PENDING','APPROVED')),
 approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT, approved_at TEXT,
 voided_at TEXT, void_reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS wf2_checklist (
 id TEXT PRIMARY KEY, phase_id TEXT NOT NULL REFERENCES wf2_phases(id) ON DELETE CASCADE,
 task_id TEXT REFERENCES workshop_subtasks(id) ON DELETE CASCADE, title TEXT NOT NULL,
 required INTEGER NOT NULL DEFAULT 1 CHECK(required IN(0,1)),
 checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN(0,1)),
 checked_by TEXT REFERENCES users(id) ON DELETE RESTRICT, checked_at TEXT
);
CREATE TABLE IF NOT EXISTS wf2_documents (
 id TEXT PRIMARY KEY, phase_id TEXT NOT NULL REFERENCES wf2_phases(id) ON DELETE CASCADE,
 task_id TEXT REFERENCES workshop_subtasks(id) ON DELETE CASCADE,
 original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0), sha256 TEXT NOT NULL,
 uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wf2_calendar_links (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES wf2_workflows(id) ON DELETE CASCADE,
 entity_type TEXT NOT NULL CHECK(entity_type IN('START','FINAL','PHASE','TASK')),
 entity_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
 UNIQUE(entity_type,entity_id)
);
CREATE TABLE IF NOT EXISTS wf2_audit (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES wf2_workflows(id) ON DELETE CASCADE,
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', before_json TEXT, after_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wf2_closeouts (
 workflow_id TEXT PRIMARY KEY REFERENCES wf2_workflows(id) ON DELETE CASCADE,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 override INTEGER NOT NULL CHECK(override IN(0,1)), reason TEXT NOT NULL DEFAULT '',
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wf2_phases_owner ON wf2_phases(responsible_user_id,workflow_id);
CREATE INDEX IF NOT EXISTS idx_workshop_subtasks_phase ON workshop_subtasks(phase_id,status);
CREATE INDEX IF NOT EXISTS idx_wf2_assignees_user ON wf2_task_assignees(user_id,task_id);
CREATE INDEX IF NOT EXISTS idx_wf2_calendar_workflow ON wf2_calendar_links(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf2_audit_workflow ON wf2_audit(workflow_id,created_at);
