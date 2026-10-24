"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createCorsOptions, allowedCorsOrigins, canonicalOrigin } = require("../server/cors-policy");

function allowedByCors(options, origin) {
  let decision;
  options.origin(origin, (error, result) => {
    assert.equal(error, null);
    decision = result;
  });
  return decision;
}

test("production ERP CORS allows only known browser origins and no wildcard", () => {
  const options = createCorsOptions({ NODE_ENV: "production" });
  for (const origin of ["https://klavierhaus.com", "https://www.klavierhaus.com", "https://admin.klavierhaus.com", "https://klavierhaus-home.onrender.com"]) {
    assert.equal(allowedByCors(options, origin), true, origin);
  }
  for (const origin of ["https://attacker.invalid", "null", "http://localhost:3030", "https://klavierhaus.com.attacker.invalid", undefined]) {
    assert.equal(allowedByCors(options, origin), false, String(origin));
  }
});

test("CORS optional HTTPS origins are explicit and untrusted HTTP hosts are ignored", () => {
  const env = { NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "https://partner.example, http://attacker.invalid, https://second.example/", APP_BASE_URL: "https://admin.klavierhaus.com" };
  const allowed = allowedCorsOrigins(env);
  assert.ok(allowed.has("https://partner.example"));
  assert.ok(allowed.has("https://second.example"));
  assert.ok(!allowed.has("http://attacker.invalid"));
  assert.equal(allowedByCors(createCorsOptions(env), "https://partner.example"), true);
  assert.equal(allowedByCors(createCorsOptions(env), "https://attacker.invalid"), false);
  assert.equal(canonicalOrigin("javascript:alert(1)"), "");
});

test("ERP attaches restricted CORS and defensive response headers before API routes", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
  assert.match(source, /app\.use\(cors\(createCorsOptions\(process\.env\)\)\)/);
  assert.match(source, /"X-Frame-Options", "DENY"/);
  assert.match(source, /"X-Content-Type-Options", "nosniff"/);
});
