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

const FALLBACK_SEO_CONFIG = Object.freeze({
  enabled: true,
  global_keywords_en: ["Klavierhaus", "piano restoration", "piano tuning", "concert piano services", "piano showroom New York", "Steinway pianos New York", "Fazioli pianos New York", "intimate classical music events"],
  global_keywords_hu: ["Klavierhaus", "zongorafelújítás", "zongorahangolás", "koncertzongora szolgáltatás", "zongorabemutatóterem New York", "Steinway zongorák", "Fazioli zongorák", "bensőséges kulturális események"],
  page_keywords_en: {},
  page_keywords_hu: {}
});

function normalizedSeoKeywords(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  return source.map((item) => String(item || "").trim().replace(/\s+/g, " ").slice(0, 120)).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

function normalizedSeoConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalizePages = (input) => Object.fromEntries(Object.entries(input && typeof input === "object" ? input : {}).map(([key, keywords]) => [key, normalizedSeoKeywords(keywords)]));
  return {
    enabled: source.enabled !== false,
    global_keywords_en: normalizedSeoKeywords(source.global_keywords_en || FALLBACK_SEO_CONFIG.global_keywords_en),
    global_keywords_hu: normalizedSeoKeywords(source.global_keywords_hu || FALLBACK_SEO_CONFIG.global_keywords_hu),
    page_keywords_en: normalizePages(source.page_keywords_en),
    page_keywords_hu: normalizePages(source.page_keywords_hu)
  };
}

