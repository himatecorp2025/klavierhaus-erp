"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const multer=require("multer");
const AdmZip=require("adm-zip");

function text(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function integerId(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function problem(code,status=400){const error=new Error(code);error.status=status;return error;}
function xml(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
function columnName(index){let n=index+1,out="";while(n){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);}return out;}
function safeSheetName(value,used){
  let base=String(value||"Sheet").replace(/[\\/*?:[\]]/g," ").replace(/\s+/g," ").trim().slice(0,31)||"Sheet",name=base,index=2;
  while(used.has(name)){const suffix=" "+index++;name=(base.slice(0,31-suffix.length)+suffix).slice(0,31);}
  used.add(name);return name;
}
function safeCode(value){return text(value,120).toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,80);}
function redactCell(table,column,value){
  const key=String(column||"").toLowerCase();
  if(table==="users"&&key==="password_hash")return "[REDACTED]";
  if(/(?:password|secret|token|code_hash|signature)/i.test(key))return value==null?value:"[REDACTED]";
  return Buffer.isBuffer(value)?value.toString("base64"):value;
}
function worksheetXml(headers,rows){
  const maxCol=Math.max(1,headers.length),maxRow=Math.max(1,rows.length+1),last=columnName(maxCol-1);
  const rowXml=[];
  rowXml.push('<row r="1" ht="23" customHeight="1">'+headers.map((header,index)=>'<c r="'+columnName(index)+'1" t="inlineStr" s="1"><is><t>'+xml(header)+'</t></is></c>').join("")+'</row>');
  rows.forEach((row,rowIndex)=>{
    const r=rowIndex+2;
    rowXml.push('<row r="'+r+'">'+headers.map((header,index)=>{
      const value=row[header],ref=columnName(index)+r;
      if(value===null||value===undefined)return '<c r="'+ref+'"/>';
      if(typeof value==="number"&&Number.isFinite(value))return '<c r="'+ref+'"><v>'+value+'</v></c>';
      const raw=typeof value==="object"?JSON.stringify(value):String(value);
      return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml(raw)+'</t></is></c>';
    }).join("")+'</row>');
  });
  const widths=headers.map((header,index)=>{
    let width=Math.max(10,Math.min(42,String(header).length+4));
    for(let i=0;i<Math.min(rows.length,80);i++){const raw=rows[i]?.[header];if(raw!=null)width=Math.max(width,Math.min(42,String(raw).length+2));}
    return '<col min="'+(index+1)+'" max="'+(index+1)+'" width="'+width+'" customWidth="1"/>';
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'+last+maxRow+'"/>'+
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="18"/><cols>'+widths+'</cols><sheetData>'+rowXml.join("")+'</sheetData>'+
    (headers.length?'<autoFilter ref="A1:'+last+maxRow+'"/>':"")+'</worksheet>';
}
function createWorkbook(sheets){
  const zip=new AdmZip(),used=new Set(),normalized=sheets.map(sheet=>({...sheet,name:safeSheetName(sheet.name,used)}));
  const workbookSheets=normalized.map((sheet,index)=>'<sheet name="'+xml(sheet.name)+'" sheetId="'+(index+1)+'" r:id="rId'+(index+1)+'"/>').join("");
  const rels=normalized.map((_sheet,index)=>'<Relationship Id="rId'+(index+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(index+1)+'.xml"/>').join("")+
    '<Relationship Id="rId'+(normalized.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  const overrides=normalized.map((_sheet,index)=>'<Override PartName="/xl/worksheets/sheet'+(index+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("");
  zip.addFile("[Content_Types].xml",Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+overrides+'</Types>'));
  zip.addFile("_rels/.rels",Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'));
  zip.addFile("xl/workbook.xml",Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>'+workbookSheets+'</sheets></workbook>'));
  zip.addFile("xl/_rels/workbook.xml.rels",Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels+'</Relationships>'));
  zip.addFile("xl/styles.xml",Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB8914A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'));
  normalized.forEach((sheet,index)=>zip.addFile("xl/worksheets/sheet"+(index+1)+".xml",Buffer.from(worksheetXml(sheet.headers,sheet.rows))));
  return zip.toBuffer();
}

function milestoneUpload(uploadDir){
  const target=path.join(uploadDir,"milestone");fs.mkdirSync(target,{recursive:true});
  const allowed=new Set([".jpg",".jpeg",".png",".webp",".gif",".avif"]);
  return multer({
    storage:multer.diskStorage({destination:(_req,_file,cb)=>cb(null,target),filename:(_req,file,cb)=>{const ext=path.extname(file.originalname||"").toLowerCase();cb(null,"milestone-"+Date.now()+"-"+crypto.randomBytes(6).toString("hex")+(allowed.has(ext)?ext:""));}}),
    limits:{fileSize:20*1024*1024,files:1},
    fileFilter:(_req,file,cb)=>{const ext=path.extname(file.originalname||"").toLowerCase();cb(allowed.has(ext)?null:new Error("INVALID_MILESTONE_MEDIA"),allowed.has(ext));}
  }).single("file");
}

function registerOperationsEnhancementRoutes({app,db,auth,permit,audit,uploadDir}){
  const staff=permit("ADMIN","MANAGER","WORKER"),admin=permit("ADMIN"),mediaUpload=milestoneUpload(uploadDir);
  const skillRow=id=>db.prepare("SELECT * FROM staff_skills WHERE id=?").get(id);
  const decorateSkill=row=>row?{...row,user_count:Number(db.prepare("SELECT COUNT(*) count FROM user_staff_skills WHERE skill_id=?").get(row.id)?.count||0)}:null;
  const workProfile=userId=>{
    const user=db.prepare("SELECT id,name,role,manager_scope,status FROM users WHERE id=? AND COALESCE(hidden_user,0)=0").get(userId);
    if(!user)return null;
    const skills=db.prepare("SELECT s.* FROM staff_skills s JOIN user_staff_skills uss ON uss.skill_id=s.id WHERE uss.user_id=? ORDER BY s.sort_order,lower(s.name_en),s.id").all(userId);
    return {...user,skills,skill_ids:skills.map(row=>row.id)};
  };

  app.get("/api/staff-skills",auth,staff,(req,res)=>{
    const includeInactive=["ADMIN","SUPERADMIN"].includes(req.user?.role)&&req.query.include_inactive==="1";
    const rows=db.prepare("SELECT * FROM staff_skills "+(includeInactive?"":"WHERE active=1 ")+"ORDER BY sort_order,lower(name_en),id").all();
    res.json(rows.map(decorateSkill));
  });
  app.post("/api/staff-skills",auth,admin,(req,res)=>{
    try{
      const nameEn=text(req.body?.name_en??req.body?.name,160),nameHu=text(req.body?.name_hu,160)||nameEn,code=safeCode(req.body?.code||nameEn);
      if(!nameEn||!code)throw problem("STAFF_SKILL_NAME_REQUIRED");
      if(db.prepare("SELECT 1 FROM staff_skills WHERE code=?").get(code))throw problem("STAFF_SKILL_EXISTS",409);
      const info=db.prepare("INSERT INTO staff_skills(code,name_en,name_hu,description_en,description_hu,active,sort_order,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)").run(code,nameEn,nameHu,text(req.body?.description_en,1000)||null,text(req.body?.description_hu,1000)||null,req.body?.active===false?0:1,Number(req.body?.sort_order||0),req.user.id,req.user.id);
      const row=decorateSkill(skillRow(Number(info.lastInsertRowid)));audit(req,"CREATE","staff_skills",String(row.id),null,row);res.status(201).json(row);
    }catch(error){res.status(error.status||400).json({error:error.message});}
  });
  app.put("/api/staff-skills/:id",auth,admin,(req,res)=>{
    try{
      const id=integerId(req.params.id),before=id&&skillRow(id);if(!before)throw problem("STAFF_SKILL_NOT_FOUND",404);
      const nameEn=text(req.body?.name_en??before.name_en,160),nameHu=text(req.body?.name_hu??before.name_hu,160)||nameEn,code=safeCode(req.body?.code??before.code);
      if(!nameEn||!code)throw problem("STAFF_SKILL_NAME_REQUIRED");
      const duplicate=db.prepare("SELECT 1 FROM staff_skills WHERE code=? AND id<>?").get(code,id);if(duplicate)throw problem("STAFF_SKILL_EXISTS",409);
      db.prepare("UPDATE staff_skills SET code=?,name_en=?,name_hu=?,description_en=?,description_hu=?,active=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(code,nameEn,nameHu,text(req.body?.description_en??before.description_en,1000)||null,text(req.body?.description_hu??before.description_hu,1000)||null,req.body?.active===undefined?before.active:(req.body.active?1:0),Number(req.body?.sort_order??before.sort_order??0),req.user.id,id);
      const after=decorateSkill(skillRow(id));audit(req,"UPDATE","staff_skills",String(id),before,after);res.json(after);
    }catch(error){res.status(error.status||400).json({error:error.message});}
  });
  app.get("/api/users/:id/work-profile",auth,staff,(req,res)=>{
    const profile=workProfile(req.params.id);if(!profile)return res.status(404).json({error:"USER_NOT_FOUND"});res.json(profile);
  });
  app.put("/api/users/:id/work-profile",auth,admin,(req,res)=>{
    try{
      const profile=workProfile(req.params.id);if(!profile)throw problem("USER_NOT_FOUND",404);
      const scope=profile.role==="MANAGER"?text(req.body?.manager_scope,20).toUpperCase():null;
      if(scope&&!["INSIDE","OUTSIDE"].includes(scope))throw problem("INVALID_MANAGER_SCOPE");
      const skillIds=[...new Set((Array.isArray(req.body?.skill_ids)?req.body.skill_ids:[]).map(integerId).filter(Boolean))];
      for(const id of skillIds)if(!db.prepare("SELECT 1 FROM staff_skills WHERE id=? AND active=1").get(id))throw problem("STAFF_SKILL_NOT_FOUND");
      db.transaction(()=>{
        db.prepare("UPDATE users SET manager_scope=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(scope||null,profile.id);
        db.prepare("DELETE FROM user_staff_skills WHERE user_id=?").run(profile.id);
        const insert=db.prepare("INSERT INTO user_staff_skills(user_id,skill_id,assigned_by_user_id) VALUES(?,?,?)");
        skillIds.forEach(id=>insert.run(profile.id,id,req.user.id));
      })();
      const after=workProfile(profile.id);audit(req,"UPDATE","user_work_profile",profile.id,profile,after);res.json(after);
    }catch(error){res.status(error.status||400).json({error:error.message});}
  });

  function milestonePayload(){
    const dashboard=db.prepare("SELECT * FROM milestone_dashboard WHERE id=1").get()||{};
    const steps=db.prepare("SELECT * FROM milestone_steps ORDER BY sort_order,id").all().map(row=>({...row,completed:Boolean(row.completed)}));
    const completed=steps.filter(row=>row.completed).length,now=Date.now(),start=dashboard.start_date?new Date(dashboard.start_date+"T00:00:00Z").getTime():NaN,end=dashboard.end_date?new Date(dashboard.end_date+"T23:59:59Z").getTime():NaN;
    const time_progress=Number.isFinite(start)&&Number.isFinite(end)&&end>start?Math.max(0,Math.min(1,(now-start)/(end-start))):0;
    return {dashboard,steps,completed_count:completed,total_count:steps.length,step_progress:steps.length?completed/steps.length:0,time_progress,next_step:steps.find(row=>!row.completed)||null,completed_all:Boolean(steps.length&&completed===steps.length)};
  }
  app.get("/api/milestone",auth,staff,(_req,res)=>{res.setHeader("Cache-Control","no-store");res.json(milestonePayload());});
  app.put("/api/milestone",auth,admin,(req,res)=>{
    try{
      const dashboard=req.body?.dashboard||{},steps=Array.isArray(req.body?.steps)?req.body.steps:[];
      const titleEn=text(dashboard.title_en,240),titleHu=text(dashboard.title_hu,240)||titleEn;if(!titleEn)throw problem("MILESTONE_TITLE_REQUIRED");
      db.transaction(()=>{
        db.prepare("INSERT INTO milestone_dashboard(id,title_en,title_hu,quote_en,quote_hu,start_date,end_date,target_label,hero_media_url,hero_icon,updated_by_user_id,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET title_en=excluded.title_en,title_hu=excluded.title_hu,quote_en=excluded.quote_en,quote_hu=excluded.quote_hu,start_date=excluded.start_date,end_date=excluded.end_date,target_label=excluded.target_label,hero_media_url=excluded.hero_media_url,hero_icon=excluded.hero_icon,updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP").run(titleEn,titleHu,text(dashboard.quote_en,1500)||null,text(dashboard.quote_hu,1500)||null,text(dashboard.start_date,20)||null,text(dashboard.end_date,20)||null,text(dashboard.target_label,240)||null,text(dashboard.hero_media_url,1200)||null,text(dashboard.hero_icon,80)||null,req.user.id);
        db.prepare("DELETE FROM milestone_steps").run();
        const insert=db.prepare("INSERT INTO milestone_steps(title_en,title_hu,description_en,description_hu,target_date,completed,completed_at,icon,media_url,sort_order,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
        steps.forEach((step,index)=>{
          const stepTitle=text(step?.title_en??step?.title,240);if(!stepTitle)throw problem("MILESTONE_STEP_TITLE_REQUIRED");
          const completed=step?.completed?1:0;
          insert.run(stepTitle,text(step?.title_hu,240)||stepTitle,text(step?.description_en,2000)||null,text(step?.description_hu,2000)||null,text(step?.target_date,20)||null,completed,completed?(text(step?.completed_at,60)||new Date().toISOString()):null,text(step?.icon,80)||null,text(step?.media_url,1200)||null,Number(step?.sort_order??index),req.user.id,req.user.id);
        });
      })();
      const after=milestonePayload();audit(req,"UPDATE","milestone","GLOBAL",null,after);res.json(after);
    }catch(error){res.status(error.status||400).json({error:error.message});}
  });
  app.post("/api/milestone/media",auth,admin,(req,res)=>{
    mediaUpload(req,res,error=>{
      if(error)return res.status(400).json({error:error.message||"MILESTONE_MEDIA_UPLOAD_FAILED"});
      if(!req.file)return res.status(400).json({error:"MILESTONE_MEDIA_REQUIRED"});
      const url="/uploads/milestone/"+path.basename(req.file.path);audit(req,"CREATE","milestone_media",url,null,{url});res.status(201).json({url});
    });
  });

  app.get("/api/system-export.xlsx",auth,admin,(req,res)=>{
    try{
      const tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const manifestRows=tables.map(row=>({table_name:row.name,row_count:Number(db.prepare('SELECT COUNT(*) count FROM "'+String(row.name).replaceAll('"','""')+'"').get().count||0),schema_sql:row.sql||""}));
      const sheets=[{name:"Manifest",headers:["table_name","row_count","schema_sql"],rows:manifestRows}];
      for(const table of tables){
        const tableName=String(table.name),quoted='"'+tableName.replaceAll('"','""')+'"',headers=db.prepare("PRAGMA table_info("+quoted+")").all().map(row=>row.name);
        const raw=db.prepare("SELECT * FROM "+quoted).all(),rows=raw.map(row=>Object.fromEntries(headers.map(header=>[header,redactCell(tableName,header,row[header])])));
        sheets.push({name:tableName,headers,rows});
      }
      const workbook=createWorkbook(sheets),stamp=new Date().toISOString().slice(0,10);
      audit(req,"EXPORT","database","FULL",null,{tables:tables.length,format:"xlsx"});
      res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition",'attachment; filename="klavierhaus-full-database-'+stamp+'.xlsx"');
      res.setHeader("Cache-Control","no-store");res.send(workbook);
    }catch(error){res.status(500).json({error:"DATABASE_EXPORT_FAILED",details:String(error?.message||error)});}
  });
}

module.exports={registerOperationsEnhancementRoutes,createWorkbook};
