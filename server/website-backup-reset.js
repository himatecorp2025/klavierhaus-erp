"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {installSampleContent,SAMPLE_VERSION_KEY}=require("./sample-content");
const {defaultLandingSections}=require("./round8-domain");
const {defaultWebsiteDesignSettings,PAGE_ROUTE_SETTINGS_KEY,WEBSITE_DESIGN_SETTINGS_KEY}=require("./website-content");

const SNAPSHOT_VERSION=1;
const TABLE_GROUPS=Object.freeze({
  pages:["website_content_pages","website_content_versions","landing_sections"],
  collections:["website_artists","website_services","website_showroom_pianos","website_reviews"],
});
const PAGE_SETTING_KEYS=Object.freeze([PAGE_ROUTE_SETTINGS_KEY,"website_seo_settings"]);
const COLLECTION_SETTING_KEYS=Object.freeze(["website_sample_content_v1",SAMPLE_VERSION_KEY]);
const BRANDING_SETTING_KEYS=Object.freeze([
  "company_name","short_name","logo_url","favicon_url","erp_logo_dark_url","erp_logo_light_url","login_logo_url",
  "app_icon_url","login_background_url","branding_version",WEBSITE_DESIGN_SETTINGS_KEY
]);
const ALL_SETTING_KEYS=Object.freeze([...new Set([...PAGE_SETTING_KEYS,...COLLECTION_SETTING_KEYS,...BRANDING_SETTING_KEYS])]);
const SCOPES=new Set(["all","pages","collections","branding"]);

