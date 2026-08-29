const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif", ".tif", ".tiff", ".bmp"]);
const IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif", "image/tiff", "image/bmp"]);
function imageExtension(file){const ext=path.extname(file.originalname||"").toLowerCase();return IMAGE_EXTENSIONS.has(ext)?ext:"";}
function isSupportedImage(file){return IMAGE_MIMES.has(String(file.mimetype||"").toLowerCase())&&Boolean(imageExtension(file));}

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
        const extension=imageExtension(file)||".jpg";
        cb(null,`event-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`);
      }
    }),
    limits:{fileSize:12*1024*1024,files:1},
    fileFilter:(_req,file,cb)=>{
      const ok=isSupportedImage(file);
      cb(ok?null:new Error("INVALID_EVENT_IMAGE_TYPE"),ok);
    }
  });
}

function createWebsiteImageUpload(uploadDir){
  return multer({
    storage:multer.diskStorage({
      destination:(_req,_file,cb)=>cb(null,uploadDir),
      filename:(_req,file,cb)=>{
        const extension=imageExtension(file)||".jpg";
        cb(null,`website-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`);
      }
    }),
    limits:{fileSize:12*1024*1024,files:1},
    fileFilter:(_req,file,cb)=>{
      const ok=isSupportedImage(file);
      cb(ok?null:new Error("INVALID_WEBSITE_IMAGE_TYPE"),ok);
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
  if(buffer.length>=30&&buffer.toString("ascii",0,4)==="RIFF"&&buffer.toString("ascii",8,12)==="WEBP"){
    if(buffer.toString("ascii",12,16)==="VP8X") return {type:"image/webp",width:1+(buffer[24]|buffer[25]<<8|buffer[26]<<16),height:1+(buffer[27]|buffer[28]<<8|buffer[29]<<16)};
    if(buffer.toString("ascii",12,16)==="VP8 "){const width=buffer.readUInt16LE(26)&0x3fff,height=buffer.readUInt16LE(28)&0x3fff;return {type:"image/webp",width,height};}
  }
  if(buffer.length>=10&&buffer.toString("ascii",0,3)==="GIF") return {type:"image/gif",width:buffer.readUInt16LE(6),height:buffer.readUInt16LE(8)};
  if(buffer.length>=26&&buffer.toString("ascii",0,2)==="BM") return {type:"image/bmp",width:Math.abs(buffer.readInt32LE(18)),height:Math.abs(buffer.readInt32LE(22))};
  if(buffer.length>=16&&buffer.toString("ascii",4,8)==="ftyp"){
    const major=buffer.toString("ascii",8,12).toLowerCase();
    const type=/heic|heix|hevc|hevx|mif1|msf1/.test(major)?"image/heic":"image/avif";
    for(let offset=0;offset+12<=buffer.length;offset+=4){if(buffer.toString("ascii",offset,offset+4)==="ispe"&&offset+16<=buffer.length)return {type,width:buffer.readUInt32BE(offset+8),height:buffer.readUInt32BE(offset+12)};}
    return {type,width:0,height:0};
  }
  if(buffer.length>=12&&(buffer.toString("ascii",0,4)==="II*\\0"||buffer.toString("ascii",0,4)==="MM\\0*")){
    const little=buffer.toString("ascii",0,2)==="II", read16=(o)=>little?buffer.readUInt16LE(o):buffer.readUInt16BE(o), read32=(o)=>little?buffer.readUInt32LE(o):buffer.readUInt32BE(o); let width=0,height=0; const ifd=read32(4); if(ifd+2<=buffer.length){const count=read16(ifd);for(let i=0;i<count;i++){const pos=ifd+2+i*12;if(pos+12>buffer.length)break;const tag=read16(pos),type=read16(pos+2);if((tag===256||tag===257)&&type===3){const value=little?buffer.readUInt16LE(pos+8):buffer.readUInt16BE(pos+8);if(tag===256)width=value;else height=value;} } if(width&&height)return {type:"image/tiff",width,height};}}
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
  createWebsiteImageUpload,
  createClientImportUpload,
  createPianoImportUpload,
  inspectImageFile,
  uploadErrorHandler
};
