"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Database = require("better-sqlite3");
const { registerWebsiteCatalogRoutes } = require("../server/website-catalog");

async function withServer(callback) {
  const app = express();
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE pianos(id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE events(id TEXT PRIMARY KEY, slug_en TEXT, slug_hu TEXT);
    CREATE TABLE website_reviews(id TEXT PRIMARY KEY,person_name TEXT NOT NULL,role_en TEXT,role_hu TEXT,quote_en TEXT NOT NULL,quote_hu TEXT NOT NULL,portrait_url TEXT NOT NULL,portrait_alt_en TEXT,portrait_alt_hu TEXT,linked_event_id TEXT,visible INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,created_by_user_id TEXT,updated_by_user_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(linked_event_id) REFERENCES events(id) ON DELETE SET NULL);
    CREATE TABLE website_showroom_pianos(id TEXT PRIMARY KEY,slug_en TEXT NOT NULL UNIQUE,slug_hu TEXT NOT NULL UNIQUE,brand TEXT NOT NULL,model TEXT,title_en TEXT NOT NULL,title_hu TEXT NOT NULL,summary_en TEXT,summary_hu TEXT,description_en TEXT,description_hu TEXT,image_url TEXT NOT NULL,image_alt_en TEXT,image_alt_hu TEXT,gallery_json TEXT NOT NULL DEFAULT '[]',availability_status TEXT NOT NULL DEFAULT 'AVAILABLE',featured INTEGER NOT NULL DEFAULT 0,published INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 0,created_by_user_id TEXT,updated_by_user_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE website_services(id TEXT PRIMARY KEY,slug_en TEXT NOT NULL UNIQUE,slug_hu TEXT NOT NULL UNIQUE,title_en TEXT NOT NULL,title_hu TEXT NOT NULL,summary_en TEXT,summary_hu TEXT,description_en TEXT,description_hu TEXT,image_url TEXT NOT NULL,image_alt_en TEXT,image_alt_hu TEXT,visible INTEGER NOT NULL DEFAULT 1,featured INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,created_by_user_id TEXT,updated_by_user_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id) VALUES('ADMIN-1');
    INSERT INTO pianos(id,display_name) VALUES('CUSTOMER-PIANO-1','Customer piano must remain');
  `);
  app.use(express.json());
  registerWebsiteCatalogRoutes({
    app, db,
    auth: (req, _res, next) => { req.user = { id: "ADMIN-1", role: "ADMIN" }; next(); },
    permit: () => (_req, _res, next) => next(),
    audit: () => {},
    erpBaseUrl: "https://klavierhaus-erp.onrender.com"
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options = {}) => {
    const response = await fetch(`${origin}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    return { status: response.status, body: await response.json() };
  };
  try { await callback({ request, db }); }
  finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
}

test("website catalog CRUD publishes bilingual services and keeps showroom pianos separate from client pianos", async () => {
  await withServer(async ({ request, db }) => {
    const piano = await request("/api/showroom-pianos", { method: "POST", body: JSON.stringify({
      brand: "Steinway & Sons", model: "D-274", title_en: "Concert grand", title_hu: "Koncertzongora",
      summary_en: "Available by private appointment.", summary_hu: "Privát időpontban megtekinthető.",
      image_url: "/uploads/website/steinway.jpg", published: true, featured: true
    }) });
    assert.equal(piano.status, 201, JSON.stringify(piano.body));
    assert.equal(piano.body.slug_en, "concert-grand");
    assert.equal(piano.body.slug_hu, "koncertzongora");

    const publicHu = await request("/api/public/showroom-pianos?lang=hu");
    assert.equal(publicHu.status, 200);
    assert.equal(publicHu.body[0].title, "Koncertzongora");
    assert.equal(publicHu.body[0].image_url, "https://klavierhaus-erp.onrender.com/uploads/website/steinway.jpg");
    assert.equal(Object.hasOwn(publicHu.body[0], "created_by_user_id"), false, "public catalog responses must not expose internal editor IDs");
    assert.equal(Object.hasOwn(publicHu.body[0], "updated_at"), false, "public catalog responses must not expose audit metadata");

    const service = await request("/api/website-services", { method: "POST", body: JSON.stringify({
      title_en: "Concert preparation", title_hu: "Koncert-előkészítés", summary_en: "Private assessment.", summary_hu: "Személyes felmérés.", image_url: "/uploads/website/service.jpg"
    }) });
    assert.equal(service.status, 201, JSON.stringify(service.body));
    const publicService = await request(`/api/public/website-services/${service.body.slug_en}?lang=en`);
    assert.equal(publicService.body.title, "Concert preparation");
    assert.equal(Object.hasOwn(publicService.body, "price"), false, "public services must not expose a price field");

    const deleted = await request(`/api/showroom-pianos/${piano.body.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM website_showroom_pianos").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM pianos").get().count, 1, "showroom deletion must not touch client pianos");
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
});

test("public reviews require a portrait and provide bilingual localized output", async () => {
  await withServer(async ({ request }) => {
    const invalid = await request("/api/website-reviews", { method: "POST", body: JSON.stringify({ person_name: "Guest", quote_en: "English", quote_hu: "Magyar" }) });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "REVIEW_REQUIRED_FIELDS");
    const created = await request("/api/website-reviews", { method: "POST", body: JSON.stringify({
      person_name: "Artist Guest", role_en: "Pianist", role_hu: "Zongoraművész", quote_en: "An exceptional evening.", quote_hu: "Kivételes este.", portrait_url: "/uploads/website/artist.jpg", visible: true
    }) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const publicHu = await request("/api/public/website-reviews?lang=hu");
    assert.equal(publicHu.body[0].quote, "Kivételes este.");
    assert.equal(publicHu.body[0].role, "Zongoraművész");
    assert.equal(publicHu.body[0].image_url, "https://klavierhaus-erp.onrender.com/uploads/website/artist.jpg");
    assert.equal(Object.hasOwn(publicHu.body[0], "created_by_user_id"), false, "public reviews must not expose internal editor IDs");
  });
});
