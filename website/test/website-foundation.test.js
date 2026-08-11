"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createApp, normalizeBaseUrl } = require("../server/index");
const { getPage, getRoute, routeDefinitions } = require("../server/site-content");

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

test("health endpoint identifies stage-one public website", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "klavierhaus-public-website",
      version: "1.0.0",
      indexing: "disabled",
      event_api: "not-configured"
    });
  });
});

test("every English and Hungarian route renders localized canonical metadata", async () => {
  await withServer({ baseUrl: "https://klavierhaus-home.onrender.com", allowIndexing: false }, async (origin) => {
    for (const [key, routes] of Object.entries(routeDefinitions)) {
      for (const language of ["en", "hu"]) {
        const route = routes[language];
        const response = await fetch(`${origin}${route}`);
        const body = await response.text();
        assert.equal(response.status, 200, `${language}:${key}`);
        assert.match(body, new RegExp(`<html lang="${language === "hu" ? "hu-HU" : "en-US"}"`));
        assert.match(body, new RegExp(`<link rel="canonical" href="https://klavierhaus-home\\.onrender\\.com${route === "/" ? "/" : route}">`));
        assert.match(body, /hreflang="en-US"/);
        assert.match(body, /hreflang="hu-HU"/);
        assert.match(body, /class="brand-logo"/);
        assert.match(body, /data-current-year/);
      }
    }
  });
});

test("home routes render exactly one visible language at a time", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const english = await (await fetch(`${origin}/`)).text();
    const hungarian = await (await fetch(`${origin}/hu/`)).text();

    assert.match(english, /Where music becomes a private world\./);
    assert.doesNotMatch(english, /Ahol a zene különleges világgá válik\./);
    assert.match(hungarian, /Ahol a zene különleges világgá válik\./);
    assert.doesNotMatch(hungarian, /Where music becomes a private world\./);
    assert.doesNotMatch(english, /Menü megnyitása/);
    assert.doesNotMatch(hungarian, /Open menu/);
  });
});

test("language and trailing-slash normalization use permanent redirects without loops", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const languageRedirect = await fetch(`${origin}/hu`, { redirect: "manual" });
    assert.equal(languageRedirect.status, 308);
    assert.equal(languageRedirect.headers.get("location"), "/hu/");

    const routeRedirect = await fetch(`${origin}/events/`, { redirect: "manual" });
    assert.equal(routeRedirect.status, 308);
    assert.equal(routeRedirect.headers.get("location"), "/events");

    const canonical = await fetch(`${origin}/hu/`);
    assert.equal(canonical.status, 200);
  });
});

test("temporary Render deployment is protected from indexing", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const page = await fetch(`${origin}/events`);
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(await page.text(), /<meta name="robots" content="noindex, nofollow, noarchive">/);

    const robots = await (await fetch(`${origin}/robots.txt`)).text();
    assert.equal(robots, "User-agent: *\nDisallow: /\n");

    const sitemap = await fetch(`${origin}/sitemap.xml`);
    assert.equal(sitemap.status, 404);
  });
});

test("indexing mode exposes a sitemap containing both language routes", async () => {
  await withServer({ baseUrl: "https://klavierhaus.com", allowIndexing: true }, async (origin) => {
    const response = await fetch(`${origin}/sitemap.xml`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/xml/);
    assert.match(body, /https:\/\/klavierhaus\.com\/events/);
    assert.match(body, /https:\/\/klavierhaus\.com\/hu\/esemenyek/);
  });
});

test("unknown Hungarian route renders a localized responsive 404", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/hu/nem-letezik`);
    const body = await response.text();
    assert.equal(response.status, 404);
    assert.match(body, /<html lang="hu-HU"/);
    assert.match(body, /Ez a terem nem része a háznak/);
    assert.doesNotMatch(body, /This room is not part of the house/);
  });
});

test("website manifest stays self-contained and independent from ERP storage", () => {
  const websiteRoot = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(websiteRoot, "package.json"), "utf8"));
  const lockfile = JSON.parse(fs.readFileSync(path.join(websiteRoot, "package-lock.json"), "utf8"));
  const serverSource = fs.readFileSync(path.join(websiteRoot, "server", "index.js"), "utf8");

  assert.equal(manifest.name, "klavierhaus-public-website");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(lockfile.version, manifest.version);
  assert.equal(lockfile.packages[""].version, manifest.version);
  assert.equal(manifest.scripts.start, "node server/index.js");
  assert.equal(manifest.dependencies["better-sqlite3"], undefined);
  assert.doesNotMatch(serverSource, /better-sqlite3|klavierhaus_v6\.sqlite|\.\.\/\.\.\/server/);
});

test("public pages include security headers and an admin-ready content contract", async () => {
  const websiteRoot = path.join(__dirname, "..");
  const css = fs.readFileSync(path.join(websiteRoot, "public", "styles.css"), "utf8");
  const contentSource = fs.readFileSync(path.join(websiteRoot, "server", "site-content.js"), "utf8");

  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(response.headers.get("content-security-policy"), /nonce-/);
  });

  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /--black:\s*#080807/);
  assert.match(css, /--ivory:\s*#f1eadc/);
  assert.match(css, /--gold:\s*#b79a60/);
  assert.match(css, /@media \(max-width:\s*760px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(contentSource, /Public content contract/);
  assert.match(contentSource, /sections:/);
  assert.match(contentSource, /seo:/);
});

test("brand and editorial assets are locally served and optimized", async () => {
  const websiteRoot = path.join(__dirname, "..");
  const expectedFiles = [
    "public/brand/klavierhaus-round-white.png",
    "public/media/klavierhaus-hero.jpg",
    "public/media/klavierhaus-salon.jpg",
    "public/media/klavierhaus-craft.jpg"
  ];

  for (const relativePath of expectedFiles) {
    const absolutePath = path.join(websiteRoot, relativePath);
    assert.ok(fs.existsSync(absolutePath), relativePath);
    assert.ok(fs.statSync(absolutePath).size < 350_000, `${relativePath} should remain web optimized`);
  }

  await withServer({ allowIndexing: false }, async (origin) => {
    const logo = await fetch(`${origin}/assets/brand/klavierhaus-round-white.png`);
    const hero = await fetch(`${origin}/assets/media/klavierhaus-hero.jpg`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get("content-type"), /image\/png/);
    assert.equal(hero.status, 200);
    assert.match(hero.headers.get("content-type"), /image\/jpeg/);
  });
});

test("all content pages have paired routes, SEO fields, hero copy, and sections", () => {
  const allRoutes = [];
  for (const [key, routes] of Object.entries(routeDefinitions)) {
    assert.ok(routes.en.startsWith("/"));
    assert.ok(routes.hu.startsWith("/hu"));
    allRoutes.push(routes.en, routes.hu);
    for (const language of ["en", "hu"]) {
      const page = getPage(key, language);
      assert.ok(page, `${language}:${key}`);
      assert.ok(page.seo.title);
      assert.ok(page.seo.description);
      assert.ok(page.hero.title);
      assert.ok(Array.isArray(page.sections));
      assert.equal(getRoute(key, language), routes[language]);
    }
  }
  assert.equal(new Set(allRoutes).size, allRoutes.length, "public routes must be unique");
});

test("base URL normalization uses the actual Render host as safe fallback", () => {
  assert.equal(normalizeBaseUrl("https://klavierhaus-home.onrender.com/path?x=1"), "https://klavierhaus-home.onrender.com");
  assert.equal(normalizeBaseUrl("javascript:alert(1)"), "https://klavierhaus-home.onrender.com");
});
