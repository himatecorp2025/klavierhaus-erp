const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=read("public/app.js"), index=read("server/index.js"), workflow=read("server/workshop-workflow.js"), business=read("server/business-operations.js"), styles=read("public/styles.css"), html=read("public/index.html");

const cards=[
 ["finance","finance_invoicing","renderFinance"],["income_statement","finance_invoicing","renderIncomeStatement"],["invoice_documents","finance_invoicing","renderInvoiceDocuments"],["knowledge_base","finance_invoicing","resource"],
 ["audit_log","technical","renderAuditLog"],["backups","technical","renderBackupsView"],["pianos","technical","renderPianos"],["contacts","technical","resource"],["closed_jobs","technical","renderClosedJobs"],["company_data","technical","renderCompanyData"],["inventory","technical","renderInventory"],["partners","technical","renderPartners"],["planned_jobs","technical","renderPlannedJobs"],["scheduler","technical","renderScheduler"],["website_services","technical","renderWebsiteServices"],["settings","technical","renderSettings"],["system_integrations","technical","renderSystemIntegrations"],["users","technical","renderUsers"],["workshop_workflow","technical","renderWorkshopWorkflow"],
 ["marketing_overview","marketing","renderMarketingOverview"],["customer_inbox","marketing","renderCustomerInbox"],["website_reviews","marketing","renderWebsiteReviews"],["campaigns_utm","marketing","renderMarketingCampaigns"],["leads","marketing","renderWebsiteLeads"],["tracking_cookies","marketing","renderMarketingIntegrations"],["seo_keywords","marketing","renderMarketingSeo"],["heatmap","marketing","renderMarketingHeatmap"],
 ["website_artists","website_events","renderWebsiteArtists"],["website_contacts","website_events","renderWebsiteLeads"],["digital_attendance","website_events","renderDigitalAttendance"],["events","website_events","renderEvents"],["event_guest_list","website_events","renderGuestData"],["event_invitations","website_events","renderEventWorkspace"],["media_library","website_events","renderWebsiteMedia"],["pages_content","website_events","renderWebsiteDesign"],["publish_preview","website_events","renderPublishPreview"],["showroom_pianos","website_events","renderShowroomPianos"],["event_tickets","website_events","renderEventWorkspace"]
];

