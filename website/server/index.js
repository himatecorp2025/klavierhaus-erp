"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const compression = require("compression");
const { createEventClient } = require("./event-client");
const {
  VERSION,
  findRoute,
  getAlternateLanguage,
  getGlobal,
  getLanguageFromPath,
  getPage,
  getRoute,
  normalizePathname,
  routeDefinitions,
  shared
} = require("./site-content");

require("dotenv").config();

const DEFAULT_BASE_URL = "https://klavierhaus-home.onrender.com";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
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

function renderParagraphs(paragraphs, className = "section-copy") {
  if (!Array.isArray(paragraphs)) return "";
  return paragraphs.map((paragraph) => `<p class="${className}">${escapeHtml(paragraph)}</p>`).join("");
}

function renderTextLink(link, language, className = "text-link") {
  if (!link || !link.label || !link.key) return "";
  return `<a class="${className}" href="${escapeHtml(getRoute(link.key, language))}">
    <span>${escapeHtml(link.label)}</span>
    <span aria-hidden="true">↗</span>
  </a>`;
}

function renderButton(link, language, variant = "primary") {
  if (!link || !link.label || !link.key) return "";
  return `<a class="button button--${escapeHtml(variant)}" href="${escapeHtml(getRoute(link.key, language))}">
    <span>${escapeHtml(link.label)}</span>
    <span class="button-arrow" aria-hidden="true">↗</span>
  </a>`;
}

function renderPicture(src, alt, className, options = {}) {
  const loading = options.eager ? "eager" : "lazy";
  const priority = options.eager ? ' fetchpriority="high"' : "";
  return `<figure class="${escapeHtml(className)}">
    <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="${loading}" decoding="async"${priority}>
  </figure>`;
}

function isNavigationActive(itemKey, currentKey) {
  if (itemKey === currentKey) return true;
  if (itemKey === "events" && currentKey === "salon") return true;
  if (itemKey === "pianos" && currentKey === "steinway") return true;
  return itemKey === "services" && ["restoration", "tuning", "concert"].includes(currentKey);
}

function renderHeader({ copy, language, currentKey, alternateRouteOverride = "" }) {
  const alternateLanguage = getAlternateLanguage(language);
  const alternateRoute = alternateRouteOverride || getRoute(currentKey, alternateLanguage);
  const navItems = copy.nav.map((item) => {
    const active = isNavigationActive(item.key, currentKey) ? ' aria-current="page"' : "";
    return `<li><a href="${escapeHtml(getRoute(item.key, language))}"${active}>${escapeHtml(item.label)}</a></li>`;
  }).join("");

  return `<a class="skip-link" href="#main-content">${escapeHtml(copy.skipLabel)}</a>
  <header class="site-header" data-site-header>
    <a class="brand" href="${escapeHtml(getRoute("home", language))}" aria-label="${escapeHtml(copy.brandAriaLabel)}">
      <img class="brand-logo" src="${escapeHtml(shared.logo)}" alt="${escapeHtml(copy.logoAlt)}" width="320" height="333">
      <span class="brand-wordmark">KLAVIERHAUS</span>
    </a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-navigation" aria-label="${escapeHtml(copy.menuOpenLabel)}" data-menu-toggle data-open-label="${escapeHtml(copy.menuOpenLabel)}" data-close-label="${escapeHtml(copy.menuCloseLabel)}">
      <span></span><span></span>
    </button>
    <div class="navigation-panel" id="site-navigation" data-navigation-panel>
      <nav class="primary-navigation" aria-label="${escapeHtml(copy.navigationLabel)}">
        <ul>${navItems}</ul>
      </nav>
      <div class="header-actions">
        <a class="language-switch" href="${escapeHtml(alternateRoute)}" hreflang="${alternateLanguage === "hu" ? "hu-HU" : "en-US"}">${escapeHtml(copy.alternateLabel)}</a>
        <a class="header-consultation" href="${escapeHtml(getRoute("consultation", language))}">${escapeHtml(copy.consultationLabel)} <span aria-hidden="true">↗</span></a>
      </div>
    </div>
  </header>`;
}

