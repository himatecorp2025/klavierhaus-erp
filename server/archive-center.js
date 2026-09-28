"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const multer=require("multer");

const CATEGORIES=new Set(["deleted_invoice","internal_correspondence","company_message","company_document"]);
const EXTENSIONS=new Set([".pdf",".doc",".docx",".xls",".xlsx",".csv",".txt",".jpg",".jpeg",".png",".webp",".gif"]);
const MIMES=new Set([
  "application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv","text/plain","image/jpeg","image/png","image/webp","image/gif"
]);
function text(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function integerId(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function json(value){try{return JSON.parse(String(value||"{}"));}catch(_error){return {};}}
function problem(code,status=400){const e=new Error(code);e.status=status;return e;}
function respond(res,error){res.status(Number(error?.status||400)).json({error:error?.message||"ARCHIVE_REQUEST_FAILED"});}

function registerArchiveCenterRoutes({app,db,auth,permit,audit,uploadDir}){
  const admin=permit("ADMIN");
  const target=path.join(uploadDir,"archive");
  fs.mkdirSync(target,{recursive:true});
  const upload=multer({
    storage:multer.diskStorage({
      destination:(_req,_file,cb)=>cb(null,target),
      filename:(_req,file,cb)=>{
        const ext=path.extname(file.originalname||"").toLowerCase();
        cb(null,`archive-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${EXTENSIONS.has(ext)?ext:""}`);
      }
    }),
    limits:{fileSize:50*1024*1024,files:1},
    fileFilter:(_req,file,cb)=>{
      const ext=path.extname(file.originalname||"").toLowerCase(),mime=String(file.mimetype||"").toLowerCase();
      const ok=EXTENSIONS.has(ext)&&MIMES.has(mime);cb(ok?null:new Error("INVALID_ARCHIVE_FILE_TYPE"),ok);
    }
  }).single("file");

  const select=`SELECT a.*,u.name archived_by_name FROM document_archive a LEFT JOIN users u ON u.id=a.archived_by_user_id`;

  app.get("/api/archive/documents",auth,admin,(req,res)=>{
    try{
      const category=text(req.query.category,80),q=text(req.query.q,240).toLowerCase(),like=`%${q}%`;
      if(category&&!CATEGORIES.has(category))throw problem("INVALID_ARCHIVE_CATEGORY");
      const rows=db.prepare(`${select} WHERE (?='' OR a.category=?) AND (?='' OR lower(a.title) LIKE ? OR lower(COALESCE(a.description,'')) LIKE ? OR lower(COALESCE(a.original_name,'')) LIKE ? OR lower(COALESCE(a.entity_id,'')) LIKE ?)
        ORDER BY a.archived_at DESC,a.id DESC`).all(category,category,q,like,like,like,like)
        .map(row=>({...row,metadata:json(row.metadata_json)}));
      res.json({categories:[...CATEGORIES],rows});
    }catch(error){respond(res,error);}
  });

  app.get("/api/archive/documents/:id",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),row=id&&db.prepare(`${select} WHERE a.id=?`).get(id);
    if(!row)return res.status(404).json({error:"ARCHIVE_DOCUMENT_NOT_FOUND"});
    res.json({...row,metadata:json(row.metadata_json)});
  });

  app.post("/api/archive/documents",auth,admin,(req,res)=>{
    upload(req,res,error=>{
      if(error)return respond(res,error);
      try{
        const category=text(req.body?.category,80),title=text(req.body?.title,300),description=text(req.body?.description,5000);
        if(!CATEGORIES.has(category)||category==="deleted_invoice")throw problem("INVALID_ARCHIVE_CATEGORY");
        if(!title)throw problem("ARCHIVE_TITLE_REQUIRED");
        const file=req.file||null,publicPath=file?`/uploads/archive/${path.basename(file.path)}`:null;
        const info=db.prepare(`INSERT INTO document_archive(category,title,description,original_name,stored_name,mime_type,size_bytes,file_path,metadata_json,archived_by_user_id)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(category,title,description||null,file?.originalname||null,file?path.basename(file.path):null,file?.mimetype||null,file?.size||null,publicPath,JSON.stringify({source:"manual"}),req.user.id);
        const row=db.prepare(`${select} WHERE a.id=?`).get(Number(info.lastInsertRowid));
        audit(req,"CREATE","document_archive",String(row.id),null,row);
        res.status(201).json({...row,metadata:json(row.metadata_json)});
      }catch(e){
        if(req.file){try{fs.unlinkSync(req.file.path);}catch(_error){}}
        respond(res,e);
      }
    });
  });

  app.get("/api/archive/documents/:id/download",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),row=id&&db.prepare("SELECT * FROM document_archive WHERE id=?").get(id);
    if(!row||!row.file_path)return res.status(404).json({error:"ARCHIVE_FILE_NOT_FOUND"});
    const rel=String(row.file_path).replace(/^\/uploads\//,"");
    const candidate=path.resolve(uploadDir,rel),root=path.resolve(uploadDir)+path.sep;
    if(!candidate.startsWith(root)||!fs.existsSync(candidate))return res.status(404).json({error:"ARCHIVE_FILE_NOT_FOUND"});
    res.download(candidate,row.original_name||path.basename(candidate));
  });
}

module.exports={registerArchiveCenterRoutes};
