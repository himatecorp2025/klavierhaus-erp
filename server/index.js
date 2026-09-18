
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const express = require("express");
const compression = require("compression");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const { legacyCalendarColor, validateCalendarColor } = require("./calendar-colors");
const { createGoogleCalendarIntegration } = require("./google-calendar");
const { createTransactionalEmail } = require("./transactional-email");
const { createAccountActivationService } = require("./account-activation");
const { registerEventRoutes } = require("./events");
const { registerWebsiteContentRoutes } = require("./website-content");
const { registerWebsiteCatalogRoutes } = require("./website-catalog");
const { registerWebsitePlatformRoutes } = require("./website-platform");
const { createStripeSandbox } = require("./stripe-sandbox");
const { createTicketService } = require("./ticket-service");
const {
  createBusinessDocumentService,
  createInvoiceEngine,
  registerBusinessOperationsRoutes,
  nextNewYorkMonthBoundary,
  nextNewYorkMonthClose
} = require("./business-operations");
const { normalizePaymentMethod } = require("./payment-methods");
const { buildAccountingSnapshot, expandFinancialItemsAsOf, isInvoiceDerivedFinancialItem, roundMoney } = require("./accounting-domain");
const { generateFinancialStatementPdf } = require("./document-pdf");
const { registerWorkshopWorkflowRoutes } = require("./workshop-workflow");
const { hydrateRuntimeSecrets, registerSystemIntegrationRoutes } = require("./system-integrations");
const { SCHEDULE_INTERVAL_MINUTES, isScheduleTime, isScheduleDurationHours, timeRangeMinutes: domainTimeRangeMinutes, createJobDomain } = require("./job-domain");
const {
  analyzeClientWorkbook,
  commitClientImportRecords,
  clientPianoExportRows,
  serializeClientPianoCsv,
  parseStructuredClientPianoPayload,
  commitStructuredClientPianoImport
} = require("./client-import");
const { ensureCentralPianoReference, centralPianoLookup, registerPianoReferenceRoutes } = require("./piano-reference-engine");
const {
  createDocumentUpload,
  createBrandingUpload,
  createEventImageUpload,
  createWebsiteImageUpload,
  createClientImportUpload,
  createPianoImportUpload,
  createCompanyDocumentUpload,
  createCustomerConversationUpload,
  uploadErrorHandler
} = require("./upload-middleware");
let webpush=null;
try{webpush=require("web-push");}catch(error){console.warn("web-push unavailable:",error.message);}
require("dotenv").config();

const app = express();
app.set("trust proxy", 1);
const OPERATIONAL_CONTRACT_KEYS = Object.freeze(["helpdesk", "notification_audit"]);
const PORT = process.env.PORT || 3030;
const VERSION = String(process.env.APP_VERSION || require("../package.json").version || "unknown");
const BUILD_ID = String(process.env.APP_BUILD_ID || "2026.09.18-V40-PHASE1");
const DEPLOYMENT_COMMIT = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || process.env.COMMIT_SHA || "unknown").trim() || "unknown";
const VAPID_PUBLIC_KEY=process.env.VAPID_PUBLIC_KEY||"";
const VAPID_PRIVATE_KEY=process.env.VAPID_PRIVATE_KEY||"";
const VAPID_SUBJECT=process.env.VAPID_SUBJECT||"mailto:admin@klavierhaus.com";
const PUSH_CONFIGURED=Boolean(webpush&&VAPID_PUBLIC_KEY&&VAPID_PRIVATE_KEY);
console.log(`[BOOT] Klavierhaus ERP Production Engine - Build: ${BUILD_ID}`);
if(PUSH_CONFIGURED) webpush.setVapidDetails(VAPID_SUBJECT,VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY);

const JWT_SECRET = process.env.JWT_SECRET;
if(!JWT_SECRET || JWT_SECRET.length < 32){
  throw new Error("JWT_SECRET is required and must be at least 32 characters long");
}
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, {recursive:true});
const EVENT_IMAGE_DIR=path.join(UPLOAD_DIR,"events");
fs.mkdirSync(EVENT_IMAGE_DIR,{recursive:true});
const WEBSITE_IMAGE_DIR=path.join(UPLOAD_DIR,"website");
fs.mkdirSync(WEBSITE_IMAGE_DIR,{recursive:true});
const companyDocumentUpload=createCompanyDocumentUpload(UPLOAD_DIR);

const db = new Database(process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus_v6.sqlite"));
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
hydrateRuntimeSecrets(db, process.env);
const FINANCIAL_HISTORY_START = "2026-08";
const ticketService = createTicketService({ db });
const transactionalEmail=createTransactionalEmail(process.env);
const accountActivation=createAccountActivationService({db,emailService:transactionalEmail});
const businessDocuments=createBusinessDocumentService({db,uploadDir:UPLOAD_DIR,transactionalEmail,websiteBaseUrl:process.env.WEBSITE_BASE_URL,env:process.env,invoiceEngineProvider:()=>invoiceEngine});
const stripeSandbox=createStripeSandbox({db,env:process.env,websiteBaseUrl:process.env.WEBSITE_BASE_URL,ticketService,onPaymentRecorded:businessDocuments.onPaymentRecorded,onPaymentFulfilled:businessDocuments.onPaymentFulfilled,onPaymentRefunded:businessDocuments.onPaymentRefunded});

// Database schema and migrations are executed exclusively by server/init-db.js.
// The application process does not create users, demo data, tables, columns, or indexes.

const VISIBLE_USER_ROLES=["ADMIN","MANAGER","WORKER"];
const ADMIN_MODULES = Object.freeze([
  { key: "finance_invoicing", group: "Finance & Invoicing", label_en: "Finance & Invoicing", label_hu: "Pénzügy és számlázás" },
  { key: "technical", group: "Technical Operation", label_en: "Technical Operation", label_hu: "Technikai működés" },
  { key: "marketing", group: "Marketing", label_en: "Marketing", label_hu: "Marketing" },
  { key: "website_events", group: "Website & Events", label_en: "Website & Events", label_hu: "Weboldal és események" }
]);
const ADMIN_MODULE_CARDS = Object.freeze([
  { key: "finance", group_key: "finance_invoicing", label_en: "Balance Sheet", label_hu: "Mérleg" },
  { key: "income_statement", group_key: "finance_invoicing", label_en: "Income Statement", label_hu: "Eredménykimutatás" },
  { key: "invoice_documents", group_key: "finance_invoicing", label_en: "Invoices Documents", label_hu: "Számladokumentumok" },
  { key: "audit_log", group_key: "technical", label_en: "Audit Log", label_hu: "Módosítási napló" },
  { key: "backups", group_key: "technical", label_en: "Backups", label_hu: "Biztonsági mentések" },
  { key: "pianos", group_key: "technical", label_en: "Client Piano", label_hu: "Ügyfélzongorák" },
  { key: "contacts", group_key: "technical", label_en: "Clients", label_hu: "Ügyfelek" },
  { key: "closed_jobs", group_key: "technical", label_en: "Closed Jobs", label_hu: "Lezárt munkák" },
  { key: "knowledge_base", group_key: "technical", label_en: "Company Documents Archive", label_hu: "Céges dokumentumtár" },
  { key: "company_data", group_key: "technical", label_en: "Corporate Data", label_hu: "Cégadatok" },
  { key: "inventory", group_key: "technical", label_en: "Inventory", label_hu: "Leltár" },
  { key: "partners", group_key: "technical", label_en: "Partners", label_hu: "Partnerek" },
  { key: "planned_jobs", group_key: "technical", label_en: "Planned Jobs", label_hu: "Tervezett munkák" },
  { key: "scheduler", group_key: "technical", label_en: "Scheduler", label_hu: "Naptár" },
  { key: "website_services", group_key: "technical", label_en: "Services", label_hu: "Szolgáltatások" },
  { key: "settings", group_key: "technical", label_en: "Settings", label_hu: "Beállítások" },
  { key: "system_integrations", group_key: "technical", label_en: "System Activation & Integrations", label_hu: "Rendszeraktiválás és integrációk" },
  { key: "users", group_key: "technical", label_en: "Users", label_hu: "Felhasználók" },
  { key: "workshop_workflow", group_key: "technical", label_en: "Workshop Workflow", label_hu: "Műhely workflow" },
  { key: "marketing_overview", group_key: "marketing", label_en: "Campaign Overview", label_hu: "Kampányáttekintő" },
  { key: "customer_inbox", group_key: "marketing", label_en: "Customer Inbox", label_hu: "Ügyfélüzenetek" },
  { key: "website_reviews", group_key: "marketing", label_en: "Reviews", label_hu: "Vélemények" },
  { key: "campaigns_utm", group_key: "marketing", label_en: "Campaigns & UTM", label_hu: "Kampányok és UTM-kódok" },
  { key: "leads", group_key: "marketing", label_en: "Leads", label_hu: "Érdeklődők" },
  { key: "tracking_cookies", group_key: "marketing", label_en: "Tracking & Cookies", label_hu: "Követési és cookie-beállítások" },
  { key: "seo_keywords", group_key: "marketing", label_en: "SEO & Keywords", label_hu: "SEO és kulcsszavak" },
  { key: "heatmap", group_key: "marketing", label_en: "Consent Heatmap", label_hu: "Hozzájárulásos hőtérkép" },
  { key: "website_artists", group_key: "website_events", label_en: "Artists", label_hu: "Művészek" },
  { key: "website_contacts", group_key: "website_events", label_en: "Contacts", label_hu: "Kapcsolatfelvételek" },
  { key: "digital_attendance", group_key: "website_events", label_en: "Digital Attendance", label_hu: "Digitális jelenlétiív" },
  { key: "events", group_key: "website_events", label_en: "Events", label_hu: "Események" },
  { key: "event_guest_list", group_key: "website_events", label_en: "Guest Data", label_hu: "Vendégadatok" },
  { key: "event_invitations", group_key: "website_events", label_en: "Invitations", label_hu: "Meghívások" },
  { key: "media_library", group_key: "website_events", label_en: "Media Library", label_hu: "Médiatár" },
  { key: "pages_content", group_key: "website_events", label_en: "Pages & Content", label_hu: "Oldalak és tartalmak" },
  { key: "publish_preview", group_key: "website_events", label_en: "Publish & Preview", label_hu: "Publikálás és előnézet" },
  { key: "showroom_pianos", group_key: "website_events", label_en: "Showroom Pianos", label_hu: "Bemutatott zongorák" },
  { key: "event_tickets", group_key: "website_events", label_en: "Ticket Reservation", label_hu: "Jegyfoglalás" }
]);

function seedDefaultPermissions(){
  const commonView=['scheduler.view','workshop_workflow.view','planned_jobs.view','contacts.view','pianos.view','closed_jobs.view','knowledge_base.view','inventory.view','users.view','customer_inbox.view'];
  const defaults={
    ADMIN:[...commonView,'finance.view','income_statement.view','invoice_documents.view','users.create','users.roles','permissions.manage','audit.view','events.view','events.manage','events.refunds','system_integrations.view','system_integrations.edit','system_integrations.test'],
    MANAGER:[...commonView,'finance.view','income_statement.view','invoice_documents.view'],
    WORKER:[...commonView]
  };
  const insert=db.prepare('INSERT OR IGNORE INTO role_permissions(role,permission,enabled,updated_by) VALUES(?,?,1,?)');
  Object.entries(defaults).forEach(([role,permissions])=>permissions.forEach(permission=>insert.run(role,permission,'SYSTEM')));
}
seedDefaultPermissions();

const BACKUP_DIR=process.env.BACKUP_DIR || path.join(__dirname,'backups');
fs.mkdirSync(BACKUP_DIR,{recursive:true});
const DB_PATH=process.env.DB_PATH || path.join(__dirname,'db','klavierhaus_v6.sqlite');
function audit(req, action, module, recordId, oldValue=null, newValue=null, success=1, details='', auditType='TECHNICAL'){
  try{
    if(isSuperadminUser(req?.user) && auditType!=='FINANCIAL') return;
    db.prepare(`INSERT INTO audit_log(id,user_id,user_name,user_role,action,module,record_id,old_value,new_value,success,details,audit_type)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(rid('AUD'),req?.user?.id||'',req?.user?.name||'',req?.user?.role||'',action,module||'',recordId||'',oldValue?JSON.stringify(oldValue):null,newValue?JSON.stringify(newValue):null,success,details||'',auditType);
  }catch(e){console.warn('audit log failed:',e.message)}
}
function workAudit(req, action, recordId, oldValue=null, newValue=null, success=1, details=''){
  audit(req,action,'jobs',recordId,oldValue,newValue,success,details,'WORK');
}


function normalizeDeviceId(value){
  const id=String(value||'').trim();
  return /^[A-Za-z0-9._:-]{8,160}$/.test(id)?id:'';
}
function upsertNotificationDevice(userId,deviceId,{status='NOT_CONFIGURED',platform='',userAgent='',language='en'}={}){
  if(!userId||!deviceId)return null;
  const rowId=`NDV-${crypto.createHash('sha256').update(`${userId}:${deviceId}`).digest('hex').slice(0,24)}`;
  db.prepare(`INSERT INTO notification_devices(id,user_id,device_id,status,platform,user_agent,language,last_seen_at,updated_at)
    VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id,device_id) DO UPDATE SET status=excluded.status,platform=excluded.platform,user_agent=excluded.user_agent,language=excluded.language,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
    .run(rowId,userId,deviceId,status,platform,userAgent,language==='hu'?'hu':'en');
  return db.prepare('SELECT * FROM notification_devices WHERE user_id=? AND device_id=?').get(userId,deviceId);
}

function notificationPreferenceColumn(type){
  return ({JOB_ASSIGNED:'job_assigned',JOB_TRANSFERRED:'job_transferred',SUBTASK_TRANSFERRED:'job_transferred',JOB_UPDATED:'job_updated',JOB_DELETED:'job_deleted',JOB_STARTING_IN_ONE_HOUR:'one_hour_reminder',DIRECT_MESSAGE:'direct_message'})[type]||null;
}
function notificationPreferenceEnabled(userId,type){
  const column=notificationPreferenceColumn(type); if(!column)return true;
  const row=db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(userId);
  return !row || Number(row[column]??1)===1;
}
function notificationPayloadForUser(row,userId){
  const u=db.prepare('SELECT id,name FROM users WHERE id=?').get(userId)||{};
  const unreadCount=db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_user_id=? AND status='ACTIVE'").get(userId).c;
  return {notificationId:row.id,unreadCount,type:row.notification_type,title_en:row.title_en,title_hu:row.title_hu,body_en:row.body_en,body_hu:row.body_hu,custom_message:row.custom_message||'',related_job_id:row.related_job_id||'',sender_name:row.sender_name||'',url:'/?openNotifications=1'};
}
function sendPushForNotification(row){
  if(!PUSH_CONFIGURED || !notificationPreferenceEnabled(row.recipient_user_id,row.notification_type))return;
  const pref=db.prepare('SELECT push_enabled FROM notification_preferences WHERE user_id=?').get(row.recipient_user_id);
  if(pref && Number(pref.push_enabled)===0)return;
  const subscriptions=db.prepare('SELECT id,subscription_json,language FROM push_subscriptions WHERE user_id=?').all(row.recipient_user_id);
  subscriptions.forEach(sub=>{
    const base=notificationPayloadForUser(row,row.recipient_user_id);const lang=sub.language==='hu'?'hu':'en';const payload=JSON.stringify({...base,language:lang,title:lang==='hu'?row.title_hu:row.title_en,body:row.custom_message||(lang==='hu'?row.body_hu:row.body_en)});
    let parsed;try{parsed=JSON.parse(sub.subscription_json)}catch(_e){return;}
    webpush.sendNotification(parsed,payload).catch(error=>{
      if(error.statusCode===404||error.statusCode===410) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(sub.id);
      else console.warn('push send failed:',error.message);
    });
  });
}
async function sendActivationTestPush(subscriptionRow,token){
  if(!PUSH_CONFIGURED) throw new Error('PUSH_NOT_CONFIGURED');
  let parsed;try{parsed=JSON.parse(subscriptionRow.subscription_json)}catch(_e){throw new Error('INVALID_PUSH_SUBSCRIPTION');}
  const payload=JSON.stringify({
    activationTest:true,
    activationToken:token,
    title:'Notifications enabled',
    body:'Klavierhaus ERP notifications are active on this device.',
    unreadCount:db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_user_id=? AND status='ACTIVE'").get(subscriptionRow.user_id).c,
    url:'/?openNotifications=1'
  });
  await webpush.sendNotification(parsed,payload);
}
function createNotification({recipientUserId,senderUserId=null,type,job=null,titleEn,titleHu,bodyEn,bodyHu,customMessage='',metadata={},eventKey=null}){
  if(!recipientUserId)return null;
  const recipient=db.prepare("SELECT id,status FROM users WHERE id=? AND status='Active'").get(recipientUserId);if(!recipient)return null;
  if(eventKey){const existing=db.prepare('SELECT * FROM notifications WHERE event_key=?').get(eventKey);if(existing)return existing;}
  const id=rid('NTF');
  try{db.prepare(`INSERT INTO notifications(id,recipient_user_id,sender_user_id,notification_type,related_job_id,title_en,title_hu,body_en,body_hu,custom_message,metadata_json,event_key,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE')`).run(id,recipientUserId,senderUserId,type,job?.id||null,titleEn,titleHu,bodyEn,bodyHu,customMessage||null,JSON.stringify(metadata||{}),eventKey||null);}catch(error){if(String(error.message).includes('UNIQUE'))return eventKey?db.prepare('SELECT * FROM notifications WHERE event_key=?').get(eventKey):null;throw error;}
  const row=db.prepare(`SELECT n.*,su.name sender_name FROM notifications n LEFT JOIN users su ON su.id=n.sender_user_id WHERE n.id=?`).get(id);
  sendPushForNotification(row);return row;
}
function jobDescription(job){return `${job.title||'Job'}${job.client_name?` · ${job.client_name}`:''}${job.start_time?` · ${job.start_time.replace('T',' ')}`:''}`;}
function notifyAssigned(job,sender,type='JOB_ASSIGNED'){
  if(!job?.assigned_user_id || String(job.assigned_user_id)===String(sender?.id||''))return;
  const subtask=String(job.job_type||'')==='Part-work'; const finalType=subtask?'SUBTASK_TRANSFERRED':type;
  createNotification({recipientUserId:job.assigned_user_id,senderUserId:sender?.id,type:finalType,job,eventKey:`${finalType}:${job.id}:${job.assigned_user_id}:${job.updated_at||job.created_at||Date.now()}`,titleEn:subtask?'Part-work assigned to you':'New job assigned to you',titleHu:subtask?'Részmunka került hozzád':'Új munkát rendeltek hozzád',bodyEn:jobDescription(job),bodyHu:jobDescription(job),metadata:{job_id:job.id}});
}
function nyLocalDateTime(date){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'}).formatToParts(date).reduce((a,p)=>(a[p.type]=p.value,a),{});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function notificationDateKey(value){
  const match=String(value||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match?`${match[1]}-${match[2]}-${match[3]}`:'';
}
function notificationUrgency(targetDate,now=new Date()){
  const targetKey=notificationDateKey(targetDate),todayKey=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  if(!targetKey)return null;
  const parse=key=>{const [y,m,d]=key.split('-').map(Number);return Date.UTC(y,m-1,d);};
  const days=Math.round((parse(targetKey)-parse(todayKey))/86400000);
  if(days<=0)return 'URGENT_OVERDUE';
  if(days<=7)return 'DUE_SOON';
  if(days<=14)return 'UPCOMING';
  return null;
}
function notificationLocalDateTime(value){
  const raw=String(value||'').trim().replace(' ','T');
  const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if(!match)return '';
  const normalized=`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  const date=new Date(`${normalized}:00Z`);
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,16)!==normalized)return '';
  return normalized;
}
function appendNotificationNote(existing,note,label){
  const cleanNote=String(note||'').replace(/\u0000/g,'').trim().slice(0,2000);
  if(!cleanNote)return String(existing||'');
  const entry=`[${new Date().toISOString()}] ${label}: ${cleanNote}`;
  return [String(existing||'').trim(),entry].filter(Boolean).join('\n');
}
function notificationJobEnd(startTime,durationMinutes){
  const normalized=notificationLocalDateTime(startTime);
  if(!normalized)return '';
  const date=new Date(`${normalized}:00Z`);
  date.setUTCMinutes(date.getUTCMinutes()+Math.max(15,Number(durationMinutes||15)));
  return date.toISOString().slice(0,16);
}
function generateOneHourReminders(){
  try{
    const from=nyLocalDateTime(new Date(Date.now()+55*60000)),to=nyLocalDateTime(new Date(Date.now()+65*60000));
    const rows=db.prepare(jobsSelectSql("WHERE j.status NOT IN ('Completed','Failed') AND j.start_time>=? AND j.start_time<=? AND j.assigned_user_id IS NOT NULL")).all(from,to);
    rows.forEach(job=>createNotification({recipientUserId:job.assigned_user_id,type:'JOB_STARTING_IN_ONE_HOUR',job,eventKey:`ONE_HOUR:${job.id}:${job.start_time}`,titleEn:'Job starts in one hour',titleHu:'A munkád egy órán belül kezdődik',bodyEn:jobDescription(job),bodyHu:jobDescription(job),metadata:{job_id:job.id,start_time:job.start_time}}));
  }catch(error){console.warn('one-hour reminder scan failed:',error.message);}
}

function hasPermission(user, permission){
  if(isSuperadminUser(user)) return true;
  if(!user) return false;
  const row=db.prepare('SELECT enabled FROM role_permissions WHERE role=? AND permission=?').get(user.role,permission);
  return !!(row && Number(row.enabled)===1);
}
function requirePermission(permission){return (req,res,next)=>hasPermission(req.user,permission)?next():res.status(403).json({error:'PERMISSION_DENIED'});}
function createBackup(createdBy='SYSTEM'){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const name=`klavierhaus-backup-${stamp}.sqlite`;
  const target=path.join(BACKUP_DIR,name);
  db.pragma('wal_checkpoint(FULL)');
  fs.copyFileSync(DB_PATH,target);
  const size=fs.statSync(target).size;
  const id=rid('BKP');
  db.prepare('INSERT INTO backup_log(id,file_name,file_path,file_size,status,created_by) VALUES(?,?,?,?,?,?)').run(id,name,target,size,'SUCCESS',createdBy);
  return db.prepare('SELECT id,file_name,file_size,status,created_by,created_at,restored_at,restored_by FROM backup_log WHERE id=?').get(id);
}
function maybeWeeklyBackup(){
  try{const last=db.prepare("SELECT created_at FROM backup_log WHERE status='SUCCESS' ORDER BY created_at DESC LIMIT 1").get();
    if(!last || Date.now()-new Date(last.created_at+'Z').getTime()>=7*24*60*60*1000) createBackup('SYSTEM');
  }catch(e){console.warn('weekly backup failed:',e.message)}
}
maybeWeeklyBackup();
setInterval(maybeWeeklyBackup,12*60*60*1000).unref();
function validMagic(filePath){
  const b=fs.readFileSync(filePath); if(!b.length) return false;
  const pdf=b.slice(0,5).toString()==='%PDF-';
  const jpg=b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF;
  const png=b.length>=8&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47;
  return pdf||jpg||png;
}
const upload=createDocumentUpload(UPLOAD_DIR);

app.use(cors());
app.use(compression({threshold:1024}));
app.post('/api/webhooks/stripe',express.raw({type:'application/json',limit:'1mb'}),(req,res)=>stripeSandbox.handleWebhook(req,res));
app.post('/api/webhooks/resend',express.raw({type:'application/json',limit:'1mb'}),(req,res)=>{
  try{
    const payload=Buffer.isBuffer(req.body)?req.body.toString('utf8'):String(req.body||'');
    const event=transactionalEmail.verifyWebhook({
      payload,
      id:req.headers['svix-id'],
      timestamp:req.headers['svix-timestamp'],
      signature:req.headers['svix-signature']
    });
    accountActivation.recordWebhook(event,String(req.headers['svix-id']||''));
    res.json({received:true});
  }catch(error){
    const status=error?.code==='EMAIL_WEBHOOK_NOT_CONFIGURED'?503:400;
    res.status(status).json({error:status===503?'EMAIL_WEBHOOK_NOT_CONFIGURED':'INVALID_EMAIL_WEBHOOK'});
  }
});
app.use(express.json({limit:"10mb"}));
const brandingUpload=createBrandingUpload(UPLOAD_DIR);
const eventImageUpload=createEventImageUpload(EVENT_IMAGE_DIR);
const websiteImageUpload=createWebsiteImageUpload(WEBSITE_IMAGE_DIR);
const clientImportUpload=createClientImportUpload();
const customerConversationUpload=createCustomerConversationUpload(UPLOAD_DIR);
function imageDimensions(filePath){
  const b=fs.readFileSync(filePath);
  if(b.length>=24 && b.toString('hex',0,8)==='89504e470d0a1a0a') return {type:'image/png',width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
  if(b.length>4 && b[0]===0xff && b[1]===0xd8){
    let i=2;
    while(i+9<b.length){
      if(b[i]!==0xff){i++;continue;}
      const marker=b[i+1]; i+=2;
      if(marker===0xd8||marker===0xd9) continue;
      const len=b.readUInt16BE(i); if(len<2||i+len>b.length) break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return {type:'image/jpeg',height:b.readUInt16BE(i+3),width:b.readUInt16BE(i+5)};
      i+=len;
    }
  }
  return null;
}
function getBranding(){
  const rows=db.prepare("SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('company_name','short_name','logo_url','login_background_url','branding_version')").all();
  const out={company_name:'Klavierhaus',short_name:'KH ERP',logo_url:'/icons/icon-512.png',login_background_url:'',branding_version:'1'};
  rows.forEach(r=>out[r.setting_key]=r.setting_value??out[r.setting_key]);
  return out;
}
function setSetting(key,value,userName=''){
  db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(key,value,userName);
}
function bumpBrandingVersion(userName=''){
  setSetting('branding_version',String(Date.now()),userName);
}
app.get('/api/public/branding',(_req,res)=>res.json(getBranding()));
app.get('/health',(_req,res)=>res.status(200).json({
  status:'ok',
  service:'klavierhaus-erp',
  version:VERSION,
  commit:DEPLOYMENT_COMMIT,
  database:db.open?'connected':'closed'
}));
app.get('/manifest.webmanifest',(_req,res)=>{const b=getBranding();res.type('application/manifest+json').send(JSON.stringify({name:b.company_name,short_name:b.short_name,start_url:'/',display:'standalone',background_color:'#07101d',theme_color:'#07101d',icons:[{src:`${b.logo_url}${b.logo_url.includes('?')?'&':'?'}v=${b.branding_version}`,sizes:'192x192 512x512',type:/\.jpe?g(?:$|\?)/i.test(b.logo_url)?'image/jpeg':'image/png',purpose:'any maskable'}]},null,2));});
app.use("/uploads", express.static(UPLOAD_DIR,{etag:true,lastModified:true,maxAge:"5m"}));
app.use(express.static(path.join(__dirname, "..", "public"),{
  etag:true,
  lastModified:true,
  maxAge:"5m",
  setHeaders(res,filePath){
    if(/(?:index\.html|service-worker\.js|app\.js|workshop-shell\.js|styles\.css)$/i.test(filePath))res.setHeader("Cache-Control","no-cache");
  }
}));
// Global protection: only superadmin may call DELETE endpoints. The single
// event-record and public-content catalog routes apply their own stricter
// business rules. They are intentionally the only admin DELETE exceptions.
app.use('/api',(req,res,next)=>{
  if(req.method!=='DELETE') return next();
  // The Phase I card contract performs its own database-backed auth and Admin check.
  if(/^\/workshop-shell\/cards\/[^/]+$/.test(req.path)) return next();
  const h=req.headers.authorization||'';
  try{req.user=req.user||jwt.verify(h.startsWith('Bearer ')?h.slice(7):'',JWT_SECRET);}catch(e){return res.status(401).json({error:'AUTH_REQUIRED'});}
  if(/^\/events\/[^/]+$/.test(req.path)||/^\/(?:website-reviews|website-services|showroom-pianos|website-artists)\/[^/]+$/.test(req.path)) return next();
  if(!isSuperadminUser(req.user)) return res.status(403).json({error:'PERMISSION_DENIED'});
  next();
});
// Automatic audit trail for all business-changing API requests, including
// PATCH and superadmin actions. Route-level audit entries remain useful for
// domain detail; this middleware supplies the complete request envelope.
app.use('/api',(req,res,next)=>{
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method) || req.path==='/login') return next();
  const started=Date.now();
  res.on('finish',()=>{
    if(req.skipAutoAudit || req.path.startsWith('/audit-log')) return;
    const safeBody=redactPasswordFields(req.body||{});
    const isWork=req.path==='/jobs'||req.path.startsWith('/jobs/');
    audit(req,req.method,isWork?'jobs':(req.path.split('/')[1]||'api'),req.params?.id||'',null,safeBody,res.statusCode<400?1:0,`${req.path} (${res.statusCode}) ${Date.now()-started}ms`,isWork?'WORK':'TECHNICAL');
  });
  next();
});

function rid(prefix){ return `${prefix}-${Date.now()}-${Math.floor(Math.random()*9999)}`; }

function ensure1099PartnerForUser(userId, { force = false } = {}) {
  const user = db.prepare("SELECT id,name,email,contact_email,phone,address,role,status,hidden_user FROM users WHERE id=?").get(userId);
  if (!user || Number(user.hidden_user || 0) === 1) return null;
  const requiresPartner = force || user.role === "WORKER";
  if (!requiresPartner) return null;
  const linked = db.prepare(`SELECT p.* FROM partner_contractors pc JOIN partners p ON p.id=pc.partner_id WHERE pc.user_id=? ORDER BY CASE WHEN p.status='active' THEN 0 ELSE 1 END,p.created_at,p.id`).all(user.id);
  if (linked.length) {
    const chosen = linked[0];
    if (chosen.status !== "active") db.prepare("UPDATE partners SET status='active' WHERE id=?").run(chosen.id);
    return db.prepare("SELECT * FROM partners WHERE id=?").get(chosen.id);
  }
  const partnerId = rid("PTN");
  const contractorId = rid("PC");
  const companyName = `${String(user.name || user.email || user.id).trim()} - 1099 Contractor`;
  db.prepare(`INSERT INTO partners(id,company_name,tax_id,billing_address,contact_person,contact_email,contact_phone,default_tax_rate,status) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(partnerId, companyName, "", String(user.address || ""), String(user.name || ""), String(user.contact_email || user.email || ""), String(user.phone || ""), 0, "active");
  db.prepare("INSERT INTO partner_contractors(id,partner_id,user_id,worker_name) VALUES(?,?,?,NULL)").run(contractorId, partnerId, user.id);
  return db.prepare("SELECT * FROM partners WHERE id=?").get(partnerId);
}

function ensureExisting1099PartnerAssignments() {
  try {
    const workers = db.prepare("SELECT id FROM users WHERE role='WORKER' AND status='Active' AND COALESCE(hidden_user,0)=0").all();
    const tx = db.transaction(() => workers.forEach((row) => ensure1099PartnerForUser(row.id, { force: true })));
    tx();
  } catch (error) {
    console.warn("1099 partner assignment bootstrap skipped:", error.message);
  }
}
ensureExisting1099PartnerAssignments();
function normalizeUserEmail(value){ return String(value||'').trim().toLowerCase(); }
function isValidUserEmail(value){ return /^[^\s@]+@[^\s@]+$/.test(String(value||'')); }
function normalizeContactEmail(value){ return String(value||'').trim().toLowerCase(); }
function isValidContactEmail(value){
  const email=normalizeContactEmail(value);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return false;
  const domain=email.split('@')[1]||'';
  return !domain.endsWith('.local') && domain!=='localhost';
}
function userAuditSnapshot(value){
  if(!value)return null;
  const {password_hash:_passwordHash,...safe}=value;
  return safe;
}
function redactPasswordFields(value){
  if(Array.isArray(value))return value.map(redactPasswordFields);
  if(!value || typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[
    key,
    (String(key).toLowerCase().includes('password') || ['activation_code','activation_token','code_hash'].includes(String(key).toLowerCase()))?'[REDACTED]':redactPasswordFields(item)
  ]));
}
function nextContactId(){
  const rows = db.prepare("SELECT id FROM contacts WHERE id LIKE 'C-%'").all();
  let max = 0;
  for(const r of rows){
    const m = String(r.id||"").match(/^C-(\d{1,5})$/);
    if(m) max = Math.max(max, Number(m[1]));
  }
  const next = Math.min(max + 1, 99999);
  return `C-${String(next).padStart(5,"0")}`;
}
function structuredContactAddress(body={}){
  return [body.address_line1,body.city,[body.state,body.postal_code].filter(Boolean).join(" "),body.country].map(value=>String(value||"").trim()).filter(Boolean).join(", ");
}
function ensurePianoBrand(brand){
  const value=String(brand||"").trim();
  if(!value)return "";
  db.prepare("INSERT OR IGNORE INTO piano_brands(brand_name,active) VALUES(?,1)").run(value);
  return value;
}
function ensurePianoModel(brand,model){
  const brandName=ensurePianoBrand(brand),modelName=String(model||"").trim();
  if(!brandName||!modelName)return "";
  db.prepare("INSERT OR IGNORE INTO piano_model_catalog(brand_name,model_name,active) VALUES(?,?,1)").run(brandName,modelName);
  return modelName;
}
function today(){ return new Date().toISOString().slice(0,10); }
function nowISO(){ return new Date().toISOString(); }
function nyToday(){
  return new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
}
function balanceAccountFromPaymentMethod(payment){
  const p=String(payment||"").trim().toLowerCase();
  if(p.includes("cash")) return "CASH";
  if(p.includes("check") || p.includes("cheque")) return "CHECKS";
  if(p.includes("bank") || p.includes("transfer") || p.includes("card") || p.includes("credit")) return "BANK";
  if(p.includes("invoice")) return "AR";
  return "BANK";
}

function generatePlannedJobKey(){
  const year=new Date().getFullYear();
  const rows=db.prepare("SELECT planned_key FROM planned_jobs WHERE planned_key LIKE ?").all(`PLN-${year}-%`);
  let max=0;
  for(const r of rows){
    const m=String(r.planned_key||"").match(/-(\d{4,})$/);
    if(m) max=Math.max(max, Number(m[1]));
  }
  return `PLN-${year}-${String(max+1).padStart(4,"0")}`;
}
function isActivePlannedStatus(status){
  return !["Converted / Naptárba helyezve","Archived / Archivált","Cancelled / Törölve"].includes(String(status||""));
}
function isValidTimeRange(startTime,endTime){
  const start=localDateTimeValue(startTime);
  const end=localDateTimeValue(endTime);
  return Number.isFinite(start) && Number.isFinite(end) && end>start;
}
function localDateTimeValue(value){
  const match=String(value||"").trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if(!match)return NaN;
  const [,year,month,day,hour,minute,second="0"]=match;
  const stamp=Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second));
  const date=new Date(stamp);
  if(date.getUTCFullYear()!==Number(year)||date.getUTCMonth()!==Number(month)-1||date.getUTCDate()!==Number(day)||date.getUTCHours()!==Number(hour)||date.getUTCMinutes()!==Number(minute))return NaN;
  return stamp;
}
function isFiveMinuteTime(value){ return isScheduleTime(value); }
function timeRangeMinutes(startTime,endTime){ return domainTimeRangeMinutes(startTime,endTime); }
function isFiveMinuteDurationHours(value){ return isScheduleDurationHours(value); }
function findScheduleConflicts(assignedUserId,assignedTo,startTime,endTime,excludeJobId=null){
  if((!assignedUserId&&!assignedTo) || !startTime || !endTime) return [];
  let sql=`SELECT id,job_key,title,assigned_user_id,assigned_to,start_time,end_time,status FROM jobs
           WHERE (
             (COALESCE(?, '')<>'' AND assigned_user_id=?)
             OR ((assigned_user_id IS NULL OR assigned_user_id='') AND lower(trim(assigned_to))=lower(trim(?)))
           )
             AND COALESCE(status,'Open')<>'Cancelled'
             AND (? < end_time AND ? > start_time)`;
  const userId=String(assignedUserId||"");
  const params=[userId,userId,String(assignedTo||""),startTime,endTime];
  if(excludeJobId){ sql += " AND id<>?"; params.push(excludeJobId); }
  sql += " ORDER BY start_time";
  return db.prepare(sql).all(...params);
}
function scheduleConflictPayload(req,assigned,conflicts){
  const self=String(assigned?.id||"")===String(req.user?.id||"");
  const conflict=conflicts[0]||{};
  return {
    error:self?'SELF_SCHEDULE_CONFLICT':'WORKER_SCHEDULE_CONFLICT',
    assigned_user_id:assigned?.id||null,
    assigned_name:assigned?.name||conflict.assigned_to||'',
    conflict,
    conflicts
  };
}
function rejectScheduleConflict(req,res,assigned,conflicts){
  return res.status(409).json(scheduleConflictPayload(req,assigned,conflicts));
}
function inventoryCategoryCode(category){
  const c=String(category||"").toLowerCase();
  if(c.includes("upright")) return "UPR";
  if(c === "piano" || c.includes("grand")) return "PNO";
  if(c.includes("part")) return "PRT";
  if(c.includes("tool")) return "TOL";
  if(c.includes("machine")) return "MCH";
  if(c.includes("equipment")) return "EQP";
  if(c.includes("material")) return "MAT";
  if(c.includes("accessory")) return "ACC";
  if(c.includes("office")) return "OFF";
  return "OTH";
}
function nyYear(){
  return new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric"}).format(new Date());
}
function addMonthsToDate(dateStr, months){
  const d=new Date(`${dateStr}T00:00:00`);
  d.setMonth(d.getMonth()+months);
  return d.toISOString().slice(0,10);
}
function generateInventoryId(mainCategory){
  const year=nyYear();
  const code=inventoryCategoryCode(mainCategory);
  const rows=db.prepare("SELECT inventory_id FROM inventory_items WHERE inventory_id LIKE ?").all(`INV-${year}-%`);
  let max=0;
  for(const r of rows){
    const m=String(r.inventory_id||"").match(/-(\d{4,})$/);
    if(m) max=Math.max(max, Number(m[1]||0));
  }
  return `INV-${year}-${code}-${String(max+1).padStart(4,"0")}`;
}
function inventoryItemValue(item){
  const unitCost=Number(item.purchase_price||0) || Number(item.manufacturing_cost||0) || 0;
  return unitCost * Number(item.quantity||1);
}
function inventoryRowsActive(){
  return db.prepare("SELECT * FROM inventory_items WHERE COALESCE(status,'')!='Deleted' ORDER BY created_at DESC").all();
}

