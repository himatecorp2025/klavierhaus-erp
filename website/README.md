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
