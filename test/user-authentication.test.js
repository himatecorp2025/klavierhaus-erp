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

test("superadmin password reset persists immediately and normalized email login remains case-insensitive", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-user-auth-"));
  const dbPath = path.join(tempRoot, "auth.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const uploadDir = path.join(tempRoot, "uploads");
  const jwtSecret = "test-only-jwt-secret-that-is-longer-than-32-characters";
  const originalPassword = "OriginalPassword7";
  const workerPassword = "WorkerPassword7";

  const init = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);

  const db = new Database(dbPath);
  const insert = db.prepare(`INSERT INTO users(id,name,email,password_hash,role,status,calendar_color,hidden_user,is_superadmin)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  insert.run("U-SA", "Hidden Owner", "owner@example.com", bcrypt.hashSync("OwnerPassword7", 4), "ADMIN", "Active", "#4338CA", 1, 1);
  insert.run("U-ALEX", "Alex", " Alex@KlavierHouse.Local ", bcrypt.hashSync(originalPassword, 4), "ADMIN", "Active", "#2563EB", 0, 0);
  insert.run("U-W", "Worker", "worker@example.com", bcrypt.hashSync(workerPassword, 4), "WORKER", "Active", "#0891B2", 0, 0);
  insert.run("U-INACTIVE", "Inactive User", "inactive@example.com", bcrypt.hashSync("InactivePassword7", 4), "WORKER", "Inactive", "#A16207", 0, 0);
  db.prepare("INSERT INTO contacts(id,name) VALUES('C-AUTH','Preserved client')").run();
  db.prepare("INSERT INTO pianos(id,display_name,owner_contact_id) VALUES('P-AUTH','Preserved piano','C-AUTH')").run();
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

  const login = (email, password) => request(baseUrl, "/api/login", { method: "POST", body: { email, password } });
  const ownerLogin = await login("  OWNER@EXAMPLE.COM ", "OwnerPassword7");
  assert.equal(ownerLogin.status, 200, JSON.stringify(ownerLogin.payload));
  const superToken = ownerLogin.payload.token;

  const legacyEmailLogin = await login("alex@klavierhouse.local", originalPassword);
  assert.equal(legacyEmailLogin.status, 200, JSON.stringify(legacyEmailLogin.payload));
  assert.equal(legacyEmailLogin.payload.user.role, "ADMIN");
  const userIdIsNotAnEmailLogin = await login("U-ALEX", originalPassword);
  assert.equal(userIdIsNotAnEmailLogin.status, 401);
  assert.equal(userIdIsNotAnEmailLogin.payload.error, "INVALID_LOGIN");

  const passwordReset = await request(baseUrl, "/api/users/U-ALEX", {
    token: superToken,
    method: "PUT",
    body: {
      email: "  ALEX@KLAVIERHOUSE.LOCAL ",
      password: "Alex123",
      password_confirmation: "Alex123"
    }
  });
  assert.equal(passwordReset.status, 200, JSON.stringify(passwordReset.payload));
  assert.equal(passwordReset.payload.password_updated, true);
  assert.equal(passwordReset.payload.email, "alex@klavierhouse.local");
  assert.equal(passwordReset.payload.role, "ADMIN");
  assert.equal(passwordReset.payload.status, "Active");
  assert.equal(Object.hasOwn(passwordReset.payload, "password"), false);
  assert.equal(Object.hasOwn(passwordReset.payload, "password_hash"), false);

  const oldPasswordLogin = await login("alex@klavierhouse.local", originalPassword);
  assert.equal(oldPasswordLogin.status, 401);
  assert.equal(oldPasswordLogin.payload.error, "INVALID_LOGIN");
  const wrongCaseLogin = await login("alex@klavierhouse.local", "alex123");
  assert.equal(wrongCaseLogin.status, 401);
  const newPasswordLogin = await login("  Alex@KlavierHouse.Local  ", "Alex123");
  assert.equal(newPasswordLogin.status, 200, JSON.stringify(newPasswordLogin.payload));
  assert.equal(newPasswordLogin.payload.user.role, "ADMIN");
  const adminToken = newPasswordLogin.payload.token;
  const adminMe = await request(baseUrl, "/api/me", { token: adminToken });
  assert.equal(adminMe.status, 200);
  assert.equal(adminMe.payload.role, "ADMIN");
  assert.equal(Number(adminMe.payload.is_superadmin), 0);

  const persisted = new Database(dbPath);
  const alexRow = persisted.prepare("SELECT email,password_hash,role,status FROM users WHERE id='U-ALEX'").get();
  assert.equal(alexRow.email, "alex@klavierhouse.local");
  assert.notEqual(alexRow.password_hash, "Alex123");
  assert.equal(bcrypt.compareSync("Alex123", alexRow.password_hash), true);
  assert.equal(bcrypt.compareSync(originalPassword, alexRow.password_hash), false);
  assert.equal(alexRow.role, "ADMIN");
  assert.equal(alexRow.status, "Active");
  assert.equal(persisted.prepare("SELECT COUNT(*) count FROM contacts WHERE id='C-AUTH'").get().count, 1);
  assert.equal(persisted.prepare("SELECT COUNT(*) count FROM pianos WHERE id='P-AUTH'").get().count, 1);
  persisted.close();

  const mismatch = await request(baseUrl, "/api/users/U-ALEX", {
    token: superToken,
    method: "PUT",
    body: { name: "This name must not persist", password: "DifferentCase7", password_confirmation: "differentcase7" }
  });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.payload.error, "PASSWORD_CONFIRMATION_MISMATCH");
  assert.equal((await login("alex@klavierhouse.local", "Alex123")).status, 200);
  const usersAfterMismatch = await request(baseUrl, "/api/users", { token: superToken });
  assert.equal(usersAfterMismatch.payload.find((item) => item.id === "U-ALEX").name, "Alex");

  const duplicateCreate = await request(baseUrl, "/api/users", {
    token: superToken,
    method: "POST",
    body: {
      name: "Duplicate Alex",
      email: " ALEX@KLAVIERHOUSE.LOCAL ",
      password: "DuplicatePassword7",
      password_confirmation: "DuplicatePassword7",
      role: "WORKER"
    }
  });
  assert.equal(duplicateCreate.status, 409);
  assert.equal(duplicateCreate.payload.error, "USER_EMAIL_ALREADY_USED");

  const createdUser = await request(baseUrl, "/api/users", {
    token: superToken,
    method: "POST",
    body: {
      name: "New Case User",
      email: " New.User@Example.COM ",
      password: "NewUserPassword8",
      password_confirmation: "NewUserPassword8",
      role: "WORKER"
    }
  });
  assert.equal(createdUser.status, 200, JSON.stringify(createdUser.payload));
  assert.equal(createdUser.payload.email, "new.user@example.com");
  assert.equal(Object.hasOwn(createdUser.payload, "password"), false);
  assert.equal(Object.hasOwn(createdUser.payload, "password_hash"), false);
  assert.equal((await login(" NEW.USER@EXAMPLE.COM ", "NewUserPassword8")).status, 200);
  assert.equal((await login("new.user@example.com", "newuserpassword8")).status, 401);

  const workerReset = await request(baseUrl, "/api/users/U-W", {
    token: adminToken,
    method: "PUT",
    body: { password: "CaseSensitive9", password_confirmation: "CaseSensitive9" }
  });
  assert.equal(workerReset.status, 200, JSON.stringify(workerReset.payload));
  assert.equal(workerReset.payload.password_updated, true);
  assert.equal((await login("worker@example.com", workerPassword)).status, 401);
  assert.equal((await login("WORKER@EXAMPLE.COM", "casesensitive9")).status, 401);
  assert.equal((await login(" WORKER@EXAMPLE.COM ", "CaseSensitive9")).status, 200);

  await new Promise((resolve) => setTimeout(resolve, 100));
  const auditResponse = await request(baseUrl, "/api/audit-log?type=TECHNICAL&limit=2000", { token: adminToken });
  assert.equal(auditResponse.status, 200, JSON.stringify(auditResponse.payload));
  const allAuditRows = auditResponse.payload;
  const auditRows = allAuditRows.filter((row) => row.record_id === "U-W");
  const auditText = JSON.stringify(auditRows);
  assert.ok(auditRows.length >= 1, `${JSON.stringify(allAuditRows)}\n${serverOutput}`);
  assert.doesNotMatch(auditText, /CaseSensitive9/);
  assert.doesNotMatch(auditText, /password_hash/);
  assert.doesNotMatch(auditText, /\$2[aby]\$/);

  const inactiveLogin = await login(" inactive@example.com ", "InactivePassword7");
  assert.equal(inactiveLogin.status, 403);
  assert.equal(inactiveLogin.payload.error, "ACCOUNT_INACTIVE");
});
