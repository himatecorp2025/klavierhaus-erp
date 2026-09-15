"use strict";

const { normalizePaymentMethod } = require("./payment-methods");

const SCHEDULE_INTERVAL_MINUTES = 15;
const JOB_TIMEZONE = "America/New_York";
const TECHNICIAN_DAILY_BASE_RATE = 300;

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

function createJobDomain({ db, rid, balanceAccountFromPaymentMethod = () => "BANK", invoiceEngine = null }) {
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
      normalizePaymentMethod(paymentMethod) || "", balanceAccountFromPaymentMethod(normalizePaymentMethod(paymentMethod) || ""), jobId || null, clientId || null, pianoId || null,
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
      sourceType: "JOB_REVENUE",
      sourceId: `JOB_REVENUE:${job.id}`,
      createdBy
    });
  }


  function employeeDailyRateForDate(userId, dateStr) {
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return null;
    return db.prepare(`SELECT * FROM employee_daily_rates WHERE user_id=? AND effective_date<=? ORDER BY effective_date DESC, created_at DESC LIMIT 1`).get(userId, dateStr) || null;
  }

  function activeDailyRateJobs(userId, dateStr, excludeJobId = null) {
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return [];
    return db.prepare(`SELECT id,daily_rate_allocated_amount,created_at FROM jobs
      WHERE assigned_user_id=? AND daily_rate_date=? AND COALESCE(daily_rate_enabled,0)=1
        AND (? IS NULL OR id<>?) AND COALESCE(status,'Open') NOT IN ('Cancelled','Failed')
      ORDER BY CASE WHEN COALESCE(daily_rate_allocated_amount,0)>0 THEN 0 ELSE 1 END, created_at, id`).all(userId, dateStr, excludeJobId, excludeJobId);
  }

  function dailyRateAllocationSummary({ userId, dateStr, excludeJobId = null }) {
    const current = excludeJobId ? db.prepare("SELECT id,assigned_user_id,daily_rate_date,daily_rate_enabled,daily_rate_allocated_amount,status FROM jobs WHERE id=?").get(excludeJobId) : null;
    const otherJobs = activeDailyRateJobs(userId, dateStr, excludeJobId);
    const currentOwnsBase = Boolean(current && String(current.assigned_user_id || "") === String(userId || "") && String(current.daily_rate_date || "") === String(dateStr || "") && Number(current.daily_rate_enabled || 0) === 1 && !["Cancelled", "Failed"].includes(String(current.status || "")) && normalizeMoney(current.daily_rate_allocated_amount) > 0);
    const alreadyActivated = otherJobs.length > 0;
    const suggested = currentOwnsBase ? TECHNICIAN_DAILY_BASE_RATE : (alreadyActivated ? 0 : TECHNICIAN_DAILY_BASE_RATE);
    return {
      rate: { user_id: userId, rate: TECHNICIAN_DAILY_BASE_RATE, currency: "USD", effective_date: String(dateStr || ""), fixed_base: true },
      limit: TECHNICIAN_DAILY_BASE_RATE,
      allocated: alreadyActivated ? TECHNICIAN_DAILY_BASE_RATE : 0,
      available: alreadyActivated ? 0 : TECHNICIAN_DAILY_BASE_RATE,
      suggested_allocation: suggested,
      current_owns_base: currentOwnsBase,
      base_rate_already_activated: alreadyActivated && !currentOwnsBase,
      active_job_count: otherJobs.length + (currentOwnsBase ? 1 : 0)
    };
  }

  function rebalanceDailyRateAllocations({ userId, dateStr }) {
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return { changed: 0, winner_job_id: null };
    const rows = activeDailyRateJobs(userId, dateStr, null);
    const winner = rows[0] || null;
    const update = db.prepare("UPDATE jobs SET daily_rate_allocated_amount=?,daily_rate_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
    let changed = 0;
    for (const row of rows) {
      const next = row.id === winner?.id ? TECHNICIAN_DAILY_BASE_RATE : 0;
      if (Math.abs(normalizeMoney(row.daily_rate_allocated_amount) - next) > 0.0001) { update.run(next, dateStr, row.id); changed += 1; }
    }
    return { changed, winner_job_id: winner?.id || null, active_job_count: rows.length };
  }

  function validateDailyRateAllocation({ userId, dateStr, jobId = null, enabled = false }) {
    if (!enabled) return { enabled: false, date: dateStr || null, requested: 0, limit: TECHNICIAN_DAILY_BASE_RATE, allocated: 0, available: TECHNICIAN_DAILY_BASE_RATE, suggested_allocation: 0 };
    if (!userId) throw domainError("DAILY_RATE_EMPLOYEE_REQUIRED", 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) throw domainError("INVALID_DAILY_RATE_DATE", 400);
    const summary = dailyRateAllocationSummary({ userId, dateStr, excludeJobId: jobId });
    return { enabled: true, date: dateStr, requested: summary.suggested_allocation, ...summary };
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
    const targetDate = String(startTime).slice(0, 10);
    const minutes = timeRangeMinutes(startTime, endTime);
    const changedAssignee = String(job.assigned_user_id || "") !== String(assignedUser.id);
    const previousDate = String(job.daily_rate_date || job.start_time || "").slice(0, 10);
    const dailyEnabled = Number(job.daily_rate_enabled || 0) === 1;
    const bucketChanged = dailyEnabled && (changedAssignee || previousDate !== targetDate);
    const update = db.transaction(() => {
      db.prepare(`UPDATE jobs SET start_time=?,end_time=?,assigned_user_id=?,assigned_to=?,planned_minutes=?,planned_hours=?,timezone=?,daily_rate_date=CASE WHEN COALESCE(daily_rate_enabled,0)=1 THEN ? ELSE daily_rate_date END,
        daily_rate_allocated_amount=CASE WHEN ? THEN 0 ELSE daily_rate_allocated_amount END,
        last_reassigned_by=CASE WHEN ? THEN ? ELSE last_reassigned_by END,
        last_reassigned_by_user_id=CASE WHEN ? THEN ? ELSE last_reassigned_by_user_id END,
        reassignment_note=CASE WHEN ? THEN ? ELSE reassignment_note END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(startTime, endTime, assignedUser.id, assignedUser.name, minutes, minutes / 60, JOB_TIMEZONE, targetDate, bucketChanged ? 1 : 0,
          changedAssignee ? 1 : 0, actor.name || "", changedAssignee ? 1 : 0, actor.id || null, changedAssignee ? 1 : 0, reassignmentNote, job.id);
      if (dailyEnabled) {
        if (bucketChanged && job.assigned_user_id && previousDate) rebalanceDailyRateAllocations({ userId: job.assigned_user_id, dateStr: previousDate });
        rebalanceDailyRateAllocations({ userId: assignedUser.id, dateStr: targetDate });
      }
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
      if (complete && Number(job.daily_rate_enabled || 0) === 1 && normalizeMoney(job.daily_rate_allocated_amount) > 0) {
        const dailyExpense = postFinancialItemOnce({
          itemDate: job.daily_rate_date || String(job.start_time || now).slice(0, 10),
          title: `Employee daily rate expense / Munkavállalói napidíj: ${job.assigned_to || job.assigned_user_id || job.id}`,
          description: `Job / Munka: ${job.title || job.job_key || job.id}`,
          amount: job.daily_rate_allocated_amount,
          mainType: "EXPENSE",
          category: "LABOR_EXPENSE",
          paymentMethod: "",
          jobId: job.id,
          clientId: job.client_id,
          pianoId: job.piano_id,
          sourceType: "DAILY_RATE",
          sourceId: `DAILY_RATE:${job.id}`,
          createdBy: actor.name || "System"
        });
        if (dailyExpense) posted.push(dailyExpense);
      }
      const extraCompensation = normalizeMoney(job.technician_extra_compensation);
      if (complete && extraCompensation > 0) {
        const extraExpense = postFinancialItemOnce({
          itemDate: String(job.start_time || now).slice(0, 10),
          title: `Field-service technician compensation / Kiszállási technikusi munkadíj: ${job.assigned_to || job.assigned_user_id || job.id}`,
          description: `Job / Munka: ${job.title || job.job_key || job.id}`,
          amount: extraCompensation,
          mainType: "EXPENSE",
          category: "FIELD_SERVICE_COMPENSATION",
          paymentMethod: "",
          jobId: job.id,
          clientId: job.client_id,
          pianoId: job.piano_id,
          sourceType: "TECHNICIAN_EXTRA_COMPENSATION",
          sourceId: `TECHNICIAN_EXTRA_COMPENSATION:${job.id}`,
          createdBy: actor.name || "System"
        });
        if (extraExpense) posted.push(extraExpense);
      }
      const primary = posted[0] || db.prepare("SELECT * FROM financial_items WHERE job_id=? ORDER BY created_at,id LIMIT 1").get(job.id) || null;
      if (complete && source !== "WORKFLOW" && invoiceEngine?.createJobInvoices) invoiceEngine.createJobInvoices({ job, actor, now, entries });
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

  return { postFinancialItemOnce, postClosedJobRevenue, employeeDailyRateForDate, dailyRateAllocationSummary, validateDailyRateAllocation, rebalanceDailyRateAllocations, patchJobSchedule, closeoutJobOrchestration };
}

module.exports = {
  SCHEDULE_INTERVAL_MINUTES,
  JOB_TIMEZONE,
  TECHNICIAN_DAILY_BASE_RATE,
  localDateTimeValue,
  isValidTimeRange,
  isScheduleTime,
  isScheduleDurationHours,
  timeRangeMinutes,
  nyDateKey,
  createJobDomain
};
