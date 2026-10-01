"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("SQLite runtime and migration connections use WAL and bounded memory tuning",()=>{
  const runtime=read("server/index.js"),init=read("server/init-db.js");
  for(const source of [runtime,init]){
    assert.match(source,/journal_mode = WAL/);
    assert.match(source,/synchronous = NORMAL/);
    assert.match(source,/temp_store = MEMORY/);
    assert.match(source,/cache_size = -32768/);
    assert.match(source,/mmap_size = 134217728/);
    assert.match(source,/journal_size_limit = 67108864/);
    assert.match(source,/wal_autocheckpoint = 1000/);
  }
  assert.match(runtime,/db\.pragma\("optimize"\)/);
  assert.match(init,/db\.pragma\("optimize"\)/);
});

test("hot ERP relationship, workflow and attachment lookups have covering indexes",()=>{
  const schema=read("server/schema.sql");
  for(const name of [
    "idx_clients_active_name",
    "idx_pianos_brand_model",
    "idx_master_data_client_source_map_client",
    "idx_master_data_piano_source_map_piano",
    "idx_master_data_source_rows_client_id",
    "idx_intake_status_created",
    "idx_intake_source_conversation",
    "idx_jobs_active_stage_schedule",
    "idx_jobs_client_created",
    "idx_job_handoffs_job_created",
    "idx_audit_module_record_time",
    "idx_customer_message_attachments_message",
    "idx_private_appointments_conversation"
  ])assert.match(schema,new RegExp("CREATE INDEX IF NOT EXISTS "+name));
});

test("admin API coalesces rapid sequential GETs without delaying mutation freshness",()=>{
  const app=read("public/app.js");
  assert.match(app,/const API_MEMORY_CACHE_MS=750/);
  assert.match(app,/const apiRecentGets=new Map\(\)/);
  assert.match(app,/if\(cached&&now-cached\.at<=memoryCacheMs\)return cached\.value/);
  assert.match(app,/delete requestOptions\.memoryCacheMs/);
  assert.match(app,/if\(method!==\"GET\"\)clearApiMemoryCache\(\)/);
  assert.match(app,/clearApiMemoryCache\(\);apiInflightGets\.clear\(\)/);
});

test("Messenger attachment uploads hash files as streams before SQLite write transactions",()=>{
  const source=read("server/website-conversations.js");
  assert.match(source,/function fileSha256\(filePath\)/);
  assert.match(source,/fs\.createReadStream\(filePath\)/);
  assert.match(source,/async function prepareFiles\(files\)/);
  assert.match(source,/preparedFiles=await prepareFiles\(req\.files\)/);
  assert.match(source,/saveFiles\(preparedFiles/);
  assert.doesNotMatch(source,/readFileSync\(file\.path\)/);
});
