"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const Database = require("better-sqlite3");
const { registerWebsiteContentRoutes } = require("../server/website-content");
const { registerWebsiteCatalogRoutes } = require("../server/website-catalog");
const { registerPianoBrandRoutes } = require("../server/website-brand-registry");
const { registerWebsitePresentationRoutes } = require("../server/website-site-presentation");
const { createApp } = require("../website/server/index");
const { buildSnapshot, restoreSnapshot } = require("../server/website-backup-reset");

const root = path.resolve(__dirname,"..");
const read = (filename) => fs.readFileSync(path.join(root,filename),"utf8");
async function listen(app) {
  const server = app.listen(0,"127.0.0.1");
  await new Promise((resolve) => server.once("listening",resolve));
  return { server, origin:"http://127.0.0.1:"+server.address().port };
}
async function withApps(callback) {
  const db = new Database(":memory:");
  db.exec(read("server/schema.sql"));
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,is_superadmin) VALUES('A','Admin','admin@example.test','x','ADMIN','Active',1)").run();
  db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES('finance_company_address_line1','INVOICE REGISTERED ADDRESS','test')").run();
  const app = express();
  app.use(express.json());
  const logs=[];
  const auth = (req,_res,next) => { req.user = { id:"A",name:"Admin",role:String(req.headers["x-role"]||"").toLowerCase()==="worker"?"WORKER":"ADMIN" }; next(); };
  const permit = (...roles) => (req,res,next) => roles.includes(req.user?.role) ? next() : res.status(403).json({error:"FORBIDDEN"});
  const common = {app,db,auth,permit,audit:(...args)=>logs.push(args)};
  registerWebsitePresentationRoutes(common);
  registerPianoBrandRoutes({...common,erpBaseUrl:"https://erp.example.test"});
  registerWebsiteContentRoutes({...common,websiteImageDir:path.join(root,"website","public"),websiteBaseUrl:"https://klavierhaus.com"});
  registerWebsiteCatalogRoutes({...common,erpBaseUrl:"https://erp.example.test"});
  const erp = await listen(app);
  const web = await listen(createApp({eventApiBaseUrl:erp.origin,baseUrl:"https://klavierhaus.com",allowIndexing:false}));
  async function request(endpoint,{method="GET",body=null,role="ADMIN"}={}) {
    const response=await fetch(erp.origin+endpoint,{method,headers:{"Content-Type":"application/json","x-role":role},body:body===null?undefined:JSON.stringify(body)});
    const result=await response.json().catch(()=>null);
    return {status:response.status,body:result,headers:response.headers};
  }
  async function page(url) {
    const response=await fetch(web.origin+url);
    return {status:response.status,html:await response.text()};
  }
  try {await callback({db,request,page,logs});}
  finally {
    await new Promise((resolve)=>web.server.close(resolve));
    await new Promise((resolve)=>erp.server.close(resolve));
    db.close();
  }
}
const piano = (brand,title,images=[]) => ({
  brand,title_en:title,title_hu:title+" HU",model:"214",image_url:"/uploads/website/hero.jpg",
  gallery:images.map((u,index)=>({url:u,alt_en:"Photo "+index,alt_hu:"Fotó "+index})),
  published:true,availability_status:"AVAILABLE"
});

