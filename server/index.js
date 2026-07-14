
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Database = require("better-sqlite3");
let webpush=null;
try{webpush=require("web-push");}catch(error){console.warn("web-push unavailable:",error.message);}
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3030;
const VAPID_PUBLIC_KEY=process.env.VAPID_PUBLIC_KEY||"";
const VAPID_PRIVATE_KEY=process.env.VAPID_PRIVATE_KEY||"";
const VAPID_SUBJECT=process.env.VAPID_SUBJECT||"mailto:admin@klavierhaus.com";
const PUSH_CONFIGURED=Boolean(webpush&&VAPID_PUBLIC_KEY&&VAPID_PRIVATE_KEY);
if(PUSH_CONFIGURED) webpush.setVapidDetails(VAPID_SUBJECT,VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY);

const JWT_SECRET = process.env.JWT_SECRET;
if(!JWT_SECRET || JWT_SECRET.length < 32){
  throw new Error("JWT_SECRET is required and must be at least 32 characters long");
}
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, {recursive:true});

const db = new Database(process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus_v6.sqlite"));
db.pragma("foreign_keys = ON");

// Database schema and migrations are executed exclusively by server/init-db.js.
// The application process does not create users, demo data, tables, columns, or indexes.

function seedDefaultPermissions(){
  const commonView=['scheduler.view','planned_jobs.view','contacts.view','pianos.view','closed_jobs.view','knowledge_base.view','inventory.view','users.view'];
  const defaults={
    ADMIN:[...commonView,'finance.view','income_statement.view','users.create','users.roles','permissions.manage','audit.view'],
    MANAGER:[...commonView,'finance.view','income_statement.view'],
    WORKER:[...commonView],
    VIEWER:[...commonView]
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
    if(isSuperadminUser(req?.user)) return;
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
const upload = multer({
  dest: UPLOAD_DIR,
  limits:{fileSize:20*1024*1024},
  fileFilter: (req,file,cb)=>{
    const ok = /\.(pdf|jpg|jpeg|png)$/i.test(file.originalname || "");
    if(!ok) return cb(new Error("Only PDF, JPG, JPEG or PNG files are allowed / Csak PDF, JPG, JPEG vagy PNG fájl tölthető fel"));
    cb(null,true);
  }
});

app.use(cors());
app.use(express.json({limit:"10mb"}));
const brandingUpload = multer({
  storage: multer.diskStorage({
    destination: (_req,_file,cb)=>cb(null,UPLOAD_DIR),
    filename: (_req,file,cb)=>cb(null,`branding-${Date.now()}${path.extname(file.originalname||'').toLowerCase()||'.png'}`)
  }),
  limits:{fileSize:15*1024*1024},
  fileFilter:(_req,file,cb)=>{const ok=['image/png','image/jpeg','image/jpg'].includes(String(file.mimetype||'').toLowerCase())||/\.(png|jpe?g)$/i.test(file.originalname||'');cb(ok?null:new Error('INVALID_FILE_TYPE'),ok)}
});
const clientImportUpload = multer({
  storage: multer.memoryStorage(),
  limits:{fileSize:25*1024*1024},
  fileFilter:(_req,file,cb)=>{
    const ok=/\.xlsx$/i.test(file.originalname||'') || String(file.mimetype||'').toLowerCase()==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    cb(ok?null:new Error('INVALID_EXCEL_FILE'),ok);
  }
});
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
app.get('/manifest.webmanifest',(_req,res)=>{const b=getBranding();res.type('application/manifest+json').send(JSON.stringify({name:b.company_name,short_name:b.short_name,start_url:'/',display:'standalone',background_color:'#07101d',theme_color:'#07101d',icons:[{src:`${b.logo_url}${b.logo_url.includes('?')?'&':'?'}v=${b.branding_version}`,sizes:'192x192 512x512',type:/\.jpe?g(?:$|\?)/i.test(b.logo_url)?'image/jpeg':'image/png',purpose:'any maskable'}]},null,2));});
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "..", "public")));
// Global protection: only superadmin may call DELETE endpoints.
app.use('/api',(req,res,next)=>{
  if(req.method!=='DELETE') return next();
  const h=req.headers.authorization||'';
  try{req.user=req.user||jwt.verify(h.startsWith('Bearer ')?h.slice(7):'',JWT_SECRET);}catch(e){return res.status(401).json({error:'AUTH_REQUIRED'});}
  if(!isSuperadminUser(req.user)) return res.status(403).json({error:'PERMISSION_DENIED'});
  next();
});
// Automatic audit trail for all business-changing API requests.
app.use('/api',(req,res,next)=>{
  if(!['POST','PUT','DELETE'].includes(req.method) || req.path==='/login') return next();
  const started=Date.now();
  res.on('finish',()=>{
    if(req.skipAutoAudit || req.path.startsWith('/audit-log') || isSuperadminUser(req.user)) return;
    const safeBody={...(req.body||{})}; if(safeBody.password) safeBody.password='[REDACTED]';
    const isWork=req.path==='/jobs'||req.path.startsWith('/jobs/');
    audit(req,req.method,isWork?'jobs':(req.path.split('/')[1]||'api'),req.params?.id||'',null,safeBody,res.statusCode<400?1:0,`${req.path} (${res.statusCode}) ${Date.now()-started}ms`,isWork?'WORK':'TECHNICAL');
  });
  next();
});

