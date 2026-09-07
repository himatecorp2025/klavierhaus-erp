"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createTicketService } = require("../server/ticket-service");

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(__dirname, "..", "server", "schema.sql"), "utf8"));
  db.prepare("INSERT INTO event_categories(id,code,name_en,name_hu,active) VALUES('CAT-1','SALON','Salon','Szalon',1)").run();
  return db;
}

function insertEvent(db, id, overrides = {}) {
  const row = {
    id, event_key: `EV-${id}`, category_id: "CAT-1", access_type: "PUBLIC_FREE", status: "PUBLISHED",
    slug_en: `${id}-en`, slug_hu: `${id}-hu`, title_en: "Salon Event", title_hu: "Szalonest", venue_name: "Klavierhaus",
    venue_street: "790 11th Avenue", venue_city: "New York", venue_region: "NY", venue_postal_code: "10019", venue_country: "US",
    start_at: "2031-04-10T23:00:00.000Z", end_at: "2031-04-11T01:00:00.000Z", capacity_total: 1, special_capacity_total: 0,
    special_capacity_unlimited: 1, price_cents: 0, currency: "USD", ...overrides
  };
  db.prepare(`INSERT INTO events(id,event_key,category_id,access_type,status,slug_en,slug_hu,title_en,title_hu,venue_name,venue_street,venue_city,venue_region,venue_postal_code,venue_country,start_at,end_at,capacity_total,special_capacity_total,special_capacity_unlimited,price_cents,currency)
    VALUES(@id,@event_key,@category_id,@access_type,@status,@slug_en,@slug_hu,@title_en,@title_hu,@venue_name,@venue_street,@venue_city,@venue_region,@venue_postal_code,@venue_country,@start_at,@end_at,@capacity_total,@special_capacity_total,@special_capacity_unlimited,@price_cents,@currency)`).run(row);
}

test("public and special ticket pools are independent", () => {
  const db = makeDb();
  try {
    insertEvent(db, "EV-POOL");
    const service = createTicketService({ db });
    const vip = service.createTicket({ eventId: "EV-POOL", ticketVariant: "VIP", sourceType: "COMPLIMENTARY", attendeeName: "VIP Guest", contactEmail: "vip@example.com" });
    assert.equal(vip.ticket_variant, "VIP");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM event_attendance_entries WHERE ticket_id=?").get(vip.id).count, 1);
    assert.equal(service.capacity("EV-POOL").remaining, 1);
    service.createTicket({ eventId: "EV-POOL", ticketVariant: "PUBLIC_FREE", sourceType: "COMPLIMENTARY", attendeeName: "Public Guest", contactEmail: "public@example.com" });
    assert.equal(service.capacity("EV-POOL").remaining, 0);
    assert.throws(() => service.createTicket({ eventId: "EV-POOL", ticketVariant: "PUBLIC_FREE", sourceType: "COMPLIMENTARY", attendeeName: "Late Guest", contactEmail: "late@example.com" }), /EVENT_SOLD_OUT/);
  } finally { db.close(); }
});

test("deterministic ticket codes stay unique across a burst of creations", async () => {
  const db = makeDb();
  try {
    insertEvent(db, "EV-BURST", { capacity_total: 25 });
    const service = createTicketService({ db });
    const tickets = await Promise.all(Array.from({ length: 20 }, (_, index) => Promise.resolve().then(() => service.createTicket({
      eventId: "EV-BURST", ticketVariant: "PUBLIC_FREE", sourceType: "COMPLIMENTARY", attendeeName: `Burst Guest ${index + 1}`, contactEmail: `burst-${index + 1}@example.com`
    }))));
    const codes = tickets.map((ticket) => ticket.public_code);
    assert.equal(new Set(codes).size, tickets.length);
    assert.equal(new Set(tickets.map((ticket) => ticket.ticket_sequence)).size, tickets.length);
    assert.equal(service.capacity("EV-BURST").remaining, 5);
  } finally { db.close(); }
});

test("limited special capacity and on-site reservation expiry are enforced", () => {
  const db = makeDb();
  try {
    insertEvent(db, "EV-SPECIAL", { special_capacity_total: 1, special_capacity_unlimited: 0 });
    const service = createTicketService({ db });
    service.createTicket({ eventId: "EV-SPECIAL", ticketVariant: "INVITATION", sourceType: "INVITATION", attendeeName: "Invited Guest", contactEmail: "invite@example.com" });
    assert.throws(() => service.createTicket({ eventId: "EV-SPECIAL", ticketVariant: "COMPLIMENTARY", sourceType: "COMPLIMENTARY", attendeeName: "Second Guest", contactEmail: "second@example.com" }), /SPECIAL_TICKET_CAPACITY_REACHED/);

    insertEvent(db, "EV-ONSITE", { start_at: "2030-01-01T12:00:00.000Z", end_at: "2030-01-01T14:00:00.000Z", capacity_total: 2 });
    const onsite = service.createTicket({ eventId: "EV-ONSITE", ticketVariant: "ON_SITE", sourceType: "PURCHASE", attendeeName: "On Site Guest", contactEmail: "onsite@example.com", priceCents: 1000 });
    assert.equal(onsite.payment_status, "PENDING");
    assert.equal(onsite.reservation_status, "RESERVED");
    assert.equal(service.expireOnSiteReservations(new Date("2030-01-02T00:00:00.000Z")), 1);
    assert.equal(db.prepare("SELECT status,payment_status,reservation_status FROM event_tickets WHERE id=?").get(onsite.id).status, "VOID");
  } finally { db.close(); }
});