const invoiceEngine=createInvoiceEngine({db,balanceAccountFromPaymentMethod});
function reconcileCentralEventInvoices(){
  const payments=db.prepare("SELECT * FROM event_payments WHERE status='PAID' AND amount_total>0 ORDER BY created_at,id").all();
  for(const payment of payments){
    const event=db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);
    const tickets=db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);
    if(event&&tickets.length)businessDocuments.ensurePaymentInvoice(payment,event,tickets);
  }
  const standaloneTickets=db.prepare(`SELECT * FROM event_tickets WHERE event_payment_id IS NULL AND price_cents>0 AND payment_status IN ('PENDING','PAID') ORDER BY created_at,id`).all();
  for(const ticket of standaloneTickets){
    const event=db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);
    if(event)businessDocuments.ensureTicketInvoice(ticket,event,{status:ticket.payment_status==='PAID'?'paid':'issued'});
  }
}
try{reconcileCentralEventInvoices();}catch(error){console.error("Event invoice reconciliation failed:",error);}
const jobDomain=createJobDomain({db,rid,balanceAccountFromPaymentMethod,invoiceEngine});
function createFinancialItemForClosedJob(job, logId, billed, payment, userName){
  return jobDomain.postClosedJobRevenue(job,{logId,billedAmount:billed,paymentMethod:payment,createdBy:userName||"System"});
}


