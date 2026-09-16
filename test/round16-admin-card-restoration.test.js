const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname,"..");
const read = p => fs.readFileSync(path.join(root,p),"utf8");

function groupBlock(app,id,next){
  const a=app.indexOf(`{id:"${id}"`);
  const b=next?app.indexOf(`{id:"${next}"`,a):app.indexOf("\n ]}\n];",a)+5;
  assert.ok(a>=0 && b>a,`group ${id}`);
  return app.slice(a,b);
}
function items(block){ return [...block.matchAll(/\["([a-z_]+)","([^"]+)"/g)].map(m=>[m[1],m[2]]); }

test("the four admin groups retain all 37 original cards",()=>{
  const app=read("public/app.js");
  const finance=items(groupBlock(app,"finance_invoicing","technical"));
  const technical=items(groupBlock(app,"technical","marketing"));
  const marketing=items(groupBlock(app,"marketing","website_events"));
  const website=items(groupBlock(app,"website_events",null));
  assert.deepEqual(finance.map(x=>x[0]),["finance","income_statement","knowledge_base"]);
  assert.equal(finance[2][1],"Invoices & Documents");
  assert.deepEqual(technical.map(x=>x[0]),["workshop_workflow","scheduler","planned_jobs","contacts","pianos","inventory","partners","closed_jobs","users","audit_log","backups","settings","company_data","system_integrations"]);
  assert.deepEqual(marketing.map(x=>x[0]),["marketing_overview","website_reviews","campaigns_utm","leads","tracking_cookies","seo_keywords","heatmap"]);
  assert.deepEqual(website.map(x=>x[0]),["pages_content","website_services","showroom_pianos","website_artists","media_library","events","event_tickets","event_invitations","event_guest_list","digital_attendance","website_contacts","customer_inbox","publish_preview"]);
  assert.equal(finance.length+technical.length+marketing.length+website.length,37);
  assert.doesNotMatch(app,/\["invoice_documents","Invoices Documents"/);
});

test("Finance and Income Statement use the working 25-2 render contracts",()=>{
  const app=read("public/app.js");
  assert.match(app,/async function renderFinance\(selectedMonth=""\)[\s\S]*\/api\/invoices\?month=/);
  assert.match(app,/id="invoiceMonth"[\s\S]*openManualInvoiceModal/);
  assert.match(app,/async function renderFinanceMonth\(month\)\{await renderFinance/);
  assert.match(app,/Cashflow-style monthly business overview/);
  assert.match(app,/Employee Daily Rates/);
  assert.doesNotMatch(app,/else if\(v==="invoice_documents"\)/);
  assert.doesNotMatch(app,/function renderInvoiceDocuments|async function renderInvoiceDocuments/);
  assert.match(app,/saveManualInvoice[\s\S]*await renderFinance\(String\(created\.issue_date/);
});

test("server module activation registry also contains exactly the restored 37 cards",()=>{
  const index=read("server/index.js");
  const a=index.indexOf("const ADMIN_MODULE_CARDS = Object.freeze([");
  const b=index.indexOf("]);",a);
  const block=index.slice(a,b);
  const cards=[...block.matchAll(/\{ key: "([^"]+)", group_key: "([^"]+)"/g)].map(m=>({key:m[1],group:m[2]}));
  assert.equal(cards.length,37);
  assert.deepEqual(cards.filter(x=>x.group==="finance_invoicing").map(x=>x.key),["finance","income_statement","knowledge_base"]);
  assert.ok(cards.some(x=>x.key==="partners"&&x.group==="technical"));
  assert.ok(!cards.some(x=>x.key==="invoice_documents"));
  assert.doesNotMatch(index,/invoice_documents\.view/);
});

test("the duplicate invoice_documents view is removed and the original three views remain",()=>{
  const html=read("public/index.html");
  for(const id of ["knowledge_base","finance","income_statement"]) assert.match(html,new RegExp(`id="${id}"`));
  assert.doesNotMatch(html,/id="invoice_documents"/);
});
