const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function generateActivationCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function maskEmail(value) {
  const email = String(value || "");
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function isoAfterMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function eventStatus(type) {
  return ({
    "email.sent": "SENT",
    "email.delivered": "DELIVERED",
    "email.delivery_delayed": "DELAYED",
    "email.bounced": "BOUNCED",
    "email.complained": "COMPLAINED",
    "email.suppressed": "SUPPRESSED",
    "email.failed": "FAILED"
  })[String(type || "")] || "IGNORED";
}

function createAccountActivationService({ db, emailService }) {
  const issueStatement = db.prepare(`
    INSERT INTO account_activations(user_id,code_hash,status,code_version,issued_at,verified_at,failed_attempts,locked_until,last_delivery_status,updated_at)
    VALUES(?,?,'PENDING',1,CURRENT_TIMESTAMP,NULL,0,NULL,'PENDING',CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      code_hash=excluded.code_hash,status='PENDING',code_version=account_activations.code_version+1,
      issued_at=CURRENT_TIMESTAMP,verified_at=NULL,failed_attempts=0,locked_until=NULL,
      last_delivery_status='PENDING',last_delivery_log_id=NULL,updated_at=CURRENT_TIMESTAMP
  `);

  function state(userId) {
    return db.prepare("SELECT * FROM account_activations WHERE user_id=?").get(userId) || null;
  }

  function issue(userId) {
    const previous = state(userId);
    let code = generateActivationCode();
    while (previous?.code_hash && bcrypt.compareSync(code, previous.code_hash)) code = generateActivationCode();
    const codeHash = bcrypt.hashSync(code, 10);
    issueStatement.run(userId, codeHash);
    const row = state(userId);
    return { code, version: Number(row.code_version || 1) };
  }

  async function deliver(user, issuance, reason = "INITIAL") {
    if (db.inTransaction) {
      const transactionError = new Error("ACTIVATION_DELIVERY_TRANSACTION_LEAK");
      transactionError.code = "ACTIVATION_DELIVERY_TRANSACTION_LEAK";
      throw transactionError;
    }
    const logId = `AEM-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
    db.prepare(`INSERT INTO activation_email_log(id,user_id,recipient_email,provider,status,reason)
      VALUES(?,?,?,?,?,?)`).run(logId, user.id, user.contact_email, emailService.provider, "PENDING", reason);
    try {
      const sent = await emailService.sendAccountActivation({
        to: user.contact_email,
        name: user.name,
        code: issuance.code,
        idempotencyKey: `activation-${user.id}-${issuance.version}`
      });
      db.transaction(() => {
        db.prepare("UPDATE activation_email_log SET provider_message_id=?,status='ACCEPTED',updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(sent.providerMessageId, logId);
        db.prepare("UPDATE account_activations SET last_delivery_status='ACCEPTED',last_delivery_log_id=?,last_sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
          .run(logId, user.id);
      })();
      const persisted = db.prepare("SELECT id FROM activation_email_log WHERE id=? AND provider_message_id=? AND status='ACCEPTED'").get(logId, sent.providerMessageId);
      if (!persisted) {
        const persistenceError = new Error("ACTIVATION_EMAIL_LOG_PERSISTENCE_FAILED");
        persistenceError.code = "ACTIVATION_EMAIL_LOG_PERSISTENCE_FAILED";
        throw persistenceError;
      }
      return { status: "ACCEPTED" };
    } catch (error) {
      const errorCode = String(error?.code || "EMAIL_DELIVERY_FAILED");
      const status = errorCode === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
      db.transaction(() => {
        db.prepare("UPDATE activation_email_log SET status=?,error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(status, errorCode, logId);
        db.prepare("UPDATE account_activations SET last_delivery_status=?,last_delivery_log_id=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
          .run(status, logId, user.id);
      })();
      return { status, error: status === "NOT_CONFIGURED" ? "EMAIL_DELIVERY_NOT_CONFIGURED" : "EMAIL_DELIVERY_FAILED" };
    }
  }

  function registerFailedAttempt(row) {
    const attempts = Number(row.failed_attempts || 0) + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
    db.prepare("UPDATE account_activations SET failed_attempts=?,locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
      .run(shouldLock ? 0 : attempts, shouldLock ? isoAfterMinutes(LOCK_MINUTES) : null, row.user_id);
    return shouldLock;
  }

  function verify(userId, code) {
    const row = state(userId);
    if (!row) return { ok: false, error: "ACTIVATION_NOT_REQUIRED" };
    if (row.status === "VERIFIED" || !row.code_hash) return { ok: false, error: "ACTIVATION_ALREADY_COMPLETED" };
    if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
      return { ok: false, error: "ACTIVATION_TEMPORARILY_LOCKED", retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(row.locked_until) - Date.now()) / 1000)) };
    }
    const normalizedCode = String(code || "").trim();
    let matches = false;
    if (/^\d{6}$/.test(normalizedCode)) {
      try { matches = bcrypt.compareSync(normalizedCode, row.code_hash); } catch (_error) { matches = false; }
    }
    if (!matches) {
      const locked = registerFailedAttempt(row);
      return { ok: false, error: locked ? "ACTIVATION_TEMPORARILY_LOCKED" : "INVALID_ACTIVATION_CODE", retryAfterSeconds: locked ? LOCK_MINUTES * 60 : undefined };
    }
    db.prepare(`UPDATE account_activations SET code_hash=NULL,status='VERIFIED',verified_at=CURRENT_TIMESTAMP,
      failed_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND status='PENDING'`).run(userId);
    return { ok: true };
  }

  function recordWebhook(event, eventId) {
    const type = String(event?.type || "");
    const status = eventStatus(type);
    const providerMessageId = String(event?.data?.email_id || "");
    if (!eventId || !providerMessageId || status === "IGNORED") return { accepted: false };
    const eventCreatedAt = String(event?.created_at || new Date().toISOString());
    const apply = db.transaction(() => {
      const inserted = db.prepare(`INSERT OR IGNORE INTO activation_email_events(event_id,provider_message_id,event_type,event_created_at)
        VALUES(?,?,?,?)`).run(eventId, providerMessageId, type, eventCreatedAt);
      if (!inserted.changes) return { accepted: true, duplicate: true };
      const log = db.prepare("SELECT * FROM activation_email_log WHERE provider_message_id=?").get(providerMessageId);
      if (!log) return { accepted: true, matched: false };
      if (!log.last_event_at || Date.parse(eventCreatedAt) >= Date.parse(log.last_event_at)) {
        db.prepare("UPDATE activation_email_log SET status=?,last_event_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(status, eventCreatedAt, log.id);
        db.prepare("UPDATE account_activations SET last_delivery_status=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND last_delivery_log_id=?")
          .run(status, log.user_id, log.id);
      }
      return { accepted: true, matched: true, status };
    });
    return apply();
  }

  return { state, issue, deliver, verify, recordWebhook, maskEmail };
}

module.exports = { createAccountActivationService, generateActivationCode, maskEmail };
