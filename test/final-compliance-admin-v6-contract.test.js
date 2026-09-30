"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Admin UX v6 shell is dark-first, user-themed, responsive and sidebar-driven",()=>{
  const html=read("public/index.html"),v6=read("public/v6.js"),css=read("public/styles.css"),sw=read("public/service-worker.js");
  assert.match(html,/id="appSidebar"/);
  assert.match(html,/id="sidebarToggle"/);
  assert.match(html,/id="themeToggle"/);
  assert.doesNotMatch(html,/id="loginThemeToggle"/);
  assert.match(html,/mobile-intake-primary/);
  assert.match(html,/id="mobileMoreButton"/);
  const mobileNav=html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)?.[0]||"";
  assert.equal((mobileNav.match(/<button/g)||[]).length,5);
  assert.doesNotMatch(mobileNav,/data-nav="finance"/);
  assert.match(v6,/data-nav="finance"[\s\S]*Documents[\s\S]*Website CMS[\s\S]*Profile[\s\S]*Settings/);
  assert.match(css,/Canonical mobile\/tablet navigation contract:[\s\S]*repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(html,/src="\/v6\.js"/);
  assert.match(v6,/kh_theme_user_/);
  assert.match(v6,/\/api\/me\/preferences/);
  assert.match(v6,/kh_sidebar_collapsed_/);
  assert.match(css,/:root\[data-theme="dark"\]/);
  assert.match(css,/:root\[data-theme="light"\]/);
  assert.match(css,/\.app-sidebar/);
  assert.match(css,/@media\(max-width:1024px\)/);
  assert.match(css,/\.mobile-intake-primary/);
  assert.match(sw,/klavierhaus-admin-v22-relational-search-notifications/);
  assert.match(sw,/"\/v6\.js"/);
});

