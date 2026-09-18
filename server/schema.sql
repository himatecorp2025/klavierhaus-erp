
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','MANAGER','WORKER')),
  status TEXT DEFAULT 'Active',
  phone TEXT,
  address_line1 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'United States',
  address TEXT,
  calendar_color TEXT,
  google_calendar_email TEXT,
  contact_email TEXT,
  hidden_user INTEGER DEFAULT 0,
  is_superadmin INTEGER DEFAULT 0,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Existing accounts remain verified by default because only newly created users
-- receive a row in this table.
CREATE TABLE IF NOT EXISTS account_activations (
  user_id TEXT PRIMARY KEY,
  code_hash TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED')),
  code_version INTEGER NOT NULL DEFAULT 1,
  issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_delivery_status TEXT DEFAULT 'PENDING',
  last_delivery_log_id TEXT,
  last_sent_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activation_email_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  error_code TEXT,
  last_event_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activation_email_events (
  event_id TEXT PRIMARY KEY,
  provider_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_created_at TEXT,
  received_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  type TEXT,
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'United States',
  address TEXT,
  billing_address TEXT,
  tax_id TEXT,
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
  is_vip INTEGER NOT NULL DEFAULT 0 CHECK(is_vip IN (0,1)),
  follow_up_date TEXT,
  follow_up_cadence TEXT CHECK(follow_up_cadence IS NULL OR follow_up_cadence='' OR follow_up_cadence IN ('CUSTOM','3_MONTHS','6_MONTHS','1_YEAR')),
  follow_up_reason TEXT,
  relationship_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pianos (
  id TEXT PRIMARY KEY,
  brand TEXT,
  model TEXT,
  serial_no TEXT,
  finish TEXT,
  year INTEGER,
  build_year INTEGER,
  size_cm TEXT,
  size_in TEXT,
  size_display TEXT,
  size_length TEXT,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_pianos_serial_no_unique ON pianos(lower(trim(serial_no))) WHERE serial_no IS NOT NULL AND trim(serial_no)<>'';

CREATE TABLE IF NOT EXISTS piano_brands (
  brand_name TEXT PRIMARY KEY COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_piano_brands_active_name ON piano_brands(active,brand_name);
INSERT OR IGNORE INTO piano_brands(brand_name,active) VALUES
  ('Steinway & Sons',1),('Bösendorfer',1),('Fazioli',1),('C. Bechstein',1),('Yamaha',1);

CREATE TABLE IF NOT EXISTS piano_model_catalog (
  brand_name TEXT NOT NULL COLLATE NOCASE,
  model_name TEXT NOT NULL COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(brand_name,model_name)
);
CREATE INDEX IF NOT EXISTS idx_piano_model_catalog_active_brand ON piano_model_catalog(active,brand_name,model_name);
INSERT OR IGNORE INTO piano_model_catalog(brand_name,model_name,active) VALUES
  ('Steinway & Sons','D-274',1),('Steinway & Sons','B-211',1),('Steinway & Sons','A-188',1),('Steinway & Sons','O-180',1),('Steinway & Sons','M-170',1),('Steinway & Sons','S-155',1),('Steinway & Sons','K-132',1),
  ('Bösendorfer','Imperial 290',1),('Bösendorfer','280VC',1),('Bösendorfer','225',1),('Bösendorfer','214VC',1),('Bösendorfer','200',1),('Bösendorfer','185VC',1),('Bösendorfer','170',1),('Bösendorfer','130',1),
  ('Fazioli','F308',1),('Fazioli','F278',1),('Fazioli','F228',1),('Fazioli','F212',1),('Fazioli','F183',1),('Fazioli','F156',1),
  ('C. Bechstein','D-282',1),('C. Bechstein','C-234',1),('C. Bechstein','B-212',1),('C. Bechstein','A-192',1),('C. Bechstein','L-167',1),('C. Bechstein','Concert 8',1),
  ('Yamaha','CFX',1),('Yamaha','CF6',1),('Yamaha','CF4',1),('Yamaha','SX Series',1),('Yamaha','C3X',1),('Yamaha','U1',1),('Yamaha','U3',1);

CREATE TABLE IF NOT EXISTS client_pianos (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  piano_id TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK(is_verified IN (0,1)),
  verified_at TEXT,
  verified_by TEXT,
  piano_location_address TEXT,
  location_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(client_id,piano_id),
  FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_client_pianos_client ON client_pianos(client_id,piano_id);
CREATE INDEX IF NOT EXISTS idx_client_pianos_piano ON client_pianos(piano_id,client_id);
CREATE INDEX IF NOT EXISTS idx_client_pianos_verified ON client_pianos(is_verified,client_id,piano_id);
CREATE INDEX IF NOT EXISTS idx_contacts_crm_follow_up ON contacts(follow_up_date,is_vip);

CREATE TABLE IF NOT EXISTS steinway_serial_registry (
  start_serial INTEGER PRIMARY KEY,
  build_year INTEGER NOT NULL CHECK(build_year BETWEEN 1853 AND 2100)
);

CREATE TABLE IF NOT EXISTS steinway_model_reference (
  model_key TEXT PRIMARY KEY,
  size_cm TEXT NOT NULL,
  size_in TEXT NOT NULL,
  size_display TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_key TEXT,
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
  planned_minutes INTEGER DEFAULT 0,
  travel_minutes INTEGER DEFAULT 0,
  service_address TEXT,
  instructions TEXT,
  notes TEXT,
  workflow_id TEXT,
  workshop_workflow_id TEXT,
  planned_job_id TEXT,
  close_type TEXT,
  billed_amount REAL DEFAULT 0,
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method='' OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash')),
  invoice_status TEXT DEFAULT 'Not invoiced',
  invoice_number TEXT,
  billing_status TEXT NOT NULL DEFAULT 'Unbilled' CHECK(billing_status IN ('Unbilled','Billed')),
  invoice_id TEXT,
  close_notes TEXT,
  completion_notes TEXT,
  completed_at TEXT,
  financial_status TEXT NOT NULL DEFAULT 'OPEN' CHECK(financial_status IN ('OPEN','POSTED')),
  financial_ledger_id TEXT,
  closed_at TEXT,
  daily_rate_enabled INTEGER NOT NULL DEFAULT 0 CHECK(daily_rate_enabled IN (0,1)),
  daily_rate_allocated_amount REAL NOT NULL DEFAULT 0 CHECK(daily_rate_allocated_amount >= 0),
  daily_rate_date TEXT,
  technician_extra_compensation REAL NOT NULL DEFAULT 0 CHECK(technician_extra_compensation >= 0),
  is_crm_follow_up INTEGER NOT NULL DEFAULT 0 CHECK(is_crm_follow_up IN (0,1)),
  contact_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(parent_job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE SET NULL,
  FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE SET NULL,
  FOREIGN KEY(workshop_workflow_id) REFERENCES workshop_workflows(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_daily_rate_capacity ON jobs(assigned_user_id,daily_rate_date,daily_rate_enabled,status);
CREATE INDEX IF NOT EXISTS idx_jobs_crm_follow_up_contact ON jobs(is_crm_follow_up,contact_id,status);

CREATE TABLE IF NOT EXISTS job_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  log_type TEXT NOT NULL,
  description TEXT NOT NULL,
  billed_amount REAL DEFAULT 0,
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method='' OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash')),
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
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method='' OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash')),
  invoice_number TEXT,
  priority TEXT DEFAULT 'Medium',
  workflow_id TEXT,
  effective_date TEXT,
  original_filename TEXT,
  mime_type TEXT,
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
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method='' OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash')),
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


-- Public cultural events are managed by the protected ERP and published to the
-- separately deployed website through a read-only API. All additions are
-- forward-compatible and leave existing ERP business records untouched.
CREATE TABLE IF NOT EXISTS event_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_hu TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL,
  custom_type TEXT,
  access_type TEXT NOT NULL CHECK(access_type IN ('PUBLIC_PAID','PUBLIC_FREE','INVITE_ONLY','INTERNAL')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','RESCHEDULED','CANCELLED','COMPLETED','CLOSED')),
  status_before_close TEXT,
  slug_en TEXT NOT NULL UNIQUE,
  slug_hu TEXT NOT NULL UNIQUE,
  title_en TEXT NOT NULL,
  title_hu TEXT NOT NULL,
  short_description_en TEXT,
  short_description_hu TEXT,
  description_en TEXT,
  description_hu TEXT,
  artist_id TEXT,
  performer_name TEXT,
  hero_image_url TEXT,
  hero_image_alt_en TEXT,
  hero_image_alt_hu TEXT,
  gallery_json TEXT DEFAULT '[]',
  venue_name TEXT NOT NULL,
  venue_street TEXT NOT NULL,
  venue_city TEXT NOT NULL,
  venue_region TEXT NOT NULL,
  venue_postal_code TEXT NOT NULL,
  venue_country TEXT NOT NULL DEFAULT 'US',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  previous_start_at TEXT,
  cancellation_reason TEXT,
  cancelled_at TEXT,
  cancelled_by_user_id TEXT,
  capacity_total INTEGER NOT NULL CHECK(capacity_total > 0),
  special_capacity_total INTEGER NOT NULL DEFAULT 0 CHECK(special_capacity_total >= 0),
  special_capacity_unlimited INTEGER NOT NULL DEFAULT 1 CHECK(special_capacity_unlimited IN (0,1)),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  sales_start_at TEXT,
  sales_end_at TEXT,
  refund_policy_version TEXT NOT NULL DEFAULT 'KH-48H-V1',
  published_at TEXT,
  closed_at TEXT,
  daily_rate_enabled INTEGER NOT NULL DEFAULT 0 CHECK(daily_rate_enabled IN (0,1)),
  daily_rate_allocated_amount REAL NOT NULL DEFAULT 0 CHECK(daily_rate_allocated_amount >= 0),
  daily_rate_date TEXT,
  closed_by_user_id TEXT,
  closure_snapshot_json TEXT,
  sold_out_at TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),
  relaunch_source_event_id TEXT,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES event_categories(id),
  FOREIGN KEY(artist_id) REFERENCES website_artists(id) ON DELETE SET NULL,
  FOREIGN KEY(cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(relaunch_source_event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_invitations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','REVOKED')),
  token_hash TEXT NOT NULL UNIQUE,
  delivery_status TEXT NOT NULL DEFAULT 'PENDING',
  provider_message_id TEXT,
  sent_at TEXT,
  accepted_at TEXT,
  declined_at TEXT,
  revoked_at TEXT,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id,guest_email),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_tickets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  invitation_id TEXT,
  contact_id TEXT,
  source_type TEXT NOT NULL CHECK(source_type IN ('INVITATION','COMPLIMENTARY','PURCHASE')),
  ticket_variant TEXT NOT NULL DEFAULT 'PUBLIC_PAID',
  buyer_name TEXT,
  attendee_name TEXT NOT NULL,
  original_guest_name TEXT,
  salutation TEXT,
  first_names TEXT,
  surnames TEXT,
  suffix TEXT,
  contact_email TEXT NOT NULL,
  public_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'VALID' CHECK(status IN ('VALID','USED','VOID','REFUNDED')),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method='' OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash')),
  payment_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  reservation_status TEXT NOT NULL DEFAULT 'FINALIZED',
  on_site_deadline_at TEXT,
  reserved_at TEXT,
  paid_at TEXT,
  finalized_at TEXT,
  legacy_public_code TEXT,
  document_front_path TEXT,
  document_back_path TEXT,
  document_full_path TEXT,
  event_payment_id TEXT,
  invoice_id TEXT,
  ticket_sequence INTEGER,
  checked_in_at TEXT,
  checked_in_by_user_id TEXT,
  voided_at TEXT,
  voided_by_user_id TEXT,
  created_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(invitation_id),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(invitation_id) REFERENCES event_invitations(id) ON DELETE SET NULL,
  FOREIGN KEY(checked_in_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(voided_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_ticket_documents (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK(document_type IN ('FRONT','BACK','FULL')),
  stored_path TEXT NOT NULL,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  generated_by_user_id TEXT,
  FOREIGN KEY(ticket_id) REFERENCES event_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(generated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(ticket_id,document_type)
);

CREATE TABLE IF NOT EXISTS event_checkins (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  ticket_id TEXT,
  result TEXT NOT NULL CHECK(result IN ('ACCEPTED','ALREADY_USED','INVALID','VOID','REVERTED')),
  token_fingerprint TEXT,
  performed_by_user_id TEXT,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(ticket_id) REFERENCES event_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY(performed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_refund_requests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  requester_name TEXT,
  requester_email TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','APPROVED','REJECTED','PROCESSED')),
  eligibility_code TEXT NOT NULL,
  eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
  resolution_note TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  approved_at TEXT,
  executed_at TEXT,
  execution_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  no_show INTEGER NOT NULL DEFAULT 0 CHECK(no_show IN (0,1)),
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(ticket_id) REFERENCES event_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY(resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Stripe is deliberately sandbox-only in this release. A short-lived hold
-- protects general-admission capacity while the hosted Checkout is open.
CREATE TABLE IF NOT EXISTS event_checkout_holds (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','EXPIRED','CANCELLED','FAILED','REFUNDED')),
  expires_at TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  attendee_names_json TEXT NOT NULL DEFAULT '[]',
  purchaser_name TEXT,
  purchaser_email TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  amount_total INTEGER NOT NULL DEFAULT 0 CHECK(amount_total >= 0),
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  failure_code TEXT,
  test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_payments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  hold_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('PAID','REFUND_PENDING','REFUNDED','REFUND_FAILED')),
  purchaser_name TEXT NOT NULL,
  purchaser_email TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  amount_total INTEGER NOT NULL CHECK(amount_total >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT NOT NULL UNIQUE,
  stripe_refund_id TEXT UNIQUE,
  stripe_fee_cents INTEGER,
  invoice_id TEXT,
  test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),
  paid_at TEXT,
  refunded_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(hold_id) REFERENCES event_checkout_holds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PROCESSING','PROCESSED','FAILED')),
  failure_code TEXT,
  test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),
  received_at TEXT DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_closures (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  closed_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Digital and paper attendance are represented separately from the ticket
-- lifecycle. A guest can therefore be marked as deleted without changing a
-- paid ticket into VOID or destroying its financial history.
CREATE TABLE IF NOT EXISTS event_attendance_sessions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  mode TEXT CHECK(mode IN ('PAPER','DIGITAL')),
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED','OPEN','CLOSED')),
  started_at TEXT,
  started_by_user_id TEXT,
  closed_at TEXT,
  daily_rate_enabled INTEGER NOT NULL DEFAULT 0 CHECK(daily_rate_enabled IN (0,1)),
  daily_rate_allocated_amount REAL NOT NULL DEFAULT 0 CHECK(daily_rate_allocated_amount >= 0),
  daily_rate_date TEXT,
  closed_by_user_id TEXT,
  reopened_at TEXT,
  reopened_by_user_id TEXT,
  paused_at TEXT,
  paused_by_user_id TEXT,
  resumed_at TEXT,
  resumed_by_user_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  export_version INTEGER NOT NULL DEFAULT 0,
  last_status_change_at TEXT,
  last_pdf_export_at TEXT,
  snapshot_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(started_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(reopened_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ,FOREIGN KEY(paused_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ,FOREIGN KEY(resumed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_attendance_entries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'NOT_ARRIVED' CHECK(status IN ('NOT_ARRIVED','PRESENT','DELETED')),
  checked_in_at TEXT,
  checked_in_by_user_id TEXT,
  deleted_at TEXT,
  deleted_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(ticket_id) REFERENCES event_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY(checked_in_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_attendance_actions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  session_id TEXT,
  ticket_id TEXT,
  action TEXT NOT NULL,
  from_mode TEXT,
  to_mode TEXT,
  from_status TEXT,
  to_status TEXT,
  performed_by_user_id TEXT,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(session_id) REFERENCES event_attendance_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY(ticket_id) REFERENCES event_tickets(id) ON DELETE SET NULL,
  FOREIGN KEY(performed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_attendance_exports (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  session_id TEXT,
  export_type TEXT NOT NULL CHECK(export_type IN ('PAPER','DIGITAL')),
  export_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  exported_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(session_id) REFERENCES event_attendance_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY(exported_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Operational extensions for manual attendance, customer conversations and
-- auditable transactional document delivery. Public conversation access is
-- token based; only a keyed hash is stored in the ERP database.
CREATE TABLE IF NOT EXISTS customer_conversations (
  id TEXT PRIMARY KEY,
  public_token_hash TEXT NOT NULL UNIQUE,
  public_token_encrypted TEXT,
  visitor_token_hash TEXT,
  name TEXT,
  email TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  category TEXT NOT NULL CHECK(category IN ('SERVICE','PIANO','EVENT','REFUND','PRIVATE_CONSULTATION','TECHNICAL','TICKET','BILLING','REPAIR','GENERAL','OTHER')),
  service_id TEXT,
  piano_id TEXT,
  event_id TEXT,
  ticket_id TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PENDING_CUSTOMER','PENDING_STAFF','CLOSED')),
  assigned_user_id TEXT,
  assigned_role TEXT,
  consent_contact INTEGER NOT NULL DEFAULT 0 CHECK(consent_contact IN (0,1)),
  source_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_message_at TEXT,
  last_activity_at TEXT,
  closed_at TEXT,
  daily_rate_enabled INTEGER NOT NULL DEFAULT 0 CHECK(daily_rate_enabled IN (0,1)),
  daily_rate_allocated_amount REAL NOT NULL DEFAULT 0 CHECK(daily_rate_allocated_amount >= 0),
  daily_rate_date TEXT,
  auto_closed_at TEXT,
  closure_note TEXT,
  reopen_reason TEXT,
  reopened_at TEXT,
  reopened_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(service_id) REFERENCES website_services(id) ON DELETE SET NULL,
  FOREIGN KEY(piano_id) REFERENCES website_showroom_pianos(id) ON DELETE SET NULL,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL,
  FOREIGN KEY(ticket_id) REFERENCES event_tickets(id) ON DELETE SET NULL,
  FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(reopened_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customer_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('CUSTOMER','STAFF')),
  sender_name TEXT NOT NULL,
  sender_email TEXT,
  sender_user_id TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNREAD' CHECK(status IN ('UNREAD','READ')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES customer_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customer_message_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK(file_size >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES customer_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES customer_messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_conversation_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT,
  actor_role TEXT,
  from_status TEXT,
  to_status TEXT,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES customer_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS support_holidays (
  id TEXT PRIMARY KEY,
  holiday_date TEXT NOT NULL UNIQUE,
  label_en TEXT NOT NULL,
  label_hu TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS communication_deliveries (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  delivery_type TEXT NOT NULL,
  recipient_email TEXT,
  event_id TEXT,
  payment_id TEXT,
  ticket_id TEXT,
  conversation_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','SENT','FAILED','NOT_CONFIGURED')),
  provider TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL,
  FOREIGN KEY(payment_id) REFERENCES event_payments(id) ON DELETE SET NULL,
  FOREIGN KEY(ticket_id) REFERENCES event_tickets(id) ON DELETE SET NULL,
  FOREIGN KEY(conversation_id) REFERENCES customer_conversations(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO event_categories(id,code,name_en,name_hu,sort_order) VALUES
 ('EVC-PIANO-CONCERT','PIANO_CONCERT','Piano Concert','Zongorahangverseny',10),
 ('EVC-ARTIST-PERFORMANCE','ARTIST_PERFORMANCE','Artist Performance','Művészi előadás',20),
 ('EVC-SALON-CONCERT','SALON_CONCERT','Salon Concert','Szalonkoncert',30),
 ('EVC-MASTERCLASS','MASTERCLASS','Masterclass','Mesterkurzus',40),
 ('EVC-CULTURAL-EVENT','CULTURAL_EVENT','Cultural Event','Kulturális esemény',50),
 ('EVC-OTHER-MUSICAL','OTHER_MUSICAL_EVENT','Other Musical Event','Egyéb zenei esemény',60);


CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Published website copy is stored per page and language. The bundled website
-- content remains the safe fallback, while administrators can update the same
-- structured document without injecting HTML into the public renderer.
CREATE TABLE IF NOT EXISTS landing_sections (
  section_key TEXT PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  order_index INTEGER NOT NULL DEFAULT 0,
  updated_by_user_id TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS website_content_pages (
  page_key TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('en','hu')),
  content_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id TEXT,
  published_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(page_key,language),
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Public website collections are deliberately separate from ERP customer
-- pianos and work records. This prevents public showroom/catalog editing from
-- mutating operational client data.
CREATE TABLE IF NOT EXISTS website_reviews (
  id TEXT PRIMARY KEY,
  person_name TEXT NOT NULL,
  role_en TEXT,
  role_hu TEXT,
  quote_en TEXT NOT NULL,
  quote_hu TEXT NOT NULL,
  portrait_url TEXT NOT NULL,
  portrait_alt_en TEXT,
  portrait_alt_hu TEXT,
  linked_event_id TEXT,
  visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_event_id) REFERENCES events(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS website_showroom_pianos (
  id TEXT PRIMARY KEY,
  slug_en TEXT NOT NULL UNIQUE,
  slug_hu TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL,
  model TEXT,
  build_year INTEGER,
  serial_no TEXT,
  size_cm TEXT,
  size_in TEXT,
  size_display TEXT,
  title_en TEXT NOT NULL,
  title_hu TEXT NOT NULL,
  summary_en TEXT,
  summary_hu TEXT,
  description_en TEXT,
  description_hu TEXT,
  image_url TEXT NOT NULL,
  image_alt_en TEXT,
  image_alt_hu TEXT,
  gallery_json TEXT NOT NULL DEFAULT '[]',
  availability_status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(availability_status IN ('AVAILABLE','RESERVED','SOLD','HIDDEN')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  published INTEGER NOT NULL DEFAULT 1 CHECK(published IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS website_services (
  id TEXT PRIMARY KEY,
  slug_en TEXT NOT NULL UNIQUE,
  slug_hu TEXT NOT NULL UNIQUE,
  title_en TEXT NOT NULL,
  title_hu TEXT NOT NULL,
  summary_en TEXT,
  summary_hu TEXT,
  description_en TEXT,
  description_hu TEXT,
  image_url TEXT NOT NULL,
  image_alt_en TEXT,
  image_alt_hu TEXT,
  visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Public artists are a separate editorial collection. They are never mixed
-- with ERP users, workers, or customer contacts.
CREATE TABLE IF NOT EXISTS website_artists (
  id TEXT PRIMARY KEY,
  slug_en TEXT NOT NULL UNIQUE,
  slug_hu TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role_en TEXT,
  role_hu TEXT,
  biography_en TEXT,
  biography_hu TEXT,
  portrait_url TEXT NOT NULL,
  portrait_alt_en TEXT,
  portrait_alt_hu TEXT,
  gallery_json TEXT NOT NULL DEFAULT '[]',
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  published INTEGER NOT NULL DEFAULT 1 CHECK(published IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS website_media (
  id TEXT PRIMARY KEY,
  file_url TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  alt_en TEXT,
  alt_hu TEXT,
  usage_type TEXT NOT NULL DEFAULT 'GENERAL',
  created_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS website_contact_leads (
  id TEXT PRIMARY KEY,
  lead_type TEXT NOT NULL DEFAULT 'SERVICE_CALLBACK' CHECK(lead_type IN ('SERVICE_CALLBACK','PRIVATE_CONSULTATION','GENERAL_CONTACT','EVENT_INTEREST')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  service_id TEXT,
  piano_brand TEXT,
  piano_model TEXT,
  service_address TEXT,
  preferred_time TEXT,
  event_date TEXT,
  event_venue TEXT,
  instrument_requirements TEXT,
  rental_duration TEXT,
  message TEXT,
  preferred_contact TEXT NOT NULL DEFAULT 'EMAIL' CHECK(preferred_contact IN ('EMAIL','PHONE','EITHER')),
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  consent_contact INTEGER NOT NULL DEFAULT 0 CHECK(consent_contact IN (0,1)),
  consent_marketing INTEGER NOT NULL DEFAULT 0 CHECK(consent_marketing IN (0,1)),
  source_path TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','CONTACTED','IN_DISCUSSION','APPOINTMENT_SCHEDULED','CLOSED','REJECTED')),
  assigned_user_id TEXT,
  internal_notes TEXT,
  contact_date TEXT,
  agreed_appointment_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(service_id) REFERENCES website_services(id) ON DELETE SET NULL,
  FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Draft/publish versions are immutable snapshots. website_content_pages keeps
-- the currently published snapshot for the fast public read path.
CREATE TABLE IF NOT EXISTS website_content_versions (
  id TEXT PRIMARY KEY,
  page_key TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('en','hu')),
  version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  created_by_user_id TEXT,
  published_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  UNIQUE(page_key,language,version),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(published_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS website_preview_tokens (
  token_hash TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(version_id) REFERENCES website_content_versions(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- One request is accepted per event and first-party device, and one per
-- normalized email. Only a keyed hash of the browser identifier is retained.
CREATE TABLE IF NOT EXISTS event_repeat_requests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  notify_event INTEGER NOT NULL DEFAULT 1 CHECK(notify_event IN (0,1)),
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK(marketing_consent IN (0,1)),
  source_path TEXT,
  notified_at TEXT,
  notification_event_id TEXT,
  delivery_status TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id,email_normalized),
  UNIQUE(event_id,device_hash),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(notification_event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS website_integration_settings (
  provider TEXT PRIMARY KEY CHECK(provider IN ('GA4','SEARCH_CONSOLE','GOOGLE_OAUTH','CLARITY')),
  status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK(status IN ('DISCONNECTED','CONFIGURED','CONNECTED','ERROR')),
  public_config_json TEXT NOT NULL DEFAULT '{}',
  encrypted_secret TEXT,
  last_tested_at TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  updated_by_user_id TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS system_integration_secrets (
  provider TEXT PRIMARY KEY CHECK(provider IN ('GOOGLE_CALENDAR','GA4','CLARITY','SEARCH_CONSOLE','RESEND','STRIPE')),
  public_config_json TEXT NOT NULL DEFAULT '{}',
  encrypted_secret TEXT,
  secret_hint TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS system_integration_health (
  provider TEXT PRIMARY KEY CHECK(provider IN ('GOOGLE_CALENDAR','GA4','CLARITY','SEARCH_CONSOLE','RESEND','STRIPE')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK(status IN ('DISCONNECTED','CONFIGURED','CONNECTED','ERROR','DISABLED')),
  last_tested_at TEXT,
  last_success_at TEXT,
  last_connection_at TEXT,
  last_error TEXT,
  updated_by_user_id TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS system_integration_backups (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('GOOGLE_CALENDAR','GA4','CLARITY','SEARCH_CONSOLE','RESEND','STRIPE')),
  snapshot_json TEXT NOT NULL,
  backup_file_path TEXT NOT NULL,
  backup_sha256 TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS system_integration_delete_tokens (
  token_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('GOOGLE_CALENDAR','GA4','CLARITY','SEARCH_CONSOLE','RESEND','STRIPE')),
  requested_by_user_id TEXT NOT NULL,
  record_counts_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_integration_test_tokens (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider='GOOGLE_CALENDAR'),
  requested_by_user_id TEXT NOT NULL,
  access_token_encrypted TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS website_integration_oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'GOOGLE',
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT NOT NULL,
  utm_term TEXT,
  utm_content TEXT,
  destination_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS website_tracking_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  anonymous_session_hash TEXT NOT NULL,
  source_path TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  event_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  analytics_consent INTEGER NOT NULL DEFAULT 0 CHECK(analytics_consent IN (0,1)),
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK(marketing_consent IN (0,1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL
);

-- One-way Google Calendar -> ERP integration. OAuth secrets are encrypted by the
-- application before they are written to this table.
CREATE TABLE IF NOT EXISTS calendar_integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  central_email TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  calendar_summary TEXT,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED',
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expiry TEXT,
  sync_token TEXT,
  channel_id TEXT,
  resource_id TEXT,
  channel_token TEXT,
  channel_expires_at TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  connected_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(connected_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS calendar_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_calendar_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  external_recurring_event_id TEXT,
  external_status TEXT,
  event_etag TEXT,
  creator_email TEXT,
  organizer_email TEXT,
  job_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(review_status IN ('NEEDS_REVIEW','REVIEWED','SOURCE_CHANGED','SOURCE_CANCELLED','INVALID','IGNORED')),
  conflict_flag INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  source_updated_at TEXT,
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by_user_id TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider,calendar_id,external_event_id),
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS calendar_sync_log (
  id TEXT PRIMARY KEY,
  integration_id TEXT,
  trigger_type TEXT,
  status TEXT NOT NULL,
  imported_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  flagged_count INTEGER DEFAULT 0,
  details TEXT,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(integration_id) REFERENCES calendar_integrations(id) ON DELETE CASCADE
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
CREATE TRIGGER IF NOT EXISTS trg_financial_audit_log_immutable_delete
BEFORE DELETE ON audit_log
WHEN OLD.audit_type='FINANCIAL'
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_AUDIT_LOG');
END;
CREATE TRIGGER IF NOT EXISTS trg_financial_audit_log_immutable_update
BEFORE UPDATE ON audit_log
WHEN OLD.audit_type='FINANCIAL' OR NEW.audit_type='FINANCIAL'
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_AUDIT_LOG');
END;


CREATE TABLE IF NOT EXISTS employee_daily_rates (
  user_id TEXT NOT NULL,
  rate REAL NOT NULL CHECK(rate >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  effective_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  PRIMARY KEY(user_id,effective_date),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_employee_daily_rates_user_date ON employee_daily_rates(user_id,effective_date DESC);


CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  tax_id TEXT,
  billing_address TEXT,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  default_tax_rate REAL NOT NULL DEFAULT 0.0 CHECK(default_tax_rate >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partners_status_name ON partners(status,company_name);

CREATE TABLE IF NOT EXISTS partner_contractors (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  user_id TEXT,
  worker_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK(user_id IS NOT NULL OR length(trim(COALESCE(worker_name,''))) > 0)
);
CREATE INDEX IF NOT EXISTS idx_partner_contractors_partner ON partner_contractors(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_contractors_user ON partner_contractors(user_id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')),
  invoice_number TEXT NOT NULL UNIQUE,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  partner_id TEXT,
  client_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('job','workflow','manual','event')),
  source_id TEXT,
  summary TEXT,
  subtotal REAL NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
  tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0),
  tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
  total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash','NONE / INTERNAL')),
  payment_link_url TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','paid','void','carried_over')),
  revenue_recognition_status TEXT NOT NULL DEFAULT 'RECOGNIZED' CHECK(revenue_recognition_status IN ('RECOGNIZED','DEFERRED')),
  revenue_recognition_date TEXT,
  deferred_event_id TEXT,
  paid_at TEXT,
  voided_at TEXT,
  voided_by TEXT,
  archived_at TEXT,
  archived_period TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE SET NULL,
  FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_direction_issue ON invoices(direction,issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices(source_type,source_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status,due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_source_direction_unique ON invoices(direction,source_type,source_id) WHERE source_id IS NOT NULL AND trim(source_id)<>'';

-- Persistent high-watermark for invoice numbering. Invoice-only purge intentionally
-- preserves this table so a previously issued INV/VND number is never reused.
CREATE TABLE IF NOT EXISTS invoice_sequences (
  direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')),
  sequence_year TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number >= 0),
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(direction,sequence_year)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  item_description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
  unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
  total_price REAL NOT NULL DEFAULT 0 CHECK(total_price >= 0),
  line_type TEXT NOT NULL DEFAULT 'custom' CHECK(line_type IN ('material','fee','custom')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash')),
  financial_status TEXT CHECK(financial_status IS NULL OR financial_status IN ('paid','pending')),
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id,sort_order,id);

CREATE TABLE IF NOT EXISTS invoice_adjustments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  adjusted_by_user_id TEXT,
  adjusted_by_name TEXT NOT NULL,
  adjusted_at TEXT NOT NULL,
  adjusted_at_local TEXT NOT NULL,
  previous_values TEXT NOT NULL,
  new_values TEXT NOT NULL,
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_invoice_adjustments_invoice_time ON invoice_adjustments(invoice_id,adjusted_at DESC);

CREATE TABLE IF NOT EXISTS credit_memo_sequences (
  sequence_year TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number >= 0),
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_credit_memos (
  id TEXT PRIMARY KEY,
  credit_memo_number TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL,
  event_id TEXT,
  memo_type TEXT NOT NULL CHECK(memo_type IN ('EVENT_REFUND','VOID_REVERSAL')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  memo_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  subtotal_amount REAL NOT NULL DEFAULT 0 CHECK(subtotal_amount >= 0),
  tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
  total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
  revenue_effect_date TEXT,
  cash_effect INTEGER NOT NULL DEFAULT 1 CHECK(cash_effect IN (0,1)),
  accounting_effect INTEGER NOT NULL DEFAULT 1 CHECK(accounting_effect IN (0,1)),
  created_by_user_id TEXT,
  created_by_name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type,source_id),
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_memos_invoice_date ON invoice_credit_memos(invoice_id,memo_date DESC);
CREATE INDEX IF NOT EXISTS idx_credit_memos_revenue_effect ON invoice_credit_memos(revenue_effect_date,memo_type);

CREATE TRIGGER IF NOT EXISTS trg_invoices_immutable_delete
BEFORE DELETE ON invoices
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INVOICE_RECORD');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_adjustments_immutable_delete
BEFORE DELETE ON invoice_adjustments
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INVOICE_ADJUSTMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_adjustments_reason_required
BEFORE INSERT ON invoice_adjustments
WHEN length(trim(COALESCE(NEW.reason,''))) < 5
BEGIN
  SELECT RAISE(ABORT,'ADJUSTMENT_REASON_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_adjustments_immutable_update
BEFORE UPDATE ON invoice_adjustments
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_INVOICE_ADJUSTMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_credit_memos_immutable_delete
BEFORE DELETE ON invoice_credit_memos
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_CREDIT_MEMO');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_credit_memos_reason_required
BEFORE INSERT ON invoice_credit_memos
WHEN length(trim(COALESCE(NEW.reason,''))) < 5
BEGIN
  SELECT RAISE(ABORT,'ADJUSTMENT_REASON_REQUIRED');
END;

DROP TRIGGER IF EXISTS trg_invoice_credit_memos_immutable_update;
CREATE TRIGGER trg_invoice_credit_memos_immutable_update
BEFORE UPDATE ON invoice_credit_memos
WHEN NEW.id<>OLD.id OR NEW.credit_memo_number<>OLD.credit_memo_number OR NEW.invoice_id<>OLD.invoice_id OR COALESCE(NEW.event_id,'')<>COALESCE(OLD.event_id,'')
  OR NEW.memo_type<>OLD.memo_type OR NEW.source_type<>OLD.source_type OR NEW.source_id<>OLD.source_id OR NEW.memo_date<>OLD.memo_date OR NEW.reason<>OLD.reason
  OR NEW.subtotal_amount<>OLD.subtotal_amount OR NEW.tax_amount<>OLD.tax_amount OR NEW.total_amount<>OLD.total_amount OR NEW.cash_effect<>OLD.cash_effect OR NEW.accounting_effect<>OLD.accounting_effect
  OR COALESCE(NEW.created_by_user_id,'')<>COALESCE(OLD.created_by_user_id,'') OR NEW.created_by_name<>OLD.created_by_name OR NEW.created_at<>OLD.created_at
  OR (COALESCE(NEW.revenue_effect_date,'')<>COALESCE(OLD.revenue_effect_date,'') AND NOT (
       (OLD.revenue_effect_date IS NULL AND NEW.revenue_effect_date IS NOT NULL)
       OR (OLD.revenue_effect_date IS NOT NULL AND NEW.revenue_effect_date IS NULL
           AND EXISTS(SELECT 1 FROM invoices i WHERE i.id=NEW.invoice_id AND i.revenue_recognition_status='DEFERRED'))
     ))
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_CREDIT_MEMO');
END;

CREATE TABLE IF NOT EXISTS financial_items (
  id TEXT PRIMARY KEY,
  item_date TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  main_type TEXT NOT NULL,
  category TEXT,
  recurrence TEXT NOT NULL DEFAULT 'ONE_TIME',
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method='' OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash')),
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

-- Immutable audit layer for direct financial items. Original rows are preserved;
-- voiding is represented by an effective-dated reversal and a permanent audit record.
CREATE TABLE IF NOT EXISTS financial_item_adjustments (
  id TEXT PRIMARY KEY,
  financial_item_id TEXT NOT NULL,
  adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('UPDATE','VOID','CLOSED_PERIOD_ADJUSTMENT')),
  reason TEXT NOT NULL,
  adjusted_by_user_id TEXT,
  adjusted_by_name TEXT NOT NULL,
  adjusted_at TEXT NOT NULL,
  adjusted_at_local TEXT NOT NULL,
  previous_values TEXT NOT NULL,
  new_values TEXT NOT NULL,
  reversal_item_id TEXT,
  replacement_item_id TEXT,
  FOREIGN KEY(financial_item_id) REFERENCES financial_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(reversal_item_id) REFERENCES financial_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(replacement_item_id) REFERENCES financial_items(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_financial_item_adjustments_item_time ON financial_item_adjustments(financial_item_id,adjusted_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS financial_item_voids (
  financial_item_id TEXT PRIMARY KEY,
  effective_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  voided_by_user_id TEXT,
  voided_by_name TEXT NOT NULL,
  voided_at TEXT NOT NULL,
  voided_at_local TEXT NOT NULL,
  reversal_item_id TEXT NOT NULL,
  FOREIGN KEY(financial_item_id) REFERENCES financial_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(reversal_item_id) REFERENCES financial_items(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_financial_item_voids_effective ON financial_item_voids(effective_date,financial_item_id);

CREATE TRIGGER IF NOT EXISTS trg_financial_item_adjustments_reason_required
BEFORE INSERT ON financial_item_adjustments
WHEN length(trim(COALESCE(NEW.reason,''))) < 5
BEGIN
  SELECT RAISE(ABORT,'ADJUSTMENT_REASON_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS trg_financial_item_adjustments_immutable_update
BEFORE UPDATE ON financial_item_adjustments
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_ITEM_ADJUSTMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_financial_item_adjustments_immutable_delete
BEFORE DELETE ON financial_item_adjustments
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_ITEM_ADJUSTMENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_financial_item_voids_reason_required
BEFORE INSERT ON financial_item_voids
WHEN length(trim(COALESCE(NEW.reason,''))) < 5
BEGIN
  SELECT RAISE(ABORT,'ADJUSTMENT_REASON_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS trg_financial_item_voids_immutable_update
BEFORE UPDATE ON financial_item_voids
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_ITEM_VOID');
END;

CREATE TRIGGER IF NOT EXISTS trg_financial_item_voids_immutable_delete
BEFORE DELETE ON financial_item_voids
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_ITEM_VOID');
END;

-- Operational mirror rows generated from invoices/jobs may still be rebuilt by
-- their source modules. Direct/manual financial records can never be hard-deleted.
CREATE TRIGGER IF NOT EXISTS trg_financial_items_direct_immutable_delete
BEFORE DELETE ON financial_items
WHEN COALESCE(OLD.source_type,'') NOT IN (
  'JOB_REVENUE','DAILY_RATE','TECHNICIAN_EXTRA_COMPENSATION','MANUAL_INVOICE',
  'WORKFLOW_INVOICE_REVENUE','WORKFLOW_INVOICE_MATERIAL',
  'event_payment_refund','event_manual_ticket_refund','event_manual_ticket','event_payment',
  'closed_job','job_close_revenue'
)
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_ITEM');
END;

CREATE TABLE IF NOT EXISTS opening_balance_sets (
  id TEXT PRIMARY KEY,
  effective_date TEXT NOT NULL,
  opening_cash_bank REAL NOT NULL DEFAULT 0,
  opening_accounts_receivable REAL NOT NULL DEFAULT 0,
  opening_accounts_payable REAL NOT NULL DEFAULT 0,
  opening_retained_earnings_equity REAL NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  created_by_name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id TEXT,
  updated_by_name TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opening_balance_items (
  id TEXT PRIMARY KEY,
  opening_balance_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('ASSET','LIABILITY','EQUITY')),
  amount REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(opening_balance_id) REFERENCES opening_balance_sets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_opening_balance_items_set ON opening_balance_items(opening_balance_id,sort_order,id);

CREATE TABLE IF NOT EXISTS financial_statement_snapshots (
  period TEXT PRIMARY KEY,
  period_end TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  closed_at_local TEXT NOT NULL,
  balance_sheet_json TEXT NOT NULL,
  income_statement_json TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'SYSTEM',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_financial_statement_snapshots_immutable_update
BEFORE UPDATE ON financial_statement_snapshots
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_STATEMENT_SNAPSHOT');
END;

CREATE TRIGGER IF NOT EXISTS trg_financial_statement_snapshots_immutable_delete
BEFORE DELETE ON financial_statement_snapshots
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_STATEMENT_SNAPSHOT');
END;

-- Once the first official live period (2026-08) has been closed, the opening
-- position becomes part of the immutable accounting history. Any later capital
-- correction must be posted into the current open period instead of rewriting
-- the opening balance.
CREATE TRIGGER IF NOT EXISTS trg_opening_balance_sets_period_lock_insert
BEFORE INSERT ON opening_balance_sets
WHEN EXISTS(SELECT 1 FROM financial_statement_snapshots WHERE period='2026-08')
BEGIN
  SELECT RAISE(ABORT,'OPENING_BALANCE_LOCKED');
END;

CREATE TRIGGER IF NOT EXISTS trg_opening_balance_sets_period_lock_update
BEFORE UPDATE ON opening_balance_sets
WHEN EXISTS(SELECT 1 FROM financial_statement_snapshots WHERE period='2026-08')
BEGIN
  SELECT RAISE(ABORT,'OPENING_BALANCE_LOCKED');
END;

CREATE TRIGGER IF NOT EXISTS trg_opening_balance_sets_period_lock_delete
BEFORE DELETE ON opening_balance_sets
WHEN EXISTS(SELECT 1 FROM financial_statement_snapshots WHERE period='2026-08')
BEGIN
  SELECT RAISE(ABORT,'OPENING_BALANCE_LOCKED');
END;

CREATE TRIGGER IF NOT EXISTS trg_opening_balance_items_period_lock_insert
BEFORE INSERT ON opening_balance_items
WHEN EXISTS(SELECT 1 FROM financial_statement_snapshots WHERE period='2026-08')
BEGIN
  SELECT RAISE(ABORT,'OPENING_BALANCE_LOCKED');
END;

CREATE TRIGGER IF NOT EXISTS trg_opening_balance_items_period_lock_update
BEFORE UPDATE ON opening_balance_items
WHEN EXISTS(SELECT 1 FROM financial_statement_snapshots WHERE period='2026-08')
BEGIN
  SELECT RAISE(ABORT,'OPENING_BALANCE_LOCKED');
END;

CREATE TRIGGER IF NOT EXISTS trg_opening_balance_items_period_lock_delete
BEFORE DELETE ON opening_balance_items
WHEN EXISTS(SELECT 1 FROM financial_statement_snapshots WHERE period='2026-08')
BEGIN
  SELECT RAISE(ABORT,'OPENING_BALANCE_LOCKED');
END;

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
  reserved_quantity REAL DEFAULT 0,
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
  created_by_user_id TEXT,
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
  workflow_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Workshop workflow: new operational work is intentionally separate from the
-- legacy jobs table. Existing jobs remain historical records and are not
-- retroactively classified as workshop workflows.
CREATE TABLE IF NOT EXISTS workflow_stage_definitions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_hu TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workshop_workflows (
  id TEXT PRIMARY KEY,
  workflow_key TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  piano_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('INBOUND','ON_SITE')),
  planned_job_id TEXT,
  job_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  due_time TEXT,
  intake_inspection_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(intake_inspection_status IN ('PENDING','FLAWLESS','PRE_EXISTING_DAMAGE')),
  intake_pdf_path TEXT,
  intake_photos TEXT NOT NULL DEFAULT '[]',
  intake_inspected_by TEXT,
  intake_inspected_at TEXT,
  dispatch_inspection_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(dispatch_inspection_status IN ('PENDING','APPROVED','ISSUE_FOUND')),
  dispatch_pdf_path TEXT,
  dispatch_inspected_by TEXT,
  dispatch_inspected_at TEXT,
  current_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(current_status IN ('ACTIVE','COMPLETED','ABORTED')),
  financial_status TEXT NOT NULL DEFAULT 'OPEN' CHECK(financial_status IN ('OPEN','CLOSED')),
  final_due_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  current_location TEXT,
  transport_address TEXT,
  transport_responsible_user_id TEXT,
  transport_responsible_name TEXT,
  transport_note TEXT,
  final_handover_type TEXT NOT NULL DEFAULT 'DELIVERY' CHECK(final_handover_type IN ('DELIVERY','ON_SITE')),
  financial_closed_at TEXT,
  financial_closed_by_user_id TEXT,
  financial_closure_reason TEXT,
  billing_status TEXT NOT NULL DEFAULT 'Unbilled' CHECK(billing_status IN ('Unbilled','Billed')),
  invoice_id TEXT,
  aborted_at TEXT,
  aborted_by_user_id TEXT,
  abort_reason TEXT,
  created_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE RESTRICT,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE RESTRICT,
  FOREIGN KEY(transport_responsible_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(financial_closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(aborted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(planned_job_id) REFERENCES planned_jobs(id) ON DELETE SET NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_stages (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  stage_code TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  name_snapshot_en TEXT NOT NULL,
  name_snapshot_hu TEXT NOT NULL,
  card_title TEXT,
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK(status IN ('WAITING','IN_PROGRESS','COMPLETED','BLOCKED','NOT_REQUIRED','ABORTED')),
  assigned_user_id TEXT,
  assigned_to TEXT,
  due_at TEXT,
  details TEXT,
  notes TEXT,
  block_reason TEXT,
  delay_reason TEXT,
  financial_status TEXT NOT NULL DEFAULT 'OPEN' CHECK(financial_status IN ('OPEN','CLOSED')),
  financial_closed_at TEXT,
  financial_closed_by_user_id TEXT,
  financial_closure_reason TEXT,
  preliminary_inspection TEXT CHECK(preliminary_inspection IN ('DONE','NOT_DONE','NOT_REQUIRED') OR preliminary_inspection IS NULL),
  preliminary_assessment TEXT CHECK(preliminary_assessment IN ('DONE','NOT_DONE','NOT_REQUIRED') OR preliminary_assessment IS NULL),
  preliminary_quote TEXT CHECK(preliminary_quote IN ('DONE','NOT_DONE','NOT_REQUIRED') OR preliminary_quote IS NULL),
  preliminary_meeting TEXT CHECK(preliminary_meeting IN ('DONE','NOT_DONE','NOT_REQUIRED') OR preliminary_meeting IS NULL),
  preliminary_quote_amount REAL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workflow_id,stage_code),
  FOREIGN KEY(workflow_id) REFERENCES workshop_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(financial_closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workshop_subtasks (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workshop_workflows(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_custom INTEGER NOT NULL DEFAULT 0 CHECK(is_custom IN (0,1)),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED','DELAYED')),
  assigned_to_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  delay_reason TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_subtasks_stage ON workshop_subtasks(stage_id,position,id);
CREATE INDEX IF NOT EXISTS idx_subtasks_workflow ON workshop_subtasks(workflow_id,stage_id);

CREATE TABLE IF NOT EXISTS workflow_stage_transfers (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  from_user_id TEXT,
  to_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  transferred_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workshop_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE,
  FOREIGN KEY(from_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(to_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(transferred_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_materials (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  stage_id TEXT,
  source_type TEXT NOT NULL CHECK(source_type IN ('CENTRAL_INVENTORY','OWN_STOCK','EXTERNAL_PURCHASE','CLIENT_SUPPLIED','NO_MATERIAL_COST')),
  inventory_item_id TEXT,
  item_name TEXT NOT NULL,
  requested_quantity REAL NOT NULL DEFAULT 0,
  consumed_quantity REAL NOT NULL DEFAULT 0,
  unit TEXT,
  unit_cost REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','RESERVED','CONSUMED','RELEASED')),
  notes TEXT,
  document_path TEXT,
  created_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workshop_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE SET NULL,
  FOREIGN KEY(inventory_item_id) REFERENCES inventory_items(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_financial_lines (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  stage_id TEXT,
  line_type TEXT NOT NULL CHECK(line_type IN ('REVENUE','COST')),
  category TEXT NOT NULL CHECK(category IN ('LABOR','MATERIAL','TRANSPORT','PURCHASE','CONTRACTOR','OTHER')),
  title TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  billing_status TEXT NOT NULL DEFAULT 'CHARGEABLE' CHECK(billing_status IN ('CHARGEABLE','WARRANTY','FREE','COMPENSATION','CREDIT')),
  partner_id TEXT,
  payable_invoice_id TEXT,
  posted_financial_item_id TEXT,
  created_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workshop_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE SET NULL,
  FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE SET NULL,
  FOREIGN KEY(payable_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  FOREIGN KEY(posted_financial_item_id) REFERENCES financial_items(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_documents (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  stage_id TEXT,
  document_path TEXT NOT NULL,
  document_name TEXT,
  document_type TEXT,
  created_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workshop_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_closed_jobs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  piano_id TEXT NOT NULL,
  final_due_at TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  closed_by_user_id TEXT NOT NULL,
  closure_reason TEXT,
  revenue_total REAL NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  net_total REAL NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(workflow_id) REFERENCES workshop_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE RESTRICT,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE RESTRICT,
  FOREIGN KEY(closed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);


CREATE TABLE IF NOT EXISTS piano_inspection_history (
  id TEXT PRIMARY KEY,
  piano_id TEXT NOT NULL,
  workflow_id TEXT,
  inspection_type TEXT NOT NULL CHECK(inspection_type IN ('INTAKE','DISPATCH','DAMAGE_PHOTO')),
  inspection_status TEXT,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  inspected_by TEXT,
  inspected_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE CASCADE,
  FOREIGN KEY(workflow_id) REFERENCES workshop_workflows(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_piano_inspection_history_piano ON piano_inspection_history(piano_id,inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_piano_inspection_history_workflow ON piano_inspection_history(workflow_id,inspection_type);
CREATE INDEX IF NOT EXISTS idx_jobs_workshop_workflow ON jobs(workshop_workflow_id);

CREATE TABLE IF NOT EXISTS workflow_audit_events (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  actor_user_id TEXT,
  snapshot_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workshop_workflows(id) ON DELETE SET NULL,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_status_due ON workshop_workflows(current_status,final_due_at);
CREATE INDEX IF NOT EXISTS idx_workflow_client_piano ON workshop_workflows(client_id,piano_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_workflow_order ON workflow_stages(workflow_id,stage_order);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_assignee ON workflow_stages(assigned_user_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_stage_transfers_wf_stg ON workflow_stage_transfers(workflow_id,stage_id);
CREATE INDEX IF NOT EXISTS idx_workflow_material_inventory ON workflow_materials(inventory_item_id,status);
CREATE INDEX IF NOT EXISTS idx_workflow_financial_workflow ON workflow_financial_lines(workflow_id,stage_id);
CREATE INDEX IF NOT EXISTS idx_workflow_documents_workflow ON workflow_documents(workflow_id,stage_id);
CREATE INDEX IF NOT EXISTS idx_workflow_audit_workflow ON workflow_audit_events(workflow_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_client_id ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_piano_id ON jobs(piano_id);
CREATE INDEX IF NOT EXISTS idx_jobs_contact_id ON jobs(contact_id);
CREATE INDEX IF NOT EXISTS idx_jobs_parent_id ON jobs(parent_job_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id);


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
CREATE TABLE IF NOT EXISTS notification_snooze_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('CLIENT_FOLLOWUP','WORKFLOW_STAGE','CALENDAR_JOB')),
  entity_id TEXT NOT NULL,
  snoozed_until TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_snooze_user_entity ON notification_snooze_log(user_id,entity_type,entity_id);
CREATE INDEX IF NOT EXISTS idx_notification_snooze_active ON notification_snooze_log(user_id,entity_type,entity_id,snoozed_until);

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
