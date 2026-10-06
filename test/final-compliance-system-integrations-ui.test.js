"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

function read(file){return fs.readFileSync(path.join(__dirname,"..",file),"utf8");}

test("V6 exposes dedicated System Activation & Integrations admin workspace",()=>{
  const app=read("public/app.js"),v6=read("public/v6.js");
  assert.match(app,/activeViews=new Set\(\[[^\]]*"system_integrations"/);
  assert.match(app,/state\.view==="system_integrations"\)await renderSystemIntegrations\(\)/);
  assert.match(v6,/async function renderSystemIntegrations\(\)/);
  assert.match(v6,/data-nav="system_integrations"/);
  assert.match(v6,/data-profile-menu="system_integrations"/);
  assert.match(v6,/Rendszeraktiválás és integrációk/);
});

test("Settings remains a general user view and no longer embeds Google activation",()=>{
  const v6=read("public/v6.js");
  const start=v6.indexOf("async function renderSettings(){");
  const end=v6.indexOf("/* ---------- Direct expense document upload ---------- */",start);
  assert.ok(start>=0&&end>start);
  const settings=v6.slice(start,end);
  assert.doesNotMatch(settings,/googleStatus/);
  assert.doesNotMatch(settings,/googleCalendarConnect/);
  assert.doesNotMatch(settings,/\bsuperadmin\b/);
  assert.match(settings,/Appearance & language/);
});

test("Google Calendar operational OAuth is available to every ADMIN and returns to integrations view",()=>{
  const server=read("server/index.js");
  assert.match(server,/app\.get\('\/api\/google-calendar\/auth-url',auth,permit\('ADMIN'\)/);
  assert.match(server,/app\.delete\('\/api\/google-calendar\/disconnect',auth,permit\('ADMIN'\)/);
  assert.match(server,/\?view=system_integrations&googleCalendar=connected/);
  assert.match(server,/\?view=system_integrations&googleCalendarTest=authorized/);
  assert.match(server,/\?view=system_integrations&googleCalendar=error/);
});
