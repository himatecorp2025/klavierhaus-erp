"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { buildEventInvitationEmail } = require("../server/transactional-email");
const { createEventService, REFUND_WINDOW_MS } = require("../server/events");

const projectRoot = path.join(__dirname, "..");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/public/branding`);
      if (response.ok) return;
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not become ready");
}

async function request(baseUrl, endpoint, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${endpoint}`, { method, headers, body: body === undefined ? undefined : (multipart ? body : JSON.stringify(body)) });
  const payload = await response.json();
  return { status: response.status, payload };
}

function eventBody(overrides = {}) {
  return {
    category_id: "EVC-SALON-CONCERT",
    access_type: "PUBLIC_FREE",
    slug_en: "manually-supplied-slug-must-be-ignored",
    slug_hu: "a-kezi-azonositot-figyelmen-kivul-kell-hagyni",
    title_en: "Private Salon Evening",
    title_hu: "Privát szalonest",
    short_description_en: "An intimate evening of piano music.",
    short_description_hu: "Meghitt zongoraest.",
    description_en: "A considered programme in the Klavierhaus salon.",
    description_hu: "Gondosan összeállított program a Klavierhaus szalonban.",
    performer_name: "Klavierhaus Artist",
    venue_name: "Klavierhaus",
    venue_street: "790 11th Avenue",
    venue_city: "New York",
    venue_region: "NY",
    venue_postal_code: "10019",
    venue_country: "US",
    start_local: "2031-04-10T19:00",
    end_local: "2031-04-10T21:00",
    capacity_total: 2,
    price_cents: 0,
    ...overrides
  };
}

function eventForm(overrides = {}) {
  const form = new FormData();
  const values = eventBody(overrides);
  for (const [key, value] of Object.entries(values)) form.set(key, String(value ?? ""));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  png.writeUInt32BE(1600, 16);
  png.writeUInt32BE(900, 20);
  form.set("event_image", new Blob([png], { type: "image/png" }), "event.png");
  return form;
}

