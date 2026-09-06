"use strict";

const crypto = require("node:crypto");

const ATTENDANCE_MODES = new Set(["PAPER", "DIGITAL"]);
const ATTENDANCE_STATUSES = new Set(["NOT_ARRIVED", "PRESENT", "DELETED"]);

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function attendanceError(code, status = 409) {
  return Object.assign(new Error(code), { status });
}

function isSuperadmin(user) {
  return Boolean(user && (user.role === "SUPERADMIN" || Number(user.is_superadmin || 0) === 1));
}

function isAdminOrSuperadmin(user) {
  return isSuperadmin(user) || user?.role === "ADMIN";
}

function isAttendanceOperator(user) {
  return isSuperadmin(user) || ["ADMIN", "MANAGER", "WORKER"].includes(user?.role);
}

function parseJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch (_error) { return fallback; }
}

function ensureSession(db, eventId, userId = null) {
  let session = db.prepare("SELECT * FROM event_attendance_sessions WHERE event_id=?").get(eventId);
  if (session) return session;

  const legacyClosure = db.prepare("SELECT * FROM event_closures WHERE event_id=?").get(eventId);
  if (legacyClosure) {
    db.prepare(`INSERT OR IGNORE INTO event_attendance_sessions(
      id,event_id,mode,status,closed_at,closed_by_user_id,revision,export_version,last_status_change_at,snapshot_json
    ) VALUES(?,?,'DIGITAL','CLOSED',?,?,1,1,?,?)`).run(
      newId("ATTS"), eventId, legacyClosure.created_at || new Date().toISOString(), legacyClosure.closed_by_user_id || userId,
      legacyClosure.created_at || new Date().toISOString(), legacyClosure.snapshot_json || "{}"
    );
  } else {
    db.prepare(`INSERT OR IGNORE INTO event_attendance_sessions(id,event_id,status,revision,export_version)
      VALUES(?,?,'NOT_STARTED',0,0)`).run(newId("ATTS"), eventId);
  }
  session = db.prepare("SELECT * FROM event_attendance_sessions WHERE event_id=?").get(eventId);
  return session;
}

function syncEntries(db, eventId) {
  db.prepare(`INSERT OR IGNORE INTO event_attendance_entries(id,event_id,ticket_id,status,checked_in_at,checked_in_by_user_id,deleted_at)
    SELECT
      'ATTE-' || t.id,
      t.event_id,
      t.id,
      CASE WHEN t.status='USED' THEN 'PRESENT' WHEN t.status IN ('VOID','REFUNDED') THEN 'DELETED' ELSE 'NOT_ARRIVED' END,
      t.checked_in_at,
      t.checked_in_by_user_id,
      CASE WHEN t.status IN ('VOID','REFUNDED') THEN COALESCE(t.voided_at,CURRENT_TIMESTAMP) ELSE NULL END
    FROM event_tickets t
    WHERE t.event_id=?`).run(eventId);
}

function ticketType(sourceType) {
  return ({ PURCHASE: "PUBLIC", INVITATION: "INVITATION", COMPLIMENTARY: "COMPLIMENTARY" })[sourceType] || sourceType || "TICKET";
}

