"use strict";
// Explicit, authenticated test-data reset. No automatic cleanup and no deletion audit.
// Immutable guards are suspended only inside the same SQLite transaction and restored
// before COMMIT. All other callers retain the original immutable financial contract.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const error=(code,status=400)=>Object.assign(new Error(code),{code,status});
const isSuper=u=>u&&(u.role==='SUPERADMIN'||Number(u.is_superadmin)===1);
const TABLES=['invoice_items','invoice_adjustments','invoice_credit_memos','invoice_supporting_documents','invoices','financial_item_adjustments','financial_item_voids','financial_items','journal_lines','journal_entries','workflow_finance_closures','workflow_finance_lines','workflow_finance_phases','workflow_finance_sources','financial_statement_snapshots','opening_balance_items','opening_balance_sets','invoice_sequences','credit_memo_sequences'];
const quoted=name=>'"'+String(name).replace(/"/g,'""')+'"';
function createFinanceReset({db,uploadDir}){
 const previews=new Map();
 const exists=t=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 const rows=t=>exists(t)?db.prepare('SELECT * FROM '+quoted(t)).all():[];
 const auth=u=>{if(!isSuper(u)||!isSuper(db.prepare("SELECT * FROM users WHERE id=? AND status='Active'").get(u.id)))throw error('SUPERADMIN_REQUIRED',403);};
 function snapshot(){const s={};for(const t of TABLES)s[t]=rows(t);s.jobs=rows('jobs');s.event_payments=rows('event_payments');s.event_tickets=rows('event_tickets');return s;}
 function fingerprint(s){return crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');}
 function catalog(u){auth(u);return {invoices:rows('invoices').map(r=>({id:r.id,label:r.invoice_number+' | '+r.summary,amount:r.total_amount,direction:r.direction})),items:rows('financial_items').map(r=>({id:r.id,label:r.title,amount:r.amount,direction:r.main_type})),journals:rows('journal_entries').map(r=>({id:r.id,label:r.description,amount:null})),opening_balances:rows('opening_balance_sets').length};}
 function plan(selection,s){
   if(!selection||typeof selection!=='object')throw error('FINANCE_RESET_SELECTION_REQUIRED');
   const all=selection.all===true,I=new Set(),F=new Set(),J=new Set(),W=new Set(),Jobs=new Set(),P=new Set(),T=new Set();
   const seed=(values,table,set)=>{if(values===undefined)return;if(!Array.isArray(values)||values.length>1000)throw error('FINANCE_RESET_INVALID_SELECTION');for(const id of values){if(typeof id!=='string'||!s[table].some(r=>r.id===id))throw error('FINANCE_RESET_RECORD_NOT_FOUND',404);set.add(id);}};
   seed(selection.invoice_ids,'invoices',I);seed(selection.item_ids,'financial_items',F);seed(selection.journal_ids,'journal_entries',J);
   if(all){for(const r of s.invoices)I.add(r.id);for(const r of s.financial_items)F.add(r.id);for(const r of s.journal_entries)J.add(r.id);for(const r of s.workflow_finance_sources)W.add(r.id);}
   if(!all&&!I.size&&!F.size&&!J.size)throw error('FINANCE_RESET_SELECTION_REQUIRED');
   const add=(set,val)=>{if(val)set.add(String(val));};
   const sourceMatches=(source,sets)=>sets.some(set=>[...set].some(id=>source===id||source.endsWith(':'+id)));
   let size=-1;
   while(size!==I.size+F.size+J.size+W.size+Jobs.size+P.size+T.size){
     size=I.size+F.size+J.size+W.size+Jobs.size+P.size+T.size;
     for(const i of s.invoices){
       if(I.has(i.id)){
         if(i.source_type==='workflow'){if(String(i.source_id).startsWith('WORKFLOW_LINE:')){const l=s.workflow_finance_lines.find(l=>l.id===i.source_id.slice(14));if(l)add(W,l.workflow_id);}else add(W,i.source_id);}
         if(i.source_type==='job')add(Jobs,i.source_id);
       }
       if((i.source_type==='workflow'&&W.has(i.source_id))||(i.source_type==='job'&&Jobs.has(i.source_id)))I.add(i.id);
     }
     for(const r of s.workflow_finance_sources)if(W.has(r.id)){add(I,r.invoice_id);add(Jobs,r.job_id);}
     for(const l of s.workflow_finance_lines){
       if(I.has(l.payable_invoice_id)||F.has(l.posted_financial_item_id)||[l.wip_journal_entry_id,l.final_journal_entry_id,l.writeoff_journal_entry_id].some(v=>J.has(v)))W.add(l.workflow_id);
       if(W.has(l.workflow_id)){add(I,l.payable_invoice_id);add(F,l.posted_financial_item_id);for(const v of [l.wip_journal_entry_id,l.final_journal_entry_id,l.writeoff_journal_entry_id])add(J,v);}
     }
     for(const j of s.jobs){if(I.has(j.invoice_id)||F.has(j.financial_ledger_id))Jobs.add(j.id);if(Jobs.has(j.id)){add(I,j.invoice_id);add(F,j.financial_ledger_id);}}
     for(const j of s.journal_entries){if(J.has(j.id))add(Jobs,j.job_id);if(Jobs.has(j.job_id))J.add(j.id);}
     for(const p of s.event_payments){if(I.has(p.invoice_id))P.add(p.id);if(P.has(p.id))add(I,p.invoice_id);}
     for(const t of s.event_tickets){if(I.has(t.invoice_id)||P.has(t.event_payment_id))T.add(t.id);if(T.has(t.id)){add(I,t.invoice_id);add(P,t.event_payment_id);}}
     for(const f of s.financial_items){
       if(F.has(f.id)){add(Jobs,f.job_id);const id=String(f.source_id||'');if(f.source_type==='WORKFLOW_INVOICE_REVENUE')add(W,id.replace(/^WORKFLOW_INVOICE_REVENUE:/,''));if(f.source_type==='MANUAL_INVOICE')add(I,id);if(f.source_type==='event_payment')add(P,id);if(f.source_type==='EVENT_PAYMENT_REFUND')add(P,id.replace(/^EVENT_PAYMENT_REFUND:/,''));if(f.source_type==='EVENT_MANUAL_TICKET_REFUND')add(T,id.replace(/^EVENT_MANUAL_TICKET_REFUND:/,''));}
       if(Jobs.has(f.job_id)||sourceMatches(String(f.source_id||''),[I,W,Jobs,P,T]))F.add(f.id);
     }
     for(const r of [...s.financial_item_adjustments,...s.financial_item_voids])if([r.financial_item_id,r.reversal_item_id,r.replacement_item_id].some(id=>F.has(id)))for(const v of [r.financial_item_id,r.reversal_item_id,r.replacement_item_id])add(F,v);
   }
   const selected={};const choose=(t,fn)=>selected[t]=s[t].filter(fn);
   choose('invoices',r=>I.has(r.id));for(const t of ['invoice_items','invoice_adjustments','invoice_credit_memos','invoice_supporting_documents'])choose(t,r=>I.has(r.invoice_id));
   choose('financial_items',r=>F.has(r.id));for(const t of ['financial_item_adjustments','financial_item_voids'])choose(t,r=>F.has(r.financial_item_id)||F.has(r.reversal_item_id)||F.has(r.replacement_item_id));
   choose('journal_entries',r=>J.has(r.id));choose('journal_lines',r=>J.has(r.entry_id));
   choose('workflow_finance_sources',r=>W.has(r.id));for(const t of ['workflow_finance_phases','workflow_finance_lines','workflow_finance_closures'])choose(t,r=>W.has(r.workflow_id));
   choose('financial_statement_snapshots',()=>true);for(const t of ['opening_balance_items','opening_balance_sets','invoice_sequences','credit_memo_sequences'])choose(t,()=>all);
   return {all,I,F,J,W,Jobs,P,T,selected};
 }
 function summary(p){return {all:p.all,counts:Object.fromEntries(Object.entries(p.selected).map(([k,v])=>[k,v.length])),invoices:p.selected.invoices.map(r=>({id:r.id,number:r.invoice_number,title:r.summary,total:r.total_amount})),affected_workflows:[...p.W],affected_jobs:[...p.Jobs],notice:'Linked financial records are deleted together. Contacts, instruments, users and operational workflows are retained. Closed report snapshots are invalidated.'};}
 function preview(selection,u){auth(u);for(const [k,v]of previews)if(v.expires<Date.now())previews.delete(k);if(previews.size>100)previews.clear();const s=snapshot(),p=plan(selection,s),token=crypto.randomBytes(24).toString('hex');previews.set(token,{uid:u.id,selection:JSON.parse(JSON.stringify(selection)),hash:fingerprint(s),expires:Date.now()+5*60000});return {token,...summary(p)};}
 function documentFiles(p){
   if(!uploadDir)return [];
   const root=path.resolve(uploadDir),out=new Set();
   const add=relative=>{const absolute=path.resolve(root,relative);if(!absolute.startsWith(root+path.sep))throw error('FINANCE_DOCUMENT_PATH_INVALID');if(fs.existsSync(absolute)&&fs.statSync(absolute).isFile())out.add(absolute);};
   for(const d of p.selected.invoice_supporting_documents)add(path.join('invoice-support',path.basename(d.stored_name)));
   for(const i of p.selected.invoices){if(!/^[a-zA-Z0-9_-]+$/.test(i.id))continue;add(path.join('documents',`central-invoice-${i.id}.pdf`));}
   return [...out];
 }
 function clearPlan(p){
   const protectedTables=new Set([...TABLES,'audit_log']);
   const triggers=db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL").all().filter(t=>protectedTables.has(t.tbl_name));
   for(const t of triggers)db.exec('DROP TRIGGER '+quoted(t.name));
   // Clear pointers before deleting financial parents. No reset action is logged.
   const hasColumn=(t,c)=>exists(t)&&db.pragma('table_info('+quoted(t)+')').some(r=>r.name===c);
   for(const id of p.I){for(const table of ['jobs','event_payments','event_tickets'])if(hasColumn(table,'invoice_id'))db.prepare(`UPDATE ${quoted(table)} SET invoice_id=NULL,finance_reset=1 WHERE invoice_id=?`).run(id);}
   for(const id of p.W){if(exists('wf2_workflows'))db.prepare("UPDATE wf2_workflows SET invoice_id=NULL,finance_reset=CASE WHEN finance_locked=1 OR EXISTS(SELECT 1 FROM workflow_finance_lines l WHERE l.workflow_id=wf2_workflows.id AND (l.wip_journal_entry_id IS NOT NULL OR l.final_journal_entry_id IS NOT NULL OR l.payable_invoice_id IS NOT NULL OR l.writeoff_journal_entry_id IS NOT NULL)) THEN 1 ELSE finance_reset END WHERE id=?").run(id);}
   for(const id of p.Jobs)db.prepare("UPDATE jobs SET invoice_id=NULL,invoice_number=NULL,invoice_status=NULL,financial_ledger_id=NULL,finance_reset=1 WHERE id=?").run(id);
   for(const id of p.P)db.prepare('UPDATE event_payments SET invoice_id=NULL,finance_reset=1 WHERE id=?').run(id);
   for(const id of p.T)db.prepare('UPDATE event_tickets SET invoice_id=NULL,finance_reset=1 WHERE id=?').run(id);
   // Reverse ordering explicitly respects RESTRICT references.
   for(const t of ['invoice_supporting_documents','invoice_credit_memos','invoice_adjustments','invoice_items','financial_item_adjustments','financial_item_voids','workflow_finance_closures','workflow_finance_lines','workflow_finance_phases','workflow_finance_sources','journal_lines','journal_entries','invoices','financial_items']){
     const columns=exists(t)?db.pragma('table_info('+quoted(t)+')'):[];const pk=columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
     if(!pk.length&&p.selected[t].length)throw error('FINANCE_RESET_UNSUPPORTED_TABLE',500);
     if(pk.length){const remove=db.prepare(`DELETE FROM ${quoted(t)} WHERE ${pk.map(c=>quoted(c)+'=?').join(' AND ')}`);for(const row of p.selected[t])remove.run(...pk.map(c=>row[c]));}
   }
   for(const t of ['financial_statement_snapshots',...(p.all?['opening_balance_items','opening_balance_sets','invoice_sequences','credit_memo_sequences']:[])])if(exists(t))db.prepare('DELETE FROM '+quoted(t)).run();
   if(exists('audit_log')){
     if(p.all)db.prepare("DELETE FROM audit_log WHERE audit_type='FINANCIAL'").run();
     else{const del=db.prepare("DELETE FROM audit_log WHERE audit_type='FINANCIAL' AND record_id=?");for(const id of new Set([...p.I,...p.F,...p.J,...p.W]))del.run(id);}
   }
   for(const trigger of triggers)db.exec(trigger.sql);
   const integrity=db.pragma('foreign_key_check');if(integrity.length)throw error('FINANCE_RESET_FOREIGN_KEY_FAILURE',409);
 }
 function execute(body,u){
   auth(u);if(body?.confirmed!==true)throw error('FINANCE_RESET_CONFIRMATION_REQUIRED');
   const entry=previews.get(body.token);if(!entry||entry.uid!==u.id||entry.expires<Date.now())throw error('FINANCE_RESET_PREVIEW_EXPIRED',409);
   let staged=[],dir=null,result;
   try{
     const tx=db.transaction(()=>{
       const s=snapshot();if(fingerprint(s)!==entry.hash)throw error('FINANCE_RESET_DATA_CHANGED',409);
       const p=plan(entry.selection,s);const originals=documentFiles(p);
       if(originals.length){dir=fs.mkdtempSync(path.join(path.resolve(uploadDir),'.finance-reset-'));for(const file of originals){const target=path.join(dir,String(staged.length));fs.renameSync(file,target);staged.push({file,target});}}
       clearPlan(p);result=summary(p);
     });tx.immediate();
   }catch(err){for(const f of staged.reverse())if(fs.existsSync(f.target))fs.renameSync(f.target,f.file);if(dir)fs.rmSync(dir,{recursive:true,force:true});throw err;}
   if(dir)fs.rmSync(dir,{recursive:true,force:true});previews.delete(body.token);return {ok:true,...result};
 }
 return {catalog,preview,execute};
}
function registerFinanceResetRoutes({app,db,auth,requireSuperadmin,uploadDir}){
 const service=createFinanceReset({db,uploadDir});const wrap=fn=>(req,res)=>{try{res.json(fn(req));}catch(e){res.status(e.status||500).json({error:e.code||e.message});}};
 app.get('/api/finance/reset/catalog',auth,requireSuperadmin,wrap(req=>service.catalog(req.user)));
 app.post('/api/finance/reset/preview',auth,requireSuperadmin,wrap(req=>service.preview(req.body,req.user)));
 app.post('/api/finance/reset/execute',auth,requireSuperadmin,wrap(req=>service.execute(req.body,req.user)));
 return service;
}
module.exports={createFinanceReset,registerFinanceResetRoutes};
