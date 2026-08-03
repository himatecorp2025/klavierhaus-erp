const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createGoogleCalendarIntegration } = require("../server/google-calendar");

const projectRoot = path.join(__dirname, "..");

function setup(fetchImpl = async () => { throw new Error("unexpected network request"); }) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(projectRoot, "server", "schema.sql"), "utf8"));
  db.prepare(`INSERT INTO users(id,name,email,password_hash,role,status,calendar_color,google_calendar_email,hidden_user,is_superadmin)
    VALUES('U-A','Admin','admin@example.com','x','ADMIN','Active','#2563EB','admin.calendar@gmail.com',0,0)`).run();
  db.prepare(`INSERT INTO users(id,name,email,password_hash,role,status,calendar_color,google_calendar_email,hidden_user,is_superadmin)
    VALUES('U-W','Worker','worker@example.com','x','WORKER','Active','#0891B2','worker.calendar@gmail.com',0,0)`).run();
  const notifications = [];
  let counter = 0;
  const rid = (prefix) => `${prefix}-${++counter}`;
  const getJob = (id) => db.prepare(`SELECT j.*,u.calendar_color assigned_calendar_color,e.provider calendar_source,e.review_status calendar_review_status,
    e.conflict_flag calendar_conflict_flag,e.creator_email calendar_creator_email
    FROM jobs j LEFT JOIN users u ON u.id=j.assigned_user_id LEFT JOIN external_calendar_events e ON e.job_id=j.id WHERE j.id=?`).get(id);
  const findScheduleConflicts = (userId, _name, start, end, exclude = null) => {
    let sql = "SELECT * FROM jobs WHERE assigned_user_id=? AND status<>'Cancelled' AND ?<end_time AND ?>start_time";
    const params = [userId, start, end];
    if (exclude) { sql += " AND id<>?"; params.push(exclude); }
    return db.prepare(sql).all(...params);
  };
  const integration = createGoogleCalendarIntegration({
    db,
    rid,
    stableJobKey: () => `JK-${++counter}`,
    nyLocalDateTime: (date) => new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(date).replace(" ", "T"),
    findScheduleConflicts,
    getJob,
    createNotification: (payload) => { notifications.push(payload); return payload; },
    env: {
      GOOGLE_CLIENT_ID: "client",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_TOKEN_ENCRYPTION_KEY: "separate-test-encryption-key-at-least-32-chars",
      APP_BASE_URL: "https://erp.example.com",
      GOOGLE_CALENDAR_ID: "klavierhauswork@gmail.com",
      GOOGLE_CALENDAR_CENTRAL_EMAIL: "klavierhauswork@gmail.com"
    },
    fetchImpl
  });
  return { db, notifications, integration, getJob };
}

function googleEvent(overrides = {}) {
  return {
    id: "event-1",
    etag: "\"v1\"",
    status: "confirmed",
    summary: "Tuning",
    description: "Customer asked for concert preparation.",
    location: "123 Piano Street",
    htmlLink: "https://calendar.google.com/event?eid=test",
    creator: { email: "worker.calendar@gmail.com" },
    organizer: { email: "klavierhauswork@gmail.com" },
    start: { dateTime: "2032-08-04T14:00:00-04:00" },
    end: { dateTime: "2032-08-04T16:00:00-04:00" },
    updated: "2032-08-01T12:00:00Z",
    ...overrides
  };
}

