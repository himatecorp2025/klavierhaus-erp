"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Master Data exposes admin CSV import and preserves source row/client counts",()=>{
  const app=read("public/app.js"),api=read("server/round1-core.js"),upload=read("server/upload-middleware.js");
  assert.match(app,/masterImportBtn/);
  assert.match(app,/\/api\/master-data\/import-csv/);
  assert.match(app,/sourceClients/);
  assert.match(app,/ownerlessPianos/);
  assert.match(api,/app\.post\("\/api\/master-data\/import-csv",auth,permit\("ADMIN"\)/);
  assert.match(upload,/function createMasterDataImportUpload/);
  assert.match(upload,/\.csv\$\/i/);
});

test("Master Data overview shows every piano and separates owner-pending from real data conflicts",()=>{
  const api=read("server/round1-core.js"),app=read("public/app.js"),schema=read("server/schema.sql");
  assert.match(api,/app\.get\("\/api\/master-data\/piano-overview"/);
  assert.match(api,/FROM pianos p LEFT JOIN clients c/);
  assert.match(api,/owner_linked/);
  assert.match(api,/owner_pending/);
  assert.match(app,/owner data pending/);
  assert.match(app,/tulajdonos adatpótlásra vár/);
  assert.doesNotMatch(app,/needs classification/);
  assert.doesNotMatch(app,/besorolásra vár/);
  assert.match(schema,/client_id INTEGER,/);
  assert.match(schema,/FOREIGN KEY \(client_id\) REFERENCES clients\(id\) ON DELETE SET NULL/);
});

test("client editor exposes every non-ID client source field",()=>{
  const app=read("public/app.js"),schema=read("server/schema.sql"),api=read("server/round1-core.js");
  for(const field of ["first_name","last_name","company_name","contact_name","street","city","district","postcode","country","mobile_phone","line_phone","email","notes","short_memo_to_name"]){
    assert.ok(app.includes('name="'+field+'"'),"missing client UI field "+field);
    assert.ok(schema.includes(field+" TEXT")||schema.includes(field+" "), "missing client schema field "+field);
  }
  assert.match(api,/structuredClientAddress/);
  assert.match(api,/structuredClientName/);
  assert.match(api,/structuredClientPhone/);
});

test("piano editor exposes every non-ID instrument source field and keeps No brand editable",()=>{
  const app=read("public/app.js"),schema=read("server/schema.sql"),api=read("server/round1-core.js");
  for(const field of ["category","brand","model","size_display","color","serial_number","build_year","notes","date_of_purchase","warranty","last_serviced_at","last_service_title","last_service_description","next_service_date","latest_info_frequency","latest_info_humidity","latest_info_temperature"]){
    assert.ok(app.includes('name="'+field+'"'),"missing piano UI field "+field);
    assert.ok(schema.includes(field+" TEXT")||schema.includes(field+" INTEGER")||schema.includes(field+" "), "missing piano schema field "+field);
  }
  assert.match(app,/placeholder="No brand"/);
  assert.match(api,/brand:text\(body\.brand\?\?before\.brand,200\)\|\|"No brand"/);
  assert.match(api,/app\.post\("\/api\/pianos"/);
  assert.match(api,/client_id=rawClient===null/);
});

test("desktop Master Data remains directly editable while missing values render as data pending",()=>{
  const app=read("public/app.js");
  assert.match(app,/function masterInlineEditable\(\)/);
  assert.match(app,/window\.innerWidth>=1024&&navigator\.maxTouchPoints<=1/);
  assert.match(app,/id="clientInlineForm"/);
  assert.match(app,/id="pianoInlineForm"/);
  assert.match(app,/masterPendingText/);
  assert.match(app,/Data pending/);
  assert.match(app,/Adatpótlásra vár/);
  assert.match(app,/master-data-pending/);
});

test("client address fields remain editable and route using the combined structured address",()=>{
  const app=read("public/app.js");
  assert.match(app,/function masterMapUrl\(address\)/);
  assert.match(app,/maps\.apple\.com\/\?saddr=Current\+Location&daddr=/);
  assert.match(app,/google\.com\/maps\/dir\/\?api=1&destination=/);
  assert.match(app,/function masterClientFormAddress/);
  assert.match(app,/\["street","city","district","postcode","country"\]/);
});

test("unsaved desktop Master Data still uses Save Discard Cancel and nullable piano owner saves correctly",()=>{
  const app=read("public/app.js");
  assert.match(app,/masterDirty:false/);
  assert.match(app,/async function masterSaveCurrentInlineForm/);
  assert.match(app,/function masterUnsavedDecision\(\)/);
  assert.match(app,/data-master-unsaved-action="save"/);
  assert.match(app,/data-master-unsaved-action="discard"/);
  assert.match(app,/data-master-unsaved-action="cancel"/);
  assert.match(app,/body\.client_id=body\.client_id\?Number\(body\.client_id\):null/);
});

test("raw source rows are retained for audit while source IDs stay internal",()=>{
  const schema=read("server/schema.sql"),reconcile=read("server/master-data-reconcile.js");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS master_data_import_rows/);
  assert.match(schema,/raw_json TEXT NOT NULL/);
  assert.match(reconcile,/persistImportRow/);
  assert.match(reconcile,/JSON\.stringify\(record\.raw\)/);
  assert.match(reconcile,/master_data_client_source_map/);
  assert.match(reconcile,/master_data_piano_source_map/);
});

test("PWA cache is bumped for complete Master Data import",()=>{
  assert.match(read("public/service-worker.js"),/klavierhaus-admin-v22-relational-search-notifications/);
});
