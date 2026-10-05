"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const multer=require("multer");
const bcrypt=require("bcryptjs");
const {inspectImageFile}=require("./upload-middleware");

function text(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function integerId(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function money(value){const n=Number(value??0);return Number.isFinite(n)&&n>=0?Math.round((n+Number.EPSILON)*100)/100:NaN;}
function problem(code,status=400){const e=new Error(code);e.status=status;return e;}
function respond(res,error){res.status(Number(error?.status||400)).json({error:error?.message||"V6_REQUEST_FAILED"});}
function setting(db,key,fallback=""){return db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(key)?.setting_value??fallback;}
function setSetting(db,key,value,user){
  db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .run(key,String(value??""),user?.name||user?.id||"SYSTEM");
}

const RECEIPT_EXTENSIONS=new Set([".jpg",".jpeg",".png",".webp",".gif",".heic",".heif",".pdf",".doc",".docx",".xls",".xlsx"]);
const RECEIPT_MIMES=new Set([
  "image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif","application/pdf",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const BRAND_EXTENSIONS=new Set([".jpg",".jpeg",".png",".webp",".gif",".avif"]);

function diskUpload(target,prefix,{extensions,mimes,max=25*1024*1024}){
  fs.mkdirSync(target,{recursive:true});
  return multer({
    storage:multer.diskStorage({
      destination:(_req,_file,cb)=>cb(null,target),
      filename:(_req,file,cb)=>{
        const ext=path.extname(file.originalname||"").toLowerCase();
        cb(null,`${prefix}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extensions.has(ext)?ext:""}`);
      }
    }),
    limits:{fileSize:max,files:1},
    fileFilter:(_req,file,cb)=>{
      const ext=path.extname(file.originalname||"").toLowerCase(),mime=String(file.mimetype||"").toLowerCase();
      const ok=extensions.has(ext)&&mimes.has(mime);
      cb(ok?null:new Error(prefix==="receipt"?"INVALID_RECEIPT_FILE_TYPE":"INVALID_BRANDING_IMAGE_TYPE"),ok);
    }
  });
}

function registerAdminUxV6Routes({app,db,auth,permit,audit,uploadDir,appBaseUrl="",inventoryService=null}){
  const staff=permit("ADMIN","MANAGER","WORKER"),admin=permit("ADMIN"),finance=permit("ADMIN","MANAGER");
  const receiptDir=path.join(uploadDir,"receipts"),brandDir=path.join(uploadDir,"branding-v6"),profileDir=path.join(uploadDir,"profile-images");
  const receiptUpload=diskUpload(receiptDir,"receipt",{extensions:RECEIPT_EXTENSIONS,mimes:RECEIPT_MIMES,max:40*1024*1024}).single("file");
  const brandUpload=diskUpload(brandDir,"brand",{extensions:BRAND_EXTENSIONS,mimes:new Set(["image/jpeg","image/png","image/webp","image/gif","image/avif"]),max:20*1024*1024}).single("file");
  const profileUpload=diskUpload(profileDir,"avatar",{extensions:BRAND_EXTENSIONS,mimes:new Set(["image/jpeg","image/png","image/webp","image/gif","image/avif"]),max:10*1024*1024}).single("file");

  app.get("/api/me/preferences",auth,(req,res)=>{
    const row=db.prepare("SELECT theme_preference,language_preference FROM users WHERE id=?").get(req.user.id)||{};
    res.json({
      theme:["light","dark"].includes(row.theme_preference)?row.theme_preference:"dark",
      language:["en","hu"].includes(row.language_preference)?row.language_preference:"en"
    });
  });
  app.put("/api/me/preferences",auth,(req,res)=>{
    const current=db.prepare("SELECT theme_preference,language_preference FROM users WHERE id=?").get(req.user.id)||{};
    const theme=req.body?.theme===undefined?(["light","dark"].includes(current.theme_preference)?current.theme_preference:"dark"):String(req.body.theme||"").toLowerCase();
    const language=req.body?.language===undefined?(["en","hu"].includes(current.language_preference)?current.language_preference:"en"):String(req.body.language||"").toLowerCase();
    if(!["dark","light"].includes(theme))return res.status(400).json({error:"INVALID_THEME"});
    if(!["en","hu"].includes(language))return res.status(400).json({error:"INVALID_LANGUAGE"});
    db.prepare("UPDATE users SET theme_preference=?,language_preference=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(theme,language,req.user.id);
    audit(req,"UPDATE","user_preferences",req.user.id,current,{theme_preference:theme,language_preference:language});
    res.json({theme,language});
  });

  app.put("/api/me/profile",auth,(req,res)=>{
    const before=db.prepare("SELECT id,name,email,contact_email,phone,address,profile_image_url,password_hash,session_version,is_superadmin,hidden_user FROM users WHERE id=?").get(req.user.id);
    if(!before)return res.status(404).json({error:"USER_NOT_FOUND"});
    const superadmin=Number(req.user?.is_superadmin||0)===1||req.user?.role==="SUPERADMIN";
    const name=text(req.body?.name??before.name,200),contactEmail=text(req.body?.contact_email??before.contact_email,320).toLowerCase(),phone=text(req.body?.phone??before.phone,100),address=text(req.body?.address??before.address,1000);
    const loginEmail=superadmin?text(req.body?.email??before.email,320).toLowerCase():String(before.email||"").trim().toLowerCase();
    if(!name)return res.status(400).json({error:"USER_NAME_REQUIRED"});
    if(!loginEmail||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail))return res.status(400).json({error:"INVALID_EMAIL"});
    if(contactEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))return res.status(400).json({error:"INVALID_EMAIL"});
    if(superadmin){
      const duplicate=db.prepare("SELECT id FROM users WHERE id<>? AND (lower(trim(email))=? OR lower(trim(contact_email))=?) LIMIT 1").get(req.user.id,loginEmail,loginEmail);
      if(duplicate)return res.status(409).json({error:"USER_EMAIL_ALREADY_USED"});
    }
    const password=String(req.body?.password||"");
    const minimumPasswordLength=superadmin?12:8;
    if(password&&password.length<minimumPasswordLength)return res.status(400).json({error:"PASSWORD_TOO_SHORT"});
    if(password&&password!==String(req.body?.password_confirmation||""))return res.status(400).json({error:"PASSWORD_CONFIRMATION_MISMATCH"});
    const emailChanged=superadmin&&loginEmail!==String(before.email||"").trim().toLowerCase(),credentialChanged=emailChanged||Boolean(password);
    const passwordHash=password?bcrypt.hashSync(password,12):before.password_hash;
    db.prepare(`UPDATE users SET name=?,email=?,contact_email=?,phone=?,address=?,password_hash=?,session_version=session_version+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(name,loginEmail,contactEmail||null,phone,address,passwordHash,credentialChanged?1:0,req.user.id);
    const after=db.prepare("SELECT id,name,email,contact_email,role,status,phone,address,profile_image_url,theme_preference,language_preference,session_version,is_superadmin FROM users WHERE id=?").get(req.user.id);
    audit(req,"UPDATE","user_profile",req.user.id,{...before,password_hash:"[REDACTED]"},{...after,credential_changed:credentialChanged});
    res.json({...after,reauth_required:credentialChanged});
  });

  app.post("/api/me/profile-image",auth,profileUpload,(req,res)=>{
    if(!req.file)return res.status(400).json({error:"PROFILE_IMAGE_REQUIRED"});
    const details=inspectImageFile(req.file.path);
    if(!details||details.width<128||details.height<128){try{fs.unlinkSync(req.file.path);}catch(_error){}return res.status(400).json({error:"INVALID_PROFILE_IMAGE"});}
    const before=db.prepare("SELECT profile_image_url FROM users WHERE id=?").get(req.user.id),url=`/uploads/profile-images/${path.basename(req.file.path)}`;
    db.prepare("UPDATE users SET profile_image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(url,req.user.id);
    audit(req,"UPDATE","user_profile_image",req.user.id,before,{profile_image_url:url});
    res.status(201).json({profile_image_url:url,...details});
  });
  app.delete("/api/me/profile-image",auth,(req,res)=>{
    const before=db.prepare("SELECT profile_image_url FROM users WHERE id=?").get(req.user.id);
    db.prepare("UPDATE users SET profile_image_url=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id);
    audit(req,"UPDATE","user_profile_image",req.user.id,before,{profile_image_url:null});
    res.json({ok:true,profile_image_url:""});
  });

  app.get("/api/intake-catalog",auth,staff,(req,res)=>{
    const includeInactive=(req.user.role==="ADMIN"||req.user.role==="SUPERADMIN")&&req.query.include_inactive==="1";
    const rows=includeInactive
      ?db.prepare("SELECT * FROM intake_catalog_items ORDER BY sort_order,lower(category),lower(title_en),id").all()
      :db.prepare("SELECT * FROM intake_catalog_items WHERE active=1 ORDER BY sort_order,lower(category),lower(title_en),id").all();
    res.json(rows);
  });
  app.post("/api/intake-catalog",auth,admin,(req,res)=>{
    try{
      const category=text(req.body?.category,160),titleEn=text(req.body?.title_en,240),titleHu=text(req.body?.title_hu,240),price=money(req.body?.default_price);
      if(!category||!titleEn||!titleHu)throw problem("INTAKE_CATALOG_REQUIRED_FIELDS");
      if(!(price>=0))throw problem("INVALID_INTAKE_CATALOG_PRICE");
      const info=db.prepare(`INSERT INTO intake_catalog_items(category,title_en,title_hu,description_en,description_hu,default_price,active,sort_order,created_by_user_id,updated_by_user_id)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(category,titleEn,titleHu,text(req.body?.description_en,3000)||null,text(req.body?.description_hu,3000)||null,price,req.body?.active===false?0:1,Number(req.body?.sort_order||0),req.user.id,req.user.id);
      const row=db.prepare("SELECT * FROM intake_catalog_items WHERE id=?").get(Number(info.lastInsertRowid));audit(req,"CREATE","intake_catalog",String(row.id),null,row);res.status(201).json(row);
    }catch(error){respond(res,error);}
  });
  app.put("/api/intake-catalog/:id",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),before=id&&db.prepare("SELECT * FROM intake_catalog_items WHERE id=?").get(id);
    if(!before)return res.status(404).json({error:"INTAKE_CATALOG_ITEM_NOT_FOUND"});
    try{
      const category=text(req.body?.category??before.category,160),titleEn=text(req.body?.title_en??before.title_en,240),titleHu=text(req.body?.title_hu??before.title_hu,240),price=money(req.body?.default_price??before.default_price);
      if(!category||!titleEn||!titleHu)throw problem("INTAKE_CATALOG_REQUIRED_FIELDS");
      if(!(price>=0))throw problem("INVALID_INTAKE_CATALOG_PRICE");
      db.prepare(`UPDATE intake_catalog_items SET category=?,title_en=?,title_hu=?,description_en=?,description_hu=?,default_price=?,active=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(category,titleEn,titleHu,text(req.body?.description_en??before.description_en,3000)||null,text(req.body?.description_hu??before.description_hu,3000)||null,price,req.body?.active===undefined?Number(before.active):req.body.active?1:0,Number(req.body?.sort_order??before.sort_order??0),req.user.id,id);
      const after=db.prepare("SELECT * FROM intake_catalog_items WHERE id=?").get(id);audit(req,"UPDATE","intake_catalog",String(id),before,after);res.json(after);
    }catch(error){respond(res,error);}
  });
  app.delete("/api/intake-catalog/:id",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),before=id&&db.prepare("SELECT * FROM intake_catalog_items WHERE id=?").get(id);
    if(!before)return res.status(404).json({error:"INTAKE_CATALOG_ITEM_NOT_FOUND"});
    const used=db.prepare("SELECT COUNT(*) count FROM intake_assessment_items WHERE catalog_item_id=?").get(id).count;
    if(used){
      db.prepare("UPDATE intake_catalog_items SET active=0,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,id);
      const after=db.prepare("SELECT * FROM intake_catalog_items WHERE id=?").get(id);audit(req,"ARCHIVE","intake_catalog",String(id),before,after);return res.json({ok:true,archived:true,item:after});
    }
    db.prepare("DELETE FROM intake_catalog_items WHERE id=?").run(id);audit(req,"DELETE","intake_catalog",String(id),before,null);res.json({ok:true,archived:false});
  });

  app.get("/api/intake/:id/assessment",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),lead=id&&db.prepare("SELECT id,estimated_total FROM intake_leads WHERE id=?").get(id);
    if(!lead)return res.status(404).json({error:"INTAKE_NOT_FOUND"});
    const items=db.prepare("SELECT * FROM intake_assessment_items WHERE intake_id=? ORDER BY sort_order,id").all(id);
    res.json({intake_id:id,estimated_total:Number(lead.estimated_total||0),items});
  });
  app.put("/api/intake/:id/assessment",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),lead=id&&db.prepare("SELECT * FROM intake_leads WHERE id=?").get(id);
    if(!lead)return res.status(404).json({error:"INTAKE_NOT_FOUND"});
    try{
      const requested=Array.isArray(req.body?.items)?req.body.items:[];
      const normalized=requested.map((item,index)=>{
        const catalogId=integerId(item?.catalog_item_id),catalog=catalogId&&db.prepare("SELECT * FROM intake_catalog_items WHERE id=?").get(catalogId);
        if(catalogId&&!catalog)throw problem("INTAKE_CATALOG_ITEM_NOT_FOUND");
        const titleEn=catalog?.title_en||text(item?.item_title_en??item?.title_en??item?.title,240);
        const titleHu=catalog?.title_hu||text(item?.item_title_hu??item?.title_hu,240)||titleEn;
        if(!titleEn)throw problem("INTAKE_CUSTOM_ITEM_TITLE_REQUIRED");
        const price=money(item?.price??catalog?.default_price??0);if(!(price>=0))throw problem("INVALID_INTAKE_CATALOG_PRICE");
        return {catalog_item_id:catalog?.id||null,item_title_en:titleEn,item_title_hu:titleHu,price,notes:text(item?.notes,2000)||null,sort_order:index};
      });
      const total=money(normalized.reduce((sum,item)=>sum+item.price,0));
      db.transaction(()=>{
        db.prepare("DELETE FROM intake_assessment_items WHERE intake_id=?").run(id);
        const insert=db.prepare(`INSERT INTO intake_assessment_items(intake_id,catalog_item_id,item_title_en,item_title_hu,price,notes,sort_order)
          VALUES(?,?,?,?,?,?,?)`);
        normalized.forEach(item=>insert.run(id,item.catalog_item_id,item.item_title_en,item.item_title_hu,item.price,item.notes,item.sort_order));
        db.prepare("UPDATE intake_leads SET estimated_total=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(total,id);
      })();
      const after={intake_id:id,estimated_total:total,items:db.prepare("SELECT * FROM intake_assessment_items WHERE intake_id=? ORDER BY sort_order,id").all(id)};
      audit(req,"UPDATE","intake_assessment",String(id),{estimated_total:Number(lead.estimated_total||0)},after);res.json(after);
    }catch(error){respond(res,error);}
  });

  const decoratePreset=row=>inventoryService?.decoratePreset?inventoryService.decoratePreset(row):{...row,materials:[]};
  app.get("/api/handoff-presets",auth,staff,(req,res)=>{
    const includeInactive=(req.user.role==="ADMIN"||req.user.role==="SUPERADMIN")&&req.query.include_inactive==="1";
    const rows=includeInactive
      ?db.prepare("SELECT * FROM handoff_presets ORDER BY sort_order,id").all()
      :db.prepare("SELECT * FROM handoff_presets WHERE active=1 ORDER BY sort_order,id").all();
    res.json(rows.map(decoratePreset));
  });
  app.post("/api/handoff-presets",auth,admin,(req,res)=>{
    try{
      const titleEn=text(req.body?.title_en,240),titleHu=text(req.body?.title_hu,240);
      const labor=money(req.body?.default_labor_cost),material=money(req.body?.default_material_cost),duration=Math.max(0,Math.round(Number(req.body?.default_duration_min||0)));
      if(!titleEn||!titleHu)throw problem("HANDOFF_PRESET_TITLE_REQUIRED");
      if(!(labor>=0)||!(material>=0)||!Number.isFinite(duration))throw problem("HANDOFF_PRESET_VALUES_INVALID");
      const row=db.transaction(()=>{
        const info=db.prepare(`INSERT INTO handoff_presets(title_en,title_hu,default_labor_cost,default_material_cost,default_duration_min,active,sort_order,created_by_user_id,updated_by_user_id)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(titleEn,titleHu,labor,material,duration,req.body?.active===false?0:1,Number(req.body?.sort_order||0),req.user.id,req.user.id);
        const id=Number(info.lastInsertRowid);if(inventoryService?.setPresetMaterials)inventoryService.setPresetMaterials(id,req.body?.materials||[]);
        return decoratePreset(db.prepare("SELECT * FROM handoff_presets WHERE id=?").get(id));
      })();
      audit(req,"CREATE","handoff_presets",String(row.id),null,row);res.status(201).json(row);
    }catch(error){respond(res,error);}
  });
  app.put("/api/handoff-presets/:id",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),base=id&&db.prepare("SELECT * FROM handoff_presets WHERE id=?").get(id);if(!base)return res.status(404).json({error:"HANDOFF_PRESET_NOT_FOUND"});
    const before=decoratePreset(base);
    try{
      const titleEn=text(req.body?.title_en??base.title_en,240),titleHu=text(req.body?.title_hu??base.title_hu,240);
      const labor=money(req.body?.default_labor_cost??base.default_labor_cost),material=money(req.body?.default_material_cost??base.default_material_cost),duration=Math.max(0,Math.round(Number(req.body?.default_duration_min??base.default_duration_min)));
      if(!titleEn||!titleHu)throw problem("HANDOFF_PRESET_TITLE_REQUIRED");
      if(!(labor>=0)||!(material>=0)||!Number.isFinite(duration))throw problem("HANDOFF_PRESET_VALUES_INVALID");
      const after=db.transaction(()=>{
        db.prepare(`UPDATE handoff_presets SET title_en=?,title_hu=?,default_labor_cost=?,default_material_cost=?,default_duration_min=?,active=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(titleEn,titleHu,labor,material,duration,req.body?.active===undefined?Number(base.active):req.body.active?1:0,Number(req.body?.sort_order??base.sort_order??0),req.user.id,id);
        if(inventoryService?.setPresetMaterials&&Array.isArray(req.body?.materials))inventoryService.setPresetMaterials(id,req.body.materials);
        return decoratePreset(db.prepare("SELECT * FROM handoff_presets WHERE id=?").get(id));
      })();
      audit(req,"UPDATE","handoff_presets",String(id),before,after);res.json(after);
    }catch(error){respond(res,error);}
  });
  app.delete("/api/handoff-presets/:id",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),before=id&&db.prepare("SELECT * FROM handoff_presets WHERE id=?").get(id);if(!before)return res.status(404).json({error:"HANDOFF_PRESET_NOT_FOUND"});
    db.prepare("UPDATE handoff_presets SET active=0,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,id);
    const after=db.prepare("SELECT * FROM handoff_presets WHERE id=?").get(id);audit(req,"ARCHIVE","handoff_presets",String(id),before,after);res.json({ok:true,preset:after});
  });

  app.put("/api/v6/website-services/:id/gallery",auth,admin,(req,res)=>{
    const before=db.prepare("SELECT * FROM website_services WHERE id=?").get(req.params.id);
    if(!before)return res.status(404).json({error:"WEBSITE_SERVICE_NOT_FOUND"});
    const source=Array.isArray(req.body?.gallery)?req.body.gallery:[];
    const gallery=source.slice(0,12).map(item=>{
      const url=text(item?.url||item?.image_url,1000);
      if(!url||(!/^https?:\/\//i.test(url)&&!url.startsWith("/")))throw problem("INVALID_WEBSITE_GALLERY_IMAGE");
      return {url,alt_en:text(item?.alt_en,500),alt_hu:text(item?.alt_hu,500)};
    });
    db.prepare("UPDATE website_services SET gallery_json=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(JSON.stringify(gallery),req.user.id,before.id);
    const after=db.prepare("SELECT * FROM website_services WHERE id=?").get(before.id);
    audit(req,"UPDATE_MEDIA","website_services",before.id,{gallery_json:before.gallery_json},{gallery_json:after.gallery_json});
    res.json(after);
  });

  app.post("/api/v6/direct-expense-receipt",auth,finance,receiptUpload,(req,res)=>{
    if(!req.file)return res.status(400).json({error:"RECEIPT_FILE_REQUIRED"});
    const url=`/uploads/receipts/${path.basename(req.file.path)}`;
    res.status(201).json({url,file_name:text(req.file.originalname,500),mime_type:req.file.mimetype,size:Number(req.file.size||0)});
  });

  app.get("/api/settings/branding/assets",auth,admin,(_req,res)=>{
    const legacy=setting(db,"logo_url","/icons/icon-512.png");
    res.json({
      favicon_url:setting(db,"favicon_url","/icons/icon-192.png"),
      app_icon_url:setting(db,"app_icon_url","/icons/icon-512.png"),
      login_background_url:setting(db,"login_background_url",""),
      login_logo_url:setting(db,"login_logo_url",legacy),
      logo_url:legacy,
      erp_logo_dark_url:setting(db,"erp_logo_dark_url",legacy),
      erp_logo_light_url:setting(db,"erp_logo_light_url",legacy),
      branding_version:setting(db,"branding_version","1")
    });
  });
  for(const spec of [
    {route:"favicon",key:"favicon_url",min:32},
    {route:"public-logo",key:null,min:192},
    {route:"public-favicon",key:"favicon_url",min:32},
    {route:"chat-logo",key:null,min:96},
    {route:"erp-logo-dark",key:"erp_logo_dark_url",min:192,legacy:true},
    {route:"erp-logo-light",key:"erp_logo_light_url",min:192},
    {route:"login-logo",key:"login_logo_url",min:192},
    {route:"app-icon",key:"app_icon_url",min:192}
  ]){
    app.post(`/api/settings/branding/${spec.route}`,auth,admin,brandUpload,(req,res)=>{
      if(!req.file)return res.status(400).json({error:"INVALID_BRANDING_IMAGE_TYPE"});
      const details=inspectImageFile(req.file.path),min=Number(spec.min||32);
      if(!details||details.width<min||details.height<min){try{fs.unlinkSync(req.file.path);}catch(_error){}return res.status(400).json({error:"INVALID_BRANDING_IMAGE"});}
      const before=spec.key?setting(db,spec.key,""):null,url=`/uploads/branding-v6/${path.basename(req.file.path)}`;
      const absolute_url=`${String(appBaseUrl||"").replace(/\/$/,"")}${url}`;
      if(spec.key)setSetting(db,spec.key,url,req.user);
      if(spec.legacy)setSetting(db,"logo_url",url,req.user);
      setSetting(db,"branding_version",String(Date.now()),req.user);
      audit(req,"UPDATE","branding",spec.key||spec.route,before==null?null:{url:before},{url,...details});res.json({url,absolute_url,...details,branding_version:setting(db,"branding_version","1")});
    });
  }
}

module.exports={registerAdminUxV6Routes};
