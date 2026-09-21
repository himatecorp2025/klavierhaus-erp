"use strict";

const {readCompanyData}=require("../business-operations");
const {DATASETS,BY_MODULE}=require("./registry");
const {buildItem}=require("./protocol");

function n(value){const x=Number(value);return Number.isFinite(x)?x:0;}
function money(value){return Math.round(n(value)*100)/100;}
function rate(a,b){return b>0?Math.round((n(a)/n(b))*10000)/10000:0;}
function row(db,sql,params=[]){try{return db.prepare(sql).get(...params)||{};}catch(_e){return {};}}
function all(db,sql,params=[]){try{return db.prepare(sql).all(...params)||[];}catch(_e){return [];}}
function count(db,table,where="1=1",params=[]){return n(row(db,`SELECT COUNT(*) c FROM ${table} WHERE ${where}`,params).c);}
function nyDate(value=new Date()){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
}
function countSeoKeywords(value){
  let parsed={};try{parsed=JSON.parse(String(value||"{}"));}catch(_e){return 0;}
  let total=0;
  const visit=(v,key="")=>{
    if(Array.isArray(v) && /keyword/i.test(key)) total+=v.filter(x=>String(x||"").trim()).length;
    else if(v && typeof v==="object") Object.entries(v).forEach(([k,x])=>visit(x,k));
  };
  visit(parsed);
  return total;
}

