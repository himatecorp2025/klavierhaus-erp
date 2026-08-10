const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("http");
const express=require("express");
const compression=require("compression");

function request(server){
  return new Promise((resolve,reject)=>{
    const address=server.address();
    const req=http.request({host:"127.0.0.1",port:address.port,path:"/large",headers:{"accept-encoding":"gzip"}},res=>{
      res.resume();
      res.on("end",()=>resolve(res));
    });
    req.on("error",reject);
    req.end();
  });
}

test("compression is installed and compresses a sufficiently large response",async t=>{
  assert.equal(require("compression/package.json").version,"1.8.1");
  const app=express();
  app.use(compression({threshold:1024}));
  app.get("/large",(_req,res)=>res.type("text/plain").send("Klavierhaus ".repeat(1000)));
  const server=await new Promise((resolve,reject)=>{
    const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));
    listener.on("error",reject);
  });
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await request(server);
  assert.equal(response.statusCode,200);
  assert.equal(response.headers["content-encoding"],"gzip");
  assert.match(response.headers.vary||"",/Accept-Encoding/i);
});
