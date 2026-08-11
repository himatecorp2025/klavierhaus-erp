const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

function createDocumentUpload(uploadDir){
  return multer({
    dest: uploadDir,
    limits:{fileSize:20*1024*1024},
    fileFilter: (_req,file,cb)=>{
      const ok=/\.(pdf|jpg|jpeg|png)$/i.test(file.originalname||"");
      if(!ok) return cb(new Error("Only PDF, JPG, JPEG or PNG files are allowed / Csak PDF, JPG, JPEG vagy PNG fájl tölthető fel"));
      cb(null,true);
    }
  });
}

function createBrandingUpload(uploadDir){
  return multer({
    storage:multer.diskStorage({
      destination:(_req,_file,cb)=>cb(null,uploadDir),
      filename:(_req,file,cb)=>cb(null,`branding-${Date.now()}${path.extname(file.originalname||"").toLowerCase()||".png"}`)
    }),
    limits:{fileSize:15*1024*1024},
    fileFilter:(_req,file,cb)=>{
      const ok=["image/png","image/jpeg","image/jpg"].includes(String(file.mimetype||"").toLowerCase())||/\.(png|jpe?g)$/i.test(file.originalname||"");
      cb(ok?null:new Error("INVALID_FILE_TYPE"),ok);
    }
  });
}

function createEventImageUpload(uploadDir){
  return multer({
    storage:multer.diskStorage({
      destination:(_req,_file,cb)=>cb(null,uploadDir),
      filename:(_req,file,cb)=>{
        const extension=/\.png$/i.test(file.originalname||"")?".png":".jpg";
        cb(null,`event-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`);
      }
    }),
    limits:{fileSize:12*1024*1024,files:1},
    fileFilter:(_req,file,cb)=>{
      const mime=String(file.mimetype||"").toLowerCase();
      const ok=["image/png","image/jpeg","image/jpg"].includes(mime)&&/\.(png|jpe?g)$/i.test(file.originalname||"");
      cb(ok?null:new Error("INVALID_EVENT_IMAGE_TYPE"),ok);
    }
  });
}

function inspectImageFile(filePath){
  const buffer=require("fs").readFileSync(filePath);
  if(buffer.length>=33&&buffer.toString("hex",0,8)==="89504e470d0a1a0a"&&buffer.includes(Buffer.from("IEND"))){
    return {type:"image/png",width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
  }
  if(buffer.length>4&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer.at(-2)===0xff&&buffer.at(-1)===0xd9){
    let offset=2;
    while(offset+9<buffer.length){
      if(buffer[offset]!==0xff){offset+=1;continue;}
      const marker=buffer[offset+1];offset+=2;
      if(marker===0xd8||marker===0xd9)continue;
      if(offset+2>buffer.length)break;
      const length=buffer.readUInt16BE(offset);
      if(length<2||offset+length>buffer.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
        return {type:"image/jpeg",height:buffer.readUInt16BE(offset+3),width:buffer.readUInt16BE(offset+5)};
      }
      offset+=length;
    }
  }
  return null;
}

function createClientImportUpload(){
  return multer({
    storage:multer.memoryStorage(),
    limits:{fileSize:25*1024*1024},
    fileFilter:(_req,file,cb)=>{
      const ok=/\.xlsx$/i.test(file.originalname||"")||String(file.mimetype||"").toLowerCase()==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      cb(ok?null:new Error("INVALID_EXCEL_FILE"),ok);
    }
  });
}

function createPianoImportUpload(){
  return multer({
    storage:multer.memoryStorage(),
    limits:{fileSize:15*1024*1024},
    fileFilter:(_req,file,cb)=>{
      const ok=/\.xlsx$/i.test(file.originalname||"");
      cb(ok?null:new Error("INVALID_EXCEL_FILE"),ok);
    }
  });
}

function uploadErrorHandler(err,req,res,next){
  if(!err) return next();
  if(err instanceof multer.MulterError){
    const code=err.code==="LIMIT_FILE_SIZE"?"FILE_TOO_LARGE":err.code||"UPLOAD_ERROR";
    return res.status(400).json({error:code});
  }
  if(err.message==="Unexpected end of form"||err.message==="Unexpected end of multipart data"){
    return res.status(400).json({error:"INVALID_MULTIPART_FORM"});
  }
  return res.status(400).json({error:err.message||"UPLOAD_ERROR"});
}

module.exports={
  createDocumentUpload,
  createBrandingUpload,
  createEventImageUpload,
  createClientImportUpload,
  createPianoImportUpload,
  inspectImageFile,
  uploadErrorHandler
};
