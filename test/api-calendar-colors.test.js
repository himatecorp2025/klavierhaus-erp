const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

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
  throw new Error("Server did not become ready within 10 seconds");
}

async function request(baseUrl, endpoint, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

test("calendar-color API enforces roles, follows reassignment and keeps superadmin deletion permanent", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-api-"));
  const dbPath = path.join(tempRoot, "api.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const uploadDir = path.join(tempRoot, "uploads");
  const jwtSecret = "test-only-jwt-secret-that-is-longer-than-32-characters";
  const googleDetailJobId = "J-GOOGLE-DETAIL";
  const googleRawEvent = {
    id: "google-api-detail-test",
    summary: "Imported tuning",
    description: "Imported multiline notes\nSecond line",
    location: "123 Piano Street",
    htmlLink: "https://calendar.google.com/calendar/event?eid=private-link",
    creator: { email: "worker.calendar@gmail.com" },
    organizer: { email: "klavierhauswork@gmail.com" },
    attendees: [{ email: "attendee@example.com" }],
    start: { dateTime: "2031-01-15T13:02:00-05:00" },
    end: { dateTime: "2031-01-15T15:07:00-05:00" }
  };
  const init = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);

  const db = new Database(dbPath);
  const password = "test-password";
  const hash = bcrypt.hashSync(password, 4);
  const insert = db.prepare(`INSERT INTO users(id,name,email,password_hash,role,status,calendar_color,hidden_user,is_superadmin)
    VALUES(?,?,?,?,?,'Active',?,?,?)`);
  insert.run("U-SA", "Hidden Owner", "owner@example.com", hash, "ADMIN", "#4338CA", 1, 1);
  insert.run("U-A", "Admin Test", "admin@example.com", hash, "ADMIN", "#2563EB", 0, 0);
  insert.run("U-W", "Worker Test", "worker@example.com", hash, "WORKER", "#0891B2", 0, 0);
  insert.run("U-M", "Manager Test", "manager@example.com", hash, "MANAGER", "#DB2777", 0, 0);
  db.prepare(`INSERT INTO jobs(id,job_key,workflow_root_id,workflow_step_no,workflow_status,title,job_type,assigned_user_id,assigned_to,created_by_user_id,created_by,status,start_time,end_time,timezone)
    VALUES(?,?,?,1,'ACTIVE',?,'Standalone','U-W','Worker Test','U-A','Admin Test','Open','2031-01-15T13:02','2031-01-15T15:07','America/New_York')`)
    .run(googleDetailJobId,"JK-GOOGLE-DETAIL",googleDetailJobId,googleRawEvent.summary);
  db.prepare(`INSERT INTO external_calendar_events(
    id,provider,calendar_id,external_event_id,external_status,event_etag,creator_email,organizer_email,job_id,review_status,conflict_flag,raw_json
  ) VALUES(?,?,?,?,?,?,?,?,?,'NEEDS_REVIEW',0,?)`).run(
    "ECE-DETAIL","GOOGLE","klavierhauswork@gmail.com",googleRawEvent.id,"confirmed","etag-1",
    googleRawEvent.creator.email,googleRawEvent.organizer.email,googleDetailJobId,JSON.stringify(googleRawEvent)
  );
  db.close();

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(projectRoot, "server", "index.js")], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, BACKUP_DIR: backupDir, UPLOAD_DIR: uploadDir, JWT_SECRET: jwtSecret },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverOutput = "";
  child.stdout.on("data", (chunk) => { serverOutput += chunk; });
  child.stderr.on("data", (chunk) => { serverOutput += chunk; });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  await waitForServer(baseUrl, child).catch((error) => {
    throw new Error(`${error.message}\n${serverOutput}`);
  });

  const staticResponse = await fetch(`${baseUrl}/app.js`, {
    headers: { "Accept-Encoding": "gzip" }
  });
  assert.equal(staticResponse.status, 200);
  assert.match(staticResponse.headers.get("cache-control") || "", /no-cache/);
  assert.ok(staticResponse.headers.get("etag"));
  assert.equal(staticResponse.headers.get("content-encoding"), "gzip");
  await staticResponse.arrayBuffer();

  const login = async (email) => {
    const response = await request(baseUrl, "/api/login", { method: "POST", body: { email, password } });
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    return response.payload.token;
  };
  const superToken = await login("owner@example.com");
  const adminToken = await login("admin@example.com");
  const workerToken = await login("worker@example.com");

  const createdContact = await request(baseUrl, "/api/contacts", { token: workerToken, method: "POST", body: { name: "Detail client" } });
  assert.equal(createdContact.status, 200, JSON.stringify(createdContact.payload));
  const contactDetail = await request(baseUrl, `/api/contacts/${encodeURIComponent(createdContact.payload.id)}`, { token: workerToken });
  assert.equal(contactDetail.status, 200);
  assert.equal(contactDetail.payload.name, "Detail client");
  const createdPiano = await request(baseUrl, "/api/pianos", { token: workerToken, method: "POST", body: { display_name: "Detail piano", owner_contact_id: createdContact.payload.id } });
  assert.equal(createdPiano.status, 200, JSON.stringify(createdPiano.payload));
  const pianoDetail = await request(baseUrl, `/api/pianos/${encodeURIComponent(createdPiano.payload.id)}`, { token: workerToken });
  assert.equal(pianoDetail.status, 200);
  assert.equal(pianoDetail.payload.owner_name, "Detail client");

  const visibleUsers = await request(baseUrl, "/api/users", { token: adminToken });
  assert.equal(visibleUsers.status, 200);
  assert.ok(visibleUsers.payload.every((user) => user.id !== "U-SA"));

  const googleStatus = await request(baseUrl, "/api/google-calendar/status", { token: adminToken });
  assert.equal(googleStatus.status, 200);
  assert.equal(googleStatus.payload.central_email, "klavierhauswork@gmail.com");
  assert.equal(googleStatus.payload.direction, "GOOGLE_TO_ERP");
  const workerGoogleStatus = await request(baseUrl, "/api/google-calendar/status", { token: workerToken });
  assert.equal(workerGoogleStatus.status, 403);

  const googleProfile = await request(baseUrl, "/api/users/U-W", {
    token: adminToken,
    method: "PUT",
    body: { google_calendar_email: "worker.calendar@gmail.com" }
  });
  assert.equal(googleProfile.status, 200);
  assert.equal(googleProfile.payload.google_calendar_email, "worker.calendar@gmail.com");

  const updatedColor = await request(baseUrl, "/api/users/U-W", {
    token: adminToken,
    method: "PUT",
    body: { calendar_color: "#0f766e" }
  });
  assert.equal(updatedColor.status, 200);
  assert.equal(updatedColor.payload.calendar_color, "#0F766E");

  const reserved = await request(baseUrl, "/api/users/U-W", {
    token: adminToken,
    method: "PUT",
    body: { calendar_color: "#EF4444" }
  });
  assert.equal(reserved.status, 400);
  assert.equal(reserved.payload.error, "RESERVED_CALENDAR_COLOR");

  const unauthorized = await request(baseUrl, "/api/users/U-W", {
    token: workerToken,
    method: "PUT",
    body: { calendar_color: "#A16207" }
  });
  assert.equal(unauthorized.status, 403);

  const createdJob = await request(baseUrl, "/api/jobs", {
    token: workerToken,
    method: "POST",
    body: {
      title: "Color integration job",
      assigned_user_id: "U-W",
      start_time: "2031-01-15T10:00",
      end_time: "2031-01-15T12:00"
    }
  });
  assert.equal(createdJob.status, 200, JSON.stringify(createdJob.payload));
  assert.equal(createdJob.payload.assigned_calendar_color, "#0F766E");
  assert.equal(createdJob.payload.planned_minutes, 120);

  const retroactiveJob = await request(baseUrl, "/api/jobs", {
    token: workerToken,
    method: "POST",
    body: {
      title: "Retroactive valid job",
      assigned_user_id: "U-W",
      start_time: "2020-01-10T10:00",
      end_time: "2020-01-10T13:05",
      planned_minutes: 999
    }
  });
  assert.equal(retroactiveJob.status, 200, JSON.stringify(retroactiveJob.payload));
  assert.equal(retroactiveJob.payload.planned_minutes, 185);
  assert.ok(Math.abs(Number(retroactiveJob.payload.planned_hours) - (185 / 60)) < 0.00001);

  const reversedTime = await request(baseUrl, "/api/jobs", {
    token: workerToken,
    method: "POST",
    body: { title: "Reversed", assigned_user_id: "U-W", start_time: "2020-02-01T18:00", end_time: "2020-02-01T15:00" }
  });
  assert.equal(reversedTime.status, 400);
  assert.equal(reversedTime.payload.error, "INVALID_TIME_RANGE");

  const invalidMinuteStep = await request(baseUrl, "/api/jobs", {
    token: workerToken,
    method: "POST",
    body: { title: "Invalid minute", assigned_user_id: "U-W", start_time: "2020-02-01T10:02", end_time: "2020-02-01T11:00" }
  });
  assert.equal(invalidMinuteStep.status, 400);
  assert.equal(invalidMinuteStep.payload.error, "INVALID_TIME_STEP");

  const invalidPlannedDuration = await request(baseUrl, "/api/planned-jobs", {
    token: workerToken,
    method: "POST",
    body: { title: "Bad planned duration", client_name: "Test client", estimated_hours: 3.02 }
  });
  assert.equal(invalidPlannedDuration.status, 400);
  assert.equal(invalidPlannedDuration.payload.error, "INVALID_PLANNED_DURATION");

  const validPlannedDuration = await request(baseUrl, "/api/planned-jobs", {
    token: workerToken,
    method: "POST",
    body: { title: "Good planned duration", client_name: "Test client", estimated_hours: 185 / 60 }
  });
  assert.equal(validPlannedDuration.status, 200, JSON.stringify(validPlannedDuration.payload));
  assert.ok(Math.abs(Number(validPlannedDuration.payload.estimated_hours) - (185 / 60)) < 0.00001);

  const pendingDetail = await request(baseUrl, `/api/jobs/${encodeURIComponent(googleDetailJobId)}`, { token: adminToken });
  assert.equal(pendingDetail.status, 200, JSON.stringify(pendingDetail.payload));
  assert.deepEqual(Object.keys(pendingDetail.payload.calendar_import).sort(), ["attendees","creator","description","end_time","location","start_time","title"]);
  assert.equal(pendingDetail.payload.calendar_import.title, googleRawEvent.summary);
  assert.equal(pendingDetail.payload.calendar_import.description, googleRawEvent.description);
  assert.equal(pendingDetail.payload.calendar_import.location, googleRawEvent.location);
  assert.equal(pendingDetail.payload.calendar_import.creator, googleRawEvent.creator.email);
  assert.deepEqual(pendingDetail.payload.calendar_import.attendees, ["attendee@example.com"]);
  assert.equal(Object.hasOwn(pendingDetail.payload.calendar_import, "organizer"), false);
  assert.equal(Object.hasOwn(pendingDetail.payload.calendar_import, "htmlLink"), false);
  assert.equal(Object.hasOwn(pendingDetail.payload.calendar_import, "external_event_id"), false);

  const editedImportedJob = await request(baseUrl, `/api/jobs/${encodeURIComponent(googleDetailJobId)}`, {
    token: adminToken,
    method: "PUT",
    body: {
      title: googleRawEvent.summary,
      job_type: "Standalone",
      assigned_user_id: "U-W",
      start_time: "2031-01-15T13:02",
      end_time: "2031-01-15T15:07",
      planned_minutes: 125,
      planned_hours: 125 / 60
    }
  });
  assert.equal(editedImportedJob.status, 200, JSON.stringify(editedImportedJob.payload));
  assert.equal(editedImportedJob.payload.start_time, "2031-01-15T13:02");
  assert.equal(editedImportedJob.payload.end_time, "2031-01-15T15:07");
  assert.equal(editedImportedJob.payload.planned_minutes, 125);

  const rangeWithoutRawImport = await request(baseUrl, "/api/jobs?from=2031-01-15T00%3A00&to=2031-01-16T00%3A00", { token: adminToken });
  assert.equal(rangeWithoutRawImport.status, 200);
  const listedGoogleJob=rangeWithoutRawImport.payload.find((job)=>job.id===googleDetailJobId);
  assert.ok(listedGoogleJob);
  assert.equal(Object.hasOwn(listedGoogleJob, "calendar_import"), false);
  assert.equal(Object.hasOwn(listedGoogleJob, "raw_json"), false);

  const reviewedGoogleJob = await request(baseUrl, `/api/jobs/${encodeURIComponent(googleDetailJobId)}/calendar-review`, { token: adminToken, method: "POST" });
  assert.equal(reviewedGoogleJob.status, 200, JSON.stringify(reviewedGoogleJob.payload));
  const reviewedDetail = await request(baseUrl, `/api/jobs/${encodeURIComponent(googleDetailJobId)}`, { token: adminToken });
  assert.equal(reviewedDetail.payload.calendar_import, null);

  const jobsInRange = await request(baseUrl, "/api/jobs?from=2031-01-15T00%3A00&to=2031-01-16T00%3A00", { token: adminToken });
  assert.equal(jobsInRange.status, 200);
  assert.equal(jobsInRange.payload.length, 2);
  const jobsOutsideRange = await request(baseUrl, "/api/jobs?from=2031-01-16T00%3A00&to=2031-01-17T00%3A00", { token: adminToken });
  assert.equal(jobsOutsideRange.status, 200);
  assert.equal(jobsOutsideRange.payload.length, 0);

  const reassigned = await request(baseUrl, `/api/jobs/${encodeURIComponent(createdJob.payload.id)}/reassign`, {
    token: workerToken,
    method: "PUT",
    body: { assigned_user_id: "U-M", reassignment_note: "Test transfer" }
  });
  assert.equal(reassigned.status, 200, JSON.stringify(reassigned.payload));
  assert.equal(reassigned.payload.assigned_user_id, "U-M");
  assert.equal(reassigned.payload.assigned_calendar_color, "#DB2777");

  const deleted = await request(baseUrl, `/api/jobs/${encodeURIComponent(createdJob.payload.id)}`, {
    token: superToken,
    method: "DELETE"
  });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.payload));
  const jobsAfterDelete = await request(baseUrl, "/api/jobs", { token: adminToken });
  assert.ok(jobsAfterDelete.payload.every((job) => job.id !== createdJob.payload.id));
  const verifyDb = new Database(dbPath, { readonly: true });
  assert.equal(verifyDb.prepare("SELECT COUNT(*) count FROM jobs WHERE id=?").get(createdJob.payload.id).count, 0);
  verifyDb.close();
});
