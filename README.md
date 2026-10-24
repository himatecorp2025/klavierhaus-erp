# Klavierhaus ERP v6.7.0

Internal, bilingual (American English and Hungarian) work-management system for Klavierhaus.

Belső, kétnyelvű (amerikai angol és magyar) Klavierhaus munkakezelő rendszer.

## Main modules / Fő modulok

- weekly and daily scheduler with employee-specific colors / heti és napi naptár munkavállalói színekkel;
- planned jobs and multi-step part-work workflows / tervezett munkák és többlépcsős részmunkafolyamatok;
- clients and piano registry / ügyfél- és zongoranyilvántartás;
- inventory / leltár;
- invoices and internal finance register / számlák és belső pénzügyi nyilvántartás;
- knowledge base, notifications, audit log and backups / tudásbázis, értesítések, módosítási napló és biztonsági mentések;
- responsive desktop, mobile and installed PWA interface / reszponzív asztali, mobil- és telepített PWA-felület.

Roles / Szerepkörök: `ADMIN`, `MANAGER`, `WORKER`. The hidden superadmin is an existing protected account and is never created by the installer. / A rejtett szuperadmin meglévő, védett fiók; a telepítő nem hozza létre.

## Installation and update / Telepítés és frissítés

```bash
npm ci
cp .env.example .env
npm start
```

`npm start` automatically runs the idempotent database migration before starting the server. Existing users, clients, pianos, jobs and inventory records are counted before and after migration, and SQLite integrity is checked. When a structural migration is needed, a pre-migration database backup is created first.

Az `npm start` a szerver indítása előtt automatikusan lefuttatja az ismételhető adatbázis-migrációt. A migráció előtt és után ellenőrzi a felhasználók, ügyfelek, zongorák, munkák és leltártételek darabszámát, valamint az SQLite integritását. Szerkezeti migráció előtt automatikus adatbázis-mentés készül.

Default local URL / Alapértelmezett helyi cím: `http://localhost:3030`

No demo user is created. Existing production users and the hidden superadmin remain unchanged. / Demo felhasználó nem jön létre. A meglévő éles felhasználók és a rejtett szuperadmin változatlanok maradnak.

## Deployment notes / Telepítési megjegyzések

- Keep `DB_PATH`, `BACKUP_DIR` and `UPLOAD_DIR` on persistent storage. / A három útvonal tartós tárhelyre mutasson.
- Preserve the currently working VAPID keys when updating. Changing them invalidates existing push subscriptions. / Frissítéskor a jelenleg működő VAPID-kulcsokat meg kell őrizni; cseréjük érvényteleníti a meglévő push-feliratkozásokat.
- Use HTTPS outside local development. / Helyi fejlesztésen kívül HTTPS szükséges.
- Run `npm test` and `npm run check` before deployment. / Telepítés előtt futtasd az `npm test` és `npm run check` parancsokat.

## HIMATE START-22 connector / HIMATE START-22 adatkapcsolat

The ERP includes a one-way, privacy-safe Klavierhaus -> HIMATE export adapter. It does **not** give HIMATE direct SQLite access and it does not replicate raw ERP tables. The adapter has an explicit 38-module registry and exports only approved aggregate/business-metadata fields. Passwords, sessions, API/OAuth secrets, invitation/preview tokens, payment credentials and raw customer-message bodies are outside the export contract.

Az ERP egy egyirányú, adatminimalizált Klavierhaus -> HIMATE export adaptert tartalmaz. A HIMATE **nem** kap közvetlen SQLite-hozzáférést, és a rendszer nem másolja át nyersen az ERP tábláit. Az adapter pontosan 38 modul géppel olvasható szerződését használja, és csak jóváhagyott aggregált vagy üzleti metaadatokat továbbít.

Runtime configuration / Futásidejű konfiguráció:

- `HIMATE_CONNECTOR_ENABLED=true` enables scheduled export only after the remaining settings are valid.
- `HIMATE_CONNECTOR_URL` is the HTTPS HIMATE Gateway origin, without a `/connector/v1` suffix.
- `HIMATE_CONNECTOR_TOKEN` is the one-time raw partner+environment credential issued by HIMATE. Treat it as a production secret; never store a real value in Git, SQLite, logs or frontend code.
- `HIMATE_CONNECTOR_TIMEOUT_MS` controls outbound request timeout and defaults to 10000 ms.

The adapter sends a heartbeat and system telemetry every five minutes, operational datasets hourly, and a complete 38-module batch plus reconciliation daily. Batch/reconciliation requests use SHA-512 integrity checks, HMAC-SHA-512 signatures, timestamps and one-time nonces. Manual status/sync endpoints are Superadmin-only: `GET /api/system/himate-connector/status` and `POST /api/system/himate-connector/sync`.

A Connector Protocol v1 implementation-language independent. A future Go-based Klavierhaus backend can implement the same contract without changing HIMATE.

