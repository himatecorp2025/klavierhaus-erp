"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Database = require("better-sqlite3");
const { fallbackPage, registerWebsiteContentRoutes } = require("../server/website-content");

async function withContentServer(callback) {
  const app = express();
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE website_content_pages (
      page_key TEXT NOT NULL,
      language TEXT NOT NULL CHECK(language IN ('en','hu')),
      content_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_by_user_id TEXT,
      published_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(page_key, language),
      FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    INSERT INTO users(id,name) VALUES('ADMIN-1','Website Admin');
  `);
  const auditCalls = [];
  app.use(express.json({ limit: "1mb" }));
  registerWebsiteContentRoutes({
    app,
    db,
    auth: (req, _res, next) => { req.user = { id: "ADMIN-1", role: "ADMIN" }; next(); },
    permit: () => (_req, _res, next) => next(),
    audit: (...args) => auditCalls.push(args),
    websiteBaseUrl: "https://klavierhaus-home.onrender.com",
    erpBaseUrl: "https://klavierhaus-erp.onrender.com"
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`, db, auditCalls);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
}

test("Landing Page Design content is atomically published and immediately exposed to the public website API", async () => {
  await withContentServer(async (origin, db, auditCalls) => {
    const fallback = await (await fetch(`${origin}/api/public/website-content/home?lang=en`)).json();
    assert.equal(fallback.source, "bundled");
    assert.equal(fallback.version, 0);

    const edited = fallbackPage("home", "en");
    edited.seo.title = "Edited Klavierhaus SEO title";
    edited.hero.title = "Edited public artistic statement";
    edited.sections.find((section) => section.id === "testimonial").quote = "An edited review from the design console.";
    const savedResponse = await fetch(`${origin}/api/website-content/home`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en", content: edited })
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.equal(saved.source, "database");
    assert.equal(saved.version, 1);
    assert.equal(saved.content.hero.title, "Edited public artistic statement");

    const publicResponse = await fetch(`${origin}/api/public/website-content/home?lang=en`);
    assert.match(publicResponse.headers.get("cache-control"), /max-age=0/);
    assert.match(publicResponse.headers.get("cache-control"), /must-revalidate/);
    const publicCopy = await publicResponse.json();
    assert.equal(publicCopy.content.seo.title, "Edited Klavierhaus SEO title");
    assert.equal(publicCopy.content.sections.find((section) => section.id === "testimonial").quote, "An edited review from the design console.");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM website_content_pages").get().count, 1);
    assert.equal(auditCalls.length, 1);

    const resaved = await fetch(`${origin}/api/website-content/home`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en", content: { ...edited, hero: { ...edited.hero, title: "Second atomic revision" } } })
    });
    assert.equal(resaved.status, 200);
    assert.equal((await resaved.json()).version, 2);

    const global = fallbackPage("global", "en");
    global.eventLabels.homeTitle = "An editable event-stage title.";
    global.eventLabels.buyTickets = "Secure admission";
    global.brand.wordmark = "EDITABLE KLAVIERHAUS";
    global.brand.logoImage = "https://cdn.example.com/edited-logo.png";
    const globalSaved = await fetch(`${origin}/api/website-content/global`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en", content: global })
    });
    assert.equal(globalSaved.status, 200);
    const savedGlobal = await globalSaved.json();
    assert.equal(savedGlobal.content.eventLabels.buyTickets, "Secure admission");
    assert.equal(savedGlobal.content.brand.wordmark, "EDITABLE KLAVIERHAUS");
    assert.equal(savedGlobal.content.brand.logoImage, "https://cdn.example.com/edited-logo.png");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM website_content_pages").get().count, 2);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  });
});

test("website content sanitization rejects missing SEO and prototype-pollution keys", async () => {
  await withContentServer(async (origin) => {
    const missingSeo = await fetch(`${origin}/api/website-content/home`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en", content: { hero: { title: "Incomplete" } } })
    });
    assert.equal(missingSeo.status, 400);
    assert.equal((await missingSeo.json()).error, "WEBSITE_REQUIRED_CONTENT");

    const unsafe = fallbackPage("home", "en");
    Object.defineProperty(unsafe, "constructor", { value: "blocked", enumerable: true });
    const unsafeResponse = await fetch(`${origin}/api/website-content/home`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en", content: unsafe })
    });
    assert.equal(unsafeResponse.status, 400);
    assert.equal((await unsafeResponse.json()).error, "INVALID_WEBSITE_CONTENT_KEY");
  });
});