function xmlDecode(value){
  return String(value??'')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
function excelColumnIndex(ref){
  const letters=String(ref||'').match(/[A-Z]+/i)?.[0]?.toUpperCase()||'';
  let n=0; for(const ch of letters)n=n*26+(ch.charCodeAt(0)-64); return Math.max(0,n-1);
}
function parseSharedStrings(xml){
  if(!xml)return [];
  const out=[];
  for(const match of xml.matchAll(/<(?:[A-Za-z0-9_]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?si>/g)){
    const parts=[...match[1].matchAll(/<(?:[A-Za-z0-9_]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g)].map(x=>xmlDecode(x[1]));
    out.push(parts.join(''));
  }
  return out;
}
function parseXlsxSheets(buffer){
  const zip=new AdmZip(buffer);
  const read=name=>zip.getEntry(name)?.getData().toString('utf8')||'';
  const workbook=read('xl/workbook.xml');
  const rels=read('xl/_rels/workbook.xml.rels');
  if(!workbook||!rels)throw new Error('INVALID_XLSX_STRUCTURE');
  const relationships=new Map();
  for(const m of rels.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)){
    const attrs=m[1],id=attrs.match(/\bId="([^"]+)"/)?.[1]||'',target=attrs.match(/\bTarget="([^"]+)"/)?.[1]||'';
    if(id&&target)relationships.set(id,target);
  }
  const shared=parseSharedStrings(read('xl/sharedStrings.xml'));
  const sheets=[];
  for(const m of workbook.matchAll(/<(?:[A-Za-z0-9_]+:)?sheet\b([^>]*)\/?>(?:<\/(?:[A-Za-z0-9_]+:)?sheet>)?/g)){
    const attrs=m[1],name=xmlDecode(attrs.match(/\bname="([^"]*)"/)?.[1]||''),relId=attrs.match(/\br:id="([^"]+)"/)?.[1]||'';
    let target=relationships.get(relId)||'';
    if(!target)continue;
    target=target.replace(/^\//,'');if(!target.startsWith('xl/'))target='xl/'+target.replace(/^\.\//,'');
    const sheetXml=read(target);if(!sheetXml)continue;
    const rows=[];
    for(const rowMatch of sheetXml.matchAll(/<(?:[A-Za-z0-9_]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?row>/g)){
      const row=[];
      for(const cMatch of rowMatch[1].matchAll(/<(?:[A-Za-z0-9_]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?c>)/g)){
        const attrs=cMatch[1],body=cMatch[2]||'',ref=attrs.match(/\br="([^"]+)"/)?.[1]||'',type=attrs.match(/\bt="([^"]+)"/)?.[1]||'',col=excelColumnIndex(ref);
        let value='';
        if(type==='inlineStr')value=[...body.matchAll(/<(?:[A-Za-z0-9_]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g)].map(x=>xmlDecode(x[1])).join('');
        else{const raw=xmlDecode(body.match(/<(?:[A-Za-z0-9_]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?v>/)?.[1]||'');value=type==='s'?(shared[Number(raw)]??''):raw;}
        row[col]=value;
      }
      rows.push(row);
    }
    sheets.push({name,rows});
  }
  return sheets;
}
function parseXlsxSheet(buffer,sheetName){
  const sheet=parseXlsxSheets(buffer).find(item=>item.name===sheetName);
  if(!sheet)throw new Error('IMPORT_READY_SHEET_MISSING');
  return sheet.rows;
}
function normalizeText(value){return String(value??'').trim().toLowerCase().replace(/\s+/g,' ');}
function normalizeEmailList(value){return String(value??'').split(/[;,\n]+/).map(x=>x.trim().toLowerCase()).filter(x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));}
function normalizePhones(value){
  const out=[];
  for(const line of String(value??'').split(/\n+/)){
    if(/fax/i.test(line))continue;
    const digits=line.replace(/\D/g,'');
    if(digits.length>=7)out.push(digits.length>10?digits.slice(-10):digits);
  }
  return [...new Set(out)];
}
function excelDateToIso(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const text=String(value).trim();
  if(/^\d+(?:\.\d+)?$/.test(text)){
    const n=Number(text);
    if(n>=30000&&n<=60000)return new Date(Date.UTC(1899,11,30)+Math.round(n*86400000)).toISOString().slice(0,10);
  }
  const d=new Date(text); return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}
function analyzeClientImportFile(buffer,originalFilename){
  const existing=db.prepare('SELECT id,name,email,phone,address,external_reference,import_source FROM contacts').all();
  return analyzeClientWorkbook(buffer,originalFilename,existing);
}

function normalizePianoDescription(value){
  return String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function analyzePianoImportFile(buffer,originalFilename){
  const rows=parseXlsxSheet(buffer,'Piano Import Ready');
  if(!rows.length)throw new Error('PIANO_IMPORT_READY_EMPTY');
  const headers=(rows[0]||[]).map(x=>String(x??'').trim());
  const required=['Piano External Reference','Client External Reference','Client Name','Owner Resolution','Original Source Description','Import Piano Description','Location','Ownership Type','Status','Source Rows','Source Piano Sheet Row','Import Decision'];
  const missing=required.filter(h=>!headers.includes(h));
  if(missing.length){const e=new Error('MISSING_COLUMNS');e.missingColumns=missing;throw e;}
  const index=Object.fromEntries(headers.map((h,i)=>[h,i]));
  const source='NEW_YORK_CUSTOMER_LIST_2024_PIANOS';
  const clientSource='NEW_YORK_CUSTOMER_LIST_2024';
  const clients=db.prepare('SELECT id,name,external_reference,import_source,has_piano FROM contacts').all();
  const clientByRef=new Map(clients.filter(x=>x.import_source===clientSource&&x.external_reference).map(x=>[String(x.external_reference),x]));
  const existing=db.prepare('SELECT id,display_name,original_description,owner_contact_id,external_reference,import_source FROM pianos').all();
  const exactRefs=new Map(existing.filter(x=>x.import_source&&x.external_reference).map(x=>[`${x.import_source}::${x.external_reference}`,x]));
  const existingOwnerDescription=new Map();
  for(const p of existing){
    const d=normalizePianoDescription(p.original_description||p.display_name);
    if(p.owner_contact_id&&d&&!existingOwnerDescription.has(`${p.owner_contact_id}::${d}`))existingOwnerDescription.set(`${p.owner_contact_id}::${d}`,p);
  }
  const seenRefs=new Set(); const records=[];
  for(let r=1;r<rows.length;r++){
    const cells=rows[r]||[]; if(!cells.some(v=>String(v??'').trim()))continue;
    const get=h=>String(cells[index[h]]??'').trim();
    const rec={rowNumber:r+1,externalReference:get('Piano External Reference'),clientExternalReference:get('Client External Reference'),clientName:get('Client Name'),ownerResolution:get('Owner Resolution'),originalDescription:get('Original Source Description'),description:get('Import Piano Description'),location:get('Location'),ownershipType:get('Ownership Type')||'Customer owned',status:get('Status')||'Active',sourceRows:get('Source Rows'),sourcePianoSheetRow:get('Source Piano Sheet Row'),importDecision:get('Import Decision')};
    let category='NEW_MATCHED',reason='',client=null,match=null;
    if(normalizeText(rec.importDecision)!=='import'){category='INVALID';reason='IMPORT_DECISION_NOT_IMPORT';}
    else if(!rec.externalReference){category='INVALID';reason='MISSING_PIANO_EXTERNAL_REFERENCE';}
    else if(seenRefs.has(rec.externalReference)){category='INVALID';reason='DUPLICATE_REFERENCE_IN_FILE';}
    else if(!rec.description){category='INVALID';reason='MISSING_PIANO_DESCRIPTION';}
    else{
      seenRefs.add(rec.externalReference);
      match=exactRefs.get(`${source}::${rec.externalReference}`)||null;
      if(match){category='ALREADY_IMPORTED';reason='EXTERNAL_REFERENCE_MATCH';}
      else if(normalizeText(rec.ownerResolution)==='unidentified owner'&&!rec.clientExternalReference){category='NEW_UNIDENTIFIED_OWNER';reason='UNIDENTIFIED_OWNER_ALLOWED';}
      else{
        client=clientByRef.get(rec.clientExternalReference)||null;
        if(!client){category='CLIENT_NOT_FOUND';reason='CLIENT_EXTERNAL_REFERENCE_NOT_FOUND';}
        else{
          const descMatch=existingOwnerDescription.get(`${client.id}::${normalizePianoDescription(rec.description)}`)||null;
          if(descMatch){category='POSSIBLE_DUPLICATE';reason='OWNER_DESCRIPTION_MATCH';match=descMatch;}
        }
      }
    }
    rec.category=category;rec.reason=reason;rec.client=client;rec.match=match;records.push(rec);
  }
  if(!records.length)throw new Error('PIANO_IMPORT_READY_EMPTY');
  const count=cat=>records.filter(x=>x.category===cat).length;
  const matchedClients=new Set(records.filter(x=>x.category==='NEW_MATCHED'&&x.client).map(x=>x.client.id));
  const clientCounts={}; for(const rec of records.filter(x=>x.category==='NEW_MATCHED'&&x.client)){clientCounts[rec.client.id]=(clientCounts[rec.client.id]||0)+1;}
  const multiClientRows=Object.entries(clientCounts).filter(([,n])=>n>1).map(([id,n])=>{const c=clients.find(x=>x.id===id);return {id,name:c?.name||id,count:n};});
  const summary={filename:originalFilename,totalRows:records.length,newMatched:count('NEW_MATCHED'),newUnidentifiedOwner:count('NEW_UNIDENTIFIED_OWNER'),alreadyImported:count('ALREADY_IMPORTED'),clientNotFound:count('CLIENT_NOT_FOUND'),possibleDuplicates:count('POSSIBLE_DUPLICATE'),invalidRows:count('INVALID'),clientsReceivingPianos:matchedClients.size,clientsChangingToOwner:[...matchedClients].filter(id=>!Number(clients.find(x=>x.id===id)?.has_piano||0)).length,multiplePianoClients:multiClientRows.length};
  return {source,clientSource,headers,summary,records,multiplePianoClients:multiClientRows};
}

function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token) return res.status(401).json({error:"Missing token"});
  try{
    const tokenUser=jwt.verify(token, JWT_SECRET);
    const currentUser=db.prepare("SELECT id,name,email,contact_email,role,status,google_calendar_email,hidden_user,is_superadmin,session_version FROM users WHERE id=? AND status='Active'").get(tokenUser.id);
    if(!currentUser) return res.status(401).json({error:"User no longer exists or is inactive"});
    if(Number(tokenUser.session_version||0)!==Number(currentUser.session_version||0)) return res.status(401).json({error:"SESSION_REVOKED"});
    req.user={...tokenUser,...currentUser,role:Number(currentUser.is_superadmin||0)===1?'SUPERADMIN':currentUser.role};
    next();
  } catch(e){
    res.status(401).json({error:"Invalid token"});
  }
}
function isSuperadminUser(user){ return user && (user.role === "SUPERADMIN" || Number(user.is_superadmin||0) === 1); }
function canManageCalendarColors(user){ return Boolean(user && (isSuperadminUser(user) || user.role === "ADMIN")); }
function permit(...roles){ return (req,res,next)=> (isSuperadminUser(req.user) || roles.includes(req.user.role)) ? next() : res.status(403).json({error:"Forbidden"}); }
function requireSuperadmin(req,res,next){ return isSuperadminUser(req.user) ? next() : res.status(403).json({error:"Superadmin only / Csak szuperadmin"}); }
registerEventRoutes({
  app,
  db,
  auth,
  permit,
  requireSuperadmin,
  audit,
  transactionalEmail,
  onTicketsIssued: businessDocuments.sendTicketDocuments,
  eventImageUpload,
  eventImageDir:EVENT_IMAGE_DIR,
  ticketService,
  websiteBaseUrl:process.env.WEBSITE_BASE_URL||"https://klavierhaus-home.onrender.com",
  erpBaseUrl:process.env.APP_BASE_URL||"https://klavierhaus-erp.onrender.com",
  stripeSandbox,
  invoiceEngine,
  documentService: businessDocuments
});
registerWebsiteContentRoutes({
  app,
  db,
  auth,
  permit,
  audit,
  websiteImageUpload,
  websiteImageDir:WEBSITE_IMAGE_DIR,
  websiteBaseUrl:process.env.WEBSITE_BASE_URL||"https://klavierhaus-home.onrender.com",
  erpBaseUrl:process.env.APP_BASE_URL||"https://klavierhaus-erp.onrender.com"
});
registerWebsiteCatalogRoutes({
  app,
  db,
  auth,
  permit,
  audit,
  erpBaseUrl:process.env.APP_BASE_URL||"https://klavierhaus-erp.onrender.com"
});
registerWebsitePlatformRoutes({
  app,
  db,
  auth,
  permit,
  requireSuperadmin,
  audit,
  websiteImageUpload,
  websiteImageDir:WEBSITE_IMAGE_DIR,
  erpBaseUrl:process.env.APP_BASE_URL||"https://klavierhaus-erp.onrender.com",
  websiteBaseUrl:process.env.WEBSITE_BASE_URL||"https://klavierhaus-home.onrender.com",
  transactionalEmail,
  env:process.env
});
registerBusinessOperationsRoutes({
  app,
  db,
  auth,
  permit,
  audit,
  transactionalEmail,
  websiteBaseUrl:process.env.WEBSITE_BASE_URL||"https://klavierhaus-home.onrender.com",
  uploadDir:UPLOAD_DIR,
  env:process.env,
  documentService: businessDocuments,
  ticketService,
  customerConversationUpload,
  notifyUser: createNotification,
  jobDomain,
  invoiceEngine
});
registerWorkshopWorkflowRoutes({
  app,
  db,
  auth,
  permit,
  requireSuperadmin,
  rid,
  nowISO,
  upload,
  uploadDir:UPLOAD_DIR,
  notifyUser: createNotification,
  jobDomain,
  invoiceEngine
});
setInterval(()=>{
  try{stripeSandbox.expireStaleHolds();}catch(error){console.warn('Stripe Sandbox hold cleanup failed:',error.message);}
},60*1000).unref();
setInterval(()=>{
  try{ticketService.expireOnSiteReservations();}catch(error){console.warn('On-site ticket cleanup failed:',error.message);}
},60*1000).unref();
function resolveActiveUser(userId, userName){
  if(userId){const byId=db.prepare("SELECT id,name FROM users WHERE id=? AND status='Active'").get(userId);if(byId)return byId;}
  if(userName){return db.prepare("SELECT id,name FROM users WHERE lower(trim(name))=lower(trim(?)) AND status='Active' LIMIT 1").get(userName)||null;}
  return null;
}
function resolveClient(clientId, clientName){
  if(clientId){const row=db.prepare("SELECT * FROM contacts WHERE id=?").get(clientId);if(row)return row;}
  if(clientName){return db.prepare("SELECT * FROM contacts WHERE lower(trim(name))=lower(trim(?)) ORDER BY created_at LIMIT 1").get(clientName)||null;}
  return null;
}
function resolvePiano(pianoId, pianoName, clientId=null){
  if(pianoId){const row=db.prepare("SELECT * FROM pianos WHERE id=?").get(pianoId);if(row)return row;}
  if(pianoName){
    const normalized=String(pianoName||"").trim().toLowerCase();
    const rows=clientId?db.prepare(`SELECT DISTINCT p.* FROM pianos p LEFT JOIN client_pianos cp ON cp.piano_id=p.id WHERE p.owner_contact_id=? OR cp.client_id=?`).all(clientId,clientId):db.prepare("SELECT * FROM pianos").all();
    return rows.find(p=>String(p.display_name||`${p.brand||""} ${p.model||""}`.trim()).trim().toLowerCase()===normalized)||null;
  }
  return null;
}
function clientPianoLinked(clientId,pianoId){
  if(!clientId||!pianoId)return false;
  return Boolean(db.prepare("SELECT 1 FROM client_pianos WHERE client_id=? AND piano_id=? LIMIT 1").get(clientId,pianoId));
}
function linkClientPiano(clientId,pianoId){
  if(!clientId||!pianoId)return;
  db.prepare("DELETE FROM client_pianos WHERE piano_id=? AND client_id<>?").run(pianoId,clientId);
  db.prepare("INSERT OR IGNORE INTO client_pianos(id,client_id,piano_id) VALUES(?,?,?)").run(rid("CP"),clientId,pianoId);
}
function syncClientContactFromJob(clientId,body={}){
  if(!clientId)return;
  const updates=[],values=[];
  if(Object.prototype.hasOwnProperty.call(body,"client_phone")){updates.push("phone=?");values.push(String(body.client_phone??"").trim());}
  if(Object.prototype.hasOwnProperty.call(body,"service_address")){updates.push("address=?");values.push(String(body.service_address??"").trim());}
  if(!updates.length)return;
  values.push(clientId);
  db.prepare(`UPDATE contacts SET ${updates.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...values);
}
function normalizeJobRelationships(body, existing={}){
  const allowAdHocClient=Boolean(body.allow_ad_hoc_client===true||body.allow_ad_hoc_client===1||String(body.allow_ad_hoc_client||'').toLowerCase()==='true');
  const client=resolveClient(body.client_id!==undefined?body.client_id:existing.client_id, body.client_name!==undefined?body.client_name:existing.client_name);
  if(!client&&!allowAdHocClient) return {error:"CLIENT_NOT_FOUND"};
  if(!client&&allowAdHocClient)return {client:null,piano:null,adHocClient:true};
  const requestedPianoId=body.piano_id!==undefined?body.piano_id:existing.piano_id;
  const requestedPianoName=body.piano_name!==undefined?body.piano_name:existing.piano_name;
  const piano=resolvePiano(requestedPianoId,requestedPianoName,client?.id||null);
  const hasRequestedPiano=Boolean(String(requestedPianoId||"").trim()||String(requestedPianoName||"").trim());
  if(!piano&&hasRequestedPiano&&!allowAdHocClient) return {error:"PIANO_NOT_FOUND"};
  if(client&&piano&&piano.owner_contact_id&&String(piano.owner_contact_id)!==String(client.id)&&!clientPianoLinked(client.id,piano.id)) return {error:"PIANO_CLIENT_MISMATCH"};
  return {client,piano,adHocClient:!client&&allowAdHocClient};
}
function isAssignedToUser(job,user){return !!job&&!!user&&((job.assigned_user_id&&String(job.assigned_user_id)===String(user.id))||(!job.assigned_user_id&&String(job.assigned_to||"")===String(user.name||"")));}
function jobsSelectSql(where=""){
  return `SELECT j.*, COALESCE(j.workshop_workflow_id,j.workflow_id) AS linked_workshop_workflow_id, COALESCE(au.name,j.assigned_to) AS assigned_to, au.calendar_color AS assigned_calendar_color, COALESCE(cu.name,j.created_by) AS created_by, COALESCE(ru.name,j.last_reassigned_by) AS last_reassigned_by,
    ece.provider AS calendar_source,ece.review_status AS calendar_review_status,ece.conflict_flag AS calendar_conflict_flag,
    ece.creator_email AS calendar_creator_email,ece.source_updated_at AS calendar_source_updated_at,ece.external_event_id AS calendar_external_event_id,
    ece.reviewed_at AS calendar_reviewed_at
    FROM (SELECT * FROM jobs WHERE id NOT IN (SELECT job_id FROM workflow_retired_calendar_jobs)) j LEFT JOIN users au ON au.id=j.assigned_user_id LEFT JOIN users cu ON cu.id=j.created_by_user_id LEFT JOIN users ru ON ru.id=j.last_reassigned_by_user_id
    LEFT JOIN external_calendar_events ece ON ece.job_id=j.id AND ece.provider='GOOGLE' ${where}`;
}

function googleCalendarImportDetails(job){
  if(!job) return null;
  const rootId=job.workflow_root_id||job.id;
  const sourceRow=db.prepare(`SELECT review_status,reviewed_at,raw_json
    FROM external_calendar_events
    WHERE provider='GOOGLE' AND (job_id=? OR job_id=?)
    ORDER BY CASE WHEN job_id=? THEN 0 ELSE 1 END, imported_at DESC
    LIMIT 1`).get(job.id,rootId,job.id);
  if(!sourceRow || sourceRow.reviewed_at || sourceRow.review_status==='REVIEWED' || !sourceRow.raw_json) return null;
  try{
    const source=JSON.parse(sourceRow.raw_json);
    const attendees=Array.isArray(source.attendees)
      ? [...new Set(source.attendees.map(item=>String(item?.email||item?.displayName||'').trim()).filter(Boolean))]
      : [];
    return {
      title:String(source.summary||''),
      description:String(source.description||''),
      location:String(source.location||''),
      start_time:String(source.start?.dateTime||source.start?.date||''),
      end_time:String(source.end?.dateTime||source.end?.date||''),
      creator:String(source.creator?.email||source.creator?.displayName||''),
      attendees
    };
  }catch(_error){
    return null;
  }
}

const googleCalendar=createGoogleCalendarIntegration({
  db,rid,stableJobKey,nyLocalDateTime,findScheduleConflicts,
  getJob:(id)=>db.prepare(jobsSelectSql("WHERE j.id=?")).get(id),
  createNotification
});
registerSystemIntegrationRoutes({app,db,auth,requireSuperadmin,audit,googleCalendar,services:{transactionalEmail,stripeSandbox},env:process.env});

function canCloseJob(user, job){
  if(isSuperadminUser(user) || user.role === "ADMIN") return true;
  return isAssignedToUser(job,user);
}
function canEditJob(user, job){
  if(isSuperadminUser(user) || user.role === "ADMIN" || user.role === "MANAGER") return true;
  return user.role === "WORKER" && isAssignedToUser(job,user);
}

function canReassignJob(user, job){
  if(isSuperadminUser(user) || user.role === "ADMIN") return true;
  if(isAssignedToUser(job,user)) return true;
  if(user.role === "MANAGER") return true;
  return false;
}


function stableJobKey(){ return `JK-${Date.now()}-${Math.floor(Math.random()*999999)}`; }

function getJobByAnyId(rawId, body={}){
  const candidates = [];
  [rawId, body.id, body.job_id, body.job_key].forEach(v=>{
    if(v!==undefined && v!==null){
      const s=String(v).trim();
      if(s && !candidates.includes(s)) candidates.push(s);
    }
  });

  for(const id of candidates){
    const found=db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if(found) return found;
  }
  for(const key of candidates){
    const found=db.prepare("SELECT * FROM jobs WHERE job_key=?").get(key);
    if(found) return found;
  }

  const clientId = String(body.client_id || "").trim();
  const clientName = String(body.client_name || "").trim();
  const pianoName = String(body.piano_name || "").trim();
  const title = String(body.title || "").trim();

  if(clientId && title){
    const found=db.prepare("SELECT * FROM jobs WHERE client_id=? AND title=? ORDER BY updated_at DESC LIMIT 1").get(clientId,title);
    if(found) return found;
  }
  if(clientName && title){
    const found=db.prepare("SELECT * FROM jobs WHERE lower(client_name)=lower(?) AND title=? ORDER BY updated_at DESC LIMIT 1").get(clientName,title);
    if(found) return found;
  }
  if(clientName && pianoName){
    const found=db.prepare("SELECT * FROM jobs WHERE lower(client_name)=lower(?) AND lower(piano_name)=lower(?) ORDER BY updated_at DESC LIMIT 1").get(clientName,pianoName);
    if(found) return found;
  }
  return null;
}

function loginUserPayload(row){
  const isSuper=Number(row.is_superadmin||0)===1;
  return {
    id:row.id,
    name:row.name,
    email:row.email,
    contact_email:row.contact_email||'',
    google_calendar_email:row.google_calendar_email||'',
    role:isSuper?'SUPERADMIN':row.role,
    is_superadmin:isSuper?1:0,
    session_version:Number(row.session_version||0)
  };
}
function createAuthenticatedSession(row){
  const current=db.prepare("SELECT * FROM users WHERE id=? AND status='Active'").get(row?.id);
  if(!current)throw new Error('AUTH_USER_NOT_ACTIVE');
  const loginUser=loginUserPayload({...current,session_version:Number(current.session_version||0)});
  return {token:jwt.sign(loginUser,JWT_SECRET,{expiresIn:'30d'}),user:loginUser};
}
function createActivationToken(row){
  const activation=accountActivation.state(row.id);
  return jwt.sign({id:row.id,purpose:'ACCOUNT_ACTIVATION',activation_version:Number(activation?.code_version||0)},JWT_SECRET,{expiresIn:'30m'});
}
function activationUserFromToken(value){
  const decoded=jwt.verify(String(value||''),JWT_SECRET);
  if(decoded?.purpose!=='ACCOUNT_ACTIVATION'||!decoded.id)throw new Error('INVALID_ACTIVATION_SESSION');
  const row=db.prepare("SELECT * FROM users WHERE id=? AND status='Active'").get(decoded.id);
  if(!row)throw new Error('INVALID_ACTIVATION_SESSION');
  return row;
}
function activationResendCooldown(row){
  if(!row?.last_sent_at)return 0;
  const cooldownMs=process.env.NODE_ENV==='test'?Math.max(0,Number(process.env.ACTIVATION_RESEND_COOLDOWN_MS||0)):60_000;
  if(cooldownMs===0)return 0;
  const elapsed=Date.now()-Date.parse(`${row.last_sent_at}Z`);
  return Number.isFinite(elapsed)&&elapsed<cooldownMs?Math.ceil((cooldownMs-elapsed)/1000):0;
}

const LOGIN_RATE_WINDOW_MS=15*60*1000;
const LOGIN_IP_LIMIT=20;
const LOGIN_ACCOUNT_LIMIT=7;
const loginRateBuckets=new Map();
const LOGIN_DUMMY_HASH=bcrypt.hashSync("klavierhaus-invalid-login-placeholder",10);
function loginRateKey(req,email){return {ip:`ip:${String(req.ip||req.socket?.remoteAddress||"unknown")}`,account:`account:${normalizeUserEmail(email)||"unknown"}`};}
function loginRateState(key,limit,now=Date.now()){
  const bucket=loginRateBuckets.get(key);
  if(!bucket||now-bucket.windowStarted>=LOGIN_RATE_WINDOW_MS){const fresh={windowStarted:now,count:0};loginRateBuckets.set(key,fresh);return {blocked:false,bucket:fresh,retryAfter:0};}
  const retryAfter=Math.max(1,Math.ceil((LOGIN_RATE_WINDOW_MS-(now-bucket.windowStarted))/1000));
  return {blocked:bucket.count>=limit,bucket,retryAfter};
}
function consumeLoginFailure(req,email){const now=Date.now(),keys=loginRateKey(req,email);for(const [key,limit] of [[keys.ip,LOGIN_IP_LIMIT],[keys.account,LOGIN_ACCOUNT_LIMIT]]){const state=loginRateState(key,limit,now);state.bucket.count+=1;loginRateBuckets.set(key,state.bucket);}}
function loginBlocked(req,email){const now=Date.now(),keys=loginRateKey(req,email),ip=loginRateState(keys.ip,LOGIN_IP_LIMIT,now),account=loginRateState(keys.account,LOGIN_ACCOUNT_LIMIT,now);const blocked=ip.blocked||account.blocked;return {blocked,retryAfter:Math.max(ip.retryAfter,account.retryAfter)};}
function clearLoginAccountBucket(email){loginRateBuckets.delete(`account:${normalizeUserEmail(email)||"unknown"}`);}
setInterval(()=>{const cutoff=Date.now()-LOGIN_RATE_WINDOW_MS*2;for(const [key,value] of loginRateBuckets){if(value.windowStarted<cutoff)loginRateBuckets.delete(key);}},LOGIN_RATE_WINDOW_MS).unref();
function bcryptCompareAsync(password,hash){return new Promise(resolve=>bcrypt.compare(password,hash,(error,valid)=>resolve(!error&&Boolean(valid))));}

app.post("/api/login",async(req,res)=>{
  const normalizedEmail=normalizeUserEmail(req.body?.email);
  const password=String(req.body?.password||'');
  if(!normalizedEmail || !password) return res.status(400).json({error:"REQUIRED_FIELDS"});

  const rate=loginBlocked(req,normalizedEmail);
  if(rate.blocked){res.setHeader("Retry-After",String(rate.retryAfter));return res.status(429).json({error:"LOGIN_TEMPORARILY_UNAVAILABLE"});}
  const matches=db.prepare("SELECT * FROM users WHERE lower(trim(email))=? ORDER BY created_at,id").all(normalizedEmail);
  const activeMatches=matches.filter(row=>String(row.status||'').trim().toLowerCase()==='active');
  const u=activeMatches.length===1?activeMatches[0]:null;
  const hash=u?.password_hash||LOGIN_DUMMY_HASH;
  const valid=await bcryptCompareAsync(password,hash);
  if(!u||!valid){
    consumeLoginFailure(req,normalizedEmail);
    if(!u || Number(u.is_superadmin||0)!==1) audit({user:u?{id:u.id,name:u.name,email:u.email,role:u.role,is_superadmin:0}:{id:'',name:'',email:normalizedEmail,role:'',is_superadmin:0}},'LOGIN_FAILED','authentication',u?.id||'',null,{email:normalizedEmail},0,'Invalid login','TECHNICAL');
    return res.status(401).json({error:"INVALID_LOGIN"});
  }
  clearLoginAccountBucket(normalizedEmail);
  const isSuper=Number(u.is_superadmin||0)===1;
  if(!isSuper && !VISIBLE_USER_ROLES.includes(u.role)) return res.status(403).json({error:"ACCOUNT_ROLE_INVALID"});
  const activation=accountActivation.state(u.id);
  if(activation?.status==='PENDING'){
    if(!isValidContactEmail(u.contact_email))return res.status(409).json({error:'ACTIVATION_CONTACT_EMAIL_MISSING'});
    audit({user:loginUserPayload(u)},'ACTIVATION_REQUIRED','authentication',u.id,null,{email:u.email},1,'Valid credentials; account activation required','TECHNICAL');
    return res.json({activation_required:true,activation_token:createActivationToken(u),contact_email_masked:accountActivation.maskEmail(u.contact_email)});
  }
  const session=createAuthenticatedSession(u);
  audit({user:session.user},'LOGIN','authentication',u.id,null,{email:u.email},1,'Successful login','TECHNICAL');
  res.json(session);
});
app.post('/api/account-activation/verify',(req,res)=>{
  req.skipAutoAudit=true;
  let activationUser;
  try{activationUser=activationUserFromToken(req.body?.activation_token);}catch(_error){return res.status(401).json({error:'INVALID_ACTIVATION_SESSION'});}
  const result=accountActivation.verify(activationUser.id,req.body?.activation_code);
  if(!result.ok){
    audit({user:loginUserPayload(activationUser)},'ACTIVATION_FAILED','authentication',activationUser.id,null,{reason:result.error},0,result.error,'TECHNICAL');
    const status=result.error==='ACTIVATION_TEMPORARILY_LOCKED'?429:400;
    return res.status(status).json({error:result.error,retry_after_seconds:result.retryAfterSeconds});
  }
  const session=createAuthenticatedSession(activationUser);
  audit({user:session.user},'ACCOUNT_ACTIVATED','authentication',activationUser.id,null,{status:'VERIFIED'},1,'Account activated successfully','TECHNICAL');
  res.json(session);
});
app.post('/api/account-activation/resend',async(req,res)=>{
  req.skipAutoAudit=true;
  let activationUser;
  try{activationUser=activationUserFromToken(req.body?.activation_token);}catch(_error){return res.status(401).json({error:'INVALID_ACTIVATION_SESSION'});}
  const current=accountActivation.state(activationUser.id);
  if(!current||current.status!=='PENDING')return res.status(409).json({error:'ACTIVATION_ALREADY_COMPLETED'});
  const retryAfter=activationResendCooldown(current);
  if(retryAfter)return res.status(429).json({error:'ACTIVATION_RESEND_TOO_SOON',retry_after_seconds:retryAfter});
  if(!isValidContactEmail(activationUser.contact_email))return res.status(409).json({error:'ACTIVATION_CONTACT_EMAIL_MISSING'});
  const issuance=accountActivation.issue(activationUser.id);
  const delivery=await accountActivation.deliver(activationUser,issuance,'USER_RESEND');
  audit({user:loginUserPayload(activationUser)},'ACTIVATION_RESENT','authentication',activationUser.id,null,{delivery_status:delivery.status},delivery.status==='ACCEPTED'?1:0,'Activation email resend requested','TECHNICAL');
  if(delivery.status!=='ACCEPTED')return res.status(502).json({error:delivery.error||'EMAIL_DELIVERY_FAILED'});
  res.json({ok:true,activation_token:createActivationToken(activationUser),contact_email_masked:accountActivation.maskEmail(activationUser.contact_email)});
});
app.post("/api/logout",auth,(req,res)=>{db.prepare("UPDATE users SET session_version=COALESCE(session_version,0)+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id);audit(req,'LOGOUT','authentication',req.user.id,null,{session_revoked:true},1,'User logout and session revocation','TECHNICAL');res.json({ok:true});});
app.get("/api/me", auth, (req,res)=>res.json(req.user));
app.post("/api/auth/verify-session",auth,async(req,res)=>{
  req.skipAutoAudit=true;
  const password=String(req.body?.password||"");
  if(!password)return res.status(400).json({error:"PASSWORD_REQUIRED"});
  const owner=db.prepare("SELECT id,password_hash FROM users WHERE id=? AND status='Active'").get(req.user.id);
  const valid=Boolean(owner?.password_hash)&&await bcryptCompareAsync(password,owner.password_hash);
  if(!valid){
    audit(req,'SESSION_REVERIFICATION','authentication',req.user.id,null,{reason:'INVALID_PASSWORD'},0,'Offline-lock password verification failed','TECHNICAL');
    return res.status(401).json({error:"INVALID_PASSWORD"});
  }
  audit(req,'SESSION_REVERIFICATION','authentication',req.user.id,null,{source:'OFFLINE_SECURITY_LOCK'},1,'Offline-lock session verified','TECHNICAL');
  res.setHeader('Cache-Control','no-store');
  res.json({ok:true,user:req.user});
});

app.get('/api/google-calendar/status',auth,permit('ADMIN'),(_req,res)=>res.json(googleCalendar.status()));
app.get('/api/google-calendar/auth-url',auth,requireSuperadmin,(req,res)=>{
  try{res.json({url:googleCalendar.createAuthUrl(req.user.id)});}catch(error){res.status(400).json({error:error.message});}
});
app.get('/api/google-calendar/oauth/callback',async(req,res)=>{
  try{
    const state=String(req.query.state||'');
    if(googleCalendar.isTestState(state)){
      await googleCalendar.handleTestOAuthCallback(String(req.query.code||''),state);
      return res.redirect('/?googleCalendarTest=authorized');
    }
    await googleCalendar.handleOAuthCallback(String(req.query.code||''),state);
    res.redirect('/?googleCalendar=connected');
  }catch(error){
    console.warn('Google OAuth callback failed:',error.message);
    res.redirect(`/?googleCalendar=error&reason=${encodeURIComponent(error.message)}`);
  }
});
app.post('/api/google-calendar/sync',auth,permit('ADMIN'),async(req,res)=>{
  try{res.json(await googleCalendar.syncNow('MANUAL'));}catch(error){res.status(502).json({error:error.message});}
});
app.delete('/api/google-calendar/disconnect',auth,requireSuperadmin,async(req,res)=>{
  try{res.json(await googleCalendar.disconnect());}catch(error){res.status(400).json({error:error.message});}
});
app.post('/api/google-calendar/webhook',(req,res)=>{
  if(!googleCalendar.handleWebhook(req.headers)) return res.status(403).json({error:'INVALID_GOOGLE_CHANNEL'});
  res.status(204).end();
});

app.get("/api/schedule-workers", auth, (req,res)=>{
  const rows=db.prepare("SELECT id,name,email,role,calendar_color FROM users WHERE status='Active' AND COALESCE(hidden_user,0)=0 AND role IN ('ADMIN','MANAGER','WORKER') ORDER BY name").all();
  res.json(rows);
});

app.get("/api/schedule-workers/availability", auth, (req,res)=>{
  const start=String(req.query.start_time||"");
  const end=String(req.query.end_time||"");
  const excludeJobId=String(req.query.exclude_job_id||"")||null;
  if(!isValidTimeRange(start,end)) return res.status(400).json({error:"INVALID_TIME_RANGE"});
  const rows=db.prepare("SELECT id,name,email,role,calendar_color FROM users WHERE status='Active' AND COALESCE(hidden_user,0)=0 AND role IN ('ADMIN','MANAGER','WORKER') ORDER BY name").all();
  res.json(rows.map(worker=>{
    const conflicts=findScheduleConflicts(worker.id,worker.name,start,end,excludeJobId);
    return {...worker,available:conflicts.length===0,conflicts};
  }));
});





app.post('/api/cron/notifications',(req,res)=>{
  const secret=String(process.env.CRON_SECRET||'');
  if(!secret || String(req.headers['x-cron-secret']||'')!==secret)return res.status(403).json({error:'CRON_FORBIDDEN'});
  generateOneHourReminders();res.json({ok:true,checked_at:new Date().toISOString()});
});

app.get('/api/push/public-key',auth,(req,res)=>res.json({configured:PUSH_CONFIGURED,publicKey:VAPID_PUBLIC_KEY||''}));
app.get('/api/notifications/config',auth,(req,res)=>{
  db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id,push_enabled,job_assigned,job_transferred,job_updated,job_deleted,one_hour_reminder,direct_message) VALUES(?,1,1,1,1,1,1,1)').run(req.user.id);
  res.json({configured:PUSH_CONFIGURED,publicKey:VAPID_PUBLIC_KEY||'',required:true,preferences:db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(req.user.id)});
});
app.post('/api/push/status',auth,(req,res)=>{
  const deviceId=normalizeDeviceId(req.body?.device_id);
  if(!deviceId)return res.status(400).json({error:'INVALID_DEVICE_ID'});
  const endpoint=String(req.body?.endpoint||'');
  const clientStatus=String(req.body?.status||'NOT_CONFIGURED').toUpperCase();
  const status=['NOT_CONFIGURED','ENABLED','BLOCKED','UNSUPPORTED'].includes(clientStatus)?clientStatus:'NOT_CONFIGURED';
  const subscription=endpoint?db.prepare('SELECT id,endpoint,updated_at FROM push_subscriptions WHERE user_id=? AND endpoint=?').get(req.user.id,endpoint):db.prepare('SELECT id,endpoint,updated_at FROM push_subscriptions WHERE user_id=? AND device_id=? ORDER BY updated_at DESC LIMIT 1').get(req.user.id,deviceId);
  const effective=status==='ENABLED'&&subscription?'ENABLED':status==='ENABLED'?'NOT_CONFIGURED':status;
  const device=upsertNotificationDevice(req.user.id,deviceId,{status:effective,platform:String(req.body?.platform||''),userAgent:String(req.headers['user-agent']||''),language:req.body?.language});
  res.json({configured:PUSH_CONFIGURED,required:true,status:effective,subscribed:Boolean(subscription),device});
});
app.post('/api/push/check',auth,(req,res)=>{
  const deviceId=normalizeDeviceId(req.body?.device_id);
  if(!deviceId)return res.status(400).json({error:'INVALID_DEVICE_ID'});
  const endpoint=String(req.body?.endpoint||'');
  const subscription=endpoint?db.prepare('SELECT id,verified_at FROM push_subscriptions WHERE user_id=? AND endpoint=?').get(req.user.id,endpoint):db.prepare('SELECT id,verified_at FROM push_subscriptions WHERE user_id=? AND device_id=? ORDER BY updated_at DESC LIMIT 1').get(req.user.id,deviceId);
  const device=db.prepare('SELECT * FROM notification_devices WHERE user_id=? AND device_id=?').get(req.user.id,deviceId);
  res.json({configured:PUSH_CONFIGURED,required:true,subscribed:Boolean(subscription),verified:Boolean(subscription?.verified_at),deviceStatus:device?.status||'NOT_CONFIGURED'});
});

app.post('/api/push/subscribe',auth,(req,res)=>{
  const subscription=req.body?.subscription;
  const deviceId=normalizeDeviceId(req.body?.device_id);
  if(!subscription?.endpoint||!deviceId)return res.status(400).json({error:'INVALID_PUSH_SUBSCRIPTION'});
  const existing=db.prepare('SELECT id,verified_at FROM push_subscriptions WHERE endpoint=?').get(subscription.endpoint);const id=existing?.id||rid('PSH');
  db.prepare(`INSERT INTO push_subscriptions(id,user_id,endpoint,subscription_json,user_agent,language,device_id,last_seen_at,updated_at,verified_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,user_agent=excluded.user_agent,language=excluded.language,device_id=excluded.device_id,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).run(id,req.user.id,subscription.endpoint,JSON.stringify(subscription),String(req.headers['user-agent']||''),req.body?.language==='hu'?'hu':'en',deviceId,existing?.verified_at||null);
  db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id,push_enabled) VALUES(?,1)').run(req.user.id);
  db.prepare('UPDATE notification_preferences SET push_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(req.user.id);
  const device=upsertNotificationDevice(req.user.id,deviceId,{status:'ENABLED',platform:String(req.body?.platform||''),userAgent:String(req.headers['user-agent']||''),language:req.body?.language});
  res.json({ok:true,configured:PUSH_CONFIGURED,verified:Boolean(existing?.verified_at),device});
});

app.post('/api/push/test',auth,async(req,res)=>{
  const deviceId=normalizeDeviceId(req.body?.device_id);const endpoint=String(req.body?.endpoint||'');
  if(!deviceId||!endpoint)return res.status(400).json({error:'INVALID_TEST_REQUEST'});
  const sub=db.prepare('SELECT * FROM push_subscriptions WHERE user_id=? AND endpoint=?').get(req.user.id,endpoint);
  if(!sub)return res.status(404).json({error:'SUBSCRIPTION_NOT_REGISTERED'});
  if(sub.verified_at)return res.json({ok:true,verified:true});
  const token=crypto.randomBytes(24).toString('hex');
  db.prepare("DELETE FROM push_activation_tests WHERE user_id=? AND device_id=? AND status='PENDING'").run(req.user.id,deviceId);
  db.prepare('INSERT INTO push_activation_tests(token,user_id,device_id,endpoint,status) VALUES(?,?,?,?,\'PENDING\')').run(token,req.user.id,deviceId,endpoint);
  try{await sendActivationTestPush(sub,token);res.json({ok:true,verified:false,token});}
  catch(error){db.prepare("UPDATE push_activation_tests SET status='FAILED' WHERE token=?").run(token);res.status(502).json({error:'TEST_PUSH_FAILED',detail:error.message});}
});
app.get('/api/push/test/:token',auth,(req,res)=>{const row=db.prepare('SELECT status,received_at FROM push_activation_tests WHERE token=? AND user_id=?').get(req.params.token,req.user.id);if(!row)return res.status(404).json({error:'TEST_NOT_FOUND'});res.json({status:row.status,verified:row.status==='RECEIVED',received_at:row.received_at||null});});
app.post('/api/push/test-receipt',(req,res)=>{const token=String(req.body?.token||'');if(!/^[a-f0-9]{48}$/.test(token))return res.status(400).json({error:'INVALID_TOKEN'});const row=db.prepare("SELECT * FROM push_activation_tests WHERE token=? AND status='PENDING'").get(token);if(!row)return res.json({ok:true});db.transaction(()=>{db.prepare("UPDATE push_activation_tests SET status='RECEIVED',received_at=CURRENT_TIMESTAMP WHERE token=?").run(token);db.prepare('UPDATE push_subscriptions SET verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE endpoint=?').run(row.endpoint);upsertNotificationDevice(row.user_id,row.device_id,{status:'ENABLED'});})();res.json({ok:true});});

app.delete('/api/push/subscribe',auth,(req,res)=>{const endpoint=String(req.body?.endpoint||'');const deviceId=normalizeDeviceId(req.body?.device_id);if(endpoint)db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(req.user.id,endpoint);else if(deviceId)db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND device_id=?').run(req.user.id,deviceId);else db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(req.user.id);if(deviceId)upsertNotificationDevice(req.user.id,deviceId,{status:'NOT_CONFIGURED',platform:String(req.body?.platform||''),userAgent:String(req.headers['user-agent']||''),language:req.body?.language});res.json({ok:true});});
app.get('/api/notification-preferences',auth,(req,res)=>{db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id) VALUES(?)').run(req.user.id);res.json(db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(req.user.id));});
app.put('/api/notification-preferences',auth,(req,res)=>{db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id) VALUES(?)').run(req.user.id);const fields=['push_enabled','job_assigned','job_transferred','job_updated','job_deleted','one_hour_reminder','direct_message'];const cols=fields.filter(f=>req.body[f]!==undefined);if(cols.length)db.prepare(`UPDATE notification_preferences SET ${cols.map(f=>`${f}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE user_id=?`).run(...cols.map(f=>Number(req.body[f])?1:0),req.user.id);res.json(db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(req.user.id));});
app.get('/api/notifications',auth,(req,res)=>{const active=String(req.query.active??'1')!=='0';const rows=db.prepare(`SELECT n.*,su.name sender_name FROM notifications n LEFT JOIN users su ON su.id=n.sender_user_id WHERE n.recipient_user_id=? ${active?"AND n.status='ACTIVE'":''} ORDER BY n.created_at DESC LIMIT 500`).all(req.user.id);res.json(rows);});
app.get('/api/notifications/count',auth,(req,res)=>res.json({count:db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_user_id=? AND status='ACTIVE'").get(req.user.id).c}));
app.post('/api/notifications/:id/acknowledge',auth,(req,res)=>{const row=db.prepare('SELECT * FROM notifications WHERE id=? AND recipient_user_id=?').get(req.params.id,req.user.id);if(!row)return res.status(404).json({error:'NOTIFICATION_NOT_FOUND'});db.prepare("UPDATE notifications SET status='ACKNOWLEDGED',acknowledged_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);const count=db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_user_id=? AND status='ACTIVE'").get(req.user.id).c;res.json({ok:true,count,notificationId:row.id});});
app.get('/api/notifications/acknowledgements',auth,(req,res)=>{res.json(db.prepare("SELECT id,notification_type,title_en,title_hu,body_en,body_hu,acknowledged_at,created_at FROM notifications WHERE recipient_user_id=? AND status='ACKNOWLEDGED' ORDER BY acknowledged_at DESC,created_at DESC").all(req.user.id));});
app.post('/api/notifications/message',auth,(req,res)=>{const recipientUserId=String(req.body?.recipient_user_id||'');const message=String(req.body?.message||'').trim();if(!recipientUserId||!message)return res.status(400).json({error:'RECIPIENT_AND_MESSAGE_REQUIRED'});if(message.length>250)return res.status(400).json({error:'MESSAGE_TOO_LONG'});const recipient=db.prepare("SELECT id,name FROM users WHERE id=? AND status='Active'").get(recipientUserId);if(!recipient)return res.status(404).json({error:'RECIPIENT_NOT_FOUND'});const row=createNotification({recipientUserId,senderUserId:req.user.id,type:'DIRECT_MESSAGE',titleEn:`Message from ${req.user.name}`,titleHu:`Üzenet érkezett: ${req.user.name}`,bodyEn:message,bodyHu:message,customMessage:message,metadata:{sender_name:req.user.name}});res.json(row);});

const DEADLINE_NOTIFICATION_TYPES=new Set(['CLIENT_FOLLOWUP','CALENDAR_JOB']);
function deadlineUserCanSeeAll(user){return Boolean(user&&(isSuperadminUser(user)||user.role==='ADMIN'||user.role==='MANAGER'));}
function deadlineRow({entityType,entityId,category,title,instrumentContext,clientContext,responsibleName,targetDate,description='',phone='',workflowId='',calendarJobId='',existingNote='',delayReason='',isVip=false}){
  return {
    id:`${entityType.toLowerCase()}-${entityId}`,
    entity_type:entityType,
    entity_id:String(entityId),
    category,
    title:String(title||''),
    instrument_context:String(instrumentContext||'No instrument linked / Nincs kapcsolt hangszer'),
    client_context:String(clientContext||'No client linked / Nincs kapcsolt ügyfél'),
    responsible_name:String(responsibleName||'Unassigned / Nincs felelős'),
    target_date:targetDate,
    description:String(description||''),
    phone:String(phone||''),
    workflow_id:String(workflowId||''),
    calendar_job_id:String(calendarJobId||''),
    existing_note:String(existingNote||''),
    delay_reason:String(delayReason||''),
    is_vip:Boolean(isVip),
    source:'UNIFIED_DEADLINE_ENGINE'
  };
}
function deadlineEntityVisibleToUser(user,entityType,entityId){
  if(!user?.id||!DEADLINE_NOTIFICATION_TYPES.has(entityType))return false;
  const unrestricted=deadlineUserCanSeeAll(user);
  if(entityType==='CALENDAR_JOB'){
    const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(entityId);
    return Boolean(job&&(unrestricted||canEditJob(user,job)));
  }
  const contact=db.prepare('SELECT id FROM contacts WHERE id=?').get(entityId);
  if(!contact)return false;
  if(unrestricted)return true;
  return Boolean(db.prepare(`SELECT 1 FROM jobs WHERE COALESCE(is_crm_follow_up,0)=1 AND COALESCE(contact_id,client_id)=? AND assigned_user_id=? AND COALESCE(status,'Open') NOT IN ('Completed','Partially completed','Failed','Cancelled') LIMIT 1`).get(entityId,user.id));
}
function activeDeadlineNotifications(user){
  if(!user?.id)return [];
  const now=new Date(),nowIso=now.toISOString(),limit14=nyLocalDateTime(new Date(now.getTime()+14*86400000));
  const activeSnoozes=db.prepare(`SELECT entity_type,entity_id FROM notification_snooze_log WHERE user_id=? AND snoozed_until>?`).all(user.id,nowIso);
  const snoozed=new Set(activeSnoozes.map(row=>`${row.entity_type}:${row.entity_id}`));
  const notifications=[];
  const push=row=>{
    if(!row?.entity_id||snoozed.has(`${row.entity_type}:${row.entity_id}`))return;
    const urgency=notificationUrgency(row.target_date,now);
    if(urgency)notifications.push({...row,urgency});
  };
  const unrestricted=deadlineUserCanSeeAll(user)?1:0;
  const contacts=db.prepare(`SELECT c.id,c.name,c.phone,c.follow_up_date,c.follow_up_reason,c.is_vip,c.relationship_notes,
      j.assigned_to AS responsible_name,j.assigned_user_id
    FROM contacts c LEFT JOIN jobs j ON COALESCE(j.is_crm_follow_up,0)=1 AND COALESCE(j.contact_id,j.client_id)=c.id
      AND COALESCE(j.status,'Open') NOT IN ('Completed','Partially completed','Failed','Cancelled')
    WHERE c.follow_up_date IS NOT NULL AND trim(c.follow_up_date)<>'' AND c.follow_up_date<=?
      AND (?=1 OR j.assigned_user_id=?) ORDER BY c.follow_up_date,c.id`).all(limit14,unrestricted,user.id);
  contacts.forEach(contact=>push(deadlineRow({
    entityType:'CLIENT_FOLLOWUP',entityId:contact.id,category:'CLIENT_FOLLOWUP',title:`${Number(contact.is_vip||0)===1?'⭐ ':''}${contact.name||'Client follow-up / Ügyfélkövetés'}`,
    instrumentContext:'Client relationship follow-up / Ügyfélkapcsolati utánkövetés',clientContext:contact.name||'Client / Ügyfél',responsibleName:contact.responsible_name||contact.name||'',
    targetDate:contact.follow_up_date,description:contact.follow_up_reason||'Client follow-up / Ügyfél utánkövetés',phone:contact.phone||'',existingNote:contact.relationship_notes||'',isVip:Number(contact.is_vip||0)===1
  })));
  const jobs=db.prepare(`SELECT j.id,j.title,j.start_time,j.end_time,j.client_name,j.client_phone,j.piano_name,j.instructions,j.notes,j.completion_notes,j.status,j.assigned_to,j.assigned_user_id,
      j.is_crm_follow_up,j.contact_id,j.workshop_workflow_id,p.brand,p.model,p.display_name,p.serial_no
    FROM jobs j LEFT JOIN pianos p ON p.id=j.piano_id
    WHERE COALESCE(j.status,'Open') NOT IN ('Completed','Partially completed','Failed','Cancelled') AND j.start_time IS NOT NULL AND trim(j.start_time)<>'' AND j.start_time<=?
      AND NOT EXISTS(SELECT 1 FROM workflow_retired_calendar_jobs retired WHERE retired.job_id=j.id)
      AND (?=1 OR j.assigned_user_id=?) ORDER BY j.start_time,j.id`).all(limit14,unrestricted,user.id);
  jobs.forEach(job=>{
    const piano=[job.brand,job.model].filter(Boolean).join(' ').trim()||job.piano_name||job.serial_no||'Calendar appointment / Naptári időpont';
    push(deadlineRow({entityType:'CALENDAR_JOB',entityId:job.id,category:'CALENDAR_JOB',title:job.title||'Calendar job / Naptári munka',instrumentContext:piano,clientContext:job.client_name||'',responsibleName:job.assigned_to||'',targetDate:job.start_time,description:job.instructions||job.notes||'',phone:job.client_phone||'',workflowId:job.workshop_workflow_id||'',existingNote:job.completion_notes||''}));
  });
  notifications.sort((a,b)=>String(a.target_date).localeCompare(String(b.target_date))||String(a.id).localeCompare(String(b.id)));
  return notifications;
}

app.get('/api/notifications/active',auth,(req,res)=>{
  try{res.json({ok:true,notifications:activeDeadlineNotifications(req.user),source:'UNIFIED_DEADLINE_ENGINE'});}
  catch(error){console.error('Active deadline notification aggregation failed:',error);res.status(500).json({error:'NOTIFICATION_AGGREGATION_FAILED'});}
});

app.post('/api/notifications/snooze',auth,permit('ADMIN','MANAGER','WORKER'),(req,res)=>{
  const entityType=String(req.body?.entity_type||'').trim().toUpperCase(),entityId=String(req.body?.entity_id||'').trim();
  if(!DEADLINE_NOTIFICATION_TYPES.has(entityType)||!entityId)return res.status(400).json({error:'INVALID_NOTIFICATION_ENTITY'});
  if(!deadlineEntityVisibleToUser(req.user,entityType,entityId))return res.status(404).json({error:'NOTIFICATION_ENTITY_NOT_FOUND'});
  const snoozedUntil=new Date(Date.now()+3*60*60*1000).toISOString(),id=rid('NSZ');
  db.prepare(`INSERT INTO notification_snooze_log(id,user_id,entity_type,entity_id,snoozed_until)
    VALUES(?,?,?,?,?)
    ON CONFLICT(user_id,entity_type,entity_id) DO UPDATE SET snoozed_until=excluded.snoozed_until,created_at=CURRENT_TIMESTAMP`).run(id,req.user.id,entityType,entityId,snoozedUntil);
  audit(req,'SNOOZE','notification_snooze_log',id,null,{user_id:req.user.id,entity_type:entityType,entity_id:entityId,snoozed_until:snoozedUntil},1,'Deadline notification snoozed for exactly three hours','TECHNICAL');
  res.json({ok:true,entity_type:entityType,entity_id:entityId,snoozed_until:snoozedUntil,hours:3});
});

app.post('/api/notifications/snooze-all',auth,permit('ADMIN','MANAGER','WORKER'),(req,res)=>{
  try{
    const activeNotifications=activeDeadlineNotifications(req.user),snoozedUntil=new Date(Date.now()+3*60*60*1000).toISOString();
    const run=db.transaction(()=>{
      const insert=db.prepare(`INSERT INTO notification_snooze_log(id,user_id,entity_type,entity_id,snoozed_until)
        VALUES(?,?,?,?,?)
        ON CONFLICT(user_id,entity_type,entity_id) DO UPDATE SET snoozed_until=excluded.snoozed_until,created_at=CURRENT_TIMESTAMP`);
      for(const notification of activeNotifications){
        insert.run(rid('NSZ'),req.user.id,notification.entity_type,String(notification.entity_id),snoozedUntil);
      }
      audit(req,'SNOOZE_ALL','notification_snooze_log',req.user.id,null,{
        user_id:req.user.id,
        notification_count:activeNotifications.length,
        entities:activeNotifications.map(notification=>({entity_type:notification.entity_type,entity_id:String(notification.entity_id)})),
        snoozed_until:snoozedUntil
      },1,'All active deadline notifications snoozed for exactly three hours','TECHNICAL');
    });
    run();
    res.json({ok:true,snoozed_until:snoozedUntil,hours:3,count:activeNotifications.length});
  }catch(error){
    console.error('Bulk deadline notification snooze failed:',error);
    res.status(500).json({error:'NOTIFICATION_SNOOZE_ALL_FAILED'});
  }
});

app.post('/api/notifications/reschedule',auth,permit('ADMIN','MANAGER','WORKER'),(req,res)=>{
  const entityType=String(req.body?.entity_type||'').trim().toUpperCase(),entityId=String(req.body?.entity_id||'').trim(),targetDate=notificationLocalDateTime(req.body?.target_date),reason=String(req.body?.reason||'').replace(/\u0000/g,'').trim().slice(0,2000);
  if(!DEADLINE_NOTIFICATION_TYPES.has(entityType)||!entityId)return res.status(400).json({error:'INVALID_NOTIFICATION_ENTITY'});
  if(!deadlineEntityVisibleToUser(req.user,entityType,entityId))return res.status(404).json({error:'NOTIFICATION_ENTITY_NOT_FOUND'});
  if(!targetDate)return res.status(400).json({error:'INVALID_NOTIFICATION_TARGET_DATE'});
  if(!reason)return res.status(400).json({error:'RESCHEDULE_REASON_REQUIRED'});
  try{
    if(entityType==='CLIENT_FOLLOWUP'){
      const before=db.prepare('SELECT * FROM contacts WHERE id=?').get(entityId);if(!before)return res.status(404).json({error:'CONTACT_NOT_FOUND'});
      const run=db.transaction(()=>{
        const notes=appendNotificationNote(before.relationship_notes,reason,'Follow-up rescheduled / Utánkövetés újraütemezve');
        db.prepare('UPDATE contacts SET follow_up_date=?,relationship_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(targetDate,notes,entityId);
        const updated=db.prepare('SELECT * FROM contacts WHERE id=?').get(entityId);jobDomain.syncCrmFollowUp({contact:updated,actor:req.user});return updated;
      });
      const updated=run();audit(req,'RESCHEDULE','contacts',entityId,before,updated,1,reason,'TECHNICAL');return res.json({ok:true,entity_type:entityType,entity_id:entityId,target_date:targetDate});
    }
    const before=db.prepare('SELECT * FROM jobs WHERE id=?').get(entityId);if(!before)return res.status(404).json({error:'JOB_NOT_FOUND'});
    if(!canEditJob(req.user,before))return res.status(403).json({error:'JOB_EDIT_FORBIDDEN'});
    if(['Completed','Partially completed','Failed','Cancelled'].includes(String(before.status||'')))return res.status(400).json({error:'JOB_NOT_ACTIVE'});
    if(!isScheduleTime(targetDate))return res.status(400).json({error:'INVALID_SCHEDULE_TIME',interval_minutes:SCHEDULE_INTERVAL_MINUTES});
    const duration=Math.max(SCHEDULE_INTERVAL_MINUTES,domainTimeRangeMinutes(before.start_time,before.end_time)||SCHEDULE_INTERVAL_MINUTES),endTime=notificationJobEnd(targetDate,duration);
    const assigned=resolveActiveUser(before.assigned_user_id,before.assigned_to);
    let assigneeChanged=false,updated;
    db.transaction(()=>{
      const result=jobDomain.patchJobSchedule({jobId:before.id,startTime:targetDate,endTime,assignedUser:assigned,allowUnassigned:!assigned,actor:req.user,reassignmentNote:reason,findConflicts:findScheduleConflicts});
      assigneeChanged=result.assigneeChanged;
      const completionNotes=appendNotificationNote(before.completion_notes,reason,'Rescheduled / Újraütemezve');
      db.prepare('UPDATE jobs SET completion_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(completionNotes,before.id);
      updated=db.prepare(jobsSelectSql('WHERE j.id=?')).get(before.id);
      workAudit(req,'NOTIFICATION_RESCHEDULE',before.id,before,updated,1,reason);
    })();
    if(assigneeChanged)notifyAssigned(updated,req.user,'JOB_TRANSFERRED');
    return res.json({ok:true,entity_type:entityType,entity_id:entityId,target_date:targetDate,end_date:endTime});
  }catch(error){if(error.code==='SCHEDULE_CONFLICT')return rejectScheduleConflict(req,res,null,error.details?.conflicts||[]);res.status(error.status||400).json({error:error.code||error.message});}
});

app.post('/api/notifications/complete',auth,permit('ADMIN','MANAGER','WORKER'),(req,res)=>{
  const entityType=String(req.body?.entity_type||'').trim().toUpperCase(),entityId=String(req.body?.entity_id||'').trim(),note=String(req.body?.note||'').replace(/\u0000/g,'').trim().slice(0,2000);
  if(!DEADLINE_NOTIFICATION_TYPES.has(entityType)||!entityId)return res.status(400).json({error:'INVALID_NOTIFICATION_ENTITY'});
  if(!deadlineEntityVisibleToUser(req.user,entityType,entityId))return res.status(404).json({error:'NOTIFICATION_ENTITY_NOT_FOUND'});
  try{
    if(entityType==='CLIENT_FOLLOWUP'){
      const before=db.prepare('SELECT * FROM contacts WHERE id=?').get(entityId);if(!before)return res.status(404).json({error:'CONTACT_NOT_FOUND'});
      const run=db.transaction(()=>{
        if(note)db.prepare('UPDATE contacts SET relationship_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(appendNotificationNote(before.relationship_notes,note,'Follow-up completed / Megkeresés elvégezve'),entityId);
        return jobDomain.completeCrmFollowUp({contactId:entityId,cadence:'',nextFollowUpDate:'',actor:req.user});
      });
      const result=run();audit(req,'CRM_FOLLOW_UP_COMPLETE','contacts',entityId,before,result.contact,1,note||'CRM follow-up completed from global task notification','TECHNICAL');return res.json({ok:true,entity_type:entityType,entity_id:entityId});
    }
    const before=db.prepare('SELECT * FROM jobs WHERE id=?').get(entityId);if(!before)return res.status(404).json({error:'JOB_NOT_FOUND'});
    if(!canCloseJob(req.user,before))return res.status(403).json({error:'JOB_CLOSE_FORBIDDEN'});
    if(['Completed','Partially completed','Failed','Cancelled'].includes(String(before.status||'')))return res.json({ok:true,entity_type:entityType,entity_id:entityId,already_completed:true});
    const completionNotes=appendNotificationNote(before.completion_notes,note,'Completed / Elvégezve');
    jobDomain.closeoutJobOrchestration({
      jobId:before.id,
      source:'NOTIFICATION',
      actor:req.user,
      closeType:'Full',
      complete:true,
      financialEntries:Number(before.billed_amount)>0?[{itemDate:nyLocalDateTime(new Date()).slice(0,10),title:`Closed job revenue: ${before.title||before.id}`,amount:Number(before.billed_amount),mainType:'INCOME',category:'SERVICE_REVENUE',paymentMethod:before.payment_method||'',sourceType:'JOB_REVENUE',sourceId:`JOB_REVENUE:${before.id}`}]:[],
      mutate:({job,now})=>{
        db.prepare(`UPDATE jobs SET completion_notes=?,close_notes=COALESCE(NULLIF(close_notes,''),?),updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(completionNotes,note||'Completed from global task notification',job.id);
        return {notification_completion:true,completed_at:now};
      }
    });
    const updated=db.prepare(jobsSelectSql('WHERE j.id=?')).get(entityId);workAudit(req,'NOTIFICATION_COMPLETE',entityId,before,updated,1,note||'Calendar job completed through closeout orchestration');return res.json({ok:true,entity_type:entityType,entity_id:entityId,financial_status:updated.financial_status});
  }catch(error){res.status(error.status||400).json({error:error.code||error.message});}
});

app.get("/api/planned-jobs", auth, (req,res)=>{
  const includeAll=req.query.include_all==="1" || req.user.role==="SUPERADMIN";
  const rows=includeAll
    ? db.prepare("SELECT * FROM planned_jobs ORDER BY created_at DESC").all()
    : db.prepare("SELECT * FROM planned_jobs WHERE archived_at IS NULL AND COALESCE(status,'') NOT IN ('Archived / Archivált','Cancelled / Törölve') ORDER BY created_at DESC").all();
  res.json(rows);
});

app.post("/api/planned-jobs", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  const b=req.body||{};
  if(!b.title) return res.status(400).json({error:"Title is required / Munka neve kötelező"});
  if(!b.client_name) return res.status(400).json({error:"Client is required / Ügyfél kötelező"});
  if(!isFiveMinuteDurationHours(b.estimated_hours)) return res.status(400).json({error:"INVALID_PLANNED_DURATION"});
  const id=b.id||rid("PLN");
  const plannedKey=b.planned_key||generatePlannedJobKey();
  const preferredUser=resolveActiveUser(b.preferred_assigned_user_id,b.preferred_assigned_to);
  if(b.preferred_assigned_user_id && !preferredUser) return res.status(400).json({error:"A valid preferred responsible user is required / Érvényes tervezett felelős szükséges"});
  const cols=["id","planned_key","planned_type","title","client_id","client_name","client_phone","piano_id","piano_name","service_address","preferred_assigned_to","preferred_assigned_user_id","priority","expected_revenue","probability","estimated_hours","target_date","status","block_reason","next_step","notes","created_by","created_by_user_id"];
  const vals=[id,plannedKey,b.planned_type||"Planned new / Tervezett, még nem lefixált",b.title||"",b.client_id||"",b.client_name||"",b.client_phone||"",b.piano_id||"",b.piano_name||"",b.service_address||"",preferredUser?.name||b.preferred_assigned_to||"",preferredUser?.id||null,b.priority||"Medium",Number(b.expected_revenue||0),b.probability||"100% - Biztos",Number(b.estimated_hours||0),b.target_date||"",b.status||"Waiting for client / Ügyfélre vár",b.block_reason||"",b.next_step||"",b.notes||"",req.user.name||"",req.user.id||null];
  db.prepare(`INSERT INTO planned_jobs(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...vals);
  res.json(db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(id));
});

app.put("/api/planned-jobs/:id", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  const existing=db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Planned job not found / Tervezett munka nem található"});
  const allowed=["planned_type","title","client_id","client_name","client_phone","piano_id","piano_name","service_address","preferred_assigned_to","preferred_assigned_user_id","priority","expected_revenue","probability","estimated_hours","target_date","status","block_reason","next_step","notes"];
  const body={...req.body};
  if(body.preferred_assigned_user_id!==undefined || body.preferred_assigned_to!==undefined){
    const preferredUser=resolveActiveUser(body.preferred_assigned_user_id,body.preferred_assigned_to);
    if(!preferredUser) return res.status(400).json({error:"A valid preferred responsible user is required / Érvényes tervezett felelős szükséges"});
    body.preferred_assigned_user_id=preferredUser.id; body.preferred_assigned_to=preferredUser.name;
  }
  if(body.expected_revenue!==undefined) body.expected_revenue=Number(body.expected_revenue||0);
  if(body.estimated_hours!==undefined){
    if(!isFiveMinuteDurationHours(body.estimated_hours)) return res.status(400).json({error:"INVALID_PLANNED_DURATION"});
    body.estimated_hours=Number(body.estimated_hours);
  }
  const cols=allowed.filter(c=>body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE planned_jobs SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>body[c]), req.params.id);
  res.json(db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(req.params.id));
});

app.delete("/api/planned-jobs/:id", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  const existing=db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Planned job not found / Tervezett munka nem található"});
  if(isSuperadminUser(req.user)) db.prepare("DELETE FROM planned_jobs WHERE id=?").run(req.params.id);
  else db.prepare("UPDATE planned_jobs SET status='Archived / Archivált', archived_at=?, archived_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nowISO(), req.user.name||"", req.params.id);
  res.json({ok:true});
});

app.post("/api/planned-jobs/:id/convert", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  const planned=db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(req.params.id);
  if(!planned) return res.status(404).json({error:"Planned job not found / Tervezett munka nem található"});
  if(!isActivePlannedStatus(planned.status)) return res.status(400).json({error:"This planned job is not active / Ez a tervezett munka már nem aktív"});
  const b=req.body||{};
  const assignedUser=resolveActiveUser(b.assigned_user_id||planned.preferred_assigned_user_id,b.assigned_to||planned.preferred_assigned_to);
  const assigned=assignedUser?.name||b.assigned_to||planned.preferred_assigned_to;
  const title=b.title || planned.title;
  const start=b.start_time;
  const end=b.end_time;
  if(!assigned || !title || !start || !end) return res.status(400).json({error:"Assigned to, title, start and end are required / Felelős, cím, kezdés és befejezés kötelező"});
  if(!assignedUser) return res.status(400).json({error:"A valid responsible user is required / Érvényes felelős munkatárs szükséges"});
  if(!isValidTimeRange(start,end)) return res.status(400).json({error:"INVALID_TIME_RANGE"});
  if(!isFiveMinuteTime(start)||!isFiveMinuteTime(end)) return res.status(400).json({error:"INVALID_TIME_STEP"});
  b.planned_minutes=timeRangeMinutes(start,end);b.planned_hours=b.planned_minutes/60;
  const conflicts=findScheduleConflicts(assignedUser.id,assignedUser.name,start,end);
  if(conflicts.length) return rejectScheduleConflict(req,res,assignedUser,conflicts);
  const jobId=rid("J");
  db.prepare(`INSERT INTO jobs(
    id,job_key,planned_job_id,parent_job_id,title,job_type,client_id,client_name,client_phone,piano_id,piano_name,
    assigned_user_id,assigned_to,created_by_user_id,created_by,priority,status,start_time,end_time,timezone,planned_amount,pricing_basis,
    planned_hours,planned_minutes,travel_minutes,service_address,instructions,notes
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    jobId,stableJobKey(),planned.id,null,title,"Standalone",planned.client_id||null,planned.client_name||"",planned.client_phone||"",planned.piano_id||null,planned.piano_name||"",
    assignedUser?.id||null,assigned,req.user.id,req.user.name,planned.priority||"Medium","Open",start,end,"America/New_York",Number(b.planned_amount||planned.expected_revenue||0),b.pricing_basis||"Converted from planned job / Tervezett munkából áthelyezve",
    Number(b.planned_hours||0),Number(b.planned_minutes||0),Number(b.travel_minutes||0),b.service_address||planned.service_address||"",b.instructions||planned.next_step||"",b.notes||planned.notes||""
  );
  db.prepare("UPDATE planned_jobs SET status='Converted / Naptárba helyezve', converted_job_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(jobId, planned.id);
  res.json({ok:true,planned:db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(planned.id),job:db.prepare(jobsSelectSql("WHERE j.id=?")).get(jobId)});
});

app.get("/api/inventory", auth, (req,res)=>{
  const includeDeleted = req.query.include_deleted === "1" && (req.user.role === "SUPERADMIN" || Number(req.user.is_superadmin||0)===1);
  const rows = includeDeleted
    ? db.prepare("SELECT * FROM inventory_items ORDER BY created_at DESC").all()
    : db.prepare("SELECT * FROM inventory_items WHERE COALESCE(status,'')!='Deleted' ORDER BY created_at DESC").all();
  res.json(rows);
});

app.post("/api/inventory", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  const b=req.body || {};
  if(!String(b.item_name||"").trim()) return res.status(400).json({error:"Item name is required / Tétel neve kötelező"});
  const id=rid("INVITEM");
  const inventoryId=generateInventoryId(b.main_category || "Other");
  const cols=["id","inventory_id","item_name","main_category","piano_part_category","item_type","acquisition_type","supplier","manufacturer","purchase_price","manufacturing_cost","quantity","unit","condition_status","location","linked_piano_id","linked_client_id","status","notes","created_by","created_by_user_id"];
  const vals=[id,inventoryId,b.item_name||"",b.main_category||"Other",b.piano_part_category||"",b.item_type||"",b.acquisition_type||"Existing stock",b.supplier||"",b.manufacturer||"",Number(b.purchase_price||0),Number(b.manufacturing_cost||0),Number(b.quantity||1),b.unit||"piece",b.condition_status||"Used",b.location||"",b.linked_piano_id||"",b.linked_client_id||"",b.status||"In Stock",b.notes||"",req.user.name||"",req.user.id||null];
  db.prepare(`INSERT INTO inventory_items(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...vals);
  res.json(db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id));
});

app.put("/api/inventory/:id", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  const existing=db.prepare("SELECT * FROM inventory_items WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Inventory item not found / Leltári tétel nem található"});
  const allowed=["item_name","main_category","piano_part_category","item_type","acquisition_type","supplier","manufacturer","purchase_price","manufacturing_cost","quantity","unit","condition_status","location","linked_piano_id","linked_client_id","status","notes"];
  const body={...req.body};
  ["purchase_price","manufacturing_cost","quantity"].forEach(k=>{ if(body[k]!==undefined) body[k]=Number(body[k]||0); });
  const cols=allowed.filter(c=>body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE inventory_items SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>body[c]), req.params.id);
  res.json(db.prepare("SELECT * FROM inventory_items WHERE id=?").get(req.params.id));
});

app.delete("/api/inventory/:id", auth, requireSuperadmin, (req,res)=>{
  const existing=db.prepare("SELECT * FROM inventory_items WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Inventory item not found / Leltári tétel nem található"});
  db.prepare("DELETE FROM inventory_items WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.get("/api/inventory/check-status", auth, (req,res)=>{
  const last=db.prepare("SELECT * FROM inventory_checks ORDER BY check_date DESC, created_at DESC LIMIT 1").get();
  const todayStr=nyToday();
  const nextDue=last ? addMonthsToDate(last.check_date, 3) : todayStr;
  const diffDays=Math.ceil((new Date(`${nextDue}T00:00:00`)-new Date(`${todayStr}T00:00:00`))/(1000*60*60*24));
  res.json({
    lastInventory:last||null,
    today:todayStr,
    nextDue,
    status: diffDays < 0 ? "OVERDUE" : (diffDays <= 14 ? "DUE_SOON" : "OK"),
    daysUntilDue:diffDays
  });
});

app.post("/api/inventory/complete", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  const rows=inventoryRowsActive();
  const totalValue=rows.reduce((s,r)=>s+inventoryItemValue(r),0);
  const checkDate=nyToday();
  const id=rid("INVCHECK");
  db.prepare("INSERT INTO inventory_checks(id,check_date,completed_by,item_count,total_value,snapshot_json) VALUES(?,?,?,?,?,?)")
    .run(id,checkDate,req.user.name||"",rows.length,totalValue,JSON.stringify(rows));
  res.json({ok:true,check:db.prepare("SELECT * FROM inventory_checks WHERE id=?").get(id),nextDue:addMonthsToDate(checkDate,3)});
});

app.get("/api/employee-daily-rates", auth, permit("ADMIN"), (req,res)=>{
  const date=String(req.query.date||nyToday()).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:"INVALID_DATE"});
  const users=db.prepare("SELECT id,name,email,role,status FROM users WHERE status='Active' ORDER BY name").all();
  const rows=users.map(employee=>{
    const rate=jobDomain.employeeDailyRateForDate(employee.id,date);
    return {...employee,effective_date:rate?.effective_date||null,rate:Number(rate?.rate||0),currency:rate?.currency||'USD'};
  });
  res.json({date,employees:rows});
});

app.put("/api/employee-daily-rates/:userId", auth, permit("ADMIN"), (req,res)=>{
  const employee=db.prepare("SELECT id,name,email,role,status FROM users WHERE id=?").get(req.params.userId);
  if(!employee) return res.status(404).json({error:"USER_NOT_FOUND"});
  const rate=Number(req.body.rate);
  const effectiveDate=String(req.body.effective_date||nyToday()).slice(0,10);
  const currency=String(req.body.currency||'USD').trim().toUpperCase().slice(0,3)||'USD';
  if(!Number.isFinite(rate)||rate<0) return res.status(400).json({error:"INVALID_DAILY_RATE"});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return res.status(400).json({error:"INVALID_DATE"});
  try{ensure1099PartnerForUser(employee.id,{force:true});}catch(error){return res.status(500).json({error:"TECHNICIAN_PARTNER_ASSIGNMENT_FAILED",details:error.message});}
  db.prepare(`INSERT INTO employee_daily_rates(user_id,rate,currency,effective_date,created_by) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id,effective_date) DO UPDATE SET rate=excluded.rate,currency=excluded.currency,created_at=CURRENT_TIMESTAMP,created_by=excluded.created_by`)
    .run(employee.id,Math.round(rate*100)/100,currency,effectiveDate,req.user.id);
  const saved=jobDomain.employeeDailyRateForDate(employee.id,effectiveDate);
  audit(req,'UPDATE','employee_daily_rates',`${employee.id}:${effectiveDate}`,null,{user_id:employee.id,rate:saved?.rate||0,currency:saved?.currency||currency,effective_date:effectiveDate},1,'Employee daily rate updated','FINANCIAL');
  res.json({employee,rate:saved});
});

app.get("/api/employee-daily-rates/:userId/capacity", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const date=String(req.query.date||'').slice(0,10);
  const jobId=String(req.query.job_id||'').trim()||null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:"INVALID_DATE"});
  const employee=resolveActiveUser(req.params.userId,'');
  if(!employee) return res.status(404).json({error:"USER_NOT_FOUND"});
  const summary=jobDomain.dailyRateAllocationSummary({userId:employee.id,dateStr:date,excludeJobId:jobId});
  res.json({user_id:employee.id,date,...summary});
});

function financialPeriodIsClosed(period){
  if(!/^\d{4}-\d{2}$/.test(String(period||""))) return false;
  try{return Boolean(db.prepare("SELECT 1 FROM financial_statement_snapshots WHERE period=? LIMIT 1").get(period));}catch(_error){return false;}
}
function financialDateIsClosed(dateKey){
  const value=String(dateKey||"");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && financialPeriodIsClosed(value.slice(0,7));
}
function financialItemAuditStamp(value=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(value);
  const part=(type)=>parts.find(row=>row.type===type)?.value||"00";
  return {iso:value.toISOString(),local:`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}[America/New_York]`};
}
function financialItemRecord(id){
  return db.prepare(`SELECT fi.*,CASE WHEN fv.financial_item_id IS NULL THEN 'ACTIVE' ELSE 'VOID' END AS status,
    fv.effective_date AS void_effective_date,fv.reason AS void_reason,fv.voided_at,fv.voided_at_local,fv.reversal_item_id AS void_reversal_item_id
    FROM financial_items fi LEFT JOIN financial_item_voids fv ON fv.financial_item_id=fi.id WHERE fi.id=?`).get(id);
}
function financialItemRows(sql,params=[]){
  return db.prepare(sql).all(...params).map(row=>financialItemRecord(row.id));
}
function normalizeFinancialItemMutation(source,body={}){
  const next={...source};
  const assign=(key)=>{if(body[key]!==undefined)next[key]=body[key];};
  ["item_date","title","description","main_type","category","recurrence","balance_account","job_id","client_id","piano_id"].forEach(assign);
  if(body.amount!==undefined)next.amount=roundMoney(Number(body.amount));
  if(body.payment_method!==undefined){
    const normalized=body.payment_method?normalizePaymentMethod(body.payment_method,{allowEmpty:false}):null;
    if(body.payment_method&&!normalized)throw Object.assign(new Error("INVALID_PAYMENT_METHOD"),{status:400});
    next.payment_method=normalized||"";
  }
  next.item_date=String(next.item_date||"").trim();
  next.title=String(next.title||"").trim();
  next.description=String(next.description||"");
  next.main_type=String(next.main_type||"").toUpperCase();
  next.category=String(next.category||"");
  next.recurrence=String(next.recurrence||"ONE_TIME").toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(next.item_date))throw Object.assign(new Error("INVALID_FINANCIAL_ITEM_DATE"),{status:400});
  if(!next.title)throw Object.assign(new Error("FINANCIAL_ITEM_TITLE_REQUIRED"),{status:400});
  if(!["INCOME","EXPENSE","ASSET","LIABILITY","EQUITY"].includes(next.main_type))throw Object.assign(new Error("INVALID_FINANCIAL_ITEM_TYPE"),{status:400});
  if(!["ONE_TIME","MONTHLY"].includes(next.recurrence))throw Object.assign(new Error("INVALID_FINANCIAL_ITEM_RECURRENCE"),{status:400});
  if(!Number.isFinite(Number(next.amount))||Number(next.amount)<0)throw Object.assign(new Error("INVALID_FINANCIAL_ITEM_AMOUNT"),{status:400});
  next.amount=roundMoney(next.amount);
  return next;
}
function insertFinancialItemRow(row,{id=null,itemDate=null,amount=null,recurrence=null,sourceType=undefined,sourceId=undefined,createdBy=null,title=null,description=null}={}){
  const record={...row};
  record.id=id||rid("FI");
  record.item_date=itemDate||record.item_date||nyToday();
  record.amount=amount===null||amount===undefined?roundMoney(record.amount):roundMoney(amount);
  record.recurrence=recurrence||record.recurrence||"ONE_TIME";
  record.source_type=sourceType===undefined?record.source_type:sourceType;
  record.source_id=sourceId===undefined?record.source_id:sourceId;
  record.created_by=createdBy||record.created_by||"System";
  record.title=title||record.title||"Financial item";
  record.description=description===null||description===undefined?(record.description||""):description;
  db.prepare(`INSERT INTO financial_items(id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,source_type,source_id,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.id,record.item_date,record.title,record.description,record.amount,record.main_type,record.category||"",record.recurrence,record.payment_method||"",record.balance_account||"",record.job_id||null,record.client_id||null,record.piano_id||null,record.source_type||null,record.source_id||null,record.created_by);
  return financialItemRecord(record.id);
}
function recordFinancialItemAdjustment({itemId,type,reason,user,before,after,reversalItemId=null,replacementItemId=null,stamp=null}){
  const normalizedReason=String(reason||"").trim();
  if(normalizedReason.length<5)throw Object.assign(new Error("ADJUSTMENT_REASON_REQUIRED"),{status:400,minimum_length:5});
  const when=stamp||financialItemAuditStamp();
  const id=rid("FIADJ");
  db.prepare(`INSERT INTO financial_item_adjustments(id,financial_item_id,adjustment_type,reason,adjusted_by_user_id,adjusted_by_name,adjusted_at,adjusted_at_local,previous_values,new_values,reversal_item_id,replacement_item_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,itemId,type,normalizedReason,user?.id||null,user?.name||user?.email||user?.id||"SYSTEM",when.iso,when.local,JSON.stringify(before||null),JSON.stringify(after||null),reversalItemId,replacementItemId);
  return db.prepare("SELECT * FROM financial_item_adjustments WHERE id=?").get(id);
}
function voidFinancialItem({existing,reason,user,replacement=null,adjustmentType="VOID"}){
  const normalizedReason=String(reason||"").trim();
  if(normalizedReason.length<5)throw Object.assign(new Error("ADJUSTMENT_REASON_REQUIRED"),{status:400,minimum_length:5});
  if(existing.status==="VOID")return {item:existing,reversal:null,replacement:null,alreadyVoid:true};
  const stamp=financialItemAuditStamp();
  const effectiveDate=nyToday();
  return db.transaction(()=>{
    const auditId=rid("FIADJ");
    const reversal=insertFinancialItemRow(existing,{
      id:rid("FI"),itemDate:effectiveDate,amount:-roundMoney(existing.amount||0),recurrence:"ONE_TIME",
      sourceType:"FINANCIAL_ITEM_ADJUSTMENT",sourceId:`REVERSAL:${auditId}`,createdBy:user?.name||user?.email||user?.id||"SYSTEM",
      title:`Reversal: ${existing.title}`,description:`${normalizedReason}${existing.description?` · Original: ${existing.description}`:""}`
    });
    db.prepare(`INSERT INTO financial_item_voids(financial_item_id,effective_date,reason,voided_by_user_id,voided_by_name,voided_at,voided_at_local,reversal_item_id)
      VALUES(?,?,?,?,?,?,?,?)`).run(existing.id,effectiveDate,normalizedReason,user?.id||null,user?.name||user?.email||user?.id||"SYSTEM",stamp.iso,stamp.local,reversal.id);
    let replacementRow=null;
    if(replacement){
      replacementRow=insertFinancialItemRow(replacement,{
        id:rid("FI"),itemDate:effectiveDate,sourceType:"FINANCIAL_ITEM_ADJUSTMENT",sourceId:`REPLACEMENT:${auditId}`,createdBy:user?.name||user?.email||user?.id||"SYSTEM",
        title:replacement.title,description:replacement.description
      });
    }
    const voided=financialItemRecord(existing.id);
    db.prepare(`INSERT INTO financial_item_adjustments(id,financial_item_id,adjustment_type,reason,adjusted_by_user_id,adjusted_by_name,adjusted_at,adjusted_at_local,previous_values,new_values,reversal_item_id,replacement_item_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(auditId,existing.id,adjustmentType,normalizedReason,user?.id||null,user?.name||user?.email||user?.id||"SYSTEM",stamp.iso,stamp.local,JSON.stringify(existing),JSON.stringify(replacementRow||voided),reversal.id,replacementRow?.id||null);
    return {item:voided,reversal,replacement:replacementRow,alreadyVoid:false};
  })();
}

app.get("/api/finance/entries", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const rows=financialItemRows("SELECT id FROM financial_items ORDER BY item_date DESC, created_at DESC");
  res.json(rows.map(r=>({...r,lines:[]})));
});

app.get("/api/financial-items", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const where=[];
  const params=[];
  const {month, main_type, recurrence, category}=req.query;
  if(month && /^\d{4}-\d{2}$/.test(month)){
    const start=`${month}-01`;
    const next=new Date(`${start}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth()+1);
    const end=next.toISOString().slice(0,10);
    where.push("((recurrence='MONTHLY' AND item_date < ?) OR (recurrence!='MONTHLY' AND item_date >= ? AND item_date < ?))");
    params.push(end,start,end);
  }
  if(main_type){ where.push("main_type=?"); params.push(main_type); }
  if(recurrence){ where.push("recurrence=?"); params.push(recurrence); }
  if(category){ where.push("category=?"); params.push(category); }
  const sql=`SELECT id FROM financial_items ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY item_date DESC, created_at DESC`;
  res.json(financialItemRows(sql,params));
});

app.get("/api/financial-items/:id/adjustments", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const item=financialItemRecord(req.params.id);
  if(!item)return res.status(404).json({error:"FINANCIAL_ITEM_NOT_FOUND"});
  res.json(db.prepare("SELECT * FROM financial_item_adjustments WHERE financial_item_id=? ORDER BY adjusted_at DESC,id DESC").all(item.id));
});

app.post("/api/financial-items", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  try{
    const base={id:req.body.id||rid("FI"),item_date:req.body.item_date||nyToday(),title:req.body.title,description:req.body.description||"",amount:req.body.amount,main_type:req.body.main_type,category:req.body.category||"",recurrence:req.body.recurrence||"ONE_TIME",payment_method:req.body.payment_method||"",balance_account:req.body.balance_account||"",job_id:req.body.job_id||null,client_id:req.body.client_id||null,piano_id:req.body.piano_id||null,source_type:null,source_id:null,created_by:req.user.name};
    const next=normalizeFinancialItemMutation(base,req.body||{});
    if(financialDateIsClosed(next.item_date))return res.status(409).json({error:"CLOSED_PERIOD_IMMUTABLE_USE_CURRENT_PERIOD_ADJUSTMENT",period:next.item_date.slice(0,7)});
    const created=insertFinancialItemRow(next,{id:base.id,createdBy:req.user.name||req.user.id});
    audit(req,"CREATE","financial_items",created.id,null,created,1,"Financial item created","FINANCIAL");
    res.json(created);
  }catch(error){res.status(error.status||400).json({error:error.message,minimum_length:error.minimum_length||undefined});}
});

app.put("/api/financial-items/:id", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  try{
    const existing=financialItemRecord(req.params.id);
    if(!existing)return res.status(404).json({error:"Financial item not found / Pénzügyi tétel nem található"});
    if(existing.status==="VOID")return res.status(409).json({error:"VOID_FINANCIAL_ITEM_IMMUTABLE"});
    if(String(existing.source_type||"")==="FINANCIAL_ITEM_ADJUSTMENT")return res.status(409).json({error:"FINANCIAL_ADJUSTMENT_ENTRY_IMMUTABLE"});
    const reason=String(req.body?.reason||"").trim();
    if(reason.length<5)return res.status(400).json({error:"ADJUSTMENT_REASON_REQUIRED",minimum_length:5});
    const next=normalizeFinancialItemMutation(existing,req.body||{});
    if(financialDateIsClosed(next.item_date)&&!financialDateIsClosed(existing.item_date))return res.status(409).json({error:"CLOSED_PERIOD_IMMUTABLE_USE_CURRENT_PERIOD_ADJUSTMENT",period:next.item_date.slice(0,7)});
    if(financialDateIsClosed(existing.item_date)){
      const adjusted=voidFinancialItem({existing,reason,user:req.user,replacement:next,adjustmentType:"CLOSED_PERIOD_ADJUSTMENT"});
      audit(req,"ADJUST_CURRENT_PERIOD","financial_items",existing.id,existing,adjusted.replacement,1,reason,"FINANCIAL");
      return res.json({...adjusted.replacement,current_period_adjustment:true,adjusted_from:existing.id,reversal_item_id:adjusted.reversal?.id||null});
    }
    const allowed=["item_date","title","description","amount","main_type","category","recurrence","payment_method","balance_account","job_id","client_id","piano_id"];
    const cols=allowed.filter(key=>next[key]!==existing[key]);
    const stamp=financialItemAuditStamp();
    const after=db.transaction(()=>{
      if(cols.length)db.prepare(`UPDATE financial_items SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>next[c]),existing.id);
      const updated=financialItemRecord(existing.id);
      recordFinancialItemAdjustment({itemId:existing.id,type:"UPDATE",reason,user:req.user,before:existing,after:updated,stamp});
      return updated;
    })();
    audit(req,"ADJUST","financial_items",existing.id,existing,after,1,reason,"FINANCIAL");
    res.json(after);
  }catch(error){res.status(error.status||400).json({error:error.message,minimum_length:error.minimum_length||undefined});}
});

app.delete("/api/financial-items/:id", auth, requireSuperadmin, (req,res)=>{
  try{
    const existing=financialItemRecord(req.params.id);
    if(!existing)return res.status(404).json({error:"FINANCIAL_ITEM_NOT_FOUND"});
    if(String(existing.source_type||"")==="FINANCIAL_ITEM_ADJUSTMENT")return res.status(409).json({error:"FINANCIAL_ADJUSTMENT_ENTRY_IMMUTABLE"});
    const reason=String(req.body?.reason||"").trim();
    if(reason.length<5)return res.status(400).json({error:"ADJUSTMENT_REASON_REQUIRED",minimum_length:5});
    const result=voidFinancialItem({existing,reason,user:req.user,adjustmentType:"VOID"});
    audit(req,"VOID_INSTEAD_OF_DELETE","financial_items",existing.id,existing,result.item,1,reason,"FINANCIAL");
    res.json({ok:true,converted_to_void:true,item:result.item,reversal_item:result.reversal});
  }catch(error){res.status(error.status||400).json({error:error.message,minimum_length:error.minimum_length||undefined});}
});

const PASSIVE_NON_OPERATING_INCOME = Object.freeze({
  PIANO_RENTAL_LEASE: ["Piano Rental & Lease", "Zongorabérlet és lízing"],
  HALL_SALON_RENTAL: ["Hall & Salon Rental", "Terem- és szalonbérlet"],
  PRACTICE_REHEARSAL_FEES: ["Practice & Rehearsal Fees", "Gyakorlási és próbadíjak"],
  INTEREST_INCOME: ["Interest Income", "Kamatbevétel"],
  ROYALTY_CONTRACT_INCOME: ["Royalty & Contract Income", "Jogdíj és szerződéses bevétel"],
  PASSIVE_REVENUE: ["Passive Revenue", "Passzív bevétel"],
  OTHER_INCOME: ["Other Non-Operating Income", "Egyéb működésen kívüli bevétel"]
});

function monthBounds(month){
  if(!/^\d{4}-\d{2}$/.test(String(month||""))) throw new Error("Month must be YYYY-MM");
  const monthStart=`${month}-01`;
  const nextMonth=new Date(`${monthStart}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  return {monthStart,monthEnd:nextMonth.toISOString().slice(0,10)};
}
function addIsoDays(dateKey, days){
  const date=new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()+Number(days||0));
  return date.toISOString().slice(0,10);
}
function activeMonthCutoff(month, forceFullMonth=false){
  const {monthEnd}=monthBounds(month);
  if(forceFullMonth) return monthEnd;
  const todayKey=nyToday();
  return month===todayKey.slice(0,7) ? addIsoDays(todayKey,1) : monthEnd;
}
function financialItemsForMonth(month){
  const {monthStart,monthEnd}=monthBounds(month);
  const rows=expandedFinancialItemsAsOf(monthEnd).filter(item=>String(item.item_date||"")>=monthStart&&String(item.item_date||"")<monthEnd);
  return {monthStart,monthEnd,rows};
}
function openingBalanceRecord(cutoffDate=null){
  const row=db.prepare("SELECT * FROM opening_balance_sets WHERE id='COMPANY_OPENING_BALANCE'").get();
  if(!row) return null;
  if(cutoffDate && String(row.effective_date||"")>String(cutoffDate)) return null;
  const items=db.prepare("SELECT * FROM opening_balance_items WHERE opening_balance_id=? ORDER BY sort_order,id").all(row.id);
  return {...row,items};
}
function openingBalanceSummary(record){
  if(!record) return {assets:0,liabilitiesEquity:0,difference:0,balanced:true};
  let customAssets=0,customLiabilities=0,customEquity=0;
  for(const item of record.items||[]){
    const amount=roundMoney(item.amount||0),type=String(item.item_type||"").toUpperCase();
    if(type==='ASSET')customAssets=roundMoney(customAssets+amount);
    else if(type==='LIABILITY')customLiabilities=roundMoney(customLiabilities+amount);
    else if(type==='EQUITY')customEquity=roundMoney(customEquity+amount);
  }
  const assets=roundMoney(Number(record.opening_cash_bank||0)+Number(record.opening_accounts_receivable||0)+customAssets);
  const liabilitiesEquity=roundMoney(Number(record.opening_accounts_payable||0)+Number(record.opening_retained_earnings_equity||0)+customLiabilities+customEquity);
  const difference=roundMoney(assets-liabilitiesEquity);
  return {assets,liabilitiesEquity,difference,balanced:Math.abs(difference)<0.01,customAssets,customLiabilities,customEquity};
}
function openingBalanceLocked(){
  return financialPeriodIsClosed(FINANCIAL_HISTORY_START);
}

function normalizedOpeningBalanceBody(body={}){
  const effective_date=String(body.effective_date||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) throw Object.assign(new Error("INVALID_OPENING_BALANCE_DATE"),{status:400});
  const nonnegative=(value,field)=>{const n=roundMoney(Number(value));if(!Number.isFinite(Number(value))||n<0)throw Object.assign(new Error(`INVALID_${field}`),{status:400});return n;};
  const signed=(value,field)=>{const n=roundMoney(Number(value));if(!Number.isFinite(Number(value)))throw Object.assign(new Error(`INVALID_${field}`),{status:400});return n;};
  const items=(Array.isArray(body.items)?body.items:[]).slice(0,100).map((item,index)=>{
    const item_name=String(item?.item_name||item?.name||"").trim().slice(0,180);
    const item_type=String(item?.item_type||item?.type||"").toUpperCase();
    const amount=nonnegative(item?.amount||0,"OPENING_ITEM_AMOUNT");
    if(!item_name) throw Object.assign(new Error("OPENING_ITEM_NAME_REQUIRED"),{status:400});
    if(!["ASSET","LIABILITY","EQUITY"].includes(item_type)) throw Object.assign(new Error("INVALID_OPENING_ITEM_TYPE"),{status:400});
    return {id:String(item?.id||rid("OBI")),item_name,item_type,amount,sort_order:index};
  });
  const record={
    id:'COMPANY_OPENING_BALANCE',effective_date,
    opening_cash_bank:nonnegative(body.opening_cash_bank,"OPENING_CASH_BANK"),
    opening_accounts_receivable:nonnegative(body.opening_accounts_receivable,"OPENING_ACCOUNTS_RECEIVABLE"),
    opening_accounts_payable:nonnegative(body.opening_accounts_payable,"OPENING_ACCOUNTS_PAYABLE"),
    opening_retained_earnings_equity:signed(body.opening_retained_earnings_equity,"OPENING_RETAINED_EARNINGS_EQUITY"),
    items
  };
  const summary=openingBalanceSummary(record);
  if(!summary.balanced){const error=Object.assign(new Error("OPENING_BALANCE_OUT_OF_BALANCE"),{status:400,summary});throw error;}
  return {...record,summary};
}

app.get("/api/opening-balance", auth, permit("ADMIN","MANAGER"), (_req,res)=>{
  const record=openingBalanceRecord();
  res.json({openingBalance:record,summary:openingBalanceSummary(record),locked:openingBalanceLocked(),locked_after_period:FINANCIAL_HISTORY_START});
});
app.put("/api/opening-balance", auth, permit("ADMIN"), (req,res)=>{
  try{
    if(openingBalanceLocked())return res.status(409).json({error:"OPENING_BALANCE_LOCKED",locked_after_period:FINANCIAL_HISTORY_START,message:"Opening balance is permanently locked after the first official financial period closes."});
    const next=normalizedOpeningBalanceBody(req.body||{});
    const before=openingBalanceRecord();
    db.transaction(()=>{
      db.prepare(`INSERT INTO opening_balance_sets(id,effective_date,opening_cash_bank,opening_accounts_receivable,opening_accounts_payable,opening_retained_earnings_equity,created_by_user_id,created_by_name,updated_by_user_id,updated_by_name,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET effective_date=excluded.effective_date,opening_cash_bank=excluded.opening_cash_bank,opening_accounts_receivable=excluded.opening_accounts_receivable,opening_accounts_payable=excluded.opening_accounts_payable,opening_retained_earnings_equity=excluded.opening_retained_earnings_equity,updated_by_user_id=excluded.updated_by_user_id,updated_by_name=excluded.updated_by_name,updated_at=CURRENT_TIMESTAMP`)
        .run(next.id,next.effective_date,next.opening_cash_bank,next.opening_accounts_receivable,next.opening_accounts_payable,next.opening_retained_earnings_equity,req.user.id,req.user.name,req.user.id,req.user.name);
      db.prepare("DELETE FROM opening_balance_items WHERE opening_balance_id=?").run(next.id);
      const insert=db.prepare("INSERT INTO opening_balance_items(id,opening_balance_id,item_name,item_type,amount,sort_order) VALUES(?,?,?,?,?,?)");
      for(const item of next.items)insert.run(item.id,next.id,item.item_name,item.item_type,item.amount,item.sort_order);
    })();
    const after=openingBalanceRecord();
    audit(req,before?"UPDATE":"CREATE","opening_balance",next.id,before,after,1,"Opening balance set updated","FINANCIAL");
    res.json({openingBalance:after,summary:openingBalanceSummary(after)});
  }catch(error){res.status(error.status||400).json({error:error.message,summary:error.summary||null});}
});

function expandedFinancialItemsAsOf(cutoffExclusive){
  const base=db.prepare(`SELECT fi.*,fv.effective_date AS void_effective_date
    FROM financial_items fi LEFT JOIN financial_item_voids fv ON fv.financial_item_id=fi.id
    WHERE fi.item_date<? ORDER BY fi.item_date,fi.created_at,fi.id`).all(cutoffExclusive);
  return expandFinancialItemsAsOf(base,cutoffExclusive);
}
function accountingSnapshotAsOf(cutoffExclusive){
  const asOfInvoices=db.prepare("SELECT * FROM invoices WHERE issue_date<? ORDER BY issue_date,invoice_number").all(cutoffExclusive);
  const asOfCreditMemos=db.prepare(`SELECT cm.*,i.source_type AS invoice_source_type,i.status AS invoice_status FROM invoice_credit_memos cm JOIN invoices i ON i.id=cm.invoice_id
    WHERE cm.accounting_effect=1 AND i.status<>'void' AND cm.memo_date<? ORDER BY cm.memo_date,cm.created_at,cm.id`).all(cutoffExclusive);
  const asOfFinancial=expandedFinancialItemsAsOf(cutoffExclusive);
  const asOfDirect=asOfFinancial.filter(item=>!isInvoiceDerivedFinancialItem(item));
  const opening=openingBalanceRecord(cutoffExclusive);
  return buildAccountingSnapshot({asOfInvoices,asOfDirectItems:asOfDirect,asOfCreditMemos,asOfDateExclusive:cutoffExclusive,openingBalance:opening});
}
function previousFinancialMonthKey(month){
  const date=new Date(`${month}-01T00:00:00Z`);
  if(!Number.isFinite(date.getTime()))return null;
  date.setUTCMonth(date.getUTCMonth()-1);
  return date.toISOString().slice(0,7);
}
function closedSnapshotEndingCash(period){
  if(!period)return null;
  const row=db.prepare("SELECT balance_sheet_json,income_statement_json FROM financial_statement_snapshots WHERE period=?").get(period);
  if(!row)return null;
  for(const raw of [row.income_statement_json,row.balance_sheet_json]){
    try{
      const payload=JSON.parse(raw||"{}");
      const candidate=payload?.cashFlow?.endingBalance ?? payload?.balanceSheet?.cashBankAccounts ?? payload?.totals?.cashBank;
      if(Number.isFinite(Number(candidate)))return roundMoney(Number(candidate));
    }catch(_error){}
  }
  return null;
}

function incomeStatementPayload(month,{forceFullMonth=false}={}){
  const {monthStart,monthEnd}=monthBounds(month);
  const dataEnd=activeMonthCutoff(month,forceFullMonth);
  const closedJobs=db.prepare(`SELECT * FROM jobs WHERE status='Completed' AND completed_at >= ? AND completed_at < ?`).all(monthStart,dataEnd);
  const openJobs=db.prepare("SELECT COUNT(*) c FROM jobs WHERE status!='Completed' OR status IS NULL").get().c;

  const monthInvoices=db.prepare(`SELECT * FROM invoices
    WHERE (source_type='event' AND revenue_recognition_status='RECOGNIZED' AND revenue_recognition_date>=? AND revenue_recognition_date<?)
       OR (source_type<>'event' AND issue_date>=? AND issue_date<?)
    ORDER BY COALESCE(revenue_recognition_date,issue_date),invoice_number`).all(monthStart,dataEnd,monthStart,dataEnd);
  const asOfInvoices=db.prepare(`SELECT * FROM invoices WHERE issue_date<? ORDER BY issue_date,invoice_number`).all(dataEnd);
  const monthCreditMemos=db.prepare(`SELECT cm.*,i.source_type AS invoice_source_type,i.status AS invoice_status FROM invoice_credit_memos cm JOIN invoices i ON i.id=cm.invoice_id
    WHERE cm.accounting_effect=1 AND i.status<>'void' AND cm.revenue_effect_date>=? AND cm.revenue_effect_date<? ORDER BY cm.revenue_effect_date,cm.created_at,cm.id`).all(monthStart,dataEnd);
  const asOfCreditMemos=db.prepare(`SELECT cm.*,i.source_type AS invoice_source_type,i.status AS invoice_status FROM invoice_credit_memos cm JOIN invoices i ON i.id=cm.invoice_id
    WHERE cm.accounting_effect=1 AND i.status<>'void' AND cm.memo_date<? ORDER BY cm.memo_date,cm.created_at,cm.id`).all(dataEnd);
  const asOfFinancial=expandedFinancialItemsAsOf(dataEnd);
  const monthFinancial=asOfFinancial.filter(item=>String(item.item_date||"")>=monthStart&&String(item.item_date||"")<dataEnd);
  const monthDirect=monthFinancial.filter(item=>!isInvoiceDerivedFinancialItem(item));
  const asOfDirect=asOfFinancial.filter(item=>!isInvoiceDerivedFinancialItem(item));
  const opening=openingBalanceRecord(dataEnd);
  const snapshot=buildAccountingSnapshot({monthInvoices,monthDirectItems:monthDirect,asOfInvoices,asOfDirectItems:asOfDirect,monthCreditMemos,asOfCreditMemos,asOfDateExclusive:dataEnd,openingBalance:opening});
  const previousClosedEndingCash=closedSnapshotEndingCash(previousFinancialMonthKey(month));
  const beginningSnapshot=previousClosedEndingCash===null?accountingSnapshotAsOf(monthStart):null;

  const accountMap=new Map();
  const addPnl=(code,name_en,name_hu,category,amount,statement_section=category)=>{
    const value=roundMoney(amount);
    if(Math.abs(value)<0.005) return;
    const current=accountMap.get(code)||{code,name_en,name_hu,category,statement_section,debit_total:0,credit_total:0,balance:0};
    current.balance=roundMoney(current.balance+value);
    if(category==='REVENUE'){
      if(value>=0) current.credit_total=roundMoney(current.credit_total+value);
      else current.debit_total=roundMoney(current.debit_total+Math.abs(value));
    }else if(value>=0) current.debit_total=roundMoney(current.debit_total+value);
    else current.credit_total=roundMoney(current.credit_total+Math.abs(value));
    accountMap.set(code,current);
  };
  const eventInvoiceRevenue=roundMoney(monthInvoices.filter(row=>row.status!=='void'&&row.direction==='receivable'&&row.source_type==='event'&&row.revenue_recognition_status==='RECOGNIZED').reduce((sum,row)=>roundMoney(sum+Number(row.subtotal||0)),0));
  const eventContraRevenue=roundMoney(monthCreditMemos.filter(row=>row.invoice_source_type==='event'&&row.memo_type==='EVENT_REFUND').reduce((sum,row)=>roundMoney(sum+Number(row.subtotal_amount||0)),0));
  const serviceInvoiceRevenue=roundMoney(snapshot.pnl.grossInvoiceRevenue-eventInvoiceRevenue);
  addPnl('SERVICE_REVENUE','Service Revenue','Szolgáltatási bevétel','REVENUE',serviceInvoiceRevenue,'OPERATING_REVENUE');
  addPnl('CONCERT_SERVICE_REVENUE','Concert Service Revenue','Koncertbevétel','REVENUE',eventInvoiceRevenue,'OPERATING_REVENUE');
  addPnl('TICKET_REFUND_CONTRA_REVENUE','Ticket Refunds — Contra Revenue','Jegy-visszatérítés — bevételcsökkentés','REVENUE',-eventContraRevenue,'OPERATING_REVENUE');
  const activeMonthPayables=monthInvoices.filter(row=>row.status!=='void'&&row.direction==='payable');
  const subcontractorExpense=roundMoney(activeMonthPayables.filter(row=>['job','workflow'].includes(String(row.source_type||''))).reduce((sum,row)=>roundMoney(sum+Number(row.total_amount||0)),0));
  const vendorExpense=roundMoney(snapshot.pnl.invoiceExpenses-subcontractorExpense);
  addPnl('SUBCONTRACTOR_EXPENSE','Subcontractor / Transport Expense','Alvállalkozói / szállítási közvetlen költség','EXPENSE',subcontractorExpense,'EXPENSE');
  addPnl('OTHER_VENDOR_EXPENSE','Other Vendor / Partner Expense','Egyéb partneri / szállítói költség','EXPENSE',vendorExpense,'EXPENSE');
  for(const item of monthDirect){
    if(item.main_type==='INCOME'){
      const category=item.category||'OTHER_INCOME';
      const passive=PASSIVE_NON_OPERATING_INCOME[category];
      addPnl(category,passive?.[0]||category,passive?.[1]||category,'REVENUE',item.amount,passive?'PASSIVE_NON_OPERATING_INCOME':'OPERATING_REVENUE');
    }
    if(item.main_type==='EXPENSE') addPnl(item.category||'OTHER_EXPENSE',item.category||'Other Expense',item.category||'Egyéb kiadás','EXPENSE',item.amount,'EXPENSE');
  }
  const balance=snapshot.balance;
  const pnlAccounts=Array.from(accountMap.values());
  const operatingRevenueAccounts=pnlAccounts.filter(row=>row.statement_section==='OPERATING_REVENUE');
  const passiveIncomeAccounts=pnlAccounts.filter(row=>row.statement_section==='PASSIVE_NON_OPERATING_INCOME');
  const expenseAccounts=pnlAccounts.filter(row=>row.statement_section==='EXPENSE');
  const operatingRevenue=roundMoney(operatingRevenueAccounts.reduce((sum,row)=>roundMoney(sum+row.balance),0));
  const passiveNonOperatingIncome=roundMoney(passiveIncomeAccounts.reduce((sum,row)=>roundMoney(sum+row.balance),0));
  const trialBalance=[
    ...pnlAccounts,
    {code:'CASH_BANK',name_en:'Cash & Bank Accounts',name_hu:'Készpénz és bankszámlák',category:'ASSET',debit_total:Math.max(0,balance.cashBankAccounts),credit_total:Math.max(0,-balance.cashBankAccounts),balance:balance.cashBankAccounts},
    {code:'AR',name_en:'Accounts Receivable',name_hu:'Vevőkövetelések',category:'ASSET',debit_total:Math.max(0,balance.accountsReceivable),credit_total:Math.max(0,-balance.accountsReceivable),balance:balance.accountsReceivable},
    {code:'MANUAL_ASSETS',name_en:'Equipment / Inventory / Prepaid & Other Assets',name_hu:'Berendezés / készlet / aktív időbeli elhatárolás és egyéb eszközök',category:'ASSET',debit_total:Math.max(0,balance.manualAssets),credit_total:Math.max(0,-balance.manualAssets),balance:balance.manualAssets},
    {code:'AP',name_en:'Accounts Payable',name_hu:'Szállítói kötelezettségek',category:'LIABILITY',debit_total:Math.max(0,-balance.accountsPayable),credit_total:Math.max(0,balance.accountsPayable),balance:balance.accountsPayable},
    {code:'SALES_TAX_PAYABLE',name_en:'Sales Tax Payable',name_hu:'Fizetendő forgalmi adó',category:'LIABILITY',debit_total:Math.max(0,-balance.salesTaxPayable),credit_total:Math.max(0,balance.salesTaxPayable),balance:balance.salesTaxPayable},
    {code:'DEFERRED_REVENUE',name_en:'Deferred Revenue / Contract Liability',name_hu:'Halasztott bevétel / szerződéses kötelezettség',category:'LIABILITY',debit_total:Math.max(0,-balance.deferredRevenue),credit_total:Math.max(0,balance.deferredRevenue),balance:balance.deferredRevenue},
    {code:'MANUAL_LIABILITIES',name_en:'Loans / Notes Payable & Other Liabilities',name_hu:'Hitelek / váltótartozások és egyéb kötelezettségek',category:'LIABILITY',debit_total:Math.max(0,-balance.manualLiabilities),credit_total:Math.max(0,balance.manualLiabilities),balance:balance.manualLiabilities},
    {code:'OWNER_OPENING_EQUITY',name_en:"Owner's Opening Equity",name_hu:'Tulajdonosi nyitó tőke',category:'EQUITY',debit_total:Math.max(0,-balance.ownersOpeningEquity),credit_total:Math.max(0,balance.ownersOpeningEquity),balance:balance.ownersOpeningEquity},
    {code:'RETAINED_CURRENT_NET_INCOME',name_en:'Retained Earnings / Current Net Income',name_hu:'Eredménytartalék / aktuális nettó eredmény',category:'EQUITY',debit_total:Math.max(0,-balance.currentPeriodNetIncome),credit_total:Math.max(0,balance.currentPeriodNetIncome),balance:balance.currentPeriodNetIncome},
    {code:'MANUAL_EQUITY',name_en:'Other Manual Equity',name_hu:'Egyéb manuális saját tőke',category:'EQUITY',debit_total:Math.max(0,-balance.manualEquity),credit_total:Math.max(0,balance.manualEquity),balance:balance.manualEquity}
  ];
  const expenseDirect=monthDirect.filter(x=>x.main_type==='EXPENSE');
  const recurringExpenses=roundMoney(expenseDirect.filter(x=>x.recurrence==='MONTHLY').reduce((s,x)=>roundMoney(s+Number(x.amount||0)),0));
  const revenue=snapshot.pnl.revenue,expenses=snapshot.pnl.expenses;
  const beginningBalance=previousClosedEndingCash===null?roundMoney(beginningSnapshot?.balance?.cashBankAccounts||0):roundMoney(previousClosedEndingCash);
  const endingBalance=roundMoney(balance.cashBankAccounts||0);
  const netCashFlow=roundMoney(endingBalance-beginningBalance);
  return {
    month,monthStart,monthEndExclusive:monthEnd,asOfDateExclusive:dataEnd,generatedAt:new Date().toISOString(),
    accountingLogic:{source:'invoices_credit_memos_opening_balances_plus_noninvoice_financial_items',generalLedger:'accrual_general_ledger_tax_deferred_revenue',equation:'Assets = Liabilities + Equity'},
    counts:{openJobs,closedJobs:closedJobs.length,financialItems:monthDirect.length,invoices:monthInvoices.length,creditMemos:monthCreditMemos.length},
    totals:{passiveIncome:passiveNonOperatingIncome,passiveNonOperatingIncome,operatingRevenue,oneTimeIncome:roundMoney(revenue-passiveNonOperatingIncome),revenue,grossInvoiceRevenue:snapshot.pnl.grossInvoiceRevenue,contraRevenue:snapshot.pnl.contraRevenue,recurringExpenses,oneTimeExpenses:roundMoney(expenses-recurringExpenses),expenses,profit:snapshot.pnl.profit,assets:balance.totalAssets,liabilities:balance.totalLiabilities,equity:balance.totalEquity,sources:balance.totalLiabilitiesEquity,netWorth:balance.totalEquity,cashBank:balance.cashBankAccounts,accountsReceivable:balance.accountsReceivable,manualAssets:balance.manualAssets,accountsPayable:balance.accountsPayable,salesTaxPayable:balance.salesTaxPayable,deferredRevenue:balance.deferredRevenue,manualLiabilities:balance.manualLiabilities,ownersOpeningEquity:balance.ownersOpeningEquity,currentPeriodNetIncome:balance.currentPeriodNetIncome,manualEquity:balance.manualEquity},
    cashFlow:{beginningBalance,netCashFlow,endingBalance,beginningSource:previousClosedEndingCash===null?'LIVE_LEDGER':'PREVIOUS_CLOSED_SNAPSHOT'},
    openingBalance:opening?{...opening,summary:openingBalanceSummary(opening),locked:openingBalanceLocked()}:null,
    balanceAudit:{balanced:balance.balanced,difference:balance.difference,absolute_difference:Math.abs(balance.difference)},
    balanceSheet:{cashBankAccounts:balance.cashBankAccounts,accountsReceivable:balance.accountsReceivable,manualAssets:balance.manualAssets,totalAssets:balance.totalAssets,accountsPayable:balance.accountsPayable,salesTaxPayable:balance.salesTaxPayable,deferredRevenue:balance.deferredRevenue,manualLiabilities:balance.manualLiabilities,totalLiabilities:balance.totalLiabilities,ownersOpeningEquity:balance.ownersOpeningEquity,currentPeriodNetIncome:balance.currentPeriodNetIncome,manualEquity:balance.manualEquity,totalEquity:balance.totalEquity,totalLiabilitiesEquity:balance.totalLiabilitiesEquity,openingBalance:balance.openingBalance},
    operatingRevenueAccounts,passiveIncomeAccounts,expenseAccounts,trialBalance,
    items:monthDirect,invoices:monthInvoices,creditMemos:monthCreditMemos
  };
}

function statementClosedAtLocal(period){
  const {monthEnd}=monthBounds(period);
  const periodEnd=addIsoDays(monthEnd,-1);
  return `${periodEnd}T23:59:59[America/New_York]`;
}
function financialStatementCloseInstant(period){
  const probe=new Date(`${period}-15T12:00:00Z`);
  if(!Number.isFinite(probe.getTime())) throw new Error('INVALID_FINANCIAL_PERIOD');
  return nextNewYorkMonthClose(probe);
}
function snapshotFinancialStatementPeriod(period,closedAt=null){
  if(period<FINANCIAL_HISTORY_START) return null;
  const current=nyToday().slice(0,7);
  if(period>=current) return null;
  const existing=db.prepare("SELECT * FROM financial_statement_snapshots WHERE period=?").get(period);
  if(existing) return existing;
  const officialClose=closedAt instanceof Date&&Number.isFinite(closedAt.getTime())?closedAt:financialStatementCloseInstant(period);
  const payload=incomeStatementPayload(period,{forceFullMonth:true});
  const {monthEnd}=monthBounds(period),periodEnd=addIsoDays(monthEnd,-1);
  db.prepare(`INSERT INTO financial_statement_snapshots(period,period_end,closed_at,closed_at_local,balance_sheet_json,income_statement_json,created_by)
    VALUES(?,?,?,?,?,?,?)`).run(period,periodEnd,officialClose.toISOString(),statementClosedAtLocal(period),JSON.stringify({month:period,generatedAt:officialClose.toISOString(),balanceSheet:payload.balanceSheet,balanceAudit:payload.balanceAudit,openingBalance:payload.openingBalance,cashFlow:payload.cashFlow}),JSON.stringify({...payload,generatedAt:officialClose.toISOString()}),'SYSTEM');
  return db.prepare("SELECT * FROM financial_statement_snapshots WHERE period=?").get(period);
}
function ensureClosedFinancialStatementSnapshots(now=new Date()){
  const current=nyToday().slice(0,7);
  let cursor=FINANCIAL_HISTORY_START;
  let guard=0;
  while(cursor<current && guard<240){snapshotFinancialStatementPeriod(cursor);const {monthEnd}=monthBounds(cursor);cursor=monthEnd.slice(0,7);guard+=1;}
}
const MAX_FINANCIAL_STATEMENT_CLOSE_TIMER_MS=6*60*60*1000;
function newYorkMonthKey(value=new Date()){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit"}).formatToParts(value);
  const year=parts.find(part=>part.type==="year")?.value;
  const month=parts.find(part=>part.type==="month")?.value;
  return `${year}-${month}`;
}
function scheduleFinancialStatementClose(){
  ensureClosedFinancialStatementSnapshots(new Date());
  const scheduleNext=(base=new Date())=>{
    const closeAt=nextNewYorkMonthClose(base);
    const boundary=nextNewYorkMonthBoundary(base);
    const closedPeriod=newYorkMonthKey(closeAt);
    const commitAt=new Date(boundary.getTime()+1000);
    const waitUntilBoundary=()=>{
      const remaining=commitAt.getTime()-Date.now();
      if(remaining<=0){
        try{snapshotFinancialStatementPeriod(closedPeriod,closeAt);}catch(error){console.warn('financial statement close failed:',error.message);}
        scheduleNext(new Date(commitAt.getTime()+1000));
        return;
      }
      const timer=setTimeout(waitUntilBoundary,Math.min(remaining,MAX_FINANCIAL_STATEMENT_CLOSE_TIMER_MS));
      if(typeof timer.unref==='function')timer.unref();
    };
    waitUntilBoundary();
  };
  scheduleNext();
}
function financialStatementCompanyData(){
  try{return businessDocuments.companyData();}catch(_error){return {trade_name:'Klavierhaus',legal_name:'Klavierhaus',city:'New York',state:'NY',country:'United States',invoice_currency:'USD'};}
}
function sendFinancialStatementPdf(res,statement,payload,{closed=false,period=null}={}){
  const company=financialStatementCompanyData();
  const generatedAt=closed?(payload.generatedAt||new Date().toISOString()):new Date().toISOString();
  const pdf=generateFinancialStatementPdf({statement,company,payload,generatedAt,closed,period:period||payload.month});
  const label=statement==='balance-sheet'?'balance-sheet':'income-statement';
  const suffix=closed?`${period}-closed`:`${payload.month}-realtime`;
  res.type('application/pdf').set('Content-Disposition',`attachment; filename="klavierhaus-${label}-${suffix}.pdf"`).send(pdf);
}

app.get('/api/financial-statements/periods',auth,permit('ADMIN','MANAGER'),(_req,res)=>{
  try{ensureClosedFinancialStatementSnapshots(new Date());const rows=db.prepare("SELECT period,period_end,closed_at,closed_at_local,created_at FROM financial_statement_snapshots WHERE period>=? ORDER BY period DESC").all(FINANCIAL_HISTORY_START);res.json(rows);}catch(error){res.status(500).json({error:error.message});}
});
app.get('/api/financial-statements/:statement/realtime.pdf',auth,permit('ADMIN','MANAGER'),(req,res)=>{
  try{if(!['balance-sheet','income-statement'].includes(req.params.statement))return res.status(404).json({error:'STATEMENT_NOT_FOUND'});const payload=incomeStatementPayload(nyToday().slice(0,7));sendFinancialStatementPdf(res,req.params.statement,payload,{closed:false});}catch(error){res.status(400).json({error:error.message});}
});
app.get('/api/financial-statements/:statement/:period.pdf',auth,permit('ADMIN','MANAGER'),(req,res)=>{
  try{if(!['balance-sheet','income-statement'].includes(req.params.statement))return res.status(404).json({error:'STATEMENT_NOT_FOUND'});if(!/^\d{4}-\d{2}$/.test(req.params.period)||req.params.period<FINANCIAL_HISTORY_START)return res.status(400).json({error:'INVALID_FINANCIAL_PERIOD'});const row=snapshotFinancialStatementPeriod(req.params.period,new Date());if(!row)return res.status(409).json({error:'FINANCIAL_PERIOD_NOT_CLOSED'});const payload=req.params.statement==='balance-sheet'?JSON.parse(row.balance_sheet_json):JSON.parse(row.income_statement_json);sendFinancialStatementPdf(res,req.params.statement,payload,{closed:true,period:req.params.period});}catch(error){res.status(400).json({error:error.message});}
});

app.get("/api/income-statement/monthly", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  try{ res.json(incomeStatementPayload(req.query.month || nyToday().slice(0,7))); }
  catch(e){ res.status(400).json({error:e.message}); }
});

app.get("/api/income-statement", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  try{ res.json(incomeStatementPayload(nyToday().slice(0,7))); }
  catch(e){ res.status(400).json({error:e.message}); }
});

app.get("/api/users", auth, (req,res)=> {
  // Hidden superadmin is never listed. Everyone may see the visible team list.
  res.json(db.prepare(`SELECT u.id,u.name,u.email,u.contact_email,u.google_calendar_email,u.role,u.status,u.phone,u.address,u.calendar_color,u.created_at,
    CASE WHEN aa.user_id IS NULL THEN 'VERIFIED' ELSE aa.status END AS activation_status,
    COALESCE(aa.last_delivery_status,'LEGACY_ACCOUNT') AS activation_delivery_status
    FROM users u LEFT JOIN account_activations aa ON aa.user_id=u.id
    WHERE COALESCE(u.hidden_user,0)=0 ORDER BY u.role,u.name`).all());
});

app.post("/api/users", auth, requirePermission("users.create"), async(req,res)=>{
  const {name,password,role}=req.body;
  const email=normalizeUserEmail(req.body.email);
  const contactEmail=normalizeContactEmail(req.body.contact_email);
  if(!name || !email || !contactEmail || !password || !role) return res.status(400).json({error:"REQUIRED_FIELDS"});
  if(!isValidUserEmail(email)) return res.status(400).json({error:"INVALID_USER_EMAIL"});
  if(!isValidContactEmail(contactEmail)) return res.status(400).json({error:"INVALID_CONTACT_EMAIL"});
  if(password!==String(req.body.password_confirmation??'')) return res.status(400).json({error:"PASSWORD_CONFIRMATION_MISMATCH"});
  if(role==="SUPERADMIN") return res.status(403).json({error:"Superadmin cannot be created from UI / Szuperadmin nem hozható létre a felületről"});
  if(!VISIBLE_USER_ROLES.includes(role)) return res.status(400).json({error:"INVALID_USER_ROLE"});
  if(db.prepare("SELECT id FROM users WHERE lower(trim(email))=? LIMIT 1").get(email)) return res.status(409).json({error:"USER_EMAIL_ALREADY_USED"});
  if(db.prepare("SELECT id FROM users WHERE lower(trim(contact_email))=? LIMIT 1").get(contactEmail)) return res.status(409).json({error:"CONTACT_EMAIL_ALREADY_USED"});
  if(!canManageCalendarColors(req.user)) return res.status(403).json({error:"PERMISSION_DENIED"});
  const activeNames=db.prepare("SELECT name FROM users WHERE status='Active' AND COALESCE(hidden_user,0)=0 AND role IN ('ADMIN','MANAGER','WORKER') ORDER BY name").all().map(row=>row.name);
  const orderedNames=[...activeNames,name].sort((a,b)=>String(a).localeCompare(String(b)));
  const requestedColor=req.body.calendar_color===undefined?legacyCalendarColor(name,orderedNames):req.body.calendar_color;
  const colorValidation=validateCalendarColor(requestedColor);
  if(!colorValidation.ok) return res.status(400).json({error:colorValidation.error});
  const googleCalendarEmail=String(req.body.google_calendar_email||'').trim().toLowerCase();
  if(googleCalendarEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(googleCalendarEmail)) return res.status(400).json({error:'INVALID_GOOGLE_CALENDAR_EMAIL'});
  if(googleCalendarEmail && db.prepare("SELECT id FROM users WHERE lower(trim(google_calendar_email))=?").get(googleCalendarEmail)) return res.status(409).json({error:'GOOGLE_CALENDAR_EMAIL_ALREADY_USED'});
  const id=rid("U");
  const hash=bcrypt.hashSync(password,10);
  let issuance;
  const createUser=db.transaction(()=>{
    db.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,phone,address,calendar_color,google_calendar_email,hidden_user,is_superadmin) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id,name,email,contactEmail,hash,role,"Active",req.body.phone||"",req.body.address||"",colorValidation.color,googleCalendarEmail||null,0,0);
    db.prepare("INSERT OR IGNORE INTO notification_preferences(user_id,push_enabled,job_assigned,job_transferred,job_updated,job_deleted,one_hour_reminder,direct_message) VALUES(?,1,1,1,1,1,1,1)").run(id);
    if(role==="WORKER") ensure1099PartnerForUser(id,{force:true});
    issuance=accountActivation.issue(id);
  });
  try{createUser();}catch(_error){return res.status(500).json({error:'USER_CREATE_FAILED'});}
  const created={id,name,email,contact_email:contactEmail,google_calendar_email:googleCalendarEmail,role,status:"Active",phone:req.body.phone||"",address:req.body.address||"",calendar_color:colorValidation.color,activation_status:'PENDING'};
  const delivery=await accountActivation.deliver(created,issuance,'INITIAL');
  audit(req,"CREATE","users",id,null,{...created,activation_delivery_status:delivery.status});
  res.json({...created,activation_delivery_status:delivery.status,email_delivery_error:delivery.error||null});
});

app.put("/api/users/:id", auth, async(req,res)=>{
  const target=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if(!target) return res.status(404).json({error:"User not found"});
  if(Number(target.hidden_user||0)===1 && !isSuperadminUser(req.user)) return res.status(403).json({error:"Hidden system owner cannot be edited"});

  const selfEdit = req.user.id === target.id;
  const superEdit = isSuperadminUser(req.user);
  const roleAdmin = hasPermission(req.user,"users.roles");
  if(!selfEdit && !superEdit && !roleAdmin) return res.status(403).json({error:"PERMISSION_DENIED"});
  if(req.body.calendar_color!==undefined && !canManageCalendarColors(req.user)) return res.status(403).json({error:"PERMISSION_DENIED"});

  const changes={...req.body};
  let allowed = (superEdit || roleAdmin) ? ["name","email","contact_email","google_calendar_email","role","status","phone","address"] : ["name","email","contact_email","google_calendar_email","phone","address"];
  if(canManageCalendarColors(req.user)) allowed.push("calendar_color");
  if(!superEdit && !roleAdmin && (req.body.role!==undefined || req.body.status!==undefined)) return res.status(403).json({error:"PERMISSION_DENIED"});
  if(req.body.role==="SUPERADMIN") return res.status(403).json({error:"Cannot promote visible user to hidden superadmin from UI"});
  if(req.body.role!==undefined && !VISIBLE_USER_ROLES.includes(req.body.role)) return res.status(400).json({error:"INVALID_USER_ROLE"});
  if(changes.email!==undefined){
    changes.email=normalizeUserEmail(changes.email);
    if(!isValidUserEmail(changes.email)) return res.status(400).json({error:"INVALID_USER_EMAIL"});
    const duplicate=db.prepare("SELECT id FROM users WHERE lower(trim(email))=? AND id<>? LIMIT 1").get(changes.email,target.id);
    if(duplicate) return res.status(409).json({error:"USER_EMAIL_ALREADY_USED"});
  }
  if(changes.contact_email!==undefined){
    changes.contact_email=normalizeContactEmail(changes.contact_email)||null;
    if(changes.contact_email && !isValidContactEmail(changes.contact_email)) return res.status(400).json({error:"INVALID_CONTACT_EMAIL"});
    const activation=accountActivation.state(target.id);
    if(activation?.status==='PENDING' && !changes.contact_email) return res.status(400).json({error:'ACTIVATION_CONTACT_EMAIL_MISSING'});
    const duplicate=changes.contact_email?db.prepare("SELECT id FROM users WHERE lower(trim(contact_email))=? AND id<>? LIMIT 1").get(changes.contact_email,target.id):null;
    if(duplicate) return res.status(409).json({error:"CONTACT_EMAIL_ALREADY_USED"});
  }
  if(changes.calendar_color!==undefined){
    const colorValidation=validateCalendarColor(changes.calendar_color);
    if(!colorValidation.ok) return res.status(400).json({error:colorValidation.error});
    changes.calendar_color=colorValidation.color;
  }
  if(changes.google_calendar_email!==undefined){
    changes.google_calendar_email=String(changes.google_calendar_email||'').trim().toLowerCase()||null;
    if(changes.google_calendar_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.google_calendar_email)) return res.status(400).json({error:'INVALID_GOOGLE_CALENDAR_EMAIL'});
    const duplicate=changes.google_calendar_email?db.prepare("SELECT id FROM users WHERE lower(trim(google_calendar_email))=? AND id<>?").get(changes.google_calendar_email,target.id):null;
    if(duplicate) return res.status(409).json({error:'GOOGLE_CALENDAR_EMAIL_ALREADY_USED'});
  }

  const password=typeof req.body.password==='string'?req.body.password:'';
  const passwordConfirmation=typeof req.body.password_confirmation==='string'?req.body.password_confirmation:'';
  const passwordChangeRequested=password.length>0 || passwordConfirmation.length>0;
  if(passwordChangeRequested && (!password || password!==passwordConfirmation)) return res.status(400).json({error:"PASSWORD_CONFIRMATION_MISMATCH"});
  const values={};
  allowed.filter(c=>changes[c]!==undefined).forEach(c=>{values[c]=changes[c];});
  if(passwordChangeRequested) values.password_hash=bcrypt.hashSync(password,10);
  const cols=Object.keys(values);
  let activationIssuance=null;
  const contactEmailChanged=changes.contact_email!==undefined && String(changes.contact_email||'')!==String(target.contact_email||'');
  const targetActivation=accountActivation.state(target.id);
  const effectiveRole=String(changes.role!==undefined?changes.role:target.role);
  const updateUserTx=db.transaction(()=>{
    if(cols.length) db.prepare(`UPDATE users SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>values[c]),req.params.id);
    if(passwordChangeRequested){
      const persisted=db.prepare("SELECT password_hash FROM users WHERE id=?").get(req.params.id);
      if(!persisted || !bcrypt.compareSync(password,persisted.password_hash)) throw new Error("PASSWORD_UPDATE_FAILED");
    }
    if(contactEmailChanged && targetActivation?.status==='PENDING') activationIssuance=accountActivation.issue(target.id);
    if(changes.name!==undefined && String(changes.name)!==String(target.name)){
      db.prepare("UPDATE jobs SET assigned_to=? WHERE assigned_user_id=?").run(changes.name,target.id);
      db.prepare("UPDATE jobs SET created_by=? WHERE created_by_user_id=?").run(changes.name,target.id);
      db.prepare("UPDATE jobs SET last_reassigned_by=? WHERE last_reassigned_by_user_id=?").run(changes.name,target.id);
      db.prepare("UPDATE planned_jobs SET preferred_assigned_to=? WHERE preferred_assigned_user_id=?").run(changes.name,target.id);
      db.prepare("UPDATE planned_jobs SET created_by=? WHERE created_by_user_id=?").run(changes.name,target.id);
    }
    if(effectiveRole==="WORKER") ensure1099PartnerForUser(target.id,{force:true});
  });
  try{updateUserTx();}catch(error){return res.status(500).json({error:error.message==='PASSWORD_UPDATE_FAILED'?error.message:(effectiveRole==="WORKER"?"TECHNICIAN_PARTNER_ASSIGNMENT_FAILED":"USER_UPDATE_FAILED"),details:effectiveRole==="WORKER"?error.message:undefined});}
  const u=db.prepare(`SELECT u.id,u.name,u.email,u.contact_email,u.google_calendar_email,u.role,u.status,u.phone,u.address,u.calendar_color,
    CASE WHEN aa.user_id IS NULL THEN 'VERIFIED' ELSE aa.status END AS activation_status,
    COALESCE(aa.last_delivery_status,'LEGACY_ACCOUNT') AS activation_delivery_status
    FROM users u LEFT JOIN account_activations aa ON aa.user_id=u.id WHERE u.id=?`).get(req.params.id);
  let activationDelivery=null;
  if(activationIssuance)activationDelivery=await accountActivation.deliver(u,activationIssuance,'CONTACT_EMAIL_CHANGED');
  audit(req,"UPDATE","users",req.params.id,userAuditSnapshot(target),u);
  res.json({...u,password_updated:passwordChangeRequested,activation_delivery_status:activationDelivery?.status||u.activation_delivery_status,email_delivery_error:activationDelivery?.error||null});
});

app.post('/api/users/:id/resend-activation',auth,requirePermission('users.create'),async(req,res)=>{
  const target=db.prepare("SELECT * FROM users WHERE id=? AND COALESCE(hidden_user,0)=0").get(req.params.id);
  if(!target)return res.status(404).json({error:'USER_NOT_FOUND'});
  const activation=accountActivation.state(target.id);
  if(!activation)return res.status(409).json({error:'ACTIVATION_NOT_REQUIRED'});
  if(activation.status!=='PENDING')return res.status(409).json({error:'ACTIVATION_ALREADY_COMPLETED'});
  if(!isValidContactEmail(target.contact_email))return res.status(409).json({error:'ACTIVATION_CONTACT_EMAIL_MISSING'});
  const retryAfter=activationResendCooldown(activation);
  if(retryAfter)return res.status(429).json({error:'ACTIVATION_RESEND_TOO_SOON',retry_after_seconds:retryAfter});
  const issuance=accountActivation.issue(target.id);
  const delivery=await accountActivation.deliver(target,issuance,'ADMIN_RESEND');
  audit(req,'ACTIVATION_RESENT','users',target.id,null,{delivery_status:delivery.status},delivery.status==='ACCEPTED'?1:0,'Activation email resent','TECHNICAL');
  if(delivery.status!=='ACCEPTED')return res.status(502).json({error:delivery.error||'EMAIL_DELIVERY_FAILED'});
  res.json({ok:true,activation_status:'PENDING',activation_delivery_status:delivery.status});
});

app.delete("/api/users/:id", auth, requireSuperadmin, (req,res)=>{
  const target=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if(!target) return res.status(404).json({error:"User not found"});
  if(Number(target.hidden_user||0)===1) return res.status(403).json({error:"Hidden system owner cannot be deleted"});
  db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  audit(req,"MASTER_DELETE","users",req.params.id,target,null);
  res.json({ok:true});
});


app.post('/api/imports/clients/analyze',auth,permit('ADMIN'),clientImportUpload.single('file'),(req,res)=>{
  try{
    if(!req.file?.buffer)return res.status(400).json({error:'EXCEL_FILE_REQUIRED'});
    const analysis=analyzeClientImportFile(req.file.buffer,req.file.originalname||'import.xlsx');
    const fileHash=crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const existingBatch=db.prepare('SELECT * FROM import_batches WHERE import_source=? AND file_hash=?').get(analysis.source,fileHash);
    if(existingBatch?.status==='COMPLETED')return res.status(409).json({error:'FILE_ALREADY_IMPORTED',batchId:existingBatch.id});
    const batchId=existingBatch?.id||`IMP-${Date.now()}-${Math.floor(Math.random()*100000)}`;
    const summaryJson=JSON.stringify({summary:analysis.summary,records:analysis.records,source:analysis.source});
    if(existingBatch){
      db.prepare(`UPDATE import_batches SET original_filename=?,status='PREVIEW',total_rows=?,importable_rows=?,skipped_duplicates=?,missing_data_clients=?,failed_rows=?,imported_by_user_id=?,summary_json=? WHERE id=?`).run(req.file.originalname,analysis.summary.totalRows,analysis.summary.newClients,analysis.summary.alreadyImported+analysis.summary.possibleDuplicates,analysis.summary.missingDataClients,analysis.summary.invalidRows,req.user.id,summaryJson,batchId);
    }else{
      db.prepare(`INSERT INTO import_batches(id,import_source,original_filename,file_hash,status,total_rows,importable_rows,skipped_duplicates,missing_data_clients,failed_rows,imported_by_user_id,summary_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(batchId,analysis.source,req.file.originalname,fileHash,'PREVIEW',analysis.summary.totalRows,analysis.summary.newClients,analysis.summary.alreadyImported+analysis.summary.possibleDuplicates,analysis.summary.missingDataClients,analysis.summary.invalidRows,req.user.id,summaryJson);
    }
    const publicRecords=analysis.records.map(r=>({rowNumber:r.rowNumber,externalReference:r.externalReference,name:r.name,phone:r.phone,email:r.email,serviceAddress:r.serviceAddress,status:r.status,lastContact:r.lastContact,nextStep:r.nextStep,reviewStatus:r.reviewStatus,missingFields:r.missingFields,hasMissingData:r.hasMissingData,category:r.category,reason:r.reason,match:r.match?{id:r.match.id,name:r.match.name,email:r.match.email,phone:r.match.phone,address:r.match.address}:null}));
    res.json({batchId,source:analysis.source,summary:analysis.summary,records:publicRecords});
  }catch(err){
    console.error('client import analyze failed:',err);
    const known=['INVALID_XLSX_STRUCTURE','NO_IMPORTABLE_CLIENT_SHEET','IMPORT_READY_EMPTY','MISSING_COLUMNS'];
    const code=known.includes(err.message)?err.message:'IMPORT_ANALYSIS_FAILED';
    res.status(400).json({error:code,missingColumns:err.missingColumns||[]});
  }
});


app.post('/api/imports/clients/:batchId/commit',auth,permit('ADMIN'),(req,res)=>{
  const batchId=String(req.params.batchId||'').trim();
  const batch=db.prepare('SELECT * FROM import_batches WHERE id=?').get(batchId);
  if(!batch)return res.status(404).json({error:'IMPORT_BATCH_NOT_FOUND'});
  if(batch.status==='COMPLETED')return res.status(409).json({error:'IMPORT_BATCH_ALREADY_COMPLETED'});
  if(batch.status!=='PREVIEW')return res.status(409).json({error:'IMPORT_BATCH_NOT_READY'});
  if(!isSuperadminUser(req.user) && String(batch.imported_by_user_id||'')!==String(req.user.id||''))return res.status(403).json({error:'IMPORT_BATCH_OWNER_MISMATCH'});

  let stored;
  try{stored=JSON.parse(batch.summary_json||'{}');}catch(_e){stored={};}
  const records=Array.isArray(stored.records)?stored.records:[];
  const source=String(stored.source||batch.import_source||'NEW_YORK_CUSTOMER_LIST_2024');
  if(!records.length)return res.status(409).json({error:'IMPORT_PREVIEW_DATA_MISSING'});

  const commitImport=()=>commitClientImportRecords(db,{records,source,batchId});

  try{
    const result=commitImport();
    req.skipAutoAudit=true;
    audit(req,'CLIENT_IMPORT_COMPLETED','imports',batchId,null,result,1,`Imported ${result.importedClients} clients; skipped ${result.skippedDuplicates}; missing data ${result.missingDataClients}; failed ${result.failedRows}`,'TECHNICAL');
    res.json({ok:true,...result});
  }catch(err){
    console.error('client import commit failed:',err);
    try{db.prepare(`UPDATE import_batches SET status='FAILED',failed_rows=COALESCE(failed_rows,0)+1,summary_json=? WHERE id=? AND status='PREVIEW'`).run(JSON.stringify({error:err.message}),batchId);}catch(_e){}
    req.skipAutoAudit=true;
    audit(req,'CLIENT_IMPORT_FAILED','imports',batchId,null,null,0,err.message,'TECHNICAL');
    res.status(500).json({error:err.message==='CONTACT_ID_LIMIT_REACHED'?err.message:'CLIENT_IMPORT_FAILED'});
  }
});

const pianoImportUpload=createPianoImportUpload();
app.post('/api/imports/pianos/analyze',auth,permit('ADMIN'),pianoImportUpload.single('file'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'INVALID_EXCEL_FILE'});
  try{
    const analysis=analyzePianoImportFile(req.file.buffer,req.file.originalname||'pianos.xlsx');
    const fileHash=crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const existingBatch=db.prepare('SELECT * FROM import_batches WHERE import_source=? AND file_hash=?').get(analysis.source,fileHash);
    if(existingBatch&&existingBatch.status==='COMPLETED')return res.status(409).json({error:'FILE_ALREADY_IMPORTED'});
    const batchId=existingBatch?.id||rid('IMP');
    const summaryJson=JSON.stringify({source:analysis.source,clientSource:analysis.clientSource,summary:analysis.summary,records:analysis.records,multiplePianoClients:analysis.multiplePianoClients});
    if(existingBatch){
      db.prepare(`UPDATE import_batches SET original_filename=?,status='PREVIEW',total_rows=?,importable_rows=?,skipped_duplicates=?,failed_rows=?,imported_by_user_id=?,summary_json=?,completed_at=NULL WHERE id=?`).run(req.file.originalname,analysis.summary.totalRows,analysis.summary.newMatched+analysis.summary.newUnidentifiedOwner,analysis.summary.alreadyImported+analysis.summary.possibleDuplicates,analysis.summary.invalidRows+analysis.summary.clientNotFound,req.user.id,summaryJson,batchId);
    }else{
      db.prepare(`INSERT INTO import_batches(id,import_source,original_filename,file_hash,status,total_rows,importable_rows,skipped_duplicates,failed_rows,imported_by_user_id,summary_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(batchId,analysis.source,req.file.originalname,fileHash,'PREVIEW',analysis.summary.totalRows,analysis.summary.newMatched+analysis.summary.newUnidentifiedOwner,analysis.summary.alreadyImported+analysis.summary.possibleDuplicates,analysis.summary.invalidRows+analysis.summary.clientNotFound,req.user.id,summaryJson);
    }
    res.json({batchId,summary:analysis.summary,records:analysis.records,multiplePianoClients:analysis.multiplePianoClients});
  }catch(err){
    console.error('piano import analyze failed:',err);
    const status=err.message==='MISSING_COLUMNS'?400:400;
    res.status(status).json({error:err.message,missingColumns:err.missingColumns||[]});
  }
});

app.post('/api/imports/pianos/:batchId/commit',auth,permit('ADMIN'),(req,res)=>{
  const batchId=req.params.batchId;
  const batch=db.prepare('SELECT * FROM import_batches WHERE id=?').get(batchId);
  if(!batch)return res.status(404).json({error:'IMPORT_BATCH_NOT_FOUND'});
  if(batch.status==='COMPLETED')return res.status(409).json({error:'IMPORT_BATCH_ALREADY_COMPLETED'});
  if(batch.status!=='PREVIEW')return res.status(409).json({error:'IMPORT_BATCH_NOT_READY'});
  if(!isSuperadminUser(req.user)&&String(batch.imported_by_user_id||'')!==String(req.user.id||''))return res.status(403).json({error:'IMPORT_BATCH_OWNER_MISMATCH'});
  let stored; try{stored=JSON.parse(batch.summary_json||'{}');}catch(_e){return res.status(400).json({error:'IMPORT_PREVIEW_DATA_MISSING'});}
  const records=Array.isArray(stored.records)?stored.records:[]; if(!records.length)return res.status(400).json({error:'IMPORT_PREVIEW_DATA_MISSING'});
  const source=String(stored.source||batch.import_source||'NEW_YORK_CUSTOMER_LIST_2024_PIANOS');
  const clientSource=String(stored.clientSource||'NEW_YORK_CUSTOMER_LIST_2024');
  const commit=db.transaction(()=>{
    const current=db.prepare('SELECT status FROM import_batches WHERE id=?').get(batchId); if(!current||current.status!=='PREVIEW')throw new Error('IMPORT_BATCH_NOT_READY');
    const clients=db.prepare('SELECT id,name,external_reference,import_source,has_piano FROM contacts').all();
    const clientByRef=new Map(clients.filter(x=>x.import_source===clientSource&&x.external_reference).map(x=>[String(x.external_reference),x]));
    const existing=db.prepare('SELECT id,display_name,original_description,owner_contact_id,external_reference,import_source FROM pianos').all();
    const exactRefs=new Map(existing.filter(x=>x.import_source&&x.external_reference).map(x=>[`${x.import_source}::${x.external_reference}`,x]));
    const ownerDesc=new Map(); for(const p of existing){const d=normalizePianoDescription(p.original_description||p.display_name);if(p.owner_contact_id&&d&&!ownerDesc.has(`${p.owner_contact_id}::${d}`))ownerDesc.set(`${p.owner_contact_id}::${d}`,p);}
    const insert=db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,year,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes,external_reference,import_source,import_batch_id,original_description,owner_resolution) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const updateClient=db.prepare('UPDATE contacts SET has_piano=1,updated_at=CURRENT_TIMESTAMP WHERE id=?');
    let importedPianos=0,updatedClients=0,unidentifiedOwnerPianos=0,skippedAlreadyImported=0,skippedPossibleDuplicates=0,clientNotFound=0,invalidRows=0,failedRows=0;
    const touched=new Set();
    for(const rec of records){
      if(rec.category==='ALREADY_IMPORTED'){skippedAlreadyImported++;continue;}
      if(rec.category==='POSSIBLE_DUPLICATE'){skippedPossibleDuplicates++;continue;}
      if(rec.category==='CLIENT_NOT_FOUND'){clientNotFound++;continue;}
      if(rec.category==='INVALID'){invalidRows++;continue;}
      if(!['NEW_MATCHED','NEW_UNIDENTIFIED_OWNER'].includes(rec.category)){invalidRows++;continue;}
      if(exactRefs.has(`${source}::${rec.externalReference}`)){skippedAlreadyImported++;continue;}
      let client=null,ownerId=null,ownerResolution='UNIDENTIFIED_OWNER',ownership='Unknown';
      if(rec.category==='NEW_MATCHED'){
        client=clientByRef.get(rec.clientExternalReference)||null;
        if(!client){clientNotFound++;continue;}
        const duplicate=ownerDesc.get(`${client.id}::${normalizePianoDescription(rec.description)}`);
        if(duplicate){skippedPossibleDuplicates++;continue;}
        ownerId=client.id;ownerResolution='MATCHED_CLIENT';ownership=rec.ownershipType||'Customer owned';
      }else{unidentifiedOwnerPianos++;}
      const id=rid('P');
      const display=String(rec.description||rec.originalDescription||'Unknown piano').trim();
      insert.run(id,'','','',null,ownership,ownership,display,ownerId,String(rec.location||'').trim(),0,String(rec.status||'Active'),'',String(rec.externalReference||'').trim(),source,batchId,String(rec.originalDescription||rec.description||'').trim(),ownerResolution);
      if(ownerId)linkClientPiano(ownerId,id);
      exactRefs.set(`${source}::${rec.externalReference}`,{id,owner_contact_id:ownerId,original_description:rec.originalDescription,display_name:display});
      if(ownerId){ownerDesc.set(`${ownerId}::${normalizePianoDescription(rec.description)}`,{id});touched.add(ownerId);}
      importedPianos++;
    }
    for(const id of touched){const c=clients.find(x=>x.id===id);if(c&&!Number(c.has_piano||0)){updateClient.run(id);updatedClients++;}}
    const result={batchId,source,filename:batch.original_filename,totalRows:records.length,importedPianos,updatedClients,unidentifiedOwnerPianos,skippedAlreadyImported,skippedPossibleDuplicates,clientNotFound,invalidRows,failedRows};
    db.prepare(`UPDATE import_batches SET status='COMPLETED',imported_pianos=?,updated_clients=?,unidentified_owner_pianos=?,client_not_found=?,skipped_duplicates=?,failed_rows=?,completed_at=CURRENT_TIMESTAMP,summary_json=? WHERE id=? AND status='PREVIEW'`).run(importedPianos,updatedClients,unidentifiedOwnerPianos,clientNotFound,skippedAlreadyImported+skippedPossibleDuplicates,failedRows+invalidRows,JSON.stringify(result),batchId);
    return result;
  });
  try{
    const result=commit(); req.skipAutoAudit=true;
    audit(req,'PIANO_IMPORT_COMPLETED','imports',batchId,null,result,1,`Imported ${result.importedPianos} pianos; updated ${result.updatedClients} clients; unidentified ${result.unidentifiedOwnerPianos}; skipped ${result.skippedAlreadyImported+result.skippedPossibleDuplicates}`,'TECHNICAL');
    res.json({ok:true,...result});
  }catch(err){
    console.error('piano import commit failed:',err);
    try{db.prepare(`UPDATE import_batches SET status='FAILED',failed_rows=COALESCE(failed_rows,0)+1,summary_json=? WHERE id=? AND status='PREVIEW'`).run(JSON.stringify({error:err.message}),batchId);}catch(_e){}
    req.skipAutoAudit=true;audit(req,'PIANO_IMPORT_FAILED','imports',batchId,null,null,0,err.message,'TECHNICAL');
    res.status(500).json({error:err.message==='IMPORT_BATCH_NOT_READY'?err.message:'PIANO_IMPORT_FAILED'});
  }
});

function createResourceRoutes(key, table, prefix, write, roles){
  app.get(`/api/${key}`, auth, (req,res)=>res.json(db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC`).all()));
  app.post(`/api/${key}`, auth, permit(...roles), (req,res)=>{
    try{
      const id=req.body.id || (key==="contacts" ? nextContactId() : rid(prefix));
      const body={...req.body};
      if(write.includes("payment_method") && body.payment_method!==undefined){const normalized=body.payment_method?normalizePaymentMethod(body.payment_method,{allowEmpty:false}):null;if(body.payment_method&&!normalized)return res.status(400).json({error:"Invalid payment method / Hibás fizetési mód"});body.payment_method=normalized||"";}
      const cols=["id",...write].filter(c=>c==="id" || body[c]!==undefined);
      const saved=db.transaction(()=>{
        db.prepare(`INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...cols.map(c=>c==="id"?id:body[c]));
        const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
        if(key==="contacts")jobDomain.syncCrmFollowUp({contact:row,actor:req.user});
        return row;
      })();
      res.json(saved);
    }catch(error){res.status(error.status||400).json({error:error.code||error.message});}
  });
  app.put(`/api/${key}/:id`, auth, permit(...roles), (req,res)=>{
    try{
      const body={...req.body};
      if(write.includes("payment_method") && body.payment_method!==undefined){const normalized=body.payment_method?normalizePaymentMethod(body.payment_method,{allowEmpty:false}):null;if(body.payment_method&&!normalized)return res.status(400).json({error:"Invalid payment method / Hibás fizetési mód"});body.payment_method=normalized||"";}
      const cols=write.filter(c=>body[c]!==undefined);
      const saved=db.transaction(()=>{
        if(cols.length) db.prepare(`UPDATE ${table} SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>body[c]), req.params.id);
        const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
        if(!row)throw Object.assign(new Error(`${key.toUpperCase()}_NOT_FOUND`),{status:404,code:`${key.toUpperCase()}_NOT_FOUND`});
        if(key==="contacts")jobDomain.syncCrmFollowUp({contact:row,actor:req.user});
        return row;
      })();
      res.json(saved);
    }catch(error){res.status(error.status||400).json({error:error.code||error.message});}
  });
  app.delete(`/api/${key}/:id`, auth, requireSuperadmin, (req,res)=>{
    if(key==="contacts"){
      db.prepare("UPDATE pianos SET owner_contact_id=NULL,owner_resolution='UNIDENTIFIED_OWNER',ownership='Unknown',ownership_type='Unknown',updated_at=CURRENT_TIMESTAMP WHERE owner_contact_id=?").run(req.params.id);
      db.prepare("DELETE FROM jobs WHERE COALESCE(is_crm_follow_up,0)=1 AND contact_id=?").run(req.params.id);
    }
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    res.json({ok:true});
  });
}
createResourceRoutes("contacts","contacts","C",["name","company","type","email","phone","address_line1","city","state","postal_code","country","address","billing_address","tax_id","priority","status","owner","relationship_holder","loss_risk","last_contact","next_step","notes","has_piano","interested_buying","interest_brand","interest_model","interest_budget","interest_timeline","interest_notes","is_vip","follow_up_date","follow_up_cadence","follow_up_reason","relationship_notes","external_reference","import_source","import_batch_id"],["ADMIN","MANAGER","WORKER"]);

app.get("/api/contacts/:id", auth, (req,res)=>{
  const row=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!row)return res.status(404).json({error:"CONTACT_NOT_FOUND"});
  res.json(row);
});

app.post("/api/contacts/:id/follow-up/complete", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  try{
    const before=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
    if(!before)return res.status(404).json({error:"CONTACT_NOT_FOUND"});
    const result=jobDomain.completeCrmFollowUp({contactId:req.params.id,cadence:req.body?.cadence||"",nextFollowUpDate:Object.prototype.hasOwnProperty.call(req.body||{},"follow_up_date")?req.body.follow_up_date:undefined,actor:req.user});
    audit(req,"CRM_FOLLOW_UP_COMPLETE","contacts",req.params.id,before,result.contact,1,"CRM follow-up completed/rescheduled","TECHNICAL");
    res.json(result);
  }catch(error){res.status(error.status||400).json({error:error.code||error.message});}
});

registerPianoReferenceRoutes({app,db,auth,permit,audit,createPianoImportUpload});

app.get("/api/pianos", auth, (req,res)=>{
  const rows=db.prepare(`
    SELECT p.*,
           c.name AS owner_name,
           c.name AS client_name,
           c.email AS owner_email,
           c.phone AS owner_phone,
           c.address AS owner_address,
           cp.id AS client_piano_id,
           COALESCE(cp.is_verified,0) AS is_verified,
           cp.piano_location_address,
           cp.location_name,
           cp.verified_at,
           cp.verified_by
    FROM pianos p
    LEFT JOIN contacts c ON c.id = p.owner_contact_id
    LEFT JOIN client_pianos cp ON cp.piano_id=p.id AND cp.client_id=p.owner_contact_id
    ORDER BY p.display_name, p.brand, p.model
  `).all();
  res.json(rows);
});

app.get("/api/pianos/:id", auth, (req,res)=>{
  const row=db.prepare(`
    SELECT p.*,c.name AS owner_name,c.name AS client_name,c.email AS owner_email,c.phone AS owner_phone,c.address AS owner_address,
           cp.id AS client_piano_id,COALESCE(cp.is_verified,0) AS is_verified,cp.piano_location_address,cp.location_name,cp.verified_at,cp.verified_by
    FROM pianos p
    LEFT JOIN contacts c ON c.id=p.owner_contact_id
    LEFT JOIN client_pianos cp ON cp.piano_id=p.id AND cp.client_id=p.owner_contact_id
    WHERE p.id=?
  `).get(req.params.id);
  if(!row)return res.status(404).json({error:"PIANO_NOT_FOUND"});
  res.json(row);
});

app.post("/api/client-pianos/:id/verify", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const before=db.prepare(`SELECT cp.*,p.id AS piano_id,p.brand,p.model,c.name AS client_name FROM client_pianos cp
    JOIN pianos p ON p.id=cp.piano_id JOIN contacts c ON c.id=cp.client_id WHERE cp.id=?`).get(req.params.id);
  if(!before)return res.status(404).json({error:"CLIENT_PIANO_LINK_NOT_FOUND"});
  const verifiedBy=String(req.user?.name||req.user?.id||"").trim()||"SYSTEM";
  db.prepare("UPDATE client_pianos SET is_verified=1,verified_at=CURRENT_TIMESTAMP,verified_by=? WHERE id=?").run(verifiedBy,before.id);
  const after=db.prepare(`SELECT cp.*,p.id AS piano_id,p.brand,p.model,c.name AS client_name FROM client_pianos cp
    JOIN pianos p ON p.id=cp.piano_id JOIN contacts c ON c.id=cp.client_id WHERE cp.id=?`).get(before.id);
  audit(req,"VERIFY","client_pianos",before.id,before,after,1,"Client Piano data verified","TECHNICAL");
  res.json(after);
});

app.get("/api/client-pianos/export", auth, (req,res)=>{
  try{
    const format=String(req.query?.format||"csv").trim().toLowerCase(),rows=clientPianoExportRows(db);
    if(!["csv","json"].includes(format))return res.status(400).json({error:"CLIENT_PIANO_EXPORT_FORMAT_UNSUPPORTED"});
    const content=format==="json"?JSON.stringify(rows,null,2):serializeClientPianoCsv(rows);
    res.json({format,filename:`client-pianos.${format}`,content,totalRows:rows.length});
  }catch(error){res.status(500).json({error:error.message||"CLIENT_PIANO_EXPORT_FAILED"});}
});

app.post("/api/client-pianos/import", auth, permit("ADMIN"), (req,res)=>{
  try{
    const format=String(req.body?.format||"").trim().toLowerCase(),content=String(req.body?.content||"");
    const rows=parseStructuredClientPianoPayload({format,content});
    const result=commitStructuredClientPianoImport(db,{rows,actorName:String(req.user?.name||req.user?.id||"IMPORT")});
    audit(req,"IMPORT","client_pianos","STRUCTURED",null,{...result,format},1,`Structured Client Piano ${format.toUpperCase()} import`,'TECHNICAL');
    res.status(201).json({ok:true,...result});
  }catch(error){
    res.status(400).json({error:error.message||"CLIENT_PIANO_IMPORT_FAILED",rowNumber:error.rowNumber||null,missingColumns:error.missingColumns||[]});
  }
});

function pianoOwnerResolution(ownerContactId,ownershipType){
  if(ownerContactId) return "MATCHED_CLIENT";
  const value=String(ownershipType||"").toLowerCase();
  if(value.includes("company")) return "COMPANY_OWNED";
  if(value.includes("consign")) return "COMPANY_REVIEW";
  if(value.includes("rental")) return "RENTAL";
  return "UNIDENTIFIED_OWNER";
}
function refreshClientHasPiano(clientId){
  if(!clientId)return;
  const count=db.prepare("SELECT COUNT(*) AS c FROM client_pianos WHERE client_id=?").get(clientId).c;
  db.prepare("UPDATE contacts SET has_piano=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(count>0?1:0,clientId);
}
function normalizedPianoSerial(value){return String(value||"").trim().toLowerCase();}
function existingPianoBySerial(serial,excludeId=null){const normalized=normalizedPianoSerial(serial);if(!normalized)return null;let sql="SELECT * FROM pianos WHERE lower(trim(serial_no))=?";const args=[normalized];if(excludeId){sql+=" AND id<>?";args.push(excludeId);}sql+=" LIMIT 1";return db.prepare(sql).get(...args)||null;}
function rejectDuplicatePianoSerial(res,serial,excludeId=null){const existing=existingPianoBySerial(serial,excludeId);if(!existing)return false;res.status(409).json({error:"PIANO_SERIAL_ALREADY_EXISTS",existing_piano_id:existing.id,serial_no:existing.serial_no});return true;}

app.post("/api/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  if(rejectDuplicatePianoSerial(res,req.body.serial_no))return;
  const id=req.body.id || rid("P");
  const brand=ensurePianoBrand(req.body.brand || "");
  const model=ensurePianoModel(brand,req.body.model || "");
  if(!brand||!model)return res.status(400).json({error:"PIANO_CORE_FIELDS_REQUIRED"});
  const display=`${brand} ${model}`.trim() || req.body.display_name || req.body.original_description || req.body.piano_name || "Unknown piano";
  const ownerContactId=req.body.owner_contact_id||null;
  const ownershipType=ownerContactId?"Customer owned":(req.body.ownership_type || req.body.ownership || "Unknown");
  const estimated=Number(req.body.estimated_value||0);
  const resolution=pianoOwnerResolution(ownerContactId,ownershipType);
  const reference=centralPianoLookup(db,{serial:req.body.serial_no||"",brand,model,currentYear:2026});
  const buildYear=req.body.build_year||reference.build_year||null;
  const sizeCm=req.body.size_cm||reference.size_cm||null;
  const sizeIn=req.body.size_in||req.body.size_inch||reference.size_inch||null;
  const sizeDisplay=req.body.size_display||((sizeCm||sizeIn)?[sizeCm?`${sizeCm} cm`:"",sizeIn?`(${sizeIn})`:""].filter(Boolean).join(" "):null);
  const sizeLength=String(req.body.size_length||sizeDisplay||"").trim();
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,finish,year,build_year,size_cm,size_in,size_display,size_length,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes,external_reference,import_source,import_batch_id,original_description,owner_resolution)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,brand||reference.brand||"",model||reference.model||"",req.body.serial_no||"",req.body.finish||"",req.body.year||null,buildYear,sizeCm,sizeIn,sizeDisplay,sizeLength,ownershipType,ownershipType,display,ownerContactId,req.body.location||"",estimated,req.body.status||"Active",req.body.notes||"",req.body.external_reference||null,req.body.import_source||null,req.body.import_batch_id||null,req.body.original_description||null,resolution);
  if(ownerContactId){
    linkClientPiano(ownerContactId,id);
    db.prepare("UPDATE client_pianos SET location_name=?,piano_location_address=? WHERE client_id=? AND piano_id=?")
      .run(String(req.body.location_name||"").trim(),String(req.body.piano_location_address||req.body.location||"").trim(),ownerContactId,id);
  }
  refreshClientHasPiano(ownerContactId);
  const piano=db.prepare(`SELECT p.*,cp.location_name,cp.piano_location_address FROM pianos p LEFT JOIN client_pianos cp ON cp.piano_id=p.id AND cp.client_id=p.owner_contact_id WHERE p.id=?`).get(id);
  res.json(piano);
});

