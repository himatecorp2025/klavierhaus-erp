"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../server/index");
const { getGlobal, getPage } = require("../server/site-content");

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
    checkout_available: true,
    reservation_available: false,
    stripe_test_mode: true,
    hold_minutes: 15,
    price_cents: 12500,
    currency: "USD"
  };
}

function showroomPianos(language = "en") {
  const hu = language === "hu";
  return [
    { id: "PIANO-ST-B", slug: hu ? "steinway-b" : "steinway-model-b", alternate_slug: hu ? "steinway-model-b" : "steinway-b", brand: "Steinway & Sons", model: "Model B", title: hu ? "Steinway B-modell" : "Steinway Model B", summary: hu ? "New York-i koncertkarakter." : "A concert voice shaped in New York.", description: "", image_url: "https://images.example.com/steinway-b.jpg", image_alt: "Steinway Model B", availability_status: "AVAILABLE" },
    { id: "PIANO-FA-212", slug: "fazioli-f212", alternate_slug: "fazioli-f212", brand: "Fazioli", model: "F212", title: "Fazioli F212", summary: hu ? "Olasz szín és tisztaság." : "Italian color and clarity.", description: "", image_url: "https://images.example.com/fazioli.jpg", image_alt: "Fazioli F212", availability_status: "AVAILABLE" },
    { id: "PIANO-BO-214", slug: "bosendorfer-214vc", alternate_slug: "bosendorfer-214vc", brand: "Bösendorfer", model: "214VC", title: "Bösendorfer 214VC", summary: hu ? "Bécsi mélység és rezonancia." : "Viennese depth and resonance.", description: "", image_url: "https://images.example.com/bosendorfer.jpg", image_alt: "Bösendorfer 214VC", availability_status: "AVAILABLE" }
  ];
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
    if (parsed.pathname.endsWith("/checkout")) {
      payload = { checkout_url: "https://checkout.stripe.com/c/pay/test", checkout_session_id: "cs_test_1", test_mode: true };
    } else if (parsed.pathname.endsWith("/reservations")) {
      payload = { ok: true, tickets: [{ ticket_code: "TEST-1" }] };
    } else if (parsed.pathname === "/api/public/website-content/global") {
      payload = { page_key: "global", language, source: "bundled", content: getGlobal(language) };
    } else if (parsed.pathname === "/api/public/website-content/events") {
      payload = { page_key: "events", language, source: "bundled", content: getPage("events", language) };
    } else if (parsed.pathname === "/api/public/website-content/home") {
      payload = { page_key: "home", language, source: "bundled", content: getPage("home", language) };
    } else if (parsed.pathname === "/api/public/website-content/pianos") {
      payload = { page_key: "pianos", language, source: "bundled", content: getPage("pianos", language) };
    } else if (parsed.pathname === "/api/public/showroom-pianos") {
      payload = showroomPianos(language);
    } else if (parsed.pathname === "/api/public/events") {
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
    assert.match(englishList, /TEST MODE/);
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
    assert.match(detail, /Continue to secure test checkout/);
    assert.match(detail, /"@type":"Offer"/);
    assert.doesNotMatch(detail, /Meghitt zongoraest/);

    const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
    assert.match(sitemap, /https:\/\/klavierhaus\.com\/events\/golden-salon-evening/);
    assert.match(sitemap, /https:\/\/klavierhaus\.com\/hu\/esemenyek\/arany-szalonest/);
    assert.doesNotMatch(sitemap, /invitation|meghivas/);
    assert.doesNotMatch(sitemap, /klavierhaus-salon|klavierhaus-szalon/);

    const checkout = await fetch(`${origin}/events/golden-salon-evening/checkout`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "quantity=2&attendee_names=Ada+Artist&attendee_names=Bela+Benefactor"
    });
    assert.equal(checkout.status, 303);
    assert.equal(checkout.headers.get("location"), "https://checkout.stripe.com/c/pay/test");
    const checkoutCall = api.calls.find((call) => call.url.endsWith("/checkout"));
    assert.deepEqual(JSON.parse(checkoutCall.options.body), { language: "en", quantity: 2, attendee_names: ["Ada Artist", "Bela Benefactor"] });
  });
});

test("homepage places the nearest public events directly after the artistic introduction in the responsive carousel", async () => {
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
    assert.match(english, /class="event-carousel"/);
    assert.match(english, /data-event-carousel-prev/);
    assert.match(english, /data-event-carousel-next/);
    assert.ok(english.indexOf('id="manifesto"') < english.indexOf('id="upcoming-events"'), "events must follow the artistic introduction");
    assert.ok(english.indexOf('id="upcoming-events"') < english.indexOf('id="reviews"'), "events must replace the old intimate-encounters position before reviews");
    assert.doesNotMatch(english, /id="salon"/);
    assert.doesNotMatch(english, /Arany szalonest/);
    assert.match(hungarian, /Lépjen be a térbe, ahol a zene személyessé válik/);
    assert.match(hungarian, /Arany szalonest/);
    assert.match(hungarian, /Összes esemény/);
    assert.doesNotMatch(hungarian, /Golden Salon Evening/);
  });
});

