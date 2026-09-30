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
    if (settings.chat_logo_url && /^(?:https?:\/\/|\/)\S+$/i.test(settings.chat_logo_url)) document.querySelectorAll("[data-chat-logo]").forEach(image => { image.src = settings.chat_logo_url; image.hidden = false; image.parentElement?.querySelector(".customer-chat__logo-fallback")?.setAttribute("hidden",""); });
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
  match=raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(match)[,year,month,day,hour,minute]=match;
  else if(language==="hu"){match=raw.match(/^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})[.]?\s+(\d{1,2}):(\d{2})$/);if(match)[,year,month,day,hour,minute]=match;}
  else{match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);if(match){month=match[1];day=match[2];year=match[3];hour=match[4];minute=match[5];const meridiem=String(match[6]||"").toUpperCase();if(meridiem){let h=Number(hour);if(h<1||h>12)return "";if(meridiem==="PM"&&h!==12)h+=12;if(meridiem==="AM"&&h===12)h=0;hour=String(h);}}}
  if(!year)return "";const y=Number(year),m=Number(month),d=Number(day),h=Number(hour),min=Number(minute),probe=new Date(Date.UTC(y,m-1,d,h,min));
  if(y<2000||m<1||m>12||d<1||d>31||h<0||h>23||min<0||min>59||min%15!==0||probe.getUTCFullYear()!==y||probe.getUTCMonth()!==m-1||probe.getUTCDate()!==d)return "";
  return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}T${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}`;
}
const privateSlotPickerState=new WeakMap();
function privateNyDateKey(date=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date).reduce((out,part)=>(out[part.type]=part.value,out),{});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function privateDateParts(dateKey){const match=String(dateKey||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?{year:Number(match[1]),month:Number(match[2]),day:Number(match[3])}:null;}
function privateDateLabel(dateKey){
  const parts=privateDateParts(dateKey);if(!parts)return language==="hu"?"Válasszon dátumot":"Choose a date";
  return new Intl.DateTimeFormat(language==="hu"?"hu-HU":"en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(parts.year,parts.month-1,parts.day,12)));
}
function privateTimeLabel(iso){
  return new Intl.DateTimeFormat(language==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit",hour12:language!=="hu"}).format(new Date(iso));
}
function privateMonthName(monthIndex){
  return new Intl.DateTimeFormat(language==="hu"?"hu-HU":"en-US",{month:"long",timeZone:"UTC"}).format(new Date(Date.UTC(2026,monthIndex,1)));
}
function privatePickerGet(picker){
  let state=privateSlotPickerState.get(picker);
  if(!state){
    const today=privateDateParts(privateNyDateKey()),month=today.month-1;
    state={selectedDate:"",selectedStart:"",viewYear:today.year,viewMonth:month,loading:false};
    privateSlotPickerState.set(picker,state);
  }
  return state;
}
function privatePickerRenderControls(picker){
  const state=privatePickerGet(picker),yearSelect=picker.querySelector("[data-private-calendar-year]"),monthSelect=picker.querySelector("[data-private-calendar-month]");
  if(!yearSelect||!monthSelect)return;
  const today=privateDateParts(privateNyDateKey()),maxYear=today.year+2;
  yearSelect.innerHTML="";for(let year=today.year;year<=maxYear;year++){const option=document.createElement("option");option.value=String(year);option.textContent=String(year);option.selected=year===state.viewYear;yearSelect.append(option);}
  monthSelect.innerHTML="";for(let month=0;month<12;month++){const option=document.createElement("option");option.value=String(month);option.textContent=privateMonthName(month);option.selected=month===state.viewMonth;monthSelect.append(option);}
}
function privatePickerRenderCalendar(picker){
  const state=privatePickerGet(picker),grid=picker.querySelector("[data-private-calendar-grid]"),weekdays=picker.querySelector("[data-private-weekdays]");
  if(!grid||!weekdays)return;
  const labels=language==="hu"?["H","K","Sze","Cs","P","Szo","V"]:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  weekdays.innerHTML=labels.map(label=>`<span>${label}</span>`).join("");
  const first=new Date(Date.UTC(state.viewYear,state.viewMonth,1)),days=new Date(Date.UTC(state.viewYear,state.viewMonth+1,0)).getUTCDate();
  let offset=first.getUTCDay();if(language==="hu")offset=(offset+6)%7;
  const today=privateNyDateKey(),cells=[];
  for(let i=0;i<offset;i++)cells.push('<span class="private-calendar-empty" aria-hidden="true"></span>');
  for(let day=1;day<=days;day++){
    const dateKey=`${state.viewYear}-${String(state.viewMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,disabled=dateKey<today,selected=dateKey===state.selectedDate;
    cells.push(`<button type="button" class="private-calendar-day${selected?" is-selected":""}" data-private-day="${dateKey}" ${disabled?"disabled":""} aria-pressed="${selected?"true":"false"}">${day}</button>`);
  }
  grid.innerHTML=cells.join("");
  grid.querySelectorAll("[data-private-day]").forEach(button=>button.addEventListener("click",()=>privatePickerSelectDate(picker,button.dataset.privateDay)));
}
async function privatePickerLoadSlots(picker,dateKey){
  const state=privatePickerGet(picker),slots=picker.querySelector("[data-private-slots]"),hint=picker.querySelector("[data-private-slot-hint]"),hidden=picker.querySelector("[data-private-scheduled-at]");
  if(!slots||!hint||!hidden)return;
  state.loading=true;state.selectedStart="";hidden.value="";
  slots.innerHTML='<span class="private-slot-loading">'+(language==="hu"?"Szabad időpontok betöltése…":"Loading available times…")+"</span>";
  hint.textContent=language==="hu"?"Elérhető kezdési időpontok · New York-i idő":"Available start times · New York time";
  try{
    const response=await fetch("/api/site/private-appointment-availability?date="+encodeURIComponent(dateKey),{cache:"no-store"});
    if(!response.ok)throw new Error("PRIVATE_APPOINTMENT_AVAILABILITY_FAILED");
    const payload=await response.json(),available=Array.isArray(payload.slots)?payload.slots:[];
    if(!available.length){slots.innerHTML='<span class="private-slot-empty">'+(language==="hu"?"Erre a napra nincs szabad időpont. Válasszon másik napot.":"No available times remain on this date. Choose another day.")+"</span>";return;}
    slots.innerHTML=available.map(slot=>`<button type="button" class="private-slot-button" data-private-slot="${slot.starts_at}">${privateTimeLabel(slot.starts_at)}</button>`).join("");
    slots.querySelectorAll("[data-private-slot]").forEach(button=>button.addEventListener("click",()=>{
      slots.querySelectorAll("[data-private-slot]").forEach(item=>item.classList.remove("is-selected"));button.classList.add("is-selected");
      state.selectedStart=button.dataset.privateSlot||"";hidden.value=state.selectedStart;
      hint.textContent=(language==="hu"?"Kiválasztott időpont: ":"Selected time: ")+privateDateLabel(dateKey)+" · "+button.textContent;
    }));
  }catch(_error){
    slots.innerHTML='<span class="private-slot-empty">'+(language==="hu"?"A szabad időpontok most nem tölthetők be. Kérjük, próbálja újra.":"Available times could not be loaded. Please try again.")+"</span>";
  }finally{state.loading=false;}
}
function privatePickerSelectDate(picker,dateKey){
  const state=privatePickerGet(picker),parts=privateDateParts(dateKey);if(!parts)return;
  state.selectedDate=dateKey;state.viewYear=parts.year;state.viewMonth=parts.month-1;
  const value=picker.querySelector("[data-private-date-value]"),popover=picker.querySelector("[data-private-calendar]"),trigger=picker.querySelector("[data-private-date-trigger]");
  if(value)value.textContent=privateDateLabel(dateKey);if(popover)popover.hidden=true;picker.classList.remove("is-open");if(trigger)trigger.setAttribute("aria-expanded","false");
  privatePickerRenderControls(picker);privatePickerRenderCalendar(picker);privatePickerLoadSlots(picker,dateKey);
}
function privatePickerReset(form){
  const picker=form?.querySelector("[data-private-slot-picker]");if(!picker)return;
  const today=privateDateParts(privateNyDateKey()),state=privatePickerGet(picker);
  state.selectedDate="";state.selectedStart="";state.viewYear=today.year;state.viewMonth=today.month-1;
  const value=picker.querySelector("[data-private-date-value]"),hidden=picker.querySelector("[data-private-scheduled-at]"),slots=picker.querySelector("[data-private-slots]"),hint=picker.querySelector("[data-private-slot-hint]"),popover=picker.querySelector("[data-private-calendar]"),trigger=picker.querySelector("[data-private-date-trigger]");
  if(value)value.textContent=language==="hu"?"Válasszon dátumot":"Choose a date";if(hidden)hidden.value="";if(slots)slots.innerHTML="";
  if(hint)hint.textContent=language==="hu"?"Válasszon dátumot, majd a rendszer csak a ténylegesen szabad kezdési időpontokat mutatja.":"Choose a date and we will show only genuinely available start times.";
  if(popover)popover.hidden=true;picker.classList.remove("is-open");if(trigger)trigger.setAttribute("aria-expanded","false");
  privatePickerRenderControls(picker);privatePickerRenderCalendar(picker);
}
function privatePickerInit(picker){
  if(!picker)return null;
  if(picker.dataset.privatePickerBound!=="1"){
    picker.dataset.privatePickerBound="1";
    const trigger=picker.querySelector("[data-private-date-trigger]"),popover=picker.querySelector("[data-private-calendar]"),year=picker.querySelector("[data-private-calendar-year]"),month=picker.querySelector("[data-private-calendar-month]");
    trigger?.addEventListener("click",event=>{
      event.preventDefault();event.stopPropagation();
      if(!popover)return;
      const opening=popover.hidden;popover.hidden=!opening;picker.classList.toggle("is-open",opening);trigger.setAttribute("aria-expanded",opening?"true":"false");
      if(opening){privatePickerRenderControls(picker);privatePickerRenderCalendar(picker);}
    });
    year?.addEventListener("change",()=>{const state=privatePickerGet(picker);state.viewYear=Number(year.value);privatePickerRenderCalendar(picker);});
    month?.addEventListener("change",()=>{const state=privatePickerGet(picker);state.viewMonth=Number(month.value);privatePickerRenderCalendar(picker);});
  }
  privatePickerRenderControls(picker);privatePickerRenderCalendar(picker);
  return picker;
}
function privatePickerEnsure(root=document){
  const pickers=[];
  if(root?.matches?.("[data-private-slot-picker]"))pickers.push(root);
  root?.querySelectorAll?.("[data-private-slot-picker]")?.forEach(picker=>pickers.push(picker));
  pickers.forEach(privatePickerInit);
  return pickers[0]||null;
}
privatePickerEnsure(document);
document.addEventListener("click",event=>{
  document.querySelectorAll("[data-private-slot-picker]").forEach(picker=>{
    if(picker.contains(event.target))return;
    const popover=picker.querySelector("[data-private-calendar]"),trigger=picker.querySelector("[data-private-date-trigger]");
    if(popover&&!popover.hidden){popover.hidden=true;picker.classList.remove("is-open");trigger?.setAttribute("aria-expanded","false");}
  });
});

