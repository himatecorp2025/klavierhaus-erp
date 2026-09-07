"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGuestName } = require("../server/name-format");
const { buildTicketCode } = require("../server/ticket-code");
const { generateTicketDocumentPdf } = require("../server/document-pdf");

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
