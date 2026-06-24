# Klavierhaus Cloud ERP + CRM + Scheduler + Knowledge Base v3

Ez a v3 verzió az előző webalkalmazás kibővített változata.

## Tartalom

- Login / belépési felület
- JWT alapú authentikáció
- szerepkörök:
  - ADMIN: Károly, Alex
  - MANAGER: Paul, Misi
  - STAFF: Said
  - VIEWER: külsős olvasó
- CRM
- Piano Registry / zongora-regiszter
- Projects / projektek
- Project Tasks / projektfeladatok
- My Work Today / napi személyes munkalista
- Scheduler / naptár
- On-Site Service / helyszíni munka lezárása
- kötelező munkalezárási mezők
- automatikus pénzügyi journal entry létrehozás
- debit-credit ellenőrzés
- Finance & Trial Balance / pénzügy és főkönyvi kivonat
- Documents / dokumentumtár
- Knowledge Base / tudásbázis
- sötét, reszponzív dashboard

## Indítás

```bash
npm install
cp .env.example .env
npm run init-db
npm start
```

Majd:

```text
http://localhost:3030
```

## Demo belépések

ADMIN:
- karoly@klavierhaus.local / karoly123
- alex@klavierhaus.local / alex123

MANAGER:
- paul@klavierhaus.local / paul123
- misi@klavierhaus.local / misi123

STAFF:
- said@klavierhaus.local / said123

VIEWER:
- viewer@klavierhaus.local / viewer123

## Fontos

Ez működő MVP belső vállalatirányítási rendszer. Éles üzem előtt kell:
- HTTPS
- erős jelszavak
- production DB, például PostgreSQL
- automatikus backup
- audit log bővítés
- CPA/könyvelői validáció
- jogi adatkezelési szabályzat
