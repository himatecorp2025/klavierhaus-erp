"use strict";

document.documentElement.classList.remove("no-js");
document.documentElement.classList.add("js");

async function applyPublishedDesignSettings() {
  try {
    const response = await fetch("/api/site/design-settings", { cache: "no-store" });
    if (!response.ok) { startHeatmapTracking(); return; }
    const settings = await response.json();
    const root = document.documentElement;
    const variables = { black: "--black", ivory: "--ivory", cream: "--ivory-soft", gold: "--gold", gold_bright: "--gold-bright", muted: "--ivory-muted", line: "--line" };
    Object.entries(variables).forEach(([key, variable]) => { if (/^#[0-9a-f]{6}$/i.test(String(settings[key] || ""))) root.style.setProperty(variable, settings[key]); });
    if (settings.display) root.style.setProperty("--display", settings.display);
    if (settings.sans) root.style.setProperty("--sans", settings.sans);
    if (settings.logo_url && /^(?:https?:\/\/|\/)\S+$/i.test(settings.logo_url)) document.querySelectorAll(".brand-logo").forEach(image => { image.src = settings.logo_url; });
  } catch (_error) { /* design settings are optional and must not block rendering */ }
}
applyPublishedDesignSettings();

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

const header = document.querySelector("[data-site-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const navigationPanel = document.querySelector("[data-navigation-panel]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setMenuState(open) {
  if (!menuToggle || !navigationPanel) return;
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? menuToggle.dataset.closeLabel : menuToggle.dataset.openLabel);
  document.body.classList.toggle("menu-open", open);
  navigationPanel.classList.toggle("is-open", open);
}

if (menuToggle && navigationPanel) {
  menuToggle.addEventListener("click", () => {
    setMenuState(menuToggle.getAttribute("aria-expanded") !== "true");
  });

  navigationPanel.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setMenuState(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
      setMenuState(false);
      menuToggle.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 1081px)").matches) setMenuState(false);
  }, { passive: true });
}

let scrollQueued = false;
let previousScrollY = window.scrollY;
function updateHeader() {
  const currentScrollY = window.scrollY;
  if (header) {
    header.classList.toggle("is-scrolled", currentScrollY > 24);
    const menuOpen = menuToggle?.getAttribute("aria-expanded") === "true";
    const scrollingDown = currentScrollY > previousScrollY + 7;
    const scrollingUp = currentScrollY < previousScrollY - 7;
    if (currentScrollY < 72 || scrollingUp || menuOpen) header.classList.remove("is-hidden");
    else if (scrollingDown && currentScrollY > header.offsetHeight + 24) header.classList.add("is-hidden");
  }
  previousScrollY = currentScrollY;
  scrollQueued = false;
}

window.addEventListener("scroll", () => {
  if (!scrollQueued) {
    scrollQueued = true;
    window.requestAnimationFrame(updateHeader);
  }
}, { passive: true });
updateHeader();

document.querySelectorAll("[data-event-carousel]").forEach((carousel) => {
  const track = carousel.querySelector(".public-event-grid--home");
  const controls = carousel.parentElement?.querySelector(".event-carousel__controls");
  if (!track || !controls) return;
  const move = (direction) => {
    track.scrollBy({ left: direction * Math.max(280, track.clientWidth * 0.82), behavior: reducedMotion ? "auto" : "smooth" });
  };
  controls.querySelector("[data-event-carousel-previous]")?.addEventListener("click", () => move(-1));
  controls.querySelector("[data-event-carousel-next]")?.addEventListener("click", () => move(1));
});

document.querySelectorAll("[data-ticket-quantity]").forEach((control) => {
  const input = control.querySelector('input[name="quantity"]');
  const output = control.querySelector("[data-ticket-total]");
  const attendeeContainer = control.closest("form")?.querySelector("[data-attendee-names]");
  if (!input) return;
  const syncAttendeeNames = () => {
    if (!attendeeContainer) return;
    const count = Number(input.value || 1);
    const previousValues = [...attendeeContainer.querySelectorAll('input[name="attendee_names"]')].map((field) => field.value);
    const labelText = attendeeContainer.dataset.attendeeLabel || "Guest";
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const label = document.createElement("label");
      const title = document.createElement("span");
      const field = document.createElement("input");
      title.textContent = `${labelText} ${index + 1}`;
      field.name = "attendee_names";
      field.type = "text";
      field.maxLength = 200;
      field.autocomplete = index === 0 ? "name" : "off";
      field.required = true;
      field.value = previousValues[index] || "";
      label.append(title, field);
      fragment.append(label);
    }
    attendeeContainer.replaceChildren(attendeeContainer.querySelector("legend"), fragment);
  };
  const clamp = (value) => Math.max(Number(input.min || 1), Math.min(Number(input.max || Number.MAX_SAFE_INTEGER), Math.trunc(Number(value) || 1)));
  const update = (value) => {
    input.value = String(clamp(value));
    if (output) {
      const amount = Number(control.dataset.unitPrice || 0) * Number(input.value);
      const formatted = new Intl.NumberFormat(control.dataset.locale || "en-US", { style: "currency", currency: control.dataset.currency || "USD" }).format(amount / 100);
      const label = output.querySelector("small")?.textContent || "";
      output.innerHTML = `<small>${label}</small> ${formatted}`;
    }
    syncAttendeeNames();
  };
  control.querySelector("[data-quantity-minus]")?.addEventListener("click", () => update(Number(input.value) - 1));
  control.querySelector("[data-quantity-plus]")?.addEventListener("click", () => update(Number(input.value) + 1));
  input.addEventListener("change", () => update(input.value));
  update(input.value);
});

