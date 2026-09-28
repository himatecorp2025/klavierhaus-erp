"use strict";

const R3_PAYMENT_METHODS=["Cash","Check","Zelle","Bank Transfer / ACH","Credit Card"];

function r3Money(value){
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(Number(value||0));
}
function r3StatusLabel(status){
  return status==="issued"?"Nyitott":status==="partial"?"Részben fizetett":status==="paid"?"Fizetett":status==="void"?"Void":status||"";
}
function r3DirectionLabel(direction){return direction==="payable"?"Bejövő / Vendor bill":"Kimenő / Receivable";}
function r3CurrentMonth(){return r2Today().slice(0,7);}
function r3PaymentOptions(selected=""){
  return R3_PAYMENT_METHODS.map(method=>"<option value='"+esc(method)+"' "+(method===selected?"selected":"")+">"+esc(method)+"</option>").join("");
}
function r3LineMarkup(index,{description="",quantity=1,unit_price=""}={}){
  return "<div class='invoice-line' data-invoice-line='"+index+"'>"+
    "<label class='field invoice-line-description'><span>Tétel *</span><input data-line-description value='"+esc(description)+"' required></label>"+
    "<label class='field'><span>Mennyiség</span><input data-line-quantity type='number' min='0.01' step='0.01' value='"+esc(quantity)+"' required></label>"+
    "<label class='field'><span>Egységár (USD)</span><input data-line-price type='number' min='0' step='0.01' value='"+esc(unit_price)+"' required></label>"+
    "<button class='icon-button invoice-line-remove' type='button' data-remove-line aria-label='Tétel törlése'>×</button>"+
  "</div>";
}
function r3BindLineEditor(root){
  const host=$("[data-lines-host]",root);
  if(!host)return;
  $("[data-add-line]",root)?.addEventListener("click",()=>{
    const index=Date.now();
    host.insertAdjacentHTML("beforeend",r3LineMarkup(index));
    r3BindLineRemove(host);
  });
  r3BindLineRemove(host);
}
function r3BindLineRemove(host){
  $$("[data-remove-line]",host).forEach(button=>{
    if(button.dataset.bound)return;
    button.dataset.bound="1";
    button.addEventListener("click",()=>{
      if($$("[data-invoice-line]",host).length<=1){toast("Legalább egy számlatétel szükséges.","error");return;}
      button.closest("[data-invoice-line]")?.remove();
    });
  });
}
function r3CollectItems(root=document){
  return $$("[data-invoice-line]",root).map(line=>({
    item_description:$("[data-line-description]",line)?.value||"",
    quantity:Number($("[data-line-quantity]",line)?.value||0),
    unit_price:Number($("[data-line-price]",line)?.value||0)
  }));
}
async function r3DownloadPdf(url,filename){
  try{
    const response=await fetch(url,{headers:{Accept:"application/pdf",Authorization:"Bearer "+state.token},cache:"no-store"});
    if(!response.ok){
      const type=response.headers.get("content-type")||"";
      const payload=type.includes("application/json")?await response.json().catch(()=>({})):await response.text();
      throw new Error(payload?.error||("HTTP_"+response.status));
    }
    const blob=await response.blob(),objectUrl=URL.createObjectURL(blob);
    const link=document.createElement("a");link.href=objectUrl;link.download=filename||"Klavierhaus.pdf";document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),5000);
  }catch(error){toast(humanError(error),"error");}
}

