"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const {SERIAL_THRESHOLDS,MODEL_REFERENCE}=require("../server/steinway-reference");
const {centralPianoLookup}=require("../server/piano-reference-engine");

function fakeDb(existing=[]){
 const serials=SERIAL_THRESHOLDS.map(([start_serial,build_year])=>({start_serial,build_year}));
 const models=Object.values(MODEL_REFERENCE).map(r=>({model:r.model,size_cm:r.size_cm,size_inch:r.size_in}));
 return {exec(){},transaction(fn){return ()=>fn();},prepare(sql){return {get(...args){
  if(sql.includes("COUNT(*)")&&sql.includes("steinway_serial_registry"))return {c:serials.length};
  if(sql.includes("COUNT(*)")&&sql.includes("steinway_models_registry"))return {c:models.length};
  if(sql.includes("FROM pianos p")&&sql.includes("REPLACE")){const n=String(args[0]);return existing.find(p=>String(p.serial_no).replace(/[ -]/g,"")===n)||undefined;}
  if(sql.includes("FROM steinway_serial_registry")){const n=Number(args[0]);return [...serials].reverse().find(r=>r.start_serial<=n);}
  if(sql.includes("FROM steinway_models_registry"))return models.find(r=>r.model===args[0]);
  return undefined;},all(){return [];},run(){return {changes:1};}};}};
}

test("DB Steinway lookup and 2026 age contract",()=>{
 const db=fakeDb();
 for(const [serial,year] of [[483,1853],[88686,1896],[122799,1906],[488243,1984],[589500,2010]]){
  const r=centralPianoLookup(db,{serial:String(serial),currentYear:2026});assert.equal(r.build_year,year);assert.equal(r.age,2026-year);assert.equal(r.brand,"Steinway & Sons");
 }
});

test("serial-first lookup prevents duplicate piano creation",()=>{
 const db=fakeDb([{id:"P-1",serial_no:"122799",brand:"Steinway & Sons",model:"B",build_year:1906,size_cm:"211",size_in:"6'10.5\"",size_display:"211 cm (6'10.5\")"}]);
 const r=centralPianoLookup(db,{serial:"122799",currentYear:2026});assert.equal(r.match_type,"EXISTING_RECORD");assert.equal(r.existing_piano_id,"P-1");assert.equal(r.age,120);
});

test("model B enriches central reference with cm and inch size",()=>{
 const r=centralPianoLookup(fakeDb(),{brand:"Steinway & Sons",model:"B",currentYear:2026});assert.equal(r.match_type,"REFERENCE_SUGGESTION");assert.equal(r.size_cm,"211");assert.equal(r.size_inch,"6'10.5\"");
});

test("reference import, central API and safe piano delete routes are wired",()=>{
 const source=fs.readFileSync(path.join(root,"server/index.js"),"utf8");
 assert.match(source,/app\.post\("\/api\/pianos\/import-reference"/);assert.match(source,/app\.get\("\/api\/pianos\/lookup"/);assert.match(source,/app\.delete\("\/api\/pianos\/:id", auth, requireSuperadmin/);assert.match(source,/PIANO_HARD_DELETE/);assert.match(source,/UPDATE contacts SET has_piano=/);
});

test("website light theme preserves cinematic hero and layout-only design-v3",()=>{
 const css=fs.readFileSync(path.join(root,"website/public/styles.css"),"utf8"),v3=fs.readFileSync(path.join(root,"website/public/design-v3.css"),"utf8");
 for(const token of ["#F7F5EF","#F1EDE4","#171817","#80642F","#181917"])assert.ok(css.includes(token),token);
 assert.match(css,/html\[data-theme="light"\] \.hero h1\s*\{[\s\S]*?color:\s*#FFFFFF/i);
 assert.doesNotMatch(v3,/(^|[;{\s])(color|background|background-color|border|border-color|box-shadow)\s*:/m);
});

test("consent banner is closed themed surface and theme toggle uses SVG with solar override",()=>{
 const css=fs.readFileSync(path.join(root,"website/public/styles.css"),"utf8"),app=fs.readFileSync(path.join(root,"website/public/app.js"),"utf8");
 assert.match(css,/\.consent-banner\s*\{[\s\S]*?background:\s*#121418/i);assert.match(css,/html\[data-theme="light"\] \.consent-banner\s*\{[\s\S]*?background:\s*#FCFBF7/i);
 assert.match(app,/function themeIconSvg\(theme\)/);assert.match(app,/<svg viewBox=/);assert.doesNotMatch(app,/"☀"|"☾"/);assert.match(app,/hour\s*>=\s*7\s*&&\s*hour\s*<\s*19/);assert.match(app,/theme_preference/);
});