function attendanceRows(db, eventId, query = "") {
  syncEntries(db, eventId);
  const normalized = String(query || "").trim().toLocaleLowerCase();
  const rows = db.prepare(`SELECT
      t.id,t.event_id,t.source_type,t.buyer_name,t.attendee_name,t.contact_email,t.public_code,t.status AS ticket_status,
      t.price_cents,t.currency,t.created_at,t.checked_in_at,t.checked_in_by_user_id,
      a.id AS attendance_entry_id,a.status AS attendance_status,a.checked_in_at AS attendance_checked_in_at,
      a.checked_in_by_user_id AS attendance_checked_in_by_user_id,a.deleted_at,a.deleted_by_user_id,a.updated_at AS attendance_updated_at
    FROM event_tickets t
    LEFT JOIN event_attendance_entries a ON a.ticket_id=t.id
    WHERE t.event_id=?
      AND (?='' OR lower(COALESCE(t.attendee_name,'')) LIKE '%'||?||'%' OR lower(COALESCE(t.contact_email,'')) LIKE '%'||?||'%' OR lower(COALESCE(t.public_code,'')) LIKE '%'||?||'%')
    ORDER BY CASE WHEN COALESCE(a.status,'NOT_ARRIVED')='DELETED' THEN 1 ELSE 0 END, lower(COALESCE(t.attendee_name,'')),t.created_at,t.id`).all(
      eventId, normalized, normalized, normalized, normalized
    );
  return rows.map((row) => ({
    id: row.id,
    event_id: row.event_id,
    source_type: row.source_type,
    ticket_type: ticketType(row.source_type),
    buyer_name: row.buyer_name || "",
    attendee_name: row.attendee_name || "",
    contact_email: row.contact_email || "",
    public_code: row.public_code || "",
    ticket_status: row.ticket_status,
    price_cents: Number(row.price_cents || 0),
    currency: row.currency || "USD",
    attendance_status: row.attendance_status || "NOT_ARRIVED",
    checked_in_at: row.attendance_checked_in_at || row.checked_in_at || null,
    checked_in_by_user_id: row.attendance_checked_in_by_user_id || row.checked_in_by_user_id || null,
    deleted_at: row.deleted_at || null,
    deleted_by_user_id: row.deleted_by_user_id || null,
    attendance_updated_at: row.attendance_updated_at || null,
    created_at: row.created_at
  }));
}

function attendanceSnapshot(db, event, session, rows = attendanceRows(db, event.id)) {
  const present = rows.filter((row) => row.attendance_status === "PRESENT").length;
  const deleted = rows.filter((row) => row.attendance_status === "DELETED").length;
  const notArrived = rows.length - present - deleted;
  return {
    event_id: event.id,
    event_key: event.event_key,
    event_title: event.title_en || event.title_hu || "",
    event_start_at: event.start_at || null,
    event_end_at: event.end_at || null,
    venue_name: event.venue_name || "",
    mode: session?.mode || null,
    status: session?.paused_at ? "PAUSED" : (session?.status || "NOT_STARTED"),
    revision: Number(session?.revision || 0),
    closed_at: session?.closed_at || null,
    exported_at: new Date().toISOString(),
    tickets: {
      total: rows.length,
      present,
      no_show: notArrived,
      deleted
    },
    guests: rows
  };
}

function publicSessionStatus(session) {
  if (!session) return "NOT_STARTED";
  if (session.status === "CLOSED") return "CLOSED";
  if (session.paused_at) return "PAUSED";
  return session.status || "NOT_STARTED";
}

function assertRevision(session, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null || expectedRevision === "") return;
  if (Number(expectedRevision) !== Number(session.revision || 0)) {
    throw attendanceError("ATTENDANCE_CONFLICT");
  }
}

