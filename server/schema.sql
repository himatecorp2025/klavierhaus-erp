
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','MANAGER','STAFF','VIEWER')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  type TEXT,
  email TEXT,
  phone TEXT,
  priority TEXT DEFAULT 'Medium',
  status TEXT DEFAULT 'Active',
  owner TEXT,
  relationship_holder TEXT,
  loss_risk TEXT DEFAULT 'Unknown',
  last_contact TEXT,
  next_step TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pianos (
  id TEXT PRIMARY KEY,
  brand TEXT,
  model TEXT,
  serial_no TEXT,
  year INTEGER,
  ownership TEXT,
  owner_contact_id TEXT,
  location TEXT,
  estimated_value REAL DEFAULT 0,
  status TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  piano_id TEXT,
  client_id TEXT,
  name TEXT NOT NULL,
  type TEXT,
  manager TEXT,
  priority TEXT DEFAULT 'Medium',
  status TEXT DEFAULT 'Not started',
  start_date TEXT,
  due_date TEXT,
  planned_revenue REAL DEFAULT 0,
  actual_revenue REAL DEFAULT 0,
  planned_cost REAL DEFAULT 0,
  actual_cost REAL DEFAULT 0,
  location_type TEXT DEFAULT 'Workshop',
  service_address TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE SET NULL,
  FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_phases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  phase_name TEXT NOT NULL,
  phase_type TEXT,
  sequence_no INTEGER DEFAULT 1,
  assigned_to TEXT,
  priority TEXT DEFAULT 'Medium',
  status TEXT DEFAULT 'Open',
  planned_start TEXT,
  planned_end TEXT,
  appointment_start TEXT,
  appointment_end TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  service_address TEXT,
  planned_amount REAL DEFAULT 0,
  billed_amount REAL DEFAULT 0,
  payment_method TEXT,
  invoice_status TEXT DEFAULT 'Not invoiced',
  invoice_number TEXT,
  required_document_status TEXT DEFAULT 'Not required',
  completion_notes TEXT,
  completed_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  project_type TEXT NOT NULL,
  task_type TEXT NOT NULL,
  default_priority TEXT DEFAULT 'Medium',
  default_planned_hours REAL DEFAULT 0,
  sequence_no INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  phase_id TEXT,
  task_type TEXT NOT NULL,
  assigned_to TEXT,
  priority TEXT DEFAULT 'Medium',
  status TEXT DEFAULT 'Open',
  due_date TEXT,
  appointment_start TEXT,
  appointment_end TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  location_type TEXT DEFAULT 'Workshop',
  service_address TEXT,
  travel_minutes INTEGER DEFAULT 0,
  planned_hours REAL DEFAULT 0,
  actual_hours REAL DEFAULT 0,
  completion_revenue REAL DEFAULT 0,
  payment_method TEXT,
  invoice_status TEXT DEFAULT 'Not invoiced',
  invoice_number TEXT,
  completion_notes TEXT,
  required_document_status TEXT DEFAULT 'Not required',
  completed_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(phase_id) REFERENCES project_phases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  related_type TEXT,
  related_id TEXT,
  title TEXT NOT NULL,
  doc_type TEXT,
  doc_date TEXT,
  url TEXT,
  stored_path TEXT,
  owner TEXT,
  amount REAL DEFAULT 0,
  payment_method TEXT,
  invoice_number TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  code TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_hu TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  normal_side TEXT NOT NULL CHECK(normal_side IN ('DEBIT','CREDIT'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  entry_date TEXT NOT NULL,
  description TEXT,
  client_id TEXT,
  project_id TEXT,
  piano_id TEXT,
  task_id TEXT,
  phase_id TEXT,
  payment_method TEXT,
  status TEXT DEFAULT 'POSTED',
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE SET NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE SET NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY(phase_id) REFERENCES project_phases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  memo TEXT,
  FOREIGN KEY(entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY(account_code) REFERENCES accounts(code)
);

CREATE TABLE IF NOT EXISTS scheduler_events (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  phase_id TEXT,
  project_id TEXT,
  title TEXT NOT NULL,
  assigned_to TEXT,
  event_start TEXT NOT NULL,
  event_end TEXT NOT NULL,
  timezone TEXT DEFAULT 'America/New_York',
  service_address TEXT,
  priority TEXT DEFAULT 'Medium',
  status TEXT DEFAULT 'Scheduled',
  event_type TEXT DEFAULT 'Task',
  planned_amount REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(phase_id) REFERENCES project_phases(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_name TEXT,
  task_id TEXT,
  phase_id TEXT,
  title TEXT NOT NULL,
  message TEXT,
  severity TEXT DEFAULT 'Info',
  is_read INTEGER DEFAULT 0,
  due_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(phase_id) REFERENCES project_phases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  brand TEXT,
  content_type TEXT,
  body TEXT,
  url TEXT,
  stored_path TEXT,
  owner TEXT,
  priority TEXT DEFAULT 'Medium',
  project_id TEXT,
  phase_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY(phase_id) REFERENCES project_phases(id) ON DELETE SET NULL
);

CREATE VIEW IF NOT EXISTS v_trial_balance AS
SELECT
  a.code,
  a.name_en,
  a.name_hu,
  a.category,
  a.normal_side,
  COALESCE(SUM(jl.debit),0) AS debit_total,
  COALESCE(SUM(jl.credit),0) AS credit_total,
  CASE
    WHEN a.normal_side='DEBIT' THEN COALESCE(SUM(jl.debit),0)-COALESCE(SUM(jl.credit),0)
    ELSE COALESCE(SUM(jl.credit),0)-COALESCE(SUM(jl.debit),0)
  END AS balance
FROM accounts a
LEFT JOIN journal_lines jl ON jl.account_code=a.code
GROUP BY a.code;
