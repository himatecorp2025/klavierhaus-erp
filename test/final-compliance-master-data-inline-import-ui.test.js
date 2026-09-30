"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Master Data has no user-facing CSV import while server ingestion remains available",()=>{
  const app=read("public/app.js"),api=read("server/round1-core.js"),upload=read("server/upload-middleware.js");
  assert.doesNotMatch(app,/masterImportBtn|masterImportFile/);
  assert.doesNotMatch(app,/\/api\/master-data\/import-csv/);
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

test("raw source rows remain retained and searchable without exposing technical import-history panels",()=>{
  const schema=read("server/schema.sql"),reconcile=read("server/master-data-reconcile.js"),app=read("public/app.js");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS master_data_import_rows/);
  assert.match(schema,/raw_json TEXT NOT NULL/);
  assert.match(reconcile,/persistImportRow/);
  assert.match(reconcile,/JSON\.stringify\(record\.raw\)/);
  assert.match(reconcile,/master_data_client_source_map/);
  assert.match(reconcile,/master_data_piano_source_map/);
  assert.match(app,/client\.source_client_id/);
  assert.match(app,/piano\.source_instrument_id/);
  assert.match(app,/piano\.source_client_id/);
  assert.doesNotMatch(app,/Imported source history|Importált forráselőzmények/);
  assert.doesNotMatch(app,/Source data|Forrásadatok/);
  assert.doesNotMatch(app,/masterClientSourceHistoryMarkup|masterPianoSourceMarkup/);
});

test("PWA cache is bumped for the full 33-column Master Data release",()=>{
  assert.match(read("public/service-worker.js"),/klavierhaus-admin-v30-nav-settings-chat/);
});


test("Master Data search is bidirectional across clients and their linked pianos",()=>{
  const app=read("public/app.js"),api=read("server/round1-core.js");
  assert.match(app,/function masterClientSearchValues/);
  assert.match(app,/function masterPianoSearchValues/);
  assert.match(app,/Number\(piano\.client_id\)===Number\(client\.id\)/);
  assert.match(app,/owner&&masterSearchMatch\(masterClientSearchValues\(owner\),q\)/);
  assert.match(api,/OR EXISTS\(/);
  assert.match(api,/p\.brand/);
  assert.match(api,/p\.model/);
  assert.match(api,/p\.serial_number/);
  assert.match(api,/p\.size_display/);
  assert.match(api,/p\.color/);
  assert.match(api,/p\.last_service_title/);
  assert.match(api,/c\.deleted_at IS NULL/);
  assert.match(api,/client_first_name/);
  assert.match(api,/client_company_name/);
  assert.match(api,/client_postcode/);
});

test("Admin can delete a client from active Master Data into Deleted clients archive",()=>{
  const app=read("public/app.js"),archive=read("server/archive-center.js"),schema=read("server/schema.sql"),v6=read("public/v6.js");
  assert.match(app,/id="deleteClientBtn"/);
  assert.match(app,/\/api\/clients\/\$\{client\.id\}/);
  assert.match(app,/Permanently remove/);
  assert.match(archive,/app\.delete\("\/api\/clients\/:id",auth,admin/);
  assert.match(archive,/category,title,description,entity_type,entity_id,metadata_json/);
  assert.match(archive,/deleted_client/);
  assert.match(archive,/UPDATE pianos SET client_id=NULL/);
  assert.match(schema,/deleted_at TEXT/);
  assert.match(schema,/archive_document_id INTEGER/);
  assert.match(v6,/deleted_client:\["Deleted clients","Törölt ügyfelek"\]/);
});

test("lossless import retains original cells and active records expose all structured fields",()=>{
  const reconcile=read("server/master-data-reconcile.js");
  assert.match(reconcile,/raw:\{columns:\[\.\.\.headers\],values:row\.slice\(\)/);
  assert.match(reconcile,/sourceNonEmptyValues/);
  assert.match(reconcile,/MASTER_HEADERS/);
  assert.match(reconcile,/MASTER_IMPORT_CONTRACT/);
  assert.match(reconcile,/preservedNonEmptyValues/);
  assert.match(reconcile,/MASTER_DATA_INTEGRITY_FAILED/);
  assert.match(reconcile,/findExistingClient/);
  assert.match(reconcile,/deletedClientsSkipped/);
});


test("client Last visit and source lineage remain wired while technical lineage UI stays hidden",()=>{
  const schema=read("server/schema.sql"),init=read("server/init-db.js"),reconcile=read("server/master-data-reconcile.js"),api=read("server/round1-core.js"),app=read("public/app.js"),finance=read("server/round3-finance.js");
  assert.match(schema,/last_visit TEXT/);
  assert.match(init,/\["last_visit","TEXT"\]/);
  assert.match(reconcile,/function refreshClientLastVisit/);
  assert.match(reconcile,/refreshSourceClientLastVisits/);
  assert.match(api,/source_client_ids/);
  assert.match(api,/source_instrument_id/);
  assert.match(api,/\/api\/clients\/:id\/source-history/);
  assert.match(app,/Last visit/);
  assert.match(app,/Utolsó látogatás/);
  assert.doesNotMatch(app,/masterClientSourceHistoryMarkup/);
  assert.doesNotMatch(app,/masterPianoSourceMarkup/);
  assert.doesNotMatch(app,/Imported source history|Source data/);
  assert.match(finance,/refreshClientLastVisit/);
});

test("Master Data contract status is visible and successful import marks the canonical migration ready",()=>{
  const api=read("server/round1-core.js"),app=read("public/app.js"),init=read("server/init-db.js"),reconcile=read("server/master-data-reconcile.js");
  assert.match(api,/\/api\/master-data\/import-status/);
  assert.match(api,/auditStoredMasterImport/);
  assert.match(api,/master_data_import_status','READY'/);
  assert.match(api,/master_data_reconcile_version/);
  assert.match(app,/source contract verified/);
  assert.match(app,/forráskontraktus ellenőrizve/);
  assert.doesNotMatch(app,/masterImportBtn|masterImportFile/);
  assert.match(app,/MASTER_DATA_INTEGRITY_FAILED/);
  assert.match(init,/MASTER_DATA_RECONCILE_VERSION="2026-09-30-full-33-column-4"/);
  assert.match(init,/setSetting\("master_data_import_status",sourceAudit\.status\)/);
  assert.match(reconcile,/clientTypes:Object\.freeze\(\{INDIVIDUAL:258,BUSINESS:28,INSTITUTION:17,PARTNER:6\}\)/);
});
