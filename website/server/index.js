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

function resolveBrand(copy = {}) {
  const brand = copy.brand && typeof copy.brand === "object" ? copy.brand : {};
  return {
    name: brand.name || "Klavierhaus",
    wordmark: brand.wordmark || "KLAVIERHAUS",
    logoImage: brand.logoImage || shared.logo,
    addressLine1: brand.addressLine1 || shared.addressLines[0],
    addressLine2: brand.addressLine2 || shared.addressLines[1],
    phoneDisplay: brand.phoneDisplay || shared.phoneDisplay,
    phoneHref: brand.phoneHref || shared.phoneHref,
    emailDisplay: brand.emailDisplay || shared.emailDisplay,
    emailHref: brand.emailHref || shared.emailHref,
    footerLocations: brand.footerLocations || "New York · France",
    schemaStreetAddress: brand.schemaStreetAddress || "790 11th Avenue",
    schemaLocality: brand.schemaLocality || "New York",
    schemaRegion: brand.schemaRegion || "NY",
    schemaPostalCode: brand.schemaPostalCode || "10019",
    schemaCountry: brand.schemaCountry || "US"
  };
}

function renderHeader({ copy, language, currentKey, alternateRouteOverride = "" }) {
  const brand = resolveBrand(copy);
  const alternateLanguage = getAlternateLanguage(language);
  const alternateRoute = alternateRouteOverride || getRoute(currentKey, alternateLanguage);
  const navItems = copy.nav.map((item) => {
    const active = isNavigationActive(item.key, currentKey) ? ' aria-current="page"' : "";
    return `<li><a href="${escapeHtml(getRoute(item.key, language))}"${active}>${escapeHtml(item.label)}</a></li>`;
  }).join("");

  return `<a class="skip-link" href="#main-content">${escapeHtml(copy.skipLabel)}</a>
  <header class="site-header" data-site-header>
    <a class="brand" href="${escapeHtml(getRoute("home", language))}" aria-label="${escapeHtml(copy.brandAriaLabel)}">
      <img class="brand-logo" src="${escapeHtml(brand.logoImage)}" alt="${escapeHtml(copy.logoAlt)}" width="320" height="333">
      <span class="brand-wordmark">${escapeHtml(brand.wordmark)}</span>
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

function renderHero(page, language, globalCopyOverride = null) {
  const hero = page.hero;
  const copy = globalCopyOverride || getGlobal(language);
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
  return `<section class="section section--statement${section.image ? " has-image" : ""}" id="${escapeHtml(section.id)}" data-reveal>
    <div class="section-marker"><span>${escapeHtml(section.eyebrow)}</span></div>
    <div class="statement-content">
      <h2>${escapeHtml(section.title)}</h2>
      <div class="statement-lower"><div><div class="statement-copy">${renderParagraphs(section.body)}</div>${renderTextLink(section.link, language)}</div>${section.image ? renderPicture(section.image, section.imageAlt || "", "statement-image") : ""}</div>
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
    <div class="editorial-grid${section.image ? " editorial-grid--with-image" : ""}">
      <h2>${escapeHtml(section.title)}</h2>
      <div class="editorial-grid__copy">${renderParagraphs(section.body)}${renderTextLink(section.link, language)}</div>
      ${section.image ? renderPicture(section.image, section.imageAlt || "", "editorial-feature-image") : ""}
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
  const brand = resolveBrand(copy);
  return `<footer class="site-footer">
    <div class="footer-primary">
      <div class="footer-brand">
        <img src="${escapeHtml(brand.logoImage)}" alt="" width="320" height="333" loading="lazy" decoding="async">
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
        <address>${escapeHtml(brand.addressLine1)}<br>${escapeHtml(brand.addressLine2)}</address>
        <a href="${escapeHtml(brand.phoneHref)}">${escapeHtml(brand.phoneDisplay)}</a>
        <a href="${escapeHtml(brand.emailHref)}">${escapeHtml(brand.emailDisplay)}</a>
        <a href="${escapeHtml(getRoute("contact", language))}">${escapeHtml(copy.footerContact)}</a>
      </div>
      <div class="footer-column">
        <p class="footer-label">${escapeHtml(copy.footerLegal)}</p>
        <a href="${escapeHtml(getRoute("privacy", language))}">${escapeHtml(copy.footerPrivacy)}</a>
        <a href="${escapeHtml(getRoute("ticketTerms", language))}">${escapeHtml(copy.footerTerms)}</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© <span data-current-year></span> ${escapeHtml(brand.name)}. ${escapeHtml(copy.rights)}</span>
      <span>${escapeHtml(brand.footerLocations)}</span>
    </div>
  </footer>`;
}

function organizationStructuredData(baseUrl, copy = {}) {
  const brand = resolveBrand(copy);
  return {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "Organization"],
    name: brand.name,
    url: `${baseUrl}/`,
    logo: pageUrl(baseUrl, brand.logoImage),
    email: brand.emailDisplay,
    telephone: brand.phoneDisplay,
    address: {
      "@type": "PostalAddress",
      streetAddress: brand.schemaStreetAddress,
      addressLocality: brand.schemaLocality,
      addressRegion: brand.schemaRegion,
      postalCode: brand.schemaPostalCode,
      addressCountry: brand.schemaCountry
    }
  };
}

