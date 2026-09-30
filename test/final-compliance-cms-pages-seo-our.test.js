"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("CMS exposes clear page hierarchy, Our page, unified legal content and Chat Logo",()=>{
  const contract=read("website/server/site-content.js");
  const api=read("server/website-content.js");
  const adminRoutes=read("server/admin-ux-v6.js");
  const admin=read("public/v6.js");
  const publicJs=read("website/public/app.js");
  const publicRenderer=read("website/server/index.js");

  assert.match(contract,/our:\s*\{ en: "\/our", hu: "\/hu\/rolunk" \}/);
  assert.doesNotMatch(contract,/ticketTerms:\s*\{ en:/);
  assert.match(contract,/nav:\s*\[[\s\S]*key: "artists"[\s\S]*key: "mission"[\s\S]*key: "pianos"[\s\S]*key: "services"[\s\S]*key: "our"/);
  const firstNav=contract.match(/nav:\s*\[([\s\S]*?)\]/)?.[1]||"";
  assert.doesNotMatch(firstNav,/key: "events"/);

  assert.match(contract,/our:\s*\{[\s\S]*id: "company"[\s\S]*id: "founder"[\s\S]*id: "history"[\s\S]*id: "mission"[\s\S]*id: "philosophy"/);
  assert.match(contract,/privacy:\s*\{[\s\S]*id: "privacy-policy"[\s\S]*id: "terms-and-conditions"/);
  assert.match(contract,/id: "adatkezeles"[\s\S]*id: "altalanos-szerzodesi-feltetelek"/);

  assert.match(api,/chat_logo_url/);
  assert.match(api,/CMS_PAGE_ADMIN/);
  assert.match(api,/admin_group/);
  assert.match(api,/canonicalizePageContent/);
  assert.match(api,/normalizeLegacyPageLinks/);

  assert.match(adminRoutes,/route:"chat-logo"/);
  assert.match(admin,/Chat Logo/);
  assert.match(admin,/v6CmsSidebarMarkup/);
  assert.match(admin,/cms-sidebar-group/);
  assert.match(admin,/Image alt text · SEO & accessibility/);

  assert.match(publicJs,/settings\.chat_logo_url/);
  assert.match(publicRenderer,/data-chat-logo/);
  assert.match(publicRenderer,/legal-document/);
  assert.match(publicRenderer,/res\.redirect\(308,"\/our"\)/);
  assert.match(publicRenderer,/res\.redirect\(308,"\/privacy#terms-and-conditions"\)/);
});

test("public website SEO is server rendered and the audit checks actual fallback content plus image ALT",()=>{
  const publicRenderer=read("website/server/index.js");
  const seo=read("server/website-platform.js");
  const audit=read("server/business-operations.js");
  const css=read("website/public/styles.css");

  assert.match(publicRenderer,/<meta name="robots"/);
  assert.match(publicRenderer,/<meta name="description"/);
  assert.match(publicRenderer,/<link rel="canonical"/);
  assert.match(publicRenderer,/hreflang="en-US"/);
  assert.match(publicRenderer,/hreflang="hu-HU"/);
  assert.match(publicRenderer,/hreflang="x-default"/);
  assert.match(publicRenderer,/property="og:title"/);
  assert.match(publicRenderer,/property="og:description"/);
  assert.match(publicRenderer,/property="og:image:alt"/);
  assert.match(publicRenderer,/name="twitter:title"/);
  assert.match(publicRenderer,/webPageStructuredData/);
  assert.match(publicRenderer,/organizationStructuredData/);
  assert.match(publicRenderer,/renderPicture\([\s\S]*alt/);
  assert.match(publicRenderer,/WEBSITE_ALLOW_INDEXING/);
  assert.match(publicRenderer,/Sitemap:/);
  assert.match(publicRenderer,/sitemap\.xml/);

  assert.match(seo,/SEO_PAGE_KEYS = Object\.freeze\(\["home", "our"/);
  assert.doesNotMatch(seo,/SEO_PAGE_KEYS[^\n]*"ticketTerms"/);
  assert.match(seo,/pageEn\.story/);
  assert.match(audit,/fallbackPage\(pageKey,language\)/);
  assert.match(audit,/MISSING_IMAGE_ALT/);
  assert.match(audit,/technical_seo/);
  assert.match(css,/\.legal-document/);
  assert.match(css,/white-space:pre-wrap/);
});