test("Google token encryption never stores plaintext", () => {
  const { db, integration } = setup();
  const encrypted = integration._test.encrypt("refresh-token-value");
  assert.doesNotMatch(encrypted, /refresh-token-value/);
  assert.equal(integration._test.decrypt(encrypted), "refresh-token-value");
  const authUrl = new URL(integration.createAuthUrl("U-A"));
  assert.equal(authUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.readonly");
  assert.equal(authUrl.searchParams.get("access_type"), "offline");
  assert.equal(authUrl.searchParams.get("redirect_uri"), "https://erp.example.com/api/google-calendar/oauth/callback");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM calendar_oauth_states").get().count, 1);
  integration.stop();
  db.close();
});

test("Google event imports, maps creator, notifies, protects reviewed ERP data and keeps cancelled jobs", () => {
  const { db, notifications, integration, getJob } = setup();
  const imported = integration._test.processEvent(googleEvent());
  assert.equal(imported.imported, 1);
  const external = db.prepare("SELECT * FROM external_calendar_events WHERE external_event_id='event-1'").get();
  const job = getJob(external.job_id);
  assert.equal(job.assigned_user_id, "U-W");
  assert.equal(job.assigned_to, "Worker");
  assert.equal(job.start_time, "2032-08-04T14:00");
  assert.equal(job.calendar_review_status, "NEEDS_REVIEW");
  assert.match(job.instructions, /Customer asked for concert preparation/);
  assert.ok(notifications.some((item) => item.type === "GOOGLE_EVENT_REVIEW_REQUIRED" && item.recipientUserId === "U-A"));
  assert.ok(notifications.some((item) => item.type === "GOOGLE_EVENT_IMPORTED" && item.recipientUserId === "U-W"));

  integration.markReviewed(job.id, "U-A");
  assert.equal(getJob(job.id).calendar_review_status, "REVIEWED");

  integration._test.processEvent(googleEvent({ etag: "\"v2\"", summary: "Google changed title", updated: "2032-08-02T12:00:00Z" }));
  assert.equal(getJob(job.id).title, "Tuning");
  assert.equal(getJob(job.id).calendar_review_status, "SOURCE_CHANGED");
  assert.ok(notifications.some((item) => item.type === "GOOGLE_EVENT_SOURCE_CHANGED"));

  integration._test.processEvent(googleEvent({ etag: "\"v3\"", status: "cancelled", updated: "2032-08-03T12:00:00Z" }));
  assert.ok(getJob(job.id));
  assert.equal(getJob(job.id).calendar_review_status, "SOURCE_CANCELLED");
  integration.stop();
  db.close();
});

test("conflicting Google event is imported and cannot be reviewed until resolved", () => {
  const { db, integration, getJob } = setup();
  db.prepare(`INSERT INTO jobs(id,title,assigned_user_id,assigned_to,status,start_time,end_time)
    VALUES('J-EXISTING','Existing work','U-W','Worker','Open','2032-08-04T15:00','2032-08-04T17:00')`).run();
  const result = integration._test.processEvent(googleEvent({ id: "event-conflict" }));
  assert.equal(result.imported, 1);
  assert.equal(result.flagged, 1);
  const external = db.prepare("SELECT * FROM external_calendar_events WHERE external_event_id='event-conflict'").get();
  assert.equal(external.conflict_flag, 1);
  assert.throws(() => integration.markReviewed(external.job_id, "U-A"), /GOOGLE_EVENT_CONFLICT_UNRESOLVED/);
  db.prepare("UPDATE jobs SET start_time='2032-08-04T18:00',end_time='2032-08-04T20:00' WHERE id=?").run(external.job_id);
  const reviewed = integration.markReviewed(external.job_id, "U-A");
  assert.equal(getJob(reviewed.id).calendar_review_status, "REVIEWED");
  integration.stop();
  db.close();
});

test("incremental synchronization reads the central calendar and stores a sync token", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url).includes("/events?")) {
      return new Response(JSON.stringify({ items: [googleEvent({ id: "event-sync" })], nextSyncToken: "sync-token-1" }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
    if (String(url).endsWith("/calendars/klavierhauswork%40gmail.com")) {
      return new Response(JSON.stringify({ summary: "Klavierhaus Work" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const { db, integration } = setup(fetchImpl);
  db.prepare(`UPDATE calendar_integrations SET status='CONNECTED',access_token_encrypted=?,refresh_token_encrypted=?,token_expiry=? WHERE provider='GOOGLE'`)
    .run(integration._test.encrypt("access-token"), integration._test.encrypt("refresh-token"), new Date(Date.now() + 3600000).toISOString());
  const result = await integration.syncNow("TEST");
  assert.equal(result.imported, 1);
  const row = db.prepare("SELECT calendar_summary,sync_token,last_error FROM calendar_integrations WHERE provider='GOOGLE'").get();
  assert.equal(row.calendar_summary, "Klavierhaus Work");
  assert.equal(row.sync_token, "sync-token-1");
  assert.equal(row.last_error, null);
  assert.ok(requests.some((url) => url.includes("timeMin=")));
  integration.stop();
  db.close();
});