function renderReviewShowcase(reviews, language, fallbackSection = null) {
  const items = reviews.length ? reviews : (fallbackSection ? [{ person_name: fallbackSection.attribution, quote: fallbackSection.quote, role: "", image_url: shared.artistSalonImage, image_alt: fallbackSection.attribution }] : []);
  if (!items.length) return "";
  const cards = items.map((review, index) => `<article class="review-card" data-review-card data-reveal>
    <img src="${escapeHtml(review.image_url || shared.artistSalonImage)}" alt="${escapeHtml(review.image_alt || review.person_name || "Klavierhaus guest")}" loading="lazy" decoding="async">
    <div><span class="review-card__quote" aria-hidden="true">“</span><blockquote>${escapeHtml(review.quote || "")}</blockquote><p><strong>${escapeHtml(review.person_name || "")}</strong>${review.role ? `<span>${escapeHtml(review.role)}</span>` : ""}</p></div>
    <span class="review-card__number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
  </article>`).join("");
  return `<section class="section review-showcase" id="reviews"><div class="collection-heading"><p class="eyebrow">${escapeHtml(language === "hu" ? "Vélemények" : "Reflections")}</p><h2>${escapeHtml(language === "hu" ? "A zene emléke tovább él." : "The memory of music remains.")}</h2></div><div class="review-carousel" data-review-carousel><div class="review-track">${cards}</div><div class="review-controls"><button type="button" data-review-previous aria-label="${escapeHtml(language === "hu" ? "Előző vélemény" : "Previous review")}">←</button><div class="review-dots" data-review-dots></div><button type="button" data-review-next aria-label="${escapeHtml(language === "hu" ? "Következő vélemény" : "Next review")}">→</button></div></div></section>`;
}

function showroomPath(item, language) {
  return language === "hu" ? `/hu/zongorak/${item.slug}` : `/pianos/${item.slug}`;
}

function servicePath(item, language) {
  return language === "hu" ? `/hu/szolgaltatasok/${item.slug}` : `/services/${item.slug}`;
}

function renderShowroomCollection(items, language, options = {}) {
  if (!items.length) return "";
  const compact = Boolean(options.compact);
  const cards = items.map((item) => `<article class="catalog-card" data-reveal>
    <a class="catalog-card__image" href="${escapeHtml(showroomPath(item, language))}"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.image_alt || item.title)}" loading="lazy" decoding="async"></a>
    <div class="catalog-card__body"><p class="eyebrow">${escapeHtml([item.brand, item.model].filter(Boolean).join(" · "))}</p><h3 class="word-safe-title"><a href="${escapeHtml(showroomPath(item, language))}">${escapeHtml(item.title)}</a></h3>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}<span class="catalog-status">${escapeHtml(language === "hu" ? ({ AVAILABLE: "Megtekinthető", RESERVED: "Foglalt", SOLD: "Elkelt" }[item.availability_status] || item.availability_status) : ({ AVAILABLE: "Available for private viewing", RESERVED: "Reserved", SOLD: "Sold" }[item.availability_status] || item.availability_status))}</span><a class="text-link" href="${escapeHtml(showroomPath(item, language))}"><span>${escapeHtml(language === "hu" ? "Privát megtekintés" : "Arrange a private viewing")}</span><span aria-hidden="true">↗</span></a></div>
  </article>`).join("");
  return `<section class="section catalog-showcase${compact ? " catalog-showcase--home" : ""}" id="showroom-pianos"><div class="collection-heading"><p class="eyebrow">${escapeHtml(language === "hu" ? "Bemutatótermi zongorák" : "The showroom")}</p><h2>${escapeHtml(language === "hu" ? "Kivételes hangszerek, személyes találkozásra." : "Exceptional instruments, encountered in person.")}</h2><p>${escapeHtml(language === "hu" ? "Egy zongora valódi karaktere csak a hangján és az érintésén keresztül ismerhető meg." : "A piano's true character is known only through tone, touch, and time in the room.")}</p></div><div class="catalog-grid">${cards}</div></section>`;
}

function renderServiceCollection(items, language, options = {}) {
  if (!items.length) return "";
  const cards = items.map((item) => `<article class="catalog-card service-catalog-card" data-reveal>
    <a class="catalog-card__image" href="${escapeHtml(servicePath(item, language))}"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.image_alt || item.title)}" loading="lazy" decoding="async"></a>
    <div class="catalog-card__body"><p class="eyebrow">Klavierhaus atelier</p><h3 class="word-safe-title"><a href="${escapeHtml(servicePath(item, language))}">${escapeHtml(item.title)}</a></h3>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}<a class="text-link" href="${escapeHtml(servicePath(item, language))}"><span>${escapeHtml(language === "hu" ? "Személyes felmérés egyeztetése" : "Arrange a private assessment")}</span><span aria-hidden="true">↗</span></a></div>
  </article>`).join("");
  return `<section class="section catalog-showcase${options.compact ? " catalog-showcase--home" : ""}" id="bespoke-services"><div class="collection-heading"><p class="eyebrow">${escapeHtml(language === "hu" ? "Személyre szabott gondoskodás" : "Bespoke care")}</p><h2>${escapeHtml(language === "hu" ? "Minden hangszerhez külön figyelem tartozik." : "Every instrument deserves individual attention.")}</h2><p>${escapeHtml(language === "hu" ? "Díjmentes első felmérés, személyes konzultáció és a hangszerhez igazított egyedi ajánlat." : "A private initial assessment, considered consultation, and a proposal shaped around the individual instrument.")}</p></div><div class="catalog-grid">${cards}</div></section>`;
}

