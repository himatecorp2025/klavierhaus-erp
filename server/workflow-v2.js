"use strict";

// One operational workflow domain for details, calendar and notifications.
// No caller can gain rights merely by having created a workflow or a calendar job.
const crypto = require("node:crypto");
const taskCatalog = require("./workflow-task-catalog");
const { createWorkflowFinance } = require("./workflow-finance");
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const text = (value, max = 5000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const fault = (code, status = 400, details) => Object.assign(new Error(code), { code, status, details });
const superuser = user => user?.role === "SUPERADMIN" || Number(user?.is_superadmin) === 1;
const admin = user => superuser(user) || user?.role === "ADMIN";
const NY = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const nowLocal = () => NY.format(new Date()).replace(" ", "T");
function localTime(value, optional = false, legacy = false) {
  if ((value === null || value === "" || value === undefined) && optional) return null;
  const s = String(value || "");
  const pattern = legacy ? /^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45)$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:(00|30)$/;
  if (!pattern.test(s)) throw fault("WORKFLOW_TIME_INVALID");
  const date = new Date(`${s}:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 16) !== s) throw fault("WORKFLOW_TIME_INVALID");
  if (![240, 300].some(offset => NY.format(new Date(+date + offset * 60000)).replace(" ", "T") === s)) throw fault("WORKFLOW_TIME_DST_GAP");
  return s;
}
function slotEnd(time) {
  const wall = Date.parse(`${time}:00Z`);
  // Prefer the later occurrence of a repeated autumn wall time. On the spring
  // transition, a real 30-minute appointment ends at 03:00, not nonexistent 02:00.
  const offset = [300, 240].find(minutes => NY.format(new Date(wall + minutes * 60000)).replace(" ", "T") === time);
  if (offset === undefined) throw fault("WORKFLOW_TIME_DST_GAP");
  return NY.format(new Date(wall + offset * 60000 + 1800000)).replace(" ", "T");
}
function money(value) {
  if (value === "" || value === null || typeof value === "boolean") throw fault("WORKFLOW_AMOUNT_INVALID");
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) throw fault("WORKFLOW_AMOUNT_INVALID");
  return Math.round((amount + Number.EPSILON) * 100);
}
function flag(value, fallback = false) {
  if (value === undefined) return fallback;
  if (![true, false, 1, 0].includes(value)) throw fault("WORKFLOW_BOOLEAN_INVALID");
  return Boolean(value);
}

function createWorkflowV2({ db, invoiceEngine }) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const finance = createWorkflowFinance({ db, rid: id, nowISO: nowLocal });
  const getWorkflow = key => {
    const row = one("SELECT * FROM wf2_workflows WHERE id=?", key);
    if (!row) throw fault("WORKFLOW_NOT_FOUND", 404);
    return row;
  };
  const getPhase = key => {
    const row = one("SELECT * FROM wf2_phases WHERE id=?", key);
    if (!row) throw fault("WORKFLOW_PHASE_NOT_FOUND", 404);
    return row;
  };
  const getTask = key => {
    const row = one("SELECT * FROM workshop_subtasks WHERE id=?", key);
    if (!row) throw fault("WORKFLOW_TASK_NOT_FOUND", 404);
    return row;
  };
  const activeUser = key => {
    const row = one("SELECT id,name,role,is_superadmin,status FROM users WHERE id=? AND status='Active'", key);
    if (!row) throw fault("WORKFLOW_ACTIVE_USER_REQUIRED");
    return row;
  };
  const person = key => one("SELECT id,name FROM users WHERE id=?", key);
  const workflowStatus = w => w.deleted_at ? "DELETED" : w.aborted_at ? "ABORTED" : w.status;
  const active = w => workflowStatus(w) === "ACTIVE";
  const owns = (u, w) => admin(u) || u.id === w.main_responsible_user_id;
  const ownsPhase = (u, w, p) => owns(u, w) || u.id === p.responsible_user_id;
  const assignedTask = (u, t) => Boolean(one("SELECT 1 FROM wf2_task_assignees WHERE task_id=? AND user_id=?", t.id, u.id));
  const ownsTask = (u, w, p, t) => ownsPhase(u, w, p) || assignedTask(u, t);
  const requireRight = allowed => { if (!allowed) throw fault("WORKFLOW_FORBIDDEN", 403); };
  const requireActive = w => { if (!active(w)) throw fault("WORKFLOW_CLOSED", 409); };
  const requirePhaseOpen = p => { if (["COMPLETED", "NOT_REQUIRED"].includes(p.status)) throw fault("WORKFLOW_PHASE_CLOSED", 409); };
  const adminReason = (u, body) => {
    if (admin(u) && !superuser(u) && text(body?.reason).length < 5) throw fault("WORKFLOW_OVERRIDE_REASON_REQUIRED");
  };
  const handoverReason = (u, body) => {
    if (!superuser(u) && text(body.transfer_reason || body.reason).length < 5) throw fault("WORKFLOW_HANDOVER_REASON_REQUIRED");
  };
  const definitions = () => all(`SELECT d.*,COALESCE(o.color,'#B88A44') color,COALESCE(o.required,1) required,
    COALESCE(o.enabled,1) enabled,COALESCE(o.default_status,'WAITING') default_status
    FROM workshop_phase_definitions d LEFT JOIN wf2_phase_options o ON o.code=d.code
    WHERE d.is_system=1 ORDER BY d.sort_order,d.id`).slice(0, 7);
  function phaseContext(key, phaseId) {
    const p = getPhase(phaseId);
    if (p.workflow_id !== key) throw fault("WORKFLOW_PHASE_NOT_FOUND", 404);
    return p;
  }
  function taskContext(p, taskId) {
    const t = getTask(taskId);
    if (t.phase_id !== p.id) throw fault("WORKFLOW_TASK_NOT_FOUND", 404);
    return t;
  }
  function taskSnapshot(t) {
    return { ...t, assignee_ids: all("SELECT user_id FROM wf2_task_assignees WHERE task_id=? ORDER BY user_id", t.id).map(a => a.user_id) };
  }
  function audit(w, u, action, kind, entityId, before, after, reason = "") {
    if (superuser(u)) return;
    run("INSERT INTO wf2_audit(id,workflow_id,entity_type,entity_id,actor_user_id,action,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?)",
      id("WA"), w.id, kind, entityId, u.id, action, text(reason), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);
  }
  function notifyApproval(w, t, u, reason) {
    for (const assignee of all("SELECT user_id FROM wf2_task_assignees WHERE task_id=? AND user_id<>?", t.id, u.id)) {
      run("INSERT INTO notifications(id,recipient_user_id,sender_user_id,notification_type,title_en,title_hu,body_en,body_hu,metadata_json) VALUES(?,?,?,'WORKFLOW_APPROVAL',?,?,?,?,?)",
        id("WN"), assignee.user_id, u.id, "Task approved on your behalf", "R\u00e9szfeladatod teljes\u00edt\u00e9se j\u00f3v\u00e1hagyva",
        `${u.name || u.id}: ${t.title}. ${text(reason)}`, `${u.name || u.id}: ${t.title}. ${text(reason)}`,
        JSON.stringify({ wf2_workflow_id: w.id, task_id: t.id, approved_by: u.id }));
    }
  }
  function validPiano(clientId, pianoId) {
    if (!one("SELECT id FROM contacts WHERE id=?", clientId)) throw fault("WORKFLOW_CLIENT_REQUIRED");
    const piano = one("SELECT * FROM pianos WHERE id=?", pianoId);
    if (!piano) throw fault("WORKFLOW_PIANO_REQUIRED");
    if (piano.owner_contact_id !== clientId && !one("SELECT 1 FROM client_pianos WHERE client_id=? AND piano_id=?", clientId, pianoId)) throw fault("WORKFLOW_PIANO_CLIENT_MISMATCH");
  }
  function validateDates(w) {
    // Previously saved quarter-hour data is preserved, never rounded by a read.
    // Every newly supplied/changed appointment goes through strict localTime().
    localTime(w.start_at, false, true); localTime(w.final_due_at, false, true);
    if (w.start_at > w.final_due_at) throw fault("WORKFLOW_DATE_ORDER");
    for (const p of all("SELECT * FROM wf2_phases WHERE workflow_id=?", w.id)) {
      if (p.due_at && (p.due_at < w.start_at || p.due_at > w.final_due_at)) throw fault("WORKFLOW_PHASE_OUTSIDE_DATES", 409, { phase_id: p.id, title: p.title, limit: w.final_due_at });
      for (const t of all("SELECT * FROM workshop_subtasks WHERE phase_id=?", p.id)) {
        if (t.due_at && (t.due_at < w.start_at || t.due_at > (p.due_at || w.final_due_at))) throw fault("WORKFLOW_TASK_OUTSIDE_DATES", 409, { task_id: t.id, title: t.title, phase_title: p.title, limit: p.due_at || w.final_due_at });
      }
    }
  }
  function permissions(u, w, p = null, t = null) {
    const live = active(w), phaseOpen = !p || !["COMPLETED", "NOT_REQUIRED"].includes(p.status);
    return {
      edit_final_deadline: live && admin(u),
      edit_workflow: live && owns(u, w), close_workflow: live && owns(u, w),
      edit_phase: Boolean(live && phaseOpen && p && ownsPhase(u, w, p)), assign_phase: live && owns(u, w),
      edit_task: Boolean(live && phaseOpen && t && t.status !== "COMPLETED" && ownsTask(u, w, p, t)),
      edit_task_content: Boolean(live && phaseOpen && p && ownsPhase(u, w, p)),
      complete_task: Boolean(live && phaseOpen && t && t.status !== "COMPLETED" && ownsTask(u, w, p, t)),
      record_cost: Boolean(live && phaseOpen && !w.finance_locked && p && p.financial_status !== "CLOSED" && ownsPhase(u, w, p)),
      approve_cost: Boolean(live && !w.finance_locked && owns(u, w)),
      delete_phase: Boolean(live && !w.finance_locked && owns(u, w)), delete_workflow: live && !w.finance_locked && owns(u, w),
      reopen: Boolean(admin(u) && !w.aborted_at && !w.deleted_at),
      admin: admin(u), superadmin: superuser(u), admin_reason_required: admin(u) && !superuser(u)
    };
  }
  function detail(key, u) {
    if (!one("SELECT 1 FROM wf2_workflows WHERE id=?", key)) return archivedDetail(key, u);
    const w = getWorkflow(key), client = one("SELECT id,name,phone FROM contacts WHERE id=?", w.client_id);
    const piano = one("SELECT brand,model,serial_no,display_name,owner_contact_id FROM pianos WHERE id=?", w.piano_id);
    const owner = piano?.owner_contact_id ? one("SELECT id,name,phone FROM contacts WHERE id=?", piano.owner_contact_id) : null;
    const phases = all("SELECT * FROM wf2_phases WHERE workflow_id=? ORDER BY stage_order,id", key).map(p => {
      const tasks = all("SELECT * FROM workshop_subtasks WHERE phase_id=? ORDER BY rowid", p.id).map(t => ({ ...taskSnapshot(t), permissions: permissions(u, w, p, t) }));
      const checks = all("SELECT * FROM wf2_checklist WHERE phase_id=? ORDER BY rowid", p.id);
      const overdue = active(w) && Boolean(p.due_at && p.due_at < nowLocal() && !["COMPLETED", "NOT_REQUIRED"].includes(p.status));
      return { ...p, effective_status: overdue ? "OVERDUE" : p.status, card_title: p.title, details: p.description,
        assigned_user_id: p.responsible_user_id, assigned_to: person(p.responsible_user_id)?.name || "", is_overdue: overdue,
        tasks, subtasks: tasks, progress: { completed: tasks.filter(t => t.status === "COMPLETED").length, total: tasks.length },
        costs: all("SELECT * FROM wf2_costs WHERE phase_id=? ORDER BY rowid", p.id), checklist: checks,
        documents: all("SELECT id,phase_id,task_id,original_name,mime_type,size_bytes,uploaded_by,created_at FROM wf2_documents WHERE phase_id=? ORDER BY created_at", p.id),
        permissions: permissions(u, w, p) };
    });
    return { ...w, ...piano, status: workflowStatus(w), current_status: workflowStatus(w),
      client_name: client?.name || "", client_phone: client?.phone || "", owner_id: owner?.id || null,
      owner_name: owner?.name || "", owner_phone: owner?.phone || "", owner_is_client: Boolean(owner?.id && owner.id === w.client_id),
      creator_name: person(w.creator_user_id)?.name || "", main_responsible_name: person(w.main_responsible_user_id)?.name || "",
      stages: phases, permissions: permissions(u, w),
      audit: all("SELECT a.*,u.name actor_name FROM wf2_audit a JOIN users u ON u.id=a.actor_user_id WHERE workflow_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 200", key),
      calendar: all("SELECT l.*,j.start_time,j.end_time,j.status FROM wf2_calendar_links l JOIN jobs j ON j.id=l.job_id WHERE l.workflow_id=?", key) };
  }
  function archivedDetail(key, u) {
    const w = one("SELECT w.*,c.name client_name,c.phone client_phone,p.brand,p.model,p.serial_no,p.display_name,p.owner_contact_id FROM workflow_finance_sources w LEFT JOIN contacts c ON c.id=w.client_id LEFT JOIN pianos p ON p.id=w.piano_id WHERE w.id=?", key);
    if (!w) throw fault("WORKFLOW_NOT_FOUND", 404);
    const owner = w.owner_contact_id ? one("SELECT id,name,phone FROM contacts WHERE id=?", w.owner_contact_id) : null;
    const readOnly = { edit_workflow: false, close_workflow: false, edit_phase: false, assign_phase: false, edit_task: false, edit_task_content: false, record_cost: false, approve_cost: false, reopen: false, admin: admin(u), superadmin: superuser(u) };
    const stages = all("SELECT * FROM workflow_finance_phases WHERE workflow_id=? ORDER BY stage_order,id", key).map(p => ({ ...p,
      title: p.card_title || p.name_snapshot_hu, description: p.details || "", responsible_user_id: p.assigned_user_id,
      assigned_to: person(p.assigned_user_id)?.name || "", tasks: [], subtasks: [], progress: { completed: 0, total: 0 }, checklist: [], documents: [],
      costs: all("SELECT *,CAST(ROUND(amount*100) AS INTEGER) amount_cents,CAST(ROUND(amount*100) AS INTEGER) charge_cents FROM workflow_finance_lines WHERE stage_id=?", p.id),
      permissions: readOnly, is_overdue: false, effective_status: p.status }));
    return { ...w, historical: true, status: w.current_status === "ABORTED" ? "ABORTED" : "COMPLETED", creator_user_id: w.created_by_user_id,
      creator_name: person(w.created_by_user_id)?.name || "", main_responsible_user_id: null, main_responsible_name: "", start_at: "",
      owner_id: owner?.id || null, owner_name: owner?.name || "", owner_phone: owner?.phone || "", owner_is_client: owner?.id === w.client_id,
      stages, permissions: readOnly, audit: [], calendar: [] };
  }
  function list(u, status = "ACTIVE") {
    const rows = all(status === "ACTIVE"
      ? "SELECT id FROM wf2_workflows WHERE status='ACTIVE' AND aborted_at IS NULL AND deleted_at IS NULL ORDER BY final_due_at,id"
      : "SELECT id FROM wf2_workflows WHERE (status='COMPLETED' OR aborted_at IS NOT NULL) AND deleted_at IS NULL ORDER BY final_due_at,id").map(w => detail(w.id, u));
    if (status !== "ACTIVE") for (const w of all("SELECT id FROM workflow_finance_sources s WHERE NOT EXISTS(SELECT 1 FROM wf2_workflows w WHERE w.id=s.id) ORDER BY final_due_at,id")) rows.push(archivedDetail(w.id, u));
    return rows.sort((a, b) => String(a.final_due_at).localeCompare(String(b.final_due_at)) || a.id.localeCompare(b.id));
  }
  function syncCalendar(w) {
    const stopped = Boolean(w.aborted_at || w.deleted_at), events = [
      { kind: "START", key: w.id, due: w.start_at, owner: w.main_responsible_user_id, title: `Start - ${w.title}`, done: w.status === "COMPLETED", cancelled: stopped },
      { kind: "FINAL", key: w.id, due: w.final_due_at, owner: w.main_responsible_user_id, title: `Deadline - ${w.title}`, done: w.status === "COMPLETED", cancelled: stopped }
    ];
    for (const p of all("SELECT * FROM wf2_phases WHERE workflow_id=?", w.id)) {
      events.push({ kind: "PHASE", key: p.id, due: p.due_at, owner: p.responsible_user_id, title: `${w.title} - ${p.title}`, done: p.status === "COMPLETED", cancelled: stopped || p.status === "NOT_REQUIRED" });
      for (const t of all("SELECT * FROM workshop_subtasks WHERE phase_id=?", p.id)) events.push({ kind: "TASK", key: t.id, due: t.due_at,
        owner: one("SELECT user_id FROM wf2_task_assignees WHERE task_id=? ORDER BY user_id LIMIT 1", t.id)?.user_id || p.responsible_user_id,
        title: `${w.title} - ${t.title}`, done: t.status === "COMPLETED", cancelled: stopped || (t.status !== "COMPLETED" && (p.status === "COMPLETED" || p.status === "NOT_REQUIRED" || w.status === "COMPLETED")) });
    }
    const client = one("SELECT name,phone FROM contacts WHERE id=?", w.client_id), piano = one("SELECT brand,model FROM pianos WHERE id=?", w.piano_id);
    const expected = new Set();
    for (const e of events) {
      if (!e.due) continue;
      expected.add(`${e.kind}:${e.key}`);
      const existing = one("SELECT * FROM wf2_calendar_links WHERE entity_type=? AND entity_id=?", e.kind, e.key);
      const jobId = existing?.job_id || id("WF2J"), owner = person(e.owner);
      if (!owner) throw fault("WORKFLOW_ACTIVE_USER_REQUIRED");
      if (!existing) {
        run("INSERT INTO jobs(id,job_key,title,job_type,assigned_to,start_time,end_time,created_by_user_id,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
          jobId, jobId, e.title, "Workflow deadline", owner.name, e.due, slotEnd(e.due), w.creator_user_id, person(w.creator_user_id)?.name || "");
        run("INSERT INTO wf2_calendar_links(id,workflow_id,entity_type,entity_id,job_id) VALUES(?,?,?,?,?)", id("WL"), w.id, e.kind, e.key, jobId);
      }
      const started = e.kind === "START" && one("SELECT 1 FROM jobs WHERE id=? AND notes='WF2_STARTED'", jobId);
      run("UPDATE jobs SET title=?,assigned_user_id=?,assigned_to=?,start_time=?,end_time=?,client_id=?,client_name=?,client_phone=?,piano_id=?,piano_name=?,status=?,financial_status=?,planned_minutes=30,planned_hours=0.5,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        e.title, e.owner, owner.name, e.due, slotEnd(e.due), w.client_id, client?.name || "", client?.phone || "", w.piano_id,
        [piano?.brand, piano?.model].filter(Boolean).join(" "), e.cancelled ? "Cancelled" : e.done || started ? "Completed" : "Open", w.finance_locked ? "POSTED" : "OPEN", jobId);
    }
    for (const link of all("SELECT * FROM wf2_calendar_links WHERE workflow_id=?", w.id)) {
      if (expected.has(`${link.entity_type}:${link.entity_id}`)) continue;
      run("INSERT OR IGNORE INTO workflow_retired_calendar_jobs(job_id,workflow_id,snapshot_json) VALUES(?,?,?)", link.job_id, w.id, JSON.stringify(one("SELECT * FROM jobs WHERE id=?", link.job_id)));
      run("DELETE FROM notification_snooze_log WHERE entity_type='CALENDAR_JOB' AND entity_id=?", link.job_id);
      run("DELETE FROM wf2_calendar_links WHERE id=?", link.id);
      // Retain the cancelled appointment for history, but it no longer owns a
      // deleted task/phase and can never reopen a second, obsolete editor.
      run("UPDATE jobs SET status='Cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?", link.job_id);
    }
  }
  function command(key, u, body, action, work, { allowClosed = false } = {}) {
    return db.transaction(() => {
      activeUser(u.id);
      const w = getWorkflow(key);
      if (!allowClosed) requireActive(w);
      if (body.version !== undefined && Number(body.version) !== w.version) throw fault("WORKFLOW_VERSION_CONFLICT", 409, { version: w.version });
      adminReason(u, body);
      work(w);
      const current = getWorkflow(key);
      validateDates(current); syncCalendar(current);
      run("UPDATE wf2_workflows SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?", key);
      audit(w, u, action, "WORKFLOW", key, w, getWorkflow(key), body.reason);
      return detail(key, u);
    })();
  }
  function create(body, u) {
    return db.transaction(() => {
      activeUser(u.id); adminReason(u, body);
      const requestKey = text(body.request_key, 100) || null;
      if (requestKey) {
        const previous = one("SELECT * FROM wf2_workflows WHERE request_key=?", requestKey);
        if (previous) { requireRight(previous.creator_user_id === u.id); return detail(previous.id, u); }
      }
      const owner = activeUser(body.main_responsible_user_id || u.id);
      validPiano(body.client_id, body.piano_id);
      const title = text(body.title, 200);
      if (!title) throw fault("WORKFLOW_TITLE_REQUIRED");
      const location = one("SELECT cp.location_name,cp.piano_location_address,p.location FROM pianos p LEFT JOIN client_pianos cp ON cp.piano_id=p.id AND cp.client_id=? WHERE p.id=?", body.client_id, body.piano_id);
      const key = id("WF2"), start = localTime(body.start_at), due = localTime(body.final_due_at), mode = body.mode || "INBOUND";
      if (!["INBOUND", "ON_SITE"].includes(mode)) throw fault("WORKFLOW_MODE_INVALID");
      if (start > due) throw fault("WORKFLOW_DATE_ORDER");
      const defs = definitions(), codes = new Set(defs.map(d => d.code));
      if (defs.length !== 7) throw fault("WORKFLOW_SEVEN_PHASES_REQUIRED", 409);
      if (body.phases !== undefined && (!Array.isArray(body.phases) || body.phases.length > 7 || new Set(body.phases.map(p => p?.stage_code)).size !== body.phases.length || body.phases.some(p => !codes.has(p?.stage_code)))) throw fault("WORKFLOW_PHASE_SELECTION_INVALID");
      run("INSERT INTO wf2_workflows(id,workflow_key,title,client_id,piano_id,creator_user_id,main_responsible_user_id,mode,start_at,final_due_at,description,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        key, key, title, body.client_id, body.piano_id, u.id, owner.id, mode, start, due, text(body.description), requestKey);
      run("UPDATE wf2_workflows SET piano_location_name=?,piano_location_address=?,service_address=? WHERE id=?",
        text(location?.location_name,500), text(location?.piano_location_address || location?.location,2000), mode === "ON_SITE" ? text(body.service_address,2000) : "", key);
      if (mode === "ON_SITE" && !text(body.service_address)) throw fault("WORKFLOW_SERVICE_ADDRESS_REQUIRED");
      for (const d of defs) {
        const item = (body.phases || []).find(p => p.stage_code === d.code);
        const enabled = body.phases === undefined ? Boolean(d.enabled) : Boolean(item && flag(item.enabled, true));
        if (!enabled) continue;
        const responsible = activeUser(item?.responsible_user_id || owner.id);
        const phaseDue = item?.due_at ? localTime(item.due_at) : due;
        run("INSERT INTO wf2_phases(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,responsible_user_id,title,due_at,required,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          id("WP"), key, d.code, d.sort_order, d.name_en, d.name_hu, responsible.id, text(item?.title || d.name_hu, 200), phaseDue, d.required ? 1 : 0, d.default_status);
        const phase = one("SELECT * FROM wf2_phases WHERE workflow_id=? AND stage_code=?",key,d.code);
        const tasks = item?.tasks ?? [];
        if (!Array.isArray(tasks) || tasks.length > 200) throw fault("WORKFLOW_TASK_SELECTION_INVALID");
        const used = new Set();
        for (const task of tasks) {
          if (!task || typeof task !== "object" || Array.isArray(task)) throw fault("WORKFLOW_TASK_SELECTION_INVALID");
          if (task.template_id) {
            if (used.has(task.template_id) || !(taskCatalog[d.code] || []).some(t=>t.id === task.template_id)) throw fault("WORKFLOW_TASK_SELECTION_INVALID");
            used.add(task.template_id);
          }
          insertTask(getWorkflow(key), phase, task, u, body.reason);
        }
      }
      const w = getWorkflow(key); validateDates(w); syncCalendar(w);
      for (const p of all("SELECT * FROM wf2_phases WHERE workflow_id=?", key)) audit(w, u, "PHASE_CREATE", "PHASE", p.id, null, p, body.reason);
      audit(w, u, "CREATE", "WORKFLOW", key, null, { ...w, phases: all("SELECT * FROM wf2_phases WHERE workflow_id=?", key) }, body.reason);
      return detail(key, u);
    })();
  }
  function update(key, body, u) {
    return command(key, u, body, "WORKFLOW_UPDATE", w => {
      requireRight(owns(u, w));
      const next = { ...w };
      for (const field of ["title", "description", "mode", "client_id", "piano_id", "main_responsible_user_id", "start_at", "final_due_at"]) if (body[field] !== undefined) next[field] = body[field];
      if (!text(next.title, 200)) throw fault("WORKFLOW_TITLE_REQUIRED");
      if (next.main_responsible_user_id !== w.main_responsible_user_id) { activeUser(next.main_responsible_user_id); handoverReason(u, body); }
      if (next.client_id !== w.client_id || next.piano_id !== w.piano_id) {
        if (w.finance_locked || one("SELECT 1 FROM workflow_finance_lines WHERE workflow_id=? LIMIT 1", key)) throw fault("WORKFLOW_FINANCIAL_IDENTITY_LOCKED", 409);
      }
      validPiano(next.client_id, next.piano_id);
      if (next.start_at !== w.start_at) localTime(next.start_at);
      if (next.final_due_at !== w.final_due_at) { requireRight(admin(u)); localTime(next.final_due_at); }
      if (!["INBOUND", "ON_SITE"].includes(next.mode)) throw fault("WORKFLOW_MODE_INVALID");
      run("UPDATE wf2_workflows SET title=?,description=?,mode=?,client_id=?,piano_id=?,main_responsible_user_id=?,start_at=?,final_due_at=? WHERE id=?",
        text(next.title, 200), text(next.description), next.mode, next.client_id, next.piano_id, next.main_responsible_user_id, next.start_at, next.final_due_at, key);
      if (next.main_responsible_user_id !== w.main_responsible_user_id) audit(w, u, "WORKFLOW_HANDOVER", "WORKFLOW", key,
        { main_responsible_user_id: w.main_responsible_user_id }, { main_responsible_user_id: next.main_responsible_user_id }, body.transfer_reason || body.reason);
    });
  }
  function updatePhase(key, phaseId, body, u) {
    return command(key, u, body, "PHASE_UPDATE", w => {
      const p = phaseContext(key, phaseId); requireRight(ownsPhase(u, w, p)); requirePhaseOpen(p);
      const next = { ...p };
      for (const field of ["title", "description", "responsible_user_id", "due_at", "required", "status"]) if (body[field] !== undefined) next[field] = body[field];
      if (next.responsible_user_id !== p.responsible_user_id) { requireRight(owns(u, w)); activeUser(next.responsible_user_id); handoverReason(u, body); }
      if (body.required !== undefined) { requireRight(owns(u, w)); next.required = flag(body.required) ? 1 : 0; }
      if (!text(next.title, 200)) throw fault("WORKFLOW_TITLE_REQUIRED");
      if (!["WAITING", "IN_PROGRESS", "BLOCKED"].includes(next.status)) throw fault("WORKFLOW_USE_PHASE_CLOSE_OR_DELETE", 409);
      if (next.due_at !== p.due_at) next.due_at = localTime(next.due_at);
      run("UPDATE wf2_phases SET title=?,description=?,responsible_user_id=?,due_at=?,required=?,status=? WHERE id=?",
        text(next.title, 200), text(next.description), next.responsible_user_id, next.due_at, next.required, next.status, p.id);
      audit(w, u, next.responsible_user_id !== p.responsible_user_id ? "PHASE_HANDOVER" : "PHASE_EDIT", "PHASE", p.id, p, getPhase(p.id), body.transfer_reason || body.reason);
    });
  }
  function updateSchedule(key, body, u) {
    return command(key,u,body,"SCHEDULE_UPDATE",w=>{
      if (body.version === undefined) throw fault("WORKFLOW_VERSION_REQUIRED",409);
      requireRight(owns(u,w) || Boolean(one("SELECT 1 FROM wf2_phases WHERE workflow_id=? AND responsible_user_id=?",key,u.id)) || Boolean(one("SELECT 1 FROM workshop_subtasks t JOIN wf2_phases p ON p.id=t.phase_id JOIN wf2_task_assignees a ON a.task_id=t.id WHERE p.workflow_id=? AND a.user_id=?",key,u.id)));
      if (body.start_at !== undefined && body.start_at !== w.start_at) {
        requireRight(owns(u,w)); run("UPDATE wf2_workflows SET start_at=? WHERE id=?",localTime(body.start_at),key);
      }
      if (body.final_due_at !== undefined && body.final_due_at !== w.final_due_at) {
        requireRight(admin(u)); run("UPDATE wf2_workflows SET final_due_at=? WHERE id=?",localTime(body.final_due_at),key);
      }
      for (const [kind,items] of [["PHASE",body.phases ?? []],["TASK",body.tasks ?? []]]) {
        if (!Array.isArray(items) || items.length > 1400 || new Set(items.map(x=>x?.id)).size !== items.length) throw fault("WORKFLOW_TASK_SELECTION_INVALID");
        for (const item of items) {
          const entity = kind === "PHASE" ? phaseContext(key,item.id) : getTask(item.id);
          const phase = kind === "PHASE" ? entity : phaseContext(key,entity.phase_id);
          requireRight(kind === "PHASE" ? ownsPhase(u,w,phase) : ownsTask(u,w,phase,entity));
          if (item.due_at === entity.due_at) continue;
          requirePhaseOpen(phase);
          if (kind === "TASK" && entity.status === "COMPLETED") throw fault("WORKFLOW_TASK_CLOSED",409);
          const due = localTime(item.due_at);
          run(`UPDATE ${kind === "PHASE" ? "wf2_phases" : "workshop_subtasks"} SET due_at=? WHERE id=?`,due,entity.id);
          audit(w,u,"SCHEDULE_ITEM_UPDATE",kind,entity.id,{due_at:entity.due_at},{due_at:due},body.reason);
        }
      }
    });
  }
  function addPhase(key, code, body, u) {
    return command(key, u, body, "PHASE_ADD", w => {
      requireRight(owns(u, w));
      if (w.finance_locked) throw fault("WORKFLOW_PHASE_FINANCE_CLOSED", 409);
      const d = definitions().find(row => row.code === code);
      if (!d) throw fault("WORKFLOW_PHASE_INVALID");
      if (one("SELECT 1 FROM wf2_phases WHERE workflow_id=? AND stage_code=?", key, code)) throw fault("WORKFLOW_PHASE_EXISTS", 409);
      const responsible = activeUser(body.responsible_user_id || w.main_responsible_user_id), phaseId = id("WP");
      run("INSERT INTO wf2_phases(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,responsible_user_id,title,due_at,required,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        phaseId, key, code, d.sort_order, d.name_en, d.name_hu, responsible.id, d.name_hu, body.due_at ? localTime(body.due_at) : w.final_due_at, d.required ? 1 : 0, d.default_status);
      audit(w, u, "PHASE_CREATE", "PHASE", phaseId, null, getPhase(phaseId), body.reason);
    });
  }
  function setAssignees(taskId, phase, values) {
    const ids = values === undefined ? [phase.responsible_user_id] : values;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw fault("WORKFLOW_ASSIGNEES_REQUIRED");
    for (const uid of new Set(ids)) activeUser(uid);
    run("DELETE FROM wf2_task_assignees WHERE task_id=?", taskId);
    for (const uid of new Set(ids)) run("INSERT INTO wf2_task_assignees(task_id,user_id) VALUES(?,?)", taskId, uid);
  }
  function insertTask(w, phase, body, u, reason) {
    const title = text(body.title,200);
    if (!title) throw fault("WORKFLOW_TITLE_REQUIRED");
    const taskId = id("WT"), due = localTime(body.due_at || phase.due_at || w.final_due_at);
    run("INSERT INTO workshop_subtasks(id,phase_id,title,description,due_at,required) VALUES(?,?,?,?,?,?)",
      taskId,phase.id,title,text(body.description),due,flag(body.required,true)?1:0);
    setAssignees(taskId,phase,body.assignee_ids);
    audit(w,u,"TASK_CREATE","TASK",taskId,null,taskSnapshot(getTask(taskId)),reason);
    return getTask(taskId);
  }
  function saveTask(key, phaseId, taskId, body, u) {
    return command(key, u, body, "TASK_SAVE", w => {
      const p = phaseContext(key, phaseId), t = taskId ? taskContext(p, taskId) : null;
      requireRight(t ? ownsTask(u, w, p, t) : ownsPhase(u, w, p)); requirePhaseOpen(p);
      if (t?.status === "COMPLETED") throw fault("WORKFLOW_USE_TASK_REOPEN", 409);
      if (!t) { insertTask(w,p,body,u,body.reason); return; }
      const manager = ownsPhase(u, w, p);
      if (!manager && ["title", "description", "assignee_ids", "required", "status"].some(field => body[field] !== undefined)) throw fault("WORKFLOW_FORBIDDEN", 403);
      if (body.status !== undefined) throw fault("WORKFLOW_USE_TASK_COMPLETE", 409);
      const title = text(body.title ?? t.title, 200);
      if (!title) throw fault("WORKFLOW_TITLE_REQUIRED");
      const due = body.due_at === undefined ? (t.due_at || p.due_at || null) : body.due_at === t.due_at ? t.due_at : localTime(body.due_at);
      const tid = t.id, before = taskSnapshot(t), required = flag(body.required, Boolean(t.required)) ? 1 : 0;
      run("UPDATE workshop_subtasks SET title=?,description=?,due_at=?,required=? WHERE id=?", title, text(body.description ?? t.description), due, required, tid);
      if (body.assignee_ids !== undefined) setAssignees(tid, p, body.assignee_ids);
      audit(w, u, "TASK_UPDATE", "TASK", tid, before, taskSnapshot(getTask(tid)), body.reason);
    });
  }
  function markTaskComplete(w, p, t, u, reason, override = false) {
    if (t.status === "COMPLETED") return;
    const pendingChecks = all("SELECT * FROM wf2_checklist WHERE task_id=? AND required=1 AND checked=0", t.id);
    if (pendingChecks.length && !override) throw fault("WORKFLOW_CHECKLIST_INCOMPLETE", 409);
    for (const check of pendingChecks) {
      run("UPDATE wf2_checklist SET checked=1,checked_by=?,checked_at=CURRENT_TIMESTAMP WHERE id=?", u.id, check.id);
      audit(w, u, "CHECKLIST_OVERRIDE", "CHECKLIST", check.id, check, { ...check, checked: 1, checked_by: u.id }, reason);
    }
    const own = assignedTask(u, t);
    run("UPDATE workshop_subtasks SET status='COMPLETED',completed_by=?,completed_at=CURRENT_TIMESTAMP,approved_by=?,approval_reason=? WHERE id=?",
      u.id, own ? null : u.id, own ? null : text(reason), t.id);
    audit(w, u, own ? "TASK_COMPLETE" : "TASK_APPROVED_FOR_ASSIGNEES", "TASK", t.id, taskSnapshot(t), taskSnapshot(getTask(t.id)), reason);
    if (!own) notifyApproval(w, t, u, reason);
  }
  function completeTask(key, phaseId, taskId, body, u) {
    return command(key, u, body, "TASK_COMPLETE", w => {
      const p = phaseContext(key, phaseId), t = taskContext(p, taskId);
      requireRight(ownsTask(u, w, p, t)); requirePhaseOpen(p);
      markTaskComplete(w, p, t, u, body.reason, admin(u));
    });
  }
  function reopenTask(key, phaseId, taskId, body, u) {
    return command(key, u, body, "TASK_REOPEN", w => {
      requireRight(admin(u)); const p = phaseContext(key, phaseId), t = taskContext(p, taskId);
      if (p.status === "NOT_REQUIRED") throw fault("WORKFLOW_PHASE_CLOSED", 409);
      if (p.status === "COMPLETED") {
        run("UPDATE wf2_phases SET status='IN_PROGRESS',completed_at=NULL,completed_by=NULL,financial_status=? WHERE id=?", w.finance_locked ? "CLOSED" : "OPEN", p.id);
        audit(w, u, "PHASE_REOPEN", "PHASE", p.id, p, getPhase(p.id), body.reason);
      }
      run("UPDATE workshop_subtasks SET status='OPEN',completed_by=NULL,completed_at=NULL,approved_by=NULL,approval_reason=NULL WHERE id=?", t.id);
      audit(w, u, "TASK_REOPENED", "TASK", t.id, t, getTask(t.id), body.reason);
    });
  }
  function deleteTask(key, phaseId, taskId, body, u) {
    return command(key, u, body, "TASK_DELETE", w => {
      const p = phaseContext(key, phaseId), t = taskContext(p, taskId); requireRight(ownsPhase(u, w, p)); requirePhaseOpen(p);
      const before = taskSnapshot(t); run("DELETE FROM workshop_subtasks WHERE id=?", t.id);
      audit(w, u, "TASK_REMOVED", "TASK", t.id, before, null, body.reason);
    });
  }
  function custody(w) {
    run("INSERT INTO workflow_finance_sources(id,workflow_key,client_id,piano_id,mode,title,final_due_at,created_by_user_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,final_due_at=excluded.final_due_at",
      w.id, w.workflow_key, w.client_id, w.piano_id, w.mode, w.title, w.final_due_at, w.creator_user_id);
    for (const p of all("SELECT * FROM wf2_phases WHERE workflow_id=?", w.id)) run("INSERT INTO workflow_finance_phases(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,card_title,assigned_user_id,status,due_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET card_title=excluded.card_title,assigned_user_id=excluded.assigned_user_id,status=excluded.status,due_at=excluded.due_at",
      p.id, w.id, p.stage_code, p.stage_order, p.name_snapshot_en, p.name_snapshot_hu, p.title, p.responsible_user_id, p.status, p.due_at);
    return one("SELECT * FROM workflow_finance_sources WHERE id=?", w.id);
  }
  function postCost(w, p, cost, u) {
    if (cost.finance_line_id || !cost.amount_cents || cost.voided_at) return;
    const source = custody(w), lineId = id("WFL");
    run("INSERT INTO workflow_finance_lines(id,workflow_id,stage_id,line_type,category,title,amount,billing_status,partner_id,created_by_user_id) VALUES(?,?,?,'COST',?,?,?,?,?,?)",
      lineId, w.id, p.id, cost.category, cost.title, cost.amount_cents / 100, cost.billing_status, cost.partner_id, u.id);
    const line = one("SELECT * FROM workflow_finance_lines WHERE id=?", lineId);
    finance.postWipForLine(line, source, u);
    if (cost.partner_id) {
      const bill = invoiceEngine.createWorkflowPayableInvoice({ workflow: source, stage: p, line, partner: one("SELECT * FROM partners WHERE id=?", cost.partner_id), actor: u, now: nowLocal() });
      if (bill) run("UPDATE workflow_finance_lines SET payable_invoice_id=? WHERE id=?", bill.id, lineId);
    }
    run("UPDATE wf2_costs SET finance_line_id=? WHERE id=?", lineId, cost.id);
  }
  function postPhase(w, p, u) {
    custody(w);
    for (const cost of all("SELECT * FROM wf2_costs WHERE phase_id=? AND voided_at IS NULL", p.id)) postCost(w, p, cost, u);
    run("UPDATE wf2_phases SET financial_status='CLOSED' WHERE id=?", p.id);
    run("UPDATE workflow_finance_phases SET financial_status='CLOSED',financial_closed_at=CURRENT_TIMESTAMP,financial_closed_by_user_id=? WHERE id=?", u.id, p.id);
  }
  function saveCost(key, phaseId, costId, body, u, remove = false) {
    return command(key, u, body, remove ? "COST_WRITE_OFF" : "COST_SAVE", w => {
      const p = phaseContext(key, phaseId); requireRight(ownsPhase(u, w, p));
      if (w.finance_locked || p.financial_status === "CLOSED") throw fault("WORKFLOW_PHASE_FINANCE_CLOSED", 409);
      requirePhaseOpen(p);
      const old = costId ? one("SELECT * FROM wf2_costs WHERE id=? AND phase_id=?", costId, p.id) : null;
      if (costId && !old) throw fault("WORKFLOW_COST_NOT_FOUND", 404);
      if (remove) {
        requireRight(owns(u, w));
        if (body.confirmed !== true) throw fault("WORKFLOW_DELETE_CONFIRMATION_REQUIRED");
        if (old.voided_at) return;
        postCost(w, p, old, u);
        const current = one("SELECT * FROM wf2_costs WHERE id=?", old.id);
        if (current.finance_line_id) finance.writeOffWipForLine(one("SELECT * FROM workflow_finance_lines WHERE id=?", current.finance_line_id), custody(w), u, body.reason);
        run("UPDATE wf2_costs SET voided_at=CURRENT_TIMESTAMP,void_reason=? WHERE id=?", text(body.reason), old.id);
        audit(w, u, "COST_WRITTEN_OFF", "COST", old.id, old, one("SELECT * FROM wf2_costs WHERE id=?", old.id), body.reason);
        return;
      }
      if (old?.finance_line_id || old?.voided_at) throw fault("WORKFLOW_POSTED_COST_REQUIRES_ADJUSTMENT", 409);
      const category = body.category || old?.category || "OTHER", title = text(body.title || old?.title || category, 200);
      const billing = body.billing_status || old?.billing_status || "FREE";
      if (!["LABOR", "MATERIAL", "TRANSPORT", "PURCHASE", "CONTRACTOR", "OTHER"].includes(category) || !["CHARGEABLE", "WARRANTY", "FREE", "COMPENSATION", "CREDIT"].includes(billing)) throw fault("WORKFLOW_COST_CATEGORY_INVALID");
      const partner = body.partner_id === undefined ? (old?.partner_id || null) : (body.partner_id || null);
      if (partner && !one("SELECT 1 FROM partners WHERE id=? AND status='active'", partner)) throw fault("WORKFLOW_PARTNER_INVALID");
      const amount = body.amount === undefined ? (old?.amount_cents ?? money(body.amount)) : money(body.amount);
      const charge = body.charge_amount === undefined ? (old?.charge_cents ?? (billing === "CHARGEABLE" ? amount : 0)) : money(body.charge_amount);
      const costKey = old?.id || id("WC"), approved = owns(u, w);
      run("INSERT INTO wf2_costs(id,phase_id,title,category,amount_cents,charge_cents,billing_status,partner_id,created_by,approval_status,approved_by,approved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,amount_cents=excluded.amount_cents,charge_cents=excluded.charge_cents,billing_status=excluded.billing_status,partner_id=excluded.partner_id,approval_status=excluded.approval_status,approved_by=excluded.approved_by,approved_at=excluded.approved_at",
        costKey, p.id, title, category, amount, charge, billing, partner, u.id, approved ? "APPROVED" : "PENDING", approved ? u.id : null, approved ? new Date().toISOString() : null);
      postCost(w, p, one("SELECT * FROM wf2_costs WHERE id=?", costKey), u);
      audit(w, u, "COST_RECORDED", "COST", costKey, old, one("SELECT * FROM wf2_costs WHERE id=?", costKey), body.reason);
    });
  }
  function approveCost(key, phaseId, costId, body, u) {
    return command(key, u, body, "COST_APPROVE", w => {
      requireRight(owns(u, w)); const p = phaseContext(key, phaseId), cost = one("SELECT * FROM wf2_costs WHERE id=? AND phase_id=? AND voided_at IS NULL", costId, p.id);
      if (!cost) throw fault("WORKFLOW_COST_NOT_FOUND", 404);
      run("UPDATE wf2_costs SET approval_status='APPROVED',approved_by=?,approved_at=CURRENT_TIMESTAMP WHERE id=?", u.id, cost.id);
      audit(w, u, "COST_APPROVED", "COST", cost.id, cost, one("SELECT * FROM wf2_costs WHERE id=?", cost.id), body.reason);
    });
  }
  function checklist(key, phaseId, itemId, body, u, remove = false) {
    return command(key, u, body, "CHECKLIST", w => {
      const p = phaseContext(key, phaseId), old = itemId ? one("SELECT * FROM wf2_checklist WHERE id=? AND phase_id=?", itemId, p.id) : null;
      if (itemId && !old) throw fault("WORKFLOW_CHECKLIST_NOT_FOUND", 404);
      const taskId = body.task_id === undefined ? (old?.task_id || null) : (body.task_id || null), task = taskId ? taskContext(p, taskId) : null;
      requireRight(ownsPhase(u, w, p) || (task && assignedTask(u, task))); requirePhaseOpen(p);
      if (task?.status === "COMPLETED") throw fault("WORKFLOW_USE_TASK_REOPEN", 409);
      if (!ownsPhase(u, w, p) && (remove || !old || ["title", "required", "task_id"].some(field => body[field] !== undefined))) throw fault("WORKFLOW_FORBIDDEN", 403);
      if (old?.checked && body.checked === false && !admin(u)) throw fault("WORKFLOW_REOPEN_ADMIN_REQUIRED", 403);
      if (remove) { run("DELETE FROM wf2_checklist WHERE id=?", old.id); audit(w, u, "CHECKLIST_DELETE", "CHECKLIST", old.id, old, null, body.reason); return; }
      const checkId = old?.id || id("WK"), title = text(body.title ?? old?.title, 300), checked = flag(body.checked, Boolean(old?.checked)) ? 1 : 0;
      if (!title) throw fault("WORKFLOW_TITLE_REQUIRED");
      run("INSERT INTO wf2_checklist(id,phase_id,task_id,title,required,checked,checked_by,checked_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id,title=excluded.title,required=excluded.required,checked=excluded.checked,checked_by=excluded.checked_by,checked_at=excluded.checked_at",
        checkId, p.id, taskId, title, flag(body.required, Boolean(old?.required ?? 1)) ? 1 : 0, checked, checked ? u.id : null, checked ? new Date().toISOString() : null);
      audit(w, u, "CHECKLIST_SAVE", "CHECKLIST", checkId, old, one("SELECT * FROM wf2_checklist WHERE id=?", checkId), body.reason);
    });
  }
  function phaseGates(w, p, u, body) {
    const tasks = all("SELECT * FROM workshop_subtasks WHERE phase_id=? AND required=1 AND status<>'COMPLETED'", p.id);
    const checks = all("SELECT * FROM wf2_checklist WHERE phase_id=? AND required=1 AND checked=0", p.id);
    const costs = all("SELECT * FROM wf2_costs WHERE phase_id=? AND voided_at IS NULL AND approval_status='PENDING'", p.id);
    if ((tasks.length || checks.length || costs.length) && !admin(u)) throw fault(costs.length ? "WORKFLOW_COST_APPROVAL_REQUIRED" : "WORKFLOW_PHASE_INCOMPLETE", 409, { tasks, checklist: checks, costs });
    for (const task of tasks) markTaskComplete(w, p, task, u, body.reason, true);
    for (const check of checks) {
      if (one("SELECT checked FROM wf2_checklist WHERE id=?", check.id)?.checked) continue;
      run("UPDATE wf2_checklist SET checked=1,checked_by=?,checked_at=CURRENT_TIMESTAMP WHERE id=?", u.id, check.id);
      audit(w, u, "CHECKLIST_APPROVED", "CHECKLIST", check.id, check, { ...check, checked: 1 }, body.reason);
    }
    for (const cost of costs) {
      run("UPDATE wf2_costs SET approval_status='APPROVED',approved_by=?,approved_at=CURRENT_TIMESTAMP WHERE id=?", u.id, cost.id);
      audit(w, u, "COST_APPROVED", "COST", cost.id, cost, one("SELECT * FROM wf2_costs WHERE id=?", cost.id), body.reason);
    }
  }
  function closePhase(key, phaseId, body, u) {
    return command(key, u, body, "PHASE_CLOSE", w => {
      const p = phaseContext(key, phaseId); requireRight(ownsPhase(u, w, p));
      if (p.status === "COMPLETED") return;
      if (p.status === "NOT_REQUIRED") throw fault("WORKFLOW_PHASE_CLOSED", 409);
      phaseGates(w, p, u, body);
      run("UPDATE wf2_phases SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,completed_by=? WHERE id=?", u.id, p.id);
      postPhase(w, getPhase(p.id), u);
      audit(w, u, "PHASE_COMPLETE", "PHASE", p.id, p, getPhase(p.id), body.reason);
    });
  }
  function reopenPhase(key, phaseId, body, u) {
    return command(key, u, body, "PHASE_REOPEN", w => {
      requireRight(admin(u)); const p = phaseContext(key, phaseId);
      run("UPDATE wf2_phases SET status='IN_PROGRESS',completed_at=NULL,completed_by=NULL,financial_status=? WHERE id=?", w.finance_locked ? "CLOSED" : "OPEN", p.id);
      audit(w, u, "PHASE_REOPENED", "PHASE", p.id, p, getPhase(p.id), body.reason);
    });
  }
  function closeWorkflow(key, body, u) {
    const current = getWorkflow(key); requireRight(owns(u, current));
    if (current.status === "COMPLETED" && !current.aborted_at && !current.deleted_at) { adminReason(u, body); return detail(key, u); }
    return command(key, u, body, "WORKFLOW_CLOSE", w => {
      requireRight(owns(u, w));
      const phases = all("SELECT * FROM wf2_phases WHERE workflow_id=?", key);
      const pending = phases.filter(p => p.required && p.status !== "COMPLETED" && p.status !== "NOT_REQUIRED");
      const tasks = all("SELECT t.* FROM workshop_subtasks t JOIN wf2_phases p ON p.id=t.phase_id WHERE p.workflow_id=? AND t.required=1 AND t.status<>'COMPLETED'", key);
      const checks = all("SELECT c.* FROM wf2_checklist c JOIN wf2_phases p ON p.id=c.phase_id WHERE p.workflow_id=? AND c.required=1 AND c.checked=0", key);
      const pendingCosts = all("SELECT c.* FROM wf2_costs c JOIN wf2_phases p ON p.id=c.phase_id WHERE p.workflow_id=? AND c.voided_at IS NULL AND c.approval_status='PENDING'", key);
      const unfinished = pending.length || tasks.length || checks.length || pendingCosts.length;
      const overridden = u.id !== w.main_responsible_user_id || Boolean(unfinished);
      if (unfinished && !admin(u)) throw fault("WORKFLOW_INCOMPLETE", 409, {
        phases: pending.map(p => ({ title: p.title, responsible: person(p.responsible_user_id)?.name || "" })),
        tasks: tasks.map(t => ({ title: t.title, responsible: taskSnapshot(t).assignee_ids.map(uid => person(uid)?.name || uid).join(", ") })), checklist: checks, costs: pendingCosts
      });
      if (unfinished && admin(u) && !superuser(u) && body.override !== true) throw fault("WORKFLOW_OVERRIDE_CONFIRMATION_REQUIRED", 409);
      for (const p of phases.filter(p => p.status !== "NOT_REQUIRED")) {
        phaseGates(w, p, u, body);
        run("UPDATE wf2_phases SET status='COMPLETED',completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),completed_by=COALESCE(completed_by,?) WHERE id=?", u.id, p.id);
        if (!w.finance_locked) postPhase(w, getPhase(p.id), u);
        if (p.status !== "COMPLETED") audit(w, u, "PHASE_COMPLETE", "PHASE", p.id, p, getPhase(p.id), body.reason);
      }
      let invoice = w.invoice_id ? invoiceEngine.invoiceDetail(w.invoice_id) : null;
      const source = custody(w);
      const costs = all("SELECT c.*,p.id stage_id FROM wf2_costs c JOIN wf2_phases p ON p.id=c.phase_id WHERE p.workflow_id=? AND c.voided_at IS NULL", key);
      if (!w.finance_locked) {
        for (const line of all("SELECT * FROM workflow_finance_lines WHERE workflow_id=? AND line_type='COST'", key)) finance.releaseWipForLine(line, source, u);
        if (costs.some(c => c.charge_cents) && one("SELECT 1 FROM financial_statement_snapshots WHERE period>=? LIMIT 1", nowLocal().slice(0, 7))) throw fault("WORKFLOW_CLOSED_PERIOD_REVIEW_REQUIRED", 409);
        invoice = invoiceEngine.createWorkflowInvoice({ workflow: source,
          stages: phases.filter(p => p.status !== "NOT_REQUIRED"),
          lines: costs.map(c => ({ ...c, line_type: "COST", amount: c.charge_cents / 100, accounting_status: "RELEASED" })), actor: u, now: nowLocal(), paymentMethod: body.payment_method });
        if (invoice) { run("UPDATE invoices SET status='issued' WHERE id=?", invoice.id); invoiceEngine.postWorkflowInvoiceLedger(invoiceEngine.invoiceDetail(invoice.id), u); }
      }
      run("UPDATE wf2_workflows SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,completed_by=?,invoice_id=?,finance_locked=1 WHERE id=?", u.id, invoice?.id || null, key);
      run("UPDATE workflow_finance_sources SET current_status='COMPLETED',financial_status='CLOSED',financial_closed_at=CURRENT_TIMESTAMP,financial_closed_by_user_id=?,invoice_id=? WHERE id=?", u.id, invoice?.id || null, key);
      const snapshot = detail(key, u), costTotal = costs.reduce((sum, c) => sum + c.amount_cents, 0) / 100, revenue = invoice?.subtotal || 0;
      // Financial closeout is immutable across a later operational reopen.
      run("INSERT OR IGNORE INTO workflow_finance_closures(id,workflow_id,client_id,piano_id,final_due_at,closed_at,closed_by_user_id,closure_reason,revenue_total,cost_total,net_total,snapshot_json) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?)",
        id("WFC"), key, w.client_id, w.piano_id, w.final_due_at, u.id, text(body.reason), revenue, costTotal, revenue - costTotal, JSON.stringify(snapshot));
      run("INSERT INTO wf2_closeouts(workflow_id,actor_user_id,override,reason,snapshot_json) VALUES(?,?,?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET actor_user_id=excluded.actor_user_id,override=excluded.override,reason=excluded.reason,snapshot_json=excluded.snapshot_json,created_at=CURRENT_TIMESTAMP", key, u.id, overridden ? 1 : 0, text(body.reason), JSON.stringify(snapshot));
      audit(w, u, overridden ? "WORKFLOW_OVERRIDE_CLOSE" : "WORKFLOW_COMPLETED", "WORKFLOW", key, w, getWorkflow(key), body.reason);
    });
  }
  function reopenWorkflow(key, body, u) {
    return command(key, u, body, "WORKFLOW_REOPEN", w => {
      requireRight(admin(u));
      if (w.aborted_at || w.deleted_at) throw fault("WORKFLOW_ABANDONED_REOPEN_FORBIDDEN", 409);
      if (w.status !== "COMPLETED") throw fault("WORKFLOW_NOT_CLOSED", 409);
      run("UPDATE wf2_workflows SET status='ACTIVE',completed_at=NULL,completed_by=NULL,finance_locked=1 WHERE id=?", key);
    }, { allowClosed: true });
  }
  function deletePhase(key, phaseId, body, u) {
    return command(key, u, body, "PHASE_DELETE", w => {
      requireRight(owns(u, w));
      if (body.confirmed !== true) throw fault("WORKFLOW_DELETE_CONFIRMATION_REQUIRED");
      if (w.finance_locked) throw fault("WORKFLOW_RELEASED_COST_REQUIRES_ADJUSTMENT", 409);
      const p = phaseContext(key, phaseId), source = custody(w);
      // The supplied 42 archive may still contain unposted manual costs.
      // Post and write off inside this SAME transaction before removing a phase.
      for (const cost of all("SELECT * FROM wf2_costs WHERE phase_id=? AND voided_at IS NULL", p.id)) postCost(w, p, cost, u);
      const loss = finance.writeOffStageWip(p, source, u, body.reason);
      run("UPDATE workflow_finance_phases SET stage_code=stage_code||':REMOVED:'||id,status='ABORTED' WHERE id=?", p.id);
      const before = { ...p, tasks: all("SELECT * FROM workshop_subtasks WHERE phase_id=?", p.id), costs: all("SELECT * FROM wf2_costs WHERE phase_id=?", p.id) };
      run("DELETE FROM wf2_phases WHERE id=?", p.id);
      audit(w, u, "PHASE_ABANDONED", "PHASE", p.id, before, { loss }, body.reason);
    });
  }
  function abandonWorkflow(key, body, u, remove = false) {
    const current = getWorkflow(key); requireRight(owns(u, current));
    if (current.deleted_at || (!remove && current.aborted_at)) { adminReason(u, body); return detail(key, u); }
    return command(key, u, body, remove ? "WORKFLOW_DELETE" : "WORKFLOW_ABORT", w => {
      requireRight(owns(u, w));
      if (body.confirmed !== true) throw fault("WORKFLOW_DELETE_CONFIRMATION_REQUIRED");
      if (w.finance_locked || w.status === "COMPLETED") throw fault("WORKFLOW_RELEASED_COST_REQUIRES_ADJUSTMENT", 409);
      const source = custody(w), losses = [];
      for (const p of all("SELECT * FROM wf2_phases WHERE workflow_id=?", key)) {
        for (const cost of all("SELECT * FROM wf2_costs WHERE phase_id=? AND voided_at IS NULL", p.id)) postCost(w, p, cost, u);
        losses.push({ phase_id: p.id, ...finance.writeOffStageWip(p, source, u, body.reason) });
      }
      run(`UPDATE wf2_workflows SET aborted_at=COALESCE(aborted_at,CURRENT_TIMESTAMP),${remove ? "deleted_at=CURRENT_TIMESTAMP," : ""}abandonment_reason=? WHERE id=?`, text(body.reason), key);
      run("UPDATE workflow_finance_sources SET current_status='ABORTED',financial_status='CLOSED',financial_closed_at=CURRENT_TIMESTAMP,financial_closed_by_user_id=? WHERE id=?", u.id, key);
      run("UPDATE workflow_finance_phases SET status='ABORTED' WHERE workflow_id=?", key);
      audit(w, u, "WORKFLOW_LOSS_WRITE_OFF", "WORKFLOW", key, w, { status: remove ? "DELETED" : "ABORTED", losses }, body.reason);
    }, { allowClosed: Boolean(current.aborted_at) });
  }
  function canDocument(key, phaseId, taskId, u) {
    const w = getWorkflow(key), p = phaseContext(key, phaseId); requireActive(w); requirePhaseOpen(p);
    // Subresponsibles may complete/schedule their task, not manage attachments.
    requireRight(ownsPhase(u, w, p));
    if (taskId) taskContext(p, taskId);
    return { w, p };
  }
  function addDocument(key, phaseId, body, file, u) {
    return command(key, u, body, "DOCUMENT_ADD", w => {
      canDocument(key, phaseId, body.task_id, u); const doc = id("WD");
      run("INSERT INTO wf2_documents(id,phase_id,task_id,original_name,stored_name,mime_type,size_bytes,sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)",
        doc, phaseId, body.task_id || null, text(file.original_name, 250), file.stored_name, file.mime_type, file.size_bytes, file.sha256, u.id);
      audit(w, u, "DOCUMENT_ADDED", "DOCUMENT", doc, null, { name: file.original_name, sha256: file.sha256 }, body.reason);
    });
  }
  function removeDocument(key, phaseId, docId, body, u) {
    return command(key, u, body, "DOCUMENT_DELETE", w => {
      const doc = one("SELECT * FROM wf2_documents WHERE id=? AND phase_id=?", docId, phaseId);
      if (!doc) throw fault("WORKFLOW_DOCUMENT_NOT_FOUND", 404);
      canDocument(key, phaseId, doc.task_id, u); run("DELETE FROM wf2_documents WHERE id=?", docId);
      audit(w, u, "DOCUMENT_REMOVED", "DOCUMENT", docId, doc, null, body.reason);
    });
  }
  function link(jobId) { return one("SELECT * FROM wf2_calendar_links WHERE job_id=?", jobId); }
  function retiredJob(jobId) { return one("SELECT * FROM workflow_retired_calendar_jobs WHERE job_id=?", jobId); }
  function jobRights(jobId, u) {
    if (retiredJob(jobId)) return false;
    const linked = link(jobId); if (!linked) return null;
    const w = getWorkflow(linked.workflow_id); if (!active(w)) return false;
    if (linked.entity_type === "PHASE") { const p = getPhase(linked.entity_id); return !["COMPLETED", "NOT_REQUIRED"].includes(p.status) && ownsPhase(u, w, p); }
    if (linked.entity_type === "TASK") { const t = getTask(linked.entity_id), p = getPhase(t.phase_id); return t.status !== "COMPLETED" && !["COMPLETED", "NOT_REQUIRED"].includes(p.status) && ownsTask(u, w, p, t); }
    return owns(u, w);
  }
  function canReschedule(jobId, u) {
    const linked = link(jobId);
    return Boolean(linked && jobRights(jobId,u) && (linked.entity_type !== "FINAL" || admin(u)));
  }
  function calendarRow(row, u) {
    const retired = retiredJob(row.id);
    if (retired && one("SELECT 1 FROM wf2_workflows WHERE id=?", retired.workflow_id)) return { ...row, calendar_entry_type: "WORKFLOW_V2", wf2_workflow_id: retired.workflow_id, wf2_entity_type: "RETIRED", wf2_can_edit: false };
    const linked = link(row.id); if (!linked) return row;
    const t = linked.entity_type === "TASK" ? getTask(linked.entity_id) : null;
    return { ...row, calendar_entry_type: "WORKFLOW_V2", wf2_workflow_id: linked.workflow_id, wf2_entity_type: linked.entity_type,
      wf2_entity_id: linked.entity_id, wf2_phase_id: t?.phase_id || (linked.entity_type === "PHASE" ? linked.entity_id : null),
      wf2_can_edit: Boolean(jobRights(row.id, u)), wf2_can_reschedule: canReschedule(row.id,u), wf2_assignee_ids: t ? taskSnapshot(t).assignee_ids : [row.assigned_user_id] };
  }
  function rescheduleJob(jobId, body, u) {
    const linked = link(jobId); if (!linked) throw fault("WORKFLOW_CALENDAR_LINK_NOT_FOUND", 404);
    requireRight(canReschedule(jobId, u)); const due = localTime(body.target_date || body.start_time);
    const oldJob = one("SELECT * FROM jobs WHERE id=?", jobId);
    if (body.assigned_user_id !== undefined && body.assigned_user_id !== oldJob.assigned_user_id) throw fault("WORKFLOW_ASSIGN_IN_DETAILS", 409);
    return command(linked.workflow_id, u, body, "RESCHEDULE", w => {
      if (linked.entity_type === "START" || linked.entity_type === "FINAL") run(`UPDATE wf2_workflows SET ${linked.entity_type === "START" ? "start_at" : "final_due_at"}=? WHERE id=?`, due, w.id);
      else if (linked.entity_type === "PHASE") run("UPDATE wf2_phases SET due_at=? WHERE id=?", due, linked.entity_id);
      else run("UPDATE workshop_subtasks SET due_at=? WHERE id=?", due, linked.entity_id);
      audit(w, u, "DEADLINE_RESCHEDULE", linked.entity_type, linked.entity_id, { date: oldJob.start_time }, { date: due }, body.reason || "Calendar reschedule");
    });
  }
  function completeJob(jobId, body, u) {
    const linked = link(jobId); if (!linked) throw fault("WORKFLOW_CALENDAR_LINK_NOT_FOUND", 404);
    const w = getWorkflow(linked.workflow_id);
    // Authorization on the domain entity remains mandatory on repeated calls.
    if (linked.entity_type === "PHASE") return closePhase(w.id, linked.entity_id, body, u);
    if (linked.entity_type === "TASK") { const task = getTask(linked.entity_id); return completeTask(w.id, task.phase_id, task.id, body, u); }
    if (linked.entity_type === "FINAL") return closeWorkflow(w.id, body, u);
    requireRight(owns(u, w));
    return command(w.id, u, body, "WORKFLOW_STARTED", current => {
      run("UPDATE jobs SET status='Completed',notes='WF2_STARTED' WHERE id=?", jobId);
      audit(current, u, "START_CONFIRMED", "WORKFLOW", current.id, null, { started: true }, body.reason);
    });
  }
  function purgePreview(key, u) {
    requireRight(superuser(u));
    const rows = key ? all("SELECT id FROM wf2_workflows WHERE id=? AND deleted_at IS NULL", key) : all("SELECT id FROM wf2_workflows WHERE status='ACTIVE' AND finance_locked=0 AND deleted_at IS NULL");
    return { workflows: rows.length, ledger_preserved: true, mode: "SOFT_DELETE_AND_WIP_WRITE_OFF" };
  }
  function purge(key, body, u) {
    requireRight(superuser(u));
    const expected = key ? `DELETE WORKFLOW ${key}` : "DELETE ALL WORKFLOWS";
    if (body.confirmation !== expected) throw fault("WORKFLOW_DELETE_CONFIRMATION_REQUIRED");
    return db.transaction(() => {
      const rows = key ? [getWorkflow(key)] : all("SELECT * FROM wf2_workflows WHERE status='ACTIVE' AND finance_locked=0 AND deleted_at IS NULL");
      for (const w of rows) abandonWorkflow(w.id, { confirmed: true, reason: body.reason || "Superadmin deletion" }, u, true);
      return { ok: true, workflows: rows.length, ledger_preserved: true, mode: "SOFT_DELETE_AND_WIP_WRITE_OFF" };
    })();
  }
  function saveDefinitions(body, u) {
    requireRight(admin(u)); adminReason(u, body);
    return db.transaction(() => {
      const before = definitions(), codes = new Set(before.map(d => d.code)), items = body.stages;
      if (!Array.isArray(items) || items.length !== 7 || new Set(items.map(d => d.code)).size !== 7 || items.some(d => !codes.has(d.code))) throw fault("WORKFLOW_SEVEN_PHASES_REQUIRED");
      if (new Set(items.map(d => d.sort_order)).size !== 7 || items.some(d => !Number.isInteger(d.sort_order) || d.sort_order < 0 || d.sort_order > 6 || !text(d.name_en, 200) || !text(d.name_hu, 200) || !/^#[0-9a-f]{6}$/i.test(d.color) || !["WAITING", "IN_PROGRESS", "BLOCKED"].includes(d.default_status))) throw fault("WORKFLOW_PHASE_SETTINGS_INVALID");
      for (const d of items) {
        run("UPDATE workshop_phase_definitions SET name_en=?,name_hu=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE code=?", text(d.name_en, 200), text(d.name_hu, 200), d.sort_order, u.id, d.code);
        run("INSERT INTO wf2_phase_options(code,color,required,enabled,default_status) VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET color=excluded.color,required=excluded.required,enabled=excluded.enabled,default_status=excluded.default_status", d.code, d.color, flag(d.required) ? 1 : 0, flag(d.enabled) ? 1 : 0, d.default_status);
        run("UPDATE wf2_phases SET stage_order=?,name_snapshot_en=?,name_snapshot_hu=? WHERE stage_code=?", d.sort_order, d.name_en, d.name_hu, d.code);
      }
      if (!superuser(u)) run("INSERT INTO audit_log(id,user_id,user_name,user_role,action,module,record_id,old_value,new_value,success,audit_type) VALUES(?,?,?,?,?,'workshop_workflow','PHASE_DEFINITIONS',?,?,1,'WORK')",
        id("AUD"), u.id, u.name, u.role, "PHASE_DEFINITIONS_UPDATED", JSON.stringify(before), JSON.stringify({ stages: items, reason: text(body.reason) }));
      run("UPDATE wf2_workflows SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE status='ACTIVE' AND aborted_at IS NULL AND deleted_at IS NULL");
      return definitions();
    })();
  }
  function options() {
    return { users: all("SELECT id,name,role FROM users WHERE status='Active' ORDER BY name"), clients: all("SELECT id,name,email,phone,address FROM contacts ORDER BY name"),
      pianos: all("SELECT p.id,p.owner_contact_id,p.brand,p.model,p.serial_no,p.display_name,p.location,cp.location_name,cp.piano_location_address FROM pianos p LEFT JOIN client_pianos cp ON cp.piano_id=p.id AND cp.client_id=p.owner_contact_id ORDER BY p.brand,p.model,p.id"),
      client_pianos: all("SELECT client_id,piano_id FROM client_pianos"), partners: all("SELECT id,company_name FROM partners WHERE status='active' ORDER BY company_name"), stages: definitions(), task_catalog: taskCatalog, interval_minutes: 30, time_zone: "America/New_York", ui_contract: "UI12" };
  }
  return { create, update, updateSchedule, canReschedule, detail, definitions, saveDefinitions, updatePhase, addPhase, saveTask, completeTask, reopenTask, deleteTask,
    saveCost, approveCost, checklist, closePhase, reopenPhase, closeWorkflow, reopenWorkflow, abandonWorkflow, deletePhase,
    addDocument, removeDocument, canDocument, link, retiredJob, jobRights, calendarRow, rescheduleJob, completeJob, purge, purgePreview, list, options };
}
module.exports = { createWorkflowV2, localTime, admin, superuser };
