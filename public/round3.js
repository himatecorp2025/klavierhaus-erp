"use strict";

const R3_PAYMENT_METHODS=["Cash","Credit Card / Stripe","Bank Transfer","Check"];
const R3_ITEM_TYPES=[
  {key:"labor",en:"Labor / Technician Fee",hu:"Munkadíj / technikusi díj"},
  {key:"material",en:"Material / Parts",hu:"Anyag / alkatrész"},
  {key:"adjustment",en:"Adjustment / Discount",hu:"Korrekció / kedvezmény"},
  {key:"other",en:"Other",hu:"Egyéb"}
];

function r3Money(value){
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(Number(value||0));
}
function r3StatusLabel(status){
  const labels={
    draft:["Waiting / Draft","Várakozó / Piszkozat"],
    sent:["Sent","Elküldött"],
    paid:["Paid","Fizetett"],
    cancelled:["Cancelled","Érvénytelenített"]
  };
  const pair=labels[status];return pair?tr(pair[0],pair[1]):status||"";
}
function r3DirectionLabel(direction){return direction==="payable"?tr("Incoming / Vendor Bill","Bejövő / Vendor bill"):tr("Outgoing / Receivable","Kimenő / Receivable");}
function r3CurrentMonth(){return r2Today().slice(0,7);}
function r3PaymentOptions(selected=""){
  return R3_PAYMENT_METHODS.map(method=>"<option value='"+esc(method)+"' "+(method===selected?"selected":"")+">"+esc(method)+"</option>").join("");
}
function r3TypeOptions(selected="other"){
  return R3_ITEM_TYPES.map(item=>"<option value='"+item.key+"' "+(item.key===selected?"selected":"")+">"+esc(tr(item.en,item.hu))+"</option>").join("");
}
function r3LineMarkup(index,item={}){
  const type=item.item_type||"other",description=item.item_description||item.description||"",quantity=item.quantity??1,price=item.unit_price??"";
  return "<div class='invoice-line' data-invoice-line='"+index+"'>"+
    "<label class='field'><span>"+tr("Type","Típus")+"</span><select data-line-type>"+r3TypeOptions(type)+"</select></label>"+
    "<label class='field invoice-line-description'><span>"+tr("Description","Megnevezés")+" *</span><input data-line-description value='"+esc(description)+"' required></label>"+
    "<label class='field'><span>"+tr("Qty","Mennyiség")+"</span><input data-line-quantity type='number' min='0.01' step='0.01' value='"+esc(quantity)+"' required></label>"+
    "<label class='field'><span>"+tr("Unit price","Egységár")+" (USD)</span><input data-line-price type='number' step='0.01' value='"+esc(price)+"' required></label>"+
    "<button class='icon-button invoice-line-remove' type='button' data-remove-line aria-label='"+tr("Remove line","Tétel törlése")+"'>×</button>"+
  "</div>";
}
function r3BindLineEditor(root){
  const host=$("[data-lines-host]",root);if(!host)return;
  $("[data-add-line]",root)?.addEventListener("click",()=>{
    host.insertAdjacentHTML("beforeend",r3LineMarkup(Date.now(),{item_type:"other",quantity:1,unit_price:""}));
    r3BindLineRemove(host);
  });
  $("[data-add-discount]",root)?.addEventListener("click",()=>{
    host.insertAdjacentHTML("beforeend",r3LineMarkup(Date.now(),{item_type:"adjustment",description:tr("Discount","Kedvezmény"),quantity:1,unit_price:-50}));
    r3BindLineRemove(host);
  });
  r3BindLineRemove(host);
}
function r3BindLineRemove(host){
  $$("[data-remove-line]",host).forEach(button=>{
    if(button.dataset.bound)return;button.dataset.bound="1";
    button.addEventListener("click",()=>{
      if($$("[data-invoice-line]",host).length<=1){toast(tr("At least one invoice line is required.","Legalább egy számlatétel szükséges."),"error");return;}
      button.closest("[data-invoice-line]")?.remove();
    });
  });
}
function r3CollectItems(root=document){
  return $$("[data-invoice-line]",root).map(line=>({
    item_type:$("[data-line-type]",line)?.value||"other",
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
function r3DefaultJobLines(job){
  const rows=[];
  if(Number(job.total_labor_cost||0)>0)rows.push({item_type:"labor",item_description:tr("Labor / technician service","Munkadíj / technikusi szolgáltatás"),quantity:1,unit_price:Number(job.total_labor_cost)});
  if(Number(job.total_material_cost||0)>0)rows.push({item_type:"material",item_description:tr("Materials and parts","Anyagok és alkatrészek"),quantity:1,unit_price:Number(job.total_material_cost)});
  if(!rows.length)rows.push({item_type:"labor",item_description:job.title||tr("Klavierhaus service","Klavierhaus szolgáltatás"),quantity:1,unit_price:0});
  return rows;
}
function r3InvoiceEditorBody({job=null,invoice=null}={}){
  const rows=invoice?.items?.length?invoice.items:r3DefaultJobLines(job||{});
  const due=invoice?.due_date||r2DateAdd(r2Today(),30);
  const summary=invoice?.summary||((job?.job_code||tr("Job","Munka"))+" · "+(job?.title||""));
  return "<div class='invoice-editor-summary full'>"+
    (job?"<strong>"+esc(job.title)+"</strong><small>"+esc(job.client_name+" · "+r2JobPiano(job))+"</small>":"")+
    (job?"<small>"+tr("Recorded labor","Rögzített munkadíj")+": "+r3Money(job.total_labor_cost)+" · "+tr("materials","anyag")+": "+r3Money(job.total_material_cost)+"</small>":"")+
    "</div>"+
    "<label class='field full'><span>"+tr("Invoice summary","Számla összefoglaló")+"</span><input name='summary' value='"+esc(summary)+"' required></label>"+
    "<div class='invoice-lines full' data-lines-host>"+rows.map((row,index)=>r3LineMarkup(index+1,row)).join("")+"</div>"+
    "<div class='invoice-line-tools full'><button class='secondary-button' type='button' data-add-line>＋ "+tr("Add line","Tétel hozzáadása")+"</button><button class='secondary-button' type='button' data-add-discount>− "+tr("Add discount","Kedvezmény hozzáadása")+"</button></div>"+
    "<label class='field'><span>"+tr("Tax rate","Adókulcs")+" (%)</span><input name='tax_rate' type='number' min='0' max='100' step='0.01' value='"+esc(invoice?.tax_rate??0)+"'></label>"+
    "<label class='field'><span>"+tr("Due date","Fizetési határidő")+"</span><input name='due_date' type='date' value='"+esc(due)+"' required></label>"+
    "<label class='field'><span>"+tr("Invoice email language","Számla e-mail nyelve")+"</span><select name='email_language'><option value='en' "+((invoice?.email_language||"en")==="en"?"selected":"")+">English</option><option value='hu' "+(invoice?.email_language==="hu"?"selected":"")+">Magyar</option></select></label>"+
    "<label class='field full'><span>"+tr("Notes","Megjegyzés")+"</span><textarea name='notes'>"+esc(invoice?.notes||"")+"</textarea></label>";
}
function r3EditorPayload(form){
  const fields=Object.fromEntries(new FormData(form));
  return {summary:fields.summary,items:r3CollectItems(form),tax_rate:Number(fields.tax_rate||0),due_date:fields.due_date,email_language:fields.email_language||"en",notes:fields.notes||""};
}

async function r3OpenCloseout(job,refresh=renderWorkshop){
  if(!job)return;
  openDialog({title:tr("Complete Job & Invoice","Munka lezárása és számlázás"),eyebrow:job.job_code||"ADMIN APPROVAL",body:
    "<form id='closeoutForm' class='form-grid'>"+
      "<div class='detail-note full'>"+tr("Review the automatically calculated invoice. You may change prices, add extra lines or add a discount before closing the job.","Ellenőrizd az automatikusan számolt számlát. A lezárás előtt módosíthatod az árakat, adhatsz hozzá plusz tételt vagy kedvezményt.")+"</div>"+
      "<label class='field full'><span>"+tr("Client email","Ügyfél e-mail")+" </span><input name='recipient_email' type='email' value='"+esc(job.client_email||"")+"' placeholder='name@example.com'><small>"+tr("If you enter or change it here, it is saved to the client master record.","Ha itt megadod vagy módosítod, a rendszer elmenti az ügyfél törzsadatába is.")+"</small></label>"+
      r3InvoiceEditorBody({job})+
      "<div class='closeout-choice full'><button type='button' class='secondary-button' data-close-dialog>"+tr("Cancel","Mégse")+"</button><button type='submit' class='secondary-button' name='closeout_mode' value='draft'>"+tr("Save Draft / Send Later","Mentés piszkozatként / későbbi küldés")+"</button><button type='submit' class='primary-button' name='closeout_mode' value='send'>"+tr("Send Invoice Now","Számla azonnali kiküldése")+"</button></div>"+
    "</form>"
  });
  const form=$("#closeoutForm");r3BindLineEditor(form);$("[data-close-dialog]",form).addEventListener("click",closeDialog);
  let mode="draft";
  $$("[name='closeout_mode']",form).forEach(button=>button.addEventListener("click",()=>{mode=button.value;}));
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const email=String(form.elements.recipient_email?.value||"").trim();
    if(mode==="send"&&!email){toast(tr("Add the client email before sending.","Küldés előtt add meg az ügyfél e-mail címét."),"error");form.elements.recipient_email?.focus();return;}
    const body={...r3EditorPayload(form),invoice_mode:mode,recipient_email:email||null};
    try{
      const result=await api("/api/jobs/"+job.id+"/complete",{method:"POST",body:JSON.stringify(body)});
      closeDialog();
      if(mode==="send")toast(tr("Job completed and invoice sent.","Munka lezárva, a számla elküldve."),"success");
      else toast(tr("Job completed. Invoice saved as draft.","Munka lezárva. A számla piszkozatként mentve."),"success");
      await refresh();
    }catch(error){
      if(error.payload?.invoice&&error.payload?.job){
        closeDialog();toast(humanError(error)+" "+tr("The job is closed and the invoice remains a draft for retry.","A munka lezárult, a számla piszkozatként megmaradt újraküldéshez."),"error");await refresh();return;
      }
      toast(humanError(error),"error");
    }
  });
}

function r3InvoiceRow(invoice){
  const admin=["ADMIN","SUPERADMIN"].includes(state.user?.role),superadmin=state.user?.role==="SUPERADMIN";
  return "<article class='invoice-row status-"+esc(invoice.status)+"' data-invoice-row='"+invoice.id+"'>"+
    "<div class='invoice-row-main'><div class='invoice-number-line'><strong>"+esc(invoice.invoice_number)+"</strong><span class='invoice-status "+esc(invoice.status)+"'>"+esc(r3StatusLabel(invoice.status))+"</span></div>"+
    "<h3>"+esc(invoice.counterparty_name||invoice.client_name||invoice.partner_name||"—")+"</h3><p>"+esc(invoice.summary||"")+"</p>"+
    "<div class='invoice-row-meta'><span>"+tr("Issued","Keltezés")+": "+esc(invoice.issue_date)+"</span><span>"+tr("Due","Határidő")+": "+esc(invoice.due_date)+"</span>"+(invoice.job_code?"<span>"+esc(invoice.job_code)+"</span>":"")+"</div></div>"+
    "<div class='invoice-amounts'><strong>"+r3Money(invoice.total_amount)+"</strong><small>"+esc(r3DirectionLabel(invoice.direction))+"</small></div>"+
    "<div class='invoice-row-actions'><button class='text-button' type='button' data-view-invoice='"+invoice.id+"'>"+tr("Details","Részletek")+"</button><button class='secondary-button' type='button' data-pdf-invoice='"+invoice.id+"'>PDF</button>"+
      (invoice.direction==="receivable"&&invoice.status==="draft"&&admin?"<button class='secondary-button' type='button' data-edit-invoice='"+invoice.id+"'>"+tr("Review / Edit","Átnézés / módosítás")+"</button><button class='primary-button' type='button' data-send-invoice='"+invoice.id+"'>"+tr("Approve & Send","Jóváhagyás és küldés")+"</button>":"")+
      (invoice.status==="sent"?"<button class='primary-button' type='button' data-pay-invoice='"+invoice.id+"'>"+tr("Mark Paid","Kiegyenlítés rögzítése")+"</button>":"")+
      (admin&&!["paid","cancelled"].includes(invoice.status)?"<button class='danger-button' type='button' data-cancel-invoice='"+invoice.id+"'>"+tr("Cancel","Érvénytelenítés")+"</button>":"")+
      (superadmin&&["draft","cancelled"].includes(invoice.status)?"<button class='danger-button' type='button' data-delete-invoice='"+invoice.id+"'>"+tr("Delete / Archive","Törlés / Archívum")+"</button>":"")+
    "</div></article>";
}
function r3BindInvoiceActions(root,invoices,refresh=renderFinance){
  $$("[data-view-invoice]",root).forEach(button=>button.addEventListener("click",()=>r3OpenInvoice(Number(button.dataset.viewInvoice),refresh)));
  $$("[data-pdf-invoice]",root).forEach(button=>button.addEventListener("click",()=>{
    const invoice=invoices.find(row=>Number(row.id)===Number(button.dataset.pdfInvoice));
    r3DownloadPdf("/api/invoices/"+button.dataset.pdfInvoice+"/pdf",(invoice?.invoice_number||"Invoice")+".pdf");
  }));
  $$("[data-edit-invoice]",root).forEach(button=>button.addEventListener("click",async()=>r3OpenEditInvoice(await api("/api/invoices/"+button.dataset.editInvoice),refresh)));
  $$("[data-send-invoice]",root).forEach(button=>button.addEventListener("click",async()=>r3OpenSendInvoice(await api("/api/invoices/"+button.dataset.sendInvoice),refresh)));
  $$("[data-pay-invoice]",root).forEach(button=>button.addEventListener("click",async()=>r3OpenMarkPaid(await api("/api/invoices/"+button.dataset.payInvoice),refresh)));
  $$("[data-cancel-invoice]",root).forEach(button=>button.addEventListener("click",async()=>r3OpenCancelInvoice(await api("/api/invoices/"+button.dataset.cancelInvoice),refresh)));
  $$("[data-delete-invoice]",root).forEach(button=>button.addEventListener("click",async()=>r3OpenHardDelete(await api("/api/invoices/"+button.dataset.deleteInvoice),refresh)));
}
async function r3OpenInvoice(id,refresh=renderFinance){
  const invoice=await api("/api/invoices/"+id);
  openDialog({title:invoice.invoice_number,eyebrow:r3DirectionLabel(invoice.direction),body:
    "<div class='invoice-detail-head'><div><h3>"+esc(invoice.counterparty_name)+"</h3><p class='muted'>"+esc(invoice.summary||"")+"</p></div><span class='invoice-status "+esc(invoice.status)+"'>"+esc(r3StatusLabel(invoice.status))+"</span></div>"+
    "<div class='invoice-detail-kpis'><div><small>"+tr("Labor","Munkadíj")+"</small><strong>"+r3Money(invoice.subtotal_labor)+"</strong></div><div><small>"+tr("Material","Anyag")+"</small><strong>"+r3Money(invoice.subtotal_material)+"</strong></div><div><small>"+tr("Total","Összesen")+"</small><strong>"+r3Money(invoice.total_amount)+"</strong></div></div>"+
    "<div class='invoice-detail-grid'><div><span>"+tr("Issued","Keltezés")+"</span><strong>"+esc(invoice.issue_date)+"</strong></div><div><span>"+tr("Due","Határidő")+"</span><strong>"+esc(invoice.due_date)+"</strong></div><div><span>"+tr("Tax","Adó")+"</span><strong>"+esc(Number(invoice.tax_rate||0).toFixed(2))+"%</strong></div><div><span>"+tr("Email language","E-mail nyelve")+"</span><strong>"+esc((invoice.email_language||"en").toUpperCase())+"</strong></div></div>"+
    "<div class='panel-head invoice-detail-section'><h3>"+tr("Invoice lines","Számlatételek")+"</h3></div><div class='invoice-item-list'>"+invoice.items.map(item=>"<div><span>"+esc(tr(R3_ITEM_TYPES.find(type=>type.key===item.item_type)?.en||item.item_type,R3_ITEM_TYPES.find(type=>type.key===item.item_type)?.hu||item.item_type))+" · "+esc(item.item_description)+" · "+esc(item.quantity)+" × "+r3Money(item.unit_price)+"</span><strong>"+r3Money(item.total_price)+"</strong></div>").join("")+"</div>"+
    (invoice.sent_at?"<div class='detail-note'>"+tr("Sent","Elküldve")+": "+esc(invoice.sent_at)+(invoice.resend_message_id?" · Resend "+esc(invoice.resend_message_id):"")+"</div>":"")+
    (invoice.paid_at?"<div class='detail-note'>"+tr("Paid","Fizetve")+": "+esc(invoice.paid_at)+" · "+esc(invoice.payment_method||"")+"</div>":"")+
    "<div class='form-actions'><button class='secondary-button' type='button' id='invoiceDetailPdf'>PDF</button>"+
      (invoice.status==="draft"&&["ADMIN","SUPERADMIN"].includes(state.user?.role)?"<button class='secondary-button' type='button' id='invoiceDetailEdit'>"+tr("Edit","Módosítás")+"</button><button class='primary-button' type='button' id='invoiceDetailSend'>"+tr("Approve & Send","Jóváhagyás és küldés")+"</button>":"")+
      (invoice.status==="sent"?"<button class='primary-button' type='button' id='invoiceDetailPaid'>"+tr("Mark Paid","Kiegyenlítés rögzítése")+"</button>":"")+"</div>"
  });
  $("#invoiceDetailPdf").addEventListener("click",()=>r3DownloadPdf("/api/invoices/"+invoice.id+"/pdf",invoice.invoice_number+".pdf"));
  $("#invoiceDetailEdit")?.addEventListener("click",()=>{closeDialog();r3OpenEditInvoice(invoice,refresh);});
  $("#invoiceDetailSend")?.addEventListener("click",()=>{closeDialog();r3OpenSendInvoice(invoice,refresh);});
  $("#invoiceDetailPaid")?.addEventListener("click",()=>{closeDialog();r3OpenMarkPaid(invoice,refresh);});
}
function r3OpenEditInvoice(invoice,refresh=renderFinance){
  openDialog({title:tr("Review Draft Invoice","Piszkozat számla átnézése"),eyebrow:invoice.invoice_number,body:
    "<form id='editInvoiceForm' class='form-grid'>"+r3InvoiceEditorBody({invoice})+
    "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>"+tr("Cancel","Mégse")+"</button><button class='primary-button' type='submit'>"+tr("Save Changes","Módosítások mentése")+"</button></div></form>"
  });
  const form=$("#editInvoiceForm");r3BindLineEditor(form);$("[data-close-dialog]",form).addEventListener("click",closeDialog);
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    try{await api("/api/invoices/"+invoice.id,{method:"PUT",body:JSON.stringify(r3EditorPayload(form))});closeDialog();toast(tr("Draft invoice updated.","Piszkozat számla frissítve."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r3OpenSendInvoice(invoice,refresh=renderFinance){
  openDialog({title:tr("Approve & Send Invoice","Számla jóváhagyása és küldése"),eyebrow:invoice.invoice_number,body:
    "<form id='sendInvoiceForm' class='form-grid'><div class='detail-note full'>"+tr("Confirm the recipient before sending. A new address is saved to the client master record.","Küldés előtt ellenőrizd a címzettet. Az új cím az ügyfél törzsadatába is elmentésre kerül.")+"</div>"+
    "<label class='field full'><span>"+tr("Client email","Ügyfél e-mail")+" *</span><input name='recipient_email' type='email' value='"+esc(invoice.counterparty_email||"")+"' placeholder='name@example.com' required></label>"+
    "<label class='field full'><span>"+tr("Email language","E-mail nyelve")+"</span><select name='language'><option value='en' "+((invoice.email_language||"en")==="en"?"selected":"")+">English</option><option value='hu' "+(invoice.email_language==="hu"?"selected":"")+">Magyar</option></select></label>"+
    "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>"+tr("Cancel","Mégse")+"</button><button class='primary-button' type='submit'>"+tr("Send Invoice","Számla küldése")+"</button></div></form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#sendInvoiceForm").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));
    try{await api("/api/invoices/"+invoice.id+"/send-email",{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Invoice sent.","Számla elküldve."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r3OpenMarkPaid(invoice,refresh=renderFinance){
  openDialog({title:tr("Mark Invoice Paid","Kiegyenlítés rögzítése"),eyebrow:invoice.invoice_number,body:
    "<form id='markPaidForm' class='form-grid'><div class='detail-note full'>"+tr("This records the full invoice amount as paid: ","A teljes számlaösszeg kerül kiegyenlítésre: ")+"<strong>"+r3Money(invoice.total_amount)+"</strong></div>"+
    "<label class='field'><span>"+tr("Payment date","Fizetés dátuma")+" *</span><input name='paid_at' type='date' value='"+r2Today()+"' required></label>"+
    "<label class='field'><span>"+tr("Payment method","Fizetési mód")+" *</span><select name='payment_method' required>"+r3PaymentOptions(invoice.payment_method||"Bank Transfer")+"</select></label>"+
    "<label class='field'><span>"+tr("Reference","Referencia")+"</span><input name='reference'></label><label class='field'><span>"+tr("Notes","Megjegyzés")+"</span><input name='notes'></label>"+
    "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>"+tr("Cancel","Mégse")+"</button><button class='primary-button' type='submit'>"+tr("Mark Full Amount Paid","Teljes összeg kiegyenlítve")+"</button></div></form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#markPaidForm").addEventListener("submit",async event=>{
    event.preventDefault();
    try{await api("/api/invoices/"+invoice.id+"/mark-paid",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast(tr("Invoice marked paid.","Számla fizetettre állítva."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r3OpenCancelInvoice(invoice,refresh=renderFinance){
  openDialog({title:tr("Cancel Invoice","Számla érvénytelenítése"),eyebrow:invoice.invoice_number,body:
    "<form id='cancelInvoiceForm' class='form-grid'><label class='field full'><span>"+tr("Reason","Ok")+" *</span><textarea name='reason' required></textarea></label><div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>"+tr("Back","Vissza")+"</button><button class='danger-button' type='submit'>"+tr("Cancel Invoice","Számla érvénytelenítése")+"</button></div></form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#cancelInvoiceForm").addEventListener("submit",async event=>{
    event.preventDefault();
    try{await api("/api/invoices/"+invoice.id+"/cancel",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast(tr("Invoice cancelled.","Számla érvénytelenítve."),"success");await refresh();}
    catch(error){toast(humanError(error),"error");}
  });
}
function r3OpenHardDelete(invoice,refresh=renderFinance){
  openDialog({title:tr("Remove Invoice from Active Finance","Számla kivétele az aktív pénzügyből"),eyebrow:"SUPER ADMIN · ARCHIVE",body:
    "<form id='archiveInvoiceForm' class='form-grid'><div class='detail-note full'>"+tr("The invoice will disappear from active outgoing/incoming lists, but its snapshot and PDF will remain in Documents / Archive.","A számla kikerül az aktív kimenő/bejövő listából, de a pillanatképe és PDF-je megmarad a Dokumentumok / Archívumban.")+"<br><strong>"+esc(invoice.invoice_number)+"</strong></div>"+
    "<label class='field full'><span>"+tr("Archive reason","Archiválás oka")+"</span><textarea name='reason' placeholder='"+tr("Duplicate, cancelled draft, created by mistake…","Duplikáció, törölt piszkozat, tévesen létrehozva…")+"'></textarea></label>"+
    "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>"+tr("Cancel","Mégse")+"</button><button type='submit' class='danger-button'>"+tr("Remove & Archive","Kivétel és archiválás")+"</button></div></form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#archiveInvoiceForm").addEventListener("submit",async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));try{await api("/api/invoices/"+invoice.id,{method:"DELETE",body:JSON.stringify(body)});closeDialog();toast(tr("Invoice moved to the archive.","A számla az archívumba került."),"success");await refresh();}catch(error){toast(humanError(error),"error");}});
}

async function r3OpenManualInvoice(refresh=renderFinance){
  const [clients,partners]=await Promise.all([loadClients(),api("/api/partners")]);
  openDialog({title:tr("New Invoice / Vendor Bill","Új számla / vendor bill"),eyebrow:"INVOICE DISPATCHER",body:
    "<form id='manualInvoiceForm' class='form-grid'>"+
    "<label class='field full'><span>"+tr("Direction","Irány")+" *</span><select id='manualDirection' name='direction'><option value='receivable'>"+tr("Outgoing / Receivable","Kimenő / Receivable")+"</option><option value='payable'>"+tr("Incoming / Vendor Bill","Bejövő / Vendor bill")+"</option></select></label>"+
    "<label class='field full' id='manualClientField'><span>"+tr("Client","Ügyfél")+" *</span><select name='client_id'><option value=''>"+tr("Choose client","Válassz ügyfelet")+"</option>"+clients.map(client=>"<option value='"+client.id+"'>"+esc(client.name)+"</option>").join("")+"</select></label>"+
    "<label class='field full hidden' id='manualPartnerField'><span>"+tr("Partner","Partner")+" *</span><select name='partner_id'><option value=''>"+tr("Choose partner","Válassz partnert")+"</option>"+partners.filter(partner=>partner.status==="active").map(partner=>"<option value='"+partner.id+"'>"+esc(partner.company_name)+"</option>").join("")+"</select></label>"+
    r3InvoiceEditorBody({})+
    "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>"+tr("Cancel","Mégse")+"</button><button class='primary-button' type='submit'>"+tr("Create Invoice","Számla létrehozása")+"</button></div></form>"
  });
  const form=$("#manualInvoiceForm");r3BindLineEditor(form);$("[data-close-dialog]",form).addEventListener("click",closeDialog);
  $("#manualDirection").addEventListener("change",event=>{const payable=event.target.value==="payable";$("#manualClientField").classList.toggle("hidden",payable);$("#manualPartnerField").classList.toggle("hidden",!payable);});
  form.addEventListener("submit",async event=>{
    event.preventDefault();const data=Object.fromEntries(new FormData(form)),body={...r3EditorPayload(form),direction:data.direction,issue_date:r2Today()};
    if(data.direction==="payable")body.partner_id=Number(data.partner_id);else body.client_id=Number(data.client_id);
    try{const invoice=await api("/api/invoices",{method:"POST",body:JSON.stringify(body)});closeDialog();toast(invoice.invoice_number+" "+tr("created.","létrehozva."),"success");await refresh();}catch(error){toast(humanError(error),"error");}
  });
}

async function r3OpenPartnerManager(refresh=renderFinance){
  const [partners,users]=await Promise.all([api("/api/partners"),loadUsers()]);
  const options=users.filter(user=>["WORKER","MANAGER","ADMIN"].includes(user.role)).map(user=>"<option value='"+esc(user.id)+"'>"+esc(user.name)+" · "+esc(roleLabel(user.role))+"</option>").join("");
  openDialog({title:tr("Partners","Partnerek"),eyebrow:"VENDOR MASTER DATA",body:
    "<div class='partner-manager'><div class='partner-manager-list'><button id='newPartnerEditor' class='primary-button' type='button'>＋ "+tr("New partner","Új partner")+"</button>"+
    (partners.length?partners.map(partner=>"<article class='partner-manager-row'><div><strong>"+esc(partner.company_name)+"</strong><small>"+esc(partner.email||partner.phone||partner.status)+"</small></div><div><button class='text-button' type='button' data-edit-partner='"+partner.id+"'>"+tr("Edit","Szerkesztés")+"</button><button class='text-button danger-text' type='button' data-delete-partner='"+partner.id+"'>"+tr("Delete","Törlés")+"</button></div></article>").join(""):"<div class='empty-state'>"+tr("No partners.","Nincs partner.")+"</div>")+
    "</div><div id='partnerEditorHost' class='partner-editor-host'><div class='empty-state'>"+tr("Select a partner or create one.","Válassz partnert vagy hozz létre újat.")+"</div></div></div>"
  });
  const host=$("#partnerEditorHost");
  async function editor(partner=null){
    let details=partner;if(partner?.id)details=await api("/api/partners/"+partner.id);
    const selected=new Set(details?.contractor_user_ids||[]);
    host.innerHTML="<form id='partnerForm' class='form-grid'>"+
      "<label class='field full'><span>"+tr("Company name","Cégnév")+" *</span><input name='company_name' value='"+esc(details?.company_name||"")+"' required autofocus></label>"+
      "<label class='field'><span>"+tr("Contact","Kapcsolattartó")+"</span><input name='contact_name' value='"+esc(details?.contact_name||"")+"'></label><label class='field'><span>Tax ID</span><input name='tax_id' value='"+esc(details?.tax_id||"")+"'></label>"+
      "<label class='field'><span>Email</span><input name='email' type='email' value='"+esc(details?.email||"")+"'></label><label class='field'><span>"+tr("Phone","Telefon")+"</span><input name='phone' value='"+esc(details?.phone||"")+"'></label>"+
      "<label class='field full'><span>"+tr("Address","Cím")+"</span><input name='address' value='"+esc(details?.address||"")+"'></label>"+
      "<label class='field'><span>"+tr("Status","Státusz")+"</span><select name='status'><option value='active' "+(details?.status!=="inactive"?"selected":"")+">"+tr("Active","Aktív")+"</option><option value='inactive' "+(details?.status==="inactive"?"selected":"")+">"+tr("Inactive","Inaktív")+"</option></select></label>"+
      "<label class='field'><span>"+tr("Linked technicians","Kapcsolt technikusok")+"</span><select name='contractor_user_ids' multiple size='4'>"+options.replace(/value='([^']+)'/g,(match,id)=>match+(selected.has(id)?" selected":""))+"</select></label>"+
      "<label class='field full'><span>"+tr("Notes","Megjegyzés")+"</span><textarea name='notes'>"+esc(details?.notes||"")+"</textarea></label>"+
      "<div class='form-actions full'><button class='primary-button' type='submit'>"+tr("Save","Mentés")+"</button></div></form>";
    $("#partnerForm").addEventListener("submit",async event=>{
      event.preventDefault();const fd=new FormData(event.currentTarget),body=Object.fromEntries(fd);body.contractor_user_ids=fd.getAll("contractor_user_ids");
      try{await api(details?.id?"/api/partners/"+details.id:"/api/partners",{method:details?.id?"PUT":"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Partner saved.","Partner mentve."),"success");await refresh();}catch(error){toast(humanError(error),"error");}
    });
  }
  $("#newPartnerEditor").addEventListener("click",()=>editor());
  $$("[data-edit-partner]").forEach(button=>button.addEventListener("click",()=>editor(partners.find(row=>Number(row.id)===Number(button.dataset.editPartner)))));
  $$("[data-delete-partner]").forEach(button=>button.addEventListener("click",async()=>{const partner=partners.find(row=>Number(row.id)===Number(button.dataset.deletePartner));try{await api("/api/partners/"+partner.id,{method:"DELETE"});closeDialog();toast(tr("Partner deleted.","Partner törölve."),"success");await refresh();}catch(error){toast(humanError(error),"error");}}));
}
async function r3OpenDirectExpenses(refresh=renderFinance){
  const expenses=await api("/api/direct-expenses?month="+encodeURIComponent(state.r3Month||r3CurrentMonth()));
  openDialog({title:tr("Direct Expenses","Közvetlen költségek"),eyebrow:"CASH FLOW",body:
    "<form id='directExpenseForm' class='form-grid'><label class='field'><span>"+tr("Category","Kategória")+" *</span><input name='category' required placeholder='"+tr("Parts order","Alkatrész rendelés")+"'></label><label class='field'><span>"+tr("Date","Dátum")+" *</span><input name='expense_date' type='date' value='"+r2Today()+"' required></label>"+
    "<label class='field full'><span>"+tr("Description","Leírás")+" *</span><input name='description' required></label><label class='field'><span>"+tr("Amount","Összeg")+" (USD) *</span><input name='amount' type='number' min='0' step='0.01' required></label><label class='field'><span>"+tr("Receipt URL","Nyugta URL")+"</span><input name='receipt_url'></label>"+
    "<div class='form-actions full'><button class='primary-button' type='submit'>＋ "+tr("Add Expense","Költség hozzáadása")+"</button></div></form>"+
    "<div class='expense-list'>"+(expenses.length?expenses.map(expense=>"<article class='expense-row'><div><strong>"+esc(expense.category)+"</strong><small>"+esc(expense.expense_date)+" · "+esc(expense.description)+"</small></div><strong>"+r3Money(expense.amount)+"</strong>"+(["ADMIN","SUPERADMIN"].includes(state.user?.role)?"<button class='text-button danger-text' type='button' data-delete-expense='"+expense.id+"'>"+tr("Delete","Törlés")+"</button>":"")+"</article>").join(""):"<div class='empty-state'>"+tr("No direct expenses this month.","Nincs közvetlen költség ebben a hónapban.")+"</div>")+"</div>"
  });
  $("#directExpenseForm").addEventListener("submit",async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.amount=Number(body.amount);try{await api("/api/direct-expenses",{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Expense added.","Költség hozzáadva."),"success");await refresh();}catch(error){toast(humanError(error),"error");}});
  $$("[data-delete-expense]").forEach(button=>button.addEventListener("click",async()=>{try{await api("/api/direct-expenses/"+button.dataset.deleteExpense,{method:"DELETE"});closeDialog();toast(tr("Expense deleted.","Költség törölve."),"success");await refresh();}catch(error){toast(humanError(error),"error");}}));
}
async function r3OpenFinanceSettings(refresh=renderFinance){
  const settings=await api("/api/finance/settings");
  openDialog({title:tr("Invoice Company Data","Számlázási adatok"),eyebrow:"FINANCE SETTINGS",body:
    "<form id='financeSettingsForm' class='form-grid'>"+
    "<label class='field'><span>Trade name</span><input name='trade_name' value='"+esc(settings.trade_name||"")+"'></label><label class='field'><span>Legal name</span><input name='legal_name' value='"+esc(settings.legal_name||"")+"'></label>"+
    "<label class='field full'><span>"+tr("Address line 1","Cím 1")+"</span><input name='address_line1' value='"+esc(settings.address_line1||"")+"'></label><label class='field full'><span>"+tr("Address line 2","Cím 2")+"</span><input name='address_line2' value='"+esc(settings.address_line2||"")+"'></label>"+
    "<label class='field'><span>"+tr("City","Város")+"</span><input name='city' value='"+esc(settings.city||"")+"'></label><label class='field'><span>"+tr("State","Állam")+"</span><input name='state' value='"+esc(settings.state||"")+"'></label>"+
    "<label class='field'><span>ZIP</span><input name='postal_code' value='"+esc(settings.postal_code||"")+"'></label><label class='field'><span>Tax ID / EIN</span><input name='tax_id' value='"+esc(settings.tax_id||"")+"'></label>"+
    "<label class='field'><span>Email</span><input name='email' type='email' value='"+esc(settings.email||"")+"'></label><label class='field'><span>"+tr("Phone","Telefon")+"</span><input name='phone' value='"+esc(settings.phone||"")+"'></label>"+
    "<div class='form-actions full'><button type='button' class='secondary-button' data-close-dialog>"+tr("Cancel","Mégse")+"</button><button class='primary-button' type='submit'>"+tr("Save","Mentés")+"</button></div></form>"
  });
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#financeSettingsForm").addEventListener("submit",async event=>{event.preventDefault();try{await api("/api/finance/settings",{method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});closeDialog();toast(tr("Invoice company data saved.","Számlázási adatok mentve."),"success");await refresh();}catch(error){toast(humanError(error),"error");}});
}
function r3LedgerRows(entries){
  return entries.slice().reverse().slice(0,20).map(entry=>"<div class='ledger-row'><span><strong>"+esc(entry.invoice_number||entry.category||"")+"</strong><small>"+esc(entry.entry_date)+" · "+esc(entry.account||entry.entry_type||"")+"</small></span><span>"+esc(entry.counterparty_name||entry.summary||"")+"</span><strong>"+r3Money(entry.amount)+"</strong></div>").join("");
}
function r3FilterInvoices(){
  const q=String($("#financeSearch")?.value||"").trim().toLowerCase(),status=$("#invoiceStatusFilter")?.value||"",invoices=state.r3Invoices||[];
  for(const direction of ["receivable","payable"]){
    const host=$("#"+(direction==="receivable"?"receivableList":"payableList"));if(!host)continue;
    const rows=invoices.filter(row=>row.direction===direction&&(!status||row.status===status)&&(!q||[row.invoice_number,row.counterparty_name,row.summary,row.job_code].filter(Boolean).join(" ").toLowerCase().includes(q)));
    host.innerHTML=rows.length?rows.map(r3InvoiceRow).join(""):"<div class='empty-state'>"+tr("No matching invoices.","Nincs megfelelő számla.")+"</div>";
    r3BindInvoiceActions(host,rows,renderFinance);
  }
}
async function renderFinance(){
  const workspace=$("#workspace");
  if(!["ADMIN","MANAGER","SUPERADMIN"].includes(state.user?.role)){workspace.innerHTML=pageHead(tr("Finance","Pénzügy"),tr("Admin or Manager access is required.","Admin vagy Manager jogosultság szükséges."))+"<section class='panel empty-state'>"+tr("No Finance permission.","Nincs Pénzügy jogosultság.")+"</section>";return;}
  state.r3Month=state.r3Month||r3CurrentMonth();
  const [stats,invoices,ledger]=await Promise.all([api("/api/finance/overview?month="+encodeURIComponent(state.r3Month)),api("/api/invoices"),api("/api/finance/ledger?month="+encodeURIComponent(state.r3Month))]);
  state.r3Invoices=invoices;state.r3Ledger=ledger.entries||[];const admin=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  workspace.innerHTML=pageHead(tr("Finance","Pénzügy"),tr("Workshop revenue, costs and outstanding invoices from one invoice-based source of truth.","Műhelybevétel, költségek és kintlévő számlák egyetlen invoice-alapú forrásból."),
    "<button id='monthlyPdfBtn' class='secondary-button' type='button'>"+tr("Monthly PDF","Havi PDF")+"</button><button id='manualInvoiceBtn' class='primary-button' type='button'>＋ "+tr("Invoice / Bill","Számla / bill")+"</button>")+
    "<div class='finance-controls'><label class='field'><span>"+tr("Month","Hónap")+"</span><input id='financeMonth' type='month' value='"+esc(state.r3Month)+"'></label><div class='search-field'><input id='financeSearch' type='search' placeholder='"+tr("Invoice, client, partner, job…","Számla, ügyfél, partner, munka…")+"'></div>"+
    "<select id='invoiceStatusFilter'><option value=''>"+tr("All invoice statuses","Minden számlastátusz")+"</option><option value='draft'>"+tr("Waiting / Draft","Várakozó / Piszkozat")+"</option><option value='sent'>"+tr("Sent","Elküldött")+"</option><option value='paid'>"+tr("Paid","Fizetett")+"</option><option value='cancelled'>"+tr("Cancelled","Érvénytelenített")+"</option></select>"+
    "<button id='directExpensesBtn' class='secondary-button' type='button'>"+tr("Direct Expenses","Közvetlen költségek")+"</button>"+(admin?"<button id='partnersBtn' class='secondary-button' type='button'>"+tr("Partners","Partnerek")+"</button><button id='financeSettingsBtn' class='secondary-button' type='button'>"+tr("Invoice Settings","Számlázási adatok")+"</button>":"")+"</div>"+
    "<div class='finance-kpis four'><div class='stat-card'><small>"+tr("Labor Revenue","Munkadíj bevétel")+"</small><strong>"+r3Money(stats.kpis.labor_revenue)+"</strong></div><div class='stat-card'><small>"+tr("Material + Direct Costs","Anyag + közvetlen költség")+"</small><strong>"+r3Money(stats.kpis.material_direct_cost)+"</strong></div><div class='stat-card'><small>"+tr("Net Workshop Result","Tiszta műhelyeredmény")+"</small><strong>"+r3Money(stats.kpis.net_workshop_result)+"</strong></div><div class='stat-card outstanding-card'><small>"+tr("Outstanding Invoices","Folyamatban lévő számlák")+"</small><strong>"+Number(stats.kpis.outstanding_invoice_count||0)+"</strong><span>"+r3Money(stats.kpis.outstanding_invoice_amount)+"</span></div></div>"+
    "<div class='finance-split'><section class='panel finance-column'><div class='panel-head'><div><span class='eyebrow'>RECEIVABLE</span><h2>"+tr("Outgoing Invoices","Kimenő számlák")+"</h2></div><span class='badge'>"+invoices.filter(row=>row.direction==="receivable").length+"</span></div><div id='receivableList' class='invoice-list'></div></section>"+
    "<section class='panel finance-column'><div class='panel-head'><div><span class='eyebrow'>PAYABLE</span><h2>"+tr("Incoming / Vendor Bills","Bejövő / vendor bill")+"</h2></div><span class='badge'>"+invoices.filter(row=>row.direction==="payable").length+"</span></div><div id='payableList' class='invoice-list'></div></section></div>"+
    "<section class='panel finance-ledger'><div class='panel-head'><div><span class='eyebrow'>DERIVED LEDGER</span><h2>"+tr("Monthly Financial Activity","Havi pénzügyi mozgások")+"</h2></div><span class='badge'>"+state.r3Ledger.length+"</span></div><div class='ledger-list'>"+(state.r3Ledger.length?r3LedgerRows(state.r3Ledger):"<div class='empty-state'>"+tr("No activity this month.","Ebben a hónapban nincs pénzügyi mozgás.")+"</div>")+"</div></section>";
  $("#financeMonth").addEventListener("change",async event=>{state.r3Month=event.target.value||r3CurrentMonth();await renderFinance();});
  $("#financeSearch").addEventListener("input",r3FilterInvoices);$("#invoiceStatusFilter").addEventListener("change",r3FilterInvoices);
  $("#monthlyPdfBtn").addEventListener("click",()=>r3DownloadPdf("/api/finance/monthly-report.pdf?month="+encodeURIComponent(state.r3Month),"Klavierhaus-Finance-"+state.r3Month+".pdf"));
  $("#manualInvoiceBtn").addEventListener("click",()=>r3OpenManualInvoice(renderFinance));$("#directExpensesBtn").addEventListener("click",()=>r3OpenDirectExpenses(renderFinance));
  $("#partnersBtn")?.addEventListener("click",()=>r3OpenPartnerManager(renderFinance));$("#financeSettingsBtn")?.addEventListener("click",()=>r3OpenFinanceSettings(renderFinance));r3FilterInvoices();
}

// V6 bootstrap is invoked by public/v6.js after UI overrides are installed.