function derivedSeoKeywords(values, language) {
  const stopWords = new Set(language === "hu"
    ? ["a", "az", "és", "egy", "vagy", "hogy", "nem", "mint", "is", "azt", "aki", "ami", "ez", "ezek", "meg", "fel", "al", "new", "york"]
    : ["the", "and", "for", "with", "from", "that", "this", "are", "our", "your", "into", "only", "not", "new", "york"]);
  const counts = new Map();
  values.filter(Boolean).join(" ").toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu)?.forEach((word) => {
    if (stopWords.has(word) || word.length < 4) return;
    counts.set(word, (counts.get(word) || 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 12).map(([word]) => word);
}

function seoKeywords({ seoConfig, key, language, page = null, title = "", description = "" }) {
  const config = normalizedSeoConfig(seoConfig);
  if (!config.enabled) return [];
  const pageKeywords = language === "hu" ? config.page_keywords_hu?.[key] : config.page_keywords_en?.[key];
  const configured = [...(language === "hu" ? config.global_keywords_hu : config.global_keywords_en), ...(Array.isArray(pageKeywords) ? pageKeywords : [])];
  const sectionText = Array.isArray(page?.sections) ? page.sections.flatMap((section) => [section?.title, section?.intro, ...(Array.isArray(section?.body) ? section.body : [section?.body])]) : [];
  return normalizedSeoKeywords([...configured, ...derivedSeoKeywords([title, description, page?.hero?.title, page?.hero?.lead, ...sectionText], language)]).slice(0, 32);
}

function webPageStructuredData({ title, description, canonicalUrl, keywords = [] }) {
  return { "@context": "https://schema.org", "@type": "WebPage", name: title, description, url: canonicalUrl, ...(keywords.length ? { keywords } : {}) };
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
  if (link.key === "consultation") return `<button class="${escapeHtml(className)}" type="button" data-private-viewing-open><span>${escapeHtml(link.label)}</span><span aria-hidden="true">↗</span></button>`;
  return `<a class="${className}" href="${escapeHtml(getRoute(link.key, language))}">
    <span>${escapeHtml(link.label)}</span>
    <span aria-hidden="true">↗</span>
  </a>`;
}

function renderButton(link, language, variant = "primary") {
  if (!link || !link.label || !link.key) return "";
  if (link.key === "consultation") return `<button class="button button--${escapeHtml(variant)}" type="button" data-private-viewing-open><span>${escapeHtml(link.label)}</span><span class="button-arrow" aria-hidden="true">↗</span></button>`;
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
        <button class="header-consultation" type="button" data-private-viewing-open>${escapeHtml(copy.consultationLabel)} <span aria-hidden="true">↗</span></button>
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
  const items = section.items.map((item) => `<article class="luxury-card" data-reveal>
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

function renderGallery(items, label) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<section class="detail-gallery" aria-label="${escapeHtml(label)}">${items.map((item) => `<figure><img data-gallery-image src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || label)}" loading="lazy" decoding="async"></figure>`).join("")}</section>`;
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
        <button class="footer-privacy-button" type="button" data-privacy-settings>${escapeHtml(language === "hu" ? "Követési beállítások" : "Tracking settings")}</button>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© <span data-current-year></span> ${escapeHtml(brand.name)}. ${escapeHtml(copy.rights)}</span>
      <span>${escapeHtml(brand.footerLocations)}</span>
    </div>
  </footer>${renderPrivacyControls(language)}`;
}

function renderPrivacyControls(language) {
  const hu = language === "hu";
  return `<section class="consent-banner" data-consent-banner hidden aria-labelledby="consent-title"><div><p class="eyebrow">${hu ? "Adatvédelem" : "Privacy"}</p><h2 id="consent-title">${hu ? "Ön dönt a mérésről." : "You decide about measurement."}</h2><p>${hu ? "A szükséges tárolás mindig aktív. Analitikai és marketingmérés csak az Ön hozzájárulása után indul." : "Essential storage is always active. Analytics and marketing measurement starts only after your consent."}</p></div><div class="consent-actions"><button class="button button--ghost" type="button" data-consent-essential>${hu ? "Csak szükséges" : "Essential only"}</button><button class="button button--primary" type="button" data-consent-all>${hu ? "Mind elfogadom" : "Accept all"}</button><button class="text-link" type="button" data-consent-settings>${hu ? "Beállítások" : "Settings"}</button></div></section>
  <dialog class="privacy-dialog" data-consent-dialog><form method="dialog"><button type="button" class="dialog-close" value="cancel" aria-label="${hu ? "Bezárás" : "Close"}">×</button><p class="eyebrow">${hu ? "Követési beállítások" : "Tracking settings"}</p><h2>${hu ? "Adatvédelmi választás" : "Privacy choices"}</h2><label><input type="checkbox" checked disabled> ${hu ? "Szükséges működés" : "Essential functionality"}</label><label><input type="checkbox" data-consent-analytics> ${hu ? "Analitika" : "Analytics"}</label><label><input type="checkbox" data-consent-marketing> ${hu ? "Marketing" : "Marketing"}</label><button class="button button--primary" value="save" data-consent-save>${hu ? "Választás mentése" : "Save choices"}</button></form></dialog>
  <dialog class="interest-dialog" data-interest-dialog><form method="dialog" data-interest-form><button type="button" class="dialog-close" value="cancel" aria-label="${hu ? "Bezárás" : "Close"}">×</button><p class="eyebrow">Klavierhaus</p><h2>${hu ? "Értesítsen a következő alkalomról" : "Notify me about the next edition"}</h2><p data-interest-title></p><input type="hidden" name="event_id"><label>${hu ? "E-mail-cím" : "Email address"}<input type="email" name="email" maxlength="320" autocomplete="email" required></label><label class="checkbox-row"><input type="checkbox" name="notify_event" required> ${hu ? "Kérek értesítést ennek az eseménynek az új időpontjáról." : "Notify me when this event returns."}</label><label class="checkbox-row"><input type="checkbox" name="marketing_consent"> ${hu ? "Külön hozzájárulok általános kulturális hírekhez is." : "I separately consent to general cultural news."}</label><button class="button button--primary" type="submit">${hu ? "Értesítést kérek" : "Keep me informed"}</button><p class="form-result" data-interest-result aria-live="polite"></p></form></dialog>`;
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

function renderReviewShowcase(reviews, language, fallbackSection = null, globalOverride = null) {
  const labels = (globalOverride || getGlobal(language)).collectionLabels || {};
  const items = reviews.length ? reviews : (fallbackSection ? [{ person_name: fallbackSection.attribution, quote: fallbackSection.quote, role: "", image_url: shared.artistSalonImage, image_alt: fallbackSection.attribution }] : []);
  if (!items.length) return "";
  const cards = items.map((review, index) => `<article class="review-card" data-review-card data-reveal>
    <img src="${escapeHtml(review.image_url || shared.artistSalonImage)}" alt="${escapeHtml(review.image_alt || review.person_name || "Klavierhaus guest")}" loading="lazy" decoding="async">
    <div><span class="review-card__quote" aria-hidden="true">“</span><blockquote>${escapeHtml(review.quote || "")}</blockquote><p><strong>${escapeHtml(review.person_name || "")}</strong>${review.role ? `<span>${escapeHtml(review.role)}</span>` : ""}</p></div>
    <span class="review-card__number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
  </article>`).join("");
  return `<section class="section review-showcase" id="reviews"><div class="collection-heading"><p class="eyebrow">${escapeHtml(labels.reviewsEyebrow || (language === "hu" ? "Vélemények" : "Reflections"))}</p><h2>${escapeHtml(labels.reviewsTitle || (language === "hu" ? "A zene emléke tovább él." : "The memory of music remains."))}</h2></div><div class="review-carousel" data-review-carousel><div class="review-track">${cards}</div><div class="review-controls"><button type="button" data-review-previous aria-label="${escapeHtml(language === "hu" ? "Előző vélemény" : "Previous review")}">←</button><div class="review-dots" data-review-dots></div><button type="button" data-review-next aria-label="${escapeHtml(language === "hu" ? "Következő vélemény" : "Next review")}">→</button></div></div></section>`;
}

function showroomPath(item, language) {
  return language === "hu" ? `/hu/zongorak/${item.slug}` : `/pianos/${item.slug}`;
}

const pianoBrands = Object.freeze([
  { slug: "steinway", label: "Steinway & Sons", matches: (value) => /^steinway/i.test(value) },
  { slug: "fazioli", label: "Fazioli", matches: (value) => /^fazioli/i.test(value) },
  { slug: "bosendorfer", label: "Bösendorfer", matches: (value) => /^(bösendorfer|bosendorfer)/i.test(value) }
]);

function pianoBrandPath(brand, language) {
  return language === "hu" ? `/hu/zongorak/${brand.slug}` : `/pianos/${brand.slug}`;
}

function resolvePianoBrand(value) {
  const source = String(value || "").trim();
  return pianoBrands.find((brand) => brand.matches(source)) || null;
}

function servicePath(item, language) {
  return language === "hu" ? `/hu/szolgaltatasok/${item.slug}` : `/services/${item.slug}`;
}

function artistPath(item, language) {
  return language === "hu" ? `/hu/muveszek/${item.slug}` : `/artists/${item.slug}`;
}

function renderArtistCollection(items, language, options = {}) {
  if (!items.length) return "";
  const labels = (options.copy || getGlobal(language)).collectionLabels || {};
  const cards = items.map((item) => `<article class="catalog-card artist-profile-card" data-reveal><a class="catalog-card__image" href="${escapeHtml(artistPath(item, language))}"><img src="${escapeHtml(item.portrait_url)}" alt="${escapeHtml(item.portrait_alt || item.name)}" loading="lazy" decoding="async"></a><div class="catalog-card__body"><p class="eyebrow">${escapeHtml(item.role || labels.artistFallbackRole || (language === "hu" ? "Művész" : "Artist"))}</p><h3 class="word-safe-title"><a href="${escapeHtml(artistPath(item, language))}">${escapeHtml(item.name)}</a></h3>${item.biography ? `<p>${escapeHtml(String(item.biography).replace(/\s+/g, " ").slice(0, 150))}${String(item.biography).length > 150 ? "…" : ""}</p>` : ""}<a class="button button--ghost" href="${escapeHtml(artistPath(item, language))}"><span>${escapeHtml(labels.artistProfile || (language === "hu" ? "Művészprofil" : "Artist profile"))}</span><span class="button-arrow" aria-hidden="true">↗</span></a></div></article>`).join("");
  return `<section class="section artist-collection${options.compact ? " artist-collection--home" : ""}" id="artist-directory"><div class="collection-heading"><p class="eyebrow">${escapeHtml(labels.artistsEyebrow || (language === "hu" ? "Művészeink" : "Our artists"))}</p><h2>${escapeHtml(labels.artistsTitle || (language === "hu" ? "Akik lélegzetet adnak a hangszernek." : "The people who give the instrument breath."))}</h2></div><div class="artist-profile-grid">${cards}</div></section>`;
}

function renderShowroomCollection(items, language, options = {}) {
  if (!items.length) return "";
  const compact = Boolean(options.compact);
  const labels = (options.copy || getGlobal(language)).collectionLabels || {};
  const grouped = pianoBrands.map((brand) => ({ brand, items: items.filter((item) => brand.matches(item.brand)) })).filter((entry) => entry.items.length);
  const cards = grouped.map(({ brand, items: brandItems }) => {
    const item = brandItems[0];
    const path = pianoBrandPath(brand, language);
    return `<article class="catalog-card piano-brand-card" data-reveal>
      <a class="catalog-card__image" href="${escapeHtml(path)}"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.image_alt || item.title)}" loading="lazy" decoding="async"></a>
      <div class="catalog-card__body"><p class="eyebrow">${escapeHtml(labels.showroomCardEyebrow || "Klavierhaus showroom")}</p><h3 class="word-safe-title"><a href="${escapeHtml(path)}">${escapeHtml(brand.label)}</a></h3><p>${escapeHtml(`${brandItems.length} ${brandItems.length === 1 ? labels.showroomInstrumentSingular : labels.showroomInstrumentPlural}`)}</p><a class="button button--ghost" href="${escapeHtml(path)}"><span>${escapeHtml(labels.showroomDiscover || (language === "hu" ? "A hangszerek felfedezése" : "Discover the instruments"))}</span><span class="button-arrow" aria-hidden="true">↗</span></a></div>
    </article>`;
  }).join("");
  return `<section class="section catalog-showcase${compact ? " catalog-showcase--home" : ""}" id="showroom-pianos"><div class="collection-heading"><p class="eyebrow">${escapeHtml(labels.showroomEyebrow || (language === "hu" ? "Bemutatótermi zongorák" : "The showroom"))}</p><h2>${escapeHtml(labels.showroomTitle || (language === "hu" ? "Kivételes hangszerek, személyes találkozásra." : "Exceptional instruments, encountered in person."))}</h2><p>${escapeHtml(labels.showroomLead || (language === "hu" ? "Egy zongora valódi karaktere csak a hangján és az érintésén keresztül ismerhető meg." : "A piano's true character is known only through tone, touch, and time in the room."))}</p></div><div class="catalog-grid">${cards}</div></section>`;
}

function renderServiceCollection(items, language, options = {}) {
  if (!items.length) return "";
  const labels = (options.copy || getGlobal(language)).collectionLabels || {};
  const cards = items.map((item) => `<article class="catalog-card service-catalog-card" data-reveal data-service-card tabindex="0" role="button" aria-label="${escapeHtml(item.title)}">
    <a class="catalog-card__image" href="${escapeHtml(servicePath(item, language))}"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.image_alt || item.title)}" loading="lazy" decoding="async"></a>
    <div class="catalog-card__body"><p class="eyebrow">${escapeHtml(labels.serviceCardEyebrow || "Klavierhaus atelier")}</p><h3 class="word-safe-title">${escapeHtml(item.title)}</h3>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}<button class="button button--ghost" type="button" data-service-request data-service-id="${escapeHtml(item.id)}" data-service-title="${escapeHtml(item.title)}" data-service-image="${escapeHtml(item.image_url || "")}"><span>${escapeHtml(labels.serviceAssessment || (language === "hu" ? "Személyes felmérés egyeztetése" : "Arrange a private assessment"))}</span><span class="button-arrow" aria-hidden="true">↗</span></button></div>
  </article>`).join("");
  const hu = language === "hu";
  return `<section class="section catalog-showcase${options.compact ? " catalog-showcase--home" : ""}" id="bespoke-services"><div class="collection-heading"><p class="eyebrow">${escapeHtml(labels.servicesEyebrow || (hu ? "Személyre szabott gondoskodás" : "Bespoke care"))}</p><h2>${escapeHtml(labels.servicesTitle || (hu ? "Minden hangszerhez külön figyelem tartozik." : "Every instrument deserves individual attention."))}</h2><p>${escapeHtml(labels.servicesLead || (hu ? "Díjmentes első felmérés, személyes konzultáció és a hangszerhez igazított egyedi ajánlat." : "A private initial assessment, considered consultation, and a proposal shaped around the individual instrument."))}</p></div><div class="catalog-grid">${cards}</div></section><dialog class="service-dialog" data-service-dialog aria-labelledby="service-dialog-title"><form method="dialog" data-service-form><button type="button" class="dialog-close" value="cancel" aria-label="${hu ? "Bezárás" : "Close"}">×</button><img class="service-dialog__image" data-service-image alt=""><p class="eyebrow">${escapeHtml(labels.serviceCardEyebrow || "Klavierhaus atelier")}</p><h2 id="service-dialog-title">${hu ? "Személyes konzultáció" : "Private consultation"}</h2><p data-service-title></p><input type="hidden" name="service_id"><div class="service-form-grid"><label>${hu ? "Név" : "Name"}<input name="name" maxlength="200" autocomplete="name" required></label><label>${hu ? "E-mail-cím" : "Email"}<input name="email" type="email" maxlength="320" autocomplete="email" required></label><label>${hu ? "Telefonszám" : "Phone"}<input name="phone" maxlength="80" autocomplete="tel" required></label><label>${hu ? "Kapcsolatfelvétel ideje" : "Preferred time to contact"}<input name="preferred_time" maxlength="240" required></label><label>${hu ? "Zongora márkája" : "Piano brand"}<input name="piano_brand" maxlength="160"></label><label>${hu ? "Zongora modellje" : "Piano model"}<input name="piano_model" maxlength="160"></label><label class="service-field-wide">${hu ? "Helyszín / cím" : "Service address"}<input name="service_address" maxlength="1000" autocomplete="street-address" required></label><label data-concert-field>${hu ? "Rendezvény dátuma" : "Event date"}<input name="event_date" type="date"></label><label data-concert-field>${hu ? "Rendezvény helyszíne" : "Event venue"}<input name="event_venue" maxlength="1000"></label><label data-concert-field>${hu ? "Bérlés időtartama" : "Rental duration"}<input name="rental_duration" maxlength="240"></label><label class="service-field-wide" data-concert-field>${hu ? "Hangszerigény" : "Instrument requirements"}<textarea name="instrument_requirements" maxlength="3000" rows="3"></textarea></label><label class="service-field-wide">${hu ? "A zongora állapota és a kérés részletei" : "Piano condition and enquiry details"}<textarea name="message" maxlength="5000" rows="4"></textarea></label><label>${hu ? "Kapcsolattartás módja" : "Preferred contact"}<select name="preferred_contact"><option value="EMAIL">Email</option><option value="PHONE">${hu ? "Telefon" : "Phone"}</option><option value="EITHER">${hu ? "Bármelyik" : "Either"}</option></select></label></div><label class="checkbox-row"><input name="consent_contact" type="checkbox" required> ${hu ? "Hozzájárulok, hogy a megkeresésemmel kapcsolatban felvegyék velem a kapcsolatot." : "I consent to being contacted about this enquiry."}</label><label class="checkbox-row"><input name="consent_marketing" type="checkbox"> ${hu ? "Külön hozzájárulok kulturális hírekhez." : "I separately consent to cultural news."}</label><button class="button button--primary" type="submit">${hu ? "Visszahívást kérek" : "Request a callback"}</button><p class="form-result" data-service-result aria-live="polite"></p></form></dialog>`;
}

function renderPrivateViewingDialog(language) {
  const hu = language === "hu";
  return `<dialog class="service-dialog" data-private-viewing-dialog aria-labelledby="private-viewing-title"><form method="dialog" data-private-viewing-form><button type="button" class="dialog-close" value="cancel" aria-label="${hu ? "Bezárás" : "Close"}">×</button><p class="eyebrow">Klavierhaus</p><h2 id="private-viewing-title">${hu ? "Privát megtekintés egyeztetése" : "Arrange a private viewing"}</h2><p data-private-viewing-context></p><input type="hidden" name="service_id"><div class="service-form-grid"><label>${hu ? "Név" : "Name"}<input name="name" maxlength="200" autocomplete="name" required></label><label>${hu ? "E-mail-cím" : "Email"}<input name="email" type="email" maxlength="320" autocomplete="email" required></label><label>${hu ? "Telefonszám" : "Phone"}<input name="phone" maxlength="80" autocomplete="tel" required></label><label>${hu ? "Kapcsolatfelvétel ideje" : "Preferred time to contact"}<input name="preferred_time" maxlength="240" required></label><label>${hu ? "Zongora márkája" : "Piano brand"}<input name="piano_brand" maxlength="160"></label><label>${hu ? "Zongora modellje" : "Piano model"}<input name="piano_model" maxlength="160"></label><label class="service-field-wide">${hu ? "Helyszín / cím" : "Address"}<input name="service_address" maxlength="1000" autocomplete="street-address" required></label><label class="service-field-wide">${hu ? "Megjegyzés" : "Message"}<textarea name="message" maxlength="5000" rows="4"></textarea></label></div><label class="checkbox-row"><input name="consent_contact" type="checkbox" required> ${hu ? "Hozzájárulok, hogy felvegyék velem a kapcsolatot." : "I consent to being contacted about this enquiry."}</label><button class="button button--primary" type="submit">${hu ? "Időpontot kérek" : "Request an appointment"}</button><p class="form-result" data-private-viewing-result aria-live="polite"></p></form></dialog>`;
}

function renderDocument({ route, baseUrl, allowIndexing, nonce, homeEvents = [], reviews = [], showroomPianos = [], websiteServices = [], artists = [], pageOverride = null, globalOverride = null, seoConfig = null }) {
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
  const pageTitle = page.seo?.title || `${page.hero?.title || key} | Klavierhaus`;
  const pageDescription = page.seo?.description || page.hero?.lead || "Klavierhaus";
  const keywords = seoKeywords({ seoConfig, key, language, page, title: pageTitle, description: pageDescription });
  const testimonial = page.sections.find((section) => section.id === "testimonial") || null;
  const sections = page.sections.filter((section) => {
    if (key === "home" && ["salon", "testimonial"].includes(section.id)) return false;
    if (key === "pianos" && showroomPianos.length && ["selection", "inventory"].includes(section.id)) return false;
    if (key === "services" && websiteServices.length && section.id === "services") return false;
    if (key === "artists" && artists.length && section.id === "artist-directory") return false;
    return true;
  }).map((section) => {
    if (key === "home" && section.id === "manifesto") return `${renderSection(section, language)}${renderHomeEventShowcase(homeEvents, language, copy)}${renderReviewShowcase(reviews, language, testimonial, copy)}`;
    if (key === "home" && section.id === "pianos" && showroomPianos.length) return renderShowroomCollection(showroomPianos, language, { compact: true, copy });
    if (key === "home" && section.id === "craft" && websiteServices.length) return renderServiceCollection(websiteServices, language, { compact: true, copy });
    if (key === "home" && section.id === "artists" && artists.length) return renderArtistCollection(artists, language, { compact: true, copy });
    return renderSection(section, language);
  }).join("") + (key === "pianos" ? renderShowroomCollection(showroomPianos, language, { copy }) : "") + (key === "services" ? renderServiceCollection(websiteServices, language, { copy }) : "") + (key === "artists" ? renderArtistCollection(artists, language, { copy }) : "");

  return `<!doctype html>