async function r3OpenCloseout(job,refresh=renderWorkshop){
  if(!job)return;
  const due=r2DateAdd(r2Today(),30);
  openDialog({title:"Munkalap zárása",eyebrow:job.job_code||"JOB CLOSEOUT",body:
    "<form id='closeoutForm' class='form-grid'>"+
      "<div class='detail-note full'><strong>"+esc(job.title)+"</strong><br>"+esc(job.client_name+" · "+[job.piano_brand,job.piano_model].filter(Boolean).join(" "))+"<br><span class='muted'>A zárás kiállítja a kimenő számlát és leveszi a munkát az aktív workflow-ról.</span></div>"+
      "<label class='field full'><span>Számla összefoglaló</span><input name='summary' value='"+esc((job.job_code||"Munka")+" · "+job.title)+"'></label>"+
      "<div class='invoice-lines full' data-lines-host>"+r3LineMarkup(1,{description:job.title,quantity:1,unit_price:""})+"</div>"+
      "<button class='secondary-button full' type='button' data-add-line>＋ Tétel hozzáadása</button>"+
      "<label class='field'><span>Adókulcs (%)</span><input name='tax_rate' type='number' min='0' max='100' step='0.01' value='0'></label>"+
      "<label class='field'><span>Fizetési határidő</span><input name='due_date' type='date' value='"+due+"' required></label>"+
      "<label class='field full'><span>Preferált fizetési mód</span><select name='payment_method'><option value=''>Nincs megadva</option>"+r3PaymentOptions()+"</select></label>"+
      "<label class='field full'><span>Számlamegjegyzés</span><textarea name='notes'></textarea></label>"+
      "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>Mégse</button><button class='primary-button' type='submit'>Zárás és számla kiállítása</button></div>"+
    "</form>"
  });
  const form=$("#closeoutForm");r3BindLineEditor(form);
  $("[data-close-dialog]",form).addEventListener("click",closeDialog);
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const fields=Object.fromEntries(new FormData(form));
    const body={summary:fields.summary,items:r3CollectItems(form),tax_rate:Number(fields.tax_rate||0),due_date:fields.due_date,notes:fields.notes};
    if(fields.payment_method)body.payment_method=fields.payment_method;
    try{
      const result=await api("/api/jobs/"+job.id+"/closeout",{method:"POST",body:JSON.stringify(body)});
      closeDialog();toast((result.idempotent?"Már lezárt munkalap: ":"Munkalap lezárva · ")+(result.invoice?.invoice_number||""),"success");
      await refresh();
    }catch(error){toast(humanError(error),"error");}
  });
}

