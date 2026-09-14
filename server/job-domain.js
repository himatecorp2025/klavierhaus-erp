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

  return { postFinancialItemOnce, postClosedJobRevenue };
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