app.put("/api/pianos/:id", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const before=db.prepare("SELECT * FROM pianos WHERE id=?").get(req.params.id);
  if(!before)return res.status(404).json({error:"Piano not found"});
  if(req.body.serial_no!==undefined&&rejectDuplicatePianoSerial(res,req.body.serial_no,req.params.id))return;
  const candidate={...before,...req.body};
  const reference=centralPianoLookup(db,{serial:candidate.serial_no||"",brand:candidate.brand||"",model:candidate.model||"",currentYear:2026});
  if(req.body.brand!==undefined) req.body.brand=ensurePianoBrand(req.body.brand);
  const catalogBrand=String(req.body.brand!==undefined?req.body.brand:before.brand||"").trim(),catalogModel=String(req.body.model!==undefined?req.body.model:before.model||"").trim();
  if(catalogBrand&&catalogModel)ensurePianoModel(catalogBrand,catalogModel);
  if(!catalogBrand||!catalogModel)return res.status(400).json({error:"PIANO_CORE_FIELDS_REQUIRED"});
  if(req.body.build_year===undefined && !candidate.build_year && reference.build_year) req.body.build_year=reference.build_year;
  if(req.body.size_cm===undefined && !candidate.size_cm && reference.size_cm) req.body.size_cm=reference.size_cm;
  if(req.body.size_in===undefined && !candidate.size_in && reference.size_inch) req.body.size_in=reference.size_inch;
  if(req.body.size_display===undefined && !candidate.size_display && reference.size_display) req.body.size_display=reference.size_display;
  const allowed=["brand","model","serial_no","finish","year","build_year","size_cm","size_in","size_display","size_length","ownership","ownership_type","display_name","owner_contact_id","location","estimated_value","status","notes","external_reference","import_source","import_batch_id","original_description","owner_resolution"];
  if((req.body.brand!==undefined||req.body.model!==undefined)&&req.body.display_name===undefined){req.body.display_name=`${String(req.body.brand!==undefined?req.body.brand:before.brand||"").trim()} ${String(req.body.model!==undefined?req.body.model:before.model||"").trim()}`.trim();}
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE pianos SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]), req.params.id);
  if(req.body.owner_contact_id!==undefined || req.body.ownership_type!==undefined){
    const ownerContactId=req.body.owner_contact_id!==undefined?(req.body.owner_contact_id||null):(before.owner_contact_id||null);
    const requestedOwnership=req.body.ownership_type!==undefined?req.body.ownership_type:(before.ownership_type||before.ownership||"Unknown");
    const ownershipType=ownerContactId?"Customer owned":requestedOwnership;
    const resolution=pianoOwnerResolution(ownerContactId,ownershipType);
    db.prepare("UPDATE pianos SET owner_contact_id=?,owner_resolution=?,ownership=?,ownership_type=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(ownerContactId,resolution,ownershipType,ownershipType,req.params.id);
    const ownerChanged=String(ownerContactId||"")!==String(before.owner_contact_id||"");
    if(ownerChanged){
      db.prepare("DELETE FROM client_pianos WHERE piano_id=?").run(req.params.id);
      if(ownerContactId) linkClientPiano(ownerContactId,req.params.id);
    }
    refreshClientHasPiano(before.owner_contact_id);
    refreshClientHasPiano(ownerContactId);
  }
  const effectiveOwnerId=req.body.owner_contact_id!==undefined?(req.body.owner_contact_id||null):(db.prepare("SELECT owner_contact_id FROM pianos WHERE id=?").get(req.params.id)?.owner_contact_id||null);
  if(effectiveOwnerId && (req.body.location_name!==undefined || req.body.piano_location_address!==undefined || req.body.location!==undefined)){
    linkClientPiano(effectiveOwnerId,req.params.id);
    const relation=db.prepare("SELECT location_name,piano_location_address FROM client_pianos WHERE client_id=? AND piano_id=?").get(effectiveOwnerId,req.params.id)||{};
    const locationName=req.body.location_name!==undefined?String(req.body.location_name??"").trim():String(relation.location_name||"");
    const physicalAddress=req.body.piano_location_address!==undefined?String(req.body.piano_location_address??"").trim():(req.body.location!==undefined?String(req.body.location??"").trim():String(relation.piano_location_address||""));
    db.prepare("UPDATE client_pianos SET location_name=?,piano_location_address=? WHERE client_id=? AND piano_id=?")
      .run(locationName,physicalAddress,effectiveOwnerId,req.params.id);
  }
  const piano=db.prepare(`SELECT p.*,cp.location_name,cp.piano_location_address FROM pianos p LEFT JOIN client_pianos cp ON cp.piano_id=p.id AND cp.client_id=p.owner_contact_id WHERE p.id=?`).get(req.params.id);
  res.json(piano);
});


