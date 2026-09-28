"use strict";

const fs=require("node:fs");
const path=require("node:path");
const {generateBusinessInvoicePdf,generateMonthlyInvoiceReportPdf}=require("./document-pdf");

const PAYMENT_METHODS=Object.freeze(["Cash","Check","Zelle","Bank Transfer / ACH","Credit Card"]);
const COMPANY_KEYS=Object.freeze(["trade_name","legal_name","address_line1","address_line2","city","state","postal_code","tax_id","email","phone"]);

function text(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function integerId(value){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null;}
function money(value){const number=Number(value);return Number.isFinite(number)?Math.round((number+Number.EPSILON)*100)/100:0;}
function problem(code,status=400,extra=null){const error=new Error(code);error.status=status;error.extra=extra;return error;}
function respondError(res,error){res.status(Number(error?.status||400)).json({error:error?.message||"ROUND3_REQUEST_FAILED",...(error?.extra||{})});}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||""))&&!Number.isNaN(new Date(String(value)+"T12:00:00Z").getTime());}
function nyDate(value=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value instanceof Date?value:new Date(value));
  const data=Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  return `${data.year}-${data.month}-${data.day}`;
}
function addDays(dateKey,days){
  const date=new Date(dateKey+"T12:00:00Z");date.setUTCDate(date.getUTCDate()+Number(days||0));return date.toISOString().slice(0,10);
}
function nextMonth(month){
  const date=new Date(month+"-01T12:00:00Z");date.setUTCMonth(date.getUTCMonth()+1);return date.toISOString().slice(0,7);
}
function validMonth(value){return /^\d{4}-\d{2}$/.test(String(value||""));}
function normalizeItems(items){
  if(!Array.isArray(items)||!items.length)throw problem("INVOICE_ITEMS_REQUIRED");
  return items.map((item,index)=>{
    const description=text(item?.item_description??item?.description,1000);
    const quantity=Number(item?.quantity??1),unitPrice=money(item?.unit_price??item?.unitPrice);
    if(!description)throw problem("INVOICE_ITEM_DESCRIPTION_REQUIRED");
    if(!Number.isFinite(quantity)||quantity<=0)throw problem("INVALID_INVOICE_ITEM_QUANTITY");
    if(!Number.isFinite(unitPrice)||unitPrice<0)throw problem("INVALID_INVOICE_ITEM_PRICE");
    return {item_description:description,quantity,money_unit_price:unitPrice,total_price:money(quantity*unitPrice),sort_order:index};
  });
}
function resolveLogoPath(logoUrl,uploadDir){
  const value=text(logoUrl,1000);
  if(value.startsWith("/uploads/")&&uploadDir){
    const candidate=path.join(uploadDir,path.basename(value));if(fs.existsSync(candidate))return candidate;
  }
  if(value.startsWith("/icons/")){
    const candidate=path.join(__dirname,"..","public",value.slice(1));if(fs.existsSync(candidate))return candidate;
  }
  const fallback=path.join(__dirname,"assets","klavierhaus-logo-black.jpg");
  return fs.existsSync(fallback)?fallback:null;
}

