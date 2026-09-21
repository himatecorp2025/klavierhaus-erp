"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Database=require("better-sqlite3");

const registry=require("../server/himate-connector/registry");
const protocol=require("../server/himate-connector/protocol");
const collectors=require("../server/himate-connector/collectors");
const {HimateConnectorClient,moduleHealthPayload}=require("../server/himate-connector");

const schema=fs.readFileSync(path.join(__dirname,"..","server","schema.sql"),"utf8");

function database(){
  const db=new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  return db;
}

test("START-22 registry is exactly the Klavierhaus 38-module contract",()=>{
  assert.equal(registry.DATASETS.length,38);
  assert.equal(registry.BY_MODULE.size,38);
  assert.equal(registry.BY_DATASET.size,38);
  assert.equal(registry.RETENTION_YEARS,7);
  assert.equal(registry.RETENTION_POLICY,"HIMATE_7Y");
  assert.equal(registry.PROTOCOL_VERSION,"1.0");
  assert.equal(registry.SOURCE_SYSTEM,"KLAVIERHAUS");

  const expected=[
    "finance","income_statement","invoice_documents","audit_log","backups","pianos","contacts","closed_jobs",
    "knowledge_base","company_data","inventory","partners","planned_jobs","scheduler","website_services","settings",
    "system_integrations","users","workshop_workflow","marketing_overview","customer_inbox","website_reviews",
    "campaigns_utm","leads","tracking_cookies","seo_keywords","heatmap","website_artists","website_contacts",
    "digital_attendance","events","event_guest_list","event_invitations","media_library","pages_content",
    "publish_preview","showroom_pianos","event_tickets"
  ];
  assert.deepEqual(registry.DATASETS.map(x=>x.module_key),expected);
});

test("START-22 allowlist never exposes secrets or direct identity fields",()=>{
  const forbiddenFragments=["password","secret","token","stripe","card_number","cvv"];
  const forbiddenExact=new Set([
    "session","session_id","session_hash","anonymous_session_hash","tax_id",
    "buyer_name","attendee_name","guest_name","guest_email","contact_email","client_name",
    "client_phone","message","message_body","notes","body","address_line1","postal_code"
  ]);
  for(const definition of registry.DATASETS){
    for(const field of definition.allowed_fields){
      const lower=field.toLowerCase();
      assert.equal(forbiddenExact.has(lower),false,`${definition.dataset_key} exposes forbidden field ${field}`);
      for(const bad of forbiddenFragments){
        assert.equal(lower.includes(bad),false,`${definition.dataset_key} exposes forbidden field ${field}`);
      }
    }
  }
});

test("all 38 collectors execute on the real schema and emit only approved scalar fields",()=>{
  const db=database();
  try{
    const items=collectors.collectDatasets(db,{now:new Date("2026-09-21T12:00:00Z")});
    assert.equal(items.length,38);
    for(const item of items){
      const definition=registry.BY_DATASET.get(item.dataset_key);
      assert.ok(definition,`unknown dataset ${item.dataset_key}`);
      assert.equal(item.module_key,definition.module_key);
      assert.equal(item.schema_version,1);
      assert.match(item.source_checksum,/^[0-9a-f]{128}$/);
      assert.ok(item.idempotency_key.length>=8);
      const keys=Object.keys(item.data);
      assert.ok(keys.length>0,`${item.dataset_key} is empty`);
      for(const key of keys){
        assert.ok(definition.allowed_fields.includes(key),`${item.dataset_key} emitted non-allowlisted ${key}`);
        const value=item.data[key];
        assert.ok(value===null || ["string","number","boolean"].includes(typeof value),`${item.dataset_key} emitted non-scalar ${key}`);
      }
      assert.equal(protocol.dataChecksum(item.data),item.source_checksum);
    }
  } finally { db.close(); }
});