function renderHero(page, language) {
  const hero = page.hero;
  const copy = getGlobal(language);
  const hasImage = Boolean(hero.image);
  const actions = hero.primary || hero.secondary
    ? `<div class="hero-actions">
        ${renderButton(hero.primary, language, "primary")}
        ${renderButton(hero.secondary, language, "ghost")}
      </div>`
    : "";

  if (page.template === "home") {
    return `<section class="hero hero--home" aria-labelledby="page-title">
      ${renderPicture(hero.image, hero.imageAlt, "hero-media", { eager: true })}
      <div class="hero-shade" aria-hidden="true"></div>
      <div class="hero-ornament" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="hero-content" data-reveal>
        <p class="eyebrow">${escapeHtml(hero.eyebrow)}</p>
        <h1 id="page-title">${escapeHtml(hero.title)}</h1>
        <p class="hero-lead">${escapeHtml(hero.lead)}</p>
        ${actions}
      </div>
      <a class="hero-scroll" href="#manifesto"><span aria-hidden="true"></span>${escapeHtml(copy.scrollLabel)}</a>
    </section>`;
  }

  return `<section class="hero hero--inner${hasImage ? " hero--with-image" : " hero--legal"}" aria-labelledby="page-title">
    ${hasImage ? renderPicture(hero.image, hero.imageAlt, "hero-media", { eager: true }) : ""}
    ${hasImage ? '<div class="hero-shade" aria-hidden="true"></div>' : ""}
    <div class="hero-content" data-reveal>
      <p class="eyebrow">${escapeHtml(hero.eyebrow)}</p>
      <h1 id="page-title">${escapeHtml(hero.title)}</h1>
      <p class="hero-lead">${escapeHtml(hero.lead)}</p>
    </div>
  </section>`;
}

function renderStatement(section, language) {
  return `<section class="section section--statement" id="${escapeHtml(section.id)}" data-reveal>
    <div class="section-marker"><span>${escapeHtml(section.eyebrow)}</span></div>
    <div class="statement-content">
      <h2>${escapeHtml(section.title)}</h2>
      <div class="statement-copy">${renderParagraphs(section.body)}</div>
      ${renderTextLink(section.link, language)}
    </div>
  </section>`;
}

function renderVisual(section, language) {
  return `<section class="section section--visual${section.reverse ? " is-reversed" : ""}" id="${escapeHtml(section.id)}">
    <div class="visual-media" data-reveal>${renderPicture(section.image, section.imageAlt, "editorial-image")}</div>
    <div class="visual-copy" data-reveal>
      <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
      <h2>${escapeHtml(section.title)}</h2>
      ${renderParagraphs(section.body)}
      ${renderTextLink(section.link, language)}
    </div>
  </section>`;
}

function renderQuote(section) {
  return `<section class="section section--quote" id="${escapeHtml(section.id)}" data-reveal>
    <div class="quote-mark" aria-hidden="true">“</div>
    <blockquote>
      <p>${escapeHtml(section.quote)}</p>
      <footer>— ${escapeHtml(section.attribution)}</footer>
    </blockquote>
  </section>`;
}

function renderEditorial(section, language) {
  return `<section class="section section--editorial" id="${escapeHtml(section.id)}" data-reveal>
    <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
    <div class="editorial-grid">
      <h2>${escapeHtml(section.title)}</h2>
      <div>${renderParagraphs(section.body)}${renderTextLink(section.link, language)}</div>
    </div>
  </section>`;
}

function renderCards(section, language) {
  const items = section.items.map((item, index) => `<article class="luxury-card" data-reveal>
    <span class="card-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.body)}</p>
    ${renderTextLink(item.link, language, "card-link")}
  </article>`).join("");

  return `<section class="section section--cards" id="${escapeHtml(section.id)}">
    <div class="section-heading" data-reveal>
      <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(section.intro)}</p>
    </div>
    <div class="card-grid">${items}</div>
  </section>`;
}

function renderCta(section, language) {
  return `<section class="section section--cta" id="${escapeHtml(section.id)}" data-reveal>
    <div class="cta-ornament" aria-hidden="true"><span></span><span></span></div>
    <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
    <h2>${escapeHtml(section.title)}</h2>
    <p>${escapeHtml(section.body)}</p>
    ${renderButton(section.link, language, "primary")}
  </section>`;
}

function renderNotice(section) {
  return `<section class="section section--notice" id="${escapeHtml(section.id)}" data-reveal>
    <span class="notice-line" aria-hidden="true"></span>
    <div>
      <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(section.body)}</p>
    </div>
  </section>`;
}

function renderEvent(section, language) {
  return `<section class="section section--event" id="${escapeHtml(section.id)}">
    <div class="event-media" data-reveal>${renderPicture(section.image, section.imageAlt, "event-image")}</div>
    <article class="event-card" data-reveal>
      <p class="event-status"><span aria-hidden="true"></span>${escapeHtml(section.status)}</p>
      <h2>${escapeHtml(section.title)}</h2>
      <p class="event-meta">${escapeHtml(section.meta)}</p>
      <p>${escapeHtml(section.body)}</p>
      ${renderTextLink(section.link, language)}
    </article>
  </section>`;
}

function renderContact(section) {
  const details = section.details.map((detail) => {
    const value = escapeHtml(detail.value).replaceAll("\n", "<br>");
    const content = detail.href
      ? `<a href="${escapeHtml(detail.href)}">${value}</a>`
      : `<span>${value}</span>`;
    return `<div class="contact-detail"><dt>${escapeHtml(detail.label)}</dt><dd>${content}</dd></div>`;
  }).join("");

  return `<section class="section section--contact" id="${escapeHtml(section.id)}" data-reveal>
    <div>
      <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(section.body)}</p>
    </div>
    <dl>${details}</dl>
  </section>`;
}

