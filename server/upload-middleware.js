const path = require("path");
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
  createClientImportUpload,
  createPianoImportUpload,
  uploadErrorHandler
};
