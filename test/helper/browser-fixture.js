const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const dbPath = process.env.DB_PATH;
if (!dbPath) throw new Error("DB_PATH is required");

function newYorkDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const db = new Database(dbPath);
const hash = bcrypt.hashSync("test-password", 4);
const insertUser = db.prepare(`INSERT INTO users(id,name,email,password_hash,role,status,calendar_color,hidden_user,is_superadmin)
  VALUES(?,?,?,?,?,'Active',?,?,?)`);
insertUser.run("U-SA", "Hidden Owner", "owner@example.com", hash, "ADMIN", "#4338CA", 1, 1);
insertUser.run("U-ADMIN", "Admin Test", "admin@example.com", hash, "ADMIN", "#2563EB", 0, 0);
insertUser.run("U-K", "Károly", "karoly@example.com", hash, "ADMIN", "#2563EB", 0, 0);
insertUser.run("U-M", "Misi", "misi@example.com", hash, "MANAGER", "#EA580C", 0, 0);
insertUser.run("U-S", "Said", "said@example.com", hash, "WORKER", "#92400E", 0, 0);

const date = newYorkDate();
const insertJob = db.prepare(`INSERT INTO jobs(
  id,job_key,workflow_root_id,workflow_step_no,workflow_status,title,job_type,assigned_user_id,assigned_to,
  created_by_user_id,created_by,status,start_time,end_time,timezone
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const addJob = ({ id, title, userId, name, status, start, end, workflowStatus = "ACTIVE" }) => {
  insertJob.run(id, `JK-${id}`, id, 1, workflowStatus, title, "Standalone", userId, name, "U-ADMIN", "Admin Test", status, `${date}T${start}`, `${date}T${end}`, "America/New_York");
};
addJob({ id: "J-ACTIVE", title: "Active employee-color job", userId: "U-ADMIN", name: "Admin Test", status: "Open", start: "20:00", end: "21:30" });
addJob({ id: "J-OVERDUE", title: "Overdue warning job", userId: "U-K", name: "Károly", status: "Open", start: "07:00", end: "07:30" });
addJob({ id: "J-PARTIAL", title: "Partially completed job", userId: "U-M", name: "Misi", status: "Partially completed", start: "10:00", end: "11:00", workflowStatus: "IN_PROGRESS" });
addJob({ id: "J-COMPLETE", title: "Fully completed job", userId: "U-S", name: "Said", status: "Completed", start: "12:00", end: "13:00", workflowStatus: "COMPLETED" });
addJob({ id: "J-FAILED", title: "Failed warning job", userId: "U-S", name: "Said", status: "Failed", start: "14:00", end: "15:00", workflowStatus: "FAILED" });

db.close();
