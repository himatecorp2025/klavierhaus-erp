const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(projectRoot, "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(projectRoot, "public", "styles.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(projectRoot, "public", "service-worker.js"), "utf8");

test("scheduler places the status legend before the calendar and has no employee legend markup", () => {
  const schedulerStart = appSource.indexOf("async function renderScheduler()");
  const schedulerEnd = appSource.indexOf("async function refreshCalendarAfterMutation", schedulerStart);
  const schedulerSource = appSource.slice(schedulerStart, schedulerEnd);
  assert.ok(schedulerSource.indexOf('class="scheduler-legend"') < schedulerSource.indexOf('class="timeline-scroll"'));
  assert.equal(schedulerSource.includes("worker-legend"), false);
  assert.match(schedulerSource, /Overdue, not closed/);
  assert.match(schedulerSource, /Failed/);
});

test("Today shares the worker filter and calendar mutations refresh the visible calendar", () => {
  const todayStart = appSource.indexOf("async function renderToday()");
  const todayEnd = appSource.indexOf("function handleDailySlotClick", todayStart);
  const todaySource = appSource.slice(todayStart, todayEnd);
  assert.match(todaySource, /schedulerFilterOptions\(workers\)/);
  assert.match(todaySource, /currentSchedulerWorker=this\.value;renderToday\(\)/);
  assert.match(appSource, /async function refreshCalendarAfterMutation/);
  assert.ok((appSource.match(/refreshCalendarAfterMutation\(/g) || []).length >= 5);
});

test("calendar status colors and warning icons follow the approved priority", () => {
  assert.match(appSource, /if\(status==="Failed"\) return "Failed";/);
  assert.match(appSource, /if\(isOverdueJob\(j\)\) return "Overdue";/);
  assert.match(appSource, /cls==="Failed" \|\| cls==="Overdue"/);
  assert.match(styles, /--calendar-partial:#f59e0b/);
  assert.match(styles, /--calendar-complete:#22c55e/);
  assert.match(styles, /--calendar-overdue:#ef4444/);
  assert.match(styles, /--calendar-failed:#6b7280/);
});

test("PWA push handlers remain present and the shell cache uses version 6.5.0", () => {
  assert.match(serviceWorker, /klavierhaus-shell-v6\.5\.0/);
  assert.match(serviceWorker, /addEventListener\('push'/);
  assert.match(serviceWorker, /addEventListener\('notificationclick'/);
  assert.match(serviceWorker, /ACKNOWLEDGE_NOTIFICATION/);
});

test("Google Calendar UI is bilingual, range-limited and preserves status-color priority", () => {
  assert.match(appSource, /Google Calendar integration','Google Naptár-integráció/);
  assert.match(appSource, /Google Calendar email","Google Naptár e-mail/);
  assert.match(appSource, /Mark as reviewed','Ellenőrzés befejezése/);
  assert.match(appSource, /jobsRangeUrl\(date,addDaysToDateKey\(date,1\)\)/);
  assert.match(appSource, /jobsRangeUrl\(weekDates\[0\],addDaysToDateKey\(weekDates\[6\],1\)\)/);
  assert.match(appSource, /calendarIntegrationClass\(j\)/);
  assert.match(styles, /timeline-event\.GoogleAttention/);
  assert.doesNotMatch(styles, /timeline-event\.GoogleAttention\{[^}]*background:/);
});
