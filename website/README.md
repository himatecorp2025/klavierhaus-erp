# Klavierhaus public website / Klavierhaus nyilvános weboldal

This directory is an independently deployable public website service. It does not start, import, or migrate the internal Klavierhaus ERP database.

Ez a könyvtár egy önállóan telepíthető nyilvános weboldal-szolgáltatás. Nem indítja el, nem importálja és nem migrálja a belső Klavierhaus ERP adatbázisát.

## Zero-stage scope / A nulladik szakasz tartalma

- independent Node.js web service / önálló Node.js webszolgáltatás;
- English route at `/` and Hungarian route at `/hu/` / angol útvonal a `/`, magyar útvonal a `/hu/` címen;
- Render health endpoint at `/health` / Render állapotvégpont a `/health` címen;
- temporary search-engine protection / ideiglenes keresőmotor-védelem;
- responsive premium foundation / reszponzív prémium alaprendszer;
- no ERP database dependency / nincs ERP-adatbázis-függőség.

The event, ticket, Stripe, content-management, analytics, and final public design modules are intentionally not part of this zero-stage foundation.

Az esemény-, jegy-, Stripe-, tartalomkezelési, analitikai és végleges nyilvános dizájnmodul szándékosan nem része ennek a nulladik szakasznak.

## Local verification / Helyi ellenőrzés

```bash
npm ci
npm run check
npm test
npm start
```

The default local port is `10000`.

Az alapértelmezett helyi port `10000`.

## Render Web Service settings / Render Web Service beállítások

| Setting / Beállítás | Value / Érték |
| --- | --- |
| Name / Név | `klavierhaus` |
| Branch / Ág | `develop` |
| Root Directory / Gyökérkönyvtár | `website` |
| Runtime / Futási környezet | `Node` |
| Build Command / Build parancs | `npm ci` |
| Start Command / Indítóparancs | `npm start` |
| Health Check Path / Állapotútvonal | `/health` |

On Render, add `WEBSITE_BASE_URL`, `WEBSITE_ALLOW_INDEXING`, and `ERP_PUBLIC_API_URL` from `.env.example`. Render supplies `PORT` automatically, so do not create or override it there. Keep `WEBSITE_ALLOW_INDEXING=false` until the final `klavierhaus.com` domain is ready and approved for indexing.

A Render Environment oldalon a `.env.example` fájlból a `WEBSITE_BASE_URL`, `WEBSITE_ALLOW_INDEXING` és `ERP_PUBLIC_API_URL` változókat add hozzá. A `PORT` értékét a Render automatikusan biztosítja, ezért ott ne hozd létre és ne írd felül. A `WEBSITE_ALLOW_INDEXING=false` beállítást addig meg kell tartani, amíg a végleges `klavierhaus.com` domain nem áll készen az indexelésre.
