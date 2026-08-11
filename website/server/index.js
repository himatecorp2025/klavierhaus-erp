"use strict";

const path = require("path");
const express = require("express");
const compression = require("compression");
const { getContent } = require("./site-content");

require("dotenv").config();

const VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://klavierhaus.onrender.com";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(String(value || DEFAULT_BASE_URL));
    if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported protocol");
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_error) {
    return DEFAULT_BASE_URL;
  }
}

function pageUrl(baseUrl, route) {
  return `${baseUrl}${route === "/" ? "/" : route}`;
}

function renderDocument({ language, baseUrl, allowIndexing, notFound = false }) {
  const copy = getContent(language);
  const englishUrl = pageUrl(baseUrl, "/");
  const hungarianUrl = pageUrl(baseUrl, "/hu/");
  const canonicalUrl = pageUrl(baseUrl, copy.route);
  const robots = allowIndexing ? "index, follow" : "noindex, nofollow, noarchive";
  const pageTitle = notFound ? `${copy.notFoundTitle} | Klavierhaus` : copy.title;
  const pageDescription = notFound ? copy.notFoundBody : copy.description;

  const mainContent = notFound
    ? `<section class="not-found" aria-labelledby="not-found-title">
        <p class="eyebrow">404</p>
        <h1 id="not-found-title">${escapeHtml(copy.notFoundTitle)}</h1>
        <p>${escapeHtml(copy.notFoundBody)}</p>
        <a class="text-link" href="${escapeHtml(copy.route)}">${escapeHtml(copy.homeLabel)}</a>
      </section>`
    : `<section class="hero" aria-labelledby="hero-title">
        <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
        <h1 id="hero-title">${escapeHtml(copy.heading)}</h1>
        <p class="introduction">${escapeHtml(copy.introduction)}</p>
      </section>
      <section class="foundation-card" aria-labelledby="foundation-title">
        <p class="card-label">${escapeHtml(copy.foundationLabel)}</p>
        <h2 id="foundation-title">${escapeHtml(copy.statusTitle)}</h2>
        <p>${escapeHtml(copy.statusBody)}</p>
      </section>`;

  return `<!doctype html>
<html lang="${escapeHtml(copy.htmlLang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#f4efe5">
  <meta name="robots" content="${robots}">
  <meta name="description" content="${escapeHtml(pageDescription)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="alternate" hreflang="en-US" href="${escapeHtml(englishUrl)}">
  <link rel="alternate" hreflang="hu-HU" href="${escapeHtml(hungarianUrl)}">
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(englishUrl)}">
  <link rel="stylesheet" href="/assets/styles.css">
  <script src="/assets/app.js" defer></script>
  <title>${escapeHtml(pageTitle)}</title>
</head>
<body>
  <div class="page-shell">
    <header class="site-header">
      <a class="wordmark" href="${escapeHtml(copy.route)}" aria-label="${escapeHtml(copy.brandAriaLabel)}">KLAVIERHAUS</a>
      <a class="language-link" href="${escapeHtml(copy.alternateRoute)}" hreflang="${language === "hu" ? "en-US" : "hu-HU"}">${escapeHtml(copy.alternateLabel)}</a>
    </header>
    <main>${mainContent}</main>
    <footer class="site-footer">
      <span>${escapeHtml(copy.footer)}</span>
      <span>© <span data-current-year></span></span>
    </footer>
  </div>
</body>
</html>`;
}

function createApp(options = {}) {
  const app = express();
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.WEBSITE_BASE_URL);
  const allowIndexing = options.allowIndexing ?? String(process.env.WEBSITE_ALLOW_INDEXING || "false").toLowerCase() === "true";

  app.disable("x-powered-by");
  app.enable("strict routing");
  app.use(compression());
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'");
    if (!allowIndexing) res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    next();
  });

  app.use("/assets", express.static(path.join(__dirname, "..", "public"), {
    fallthrough: false,
    maxAge: "1h",
    etag: true
  }));

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "klavierhaus-public-website",
      version: VERSION,
      indexing: allowIndexing ? "enabled" : "disabled"
    });
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain");
    res.send(allowIndexing
      ? "User-agent: *\nAllow: /\n"
      : "User-agent: *\nDisallow: /\n");
  });

  app.get("/", (_req, res) => {
    res.type("html").send(renderDocument({ language: "en", baseUrl, allowIndexing }));
  });
  app.get("/hu", (_req, res) => res.redirect(308, "/hu/"));
  app.get("/hu/", (_req, res) => {
    res.type("html").send(renderDocument({ language: "hu", baseUrl, allowIndexing }));
  });

  app.use((req, res) => {
    const language = req.path === "/hu" || req.path.startsWith("/hu/") ? "hu" : "en";
    res.status(404).type("html").send(renderDocument({ language, baseUrl, allowIndexing, notFound: true }));
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 10000);
  createApp().listen(port, "0.0.0.0", () => {
    console.log(`[website] Klavierhaus public website listening on port ${port}`);
  });
}

module.exports = { createApp, normalizeBaseUrl, renderDocument };
