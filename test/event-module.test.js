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
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json();
  return { status: response.status, payload };
}

function eventBody(overrides = {}) {
  return {
    category_id: "EVC-SALON-CONCERT",
    access_type: "PUBLIC_FREE",
    slug_en: "private-salon-evening",
    slug_hu: "privat-szalonest",
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

test("event module enforces roles, capacity, invitation, QR admission, refunds, retention, and one-time closure", async (t) => {
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
      EVENT_QR_SECRET: jwtSecret,
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

  const created = await request(baseUrl, "/api/events", { token: adminToken, method: "POST", body: eventBody() });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.status, "DRAFT");
  const eventId = created.payload.id;

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
  assert.match(complimentary.payload.qr_token, /^KH1\./);

  const soldOut = await request(baseUrl, `/api/events/${eventId}/complimentary-tickets`, {
    token: adminToken,
    method: "POST",
    body: { attendee_name: "Too Late", contact_email: "late@example.com" }
  });
  assert.equal(soldOut.status, 409);
  assert.equal(soldOut.payload.error, "EVENT_SOLD_OUT");

  const firstAdmission = await request(baseUrl, "/api/events/check-in", { token: adminToken, method: "POST", body: { qr_token: complimentary.payload.qr_token } });
  assert.equal(firstAdmission.status, 200);
  assert.equal(firstAdmission.payload.result, "ACCEPTED");
  const secondAdmission = await request(baseUrl, "/api/events/check-in", { token: adminToken, method: "POST", body: { qr_token: complimentary.payload.qr_token } });
  assert.equal(secondAdmission.status, 409);
  assert.equal(secondAdmission.payload.result, "ALREADY_USED");

  const reverted = await request(baseUrl, `/api/events/tickets/${complimentary.payload.id}/revert-check-in`, {
    token: adminToken,
    method: "POST",
    body: { reason: "Scanner correction" }
  });
  assert.equal(reverted.status, 200);
  assert.equal(reverted.payload.ticket.status, "VALID");
  const readmitted = await request(baseUrl, "/api/events/check-in", { token: adminToken, method: "POST", body: { qr_token: complimentary.payload.qr_token } });
  assert.equal(readmitted.status, 200);

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

  const deletePublished = await request(baseUrl, `/api/events/${eventId}`, { token: superToken, method: "DELETE" });
  assert.equal(deletePublished.status, 409);
  assert.equal(deletePublished.payload.error, "EVENT_RETENTION_REQUIRED");

  const deletable = await request(baseUrl, "/api/events", {
    token: adminToken,
    method: "POST",
    body: eventBody({ slug_en: "deletable-draft", slug_hu: "torolheto-piszkozat", title_en: "Deletable draft", title_hu: "Törölhető piszkozat" })
  });
  assert.equal(deletable.status, 201);
  const adminCannotDelete = await request(baseUrl, `/api/events/${deletable.payload.id}`, { token: adminToken, method: "DELETE" });
  assert.equal(adminCannotDelete.status, 403);
  const deleted = await request(baseUrl, `/api/events/${deletable.payload.id}`, { token: superToken, method: "DELETE" });
  assert.equal(deleted.status, 200);

  const past = await request(baseUrl, "/api/events", {
    token: adminToken,
    method: "POST",
    body: eventBody({
      access_type: "INTERNAL",
      slug_en: "past-internal-event",
      slug_hu: "multbeli-belso-esemeny",
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

  const auditDb = new Database(dbPath, { readonly: true });
  assert.equal(auditDb.prepare("SELECT COUNT(*) count FROM event_closures WHERE event_id=?").get(past.payload.id).count, 1);
  assert.equal(auditDb.prepare("SELECT COUNT(*) count FROM audit_log WHERE action='REVERT_CHECK_IN' AND record_id=?").get(eventId).count, 1);
  assert.equal(auditDb.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(auditDb.prepare("PRAGMA foreign_key_check").all().length, 0);
  auditDb.close();
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
  const service = createEventService({ db, qrSecret: "refund-test-secret-longer-than-thirty-two-characters" });
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