test("SHA-512 dataset checksum is canonical and HMAC request signature is deterministic",()=>{
  const a={b:2,a:1,nested:{z:"last",a:"first"}};
  const b={nested:{a:"first",z:"last"},a:1,b:2};
  assert.equal(protocol.canonicalJson(a),protocol.canonicalJson(b));
  assert.equal(protocol.dataChecksum(a),protocol.dataChecksum(b));
  assert.match(protocol.dataChecksum(a),/^[0-9a-f]{128}$/);

  const raw=JSON.stringify({protocol_version:"1.0",source_system:"KLAVIERHAUS"});
  const one=protocol.signBody("hmc_test_secret",raw,{timestamp:"2026-09-21T12:00:00.000Z",requestNonce:"nonce-12345678"});
  const two=protocol.signBody("hmc_test_secret",raw,{timestamp:"2026-09-21T12:00:00.000Z",requestNonce:"nonce-12345678"});
  assert.deepEqual(one,two);
  assert.match(one.body_sha512,/^[0-9a-f]{128}$/);
  assert.match(one.signature,/^[0-9a-f]{128}$/);
});

test("reconciliation checksum is independent of item order",()=>{
  const checks=["a".repeat(128),"b".repeat(128),"c".repeat(128)];
  assert.equal(protocol.aggregateChecksum(checks),protocol.aggregateChecksum([...checks].reverse()));
});

test("HIMATE client emits signed headers but never serializes the connector token",async()=>{
  const calls=[];
  const fakeFetch=async(url,options)=>{
    calls.push({url,options});
    return {ok:true,status:202,text:async()=>JSON.stringify({status:"ACCEPTED"})};
  };
  const token="hmc_crd_test_super_secret_value";
  const client=new HimateConnectorClient({
    baseUrl:"https://himate.example.test",
    token,
    sourceVersion:"6.7.0",
    fetchImpl:fakeFetch
  });
  const item=protocol.buildItem(registry.DATASETS[0],{assets_usd:10,liabilities_usd:2,equity_usd:8,account_count:4},{
    periodStart:"2026-09-21",periodEnd:"2026-09-21",idempotencyKey:"finance-test-0001"
  });
  await client.sendBatch([item],{batchId:"batch-test-0000001"});
  assert.equal(calls.length,1);
  const call=calls[0];
  assert.equal(call.options.headers.Authorization,`Bearer ${token}`);
  assert.match(call.options.headers["X-Himate-Signature"],/^[0-9a-f]{128}$/);
  assert.match(call.options.headers["X-Himate-Body-SHA512"],/^[0-9a-f]{128}$/);
  assert.ok(call.options.headers["X-Himate-Nonce"].length>=8);
  assert.equal(call.options.body.includes(token),false);
});

test("heartbeat advertises all 38 known module contracts without secrets",()=>{
  const modules=moduleHealthPayload();
  assert.equal(Object.keys(modules).length,38);
  assert.equal(modules.finance.dataset_key,"finance.balance_sheet");
  assert.equal(JSON.stringify(modules).includes("token"),false);
  assert.equal(JSON.stringify(modules).includes("secret"),false);
});

test("START-22 production configuration documents runtime-only connector secrets",()=>{
  const root=path.join(__dirname,"..");
  const envExample=fs.readFileSync(path.join(root,".env.example"),"utf8");
  const readme=fs.readFileSync(path.join(root,"README.md"),"utf8");
  for(const key of [
    "HIMATE_CONNECTOR_ENABLED",
    "HIMATE_CONNECTOR_URL",
    "HIMATE_CONNECTOR_TOKEN",
    "HIMATE_CONNECTOR_TIMEOUT_MS"
  ]){
    assert.match(envExample,new RegExp(`^${key}=`,"m"),`${key} missing from .env.example`);
    assert.ok(readme.includes(key),`${key} missing from README`);
  }
  assert.match(envExample,/HIMATE_CONNECTOR_ENABLED=false/);
  assert.match(envExample,/HIMATE_CONNECTOR_TOKEN=\s*$/m);
  assert.match(envExample,/runtime secret/i);
  assert.match(readme,/never store a real value in Git, SQLite, logs or frontend code/i);
  assert.equal(/HIMATE_CONNECTOR_TOKEN=\S{8,}/.test(envExample),false,".env.example must never contain a real connector token");
});