document.querySelectorAll("[data-review-carousel]").forEach((carousel) => {
  const track = carousel.querySelector(".review-track");
  const cards = [...carousel.querySelectorAll("[data-review-card]")];
  const dots = carousel.querySelector("[data-review-dots]");
  if (!track || !cards.length) return;
  let activeIndex = 0;
  const renderDots = () => {
    if (!dots) return;
    dots.innerHTML = cards.map((_, index) => `<button type="button" aria-label="${index + 1}" aria-current="${index === activeIndex ? "true" : "false"}"></button>`).join("");
    [...dots.children].forEach((dot, index) => dot.addEventListener("click", () => show(index)));
  };
  const show = (index) => {
    activeIndex = (index + cards.length) % cards.length;
    cards[activeIndex].scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", inline: "start", block: "nearest" });
    renderDots();
  };
  carousel.querySelector("[data-review-previous]")?.addEventListener("click", () => show(activeIndex - 1));
  carousel.querySelector("[data-review-next]")?.addEventListener("click", () => show(activeIndex + 1));
  renderDots();
});

const revealElements = document.querySelectorAll("[data-reveal]");

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealElements.forEach((element) => element.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver((entries, activeObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      activeObserver.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -8%",
    threshold: 0.08
  });

  revealElements.forEach((element) => observer.observe(element));
}

const language = document.documentElement.lang === "hu" ? "hu" : "en";
const privacyKey = "klavierhaus_privacy_v1";
const deviceKey = "klavierhaus_device_v1";
const consentBanner = document.querySelector("[data-consent-banner]");
const consentDialog = document.querySelector("[data-consent-dialog]");

function readPrivacyChoice() {
  try { return JSON.parse(localStorage.getItem(privacyKey) || "null"); } catch (_error) { return null; }
}

function loadExternalScript(source, attributes = {}) {
  if (document.querySelector(`script[data-consent-source="${source}"]`)) return;
  const script = document.createElement("script");
  script.src = source;
  script.async = true;
  script.dataset.consentSource = source;
  Object.entries(attributes).forEach(([key, value]) => script.setAttribute(key, value));
  document.head.append(script);
}

async function applyTrackingConsent(choice) {
  if (!choice?.analytics) return;
  try {
    const response = await fetch("/api/site/tracking-config", { credentials: "same-origin" });
    if (!response.ok) return;
    const config = await response.json();
    if (config.ga4_measurement_id) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", config.ga4_measurement_id, { anonymize_ip: true });
      loadExternalScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.ga4_measurement_id)}`);
    }
    if (config.clarity_project_id && choice.marketing) {
      window.clarity = window.clarity || function clarity() { (window.clarity.q = window.clarity.q || []).push(arguments); };
      loadExternalScript(`https://www.clarity.ms/tag/${encodeURIComponent(config.clarity_project_id)}`);
    }
  } catch (_error) {
    // Measurement is optional and must never block the public experience.
  }
  startHeatmapTracking();
}

function savePrivacyChoice(choice) {
  const value = { essential: true, analytics: Boolean(choice.analytics), marketing: Boolean(choice.marketing), saved_at: new Date().toISOString() };
  localStorage.setItem(privacyKey, JSON.stringify(value));
  if (consentBanner) consentBanner.hidden = true;
  applyTrackingConsent(value);
}

