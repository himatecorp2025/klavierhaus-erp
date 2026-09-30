"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("active public conversation switches from intake fields to Messenger-only composer",()=>{
  const html=read("website/server/index.js"),browser=read("website/public/app.js");
  assert.match(html,/data-chat-intake-fields/);
  assert.match(html,/customer-chat__composer/);
  assert.match(browser,/function applyCustomerChatMode\(active\)/);
  assert.match(browser,/intake\.hidden=isActive/);
  assert.match(browser,/control\.disabled=isActive/);
  assert.match(browser,/customerChatLookupForm\.hidden=isActive/);
  assert.match(browser,/applyCustomerChatMode\(Boolean\(customerConversationToken\)\)/);
  assert.match(browser,/applyCustomerChatMode\(true\)/);
});

test("public Messenger composer is icon-only for camera photo voice and emoji without a send button",()=>{
  const html=read("website/server/index.js");
  const start=html.indexOf('<div class="customer-chat__composer" data-chat-composer hidden>');
  const end=html.indexOf('</div>',start);
  const composer=html.slice(start,end+6);
  assert.ok(start>=0);
  assert.match(composer,/data-chat-camera/);
  assert.match(composer,/data-chat-photo-input/);
  assert.match(composer,/data-chat-voice/);
  assert.match(composer,/data-chat-emoji/);
  assert.doesNotMatch(composer,/customer-chat__send-button/);
  assert.doesNotMatch(composer,/<strong>|<small>|Image, PDF|Kép, PDF|document · max/);
});

