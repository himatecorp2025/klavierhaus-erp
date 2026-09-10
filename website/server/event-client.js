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
      const isMultipart = typeof FormData !== "undefined" && requestOptions.body instanceof FormData;
      const response = await fetchImpl(`${baseUrl}${pathname}`, {
        ...requestOptions,
        headers: {
          Accept: "application/json",
          ...(requestOptions.body && !isMultipart ? { "Content-Type": "application/json" } : {}),
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

  async function requestBinary(pathname) {
    if (!baseUrl || typeof fetchImpl !== "function") {
      const error = new Error("Event API is not configured."); error.code = "EVENT_API_NOT_CONFIGURED"; throw error;
    }
    const response = await fetchImpl(`${baseUrl}${pathname}`, { headers: { Accept: "application/octet-stream, application/pdf" } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || `Event API request failed (${response.status}).`); error.status = response.status; error.code = payload.error || "EVENT_API_ERROR"; throw error;
    }
    return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "application/octet-stream", contentDisposition: response.headers.get("content-disposition") || "" };
  }

  return Object.freeze({
    configured: Boolean(baseUrl),
    list(language) {
      return request(`/api/public/events?lang=${language === "hu" ? "hu" : "en"}`);
    },
    detail(slug, language) {
      return request(`/api/public/events/${encodeURIComponent(slug)}?lang=${language === "hu" ? "hu" : "en"}`);
    },
    content(pageKey, language) {
      return request(`/api/public/website-content/${encodeURIComponent(pageKey)}?lang=${language === "hu" ? "hu" : "en"}`);
    },
    pageSettings() {
      return request("/api/public/website-page-settings");
    },
    designSettings() {
      return request("/api/public/website-design-settings");
    },
    reviews(language) {
      return request(`/api/public/website-reviews?lang=${language === "hu" ? "hu" : "en"}`);
    },
    showroomPianos(language) {
      return request(`/api/public/showroom-pianos?lang=${language === "hu" ? "hu" : "en"}`);
    },
    showroomPiano(slug, language) {
      return request(`/api/public/showroom-pianos/${encodeURIComponent(slug)}?lang=${language === "hu" ? "hu" : "en"}`);
    },
    services(language) {
      return request(`/api/public/website-services?lang=${language === "hu" ? "hu" : "en"}`);
    },
    artists(language) {
      return request(`/api/public/website-artists?lang=${language === "hu" ? "hu" : "en"}`);
    },
    artist(slug, language) {
      return request(`/api/public/website-artists/${encodeURIComponent(slug)}?lang=${language === "hu" ? "hu" : "en"}`);
    },
    preview(token) {
      return request(`/api/public/website-preview/${encodeURIComponent(token)}`);
    },
    deviceToken() {
      return request("/api/public/device-token");
    },
    trackingConfig() {
      return request("/api/public/tracking-config");
    },
    seoConfig() {
      return request("/api/public/website-seo");
    },
    track(event) {
      return request("/api/public/tracking-events", { method: "POST", body: JSON.stringify(event) });
    },
    createCustomerConversation(conversation, files = []) {
      if (!files.length) return request("/api/public/customer-conversations", { method: "POST", body: JSON.stringify(conversation) });
      const form = new FormData();
      Object.entries(conversation || {}).forEach(([key, value]) => { if (value !== undefined && value !== null) form.append(key, typeof value === "boolean" ? String(value) : String(value)); });
      files.forEach((file) => form.append("attachments", new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" }), file.originalname || "attachment"));
      return request("/api/public/customer-conversations", { method: "POST", body: form });
    },
    customerConversation(token) {
      return request(`/api/public/customer-conversations/${encodeURIComponent(token)}`);
    },
    lookupCustomerConversations(email) {
      return request("/api/public/customer-conversations/lookup", { method: "POST", body: JSON.stringify({ email }) });
    },
    customerConversationMessage(token, message, files = []) {
      if (!files.length) return request(`/api/public/customer-conversations/${encodeURIComponent(token)}/messages`, { method: "POST", body: JSON.stringify(message) });
      const form = new FormData();
      Object.entries(message || {}).forEach(([key, value]) => { if (value !== undefined && value !== null) form.append(key, typeof value === "boolean" ? String(value) : String(value)); });
      files.forEach((file) => form.append("attachments", new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" }), file.originalname || "attachment"));
      return request(`/api/public/customer-conversations/${encodeURIComponent(token)}/messages`, { method: "POST", body: form });
    },
    customerConversationAttachment(token, attachmentId) {
      return requestBinary(`/api/public/customer-conversations/${encodeURIComponent(token)}/attachments/${encodeURIComponent(attachmentId)}`);
    },
    createLead(lead) {
      return request("/api/public/contact-leads", { method: "POST", body: JSON.stringify(lead) });
    },
    repeatInterest(eventId, value) {
      return request(`/api/public/events/${encodeURIComponent(eventId)}/repeat-interest`, { method: "POST", body: JSON.stringify(value) });
    },
    service(slug, language) {
      return request(`/api/public/website-services/${encodeURIComponent(slug)}?lang=${language === "hu" ? "hu" : "en"}`);
    },
    createCheckout(slug, language, quantity, attendeeNames) {
      return request(`/api/public/events/${encodeURIComponent(slug)}/checkout`, {
        method: "POST",
        body: JSON.stringify({ language: language === "hu" ? "hu" : "en", quantity, attendee_names: attendeeNames })
      });
    },
    reserve(slug, language, reservation) {
      return request(`/api/public/events/${encodeURIComponent(slug)}/reservations`, {
        method: "POST",
        body: JSON.stringify({
          language: language === "hu" ? "hu" : "en",
          attendee_names: reservation.attendeeNames,
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