const initialPrivacyChoice = readPrivacyChoice();
if (consentBanner) consentBanner.hidden = Boolean(initialPrivacyChoice);
if (initialPrivacyChoice) applyTrackingConsent(initialPrivacyChoice);
document.querySelector("[data-consent-essential]")?.addEventListener("click", () => savePrivacyChoice({ analytics: false, marketing: false }));
document.querySelector("[data-consent-all]")?.addEventListener("click", () => savePrivacyChoice({ analytics: true, marketing: true }));
document.querySelectorAll("[data-consent-settings], [data-privacy-settings]").forEach((button) => button.addEventListener("click", () => {
  const current = readPrivacyChoice();
  if (consentDialog) {
    consentDialog.querySelector("[data-consent-analytics]").checked = Boolean(current?.analytics);
    consentDialog.querySelector("[data-consent-marketing]").checked = Boolean(current?.marketing);
    consentDialog.showModal();
  }
}));
document.querySelector("[data-consent-save]")?.addEventListener("click", (event) => {
  event.preventDefault();
  savePrivacyChoice({
    analytics: consentDialog?.querySelector("[data-consent-analytics]")?.checked,
    marketing: consentDialog?.querySelector("[data-consent-marketing]")?.checked
  });
  consentDialog?.close();
});

async function getDeviceToken() {
  const stored = localStorage.getItem(deviceKey);
  if (stored) return stored;
  const response = await fetch("/api/site/device-token", { credentials: "same-origin" });
  if (!response.ok) throw new Error("DEVICE_TOKEN_FAILED");
  const payload = await response.json();
  localStorage.setItem(deviceKey, payload.device_token);
  return payload.device_token;
}

async function recordFirstPartyEvent(eventName, metadata = {}) {
  const choice = readPrivacyChoice();
  if (!choice?.analytics) return;
  try {
    await fetch("/api/site/track", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name: eventName, metadata, source_path: location.pathname, language, device_token: await getDeviceToken(), analytics_consent: true, marketing_consent: Boolean(choice.marketing) })
    });
  } catch (_error) { /* Optional analytics must fail silently. */ }
}

let heatmapTrackingStarted = false;
let heatmapFlushTimer = null;
let heatmapStartedAt = 0;
let heatmapLastCell = "";
let heatmapMaxScroll = 0;
let heatmapPointerSamples = 0;
let heatmapClicks = 0;
const heatmapCells = new Map();
function heatmapCellForEvent(event) {
  const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const pageHeight = Math.max(window.innerHeight || 1, document.documentElement.scrollHeight || 1);
  return { x: Math.min(23, Math.max(0, Math.floor((event.clientX / width) * 24))), y: Math.min(31, Math.max(0, Math.floor(((event.clientY + window.scrollY) / pageHeight) * 32))) };
}
function recordHeatmapCell(event, type = "move") {
  const cell = heatmapCellForEvent(event);
  const key = `${cell.x}:${cell.y}`;
  const value = heatmapCells.get(key) || { move: 0, click: 0 };
  value[type] = Math.min(1000, value[type] + 1);
  heatmapCells.set(key, value);
  return cell;
}
async function flushHeatmap(keepalive = false) {
  const choice = readPrivacyChoice();
  if (!choice?.analytics || !heatmapCells.size) return;
  const cells = Object.fromEntries([...heatmapCells.entries()].slice(0, 500));
  const exitCell = heatmapLastCell.split(":");
  const metadata = { grid_columns: 24, grid_rows: 32, cells, exit_cell: exitCell.length === 2 ? { x: Number(exitCell[0]), y: Number(exitCell[1]) } : null, pointer_samples: heatmapPointerSamples, clicks: heatmapClicks, max_scroll_ratio: heatmapMaxScroll, duration_ms: Math.min(86400000, Math.max(0, Date.now() - heatmapStartedAt)), viewport_width: Math.min(10000, window.innerWidth || 0), viewport_height: Math.min(10000, window.innerHeight || 0) };
  heatmapCells.clear();heatmapPointerSamples = 0;heatmapClicks = 0;
  try { await fetch("/api/site/track", { method: "POST", keepalive, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_name: "heatmap_batch", metadata, source_path: location.pathname, language, device_token: await getDeviceToken(), analytics_consent: true, marketing_consent: Boolean(choice.marketing) }) }); } catch (_error) { /* Optional heatmap measurement must fail silently. */ }
}
function startHeatmapTracking() {
  if (heatmapTrackingStarted || !readPrivacyChoice()?.analytics) return;
  heatmapTrackingStarted = true;heatmapStartedAt = Date.now();
  const onPointerMove = (event) => { if (event.pointerType === "touch") return;const cell = heatmapCellForEvent(event);const key = `${cell.x}:${cell.y}`;if (key === heatmapLastCell) return;heatmapLastCell = key;recordHeatmapCell(event);heatmapPointerSamples += 1; };
  const onClick = (event) => { recordHeatmapCell(event, "click");heatmapClicks += 1; };
  const onScroll = () => { const maximum = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);heatmapMaxScroll = Math.max(heatmapMaxScroll, Math.min(1, window.scrollY / maximum)); };
  document.addEventListener("pointermove", onPointerMove, { passive: true });document.addEventListener("click", onClick, { passive: true });window.addEventListener("scroll", onScroll, { passive: true });
  heatmapFlushTimer = window.setInterval(() => flushHeatmap(false), 15000);
  window.addEventListener("pagehide", () => flushHeatmap(true), { once: true });document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushHeatmap(true); });getDeviceToken().catch(() => {});
}

