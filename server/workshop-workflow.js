const DEFAULT_STAGES = [
  ["INBOUND", "Arrival & Transport", "Beérkezés és beszállítás"],
  ["ASSESSMENT", "Assessment & Plan", "Állapotfelmérés és terv"],
  ["ACOUSTICS", "Acoustics & Tone Treatment", "Akusztika és törőkezelés"],
  ["MECHANICS", "Mechanics & Keyboard", "Mechanika és billentyűzet"],
  ["VOICING", "Voicing & Tuning", "Intonálás és hangolás"],
  ["FINISH", "Restoration & Internal Repairs", "Restaurálás és belső javítás"],
  ["FINAL_HANDOVER", "Final Inspection & Delivery", "Végső ellenőrzés és kiszállítás"]
];

const STATUS = new Set(["WAITING", "IN_PROGRESS", "COMPLETED", "BLOCKED", "NOT_REQUIRED", "ABORTED"]);
const PRELIMINARY = new Set(["DONE", "NOT_DONE", "NOT_REQUIRED"]);
const MATERIAL_SOURCES = new Set(["CENTRAL_INVENTORY", "OWN_STOCK", "EXTERNAL_PURCHASE", "CLIENT_SUPPLIED", "NO_MATERIAL_COST"]);
const MATERIAL_STATUS = new Set(["REQUESTED", "RESERVED", "CONSUMED", "RELEASED"]);
const FINANCE_TYPES = new Set(["REVENUE", "COST"]);
const FINANCE_CATEGORIES = new Set(["LABOR", "MATERIAL", "TRANSPORT", "PURCHASE", "CONTRACTOR", "OTHER"]);

