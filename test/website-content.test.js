"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const Database = require("better-sqlite3");
const { registerWebsitePlatformRoutes } = require("../server/website-platform");
const { registerWebsiteCatalogRoutes } = require("../server/website-catalog");

async function withPlatform(callback) {
  const app = express();
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(__dirname, "..", "server", "schema.sql"), "utf8"));
  for (const [table, column] of [["events", "sold_out_at"], ["events", "is_sample"], ["website_reviews", "is_sample"], ["website_showroom_pianos", "is_sample"], ["website_services", "is_sample"]]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${column === "sold_out_at" ? "TEXT" : "INTEGER DEFAULT 0"}`);
  }
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES('ADMIN-1','Admin','admin@example.com','x','ADMIN','Active',0,0)").run();
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES('SUPER-1','Owner','owner@example.com','x','ADMIN','Active',1,1)").run();
  app.use(express.json());
  const auth = (req, _res, next) => { req.user = String(req.headers["x-test-super"] || "") === "1" ? { id: "SUPER-1", name: "Owner", role: "ADMIN", is_superadmin: 1 } : { id: "ADMIN-1", name: "Admin", role: "ADMIN" }; next(); };
  registerWebsitePlatformRoutes({
    app, db, auth, permit: () => (_req, _res, next) => next(), requireSuperadmin: (req, res, next) => Number(req.user?.is_superadmin || 0) === 1 ? next() : res.status(403).json({ error: "SUPERADMIN_ONLY" }),
    audit: () => {}, websiteImageUpload: { single: () => (_req, _res, next) => next() }, websiteImageDir: "/tmp",
    erpBaseUrl: "https://erp.example.com", websiteBaseUrl: "https://www.example.com", transactionalEmail: { configured: false },
    env: { JWT_SECRET: "website-platform-test-secret-longer-than-thirty-two" }
  });
  registerWebsiteCatalogRoutes({ app, db, auth, permit: () => (_req, _res, next) => next(), audit: () => {}, erpBaseUrl: "https://erp.example.com" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, options = {}) => {
    const response = await fetch(`${origin}${url}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  try { await callback({ db, request }); }
  finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
}

test("website platform installs editable sample content once and publishes artists without touching customer pianos", async () => {
  await withPlatform(async ({ db, request }) => {
    db.prepare("INSERT INTO pianos(id,brand,model,ownership) VALUES('CLIENT-PIANO','Client brand','Client model','Customer owned')").run();
    const installed = await request("/api/demo-content/install", { method: "POST", body: "{}" });
    assert.equal(installed.status, 201, JSON.stringify(installed.body));
    assert.deepEqual(installed.body.installed, { artists: 3, services: 3, pianos: 6, reviews: 3, events: 3 });
    assert.equal((await request("/api/demo-content/install", { method: "POST", body: "{}" })).status, 409);
    const artists = await request("/api/public/website-artists?lang=hu");
    assert.equal(artists.body.length, 3);
    assert.equal(artists.body[0].portrait_url.startsWith("https://www.example.com/assets/media/"), true, "bundled sample media must resolve on both the public site and ERP administration");
    assert.equal(artists.body[0].gallery.length, 2, "sample artist galleries must be public and ordered");
    const services = await request("/api/public/website-services?lang=en");
    const pianos = await request("/api/public/showroom-pianos?lang=en");
    const reviews = await request("/api/public/website-reviews?lang=en");
    assert.equal(services.status, 200);
    assert.equal(services.body.length, 3, "all sample services must be public");
    assert.equal(pianos.status, 200);
    assert.equal(pianos.body.length, 6, "all sample showroom pianos must be public");
    assert.equal(pianos.body.every((piano) => piano.gallery.length === 2), true, "sample piano galleries must be public");
    assert.deepEqual([...new Set(pianos.body.map((piano) => piano.brand))].sort(), ["Bösendorfer", "Fazioli", "Steinway & Sons"]);
    assert.equal(reviews.status, 200);
    assert.equal(reviews.body.length, 3, "all sample reviews must be public");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM events WHERE is_sample=1 AND status='PUBLISHED' AND published_at IS NOT NULL").get().count, 3, "sample events must be published for the public event API");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM pianos").get().count, 1, "sample showroom content must not touch customer pianos");
    const removed = await request("/api/demo-content", { method: "DELETE", headers: { "x-test-super": "1" } });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM pianos").get().count, 1);
  });
});

