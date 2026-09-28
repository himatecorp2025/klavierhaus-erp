"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const compression = require("compression");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
require("dotenv").config();

const { createTransactionalEmail } = require("./transactional-email");
const { createAccountActivationService } = require("./account-activation");
const { registerEventRoutes } = require("./events");
const { registerWebsiteContentRoutes } = require("./website-content");
const { registerWebsiteCatalogRoutes } = require("./website-catalog");
const { registerWebsitePlatformRoutes } = require("./website-platform");
const { createStripeSandbox } = require("./stripe-sandbox");
const { createTicketService } = require("./ticket-service");
const {
  createBrandingUpload,
  createEventImageUpload,
  createWebsiteImageUpload,
  createCustomerConversationUpload,
  inspectImageFile,
  uploadErrorHandler
} = require("./upload-middleware");
const { registerRound1CoreRoutes } = require("./round1-core");
const { registerRound2WorkflowRoutes } = require("./round2-workflow");
const { registerRound3FinanceRoutes } = require("./round3-finance");
const { registerWebsiteConversationRoutes } = require("./website-conversations");

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3030);
const JWT_SECRET = String(process.env.JWT_SECRET || "");
if (JWT_SECRET.length < 32) throw new Error("JWT_SECRET is required and must be at least 32 characters long");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus_v6.sqlite");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const EVENT_IMAGE_DIR = path.join(UPLOAD_DIR, "events");
const WEBSITE_IMAGE_DIR = path.join(UPLOAD_DIR, "website");
for (const directory of [path.dirname(DB_PATH),UPLOAD_DIR,EVENT_IMAGE_DIR,WEBSITE_IMAGE_DIR]) fs.mkdirSync(directory,{recursive:true});

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const transactionalEmail = createTransactionalEmail(process.env);
const accountActivation = createAccountActivationService({ db, emailService: transactionalEmail });
const ticketService = createTicketService({ db });
const stripeSandbox = createStripeSandbox({ db, env: process.env, websiteBaseUrl: process.env.WEBSITE_BASE_URL, ticketService });

const brandingUpload = createBrandingUpload(UPLOAD_DIR);
const eventImageUpload = createEventImageUpload(EVENT_IMAGE_DIR);
const websiteImageUpload = createWebsiteImageUpload(WEBSITE_IMAGE_DIR);
const customerConversationUpload = createCustomerConversationUpload(UPLOAD_DIR);

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function validUserEmail(value) {
  return /^[^\s@]+@[^\s@]+$/.test(normalizeEmail(value));
}
function validContactEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}
function isSuperadmin(user) {
  return Boolean(user && (user.role === "SUPERADMIN" || Number(user.is_superadmin || 0) === 1));
}
function safeUser(row) {
  if (!row) return null;
  const superadmin = Number(row.is_superadmin || 0) === 1;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    contact_email: row.contact_email || "",
    role: superadmin ? "SUPERADMIN" : row.role,
    status: row.status,
    phone: row.phone || "",
    address: row.address || "",
    is_superadmin: superadmin ? 1 : 0,
    session_version: Number(row.session_version || 0)
  };
}
function auth(req,res,next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({error:"AUTH_REQUIRED"});
  try {
    const decoded = jwt.verify(token,JWT_SECRET);
    const row = db.prepare("SELECT * FROM users WHERE id=? AND status='Active'").get(decoded.id);
    if (!row || Number(decoded.session_version||0)!==Number(row.session_version||0)) return res.status(401).json({error:"SESSION_REVOKED"});
    req.user = safeUser(row);
    next();
  } catch (_error) {
    res.status(401).json({error:"INVALID_TOKEN"});
  }
}
function permit(...roles) {
  return (req,res,next) => {
    if (isSuperadmin(req.user) || roles.includes(req.user?.role)) return next();
    res.status(403).json({error:"PERMISSION_DENIED"});
  };
}
function requireSuperadmin(req,res,next) {
  if (isSuperadmin(req.user)) return next();
  res.status(403).json({error:"SUPERADMIN_REQUIRED"});
}
function audit(req,action,module,recordId,oldValue=null,newValue=null,success=1,details="") {
  try {
    db.prepare(`INSERT INTO audit_log(id,user_id,user_name,user_role,action,module,record_id,old_value,new_value,success,details,audit_type)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'TECHNICAL')`).run(
        newId("AUD"),req?.user?.id||"",req?.user?.name||"",req?.user?.role||"",String(action||""),String(module||""),String(recordId||""),
        oldValue==null?null:JSON.stringify(oldValue),newValue==null?null:JSON.stringify(newValue),success?1:0,String(details||"")
      );
  } catch (error) {
    console.warn("[AUDIT]",error.message);
  }
}
function setting(key,fallback="") {
  return db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(key)?.setting_value ?? fallback;
}
function setSetting(key,value,user="SYSTEM") {
  db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(key,String(value??""),user);
}
function getBranding() {
  return {
    company_name:setting("company_name","Klavierhaus"),
    short_name:setting("short_name","KH ERP"),
    logo_url:setting("logo_url","/icons/icon-512.png"),
    login_background_url:setting("login_background_url",""),
    branding_version:setting("branding_version","1")
  };
}
function bumpBranding(user){setSetting("branding_version",String(Date.now()),user||"SYSTEM");}

