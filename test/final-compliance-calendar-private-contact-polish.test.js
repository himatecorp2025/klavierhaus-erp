const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const {buildPrivateAppointmentDecisionEmail}=require("../server/transactional-email");

test("calendar keeps existing events separate from empty-slot creation",()=>{
  const source=read("public/round2.js");
  assert.match(source,/event\.target\.closest\("\[data-calendar-job\],\[data-private-appointment\],\[data-new-calendar-job\],\.calendar-now-line"\)/);
  assert.match(source,/\[data-private-appointment\][\s\S]{0,280}event\.stopPropagation\(\)/);
  assert.match(source,/job\.stage==="completed"[\s\S]{0,260}r2OpenWorkflowHistory/);
});

test("New York job datetime conversion uses visible native date controls while private appointments keep 15-minute precision",()=>{
  const source=read("public/round2.js"),css=read("public/styles.css");
  assert.match(source,/function r2NyInputToIso\(value\)[\s\S]{0,1800}rendered=r2NyParts\(result\)/);
  assert.match(source,/const R2_JOB_SLOT_MIN=30/);
  assert.match(source,/class="r2-native-date-picker" type="date" name="'\+esc\(name\)\+'_date"/);
  assert.doesNotMatch(source,/r2-date-picker-shell/);
  assert.match(source,/\(required\?"required ":""\)\+'aria-label='/);
  assert.match(css,/\.r2-native-date-picker\{[\s\S]{0,700}position:static!important;[\s\S]{0,500}opacity:1!important;[\s\S]{0,300}pointer-events:auto!important/);
  assert.match(source,/startMinutes=R2_DAY_START,endMinutes=R2_DAY_END/);
  assert.match(source,/const scheduledLocal=r2ReadDateTime\(event\.currentTarget,"scheduled_at",\{required:workflowEntry\|\|calendarEntry\}\)/);
  assert.match(source,/body\.scheduled_at=r2NyInputToIso\(scheduledLocal\)/);
  assert.match(source,/slotMinutes:15,startMinutes:0,endMinutes:23\*60\+45/);
  assert.match(source,/r2PrivateCalendarRow[\s\S]{0,700}row\.duration_min[\s\S]{0,700}row\.scheduled_end_at/);
});

test("approved private appointment email supports editable template variables",()=>{
  const content=buildPrivateAppointmentDecisionEmail({
    name:"Ada Client",email:"ada@example.com",phone:"+1 212 555 0101",decision:"APPROVED",
    startsAt:"2026-10-08T18:00:00.000Z",endsAt:"2026-10-08T19:30:00.000Z",durationMin:90,language:"en",
    template:{subject_en:"Confirmed · {{name}} · {{date}}",body_en:"{{name}} | {{time}}-{{end_time}} | {{duration}} | {{email}} | {{phone}}",subject_hu:"HU",body_hu:"HU"}
  });
  assert.match(content.subject,/Ada Client/);
  assert.match(content.text,/90/);
  assert.match(content.text,/ada@example\.com/);
  assert.match(content.text,/\+1 212 555 0101/);
  assert.doesNotMatch(content.text,/\{\{/);
});

test("private appointment admin exposes editable email template endpoints",()=>{
  const backend=read("server/private-appointments.js"),frontend=read("public/round2.js");
  assert.match(backend,/\/api\/private-appointments\/email-template/);
  assert.match(backend,/private_appointment_email_template/);
  assert.match(frontend,/privateEmailTemplateBtn/);
  assert.match(frontend,/\{\{name\}\}[\s\S]*\{\{date\}\}[\s\S]*\{\{time\}\}/);
});

test("public header exposes responsive phone and email shortcuts",()=>{
  const server=read("website/server/index.js"),css=read("website/public/styles.css");
  assert.match(server,/header-quick-contact--desktop/);
  assert.match(server,/header-quick-contact--mobile/);
  assert.match(server,/brand\.phoneHref/);
  assert.match(server,/brand\.emailHref/);
  assert.match(css,/@media \(max-width: 1080px\)[\s\S]*header-quick-contact--mobile[\s\S]*display: flex/);
  assert.match(css,/header-contact-icon[\s\S]*gold-bright/);
});