test("contact leads, signed-device event interest, consent tracking and integration permissions are enforced", async () => {
  await withPlatform(async ({ db, request }) => {
    db.prepare(`INSERT INTO events(id,event_key,category_id,access_type,status,slug_en,slug_hu,title_en,title_hu,venue_name,venue_street,venue_city,venue_region,venue_postal_code,start_at,end_at,capacity_total,price_cents,published_at,sold_out_at)
      VALUES('EV-1','EV-1','EVC-SALON-CONCERT','PUBLIC_FREE','PUBLISHED','event-one','esemeny-egy','Event One','Első esemény','Klavierhaus','790 11th Avenue','New York','NY','10019','2031-01-01T19:00:00Z','2031-01-01T21:00:00Z',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
    const invalidLead = await request("/api/public/contact-leads", { method: "POST", body: JSON.stringify({ name: "Guest", email: "guest@example.com" }) });
    assert.equal(invalidLead.status, 400);
    const lead = await request("/api/public/contact-leads", { method: "POST", body: JSON.stringify({ name: "Guest", email: "guest@example.com", consent_contact: true, service_id: null }) });
    assert.equal(lead.status, 201);
    db.prepare(`INSERT INTO website_services(id,slug_en,slug_hu,title_en,title_hu,image_url,visible) VALUES('SERVICE-1','restoration','restauralas','Restoration','Restaurálás','/image.jpg',1)`).run();
    assert.equal((await request("/api/public/contact-leads", { method: "POST", body: JSON.stringify({ name: "Piano Owner", email: "owner@example.com", consent_contact: true, service_id: "SERVICE-1" }) })).status, 400);
    const serviceLead = await request("/api/public/contact-leads", { method: "POST", body: JSON.stringify({ name: "Piano Owner", email: "owner@example.com", phone: "+1 212 555 0100", service_id: "SERVICE-1", service_address: "790 11th Avenue, New York", preferred_time: "Weekdays after 5pm", piano_brand: "Steinway & Sons", piano_model: "Model B", consent_contact: true }) });
    assert.equal(serviceLead.status, 201);
    assert.equal(db.prepare("SELECT service_address FROM website_contact_leads WHERE id=?").get(serviceLead.body.id).service_address, "790 11th Avenue, New York");
    const leads = await request("/api/website-contact-leads");
    assert.equal(leads.status, 200);
    assert.equal(leads.body[0].status, "NEW");
    const missingAppointment = await request(`/api/website-contact-leads/${serviceLead.body.id}`, { method: "PUT", body: JSON.stringify({ status: "APPOINTMENT_SCHEDULED" }) });
    assert.equal(missingAppointment.status, 400);
    assert.equal(missingAppointment.body.error, "LEAD_APPOINTMENT_REQUIRED");
    const contacted = await request(`/api/website-contact-leads/${serviceLead.body.id}`, { method: "PUT", body: JSON.stringify({ status: "CONTACTED", assigned_user_id: "ADMIN-1", internal_notes: "Called the client", contact_date: "2031-01-02T17:00:00.000Z" }) });
    assert.equal(contacted.status, 200, JSON.stringify(contacted.body));
    assert.equal(contacted.body.status, "CONTACTED");
    assert.equal(contacted.body.assigned_user_id, "ADMIN-1");
    const scheduled = await request(`/api/website-contact-leads/${serviceLead.body.id}`, { method: "PUT", body: JSON.stringify({ status: "APPOINTMENT_SCHEDULED", agreed_appointment_at: "2031-01-03T18:00:00.000Z" }) });
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));
    assert.equal(scheduled.body.agreed_appointment_at, "2031-01-03T18:00:00.000Z");
    const device = await request("/api/public/device-token");
    const interest = await request("/api/public/events/EV-1/repeat-interest", { method: "POST", body: JSON.stringify({ email: "Guest@Example.com", device_token: device.body.device_token, notify_event: true, marketing_consent: false, language: "hu" }) });
    assert.equal(interest.status, 201, JSON.stringify(interest.body));
    assert.equal((await request("/api/public/events/EV-1/repeat-interest", { method: "POST", body: JSON.stringify({ email: "guest@example.com", device_token: device.body.device_token, notify_event: true }) })).status, 409);
    const ignoredTracking = await request("/api/public/tracking-events", { method: "POST", body: JSON.stringify({ event_name: "page_view", device_token: device.body.device_token }) });
    assert.equal(ignoredTracking.status, 204);
    const tracking = await request("/api/public/tracking-events", { method: "POST", body: JSON.stringify({ event_name: "page_view", device_token: device.body.device_token, analytics_consent: true }) });
    assert.equal(tracking.status, 201);
    const deniedConfig = await request("/api/marketing/integrations/GA4", { method: "PUT", body: JSON.stringify({ config: { measurement_id: "G-ABC123" } }) });
    assert.equal(deniedConfig.status, 403);
    const configured = await request("/api/marketing/integrations/GA4", { method: "PUT", headers: { "x-test-super": "1" }, body: JSON.stringify({ config: { measurement_id: "G-ABC123" } }) });
    assert.equal(configured.status, 200);
    const tested = await request("/api/marketing/integrations/GA4/test", { method: "POST", body: "{}" });
    assert.equal(tested.status, 200);
    const campaign = await request("/api/marketing/campaigns", { method: "POST", body: JSON.stringify({ name: "Salon launch", destination_url: "https://klavierhaus.com/events", utm_source: "newsletter", utm_medium: "email", utm_campaign: "salon-launch", active: true }) });
    assert.equal(campaign.status, 201);
    const campaignUpdate = await request(`/api/marketing/campaigns/${campaign.body.id}`, { method: "PUT", body: JSON.stringify({ ...campaign.body, name: "Salon relaunch", active: false }) });
    assert.equal(campaignUpdate.status, 200);
    assert.equal(campaignUpdate.body.name, "Salon relaunch");
    assert.equal(campaignUpdate.body.active, 0);
    assert.equal((await request(`/api/marketing/campaigns/${campaign.body.id}`, { method: "DELETE" })).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM marketing_campaigns").get().count, 0);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
});