test("event module enforces roles, capacity, invitations, printable guest lists, refunds, retention, and one-time closure", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-event-api-"));
  const dbPath = path.join(tempRoot, "events.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const uploadDir = path.join(tempRoot, "uploads");
  const password = "Test-password-123";
  const jwtSecret = "event-test-jwt-and-qr-secret-longer-than-thirty-two-characters";
  const init = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);

  const db = new Database(dbPath);
  const hash = bcrypt.hashSync(password, 4);
  const insert = db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,'Active',?,?)");
  insert.run("EV-SA", "Hidden Owner", "event-owner@example.com", hash, "ADMIN", 1, 1);
  insert.run("EV-A", "Event Admin", "event-admin@example.com", hash, "ADMIN", 0, 0);
  insert.run("EV-W", "Event Worker", "event-worker@example.com", hash, "WORKER", 0, 0);
  db.prepare("INSERT INTO website_artists(id,slug_en,slug_hu,name,portrait_url,published) VALUES('EV-ARTIST-1','event-artist','esemeny-muvesz','Event Artist','/assets/media/klavierhaus-artist-salon.png',1)").run();
  db.close();

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(projectRoot, "server", "index.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      BACKUP_DIR: backupDir,
      UPLOAD_DIR: uploadDir,
      JWT_SECRET: jwtSecret,
      WEBSITE_BASE_URL: "https://klavierhaus-home.onrender.com"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  await waitForServer(baseUrl, child).catch((error) => { throw new Error(`${error.message}\n${output}`); });

  const login = async (email) => {
    const result = await request(baseUrl, "/api/login", { method: "POST", body: { email, password } });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    return result.payload.token;
  };
  const superToken = await login("event-owner@example.com");
  const adminToken = await login("event-admin@example.com");
  const workerToken = await login("event-worker@example.com");

  const denied = await request(baseUrl, "/api/events", { token: workerToken });
  assert.equal(denied.status, 403);

  const invalidTimes = await request(baseUrl, "/api/events", {
    token: adminToken,
    method: "POST",
    body: eventBody({ start_local: "2031-04-10T21:00", end_local: "2031-04-10T19:00" })
  });
  assert.equal(invalidTimes.status, 400);
  assert.equal(invalidTimes.payload.error, "EVENT_END_MUST_FOLLOW_START");

  const invalidStep = await request(baseUrl, "/api/events", {
    token: adminToken,
    method: "POST",
    body: eventBody({ start_local: "2031-04-10T19:02" })
  });
  assert.equal(invalidStep.status, 400);
  assert.equal(invalidStep.payload.error, "INVALID_TIME_STEP");

  const missingImage = await request(baseUrl, "/api/events", { token: adminToken, method: "POST", body: eventBody() });
  assert.equal(missingImage.status, 400);
  assert.equal(missingImage.payload.error, "EVENT_IMAGE_REQUIRED");

  const paidWithoutPrice = eventForm({
    access_type: "PUBLIC_PAID",
    title_en: "Invalid zero dollar paid event",
    title_hu: "Hibás nulla dolláros fizetős esemény",
    price_cents: 0,
    publish_now: 1
  });
  const rejectedPaidPublish = await request(baseUrl, "/api/events", { token: adminToken, method: "POST", body: paidWithoutPrice });
  assert.equal(rejectedPaidPublish.status, 400);
  assert.equal(rejectedPaidPublish.payload.error, "PAID_EVENT_PRICE_REQUIRED");

  const atomicPublishForm = eventForm({
    title_en: "Atomically published concert",
    title_hu: "Atomikusan publikált hangverseny",
    start_local: "2031-04-11T19:00",
    end_local: "2031-04-11T21:00",
    publish_now: 1
  });
  const atomicPublish = await request(baseUrl, "/api/events", { token: adminToken, method: "POST", body: atomicPublishForm });
  assert.equal(atomicPublish.status, 201, JSON.stringify(atomicPublish.payload));
  assert.equal(atomicPublish.payload.status, "PUBLISHED");
  assert.ok(atomicPublish.payload.published_at, "an atomic publish must set published_at in the same response");
  const atomicPublic = await request(baseUrl, `/api/public/events/${atomicPublish.payload.slug_en}?lang=en`);
  assert.equal(atomicPublic.status, 200);
  assert.equal(atomicPublic.payload.title, "Atomically published concert");
  const atomicDeleted = await request(baseUrl, `/api/events/${atomicPublish.payload.id}`, { token: adminToken, method: "DELETE" });
  assert.equal(atomicDeleted.status, 200, JSON.stringify(atomicDeleted.payload));

  const created = await request(baseUrl, "/api/events", { token: adminToken, method: "POST", body: eventForm({ artist_id: "EV-ARTIST-1", performer_name: "This text is replaced by the linked profile" }) });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.status, "DRAFT");
  assert.equal(created.payload.slug_en, "private-salon-evening");
  assert.equal(created.payload.slug_hu, "privat-szalonest");
  assert.equal(created.payload.artist_id, "EV-ARTIST-1");
  assert.equal(created.payload.performer_name, "Event Artist");
  assert.match(created.payload.hero_image_url, /^\/uploads\/events\/event-/);
  const eventId = created.payload.id;

  const duplicateSlug = await request(baseUrl, "/api/events", {
    token: adminToken,
    method: "POST",
    body: eventForm({ start_local: "2031-04-10T22:00", end_local: "2031-04-10T23:00" })
  });
  assert.equal(duplicateSlug.status, 201, JSON.stringify(duplicateSlug.payload));
  assert.equal(duplicateSlug.payload.slug_en, "private-salon-evening-2031-04-10");
  assert.equal(duplicateSlug.payload.slug_hu, "privat-szalonest-2031-04-10");
  const duplicateDeleted = await request(baseUrl, `/api/events/${duplicateSlug.payload.id}`, { token: superToken, method: "DELETE" });
  assert.equal(duplicateDeleted.status, 200);
  assert.equal(fs.readdirSync(path.join(uploadDir, "events")).length, 1, "deleting an unpublished event must remove its image file");

  const publicBeforePublish = await request(baseUrl, "/api/public/events");
  assert.equal(publicBeforePublish.status, 200);
  assert.equal(publicBeforePublish.payload.length, 0);

  const published = await request(baseUrl, `/api/events/${eventId}/publish`, { token: adminToken, method: "POST", body: {} });
  assert.equal(published.status, 200, JSON.stringify(published.payload));
  assert.equal(published.payload.status, "PUBLISHED");

  const publicEnglish = await request(baseUrl, "/api/public/events?lang=en");
  const publicHungarian = await request(baseUrl, "/api/public/events?lang=hu");
  assert.equal(publicEnglish.payload.length, 1);
  assert.equal(publicEnglish.payload[0].title, "Private Salon Evening");
  assert.equal(publicHungarian.payload[0].title, "Privát szalonest");
  assert.equal(publicEnglish.payload[0].capacity_remaining, 2);

  const artistDb = new Database(dbPath);
  artistDb.prepare("UPDATE website_artists SET name='Renamed Event Artist' WHERE id='EV-ARTIST-1'").run();
  artistDb.close();
  const renamedArtistEvent = await request(baseUrl, "/api/public/events?lang=en");
  assert.equal(renamedArtistEvent.payload[0].artist_id, "EV-ARTIST-1");
  assert.equal(renamedArtistEvent.payload[0].performer_name, "Renamed Event Artist", "artist renames must not break the event relation");

  const unpublished = await request(baseUrl, `/api/events/${eventId}/unpublish`, { token: adminToken, method: "POST", body: {} });
  assert.equal(unpublished.status, 200, JSON.stringify(unpublished.payload));
  assert.equal(unpublished.payload.status, "DRAFT");
  assert.equal(unpublished.payload.published_at, null);
  assert.equal((await request(baseUrl, "/api/public/events?lang=en")).payload.length, 0, "unpublished events must leave the public programme");
  const republished = await request(baseUrl, `/api/events/${eventId}/publish`, { token: adminToken, method: "POST", body: {} });
  assert.equal(republished.status, 200, JSON.stringify(republished.payload));
  assert.equal(republished.payload.status, "PUBLISHED");

  const workerCalendar = await request(baseUrl, "/api/calendar-events?from=2031-04-10T00:00&to=2031-04-11T00:00", { token: workerToken });
  assert.equal(workerCalendar.status, 200, JSON.stringify(workerCalendar.payload));
  assert.equal(workerCalendar.payload.length, 1);
  assert.equal(workerCalendar.payload[0].calendar_entry_type, "KLAVIERHAUS_EVENT");
  assert.equal(workerCalendar.payload[0].event_id, eventId);
  assert.equal(workerCalendar.payload[0].google_sync_disabled, true);
  assert.equal(Object.hasOwn(workerCalendar.payload[0], "assigned_to"), false, "a cultural event must never become a worker job");
  const workerCalendarDetails = await request(baseUrl, `/api/calendar-events/${eventId}`, { token: workerToken });
  assert.equal(workerCalendarDetails.status, 200);
  assert.equal(workerCalendarDetails.payload.can_manage, false);
  assert.equal(workerCalendarDetails.payload.google_sync_disabled, true);
  const adminCalendarDetails = await request(baseUrl, `/api/calendar-events/${eventId}`, { token: adminToken });
  assert.equal(adminCalendarDetails.payload.can_manage, true);

  const editedPublished = await request(baseUrl, `/api/events/${eventId}`, {
    token: adminToken,
    method: "PUT",
    body: eventBody({
      title_en: "Private Salon Evening — Revised",
      title_hu: "Privát szalonest — módosítva",
      description_en: "",
      description_hu: ""
    })
  });
  assert.equal(editedPublished.status, 200, JSON.stringify(editedPublished.payload));
  assert.equal(editedPublished.payload.slug_en, "private-salon-evening", "a published English URL must remain stable after a title edit");
  assert.equal(editedPublished.payload.slug_hu, "privat-szalonest", "a published Hungarian URL must remain stable after a title edit");
  assert.equal(editedPublished.payload.description_en, "", "the English event description must remain optional");
  assert.equal(editedPublished.payload.description_hu, "", "the Hungarian event description must remain optional");

  const invitation = await request(baseUrl, `/api/events/${eventId}/invitations`, {
    token: adminToken,
    method: "POST",
    body: { guest_name: "Invited Guest", guest_email: "guest@example.com", language: "en" }
  });
  assert.equal(invitation.status, 201, JSON.stringify(invitation.payload));
  assert.match(invitation.payload.invitation_url, /^https:\/\/klavierhaus-home\.onrender\.com\/invitation\//);
  const invitationToken = invitation.payload.invitation_url.split("/").at(-1);

  const pendingCapacity = await request(baseUrl, `/api/events/${eventId}`, { token: adminToken });
  assert.equal(pendingCapacity.payload.capacity.remaining, 2, "a pending invitation must not reserve capacity");

  const invitationView = await request(baseUrl, `/api/public/event-invitations/${invitationToken}`);
  assert.equal(invitationView.status, 200);
  assert.equal(invitationView.payload.status, "PENDING");
  assert.equal(Object.hasOwn(invitationView.payload, "guest_email"), false, "the public invitation response must not expose the email address");

  const accepted = await request(baseUrl, `/api/public/event-invitations/${invitationToken}/respond`, { method: "POST", body: { decision: "ACCEPT" } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload));
  assert.equal(accepted.payload.status, "ACCEPTED");
  const duplicateAccept = await request(baseUrl, `/api/public/event-invitations/${invitationToken}/respond`, { method: "POST", body: { decision: "ACCEPT" } });
  assert.equal(duplicateAccept.status, 409);
  assert.equal(duplicateAccept.payload.error, "INVITATION_ALREADY_ANSWERED");

  const complimentary = await request(baseUrl, `/api/events/${eventId}/complimentary-tickets`, {
    token: adminToken,
    method: "POST",
    body: { attendee_name: "Honorary Guest", contact_email: "honorary@example.com" }
  });
  assert.equal(complimentary.status, 201, JSON.stringify(complimentary.payload));
  assert.equal(Object.hasOwn(complimentary.payload, "qr_token"), false);

  const correctedGuestName = await request(baseUrl, `/api/events/tickets/${complimentary.payload.id}`, {
    token: adminToken,
    method: "PUT",
    body: { attendee_name: "Honorary Guest — Corrected" }
  });
  assert.equal(correctedGuestName.status, 200, JSON.stringify(correctedGuestName.payload));
  assert.equal(correctedGuestName.payload.attendee_name, "Honorary Guest — Corrected");
  const ticketsAfterCorrection = await request(baseUrl, `/api/events/${eventId}/tickets`, { token: adminToken });
  assert.equal(ticketsAfterCorrection.status, 200);
  assert.equal(ticketsAfterCorrection.payload.find((ticket) => ticket.id === complimentary.payload.id)?.attendee_name, "Honorary Guest — Corrected");

  const soldOut = await request(baseUrl, `/api/events/${eventId}/complimentary-tickets`, {
    token: adminToken,
    method: "POST",
    body: { attendee_name: "Too Late", contact_email: "late@example.com" }
  });
  assert.equal(soldOut.status, 409);
  assert.equal(soldOut.payload.error, "EVENT_SOLD_OUT");

  const guestList = await fetch(`${baseUrl}/api/events/${eventId}/guest-list.pdf?lang=hu`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(guestList.status, 200);
  assert.match(guestList.headers.get("content-type") || "", /application\/pdf/);
  const guestListBytes = Buffer.from(await guestList.arrayBuffer());
  assert.equal(guestListBytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(guestListBytes.length > 100000, "the print PDF must embed its Unicode font and premium visual assets");
  const removedCheckIn = await fetch(`${baseUrl}/api/events/check-in`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(removedCheckIn.status, 404);

  const refund = await request(baseUrl, "/api/public/event-refund-requests", {
    method: "POST",
    body: { ticket_code: complimentary.payload.public_code, email: "honorary@example.com", reason: "Unable to attend", name: "Honorary Guest" }
  });
  assert.equal(refund.status, 201, JSON.stringify(refund.payload));
  assert.equal(refund.payload.eligible, true);
  assert.equal(refund.payload.eligibility_code, "CUSTOMER_BEFORE_48H");
  const approvedRefund = await request(baseUrl, `/api/events/refund-requests/${refund.payload.id}`, {
    token: adminToken,
    method: "PUT",
    body: { status: "APPROVED", resolution_note: "Approved under the 48-hour rule" }
  });
  assert.equal(approvedRefund.status, 200);
  assert.equal(approvedRefund.payload.status, "APPROVED");

  const cancelled = await request(baseUrl, `/api/events/${eventId}/cancel`, { token: adminToken, method: "POST", body: { reason: "Artist illness" } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.payload.status, "CANCELLED");
  const ticketAfterCancel = await request(baseUrl, `/api/events/${eventId}/complimentary-tickets`, {
    token: adminToken,
    method: "POST",
    body: { attendee_name: "Cancelled Guest", contact_email: "cancelled@example.com" }
  });
  assert.equal(ticketAfterCancel.status, 409);
  assert.equal(ticketAfterCancel.payload.error, "EVENT_NOT_AVAILABLE");

  const adminDeleteWithRecords = await request(baseUrl, `/api/events/${eventId}`, { token: adminToken, method: "DELETE" });
  assert.equal(adminDeleteWithRecords.status, 409);
  assert.equal(adminDeleteWithRecords.payload.error, "EVENT_CANCEL_REQUIRED");
  const deletePublished = await request(baseUrl, `/api/events/${eventId}`, { token: superToken, method: "DELETE" });
  assert.equal(deletePublished.status, 200);
  assert.equal(deletePublished.payload.ok, true);

  const deletable = await request(baseUrl, "/api/events", {
    token: adminToken,
    method: "POST",
    body: eventForm({ title_en: "Deletable unpublished event", title_hu: "Törölhető nem publikált esemény" })
  });
  assert.equal(deletable.status, 201, JSON.stringify(deletable.payload));
  const deleted = await request(baseUrl, `/api/events/${deletable.payload.id}`, { token: adminToken, method: "DELETE" });
  assert.equal(deleted.status, 200);

  const past = await request(baseUrl, "/api/events", {
    token: adminToken,
    method: "POST",
    body: eventForm({
      access_type: "INTERNAL",
      title_en: "Past internal event",
      title_hu: "Múltbeli belső esemény",
      start_local: "2020-04-10T19:00",
      end_local: "2020-04-10T21:00"
    })
  });
  assert.equal(past.status, 201, JSON.stringify(past.payload));
  const closed = await request(baseUrl, `/api/events/${past.payload.id}/close`, { token: adminToken, method: "POST", body: {} });
  assert.equal(closed.status, 200);
  assert.equal(closed.payload.finance_connected, false);
  const duplicateClose = await request(baseUrl, `/api/events/${past.payload.id}/close`, { token: adminToken, method: "POST", body: {} });
  assert.equal(duplicateClose.status, 409);
  assert.equal(duplicateClose.payload.error, "EVENT_ALREADY_CLOSED");

});

test("event schema migration preserves existing ERP and event records", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-event-migration-"));
  const dbPath = path.join(tempRoot, "existing.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const init = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);
  const db = new Database(dbPath);
  db.prepare("INSERT INTO contacts(id,name) VALUES('EV-C-1','Preserved client')").run();
  db.prepare(`INSERT INTO events(id,event_key,category_id,access_type,status,slug_en,slug_hu,title_en,title_hu,venue_name,venue_street,venue_city,venue_region,venue_postal_code,start_at,end_at,capacity_total)
    VALUES('EV-PRESERVE','EV-KEEP','EVC-SALON-CONCERT','INTERNAL','DRAFT','preserved-event','megorzott-esemeny','Preserved event','Megőrzött esemény','Klavierhaus','790 11th Avenue','New York','NY','10019','2031-01-01T20:00:00.000Z','2031-01-01T22:00:00.000Z',10)`).run();
  db.close();
  const rerun = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
  assert.match(rerun.stdout, /events=1/);
  const migrated = new Database(dbPath, { readonly: true });
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM contacts WHERE id='EV-C-1'").get().count, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM events WHERE id='EV-PRESERVE'").get().count, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM event_categories").get().count, 6);
  assert.equal(migrated.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  migrated.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("event invitation email is bilingual, escapes guest content, and explains capacity-on-acceptance", () => {
  const message = buildEventInvitationEmail({
    name: "<Private Guest>",
    event: {
      title_en: "Salon & Artistry",
      title_hu: "Szalon és művészet",
      venue_name: "Klavierhaus",
      start_at: "2031-04-10T23:00:00.000Z"
    },
    invitationUrl: "https://klavierhaus.com/invitation/private-token"
  });
  assert.match(message.subject, /Private invitation/);
  assert.match(message.text, /Your invitation reserves a place only after you accept it/);
  assert.match(message.text, /A meghívás csak az elfogadás után/);
  assert.match(message.html, /Respond to invitation \/ Válasz a meghívásra/);
  assert.match(message.html, /&lt;Private Guest&gt;/);
  assert.doesNotMatch(message.html, /<Private Guest>/);
});

test("refund eligibility treats exactly 48 hours as non-refundable and cancellations as refundable", () => {
  const db = new Database(":memory:");
  const service = createEventService({ db });
  const now = new Date("2031-01-01T12:00:00.000Z");
  const exactly48Hours = { status: "PUBLISHED", start_at: new Date(now.getTime() + REFUND_WINDOW_MS).toISOString() };
  const moreThan48Hours = { status: "PUBLISHED", start_at: new Date(now.getTime() + REFUND_WINDOW_MS + 1).toISOString() };
  const within48Hours = { status: "PUBLISHED", start_at: new Date(now.getTime() + REFUND_WINDOW_MS - 1).toISOString() };
  assert.deepEqual(service.refundEligibility(exactly48Hours, now), { eligible: false, code: "WITHIN_48_HOURS" });
  assert.deepEqual(service.refundEligibility(moreThan48Hours, now), { eligible: true, code: "CUSTOMER_BEFORE_48H" });
  assert.deepEqual(service.refundEligibility(within48Hours, now), { eligible: false, code: "WITHIN_48_HOURS" });
  assert.deepEqual(service.refundEligibility({ ...within48Hours, status: "CANCELLED" }, now), { eligible: true, code: "EVENT_CANCELLED" });
  db.close();
});
