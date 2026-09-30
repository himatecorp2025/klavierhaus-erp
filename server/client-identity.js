"use strict";

function clean(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function normalizeEmail(value){return clean(value,320).toLowerCase();}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));}
function normalizePhone(value){return String(value||"").replace(/\D/g,"").replace(/^1(?=\d{10}$)/,"");}
function validClientType(value){return ["INDIVIDUAL","PARTNER","BUSINESS","INSTITUTION"].includes(String(value||"").toUpperCase());}
function findClientIdentity(db,{email,phone,name}={}){
  const mail=normalizeEmail(email);
  if(validEmail(mail)){const rows=db.prepare("SELECT * FROM clients WHERE deleted_at IS NULL AND lower(COALESCE(email,''))=? ORDER BY id").all(mail);if(rows.length===1)return {client:rows[0],match_method:"EMAIL"};}
  const normalizedPhone=normalizePhone(phone);
  if(normalizedPhone.length>=7){const rows=db.prepare("SELECT * FROM clients WHERE deleted_at IS NULL AND phone IS NOT NULL AND trim(phone)<>'' ORDER BY id").all().filter(row=>normalizePhone(row.phone)===normalizedPhone);if(rows.length===1)return {client:rows[0],match_method:"PHONE"};}
  const exactName=clean(name,240).toLowerCase();
  if(exactName){const rows=db.prepare("SELECT * FROM clients WHERE deleted_at IS NULL AND lower(trim(name))=? ORDER BY id").all(exactName);if(rows.length===1&&!mail&&!normalizedPhone)return {client:rows[0],match_method:"NAME"};}
  return {client:null,match_method:null};
}
function ensureClientIdentity(db,input={},options={}){
  const matched=findClientIdentity(db,input);if(matched.client)return {...matched,created:false};
  if(options.create===false)return {...matched,created:false};
  const name=clean(input.name,240),mail=normalizeEmail(input.email),phone=clean(input.phone,120);
  if(!name||(!validEmail(mail)&&!normalizePhone(phone)))return {client:null,match_method:null,created:false};
  const language=input.language==="hu"?"hu":"en",type=validClientType(input.client_type)?String(input.client_type).toUpperCase():"INDIVIDUAL";
  const info=db.prepare("INSERT INTO clients(name,email,phone,preferred_language,client_type,created_at,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(name,validEmail(mail)?mail:null,phone||null,language,type);
  return {client:db.prepare("SELECT * FROM clients WHERE id=?").get(Number(info.lastInsertRowid)),match_method:"CREATED",created:true};
}
module.exports={clean,normalizeEmail,normalizePhone,validEmail,findClientIdentity,ensureClientIdentity};
