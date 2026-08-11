"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../server/index");

async function withServer(options, callback) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function event(language = "en") {
  const hungarian = language === "hu";
  return {
    id: "EVT-PUBLIC",
    slug: hungarian ? "arany-szalonest" : "golden-salon-evening",
    alternate_slug: hungarian ? "golden-salon-evening" : "arany-szalonest",
    title: hungarian ? "Arany szalonest" : "Golden Salon Evening",
    short_description: "",
    description: hungarian ? "A zene és a művészet különleges találkozása." : "A considered encounter between music and artistry.",
    category: hungarian ? "Szalonkoncert" : "Salon concert",
    category_code: "SALON_CONCERT",
    access_type: "PUBLIC_PAID",
    status: "PUBLISHED",
    performer_name: "Klavierhaus Artist",
    hero_image_url: "https://images.example.com/salon.jpg",
    venue: { name: "Klavierhaus", street: "790 11th Avenue", city: "New York", region: "NY", postal_code: "10019", country: "US" },
    start_at: "2031-04-10T23:00:00.000Z",
    end_at: "2031-04-11T01:00:00.000Z",
    capacity_total: 40,
    capacity_remaining: 12,
    sold_out: false,
    price_cents: 12500,
    currency: "USD"
  };
}

function createFakeApi() {
  let invitationStatus = "PENDING";
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const parsed = new URL(url);
    const language = parsed.searchParams.get("lang") === "hu" ? "hu" : "en";
    let status = 200;
    let payload;
    if (parsed.pathname === "/api/public/events") {
      payload = [event(language)];
    } else if (parsed.pathname.startsWith("/api/public/events/")) {
      const expected = language === "hu" ? "arany-szalonest" : "golden-salon-evening";
      if (decodeURIComponent(parsed.pathname.split("/").at(-1)) !== expected) { status = 404; payload = { error: "EVENT_NOT_FOUND" }; }
      else payload = event(language);
    } else if (parsed.pathname === "/api/public/event-invitations/private-token/respond") {
      const body = JSON.parse(options.body || "{}");
      invitationStatus = body.decision === "DECLINE" ? "DECLINED" : "ACCEPTED";
      payload = { status: invitationStatus, ticket_code: invitationStatus === "ACCEPTED" ? "TICKET-1" : undefined };
    } else if (parsed.pathname === "/api/public/event-invitations/private-token") {
      payload = {
        id: "INV-1",
        guest_name: "Private Guest",
        language,
        status: invitationStatus,
        title_en: "Golden Salon Evening",
        title_hu: "Arany szalonest",
        start_at: "2031-04-10T23:00:00.000Z",
        end_at: "2031-04-11T01:00:00.000Z",
        venue_name: "Klavierhaus",
        event_status: "PUBLISHED"
      };
    } else {
      status = 404;
      payload = { error: "NOT_FOUND" };
    }
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchImpl };
}

test("dynamic public programme renders one language, paired URLs, responsive cards, and Event structured data", async () => {
  const api = createFakeApi();
  await withServer({
    baseUrl: "https://klavierhaus.com",
    allowIndexing: true,
    eventApiBaseUrl: "https://erp.example.com",
    fetchImpl: api.fetchImpl
  }, async (origin) => {
    const englishList = await (await fetch(`${origin}/events`)).text();
    const hungarianList = await (await fetch(`${origin}/hu/esemenyek`)).text();
    assert.match(englishList, /Golden Salon Evening/);
    assert.match(englishList, /public-event-grid/);
    assert.match(englishList, /public-event-card__actions/);
    assert.match(englishList, /View details/);
    assert.match(englishList, /Buy tickets/);
    assert.doesNotMatch(englishList, /Arany szalonest/);
    assert.match(hungarianList, /Arany szalonest/);
    assert.doesNotMatch(hungarianList, /Golden Salon Evening/);

    const detailResponse = await fetch(`${origin}/events/golden-salon-evening`);
    const detail = await detailResponse.text();
    assert.equal(detailResponse.status, 200);
    assert.match(detail, /<html lang="en-US"/);
    assert.match(detail, /href="\/hu\/esemenyek\/arany-szalonest"/);
    assert.match(detail, /"@type":"Event"/);
    assert.match(detail, /"startDate":"2031-04-10T23:00:00.000Z"/);
    assert.match(detail, /790 11th Avenue/);
    assert.doesNotMatch(detail, /Meghitt zongoraest/);

    const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
    assert.match(sitemap, /https:\/\/klavierhaus\.com\/events\/golden-salon-evening/);
    assert.match(sitemap, /https:\/\/klavierhaus\.com\/hu\/esemenyek\/arany-szalonest/);
    assert.doesNotMatch(sitemap, /invitation|meghivas/);
    assert.doesNotMatch(sitemap, /klavierhaus-salon|klavierhaus-szalon/);
  });
});

test("homepage places the nearest public events in a bilingual two-column editorial stream", async () => {
  const api = createFakeApi();
  await withServer({
    baseUrl: "https://klavierhaus.com",
    allowIndexing: true,
    eventApiBaseUrl: "https://erp.example.com",
    fetchImpl: api.fetchImpl
  }, async (origin) => {
    const english = await (await fetch(`${origin}/`)).text();
    const hungarian = await (await fetch(`${origin}/hu/`)).text();
    assert.match(english, /id="upcoming-events"/);
    assert.match(english, /Enter the room where music becomes personal/);
    assert.match(english, /Golden Salon Evening/);
    assert.match(english, /View all events/);
    assert.doesNotMatch(english, /Arany szalonest/);
    assert.match(hungarian, /Lépjen be a térbe, ahol a zene személyessé válik/);
    assert.match(hungarian, /Arany szalonest/);
    assert.match(hungarian, /Összes esemény/);
    assert.doesNotMatch(hungarian, /Golden Salon Evening/);
  });
});

test("private invitation stays noindex and accepts only an explicit one-time response", async () => {
  const api = createFakeApi();
  await withServer({
    baseUrl: "https://klavierhaus.com",
    allowIndexing: true,
    eventApiBaseUrl: "https://erp.example.com",
    fetchImpl: api.fetchImpl
  }, async (origin) => {
    const page = await fetch(`${origin}/invitation/private-token`);
    const body = await page.text();
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(body, /<meta name="robots" content="noindex, nofollow, noarchive">/);
    assert.match(body, /Private Guest/);
    assert.match(body, /value="ACCEPT"/);
    assert.doesNotMatch(body, /guest@example\.com/);
    assert.doesNotMatch(body, /"@type":"Event"/);

    const accepted = await fetch(`${origin}/invitation/private-token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "decision=ACCEPT"
    });
    const acceptedBody = await accepted.text();
    assert.equal(accepted.status, 200);
    assert.match(acceptedBody, /Your invitation has been accepted/);
    assert.doesNotMatch(acceptedBody, /value="ACCEPT"/);
    const responseCall = api.calls.find((call) => call.url.endsWith("/respond"));
    assert.deepEqual(JSON.parse(responseCall.options.body), { decision: "ACCEPT" });
  });
});
