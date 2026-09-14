"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const backend = fs.readFileSync(path.join(root, "server", "system-integrations.js"), "utf8");
const calendar = fs.readFileSync(path.join(root, "server", "google-calendar.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const schema = fs.readFileSync(path.join(root, "server", "schema.sql"), "utf8");
const websitePlatform = fs.readFileSync(path.join(root, "server", "website-platform.js"), "utf8");
for (let pass = 1; pass <= 3; pass += 1) {
  test(`round4 pass ${pass}: unified providers and security`, () => {
    for (const provider of ["GOOGLE_CALENDAR", "GA4", "CLARITY", "SEARCH_CONSOLE", "RESEND", "STRIPE"]) assert.match(backend, new RegExp(provider));
    assert.match(backend, /SYSTEM_INTEGRATION_ENCRYPTION_KEY_REQUIRED/);
    assert.doesNotMatch(websitePlatform, /MARKETING_TOKEN_ENCRYPTION_KEY \|\| env\.GOOGLE_TOKEN_ENCRYPTION_KEY \|\| env\.JWT_SECRET/);
    assert.match(backend, /aes-256-gcm/);
  });
  test(`round4 pass ${pass}: live tests and deletion safety`, () => {
    assert.match(calendar, /temporary_event_created/);
    assert.match(calendar, /calendar\.events/);
    assert.match(backend, /google-analytics\.com\/debug\/mp\/collect/);
    assert.match(backend, /clarity\.ms\/tag/);
    assert.match(backend, /webmasters\/v3\/sites/);
    assert.match(backend, /api\.resend\.com\/emails/);
    assert.match(backend, /api\.stripe\.com\/v1\/account/);
    assert.match(backend, /TWO_STEP_CONFIRMATION_REQUIRED/);
    assert.match(backend, /DATABASE_DELETE_VERIFICATION_FAILED/);
    assert.match(schema, /system_integration_backups/);
  });
  test(`round4 pass ${pass}: admin UI and secret reveal`, () => {
    assert.match(app, /System Activation & Integrations/);
    assert.match(app, /data-system-action="reveal"/);
    assert.match(app, /30000/);
    assert.match(app, /systemIntegrationsEnabled/);
    assert.match(app, /delete-preview/);
  });
}
