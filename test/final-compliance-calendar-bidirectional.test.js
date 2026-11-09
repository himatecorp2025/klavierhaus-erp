"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Database=require("better-sqlite3");
const {createGoogleCalendarIntegration}=require("../server/google-calendar");
const {calendarLeadRows,parseLeadTime}=require("../server/calendar-leads");

function fixture(){
  const db=new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(fs.readFileSync(path.join(__dirname,"..","server","schema.sql"),"utf8"));
  db.prepare("INSERT INTO clients(id,name,email,client_type) VALUES(1,'Concert Client','client@example.com','INDIVIDUAL')").run();
  db.prepare("INSERT INTO pianos(id,client_id,brand,model) VALUES(1,1,'Steinway','D')").run();
  db.prepare("INSERT INTO users(id,name,email,google_calendar_email,password_hash,role,status,hidden_user) VALUES('A','Admin','admin@example.com',NULL,'x','ADMIN','Active',0)").run();
  db.prepare("INSERT INTO users(id,name,email,google_calendar_email,password_hash,role,status,hidden_user) VALUES('W','Emre','emre@example.com','emre@example.com','x','WORKER','Active',0)").run();
  let count=0;
  const remote=new Map(),requests=[];
  const fetchImpl=async(url,init={})=>{
    const path=String(url),method=init.method||"GET";
    requests.push({path,method,headers:init.headers,body:init.body});
    if(path.includes("oauth2.googleapis.com/token"))return new Response(JSON.stringify({
      access_token:"test-access",refresh_token:"test-refresh",expires_in:3600
    }),{status:200,headers:{"content-type":"application/json"}});
    if(path.includes("/calendars/primary"))return new Response(JSON.stringify({id:"klavierhauswork@gmail.com"}),{status:200});
    if(path.includes("/calendars/emre%40example.com")&&!path.includes("/events"))
      return new Response(JSON.stringify({error:{message:"Not Found"}}),{status:404});
    if(path.includes("/calendars/office%40example.com")&&!path.includes("/events"))
      return new Response(JSON.stringify({id:"office@example.com",summary:"Office master"}),{status:200});
    if(path.includes("/events")){
      const id=path.match(/\/events\/([^?]+)/)?.[1];
      if(method==="GET"&&!id){
        const calendarBase=path.split("/events?")[0];
        const events=[...remote.values()].filter(item=>item._calendar_base===calendarBase);
        return new Response(JSON.stringify({items:events,nextSyncToken:"mock-master-sync-token"}),{status:200});
      }
      if(method==="POST"){
        const event=JSON.parse(init.body);
        if(remote.has(event.id))return new Response(JSON.stringify({error:{message:"Already exists"}}),{status:409});
        remote.set(event.id,{...event,id:event.id,etag:"etag-1",_calendar_base:path.split("/events")[0]});
        return new Response(JSON.stringify(remote.get(event.id)),{status:200});
      }
      if(method==="PATCH"){
        const existing=remote.get(id);
        if(!existing)return new Response(JSON.stringify({error:{message:"Not Found"}}),{status:404});
        if(init.headers["If-Match"]!==existing.etag)return new Response(JSON.stringify({error:{message:"Version conflict"}}),{status:412});
        const event={...existing,...JSON.parse(init.body),etag:"etag-2"};
        remote.set(id,event);return new Response(JSON.stringify(event),{status:200});
      }
      if(method==="DELETE"){
        const existing=remote.get(id);
        if(!existing)return new Response(JSON.stringify({error:{message:"Not Found"}}),{status:404});
        if(init.headers["If-Match"]!==existing.etag)return new Response(JSON.stringify({error:{message:"Version conflict"}}),{status:412});
        remote.delete(id);
        return new Response(null,{status:204});
      }
      if(method==="GET"&&id&&remote.has(id))return new Response(JSON.stringify(remote.get(id)),{status:200});
    }
    return new Response(JSON.stringify({error:{message:"Unexpected URL"}}),{status:404});
  };
  const integration=createGoogleCalendarIntegration({db,rid:prefix=>prefix+"-"+(++count),env:{
    GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY:"01234567890123456789012345678901",
    APP_BASE_URL:"https://erp.example.com",
    GOOGLE_CALENDAR_CENTRAL_EMAIL:"klavierhauswork@gmail.com",
    GOOGLE_CALENDAR_ID:"ac31bd0e9409cafb409e38e035bdaa59f913ea932fa5a94a488d218d97ed3513@group.calendar.google.com"
  },createNotification:()=>{},fetchImpl,logger:{info(){},warn(){}}});
  db.prepare("UPDATE calendar_integrations SET status='CONNECTED',access_token_encrypted=?,refresh_token_encrypted=?,token_expiry=? WHERE provider='GOOGLE'")
    .run(integration._test.encrypt("test-access"),integration._test.encrypt("test-refresh"),new Date(Date.now()+3600000).toISOString());
  return {db,remote,requests,integration,close(){integration.stop();db.close()}};
}
async function connectWriter(f) {
  const url=new URL(f.integration.createWriteAuthUrl("A"));
  await f.integration.handleWriteOAuthCallback("fake-code",url.searchParams.get("state"));
  f.integration.configureWrite({calendar_id:"office@example.com",enabled:true});
}
function addJob(db){
  db.prepare("INSERT INTO jobs(id,client_id,piano_id,title,scheduled_at,estimated_duration_min,stage,workflow_stage_key) VALUES(1,1,1,'Tune Piano','2035-08-20T14:00:00.000Z',60,'received','received')").run();
}
test("Google write is disabled by default, master calendar is not guessed, and staff connection errors are actionable",async()=>{
  const f=fixture();
  try{
    assert.equal(f.integration.writeStatus().enabled,false);
    assert.equal((await f.integration.syncOutbound()).disabled,true);
    assert.equal(f.requests.length,0);
    assert.throws(()=>f.integration.configureWrite({calendar_id:"office@example.com",enabled:true}),/GOOGLE_WRITE_AUTH_AND_CALENDAR_REQUIRED/);
    const staff=f.integration.staffCalendarStatuses(),emre=staff.find(x=>x.name==="Emre"),admin=staff.find(x=>x.name==="Admin");
    assert.equal(emre.enabled,1);
    assert.equal(emre.write_enabled,0,"Staff Google writes require a separate administrator opt-in");
    assert.equal(admin.enabled,0);
    const result=await f.integration.verifyStaffCalendar(emre.user_id);
    assert.equal(result.error,"CALENDAR_NOT_SHARED_OR_UNKNOWN");
    assert.equal(result.sync_status,"ERROR");
    const edited=f.integration.configureStaffCalendar(emre.user_id,{calendar_id:"emre@example.com",enabled:0});
    assert.equal(edited.enabled,0);
  }finally{f.close();}
});
test("separate writer OAuth, opted-in master, idempotent export, conditional update and incoming changes",async()=>{
  const f=fixture();
  try{
    addJob(f.db);
    await connectWriter(f);
    assert.equal(f.integration.writeStatus().enabled,true);
    const initial=await f.integration.syncOutbound();
    assert.equal(initial.created_or_updated,1);
    assert.equal(f.remote.size,1);
    const again=await f.integration.syncOutbound();
    assert.equal(again.created_or_updated,0);
    const eventId=[...f.remote.keys()][0];
    const first=f.remote.get(eventId);
    assert.equal(first.extendedProperties.private.kh_type,"JOB");
    f.db.prepare("UPDATE jobs SET title='Piano Tuning Updated' WHERE id=1").run();
    const changed=await f.integration.syncOutbound();
    assert.equal(changed.created_or_updated,1);
    assert.ok(f.requests.some(x=>x.method==="PATCH"&&x.headers["If-Match"]==="etag-1"));
    const incoming={...f.remote.get(eventId),etag:"etag-3",summary:"Klavierhaus work · Google Changed",
      start:{dateTime:"2035-08-20T15:00:00.000Z"},end:{dateTime:"2035-08-20T16:00:00.000Z"}};
    f.integration._test.processEvent(incoming,"office@example.com");
    const job=f.db.prepare("SELECT * FROM jobs WHERE id=1").get();
    assert.equal(job.title,"Google Changed");
    assert.equal(job.scheduled_at,"2035-08-20T15:00:00.000Z");
    assert.equal((await f.integration.syncOutbound()).created_or_updated,0);
  }finally{f.close();}
});
test("concurrent ERP and Google event changes are reported without overwriting ERP data",async()=>{
  const f=fixture();
  try{
    addJob(f.db);await connectWriter(f);await f.integration.syncOutbound();
    const eventId=[...f.remote.keys()][0];
    f.db.prepare("UPDATE jobs SET title='Local ERP edit' WHERE id=1").run();
    f.integration._test.processEvent({...f.remote.get(eventId),etag:"etag-external",
      summary:"Google edit"}, "office@example.com");
    assert.equal(f.db.prepare("SELECT title FROM jobs WHERE id=1").get().title,"Local ERP edit");
    const link=f.db.prepare("SELECT * FROM calendar_outbound_links WHERE source_type='JOB'").get();
    assert.equal(link.state,"CONFLICT");
  }finally{f.close();}
});
test("website leads without full dates stay actionable in ERP inbox; exact dates become tentative",()=>{
  const db=new Database(":memory:");
  try{
    db.exec(fs.readFileSync(path.join(__dirname,"..","server","schema.sql"),"utf8"));
    db.prepare("INSERT INTO website_contact_leads(id,lead_type,name,email,preferred_time) VALUES('lead-1','SERVICE_CALLBACK','Someone','someone@example.com','Next week around noon')").run();
    db.prepare("INSERT INTO website_contact_leads(id,lead_type,name,email,preferred_time) VALUES('lead-2','SERVICE_CALLBACK','Someone Else','other@example.com','2035-08-20T14:00:00Z')").run();
    const result=calendarLeadRows(db,{from:"2035-08-20T00:00:00Z",to:"2035-08-21T00:00:00Z"});
    assert.equal(result.inbox.length,1);
    assert.equal(result.scheduled.length,1);
    assert.equal(result.scheduled[0].status,"PENDING_CONFIRMATION");
    assert.equal(parseLeadTime("Tomorrow morning"),null);
  }finally{db.close();}
});

