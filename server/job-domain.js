"use strict";

const SCHEDULE_INTERVAL_MINUTES = 15;
const JOB_TIMEZONE = "America/New_York";

function clean(value, max = 4000) { return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max); }
function localDateTimeValue(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second = "0"] = match;
  const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const date = new Date(stamp);
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day) || date.getUTCHours() !== Number(hour) || date.getUTCMinutes() !== Number(minute)) return NaN;
  return stamp;
}
function isValidTimeRange(startTime, endTime) {
  const start = localDateTimeValue(startTime), end = localDateTimeValue(endTime);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}
function isScheduleTime(value) {
  const match = String(value || "").trim().match(/^\d{4}-\d{2}-\d{2}T\d{2}:(\d{2})(?::(\d{2}))?$/);
  return Boolean(match) && Number(match[1]) % SCHEDULE_INTERVAL_MINUTES === 0 && Number(match[2] || 0) === 0 && Number.isFinite(localDateTimeValue(value));
}
function timeRangeMinutes(startTime, endTime) {
  const start = localDateTimeValue(startTime), end = localDateTimeValue(endTime);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 60000) : 0;
}
function isScheduleDurationHours(value) {
  const minutes = Number(value) * 60;
  return Number.isFinite(minutes) && minutes > 0 && Math.abs(minutes - Math.round(minutes)) < 0.0001 && Math.round(minutes) % SCHEDULE_INTERVAL_MINUTES === 0;
}
function nyDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JOB_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function normalizeMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}
function domainError(code, status = 400, details = null) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function createJobDomain({ db, rid, balanceAccountFromPaymentMethod = () => "BANK" }) {
  function postFinancialItemOnce({ itemDate, title, description = "", amount, mainType, category, paymentMethod = "", jobId = null, clientId = null, pianoId = null, sourceType, sourceId, createdBy = "System" }) {
    if (!sourceType || !sourceId) throw new Error("FINANCIAL_SOURCE_REQUIRED");
    const existing = db.prepare("SELECT * FROM financial_items WHERE source_type=? AND source_id=? LIMIT 1").get(sourceType, sourceId);
    if (existing) return existing;
    const normalizedAmount = normalizeMoney(amount);
    if (normalizedAmount <= 0) return null;
    const id = rid("FI");
    db.prepare(`INSERT INTO financial_items(
      id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,source_type,source_id,created_by
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, itemDate || nyDateKey(), clean(title, 500), clean(description, 8000), normalizedAmount,
      mainType === "EXPENSE" ? "EXPENSE" : "INCOME", clean(category, 120) || (mainType === "EXPENSE" ? "OTHER_EXPENSE" : "SERVICE_REVENUE"), "ONE_TIME",
      paymentMethod || "", balanceAccountFromPaymentMethod(paymentMethod), jobId || null, clientId || null, pianoId || null,
      clean(sourceType, 120), clean(sourceId, 500), clean(createdBy, 200) || "System"
    );
    return db.prepare("SELECT * FROM financial_items WHERE id=?").get(id);
  }

  function postClosedJobRevenue(job, { logId = null, billedAmount = 0, paymentMethod = "", createdBy = "System", itemDate = null } = {}) {
    const amount = normalizeMoney(billedAmount);
    if (amount <= 0) return null;
    return postFinancialItemOnce({
      itemDate: itemDate || (job.completed_at ? String(job.completed_at).slice(0, 10) : nyDateKey()),
      title: `Closed job revenue / Lezárt munka bevétele: ${job.title || job.job_key || job.id}`,
      description: [
        job.client_name ? `Client / Ügyfél: ${job.client_name}` : "",
        job.piano_name ? `Piano / Zongora: ${job.piano_name}` : "",
        logId ? `Job log / Lezárási napló: ${logId}` : ""
      ].filter(Boolean).join("\n"),
      amount,
      mainType: "INCOME",
      category: "SERVICE_REVENUE",
      paymentMethod,
      jobId: job.id,
      clientId: job.client_id,
      pianoId: job.piano_id,
      sourceType: "job_close_revenue",
      sourceId: `JOB_CLOSE:${job.id}`,
      createdBy
    });
  }

  function patchJobSchedule({ jobId, startTime, endTime, assignedUser, actor = {}, reassignmentNote = "Calendar drag/drop", findConflicts = () => [] }) {
    const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId);
    if (!job) throw domainError("JOB_NOT_FOUND", 404);
    if (["Completed", "Partially completed", "Failed", "Cancelled"].includes(String(job.status || ""))) throw domainError("JOB_NOT_MOVABLE", 409);
    if (!assignedUser?.id || !assignedUser?.name) throw domainError("INVALID_ASSIGNEE", 400);
    if (!isValidTimeRange(startTime, endTime)) throw domainError("INVALID_TIME_RANGE", 400);
    if (!isScheduleTime(startTime) || !isScheduleTime(endTime)) throw domainError("INVALID_TIME_STEP", 400, { interval_minutes: SCHEDULE_INTERVAL_MINUTES });
    const conflicts = findConflicts(assignedUser.id, assignedUser.name, startTime, endTime, job.id) || [];
    if (conflicts.length) throw domainError("SCHEDULE_CONFLICT", 409, { conflicts });
    const minutes = timeRangeMinutes(startTime, endTime);
    const changedAssignee = String(job.assigned_user_id || "") !== String(assignedUser.id);
    const update = db.transaction(() => {
      db.prepare(`UPDATE jobs SET start_time=?,end_time=?,assigned_user_id=?,assigned_to=?,planned_minutes=?,planned_hours=?,timezone=?,
        last_reassigned_by=CASE WHEN ? THEN ? ELSE last_reassigned_by END,
        last_reassigned_by_user_id=CASE WHEN ? THEN ? ELSE last_reassigned_by_user_id END,
        reassignment_note=CASE WHEN ? THEN ? ELSE reassignment_note END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(startTime, endTime, assignedUser.id, assignedUser.name, minutes, minutes / 60, JOB_TIMEZONE,
          changedAssignee ? 1 : 0, actor.name || "", changedAssignee ? 1 : 0, actor.id || null, changedAssignee ? 1 : 0, reassignmentNote, job.id);
      if (job.workflow_id) {
        db.prepare("UPDATE workshop_workflows SET final_due_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(endTime, job.workflow_id);
        db.prepare("UPDATE workflow_stages SET due_at=?,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=? AND stage_code='FINAL_HANDOVER'").run(endTime, job.workflow_id);
      }
      return db.prepare("SELECT * FROM jobs WHERE id=?").get(job.id);
    });
    return { job: update(), previous: job, assigneeChanged: changedAssignee, conflicts: [] };
  }

  function closeoutJobOrchestration({
    jobId,
    source = "DIRECT",
    actor = {},
    closeType = "Full",
    financialEntries = [],
    mutate = null,
    now = new Date().toISOString(),
    complete = true
  }) {
    const run = db.transaction(() => {
      const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId);
      if (!job) throw domainError("JOB_NOT_FOUND", 404);
      if (complete && String(job.status || "") === "Completed" && String(job.financial_status || "") === "POSTED") {
        return { job, financialItems: [], idempotent: true, mutation: null };
      }
      const workflow = job.workflow_id ? db.prepare("SELECT * FROM workshop_workflows WHERE id=?").get(job.workflow_id) : null;
      const mutation = typeof mutate === "function" ? mutate({ job, workflow, now, source, closeType }) : null;
      const posted = [];
      const entries = typeof financialEntries === "function" ? (financialEntries({ job, mutation, now, source, closeType }) || []) : (financialEntries || []);
      for (const entry of entries) {
        const item = postFinancialItemOnce({
          ...entry,
          jobId: entry.jobId || job.id,
          clientId: entry.clientId === undefined ? job.client_id : entry.clientId,
          pianoId: entry.pianoId === undefined ? job.piano_id : entry.pianoId,
          createdBy: entry.createdBy || actor.name || "System"
        });
        if (item) posted.push(item);
      }
      const primary = posted[0] || db.prepare("SELECT * FROM financial_items WHERE job_id=? ORDER BY created_at,id LIMIT 1").get(job.id) || null;
      if (complete) {
        db.prepare(`UPDATE jobs SET status='Completed',workflow_status='COMPLETED',finalized_at=COALESCE(finalized_at,?),completed_at=COALESCE(completed_at,?),
          financial_status='POSTED',financial_ledger_id=COALESCE(financial_ledger_id,?),closed_at=COALESCE(closed_at,?),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(now, now, primary?.id || null, now, job.id);
        if (job.workflow_id) {
          db.prepare(`UPDATE workshop_workflows SET current_status='COMPLETED',financial_status='CLOSED',financial_closed_at=COALESCE(financial_closed_at,?),
            financial_closed_by_user_id=COALESCE(financial_closed_by_user_id,?),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(now, actor.id || null, job.workflow_id);
        }
      } else if (posted.length) {
        db.prepare("UPDATE jobs SET financial_status='POSTED',financial_ledger_id=COALESCE(financial_ledger_id,?),updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(primary?.id || null, job.id);
      }
      return { job: db.prepare("SELECT * FROM jobs WHERE id=?").get(job.id), financialItems: posted, idempotent: false, mutation };
    });
    return run();
  }

  return { postFinancialItemOnce, postClosedJobRevenue, patchJobSchedule, closeoutJobOrchestration };
}

module.exports = {
  SCHEDULE_INTERVAL_MINUTES,
  JOB_TIMEZONE,
  localDateTimeValue,
  isValidTimeRange,
  isScheduleTime,
  isScheduleDurationHours,
  timeRangeMinutes,
  nyDateKey,
  createJobDomain
};
