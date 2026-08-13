"use strict";

const DEFAULT_TIMEOUT_MS = 4000;

function normalizeApiBaseUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    if (!/^https?:$/.test(url.protocol)) return "";
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_error) {
    return "";
  }
}

function createEventClient(options = {}) {
  const baseUrl = normalizeApiBaseUrl(options.baseUrl);
  const timeoutMs = Math.max(500, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  async function request(pathname, requestOptions = {}) {
    if (!baseUrl || typeof fetchImpl !== "function") {
      const error = new Error("Event API is not configured.");
      error.code = "EVENT_API_NOT_CONFIGURED";
      throw error;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${pathname}`, {
        ...requestOptions,
        headers: {
          Accept: "application/json",
          ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
          ...(requestOptions.headers || {})
        },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `Event API request failed (${response.status}).`);
        error.status = response.status;
        error.code = payload.error || payload.code || "EVENT_API_ERROR";
        error.payload = payload;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    configured: Boolean(baseUrl),
    list(language) {
      return request(`/api/public/events?lang=${language === "hu" ? "hu" : "en"}`);
    },
    detail(slug, language) {
      return request(`/api/public/events/${encodeURIComponent(slug)}?lang=${language === "hu" ? "hu" : "en"}`);
    },
    createCheckout(slug, language, quantity) {
      return request(`/api/public/events/${encodeURIComponent(slug)}/checkout`, {
        method: "POST",
        body: JSON.stringify({ language: language === "hu" ? "hu" : "en", quantity })
      });
    },
    reserve(slug, language, reservation) {
      return request(`/api/public/events/${encodeURIComponent(slug)}/reservations`, {
        method: "POST",
        body: JSON.stringify({
          language: language === "hu" ? "hu" : "en",
          attendee_name: reservation.attendeeName,
          contact_email: reservation.contactEmail,
          quantity: reservation.quantity
        })
      });
    },
    invitation(token, language) {
      return request(`/api/public/event-invitations/${encodeURIComponent(token)}?lang=${language === "hu" ? "hu" : "en"}`);
    },
    respondToInvitation(token, decision) {
      return request(`/api/public/event-invitations/${encodeURIComponent(token)}/respond`, {
        method: "POST",
        body: JSON.stringify({ decision })
      });
    }
  });
}

module.exports = {
  createEventClient,
  normalizeApiBaseUrl
};
