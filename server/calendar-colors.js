const WORKER_COLOR_PALETTE = Object.freeze([
  "#2563EB",
  "#7C3AED",
  "#EA580C",
  "#EAB308",
  "#92400E",
  "#0891B2",
  "#DB2777",
  "#4338CA",
  "#65A30D",
  "#C2410C",
  "#0F766E",
  "#A16207"
]);

const RESERVED_STATUS_COLORS = Object.freeze([
  "#F59E0B", // Partially completed / Részlegesen lezárt
  "#22C55E", // Completed / Teljesen lezárt
  "#EF4444", // Overdue / Lejárt
  "#6B7280"  // Failed / Sikertelen
]);

const KNOWN_WORKER_COLOR_INDEXES = Object.freeze({
  "Károly": 0,
  Karoly: 0,
  Alex: 1,
  Misi: 2,
  Paul: 3,
  Pol: 3,
  Said: 4
});

function normalizeCalendarColor(value) {
  const color = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : "";
}

function isReservedCalendarColor(value) {
  const color = normalizeCalendarColor(value);
  return Boolean(color && RESERVED_STATUS_COLORS.includes(color));
}

function validateCalendarColor(value) {
  const color = normalizeCalendarColor(value);
  if (!color) return { ok: false, error: "INVALID_CALENDAR_COLOR" };
  if (isReservedCalendarColor(color)) return { ok: false, error: "RESERVED_CALENDAR_COLOR" };
  return { ok: true, color };
}

function legacyCalendarColor(name, orderedWorkerNames = []) {
  const normalizedName = String(name || "").trim();
  if (Object.prototype.hasOwnProperty.call(KNOWN_WORKER_COLOR_INDEXES, normalizedName)) {
    return WORKER_COLOR_PALETTE[KNOWN_WORKER_COLOR_INDEXES[normalizedName]];
  }

  const names = orderedWorkerNames.map((workerName) => String(workerName || "").trim()).filter(Boolean);
  const index = names.indexOf(normalizedName);
  const fallbackStart = 5;
  if (index >= 0) return WORKER_COLOR_PALETTE[(fallbackStart + index) % WORKER_COLOR_PALETTE.length];

  let hash = 0;
  for (let i = 0; i < normalizedName.length; i += 1) {
    hash = (hash * 31 + normalizedName.charCodeAt(i)) >>> 0;
  }
  return WORKER_COLOR_PALETTE[(fallbackStart + hash) % WORKER_COLOR_PALETTE.length];
}

function backfillUserCalendarColors(db, log = () => {}) {
  const activeVisibleWorkers = db.prepare(`
    SELECT id,name
    FROM users
    WHERE status='Active'
      AND COALESCE(hidden_user,0)=0
      AND role IN ('ADMIN','MANAGER','WORKER')
    ORDER BY name
  `).all();
  const orderedNames = activeVisibleWorkers.map((worker) => worker.name);
  const update = db.prepare(`
    UPDATE users
    SET calendar_color=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND (calendar_color IS NULL OR TRIM(calendar_color)='')
  `);

  let updated = 0;
  const backfill = db.transaction(() => {
    for (const worker of activeVisibleWorkers) {
      updated += Number(update.run(legacyCalendarColor(worker.name, orderedNames), worker.id).changes || 0);
    }

    const remainingVisibleUsers = db.prepare(`
      SELECT id,name
      FROM users
      WHERE COALESCE(hidden_user,0)=0
        AND role IN ('ADMIN','MANAGER','WORKER')
        AND (calendar_color IS NULL OR TRIM(calendar_color)='')
      ORDER BY name
    `).all();
    for (const worker of remainingVisibleUsers) {
      updated += Number(update.run(legacyCalendarColor(worker.name), worker.id).changes || 0);
    }
  });
  backfill();
  if (updated) log(`Preserved and stored ${updated} existing worker calendar color(s)`);
  return updated;
}

module.exports = {
  WORKER_COLOR_PALETTE,
  RESERVED_STATUS_COLORS,
  KNOWN_WORKER_COLOR_INDEXES,
  normalizeCalendarColor,
  isReservedCalendarColor,
  validateCalendarColor,
  legacyCalendarColor,
  backfillUserCalendarColors
};
