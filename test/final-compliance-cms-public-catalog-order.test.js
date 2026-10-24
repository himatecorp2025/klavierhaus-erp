"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const Database = require("better-sqlite3");
const { registerWebsiteCatalogRoutes } = require("../server/website-catalog");
const { registerWebsiteContentRoutes } = require("../server/website-content");
const { buildSnapshot, restoreSnapshot, factoryReset } = require("../server/website-backup-reset");
const { pianoBrandSlug, brandGroups, reorderPianoRows } = require("../server/website-display-order");
const { createApp } = require("../website/server/index");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, origin: "http://127.0.0.1:" + server.address().port };
}

async function withCatalog(callback) {
  const app = express();
  const db = new Database(":memory:");
  db.exec(read("server/schema.sql"));
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,is_superadmin) VALUES('A','Admin','a@example.test','x','ADMIN','Active',1)").run();
  const audits = [];
  app.use(express.json());
  const auth = (req, _res, next) => { req.user = { id: "A", name: "Admin", role: req.headers["x-test-role"] === "worker" ? "WORKER" : "ADMIN" }; next(); };
  const permit = (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "PERMISSION_DENIED" });
  registerWebsiteCatalogRoutes({ app, db, auth, permit, audit: (...args) => audits.push(args), erpBaseUrl: "https://erp.klavierhaus.test" });
  registerWebsiteContentRoutes({
    app, db, auth, permit, audit: (...args) => audits.push(args),
    websiteImageUpload: { single: () => (_req, _res, next) => next() },
    websiteImageDir: path.join(root, "website", "public"),
    websiteBaseUrl: "https://klavierhaus.com"
  });
  const backend = await listen(app);
  const website = await listen(createApp({
    eventApiBaseUrl: backend.origin,
    eventApiTimeoutMs: 1500,
    baseUrl: "https://klavierhaus.com",
    allowIndexing: false
  }));
  const request = async (pathname, options = {}) => {
    const response = await fetch(backend.origin + pathname, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    let body;
    try { body = await response.json(); } catch (_error) { body = null; }
    return { status: response.status, body, headers: response.headers };
  };
  const publicPage = async (pathname) => {
    const response = await fetch(website.origin + pathname);
    assert.equal(response.status, 200, pathname);
    return response.text();
  };
  try { await callback({ request, publicPage, db, audits }); }
  finally {
    await new Promise((resolve) => website.server.close(resolve));
    await new Promise((resolve) => backend.server.close(resolve));
    db.close();
  }
}
const json = (data) => ({ method: "POST", body: JSON.stringify(data) });
const put = (data) => ({ method: "PUT", body: JSON.stringify(data) });
const brandInput = (brand, title, sortOrder, featured = false) => ({
  brand, title_en: title, title_hu: title + " HU", model: "Model",
  image_url: "/uploads/website/test.jpg", featured, published: true, sort_order: sortOrder
});
const serviceInput = (title, sortOrder, featured = false) => ({
  title_en: title, title_hu: title + " HU",
  image_url: "/uploads/website/service.jpg", sort_order: sortOrder, featured, visible: true
});
function assertOrderInMarkup(html, paths) {
  const positions = paths.map((pathname) => html.indexOf('class="catalog-card__image" href="' + pathname + '"'));
  assert.ok(positions.every((position) => position >= 0), "Missing expected public card: " + JSON.stringify(paths));
  assert.deepEqual(positions.slice().sort((a, b) => a - b), positions, "Cards are not rendered left-to-right in CMS order");
}

test("shared piano-brand grouping matches the public website's known and future brands", () => {
  assert.equal(pianoBrandSlug("Steinway & Sons"), "steinway");
  assert.equal(pianoBrandSlug("Steinway"), "steinway");
  assert.equal(pianoBrandSlug("Bösendorfer"), "bosendorfer");
  assert.equal(pianoBrandSlug("Bosendorfer 214VC"), "bosendorfer");
  assert.equal(pianoBrandSlug("Art Case"), "art-case");
  const rows = [{ brand: "Steinway & Sons", id: "one" }, { brand: "Art Case", id: "two" }, { brand: "Steinway", id: "three" }];
  assert.deepEqual(brandGroups(rows).map((item) => item.id), ["steinway", "art-case"]);
  assert.deepEqual(reorderPianoRows(rows, ["art-case", "steinway"]).map((item) => item.id), ["two", "one", "three"]);
});