test("all 38 cards have frontend routes/resources and backend activation entries",()=>{
 assert.equal(cards.length,38);
 const serverCards=new Map([...index.matchAll(/\{ key: "([^"]+)", group_key: "([^"]+)"/g)].map(m=>[m[1],m[2]]));
 for(const [key,group,renderer] of cards){
   assert.equal(serverCards.get(key),group,`${key}: backend activation group`);
   assert.ok(app.includes(`["${key}"`),`${key}: frontend card`);
   if(renderer==="resource") assert.ok(app.includes(`${key}:{api:`),`${key}: resource config`);
   else assert.ok(app.includes(renderer),`${key}: renderer ${renderer}`);
 }
 assert.equal(serverCards.size,38);
});

test("Finance & Invoicing has four independent workspaces and purge is wired only for Superadmin",()=>{
 assert.match(html,/id="invoice_documents"/);
 assert.match(app,/function openPurgeAllInvoicesModal\(\)/);
 assert.match(app,/Purge All Invoices & Bills/);
 assert.match(app,/Delete All Invoices & Financial Records\?/);
 assert.match(app,/Yes, Permanently Delete All/);
 assert.match(app,/if\(!isSuperadmin\(\)\)return showError\(\{message:'SUPERADMIN_REQUIRED'\}\)/);
 assert.match(app,/api\("\/api\/invoices\/purge-all"/);
 assert.match(business,/app\.post\("\/api\/invoices\/purge-all"/);
 assert.match(business,/billing_status='Unbilled'/);
 assert.match(business,/invoice_id=NULL/);
 assert.match(app,/renderInvoiceDocuments\(\)/);
});

test("1099 partner assignment is enforced on worker create/update/bootstrap and every daily-rate activation",()=>{
 assert.match(index,/function ensure1099PartnerForUser/);
 assert.match(index,/INSERT INTO partners/);
 assert.match(index,/INSERT INTO partner_contractors/);
 assert.match(index,/if\(role==="WORKER"\) ensure1099PartnerForUser\(id,\{force:true\}\)/);
 assert.match(index,/if\(effectiveRole==="WORKER"\) ensure1099PartnerForUser\(target\.id,\{force:true\}\)/);
 assert.match(index,/ensureExisting1099PartnerAssignments\(\)/);
 assert.match(index,/ensure1099PartnerForUser\(employee\.id,\{force:true\}\)/);
 assert.ok(index.indexOf('if(effectiveRole==="WORKER") ensure1099PartnerForUser')<index.indexOf('try{updateUserTx();}'),"worker mapping must execute inside update transaction");
});

test("Balance Sheet shows the exact green balanced contract",()=>{
 assert.match(app,/Balanced \(In Balance: \$0\.00 difference\)/);
 assert.match(app,/balance-check-icon/);
 assert.match(styles,/\.balance-check-icon/);
 assert.match(styles,/\.balance-integrity\.is-balanced[^}]*color:/);
});

test("workflow billing has zero live inventory/material reservation dependency",()=>{
 for(const forbidden of [/workflow_materials/,/inventory_items/,/CENTRAL_INVENTORY/,/\/api\/workflows\/:id\/materials/,/releaseWorkflowReservations/,/materialRows/]) assert.doesNotMatch(workflow,forbidden);
 for(const forbidden of [/workflowAddMaterial/,/workflowInventoryOptions/,/CENTRAL_INVENTORY/,/\/api\/workflows\/\$\{workflowId\}\/materials/]) assert.doesNotMatch(app,forbidden);
 assert.match(workflow,/lineType = "COST", category = "OTHER"/);
 assert.match(app,/Manual phase costs only; no inventory or quantity link/);
 assert.match(app,/placeholder="\$\{bi\("Description"/);
 assert.match(app,/placeholder="\$\{bi\("Unit Price USD"/);
 assert.doesNotMatch(business,/WORKFLOW_INVOICE_MATERIAL|workflow_materials/);
});

test("card activation contract has no separate Superadmin card category",()=>{
 assert.match(app,/visibleItems=group\.items\.filter\(\(\[view\]\)=>isSuperadmin\(\)\|\|adminCardIsEnabled/);
 assert.match(app,/This card is disabled by the superadmin/);
 assert.match(app,/admin-ia-card \$\{enabled\?'':'is-disabled'\}/);
 assert.doesNotMatch(app,/Superadmin Cards|Superadmin kárty/);
 assert.doesNotMatch(index,/Superadmin Cards|Superadmin kárty/);
});


test("relocated cards keep labels, permissions and active/inactive access contract",()=>{
 assert.match(app,/Marketing · customer communication/);
 assert.match(app,/Technical Operation','Technikai működés/);
 assert.match(index,/invoice_documents\.view/);
 const invoicePermissionHits=(index.match(/invoice_documents\.view/g)||[]).length;
 assert.ok(invoicePermissionHits>=4,"invoice_documents.view must exist in defaults, settings list and reset bootstrap");
 assert.match(app,/function adminViewEnabled\(view\)[\s\S]*?if\(!group\|\|isSuperadmin\(\)\)return true;[\s\S]*?adminCardState\[view\]!==false/);
 assert.match(app,/visibleItems=group\.items\.filter\(\(\[view\]\)=>isSuperadmin\(\)\|\|adminCardIsEnabled/);
 assert.match(app,/class="admin-ia-card \${enabled\?'':'is-disabled'}"/);
 assert.match(index,/if\(!isSuperadminUser\(req\.user\)\) return res\.status\(403\)\.json\(\{error:'SUPERADMIN_REQUIRED'\}\)/);
});
