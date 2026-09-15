const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');

test('New Job uses US numeric date and one half-hour dropdown from 07:00 AM to 09:00 PM with 10:00 AM default', () => {
  assert.match(app, /function formatAmericanDate\(/);
  assert.match(app, /MM\/DD\/YYYY/);
  assert.match(app, /function halfHourOptions\(selected='10:00'\)/);
  assert.match(app, /for\(let minutes=7\*60;minutes<=21\*60;minutes\+=30\)/);
  assert.match(app, /requestedDate}T10:00/);
  assert.match(app, /jobDateTimePickerMarkup\('jobStart'/);
  assert.doesNotMatch(app, /quarterHourPickerMarkup\('jobStart'/);
});

test('Daily Rate uses a modern switch and hides allocation when disabled', () => {
  assert.match(app, /class="daily-rate-switch"/);
  assert.match(app, /daily-rate-switch-track/);
  assert.match(app, /dailyRateAllocationField/);
  assert.match(app, /classList\.toggle\('hidden',!enabled\)/);
  assert.match(css, /\.daily-rate-switch input:checked \+ \.daily-rate-switch-track/);
});

test('Calendar drag keeps 15-minute geometry snapping, realtime HUD and requestAnimationFrame ghost movement', () => {
  assert.match(app, /const SCHEDULE_INTERVAL_MINUTES=15/);
  assert.match(app, /Math\.round\(raw\/SCHEDULE_INTERVAL_MINUTES\)\*SCHEDULE_INTERVAL_MINUTES/);
  assert.match(app, /updateSchedulerDragHud\(state\.target\?\.date\?state\.target:null\)/);
  assert.match(app, /time12Label\(start\.slice\(11,16\)\)/);
  assert.match(app, /requestAnimationFrame\(/);
  assert.match(css, /\.scheduler-drag-ghost\{[^}]*will-change:transform/);
});

test('Workflow and job cards have distinct SVG type badges and readable minimum heights', () => {
  assert.match(app, /function calendarTypeIconMarkup\(/);
  assert.match(app, /is-workflow/);
  assert.match(app, /is-job/);
  assert.match(app, /<svg viewBox="0 0 24 24"/);
  assert.match(css, /\.timeline-event\{min-height:72px!important/);
  assert.match(css, /\.timeline-event\.WorkflowTask\{min-height:80px!important/);
  assert.match(css, /\.calendar-type-badge svg\{width:13px;height:13px/);
  assert.match(css, /\.event-status\{[^}]*width:18px;height:18px/);
});

test('Workflow card click stays in scheduler and opens the local drawer', () => {
  assert.match(app, /if\(\["WORKFLOW_DEADLINE","WORKFLOW_TASK"\]\.includes\(row\?\.calendar_entry_type\)\)\{\s*await openSchedulerWorkflowDrawer\(row\);return;/);
  assert.match(app, /function closeSchedulerWorkflowDrawer\(/);
  assert.match(css, /\.scheduler-workflow-drawer-host\.is-open\{display:block\}/);
  assert.match(css, /height:100dvh!important/);
});