function privateAppointmentValues(form){
  const values=Object.fromEntries(new FormData(form).entries()),scheduled=String(values.scheduled_at||"").trim();
  if(!scheduled)throw new Error("PRIVATE_APPOINTMENT_TIME_INVALID");
  values.duration_min=60;values.language=language;values.source_path=location.pathname;return values;
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
  const form = serviceDialog.querySelector("[data-service-form]");privatePickerEnsure(form);form?.reset();privatePickerReset(form);
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
  try{values=privateAppointmentValues(form);}catch(_error){if(result)result.textContent=language==="hu"?"Válasszon érvényes New York-i dátumot és időpontot a naptárból.":"Choose a valid New York date and time from the calendar.";return;}
  if(result)result.textContent=language==="hu"?"Rögzítés…":"Saving…";
  try{
    const response=await fetch("/api/site/private-appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(values)});
    if(response.status===409){const picker=form.querySelector("[data-private-slot-picker]"),state=picker?privatePickerGet(picker):null;if(picker&&state?.selectedDate)await privatePickerLoadSlots(picker,state.selectedDate);if(result)result.textContent=language==="hu"?"Ez az időpont időközben foglalttá vált. Válasszon a frissített szabad időpontok közül.":"That time has just become unavailable. Choose another time from the refreshed list.";return;}
    if(!response.ok)throw new Error("PRIVATE_APPOINTMENT_FAILED");
    if(result)result.textContent=language==="hu"?"Köszönjük. Az időpontkérést megkaptuk, a Klavierhaus jóváhagyása után válik véglegessé.":"Thank you. We received your appointment request. It becomes final only after Klavierhaus approval.";
    recordFirstPartyEvent("private_appointment_submit",{service_id:values.service_id||"",context:"service"});
    form.reset();privatePickerReset(form);window.setTimeout(()=>{if(serviceDialog?.open)serviceDialog.close("success");},850);
  }catch(_error){if(result)result.textContent=language==="hu"?"Az időpontkérés küldése nem sikerült. Kérjük, próbálja újra.":"We could not send the appointment request. Please try again.";}
});

