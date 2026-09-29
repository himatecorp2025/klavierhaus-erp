"use strict";

const fs=require("node:fs");
const path=require("node:path");
const {generateBusinessInvoicePdf,generateMonthlyInvoiceReportPdf}=require("./document-pdf");

const PAYMENT_METHODS=Object.freeze(["Cash","Credit Card / Stripe","Bank Transfer","Check"]);
const INVOICE_STATUSES=Object.freeze(["draft","sent","paid","cancelled"]);
const COMPANY_KEYS=Object.freeze(["trade_name","legal_name","address_line1","address_line2","city","state","postal_code","tax_id","email","phone"]);

function text(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function integerId(value){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null;}
function money(value){const number=Number(value??0);return Number.isFinite(number)?Math.round((number+Number.EPSILON)*100)/100:NaN;}
function problem(code,status=400,extra=null){const error=new Error(code);error.status=status;error.extra=extra;return error;}
function respondError(res,error){res.status(Number(error?.status||400)).json({error:error?.message||"FINANCE_REQUEST_FAILED",...(error?.extra||{})});}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||""))&&!Number.isNaN(new Date(String(value)+"T12:00:00Z").getTime());}
function validMonth(value){return /^\d{4}-\d{2}$/.test(String(value||""));}
function normalizeEmail(value){return text(value,320).toLowerCase();}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));}
function json(value,fallback={}){try{return JSON.parse(String(value||"{}"));}catch(_error){return fallback;}}
function phaseLabel(value){return text(value,160).replaceAll("_"," ").replace(/\b\w/g,ch=>ch.toUpperCase())||"Service work";}
function nyDate(value=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value instanceof Date?value:new Date(value));
  const p=Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function addDays(dateKey,days){const d=new Date(dateKey+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString().slice(0,10);}
function nextMonth(month){const d=new Date(month+"-01T12:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,7);}
function isAdmin(user){return Boolean(user&&(user.role==="ADMIN"||user.role==="SUPERADMIN"||Number(user.is_superadmin||0)===1));}
function normalizePaymentMethod(value){
  const method=text(value,80);
  if(!PAYMENT_METHODS.includes(method))throw problem("INVALID_PAYMENT_METHOD");
  return method;
}
function normalizeItems(items,{allowEmpty=false}={}){
  if((!Array.isArray(items)||!items.length)&&!allowEmpty)throw problem("INVOICE_ITEMS_REQUIRED");
  return (Array.isArray(items)?items:[]).map((item,index)=>{
    const type=["labor","material","adjustment","other"].includes(String(item?.item_type))?String(item.item_type):"other";
    const description=text(item?.item_description??item?.description,1000);
    const quantity=Number(item?.quantity??1),unitPrice=money(item?.unit_price??item?.unitPrice??0),totalPrice=money(quantity*unitPrice);
    if(!description)throw problem("INVOICE_ITEM_DESCRIPTION_REQUIRED");
    if(!Number.isFinite(quantity)||quantity<=0)throw problem("INVALID_INVOICE_ITEM_QUANTITY");
    if(!Number.isFinite(unitPrice))throw problem("INVALID_INVOICE_ITEM_PRICE");
    if(type!=="adjustment"&&unitPrice<0)throw problem("INVALID_INVOICE_ITEM_PRICE");
    const hasSplit=item?.labor_amount!==undefined||item?.material_amount!==undefined;
    const labor=hasSplit?money(item?.labor_amount||0):(type==="labor"?totalPrice:0);
    const material=hasSplit?money(item?.material_amount||0):(type==="material"?totalPrice:0);
    if(!Number.isFinite(labor)||!Number.isFinite(material)||labor<0||material<0)throw problem("INVALID_INVOICE_ITEM_SPLIT");
    if(hasSplit&&money(labor+material)!==totalPrice)throw problem("INVOICE_ITEM_SPLIT_MISMATCH");
    return {item_type:type,item_description:description,quantity,unit_price:unitPrice,total_price:totalPrice,labor_amount:labor,material_amount:material,phase_key:text(item?.phase_key,100)||null,sort_order:index};
  });
}
function totals(items,taxRate){
  const labor=money(items.reduce((sum,i)=>sum+Number(i.labor_amount||0),0));
  const material=money(items.reduce((sum,i)=>sum+Number(i.material_amount||0),0));
  const gross=money(items.reduce((sum,i)=>sum+Number(i.total_price||0),0));
  const adjustment=money(gross-labor-material),taxable=gross;
  if(taxable<0)throw problem("INVOICE_TOTAL_NEGATIVE");
  const tax=money(taxable*Number(taxRate||0)/100),total=money(taxable+tax);
  return {labor,material,adjustment,tax,total};
}
function resolveLogoPath(logoUrl,uploadDir){
  const value=text(logoUrl,1000);
  if(value.startsWith("/uploads/")&&uploadDir){
    const relative=value.replace(/^\/uploads\//,"");
    const candidate=path.join(uploadDir,relative);
    if(fs.existsSync(candidate))return candidate;
  }
  if(value.startsWith("/icons/")){
    const candidate=path.join(__dirname,"..","public",value.slice(1));if(fs.existsSync(candidate))return candidate;
  }
  const fallback=path.join(__dirname,"assets","klavierhaus-logo-black.jpg");
  return fs.existsSync(fallback)?fallback:null;
}

function registerRound3FinanceRoutes({app,db,auth,permit,requireSuperadmin,audit,uploadDir,transactionalEmail,automationOutbox=null,customerAutomation=null,workshopPayments=null}){
  const financeReader=permit("ADMIN","MANAGER");
  const financeAdmin=permit("ADMIN");
  function customerMilestone(jobId,eventType){
    if(!customerAutomation||!jobId)return null;
    try{return customerAutomation.enqueueJobMilestone(jobId,eventType);}catch(error){console.warn("[CUSTOMER-MILESTONE]",eventType,jobId,error.message);return null;}
  }
  const invoiceDir=path.join(uploadDir,"invoices");
  fs.mkdirSync(invoiceDir,{recursive:true});

  const selectInvoice=`SELECT i.*,c.name AS client_name,c.email AS client_master_email,p.company_name AS partner_name,j.job_code,j.title AS job_title,
    pi.brand AS piano_brand,pi.model AS piano_model,pi.serial_number AS piano_serial_number
    FROM invoices i
    LEFT JOIN clients c ON c.id=i.client_id
    LEFT JOIN partners p ON p.id=i.partner_id
    LEFT JOIN jobs j ON j.id=i.job_id
    LEFT JOIN pianos pi ON pi.id=j.piano_id`;

  function company(){
    const row={};
    for(const key of COMPANY_KEYS)row[key]=db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get("finance_company_"+key)?.setting_value||"";
    if(!row.trade_name)row.trade_name=db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='company_name'").get()?.setting_value||"Klavierhaus";
    row.logo_url=db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='logo_url'").get()?.setting_value||"/icons/icon-512.png";
    return row;
  }
  function setCompany(values,user){
    const save=db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`);
    for(const key of COMPANY_KEYS)save.run("finance_company_"+key,text(values?.[key],key.includes("address")?1000:320),user?.name||user?.id||"SYSTEM");
    return company();
  }
  function persistClientEmail(clientId,value){
    const email=normalizeEmail(value);
    if(!email)return null;
    if(!validEmail(email))throw problem("INVALID_CLIENT_EMAIL");
    const client=clientById(clientId);if(!client)throw problem("INVALID_CLIENT_ID");
    if(normalizeEmail(client.email)!==email)db.prepare("UPDATE clients SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(email,clientId);
    return email;
  }
  function invoiceDetail(id){
    const row=db.prepare(`${selectInvoice} WHERE i.id=?`).get(id);
    if(!row)return null;
    return {...row,snapshot:json(row.snapshot_json,{}),
      items:db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order,id").all(id),
      payments:db.prepare("SELECT * FROM invoice_payments WHERE invoice_id=? ORDER BY paid_at,id").all(id),
      email_log:db.prepare("SELECT * FROM invoice_email_log WHERE invoice_id=? ORDER BY created_at DESC,id DESC").all(id),
      communication_log:db.prepare("SELECT * FROM customer_communication_log WHERE invoice_id=? ORDER BY created_at DESC,id DESC").all(id)
    };
  }
  function nextInvoiceNumber(direction,issueDate){
    const year=Number(String(issueDate).slice(0,4));
    db.prepare("INSERT OR IGNORE INTO invoice_sequences(direction,sequence_year,last_value) VALUES(?,?,0)").run(direction,year);
    db.prepare("UPDATE invoice_sequences SET last_value=last_value+1 WHERE direction=? AND sequence_year=?").run(direction,year);
    const n=db.prepare("SELECT last_value FROM invoice_sequences WHERE direction=? AND sequence_year=?").get(direction,year)?.last_value;
    return `${direction==="payable"?"VND":"INV"}-${year}-${String(n).padStart(4,"0")}`;
  }
  function clientById(id){return id&&db.prepare("SELECT * FROM clients WHERE id=?").get(id);}
  function partnerById(id){return id&&db.prepare("SELECT * FROM partners WHERE id=?").get(id);}
  function jobForInvoice(id){
    const row=id&&db.prepare(`SELECT j.*,c.name client_name,c.email client_email,c.phone client_phone,c.address client_address,
      p.brand piano_brand,p.model piano_model,p.serial_number piano_serial_number,p.location_notes piano_location_notes
      FROM jobs j JOIN clients c ON c.id=j.client_id JOIN pianos p ON p.id=j.piano_id WHERE j.id=?`).get(id);
    return row?{...row,storage_stage:row.stage,stage:row.workflow_stage_key||row.stage}:null;
  }
  function workflowReadyForCloseout(job){
    if(!job||job.stage==="planned"||job.stage==="completed")return job?.stage==="completed";
    if(job.stage!=="admin_approval")return false;
    const pending=db.prepare(`SELECT stage_key FROM job_workflow_phases
      WHERE job_id=? AND enabled=1 AND completed_at IS NULL AND stage_key NOT IN ('admin_approval','completed') LIMIT 1`).get(job.id);
    return !pending;
  }
  function markWorkflowCompleted(jobId,currentStage){
    db.prepare("UPDATE job_workflow_phases SET completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND stage_key=?").run(jobId,currentStage);
    db.prepare("UPDATE job_workflow_phases SET enabled=1,activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP),completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND stage_key='completed'").run(jobId);
  }
  function defaultJobItems(job){
    const handoffs=db.prepare("SELECT * FROM job_handoffs WHERE job_id=? ORDER BY created_at,id").all(job.id);
    if(handoffs.length){
      return handoffs.map(row=>{
        const labor=money(row.phase_labor_cost||0),material=money(row.phase_material_cost||0),total=money(labor+material);
        return {item_type:"other",item_description:text(row.billing_description,500)||phaseLabel(row.from_stage),quantity:1,unit_price:total,labor_amount:labor,material_amount:material,phase_key:row.from_stage||null};
      });
    }
    const rows=[];
    if(Number(job.total_labor_cost||0)>0)rows.push({item_type:"labor",item_description:"Labor / technician service",quantity:1,unit_price:Number(job.total_labor_cost),labor_amount:Number(job.total_labor_cost),material_amount:0});
    if(Number(job.total_material_cost||0)>0)rows.push({item_type:"material",item_description:"Materials and parts",quantity:1,unit_price:Number(job.total_material_cost),labor_amount:0,material_amount:Number(job.total_material_cost)});
    if(!rows.length)rows.push({item_type:"labor",item_description:job.title||"Klavierhaus service",quantity:1,unit_price:0,labor_amount:0,material_amount:0});
    return rows;
  }
  function persistPdf(invoiceId){
    const invoice=invoiceDetail(invoiceId);if(!invoice)throw problem("INVOICE_NOT_FOUND",404);
    const snapshot=invoice.snapshot||{},info=snapshot.issuer&&Object.keys(snapshot.issuer).length?snapshot.issuer:company(),logoPath=resolveLogoPath(info.logo_url,uploadDir);
    const party=snapshot.counterparty||{},instrument=snapshot.instrument||{},job=snapshot.job||{};
    const printable={...invoice,
      counterparty_name:party.name||invoice.counterparty_name,counterparty_address:party.address||invoice.counterparty_address,
      counterparty_email:party.email||invoice.counterparty_email,counterparty_phone:party.phone||invoice.counterparty_phone,
      piano_brand:instrument.brand||invoice.piano_brand,piano_model:instrument.model||invoice.piano_model,piano_serial_number:instrument.serial_number||invoice.piano_serial_number,
      piano_location_notes:instrument.location_notes||invoice.piano_location_notes,job_code:job.job_code||invoice.job_code,job_title:job.title||invoice.job_title,
      location_type:job.location_type||invoice.location_type,site_address:job.site_address||invoice.site_address
    };
    const pdf=generateBusinessInvoicePdf({company:info,invoice:printable,items:invoice.items,counterpartyName:printable.counterparty_name,logoPath});
    const filename=`${invoice.invoice_number}.pdf`,filePath=path.join(invoiceDir,filename);
    fs.writeFileSync(filePath,pdf);
    const publicPath=`/uploads/invoices/${filename}`;
    db.prepare("UPDATE invoices SET pdf_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(publicPath,invoiceId);
    return {pdf,path:publicPath,invoice:invoiceDetail(invoiceId)};
  }
  function archiveInvalidatedInvoice(invoiceId,reason,actor){
    return db.transaction(()=>{
      const existing=invoiceDetail(invoiceId);if(!existing)throw problem("INVOICE_NOT_FOUND",404);
      const persisted=persistPdf(invoiceId),snapshot=invoiceDetail(invoiceId);
      if(snapshot.archive_document_id)return {invoice:snapshot,archive_document_id:Number(snapshot.archive_document_id)};
      const info=db.prepare(`INSERT INTO document_archive(category,title,description,entity_type,entity_id,original_name,stored_name,mime_type,size_bytes,file_path,metadata_json,archived_by_user_id)
        VALUES('deleted_invoice',?,?,?,?,?,?,?,?,?,?,?)`).run(
        `Invalidated invoice ${snapshot.invoice_number}`,reason||snapshot.cancel_reason||"Invoice invalidated","invoice",String(snapshot.id),snapshot.invoice_number+".pdf",
        persisted.path?path.basename(persisted.path):null,"application/pdf",persisted.pdf.length,persisted.path,
        JSON.stringify({source:"invoice_cancellation",invoice:snapshot,reason:reason||snapshot.cancel_reason||null}),actor.id
      );
      const archiveId=Number(info.lastInsertRowid);
      db.prepare("UPDATE invoices SET archive_document_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(archiveId,invoiceId);
      return {invoice:invoiceDetail(invoiceId),archive_document_id:archiveId};
    })();
  }

  function replaceItems(invoiceId,items,taxRate){
    const normalized=normalizeItems(items),calc=totals(normalized,taxRate);
    db.prepare("DELETE FROM invoice_items WHERE invoice_id=?").run(invoiceId);
    const insert=db.prepare("INSERT INTO invoice_items(invoice_id,item_type,item_description,quantity,unit_price,total_price,labor_amount,material_amount,phase_key,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)");
    normalized.forEach(item=>insert.run(invoiceId,item.item_type,item.item_description,item.quantity,item.unit_price,item.total_price,item.labor_amount,item.material_amount,item.phase_key,item.sort_order));
    db.prepare(`UPDATE invoices SET subtotal_labor=?,subtotal_material=?,subtotal_adjustment=?,tax_rate=?,tax_amount=?,total_amount=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(calc.labor,calc.material,calc.adjustment,Number(taxRate||0),calc.tax,calc.total,invoiceId);
    persistPdf(invoiceId);
    return invoiceDetail(invoiceId);
  }
  function createInvoice(input,actor){
    const direction=text(input?.direction||"receivable",20);
    if(!["receivable","payable"].includes(direction))throw problem("INVALID_INVOICE_DIRECTION");
    const clientId=direction==="receivable"?integerId(input?.client_id):null,partnerId=direction==="payable"?integerId(input?.partner_id):null;
    const party=direction==="receivable"?clientById(clientId):partnerById(partnerId);
    if(!party)throw problem(direction==="receivable"?"INVALID_CLIENT_ID":"INVALID_PARTNER_ID");
    if(direction==="payable"&&party.status!=="active")throw problem("PARTNER_INACTIVE",409);
    const issueDate=validDate(input?.issue_date)?String(input.issue_date):nyDate();
    const dueDate=validDate(input?.due_date)?String(input.due_date):addDays(issueDate,30);
    if(dueDate<issueDate)throw problem("INVALID_INVOICE_DUE_DATE");
    const taxRate=Number(input?.tax_rate??0);if(!Number.isFinite(taxRate)||taxRate<0||taxRate>100)throw problem("INVALID_TAX_RATE");
    const items=normalizeItems(input?.items),calc=totals(items,taxRate),jobId=integerId(input?.job_id),job=jobId?jobForInvoice(jobId):null;
    if(jobId){
      const existing=db.prepare("SELECT id FROM invoices WHERE job_id=? AND status<>'cancelled'").get(jobId);
      if(existing)return invoiceDetail(existing.id);
    }
    const invoiceNumber=nextInvoiceNumber(direction,issueDate),status=direction==="payable"?"sent":"draft";
    const counterparty={
      name:direction==="receivable"?party.name:party.company_name,
      contact:direction==="receivable"?null:text(party.contact_name,240)||null,
      email:text(party.email,320)||null,phone:text(party.phone,120)||null,address:text(party.address,1000)||null,
      tax_id:direction==="payable"?text(party.tax_id,160)||null:null
    };
    const serviceDate=validDate(input?.service_date)?String(input.service_date):(job?.completed_at?nyDate(new Date(job.completed_at)):issueDate);
    const snapshot={
      version:1,issuer:company(),counterparty,
      instrument:job?{brand:job.piano_brand||null,model:job.piano_model||null,serial_number:job.piano_serial_number||null,location_notes:job.piano_location_notes||null}:null,
      job:job?{id:job.id,job_code:job.job_code,title:job.title,location_type:job.location_type,site_address:job.site_address,scheduled_at:job.scheduled_at}:null,
      created_at:new Date().toISOString()
    };
    const info=db.prepare(`INSERT INTO invoices(
      invoice_number,direction,status,source_type,source_id,job_id,client_id,partner_id,counterparty_name,counterparty_contact,counterparty_email,
      counterparty_phone,counterparty_address,counterparty_tax_id,summary,notes,issue_date,service_date,due_date,currency,snapshot_json,subtotal_labor,subtotal_material,
      subtotal_adjustment,tax_rate,tax_amount,total_amount,email_language,created_by_user_id,created_at,updated_at
    ) VALUES(
      @invoice_number,@direction,@status,@source_type,@source_id,@job_id,@client_id,@partner_id,@counterparty_name,@counterparty_contact,@counterparty_email,
      @counterparty_phone,@counterparty_address,@counterparty_tax_id,@summary,@notes,@issue_date,@service_date,@due_date,'USD',@snapshot_json,@subtotal_labor,@subtotal_material,
      @subtotal_adjustment,@tax_rate,@tax_amount,@total_amount,@email_language,@created_by_user_id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
    )`).run({
      invoice_number:invoiceNumber,direction,status,source_type:text(input?.source_type||"manual",20),source_id:text(input?.source_id,160)||null,job_id:jobId,
      client_id:clientId,partner_id:partnerId,counterparty_name:counterparty.name,counterparty_contact:counterparty.contact,counterparty_email:counterparty.email,
      counterparty_phone:counterparty.phone,counterparty_address:counterparty.address,counterparty_tax_id:counterparty.tax_id,
      summary:text(input?.summary,1000)||"Klavierhaus service",notes:text(input?.notes,5000)||null,issue_date:issueDate,service_date:serviceDate,due_date:dueDate,
      snapshot_json:JSON.stringify(snapshot),subtotal_labor:calc.labor,subtotal_material:calc.material,subtotal_adjustment:calc.adjustment,tax_rate:taxRate,tax_amount:calc.tax,total_amount:calc.total,
      email_language:["en","hu"].includes(input?.email_language)?input.email_language:"en",created_by_user_id:actor?.id||null
    });
    const invoiceId=Number(info.lastInsertRowid);
    const insertItem=db.prepare("INSERT INTO invoice_items(invoice_id,item_type,item_description,quantity,unit_price,total_price,labor_amount,material_amount,phase_key,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)");
    items.forEach(item=>insertItem.run(invoiceId,item.item_type,item.item_description,item.quantity,item.unit_price,item.total_price,item.labor_amount,item.material_amount,item.phase_key,item.sort_order));
    persistPdf(invoiceId);
    return invoiceDetail(invoiceId);
  }
  function generateFromJob(jobId,body,actor){
    const job=jobForInvoice(jobId);if(!job)throw problem("JOB_NOT_FOUND",404);
    if(job.cancelled_at)throw problem("JOB_CANCELLED",409);
    if(job.stage!=="completed"&&!workflowReadyForCloseout(job))throw problem("JOB_NOT_READY_FOR_INVOICE",409);
    const existing=db.prepare("SELECT id FROM invoices WHERE job_id=? AND status<>'cancelled' ORDER BY id DESC LIMIT 1").get(jobId);
    if(existing){
      const invoice=invoiceDetail(existing.id);
      if(invoice.status==="draft"&&Array.isArray(body?.items))return replaceItems(invoice.id,body.items,Number(body?.tax_rate??invoice.tax_rate));
      return invoice;
    }
    const items=Array.isArray(body?.items)&&body.items.length?body.items:defaultJobItems(job);
    return createInvoice({
      direction:"receivable",source_type:"job",source_id:String(job.id),job_id:job.id,client_id:job.client_id,
      summary:text(body?.summary,1000)||`${job.job_code||"Job"} · ${job.title}`,notes:body?.notes,issue_date:body?.issue_date,due_date:body?.due_date,
      tax_rate:body?.tax_rate??0,email_language:body?.email_language||"en",items
    },actor);
  }
  function completeJob(jobId,actor){
    const before=jobForInvoice(jobId);if(!before)throw problem("JOB_NOT_FOUND",404);
    if(before.cancelled_at)throw problem("JOB_CANCELLED",409);
    if(before.stage==="completed")return before;
    if(!workflowReadyForCloseout(before))throw problem("JOB_NOT_READY_FOR_CLOSEOUT",409);
    if(!isAdmin(actor))throw problem("ADMIN_REQUIRED",403);
    markWorkflowCompleted(jobId,before.stage);
    db.prepare(`UPDATE jobs SET stage='completed',workflow_stage_key='completed',completed_at=CURRENT_TIMESTAMP,completed_by_user_id=?,completed_by_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(actor.id,actor.name,jobId);
    db.prepare("UPDATE pianos SET last_serviced_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nyDate(),before.piano_id);
    return jobForInvoice(jobId);
  }
  async function sendInvoiceNow(invoiceId,actor,languageOverride,recipientOverride){
    let invoice=invoiceDetail(invoiceId);if(!invoice||invoice.deleted_at)throw problem("INVOICE_NOT_FOUND",404);
    if(invoice.direction!=="receivable")throw problem("PAYABLE_INVOICE_EMAIL_NOT_SUPPORTED",409);
    if(invoice.status==="paid")return invoice;
    if(invoice.status==="cancelled")throw problem("INVOICE_CANCELLED",409);
    if(invoice.status==="sent")return invoice;
    const currentClient=invoice.client_id?clientById(invoice.client_id):null;
    const recipient=normalizeEmail(recipientOverride||invoice.counterparty_email||currentClient?.email);
    if(!recipient)throw problem("CLIENT_EMAIL_REQUIRED",409);
    if(!validEmail(recipient))throw problem("INVALID_CLIENT_EMAIL");
    if(invoice.client_id)persistClientEmail(invoice.client_id,recipient);
    if(normalizeEmail(invoice.counterparty_email)!==recipient){
      db.prepare("UPDATE invoices SET counterparty_email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(recipient,invoice.id);
      invoice=invoiceDetail(invoice.id);
    }
    const language=["en","hu"].includes(languageOverride)?languageOverride:invoice.email_language||"en";
    if(workshopPayments?.configured){
      workshopPayments.ensurePaymentLink(invoice.id);
      invoice=invoiceDetail(invoice.id);
    }
    const persisted=persistPdf(invoice.id);
    try{
      const delivery=await transactionalEmail.sendWorkshopInvoice({
        to:recipient,clientName:invoice.counterparty_name,
        piano:{brand:invoice.piano_brand,model:invoice.piano_model,serial_number:invoice.piano_serial_number},
        workSummary:invoice.summary,invoiceNumber:invoice.invoice_number,totalAmount:invoice.total_amount,paymentUrl:invoice.payment_url||"",invoicePdf:persisted.pdf,language,
        idempotencyKey:`workshop-invoice-${invoice.id}`
      });
      db.transaction(()=>{
        db.prepare(`UPDATE invoices SET status='sent',email_language=?,sent_at=CURRENT_TIMESTAMP,sent_by_user_id=?,resend_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(language,actor.id,delivery.providerMessageId,invoice.id);
        db.prepare("INSERT INTO invoice_email_log(invoice_id,recipient,language,status,provider_message_id,created_by_user_id) VALUES(?,?,?,'sent',?,?)")
          .run(invoice.id,recipient,language,delivery.providerMessageId,actor.id);
        if(invoice.job_id)completeJob(invoice.job_id,actor);
      })();
      return invoiceDetail(invoice.id);
    }catch(error){
      db.prepare("INSERT INTO invoice_email_log(invoice_id,recipient,language,status,error_code,created_by_user_id) VALUES(?,?,?,'failed',?,?)")
        .run(invoice.id,recipient,language,text(error?.code||error?.message||"EMAIL_DELIVERY_FAILED",120),actor.id);
      throw problem(error?.code==="EMAIL_DELIVERY_NOT_CONFIGURED"?"EMAIL_DELIVERY_NOT_CONFIGURED":"EMAIL_DELIVERY_FAILED",error?.code==="EMAIL_DELIVERY_NOT_CONFIGURED"?503:502);
    }
  }
  if(automationOutbox){
    automationOutbox.register("SEND_INVOICE",async payload=>{
      const actor=db.prepare("SELECT id,name,role,is_superadmin FROM users WHERE id=?").get(payload.actor_user_id)
        ||db.prepare("SELECT id,name,role,is_superadmin FROM users WHERE status='Active' AND (role='ADMIN' OR is_superadmin=1) ORDER BY is_superadmin DESC,id LIMIT 1").get();
      if(!actor)throw problem("ADMIN_REQUIRED",403);
      await sendInvoiceNow(Number(payload.invoice_id),actor,payload.language,payload.recipient);
    });
  }
  async function sendInvoice(invoiceId,actor,languageOverride,recipientOverride){
    const invoice=invoiceDetail(invoiceId);if(!invoice||invoice.deleted_at)throw problem("INVOICE_NOT_FOUND",404);
    if(invoice.status==="sent"||invoice.status==="paid")return invoice;
    const currentClient=invoice.client_id?clientById(invoice.client_id):null;
    const recipient=normalizeEmail(recipientOverride||invoice.counterparty_email||currentClient?.email);
    if(!recipient)throw problem("CLIENT_EMAIL_REQUIRED",409);
    if(!validEmail(recipient))throw problem("INVALID_CLIENT_EMAIL");
    const language=["en","hu"].includes(languageOverride)?languageOverride:invoice.email_language||"en";
    if(!automationOutbox)return sendInvoiceNow(invoiceId,actor,language,recipient);
    const event=automationOutbox.enqueue({
      eventType:"SEND_INVOICE",entityType:"invoice",entityId:String(invoiceId),
      payload:{invoice_id:invoiceId,actor_user_id:actor?.id||null,language,recipient},
      dedupeKey:`invoice-send-${invoiceId}`
    });
    try{await automationOutbox.run(event.id);}catch(error){throw error;}
    return invoiceDetail(invoiceId);
  }
  function overview(monthValue){
    const month=validMonth(monthValue)?String(monthValue):nyDate().slice(0,7),first=month+"-01",next=nextMonth(month)+"-01";
    const laborRevenue=money(db.prepare(`SELECT COALESCE(SUM(subtotal_labor),0) amount FROM invoices
      WHERE deleted_at IS NULL AND direction='receivable' AND status='paid' AND paid_at>=? AND paid_at<?`).get(first,next).amount);
    const handoffMaterial=money(db.prepare("SELECT COALESCE(SUM(phase_material_cost),0) amount FROM job_handoffs WHERE created_at>=? AND created_at<?").get(first,next).amount);
    const cancelledLabor=money(db.prepare(`SELECT COALESCE(SUM(total_labor_cost),0) amount FROM jobs WHERE cancelled_at>=? AND cancelled_at<?`).get(first,next).amount);
    const directExpense=money(db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM direct_expenses WHERE expense_date>=? AND expense_date<?").get(first,next).amount);
    const vendorCost=money(db.prepare(`SELECT COALESCE(SUM(total_amount),0) amount FROM invoices WHERE deleted_at IS NULL AND direction='payable' AND status='paid' AND paid_at>=? AND paid_at<?`).get(first,next).amount);
    const materialDirectCost=money(handoffMaterial+cancelledLabor+directExpense+vendorCost);
    const net=money(laborRevenue-materialDirectCost);
    const outstanding=db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(total_amount),0) amount FROM invoices
      WHERE direction='receivable' AND deleted_at IS NULL AND status IN ('draft','sent')`).get();
    const result={month,kpis:{
      labor_revenue:laborRevenue,material_direct_cost:materialDirectCost,net_workshop_result:net,
      outstanding_invoice_count:Number(outstanding.count||0),outstanding_invoice_amount:money(outstanding.amount)
    },breakdown:{handoff_material:handoffMaterial,cancelled_labor:cancelledLabor,direct_expenses:directExpense,paid_vendor_bills:vendorCost}};
    db.prepare(`INSERT INTO kpi_summary_cache(month_key,labor_revenue,material_direct_cost,net_workshop_result,outstanding_invoice_count,outstanding_invoice_amount,refreshed_at)
      VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(month_key) DO UPDATE SET labor_revenue=excluded.labor_revenue,material_direct_cost=excluded.material_direct_cost,
      net_workshop_result=excluded.net_workshop_result,outstanding_invoice_count=excluded.outstanding_invoice_count,outstanding_invoice_amount=excluded.outstanding_invoice_amount,refreshed_at=CURRENT_TIMESTAMP`)
      .run(month,laborRevenue,materialDirectCost,net,Number(outstanding.count||0),money(outstanding.amount));
    return result;
  }
  function replaceContractors(partnerId,userIds){
    const ids=[...new Set((Array.isArray(userIds)?userIds:[]).map(value=>text(value,160)).filter(Boolean))];
    for(const userId of ids){
      const user=db.prepare("SELECT id FROM users WHERE id=? AND status='Active' AND role IN ('WORKER','MANAGER','ADMIN')").get(userId);
      if(!user)throw problem("INVALID_CONTRACTOR_USER_ID");
      const owner=db.prepare("SELECT partner_id FROM partner_contractors WHERE user_id=? AND partner_id<>?").get(userId,partnerId);
      if(owner)throw problem("PARTNER_CONTRACTOR_ALREADY_ASSIGNED",409,{user_id:userId,partner_id:owner.partner_id});
    }
    db.prepare("DELETE FROM partner_contractors WHERE partner_id=?").run(partnerId);
    const insert=db.prepare("INSERT INTO partner_contractors(partner_id,user_id) VALUES(?,?)");ids.forEach(userId=>insert.run(partnerId,userId));
  }

  app.get("/api/finance/settings",auth,financeReader,(_req,res)=>res.json(company()));
  app.put("/api/finance/settings",auth,financeAdmin,(req,res)=>{
    const before=company(),after=setCompany(req.body||{},req.user);audit(req,"UPDATE","finance_settings","company",before,after);res.json(after);
  });

  app.get("/api/partners",auth,financeReader,(_req,res)=>{
    res.json(db.prepare(`SELECT p.*,COUNT(DISTINCT pc.user_id) contractor_count,COUNT(DISTINCT i.id) invoice_count
      FROM partners p LEFT JOIN partner_contractors pc ON pc.partner_id=p.id LEFT JOIN invoices i ON i.partner_id=p.id
      GROUP BY p.id ORDER BY lower(p.company_name),p.id`).all());
  });
  app.get("/api/partners/:id",auth,financeReader,(req,res)=>{
    const id=integerId(req.params.id),row=partnerById(id);if(!row)return res.status(404).json({error:"PARTNER_NOT_FOUND"});
    res.json({...row,contractor_user_ids:db.prepare("SELECT user_id FROM partner_contractors WHERE partner_id=? ORDER BY user_id").all(id).map(item=>item.user_id)});
  });
  app.post("/api/partners",auth,financeAdmin,(req,res)=>{
    try{
      const name=text(req.body?.company_name,240);if(!name)throw problem("PARTNER_NAME_REQUIRED");
      const result=db.transaction(()=>{
        const info=db.prepare("INSERT INTO partners(company_name,contact_name,email,phone,address,tax_id,notes,status) VALUES(?,?,?,?,?,?,?,'active')")
          .run(name,text(req.body?.contact_name,240)||null,text(req.body?.email,320)||null,text(req.body?.phone,120)||null,text(req.body?.address,1000)||null,text(req.body?.tax_id,160)||null,text(req.body?.notes,5000)||null);
        const id=Number(info.lastInsertRowid);replaceContractors(id,req.body?.contractor_user_ids);return partnerById(id);
      })();
      audit(req,"CREATE","partners",String(result.id),null,result);res.status(201).json(result);
    }catch(error){respondError(res,error);}
  });
  app.put("/api/partners/:id",auth,financeAdmin,(req,res)=>{
    const id=integerId(req.params.id),before=partnerById(id);if(!before)return res.status(404).json({error:"PARTNER_NOT_FOUND"});
    try{
      const result=db.transaction(()=>{
        const name=text(req.body?.company_name??before.company_name,240),status=text(req.body?.status??before.status,20);
        if(!name)throw problem("PARTNER_NAME_REQUIRED");if(!["active","inactive"].includes(status))throw problem("INVALID_PARTNER_STATUS");
        db.prepare("UPDATE partners SET company_name=?,contact_name=?,email=?,phone=?,address=?,tax_id=?,notes=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(name,text(req.body?.contact_name??before.contact_name,240)||null,text(req.body?.email??before.email,320)||null,text(req.body?.phone??before.phone,120)||null,
            text(req.body?.address??before.address,1000)||null,text(req.body?.tax_id??before.tax_id,160)||null,text(req.body?.notes??before.notes,5000)||null,status,id);
        if(Array.isArray(req.body?.contractor_user_ids))replaceContractors(id,req.body.contractor_user_ids);
        return partnerById(id);
      })();
      audit(req,"UPDATE","partners",String(id),before,result);res.json(result);
    }catch(error){respondError(res,error);}
  });
  app.delete("/api/partners/:id",auth,financeAdmin,(req,res)=>{
    const id=integerId(req.params.id),before=partnerById(id);if(!before)return res.status(404).json({error:"PARTNER_NOT_FOUND"});
    if(db.prepare("SELECT 1 FROM invoices WHERE partner_id=? LIMIT 1").get(id))return res.status(409).json({error:"PARTNER_HAS_INVOICES"});
    db.prepare("DELETE FROM partners WHERE id=?").run(id);audit(req,"DELETE","partners",String(id),before,null);res.json({ok:true});
  });

  app.get("/api/invoices",auth,financeReader,(req,res)=>{
    try{
      const direction=text(req.query.direction,20),status=text(req.query.status,20),q=text(req.query.q,160).toLowerCase(),like=`%${q}%`;
      if(direction&&!["receivable","payable"].includes(direction))throw problem("INVALID_INVOICE_DIRECTION");
      if(status&&!INVOICE_STATUSES.includes(status))throw problem("INVALID_INVOICE_STATUS");
      res.json(db.prepare(`${selectInvoice} WHERE i.deleted_at IS NULL AND i.status<>'cancelled' AND (?='' OR i.direction=?) AND (?='' OR i.status=?)
        AND (?='' OR lower(i.invoice_number) LIKE ? OR lower(i.counterparty_name) LIKE ? OR lower(i.summary) LIKE ? OR lower(COALESCE(j.job_code,'')) LIKE ?)
        ORDER BY i.issue_date DESC,i.id DESC`).all(direction,direction,status,status,q,like,like,like,like));
    }catch(error){respondError(res,error);}
  });
  app.get("/api/invoices/:id",auth,financeReader,(req,res)=>{
    const row=invoiceDetail(integerId(req.params.id));if(!row||row.deleted_at)return res.status(404).json({error:"INVOICE_NOT_FOUND"});res.json(row);
  });
  app.post("/api/invoices",auth,financeReader,(req,res)=>{
    try{
      const result=db.transaction(()=>createInvoice({...req.body,source_type:"manual"},req.user))();
      audit(req,"CREATE","invoices",String(result.id),null,result);res.status(201).json(result);
    }catch(error){respondError(res,error);}
  });
  app.put("/api/invoices/:id",auth,financeAdmin,(req,res)=>{
    const id=integerId(req.params.id),before=invoiceDetail(id);if(!before||before.deleted_at)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    if(before.status!=="draft")return res.status(409).json({error:"ONLY_DRAFT_INVOICE_EDITABLE"});
    try{
      const taxRate=Number(req.body?.tax_rate??before.tax_rate);
      const updated=db.transaction(()=>{
        if(Array.isArray(req.body?.items))replaceItems(id,req.body.items,taxRate);
        db.prepare("UPDATE invoices SET summary=?,notes=?,due_date=?,email_language=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(text(req.body?.summary??before.summary,1000),text(req.body?.notes??before.notes,5000)||null,validDate(req.body?.due_date)?req.body.due_date:before.due_date,
            ["en","hu"].includes(req.body?.email_language)?req.body.email_language:before.email_language,id);
        persistPdf(id);return invoiceDetail(id);
      })();
      audit(req,"UPDATE","invoices",String(id),before,updated);res.json(updated);
    }catch(error){respondError(res,error);}
  });

  app.post("/api/invoices/generate-from-job/:jobId",auth,financeAdmin,(req,res)=>{
    try{
      const invoice=db.transaction(()=>generateFromJob(integerId(req.params.jobId),req.body||{},req.user))();
      audit(req,"GENERATE_FROM_JOB","invoices",String(invoice.id),null,invoice);res.status(201).json(invoice);
    }catch(error){respondError(res,error);}
  });

  app.post("/api/jobs/:id/complete",auth,financeAdmin,async(req,res)=>{
    try{
      const id=integerId(req.params.id),before=jobForInvoice(id);if(!before)throw problem("JOB_NOT_FOUND",404);
      const mode=["draft","send"].includes(req.body?.invoice_mode)?req.body.invoice_mode:"draft";
      const result=db.transaction(()=>{
        if(req.body?.recipient_email)persistClientEmail(before.client_id,req.body.recipient_email);
        const invoice=generateFromJob(id,req.body||{},req.user);
        const job=completeJob(id,req.user);
        return {invoice,job};
      })();
      audit(req,"COMPLETE","jobs",String(id),before,result.job);
      customerMilestone(id,"WORK_COMPLETED");
      if(mode==="send"){
        try{result.invoice=await sendInvoice(result.invoice.id,req.user,req.body?.email_language,req.body?.recipient_email);}
        catch(error){return res.status(Number(error.status||502)).json({error:error.message||"EMAIL_DELIVERY_FAILED",job:result.job,invoice:invoiceDetail(result.invoice.id)});}
      }
      res.status(201).json({ok:true,invoice_mode:mode,...result});
    }catch(error){respondError(res,error);}
  });

  app.post("/api/jobs/:id/closeout",auth,financeAdmin,async(req,res)=>{
    req.body={...(req.body||{}),invoice_mode:req.body?.invoice_mode||"draft"};
    try{
      const id=integerId(req.params.id),before=jobForInvoice(id);if(!before)throw problem("JOB_NOT_FOUND",404);
      const mode=["draft","send"].includes(req.body.invoice_mode)?req.body.invoice_mode:"draft";
      const result=db.transaction(()=>{
        if(req.body?.recipient_email)persistClientEmail(before.client_id,req.body.recipient_email);
        return {invoice:generateFromJob(id,req.body,req.user),job:completeJob(id,req.user)};
      })();
      audit(req,"COMPLETE","jobs",String(id),before,result.job);
      customerMilestone(id,"WORK_COMPLETED");
      if(mode==="send")result.invoice=await sendInvoice(result.invoice.id,req.user,req.body?.email_language,req.body?.recipient_email);
      res.status(201).json({ok:true,invoice_mode:mode,...result});
    }catch(error){respondError(res,error);}
  });

  app.post("/api/invoices/:id/send-email",auth,financeAdmin,async(req,res)=>{
    const id=integerId(req.params.id),before=invoiceDetail(id);if(!before||before.deleted_at)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    try{
      const after=await sendInvoice(id,req.user,req.body?.language,req.body?.recipient_email);audit(req,"SEND_EMAIL","invoices",String(id),before,after);res.json(after);
    }catch(error){respondError(res,error);}
  });

  app.post("/api/invoices/:id/payment-link",auth,financeAdmin,(req,res)=>{
    const id=integerId(req.params.id),invoice=id&&invoiceDetail(id);if(!invoice||invoice.deleted_at)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    if(invoice.direction!=="receivable")return res.status(409).json({error:"PAYABLE_INVOICE_PAYMENT_LINK_NOT_SUPPORTED"});
    if(invoice.status==="paid")return res.status(409).json({error:"INVOICE_ALREADY_PAID"});
    if(!workshopPayments?.configured)return res.status(503).json({error:"WORKSHOP_STRIPE_NOT_CONFIGURED"});
    try{const link=workshopPayments.ensurePaymentLink(id);persistPdf(id);res.json({...link,invoice:invoiceDetail(id)});}catch(error){respondError(res,error);}
  });

  app.post("/api/invoices/:id/mark-paid",auth,financeReader,(req,res)=>{
    const id=integerId(req.params.id),before=invoiceDetail(id);if(!before||before.deleted_at)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    try{
      if(before.status==="paid")return res.json({ok:true,idempotent:true,invoice:before});
      if(before.status!=="sent")throw problem("INVOICE_NOT_SENT",409);
      const method=normalizePaymentMethod(req.body?.payment_method),paidAt=validDate(req.body?.paid_at)?req.body.paid_at:nyDate();
      const after=db.transaction(()=>{
        db.prepare("DELETE FROM invoice_payments WHERE invoice_id=?").run(id);
        db.prepare("INSERT INTO invoice_payments(invoice_id,amount,payment_method,reference,paid_at,notes,created_by_user_id) VALUES(?,?,?,?,?,?,?)")
          .run(id,before.total_amount,method,text(req.body?.reference,240)||null,paidAt,text(req.body?.notes,2000)||null,req.user.id);
        db.prepare("UPDATE invoices SET status='paid',payment_method=?,paid_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(method,paidAt,id);
        return invoiceDetail(id);
      })();
      audit(req,"MARK_PAID","invoices",String(id),before,after);res.json({ok:true,idempotent:false,invoice:after});
    }catch(error){respondError(res,error);}
  });

  app.post("/api/invoices/:id/cancel",auth,financeAdmin,(req,res)=>{
    const id=integerId(req.params.id),before=invoiceDetail(id);if(!before||before.deleted_at)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    if(before.status==="paid")return res.status(409).json({error:"PAID_INVOICE_CANNOT_BE_CANCELLED"});
    const reason=text(req.body?.reason,2000);if(!reason)return res.status(400).json({error:"CANCEL_REASON_REQUIRED"});
    if(before.status==="cancelled"&&before.archive_document_id)return res.json(before);
    db.prepare(`UPDATE invoices SET status='cancelled',cancelled_at=COALESCE(cancelled_at,CURRENT_TIMESTAMP),cancelled_by_user_id=?,cancel_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(req.user.id,reason,id);
    const archived=archiveInvalidatedInvoice(id,reason,req.user),after=archived.invoice;
    audit(req,"CANCEL","invoices",String(id),before,after);res.json(after);
  });
  app.post("/api/invoices/:id/void",auth,financeAdmin,(req,res)=>{
    req.body={...(req.body||{}),reason:req.body?.reason||"Legacy void action"};
    const id=integerId(req.params.id),before=invoiceDetail(id);if(!before||before.deleted_at)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    if(before.status==="paid")return res.status(409).json({error:"PAID_INVOICE_CANNOT_BE_CANCELLED"});
    const reason=text(req.body.reason,2000);
    if(before.status!=="cancelled")db.prepare("UPDATE invoices SET status='cancelled',cancelled_at=COALESCE(cancelled_at,CURRENT_TIMESTAMP),cancelled_by_user_id=?,cancel_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(req.user.id,reason,id);
    const archived=archiveInvalidatedInvoice(id,reason,req.user);
    audit(req,"VOID","invoices",String(id),before,archived.invoice);res.json({ok:true,invoice:archived.invoice,archive_document_id:archived.archive_document_id});
  });

  app.delete("/api/invoices/:id",auth,requireSuperadmin,(req,res)=>{
    const id=integerId(req.params.id),before=invoiceDetail(id);if(!before||before.deleted_at)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    if(!["draft","cancelled"].includes(before.status))return res.status(409).json({error:"INVOICE_DELETE_REQUIRES_DRAFT_OR_CANCELLED"});
    const reason=text(req.body?.reason,2000)||"Removed from active finance";
    const snapshot=JSON.stringify({invoice:before,reason});
    const filePath=before.pdf_path||null,localFile=filePath?.startsWith("/uploads/")?path.join(uploadDir,filePath.replace(/^\/uploads\//,"")):null;
    const size=localFile&&fs.existsSync(localFile)?fs.statSync(localFile).size:null;
    const archiveId=db.transaction(()=>{
      let nextId=Number(before.archive_document_id||0);
      if(!nextId){
        const info=db.prepare(`INSERT INTO document_archive(category,title,description,entity_type,entity_id,original_name,stored_name,mime_type,size_bytes,file_path,metadata_json,archived_by_user_id)
          VALUES('deleted_invoice',?,?,?,?,?,?,?,?,?,?,?)`).run(
          `Deleted invoice ${before.invoice_number}`,reason,"invoice",String(before.id),before.invoice_number+".pdf",
          filePath?path.basename(filePath):null,"application/pdf",size,filePath,snapshot,req.user.id
        );
        nextId=Number(info.lastInsertRowid);
      }
      db.prepare("UPDATE invoices SET deleted_at=CURRENT_TIMESTAMP,deleted_by_user_id=?,archive_document_id=?,job_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(req.user.id,nextId,id);
      return nextId;
    })();
    const after=invoiceDetail(id);audit(req,"ARCHIVE_DELETE","invoices",String(id),before,after);
    res.json({ok:true,archived:true,archive_document_id:archiveId});
  });

  app.get("/api/invoices/:id/pdf",auth,financeReader,(req,res)=>{
    try{
      const invoice=invoiceDetail(integerId(req.params.id));if(!invoice||invoice.deleted_at)throw problem("INVOICE_NOT_FOUND",404);
      const persisted=persistPdf(invoice.id);
      res.type("application/pdf").set("Content-Disposition",`attachment; filename="${invoice.invoice_number}.pdf"`).send(persisted.pdf);
    }catch(error){respondError(res,error);}
  });

  app.get("/api/direct-expenses",auth,financeReader,(req,res)=>{
    const month=validMonth(req.query.month)?String(req.query.month):"";
    if(!month)return res.json(db.prepare("SELECT * FROM direct_expenses ORDER BY expense_date DESC,id DESC").all());
    res.json(db.prepare("SELECT * FROM direct_expenses WHERE expense_date>=? AND expense_date<? ORDER BY expense_date DESC,id DESC").all(month+"-01",nextMonth(month)+"-01"));
  });
  app.post("/api/direct-expenses",auth,financeReader,(req,res)=>{
    const category=text(req.body?.category,160),description=text(req.body?.description,1000),amount=money(req.body?.amount),date=validDate(req.body?.expense_date)?req.body.expense_date:nyDate();
    if(!category||!description)return res.status(400).json({error:"DIRECT_EXPENSE_FIELDS_REQUIRED"});
    if(!(amount>=0))return res.status(400).json({error:"INVALID_DIRECT_EXPENSE_AMOUNT"});
    const info=db.prepare("INSERT INTO direct_expenses(category,description,amount,expense_date,receipt_url,created_by_user_id) VALUES(?,?,?,?,?,?)")
      .run(category,description,amount,date,text(req.body?.receipt_url,1200)||null,req.user.id);
    const row=db.prepare("SELECT * FROM direct_expenses WHERE id=?").get(Number(info.lastInsertRowid));audit(req,"CREATE","direct_expenses",String(row.id),null,row);res.status(201).json(row);
  });
  app.delete("/api/direct-expenses/:id",auth,financeAdmin,(req,res)=>{
    const id=integerId(req.params.id),row=id&&db.prepare("SELECT * FROM direct_expenses WHERE id=?").get(id);if(!row)return res.status(404).json({error:"DIRECT_EXPENSE_NOT_FOUND"});
    db.prepare("DELETE FROM direct_expenses WHERE id=?").run(id);audit(req,"DELETE","direct_expenses",String(id),row,null);res.json({ok:true});
  });

  app.get("/api/finance/overview",auth,financeReader,(req,res)=>{try{res.json(overview(req.query.month));}catch(error){respondError(res,error);}});
  app.get("/api/finance/summary",auth,financeReader,(req,res)=>{try{res.json(overview(req.query.month));}catch(error){respondError(res,error);}});
  app.get("/api/finance/ledger",auth,financeReader,(req,res)=>{
    const month=validMonth(req.query.month)?String(req.query.month):nyDate().slice(0,7),first=month+"-01",next=nextMonth(month)+"-01";
    const invoiceRows=db.prepare(`SELECT id,invoice_number,direction,issue_date entry_date,total_amount amount,counterparty_name,summary,status FROM invoices
      WHERE deleted_at IS NULL AND status<>'cancelled' AND issue_date>=? AND issue_date<? ORDER BY issue_date,id`).all(first,next)
      .map(row=>({...row,entry_type:"invoice",account:row.direction==="receivable"?"Accounts Receivable":"Accounts Payable"}));
    const expenseRows=db.prepare("SELECT id,expense_date entry_date,amount,category counterparty_name,description summary FROM direct_expenses WHERE expense_date>=? AND expense_date<? ORDER BY expense_date,id").all(first,next)
      .map(row=>({...row,entry_type:"direct_expense",account:"Direct Expense"}));
    res.json({month,entries:[...invoiceRows,...expenseRows].sort((a,b)=>String(a.entry_date).localeCompare(String(b.entry_date)))});
  });
  app.get("/api/finance/monthly-report.pdf",auth,financeReader,(req,res)=>{
    try{
      const month=validMonth(req.query.month)?String(req.query.month):nyDate().slice(0,7),stats=overview(month),info=company(),logoPath=resolveLogoPath(info.logo_url,uploadDir);
      const first=month+"-01",next=nextMonth(month)+"-01";
      const rows=db.prepare(`${selectInvoice} WHERE i.deleted_at IS NULL AND i.status<>'cancelled' AND i.issue_date>=? AND i.issue_date<? ORDER BY i.issue_date,i.invoice_number`).all(first,next);
      const carried=db.prepare(`${selectInvoice} WHERE i.deleted_at IS NULL AND i.direction='receivable' AND i.status IN ('draft','sent') AND i.issue_date<? ORDER BY i.due_date,i.invoice_number`).all(first);
      const pdf=generateMonthlyInvoiceReportPdf({
        company:info,month,summary:{revenue:stats.kpis.labor_revenue,costs:stats.kpis.material_direct_cost,net:stats.kpis.net_workshop_result},
        paymentBreakdown:[],carried,invoices:rows,logoPath
      });
      res.type("application/pdf").set("Content-Disposition",`attachment; filename="Klavierhaus-Finance-${month}.pdf"`).send(pdf);
    }catch(error){respondError(res,error);}
  });
}

module.exports={registerRound3FinanceRoutes,PAYMENT_METHODS,INVOICE_STATUSES};
