# Klavierhaus marketingintegrációk – beállítási útmutató

Ez az útmutató a jelenlegi adminfelülethez készült. A fejlesztési Render-oldal indexelése továbbra is legyen kikapcsolva. Éles mérés csak megfelelő adatkezelési tájékoztató és cookie-hozzájárulás mellett kapcsolható be.

## 1. Render-környezeti változók

### ERP Web Service (`klavierhaus-erp`)

A Renderben nyisd meg az ERP-szolgáltatást, majd válaszd az **Environment** menüpontot. Add hozzá vagy ellenőrizd:

```text
APP_BASE_URL=https://klavierhaus-erp.onrender.com
WEBSITE_BASE_URL=https://klavierhaus-home.onrender.com
WEBSITE_DEVICE_SECRET=legalább-32-karakteres-külön-véletlen-titok
MARKETING_TOKEN_ENCRYPTION_KEY=legalább-32-karakteres-külön-véletlen-titok
```

Az utolsó két érték ne egyezzen a `JWT_SECRET`, az `EVENT_QR_SECRET` vagy egymás értékével. Mentéskor válaszd a **Save, rebuild, and deploy** lehetőséget.

### Website Web Service (`klavierhaus-home`)

```text
ERP_PUBLIC_API_URL=https://klavierhaus-erp.onrender.com
EVENT_API_TIMEOUT_MS=4000
WEBSITE_BASE_URL=https://klavierhaus-home.onrender.com
WEBSITE_ALLOW_INDEXING=false
```

A `WEBSITE_ALLOW_INDEXING` csak a végleges domain, jogi ellenőrzés és mérési hozzájárulás ellenőrzése után állítható `true` értékre.

## 2. Google Analytics 4

