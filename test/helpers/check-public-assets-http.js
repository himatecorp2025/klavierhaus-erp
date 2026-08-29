"use strict";

const assert = require("node:assert/strict");
const { createApp } = require("../../website/server");

const routes = [
  "/", "/hu/", "/events", "/hu/esemenyek", "/artists", "/hu/muveszek",
  "/pianos", "/hu/zongorak", "/services", "/hu/szolgaltatasok"
];

async function main() {
  const app = createApp({ baseUrl: "http://127.0.0.1", eventApiBaseUrl: "" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const assetPaths = new Set();
  try {
    for (const route of routes) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 200, `PUBLIC_ROUTE_NOT_OK:${route}`);
      const html = await response.text();
      for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)(?:\?[^\"]*)?"/g)) assetPaths.add(match[1]);
    }
    for (const assetPath of assetPaths) {
      const response = await fetch(`${origin}${assetPath}`);
      assert.equal(response.status, 200, `PUBLIC_ASSET_NOT_OK:${assetPath}`);
    }
    console.log(`public HTTP asset smoke check passed (${routes.length} routes, ${assetPaths.size} assets)`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