function recordAction(db, { eventId, sessionId, ticketId = null, action, fromMode = null, toMode = null, fromStatus = null, toStatus = null, userId = null, details = "" }) {
  db.prepare(`INSERT INTO event_attendance_actions(
    id,event_id,session_id,ticket_id,action,from_mode,to_mode,from_status,to_status,performed_by_user_id,details
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    newId("ATTA"), eventId, sessionId || null, ticketId, action, fromMode, toMode, fromStatus, toStatus, userId, details || ""
  );
}

function state(db, event, query = "") {
  const session = ensureSession(db, event.id);
  const tickets = attendanceRows(db, event.id, query);
  const present = tickets.filter((ticket) => ticket.attendance_status === "PRESENT").length;
  const deleted = tickets.filter((ticket) => ticket.attendance_status === "DELETED").length;
  const noShow = tickets.length - present - deleted;
  const closed = session.status === "CLOSED";
  const paused = session.status !== "CLOSED" && Boolean(session.paused_at);
  const digital = session.mode === "DIGITAL";
  const publicStatus = publicSessionStatus(session);
  return {
    event,
    session: {
      id: session.id,
      mode: session.mode || null,
      status: publicStatus,
      revision: Number(session.revision || 0),
      export_version: Number(session.export_version || 0),
      started_at: session.started_at || null,
      closed_at: session.closed_at || null,
      reopened_at: session.reopened_at || null,
      paused_at: session.paused_at || null,
      paused_by_user_id: session.paused_by_user_id || null,
      resumed_at: session.resumed_at || null,
      resumed_by_user_id: session.resumed_by_user_id || null,
      last_pdf_export_at: session.last_pdf_export_at || null
    },
    mode: session.mode || null,
    status: publicStatus,
    closed,
    paused,
    paper: session.mode === "PAPER",
    digital,
    can_edit: digital && !closed && !paused,
    can_export: session.mode === "PAPER" || (digital && closed),
    can_close: digital && !closed && !paused,
    can_reopen: closed,
    can_pause: digital && !closed && !paused,
    can_resume: digital && !closed && paused,
    tickets,
    totals: { total: tickets.length, present, no_show: noShow, deleted },
    report: parseJson(session.snapshot_json, null)
  };
}

function startMode(db, event, mode, user) {
  const normalized = String(mode || "").trim().toUpperCase();
  if (!ATTENDANCE_MODES.has(normalized)) throw attendanceError("INVALID_ATTENDANCE_MODE", 400);
  const session = ensureSession(db, event.id, user?.id);
  if (session.status === "CLOSED") throw attendanceError("ATTENDANCE_CLOSED_REOPEN_REQUIRED");
  if (session.mode === normalized) return session;
  if (session.mode && !isAdminOrSuperadmin(user)) throw attendanceError("ATTENDANCE_MODE_SWITCH_ADMIN_REQUIRED", 403);
  if (session.mode === "DIGITAL" && normalized === "PAPER") {
    const hasDigitalChanges = db.prepare("SELECT 1 FROM event_attendance_entries WHERE event_id=? AND status IN ('PRESENT','DELETED') LIMIT 1").get(event.id);
    if (hasDigitalChanges) throw attendanceError("ATTENDANCE_MODE_SWITCH_REQUIRES_RESET");
  }
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE event_attendance_sessions SET mode=?,status='OPEN',paused_at=NULL,paused_by_user_id=NULL,resumed_at=NULL,resumed_by_user_id=NULL,started_at=COALESCE(started_at,?),started_by_user_id=COALESCE(started_by_user_id,?),revision=revision+1,last_status_change_at=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?`).run(normalized, now, user?.id || null, now, event.id);
    recordAction(db, { eventId: event.id, sessionId: session.id, action: session.mode ? "MODE_SWITCH" : "MODE_START", fromMode: session.mode, toMode: normalized, userId: user?.id || null, details: normalized === "PAPER" ? "Paper attendance mode started" : "Digital attendance mode started" });
  })();
  return db.prepare("SELECT * FROM event_attendance_sessions WHERE event_id=?").get(event.id);
}

function reopen(db, event, user) {
  const session = ensureSession(db, event.id, user?.id);
  if (session.status !== "CLOSED") throw attendanceError("ATTENDANCE_NOT_CLOSED");
  if (!isAdminOrSuperadmin(user)) throw attendanceError("ATTENDANCE_REOPEN_ADMIN_REQUIRED", 403);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE event_attendance_sessions SET status='OPEN',paused_at=NULL,paused_by_user_id=NULL,resumed_at=NULL,resumed_by_user_id=NULL,reopened_at=?,reopened_by_user_id=?,revision=revision+1,last_status_change_at=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?`).run(now, user.id, now, event.id);
    recordAction(db, { eventId: event.id, sessionId: session.id, action: "REOPEN", fromMode: session.mode, toMode: session.mode, userId: user.id, details: "Attendance list reopened by administrator" });
  })();
  return db.prepare("SELECT * FROM event_attendance_sessions WHERE event_id=?").get(event.id);
}

function pause(db, event, user) {
  const session = ensureSession(db, event.id, user?.id);
  if (!isAttendanceOperator(user)) throw attendanceError("ATTENDANCE_OPERATOR_REQUIRED", 403);
  if (session.mode !== "DIGITAL") throw attendanceError(session.mode === "PAPER" ? "ATTENDANCE_PAPER_MODE" : "ATTENDANCE_NOT_STARTED");
  if (session.status === "CLOSED") throw attendanceError("ATTENDANCE_ALREADY_CLOSED");
  if (session.paused_at) return session;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE event_attendance_sessions SET paused_at=?,paused_by_user_id=?,revision=revision+1,last_status_change_at=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?`).run(now, user?.id || null, now, event.id);
    recordAction(db, { eventId: event.id, sessionId: session.id, action: "PAUSE", fromMode: session.mode, toMode: session.mode, fromStatus: "OPEN", toStatus: "PAUSED", userId: user?.id || null, details: "Digital attendance input paused" });
  })();
  return db.prepare("SELECT * FROM event_attendance_sessions WHERE event_id=?").get(event.id);
}