test("CMS creates and renames standalone brands, preserves slugs and existing piano relationships",async()=>{
  await withApps(async({db,request,page})=>{
    const before=await request("/api/website-piano-brands");
    assert.deepEqual(before.body.items,[]);
    const created=await request("/api/website-piano-brands",{method:"POST",body:{name:"Yamaha",cover_url:"/uploads/website/yamaha.jpg"}});
    assert.equal(created.status,201,JSON.stringify(created.body));
    assert.equal(created.body.slug,"yamaha");
    const duplicate=await request("/api/website-piano-brands",{method:"POST",body:{name:"Yamaha"}});
    assert.equal(duplicate.status,409);
    const cms=await request("/api/website-content/pages");
    assert.ok(cms.body.pages.some(x=>x.page_key==="piano-brand--yamaha"));
    const emptyBrand=await page("/pianos/yamaha");
    assert.equal(emptyBrand.status,200,"Brand pages must exist before piano stock is added");
    assert.match(emptyBrand.html,/Yamaha/);
    const newPiano=await request("/api/showroom-pianos",{method:"POST",body:piano("Yamaha","Yamaha C7")});
    assert.equal(newPiano.status,201,JSON.stringify(newPiano.body));
    const renamed=await request("/api/website-piano-brands/yamaha",{method:"PUT",body:{name:"Yamaha Grand Collection",cover_url:"/uploads/website/new-cover.jpg"}});
    assert.equal(renamed.status,200);
    assert.equal(renamed.body.slug,"yamaha","Rebranding must not break public URLs");
    assert.equal(db.prepare("SELECT brand FROM website_showroom_pianos WHERE id=?").get(newPiano.body.id).brand,"Yamaha Grand Collection");
    assert.equal((await page("/pianos/yamaha")).status,200);
    const listing=await request("/api/public/showroom-pianos?lang=en");
    assert.equal(listing.body[0].brand_slug,"yamaha");
    assert.equal(listing.body[0].brand_label,"Yamaha Grand Collection");
    const adminCount=await request("/api/website-piano-brands");
    assert.equal(adminCount.body.items[0].piano_count,1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM pianos").get().n,0,"Customer-owned ERP pianos must remain untouched");
  });
});

test("archiving a piano brand hides its instruments and is reversible without deleting records",async()=>{
  await withApps(async({db,request,page})=>{
    assert.equal((await request("/api/website-piano-brands",{method:"POST",body:{name:"Fazioli"}})).status,201);
    const created=await request("/api/showroom-pianos",{method:"POST",body:piano("Fazioli","Fazioli F212")});
    assert.equal(created.status,201);
    assert.equal((await page("/pianos/fazioli")).status,200);
    assert.equal((await request("/api/website-piano-brands/fazioli",{method:"DELETE"})).status,200);
    assert.equal(db.prepare("SELECT count(*) AS n FROM website_showroom_pianos").get().n,1);
    assert.equal((await request("/api/public/showroom-pianos?lang=en")).body.length,0);
    assert.equal((await page("/pianos/fazioli")).status,404);
    assert.equal((await request("/api/public/showroom-pianos/"+created.body.slug_en)).status,404);
    const restored=await request("/api/website-piano-brands/fazioli/restore",{method:"POST",body:{}});
    assert.equal(restored.status,200);
    assert.equal((await page("/pianos/fazioli")).status,200);
    assert.equal((await request("/api/public/showroom-pianos?lang=en")).body.length,1);
  });
});

test("new empty piano brands join existing CMS brand ordering, preserving positions and visibility",async()=>{
  await withApps(async({request,page})=>{
    for(const name of ["Steinway & Sons","Bösendorfer","Art Case"]) {
      assert.equal((await request("/api/showroom-pianos",{method:"POST",body:piano(name,name+" 214")})).status,201);
    }
    const brand=await request("/api/website-piano-brands",{method:"POST",body:{name:"Kawai"}});
    assert.equal(brand.status,201);
    const order=await request("/api/website-catalog-order/pianos");
    assert.equal(order.body.items.length,4);
    const ids=["kawai","art-case","bosendorfer","steinway"];
    const saved=await request("/api/website-catalog-order/pianos",{method:"PUT",body:{ids}});
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.deepEqual(saved.body.items.map(x=>x.id),ids);
    const homepage=await page("/");
    assert.equal(homepage.status,200);
    const positions=ids.map(x=>homepage.html.indexOf('href="/pianos/'+x+'"'));
    assert.ok(positions.every(x=>x>=0),JSON.stringify(positions));
    assert.deepEqual(positions.slice().sort((a,b)=>a-b),positions);
    const pianoPage=await page("/pianos");
    const positionsPage=ids.map(x=>pianoPage.html.indexOf('href="/pianos/'+x+'"'));
    assert.deepEqual(positionsPage.slice().sort((a,b)=>a-b),positionsPage);
  });
});

test("navigation order and EN/HU names are applied to public header without altering routes",async()=>{
  await withApps(async({db,request,page})=>{
    const before=await request("/api/website-presentation");
    assert.equal(before.status,200);
    assert.equal(before.body.navigation.length,5);
    const items=before.body.navigation.map(row=>({...row,label_en:"New "+row.key,label_hu:"Új "+row.key})).reverse();
    const result=await request("/api/website-presentation/navigation",{method:"PUT",body:{items}});
    assert.equal(result.status,200,JSON.stringify(result.body));
    const en=await request("/api/public/website-content/global?lang=en");
    const hu=await request("/api/public/website-content/global?lang=hu");
    assert.deepEqual(en.body.content.nav.map(row=>row.key),items.map(row=>row.key));
    assert.deepEqual(hu.body.content.nav.map(row=>row.key),items.map(row=>row.key));
    assert.equal(en.body.content.nav[0].label,"New our");
    assert.equal(hu.body.content.nav[0].label,"Új our");
    for(const url of ["/","/hu/"]) {
      const html=(await page(url)).html;
      assert.ok(html.indexOf("New our")>=0 || html.indexOf("Új our")>=0);
      const labels=items.map(row=>url==="/"?"New "+row.key:"Új "+row.key);
      const positions=labels.map(label=>html.indexOf(">"+label+"</a>"));
      assert.ok(positions.every(x=>x>=0),JSON.stringify(positions));
      assert.deepEqual(positions.slice().sort((a,b)=>a-b),positions);
    }
    const bad=await request("/api/website-presentation/navigation",{method:"PUT",body:{items:[items[0],items[0]]}});
    assert.equal(bad.status,400);
    const noAuth=await request("/api/website-presentation/navigation",{method:"PUT",body:{items},role:"WORKER"});
    assert.equal(noAuth.status,403);
    assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='finance_company_address_line1'").get().setting_value,"INVOICE REGISTERED ADDRESS");
  });
});

test("footer contact and social links update bilingual contact and venue without changing invoice settings",async()=>{
  await withApps(async({db,request,page})=>{
    const data={
      display_name:"Klavierhaus Gallery",venue_name:"Klavierhaus Salon",
      street_address:"123 Gallery Avenue",address_line2:"Second floor",
      city:"New York",region:"NY",postal_code:"10019",country:"US",
      phone:"+1 (212) 333-4444",email:"gallery@example.com",
      social:{instagram:"https://www.instagram.com/example",facebook:"",youtube:"https://www.youtube.com/@example",linkedin:"",tiktok:""}
    };
    const saved=await request("/api/website-presentation/contact",{method:"PUT",body:data});
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    const en=await request("/api/public/website-content/global?lang=en");
    assert.equal(en.body.content.brand.addressLine1,"Klavierhaus Salon");
    assert.equal(en.body.content.brand.emailDisplay,"gallery@example.com");
    assert.equal(en.body.content.social_links.length,2);
    const contact=await request("/api/public/website-content/contact?lang=en");
    assert.match(contact.body.content.sections.find(x=>x.type==="contact").details[0].value,/123 Gallery Avenue/);
    for(const url of ["/","/hu/","/contact","/hu/kapcsolat"]) {
      const response=await page(url);
      assert.equal(response.status,200);
      assert.match(response.html,/gallery@example.com/);
      assert.match(response.html,/123 Gallery Avenue/);
      assert.match(response.html,/instagram.com\/example/);
      assert.match(response.html,/footer-social-links/);
    }
    const invalid=await request("/api/website-presentation/contact",{method:"PUT",body:{...data,social:{instagram:"javascript:alert(1)"}}});
    assert.equal(invalid.status,400);
    assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='finance_company_address_line1'").get().setting_value,"INVOICE REGISTERED ADDRESS");
    const snapshot=buildSnapshot(db,{scope:"all"});
    assert.ok(snapshot.settings.some(x=>x.setting_key==="website_public_contact_v1"));
    assert.ok(snapshot.settings.some(x=>x.setting_key==="website_navigation_presentation_v1")===false);
    db.prepare("DELETE FROM app_settings WHERE setting_key='website_public_contact_v1'").run();
    restoreSnapshot(db,snapshot);
    assert.equal((await request("/api/website-presentation")).body.contact.email,data.email);
  });
});

test("piano detail images open interactive full-screen viewer and accept portrait and landscape without cropping",async()=>{
  await withApps(async({request,page})=>{
    const created=await request("/api/showroom-pianos",{method:"POST",body:piano("Bösendorfer","Bösendorfer 214",[
      "/uploads/website/portrait-214.jpg","/uploads/website/landscape-214.jpg"
    ])});
    assert.equal(created.status,201);
    const response=await page("/pianos/"+created.body.slug_en);
    assert.equal(response.status,200);
    assert.match(response.html,/class="gallery-main-trigger"/);
    assert.match(response.html,/data-gallery-open/);
    assert.match(response.html,/portrait-214\.jpg/);
    assert.match(response.html,/landscape-214\.jpg/);
    assert.match(response.html,/assets\/gallery-zoom\.js/);
    const stylesheet=read("website/public/styles.css");
    assert.match(stylesheet,/\.detail-gallery \.gallery-thumb-trigger img\{[^}]*object-fit:contain/);
    assert.match(stylesheet,/\.piano-lightbox__image\{[^}]*object-fit:contain/);
    const client=read("website/public/gallery-zoom.js");
    for(const token of ["showModal","pointerdown","pointermove","wheel","ArrowLeft","ArrowRight","zoomTo","touch-action"]) {
      assert.ok(client.includes(token)||stylesheet.includes(token),"Missing gallery ability: "+token);
    }
  });
});

test("CMS editors expose brand, navigation and footer controls; booking logic is unchanged",()=>{
  const ui=read("public/cms-site-settings.js"),bridge=read("public/v6.js"),index=read("public/index.html");
  assert.match(ui,/Manage Piano Brands/);
  assert.match(ui,/Add piano brand/);
  assert.match(ui,/Save navigation/);
  assert.match(ui,/Save public contact & footer/);
  assert.match(bridge,/v6CmsMountSiteControls\(state.cmsPage\)/);
  assert.match(index,/cms-site-settings\.js/);
  assert.doesNotMatch(ui,/private-appointments|slotAvailability/);
});


test("public brand endpoint preserves previously displayed piano order when no CMS preference exists",async()=>{
  await withApps(async({request,page})=>{
    // Insert the records in the reverse order from their actual published ranking.
    for(const [brand,title,order,featured] of [
      ["Art Case","Art Case Gold",3,false],
      ["Steinway & Sons","Steinway B",2,false],
      ["Bösendorfer","Bösendorfer 214",1,true]
    ]){
      const created=await request("/api/showroom-pianos",{method:"POST",body:{...piano(brand,title),sort_order:order,featured}});
      assert.equal(created.status,201);
    }
    const pianos=await request("/api/public/showroom-pianos?lang=en");
    const expected=[...new Set(pianos.body.map(row=>row.brand_slug))];
    assert.deepEqual(expected,["bosendorfer","steinway","art-case"]);
    const brands=await request("/api/public/piano-brands");
    assert.deepEqual(brands.body.map(row=>row.slug),expected,"Public brand listing must inherit the previous showroom order");
    for(const route of ["/","/pianos"]){
      const html=(await page(route)).html;
      const positions=expected.map(slug=>html.indexOf('href="/pianos/'+slug+'"'));
      assert.ok(positions.every(x=>x>=0),JSON.stringify(positions));
      assert.deepEqual(positions.slice().sort((a,b)=>a-b),positions);
    }
  });
});


test("fullscreen gallery loads original photos, fits the entire viewport and calculates drag bounds from actual image geometry", () => {
  const client=read("website/public/gallery-zoom.js");
  const css=read("website/public/styles.css");
  const server=read("website/server/index.js");
  const cms=read("public/v6.js");
  assert.match(server,/data-gallery-full/);
  assert.match(server,/gallery-zoom\.js\?v=\$\{VERSION\}-fitpan-v3/);
  assert.match(client,/element\.dataset\.galleryFull/);
  assert.match(client,/image\.src = photos\[current\]\.url/);
  assert.match(client,/Math\.min\(width \/ image\.naturalWidth, height \/ image\.naturalHeight, 1\)/);
  assert.match(client,/fittedWidth \* scale - stage\.clientWidth/);
  assert.match(client,/fittedHeight \* scale - stage\.clientHeight/);
  assert.match(client,/source\.textContent = image\.naturalWidth/);
  assert.match(client,/followMouse\(event\)/);
  assert.match(client,/function zoomTo\(next, point = null\)/);
  assert.match(client,/function pointerFinished/);
  assert.match(client,/new Set\(\[\(current \+ 1\)/);
  assert.match(css, /\.piano-lightbox__image\{[^}]*object-fit:contain/);
  assert.match(css, /\.piano-lightbox__stage\{[^}]*touch-action:none/);
  assert.match(css, /\.gallery-main-trigger:hover>img/);
  assert.match(css, /\.piano-lightbox__strip\{/);
  assert.match(cms,/2000 pixeles/);
});
