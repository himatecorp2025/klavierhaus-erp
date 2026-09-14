"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const schemaPath = path.join(__dirname, "..", "..", "server", "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf8");
if (/\\nCREATE TABLE IF NOT EXISTS system_integration/.test(schema)) throw new Error("SCHEMA_CONTAINS_LITERAL_ESCAPED_NEWLINES");
const required = ["system_integration_secrets","system_integration_health","system_integration_backups","system_integration_delete_tokens","system_integration_test_tokens"];
let validated = false;
try {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  try { db.pragma("foreign_keys = ON"); db.exec(schema); for (const table of required) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`MISSING_SCHEMA_TABLE:${table}`); validated = true; } finally { db.close(); }
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
  const script = `import sqlite3,sys\ns=open(sys.argv[1],encoding='utf8').read()\nc=sqlite3.connect(':memory:')\nc.executescript(s)\nt={r[0] for r in c.execute("select name from sqlite_master where type='table'")}\nr=${JSON.stringify(required)}\nmissing=[x for x in r if x not in t]\nassert not missing, missing\n`;
  const run = spawnSync("python3", ["-c", script, schemaPath], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`SCHEMA_SQLITE_VALIDATION_FAILED:${run.stderr || run.stdout}`);
  validated = true;
}
if (!validated) throw new Error("SCHEMA_NOT_VALIDATED");
console.log("Schema validation passed");