const serviceDialog = document.querySelector("[data-service-dialog]");
let serviceDialogTrigger = null;
document.querySelectorAll(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog")?.close("cancel")));
document.querySelectorAll("[data-service-card]").forEach((card) => {
  const open = () => card.querySelector("[data-service-request]")?.click();
  card.addEventListener("click", (event) => { if (!event.target.closest("a,button")) open(); });
  card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
});
document.querySelectorAll("[data-service-request]").forEach((button) => button.addEventListener("click", () => {
  if (!serviceDialog) return;
  serviceDialogTrigger = button;
  const form = serviceDialog.querySelector("[data-service-form]");
  form?.reset();
  serviceDialog.querySelector('[name="service_id"]').value = button.dataset.serviceId || "";
  serviceDialog.querySelector("[data-service-title]").textContent = button.dataset.serviceTitle || "";
  const image = serviceDialog.querySelector("[data-service-image]");
  if (image) { image.src = button.dataset.serviceImage || ""; image.alt = button.dataset.serviceTitle || "Klavierhaus service"; image.hidden = !button.dataset.serviceImage; }
  const concertService = /concert|koncert/i.test(button.dataset.serviceTitle || "");
  serviceDialog.querySelectorAll("[data-concert-field]").forEach((field) => {
    field.hidden = !concertService;
    field.querySelectorAll("input, textarea, select").forEach((control) => { control.required = concertService; });
  });
  const message = form?.elements.message;
  if (message) message.value = language === "hu" ? `A(z) ${button.dataset.serviceTitle || "kiválasztott"} szolgáltatás iránt érdeklődöm.` : `I would like to enquire about the ${button.dataset.serviceTitle || "selected"} service.`;
  serviceDialog.showModal();
  serviceDialog.querySelector('input[name="name"]')?.focus();
  recordFirstPartyEvent("service_enquiry_open", { service_id: button.dataset.serviceId || "" });
}));
serviceDialog?.addEventListener("click", (event) => {
  if (event.target === serviceDialog) serviceDialog.close("cancel");
});
serviceDialog?.addEventListener("close", () => serviceDialogTrigger?.focus());
document.querySelector("[data-service-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = form.querySelector("[data-service-result]");
  const values = Object.fromEntries(new FormData(form).entries());
  values.consent_contact = form.elements.consent_contact.checked;
  values.consent_marketing = form.elements.consent_marketing.checked;
  values.language = language;
  values.source_path = location.pathname;
  if (result) result.textContent = language === "hu" ? "Küldés…" : "Sending…";
  try {
    const response = await fetch("/api/site/contact-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!response.ok) throw new Error("LEAD_FAILED");
    if (result) result.textContent = language === "hu" ? "Köszönjük. Hamarosan személyesen jelentkezünk." : "Thank you. We will contact you personally shortly.";
    recordFirstPartyEvent("service_enquiry_submit", { service_id: values.service_id || "" });
    form.reset();
    window.setTimeout(() => { if (serviceDialog?.open) serviceDialog.close("success"); }, 850);
  } catch (_error) {
    if (result) result.textContent = language === "hu" ? "A küldés nem sikerült. Kérjük, próbálja újra." : "We could not send your request. Please try again.";
  }
});

const privateViewingDialog = document.querySelector("[data-private-viewing-dialog]");
let privateViewingTrigger = null;
document.querySelectorAll("[data-private-viewing-open]").forEach((button) => button.addEventListener("click", () => {
  if (!privateViewingDialog) return;
  privateViewingTrigger = button;
  const form = privateViewingDialog.querySelector("[data-private-viewing-form]");
  if (form) {
    form.reset();
    form.elements.piano_brand.value = button.dataset.pianoBrand || "";
    form.elements.piano_model.value = button.dataset.pianoModel || "";
    form.elements.service_id.value = button.dataset.serviceId || "";
  }
  const context = privateViewingDialog.querySelector("[data-private-viewing-context]");
  if (context) context.textContent = button.dataset.pianoModel ? `${button.dataset.pianoBrand || ""} ${button.dataset.pianoModel}`.trim() : "";
  privateViewingDialog.showModal();
  form?.querySelector('[name="name"]')?.focus();
}));
privateViewingDialog?.addEventListener("click", (event) => { if (event.target === privateViewingDialog) privateViewingDialog.close("cancel"); });
privateViewingDialog?.addEventListener("close", () => privateViewingTrigger?.focus());
privateViewingDialog?.querySelector("[data-private-viewing-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = form.querySelector("[data-private-viewing-result]");
  const values = Object.fromEntries(new FormData(form).entries());
  values.consent_contact = form.elements.consent_contact.checked;
  values.language = language;
  values.source_path = location.pathname;
  if (result) result.textContent = language === "hu" ? "Küldés…" : "Sending…";
  try {
    const response = await fetch("/api/site/contact-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!response.ok) throw new Error("LEAD_FAILED");
    if (result) result.textContent = language === "hu" ? "Köszönjük. Hamarosan jelentkezünk." : "Thank you. We will contact you shortly.";
    form.reset();
    window.setTimeout(() => { if (privateViewingDialog?.open) privateViewingDialog.close("success"); }, 850);
  } catch (_error) { if (result) result.textContent = language === "hu" ? "A küldés nem sikerült." : "We could not send your request."; }
});

const interestDialog = document.querySelector("[data-interest-dialog]");
document.querySelectorAll("[data-interest-open]").forEach((button) => button.addEventListener("click", () => {
  if (!interestDialog) return;
  interestDialog.querySelector('[name="event_id"]').value = button.dataset.eventId || "";
  interestDialog.querySelector("[data-interest-title]").textContent = button.dataset.eventTitle || "";
  interestDialog.showModal();
  recordFirstPartyEvent("event_repeat_interest_open", { event_id: button.dataset.eventId || "" });
}));
document.querySelector("[data-interest-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = form.querySelector("[data-interest-result]");
  const eventId = form.elements.event_id.value;
  if (result) result.textContent = language === "hu" ? "Rögzítés…" : "Saving…";
  try {
    const payload = {
      email: form.elements.email.value, notify_event: form.elements.notify_event.checked,
      marketing_consent: form.elements.marketing_consent.checked, language,
      source_path: location.pathname, device_token: await getDeviceToken()
    };
    const response = await fetch(`/api/site/events/${encodeURIComponent(eventId)}/repeat-interest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (response.status === 409) {
      if (result) result.textContent = language === "hu" ? "Ezt az érdeklődést már rögzítettük ezen az eszközön." : "This request is already recorded for this device.";
      return;
    }
    if (!response.ok) throw new Error("INTEREST_FAILED");
    if (result) result.textContent = language === "hu" ? "Köszönjük. Értesítjük a következő alkalomról." : "Thank you. We will notify you about the next edition.";
    recordFirstPartyEvent("event_repeat_interest_submit", { event_id: eventId });
    window.setTimeout(() => { if (interestDialog?.open) interestDialog.close("success"); }, 850);
  } catch (_error) {
    if (result) result.textContent = language === "hu" ? "A rögzítés nem sikerült. Kérjük, próbálja újra." : "We could not save your request. Please try again.";
  }
});

document.querySelectorAll("[data-track-event]").forEach((element) => element.addEventListener("click", () => recordFirstPartyEvent(element.dataset.trackEvent, { id: element.dataset.trackId || "" })));

// A removed or unavailable optional gallery image must not leave a broken tile behind.
document.querySelectorAll("[data-gallery-image]").forEach((image) => image.addEventListener("error", () => {
  const gallery = image.closest(".detail-gallery");
  image.closest("figure")?.remove();
  if (gallery && !gallery.querySelector("img")) gallery.remove();
}, { once: true }));
