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
  manager_scope TEXT CHECK(manager_scope IS NULL OR manager_scope IN ('INSIDE','OUTSIDE')),
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
  theme_preference TEXT NOT NULL DEFAULT 'dark' CHECK(theme_preference IN ('dark','light')),
  language_preference TEXT NOT NULL DEFAULT 'en' CHECK(language_preference IN ('en','hu')),
  profile_image_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_hu TEXT,
  description_en TEXT,
  description_hu TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_skills_active_order ON staff_skills(active,sort_order,lower(name_en),id);

CREATE TABLE IF NOT EXISTS user_staff_skills (
  user_id TEXT NOT NULL,
  skill_id INTEGER NOT NULL,
  assigned_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,skill_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(skill_id) REFERENCES staff_skills(id) ON DELETE CASCADE,
  FOREIGN KEY(assigned_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_user_staff_skills_skill ON user_staff_skills(skill_id,user_id);

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

CREATE TABLE IF NOT EXISTS customer_conversations (
  id TEXT PRIMARY KEY,
  public_token_hash TEXT NOT NULL UNIQUE,
  public_token_encrypted TEXT,
  visitor_token_hash TEXT,
  name TEXT,
  email TEXT,
  client_id INTEGER,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  category TEXT NOT NULL CHECK(category IN ('SERVICE','PIANO','REFUND','PRIVATE_CONSULTATION','TECHNICAL','BILLING','REPAIR','GENERAL','OTHER')),
  service_id TEXT,
  piano_id TEXT,
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
  activity_cycle INTEGER NOT NULL DEFAULT 1 CHECK(activity_cycle >= 1),
  last_notified_activity_cycle INTEGER NOT NULL DEFAULT 0 CHECK(last_notified_activity_cycle >= 0),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(service_id) REFERENCES website_services(id) ON DELETE SET NULL,
  FOREIGN KEY(piano_id) REFERENCES website_showroom_pianos(id) ON DELETE SET NULL,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
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
  message_type TEXT NOT NULL DEFAULT 'TEXT',
  metadata_json TEXT NOT NULL DEFAULT '{}',
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

CREATE INDEX IF NOT EXISTS idx_customer_message_attachments_message ON customer_message_attachments(message_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_customer_message_attachments_conversation ON customer_message_attachments(conversation_id,created_at,id);

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

CREATE TABLE IF NOT EXISTS customer_appointment_proposals (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  appointment_type TEXT NOT NULL CHECK(appointment_type IN ('PRIVATE_VISIT','PIANO_VIEWING','SERVICE_CONSULTATION')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  assigned_user_id TEXT,
  phone TEXT,
  appointment_reason TEXT NOT NULL DEFAULT 'OTHER' CHECK(appointment_reason IN ('PIANO_VIEWING','SERVICE_REQUEST','OTHER')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','ACCEPTED','DECLINED','CANCELLED')),
  private_appointment_id TEXT,
  created_by_user_id TEXT,
  responded_at TEXT,
  expires_at TEXT,
  finalized_at TEXT,
  finalized_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES customer_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(private_appointment_id) REFERENCES private_appointments(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(finalized_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_appointment_proposals_conversation ON customer_appointment_proposals(conversation_id,created_at DESC);

CREATE TABLE IF NOT EXISTS support_holidays (
  holiday_date TEXT PRIMARY KEY,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_conversations_status_activity ON customer_conversations(status,last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_conversations_resume ON customer_conversations(email,category,name,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_conversations_assignee ON customer_conversations(assigned_user_id,status,last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_messages_conversation_time ON customer_messages(conversation_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_customer_messages_conversation_state ON customer_messages(conversation_id,direction,status,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS milestone_dashboard (
  id INTEGER PRIMARY KEY CHECK(id=1),
  title_en TEXT NOT NULL DEFAULT 'Road to One Million',
  title_hu TEXT NOT NULL DEFAULT 'Út az egymillióhoz',
  quote_en TEXT,
  quote_hu TEXT,
  start_date TEXT,
  end_date TEXT,
  target_label TEXT,
  hero_media_url TEXT,
  hero_icon TEXT,
  reference_code TEXT NOT NULL DEFAULT 'GROWTH ROADMAP',
  subtitle_en TEXT NOT NULL DEFAULT 'Track the company milestones, projects and next actions that lead Klavierhaus to its next growth target.',
  subtitle_hu TEXT NOT NULL DEFAULT 'Kövesd a Klavierhaus következő növekedési céljához vezető vállalati mérföldköveket, projekteket és feladatokat.',
  client_name TEXT,
  client_type TEXT,
  client_contact TEXT,
  location_label TEXT,
  scheduled_label TEXT,
  status_label TEXT NOT NULL DEFAULT 'In Progress',
  instrument_name TEXT,
  instrument_serial TEXT,
  instrument_year TEXT,
  instrument_media_url TEXT,
  schedule_range TEXT,
  delivery_estimate TEXT,
  craft_title_en TEXT NOT NULL DEFAULT 'Exceptional Pianos. Lasting Legacies.',
  craft_title_hu TEXT NOT NULL DEFAULT 'Kivételes zongorák. Maradandó örökség.',
  craft_body_en TEXT NOT NULL DEFAULT 'Precision service for extraordinary instruments.',
  craft_body_hu TEXT NOT NULL DEFAULT 'Precíz szerviz kivételes hangszerekhez.',
  craft_media_url TEXT,
  quote_media_url TEXT,
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS milestone_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_en TEXT NOT NULL,
  title_hu TEXT,
  description_en TEXT,
  description_hu TEXT,
  target_date TEXT,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  completed_at TEXT,
  icon TEXT,
  media_url TEXT,
  uid TEXT UNIQUE,
  parent_uid TEXT,
  step_kind TEXT NOT NULL DEFAULT 'major' CHECK(step_kind IN ('major','minor')),
  link_view TEXT,
  link_record_id TEXT,
  color_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_milestone_steps_order ON milestone_steps(sort_order,id);
CREATE INDEX IF NOT EXISTS idx_milestone_steps_parent ON milestone_steps(parent_uid,step_kind,sort_order,id);

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
  visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
  gallery_json TEXT NOT NULL DEFAULT '[]',
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
  lead_type TEXT NOT NULL DEFAULT 'SERVICE_CALLBACK' CHECK(lead_type IN ('SERVICE_CALLBACK','PRIVATE_CONSULTATION','GENERAL_CONTACT')),
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

CREATE TABLE IF NOT EXISTS private_appointments (
  id TEXT PRIMARY KEY,
  appointment_type TEXT NOT NULL CHECK(appointment_type IN ('PRIVATE_VISIT','PIANO_VIEWING','SERVICE_CONSULTATION')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  appointment_reason TEXT NOT NULL DEFAULT 'OTHER' CHECK(appointment_reason IN ('PIANO_VIEWING','SERVICE_REQUEST','OTHER')),
  scheduled_at TEXT NOT NULL,
  scheduled_end_at TEXT,
  duration_min INTEGER NOT NULL DEFAULT 60 CHECK(duration_min >= 15 AND duration_min <= 480),
  note TEXT,
  conversation_id TEXT,
  client_id INTEGER,
  piano_id TEXT,
  service_id TEXT,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','COMPLETED','CANCELLED')),
  assigned_user_id TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  source_path TEXT,
  created_source TEXT NOT NULL DEFAULT 'PUBLIC' CHECK(created_source IN ('PUBLIC','ERP')),
  created_by_user_id TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(piano_id) REFERENCES website_showroom_pianos(id) ON DELETE SET NULL,
  FOREIGN KEY(service_id) REFERENCES website_services(id) ON DELETE SET NULL,
  FOREIGN KEY(conversation_id) REFERENCES customer_conversations(id) ON DELETE SET NULL,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_private_appointments_time ON private_appointments(scheduled_at,status);
CREATE INDEX IF NOT EXISTS idx_private_appointments_context ON private_appointments(appointment_type,piano_id,service_id);
CREATE INDEX IF NOT EXISTS idx_private_appointments_conversation ON private_appointments(conversation_id,scheduled_at);

CREATE TABLE IF NOT EXISTS private_appointment_requests (
  id TEXT PRIMARY KEY,
  appointment_type TEXT NOT NULL CHECK(appointment_type IN ('PRIVATE_VISIT','PIANO_VIEWING','SERVICE_CONSULTATION')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  appointment_reason TEXT NOT NULL DEFAULT 'OTHER' CHECK(appointment_reason IN ('PIANO_VIEWING','SERVICE_REQUEST','OTHER')),
  requested_at TEXT NOT NULL,
  requested_duration_min INTEGER NOT NULL DEFAULT 60 CHECK(requested_duration_min >= 15 AND requested_duration_min <= 480),
  note TEXT,
  piano_id TEXT,
  service_id TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','PROPOSED','APPROVED','DECLINED','CANCELLED')),
  assigned_user_id TEXT,
  conversation_id TEXT,
  client_id INTEGER,
  proposal_id TEXT,
  private_appointment_id TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  source_path TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(piano_id) REFERENCES website_showroom_pianos(id) ON DELETE SET NULL,
  FOREIGN KEY(service_id) REFERENCES website_services(id) ON DELETE SET NULL,
  FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(conversation_id) REFERENCES customer_conversations(id) ON DELETE SET NULL,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(proposal_id) REFERENCES customer_appointment_proposals(id) ON DELETE SET NULL,
  FOREIGN KEY(private_appointment_id) REFERENCES private_appointments(id) ON DELETE SET NULL,
  FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_private_appointment_requests_status ON private_appointment_requests(status,requested_at,created_at);

CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_hu TEXT NOT NULL,
  body_en TEXT NOT NULL DEFAULT '',
  body_hu TEXT NOT NULL DEFAULT '',
  action_url TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK(severity IN ('INFO','SUCCESS','WARNING','URGENT')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_events_entity ON notification_events(entity_type,entity_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_events_open ON notification_events(resolved_at,created_at DESC);

CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT,
  snoozed_until TEXT,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(notification_id,user_id),
  FOREIGN KEY(notification_id) REFERENCES notification_events(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notification_recipient_active ON notification_recipients(user_id,acknowledged_at,snoozed_until);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,
  notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK(notifications_enabled IN (0,1)),
  sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(sound_enabled IN (0,1)),
  disabled_by_user_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(disabled_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TEXT,
  last_error TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

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

-- One-way Google Calendar -> ERP integration. OAuth tokens are encrypted
-- before persistence; imported source events remain auditable after review.
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
  job_id INTEGER,
  review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW'
    CHECK(review_status IN ('NEEDS_REVIEW','REVIEWED','SOURCE_CHANGED','SOURCE_CANCELLED','INVALID','IGNORED')),
  conflict_flag INTEGER NOT NULL DEFAULT 0 CHECK(conflict_flag IN (0,1)),
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
CREATE INDEX IF NOT EXISTS idx_external_calendar_events_job ON external_calendar_events(job_id);
CREATE INDEX IF NOT EXISTS idx_external_calendar_events_review ON external_calendar_events(provider,review_status,source_updated_at);

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


CREATE TABLE IF NOT EXISTS website_backups (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all','pages','collections','branding')),
  trigger_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK(trigger_type IN ('MANUAL','PRE_RESET','PRE_RESTORE')),
  label TEXT,
  file_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_website_backups_created ON website_backups(created_at DESC,id DESC);

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
  metadata_json TEXT NOT NULL DEFAULT '{}',
  analytics_consent INTEGER NOT NULL DEFAULT 0 CHECK(analytics_consent IN (0,1)),
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK(marketing_consent IN (0,1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

CREATE INDEX IF NOT EXISTS idx_audit_module_record_time ON audit_log(module,record_id,event_time,id);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(role,permission)
);

-- ============================================================================
-- INTERNAL ERP DOMAIN: 6-MODULE COMPLIANCE MODEL
-- ============================================================================
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  company_name TEXT,
  contact_name TEXT,
  email TEXT,
  mobile_phone TEXT,
  line_phone TEXT,
  phone TEXT,
  street TEXT,
  city TEXT,
  district TEXT,
  postcode TEXT,
  country TEXT,
  address TEXT,
  notes TEXT,
  short_memo_to_name TEXT,
  last_visit TEXT,
  last_contacted_at TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK(preferred_language IN ('en','hu')),
  client_type TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK(client_type IN ('INDIVIDUAL','PARTNER','BUSINESS','INSTITUTION')),
  is_vip INTEGER NOT NULL DEFAULT 0 CHECK(is_vip IN (0,1)),
  vip_updated_by_user_id TEXT,
  vip_updated_at TEXT,
  deleted_at TEXT,
  deleted_by_user_id TEXT,
  archive_document_id INTEGER,
  deletion_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clients_active_name ON clients(deleted_at,lower(name),id);
CREATE INDEX IF NOT EXISTS idx_clients_active_type_vip ON clients(deleted_at,client_type,is_vip,id);

CREATE TABLE IF NOT EXISTS pianos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  category TEXT,
  brand TEXT NOT NULL DEFAULT 'No brand',
  model TEXT,
  serial_number TEXT,
  finish TEXT,
  location_address TEXT,
  location_notes TEXT,
  last_serviced_at TEXT,
  last_service_title TEXT,
  last_service_description TEXT,
  next_service_date TEXT,
  date_of_purchase TEXT,
  warranty TEXT,
  latest_info_frequency TEXT,
  latest_info_humidity TEXT,
  latest_info_temperature TEXT,
  build_year INTEGER CHECK(build_year IS NULL OR build_year BETWEEN 1700 AND 2100),
  size_display TEXT,
  color TEXT,
  notes TEXT,
  classification_status TEXT NOT NULL DEFAULT 'CLASSIFIED' CHECK(classification_status IN ('CLASSIFIED','REVIEW_REQUIRED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pianos_client_classification ON pianos(client_id,classification_status);
CREATE INDEX IF NOT EXISTS idx_pianos_serial ON pianos(serial_number);
CREATE INDEX IF NOT EXISTS idx_pianos_brand_model ON pianos(lower(COALESCE(brand,'No brand')),lower(COALESCE(model,'')),id);

CREATE TABLE IF NOT EXISTS client_piano_review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  piano_id INTEGER,
  source_name TEXT NOT NULL DEFAULT 'EXISTING_DB',
  source_instrument_id TEXT,
  source_brand TEXT,
  source_model TEXT,
  source_serial_number TEXT,
  source_build_year INTEGER,
  source_note TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RESOLVED','DISMISSED')),
  resolved_piano_id INTEGER,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_name,source_instrument_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (piano_id) REFERENCES pianos(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_piano_id) REFERENCES pianos(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_client_piano_review_client ON client_piano_review_queue(client_id,status,id);
CREATE INDEX IF NOT EXISTS idx_client_piano_review_piano ON client_piano_review_queue(piano_id,status);

CREATE TABLE IF NOT EXISTS master_data_client_source_map (
  source_name TEXT NOT NULL,
  source_client_id TEXT NOT NULL,
  client_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_name,source_client_id),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_master_data_client_source_map_client ON master_data_client_source_map(client_id,source_name,source_client_id);

CREATE TABLE IF NOT EXISTS master_data_piano_source_map (
  source_name TEXT NOT NULL,
  source_instrument_id TEXT NOT NULL,
  piano_id INTEGER,
  review_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_name,source_instrument_id),
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE CASCADE,
  FOREIGN KEY(review_id) REFERENCES client_piano_review_queue(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_master_data_piano_source_map_piano ON master_data_piano_source_map(piano_id,source_name,source_instrument_id);

CREATE TABLE IF NOT EXISTS master_data_import_rows (
  source_name TEXT NOT NULL,
  source_instrument_id TEXT NOT NULL,
  source_client_id TEXT,
  source_row_number INTEGER NOT NULL,
  client_id INTEGER,
  piano_id INTEGER,
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_name,source_instrument_id),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_master_data_import_client ON master_data_import_rows(client_id,source_name);
CREATE INDEX IF NOT EXISTS idx_master_data_import_piano ON master_data_import_rows(piano_id,source_name);

CREATE TABLE IF NOT EXISTS master_data_source_rows (
  source_name TEXT NOT NULL,
  source_row_number INTEGER NOT NULL,
  source_instrument_id TEXT,
  source_client_id TEXT,
  client_id INTEGER,
  piano_id INTEGER,
  raw_json TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  nonempty_cell_count INTEGER NOT NULL DEFAULT 0 CHECK(nonempty_cell_count >= 0),
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_name,source_row_number),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_master_data_source_rows_client ON master_data_source_rows(source_name,source_client_id,source_row_number);
CREATE INDEX IF NOT EXISTS idx_master_data_source_rows_instrument ON master_data_source_rows(source_name,source_instrument_id,source_row_number);
CREATE INDEX IF NOT EXISTS idx_master_data_source_rows_client_id ON master_data_source_rows(client_id,source_row_number,imported_at);

CREATE TABLE IF NOT EXISTS master_data_client_field_values (
  source_name TEXT NOT NULL,
  source_client_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value TEXT NOT NULL,
  first_source_row INTEGER NOT NULL,
  last_source_row INTEGER NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK(occurrences > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_name,source_client_id,field_name,value)
);
CREATE INDEX IF NOT EXISTS idx_master_data_client_field_values_client ON master_data_client_field_values(source_name,source_client_id,field_name);


CREATE TABLE IF NOT EXISTS client_duplicate_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_key TEXT NOT NULL UNIQUE,
  client_a_id INTEGER NOT NULL,
  client_b_id INTEGER NOT NULL,
  signature TEXT NOT NULL,
  match_fields_json TEXT NOT NULL DEFAULT '[]',
  match_count INTEGER NOT NULL DEFAULT 0 CHECK(match_count >= 0),
  match_score INTEGER NOT NULL DEFAULT 0 CHECK(match_score >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','REVIEW_LATER','NOT_DUPLICATE','MERGED','CLEARED')),
  primary_client_id INTEGER,
  archived_client_id INTEGER,
  archive_document_id INTEGER,
  resolution_note TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_a_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (client_b_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (primary_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (archived_client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_client_duplicate_reviews_status_score ON client_duplicate_reviews(status,match_score DESC,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_client_duplicate_reviews_clients ON client_duplicate_reviews(client_a_id,client_b_id,status);

CREATE TABLE IF NOT EXISTS intake_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  piano_id INTEGER,
  raw_client_name TEXT,
  raw_contact TEXT,
  service_location TEXT NOT NULL DEFAULT 'workshop' CHECK(service_location IN ('workshop','on_site')),
  reported_issue TEXT NOT NULL,
  media_urls TEXT NOT NULL DEFAULT '[]',
  estimated_urgency TEXT NOT NULL DEFAULT 'normal' CHECK(estimated_urgency IN ('low','normal','urgent')),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','under_review','converted','archived')),
  assigned_technician_id TEXT,
  estimated_total REAL NOT NULL DEFAULT 0 CHECK(estimated_total >= 0),
  source_conversation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  converted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (piano_id) REFERENCES pianos(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_technician_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_intake_status_created ON intake_leads(status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_intake_source_conversation ON intake_leads(source_conversation_id,id DESC);

CREATE TABLE IF NOT EXISTS intake_catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_hu TEXT NOT NULL,
  description_en TEXT,
  description_hu TEXT,
  default_price REAL NOT NULL DEFAULT 0 CHECK(default_price >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS handoff_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_en TEXT NOT NULL,
  title_hu TEXT NOT NULL,
  default_labor_cost REAL NOT NULL DEFAULT 0 CHECK(default_labor_cost >= 0),
  default_material_cost REAL NOT NULL DEFAULT 0 CHECK(default_material_cost >= 0),
  default_duration_min INTEGER NOT NULL DEFAULT 0 CHECK(default_duration_min >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_hu TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  quantity_on_hand REAL NOT NULL DEFAULT 0 CHECK(quantity_on_hand >= 0),
  reorder_point REAL NOT NULL DEFAULT 0 CHECK(reorder_point >= 0),
  reorder_quantity REAL NOT NULL DEFAULT 1 CHECK(reorder_quantity > 0),
  unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS handoff_preset_materials (
  preset_id INTEGER NOT NULL,
  inventory_item_id INTEGER NOT NULL,
  default_quantity REAL NOT NULL CHECK(default_quantity > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (preset_id,inventory_item_id),
  FOREIGN KEY (preset_id) REFERENCES handoff_presets(id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS purchase_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','approved','ordered','received','cancelled')),
  requested_quantity REAL NOT NULL CHECK(requested_quantity > 0),
  received_quantity REAL,
  reason TEXT,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS intake_assessment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intake_id INTEGER NOT NULL,
  catalog_item_id INTEGER,
  item_title_en TEXT NOT NULL,
  item_title_hu TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0 CHECK(price >= 0),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(intake_id,catalog_item_id),
  FOREIGN KEY (intake_id) REFERENCES intake_leads(id) ON DELETE CASCADE,
  FOREIGN KEY (catalog_item_id) REFERENCES intake_catalog_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_code TEXT UNIQUE,
  client_id INTEGER NOT NULL,
  piano_id INTEGER NOT NULL,
  intake_id INTEGER UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  location_type TEXT NOT NULL DEFAULT 'workshop' CHECK(location_type IN ('workshop','on_site')),
  site_address TEXT,
  scheduled_at TEXT,
  estimated_duration_min INTEGER NOT NULL DEFAULT 120 CHECK(estimated_duration_min > 0),
  stage TEXT NOT NULL DEFAULT 'planned' CHECK(stage IN ('planned','received','in_progress','qa_review','admin_approval','completed')),
  workflow_stage_key TEXT,
  workflow_owner_user_id TEXT,
  assigned_technician_id TEXT,
  primary_skill_id INTEGER,
  total_labor_cost REAL NOT NULL DEFAULT 0 CHECK(total_labor_cost >= 0),
  total_material_cost REAL NOT NULL DEFAULT 0 CHECK(total_material_cost >= 0),
  estimated_revenue REAL NOT NULL DEFAULT 0 CHECK(estimated_revenue >= 0),
  deposit_amount REAL NOT NULL DEFAULT 0 CHECK(deposit_amount >= 0),
  internal_notes TEXT,
  cancelled_at TEXT,
  cancelled_by_user_id TEXT,
  cancelled_by_name TEXT,
  cancelled_by_party TEXT CHECK(cancelled_by_party IS NULL OR cancelled_by_party IN ('client','klavierhaus','other')),
  cancel_reason TEXT,
  completed_at TEXT,
  completed_by_user_id TEXT,
  completed_by_name TEXT,
  completion_document_id INTEGER,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  FOREIGN KEY (piano_id) REFERENCES pianos(id) ON DELETE RESTRICT,
  FOREIGN KEY (intake_id) REFERENCES intake_leads(id) ON DELETE SET NULL,
  FOREIGN KEY (workflow_owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_technician_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (primary_skill_id) REFERENCES staff_skills(id) ON DELETE SET NULL,
  FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_active_stage_schedule ON jobs(cancelled_at,stage,scheduled_at,updated_at,id);
CREATE INDEX IF NOT EXISTS idx_jobs_client_created ON jobs(client_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS workflow_stage_definitions (
  stage_key TEXT PRIMARY KEY,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 8),
  label_en TEXT NOT NULL,
  label_hu TEXT NOT NULL,
  stage_type TEXT NOT NULL DEFAULT 'intermediate' CHECK(stage_type IN ('start','intermediate','approval','completed')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  removable INTEGER NOT NULL DEFAULT 0 CHECK(removable IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_active_position ON workflow_stage_definitions(active,position);

CREATE TABLE IF NOT EXISTS job_workflow_phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  stage_key TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 8),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  starts_at TEXT,
  due_at TEXT,
  customer_price REAL NOT NULL DEFAULT 0 CHECK(customer_price >= 0),
  responsible_user_id TEXT,
  responsibility_skill_id INTEGER,
  blocker_code TEXT CHECK(blocker_code IS NULL OR blocker_code IN ('material_procurement','parts_procurement','material_issue','waiting_client','waiting_technician','waiting_admin','waiting_invoice','other')),
  blocker_note TEXT,
  activated_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id,stage_key),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (responsibility_skill_id) REFERENCES staff_skills(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS job_workflow_phase_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  stage_key TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'material' CHECK(category IN ('material','parts','service','transport','other')),
  amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0),
  notes TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_job_workflow_phase_costs_job_stage ON job_workflow_phase_costs(job_id,stage_key,id);

CREATE TABLE IF NOT EXISTS job_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  performed_by_user_id TEXT,
  performed_by TEXT NOT NULL,
  assigned_to_user_id TEXT,
  assigned_to TEXT,
  phase_note TEXT,
  billing_description TEXT,
  phase_labor_cost REAL NOT NULL DEFAULT 0 CHECK(phase_labor_cost >= 0),
  phase_material_cost REAL NOT NULL DEFAULT 0 CHECK(phase_material_cost >= 0),
  phase_duration_min INTEGER NOT NULL DEFAULT 0 CHECK(phase_duration_min >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (performed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_job_handoffs_job_created ON job_handoffs(job_id,created_at,id);

CREATE TABLE IF NOT EXISTS job_material_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  handoff_id INTEGER NOT NULL,
  inventory_item_id INTEGER NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_cost_snapshot REAL NOT NULL DEFAULT 0 CHECK(unit_cost_snapshot >= 0),
  total_cost REAL NOT NULL DEFAULT 0 CHECK(total_cost >= 0),
  used_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(handoff_id,inventory_item_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (handoff_id) REFERENCES job_handoffs(id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('usage','restock','adjustment')),
  quantity_delta REAL NOT NULL,
  balance_after REAL NOT NULL CHECK(balance_after >= 0),
  job_id INTEGER,
  handoff_id INTEGER,
  reference TEXT,
  note TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (handoff_id) REFERENCES job_handoffs(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

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
  direction TEXT NOT NULL DEFAULT 'receivable' CHECK(direction IN ('receivable','payable')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','paid','cancelled')),
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
  service_date TEXT,
  due_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  payment_url TEXT,
  subtotal_labor REAL NOT NULL DEFAULT 0,
  subtotal_material REAL NOT NULL DEFAULT 0,
  subtotal_adjustment REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0 AND tax_rate <= 100),
  tax_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
  payment_method TEXT CHECK(payment_method IS NULL OR payment_method IN ('Cash','Credit Card / Stripe','Bank Transfer','Check')),
  paid_at TEXT,
  pdf_path TEXT,
  email_language TEXT NOT NULL DEFAULT 'en' CHECK(email_language IN ('en','hu')),
  sent_at TEXT,
  sent_by_user_id TEXT,
  resend_message_id TEXT,
  cancelled_at TEXT,
  cancelled_by_user_id TEXT,
  cancel_reason TEXT,
  deleted_at TEXT,
  deleted_by_user_id TEXT,
  archive_document_id INTEGER,
  issued_document_id INTEGER,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT,
  FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((direction='receivable' AND client_id IS NOT NULL AND partner_id IS NULL) OR (direction='payable' AND partner_id IS NOT NULL AND client_id IS NULL))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'other' CHECK(item_type IN ('labor','material','adjustment','other')),
  item_description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
  unit_price REAL NOT NULL DEFAULT 0,
  total_price REAL NOT NULL DEFAULT 0,
  labor_amount REAL NOT NULL DEFAULT 0,
  material_amount REAL NOT NULL DEFAULT 0,
  phase_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash','Credit Card / Stripe','Bank Transfer','Check')),
  reference TEXT,
  paid_at TEXT NOT NULL,
  notes TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workshop_invoice_checkouts (
  id TEXT PRIMARY KEY,
  invoice_id INTEGER NOT NULL,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','EXPIRED','FAILED')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  checkout_url TEXT,
  expires_at TEXT NOT NULL,
  failure_code TEXT,
  paid_at TEXT,
  receipt_archive_document_id INTEGER,
  receipt_provider_message_id TEXT,
  receipt_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (receipt_archive_document_id) REFERENCES document_archive(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS direct_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount >= 0),
  expense_date TEXT NOT NULL,
  receipt_url TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoice_email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  status TEXT NOT NULL CHECK(status IN ('sent','failed')),
  provider_message_id TEXT,
  error_code TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS intake_assessment_email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intake_id INTEGER NOT NULL,
  archive_document_id INTEGER,
  recipient TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  custom_message TEXT,
  status TEXT NOT NULL CHECK(status IN ('sent','failed')),
  provider_message_id TEXT,
  error_code TEXT,
  sent_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (intake_id) REFERENCES intake_leads(id) ON DELETE CASCADE,
  FOREIGN KEY (archive_document_id) REFERENCES document_archive(id) ON DELETE SET NULL,
  FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customer_communication_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  job_id INTEGER,
  invoice_id INTEGER,
  client_id INTEGER,
  recipient TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
  status TEXT NOT NULL CHECK(status IN ('sent','failed')),
  provider_message_id TEXT,
  error_code TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_communication_job ON customer_communication_log(job_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_communication_invoice ON customer_communication_log(invoice_id,created_at DESC);

CREATE TABLE IF NOT EXISTS automation_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT,
  last_error TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_automation_outbox_due ON automation_outbox(status,available_at,created_at);

CREATE TABLE IF NOT EXISTS kpi_summary_cache (
  month_key TEXT PRIMARY KEY,
  labor_revenue REAL NOT NULL DEFAULT 0,
  material_direct_cost REAL NOT NULL DEFAULT 0,
  net_workshop_result REAL NOT NULL DEFAULT 0,
  outstanding_invoice_count INTEGER NOT NULL DEFAULT 0,
  outstanding_invoice_amount REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(lower(name));
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(lower(email));
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_client_type ON clients(client_type,is_vip,lower(name));
CREATE INDEX IF NOT EXISTS idx_pianos_client ON pianos(client_id);
CREATE INDEX IF NOT EXISTS idx_pianos_serial ON pianos(serial_number);
CREATE INDEX IF NOT EXISTS idx_intake_status ON intake_leads(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_client ON intake_leads(client_id);
CREATE INDEX IF NOT EXISTS idx_intake_technician ON intake_leads(assigned_technician_id,status);
CREATE INDEX IF NOT EXISTS idx_intake_catalog_active ON intake_catalog_items(active,sort_order,id);
CREATE INDEX IF NOT EXISTS idx_handoff_presets_active ON handoff_presets(active,sort_order,id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_active ON inventory_items(active,name_en,id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_time ON inventory_movements(inventory_item_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_job_material_usage_job ON job_material_usage(job_id,handoff_id,id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_item_status ON purchase_requests(inventory_item_id,status,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_requests_one_open_per_item ON purchase_requests(inventory_item_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS idx_intake_assessment_intake ON intake_assessment_items(intake_id,sort_order,id);
CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage,cancelled_at,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_at ON jobs(scheduled_at,cancelled_at,stage);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_piano ON jobs(piano_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_intake ON jobs(intake_id);
CREATE INDEX IF NOT EXISTS idx_jobs_technician ON jobs(assigned_technician_id,stage,scheduled_at);
CREATE INDEX IF NOT EXISTS idx_job_handoffs_job ON job_handoffs(job_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_definitions_position ON workflow_stage_definitions(position);
CREATE INDEX IF NOT EXISTS idx_job_workflow_phases_job ON job_workflow_phases(job_id,position);
CREATE INDEX IF NOT EXISTS idx_job_workflow_phases_due ON job_workflow_phases(enabled,due_at,completed_at);
CREATE INDEX IF NOT EXISTS idx_job_handoffs_cost_date ON job_handoffs(created_at,job_id);
CREATE INDEX IF NOT EXISTS idx_partners_name ON partners(lower(company_name),status);
CREATE INDEX IF NOT EXISTS idx_partner_contractors_user ON partner_contractors(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_direction_status ON invoices(direction,status,issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id,issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_partner ON invoices(partner_id,issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id,sort_order,id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id,paid_at,id);
CREATE INDEX IF NOT EXISTS idx_workshop_invoice_checkouts_invoice ON workshop_invoice_checkouts(invoice_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_invoice_checkouts_session ON workshop_invoice_checkouts(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_direct_expenses_date ON direct_expenses(expense_date,category);
CREATE INDEX IF NOT EXISTS idx_invoice_email_log_invoice ON invoice_email_log(invoice_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_assessment_email_log_intake ON intake_assessment_email_log(intake_id,created_at DESC);

-- Preserved website/event indexes plus explicit public read-path indexes.
CREATE INDEX IF NOT EXISTS idx_audit_type_time ON audit_log(audit_type,event_time DESC);
CREATE INDEX IF NOT EXISTS idx_customer_messages_round1 ON customer_messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_customer_attachments_round1 ON customer_message_attachments(conversation_id,message_id);
CREATE INDEX IF NOT EXISTS idx_website_content_versions_round1 ON website_content_versions(page_key,language,version DESC);
CREATE INDEX IF NOT EXISTS idx_website_tracking_round1 ON website_tracking_events(event_name,created_at DESC);


-- Enterprise document/archive center. Deleted operational records are retained here
-- as immutable snapshots while active modules only show live records.
CREATE TABLE IF NOT EXISTS document_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK(category IN ('deleted_invoice','deleted_intake','deleted_client','financial_document','contract','intake_assessment','exported_report','internal_correspondence','company_message','company_document')),
  title TEXT NOT NULL,
  description TEXT,
  entity_type TEXT,
  entity_id TEXT,
  original_name TEXT,
  stored_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  file_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  archived_by_user_id TEXT,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (archived_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_document_archive_category_time ON document_archive(category,archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_archive_entity ON document_archive(entity_type,entity_id);