## Finance scope / A pénzügyi modul hatóköre

The finance module is a simple internal income, expense and management register. It does not implement guaranteed double-entry bookkeeping and does not replace an official accounting system or accountant.

A pénzügyi modul egyszerű belső bevételi, kiadási és vezetői nyilvántartás. Nem garantált kettős könyvviteli rendszer, és nem helyettesít hivatalos könyvelőprogramot vagy könyvelőt.

## Useful commands / Hasznos parancsok

```bash
npm run init-db   # manual idempotent migration / kézi, ismételhető migráció
npm run check     # JavaScript syntax checks / JavaScript szintaktikai ellenőrzések
npm test          # automated tests / automatikus tesztek
npm run dev       # development server (migration must already be applied)
```



## Local Mac CI and release procedure

Run `bash scripts/run-local-ci.sh` on the Mac before a PR or merge. Automatic GitHub Actions are disabled; the workflow is available for manual troubleshooting only. The local gate checks Node 20.18.0/npm 10, locked dependencies, database migration, JavaScript, ERP acceptance tests, website tests, and production dependency advisories.

For browser-facing ERP API calls, `CORS_ALLOWED_ORIGINS` optionally adds a comma-separated list of trusted HTTPS origins. Official Klavierhaus website and admin origins are allowed by default.

Never commit Google Calendar private feed URLs; if one was published, remove it, regenerate the secret calendar URL in Google Calendar settings, and update any subscriptions that depended on it. Deleting the URL from the current files does not erase Git history.


## Customer-facing CMS catalogue order

In **Website CMS → Piano Page**, use **Public display order** to arrange the currently published piano *brand* cards. Position 1 appears on the left, followed by 2, 3 and so on, consistently on the public homepage and Piano page in both languages. Future brands are automatically included after the configured brands until an administrator reorders them.

In **Website CMS → Service Page**, arrange the visible *service* cards the same way. Save display order using its dedicated button; you do not need to publish other CMS page content for a card-order change. New services append to the end; the `featured` flag cannot override the explicit card order. The ordering endpoints require ERP admin authentication.

Public piano category preferences are stored in `app_settings.website_piano_brand_display_order`. Service positions are stored in `website_services.sort_order`. These changes are included in website collection backups and the existing collection factory-reset lifecycle. They do not change the customer piano registry.


## CMS brand registry and site presentation

The **Website CMS → Piano Page** includes **Manage Piano Brands**. An administrator can create brands independently from inventory (including an optional cover image), rename brands while preserving their permanent page slug, or archive and later restore a brand. Archiving hides that brand and its showroom pianos publicly **without deleting any showroom instruments or customer ERP piano records**. The new `website_piano_brands` table is included in the website backup/restore lifecycle. Brand positions remain managed by the separate **Public display order** panel and also support empty brands.

**Website CMS → Global Navigation & Footer** now provides dedicated editors for both the header menu's shared ordering and bilingual labels, and public showroom/footer contact details. The **Contact Page** also exposes the public contact editor. These are stored separately under `website_navigation_presentation_v1` and `website_public_contact_v1`; **never** update the invoicing issuer settings `finance_company_*` as a side effect. Social links support HTTPS Instagram, Facebook, YouTube, LinkedIn and TikTok URLs.

Public individual piano pages provide a gallery lightbox with keyboard navigation, previous/next, 1–5× zoom, wheel zoom and touch pinch/pan. Images of all orientations are shown uncropped using `object-fit:contain`. The standalone ERP customer-owned piano registry and appointment booking logic are untouched.

Before deploying, run `CI_RUNS=5 bash scripts/run-local-ci.sh` on the Mac. The full suite includes service/website routes, bilingual navigation, independent billing details, image-gallery markup, brand create/rename/archive/restore and backup regressions.


### Fullscreen piano gallery: fit, pan and original resolution

On each piano detail page, hovering over the main photo or a gallery thumbnail enlarges the preview around the mouse position. Clicking opens a modal that fits the **entire** original photo to the current screen (portrait or landscape) without cropping or auto-zoom. The modal provides original-photo previews along the bottom, previous/next buttons and keyboard arrows. Explicit zoom is available with +/− controls, the mouse wheel, double-click or touch pinch. Once zoomed, the image follows the mouse and can also be dragged; the available panning range is computed from the fitted *image dimensions*, so it works on any aspect ratio. The reset control returns to the full photo, and opening another photo always begins fitted.

The original uploaded file URL is used for zoom, never a low-resolution thumbnail. The viewer avoids upscaling at its default fit level and reports native image dimensions and resolution limits. Existing low-resolution uploads cannot produce additional detail through software: CMS editors now recommend original photos of at least **2,000 pixels on the longest side**. The browser-based smoke regression under \`website/test/gallery-fit-pan.test.js\` exercises fitted display, cursor follow, dragging, swipe, pinch, wheel, keyboard and reopening on desktop and narrow viewports.