const COLLECTORS={
  finance(db){
    const x=row(db,`SELECT
      COALESCE(SUM(CASE WHEN UPPER(a.category)='ASSET' THEN jl.debit-jl.credit ELSE 0 END),0) assets_usd,
      COALESCE(SUM(CASE WHEN UPPER(a.category)='LIABILITY' THEN jl.credit-jl.debit ELSE 0 END),0) liabilities_usd,
      COALESCE(SUM(CASE WHEN UPPER(a.category)='EQUITY' THEN jl.credit-jl.debit ELSE 0 END),0) equity_usd
      FROM journal_lines jl JOIN accounts a ON a.code=jl.account_code`);
    return {assets_usd:money(x.assets_usd),liabilities_usd:money(x.liabilities_usd),equity_usd:money(x.equity_usd),account_count:count(db,"accounts")};
  },
  income_statement(db){
    const x=row(db,`SELECT
      COALESCE(SUM(CASE WHEN UPPER(main_type) IN ('INCOME','REVENUE') THEN amount ELSE 0 END),0) revenue_usd,
      COALESCE(SUM(CASE WHEN UPPER(main_type)='EXPENSE' THEN amount ELSE 0 END),0) expense_usd,
      COUNT(*) financial_item_count
      FROM financial_items`);
    return {revenue_usd:money(x.revenue_usd),expense_usd:money(x.expense_usd),net_income_usd:money(n(x.revenue_usd)-n(x.expense_usd)),financial_item_count:n(x.financial_item_count)};
  },
  invoice_documents(db){
    const x=row(db,`SELECT COUNT(*) invoice_count,
      SUM(CASE WHEN LOWER(status)='paid' THEN 1 ELSE 0 END) paid_count,
      SUM(CASE WHEN LOWER(status) NOT IN ('paid','void','cancelled') AND due_date<date('now') THEN 1 ELSE 0 END) overdue_count,
      COALESCE(SUM(CASE WHEN LOWER(status)<>'void' THEN total_amount ELSE 0 END),0) invoiced_usd,
      COALESCE(SUM(CASE WHEN LOWER(status)='paid' THEN total_amount ELSE 0 END),0) paid_usd
      FROM invoices`);
    return {invoice_count:n(x.invoice_count),paid_count:n(x.paid_count),overdue_count:n(x.overdue_count),invoiced_usd:money(x.invoiced_usd),paid_usd:money(x.paid_usd),outstanding_usd:money(n(x.invoiced_usd)-n(x.paid_usd))};
  },
  audit_log(db){
    const x=row(db,`SELECT COUNT(*) event_count,
      SUM(CASE WHEN COALESCE(success,1)=0 THEN 1 ELSE 0 END) failed_count,
      SUM(CASE WHEN UPPER(COALESCE(audit_type,''))='FINANCIAL' THEN 1 ELSE 0 END) financial_event_count,
      SUM(CASE WHEN UPPER(COALESCE(audit_type,''))='WORK' THEN 1 ELSE 0 END) work_event_count
      FROM audit_log WHERE event_time>=datetime('now','-1 hour')`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  backups(db){
    const x=row(db,`SELECT COUNT(*) backup_count,
      SUM(CASE WHEN UPPER(status) IN ('SUCCESS','READY','COMPLETED') THEN 1 ELSE 0 END) successful_count,
      SUM(CASE WHEN UPPER(status) IN ('FAILED','ERROR') THEN 1 ELSE 0 END) failed_count,
      COALESCE((julianday('now')-julianday(MAX(created_at)))*24,0) latest_age_hours,
      COALESCE(MAX(file_size),0) latest_size_bytes FROM backup_log`);
    return {backup_count:n(x.backup_count),successful_count:n(x.successful_count),failed_count:n(x.failed_count),latest_age_hours:Math.round(n(x.latest_age_hours)*100)/100,latest_size_bytes:n(x.latest_size_bytes)};
  },
  pianos(db){
    const x=row(db,`SELECT COUNT(*) piano_count,
      SUM(CASE WHEN COALESCE(is_verified,0)=1 THEN 1 ELSE 0 END) verified_count,
      SUM(CASE WHEN trim(COALESCE(piano_location_address,''))<>'' THEN 1 ELSE 0 END) located_count FROM client_pianos`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  contacts(db){
    const x=row(db,`SELECT COUNT(*) client_count,
      SUM(CASE WHEN UPPER(COALESCE(status,''))='ACTIVE' THEN 1 ELSE 0 END) active_count,
      SUM(CASE WHEN COALESCE(is_vip,0)=1 THEN 1 ELSE 0 END) vip_count,
      SUM(CASE WHEN COALESCE(interested_buying,0)=1 THEN 1 ELSE 0 END) buying_interest_count FROM contacts`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  closed_jobs(db){
    const x=row(db,`SELECT COUNT(*) closed_count,COALESCE(SUM(billed_amount),0) billed_usd,
      COALESCE(AVG((julianday(COALESCE(completed_at,closed_at,updated_at))-julianday(created_at))*24),0) average_cycle_hours,
      SUM(CASE WHEN LOWER(COALESCE(financial_status,billing_status,'')) IN ('paid','settled') THEN 1 ELSE 0 END) paid_count
      FROM jobs WHERE closed_at IS NOT NULL OR completed_at IS NOT NULL OR UPPER(status) IN ('CLOSED','COMPLETED')`);
    return {closed_count:n(x.closed_count),billed_usd:money(x.billed_usd),average_cycle_hours:Math.round(n(x.average_cycle_hours)*100)/100,paid_count:n(x.paid_count)};
  },
  knowledge_base(db){
    const x=row(db,`SELECT COUNT(*) document_count,
      SUM(CASE WHEN amount IS NOT NULL OR invoice_number IS NOT NULL THEN 1 ELSE 0 END) financial_document_count,
      SUM(CASE WHEN trim(COALESCE(stored_path,''))<>'' THEN 1 ELSE 0 END) stored_file_count,
      COALESCE(SUM(amount),0) total_amount_usd FROM knowledge_base`);
    return {document_count:n(x.document_count),financial_document_count:n(x.financial_document_count),stored_file_count:n(x.stored_file_count),total_amount_usd:money(x.total_amount_usd)};
  },
  company_data(db){
    const c=readCompanyData(db);
    const checks=[c.legal_name,c.trade_name,c.city,c.state,c.country,c.email,c.phone];
    return {legal_name:String(c.legal_name||""),trade_name:String(c.trade_name||""),city:String(c.city||""),state:String(c.state||""),country:String(c.country||""),business_email:String(c.email||""),business_phone:String(c.phone||""),profile_completeness_rate:rate(checks.filter(v=>String(v||"").trim()).length,checks.length)};
  },
  inventory(db){
    const x=row(db,`SELECT COUNT(*) item_count,COALESCE(SUM(quantity),0) quantity_total,
      COALESCE(SUM(reserved_quantity),0) reserved_quantity,
      COALESCE(SUM(COALESCE(NULLIF(purchase_price,0),manufacturing_cost,0)*COALESCE(quantity,0)),0) inventory_value_usd
      FROM inventory_items WHERE deleted_at IS NULL`);
    return {item_count:n(x.item_count),quantity_total:n(x.quantity_total),reserved_quantity:n(x.reserved_quantity),inventory_value_usd:money(x.inventory_value_usd)};
  },
  partners(db){
    const p=row(db,`SELECT COUNT(*) partner_count,SUM(CASE WHEN UPPER(COALESCE(status,''))='ACTIVE' THEN 1 ELSE 0 END) active_count FROM partners`);
    return {partner_count:n(p.partner_count),active_count:n(p.active_count),contractor_count:count(db,"partner_contractors")};
  },
  planned_jobs(db){
    const x=row(db,`SELECT COUNT(*) planned_count,COALESCE(SUM(expected_revenue),0) expected_revenue_usd,
      COALESCE(SUM(expected_revenue*CASE WHEN probability<=1 THEN probability ELSE probability/100.0 END),0) weighted_revenue_usd,
      COALESCE(SUM(estimated_hours),0) estimated_hours FROM planned_jobs WHERE archived_at IS NULL AND UPPER(status) NOT IN ('CANCELLED','COMPLETED')`);
    return {planned_count:n(x.planned_count),expected_revenue_usd:money(x.expected_revenue_usd),weighted_revenue_usd:money(x.weighted_revenue_usd),estimated_hours:Math.round(n(x.estimated_hours)*100)/100};
  },
  scheduler(db){
    const x=row(db,`SELECT COUNT(*) scheduled_job_count,COALESCE(SUM(COALESCE(planned_hours,planned_minutes/60.0,0)),0) planned_hours,
      COUNT(DISTINCT assigned_user_id) active_assignee_count,
      SUM(CASE WHEN end_time<datetime('now') AND UPPER(status) NOT IN ('CLOSED','COMPLETED','CANCELLED') THEN 1 ELSE 0 END) overdue_job_count
      FROM jobs WHERE start_time IS NOT NULL AND date(start_time)>=date('now')`);
    return {scheduled_job_count:n(x.scheduled_job_count),planned_hours:Math.round(n(x.planned_hours)*100)/100,active_assignee_count:n(x.active_assignee_count),overdue_job_count:n(x.overdue_job_count)};
  },
  website_services(db){
    const x=row(db,`SELECT COUNT(*) service_count,SUM(CASE WHEN COALESCE(visible,0)=1 THEN 1 ELSE 0 END) visible_count,SUM(CASE WHEN COALESCE(featured,0)=1 THEN 1 ELSE 0 END) featured_count FROM website_services`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  settings(db){
    const x=row(db,`SELECT COUNT(*) configured_setting_count,SUM(CASE WHEN lower(trim(COALESCE(setting_value,''))) IN ('1','true','yes','enabled','active') THEN 1 ELSE 0 END) enabled_feature_count FROM app_settings WHERE trim(COALESCE(setting_value,''))<>''`);
    return {enabled_feature_count:n(x.enabled_feature_count),configured_setting_count:n(x.configured_setting_count)};
  },
  system_integrations(db){
    const x=row(db,`SELECT COUNT(*) integration_count,SUM(CASE WHEN COALESCE(enabled,0)=1 THEN 1 ELSE 0 END) enabled_count,
      SUM(CASE WHEN UPPER(COALESCE(status,'')) IN ('OK','READY','CONNECTED') THEN 1 ELSE 0 END) healthy_count,
      SUM(CASE WHEN UPPER(COALESCE(status,'')) IN ('ERROR','FAILED') THEN 1 ELSE 0 END) error_count FROM system_integration_health`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  users(db){
    const x=row(db,`SELECT SUM(CASE WHEN UPPER(status)='ACTIVE' AND COALESCE(hidden_user,0)=0 THEN 1 ELSE 0 END) active_user_count,
      SUM(CASE WHEN UPPER(role) IN ('ADMIN','SUPERADMIN') AND UPPER(status)='ACTIVE' THEN 1 ELSE 0 END) admin_count,
      SUM(CASE WHEN UPPER(role)='MANAGER' AND UPPER(status)='ACTIVE' THEN 1 ELSE 0 END) manager_count,
      SUM(CASE WHEN UPPER(role)='WORKER' AND UPPER(status)='ACTIVE' THEN 1 ELSE 0 END) worker_count FROM users`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  workshop_workflow(db){
    const x=row(db,`SELECT
      SUM(CASE WHEN UPPER(status) NOT IN ('CLOSED','COMPLETED','CANCELLED') THEN 1 ELSE 0 END) active_job_count,
      SUM(CASE WHEN UPPER(status) NOT IN ('CLOSED','COMPLETED','CANCELLED') AND start_time<datetime('now') THEN 1 ELSE 0 END) backlog_count,
      SUM(CASE WHEN UPPER(status) IN ('CLOSED','COMPLETED') OR closed_at IS NOT NULL THEN 1 ELSE 0 END) completed_count,
      COALESCE(AVG(CASE WHEN closed_at IS NOT NULL THEN (julianday(closed_at)-julianday(created_at))*24 END),0) average_cycle_hours
      FROM jobs WHERE workshop_workflow_id IS NOT NULL OR workflow_id IS NOT NULL`);
    return {active_job_count:n(x.active_job_count),backlog_count:n(x.backlog_count),completed_count:n(x.completed_count),average_cycle_hours:Math.round(n(x.average_cycle_hours)*100)/100};
  },
  marketing_overview(db){
    const sessions=n(row(db,`SELECT COUNT(DISTINCT anonymous_session_hash) c FROM website_tracking_events WHERE created_at>=datetime('now','-1 day') AND trim(COALESCE(anonymous_session_hash,''))<>''`).c);
    const leads=count(db,"website_contact_leads","created_at>=datetime('now','-1 day')");
    const converted=count(db,"website_contact_leads","created_at>=datetime('now','-1 day') AND UPPER(status) IN ('APPOINTMENT_SCHEDULED','CLOSED')");
    return {session_count:sessions,lead_count:leads,conversion_count:converted,conversion_rate:rate(converted,leads)};
  },
  customer_inbox(db){
    const base=row(db,`SELECT COUNT(*) conversation_count,SUM(CASE WHEN UPPER(status)<>'CLOSED' THEN 1 ELSE 0 END) open_count,SUM(CASE WHEN UPPER(status)='CLOSED' THEN 1 ELSE 0 END) closed_count FROM customer_conversations`);
    const response=row(db,`SELECT COALESCE(AVG((julianday(s.first_staff)-julianday(c.created_at))*1440),0) average_response_minutes
      FROM customer_conversations c JOIN (
        SELECT conversation_id,MIN(created_at) first_staff FROM customer_messages
        WHERE UPPER(direction) IN ('STAFF','OUTBOUND') GROUP BY conversation_id
      ) s ON s.conversation_id=c.id WHERE julianday(s.first_staff)>=julianday(c.created_at)`);
    return {conversation_count:n(base.conversation_count),open_count:n(base.open_count),closed_count:n(base.closed_count),average_response_minutes:Math.round(n(response.average_response_minutes)*100)/100};
  },
  website_reviews(db){
    const x=row(db,`SELECT COUNT(*) review_count,SUM(CASE WHEN COALESCE(visible,0)=1 THEN 1 ELSE 0 END) published_count,SUM(CASE WHEN linked_event_id IS NOT NULL THEN 1 ELSE 0 END) event_linked_count FROM website_reviews WHERE COALESCE(is_sample,0)=0`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  campaigns_utm(db){
    const campaigns=row(db,`SELECT COUNT(*) campaign_count,SUM(CASE WHEN COALESCE(active,0)=1 THEN 1 ELSE 0 END) active_count FROM marketing_campaigns`);
    const tracked=n(row(db,`SELECT COUNT(DISTINCT anonymous_session_hash) c FROM website_tracking_events WHERE trim(COALESCE(anonymous_session_hash,''))<>'' AND created_at>=datetime('now','-1 day')`).c);
    const conversions=count(db,"website_contact_leads","trim(COALESCE(utm_campaign,''))<>'' AND UPPER(status) IN ('APPOINTMENT_SCHEDULED','CLOSED')");
    return {campaign_count:n(campaigns.campaign_count),active_count:n(campaigns.active_count),tracked_session_count:tracked,conversion_count:conversions};
  },
  leads(db){
    const x=row(db,`SELECT COUNT(*) lead_count,
      SUM(CASE WHEN UPPER(status)<>'NEW' THEN 1 ELSE 0 END) contacted_count,
      SUM(CASE WHEN UPPER(status)='APPOINTMENT_SCHEDULED' THEN 1 ELSE 0 END) appointment_count,
      SUM(CASE WHEN UPPER(status)='CLOSED' THEN 1 ELSE 0 END) closed_count FROM website_contact_leads`);
    const converted=n(x.appointment_count)+n(x.closed_count);
    return {lead_count:n(x.lead_count),contacted_count:n(x.contacted_count),appointment_count:n(x.appointment_count),closed_count:n(x.closed_count),conversion_rate:rate(converted,n(x.lead_count))};
  },
  tracking_cookies(db){
    const x=row(db,`SELECT COUNT(DISTINCT NULLIF(anonymous_session_hash,'')) session_count,COUNT(*) event_count,
      SUM(CASE WHEN COALESCE(analytics_consent,0)=1 THEN 1 ELSE 0 END) analytics_consent_count,
      SUM(CASE WHEN COALESCE(marketing_consent,0)=1 THEN 1 ELSE 0 END) marketing_consent_count
      FROM website_tracking_events WHERE created_at>=datetime('now','-1 day')`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  seo_keywords(db){
    const pages=row(db,`SELECT COUNT(DISTINCT page_key) page_count,SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) published_page_count FROM website_content_pages`);
    const versionCount=count(db,"website_content_versions");
    const setting=row(db,`SELECT setting_value FROM app_settings WHERE setting_key='website_seo_settings'`);
    return {page_count:n(pages.page_count),published_page_count:n(pages.published_page_count),version_count:versionCount,keyword_count:countSeoKeywords(setting.setting_value)};
  },
  heatmap(db){
    const rows=all(db,`SELECT anonymous_session_hash,source_path,metadata_json FROM website_tracking_events WHERE event_name='heatmap_batch' AND created_at>=datetime('now','-30 days') AND COALESCE(analytics_consent,0)=1`);
    const sessions=new Set(),paths=new Set();let interactions=0;
    for(const item of rows){
      if(item.anonymous_session_hash)sessions.add(item.anonymous_session_hash);
      if(item.source_path)paths.add(item.source_path);
      try{const m=JSON.parse(item.metadata_json||"{}");interactions+=n(m.pointer_samples)+n(m.clicks);}catch(_e){}
    }
    return {consented_session_count:sessions.size,interaction_count:interactions,tracked_path_count:paths.size};
  },
  website_artists(db){
    const x=row(db,`SELECT COUNT(*) artist_count,SUM(CASE WHEN COALESCE(published,0)=1 THEN 1 ELSE 0 END) published_count,SUM(CASE WHEN COALESCE(featured,0)=1 THEN 1 ELSE 0 END) featured_count FROM website_artists WHERE COALESCE(is_sample,0)=0`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  website_contacts(db){
    const x=row(db,`SELECT COUNT(*) contact_request_count,SUM(CASE WHEN UPPER(status)<>'NEW' THEN 1 ELSE 0 END) contacted_count,SUM(CASE WHEN UPPER(status)='APPOINTMENT_SCHEDULED' THEN 1 ELSE 0 END) appointment_count,SUM(CASE WHEN UPPER(status)='CLOSED' THEN 1 ELSE 0 END) closed_count FROM website_contact_leads`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  digital_attendance(db){
    const tickets=count(db,"event_tickets","UPPER(status) NOT IN ('VOID','CANCELLED')");
    const x=row(db,`SELECT COUNT(*) checkin_count,SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) deleted_entry_count FROM event_attendance_entries`);
    return {attendee_count:tickets,checkin_count:n(x.checkin_count),deleted_entry_count:n(x.deleted_entry_count),attendance_rate:rate(n(x.checkin_count),tickets)};
  },
  events(db){
    const e=row(db,`SELECT COUNT(*) event_count,SUM(CASE WHEN UPPER(status)='PUBLISHED' THEN 1 ELSE 0 END) published_count,SUM(CASE WHEN UPPER(status) IN ('COMPLETED','CLOSED') THEN 1 ELSE 0 END) completed_count,COALESCE(SUM(capacity_total),0) capacity_total FROM events WHERE COALESCE(is_sample,0)=0`);
    const revenue=money(n(row(db,`SELECT COALESCE(SUM(price_cents),0)/100.0 value FROM event_tickets WHERE UPPER(COALESCE(payment_status,''))='PAID'`).value));
    return {event_count:n(e.event_count),published_count:n(e.published_count),completed_count:n(e.completed_count),capacity_total:n(e.capacity_total),ticket_revenue_usd:revenue};
  },
  event_guest_list(db){
    const x=row(db,`SELECT COUNT(*) guest_count,SUM(CASE WHEN UPPER(status)='ACCEPTED' THEN 1 ELSE 0 END) confirmed_count,SUM(CASE WHEN UPPER(status)='DECLINED' THEN 1 ELSE 0 END) declined_count FROM event_invitations`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  event_invitations(db){
    const x=row(db,`SELECT SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) sent_count,SUM(CASE WHEN UPPER(status)='ACCEPTED' THEN 1 ELSE 0 END) accepted_count,SUM(CASE WHEN UPPER(status)='DECLINED' THEN 1 ELSE 0 END) declined_count,SUM(CASE WHEN UPPER(COALESCE(delivery_status,'')) IN ('FAILED','BOUNCED') THEN 1 ELSE 0 END) delivery_failed_count FROM event_invitations`);
    return {sent_count:n(x.sent_count),accepted_count:n(x.accepted_count),declined_count:n(x.declined_count),delivery_failed_count:n(x.delivery_failed_count),rsvp_rate:rate(n(x.accepted_count)+n(x.declined_count),n(x.sent_count))};
  },
  media_library(db){
    const x=row(db,`SELECT COUNT(*) asset_count,SUM(CASE WHEN mime_type LIKE 'image/%' THEN 1 ELSE 0 END) image_count,SUM(CASE WHEN mime_type LIKE 'video/%' THEN 1 ELSE 0 END) video_count,COALESCE(SUM(file_size),0) storage_bytes FROM website_media`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  pages_content(db){
    const x=row(db,`SELECT COUNT(DISTINCT page_key) page_count,SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) published_count,COUNT(*) language_variant_count FROM website_content_pages`);
    return {page_count:n(x.page_count),published_count:n(x.published_count),version_count:count(db,"website_content_versions"),language_variant_count:n(x.language_variant_count)};
  },
  publish_preview(db){
    const x=row(db,`SELECT SUM(CASE WHEN UPPER(status)='PUBLISHED' THEN 1 ELSE 0 END) publish_count,SUM(CASE WHEN UPPER(status)='PREVIEW' THEN 1 ELSE 0 END) preview_version_count,SUM(CASE WHEN UPPER(status)='DRAFT' THEN 1 ELSE 0 END) draft_version_count FROM website_content_versions`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  showroom_pianos(db){
    const x=row(db,`SELECT COUNT(*) piano_count,SUM(CASE WHEN COALESCE(published,0)=1 THEN 1 ELSE 0 END) published_count,SUM(CASE WHEN UPPER(COALESCE(availability_status,''))='AVAILABLE' THEN 1 ELSE 0 END) available_count,SUM(CASE WHEN COALESCE(featured,0)=1 THEN 1 ELSE 0 END) featured_count FROM website_showroom_pianos WHERE COALESCE(is_sample,0)=0`);
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,n(v)]));
  },
  event_tickets(db){
    const t=row(db,`SELECT COUNT(*) ticket_count,SUM(CASE WHEN UPPER(COALESCE(payment_status,''))='PAID' THEN 1 ELSE 0 END) paid_count,SUM(CASE WHEN UPPER(status)='REFUNDED' OR UPPER(COALESCE(payment_status,''))='REFUNDED' THEN 1 ELSE 0 END) refunded_count,SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) checked_in_count,COALESCE(SUM(CASE WHEN UPPER(COALESCE(payment_status,''))='PAID' THEN price_cents ELSE 0 END),0)/100.0 gross_usd FROM event_tickets`);
    const refund=money(n(row(db,`SELECT COALESCE(SUM(CASE WHEN UPPER(status)='REFUNDED' THEN amount_total ELSE 0 END),0)/100.0 refund_usd FROM event_payments`).refund_usd));
    return {ticket_count:n(t.ticket_count),paid_count:n(t.paid_count),refunded_count:n(t.refunded_count),checked_in_count:n(t.checked_in_count),gross_usd:money(t.gross_usd),refund_usd:refund};
  }
};

function collectDataset(db,definition,{now=new Date(),idempotencyPrefix=""}={}){
  const collector=COLLECTORS[definition.module_key];
  if(typeof collector!=="function") throw new Error(`HIMATE_COLLECTOR_MISSING:${definition.module_key}`);
  const data=collector(db);
  const period=nyDate(now);
  return buildItem(definition,data,{
    periodStart:period,
    periodEnd:period,
    aggregation:"LATEST",
    idempotencyKey:idempotencyPrefix?undefined:undefined
  });
}

function collectDatasets(db,{cadences=null,moduleKeys=null,now=new Date()}={}){
  const allowedCadences=cadences?new Set(cadences):null;
  const allowedModules=moduleKeys?new Set(moduleKeys):null;
  return DATASETS
    .filter(def=>!allowedCadences||allowedCadences.has(def.cadence))
    .filter(def=>!allowedModules||allowedModules.has(def.module_key))
    .map(def=>collectDataset(db,def,{now}));
}

function assertCollectorCoverage(){
  for(const definition of DATASETS){
    if(typeof COLLECTORS[definition.module_key]!=="function") throw new Error(`HIMATE_COLLECTOR_MISSING:${definition.module_key}`);
    if(BY_MODULE.get(definition.module_key)!==definition) throw new Error(`HIMATE_REGISTRY_LOOKUP_MISMATCH:${definition.module_key}`);
  }
  return true;
}
assertCollectorCoverage();

module.exports={COLLECTORS,collectDataset,collectDatasets,assertCollectorCoverage,nyDate};
