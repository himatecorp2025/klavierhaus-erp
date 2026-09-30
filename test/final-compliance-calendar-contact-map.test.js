"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Master Data piano dates use browser calendar controls with locale hints",()=>{
  const app=read("public/app.js"),css=read("public/styles.css");
  for(const name of ["date_of_purchase","last_serviced_at","next_service_date"]){
    assert.match(app,new RegExp('name="'+name+'" type="date"'));
  }
  assert.match(app,/function masterDateInputValue\(value\)/);
  assert.match(app,/lang="\$\{state\.language==="hu"\?"hu-HU":"en-US"\}"/);
  assert.match(css,/\.field input\[type="date"\]/);
});

test("New Planned Job uses a wide desktop modal while retaining responsive widths",()=>{
  const app=read("public/app.js"),round2=read("public/round2.js"),css=read("public/styles.css");
  assert.match(app,/function openDialog\(\{title,eyebrow="",body,variant=""\}\)/);
  assert.match(round2,/New Planned Job[\s\S]*variant:"wide"/);
  assert.match(css,/@media\(min-width:901px\)[\s\S]*\.app-dialog\.app-dialog--wide\{width:min\(1040px,calc\(100% - 48px\)\)/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*\.app-dialog\.app-dialog--wide/);
  assert.match(css,/@media\(max-width:640px\)[\s\S]*\.app-dialog\.app-dialog--wide/);
});

test("Public private consultation and viewing use calendar date-time controls",()=>{
  const server=read("website/server/index.js"),browser=read("website/public/app.js"),css=read("website/public/styles.css");
  assert.equal((server.match(/name="scheduled_at_display" type="datetime-local" step="900"/g)||[]).length,2);
  assert.equal((server.match(/data-private-calendar/g)||[]).length,2);
  assert.ok(browser.includes('match=raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})$/)'));
  assert.match(css,/\.private-appointment-dialog input\[type="datetime-local"\]/);
});

test("Contact page renders a branded address map before the contact and consultation sections",()=>{
  const server=read("website/server/index.js"),css=read("website/public/styles.css");
  assert.match(server,/function renderContactMap\(copy, language\)/);
  assert.match(server,/https:\/\/www\.google\.com\/maps\?q=\$\{query\}&output=embed/);
  assert.match(server,/const contactMap = key === "contact" \? renderContactMap\(copy, language\) : ""/);
  assert.match(server,/sections = contactMap \+ page\.sections\.filter/);
  assert.match(server,/frame-src https:\/\/www\.google\.com https:\/\/maps\.google\.com/);
  assert.match(css,/\.contact-map-shell\{/);
  assert.match(css,/\.contact-map-card\{/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.contact-map-card/);
});

test("PWA cache is bumped for calendar and date UX",()=>{
  assert.match(read("public/service-worker.js"),/klavierhaus-admin-v29-calendar-date-ux/);
});
