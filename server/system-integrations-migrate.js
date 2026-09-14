"use strict";

const path = require("path");
const Database = require("better-sqlite3");
require("dotenv").config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus_v6.sqlite");
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const statements = [
  `CREATE TABLE IF NOT EXISTS system_integration_control (
    id INTEGER PRIMARY KEY CHECK(id=1),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    updated_by_user_id TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
  `INSERT OR IGNORE INTO system_integration_control(id,enabled) VALUES(1,1)`,
  `CREATE TABLE IF NOT EXISTS system_integration_settings (
    provider TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK(status IN ('DISCONNECTED','CONFIGURED','CONNECTED','ERROR')),
    public_config_json TEXT NOT NULL DEFAULT '{}',
    encrypted_secret TEXT,
    secret_hint TEXT,
    last_tested_at TEXT,
    last_success_at TEXT,
    last_connection_at TEXT,
    last_error TEXT,
    requires_restart INTEGER NOT NULL DEFAULT 0 CHECK(requires_restart IN (0,1)),
    updated_by_user_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS system_integration_backups (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_by_user_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS system_integration_delete_tokens (
    token_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    requested_by_user_id TEXT NOT NULL,
    record_counts_json TEXT NOT NULL DEFAULT '{}',
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS system_integration_oauth_states (
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_system_integration_status ON system_integration_settings(status,provider)`,
  `CREATE INDEX IF NOT EXISTS idx_system_integration_backup_provider ON system_integration_backups(provider,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_system_integration_delete_expiry ON system_integration_delete_tokens(expires_at)`
];

const migrate = db.transaction(() => statements.forEach((sql) => db.prepare(sql).run()));
migrate();
console.log("System Activation & Integrations schema ready");
db.close();
