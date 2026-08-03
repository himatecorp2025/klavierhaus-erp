# Google Calendar → Klavierhaus ERP setup

This integration is intentionally one-way and read-only:

`Google Calendar → Klavierhaus ERP`

ERP changes are never written back to Google. The existing PWA/Web Push keys are not part of this setup and must not be regenerated.

## 1. Prepare the shared calendar

1. Sign in to Google with `klavierhauswork@gmail.com`.
2. Use the account's primary calendar and rename it to **Klavier House Work**, or create a separate calendar with this name.
3. Share the calendar with every employee's Google account and grant permission to add and edit events.
4. If a separate calendar was created, open **Settings and sharing → Integrate calendar** and copy its Calendar ID. Use that value as `GOOGLE_CALENDAR_ID`. If the primary calendar is used, its ID is `klavierhauswork@gmail.com`.

## 2. Create Google Cloud OAuth credentials

1. Create or select a Google Cloud project.
2. Enable the **Google Calendar API**.
3. Configure the OAuth consent screen. Add `klavierhauswork@gmail.com` as a test user if the application is still in testing mode.
4. Create an **OAuth 2.0 Client ID** with application type **Web application**.
5. Add this exact authorized redirect URI:

   `https://YOUR-RENDER-DOMAIN/api/google-calendar/oauth/callback`

6. Copy the Client ID and Client Secret into Render environment variables. Never commit them to GitHub.

## 3. Configure Render

Add these environment variables to the existing Render Web Service:

```text
APP_BASE_URL=https://YOUR-RENDER-DOMAIN
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_TOKEN_ENCRYPTION_KEY=...
GOOGLE_CALENDAR_CENTRAL_EMAIL=klavierhauswork@gmail.com
GOOGLE_CALENDAR_ID=klavierhauswork@gmail.com
GOOGLE_CALENDAR_POLL_INTERVAL_MS=120000
GOOGLE_CALENDAR_INITIAL_LOOKBACK_DAYS=30
```

`GOOGLE_TOKEN_ENCRYPTION_KEY` must be a new random value of at least 32 characters. Do not reuse `JWT_SECRET`. Changing it later makes the already stored Google OAuth tokens unreadable and requires reconnecting the calendar.

The webhook URL is derived automatically from `APP_BASE_URL`:

`https://YOUR-RENDER-DOMAIN/api/google-calendar/webhook`

After saving the variables, redeploy/restart the Render service.

## 4. Connect and map employees

1. Sign in to the ERP as the hidden superadmin.
2. Open **Settings → Google Calendar integration**.
3. Select **Connect Google Calendar** and authorize the `klavierhauswork@gmail.com` account.
4. Open each employee profile and enter the Google email address that employee uses when creating shared-calendar events.
5. Google email addresses must be unique across ERP users.

Admins can see connection state and run a manual synchronization. Only the superadmin can connect or disconnect the central account.

## 5. Operational behavior

- A new Google event is imported as an open ERP job with **Needs review / Ellenőrzésre vár**.
- The creator email selects the initial employee. Unknown creators remain unassigned and require admin review.
- Google title, time, description, location, participants, organizer and source link are retained in the imported information.
- A schedule conflict does not discard the Google event; the job is imported with a warning and cannot be marked reviewed until the conflict is resolved.
- Reassigning the imported job uses the existing in-app and PWA push notification flow.
- Before review, later Google changes update the imported draft. After review, Google changes only raise a warning and never overwrite finalized ERP data.
- Deleting/cancelling the Google source event never deletes the ERP job.
- A superadmin ERP deletion remains a permanent physical job deletion.

## Magyar telepítési összefoglaló

Az integráció kizárólag egyirányú és csak olvasási Google-jogosultságot kér. A közös naptár neve **Klavier House Work**, a központi fiók `klavierhauswork@gmail.com`. A Google Cloudban engedélyezni kell a Google Calendar API-t, Web application típusú OAuth kliens szükséges, és a Render-domainhez tartozó callback URL-t pontosan fel kell venni. A titkok kizárólag Render környezeti változóba kerülhetnek.

A csatlakoztatást és leválasztást csak a szuperadmin végezheti. Az admin kézi szinkront indíthat és ellenőrizheti az importált munkákat. Minden munkatárshoz külön Google Naptár e-mail-cím tartozik a profilban; ez alapján történik a kezdeti kiosztás.