app.use(cors());
app.use(compression({threshold:1024}));

app.post("/api/webhooks/stripe",express.raw({type:"application/json",limit:"1mb"}),(req,res)=>stripeSandbox.handleWebhook(req,res));
app.post("/api/webhooks/resend",express.raw({type:"application/json",limit:"1mb"}),(req,res)=>{
  try {
    const payload=Buffer.isBuffer(req.body)?req.body.toString("utf8"):String(req.body||"");
    const event=transactionalEmail.verifyWebhook({
      payload,
      id:req.headers["svix-id"],
      timestamp:req.headers["svix-timestamp"],
      signature:req.headers["svix-signature"]
    });
    accountActivation.recordWebhook(event,String(req.headers["svix-id"]||""));
    res.json({received:true});
  } catch (error) {
    res.status(error?.code==="EMAIL_WEBHOOK_NOT_CONFIGURED"?503:400).json({error:error?.code==="EMAIL_WEBHOOK_NOT_CONFIGURED"?"EMAIL_WEBHOOK_NOT_CONFIGURED":"INVALID_EMAIL_WEBHOOK"});
  }
});

app.use(express.json({limit:"10mb"}));

app.get("/health",(_req,res)=>res.status(200).json({status:"ok",service:"klavierhaus-erp",architecture:"round3-closeout-finance"}));
app.get("/api/health",(_req,res)=>res.status(200).json({status:"ok"}));
app.get("/api/public/branding",(_req,res)=>res.json(getBranding()));
app.get("/manifest.webmanifest",(_req,res)=>{
  const branding=getBranding(),version=encodeURIComponent(branding.branding_version);
  res.type("application/manifest+json").send(JSON.stringify({
    name:branding.company_name,short_name:branding.short_name,start_url:"/",display:"standalone",
    background_color:"#f6f7f9",theme_color:"#111318",
    icons:[{src:`${branding.logo_url}${branding.logo_url.includes("?")?"&":"?"}v=${version}`,sizes:"192x192 512x512",type:/\.jpe?g(?:$|\?)/i.test(branding.logo_url)?"image/jpeg":"image/png",purpose:"any maskable"}]
  }));
});
app.use("/uploads",express.static(UPLOAD_DIR,{etag:true,lastModified:true,maxAge:"5m"}));
app.use(express.static(path.join(__dirname,"..","public"),{
  etag:true,lastModified:true,maxAge:"5m",
  setHeaders(res,filePath){if(/(?:index\.html|service-worker\.js|app\.js|styles\.css)$/i.test(filePath))res.setHeader("Cache-Control","no-cache");}
}));

