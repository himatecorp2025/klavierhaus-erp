"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `Missing section start: ${start}`);
  assert.notEqual(to, -1, `Missing section end: ${end}`);
  return source.slice(from, to);
};

test("unified deadline engine has one three-action UI contract and protects user-scoped state", () => {
  const app = read("public/app.js");
  const server = read("server/index.js");
  const styles = read("public/styles.css");
  const card = section(app, "function unifiedDeadlineCardMarkup", "function ensureUnifiedDeadlineStack");
  const controller = section(app, "function bindDeadlineNotificationDelegation", "function initDeadlineNotificationEngine");

  assert.equal((card.match(/data-unified-notification-action=/g) || []).length, 3, "The floating card has exactly three actions");
  assert.match(card, /data-unified-notification-action="complete"/);
  assert.match(card, /data-unified-notification-action="reschedule"/);
  assert.match(card, /data-unified-notification-action="snooze"/);
  assert.doesNotMatch(card, /onclick=/, "Card actions are delegated, not inline handlers");
  assert.match(controller, /getElementById\('floating-notifications-container'\)/);
  assert.match(controller, /data-unified-notification-action/);
  assert.doesNotMatch(app, /function deadlineNotificationIcon\(/, "Retired parallel deadline UI was removed");
  assert.match(styles, /#floating-notifications-container\.global-notification-stack\{[^}]*z-index:10040!important[^}]*pointer-events:none!important/s);
  assert.match(styles, /#floating-notifications-container \.notification-card,#floating-notifications-container \.notification-btn[^}]*pointer-events:auto!important/s);
  assert.match(styles, /unifiedNotificationSlideIn/);
  assert.match(styles, /\.unified-notification-card\.is-leaving/);

  assert.match(server, /const DEADLINE_NOTIFICATION_TYPES=new Set\(\['CLIENT_FOLLOWUP','WORKFLOW_STAGE','CALENDAR_JOB'\]\)/);
  assert.match(server, /SELECT entity_type,entity_id FROM notification_snooze_log WHERE user_id=\? AND snoozed_until>\?/);
  assert.match(server, /INSERT INTO notification_snooze_log\(id,user_id,entity_type,entity_id,snoozed_until\)/);
  assert.match(server, /ON CONFLICT\(user_id,entity_type,entity_id\)/);
  assert.match(server, /NOT EXISTS\(SELECT 1 FROM workflow_stages s WHERE s\.calendar_job_id=j\.id\)/);
});

test("workflow completion and rescheduling remain transactional across workflow, calendar, and accounting", () => {
  const server = read("server/index.js");
  const workflow = read("server/workshop-workflow.js");
  const jobs = read("server/job-domain.js");

  const notificationRoutes = section(server, "app.post('/api/notifications/reschedule'", "app.get(\"/api/planned-jobs\"");
  assert.match(notificationRoutes, /rescheduleStageFromNotification/);
  assert.match(notificationRoutes, /jobDomain\.patchJobSchedule/);
  assert.match(notificationRoutes, /closeoutJobOrchestration/);
  assert.match(notificationRoutes, /canCloseJob\(req\.user,before\)/);
  assert.match(workflow, /function rescheduleStageFromNotification/);
  assert.match(workflow, /syncStageCalendarJobDeadline\(workflow, updatedStage, dueAt\)/);
  assert.match(workflow, /WORKFLOW_STAGE_RESCHEDULED_FROM_NOTIFICATION/);
  assert.match(workflow, /function completeStageFromNotification/);
  assert.match(workflow, /closeStageCalendarJob\(workflow, updatedStage, actor, cleanNote\)/);
  assert.match(workflow, /financial_status='CLOSED'/);
  assert.match(jobs, /function patchJobSchedule\(\{ jobId, startTime, endTime, assignedUser, allowUnassigned = false/);
  assert.match(jobs, /const conflicts = assignedUser\?\.id/);
});

test("rebuilt Workflow Details modal uses one delegated controller and preserves phase finance fields", () => {
  const app = read("public/app.js");
  const styles = read("public/styles.css");
  const drawer = section(app, "function workflowDetailsStageMarkup", "function workflowDetailsModalHost");
  const controller = section(app, "function bindWorkflowDetailsController", "function workflowMountUnifiedDetails");

  assert.match(drawer, /workflow-details-rebuilt/);
  assert.match(drawer, /workflowCardTitle_/);
  assert.match(drawer, /workflowDetailsIdentityMarkup/);
  assert.match(drawer, /workflowDetailsSubtaskMarkup/);
  assert.match(drawer, /workflowDetailsCostMarkup/);
  assert.match(drawer, /workflowDetailsTransferMarkup/);
  assert.doesNotMatch(drawer, /onclick=/, "New modal controls use one controller");
  assert.match(controller, /data-workflow-details-action/);
  assert.match(controller, /workflowSaveStage/);
  assert.match(controller, /workflowAddFinancialLine/);
  assert.match(controller, /workflowCompleteStage/);
  assert.match(styles, /\.workflow-details-rebuilt/);
  assert.match(styles, /\.workflow-details-modal-overlay/);
});

test("legacy workflow-stage database upgrades add the calendar link before schema indexes", () => {
  const init = read("server/init-db.js");
  const smoke = read("test/helpers/migration-smoke.js");
  const ensurePosition = init.indexOf('ensureColumn("workflow_stages", "calendar_job_id", "TEXT")');
  const schemaPosition = init.indexOf('db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"))');

  assert.ok(ensurePosition !== -1 && schemaPosition !== -1 && ensurePosition < schemaPosition, "calendar_job_id is present before schema.sql indexes are evaluated");
  assert.match(smoke, /ALTER TABLE workflow_stages DROP COLUMN calendar_job_id/);
  assert.match(smoke, /MIGRATION_LEGACY_CALENDAR_LINK_RUN_2/);
  assert.match(smoke, /WORKFLOW_STAGE_CALENDAR_JOB_INDEX_MISSING/);
});