test("work assigned to a connected employee is exported to their enabled staff calendar as well as the master",async()=>{
  const f=fixture();
  try{
    addJob(f.db);
    f.db.prepare("UPDATE jobs SET assigned_technician_id='W' WHERE id=1").run();
    f.integration.configureStaffCalendar("W",{calendar_id:"emre@example.com",enabled:true,write_enabled:true});
    await connectWriter(f);
    const result=await f.integration.syncOutbound();
    assert.equal(result.created_or_updated,2);
    const destinations=f.db.prepare("SELECT calendar_id FROM calendar_outbound_links WHERE source_type='JOB' AND source_id='1' ORDER BY calendar_id").all().map(x=>x.calendar_id);
    assert.deepEqual(destinations,["emre@example.com","office@example.com"]);
    const sent=f.requests.filter(x=>x.method==="POST"&&x.path.includes("/events"));
    assert.equal(sent.length,2);
  }finally{f.close();}
});
test("Google edits that conflict with another assigned ERP job are blocked and shown in the integration error panel",async()=>{
  const f=fixture();
  try{
    addJob(f.db);
    f.db.prepare("UPDATE jobs SET assigned_technician_id='W' WHERE id=1").run();
    f.db.prepare("INSERT INTO jobs(id,client_id,piano_id,title,scheduled_at,estimated_duration_min,stage,assigned_technician_id) VALUES(2,1,1,'Other work','2035-08-20T17:00:00.000Z',90,'received','W')").run();
    await connectWriter(f);
    await f.integration.syncOutbound();
    const eventId=f.db.prepare("SELECT google_event_id FROM calendar_outbound_links WHERE source_type='JOB' AND source_id='1' AND calendar_id='office@example.com'").get().google_event_id;
    const remote=f.remote.get(eventId);
    f.integration._test.processEvent({...remote,etag:"etag-moved",start:{dateTime:"2035-08-20T17:30:00.000Z"},end:{dateTime:"2035-08-20T18:30:00.000Z"}},"office@example.com");
    assert.equal(f.db.prepare("SELECT scheduled_at FROM jobs WHERE id=1").get().scheduled_at,"2035-08-20T14:00:00.000Z");
    assert.equal(f.db.prepare("SELECT last_error FROM calendar_outbound_links WHERE google_event_id=? AND calendar_id=?").get(eventId,"office@example.com").last_error,"SCHEDULE_CONFLICT");
    assert.ok(f.integration.outboundErrors().some(x=>x.last_error==="SCHEDULE_CONFLICT"));
  }finally{f.close();}
});
test("the ERP calendar shows tentative web leads, private requests and employee-specific filtering",()=>{
  const calendar=fs.readFileSync(path.join(__dirname,"..","public","round2.js"),"utf8");
  const backend=fs.readFileSync(path.join(__dirname,"..","server","round2-workflow.js"),"utf8");
  const appointments=fs.readFileSync(path.join(__dirname,"..","server","private-appointments.js"),"utf8");
  assert.match(calendar,/lead_inbox/);
  assert.match(calendar,/data-calendar-lead/);
  assert.match(calendar,/data-calendar-request/);
  assert.match(calendar,/String\(row.assigned_user_id\|\|""\)===String\(tech\)/);
  assert.match(backend,/calendarLeadRows\(db/);
  assert.match(appointments,/private_appointment_public_end","21:00"/);
});

test("events created directly in the master Google calendar are imported into ERP and adopted without duplication",async()=>{
  const f=fixture();
  try{
    await connectWriter(f);
    const masterUrl="https://www.googleapis.com/calendar/v3/calendars/office%40example.com";
    f.remote.set("office-manual-1",{
      id:"office-manual-1",etag:"manual-etag-1",status:"confirmed",
      summary:"Concert Client Steinway D tuning",description:"client@example.com · piano maintenance",
      organizer:{email:"office@example.com"},creator:{email:"office@example.com"},
      start:{dateTime:"2035-08-20T14:00:00Z"},end:{dateTime:"2035-08-20T15:00:00Z"},
      updated:"2035-08-10T12:00:00Z",_calendar_base:masterUrl
    });
    const result=await f.integration.syncOutbound();
    assert.equal(result.inbound_imported,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n,1);
    assert.equal(f.remote.size,1,"Imported Google event must not be duplicated on master");
    assert.equal(f.db.prepare("SELECT google_event_id FROM calendar_outbound_links WHERE source_type='JOB'").get().google_event_id,"office-manual-1");
    const after=await f.integration.syncOutbound();
    assert.equal(after.inbound_imported,0);
    assert.equal(f.remote.size,1);
  }finally{f.close();}
});

test("migration of existing staff calendar records preserves their email and populates the new calendar id",()=>{
  const f=fixture();
  try{
    f.db.prepare("INSERT INTO staff_calendar_sync(user_id,calendar_email,calendar_id,enabled,write_enabled) VALUES('W','emre@example.com',NULL,1,0)").run();
    const row=f.integration.staffCalendarStatuses().find(item=>item.user_id==="W");
    assert.equal(row.calendar_id,"emre@example.com");
    assert.equal(row.enabled,1);
    assert.equal(row.write_enabled,0);
  }finally{f.close();}
});
test("staff calendars are read-only by default, and must be explicitly authorized for writing",async()=>{
  const f=fixture();
  try{
    addJob(f.db);
    f.db.prepare("UPDATE jobs SET assigned_technician_id='W' WHERE id=1").run();
    await connectWriter(f);
    const result=await f.integration.syncOutbound();
    assert.equal(result.created_or_updated,1);
    const target=f.db.prepare("SELECT calendar_id FROM calendar_outbound_links WHERE source_type='JOB' AND source_id='1'").all();
    assert.deepEqual(target.map(row=>row.calendar_id),["office@example.com"]);
    const current=f.integration.configureStaffCalendar("W",{calendar_id:"emre@example.com",enabled:true,write_enabled:true});
    assert.equal(current.write_enabled,1);
    const enabled=await f.integration.syncOutbound();
    assert.equal(enabled.created_or_updated,1);
    const disabled=f.integration.configureStaffCalendar("W",{calendar_id:"emre@example.com",enabled:true,write_enabled:false});
    assert.equal(disabled.write_enabled,0);
  }finally{f.close();}
});
test("a Google edit cannot bypass 30-minute job scheduling or workshop hour restrictions",async()=>{
  const f=fixture();
  try{
    addJob(f.db); await connectWriter(f); await f.integration.syncOutbound();
    const id=f.db.prepare("SELECT google_event_id FROM calendar_outbound_links WHERE source_type='JOB' AND calendar_id='office@example.com'").get().google_event_id;
    const before=f.remote.get(id);
    f.integration._test.processEvent({...before,etag:"bad-quarter",start:{dateTime:"2035-08-20T14:15:00.000Z"},
      end:{dateTime:"2035-08-20T15:15:00.000Z"}},"office@example.com");
    let record=f.db.prepare("SELECT state,last_error FROM calendar_outbound_links WHERE google_event_id=?").get(id);
    assert.equal(record.last_error,"WORK_TIME_HALF_HOUR_REQUIRED");
    f.integration._test.processEvent({...before,etag:"bad-hour",start:{dateTime:"2035-08-21T01:00:00.000Z"},
      end:{dateTime:"2035-08-21T02:00:00.000Z"}},"office@example.com");
    record=f.db.prepare("SELECT state,last_error FROM calendar_outbound_links WHERE google_event_id=?").get(id);
    assert.equal(record.last_error,"WORK_TIME_OUTSIDE_BUSINESS_HOURS");
    assert.equal(f.db.prepare("SELECT scheduled_at FROM jobs WHERE id=1").get().scheduled_at,"2035-08-20T14:00:00.000Z");
  }finally{f.close();}
});
test("Google updates propagate job description and site location without discarding other ERP fields",async()=>{
  const f=fixture();
  try{
    addJob(f.db);
    f.db.prepare("UPDATE jobs SET description='First service',site_address='Old address' WHERE id=1").run();
    await connectWriter(f); await f.integration.syncOutbound();
    const id=f.db.prepare("SELECT google_event_id FROM calendar_outbound_links WHERE source_type='JOB'").get().google_event_id;
    const first=f.remote.get(id);
    assert.equal(first.location,"Old address");
    f.integration._test.processEvent({...first,etag:"description-edited",summary:"Klavierhaus work · Tune Piano",
      description:"Revised service",location:"New address"},"office@example.com");
    const row=f.db.prepare("SELECT description,site_address FROM jobs WHERE id=1").get();
    assert.deepEqual(row,{description:"Revised service",site_address:"New address"});
  }finally{f.close();}
});

test("an admin can explicitly resolve a two-sided calendar conflict using the Google version",async()=>{
  const f=fixture();
  try{
    addJob(f.db);await connectWriter(f);await f.integration.syncOutbound();
    const id=[...f.remote.keys()][0];
    f.db.prepare("UPDATE jobs SET title='ERP locally edited' WHERE id=1").run();
    const remote={...f.remote.get(id),etag:"google-etag-8",summary:"Klavierhaus work · Google selected"};
    f.remote.set(id,remote);
    f.integration._test.processEvent(remote,"office@example.com");
    assert.equal(f.integration.outboundErrors()[0].state,"CONFLICT");
    const skipped=await f.integration.syncOutbound();
    assert.equal(skipped.created_or_updated,0,"unresolved conflicts must not be auto-overwritten");
    const resolved=await f.integration.resolveConflict({
      source_type:"JOB",source_id:"1",calendar_id:"office@example.com",decision:"GOOGLE"
    });
    assert.equal(resolved.state,"SYNCED");
    assert.equal(f.db.prepare("SELECT title FROM jobs WHERE id=1").get().title,"Google selected");
    assert.equal(f.integration.outboundErrors().length,0);
  }finally{f.close();}
});
test("an admin can explicitly resolve a two-sided calendar conflict using the ERP version with a fresh Google etag",async()=>{
  const f=fixture();
  try{
    addJob(f.db);await connectWriter(f);await f.integration.syncOutbound();
    const id=[...f.remote.keys()][0];
    f.db.prepare("UPDATE jobs SET title='ERP selected' WHERE id=1").run();
    const remote={...f.remote.get(id),etag:"google-etag-9",summary:"Klavierhaus work · Google edit"};
    f.remote.set(id,remote);
    f.integration._test.processEvent(remote,"office@example.com");
    const result=await f.integration.resolveConflict({
      source_type:"JOB",source_id:"1",calendar_id:"office@example.com",decision:"ERP"
    });
    assert.equal(result.state,"SYNCED");
    assert.equal(f.db.prepare("SELECT title FROM jobs WHERE id=1").get().title,"ERP selected");
    assert.equal(f.remote.get(id).summary,"Klavierhaus work · ERP selected");
    assert.ok(f.requests.some(req=>req.method==="PATCH"&&req.headers["If-Match"]==="google-etag-9"));
  }finally{f.close();}
});

test("closed website requests are removed from Google without deleting manually imported Google events",async()=>{
  const f=fixture();
  try{
    f.db.prepare("INSERT INTO website_contact_leads(id,lead_type,name,email,preferred_time) VALUES('lead-end','SERVICE_CALLBACK','Example Customer','customer@example.com','2035-08-20T14:00:00Z')").run();
    await connectWriter(f);
    const first=await f.integration.syncOutbound();
    assert.equal(first.created_or_updated,1);
    assert.equal(f.remote.size,1);
    f.db.prepare("UPDATE website_contact_leads SET status='CLOSED' WHERE id='lead-end'").run();
    const ended=await f.integration.syncOutbound();
    assert.equal(ended.deleted,1);
    assert.equal(f.remote.size,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM calendar_outbound_links").get().n,0);
    assert.ok(f.requests.some(req=>req.method==="DELETE"&&req.headers["If-Match"]==="etag-1"));
  }finally{f.close();}
});
