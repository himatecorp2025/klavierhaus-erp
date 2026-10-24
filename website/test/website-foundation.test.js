"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createApp, normalizeBaseUrl } = require("../server/index");
const { VERSION, getPage, getRoute, routeDefinitions } = require("../server/site-content");

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

test("health endpoint identifies the current public website version", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, {
      status: "ok",
      service: "klavierhaus-public-website",
      version: VERSION,
      commit: "unknown",
      indexing: "disabled",
      erp_api: "not-configured"
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
        assert.match(body, /"LocalBusiness"/);
      }
    }
  });
});

test("private appointment assets share a current cache-busting revision and dialog picker initialization", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const body = await (await fetch(`${origin}/`)).text();
    const css = body.match(/\/assets\/styles\.css\?v=([^"]+)/);
    const js = body.match(/\/assets\/app\.js\?v=([^"]+)/);
    assert.ok(css, "versioned website CSS must load");
    assert.ok(js, "versioned website JavaScript must load");
    assert.equal(css[1], js[1], "both assets must use the same deployment revision");
    assert.ok(css[1].startsWith(`${VERSION}-`));
  });
  const browser = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(browser, /function privatePickerEnsure\(root=document\)/);
  assert.match(browser, /privatePickerEnsure\(form\);form\?\.reset\(\);privatePickerReset\(form\)/);
  assert.match(browser, /data-private-slot-picker/);
  assert.match(css, /\.private-calendar-popover\{/);
  assert.match(css, /\.private-date-trigger\{/);
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

    const routeRedirect = await fetch(`${origin}/artists/`, { redirect: "manual" });
    assert.equal(routeRedirect.status, 308);
    assert.equal(routeRedirect.headers.get("location"), "/artists");

    const canonical = await fetch(`${origin}/hu/`);
    assert.equal(canonical.status, 200);
  });
});

test("temporary Render deployment is protected from indexing", async () => {
  await withServer({ allowIndexing: false }, async (origin) => {
    const page = await fetch(`${origin}/artists`);
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
    assert.match(body, /https:\/\/klavierhaus\.com\/artists/);
    assert.match(body, /https:\/\/klavierhaus\.com\/hu\/muveszek/);
    assert.doesNotMatch(body, /\/events|\/hu\/esemenyek/);
  });
});

test("retired event and ticket URLs are not routable or indexed", async () => {
  await withServer({ baseUrl: "https://klavierhaus.com", allowIndexing: true }, async (origin) => {
    for (const route of ["/events", "/hu/esemenyek", "/events/klavierhaus-salon", "/ticket-terms", "/invitation/legacy-token"]) {
      const response = await fetch(`${origin}${route}`, { redirect: "manual" });
      assert.equal(response.status, 404, route);
    }
    const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
    assert.doesNotMatch(sitemap, /\/events|\/hu\/esemenyek|ticket-terms|invitation/);
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

test("website manifest and lockfile are independent from ERP storage and pinned to the public runtime", () => {
  const websiteRoot = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(websiteRoot, "package.json"), "utf8"));
  const lockfile = JSON.parse(fs.readFileSync(path.join(websiteRoot, "package-lock.json"), "utf8"));
  const serverSource = fs.readFileSync(path.join(websiteRoot, "server", "index.js"), "utf8");
  assert.equal(manifest.name, "klavierhaus-public-website");
  assert.equal(manifest.version, VERSION);
  assert.equal(lockfile.version, VERSION);
  assert.equal(lockfile.packages[""].version, VERSION);
  assert.equal(manifest.scripts.start, "node server/index.js");
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["compression","dotenv","express","multer"]);
  assert.equal(manifest.dependencies["better-sqlite3"], undefined);
  assert.doesNotMatch(serverSource, /better-sqlite3|klavierhaus_v6\.sqlite|\.\.\/\.\.\/server/);
});

test("public pages enforce security headers and responsive bilingual CMS contracts", async () => {
  const websiteRoot = path.join(__dirname, "..");
  const css = fs.readFileSync(path.join(websiteRoot, "public", "styles.css"), "utf8");
  const contentSource = fs.readFileSync(path.join(websiteRoot, "server", "site-content.js"), "utf8");
  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(response.headers.get("content-security-policy"), /nonce-/);
  });
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /--black:\s*#080807/);
  assert.match(css, /--ivory:\s*#f1eadc/);
  assert.match(css, /--gold:\s*#b79a60/);
  assert.match(css, /--kh-gutter:clamp\(/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(contentSource, /sections:/);
  assert.match(contentSource, /seo:/);
});

test("brand and editorial assets are locally served and optimized", async () => {
  const websiteRoot = path.join(__dirname, "..");
  const expectedFiles = [
    "public/brand/klavierhaus-round-white.png",
    "public/media/klavierhaus-hero.jpg",
    "public/media/klavierhaus-salon.jpg",
    "public/media/klavierhaus-craft.jpg",
    "public/media/klavierhaus-artist-salon.png"
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

test("current luxury website layout keeps responsive catalogues, reviews, chat and modal appointment flows", () => {
  const websiteRoot = path.join(__dirname, "..");
  const css = fs.readFileSync(path.join(websiteRoot, "public", "styles.css"), "utf8");
  const browser = fs.readFileSync(path.join(websiteRoot, "public", "app.js"), "utf8");
  const server = fs.readFileSync(path.join(websiteRoot, "server", "index.js"), "utf8");
  assert.match(css, /--kh-gutter:clamp\(/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /\.customer-chat/);
  assert.match(browser, /data-review-carousel/);
  assert.match(browser, /privatePickerEnsure\(form\)/);
  assert.match(browser, /data-private-viewing-open/);
  assert.match(server, /renderReviewShowcase\(reviews/);
  assert.match(server, /renderShowroomCollection/);
  assert.match(server, /renderServiceCollection/);
  assert.match(server, /class="catalog-card artist-profile-card"/);
  assert.match(server, /data-private-viewing-dialog/);
  assert.doesNotMatch(browser, /data-ticket-quantity/);
  assert.doesNotMatch(server, /renderHomeEventShowcase\(homeEvents/);
});

test("privacy fallback accurately describes active customer forms and optional tracking without placeholders", async () => {
  const browser = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(browser, /async function applyTrackingConsent\(choice\)/);
  assert.match(browser, /if \(!choice\?\.analytics\) return/);
  await withServer({ allowIndexing: false }, async (origin) => {
    const english = await (await fetch(`${origin}/privacy`)).text();
    const hungarian = await (await fetch(`${origin}/hu/adatkezeles`)).text();
    assert.match(english, /customer-service messages or private appointment requests/);
    assert.match(english, /Optional analytics and marketing technologies/);
    assert.match(english, /info@klavierhaus\.com/);
    assert.doesNotMatch(english, /Paste the current/);
    assert.match(hungarian, /ügyfélszolgálati üzeneteket és privát időpontfoglalási kérelmeket/);
    assert.match(hungarian, /Követési beállításokban/);
    assert.doesNotMatch(hungarian, /Ide másolható be/);
  });
});

test("standalone private consultation is deleted and replaced by modal triggers", async () => {
  assert.equal(routeDefinitions.consultation, undefined);
  await withServer({ allowIndexing: false }, async (origin) => {
    const response = await fetch(`${origin}/private-consultation`);
    assert.equal(response.status, 410);
    assert.match(await response.text(), /permanently removed/i);
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
  assert.match(source, /data-private-viewing-open/);
  assert.match(source, /renderPrivateViewingDialog/);
});


test("private appointment forms are minimal and preserve selected context",()=>{
  const source=fs.readFileSync(path.join(__dirname,"..","server","index.js"),"utf8");
  const browser=fs.readFileSync(path.join(__dirname,"..","public","app.js"),"utf8");
  const privateStart=source.indexOf("function renderPrivateViewingDialog");
  const privateEnd=source.indexOf("function renderDocument",privateStart);
  assert.ok(privateStart>=0&&privateEnd>privateStart);
  const privateForm=source.slice(privateStart,privateEnd);
  assert.match(privateForm,/name="name"/);
  assert.match(privateForm,/name="phone"/);
  assert.match(privateForm,/renderPrivateAppointmentPicker\(language\)/);
  assert.match(source,/data-private-slot-picker/);
  assert.match(source,/name="scheduled_at" data-private-scheduled-at/);
  assert.match(source,/name="duration_min" value="60"/);
  assert.match(source,/data-private-calendar-year/);
  assert.match(source,/data-private-calendar-month/);
  assert.match(source,/Choose a date|Válasszon dátumot/);
  assert.match(privateForm,/name="note"/);
  assert.match(privateForm,/name="piano_id"/);
  assert.match(privateForm,/name="service_id"/);
  assert.match(privateForm,/name="email" type="email"/);
  assert.doesNotMatch(privateForm,/name="service_address"/);
  assert.doesNotMatch(privateForm,/name="consent_contact"/);
  assert.match(source,/data-piano-id=/);
  assert.match(source,/data-service-id=/);
  assert.match(source,/Date and available time · New York|Dátum és szabad időpont · New York-i idő/);
  assert.match(browser,/\/api\/site\/private-appointments/);
  assert.match(browser,/\/api\/site\/private-appointment-availability\?date=/);
  assert.match(browser,/form\.elements\.piano_id\.value=button\.dataset\.pianoId/);
  assert.match(browser,/form\.elements\.service_id\.value=button\.dataset\.serviceId/);
});
