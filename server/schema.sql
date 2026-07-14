
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','MANAGER','WORKER','VIEWER')),
  status TEXT DEFAULT 'Active',
  phone TEXT,
  address TEXT,
  hidden_user INTEGER DEFAULT 0,
  is_superadmin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  type TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  billing_address TEXT,
  external_reference TEXT,
  import_source TEXT,
  import_batch_id TEXT,
  priority TEXT DEFAULT 'Medium',
  status TEXT DEFAULT 'Active',
  owner TEXT,
  relationship_holder TEXT,
  loss_risk TEXT DEFAULT 'Unknown',
  last_contact TEXT,
  next_step TEXT,
  notes TEXT,
  has_piano INTEGER DEFAULT 0,
  interested_buying INTEGER DEFAULT 0,
  interest_brand TEXT,
  interest_model TEXT,
  interest_budget REAL DEFAULT 0,
  interest_timeline TEXT,
  interest_notes TEXT,
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
  ownership_type TEXT DEFAULT 'Customer owned',
  display_name TEXT,
  asset_recorded INTEGER DEFAULT 0,
  external_reference TEXT,
  import_source TEXT,
  import_batch_id TEXT,
  original_description TEXT,
  owner_resolution TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  parent_job_id TEXT,
  workflow_root_id TEXT,
  workflow_step_no INTEGER DEFAULT 1,
  workflow_status TEXT DEFAULT 'ACTIVE',
  finalized_at TEXT,
  title TEXT NOT NULL,
  job_type TEXT DEFAULT 'Standalone',
  client_id TEXT,
  client_name TEXT,
  client_phone TEXT,
  piano_id TEXT,
  piano_name TEXT,
  assigned_user_id TEXT,
  assigned_to TEXT NOT NULL,
  created_by_user_id TEXT,
  created_by TEXT,
  last_reassigned_by_user_id TEXT,
  last_reassigned_by TEXT,
  reassignment_note TEXT,
  priority TEXT DEFAULT 'Medium',
  status TEXT DEFAULT 'Open',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT DEFAULT 'America/New_York',
  planned_amount REAL DEFAULT 0,
  pricing_basis TEXT,
  planned_hours REAL DEFAULT 0,
  travel_minutes INTEGER DEFAULT 0,
  service_address TEXT,
  instructions TEXT,
  close_type TEXT,
  billed_amount REAL DEFAULT 0,
  payment_method TEXT,
  invoice_status TEXT DEFAULT 'Not invoiced',
  invoice_number TEXT,
  close_notes TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(parent_job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE SET NULL,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS job_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  log_type TEXT NOT NULL,
  description TEXT NOT NULL,
  billed_amount REAL DEFAULT 0,
  payment_method TEXT,
  invoice_number TEXT,
  document_path TEXT,
  next_job_id TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(next_job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'Closed Job',
  content_type TEXT DEFAULT 'Job Record',
  body TEXT,
  stored_path TEXT,
  owner TEXT,
  amount REAL DEFAULT 0,
  payment_method TEXT,
  invoice_number TEXT,
  priority TEXT DEFAULT 'Medium',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
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
  piano_id TEXT,
  job_id TEXT,
  payment_method TEXT,
  status TEXT DEFAULT 'POSTED',
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE SET NULL,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE SET NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
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


CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO app_settings(setting_key,setting_value,updated_by) VALUES
 ('company_name','Klavierhaus','SYSTEM'),
 ('short_name','KH ERP','SYSTEM'),
 ('logo_url','/icons/icon-512.png','SYSTEM'),
 ('login_background_url','','SYSTEM'),
 ('branding_version','1','SYSTEM');

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  import_source TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PREVIEW',
  total_rows INTEGER DEFAULT 0,
  importable_rows INTEGER DEFAULT 0,
  imported_clients INTEGER DEFAULT 0,
  imported_pianos INTEGER DEFAULT 0,
  updated_clients INTEGER DEFAULT 0,
  unidentified_owner_pianos INTEGER DEFAULT 0,
  client_not_found INTEGER DEFAULT 0,
  skipped_duplicates INTEGER DEFAULT 0,
  missing_data_clients INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  imported_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  summary_json TEXT
);
-- Import-related indexes are created by server/init-db.js and server/index.js
-- only after legacy databases have received all required columns.

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  event_time TEXT DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT,
  user_name TEXT,
  user_role TEXT,
  action TEXT NOT NULL,
  module TEXT,
  record_id TEXT,
  old_value TEXT,
  new_value TEXT,
  success INTEGER DEFAULT 1,
  details TEXT,
  audit_type TEXT DEFAULT 'TECHNICAL'
);
CREATE INDEX IF NOT EXISTS idx_audit_type_time ON audit_log(audit_type,event_time DESC);


