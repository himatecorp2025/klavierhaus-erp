const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const http=require("http");
const os=require("os");
const path=require("path");
const express=require("express");
const {
  createDocumentUpload,
  createBrandingUpload,
  createClientImportUpload,
  createPianoImportUpload,
  uploadErrorHandler
}=require("../server/upload-middleware");

function multipartBody({boundary,filename="file.pdf",mimeType="application/pdf",content=Buffer.from("%PDF-test"),close=true}){
  const head=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const tail=close?Buffer.from(`\r\n--${boundary}--\r\n`):Buffer.alloc(0);
  return Buffer.concat([head,Buffer.isBuffer(content)?content:Buffer.from(content),tail]);
}

function request(server,{method="POST",pathname="/upload",headers={},body=Buffer.alloc(0)}={}){
  return new Promise((resolve,reject)=>{
    const address=server.address();
    const req=http.request({host:"127.0.0.1",port:address.port,path:pathname,method,headers:{...headers,"content-length":body.length}},res=>{
      const chunks=[];
      res.on("data",chunk=>chunks.push(chunk));
      res.on("end",()=>{
        const text=Buffer.concat(chunks).toString("utf8");
        let json=null;
        try{json=JSON.parse(text);}catch(_error){}
        resolve({status:res.statusCode,headers:res.headers,text,json});
      });
    });
    req.on("error",reject);
    req.end(body);
  });
}

async function createTestServer(t,middleware){
  const app=express();
  app.get("/health",(_req,res)=>res.json({ok:true}));
  app.post("/upload",middleware.single("file"),(req,res)=>{
    const response={ok:true,filename:req.file?.originalname||"",size:req.file?.size||0,inMemory:Boolean(req.file?.buffer)};
    if(req.file?.path){try{fs.unlinkSync(req.file.path);}catch(_error){}}
    res.json(response);
  });
  app.use(uploadErrorHandler);
  const server=await new Promise((resolve,reject)=>{
    const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));
    listener.on("error",reject);
  });
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return server;
}

function multipartHeaders(boundary){
  return {"content-type":`multipart/form-data; boundary=${boundary}`};
}

test("the installed Multer release is the approved stable version",()=>{
  assert.equal(require("multer/package.json").version,"2.2.0");
});

test("document upload accepts an allowed PDF file",async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"kh-document-upload-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const server=await createTestServer(t,createDocumentUpload(directory));
  const boundary="kh-document-boundary";
  const response=await request(server,{headers:multipartHeaders(boundary),body:multipartBody({boundary,filename:"invoice.pdf"})});
  assert.equal(response.status,200);
  assert.deepEqual(response.json,{ok:true,filename:"invoice.pdf",size:9,inMemory:false});
});

test("document upload rejects an unsupported extension",async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"kh-document-reject-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const server=await createTestServer(t,createDocumentUpload(directory));
  const boundary="kh-rejected-document";
  const response=await request(server,{headers:multipartHeaders(boundary),body:multipartBody({boundary,filename:"payload.exe",mimeType:"application/octet-stream"})});
  assert.equal(response.status,400);
  assert.match(response.json.error,/Only PDF, JPG, JPEG or PNG/);
});

test("client and piano XLSX imports remain in memory and accept XLSX files",async t=>{
  for(const [name,middleware] of [["client",createClientImportUpload()],["piano",createPianoImportUpload()]]){
    await t.test(name,async child=>{
      const server=await createTestServer(child,middleware);
      const boundary=`kh-${name}-xlsx`;
      const response=await request(server,{headers:multipartHeaders(boundary),body:multipartBody({boundary,filename:`${name}.xlsx`,mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",content:"xlsx"})});
      assert.equal(response.status,200);
      assert.equal(response.json.inMemory,true);
      assert.equal(response.json.filename,`${name}.xlsx`);
    });
  }
});

test("client and piano imports reject non-XLSX files",async t=>{
  for(const [name,middleware] of [["client",createClientImportUpload()],["piano",createPianoImportUpload()]]){
    await t.test(name,async child=>{
      const server=await createTestServer(child,middleware);
      const boundary=`kh-${name}-csv`;
      const response=await request(server,{headers:multipartHeaders(boundary),body:multipartBody({boundary,filename:`${name}.csv`,mimeType:"text/csv",content:"not,xlsx"})});
      assert.equal(response.status,400);
      assert.equal(response.json.error,"INVALID_EXCEL_FILE");
    });
  }
});

test("branding upload accepts a PNG and writes it through disk storage",async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"kh-branding-upload-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const server=await createTestServer(t,createBrandingUpload(directory));
  const boundary="kh-branding-boundary";
  const response=await request(server,{headers:multipartHeaders(boundary),body:multipartBody({boundary,filename:"logo.png",mimeType:"image/png",content:Buffer.from([0x89,0x50,0x4e,0x47])})});
  assert.equal(response.status,200);
  assert.equal(response.json.inMemory,false);
  assert.equal(response.json.filename,"logo.png");
});

test("branding upload rejects unsupported image formats",async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"kh-branding-reject-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const server=await createTestServer(t,createBrandingUpload(directory));
  const boundary="kh-branding-svg";
  const response=await request(server,{headers:multipartHeaders(boundary),body:multipartBody({boundary,filename:"logo.svg",mimeType:"image/svg+xml",content:"<svg/>"})});
  assert.equal(response.status,400);
  assert.equal(response.json.error,"INVALID_FILE_TYPE");
  assert.deepEqual(fs.readdirSync(directory),[]);
});

test("document upload enforces its 20 MiB file-size limit",async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"kh-document-limit-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const server=await createTestServer(t,createDocumentUpload(directory));
  const boundary="kh-oversized-document";
  const response=await request(server,{headers:multipartHeaders(boundary),body:multipartBody({boundary,filename:"large.pdf",content:Buffer.alloc(20*1024*1024+1,1)})});
  assert.equal(response.status,400);
  assert.equal(response.json.error,"FILE_TOO_LARGE");
  assert.deepEqual(fs.readdirSync(directory),[]);
});

test("malformed multipart data returns a controlled error and does not stop the server",async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"kh-malformed-upload-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const server=await createTestServer(t,createDocumentUpload(directory));
  const boundary="kh-incomplete-multipart";
  const malformed=multipartBody({boundary,filename:"broken.pdf",close:false});
  const failed=await request(server,{headers:multipartHeaders(boundary),body:malformed});
  assert.equal(failed.status,400);
  assert.equal(failed.json.error,"INVALID_MULTIPART_FORM");
  const health=await request(server,{method:"GET",pathname:"/health"});
  assert.equal(health.status,200);
  assert.deepEqual(health.json,{ok:true});
});

test("production upload routes keep authentication and role checks before Multer",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"../server/index.js"),"utf8");
  assert.match(source,/app\.post\('\/api\/imports\/clients\/analyze',auth,permit\('ADMIN'\),clientImportUpload\.single\('file'\)/);
  assert.match(source,/app\.post\('\/api\/imports\/pianos\/analyze',auth,permit\('ADMIN'\),pianoImportUpload\.single\('file'\)/);
  assert.match(source,/app\.post\('\/api\/settings\/branding\/logo',auth,permit\('ADMIN'\),brandingUpload\.single\('logo'\)/);
  assert.match(source,/app\.post\('\/api\/settings\/branding\/background',auth,permit\('ADMIN'\),brandingUpload\.single\('background'\)/);
  assert.match(source,/app\.post\("\/api\/jobs\/:id\/close", auth, upload\.single\("file"\)/);
});