function renderLegal(section) {
  const list = Array.isArray(section.list)
    ? `<ul>${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
  return `<section class="section section--legal" id="${escapeHtml(section.id)}" data-reveal>
    <h2>${escapeHtml(section.title)}</h2>
    ${renderParagraphs(section.paragraphs, "legal-copy")}
    ${list}
    ${section.note ? `<aside>${escapeHtml(section.note)}</aside>` : ""}
  </section>`;
}

function renderSection(section, language) {
  switch (section.type) {
    case "statement": return renderStatement(section, language);
    case "visual": return renderVisual(section, language);
    case "quote": return renderQuote(section);
    case "editorial": return renderEditorial(section, language);
    case "cards": return renderCards(section, language);
    case "cta": return renderCta(section, language);
    case "notice": return renderNotice(section);
    case "event": return renderEvent(section, language);
    case "contact": return renderContact(section);
    case "legal": return renderLegal(section);
    default: return "";
  }
}

function renderFooter(copy, language) {
  return `<footer class="site-footer">
    <div class="footer-primary">
      <div class="footer-brand">
        <img src="${escapeHtml(shared.logo)}" alt="" width="320" height="333" loading="lazy" decoding="async">
        <p>${escapeHtml(copy.footerStatement)}</p>
      </div>
      <div class="footer-column">
        <p class="footer-label">${escapeHtml(copy.footerExplore)}</p>
        <a href="${escapeHtml(getRoute("story", language))}">${escapeHtml(copy.footerStory)}</a>
        <a href="${escapeHtml(getRoute("events", language))}">${escapeHtml(copy.nav.find((item) => item.key === "events").label)}</a>
        <a href="${escapeHtml(getRoute("artists", language))}">${escapeHtml(copy.nav.find((item) => item.key === "artists").label)}</a>
        <a href="${escapeHtml(getRoute("pianos", language))}">${escapeHtml(copy.nav.find((item) => item.key === "pianos").label)}</a>
      </div>
      <div class="footer-column">
        <p class="footer-label">${escapeHtml(copy.footerVisit)}</p>
        <address>${escapeHtml(shared.addressLines[0])}<br>${escapeHtml(shared.addressLines[1])}</address>
        <a href="${escapeHtml(shared.phoneHref)}">${escapeHtml(shared.phoneDisplay)}</a>
        <a href="${escapeHtml(shared.emailHref)}">${escapeHtml(shared.emailDisplay)}</a>
        <a href="${escapeHtml(getRoute("contact", language))}">${escapeHtml(copy.footerContact)}</a>
      </div>
      <div class="footer-column">
        <p class="footer-label">${escapeHtml(copy.footerLegal)}</p>
        <a href="${escapeHtml(getRoute("privacy", language))}">${escapeHtml(copy.footerPrivacy)}</a>
        <a href="${escapeHtml(getRoute("ticketTerms", language))}">${escapeHtml(copy.footerTerms)}</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© <span data-current-year></span> Klavierhaus. ${escapeHtml(copy.rights)}</span>
      <span>New York · France</span>
    </div>
  </footer>`;
}

function organizationStructuredData(baseUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Klavierhaus",
    url: `${baseUrl}/`,
    logo: pageUrl(baseUrl, shared.logo),
    email: shared.emailDisplay,
    telephone: "+1-212-245-4535",
    address: {
      "@type": "PostalAddress",
      streetAddress: "790 11th Avenue",
      addressLocality: "New York",
      addressRegion: "NY",
      postalCode: "10019",
      addressCountry: "US"
    }
  };
}

function renderDocument({ route, baseUrl, allowIndexing, nonce }) {
  const { key, language } = route;
  const copy = getGlobal(language);
  const page = getPage(key, language);
  const alternateLanguage = getAlternateLanguage(language);
  const canonicalRoute = getRoute(key, language);
  const alternateRoute = getRoute(key, alternateLanguage);
  const englishUrl = pageUrl(baseUrl, getRoute(key, "en"));
  const hungarianUrl = pageUrl(baseUrl, getRoute(key, "hu"));
  const canonicalUrl = pageUrl(baseUrl, canonicalRoute);
  const robots = allowIndexing ? "index, follow" : "noindex, nofollow, noarchive";
  const sections = page.sections.map((section) => renderSection(section, language)).join("");

  return `<!doctype html>
<html lang="${escapeHtml(copy.locale)}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#080807">
  <meta name="robots" content="${robots}">
  <meta name="description" content="${escapeHtml(page.seo.description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Klavierhaus">
  <meta property="og:title" content="${escapeHtml(page.seo.title)}">
  <meta property="og:description" content="${escapeHtml(page.seo.description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(pageUrl(baseUrl, page.hero.image || shared.heroImage))}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="alternate" hreflang="en-US" href="${escapeHtml(englishUrl)}">
  <link rel="alternate" hreflang="hu-HU" href="${escapeHtml(hungarianUrl)}">
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(englishUrl)}">
  <link rel="icon" type="image/png" href="${escapeHtml(shared.logo)}">
  <link rel="preload" as="image" href="${escapeHtml(page.hero.image || shared.heroImage)}" fetchpriority="high">
  <link rel="stylesheet" href="/assets/styles.css?v=${VERSION}">
  <script src="/assets/app.js?v=${VERSION}" defer></script>
  <script type="application/ld+json" nonce="${escapeHtml(nonce)}">${escapeJson(organizationStructuredData(baseUrl))}</script>
  <title>${escapeHtml(page.seo.title)}</title>
