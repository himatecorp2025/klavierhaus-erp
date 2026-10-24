"use strict";

// Browser CORS permissions do not replace JWT authorization or route validation.
const TRUSTED_ORIGINS = Object.freeze([
  "https://klavierhaus.com",
  "https://www.klavierhaus.com",
  "https://admin.klavierhaus.com",
  "https://klavierhaus-home.onrender.com",
  "https://klavierhaus-erp.onrender.com"
]);

function canonicalOrigin(value, allowLocalHttp = false) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.username || url.password || url.search || url.hash) return "";
    if (url.protocol !== "https:") {
      if (!allowLocalHttp || url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "";
    }
    return url.origin;
  } catch (_error) {
    return "";
  }
}

function allowedCorsOrigins(env = process.env) {
  const allowed = new Set(TRUSTED_ORIGINS);
  const development = String(env.NODE_ENV || "development").toLowerCase() !== "production";
  if (development) {
    for (const origin of ["http://localhost:3030", "http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3030"]) allowed.add(origin);
  }
  const configured = [
    env.APP_BASE_URL,
    env.WEBSITE_BASE_URL,
    ...String(env.CORS_ALLOWED_ORIGINS || "").split(",")
  ];
  for (const value of configured) {
    const origin = canonicalOrigin(value, development);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

function createCorsOptions(env = process.env) {
  const allowed = allowedCorsOrigins(env);
  return {
    origin(origin, callback) {
      callback(null, Boolean(origin && allowed.has(origin)));
    },
    optionsSuccessStatus: 204
  };
}

module.exports = { TRUSTED_ORIGINS, canonicalOrigin, allowedCorsOrigins, createCorsOptions };