test("CMS v6 is a visual builder with uploadable page images, galleries and brand assets",()=>{
  const v6=read("public/v6.js"),css=read("public/styles.css");
  assert.match(v6,/v6CmsImageField/);
  assert.match(v6,/data-cms-image-upload/);
  assert.match(v6,/data-cms-focal-x/);
  assert.match(v6,/data-cms-focal-y/);
  assert.match(v6,/Add gallery images/);
  assert.match(v6,/Image alt EN/);
  assert.match(v6,/Kép alt HU/);
  assert.match(v6,/Public website favicon/);
  assert.match(v6,/PWA \/ app icon/);
  assert.match(v6,/Login background/);
  assert.match(v6,/Public website logo/);
  assert.match(v6,/System logo · dark mode/);
  assert.match(v6,/System logo · light mode/);
  assert.match(v6,/\/api\/website-content\/image/);
  assert.match(css,/\.cms-media-card/);
  assert.match(css,/\.cms-gallery-grid/);
  assert.match(css,/\.branding-grid/);
  assert.match(css,/\.file-picker input\{position:absolute/);
});

test("Intake v6 removes manual URL entry in the active UI and adds catalog pricing plus one-step approval",()=>{
  const v6=read("public/v6.js"),schema=read("server/schema.sql"),api=read("server/admin-ux-v6.js"),round2=read("server/round2-workflow.js");
  assert.doesNotMatch(v6,/Media URLs — one per line|Média URL-ek — soronként egy/);
  assert.match(v6,/Intake Center/);
  assert.match(v6,/Igényközpont/);
  assert.match(v6,/data-assessment-check/);
  assert.match(v6,/assessmentTotal/);
  assert.match(v6,/Approve & create job/);
  assert.match(v6,/estimated_revenue/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS intake_catalog_items/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS intake_assessment_items/);
  assert.match(schema,/estimated_total REAL/);
  assert.match(schema,/estimated_revenue REAL/);
  assert.match(api,/\/api\/intake-catalog/);
  assert.match(api,/\/api\/intake\/:id\/assessment/);
  assert.match(round2,/estimated_revenue/);
});

test("Intake keeps the manual job approval gate while assessment delivery is email/PDF automated",()=>{
  const core=read("server/round1-core.js"),archive=read("server/archive-center.js"),email=read("server/transactional-email.js"),schema=read("server/schema.sql"),v6=read("public/v6.js"),index=read("server/index.js");
  assert.match(core,/function exactClientCandidates/);
  assert.match(core,/identityStatus==="ambiguous"\?"under_review":"new"/);
  assert.doesNotMatch(core,/app\.post\("\/api\/intake"[\s\S]{0,6000}INSERT INTO jobs/);
  assert.match(v6,/Approve \/ create job/);
  assert.match(v6,/data-intake-send/);
  assert.match(v6,/Send assessment/);
  assert.match(archive,/\/api\/intake\/:id\/send-assessment/);
  assert.match(archive,/createAssessmentArtifact/);
  assert.match(email,/sendIntakeAssessment/);
  assert.match(email,/intake_assessment/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS intake_assessment_email_log/);
  assert.match(schema,/preferred_language TEXT NOT NULL DEFAULT 'en'/);
  assert.match(index,/registerArchiveCenterRoutes\(\{[^}]*transactionalEmail/);
});

test("Handoff presets are Admin-managed data and populate the mobile workflow handoff",()=>{
  const schema=read("server/schema.sql"),init=read("server/init-db.js"),api=read("server/admin-ux-v6.js"),round2=read("server/round2-workflow.js"),ui=read("public/round2.js"),v6=read("public/v6.js"),css=read("public/styles.css");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS handoff_presets/);
  assert.match(schema,/phase_duration_min INTEGER/);
  assert.match(init,/Tuning/);
  assert.match(init,/Regulation/);
  assert.match(api,/\/api\/handoff-presets/);
  assert.match(ui,/Quick presets/);
  assert.match(ui,/data-handoff-preset/);
  assert.match(ui,/phase_duration_min/);
  assert.match(round2,/phase_duration_min/);
  assert.match(v6,/v6OpenHandoffPresetCenter/);
  assert.match(css,/\.handoff-preset-strip/);
});

test("Invoice closeout keeps the manual decision gate and durable automation stays behind it",()=>{
  const schema=read("server/schema.sql"),finance=read("server/round3-finance.js"),pdf=read("server/document-pdf.js"),ui=read("public/round3.js"),index=read("server/index.js"),outbox=read("server/automation-outbox.js");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS automation_outbox/);
  assert.match(schema,/snapshot_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(schema,/labor_amount REAL NOT NULL DEFAULT 0/);
  assert.match(finance,/automationOutbox\.register\("SEND_INVOICE"/);
  assert.match(finance,/dedupeKey:`invoice-send-\$\{invoiceId\}`/);
  assert.match(finance,/SELECT \* FROM job_handoffs WHERE job_id=\?/);
  const businessPdf=pdf.slice(pdf.indexOf("function businessInvoicePage"),pdf.indexOf("function monthlyReportPage"));
  assert.match(businessPdf,/COMMERCIAL INVOICE/);
  assert.match(businessPdf,/1 1 1 rg 0 0 612 792 re f/);
  assert.doesNotMatch(businessPdf,/DARK.*0 0 612 792 re f/);
  assert.match(ui,/Complete & Save Draft/);
  assert.match(ui,/Complete & Send Invoice/);
  assert.match(index,/createAutomationOutbox/);
  assert.match(outbox,/processDue/);
  assert.match(outbox,/dedupe_key TEXT|dedupeKey/);
});

test("calendar v6 shares horizontal scroll for header/body and creates jobs from an empty 15-minute slot",()=>{
  const round2=read("public/round2.js"),css=read("public/styles.css");
  assert.match(round2,/time-calendar-scroll[\s\S]*time-calendar-head[\s\S]*time-calendar-body/);
  assert.match(round2,/function r2BindCalendarCreate/);
  assert.match(round2,/r2SnapMinutes\(\(event\.clientY-rect\.top\)\/R2_PX_PER_MIN\)/);
  assert.match(round2,/datetime:r2MinutesInput\(date,minutes\)/);
  assert.match(css,/\.time-calendar-inner/);
  assert.match(css,/scrollbar-gutter:stable/);
});

test("receipt upload and Admin-only user deletion use backend authorization, not UI hiding alone",()=>{
  const server=read("server/index.js"),v6api=read("server/admin-ux-v6.js"),v6=read("public/v6.js");
  assert.match(server,/app\.delete\("\/api\/users\/:id",auth,permit\("ADMIN"\)/);
  assert.match(server,/status='Inactive',hidden_user=1/);
  assert.match(v6api,/\/api\/v6\/direct-expense-receipt/);
  assert.match(v6api,/INVALID_RECEIPT_FILE_TYPE/);
  assert.match(v6,/expenseReceiptFile/);
  assert.match(v6,/data-delete-user/);
});

test("public website source tree and protected website backend remain outside the v6 implementation surface",()=>{
  for(const file of ["server/website-platform.js","server/website-content.js","server/website-catalog.js","server/upload-middleware.js"])assert.ok(fs.existsSync(path.join(root,file)),file);
  assert.ok(fs.existsSync(path.join(root,"website","server","index.js")));
});


test("CMS archive, workflow lifecycle split and send-time client email are wired end to end",()=>{
  const schema=read("server/schema.sql"),archive=read("server/archive-center.js"),finance=read("server/round3-finance.js"),round2=read("server/round2-workflow.js"),ui2=read("public/round2.js"),ui3=read("public/round3.js"),v6=read("public/v6.js");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS document_archive/);
  assert.match(schema,/deleted_at TEXT/);
  assert.match(archive,/\/api\/archive\/documents/);
  assert.match(archive,/deleted_invoice/);
  assert.match(v6,/Documents \/ Archive/);
  assert.match(v6,/internal_correspondence/);
  assert.match(v6,/company_message/);
  assert.match(v6,/company_document/);
  assert.match(round2,/bucket===\"closed\"/);
  assert.match(ui2,/data-workflow-bucket="closed"/);
  assert.match(ui2,/🔒/);
  assert.match(finance,/persistClientEmail/);
  assert.match(finance,/recipient_email/);
  assert.match(ui3,/name='recipient_email'/);
  assert.match(finance,/ARCHIVE_DELETE/);
});


test("Dynamic workflow v7 and CMS image preview contracts are present",()=>{
  const schema=read("server/schema.sql"),workflow=read("server/round2-workflow.js"),ui=read("public/round2.js"),v6=read("public/v6.js"),css=read("public/styles.css");
  assert.match(schema,/position INTEGER NOT NULL CHECK\(position BETWEEN 1 AND 7\)/);
  assert.match(schema,/stage_type TEXT NOT NULL DEFAULT 'intermediate'/);
  assert.match(schema,/workflow_stage_key TEXT/);
  assert.match(workflow,/MAX_WORKFLOW_STAGES=7/);
  assert.match(workflow,/\/api\/workflow\/stages\/order/);
  assert.match(workflow,/\/api\/workflow\/stages\/\:key/);
  assert.match(workflow,/closed_type/);
  assert.match(workflow,/\/api\/jobs\/\:id\/history/);
  assert.match(ui,/workflowAddStageCard/);
  assert.match(ui,/data-stage-drag/);
  assert.match(ui,/data-closed-type="completed"/);
  assert.match(ui,/data-closed-type="cancelled"/);
  assert.match(ui,/r2OpenWorkflowHistory/);
  assert.match(css,/--workflow-columns/);
  assert.match(css,/calendar-event-block\.is-completed/);
  assert.match(v6,/function v6CmsPreviewUrl/);
  assert.match(v6,/url\.pathname\.startsWith\("\/uploads\/website\/"\)/);
  assert.match(v6,/data-cms-original-src/);
});


test("Workflow status, responsibility, intake grid and Documents UX contracts are present",()=>{
  const html=read("public/index.html"),app=read("public/app.js"),ui=read("public/round2.js"),v6=read("public/v6.js"),css=read("public/styles.css"),schema=read("server/schema.sql"),archive=read("server/archive-center.js");
  assert.match(html,/data-nav="documents"/);
  assert.match(app,/state\.view==="documents"/);
  assert.match(v6,/async function renderDocuments/);
  assert.match(v6,/financial_document/);
  assert.match(v6,/intake_assessment/);
  assert.match(v6,/exported_report/);
  assert.match(v6,/data-intake-pdf/);
  assert.match(v6,/\/api\/intake\/"\+id\+"\/export-pdf/);
  assert.match(schema,/workflow_owner_user_id TEXT/);
  assert.match(schema,/starts_at TEXT/);
  assert.match(schema,/responsible_user_id TEXT/);
  assert.match(ui,/data-job-drag-handle/);
  assert.match(ui,/r2CreateDragGhost/);
  assert.match(ui,/workflow-touch-drag-ghost/);
  assert.match(ui,/Planned start/);
  assert.match(ui,/Workflow owner/);
  assert.match(ui,/phase-status-/);
  assert.match(css,/stage-card\.status-scheduled/);
  assert.match(css,/stage-card\.status-in_progress/);
  assert.match(css,/stage-card\.status-blocked/);
  assert.match(css,/stage-card\.status-overdue/);
  assert.match(css,/stage-card\.status-completed/);
  assert.match(css,/stage-card\.status-cancelled/);
  assert.match(css,/Intake work selectors deliberately mirror the More-menu card language/);
  assert.match(css,/@media\(max-width:700px\)[\s\S]*\.assessment-grid\{grid-template-columns:repeat\(2/);
  assert.match(v6,/assessment-option-icon/);
  assert.match(archive,/intakeAssessmentPdf/);
  assert.match(archive,/\/api\/intake\/:id\/export-pdf/);
});


test("Private appointments, VIP clients and unified notifications are wired end to end",()=>{
  const html=read("public/index.html"),app=read("public/app.js"),round2=read("public/round2.js"),css=read("public/styles.css"),sw=read("public/service-worker.js");
  const schema=read("server/schema.sql"),privateApi=read("server/private-appointments.js"),notifications=read("server/notification-center.js");
  assert.match(schema,/CREATE TABLE IF NOT EXISTS private_appointments/);
  assert.match(schema,/appointment_type TEXT NOT NULL CHECK\(appointment_type IN \('PRIVATE_VISIT','PIANO_VIEWING','SERVICE_CONSULTATION'\)\)/);
  assert.match(schema,/is_vip INTEGER NOT NULL DEFAULT 0/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS notification_events/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS notification_recipients/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS push_subscriptions/);
  assert.match(privateApi,/\/api\/public\/private-appointments/);
  assert.match(privateApi,/private_appointment_requests/);
  assert.match(privateApi,/assertAvailable/);
  assert.match(round2,/private-appointment-event/);
  assert.match(round2,/Private appointments/);
  assert.match(round2,/r2OpenPrivateAppointment/);
  assert.match(app,/vip-client-star/);
  assert.match(app,/masterToolButton\("VIP"/);
  assert.match(app,/masterToolButton\("PIANOS"/);
  assert.match(html,/id="notificationBell"/);
  assert.match(html,/id="notificationDrawer"/);
  assert.match(app,/snooze-all/);
  assert.match(app,/\/acknowledge/);
  assert.match(app,/ensurePushSubscription/);
  assert.match(notifications,/hours=3/);
  assert.match(notifications,/notifications_enabled/);
  assert.match(notifications,/sound_enabled/);
  assert.match(css,/private-appointment-card/);
  assert.match(css,/notification-drawer\.open/);
  assert.match(css,/vip-client-star/);
  assert.match(sw,/addEventListener\("push"/);
  assert.match(sw,/addEventListener\("notificationclick"/);
  assert.match(sw,/setAppBadge/);
});


test("Notification center is a global hidden portal, never workspace content",()=>{
  const html=read("public/index.html"),app=read("public/app.js"),css=read("public/styles.css"),sw=read("public/service-worker.js");
  const mainStart=html.indexOf('<div class="app-main-column">');
  const mainEnd=html.indexOf('<nav class="mobile-nav"',mainStart);
  const layer=html.indexOf('id="notificationLayer"');
  assert.ok(mainStart>=0&&mainEnd>mainStart&&layer>mainEnd,"notification layer must live outside app-main-column/workspace flow");
  assert.match(html,/id="notificationLayer" class="notification-layer" hidden aria-hidden="true"/);
  assert.match(css,/\[hidden\]\{display:none!important\}/);
  assert.match(css,/\.notification-layer\{position:fixed;inset:0/);
  assert.match(css,/\.notification-layer\.open\{pointer-events:auto\}/);
  assert.match(app,/layer\.hidden=false/);
  assert.match(app,/layer\.hidden=true/);
  assert.match(app,/document\.documentElement\.classList\.add\("notification-layer-open"\)/);
  assert.match(app,/document\.documentElement\.classList\.remove\("notification-layer-open"\)/);
  assert.match(sw,/klavierhaus-admin-v22-relational-search-notifications/);
  assert.match(sw,/const critical=request\.mode==="navigate"/);
});


test("Responsive PWA layout keeps intake tiles compact and removes desktop-only minimum widths",()=>{
  const css=read("public/styles.css"),round2=read("public/round2.js"),sw=read("public/service-worker.js");
  assert.match(css,/RESPONSIVE PWA V11/);
  assert.match(css,/Intake work selectors deliberately mirror the More-menu card language/);
  assert.match(css,/\.assessment-option-icon/);
  assert.match(css,/@media\(max-width:700px\)[\s\S]*\.assessment-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(css,/@media\(max-width:640px\)[\s\S]*\.app-dialog,[\s\S]*width:100vw!important/);
  assert.match(css,/@media\(max-width:640px\)[\s\S]*\.form-grid\{grid-template-columns:1fr!important/);
  assert.match(css,/@media\(max-width:640px\)[\s\S]*\.workflow-board\{[\s\S]*minmax\(82vw,82vw\)/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*\.month-calendar\{min-width:0!important;overflow-x:auto/);
  assert.match(css,/@media\(pointer:coarse\)[\s\S]*min-height:42px/);
  assert.match(round2,/window\.matchMedia\?\.\("\(max-width:700px\)"\)\?\.matches\?"day":"week"/);
  assert.match(sw,/klavierhaus-admin-v22-relational-search-notifications/);
});
