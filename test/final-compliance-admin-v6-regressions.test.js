"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.resolve(__dirname,"..");
const round2=fs.readFileSync(path.join(root,"public","round2.js"),"utf8");
const v6=fs.readFileSync(path.join(root,"public","v6.js"),"utf8");
const css=fs.readFileSync(path.join(root,"public","styles.css"),"utf8");

test("planned job modal loads users, workflow settings and operational profiles without requiring a preloaded client list",()=>{
  assert.match(round2,/const \[,settings\]=await Promise\.all\(\[loadUsers\(\),api\("\/api\/workflow\/settings"\),typeof loadOperationalProfiles==="function"\?loadOperationalProfiles\(\{refresh:true\}\):Promise\.resolve\(null\)\]\)/);
  assert.match(round2,/jobClientSearch/);
  assert.match(round2,/openQuickClientCreate/);
  assert.match(round2,/openQuickPianoCreate/);
  assert.match(round2,/r2ResponsibleOptions\(responsible,responsibilitySkill\)/);
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


test("single-element selector helper is never iterated in active v6 workflow surfaces",()=>{
  for(const [name,source] of [["round2",round2],["v6",v6]]){
    const invalid=source.match(/(^|[^$])\$\([^\n;]*\)\.forEach/gm)||[];
    assert.deepEqual(invalid,[],name+" contains $().forEach runtime hazards: "+invalid.join(" | "));
  }
});


test("CMS website upload previews use the current ERP origin",()=>{
  const start=v6.indexOf("function v6CmsPreviewUrl");
  const end=v6.indexOf("function v6CmsMeta",start);
  assert.ok(start>=0&&end>start);
  const source=v6.slice(start,end);
  const context={window:{location:{origin:"https://erp-current.example.test"}},URL,result:null};
  vm.runInNewContext(source+`;result=[
    v6CmsPreviewUrl("/uploads/website/piano.jpg"),
    v6CmsPreviewUrl("https://erp-old.example.test/uploads/website/piano.jpg?rev=2"),
    v6CmsPreviewUrl("https://cdn.example.test/external.jpg")
  ];`,context);
  assert.deepEqual(Array.from(context.result),[
    "/uploads/website/piano.jpg",
    "/uploads/website/piano.jpg?rev=2",
    "https://cdn.example.test/external.jpg"
  ]);
});
