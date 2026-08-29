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
try {
  for (let run = 1; run <= 2; run += 1) {
    const result = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], { cwd: projectRoot, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`MIGRATION_RUN_${run}_FAILED\n${result.stdout}\n${result.stderr}`);
  }
  const db = new Database(dbPath, { readonly: true });
  const counts = {
    artists: db.prepare("SELECT COUNT(*) AS count FROM website_artists WHERE is_sample=1").get().count,
    services: db.prepare("SELECT COUNT(*) AS count FROM website_services WHERE is_sample=1").get().count,
    pianos: db.prepare("SELECT COUNT(*) AS count FROM website_showroom_pianos WHERE is_sample=1").get().count,
    reviews: db.prepare("SELECT COUNT(*) AS count FROM website_reviews WHERE is_sample=1").get().count,
    events: db.prepare("SELECT COUNT(*) AS count FROM events WHERE is_sample=1").get().count
  };
  if (JSON.stringify(counts) !== JSON.stringify({ artists: 3, services: 3, pianos: 6, reviews: 3, events: 3 })) throw new Error(`SAMPLE_COUNTS_INVALID:${JSON.stringify(counts)}`);
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("SQLITE_INTEGRITY_FAILED");
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("SQLITE_FOREIGN_KEY_FAILED");
  const artistForeignKey = db.prepare("PRAGMA foreign_key_list(events)").all().some((row) => row.from === "artist_id" && row.table === "website_artists");
  if (!artistForeignKey) throw new Error("EVENT_ARTIST_FOREIGN_KEY_MISSING");
  db.close();
  console.log("migration smoke check passed (two runs, samples, integrity, foreign keys)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
