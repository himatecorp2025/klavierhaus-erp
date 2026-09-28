"use strict";

const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const multer=require("multer");

const ALLOWED_EXTENSIONS=new Set([".jpg",".jpeg",".png",".webp",".gif",".heic",".heif",".mp4",".mov",".m4v",".webm"]);
const ALLOWED_MIMES=new Set([
  "image/jpeg","image/jpg","image/png","image/webp","image/gif","image/heic","image/heif",
  "video/mp4","video/quicktime","video/x-m4v","video/webm"
]);

function createIntakeMediaUpload(uploadDir){
  const target=path.join(uploadDir,"intake");
  fs.mkdirSync(target,{recursive:true});
  return multer({
    storage:multer.diskStorage({
      destination:(_req,_file,cb)=>cb(null,target),
      filename:(_req,file,cb)=>{
        const ext=path.extname(file.originalname||"").toLowerCase();
        cb(null,`intake-${Date.now()}-${crypto.randomBytes(10).toString("hex")}${ALLOWED_EXTENSIONS.has(ext)?ext:""}`);
      }
    }),
    limits:{fileSize:100*1024*1024,files:10},
    fileFilter:(_req,file,cb)=>{
      const ext=path.extname(file.originalname||"").toLowerCase();
      const mime=String(file.mimetype||"").toLowerCase();
      const ok=ALLOWED_EXTENSIONS.has(ext)&&ALLOWED_MIMES.has(mime);
      cb(ok?null:new Error("INVALID_INTAKE_MEDIA_TYPE"),ok);
    }
  });
}

module.exports={createIntakeMediaUpload};
