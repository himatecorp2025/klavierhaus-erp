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

const EXPECTED={
 finance_invoicing:["finance","income_statement","invoice_documents"],
 technical:["audit_log","backups","pianos","contacts","closed_jobs","knowledge_base","company_data","inventory","partners","planned_jobs","scheduler","website_services","settings","system_integrations","users","workshop_workflow"],
 marketing:["marketing_overview","customer_inbox","website_reviews","campaigns_utm","leads","tracking_cookies","seo_keywords","heatmap"],
 website_events:["website_artists","website_contacts","digital_attendance","events","event_guest_list","event_invitations","media_library","pages_content","publish_preview","showroom_pianos","event_tickets"]
};

test("the four admin groups contain all 38 cards in the approved locations",()=>{
  const app=read("public/app.js");
  const finance=items(groupBlock(app,"finance_invoicing","technical"));
  const technical=items(groupBlock(app,"technical","marketing"));
  const marketing=items(groupBlock(app,"marketing","website_events"));
  const website=items(groupBlock(app,"website_events",null));
  assert.deepEqual(finance.map(x=>x[0]),EXPECTED.finance_invoicing);
  assert.equal(finance[0][1],"Balance Sheet");
  assert.equal(finance[2][1],"Invoices Documents");
  assert.equal(technical[5][1],"Company Documents Archive");
  assert.deepEqual(technical.map(x=>x[0]),EXPECTED.technical);
  assert.deepEqual(marketing.map(x=>x[0]),EXPECTED.marketing);
  assert.deepEqual(website.map(x=>x[0]),EXPECTED.website_events);
  assert.equal(finance.length+technical.length+marketing.length+website.length,38);
  assert.doesNotMatch(app,/Landing Page Design|landing_page_design/);
});

test("Balance Sheet, Income Statement, Invoices Documents and Company Documents Archive stay separate",()=>{
  const app=read("public/app.js");
  const html=read("public/index.html");
  assert.match(app,/async function renderFinance\(selectedMonth=""\)/);
  assert.match(app,/async function renderInvoiceDocuments\(selectedMonth=""\)/);
  assert.match(app,/else if\(v==="invoice_documents"\) await renderInvoiceDocuments\(\)/);
  assert.match(app,/Open Invoices Documents/);
  assert.match(app,/Create Invoice \/ Bill/);
  assert.match(app,/async function renderIncomeStatement/);
  assert.match(app,/async function renderCompanyDocumentsArchive/);
  for(const id of ["finance","income_statement","invoice_documents","knowledge_base"]) assert.match(html,new RegExp(`id="${id}"`));
});

test("server activation registry contains exactly the same 38 card keys and groups",()=>{
  const index=read("server/index.js");
  const a=index.indexOf("const ADMIN_MODULE_CARDS = Object.freeze([");
  const b=index.indexOf("]);",a);
  const block=index.slice(a,b);
  const cards=[...block.matchAll(/\{ key: "([^"]+)", group_key: "([^"]+)"/g)].map(m=>({key:m[1],group:m[2]}));
  assert.equal(cards.length,38);
  for(const [group,keys] of Object.entries(EXPECTED)) assert.deepEqual(cards.filter(x=>x.group===group).map(x=>x.key),keys);
  assert.match(index,/invoice_documents\.view/);
});

test("inactive-card visibility remains Superadmin-only while other users never see disabled cards",()=>{
  const app=read("public/app.js");
  const index=read("server/index.js");
  assert.match(app,/if\(!group\|\|isSuperadmin\(\)\)return true/);
  assert.match(app,/visibleItems=group\.items\.filter\(\(\[view\]\)=>isSuperadmin\(\)\|\|adminCardIsEnabled\(group\.id,view\)\)/);
  assert.match(app,/admin-ia-card \$\{enabled\?'':'is-disabled'\}/);
  assert.match(app,/isSuperadmin\(\)\?`<button[^`]+data-admin-card-toggle/);
  assert.match(index,/can_toggle:canToggle/);
  assert.match(index,/if\(!isSuperadminUser\(req\.user\)\) return res\.status\(403\)/);
  assert.doesNotMatch(app,/superadmin[_ -]?cards/i);
  assert.doesNotMatch(index,/superadmin[_ -]?cards/i);
});