CREATE TABLE IF NOT EXISTS financial_items (
  id TEXT PRIMARY KEY,
  item_date TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  main_type TEXT NOT NULL,
  category TEXT,
  recurrence TEXT NOT NULL DEFAULT 'ONE_TIME',
  payment_method TEXT,
  balance_account TEXT,
  job_id TEXT,
  client_id TEXT,
  piano_id TEXT,
  source_type TEXT,
  source_id TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  inventory_id TEXT,
  item_name TEXT NOT NULL,
  main_category TEXT,
  piano_part_category TEXT,
  item_type TEXT,
  acquisition_type TEXT,
  supplier TEXT,
  manufacturer TEXT,
  purchase_price REAL DEFAULT 0,
  manufacturing_cost REAL DEFAULT 0,
  quantity REAL DEFAULT 1,
  unit TEXT,
  condition_status TEXT,
  location TEXT,
  linked_piano_id TEXT,
  linked_client_id TEXT,
  status TEXT DEFAULT 'In Stock',
  notes TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_checks (
  id TEXT PRIMARY KEY,
  check_date TEXT NOT NULL,
  completed_by TEXT,
  item_count INTEGER DEFAULT 0,
  total_value REAL DEFAULT 0,
  snapshot_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS planned_jobs (
  id TEXT PRIMARY KEY,
  planned_key TEXT,
  planned_type TEXT,
  title TEXT NOT NULL,
  client_id TEXT,
  client_name TEXT,
  client_phone TEXT,
  piano_id TEXT,
  piano_name TEXT,
  service_address TEXT,
  preferred_assigned_to TEXT,
  preferred_assigned_user_id TEXT,
  priority TEXT DEFAULT 'Medium',
  expected_revenue REAL DEFAULT 0,
  probability TEXT DEFAULT '100% - Biztos',
  estimated_hours REAL DEFAULT 0,
  target_date TEXT,
  status TEXT,
  block_reason TEXT,
  next_step TEXT,
  notes TEXT,
  converted_job_id TEXT,
  created_by TEXT,
  created_by_user_id TEXT,
  archived_at TEXT,
  archived_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(role,permission)
);

CREATE TABLE IF NOT EXISTS backup_log (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  restored_at TEXT,
  restored_by TEXT
);


-- Notification and PWA push infrastructure
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  sender_user_id TEXT,
  notification_type TEXT NOT NULL,
  related_job_id TEXT,
  title_en TEXT NOT NULL,
  title_hu TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_hu TEXT NOT NULL,
  custom_message TEXT,
  metadata_json TEXT,
  event_key TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ACKNOWLEDGED')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TEXT,
  FOREIGN KEY(recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(related_job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json TEXT NOT NULL,
  user_agent TEXT,
  language TEXT DEFAULT 'en',
  device_id TEXT,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_activation_tests (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RECEIVED','FAILED')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  received_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_activation_tests_user_device ON push_activation_tests(user_id,device_id,created_at DESC);

CREATE TABLE IF NOT EXISTS notification_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK(status IN ('NOT_CONFIGURED','ENABLED','BLOCKED','UNSUPPORTED')),
  platform TEXT,
  user_agent TEXT,
  language TEXT DEFAULT 'en',
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,device_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,
  push_enabled INTEGER DEFAULT 1,
  job_assigned INTEGER DEFAULT 1,
  job_transferred INTEGER DEFAULT 1,
  job_updated INTEGER DEFAULT 1,
  job_deleted INTEGER DEFAULT 1,
  one_hour_reminder INTEGER DEFAULT 1,
  direct_message INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_key ON notifications(event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_status ON notifications(recipient_user_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_job ON notifications(related_job_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_devices_user_status ON notification_devices(user_id,status);
