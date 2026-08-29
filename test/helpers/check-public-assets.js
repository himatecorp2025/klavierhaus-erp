"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const websiteRoot = path.join(projectRoot, "website");
const required = [
  "public/brand/klavierhaus-round-white.png",
  "public/media/klavierhaus-hero.jpg",
  "public/media/klavierhaus-salon.jpg",
  "public/media/klavierhaus-craft.jpg",
  "public/media/klavierhaus-artist-salon.png"
];

for (const relativePath of required) {
  const absolutePath = path.join(websiteRoot, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`PUBLIC_ASSET_MISSING:${relativePath}`);
  if (fs.statSync(absolutePath).size > 350_000) throw new Error(`PUBLIC_ASSET_TOO_LARGE:${relativePath}`);
}

const source = fs.readFileSync(path.join(websiteRoot, "server", "site-content.js"), "utf8");
if (source.includes("klavierhaus-artists-salon.jpg")) throw new Error("STALE_ARTIST_ASSET_REFERENCE");
console.log(`public asset smoke check passed (${required.length} files)`);