</head>
<body class="template-${escapeHtml(page.template)}" data-language="${escapeHtml(language)}" data-page="${escapeHtml(key)}">
  ${renderHeader({ copy, language, currentKey: key })}
  <main id="main-content">
    ${renderHero(page, language)}
    <div class="content-shell">${sections}</div>
  </main>
  ${renderFooter(copy, language)}
</body>
</html>`;
}

const eventCopy = Object.freeze({
  en: Object.freeze({
    listEyebrow: "Klavierhaus programme",
    listTitle: "Intimate encounters in music.",
    listLead: "A considered programme of concerts, salons, masterclasses, and cultural gatherings in New York.",
    upcoming: "Upcoming programme",
    noEvents: "The next programme is being prepared. Please return soon.",
    details: "View event",
    date: "Date",
    venue: "Venue",
    artist: "Artist",
    capacity: "Availability",
    available: "places available",
    soldOut: "Sold out",
    price: "Admission",
    complimentary: "Complimentary",
    ticketingSoon: "Online ticketing will open in the next release. No reservation has been created yet.",
    cancelled: "This event has been cancelled.",
    rescheduled: "This event has been rescheduled.",
    invitationEyebrow: "Private invitation",
    invitationTitle: "You are invited.",
    invitationLead: "Please confirm whether you will attend. A place is reserved only after acceptance and while capacity remains.",
    guest: "Guest",
    accept: "Accept invitation",
    decline: "Decline invitation",
    accepted: "Your invitation has been accepted. Your personal ticket has been created.",
    declined: "Your invitation has been declined and no place has been reserved.",
    answered: "This invitation has already been answered.",
    unavailable: "This invitation is no longer available.",
    privacy: "This private page is excluded from search engines. The invitation link is personal.",
    back: "View public events"
  }),
  hu: Object.freeze({
    listEyebrow: "Klavierhaus program",
    listTitle: "Meghitt találkozások a zenében.",
    listLead: "Koncertek, szalonestek, mesterkurzusok és kulturális találkozások gondosan összeállított New York-i programja.",
    upcoming: "Közelgő programok",
    noEvents: "A következő program előkészítés alatt áll. Kérjük, látogasson vissza hamarosan.",
    details: "Esemény megtekintése",
    date: "Időpont",
    venue: "Helyszín",
    artist: "Művész",
    capacity: "Elérhetőség",
    available: "szabad hely",
    soldOut: "Megtelt",
    price: "Belépőjegy",
    complimentary: "Díjmentes",
    ticketingSoon: "Az online jegyvásárlás a következő fejlesztési szakaszban nyílik meg. Helyfoglalás még nem történt.",
    cancelled: "Az eseményt töröltük.",
    rescheduled: "Az esemény új időpontra került.",
    invitationEyebrow: "Személyes meghívó",
    invitationTitle: "Szeretettel meghívjuk.",
    invitationLead: "Kérjük, jelezze részvételi szándékát. A hely csak elfogadás után és a szabad kapacitás erejéig kerül lefoglalásra.",
    guest: "Meghívott",
    accept: "Meghívás elfogadása",
    decline: "Meghívás visszautasítása",
    accepted: "A meghívást elfogadta. Személyes belépőjegye elkészült.",
    declined: "A meghívást visszautasította, ezért hely nem került lefoglalásra.",
    answered: "Erre a meghívásra már érkezett válasz.",
    unavailable: "Ez a meghívás már nem érhető el.",
    privacy: "Ez a személyes oldal nincs jelen a keresőkben. A meghívó hivatkozása személyre szól.",
    back: "Nyilvános események"
  })
});

function eventPath(event, language) {
  return language === "hu" ? `/hu/esemenyek/${event.slug}` : `/events/${event.slug}`;
}

function invitationPath(token, language) {
  return language === "hu" ? `/hu/meghivas/${encodeURIComponent(token)}` : `/invitation/${encodeURIComponent(token)}`;
}

function formatEventDate(value, language, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "hu" ? "hu-HU" : "en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: options.dateOnly ? undefined : "numeric",
    minute: options.dateOnly ? undefined : "2-digit",
    timeZoneName: options.dateOnly ? undefined : "short"
  }).format(date);
}

function formatEventPrice(event, language) {
  if (event.access_type === "PUBLIC_FREE" || Number(event.price_cents || 0) === 0) return eventCopy[language].complimentary;
  return new Intl.NumberFormat(language === "hu" ? "hu-HU" : "en-US", {
    style: "currency",
    currency: event.currency || "USD"
  }).format(Number(event.price_cents) / 100);
}

function eventVenue(event) {
  return [event.venue?.name, event.venue?.street, event.venue?.city, event.venue?.region, event.venue?.postal_code]
    .filter(Boolean).join(", ");
}

function renderDynamicHead({ language, title, description, canonicalUrl, alternateUrl, imageUrl, robots, nonce, structuredData = [] }) {
  const copy = getGlobal(language);
  const englishUrl = language === "en" ? canonicalUrl : alternateUrl;
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#080807">
  <meta name="robots" content="${escapeHtml(robots)}">
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Klavierhaus">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="alternate" hreflang="${language === "hu" ? "hu-HU" : "en-US"}" href="${escapeHtml(canonicalUrl)}">
  <link rel="alternate" hreflang="${language === "hu" ? "en-US" : "hu-HU"}" href="${escapeHtml(alternateUrl)}">
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(englishUrl)}">
  <link rel="icon" type="image/png" href="${escapeHtml(shared.logo)}">
  <link rel="stylesheet" href="/assets/styles.css?v=${VERSION}">
  <script src="/assets/app.js?v=${VERSION}" defer></script>
  ${structuredData.map((item) => `<script type="application/ld+json" nonce="${escapeHtml(nonce)}">${escapeJson(item)}</script>`).join("\n  ")}
  <title>${escapeHtml(title)}</title>
  <!-- ${escapeHtml(copy.languageName)} -->`;
}