function registerRound3FinanceRoutes({app,db,auth,permit,requireSuperadmin,audit,uploadDir}){
  const financeReader=permit("ADMIN","MANAGER");
  const financeAdmin=permit("ADMIN");
  const selectInvoice=`SELECT i.*,c.name AS client_name,p.company_name AS partner_name,j.job_code,j.title AS job_title
    FROM invoices i
    LEFT JOIN clients c ON c.id=i.client_id
    LEFT JOIN partners p ON p.id=i.partner_id
    LEFT JOIN jobs j ON j.id=i.job_id`;

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
  function invoiceDetail(id){
    const row=db.prepare(`${selectInvoice} WHERE i.id=?`).get(id);
    if(!row)return null;
    return {...row,
      items:db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order,id").all(id),
      payments:db.prepare("SELECT * FROM invoice_payments WHERE invoice_id=? ORDER BY paid_at,id").all(id)
    };
  }
  function nextInvoiceNumber(direction,issueDate){
    const year=Number(String(issueDate).slice(0,4));
    db.prepare("INSERT OR IGNORE INTO invoice_sequences(direction,sequence_year,last_value) VALUES(?,?,0)").run(direction,year);
    db.prepare("UPDATE invoice_sequences SET last_value=last_value+1 WHERE direction=? AND sequence_year=?").run(direction,year);
    const n=db.prepare("SELECT last_value FROM invoice_sequences WHERE direction=? AND sequence_year=?").get(direction,year)?.last_value;
    return `${direction==="payable"?"VND":"INV"}-${year}-${String(n).padStart(4,"0")}`;
  }
  function partnerById(id){return id&&db.prepare("SELECT * FROM partners WHERE id=?").get(id);}
  function clientById(id){return id&&db.prepare("SELECT * FROM clients WHERE id=?").get(id);}
  function normalizePaymentMethod(value,{optional=false}={}){
    const method=text(value,80);
    if(!method&&optional)return null;
    if(!PAYMENT_METHODS.includes(method))throw problem("INVALID_PAYMENT_METHOD");
    return method;
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
    const insert=db.prepare("INSERT INTO partner_contractors(partner_id,user_id) VALUES(?,?)");
    ids.forEach(userId=>insert.run(partnerId,userId));
  }
  function insertInvoice(input,actor){
    const direction=text(input?.direction,20).toLowerCase();
    if(!["receivable","payable"].includes(direction))throw problem("INVALID_INVOICE_DIRECTION");
    const clientId=direction==="receivable"?integerId(input?.client_id):null;
    const partnerId=direction==="payable"?integerId(input?.partner_id):null;
    const counterparty=direction==="receivable"?clientById(clientId):partnerById(partnerId);
    if(!counterparty)throw problem(direction==="receivable"?"INVALID_CLIENT_ID":"INVALID_PARTNER_ID");
    if(direction==="payable"&&counterparty.status!=="active")throw problem("PARTNER_INACTIVE",409);
    const items=normalizeItems(input?.items);
    const issueDate=validDate(input?.issue_date)?String(input.issue_date):nyDate();
    const dueDate=validDate(input?.due_date)?String(input.due_date):addDays(issueDate,30);
    if(dueDate<issueDate)throw problem("INVALID_INVOICE_DUE_DATE");
    const taxRate=Number(input?.tax_rate??0);
    if(!Number.isFinite(taxRate)||taxRate<0||taxRate>100)throw problem("INVALID_TAX_RATE");
    const subtotal=money(items.reduce((sum,item)=>sum+item.total_price,0));
    const taxAmount=money(subtotal*taxRate/100),total=money(subtotal+taxAmount);
    const summary=text(input?.summary,1000)||text(input?.job_title,1000)||"Klavierhaus service";
    const preferred=normalizePaymentMethod(input?.payment_method,{optional:true});
    const number=nextInvoiceNumber(direction,issueDate);
    const jobId=integerId(input?.job_id);
    const info=db.prepare(`INSERT INTO invoices(
      invoice_number,direction,status,source_type,source_id,job_id,client_id,partner_id,
      counterparty_name,counterparty_contact,counterparty_email,counterparty_phone,counterparty_address,counterparty_tax_id,
      summary,notes,issue_date,due_date,currency,tax_rate,subtotal,tax_amount,total_amount,paid_amount,balance_due,payment_method,created_by_user_id
    ) VALUES(?,?,'issued',?,?,?,?,?,?,?,?,?,?,?,?,?,? ,?,'USD',?,?,?,?,0,?,?,?)`).run(
      number,direction,text(input?.source_type||"manual",20),text(input?.source_id,160)||null,jobId,clientId,partnerId,
      direction==="receivable"?counterparty.name:counterparty.company_name,
      direction==="receivable"?null:text(counterparty.contact_name,240)||null,
      text(counterparty.email,320)||null,text(counterparty.phone,120)||null,
      text(counterparty.address,1000)||null,direction==="payable"?text(counterparty.tax_id,160)||null:null,
      summary,text(input?.notes,5000)||null,issueDate,dueDate,taxRate,subtotal,taxAmount,total,total,preferred,actor?.id||null
    );
    const invoiceId=Number(info.lastInsertRowid);
    const insertItem=db.prepare("INSERT INTO invoice_items(invoice_id,item_description,quantity,unit_price,total_price,sort_order) VALUES(?,?,?,?,?,?)");
    items.forEach(item=>insertItem.run(invoiceId,item.item_description,item.quantity,item.money_unit_price,item.total_price,item.sort_order));
    return invoiceDetail(invoiceId);
  }
  function refreshInvoiceSettlement(id){
    const invoice=invoiceDetail(id);if(!invoice)throw problem("INVOICE_NOT_FOUND",404);
    const paid=money(invoice.payments.reduce((sum,payment)=>sum+Number(payment.amount||0),0));
    const balance=Math.max(0,money(Number(invoice.total_amount||0)-paid));
    const status=invoice.status==="void"?"void":balance<=0.009?"paid":paid>0?"partial":"issued";
    const paidAt=status==="paid"?(invoice.payments.at(-1)?.paid_at||nyDate()):null;
    db.prepare("UPDATE invoices SET paid_amount=?,balance_due=?,status=?,paid_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(paid,balance,status,paidAt,id);
    return invoiceDetail(id);
  }
  function summary(monthValue){
    const month=validMonth(monthValue)?String(monthValue):nyDate().slice(0,7),first=month+"-01",next=nextMonth(month)+"-01";
    const balances=db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN direction='receivable' AND status<>'void' THEN balance_due ELSE 0 END),0) ar,
      COALESCE(SUM(CASE WHEN direction='payable' AND status<>'void' THEN balance_due ELSE 0 END),0) ap
      FROM invoices`).get();
    const realized=db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN i.direction='receivable' THEN p.amount ELSE 0 END),0) revenue,
      COALESCE(SUM(CASE WHEN i.direction='payable' THEN p.amount ELSE 0 END),0) costs
      FROM invoice_payments p JOIN invoices i ON i.id=p.invoice_id
      WHERE i.status<>'void' AND p.paid_at>=? AND p.paid_at<?`).get(first,next);
    const paymentBreakdown=db.prepare(`SELECT p.payment_method,ROUND(SUM(p.amount),2) amount
      FROM invoice_payments p JOIN invoices i ON i.id=p.invoice_id
      WHERE i.status<>'void' AND p.paid_at>=? AND p.paid_at<?
      GROUP BY p.payment_method ORDER BY p.payment_method`).all(first,next);
    return {month,kpis:{accounts_receivable:money(balances.ar),accounts_payable:money(balances.ap),realized_revenue:money(realized.revenue),paid_costs:money(realized.costs),net_cash_result:money(Number(realized.revenue||0)-Number(realized.costs||0))},payment_breakdown:paymentBreakdown};
  }
  function monthlyRows(month){
    const first=month+"-01",next=nextMonth(month)+"-01";
    const invoices=db.prepare(`${selectInvoice} WHERE i.status<>'void' AND i.issue_date>=? AND i.issue_date<? ORDER BY i.issue_date,i.invoice_number`).all(first,next)
      .map(row=>({...row,counterparty_name:row.counterparty_name||row.client_name||row.partner_name}));
    const carried=db.prepare(`${selectInvoice} WHERE i.status<>'void' AND i.issue_date<? AND i.balance_due>0.009 ORDER BY i.due_date,i.invoice_number`).all(first)
      .map(row=>({...row,total_amount:row.balance_due,counterparty_name:row.counterparty_name||row.client_name||row.partner_name}));
    return {invoices,carried};
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
        db.prepare(`UPDATE partners SET company_name=?,contact_name=?,email=?,phone=?,address=?,tax_id=?,notes=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
          name,text(req.body?.contact_name??before.contact_name,240)||null,text(req.body?.email??before.email,320)||null,text(req.body?.phone??before.phone,120)||null,
          text(req.body?.address??before.address,1000)||null,text(req.body?.tax_id??before.tax_id,160)||null,text(req.body?.notes??before.notes,5000)||null,status,id
        );
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
      if(status&&!["issued","partial","paid","void"].includes(status))throw problem("INVALID_INVOICE_STATUS");
      const rows=db.prepare(`${selectInvoice} WHERE (?='' OR i.direction=?) AND (?='' OR i.status=?)
        AND (?='' OR lower(i.invoice_number) LIKE ? OR lower(i.counterparty_name) LIKE ? OR lower(i.summary) LIKE ? OR lower(COALESCE(j.job_code,'')) LIKE ?)
        ORDER BY i.issue_date DESC,i.id DESC`).all(direction,direction,status,status,q,like,like,like,like);
      res.json(rows);
    }catch(error){respondError(res,error);}
  });
  app.get("/api/invoices/:id",auth,financeReader,(req,res)=>{
    const row=invoiceDetail(integerId(req.params.id));if(!row)return res.status(404).json({error:"INVOICE_NOT_FOUND"});res.json(row);
  });
  app.post("/api/invoices",auth,financeReader,(req,res)=>{
    try{
      const result=db.transaction(()=>insertInvoice({...req.body,source_type:"manual"},req.user))();
      audit(req,"CREATE","invoices",String(result.id),null,result);res.status(201).json(result);
    }catch(error){respondError(res,error);}
  });

  app.post("/api/jobs/:id/closeout",auth,financeReader,(req,res)=>{
    const id=integerId(req.params.id);
    const job=id&&db.prepare(`SELECT j.*,c.name client_name,c.email client_email,c.phone client_phone,c.address client_address,
      p.brand piano_brand,p.model piano_model,p.serial_number piano_serial_number
      FROM jobs j JOIN clients c ON c.id=j.client_id JOIN pianos p ON p.id=j.piano_id WHERE j.id=?`).get(id);
    if(!job)return res.status(404).json({error:"JOB_NOT_FOUND"});
    const existing=db.prepare("SELECT id FROM invoices WHERE job_id=? AND status<>'void' ORDER BY id DESC LIMIT 1").get(id);
    if(job.closed_at&&existing)return res.json({ok:true,idempotent:true,job:db.prepare("SELECT * FROM jobs WHERE id=?").get(id),invoice:invoiceDetail(existing.id)});
    if(job.status!=="ready_for_closeout")return res.status(409).json({error:"JOB_NOT_READY_FOR_CLOSEOUT"});
    try{
      const result=db.transaction(()=>{
        const invoice=insertInvoice({
          ...req.body,direction:"receivable",client_id:job.client_id,job_id:job.id,source_type:"job",source_id:String(job.id),
          summary:text(req.body?.summary,1000)||`${job.job_code||"Job"} · ${job.title}`,job_title:job.title
        },req.user);
        db.prepare("UPDATE jobs SET closed_at=CURRENT_TIMESTAMP,closed_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,id);
        db.prepare("UPDATE pianos SET last_serviced_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nyDate(),job.piano_id);
        return {job:db.prepare("SELECT * FROM jobs WHERE id=?").get(id),invoice};
      })();
      audit(req,"CLOSEOUT","jobs",String(id),job,{closed_at:result.job.closed_at,invoice_id:result.invoice.id});
      res.status(201).json({ok:true,idempotent:false,...result});
    }catch(error){respondError(res,error);}
  });

  app.post("/api/invoices/:id/payments",auth,financeReader,(req,res)=>{
    const id=integerId(req.params.id),before=invoiceDetail(id);if(!before)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    try{
      if(before.status==="void")throw problem("INVOICE_VOID");
      if(before.status==="paid"||Number(before.balance_due||0)<=0.009)throw problem("INVOICE_ALREADY_PAID",409);
      const amount=money(req.body?.amount),method=normalizePaymentMethod(req.body?.payment_method);
      if(!(amount>0))throw problem("INVALID_PAYMENT_AMOUNT");
      if(amount>Number(before.balance_due||0)+0.009)throw problem("PAYMENT_EXCEEDS_BALANCE",409,{balance_due:before.balance_due});
      const paidAt=validDate(req.body?.paid_at)?String(req.body.paid_at):nyDate();
      const result=db.transaction(()=>{
        db.prepare("INSERT INTO invoice_payments(invoice_id,amount,payment_method,reference,paid_at,notes,created_by_user_id) VALUES(?,?,?,?,?,?,?)")
          .run(id,amount,method,text(req.body?.reference,240)||null,paidAt,text(req.body?.notes,2000)||null,req.user.id);
        return refreshInvoiceSettlement(id);
      })();
      audit(req,"PAYMENT","invoices",String(id),before,result);res.status(201).json(result);
    }catch(error){respondError(res,error);}
  });

  app.post("/api/invoices/:id/void",auth,financeAdmin,(req,res)=>{
    const id=integerId(req.params.id),before=invoiceDetail(id);if(!before)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    try{
      if(before.status==="void")return res.json({ok:true,idempotent:true,invoice:before});
      if(before.payments.length)throw problem("INVOICE_HAS_PAYMENTS",409);
      const reason=text(req.body?.reason,2000);if(!reason)throw problem("VOID_REASON_REQUIRED");
      const result=db.transaction(()=>{
        if(before.job_id)db.prepare("UPDATE jobs SET closed_at=NULL,closed_by_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(before.job_id);
        db.prepare(`UPDATE invoices SET status='void',balance_due=0,voided_at=CURRENT_TIMESTAMP,voided_by_user_id=?,void_reason=?,job_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(req.user.id,reason,id);
        return invoiceDetail(id);
      })();
      audit(req,"VOID","invoices",String(id),before,result);res.json({ok:true,idempotent:false,invoice:result});
    }catch(error){respondError(res,error);}
  });

  app.delete("/api/invoices/:id",auth,requireSuperadmin,(req,res)=>{
    const id=integerId(req.params.id),before=invoiceDetail(id);if(!before)return res.status(404).json({error:"INVOICE_NOT_FOUND"});
    db.transaction(()=>{
      if(before.job_id)db.prepare("UPDATE jobs SET closed_at=NULL,closed_by_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(before.job_id);
      db.prepare("DELETE FROM invoices WHERE id=?").run(id);
    })();
    audit(req,"HARD_DELETE","invoices",String(id),before,null);res.json({ok:true});
  });

  app.get("/api/invoices/:id/pdf",auth,financeReader,(req,res)=>{
    try{
      const invoice=invoiceDetail(integerId(req.params.id));if(!invoice)throw problem("INVOICE_NOT_FOUND",404);
      const info=company(),logoPath=resolveLogoPath(info.logo_url,uploadDir);
      const pdf=generateBusinessInvoicePdf({company:info,invoice,items:invoice.items,counterpartyName:invoice.counterparty_name,logoPath});
      res.type("application/pdf").set("Content-Disposition",`attachment; filename="${invoice.invoice_number}.pdf"`).send(pdf);
    }catch(error){respondError(res,error);}
  });

  app.get("/api/finance/summary",auth,financeReader,(req,res)=>{
    try{res.json(summary(req.query.month));}catch(error){respondError(res,error);}
  });
  app.get("/api/finance/ledger",auth,financeReader,(req,res)=>{
    try{
      const month=validMonth(req.query.month)?String(req.query.month):nyDate().slice(0,7),first=month+"-01",next=nextMonth(month)+"-01";
      const invoices=db.prepare(`SELECT id,invoice_number,direction,issue_date entry_date,total_amount amount,counterparty_name,summary,status
        FROM invoices WHERE status<>'void' AND issue_date>=? AND issue_date<? ORDER BY issue_date,id`).all(first,next)
        .map(row=>({...row,entry_type:"invoice",account:row.direction==="receivable"?"Accounts Receivable":"Accounts Payable"}));
      const payments=db.prepare(`SELECT p.id,p.invoice_id,i.invoice_number,i.direction,p.paid_at entry_date,p.amount,p.payment_method,i.counterparty_name,i.summary
        FROM invoice_payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.status<>'void' AND p.paid_at>=? AND p.paid_at<? ORDER BY p.paid_at,p.id`).all(first,next)
        .map(row=>({...row,entry_type:"payment",account:row.direction==="receivable"?"Cash Receipt":"Cash Payment"}));
      res.json({month,entries:[...invoices,...payments].sort((a,b)=>String(a.entry_date).localeCompare(String(b.entry_date)))});
    }catch(error){respondError(res,error);}
  });
  app.get("/api/finance/monthly-report.pdf",auth,financeReader,(req,res)=>{
    try{
      const month=validMonth(req.query.month)?String(req.query.month):nyDate().slice(0,7);
      const stats=summary(month),rows=monthlyRows(month),info=company(),logoPath=resolveLogoPath(info.logo_url,uploadDir);
      const pdf=generateMonthlyInvoiceReportPdf({
        company:info,month,
        summary:{revenue:stats.kpis.realized_revenue,costs:stats.kpis.paid_costs,net:stats.kpis.net_cash_result},
        paymentBreakdown:stats.payment_breakdown,carried:rows.carried,invoices:rows.invoices,logoPath
      });
      res.type("application/pdf").set("Content-Disposition",`attachment; filename="Klavierhaus-Finance-${month}.pdf"`).send(pdf);
    }catch(error){respondError(res,error);}
  });
}

module.exports={registerRound3FinanceRoutes,PAYMENT_METHODS};