function clean(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function newId(prefix){return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;}
function sha256(buffer){return crypto.createHash("sha256").update(buffer).digest("hex");}
function tableExists(db,table){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));}
function tableRows(db,table){return tableExists(db,table)?db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all():[];}
function currentColumns(db,table){return tableExists(db,table)?db.prepare(`PRAGMA table_info("${table}")`).all().map(row=>row.name):[];}
function snapshotLinks(db){
  const specs=[
    ["customer_conversations",["id","service_id","piano_id"]],
    ["website_contact_leads",["id","service_id"]],
    ["private_appointments",["id","service_id","piano_id"]],
    ["private_appointment_requests",["id","service_id","piano_id"]]
  ];
  return Object.fromEntries(specs.map(([table,columns])=>{
    if(!tableExists(db,table))return [table,[]];
    const available=new Set(currentColumns(db,table)),selected=columns.filter(column=>available.has(column));
    return [table,selected.length?db.prepare(`SELECT ${selected.map(column=>`"${column}"`).join(",")} FROM "${table}" ORDER BY rowid`).all():[]];
  }));
}
function snapshotSettings(db){
  if(!tableExists(db,"app_settings"))return [];
  const marks=ALL_SETTING_KEYS.map(()=>"?").join(",");
  return db.prepare(`SELECT * FROM app_settings WHERE setting_key IN (${marks}) ORDER BY setting_key`).all(...ALL_SETTING_KEYS);
}
function counts(db){
  const out={};
  for(const table of [...TABLE_GROUPS.pages,...TABLE_GROUPS.collections])out[table]=tableExists(db,table)?Number(db.prepare(`SELECT COUNT(*) count FROM "${table}"`).get()?.count||0):0;
  return out;
}
function buildSnapshot(db,{reason="",scope="all"}={}){
  return {
    version:SNAPSHOT_VERSION,
    created_at:new Date().toISOString(),
    requested_scope:SCOPES.has(scope)?scope:"all",
    reason:clean(reason,1000),
    tables:{
      website_content_pages:tableRows(db,"website_content_pages"),
      website_content_versions:tableRows(db,"website_content_versions"),
      landing_sections:tableRows(db,"landing_sections"),
      website_artists:tableRows(db,"website_artists"),
      website_services:tableRows(db,"website_services"),
      website_showroom_pianos:tableRows(db,"website_showroom_pianos"),
      website_reviews:tableRows(db,"website_reviews")
    },
    settings:snapshotSettings(db),
    foreign_links:snapshotLinks(db),
    counts:counts(db)
  };
}
function ensureBackupDir(backupDir){
  const dir=path.join(backupDir,"website");fs.mkdirSync(dir,{recursive:true});return dir;
}
function writeSnapshot(backupDir,id,snapshot){
  const dir=ensureBackupDir(backupDir),name=`${id}.json`,absolute=path.join(dir,name),temp=`${absolute}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  const data=Buffer.from(JSON.stringify(snapshot,null,2),"utf8");
  fs.writeFileSync(temp,data,{flag:"wx"});fs.renameSync(temp,absolute);
  return {relative:path.join("website",name),absolute,sha:sha256(data),size:data.length};
}
function createWebsiteBackup({db,backupDir,user=null,scope="all",triggerType="MANUAL",label="",reason=""}){
  const id=newId("WBK"),snapshot=buildSnapshot(db,{reason,scope}),file=writeSnapshot(backupDir,id,snapshot);
  db.prepare(`INSERT INTO website_backups(id,scope,trigger_type,label,file_path,sha256,snapshot_version,metadata_json,created_by_user_id)
    VALUES(?,?,?,?,?,?,?, ?,?)`).run(id,SCOPES.has(scope)?scope:"all",triggerType,clean(label,300)||null,file.relative,file.sha,SNAPSHOT_VERSION,
      JSON.stringify({size_bytes:file.size,counts:snapshot.counts,reason:clean(reason,1000)}),user?.id||null);
  return db.prepare("SELECT * FROM website_backups WHERE id=?").get(id);
}
function safeBackupPath(backupDir,relative){
  const root=path.resolve(backupDir),absolute=path.resolve(backupDir,String(relative||""));
  if(absolute!==root&&!absolute.startsWith(root+path.sep))throw new Error("INVALID_BACKUP_PATH");
  return absolute;
}
function readWebsiteBackup({db,backupDir,id}){
  const row=db.prepare("SELECT * FROM website_backups WHERE id=?").get(id);if(!row)throw Object.assign(new Error("WEBSITE_BACKUP_NOT_FOUND"),{status:404});
  const file=safeBackupPath(backupDir,row.file_path);if(!fs.existsSync(file))throw Object.assign(new Error("WEBSITE_BACKUP_FILE_MISSING"),{status:409});
  const data=fs.readFileSync(file);if(sha256(data)!==row.sha256)throw Object.assign(new Error("WEBSITE_BACKUP_CHECKSUM_MISMATCH"),{status:409});
  const snapshot=JSON.parse(data.toString("utf8"));if(Number(snapshot?.version)!==SNAPSHOT_VERSION)throw Object.assign(new Error("WEBSITE_BACKUP_VERSION_UNSUPPORTED"),{status:409});
  return {row,snapshot};
}
function insertRows(db,table,rows){
  if(!rows?.length||!tableExists(db,table))return;
  const available=new Set(currentColumns(db,table));
  for(const row of rows){
    const columns=Object.keys(row).filter(key=>available.has(key));if(!columns.length)continue;
    const sql=`INSERT INTO "${table}"(${columns.map(c=>`"${c}"`).join(",")}) VALUES(${columns.map(()=>"?").join(",")})`;
    db.prepare(sql).run(...columns.map(c=>row[c]));
  }
}
function replaceSettings(db,keys,rows){
  if(!tableExists(db,"app_settings"))return;
  const del=db.prepare("DELETE FROM app_settings WHERE setting_key=?");for(const key of keys)del.run(key);
  const allowed=new Set(keys),insert=db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,COALESCE(?,CURRENT_TIMESTAMP))");
  for(const row of rows||[])if(allowed.has(row.setting_key))insert.run(row.setting_key,row.setting_value,row.updated_by||"RESTORE",row.updated_at||null);
}
function restoreLinks(db,links){
  for(const [table,rows] of Object.entries(links||{})){
    if(!tableExists(db,table)||!rows?.length)continue;
    const available=new Set(currentColumns(db,table));
    for(const row of rows){
      if(row.id===undefined||row.id===null)continue;
      const fields=Object.keys(row).filter(key=>key!=="id"&&available.has(key));
      if(!fields.length)continue;
      db.prepare(`UPDATE "${table}" SET ${fields.map(key=>`"${key}"=?`).join(",")} WHERE id=?`).run(...fields.map(key=>row[key]),row.id);
    }
  }
}
function restoreSnapshot(db,snapshot){
  const tables=snapshot.tables||{},settings=snapshot.settings||[],links=snapshot.foreign_links||{};
  db.transaction(()=>{
    if(tableExists(db,"website_preview_tokens"))db.prepare("DELETE FROM website_preview_tokens").run();
    for(const table of ["website_content_versions","website_content_pages","landing_sections"])if(tableExists(db,table))db.prepare(`DELETE FROM "${table}"`).run();
    insertRows(db,"website_content_pages",tables.website_content_pages||[]);
    insertRows(db,"website_content_versions",tables.website_content_versions||[]);
    insertRows(db,"landing_sections",tables.landing_sections||[]);

    for(const table of ["website_reviews","website_showroom_pianos","website_services","website_artists"])if(tableExists(db,table))db.prepare(`DELETE FROM "${table}"`).run();
    insertRows(db,"website_artists",tables.website_artists||[]);
    insertRows(db,"website_services",tables.website_services||[]);
    insertRows(db,"website_showroom_pianos",tables.website_showroom_pianos||[]);
    insertRows(db,"website_reviews",tables.website_reviews||[]);

    replaceSettings(db,ALL_SETTING_KEYS,settings);
    restoreLinks(db,links);
    db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES('branding_version',?,'RESTORE',CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by='RESTORE',updated_at=CURRENT_TIMESTAMP`).run(String(Date.now()));
  })();
  return counts(db);
}
function setSetting(db,key,value,by="FACTORY_RESET"){
  db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(key,String(value),by);
}
function resetPages(db){
  if(tableExists(db,"website_preview_tokens"))db.prepare("DELETE FROM website_preview_tokens").run();
  for(const table of ["website_content_versions","website_content_pages","landing_sections"])if(tableExists(db,table))db.prepare(`DELETE FROM "${table}"`).run();
  const insert=db.prepare("INSERT INTO landing_sections(section_key,is_active,order_index) VALUES(?,?,?)");
  for(const row of defaultLandingSections())insert.run(row.section_key,row.is_active,row.order_index);
  for(const key of PAGE_SETTING_KEYS)db.prepare("DELETE FROM app_settings WHERE setting_key=?").run(key);
}
function resetCollections(db,{userId=null,websiteBaseUrl=""}={}){
  for(const table of ["website_reviews","website_showroom_pianos","website_services","website_artists"])if(tableExists(db,table))db.prepare(`DELETE FROM "${table}"`).run();
  for(const key of COLLECTION_SETTING_KEYS)db.prepare("DELETE FROM app_settings WHERE setting_key=?").run(key);
  return installSampleContent({db,userId,updatedBy:"FACTORY_RESET",publicWebsiteUrl:websiteBaseUrl});
}
function resetBranding(db){
  const defaults=defaultWebsiteDesignSettings();
  setSetting(db,"company_name","Klavierhaus");
  setSetting(db,"short_name","KH ERP");
  setSetting(db,"logo_url","/icons/icon-512.png");
  setSetting(db,"favicon_url","/icons/icon-512.png");
  setSetting(db,"erp_logo_dark_url","/icons/icon-512.png");
  setSetting(db,"erp_logo_light_url","/icons/icon-512.png");
  setSetting(db,"login_logo_url","/icons/icon-512.png");
  setSetting(db,"app_icon_url","/icons/icon-512.png");
  setSetting(db,"login_background_url","");
  setSetting(db,WEBSITE_DESIGN_SETTINGS_KEY,JSON.stringify(defaults));
  setSetting(db,"branding_version",String(Date.now()));
}
function factoryReset(db,scope,options={}){
  if(!SCOPES.has(scope))throw Object.assign(new Error("INVALID_WEBSITE_RESET_SCOPE"),{status:400});
  return db.transaction(()=>{
    if(scope==="all"||scope==="pages")resetPages(db);
    if(scope==="all"||scope==="collections")resetCollections(db,options);
    if(scope==="all"||scope==="branding")resetBranding(db);
    return counts(db);
  })();
}
function parseMeta(row){try{return JSON.parse(row.metadata_json||"{}");}catch(_error){return {};}}
function serializeBackup(row){return {...row,metadata:parseMeta(row)};}

