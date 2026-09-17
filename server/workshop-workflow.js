const fs = require("fs");
const path = require("path");
const { SCHEDULE_INTERVAL_MINUTES, isScheduleTime, createJobDomain } = require("./job-domain");
const { PAYMENT_METHODS, normalizePaymentMethod } = require("./payment-methods");

const DEFAULT_STAGES = [
  ["INBOUND", "Arrival & Intake Logistics", "Beérkezés és Állapotrögzítés"],
  ["ASSESSMENT", "Technical Assessment & Repair Plan", "Részletes Műszaki Állapotfelmérés"],
  ["ACOUSTICS", "Belly & Acoustic Restoration", "Akusztikus Szerkezet és Hangszekrény"],
  ["MECHANICS", "Action & Keyboard Restoration", "Mechanika és Billentyűzet Felújítás"],
  ["VOICING", "Regulation, Voicing & Tuning", "Szabályozás, Intonálás és Hangolás"],
  ["FINISH", "Cabinet & Finish Refinishing", "Külső Bútorzat és Felületkezelés"],
  ["FINAL_HANDOVER", "Final Quality Control & Delivery", "Végső Minőségellenőrzés és Kiszállítás"]
];

const STANDARD_SUBTASKS = Object.freeze({
  INBOUND: [
    "Lábak, líra és fedél szakszerű leszerelése és csomagolása",
    "Beérkezési 360°-os fotódokumentáció és sérülésfelmérés",
    "Sorozatszám, öntvénykeret- és házkódok archiválása",
    "Szállítási biztosítás és raktári átvételi elismervény lezárása",
    "Műhelykocsira helyezés és akklimatizációs zónába mozgatás"
  ],
  ASSESSMENT: [
    "Alaphangolási magasság mérése (A440 eltérés centben)",
    "Hangtőke-feszesség mérése forgatónyomaték-kulccsal (Torque test in inch-pounds)",
    "Rezonánslap boltozat (Crown) és húrláb-dőlésszög (Bearing) optikai mérése",
    "Mechanika kopás- és geometriai diagnosztika (Renner / New York / Hamburg Steinway specifikációk)",
    "Műszaki helyreállítási jegyzőkönyv és alkatrész-rendelési lista véglegesítése"
  ],
  ACOUSTICS: [
    "Rezonánslap tisztítás, repedések ékezése (Shimming) és lakkfrissítés",
    "Öntvénykeret (Iron Plate) kiemelése, tisztítása, aranyozása és felirat-restaurálása",
    "Húrlábak felújítása, grafitozása és újrabillentése (Bridge recapping & notching)",
    "Hangtőke (Pinblock) csere vagy illesztés és új hangszögek (Tuning pins) beverése",
    "Húrozás: Mélyhúrok és sima acélhúrok felhelyezése, agraffok és nyomólécek beállítása"
  ],
  MECHANICS: [
    "Billentyűk tisztítása, fehérítés / új csontozás vagy akril borítás pótlása",
    "Billentyűk oldal- és első dörzsölésmentesítése (Bushing re-felting & easing)",
    "Billentyűsúlyozás kimérése (Touchweight analysis: Downweight / Upweight grammozás)",
    "Mechanikai tengelyezés (Center pin repinning) és kapszli-igazítás",
    "Kalapácsfejek, szárak és görgők szerelése és pontos pozicionálása a húrokhoz"
  ],
  VOICING: [
    "Mechanika alapszabályozás (Bedding, escapement, let-off, drop, repetition spring)",
    "Billentyűsüllyedés (Key dip) és félbillentés szintezése",
    "Nyújtó hangolások és feszültség-stabilizálás (Chip tuning & Pitch raise)",
    "Kalapácsfejek akusztikai szurkálása és profilozása (Radial & shoulder voicing)",
    "Koncertszintű temperált finomhangolás A440-re (Fine Concert Tuning)"
  ],
  FINISH: [
    "Furnérhibák és szerkezeti fa-sérülések javítása",
    "Kézi sellak politúrozás (French Polish) vagy fekete magasfényű poliészter polírozás",
    "Rézszerelvények (zsanérok, pedálzat, görgők, zárak) lecsiszolása és galvanizálása",
    "Pult-, fedél- és kottatartó filcek és bőrözések cseréje",
    "Zongorapad szerkezeti revíziója és kárpitozása"
  ],
  FINAL_HANDOVER: [
    "40 pontos műhelyvezetői és zongoraművészi audit (Master Technician sign-off)",
    "Pedálműködés (Sostenuto, Una Corda, Sustain) holtjáték- és zajmentességi tesztje",
    "Hangszer zsírtalanítása, antisztatikus portalanítás és védőtakaró felhelyezése",
    "Kiszállítási logisztikai koordináció és szállítási megbízás kiadása",
    "Helyszíni akklimatizációs beállítás és első garanciális hangolási időpont kitűzése"
  ]
});

const STATUS = new Set(["WAITING", "IN_PROGRESS", "COMPLETED", "BLOCKED", "NOT_REQUIRED", "ABORTED"]);
const SUBTASK_STATUS = new Set(["PENDING", "COMPLETED", "DELAYED"]);
const PRELIMINARY = new Set(["DONE", "NOT_DONE", "NOT_REQUIRED"]);


function hardDeleteWorkflowData({ db, workflowId, audit }) {
  const workflow = db.prepare("SELECT * FROM workshop_workflows WHERE id=?").get(workflowId);
  if (!workflow) return null;
  const stageCount = db.prepare("SELECT COUNT(*) AS count FROM workflow_stages WHERE workflow_id=?").get(workflowId).count;
  const tx = db.transaction(() => {
    db.prepare("UPDATE jobs SET workflow_id=NULL,workshop_workflow_id=CASE WHEN workshop_workflow_id=? THEN NULL ELSE workshop_workflow_id END,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=? OR workshop_workflow_id=?").run(workflowId,workflowId,workflowId);
    db.prepare("UPDATE knowledge_base SET workflow_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=?").run(workflowId);
    db.prepare("DELETE FROM workflow_stages WHERE workflow_id=?").run(workflowId);
    db.prepare("DELETE FROM workshop_workflows WHERE id=?").run(workflowId);
    if (typeof audit === "function") audit({ workflow, stageCount });
  });
  tx();
  return { workflow, stageCount };
}

function purgeAllWorkflowData({ db, audit }) {
  const workflowCount = db.prepare("SELECT COUNT(*) AS count FROM workshop_workflows").get().count;
  const stageCount = db.prepare("SELECT COUNT(*) AS count FROM workflow_stages").get().count;
  const tx = db.transaction(() => {
    db.prepare("UPDATE jobs SET workflow_id=NULL,workshop_workflow_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE workflow_id IS NOT NULL OR workshop_workflow_id IS NOT NULL").run();
    db.prepare("UPDATE knowledge_base SET workflow_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE workflow_id IS NOT NULL").run();
    db.prepare("DELETE FROM workflow_stages").run();
    db.prepare("DELETE FROM workshop_workflows").run();
    if (typeof audit === "function") audit({ workflowCount, stageCount });
  });
  tx();
  return { workflowCount, stageCount };
}