const privateViewingDialog=document.querySelector("[data-private-viewing-dialog]");
let privateViewingTrigger=null;
document.querySelectorAll("[data-private-viewing-open]").forEach((button)=>button.addEventListener("click",()=>{
  if(!privateViewingDialog)return;privateViewingTrigger=button;
  const form=privateViewingDialog.querySelector("[data-private-viewing-form]");privatePickerEnsure(form);form?.reset();privatePickerReset(form);
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
  try{values=privateAppointmentValues(form);}catch(_error){if(result)result.textContent=language==="hu"?"Válasszon érvényes New York-i dátumot és időpontot a naptárból.":"Choose a valid New York date and time from the calendar.";return;}
  if(result)result.textContent=language==="hu"?"Rögzítés…":"Saving…";
  try{
    const response=await fetch("/api/site/private-appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(values)});
    if(response.status===409){const picker=form.querySelector("[data-private-slot-picker]"),state=picker?privatePickerGet(picker):null;if(picker&&state?.selectedDate)await privatePickerLoadSlots(picker,state.selectedDate);if(result)result.textContent=language==="hu"?"Ez az időpont időközben foglalttá vált. Válasszon a frissített szabad időpontok közül.":"That time has just become unavailable. Choose another time from the refreshed list.";return;}
    if(!response.ok)throw new Error("PRIVATE_APPOINTMENT_FAILED");
    if(result)result.textContent=language==="hu"?"Köszönjük. Az időpontkérést megkaptuk, a Klavierhaus jóváhagyása után válik véglegessé.":"Thank you. We received your appointment request. It becomes final only after Klavierhaus approval.";
    recordFirstPartyEvent("private_appointment_submit",{piano_id:values.piano_id||"",service_id:values.service_id||""});
    form.reset();privatePickerReset(form);window.setTimeout(()=>{if(privateViewingDialog?.open)privateViewingDialog.close("success");},850);
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
let customerConversationData = null;
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
  const configured=customerChat?.querySelector("[data-chat-logo]:not([hidden])");
  if(configured?.src){const image=document.createElement("img");image.src=configured.src;image.alt="";image.className="customer-chat__message-avatar-logo";span.append(image);}
  else span.innerHTML='<svg viewBox="0 0 64 64"><path d="M13 28c10-14 27-17 39-10-3 7-10 12-21 15v13M31 33H18l-6 11h35M18 44v8M43 44v8M33 20l-5 10"/></svg>';
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
  customerChat?.classList.toggle("is-panel-open",isOpen);
  document.documentElement.classList.toggle("customer-chat-open",isOpen&&customerChatMobileMode());
  if(isOpen){
    customerChatWelcome?.classList.add("is-dismissed");syncCustomerChatViewport();
    requestAnimationFrame(()=>{if(customerChatMessages)customerChatMessages.scrollTop=customerChatMessages.scrollHeight;});
  }else{
    customerChatMessageInput?.blur();document.documentElement.classList.remove("customer-chat-open");
  }
}
function clearCustomerConversationSession(){
  customerConversationToken="";customerConversationSnapshot="";customerConversationData=null;
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
function customerAppointmentReasonLabel(value){
  const key=String(value||"OTHER").toUpperCase();
  if(language==="hu")return key==="PIANO_VIEWING"?"Zongora megtekintés":key==="SERVICE_REQUEST"?"Szolgáltatás igénybevétele":"Egyéb ügy";
  return key==="PIANO_VIEWING"?"Piano viewing":key==="SERVICE_REQUEST"?"Service request":"Other";
}
function customerStructuredMessage(message){
  const type=String(message.message_type||"TEXT").toUpperCase(),data=message.metadata||{};
  if(type==="CUSTOMER_PROFILE_FORM"){
    const card=document.createElement("section");card.className="customer-chat__interactive-card";
    const title=document.createElement("strong");title.textContent=language==="hu"?"Ügyfél- és zongoraadatok":"Customer & piano details";
    const lead=document.createElement("p");lead.textContent=language==="hu"?"Kérjük, ellenőrizze és egészítse ki az adatokat.":"Please review and complete the details.";
    const form=document.createElement("form");form.dataset.customerProfileForm="1";form.dataset.messageId=String(message.id||"");form.className="customer-chat__interactive-form";form.addEventListener("input",()=>{form.dataset.dirty="true";});
    const makeInput=(labelText,name,value="",typeName="text")=>{const label=document.createElement("label"),span=document.createElement("span"),input=document.createElement("input");span.textContent=labelText;input.name=name;input.type=typeName;input.value=value||"";if(name==="phone")input.required=true;label.append(span,input);return label;};
    form.append(makeInput(language==="hu"?"Telefonszám":"Phone","phone",data.phone||"","tel"),makeInput(language==="hu"?"Ügyfél címe":"Customer address","address",data.address||""));
    const pianoLabel=document.createElement("label"),pianoSpan=document.createElement("span"),select=document.createElement("select");pianoSpan.textContent=language==="hu"?"Zongora":"Piano";select.name="piano_id";
    const newOption=document.createElement("option");newOption.value="";newOption.textContent=language==="hu"?"+ Új zongora":"+ Add new piano";select.append(newOption);
    (Array.isArray(data.pianos)?data.pianos:[]).forEach(piano=>{const option=document.createElement("option");option.value=String(piano.id);option.textContent=[piano.brand,piano.model,piano.serial_number?("SN "+piano.serial_number):""].filter(Boolean).join(" · ");select.append(option);});
    pianoLabel.append(pianoSpan,select);form.append(pianoLabel);
    const newFields=document.createElement("div");newFields.className="customer-chat__piano-fields";newFields.dataset.newPianoFields="1";
    newFields.append(makeInput(language==="hu"?"Márka":"Brand","piano_brand"),makeInput(language==="hu"?"Modell":"Model","piano_model"),makeInput(language==="hu"?"Sorozatszám":"Serial number","piano_serial"),makeInput(language==="hu"?"Zongora helyszíne":"Piano location","piano_location_address",data.address||""));
    form.append(newFields);select.addEventListener("change",()=>{newFields.hidden=Boolean(select.value);});
    const submit=document.createElement("button");submit.type="submit";submit.className="button button--primary";submit.textContent=language==="hu"?"Adatok elküldése":"Send details";form.append(submit);
    card.append(title,lead,form);return card;
  }
  if(type==="PRIVATE_APPOINTMENT_PICKER"){
    const card=document.createElement("section");card.className="customer-chat__interactive-card customer-chat__interactive-card--appointment";
    const title=document.createElement("strong");title.textContent=language==="hu"?"Privát időpont foglalása":"Book a private appointment";
    const lead=document.createElement("p");lead.textContent=language==="hu"?"Válasszon a ténylegesen szabad New York-i időpontok közül.":"Choose from genuinely available New York times.";
    const open=document.createElement("button");open.type="button";open.className="button button--primary";open.dataset.chatOpenBooking="1";open.textContent=language==="hu"?"Szabad időpontok":"Available times";
    card.append(title,lead,open);return card;
  }
  if(type==="CUSTOMER_PROFILE_SUBMITTED"){
    const card=document.createElement("section");card.className="customer-chat__structured-summary";const title=document.createElement("strong");title.textContent=language==="hu"?"✓ Adatok elküldve":"✓ Details submitted";card.append(title);
    if(data.phone){const p=document.createElement("p");p.textContent=(language==="hu"?"Telefon: ":"Phone: ")+data.phone;card.append(p);}
    if(data.address){const p=document.createElement("p");p.textContent=(language==="hu"?"Cím: ":"Address: ")+data.address;card.append(p);}
    if(data.piano){const p=document.createElement("p");p.textContent=(language==="hu"?"Zongora: ":"Piano: ")+[data.piano.brand,data.piano.model].filter(Boolean).join(" ");card.append(p);}
    return card;
  }
  if(type==="PRIVATE_APPOINTMENT_REQUEST"){
    const card=document.createElement("section");card.className="customer-chat__structured-summary customer-chat__structured-summary--appointment";
    const title=document.createElement("strong");title.textContent=language==="hu"?"✓ Privát időpont kiválasztva":"✓ Private appointment time selected";card.append(title);
    if(data.scheduled_at){const p=document.createElement("p");try{p.textContent=(language==="hu"?"Időpont: ":"Date & time: ")+new Intl.DateTimeFormat(language==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(data.scheduled_at))+" ET";}catch(_error){p.textContent=data.scheduled_at;}card.append(p);}
    const reason=document.createElement("p");reason.textContent=(language==="hu"?"Ügy: ":"Purpose: ")+customerAppointmentReasonLabel(data.appointment_reason);card.append(reason);
    if(data.duration_min){const duration=document.createElement("p");duration.textContent=(language==="hu"?"Időtartam: ":"Duration: ")+Number(data.duration_min)+" "+(language==="hu"?"perc":"min");card.append(duration);}
    const status=document.createElement("small");status.textContent=language==="hu"?"A kérés rögzítve. A Klavierhaus telefonon visszaigazolja az időpontot.":"Request recorded. Klavierhaus will confirm the appointment by phone.";card.append(status);return card;
  }
  return null;
}
function prefillCustomerChatBooking(){
  const dialog=customerChat?.querySelector("[data-chat-booking-dialog]"),form=dialog?.querySelector("[data-chat-booking-form]");if(!form)return;
  const data=customerConversationData||{},client=data.linked_client||{};
  if(form.elements.name)form.elements.name.value=client.name||data.name||"";
  if(form.elements.email)form.elements.email.value=client.email||data.email||"";
  if(form.elements.phone)form.elements.phone.value=client.phone||"";
}
function openCustomerChatBooking(){
  if(!customerConversationToken){if(customerChatResult)customerChatResult.textContent=language==="hu"?"Előbb indítsa el a beszélgetést.":"Start the conversation first.";return;}
  const dialog=customerChat?.querySelector("[data-chat-booking-dialog]"),form=dialog?.querySelector("[data-chat-booking-form]");if(!dialog||!form)return;
  form.reset();prefillCustomerChatBooking();privatePickerEnsure(form);privatePickerReset(form);dialog.showModal();form.querySelector('[name="phone"]')?.focus();
}
async function submitCustomerChatBooking(form){
  const result=form.querySelector("[data-chat-booking-result]");let values;
  try{values=privateAppointmentValues(form);}catch(_error){if(result)result.textContent=language==="hu"?"Válasszon szabad időpontot.":"Choose an available time.";return;}
  values.conversation_token=customerConversationToken;if(result)result.textContent=language==="hu"?"Küldés…":"Sending…";
  try{
    const response=await fetch("/api/site/private-appointments",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(values)}),payload=await response.json().catch(()=>({}));
    if(response.status===409){const picker=form.querySelector("[data-private-slot-picker]"),state=picker?privatePickerGet(picker):null;if(picker&&state?.selectedDate)await privatePickerLoadSlots(picker,state.selectedDate);if(result)result.textContent=language==="hu"?"Az időpont időközben foglalttá vált. Válasszon másikat.":"That time just became unavailable. Choose another.";return;}
    if(!response.ok)throw new Error(payload.error||"PRIVATE_APPOINTMENT_FAILED");
    const dialog=customerChat?.querySelector("[data-chat-booking-dialog]");if(dialog?.open)dialog.close("success");
    if(customerChatResult)customerChatResult.textContent=language==="hu"?"A kiválasztott privát időpont bekerült a beszélgetésbe; a Klavierhaus telefonon visszaigazolja.":"Your selected private appointment time is now in the chat; Klavierhaus will confirm by phone.";
    customerConversationSnapshot="";await loadCustomerConversation(customerConversationToken,{force:true,scrollToEnd:true});
  }catch(_error){if(result)result.textContent=language==="hu"?"Az időpontkérés küldése nem sikerült.":"We could not send the appointment request.";}
}
function customerConversationSignature(conversation){
  return JSON.stringify([
    conversation?.status||"",
    conversation?.updated_at||"",
    conversation?.messages?.length||0,
    conversation?.messages?.at?.(-1)?.id||conversation?.messages?.[conversation?.messages?.length-1]?.id||"",
    (conversation?.appointment_proposals||[]).map(item=>item.id+":"+item.status+":"+(item.private_appointment_id||"")).join(",")
  ]);
}
function customerChatInteractionLocked(){
  const dirty=customerChatMessages?.querySelector('[data-customer-profile-form][data-dirty="true"]');
  const booking=customerChat?.querySelector("[data-chat-booking-dialog][open]");
  return Boolean(dirty||booking);
}
function renderCustomerMessages(messages = [], conversation = null, {scrollToEnd=false,preserveScroll=true} = {}) {
  if (!customerChatMessages) return;
  const previousTop=customerChatMessages.scrollTop,previousHeight=customerChatMessages.scrollHeight;
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
    const structured=customerStructuredMessage(message),messageType=String(message.message_type||"TEXT").toUpperCase(),interactive=["CUSTOMER_PROFILE_FORM","PRIVATE_APPOINTMENT_PICKER"].includes(messageType);
    if(interactive){row.classList.add("customer-chat__message-row--interactive");item.classList.add("customer-chat__message--interactive");}
    if(structured)item.append(structured);else if(message.body){const body=document.createElement("p");body.textContent=message.body;item.append(body);}
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
  if(scrollToEnd)customerChatMessages.scrollTop=customerChatMessages.scrollHeight;
  else if(preserveScroll&&previousHeight>0)customerChatMessages.scrollTop=Math.min(previousTop,Math.max(0,customerChatMessages.scrollHeight-customerChatMessages.clientHeight));
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
async function loadCustomerConversation(token,{force=false,scrollToEnd=false}={}) {
  if (!token) return;
  try {
    const response=await fetch(`/api/site/customer-conversations/${encodeURIComponent(token)}`,{credentials:"same-origin",cache:"no-store"});
    if(!response.ok)throw new Error("CONVERSATION_NOT_FOUND");
    const conversation=await response.json();customerConversationToken=token;customerConversationData=conversation;
    const nextSnapshot=customerConversationSignature(conversation),firstRender=!customerConversationSnapshot,changed=nextSnapshot!==customerConversationSnapshot;
    renderSupportStatus(conversation.support||{});
    if(conversation.status==="CLOSED"){
      if(force||firstRender||changed)renderCustomerMessages(conversation.messages||[],conversation,{scrollToEnd:scrollToEnd||firstRender,preserveScroll:!scrollToEnd});
      showCustomerConversationClosed(conversation);customerConversationSnapshot=nextSnapshot;return;
    }
    applyCustomerChatMode(true);
    const locked=customerChatInteractionLocked();
    if(force||firstRender||(changed&&!locked)){
      renderCustomerMessages(conversation.messages||[],conversation,{scrollToEnd:scrollToEnd||firstRender,preserveScroll:!scrollToEnd});
      if(changed&&customerChatResult)customerChatResult.textContent="";
      customerConversationSnapshot=nextSnapshot;
    }
  }catch(_error){
    if(!new URLSearchParams(location.search).get("conversation"))localStorage.removeItem(customerConversationKey);
    customerConversationToken="";customerConversationData=null;applyCustomerChatMode(false);
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
    const conversation=result.conversation||result;customerConversationData=conversation;customerConversationSnapshot="";customerChatPendingFiles=[];renderCustomerChatFiles();
    if(customerChatMessageInput)customerChatMessageInput.value="";
    applyCustomerChatMode(Boolean(customerConversationToken));renderCustomerMessages(conversation.messages||[],conversation,{scrollToEnd:true});customerConversationSnapshot=customerConversationSignature(conversation);renderSupportStatus(conversation.support||{});
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
  customerChat?.querySelector("[data-chat-booking-open]")?.addEventListener("click",openCustomerChatBooking);
  customerChat?.querySelector("[data-chat-booking-close]")?.addEventListener("click",()=>customerChat?.querySelector("[data-chat-booking-dialog]")?.close("cancel"));
  customerChat?.querySelector("[data-chat-booking-form]")?.addEventListener("submit",event=>{event.preventDefault();void submitCustomerChatBooking(event.currentTarget);});
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
  customerChatMessages?.addEventListener("submit",async event=>{
    const form=event.target.closest("[data-customer-profile-form]");if(!form||!customerConversationToken)return;event.preventDefault();const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{const payload=Object.fromEntries(new FormData(form).entries()),response=await fetch("/api/site/customer-conversations/"+encodeURIComponent(customerConversationToken)+"/customer-profile",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"CUSTOMER_PROFILE_FAILED");customerConversationData=result;customerConversationSnapshot=customerConversationSignature(result);renderCustomerMessages(result.messages||[],result,{scrollToEnd:true});}
    catch(_error){if(button)button.disabled=false;if(customerChatResult)customerChatResult.textContent=language==="hu"?"Az adatok mentése nem sikerült.":"We could not save the details.";}
  });
  customerChatMessages?.addEventListener("click",async event=>{
    const booking=event.target.closest("[data-chat-open-booking]");if(booking){openCustomerChatBooking();return;}
    const button=event.target.closest("[data-proposal-decision]");if(!button||!customerConversationToken)return;button.disabled=true;
    try{const response=await fetch(`/api/site/customer-conversations/${encodeURIComponent(customerConversationToken)}/appointment-proposals/${encodeURIComponent(button.dataset.proposalId)}/respond`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision:button.dataset.proposalDecision})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"APPOINTMENT_RESPONSE_FAILED");customerConversationSnapshot=customerConversationSignature(result);renderCustomerMessages(result.messages||[],result,{scrollToEnd:true});if(customerChatResult)customerChatResult.textContent=button.dataset.proposalDecision==="ACCEPTED"?(language==="hu"?"Az időpontot elfogadta; a foglalás automatikusan bekerült a naptárba.":"Appointment accepted and automatically confirmed in the calendar."):(language==="hu"?"Jeleztük, hogy másik időpontot kér.":"We have let the team know you need another time.");}
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

