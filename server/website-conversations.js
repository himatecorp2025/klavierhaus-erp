"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CATEGORIES = new Set(["SERVICE","PIANO","EVENT","REFUND","PRIVATE_CONSULTATION","TECHNICAL","TICKET","BILLING","REPAIR","GENERAL","OTHER"]);
const IDENTITY_REQUIRED = new Set(["SERVICE","EVENT","REFUND","PRIVATE_CONSULTATION","BILLING","REPAIR"]);

function clean(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function email(value){return clean(value,320).toLowerCase();}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(value));}
function id(prefix){return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;}
function hash(token){return crypto.createHash("sha256").update(String(token)).digest("hex");}
function removeFiles(files){for(const file of files||[]){if(file?.path)try{fs.unlinkSync(file.path);}catch(_error){}}}

function registerWebsiteConversationRoutes({app,db,customerConversationUpload,uploadDir,notifications=null}) {
  const upload = customerConversationUpload ? customerConversationUpload.array("attachments",10) : (_req,_res,next)=>next();

  function byToken(token){return db.prepare("SELECT * FROM customer_conversations WHERE public_token_hash=?").get(hash(token));}
  function attachments(messageId,token){
    return db.prepare("SELECT id,original_name,stored_name,mime_type,file_size FROM customer_message_attachments WHERE message_id=? ORDER BY created_at,id").all(messageId)
      .map(row=>({...row,url:`/api/public/customer-conversations/${encodeURIComponent(token)}/attachments/${encodeURIComponent(row.id)}`}));
  }
  function payload(row,token){
    const messages=db.prepare("SELECT id,direction,sender_name,sender_email,body,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id)
      .map(message=>({...message,attachments:attachments(message.id,token)}));
    return {...row,messages};
  }
  function saveFiles(files,conversationId,messageId){
    const insert=db.prepare("INSERT INTO customer_message_attachments(id,conversation_id,message_id,stored_name,original_name,mime_type,file_size,sha256) VALUES(?,?,?,?,?,?,?,?)");
    for(const file of files||[]){
      const bytes=fs.readFileSync(file.path);
      insert.run(id("ATT"),conversationId,messageId,path.basename(file.filename||file.path),clean(file.originalname,500),clean(file.mimetype,200),Number(file.size||bytes.length),crypto.createHash("sha256").update(bytes).digest("hex"));
    }
  }
  function event(conversationId,type,details={}){
    db.prepare("INSERT INTO customer_conversation_events(id,conversation_id,event_type,actor_name,actor_role,to_status,details) VALUES(?,?,?,?,?,?,?)")
      .run(id("CEV"),conversationId,type,"Website visitor","CUSTOMER","PENDING_STAFF",JSON.stringify(details));
  }

  app.post("/api/public/customer-conversations",upload,(req,res)=>{
    const category=clean(req.body?.category||"GENERAL",40).toUpperCase(),name=clean(req.body?.name,200),mail=email(req.body?.email),message=clean(req.body?.message,5000);
    const consent=req.body?.consent_contact===true||["true","1","on"].includes(String(req.body?.consent_contact||"").toLowerCase());
    if(!message||!CATEGORIES.has(category)||!consent){removeFiles(req.files);return res.status(400).json({error:"VALID_CONVERSATION_FIELDS_REQUIRED"});}
    if(mail&&!validEmail(mail)){removeFiles(req.files);return res.status(400).json({error:"INVALID_CONVERSATION_EMAIL"});}
    if(IDENTITY_REQUIRED.has(category)&&(!name||!validEmail(mail))){removeFiles(req.files);return res.status(400).json({error:"CONVERSATION_IDENTITY_REQUIRED",required_fields:["name","email"]});}
    const token=crypto.randomBytes(32).toString("base64url"),conversationId=id("CONV"),messageId=id("MSG");
    try{
      db.transaction(()=>{
        db.prepare(`INSERT INTO customer_conversations(id,public_token_hash,name,email,language,category,status,consent_contact,source_path,metadata_json,last_message_at,last_activity_at)
          VALUES(?,?,?,?,?,?,'PENDING_STAFF',1,?,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(conversationId,hash(token),name||null,mail||null,req.body?.language==="hu"?"hu":"en",category,clean(req.body?.source_path,1000)||null);
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')")
          .run(messageId,conversationId,"CUSTOMER",name||"Guest",mail||null,message);
        saveFiles(req.files,conversationId,messageId);event(conversationId,"CREATED",{message_id:messageId});
      })();
    }catch(error){removeFiles(req.files);return res.status(500).json({error:"CONVERSATION_CREATE_FAILED"});}
    const row=db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(conversationId);
    notifications?.emit({
      category:"CUSTOMER_CONVERSATION",entityType:"CUSTOMER_CONVERSATION",entityId:conversationId,
      titleEn:"New customer message",titleHu:"Új ügyfélüzenet",
      bodyEn:`${name||"Website visitor"} · ${category.replaceAll("_"," ")} · ${message.slice(0,220)}`,
      bodyHu:`${name||"Weboldali látogató"} · ${category.replaceAll("_"," ")} · ${message.slice(0,220)}`,
      actionUrl:"#cms",severity:"INFO"
    });
    res.status(201).json({...payload(row,token),access_token:token,outside_support_hours:false,auto_reply_delivery:{status:"NOT_CONFIGURED"}});
  });

  app.post("/api/public/customer-conversations/lookup",(req,res)=>{
    if(!validEmail(req.body?.email))return res.status(400).json({error:"VALID_CONVERSATION_EMAIL_REQUIRED"});
    res.setHeader("Cache-Control","no-store");res.status(202).json({ok:true});
  });

  app.get("/api/public/customer-conversations/:token",(req,res)=>{
    const row=byToken(req.params.token);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    res.setHeader("Cache-Control","no-store");res.json(payload(row,req.params.token));
  });

  app.post("/api/public/customer-conversations/:token/messages",upload,(req,res)=>{
    const row=byToken(req.params.token);if(!row){removeFiles(req.files);return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});}
    const body=clean(req.body?.message,5000);if(!body){removeFiles(req.files);return res.status(400).json({error:"MESSAGE_REQUIRED"});}
    const messageId=id("MSG");
    try{
      db.transaction(()=>{
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')")
          .run(messageId,row.id,"CUSTOMER",row.name||"Guest",row.email||null,body);
        saveFiles(req.files,row.id,messageId);
        db.prepare("UPDATE customer_conversations SET status='PENDING_STAFF',last_message_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP,closed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
        event(row.id,"CUSTOMER_MESSAGE",{message_id:messageId});
      })();
    }catch(error){removeFiles(req.files);return res.status(500).json({error:"CONVERSATION_MESSAGE_FAILED"});}
    notifications?.emit({
      category:"CUSTOMER_CONVERSATION",entityType:"CUSTOMER_CONVERSATION",entityId:row.id,
      titleEn:"New customer reply",titleHu:"Új ügyfélválasz",
      bodyEn:`${row.name||"Website visitor"} · ${body.slice(0,220)}`,bodyHu:`${row.name||"Weboldali látogató"} · ${body.slice(0,220)}`,
      actionUrl:"#cms",severity:"INFO"
    });
    res.status(201).json(payload(db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(row.id),req.params.token));
  });

  app.get("/api/public/customer-conversations/:token/attachments/:attachmentId",(req,res)=>{
    const row=byToken(req.params.token);if(!row)return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    const attachment=db.prepare("SELECT * FROM customer_message_attachments WHERE id=? AND conversation_id=?").get(req.params.attachmentId,row.id);
    if(!attachment)return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    const filePath=path.join(uploadDir,"customer-conversations",path.basename(attachment.stored_name));
    if(!fs.existsSync(filePath))return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    res.type(attachment.mime_type).download(filePath,attachment.original_name);
  });
}
module.exports={registerWebsiteConversationRoutes};
