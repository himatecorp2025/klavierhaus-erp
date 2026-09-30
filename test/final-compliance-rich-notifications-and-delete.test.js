"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("operational notifications explain what happened and carry actionable record URLs",()=>{
  const backend=read("server/notification-center.js");
  assert.match(backend,/updated client/);
  assert.match(backend,/deleted client/);
  assert.match(backend,/Invoice payment recorded/);
  assert.match(backend,/Updated:/);
  assert.match(backend,/\/\?view=master&client=/);
  assert.match(backend,/\/\?view=master&piano=/);
  assert.match(backend,/\/\?view=documents&category=deleted_intake&archive=/);
  assert.match(backend,/\/\?view=documents&category=deleted_client&archive=/);
  assert.match(backend,/\/\?view=finance&invoice=/);
  assert.match(backend,/\/\?view=workshop&job=/);
});

test("notification drawer exposes View and consumes deep links down to concrete records",()=>{
  const app=read("public/app.js"),round2=read("public/round2.js"),round3=read("public/round3.js"),v6=read("public/v6.js");
  assert.match(app,/data-notification-view/);
  assert.match(app,/function notificationNavigate/);
  assert.match(app,/function consumeDeepLink/);
  assert.match(app,/pendingIntakeEditId/);
  assert.match(app,/pendingArchiveId/);
  assert.match(app,/pendingNotificationInvoiceId/);
  assert.match(app,/pendingNotificationJobId/);
  assert.match(round2,/pendingNotificationJobId/);
  assert.match(round2,/r2OpenWorkflowHistory\(jobId\)/);
  assert.match(round3,/pendingNotificationInvoiceId/);
  assert.match(round3,/r3OpenInvoice\(invoiceId,renderFinance\)/);
  assert.match(v6,/pendingArchiveId/);
  assert.match(v6,/data-archive-details/);
});

test("intake deletion is admin-only visible and backend detaches legacy FK dependents before archive deletion",()=>{
  const v6=read("public/v6.js"),archive=read("server/archive-center.js");
  assert.match(v6,/canDeleteIntake=editing&&\["ADMIN","SUPERADMIN"\]/);
  assert.match(v6,/id="intakeDeleteButton"/);
  assert.match(archive,/app\.delete\("\/api\/intake\/:id",auth,admin/);
  assert.match(archive,/UPDATE jobs SET intake_id=NULL WHERE intake_id=\?/);
  assert.match(archive,/DELETE FROM intake_assessment_email_log WHERE intake_id=\?/);
  assert.match(archive,/DELETE FROM intake_assessment_items WHERE intake_id=\?/);
  assert.match(archive,/DELETE FROM intake_leads WHERE id=\?/);
});
