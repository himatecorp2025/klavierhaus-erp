const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');

const styles = read('website/public/styles.css');
const designV3 = read('website/public/design-v3.css');
const app = read('website/public/app.js');

const ERP_BASELINE = {
  'public/styles.css': '434bda003f06ac4b02391f5a2dd8bbaaa433675913f3bfc0af27d40259f056d7',
  'public/app.js': '745ca032947ab36ecca0b9669cdb52cc4688051e0e2a80803d71e9cfc0299549',
  'server/index.js': '39c4e79b9f3e0ee2cfe9975ead466acc12c1981c5021c4368ccfe343e9f032b2'
};

function themeRuntime() {
  const start = app.indexOf('const klavierhausThemePreferenceKey');
  const endMarker = 'document.querySelectorAll("[data-theme-toggle]").forEach';
  const listenerStart = app.indexOf(endMarker, start);
  const listenerEndMarker = '  applyPublicTheme(next);\n}));';
  const listenerEndStart = app.indexOf(listenerEndMarker, listenerStart);
  const listenerEnd = listenerEndStart + listenerEndMarker.length;
  assert.ok(start >= 0 && listenerStart > start && listenerEndStart > listenerStart, 'theme runtime block not found');
  const source = app.slice(start, listenerEnd);

  const attrs = new Map();
  const storage = new Map();
  const icon = { classList: { add() {} }, innerHTML: '' };
  const buttonAttrs = new Map();
  const button = {
    setAttribute(name, value) { buttonAttrs.set(name, String(value)); },
    addEventListener(_name, handler) { this.handler = handler; }
  };
  const documentElement = {
    lang: 'en',
    dataset: {},
    style: { removeProperty() {} },
    setAttribute(name, value) {
      attrs.set(name, String(value));
      if (name === 'data-theme') this.dataset.theme = String(value);
    }
  };
  const context = {
    Intl,
    Date,
    document: {
      documentElement,
      querySelectorAll(selector) {
        if (selector === '[data-theme-icon]') return [icon];
        if (selector === '[data-theme-toggle]') return [button];
        return [];
      }
    },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, attrs, storage, icon, button, buttonAttrs };
}

test('Színtoken szerződés: Museum Ivory & Antique Brass palette teljes', () => {
  assert.match(styles, /:root\[data-theme="light"\]/);
  for (const token of ['#F7F5EF', '#F1EDE4', '#FCFBF7', '#FFFEFA', '#F2EEE8', '#171817', '#292B2A', '#555550', '#77736B', '#80642F', '#B89A61', '#E5E0D6', '#181917']) {
    assert.ok(styles.includes(token), `Hiányzó light token: ${token}`);
  }
  assert.match(styles, /--color-border-gold:\s*rgba\(128, 100, 47, 0\.35\)/);
  assert.match(styles, /\.site-footer[\s\S]*background:\s*#181917/);
});

test('Hero védelem: light módban is cinematic, világos szöveggel', () => {
  const lightStart = styles.indexOf('/* Sotheby\'s Editorial Light Mode');
  assert.ok(lightStart >= 0, 'authoritative light theme block missing');
  const light = styles.slice(lightStart);
  assert.match(light, /html\[data-theme="light"\] \.hero h1\s*\{\s*color:\s*#FFFFFF !important;/);
  assert.match(light, /html\[data-theme="light"\] \.hero-lead[\s\S]*#D4CEBF !important;/);
  assert.match(light, /html\[data-theme="light"\] \.hero \.eyebrow[\s\S]*#C5A059 !important;/);
  assert.match(light, /\.hero-shade[\s\S]*rgba\(4, 4, 3, 0\.80\)/);
  assert.doesNotMatch(light, /\.hero h1\s*\{[^}]*var\(--color-heading\)/);
});

test('CSS konfliktusmentesség: design-v3 kizárólag layout/typography/responsive felelősségű', () => {
  assert.doesNotMatch(designV3, /!important/i);
  assert.doesNotMatch(designV3, /(?:^|[;{\s])(background(?:-color)?|color|border(?:-[a-z-]+)?|box-shadow)\s*:/im);
  assert.match(designV3, /--kh-gutter:/);
  assert.match(designV3, /grid-template-columns:/);
  assert.match(designV3, /font-size:/);
  assert.match(designV3, /@media \(max-width: 767px\)/);
});

test('SVG témaváltó: nincs emoji, tiszta vonalas SVG markupot használ', () => {
  const start = app.indexOf('function themeIconSvg');
  const end = app.indexOf('function applyPublicTheme', start);
  const block = app.slice(start, end);
  assert.match(block, /<svg viewBox="0 0 24 24"/);
  assert.match(block, /<circle cx="12" cy="12" r="3\.6"\/?>/);
  assert.match(block, /<path d="M20\.2 15\.2/);
  assert.doesNotMatch(block, /☀|☾|🌞|🌙/);
  assert.match(styles, /\.theme-toggle__icon svg[\s\S]*stroke:\s*currentColor/);
});

test('Solar & override engine: 07:00–19:00 light, manual localStorage override perzisztens', () => {
  const runtime = themeRuntime();
  const { context, storage, attrs, icon, button, buttonAttrs } = runtime;
  assert.equal(vm.runInContext('solarTheme(new Date("2026-09-15T12:00:00-04:00"))', context), 'light');
  assert.equal(vm.runInContext('solarTheme(new Date("2026-09-15T20:00:00-04:00"))', context), 'dark');
  assert.equal(vm.runInContext('solarTheme(new Date("2026-09-15T07:00:00-04:00"))', context), 'light');
  assert.equal(vm.runInContext('solarTheme(new Date("2026-09-15T19:00:00-04:00"))', context), 'dark');

  vm.runInContext('applyPublicTheme("light")', context);
  assert.equal(attrs.get('data-theme'), 'light');
  assert.match(icon.innerHTML, /<path d="M20\.2 15\.2/);
  assert.equal(buttonAttrs.get('data-current-theme'), 'light');

  button.handler();
  assert.equal(storage.get('theme_preference'), 'dark');
  assert.equal(attrs.get('data-theme'), 'dark');

  storage.set('theme_preference', 'light');
  vm.runInContext('initializeSolarTheme()', context);
  assert.equal(attrs.get('data-theme'), 'light');
});

test('Scope védelem: ERP/admin fájlok byte-azonosan változatlanok', () => {
  for (const [rel, expected] of Object.entries(ERP_BASELINE)) {
    assert.equal(sha(rel), expected, `${rel} módosult, pedig ERP/admin scope-on kívül van`);
  }
});
