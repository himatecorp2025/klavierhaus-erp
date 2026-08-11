"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createApp, normalizeBaseUrl } = require("../server/index");

async function withServer(options, callback) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("health endpoint identifies the independent public website", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "klavierhaus-public-website",
      version: "0.1.0",
      indexing: "disabled"
    });
  });
});

test("English and Hungarian routes render one language at a time", async () => {
  await withServer({ baseUrl: "https://klavierhaus.onrender.com", allowIndexing: false }, async (origin) => {
    const english = await (await fetch(`${origin}/`)).text();
    const hungarian = await (await fetch(`${origin}/hu/`)).text();

    assert.match(english, /<html lang="en-US">/);
    assert.match(english, /Where piano craft meets the art of listening\./);
    assert.doesNotMatch(english, /Ahol a zongora/);
    assert.match(hungarian, /<html lang="hu-HU">/);
    assert.match(hungarian, /Ahol a zongora/);
    assert.doesNotMatch(hungarian, /Where piano craft/);
  });
});

test("Hungarian route normalization redirects once without a loop", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/hu`, { redirect: "manual" });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "/hu/");
  });
});

test("temporary Render deployment is protected from indexing", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const page = await fetch(`${origin}/`);
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(await page.text(), /<meta name="robots" content="noindex, nofollow, noarchive">/);

    const robots = await (await fetch(`${origin}/robots.txt`)).text();
    assert.equal(robots, "User-agent: *\nDisallow: /\n");
  });
});

test("unknown Hungarian route renders a localized responsive 404", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/hu/nem-letezik`);
    const body = await response.text();
    assert.equal(response.status, 404);
    assert.match(body, /<html lang="hu-HU">/);
    assert.match(body, /Az oldal nem található/);
  });
});

test("website manifest is self-contained and does not import the ERP database", () => {
  const websiteRoot = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(websiteRoot, "package.json"), "utf8"));
  const serverSource = fs.readFileSync(path.join(websiteRoot, "server", "index.js"), "utf8");

  assert.equal(manifest.name, "klavierhaus-public-website");
  assert.equal(manifest.scripts.start, "node server/index.js");
  assert.equal(manifest.dependencies["better-sqlite3"], undefined);
  assert.doesNotMatch(serverSource, /better-sqlite3|klavierhaus_v6\.sqlite|\.\.\/\.\.\/server/);
});

test("public pages include security headers and a mobile-safe layout foundation", async () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  });

  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /overflow-wrap:\s*break-word/);
  assert.match(css, /hyphens:\s*auto/);
  assert.match(css, /@media \(max-width:\s*640px\)/);
});

test("base URL normalization keeps canonical links on the configured public host", () => {
  assert.equal(normalizeBaseUrl("https://klavierhaus.onrender.com/path?x=1"), "https://klavierhaus.onrender.com");
  assert.equal(normalizeBaseUrl("javascript:alert(1)"), "https://klavierhaus.onrender.com");
});
