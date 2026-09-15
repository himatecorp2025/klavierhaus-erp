const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const app = read("public/app.js");
const css = read("public/styles.css");
const webCss = read("website/public/styles.css");
const design = read("website/public/design-v3.css");
const webApp = read("website/public/app.js");
const webServer = read("website/server/index.js");

test("CSS consolidation removes design-v3 from runtime", () => {
  assert.match(webCss, /Consolidated from design-v3\.css/);
  assert.doesNotMatch(webServer, /design-v3\.css/);
  assert.match(design, /Intentionally empty/);
});

test("New Job uses hybrid MM\/DD\/YYYY calendar and half-hour single select", () => {
  assert.match(app, /placeholder="MM\/DD\/YYYY"/);
  assert.match(app, /data-job-date-button/);
  assert.match(app, /adminDatePickerOpen\(proxy/);
  assert.match(app, /for\(let minutes=7\*60;minutes<=21\*60;minutes\+=30\)/);
  assert.match(app, /defaultTime='10:00'/);
  assert.match(css, /\[data-job-time\]\{appearance:none/);
});

test("Scheduler enters with All Jobs and obsolete reassignment helper is removed", () => {
  assert.match(app, /if\(currentSchedulerWorker===null\)\{\s*currentSchedulerWorker="ALL";/);
  assert.doesNotMatch(app, /Drag a job here to reassign:/);
});

test("Review carousel is horizontal-only and height-stabilized", () => {
  assert.match(webApp, /track\.style\.transform = `translate3d\(-\$\{activeIndex \* 100\}%, 0, 0\)`/);
  assert.doesNotMatch(webApp, /cards\[activeIndex\]\.scrollIntoView/);
  assert.match(webApp, /stabilizeHeight/);
  assert.match(webCss, /\.review-track\{display:flex!important/);
  assert.match(webCss, /min-height:var\(--review-slide-height\)/);
});

test("date and time controls expose clear focus states without native spinners", () => {
  assert.match(css, /job-date-entry:focus-within/);
  assert.match(css, /job-datetime-control \[data-job-time\]:focus/);
  assert.match(css, /::-webkit-inner-spin-button/);
});

test("Workflow reference date also supports typed MM/DD/YYYY plus the shared dark calendar popup", () => {
  assert.match(app, /class="workflow-date-text"/);
  assert.match(app, /placeholder="MM\/DD\/YYYY"/);
  assert.match(app, /class="workflow-date-picker-button"/);
  assert.match(app, /workflowOpenDatePicker\(input,button\|\|picker\)/);
  assert.match(css, /workflow-date-picker\.workflow-date-picker--primary/);
});
