"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Messenger navigation uses one frame and reply-waiting uses a clock instead of a dot",()=>{
  const ui=read("public/messenger-responsive-v3.js"),css=read("public/styles.css");
  assert.match(ui,/messenger-reply-waiting/);
  assert.match(ui,/messengerNavIcon\("waiting"\)/);
  assert.doesNotMatch(ui,/messenger-unread-dot/);
  assert.match(css,/\.messenger-status-card\.messenger-nav-button>\.messenger-nav-glyph/);
  assert.match(css,/border:0!important;border-radius:inherit!important/);
  assert.match(css,/\.messenger-reply-waiting svg/);
});

test("desktop Messenger height is derived from the app grid instead of a magic viewport subtraction",()=>{
  const css=read("public/styles.css");
  assert.match(css,/@media\(min-width:701px\)[\s\S]*\.app-shell\.messenger-mode\{height:var\(--kh-visual-viewport-height,100dvh\)/);
  assert.match(css,/\.messenger-workspace\{[\s\S]*grid-template-rows:auto auto minmax\(0,1fr\)!important/);
  assert.match(css,/\.messenger-workspace \.messenger-shell\{[\s\S]*height:100%!important;max-height:none!important/);
});

test("Intake assessment cards have non-overlapping header rows and a single combined currency field",()=>{
  const v6=read("public/v6.js"),css=read("public/styles.css");
  assert.match(v6,/assessment-option-head/);
  assert.match(v6,/assessment-price-currency/);
  assert.match(css,/\.assessment-option-head>input\[type="checkbox"\]/);
  assert.match(css,/\.assessment-price\{[\s\S]*grid-template-columns:auto minmax\(0,1fr\)!important/);
  assert.match(css,/\.assessment-price input\{[\s\S]*border:0!important[\s\S]*background:transparent!important/);
});

test("Intake deletion has a verified UI response and production-schema-safe archive path",()=>{
  const v6=read("public/v6.js"),archive=read("server/archive-center.js");
  assert.match(v6,/if\(!result\?\.ok\)throw new Error\("INTAKE_DELETE_FAILED"\)/);
  assert.match(v6,/state\.intake=\(state\.intake\|\|\[\]\)\.filter/);
  assert.match(archive,/tableExists\("intake_assessment_email_log"\)\?db\.prepare/);
  assert.match(archive,/tableExists\("jobs"\)\?db\.prepare/);
  assert.match(archive,/Number\(deleted\.changes\)!==1/);
  assert.match(archive,/deleted_intake_id:id/);
});

test("Master Data search persists across subfilters while technical import-history panels stay hidden",()=>{
  const app=read("public/app.js");
  assert.match(app,/state\.masterSearchOpen=Boolean\(masterQuery\(\)\)/);
  assert.match(app,/state\.masterSearch=event\.currentTarget\.value;state\.masterSearchOpen=true/);
  assert.match(app,/searchActive=Boolean\(state\.masterSearchOpen\|\|masterQuery\(\)\)/);
  assert.doesNotMatch(app,/Imported source history|Importált forráselőzmények/);
  assert.doesNotMatch(app,/Source data|Forrásadatok/);
  assert.doesNotMatch(app,/masterClientSourceHistoryMarkup|masterPianoSourceMarkup/);
});

test("PWA cache is bumped for frontend polish v28",()=>{
  assert.match(read("public/service-worker.js"),/klavierhaus-admin-v28-frontend-polish/);
});
