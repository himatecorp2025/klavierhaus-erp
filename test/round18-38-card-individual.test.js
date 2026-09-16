const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const index=fs.readFileSync(path.join(root,'server/index.js'),'utf8');
const serverBundle=fs.readdirSync(path.join(root,'server')).filter(x=>x.endsWith('.js')).map(x=>fs.readFileSync(path.join(root,'server',x),'utf8')).join('\n');

const cards=[
 ['finance','Finance','finance_invoicing','renderFinance','/api/income-statement'],
 ['income_statement','Income Statement','finance_invoicing','renderIncomeStatement','/api/income-statement'],
 ['invoice_documents','Invoices Documents','finance_invoicing','renderInvoiceDocuments','/api/invoices'],
 ['knowledge_base','Invoices & Documents / Document Archive','finance_invoicing','knowledge_base:{api:','createResourceRoutes("knowledge_base"'],
 ['audit_log','Audit Log','technical','renderAuditLog','/api/audit-log'],
 ['backups','Backups','technical','renderBackupsView','/api/backups'],
 ['pianos','Client Piano','technical','renderPianos','/api/pianos'],
 ['contacts','Clients','technical','contacts:{api:','createResourceRoutes("contacts"'],
 ['closed_jobs','Closed Jobs','technical','renderClosedJobs','/api/closed-jobs'],
 ['company_data','Company Data','technical','renderCompanyData','/api/settings/company-data'],
 ['inventory','Inventory','technical','renderInventory','/api/inventory'],
 ['partners','Partners','technical','renderPartners','/api/partners'],
 ['planned_jobs','Planned Jobs','technical','renderPlannedJobs','/api/planned-jobs'],
 ['scheduler','Scheduler','technical','renderScheduler','/api/calendar-events'],
 ['website_services','Services','technical','renderWebsiteServices','route: "website-services"'],
 ['settings','Settings','technical','renderSettings','/api/settings/permissions'],
 ['system_integrations','System Activation & Integrations','technical','renderSystemIntegrations','/api/system-integrations'],
 ['users','Users','technical','renderUsers','/api/users'],
 ['workshop_workflow','Workshop Workflow','technical','renderWorkshopWorkflow','/api/workflows'],
 ['marketing_overview','Marketing Overview','marketing','renderMarketingOverview','/api/marketing/overview'],
 ['customer_inbox','Customer Inbox','marketing','renderCustomerInbox','/api/customer-conversations'],
 ['website_reviews','Reviews','marketing','renderWebsiteReviews','/api/website-reviews'],
 ['campaigns_utm','Campaigns & UTM','marketing','renderMarketingCampaigns','/api/marketing/campaigns'],
 ['leads','Leads','marketing','renderWebsiteLeads','/api/website-contact-leads'],
 ['tracking_cookies','Tracking & Cookies','marketing','renderMarketingIntegrations','/api/marketing/integrations'],
 ['seo_keywords','SEO & Keywords','marketing','renderMarketingSeo','/api/marketing/seo'],
 ['heatmap','Consent Heatmap','marketing','renderMarketingHeatmap','/api/marketing/heatmap'],
 ['website_artists','Artists','website_events','renderWebsiteArtists','/api/website-artists'],
 ['website_contacts','Contacts / Website Contacts','website_events','renderWebsiteLeads','/api/website-contact-leads'],
 ['digital_attendance','Digital Attendance','website_events','renderDigitalAttendance','/api/events/:id/attendance'],
 ['events','Events','website_events','renderEvents','/api/events'],
 ['event_guest_list','Guest Data','website_events','renderGuestData','/api/guest-data'],
 ['event_invitations','Invitations','website_events','renderEventWorkspace','/api/events/:id/invitations'],
 ['media_library','Media Library','website_events','renderWebsiteMedia','/api/website-media'],
 ['pages_content','Pages & Content','website_events','renderWebsiteDesign','/api/website-content/pages'],
 ['publish_preview','Publish & Preview','website_events','renderPublishPreview','/api/website-content/pages'],
 ['showroom_pianos','Showroom Pianos','website_events','renderShowroomPianos','route: "showroom-pianos"'],
 ['event_tickets','Ticket Reservation','website_events','renderEventWorkspace','/api/events/:id/tickets']
];

for(const [key,label,group,frontendMarker,backendMarker] of cards){
 test(`card ${key}: ${label} has frontend renderer, backend function and activation registry`,()=>{
   assert.ok(app.includes(`["${key}"`),`${key} card missing from frontend group`);
   assert.ok(app.includes(frontendMarker),`${key} frontend function/resource missing`);
   assert.match(index,new RegExp(`\\{ key: "${key}", group_key: "${group}"`),`${key} activation group mismatch`);
   assert.ok(serverBundle.includes(backendMarker),`${key} backend/API contract missing: ${backendMarker}`);
 });
}

test('all 38 individual card contracts are unique',()=>{
 assert.equal(cards.length,38);
 assert.equal(new Set(cards.map(x=>x[0])).size,38);
});
