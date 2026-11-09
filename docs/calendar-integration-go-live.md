# Klavierhaus – Google Calendar / ERP üzembe helyezési ellenőrzőlista

**Állapot:** csak helyileg fejlesztett; GitHub-feltöltés és Render-telepítés külön jóváhagyást igényel.

## Megőrzött működési szabályok

- A weboldali privát időpontigények 07:00 és 21:00 (New York) között adhatók le, az ügyfélszolgálati nyitvatartástól függetlenül.
- A privát időpontigény nem automatikusan végleges találkozó. A Klavierhaus munkatársa telefonon egyeztethet és módosíthatja.
- A privát foglalás nem vizsgálja a Google-események és az ERP-munkák foglaltságát; ezek között megengedett az átfedés.
- A lejárt privát időpontjavaslatok lefoglalása felszabadul.
- A régi központi, Google -> ERP irányú, csak olvasási kapcsolat változatlanul megmarad.

## 1. Dolgozói naptárak – minden érintett munkatársnál külön

1. Az ERP **Settings / Team** oldalán ellenőrizzük az alkalmazott aktív státuszát, e-mail-címét és opcionális **Google calendar email** mezőjét.
2. A munkatárs a Google Calendarban nyissa meg a **Settings > Settings for my calendars > [naptár] > Integrate calendar** menüt, és másolja ki a tényleges **Calendar ID** értéket. Ez nem feltétlenül azonos a bejelentkezési e-mail-címmel.
3. A naptárat ossza meg a **klavierhauswork@gmail.com** központi Google-fiókkal. Beolvasáshoz minimum **See all event details**; Google-ba történő visszaíráshoz **Make changes to events** jogosultság szükséges. A Google Workspace házirendje korlátozhatja a külső megosztást.
4. Az ERP **System Activation & Integrations > Employee calendars** részén az admin állítsa be a Calendar ID-t, kapcsolja be a **Sync enabled** mezőt, majd mentsen.
5. Nyomja meg a **Verify access** gombot. A `SYNCED` vagy `VERIFIED` állapot az olvasási oldal ellenőrzésének eredménye; az írási jogosultság külön engedélyt igényel.
6. Csak indokolt esetben, megfelelő Google-megosztás mellett kapcsolja be a **write enabled** mezőt az adott dolgozónál. A read-only megosztás önmagában nem elegendő Google-visszaíráshoz.
7. A csatlakozási állapotot külön ellenőrizze minden érintettnél, beleértve azokat is, akiknek a naptára korábban `Not Found` hibát adott.

**Hibajelzések:** `CALENDAR_NOT_SHARED_OR_UNKNOWN` = hibás Calendar ID vagy a központi fiók nem fér hozzá; `CALENDAR_PERMISSION_DENIED` = nem megfelelő jogosultság. Először a Google-naptár megosztását kell ellenőrizni, nem új ERP-felhasználót létrehozni.

## 2. Központi írható „master” naptár

1. A cég válasszon ki vagy hozzon létre egy Google-naptárat a központi vállalati időpontoknak. **Az „office@...” e-mail-cím feltételezését nem égettük a kódba.** A tényleges Google Calendar ID-t meg kell állapítani.
2. Ossza meg a kiválasztott naptárat a **klavierhauswork@gmail.com** fiókkal **Make changes to events** jogosultsággal.
3. A Google Calendar adminfelületén válassza a **Connect Google write access** lehetőséget, és **pontosan a klavierhauswork@gmail.com** Google-fiókkal hagyja jóvá a külön OAuth-engedélyt.
4. Írja be és mentse a master Calendar ID-t. Futtassa a **Verify master calendar access** ellenőrzést.
5. A **Enable two-way publishing** opciót csak a korábbi lépések után engedélyezze, majd indítsa a **Run two-way sync** parancsot.
6. Ellenőrizze az ERP és a Google közötti oda-vissza módosítást tesztcélú, egyértelműen azonosítható munkával. Éles ügyfelek eseményeinek próbajellegű módosítása nem ajánlott.

## 3. Mit jelent a kétirányú működés?

- **Google -> ERP:** Google-ban létrehozott munka ismert ügyféllel és zongorával automatikusan munkává alakulhat; a nem egyértelmű esemény ellenőrzésre kerül. Az integrált, linkelt esemény módosítása visszajuthat az ERP-be.
- **ERP -> Google:** a megfelelően konfigurált központi naptárra a munkák, privát időpontok és megfelelő dátummal rendelkező webes kérések kerülnek. A dolgozó saját naptárára csak külön, admin által engedélyezett írás esetén.
- **Tervezett kérések:** a még nem megerősített ügyféligények átlátszó/nem foglaltságot blokkoló Google-eseményekként jelennek meg. Az időpont nélküli webes megkeresések az ERP külön egyeztetési listáján maradnak, mert időpontot nem találunk ki.
- **Ütközések:** párhuzamos Google/ERP-módosításnál vagy az ERP időkorlátainak megsértésekor a rendszer nem írja felül automatikusan a munkát. Az admin a **Calendar conflicts/errors** panelen ellenőrizheti, és külön jóváhagyással az ERP vagy a Google állapotát választhatja.
- **Megszűnt ideiglenes igények:** a rendszer a saját maga által létrehozott Google-eseményeket tudja eltávolítani; az eredetileg Google-ban létrehozott eseményt nem törli automatikusan.

## 4. Kiadási feltételek

- Helyi ERP- és Website-tesztek, Google Calendar mock tesztek, séma-/migráció- és szintaxisellenőrzések legyenek sikeresek.
- Az admin jogosultságok, OAuth állapotok, munkatársi read/write kapcsolók és konfliktuskezelés ellenőrizendők.
- Az éles Google-hozzáférés, a tényleges master ID és a munkatársi naptármegosztások **nem helyettesíthetők** helyi szimulált tesztekkel.
- **GitHub push, develop merge és Render deploy csak a felhasználó külön kifejezett jóváhagyása után.**
