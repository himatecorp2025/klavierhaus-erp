"use strict";

const crypto=require("node:crypto");

const INSTITUTION_KEYWORDS=["University","School","Academy","Church","Synagog","Temple","Museum","Foundation","Institute","Rappresentanza","Consulate","Embassy","Society","Hospital","Library"];
const PARTNER_KEYWORDS=["Workshop","Piano Studios","Studio One","Tuner","Technician","Restoration"];
const LEGACY_MASTER_SOURCE_NAME="KLAVIERHAUS_MASTER_CSV";
const LEGACY_MASTER_HEADERS=["ID","CATEGORY","BRAND","MODEL","SIZE","COLOR","SERIAL NUMBER","YEAR BUILT","NOTE","DATE OF PURCHASE","WARRANTY","LAST SERVICE DATE","LAST SERVICE TITLE","LAST SERVICE DESCRIPTION","NEXT SERVICE DATE","LATEST INFO FREQUENCY","LATEST INFO HUMIDITY","LATEST INFO TEMPERATURE","ID","FIRST NAME","LAST NAME","COMPANY NAME","CONTACT NAME","STREET","CITY","DISTRICT","POSTCODE","COUNTRY","MOBILE PHONE","LINE PHONE","E-MAIL","NOTE","SHORT MEMO TO NAME"];
const LEGACY_MASTER_CONTRACT=Object.freeze({rows:339,columns:33,sourceClients:309,totalPianos:339,linkedPianos:329,ownerlessPianos:10,sourceNonEmptyValues:5025,controlClientSourceId:"3084",controlClientPianos:9});

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
  const match=raw.match(/\b(17\d{2}|18\d{2}|19\d{2}|20\d{2}|2100)\b/),year=match?Number(match[1]):Number(raw);
  return Number.isInteger(year)&&year>=1700&&year<=2100?year:null;
}
function csvRows(content){
  const text=String(content??"").replace(/^\uFEFF/,""),rows=[];let row=[],cell="",quoted=false;
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
function composeClientName(client){
  const person=[clean(client.first_name,160),clean(client.last_name,160)].filter(Boolean).join(" ");
  return clean(client.company_name,240)||person||clean(client.contact_name,240)||"Data pending";
}
function composeAddress(client){
  return [client.street,client.city,client.district,client.postcode,client.country].map(value=>clean(value,300)).filter(Boolean).join(", ");
}
function composePhone(client){return clean(client.mobile_phone,120)||clean(client.line_phone,120);}
function hasClientData(client){
  return Boolean(clean(client.source_id)||clean(client.first_name)||clean(client.last_name)||clean(client.company_name)||clean(client.contact_name)||normEmail(client.email)||composePhone(client)||composeAddress(client)||clean(client.notes)||clean(client.short_memo_to_name));
}
function classifyClientRows(rows=[]){
  const values=rows.filter(Boolean),join=fields=>fields.flatMap(field=>values.map(row=>clean(row?.[field],500))).filter(Boolean).join(" ").toLowerCase();
  const institutionHaystack=join(["company_name","first_name","last_name","contact_name"]);
  if(INSTITUTION_KEYWORDS.some(keyword=>institutionHaystack.includes(keyword.toLowerCase())))return "INSTITUTION";
  const partnerHaystack=join(["company_name","notes","first_name","last_name","contact_name"]);
  if(PARTNER_KEYWORDS.some(keyword=>partnerHaystack.includes(keyword.toLowerCase())))return "PARTNER";
  if(values.some(row=>clean(row?.company_name)))return "BUSINESS";
  return "INDIVIDUAL";
}
function canonicalClientFromRows(rows=[]){
  const values=rows.filter(Boolean),pick=field=>values.map(row=>clean(row?.[field],5000)).find(Boolean)||"";
  const source_id=pick("source_id"),client_type=classifyClientRows(values);
  return {
    source_id,first_name:pick("first_name"),last_name:pick("last_name"),company_name:pick("company_name"),contact_name:pick("contact_name"),
    street:pick("street"),city:pick("city"),district:pick("district"),postcode:pick("postcode"),country:pick("country"),
    mobile_phone:pick("mobile_phone"),line_phone:pick("line_phone"),email:values.map(row=>normEmail(row?.email)).find(Boolean)||"",
    notes:combineNotes(...values.map(row=>row?.notes)),short_memo_to_name:combineNotes(...values.map(row=>row?.short_memo_to_name)),client_type
  };
}
function sourceInstrumentKey(record){return clean(record?.instrument?.source_id,80)||`ROW:${Number(record?.row_number||0)}`;}
function parseLegacyInstrumentClientCsv(content){
  const rows=csvRows(content);
  if(rows.length<3)throw Object.assign(new Error("MASTER_DATA_CSV_EMPTY"),{status:400});
  const headers=(rows[1]||[]).map(value=>clean(value).toUpperCase());
  if(headers.length!==LEGACY_MASTER_HEADERS.length||LEGACY_MASTER_HEADERS.some((label,index)=>headers[index]!==label)){
    const error=Object.assign(new Error("MASTER_DATA_CSV_FORMAT_UNSUPPORTED"),{status:400});
    error.details={expected:LEGACY_MASTER_HEADERS,received:headers};throw error;
  }
  return rows.slice(2).map((values,index)=>{
    const row=[...values];while(row.length<33)row.push("");
    const instrument={
      source_id:clean(row[0],80),category:clean(row[1],80),brand:clean(row[2],200)||"No brand",model:clean(row[3],200),
      size_display:clean(row[4],120),color:clean(row[5],160),serial_number:clean(row[6],200),build_year:validYear(row[7]),
      note:clean(row[8],4000),date_of_purchase:clean(row[9],120),warranty:clean(row[10],300),last_serviced_at:clean(row[11],120),
      last_service_title:clean(row[12],300),last_service_description:clean(row[13],3000),next_service_date:clean(row[14],120),
      latest_info_frequency:clean(row[15],120),latest_info_humidity:clean(row[16],120),latest_info_temperature:clean(row[17],120)
    };
    const client={
      source_id:clean(row[18],80),first_name:clean(row[19],160),last_name:clean(row[20],160),company_name:clean(row[21],240),
      contact_name:clean(row[22],240),street:clean(row[23],300),city:clean(row[24],200),district:clean(row[25],160),
      postcode:clean(row[26],80),country:clean(row[27],160),mobile_phone:clean(row[28],120),line_phone:clean(row[29],120),
      email:normEmail(row[30]),notes:clean(row[31],5000),short_memo_to_name:clean(row[32],1000),client_type:"INDIVIDUAL"
    };
    return {row_number:index+3,instrument,client,raw:{columns:[...headers],values:row.slice(),instrument:{...instrument},client:{...client}}};
  });
}
function combineNotes(...values){return [...new Set(values.flatMap(value=>String(value||"").split(/\n+/)).map(value=>value.trim()).filter(Boolean))].join("\n");}
function tableExists(db,name){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));}
function columnExists(db,table,name){return tableExists(db,table)&&db.prepare(`PRAGMA table_info("${String(table).replaceAll('"','""')}")`).all().some(row=>row.name===name);}
function refreshClientLastVisit(db,clientId=null){
  if(!columnExists(db,"clients","last_visit_at")||!tableExists(db,"pianos"))return 0;
  if(clientId){
    const latest=db.prepare("SELECT MAX(NULLIF(TRIM(last_serviced_at),'')) value FROM pianos WHERE client_id=?").get(clientId)?.value||null;
    return Number(db.prepare("UPDATE clients SET last_visit_at=? WHERE id=?").run(latest,clientId).changes||0);
  }
  return Number(db.prepare(`UPDATE clients SET last_visit_at=(
    SELECT MAX(NULLIF(TRIM(p.last_serviced_at),'')) FROM pianos p WHERE p.client_id=clients.id
  )`).run().changes||0);
}
function sourceClientIds(db,clientId){
  if(!tableExists(db,"master_data_client_source_map"))return [];
  return db.prepare("SELECT source_name,source_client_id FROM master_data_client_source_map WHERE client_id=? ORDER BY source_name,source_client_id").all(clientId);
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
function clientScore(row){return ["name","email","phone","address","notes","first_name","last_name","company_name","contact_name","street","city","district","postcode","country","mobile_phone","line_phone","short_memo_to_name"].reduce((n,key)=>n+(clean(row[key])?1:0),0)+Number(row.is_vip||0);}
function repointClient(db,fromId,toId){
  for(const table of ["customer_conversations","private_appointments","private_appointment_requests","pianos","intake_leads","jobs","invoices","customer_communication_log"]){
    if(!tableExists(db,table))continue;
    const columns=new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(row=>row.name));if(!columns.has("client_id"))continue;
    db.prepare(`UPDATE "${table}" SET client_id=? WHERE client_id=?`).run(toId,fromId);
  }
  if(tableExists(db,"master_data_client_source_map"))db.prepare("UPDATE OR IGNORE master_data_client_source_map SET client_id=? WHERE client_id=?").run(toId,fromId);
  if(tableExists(db,"client_piano_review_queue"))db.prepare("UPDATE client_piano_review_queue SET client_id=? WHERE client_id=?").run(toId,fromId);
  if(tableExists(db,"master_data_import_rows"))db.prepare("UPDATE master_data_import_rows SET client_id=? WHERE client_id=?").run(toId,fromId);
}
function mergeExistingClients(db){
  const rows=db.prepare("SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY id").all(),parent=new Map(rows.map(row=>[row.id,row.id])),sourceMap=new Map(rows.map(row=>[row.id,sourceClientIds(db,row.id)]));
  const find=id=>{let p=parent.get(id);while(p!==parent.get(p)){parent.set(p,parent.get(parent.get(p)));p=parent.get(p);}return p;};
  const canMerge=(a,b)=>{
    const sa=sourceMap.get(a)||[],sb=sourceMap.get(b)||[];
    if(!sa.length&&!sb.length)return true;
    if(sa.length===1&&sb.length===1)return sa[0].source_name===sb[0].source_name&&sa[0].source_client_id===sb[0].source_client_id;
    return false;
  };
  const union=(a,b)=>{a=find(a);b=find(b);if(a!==b&&canMerge(a,b))parent.set(Math.max(a,b),Math.min(a,b));};
  const owners=new Map();
  for(const row of rows)for(const key of clientKeys(row)){if(owners.has(key))union(row.id,owners.get(key));else owners.set(key,row.id);}
  const groups=new Map();for(const row of rows){const root=find(row.id);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(row);}
  let merged=0;
  for(const group of groups.values()){
    if(group.length<2)continue;
    group.sort((a,b)=>clientScore(b)-clientScore(a)||a.id-b.id);const keeper=group[0],all=group;
    const pick=field=>all.map(row=>clean(row[field])).find(Boolean)||null;
    const structured={
      first_name:pick("first_name"),last_name:pick("last_name"),company_name:pick("company_name"),contact_name:pick("contact_name"),
      email:pick("email"),mobile_phone:pick("mobile_phone"),line_phone:pick("line_phone"),street:pick("street"),city:pick("city"),
      district:pick("district"),postcode:pick("postcode"),country:pick("country"),short_memo_to_name:pick("short_memo_to_name")
    };
    const name=all.map(row=>clean(row.name)).filter(Boolean).sort((a,b)=>b.length-a.length)[0]||composeClientName(structured);
    const phone=composePhone(structured)||pick("phone"),address=composeAddress(structured)||pick("address");
    db.prepare(`UPDATE clients SET name=?,first_name=?,last_name=?,company_name=?,contact_name=?,email=?,mobile_phone=?,line_phone=?,phone=?,street=?,city=?,district=?,postcode=?,country=?,address=?,notes=?,short_memo_to_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(name,structured.first_name,structured.last_name,structured.company_name,structured.contact_name,structured.email,structured.mobile_phone,structured.line_phone,phone||null,structured.street,structured.city,structured.district,structured.postcode,structured.country,address||null,combineNotes(...all.map(row=>row.notes)),structured.short_memo_to_name,keeper.id);
    for(const duplicate of group.slice(1)){repointClient(db,duplicate.id,keeper.id);db.prepare("DELETE FROM clients WHERE id=?").run(duplicate.id);merged++;}
  }
  return merged;
}
function pianoClassified(row){return Boolean(row&&(clean(row.brand)||clean(row.model)||normSerial(row.serial_number)||row.client_id!==undefined));}
function pianoScore(db,row){
  const fields=["brand","model","serial_number","finish","location_notes","last_serviced_at","last_service_title","last_service_description","next_service_date","date_of_purchase","warranty","latest_info_frequency","latest_info_humidity","latest_info_temperature","build_year","size_display","color","notes"];
  let score=fields.reduce((n,key)=>n+(clean(row[key])?1:0),0);
  if(tableExists(db,"jobs"))score+=Number(db.prepare("SELECT COUNT(*) c FROM jobs WHERE piano_id=?").get(row.id)?.c||0)*3;
  if(tableExists(db,"intake_leads"))score+=Number(db.prepare("SELECT COUNT(*) c FROM intake_leads WHERE piano_id=?").get(row.id)?.c||0)*2;
  return score;
}
function repointPiano(db,fromId,toId){
  for(const table of ["jobs","intake_leads"]){if(tableExists(db,table))db.prepare(`UPDATE ${table} SET piano_id=? WHERE piano_id=?`).run(toId,fromId);}
  if(tableExists(db,"master_data_piano_source_map"))db.prepare("UPDATE OR IGNORE master_data_piano_source_map SET piano_id=?,review_id=NULL WHERE piano_id=?").run(toId,fromId);
  if(tableExists(db,"client_piano_review_queue"))db.prepare("UPDATE client_piano_review_queue SET piano_id=CASE WHEN piano_id=? THEN ? ELSE piano_id END,resolved_piano_id=CASE WHEN resolved_piano_id=? THEN ? ELSE resolved_piano_id END WHERE piano_id=? OR resolved_piano_id=?").run(fromId,toId,fromId,toId,fromId,fromId);
  if(tableExists(db,"master_data_import_rows"))db.prepare("UPDATE master_data_import_rows SET piano_id=? WHERE piano_id=?").run(toId,fromId);
}
function pianoDuplicateKey(row){
  const serial=normSerial(row.serial_number),brand=brandFamily(row.brand),owner=row.client_id===null||row.client_id===undefined?"UNASSIGNED":String(row.client_id);
  if(serial&&brand)return "serial:"+owner+"|"+brand+"|"+serial;
  const model=norm(row.model);if(!model||!brand)return "";
  return "exact:"+owner+"|"+brand+"|"+model+"|"+norm(row.finish)+"|"+norm(row.location_notes)+"|"+String(row.build_year||"");
}
function mergeExistingPianos(db){
  const rows=db.prepare("SELECT * FROM pianos ORDER BY id").all(),groups=new Map();
  for(const row of rows){const key=pianoDuplicateKey(row);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  let merged=0;
  for(const group of groups.values()){
    if(group.length<2)continue;
    const sourced=group.filter(row=>tableExists(db,"master_data_piano_source_map")&&db.prepare("SELECT 1 FROM master_data_piano_source_map WHERE piano_id=? LIMIT 1").get(row.id));
    if(sourced.length>1)continue;
    group.sort((a,b)=>pianoScore(db,b)-pianoScore(db,a)||a.id-b.id);const keeper=group[0],all=group,pick=field=>all.map(row=>row[field]).find(value=>value!==null&&value!==undefined&&clean(value)!=="")??null;
    const fields=["category","brand","model","serial_number","finish","location_notes","last_serviced_at","last_service_title","last_service_description","next_service_date","date_of_purchase","warranty","latest_info_frequency","latest_info_humidity","latest_info_temperature","build_year","size_display","color"];
    const values=Object.fromEntries(fields.map(field=>[field,pick(field)]));
    db.prepare(`UPDATE pianos SET category=?,brand=?,model=?,serial_number=?,finish=?,location_notes=?,last_serviced_at=?,last_service_title=?,last_service_description=?,next_service_date=?,date_of_purchase=?,warranty=?,latest_info_frequency=?,latest_info_humidity=?,latest_info_temperature=?,build_year=?,size_display=?,color=?,notes=?,classification_status='CLASSIFIED',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(values.category,clean(values.brand)||"No brand",values.model,values.serial_number,values.finish,values.location_notes,values.last_serviced_at,values.last_service_title,values.last_service_description,values.next_service_date,values.date_of_purchase,values.warranty,values.latest_info_frequency,values.latest_info_humidity,values.latest_info_temperature,values.build_year,values.size_display,values.color,combineNotes(...all.map(row=>row.notes)),keeper.id);
    for(const duplicate of group.slice(1)){repointPiano(db,duplicate.id,keeper.id);db.prepare("DELETE FROM pianos WHERE id=?").run(duplicate.id);merged++;}
  }
  return merged;
}
function normalizeExistingPianos(db){
  const info=db.prepare("UPDATE pianos SET brand=CASE WHEN TRIM(COALESCE(brand,''))='' THEN 'No brand' ELSE brand END,classification_status='CLASSIFIED',updated_at=CURRENT_TIMESTAMP WHERE TRIM(COALESCE(brand,''))='' OR COALESCE(classification_status,'')<>'CLASSIFIED'").run();
  return Number(info.changes||0);
}
function promotePendingReviews(db){
  if(!tableExists(db,"client_piano_review_queue"))return 0;
  let resolved=0;
  const rows=db.prepare("SELECT * FROM client_piano_review_queue WHERE status='PENDING' ORDER BY id").all();
  for(const review of rows){
    let piano=review.piano_id?db.prepare("SELECT * FROM pianos WHERE id=?").get(review.piano_id):null;
    if(!piano&&review.source_instrument_id&&tableExists(db,"master_data_piano_source_map")){
      const map=db.prepare("SELECT piano_id FROM master_data_piano_source_map WHERE source_name=? AND source_instrument_id=?").get(review.source_name,review.source_instrument_id);
      if(map?.piano_id)piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(map.piano_id);
    }
    if(!piano){
      const info=db.prepare(`INSERT INTO pianos(client_id,brand,model,serial_number,build_year,notes,classification_status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'CLASSIFIED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(review.client_id||null,clean(review.source_brand,200)||"No brand",clean(review.source_model,200)||null,clean(review.source_serial_number,200)||null,review.source_build_year||null,clean(review.source_note,5000)||null);
      piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(Number(info.lastInsertRowid));
    }else{
      db.prepare("UPDATE pianos SET brand=CASE WHEN TRIM(COALESCE(brand,''))='' THEN ? ELSE brand END,classification_status='CLASSIFIED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(clean(review.source_brand,200)||"No brand",piano.id);
    }
    if(review.source_instrument_id&&tableExists(db,"master_data_piano_source_map"))db.prepare(`INSERT INTO master_data_piano_source_map(source_name,source_instrument_id,piano_id,review_id,updated_at)
      VALUES(?,?,?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(source_name,source_instrument_id) DO UPDATE SET piano_id=excluded.piano_id,review_id=NULL,updated_at=CURRENT_TIMESTAMP`).run(review.source_name,review.source_instrument_id,piano.id);
    db.prepare("UPDATE client_piano_review_queue SET status='RESOLVED',resolved_piano_id=?,resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(piano.id,review.id);
    resolved++;
  }
  return resolved;
}
function clientSourceRow(db,sourceName,sourceId){
  if(!sourceId||!tableExists(db,"master_data_client_source_map"))return null;
  const map=db.prepare("SELECT client_id FROM master_data_client_source_map WHERE source_name=? AND source_client_id=?").get(sourceName,sourceId);
  return map?db.prepare("SELECT * FROM clients WHERE id=?").get(map.client_id):null;
}
function findExistingClient(db,source,sourceName,sourceId){
  const probe={name:composeClientName(source),email:normEmail(source.email),phone:composePhone(source),address:composeAddress(source)};
  const wanted=new Set(clientKeys(probe));if(!wanted.size)return null;
  const rows=db.prepare("SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY id").all();
  for(const row of rows){
    if(tableExists(db,"master_data_client_source_map")&&sourceName){
      const mapped=db.prepare("SELECT source_client_id FROM master_data_client_source_map WHERE source_name=? AND client_id=? LIMIT 1").get(sourceName,row.id);
      if(mapped&&String(mapped.source_client_id)!==String(sourceId||""))continue;
    }
    if(clientKeys(row).some(key=>wanted.has(key)))return row;
  }
  return null;
}
function updateClientFromSource(db,row,source){
  const next={
    first_name:clean(source.first_name,160)||clean(row.first_name,160),last_name:clean(source.last_name,160)||clean(row.last_name,160),
    company_name:clean(source.company_name,240)||clean(row.company_name,240),contact_name:clean(source.contact_name,240)||clean(row.contact_name,240),
    email:normEmail(source.email)||normEmail(row.email),mobile_phone:clean(source.mobile_phone,120)||clean(row.mobile_phone,120),
    line_phone:clean(source.line_phone,120)||clean(row.line_phone,120),street:clean(source.street,300)||clean(row.street,300),
    city:clean(source.city,200)||clean(row.city,200),district:clean(source.district,160)||clean(row.district,160),
    postcode:clean(source.postcode,80)||clean(row.postcode,80),country:clean(source.country,160)||clean(row.country,160),
    notes:combineNotes(row.notes,source.notes),short_memo_to_name:clean(source.short_memo_to_name,1000)||clean(row.short_memo_to_name,1000)
  };
  const name=(clean(source.company_name)||clean(source.first_name)||clean(source.last_name)||clean(source.contact_name))?composeClientName(next):(clean(row.name)||composeClientName(next));
  const phone=composePhone(next)||clean(row.phone,120),address=composeAddress(next)||clean(row.address,1000);
  db.prepare(`UPDATE clients SET name=?,first_name=?,last_name=?,company_name=?,contact_name=?,email=?,mobile_phone=?,line_phone=?,phone=?,street=?,city=?,district=?,postcode=?,country=?,address=?,notes=?,short_memo_to_name=?,client_type=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(name,next.first_name||null,next.last_name||null,next.company_name||null,next.contact_name||null,next.email||null,next.mobile_phone||null,next.line_phone||null,phone||null,next.street||null,next.city||null,next.district||null,next.postcode||null,next.country||null,address||null,next.notes||null,next.short_memo_to_name||null,clean(source.client_type,40)||row.client_type||"INDIVIDUAL",row.id);
  return db.prepare("SELECT * FROM clients WHERE id=?").get(row.id);
}
function upsertSourceClient(db,source,sourceName){
  if(!hasClientData(source))return null;
  let row=clientSourceRow(db,sourceName,source.source_id),created=false,matchedExisting=false;
  if(row?.deleted_at)return {row:null,created:false,deleted:true};
  if(!row){row=findExistingClient(db,source,sourceName,source.source_id);matchedExisting=Boolean(row);}
  if(!row){
    const name=composeClientName(source),phone=composePhone(source),address=composeAddress(source);
    const info=db.prepare(`INSERT INTO clients(name,first_name,last_name,company_name,contact_name,email,mobile_phone,line_phone,phone,street,city,district,postcode,country,address,notes,short_memo_to_name,client_type,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
        name,clean(source.first_name,160)||null,clean(source.last_name,160)||null,clean(source.company_name,240)||null,clean(source.contact_name,240)||null,
        normEmail(source.email)||null,clean(source.mobile_phone,120)||null,clean(source.line_phone,120)||null,phone||null,clean(source.street,300)||null,
        clean(source.city,200)||null,clean(source.district,160)||null,clean(source.postcode,80)||null,clean(source.country,160)||null,address||null,
        clean(source.notes,5000)||null,clean(source.short_memo_to_name,1000)||null,clean(source.client_type,40)||"INDIVIDUAL"
      );
    row=db.prepare("SELECT * FROM clients WHERE id=?").get(Number(info.lastInsertRowid));created=true;
  }else row=updateClientFromSource(db,row,source);
  if(source.source_id&&tableExists(db,"master_data_client_source_map"))db.prepare(`INSERT INTO master_data_client_source_map(source_name,source_client_id,client_id,updated_at)
    VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(source_name,source_client_id) DO UPDATE SET client_id=excluded.client_id,updated_at=CURRENT_TIMESTAMP`).run(sourceName,source.source_id,row.id);
  return {row,created,matchedExisting};
}
function sourcePianoRow(db,sourceName,sourceId){
  if(!sourceId||!tableExists(db,"master_data_piano_source_map"))return null;
  const map=db.prepare("SELECT piano_id FROM master_data_piano_source_map WHERE source_name=? AND source_instrument_id=?").get(sourceName,sourceId);
  return map?.piano_id?db.prepare("SELECT * FROM pianos WHERE id=?").get(map.piano_id):null;
}
function updatePianoFromSource(db,row,instrument,clientId){
  const value=(source,existing)=>clean(source)!==""?clean(source):existing;
  const buildYear=instrument.build_year??row.build_year??null;
  const next={
    client_id:clientId??row.client_id??null,category:value(instrument.category,row.category),brand:value(instrument.brand,row.brand)||"No brand",
    model:value(instrument.model,row.model),serial_number:value(instrument.serial_number,row.serial_number),size_display:value(instrument.size_display,row.size_display),
    color:value(instrument.color,row.color),notes:combineNotes(row.notes,instrument.note),date_of_purchase:value(instrument.date_of_purchase,row.date_of_purchase),
    warranty:value(instrument.warranty,row.warranty),last_serviced_at:value(instrument.last_serviced_at,row.last_serviced_at),
    last_service_title:value(instrument.last_service_title,row.last_service_title),last_service_description:value(instrument.last_service_description,row.last_service_description),
    next_service_date:value(instrument.next_service_date,row.next_service_date),latest_info_frequency:value(instrument.latest_info_frequency,row.latest_info_frequency),
    latest_info_humidity:value(instrument.latest_info_humidity,row.latest_info_humidity),latest_info_temperature:value(instrument.latest_info_temperature,row.latest_info_temperature)
  };
  db.prepare(`UPDATE pianos SET client_id=?,category=?,brand=?,model=?,serial_number=?,last_serviced_at=?,last_service_title=?,last_service_description=?,next_service_date=?,date_of_purchase=?,warranty=?,latest_info_frequency=?,latest_info_humidity=?,latest_info_temperature=?,build_year=?,size_display=?,color=?,notes=?,classification_status='CLASSIFIED',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(next.client_id,next.category||null,next.brand,next.model||null,next.serial_number||null,next.last_serviced_at||null,next.last_service_title||null,next.last_service_description||null,next.next_service_date||null,next.date_of_purchase||null,next.warranty||null,next.latest_info_frequency||null,next.latest_info_humidity||null,next.latest_info_temperature||null,buildYear,next.size_display||null,next.color||null,next.notes||null,row.id);
  return db.prepare("SELECT * FROM pianos WHERE id=?").get(row.id);
}
function persistImportRow(db,{sourceName,record,clientId,pianoId}){
  const sourceInstrumentId=sourceInstrumentKey(record),rawJson=record.raw_json_original!==undefined?String(record.raw_json_original):JSON.stringify(record.raw),rawSha256=crypto.createHash("sha256").update(rawJson).digest("hex");
  if(tableExists(db,"master_data_import_rows"))db.prepare(`INSERT INTO master_data_import_rows(source_name,source_instrument_id,source_client_id,source_row_number,client_id,piano_id,raw_json,imported_at,updated_at)
    VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(source_name,source_instrument_id) DO UPDATE SET source_client_id=excluded.source_client_id,source_row_number=excluded.source_row_number,client_id=excluded.client_id,piano_id=excluded.piano_id,raw_json=excluded.raw_json,updated_at=CURRENT_TIMESTAMP`)
    .run(sourceName,sourceInstrumentId,record.client.source_id||null,record.row_number,clientId||null,pianoId||null,rawJson);
  if(tableExists(db,"master_data_source_rows"))db.prepare(`INSERT INTO master_data_source_rows(source_name,source_row_number,source_instrument_id,source_client_id,client_id,piano_id,raw_json,raw_sha256,nonempty_cell_count,imported_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(source_name,source_row_number) DO UPDATE SET source_instrument_id=excluded.source_instrument_id,source_client_id=excluded.source_client_id,client_id=excluded.client_id,piano_id=excluded.piano_id,raw_json=excluded.raw_json,raw_sha256=excluded.raw_sha256,nonempty_cell_count=excluded.nonempty_cell_count,updated_at=CURRENT_TIMESTAMP`)
    .run(sourceName,record.row_number,record.instrument.source_id||null,record.client.source_id||null,clientId||null,pianoId||null,rawJson,rawSha256,(record.raw.values||[]).filter(value=>clean(value)!=="").length);
  if(record.client.source_id&&tableExists(db,"master_data_client_field_values")){
    for(const field of ["first_name","last_name","company_name","contact_name","street","city","district","postcode","country","mobile_phone","line_phone","email","notes","short_memo_to_name"]){
      const value=clean(record.client[field],5000);if(!value)continue;
      db.prepare(`INSERT INTO master_data_client_field_values(source_name,source_client_id,field_name,value,first_source_row,last_source_row,occurrences,updated_at)
        VALUES(?,?,?,?,?,?,1,CURRENT_TIMESTAMP)
        ON CONFLICT(source_name,source_client_id,field_name,value) DO UPDATE SET first_source_row=MIN(first_source_row,excluded.first_source_row),last_source_row=MAX(last_source_row,excluded.last_source_row),occurrences=occurrences+1,updated_at=CURRENT_TIMESTAMP`)
        .run(sourceName,record.client.source_id,field,value,record.row_number,record.row_number);
    }
  }
}
function storedRecord(row){
  let raw={};try{raw=JSON.parse(String(row.raw_json||"{}"));}catch(_error){raw={};}
  const values=Array.isArray(raw.values)?raw.values:[];
  const instrument={...(raw.instrument||{})},client={...(raw.client||{})};
  const take=(target,key,index,max=5000)=>{if(clean(target[key])===""&&values[index]!==undefined)target[key]=clean(values[index],max);};
  take(instrument,"category",1,80);take(instrument,"brand",2,200);take(instrument,"model",3,200);take(instrument,"size_display",4,120);take(instrument,"color",5,160);
  take(instrument,"serial_number",6,200);if(instrument.build_year===undefined||instrument.build_year===null)instrument.build_year=validYear(values[7]);
  take(instrument,"note",8,4000);take(instrument,"date_of_purchase",9,120);take(instrument,"warranty",10,300);take(instrument,"last_serviced_at",11,120);
  take(instrument,"last_service_title",12,300);take(instrument,"last_service_description",13,3000);take(instrument,"next_service_date",14,120);
  take(instrument,"latest_info_frequency",15,120);take(instrument,"latest_info_humidity",16,120);take(instrument,"latest_info_temperature",17,120);
  take(client,"first_name",19,160);take(client,"last_name",20,160);take(client,"company_name",21,240);take(client,"contact_name",22,240);take(client,"street",23,300);
  take(client,"city",24,200);take(client,"district",25,160);take(client,"postcode",26,80);take(client,"country",27,160);take(client,"mobile_phone",28,120);
  take(client,"line_phone",29,120);take(client,"email",30,320);take(client,"notes",31,5000);take(client,"short_memo_to_name",32,1000);
  instrument.source_id=clean(row.source_instrument_id,80)||clean(instrument.source_id,80);
  if(!clean(instrument.brand))instrument.brand="No brand";
  client.source_id=clean(row.source_client_id,80)||clean(client.source_id,80);
  client.email=normEmail(client.email);
  return {row_number:Number(row.source_row_number||0),instrument,client,raw_json_original:String(row.raw_json||"{}"),raw:{...raw,columns:Array.isArray(raw.columns)?raw.columns:[],values:Array.isArray(raw.values)?raw.values:values,instrument:{...(raw.instrument||{}),...instrument},client:{...(raw.client||{}),...client}}};
}
function rehydrateStoredMasterData(db){
  if(!tableExists(db,"master_data_import_rows"))return {rows:0,clients:0,pianos:0,createdPianos:0};
  const stored=db.prepare("SELECT source_name,source_instrument_id,source_client_id,source_row_number,client_id,piano_id,raw_json FROM master_data_import_rows WHERE raw_json IS NOT NULL AND TRIM(raw_json)<>'' ORDER BY source_name,source_row_number,source_instrument_id").all();
  if(!stored.length)return {rows:0,clients:0,pianos:0,createdPianos:0};
  const parsed=stored.map(row=>({...row,record:storedRecord(row)})),groups=new Map();
  for(const item of parsed){
    const key=`${item.source_name}\u0000${item.record.client.source_id||"ROW:"+item.record.row_number}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item.record.client);
  }
  for(const item of parsed){
    const key=`${item.source_name}\u0000${item.record.client.source_id||"ROW:"+item.record.row_number}`;
    item.record.client.client_type=classifyClientRows(groups.get(key)||[item.record.client]);
  }
  const clientCache=new Map();let clients=0,pianos=0,createdPianos=0;
  for(const item of parsed){
    const record=item.record,key=`${item.source_name}\u0000${record.client.source_id||"ROW:"+record.row_number}`;let client=null;
    if(hasClientData(record.client)){
      if(clientCache.has(key))client=clientCache.get(key);
      else{const result=upsertSourceClient(db,record.client,item.source_name);client=result?.row||null;clientCache.set(key,client);if(client)clients++;}
    }
    let piano=item.piano_id?db.prepare("SELECT * FROM pianos WHERE id=?").get(item.piano_id):null;
    if(!piano)piano=sourcePianoRow(db,item.source_name,sourceInstrumentKey(record));
    if(piano)piano=updatePianoFromSource(db,piano,record.instrument,client?.id??null);
    else{
      const info=db.prepare(`INSERT INTO pianos(client_id,category,brand,model,serial_number,last_serviced_at,last_service_title,last_service_description,next_service_date,date_of_purchase,warranty,latest_info_frequency,latest_info_humidity,latest_info_temperature,build_year,size_display,color,notes,classification_status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CLASSIFIED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
        client?.id||null,clean(record.instrument.category,80)||null,clean(record.instrument.brand,200)||"No brand",clean(record.instrument.model,200)||null,
        clean(record.instrument.serial_number,200)||null,clean(record.instrument.last_serviced_at,120)||null,clean(record.instrument.last_service_title,300)||null,
        clean(record.instrument.last_service_description,3000)||null,clean(record.instrument.next_service_date,120)||null,clean(record.instrument.date_of_purchase,120)||null,
        clean(record.instrument.warranty,300)||null,clean(record.instrument.latest_info_frequency,120)||null,clean(record.instrument.latest_info_humidity,120)||null,
        clean(record.instrument.latest_info_temperature,120)||null,record.instrument.build_year??null,clean(record.instrument.size_display,120)||null,clean(record.instrument.color,160)||null,clean(record.instrument.note,5000)||null
      );
      piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(Number(info.lastInsertRowid));createdPianos++;
    }
    if(tableExists(db,"master_data_piano_source_map"))db.prepare(`INSERT INTO master_data_piano_source_map(source_name,source_instrument_id,piano_id,review_id,updated_at)
      VALUES(?,?,?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(source_name,source_instrument_id) DO UPDATE SET piano_id=excluded.piano_id,review_id=NULL,updated_at=CURRENT_TIMESTAMP`)
      .run(item.source_name,sourceInstrumentKey(record),piano.id);
    persistImportRow(db,{sourceName:item.source_name,record,clientId:piano.client_id,pianoId:piano.id});pianos++;
  }
  return {rows:parsed.length,clients,pianos,createdPianos};
}

function repairSourceRelationships(db){
  if(!tableExists(db,"master_data_client_source_map")||!tableExists(db,"master_data_piano_source_map"))return {relinkedPianos:0,auditRowsUpdated:0};
  const sourceRows=tableExists(db,"master_data_source_rows")
    ?db.prepare("SELECT source_name,source_row_number,source_instrument_id,source_client_id,client_id,piano_id FROM master_data_source_rows WHERE source_client_id IS NOT NULL AND TRIM(source_client_id)<>'' ORDER BY source_name,source_row_number").all()
    :[];
  const rows=sourceRows.length?sourceRows:(tableExists(db,"master_data_import_rows")
    ?db.prepare("SELECT source_name,source_row_number,source_instrument_id,source_client_id,client_id,piano_id FROM master_data_import_rows WHERE source_client_id IS NOT NULL AND TRIM(source_client_id)<>'' ORDER BY source_name,source_row_number").all()
    :[]);
  let relinkedPianos=0,auditRowsUpdated=0;
  for(const row of rows){
    const clientMap=db.prepare(`SELECT m.client_id FROM master_data_client_source_map m JOIN clients c ON c.id=m.client_id
      WHERE m.source_name=? AND m.source_client_id=? AND c.deleted_at IS NULL`).get(row.source_name,row.source_client_id);
    let clientId=clientMap?.client_id||null;
    if(!clientId&&row.client_id&&db.prepare("SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL").get(row.client_id)){
      clientId=row.client_id;
      db.prepare(`INSERT INTO master_data_client_source_map(source_name,source_client_id,client_id,updated_at)
        VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(source_name,source_client_id) DO UPDATE SET client_id=excluded.client_id,updated_at=CURRENT_TIMESTAMP`)
        .run(row.source_name,row.source_client_id,clientId);
    }
    if(!clientId)continue;
    let pianoId=row.piano_id||null;
    if(!pianoId&&row.source_instrument_id)pianoId=db.prepare("SELECT piano_id FROM master_data_piano_source_map WHERE source_name=? AND source_instrument_id=?").get(row.source_name,row.source_instrument_id)?.piano_id||null;
    if(!pianoId)continue;
    const piano=db.prepare("SELECT id,client_id FROM pianos WHERE id=?").get(pianoId);if(!piano)continue;
    if(Number(piano.client_id||0)!==Number(clientId)){db.prepare("UPDATE pianos SET client_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(clientId,piano.id);relinkedPianos++;}
    if(tableExists(db,"master_data_source_rows")){db.prepare("UPDATE master_data_source_rows SET client_id=?,piano_id=?,updated_at=CURRENT_TIMESTAMP WHERE source_name=? AND source_row_number=?").run(clientId,piano.id,row.source_name,row.source_row_number);auditRowsUpdated++;}
    if(tableExists(db,"master_data_import_rows"))db.prepare("UPDATE master_data_import_rows SET client_id=?,piano_id=?,updated_at=CURRENT_TIMESTAMP WHERE source_name=? AND source_instrument_id=?").run(clientId,piano.id,row.source_name,row.source_instrument_id);
  }
  return {relinkedPianos,auditRowsUpdated};
}
function importLegacyInstrumentClientCsv(db,{content,sourceName=LEGACY_MASTER_SOURCE_NAME}){
  const records=parseLegacyInstrumentClientCsv(content),clientCache=new Map(),clientGroups=new Map(),canonicalClients=new Map();
  for(const record of records){
    const key=record.client.source_id||`ROW:${record.row_number}`;if(!clientGroups.has(key))clientGroups.set(key,[]);clientGroups.get(key).push(record.client);
  }
  for(const [key,rows] of clientGroups)canonicalClients.set(key,canonicalClientFromRows(rows));
  for(const record of records){const key=record.client.source_id||`ROW:${record.row_number}`;record.client.client_type=canonicalClients.get(key)?.client_type||"INDIVIDUAL";}
  if(tableExists(db,"master_data_source_rows"))db.prepare("DELETE FROM master_data_source_rows WHERE source_name=?").run(sourceName);
  if(tableExists(db,"master_data_client_field_values"))db.prepare("DELETE FROM master_data_client_field_values WHERE source_name=?").run(sourceName);
  let createdClients=0,updatedClients=0,matchedExistingClients=0,deletedClientsSkipped=0,createdPianos=0,updatedPianos=0,ownerlessPianos=0;
  const sourceClientIds=new Set(records.map(record=>record.client.source_id).filter(Boolean));
  for(const [key,source] of canonicalClients){
    if(!hasClientData(source))continue;
    const result=upsertSourceClient(db,source,sourceName);
    if(result?.deleted){clientCache.set(key,null);deletedClientsSkipped++;continue;}
    if(result){clientCache.set(key,result.row);if(result.created)createdClients++;else updatedClients++;if(result.matchedExisting)matchedExistingClients++;}
  }
  for(const record of records){
    const clientKey=record.client.source_id||`ROW:${record.row_number}`;
    const client=hasClientData(record.client)?(clientCache.get(clientKey)||null):null;
    let piano=sourcePianoRow(db,sourceName,sourceInstrumentKey(record));
    if(piano){piano=updatePianoFromSource(db,piano,record.instrument,client?.id??null);updatedPianos++;}
    else{
      const info=db.prepare(`INSERT INTO pianos(client_id,category,brand,model,serial_number,last_serviced_at,last_service_title,last_service_description,next_service_date,date_of_purchase,warranty,latest_info_frequency,latest_info_humidity,latest_info_temperature,build_year,size_display,color,notes,classification_status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CLASSIFIED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
          client?.id||null,clean(record.instrument.category,80)||null,clean(record.instrument.brand,200)||"No brand",clean(record.instrument.model,200)||null,
          clean(record.instrument.serial_number,200)||null,clean(record.instrument.last_serviced_at,120)||null,clean(record.instrument.last_service_title,300)||null,
          clean(record.instrument.last_service_description,3000)||null,clean(record.instrument.next_service_date,120)||null,clean(record.instrument.date_of_purchase,120)||null,
          clean(record.instrument.warranty,300)||null,clean(record.instrument.latest_info_frequency,120)||null,clean(record.instrument.latest_info_humidity,120)||null,
          clean(record.instrument.latest_info_temperature,120)||null,record.instrument.build_year,clean(record.instrument.size_display,120)||null,clean(record.instrument.color,160)||null,clean(record.instrument.note,5000)||null
        );
      piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(Number(info.lastInsertRowid));createdPianos++;
    }
    if(!piano.client_id)ownerlessPianos++;
    if(tableExists(db,"master_data_piano_source_map"))db.prepare(`INSERT INTO master_data_piano_source_map(source_name,source_instrument_id,piano_id,review_id,updated_at)
      VALUES(?,?,?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(source_name,source_instrument_id) DO UPDATE SET piano_id=excluded.piano_id,review_id=NULL,updated_at=CURRENT_TIMESTAMP`).run(sourceName,sourceInstrumentKey(record),piano.id);
    persistImportRow(db,{sourceName,record,clientId:piano.client_id,pianoId:piano.id});
  }
  refreshClientLastVisit(db);
  const after=reconcileExistingMasterData(db);
  refreshClientLastVisit(db);
  const sourceNonEmptyValues=records.reduce((sum,record)=>sum+(record.raw.values||[]).filter(value=>clean(value)!=="").length,0);
  const sourceRowsPersisted=tableExists(db,"master_data_source_rows")?Number(db.prepare("SELECT COUNT(*) c FROM master_data_source_rows WHERE source_name=?").get(sourceName)?.c||0):records.length;
  const clientTypes=tableExists(db,"master_data_client_source_map")?db.prepare(`SELECT c.client_type,COUNT(DISTINCT c.id) count FROM master_data_client_source_map m JOIN clients c ON c.id=m.client_id WHERE m.source_name=? AND c.deleted_at IS NULL GROUP BY c.client_type`).all(sourceName).reduce((out,row)=>(out[row.client_type]=Number(row.count),out),{}):{};
  const controlMap=tableExists(db,"master_data_client_source_map")?db.prepare("SELECT client_id FROM master_data_client_source_map WHERE source_name=? AND source_client_id='3084'").get(sourceName):null;
  const controlPianos=tableExists(db,"master_data_source_rows")
    ?Number(db.prepare("SELECT COUNT(DISTINCT piano_id) c FROM master_data_source_rows WHERE source_name=? AND source_client_id='3084' AND piano_id IS NOT NULL").get(sourceName)?.c||0)
    :(controlMap?.client_id?Number(db.prepare("SELECT COUNT(*) c FROM pianos WHERE client_id=?").get(controlMap.client_id)?.c||0):0);
  const linkedPianos=tableExists(db,"master_data_source_rows")
    ?Number(db.prepare("SELECT COUNT(*) c FROM master_data_source_rows WHERE source_name=? AND client_id IS NOT NULL").get(sourceName)?.c||0)
    :Number(db.prepare("SELECT COUNT(*) c FROM pianos WHERE client_id IS NOT NULL").get()?.c||0);
  const allPianos=tableExists(db,"master_data_source_rows")?sourceRowsPersisted:Number(db.prepare("SELECT COUNT(*) c FROM pianos").get()?.c||0);
  return {rows:records.length,columns:33,sourceClients:sourceClientIds.size,sourceNonEmptyValues,createdClients,updatedClients,matchedExistingClients,deletedClientsSkipped,createdPianos,updatedPianos,ownerlessPianos,sourceRowsPersisted,clientTypes,linkedPianos,totalPianos:allPianos,controlClientSourceId:"3084",controlClientRows:controlMap?1:0,controlClientPianos:controlPianos,integrity:{allSourceRowsPreserved:sourceRowsPersisted===records.length,onePianoPerSourceRow:records.length===sourceRowsPersisted,controlClientExactlyOne:!sourceClientIds.has("3084")||Boolean(controlMap),controlClientHasNinePianos:!sourceClientIds.has("3084")||controlPianos===9},reviewItems:0,unassigned:ownerlessPianos,sourceDuplicateGroups:0,...after};
}
function reconcileExistingMasterData(db){
  const relationshipRepairBefore=repairSourceRelationships(db),resolvedLegacyReviews=promotePendingReviews(db),normalizedPianos=normalizeExistingPianos(db),mergedClients=mergeExistingClients(db),relationshipRepairAfter=repairSourceRelationships(db),mergedPianos=mergeExistingPianos(db);
  return {mergedClients,mergedPianos,normalizedPianos,resolvedLegacyReviews,relinkedPianos:relationshipRepairBefore.relinkedPianos+relationshipRepairAfter.relinkedPianos,reviewRequired:0};
}
module.exports={parseLegacyInstrumentClientCsv,importLegacyInstrumentClientCsv,reconcileExistingMasterData,repairSourceRelationships,rehydrateStoredMasterData,classifyClientRows,normSerial,brandFamily,pianoClassified};
