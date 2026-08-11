const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(projectRoot, "public", "app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(projectRoot, "public", "index.html"), "utf8");
const styles = fs.readFileSync(path.join(projectRoot, "public", "styles.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(projectRoot, "public", "service-worker.js"), "utf8");
const serverSource = fs.readFileSync(path.join(projectRoot, "server", "index.js"), "utf8");

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

test("PWA push handlers remain present and the tuned shell cache is refreshed", () => {
  assert.match(serviceWorker, /klavierhaus-shell-v6\.5\.0-ui4/);
  assert.match(serviceWorker, /if\(cached\)\{event\.waitUntil\(network/);
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

test("calendar cards expose the approved compact work summary responsively", () => {
  const cardStart = appSource.indexOf("function calendarCardAmount(j)");
  const cardEnd = appSource.indexOf("function ensureView", cardStart);
  const cardSource = appSource.slice(cardStart, cardEnd);
  assert.match(cardSource, /client_name/);
  assert.match(cardSource, /calendarCardAmount/);
  assert.match(cardSource, /assigned_to/);
  assert.match(cardSource, /service_address/);
  assert.match(cardSource, /EventCompact/);
  assert.match(cardSource, /EventMedium/);
  assert.match(styles, /EventCompact \.event-card-primary/);
  assert.match(styles, /EventMedium \.event-card-secondary/);
  assert.doesNotMatch(styles, /timeline-event small\{display:none\}/);
});

test("job details render one language immediately and expose only curated pending Google fields", () => {
  const detailsStart = appSource.indexOf("function googleImportDateTime(value)");
  const detailsEnd = appSource.indexOf("async function reviewGoogleCalendarJob", detailsStart);
  const detailsSource = appSource.slice(detailsStart, detailsEnd);
  assert.match(detailsSource, /async function openJobDetails\(summary\)/);
  assert.match(detailsSource, /await api\(`\/api\/jobs\/\$\{encodeURIComponent\(jobRef\(summary\)\)\}`\)/);
  assert.match(detailsSource, /bi\('Job details','Munka részletei'\)/);
  assert.match(detailsSource, /calendar_import/);
  assert.match(detailsSource, /showGoogleBanner=j\.calendar_source==='GOOGLE'&&\(!j\.calendar_reviewed_at\|\|googleAttention\)/);
  assert.match(detailsSource, /Event title','Esemény címe/);
  assert.match(detailsSource, /Description','Leírás/);
  assert.match(detailsSource, /Location','Helyszín/);
  assert.match(detailsSource, /Start','Kezdés/);
  assert.match(detailsSource, /End','Befejezés/);
  assert.match(detailsSource, /Creator','Létrehozó/);
  assert.match(detailsSource, /Attendees','Résztvevők/);
  assert.doesNotMatch(detailsSource, /Google link/);
  assert.doesNotMatch(detailsSource, /External event/);
  assert.doesNotMatch(detailsSource, />Close \/ Bezár</);
  assert.doesNotMatch(detailsSource, />Edit job \/ Munka szerkesztése</);
  assert.match(styles, /google-import-row dd\{[^}]*overflow-wrap:anywhere/);
});

test("manual scheduling uses wall-clock arithmetic, five-minute steps and readable durations", () => {
  assert.match(appSource, /function addWallClockMinutes/);
  assert.match(appSource, /function wallClockDifferenceMinutes/);
  assert.match(appSource, /function isFiveMinuteDateTime/);
  assert.match(appSource, /function formatDurationLabel/);
  assert.match(appSource, /preservesExistingExactTime/);
  assert.match(appSource, /const timesUnchanged=Boolean/);
  assert.ok((appSource.match(/step="300"/g) || []).length >= 4);
  assert.match(appSource, /const dateTimeStep=preservesExistingExactTime\?"any":"300"/);
  assert.match(appSource, /INVALID_TIME_STEP/);
  assert.match(appSource, /INVALID_PLANNED_DURATION/);
  assert.match(serverSource, /function localDateTimeValue/);
  assert.match(serverSource, /function isFiveMinuteTime/);
  assert.match(serverSource, /planned_minutes=timeRangeMinutes/);
});

test("login password visibility starts hidden and the eye icon reflects the real state", () => {
  assert.match(indexSource, /id="loginPassword"[^>]*type="password"/);
  assert.match(indexSource, /id="toggleLoginPassword"[^>]*password-hidden[\s\S]*?password-eye-shape[\s\S]*?password-eye-slash/);
  assert.match(appSource, /password\.type="password"/);
  assert.match(appSource, /function initializePasswordVisibilityToggle/);
  assert.match(appSource, /toggle\.classList\.toggle\("password-visible",visible\)/);
  assert.match(appSource, /toggle\.classList\.toggle\("password-hidden",!visible\)/);
  assert.match(appSource, /if\(!toggle\.querySelector\("\.password-eye-icon"\)\)/);
  assert.match(appSource, /visible\?bi\("Hide password","Jelszó elrejtése"\):bi\("Show password","Jelszó megjelenítése"\)/);
  assert.match(styles, /\.password-toggle\{color:var\(--text\)!important;opacity:1!important;visibility:visible!important/);
  assert.match(styles, /\.password-toggle\.password-visible \.password-eye-slash\{opacity:0/);
  assert.match(styles, /\.password-toggle\.password-hidden \.password-eye-slash\{opacity:1/);
});

test("user editor requires exact password confirmation and provides two independent visibility controls", () => {
  assert.match(appSource, /id="userPassword" name="password" type="password"/);
  assert.match(appSource, /id="userPasswordConfirmation" name="password_confirmation" type="password"/);
  assert.match(appSource, /id="toggleUserPassword"/);
  assert.match(appSource, /id="toggleUserPasswordConfirmation"/);
  assert.match(appSource, /body\.password!==body\.password_confirmation/);
  assert.match(appSource, /PASSWORD_CONFIRMATION_MISMATCH/);
  assert.match(appSource, /User and password updated successfully\./);
});

test("new accounts collect a real contact email and complete one-time activation before boot", () => {
  assert.match(indexSource, /id="activationForm"/);
  assert.match(indexSource, /id="activationCode"[^>]*inputmode="numeric"[^>]*maxlength="6"/);
  assert.match(appSource, /function showAccountActivationStep/);
  assert.match(appSource, /activation_required/);
  assert.match(appSource, /\/api\/account-activation\/verify/);
  assert.match(appSource, /\/api\/account-activation\/resend/);
  assert.match(appSource, /name="contact_email" type="email"/);
  assert.match(appSource, /\.local address cannot be used/);
  assert.match(appSource, /resendUserActivation/);
  assert.match(appSource, /pendingAccountActivation=null/);
  assert.doesNotMatch(appSource, /localStorage\.setItem\(["'][^"']*activation/i);
});

test("views and modal content are localized before they become visible", () => {
  assert.match(appSource, /function currentLanguageRoot/);
  assert.match(appSource, /target\.classList\.add\("i18n-rendering"\)/);
  assert.match(appSource, /applyLanguageToDOM\(target\)/);
  assert.match(appSource, /function initLocalizedModalRendering/);
  assert.match(appSource, /observer\.observe\(form,\{childList:true\}\)/);
  assert.match(appSource, /function looksLikeBilingualUiText/);
  assert.match(appSource, /Telefon\|Hely\|Zongora/);
  assert.match(appSource, /!looksLikeBilingualUiText\(node\.nodeValue\)/);
  assert.match(styles, /\.view\.i18n-rendering,\.modal\.i18n-rendering \.modal-box\{visibility:hidden\}/);
});

test("modal layouts cannot create horizontal scrolling on desktop, mobile or PWA", () => {
  assert.match(styles, /\.modal-box\{overflow-x:hidden;overflow-y:auto/);
  assert.match(styles, /#form\{width:100%;overflow-x:hidden\}/);
  assert.match(styles, /overflow-wrap:anywhere/);
  assert.match(styles, /#form :where\(table\)\{width:100%;max-width:100%;table-layout:fixed\}/);
  assert.match(styles, /\.import-preview-table\{max-width:100%;overflow-x:hidden!important/);
});

test("large master lists are cached, coalesced and searched with debounce", () => {
  assert.match(appSource, /CACHEABLE_MASTER_ENDPOINTS/);
  assert.match(appSource, /apiResponseCache/);
  assert.match(appSource, /function scheduleContactsRender/);
  assert.match(appSource, /function schedulePianosRender/);
  assert.match(appSource, /275/);
  assert.match(appSource, /document\.visibilityState!=="hidden"/);
  assert.match(serverSource, /compression\(\{threshold:1024\}\)/);
  assert.match(serverSource, /busy_timeout = 5000/);
});