test("showroom brand routes render filtered alternating instruments with canonical bilingual SEO", async () => {
  const api = createFakeApi();
  await withServer({ baseUrl: "https://klavierhaus.com", allowIndexing: true, eventApiBaseUrl: "https://erp.example.com", fetchImpl: api.fetchImpl }, async (origin) => {
    const response = await fetch(`${origin}/pianos/steinway`);
    const page = await response.text();
    assert.equal(response.status, 200);
    assert.match(page, /Steinway Model B/);
    assert.doesNotMatch(page, /Fazioli F212|Bösendorfer 214VC/);
    assert.match(page, /class="piano-brand-instrument/);
    assert.match(page, /rel="canonical" href="https:\/\/klavierhaus\.com\/pianos\/steinway"/);
    assert.match(page, /hreflang="hu-HU" href="https:\/\/klavierhaus\.com\/hu\/zongorak\/steinway"/);
    assert.match(page, /"@type":"ItemList"/);

    const hungarian = await (await fetch(`${origin}/hu/zongorak/fazioli`)).text();
    assert.match(hungarian, /Fazioli F212/);
    assert.doesNotMatch(hungarian, /Steinway Model B|Bösendorfer 214VC/);
    assert.match(hungarian, /A kiválasztás hallgatással kezdődik/);
  });
});

test("Landing Page Design event labels are rendered on the public homepage without a redeploy", async () => {
  const api = createFakeApi();
  const originalFetch = api.fetchImpl;
  api.fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname !== "/api/public/website-content/global") return originalFetch(url, options);
    const language = parsed.searchParams.get("lang") === "hu" ? "hu" : "en";
    const content = JSON.parse(JSON.stringify(getGlobal(language)));
    content.eventLabels.homeTitle = language === "hu" ? "Szerkesztett eseményszínpad" : "Edited event stage";
    content.eventLabels.buyTickets = language === "hu" ? "Szerkesztett jegygomb" : "Edited ticket button";
    content.brand.wordmark = language === "hu" ? "SZERKESZTETT KLAVIERHAUS" : "EDITED KLAVIERHAUS";
    content.brand.footerLocations = language === "hu" ? "Szerkesztett helyszín" : "Edited location";
    return new Response(JSON.stringify({ page_key: "global", language, source: "database", version: 2, content }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  await withServer({
    baseUrl: "https://klavierhaus.com",
    allowIndexing: true,
    eventApiBaseUrl: "https://erp.example.com",
    fetchImpl: api.fetchImpl
  }, async (origin) => {
    const english = await (await fetch(`${origin}/`)).text();
    const hungarian = await (await fetch(`${origin}/hu/`)).text();
    assert.match(english, /Edited event stage/);
    assert.match(english, /Edited ticket button/);
    assert.match(english, /EDITED KLAVIERHAUS/);
    assert.match(english, /Edited location/);
    assert.doesNotMatch(english, /Szerkesztett eseményszínpad/);
    assert.match(hungarian, /Szerkesztett eseményszínpad/);
    assert.match(hungarian, /Szerkesztett jegygomb/);
    assert.match(hungarian, /SZERKESZTETT KLAVIERHAUS/);
    assert.match(hungarian, /Szerkesztett helyszín/);
    assert.doesNotMatch(hungarian, /Edited event stage/);
  });
});

test("cancelled public events remain visible, stop selling, and omit Offer structured data", async () => {
  const api = createFakeApi();
  const originalFetch = api.fetchImpl;
  api.fetchImpl = async (url, options = {}) => {
    const response = await originalFetch(url, options);
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith("/api/public/events")) return response;
    const payload = await response.json();
    const cancel = (item) => ({ ...item, status: "CANCELLED", checkout_available: false, reservation_available: false });
    return new Response(JSON.stringify(Array.isArray(payload) ? payload.map(cancel) : cancel(payload)), {
      status: response.status,
      headers: { "Content-Type": "application/json" }
    });
  };
  await withServer({
    baseUrl: "https://klavierhaus.com",
    allowIndexing: true,
    eventApiBaseUrl: "https://erp.example.com",
    fetchImpl: api.fetchImpl
  }, async (origin) => {
    const page = await (await fetch(`${origin}/events/golden-salon-evening`)).text();
    assert.match(page, /This event has been canceled by the organizer\. Please contact our customer service team regarding your refund\./);
    assert.doesNotMatch(page, /Continue to secure test checkout/);
    assert.match(page, /"eventStatus":"https:\/\/schema\.org\/EventCancelled"/);
    assert.doesNotMatch(page, /"@type":"Offer"/);
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
