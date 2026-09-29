"use strict";

const UNKNOWN_BRANDS=new Set(["","unknown","no brand","n/a","na","none","unnamed"]);
const clean=(value,max=10000)=>String(value??"").replace(/\u0000/g,"").trim().slice(0,max);
function norm(value){return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");}
function normEmail(value){return clean(value,320).toLowerCase();}
function normPhone(value){const digits=clean(value,120).replace(/\D/g,"");return digits.length>=7?digits.slice(-10):"";}
function normSerial(value){return clean(value,200).toUpperCase().replace(/[^A-Z0-9]+/g,"");}
function brandFamily(value){
  const key=norm(value);
  if(key.includes("steinway"))return "steinway";
  if(key.includes("fazioli"))return "fazioli";
  if(key.includes("bechstein"))return "bechstein";
  if(key.includes("bosendorfer")||key.includes("boesendorfer"))return "bosendorfer";
  if(key.includes("masonhamlin"))return "masonhamlin";
  return key;
}
function validYear(value){
  const raw=clean(value,20);if(!raw)return null;
  const match=raw.match(/\b(17\d{2}|18\d{2}|19\d{2}|20\d{2}|2100)\b/);
  const year=match?Number(match[1]):Number(raw);
  return Number.isInteger(year)&&year>=1700&&year<=2100?year:null;
}
function csvRows(content){
  const text=String(content??"").replace(/^\uFEFF/,"");const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;continue;}
    if(ch==='"')quoted=true;
    else if(ch===","){row.push(cell);cell="";}
    else if(ch==="\n"){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}
    else cell+=ch;
  }
  if(quoted)throw Object.assign(new Error("MASTER_DATA_CSV_UNCLOSED_QUOTE"),{status:400});
  if(cell.length||row.length){row.push(cell.replace(/\r$/,""));rows.push(row);}
  return rows.filter(values=>values.some(value=>clean(value)));
}
function parseLegacyInstrumentClientCsv(content){
  const rows=csvRows(content);
  if(rows.length<3)throw Object.assign(new Error("MASTER_DATA_CSV_EMPTY"),{status:400});
  const headers=(rows[1]||[]).map(value=>clean(value).toUpperCase());
  const expected=["ID","CATEGORY","BRAND","MODEL","SIZE","COLOR","SERIAL NUMBER","YEAR BUILT"];
  if(expected.some((header,index)=>headers[index]!==header)||headers[18]!=="ID"||headers[30]!=="E-MAIL")throw Object.assign(new Error("MASTER_DATA_CSV_FORMAT_UNSUPPORTED"),{status:400});
  return rows.slice(2).map((values,index)=>{
    const row=[...values];while(row.length<33)row.push("");
    const first=clean(row[19],160),last=clean(row[20],160),company=clean(row[21],240),contact=clean(row[22],240);
    const person=[first,last].filter(Boolean).join(" "),name=company||person||contact;
    const address=[row[23],row[24],row[25],row[26],row[27]].map(v=>clean(v,300)).filter(Boolean).join(", ");
    const clientNotes=[contact?("Contact: "+contact):"",clean(row[31],3000),clean(row[32],1000)?("Memo: "+clean(row[32],1000)):""].filter(Boolean);
    return {
      row_number:index+3,
      instrument:{source_id:clean(row[0],80),category:clean(row[1],80),brand:clean(row[2],200),model:clean(row[3],200),size_display:clean(row[4],120),color:clean(row[5],160),serial_number:clean(row[6],200),build_year:validYear(row[7]),note:clean(row[8],4000),last_serviced_at:clean(row[11],40),last_service_title:clean(row[12],300),last_service_description:clean(row[13],2000)},
      client:{source_id:clean(row[18],80),name,email:normEmail(row[30]),phone:clean(row[28],120)||clean(row[29],120),address,notes:[...new Set(clientNotes)].join("\n"),client_type:"PRIVATE"}
    };
  }).filter(row=>row.instrument.source_id||row.client.source_id||row.client.name||row.instrument.brand);
}
function clientKeys(row){
  const name=norm(row.name),address=norm(row.address),email=normEmail(row.email),phone=normPhone(row.phone),keys=[];
  if(email&&name)keys.push("en:"+email+"|"+name);
  if(email&&address)keys.push("ea:"+email+"|"+address);
  if(phone&&name)keys.push("pn:"+phone+"|"+name);
  if(phone&&address)keys.push("pa:"+phone+"|"+address);
  if(name&&address)keys.push("na:"+name+"|"+address);
  return keys;
}
function clientScore(row){return ["name","email","phone","address","notes"].reduce((n,key)=>n+(clean(row[key])?1:0),0)+(String(row.client_type||"PRIVATE")!=="PRIVATE"?1:0)+Number(row.is_vip||0);}
function combineNotes(...values){return [...new Set(values.flatMap(value=>String(value||"").split(/\n+/)).map(value=>value.trim()).filter(Boolean))].join("\n");}
function repointClient(db,fromId,toId){
  for(const table of ["customer_conversations","private_appointments","private_appointment_requests","pianos","intake_leads","jobs","invoices","customer_communication_log"]){
    const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);if(!exists)continue;
    const columns=new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(row=>row.name));if(!columns.has("client_id"))continue;
    db.prepare(`UPDATE "${table}" SET client_id=? WHERE client_id=?`).run(toId,fromId);
  }
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='master_data_client_source_map'").get())db.prepare("UPDATE OR IGNORE master_data_client_source_map SET client_id=? WHERE client_id=?").run(toId,fromId);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='client_piano_review_queue'").get())db.prepare("UPDATE client_piano_review_queue SET client_id=? WHERE client_id=?").run(toId,fromId);
}
function mergeExistingClients(db){
  const rows=db.prepare("SELECT * FROM clients ORDER BY id").all(),parent=new Map(rows.map(row=>[row.id,row.id]));
  const find=id=>{let p=parent.get(id);while(p!==parent.get(p)){parent.set(p,parent.get(parent.get(p)));p=parent.get(p);}return p;};
  const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(Math.max(a,b),Math.min(a,b));};
  const owners=new Map();
  for(const row of rows)for(const key of clientKeys(row)){if(owners.has(key))union(row.id,owners.get(key));else owners.set(key,row.id);}
  const groups=new Map();for(const row of rows){const root=find(row.id);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(row);}
  let merged=0;
  for(const group of groups.values()){
    if(group.length<2)continue;
    group.sort((a,b)=>clientScore(b)-clientScore(a)||a.id-b.id);const keeper=group[0],duplicates=group.slice(1);
    const all=[keeper,...duplicates],pick=field=>all.map(row=>clean(row[field])).find(Boolean)||null;
    const name=all.map(row=>clean(row.name)).sort((a,b)=>b.length-a.length)[0]||"Client";
    const clientType=all.map(row=>String(row.client_type||"PRIVATE")).find(value=>value!=="PRIVATE")||"PRIVATE";
    db.prepare(`UPDATE clients SET name=?,email=?,phone=?,address=?,notes=?,preferred_language=?,client_type=?,is_vip=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(name,pick("email"),pick("phone"),pick("address"),combineNotes(...all.map(row=>row.notes)),pick("preferred_language")||"en",clientType,Math.max(...all.map(row=>Number(row.is_vip||0))),keeper.id);
    for(const duplicate of duplicates){repointClient(db,duplicate.id,keeper.id);db.prepare("DELETE FROM clients WHERE id=?").run(duplicate.id);merged++;}
  }
  return merged;
}
function pianoClassified(row){const brand=norm(row.brand);return !UNKNOWN_BRANDS.has(brand)&&Boolean(norm(row.model)||normSerial(row.serial_number)||Number(row.build_year||0)||norm(row.size_display));}
function pianoScore(db,row){
  const data=["brand","model","serial_number","finish","location_notes","last_serviced_at","build_year","size_display","color","notes"].reduce((n,key)=>n+(clean(row[key])?1:0),0);
  const jobs=db.prepare("SELECT COUNT(*) c FROM jobs WHERE piano_id=?").get(row.id)?.c||0,intake=db.prepare("SELECT COUNT(*) c FROM intake_leads WHERE piano_id=?").get(row.id)?.c||0;
  return data+Number(jobs)*3+Number(intake)*2;
}
function repointPiano(db,fromId,toId){
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get())db.prepare("UPDATE jobs SET piano_id=? WHERE piano_id=?").run(toId,fromId);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='intake_leads'").get())db.prepare("UPDATE intake_leads SET piano_id=? WHERE piano_id=?").run(toId,fromId);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='master_data_piano_source_map'").get())db.prepare("UPDATE OR IGNORE master_data_piano_source_map SET piano_id=? WHERE piano_id=?").run(toId,fromId);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='client_piano_review_queue'").get())db.prepare("UPDATE client_piano_review_queue SET piano_id=? WHERE piano_id=?").run(toId,fromId);
}
function pianoDuplicateKey(row){
  const serial=normSerial(row.serial_number),brand=brandFamily(row.brand);
  if(serial&&brand)return "serial:"+brand+"|"+serial;
  if(!pianoClassified(row))return "";
  const model=norm(row.model);if(!model)return "";
  return "exact:"+row.client_id+"|"+brand+"|"+model+"|"+norm(row.finish)+"|"+norm(row.location_notes)+"|"+String(row.build_year||"");
}
function mergeExistingPianos(db){
  const rows=db.prepare("SELECT * FROM pianos ORDER BY id").all(),groups=new Map();
  for(const row of rows){const key=pianoDuplicateKey(row);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  let merged=0;
  for(const group of groups.values()){
    if(group.length<2)continue;
    group.sort((a,b)=>pianoScore(db,b)-pianoScore(db,a)||a.id-b.id);const keeper=group[0],all=group;
    const pick=field=>all.map(row=>row[field]).find(value=>value!==null&&value!==undefined&&clean(value)!=="")??null;
    db.prepare(`UPDATE pianos SET client_id=?,brand=?,model=?,serial_number=?,finish=?,location_notes=?,last_serviced_at=?,build_year=?,size_display=?,color=?,notes=?,classification_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(keeper.client_id,pick("brand")||"Unknown",pick("model"),pick("serial_number"),pick("finish"),pick("location_notes"),pick("last_serviced_at"),pick("build_year"),pick("size_display"),pick("color"),combineNotes(...all.map(row=>row.notes)),pianoClassified({...keeper,brand:pick("brand"),model:pick("model"),serial_number:pick("serial_number"),build_year:pick("build_year"),size_display:pick("size_display")})?"CLASSIFIED":"REVIEW_REQUIRED",keeper.id);
    for(const duplicate of group.slice(1)){repointPiano(db,duplicate.id,keeper.id);db.prepare("DELETE FROM pianos WHERE id=?").run(duplicate.id);merged++;}
  }
  return merged;
}
function ensureReview(db,{clientId=null,pianoId=null,sourceName="EXISTING_DB",sourceInstrumentId=null,brand="",model="",serial="",buildYear=null,note="",reason="UNCLASSIFIED_PIANO"}){
  const existing=pianoId?db.prepare("SELECT id FROM client_piano_review_queue WHERE piano_id=? AND status='PENDING' LIMIT 1").get(pianoId):
    (sourceInstrumentId?db.prepare("SELECT id FROM client_piano_review_queue WHERE source_name=? AND source_instrument_id=? LIMIT 1").get(sourceName,sourceInstrumentId):null);
  if(existing)return existing.id;
  const info=db.prepare(`INSERT INTO client_piano_review_queue(client_id,piano_id,source_name,source_instrument_id,source_brand,source_model,source_serial_number,source_build_year,source_note,reason,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(clientId,pianoId,sourceName,sourceInstrumentId,clean(brand,200)||null,clean(model,200)||null,clean(serial,200)||null,buildYear||null,clean(note,4000)||null,reason);
  return Number(info.lastInsertRowid);
}
function classifyExistingUnknownPianos(db){
  let marked=0;
  for(const row of db.prepare("SELECT * FROM pianos ORDER BY id").all()){
    const classified=pianoClassified(row);
    const status=classified?"CLASSIFIED":"REVIEW_REQUIRED";
    if(String(row.classification_status||"")!==status)db.prepare("UPDATE pianos SET classification_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,row.id);
    if(!classified){ensureReview(db,{clientId:row.client_id,pianoId:row.id,brand:row.brand,model:row.model,serial:row.serial_number,buildYear:row.build_year,note:row.notes||row.location_notes,reason:"EXISTING_UNCLASSIFIED_PIANO"});marked++;}
  }
  return marked;
}
function sourceClientMatch(db,source){
  const rows=db.prepare("SELECT * FROM clients ORDER BY id").all(),name=norm(source.name),address=norm(source.address),email=normEmail(source.email),phone=normPhone(source.phone);
  const scored=[];
  for(const row of rows){
    let score=0;if(email&&normEmail(row.email)===email)score+=5;if(phone&&normPhone(row.phone)===phone)score+=4;if(name&&norm(row.name)===name)score+=3;if(address&&norm(row.address)===address)score+=3;
    if(score>=6)scored.push({row,score});
  }
  scored.sort((a,b)=>b.score-a.score||a.row.id-b.row.id);return scored[0]?.row||null;
}
function upsertSourceClient(db,source,sourceName){
  if(source.source_id){const mapped=db.prepare("SELECT client_id FROM master_data_client_source_map WHERE source_name=? AND source_client_id=?").get(sourceName,source.source_id);if(mapped)return db.prepare("SELECT * FROM clients WHERE id=?").get(mapped.client_id);}
  let row=sourceClientMatch(db,source);
  if(!row){
    const fallbackName=clean(source.name,240)||(clean(source.source_id,80)?`Imported client ${clean(source.source_id,80)}`:(normEmail(source.email)||normPhone(source.phone)||clean(source.address,1000)?`Imported client ${normEmail(source.email)||normPhone(source.phone)||clean(source.address,1000).slice(0,48)}`:""));
    if(fallbackName){
      const info=db.prepare("INSERT INTO clients(name,email,phone,address,notes,client_type,created_at,updated_at) VALUES(?,?,?,?,?,'PRIVATE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
        .run(fallbackName,normEmail(source.email)||null,clean(source.phone,120)||null,clean(source.address,1000)||null,clean(source.notes,5000)||null);
      row=db.prepare("SELECT * FROM clients WHERE id=?").get(Number(info.lastInsertRowid));
    }
  }
  if(!row)return null;
  const next={name:clean(row.name)||clean(source.name,240),email:clean(row.email)||normEmail(source.email),phone:clean(row.phone)||clean(source.phone,120),address:clean(row.address)||clean(source.address,1000),notes:combineNotes(row.notes,source.notes)};
  db.prepare("UPDATE clients SET name=?,email=?,phone=?,address=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(next.name,next.email||null,next.phone||null,next.address||null,next.notes||null,row.id);
  if(source.source_id)db.prepare("INSERT OR REPLACE INTO master_data_client_source_map(source_name,source_client_id,client_id,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)").run(sourceName,source.source_id,row.id);
  return db.prepare("SELECT * FROM clients WHERE id=?").get(row.id);
}
function sourcePianoGroups(records){
  const serialGroups=new Map(),singles=[];
  for(const rec of records){
    const serial=normSerial(rec.instrument.serial_number),brand=brandFamily(rec.instrument.brand);
    if(serial&&brand){const key=brand+"|"+serial;if(!serialGroups.has(key))serialGroups.set(key,[]);serialGroups.get(key).push(rec);}else singles.push([rec]);
  }
  return [...serialGroups.values(),...singles];
}
function numericSourceId(value){const n=Number(clean(value));return Number.isFinite(n)?n:-1;}
function mergeSourcePianoGroup(group){
  const withClient=group.filter(rec=>clean(rec.client.source_id)||clean(rec.client.name));
  const chosen=[...(withClient.length?withClient:group)].sort((a,b)=>numericSourceId(b.instrument.source_id)-numericSourceId(a.instrument.source_id))[0];
  const ordered=[chosen,...group.filter(row=>row!==chosen).sort((a,b)=>numericSourceId(b.instrument.source_id)-numericSourceId(a.instrument.source_id))];
  const pick=field=>ordered.map(row=>row.instrument[field]).find(value=>value!==null&&value!==undefined&&clean(value)!=="")??null;
  return {chosen,sourceIds:[...new Set(group.map(row=>clean(row.instrument.source_id)).filter(Boolean))],instrument:{source_id:clean(chosen.instrument.source_id),brand:pick("brand"),model:pick("model"),size_display:pick("size_display"),color:pick("color"),serial_number:pick("serial_number"),build_year:pick("build_year"),note:combineNotes(...ordered.map(row=>row.instrument.note),...ordered.map(row=>row.instrument.last_service_title),...ordered.map(row=>row.instrument.last_service_description)),last_serviced_at:pick("last_serviced_at")}};
}
function existingPianoForSource(db,instrument,clientId){
  const serial=normSerial(instrument.serial_number),family=brandFamily(instrument.brand);
  const all=db.prepare("SELECT * FROM pianos ORDER BY id").all();
  if(serial&&family){const hits=all.filter(row=>normSerial(row.serial_number)===serial&&brandFamily(row.brand)===family);if(hits.length)return hits.sort((a,b)=>pianoScore(db,b)-pianoScore(db,a)||a.id-b.id)[0];}
  const model=norm(instrument.model);
  if(clientId&&family&&model){
    const hit=all.find(row=>Number(row.client_id)===Number(clientId)&&brandFamily(row.brand)===family&&norm(row.model)===model&&!normSerial(row.serial_number)&&!serial);
    if(hit)return hit;
  }
  return null;
}
function importLegacyInstrumentClientCsv(db,{content,sourceName="KLAVIERHAUS_CSV_2026_09_29"}){
  const records=parseLegacyInstrumentClientCsv(content),clientCache=new Map();let createdClients=0,updatedClients=0,createdPianos=0,updatedPianos=0,reviewItems=0,sourceDuplicates=0,unassigned=0;
  for(const rec of records){
    const key=rec.client.source_id||[normEmail(rec.client.email),normPhone(rec.client.phone),norm(rec.client.name),norm(rec.client.address)].join("|");
    if(!key||clientCache.has(key))continue;
    const beforeCount=db.prepare("SELECT COUNT(*) c FROM clients").get().c,client=upsertSourceClient(db,rec.client,sourceName),afterCount=db.prepare("SELECT COUNT(*) c FROM clients").get().c;
    if(client){clientCache.set(key,client);if(afterCount>beforeCount)createdClients++;else updatedClients++;}
  }
  for(const group of sourcePianoGroups(records)){
    if(group.length>1)sourceDuplicates++;
    const merged=mergeSourcePianoGroup(group),sourceClient=merged.chosen.client;
    const clientKey=sourceClient.source_id||[normEmail(sourceClient.email),normPhone(sourceClient.phone),norm(sourceClient.name),norm(sourceClient.address)].join("|");
    const client=clientKey?(clientCache.get(clientKey)||upsertSourceClient(db,sourceClient,sourceName)):null;
    const classified=!UNKNOWN_BRANDS.has(norm(merged.instrument.brand))&&Boolean(norm(merged.instrument.model)||normSerial(merged.instrument.serial_number)||merged.instrument.build_year||norm(merged.instrument.size_display));
    if(!classified){
      const reviewId=ensureReview(db,{clientId:client?.id||null,sourceName,sourceInstrumentId:merged.instrument.source_id,brand:merged.instrument.brand,model:merged.instrument.model,serial:merged.instrument.serial_number,buildYear:merged.instrument.build_year,note:merged.instrument.note,reason:client?"UNCLASSIFIED_SOURCE_PIANO":"UNASSIGNED_SOURCE_PIANO"});
      for(const sourceId of merged.sourceIds)db.prepare("INSERT OR REPLACE INTO master_data_piano_source_map(source_name,source_instrument_id,piano_id,review_id,updated_at) VALUES(?,?,NULL,?,CURRENT_TIMESTAMP)").run(sourceName,sourceId,reviewId);
      reviewItems++;if(!client)unassigned++;continue;
    }
    let piano=existingPianoForSource(db,merged.instrument,client?.id||null);
    if(!client&&!piano){
      const reviewId=ensureReview(db,{clientId:null,sourceName,sourceInstrumentId:merged.instrument.source_id,brand:merged.instrument.brand,model:merged.instrument.model,serial:merged.instrument.serial_number,buildYear:merged.instrument.build_year,note:merged.instrument.note,reason:"UNASSIGNED_SOURCE_PIANO"});
      for(const sourceId of merged.sourceIds)db.prepare("INSERT OR REPLACE INTO master_data_piano_source_map(source_name,source_instrument_id,piano_id,review_id,updated_at) VALUES(?,?,NULL,?,CURRENT_TIMESTAMP)").run(sourceName,sourceId,reviewId);
      reviewItems++;unassigned++;continue;
    }
    if(piano){
      db.prepare(`UPDATE pianos SET client_id=COALESCE(?,client_id),brand=COALESCE(NULLIF(?,''),brand),model=COALESCE(NULLIF(?,''),model),serial_number=COALESCE(NULLIF(?,''),serial_number),finish=COALESCE(NULLIF(?,''),finish),build_year=COALESCE(?,build_year),size_display=COALESCE(NULLIF(?,''),size_display),color=COALESCE(NULLIF(?,''),color),notes=COALESCE(NULLIF(?,''),notes),last_serviced_at=COALESCE(NULLIF(?,''),last_serviced_at),classification_status='CLASSIFIED',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(client?.id||null,clean(merged.instrument.brand,200),clean(merged.instrument.model,200),clean(merged.instrument.serial_number,200),clean(merged.instrument.color,160),merged.instrument.build_year,clean(merged.instrument.size_display,120),clean(merged.instrument.color,160),clean(merged.instrument.note,5000),clean(merged.instrument.last_serviced_at,40),piano.id);
      updatedPianos++;piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(piano.id);
    }else{
      const info=db.prepare(`INSERT INTO pianos(client_id,brand,model,serial_number,finish,location_notes,last_serviced_at,build_year,size_display,color,notes,classification_status,created_at,updated_at)
        VALUES(?,?,?,?,?,NULL,?,?,?,?,?,'CLASSIFIED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(client.id,clean(merged.instrument.brand,200),clean(merged.instrument.model,200)||null,clean(merged.instrument.serial_number,200)||null,clean(merged.instrument.color,160)||null,clean(merged.instrument.last_serviced_at,40)||null,merged.instrument.build_year,clean(merged.instrument.size_display,120)||null,clean(merged.instrument.color,160)||null,clean(merged.instrument.note,5000)||null);
      piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(Number(info.lastInsertRowid));createdPianos++;
    }
    for(const sourceId of merged.sourceIds)db.prepare("INSERT OR REPLACE INTO master_data_piano_source_map(source_name,source_instrument_id,piano_id,review_id,updated_at) VALUES(?,?,?,NULL,CURRENT_TIMESTAMP)").run(sourceName,sourceId,piano.id);
    db.prepare("UPDATE client_piano_review_queue SET status='RESOLVED',resolved_piano_id=?,resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE client_id=? AND status='PENDING' AND (source_serial_number IS NOT NULL AND replace(replace(replace(upper(source_serial_number),' ',''),'-',''),'.','')=?)").run(piano.id,piano.client_id,normSerial(piano.serial_number));
  }
  const after=reconcileExistingMasterData(db);
  return {rows:records.length,createdClients,updatedClients,createdPianos,updatedPianos,reviewItems,unassigned,sourceDuplicateGroups:sourceDuplicates,...after};
}
function reconcileExistingMasterData(db){
  const mergedClients=mergeExistingClients(db),mergedPianos=mergeExistingPianos(db),reviewRequired=classifyExistingUnknownPianos(db);
  return {mergedClients,mergedPianos,reviewRequired};
}
module.exports={parseLegacyInstrumentClientCsv,importLegacyInstrumentClientCsv,reconcileExistingMasterData,normSerial,brandFamily,pianoClassified};
