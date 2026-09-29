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
      id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT,phone TEXT,address TEXT,notes TEXT,
      preferred_language TEXT NOT NULL DEFAULT 'en',client_type TEXT NOT NULL DEFAULT 'PRIVATE',is_vip INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE pianos(
      id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER NOT NULL,brand TEXT NOT NULL,model TEXT,serial_number TEXT,finish TEXT,
      location_notes TEXT,last_serviced_at TEXT,build_year INTEGER,size_display TEXT,color TEXT,notes TEXT,
      classification_status TEXT NOT NULL DEFAULT 'CLASSIFIED',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE TABLE intake_leads(id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER,piano_id INTEGER);
    CREATE TABLE jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER NOT NULL,piano_id INTEGER NOT NULL);
    CREATE TABLE client_piano_review_queue(
      id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER,piano_id INTEGER,source_name TEXT NOT NULL DEFAULT 'EXISTING_DB',
      source_instrument_id TEXT,source_brand TEXT,source_model TEXT,source_serial_number TEXT,source_build_year INTEGER,source_note TEXT,
      reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',resolved_piano_id INTEGER,resolved_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(source_name,source_instrument_id)
    );
    CREATE TABLE master_data_client_source_map(source_name TEXT NOT NULL,source_client_id TEXT NOT NULL,client_id INTEGER NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_name,source_client_id));
    CREATE TABLE master_data_piano_source_map(source_name TEXT NOT NULL,source_instrument_id TEXT NOT NULL,piano_id INTEGER,review_id INTEGER,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_name,source_instrument_id));
  `);
  return db;
}
function csvCell(value){const s=String(value??"");return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}
function csvLine(values){return values.map(csvCell).join(",");}
function sourceCsv(rows){
  const group=new Array(33).fill("");group[0]="INSTRUMENT";group[18]="CLIENT";
  const h=new Array(33).fill("");
  ["ID","CATEGORY","BRAND","MODEL","SIZE","COLOR","SERIAL NUMBER","YEAR BUILT"].forEach((v,i)=>h[i]=v);
  h[8]="NOTE";h[11]="LAST SERVICED";h[12]="SERVICE TITLE";h[13]="SERVICE DESCRIPTION";
  h[18]="ID";h[19]="FIRST NAME";h[20]="LAST NAME";h[21]="COMPANY";h[22]="CONTACT";
  h[23]="ADDRESS 1";h[24]="ADDRESS 2";h[25]="CITY";h[26]="STATE";h[27]="ZIP";h[28]="PHONE";h[29]="PHONE 2";h[30]="E-MAIL";h[31]="NOTES";h[32]="MEMO";
  return [csvLine(group),csvLine(h),...rows.map(csvLine)].join("\n");
}
function row({instrumentId,brand,model,serial,year,clientId,first,last,company,email,address,note}){
  const r=new Array(33).fill("");
  r[0]=instrumentId;r[1]="PIANO";r[2]=brand;r[3]=model;r[6]=serial;r[7]=year||"";r[8]=note||"";
  r[18]=clientId||"";r[19]=first||"";r[20]=last||"";r[21]=company||"";r[23]=address||"";r[30]=email||"";
  return r;
}

test("production reconciliation merges strong client duplicates and same-serial pianos while preserving references",()=>{
  const db=makeDb();
  const c1=Number(db.prepare("INSERT INTO clients(name,email,address) VALUES(?,?,?)").run("Adventist Church","office@church.test","100 Main St").lastInsertRowid);
  const c2=Number(db.prepare("INSERT INTO clients(name,email,address) VALUES(?,?,?)").run("Adventist Church","office@church.test","100 Main St").lastInsertRowid);
  const p1=Number(db.prepare("INSERT INTO pianos(client_id,brand,model,serial_number) VALUES(?,?,?,?)").run(c1,"C. Bechstein","A01","ABC-123").lastInsertRowid);
  const p2=Number(db.prepare("INSERT INTO pianos(client_id,brand,model,serial_number) VALUES(?,?,?,?)").run(c2,"Bechstein","A 01","ABC123").lastInsertRowid);
  db.prepare("INSERT INTO jobs(client_id,piano_id) VALUES(?,?)").run(c2,p2);
  const c3=Number(db.prepare("INSERT INTO clients(name,address) VALUES(?,?)").run("Unknown Piano Owner","200 Main St").lastInsertRowid);
  db.prepare("INSERT INTO pianos(client_id,brand) VALUES(?,?)").run(c3,"Unknown");

  const summary=reconcileExistingMasterData(db);
  assert.equal(summary.mergedClients,1);
  assert.equal(summary.mergedPianos,1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE name='Adventist Church'").get().c,1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pianos WHERE replace(replace(serial_number,'-',''),' ','')='ABC123'").get().c,1);
  const remaining=db.prepare("SELECT id,client_id FROM pianos WHERE replace(replace(serial_number,'-',''),' ','')='ABC123'").get();
  assert.equal(db.prepare("SELECT piano_id FROM jobs LIMIT 1").get().piano_id,remaining.id);
  assert.equal(db.prepare("SELECT client_id FROM jobs LIMIT 1").get().client_id,remaining.client_id);
  const unknown=db.prepare("SELECT * FROM pianos WHERE brand='Unknown'").get();
  assert.equal(unknown.classification_status,"REVIEW_REQUIRED");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM client_piano_review_queue WHERE piano_id=? AND status='PENDING'").get(unknown.id).c,1);
  db.close();
});

test("legacy CSV import is idempotent, collapses duplicate serial rows, enriches client/piano data and queues unclassified instruments",()=>{
  const db=makeDb();
  const csv=sourceCsv([
    row({instrumentId:"100",brand:"Steinway & Sons",model:"M",serial:"434916",year:"1968"}),
    row({instrumentId:"101",brand:"Steinway",model:"M",serial:"434916",year:"1968",clientId:"500",first:"Joan",last:"Hollander",email:"joan@example.test",address:"10 Park Ave"}),
    row({instrumentId:"102",brand:"No Brand",model:"",serial:"",clientId:"500",first:"Joan",last:"Hollander",email:"joan@example.test",address:"10 Park Ave",note:"Piano exists; classification missing"}),
    row({instrumentId:"103",brand:"No Brand",model:"",serial:"",clientId:"501",address:"20 Broadway",note:"Incomplete client row"})
  ]);
  const first=importLegacyInstrumentClientCsv(db,{content:csv,sourceName:"TEST_CSV"});
  assert.equal(first.rows,4);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients").get().c,2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pianos").get().c,1);
  const piano=db.prepare("SELECT * FROM pianos").get();
  assert.equal(piano.serial_number,"434916");
  assert.equal(piano.build_year,1968);
  assert.equal(piano.classification_status,"CLASSIFIED");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM master_data_piano_source_map WHERE piano_id=?").get(piano.id).c,2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM client_piano_review_queue WHERE status='PENDING'").get().c,2);
  assert.match(db.prepare("SELECT name FROM clients WHERE address='20 Broadway'").get().name,/Imported client 501/);

  const countsBefore={
    clients:db.prepare("SELECT COUNT(*) c FROM clients").get().c,
    pianos:db.prepare("SELECT COUNT(*) c FROM pianos").get().c,
    reviews:db.prepare("SELECT COUNT(*) c FROM client_piano_review_queue").get().c
  };
  importLegacyInstrumentClientCsv(db,{content:csv,sourceName:"TEST_CSV"});
  assert.deepEqual({
    clients:db.prepare("SELECT COUNT(*) c FROM clients").get().c,
    pianos:db.prepare("SELECT COUNT(*) c FROM pianos").get().c,
    reviews:db.prepare("SELECT COUNT(*) c FROM client_piano_review_queue").get().c
  },countsBefore);
  db.close();
});

test("Master Data source rejects unsupported CSV shape",()=>{
  const db=makeDb();
  assert.throws(()=>importLegacyInstrumentClientCsv(db,{content:"a,b\n1,2",sourceName:"BAD"}),/MASTER_DATA_CSV/);
  db.close();
});
