"use strict";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function readableTicketType(sourceType) {
  return ({
    PURCHASE: "PUBLIC",
    INVITATION: "INVITATION",
    COMPLIMENTARY: "COMPLIMENTARY"
  })[sourceType] || sourceType || "TICKET";
}

function isValidTicket(row) {
  return !["VOID", "REFUNDED"].includes(String(row.ticket_status || "").toUpperCase());
}

function isActuallyPaidTicket(row) {
  return row.source_type === "PURCHASE"
    && Number(row.price_cents || 0) > 0
    && String(row.payment_status || "").toUpperCase() === "PAID"
    && isValidTicket(row);
}

function readGuestData(db, { search = "", eventId = "" } = {}) {
  const rows = db.prepare(`
    SELECT
      t.id AS ticket_id,t.event_id,t.source_type,t.ticket_variant,t.original_guest_name,t.attendee_name,t.contact_email,t.public_code,
      t.status AS ticket_status,t.price_cents,t.currency,t.payment_method,t.created_at,
      e.title_en,e.title_hu,e.start_at,e.end_at,e.venue_name,e.timezone,e.status AS event_status,
      COALESCE(p.status,t.payment_status) AS payment_status,
      a.status AS attendance_status
    FROM event_tickets t
    JOIN events e ON e.id=t.event_id
    LEFT JOIN event_payments p ON p.id=t.event_payment_id
    LEFT JOIN event_attendance_entries a ON a.ticket_id=t.id
    ORDER BY lower(COALESCE(t.attendee_name,'')),lower(COALESCE(t.contact_email,'')),e.start_at DESC,t.created_at,t.id
  `).all();

  const events = db.prepare(`
    SELECT id,title_en,title_hu,start_at,end_at,venue_name,timezone,status
    FROM events
    ORDER BY start_at DESC,id DESC
  `).all();

  const groups = new Map();
  for (const row of rows) {
    // Guest Data is a historical, static view. A voided or refunded ticket
    // remains visible in the guest/event relationship; only the paid-average
    // calculation excludes it.
    const name = String(row.original_guest_name || row.attendee_name || "").trim() || "Unknown guest";
    const email = String(row.contact_email || "").trim();
    const key = `${normalize(email)}\u0000${normalize(name)}`;
    let guest = groups.get(key);
    if (!guest) {
      guest = {
        guest_key: Buffer.from(key, "utf8").toString("base64url"),
        name,
        email,
        ticket_count: 0,
        paid_ticket_count: 0,
        paid_amount_cents: 0,
        currency: row.currency || "USD",
        events: []
      };
      groups.set(key, guest);
    }
    guest.ticket_count += 1;
    const paid = isActuallyPaidTicket(row);
    if (paid) {
      guest.paid_ticket_count += 1;
      guest.paid_amount_cents += Number(row.price_cents || 0);
      guest.currency = row.currency || guest.currency;
    }
    const event = guest.events.find((item) => item.id === row.event_id);
    if (event) {
      event.ticket_count += 1;
      if (paid) event.paid_ticket_count += 1;
      if (row.attendance_status === "PRESENT") event.attended = true;
      continue;
    }
    guest.events.push({
      id: row.event_id,
      title_en: row.title_en || "Klavierhaus event",
      title_hu: row.title_hu || row.title_en || "Klavierhaus event",
      start_at: row.start_at,
      end_at: row.end_at,
      venue_name: row.venue_name || "",
      timezone: row.timezone || "America/New_York",
      status: row.event_status || "",
      ticket_count: 1,
      paid_ticket_count: paid ? 1 : 0,
      attended: row.attendance_status === "PRESENT"
    });
  }

  const normalizedSearch = normalize(search);
  let guests = [...groups.values()].map((guest) => ({
    ...guest,
    event_count: guest.events.length,
    average_paid_price_cents: guest.paid_ticket_count ? Math.round(guest.paid_amount_cents / guest.paid_ticket_count) : null,
    events: guest.events.sort((left, right) => String(right.start_at || "").localeCompare(String(left.start_at || "")))
  }));
  guests = guests.filter((guest) => {
    if (eventId && !guest.events.some((event) => event.id === eventId)) return false;
    if (!normalizedSearch) return true;
    const haystack = [guest.name, guest.email, ...guest.events.flatMap((event) => [event.title_en, event.title_hu, event.venue_name])].map(normalize).join(" ");
    return haystack.includes(normalizedSearch);
  });
  guests.sort((left, right) => normalize(left.name).localeCompare(normalize(right.name)) || normalize(left.email).localeCompare(normalize(right.email)));
  return { guests, events };
}

module.exports = { isActuallyPaidTicket, readGuestData, readableTicketType };