function renderDocument({ route, baseUrl, allowIndexing, nonce, homeEvents = [], reviews = [], showroomPianos = [], websiteServices = [], pageOverride = null, globalOverride = null }) {
  const { key, language } = route;
  const copy = globalOverride || getGlobal(language);
  const page = pageOverride || getPage(key, language);
  const alternateLanguage = getAlternateLanguage(language);
  const canonicalRoute = getRoute(key, language);
  const alternateRoute = getRoute(key, alternateLanguage);
  const englishUrl = pageUrl(baseUrl, getRoute(key, "en"));
  const hungarianUrl = pageUrl(baseUrl, getRoute(key, "hu"));
  const canonicalUrl = pageUrl(baseUrl, canonicalRoute);
  const robots = allowIndexing ? "index, follow" : "noindex, nofollow, noarchive";
  const testimonial = page.sections.find((section) => section.id === "testimonial") || null;
  const sections = page.sections.filter((section) => !(key === "home" && ["salon", "testimonial"].includes(section.id))).map((section) => {
    if (key === "home" && section.id === "manifesto") return `${renderSection(section, language)}${renderHomeEventShowcase(homeEvents, language, copy)}${renderReviewShowcase(reviews, language, testimonial)}`;
    if (key === "home" && section.id === "pianos" && showroomPianos.length) return renderShowroomCollection(showroomPianos, language, { compact: true });
    if (key === "home" && section.id === "craft" && websiteServices.length) return renderServiceCollection(websiteServices, language, { compact: true });
    return renderSection(section, language);
  }).join("") + (key === "pianos" ? renderShowroomCollection(showroomPianos, language) : "") + (key === "services" ? renderServiceCollection(websiteServices, language) : "");

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
  <meta property="og:site_name" content="${escapeHtml(resolveBrand(copy).name)}">
  <meta property="og:title" content="${escapeHtml(page.seo.title)}">
  <meta property="og:description" content="${escapeHtml(page.seo.description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(pageUrl(baseUrl, page.hero.image || shared.heroImage))}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="alternate" hreflang="en-US" href="${escapeHtml(englishUrl)}">
  <link rel="alternate" hreflang="hu-HU" href="${escapeHtml(hungarianUrl)}">
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(englishUrl)}">
  <link rel="icon" type="image/png" href="${escapeHtml(resolveBrand(copy).logoImage)}">
  <link rel="preload" as="image" href="${escapeHtml(page.hero.image || shared.heroImage)}" fetchpriority="high">
  <link rel="stylesheet" href="/assets/styles.css?v=${VERSION}">
  <link rel="stylesheet" href="/assets/design-v3.css?v=${VERSION}">
  <script src="/assets/app.js?v=${VERSION}" defer></script>
  <script type="application/ld+json" nonce="${escapeHtml(nonce)}">${escapeJson(organizationStructuredData(baseUrl, copy))}</script>
  <title>${escapeHtml(page.seo.title)}</title>
</head>
<body class="template-${escapeHtml(page.template)}" data-language="${escapeHtml(language)}" data-page="${escapeHtml(key)}">
  ${renderHeader({ copy, language, currentKey: key })}
  <main id="main-content">
    ${renderHero(page, language, copy)}
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
    homeEyebrow: "The next encounters",
    homeTitle: "Enter the room where music becomes personal.",
    homeLead: "A curated sequence of intimate performances and cultural gatherings at Klavierhaus.",
    noEvents: "The next programme is being prepared. Please return soon.",
    details: "View details",
    viewAll: "View all events",
    buyTickets: "Buy tickets",
    reservePlace: "Reserve a place",
    ticketsSoon: "Tickets coming soon",
    testMode: "TEST MODE",
    testModeNote: "Stripe Sandbox checkout. No real charge will be made.",
    quantity: "Number of tickets",
    total: "Total",
    decreaseQuantity: "Remove one ticket",
    increaseQuantity: "Add one ticket",
    artistPending: "Artist to be announced",
    attendeeName: "Full name",
    attendeeEmail: "Email address",
    continueToCheckout: "Continue to secure test checkout",
    reservationSubmit: "Confirm complimentary reservation",
    checkoutSuccess: "Your test payment was received. The ticket is issued after Stripe confirms the payment by webhook.",
    checkoutCancelled: "Checkout was cancelled. The temporary place will be released automatically.",
    checkoutError: "Checkout could not be started. Please try again.",
    reservationSuccess: "Your complimentary reservation has been recorded.",
    cancellationReason: "Organizer's notice",
    date: "Date",
    venue: "Venue",
    artist: "Artist",
    capacity: "Availability",
    available: "places available",
    soldOut: "Sold out",
    price: "Admission",
    complimentary: "Complimentary",
    ticketingSoon: "Online ticketing will open in the next release. No reservation has been created yet.",
    cancelled: "This event has been canceled by the organizer. Please contact our customer service team regarding your refund.",
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
    homeEyebrow: "A következő találkozások",
    homeTitle: "Lépjen be a térbe, ahol a zene személyessé válik.",
    homeLead: "Meghitt előadások és kulturális találkozások gondosan válogatott sora a Klavierhausban.",
    noEvents: "A következő program előkészítés alatt áll. Kérjük, látogasson vissza hamarosan.",
    details: "Részletek",
    viewAll: "Összes esemény",
    buyTickets: "Jegyvásárlás",
    reservePlace: "Helyfoglalás",
    ticketsSoon: "Jegyek hamarosan",
    testMode: "TESZTÜZEM",
    testModeNote: "Stripe Sandbox fizetés. Valódi terhelés nem történik.",
    quantity: "Jegyek száma",
    total: "Összesen",
    decreaseQuantity: "Egy jegy eltávolítása",
    increaseQuantity: "Egy jegy hozzáadása",
    artistPending: "A művész hamarosan",
    attendeeName: "Teljes név",
    attendeeEmail: "E-mail-cím",
    continueToCheckout: "Tovább a biztonságos tesztfizetéshez",
    reservationSubmit: "Díjmentes helyfoglalás megerősítése",
    checkoutSuccess: "A tesztfizetés beérkezett. A jegy a Stripe webhook-visszaigazolása után készül el.",
    checkoutCancelled: "A fizetés megszakadt. Az ideiglenes helyfoglalás automatikusan felszabadul.",
    checkoutError: "A fizetés nem indítható el. Kérjük, próbálja újra.",
    reservationSuccess: "A díjmentes helyfoglalást rögzítettük.",
    cancellationReason: "A szervező tájékoztatása",
    date: "Időpont",
    venue: "Helyszín",
    artist: "Művész",
    capacity: "Elérhetőség",
    available: "szabad hely",
    soldOut: "Megtelt",
    price: "Belépőjegy",
    complimentary: "Díjmentes",
    ticketingSoon: "Az online jegyvásárlás a következő fejlesztési szakaszban nyílik meg. Helyfoglalás még nem történt.",
    cancelled: "Az eseményt a szervező törölte. A visszatérítéssel kapcsolatban kérjük, forduljon ügyfélszolgálatunkhoz.",
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