function registerWorkshopWorkflowRoutes({ app, db, auth, permit, requireSuperadmin, rid, nowISO, upload, notifyUser }) {
  const isSuper = (user) => Boolean(user && (user.role === "SUPERADMIN" || Number(user.is_superadmin || 0) === 1));
  const isAdmin = (user) => isSuper(user) || user?.role === "ADMIN";
  const isManagerOrAbove = (user) => isAdmin(user) || user?.role === "MANAGER";
  const clean = (value, max = 10000) => String(value ?? "").trim().slice(0, max);
  const validId = (value) => clean(value, 160);
  const localDateTime = (value) => {
    const text = clean(value, 40);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) ? text.slice(0, 16) : "";
  };
  const numeric = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const error = (code, message = code) => { const e = new Error(message); e.code = code; return e; };
  const userById = (id) => id ? db.prepare("SELECT id,name,role,status FROM users WHERE id=? AND status='Active'").get(id) : null;
  const workflowById = (id) => db.prepare("SELECT * FROM workshop_workflows WHERE id=?").get(id);
  const stageById = (id) => db.prepare("SELECT * FROM workflow_stages WHERE id=?").get(id);

  function directAudit(req, action, recordId, oldValue = null, newValue = null, details = "", auditType = "WORK") {
    db.prepare(`INSERT INTO audit_log(id,user_id,user_name,user_role,action,module,record_id,old_value,new_value,success,details,audit_type)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      rid("AUD"), req.user?.id || "", req.user?.name || "", req.user?.role || "", action, "workshop_workflow", recordId || "",
      oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue), 1, details || "", auditType
    );
  }

  function seedDefinitions() {
    const insert = db.prepare(`INSERT OR IGNORE INTO workflow_stage_definitions
      (id,code,name_en,name_hu,sort_order,active,is_system) VALUES(?,?,?,?,?,1,1)`);
    DEFAULT_STAGES.forEach(([code, en, hu], index) => insert.run(`WSD-${code}`, code, en, hu, index));
    const renameLegacy = db.prepare(`UPDATE workflow_stage_definitions SET name_en=?,name_hu=?,updated_at=CURRENT_TIMESTAMP
      WHERE code=? AND name_en=? AND name_hu=?`);
    renameLegacy.run("Acoustics & Tone Treatment", "Akusztika és törőkezelés", "ACOUSTICS", "Acoustics & Tuning", "Akusztika és tőkézés");
    renameLegacy.run("Restoration & Internal Repairs", "Restaurálás és belső javítás", "FINISH", "Finish / Cabinet Repair", "Finis / házjavítás");
  }
  seedDefinitions();

  function definitions(includeInactive = true) {
    const rows = db.prepare(`SELECT * FROM workflow_stage_definitions ${includeInactive ? "" : "WHERE active=1"} ORDER BY sort_order,id`).all();
    return rows;
  }

  function stageRows(workflowId) {
    return db.prepare(`SELECT s.*,u.name AS assigned_user_name
      FROM workflow_stages s LEFT JOIN users u ON u.id=s.assigned_user_id
      WHERE s.workflow_id=? ORDER BY s.stage_order,s.id`).all(workflowId);
  }

  function financialRows(workflowId) {
    return db.prepare(`SELECT f.*,s.name_snapshot_en,s.name_snapshot_hu
      FROM workflow_financial_lines f LEFT JOIN workflow_stages s ON s.id=f.stage_id
      WHERE f.workflow_id=? ORDER BY f.created_at,f.id`).all(workflowId);
  }

  function materialRows(workflowId) {
    return db.prepare(`SELECT m.*,i.item_name AS inventory_item_name,i.quantity AS inventory_quantity,
      i.reserved_quantity AS inventory_reserved_quantity,s.name_snapshot_en,s.name_snapshot_hu
      FROM workflow_materials m LEFT JOIN inventory_items i ON i.id=m.inventory_item_id
      LEFT JOIN workflow_stages s ON s.id=m.stage_id WHERE m.workflow_id=? ORDER BY m.created_at,m.id`).all(workflowId);
  }

  function signedFinanceSummary(lines) {
    const revenue = lines.filter((row) => row.line_type === "REVENUE").reduce((sum, row) => sum + numeric(row.amount), 0);
    const costs = lines.filter((row) => row.line_type === "COST").reduce((sum, row) => sum + numeric(row.amount), 0);
    return { revenue_total: revenue, cost_total: costs, net_total: revenue - costs };
  }

  function decorateWorkflow(row, includeChildren = true) {
    if (!row) return null;
    const stages = includeChildren ? stageRows(row.id) : [];
    const lines = includeChildren ? financialRows(row.id) : [];
    const materials = includeChildren ? materialRows(row.id) : [];
    const summary = signedFinanceSummary(lines);
    return {
      ...row,
      stages,
      financial_lines: lines,
      materials,
      finance_summary: summary,
      is_overdue: row.current_status === "ACTIVE" && row.final_due_at < localDateTimeFromISO(nowISO()),
      final_due_at_ny: row.final_due_at
    };
  }

  function localDateTimeFromISO(value) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23" })
        .formatToParts(new Date(value)).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    } catch (_error) { return ""; }
  }

  function workflowList(query = {}) {
    const clauses = [];
    const values = [];
    const status = clean(query.status, 30);
    const date = clean(query.date, 10);
    const search = clean(query.q, 160).toLowerCase();
    if (status && ["ACTIVE", "COMPLETED", "ABORTED"].includes(status)) { clauses.push("w.current_status=?"); values.push(status); }
    else if (query.include_closed !== "1" && query.include_closed !== "true") clauses.push("w.current_status='ACTIVE'");
    if (date) { clauses.push("substr(w.final_due_at,1,10)=?"); values.push(date); }
    if (search) {
      clauses.push("lower(COALESCE(w.title,'')||' '||COALESCE(c.name,'')||' '||COALESCE(p.display_name,'')||' '||COALESCE(p.brand,'')||' '||COALESCE(p.model,'')||' '||COALESCE(p.serial_no,'')) LIKE ?");
      values.push(`%${search}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT w.*,c.name AS client_name,c.email AS client_email,
      p.display_name AS piano_display_name,p.brand,p.model,p.serial_no,p.location AS piano_location,
      tu.name AS transport_responsible_name_resolved,u.name AS financial_closed_by_name
      FROM workshop_workflows w JOIN contacts c ON c.id=w.client_id JOIN pianos p ON p.id=w.piano_id
      LEFT JOIN users tu ON tu.id=w.transport_responsible_user_id
      LEFT JOIN users u ON u.id=w.financial_closed_by_user_id ${where}
      ORDER BY CASE WHEN w.current_status='ACTIVE' THEN 0 ELSE 1 END,w.final_due_at,w.updated_at DESC`).all(...values);
    return rows.map((row) => decorateWorkflow(row, true));
  }

  function requireWorkflow(id) {
    const row = workflowById(id);
    if (!row) throw error("WORKFLOW_NOT_FOUND");
    return row;
  }

  function requireStage(id, workflowId) {
    const row = stageById(id);
    if (!row || row.workflow_id !== workflowId) throw error("WORKFLOW_STAGE_NOT_FOUND");
    return row;
  }

  function stageCanStart(workflow, stage) {
    if (stage.stage_order === 0) return true;
    if (workflow.mode === "INBOUND") {
      const inbound = db.prepare("SELECT status FROM workflow_stages WHERE workflow_id=? AND stage_order=0").get(workflow.id);
      if (!inbound || !["COMPLETED", "NOT_REQUIRED"].includes(inbound.status)) return false;
    }
    if (stage.stage_order > 1) {
      const previous = db.prepare("SELECT status FROM workflow_stages WHERE workflow_id=? AND stage_order=?").get(workflow.id, stage.stage_order - 1);
      if (!previous || !["COMPLETED", "NOT_REQUIRED"].includes(previous.status)) return false;
    }
    return true;
  }

  function validatePreliminary(body) {
    const fields = ["preliminary_inspection", "preliminary_assessment", "preliminary_quote", "preliminary_meeting"];
    const result = {};
    for (const field of fields) {
      const value = clean(body[field], 20).toUpperCase();
      if (value && !PRELIMINARY.has(value)) throw error("INVALID_PRELIMINARY_STATUS");
      result[field] = value || "NOT_REQUIRED";
    }
    return result;
  }

  function notifyAssigned(stage, workflow, actor) {
    if (!notifyUser || !stage.assigned_user_id || stage.assigned_user_id === actor?.id) return;
    try {
      notifyUser({
        recipientUserId: stage.assigned_user_id,
        senderUserId: actor?.id,
        type: "JOB_ASSIGNED",
        titleEn: "Workshop workflow assigned to you",
        titleHu: "Műhely-workflow került hozzád",
        bodyEn: `${workflow.title} · ${workflow.workflow_key}`,
        bodyHu: `${workflow.title} · ${workflow.workflow_key}`,
        metadata: { workflow_id: workflow.id, stage_id: stage.id },
        eventKey: `WORKFLOW_STAGE:${stage.id}:${stage.assigned_user_id}:${stage.updated_at || Date.now()}`
      });
    } catch (notifyError) { console.warn("workflow notification failed:", notifyError.message); }
  }

  app.get("/api/workflow/stage-definitions", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    res.json({ stages: definitions(isAdmin(req.user)) });
  });

  app.put("/api/workflow/stage-definitions", auth, permit("ADMIN"), (req, res) => {
    try {
      const items = Array.isArray(req.body?.stages) ? req.body.stages : [req.body || {}];
      if (!items.length) throw error("WORKFLOW_STAGES_REQUIRED");
      const update = db.prepare(`UPDATE workflow_stage_definitions SET name_en=?,name_hu=?,sort_order=?,active=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE code=?`);
      const insert = db.prepare(`INSERT INTO workflow_stage_definitions(id,code,name_en,name_hu,sort_order,active,is_system,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,1,0,?,?)`);
      const transaction = db.transaction(() => items.forEach((item) => {
        const code = clean(item.code, 80).toUpperCase();
        const current = db.prepare("SELECT * FROM workflow_stage_definitions WHERE code=?").get(code);
        const nameEn = clean(item.name_en || current?.name_en || "", 160);
        const nameHu = clean(item.name_hu || current?.name_hu || "", 160);
        if (!code || !nameEn || !nameHu) throw error("WORKFLOW_STAGE_NAME_REQUIRED");
        if (!current) {
          insert.run(rid("WSD"), code, nameEn, nameHu, Math.max(0, Math.floor(numeric(item.sort_order))), req.user.id, req.user.id);
        } else {
          update.run(nameEn, nameHu, Math.max(0, Math.floor(numeric(item.sort_order, current.sort_order))), item.active === false ? 0 : 1, req.user.id, code);
        }
      }));
      transaction();
      directAudit(req, "WORKFLOW_STAGE_DEFINITIONS_UPDATED", "WORKFLOW-CONFIG", null, items, "Stage configuration updated");
      res.json({ stages: definitions(true) });
    } catch (e) { res.status(400).json({ error: e.code || e.message }); }
  });

  app.get("/api/workflows", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try { res.json({ workflows: workflowList(req.query || {}) }); } catch (e) { res.status(400).json({ error: e.code || e.message }); }
  });

  app.get("/api/workflows/calendar-deadlines", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    const from = clean(req.query.from, 10), to = clean(req.query.to, 10);
    const rows = db.prepare(`SELECT w.id,w.workflow_key,w.title,w.final_due_at,w.current_status,c.name AS client_name,
      p.display_name AS piano_name,p.brand,p.model,p.serial_no
      FROM workshop_workflows w JOIN contacts c ON c.id=w.client_id JOIN pianos p ON p.id=w.piano_id
      WHERE w.final_due_at>=? AND w.final_due_at<? AND w.current_status IN ('ACTIVE','COMPLETED') ORDER BY w.final_due_at`).all(`${from || "0000-01-01"}T00:00`, `${to || "9999-12-31"}T00:00`);
    res.json(rows.map((row) => ({ ...row, calendar_entry_type: "WORKFLOW_DEADLINE", start_time: row.final_due_at, end_time: row.final_due_at, assigned_to: "Workshop workflow", status: row.current_status === "COMPLETED" ? "Completed" : "Open", billed_amount: 0, planned_amount: 0, service_address: "" })));
  });

  app.get("/api/workflows/previous", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    res.json({ workflows: workflowList({ ...req.query, status: "COMPLETED", include_closed: "1" }) });
  });

  app.get("/api/workflows/:id", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try { res.json(decorateWorkflow(requireWorkflow(req.params.id), true)); } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const body = req.body || {};
      const clientId = validId(body.client_id), pianoId = validId(body.piano_id);
      const client = db.prepare("SELECT id,name FROM contacts WHERE id=?").get(clientId);
      const piano = db.prepare("SELECT id,display_name,brand,model,serial_no FROM pianos WHERE id=?").get(pianoId);
      if (!client) throw error("CLIENT_NOT_FOUND");
      if (!piano) throw error("PIANO_NOT_FOUND");
      const mode = clean(body.mode, 20).toUpperCase() || "INBOUND";
      if (!["INBOUND", "ON_SITE"].includes(mode)) throw error("INVALID_WORKFLOW_MODE");
      const plannedJobId = validId(body.planned_job_id);
      if (plannedJobId && !db.prepare("SELECT id FROM planned_jobs WHERE id=?").get(plannedJobId)) throw error("PLANNED_JOB_NOT_FOUND");
      const title = clean(body.title || `${piano.display_name || `${piano.brand || ""} ${piano.model || ""}`.trim()} · workshop`, 240);
      const finalDueAt = localDateTime(body.final_due_at);
      if (!title || !finalDueAt) throw error("WORKFLOW_TITLE_AND_FINAL_DEADLINE_REQUIRED");
      const prelim = validatePreliminary(body);
      const assigned = userById(validId(body.transport_responsible_user_id));
      if (body.transport_responsible_user_id && !assigned) throw error("WORKFLOW_RESPONSIBLE_NOT_FOUND");
      const id = rid("WF");
      const key = `WF-${new Date().getFullYear()}-${id.slice(-8)}`;
      const transaction = db.transaction(() => {
        db.prepare(`INSERT INTO workshop_workflows(id,workflow_key,client_id,piano_id,mode,planned_job_id,title,description,current_status,financial_status,final_due_at,timezone,current_location,transport_address,transport_responsible_user_id,transport_responsible_name,transport_note,final_handover_type,created_by_user_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, key, clientId, pianoId, mode, plannedJobId || null, title, clean(body.description), "ACTIVE", "OPEN", finalDueAt, "America/New_York", clean(body.current_location, 500), clean(body.transport_address, 500), assigned?.id || null, assigned?.name || null, clean(body.transport_note, 3000), mode === "ON_SITE" ? "ON_SITE" : "DELIVERY", req.user.id
        );
        if (plannedJobId) db.prepare("UPDATE planned_jobs SET workflow_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id, plannedJobId);
        const stageDefinitions = definitions(false);
        const insertStage = db.prepare(`INSERT INTO workflow_stages(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,status,assigned_user_id,assigned_to,due_at,details,preliminary_inspection,preliminary_assessment,preliminary_quote,preliminary_meeting,preliminary_quote_amount)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        stageDefinitions.forEach((definition, index) => {
          const stageStatus = mode === "ON_SITE" && index === 0 ? "NOT_REQUIRED" : "WAITING";
          const due = index === stageDefinitions.length - 1 ? finalDueAt : localDateTime(body[`stage_due_${definition.code}`]);
          insertStage.run(rid("WFS"), id, definition.code, index, definition.name_en, definition.name_hu, stageStatus, null, null, due || null, "", index === 0 && mode === "INBOUND" ? prelim.preliminary_inspection : null, index === 0 && mode === "INBOUND" ? prelim.preliminary_assessment : null, index === 0 && mode === "INBOUND" ? prelim.preliminary_quote : null, index === 0 && mode === "INBOUND" ? prelim.preliminary_meeting : null, index === 0 ? numeric(body.preliminary_quote_amount) : 0);
        });
        directAudit(req, "WORKFLOW_CREATED", id, null, { workflow_key: key, client_id: clientId, piano_id: pianoId, mode }, "Workshop workflow created");
      });
      transaction();
      res.status(201).json(decorateWorkflow(workflowById(id), true));
    } catch (e) { res.status(e.code === "CLIENT_NOT_FOUND" || e.code === "PIANO_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.patch("/api/workflows/:id", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), body = req.body || {};
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const changes = [];
      const values = [];
      if (body.title !== undefined) { changes.push("title=?"); values.push(clean(body.title, 240)); }
      if (body.description !== undefined) { changes.push("description=?"); values.push(clean(body.description)); }
      if (body.final_handover_type !== undefined) { changes.push("final_handover_type=?"); values.push(body.final_handover_type === "ON_SITE" ? "ON_SITE" : "DELIVERY"); }
      if (body.final_due_at !== undefined) {
        if (!isAdmin(req.user)) throw error("FINAL_DEADLINE_ADMIN_ONLY");
        const due = localDateTime(body.final_due_at); if (!due) throw error("INVALID_FINAL_DEADLINE");
        changes.push("final_due_at=?"); values.push(due);
        const finalStage = db.prepare("SELECT id FROM workflow_stages WHERE workflow_id=? AND stage_order=(SELECT MAX(stage_order) FROM workflow_stages WHERE workflow_id=?)").get(workflow.id, workflow.id);
        if (finalStage) db.prepare("UPDATE workflow_stages SET due_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(due, finalStage.id);
      }
      if (!changes.length) return res.json(decorateWorkflow(workflow, true));
      values.push(workflow.id);
      db.prepare(`UPDATE workshop_workflows SET ${changes.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...values);
      directAudit(req, "WORKFLOW_UPDATED", workflow.id, workflow, workflowById(workflow.id), "Workshop workflow updated");
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.patch("/api/workflows/:id/stages/:stageId", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), stage = requireStage(req.params.stageId, workflow.id), body = req.body || {};
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      if (stage.status === "ABORTED") throw error("WORKFLOW_STAGE_ABORTED");
      const changes = [], values = [];
      if (body.status !== undefined) {
        const status = clean(body.status, 30).toUpperCase();
        if (!STATUS.has(status)) throw error("INVALID_WORKFLOW_STAGE_STATUS");
        if (status === "IN_PROGRESS" && !stageCanStart(workflow, stage)) throw error("WORKFLOW_STAGE_BLOCKED_BY_PREVIOUS_STAGE");
        if (status === "COMPLETED" && stage.stage_order > 0 && !stageCanStart(workflow, stage)) throw error("WORKFLOW_STAGE_BLOCKED_BY_PREVIOUS_STAGE");
        if (stage.stage_order === 0 && workflow.mode === "INBOUND" && status === "COMPLETED" && [stage.preliminary_inspection, stage.preliminary_assessment, stage.preliminary_quote, stage.preliminary_meeting].some((value) => !value)) throw error("INBOUND_PRELIMINARY_FIELDS_REQUIRED");
        changes.push("status=?"); values.push(status);
        if (status === "IN_PROGRESS" && !stage.started_at) { changes.push("started_at=?"); values.push(nowISO()); }
        if (status === "COMPLETED") { changes.push("completed_at=?"); values.push(nowISO()); }
      }
      if (body.details !== undefined) { changes.push("details=?"); values.push(clean(body.details)); }
      if (body.block_reason !== undefined) { changes.push("block_reason=?"); values.push(clean(body.block_reason, 2000)); }
      if (body.due_at !== undefined) {
        if (!isAdmin(req.user) && !(req.user.role === "MANAGER" && stage.stage_order < 6)) throw error("STAGE_DEADLINE_NOT_ALLOWED");
        const due = localDateTime(body.due_at); if (!due) throw error("INVALID_STAGE_DEADLINE");
        if (stage.stage_order === 6 && !isAdmin(req.user)) throw error("FINAL_DEADLINE_ADMIN_ONLY");
        changes.push("due_at=?"); values.push(due);
        if (stage.stage_order === 6 && isAdmin(req.user)) db.prepare("UPDATE workshop_workflows SET final_due_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(due, workflow.id);
      }
      if (body.assigned_user_id !== undefined) {
        const assignee = userById(validId(body.assigned_user_id));
        if (!assignee) throw error("WORKFLOW_ASSIGNEE_NOT_FOUND");
        if (assignee.id !== stage.assigned_user_id && !clean(body.reassignment_reason, 2000)) throw error("WORKFLOW_TRANSFER_REASON_REQUIRED");
        if (assignee.id !== stage.assigned_user_id) {
          db.prepare(`INSERT INTO workflow_stage_transfers(id,workflow_id,stage_id,from_user_id,to_user_id,reason,transferred_by_user_id) VALUES(?,?,?,?,?,?,?)`).run(rid("WFT"), workflow.id, stage.id, stage.assigned_user_id || null, assignee.id, clean(body.reassignment_reason, 2000), req.user.id);
        }
        changes.push("assigned_user_id=?", "assigned_to=?"); values.push(assignee.id, assignee.name);
      }
      if (stage.stage_order === 0 && workflow.mode === "INBOUND") {
        for (const field of ["preliminary_inspection", "preliminary_assessment", "preliminary_quote", "preliminary_meeting"]) {
          if (body[field] !== undefined) {
            const value = clean(body[field], 20).toUpperCase(); if (!PRELIMINARY.has(value)) throw error("INVALID_PRELIMINARY_STATUS");
            changes.push(`${field}=?`); values.push(value);
          }
        }
        if (body.preliminary_quote_amount !== undefined) { changes.push("preliminary_quote_amount=?"); values.push(Math.max(0, numeric(body.preliminary_quote_amount))); }
      }
      if (!changes.length) return res.json(decorateWorkflow(workflowById(workflow.id), true));
      values.push(stage.id);
      db.prepare(`UPDATE workflow_stages SET ${changes.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...values);
      db.prepare("UPDATE workshop_workflows SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(workflow.id);
      const updatedStage = stageById(stage.id);
      directAudit(req, "WORKFLOW_STAGE_UPDATED", stage.id, stage, updatedStage, "Workshop stage updated");
      notifyAssigned(updatedStage, workflow, req.user);
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/stages/:stageId/transfer", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), stage = requireStage(req.params.stageId, workflow.id);
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const assignee = userById(validId(req.body?.to_user_id)), reason = clean(req.body?.reason, 2000);
      if (!assignee) throw error("WORKFLOW_ASSIGNEE_NOT_FOUND");
      if (!reason) throw error("WORKFLOW_TRANSFER_REASON_REQUIRED");
      db.transaction(() => {
        db.prepare("INSERT INTO workflow_stage_transfers(id,workflow_id,stage_id,from_user_id,to_user_id,reason,transferred_by_user_id) VALUES(?,?,?,?,?,?,?)").run(rid("WFT"), workflow.id, stage.id, stage.assigned_user_id || null, assignee.id, reason, req.user.id);
        db.prepare("UPDATE workflow_stages SET assigned_user_id=?,assigned_to=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(assignee.id, assignee.name, stage.id);
        db.prepare("UPDATE workshop_workflows SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(workflow.id);
      })();
      const updated = stageById(stage.id);
      directAudit(req, "WORKFLOW_STAGE_TRANSFERRED", stage.id, stage, updated, reason);
      notifyAssigned(updated, workflow, req.user);
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  function materialMutation(workflow, existing, body, actor) {
    const source = clean(body.source_type || existing?.source_type, 40).toUpperCase();
    if (!MATERIAL_SOURCES.has(source)) throw error("INVALID_MATERIAL_SOURCE");
    const itemName = clean(body.item_name ?? existing?.item_name, 240);
    const requested = Math.max(0, numeric(body.requested_quantity ?? existing?.requested_quantity));
    if (!itemName || requested <= 0) throw error("MATERIAL_NAME_AND_QUANTITY_REQUIRED");
    const inventoryId = validId(body.inventory_item_id ?? existing?.inventory_item_id);
    const inventory = source === "CENTRAL_INVENTORY" ? db.prepare("SELECT * FROM inventory_items WHERE id=? AND deleted_at IS NULL").get(inventoryId) : null;
    if (source === "CENTRAL_INVENTORY" && !inventory) throw error("INVENTORY_ITEM_NOT_FOUND");
    if (inventory && requested > numeric(inventory.quantity) - numeric(inventory.reserved_quantity)) throw error("INVENTORY_QUANTITY_UNAVAILABLE");
    const stage = body.stage_id || existing?.stage_id ? stageById(validId(body.stage_id || existing.stage_id)) : null;
    if (stage && stage.workflow_id !== workflow.id) throw error("WORKFLOW_STAGE_NOT_FOUND");
    return { source, itemName, requested, inventoryId: inventory?.id || null, unit: clean(body.unit ?? existing?.unit, 40), unitCost: Math.max(0, numeric(body.unit_cost ?? existing?.unit_cost)), notes: clean(body.notes ?? existing?.notes), stageId: stage?.id || null, documentPath: clean(body.document_path ?? existing?.document_path, 500), actor };
  }

  app.get("/api/workflows/:id/materials", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try { requireWorkflow(req.params.id); res.json(materialRows(req.params.id)); } catch (e) { res.status(404).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/materials", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id); if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const material = materialMutation(workflow, null, req.body || {}, req.user);
      const id = rid("WFM");
      db.transaction(() => {
        db.prepare(`INSERT INTO workflow_materials(id,workflow_id,stage_id,source_type,inventory_item_id,item_name,requested_quantity,consumed_quantity,unit,unit_cost,status,notes,document_path,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, workflow.id, material.stageId, material.source, material.inventoryId, material.itemName, material.requested, 0, material.unit, material.unitCost, material.source === "CENTRAL_INVENTORY" ? "RESERVED" : "REQUESTED", material.notes, material.documentPath || null, req.user.id);
        if (material.inventoryId) db.prepare("UPDATE inventory_items SET reserved_quantity=COALESCE(reserved_quantity,0)+?,status='Reserved',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(material.requested, material.inventoryId);
      })();
      directAudit(req, "WORKFLOW_MATERIAL_ADDED", id, null, material, "Workflow material added");
      res.status(201).json(materialRows(workflow.id).find((row) => row.id === id));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.patch("/api/workflows/:id/materials/:materialId", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), existing = db.prepare("SELECT * FROM workflow_materials WHERE id=? AND workflow_id=?").get(req.params.materialId, workflow.id);
      if (!existing) throw error("WORKFLOW_MATERIAL_NOT_FOUND");
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const material = materialMutation(workflow, existing, req.body || {}, req.user);
      const nextStatus = clean(req.body?.status || existing.status, 20).toUpperCase();
      if (!MATERIAL_STATUS.has(nextStatus)) throw error("INVALID_MATERIAL_STATUS");
      const oldInventory = existing.inventory_item_id ? db.prepare("SELECT * FROM inventory_items WHERE id=?").get(existing.inventory_item_id) : null;
      db.transaction(() => {
        if (oldInventory && (nextStatus === "RELEASED" || nextStatus === "CONSUMED" || material.inventoryId !== oldInventory.id)) {
          db.prepare("UPDATE inventory_items SET reserved_quantity=MAX(0,COALESCE(reserved_quantity,0)-?),status=CASE WHEN COALESCE(reserved_quantity,0)-?<=0 THEN 'In Stock' ELSE 'Reserved' END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Math.max(0, numeric(existing.requested_quantity) - numeric(existing.consumed_quantity)), Math.max(0, numeric(existing.requested_quantity) - numeric(existing.consumed_quantity)), oldInventory.id);
        }
        let consumed = numeric(existing.consumed_quantity);
        if (nextStatus === "CONSUMED" && oldInventory) {
          const remaining = Math.max(0, numeric(existing.requested_quantity) - consumed);
          const inventoryNow = db.prepare("SELECT quantity FROM inventory_items WHERE id=?").get(oldInventory.id);
          if (!inventoryNow || numeric(inventoryNow.quantity) < remaining) throw error("INVENTORY_QUANTITY_UNAVAILABLE");
          consumed = material.requested;
          db.prepare("UPDATE inventory_items SET quantity=MAX(0,quantity-?),status=CASE WHEN quantity-?<=0 THEN 'In Use' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(remaining, remaining, oldInventory.id);
        }
        if (material.inventoryId && material.inventoryId !== oldInventory?.id && nextStatus === "RESERVED") db.prepare("UPDATE inventory_items SET reserved_quantity=COALESCE(reserved_quantity,0)+?,status='Reserved',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(material.requested, material.inventoryId);
        db.prepare(`UPDATE workflow_materials SET stage_id=?,source_type=?,inventory_item_id=?,item_name=?,requested_quantity=?,consumed_quantity=?,unit=?,unit_cost=?,status=?,notes=?,document_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(material.stageId, material.source, material.inventoryId, material.itemName, material.requested, consumed, material.unit, material.unitCost, nextStatus, material.notes, material.documentPath || null, existing.id);
      })();
      directAudit(req, "WORKFLOW_MATERIAL_UPDATED", existing.id, existing, db.prepare("SELECT * FROM workflow_materials WHERE id=?").get(existing.id), "Workflow material updated");
      res.json(materialRows(workflow.id).find((row) => row.id === existing.id));
    } catch (e) { res.status(e.code === "WORKFLOW_MATERIAL_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.delete("/api/workflows/:id/materials/:materialId", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), material = db.prepare("SELECT * FROM workflow_materials WHERE id=? AND workflow_id=?").get(req.params.materialId, workflow.id);
      if (!material) throw error("WORKFLOW_MATERIAL_NOT_FOUND");
      if (material.inventory_item_id && material.status !== "CONSUMED") db.prepare("UPDATE inventory_items SET reserved_quantity=MAX(0,COALESCE(reserved_quantity,0)-?),status=CASE WHEN COALESCE(reserved_quantity,0)-?<=0 THEN 'In Stock' ELSE 'Reserved' END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Math.max(0, numeric(material.requested_quantity) - numeric(material.consumed_quantity)), Math.max(0, numeric(material.requested_quantity) - numeric(material.consumed_quantity)), material.inventory_item_id);
      db.prepare("DELETE FROM workflow_materials WHERE id=?").run(material.id);
      directAudit(req, "WORKFLOW_MATERIAL_DELETED", material.id, material, null, "Workflow material deleted");
      res.json({ ok: true });
    } catch (e) { res.status(e.code === "WORKFLOW_MATERIAL_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.get("/api/workflows/:id/financial-lines", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try { const workflow = requireWorkflow(req.params.id); res.json({ lines: financialRows(workflow.id), summary: signedFinanceSummary(financialRows(workflow.id)) }); } catch (e) { res.status(404).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/financial-lines", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id); if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const body = req.body || {}, lineType = clean(body.line_type, 20).toUpperCase(), category = clean(body.category, 30).toUpperCase();
      if (!FINANCE_TYPES.has(lineType) || !FINANCE_CATEGORIES.has(category)) throw error("INVALID_WORKFLOW_FINANCIAL_LINE");
      const title = clean(body.title, 240), amount = Math.max(0, numeric(body.amount));
      if (!title) throw error("FINANCIAL_LINE_TITLE_REQUIRED");
      const stage = body.stage_id ? requireStage(validId(body.stage_id), workflow.id) : null;
      const billingStatus = String(body.billing_status || "CHARGEABLE").toUpperCase();
      const status = ["CHARGEABLE", "WARRANTY", "FREE", "COMPENSATION", "CREDIT"].includes(billingStatus) ? billingStatus : "CHARGEABLE";
      const id = rid("WFL");
      db.prepare(`INSERT INTO workflow_financial_lines(id,workflow_id,stage_id,line_type,category,title,description,amount,billing_status,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, workflow.id, stage?.id || null, lineType, category, title, clean(body.description), amount, status, req.user.id);
      directAudit(req, "WORKFLOW_FINANCIAL_LINE_ADDED", id, null, { workflow_id: workflow.id, line_type: lineType, category, amount }, "Workflow financial line added");
      res.status(201).json({ line: financialRows(workflow.id).find((row) => row.id === id), summary: signedFinanceSummary(financialRows(workflow.id)) });
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/finalize", auth, permit("ADMIN"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id);
      if (workflow.financial_status === "CLOSED") throw error("WORKFLOW_ALREADY_FINANCIALLY_CLOSED");
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const stages = stageRows(workflow.id);
      if (stages.some((stage) => !["COMPLETED", "NOT_REQUIRED"].includes(stage.status))) throw error("WORKFLOW_STAGES_NOT_COMPLETE");
      const lines = financialRows(workflow.id), summary = signedFinanceSummary(lines), closureReason = clean(req.body?.closure_reason, 2000);
      if (summary.net_total === 0 && !closureReason) throw error("ZERO_WORKFLOW_CLOSE_REASON_REQUIRED");
      const closedAt = nowISO(), closedId = rid("WCJ");
      db.transaction(() => {
        lines.filter((line) => !line.posted_financial_item_id).forEach((line) => {
          const financialId = rid("FI");
          const amount = Math.max(0, numeric(line.amount));
          db.prepare(`INSERT INTO financial_items(id,item_date,title,description,amount,main_type,category,recurrence,job_id,client_id,piano_id,source_type,source_id,created_by)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(financialId, closedAt.slice(0, 10), line.title, line.description || "", amount, line.line_type === "REVENUE" ? "INCOME" : "EXPENSE", line.category, "ONE_TIME", null, workflow.client_id, workflow.piano_id, "workflow", line.id, req.user.name);
          db.prepare("UPDATE workflow_financial_lines SET posted_financial_item_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(financialId, line.id);
        });
        db.prepare(`INSERT INTO workflow_closed_jobs(id,workflow_id,client_id,piano_id,final_due_at,closed_at,closed_by_user_id,closure_reason,revenue_total,cost_total,net_total,snapshot_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(closedId, workflow.id, workflow.client_id, workflow.piano_id, workflow.final_due_at, closedAt, req.user.id, closureReason || null, summary.revenue_total, summary.cost_total, summary.net_total, JSON.stringify({ workflow: workflow, stages, lines, materials: materialRows(workflow.id) }));
        db.prepare("UPDATE workshop_workflows SET current_status='COMPLETED',financial_status='CLOSED',financial_closed_at=?,financial_closed_by_user_id=?,financial_closure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(closedAt, req.user.id, closureReason || null, workflow.id);
        directAudit(req, "WORKFLOW_FINANCIAL_CLOSED", workflow.id, workflow, { status: "COMPLETED", financial_status: "CLOSED", summary }, "Workflow financially finalized");
      })();
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/secondary-delete", auth, permit("ADMIN"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), reason = clean(req.body?.reason, 2000);
      if (!reason) throw error("WORKFLOW_DELETE_REASON_REQUIRED");
      if (workflow.financial_status === "CLOSED") throw error("FINANCIALLY_CLOSED_WORKFLOW_REQUIRES_SUPERADMIN");
      const now = nowISO();
      db.transaction(() => {
        const materials = materialRows(workflow.id);
        materials.filter((item) => item.inventory_item_id && item.status !== "CONSUMED").forEach((item) => db.prepare("UPDATE inventory_items SET reserved_quantity=MAX(0,COALESCE(reserved_quantity,0)-?),status=CASE WHEN COALESCE(reserved_quantity,0)-?<=0 THEN 'In Stock' ELSE 'Reserved' END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Math.max(0, numeric(item.requested_quantity) - numeric(item.consumed_quantity)), Math.max(0, numeric(item.requested_quantity) - numeric(item.consumed_quantity)), item.inventory_item_id));
        db.prepare("UPDATE workflow_stages SET status='ABORTED',block_reason=?,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=? AND status NOT IN ('COMPLETED','NOT_REQUIRED')").run(reason, workflow.id);
        db.prepare("UPDATE workshop_workflows SET current_status='ABORTED',aborted_at=?,aborted_by_user_id=?,abort_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(now, req.user.id, reason, workflow.id);
        db.prepare("INSERT INTO workflow_audit_events(id,workflow_id,action,reason,actor_user_id,snapshot_json) VALUES(?,?,?,?,?,?)").run(rid("WAE"), workflow.id, "SECONDARY_DELETE", reason, req.user.id, JSON.stringify({ workflow, materials }));
        directAudit(req, "WORKFLOW_SECONDARY_DELETE", workflow.id, workflow, { current_status: "ABORTED" }, reason);
      })();
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.delete("/api/workflows/:id", auth, requireSuperadmin, (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), reason = clean(req.body?.reason, 2000);
      if (!reason) throw error("WORKFLOW_DELETE_REASON_REQUIRED");
      const materials = materialRows(workflow.id), lines = financialRows(workflow.id), snapshot = decorateWorkflow(workflow, true);
      directAudit(req, "SUPERADMIN_WORKFLOW_DELETE", workflow.id, snapshot, null, reason, "WORK");
      db.transaction(() => {
        materials.filter((item) => item.inventory_item_id && item.status !== "CONSUMED").forEach((item) => db.prepare("UPDATE inventory_items SET reserved_quantity=MAX(0,COALESCE(reserved_quantity,0)-?),status=CASE WHEN COALESCE(reserved_quantity,0)-?<=0 THEN 'In Stock' ELSE 'Reserved' END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Math.max(0, numeric(item.requested_quantity) - numeric(item.consumed_quantity)), Math.max(0, numeric(item.requested_quantity) - numeric(item.consumed_quantity)), item.inventory_item_id));
        if (lines.length) db.prepare(`DELETE FROM financial_items WHERE source_type='workflow' AND source_id IN (${lines.map(() => "?").join(",")})`).run(...lines.map((line) => line.id));
        db.prepare("DELETE FROM knowledge_base WHERE workflow_id=?").run(workflow.id);
        db.prepare("DELETE FROM workshop_workflows WHERE id=?").run(workflow.id);
      })();
      res.json({ ok: true, deleted_workflow_id: workflow.id, audit_preserved: true });
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/documents", auth, permit("ADMIN", "MANAGER", "WORKER"), upload?.single("file"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id); if (!req.file) throw error("WORKFLOW_DOCUMENT_REQUIRED");
      const stage = req.body?.stage_id ? requireStage(validId(req.body.stage_id), workflow.id) : null;
      const id = rid("WFD");
      db.prepare("INSERT INTO workflow_documents(id,workflow_id,stage_id,document_path,document_name,document_type,created_by_user_id) VALUES(?,?,?,?,?,?,?)").run(id, workflow.id, stage?.id || null, `/uploads/${req.file.filename}`, req.file.originalname, req.file.mimetype, req.user.id);
      db.prepare("INSERT INTO knowledge_base(id,title,category,content_type,body,stored_path,owner,priority,workflow_id) VALUES(?,?,?,?,?,?,?,?,?)").run(rid("KB"), req.file.originalname, "Workshop Workflow", "Workflow Document", `Workflow ${workflow.workflow_key}`, `/uploads/${req.file.filename}`, req.user.name, "Medium", workflow.id);
      directAudit(req, "WORKFLOW_DOCUMENT_ADDED", id, null, { workflow_id: workflow.id, document_name: req.file.originalname }, "Workflow document added");
      res.status(201).json({ id, workflow_id: workflow.id, document_path: `/uploads/${req.file.filename}`, document_name: req.file.originalname, document_type: req.file.mimetype });
    } catch (e) { if (req.file && e.code) { try { require("fs").unlinkSync(req.file.path); } catch (_error) {} } res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.get("/api/workflows/:id/documents", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try { requireWorkflow(req.params.id); res.json(db.prepare("SELECT d.*,u.name AS created_by_name FROM workflow_documents d LEFT JOIN users u ON u.id=d.created_by_user_id WHERE d.workflow_id=? ORDER BY d.created_at DESC").all(req.params.id)); } catch (e) { res.status(404).json({ error: e.code || e.message }); }
  });
}

module.exports = { registerWorkshopWorkflowRoutes, DEFAULT_STAGES };
