"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function createInvoiceSupport({db,uploadDir}){
 const folder=path.join(uploadDir,'invoice-support');fs.mkdirSync(folder,{recursive:true});
 const fault=(m,s=400)=>Object.assign(new Error(m),{status:s});
 function invoice(id){const row=db.prepare('SELECT * FROM invoices WHERE id=?').get(id);if(!row)throw fault('INVOICE_NOT_FOUND',404);if(row.direction!=='payable')throw fault('SUPPORT_DOCUMENT_REQUIRES_PAYABLE');return row;}
 function get(id){invoice(id);return db.prepare('SELECT * FROM invoice_supporting_documents WHERE invoice_id=?').get(id)||null;}
 function save(id,buffer,{name='document',kind='ATTACHED',user}={}){
   invoice(id);if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>20*1024*1024)throw fault('INVALID_DOCUMENT_SIZE');
   let mime,ext;
   if(buffer.subarray(0,5).toString()==='%PDF-'){mime='application/pdf';ext='.pdf';}
   else if(buffer.subarray(0,8).toString('hex')==='89504e470d0a1a0a'){mime='image/png';ext='.png';}
   else if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255){mime='image/jpeg';ext='.jpg';}
   else throw fault('INVALID_SUPPORT_DOCUMENT_TYPE');
   if(!['ATTACHED','GENERATED'].includes(kind))throw fault('INVALID_DOCUMENT_KIND');
   const old=get(id),stored=crypto.randomUUID()+ext,file=path.join(folder,stored);
   // A confirmed factory reset can remove upload subdirectories without restarting.
   fs.mkdirSync(folder,{recursive:true});
   fs.writeFileSync(file,buffer,{flag:'wx'});
   try{db.transaction(()=>{
     db.prepare(`INSERT INTO invoice_supporting_documents(invoice_id,stored_name,original_name,mime_type,sha256,size_bytes,document_kind,created_by) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET stored_name=excluded.stored_name,original_name=excluded.original_name,mime_type=excluded.mime_type,sha256=excluded.sha256,size_bytes=excluded.size_bytes,document_kind=excluded.document_kind,created_by=excluded.created_by,created_at=CURRENT_TIMESTAMP`)
       .run(id,stored,path.basename(String(name)).replace(/[\x00-\x1f]/g,'').slice(0,200)||'document'+ext,mime,crypto.createHash('sha256').update(buffer).digest('hex'),buffer.length,kind,user?.id||null);
     db.prepare('UPDATE invoices SET document_status=? WHERE id=?').run(kind,id);
   })();}catch(e){fs.rmSync(file,{force:true});throw e;}
   if(old&&old.stored_name!==stored)fs.rmSync(path.join(folder,path.basename(old.stored_name)),{force:true});
   return get(id);
 }
 function read(id){const doc=get(id);if(!doc)throw fault('SUPPORT_DOCUMENT_MISSING',404);return {doc,buffer:fs.readFileSync(path.join(folder,path.basename(doc.stored_name)))};}
 return {get,save,read};
}
function registerInvoiceSupportRoutes({app,db,auth,permit,uploadDir,invoiceEngine,companyData}){
 const service=createInvoiceSupport({db,uploadDir});
 const multer=require('multer');const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1}});
 const fail=(res,e)=>res.status(e.status||500).json({error:e.message});
 app.post('/api/invoices/:id/support-document',auth,permit('ADMIN'),upload.single('file'),(req,res)=>{try{if(!req.file)throw Object.assign(new Error('FILE_REQUIRED'),{status:400});res.json(service.save(req.params.id,req.file.buffer,{name:req.file.originalname,user:req.user}));}catch(e){fail(res,e);}});
 app.post('/api/invoices/:id/support-document/generate',auth,permit('ADMIN'),(req,res)=>{try{
   const existing=service.get(req.params.id);if(existing)return res.json(existing);
   const invoice=invoiceEngine.invoiceDetail(req.params.id);const {generateBusinessInvoicePdf}=require('./document-pdf');
   const pdf=generateBusinessInvoicePdf({company:companyData(),invoice:{...invoice,summary:'Internal cost document / Belso koltsegbizonylat: '+invoice.summary},items:invoice.items,counterpartyName:invoice.counterparty_name||'Supplier not yet specified',logoPath:null});
   res.json(service.save(req.params.id,pdf,{name:'cost-document-'+invoice.invoice_number+'.pdf',kind:'GENERATED',user:req.user}));
 }catch(e){fail(res,e);}});
 app.get('/api/invoices/:id/support-document',auth,permit('ADMIN','MANAGER'),(req,res)=>{try{const {doc,buffer}=service.read(req.params.id);res.setHeader('Content-Type',doc.mime_type);res.setHeader('Content-Disposition','attachment; filename="'+encodeURIComponent(doc.original_name)+'"');res.setHeader('X-Content-Type-Options','nosniff');res.send(buffer);}catch(e){fail(res,e);}});
 return service;
}
module.exports={createInvoiceSupport,registerInvoiceSupportRoutes};