function r3InvoiceRow(invoice){
  const open=invoice.status==="issued"||invoice.status==="partial";
  const admin=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  const superadmin=state.user?.role==="SUPERADMIN";
  return "<article class='invoice-row status-"+esc(invoice.status)+"' data-invoice-row='"+invoice.id+"'>"+
    "<div class='invoice-row-main'><div class='invoice-number-line'><strong>"+esc(invoice.invoice_number)+"</strong><span class='invoice-status "+esc(invoice.status)+"'>"+esc(r3StatusLabel(invoice.status))+"</span></div>"+
    "<h3>"+esc(invoice.counterparty_name||invoice.client_name||invoice.partner_name||"—")+"</h3>"+
    "<p>"+esc(invoice.summary||"")+"</p><div class='invoice-row-meta'><span>Keltezés: "+esc(invoice.issue_date)+"</span><span>Határidő: "+esc(invoice.due_date)+"</span>"+(invoice.job_code?"<span>"+esc(invoice.job_code)+"</span>":"")+"</div></div>"+
    "<div class='invoice-amounts'><strong>"+r3Money(invoice.total_amount)+"</strong><small>Nyitott: "+r3Money(invoice.balance_due)+"</small></div>"+
    "<div class='invoice-row-actions'><button class='text-button' type='button' data-view-invoice='"+invoice.id+"'>Részletek</button><button class='secondary-button' type='button' data-pdf-invoice='"+invoice.id+"'>PDF</button>"+
    (open?"<button class='primary-button' type='button' data-pay-invoice='"+invoice.id+"'>Fizetés</button>":"")+
    (admin&&invoice.status!=="void"?"<button class='danger-button' type='button' data-void-invoice='"+invoice.id+"'>Void</button>":"")+
    (superadmin?"<button class='danger-button' type='button' data-delete-invoice='"+invoice.id+"'>Törlés</button>":"")+
    "</div></article>";
}
function r3BindInvoiceActions(root,invoices,refresh=renderFinance){
  $$("[data-view-invoice]",root).forEach(button=>button.addEventListener("click",()=>r3OpenInvoice(Number(button.dataset.viewInvoice),refresh)));
  $$("[data-pdf-invoice]",root).forEach(button=>button.addEventListener("click",()=>{
    const invoice=invoices.find(row=>Number(row.id)===Number(button.dataset.pdfInvoice));
    r3DownloadPdf("/api/invoices/"+button.dataset.pdfInvoice+"/pdf",(invoice?.invoice_number||"Invoice")+".pdf");
  }));
  $$("[data-pay-invoice]",root).forEach(button=>button.addEventListener("click",async()=>{
    const invoice=await api("/api/invoices/"+button.dataset.payInvoice);r3OpenPayment(invoice,refresh);
  }));
  $$("[data-void-invoice]",root).forEach(button=>button.addEventListener("click",async()=>{
    const invoice=await api("/api/invoices/"+button.dataset.voidInvoice);r3OpenVoid(invoice,refresh);
  }));
  $$("[data-delete-invoice]",root).forEach(button=>button.addEventListener("click",async()=>{
    const invoice=await api("/api/invoices/"+button.dataset.deleteInvoice);r3OpenHardDelete(invoice,refresh);
  }));
}
async function r3OpenInvoice(id,refresh=renderFinance){
  const invoice=await api("/api/invoices/"+id);
  openDialog({title:invoice.invoice_number,eyebrow:r3DirectionLabel(invoice.direction),body:
    "<div class='invoice-detail-head'><div><h3>"+esc(invoice.counterparty_name)+"</h3><p class='muted'>"+esc(invoice.summary||"")+"</p></div><span class='invoice-status "+esc(invoice.status)+"'>"+esc(r3StatusLabel(invoice.status))+"</span></div>"+
    "<div class='invoice-detail-kpis'><div><small>Összesen</small><strong>"+r3Money(invoice.total_amount)+"</strong></div><div><small>Fizetve</small><strong>"+r3Money(invoice.paid_amount)+"</strong></div><div><small>Nyitott</small><strong>"+r3Money(invoice.balance_due)+"</strong></div></div>"+
    "<div class='invoice-detail-grid'><div><span>Keltezés</span><strong>"+esc(invoice.issue_date)+"</strong></div><div><span>Határidő</span><strong>"+esc(invoice.due_date)+"</strong></div><div><span>Adó</span><strong>"+esc(Number(invoice.tax_rate||0).toFixed(2))+"%</strong></div><div><span>Forrás</span><strong>"+esc(invoice.job_code||invoice.source_type)+"</strong></div></div>"+
    "<div class='panel-head invoice-detail-section'><h3>Tételek</h3></div><div class='invoice-item-list'>"+invoice.items.map(item=>"<div><span>"+esc(item.item_description)+" · "+esc(item.quantity)+" × "+r3Money(item.unit_price)+"</span><strong>"+r3Money(item.total_price)+"</strong></div>").join("")+"</div>"+
    "<div class='panel-head invoice-detail-section'><h3>Fizetések</h3><span class='badge'>"+invoice.payments.length+" db</span></div><div class='invoice-item-list'>"+(invoice.payments.length?invoice.payments.map(payment=>"<div><span>"+esc(payment.paid_at)+" · "+esc(payment.payment_method)+(payment.reference?" · "+esc(payment.reference):"")+"</span><strong>"+r3Money(payment.amount)+"</strong></div>").join(""):"<div class='muted'>Még nincs fizetés.</div>")+"</div>"+
    (invoice.notes?"<div class='detail-note'>"+esc(invoice.notes)+"</div>":"")+
    "<div class='form-actions'><button class='secondary-button' type='button' id='invoiceDetailPdf'>PDF letöltése</button>"+((invoice.status==="issued"||invoice.status==="partial")?"<button class='primary-button' type='button' id='invoiceDetailPay'>Fizetés rögzítése</button>":"")+"</div>"
  });
  $("#invoiceDetailPdf").addEventListener("click",()=>r3DownloadPdf("/api/invoices/"+invoice.id+"/pdf",invoice.invoice_number+".pdf"));
  $("#invoiceDetailPay")?.addEventListener("click",()=>{closeDialog();r3OpenPayment(invoice,refresh);});
}
function r3OpenPayment(invoice,refresh=renderFinance){
  openDialog({title:"Fizetés rögzítése",eyebrow:invoice.invoice_number,body:
    "<form id='paymentForm' class='form-grid'><div class='detail-note full'>Nyitott egyenleg: <strong>"+r3Money(invoice.balance_due)+"</strong></div>"+
      "<label class='field'><span>Összeg (USD) *</span><input name='amount' type='number' min='0.01' max='"+esc(invoice.balance_due)+"' step='0.01' value='"+esc(invoice.balance_due)+"' required autofocus></label>"+
      "<label class='field'><span>Dátum *</span><input name='paid_at' type='date' value='"+r2Today()+"' required></label>"+
      "<label class='field full'><span>Fizetési mód *</span><select name='payment_method' required>"+r3PaymentOptions(invoice.payment_method||"")+"</select></label>"+
      "<label class='field'><span>Referencia</span><input name='reference'></label><label class='field'><span>Megjegyzés</span><input name='notes'></label>"+
      "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>Mégse</button><button class='primary-button' type='submit'>Fizetés mentése</button></div></form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#paymentForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.amount=Number(body.amount);
    try{await api("/api/invoices/"+invoice.id+"/payments",{method:"POST",body:JSON.stringify(body)});closeDialog();toast("Fizetés rögzítve.","success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r3OpenVoid(invoice,refresh=renderFinance){
  openDialog({title:"Számla voidolása",eyebrow:invoice.invoice_number,body:
    "<form id='voidForm' class='form-grid'><div class='detail-note full'>A void nem törli az auditnyomot. Jobból származó számlánál a munkalap újra Lezárásra vár állapotba kerül.</div>"+
    "<label class='field full'><span>Void oka *</span><textarea name='reason' required autofocus></textarea></label>"+
    "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>Mégse</button><button class='danger-button' type='submit'>Voidolás</button></div></form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#voidForm").addEventListener("submit",async event=>{
    event.preventDefault();
    try{await api("/api/invoices/"+invoice.id+"/void",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast("Számla voidolva.","success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r3OpenHardDelete(invoice,refresh=renderFinance){
  openDialog({title:"Végleges törlés",eyebrow:"SUPER ADMIN",body:
    "<div class='detail-note'>A <strong>"+esc(invoice.invoice_number)+"</strong> számla és minden fizetési/tétel rekordja végleg törlődik. Ez csak Super Admin művelet.</div>"+
    "<div class='form-actions'><button type='button' class='secondary-button' data-close-dialog>Mégse</button><button type='button' class='danger-button' id='hardDeleteInvoice'>Végleges törlés</button></div>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#hardDeleteInvoice").addEventListener("click",async()=>{
    try{await api("/api/invoices/"+invoice.id,{method:"DELETE"});closeDialog();toast("Számla végleg törölve.","success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}

async function r3OpenManualInvoice(refresh=renderFinance){
  const [clients,partners]=await Promise.all([loadClients(),api("/api/partners")]);
  openDialog({title:"Új számla / vendor bill",eyebrow:"INVOICE DISPATCHER",body:
    "<form id='manualInvoiceForm' class='form-grid'>"+
      "<label class='field full'><span>Irány *</span><select id='manualDirection' name='direction'><option value='receivable'>Kimenő / Receivable</option><option value='payable'>Bejövő / Vendor bill</option></select></label>"+
      "<label class='field full' id='manualClientField'><span>Ügyfél *</span><select name='client_id'><option value=''>Válassz ügyfelet</option>"+clients.map(client=>"<option value='"+client.id+"'>"+esc(client.name)+"</option>").join("")+"</select></label>"+
      "<label class='field full hidden' id='manualPartnerField'><span>Partner *</span><select name='partner_id'><option value=''>Válassz partnert</option>"+partners.filter(partner=>partner.status==="active").map(partner=>"<option value='"+partner.id+"'>"+esc(partner.company_name)+"</option>").join("")+"</select></label>"+
      "<label class='field full'><span>Összefoglaló *</span><input name='summary' required></label>"+
      "<div class='invoice-lines full' data-lines-host>"+r3LineMarkup(1)+"</div><button class='secondary-button full' type='button' data-add-line>＋ Tétel hozzáadása</button>"+
      "<label class='field'><span>Keltezés</span><input name='issue_date' type='date' value='"+r2Today()+"' required></label>"+
      "<label class='field'><span>Határidő</span><input name='due_date' type='date' value='"+r2DateAdd(r2Today(),30)+"' required></label>"+
      "<label class='field'><span>Adókulcs (%)</span><input name='tax_rate' type='number' min='0' max='100' step='0.01' value='0'></label>"+
      "<label class='field'><span>Preferált fizetési mód</span><select name='payment_method'><option value=''>Nincs megadva</option>"+r3PaymentOptions()+"</select></label>"+
      "<label class='field full'><span>Megjegyzés</span><textarea name='notes'></textarea></label>"+
      "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>Mégse</button><button class='primary-button' type='submit'>Számla létrehozása</button></div>"+
    "</form>"
  });
  const form=$("#manualInvoiceForm");r3BindLineEditor(form);
  $("[data-close-dialog]",form).addEventListener("click",closeDialog);
  $("#manualDirection").addEventListener("change",event=>{
    const payable=event.target.value==="payable";$("#manualClientField").classList.toggle("hidden",payable);$("#manualPartnerField").classList.toggle("hidden",!payable);
  });
  form.addEventListener("submit",async event=>{
    event.preventDefault();const data=Object.fromEntries(new FormData(form));
    const body={direction:data.direction,summary:data.summary,issue_date:data.issue_date,due_date:data.due_date,tax_rate:Number(data.tax_rate||0),notes:data.notes,items:r3CollectItems(form)};
    if(data.payment_method)body.payment_method=data.payment_method;
    if(data.direction==="payable")body.partner_id=Number(data.partner_id);else body.client_id=Number(data.client_id);
    try{const invoice=await api("/api/invoices",{method:"POST",body:JSON.stringify(body)});closeDialog();toast(invoice.invoice_number+" létrehozva.","success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}

async function r3OpenPartnerManager(refresh=renderFinance){
  const [partners,users]=await Promise.all([api("/api/partners"),loadUsers()]);
  const options=users.filter(user=>["WORKER","MANAGER","ADMIN"].includes(user.role)).map(user=>"<option value='"+esc(user.id)+"'>"+esc(user.name)+" · "+esc(roleLabel(user.role))+"</option>").join("");
  openDialog({title:"Partnerek",eyebrow:"VENDOR MASTER DATA",body:
    "<div class='partner-manager'><div class='partner-manager-list'><button id='newPartnerEditor' class='primary-button' type='button'>＋ Új partner</button>"+
    (partners.length?partners.map(partner=>"<article class='partner-manager-row'><div><strong>"+esc(partner.company_name)+"</strong><small>"+esc(partner.email||partner.phone||partner.status)+"</small></div><div><button class='text-button' type='button' data-edit-partner='"+partner.id+"'>Szerkesztés</button><button class='text-button danger-text' type='button' data-delete-partner='"+partner.id+"'>Törlés</button></div></article>").join(""):"<div class='empty-state'>Nincs partner.</div>")+
    "</div><div id='partnerEditorHost' class='partner-editor-host'><div class='empty-state'>Válassz partnert vagy hozz létre újat.</div></div></div>"
  });
  const host=$("#partnerEditorHost");
  async function editor(partner=null){
    let details=partner;
    if(partner?.id)details=await api("/api/partners/"+partner.id);
    const selected=new Set(details?.contractor_user_ids||[]);
    host.innerHTML="<form id='partnerForm' class='form-grid'>"+
      "<label class='field full'><span>Cégnév *</span><input name='company_name' value='"+esc(details?.company_name||"")+"' required autofocus></label>"+
      "<label class='field'><span>Kapcsolattartó</span><input name='contact_name' value='"+esc(details?.contact_name||"")+"'></label><label class='field'><span>Tax ID</span><input name='tax_id' value='"+esc(details?.tax_id||"")+"'></label>"+
      "<label class='field'><span>E-mail</span><input name='email' type='email' value='"+esc(details?.email||"")+"'></label><label class='field'><span>Telefon</span><input name='phone' value='"+esc(details?.phone||"")+"'></label>"+
      "<label class='field full'><span>Cím</span><input name='address' value='"+esc(details?.address||"")+"'></label>"+
      "<label class='field'><span>Státusz</span><select name='status'><option value='active' "+(details?.status!=="inactive"?"selected":"")+">Aktív</option><option value='inactive' "+(details?.status==="inactive"?"selected":"")+">Inaktív</option></select></label>"+
      "<label class='field'><span>Kapcsolt technikus(ok)</span><select name='contractor_user_ids' multiple size='4'>"+options.replace(/value='([^']+)'/g,(match,id)=>match+(selected.has(id)?" selected":""))+"</select></label>"+
      "<label class='field full'><span>Megjegyzés</span><textarea name='notes'>"+esc(details?.notes||"")+"</textarea></label>"+
      "<div class='form-actions full'><button class='primary-button' type='submit'>Mentés</button></div></form>";
    $("#partnerForm").addEventListener("submit",async event=>{
      event.preventDefault();const fd=new FormData(event.currentTarget),body=Object.fromEntries(fd);body.contractor_user_ids=fd.getAll("contractor_user_ids");
      try{
        await api(details?.id?"/api/partners/"+details.id:"/api/partners",{method:details?.id?"PUT":"POST",body:JSON.stringify(body)});
        closeDialog();toast("Partner mentve.","success");await refresh();
      }catch(error){toast(humanError(error),"error");}
    });
  }
  $("#newPartnerEditor").addEventListener("click",()=>editor());
  $$("[data-edit-partner]").forEach(button=>button.addEventListener("click",()=>editor(partners.find(row=>Number(row.id)===Number(button.dataset.editPartner)))));
  $$("[data-delete-partner]").forEach(button=>button.addEventListener("click",async()=>{
    const partner=partners.find(row=>Number(row.id)===Number(button.dataset.deletePartner));
    if(!partner)return;
    try{await api("/api/partners/"+partner.id,{method:"DELETE"});closeDialog();toast("Partner törölve.","success");await r3OpenPartnerManager(refresh);}
    catch(error){toast(humanError(error),"error");}
  }));
}

async function r3OpenFinanceSettings(refresh=renderFinance){
  const settings=await api("/api/finance/settings");
  openDialog({title:"Számlázási adatok",eyebrow:"FINANCE SETTINGS",body:
    "<form id='financeSettingsForm' class='form-grid'>"+
      "<label class='field'><span>Trade name</span><input name='trade_name' value='"+esc(settings.trade_name||"")+"'></label><label class='field'><span>Legal name</span><input name='legal_name' value='"+esc(settings.legal_name||"")+"'></label>"+
      "<label class='field full'><span>Cím 1</span><input name='address_line1' value='"+esc(settings.address_line1||"")+"'></label><label class='field full'><span>Cím 2</span><input name='address_line2' value='"+esc(settings.address_line2||"")+"'></label>"+
      "<label class='field'><span>Város</span><input name='city' value='"+esc(settings.city||"")+"'></label><label class='field'><span>Állam</span><input name='state' value='"+esc(settings.state||"")+"'></label>"+
      "<label class='field'><span>ZIP</span><input name='postal_code' value='"+esc(settings.postal_code||"")+"'></label><label class='field'><span>Tax ID / EIN</span><input name='tax_id' value='"+esc(settings.tax_id||"")+"'></label>"+
      "<label class='field'><span>E-mail</span><input name='email' type='email' value='"+esc(settings.email||"")+"'></label><label class='field'><span>Telefon</span><input name='phone' value='"+esc(settings.phone||"")+"'></label>"+
      "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>Mégse</button><button class='primary-button' type='submit'>Mentés</button></div></form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#financeSettingsForm").addEventListener("submit",async event=>{
    event.preventDefault();
    try{await api("/api/finance/settings",{method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast("Számlázási adatok mentve.","success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}

function r3LedgerRows(entries){
  return entries.slice().reverse().slice(0,18).map(entry=>"<div class='ledger-row'><span><strong>"+esc(entry.invoice_number||"")+"</strong><small>"+esc(entry.entry_date)+" · "+esc(entry.account)+(entry.payment_method?" · "+esc(entry.payment_method):"")+"</small></span><span>"+esc(entry.counterparty_name||"")+"</span><strong>"+r3Money(entry.amount)+"</strong></div>").join("");
}
function r3FilterInvoices(){
  const q=String($("#financeSearch")?.value||"").trim().toLowerCase(),invoices=state.r3Invoices||[];
  for(const direction of ["receivable","payable"]){
    const host=$("#"+(direction==="receivable"?"receivableList":"payableList"));if(!host)continue;
    const rows=invoices.filter(row=>row.direction===direction&&(!q||[row.invoice_number,row.counterparty_name,row.summary,row.job_code].filter(Boolean).join(" ").toLowerCase().includes(q)));
    host.innerHTML=rows.length?rows.map(r3InvoiceRow).join(""):"<div class='empty-state'>Nincs találat.</div>";
    r3BindInvoiceActions(host,rows,renderFinance);
  }
}

async function renderFinance(){
  const workspace=$("#workspace");
  if(!["ADMIN","MANAGER","SUPERADMIN"].includes(state.user?.role)){
    workspace.innerHTML=pageHead("Pénzügy","A számlázási és pénzügyi nézet Admin vagy Manager jogosultsághoz kötött.")+"<section class='panel empty-state'>Nincs jogosultságod a Pénzügy modulhoz.</section>";return;
  }
  state.r3Month=state.r3Month||r3CurrentMonth();
  const [stats,invoices,ledger]=await Promise.all([
    api("/api/finance/summary?month="+encodeURIComponent(state.r3Month)),
    api("/api/invoices"),
    api("/api/finance/ledger?month="+encodeURIComponent(state.r3Month))
  ]);
  state.r3Invoices=invoices;state.r3Ledger=ledger.entries||[];
  const admin=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  workspace.innerHTML=pageHead("Pénzügy","Egyszerű, invoice-alapú AR/AP és cash read model. A számlák és fizetések az egyetlen pénzügyi forrás.",
    "<button id='monthlyPdfBtn' class='secondary-button' type='button'>Havi PDF</button><button id='manualInvoiceBtn' class='primary-button' type='button'>＋ Számla / bill</button>")+
    "<div class='finance-controls'><label class='field'><span>Hónap</span><input id='financeMonth' type='month' value='"+esc(state.r3Month)+"'></label><div class='search-field'><input id='financeSearch' type='search' placeholder='Számlaszám, ügyfél, partner, munka…'></div>"+
      (admin?"<button id='partnersBtn' class='secondary-button' type='button'>Partnerek</button><button id='financeSettingsBtn' class='secondary-button' type='button'>Számlázási adatok</button>":"")+"</div>"+
    "<div class='finance-kpis'><div class='stat-card'><small>Accounts Receivable</small><strong>"+r3Money(stats.kpis.accounts_receivable)+"</strong></div><div class='stat-card'><small>Accounts Payable</small><strong>"+r3Money(stats.kpis.accounts_payable)+"</strong></div><div class='stat-card'><small>Bevétel · "+esc(stats.month)+"</small><strong>"+r3Money(stats.kpis.realized_revenue)+"</strong></div><div class='stat-card'><small>Kifizetett költség</small><strong>"+r3Money(stats.kpis.paid_costs)+"</strong></div><div class='stat-card'><small>Cash eredmény</small><strong>"+r3Money(stats.kpis.net_cash_result)+"</strong></div></div>"+
    "<div class='finance-split'><section class='panel finance-column'><div class='panel-head'><div><span class='eyebrow'>RECEIVABLE</span><h2>Kimenő számlák</h2></div><span class='badge'>"+invoices.filter(row=>row.direction==="receivable").length+" db</span></div><div id='receivableList' class='invoice-list'></div></section>"+
    "<section class='panel finance-column'><div class='panel-head'><div><span class='eyebrow'>PAYABLE</span><h2>Bejövő / vendor bill</h2></div><span class='badge'>"+invoices.filter(row=>row.direction==="payable").length+" db</span></div><div id='payableList' class='invoice-list'></div></section></div>"+
    "<section class='panel finance-ledger'><div class='panel-head'><div><span class='eyebrow'>DERIVED LEDGER</span><h2>Havi pénzügyi mozgások</h2></div><span class='badge'>"+state.r3Ledger.length+" tétel</span></div><div class='ledger-list'>"+(state.r3Ledger.length?r3LedgerRows(state.r3Ledger):"<div class='empty-state'>Ebben a hónapban még nincs pénzügyi mozgás.</div>")+"</div></section>";
  $("#financeMonth").addEventListener("change",async event=>{state.r3Month=event.target.value||r3CurrentMonth();await renderFinance();});
  $("#financeSearch").addEventListener("input",r3FilterInvoices);
  $("#monthlyPdfBtn").addEventListener("click",()=>r3DownloadPdf("/api/finance/monthly-report.pdf?month="+encodeURIComponent(state.r3Month),"Klavierhaus-Finance-"+state.r3Month+".pdf"));
  $("#manualInvoiceBtn").addEventListener("click",()=>r3OpenManualInvoice(renderFinance));
  $("#partnersBtn")?.addEventListener("click",()=>r3OpenPartnerManager(renderFinance));
  $("#financeSettingsBtn")?.addEventListener("click",()=>r3OpenFinanceSettings(renderFinance));
  r3FilterInvoices();
}

void boot();
