
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','MANAGER','WORKER')),
  status TEXT DEFAULT 'Active',
  phone TEXT,
  address TEXT,
  calendar_color TEXT,
  google_calendar_email TEXT,
  contact_email TEXT,
  hidden_user INTEGER DEFAULT 0,
  is_superadmin INTEGER DEFAULT 0,
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
  planned_job_id TEXT,
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
  access_type TEXT NOT NULL CHECK(access_type IN ('PUBLIC_PAID','PUBLIC_FREE','INVITE_ONLY','INTERNAL')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','RESCHEDULED','CANCELLED','COMPLETED','CLOSED')),
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
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  sales_start_at TEXT,
  sales_end_at TEXT,
  refund_policy_version TEXT NOT NULL DEFAULT 'KH-48H-V1',
  published_at TEXT,
  closed_at TEXT,
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
  source_type TEXT NOT NULL CHECK(source_type IN ('INVITATION','COMPLIMENTARY','PURCHASE')),
  buyer_name TEXT,
  attendee_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  public_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'VALID' CHECK(status IN ('VALID','USED','VOID','REFUNDED')),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  event_payment_id TEXT,
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
