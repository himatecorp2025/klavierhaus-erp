"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const round2=fs.readFileSync(path.join(root,"public","round2.js"),"utf8");
const v6=fs.readFileSync(path.join(root,"public","v6.js"),"utf8");
const css=fs.readFileSync(path.join(root,"public","styles.css"),"utf8");

test("planned job modal keeps workflow settings in the correct Promise.all slot",()=>{
  assert.match(round2,/const \[clients,,settings\]=await Promise\.all\(\[loadClients\(\),loadUsers\(\)\.then\(\(\)=>null\),api\("\/api\/workflow\/settings"\)\]\)/);
  assert.doesNotMatch(round2,/const \[clients,settings\]=await Promise\.all\(\[loadClients\(\),loadUsers\(\)\.then\(\(\)=>null\),api\("\/api\/workflow\/settings"\)\]\)/);
});

test("calendar collection bindings use querySelectorAll and create binding is top-level",()=>{
  assert.match(round2,/\$\$\("\[data-calendar-job\]",host\)\.forEach/);
  assert.match(round2,/function r2BindCalendarCreate\(host\)\{\s*\$\$\("\[data-calendar-date\]",host\)\.forEach/);
  const pointer=round2.indexOf("function r2BindCalendarPointer(host,jobs)");
  const create=round2.indexOf("function r2BindCalendarCreate(host)");
  const render=round2.indexOf("async function r2RenderCalendar()");
  assert.ok(pointer>=0&&create>pointer&&render>create);
  const pointerBody=round2.slice(pointer,create);
  assert.match(pointerBody,/\$\$\("\[data-calendar-job\]",host\)\.forEach/);
});

test("CMS focal-point controls bind as collections",()=>{
  assert.match(v6,/for\(const axis of \["x","y"\]\)\$\$\(`\[data-cms-focal-\$\{axis\}\]`,host\)\.forEach/);
  assert.doesNotMatch(v6,/for\(const axis of \["x","y"\]\)\$\(`\[data-cms-focal-\$\{axis\}\]`,host\)\.forEach/);
});

test("branding file controls bind as a collection",()=>{
  assert.match(v6,/\$\$\("\[data-brand-file\]",host\)\.forEach/);
  assert.doesNotMatch(v6,/(^|[^$])\$\("\[data-brand-file\]",host\)\.forEach/);
});

test("dark mode regression layer removes hard-coded white operational surfaces",()=>{
  assert.match(css,/ADMIN UX V6 REGRESSION FIXES/);
  assert.match(css,/\.client-row \.count\{[\s\S]*background:var\(--surface-2\)/);
  assert.match(css,/\.dialog-card\{[\s\S]*background:var\(--surface\)/);
  assert.match(css,/\.cms-toggle-row,[\s\S]*background:var\(--surface-2\)/);
  assert.match(css,/\.client-row\{[\s\S]*grid-template-columns:minmax\(0,1fr\) 44px/);
});