test("customer and support messages are separate Messenger bubbles",()=>{
  const browser=read("website/public/app.js"),css=read("website/public/styles.css");
  assert.match(browser,/customer-chat__message--\$\{staff\?"staff":"customer"\}/);
  assert.match(css,/\.customer-chat__message-row--customer\{justify-content:flex-end/);
  assert.match(css,/\.customer-chat__message--customer\{[^}]*background:linear-gradient/);
});

test("Master Data renders the eight approved icon-only controls including Partner",()=>{
  const app=read("public/app.js");
  const calls=[...app.matchAll(/masterToolButton\("(SEARCH|CLIENTS|VIP|INDIVIDUAL|PARTNER|BUSINESS|INSTITUTION|PIANOS)"/g)].map(match=>match[1]);
  assert.deepEqual(calls,["SEARCH","CLIENTS","VIP","INDIVIDUAL","PARTNER","BUSINESS","INSTITUTION","PIANOS"]);
  assert.match(app,/function masterIconSvg[\s\S]*master-tool-svg/);
  assert.match(app,/function masterToolButton/);
  assert.doesNotMatch(app,/clientVipFilter|data-client-filter=/);
});

test("search reveal stays inline and closes when another Master icon is selected",()=>{
  const app=read("public/app.js"),css=read("public/styles.css");
  assert.match(app,/if\(kind==="SEARCH"\)[\s\S]*masterSearchOpen=!state\.masterSearchOpen/);
  assert.match(app,/state\.masterSearchOpen=false;/);
  assert.match(css,/\.master-search-reveal\{max-height:0;opacity:0/);
  assert.match(css,/\.master-search-reveal\.open\{max-height:58px;opacity:1/);
});

test("client communication actions live inside the left client row and expose mail Messages and phone actions",()=>{
  const app=read("public/app.js");
  const start=app.indexOf("function renderClientList()");
  const end=app.indexOf("function runClientContactAction",start);
  const block=app.slice(start,end);
  assert.match(block,/client-quick-actions/);
  assert.match(block,/contactActionButton\(client,"email"\)/);
  assert.match(block,/contactActionButton\(client,"message"\)/);
  assert.match(block,/contactActionButton\(client,"phone"\)/);
  assert.match(app,/mailto:\$\{client\.email\}/);
  assert.match(app,/sms:\$\{phone\}/);
  assert.match(app,/tel:\$\{phone\}/);
  assert.match(app,/No email address for this customer/);
  assert.match(app,/No phone number for this customer/);
});

test("VIP remains independent from Individual Partner Business Institution client type",()=>{
  const schema=read("server/schema.sql"),app=read("public/app.js");
  assert.match(schema,/client_type TEXT NOT NULL DEFAULT 'INDIVIDUAL'/);
  assert.match(schema,/is_vip INTEGER NOT NULL DEFAULT 0/);
  assert.match(app,/INDIVIDUAL:tr\("Individual","Magánszemély"\)/);
  assert.match(app,/PARTNER:tr\("Professional partner","Szakmai partner"\)/);
  assert.match(app,/<strong>★ VIP<\/strong>/);
  assert.doesNotMatch(app,/VIP is independent from (?:the )?customer type/);
});

test("piano list API exposes owner and effective location inherited from customer address",()=>{
  const backend=read("server/round1-core.js");
  assert.match(backend,/app\.get\("\/api\/pianos"/);
  assert.match(backend,/c\.name AS client_name/);
  assert.match(backend,/COALESCE\(NULLIF\(TRIM\(p\.location_notes\),''\),NULLIF\(TRIM\(c\.address\),''\)\) AS effective_location/);
});

test("piano mode lists serial owner and location and piano records are editable",()=>{
  const app=read("public/app.js");
  assert.match(app,/function renderPianoList/);
  assert.match(app,/piano\.serial_number/);
  assert.match(app,/piano\.client_name/);
  assert.match(app,/piano\.effective_location/);
  assert.match(app,/function renderPianoDetail/);
  assert.match(app,/\/api\/pianos\/\$\{piano\.id\}/);
  assert.match(app,/method:piano\?"PUT":"POST"/);
  assert.match(app,/Blank = customer address automatically/);
});

test("mobile Master switches list/detail and mobile navigation reaches the physical device bottom",()=>{
  const app=read("public/app.js"),css=read("public/styles.css");
  assert.match(app,/openMasterMobileDetail/);
  assert.match(app,/closeMasterMobileDetail/);
  assert.match(css,/\.master-layout\.detail-open \.master-list-panel\{display:none\}/);
  assert.match(css,/\.master-layout\.detail-open \.master-detail\{display:block\}/);
  assert.match(css,/@media\(max-width:900px\)\{[\s\S]*\.mobile-nav\{[\s\S]*bottom:0!important/);
  assert.match(css,/padding:6px 8px calc\(6px \+ var\(--safe-bottom\)\)!important/);
});

test("website logo and website favicon are independent design settings",()=>{
  const settings=read("server/website-content.js"),browser=read("website/public/app.js"),v6=read("public/v6.js");
  assert.match(settings,/logo_url: "", favicon_url: ""/);
  assert.match(settings,/for\(const key of \["logo_url","favicon_url"\]\)/);
  assert.match(browser,/settings\.favicon_url/);
  assert.match(browser,/link\[rel~="icon"\]/);
  assert.doesNotMatch(v6,/v6SetGlobalFavicon/);
  assert.match(v6,/favicon_url:url/);
  assert.match(v6,/logo_url:url/);
});

test("public logo uses the same validated branding upload pipeline as ERP logos",()=>{
  const backend=read("server/admin-ux-v6.js");
  assert.match(backend,/\{route:"public-logo",key:null,min:192\}/);
  assert.match(backend,/\{route:"erp-logo-dark",key:"erp_logo_dark_url",min:192/);
  assert.match(backend,/\{route:"erp-logo-light",key:"erp_logo_light_url",min:192\}/);
  assert.match(backend,/brandUpload/);
  assert.match(backend,/inspectImageFile/);
});

test("ERP dark and light logos switch with theme while PWA icon remains independent",()=>{
  const server=read("server/index.js"),v6=read("public/v6.js");
  assert.match(server,/erp_logo_dark_url:setting\("erp_logo_dark_url",legacyLogo\)/);
  assert.match(server,/erp_logo_light_url:setting\("erp_logo_light_url",legacyLogo\)/);
  assert.match(server,/app_icon_url:setting\("app_icon_url","\/icons\/icon-512\.png"\)/);
  assert.doesNotMatch(server,/app_icon_url:setting\("app_icon_url",setting\("logo_url"/);
  assert.match(v6,/theme==="light"\?\(branding\.erp_logo_light_url\|\|branding\.logo_url\):\(branding\.erp_logo_dark_url\|\|branding\.logo_url\)/);
  assert.match(v6,/const touch=branding\.app_icon_url;/);
});

test("CMS exposes seven independent brand asset cards including Login logo",()=>{
  const v6=read("public/v6.js");
  for(const key of ["websiteLogo","websiteFavicon","erpLogoDark","erpLogoLight","loginLogo","appIcon","loginBackground"])assert.match(v6,new RegExp('v6BrandAssetCard\\("'+key+'"'));
  assert.match(v6,/\/api\/settings\/branding\/public-logo/);
  assert.match(v6,/\/api\/settings\/branding\/public-favicon/);
  assert.match(v6,/\/api\/settings\/branding\/erp-logo-dark/);
  assert.match(v6,/\/api\/settings\/branding\/erp-logo-light/);
  assert.match(v6,/\/api\/settings\/branding\/app-icon/);
  assert.match(v6,/\/api\/settings\/branding\/background/);
});
