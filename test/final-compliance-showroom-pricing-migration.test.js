"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");

const root = path.join(__dirname, "..");

test("existing showroom data survives price migration and is backed up before changing the schema", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-showroom-price-migration-"));
  const dbFile = path.join(dir, "existing.sqlite");
  const env = {
    ...process.env,
    DB_PATH: dbFile,
    BACKUP_DIR: path.join(dir, "backups"),
    UPLOAD_DIR: path.join(dir, "uploads"),
    JWT_SECRET: "test-only-showroom-migration-secret-1234567890"
  };
  try {
    const db = new Database(dbFile);
    db.exec(fs.readFileSync(path.join(root, "server/schema.sql"), "utf8"));
    db.exec("ALTER TABLE website_showroom_pianos DROP COLUMN price_cents");
    db.exec("ALTER TABLE website_showroom_pianos DROP COLUMN sale_price_cents");
    db.prepare("INSERT INTO website_showroom_pianos(id,slug_en,slug_hu,brand,model,title_en,title_hu,image_url,is_sample) VALUES(?,?,?,?,?,?,?,?,0)")
      .run("legacy-showroom-piano", "legacy-fazioli", "regi-fazioli", "Fazioli", "F212", "Fazioli F212", "Fazioli F212", "/uploads/website/legacy.jpg");
    db.close();

    const run = () => spawnSync(process.execPath, [path.join(root, "server/init-db.js")], { cwd: root, env, encoding: "utf8", timeout: 30000 });
    const first = run();
    assert.equal(first.status, 0, first.stdout + "\n" + first.stderr);
    assert.match(first.stdout, /Verified pre-migration backup created/);

    const current = new Database(dbFile, { readonly: true });
    const migrated = current.prepare("SELECT id,brand,model,price_cents,sale_price_cents FROM website_showroom_pianos WHERE id=?").get("legacy-showroom-piano");
    assert.ok(migrated);
    assert.equal(migrated.brand, "Fazioli");
    assert.equal(migrated.model, "F212");
    assert.equal(migrated.price_cents, null);
    assert.equal(migrated.sale_price_cents, null);
    current.close();

    const backupPaths = fs.readdirSync(dir).filter(name => name.startsWith("showroom-pricing-pre-migration-") && name.endsWith(".sqlite"));
    assert.equal(backupPaths.length, 1);
    const backup = new Database(path.join(dir, backupPaths[0]), { readonly: true });
    assert.equal(backup.pragma("integrity_check", { simple: true }), "ok");
    const previousColumns = new Set(backup.prepare("PRAGMA table_info(website_showroom_pianos)").all().map(row => row.name));
    assert.equal(previousColumns.has("price_cents"), false);
    assert.equal(previousColumns.has("sale_price_cents"), false);
    assert.equal(backup.prepare("SELECT brand FROM website_showroom_pianos WHERE id=?").get("legacy-showroom-piano")?.brand, "Fazioli");
    backup.close();

    const second = run();
    assert.equal(second.status, 0, second.stdout + "\n" + second.stderr);
    assert.equal(fs.readdirSync(dir).filter(name => name.startsWith("showroom-pricing-pre-migration-")).length, 1, "Repeated startup must not repeat the pricing backup");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
