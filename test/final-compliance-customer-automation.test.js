"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const Database=require("better-sqlite3");
const {createAutomationOutbox}=require("../server/automation-outbox");
const {createCustomerAutomation,nyDate,addDays}=require("../server/customer-automation");

function fixture({email="client@example.com",language="en"}={}){
  const db=new Database(":memory:");
  db.exec(`
    CREATE TABLE clients(id INTEGER PRIMARY KEY,name TEXT,email TEXT,preferred_language TEXT);
    CREATE TABLE pianos(id INTEGER PRIMARY KEY,client_id INTEGER,brand TEXT,model TEXT,serial_number TEXT);
    CREATE TABLE jobs(
      id INTEGER PRIMARY KEY,client_id INTEGER,piano_id INTEGER,cancelled_at TEXT,stage TEXT,
      scheduled_at TEXT,job_code TEXT,title TEXT
    );
    CREATE TABLE invoices(
      id INTEGER PRIMARY KEY,client_id INTEGER,status TEXT,due_date TEXT,deleted_at TEXT,
      direction TEXT,invoice_number TEXT,total_amount REAL
    );
    CREATE TABLE customer_communication_log(
      id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT,job_id INTEGER,invoice_id INTEGER,client_id INTEGER,
      recipient TEXT,language TEXT,status TEXT,provider_message_id TEXT,error_code TEXT,
      dedupe_key TEXT UNIQUE,metadata_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE automation_outbox(
      id TEXT PRIMARY KEY,event_type TEXT,entity_type TEXT,entity_id TEXT,payload_json TEXT,
      status TEXT,attempts INTEGER,available_at TEXT,locked_at TEXT,last_error TEXT,
      dedupe_key TEXT UNIQUE,completed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare("INSERT INTO clients(id,name,email,preferred_language) VALUES(1,'Alex Client',?,?)").run(email,language);
  db.prepare("INSERT INTO pianos(id,client_id,brand,model,serial_number) VALUES(1,1,'Steinway','B','SN-1')").run();
  db.prepare("INSERT INTO jobs(id,client_id,piano_id,stage,scheduled_at,job_code,title) VALUES(1,1,1,'received',?,'KH-2026-00001','Tuning')").run(new Date(Date.now()+24*60*60*1000).toISOString());

  const deliveries=[];
  const transactionalEmail={
    async sendCustomerMilestone(payload){
      deliveries.push(payload);
      return {providerMessageId:"MSG-"+deliveries.length};
    }
  };
  const outbox=createAutomationOutbox({db,notifications:null});
  const customer=createCustomerAutomation({db,transactionalEmail,automationOutbox:outbox});
  return {db,outbox,customer,deliveries};
}

test("customer milestone delivery uses preferred language and deduplicates",async()=>{
  const {db,outbox,customer,deliveries}=fixture({language:"hu"});
  const event=customer.enqueueJobMilestone(1,"JOB_CONFIRMED");
  await outbox.run(event.id);
  assert.equal(deliveries.length,1);
  assert.equal(deliveries[0].language,"hu");
  assert.equal(deliveries[0].eventType,"JOB_CONFIRMED");
  const log=db.prepare("SELECT * FROM customer_communication_log WHERE dedupe_key=?").get(event.dedupe_key);
  assert.equal(log.status,"sent");
  assert.equal(log.provider_message_id,"MSG-1");

  const duplicate=customer.enqueueJobMilestone(1,"JOB_CONFIRMED");
  assert.equal(duplicate.id,event.id);
  await outbox.run(duplicate.id);
  assert.equal(deliveries.length,1);
});

test("missing customer email is terminal and is not retried five times",async()=>{
  const {db,outbox,customer}=fixture({email:""});
  const event=customer.enqueueJobMilestone(1,"WORK_STARTED");
  await assert.rejects(()=>outbox.run(event.id),/CLIENT_EMAIL_REQUIRED/);
  const row=outbox.rowById(event.id);
  assert.equal(row.status,"failed");
  assert.equal(row.attempts,1);
  const log=db.prepare("SELECT * FROM customer_communication_log WHERE dedupe_key=?").get(event.dedupe_key);
  assert.equal(log.status,"failed");
  assert.equal(log.error_code,"CLIENT_EMAIL_REQUIRED");
});

test("reminder sweep enqueues invoice T-3/due/+7 and 24-hour appointment reminders only once",()=>{
  const {db,customer}=fixture();
  const today=nyDate();
  const insert=db.prepare("INSERT INTO invoices(id,client_id,status,due_date,direction,invoice_number,total_amount) VALUES(?,1,?,?, 'receivable',?,100)");
  insert.run(1,"sent",addDays(today,3),"INV-3");
  insert.run(2,"sent",today,"INV-0");
  insert.run(3,"sent",addDays(today,-7),"INV-7");
  insert.run(4,"paid",addDays(today,3),"INV-PAID");

  customer.sweep();
  customer.sweep();

  const keys=db.prepare("SELECT dedupe_key FROM automation_outbox ORDER BY dedupe_key").all().map(row=>row.dedupe_key);
  assert.ok(keys.includes("customer-invoice-1-INVOICE_DUE_3_DAYS"));
  assert.ok(keys.includes("customer-invoice-2-INVOICE_DUE_TODAY"));
  assert.ok(keys.includes("customer-invoice-3-INVOICE_OVERDUE_7_DAYS"));
  assert.equal(keys.some(key=>key.includes("invoice-4")),false);
  assert.equal(keys.filter(key=>key.includes("APPOINTMENT_REMINDER")).length,1);
});
