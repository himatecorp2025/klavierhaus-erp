"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseGuestName } = require("../server/name-format");
const { buildTicketCode } = require("../server/ticket-code");
const { generateTicketDocumentPdf, ticketDesignType, ticketPalette } = require("../server/document-pdf");

const logoPath = path.join(__dirname, "..", "server", "assets", "klavierhaus-logo-white.png");
const legacyLogoPath = path.join(__dirname, "..", "server", "assets", "klavierhaus-logo-black.jpg");

test("guest names preserve the original value and cap formatted components", () => {
  const parsed = parseGuestName("Dr. Anna Maria von Beethoven Ludwig IV");
  assert.equal(parsed.original_name, "Dr. Anna Maria von Beethoven Ludwig IV");
  assert.equal(parsed.salutation, "Dr.");
  assert.equal(parsed.first_names, "Anna Maria");
  assert.equal(parsed.surnames, "von …");
  assert.equal(parsed.suffix, "IV");
  assert.match(parsed.display_name, /^Dr\. Anna Maria von … IV$/);
});

test("ticket codes are deterministic and use the approved access prefix", () => {
  const event = { id: "EV-1", event_key: "EV-2031-ABCD", access_type: "PUBLIC_PAID", category_code: "SALON" };
  assert.equal(buildTicketCode(event, "PURCHASE", 1, "PUBLIC_PAID"), buildTicketCode(event, "PURCHASE", 1, "PUBLIC_PAID"));
  assert.match(buildTicketCode(event, "PURCHASE", 1, "PUBLIC_PAID"), /^P-[A-Z0-9]{3}-\d{3}-01$/);
  assert.match(buildTicketCode(event, "INVITATION", 2, "INVITATION"), /^I-[A-Z0-9]{3}-\d{3}-02$/);
  assert.match(buildTicketCode(event, "COMPLIMENTARY", 3, "VIP"), /^V-[A-Z0-9]{3}-\d{3}-03$/);
});

test("ticket PDF modes keep the boarding-pass format", () => {
  const event = {
    event_key: "EV-2031-ABCD", custom_type: "Chamber recital", title_en: "Salon Evening", title_hu: "Szalonest",
    start_at: "2031-04-10T23:00:00.000Z", end_at: "2031-04-11T01:00:00.000Z", timezone: "America/New_York",
    venue_name: "Klavierhaus", venue_street: "790 11th Avenue", venue_city: "New York", venue_region: "NY", venue_postal_code: "10019", currency: "USD"
  };
  const ticket = { id: "T-1", public_code: "P-SAL-123-01", ticket_variant: "PUBLIC_PAID", attendee_name: "Anna Maria Beethoven", price_cents: 12500, currency: "USD" };
  const front = generateTicketDocumentPdf({ event, tickets: [ticket], mode: "front" });
  const back = generateTicketDocumentPdf({ event, tickets: [ticket], mode: "back" });
  const full = generateTicketDocumentPdf({ event, tickets: [ticket], mode: "full" });
  for (const pdf of [front, back, full]) {
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.toString("latin1"), /612 252/);
  }
  assert.equal((full.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 2);
});

test("ticket palettes use the approved three visual designs", () => {
  const normal = ticketPalette("PUBLIC_PAID");
  const vip = ticketPalette("INVITATION");
  const honorary = ticketPalette("COMPLIMENTARY");
  assert.equal(ticketDesignType("PUBLIC_FREE"), "NORMAL");
  assert.equal(ticketDesignType("VIP"), "VIP");
  assert.equal(ticketDesignType("INVITATION"), "VIP");
  assert.equal(ticketDesignType("COMPLIMENTARY"), "HONORARY");
  assert.equal(normal.logoResource, "LogoWhite");
  assert.equal(normal.background, "0.02 0.02 0.02");
  assert.equal(normal.border, "0.788 0.663 0.369");
  assert.equal(vip.logoResource, "LogoBlack");
  assert.equal(vip.background, "0.788 0.663 0.369");
  assert.equal(vip.border, "0.02 0.02 0.02");
  assert.equal(honorary.logoResource, "LogoGold");
  assert.equal(honorary.background, "0.76 0.78 0.80");
  assert.equal(honorary.border, "0.788 0.663 0.369");
  assert.equal(honorary.title, "0.788 0.663 0.369");
  assert.equal(honorary.foreground, "0.02 0.02 0.02");
});

test("ticket PDFs render recolored Klavierhaus logos and never show a price on VIP or honorary tickets", () => {
  const event = {
    event_key: "EV-2031-ABCD", custom_type: "Chamber recital", title_en: "Salon Evening", title_hu: "Szalonest",
    start_at: "2031-04-10T23:00:00.000Z", end_at: "2031-04-11T01:00:00.000Z", timezone: "America/New_York",
    venue_name: "Klavierhaus", venue_street: "790 11th Avenue", venue_city: "New York", venue_region: "NY", venue_postal_code: "10019", currency: "USD"
  };
  const makeTicket = (ticket_variant) => ({ id: "T-1", public_code: "P-PC-042-01", ticket_variant, attendee_name: "Anna Maria Beethoven", price_cents: 12500, payment_status: "PAID", currency: "USD" });
  const normalText = spawnSync("pdftotext", ["-", "-"], { input: generateTicketDocumentPdf({ event, tickets: [makeTicket("PUBLIC_PAID")], mode: "front", logoPath }) }).stdout.toString("utf8");
  assert.match(normalText, /USD 125\.00/);
  const legacyLogoPdf = generateTicketDocumentPdf({ event, tickets: [makeTicket("PUBLIC_PAID")], mode: "front", logoPath: legacyLogoPath });
  assert.match(legacyLogoPdf.toString("latin1"), /\/LogoWhite Do/);
  for (const variant of ["VIP", "INVITATION", "COMPLIMENTARY"]) {
    for (const mode of ["front", "back", "full"]) {
      const pdf = generateTicketDocumentPdf({ event, tickets: [makeTicket(variant)], mode, logoPath });
      const text = spawnSync("pdftotext", ["-", "-"], { input: pdf }).stdout.toString("utf8");
      assert.doesNotMatch(text, /PRICE|USD 125\.00|FREE|COMPLIMENTARY|NO PRICE/);
      const source = pdf.toString("latin1");
      const resourceName = variant === "COMPLIMENTARY" ? "LogoGold" : "LogoBlack";
      assert.match(source, new RegExp(`/${resourceName} \\d+ 0 R`));
      assert.match(source, new RegExp(`/${resourceName} Do`));
    }
  }
});
