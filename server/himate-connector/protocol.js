"use strict";

const crypto=require("crypto");
const {PROTOCOL_VERSION,SOURCE_SYSTEM}=require("./registry");

function canonicalize(value){
  if(value===null || typeof value!=="object") return value;
  if(Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value).sort().reduce((out,key)=>{
    out[key]=canonicalize(value[key]);
    return out;
  },{});
}

function canonicalJson(value){
  return JSON.stringify(canonicalize(value));
}

function sha512Hex(value){
  const input=Buffer.isBuffer(value)?value:Buffer.from(String(value),"utf8");
  return crypto.createHash("sha512").update(input).digest("hex");
}

function dataChecksum(data){
  return sha512Hex(canonicalJson(data));
}

function aggregateChecksum(checksums){
  return sha512Hex([...checksums].map(String).sort().join("\n"));
}

function nonce(){
  return crypto.randomBytes(24).toString("base64url");
}

function signBody(token,rawBody,{timestamp=new Date().toISOString(),requestNonce=nonce()}={}){
  const bodySha512=sha512Hex(rawBody);
  const signature=crypto.createHmac("sha512",String(token||""))
    .update(timestamp).update("\n")
    .update(requestNonce).update("\n")
    .update(bodySha512)
    .digest("hex");
  return {
    timestamp,
    nonce:requestNonce,
    body_sha512:bodySha512,
    signature
  };
}

function buildItem(definition,data,{periodStart,periodEnd,aggregation="LATEST",idempotencyKey}={}){
  if(!definition) throw new Error("HIMATE_DATASET_DEFINITION_REQUIRED");
  const clean={};
  for(const [key,value] of Object.entries(data||{})){
    if(!definition.allowed_fields.includes(key)) throw new Error(`HIMATE_FIELD_NOT_ALLOWED:${definition.dataset_key}:${key}`);
    if(value===undefined) continue;
    if(value!==null && !["string","number","boolean"].includes(typeof value)) throw new Error(`HIMATE_NON_SCALAR_FIELD:${key}`);
    clean[key]=value;
  }
  if(!Object.keys(clean).length) throw new Error(`HIMATE_EMPTY_DATASET:${definition.dataset_key}`);
  const checksum=dataChecksum(clean);
  const today=new Date().toISOString().slice(0,10);
  return {
    module_key:definition.module_key,
    dataset_key:definition.dataset_key,
    schema_version:1,
    period_start:periodStart||today,
    period_end:periodEnd||periodStart||today,
    aggregation:String(aggregation||"LATEST").toUpperCase(),
    data:clean,
    source_checksum:checksum,
    idempotency_key:idempotencyKey||`${definition.dataset_key}:${today}:${checksum.slice(0,24)}`
  };
}

function buildBatch(items,{sourceVersion,batchId,generatedAt=new Date().toISOString()}={}){
  const id=batchId||`kh-batch-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  return {
    protocol_version:PROTOCOL_VERSION,
    source_system:SOURCE_SYSTEM,
    source_version:String(sourceVersion||"unknown"),
    batch_id:id,
    generated_at:generatedAt,
    items
  };
}

function buildReconciliation(batch,{sourceVersion,reconciliationId,generatedAt=new Date().toISOString()}={}){
  const byDataset=new Map();
  for(const item of batch.items||[]){
    if(!byDataset.has(item.dataset_key)) byDataset.set(item.dataset_key,[]);
    byDataset.get(item.dataset_key).push(item.source_checksum);
  }
  return {
    protocol_version:PROTOCOL_VERSION,
    source_system:SOURCE_SYSTEM,
    source_version:String(sourceVersion||batch.source_version||"unknown"),
    reconciliation_id:reconciliationId||`kh-reconcile-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`,
    batch_id:batch.batch_id,
    generated_at:generatedAt,
    datasets:[...byDataset.entries()].map(([dataset_key,checksums])=>({
      dataset_key,
      item_count:checksums.length,
      aggregate_checksum:aggregateChecksum(checksums)
    }))
  };
}

module.exports={
  canonicalize,canonicalJson,sha512Hex,dataChecksum,aggregateChecksum,
  nonce,signBody,buildItem,buildBatch,buildReconciliation
};
