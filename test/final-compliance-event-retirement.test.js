"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const missing=(source,value,label=value)=>assert.equal(source.includes(value),false,label);
const present=(source,value,label=value)=>assert.equal(source.includes(value),true,label);

test("ticketed event runtime, public routes and admin surfaces are retired",()=>{
  const schema=read("server/schema.sql");
  const server=read("server/index.js");
  const business=read("server/business-operations.js");
  const publicServer=read("website/server/index.js");
  const platform=read("server/website-platform.js");
  const publicContent=read("website/server/site-content.js");
  const admin=read("public/app.js");
  const publicCss=read("website/public/styles.css");
  for(const table of ["events","event_categories","event_tickets","event_payments","event_invitations","event_checkout_holds","event_refund_requests","event_attendance_sessions","event_attendance_entries","event_repeat_requests"]){
    missing(schema,`CREATE TABLE IF NOT EXISTS ${table} (`,table);
  }
  for(const marker of ["registerEventRoutes","createTicketService","createEventImageUpload"])missing(server,marker);
  for(const marker of ["event_tickets","event_payments","event_attendance","ticketService"])missing(business,marker);
  for(const marker of ["/events","/hu/esemenyek","ticket-terms","event-invitations","repeat-interest"])missing(publicServer,marker);
  missing(platform,"SAMPLE_EVENTS_HAVE_TRANSACTIONAL_DEPENDENCIES");
  missing(platform,"Number(dependencies)");
  for(const marker of ["events: Object.freeze({","salon: Object.freeze({"])missing(publicContent,marker);
  for(const marker of ["renderEvents","renderEventWorkspace","renderDigitalAttendance","renderGuestData","event_tickets","event_invitations"])missing(admin,marker);
  for(const marker of [".public-event-card",".event-carousel",".event-order-form",".ticket-quantity",".attendee-names",".dynamic-event-list"])missing(publicCss,marker);
});

test("retirement migration destroys legacy event data after creating a safety backup",()=>{
  const init=read("server/init-db.js");
  present(init,"event-management-retirement-");
  present(init,"Event-management safety backup created");
  present(init,"deleteRetiredConversationAttachmentFiles");
  present(init,"customer-conversations");
  for(const legacy of ["event_tickets","event_payments","event_invitations","event_attendance_entries","events","event_categories"])present(init,`\"${legacy}\"`,legacy);
  present(init,"DROP TABLE");
  present(init,"DELETE FROM landing_sections WHERE section_key='salon_events'");
  present(init,"DELETE FROM website_content_pages WHERE page_key IN ('events','salon','ticketTerms')");
  present(init,'ALTER TABLE "invoice_credit_memos" DROP COLUMN "event_id"');
  present(init,'ALTER TABLE "invoices" DROP COLUMN "deferred_event_id"');
});

test("event email, ticket PDF and Himate event datasets are retired",()=>{
  const mail=read("server/transactional-email.js");
  const pdf=read("server/document-pdf.js");
  const registry=read("server/himate-connector/registry.js");
  const collectors=read("server/himate-connector/collectors.js");
  const integrations=read("server/system-integrations.js");
  for(const marker of ["sendEvent","buildEvent","EVENT_EMAIL_FROM","event_purchase","event_ticket"])missing(mail,marker);
  for(const marker of ["EVENT_EMAIL_FROM","event_from_email","eventFrom"])missing(integrations,marker);
  for(const marker of ["generateTicket","BOARDING_PASS","ticketPalette","ADMISSION TICKET"])missing(pdf,marker);
  for(const marker of ['module_key:"digital_attendance"','dataset_key:"events.events"','dataset_key:"events.guests"','dataset_key:"events.invitations"','dataset_key:"events.tickets"'])missing(registry,marker);
  for(const marker of ["event_tickets","event_payments","event_invitations","event_attendance_entries"])missing(collectors,marker);
});

test("Stripe remains available only for workshop invoice checkout",()=>{
  const stripe=read("server/stripe-sandbox.js");
  present(stripe,'workshop_invoice');
  present(stripe,'onCheckoutSessionEvent');
  for(const marker of ["event_tickets","event_payments","event_checkout_holds","ticketService","activeHoldCount"])missing(stripe,marker);
});

test("normal Google Calendar integration is intentionally preserved",()=>{
  const calendar=read("server/google-calendar.js");
  present(calendar,"external_calendar_events");
  present(calendar,"external_event_id");
  present(calendar,"https://www.googleapis.com/calendar/v3");
  present(calendar,"calendar.readonly");
  present(calendar,"GOOGLE_TO_ERP");
});
