"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const Database=require("better-sqlite3");
const {createAutomationOutbox}=require("../server/automation-outbox");
const {createWorkshopPayments}=require("../server/workshop-payments");

function fixture(){
  const db=new Database(":memory:");
  db.exec(`
    CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value TEXT);
    CREATE TABLE clients(id INTEGER PRIMARY KEY,name TEXT,email TEXT,preferred_language TEXT);
    CREATE TABLE pianos(id INTEGER PRIMARY KEY,client_id INTEGER,brand TEXT,model TEXT,serial_number TEXT,location_notes TEXT);
    CREATE TABLE jobs(id INTEGER PRIMARY KEY,client_id INTEGER,piano_id INTEGER);
    CREATE TABLE invoices(
      id INTEGER PRIMARY KEY,invoice_number TEXT,direction TEXT,status TEXT,client_id INTEGER,job_id INTEGER,
      counterparty_name TEXT,counterparty_email TEXT,summary TEXT,currency TEXT,total_amount REAL,payment_method TEXT,paid_at TEXT,
      deleted_at TEXT,payment_url TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE invoice_payments(
      id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_id INTEGER,amount REAL,payment_method TEXT,reference TEXT,paid_at TEXT,
      notes TEXT,created_by_user_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE document_archive(
      id INTEGER PRIMARY KEY AUTOINCREMENT,category TEXT,title TEXT,description TEXT,entity_type TEXT,entity_id TEXT,
      original_name TEXT,stored_name TEXT,mime_type TEXT,size_bytes INTEGER,file_path TEXT,metadata_json TEXT,
      archived_by_user_id TEXT,archived_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE workshop_invoice_checkouts(
      id TEXT PRIMARY KEY,invoice_id INTEGER,stripe_checkout_session_id TEXT UNIQUE,stripe_payment_intent_id TEXT,
      status TEXT,amount_cents INTEGER,currency TEXT,checkout_url TEXT,expires_at TEXT,failure_code TEXT,paid_at TEXT,
      receipt_archive_document_id INTEGER,receipt_provider_message_id TEXT,receipt_sent_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE customer_communication_log(
      id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT,job_id INTEGER,invoice_id INTEGER,client_id INTEGER,
      recipient TEXT,language TEXT,status TEXT,provider_message_id TEXT,error_code TEXT,dedupe_key TEXT UNIQUE,
      metadata_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE automation_outbox(
      id TEXT PRIMARY KEY,event_type TEXT,entity_type TEXT,entity_id TEXT,payload_json TEXT,status TEXT,
      attempts INTEGER,available_at TEXT,locked_at TEXT,last_error TEXT,dedupe_key TEXT UNIQUE,completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE kpi_summary_cache(month_key TEXT PRIMARY KEY,labor_revenue REAL,material_direct_cost REAL,net_workshop_result REAL,outstanding_invoice_count INTEGER,outstanding_invoice_amount REAL,refreshed_at TEXT);
  `);
  db.prepare("INSERT INTO app_settings(setting_key,setting_value) VALUES('company_name','Klavierhaus'),('finance_company_email','billing@example.com')").run();
  db.prepare("INSERT INTO clients(id,name,email,preferred_language) VALUES(1,'Client One','client@example.com','en')").run();
  db.prepare("INSERT INTO pianos(id,client_id,brand,model,serial_number) VALUES(1,1,'Steinway','B','SN-001')").run();
  db.prepare("INSERT INTO jobs(id,client_id,piano_id) VALUES(1,1,1)").run();
  db.prepare(`INSERT INTO invoices(id,invoice_number,direction,status,client_id,job_id,counterparty_name,counterparty_email,summary,currency,total_amount)
    VALUES(1,'INV-2026-0001','receivable','sent',1,1,'Client One','client@example.com','Workshop service','USD',125.50)`).run();
  db.prepare("INSERT INTO kpi_summary_cache(month_key,labor_revenue) VALUES('2026-09',10)").run();

  const created=[];
  const fakeStripe={
    checkout:{sessions:{create:async(payload)=>{
      created.push(payload);
      return {id:"cs_test_1",url:"https://checkout.stripe.test/cs_test_1",livemode:false,expires_at:Math.floor(Date.now()/1000)+1800,payment_intent:null};
    }}}
  };
  const deliveries=[];
  const email={
    async sendPaymentReceipt(payload){deliveries.push(payload);return {providerMessageId:"re_receipt_1"};}
  };
  const outbox=createAutomationOutbox({db,notifications:null});
  const uploadDir=fs.mkdtempSync(path.join(os.tmpdir(),"kh-workshop-pay-"));
  const service=createWorkshopPayments({
    db,transactionalEmail:email,automationOutbox:outbox,uploadDir,appBaseUrl:"https://erp.example.test",
    secretKey:"sk_test_example",webhookSecret:"whsec_example",paymentLinkSecret:"0123456789abcdef0123456789abcdef",
    stripeClient:fakeStripe
  });
  return {db,outbox,service,created,deliveries,uploadDir};
}