const LOGIN_WINDOW_MS=15*60*1000;
const LOGIN_IP_LIMIT=20;
const LOGIN_ACCOUNT_LIMIT=7;
const loginBuckets=new Map();
const dummyHash=bcrypt.hashSync("klavierhaus-invalid-login-placeholder",10);
function rateKey(req,email){return [`ip:${String(req.ip||"unknown")}`,`account:${normalizeEmail(email)||"unknown"}`];}
function blocked(key,limit){
  const now=Date.now(),row=loginBuckets.get(key);
  if(!row||now-row.started>=LOGIN_WINDOW_MS){loginBuckets.set(key,{started:now,count:0});return false;}
  return row.count>=limit;
}
function recordFailure(req,email){for(const [key,limit] of [[rateKey(req,email)[0],LOGIN_IP_LIMIT],[rateKey(req,email)[1],LOGIN_ACCOUNT_LIMIT]]){const row=loginBuckets.get(key)||{started:Date.now(),count:0};if(Date.now()-row.started>=LOGIN_WINDOW_MS){row.started=Date.now();row.count=0;}row.count+=1;loginBuckets.set(key,row);}}
function sessionFor(row){
  const user=safeUser(row);
  return {user,token:jwt.sign({id:user.id,role:user.role,is_superadmin:user.is_superadmin,session_version:user.session_version},JWT_SECRET,{expiresIn:"30d"})};
}
function activationToken(row){
  const state=accountActivation.state(row.id);
  return jwt.sign({id:row.id,purpose:"ACCOUNT_ACTIVATION",activation_version:Number(state?.code_version||0)},JWT_SECRET,{expiresIn:"30m"});
}
function activationUser(token){
  const decoded=jwt.verify(String(token||""),JWT_SECRET);
  if(decoded?.purpose!=="ACCOUNT_ACTIVATION"||!decoded.id)throw new Error("INVALID_ACTIVATION_SESSION");
  const row=db.prepare("SELECT * FROM users WHERE id=? AND status='Active'").get(decoded.id);
  if(!row)throw new Error("INVALID_ACTIVATION_SESSION");
  return row;
}

app.post("/api/login",async(req,res)=>{
  const email=normalizeEmail(req.body?.email),password=String(req.body?.password||"");
  if(!email||!password)return res.status(400).json({error:"REQUIRED_FIELDS"});
  const [ipKey,accountKey]=rateKey(req,email);
  if(blocked(ipKey,LOGIN_IP_LIMIT)||blocked(accountKey,LOGIN_ACCOUNT_LIMIT))return res.status(429).json({error:"LOGIN_TEMPORARILY_UNAVAILABLE"});
  const matches=db.prepare("SELECT * FROM users WHERE lower(trim(email))=? AND status='Active' ORDER BY created_at,id").all(email);
  const row=matches.length===1?matches[0]:null;
  const valid=await new Promise(resolve=>bcrypt.compare(password,row?.password_hash||dummyHash,(_e,ok)=>resolve(Boolean(ok))));
  if(!row||!valid){recordFailure(req,email);audit({user:row?safeUser(row):null},"LOGIN_FAILED","authentication",row?.id||"",null,{email},0);return res.status(401).json({error:"INVALID_LOGIN"});}
  loginBuckets.delete(accountKey);
  const activation=accountActivation.state(row.id);
  if(activation?.status==="PENDING"){
    if(!validContactEmail(row.contact_email))return res.status(409).json({error:"ACTIVATION_CONTACT_EMAIL_MISSING"});
    return res.json({activation_required:true,activation_token:activationToken(row),contact_email_masked:accountActivation.maskEmail(row.contact_email)});
  }
  const session=sessionFor(row);audit({user:session.user},"LOGIN","authentication",row.id,null,{email},1);res.json(session);
});

