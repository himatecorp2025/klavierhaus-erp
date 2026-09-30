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
      notes TEXT,short_memo_to_name TEXT,preferred_language TEXT NOT NULL DEFAULT 'en',client_type TEXT NOT NULL DEFAULT 'INDIVIDUAL',
      is_vip INTEGER NOT NULL DEFAULT 0,deleted_at TEXT,deleted_by_user_id TEXT,archive_document_id INTEGER,deletion_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    CREATE TABLE master_data_source_rows(
      source_name TEXT NOT NULL,source_row_number INTEGER NOT NULL,source_instrument_id TEXT,source_client_id TEXT,client_id INTEGER,piano_id INTEGER,
      raw_json TEXT NOT NULL,raw_sha256 TEXT NOT NULL,nonempty_cell_count INTEGER NOT NULL DEFAULT 0,imported_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(source_name,source_row_number)
    );
    CREATE TABLE master_data_client_field_values(
      source_name TEXT NOT NULL,source_client_id TEXT NOT NULL,field_name TEXT NOT NULL,value TEXT NOT NULL,first_source_row INTEGER NOT NULL,last_source_row INTEGER NOT NULL,
      occurrences INTEGER NOT NULL DEFAULT 1,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_name,source_client_id,field_name,value)
    );
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
  assert.equal(first.columns,33);
  assert.equal(first.sourceRowsPersisted,3);
  assert.ok(first.sourceNonEmptyValues>0);
  assert.equal(first.sourceClients,2);
  assert.equal(first.ownerlessPianos,1);
  assert.equal(first.reviewItems,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients").get().c,2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pianos").get().c,3);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM client_piano_review_queue WHERE status='PENDING'").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM master_data_import_rows").get().c,3);
  const raw=JSON.parse(db.prepare("SELECT raw_json FROM master_data_import_rows WHERE source_name='TEST_CSV' AND source_instrument_id='100'").get().raw_json);
  assert.equal(raw.columns.length,33);
  assert.equal(raw.values.length,33);
  assert.equal(raw.values[2],"Steinway & Sons");
  assert.equal(raw.values[4],"170");
  assert.equal(raw.values[30],"same@example.test");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM master_data_source_rows WHERE source_name='TEST_CSV'").get().c,3);
  const sourceAudit=db.prepare("SELECT raw_sha256,nonempty_cell_count FROM master_data_source_rows WHERE source_name='TEST_CSV' AND source_row_number=3").get();
  assert.equal(sourceAudit.raw_sha256.length,64);
  assert.ok(sourceAudit.nonempty_cell_count>0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM master_data_client_field_values WHERE source_name='TEST_CSV' AND source_client_id='500' AND field_name='email' AND value='same@example.test'").get().c,1);

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
  assert.equal(firstClient.client_type,"INDIVIDUAL");

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


test("CSV import links to an unclaimed existing client but never merges two distinct source client IDs",()=>{
  const db=makeDb();
  const existingId=Number(db.prepare("INSERT INTO clients(name,email,phone,address) VALUES(?,?,?,?)").run("Existing Customer","existing@example.test","2125550100","100 Main St, New York, NY, 10001, United States").lastInsertRowid);
  const csv=sourceCsv([
    sourceRow({instrumentId:"200",brand:"Fazioli",model:"F212",clientId:"900",first:"Existing",last:"Customer",street:"100 Main St",city:"New York",district:"NY",postcode:"10001",country:"United States",linePhone:"2125550100",email:"existing@example.test"}),
    sourceRow({instrumentId:"201",brand:"Yamaha",model:"C3",clientId:"901",first:"Existing",last:"Customer",street:"200 Other St",city:"New York",district:"NY",postcode:"10002",country:"United States",linePhone:"2125550100",email:"existing@example.test"})
  ]);
  const summary=importLegacyInstrumentClientCsv(db,{content:csv,sourceName:"MATCH_TEST"});
  const map900=db.prepare("SELECT client_id FROM master_data_client_source_map WHERE source_name='MATCH_TEST' AND source_client_id='900'").get();
  const map901=db.prepare("SELECT client_id FROM master_data_client_source_map WHERE source_name='MATCH_TEST' AND source_client_id='901'").get();
  assert.equal(map900.client_id,existingId);
  assert.notEqual(map901.client_id,existingId);
  assert.notEqual(map901.client_id,map900.client_id);
  assert.equal(summary.matchedExistingClients,1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pianos WHERE client_id=?").get(existingId).c,1);
  db.close();
});

test("archived client source mapping is a tombstone and reimport does not resurrect the client",()=>{
  const db=makeDb();
  const id=Number(db.prepare("INSERT INTO clients(name,email,deleted_at) VALUES(?,?,CURRENT_TIMESTAMP)").run("Archived Customer","archived@example.test").lastInsertRowid);
  db.prepare("INSERT INTO master_data_client_source_map(source_name,source_client_id,client_id) VALUES('TOMBSTONE','777',?)").run(id);
  const csv=sourceCsv([sourceRow({instrumentId:"300",brand:"Bösendorfer",model:"225",clientId:"777",first:"Archived",last:"Customer",email:"archived@example.test"})]);
  const summary=importLegacyInstrumentClientCsv(db,{content:csv,sourceName:"TOMBSTONE"});
  assert.equal(summary.deletedClientsSkipped,1);
  assert.equal(db.prepare("SELECT deleted_at FROM clients WHERE id=?").get(id).deleted_at!==null,true);
  const piano=db.prepare("SELECT * FROM pianos WHERE id=(SELECT piano_id FROM master_data_piano_source_map WHERE source_name='TOMBSTONE' AND source_instrument_id='300')").get();
  assert.equal(piano.client_id,null);
  db.close();
});


test("client categorization follows Institution Partner Business Individual precedence",()=>{
  const db=makeDb();
  const csv=sourceCsv([
    sourceRow({instrumentId:"401",brand:"Yamaha",clientId:"C-INST",company:"Metropolitan Music University",contact:"Dean"}),
    sourceRow({instrumentId:"402",brand:"Kawai",clientId:"C-PARTNER",company:"Downtown Piano Studios",clientNote:"Technician partner"}),
    sourceRow({instrumentId:"403",brand:"Fazioli",clientId:"C-BIZ",company:"Acme Productions LLC"}),
    sourceRow({instrumentId:"404",brand:"Steinway & Sons",clientId:"C-IND",first:"Jane",last:"Doe"})
  ]);
  const summary=importLegacyInstrumentClientCsv(db,{content:csv,sourceName:"TYPE_TEST"});
  assert.equal(summary.clientTypes.INSTITUTION,1);
  assert.equal(summary.clientTypes.PARTNER,1);
  assert.equal(summary.clientTypes.BUSINESS,1);
  assert.equal(summary.clientTypes.INDIVIDUAL,1);
  const types=db.prepare("SELECT m.source_client_id,c.client_type FROM master_data_client_source_map m JOIN clients c ON c.id=m.client_id WHERE m.source_name='TYPE_TEST' ORDER BY m.source_client_id").all();
  assert.deepEqual(Object.fromEntries(types.map(row=>[row.source_client_id,row.client_type])),{"C-BIZ":"BUSINESS","C-IND":"INDIVIDUAL","C-INST":"INSTITUTION","C-PARTNER":"PARTNER"});
  db.close();
});

test("source relationship reconciliation restores all nine pianos for source client 3084",()=>{
  const db=makeDb(),rows=[];
  for(let i=0;i<9;i++)rows.push(sourceRow({instrumentId:String(4907+i),category:"grand",brand:i%2?"Steinway & Sons":"Bösendorfer",model:"MODEL-"+i,serial:"SER-"+i,clientId:"3084",first:"Control",last:"Owner",email:"control@example.test"}));
  const first=importLegacyInstrumentClientCsv(db,{content:sourceCsv(rows),sourceName:"CONTROL_3084"});
  assert.equal(first.controlClientRows,1);
  assert.equal(first.controlClientPianos,9);
  const clientId=db.prepare("SELECT client_id FROM master_data_client_source_map WHERE source_name='CONTROL_3084' AND source_client_id='3084'").get().client_id;
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pianos WHERE client_id=?").get(clientId).c,9);
  db.prepare("UPDATE pianos SET client_id=NULL WHERE id IN (SELECT piano_id FROM master_data_piano_source_map WHERE source_name='CONTROL_3084')").run();
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pianos WHERE client_id=?").get(clientId).c,0);
  const repaired=reconcileExistingMasterData(db);
  assert.equal(repaired.relinkedPianos,9);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pianos WHERE client_id=?").get(clientId).c,9);
  db.close();
});


test("production relation repair falls back to legacy import rows when the new source audit table is still empty",()=>{
  const db=makeDb();
  const clientId=Number(db.prepare("INSERT INTO clients(name,email) VALUES(?,?)").run("Production Owner","prod-owner@example.test").lastInsertRowid);
  const pianoId=Number(db.prepare("INSERT INTO pianos(client_id,brand,model,serial_number) VALUES(NULL,?,?,?)").run("Steinway & Sons","B","PROD-1").lastInsertRowid);
  db.prepare("INSERT INTO master_data_client_source_map(source_name,source_client_id,client_id) VALUES('PROD_SOURCE','3084',?)").run(clientId);
  db.prepare("INSERT INTO master_data_piano_source_map(source_name,source_instrument_id,piano_id,review_id) VALUES('PROD_SOURCE','4907',?,NULL)").run(pianoId);
  db.prepare("INSERT INTO master_data_import_rows(source_name,source_instrument_id,source_client_id,source_row_number,client_id,piano_id,raw_json) VALUES('PROD_SOURCE','4907','3084',3,NULL,?,'{}')").run(pianoId);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM master_data_source_rows").get().c,0);
  const summary=reconcileExistingMasterData(db);
  assert.equal(summary.relinkedPianos,1);
  assert.equal(db.prepare("SELECT client_id FROM pianos WHERE id=?").get(pianoId).client_id,clientId);
  assert.equal(db.prepare("SELECT client_id FROM master_data_import_rows WHERE source_name='PROD_SOURCE' AND source_instrument_id='4907'").get().client_id,clientId);
  db.close();
});
