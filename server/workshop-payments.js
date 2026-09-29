"use strict";

const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const Stripe=require("stripe");
const {generatePaymentReceiptPdf}=require("./document-pdf");

const TEST_SECRET_PREFIXES=["sk_test_","rk_test_"];

function text(value,max=2000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||"").trim().toLowerCase());}
function money(value){const n=Number(value||0);return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:NaN;}
function nyDate(value=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value instanceof Date?value:new Date(value));
  const p=Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function normalizeBaseUrl(value,fallback="https://klavierhaus-erp.onrender.com"){
  try{
    const url=new URL(String(value||fallback));
    if(!["https:","http:"].includes(url.protocol))throw new Error("INVALID_PROTOCOL");
    url.pathname="";url.search="";url.hash="";
    return url.toString().replace(/\/$/,"");
  }catch(_error){return fallback;}
}
function nonRetryable(code){const error=new Error(code);error.code=code;error.retryable=false;return error;}

function createWorkshopPayments({
  db,env=process.env,transactionalEmail,automationOutbox,uploadDir,
  appBaseUrl,secretKey,webhookSecret,paymentLinkSecret,stripeClient
}={}){
  let stripeSecret=text(secretKey??env.STRIPE_SECRET_KEY,500);
  let stripeWebhookSecret=text(webhookSecret??env.STRIPE_WEBHOOK_SECRET,500);
  const linkSecret=text(paymentLinkSecret??env.WORKSHOP_PAYMENT_LINK_SECRET??env.JWT_SECRET,1000);
  const baseUrl=normalizeBaseUrl(appBaseUrl??env.APP_BASE_URL);
  if(stripeSecret&&!TEST_SECRET_PREFIXES.some(prefix=>stripeSecret.startsWith(prefix)))throw new Error("WORKSHOP_STRIPE_REQUIRES_TEST_KEY");
  if(stripeWebhookSecret&&!stripeWebhookSecret.startsWith("whsec_"))throw new Error("WORKSHOP_STRIPE_WEBHOOK_SECRET_INVALID");
  const stripe=stripeClient||(stripeSecret?new Stripe(stripeSecret,{maxNetworkRetries:2}):null);
  const configured=Boolean(stripe&&stripeSecret&&stripeWebhookSecret&&linkSecret);
  const receiptDir=path.join(uploadDir||path.join(__dirname,"uploads"),"receipts");
  fs.mkdirSync(receiptDir,{recursive:true});

  function invoiceContext(id){
    return db.prepare(`SELECT i.*,c.name client_name,c.email client_email,c.preferred_language,
      p.brand piano_brand,p.model piano_model,p.serial_number piano_serial_number,p.location_notes piano_location_notes
      FROM invoices i LEFT JOIN clients c ON c.id=i.client_id
      LEFT JOIN jobs j ON j.id=i.job_id LEFT JOIN pianos p ON p.id=j.piano_id
      WHERE i.id=? AND i.deleted_at IS NULL`).get(Number(id));
  }
  function company(){
    const keys=["trade_name","legal_name","address_line1","address_line2","city","state","postal_code","tax_id","email","phone"],row={};
    for(const key of keys)row[key]=db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get("finance_company_"+key)?.setting_value||"";
    if(!row.trade_name)row.trade_name=db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='company_name'").get()?.setting_value||"Klavierhaus";
    return row;
  }
  function tokenFor(invoice){
    if(!linkSecret)throw new Error("WORKSHOP_PAYMENT_LINK_NOT_CONFIGURED");
    const payload=`${invoice.id}|${invoice.invoice_number||""}`;
    const signature=crypto.createHmac("sha256",linkSecret).update(payload).digest("base64url");
    return `${invoice.id}.${signature}`;
  }
  function invoiceForToken(token){
    const match=String(token||"").match(/^(\d+)\.([A-Za-z0-9_-]{20,})$/);if(!match)return null;
    const invoice=invoiceContext(Number(match[1]));if(!invoice)return null;
    const expected=tokenFor(invoice),a=Buffer.from(expected),b=Buffer.from(String(token));
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    return invoice;
  }
  function paymentUrl(invoice){return `${baseUrl}/api/public/workshop-invoices/pay/${encodeURIComponent(tokenFor(invoice))}`;}
  function ensurePaymentLink(invoiceId){
    if(!configured)return null;
    const invoice=invoiceContext(invoiceId);if(!invoice||invoice.direction!=="receivable")return null;
    const url=paymentUrl(invoice);
    if(invoice.payment_url!==url)db.prepare("UPDATE invoices SET payment_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(url,invoice.id);
    return {invoice_id:invoice.id,payment_url:url,test_mode:true};
  }
  function activeCheckout(invoiceId){
    return db.prepare(`SELECT * FROM workshop_invoice_checkouts WHERE invoice_id=? AND status='PENDING'
      AND datetime(expires_at)>datetime('now') AND stripe_checkout_session_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`).get(invoiceId);
  }
  async function createCheckout(invoice){
    if(!configured)throw Object.assign(new Error("WORKSHOP_STRIPE_NOT_CONFIGURED"),{status:503});
    if(invoice.direction!=="receivable"||invoice.status!=="sent")throw Object.assign(new Error(invoice.status==="paid"?"INVOICE_ALREADY_PAID":"INVOICE_NOT_SENT"),{status:409});
    if(String(invoice.currency||"USD").toUpperCase()!=="USD")throw Object.assign(new Error("WORKSHOP_STRIPE_USD_ONLY"),{status:409});
    const cents=Math.round(Number(invoice.total_amount||0)*100);
    if(!Number.isSafeInteger(cents)||cents<=0)throw Object.assign(new Error("INVALID_INVOICE_TOTAL"),{status:409});
    const existing=activeCheckout(invoice.id);
    if(existing?.checkout_url)return {checkout_url:existing.checkout_url,checkout_session_id:existing.stripe_checkout_session_id,expires_at:existing.expires_at,reused:true,test_mode:true};

    const id="WIC-"+crypto.randomUUID(),expiresAt=new Date(Date.now()+30*60*1000);
    db.prepare(`INSERT INTO workshop_invoice_checkouts(id,invoice_id,status,amount_cents,currency,expires_at)
      VALUES(?,?,'PENDING',?,'USD',?)`).run(id,invoice.id,cents,expiresAt.toISOString());
    try{
      const session=await stripe.checkout.sessions.create({
        mode:"payment",payment_method_types:["card"],
        line_items:[{quantity:1,price_data:{currency:"usd",unit_amount:cents,product_data:{name:`Klavierhaus invoice ${invoice.invoice_number}`,description:text(invoice.summary||"Workshop service",500)}}}],
        client_reference_id:id,
        metadata:{payment_domain:"workshop_invoice",checkout_id:id,invoice_id:String(invoice.id),invoice_number:String(invoice.invoice_number||"")},
        payment_intent_data:{metadata:{payment_domain:"workshop_invoice",checkout_id:id,invoice_id:String(invoice.id),invoice_number:String(invoice.invoice_number||"")}},
        ...(validEmail(invoice.counterparty_email||invoice.client_email)?{customer_email:String(invoice.counterparty_email||invoice.client_email).trim().toLowerCase()}:{}),
        expires_at:Math.floor(expiresAt.getTime()/1000),
        success_url:`${baseUrl}/api/public/workshop-invoices/payment-success?invoice=${encodeURIComponent(invoice.invoice_number||String(invoice.id))}`,
        cancel_url:`${baseUrl}/api/public/workshop-invoices/payment-cancelled?invoice=${encodeURIComponent(invoice.invoice_number||String(invoice.id))}`
      },{idempotencyKey:`workshop-invoice-checkout-${id}`});
      if(session.livemode)throw new Error("LIVE_STRIPE_SESSION_REJECTED");
      db.prepare(`UPDATE workshop_invoice_checkouts SET stripe_checkout_session_id=?,stripe_payment_intent_id=?,checkout_url=?,expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(session.id,typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id||null,session.url,new Date(Number(session.expires_at||Math.floor(expiresAt.getTime()/1000))*1000).toISOString(),id);
      return {checkout_url:session.url,checkout_session_id:session.id,expires_at:new Date(Number(session.expires_at||Math.floor(expiresAt.getTime()/1000))*1000).toISOString(),reused:false,test_mode:true};
    }catch(error){
      db.prepare("UPDATE workshop_invoice_checkouts SET status='FAILED',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(text(error?.code||error?.message||"STRIPE_CHECKOUT_FAILED",160),id);
      throw error;
    }
  }
  async function checkoutForToken(token){
    const invoice=invoiceForToken(token);
    if(!invoice)throw Object.assign(new Error("INVALID_PAYMENT_LINK"),{status:404});
    if(invoice.status==="paid")return {paid:true,invoice_number:invoice.invoice_number};
    return createCheckout(invoice);
  }
  function paymentRecord(invoiceId){
    return db.prepare("SELECT * FROM invoice_payments WHERE invoice_id=? ORDER BY id DESC LIMIT 1").get(invoiceId);
  }
  function receiptArchive(checkout,invoice,payment){
    if(checkout.receipt_archive_document_id){
      const existing=db.prepare("SELECT * FROM document_archive WHERE id=?").get(checkout.receipt_archive_document_id);
      if(existing)return existing;
    }
    const pdf=generatePaymentReceiptPdf({company:company(),invoice,payment}),filename=`payment-receipt-${invoice.invoice_number||invoice.id}-${checkout.id.slice(-8)}.pdf`;
    const absolute=path.join(receiptDir,filename),publicPath=`/uploads/receipts/${filename}`;
    if(!fs.existsSync(absolute))fs.writeFileSync(absolute,pdf,{flag:"wx"});
    const info=db.prepare(`INSERT INTO document_archive(category,title,description,entity_type,entity_id,original_name,stored_name,mime_type,size_bytes,file_path,metadata_json)
      VALUES('financial_document',?,?,?,?,?,?,?,?,?,?)`).run(
      `Payment Receipt ${invoice.invoice_number}`,"Stripe payment receipt","invoice",String(invoice.id),filename,filename,"application/pdf",pdf.length,publicPath,
      JSON.stringify({document_type:"payment_receipt",invoice_id:invoice.id,payment_id:payment.id,checkout_id:checkout.id})
    );
    const archiveId=Number(info.lastInsertRowid);
    db.prepare("UPDATE workshop_invoice_checkouts SET receipt_archive_document_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(archiveId,checkout.id);
    return db.prepare("SELECT * FROM document_archive WHERE id=?").get(archiveId);
  }
  function loadArchivePdf(row){
    if(!row?.file_path?.startsWith("/uploads/"))return null;
    const absolute=path.join(uploadDir,row.file_path.replace(/^\/uploads\//,""));
    return fs.existsSync(absolute)?fs.readFileSync(absolute):null;
  }
  function communicationLog({invoice,recipient,language,status,providerMessageId=null,errorCode=null,dedupeKey,metadata={}}){
    db.prepare(`INSERT INTO customer_communication_log(event_type,invoice_id,client_id,recipient,language,status,provider_message_id,error_code,dedupe_key,metadata_json,created_at)
      VALUES('PAYMENT_RECEIPT',?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(dedupe_key) DO UPDATE SET recipient=excluded.recipient,language=excluded.language,status=excluded.status,provider_message_id=excluded.provider_message_id,error_code=excluded.error_code,metadata_json=excluded.metadata_json,created_at=CURRENT_TIMESTAMP`)
      .run(invoice.id,invoice.client_id,recipient,language,status,providerMessageId,errorCode,dedupeKey,JSON.stringify(metadata||{}));
  }
  if(automationOutbox){
    automationOutbox.register("SEND_PAYMENT_RECEIPT",async(payload,row)=>{
      const checkout=db.prepare("SELECT * FROM workshop_invoice_checkouts WHERE id=?").get(text(payload?.checkout_id,200));
      if(!checkout||checkout.status!=="PAID")throw nonRetryable("WORKSHOP_PAYMENT_NOT_FOUND");
      if(checkout.receipt_sent_at&&checkout.receipt_provider_message_id)return;
      const invoice=invoiceContext(checkout.invoice_id),payment=paymentRecord(checkout.invoice_id);
      if(!invoice||invoice.status!=="paid"||!payment)throw nonRetryable("PAID_INVOICE_NOT_FOUND");
      const recipient=String(invoice.counterparty_email||invoice.client_email||"").trim().toLowerCase(),language=invoice.preferred_language==="hu"?"hu":"en";
      const dedupeKey=`payment-receipt-${invoice.id}`,archive=receiptArchive(checkout,invoice,payment),pdf=loadArchivePdf(archive);
      if(!validEmail(recipient)){
        communicationLog({invoice,recipient:recipient||null,language,status:"failed",errorCode:"CLIENT_EMAIL_REQUIRED",dedupeKey,metadata:{checkout_id:checkout.id,archive_document_id:archive.id}});
        throw nonRetryable("CLIENT_EMAIL_REQUIRED");
      }
      try{
        const delivery=await transactionalEmail.sendPaymentReceipt({
          to:recipient,clientName:invoice.counterparty_name||invoice.client_name,invoiceNumber:invoice.invoice_number,
          amount:payment.amount,paymentMethod:payment.payment_method,paidAt:payment.paid_at,receiptPdf:pdf,language,
          idempotencyKey:`workshop-payment-receipt-${invoice.id}`
        });
        db.prepare("UPDATE workshop_invoice_checkouts SET receipt_provider_message_id=?,receipt_sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(delivery.providerMessageId,checkout.id);
        communicationLog({invoice,recipient,language,status:"sent",providerMessageId:delivery.providerMessageId,dedupeKey,metadata:{checkout_id:checkout.id,archive_document_id:archive.id,outbox_id:row.id}});
      }catch(error){
        communicationLog({invoice,recipient,language,status:"failed",errorCode:text(error?.code||error?.message||"EMAIL_DELIVERY_FAILED",120),dedupeKey,metadata:{checkout_id:checkout.id,archive_document_id:archive.id,outbox_id:row.id}});
        throw error;
      }
    });
  }

  async function processCheckoutEvent(eventType,session){
    if(session?.livemode)throw new Error("LIVE_STRIPE_EVENT_REJECTED");
    if(session?.metadata?.payment_domain!=="workshop_invoice")return {ignored:true};
    const checkoutId=text(session.metadata?.checkout_id||session.client_reference_id,200),invoiceId=Number(session.metadata?.invoice_id||0);
    const checkout=checkoutId&&db.prepare("SELECT * FROM workshop_invoice_checkouts WHERE id=?").get(checkoutId);
    if(!checkout||Number(checkout.invoice_id)!==invoiceId||checkout.stripe_checkout_session_id!==session.id)throw new Error("WORKSHOP_CHECKOUT_NOT_FOUND");
    if(["checkout.session.expired","checkout.session.async_payment_failed"].includes(eventType)){
      db.prepare("UPDATE workshop_invoice_checkouts SET status=?,failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'")
        .run(eventType==="checkout.session.expired"?"EXPIRED":"FAILED",eventType,checkout.id);
      return {workshop_invoice:true,released:true,invoice_id:invoiceId};
    }
    if(!["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(eventType))return {workshop_invoice:true,ignored:true};
    if(session.payment_status!=="paid")return {workshop_invoice:true,pending:true,invoice_id:invoiceId};

    const invoice=invoiceContext(invoiceId);if(!invoice)throw new Error("INVOICE_NOT_FOUND");
    if(invoice.status==="paid"){
      db.prepare("UPDATE workshop_invoice_checkouts SET status='PAID',paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(checkout.id);
      return {workshop_invoice:true,duplicate:true,invoice_id:invoiceId};
    }
    if(invoice.status!=="sent")throw new Error("INVOICE_NOT_SENT");
    if(String(session.currency||"").toLowerCase()!=="usd"||String(invoice.currency||"USD").toUpperCase()!=="USD")throw new Error("STRIPE_CURRENCY_MISMATCH");
    const expected=Math.round(Number(invoice.total_amount||0)*100),actual=Number(session.amount_total||0);
    if(expected!==actual||expected!==Number(checkout.amount_cents))throw new Error("STRIPE_AMOUNT_MISMATCH");
    const paymentIntent=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id||"";
    if(!paymentIntent)throw new Error("STRIPE_PAYMENT_INTENT_MISSING");

    let paymentId=null;
    db.transaction(()=>{
      const existing=paymentRecord(invoiceId);
      if(existing)throw new Error("INVOICE_PAYMENT_ALREADY_RECORDED");
      const info=db.prepare(`INSERT INTO invoice_payments(invoice_id,amount,payment_method,reference,paid_at,notes,created_by_user_id)
        VALUES(?,?,'Credit Card / Stripe',?,?,?,NULL)`).run(invoiceId,money(invoice.total_amount),paymentIntent,nyDate(),"Stripe Checkout automated reconciliation");
      paymentId=Number(info.lastInsertRowid);
      db.prepare("UPDATE invoices SET status='paid',payment_method='Credit Card / Stripe',paid_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nyDate(),invoiceId);
      db.prepare("UPDATE workshop_invoice_checkouts SET status='PAID',stripe_payment_intent_id=?,paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(paymentIntent,checkout.id);
    })();

    if(automationOutbox){
      automationOutbox.enqueue({
        eventType:"SEND_PAYMENT_RECEIPT",entityType:"invoice",entityId:String(invoiceId),
        payload:{invoice_id:invoiceId,payment_id:paymentId,checkout_id:checkout.id},
        dedupeKey:`payment-receipt-${invoiceId}`
      });
    }
    return {workshop_invoice:true,paid:true,invoice_id:invoiceId,payment_id:paymentId};
  }

  function registerPublicRoutes(app){
    app.get("/api/public/workshop-invoices/pay/:token",async(req,res)=>{
      try{
        const result=await checkoutForToken(req.params.token);
        if(result.paid)return res.status(200).type("html").send("<!doctype html><html><body><h1>Payment already received</h1><p>Thank you. This Klavierhaus invoice is already paid.</p></body></html>");
        res.redirect(303,result.checkout_url);
      }catch(error){res.status(Number(error?.status||400)).json({error:error?.message||"WORKSHOP_PAYMENT_FAILED"});}
    });
    app.get("/api/public/workshop-invoices/payment-success",(req,res)=>{
      res.status(200).type("html").send(`<!doctype html><html><body style="font-family:Arial,sans-serif;padding:40px"><h1>Payment received</h1><p>Thank you. Klavierhaus is confirming your payment. A receipt will be emailed automatically.</p><p>${text(req.query?.invoice,120)}</p></body></html>`);
    });
    app.get("/api/public/workshop-invoices/payment-cancelled",(req,res)=>{
      res.status(200).type("html").send(`<!doctype html><html><body style="font-family:Arial,sans-serif;padding:40px"><h1>Payment not completed</h1><p>No payment was recorded. You can use the payment link from your invoice again.</p><p>${text(req.query?.invoice,120)}</p></body></html>`);
    });
  }

  return {configured,testMode:true,ensurePaymentLink,checkoutForToken,processCheckoutEvent,registerPublicRoutes,tokenFor,invoiceForToken};
}

module.exports={createWorkshopPayments,normalizeBaseUrl,nyDate};
