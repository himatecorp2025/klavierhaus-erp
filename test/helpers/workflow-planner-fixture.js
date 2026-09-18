'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const Database=require('better-sqlite3');
function fixture(){
 const root=path.resolve(__dirname,'../..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'kh44-planner-')),file=path.join(folder,'db.sqlite');
 const init=spawnSync(process.execPath,['server/init-db.js'],{cwd:root,env:{...process.env,DB_PATH:file,BACKUP_DIR:path.join(folder,'backups')},encoding:'utf8'});
 if(init.status!==0)throw new Error(init.stderr||init.stdout);
 const db=new Database(file);db.pragma('foreign_keys=ON');db.pragma('journal_mode=WAL');
 for(const [id,name,role,sa] of [['C','Creator','WORKER',0],['M','Main responsible','MANAGER',0],['F','Phase responsible','WORKER',0],['T','Task worker','WORKER',0],['T2','Second worker','WORKER',0],['X','Unrelated worker','WORKER',0],['A','Administrator','ADMIN',0],['S','Superadmin','ADMIN',1]]){
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,is_superadmin,status) VALUES(?,?,?,'fixture-only',?,?,'Active')").run(id,name,id+'@example.invalid',role,sa);
 }
 db.exec(`INSERT INTO contacts(id,name,email,phone,address) VALUES('CL','Alex Example','alex@example.invalid','+12125550101','Billing address'),('CL2','Alex Example','different@example.invalid','+12125550102','Other billing address'),('EMPTY','No Piano Client','','','No piano address');
  INSERT INTO pianos(id,brand,model,owner_contact_id,location) VALUES('P1','Steinway & Sons','B-211','CL','Studio address'),('P2','Steinway & Sons','B-211','CL','Home address'),('OTHER','Bosendorfer','200','CL2','Other place');
  INSERT INTO client_pianos(id,client_id,piano_id,location_name,piano_location_address) VALUES('CP1','CL','P1','Studio','Studio address'),('CP2','CL','P2','Home','Home address'),('CP3','CL2','OTHER','Other','Other place');`);
 require('../../server/workshop-workflow').registerWorkshopWorkflowRoutes({app:new Proxy({},{get:()=>()=>{}}),db,auth:()=>{},permit:()=>()=>{}});
 const invoiceEngine=require('../../server/business-operations').createInvoiceEngine({db});
 const engine=require('../../server/workflow-v2').createWorkflowV2({db,invoiceEngine});
 const ensurePianoBrand=brand=>{db.prepare('INSERT OR IGNORE INTO piano_brands(brand_name,active) VALUES(?,1)').run(brand);return brand;};
 const ensurePianoModel=(brand,model)=>{db.prepare('INSERT OR IGNORE INTO piano_model_catalog(brand_name,model_name,active) VALUES(?,?,1)').run(brand,model);return model;};
 const piano=require('../../server/piano-master-data').createPianoMasterData({db,ensurePianoBrand,ensurePianoModel,lookup:values=>require('../../server/piano-reference-engine').centralPianoLookup(db,{...values,currentYear:2026})});
 const user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
 const task=(extra={})=>({title:'Key repair',assignee_ids:['T','T2'],due_at:'2027-10-05T12:00',...extra});
 const body=(extra={})=>({title:'Restoration',client_id:'CL',piano_id:'P1',main_responsible_user_id:'M',start_at:'2027-10-01T09:00',final_due_at:'2027-10-10T17:00',phases:[{stage_code:'MECHANICS',responsible_user_id:'F',due_at:'2027-10-06T17:00',enabled:true,tasks:[task()]}],...extra});
 const create=(extra={},actor='C')=>engine.create(body(extra),user(actor));
 const snapshot=()=>JSON.stringify(Object.fromEntries(['wf2_workflows','wf2_phases','workshop_subtasks','wf2_task_assignees','jobs','wf2_calendar_links','wf2_audit','pianos','client_pianos','contacts','journal_entries','journal_lines','piano_brands','piano_model_catalog'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 return {db,engine,piano,user,task,body,create,snapshot,invoiceEngine,folder,close(){db.close();fs.rmSync(folder,{recursive:true,force:true});}};
}
module.exports={fixture};
