"use strict";

const key = String(process.env.SYSTEM_INTEGRATION_ENCRYPTION_KEY || "").trim();
if (String(process.env.NODE_ENV || "").toLowerCase() === "production" && key.length < 32) {
  throw new Error("SYSTEM_INTEGRATION_ENCRYPTION_KEY is required in production and must be at least 32 characters long");
}
if (key.length >= 32 && !String(process.env.MARKETING_TOKEN_ENCRYPTION_KEY || "").trim()) {
  process.env.MARKETING_TOKEN_ENCRYPTION_KEY = key;
}