test("new showroom piano saves with complete production schema, validates missing images and never touches client piano registry", async () => {
  await withCatalog(async ({ request, db }) => {
    const bad = await request("/api/showroom-pianos", json({ brand: "Bösendorfer", title_en: "Test", title_hu: "Próba" }));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "SHOWROOM_PIANO_REQUIRED_FIELDS");
    const good = await request("/api/showroom-pianos", json({
      brand: "Bösendorfer", model: "214VC", title_en: "Bösendorfer 214VC",
      title_hu: "Bösendorfer 214VC", image_url: "/uploads/website/214vc.jpg",
      gallery: [{ url: "/uploads/website/detail.jpg", alt_en: "Side" }], published: true
    }));
    assert.equal(good.status, 201, JSON.stringify(good.body));
    assert.equal(good.body.brand, "Bösendorfer");
    const list = await request("/api/public/showroom-pianos?lang=hu");
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].title, "Bösendorfer 214VC");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pianos").get().n, 0, "Public showroom creation must not add ERP customer pianos");
  });
});

test("Piano Page brand order persists and drives both public pages in both languages, including newly added brands", async () => {
  await withCatalog(async ({ request, publicPage, db, audits }) => {
    for (const item of [
      brandInput("Bösendorfer", "Bösendorfer 214VC", 1, true),
      brandInput("Steinway & Sons", "Steinway B", 2),
      brandInput("Art Case", "Art Case Gold", 3),
      brandInput("Art Case", "Art Case Steinway", 4)
    ]) {
      const created = await request("/api/showroom-pianos", json(item));
      assert.equal(created.status, 201, JSON.stringify(created.body));
    }
    const before = await request("/api/website-catalog-order/pianos");
    assert.deepEqual(before.body.items.map((item) => item.id), ["bosendorfer", "steinway", "art-case"]);
    assert.deepEqual(before.body.items.map((item) => item.count), [1, 1, 2]);
    assert.equal(before.headers.get("cache-control"), "no-store");

    const order = ["art-case", "steinway", "bosendorfer"];
    const changed = await request("/api/website-catalog-order/pianos", put({ ids: order }));
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.deepEqual(changed.body.items.map((item) => item.position), [1, 2, 3]);
    assert.deepEqual(JSON.parse(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='website_piano_brand_display_order'").get().setting_value), order);
    const reloaded = await request("/api/website-catalog-order/pianos");
    assert.deepEqual(reloaded.body.items.map((item) => item.id), order);
    const cmsPages = await request("/api/website-content/pages");
    assert.equal(cmsPages.status, 200);
    assert.deepEqual(cmsPages.body.pages.filter((page) => page.piano_brand).map((page) => page.piano_brand_slug),
      order, "CMS sidebar piano-brand pages must follow customer-facing order");
    for (const language of ["en", "hu"]) {
      const response = await request("/api/public/showroom-pianos?lang=" + language);
      assert.deepEqual([...new Set(response.body.map((item) => item.brand))], ["Art Case", "Steinway & Sons", "Bösendorfer"]);
    }
    for (const [path, prefix] of [
      ["/", "/pianos/"], ["/pianos", "/pianos/"],
      ["/hu/", "/hu/zongorak/"], ["/hu/zongorak", "/hu/zongorak/"]
    ]) {
      const html = await publicPage(path);
      assertOrderInMarkup(html, [prefix + "art-case", prefix + "steinway", prefix + "bosendorfer"]);
    }
    const newer = await request("/api/showroom-pianos", json(brandInput("Yamaha", "Yamaha C7", 0, true)));
    assert.equal(newer.status, 201, JSON.stringify(newer.body));
    const withNew = await request("/api/website-catalog-order/pianos");
    assert.deepEqual(withNew.body.items.map((item) => item.id), [...order, "yamaha"], "Newly published brands must append instead of jumping to the front");

    const stale = await request("/api/website-catalog-order/pianos", put({ ids: order }));
    assert.equal(stale.status, 400);
    assert.equal(stale.body.error, "INVALID_DISPLAY_ORDER");
    assert.deepEqual((await request("/api/website-catalog-order/pianos")).body.items.map((item) => item.id), [...order, "yamaha"]);
    assert.ok(audits.some((entry) => entry[1] === "REORDER" && entry[2] === "website_piano_brands"));
  });
});

test("Services Page visible order overrides featured, persists in SQLite and drives homepage and Services page", async () => {
  await withCatalog(async ({ request, publicPage, db, audits }) => {
    const created = [];
    for (const item of [
      serviceInput("Rebuilding & Restoration", 1, true),
      serviceInput("Tuning & Technical Care", 2, true),
      serviceInput("Concert Piano Services", 3, false)
    ]) {
      const res = await request("/api/website-services", json(item));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      created.push(res.body);
    }
    const initial = await request("/api/website-catalog-order/services");
    assert.deepEqual(initial.body.items.map((item) => item.id), created.map((item) => item.id));
    const order = [created[2].id, created[0].id, created[1].id];
    const changed = await request("/api/website-catalog-order/services", put({ ids: order }));
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.deepEqual(changed.body.items.map((item) => item.id), order);
    assert.deepEqual(db.prepare("SELECT sort_order FROM website_services WHERE visible=1 ORDER BY sort_order").all().map((x) => x.sort_order), [1, 2, 3]);
    const publicEn = await request("/api/public/website-services?lang=en");
    assert.deepEqual(publicEn.body.map((item) => item.id), order, "Featured must not override manual positions");
    const publicHu = await request("/api/public/website-services?lang=hu");
    assert.deepEqual(publicHu.body.map((item) => item.id), order);
    assert.equal(publicEn.headers.get("cache-control"), "no-store");
    const expectedSlugs = ["concert-piano-services", "rebuilding-restoration", "tuning-technical-care"];
    for (const [page, prefix] of [
      ["/", "/services/"], ["/services", "/services/"],
      ["/hu/", "/hu/szolgaltatasok/"], ["/hu/szolgaltatasok", "/hu/szolgaltatasok/"]
    ]) {
      const html = await publicPage(page);
      assertOrderInMarkup(html, expectedSlugs.map((slug) => prefix + slug + (prefix.startsWith("/hu/") ? "-hu" : "")));
    }
    const invalid = await request("/api/website-catalog-order/services", put({ ids: [order[0], order[0], order[2]] }));
    assert.equal(invalid.status, 400);
    assert.deepEqual((await request("/api/public/website-services?lang=en")).body.map((item) => item.id), order, "Invalid reorder must not modify any records");
    const added = await request("/api/website-services", json({
      title_en: "New service", title_hu: "Új szolgáltatás", image_url: "/uploads/website/new.jpg", featured: true
    }));
    assert.equal(added.status, 201);
    assert.deepEqual((await request("/api/public/website-services?lang=en")).body.map((item) => item.id), [...order, added.body.id], "New service must append even if featured");
    assert.ok(audits.some((entry) => entry[1] === "REORDER" && entry[2] === "website_services"));
  });
});

test("ordering endpoints are admin-only while catalog pages remain public", async () => {
  await withCatalog(async ({ request }) => {
    for (const kind of ["pianos", "services"]) {
      const pathname = "/api/website-catalog-order/" + kind;
      assert.equal((await request(pathname, { headers: { "x-test-role": "worker" } })).status, 403);
      assert.equal((await request(pathname, { ...put({ ids: [] }), headers: { "x-test-role": "worker" } })).status, 403);
    }
    assert.equal((await request("/api/public/showroom-pianos?lang=en")).status, 200);
    assert.equal((await request("/api/public/website-services?lang=en")).status, 200);
  });
});

test("CMS frontend shows positional controls on Piano and Service pages and blocks piano save without required image", () => {
  const v6 = read("public/v6.js");
  const controls = read("public/cms-catalog-order.js");
  const html = read("public/index.html");
  const style = read("public/styles.css");
  assert.match(v6, /v6CmsConnectedGrid\(config,rows,orderData\?\.items\|\|\[\]\)/);
  assert.match(v6, /v6CmsOrderMount\(host,config,orderData,refreshConnected\)/);
  assert.match(v6, /website-catalog-order/);
  assert.match(v6, /Upload the main image before saving/);
  assert.match(controls, /Save display order/);
  assert.match(controls, /Position 1 is the leftmost visible service card/);
  assert.match(controls, /data\.items/);
  assert.match(html, /cms-catalog-order\.js/);
  assert.match(style, /\.cms-public-order-item/);
  assert.match(style, /@media\(max-width:760px\)/);
});


test("website collection backups restore the piano-brand order, and collection reset clears it", async () => {
  await withCatalog(async ({ request, db }) => {
    for (const brand of ["Steinway & Sons", "Art Case", "Bösendorfer"]) {
      const result = await request("/api/showroom-pianos", json(brandInput(brand, brand + " model", 1)));
      assert.equal(result.status, 201);
    }
    const order = ["art-case", "bosendorfer", "steinway"];
    assert.equal((await request("/api/website-catalog-order/pianos", put({ ids: order }))).status, 200);
    const snapshot = buildSnapshot(db, { scope: "all" });
    const savedSetting = snapshot.settings.find((row) => row.setting_key === "website_piano_brand_display_order");
    assert.ok(savedSetting, "Backups must include customer-facing piano-brand order");
    assert.deepEqual(JSON.parse(savedSetting.setting_value), order);

    db.prepare("DELETE FROM app_settings WHERE setting_key='website_piano_brand_display_order'").run();
    assert.notDeepEqual((await request("/api/website-catalog-order/pianos")).body.items.map((row) => row.id), order);
    restoreSnapshot(db, snapshot);
    assert.deepEqual((await request("/api/website-catalog-order/pianos")).body.items.map((row) => row.id), order);

    factoryReset(db, "collections", { websiteBaseUrl: "https://klavierhaus.com" });
    assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='website_piano_brand_display_order'").get(), undefined,
      "Collection factory reset must also reset ordering preferences");
  });
});
