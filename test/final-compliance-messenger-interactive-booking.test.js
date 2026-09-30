"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Messenger interactive customer and private appointment surfaces share canonical domains",()=>{
  const schema=read("server/schema.sql");
  const migration=read("server/init-db.js");
  const conversations=read("server/website-conversations.js");
  const appointments=read("server/private-appointments.js");
  const admin=read("public/messenger.js");
  const adminCss=read("public/styles.css");
  const site=read("website/server/index.js");
  const siteJs=read("website/public/app.js");
  const siteCss=read("website/public/styles.css");

  assert.match(schema,/customer_messages[\s\S]*message_type TEXT NOT NULL DEFAULT 'TEXT'[\s\S]*metadata_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(schema,/private_appointments[\s\S]*appointment_reason TEXT NOT NULL DEFAULT 'OTHER'/);
  assert.match(schema,/private_appointment_requests[\s\S]*appointment_reason TEXT NOT NULL DEFAULT 'OTHER'/);
  assert.match(schema,/customer_appointment_proposals[\s\S]*appointment_reason TEXT NOT NULL DEFAULT 'OTHER'/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS pianos[\s\S]*location_address TEXT/);
  assert.match(migration,/ensureColumn\("customer_messages","message_type"/);
  assert.match(migration,/ensureColumn\("private_appointments","appointment_reason"/);
  assert.match(migration,/ensureColumn\("pianos"/);

  assert.match(conversations,/\/api\/customer-conversations\/:id\/interactions/);
  assert.match(conversations,/CUSTOMER_PROFILE_FORM/);
  assert.match(conversations,/PRIVATE_APPOINTMENT_PICKER/);
  assert.match(conversations,/\/api\/public\/customer-conversations\/:token\/customer-profile/);
  assert.match(conversations,/CUSTOMER_PROFILE_SUBMITTED/);

  assert.match(appointments,/\/api\/public\/private-appointment-availability/);
  assert.match(appointments,/conversation_token/);
  assert.match(appointments,/PRIVATE_APPOINTMENT_REQUEST/);
  assert.match(appointments,/Customer call required/);
  assert.match(appointments,/assertAvailable/);

  assert.match(admin,/messenger-action-grid/);
  assert.match(admin,/messengerSendProfileForm/);
  assert.match(admin,/messengerAppointmentAction/);
  assert.match(admin,/Book for customer now/);
  assert.match(admin,/api\/public\/private-appointment-availability/);
  assert.match(adminCss,/\.messenger-action-grid/);

  assert.match(site,/data-chat-booking-open/);
  assert.match(site,/name="appointment_reason"/);
  assert.match(site,/customer-chat__consent/);
  assert.match(siteJs,/customerStructuredMessage/);
  assert.match(siteJs,/CUSTOMER_PROFILE_FORM/);
  assert.match(siteJs,/PRIVATE_APPOINTMENT_PICKER/);
  assert.match(siteJs,/submitCustomerChatBooking/);
  assert.match(siteCss,/\.customer-chat__booking-open/);
  assert.match(siteCss,/\.customer-chat__consent/);
});