app.delete("/api/pianos", auth, requireSuperadmin, (req,res)=>{
  const reset=db.transaction(()=>{
    const deletedPianos=Number(db.prepare("SELECT COUNT(*) AS c FROM pianos").get().c||0);
    const deletedImportBatches=Number(db.prepare("SELECT COUNT(*) AS c FROM import_batches WHERE UPPER(import_source) LIKE '%PIANO%'").get().c||0);

    // Preserve historical jobs and finance records, but remove broken technical links.
    db.prepare("UPDATE jobs SET piano_id=NULL WHERE piano_id IS NOT NULL AND piano_id<>''").run();
    db.prepare("UPDATE planned_jobs SET piano_id='' WHERE piano_id IS NOT NULL AND piano_id<>''").run();
    db.prepare("UPDATE journal_entries SET piano_id=NULL WHERE piano_id IS NOT NULL AND piano_id<>''").run();
    db.prepare("UPDATE financial_items SET piano_id=NULL WHERE piano_id IS NOT NULL AND piano_id<>''").run();
    db.prepare("UPDATE inventory_items SET linked_piano_id='' WHERE linked_piano_id IS NOT NULL AND linked_piano_id<>''").run();

    db.prepare("DELETE FROM client_pianos").run();
    db.prepare("DELETE FROM pianos").run();
    db.prepare("DELETE FROM import_batches WHERE UPPER(import_source) LIKE '%PIANO%'").run();
    db.prepare("DELETE FROM audit_log WHERE module='pianos' OR action GLOB 'PIANO_*' OR (module='imports' AND (action GLOB 'PIANO_*' OR LOWER(details) LIKE '%piano%'))").run();
    db.prepare("UPDATE contacts SET has_piano=0,updated_at=CURRENT_TIMESTAMP WHERE has_piano<>0").run();

    return {deletedPianos,deletedImportBatches};
  });

  try{
    const result=reset();
    req.skipAutoAudit=true;
    res.json({ok:true,module:'pianos',...result});
  }catch(err){
    console.error('piano module reset failed:',err);
    res.status(500).json({error:'PIANO_MODULE_RESET_FAILED'});
  }
});