function rid(prefix){ return `${prefix}-${Date.now()}-${Math.floor(Math.random()*9999)}`; }
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
function findScheduleConflicts(assignedTo,startTime,endTime,excludeJobId=null){
  if(!assignedTo || !startTime || !endTime) return [];
  let sql=`SELECT id,job_key,title,assigned_to,start_time,end_time,status FROM jobs
           WHERE assigned_to=?
             AND COALESCE(status,'Open') NOT IN ('Completed','Cancelled')
             AND (? < end_time AND ? > start_time)`;
  const params=[assignedTo,startTime,endTime];
  if(excludeJobId){ sql += " AND id<>?"; params.push(excludeJobId); }
  sql += " ORDER BY start_time";
  return db.prepare(sql).all(...params);
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

function createFinancialItemForClosedJob(job, logId, billed, payment, userName){
  const amount=Number(billed||0);
  if(!amount || amount<=0) return null;
  const existing=db.prepare("SELECT * FROM financial_items WHERE source_type=? AND source_id=? LIMIT 1").get("closed_job", job.id);
  if(existing) return existing;
  const id=rid("FI");
  const title=`Closed job revenue / Lezárt munka bevétele: ${job.title||job.job_key||job.id}`;
  const description=[
    job.client_name ? `Client / Ügyfél: ${job.client_name}` : "",
    job.piano_name ? `Piano / Zongora: ${job.piano_name}` : "",
    logId ? `Job log / Lezárási napló: ${logId}` : ""
  ].filter(Boolean).join("\n");
  db.prepare(`INSERT INTO financial_items(
    id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,source_type,source_id,created_by
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,nyToday(),title,description,amount,"INCOME","SERVICE_REVENUE","ONE_TIME",payment||"",balanceAccountFromPaymentMethod(payment),job.id,job.client_id||null,job.piano_id||null,"closed_job",job.id,userName||"System"
  );
  return db.prepare("SELECT * FROM financial_items WHERE id=?").get(id);
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
function parseXlsxSheet(buffer,sheetName){
  const zip=new AdmZip(buffer);
  const read=name=>zip.getEntry(name)?.getData().toString('utf8')||'';
  const workbook=read('xl/workbook.xml');
  const rels=read('xl/_rels/workbook.xml.rels');
  if(!workbook||!rels)throw new Error('INVALID_XLSX_STRUCTURE');
  let relId='';
  for(const m of workbook.matchAll(/<(?:[A-Za-z0-9_]+:)?sheet\b([^>]*)\/?>(?:<\/(?:[A-Za-z0-9_]+:)?sheet>)?/g)){
    const attrs=m[1];
    const name=xmlDecode(attrs.match(/\bname="([^"]*)"/)?.[1]||'');
    if(name===sheetName){relId=attrs.match(/\br:id="([^"]+)"/)?.[1]||'';break;}
  }
  if(!relId)throw new Error('IMPORT_READY_SHEET_MISSING');
  let target='';
  for(const m of rels.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)){
    const attrs=m[1];
    if((attrs.match(/\bId="([^"]+)"/)?.[1]||'')===relId){target=attrs.match(/\bTarget="([^"]+)"/)?.[1]||'';break;}
  }
  if(!target)throw new Error('IMPORT_READY_SHEET_MISSING');
  target=target.replace(/^\//,'');
  if(!target.startsWith('xl/'))target='xl/'+target.replace(/^\.\//,'');
  const sheetXml=read(target);
  if(!sheetXml)throw new Error('IMPORT_READY_SHEET_MISSING');
  const shared=parseSharedStrings(read('xl/sharedStrings.xml'));
  const rows=[];
  for(const rowMatch of sheetXml.matchAll(/<(?:[A-Za-z0-9_]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?row>/g)){
    const row=[];
    for(const cMatch of rowMatch[1].matchAll(/<(?:[A-Za-z0-9_]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?c>)/g)){
      const attrs=cMatch[1], body=cMatch[2]||'';
      const ref=attrs.match(/\br="([^"]+)"/)?.[1]||'';
      const type=attrs.match(/\bt="([^"]+)"/)?.[1]||'';
      const col=excelColumnIndex(ref);
      let value='';
      if(type==='inlineStr'){
        value=[...body.matchAll(/<(?:[A-Za-z0-9_]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g)].map(x=>xmlDecode(x[1])).join('');
      }else{
        const raw=xmlDecode(body.match(/<(?:[A-Za-z0-9_]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?v>/)?.[1]||'');
        value=type==='s' ? (shared[Number(raw)]??'') : raw;
      }
      row[col]=value;
    }
    rows.push(row);
  }
  return rows;
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
  const rows=parseXlsxSheet(buffer,'Import Ready');
  if(!rows.length)throw new Error('IMPORT_READY_EMPTY');
  const headers=(rows[0]||[]).map(x=>String(x??'').trim());
  const required=['External Reference','Client Name','Contact Full Name','Phone','Email','Billing Address','Service Address','Status','Last Contact','Next Step','Notes','Review Status'];
  const missing=required.filter(h=>!headers.includes(h));
  if(missing.length){const e=new Error('MISSING_COLUMNS');e.missingColumns=missing;throw e;}
  const index=Object.fromEntries(headers.map((h,i)=>[h,i]));
  const source='NEW_YORK_CUSTOMER_LIST_2024';
  const existing=db.prepare('SELECT id,name,email,phone,address,external_reference,import_source FROM contacts').all();
  const exactRefs=new Map(existing.filter(x=>x.import_source&&x.external_reference).map(x=>[`${x.import_source}::${x.external_reference}`,x]));
  const existingEmails=new Map(); const existingPhones=new Map(); const existingNameAddress=new Map();
  for(const c of existing){
    for(const e of normalizeEmailList(c.email))if(!existingEmails.has(e))existingEmails.set(e,c);
    for(const p of normalizePhones(c.phone))if(!existingPhones.has(p))existingPhones.set(p,c);
    const key=`${normalizeText(c.name)}::${normalizeText(c.address)}`; if(normalizeText(c.name)&&normalizeText(c.address)&&!existingNameAddress.has(key))existingNameAddress.set(key,c);
  }
  const seenRefs=new Set(); const records=[];
  for(let r=1;r<rows.length;r++){
    const cells=rows[r]||[];
    if(!cells.some(v=>String(v??'').trim()))continue;
    const get=h=>String(cells[index[h]]??'').trim();
    const rec={rowNumber:r+1,externalReference:get('External Reference'),name:get('Client Name'),contactFullName:get('Contact Full Name'),phone:get('Phone'),email:get('Email'),billingAddress:get('Billing Address'),serviceAddress:get('Service Address'),status:get('Status')||'General',lastContact:excelDateToIso(get('Last Contact')),nextStep:get('Next Step'),notes:get('Notes'),reviewStatus:get('Review Status')};
    rec.missingFields=[]; if(!normalizeEmailList(rec.email).length&&!normalizePhones(rec.phone).length)rec.missingFields.push('Phone or Email'); if(!rec.serviceAddress)rec.missingFields.push('Address'); rec.hasMissingData=rec.missingFields.length>0;
    let category='NEW',reason='';
    if(!rec.name){category='INVALID';reason='MISSING_CLIENT_NAME';}
    else if(normalizeText(rec.reviewStatus)!=='ready'){category='INVALID';reason='NOT_READY';}
    else if(!rec.externalReference){category='INVALID';reason='MISSING_EXTERNAL_REFERENCE';}
    else if(seenRefs.has(rec.externalReference)){category='INVALID';reason='DUPLICATE_REFERENCE_IN_FILE';}
    else{
      seenRefs.add(rec.externalReference);
      const exact=exactRefs.get(`${source}::${rec.externalReference}`);
      if(exact){category='ALREADY_IMPORTED';reason='EXTERNAL_REFERENCE_MATCH';rec.match=exact;}
      else{
        const emailMatch=normalizeEmailList(rec.email).map(e=>existingEmails.get(e)).find(Boolean);
        const phoneMatch=normalizePhones(rec.phone).map(p=>existingPhones.get(p)).find(Boolean);
        const nameAddressMatch=existingNameAddress.get(`${normalizeText(rec.name)}::${normalizeText(rec.serviceAddress)}`);
        const match=emailMatch||phoneMatch||nameAddressMatch;
        if(match){category='POSSIBLE_DUPLICATE';reason=emailMatch?'EMAIL_MATCH':phoneMatch?'PHONE_MATCH':'NAME_ADDRESS_MATCH';rec.match=match;}
      }
    }
    rec.category=category;rec.reason=reason;records.push(rec);
  }
  if(!records.length)throw new Error('IMPORT_READY_EMPTY');
  const count=cat=>records.filter(x=>x.category===cat).length;
  const summary={filename:originalFilename,totalRows:records.length,newClients:count('NEW'),alreadyImported:count('ALREADY_IMPORTED'),possibleDuplicates:count('POSSIBLE_DUPLICATE'),invalidRows:count('INVALID'),missingDataClients:records.filter(x=>x.category==='NEW'&&x.hasMissingData).length};
  return {source,headers,summary,records};
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
    const currentUser=db.prepare("SELECT id,name,email,role,status,hidden_user,is_superadmin FROM users WHERE id=? AND status='Active'").get(tokenUser.id);
    if(!currentUser) return res.status(401).json({error:"User no longer exists or is inactive"});
    req.user={...tokenUser,...currentUser,role:Number(currentUser.is_superadmin||0)===1?'SUPERADMIN':currentUser.role};
    next();
  } catch(e){
    res.status(401).json({error:"Invalid token"});
  }
}
function isSuperadminUser(user){ return user && (user.role === "SUPERADMIN" || Number(user.is_superadmin||0) === 1); }
function permit(...roles){ return (req,res,next)=> (isSuperadminUser(req.user) || roles.includes(req.user.role)) ? next() : res.status(403).json({error:"Forbidden"}); }
function requireSuperadmin(req,res,next){ return isSuperadminUser(req.user) ? next() : res.status(403).json({error:"Superadmin only / Csak szuperadmin"}); }
function resolveActiveUser(userId, userName){
  if(userId){const byId=db.prepare("SELECT id,name FROM users WHERE id=? AND status='Active'").get(userId);if(byId)return byId;}
  if(userName){return db.prepare("SELECT id,name FROM users WHERE lower(trim(name))=lower(trim(?)) AND status='Active' LIMIT 1").get(userName)||null;}
  return null;
}
function isAssignedToUser(job,user){return !!job&&!!user&&((job.assigned_user_id&&String(job.assigned_user_id)===String(user.id))||(!job.assigned_user_id&&String(job.assigned_to||"")===String(user.name||"")));}
function jobsSelectSql(where=""){
  return `SELECT j.*, COALESCE(au.name,j.assigned_to) AS assigned_to, COALESCE(cu.name,j.created_by) AS created_by, COALESCE(ru.name,j.last_reassigned_by) AS last_reassigned_by FROM jobs j LEFT JOIN users au ON au.id=j.assigned_user_id LEFT JOIN users cu ON cu.id=j.created_by_user_id LEFT JOIN users ru ON ru.id=j.last_reassigned_by_user_id ${where}`;
}

function canCloseJob(user, job){
  if(isSuperadminUser(user) || user.role === "ADMIN") return true;
  return isAssignedToUser(job,user);
}
function canEditJob(user, job){
  if(isSuperadminUser(user) || user.role === "ADMIN") return true;
  if(isAssignedToUser(job,user)) return true;
  if(user.role === "MANAGER" && ((job.created_by_user_id&&job.created_by_user_id===user.id)||(!job.created_by_user_id&&job.created_by===user.name))) return true;
  return false;
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

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body;
  const u=db.prepare("SELECT * FROM users WHERE lower(email)=lower(?) AND status='Active'").get(String(email||""));
  const valid=!!u && bcrypt.compareSync(String(password||''), u.password_hash);
  if(!valid){
    if(!u || Number(u.is_superadmin||0)!==1) audit({user:u?{id:u.id,name:u.name,email:u.email,role:u.role,is_superadmin:0}:{id:'',name:'',email:String(email||''),role:'',is_superadmin:0}},'LOGIN_FAILED','authentication',u?.id||'',null,{email:String(email||'')},0,'Invalid login','TECHNICAL');
    return res.status(401).json({error:"Invalid login"});
  }
  const isSuper=Number(u.is_superadmin||0)===1;
  const effectiveRole=isSuper?"SUPERADMIN":u.role;
  const loginUser={id:u.id,name:u.name,email:u.email,role:effectiveRole,is_superadmin:isSuper?1:0};
  const token=jwt.sign(loginUser, JWT_SECRET, {expiresIn:"30d"});
  audit({user:loginUser},'LOGIN','authentication',u.id,null,{email:u.email},1,'Successful login','TECHNICAL');
  res.json({token,user:loginUser});
});
app.post("/api/logout",auth,(req,res)=>{audit(req,'LOGOUT','authentication',req.user.id,null,null,1,'User logout','TECHNICAL');res.json({ok:true});});
app.get("/api/me", auth, (req,res)=>res.json(req.user));

app.get("/api/schedule-workers", auth, (req,res)=>{
  const rows=db.prepare("SELECT id,name,email,role FROM users WHERE status='Active' AND COALESCE(hidden_user,0)=0 ORDER BY name").all();
  res.json(rows);
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
  const subscription=endpoint?db.prepare('SELECT id FROM push_subscriptions WHERE user_id=? AND endpoint=?').get(req.user.id,endpoint):db.prepare('SELECT id FROM push_subscriptions WHERE user_id=? AND device_id=?').get(req.user.id,deviceId);
  const device=db.prepare('SELECT * FROM notification_devices WHERE user_id=? AND device_id=?').get(req.user.id,deviceId);
  res.json({configured:PUSH_CONFIGURED,required:true,subscribed:Boolean(subscription),deviceStatus:device?.status||'NOT_CONFIGURED'});
});

app.post('/api/push/subscribe',auth,(req,res)=>{
  const subscription=req.body?.subscription;
  const deviceId=normalizeDeviceId(req.body?.device_id);
  if(!subscription?.endpoint||!deviceId)return res.status(400).json({error:'INVALID_PUSH_SUBSCRIPTION'});
  const existing=db.prepare('SELECT id FROM push_subscriptions WHERE endpoint=?').get(subscription.endpoint);const id=existing?.id||rid('PSH');
  db.prepare(`INSERT INTO push_subscriptions(id,user_id,endpoint,subscription_json,user_agent,language,device_id,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,user_agent=excluded.user_agent,language=excluded.language,device_id=excluded.device_id,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).run(id,req.user.id,subscription.endpoint,JSON.stringify(subscription),String(req.headers['user-agent']||''),req.body?.language==='hu'?'hu':'en',deviceId);
  db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id,push_enabled) VALUES(?,1)').run(req.user.id);
  db.prepare('UPDATE notification_preferences SET push_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(req.user.id);
  const device=upsertNotificationDevice(req.user.id,deviceId,{status:'ENABLED',platform:String(req.body?.platform||''),userAgent:String(req.headers['user-agent']||''),language:req.body?.language});
  res.json({ok:true,configured:PUSH_CONFIGURED,device});
});
app.delete('/api/push/subscribe',auth,(req,res)=>{const endpoint=String(req.body?.endpoint||'');const deviceId=normalizeDeviceId(req.body?.device_id);if(endpoint)db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(req.user.id,endpoint);else if(deviceId)db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND device_id=?').run(req.user.id,deviceId);else db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(req.user.id);if(deviceId)upsertNotificationDevice(req.user.id,deviceId,{status:'NOT_CONFIGURED',platform:String(req.body?.platform||''),userAgent:String(req.headers['user-agent']||''),language:req.body?.language});res.json({ok:true});});
app.get('/api/notification-preferences',auth,(req,res)=>{db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id) VALUES(?)').run(req.user.id);res.json(db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(req.user.id));});
app.put('/api/notification-preferences',auth,(req,res)=>{db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id) VALUES(?)').run(req.user.id);const fields=['push_enabled','job_assigned','job_transferred','job_updated','job_deleted','one_hour_reminder','direct_message'];const cols=fields.filter(f=>req.body[f]!==undefined);if(cols.length)db.prepare(`UPDATE notification_preferences SET ${cols.map(f=>`${f}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE user_id=?`).run(...cols.map(f=>Number(req.body[f])?1:0),req.user.id);res.json(db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(req.user.id));});
app.get('/api/notifications',auth,(req,res)=>{const active=String(req.query.active??'1')!=='0';const rows=db.prepare(`SELECT n.*,su.name sender_name FROM notifications n LEFT JOIN users su ON su.id=n.sender_user_id WHERE n.recipient_user_id=? ${active?"AND n.status='ACTIVE'":''} ORDER BY n.created_at DESC LIMIT 500`).all(req.user.id);res.json(rows);});
app.get('/api/notifications/count',auth,(req,res)=>res.json({count:db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_user_id=? AND status='ACTIVE'").get(req.user.id).c}));
app.post('/api/notifications/:id/acknowledge',auth,(req,res)=>{const row=db.prepare('SELECT * FROM notifications WHERE id=? AND recipient_user_id=?').get(req.params.id,req.user.id);if(!row)return res.status(404).json({error:'NOTIFICATION_NOT_FOUND'});db.prepare("UPDATE notifications SET status='ACKNOWLEDGED',acknowledged_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);res.json({ok:true});});
app.post('/api/notifications/message',auth,(req,res)=>{const recipientUserId=String(req.body?.recipient_user_id||'');const message=String(req.body?.message||'').trim();if(!recipientUserId||!message)return res.status(400).json({error:'RECIPIENT_AND_MESSAGE_REQUIRED'});if(message.length>250)return res.status(400).json({error:'MESSAGE_TOO_LONG'});const recipient=db.prepare("SELECT id,name FROM users WHERE id=? AND status='Active'").get(recipientUserId);if(!recipient)return res.status(404).json({error:'RECIPIENT_NOT_FOUND'});const row=createNotification({recipientUserId,senderUserId:req.user.id,type:'DIRECT_MESSAGE',titleEn:`Message from ${req.user.name}`,titleHu:`Üzenet érkezett: ${req.user.name}`,bodyEn:message,bodyHu:message,customMessage:message,metadata:{sender_name:req.user.name}});res.json(row);});

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
  if(body.estimated_hours!==undefined) body.estimated_hours=Number(body.estimated_hours||0);
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
  if(new Date(end)<=new Date(start)) return res.status(400).json({error:"End must be after start / A befejezés később legyen, mint a kezdés"});
  const conflicts=findScheduleConflicts(assigned,start,end);
  if(conflicts.length){
    const c=conflicts[0];
    return res.status(409).json({error:`Schedule conflict / Időpontütközés: ${assigned} already has ${c.title||c.job_key||c.id} between ${c.start_time} and ${c.end_time}.` , conflicts});
  }
  const jobId=rid("J");
  db.prepare(`INSERT INTO jobs(
    id,job_key,planned_job_id,parent_job_id,title,job_type,client_id,client_name,client_phone,piano_id,piano_name,
    assigned_user_id,assigned_to,created_by_user_id,created_by,priority,status,start_time,end_time,timezone,planned_amount,pricing_basis,
    planned_hours,travel_minutes,service_address,instructions
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    jobId,stableJobKey(),planned.id,null,title,"Standalone",planned.client_id||"",planned.client_name||"",planned.client_phone||"",planned.piano_id||"",planned.piano_name||"",
    assignedUser?.id||null,assigned,req.user.id,req.user.name,planned.priority||"Medium","Open",start,end,"America/New_York",Number(b.planned_amount||planned.expected_revenue||0),b.pricing_basis||"Converted from planned job / Tervezett munkából áthelyezve",
    Number(b.planned_hours||planned.estimated_hours||0),Number(b.travel_minutes||0),b.service_address||planned.service_address||"",b.instructions||planned.next_step||planned.notes||""
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

app.delete("/api/inventory/:id", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  const existing=db.prepare("SELECT * FROM inventory_items WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Inventory item not found / Leltári tétel nem található"});
  if(isSuperadminUser(req.user)) db.prepare("DELETE FROM inventory_items WHERE id=?").run(req.params.id);
  else db.prepare("UPDATE inventory_items SET status='Deleted', deleted_at=?, deleted_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nowISO(), req.user.name||"", req.params.id);
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

app.get("/api/finance/entries", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const rows=db.prepare("SELECT * FROM financial_items ORDER BY item_date DESC, created_at DESC").all();
  res.json(rows.map(r=>({...r,lines:[]})));
});

app.get("/api/financial-items", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const where=[];
  const params=[];
  const {month, main_type, recurrence, category}=req.query;
  if(month && /^\d{4}-\d{2}$/.test(month)){
    const start=`${month}-01`;
    const next=new Date(`${start}T00:00:00`);
    next.setMonth(next.getMonth()+1);
    const end=next.toISOString().slice(0,10);
    where.push("((recurrence='MONTHLY' AND item_date < ?) OR (recurrence!='MONTHLY' AND item_date >= ? AND item_date < ?))");
    params.push(end,start,end);
  }
  if(main_type){ where.push("main_type=?"); params.push(main_type); }
  if(recurrence){ where.push("recurrence=?"); params.push(recurrence); }
  if(category){ where.push("category=?"); params.push(category); }
  const sql=`SELECT * FROM financial_items ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY item_date DESC, created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

app.post("/api/financial-items", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const id=req.body.id || rid("FI");
  const item_date=req.body.item_date || today();
  const title=(req.body.title||"").trim();
  const amount=Number(req.body.amount||0);
  const main_type=req.body.main_type;
  const recurrence=req.body.recurrence || "ONE_TIME";
  if(!title) return res.status(400).json({error:"Title is required / Megnevezés kötelező"});
  if(!["INCOME","EXPENSE","ASSET","LIABILITY","EQUITY"].includes(main_type)) return res.status(400).json({error:"Invalid main type / Hibás fő típus"});
  if(!["ONE_TIME","MONTHLY"].includes(recurrence)) return res.status(400).json({error:"Invalid recurrence / Hibás ismétlődés"});
  if(Number.isNaN(amount) || amount<0) return res.status(400).json({error:"Amount must be a positive number / Az összeg nem lehet negatív"});
  db.prepare(`INSERT INTO financial_items(
    id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,source_type,source_id,created_by
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,item_date,title,req.body.description||"",amount,main_type,req.body.category||"",recurrence,req.body.payment_method||"",req.body.balance_account||"",req.body.job_id||null,req.body.client_id||null,req.body.piano_id||null,req.body.source_type||null,req.body.source_id||null,req.user.name
  );
  res.json(db.prepare("SELECT * FROM financial_items WHERE id=?").get(id));
});

app.put("/api/financial-items/:id", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const existing=db.prepare("SELECT * FROM financial_items WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Financial item not found / Pénzügyi tétel nem található"});
  const allowed=["item_date","title","description","amount","main_type","category","recurrence","payment_method","balance_account","job_id","client_id","piano_id","source_type","source_id"];
  const body={...req.body};
  if(body.amount!==undefined) body.amount=Number(body.amount||0);
  if(body.main_type!==undefined && !["INCOME","EXPENSE","ASSET","LIABILITY","EQUITY"].includes(body.main_type)) return res.status(400).json({error:"Invalid main type / Hibás fő típus"});
  if(body.recurrence!==undefined && !["ONE_TIME","MONTHLY"].includes(body.recurrence)) return res.status(400).json({error:"Invalid recurrence / Hibás ismétlődés"});
  const cols=allowed.filter(c=>body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE financial_items SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>body[c]),req.params.id);
  res.json(db.prepare("SELECT * FROM financial_items WHERE id=?").get(req.params.id));
});

app.delete("/api/financial-items/:id", auth, requireSuperadmin, (req,res)=>{
  db.prepare("DELETE FROM financial_items WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

function financialItemsForMonth(month){
  const monthStart = `${month}-01`;
  const nextMonth = new Date(`${monthStart}T00:00:00`);
  nextMonth.setMonth(nextMonth.getMonth()+1);
  const monthEnd = nextMonth.toISOString().slice(0,10);
  const rows=db.prepare(`
    SELECT * FROM financial_items
    WHERE (recurrence='MONTHLY' AND item_date < ?)
       OR (recurrence!='MONTHLY' AND item_date >= ? AND item_date < ?)
    ORDER BY item_date, created_at
  `).all(monthEnd,monthStart,monthEnd);
  return {monthStart,monthEnd,rows};
}

function incomeStatementPayload(month){
  if(!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must be YYYY-MM");
  const {monthStart,monthEnd,rows}=financialItemsForMonth(month);
  const closedJobs=db.prepare(`SELECT * FROM jobs WHERE status='Completed' AND completed_at >= ? AND completed_at < ?`).all(monthStart,monthEnd);
  const openJobs=db.prepare("SELECT COUNT(*) c FROM jobs WHERE status!='Completed' OR status IS NULL").get().c;

  const incomeItems=rows.filter(x=>x.main_type==='INCOME');
  const expenseItems=rows.filter(x=>x.main_type==='EXPENSE');
  const passiveIncome=incomeItems.filter(x=>x.recurrence==='MONTHLY').reduce((s,x)=>s+Number(x.amount||0),0);
  const oneTimeIncome=incomeItems.filter(x=>x.recurrence!=='MONTHLY').reduce((s,x)=>s+Number(x.amount||0),0);
  const revenue=passiveIncome+oneTimeIncome;
  const recurringExpenses=expenseItems.filter(x=>x.recurrence==='MONTHLY').reduce((s,x)=>s+Number(x.amount||0),0);
  const oneTimeExpenses=expenseItems.filter(x=>x.recurrence!=='MONTHLY').reduce((s,x)=>s+Number(x.amount||0),0);
  const expenses=recurringExpenses+oneTimeExpenses;

  const accounts={};
  function account(code,name_en,name_hu,category){
    if(!accounts[code]) accounts[code]={code,name_en,name_hu,category,debit_total:0,credit_total:0,balance:0};
    return accounts[code];
  }
  const categoryNames={
    SERVICE_REVENUE:["Service Revenue","Szolgáltatási bevétel","REVENUE"],
    PIANO_SALE:["Piano Sale Revenue","Zongoraeladás bevétele","REVENUE"],
    PASSIVE_REVENUE:["Recurring Revenue","Ismétlődő bevétel","REVENUE"],
    OTHER_INCOME:["Other Income","Egyéb bevétel","REVENUE"],
    MATERIALS:["Materials Expense","Anyagköltség","EXPENSE"],
    CONTRACTOR:["Contractor Labor","Alvállalkozói munkadíj","EXPENSE"],
    TRANSPORT:["Transportation","Szállítás","EXPENSE"],
    RENT:["Rent","Bérleti díj","EXPENSE"],
    INSURANCE:["Insurance","Biztosítás","EXPENSE"],
    TAX:["Taxes","Adók","EXPENSE"],
    OTHER_EXPENSE:["Other Expense","Egyéb kiadás","EXPENSE"],
    CASH:["Cash","Készpénz","ASSET"],
    BANK:["Bank Account","Bankszámla","ASSET"],
    CHECKS:["Undeposited Checks","Befizetés előtti csekkek","ASSET"],
    AR:["Accounts Receivable","Vevőkövetelés","ASSET"],
    INVENTORY:["Inventory","Készlet","ASSET"],
    COMPANY_PIANOS:["Company Pianos","Céges zongorák","ASSET"],
    TOOLS:["Tools and Equipment","Szerszámok és berendezések","ASSET"],
    OTHER_ASSET:["Other Assets","Egyéb eszközök","ASSET"],
    LOAN:["Loans Payable","Hitelek","LIABILITY"],
    BANK_LOAN:["Bank Loan","Bankkölcsön","LIABILITY"],
    INSURANCE_LIABILITY:["Insurance Liabilities","Biztosítási kötelezettségek","LIABILITY"],
    OTHER_LONG_TERM_SOURCE:["Other Long-Term Sources","Egyéb hosszú lejáratú források","LIABILITY"],
    AP:["Accounts Payable","Szállítói tartozás","LIABILITY"],
    CHECK_PAYABLE:["Check Payables","Csekkes tartozás","LIABILITY"],
    RENT_PAYABLE:["Rent","Bérleti díj","LIABILITY"],
    UTILITIES_PAYABLE:["Utilities","Rezsi","LIABILITY"],
    SHORT_TERM_OPERATING:["Short-Term Operating Expenses","Rövid lejáratú működési kiadások","LIABILITY"],
    OTHER_SHORT_TERM_SOURCE:["Other Short-Term Sources","Egyéb rövid lejáratú források","LIABILITY"],
    OWNER_EQUITY:["Owner Equity","Saját tőke","EQUITY"],
    OTHER_SOURCE:["Other Sources","Egyéb forrás","EQUITY"]
  };
  const accountOrder={
    REVENUE:0,EXPENSE:100,ASSET:200,LIABILITY:300,EQUITY:400,
    SERVICE_REVENUE:1,PIANO_SALE:2,PASSIVE_REVENUE:3,OTHER_INCOME:20,
    TAX:101,MATERIALS:102,CONTRACTOR:103,TRANSPORT:104,RENT:105,INSURANCE:106,OTHER_EXPENSE:130,
    CASH:201,BANK:202,CHECKS:203,AR:204,INVENTORY:205,COMPANY_PIANOS:206,TOOLS:207,OTHER_ASSET:230,
    LOAN:301,BANK_LOAN:302,INSURANCE_LIABILITY:303,OTHER_LONG_TERM_SOURCE:304,AP:321,CHECK_PAYABLE:322,RENT_PAYABLE:323,UTILITIES_PAYABLE:324,SHORT_TERM_OPERATING:325,OTHER_SHORT_TERM_SOURCE:340,
    OWNER_EQUITY:401,OTHER_SOURCE:420
  };
  function addBalance(code, amount, preferredCategory){
    const n=categoryNames[code] || [code,code,preferredCategory||"ASSET"];
    const categoryOverride = preferredCategory && !categoryNames[code] ? preferredCategory : n[2];
    const a=account(code,n[0],n[1],categoryOverride);
    a.balance += Math.abs(Number(amount||0));
    if(Number(amount||0)>=0) a.debit_total += Math.abs(Number(amount||0)); else a.credit_total += Math.abs(Number(amount||0));
  }
  function expenseSourceAccount(item){
    const code=String(item.balance_account||"").trim();
    const meta=categoryNames[code];
    if(meta && (meta[2]==="LIABILITY" || meta[2]==="EQUITY")) return code;
    const cat=String(item.category||"").trim();
    if(cat==="RENT") return "RENT_PAYABLE";
    if(cat==="INSURANCE") return "INSURANCE_LIABILITY";
    if(cat==="TAX" || cat==="MATERIALS" || cat==="CONTRACTOR" || cat==="TRANSPORT") return "SHORT_TERM_OPERATING";
    return "OTHER_SHORT_TERM_SOURCE";
  }
  rows.forEach(x=>{
    const amount=Number(x.amount||0);
    if(x.main_type==='INCOME'){
      addBalance(x.category || (x.recurrence==='MONTHLY'?'PASSIVE_REVENUE':'SERVICE_REVENUE'), amount, 'REVENUE');
      if(x.balance_account) addBalance(x.balance_account, amount, 'ASSET');
    } else if(x.main_type==='EXPENSE'){
      addBalance(x.category || 'OTHER_EXPENSE', amount, 'EXPENSE');
      addBalance(expenseSourceAccount(x), amount, 'LIABILITY');
    } else if(x.main_type==='ASSET'){
      addBalance(x.category || x.balance_account || 'OTHER_ASSET', amount, 'ASSET');
    } else if(x.main_type==='LIABILITY'){
      addBalance(x.category || 'OTHER_SOURCE', amount, 'LIABILITY');
    } else if(x.main_type==='EQUITY'){
      addBalance(x.category || 'OWNER_EQUITY', amount, 'EQUITY');
    }
  });
  const trialBalance=Object.values(accounts).sort((a,b)=>(accountOrder[a.code]??999)-(accountOrder[b.code]??999));
  const assets=trialBalance.filter(a=>a.category==='ASSET').reduce((s,a)=>s+Number(a.balance||0),0);
  const liabilities=trialBalance.filter(a=>a.category==='LIABILITY').reduce((s,a)=>s+Number(a.balance||0),0);
  const equity=trialBalance.filter(a=>a.category==='EQUITY').reduce((s,a)=>s+Number(a.balance||0),0);
  const sources=liabilities+equity;
  return {
    month,monthStart,monthEndExclusive:monthEnd,generatedAt:new Date().toISOString(),
    accountingLogic:{source:"financial_items",generalLedger:"simple_internal_finance_register"},
    counts:{openJobs,closedJobs:closedJobs.length,financialItems:rows.length},
    totals:{passiveIncome,oneTimeIncome,revenue,recurringExpenses,oneTimeExpenses,expenses,profit:revenue-expenses,assets,liabilities,equity,sources,netWorth:assets-sources},
    trialBalance,
    items:rows
  };
}

app.get("/api/income-statement/monthly", auth, (req,res)=>{
  try{ res.json(incomeStatementPayload(req.query.month || today().slice(0,7))); }
  catch(e){ res.status(400).json({error:e.message}); }
});

app.get("/api/income-statement", auth, (req,res)=>{
  try{ res.json(incomeStatementPayload(today().slice(0,7))); }
  catch(e){ res.status(400).json({error:e.message}); }
});

app.get("/api/users", auth, (req,res)=> {
  // Hidden superadmin is never listed. Everyone may see the visible team list.
  res.json(db.prepare("SELECT id,name,email,role,status,phone,address,created_at FROM users WHERE COALESCE(hidden_user,0)=0 ORDER BY role,name").all());
});

app.post("/api/users", auth, requirePermission("users.create"), (req,res)=>{
  const {name,email,password,role}=req.body;
  if(!name || !email || !password || !role) return res.status(400).json({error:"Name, email, password and role are required"});
  if(role==="SUPERADMIN") return res.status(403).json({error:"Superadmin cannot be created from UI / Szuperadmin nem hozható létre a felületről"});
  const id=rid("U");
  const hash=bcrypt.hashSync(password,10);
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,phone,address,hidden_user,is_superadmin) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(id,name,email,hash,role,"Active",req.body.phone||"",req.body.address||"",0,0);
  const created={id,name,email,role,status:"Active",phone:req.body.phone||"",address:req.body.address||""};
  db.prepare("INSERT OR IGNORE INTO notification_preferences(user_id,push_enabled,job_assigned,job_transferred,job_updated,job_deleted,one_hour_reminder,direct_message) VALUES(?,1,1,1,1,1,1,1)").run(id);
  audit(req,"CREATE","users",id,null,created);
  res.json(created);
});

app.put("/api/users/:id", auth, (req,res)=>{
  const target=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if(!target) return res.status(404).json({error:"User not found"});
  if(Number(target.hidden_user||0)===1 && !isSuperadminUser(req.user)) return res.status(403).json({error:"Hidden system owner cannot be edited"});

  const selfEdit = req.user.id === target.id;
  const superEdit = isSuperadminUser(req.user);
  const roleAdmin = hasPermission(req.user,"users.roles");
  if(!selfEdit && !superEdit && !roleAdmin) return res.status(403).json({error:"PERMISSION_DENIED"});

  let allowed = (superEdit || roleAdmin) ? ["name","email","role","status","phone","address"] : ["name","email","phone","address"];
  if(!superEdit && !roleAdmin && (req.body.role!==undefined || req.body.status!==undefined)) return res.status(403).json({error:"PERMISSION_DENIED"});
  if(req.body.role==="SUPERADMIN") return res.status(403).json({error:"Cannot promote visible user to hidden superadmin from UI"});

  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(req.body.password){ cols.push("password_hash"); req.body.password_hash=bcrypt.hashSync(req.body.password,10); }
  const updateUserTx=db.transaction(()=>{
    if(cols.length) db.prepare(`UPDATE users SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]),req.params.id);
    if(req.body.name!==undefined && String(req.body.name)!==String(target.name)){
      db.prepare("UPDATE jobs SET assigned_to=? WHERE assigned_user_id=?").run(req.body.name,target.id);
      db.prepare("UPDATE jobs SET created_by=? WHERE created_by_user_id=?").run(req.body.name,target.id);
      db.prepare("UPDATE jobs SET last_reassigned_by=? WHERE last_reassigned_by_user_id=?").run(req.body.name,target.id);
      db.prepare("UPDATE planned_jobs SET preferred_assigned_to=? WHERE preferred_assigned_user_id=?").run(req.body.name,target.id);
      db.prepare("UPDATE planned_jobs SET created_by=? WHERE created_by_user_id=?").run(req.body.name,target.id);
    }
  });
  updateUserTx();
  const u=db.prepare("SELECT id,name,email,role,status,phone,address FROM users WHERE id=?").get(req.params.id);
  audit(req,"UPDATE","users",req.params.id,target,u);
  res.json(u);
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
    const known=['INVALID_XLSX_STRUCTURE','IMPORT_READY_SHEET_MISSING','IMPORT_READY_EMPTY','MISSING_COLUMNS'];
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

  const commitImport=db.transaction(()=>{
    const existing=db.prepare('SELECT id,name,email,phone,address,external_reference,import_source FROM contacts').all();
    const exactRefs=new Map(existing.filter(x=>x.import_source&&x.external_reference).map(x=>[`${x.import_source}::${x.external_reference}`,x]));
    const existingEmails=new Map(); const existingPhones=new Map(); const existingNameAddress=new Map();
    for(const c of existing){
      for(const e of normalizeEmailList(c.email))if(!existingEmails.has(e))existingEmails.set(e,c);
      for(const p of normalizePhones(c.phone))if(!existingPhones.has(p))existingPhones.set(p,c);
      const key=`${normalizeText(c.name)}::${normalizeText(c.address)}`;
      if(normalizeText(c.name)&&normalizeText(c.address)&&!existingNameAddress.has(key))existingNameAddress.set(key,c);
    }

    const idRows=db.prepare("SELECT id FROM contacts WHERE id LIKE 'C-%'").all();
    let maxId=0;
    for(const row of idRows){const m=String(row.id||'').match(/^C-(\d{1,5})$/);if(m)maxId=Math.max(maxId,Number(m[1]));}
    const nextImportContactId=()=>{maxId+=1;if(maxId>99999)throw new Error('CONTACT_ID_LIMIT_REACHED');return `C-${String(maxId).padStart(5,'0')}`;};

    const insert=db.prepare(`INSERT INTO contacts(
      id,name,company,type,email,phone,address,billing_address,priority,status,owner,relationship_holder,loss_risk,last_contact,next_step,notes,
      has_piano,interested_buying,external_reference,import_source,import_batch_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    let importedClients=0, skippedDuplicates=0, missingDataClients=0, failedRows=0;
    const skipped=[];
    for(const rec of records){
      if(rec.category!=='NEW'){skippedDuplicates+=1;continue;}
      if(!String(rec.name||'').trim() || !String(rec.externalReference||'').trim()){failedRows+=1;continue;}
      const refKey=`${source}::${rec.externalReference}`;
      let match=exactRefs.get(refKey);
      let reason=match?'EXTERNAL_REFERENCE_MATCH':'';
      if(!match){
        match=normalizeEmailList(rec.email).map(e=>existingEmails.get(e)).find(Boolean);
        if(match)reason='EMAIL_MATCH';
      }
      if(!match){
        match=normalizePhones(rec.phone).map(p=>existingPhones.get(p)).find(Boolean);
        if(match)reason='PHONE_MATCH';
      }
      if(!match){
        match=existingNameAddress.get(`${normalizeText(rec.name)}::${normalizeText(rec.serviceAddress)}`);
        if(match)reason='NAME_ADDRESS_MATCH';
      }
      if(match){skippedDuplicates+=1;skipped.push({externalReference:rec.externalReference,name:rec.name,reason,matchId:match.id});continue;}

      const id=nextImportContactId();
      const status='Active';
      insert.run(
        id,String(rec.name||'').trim(),'','General',String(rec.email||'').trim(),String(rec.phone||'').trim(),String(rec.serviceAddress||'').trim(),String(rec.billingAddress||'').trim(),
        'Medium',status,'',String(rec.contactFullName||'').trim(),'Unknown',rec.lastContact||null,String(rec.nextStep||'').trim(),String(rec.notes||'').trim(),
        0,0,String(rec.externalReference||'').trim(),source,batchId
      );
      const added={id,name:rec.name,email:rec.email,phone:rec.phone,address:rec.serviceAddress,external_reference:rec.externalReference,import_source:source};
      exactRefs.set(refKey,added);
      for(const e of normalizeEmailList(rec.email))if(!existingEmails.has(e))existingEmails.set(e,added);
      for(const p of normalizePhones(rec.phone))if(!existingPhones.has(p))existingPhones.set(p,added);
      const nameAddressKey=`${normalizeText(rec.name)}::${normalizeText(rec.serviceAddress)}`;
      if(normalizeText(rec.name)&&normalizeText(rec.serviceAddress)&&!existingNameAddress.has(nameAddressKey))existingNameAddress.set(nameAddressKey,added);
      importedClients+=1;
      if(rec.hasMissingData)missingDataClients+=1;
    }

    const result={
      batchId,source,filename:batch.original_filename,totalRows:records.length,importedClients,missingDataClients,skippedDuplicates,failedRows,skipped
    };
    db.prepare(`UPDATE import_batches SET status='COMPLETED',imported_clients=?,skipped_duplicates=?,missing_data_clients=?,failed_rows=?,completed_at=CURRENT_TIMESTAMP,summary_json=? WHERE id=? AND status='PREVIEW'`)
      .run(importedClients,skippedDuplicates,missingDataClients,failedRows,JSON.stringify(result),batchId);
    return result;
  });

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

const pianoImportUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024},fileFilter:(req,file,cb)=>cb(null,/\.xlsx$/i.test(file.originalname||''))});
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
    const id=req.body.id || (key==="contacts" ? nextContactId() : rid(prefix));
    const cols=["id",...write].filter(c=>c==="id" || req.body[c]!==undefined);
    db.prepare(`INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...cols.map(c=>c==="id"?id:req.body[c]));
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id));
  });
  app.put(`/api/${key}/:id`, auth, permit(...roles), (req,res)=>{
    const cols=write.filter(c=>req.body[c]!==undefined);
    if(cols.length) db.prepare(`UPDATE ${table} SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]), req.params.id);
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id));
  });
  app.delete(`/api/${key}/:id`, auth, requireSuperadmin, (req,res)=>{
    if(key==="contacts"){
      db.prepare("UPDATE pianos SET owner_contact_id=NULL,owner_resolution='UNIDENTIFIED_OWNER',ownership='Unknown',ownership_type='Unknown',updated_at=CURRENT_TIMESTAMP WHERE owner_contact_id=?").run(req.params.id);
    }
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    res.json({ok:true});
  });
}
createResourceRoutes("contacts","contacts","C",["name","company","type","email","phone","address","billing_address","priority","status","owner","relationship_holder","loss_risk","last_contact","next_step","notes","has_piano","interested_buying","interest_brand","interest_model","interest_budget","interest_timeline","interest_notes","external_reference","import_source","import_batch_id"],["ADMIN","MANAGER","WORKER"]);

app.get("/api/pianos", auth, (req,res)=>{
  const rows=db.prepare(`
    SELECT p.*,
           c.name AS owner_name,
           c.name AS client_name,
           c.address AS owner_address
    FROM pianos p
    LEFT JOIN contacts c ON c.id = p.owner_contact_id
    ORDER BY p.display_name, p.brand, p.model
  `).all();
  res.json(rows);
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
  const count=db.prepare("SELECT COUNT(*) AS c FROM pianos WHERE owner_contact_id=?").get(clientId).c;
  db.prepare("UPDATE contacts SET has_piano=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(count>0?1:0,clientId);
}
app.post("/api/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const id=req.body.id || rid("P");
  const brand=req.body.brand || "";
  const model=req.body.model || "";
  const display=req.body.display_name || `${brand} ${model}`.trim() || req.body.original_description || req.body.piano_name || "Unknown piano";
  const ownerContactId=req.body.owner_contact_id||null;
  const ownershipType=ownerContactId?"Customer owned":(req.body.ownership_type || req.body.ownership || "Unknown");
  const estimated=Number(req.body.estimated_value||0);
  const resolution=pianoOwnerResolution(ownerContactId,ownershipType);
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,year,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes,external_reference,import_source,import_batch_id,original_description,owner_resolution)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,brand,model,req.body.serial_no||"",req.body.year||null,ownershipType,ownershipType,display,ownerContactId,req.body.location||"",estimated,req.body.status||"Active",req.body.notes||"",req.body.external_reference||null,req.body.import_source||null,req.body.import_batch_id||null,req.body.original_description||null,resolution);
  refreshClientHasPiano(ownerContactId);
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(id);
  res.json(piano);
});

app.put("/api/pianos/:id", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const before=db.prepare("SELECT * FROM pianos WHERE id=?").get(req.params.id);
  if(!before)return res.status(404).json({error:"Piano not found"});
  const allowed=["brand","model","serial_no","year","ownership","ownership_type","display_name","owner_contact_id","location","estimated_value","status","notes","external_reference","import_source","import_batch_id","original_description","owner_resolution"];
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE pianos SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]), req.params.id);
  if(req.body.owner_contact_id!==undefined || req.body.ownership_type!==undefined){
    const ownerContactId=req.body.owner_contact_id!==undefined?(req.body.owner_contact_id||null):(before.owner_contact_id||null);
    const requestedOwnership=req.body.ownership_type!==undefined?req.body.ownership_type:(before.ownership_type||before.ownership||"Unknown");
    const ownershipType=ownerContactId?"Customer owned":requestedOwnership;
    const resolution=pianoOwnerResolution(ownerContactId,ownershipType);
    db.prepare("UPDATE pianos SET owner_contact_id=?,owner_resolution=?,ownership=?,ownership_type=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(ownerContactId,resolution,ownershipType,ownershipType,req.params.id);
    refreshClientHasPiano(before.owner_contact_id);
    refreshClientHasPiano(ownerContactId);
  }
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(req.params.id);
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
  const piano=db.prepare("SELECT owner_contact_id FROM pianos WHERE id=?").get(req.params.id);
  db.prepare("DELETE FROM pianos WHERE id=?").run(req.params.id);
  refreshClientHasPiano(piano?.owner_contact_id);
  res.json({ok:true});
});

createResourceRoutes("knowledge_base","knowledge_base","KB",["job_id","title","category","content_type","body","stored_path","owner","amount","payment_method","invoice_number","priority"],["ADMIN","MANAGER","WORKER"]);

app.get("/api/client-profile/:id", auth, (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  const pianos=db.prepare("SELECT * FROM pianos WHERE owner_contact_id=? ORDER BY created_at DESC").all(req.params.id);
  const jobs=db.prepare(jobsSelectSql("WHERE j.client_id=? OR j.client_name=? ORDER BY j.start_time DESC LIMIT 50")).all(req.params.id, client.name);
  res.json({client,pianos,jobs,lastVisit:jobs[0]?.start_time || client.last_contact || "",lastJob:jobs[0]?.title || ""});
});

app.get("/api/jobs", auth, (req,res)=>{
  res.json(db.prepare(jobsSelectSql("ORDER BY j.start_time")).all());
});
app.post("/api/jobs", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  for(const r of ["title","start_time","end_time"]) if(!req.body[r]) return res.status(400).json({error:`${r} is required`});
  const assigned=resolveActiveUser(req.body.assigned_user_id,req.body.assigned_to);
  if(!assigned) return res.status(400).json({error:"A valid responsible user is required / Érvényes felelős munkatárs szükséges"});
  const id=req.body.id || rid("J");
  const data={...req.body,assigned_user_id:assigned.id,assigned_to:assigned.name,created_by_user_id:req.user.id,created_by:req.user.name};
  data.workflow_root_id=data.workflow_root_id||id;
  data.workflow_step_no=Number(data.workflow_step_no||1);
  data.workflow_status=data.workflow_status||"ACTIVE";
  const cols=["id","job_key","parent_job_id","workflow_root_id","workflow_step_no","workflow_status","title","job_type","client_id","client_name","client_phone","piano_id","piano_name","assigned_user_id","assigned_to","created_by_user_id","created_by","priority","status","start_time","end_time","timezone","planned_amount","pricing_basis","planned_hours","travel_minutes","service_address","instructions","planned_job_id"]
    .filter(c=>c==="id" || c==="job_key" || data[c]!==undefined);
  db.prepare(`INSERT INTO jobs(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...cols.map(c=>c==="id"?id:(c==="job_key"?(data.job_key||stableJobKey()):data[c])));
  const created=db.prepare(jobsSelectSql("WHERE j.id=?")).get(id);
  workAudit(req,'CREATE',id,null,created,1,`retroactive=${new Date(created.start_time).getTime()<Date.now()}`);
  notifyAssigned(created,req.user,'JOB_ASSIGNED');
  res.json(created);
});
app.put("/api/jobs/:id", auth, (req,res)=>{
  const jobId = req.params.id || req.body.id || req.body.job_id || req.body.job_key;
  const job=getJobByAnyId(jobId, req.body);
  if(!job) return res.status(404).json({error:`Job not found. id/job_key: ${String(jobId||"").trim()}`});

  // Operational scheduling rule:
  // everyone may change the responsible person and operational details.
  // Operatív szabály: mindenki átadhatja / visszaveheti / továbbadhatja a munkát.
  const allowed=[
    "title","job_type","client_id","client_name","client_phone",
    "piano_id","piano_name","assigned_user_id","assigned_to","priority","status",
    "start_time","end_time","planned_amount","pricing_basis",
    "planned_hours","travel_minutes","service_address","instructions"
  ];

  if(req.body.job_type==="Part-work" && (!req.body.instructions || !String(req.body.instructions).trim())){
    return res.status(400).json({error:"Remaining tasks are required for part-work / Részmunka esetén a hátralévő feladatok megadása kötelező"});
  }

  if(req.body.assigned_user_id!==undefined || req.body.assigned_to!==undefined){
    const assigned=resolveActiveUser(req.body.assigned_user_id,req.body.assigned_to);
    if(!assigned) return res.status(400).json({error:"A valid responsible user is required / Érvényes felelős munkatárs szükséges"});
    req.body.assigned_user_id=assigned.id; req.body.assigned_to=assigned.name;
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

  const updated=db.prepare(jobsSelectSql("WHERE j.id=?")).get(job.id);
  workAudit(req,'UPDATE',job.id,job,updated,1,`retroactive=${new Date(updated.start_time).getTime()<Date.now()}; closed_before=${['Completed','Partially completed','Failed'].includes(String(job.status||''))}`);
  const assigneeChanged=String(job.assigned_user_id||'')!==String(updated.assigned_user_id||'');
  if(assigneeChanged) notifyAssigned(updated,req.user,'JOB_TRANSFERRED');
  else {
    const changes=[];
    if(job.start_time!==updated.start_time||job.end_time!==updated.end_time)changes.push('time');
    if(job.client_id!==updated.client_id||job.client_name!==updated.client_name)changes.push('client');
    if(job.service_address!==updated.service_address)changes.push('location');
    if(job.priority!==updated.priority)changes.push('priority');
    if(job.title!==updated.title||job.instructions!==updated.instructions)changes.push('details');
    if(changes.length && updated.assigned_user_id && String(updated.assigned_user_id)!==String(req.user.id)) createNotification({recipientUserId:updated.assigned_user_id,senderUserId:req.user.id,type:'JOB_UPDATED',job:updated,eventKey:`JOB_UPDATED:${updated.id}:${updated.updated_at}:${changes.join('-')}`,titleEn:'Your assigned job was updated',titleHu:'Módosították a hozzád rendelt munkát',bodyEn:`${jobDescription(updated)} · Changed: ${changes.join(', ')}`,bodyHu:`${jobDescription(updated)} · Módosult: ${changes.join(', ')}`,metadata:{changes}});
  }
  res.json(updated);
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

  db.prepare("UPDATE jobs SET assigned_user_id=?, assigned_to=?, last_reassigned_by_user_id=?, last_reassigned_by=?, reassignment_note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(assigned.id,assigned.name,req.user.id,req.user.name,req.body.reassignment_note||"",job.id);

  const updated=db.prepare(jobsSelectSql("WHERE j.id=?")).get(job.id);
  workAudit(req,'REASSIGN',job.id,job,updated,1,`from=${job.assigned_to||''}; to=${updated.assigned_to||''}`);
  notifyAssigned(updated,req.user,'JOB_TRANSFERRED');
  res.json(updated);
});

app.delete("/api/jobs/:id", auth, requireSuperadmin, (req,res)=>{
  const job=getJobByAnyId(req.params.id, req.body||{});
  if(!job) return res.status(404).json({error:"Job not found"});
  const logs=db.prepare("SELECT id FROM job_logs WHERE job_id=?").all(job.id);
  db.prepare("DELETE FROM financial_items WHERE job_id=? OR (source_type='closed_job' AND source_id=?)").run(job.id, job.id);
  db.prepare("DELETE FROM knowledge_base WHERE job_id=?").run(job.id);
  db.prepare("DELETE FROM job_logs WHERE job_id=?").run(job.id);
  db.prepare("DELETE FROM jobs WHERE parent_job_id=?").run(job.id);
  db.prepare("DELETE FROM jobs WHERE id=?").run(job.id);
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

app.post("/api/jobs/:id/close", auth, upload.single("file"), (req,res)=>{
  if(req.file && !validMagic(req.file.path)){ try{fs.unlinkSync(req.file.path)}catch(e){} return res.status(400).json({error:"INVALID_FILE_TYPE"}); }
  const jobId=req.params.id || req.body.id || req.body.job_id || req.body.job_key;
  const job=getJobByAnyId(jobId,req.body);
  if(!job) return res.status(404).json({error:`Job not found. id/job_key: ${String(jobId||"").trim()}`});
  if(!canCloseJob(req.user,job)) return res.status(403).json({error:`You cannot close this job because it is currently assigned to ${job.assigned_to}. / Nem zárhatod le ezt a munkát, mert jelenleg ${job.assigned_to} a felelős.`});

  const closeType=String(req.body.close_type||"");
  if(!["Partial","Full","Failed"].includes(closeType)) return res.status(400).json({error:"Close type must be Partial, Full or Failed"});
  const billed=Number(req.body.billed_amount);
  if(Number.isNaN(billed)) return res.status(400).json({error:"Billed amount is required. Use 0 if not billable."});
  const desc=String(req.body.close_description||"").trim();
  if(!desc) return res.status(400).json({error:"Close description is required"});
  const payment=req.body.payment_method||"";
  if(billed>0&&!payment) return res.status(400).json({error:"Payment method is required when billed amount is greater than zero / Fizetési mód kötelező, ha az összeg nagyobb mint 0"});
  if(billed>0&&!req.file) return res.status(400).json({error:"Invoice/check file is required when billed amount is greater than zero"});
  const storedPath=req.file?"/uploads/"+path.basename(req.file.path):null;
  const rootId=job.workflow_root_id||job.id;

  try{
    const result=db.transaction(()=>{
      let nextJobId=null;
      if(closeType==="Partial"){
        const required=["next_title","next_assigned_user_id","next_start_time","next_end_time"];
        for(const r of required) if(!req.body[r]) throw new Error(`${r} is required for partial close`);
        const nextAssigned=resolveActiveUser(req.body.next_assigned_user_id,req.body.next_assigned_to);
        if(!nextAssigned) throw new Error("A valid next responsible user is required / Érvényes következő felelős szükséges");
        const maxStep=db.prepare("SELECT COALESCE(MAX(workflow_step_no),0) AS n FROM jobs WHERE workflow_root_id=? OR id=?").get(rootId,rootId)?.n||0;
        nextJobId=rid("J");
        db.prepare(`INSERT INTO jobs(
          id,job_key,parent_job_id,workflow_root_id,workflow_step_no,workflow_status,title,job_type,client_id,client_name,client_phone,piano_id,piano_name,
          assigned_user_id,assigned_to,created_by_user_id,created_by,priority,status,start_time,end_time,timezone,planned_amount,pricing_basis,
          planned_hours,travel_minutes,service_address,instructions
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          nextJobId,stableJobKey(),job.id,rootId,Number(maxStep)+1,"ACTIVE",req.body.next_title,"Part-work",job.client_id,job.client_name,job.client_phone,job.piano_id,job.piano_name,
          nextAssigned.id,nextAssigned.name,req.user.id,req.user.name,req.body.next_priority||job.priority,"Open",req.body.next_start_time,req.body.next_end_time,"America/New_York",
          Number(req.body.next_planned_amount||0),req.body.next_pricing_basis||"",Number(req.body.next_planned_hours||0),Number(req.body.next_travel_minutes||0),
          req.body.next_service_address||job.service_address,req.body.next_instructions||""
        );
        db.prepare(`UPDATE jobs SET status='Partially completed', close_type='Partial', workflow_root_id=?, workflow_status='IN_PROGRESS', billed_amount=?, payment_method=?, invoice_status=?, invoice_number=?, close_notes=?, completed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(rootId,billed,payment,billed>0?(req.body.invoice_status||"Invoiced"):"Not billable",req.body.invoice_number||"",desc,nowISO(),job.id);
      } else if(closeType==="Full"){
        const finalTime=nowISO();
        db.prepare(`UPDATE jobs SET status='Completed', workflow_root_id=?, workflow_status='COMPLETED', finalized_at=?, completed_at=COALESCE(completed_at,?), updated_at=CURRENT_TIMESTAMP WHERE id=? OR workflow_root_id=?`)
          .run(rootId,finalTime,finalTime,rootId,rootId);
        db.prepare(`UPDATE jobs SET close_type='Full', billed_amount=?, payment_method=?, invoice_status=?, invoice_number=?, close_notes=?, completed_at=?, finalized_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(billed,payment,billed>0?(req.body.invoice_status||"Invoiced"):"Not billable",req.body.invoice_number||"",desc,finalTime,finalTime,job.id);
      } else {
        db.prepare(`UPDATE jobs SET status='Failed', close_type='Failed', workflow_root_id=?, workflow_status='FAILED', billed_amount=?, payment_method=?, invoice_status=?, invoice_number=?, close_notes=?, completed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(rootId,billed,payment,billed>0?(req.body.invoice_status||"Invoiced"):"Not billable",req.body.invoice_number||"",desc,nowISO(),job.id);
      }

      const logId=rid("LOG");
      db.prepare(`INSERT INTO job_logs(id,job_id,log_type,description,billed_amount,payment_method,invoice_number,document_path,next_job_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(logId,job.id,closeType,desc,billed,payment,req.body.invoice_number||"",storedPath,nextJobId,req.user.name);
      db.prepare(`INSERT INTO knowledge_base(id,job_id,title,category,content_type,body,stored_path,owner,amount,payment_method,invoice_number,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(rid("KB"),job.id,`${closeType} close / ${closeType==="Full"?"Teljes lezárás":(closeType==="Failed"?"Sikertelen lezárás":"Részlezárás")}: ${job.title}`,closeType==="Full"?"Closed Job":(closeType==="Failed"?"Failed Job":"Partial Close"),"Job Record",desc,storedPath,req.user.name,billed,payment,req.body.invoice_number||"",job.priority);
      const financialItem=createFinancialItemForClosedJob(job,logId,billed,payment,req.user.name);
      return {nextJobId,financialItem};
    })();
    const updated=db.prepare(jobsSelectSql("WHERE j.id=?")).get(job.id);
    workAudit(req,closeType==='Partial'?'PARTIAL_CLOSE':(closeType==='Full'?'FULL_CLOSE':'FAILED_CLOSE'),job.id,job,updated,1,`workflow_root_id=${rootId}; next_job_id=${result.nextJobId||''}`);
    res.json({ok:true,next_job_id:result.nextJobId,storedPath,financial_item_id:result.financialItem?.id||null,workflow_root_id:rootId});
  }catch(err){
    if(req.file){try{fs.unlinkSync(req.file.path)}catch(e){}}
    res.status(400).json({error:err.message||"Close operation failed"});
  }
});

app.get("/api/contacts/:id/pianos", auth, (req,res)=>{
  res.json(db.prepare("SELECT * FROM pianos WHERE owner_contact_id=? ORDER BY display_name, brand, model").all(req.params.id));
});

app.post("/api/contacts/:id/link-piano", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  const pianoId=String(req.body.piano_id||"").trim();
  if(!pianoId) return res.status(400).json({error:"piano_id is required"});
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(pianoId);
  if(!piano) return res.status(404).json({error:"Piano not found"});
  db.prepare("UPDATE pianos SET owner_contact_id=?,owner_resolution='MATCHED_CLIENT',ownership='Customer owned',ownership_type='Customer owned',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(client.id,piano.id);
  db.prepare("UPDATE contacts SET has_piano=1, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(client.id);
  res.json(db.prepare("SELECT * FROM pianos WHERE id=?").get(piano.id));
});

app.post("/api/contacts/:id/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  const id=req.body.id || rid("P");
  const brand=req.body.brand || "";
  const model=req.body.model || "";
  const display=req.body.display_name || `${brand} ${model}`.trim() || req.body.piano_name || "Unknown piano";
  const ownershipType=req.body.ownership_type || "Customer owned";
  const estimated=Number(req.body.estimated_value||0);
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,brand,model,req.body.serial_no||"",ownershipType,ownershipType,display,client.id,req.body.location||client.address||"",estimated,"Active",req.body.notes||"");
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(id);
  res.json(piano);
});


app.get("/api/contacts/:id/pianos", auth, (req,res)=>{res.json(db.prepare("SELECT * FROM pianos WHERE owner_contact_id=? ORDER BY display_name, brand, model").all(req.params.id));});
app.put("/api/contacts/:id/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const ids = Array.isArray(req.body.piano_ids) ? req.body.piano_ids : [];
  db.prepare("UPDATE pianos SET owner_contact_id=NULL,owner_resolution='UNIDENTIFIED_OWNER',ownership='Unknown',ownership_type='Unknown',updated_at=CURRENT_TIMESTAMP WHERE owner_contact_id=?").run(req.params.id);
  const upd=db.prepare("UPDATE pianos SET owner_contact_id=?,owner_resolution='MATCHED_CLIENT',ownership='Customer owned',ownership_type='Customer owned',updated_at=CURRENT_TIMESTAMP WHERE id=?"); ids.forEach(id=>upd.run(req.params.id,id));
  res.json({ok:true,piano_ids:ids});
});
app.post("/api/contacts/:id/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  const id=req.body.id || rid("P"), brand=req.body.brand || "", model=req.body.model || "", display=req.body.display_name || `${brand} ${model}`.trim() || "Unknown piano";
  const ownershipType=req.body.ownership_type || "Customer owned", estimated=Number(req.body.estimated_value||0);
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,brand,model,req.body.serial_no||"",ownershipType,ownershipType,display,client.id,req.body.location||client.address||"",estimated,"Active","");
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(id);
  res.json(piano);
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
  res.json(rows);
});

















app.delete("/api/closed-jobs/:id", auth, requireSuperadmin, (req,res)=>{
  const log=db.prepare("SELECT * FROM job_logs WHERE id=?").get(req.params.id);
  if(!log) return res.status(404).json({error:"Closed job log not found"});
  db.prepare("DELETE FROM financial_items WHERE job_id=? OR (source_type='closed_job' AND source_id=?)").run(log.job_id, log.job_id);
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
app.get('/api/settings/permissions',auth,requirePermission('permissions.manage'),(req,res)=>{
  const roles=db.prepare("SELECT DISTINCT role FROM users WHERE COALESCE(hidden_user,0)=0 UNION SELECT DISTINCT role FROM role_permissions ORDER BY role").all().map(x=>x.role);
  const permissions=['scheduler.view','planned_jobs.view','contacts.view','pianos.view','closed_jobs.view','knowledge_base.view','finance.view','income_statement.view','inventory.view','users.view','users.create','users.roles','permissions.manage','audit.view'];
  const rows=db.prepare('SELECT role,permission,enabled FROM role_permissions').all();
  res.json({roles,permissions,rows});
});
app.put('/api/settings/permissions',auth,requirePermission('permissions.manage'),(req,res)=>{
  const {role,permission,enabled}=req.body||{};
  if(!role||!permission) return res.status(400).json({error:'REQUIRED_FIELDS'});
  if(role==='SUPERADMIN') return res.status(403).json({error:'SUPERADMIN_PERMISSIONS_FIXED'});
  const old=db.prepare('SELECT * FROM role_permissions WHERE role=? AND permission=?').get(role,permission);
  db.prepare(`INSERT INTO role_permissions(role,permission,enabled,updated_by,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(role,permission) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(role,permission,enabled?1:0,req.user.name||'');
  const now=db.prepare('SELECT * FROM role_permissions WHERE role=? AND permission=?').get(role,permission);
  audit(req,'UPDATE','permissions',`${role}:${permission}`,old,now); res.json(now);
});
app.get('/api/audit-log',auth,requirePermission('audit.view'),(req,res)=>{
  const limit=Math.min(Number(req.query.limit||500),2000); const type=String(req.query.type||'WORK').toUpperCase()==='TECHNICAL'?'TECHNICAL':'WORK';
  res.json(db.prepare("SELECT * FROM audit_log WHERE audit_type=? AND user_role<>'SUPERADMIN' ORDER BY event_time DESC LIMIT ?").all(type,limit));
});
app.get('/api/audit-log/export',auth,requireSuperadmin,(req,res)=>{
  const type=String(req.query.type||'WORK').toUpperCase()==='TECHNICAL'?'TECHNICAL':'WORK';
  const rows=db.prepare("SELECT * FROM audit_log WHERE audit_type=? AND user_role<>'SUPERADMIN' ORDER BY event_time DESC").all(type);
  const cols=['event_time','user_name','user_role','action','module','record_id','old_value','new_value','success','details']; const escCsv=v=>'"'+String(v??'').replaceAll('"','""')+'"'; const csv=[cols.join(','),...rows.map(r=>cols.map(c=>escCsv(r[c])).join(','))].join('\n'); res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${type==='WORK'?'work-audit':'technical-audit'}.csv"`);res.send('\ufeff'+csv);
});
app.delete('/api/audit-log',auth,requireSuperadmin,(req,res)=>{const type=String(req.query.type||'ALL').toUpperCase(); if(type==='WORK'||type==='TECHNICAL')db.prepare('DELETE FROM audit_log WHERE audit_type=?').run(type);else db.prepare('DELETE FROM audit_log').run();res.json({ok:true});});
app.get('/api/backups',auth,requireSuperadmin,(req,res)=>res.json(db.prepare('SELECT id,file_name,file_size,status,created_by,created_at,restored_at,restored_by FROM backup_log ORDER BY created_at DESC').all()));
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

  const tx=db.transaction(()=>{
    // Delete every business, import, audit, backup and configurable record.
    // Only the currently authenticated hidden superadmin account survives.
    [
      "journal_lines",
      "journal_entries",
      "accounts",
      "financial_items",
      "job_logs",
      "knowledge_base",
      "jobs",
      "planned_jobs",
      "inventory_checks",
      "inventory_items",
      "pianos",
      "contacts",
      "import_batches",
      "audit_log",
      "backup_log",
      "role_permissions",
      "app_settings",
      "notifications",
      "push_subscriptions",
      "notification_devices",
      "notification_preferences"
    ].forEach(clear);

    if(exists("users")){
      db.prepare("DELETE FROM users WHERE id<>?").run(superadminId);
      db.prepare("UPDATE users SET status='Active', hidden_user=1, is_superadmin=1, role='ADMIN' WHERE id=?").run(superadminId);
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
      const commonView=['scheduler.view','planned_jobs.view','contacts.view','pianos.view','closed_jobs.view','knowledge_base.view','inventory.view','users.view'];
      const defaults={
        ADMIN:[...commonView,'finance.view','income_statement.view','users.create','users.roles','permissions.manage','audit.view'],
        MANAGER:[...commonView,'finance.view','income_statement.view'],
        WORKER:[...commonView],
        VIEWER:[...commonView]
      };
      const insertPermission=db.prepare("INSERT INTO role_permissions(role,permission,enabled,updated_by) VALUES(?,?,1,'SYSTEM')");
      Object.entries(defaults).forEach(([role,permissions])=>permissions.forEach(permission=>insertPermission.run(role,permission)));
    }

    if(exists("sqlite_sequence")) db.prepare("DELETE FROM sqlite_sequence").run();
  });

  tx();

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

app.use((err,req,res,next)=>{
  if(err){ const code=err.code==="LIMIT_FILE_SIZE"?"FILE_TOO_LARGE":(err.message||"UPLOAD_ERROR"); return res.status(400).json({error:code}); }
  next();
});
generateOneHourReminders();
setInterval(generateOneHourReminders,5*60*1000).unref();
app.listen(PORT,()=>console.log(`Klavierhaus v6.4 notifications running on http://localhost:${PORT}; push=${PUSH_CONFIGURED?'configured':'not configured'}`));
