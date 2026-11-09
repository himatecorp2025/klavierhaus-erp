"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("disconnected HIMATE export and superseded workflow entrypoints are removed", () => {
  for (const file of [
    "server/himate-connector/index.js",
    "server/himate-connector/collectors.js",
    "server/himate-connector/protocol.js",
    "server/himate-connector/registry.js",
    "server/workflow-v2.js",
    "server/workflow-v2-routes.js",
    "server/workflow-v2-schema.sql",
    "server/business-operations.js"
  ]) assert.equal(fs.existsSync(path.join(root, file)), false, file);

  const server = read("server/index.js");
  const website = read("website/server/index.js");
  const env = read(".env.example");
  const readme = read("README.md");

  assert.doesNotMatch(server, /himate.connector|createHimateExportAdapter|registerWorkflowV2|registerBusinessOperationsRoutes/i);
  assert.doesNotMatch(env, /HIMATE_CONNECTOR_/);
  assert.doesNotMatch(readme, /HIMATE START-22|HIMATE_CONNECTOR_/);
  assert.match(server, /registerRound2WorkflowRoutes/);
  assert.match(server, /registerRound3FinanceRoutes/);
  assert.match(server, /createGoogleCalendarIntegration/);
  assert.match(server, /registerSystemIntegrationRoutes/);
  assert.match(website, /renderShowroomCollection/);
});
