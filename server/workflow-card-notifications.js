"use strict";
const crypto = require('node:crypto');
const clean = (value, limit = 350) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
const isAdmin = u => u?.role === 'ADMIN' || u?.role === 'SUPERADMIN' || Number(u?.is_superadmin) === 1;

// A card transition is persisted in the same transaction as the card mutation.
// Subtask edits never call this service. Refreshing the feed never creates events.
function createCardNotifications({ db }) {
  function record({ cardType, cardId, workflowId = null, title, titleEn = '', titleHu = '', before, after, note = '', actor, recipients = [] }) {
    if (!before || !after || before === after) return null;
    return db.transaction(() => {
      const id = `CE-${crypto.randomUUID()}`;
      db.prepare('INSERT INTO wf_card_events(id,card_type,card_id,workflow_id,title,title_en,title_hu,old_status,new_status,note,actor_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,cardType,cardId,workflowId,clean(title,200),clean(titleEn||title,200),clean(titleHu||title,200),before,after,clean(note),actor?.id || null);
      const users = new Set(recipients.filter(Boolean));
      for (const u of db.prepare("SELECT id FROM users WHERE status='Active' AND (role='ADMIN' OR is_superadmin=1)").all()) users.add(u.id);
      const insert = db.prepare("INSERT OR IGNORE INTO wf_card_event_recipients(event_id,user_id) SELECT ?,id FROM users WHERE id=? AND status='Active'");
      for (const userId of users) insert.run(id,userId);
      return id;
    })();
  }
  function workflowSnapshot(w) {
    return { ...w, effective_status: w.deleted_at ? 'DELETED' : w.aborted_at ? 'ABORTED' : w.status,
      phases: db.prepare('SELECT * FROM wf2_phases WHERE workflow_id=?').all(w.id) };
  }
  function workflowChanged(before, after, actor) {
    const recipients = [after.main_responsible_user_id, ...after.phases.map(p=>p.responsible_user_id)];
    record({cardType:'WORKFLOW',cardId:after.id,workflowId:after.id,title:after.title,before:before.effective_status,after:after.effective_status,
      note:after.abandonment_reason || after.description,actor,recipients});
    // Closing/abandoning the entire workflow emits one overall change, not seven
    // redundant phase-close messages from the same command.
    if (before.effective_status !== after.effective_status) return;
    for (const phase of after.phases) {
      const old = before.phases.find(p=>p.id===phase.id);
      if (!old) continue;
      record({cardType:'PHASE',cardId:phase.id,workflowId:after.id,title:phase.title,titleEn:[phase.name_snapshot_en,phase.name_snapshot_hu].includes(phase.title)?phase.name_snapshot_en:phase.title,titleHu:[phase.name_snapshot_en,phase.name_snapshot_hu].includes(phase.title)?phase.name_snapshot_hu:phase.title,before:old.status,after:phase.status,
        note:phase.description,actor,recipients:[after.main_responsible_user_id,phase.responsible_user_id]});
    }
  }
  function calendarChanged(before, after, actor) {
    if (!before || !after || db.prepare('SELECT 1 FROM wf2_calendar_links WHERE job_id=?').get(after.id)) return;
    record({cardType:'CALENDAR_JOB',cardId:after.id,title:after.title,before:before.status || 'Open',after:after.status || 'Open',
      note:publicDescription(after),actor,recipients:[after.assigned_user_id]});
  }
  function list(user) {
    if (!user?.id) return [];
    return db.prepare(`SELECT e.*,u.name actor_name FROM wf_card_events e
      JOIN wf_card_event_recipients r ON r.event_id=e.id LEFT JOIN users u ON u.id=e.actor_user_id
      WHERE r.user_id=? AND r.dismissed_at IS NULL ORDER BY e.created_at DESC,e.rowid DESC LIMIT 100`).all(user.id).map(e=>({
      id:'card-status-'+e.id,entity_type:'CARD_STATUS',entity_id:e.id,category:'CARD_STATUS',title:e.title,title_en:e.title_en,title_hu:e.title_hu,
      workflow_id:e.workflow_id || '',card_type:e.card_type,card_id:e.card_id,old_status:e.old_status,new_status:e.new_status,
      description:e.note,target_date:e.created_at,urgency:'STATUS_CHANGE',responsible_name:e.actor_name || '',
      can_reschedule:false,source:'CARD_STATUS_ENGINE'
    }));
  }
  function visible(user,id) { return Boolean(db.prepare('SELECT 1 FROM wf_card_event_recipients WHERE event_id=? AND user_id=?').get(id,user?.id || '')); }
  function dismiss(user,id) {
    if (!visible(user,id)) throw Object.assign(new Error('NOTIFICATION_ENTITY_NOT_FOUND'),{status:404});
    db.prepare('UPDATE wf_card_event_recipients SET dismissed_at=COALESCE(dismissed_at,CURRENT_TIMESTAMP) WHERE event_id=? AND user_id=?').run(id,user.id);
  }
  return { record,workflowSnapshot,workflowChanged,calendarChanged,list,visible,dismiss };
}

// Old imports stored transport metadata in instructions. Only extract the actual
// description; keep the original import text untouched in the database.
function publicDescription(job) {
  const text = String(job?.instructions || job?.notes || '');
  if (!text.includes('[Google Calendar import / Google Napt\u00e1r-import]')) return clean(text);
  const match = text.match(/Description \/ Le\u00edr\u00e1s:[ \t]*([\s\S]*?)(?:\nLocation \/ Helysz\u00edn:|$)/);
  return clean(match?.[1] || '');
}
function decorateDeadline(job, link, row) {
  const imported = Boolean(job.google_imported || job.external_event_id || String(job.instructions || '').includes('[Google Calendar import / Google Napt\u00e1r-import]'));
  const pending = imported && ['Pending review','Pending Review','Needs review','Review','Needs Review','PENDING_REVIEW'].includes(job.status);
  return { ...row, category: link ? 'WORKFLOW_DEADLINE' : pending ? 'IMPORT_REVIEW' : 'CALENDAR_JOB',
    instrument_context:row.instrument_context==='Calendar appointment / Naptári időpont'?'':row.instrument_context, client_context:row.client_context==='No client linked / Nincs kapcsolt ügyfél'?'':row.client_context,
    import_pending_review: pending, description: pending ? '' : publicDescription(job),
    logical_key: link ? `WF:${link.workflow_id}:${link.entity_type}:${link.entity_id}` : `JOB:${job.id}`,
    can_reschedule: pending ? false : row.can_reschedule };
}
module.exports = { createCardNotifications, publicDescription, decorateDeadline };
