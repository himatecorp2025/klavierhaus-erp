"use strict";

const PROTOCOL_VERSION = "1.0";
const SOURCE_SYSTEM = "KLAVIERHAUS";
const RETENTION_POLICY = "HIMATE_7Y";
const RETENTION_YEARS = 7;

const DATASETS = Object.freeze([
  {module_key:"finance",dataset_key:"finance.balance_sheet",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",allowed_fields:["assets_usd","liabilities_usd","equity_usd","account_count"]},
  {module_key:"income_statement",dataset_key:"finance.income_statement",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",allowed_fields:["revenue_usd","expense_usd","net_income_usd","financial_item_count"]},
  {module_key:"invoice_documents",dataset_key:"finance.invoices",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"EVENT_AND_DAILY",personal:true,allowed_fields:["invoice_count","paid_count","overdue_count","invoiced_usd","paid_usd","outstanding_usd"]},
  {module_key:"audit_log",dataset_key:"operations.audit",transfer_mode:"AGGREGATE",target_service:"connector",cadence:"HOURLY",personal:true,allowed_fields:["event_count","failed_count","financial_event_count","work_event_count"]},
  {module_key:"backups",dataset_key:"operations.backups",transfer_mode:"METADATA",target_service:"health",cadence:"FIVE_MINUTES",allowed_fields:["backup_count","successful_count","failed_count","latest_age_hours","latest_size_bytes"]},
  {module_key:"pianos",dataset_key:"operations.client_pianos",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,allowed_fields:["piano_count","verified_count","located_count"]},
  {module_key:"contacts",dataset_key:"crm.clients",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,sensitive:true,allowed_fields:["client_count","active_count","vip_count","buying_interest_count"]},
  {module_key:"closed_jobs",dataset_key:"operations.closed_jobs",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,allowed_fields:["closed_count","billed_usd","average_cycle_hours","paid_count"]},
  {module_key:"knowledge_base",dataset_key:"evidence.company_documents",transfer_mode:"METADATA",target_service:"evidence",cadence:"EVENT_AND_DAILY",personal:true,allowed_fields:["document_count","financial_document_count","stored_file_count","total_amount_usd"]},
  {module_key:"company_data",dataset_key:"partner.company_profile",transfer_mode:"METADATA",target_service:"partners",cadence:"ON_CHANGE",personal:true,allowed_fields:["legal_name","trade_name","city","state","country","business_email","business_phone","profile_completeness_rate"]},
  {module_key:"inventory",dataset_key:"operations.inventory",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,allowed_fields:["item_count","quantity_total","reserved_quantity","inventory_value_usd"]},
  {module_key:"partners",dataset_key:"crm.business_partners",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,allowed_fields:["partner_count","active_count","contractor_count"]},
  {module_key:"planned_jobs",dataset_key:"operations.planned_jobs",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"HOURLY",personal:true,allowed_fields:["planned_count","expected_revenue_usd","weighted_revenue_usd","estimated_hours"]},
  {module_key:"scheduler",dataset_key:"operations.scheduler",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"HOURLY",personal:true,allowed_fields:["scheduled_job_count","planned_hours","active_assignee_count","overdue_job_count"]},
  {module_key:"website_services",dataset_key:"catalog.services",transfer_mode:"METADATA",target_service:"partners",cadence:"ON_CHANGE",allowed_fields:["service_count","visible_count","featured_count"]},
  {module_key:"settings",dataset_key:"system.settings",transfer_mode:"METADATA",target_service:"connector",cadence:"ON_CHANGE",allowed_fields:["enabled_feature_count","configured_setting_count"]},
  {module_key:"system_integrations",dataset_key:"system.integrations",transfer_mode:"METADATA",target_service:"health",cadence:"FIVE_MINUTES",sensitive:true,allowed_fields:["integration_count","enabled_count","healthy_count","error_count"]},
  {module_key:"users",dataset_key:"operations.users",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,sensitive:true,allowed_fields:["active_user_count","admin_count","manager_count","worker_count"]},
  {module_key:"workshop_workflow",dataset_key:"operations.workshop",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"HOURLY",personal:true,allowed_fields:["active_job_count","backlog_count","completed_count","average_cycle_hours"]},
  {module_key:"marketing_overview",dataset_key:"marketing.overview",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"HOURLY",allowed_fields:["session_count","lead_count","conversion_count","conversion_rate"]},
  {module_key:"customer_inbox",dataset_key:"marketing.customer_inbox",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"HOURLY",personal:true,sensitive:true,allowed_fields:["conversation_count","open_count","closed_count","average_response_minutes"]},
  {module_key:"website_reviews",dataset_key:"marketing.reviews",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,allowed_fields:["review_count","published_count","event_linked_count"]},
  {module_key:"campaigns_utm",dataset_key:"marketing.campaigns",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"HOURLY",allowed_fields:["campaign_count","active_count","tracked_session_count","conversion_count"]},
  {module_key:"leads",dataset_key:"marketing.leads",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"HOURLY",personal:true,sensitive:true,allowed_fields:["lead_count","contacted_count","appointment_count","closed_count","conversion_rate"]},
  {module_key:"tracking_cookies",dataset_key:"marketing.tracking",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"HOURLY",personal:true,allowed_fields:["session_count","event_count","analytics_consent_count","marketing_consent_count"]},
  {module_key:"seo_keywords",dataset_key:"marketing.seo",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",allowed_fields:["page_count","published_page_count","version_count","keyword_count"]},
  {module_key:"heatmap",dataset_key:"marketing.heatmap",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,allowed_fields:["consented_session_count","interaction_count","tracked_path_count"]},
  {module_key:"website_artists",dataset_key:"website.artists",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,allowed_fields:["artist_count","published_count","featured_count"]},
  {module_key:"website_contacts",dataset_key:"website.contacts",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"HOURLY",personal:true,sensitive:true,allowed_fields:["contact_request_count","contacted_count","appointment_count","closed_count"]},
  {module_key:"digital_attendance",dataset_key:"events.attendance",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"EVENT_AND_DAILY",personal:true,allowed_fields:["attendee_count","checkin_count","deleted_entry_count","attendance_rate"]},
  {module_key:"events",dataset_key:"events.events",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"EVENT_AND_DAILY",allowed_fields:["event_count","published_count","completed_count","capacity_total","ticket_revenue_usd"]},
  {module_key:"event_guest_list",dataset_key:"events.guests",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"EVENT_AND_DAILY",personal:true,allowed_fields:["guest_count","confirmed_count","declined_count"]},
  {module_key:"event_invitations",dataset_key:"events.invitations",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"EVENT_AND_DAILY",personal:true,sensitive:true,allowed_fields:["sent_count","accepted_count","declined_count","delivery_failed_count","rsvp_rate"]},
  {module_key:"media_library",dataset_key:"website.media",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",personal:true,allowed_fields:["asset_count","image_count","video_count","storage_bytes"]},
  {module_key:"pages_content",dataset_key:"website.pages",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"ON_CHANGE",allowed_fields:["page_count","published_count","version_count","language_variant_count"]},
  {module_key:"publish_preview",dataset_key:"website.publish",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"ON_CHANGE",personal:true,allowed_fields:["publish_count","preview_version_count","draft_version_count"]},
  {module_key:"showroom_pianos",dataset_key:"website.showroom_pianos",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"DAILY",allowed_fields:["piano_count","published_count","available_count","featured_count"]},
  {module_key:"event_tickets",dataset_key:"events.tickets",transfer_mode:"AGGREGATE",target_service:"impact",cadence:"EVENT_AND_DAILY",personal:true,sensitive:true,allowed_fields:["ticket_count","paid_count","refunded_count","checked_in_count","gross_usd","refund_usd"]}
].map((item)=>Object.freeze({
  ...item,
  contains_personal_data:Boolean(item.personal),
  contains_sensitive_data:Boolean(item.sensitive),
  schema_version:1,
  retention_policy:RETENTION_POLICY,
  retention_years:RETENTION_YEARS,
  allowed_fields:Object.freeze([...item.allowed_fields])
})));

const BY_MODULE = new Map(DATASETS.map((item)=>[item.module_key,item]));
const BY_DATASET = new Map(DATASETS.map((item)=>[item.dataset_key,item]));

function assertRegistry(){
  if(DATASETS.length!==38) throw new Error(`HIMATE_START22_REGISTRY_COUNT_${DATASETS.length}`);
  if(BY_MODULE.size!==38 || BY_DATASET.size!==38) throw new Error("HIMATE_START22_REGISTRY_DUPLICATE");
  for(const item of DATASETS){
    if(!item.module_key || !item.dataset_key || !item.allowed_fields.length) throw new Error("HIMATE_START22_REGISTRY_INVALID");
  }
  return true;
}
assertRegistry();

module.exports={
  PROTOCOL_VERSION,SOURCE_SYSTEM,RETENTION_POLICY,RETENTION_YEARS,
  DATASETS,BY_MODULE,BY_DATASET,assertRegistry
};