function registerWorkshopWorkflowRoutes({ app, db, auth, permit, requireSuperadmin, rid, nowISO, upload, inspectionUpload, uploadDir, notifyUser, jobDomain, invoiceEngine }) {
  const domain = jobDomain || createJobDomain({ db, rid });
  const isSuper = (user) => Boolean(user && (user.role === "SUPERADMIN" || Number(user.is_superadmin || 0) === 1));
  const isAdmin = (user) => isSuper(user) || user?.role === "ADMIN";
  const isManagerOrAbove = (user) => isAdmin(user) || user?.role === "MANAGER";
  const clean = (value, max = 10000) => String(value ?? "").trim().slice(0, max);
  const validId = (value) => clean(value, 160);
  const adminCardEnabled = (key) => {
    try { const raw=db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='admin_module_settings'").get()?.setting_value||"{}"; return JSON.parse(raw)?.[key] !== false; }
    catch (_error) { return true; }
  };
  const removeInspectionHistoryFile = (publicPath) => {
    if (!uploadDir || !String(publicPath||"").startsWith("/uploads/")) return;
    try { fs.unlinkSync(path.join(uploadDir,String(publicPath).replace(/^\/uploads\//,""))); } catch (_error) {}
  };
  const localDateTime = (value) => {
    const text = clean(value, 40);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) ? text.slice(0, 16) : "";
  };
  const shiftLocalMinutes = (value, deltaMinutes) => {
    const text=localDateTime(value);if(!text)return "";
    const match=text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);if(!match)return "";
    const stamp=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]))+Number(deltaMinutes||0)*60000;
    const d=new Date(stamp),pad=n=>String(n).padStart(2,"0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };
  const numeric = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const roundMoney = (value) => Math.round((numeric(value) + Number.EPSILON) * 100) / 100;
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
    const upsert = db.prepare(`INSERT INTO workflow_stage_definitions
      (id,code,name_en,name_hu,sort_order,active,is_system) VALUES(?,?,?,?,?,1,1)
      ON CONFLICT(code) DO UPDATE SET name_en=excluded.name_en,name_hu=excluded.name_hu,sort_order=excluded.sort_order,active=1,is_system=1,updated_at=CURRENT_TIMESTAMP`);
    const updateSnapshots = db.prepare(`UPDATE workflow_stages SET name_snapshot_en=?,name_snapshot_hu=?,stage_order=?,updated_at=CURRENT_TIMESTAMP WHERE stage_code=?`);
    const tx = db.transaction(() => {
      DEFAULT_STAGES.forEach(([code, en, hu], index) => {
        upsert.run(`WSD-${code}`, code, en, hu, index);
        updateSnapshots.run(en, hu, index, code);
      });
      const official = DEFAULT_STAGES.map(([code]) => code);
      if (official.length) db.prepare(`UPDATE workflow_stage_definitions SET active=0,updated_at=CURRENT_TIMESTAMP WHERE code NOT IN (${official.map(()=>"?").join(",")})`).run(...official);
    });
    tx();
  }
  seedDefinitions();

  function definitions(includeInactive = true) {
    const rows = db.prepare(`SELECT * FROM workflow_stage_definitions ${includeInactive ? "" : "WHERE active=1"} ORDER BY sort_order,id`).all();
    return rows;
  }

  function subtaskRows(stageId) {
    return db.prepare(`SELECT st.*,u.name AS assigned_to_name,u.role AS assigned_to_role
      FROM workshop_subtasks st LEFT JOIN users u ON u.id=st.assigned_to_id
      WHERE st.stage_id=? ORDER BY st.position,st.created_at,st.id`).all(stageId);
  }

  function stageRows(workflowId) {
    const rows = db.prepare(`SELECT s.*,u.name AS assigned_user_name,w.title AS workflow_title
      FROM workflow_stages s LEFT JOIN users u ON u.id=s.assigned_user_id
      LEFT JOIN workshop_workflows w ON w.id=s.workflow_id
      WHERE s.workflow_id=? ORDER BY s.stage_order,s.id`).all(workflowId);
    const now = localDateTimeFromISO(nowISO());
    return rows.map((stage) => {
      const subtasks = subtaskRows(stage.id);
      const completedSubtasks = subtasks.filter((item) => item.status === "COMPLETED").length;
      const isOverdue = Boolean(stage.due_at && !["COMPLETED", "NOT_REQUIRED", "ABORTED"].includes(stage.status) && stage.due_at < now);
      const effectiveStatus = isOverdue ? "OVERDUE" : (stage.status === "WAITING" && stage.assigned_user_id ? "ASSIGNED" : stage.status);
      return { ...stage, card_title: stage.card_title || stage.workflow_title || null, assigned_to: stage.assigned_to || stage.assigned_user_name || null, is_overdue: isOverdue, effective_status: effectiveStatus, subtasks, subtask_progress: { completed: completedSubtasks, total: subtasks.length }, event_log: stageEventRows(stage.id) };
    });
  }

  function stageEventRows(stageId) {
    return db.prepare(`SELECT id,action,user_name,user_role,details,event_time AS created_at,old_value,new_value
      FROM audit_log WHERE module='workshop_workflow' AND record_id=? ORDER BY event_time DESC`).all(stageId);
  }

  function financialRows(workflowId) {
    return db.prepare(`SELECT f.*,s.name_snapshot_en,s.name_snapshot_hu,p.company_name AS partner_name,i.invoice_number AS payable_invoice_number,i.status AS payable_invoice_status
      FROM workflow_financial_lines f LEFT JOIN workflow_stages s ON s.id=f.stage_id
      LEFT JOIN partners p ON p.id=f.partner_id
      LEFT JOIN invoices i ON i.id=f.payable_invoice_id
      WHERE f.workflow_id=? ORDER BY f.created_at,f.id`).all(workflowId);
  }

  function signedFinanceSummary(lines) {
    const revenue = lines.filter((row) => row.line_type === "REVENUE").reduce((sum, row) => roundMoney(sum + numeric(row.amount)), 0);
    const costs = lines.filter((row) => row.line_type === "COST").reduce((sum, row) => roundMoney(sum + numeric(row.amount)), 0);
    return { revenue_total: revenue, cost_total: costs, net_total: roundMoney(revenue - costs) };
  }

  function decorateWorkflow(row, includeChildren = true) {
    if (!row) return null;
    const stages = includeChildren ? stageRows(row.id) : [];
    const lines = includeChildren ? financialRows(row.id) : [];
    const summary = signedFinanceSummary(lines);
    return {
      ...row,
      workflow_owner_id: row.created_by_user_id || null,
      workflow_owner_name: row.created_by_name || userById(row.created_by_user_id)?.name || null,
      stages,
      financial_lines: lines,
      finance_summary: summary,
      is_overdue: row.current_status === "ACTIVE" && row.final_due_at < localDateTimeFromISO(nowISO()),
      final_due_at_ny: row.final_due_at,
      intake_photos_list: (()=>{try{return JSON.parse(row.intake_photos||"[]");}catch(_error){return [];}})()
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
    if (date) { clauses.push("(substr(w.final_due_at,1,10)=? OR EXISTS (SELECT 1 FROM workflow_stages ds WHERE ds.workflow_id=w.id AND substr(ds.due_at,1,10)=?))"); values.push(date,date); }
    if (search) {
      clauses.push("lower(COALESCE(w.title,'')||' '||COALESCE(c.name,'')||' '||COALESCE(p.display_name,'')||' '||COALESCE(p.brand,'')||' '||COALESCE(p.model,'')||' '||COALESCE(p.serial_no,'')) LIKE ?");
      values.push(`%${search}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT w.*,c.name AS client_name,c.email AS client_email,
      p.display_name AS piano_display_name,p.brand,p.model,p.serial_no,p.finish,p.build_year,p.size_cm,p.size_in,p.size_display,p.location AS piano_location,
      cu.name AS created_by_name,
      tu.name AS transport_responsible_name_resolved,u.name AS financial_closed_by_name
      FROM workshop_workflows w JOIN contacts c ON c.id=w.client_id JOIN pianos p ON p.id=w.piano_id
      LEFT JOIN users cu ON cu.id=w.created_by_user_id
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

  function inspectionReady(workflow, type) {
    if (type === "INTAKE") return workflow?.intake_inspection_status && workflow.intake_inspection_status !== "PENDING" && Boolean(workflow.intake_pdf_path);
    return workflow?.dispatch_inspection_status === "APPROVED" && Boolean(workflow.dispatch_pdf_path);
  }

  function assertInspectionForStage(workflow, stage, nextStatus) {
    if (workflow.mode === "INBOUND" && stage.stage_code === "INBOUND" && ["IN_PROGRESS","COMPLETED"].includes(nextStatus) && !inspectionReady(workflow,"INTAKE")) throw error("INTAKE_INSPECTION_REQUIRED");
    if (stage.stage_code === "FINAL_HANDOVER" && nextStatus === "COMPLETED" && !inspectionReady(workflow,"DISPATCH")) throw error("DISPATCH_INSPECTION_REQUIRED");
  }

  function preparePianoInspectionFile({ workflow, file, inspectionType, inspectionStatus, inspectedBy, inspectedAt }) {
    if (!file || !uploadDir) return null;
    const targetDir=path.join(uploadDir,"piano-history",String(workflow.piano_id));
    fs.mkdirSync(targetDir,{recursive:true});
    const ext=path.extname(file.originalname||file.filename||"").toLowerCase()||".bin";
    const filename=`${inspectionType.toLowerCase()}-${Date.now()}-${rid("H").replace(/[^a-zA-Z0-9_-]/g,"")}${ext}`;
    const target=path.join(targetDir,filename);
    try{fs.copyFileSync(file.path,target);}catch(e){try{fs.unlinkSync(target);}catch(_error){}throw e;}
    const publicPath=`/uploads/piano-history/${workflow.piano_id}/${filename}`;
    return { id:rid("PIH"), piano_id:workflow.piano_id, workflow_id:workflow.id, inspection_type:inspectionType, inspection_status:inspectionStatus||null, file_path:publicPath, original_filename:file.originalname||filename, mime_type:file.mimetype||null, inspected_by:inspectedBy||null, inspected_at:inspectedAt, absolute_path:target };
  }

  function insertPreparedPianoInspectionFile(prepared) {
    if (!prepared) return null;
    db.prepare(`INSERT INTO piano_inspection_history(id,piano_id,workflow_id,inspection_type,inspection_status,file_path,original_filename,mime_type,inspected_by,inspected_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(prepared.id,prepared.piano_id,prepared.workflow_id,prepared.inspection_type,prepared.inspection_status,prepared.file_path,prepared.original_filename,prepared.mime_type,prepared.inspected_by,prepared.inspected_at);
    return prepared.file_path;
  }

  function cleanupPreparedInspectionFiles(preparedFiles=[]) {
    preparedFiles.filter(Boolean).forEach((prepared)=>{try{fs.unlinkSync(prepared.absolute_path);}catch(_error){}});
  }

  function createWorkflowForJob(job, actor, options={}) {
    if (!job?.client_id) throw error("WORKFLOW_JOB_CLIENT_REQUIRED");
    if (!job?.piano_id) throw error("WORKFLOW_JOB_PIANO_REQUIRED");
    const client=db.prepare("SELECT id,name FROM contacts WHERE id=?").get(job.client_id);
    const piano=db.prepare("SELECT id,brand,model,serial_no,finish FROM pianos WHERE id=?").get(job.piano_id);
    if(!client)throw error("CLIENT_NOT_FOUND");if(!piano)throw error("PIANO_NOT_FOUND");
    const assignee=userById(job.assigned_user_id)||{id:job.assigned_user_id||actor.id,name:job.assigned_to||actor.name};
    const finalDueAt=localDateTime(options.final_due_at||job.end_time);if(!finalDueAt)throw error("WORKFLOW_TITLE_AND_FINAL_DEADLINE_REQUIRED");
    const defs=definitions(false);if(!defs.length)throw error("WORKFLOW_ACTIVE_PHASE_REQUIRED");
    const id=rid("WF"),key=`WF-${new Date().getFullYear()}-${id.slice(-8)}`,title=clean(options.title||job.title||"Workshop workflow",240);
    db.prepare(`INSERT INTO workshop_workflows(id,workflow_key,client_id,piano_id,mode,job_id,title,description,notes,due_time,current_status,financial_status,final_due_at,timezone,current_location,transport_address,transport_responsible_user_id,transport_responsible_name,final_handover_type,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,key,client.id,piano.id,"INBOUND",job.id,title,clean(options.description||job.instructions||job.notes),clean(options.notes||job.notes),finalDueAt.slice(11,16),"ACTIVE","OPEN",finalDueAt,"America/New_York",clean(job.service_address,500),clean(job.service_address,500),assignee.id||null,assignee.name||null,"DELIVERY",actor.id);
    const insert=db.prepare(`INSERT INTO workflow_stages(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,card_title,status,assigned_user_id,assigned_to,due_at,details,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?)`);
    defs.forEach((definition,index)=>insert.run(rid("WFS"),id,definition.code,index,definition.name_en,definition.name_hu,title,"WAITING",index===0?assignee.id||null:null,index===0?assignee.name||null:null,definition.code==="FINAL_HANDOVER"?finalDueAt:null,"",clean(options.notes||job.notes)));
    db.prepare("UPDATE jobs SET workshop_workflow_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id,job.id);
    return workflowById(id);
  }

  function stageCanStart(workflow, stage) {
    if (stage.stage_order === 0) return true;
    const previousStages = db.prepare("SELECT status FROM workflow_stages WHERE workflow_id=? AND stage_order<? ORDER BY stage_order").all(workflow.id, stage.stage_order);
    return previousStages.every((previous) => ["COMPLETED", "NOT_REQUIRED", "ABORTED"].includes(previous.status));
  }

  function activeStageRows(workflowId) {
    return stageRows(workflowId).filter((stage) => stage.status !== "NOT_REQUIRED");
  }

  function nextStageFor(workflowId, stageOrder) {
    return stageRows(workflowId).find((stage) => stage.stage_order > stageOrder && stage.status !== "NOT_REQUIRED") || null;
  }

  function recordStageTransfer(workflow, stage, assignee, reason, actor) {
    if (!assignee || assignee.id === stage.assigned_user_id) return;
    if (!clean(reason, 2000)) throw error("WORKFLOW_TRANSFER_REASON_REQUIRED");
    db.prepare(`INSERT INTO workflow_stage_transfers(id,workflow_id,stage_id,from_user_id,to_user_id,reason,transferred_by_user_id)
      VALUES(?,?,?,?,?,?,?)`).run(rid("WFT"), workflow.id, stage.id, stage.assigned_user_id || null, assignee.id, clean(reason, 2000), actor.id);
  }

  function syncLinkedJobAssignee(workflow, stage) {
    if (!workflow?.job_id || !stage?.assigned_user_id) return;
    const assignee = userById(stage.assigned_user_id);
    if (!assignee) return;
    db.prepare("UPDATE jobs SET assigned_user_id=?,assigned_to=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(assignee.id, assignee.name, workflow.job_id);
  }

  function activateNextStage(workflow, completedStage, req) {
    const next = nextStageFor(workflow.id, completedStage.stage_order);
    if (!next || !stageCanStart(workflow, next)) return null;
    const inheritedAssigneeId = completedStage.assigned_user_id || null;
    return {
      mode: "CONFIRM",
      stage: next,
      current_assignee_id: next.assigned_user_id || inheritedAssigneeId,
      inherited_assignee_id: inheritedAssigneeId,
      source_stage_id: completedStage.id,
      assignment_mode: next.assigned_user_id ? "KEEP_EXISTING" : (inheritedAssigneeId ? "INHERIT_PREVIOUS" : "REQUIRES_ASSIGNMENT"),
      message: "The next workflow phase is ready for activation"
    };
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

  app.get("/api/workflow/stage-definitions", auth, permit("ADMIN", "MANAGER", "WORKER"), (_req, res) => {
    res.json({ stages: definitions(false), subtask_catalog: STANDARD_SUBTASKS });
  });

  app.put("/api/workflow/stage-definitions", auth, permit("ADMIN"), (req, res) => {
    try {
      const items = Array.isArray(req.body?.stages) ? req.body.stages : [req.body || {}];
      const byCode = new Map(items.map((item) => [clean(item.code, 80).toUpperCase(), item]));
      const officialCodes = new Set(DEFAULT_STAGES.map(([code]) => code));
      if ([...byCode.keys()].some((code) => !officialCodes.has(code))) throw error("WORKFLOW_ONLY_OFFICIAL_STAGES_ALLOWED");
      const update = db.prepare(`UPDATE workflow_stage_definitions SET name_en=?,name_hu=?,sort_order=?,active=1,is_system=1,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE code=?`);
      db.transaction(() => DEFAULT_STAGES.forEach(([code, nameEn, nameHu], index) => {
        update.run(nameEn, nameHu, index, req.user.id, code);
        db.prepare("UPDATE workflow_stages SET name_snapshot_en=?,name_snapshot_hu=?,stage_order=?,updated_at=CURRENT_TIMESTAMP WHERE stage_code=?").run(nameEn, nameHu, index, code);
      }))();
      directAudit(req, "WORKFLOW_STAGE_DEFINITIONS_UPDATED", "WORKFLOW-CONFIG", null, DEFAULT_STAGES, "Official seven-stage workflow definition reaffirmed");
      res.json({ stages: definitions(false), subtask_catalog: STANDARD_SUBTASKS });
    } catch (e) { res.status(400).json({ error: e.code || e.message }); }
  });

  app.get("/api/workflows", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try { res.json({ workflows: workflowList(req.query || {}) }); } catch (e) { res.status(400).json({ error: e.code || e.message }); }
  });

  app.get("/api/workflows/calendar-deadlines", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    const from = clean(req.query.from, 10), to = clean(req.query.to, 10);
    const rows = db.prepare(`SELECT s.id AS stage_id,s.workflow_id,s.card_title,s.name_snapshot_en,s.name_snapshot_hu,s.status,s.assigned_user_id,s.assigned_to,s.due_at,
      w.workflow_key,w.title AS workflow_title,w.current_status,c.name AS client_name,p.display_name AS piano_name,p.brand,p.model,p.serial_no,p.build_year,p.size_cm,p.size_in,p.size_display,u.calendar_color AS assigned_calendar_color
      FROM workflow_stages s JOIN workshop_workflows w ON w.id=s.workflow_id
      JOIN contacts c ON c.id=w.client_id JOIN pianos p ON p.id=w.piano_id LEFT JOIN users u ON u.id=s.assigned_user_id
      WHERE s.due_at IS NOT NULL AND trim(s.due_at)<>'' AND s.assigned_user_id IS NOT NULL AND trim(s.assigned_user_id)<>''
        AND s.due_at>=? AND s.due_at<? AND s.status NOT IN ('NOT_REQUIRED','ABORTED') ORDER BY s.due_at`).all(`${from || "0000-01-01"}T00:00`, `${to || "9999-12-31"}T00:00`);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year:"numeric",month:"2-digit",day:"2-digit" }).format(new Date());
    res.json(rows.map((row) => {
      const closed = row.status === "COMPLETED" || row.current_status === "COMPLETED";
      const overdue = !closed && String(row.due_at).slice(0,10) < today;
      return { ...row, id: row.stage_id, title: row.card_title || row.name_snapshot_en || row.workflow_title, calendar_entry_type: "WORKFLOW_TASK", start_time: row.due_at, end_time: row.due_at, status: closed ? "Completed" : (overdue ? "Overdue" : "Open"), workflow_color_state: closed ? "CLOSED" : (overdue ? "OVERDUE" : "IN_PROGRESS"), billed_amount:0,planned_amount:0,service_address:"" };
    }));
  });

  app.get("/api/workflows/previous", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    res.json({ workflows: workflowList({ ...req.query, status: "COMPLETED", include_closed: "1" }) });
  });

  app.get("/api/workflows-partners/options", auth, permit("ADMIN", "MANAGER"), (_req, res) => {
    res.json(db.prepare("SELECT id,company_name,default_tax_rate FROM partners WHERE status='active' ORDER BY lower(company_name),id").all());
  });

  app.get("/api/workflows/:id", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try { res.json(decorateWorkflow(requireWorkflow(req.params.id), true)); } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows", auth, permit("ADMIN", "MANAGER", "WORKER"), inspectionUpload?.fields([{name:"intake_pdf",maxCount:1},{name:"intake_photos",maxCount:10}]), (req, res) => {
    const uploaded=[...(req.files?.intake_pdf||[]),...(req.files?.intake_photos||[])],persistedHistoryPaths=[];
    try {
      const body = req.body || {};
      const clientId = validId(body.client_id), pianoId = validId(body.piano_id);
      const client = db.prepare("SELECT id,name FROM contacts WHERE id=?").get(clientId);
      const piano = db.prepare("SELECT id,display_name,brand,model,serial_no FROM pianos WHERE id=?").get(pianoId);
      if (!client) throw error("CLIENT_NOT_FOUND");
      if (!piano) throw error("PIANO_NOT_FOUND");
      const mode = clean(body.mode, 20).toUpperCase() || "INBOUND";
      if (!["INBOUND", "ON_SITE"].includes(mode)) throw error("INVALID_WORKFLOW_MODE");
      const intakePdf=req.files?.intake_pdf?.[0],intakePhotos=req.files?.intake_photos||[],intakeConfirmed=["1","true","on","yes"].includes(clean(body.intake_confirmed,10).toLowerCase()),intakeStatus=clean(body.intake_status,40).toUpperCase()||"FLAWLESS";
      if(mode==="INBOUND"){
        if(!intakeConfirmed||!intakePdf)throw error("INTAKE_PDF_REQUIRED");
        if(String(intakePdf.mimetype||"").toLowerCase()!=="application/pdf"||path.extname(intakePdf.originalname||"").toLowerCase()!==".pdf")throw error("INTAKE_PDF_REQUIRED");
        if(!["FLAWLESS","PRE_EXISTING_DAMAGE"].includes(intakeStatus))throw error("INVALID_INTAKE_INSPECTION_STATUS");
        const allowedPhotoExt=new Set([".jpg",".jpeg",".png",".webp"]),allowedPhotoMime=new Set(["image/jpeg","image/jpg","image/png","image/webp"]);
        if(intakePhotos.some(file=>!allowedPhotoExt.has(path.extname(file.originalname||"").toLowerCase())||!allowedPhotoMime.has(String(file.mimetype||"").toLowerCase())))throw error("INVALID_INTAKE_PHOTO");
      }
      const plannedJobId = validId(body.planned_job_id),plannedJob=plannedJobId?db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(plannedJobId):null;
      if(plannedJobId&&!adminCardEnabled("planned_jobs"))throw error("PLANNED_JOBS_DISABLED");
      if(plannedJobId&&!plannedJob)throw error("PLANNED_JOB_NOT_FOUND");
      if(plannedJob){
        const status=clean(plannedJob.status,80).toLowerCase();
        if(["converted","archived","cancelled","canceled","completed","closed"].some(token=>status.includes(token)))throw error("PLANNED_JOB_NOT_OPEN");
        if(plannedJob.client_id&&String(plannedJob.client_id)!==String(clientId))throw error("PLANNED_JOB_CLIENT_MISMATCH");
        if(plannedJob.piano_id&&String(plannedJob.piano_id)!==String(pianoId))throw error("PLANNED_JOB_PIANO_MISMATCH");
        if(!plannedJob.client_id&&!plannedJob.piano_id)throw error("PLANNED_JOB_NOT_LINKED_TO_CLIENT_OR_PIANO");
      }
      const title = clean(body.title || `${piano.display_name || `${piano.brand || ""} ${piano.model || ""}`.trim()} · workshop`, 240);
      const finalDueAt = localDateTime(body.final_due_at);
      if (!title || !finalDueAt) throw error("WORKFLOW_TITLE_AND_FINAL_DEADLINE_REQUIRED");
      if (!isScheduleTime(finalDueAt)) throw error("INVALID_TIME_STEP");
      const requestedCalendarStart = body.calendar_start_time ? localDateTime(body.calendar_start_time) : "";
      const requestedCalendarEnd = body.calendar_end_time ? localDateTime(body.calendar_end_time) : "";
      if ((requestedCalendarStart && !isScheduleTime(requestedCalendarStart)) || (requestedCalendarEnd && !isScheduleTime(requestedCalendarEnd))) throw error("INVALID_TIME_STEP");
      if ((requestedCalendarStart || requestedCalendarEnd) && (!requestedCalendarStart || !requestedCalendarEnd || requestedCalendarEnd <= requestedCalendarStart)) throw error("INVALID_TIME_RANGE");
      const prelim = validatePreliminary(body);
      const stageDefinitions = definitions(false).sort((a, b) => a.sort_order - b.sort_order || String(a.id).localeCompare(String(b.id)));
      const explicitStageSelection = Object.keys(body).some((key) => key.startsWith("stage_enabled_"));
      const selectedDefinitions = stageDefinitions.filter((definition) => {
        if (!explicitStageSelection) return mode === "ON_SITE" ? definition.code !== "INBOUND" : true;
        return ["1", "true", "on", "yes"].includes(String(body[`stage_enabled_${definition.code}`] || "").toLowerCase());
      });
      if (!selectedDefinitions.length) throw error("WORKFLOW_ACTIVE_PHASE_REQUIRED");
      const firstDefinition = selectedDefinitions[0];
      const firstAssigneeId = validId(body.first_stage_assignee_id || body[`stage_assignee_${firstDefinition.code}`] || (firstDefinition.code === "INBOUND" ? body.transport_responsible_user_id : ""));
      const firstAssignee = userById(firstAssigneeId);
      if (!firstAssignee) throw error("WORKFLOW_FIRST_PHASE_RESPONSIBLE_REQUIRED");
      const stageAssignees = new Map();
      selectedDefinitions.forEach((definition) => {
        const requestedId = validId(body[`stage_assignee_${definition.code}`] || (definition.code === firstDefinition.code ? firstAssigneeId : ""));
        if (!requestedId) return;
        const assignee = userById(requestedId);
        if (!assignee) throw error("WORKFLOW_RESPONSIBLE_NOT_FOUND");
        stageAssignees.set(definition.code, assignee);
      });
      const transportAssignee = stageAssignees.get("INBOUND") || userById(validId(body.transport_responsible_user_id));
      if (body.transport_responsible_user_id && !transportAssignee) throw error("WORKFLOW_RESPONSIBLE_NOT_FOUND");
      const id = rid("WF");
      const key = `WF-${new Date().getFullYear()}-${id.slice(-8)}`;
      const preparedInspectionFiles=[];
      let preparedIntakePdf=null,preparedIntakePhotos=[],inspectionMeta=null;
      if(mode==="INBOUND"){
        inspectionMeta={inspectedAt:nowISO(),inspectedBy:req.user?.name||req.user?.id||"",workflow:{id,piano_id:pianoId}};
        preparedIntakePdf=preparePianoInspectionFile({workflow:inspectionMeta.workflow,file:intakePdf,inspectionType:"INTAKE",inspectionStatus:intakeStatus,inspectedBy:inspectionMeta.inspectedBy,inspectedAt:inspectionMeta.inspectedAt});
        if(preparedIntakePdf){preparedInspectionFiles.push(preparedIntakePdf);persistedHistoryPaths.push(preparedIntakePdf.file_path);}
        for(const file of intakePhotos){
          const preparedPhoto=preparePianoInspectionFile({workflow:inspectionMeta.workflow,file,inspectionType:"DAMAGE_PHOTO",inspectionStatus:intakeStatus,inspectedBy:inspectionMeta.inspectedBy,inspectedAt:inspectionMeta.inspectedAt});
          if(preparedPhoto){preparedIntakePhotos.push(preparedPhoto);preparedInspectionFiles.push(preparedPhoto);persistedHistoryPaths.push(preparedPhoto.file_path);}
        }
      }
      const transaction = db.transaction(() => {
        const linkedJobId = rid("J");
        const linkedStart = requestedCalendarStart || shiftLocalMinutes(finalDueAt,-SCHEDULE_INTERVAL_MINUTES);
        const linkedEnd = requestedCalendarEnd || finalDueAt;
        const pianoName = piano.display_name || `${piano.brand || ""} ${piano.model || ""}`.trim() || piano.serial_no || piano.id;
        db.prepare(`INSERT INTO jobs(id,job_key,workflow_root_id,workflow_step_no,workflow_status,workflow_id,workshop_workflow_id,title,job_type,client_id,client_name,piano_id,piano_name,assigned_user_id,assigned_to,created_by_user_id,created_by,priority,status,start_time,end_time,timezone,planned_amount,planned_hours,planned_minutes,travel_minutes,service_address,instructions,notes)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          linkedJobId,`WFJOB-${key}`,linkedJobId,1,"ACTIVE",id,id,title,"Workflow",client.id,client.name,piano.id,pianoName,firstAssignee.id,firstAssignee.name,req.user.id,req.user.name,"Medium","Open",linkedStart,linkedEnd,"America/New_York",0,SCHEDULE_INTERVAL_MINUTES/60,SCHEDULE_INTERVAL_MINUTES,0,clean(body.transport_address,500),clean(body.description),clean(body.description)
        );
        db.prepare(`INSERT INTO workshop_workflows(id,workflow_key,client_id,piano_id,mode,planned_job_id,job_id,title,description,notes,due_time,current_status,financial_status,final_due_at,timezone,current_location,transport_address,transport_responsible_user_id,transport_responsible_name,transport_note,final_handover_type,created_by_user_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, key, clientId, pianoId, mode, plannedJobId || null, linkedJobId, title, clean(body.description), null, finalDueAt.slice(11,16), "ACTIVE", "OPEN", finalDueAt, "America/New_York", null, clean(body.transport_address, 500), transportAssignee?.id || null, transportAssignee?.name || null, clean(body.transport_note, 3000), mode === "ON_SITE" ? "ON_SITE" : "DELIVERY", req.user.id
        );
        if (plannedJobId) db.prepare("UPDATE planned_jobs SET workflow_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id, plannedJobId);
        const insertStage = db.prepare(`INSERT INTO workflow_stages(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,card_title,status,assigned_user_id,assigned_to,due_at,details,notes,preliminary_inspection,preliminary_assessment,preliminary_quote,preliminary_meeting,preliminary_quote_amount)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        stageDefinitions.forEach((definition, index) => {
          const relevant = selectedDefinitions.some((selected) => selected.code === definition.code);
          const assignedStage = relevant ? stageAssignees.get(definition.code) : null;
          const stageStatus = relevant ? "WAITING" : "NOT_REQUIRED";
          const due = relevant && definition.code === "FINAL_HANDOVER" ? finalDueAt : (relevant ? localDateTime(body[`stage_due_${definition.code}`]) : "");
          const cardTitle = relevant ? clean(body[`stage_card_title_${definition.code}`] || body[`stage_title_${definition.code}`] || title, 240) : null;
          const stageId=rid("WFS"),shortDescription=relevant?clean(body[`stage_details_${definition.code}`],2000):"";
          insertStage.run(stageId, id, definition.code, index, definition.name_en, definition.name_hu, cardTitle, stageStatus, assignedStage?.id || null, assignedStage?.name || null, due || null, shortDescription, "", definition.code === "INBOUND" && mode === "INBOUND" && relevant ? prelim.preliminary_inspection : null, definition.code === "INBOUND" && mode === "INBOUND" && relevant ? prelim.preliminary_assessment : null, definition.code === "INBOUND" && mode === "INBOUND" && relevant ? prelim.preliminary_quote : null, definition.code === "INBOUND" && mode === "INBOUND" && relevant ? prelim.preliminary_meeting : null, definition.code === "INBOUND" && relevant ? numeric(body.preliminary_quote_amount) : 0);
          directAudit(req,"WORKFLOW_STAGE_CREATED",stageId,null,{workflow_id:id,stage_code:definition.code,status:stageStatus,card_title:cardTitle,details:shortDescription,notes:"",assigned_to:assignedStage?.name||null,due_at:due||null},"Workflow phase created");
        });
        if(mode==="INBOUND"){
          const historyPdf=insertPreparedPianoInspectionFile(preparedIntakePdf);
          const photoPaths=preparedIntakePhotos.map(insertPreparedPianoInspectionFile).filter(Boolean);
          const workflowPdf=`/uploads/workflow-inspections/${path.basename(intakePdf.path)}`;
          db.prepare("UPDATE workshop_workflows SET intake_inspection_status=?,intake_pdf_path=?,intake_photos=?,intake_inspected_by=?,intake_inspected_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(intakeStatus,workflowPdf,JSON.stringify(photoPaths),inspectionMeta.inspectedBy,inspectionMeta.inspectedAt,id);
          directAudit(req,"WORKFLOW_INTAKE_INSPECTION",id,null,{status:intakeStatus,pdf:workflowPdf,history_pdf:historyPdf,photos:photoPaths},"Arrival inspection recorded during workflow creation");
        }
        directAudit(req, "WORKFLOW_CREATED", id, null, { workflow_key: key, client_id: clientId, piano_id: pianoId, mode, main_responsible_user_id: req.user.id, first_stage_id: firstDefinition.code, active_stage_codes: selectedDefinitions.map((definition) => definition.code) }, "Workshop workflow created");
      });
      transaction();
      if(mode!=="INBOUND")uploaded.forEach(file=>{try{fs.unlinkSync(file.path);}catch(_error){}});
      res.status(201).json(decorateWorkflow(workflowById(id), true));
    } catch (e) {
      uploaded.forEach(file=>{try{fs.unlinkSync(file.path);}catch(_error){}});persistedHistoryPaths.forEach(removeInspectionHistoryFile);
      res.status(e.code === "CLIENT_NOT_FOUND" || e.code === "PIANO_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message });
    }
  });

  app.patch("/api/workflows/:id", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), body = req.body || {};
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const changes = [];
      const values = [];
      if (body.title !== undefined) { changes.push("title=?"); values.push(clean(body.title, 240)); }
      if (body.description !== undefined) { changes.push("description=?"); values.push(clean(body.description)); }
      if (body.notes !== undefined) { changes.push("notes=?"); values.push(clean(body.notes)); }
      if (body.final_handover_type !== undefined) { changes.push("final_handover_type=?"); values.push(body.final_handover_type === "ON_SITE" ? "ON_SITE" : "DELIVERY"); }
      if (body.final_due_at !== undefined) {
        throw error("FINAL_DEADLINE_IMMUTABLE");
      }
      if (!changes.length) return res.json(decorateWorkflow(workflow, true));
      values.push(workflow.id);
      db.transaction(() => {
        db.prepare(`UPDATE workshop_workflows SET ${changes.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...values);
        if (workflow.job_id && (body.title !== undefined || body.description !== undefined)) {
          const jobChanges = [], jobValues = [];
          if (body.title !== undefined) { jobChanges.push("title=?"); jobValues.push(clean(body.title, 240)); }
          if (body.description !== undefined) { jobChanges.push("instructions=?", "notes=?"); jobValues.push(clean(body.description), clean(body.description)); }
          jobValues.push(workflow.job_id);
          db.prepare(`UPDATE jobs SET ${jobChanges.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...jobValues);
        }
      })();
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
        assertInspectionForStage(workflow,stage,status);
        if (status === "IN_PROGRESS" && !validId(body.assigned_user_id || stage.assigned_user_id)) throw error("WORKFLOW_RESPONSIBLE_REQUIRED_TO_START");
        if (status === "COMPLETED" && stage.stage_order > 0 && !stageCanStart(workflow, stage)) throw error("WORKFLOW_STAGE_BLOCKED_BY_PREVIOUS_STAGE");
        if (status === "COMPLETED") {
          const pendingSubtasks = subtaskRows(stage.id).filter((item) => item.status !== "COMPLETED");
          if (pendingSubtasks.length) { const problem = error("WORKFLOW_SUBTASKS_INCOMPLETE"); problem.pendingSubtasks = pendingSubtasks.map(({id,title,status}) => ({id,title,status})); throw problem; }
        }
        if (stage.stage_order === 0 && workflow.mode === "INBOUND" && status === "COMPLETED" && [stage.preliminary_inspection, stage.preliminary_assessment, stage.preliminary_quote, stage.preliminary_meeting].some((value) => !value)) throw error("INBOUND_PRELIMINARY_FIELDS_REQUIRED");
        changes.push("status=?"); values.push(status);
        if (status === "IN_PROGRESS" && !stage.started_at) { changes.push("started_at=?"); values.push(nowISO()); }
        if (status === "COMPLETED") { changes.push("completed_at=?"); values.push(nowISO()); }
      }
      if (body.details !== undefined && clean(body.details) !== clean(stage.details)) throw error("WORKFLOW_SHORT_DESCRIPTION_IMMUTABLE");
      if (body.notes !== undefined) { changes.push("notes=?"); values.push(clean(body.notes)); }
      if (body.card_title !== undefined) { changes.push("card_title=?"); values.push(clean(body.card_title, 240)); }
      if (body.block_reason !== undefined) { changes.push("block_reason=?"); values.push(clean(body.block_reason, 2000)); }
      if (body.due_at !== undefined) {
        if (!isAdmin(req.user)) throw error("STAGE_DEADLINE_NOT_ALLOWED");
        const due = localDateTime(body.due_at); if (!due) throw error("INVALID_STAGE_DEADLINE");
        if (stage.stage_code === "FINAL_HANDOVER") throw error("FINAL_DEADLINE_IMMUTABLE");
        changes.push("due_at=?"); values.push(due);
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
      if (updatedStage.status === "IN_PROGRESS" || body.assigned_user_id !== undefined) syncLinkedJobAssignee(workflow, updatedStage);
      directAudit(req, "WORKFLOW_STAGE_UPDATED", stage.id, stage, updatedStage, "Workshop stage updated");
      notifyAssigned(updatedStage, workflow, req.user);
      const response = decorateWorkflow(workflowById(workflow.id), true);
      if (body.status && clean(body.status, 30).toUpperCase() === "COMPLETED") response.next_stage_activation = activateNextStage(workflow, updatedStage, req);
      res.json(response);
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message, ...(e.pendingSubtasks ? { pending_subtasks: e.pendingSubtasks } : {}) }); }
  });

  app.post("/api/workflows/:id/stages/:stageId/subtasks", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), stage = requireStage(req.params.stageId, workflow.id), body = req.body || {};
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const title = clean(body.title, 500), isCustom = body.is_custom === true || ["1","true","yes","on"].includes(clean(body.is_custom, 10).toLowerCase());
      if (!title) throw error("WORKFLOW_SUBTASK_TITLE_REQUIRED");
      if (!isCustom && !(STANDARD_SUBTASKS[stage.stage_code] || []).includes(title)) throw error("WORKFLOW_SUBTASK_NOT_IN_CATALOG");
      const requestedAssignee = validId(body.assigned_to_id || stage.assigned_user_id), assignee = requestedAssignee ? userById(requestedAssignee) : null;
      if (requestedAssignee && !assignee) throw error("WORKFLOW_ASSIGNEE_NOT_FOUND");
      const position = Number(db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS next_position FROM workshop_subtasks WHERE stage_id=?").get(stage.id)?.next_position || 0);
      const id = rid("WST");
      db.prepare(`INSERT INTO workshop_subtasks(id,stage_id,workflow_id,title,is_custom,status,assigned_to_id,position) VALUES(?,?,?,?,?,'PENDING',?,?)`).run(id, stage.id, workflow.id, title, isCustom ? 1 : 0, assignee?.id || null, position);
      directAudit(req, "WORKFLOW_SUBTASK_CREATED", id, null, { stage_id: stage.id, title, is_custom: isCustom ? 1 : 0, assigned_to_id: assignee?.id || null }, "Workflow subtask created");
      res.status(201).json({ subtask: subtaskRows(stage.id).find((item) => item.id === id), workflow: decorateWorkflow(workflowById(workflow.id), true) });
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.patch("/api/workflows/:id/stages/:stageId/subtasks/:subtaskId", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), stage = requireStage(req.params.stageId, workflow.id), body = req.body || {};
      const subtask = db.prepare("SELECT * FROM workshop_subtasks WHERE id=? AND stage_id=? AND workflow_id=?").get(validId(req.params.subtaskId), stage.id, workflow.id);
      if (!subtask) throw error("WORKFLOW_SUBTASK_NOT_FOUND");
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const changes = [], values = [];
      if (body.status !== undefined) {
        const status = clean(body.status, 30).toUpperCase();
        if (!SUBTASK_STATUS.has(status)) throw error("INVALID_WORKFLOW_SUBTASK_STATUS");
        const delayReason = clean(body.delay_reason, 2000);
        if (status === "DELAYED" && !delayReason && !subtask.delay_reason) throw error("WORKFLOW_SUBTASK_DELAY_REASON_REQUIRED");
        changes.push("status=?", "completed_at=?"); values.push(status, status === "COMPLETED" ? nowISO() : null);
        if (status === "DELAYED" || body.delay_reason !== undefined) { changes.push("delay_reason=?"); values.push(delayReason || null); }
      } else if (body.delay_reason !== undefined) { changes.push("delay_reason=?"); values.push(clean(body.delay_reason, 2000) || null); }
      if (body.assigned_to_id !== undefined) {
        const requested = validId(body.assigned_to_id || stage.assigned_user_id), assignee = requested ? userById(requested) : null;
        if (requested && !assignee) throw error("WORKFLOW_ASSIGNEE_NOT_FOUND");
        changes.push("assigned_to_id=?"); values.push(assignee?.id || null);
      }
      if (!changes.length) return res.json({ subtask: subtaskRows(stage.id).find((item) => item.id === subtask.id), workflow: decorateWorkflow(workflowById(workflow.id), true) });
      values.push(subtask.id);
      db.prepare(`UPDATE workshop_subtasks SET ${changes.join(",")} WHERE id=?`).run(...values);
      const updated = db.prepare("SELECT * FROM workshop_subtasks WHERE id=?").get(subtask.id);
      directAudit(req, "WORKFLOW_SUBTASK_UPDATED", subtask.id, subtask, updated, "Workflow subtask updated");
      res.json({ subtask: subtaskRows(stage.id).find((item) => item.id === subtask.id), workflow: decorateWorkflow(workflowById(workflow.id), true) });
    } catch (e) { res.status(["WORKFLOW_NOT_FOUND","WORKFLOW_STAGE_NOT_FOUND","WORKFLOW_SUBTASK_NOT_FOUND"].includes(e.code) ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/stages/:stageId/move", auth, permit("ADMIN"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), source = requireStage(req.params.stageId, workflow.id);
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const targetCode = clean(req.body?.target_stage_code, 80).toUpperCase();
      const activeDefinitions = definitions(false), targetDefinition = activeDefinitions.find((item) => item.code === targetCode), sourceDefinition = activeDefinitions.find((item) => item.code === source.stage_code);
      if (!targetDefinition || !sourceDefinition) throw error("WORKFLOW_TARGET_STAGE_NOT_FOUND");
      if (source.stage_code === targetCode) return res.json(decorateWorkflow(workflowById(workflow.id), true));
      const target = db.prepare("SELECT * FROM workflow_stages WHERE workflow_id=? AND stage_code=?").get(workflow.id, targetCode);
      if (target && target.status !== "NOT_REQUIRED") throw error("WORKFLOW_TARGET_STAGE_OCCUPIED");
      const before = { source, target };
      db.transaction(() => {
        if (target) {
          const temporaryCode = `__MOVE__${target.id}`;
          db.prepare(`UPDATE workflow_stages SET stage_code=?,stage_order=?,name_snapshot_en=?,name_snapshot_hu=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(temporaryCode, sourceDefinition.sort_order, sourceDefinition.name_en, sourceDefinition.name_hu, target.id);
          db.prepare(`UPDATE workflow_stages SET stage_code=?,stage_order=?,name_snapshot_en=?,name_snapshot_hu=?,due_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(targetDefinition.code, targetDefinition.sort_order, targetDefinition.name_en, targetDefinition.name_hu, targetCode === "FINAL_HANDOVER" ? workflow.final_due_at : source.due_at, source.id);
          db.prepare(`UPDATE workflow_stages SET stage_code=?,stage_order=?,name_snapshot_en=?,name_snapshot_hu=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(sourceDefinition.code, sourceDefinition.sort_order, sourceDefinition.name_en, sourceDefinition.name_hu, target.id);
        } else {
          db.prepare(`UPDATE workflow_stages SET stage_code=?,stage_order=?,name_snapshot_en=?,name_snapshot_hu=?,due_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(targetDefinition.code, targetDefinition.sort_order, targetDefinition.name_en, targetDefinition.name_hu, targetCode === "FINAL_HANDOVER" ? workflow.final_due_at : source.due_at, source.id);
        }
        db.prepare("UPDATE workshop_workflows SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(workflow.id);
      })();
      const moved = stageById(source.id), replacement = target ? stageById(target.id) : null;
      directAudit(req, "WORKFLOW_STAGE_MOVED", source.id, before, { moved, replacement }, `Workflow card moved horizontally from ${source.stage_code} to ${targetCode}`);
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/stages/:stageId/delete-card", auth, permit("ADMIN"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), stage = requireStage(req.params.stageId, workflow.id);
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const snapshot = { stage, subtasks: subtaskRows(stage.id) };
      db.transaction(() => {
        db.prepare("DELETE FROM workshop_subtasks WHERE stage_id=? AND workflow_id=?").run(stage.id, workflow.id);
        db.prepare(`UPDATE workflow_stages SET card_title=NULL,status='NOT_REQUIRED',assigned_user_id=NULL,assigned_to=NULL,due_at=NULL,details=NULL,notes=NULL,block_reason=NULL,delay_reason=NULL,started_at=NULL,completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workflow_id=?`).run(stage.id, workflow.id);
        db.prepare("UPDATE workshop_workflows SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(workflow.id);
      })();
      directAudit(req, "WORKFLOW_STAGE_CARD_DELETED", stage.id, snapshot, stageById(stage.id), "Workflow stage card cleared and its subtasks deleted");
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/stages/:stageId/activate", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), stage = requireStage(req.params.stageId, workflow.id), body = req.body || {};
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      if (!["NOT_REQUIRED", "WAITING"].includes(stage.status)) throw error("WORKFLOW_STAGE_ALREADY_ACTIVE");
      if (!stageCanStart(workflow, stage)) throw error("WORKFLOW_STAGE_BLOCKED_BY_PREVIOUS_STAGE");
      const startNow = body.start_now === true || String(body.start_now).toLowerCase() === "true";
      if(startNow) assertInspectionForStage(workflow,stage,"IN_PROGRESS");
      const assignmentMode = clean(body.assignment_mode, 40).toUpperCase() || "MANUAL";
      const assigneeId = validId(body.assigned_user_id || stage.assigned_user_id);
      const assignee = assigneeId ? userById(assigneeId) : null;
      if (assigneeId && !assignee) throw error("WORKFLOW_ASSIGNEE_NOT_FOUND");
      if (startNow && !assignee) throw error("WORKFLOW_RESPONSIBLE_REQUIRED_TO_START");
      let inheritedAssignee = null;
      if (assignmentMode === "INHERIT_PREVIOUS") {
        const sourceStage = requireStage(validId(body.source_stage_id), workflow.id);
        const expectedNext = nextStageFor(workflow.id, sourceStage.stage_order);
        if (sourceStage.status !== "COMPLETED" || !sourceStage.assigned_user_id || expectedNext?.id !== stage.id || assignee?.id !== sourceStage.assigned_user_id) throw error("WORKFLOW_AUTO_ASSIGNMENT_INVALID");
        inheritedAssignee = sourceStage.assigned_user_id;
        if (stage.assigned_user_id && stage.assigned_user_id !== inheritedAssignee) throw error("WORKFLOW_AUTO_ASSIGNMENT_CONFLICT");
      } else if (!["MANUAL", "KEEP_EXISTING"].includes(assignmentMode)) {
        throw error("WORKFLOW_ASSIGNMENT_MODE_INVALID");
      }
      if (body.due_at !== undefined && stage.stage_code === "FINAL_HANDOVER") throw error("FINAL_DEADLINE_IMMUTABLE");
      const due = body.due_at === undefined ? stage.due_at : localDateTime(body.due_at);
      if (body.due_at !== undefined && !due) throw error("INVALID_STAGE_DEADLINE");
      if (due && !isAdmin(req.user) && due !== stage.due_at) throw error("STAGE_DEADLINE_NOT_ALLOWED");
      if (assignee && assignee.id !== stage.assigned_user_id && stage.status !== "NOT_REQUIRED" && assignmentMode !== "INHERIT_PREVIOUS") recordStageTransfer(workflow, stage, assignee, body.reason, req.user);
      const nextStatus = startNow ? "IN_PROGRESS" : "WAITING";
      db.prepare(`UPDATE workflow_stages SET status=?,assigned_user_id=?,assigned_to=?,due_at=?,started_at=CASE WHEN ?='IN_PROGRESS' THEN COALESCE(started_at,?) ELSE started_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(nextStatus, assignee?.id || null, assignee?.name || null, due || null, nextStatus, nowISO(), stage.id);
      db.prepare("UPDATE workshop_workflows SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(workflow.id);
      const updated = stageById(stage.id);
      if (updated.status === "IN_PROGRESS") syncLinkedJobAssignee(workflow, updated);
      if (inheritedAssignee) directAudit(req, "WORKFLOW_STAGE_ASSIGNEE_INHERITED", stage.id, stage, updated, "Previous completed phase responsible was inherited automatically");
      directAudit(req, "WORKFLOW_STAGE_ACTIVATED", stage.id, stage, updated, startNow ? "Workflow stage activated and started" : "Workflow stage activated");
      notifyAssigned(updated, workflow, req.user);
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/stages/:stageId/abort", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), stage = requireStage(req.params.stageId, workflow.id), reason = clean(req.body?.reason, 2000);
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      if (["COMPLETED", "NOT_REQUIRED", "ABORTED"].includes(stage.status)) throw error("WORKFLOW_STAGE_NOT_ABORTABLE");
      if (!reason) throw error("WORKFLOW_STAGE_ABORT_REASON_REQUIRED");
      db.prepare("UPDATE workflow_stages SET status='ABORTED',block_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reason, stage.id);
      db.prepare("UPDATE workshop_workflows SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(workflow.id);
      const updated = stageById(stage.id);
      directAudit(req, "WORKFLOW_STAGE_ABORTED", stage.id, stage, updated, reason);
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
      if (updated.status === "IN_PROGRESS") syncLinkedJobAssignee(workflow, updated);
      directAudit(req, "WORKFLOW_STAGE_TRANSFERRED", stage.id, stage, updated, reason);
      notifyAssigned(updated, workflow, req.user);
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.get("/api/workflows/:id/financial-lines", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try { const workflow = requireWorkflow(req.params.id); res.json({ lines: financialRows(workflow.id), summary: signedFinanceSummary(financialRows(workflow.id)) }); } catch (e) { res.status(404).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/financial-lines", auth, permit("ADMIN", "MANAGER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id); if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const body = req.body || {}, lineType = "COST";
      const requestedCategory = String(body.category || "OTHER").toUpperCase();
      const category = ["LABOR","MATERIAL","TRANSPORT","PURCHASE","CONTRACTOR","OTHER"].includes(requestedCategory) ? requestedCategory : "OTHER";
      const title = clean(body.title || body.description, 240), amount = Math.max(0, numeric(body.amount ?? body.unit_price));
      if (!title) throw error("FINANCIAL_LINE_TITLE_REQUIRED");
      const stage = body.stage_id ? requireStage(validId(body.stage_id), workflow.id) : null;
      const billingStatus = String(body.billing_status || "CHARGEABLE").toUpperCase();
      const status = ["CHARGEABLE", "WARRANTY", "FREE", "COMPENSATION", "CREDIT"].includes(billingStatus) ? billingStatus : "CHARGEABLE";
      const partnerId = validId(body.partner_id), partner = partnerId ? db.prepare("SELECT * FROM partners WHERE id=? AND status='active'").get(partnerId) : null;
      if (partnerId && !partner) throw error("WORKFLOW_PARTNER_NOT_FOUND");
      if (category === "CONTRACTOR" && !partner) throw error("WORKFLOW_PARTNER_REQUIRED");
      if (partner && !(amount > 0)) throw error("WORKFLOW_PARTNER_COST_REQUIRED");
      const id = rid("WFL");
      db.transaction(() => {
        db.prepare(`INSERT INTO workflow_financial_lines(id,workflow_id,stage_id,line_type,category,title,description,amount,billing_status,partner_id,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, workflow.id, stage?.id || null, lineType, category, title, clean(body.description), amount, status, partner?.id || null, req.user.id);
        if (partner && invoiceEngine?.createWorkflowPayableInvoice) {
          const line = db.prepare("SELECT * FROM workflow_financial_lines WHERE id=?").get(id);
          const payable = invoiceEngine.createWorkflowPayableInvoice({ workflow, stage, line, partner, actor: req.user, now: nowISO() });
          db.prepare("UPDATE workflow_financial_lines SET payable_invoice_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(payable.id, id);
        }
        directAudit(req, "WORKFLOW_FINANCIAL_LINE_ADDED", id, null, { workflow_id: workflow.id, line_type: lineType, category, amount, partner_id: partner?.id || null }, "Workflow financial line added");
      })();
      res.status(201).json({ line: financialRows(workflow.id).find((row) => row.id === id), summary: signedFinanceSummary(financialRows(workflow.id)) });
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.patch("/api/workflows/:id/financial-lines/:lineId", auth, permit("ADMIN", "MANAGER"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id);
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      const line = db.prepare("SELECT * FROM workflow_financial_lines WHERE id=? AND workflow_id=?").get(req.params.lineId, workflow.id);
      if (!line) throw error("WORKFLOW_FINANCIAL_LINE_NOT_FOUND");
      if (line.payable_invoice_id && ["title","description","amount","billing_status","category","partner_id"].some((field) => req.body?.[field] !== undefined)) throw error("WORKFLOW_PARTNER_LINE_IMMUTABLE");
      if (line.stage_id) {
        const stage = requireStage(line.stage_id, workflow.id);
        if (stage.financial_status === "CLOSED") throw error("WORKFLOW_STAGE_FINANCE_CLOSED");
      }
      const body = req.body || {}, changes = [], values = [];
      if (body.title !== undefined) { const title = clean(body.title, 240); if (!title) throw error("FINANCIAL_LINE_TITLE_REQUIRED"); changes.push("title=?"); values.push(title); }
      if (body.description !== undefined) { changes.push("description=?"); values.push(clean(body.description)); }
      if (body.notes !== undefined) { changes.push("notes=?"); values.push(clean(body.notes)); }
      if (body.amount !== undefined) { const amount = numeric(body.amount, NaN); if (!Number.isFinite(amount) || amount < 0) throw error("INVALID_FINANCIAL_LINE_AMOUNT"); changes.push("amount=?"); values.push(amount); }
      if (body.billing_status !== undefined) { const billingStatus = String(body.billing_status).toUpperCase(); if (!["CHARGEABLE", "WARRANTY", "FREE", "COMPENSATION", "CREDIT"].includes(billingStatus)) throw error("INVALID_BILLING_STATUS"); changes.push("billing_status=?"); values.push(billingStatus); }
      if (!changes.length) return res.json({ line: financialRows(workflow.id).find((item) => item.id === line.id), summary: signedFinanceSummary(financialRows(workflow.id)) });
      values.push(line.id);
      db.prepare(`UPDATE workflow_financial_lines SET ${changes.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...values);
      const updated = db.prepare("SELECT * FROM workflow_financial_lines WHERE id=?").get(line.id);
      directAudit(req, "WORKFLOW_FINANCIAL_LINE_UPDATED", line.id, line, updated, "Workflow financial line updated");
      res.json({ line: financialRows(workflow.id).find((item) => item.id === line.id), summary: signedFinanceSummary(financialRows(workflow.id)) });
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_FINANCIAL_LINE_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/stages/:stageId/financial-close", auth, permit("ADMIN"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), stage = requireStage(req.params.stageId, workflow.id);
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      if (stage.status === "NOT_REQUIRED") throw error("WORKFLOW_STAGE_NOT_RELEVANT");
      if (!["COMPLETED", "ABORTED"].includes(stage.status)) throw error("WORKFLOW_STAGE_NOT_COMPLETE");
      if (stage.financial_status === "CLOSED") throw error("WORKFLOW_STAGE_FINANCE_ALREADY_CLOSED");
      const closedAt = nowISO(), reason = clean(req.body?.reason, 2000);
      db.prepare("UPDATE workflow_stages SET financial_status='CLOSED',financial_closed_at=?,financial_closed_by_user_id=?,financial_closure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(closedAt, req.user.id, reason || null, stage.id);
      const updated = stageById(stage.id);
      directAudit(req, "WORKFLOW_STAGE_FINANCIAL_CLOSED", stage.id, stage, updated, reason || "Workflow stage financial data closed");
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" || e.code === "WORKFLOW_STAGE_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/finalize", auth, permit("ADMIN"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id);
      if (workflow.financial_status === "CLOSED" && workflow.current_status === "COMPLETED") return res.json(decorateWorkflow(workflowById(workflow.id), true));
      if (workflow.current_status !== "ACTIVE") throw error("WORKFLOW_NOT_ACTIVE");
      if (!workflow.job_id) throw error("WORKFLOW_JOB_LINK_REQUIRED");
      const stages = stageRows(workflow.id);
      if (stages.some((stage) => !["COMPLETED", "NOT_REQUIRED", "ABORTED"].includes(stage.status))) throw error("WORKFLOW_STAGES_NOT_COMPLETE");
      const lines = financialRows(workflow.id), summary = signedFinanceSummary(lines), closureReason = clean(req.body?.closure_reason, 2000);
      const paymentMethod = normalizePaymentMethod(req.body?.payment_method, { allowEmpty: false });
      if (!paymentMethod) { const problem = error("INVALID_PAYMENT_METHOD"); problem.allowed = PAYMENT_METHODS; throw problem; }
      if (summary.net_total === 0 && !closureReason) throw error("ZERO_WORKFLOW_CLOSE_REASON_REQUIRED");
      const closedAt = nowISO(), closedId = rid("WCJ");
      const result = domain.closeoutJobOrchestration({
        jobId: workflow.job_id,
        source: "WORKFLOW",
        actor: req.user,
        closeType: "Full",
        complete: true,
        now: closedAt,
        financialEntries: lines.filter((line) => line.line_type === "COST" && !line.payable_invoice_id).map((line) => ({
          itemDate: closedAt.slice(0, 10),
          title: line.title,
          description: line.description || "",
          amount: Math.max(0, numeric(line.amount)),
          mainType: "EXPENSE",
          category: "OTHER_EXPENSE",
          jobId: workflow.job_id,
          clientId: workflow.client_id,
          pianoId: workflow.piano_id,
          sourceType: "workflow_financial_line",
          sourceId: `WORKFLOW_LINE:${line.id}`,
          paymentMethod,
          createdBy: req.user.name
        })),
        mutate: ({ now }) => {
          const openStages = stages.filter((stage) => stage.status !== "NOT_REQUIRED" && stage.financial_status !== "CLOSED");
          for (const stage of openStages) {
            db.prepare("UPDATE workflow_stages SET financial_status='CLOSED',financial_closed_at=?,financial_closed_by_user_id=?,financial_closure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
              .run(now, req.user.id, closureReason || "Auto-closed during workflow finalization", stage.id);
          }
          for (const line of lines) {
            const existing = db.prepare("SELECT id FROM financial_items WHERE source_type='workflow_financial_line' AND source_id=? LIMIT 1").get(`WORKFLOW_LINE:${line.id}`);
            if (existing && String(line.posted_financial_item_id || "") !== String(existing.id)) db.prepare("UPDATE workflow_financial_lines SET posted_financial_item_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(existing.id, line.id);
          }
          db.prepare(`INSERT OR IGNORE INTO workflow_closed_jobs(id,workflow_id,client_id,piano_id,final_due_at,closed_at,closed_by_user_id,closure_reason,revenue_total,cost_total,net_total,snapshot_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(closedId, workflow.id, workflow.client_id, workflow.piano_id, workflow.final_due_at, now, req.user.id, closureReason || null, summary.revenue_total, summary.cost_total, summary.net_total, JSON.stringify({ workflow, stages, lines }));
          db.prepare("UPDATE workshop_workflows SET financial_closure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(closureReason || null, workflow.id);
          const draftInvoice = invoiceEngine?.createWorkflowInvoice ? invoiceEngine.createWorkflowInvoice({ workflow, stages, lines, actor: req.user, now, paymentMethod }) : null;
          db.prepare("UPDATE jobs SET workflow_status='COMPLETED',updated_at=CURRENT_TIMESTAMP WHERE workshop_workflow_id=?").run(workflow.id);
          return { closedId, draftInvoiceId: draftInvoice?.id || null };
        }
      });
      const refreshedLines=financialRows(workflow.id);
      for(const line of refreshedLines){
        if(line.posted_financial_item_id) continue;
        const posted=db.prepare("SELECT id FROM financial_items WHERE source_type='workflow_financial_line' AND source_id=? LIMIT 1").get(`WORKFLOW_LINE:${line.id}`);
        if(posted) db.prepare("UPDATE workflow_financial_lines SET posted_financial_item_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(posted.id,line.id);
      }
      directAudit(req, "WORKFLOW_FINANCIAL_CLOSED", workflow.id, workflow, { status: "COMPLETED", financial_status: "CLOSED", summary, draft_invoice_id: result.mutation?.draftInvoiceId || null }, "Workflow financially finalized through unified job closeout");
      const payload = decorateWorkflow(workflowById(workflow.id), true);
      payload.draft_invoice = result.mutation?.draftInvoiceId && invoiceEngine?.invoiceDetail ? invoiceEngine.invoiceDetail(result.mutation.draftInvoiceId) : null;
      res.json(payload);
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : (e.status || 400)).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/:id/secondary-delete", auth, permit("ADMIN"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id), reason = clean(req.body?.reason, 2000);
      if (!reason) throw error("WORKFLOW_DELETE_REASON_REQUIRED");
      if (workflow.financial_status === "CLOSED") throw error("FINANCIALLY_CLOSED_WORKFLOW_REQUIRES_SUPERADMIN");
      const now = nowISO();
      db.transaction(() => {
        db.prepare("UPDATE workflow_stages SET status='ABORTED',block_reason=?,updated_at=CURRENT_TIMESTAMP WHERE workflow_id=? AND status NOT IN ('COMPLETED','NOT_REQUIRED')").run(reason, workflow.id);
        db.prepare("UPDATE workshop_workflows SET current_status='ABORTED',aborted_at=?,aborted_by_user_id=?,abort_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(now, req.user.id, reason, workflow.id);
        if(workflow.job_id) db.prepare("UPDATE jobs SET status='Cancelled',workflow_status='FAILED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(workflow.job_id);
        db.prepare("UPDATE jobs SET workflow_status='FAILED',updated_at=CURRENT_TIMESTAMP WHERE workshop_workflow_id=?").run(workflow.id);
        db.prepare("INSERT INTO workflow_audit_events(id,workflow_id,action,reason,actor_user_id,snapshot_json) VALUES(?,?,?,?,?,?)").run(rid("WAE"), workflow.id, "SECONDARY_DELETE", reason, req.user.id, JSON.stringify({ workflow }));
        directAudit(req, "WORKFLOW_SECONDARY_DELETE", workflow.id, workflow, { current_status: "ABORTED" }, reason);
      })();
      res.json(decorateWorkflow(workflowById(workflow.id), true));
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/workflows/purge-all", auth, requireSuperadmin, (req, res) => {
    try {
      const result = purgeAllWorkflowData({
        db,
        audit: ({ workflowCount, stageCount }) => directAudit(req, "PURGE_ALL_WORKFLOWS", "ALL", { workflow_count: workflowCount, stage_count: stageCount }, null, `Purged ${workflowCount} workflows and ${stageCount} stages`, "WORK")
      });
      res.json({ ok: true, message: "ALL_WORKFLOWS_PURGED", deleted_workflows: result.workflowCount, deleted_stages: result.stageCount });
    } catch (e) { res.status(400).json({ error: e.code || e.message }); }
  });

  app.delete("/api/workflows/:id", auth, requireSuperadmin, (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id);
      const reason = clean(req.body?.reason || "SUPERADMIN_CONFIRMED_HARD_DELETE", 2000);
      const snapshot = decorateWorkflow(workflow, true);
      const result = hardDeleteWorkflowData({
        db,
        workflowId: workflow.id,
        audit: ({ stageCount }) => directAudit(req, "SUPERADMIN_WORKFLOW_DELETE", workflow.id, snapshot, null, `${reason} · deleted_stages=${stageCount}`, "WORK")
      });
      if (!result) throw error("WORKFLOW_NOT_FOUND");
      res.json({ ok: true, success: true, deleted_id: workflow.id, deleted_workflow_id: workflow.id, deleted_stages: result.stageCount, audit_preserved: true });
    } catch (e) { res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.post("/api/jobs/:jobId/workshop-workflow", auth, permit("ADMIN", "MANAGER", "WORKER"), (req,res)=>{
    try{
      const job=db.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.jobId);if(!job)throw error("JOB_NOT_FOUND");
      const action=clean(req.body?.action,20).toUpperCase()||"CREATE";
      let workflow;
      db.transaction(()=>{
        if(action==="ATTACH"){
          workflow=requireWorkflow(validId(req.body?.workflow_id));
          if(workflow.current_status!=="ACTIVE")throw error("WORKFLOW_NOT_ACTIVE");
          if(job.client_id&&String(workflow.client_id)!==String(job.client_id))throw error("WORKFLOW_JOB_CLIENT_MISMATCH");
          if(job.piano_id&&String(workflow.piano_id)!==String(job.piano_id))throw error("WORKFLOW_JOB_PIANO_MISMATCH");
          db.prepare("UPDATE jobs SET workshop_workflow_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(workflow.id,job.id);
        }else if(action==="DETACH"){
          db.prepare("UPDATE jobs SET workshop_workflow_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.id);workflow=null;
        }else workflow=createWorkflowForJob(job,req.user,req.body||{});
      })();
      directAudit(req,"JOB_WORKFLOW_LINK_UPDATED",job.id,job,{workshop_workflow_id:workflow?.id||null},`action=${action}`);
      res.json({ok:true,workflow:workflow?decorateWorkflow(workflowById(workflow.id),true):null,job:db.prepare("SELECT * FROM jobs WHERE id=?").get(job.id)});
    }catch(e){res.status(e.code==="JOB_NOT_FOUND"||e.code==="WORKFLOW_NOT_FOUND"?404:400).json({error:e.code||e.message});}
  });

  app.get("/api/pianos/:pianoId/inspection-history",auth,permit("ADMIN","MANAGER","WORKER"),(req,res)=>{
    res.json(db.prepare("SELECT * FROM piano_inspection_history WHERE piano_id=? ORDER BY inspected_at DESC,created_at DESC").all(req.params.pianoId));
  });

  app.post("/api/workflows/:id/inspections/intake",auth,permit("ADMIN","MANAGER","WORKER"),inspectionUpload?.fields([{name:"pdf",maxCount:1},{name:"photos",maxCount:10}]),(req,res)=>{
    const uploaded=[...(req.files?.pdf||[]),...(req.files?.photos||[])];
    try{
      const workflow=requireWorkflow(req.params.id),pdf=req.files?.pdf?.[0],photos=req.files?.photos||[],status=clean(req.body?.status,40).toUpperCase();
      if(!pdf||String(pdf.mimetype).toLowerCase()!=="application/pdf"||path.extname(pdf.originalname||"").toLowerCase()!==".pdf")throw error("INTAKE_PDF_REQUIRED");
      if(!["FLAWLESS","PRE_EXISTING_DAMAGE"].includes(status))throw error("INVALID_INTAKE_INSPECTION_STATUS");
      const allowedPhotoExt=new Set([".jpg",".jpeg",".png",".webp"]),allowedPhotoMime=new Set(["image/jpeg","image/jpg","image/png","image/webp"]);
      if(photos.some(file=>!allowedPhotoExt.has(path.extname(file.originalname||"").toLowerCase())||!allowedPhotoMime.has(String(file.mimetype||"").toLowerCase())))throw error("INVALID_INTAKE_PHOTO");
      const inspectedAt=nowISO(),inspectedBy=req.user?.name||req.user?.id||"",prepared=[];
      try{
        const preparedPdf=preparePianoInspectionFile({workflow,file:pdf,inspectionType:"INTAKE",inspectionStatus:status,inspectedBy,inspectedAt});
        if(preparedPdf)prepared.push(preparedPdf);
        const preparedPhotos=[];
        for(const file of photos){const preparedPhoto=preparePianoInspectionFile({workflow,file,inspectionType:"DAMAGE_PHOTO",inspectionStatus:status,inspectedBy,inspectedAt});if(preparedPhoto){preparedPhotos.push(preparedPhoto);prepared.push(preparedPhoto);}}
        const workflowPdf=`/uploads/workflow-inspections/${path.basename(pdf.path)}`;
        db.transaction(()=>{
          const historyPdf=insertPreparedPianoInspectionFile(preparedPdf);
          const photoPaths=preparedPhotos.map(insertPreparedPianoInspectionFile).filter(Boolean);
          db.prepare("UPDATE workshop_workflows SET intake_inspection_status=?,intake_pdf_path=?,intake_photos=?,intake_inspected_by=?,intake_inspected_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,workflowPdf,JSON.stringify(photoPaths),inspectedBy,inspectedAt,workflow.id);
          directAudit(req,"WORKFLOW_INTAKE_INSPECTION",workflow.id,null,{status,pdf:workflowPdf,history_pdf:historyPdf,photos:photoPaths},"Arrival inspection recorded");
        })();
      }catch(e){cleanupPreparedInspectionFiles(prepared);throw e;}
      res.json(decorateWorkflow(workflowById(workflow.id),true));
    }catch(e){uploaded.forEach(file=>{try{fs.unlinkSync(file.path);}catch(_error){}});res.status(400).json({error:e.code||e.message});}
  });

  app.post("/api/workflows/:id/inspections/dispatch",auth,permit("ADMIN","MANAGER","WORKER"),inspectionUpload?.fields([{name:"pdf",maxCount:1}]),(req,res)=>{
    const uploaded=[...(req.files?.pdf||[])];
    try{
      const workflow=requireWorkflow(req.params.id),pdf=req.files?.pdf?.[0],status=clean(req.body?.status||"APPROVED",40).toUpperCase();
      if(!pdf||String(pdf.mimetype).toLowerCase()!=="application/pdf"||path.extname(pdf.originalname||"").toLowerCase()!==".pdf")throw error("DISPATCH_PDF_REQUIRED");
      if(!["APPROVED","ISSUE_FOUND"].includes(status))throw error("INVALID_DISPATCH_INSPECTION_STATUS");
      const inspectedAt=nowISO(),inspectedBy=req.user?.name||req.user?.id||"",prepared=[];
      try{
        const preparedPdf=preparePianoInspectionFile({workflow,file:pdf,inspectionType:"DISPATCH",inspectionStatus:status,inspectedBy,inspectedAt});
        if(preparedPdf)prepared.push(preparedPdf);
        const workflowPdf=`/uploads/workflow-inspections/${path.basename(pdf.path)}`;
        db.transaction(()=>{
          const historyPdf=insertPreparedPianoInspectionFile(preparedPdf);
          db.prepare("UPDATE workshop_workflows SET dispatch_inspection_status=?,dispatch_pdf_path=?,dispatch_inspected_by=?,dispatch_inspected_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,workflowPdf,inspectedBy,inspectedAt,workflow.id);
          directAudit(req,"WORKFLOW_DISPATCH_INSPECTION",workflow.id,null,{status,pdf:workflowPdf,history_pdf:historyPdf},"Outgoing inspection recorded");
        })();
      }catch(e){cleanupPreparedInspectionFiles(prepared);throw e;}
      res.json(decorateWorkflow(workflowById(workflow.id),true));
    }catch(e){uploaded.forEach(file=>{try{fs.unlinkSync(file.path);}catch(_error){}});res.status(400).json({error:e.code||e.message});}
  });

  app.post("/api/workflows/:id/documents", auth, permit("ADMIN", "MANAGER", "WORKER"), upload?.single("file"), (req, res) => {
    try {
      const workflow = requireWorkflow(req.params.id); if (!req.file) throw error("WORKFLOW_DOCUMENT_REQUIRED");
      const stage = req.body?.stage_id ? requireStage(validId(req.body.stage_id), workflow.id) : null;
      const id = rid("WFD");
      db.prepare("INSERT INTO workflow_documents(id,workflow_id,stage_id,document_path,document_name,document_type,created_by_user_id) VALUES(?,?,?,?,?,?,?)").run(id, workflow.id, stage?.id || null, `/uploads/${req.file.filename}`, req.file.originalname, req.file.mimetype, req.user.id);
      db.prepare("INSERT INTO knowledge_base(id,job_id,title,category,content_type,body,stored_path,owner,priority,workflow_id) VALUES(?,?,?,?,?,?,?,?,?,?)").run(rid("KB"), workflow.job_id||null, req.file.originalname, "Workshop Workflow", "Workflow Document", `Workflow ${workflow.workflow_key}`, `/uploads/${req.file.filename}`, req.user.name, "Medium", workflow.id);
      directAudit(req, "WORKFLOW_DOCUMENT_ADDED", id, null, { workflow_id: workflow.id, document_name: req.file.originalname }, "Workflow document added");
      res.status(201).json({ id, workflow_id: workflow.id, document_path: `/uploads/${req.file.filename}`, document_name: req.file.originalname, document_type: req.file.mimetype });
    } catch (e) { if (req.file && e.code) { try { require("fs").unlinkSync(req.file.path); } catch (_error) {} } res.status(e.code === "WORKFLOW_NOT_FOUND" ? 404 : 400).json({ error: e.code || e.message }); }
  });

  app.get("/api/workflows/:id/documents", auth, permit("ADMIN", "MANAGER", "WORKER"), (req, res) => {
    try { requireWorkflow(req.params.id); res.json(db.prepare("SELECT d.*,u.name AS created_by_name FROM workflow_documents d LEFT JOIN users u ON u.id=d.created_by_user_id WHERE d.workflow_id=? ORDER BY d.created_at DESC").all(req.params.id)); } catch (e) { res.status(404).json({ error: e.code || e.message }); }
  });
}

module.exports = { registerWorkshopWorkflowRoutes, DEFAULT_STAGES, STANDARD_SUBTASKS, hardDeleteWorkflowData, purgeAllWorkflowData };
