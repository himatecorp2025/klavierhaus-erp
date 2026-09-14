"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");
const integrations = require("../server/system-integrations");

const schema = fs.readFileSync(path.join(__dirname, "..", "server", "schema.sql"), "utf8");
function legacyEncrypt(value, secret) {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${payload.toString("base64url")}`;
}
function setup() {
  const db = new Database(":memory:"); db.pragma("foreign_keys = ON"); db.exec(schema);
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,is_superadmin) VALUES('SA','Owner','owner@example.com','x','ADMIN','Active',1),('AD','Admin','admin@example.com','x','ADMIN','Active',0)").run();
  db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES('system_integrations_enabled','1','SYSTEM')").run();
  for (const permission of Object.values(integrations.PROVIDER_PERMISSIONS)) db.prepare("INSERT INTO role_permissions(role,permission,enabled,updated_by) VALUES('ADMIN',?,1,'SYSTEM')").run(permission);
  return db;
}
for (let pass = 1; pass <= 3; pass += 1) {
  test(`round4 functional pass ${pass}: dedicated encryption and legacy migration`, () => {
    const db = setup(); const env = { SYSTEM_INTEGRATION_ENCRYPTION_KEY: "new-dedicated-integration-key-1234567890", JWT_SECRET: "legacy-jwt-secret-12345678901234567890" };
    const legacy = legacyEncrypt("ga-secret", env.JWT_SECRET);
    db.prepare("INSERT INTO website_integration_settings(provider,status,public_config_json,encrypted_secret) VALUES('GA4','CONFIGURED','{\"measurement_id\":\"G-ABCD1234\"}',?)").run(legacy);
    const migrated = integrations.migrateLegacyIntegrationSecrets(db, env); assert.equal(migrated.skipped, false);
    const row = db.prepare("SELECT encrypted_secret FROM system_integration_secrets WHERE provider='GA4'").get();
    assert.ok(row.encrypted_secret); assert.doesNotMatch(row.encrypted_secret, /ga-secret/);
    assert.equal(integrations._test.secretBundle(db, "GA4", env).api_secret, "ga-secret"); db.close();
  });
  test(`round4 functional pass ${pass}: provider enable, granular permissions and unified save`, () => {
    const db = setup(); const env = { SYSTEM_INTEGRATION_ENCRYPTION_KEY: "new-dedicated-integration-key-1234567890" };
    assert.equal(integrations._test.permissionAllowed(db, { id:"AD", role:"ADMIN", is_superadmin:0 }, "system_integrations.edit"), true);
    db.prepare("UPDATE role_permissions SET enabled=0 WHERE role='ADMIN' AND permission='system_integrations.edit'").run();
    assert.equal(integrations._test.permissionAllowed(db, { id:"AD", role:"ADMIN", is_superadmin:0 }, "system_integrations.edit"), false);
    integrations.saveIntegrationProvider(db, "RESEND", { config:{ from_email:"Klavierhaus <test@example.com>" }, secrets:{ api_key:"re_test_123" } }, {id:"SA"}, env);
    const row = integrations.getIntegrationProvider(db, "RESEND", env); assert.equal(row.config.from_email, "Klavierhaus <test@example.com>"); assert.equal(row.has_secret, true);
    db.prepare("UPDATE system_integration_health SET enabled=0 WHERE provider='RESEND'").run(); assert.equal(integrations._test.providerEnabled(db,"RESEND"), false); db.close();
  });
  test(`round4 functional pass ${pass}: external backup is durable and checksummed`, () => {
    const db = setup(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-int-backup-")); const env = { BACKUP_DIR:dir };
    const backup = integrations._test.createExternalBackup(db, "GA4", { secret:{ encrypted_secret:"ciphertext" } }, "SA", env);
    assert.ok(fs.existsSync(backup.file)); const data = fs.readFileSync(backup.file); assert.equal(crypto.createHash("sha256").update(data).digest("hex"), backup.sha);
    assert.equal(db.prepare("SELECT backup_file_path FROM system_integration_backups WHERE id=?").get(backup.id).backup_file_path, backup.file); db.close(); fs.rmSync(dir,{recursive:true,force:true});
  });
}
