'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

function extractBootstrapFetchHelpers() {
  const start = appSource.indexOf('const API_REQUEST_TIMEOUT_MS=');
  const end = appSource.indexOf('async function loadBranding()', start);
  assert.ok(start >= 0 && end > start, 'Bootstrap fetch helper block must exist');
  return appSource.slice(start, end);
}

test('bootstrap fetch helper aborts a permanently pending request instead of hanging forever', async () => {
  const context = {
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: (_url, opt={}) => new Promise((_resolve,reject) => {
      const signal=opt.signal;
      if(signal?.aborted)return reject(new Error('aborted'));
      signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
    }),
    console
  };
  vm.createContext(context);
  vm.runInContext(`${extractBootstrapFetchHelpers()}\nglobalThis.__fetchWithTimeout = fetchWithTimeout;`, context);
  const started = Date.now();
  await assert.rejects(
    context.__fetchWithTimeout('/api/hangs-forever', {}, 1000),
    error => error && error.code === 'REQUEST_TIMEOUT'
  );
  assert.ok(Date.now() - started < 2500, 'Pending request must fail in bounded time');
});

test('post-login boot makes a visible bootstrap state before critical API waits and has an explicit recovery UI', () => {
  const bootStart = appSource.indexOf('async function boot(){');
  const bootEnd = appSource.indexOf('function updateSidebarToggle()', bootStart);
  assert.ok(bootStart >= 0 && bootEnd > bootStart, 'boot() must exist');
  const bootBlock = appSource.slice(bootStart, bootEnd);
  const visibleIndex = bootBlock.indexOf('showApplicationBootstrapState();');
  const modulesIndex = bootBlock.indexOf('await loadAdminModuleState();');
  assert.ok(visibleIndex >= 0 && modulesIndex > visibleIndex, 'Workspace must become visibly recoverable before admin-module API waits');
  assert.match(appSource, /function handleApplicationBootstrapError\(error\)/);
  assert.match(appSource, /document\.getElementById\("app"\)\?\.classList\.remove\("hidden"\)/);
  assert.match(appSource, /retryApplicationBoot\(\)/);
  assert.match(appSource, /BOOT_WATCHDOG_MS/);
});

test('API and view rendering failures have bounded timeout and render-level fallback', () => {
  assert.match(appSource, /async function apiRequest\(url,opt=\{\}\)/);
  assert.match(appSource, /fetchWithTimeout\(url/);
  assert.match(appSource, /REQUEST_TIMEOUT/);
  assert.match(appSource, /catch\(error\)\{\s*console\.error\(`View render failed:/);
  assert.match(appSource, /This view could not be loaded\./);
  assert.match(appSource, /A nézet betöltése nem sikerült\./);
});

test('login completion and persisted-session startup both attach a bootstrap failure handler', () => {
  assert.match(appSource, /function completeLoginSession[\s\S]*?void boot\(\)\.catch\(handleApplicationBootstrapError\)/);
  assert.match(appSource, /if\(token\)\{loadLanguage\(\);loadTheme\(\);void boot\(\)\.catch\(handleApplicationBootstrapError\);\}/);
  assert.match(appSource, /window\.addEventListener\("unhandledrejection"/);
  assert.match(appSource, /window\.addEventListener\("error"/);
});

test('session modal synchronization is state-aware and repeated observer callbacks cannot restart the timer forever', () => {
  const start = appSource.indexOf('function createSessionActivityController(');
  const end = appSource.indexOf('function updateCountdownDisplay()', start);
  assert.ok(start >= 0 && end > start, 'Session controller factory must exist');
  const source = appSource.slice(start, end);
  let timerStarts = 0;
  let timerClears = 0;
  let nextId = 1;
  const context = {
    setTimeout: () => { timerStarts += 1; return nextId++; },
    clearTimeout: () => { timerClears += 1; },
    Date,
    console
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__createSessionActivityController=createSessionActivityController;`, context);
  const controller = context.__createSessionActivityController({
    timeoutMs: 600000,
    setTimer: context.setTimeout,
    clearTimer: context.clearTimeout,
    now: () => 1000,
    canRun: () => true
  });
  controller.resetTimer();
  assert.equal(timerStarts, 1);
  controller.setModalCount(0);
  controller.setModalCount(0);
  controller.setModalCount(0);
  assert.equal(timerStarts, 1, 'Unchanged modal count must not repeatedly reset the inactivity timer');
  controller.setModalCount(1);
  assert.equal(controller.snapshot().paused, true);
  controller.setModalCount(1);
  assert.equal(timerStarts, 1, 'Repeated open-state sync must remain a no-op');
  controller.setModalCount(0);
  assert.equal(timerStarts, 2, 'Timer restarts exactly once when the final modal closes');
  assert.ok(timerClears >= 1);
});

test('bootstrap validates /api/me first and 401/auth failures return to a clean login state', () => {
  assert.match(appSource, /function safeStoredJson\(key,fallback=null\)/);
  assert.match(appSource, /async function validateAuthenticatedSession\(\)/);
  assert.match(appSource, /apiRequest\("\/api\/me"/);
  assert.match(appSource, /response\.status===401/);
  assert.match(appSource, /localStorage\.removeItem\("kh_token"\)/);
  assert.match(appSource, /localStorage\.removeItem\("kh_user"\)/);
  const bootStart = appSource.indexOf('async function boot(){');
  const bootEnd = appSource.indexOf('function updateSidebarToggle()', bootStart);
  const bootBlock = appSource.slice(bootStart, bootEnd);
  const validateIndex = bootBlock.indexOf('await validateAuthenticatedSession()');
  const hideLoginIndex = bootBlock.indexOf('document.getElementById("login")?.classList.add("hidden")');
  assert.ok(validateIndex >= 0 && hideLoginIndex > validateIndex, 'Token must be validated before the login screen is hidden');
});
