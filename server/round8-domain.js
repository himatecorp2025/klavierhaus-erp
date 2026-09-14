"use strict";

const LANDING_SECTION_KEYS = Object.freeze(["hero", "featured_pianos", "craftsmanship", "salon_events", "testimonials", "contact_cta"]);
const JOB_TIMEZONE = "America/New_York";

function defaultLandingSections() {
  return LANDING_SECTION_KEYS.map((section_key, order_index) => ({ section_key, is_active: 1, order_index }));
}
function normalizeLandingSections(rows = []) {
  const byKey = new Map(rows.map((row) => [String(row.section_key), row]));
  return defaultLandingSections().map((fallback) => {
    const row = byKey.get(fallback.section_key) || fallback;
    return { section_key: fallback.section_key, is_active: Number(row.is_active) === 0 ? 0 : 1, order_index: Number.isFinite(Number(row.order_index)) ? Number(row.order_index) : fallback.order_index };
  }).sort((a, b) => a.order_index - b.order_index || LANDING_SECTION_KEYS.indexOf(a.section_key) - LANDING_SECTION_KEYS.indexOf(b.section_key));
}
function verifyBalanceSheet(assets, liabilities, equity) {
  const difference = Number(assets || 0) - (Number(liabilities || 0) + Number(equity || 0));
  return { balanced: Math.abs(difference) < 0.01, difference, absolute_difference: Math.abs(difference) };
}
function pianoAge(buildYear, currentYear = new Date().getFullYear()) {
  const year = Number(buildYear);
  const now = Number(currentYear);
  if (!Number.isInteger(year) || year < 1700 || year > now) return null;
  return now - year;
}
function solarThemeForHour(hour) {
  const value = Number(hour);
  return value >= 7 && value < 19 ? "light" : "dark";
}
function workflowCalendarGate(item = {}) {
  return Boolean(item.assigned_user_id && item.due_at);
}
function workflowStatus(item = {}, todayKey = "") {
  const status = String(item.status || item.current_status || "").toUpperCase();
  if (["COMPLETED", "FINALIZED"].includes(status)) return { state: "CLOSED", colorClass: "status-green" };
  const dueDate = String(item.due_at || item.due_date || item.final_due_at || "").slice(0, 10);
  if (dueDate && todayKey && dueDate < todayKey) return { state: "OVERDUE", colorClass: "status-red" };
  return { state: "IN_PROGRESS", colorClass: "status-orange" };
}
module.exports = { LANDING_SECTION_KEYS, JOB_TIMEZONE, defaultLandingSections, normalizeLandingSections, verifyBalanceSheet, pianoAge, solarThemeForHour, workflowCalendarGate, workflowStatus };