app.post("/api/account-activation/verify",(req,res)=>{
  try{
    const user=activationUser(req.body?.activation_token),result=accountActivation.verify(user.id,req.body?.activation_code);
    if(!result.ok)return res.status(result.error==="ACTIVATION_TEMPORARILY_LOCKED"?429:400).json({error:result.error,retry_after_seconds:result.retryAfterSeconds});
    res.json(sessionFor(user));
  }catch(_error){res.status(401).json({error:"INVALID_ACTIVATION_SESSION"});}
});
app.post("/api/account-activation/resend",async(req,res)=>{
  try{
    const user=activationUser(req.body?.activation_token),state=accountActivation.state(user.id);
    if(!state||state.status!=="PENDING")return res.status(409).json({error:"ACTIVATION_ALREADY_COMPLETED"});
    const issuance=accountActivation.issue(user.id),delivery=await accountActivation.deliver(user,issuance,"USER_RESEND");
    if(delivery.status!=="ACCEPTED")return res.status(502).json({error:delivery.error||"EMAIL_DELIVERY_FAILED"});
    res.json({ok:true,activation_token:activationToken(user),contact_email_masked:accountActivation.maskEmail(user.contact_email)});
  }catch(_error){res.status(401).json({error:"INVALID_ACTIVATION_SESSION"});}
});
app.post("/api/logout",auth,(req,res)=>{
  db.prepare("UPDATE users SET session_version=COALESCE(session_version,0)+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id);
  res.json({ok:true});
});
app.get("/api/me",auth,(req,res)=>res.json(req.user));
app.post("/api/auth/verify-session",auth,async(req,res)=>{
  const row=db.prepare("SELECT password_hash FROM users WHERE id=?").get(req.user.id);
  const valid=row?.password_hash&&await new Promise(resolve=>bcrypt.compare(String(req.body?.password||""),row.password_hash,(_e,ok)=>resolve(Boolean(ok))));
  if(!valid)return res.status(401).json({error:"INVALID_PASSWORD"});
  res.setHeader("Cache-Control","no-store");res.json({ok:true,user:req.user});
});

app.get("/api/users",auth,permit("ADMIN","MANAGER","WORKER"),(_req,res)=>{
  res.json(db.prepare(`SELECT id,name,email,contact_email,role,status,phone,address,created_at
    FROM users WHERE COALESCE(hidden_user,0)=0 ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END,lower(name)`).all());
});
app.post("/api/users",auth,permit("ADMIN"),async(req,res)=>{
  const name=String(req.body?.name||"").trim(),email=normalizeEmail(req.body?.email),contactEmail=normalizeEmail(req.body?.contact_email),password=String(req.body?.password||""),role=String(req.body?.role||"WORKER").toUpperCase();
  if(!name||!email||!contactEmail||!password)return res.status(400).json({error:"REQUIRED_FIELDS"});
  if(!validUserEmail(email)||!validContactEmail(contactEmail))return res.status(400).json({error:"INVALID_EMAIL"});
  if(password!==String(req.body?.password_confirmation||""))return res.status(400).json({error:"PASSWORD_CONFIRMATION_MISMATCH"});
  if(!["ADMIN","MANAGER","WORKER"].includes(role))return res.status(400).json({error:"INVALID_USER_ROLE"});
  if(db.prepare("SELECT 1 FROM users WHERE lower(trim(email))=? OR lower(trim(contact_email))=?").get(email,contactEmail))return res.status(409).json({error:"USER_EMAIL_ALREADY_USED"});
  const id=newId("U"),hash=bcrypt.hashSync(password,10);
  db.prepare(`INSERT INTO users(id,name,email,contact_email,password_hash,role,status,phone,address,hidden_user,is_superadmin,session_version)
    VALUES(?,?,?,?,?,?, 'Active',?,?,0,0,0)`).run(id,name,email,contactEmail,hash,role,String(req.body?.phone||""),String(req.body?.address||""));
  const created=db.prepare("SELECT * FROM users WHERE id=?").get(id);
  const issuance=accountActivation.issue(id),delivery=await accountActivation.deliver(created,issuance,"INITIAL");
  audit(req,"CREATE","users",id,null,safeUser(created));res.status(201).json({...safeUser(created),activation_status:"PENDING",activation_delivery_status:delivery.status});
});
app.put("/api/users/:id",auth,async(req,res)=>{
  const before=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);if(!before)return res.status(404).json({error:"USER_NOT_FOUND"});
  const self=req.user.id===before.id,admin=isSuperadmin(req.user)||req.user.role==="ADMIN";
  if(!self&&!admin)return res.status(403).json({error:"PERMISSION_DENIED"});
  if(Number(before.hidden_user||0)===1&&!isSuperadmin(req.user))return res.status(403).json({error:"PERMISSION_DENIED"});
  const name=String(req.body?.name??before.name).trim(),email=normalizeEmail(req.body?.email??before.email),contactEmail=normalizeEmail(req.body?.contact_email??before.contact_email);
  const role=admin?String(req.body?.role??before.role).toUpperCase():before.role,status=admin?String(req.body?.status??before.status):before.status;
  if(!name||!validUserEmail(email)||(contactEmail&&!validContactEmail(contactEmail)))return res.status(400).json({error:"INVALID_USER_DATA"});
  if(!["ADMIN","MANAGER","WORKER"].includes(role))return res.status(400).json({error:"INVALID_USER_ROLE"});
  const duplicate=db.prepare("SELECT id FROM users WHERE id<>? AND (lower(trim(email))=? OR lower(trim(contact_email))=?) LIMIT 1").get(before.id,email,contactEmail||"");
  if(duplicate)return res.status(409).json({error:"USER_EMAIL_ALREADY_USED"});
  let passwordHash=before.password_hash;
  if(req.body?.password||req.body?.password_confirmation){
    if(String(req.body.password||"")!==String(req.body.password_confirmation||""))return res.status(400).json({error:"PASSWORD_CONFIRMATION_MISMATCH"});
    passwordHash=bcrypt.hashSync(String(req.body.password),10);
  }
  db.prepare(`UPDATE users SET name=?,email=?,contact_email=?,phone=?,address=?,role=?,status=?,password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(name,email,contactEmail||null,String(req.body?.phone ?? before.phone ?? ""),String(req.body?.address ?? before.address ?? ""),role,status,passwordHash,before.id);
  const after=db.prepare("SELECT * FROM users WHERE id=?").get(before.id);audit(req,"UPDATE","users",before.id,safeUser(before),safeUser(after));res.json(safeUser(after));
});
app.delete("/api/users/:id",auth,requireSuperadmin,(req,res)=>{
  const row=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);if(!row)return res.status(404).json({error:"USER_NOT_FOUND"});
  if(Number(row.hidden_user||0)===1)return res.status(403).json({error:"HIDDEN_OWNER_PROTECTED"});
  db.prepare("DELETE FROM users WHERE id=?").run(row.id);audit(req,"DELETE","users",row.id,safeUser(row),null);res.json({ok:true});
});

app.get("/api/settings/branding",auth,permit("ADMIN"),(_req,res)=>res.json(getBranding()));
app.put("/api/settings/branding",auth,permit("ADMIN"),(req,res)=>{
  const before=getBranding(),company=String(req.body?.company_name||"").trim(),short=String(req.body?.short_name||"").trim();
  if(!company||!short)return res.status(400).json({error:"REQUIRED_FIELDS"});
  setSetting("company_name",company,req.user.name);setSetting("short_name",short,req.user.name);bumpBranding(req.user.name);
  const after=getBranding();audit(req,"UPDATE","branding","identity",before,after);res.json(after);
});
app.post("/api/settings/branding/logo",auth,permit("ADMIN"),brandingUpload.single("logo"),(req,res)=>{
  if(!req.file)return res.status(400).json({error:"INVALID_FILE_TYPE"});
  const details=inspectImageFile(req.file.path);
  if(!details||details.width<192||details.height<192){try{fs.unlinkSync(req.file.path);}catch(_e){}return res.status(400).json({error:"PWA_LOGO_REQUIREMENTS"});}
  const before=getBranding();setSetting("logo_url",`/uploads/${path.basename(req.file.path)}`,req.user.name);bumpBranding(req.user.name);
  const after=getBranding();audit(req,"UPDATE","branding","logo",before,after);res.json(after);
});
app.post("/api/settings/branding/background",auth,permit("ADMIN"),brandingUpload.single("background"),(req,res)=>{
  if(!req.file)return res.status(400).json({error:"INVALID_FILE_TYPE"});
  const details=inspectImageFile(req.file.path);if(!details){try{fs.unlinkSync(req.file.path);}catch(_e){}return res.status(400).json({error:"INVALID_IMAGE"});}
  const before=getBranding();setSetting("login_background_url",`/uploads/${path.basename(req.file.path)}`,req.user.name);bumpBranding(req.user.name);
  const after=getBranding();audit(req,"UPDATE","branding","background",before,after);res.json(after);
});
app.post("/api/settings/branding/reset-logo",auth,permit("ADMIN"),(req,res)=>{setSetting("logo_url","/icons/icon-512.png",req.user.name);bumpBranding(req.user.name);res.json(getBranding());});
app.post("/api/settings/branding/reset-background",auth,permit("ADMIN"),(req,res)=>{setSetting("login_background_url","",req.user.name);bumpBranding(req.user.name);res.json(getBranding());});

registerRound1CoreRoutes({app,db,auth,permit,audit});
registerRound2WorkflowRoutes({app,db,auth,permit,audit});
registerRound3FinanceRoutes({app,db,auth,permit,requireSuperadmin,audit,uploadDir:UPLOAD_DIR});

registerEventRoutes({
  app,db,auth,permit,requireSuperadmin,audit,transactionalEmail,
  eventImageUpload,eventImageDir:EVENT_IMAGE_DIR,ticketService,stripeSandbox,
  websiteBaseUrl:process.env.WEBSITE_BASE_URL||"https://klavierhaus-home.onrender.com",
  erpBaseUrl:process.env.APP_BASE_URL||"https://klavierhaus-erp.onrender.com",
  invoiceEngine:null,documentService:null,onTicketsIssued:null
});
registerWebsiteContentRoutes({
  app,db,auth,permit,audit,websiteImageUpload,websiteImageDir:WEBSITE_IMAGE_DIR,
  websiteBaseUrl:process.env.WEBSITE_BASE_URL||"https://klavierhaus-home.onrender.com",
  erpBaseUrl:process.env.APP_BASE_URL||"https://klavierhaus-erp.onrender.com"
});
registerWebsiteCatalogRoutes({app,db,auth,permit,audit,erpBaseUrl:process.env.APP_BASE_URL||"https://klavierhaus-erp.onrender.com"});
registerWebsitePlatformRoutes({
  app,db,auth,permit,requireSuperadmin,audit,websiteImageUpload,websiteImageDir:WEBSITE_IMAGE_DIR,
  erpBaseUrl:process.env.APP_BASE_URL||"https://klavierhaus-erp.onrender.com",
  websiteBaseUrl:process.env.WEBSITE_BASE_URL||"https://klavierhaus-home.onrender.com",
  transactionalEmail,env:process.env
});
registerWebsiteConversationRoutes({app,db,customerConversationUpload,uploadDir:UPLOAD_DIR});

app.use(uploadErrorHandler);
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  console.error("[API]",err?.stack||err);
  res.status(500).json({error:"INTERNAL_SERVER_ERROR"});
});

function startServer(port=PORT){
  return app.listen(port,()=>console.log(`Klavierhaus ERP Round 3 listening on :${port}`));
}
if(require.main===module)startServer();

module.exports={app,db,startServer};