function resolveEventCopy(language, globalOverride = null) {
  const fallback = eventCopy[language === "hu" ? "hu" : "en"];
  const global = globalOverride || getGlobal(language);
  return { ...fallback, ...(global?.eventLabels || {}) };
}

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

function formatEventPrice(event, language, labels = resolveEventCopy(language)) {
  if (event.access_type === "PUBLIC_FREE" || Number(event.price_cents || 0) === 0) return labels.complimentary;
  return new Intl.NumberFormat(language === "hu" ? "hu-HU" : "en-US", {
    style: "currency",
    currency: event.currency || "USD"
  }).format(Number(event.price_cents) / 100);
}

function eventVenue(event) {
  return [event.venue?.name, event.venue?.street, event.venue?.city, event.venue?.region, event.venue?.postal_code]
    .filter(Boolean).join(", ");
}

function eventExcerpt(event, max = 190) {
  const text = String(event.description || event.short_description || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const candidate = text.slice(0, max + 1);
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, boundary > max * 0.65 ? boundary : max).trim()}…`;
}

function titleLengthClass(value) {
  const text = String(value || "");
  const longest = text.split(/\s+/).reduce((max, word) => Math.max(max, word.length), 0);
  if (longest >= 22 || text.length >= 54) return " title-length--long";
  if (longest >= 15 || text.length >= 36) return " title-length--medium";
  return "";
}

function quantityControl(event, labels, id) {
  return `<div class="ticket-quantity" data-ticket-quantity data-unit-price="${Number(event.price_cents || 0)}" data-currency="${escapeHtml(event.currency || "USD")}" data-locale="${escapeHtml(id.startsWith("hu-") ? "hu-HU" : "en-US")}"><span>${escapeHtml(labels.quantity)}</span><div><button type="button" data-quantity-minus aria-label="${escapeHtml(labels.decreaseQuantity)}">−</button><input id="${escapeHtml(id)}" name="quantity" type="number" inputmode="numeric" min="1" max="${Number(event.capacity_remaining || 1)}" value="1" required><button type="button" data-quantity-plus aria-label="${escapeHtml(labels.increaseQuantity)}">+</button></div>${Number(event.price_cents || 0) > 0 ? `<output data-ticket-total><small>${escapeHtml(labels.total)}</small> ${escapeHtml(formatEventPrice(event, id.startsWith("hu-") ? "hu" : "en", labels))}</output>` : ""}</div>`;
}

function renderEventCardAction(event, language, labels = resolveEventCopy(language)) {
  if (event.status === "CANCELLED") {
    return `<span class="event-card-action event-card-action--cancelled" aria-disabled="true">${escapeHtml(labels.cancelled)}</span>`;
  }
  if (event.sold_out) {
    return `<span class="event-card-action event-card-action--pending" aria-disabled="true">${escapeHtml(labels.soldOut)}</span>`;
  }
  if (event.checkout_available) {
    const id = `${language}-paid-${String(event.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
    return `<form class="event-card-checkout" method="post" action="${escapeHtml(eventPath(event, language))}/checkout">
      ${quantityControl(event, labels, id)}
      <button class="event-card-action event-card-action--checkout" type="submit"><span>${escapeHtml(labels.buyTickets)}</span><small>${escapeHtml(labels.testMode)}</small></button>
    </form>`;
  }
  if (event.reservation_available) {
    const id = `${language}-free-${String(event.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
    return `<details class="event-card-reservation"><summary class="event-card-action event-card-action--checkout">${escapeHtml(labels.reservePlace)}</summary><form method="post" action="${escapeHtml(eventPath(event, language))}/reserve">${quantityControl(event, labels, id)}<label>${escapeHtml(labels.attendeeName)}<input name="attendee_name" type="text" maxlength="200" autocomplete="name" required></label><label>${escapeHtml(labels.attendeeEmail)}<input name="contact_email" type="email" maxlength="320" autocomplete="email" required></label><button class="button button--primary" type="submit">${escapeHtml(labels.reservationSubmit)}</button></form></details>`;
  }
  const ticketLabel = event.access_type === "PUBLIC_FREE" ? labels.reservePlace : labels.buyTickets;
  return `<span class="event-card-action event-card-action--pending" aria-disabled="true"><span>${escapeHtml(ticketLabel)}</span><small>${escapeHtml(labels.ticketsSoon)}</small></span>`;
}

function renderPublicEventCard(event, language, index = 0, labels = resolveEventCopy(language)) {
  const excerpt = eventExcerpt(event);
  return `<article class="public-event-card" data-reveal data-event-index="${index + 1}">
    <a class="public-event-card__media" href="${escapeHtml(eventPath(event, language))}" aria-label="${escapeHtml(`${labels.details}: ${event.title}`)}">
      ${event.hero_image_url ? `<img src="${escapeHtml(event.hero_image_url)}" alt="${escapeHtml(event.hero_image_alt || event.title)}" loading="lazy" decoding="async">` : '<span class="public-event-card__ornament" aria-hidden="true">K</span>'}
      <span class="public-event-card__number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
    </a>
    <div class="public-event-card__body">
      <div class="public-event-card__heading"><p class="eyebrow">${escapeHtml(event.category)}</p><p class="public-event-card__date">${escapeHtml(formatEventDate(event.start_at, language))}</p></div>
      <h2 class="word-safe-title${titleLengthClass(event.title)}"><a href="${escapeHtml(eventPath(event, language))}">${escapeHtml(event.title)}</a></h2>
      <p class="public-event-card__artist">${escapeHtml(labels.artist)} · ${escapeHtml(event.performer_name || labels.artistPending)}</p>
      ${excerpt ? `<p class="public-event-card__excerpt">${escapeHtml(excerpt)}</p>` : ""}
      <div class="public-event-card__facts"><span>${escapeHtml(event.venue?.name || event.venue?.city || "Klavierhaus")}</span><span>${escapeHtml(formatEventPrice(event, language, labels))}</span><span>${Number(event.capacity_remaining || 0)} ${escapeHtml(labels.available)}</span></div>
      <div class="public-event-card__actions"><a class="button button--ghost" href="${escapeHtml(eventPath(event, language))}">${escapeHtml(labels.details)} <span aria-hidden="true">↗</span></a>${renderEventCardAction(event, language, labels)}</div>
    </div>
  </article>`;
}

function renderHomeEventShowcase(events, language, globalOverride = null) {
  const labels = resolveEventCopy(language, globalOverride);
  const cards = events.length
    ? events.slice(0, 30).map((event, index) => renderPublicEventCard(event, language, index, labels)).join("")
    : `<p class="event-empty-state">${escapeHtml(labels.noEvents)}</p>`;
  return `<section class="section home-event-showcase" id="upcoming-events">
    <div class="home-event-showcase__heading" data-reveal><div><p class="eyebrow">${escapeHtml(labels.homeEyebrow)}</p><h2>${escapeHtml(labels.homeTitle)}</h2></div><p>${escapeHtml(labels.homeLead)}</p></div>
    <div class="event-carousel" data-event-carousel><div class="public-event-grid public-event-grid--home">${cards}</div></div>
    <div class="event-carousel__controls" aria-label="${escapeHtml(language === "hu" ? "Események lapozása" : "Browse events")}"><button type="button" data-event-carousel-previous aria-label="${escapeHtml(language === "hu" ? "Előző események" : "Previous events")}">←</button><button type="button" data-event-carousel-next aria-label="${escapeHtml(language === "hu" ? "Következő események" : "Next events")}">→</button></div>
    <a class="home-event-showcase__all text-link" href="${escapeHtml(getRoute("events", language))}"><span>${escapeHtml(labels.viewAll)}</span><span aria-hidden="true">↗</span></a>
  </section>`;
}

function renderDynamicHead({ language, title, description, canonicalUrl, alternateUrl, imageUrl, robots, nonce, structuredData = [], globalCopyOverride = null }) {
  const copy = globalCopyOverride || getGlobal(language);
  const brand = resolveBrand(copy);
  const englishUrl = language === "en" ? canonicalUrl : alternateUrl;
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#080807">
  <meta name="robots" content="${escapeHtml(robots)}">
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(brand.name)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="alternate" hreflang="${language === "hu" ? "hu-HU" : "en-US"}" href="${escapeHtml(canonicalUrl)}">
  <link rel="alternate" hreflang="${language === "hu" ? "en-US" : "hu-HU"}" href="${escapeHtml(alternateUrl)}">
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(englishUrl)}">
  <link rel="icon" type="image/png" href="${escapeHtml(brand.logoImage)}">
  <link rel="stylesheet" href="/assets/styles.css?v=${VERSION}">
  <link rel="stylesheet" href="/assets/design-v3.css?v=${VERSION}">
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
    description: event.description || event.short_description,
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
  if (event.status !== "CANCELLED" && ["PUBLIC_PAID", "PUBLIC_FREE"].includes(event.access_type)) {
    data.offers = {
      "@type": "Offer",
      url,
      price: (Number(event.price_cents || 0) / 100).toFixed(2),
      priceCurrency: event.currency || "USD",
      availability: event.sold_out || event.status === "CANCELLED"
        ? "https://schema.org/SoldOut"
        : "https://schema.org/InStock",
      validFrom: event.sales_start_at || event.published_at || event.start_at
    };
  }
  return data;
}

function renderPublicEventList({ events, language, baseUrl, allowIndexing, nonce, pageOverride = null, globalOverride = null }) {
  const copy = globalOverride || getGlobal(language);
  const labels = resolveEventCopy(language, copy);
  const page = pageOverride || getPage("events", language);
  const canonicalRoute = getRoute("events", language);
  const alternateRoute = getRoute("events", getAlternateLanguage(language));
  const canonicalUrl = pageUrl(baseUrl, canonicalRoute);
  const cards = events.length ? events.map((event, index) => renderPublicEventCard(event, language, index, labels)).join("") : `<p class="event-empty-state">${escapeHtml(labels.noEvents)}</p>`;

  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({
    language,
    title: page?.seo?.title || `${labels.upcoming} | Klavierhaus`,
    description: page?.seo?.description || labels.listLead,
    canonicalUrl,
    alternateUrl: pageUrl(baseUrl, alternateRoute),
    imageUrl: pageUrl(baseUrl, page?.hero?.image || shared.salonImage),
    robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive",
    nonce,
    structuredData: [organizationStructuredData(baseUrl, copy)],
    globalCopyOverride: copy
  })}</head><body class="template-events" data-language="${escapeHtml(language)}" data-page="events">
  ${renderHeader({ copy, language, currentKey: "events" })}
  <main id="main-content">
    <section class="dynamic-event-hero"><div data-reveal><p class="eyebrow">${escapeHtml(page?.hero?.eyebrow || labels.listEyebrow)}</p><h1>${escapeHtml(page?.hero?.title || labels.listTitle)}</h1><p>${escapeHtml(page?.hero?.lead || labels.listLead)}</p></div></section>
    <section class="dynamic-event-list" aria-labelledby="programme-title"><div class="section-heading" data-reveal><p class="eyebrow">Klavierhaus</p><h2 id="programme-title">${escapeHtml(labels.upcoming)}</h2></div><div class="public-event-grid">${cards}</div></section>
  </main>${renderFooter(copy, language)}</body></html>`;
}

function renderPublicEventDetail({ event, language, baseUrl, allowIndexing, nonce, result = "", globalOverride = null }) {
  const copy = globalOverride || getGlobal(language);
  const labels = resolveEventCopy(language, copy);
  const canonicalPath = eventPath(event, language);
  const alternatePath = language === "hu" ? `/events/${event.alternate_slug}` : `/hu/esemenyek/${event.alternate_slug}`;
  const canonicalUrl = pageUrl(baseUrl, canonicalPath);
  const imageUrl = event.hero_image_url || pageUrl(baseUrl, shared.salonImage);
  const statusNotice = event.status === "CANCELLED" ? labels.cancelled : event.status === "RESCHEDULED" ? labels.rescheduled : "";
  const resultNotice = ({ success: labels.checkoutSuccess, cancelled: labels.checkoutCancelled, error: labels.checkoutError, reserved: labels.reservationSuccess })[result] || "";
  let ticketing = "";
  if (event.status !== "CANCELLED" && !event.sold_out && event.checkout_available) {
    ticketing = `<form class="event-order-form" method="post" action="${escapeHtml(canonicalPath)}/checkout">
      <span class="test-mode-badge">${escapeHtml(labels.testMode)}</span><p>${escapeHtml(labels.testModeNote)}</p>
      <label>${escapeHtml(labels.quantity)}<input name="quantity" type="number" inputmode="numeric" min="1" max="${escapeHtml(event.capacity_remaining)}" value="1" required></label>
      <button class="button button--primary" type="submit">${escapeHtml(labels.continueToCheckout)}</button>
    </form>`;
  } else if (event.status !== "CANCELLED" && !event.sold_out && event.reservation_available) {
    ticketing = `<form class="event-order-form" id="reservation" method="post" action="${escapeHtml(canonicalPath)}/reserve">
      <label>${escapeHtml(labels.attendeeName)}<input name="attendee_name" type="text" maxlength="200" autocomplete="name" required></label>
      <label>${escapeHtml(labels.attendeeEmail)}<input name="contact_email" type="email" maxlength="320" autocomplete="email" required></label>
      <label>${escapeHtml(labels.quantity)}<input name="quantity" type="number" inputmode="numeric" min="1" max="${escapeHtml(event.capacity_remaining)}" value="1" required></label>
      <button class="button button--primary" type="submit">${escapeHtml(labels.reservationSubmit)}</button>
    </form>`;
  } else if (event.status !== "CANCELLED") {
    ticketing = `<p class="event-ticketing-notice">${escapeHtml(event.sold_out ? labels.soldOut : labels.ticketingSoon)}</p>`;
  }
  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({
    language,
    title: `${event.title} | Klavierhaus`,
    description: event.description || event.short_description,
    canonicalUrl,
    alternateUrl: pageUrl(baseUrl, alternatePath),
    imageUrl,
    robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive",
    nonce,
    structuredData: [organizationStructuredData(baseUrl, copy), eventStructuredData(event, baseUrl, language)],
    globalCopyOverride: copy
  })}</head><body class="template-event-detail" data-language="${escapeHtml(language)}" data-page="events">
  ${renderHeader({ copy, language, currentKey: "events", alternateRouteOverride: alternatePath })}
  <main id="main-content">
    <article class="event-detail-page">
      <header class="event-detail-hero">
        ${event.hero_image_url ? `<img src="${escapeHtml(event.hero_image_url)}" alt="${escapeHtml(event.hero_image_alt || event.title)}" fetchpriority="high" decoding="async">` : ""}
        <div class="event-detail-hero__shade" aria-hidden="true"></div>
        <div class="event-detail-hero__copy" data-reveal><p class="eyebrow">${escapeHtml(event.category)}</p><h1>${escapeHtml(event.title)}</h1>${eventExcerpt(event,260)?`<p>${escapeHtml(eventExcerpt(event,260))}</p>`:""}</div>
      </header>
      <div class="event-detail-layout">
        <section class="event-detail-narrative" data-reveal>${resultNotice ? `<p class="event-public-status event-public-status--result">${escapeHtml(resultNotice)}</p>` : ""}${statusNotice ? `<p class="event-public-status">${escapeHtml(statusNotice)}</p>` : ""}${event.status === "CANCELLED" && event.cancellation_reason ? `<p><strong>${escapeHtml(labels.cancellationReason)}:</strong> ${escapeHtml(event.cancellation_reason)}</p>` : ""}${event.description?renderParagraphs(String(event.description).split(/\n+/).filter(Boolean)):""}</section>
        <aside class="event-facts" data-reveal>
          <dl>
            <div><dt>${escapeHtml(labels.date)}</dt><dd>${escapeHtml(formatEventDate(event.start_at, language))}</dd></div>
            ${event.performer_name ? `<div><dt>${escapeHtml(labels.artist)}</dt><dd>${escapeHtml(event.performer_name)}</dd></div>` : ""}
            <div><dt>${escapeHtml(labels.venue)}</dt><dd>${escapeHtml(eventVenue(event))}</dd></div>
            <div><dt>${escapeHtml(labels.capacity)}</dt><dd>${event.sold_out ? escapeHtml(labels.soldOut) : `${escapeHtml(event.capacity_remaining)} ${escapeHtml(labels.available)}`}</dd></div>
            <div><dt>${escapeHtml(labels.price)}</dt><dd>${escapeHtml(formatEventPrice(event, language, labels))}</dd></div>
          </dl>
          ${ticketing}
        </aside>
      </div>
    </article>
  </main>${renderFooter(copy, language)}</body></html>`;
}

function catalogStructuredData(item, kind, canonicalUrl) {
  if (kind === "piano") return {
    "@context": "https://schema.org", "@type": "Product", name: item.title, description: item.description || item.summary,
    image: [item.image_url], brand: item.brand ? { "@type": "Brand", name: item.brand } : undefined,
    model: item.model || undefined, url: canonicalUrl
  };
  return { "@context": "https://schema.org", "@type": "Service", name: item.title, description: item.description || item.summary, image: item.image_url, provider: { "@type": "Organization", name: "Klavierhaus" }, url: canonicalUrl };
}

function renderCatalogDetail({ item, kind, language, baseUrl, allowIndexing, nonce, globalOverride = null }) {
  const copy = globalOverride || getGlobal(language);
  const isPiano = kind === "piano";
  const currentPath = isPiano ? showroomPath(item, language) : servicePath(item, language);
  const alternatePath = isPiano ? showroomPath({ ...item, slug: item.alternate_slug }, getAlternateLanguage(language)) : servicePath({ ...item, slug: item.alternate_slug }, getAlternateLanguage(language));
  const canonicalUrl = pageUrl(baseUrl, currentPath);
  const ctaLabel = language === "hu" ? (isPiano ? "Privát megtekintés egyeztetése" : "Személyes felmérés egyeztetése") : (isPiano ? "Arrange a private viewing" : "Arrange a private assessment");
  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({ language, title: `${item.title} | Klavierhaus`, description: item.summary || item.description || item.title, canonicalUrl, alternateUrl: pageUrl(baseUrl, alternatePath), imageUrl: item.image_url, robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive", nonce, structuredData: [organizationStructuredData(baseUrl, copy), catalogStructuredData(item, kind, canonicalUrl)], globalCopyOverride: copy })}</head><body class="template-catalog-detail" data-language="${escapeHtml(language)}" data-page="${isPiano ? "pianos" : "services"}">${renderHeader({ copy, language, currentKey: isPiano ? "pianos" : "services", alternateRouteOverride: alternatePath })}<main id="main-content"><article class="catalog-detail"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.image_alt || item.title)}" fetchpriority="high" decoding="async"><div class="catalog-detail__copy" data-reveal><p class="eyebrow">${escapeHtml(isPiano ? [item.brand, item.model].filter(Boolean).join(" · ") : "Klavierhaus atelier")}</p><h1 class="word-safe-title${titleLengthClass(item.title)}">${escapeHtml(item.title)}</h1>${item.summary ? `<p class="catalog-detail__lead">${escapeHtml(item.summary)}</p>` : ""}${item.description ? renderParagraphs(String(item.description).split(/\n+/).filter(Boolean)) : ""}<a class="button button--primary" href="${escapeHtml(getRoute("consultation", language))}">${escapeHtml(ctaLabel)} <span aria-hidden="true">↗</span></a></div></article></main>${renderFooter(copy, language)}</body></html>`;
}

