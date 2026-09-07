"use strict";

const crypto = require("node:crypto");
const { nextTicketCode } = require("./ticket-code");
const { parseGuestName } = require("./name-format");

const TICKET_VARIANTS = new Set([
  "PUBLIC_PAID", "PUBLIC_FREE", "VIP", "INVITATION", "COMPLIMENTARY", "MANUAL", "ON_SITE"
]);
const PUBLIC_CAPACITY_VARIANTS = new Set(["PUBLIC_PAID", "PUBLIC_FREE", "ON_SITE"]);
const ACTIVE_TICKET_STATUSES = new Set(["VALID", "USED"]);

function clean(value, max = 5000) {
  return String(value ?? "").replace(/[\u0000\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeEmail(value) { return clean(value, 320).toLowerCase(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`; }

function sourceTypeForVariant(variant) {
  return variant === "INVITATION" ? "INVITATION" : ["PUBLIC_PAID", "ON_SITE"].includes(variant) ? "PURCHASE" : "COMPLIMENTARY";
}

function ticketVariantForRow(row, event = {}) {
  const existing = clean(row?.ticket_variant, 40).toUpperCase();
  if (TICKET_VARIANTS.has(existing)) return existing;
  if (row?.source_type === "PURCHASE") return "PUBLIC_PAID";
  if (row?.source_type === "INVITATION") return "INVITATION";
  return event.access_type === "PUBLIC_FREE" ? "PUBLIC_FREE" : "COMPLIMENTARY";
}

function isPublicCapacityVariant(variant) { return PUBLIC_CAPACITY_VARIANTS.has(String(variant || "").toUpperCase()); }
function isActiveTicket(row) { return ACTIVE_TICKET_STATUSES.has(String(row?.status || "").toUpperCase()); }

function createTicketService({ db }) {
  function eventById(eventId) {
    return db.prepare(`SELECT e.*,c.code AS category_code,c.name_en AS category_name_en,c.name_hu AS category_name_hu
      FROM events e LEFT JOIN event_categories c ON c.id=e.category_id WHERE e.id=?`).get(eventId) || null;
  }

  function activeHoldCount(eventId, now = new Date()) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='event_checkout_holds'").get()) return 0;
    return Number(db.prepare("SELECT COALESCE(SUM(quantity),0) AS count FROM event_checkout_holds WHERE event_id=? AND status='PENDING' AND expires_at>?").get(eventId, now.toISOString())?.count || 0);
  }

  function capacity(eventId, now = new Date()) {
    const event = eventById(eventId);
    if (!event) return null;
    const rows = db.prepare("SELECT ticket_variant,source_type,status FROM event_tickets WHERE event_id=?").all(eventId);
    const publicOccupied = rows.filter((row) => isActiveTicket(row) && isPublicCapacityVariant(ticketVariantForRow(row, event))).length;
    const specialOccupied = rows.filter((row) => isActiveTicket(row) && !isPublicCapacityVariant(ticketVariantForRow(row, event))).length;
    const held = activeHoldCount(eventId, now);
    const publicRemaining = Math.max(0, Number(event.capacity_total || 0) - publicOccupied - held);
    const specialUnlimited = Number(event.special_capacity_unlimited ?? 1) === 1;
    const specialRemaining = specialUnlimited ? null : Math.max(0, Number(event.special_capacity_total || 0) - specialOccupied);
    const counts = {
      occupied: publicOccupied,
      valid: rows.filter((row) => row.status === "VALID").length,
      used: rows.filter((row) => row.status === "USED").length,
      void: rows.filter((row) => row.status === "VOID").length,
      refunded: rows.filter((row) => row.status === "REFUNDED").length,
      public_paid: rows.filter((row) => isActiveTicket(row) && ticketVariantForRow(row, event) === "PUBLIC_PAID").length,
      public_free: rows.filter((row) => isActiveTicket(row) && ticketVariantForRow(row, event) === "PUBLIC_FREE").length,
      on_site: rows.filter((row) => isActiveTicket(row) && ticketVariantForRow(row, event) === "ON_SITE").length,
      vip: rows.filter((row) => isActiveTicket(row) && ticketVariantForRow(row, event) === "VIP").length,
      invitation: rows.filter((row) => isActiveTicket(row) && ticketVariantForRow(row, event) === "INVITATION").length,
      complimentary: rows.filter((row) => isActiveTicket(row) && ["COMPLIMENTARY", "MANUAL"].includes(ticketVariantForRow(row, event))).length
    };
    return {
      total: Number(event.capacity_total || 0), occupied: publicOccupied, held,
      remaining: publicRemaining, public_occupied: publicOccupied,
      special_total: Number(event.special_capacity_total || 0), special_occupied: specialOccupied,
      special_unlimited: specialUnlimited, special_remaining: specialRemaining, counts
    };
  }

  function createTicket(input = {}) {
    const event = eventById(input.eventId);
    if (!event) throw Object.assign(new Error("EVENT_NOT_FOUND"), { status: 404 });
    if (["CANCELLED", "CLOSED"].includes(event.status)) throw Object.assign(new Error("EVENT_NOT_AVAILABLE"), { status: 409 });
    const variant = clean(input.ticketVariant || input.variant || "", 40).toUpperCase() || (input.sourceType === "INVITATION" ? "INVITATION" : input.sourceType === "PURCHASE" ? "PUBLIC_PAID" : event.access_type === "PUBLIC_FREE" ? "PUBLIC_FREE" : "COMPLIMENTARY");
    if (!TICKET_VARIANTS.has(variant)) throw Object.assign(new Error("INVALID_TICKET_VARIANT"), { status: 400 });
    const sourceType = clean(input.sourceType || sourceTypeForVariant(variant), 40).toUpperCase();
    if (!["PURCHASE", "INVITATION", "COMPLIMENTARY"].includes(sourceType)) throw Object.assign(new Error("INVALID_TICKET_SOURCE"), { status: 400 });
    const cap = capacity(event.id);
    const publicCapacity = isPublicCapacityVariant(variant);
    if (publicCapacity && cap.remaining < 1) throw Object.assign(new Error("EVENT_SOLD_OUT"), { status: 409 });
    if (!publicCapacity && !cap.special_unlimited && Number(cap.special_remaining) < 1) throw Object.assign(new Error("SPECIAL_TICKET_CAPACITY_REACHED"), { status: 409 });

    const parsed = parseGuestName(input.attendeeName || input.guestName || input.buyerName || "Unknown guest", {
      original_name: input.originalGuestName,
      salutation: input.salutation,
      first_names: input.firstNames,
      surnames: input.surnames,
      suffix: input.suffix
    });
    const priceCents = Math.max(0, Number(input.priceCents || 0));
    const paymentStatus = clean(input.paymentStatus, 30).toUpperCase() || ((variant === "PUBLIC_PAID" || variant === "ON_SITE") ? "PENDING" : priceCents > 0 ? "PENDING" : "NOT_REQUIRED");
    const isPaid = paymentStatus === "PAID";
    const reservationStatus = clean(input.reservationStatus, 30).toUpperCase() || ((variant === "ON_SITE" || variant === "MANUAL") && !isPaid ? "RESERVED" : "FINALIZED");
    const onSiteDeadline = variant === "ON_SITE" ? new Date(new Date(event.start_at).getTime() - 24 * 60 * 60 * 1000).toISOString() : null;
    const sequenceRow = db.prepare("SELECT COALESCE(MAX(ticket_sequence),0)+1 AS next FROM event_tickets WHERE event_id=?").get(event.id);
    const initialSequence = Math.max(1, Number(input.ticketSequence || sequenceRow?.next || 1));
    const generated = nextTicketCode(db, event, sourceType, initialSequence, variant === "ON_SITE" ? "PUBLIC_PAID" : variant);
    const id = input.id || newId("EVTKT");
    const contactEmail = normalizeEmail(input.contactEmail);
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO event_tickets(
      id,event_id,invitation_id,contact_id,source_type,ticket_variant,buyer_name,attendee_name,original_guest_name,salutation,first_names,surnames,suffix,contact_email,public_code,status,price_cents,currency,payment_method,payment_status,reservation_status,on_site_deadline_at,reserved_at,paid_at,finalized_at,event_payment_id,ticket_sequence,created_by_user_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run(id, event.id, input.invitationId || null, input.contactId || null, sourceType, variant, clean(input.buyerName || input.guestName || parsed.display_name, 200), parsed.display_name, parsed.original_name,
      parsed.salutation, parsed.first_names, parsed.surnames, parsed.suffix, contactEmail, generated.code, "VALID", priceCents, clean(input.currency || event.currency || "USD", 3).toUpperCase(), clean(input.paymentMethod, 60) || null,
      paymentStatus, reservationStatus, onSiteDeadline, now, isPaid ? now : null, reservationStatus === "FINALIZED" ? now : null, input.eventPaymentId || null, generated.sequence, input.userId || null);
    db.prepare(`INSERT OR IGNORE INTO event_attendance_entries(id,event_id,ticket_id,status)
      VALUES(?,?,?,'NOT_ARRIVED')`).run(`ATTE-${id}`, event.id, id);
    if (publicCapacity && capacity(event.id).remaining <= 0) db.prepare("UPDATE events SET sold_out_at=COALESCE(sold_out_at,CURRENT_TIMESTAMP) WHERE id=?").run(event.id);
    return db.prepare("SELECT * FROM event_tickets WHERE id=?").get(id);
  }

  function markPaid(ticketId, { paymentMethod = "ON_SITE", eventPaymentId = null } = {}) {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId);
    if (!ticket) throw Object.assign(new Error("TICKET_NOT_FOUND"), { status: 404 });
    if (["VOID", "REFUNDED"].includes(ticket.status)) throw Object.assign(new Error("TICKET_NOT_ACTIVE"), { status: 409 });
    if (ticket.ticket_variant === "ON_SITE" && ticket.payment_status !== "PAID" && ticket.on_site_deadline_at && new Date(ticket.on_site_deadline_at).getTime() <= Date.now()) {
      expireOnSiteReservations(new Date());
      throw Object.assign(new Error("ON_SITE_RESERVATION_EXPIRED"), { status: 409 });
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE event_tickets SET payment_method=?,payment_status='PAID',reservation_status='FINALIZED',paid_at=COALESCE(paid_at,?),finalized_at=COALESCE(finalized_at,?),event_payment_id=COALESCE(?,event_payment_id),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(clean(paymentMethod, 60), now, now, eventPaymentId, ticketId);
    return db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId);
  }

  function expireOnSiteReservations(now = new Date()) {
    const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const result = db.prepare(`UPDATE event_tickets SET status='VOID',payment_status='EXPIRED',reservation_status='EXPIRED',voided_at=?,updated_at=CURRENT_TIMESTAMP
      WHERE ticket_variant='ON_SITE' AND status='VALID' AND payment_status<>'PAID' AND on_site_deadline_at IS NOT NULL AND on_site_deadline_at<=?`).run(timestamp, timestamp);
    return result.changes;
  }

  return Object.freeze({ capacity, createTicket, eventById, expireOnSiteReservations, markPaid });
}

module.exports = {
  ACTIVE_TICKET_STATUSES,
  PUBLIC_CAPACITY_VARIANTS,
  TICKET_VARIANTS,
  createTicketService,
  isActiveTicket,
  isPublicCapacityVariant,
  sourceTypeForVariant,
  ticketVariantForRow
};
