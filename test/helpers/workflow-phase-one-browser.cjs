"use strict";
// Run on disposable local data only. DB_PATH must name a dedicated test database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const Database=require('better-sqlite3');
const jwt=require('jsonwebtoken');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
if(!process.env.DB_PATH||process.env.PHASE1_BROWSER_TEST!=='YES')throw Error('Explicit disposable DB_PATH and PHASE1_BROWSER_TEST=YES required');
const output=process.env.PHASE1_TEST_OUTPUT||path.dirname(process.env.DB_PATH);
const secret='isolated-browser-test-secret-at-least-32-characters';
Object.assign(process.env,{JWT_SECRET:secret,UPLOAD_DIR:path.join(output,'browser-uploads'),BACKUP_DIR:path.join(output,'browser-backups'),PORT:'0'});
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const setup=new Database(process.env.DB_PATH);
for(const [id,role,flag] of [['E-SA','ADMIN',1],['E-A','ADMIN',0],['E-M','MANAGER',0],['E-W','WORKER',0]])setup.prepare("INSERT OR IGNORE INTO users(id,name,email,password_hash,role,status,is_superadmin) VALUES(?,?,?,'browser-test-only',?,'Active',?)").run(id,id,`${id}@example.invalid`,role,flag);
setup.close();
const {startServer,db}=require('../../server/index');
const server=startServer(0);
let browser;
const consoleErrors=[],requests=[];
async function main(){
 await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.PHASE1_CHROMIUM||undefined,args:['--no-sandbox']});
 const runs=Number(process.env.PHASE1_BROWSER_RUNS||1);
 for(let run=1;run<=runs;run++){
  const mode=(run-1)%3,viewport=mode===0?{width:1440,height:900}:mode===1?{width:390,height:844}:{width:820,height:1180};
  const id=mode===0?'E-SA':mode===1?'E-A':'E-M',role=id==='E-SA'?'SUPERADMIN':id==='E-A'?'ADMIN':'MANAGER';
  db.prepare('DELETE FROM notification_snooze_log WHERE user_id LIKE ?').run('E-%');
  for(let j=1;j<=3;j++)db.prepare("INSERT INTO jobs(id,title,job_type,assigned_to,assigned_user_id,status,start_time,end_time,planned_amount,payment_method) VALUES(?,?,'Standalone','E-A','E-A','Open',?,?,25,'Cash') ON CONFLICT(id) DO UPDATE SET status='Open',start_time=excluded.start_time,end_time=excluded.end_time").run(`E-J${j}`,`Phase I test ${j}`,`${date}T0${j+5}:00`,`${date}T0${j+5}:30`);
  const token=jwt.sign({id,name:id,role,session_version:0},secret,{expiresIn:'1h'});
  const context=await browser.newContext({viewport,hasTouch:mode!==0,isMobile:mode===1});
  await context.addInitScript(({token,id,role})=>{sessionStorage.setItem('kh_token',token);sessionStorage.setItem('kh_user',JSON.stringify({id,name:id,role,is_superadmin:role==='SUPERADMIN'?1:0}));localStorage.setItem('workflow_show_previous','0');},{token,id,role});
  const page=await context.newPage();page.on('pageerror',e=>consoleErrors.push({run,error:e.message}));page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)requests.push({run,status:r.status(),url:r.url()});});
  await page.goto(base,{waitUntil:'networkidle'});
  await page.waitForSelector('.workflow-phase-one .workflow-stage-heading');
  assert.equal(await page.locator('.workflow-stage-heading').count(),7);
  assert.equal(await page.locator('.workflow-details-modal-overlay,.workflow-drawer,[data-workflow-create]').count(),0);
  assert.equal(await page.locator('.workflow-new-btn').isDisabled(),true);
  assert.equal(await page.locator('.workflow-board-scroll').isVisible(),true);
  if(mode===0){
   await page.locator('.workflow-stage-settings').click();await page.locator('#workflowPhaseSettings').waitFor();
   const name=`Phase ${run} saved`;await page.locator('[name="phase_name_en"]').first().fill(name);await page.locator('[data-phase-save]').click();await page.waitForFunction(()=>document.querySelector('#modal').classList.contains('hidden'));
   assert.equal(db.prepare("SELECT name_en FROM workshop_phase_definitions WHERE code='INBOUND'").get().name_en,name);
   await page.waitForSelector('#floating-notifications-container [data-unified-notification-card]');
   const layout=await page.locator('#floating-notifications-container').evaluate(el=>({x:el.getBoundingClientRect().x,w:el.getBoundingClientRect().width,pointer:getComputedStyle(el).pointerEvents,z:getComputedStyle(el).zIndex}));assert.ok(layout.x>900);assert.equal(layout.w,380);assert.equal(layout.pointer,'none');
   const card=page.locator('#floating-notifications-container [data-unified-notification-card]').first();assert.equal(Math.round((await card.boundingBox()).height),320);
   const buttons=await card.locator('[data-unified-notification-action]').all();assert.equal(buttons.length,3);const cardBox=await card.boundingBox();for(const button of buttons){const b=await button.boundingBox();assert.ok(b.y+b.height<=cardBox.y+cardBox.height+1);}
   await card.locator('[data-unified-notification-action="reschedule"]').click();await page.waitForSelector('[data-unified-calendar-host] .admin-date-picker-popover');
   const pop=await page.locator('#unified-notification-reschedule-popover').boundingBox(),cal=await page.locator('[data-unified-calendar-host] .admin-date-picker-popover').boundingBox();assert.ok(pop.x>=layout.x-1);assert.ok(pop.width<=layout.w);assert.ok(cal.x>=pop.x&&cal.x+cal.width<=pop.x+pop.width+1);
   await page.locator('#unifiedRescheduleReason').fill('Browser verified reschedule');
   await page.locator('[data-date-picker-day]').first().click();
   // Use the visible time control, then set the chosen date to today through its real input event.
   const time=page.locator('[data-unified-calendar-host] [data-date-picker-time]');await time.selectOption('12:00');
   await page.locator('#unifiedRescheduleDate').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},`${date}T12:00`);
   await page.screenshot({path:path.join(output,`phase1-desktop-${run}.png`),fullPage:false});
   await page.locator('[data-unified-reschedule-action="save"]').click();await page.waitForSelector('#unified-notification-reschedule-popover',{state:'detached'});
   assert.equal(db.prepare("SELECT start_time FROM jobs WHERE id='E-J1'").get().start_time,`${date}T12:00`);
   await page.waitForSelector('[data-unified-notification-action="snooze-all"]');await page.locator('[data-unified-notification-action="snooze-all"]').click();
   await page.waitForFunction(()=>document.querySelectorAll('#floating-notifications-container [data-unified-notification-card]').length===0);
   assert.equal(db.prepare('SELECT count(*) n FROM notification_snooze_log WHERE user_id=?').get(id).n,3);
   assert.equal(db.prepare("SELECT count(*) n FROM notification_snooze_log WHERE user_id='E-M'").get().n,0);
  }else{
   const before=await page.locator('.workflow-board-scroll').evaluate(el=>({left:el.scrollLeft,width:el.clientWidth,total:el.scrollWidth}));assert.ok(before.total>before.width);
   // Real Chromium touch gesture on the horizontally scrollable empty seven-phase shell.
   const session=await context.newCDPSession(page);const box=await page.locator('.workflow-board-scroll').boundingBox();const y=Math.min(viewport.height-80,box.y+50);
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:viewport.width-35,y}]});
   for(let n=1;n<=8;n++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:viewport.width-35-n*25,y}]});
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(350);
   assert.ok(await page.locator('.workflow-board-scroll').evaluate(el=>el.scrollLeft)>before.left,'Shell horizontal swipe');
   await page.screenshot({path:path.join(output,`phase1-${mode===1?'mobile':'tablet'}-${run}.png`),fullPage:false});
  }
  assert.deepEqual(consoleErrors.filter(e=>e.run===run),[],'Browser runtime errors');assert.deepEqual(requests.filter(e=>e.run===run),[],'API errors');
  console.log(JSON.stringify({run,viewport,role,dom:'PASS',api:'PASS',sqlite:'PASS'}));await context.close();
 }
}
main().catch(e=>{console.error(e.stack);console.error(JSON.stringify({consoleErrors,requests}));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));db.close();});