<html lang="${escapeHtml(copy.locale)}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#080807">
  <meta name="robots" content="${robots}">
  <meta name="description" content="${escapeHtml(pageDescription)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(resolveBrand(copy).name)}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(pageDescription)}">
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
  <script type="application/ld+json" nonce="${escapeHtml(nonce)}">${escapeJson(webPageStructuredData({ title: pageTitle, description: pageDescription, canonicalUrl, keywords }))}</script>
  <title>${escapeHtml(pageTitle)}</title>
</head>
<body class="template-${escapeHtml(page.template)}" data-language="${escapeHtml(language)}" data-page="${escapeHtml(key)}">
  ${renderHeader({ copy, language, currentKey: key })}
  <main id="main-content">
    ${renderHero(page, language, copy)}
    <div class="content-shell">${sections}</div>
  </main>
  ${renderFooter(copy, language)}
  ${renderPrivateViewingDialog(language)}
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
    noEvents: "No upcoming event is currently published.",
    details: "View details",
    viewAll: "View all events",
    buyTickets: "Buy tickets",
    reservePlace: "Reserve a place",
    ticketsSoon: "Ticketing unavailable",
    testMode: "TEST MODE",
    testModeNote: "Stripe Sandbox checkout. No real charge will be made.",
    quantity: "Number of tickets",
    total: "Total",
    decreaseQuantity: "Remove one ticket",
    increaseQuantity: "Add one ticket",
    artistPending: "Artist details pending",
    attendeeName: "Full name",
    attendeeNames: "Guest names",
    guestNumber: "Guest",
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
    repeatEvent: "I’d like this event to return",
    price: "Admission",
    complimentary: "Complimentary",
    ticketingSoon: "Ticketing is currently unavailable for this event. No reservation has been created.",
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
    noEvents: "Jelenleg nincs közzétett közelgő esemény.",
    details: "Részletek",
    viewAll: "Összes esemény",
    buyTickets: "Jegyvásárlás",
    reservePlace: "Helyfoglalás",
    ticketsSoon: "A jegyvásárlás nem érhető el",
    testMode: "TESZTÜZEM",
    testModeNote: "Stripe Sandbox fizetés. Valódi terhelés nem történik.",
    quantity: "Jegyek száma",
    total: "Összesen",
    decreaseQuantity: "Egy jegy eltávolítása",
    increaseQuantity: "Egy jegy hozzáadása",
    artistPending: "A művész adatai még nem érhetők el",
    attendeeName: "Teljes név",
    attendeeNames: "Vendégek neve",
    guestNumber: "Vendég",
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
    repeatEvent: "Szeretném újra ezt az eseményt",
    price: "Belépőjegy",
    complimentary: "Díjmentes",
    ticketingSoon: "Ehhez az eseményhez jelenleg nem érhető el jegyvásárlás. Helyfoglalás nem történt.",
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

