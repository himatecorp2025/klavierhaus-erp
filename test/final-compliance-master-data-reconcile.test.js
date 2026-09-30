"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const Database=require("better-sqlite3");
const {reconcileExistingMasterData,importLegacyInstrumentClientCsv}=require("../server/master-data-reconcile");

function makeDb(){
  const db=new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`
    CREATE TABLE clients(
      id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,first_name TEXT,last_name TEXT,company_name TEXT,contact_name TEXT,
      email TEXT,mobile_phone TEXT,line_phone TEXT,phone TEXT,street TEXT,city TEXT,district TEXT,postcode TEXT,country TEXT,address TEXT,
      notes TEXT,short_memo_to_name TEXT,preferred_language TEXT NOT NULL DEFAULT 'en',client_type TEXT NOT NULL DEFAULT 'PRIVATE',
      is_vip INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE pianos(
      id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER,category TEXT,brand TEXT NOT NULL DEFAULT 'No brand',model TEXT,serial_number TEXT,finish TEXT,
      location_notes TEXT,last_serviced_at TEXT,last_service_title TEXT,last_service_description TEXT,next_service_date TEXT,date_of_purchase TEXT,warranty TEXT,
      latest_info_frequency TEXT,latest_info_humidity TEXT,latest_info_temperature TEXT,build_year INTEGER,size_display TEXT,color TEXT,notes TEXT,
      classification_status TEXT NOT NULL DEFAULT 'CLASSIFIED',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL
    );
    CREATE TABLE intake_leads(id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER,piano_id INTEGER);
    CREATE TABLE jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER,piano_id INTEGER);
    CREATE TABLE client_piano_review_queue(
      id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER,piano_id INTEGER,source_name TEXT NOT NULL DEFAULT 'EXISTING_DB',
      source_instrument_id TEXT,source_brand TEXT,source_model TEXT,source_serial_number TEXT,source_build_year INTEGER,source_note TEXT,
      reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',resolved_piano_id INTEGER,resolved_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(source_name,source_instrument_id)
    );
    CREATE TABLE master_data_client_source_map(source_name TEXT NOT NULL,source_client_id TEXT NOT NULL,client_id INTEGER NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_name,source_client_id));
    CREATE TABLE master_data_piano_source_map(source_name TEXT NOT NULL,source_instrument_id TEXT NOT NULL,piano_id INTEGER,review_id INTEGER,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_name,source_instrument_id));
    CREATE TABLE master_data_import_rows(source_name TEXT NOT NULL,source_instrument_id TEXT NOT NULL,source_client_id TEXT,source_row_number INTEGER NOT NULL,client_id INTEGER,piano_id INTEGER,raw_json TEXT NOT NULL,imported_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_name,source_instrument_id));
  `);
  return db;
}
function csvCell(value){const s=String(value??"");return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}
function csvLine(values){return values.map(csvCell).join(",");}
function sourceCsv(rows){
  const group=new Array(33).fill("");group[0]="INSTRUMENT";group[18]="CLIENT";
  const h=["ID","CATEGORY","BRAND","MODEL","SIZE","COLOR","SERIAL NUMBER","YEAR BUILT","NOTE","DATE OF PURCHASE","WARRANTY","LAST SERVICE DATE","LAST SERVICE TITLE","LAST SERVICE DESCRIPTION","NEXT SERVICE DATE","LATEST INFO FREQUENCY","LATEST INFO HUMIDITY","LATEST INFO TEMPERATURE","ID","FIRST NAME","LAST NAME","COMPANY NAME","CONTACT NAME","STREET","CITY","DISTRICT","POSTCODE","COUNTRY","MOBILE PHONE","LINE PHONE","E-MAIL","NOTE","SHORT MEMO TO NAME"];
  return [csvLine(group),csvLine(h),...rows.map(csvLine)].join("\n");
}
function sourceRow(values={}){
  const r=new Array(33).fill("");
  const fields=["instrumentId","category","brand","model","size","color","serial","year","instrumentNote","purchaseDate","warranty","lastServiceDate","lastServiceTitle","lastServiceDescription","nextServiceDate","frequency","humidity","temperature","clientId","first","last","company","contact","street","city","district","postcode","country","mobile","linePhone","email","clientNote","memo"];
  fields.forEach((field,index)=>{r[index]=values[field]??"";});
  return r;
}

test("reconciliation keeps incomplete pianos visible and resolves legacy missing-data review items",()=>{
  const db=makeDb();
  const clientId=Number(db.prepare("INSERT INTO clients(name) VALUES(?)").run("Legacy owner").lastInsertRowid);
  const pianoId=Number(db.prepare("INSERT INTO pianos(client_id,brand,classification_status) VALUES(?,?,'REVIEW_REQUIRED')").run(clientId,"Unknown").lastInsertRowid);
  db.prepare("INSERT INTO client_piano_review_queue(client_id,piano_id,source_name,source_instrument_id,source_brand,reason,status) VALUES(?,?,?,?,?,'EXISTING_UNCLASSIFIED_PIANO','PENDING')").run(clientId,pianoId,"EXISTING_DB","LEG-1","No brand");
  const summary=reconcileExistingMasterData(db);
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(pianoId);
  assert.equal(piano.classification_status,"CLASSIFIED");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM client_piano_review_queue WHERE status='PENDING'").get().c,0);
  assert.equal(summary.reviewRequired,0);
  assert.equal(summary.resolvedLegacyReviews,1);
  db.close();
});

