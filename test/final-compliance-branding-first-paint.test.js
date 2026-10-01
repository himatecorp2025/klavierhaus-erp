"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("admin first paint is server-rendered with current branding before static fallback",()=>{
  const server=read("server/index.js");
  assert.match(server,/const ADMIN_INDEX_TEMPLATE = fs\.readFileSync/);
  assert.match(server,/function renderAdminIndex\(/);
  assert.match(server,/id="khBrandingBootstrap"/);
  assert.match(server,/fetchpriority="high"/);
  assert.match(server,/login-screen has-custom-background/);
  assert.match(server,/app\.get\(\["\/","\/index\.html"\]/);
  const brandedRoute=server.indexOf('app.get(["/","/index.html"]');
  const staticRoute=server.indexOf("app.use(express.static(PUBLIC_DIR");
  assert.ok(brandedRoute>=0&&staticRoute>brandedRoute,"Branded index must be served before generic static middleware");
});

test("branding startup consumes the server bootstrap without a second blocking request",()=>{
  const v6=read("public/v6.js");
  assert.match(v6,/function v6ReadBrandingBootstrap\(/);
  assert.match(v6,/node\.remove\(\)/);
  assert.match(v6,/function v6ApplyBrandingState\(/);
  const start=v6.indexOf("loadBranding=async function()");
  const end=v6.indexOf("/* ---------- Website CMS",start);
  const block=v6.slice(start,end);
  assert.match(block,/const bootstrap=v6ReadBrandingBootstrap\(\)/);
  assert.match(block,/if\(bootstrap\)\{v6ApplyBrandingState\(bootstrap\);return bootstrap;\}/);
  assert.ok(block.indexOf("if(bootstrap)")<block.indexOf('fetch("/api/public/branding"'),"Bootstrap must win before network fallback");
});

test("branding metadata and versioned assets are optimized for repeated loads",()=>{
  const server=read("server/index.js");
  assert.match(server,/const brandingSettingsStatement=db\.prepare/);
  assert.match(server,/SELECT setting_key,setting_value FROM app_settings/);
  assert.match(server,/brandingSettingsStatement\.all\(\.\.\.BRANDING_SETTING_KEYS\)/);
  assert.match(server,/stale-while-revalidate=300/);
  assert.match(server,/max-age=31536000, immutable/);
  assert.match(server,/branding-v6/);
  assert.match(server,/\^branding-\\d\+/);
  assert.match(server,/v6\.js/);
});