function eventStructuredData(event, baseUrl, language) {
  const url = pageUrl(baseUrl, eventPath(event, language));
  const data = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.short_description || event.description,
    startDate: event.start_at,
    endDate: event.end_at,
    eventStatus: event.status === "CANCELLED"
      ? "https://schema.org/EventCancelled"
      : event.status === "RESCHEDULED" ? "https://schema.org/EventRescheduled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url,
    location: {
      "@type": "Place",
      name: event.venue?.name,
      address: {
        "@type": "PostalAddress",
        streetAddress: event.venue?.street,
        addressLocality: event.venue?.city,
        addressRegion: event.venue?.region,
        postalCode: event.venue?.postal_code,
        addressCountry: event.venue?.country || "US"
      }
    },
    organizer: { "@type": "Organization", name: "Klavierhaus", url: `${baseUrl}/` }
  };
  data.image = [event.hero_image_url || pageUrl(baseUrl, shared.salonImage)];
  if (event.performer_name) data.performer = { "@type": "Person", name: event.performer_name };
  if (event.previous_start_at) data.previousStartDate = event.previous_start_at;
  return data;
}

function renderPublicEventList({ events, language, baseUrl, allowIndexing, nonce }) {
  const copy = getGlobal(language);
  const labels = eventCopy[language];
  const canonicalRoute = getRoute("events", language);
  const alternateRoute = getRoute("events", getAlternateLanguage(language));
  const canonicalUrl = pageUrl(baseUrl, canonicalRoute);
  const cards = events.length ? events.map((event) => `<article class="public-event-card" data-reveal>
    ${event.hero_image_url ? `<img src="${escapeHtml(event.hero_image_url)}" alt="" loading="lazy" decoding="async">` : '<span class="public-event-card__ornament" aria-hidden="true">K</span>'}
    <div class="public-event-card__body">
      <p class="eyebrow">${escapeHtml(event.category)}</p>
      <h2>${escapeHtml(event.title)}</h2>
      <p class="public-event-card__date">${escapeHtml(formatEventDate(event.start_at, language))}</p>
      <p>${escapeHtml(event.short_description)}</p>
      <a class="text-link" href="${escapeHtml(eventPath(event, language))}"><span>${escapeHtml(labels.details)}</span><span aria-hidden="true">↗</span></a>
    </div>
  </article>`).join("") : `<p class="event-empty-state">${escapeHtml(labels.noEvents)}</p>`;

  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({
    language,
    title: `${labels.upcoming} | Klavierhaus`,
    description: labels.listLead,
    canonicalUrl,
    alternateUrl: pageUrl(baseUrl, alternateRoute),
    imageUrl: pageUrl(baseUrl, shared.salonImage),
    robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive",
    nonce,
    structuredData: [organizationStructuredData(baseUrl)]
  })}</head><body class="template-events" data-language="${escapeHtml(language)}" data-page="events">
  ${renderHeader({ copy, language, currentKey: "events" })}
  <main id="main-content">
    <section class="dynamic-event-hero"><div data-reveal><p class="eyebrow">${escapeHtml(labels.listEyebrow)}</p><h1>${escapeHtml(labels.listTitle)}</h1><p>${escapeHtml(labels.listLead)}</p></div></section>
    <section class="dynamic-event-list" aria-labelledby="programme-title"><div class="section-heading" data-reveal><p class="eyebrow">Klavierhaus</p><h2 id="programme-title">${escapeHtml(labels.upcoming)}</h2></div><div class="public-event-grid">${cards}</div></section>
  </main>${renderFooter(copy, language)}</body></html>`;
}

function renderPublicEventDetail({ event, language, baseUrl, allowIndexing, nonce }) {
  const copy = getGlobal(language);
  const labels = eventCopy[language];
  const canonicalPath = eventPath(event, language);
  const alternatePath = language === "hu" ? `/events/${event.alternate_slug}` : `/hu/esemenyek/${event.alternate_slug}`;
  const canonicalUrl = pageUrl(baseUrl, canonicalPath);
  const imageUrl = event.hero_image_url || pageUrl(baseUrl, shared.salonImage);
  const statusNotice = event.status === "CANCELLED" ? labels.cancelled : event.status === "RESCHEDULED" ? labels.rescheduled : "";
  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({
    language,
    title: `${event.title} | Klavierhaus`,
    description: event.short_description || event.description,
    canonicalUrl,
    alternateUrl: pageUrl(baseUrl, alternatePath),
    imageUrl,
    robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive",
    nonce,
    structuredData: [organizationStructuredData(baseUrl), eventStructuredData(event, baseUrl, language)]
  })}</head><body class="template-event-detail" data-language="${escapeHtml(language)}" data-page="events">
  ${renderHeader({ copy, language, currentKey: "events", alternateRouteOverride: alternatePath })}
  <main id="main-content">
    <article class="event-detail-page">
      <header class="event-detail-hero">
        ${event.hero_image_url ? `<img src="${escapeHtml(event.hero_image_url)}" alt="" fetchpriority="high" decoding="async">` : ""}
        <div class="event-detail-hero__shade" aria-hidden="true"></div>
        <div class="event-detail-hero__copy" data-reveal><p class="eyebrow">${escapeHtml(event.category)}</p><h1>${escapeHtml(event.title)}</h1><p>${escapeHtml(event.short_description)}</p></div>
      </header>
      <div class="event-detail-layout">
        <section class="event-detail-narrative" data-reveal>${statusNotice ? `<p class="event-public-status">${escapeHtml(statusNotice)}</p>` : ""}${renderParagraphs(String(event.description || "").split(/\n+/).filter(Boolean))}</section>
        <aside class="event-facts" data-reveal>
          <dl>
            <div><dt>${escapeHtml(labels.date)}</dt><dd>${escapeHtml(formatEventDate(event.start_at, language))}</dd></div>
            ${event.performer_name ? `<div><dt>${escapeHtml(labels.artist)}</dt><dd>${escapeHtml(event.performer_name)}</dd></div>` : ""}
            <div><dt>${escapeHtml(labels.venue)}</dt><dd>${escapeHtml(eventVenue(event))}</dd></div>
            <div><dt>${escapeHtml(labels.capacity)}</dt><dd>${event.sold_out ? escapeHtml(labels.soldOut) : `${escapeHtml(event.capacity_remaining)} ${escapeHtml(labels.available)}`}</dd></div>
            <div><dt>${escapeHtml(labels.price)}</dt><dd>${escapeHtml(formatEventPrice(event, language))}</dd></div>
          </dl>
          ${event.status !== "CANCELLED" ? `<p class="event-ticketing-notice">${escapeHtml(labels.ticketingSoon)}</p>` : ""}
        </aside>
      </div>
    </article>
  </main>${renderFooter(copy, language)}</body></html>`;
}

