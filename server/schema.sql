PRAGMA foreign_keys = ON;

-- ============================================================================
-- KLAVIERHAUS ERP ROUND 1
-- Preserved: authentication/user storage and the public website/CMS contract.
-- Removed from the active schema: legacy workshop, planner, inventory and
-- accounting workspaces. Event/public-site storage remains because website/
-- consumes those public APIs directly.
-- ============================================================================

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

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(role,permission)
);

-- ============================================================================
-- INTERNAL ERP DOMAIN: CLIENTS + PIANOS + INTAKE + ROUND 2 JOBS
-- ============================================================================
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pianos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  brand TEXT NOT NULL,
  model TEXT,
  serial_number TEXT,
  finish TEXT,
  location_notes TEXT,
  last_serviced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS intake_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  piano_id INTEGER,
  raw_client_name TEXT,
  raw_contact TEXT,
  service_location TEXT NOT NULL DEFAULT 'workshop' CHECK(service_location IN ('workshop','on_site')),
  reported_issue TEXT NOT NULL,
  estimated_urgency TEXT NOT NULL DEFAULT 'normal' CHECK(estimated_urgency IN ('low','normal','urgent')),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','converted','archived')),
  assigned_technician_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  converted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (piano_id) REFERENCES pianos(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_technician_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_code TEXT UNIQUE,
  client_id INTEGER NOT NULL,
  piano_id INTEGER NOT NULL,
  intake_lead_id INTEGER UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  service_location TEXT NOT NULL DEFAULT 'workshop' CHECK(service_location IN ('workshop','on_site')),
  service_address TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','urgent')),
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','scheduled','in_progress','blocked','ready_for_closeout')),
  assigned_technician_id TEXT,
  scheduled_start TEXT,
  scheduled_end TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  blocked_reason TEXT,
  internal_notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  ready_for_closeout_at TEXT,
  closed_at TEXT,
  closed_by_user_id TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  FOREIGN KEY (piano_id) REFERENCES pianos(id) ON DELETE RESTRICT,
  FOREIGN KEY (intake_lead_id) REFERENCES intake_leads(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_technician_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((scheduled_start IS NULL AND scheduled_end IS NULL) OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL))
);

-- ============================================================================
-- ROUND 3: JOB CLOSEOUT + INVOICE DISPATCHER + SIMPLE FINANCE
-- ============================================================================
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partner_contractors (
  partner_id INTEGER NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (partner_id,user_id),
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')),
  sequence_year INTEGER NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0 CHECK(last_value >= 0),
  PRIMARY KEY (direction,sequence_year)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')),
  status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','partial','paid','void')),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('job','manual')),
  source_id TEXT,
  job_id INTEGER UNIQUE,
  client_id INTEGER,
  partner_id INTEGER,
  counterparty_name TEXT NOT NULL,
  counterparty_contact TEXT,
  counterparty_email TEXT,
  counterparty_phone TEXT,
  counterparty_address TEXT,
  counterparty_tax_id TEXT,
  summary TEXT NOT NULL,
  notes TEXT,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
  tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0 AND tax_rate <= 100),
  subtotal REAL NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
  tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
  total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
  paid_amount REAL NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
  balance_due REAL NOT NULL DEFAULT 0 CHECK(balance_due >= 0),
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method IN ('Cash','Check','Zelle','Bank Transfer / ACH','Credit Card')),
  paid_at TEXT,
  voided_at TEXT,
  voided_by_user_id TEXT,
  void_reason TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT,
  FOREIGN KEY (voided_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((direction='receivable' AND client_id IS NOT NULL AND partner_id IS NULL) OR (direction='payable' AND partner_id IS NOT NULL AND client_id IS NULL))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  item_description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
  unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
  total_price REAL NOT NULL DEFAULT 0 CHECK(total_price >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash','Check','Zelle','Bank Transfer / ACH','Credit Card')),
  reference TEXT,
  paid_at TEXT NOT NULL,
  notes TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_partners_name ON partners(lower(company_name),status);
CREATE INDEX IF NOT EXISTS idx_partner_contractors_user ON partner_contractors(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_direction_status ON invoices(direction,status,issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id,issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_partner ON invoices(partner_id,issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id,sort_order,id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id,paid_at,id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_date ON invoice_payments(paid_at,payment_method);
CREATE INDEX IF NOT EXISTS idx_jobs_closed ON jobs(closed_at,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_piano ON jobs(piano_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_intake ON jobs(intake_lead_id);
CREATE INDEX IF NOT EXISTS idx_jobs_technician_schedule ON jobs(assigned_technician_id,scheduled_start,scheduled_end);
CREATE INDEX IF NOT EXISTS idx_jobs_calendar ON jobs(scheduled_start,scheduled_end,status);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(lower(name));
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(lower(email));
CREATE INDEX IF NOT EXISTS idx_pianos_client ON pianos(client_id);
CREATE INDEX IF NOT EXISTS idx_pianos_serial ON pianos(serial_number);
CREATE INDEX IF NOT EXISTS idx_intake_status ON intake_leads(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_client ON intake_leads(client_id);
CREATE INDEX IF NOT EXISTS idx_intake_technician ON intake_leads(assigned_technician_id,status);

-- Preserved website/event indexes plus explicit public read-path indexes.
CREATE INDEX IF NOT EXISTS idx_audit_type_time ON audit_log(audit_type,event_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_public_round1 ON events(status,start_at,published_at);
CREATE INDEX IF NOT EXISTS idx_event_tickets_round1 ON event_tickets(event_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_event_invitations_round1 ON event_invitations(event_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_customer_messages_round1 ON customer_messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_customer_attachments_round1 ON customer_message_attachments(conversation_id,message_id);
CREATE INDEX IF NOT EXISTS idx_website_content_versions_round1 ON website_content_versions(page_key,language,version DESC);
CREATE INDEX IF NOT EXISTS idx_website_tracking_round1 ON website_tracking_events(event_name,created_at DESC);