test("workshop payment link is signed, stable and creates a USD checkout for the exact invoice total",async()=>{
  const {db,service,created}=fixture();
  assert.equal(service.configured,true);
  const first=service.ensurePaymentLink(1),second=service.ensurePaymentLink(1);
  assert.equal(first.payment_url,second.payment_url);
  assert.match(first.payment_url,/\/api\/public\/workshop-invoices\/pay\/1\./);
  const token=decodeURIComponent(first.payment_url.split("/").at(-1));
  const checkout=await service.checkoutForToken(token);
  assert.equal(checkout.checkout_session_id,"cs_test_1");
  assert.equal(created.length,1);
  assert.equal(created[0].line_items[0].price_data.currency,"usd");
  assert.equal(created[0].line_items[0].price_data.unit_amount,12550);
  assert.equal(created[0].metadata.payment_domain,"workshop_invoice");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM workshop_invoice_checkouts").get().count,1);
});

test("verified workshop checkout reconciliation marks the invoice paid once and queues a durable receipt",async()=>{
  const {db,outbox,service,deliveries}=fixture();
  const link=service.ensurePaymentLink(1),token=decodeURIComponent(link.payment_url.split("/").at(-1));
  await service.checkoutForToken(token);
  const session={
    id:"cs_test_1",livemode:false,payment_status:"paid",currency:"usd",amount_total:12550,payment_intent:"pi_test_paid",
    metadata:{payment_domain:"workshop_invoice",checkout_id:db.prepare("SELECT id FROM workshop_invoice_checkouts").get().id,invoice_id:"1"}
  };
  const result=await service.processCheckoutEvent("checkout.session.completed",session);
  assert.equal(result.paid,true);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=1").get().status,"paid");
  assert.equal(db.prepare("SELECT payment_method FROM invoices WHERE id=1").get().payment_method,"Credit Card / Stripe");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM invoice_payments WHERE invoice_id=1").get().count,1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM kpi_summary_cache").get().count,0);

  const receiptEvent=db.prepare("SELECT * FROM automation_outbox WHERE event_type='SEND_PAYMENT_RECEIPT'").get();
  assert.ok(receiptEvent);
  await outbox.run(receiptEvent.id);
  assert.equal(deliveries.length,1);
  assert.equal(deliveries[0].invoiceNumber,"INV-2026-0001");
  const checkout=db.prepare("SELECT * FROM workshop_invoice_checkouts").get();
  assert.equal(checkout.receipt_provider_message_id,"re_receipt_1");
  assert.ok(checkout.receipt_archive_document_id);
  const doc=db.prepare("SELECT * FROM document_archive WHERE id=?").get(checkout.receipt_archive_document_id);
  assert.equal(doc.category,"financial_document");
  assert.match(doc.metadata_json,/payment_receipt/);

  const duplicate=await service.processCheckoutEvent("checkout.session.completed",session);
  assert.equal(duplicate.duplicate,true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM invoice_payments WHERE invoice_id=1").get().count,1);
});

test("amount mismatch never marks a sent invoice paid",async()=>{
  const {db,service}=fixture();
  const link=service.ensurePaymentLink(1),token=decodeURIComponent(link.payment_url.split("/").at(-1));
  await service.checkoutForToken(token);
  const checkout=db.prepare("SELECT id FROM workshop_invoice_checkouts").get();
  await assert.rejects(()=>service.processCheckoutEvent("checkout.session.completed",{
    id:"cs_test_1",livemode:false,payment_status:"paid",currency:"usd",amount_total:9999,payment_intent:"pi_wrong",
    metadata:{payment_domain:"workshop_invoice",checkout_id:checkout.id,invoice_id:"1"}
  }),/STRIPE_AMOUNT_MISMATCH/);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id=1").get().status,"sent");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM invoice_payments").get().count,0);
});

test("Stripe signature verification stays ahead of JSON parsing and only then delegates workshop sessions",()=>{
  const root=path.resolve(__dirname,"..");
  const index=fs.readFileSync(path.join(root,"server","index.js"),"utf8");
  const stripe=fs.readFileSync(path.join(root,"server","stripe-sandbox.js"),"utf8");
  assert.ok(index.indexOf('app.post("/api/webhooks/stripe",express.raw')>=0);
  assert.ok(index.indexOf('app.post("/api/webhooks/stripe",express.raw')<index.indexOf("app.use(express.json"));
  assert.match(stripe,/stripe\.webhooks\.constructEvent\(req\.body,\s*signature,\s*webhookSecret\)/);
  assert.match(stripe,/metadata\?\.payment_domain==="workshop_invoice"/);
  assert.match(stripe,/await onCheckoutSessionEvent\(event\.type,session\)/);
});
