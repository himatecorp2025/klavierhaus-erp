"use strict";

document.documentElement.classList.remove("no-js");
document.documentElement.classList.add("js");

let publishedDesignSettings = null;
async function applyPublishedDesignSettings() {
  try {
    const response = await fetch("/api/site/design-settings", { cache: "no-store" });
    if (!response.ok) { startHeatmapTracking(); return; }
    const settings = await response.json();
    publishedDesignSettings = settings;
    const root = document.documentElement;
    const variables = { black: "--black", ivory: "--ivory", cream: "--ivory-soft", gold: "--gold", gold_bright: "--gold-bright", muted: "--ivory-muted", line: "--line" };
    Object.entries(variables).forEach(([key, variable]) => { if (/^#[0-9a-f]{6}$/i.test(String(settings[key] || ""))) root.style.setProperty(variable, settings[key]); });
    if (settings.display) root.style.setProperty("--display", settings.display);
    if (settings.sans) root.style.setProperty("--sans", settings.sans);
    if (settings.logo_url && /^(?:https?:\/\/|\/)\S+$/i.test(settings.logo_url)) document.querySelectorAll(".brand-logo").forEach(image => { image.src = settings.logo_url; });
    if (settings.favicon_url && /^(?:https?:\/\/|\/)\S+$/i.test(settings.favicon_url)) document.querySelectorAll('link[rel~="icon"]').forEach(link => { link.href = settings.favicon_url; });
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
  const stabilizeHeight = () => {
    requestAnimationFrame(() => {
      const height = Math.max(0, ...cards.map((card) => Math.ceil(card.scrollHeight || card.getBoundingClientRect().height || 0)));
      if (height) carousel.style.setProperty("--review-slide-height", `${height}px`);
    });
  };
  const renderDots = () => {
    if (!dots) return;
    dots.innerHTML = cards.map((_, index) => `<button type="button" aria-label="${index + 1}" aria-current="${index === activeIndex ? "true" : "false"}"></button>`).join("");
    [...dots.children].forEach((dot, index) => dot.addEventListener("click", () => show(index)));
  };
  const show = (index) => {
    activeIndex = (index + cards.length) % cards.length;
    track.style.transform = `translateX(-${activeIndex * 100}%)`;
    renderDots();
  };
  cards.forEach((card) => card.querySelectorAll("img").forEach((image) => { if (!image.complete) image.addEventListener("load", stabilizeHeight, { once: true }); }));
  window.addEventListener("resize", stabilizeHeight, { passive: true });
  carousel.querySelector("[data-review-previous]")?.addEventListener("click", () => show(activeIndex - 1));
  carousel.querySelector("[data-review-next]")?.addEventListener("click", () => show(activeIndex + 1));
  stabilizeHeight();
  show(0);
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

function normalizePrivateAppointmentWallTime(value){
  const raw=String(value||"").trim();let year,month,day,hour,minute,match;
  if(language==="hu"){match=raw.match(/^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})[.]?\s+(\d{1,2}):(\d{2})$/);if(match)[,year,month,day,hour,minute]=match;}
  else{match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);if(match){month=match[1];day=match[2];year=match[3];hour=match[4];minute=match[5];const meridiem=String(match[6]||"").toUpperCase();if(meridiem){let h=Number(hour);if(h<1||h>12)return "";if(meridiem==="PM"&&h!==12)h+=12;if(meridiem==="AM"&&h===12)h=0;hour=String(h);}}}
  if(!year)return "";const y=Number(year),m=Number(month),d=Number(day),h=Number(hour),min=Number(minute),probe=new Date(Date.UTC(y,m-1,d,h,min));
  if(y<2000||m<1||m>12||d<1||d>31||h<0||h>23||min<0||min>59||min%15!==0||probe.getUTCFullYear()!==y||probe.getUTCMonth()!==m-1||probe.getUTCDate()!==d)return "";
  return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}T${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}`;
}
function privateAppointmentValues(form){
  const values=Object.fromEntries(new FormData(form).entries()),scheduled=normalizePrivateAppointmentWallTime(values.scheduled_at_display);
  if(!scheduled)throw new Error("PRIVATE_APPOINTMENT_TIME_INVALID");delete values.scheduled_at_display;values.scheduled_at=scheduled;values.language=language;values.source_path=location.pathname;return values;
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
  const form = serviceDialog.querySelector("[data-service-form]");form?.reset();
  if(form?.elements.service_id)form.elements.service_id.value=button.dataset.serviceId||"";
  const title=serviceDialog.querySelector("[data-service-title]");if(title)title.textContent=button.dataset.serviceTitle||"";
  const image=serviceDialog.querySelector("[data-service-image]");
  if(image){image.src=button.dataset.serviceImage||"";image.alt=button.dataset.serviceTitle||"Klavierhaus service";image.hidden=!button.dataset.serviceImage;}
  serviceDialog.showModal();form?.querySelector('[name="name"]')?.focus();
  recordFirstPartyEvent("private_appointment_open",{service_id:button.dataset.serviceId||"",context:"service"});
}));
serviceDialog?.addEventListener("click",(event)=>{if(event.target===serviceDialog)serviceDialog.close("cancel");});
serviceDialog?.addEventListener("close",()=>serviceDialogTrigger?.focus());
document.querySelector("[data-service-form]")?.addEventListener("submit",async(event)=>{
  event.preventDefault();const form=event.currentTarget,result=form.querySelector("[data-service-result]");let values;
  try{values=privateAppointmentValues(form);}catch(_error){if(result)result.textContent=language==="hu"?"Érvényes New York-i időpontot adjon meg a jelzett magyar formátumban.":"Enter a valid New York appointment time in the shown US format.";return;}
  if(result)result.textContent=language==="hu"?"Rögzítés…":"Saving…";
  try{
    const response=await fetch("/api/site/private-appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(values)});
    if(!response.ok)throw new Error("PRIVATE_APPOINTMENT_FAILED");
    if(result)result.textContent=language==="hu"?"Köszönjük. Az időpontkérést megkaptuk, a Klavierhaus jóváhagyása után válik véglegessé.":"Thank you. We received your appointment request. It becomes final only after Klavierhaus approval.";
    recordFirstPartyEvent("private_appointment_submit",{service_id:values.service_id||"",context:"service"});
    form.reset();window.setTimeout(()=>{if(serviceDialog?.open)serviceDialog.close("success");},850);
  }catch(_error){if(result)result.textContent=language==="hu"?"Az időpontkérés küldése nem sikerült. Kérjük, próbálja újra.":"We could not send the appointment request. Please try again.";}
});

const privateViewingDialog=document.querySelector("[data-private-viewing-dialog]");
let privateViewingTrigger=null;
document.querySelectorAll("[data-private-viewing-open]").forEach((button)=>button.addEventListener("click",()=>{
  if(!privateViewingDialog)return;privateViewingTrigger=button;
  const form=privateViewingDialog.querySelector("[data-private-viewing-form]");form?.reset();
  if(form?.elements.piano_id)form.elements.piano_id.value=button.dataset.pianoId||"";
  if(form?.elements.service_id)form.elements.service_id.value=button.dataset.serviceId||"";
  const context=privateViewingDialog.querySelector("[data-private-viewing-context]");
  if(context)context.textContent=button.dataset.contextTitle||[button.dataset.pianoBrand,button.dataset.pianoModel].filter(Boolean).join(" ");
  privateViewingDialog.showModal();form?.querySelector('[name="name"]')?.focus();
  recordFirstPartyEvent("private_appointment_open",{piano_id:button.dataset.pianoId||"",service_id:button.dataset.serviceId||"",context:button.dataset.pianoId?"piano":button.dataset.serviceId?"service":"general"});
}));
privateViewingDialog?.addEventListener("click",(event)=>{if(event.target===privateViewingDialog)privateViewingDialog.close("cancel");});
privateViewingDialog?.addEventListener("close",()=>privateViewingTrigger?.focus());
privateViewingDialog?.querySelector("[data-private-viewing-form]")?.addEventListener("submit",async(event)=>{
  event.preventDefault();const form=event.currentTarget,result=form.querySelector("[data-private-viewing-result]");let values;
  try{values=privateAppointmentValues(form);}catch(_error){if(result)result.textContent=language==="hu"?"Érvényes New York-i időpontot adjon meg a jelzett magyar formátumban.":"Enter a valid New York appointment time in the shown US format.";return;}
  if(result)result.textContent=language==="hu"?"Rögzítés…":"Saving…";
  try{
    const response=await fetch("/api/site/private-appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(values)});
    if(!response.ok)throw new Error("PRIVATE_APPOINTMENT_FAILED");
    if(result)result.textContent=language==="hu"?"Köszönjük. Az időpontkérést megkaptuk, a Klavierhaus jóváhagyása után válik véglegessé.":"Thank you. We received your appointment request. It becomes final only after Klavierhaus approval.";
    recordFirstPartyEvent("private_appointment_submit",{piano_id:values.piano_id||"",service_id:values.service_id||""});
    form.reset();window.setTimeout(()=>{if(privateViewingDialog?.open)privateViewingDialog.close("success");},850);
  }catch(_error){if(result)result.textContent=language==="hu"?"Az időpontkérés küldése nem sikerült.":"We could not send the appointment request.";}
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

// The public customer chat uses a local-storage token for anonymous continuity.
// No message body is sent to analytics; the ERP stores only a token hash.
const customerChat = document.querySelector("[data-customer-chat]");
const customerChatToggle = customerChat?.querySelector("[data-chat-toggle]");
const customerChatPanel = customerChat?.querySelector("[data-chat-panel]");
const customerChatForm = customerChat?.querySelector("[data-chat-form]");
const customerChatResult = customerChat?.querySelector("[data-chat-result]");
const customerChatLookupForm = customerChat?.querySelector("[data-chat-lookup-form]");
const customerChatLookupResult = customerChat?.querySelector("[data-chat-lookup-result]");
const customerChatMessages = customerChat?.querySelector("[data-chat-messages]");
const customerChatWelcome = customerChat?.querySelector("[data-chat-welcome]");
const customerChatSupportStatus = customerChat?.querySelector("[data-chat-support-status]");
const customerChatFileList = customerChat?.querySelector("[data-chat-file-list]");
const customerChatComposer = customerChat?.querySelector("[data-chat-composer]");
const customerChatRecording = customerChat?.querySelector("[data-chat-recording]");
const customerChatMessageInput = customerChat?.querySelector("#customer-chat-message");
const customerChatPhotoInput = customerChat?.querySelector("[data-chat-photo-input]");
const customerConversationKey = "klavierhaus_customer_conversation_v1";
const customerChatEmojis = ["😀","😊","🙏","👍","❤️","🎹","🎵","✨","📷","🔧","✅","👋","🙂","😄","🤝","💬"];
let customerConversationToken = "";
let customerChatPollTimer = null;
let customerConversationSnapshot = "";
let customerChatPendingFiles = [];
let customerChatRecorder = null;
let customerChatRecorderStream = null;
let customerChatRecorderTimer = null;
function customerChatMobileMode(){return Boolean(window.matchMedia&&window.matchMedia("(max-width:600px)").matches);}
function syncCustomerChatViewport(){
  const viewport=window.visualViewport,height=Math.max(320,Math.round(viewport?.height||window.innerHeight||document.documentElement.clientHeight||0)),top=Math.max(0,Math.round(viewport?.offsetTop||0));
  document.documentElement.style.setProperty("--kh-chat-visual-height",height+"px");
  document.documentElement.style.setProperty("--kh-chat-visual-top",top+"px");
  if(customerChatPanel&&!customerChatPanel.hidden&&customerChatMobileMode()){
    const messages=customerChatMessages;
    if(messages&&document.activeElement===customerChatMessageInput)requestAnimationFrame(()=>{messages.scrollTop=messages.scrollHeight;});
  }
}
syncCustomerChatViewport();
window.visualViewport?.addEventListener("resize",syncCustomerChatViewport,{passive:true});
window.visualViewport?.addEventListener("scroll",syncCustomerChatViewport,{passive:true});
window.addEventListener("orientationchange",()=>setTimeout(syncCustomerChatViewport,80),{passive:true});

function customerPianoAvatar(){
  const span=document.createElement("span");span.className="customer-chat__message-avatar";span.setAttribute("aria-hidden","true");
  span.innerHTML='<svg viewBox="0 0 64 64"><path d="M13 28c10-14 27-17 39-10-3 7-10 12-21 15v13M31 33H18l-6 11h35M18 44v8M43 44v8M33 20l-5 10"/></svg>';
  return span;
}
function customerChatTime(value){
  try{return new Intl.DateTimeFormat(language==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit"}).format(new Date(value));}
  catch(_error){return "";}
}
function applyCustomerChatMode(active){
  if(!customerChat||!customerChatForm)return;
  const isActive=Boolean(active);
  customerChat.classList.toggle("is-active",isActive);
  customerChatForm.dataset.chatMode=isActive?"active":"new";
  const intake=customerChatForm.querySelector("[data-chat-intake-fields]");
  if(intake){intake.hidden=isActive;intake.querySelectorAll("input,select,button").forEach(control=>{control.disabled=isActive;});}
  if(customerChatComposer)customerChatComposer.hidden=!isActive;
  if(customerChatLookupForm)customerChatLookupForm.hidden=isActive;
  if(isActive&&!customerChatMobileMode())window.setTimeout(()=>customerChatMessageInput?.focus({preventScroll:true}),60);
}
function setCustomerChatPanel(open){
  if(!customerChatToggle||!customerChatPanel)return;
  const isOpen=Boolean(open);
  customerChatToggle.setAttribute("aria-expanded",String(isOpen));customerChatPanel.hidden=!isOpen;
  document.documentElement.classList.toggle("customer-chat-open",isOpen&&customerChatMobileMode());
  if(isOpen){
    customerChatWelcome?.classList.add("is-dismissed");syncCustomerChatViewport();
    requestAnimationFrame(()=>{if(customerChatMessages)customerChatMessages.scrollTop=customerChatMessages.scrollHeight;});
  }else{
    customerChatMessageInput?.blur();document.documentElement.classList.remove("customer-chat-open");
  }
}
function clearCustomerConversationSession(){
  customerConversationToken="";customerConversationSnapshot="";
  try{localStorage.removeItem(customerConversationKey);}catch(_error){}
  customerChatPendingFiles=[];renderCustomerChatFiles();applyCustomerChatMode(false);
}
function showCustomerConversationClosed(conversation=null){
  clearCustomerConversationSession();
  if(customerChatResult){
    customerChatResult.textContent=conversation?.closure_note==="CUSTOMER_INACTIVITY"
      ?(language==="hu"?"A beszélgetés 5 perc inaktivitás után lezárult. A folytatáshoz adja meg újra a nevét, e-mail-címét és ugyanazt az ügyet.":"The conversation closed after 5 minutes of inactivity. To continue it, enter your name, email address, and the same topic again.")
      :(language==="hu"?"A beszélgetés lezárult. A folytatáshoz adja meg újra a nevét, e-mail-címét és ugyanazt az ügyet.":"The conversation is closed. To continue it, enter your name, email address, and the same topic again.");
  }
}
function appendCustomerAttachment(parent,attachment){
  const url=attachment.url||"#",mime=String(attachment.mime_type||"").toLowerCase(),name=attachment.original_name||attachment.stored_name||"Attachment";
  if(mime.startsWith("image/")){
    const link=document.createElement("a");link.className="customer-chat__media customer-chat__media--image";link.href=url;link.target="_blank";link.rel="noopener";
    const image=document.createElement("img");image.src=url;image.alt=name;image.loading="lazy";link.append(image);parent.append(link);return;
  }
  if(mime.startsWith("video/")){
    const video=document.createElement("video");video.className="customer-chat__media customer-chat__media--video";video.src=url;video.controls=true;video.playsInline=true;video.preload="metadata";parent.append(video);return;
  }
  if(mime.startsWith("audio/")){
    const audio=document.createElement("audio");audio.className="customer-chat__media customer-chat__media--audio";audio.src=url;audio.controls=true;audio.preload="metadata";parent.append(audio);return;
  }
  const link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener";link.textContent="↳ "+name;parent.append(link);
}
function renderCustomerMessages(messages = [], conversation = null) {
  if (!customerChatMessages) return;
  customerChatMessages.replaceChildren();
  if (conversation?.status === "CLOSED") {
    const status = document.createElement("p");status.className="customer-chat__status customer-chat__status--closed";
    status.textContent = language === "hu" ? "Ez a beszélgetés lezárult. Új üzenettel ugyanitt folytatható." : "This conversation is closed. You can continue here by sending a new message.";
    customerChatMessages.append(status);
  }
  messages.forEach((message) => {
    const staff=message.direction==="STAFF",row=document.createElement("div");
    row.className=`customer-chat__message-row customer-chat__message-row--${staff?"staff":"customer"}`;
    if(staff)row.append(customerPianoAvatar());
    const item=document.createElement("article");item.className=`customer-chat__message customer-chat__message--${staff?"staff":"customer"}`;
    if(message.body){const body=document.createElement("p");body.textContent=message.body;item.append(body);}
    (message.attachments||[]).forEach(attachment=>appendCustomerAttachment(item,attachment));
    const meta=document.createElement("small");meta.className="customer-chat__message-time";meta.textContent=customerChatTime(message.created_at)+(staff?"":"  ✓✓");item.append(meta);
    row.append(item);customerChatMessages.append(row);
  });
  (conversation?.appointment_proposals || []).slice(-4).forEach(proposal=>{
    const card=document.createElement("article"),scheduled=Boolean(proposal.private_appointment_id),proposed=proposal.status==="PROPOSED",declined=proposal.status==="DECLINED";
    card.className=`customer-chat__proposal ${scheduled?"is-scheduled":declined?"is-declined":proposed?"is-proposed":"is-resolved"}`;
    const start=new Date(proposal.starts_at),end=new Date(proposal.ends_at),formatter=new Intl.DateTimeFormat(language==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}),endFormatter=new Intl.DateTimeFormat(language==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",timeStyle:"short"});
    const title=document.createElement("strong");title.textContent=language==="hu"?"Időpontjavaslat":"Appointment proposal";const when=document.createElement("p");when.textContent=`${formatter.format(start)} – ${endFormatter.format(end)} ET`;card.append(title,when);
    const status=document.createElement("small");status.className="customer-chat__proposal-status";status.textContent=scheduled?(language==="hu"?"✓ Elfogadva · bekerült a naptárba":"✓ Accepted · added to calendar"):declined?(language==="hu"?"Másik időpontot kért":"Another time requested"):proposed?(language==="hu"?"Válaszra vár":"Waiting for your response"):proposal.status;card.append(status);
    if(proposed){const actions=document.createElement("div");actions.className="customer-chat__proposal-actions";const accept=document.createElement("button");accept.type="button";accept.className="button button--primary";accept.dataset.proposalDecision="ACCEPTED";accept.dataset.proposalId=proposal.id;accept.textContent=language==="hu"?"Elfogadom":"Accept";const decline=document.createElement("button");decline.type="button";decline.className="button button--ghost";decline.dataset.proposalDecision="DECLINED";decline.dataset.proposalId=proposal.id;decline.textContent=language==="hu"?"Más időpontot kérek":"Request another time";actions.append(accept,decline);card.append(actions);}
    customerChatMessages.append(card);
  });
  customerChatMessages.scrollTop=customerChatMessages.scrollHeight;
}
function renderCustomerChatFiles(){
  if(!customerChatFileList)return;customerChatFileList.replaceChildren();
  customerChatPendingFiles.forEach((file,index)=>{
    const chip=document.createElement("span");chip.className="customer-chat__file-chip";
    const text=document.createElement("span");text.textContent=`${file.name} · ${Math.max(1,Math.round(file.size/1024))} KB`;
    const remove=document.createElement("button");remove.type="button";remove.dataset.chatRemoveFile=String(index);remove.setAttribute("aria-label",language==="hu"?"Csatolmány eltávolítása":"Remove attachment");remove.textContent="×";
    chip.append(text,remove);customerChatFileList.append(chip);
  });
}
function addCustomerChatFiles(files){
  const next=[...customerChatPendingFiles,...files].slice(0,10);customerChatPendingFiles=next;renderCustomerChatFiles();
}
function renderSupportStatus(status){
  if(!customerChatSupportStatus)return;
  const open=Boolean(status?.open);customerChatSupportStatus.classList.toggle("is-live",open);
  customerChatSupportStatus.textContent=open
    ? (language==="hu"?"● Online · Élő ügyfélszolgálat elérhető":"● Online · Live customer service available")
    : (language==="hu"?"○ Offline · üzenetét megkapjuk és a következő ügyfélszolgálati időben válaszolunk.":"○ Offline · leave a message and we will reply during the next support window.");
}
async function loadSupportStatus(){
  try{const response=await fetch("/api/site/support-status",{credentials:"same-origin",cache:"no-store"});renderSupportStatus(await response.json());}
  catch(_error){renderSupportStatus({open:false});}
}
async function loadCustomerConversation(token) {
  if (!token) return;
  try {
    const response=await fetch(`/api/site/customer-conversations/${encodeURIComponent(token)}`,{credentials:"same-origin",cache:"no-store"});
    if(!response.ok)throw new Error("CONVERSATION_NOT_FOUND");
    const conversation=await response.json();customerConversationToken=token;
    const nextSnapshot=JSON.stringify([conversation.status,conversation.updated_at,conversation.messages?.length||0,(conversation.appointment_proposals||[]).map(item=>item.id+":"+item.status+":"+(item.private_appointment_id||"")).join(",")]);
    renderSupportStatus(conversation.support||{});
    if(conversation.status==="CLOSED"){renderCustomerMessages(conversation.messages||[],conversation);showCustomerConversationClosed(conversation);customerConversationSnapshot=nextSnapshot;return;}
    applyCustomerChatMode(true);renderCustomerMessages(conversation.messages||[],conversation);
    if(nextSnapshot!==customerConversationSnapshot&&customerChatResult)customerChatResult.textContent="";
    customerConversationSnapshot=nextSnapshot;
  }catch(_error){
    if(!new URLSearchParams(location.search).get("conversation"))localStorage.removeItem(customerConversationKey);
    customerConversationToken="";applyCustomerChatMode(false);
  }
}
function setCustomerChatLookupMessage(text,isError=false){
  if(!customerChatLookupResult)return;customerChatLookupResult.replaceChildren();const message=document.createElement("span");message.textContent=text;customerChatLookupResult.append(message);customerChatLookupResult.classList.toggle("is-error",isError);
}
function validateCustomerChatFiles(files){
  if(files.length>10)throw new Error("CUSTOMER_ATTACHMENT_COUNT");
  const allowed=/\.(?:jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp|mp4|mov|m4v|webm|3gp|mp3|m4a|aac|wav|ogg|oga|pdf|docx?)$/i;
  files.forEach(file=>{if(file.size>50*1024*1024||!allowed.test(file.name||""))throw new Error("CUSTOMER_ATTACHMENT_INVALID");});
}
function chatMediaExtension(mime,kind){
  if(kind==="video")return mime.includes("mp4")?".mp4":".webm";
  if(mime.includes("mp4"))return ".m4a";if(mime.includes("ogg"))return ".ogg";return ".webm";
}
function stopCustomerRecorder(){
  if(customerChatRecorder&&customerChatRecorder.state!=="inactive")customerChatRecorder.stop();
}
async function startCustomerRecorder(kind){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){if(customerChatResult)customerChatResult.textContent=language==="hu"?"A böngésző nem támogatja ezt a rögzítési módot.":"This browser does not support recording.";return;}
  if(customerChatRecorder){stopCustomerRecorder();return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia(kind==="video"?{video:{facingMode:{ideal:"environment"}},audio:true}:{audio:true});
    customerChatRecorderStream=stream;const chunks=[],recorder=new MediaRecorder(stream);customerChatRecorder=recorder;
    const started=Date.now(),maxMs=kind==="video"?60000:300000;
    if(customerChatRecording){
      customerChatRecording.hidden=false;customerChatRecording.replaceChildren();
      const preview=kind==="video"?document.createElement("video"):null;if(preview){preview.autoplay=true;preview.muted=true;preview.playsInline=true;preview.srcObject=stream;customerChatRecording.append(preview);}
      const info=document.createElement("div"),timer=document.createElement("strong"),stop=document.createElement("button");info.className="customer-chat__recording-info";stop.type="button";stop.className="customer-chat__recording-stop";stop.textContent=language==="hu"?"■ Leállítás":"■ Stop";info.append(timer,stop);customerChatRecording.append(info);stop.addEventListener("click",stopCustomerRecorder);
      const tick=()=>{const elapsed=Math.min(maxMs,Date.now()-started),seconds=Math.floor(elapsed/1000);timer.textContent=(kind==="video"?(language==="hu"?"Videó":"Video"):(language==="hu"?"Hangüzenet":"Voice message"))+` · 0:${String(seconds).padStart(2,"0")}${kind==="video"?" / 1:00":""}`;};tick();customerChatRecorderTimer=window.setInterval(tick,250);
    }
    recorder.addEventListener("dataavailable",event=>{if(event.data?.size)chunks.push(event.data);});
    recorder.addEventListener("stop",()=>{
      clearInterval(customerChatRecorderTimer);customerChatRecorderTimer=null;
      stream.getTracks().forEach(track=>track.stop());
      const mime=recorder.mimeType||(kind==="video"?"video/webm":"audio/webm"),blob=new Blob(chunks,{type:mime});
      if(blob.size){const stamp=new Date().toISOString().replace(/[:.]/g,"-"),file=new File([blob],`klavierhaus-${kind}-${stamp}${chatMediaExtension(mime,kind)}`,{type:mime,lastModified:Date.now()});addCustomerChatFiles([file]);}
      customerChatRecorder=null;customerChatRecorderStream=null;if(customerChatRecording){customerChatRecording.hidden=true;customerChatRecording.replaceChildren();}
    },{once:true});
    recorder.start(250);window.setTimeout(()=>{if(customerChatRecorder===recorder&&recorder.state!=="inactive")recorder.stop();},maxMs);
  }catch(_error){if(customerChatResult)customerChatResult.textContent=language==="hu"?"A kamera vagy mikrofon nem érhető el. Ellenőrizze a böngésző engedélyeit.":"Camera or microphone access is unavailable. Check your browser permissions.";}
}
function buildEmojiPicker(){
  const picker=customerChat?.querySelector("[data-chat-emoji-picker]");if(!picker)return;picker.replaceChildren();
  customerChatEmojis.forEach(emoji=>{const button=document.createElement("button");button.type="button";button.textContent=emoji;button.addEventListener("click",()=>{if(!customerChatMessageInput)return;const start=customerChatMessageInput.selectionStart??customerChatMessageInput.value.length,end=customerChatMessageInput.selectionEnd??start;customerChatMessageInput.setRangeText(emoji,start,end,"end");customerChatMessageInput.focus();picker.hidden=true;});picker.append(button);});
}
async function submitCustomerChat(){
  const data=new FormData(customerChatForm),active=Boolean(customerConversationToken),message=String(data.get("message")||"").trim(),files=[...customerChatPendingFiles];
  if(!active){
    if(!customerChatForm.reportValidity())return;
  }else if(!message&&!files.length)return;
  try{validateCustomerChatFiles(files);}catch(error){if(customerChatResult)customerChatResult.textContent=error.message==="CUSTOMER_ATTACHMENT_COUNT"?(language==="hu"?"Legfeljebb 10 csatolmány küldhető.":"You can send up to 10 attachments."):(language==="hu"?"A csatolmány formátuma vagy mérete nem engedélyezett.":"The attachment type or size is not allowed.");return;}
  if(customerChatResult)customerChatResult.textContent=language==="hu"?"Küldés…":"Sending…";
  try{
    const endpoint=active?`/api/site/customer-conversations/${encodeURIComponent(customerConversationToken)}/messages`:"/api/site/customer-conversations";
    const payload=new FormData();payload.set("message",message);files.forEach(file=>payload.append("attachments",file,file.name));
    if(!active){payload.set("name",String(data.get("name")||""));payload.set("email",String(data.get("email")||""));payload.set("category",String(data.get("category")||"SERVICE"));payload.set("consent_contact",data.get("consent_contact")==="on"?"true":"false");payload.set("language",language);payload.set("source_path",location.pathname);}
    const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",body:payload}),result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"CONVERSATION_FAILED");
    if(result.access_token){customerConversationToken=result.access_token;localStorage.setItem(customerConversationKey,customerConversationToken);}
    const conversation=result.conversation||result;customerConversationSnapshot="";customerChatPendingFiles=[];renderCustomerChatFiles();
    if(customerChatMessageInput)customerChatMessageInput.value="";
    applyCustomerChatMode(Boolean(customerConversationToken));renderCustomerMessages(conversation.messages||[],conversation);renderSupportStatus(conversation.support||{});
    if(customerChatResult)customerChatResult.textContent="";
  }catch(error){
    if(error.message==="CONVERSATION_REAUTH_REQUIRED"){
      showCustomerConversationClosed({closure_note:"CUSTOMER_INACTIVITY"});return;
    }
    if(customerChatResult)customerChatResult.textContent=error.message==="CONVERSATION_IDENTITY_REQUIRED"?(language==="hu"?"A beszélgetés indításához név, érvényes e-mail-cím és témakör szükséges.":"Name, a valid email address and topic are required to start the conversation."):(language==="hu"?"A küldés nem sikerült.":"We could not send your message.");
  }
}

if(customerChat&&customerChatToggle&&customerChatPanel&&customerChatForm){
  customerChatToggle.addEventListener("click",()=>{const open=customerChatToggle.getAttribute("aria-expanded")==="true";setCustomerChatPanel(!open);});
  customerChat?.querySelector("[data-chat-panel-close]")?.addEventListener("click",()=>setCustomerChatPanel(false));
  customerChat?.querySelector("[data-chat-welcome-close]")?.addEventListener("click",()=>customerChatWelcome?.classList.add("is-dismissed"));
  window.setTimeout(()=>customerChatWelcome?.classList.add("is-dismissed"),9000);
  try{customerConversationToken=localStorage.getItem(customerConversationKey)||new URLSearchParams(location.search).get("conversation")||"";}catch(_error){customerConversationToken="";}
  loadSupportStatus();applyCustomerChatMode(Boolean(customerConversationToken));loadCustomerConversation(customerConversationToken);buildEmojiPicker();
  customerChatPhotoInput?.addEventListener("change",event=>{addCustomerChatFiles([...(event.currentTarget.files||[])]);event.currentTarget.value="";});
  customerChatFileList?.addEventListener("click",event=>{const button=event.target.closest("[data-chat-remove-file]");if(!button)return;customerChatPendingFiles.splice(Number(button.dataset.chatRemoveFile),1);renderCustomerChatFiles();});
  customerChat?.querySelector("[data-chat-camera]")?.addEventListener("click",()=>startCustomerRecorder("video"));
  customerChat?.querySelector("[data-chat-voice]")?.addEventListener("click",()=>startCustomerRecorder("audio"));
  customerChat?.querySelector("[data-chat-emoji]")?.addEventListener("click",()=>{const picker=customerChat.querySelector("[data-chat-emoji-picker]");if(picker)picker.hidden=!picker.hidden;});
  customerChatMessageInput?.addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){event.preventDefault();void submitCustomerChat();}});
  customerChatMessages?.addEventListener("click",async event=>{
    const button=event.target.closest("[data-proposal-decision]");if(!button||!customerConversationToken)return;button.disabled=true;
    try{const response=await fetch(`/api/site/customer-conversations/${encodeURIComponent(customerConversationToken)}/appointment-proposals/${encodeURIComponent(button.dataset.proposalId)}/respond`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision:button.dataset.proposalDecision})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"APPOINTMENT_RESPONSE_FAILED");customerConversationSnapshot="";renderCustomerMessages(result.messages||[],result);if(customerChatResult)customerChatResult.textContent=button.dataset.proposalDecision==="ACCEPTED"?(language==="hu"?"Az időpontot elfogadta; a foglalás automatikusan bekerült a naptárba.":"Appointment accepted and automatically confirmed in the calendar."):(language==="hu"?"Jeleztük, hogy másik időpontot kér.":"We have let the team know you need another time.");}
    catch(_error){button.disabled=false;if(customerChatResult)customerChatResult.textContent=language==="hu"?"Az időpontválasz nem sikerült.":"We could not save your appointment response.";}
  });
  customerChatPollTimer=window.setInterval(()=>{if(customerConversationToken)loadCustomerConversation(customerConversationToken);},2000);
  customerChatForm.addEventListener("submit",event=>{event.preventDefault();void submitCustomerChat();});
  customerChatLookupForm?.addEventListener("submit",async event=>{
    event.preventDefault();const email=String(new FormData(customerChatLookupForm).get("lookup_email")||"").trim();setCustomerChatLookupMessage(language==="hu"?"Keresés…":"Searching…");
    try{const response=await fetch("/api/site/customer-conversations/lookup",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"LOOKUP_FAILED");setCustomerChatLookupMessage(language==="hu"?"Ha ehhez az e-mail-címhez tartozik korábbi beszélgetés, a hozzáférés kizárólag a korábban kapott biztonságos beszélgetési linken keresztül lehetséges.":"If previous conversations exist for this email address, access is available only through the secure conversation link previously provided.");}
    catch(_error){setCustomerChatLookupMessage(language==="hu"?"A keresés nem sikerült.":"We could not find the conversations.",true);}
  });
}