app.delete("/api/pianos/:id", auth, requireSuperadmin, (req,res)=>{
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(req.params.id);
  if(!piano)return res.status(404).json({error:"PIANO_NOT_FOUND"});
  const hasColumn=(table,column)=>{try{return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column);}catch(_error){return false;}};
  const remove=db.transaction(()=>{
    for(const [table,column,emptyValue] of [["jobs","piano_id",null],["planned_jobs","piano_id",""] ,["journal_entries","piano_id",null],["financial_items","piano_id",null],["inventory_items","linked_piano_id",""]]){
      if(hasColumn(table,column))db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(emptyValue,req.params.id);
    }
    db.prepare("DELETE FROM pianos WHERE id=?").run(req.params.id);
    refreshClientHasPiano(piano.owner_contact_id);
    try{audit(req,"PIANO_HARD_DELETE","pianos",req.params.id,piano,null,1,"Superadmin confirmed permanent piano deletion","TECHNICAL");}catch(_error){}
  });
  try{remove();res.json({ok:true,deleted_id:req.params.id});}
  catch(error){console.error("piano delete failed:",error);res.status(500).json({error:"PIANO_DELETE_FAILED"});}
});

app.get("/api/company-documents", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const search=String(req.query.search||"").trim().toLowerCase();
  const category=String(req.query.category||"").trim();
  const where=["content_type='Company Document'"];const params=[];
  if(category){where.push("category=?");params.push(category);}
  if(search){where.push("(lower(title) LIKE ? OR lower(COALESCE(owner,'')) LIKE ? OR lower(COALESCE(original_filename,'')) LIKE ?)");const q=`%${search}%`;params.push(q,q,q);}
  const rows=db.prepare(`SELECT id,title,category,effective_date,original_filename,mime_type,stored_path,owner,created_at,updated_at FROM knowledge_base WHERE ${where.join(" AND ")} ORDER BY COALESCE(effective_date,created_at) DESC,created_at DESC,id DESC`).all(...params);
  res.json(rows);
});
app.post("/api/company-documents", auth, permit("ADMIN","MANAGER","WORKER"), companyDocumentUpload.single("file"), (req,res)=>{
  const removeFile=()=>{try{if(req.file?.path&&fs.existsSync(req.file.path))fs.unlinkSync(req.file.path);}catch(_error){}};
  const title=String(req.body?.title||"").trim();const effectiveDate=String(req.body?.effective_date||"").trim();const category=String(req.body?.category||"").trim();
  const allowedCategories=new Set(["Contract","Permit","Technical Documentation","Other Company Document"]);
  if(!title){removeFile();return res.status(400).json({error:"DOCUMENT_TITLE_REQUIRED"});}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)){removeFile();return res.status(400).json({error:"DOCUMENT_EFFECTIVE_DATE_REQUIRED"});}
  if(!allowedCategories.has(category)){removeFile();return res.status(400).json({error:"INVALID_DOCUMENT_CATEGORY"});}
  if(!req.file){return res.status(400).json({error:"DOCUMENT_FILE_REQUIRED"});}
  const id=rid("DOC");const storedPath=`/uploads/company-documents/${path.basename(req.file.path)}`;
  db.prepare(`INSERT INTO knowledge_base(id,title,category,content_type,body,stored_path,owner,effective_date,original_filename,mime_type) VALUES(?,?,?,'Company Document','',?,?,?,?,?)`).run(id,title,category,storedPath,req.user.name||req.user.email||req.user.id,effectiveDate,req.file.originalname||"",req.file.mimetype||"");
  const row=db.prepare("SELECT id,title,category,effective_date,original_filename,mime_type,stored_path,owner,created_at,updated_at FROM knowledge_base WHERE id=?").get(id);
  audit(req,"CREATE","knowledge_base",id,null,row,1,"Company document uploaded","TECHNICAL");res.status(201).json(row);
});

