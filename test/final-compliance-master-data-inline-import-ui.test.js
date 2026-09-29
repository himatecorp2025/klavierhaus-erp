"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Master Data exposes admin CSV import and review-aware client counts",()=>{
  const app=read("public/app.js"),api=read("server/round1-core.js"),upload=read("server/upload-middleware.js");
  assert.match(app,/masterImportBtn/);
  assert.match(app,/\/api\/master-data\/import-csv/);
  assert.match(api,/app\.post\("\/api\/master-data\/import-csv",auth,permit\("ADMIN"\)/);
  assert.match(upload,/function createMasterDataImportUpload/);
  assert.match(upload,/\.csv\$/i);
  assert.match(api,/piano_review_count/);
  assert.match(app,/masterReviewBadge/);
  assert.match(app,/data-classify-review/);
});

test("unclassified pianos are excluded from normal piano cards and exposed through review queue",()=>{
  const api=read("server/round1-core.js"),schema=read("server/schema.sql");
  assert.match(api,/COALESCE\(p\.classification_status,'CLASSIFIED'\)='CLASSIFIED'/);
  assert.match(api,/\/api\/clients\/:id\/piano-review/);
  assert.match(schema,/client_piano_review_queue/);
  assert.match(schema,/classification_status TEXT NOT NULL DEFAULT 'CLASSIFIED'/);
});

test("desktop client detail is directly editable with Save while touch devices retain Edit flow",()=>{
  const app=read("public/app.js");
  assert.match(app,/function masterInlineEditable\(\)/);
  assert.match(app,/window\.innerWidth>=1024&&navigator\.maxTouchPoints<=1/);
  assert.match(app,/id="clientInlineForm"/);
  assert.match(app,/id="saveClientBtn"/);
  assert.match(app,/id="editClientBtn"/);
  assert.match(app,/inline\?editable:readonly/);
});

test("desktop piano detail is directly editable and carries imported year size color notes fields",()=>{
  const app=read("public/app.js"),api=read("server/round1-core.js");
  assert.match(app,/id="pianoInlineForm"/);
  assert.match(app,/id="savePianoBtn"/);
  assert.match(app,/name="build_year"/);
  assert.match(app,/name="size_display"/);
  assert.match(app,/name="color"/);
  assert.match(app,/name="notes"/);
  assert.match(api,/PIANO_YEAR_INVALID/);
  assert.match(api,/build_year=\?/);
  assert.match(api,/classification_status='CLASSIFIED'/);
});

test("client address remains editable and launches Apple Maps or Google Maps routing",()=>{
  const app=read("public/app.js");
  assert.match(app,/function masterMapUrl\(address\)/);
  assert.match(app,/maps\.apple\.com\/\?saddr=Current\+Location&daddr=/);
  assert.match(app,/google\.com\/maps\/dir\/\?api=1&destination=/);
  assert.match(app,/master-address-input/);
  assert.match(app,/data-open-map/);
});

test("unsaved desktop Master Data uses Save Discard Cancel and saves before continuing",()=>{
  const app=read("public/app.js");
  assert.match(app,/masterDirty:false/);
  assert.match(app,/async function masterSaveCurrentInlineForm/);
  assert.match(app,/function masterUnsavedDecision\(\)/);
  assert.match(app,/async function masterConfirmDiscard\(\)/);
  assert.match(app,/data-master-unsaved-action="save"/);
  assert.match(app,/data-master-unsaved-action="discard"/);
  assert.match(app,/data-master-unsaved-action="cancel"/);
  assert.match(app,/Discard changes/);
  assert.match(app,/Módosítások elvetése/);
  assert.doesNotMatch(app,/window\.confirm\(/);
  assert.match(app,/\/api\/clients\/\$\{state\.selectedClientId\}/);
  assert.match(app,/\/api\/pianos\/\$\{state\.selectedPianoId\}/);
  assert.match(app,/decision==="save"/);
  assert.match(app,/decision==="discard"/);
  assert.match(app,/await masterConfirmDiscard\(\)/);
  assert.match(app,/beforeunload/);
});

test("left client cards are visibly separated and approximately 25 percent larger",()=>{
  const css=read("public/styles.css");
  assert.match(css,/\.master-list \.client-row\{[\s\S]*border:1px solid[\s\S]*background:var\(--surface-2\)/);
  assert.match(css,/\.master-list \.client-row-select\{min-height:65px/);
  assert.match(css,/font-size:17\.5px!important/);
  assert.match(css,/font-size:12\.5px!important/);
  assert.match(css,/\.master-list \.client-contact-action\{height:40px!important/);
});

test("piano-specific location remains optional and client address stays the effective fallback",()=>{
  const api=read("server/round1-core.js"),app=read("public/app.js");
  assert.match(api,/COALESCE\(NULLIF\(TRIM\(p\.location_notes\),''\),NULLIF\(TRIM\(c\.address\),''\)\) AS effective_location/);
  assert.match(app,/Blank = customer address automatically/);
  assert.match(app,/piano\.location_notes\|\|client\?\.address\|\|piano\.client_address/);
});

test("PWA cache is bumped for Master Data reconciliation UI",()=>{
  assert.match(read("public/service-worker.js"),/klavierhaus-admin-v17-unsaved-three-way-dialog/);
});
