"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const express=require("express");
const Database=require("better-sqlite3");
const {registerArchiveCenterRoutes}=require("../server/archive-center");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

function makeDb(){
  const db=new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(read("server/schema.sql"));
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status) VALUES('U-ADMIN','Admin','admin@example.test','x','ADMIN','Active')").run();
  return db;
}
async function withArchiveApi(db,fn){
  const app=express();app.use(express.json());
  const auth=(req,_res,next)=>{req.user={id:"U-ADMIN",name:"Admin",role:"ADMIN"};next();};
  const permit=()=>((_req,_res,next)=>next());
  const uploadDir=fs.mkdtempSync(path.join(os.tmpdir(),"kh-duplicate-archive-"));
  registerArchiveCenterRoutes({app,db,auth,permit,audit:()=>{},uploadDir,transactionalEmail:{},notifications:null});
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const base="http://127.0.0.1:"+server.address().port;
  const request=async(url,options={})=>{
    const response=await fetch(base+url,{...options,headers:{"content-type":"application/json",...(options.headers||{})}});
    const payload=await response.json().catch(()=>({}));
    return {status:response.status,payload};
  };
  try{return await fn(request,uploadDir);}
  finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(uploadDir,{recursive:true,force:true});}
}

test("possible duplicate review requires human merge, archives the duplicate and can restore its relationships",async()=>{
  const db=makeDb();
  try{
    const a=Number(db.prepare(`INSERT INTO clients(name,email,phone,address,city,postcode,client_type)
      VALUES('Joan Smith','joan@example.test','212-555-0100','15 Park Avenue','New York','10001','INDIVIDUAL')`).run().lastInsertRowid);
    const b=Number(db.prepare(`INSERT INTO clients(name,email,phone,address,city,postcode,client_type)
      VALUES('Joan Smith','joan@example.test','(212) 555-0100','15 Park Ave','New York','10001','INDIVIDUAL')`).run().lastInsertRowid);
    const piano=Number(db.prepare("INSERT INTO pianos(client_id,brand,model,serial_number) VALUES(?,?,?,?)").run(b,"Steinway & Sons","B","DUP-PIANO-1").lastInsertRowid);
    db.prepare("INSERT INTO master_data_client_source_map(source_name,source_client_id,client_id) VALUES('LEGACY','OLD-77',?)").run(b);

    await withArchiveApi(db,async request=>{
      const candidates=await request("/api/client-duplicates");
      assert.equal(candidates.status,200,JSON.stringify(candidates.payload));
      assert.equal(candidates.payload.pending_count,1);
      const review=candidates.payload.cases[0];
      assert.ok(review.match_fields.includes("name"));
      assert.ok(review.match_fields.includes("email"));
      assert.ok(review.match_fields.includes("phone"));
      assert.equal(review.client_b.relationship_counts.pianos,1);

      const merged=await request("/api/client-duplicates/"+review.id+"/merge",{method:"POST",body:JSON.stringify({primary_client_id:a})});
      assert.equal(merged.status,200,JSON.stringify(merged.payload));
      assert.equal(merged.payload.primary_client_id,a);
      assert.equal(merged.payload.archived_client_id,b);
      assert.ok(db.prepare("SELECT deleted_at FROM clients WHERE id=?").get(b).deleted_at);
      assert.equal(db.prepare("SELECT client_id FROM pianos WHERE id=?").get(piano).client_id,a);
      assert.equal(db.prepare("SELECT client_id FROM master_data_client_source_map WHERE source_name='LEGACY' AND source_client_id='OLD-77'").get().client_id,a);
      const archiveId=merged.payload.archive_document.id;
      assert.equal(db.prepare("SELECT category FROM document_archive WHERE id=?").get(archiveId).category,"deleted_client");

      const search=await request("/api/archive/documents?category=deleted_client&q=joan%40example.test");
      assert.equal(search.status,200);
      assert.equal(search.payload.rows.some(row=>Number(row.id)===Number(archiveId)),true);
      assert.equal(search.payload.rows.find(row=>Number(row.id)===Number(archiveId)).restorable,true);

      const restored=await request("/api/archive/documents/"+archiveId+"/restore-client",{method:"POST",body:"{}"});
      assert.equal(restored.status,200,JSON.stringify(restored.payload));
      assert.equal(restored.payload.restored_client_id,b);
      assert.equal(db.prepare("SELECT deleted_at FROM clients WHERE id=?").get(b).deleted_at,null);
      assert.equal(db.prepare("SELECT client_id FROM pianos WHERE id=?").get(piano).client_id,b);
      assert.equal(db.prepare("SELECT client_id FROM master_data_client_source_map WHERE source_name='LEGACY' AND source_client_id='OLD-77'").get().client_id,b);
      assert.equal(db.prepare("SELECT status FROM client_duplicate_reviews WHERE id=?").get(review.id).status,"NOT_DUPLICATE");

      const after=await request("/api/client-duplicates");
      assert.equal(after.status,200);
      assert.equal(after.payload.pending_count,0);
    });
  }finally{db.close();}
});

test("duplicate review and archive UI expose badge, manual decisions, search and restore controls",()=>{
  const schema=read("server/schema.sql"),archive=read("server/archive-center.js"),app=read("public/app.js"),v6=read("public/v6.js"),css=read("public/styles.css");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS client_duplicate_reviews/);
  assert.match(schema,/status IN \('PENDING','REVIEW_LATER','NOT_DUPLICATE','MERGED','CLEARED'\)/);
  assert.match(archive,/function duplicateCandidates\(/);
  assert.match(archive,/fields\.length<2/);
  assert.match(archive,/app\.get\("\/api\/client-duplicates"/);
  assert.match(archive,/app\.post\("\/api\/client-duplicates\/:id\/merge"/);
  assert.match(archive,/function transferClientRelations\(/);
  assert.match(archive,/source:"merged_duplicate"/);
  assert.match(archive,/app\.post\("\/api\/archive\/documents\/:id\/restore-client"/);
  assert.match(archive,/lower\(COALESCE\(a\.metadata_json,''\)\) LIKE/);
  assert.match(app,/masterToolButton\("DUPLICATES"/);
  assert.match(app,/duplicatePendingCount/);
  assert.match(app,/Not duplicate/);
  assert.match(app,/Review later/);
  assert.match(app,/Documents → Deleted clients/);
  assert.match(v6,/data-archive-restore-client/);
  assert.match(v6,/Search name, email, phone, reference or file/);
  assert.match(css,/master-tool-badge/);
  assert.match(css,/duplicate-compare-grid/);
});