function registerWebsiteBackupResetRoutes({app,db,auth,permit,requireSuperadmin,audit,backupDir,websiteBaseUrl=""}){
  const admin=permit("ADMIN");
  const isSuper=user=>Boolean(user&&(user.role==="SUPERADMIN"||Number(user.is_superadmin||0)===1));
  function listBackups(){return db.prepare("SELECT * FROM website_backups ORDER BY created_at DESC,id DESC LIMIT 100").all().map(serializeBackup);}
  function status(){const backups=listBackups();return {last_backup:backups[0]||null,backups,current_counts:counts(db),scopes:["pages","collections","branding","all"]};}

  app.get("/api/website-recovery",auth,admin,(_req,res)=>res.json(status()));
  app.get("/api/backups",auth,admin,(_req,res)=>res.json({rows:listBackups()}));

  app.post("/api/website-recovery/backups",auth,admin,(req,res)=>{
    try{
      const backup=createWebsiteBackup({db,backupDir,user:req.user,scope:"all",triggerType:"MANUAL",label:clean(req.body?.label,300),reason:clean(req.body?.reason,1000)});
      audit(req,"CREATE_WEBSITE_BACKUP","website_backup",backup.id,null,backup,1,"Website CMS backup created");
      res.status(201).json(serializeBackup(backup));
    }catch(error){res.status(Number(error.status||400)).json({error:error.message||"WEBSITE_BACKUP_FAILED"});}
  });
  app.post("/api/backups",auth,admin,(req,res)=>{
    try{
      const backup=createWebsiteBackup({db,backupDir,user:req.user,scope:"all",triggerType:"MANUAL",label:clean(req.body?.label,300),reason:clean(req.body?.reason,1000)});
      audit(req,"CREATE_WEBSITE_BACKUP","website_backup",backup.id,null,backup,1,"Website CMS backup created");
      res.status(201).json(serializeBackup(backup));
    }catch(error){res.status(Number(error.status||400)).json({error:error.message||"WEBSITE_BACKUP_FAILED"});}
  });

  app.post("/api/website-recovery/factory-reset",auth,admin,(req,res)=>{
    const scope=clean(req.body?.scope,40).toLowerCase(),confirmation=clean(req.body?.confirmation,80);
    try{
      if(!SCOPES.has(scope))throw Object.assign(new Error("INVALID_WEBSITE_RESET_SCOPE"),{status:400});
      if(scope==="all"&&!isSuper(req.user))throw Object.assign(new Error("SUPERADMIN_REQUIRED"),{status:403});
      const expected=scope==="all"?"RESET WEBSITE":`RESET ${scope.toUpperCase()}`;
      if(confirmation!==expected)throw Object.assign(new Error("WEBSITE_RESET_CONFIRMATION_REQUIRED"),{status:409});
      const pre=createWebsiteBackup({db,backupDir,user:req.user,scope,triggerType:"PRE_RESET",label:`Pre-reset · ${scope}`,reason:clean(req.body?.reason,1000)||`Factory reset ${scope}`});
      const before=counts(db),after=factoryReset(db,scope,{userId:req.user.id,websiteBaseUrl});
      audit(req,"FACTORY_RESET_WEBSITE","website",scope,{counts:before},{counts:after,pre_reset_backup_id:pre.id},1,`Website factory reset: ${scope}`);
      res.json({ok:true,scope,pre_reset_backup:serializeBackup(pre),before,after});
    }catch(error){res.status(Number(error.status||400)).json({error:error.message||"WEBSITE_FACTORY_RESET_FAILED"});}
  });

  app.post("/api/website-recovery/backups/:id/restore",auth,requireSuperadmin,(req,res)=>{
    try{
      if(clean(req.body?.confirmation,80)!=="RESTORE WEBSITE")throw Object.assign(new Error("WEBSITE_RESTORE_CONFIRMATION_REQUIRED"),{status:409});
      const target=readWebsiteBackup({db,backupDir,id:req.params.id});
      const pre=createWebsiteBackup({db,backupDir,user:req.user,scope:"all",triggerType:"PRE_RESTORE",label:`Pre-restore · ${target.row.id}`,reason:"Automatic backup before website restore"});
      const before=counts(db),after=restoreSnapshot(db,target.snapshot);
      audit(req,"RESTORE_WEBSITE_BACKUP","website_backup",target.row.id,{counts:before},{counts:after,pre_restore_backup_id:pre.id},1,"Website backup restored");
      res.json({ok:true,restored_backup:serializeBackup(target.row),pre_restore_backup:serializeBackup(pre),before,after});
    }catch(error){res.status(Number(error.status||400)).json({error:error.message||"WEBSITE_RESTORE_FAILED"});}
  });
}

module.exports={
  registerWebsiteBackupResetRoutes,
  createWebsiteBackup,readWebsiteBackup,restoreSnapshot,factoryReset,buildSnapshot,restoreLinks,
  TABLE_GROUPS,ALL_SETTING_KEYS,SNAPSHOT_VERSION
};