createResourceRoutes("knowledge_base","knowledge_base","KB",["job_id","title","category","content_type","body","stored_path","owner","amount","payment_method","invoice_number","priority"],["ADMIN","MANAGER","WORKER"]);

app.get("/api/client-profile/:id", auth, (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  const pianos=db.prepare(`SELECT DISTINCT p.*,cp.id AS client_piano_id,COALESCE(cp.is_verified,0) AS is_verified,cp.piano_location_address,cp.location_name,cp.verified_at,cp.verified_by
    FROM pianos p JOIN client_pianos cp ON cp.piano_id=p.id WHERE cp.client_id=? ORDER BY p.created_at DESC`).all(req.params.id);
  const jobs=db.prepare(jobsSelectSql("WHERE j.client_id=? OR j.client_name=? ORDER BY j.start_time DESC LIMIT 50")).all(req.params.id, client.name);
  const crmFollowUpJob=jobs.find((row)=>Number(row.is_crm_follow_up||0)===1&&!['Completed','Partially completed','Failed','Cancelled'].includes(String(row.status||'')))||null;
  res.json({client,pianos,jobs,crmFollowUpJob,lastVisit:jobs.find((row)=>Number(row.is_crm_follow_up||0)!==1)?.start_time || client.last_contact || "",lastJob:jobs.find((row)=>Number(row.is_crm_follow_up||0)!==1)?.title || ""});
});

app.get("/api/jobs", auth, (req,res)=>{
  const from=String(req.query.from||'').trim(),to=String(req.query.to||'').trim();
  if(Boolean(from)!==Boolean(to)) return res.status(400).json({error:'JOB_RANGE_REQUIRES_FROM_AND_TO'});
  if(from&&to){
    if(!isValidTimeRange(from,to)) return res.status(400).json({error:'INVALID_TIME_RANGE'});
    return res.json(db.prepare(jobsSelectSql("WHERE j.start_time<? AND j.end_time>? ORDER BY j.start_time")).all(to,from));
  }
  res.json(db.prepare(jobsSelectSql("ORDER BY j.start_time")).all());
});
app.get("/api/jobs/:id",auth,(req,res)=>{
  const job=getJobByAnyId(req.params.id,req.query||{});
  if(!job) return res.status(404).json({error:'JOB_NOT_FOUND'});
  const detailed=db.prepare(jobsSelectSql("WHERE j.id=?")).get(job.id);
  detailed.calendar_import=googleCalendarImportDetails(detailed);
  res.json(detailed);
});
app.post("/api/jobs", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  for(const r of ["title","start_time","end_time"]) if(!req.body[r]) return res.status(400).json({error:`${r} is required`});
  const assigned=resolveActiveUser(req.body.assigned_user_id,req.body.assigned_to);
  if(!assigned) return res.status(400).json({error:"A valid responsible user is required / Érvényes felelős munkatárs szükséges"});
  const relationships=normalizeJobRelationships(req.body);
  if(relationships.error) return res.status(400).json({error:relationships.error});
  if(relationships.client){req.body.client_id=relationships.client.id;req.body.client_name=relationships.client.name;if(req.body.client_phone===undefined)req.body.client_phone=relationships.client.phone||"";if(req.body.service_address===undefined)req.body.service_address=relationships.client.address||"";}else{req.body.client_id=null;req.body.client_name=String(req.body.client_name||"").trim();}
  if(relationships.piano){req.body.piano_id=relationships.piano.id;req.body.piano_name=req.body.piano_name||relationships.piano.display_name||`${relationships.piano.brand||""} ${relationships.piano.model||""}`.trim();}else if(relationships.adHocClient){req.body.piano_id=null;}
  if(!isValidTimeRange(req.body.start_time,req.body.end_time)) return res.status(400).json({error:"INVALID_TIME_RANGE"});
  if(!isFiveMinuteTime(req.body.start_time)||!isFiveMinuteTime(req.body.end_time)) return res.status(400).json({error:"INVALID_TIME_STEP"});
  const conflicts=findScheduleConflicts(assigned.id,assigned.name,req.body.start_time,req.body.end_time);
  if(conflicts.length) return rejectScheduleConflict(req,res,assigned,conflicts);
  const id=req.body.id || rid("J");
  const dailyRateEnabled=Boolean(req.body.daily_rate_enabled===true||req.body.daily_rate_enabled===1||String(req.body.daily_rate_enabled||'')==='1'||String(req.body.daily_rate_enabled||'').toLowerCase()==='true');
  const dailyRateDate=String(req.body.start_time).slice(0,10);
  let dailyRateDecision;
  try{dailyRateDecision=jobDomain.validateDailyRateAllocation({userId:assigned.id,dateStr:dailyRateDate,jobId:id,enabled:dailyRateEnabled});}
  catch(error){return res.status(error.status||400).json({error:error.code||error.message,...(error.details||{})});}
  const extraCompensation=Math.round(Number(req.body.technician_extra_compensation||0)*100)/100;
  if(!Number.isFinite(extraCompensation)||extraCompensation<0)return res.status(400).json({error:"INVALID_TECHNICIAN_EXTRA_COMPENSATION"});
  const data={...req.body,assigned_user_id:assigned.id,assigned_to:assigned.name,created_by_user_id:req.user.id,created_by:req.user.name};
  data.planned_minutes=timeRangeMinutes(data.start_time,data.end_time);data.planned_hours=data.planned_minutes/60;
  data.workflow_root_id=data.workflow_root_id||id;
  data.workflow_step_no=Number(data.workflow_step_no||1);
  data.workflow_status=data.workflow_status||"ACTIVE";
  data.daily_rate_enabled=dailyRateEnabled?1:0;
  data.daily_rate_allocated_amount=dailyRateEnabled?Number(dailyRateDecision?.suggested_allocation||0):0;
  data.daily_rate_date=dailyRateEnabled?dailyRateDate:null;
  data.technician_extra_compensation=extraCompensation;
  const cols=["id","job_key","parent_job_id","workflow_root_id","workflow_step_no","workflow_status","title","job_type","client_id","client_name","client_phone","piano_id","piano_name","assigned_user_id","assigned_to","created_by_user_id","created_by","priority","status","start_time","end_time","timezone","planned_amount","pricing_basis","planned_hours","planned_minutes","travel_minutes","service_address","instructions","notes","workflow_id","workshop_workflow_id","planned_job_id","daily_rate_enabled","daily_rate_allocated_amount","daily_rate_date","technician_extra_compensation"]
    .filter(c=>c==="id" || c==="job_key" || data[c]!==undefined);
  const created=db.transaction(()=>{
    db.prepare(`INSERT INTO jobs(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...cols.map(c=>c==="id"?id:(c==="job_key"?(data.job_key||stableJobKey()):data[c])));
    if(data.client_id)syncClientContactFromJob(data.client_id,data);
    if(dailyRateEnabled)jobDomain.rebalanceDailyRateAllocations({userId:assigned.id,dateStr:dailyRateDate});
    return db.prepare(jobsSelectSql("WHERE j.id=?")).get(id);
  })();
  workAudit(req,'CREATE',id,null,created,1,`retroactive=${new Date(created.start_time).getTime()<Date.now()}`);
  notifyAssigned(created,req.user,'JOB_ASSIGNED');
  res.json(created);
});
app.put("/api/jobs/:id", auth, (req,res)=>{
  const jobId = req.params.id || req.body.id || req.body.job_id || req.body.job_key;
  const job=getJobByAnyId(jobId, req.body);
  if(!job) return res.status(404).json({error:`Job not found. id/job_key: ${String(jobId||"").trim()}`});
  if(!canEditJob(req.user,job)) return res.status(403).json({error:"JOB_EDIT_FORBIDDEN"});

  const privilegedEditor=isSuperadminUser(req.user)||req.user.role==="ADMIN"||req.user.role==="MANAGER";
  const privilegedAllowed=[
    "title","job_type","client_id","client_name","client_phone",
    "piano_id","piano_name","assigned_user_id","assigned_to","priority","status",
    "start_time","end_time","planned_amount","pricing_basis",
    "planned_hours","planned_minutes","travel_minutes","service_address","instructions","notes","workflow_id","workshop_workflow_id",
    "daily_rate_enabled","daily_rate_allocated_amount","daily_rate_date","technician_extra_compensation"
  ];
  const workerRequestAllowed=new Set(["title","priority","start_time","end_time","travel_minutes","service_address","instructions","notes"]);
  if(!privilegedEditor){
    const forbidden=Object.keys(req.body||{}).filter((key)=>privilegedAllowed.includes(key)&&!workerRequestAllowed.has(key));
    if(forbidden.length) return res.status(403).json({error:"JOB_FIELD_EDIT_FORBIDDEN",fields:forbidden});
  }
  // planned_hours/planned_minutes are server-derived from permitted start/end edits.
  const allowed=privilegedEditor?privilegedAllowed:[...workerRequestAllowed,"planned_hours","planned_minutes"];

  if(req.body.job_type==="Part-work" && (!req.body.instructions || !String(req.body.instructions).trim())){
    return res.status(400).json({error:"Remaining tasks are required for part-work / Részmunka esetén a hátralévő feladatok megadása kötelező"});
  }

  if(req.body.client_id!==undefined||req.body.client_name!==undefined||req.body.piano_id!==undefined||req.body.piano_name!==undefined){
    const relationships=normalizeJobRelationships(req.body,job);
    if(relationships.error) return res.status(400).json({error:relationships.error});
    if(relationships.client){req.body.client_id=relationships.client.id;req.body.client_name=relationships.client.name;if(req.body.client_phone===undefined)req.body.client_phone=relationships.client.phone||job.client_phone||"";if(req.body.service_address===undefined)req.body.service_address=relationships.client.address||job.service_address||"";}else{req.body.client_id=null;req.body.client_name=String(req.body.client_name||job.client_name||"").trim();}
    if(relationships.piano){req.body.piano_id=relationships.piano.id;req.body.piano_name=req.body.piano_name||relationships.piano.display_name||`${relationships.piano.brand||""} ${relationships.piano.model||""}`.trim();}else if(relationships.adHocClient){req.body.piano_id=null;}
  }
  let effectiveAssigned={id:job.assigned_user_id||null,name:job.assigned_to||""};
  if(req.body.assigned_user_id!==undefined || req.body.assigned_to!==undefined){
    const assigned=resolveActiveUser(req.body.assigned_user_id,req.body.assigned_to);
    if(!assigned) return res.status(400).json({error:"A valid responsible user is required / Érvényes felelős munkatárs szükséges"});
    req.body.assigned_user_id=assigned.id; req.body.assigned_to=assigned.name;
    effectiveAssigned=assigned;
  }
  const effectiveStart=req.body.start_time!==undefined?req.body.start_time:job.start_time;
  const effectiveEnd=req.body.end_time!==undefined?req.body.end_time:job.end_time;
  if(!isValidTimeRange(effectiveStart,effectiveEnd)) return res.status(400).json({error:"INVALID_TIME_RANGE"});
  const timeChanged=(req.body.start_time!==undefined&&String(req.body.start_time)!==String(job.start_time||""))||(req.body.end_time!==undefined&&String(req.body.end_time)!==String(job.end_time||""));
  if(timeChanged&&(!isFiveMinuteTime(effectiveStart)||!isFiveMinuteTime(effectiveEnd))) return res.status(400).json({error:"INVALID_TIME_STEP"});
  if(timeChanged||req.body.planned_minutes!==undefined||req.body.planned_hours!==undefined){
    req.body.planned_minutes=timeRangeMinutes(effectiveStart,effectiveEnd);
    req.body.planned_hours=req.body.planned_minutes/60;
  }
  const effectiveDailyEnabled=req.body.daily_rate_enabled!==undefined?Boolean(req.body.daily_rate_enabled===true||req.body.daily_rate_enabled===1||String(req.body.daily_rate_enabled||'')==='1'||String(req.body.daily_rate_enabled||'').toLowerCase()==='true'):Number(job.daily_rate_enabled||0)===1;
  const effectiveDailyDate=String(effectiveStart||'').slice(0,10);
  let dailyRateDecision;
  try{dailyRateDecision=jobDomain.validateDailyRateAllocation({userId:effectiveAssigned.id,dateStr:effectiveDailyDate,jobId:job.id,enabled:effectiveDailyEnabled});}
  catch(error){return res.status(error.status||400).json({error:error.code||error.message,...(error.details||{})});}
  if(req.body.daily_rate_enabled!==undefined) req.body.daily_rate_enabled=effectiveDailyEnabled?1:0;
  if(effectiveDailyEnabled){req.body.daily_rate_allocated_amount=Number(dailyRateDecision?.suggested_allocation||0);req.body.daily_rate_date=effectiveDailyDate;}
  else if(req.body.daily_rate_enabled!==undefined){req.body.daily_rate_allocated_amount=0;req.body.daily_rate_date=null;}
  else if(timeChanged && Number(job.daily_rate_enabled||0)===1){req.body.daily_rate_date=effectiveDailyDate;}
  if(["Cancelled","Failed"].includes(String(req.body.status||""))){req.body.daily_rate_allocated_amount=0;}
  if(req.body.technician_extra_compensation!==undefined){const extra=Math.round(Number(req.body.technician_extra_compensation||0)*100)/100;if(!Number.isFinite(extra)||extra<0)return res.status(400).json({error:"INVALID_TECHNICIAN_EXTRA_COMPENSATION"});req.body.technician_extra_compensation=extra;}
  const schedulingChanged=req.body.start_time!==undefined || req.body.end_time!==undefined || req.body.assigned_user_id!==undefined || req.body.assigned_to!==undefined;
  if(schedulingChanged){
    const conflicts=findScheduleConflicts(effectiveAssigned.id,effectiveAssigned.name,effectiveStart,effectiveEnd,job.id);
    if(conflicts.length) return rejectScheduleConflict(req,res,effectiveAssigned,conflicts);
  }
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(cols.length){
    const setParts=cols.map(c=>`${c}=?`);
    const vals=cols.map(c=>req.body[c]);

    if(req.body.assigned_user_id!==undefined && String(req.body.assigned_user_id)!==String(job.assigned_user_id||"")){
      setParts.push("last_reassigned_by=?");
      setParts.push("last_reassigned_by_user_id=?");
      setParts.push("reassignment_note=?");
      vals.push(req.user.name, req.user.id, req.body.reassignment_note || "Changed in edit / Szerkesztésben módosítva");
    }

    setParts.push("updated_at=CURRENT_TIMESTAMP");
    vals.push(job.id);
    db.prepare(`UPDATE jobs SET ${setParts.join(",")} WHERE id=?`).run(...vals);
  }

  let updated=db.prepare(jobsSelectSql("WHERE j.id=?")).get(job.id);
  if(updated.client_id)syncClientContactFromJob(updated.client_id,req.body);
  const oldDailyDate=String(job.daily_rate_date||job.start_time||'').slice(0,10);
  const newDailyDate=String(updated.daily_rate_date||updated.start_time||'').slice(0,10);
  if(Number(job.daily_rate_enabled||0)===1&&job.assigned_user_id&&oldDailyDate)jobDomain.rebalanceDailyRateAllocations({userId:job.assigned_user_id,dateStr:oldDailyDate});
  if(Number(updated.daily_rate_enabled||0)===1&&updated.assigned_user_id&&newDailyDate)jobDomain.rebalanceDailyRateAllocations({userId:updated.assigned_user_id,dateStr:newDailyDate});
  updated=db.prepare(jobsSelectSql("WHERE j.id=?")).get(job.id);
  workAudit(req,'UPDATE',job.id,job,updated,1,`retroactive=${new Date(updated.start_time).getTime()<Date.now()}; closed_before=${['Completed','Partially completed','Failed'].includes(String(job.status||''))}`);
  const assigneeChanged=String(job.assigned_user_id||'')!==String(updated.assigned_user_id||'');
  if(assigneeChanged) notifyAssigned(updated,req.user,'JOB_TRANSFERRED');
  else {
    const changes=[];
    if(job.start_time!==updated.start_time||job.end_time!==updated.end_time)changes.push('time');
    if(job.client_id!==updated.client_id||job.client_name!==updated.client_name)changes.push('client');
    if(job.service_address!==updated.service_address)changes.push('location');
    if(job.priority!==updated.priority)changes.push('priority');
    if(job.title!==updated.title||job.instructions!==updated.instructions||job.notes!==updated.notes)changes.push('details');
    if(changes.length && updated.assigned_user_id && String(updated.assigned_user_id)!==String(req.user.id)) createNotification({recipientUserId:updated.assigned_user_id,senderUserId:req.user.id,type:'JOB_UPDATED',job:updated,eventKey:`JOB_UPDATED:${updated.id}:${updated.updated_at}:${changes.join('-')}`,titleEn:'Your assigned job was updated',titleHu:'Módosították a hozzád rendelt munkát',bodyEn:`${jobDescription(updated)} · Changed: ${changes.join(', ')}`,bodyHu:`${jobDescription(updated)} · Módosult: ${changes.join(', ')}`,metadata:{changes}});
  }
  res.json(updated);
});

app.patch("/api/jobs/:id/schedule", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const job=getJobByAnyId(req.params.id,req.body||{});
  if(!job) return res.status(404).json({error:"JOB_NOT_FOUND"});
  if(!canEditJob(req.user,job)) return res.status(403).json({error:"JOB_EDIT_FORBIDDEN"});
  const assigned=resolveActiveUser(req.body.assigned_user_id!==undefined?req.body.assigned_user_id:job.assigned_user_id,req.body.assigned_to!==undefined?req.body.assigned_to:job.assigned_to);
  try{
    const result=jobDomain.patchJobSchedule({
      jobId:job.id,
      startTime:req.body.start_time!==undefined?String(req.body.start_time):String(job.start_time||""),
      endTime:req.body.end_time!==undefined?String(req.body.end_time):String(job.end_time||""),
      assignedUser:assigned,
      actor:req.user,
      reassignmentNote:req.body.reassignment_note||"Calendar drag/drop",
      findConflicts:findScheduleConflicts
    });
    const updated=db.prepare(jobsSelectSql("WHERE j.id=?")).get(job.id);
    workAudit(req,'SCHEDULE_UPDATE',job.id,job,updated,1,`interval=${SCHEDULE_INTERVAL_MINUTES}; source=${req.body.source||'calendar'}`);
    if(result.assigneeChanged) notifyAssigned(updated,req.user,'JOB_TRANSFERRED');
    res.json(updated);
  }catch(error){
    if(error.code==='SCHEDULE_CONFLICT') return rejectScheduleConflict(req,res,assigned,error.details?.conflicts||[]);
    res.status(error.status||400).json({error:error.code||error.message,interval_minutes:error.details?.interval_minutes,...(error.details||{})});
  }
});

app.put("/api/jobs/:id/reassign", auth, (req,res)=>{
  const jobId = req.params.id || req.body.id || req.body.job_id;
  const job=getJobByAnyId(jobId, req.body);
  if(!job) return res.status(404).json({error:`Job not found: ${String(jobId||"").trim()}`});

  const assigned=resolveActiveUser(req.body.assigned_user_id,req.body.assigned_to);
  if(!assigned) return res.status(400).json({error:"A valid responsible user is required / Érvényes felelős munkatárs szükséges"});

  const isTakingBackToSelf = String(assigned.id)===String(req.user.id);
  if(!canReassignJob(req.user, job) && !isTakingBackToSelf) {
    return res.status(403).json({error:"You cannot reassign this job"});
  }

  if(!isValidTimeRange(job.start_time,job.end_time)) return res.status(400).json({error:"INVALID_TIME_RANGE"});
  const conflicts=findScheduleConflicts(assigned.id,assigned.name,job.start_time,job.end_time,job.id);
  if(conflicts.length) return rejectScheduleConflict(req,res,assigned,conflicts);
  const dailyDate=String(job.daily_rate_date||job.start_time||'').slice(0,10);
  db.prepare(`UPDATE jobs SET assigned_user_id=?, assigned_to=?, last_reassigned_by_user_id=?, last_reassigned_by=?, reassignment_note=?,
    daily_rate_allocated_amount=CASE WHEN COALESCE(daily_rate_enabled,0)=1 THEN 0 ELSE daily_rate_allocated_amount END,
    daily_rate_date=CASE WHEN COALESCE(daily_rate_enabled,0)=1 THEN ? ELSE daily_rate_date END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(assigned.id,assigned.name,req.user.id,req.user.name,req.body.reassignment_note||"",dailyDate,job.id);
  if(Number(job.daily_rate_enabled||0)===1&&dailyDate){
    if(job.assigned_user_id)jobDomain.rebalanceDailyRateAllocations({userId:job.assigned_user_id,dateStr:dailyDate});
    jobDomain.rebalanceDailyRateAllocations({userId:assigned.id,dateStr:dailyDate});
  }

  const updated=db.prepare(jobsSelectSql("WHERE j.id=?")).get(job.id);
  workAudit(req,'REASSIGN',job.id,job,updated,1,`from=${job.assigned_to||''}; to=${updated.assigned_to||''}`);
  notifyAssigned(updated,req.user,'JOB_TRANSFERRED');
  res.json(updated);
});

app.post("/api/jobs/:id/calendar-review",auth,permit("ADMIN"),(req,res)=>{
  try{
    const job=getJobByAnyId(req.params.id,req.body||{});
    if(!job) return res.status(404).json({error:'JOB_NOT_FOUND'});
    const reviewed=googleCalendar.markReviewed(job.id,req.user.id);
    workAudit(req,'CALENDAR_REVIEW',job.id,job,reviewed,1,'Google Calendar import reviewed / Google Naptár-import ellenőrizve');
    res.json(reviewed);
  }catch(error){res.status(400).json({error:error.message});}
});

app.delete("/api/jobs/:id", auth, requireSuperadmin, (req,res)=>{
  const job=getJobByAnyId(req.params.id, req.body||{});
  if(!job) return res.status(404).json({error:"Job not found"});
  const logs=db.prepare("SELECT id FROM job_logs WHERE job_id=?").all(job.id);
  const childJobs=db.prepare("SELECT id,assigned_user_id,daily_rate_enabled,daily_rate_date,start_time FROM jobs WHERE parent_job_id=?").all(job.id);
  const dailyRateBuckets=[job,...childJobs]
    .filter(row=>Number(row.daily_rate_enabled||0)===1&&row.assigned_user_id)
    .map(row=>({userId:row.assigned_user_id,dateStr:String(row.daily_rate_date||row.start_time||'').slice(0,10)}))
    .filter(bucket=>bucket.dateStr);
  db.transaction(()=>{
    db.prepare("DELETE FROM financial_items WHERE (job_id=? AND source_type IN ('JOB_REVENUE','DAILY_RATE','TECHNICIAN_EXTRA_COMPENSATION','closed_job','job_close_revenue')) OR (source_type='closed_job' AND source_id=?) OR (source_type IN ('job_close_revenue','JOB_REVENUE') AND source_id IN (?,?))").run(job.id, job.id, `JOB_CLOSE:${job.id}`, `JOB_REVENUE:${job.id}`);
    db.prepare("DELETE FROM knowledge_base WHERE job_id=?").run(job.id);
    db.prepare("DELETE FROM job_logs WHERE job_id=?").run(job.id);
    db.prepare("DELETE FROM jobs WHERE parent_job_id=?").run(job.id);
    db.prepare("DELETE FROM jobs WHERE id=?").run(job.id);
    const seenDailyBuckets=new Set();
    for(const bucket of dailyRateBuckets){const key=`${bucket.userId}|${bucket.dateStr}`;if(seenDailyBuckets.has(key))continue;seenDailyBuckets.add(key);jobDomain.rebalanceDailyRateAllocations(bucket);}
  })();
  googleCalendar.ignoreDeletedJob(job.id);
  childJobs.forEach(child=>googleCalendar.ignoreDeletedJob(child.id));
  if(job.assigned_user_id && String(job.assigned_user_id)!==String(req.user.id)) createNotification({recipientUserId:job.assigned_user_id,senderUserId:req.user.id,type:'JOB_DELETED',titleEn:'An assigned job was deleted',titleHu:'Töröltek egy hozzád rendelt munkát',bodyEn:jobDescription(job),bodyHu:jobDescription(job),metadata:{deleted_job_id:job.id}});
  res.json({ok:true,deleted_job_id:job.id,deleted_logs:logs.length});
});

app.get("/api/jobs/:id/workflow", auth, (req,res)=>{
  const job=getJobByAnyId(req.params.id,req.query||{});
  if(!job) return res.status(404).json({error:"Job not found"});
  const rootId=job.workflow_root_id||job.id;
  const steps=db.prepare(jobsSelectSql("WHERE j.id=? OR j.workflow_root_id=? ORDER BY COALESCE(j.workflow_step_no,1), j.start_time, j.created_at")).all(rootId,rootId);
  res.json({workflow_root_id:rootId,steps});
});

app.post("/api/jobs/:id/close", auth, (req,res)=>{
  const jobId=req.params.id || req.body.id || req.body.job_id || req.body.job_key;
  const job=getJobByAnyId(jobId,req.body);
  if(!job){return res.status(404).json({error:`Job not found. id/job_key: ${String(jobId||"").trim()}`});}
  if(!canCloseJob(req.user,job)){return res.status(403).json({error:`You cannot close this job because it is currently assigned to ${job.assigned_to}. / Nem zárhatod le ezt a munkát, mert jelenleg ${job.assigned_to} a felelős.`});}
  if(String(job.status||'')==='Completed' && String(job.financial_status||'')==='POSTED'){
    
    return res.json({ok:true,idempotent:true,job});
  }

  const rootId=job.workflow_root_id||job.id;
  const rootJob=db.prepare("SELECT status,workflow_status,finalized_at FROM jobs WHERE id=?").get(rootId);
  const existingCloseLog=db.prepare("SELECT id FROM job_logs WHERE job_id=? AND log_type IN ('Partial','Full','Failed') LIMIT 1").get(job.id);
  if(existingCloseLog || job.finalized_at || ['Partially completed','Failed'].includes(String(job.status||''))){
    
    return res.status(409).json({error:"JOB_ALREADY_CLOSED"});
  }
  if(rootJob && rootId!==job.id && (rootJob.finalized_at || String(rootJob.workflow_status||'')==='COMPLETED')){
    
    return res.status(409).json({error:"WORKFLOW_ALREADY_FINALIZED"});
  }

  const closeType=String(req.body.close_type||"");
  if(!["Partial","Full","Failed"].includes(closeType)){return res.status(400).json({error:"Close type must be Partial, Full or Failed"});}
  const billed=Number(req.body.billed_amount);
  if(Number.isNaN(billed)){return res.status(400).json({error:"Billed amount is required. Use 0 if not billable."});}
  const desc=String(req.body.close_description||"").trim();
  if(!desc){return res.status(400).json({error:"Close description is required"});}
  const payment=billed>0?normalizePaymentMethod(req.body.payment_method,{allowEmpty:false}):null;
  if(billed>0&&!payment){return res.status(400).json({error:"A valid payment method is required when billed amount is greater than zero / Érvényes fizetési mód kötelező, ha az összeg nagyobb mint 0"});}
  const storedPath=null;
  let partialNextAssigned=null;
  if(closeType==="Partial"){
    const required=["next_title","next_assigned_user_id","next_start_time","next_end_time"];
    for(const field of required){
      if(!req.body[field]){return res.status(400).json({error:"PARTIAL_CLOSE_NEXT_JOB_REQUIRED",field});}
    }
    partialNextAssigned=resolveActiveUser(req.body.next_assigned_user_id,req.body.next_assigned_to);
    if(!partialNextAssigned){return res.status(400).json({error:"A valid next responsible user is required / Érvényes következő felelős szükséges"});}
    if(!isValidTimeRange(req.body.next_start_time,req.body.next_end_time)){return res.status(400).json({error:"INVALID_TIME_RANGE"});}
    if(!isScheduleTime(req.body.next_start_time)||!isScheduleTime(req.body.next_end_time)){return res.status(400).json({error:"INVALID_TIME_STEP",interval_minutes:SCHEDULE_INTERVAL_MINUTES});}
    const conflicts=findScheduleConflicts(partialNextAssigned.id,partialNextAssigned.name,req.body.next_start_time,req.body.next_end_time);
    if(conflicts.length){return rejectScheduleConflict(req,res,partialNextAssigned,conflicts);}
  }

  try{
    const result=jobDomain.closeoutJobOrchestration({
      jobId:job.id,
      source:'DIRECT',
      actor:req.user,
      closeType,
      complete:closeType==='Full',
      mutate:({job:domainJob,now})=>{
        const freshLog=db.prepare("SELECT id FROM job_logs WHERE job_id=? AND log_type IN ('Partial','Full','Failed') LIMIT 1").get(domainJob.id);
        if(freshLog) throw new Error("JOB_ALREADY_CLOSED");
        let nextJobId=null;
        if(closeType==="Partial"){
          const maxStep=db.prepare("SELECT COALESCE(MAX(workflow_step_no),0) AS n FROM jobs WHERE workflow_root_id=? OR id=?").get(rootId,rootId)?.n||0;
          nextJobId=rid("J");
          db.prepare(`INSERT INTO jobs(
            id,job_key,parent_job_id,workflow_root_id,workflow_step_no,workflow_status,title,job_type,client_id,client_name,client_phone,piano_id,piano_name,
            assigned_user_id,assigned_to,created_by_user_id,created_by,priority,status,start_time,end_time,timezone,planned_amount,pricing_basis,
            planned_hours,planned_minutes,travel_minutes,service_address,instructions,notes
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            nextJobId,stableJobKey(),domainJob.id,rootId,Number(maxStep)+1,"ACTIVE",req.body.next_title,"Part-work",domainJob.client_id,domainJob.client_name,domainJob.client_phone,domainJob.piano_id,domainJob.piano_name,
            partialNextAssigned.id,partialNextAssigned.name,req.user.id,req.user.name,req.body.next_priority||domainJob.priority,"Open",req.body.next_start_time,req.body.next_end_time,"America/New_York",
            Number(req.body.next_planned_amount||0),req.body.next_pricing_basis||"",timeRangeMinutes(req.body.next_start_time,req.body.next_end_time)/60,timeRangeMinutes(req.body.next_start_time,req.body.next_end_time),Number(req.body.next_travel_minutes||0),
            req.body.next_service_address||domainJob.service_address,req.body.next_instructions||"",req.body.next_notes||domainJob.notes||""
          );
          db.prepare(`UPDATE jobs SET status='Partially completed',close_type='Partial',workflow_root_id=?,workflow_status='IN_PROGRESS',billed_amount=?,payment_method=?,invoice_status=?,invoice_number=?,close_notes=?,completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(rootId,billed,payment,billed>0?(req.body.invoice_status||"Invoiced"):"Not billable",req.body.invoice_number||"",desc,now,domainJob.id);
        }else if(closeType==="Full"){
          db.prepare(`UPDATE jobs SET status='Completed',workflow_root_id=?,workflow_status='COMPLETED',finalized_at=?,completed_at=COALESCE(completed_at,?),billed_amount=?,payment_method=?,invoice_status=?,invoice_number=?,close_type='Full',close_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(rootId,now,now,billed,payment,billed>0?(req.body.invoice_status||"Invoiced"):"Not billable",req.body.invoice_number||"",desc,domainJob.id);
          db.prepare(`UPDATE jobs SET status='Completed',workflow_status='COMPLETED',finalized_at=COALESCE(finalized_at,?),completed_at=COALESCE(completed_at,?),updated_at=CURRENT_TIMESTAMP WHERE workflow_root_id=? AND id<>?`)
            .run(now,now,rootId,domainJob.id);
        }else{
          db.prepare(`UPDATE jobs SET status='Failed',close_type='Failed',workflow_root_id=?,workflow_status='FAILED',billed_amount=?,payment_method=?,invoice_status=?,invoice_number=?,close_notes=?,completed_at=?,closed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(rootId,billed,payment,billed>0?(req.body.invoice_status||"Invoiced"):"Not billable",req.body.invoice_number||"",desc,now,now,domainJob.id);
        }
        const logId=rid("LOG");
        db.prepare(`INSERT INTO job_logs(id,job_id,log_type,description,billed_amount,payment_method,invoice_number,document_path,next_job_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .run(logId,domainJob.id,closeType,desc,billed,payment,req.body.invoice_number||"",storedPath,nextJobId,req.user.name);
        db.prepare(`INSERT INTO knowledge_base(id,job_id,title,category,content_type,body,stored_path,owner,amount,payment_method,invoice_number,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(rid("KB"),domainJob.id,`${closeType} close / ${closeType==="Full"?"Teljes lezárás":(closeType==="Failed"?"Sikertelen lezárás":"Részlezárás")}: ${domainJob.title}`,closeType==="Full"?"Closed Job":(closeType==="Failed"?"Failed Job":"Partial Close"),"Job Record",desc,storedPath,req.user.name,billed,payment,req.body.invoice_number||"",domainJob.priority);
        return {nextJobId,logId};
      },
      financialEntries:({job:domainJob,mutation,now})=>billed>0?[{
        itemDate:String(now).slice(0,10),
        title:`Closed job revenue / Lezárt munka bevétele: ${domainJob.title||domainJob.job_key||domainJob.id}`,
        description:[domainJob.client_name?`Client / Ügyfél: ${domainJob.client_name}`:"",domainJob.piano_name?`Piano / Zongora: ${domainJob.piano_name}`:"",mutation?.logId?`Job log / Lezárási napló: ${mutation.logId}`:""].filter(Boolean).join("\n"),
        amount:billed,mainType:"INCOME",category:"SERVICE_REVENUE",paymentMethod:payment,
        sourceType:"JOB_REVENUE",sourceId:`JOB_REVENUE:${domainJob.id}`
      }]:[]
    });
    const updated=db.prepare(jobsSelectSql("WHERE j.id=?")).get(job.id);
    workAudit(req,closeType==='Partial'?'PARTIAL_CLOSE':(closeType==='Full'?'FULL_CLOSE':'FAILED_CLOSE'),job.id,job,updated,1,`workflow_root_id=${rootId}; next_job_id=${result.mutation?.nextJobId||''}`);
    res.json({ok:true,idempotent:result.idempotent,next_job_id:result.mutation?.nextJobId||null,storedPath,financial_item_id:result.financialItems?.[0]?.id||updated.financial_ledger_id||null,workflow_root_id:rootId});
  }catch(err){
    
    const code=err.code||err.message||"Close operation failed";
    res.status(['JOB_ALREADY_CLOSED','WORKFLOW_ALREADY_FINALIZED'].includes(code)?409:(err.status||400)).json({error:code});
  }
});

app.get("/api/piano-brands", auth, (_req,res)=>{
  try{
    db.prepare("INSERT OR IGNORE INTO piano_brands(brand_name) SELECT DISTINCT trim(brand) FROM pianos WHERE brand IS NOT NULL AND trim(brand)<>''").run();
    res.json(db.prepare("SELECT brand_name FROM piano_brands WHERE active=1 ORDER BY lower(brand_name),brand_name").all().map(row=>row.brand_name));
  }catch(error){res.status(500).json({error:error.message});}
});
app.post("/api/piano-brands", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  try{
    const brandName=ensurePianoBrand(req.body?.brand_name||req.body?.brand||req.body?.make);
    if(!brandName)return res.status(400).json({error:"PIANO_BRAND_REQUIRED"});
    const row=db.prepare("SELECT brand_name,active,created_at FROM piano_brands WHERE lower(brand_name)=lower(?) LIMIT 1").get(brandName);
    res.status(201).json(row||{brand_name:brandName,active:1});
  }catch(error){res.status(400).json({error:error.message||"PIANO_BRAND_CREATE_FAILED"});}
});
app.get("/api/piano-models", auth, (req,res)=>{
  try{
    const brand=String(req.query?.brand||"").trim();
    const rows=brand
      ? db.prepare("SELECT brand_name,model_name FROM piano_model_catalog WHERE active=1 AND lower(brand_name)=lower(?) ORDER BY lower(model_name),model_name").all(brand)
      : db.prepare("SELECT brand_name,model_name FROM piano_model_catalog WHERE active=1 ORDER BY lower(brand_name),lower(model_name),model_name").all();
    res.json(rows);
  }catch(error){res.status(500).json({error:error.message});}
});
app.post("/api/piano-models", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  try{
    const brandName=ensurePianoBrand(req.body?.brand_name||req.body?.brand||req.body?.make),modelName=ensurePianoModel(brandName,req.body?.model_name||req.body?.model);
    if(!brandName)return res.status(400).json({error:"PIANO_BRAND_REQUIRED"});
    if(!modelName)return res.status(400).json({error:"PIANO_MODEL_REQUIRED"});
    const row=db.prepare("SELECT brand_name,model_name,active,created_at FROM piano_model_catalog WHERE lower(brand_name)=lower(?) AND lower(model_name)=lower(?) LIMIT 1").get(brandName,modelName);
    res.status(201).json(row||{brand_name:brandName,model_name:modelName,active:1});
  }catch(error){res.status(400).json({error:error.message||"PIANO_MODEL_CREATE_FAILED"});}
});



app.get("/api/contacts/:id/pianos", auth, (req,res)=>{
  res.json(db.prepare(`SELECT DISTINCT p.*,cp.id AS client_piano_id,COALESCE(cp.is_verified,0) AS is_verified,cp.piano_location_address,cp.location_name,cp.verified_at,cp.verified_by
    FROM pianos p JOIN client_pianos cp ON cp.piano_id=p.id WHERE cp.client_id=? ORDER BY p.display_name,p.brand,p.model`).all(req.params.id));
});

app.post("/api/contacts/:id/link-piano", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  const pianoId=String(req.body.piano_id||"").trim();
  if(!pianoId) return res.status(400).json({error:"piano_id is required"});
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(pianoId);
  if(!piano) return res.status(404).json({error:"Piano not found"});
  const previousOwner=piano.owner_contact_id||null;
  db.prepare("UPDATE pianos SET owner_contact_id=?,owner_resolution='MATCHED_CLIENT',ownership='Customer owned',ownership_type='Customer owned',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(client.id,piano.id);
  linkClientPiano(client.id,piano.id);
  refreshClientHasPiano(previousOwner);refreshClientHasPiano(client.id);
  res.json(db.prepare("SELECT * FROM pianos WHERE id=?").get(piano.id));
});

app.post("/api/contacts/:id/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  if(rejectDuplicatePianoSerial(res,req.body.serial_no))return;
  const id=req.body.id || rid("P");
  const reference=centralPianoLookup(db,{serial:req.body.serial_no||"",brand:req.body.brand||"",model:req.body.model||"",currentYear:2026});
  const brand=ensurePianoBrand(req.body.brand || reference.brand || "");
  const model=ensurePianoModel(brand,req.body.model || reference.model || "");
  if(!brand||!model)return res.status(400).json({error:"PIANO_CORE_FIELDS_REQUIRED"});
  const display=req.body.display_name || `${brand} ${model}`.trim() || req.body.piano_name || "Unknown piano";
  const ownershipType=req.body.ownership_type || "Customer owned";
  const estimated=Number(req.body.estimated_value||0);
  const buildYear=req.body.build_year||reference.build_year||null,sizeCm=req.body.size_cm||reference.size_cm||null,sizeIn=req.body.size_in||req.body.size_inch||reference.size_inch||null,sizeDisplay=req.body.size_display||reference.size_display||((sizeCm||sizeIn)?[sizeCm?`${sizeCm} cm`:"",sizeIn?`(${sizeIn})`:""].filter(Boolean).join(" "):null),sizeLength=String(req.body.size_length||sizeDisplay||"").trim();
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,finish,build_year,size_cm,size_in,size_display,size_length,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,brand,model,req.body.serial_no||"",req.body.finish||"",buildYear,sizeCm,sizeIn,sizeDisplay,sizeLength,ownershipType,ownershipType,display,client.id,req.body.location||client.address||"",estimated,"Active",req.body.notes||"");
  linkClientPiano(client.id,id);
  db.prepare("UPDATE client_pianos SET location_name=?,piano_location_address=? WHERE client_id=? AND piano_id=?")
    .run(String(req.body.location_name||"").trim(),String(req.body.piano_location_address||req.body.location||client.address||"").trim(),client.id,id);
  refreshClientHasPiano(client.id);
  const piano=db.prepare(`SELECT p.*,cp.location_name,cp.piano_location_address FROM pianos p JOIN client_pianos cp ON cp.piano_id=p.id AND cp.client_id=? WHERE p.id=?`).get(client.id,id);
  res.json(piano);
});


app.put("/api/contacts/:id/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client)return res.status(404).json({error:"Client not found"});
  const ids = Array.isArray(req.body.piano_ids) ? [...new Set(req.body.piano_ids.map(id=>String(id||'').trim()).filter(Boolean))] : [];
  const sync=db.transaction(()=>{
    const previousRows=db.prepare("SELECT id,piano_id FROM client_pianos WHERE client_id=?").all(client.id),previousIds=previousRows.map(row=>row.piano_id),touchedOwners=new Set([client.id]);
    for(const pianoId of previousIds){
      if(ids.includes(pianoId))continue;
      db.prepare("DELETE FROM client_pianos WHERE client_id=? AND piano_id=?").run(client.id,pianoId);
      db.prepare("UPDATE pianos SET owner_contact_id=NULL,owner_resolution='UNIDENTIFIED_OWNER',ownership='Unknown',ownership_type='Unknown',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_contact_id=?").run(pianoId,client.id);
    }
    const upd=db.prepare("UPDATE pianos SET owner_contact_id=?,owner_resolution='MATCHED_CLIENT',ownership='Customer owned',ownership_type='Customer owned',updated_at=CURRENT_TIMESTAMP WHERE id=?");
    for(const pianoId of ids){
      const piano=db.prepare("SELECT id,owner_contact_id FROM pianos WHERE id=?").get(pianoId);if(!piano)continue;
      if(piano.owner_contact_id&&String(piano.owner_contact_id)!==String(client.id))touchedOwners.add(String(piano.owner_contact_id));
      upd.run(client.id,pianoId);
      const existing=db.prepare("SELECT id FROM client_pianos WHERE client_id=? AND piano_id=?").get(client.id,pianoId);
      db.prepare("DELETE FROM client_pianos WHERE piano_id=? AND client_id<>?").run(pianoId,client.id);
      if(!existing)db.prepare("INSERT INTO client_pianos(id,client_id,piano_id) VALUES(?,?,?)").run(rid("CP"),client.id,pianoId);
    }
    touchedOwners.forEach(refreshClientHasPiano);
  });
  sync();
  res.json({ok:true,piano_ids:ids});
});
app.get("/api/closed-jobs", auth, (req,res)=>{
  const rows=db.prepare(`
    SELECT
      jl.id AS log_id,
      jl.job_id,
      j.job_key,
      j.title,
      j.job_type,
      j.client_name,
      j.client_phone,
      j.piano_name,
      j.assigned_to AS responsible_at_close,
      jl.created_by AS closed_by,
      jl.created_at AS closed_at,
      jl.log_type AS close_type,
      jl.description AS close_description,
      jl.billed_amount,
      jl.payment_method,
      jl.invoice_number,
      jl.document_path,
      jl.next_job_id,
      nj.job_key AS next_job_key,
      nj.title AS next_job_title
    FROM job_logs jl
    LEFT JOIN jobs j ON j.id=jl.job_id
    LEFT JOIN jobs nj ON nj.id=jl.next_job_id
    WHERE jl.log_type IN ('Full','Partial','Failed')
    ORDER BY jl.created_at DESC
  `).all();
  const workflowRows=db.prepare(`SELECT wc.id AS workflow_closed_id,wc.workflow_id,w.id AS log_id,w.workflow_key AS job_key,w.title,
      c.name AS client_name,COALESCE(p.display_name,TRIM(COALESCE(p.brand,'')||' '||COALESCE(p.model,''))) AS piano_name,
      'Workshop Workflow' AS job_type,wf.name AS responsible_at_close,u.name AS closed_by,wc.closed_at AS closed_at,
      'Workflow' AS close_type,wc.net_total AS billed_amount,wi.payment_method AS payment_method,
      wi.invoice_number AS invoice_number,NULL AS document_path,wc.closure_reason AS close_description,NULL AS next_job_id,NULL AS next_job_key,NULL AS next_job_title
    FROM workflow_finance_closures wc JOIN workflow_finance_sources w ON w.id=wc.workflow_id
    JOIN contacts c ON c.id=wc.client_id JOIN pianos p ON p.id=wc.piano_id
    LEFT JOIN users u ON u.id=wc.closed_by_user_id
    LEFT JOIN users wf ON wf.id=w.transport_responsible_user_id
    LEFT JOIN invoices wi ON wi.source_type='workflow' AND wi.source_id=w.id AND wi.direction='receivable' AND wi.status<>'void'
    ORDER BY wc.closed_at DESC`).all();
  res.json([...rows,...workflowRows].sort((a,b)=>String(b.closed_at||'').localeCompare(String(a.closed_at||''))));
});

















app.delete("/api/closed-jobs/:id", auth, requireSuperadmin, (req,res)=>{
  const log=db.prepare("SELECT * FROM job_logs WHERE id=?").get(req.params.id);
  if(!log) return res.status(404).json({error:"Closed job log not found"});
  db.prepare("DELETE FROM financial_items WHERE (job_id=? AND source_type IN ('JOB_REVENUE','DAILY_RATE','TECHNICIAN_EXTRA_COMPENSATION','closed_job','job_close_revenue')) OR (source_type='closed_job' AND source_id=?) OR (source_type IN ('job_close_revenue','JOB_REVENUE') AND source_id IN (?,?))").run(log.job_id, log.job_id, `JOB_CLOSE:${log.job_id}`, `JOB_REVENUE:${log.job_id}`);
  db.prepare("DELETE FROM knowledge_base WHERE job_id=?").run(log.job_id);
  db.prepare("DELETE FROM job_logs WHERE id=?").run(log.id);
  const job=db.prepare("SELECT * FROM jobs WHERE id=?").get(log.job_id);
  if(job && ["Completed","Partially completed"].includes(String(job.status||""))){
    db.prepare("DELETE FROM jobs WHERE id=?").run(log.job_id);
  }
  res.json({ok:true});
});

app.get("/api/inventory-checks", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  res.json(db.prepare("SELECT * FROM inventory_checks ORDER BY check_date DESC, created_at DESC").all());
});
app.delete("/api/inventory-checks/:id", auth, requireSuperadmin, (req,res)=>{
  db.prepare("DELETE FROM inventory_checks WHERE id=?").run(req.params.id);
  res.json({ok:true});
});


