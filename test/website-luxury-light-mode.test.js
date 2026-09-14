const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');

const styles = read('website/public/styles.css');
const designV3 = read('website/public/design-v3.css');
const app = read('website/public/app.js');
const websiteServer = read('website/server/index.js');

// Baseline hashes of ERP/admin files from the supplied source ZIP. These files are out of scope.
const ERP_BASELINE = {
  'public/styles.css': 'f700d359009225386a3d404197855b9417f5d33b90b11b2e2e98cfd61990ebed',
  'public/app.js': '63f9c51ee6e8a5289c1b99a098eb572b6ab5bdde76c41737de4844f2e8b5e198',
  'server/index.js': '0e411aa38ccba9c8f0ad30d53e3b424bf8565f6e1ddc3f5d8fc4c63b3838422b'
};

test('Luxury Light token contract uses Ivory, Ebony & Brass palette', () => {
  assert.match(styles, /:root\[data-theme="light"\]/);
  for (const token of ['#F7F5EF', '#F1EDE4', '#FCFBF7', '#FFFEFA', '#ECE7DD', '#F3F0E8', '#171817', '#292B2A', '#555550', '#77736B', '#A09A90', '#A98442', '#B89A61', '#80642F', '#C8AD76', '#191A18']) {
    assert.ok(styles.includes(token), `Missing luxury light token ${token}`);
  }
  assert.match(styles, /--color-border:\s*rgba\(41, 43, 42, 0\.12\)/);
  assert.match(styles, /--shadow-md:\s*0 14px 42px rgba\(37, 30, 18, 0\.075\)/);
});

test('Light components use theme tokens and cinematic hero remains dark/photo-safe', () => {
  const lightBlock = styles.slice(styles.indexOf('/* Luxury Light Mode — Ivory, Ebony & Brass */'));
  assert.ok(lightBlock.length > 1000);
  assert.match(lightBlock, /\.hero-shade[\s\S]*rgba\(4, 4, 3/);
  assert.match(lightBlock, /\.hero :is\(h1, h2, h3, p, \.eyebrow, \.hero-lead, \.hero-scroll\)/);
  assert.match(lightBlock, /\.catalog-card[\s\S]*var\(--color-surface\)/);
  assert.match(lightBlock, /\.site-footer[\s\S]*#191A18/);
  assert.match(designV3, /Luxury Light Mode v3 cascade guard/);
  assert.match(designV3, /html\[data-theme="light"\] :is\([^)]*\.privacy-dialog[^)]*\)/);
  assert.doesNotMatch(lightBlock, /background:\s*#000(?:000)?\b/i);
  assert.doesNotMatch(lightBlock, /background:\s*#fff(?:fff)?\b/i);
});

test('Solar theme and manual override persist correctly and use SVG line icons', () => {
  assert.match(app, /timeZone:\s*"America\/New_York"/);
  assert.match(app, /hour >= 7 && hour < 19 \? "light" : "dark"/);
  assert.match(app, /localStorage\.getItem\(klavierhausThemePreferenceKey\)/);
  assert.match(app, /localStorage\.setItem\(klavierhausThemePreferenceKey, next\)/);
  assert.match(app, /root\.dataset\.theme = value/);
  assert.match(app, /function themeIconSvg\(theme\)/);
  assert.match(app, /<svg viewBox="0 0 24 24"/);
  assert.doesNotMatch(app.slice(app.indexOf('function themeIconSvg'), app.indexOf('function initializeSolarTheme')), /☀|☾/);
  assert.match(websiteServer, /class="theme-toggle__icon"/);
  assert.doesNotMatch(websiteServer.match(/<button class="theme-toggle"[\s\S]*?<\/button>/)?.[0] || '', /☀|☾/);
});

test('ERP/admin scope files remain byte-identical to the supplied baseline', () => {
  for (const [rel, expected] of Object.entries(ERP_BASELINE)) {
    assert.equal(sha(rel), expected, `${rel} was modified even though ERP/admin is out of scope`);
  }
});
