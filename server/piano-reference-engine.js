"use strict";

let AdmZip = null;
const { SERIAL_THRESHOLDS, MODEL_REFERENCE, parseSerialNumber, normalizeModel, pianoAge } = require("./steinway-reference");

function xmlDecode(value) {
  return String(value || "").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&");
}
function columnIndex(ref) {
  const letters=String(ref||"").match(/^[A-Z]+/i)?.[0]?.toUpperCase()||"A";let n=0;
  for(const ch of letters)n=n*26+(ch.charCodeAt(0)-64);return Math.max(0,n-1);
}
function sharedStrings(xml) {
  const out=[];for(const m of String(xml||"").matchAll(/<(?:[\w]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?si>/g)){
    out.push([...m[1].matchAll(/<(?:[\w]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?t>/g)].map(x=>xmlDecode(x[1])).join(""));
  }return out;
}
function parseXlsxSheets(buffer) {
  if(!AdmZip) AdmZip=require("adm-zip");
  const zip=new AdmZip(buffer),read=name=>zip.getEntry(name)?.getData().toString("utf8")||"";
  const workbook=read("xl/workbook.xml"),rels=read("xl/_rels/workbook.xml.rels");
  if(!workbook||!rels)throw new Error("INVALID_XLSX_STRUCTURE");
  const relationship=new Map();
  for(const m of rels.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)){
    const id=m[1].match(/\bId="([^"]+)"/)?.[1],target=m[1].match(/\bTarget="([^"]+)"/)?.[1];if(id&&target)relationship.set(id,target);
  }
  const shared=sharedStrings(read("xl/sharedStrings.xml")),sheets=[];
  for(const m of workbook.matchAll(/<(?:[\w]+:)?sheet\b([^>]*)\/?>(?:<\/(?:[\w]+:)?sheet>)?/g)){
    const name=xmlDecode(m[1].match(/\bname="([^"]*)"/)?.[1]||""),rid=m[1].match(/\br:id="([^"]+)"/)?.[1];let target=relationship.get(rid)||"";
    if(!target)continue;target=target.replace(/^\//,"");if(!target.startsWith("xl/"))target="xl/"+target.replace(/^\.\//,"");
    const xml=read(target);if(!xml)continue;const rows=[];
    for(const rm of xml.matchAll(/<(?:[\w]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?row>/g)){
      const row=[];for(const cm of rm[1].matchAll(/<(?:[\w]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w]+:)?c>)/g)){
        const attrs=cm[1],body=cm[2]||"",ref=attrs.match(/\br="([^"]+)"/)?.[1]||"",type=attrs.match(/\bt="([^"]+)"/)?.[1]||"";let value="";
        if(type==="inlineStr")value=[...body.matchAll(/<(?:[\w]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?t>/g)].map(x=>xmlDecode(x[1])).join("");
        else {const raw=xmlDecode(body.match(/<(?:[\w]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?v>/)?.[1]||"");value=type==="s"?(shared[Number(raw)]??""):raw;}
        row[columnIndex(ref)]=value;
      }rows.push(row);
    }sheets.push({name,rows});
  }return sheets;
}
function cleanNumber(value){const text=String(value??"").replace(/,/g,"").trim();if(!/^\d+$/.test(text))return null;const n=Number(text);return Number.isSafeInteger(n)?n:null;}
function extractReferenceWorkbook(buffer){
  const sheet=parseXlsxSheets(buffer).find(s=>String(s.name).trim().toLowerCase()==="steinway serial numbers");
  if(!sheet)throw new Error("STEINWAY_REFERENCE_SHEET_NOT_FOUND");
  const serials=new Map(),models=new Map();
  for(const row of sheet.rows){
    for(let i=0;i<row.length-1;i++){
      const a=cleanNumber(row[i]),b=cleanNumber(row[i+1]);
      if(a&&b){
        if(a>=1800&&a<=2100&&b>=483)serials.set(b,a);
        else if(b>=1800&&b<=2100&&a>=483)serials.set(a,b);
      }
    }
    for(let i=0;i<row.length;i++){
      const model=normalizeModel(row[i]);if(!model||String(row[i]||"").trim().toUpperCase()!==model)continue;
      const cm=String(row[i+1]??"").trim(),inch=String(row[i+2]??"").trim();
      if(cm&&inch&&/\d/.test(cm)&&/\d/.test(inch))models.set(model,{model,size_cm:cm.replace(/\s*-\s*/g," - "),size_inch:inch});
    }
  }
  const serialRows=[...serials].map(([start_serial,build_year])=>({start_serial,build_year})).sort((a,b)=>a.start_serial-b.start_serial);
  const modelRows=[...models.values()].sort((a,b)=>a.model.localeCompare(b.model));
  if(serialRows.length<100)throw new Error("STEINWAY_REFERENCE_SERIAL_ROWS_INCOMPLETE");
  if(modelRows.length<8)throw new Error("STEINWAY_REFERENCE_MODEL_ROWS_INCOMPLETE");
  return {sheet:sheet.name,serials:serialRows,models:modelRows};
}
function ensureCentralPianoReference(db){
  db.exec(`CREATE TABLE IF NOT EXISTS steinway_serial_registry(id INTEGER PRIMARY KEY AUTOINCREMENT,start_serial INTEGER NOT NULL UNIQUE,build_year INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_steinway_serial_registry_start_serial ON steinway_serial_registry(start_serial);
  CREATE TABLE IF NOT EXISTS steinway_models_registry(model TEXT PRIMARY KEY,size_cm TEXT NOT NULL,size_inch TEXT NOT NULL);`);
  const serialCount=Number(db.prepare("SELECT COUNT(*) AS c FROM steinway_serial_registry").get().c||0),modelCount=Number(db.prepare("SELECT COUNT(*) AS c FROM steinway_models_registry").get().c||0);
  if(!serialCount||!modelCount){
    const insertSerial=db.prepare("INSERT OR REPLACE INTO steinway_serial_registry(start_serial,build_year) VALUES(?,?)"),insertModel=db.prepare("INSERT OR REPLACE INTO steinway_models_registry(model,size_cm,size_inch) VALUES(?,?,?)");
    db.transaction(()=>{
      if(!serialCount)SERIAL_THRESHOLDS.forEach(([serial,year])=>insertSerial.run(serial,year));
      if(!modelCount)Object.values(MODEL_REFERENCE).forEach(row=>insertModel.run(row.model,row.size_cm,row.size_in));
    })();
  }
}
function importReferenceWorkbook(db,buffer){
  const parsed=extractReferenceWorkbook(buffer);ensureCentralPianoReference(db);
  const serial=db.prepare("INSERT OR REPLACE INTO steinway_serial_registry(start_serial,build_year) VALUES(?,?)"),model=db.prepare("INSERT OR REPLACE INTO steinway_models_registry(model,size_cm,size_inch) VALUES(?,?,?)");
  const legacyModel=db.prepare("INSERT INTO steinway_model_reference(model_key,size_cm,size_in,size_display) VALUES(?,?,?,?) ON CONFLICT(model_key) DO UPDATE SET size_cm=excluded.size_cm,size_in=excluded.size_in,size_display=excluded.size_display");
  db.transaction(()=>{
    parsed.serials.forEach(r=>serial.run(r.start_serial,r.build_year));
    parsed.models.forEach(r=>{model.run(r.model,r.size_cm,r.size_inch);legacyModel.run(r.model,r.size_cm,r.size_inch,`${r.size_cm} cm (${r.size_inch})`);});
  })();
  return {ok:true,sheet:parsed.sheet,serial_records:parsed.serials.length,model_records:parsed.models.length};
}
function lookupYear(db,serialInput){const serial=parseSerialNumber(serialInput);if(!serial||serial<483)return null;return db.prepare("SELECT build_year FROM steinway_serial_registry WHERE start_serial<=? ORDER BY start_serial DESC LIMIT 1").get(serial)?.build_year||null;}
function lookupModel(db,modelInput){const model=normalizeModel(modelInput);if(!model)return null;const row=db.prepare("SELECT model,size_cm,size_inch FROM steinway_models_registry WHERE model=?").get(model);return row?{...row,size_display:`${row.size_cm} cm (${row.size_inch})`}:null;}
function findExistingBySerial(db,serialInput){const serial=parseSerialNumber(serialInput);if(!serial)return null;return db.prepare("SELECT p.*,c.name AS client_name FROM pianos p LEFT JOIN contacts c ON c.id=p.owner_contact_id WHERE REPLACE(REPLACE(p.serial_no,' ',''),'-','')=? LIMIT 1").get(String(serial))||null;}
function centralPianoLookup(db,{q="",serial="",serial_no="",brand="",model="",currentYear=2026}={}){
  ensureCentralPianoReference(db);const query=String(q||"").trim(),serialInput=serial||serial_no||(/^\s*\d[\d\s-]*\s*$/.test(query)?query:"");
  const existing=serialInput?findExistingBySerial(db,serialInput):null;
  if(existing)return {match_type:"EXISTING_RECORD",existing_piano_id:existing.id,piano:existing,brand:existing.brand,model:existing.model,build_year:existing.build_year||existing.year||null,age:pianoAge(existing.build_year||existing.year,currentYear),size_cm:existing.size_cm||null,size_inch:existing.size_in||null,size_display:existing.size_display||null};
  if(query&&!serialInput&&!model){
    const like=`%${query}%`;const rows=db.prepare("SELECT p.*,c.name AS client_name FROM pianos p LEFT JOIN contacts c ON c.id=p.owner_contact_id WHERE p.brand LIKE ? OR p.model LIKE ? OR p.display_name LIKE ? OR p.serial_no LIKE ? OR c.name LIKE ? ORDER BY p.display_name LIMIT 25").all(like,like,like,like,like);
    return {match_type:rows.length?"EXISTING_SEARCH_RESULTS":"NO_MATCH",results:rows};
  }
  const buildYear=serialInput?lookupYear(db,serialInput):null,modelData=lookupModel(db,model),steinwaySuggested=Boolean(buildYear)||/steinway/i.test(String(brand||""));
  return {match_type:(buildYear||modelData)?"REFERENCE_SUGGESTION":"NO_MATCH",brand:steinwaySuggested?(brand||"Steinway & Sons"):(brand||null),model:modelData?.model||model||null,build_year:buildYear,age:buildYear?pianoAge(buildYear,currentYear):null,size_cm:modelData?.size_cm||null,size_inch:modelData?.size_inch||null,size_display:modelData?.size_display||null};
}
module.exports={parseXlsxSheets,extractReferenceWorkbook,ensureCentralPianoReference,importReferenceWorkbook,lookupYear,lookupModel,findExistingBySerial,centralPianoLookup};
