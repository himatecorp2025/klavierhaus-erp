const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  RESERVED_STATUS_COLORS,
  normalizeCalendarColor,
  validateCalendarColor,
  legacyCalendarColor,
  backfillUserCalendarColors
} = require("../server/calendar-colors");

test("legacy colors remain identical for the named Klavierhaus workers", () => {
  assert.equal(legacyCalendarColor("Károly"), "#2563EB");
  assert.equal(legacyCalendarColor("Karoly"), "#2563EB");
  assert.equal(legacyCalendarColor("Alex"), "#7C3AED");
  assert.equal(legacyCalendarColor("Misi"), "#EA580C");
  assert.equal(legacyCalendarColor("Paul"), "#EAB308");
  assert.equal(legacyCalendarColor("Pol"), "#EAB308");
  assert.equal(legacyCalendarColor("Said"), "#92400E");
});

test("calendar color validation normalizes hexadecimal values and rejects status colors", () => {
  assert.equal(normalizeCalendarColor(" #aabbcc "), "#AABBCC");
  assert.deepEqual(validateCalendarColor("#123abc"), { ok: true, color: "#123ABC" });
  assert.equal(validateCalendarColor("blue").error, "INVALID_CALENDAR_COLOR");
  for (const color of RESERVED_STATUS_COLORS) {
    assert.equal(validateCalendarColor(color).error, "RESERVED_CALENDAR_COLOR");
  }
});

test("backfill stores current visible-worker colors without overwriting a chosen color", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'Active',
      calendar_color TEXT,
      hidden_user INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const insert = db.prepare("INSERT INTO users(id,name,role,status,calendar_color,hidden_user) VALUES(?,?,?,?,?,?)");
  insert.run("U1", "Károly", "ADMIN", "Active", null, 0);
  insert.run("U2", "Alex", "ADMIN", "Active", "#ABCDEF", 0);
  insert.run("U3", "Misi", "MANAGER", "Active", null, 0);
  insert.run("U4", "Said", "WORKER", "Inactive", null, 0);
  insert.run("U5", "Hidden owner", "ADMIN", "Active", null, 1);

  assert.equal(backfillUserCalendarColors(db), 3);
  const rows = Object.fromEntries(db.prepare("SELECT id,calendar_color FROM users ORDER BY id").all().map((row) => [row.id, row.calendar_color]));
  assert.equal(rows.U1, "#2563EB");
  assert.equal(rows.U2, "#ABCDEF");
  assert.equal(rows.U3, "#EA580C");
  assert.equal(rows.U4, "#92400E");
  assert.equal(rows.U5, null);
  db.close();
});