function resume(db, event, user) {
  const session = ensureSession(db, event.id, user?.id);
  if (!isAttendanceOperator(user)) throw attendanceError("ATTENDANCE_OPERATOR_REQUIRED", 403);
  if (session.mode !== "DIGITAL") throw attendanceError(session.mode === "PAPER" ? "ATTENDANCE_PAPER_MODE" : "ATTENDANCE_NOT_STARTED");
  if (session.status === "CLOSED") throw attendanceError("ATTENDANCE_ALREADY_CLOSED");
  if (!session.paused_at) return session;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE event_attendance_sessions SET paused_at=NULL,paused_by_user_id=NULL,resumed_at=?,resumed_by_user_id=?,revision=revision+1,last_status_change_at=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?`).run(now, user?.id || null, now, event.id);
    recordAction(db, { eventId: event.id, sessionId: session.id, action: "RESUME", fromMode: session.mode, toMode: session.mode, fromStatus: "PAUSED", toStatus: "OPEN", userId: user?.id || null, details: "Digital attendance input resumed" });
  })();
  return db.prepare("SELECT * FROM event_attendance_sessions WHERE event_id=?").get(event.id);
}

function changeGuestStatus(db, event, ticket, nextStatus, user, options = {}) {
  const status = String(nextStatus || "").trim().toUpperCase();
  if (!ATTENDANCE_STATUSES.has(status)) throw attendanceError("INVALID_ATTENDANCE_STATUS", 400);
  const session = ensureSession(db, event.id, user?.id);
  if (session.mode !== "DIGITAL") throw attendanceError(session.mode === "PAPER" ? "ATTENDANCE_PAPER_MODE" : "ATTENDANCE_NOT_STARTED");
  if (session.status === "CLOSED") throw attendanceError("ATTENDANCE_ALREADY_CLOSED");
  if (session.paused_at) throw attendanceError("ATTENDANCE_PAUSED");
  assertRevision(session, options.expectedRevision);
  if (["VOID", "REFUNDED"].includes(ticket.status) && status !== "DELETED") throw attendanceError("TICKET_NOT_ACTIVE");
  syncEntries(db, event.id);
  const before = db.prepare("SELECT * FROM event_attendance_entries WHERE ticket_id=?").get(ticket.id);
  const now = new Date().toISOString();
  const hasExpectedRevision = options.expectedRevision !== undefined && options.expectedRevision !== null && options.expectedRevision !== "";
  db.transaction(() => {
    if (hasExpectedRevision) {
      const guarded = db.prepare("UPDATE event_attendance_sessions SET revision=revision+1 WHERE event_id=? AND revision=? AND status='OPEN' AND paused_at IS NULL").run(event.id, Number(options.expectedRevision));
      if (guarded.changes !== 1) throw attendanceError("ATTENDANCE_CONFLICT");
    }
    if (status === "PRESENT") {
      db.prepare(`UPDATE event_attendance_entries SET status='PRESENT',checked_in_at=?,checked_in_by_user_id=?,deleted_at=NULL,deleted_by_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=?`).run(now, user.id, ticket.id);
      db.prepare("UPDATE event_tickets SET status=CASE WHEN status='VALID' THEN 'USED' ELSE status END,checked_in_at=?,checked_in_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(now, user.id, ticket.id);
    } else if (status === "DELETED") {
      db.prepare(`UPDATE event_attendance_entries SET status='DELETED',deleted_at=?,deleted_by_user_id=?,checked_in_at=NULL,checked_in_by_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=?`).run(now, user.id, ticket.id);
    } else {
      db.prepare(`UPDATE event_attendance_entries SET status='NOT_ARRIVED',checked_in_at=NULL,checked_in_by_user_id=NULL,deleted_at=NULL,deleted_by_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE ticket_id=?`).run(ticket.id);
      db.prepare("UPDATE event_tickets SET status=CASE WHEN status='USED' THEN 'VALID' ELSE status END,checked_in_at=NULL,checked_in_by_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(ticket.id);
    }
    db.prepare(`UPDATE event_attendance_sessions SET ${hasExpectedRevision ? "" : "revision=revision+1,"}last_status_change_at=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?`).run(now, event.id);
    db.prepare(`INSERT INTO event_checkins(id,event_id,ticket_id,result,performed_by_user_id,details)
      VALUES(?,?,?,?,?,?)`).run(
      newId("CHK"), event.id, ticket.id,
      status === "PRESENT" ? "ACCEPTED" : status === "DELETED" ? "INVALID" : "REVERTED",
      user?.id || null,
      status === "PRESENT" ? "Digital attendance marked present" : status === "DELETED" ? "Guest marked deleted on digital attendance sheet" : "Digital attendance check-in reverted"
    );
    recordAction(db, { eventId: event.id, sessionId: session.id, ticketId: ticket.id, action: status === "DELETED" ? "GUEST_DELETE" : status === "PRESENT" ? "CHECK_IN" : "CHECK_IN_REVERT", fromStatus: before?.status || "NOT_ARRIVED", toStatus: status, userId: user.id, details: status === "DELETED" ? "Guest remains visible with deleted attendance status" : "Digital attendance status changed" });
  })();
  return db.prepare(`SELECT t.id,t.event_id,t.source_type,t.buyer_name,t.attendee_name,t.contact_email,t.public_code,t.status AS ticket_status,a.status AS attendance_status,a.checked_in_at,a.deleted_at FROM event_tickets t JOIN event_attendance_entries a ON a.ticket_id=t.id WHERE t.id=?`).get(ticket.id);
}

function close(db, event, user, force = false) {
  const session = ensureSession(db, event.id, user?.id);
  if (session.mode !== "DIGITAL") throw attendanceError(session.mode === "PAPER" ? "ATTENDANCE_PAPER_MODE" : "ATTENDANCE_NOT_STARTED");
  if (session.status === "CLOSED") throw attendanceError("ATTENDANCE_ALREADY_CLOSED");
  if (session.paused_at) throw attendanceError("ATTENDANCE_PAUSED");
  if (new Date(event.end_at).getTime() > Date.now() && !(force && isSuperadmin(user))) throw attendanceError("EVENT_HAS_NOT_ENDED");
  const rows = attendanceRows(db, event.id);
  const report = attendanceSnapshot(db, event, session, rows);
  report.status = "CLOSED";
  const now = new Date().toISOString();
  const nextRevision = Number(session.revision || 0) + 1;
  report.revision = nextRevision;
  report.closed_at = now;
  db.transaction(() => {
    db.prepare(`UPDATE event_attendance_sessions SET status='CLOSED',closed_at=?,closed_by_user_id=?,revision=?,last_status_change_at=?,snapshot_json=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?`).run(now, user.id, nextRevision, now, JSON.stringify(report), event.id);
    db.prepare(`INSERT INTO event_closures(id,event_id,snapshot_json,closed_by_user_id) VALUES(?,?,?,?)
      ON CONFLICT(event_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,closed_by_user_id=excluded.closed_by_user_id,created_at=CURRENT_TIMESTAMP`).run(newId("EVCLS"), event.id, JSON.stringify(report), user.id);
    db.prepare("UPDATE events SET status='CLOSED',closed_at=CURRENT_TIMESTAMP,closed_by_user_id=?,closure_snapshot_json=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(user.id, JSON.stringify(report), user.id, event.id);
    recordAction(db, { eventId: event.id, sessionId: session.id, action: "CLOSE", fromMode: session.mode, toMode: session.mode, userId: user.id, details: "Digital guest list finalized" });
  })();
  return report;
}

function createAttendanceHub({ getState, pollIntervalMs = 750 } = {}) {
  const subscribers = new Map();
  const revisions = new Map();
  let timer = null;

  function send(res, payload) {
    if (res.writableEnded || res.destroyed) return false;
    try {
      res.write(`event: attendance_state\ndata: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function publish(eventId, payload) {
    const key = String(eventId);
    const revision = Number(payload?.session?.revision || payload?.revision || 0);
    revisions.set(key, revision);
    for (const res of subscribers.get(key) || []) {
      if (!send(res, payload)) unsubscribe(key, res);
    }
  }

  function unsubscribe(eventId, res) {
    const key = String(eventId);
    const set = subscribers.get(key);
    if (!set) return;
    set.delete(res);
    if (!set.size) subscribers.delete(key);
    if (!subscribers.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function subscribe(eventId, res, initialState = null) {
    const key = String(eventId);
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key).add(res);
    if (initialState) {
      revisions.set(key, Number(initialState?.session?.revision || initialState?.revision || 0));
      send(res, initialState);
    }
    if (!timer && typeof getState === "function") {
      timer = setInterval(() => {
        for (const currentKey of subscribers.keys()) {
          for (const res of subscribers.get(currentKey) || []) {
            try { if (!res.writableEnded && !res.destroyed) res.write(": keep-alive\n\n"); } catch (_error) { unsubscribe(currentKey, res); }
          }
          try {
            const current = getState(currentKey);
            if (!current) continue;
            const revision = Number(current?.session?.revision || current?.revision || 0);
            if (!revisions.has(currentKey) || revisions.get(currentKey) !== revision) publish(currentKey, current);
          } catch (_error) {
            // A disconnected or deleted event must not stop other attendance streams.
          }
        }
      }, pollIntervalMs);
      timer.unref?.();
    }
    return () => unsubscribe(key, res);
  }

  function close() {
    if (timer) clearInterval(timer);
    timer = null;
    for (const [eventId, set] of subscribers) {
      for (const res of set) {
        try { res.end(); } catch (_error) { /* already closed */ }
      }
      subscribers.delete(eventId);
    }
  }

  return { subscribe, publish, close };
}

function recordPdfExport(db, event, user, exportType, snapshot) {
  const session = ensureSession(db, event.id, user?.id);
  const nextVersion = Number(session.export_version || 0) + 1;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE event_attendance_sessions SET export_version=?,last_pdf_export_at=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=?").run(nextVersion, now, event.id);
    db.prepare(`INSERT INTO event_attendance_exports(id,event_id,session_id,export_type,export_version,snapshot_json,exported_by_user_id)
      VALUES(?,?,?,?,?,?,?)`).run(newId("ATTX"), event.id, session.id, exportType, nextVersion, JSON.stringify(snapshot), user?.id || null);
    recordAction(db, { eventId: event.id, sessionId: session.id, action: "PDF_EXPORT", fromMode: session.mode, toMode: session.mode, userId: user?.id || null, details: `${exportType} guest list PDF export v${nextVersion}` });
  })();
  return { ...session, export_version: nextVersion, last_pdf_export_at: now };
}

module.exports = {
  ATTENDANCE_MODES,
  ATTENDANCE_STATUSES,
  attendanceError,
  attendanceRows,
  attendanceSnapshot,
  changeGuestStatus,
  close,
  createAttendanceHub,
  ensureSession,
  isAttendanceOperator,
  isAdminOrSuperadmin,
  isSuperadmin,
  recordPdfExport,
  reopen,
  pause,
  resume,
  startMode,
  state,
  syncEntries
};
