"use strict";

const PAYMENT_METHODS = Object.freeze([
  "Credit Card",
  "Bank Transfer / ACH",
  "Zelle",
  "Check",
  "Payment Link",
  "PayPal",
  "Cash"
]);

const PAYMENT_METHOD_SET = new Set(PAYMENT_METHODS);

function normalizePaymentMethod(value, { allowEmpty = true } = {}) {
  const normalized = String(value ?? "").replace(/[\u0000\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return allowEmpty ? null : "";
  const exact = PAYMENT_METHODS.find((method) => method.toLowerCase() === normalized.toLowerCase());
  return exact || null;
}

function isPaymentMethod(value) {
  return PAYMENT_METHOD_SET.has(String(value ?? ""));
}

module.exports = { PAYMENT_METHODS, PAYMENT_METHOD_SET, normalizePaymentMethod, isPaymentMethod };
