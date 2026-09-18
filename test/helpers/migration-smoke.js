"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");

const projectRoot = path.resolve(__dirname, "../..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klavierhaus-migration-smoke-"));
const dbPath = path.join(tempRoot, "smoke.sqlite");
const backupDir = path.join(tempRoot, "backups");
const env = { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir, WEBSITE_BASE_URL: "https://smoke.example.com", WEBSITE_AUTO_INSTALL_SAMPLES: "true" };
function runInit(label) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], { cwd: projectRoot, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${label}_FAILED\n${result.stdout}\n${result.stderr}`);
}
try {
  runInit("MIGRATION_FRESH_RUN_1");
  // Exercise the retained financial source's pre-link schema after Phase I:
  // exists but calendar_job_id does not. init-db must add it before schema.sql
  // can create idx_workflow_stage_calendar_job.
  const legacyDb = new Database(dbPath);
  legacyDb.pragma("foreign_keys = OFF");
  legacyDb.exec("DROP INDEX IF EXISTS idx_workflow_stage_calendar_job");
  legacyDb.exec("ALTER TABLE workflow_finance_phases DROP COLUMN calendar_job_id");
  legacyDb.close();
  runInit("MIGRATION_LEGACY_CALENDAR_LINK_RUN_2");
  runInit("MIGRATION_IDEMPOTENT_RUN_3");
  const db = new Database(dbPath, { readonly: true });
  const counts = {
    artists: db.prepare("SELECT COUNT(*) AS count FROM website_artists WHERE is_sample=1").get().count,
    services: db.prepare("SELECT COUNT(*) AS count FROM website_services WHERE is_sample=1").get().count,
    pianos: db.prepare("SELECT COUNT(*) AS count FROM website_showroom_pianos WHERE is_sample=1").get().count,
    reviews: db.prepare("SELECT COUNT(*) AS count FROM website_reviews WHERE is_sample=1").get().count,
    events: db.prepare("SELECT COUNT(*) AS count FROM events WHERE is_sample=1").get().count
  };
  if (JSON.stringify(counts) !== JSON.stringify({ artists: 0, services: 0, pianos: 0, reviews: 0, events: 0 })) throw new Error(`SAMPLE_COUNTS_INVALID:${JSON.stringify(counts)}`);
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("SQLITE_INTEGRITY_FAILED");
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("SQLITE_FOREIGN_KEY_FAILED");
  const calendarJobColumn = db.prepare("PRAGMA table_info(workflow_finance_phases)").all().some((row) => row.name === "calendar_job_id");
  if (!calendarJobColumn) throw new Error("WORKFLOW_STAGE_CALENDAR_JOB_COLUMN_MISSING");
  const calendarJobIndex = db.prepare("PRAGMA index_list(workflow_finance_phases)").all().some((row) => row.name === "idx_workflow_stage_calendar_job");
  if (!calendarJobIndex) throw new Error("WORKFLOW_STAGE_CALENDAR_JOB_INDEX_MISSING");
  const artistForeignKey = db.prepare("PRAGMA foreign_key_list(events)").all().some((row) => row.from === "artist_id" && row.table === "website_artists");
  if (!artistForeignKey) throw new Error("EVENT_ARTIST_FOREIGN_KEY_MISSING");
  db.close();
  console.log("migration smoke check passed (fresh + legacy calendar-link upgrade + idempotent run, no auto-samples, integrity, foreign keys)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
