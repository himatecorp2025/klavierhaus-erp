"use strict";

const {DATASETS,PROTOCOL_VERSION,SOURCE_SYSTEM}=require("./registry");
const {signBody,buildBatch,buildReconciliation}=require("./protocol");
const {collectDatasets}=require("./collectors");

function trimBase(value){
  return String(value||"").trim().replace(/\/+$/,"");
}

function timeoutSignal(ms){
  if(typeof AbortSignal!=="undefined" && typeof AbortSignal.timeout==="function") return AbortSignal.timeout(ms);
  return undefined;
}

class HimateConnectorClient{
  constructor({baseUrl,token,sourceVersion,fetchImpl=global.fetch,timeoutMs=10000}={}){
    this.baseUrl=trimBase(baseUrl);
    this.token=String(token||"").trim();
    this.sourceVersion=String(sourceVersion||"unknown");
    this.fetchImpl=fetchImpl;
    this.timeoutMs=timeoutMs;
  }
  configured(){
    return Boolean(this.baseUrl && this.token && typeof this.fetchImpl==="function");
  }
  async request(path,payload){
    if(!this.configured()) throw new Error("HIMATE_CONNECTOR_NOT_CONFIGURED");
    const raw=JSON.stringify(payload);
    const signed=signBody(this.token,raw);
    const response=await this.fetchImpl(this.baseUrl+path,{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${this.token}`,
        "Content-Type":"application/json",
        "X-Himate-Timestamp":signed.timestamp,
        "X-Himate-Nonce":signed.nonce,
        "X-Himate-Body-SHA512":signed.body_sha512,
        "X-Himate-Signature":signed.signature
      },
      body:raw,
      signal:timeoutSignal(this.timeoutMs)
    });
    const text=await response.text();
    let body={};try{body=text?JSON.parse(text):{};}catch(_e){body={raw:text};}
    if(!response.ok){
      const error=new Error(`HIMATE_HTTP_${response.status}`);
      error.status=response.status;
      error.response=body;
      throw error;
    }
    return body;
  }
  async heartbeat({health="OK",modules={},error=""}={}){
    if(!this.configured()) throw new Error("HIMATE_CONNECTOR_NOT_CONFIGURED");
    const response=await this.fetchImpl(this.baseUrl+"/connector/v1/heartbeat",{
      method:"POST",
      headers:{"Authorization":`Bearer ${this.token}`,"Content-Type":"application/json"},
      body:JSON.stringify({version:this.sourceVersion,health,modules,error}),
      signal:timeoutSignal(this.timeoutMs)
    });
    const text=await response.text();
    let body={};try{body=text?JSON.parse(text):{};}catch(_e){body={raw:text};}
    if(!response.ok){const err=new Error(`HIMATE_HEARTBEAT_HTTP_${response.status}`);err.response=body;throw err;}
    return body;
  }
  async sendBatch(items,{batchId}={}){
    const batch=buildBatch(items,{sourceVersion:this.sourceVersion,batchId});
    const result=await this.request("/connector/v1/data/batches",batch);
    return {batch,result};
  }
  async reconcile(batch){
    const payload=buildReconciliation(batch,{sourceVersion:this.sourceVersion});
    return this.request("/connector/v1/reconcile",payload);
  }
}

function moduleHealthPayload(){
  return Object.fromEntries(DATASETS.map(item=>[item.module_key,{enabled:true,dataset_key:item.dataset_key,schema_version:1}]));
}

function createHimateExportAdapter({db,env=process.env,sourceVersion="unknown",fetchImpl=global.fetch,logger=console}={}){
  if(!db) throw new Error("HIMATE_CONNECTOR_DB_REQUIRED");
  const enabled=String(env.HIMATE_CONNECTOR_ENABLED||"").toLowerCase()==="true";
  const client=new HimateConnectorClient({
    baseUrl:env.HIMATE_CONNECTOR_URL,
    token:env.HIMATE_CONNECTOR_TOKEN,
    sourceVersion,
    fetchImpl,
    timeoutMs:Number(env.HIMATE_CONNECTOR_TIMEOUT_MS||10000)
  });
  const state={
    enabled,
    configured:client.configured(),
    running:false,
    last_heartbeat_at:null,
    last_sync_at:null,
    last_full_sync_at:null,
    last_reconciliation_at:null,
    last_status:"NEVER",
    last_error:"",
    last_batch_id:"",
    last_result:null
  };
  const timers=new Set();

  function snapshot(){return {...state,protocol_version:PROTOCOL_VERSION,source_system:SOURCE_SYSTEM,module_count:DATASETS.length};}
  function rememberError(error){
    state.last_status="ERROR";
    state.last_error=String(error?.message||error||"UNKNOWN_ERROR").slice(0,500);
    logger.warn?.("[HIMATE] connector operation failed:",state.last_error);
  }

  async function heartbeat(){
    if(!enabled||!client.configured()) return snapshot();
    try{
      const result=await client.heartbeat({health:state.last_status==="ERROR"?"DEGRADED":"OK",modules:moduleHealthPayload(),error:state.last_error});
      state.last_heartbeat_at=new Date().toISOString();
      if(state.last_status==="NEVER")state.last_status="CONNECTED";
      return result;
    }catch(error){rememberError(error);throw error;}
  }

  async function sync({cadences=null,moduleKeys=null,full=false}={}){
    if(!enabled||!client.configured()) return snapshot();
    if(state.running) return {...snapshot(),skipped:"ALREADY_RUNNING"};
    state.running=true;
    try{
      const items=collectDatasets(db,{cadences,moduleKeys,now:new Date()});
      if(!items.length) return {...snapshot(),skipped:"NO_DATASETS"};
      const {batch,result}=await client.sendBatch(items);
      state.last_batch_id=batch.batch_id;
      state.last_sync_at=new Date().toISOString();
      state.last_result=result;
      state.last_status=result.status||"ACCEPTED";
      state.last_error="";
      if(full){
        const reconciliation=await client.reconcile(batch);
        state.last_reconciliation_at=new Date().toISOString();
        state.last_full_sync_at=state.last_sync_at;
        state.last_status=reconciliation.status||state.last_status;
      }
      return {...snapshot(),items:items.length};
    }catch(error){rememberError(error);throw error;}
    finally{state.running=false;}
  }

  async function triggerModuleSync(moduleKey){
    const key=String(moduleKey||"").trim();
    if(!DATASETS.some(item=>item.module_key===key)) throw new Error("HIMATE_UNKNOWN_MODULE");
    return sync({moduleKeys:[key]});
  }

  function schedule(fn,ms){
    const timer=setInterval(()=>{Promise.resolve().then(fn).catch(()=>{});},ms);
    if(typeof timer.unref==="function")timer.unref();
    timers.add(timer);
  }

  function start(){
    if(!enabled||!client.configured()){
      state.last_status=enabled?"MISCONFIGURED":"DISABLED";
      return snapshot();
    }
    Promise.resolve().then(heartbeat).catch(()=>{});
    schedule(heartbeat,5*60*1000);
    schedule(()=>sync({cadences:["FIVE_MINUTES"]}),5*60*1000);
    schedule(()=>sync({cadences:["HOURLY"]}),60*60*1000);
    schedule(()=>sync({full:true}),24*60*60*1000);
    const startup=setTimeout(()=>{sync({full:true}).catch(()=>{});},15000);
    if(typeof startup.unref==="function")startup.unref();
    timers.add(startup);
    state.last_status="STARTING";
    return snapshot();
  }

  function stop(){
    for(const timer of timers){clearInterval(timer);clearTimeout(timer);}
    timers.clear();
  }

  return {client,state:snapshot,start,stop,heartbeat,sync,triggerModuleSync};
}

module.exports={HimateConnectorClient,createHimateExportAdapter,moduleHealthPayload};