function renderInvitation({ invitation, token, language, baseUrl, nonce, result = "", error = "" }) {
  const copy = getGlobal(language);
  const labels = eventCopy[language];
  const title = language === "hu" ? invitation.title_hu : invitation.title_en;
  const currentPath = invitationPath(token, language);
  const alternatePath = invitationPath(token, getAlternateLanguage(language));
  const resultMessage = result === "ACCEPTED" ? labels.accepted : result === "DECLINED" ? labels.declined : "";
  const alreadyAnswered = invitation.status !== "PENDING";
  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({
    language,
    title: `${labels.invitationTitle} | Klavierhaus`,
    description: labels.invitationLead,
    canonicalUrl: pageUrl(baseUrl, currentPath),
    alternateUrl: pageUrl(baseUrl, alternatePath),
    imageUrl: pageUrl(baseUrl, shared.salonImage),
    robots: "noindex, nofollow, noarchive",
    nonce,
    structuredData: []
  })}</head><body class="template-invitation" data-language="${escapeHtml(language)}" data-page="events">
  ${renderHeader({ copy, language, currentKey: "events", alternateRouteOverride: alternatePath })}
  <main id="main-content" class="invitation-shell"><section class="invitation-card" data-reveal>
    <img src="${escapeHtml(shared.logo)}" alt="" width="160" height="166">
    <p class="eyebrow">${escapeHtml(labels.invitationEyebrow)}</p><h1>${escapeHtml(labels.invitationTitle)}</h1><p class="invitation-event-title">${escapeHtml(title)}</p><p>${escapeHtml(labels.invitationLead)}</p>
    <dl><div><dt>${escapeHtml(labels.guest)}</dt><dd>${escapeHtml(invitation.guest_name)}</dd></div><div><dt>${escapeHtml(labels.date)}</dt><dd>${escapeHtml(formatEventDate(invitation.start_at, language))}</dd></div><div><dt>${escapeHtml(labels.venue)}</dt><dd>${escapeHtml(invitation.venue_name)}</dd></div></dl>
    ${resultMessage ? `<p class="invitation-result success">${escapeHtml(resultMessage)}</p>` : ""}
    ${error ? `<p class="invitation-result error">${escapeHtml(error)}</p>` : ""}
    ${alreadyAnswered && !resultMessage ? `<p class="invitation-result">${escapeHtml(labels.answered)}</p>` : ""}
    ${!alreadyAnswered && !resultMessage ? `<form class="invitation-actions" method="post" action="${escapeHtml(currentPath)}"><button class="button button--primary" name="decision" value="ACCEPT" type="submit">${escapeHtml(labels.accept)}</button><button class="button button--ghost" name="decision" value="DECLINE" type="submit">${escapeHtml(labels.decline)}</button></form>` : ""}
    <p class="invitation-privacy">${escapeHtml(labels.privacy)}</p><a class="text-link" href="${escapeHtml(getRoute("events", language))}"><span>${escapeHtml(labels.back)}</span><span aria-hidden="true">↗</span></a>
  </section></main>${renderFooter(copy, language)}</body></html>`;
}

function renderNotFound({ language, baseUrl, allowIndexing, nonce }) {
  const copy = getGlobal(language);
  const robots = allowIndexing ? "noindex, follow" : "noindex, nofollow, noarchive";
  return `<!doctype html>
