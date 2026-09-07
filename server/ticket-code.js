"use strict";

function clean(value, max = 120) {
  return String(value ?? "").trim().toUpperCase().slice(0, max);
}

function initials(value) {
  const words = clean(value).replace(/^EVC[-_]/, "").split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.length) return "EVT";
  if (words.length === 1) return words[0].slice(0, 3).padEnd(3, "X");
  return words.map((word) => word[0]).join("").slice(0, 3).padEnd(3, "X");
}

function stableNumber(value) {
  let hash = 2166136261;
  for (const character of clean(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % 1000).padStart(3, "0");
}

function eventNumber(event) {
  const source = clean(event?.event_key || event?.id);
  // The three-digit event segment is derived from the complete event key, not
  // only the year. That keeps two events in the same category/year distinct.
  return stableNumber(source || "KLAVIERHAUS-EVENT");
}

function accessPrefix(event, sourceType, ticketVariant = "") {
  const variant = clean(ticketVariant);
  if (variant === "VIP") return "V";
  if (variant === "INVITATION") return "I";
  if (["COMPLIMENTARY", "MANUAL", "ON_SITE_FREE"].includes(variant)) return "C";
  if (event?.access_type === "INTERNAL" || sourceType === "INTERNAL") return "V";
  if (event?.access_type === "INVITE_ONLY" || sourceType === "INVITATION") return "I";
  return "P";
}

function categorySegment(event) {
  return initials(event?.category_code || event?.category_name_en || event?.title_en || "EVENT");
}

function buildTicketCode(event, sourceType, sequence, ticketVariant = "") {
  return [
    accessPrefix(event, sourceType, ticketVariant),
    categorySegment(event),
    eventNumber(event),
    String(Math.max(1, Number(sequence) || 1)).padStart(2, "0")
  ].join("-");
}

function nextTicketCode(db, event, sourceType, initialSequence, ticketVariant = "") {
  let sequence = Math.max(1, Number(initialSequence) || 1);
  let code = buildTicketCode(event, sourceType, sequence, ticketVariant);
  while (db.prepare("SELECT 1 FROM event_tickets WHERE public_code=? LIMIT 1").get(code)) {
    sequence += 1;
    code = buildTicketCode(event, sourceType, sequence, ticketVariant);
  }
  return { code, sequence };
}

module.exports = { buildTicketCode, nextTicketCode };