1. Nyisd meg a [Google Analytics](https://analytics.google.com/) oldalt.
2. Az **Adminisztrálás / Admin** nézetben hozz létre vagy válassz ki egy GA4-tulajdont.
3. A **Data collection and modification / Adatgyűjtés és -módosítás** részen nyisd meg a **Data streams / Adatfolyamok** menüt.
4. Hozz létre vagy nyiss meg egy **Web** adatfolyamot a végleges `https://klavierhaus.com` címhez.
5. Másold ki a `G-` kezdetű **Measurement ID / Mérési azonosító** értéket. A hivatalos Google-leírás szerint ezt az adatfolyam részleteinek első sorában találod: [GA4 Measurement ID](https://support.google.com/analytics/answer/12270356).
6. Az ERP-ben nyisd meg: **Marketing → Tracking & Cookies / Követési és cookie-beállítások**.
7. A **Google Analytics 4** kártyán válaszd a **Configure / Beállítás** gombot.
8. Illeszd be a mérési azonosítót, mentsd el, majd válaszd a **Test / Teszt** gombot.

A nyilvános oldal a GA4-kódot csak akkor tölti be, ha a látogató kifejezetten engedélyezte az analitikai cookie-kat.

## 3. Google Search Console

1. Nyisd meg a [Google Search Console](https://search.google.com/search-console/) oldalt.
2. A tulajdonválasztóban válaszd az **Add property / Tulajdon hozzáadása** lehetőséget.
3. A végleges domainhez javasolt a **Domain property / Domain-tulajdon**. Értéke csak `klavierhaus.com`, protokoll és útvonal nélkül.
4. A Google által megadott DNS TXT rekordot add hozzá a domain DNS-kezelőjében, majd végezd el az ellenőrzést. A Domain-tulajdon minden protokollt és aldomaint lefed; ezt a Google hivatalos útmutatója is leírja: [Search Console property](https://support.google.com/webmasters/answer/34592).
5. Az ERP-ben nyisd meg: **Marketing → Tracking & Cookies / Követési és cookie-beállítások**.
6. A **Google Search Console** kártyán válaszd a **Configure / Beállítás** gombot.
7. A tulajdon értéke: `sc-domain:klavierhaus.com`.
8. Mentsd el, majd futtasd a **Test / Teszt** műveletet.

## 4. Google OAuth – Search Console- és GA4-erőforrások lekérése

1. Nyisd meg a [Google Cloud Console](https://console.cloud.google.com/) megfelelő Klavierhaus-projektjét.
2. Engedélyezd a **Google Search Console API** és a **Google Analytics Admin API** szolgáltatást.
3. A **Google Auth Platform → Audience / Közönség** részen külső Gmail-fiókok használata esetén válaszd az **External / Külső** típust, és tesztüzemben add hozzá a használni kívánt Google-fiókot tesztfelhasználóként.
4. Nyisd meg a **Google Auth Platform → Clients / Kliensek** oldalt.
5. Válaszd a **Create Client / Kliens létrehozása** lehetőséget, majd az **Application type / Alkalmazástípus** mezőben a **Web application / Webalkalmazás** típust.
6. Az **Authorized redirect URIs / Engedélyezett átirányítási URI-k** részhez pontosan ezt add hozzá:

   ```text
   https://klavierhaus-erp.onrender.com/api/marketing/google/callback
   ```

   A Google hivatalos webserver OAuth-útmutatója szerint az átirányítási URI-t a webalkalmazás kliensénél előre kell rögzíteni: [OAuth 2.0 web server applications](https://developers.google.com/identity/protocols/oauth2/web-server).
7. Másold ki a **Client ID / Kliensazonosító** és **Client Secret / Kliens titka** értéket. A titkot ne tedd GitHubra és ne másold a `.env.example` fájlba.
8. Szuperadminként az ERP-ben nyisd meg: **Marketing → Tracking & Cookies / Követési és cookie-beállítások**.
9. A **Google OAuth** kártyán válaszd a **Configure / Beállítás** gombot, add meg a kliensazonosítót és a titkot, majd mentsd.
10. Válaszd a **Connect Google / Google csatlakoztatása** gombot, jelentkezz be, és engedélyezd a csak olvasási hozzáférést.
11. Visszatérés után válaszd a **Sync resources / Erőforrások szinkronja** lehetőséget. A rendszer valós Search Console-tulajdonokat és GA4-fiókösszesítőket kér le; csatlakozás nélkül nem jelenít meg kitalált adatot.

## 5. Microsoft Clarity

1. Nyisd meg a [Microsoft Clarity](https://clarity.microsoft.com/) oldalt, és hozz létre egy projektet a Klavierhaus weboldalhoz.
2. A projektben nyisd meg a **Settings → Setup / Beállítások → Telepítés** oldalt.
3. Másold ki a projekt azonosítóját. A Microsoft hivatalos útmutatója szerint a projekt egyedi követőkóddal és Project ID-val rendelkezik: [Clarity setup](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup).
4. Az ERP-ben nyisd meg: **Marketing → Tracking & Cookies / Követési és cookie-beállítások**.
5. A **Microsoft Clarity** kártyán válaszd a **Configure / Beállítás** gombot, illeszd be a Project ID-t, mentsd, majd teszteld.

A Clarity-kód is csak a látogató analitikai hozzájárulása után töltődik be. A hőtérképeket és munkamenet-felvételeket a Clarity saját felületén kell megtekinteni; az ERP nem gyárt helyettesítő vagy becsült adatokat.

## 6. Ellenőrzési sorrend

1. A Website oldalon töröld vagy privát ablakban nyisd meg a cookie-választást.
2. Elutasításkor ellenőrizd, hogy GA4 és Clarity nem töltődik be.
3. Engedélyezd az analitikát, majd ellenőrizd a böngésző hálózati paneljén a GA4- és Clarity-kéréseket.
4. Az ERP **Marketing Overview / Marketing áttekintő** nézetében ellenőrizd a hozzájárulással mért belső eseményeket.
5. A **Search Performance / Keresési teljesítmény** és **Web Analytics / Webanalitika** nézetben ellenőrizd a szolgáltatói kapcsolat állapotát.
6. A Search Console-adatok megjelenése nem azonnali; csak valós szolgáltatói adat kerülhet a riportokba.

## 7. Biztonsági szabályok

- OAuth kliens titka, frissítő token és titkosítási kulcs nem kerülhet GitHubra, publikus JavaScriptbe, auditnaplóba vagy API-válaszba.
- Integrációs titkot kizárólag a szuperadmin módosíthat.
- A fejlesztési Render-domain maradjon `noindex` állapotban.
- Az analitikai és a marketing-hozzájárulás külön választás.
- Az adatkezelési és cookie-szövegeket élesítés előtt amerikai és magyar jogi szakértővel is ellenőrizni kell.