function attendeeNameFields(labels) {
  return `<fieldset class="attendee-names" data-attendee-names data-attendee-label="${escapeHtml(labels.guestNumber)}"><legend>${escapeHtml(labels.attendeeNames)}</legend><label><span>${escapeHtml(labels.guestNumber)} 1</span><input name="attendee_names" type="text" maxlength="200" autocomplete="name" required></label></fieldset>`;
}

function renderEventCardAction(event, language, labels = resolveEventCopy(language)) {
  if (event.status === "CANCELLED") {
    return `<span class="event-card-action event-card-action--cancelled" aria-disabled="true">${escapeHtml(labels.cancelled)}</span>`;
  }
  if (event.repeat_interest_available) {
    return `<button class="event-card-action event-card-action--interest" type="button" data-interest-open data-event-id="${escapeHtml(event.id)}" data-event-title="${escapeHtml(event.title)}"><span>${escapeHtml(labels.soldOut)}</span><small>${escapeHtml(labels.repeatEvent)}</small></button>`;
  }
  if (event.checkout_available) {
    const id = `${language}-paid-${String(event.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
    return `<form class="event-card-checkout" method="post" action="${escapeHtml(eventPath(event, language))}/checkout">
      ${quantityControl(event, labels, id)}
      ${attendeeNameFields(labels)}
      <button class="event-card-action event-card-action--checkout" type="submit"><span>${escapeHtml(labels.buyTickets)}</span><small>${escapeHtml(labels.testMode)}</small></button>
    </form>`;
  }
  if (event.reservation_available) {
    const id = `${language}-free-${String(event.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
    return `<details class="event-card-reservation"><summary class="event-card-action event-card-action--checkout">${escapeHtml(labels.reservePlace)}</summary><form method="post" action="${escapeHtml(eventPath(event, language))}/reserve">${quantityControl(event, labels, id)}${attendeeNameFields(labels)}<label>${escapeHtml(labels.attendeeEmail)}<input name="contact_email" type="email" maxlength="320" autocomplete="email" required></label><button class="button button--primary" type="submit">${escapeHtml(labels.reservationSubmit)}</button></form></details>`;
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

function renderDynamicHead({ language, title, description, canonicalUrl, alternateUrl, imageUrl, robots, nonce, structuredData = [], globalCopyOverride = null, keywords = [] }) {
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
  ${[...structuredData, ...(keywords.length ? [webPageStructuredData({ title, description, canonicalUrl, keywords })] : [])].map((item) => `<script type="application/ld+json" nonce="${escapeHtml(nonce)}">${escapeJson(item)}</script>`).join("\n  ")}
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

function renderPublicEventList({ events, language, baseUrl, allowIndexing, nonce, pageOverride = null, globalOverride = null, seoConfig = null }) {
  const copy = globalOverride || getGlobal(language);
  const labels = resolveEventCopy(language, copy);
  const page = pageOverride || getPage("events", language);
  const canonicalRoute = getRoute("events", language);
  const alternateRoute = getRoute("events", getAlternateLanguage(language));
  const canonicalUrl = pageUrl(baseUrl, canonicalRoute);
  const title = page?.seo?.title || `${labels.upcoming} | Klavierhaus`;
  const description = page?.seo?.description || labels.listLead;
  const keywords = seoKeywords({ seoConfig, key: "events", language, page, title, description });
  const cards = events.length ? events.map((event, index) => renderPublicEventCard(event, language, index, labels)).join("") : `<p class="event-empty-state">${escapeHtml(labels.noEvents)}</p>`;

  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({
    language,
    title,
    description,
    canonicalUrl,
    alternateUrl: pageUrl(baseUrl, alternateRoute),
    imageUrl: pageUrl(baseUrl, page?.hero?.image || shared.salonImage),
    robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive",
    nonce,
    structuredData: [organizationStructuredData(baseUrl, copy)],
    globalCopyOverride: copy,
    keywords
  })}</head><body class="template-events" data-language="${escapeHtml(language)}" data-page="events">
  ${renderHeader({ copy, language, currentKey: "events" })}
  <main id="main-content">
    <section class="hero hero--inner hero--with-image" aria-labelledby="page-title">${renderPicture(page?.hero?.image || shared.salonImage, page?.hero?.imageAlt || page?.hero?.title || labels.listTitle, "hero-media", { eager: true })}<div class="hero-shade" aria-hidden="true"></div><div class="hero-content" data-reveal><p class="eyebrow">${escapeHtml(page?.hero?.eyebrow || labels.listEyebrow)}</p><h1 id="page-title">${escapeHtml(page?.hero?.title || labels.listTitle)}</h1><p class="hero-lead">${escapeHtml(page?.hero?.lead || labels.listLead)}</p></div></section>
    <section class="dynamic-event-list" aria-labelledby="programme-title"><div class="section-heading" data-reveal><p class="eyebrow">Klavierhaus</p><h2 id="programme-title">${escapeHtml(labels.upcoming)}</h2></div><div class="public-event-grid">${cards}</div></section>
  </main>${renderFooter(copy, language)}${renderPrivateViewingDialog(language)}</body></html>`;
}

function renderPublicEventDetail({ event, language, baseUrl, allowIndexing, nonce, result = "", globalOverride = null, seoConfig = null }) {
  const copy = globalOverride || getGlobal(language);
  const labels = resolveEventCopy(language, copy);
  const canonicalPath = eventPath(event, language);
  const alternatePath = language === "hu" ? `/events/${event.alternate_slug}` : `/hu/esemenyek/${event.alternate_slug}`;
  const canonicalUrl = pageUrl(baseUrl, canonicalPath);
  const imageUrl = event.hero_image_url || pageUrl(baseUrl, shared.salonImage);
  const title = `${event.title} | Klavierhaus`;
  const description = event.description || event.short_description;
  const keywords = seoKeywords({ seoConfig, key: "events", language, title, description });
  const statusNotice = event.status === "CANCELLED" ? labels.cancelled : event.status === "RESCHEDULED" ? labels.rescheduled : "";
  const resultNotice = ({ success: labels.checkoutSuccess, cancelled: labels.checkoutCancelled, error: labels.checkoutError, reserved: labels.reservationSuccess })[result] || "";
  let ticketing = "";
  if (event.status !== "CANCELLED" && !event.sold_out && event.checkout_available) {
    const id = `${language}-detail-paid-${String(event.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
    ticketing = `<form class="event-order-form" method="post" action="${escapeHtml(canonicalPath)}/checkout">
      <span class="test-mode-badge">${escapeHtml(labels.testMode)}</span><p>${escapeHtml(labels.testModeNote)}</p>
      ${quantityControl(event, labels, id)}${attendeeNameFields(labels)}
      <button class="button button--primary" type="submit">${escapeHtml(labels.continueToCheckout)}</button>
    </form>`;
  } else if (event.status !== "CANCELLED" && !event.sold_out && event.reservation_available) {
    const id = `${language}-detail-free-${String(event.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
    ticketing = `<form class="event-order-form" id="reservation" method="post" action="${escapeHtml(canonicalPath)}/reserve">
      ${quantityControl(event, labels, id)}${attendeeNameFields(labels)}
      <label>${escapeHtml(labels.attendeeEmail)}<input name="contact_email" type="email" maxlength="320" autocomplete="email" required></label>
      <button class="button button--primary" type="submit">${escapeHtml(labels.reservationSubmit)}</button>
    </form>`;
  } else if (event.status !== "CANCELLED") {
    ticketing = event.repeat_interest_available
      ? `<div class="event-ticketing-notice event-sold-out"><strong>${escapeHtml(labels.soldOut)}</strong><button class="button button--ghost" type="button" data-interest-open data-event-id="${escapeHtml(event.id)}" data-event-title="${escapeHtml(event.title)}">${escapeHtml(labels.repeatEvent)}</button></div>`
      : `<p class="event-ticketing-notice">${escapeHtml(labels.ticketingSoon)}</p>`;
  }
  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({
    language,
    title,
    description,
    canonicalUrl,
    alternateUrl: pageUrl(baseUrl, alternatePath),
    imageUrl,
    robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive",
    nonce,
    structuredData: [organizationStructuredData(baseUrl, copy), eventStructuredData(event, baseUrl, language)],
    globalCopyOverride: copy,
    keywords
  })}</head><body class="template-event-detail" data-language="${escapeHtml(language)}" data-page="events">
  ${renderHeader({ copy, language, currentKey: "events", alternateRouteOverride: alternatePath })}
  <main id="main-content">
    <article class="event-detail-page">
      <section class="hero hero--inner${event.hero_image_url ? " hero--with-image" : " hero--legal"}" aria-labelledby="page-title">
        ${event.hero_image_url ? renderPicture(event.hero_image_url, event.hero_image_alt || event.title, "hero-media", { eager: true }) : ""}
        ${event.hero_image_url ? '<div class="hero-shade" aria-hidden="true"></div>' : ""}
        <div class="hero-content" data-reveal><p class="eyebrow">${escapeHtml(event.category)}</p><h1 id="page-title">${escapeHtml(event.title)}</h1>${eventExcerpt(event,260)?`<p class="hero-lead">${escapeHtml(eventExcerpt(event,260))}</p>`:""}</div>
      </section>
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
  </main>${renderFooter(copy, language)}${renderPrivateViewingDialog(language)}</body></html>`;
}

function catalogStructuredData(item, kind, canonicalUrl) {
  if (kind === "piano") return {
    "@context": "https://schema.org", "@type": "Product", name: item.title, description: item.description || item.summary,
    image: [item.image_url], brand: item.brand ? { "@type": "Brand", name: item.brand } : undefined,
    model: item.model || undefined, url: canonicalUrl
  };
  return { "@context": "https://schema.org", "@type": "Service", name: item.title, description: item.description || item.summary, image: item.image_url, provider: { "@type": "Organization", name: "Klavierhaus" }, url: canonicalUrl };
}

function renderCatalogDetail({ item, kind, language, baseUrl, allowIndexing, nonce, globalOverride = null, seoConfig = null }) {
  const copy = globalOverride || getGlobal(language);
  const isPiano = kind === "piano";
  const currentPath = isPiano ? showroomPath(item, language) : servicePath(item, language);
  const alternatePath = isPiano ? showroomPath({ ...item, slug: item.alternate_slug }, getAlternateLanguage(language)) : servicePath({ ...item, slug: item.alternate_slug }, getAlternateLanguage(language));
  const canonicalUrl = pageUrl(baseUrl, currentPath);
  const ctaLabel = language === "hu" ? (isPiano ? "Privát megtekintés egyeztetése" : "Személyes felmérés egyeztetése") : (isPiano ? "Arrange a private viewing" : "Arrange a private assessment");
  const galleryLabel = language === "hu" ? `${item.title} galériája` : `${item.title} gallery`;
  const title = `${item.title} | Klavierhaus`;
  const description = item.summary || item.description || item.title;
  const serviceIdentity = `${item.slug || ""} ${item.title || ""}`.toLocaleLowerCase();
  const seoKey = isPiano
    ? "pianos"
    : /restor|restaur|ujjaepites|rebuild/.test(serviceIdentity)
      ? "restoration"
      : /tuning|hangol/.test(serviceIdentity)
        ? "tuning"
        : /concert|koncert/.test(serviceIdentity)
          ? "concert"
          : "services";
  const keywords = seoKeywords({ seoConfig, key: seoKey, language, title, description });
  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({ language, title, description, canonicalUrl, alternateUrl: pageUrl(baseUrl, alternatePath), imageUrl: item.image_url, robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive", nonce, structuredData: [organizationStructuredData(baseUrl, copy), catalogStructuredData(item, kind, canonicalUrl)], globalCopyOverride: copy, keywords })}</head><body class="template-catalog-detail" data-language="${escapeHtml(language)}" data-page="${isPiano ? "pianos" : "services"}">${renderHeader({ copy, language, currentKey: isPiano ? "pianos" : "services", alternateRouteOverride: alternatePath })}<main id="main-content"><article id="instrument-details" class="catalog-detail"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.image_alt || item.title)}" fetchpriority="high" decoding="async"><div class="catalog-detail__copy" data-reveal><p class="eyebrow">${escapeHtml(isPiano ? [item.brand, item.model].filter(Boolean).join(" · ") : "Klavierhaus atelier")}</p><h1 class="word-safe-title${titleLengthClass(item.title)}">${escapeHtml(item.title)}</h1>${item.summary ? `<p class="catalog-detail__lead">${escapeHtml(item.summary)}</p>` : ""}${item.description ? renderParagraphs(String(item.description).split(/\n+/).filter(Boolean)) : ""}<div class="catalog-detail__actions">${isPiano ? `<a class="button button--ghost" href="#instrument-details"><span>${escapeHtml(language === "hu" ? "A hangszer részletei" : "Explore the instrument")}</span><span class="button-arrow" aria-hidden="true">↗</span></a>` : ""}<button class="button button--primary" type="button" data-private-viewing-open data-piano-brand="${escapeHtml(item.brand || "")}" data-piano-model="${escapeHtml(item.model || item.title || "")}">${escapeHtml(ctaLabel)} <span class="button-arrow" aria-hidden="true">↗</span></button></div></div></article>${renderGallery(item.gallery, galleryLabel)}</main>${renderFooter(copy, language)}${renderPrivateViewingDialog(language)}</body></html>`;
}

function renderPianoBrandPage({ brand, items, language, baseUrl, allowIndexing, nonce, globalOverride = null, seoConfig = null }) {
  const copy = globalOverride || getGlobal(language);
  const labels = copy.collectionLabels || {};
  const alternateLanguage = getAlternateLanguage(language);
  const canonicalPath = pianoBrandPath(brand, language);
  const alternatePath = pianoBrandPath(brand, alternateLanguage);
  const canonicalUrl = pageUrl(baseUrl, canonicalPath);
  const hu = language === "hu";
  const description = hu
    ? `${brand.label} zongorák a Klavierhaus New York-i bemutatótermében, személyes meghallgatásra és privát kiválasztásra.`
    : `${brand.label} pianos in the Klavierhaus New York showroom, available for private listening and personal selection.`;
  const title = `${brand.label} Pianos | Klavierhaus`;
  const keywords = normalizedSeoKeywords([
    ...seoKeywords({ seoConfig, key: "pianos", language, title, description }),
    ...seoKeywords({ seoConfig, key: brand.slug, language, title, description })
  ]).slice(0, 32);
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${brand.label} · Klavierhaus`,
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, url: pageUrl(baseUrl, showroomPath(item, language)), name: item.title }))
  };
  const instruments = items.map((item, index) => `<article class="piano-brand-instrument${index % 2 ? " piano-brand-instrument--reverse" : ""}" data-reveal>
    <a class="piano-brand-instrument__media" href="${escapeHtml(showroomPath(item, language))}"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.image_alt || item.title)}" loading="lazy" decoding="async"></a>
    <div class="piano-brand-instrument__copy"><p class="eyebrow">${escapeHtml([item.brand, item.model].filter(Boolean).join(" · "))}</p><h2 class="word-safe-title">${escapeHtml(item.title)}</h2>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}<span class="catalog-status">${escapeHtml(hu ? ({ AVAILABLE: "Megtekinthető", RESERVED: "Foglalt", SOLD: "Elkelt" }[item.availability_status] || item.availability_status) : ({ AVAILABLE: "Available for private viewing", RESERVED: "Reserved", SOLD: "Sold" }[item.availability_status] || item.availability_status))}</span><div class="piano-brand-instrument__actions"><a class="text-link" href="${escapeHtml(showroomPath(item, language))}"><span>${escapeHtml(labels.brandInstrumentDetails || (hu ? "A hangszer részletei" : "Explore the instrument"))}</span><span aria-hidden="true">↗</span></a><button class="button button--ghost" type="button" data-private-viewing-open data-piano-brand="${escapeHtml(item.brand || brand.label)}" data-piano-model="${escapeHtml(item.model || item.title || "")}"><span>${escapeHtml(labels.brandInstrumentViewing || (hu ? "Privát megtekintés egyeztetése" : "Arrange a private viewing"))}</span><span class="button-arrow" aria-hidden="true">↗</span></button></div></div>
  </article>`).join("");
  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({ language, title, description, canonicalUrl, alternateUrl: pageUrl(baseUrl, alternatePath), imageUrl: items[0]?.image_url || shared.heroImage, robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive", nonce, structuredData: [organizationStructuredData(baseUrl, copy), itemList], globalCopyOverride: copy, keywords })}</head><body class="template-piano-brand" data-language="${escapeHtml(language)}" data-page="pianos">${renderHeader({ copy, language, currentKey: "pianos", alternateRouteOverride: alternatePath })}<main id="main-content"><section class="hero hero--inner hero--with-image" aria-labelledby="page-title">${renderPicture(items[0]?.image_url || shared.heroImage, items[0]?.image_alt || brand.label, "hero-media", { eager: true })}<div class="hero-shade" aria-hidden="true"></div><div class="hero-content" data-reveal><p class="eyebrow">${escapeHtml(labels.showroomCardEyebrow || "Klavierhaus showroom")}</p><h1 id="page-title" class="word-safe-title">${escapeHtml(brand.label)}</h1><p class="hero-lead">${escapeHtml(labels.brandLead || (hu ? "A kiválasztás hallgatással kezdődik. Minden hangszer külön karakter, külön érintés és külön zenei találkozás." : "Selection begins with listening. Every instrument offers an individual character, touch, and musical encounter."))}</p></div></section><section class="piano-brand-list">${instruments}</section><section class="section section--cta"><div class="cta-inner"><p class="eyebrow">${escapeHtml(labels.brandPrivateSelection || (hu ? "Személyes kiválasztás" : "Private selection"))}</p><h2>${escapeHtml(labels.brandCtaTitle || (hu ? "Találkozzon a hangszerrel, mielőtt döntést hoz." : "Meet the instrument before making a decision."))}</h2><button class="button button--primary" type="button" data-private-viewing-open data-piano-brand="${escapeHtml(brand.label)}">${escapeHtml(labels.brandCta || (hu ? "Privát időpont egyeztetése" : "Arrange a private appointment"))} <span class="button-arrow" aria-hidden="true">↗</span></button></div></section></main>${renderFooter(copy, language)}${renderPrivateViewingDialog(language)}</body></html>`;
}

function renderArtistDetail({ artist, language, baseUrl, allowIndexing, nonce, globalOverride = null, seoConfig = null }) {
  const copy = globalOverride || getGlobal(language);
  const currentPath = artistPath(artist, language);
  const alternatePath = artistPath({ ...artist, slug: artist.alternate_slug }, getAlternateLanguage(language));
  const canonicalUrl = pageUrl(baseUrl, currentPath);
  const title = `${artist.name} | Klavierhaus`;
  const description = artist.biography || artist.role || artist.name;
  const keywords = seoKeywords({ seoConfig, key: "artists", language, title, description });
  const personSchema = { "@context": "https://schema.org", "@type": "Person", name: artist.name, description, image: artist.portrait_url, url: canonicalUrl };
  const events = Array.isArray(artist.events) && artist.events.length ? `<section class="artist-related-events"><p class="eyebrow">${escapeHtml(language === "hu" ? "Kapcsolódó események" : "Related events")}</p>${artist.events.map((event) => `<a href="${escapeHtml(language === "hu" ? `/hu/esemenyek/${event.slug}` : `/events/${event.slug}`)}"><span>${escapeHtml(event.title)}</span><span>${escapeHtml(formatEventDate(event.start_at, language, { dateOnly: true }))} ↗</span></a>`).join("")}</section>` : "";
  const galleryLabel = language === "hu" ? `${artist.name} galériája` : `${artist.name} gallery`;
  return `<!doctype html><html lang="${escapeHtml(copy.locale)}" class="no-js"><head>${renderDynamicHead({ language, title, description, canonicalUrl, alternateUrl: pageUrl(baseUrl, alternatePath), imageUrl: artist.portrait_url, robots: allowIndexing ? "index, follow" : "noindex, nofollow, noarchive", nonce, structuredData: [organizationStructuredData(baseUrl, copy), personSchema], globalCopyOverride: copy, keywords })}</head><body class="template-artist-detail" data-language="${escapeHtml(language)}" data-page="artists">${renderHeader({ copy, language, currentKey: "artists", alternateRouteOverride: alternatePath })}<main id="main-content"><section class="hero hero--inner hero--with-image" aria-labelledby="page-title">${renderPicture(artist.portrait_url, artist.portrait_alt || artist.name, "hero-media", { eager: true })}<div class="hero-shade" aria-hidden="true"></div><div class="hero-content" data-reveal><p class="eyebrow">${escapeHtml(artist.role || (language === "hu" ? "Művész" : "Artist"))}</p><h1 id="page-title">${escapeHtml(artist.name)}</h1><p class="hero-lead">${escapeHtml(String(description).replace(/\s+/g, " ").slice(0, 320))}</p></div></section><article class="artist-detail"><div class="artist-detail__copy" data-reveal>${artist.biography ? renderParagraphs(String(artist.biography).split(/\n+/).filter(Boolean)) : ""}${events}</div></article>${renderGallery(artist.gallery, galleryLabel)}</main>${renderFooter(copy, language)}</body></html>`;
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
  </section></main>${renderFooter(copy, language)}${renderPrivateViewingDialog(language)}</body></html>`;
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
  async function loadSeoConfig() {
    if (!eventClient.configured) return null;
    try { return await eventClient.seoConfig(); } catch (_error) { return null; }
  }

  app.disable("x-powered-by");
  app.enable("strict routing");
  app.use(compression());
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    res.locals.cspNonce = nonce;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Content-Security-Policy", `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self'; script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com https://www.clarity.ms; connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://www.clarity.ms; font-src 'self'; form-action 'self' https://checkout.stripe.com mailto:`);
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
      commit: String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || process.env.COMMIT_SHA || "unknown").trim() || "unknown",
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
      .flatMap((key) => [getRoute(key, "en"), getRoute(key, "hu")]);
    staticRoutes.push(...pianoBrands.flatMap((brand) => [pianoBrandPath(brand, "en"), pianoBrandPath(brand, "hu")]));
    const dynamicRoutes = [];
    if (eventClient.configured) {
      const feeds = await Promise.allSettled([
        eventClient.list("en"), eventClient.list("hu"), eventClient.showroomPianos("en"), eventClient.showroomPianos("hu"), eventClient.services("en"), eventClient.services("hu"), eventClient.artists("en"), eventClient.artists("hu")
      ]);
      const values = feeds.map((result) => result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []);
      dynamicRoutes.push(...values[0].map((event) => eventPath(event, "en")));
      dynamicRoutes.push(...values[1].map((event) => eventPath(event, "hu")));
      dynamicRoutes.push(...values[2].map((item) => showroomPath(item, "en")));
      dynamicRoutes.push(...values[3].map((item) => showroomPath(item, "hu")));
      dynamicRoutes.push(...values[4].map((item) => servicePath(item, "en")));
      dynamicRoutes.push(...values[5].map((item) => servicePath(item, "hu")));
      dynamicRoutes.push(...values[6].map((item) => artistPath(item, "en")));
      dynamicRoutes.push(...values[7].map((item) => artistPath(item, "hu")));
    }
    const urls = [...new Set([...staticRoutes, ...dynamicRoutes])]
      .map((route) => `<url><loc>${escapeHtml(pageUrl(baseUrl, route))}</loc></url>`).join("");
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  app.get("/preview/:token", async (req, res) => {
    try {
      const preview = await eventClient.preview(req.params.token);
      const route = { key: preview.page_key, language: preview.language };
      if (!routeDefinitions[route.key] && route.key !== "global") throw Object.assign(new Error("PREVIEW_NOT_FOUND"), { status: 404 });
      const content = route.key === "global" ? null : preview.content;
      const globalContent = route.key === "global" ? preview.content : await eventClient.content("global", route.language).catch(() => null);
      const seoConfig = await loadSeoConfig();
      res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      // This authenticated, expiring preview is intentionally embeddable in the ERP preview dialog.
      res.removeHeader("X-Frame-Options");
      res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; font-src 'self'; frame-ancestors https://klavierhaus-erp.onrender.com http://localhost:3030 http://127.0.0.1:3030");
      res.type("html").send(renderDocument({ route: route.key === "global" ? { key: "home", language: route.language } : route, baseUrl, allowIndexing: false, nonce: res.locals.cspNonce, pageOverride: content, globalOverride: globalContent?.content || globalContent || null, seoConfig }));
    } catch (_error) { res.status(404).type("html").send(renderNotFound({ language: "en", baseUrl, allowIndexing: false, nonce: res.locals.cspNonce })); }
  });

  app.get("/api/site/device-token", async (_req, res) => {
    try { res.setHeader("Cache-Control", "no-store"); res.json(await eventClient.deviceToken()); }
    catch (_error) { res.status(503).json({ error: "MEASUREMENT_UNAVAILABLE" }); }
  });
  app.get("/api/site/tracking-config", async (_req, res) => {
    try { res.json(await eventClient.trackingConfig()); } catch (_error) { res.json({ ga4_measurement_id: "", clarity_project_id: "" }); }
  });
  app.get("/api/site/seo-config", async (_req, res) => {
    try { res.json(await eventClient.seoConfig()); } catch (_error) { res.json(FALLBACK_SEO_CONFIG); }
  });
  app.get("/api/site/design-settings", async (_req, res) => {
    try { res.setHeader("Cache-Control", "public, max-age=0, must-revalidate, stale-while-revalidate=60"); res.json(await eventClient.designSettings()); }
    catch (_error) { res.json({}); }
  });
  app.post("/api/site/track", async (req, res) => {
    try { const result = await eventClient.track(req.body || {}); res.status(201).json(result); }
    catch (error) { res.status(error.status || 503).json({ error: error.code || "MEASUREMENT_UNAVAILABLE" }); }
  });
  app.post("/api/site/contact-leads", async (req, res) => {
    try { const result = await eventClient.createLead(req.body || {}); res.status(201).json(result); }
    catch (error) { res.status(error.status || 400).json({ error: error.code || "CONTACT_REQUEST_FAILED" }); }
  });
  app.post("/api/site/events/:eventId/repeat-interest", async (req, res) => {
    try { const result = await eventClient.repeatInterest(req.params.eventId, req.body || {}); res.status(201).json(result); }
    catch (error) { res.status(error.status || 400).json({ error: error.code || "EVENT_INTEREST_FAILED" }); }
  });

  // Resolve editable public page slugs before the canonical route handlers.
  app.use(async (req, _res, next) => {
    if (!eventClient.configured || req.path.startsWith("/api/") || req.path.startsWith("/assets/") || req.path === "/health") return next();
    try {
      const configured = await eventClient.pageSettings();
      const routes = configured?.routes || {};
      for (const [key, route] of Object.entries(routes)) {
        const definition = routeDefinitions[key]; if (!definition) continue;
        const language = req.path.startsWith("/hu/") ? "hu" : "en";
        if (route[language] && route[language] === req.path && route[language] !== definition[language]) {
          req.url = `${definition[language]}${req.url.slice(req.path.length)}`;
          break;
        }
      }
    } catch (_error) { /* bundled routes remain available when ERP is unreachable */ }
    next();
  });

  // The former standalone consultation page is intentionally gone. Consultation is modal-only.
  app.all(["/private-consultation", "/hu/privat-konzultacio"], (_req, res) => {
    res.status(410).type("text").send("This page has been permanently removed.");
  });

  app.get(["/events", "/hu/esemenyek"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const [events,content,globalContent,seoConfig] = await Promise.all([eventClient.list(language),eventClient.content("events",language).catch(() => null),eventClient.content("global",language).catch(() => null),loadSeoConfig()]);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.type("html").send(renderPublicEventList({ events, language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, pageOverride: content?.content || null, globalOverride: globalContent?.content || null, seoConfig }));
    } catch (error) {
      console.warn(`[website] Event listing fallback: ${error.code || error.message}`);
      next();
    }
  });

  app.get(["/pianos/:slug", "/hu/zongorak/:slug"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const brand = pianoBrands.find((item) => item.slug === String(req.params.slug || "").toLowerCase());
      if (brand) {
        const [allItems, globalContent, seoConfig] = await Promise.all([eventClient.showroomPianos(language), eventClient.content("global", language).catch(() => null), loadSeoConfig()]);
        const items = allItems.filter((item) => brand.matches(item.brand));
        if (!items.length) return next();
        res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
        return res.type("html").send(renderPianoBrandPage({ brand, items, language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, globalOverride: globalContent?.content || null, seoConfig }));
      }
      const [item, globalContent, seoConfig] = await Promise.all([eventClient.showroomPiano(req.params.slug, language), eventClient.content("global", language).catch(() => null), loadSeoConfig()]);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.type("html").send(renderCatalogDetail({ item, kind: "piano", language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, globalOverride: globalContent?.content || null, seoConfig }));
    } catch (error) { if (error.status === 404) return next(); next(error); }
  });

  app.get(["/artists/:slug", "/hu/muveszek/:slug"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const [artist, globalContent, seoConfig] = await Promise.all([eventClient.artist(req.params.slug, language), eventClient.content("global", language).catch(() => null), loadSeoConfig()]);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.type("html").send(renderArtistDetail({ artist, language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, globalOverride: globalContent?.content || null, seoConfig }));
    } catch (error) { if (error.status === 404) return next(); next(error); }
  });

  app.get(["/services/:slug", "/hu/szolgaltatasok/:slug"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const [item, globalContent, seoConfig] = await Promise.all([eventClient.service(req.params.slug, language), eventClient.content("global", language).catch(() => null), loadSeoConfig()]);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.type("html").send(renderCatalogDetail({ item, kind: "service", language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, globalOverride: globalContent?.content || null, seoConfig }));
    } catch (error) { if (error.status === 404) return next(); next(error); }
  });

  app.get(["/events/:slug", "/hu/esemenyek/:slug"], async (req, res, next) => {
    if (!eventClient.configured) return next();
    const language = req.path.startsWith("/hu/") ? "hu" : "en";
    try {
      const [event, globalContent, seoConfig] = await Promise.all([eventClient.detail(req.params.slug, language), eventClient.content("global", language).catch(() => null), loadSeoConfig()]);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      const result = ["success", "cancelled", "error", "reserved"].includes(String(req.query.checkout || req.query.reservation || ""))
        ? String(req.query.checkout || req.query.reservation)
        : "";
      res.type("html").send(renderPublicEventDetail({ event, language, baseUrl, allowIndexing, nonce: res.locals.cspNonce, result, globalOverride: globalContent?.content || null, seoConfig }));
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
    const attendeeNames = (Array.isArray(req.body?.attendee_names) ? req.body.attendee_names : [req.body?.attendee_names]).map((name) => String(name || "").trim()).filter(Boolean);
    try {
      const checkout = await eventClient.createCheckout(req.params.slug, language, quantity, attendeeNames);
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
        attendeeNames: (Array.isArray(req.body?.attendee_names) ? req.body.attendee_names : [req.body?.attendee_names]).map((name) => String(name || "").trim()).filter(Boolean),
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
    let artists = [];
    let pageOverride = null;
    let globalOverride = null;
    let seoConfig = null;
    if (eventClient.configured) {
      const requests = [
        eventClient.content(route.key, route.language),
        eventClient.content("global",route.language),
        loadSeoConfig(),
        route.key === "home" ? eventClient.list(route.language) : Promise.resolve([]),
        route.key === "home" ? eventClient.reviews(route.language) : Promise.resolve([]),
        ["home","pianos"].includes(route.key) ? eventClient.showroomPianos(route.language) : Promise.resolve([]),
        ["home","services"].includes(route.key) ? eventClient.services(route.language) : Promise.resolve([]),
        ["home","artists"].includes(route.key) ? eventClient.artists(route.language) : Promise.resolve([])
      ];
      const [contentResult,globalResult,seoResult,eventResult,reviewResult,pianoResult,serviceResult,artistResult] = await Promise.allSettled(requests);
      if (contentResult.status === "fulfilled") pageOverride = contentResult.value?.content || null;
      else console.warn(`[website] Page content fallback: ${contentResult.reason?.code || contentResult.reason?.message}`);
      if (globalResult.status === "fulfilled") globalOverride = globalResult.value?.content || null;
      if (seoResult.status === "fulfilled") seoConfig = seoResult.value || null;
      if (eventResult.status === "fulfilled") homeEvents = eventResult.value;
      else if (route.key === "home") console.warn(`[website] Homepage event feed unavailable: ${eventResult.reason?.code || eventResult.reason?.message}`);
      if (reviewResult.status === "fulfilled") reviews = reviewResult.value;
      if (pianoResult.status === "fulfilled") showroomPianos = pianoResult.value;
      if (serviceResult.status === "fulfilled") websiteServices = serviceResult.value;
      if (artistResult.status === "fulfilled") artists = artistResult.value;
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
      artists,
      pageOverride,
      globalOverride,
      seoConfig
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