function renderInvitation({ invitation, token, language, baseUrl, nonce, result = "", error = "", globalOverride = null }) {
  const copy = globalOverride || getGlobal(language);
  const brand = resolveBrand(copy);
  const labels = resolveEventCopy(language, copy);
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
    structuredData: [],
    globalCopyOverride: copy
  })}</head><body class="template-invitation" data-language="${escapeHtml(language)}" data-page="events">
  ${renderHeader({ copy, language, currentKey: "events", alternateRouteOverride: alternatePath })}
  <main id="main-content" class="invitation-shell"><section class="invitation-card" data-reveal>
    <img src="${escapeHtml(brand.logoImage)}" alt="" width="160" height="166">
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
  <link rel="stylesheet" href="/assets/design-v3.css?v=${VERSION}">
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
  <script type="application/ld+json" nonce="${escapeHtml(nonce)}">${escapeJson(organizationStructuredData(baseUrl, copy))}</script>
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
    res.setHeader("Content-Security-Policy", `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'; font-src 'self'; form-action 'self' https://checkout.stripe.com mailto:`);
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
      const feeds = await Promise.allSettled([
        eventClient.list("en"), eventClient.list("hu"), eventClient.showroomPianos("en"), eventClient.showroomPianos("hu"), eventClient.services("en"), eventClient.services("hu")
      ]);
      const values = feeds.map((result) => result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []);
      dynamicRoutes.push(...values[0].map((event) => eventPath(event, "en")));
      dynamicRoutes.push(...values[1].map((event) => eventPath(event, "hu")));
      dynamicRoutes.push(...values[2].map((item) => showroomPath(item, "en")));
      dynamicRoutes.push(...values[3].map((item) => showroomPath(item, "hu")));
      dynamicRoutes.push(...values[4].map((item) => servicePath(item, "en")));
      dynamicRoutes.push(...values[5].map((item) => servicePath(item, "hu")));
    }
    const urls = [...new Set([...staticRoutes, ...dynamicRoutes])]
      .map((route) => `<url><loc>${escapeHtml(pageUrl(baseUrl, route))}</loc></url>`).join("");
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  app.get(["/events", "/hu/esemenyek"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const [events,content,globalContent] = await Promise.all([eventClient.list(language),eventClient.content("events",language).catch(() => null),eventClient.content("global",language).catch(() => null)]);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.type("html").send(renderPublicEventList({ events, language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, pageOverride: content?.content || null, globalOverride: globalContent?.content || null }));
    } catch (error) {
      console.warn(`[website] Event listing fallback: ${error.code || error.message}`);
      next();
    }
  });

  app.get(["/pianos/:slug", "/hu/zongorak/:slug"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const [item, globalContent] = await Promise.all([eventClient.showroomPiano(req.params.slug, language), eventClient.content("global", language).catch(() => null)]);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.type("html").send(renderCatalogDetail({ item, kind: "piano", language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, globalOverride: globalContent?.content || null }));
    } catch (error) { if (error.status === 404) return next(); next(error); }
  });

  app.get(["/services/:slug", "/hu/szolgaltatasok/:slug"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const [item, globalContent] = await Promise.all([eventClient.service(req.params.slug, language), eventClient.content("global", language).catch(() => null)]);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.type("html").send(renderCatalogDetail({ item, kind: "service", language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, globalOverride: globalContent?.content || null }));
    } catch (error) { if (error.status === 404) return next(); next(error); }
  });

  app.get(["/events/:slug", "/hu/esemenyek/:slug"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const [event,globalContent] = await Promise.all([eventClient.detail(req.params.slug, language),eventClient.content("global",language).catch(() => null)]);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      const result = ["success", "cancelled", "error", "reserved"].includes(String(req.query.checkout || req.query.reservation || ""))
        ? String(req.query.checkout || req.query.reservation)
        : "";
      res.type("html").send(renderPublicEventDetail({ event, language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, result, globalOverride: globalContent?.content || null }));
    } catch (error) {
      if (error.status === 404) return next();
      console.warn(`[website] Event detail unavailable: ${error.code || error.message}`);
      next();
    }
  });

  app.post(["/events/:slug/checkout", "/hu/esemenyek/:slug/checkout"], async (req, res) => {
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    const detailPath = language === "hu" ? `/hu/esemenyek/${encodeURIComponent(req.params.slug)}` : `/events/${encodeURIComponent(req.params.slug)}`;
    const quantity = Number(req.body?.quantity || 1);
    try {
      const checkout = await eventClient.createCheckout(req.params.slug, language, quantity);
      const target = new URL(String(checkout.checkout_url || ""));
      if (target.protocol !== "https:" || !/(^|\.)stripe\.com$/i.test(target.hostname)) throw new Error("INVALID_CHECKOUT_URL");
      res.redirect(303, target.toString());
    } catch (error) {
      console.warn(`[website] Stripe Sandbox checkout unavailable: ${error.code || error.message}`);
      res.redirect(303, `${detailPath}?checkout=error`);
    }
  });

  app.post(["/events/:slug/reserve", "/hu/esemenyek/:slug/reserve"], async (req, res) => {
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    const detailPath = language === "hu" ? `/hu/esemenyek/${encodeURIComponent(req.params.slug)}` : `/events/${encodeURIComponent(req.params.slug)}`;
    try {
      await eventClient.reserve(req.params.slug, language, {
        attendeeName: req.body?.attendee_name,
        contactEmail: req.body?.contact_email,
        quantity: Number(req.body?.quantity || 1)
      });
      res.redirect(303, `${detailPath}?reservation=reserved`);
    } catch (error) {
      console.warn(`[website] Complimentary reservation unavailable: ${error.code || error.message}`);
      res.redirect(303, `${detailPath}?reservation=error`);
    }
  });

  app.get(["/invitation/:token", "/hu/meghivas/:token"], async (req, res) => {
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const [invitation, globalContent] = await Promise.all([
        eventClient.invitation(req.params.token, language),
        eventClient.content("global", language).catch(() => null)
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      res.type("html").send(renderInvitation({ invitation, token: req.params.token, language, baseUrl, nonce: res.locals.cspNonce, globalOverride: globalContent?.content || null }));
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
      const [invitation, globalContent] = await Promise.all([
        eventClient.invitation(req.params.token, language),
        eventClient.content("global", language).catch(() => null)
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      res.type("html").send(renderInvitation({ invitation, token: req.params.token, language, baseUrl, nonce: res.locals.cspNonce, result: result.status, globalOverride: globalContent?.content || null }));
    } catch (error) {
      let invitation;
      try { invitation = await eventClient.invitation(req.params.token, language); } catch (_readError) { invitation = null; }
      if (!invitation) return res.status(error.status === 404 ? 404 : 503).type("html").send(renderNotFound({ language, baseUrl, allowIndexing: false, nonce: res.locals.cspNonce }));
      const labels = resolveEventCopy(language);
      const message = error.code === "EVENT_SOLD_OUT" ? labels.soldOut : error.code === "INVITATION_ALREADY_ANSWERED" ? labels.answered : labels.unavailable;
      res.status(error.status || 409).type("html").send(renderInvitation({ invitation, token: req.params.token, language, baseUrl, nonce: res.locals.cspNonce, error: message }));
    }
  });

  app.use(async (req, res) => {
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

    let homeEvents = [];
    let reviews = [];
    let showroomPianos = [];
    let websiteServices = [];
    let pageOverride = null;
    let globalOverride = null;
    if (eventClient.configured) {
      const requests = [
        eventClient.content(route.key, route.language),
        eventClient.content("global",route.language),
        route.key === "home" ? eventClient.list(route.language) : Promise.resolve([]),
        route.key === "home" ? eventClient.reviews(route.language) : Promise.resolve([]),
        ["home","pianos"].includes(route.key) ? eventClient.showroomPianos(route.language) : Promise.resolve([]),
        ["home","services"].includes(route.key) ? eventClient.services(route.language) : Promise.resolve([])
      ];
      const [contentResult,globalResult,eventResult,reviewResult,pianoResult,serviceResult] = await Promise.allSettled(requests);
      if (contentResult.status === "fulfilled") pageOverride = contentResult.value?.content || null;
      else console.warn(`[website] Page content fallback: ${contentResult.reason?.code || contentResult.reason?.message}`);
      if (globalResult.status === "fulfilled") globalOverride = globalResult.value?.content || null;
      if (eventResult.status === "fulfilled") homeEvents = eventResult.value;
      else if (route.key === "home") console.warn(`[website] Homepage event feed unavailable: ${eventResult.reason?.code || eventResult.reason?.message}`);
      if (reviewResult.status === "fulfilled") reviews = reviewResult.value;
      if (pianoResult.status === "fulfilled") showroomPianos = pianoResult.value;
      if (serviceResult.status === "fulfilled") websiteServices = serviceResult.value;
    }
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate, stale-while-revalidate=60");
    res.type("html").send(renderDocument({
      route,
      baseUrl,
      allowIndexing,
      nonce: res.locals.cspNonce,
      homeEvents,
      reviews,
      showroomPianos,
      websiteServices,
      pageOverride,
      globalOverride
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