test("complete CSV import preserves every non-ID field, source clients stay distinct, ownerless pianos stay visible and reimport is idempotent",()=>{
  const db=makeDb();
  const csv=sourceCsv([
    sourceRow({instrumentId:"100",category:"grand",brand:"Steinway & Sons",model:"M",size:"170",color:"Ebony Satin",serial:"434916",year:"1968",instrumentNote:"Piano note",purchaseDate:"2000",warranty:"Expired",lastServiceDate:"2025-05-29",lastServiceTitle:"Tuning",lastServiceDescription:"Full tuning",nextServiceDate:"2026-05-29",frequency:"440",humidity:"58",temperature:"71",clientId:"500",first:"Joan",last:"Hollander",contact:"Joan H.",street:"10 Park Ave",city:"New York",district:"NY",postcode:"10001",country:"United States",mobile:"917-555-0101",linePhone:"212-555-0102",email:"same@example.test",clientNote:"Client note",memo:"Remember Joan"}),
    sourceRow({instrumentId:"101",category:"other",brand:"No brand",clientId:"501",first:"Joan",last:"Hollander",street:"20 Park Ave",city:"New York",district:"NY",postcode:"10002",country:"United States",mobile:"917-555-0101",email:"same@example.test",clientNote:"Second source client"}),
    sourceRow({instrumentId:"102",category:"grand",brand:"Fazioli",model:"278",serial:"278-1110",color:"Ebony High Gloss",instrumentNote:"Owner not present in source"})
  ]);
  const first=importLegacyInstrumentClientCsv(db,{content:csv,sourceName:"TEST_CSV"});
  assert.equal(first.rows,3);
  assert.equal(first.sourceClients,2);
  assert.equal(first.ownerlessPianos,1);
  assert.equal(first.reviewItems,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients").get().c,2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pianos").get().c,3);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM client_piano_review_queue WHERE status='PENDING'").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM master_data_import_rows").get().c,3);

  const firstClient=db.prepare("SELECT * FROM clients WHERE id=(SELECT client_id FROM master_data_client_source_map WHERE source_name='TEST_CSV' AND source_client_id='500')").get();
  assert.equal(firstClient.first_name,"Joan");
  assert.equal(firstClient.last_name,"Hollander");
  assert.equal(firstClient.contact_name,"Joan H.");
  assert.equal(firstClient.street,"10 Park Ave");
  assert.equal(firstClient.city,"New York");
  assert.equal(firstClient.district,"NY");
  assert.equal(firstClient.postcode,"10001");
  assert.equal(firstClient.country,"United States");
  assert.equal(firstClient.mobile_phone,"917-555-0101");
  assert.equal(firstClient.line_phone,"212-555-0102");
  assert.equal(firstClient.email,"same@example.test");
  assert.equal(firstClient.notes,"Client note");
  assert.equal(firstClient.short_memo_to_name,"Remember Joan");

  const piano=db.prepare("SELECT * FROM pianos WHERE id=(SELECT piano_id FROM master_data_piano_source_map WHERE source_name='TEST_CSV' AND source_instrument_id='100')").get();
  assert.equal(piano.category,"grand");
  assert.equal(piano.brand,"Steinway & Sons");
  assert.equal(piano.model,"M");
  assert.equal(piano.size_display,"170");
  assert.equal(piano.color,"Ebony Satin");
  assert.equal(piano.serial_number,"434916");
  assert.equal(piano.build_year,1968);
  assert.equal(piano.notes,"Piano note");
  assert.equal(piano.date_of_purchase,"2000");
  assert.equal(piano.warranty,"Expired");
  assert.equal(piano.last_serviced_at,"2025-05-29");
  assert.equal(piano.last_service_title,"Tuning");
  assert.equal(piano.last_service_description,"Full tuning");
  assert.equal(piano.next_service_date,"2026-05-29");
  assert.equal(piano.latest_info_frequency,"440");
  assert.equal(piano.latest_info_humidity,"58");
  assert.equal(piano.latest_info_temperature,"71");
  assert.equal(piano.classification_status,"CLASSIFIED");

  const noBrand=db.prepare("SELECT * FROM pianos WHERE id=(SELECT piano_id FROM master_data_piano_source_map WHERE source_name='TEST_CSV' AND source_instrument_id='101')").get();
  assert.equal(noBrand.brand,"No brand");
  assert.ok(noBrand.client_id);
  const ownerless=db.prepare("SELECT * FROM pianos WHERE id=(SELECT piano_id FROM master_data_piano_source_map WHERE source_name='TEST_CSV' AND source_instrument_id='102')").get();
  assert.equal(ownerless.client_id,null);
  assert.equal(ownerless.brand,"Fazioli");

  const before={clients:db.prepare("SELECT COUNT(*) c FROM clients").get().c,pianos:db.prepare("SELECT COUNT(*) c FROM pianos").get().c,rows:db.prepare("SELECT COUNT(*) c FROM master_data_import_rows").get().c};
  importLegacyInstrumentClientCsv(db,{content:csv,sourceName:"TEST_CSV"});
  assert.deepEqual({clients:db.prepare("SELECT COUNT(*) c FROM clients").get().c,pianos:db.prepare("SELECT COUNT(*) c FROM pianos").get().c,rows:db.prepare("SELECT COUNT(*) c FROM master_data_import_rows").get().c},before);
  db.close();
});

test("Master Data source rejects unsupported CSV shape",()=>{
  const db=makeDb();
  assert.throws(()=>importLegacyInstrumentClientCsv(db,{content:"a,b\n1,2",sourceName:"BAD"}),/MASTER_DATA_CSV/);
  db.close();
});
