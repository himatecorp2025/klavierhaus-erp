"use strict";

// Public piano-brand ordering shared by the catalog API and the CMS.
// The website deployment is a separate service; it receives ordered rows over HTTP.
const SETTING_KEY = "website_piano_brand_display_order";

function pianoBrandSlug(value) {
  const source = String(value || "").trim();
  if (/^steinway/i.test(source)) return "steinway";
  if (/^fazioli/i.test(source)) return "fazioli";
  if (/^(bösendorfer|bosendorfer)/i.test(source)) return "bosendorfer";
  return source.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function brandDisplayLabel(value) {
  const slug = pianoBrandSlug(value);
  return ({ steinway: "Steinway & Sons", fazioli: "Fazioli", bosendorfer: "Bösendorfer" })[slug]
    || String(value || "").trim();
}

function savedBrandOrder(db) {
  const row = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(SETTING_KEY);
  try {
    const values = JSON.parse(row?.setting_value || "[]");
    return Array.isArray(values) ? values.filter((id) => typeof id === "string" && /^[a-z0-9-]{1,80}$/.test(id)) : [];
  } catch (_error) {
    return [];
  }
}

function brandGroups(rows, preferred = []) {
  const bySlug = new Map();
  for (const [index, row] of rows.entries()) {
    const slug = pianoBrandSlug(row.brand);
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, { id: slug, label: brandDisplayLabel(row.brand), count: 0, firstIndex: index });
    bySlug.get(slug).count++;
  }
  const preferredIndex = new Map(preferred.map((id, index) => [id, index]));
  return [...bySlug.values()].sort((a, b) => {
    const ai = preferredIndex.has(a.id) ? preferredIndex.get(a.id) : Infinity;
    const bi = preferredIndex.has(b.id) ? preferredIndex.get(b.id) : Infinity;
    return ai - bi || a.firstIndex - b.firstIndex;
  }).map(({ firstIndex, ...row }, index) => ({ ...row, position: index + 1 }));
}

function reorderPianoRows(rows, preferred = []) {
  const groups = brandGroups(rows, preferred);
  const ranking = new Map(groups.map((group, index) => [group.id, index]));
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) => (ranking.get(pianoBrandSlug(a.row.brand)) ?? Infinity) - (ranking.get(pianoBrandSlug(b.row.brand)) ?? Infinity) || a.index - b.index)
    .map(({ row }) => row);
}

function validateOrder(ids, currentIds) {
  if (!Array.isArray(ids) || ids.length !== currentIds.length || ids.some((id) => typeof id !== "string")) {
    throw new Error("INVALID_DISPLAY_ORDER");
  }
  if (new Set(ids).size !== ids.length || !ids.every((id) => currentIds.includes(id))) {
    throw new Error("INVALID_DISPLAY_ORDER");
  }
  return ids;
}

module.exports = { SETTING_KEY, pianoBrandSlug, brandGroups, savedBrandOrder, reorderPianoRows, validateOrder };
