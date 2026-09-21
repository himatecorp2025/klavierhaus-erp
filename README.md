# Klavierhaus ERP v6.5.0

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


https://calendar.google.com/calendar/ical/ac31bd0e9409cafb409e38e035bdaa59f913ea932fa5a94a488d218d97ed3513%40group.calendar.google.com/private-052f19a7e56f9910c4becf2c9d8a79c4/basic.ics
