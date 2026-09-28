"use strict";

const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
function gitBlobSha(file){
  const data=fs.readFileSync(path.join(root,file));
  return crypto.createHash("sha1").update(Buffer.from(`blob ${data.length}\0`)).update(data).digest("hex");
}

test("zero-modification protected website server modules are byte-identical to Round 1 base",()=>{
  const expected={
    "server/website-platform.js":"8a10313eb02bdd41fdc434d1f5a9bdbe7ca7d1e7",
    "server/website-content.js":"3886ff1e4b4261dd8512781fc833c6c8cd796ce5",
    "server/website-catalog.js":"18ebe2d0663d2c4dfd995f1732a504b6555a8b98",
    "server/upload-middleware.js":"64444c043a3a1b646032a5ca5c10569d37806938"
  };
  for(const [file,sha] of Object.entries(expected))assert.equal(gitBlobSha(file),sha,`${file} changed despite zero-modification policy`);
});

test("schema preserves public/auth and Round 1 master-data while Round 2 adds central jobs",()=>{
  const schema=read("server/schema.sql");
  for(const table of ["clients","pianos","intake_leads","users","events","website_content_pages","website_showroom_pianos","website_services","website_artists","website_media"]){
    assert.match(schema,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
  }
  for(const table of ["planned_jobs","inventory_items","workflow_finance_sources","financial_items","invoices","partners"]){
    assert.doesNotMatch(schema,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
  }
  assert.match(schema,/idx_pianos_client/);
  assert.match(schema,/idx_intake_status/);
  assert.match(schema,/assigned_technician_id TEXT/);
});

test("clean server wiring contains Round 1 and website routes but no retired ERP route registries",()=>{
  const source=read("server/index.js");
  assert.match(source,/registerRound1CoreRoutes/);
  assert.match(source,/registerWebsiteContentRoutes/);
  assert.match(source,/registerWebsiteCatalogRoutes/);
  assert.match(source,/registerWebsitePlatformRoutes/);
  assert.match(source,/registerEventRoutes/);
  assert.doesNotMatch(source,/registerWorkshopWorkflowRoutes|registerWorkflowV2|registerBusinessOperationsRoutes|registerFinanceResetRoutes|createJobDomain|createHimateExportAdapter/);
  assert.doesNotMatch(source,/\/api\/planned-jobs|\/api\/inventory|\/api\/financial-items|\/api\/jobs/);
});

test("Round 1 PWA exposes active modules and keeps future modules visibly disabled",()=>{
  const html=read("public/index.html"),app=read("public/app.js"),css=read("public/styles.css"),sw=read("public/service-worker.js");
  for(const label of ["Igényfelmérés","Törzsadatok","Weboldal CMS","Műhely &amp; Naptár","Tervezett munkák"])assert.ok(html.includes(label));
  assert.ok(html.includes("3. kör"));
  assert.match(css,/min-height:48px/);
  assert.match(css,/\.mobile-nav/);
  assert.match(css,/@media\(display-mode:standalone\)/);
  assert.match(app,/\/api\/intake/);
  assert.match(app,/\/api\/clients/);
  assert.match(app,/\/api\/website-content\/image/);
  assert.match(sw,/url\.pathname\.startsWith\("\/api\/"\)/);
});