<html lang="${escapeHtml(copy.locale)}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#080807">
  <meta name="robots" content="${robots}">
  <link rel="stylesheet" href="/assets/styles.css?v=${VERSION}">
  <script src="/assets/app.js?v=${VERSION}" defer></script>
  <title>${escapeHtml(copy.notFoundTitle)} | Klavierhaus</title>
</head>
<body class="template-not-found" data-language="${escapeHtml(language)}">
  ${renderHeader({ copy, language, currentKey: "home" })}
  <main id="main-content" class="not-found-shell">
    <section class="not-found" data-reveal>
      <p class="eyebrow">${escapeHtml(copy.notFoundEyebrow)}</p>
      <h1>${escapeHtml(copy.notFoundTitle)}</h1>
      <p>${escapeHtml(copy.notFoundBody)}</p>
      ${renderButton({ label: copy.backHome, key: "home" }, language, "primary")}
    </section>
  </main>
  ${renderFooter(copy, language)}
  <script type="application/ld+json" nonce="${escapeHtml(nonce)}">${escapeJson(organizationStructuredData(baseUrl))}</script>
</body>
</html>`;
}

function createApp(options = {}) {
  const app = express();
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.WEBSITE_BASE_URL);
  const allowIndexing = options.allowIndexing ?? String(process.env.WEBSITE_ALLOW_INDEXING || "false").toLowerCase() === "true";
  const eventClient = createEventClient({
    baseUrl: options.eventApiBaseUrl ?? process.env.ERP_PUBLIC_API_URL,
    timeoutMs: options.eventApiTimeoutMs ?? process.env.EVENT_API_TIMEOUT_MS,
    fetchImpl: options.fetchImpl
  });

  app.disable("x-powered-by");
  app.enable("strict routing");
  app.use(compression());
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use((req, res, next) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    res.locals.cspNonce = nonce;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Content-Security-Policy", `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'; font-src 'self'; form-action 'self' mailto:`);
    if (!allowIndexing) res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    next();
  });

  app.use("/assets", express.static(path.join(__dirname, "..", "public"), {
    fallthrough: false,
    maxAge: "1h",
    etag: true,
    immutable: false
  }));

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "klavierhaus-public-website",
      version: VERSION,
      indexing: allowIndexing ? "enabled" : "disabled",
      event_api: eventClient.configured ? "configured" : "not-configured"
    });
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain");
    res.send(allowIndexing
      ? `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n");
  });

  app.get("/sitemap.xml", async (_req, res) => {
    if (!allowIndexing) {
      res.status(404).type("text/plain").send("Not available while indexing is disabled.");
      return;
    }
    const staticRoutes = Object.keys(routeDefinitions)
      .filter((key) => key !== "salon")
      .flatMap((key) => [getRoute(key, "en"), getRoute(key, "hu")])
    const dynamicRoutes = [];
    if (eventClient.configured) {
      try {
        const [englishEvents, hungarianEvents] = await Promise.all([eventClient.list("en"), eventClient.list("hu")]);
        dynamicRoutes.push(...englishEvents.map((event) => eventPath(event, "en")));
        dynamicRoutes.push(...hungarianEvents.map((event) => eventPath(event, "hu")));
      } catch (error) {
        console.warn(`[website] Event sitemap feed unavailable: ${error.code || error.message}`);
      }
    }
    const urls = [...new Set([...staticRoutes, ...dynamicRoutes])]
      .map((route) => `<url><loc>${escapeHtml(pageUrl(baseUrl, route))}</loc></url>`).join("");
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  app.get(["/events", "/hu/esemenyek"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const events = await eventClient.list(language);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.type("html").send(renderPublicEventList({ events, language, baseUrl, allowIndexing, nonce: res.locals.cspNonce }));
    } catch (error) {
      console.warn(`[website] Event listing fallback: ${error.code || error.message}`);
      next();
    }
  });

  app.get(["/events/:slug", "/hu/esemenyek/:slug"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const event = await eventClient.detail(req.params.slug, language);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.type("html").send(renderPublicEventDetail({ event, language, baseUrl, allowIndexing, nonce: res.locals.cspNonce }));
    } catch (error) {
      if (error.status === 404) return next();
      console.warn(`[website] Event detail unavailable: ${error.code || error.message}`);
      next();
    }
  });

  app.get(["/invitation/:token", "/hu/meghivas/:token"], async (req, res) => {
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const invitation = await eventClient.invitation(req.params.token, language);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      res.type("html").send(renderInvitation({ invitation, token: req.params.token, language, baseUrl, nonce: res.locals.cspNonce }));
    } catch (error) {
      res.status(error.status === 404 ? 404 : 503).type("html").send(renderNotFound({ language, baseUrl, allowIndexing: false, nonce: res.locals.cspNonce }));
    }
  });

  app.post(["/invitation/:token", "/hu/meghivas/:token"], async (req, res) => {
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    const decision = String(req.body?.decision || "").toUpperCase();
    if (!["ACCEPT", "DECLINE"].includes(decision)) return res.status(400).type("html").send(renderNotFound({ language, baseUrl, allowIndexing: false, nonce: res.locals.cspNonce }));
    try {
      const result = await eventClient.respondToInvitation(req.params.token, decision);
      const invitation = await eventClient.invitation(req.params.token, language);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      res.type("html").send(renderInvitation({ invitation, token: req.params.token, language, baseUrl, nonce: res.locals.cspNonce, result: result.status }));
    } catch (error) {
      let invitation;
      try { invitation = await eventClient.invitation(req.params.token, language); } catch (_readError) { invitation = null; }
      if (!invitation) return res.status(error.status === 404 ? 404 : 503).type("html").send(renderNotFound({ language, baseUrl, allowIndexing: false, nonce: res.locals.cspNonce }));
      const message = error.code === "EVENT_SOLD_OUT" ? eventCopy[language].soldOut : error.code === "INVITATION_ALREADY_ANSWERED" ? eventCopy[language].answered : eventCopy[language].unavailable;
      res.status(error.status || 409).type("html").send(renderInvitation({ invitation, token: req.params.token, language, baseUrl, nonce: res.locals.cspNonce, error: message }));
    }
  });

  app.use((req, res) => {
    const requestedPath = req.path;
    const normalizedPath = normalizePathname(requestedPath);

    if (requestedPath === "/hu") {
      res.redirect(308, "/hu/");
      return;
    }

    if (requestedPath.length > 1 && requestedPath !== "/hu/" && requestedPath.endsWith("/")) {
      res.redirect(308, normalizedPath);
      return;
    }

    const route = findRoute(normalizedPath);
    if (!route) {
      const language = getLanguageFromPath(normalizedPath);
      res.status(404).type("html").send(renderNotFound({
        language,
        baseUrl,
        allowIndexing,
        nonce: res.locals.cspNonce
      }));
      return;
    }

    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(renderDocument({
      route,
      baseUrl,
      allowIndexing,
      nonce: res.locals.cspNonce
    }));
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 10000);
  createApp().listen(port, "0.0.0.0", () => {
    console.log(`[website] Klavierhaus public website v${VERSION} listening on port ${port}`);
  });
}

module.exports = {
  createApp,
  normalizeBaseUrl,
  pageUrl,
  renderDocument
};