app.get('/api/my-permissions',auth,(req,res)=>{
  if(isSuperadminUser(req.user)) return res.json({all:true,permissions:[]});
  const permissions=db.prepare('SELECT permission FROM role_permissions WHERE role=? AND enabled=1').all(req.user.role).map(x=>x.permission);
  res.json({all:false,permissions});
});
app.get('/api/admin/modules',auth,permit(...VISIBLE_USER_ROLES),(req,res)=>{
  let settings={};
  try{settings=JSON.parse(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='admin_module_settings'").get()?.setting_value||"{}")}catch(_error){settings={};}
  const canToggle=isSuperadminUser(req.user);
  res.json({modules:ADMIN_MODULES.map(module=>({...module,enabled:settings[module.key]!==false,can_toggle:canToggle})),cards:ADMIN_MODULE_CARDS.map(card=>({...card,enabled:settings[card.key]!==false,can_toggle:canToggle})),operational_contract_keys:OPERATIONAL_CONTRACT_KEYS,superadmin_visible:canToggle});
});
app.put('/api/admin/modules/:moduleKey',auth,(req,res)=>{
  if(!isSuperadminUser(req.user)) return res.status(403).json({error:'SUPERADMIN_REQUIRED'});
  const module=ADMIN_MODULES.find(item=>item.key===req.params.moduleKey)||ADMIN_MODULE_CARDS.find(item=>item.key===req.params.moduleKey); if(!module)return res.status(404).json({error:'MODULE_NOT_FOUND'});
  let settings={}; try{settings=JSON.parse(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='admin_module_settings'").get()?.setting_value||"{}")}catch(_error){settings={};}
  settings[module.key]=Boolean(req.body?.enabled); setSetting('admin_module_settings',JSON.stringify(settings),req.user.name||'SUPERADMIN');
  res.json({key:module.key,enabled:settings[module.key]});
});
app.get('/api/settings/branding',auth,permit('ADMIN'),(req,res)=>res.json(getBranding()));
app.put('/api/settings/branding',auth,permit('ADMIN'),(req,res)=>{
  const before=getBranding(); const company=String(req.body?.company_name||'').trim(); const short=String(req.body?.short_name||'').trim();
  if(!company||!short) return res.status(400).json({error:'REQUIRED_FIELDS'});
  setSetting('company_name',company,req.user.name||''); setSetting('short_name',short,req.user.name||''); bumpBrandingVersion(req.user.name||'');
  const after=getBranding(); audit(req,'UPDATE','branding','identity',before,after); res.json(after);
});
app.post('/api/settings/branding/logo',auth,permit('ADMIN'),brandingUpload.single('logo'),(req,res)=>{
  if(!req.file) return res.status(400).json({error:'INVALID_FILE_TYPE'});
  const dim=imageDimensions(req.file.path);
  if(!dim||dim.width<192||dim.height<192){try{fs.unlinkSync(req.file.path)}catch(e){} return res.status(400).json({error:'PWA_LOGO_REQUIREMENTS'});}
  const before=getBranding(); const logoUrl='/uploads/'+path.basename(req.file.path);
  setSetting('logo_url',logoUrl,req.user.name||''); bumpBrandingVersion(req.user.name||'');
  const after=getBranding(); audit(req,'UPDATE','branding','logo',before,after); res.json(after);
});
app.post('/api/settings/branding/background',auth,permit('ADMIN'),brandingUpload.single('background'),(req,res)=>{
  if(!req.file) return res.status(400).json({error:'INVALID_FILE_TYPE'});
  const dim=imageDimensions(req.file.path); if(!dim){try{fs.unlinkSync(req.file.path)}catch(e){} return res.status(400).json({error:'INVALID_IMAGE'});}
  const before=getBranding(); setSetting('login_background_url','/uploads/'+path.basename(req.file.path),req.user.name||''); bumpBrandingVersion(req.user.name||'');
  const after=getBranding(); audit(req,'UPDATE','branding','login_background',before,after); res.json(after);
});
app.post('/api/settings/branding/reset-logo',auth,permit('ADMIN'),(req,res)=>{const before=getBranding();setSetting('logo_url','/icons/icon-512.png',req.user.name||'');bumpBrandingVersion(req.user.name||'');const after=getBranding();audit(req,'UPDATE','branding','logo',before,after);res.json(after);});
app.post('/api/settings/branding/reset-background',auth,permit('ADMIN'),(req,res)=>{const before=getBranding();setSetting('login_background_url','',req.user.name||'');bumpBrandingVersion(req.user.name||'');const after=getBranding();audit(req,'UPDATE','branding','login_background',before,after);res.json(after);});
app.get('/api/settings/permissions',auth,permit('ADMIN'),(req,res)=>{
  const roles=db.prepare("SELECT DISTINCT role FROM users WHERE COALESCE(hidden_user,0)=0 AND role IN ('ADMIN','MANAGER','WORKER') UNION SELECT DISTINCT role FROM role_permissions WHERE role IN ('ADMIN','MANAGER','WORKER') ORDER BY role").all().map(x=>x.role);
  const permissions=['scheduler.view','planned_jobs.view','contacts.view','pianos.view','closed_jobs.view','knowledge_base.view','finance.view','income_statement.view','invoice_documents.view','inventory.view','users.view','customer_inbox.view','users.create','users.roles','permissions.manage','audit.view','events.view','events.manage','events.refunds','system_integrations.view','system_integrations.edit','system_integrations.test'];
  const rows=db.prepare('SELECT role,permission,enabled FROM role_permissions').all();
  res.json({roles,permissions,rows});
});
app.put('/api/settings/permissions',auth,permit('ADMIN'),(req,res)=>{
  const {role,permission,enabled}=req.body||{};
  if(!role||!permission) return res.status(400).json({error:'REQUIRED_FIELDS'});
  if(role==='SUPERADMIN') return res.status(403).json({error:'SUPERADMIN_PERMISSIONS_FIXED'});
  if(!VISIBLE_USER_ROLES.includes(role)) return res.status(400).json({error:'INVALID_USER_ROLE'});
  const old=db.prepare('SELECT * FROM role_permissions WHERE role=? AND permission=?').get(role,permission);
  db.prepare(`INSERT INTO role_permissions(role,permission,enabled,updated_by,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(role,permission) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(role,permission,enabled?1:0,req.user.name||'');
  const now=db.prepare('SELECT * FROM role_permissions WHERE role=? AND permission=?').get(role,permission);
  audit(req,'UPDATE','permissions',`${role}:${permission}`,old,now); res.json(now);
});
app.get('/api/audit-log',auth,permit('ADMIN'),(req,res)=>{
  const limit=Math.min(Number(req.query.limit||500),2000); const type=String(req.query.type||'WORK').toUpperCase()==='TECHNICAL'?'TECHNICAL':'WORK';
  res.json(db.prepare("SELECT * FROM audit_log WHERE audit_type=? ORDER BY event_time DESC LIMIT ?").all(type,limit));
});
app.get('/api/audit-log/export',auth,requireSuperadmin,(req,res)=>{
  const type=String(req.query.type||'WORK').toUpperCase()==='TECHNICAL'?'TECHNICAL':'WORK';
  const rows=db.prepare("SELECT * FROM audit_log WHERE audit_type=? ORDER BY event_time DESC").all(type);
  const cols=['event_time','user_name','user_role','action','module','record_id','old_value','new_value','success','details']; const escCsv=v=>'"'+String(v??'').replaceAll('"','""')+'"'; const csv=[cols.join(','),...rows.map(r=>cols.map(c=>escCsv(r[c])).join(','))].join('\n'); res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${type==='WORK'?'work-audit':'technical-audit'}.csv"`);res.send('\ufeff'+csv);
});
app.delete('/api/audit-log',auth,requireSuperadmin,(req,res)=>{
  const type=String(req.query.type||'ALL').toUpperCase();
  if(type==='FINANCIAL') return res.status(405).json({error:'IMMUTABLE_FINANCIAL_AUDIT_LOG'});
  if(type==='WORK'||type==='TECHNICAL') db.prepare('DELETE FROM audit_log WHERE audit_type=?').run(type);
  else db.prepare("DELETE FROM audit_log WHERE audit_type<>'FINANCIAL'").run();
  res.json({ok:true,financial_audit_preserved:true});
});
app.get('/api/backups',auth,permit('ADMIN'),(req,res)=>res.json(db.prepare('SELECT id,file_name,file_size,status,created_by,created_at,restored_at,restored_by FROM backup_log ORDER BY created_at DESC').all()));
app.post('/api/backups',auth,requireSuperadmin,(req,res)=>{const b=createBackup(req.user.name||'SUPERADMIN');audit(req,'CREATE','backup',b.id,null,b);res.json(b);});
app.get('/api/backups/:id/download',auth,requireSuperadmin,(req,res)=>{const b=db.prepare('SELECT * FROM backup_log WHERE id=?').get(req.params.id);if(!b||!fs.existsSync(b.file_path))return res.status(404).json({error:'BACKUP_NOT_FOUND'});res.download(b.file_path,b.file_name);});
app.post('/api/backups/:id/restore',auth,requireSuperadmin,(req,res)=>{
  const {password,confirmation}=req.body||{}; if(confirmation!=='RESTORE BACKUP')return res.status(400).json({error:'RESTORE_CONFIRMATION_REQUIRED'});
  const owner=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);if(!owner||!bcrypt.compareSync(String(password||''),owner.password_hash))return res.status(401).json({error:'INVALID_PASSWORD'});
  const b=db.prepare('SELECT * FROM backup_log WHERE id=?').get(req.params.id);if(!b||!fs.existsSync(b.file_path))return res.status(404).json({error:'BACKUP_NOT_FOUND'});
  const safety=createBackup('PRE_RESTORE'); db.close(); fs.copyFileSync(b.file_path,DB_PATH);
  return res.json({ok:true,restartRequired:true,safetyBackup:safety.file_name});
});

app.post("/api/system/delete-everything", auth, requireSuperadmin, (req,res)=>{
  const confirmation=String(req.body?.confirmation||"");
  if(confirmation!=="DELETE EVERYTHING") return res.status(400).json({error:"Exact confirmation is required"});
  const exists=(table)=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  const clear=(table)=>{ if(exists(table)) db.prepare(`DELETE FROM ${table}`).run(); };
  const superadminId=String(req.user.id||"");
  if(!superadminId) return res.status(400).json({error:"Superadmin identity is missing"});
  const immutableFinancialCount=exists("invoices")?Number(db.prepare("SELECT COUNT(*) AS c FROM invoices").get()?.c||0):0;
  const immutableAdjustmentCount=exists("invoice_adjustments")?Number(db.prepare("SELECT COUNT(*) AS c FROM invoice_adjustments").get()?.c||0):0;
  const immutableCreditMemoCount=exists("invoice_credit_memos")?Number(db.prepare("SELECT COUNT(*) AS c FROM invoice_credit_memos").get()?.c||0):0;
  const immutableFinancialItemAdjustmentCount=exists("financial_item_adjustments")?Number(db.prepare("SELECT COUNT(*) AS c FROM financial_item_adjustments").get()?.c||0):0;
  const immutableFinancialItemVoidCount=exists("financial_item_voids")?Number(db.prepare("SELECT COUNT(*) AS c FROM financial_item_voids").get()?.c||0):0;
  const immutableDirectFinancialItemCount=exists("financial_items")?Number(db.prepare(`SELECT COUNT(*) AS c FROM financial_items WHERE COALESCE(source_type,'') NOT IN ('JOB_REVENUE','DAILY_RATE','TECHNICIAN_EXTRA_COMPENSATION','MANUAL_INVOICE','WORKFLOW_INVOICE_REVENUE','WORKFLOW_INVOICE_MATERIAL','event_payment_refund','event_manual_ticket_refund','event_manual_ticket','event_payment','closed_job','job_close_revenue')`).get()?.c||0):0;
  if(immutableFinancialCount||immutableAdjustmentCount||immutableCreditMemoCount||immutableFinancialItemAdjustmentCount||immutableFinancialItemVoidCount||immutableDirectFinancialItemCount){
    return res.status(409).json({
      error:"IMMUTABLE_FINANCIAL_RECORDS",
      message:"System reset is blocked while issued financial records exist. Financial documents must remain preserved and may only be voided with an audit reason.",
      invoices:immutableFinancialCount,
      adjustments:immutableAdjustmentCount,
      credit_memos:immutableCreditMemoCount,
      financial_item_adjustments:immutableFinancialItemAdjustmentCount,
      financial_item_voids:immutableFinancialItemVoidCount,
      direct_financial_items:immutableDirectFinancialItemCount
    });
  }

  const tx=db.transaction(()=>{
    // Delete every business, import, audit, backup and configurable record.
    // Only the currently authenticated hidden superadmin account survives.
    [
      "calendar_sync_log","calendar_oauth_states","external_calendar_events","calendar_integrations",
      "system_integration_delete_tokens","system_integration_test_tokens","system_integration_backups","system_integration_health","system_integration_secrets",
      "website_integration_oauth_states","website_integration_settings","website_preview_tokens","website_content_versions","website_tracking_events","website_contact_leads","website_media","website_artists","website_services","website_showroom_pianos","website_reviews","website_content_pages","landing_sections","marketing_campaigns",
      "event_attendance_exports","event_attendance_actions","event_attendance_entries","event_attendance_sessions","event_checkins","event_ticket_documents","event_refund_requests","event_checkout_holds","stripe_webhook_events","event_payments","event_tickets","event_invitations","event_repeat_requests","event_closures","events","event_categories",
      "customer_message_attachments","customer_messages","customer_conversation_events","customer_conversations","communication_deliveries",
      "workflow_finance_closures","workflow_finance_lines","workflow_finance_phases","workflow_finance_sources","workflow_retired_calendar_jobs",
      "invoice_items","invoices","invoice_sequences","partner_contractors","partners",
      "journal_lines","journal_entries","financial_items","accounts",
      "job_logs","knowledge_base","jobs","planned_jobs","employee_daily_rates",
      "inventory_checks","inventory_items","client_pianos","pianos","contacts","import_batches",
      "audit_log","backup_log","role_permissions","app_settings","notifications","push_subscriptions","push_activation_tests","notification_devices","notification_preferences",
      "account_activations","activation_email_events","activation_email_log"
    ].forEach(clear);

    if(exists("users")){
      db.prepare("DELETE FROM users WHERE id<>?").run(superadminId);
      db.prepare("UPDATE users SET status='Active', hidden_user=1, is_superadmin=1, role='ADMIN', google_calendar_email=NULL WHERE id=?").run(superadminId);
    }

    if(exists("notification_preferences")){
      db.prepare("INSERT OR IGNORE INTO notification_preferences(user_id,push_enabled,job_assigned,job_transferred,job_updated,job_deleted,one_hour_reminder,direct_message) VALUES(?,1,1,1,1,1,1,1)").run(superadminId);
    }

    // Recreate only the minimum system defaults required for a usable clean installation.
    if(exists("app_settings")){
      const insertSetting=db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES(?,?,?)");
      [
        ["company_name","Klavierhaus","SYSTEM"],
        ["short_name","KH ERP","SYSTEM"],
        ["logo_url","/icons/icon-512.png","SYSTEM"],
        ["login_background_url","","SYSTEM"],
        ["branding_version","1","SYSTEM"]
      ].forEach(row=>insertSetting.run(...row));
    }

    if(exists("role_permissions")){
      const commonView=['scheduler.view','workshop_workflow.view','planned_jobs.view','contacts.view','pianos.view','closed_jobs.view','knowledge_base.view','inventory.view','users.view','customer_inbox.view'];
      const defaults={
        ADMIN:[...commonView,'finance.view','income_statement.view','invoice_documents.view','users.create','users.roles','permissions.manage','audit.view','events.view','events.manage','events.refunds','system_integrations.view','system_integrations.edit','system_integrations.test'],
        MANAGER:[...commonView,'finance.view','income_statement.view','invoice_documents.view'],
        WORKER:[...commonView]
      };
      const insertPermission=db.prepare("INSERT INTO role_permissions(role,permission,enabled,updated_by) VALUES(?,?,1,'SYSTEM')");
      Object.entries(defaults).forEach(([role,permissions])=>permissions.forEach(permission=>insertPermission.run(role,permission)));
    }

    if(exists("event_categories")){
      const insertCategory=db.prepare("INSERT INTO event_categories(id,code,name_en,name_hu,sort_order) VALUES(?,?,?,?,?)");
      [
        ["EVC-PIANO-CONCERT","PIANO_CONCERT","Piano Concert","Zongorahangverseny",10],
        ["EVC-ARTIST-PERFORMANCE","ARTIST_PERFORMANCE","Artist Performance","Művészi előadás",20],
        ["EVC-SALON-CONCERT","SALON_CONCERT","Salon Concert","Szalonkoncert",30],
        ["EVC-MASTERCLASS","MASTERCLASS","Masterclass","Mesterkurzus",40],
        ["EVC-CULTURAL-EVENT","CULTURAL_EVENT","Cultural Event","Kulturális esemény",50],
        ["EVC-OTHER-MUSICAL","OTHER_MUSICAL_EVENT","Other Musical Event","Egyéb zenei esemény",60]
      ].forEach(row=>insertCategory.run(...row));
    }

    if(exists("sqlite_sequence")) db.prepare("DELETE FROM sqlite_sequence").run();
  });

  tx();
  googleCalendar.stop();

  // Remove every uploaded branding/document file and every physical backup file as part of the full reset.
  for(const directory of [UPLOAD_DIR,BACKUP_DIR]){
    try{
      if(fs.existsSync(directory)){
        for(const name of fs.readdirSync(directory)){
          try{fs.rmSync(path.join(directory,name),{recursive:true,force:true});}catch(_e){}
        }
      }
    }catch(_e){}
  }

  res.json({ok:true,reset:true,preservedSuperadminId:superadminId});
});

app.use(uploadErrorHandler);
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  console.error('Unhandled API error:',err?.stack||err);
  res.status(500).json({error:'INTERNAL_SERVER_ERROR'});
});
scheduleFinancialStatementClose();
generateOneHourReminders();
setInterval(generateOneHourReminders,5*60*1000).unref();
function startServer(port = PORT) {
  return app.listen(port, () => console.log(`Klavierhaus v6.7.0 notifications running on http://localhost:${port}; push=${PUSH_CONFIGURED?'configured':'not configured'}`));
}

if (require.main === module) startServer();

module.exports = { app, db, startServer };
