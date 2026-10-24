"use strict";

const { pianoBrandSlug, brandGroups, savedBrandOrder } = require("./website-display-order");

function trim(value, max = 180) { return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max); }
function brandRows(db) { return db.prepare("SELECT * FROM website_piano_brands ORDER BY created_at,slug").all(); }
function seedBrands(db) {
  const existing = db.prepare("SELECT DISTINCT brand FROM website_showroom_pianos WHERE trim(brand)<>'' ORDER BY lower(brand)").all();
  const insert = db.prepare("INSERT OR IGNORE INTO website_piano_brands(slug,name) VALUES(?,?)");
  for (const row of existing) {
    const slug = pianoBrandSlug(row.brand);
    if (slug) insert.run(slug, trim(row.brand));
  }
}
function brandFor(db, label) {
  const clean = trim(label);
  return db.prepare("SELECT * FROM website_piano_brands WHERE name=? COLLATE NOCASE").get(clean)
    || db.prepare("SELECT * FROM website_piano_brands WHERE slug=?").get(pianoBrandSlug(clean)) || null;
}
function activePianoRows(db) {
  const rows = db.prepare("SELECT * FROM website_showroom_pianos WHERE published=1 AND availability_status<>'HIDDEN' ORDER BY featured DESC,sort_order,created_at,id").all();
  return rows.filter((row) => !brandFor(db, row.brand)?.archived).map((row) => {
    const brand = brandFor(db, row.brand);
    return { ...row, brand_slug: brand?.slug || pianoBrandSlug(row.brand), brand_label: brand?.name || row.brand };
  });
}
function visibleBrandRows(db) {
  const brands = brandRows(db).filter((row) => !row.archived);
  return brands.map((row) => ({ ...row, count: db.prepare("SELECT COUNT(*) AS n FROM website_showroom_pianos WHERE brand=? COLLATE NOCASE AND published=1 AND availability_status<>'HIDDEN'").get(row.name).n }));
}
function safeCover(value) {
  const text=trim(value,1000);
  if (!text || text.startsWith("/uploads/") || /^https:\/\/[^\s]+$/i.test(text)) return text;
  throw new Error("INVALID_BRAND_COVER_URL");
}
function validateName(value) {
  const name=trim(value);
  if (name.length < 2 || name.length > 120 || /[<>]/.test(name)) throw new Error("INVALID_BRAND_NAME");
  return name;
}
function registerPianoBrandRoutes({ app, db, auth, permit, audit, erpBaseUrl="" }) {
  const admin=permit("ADMIN");
  seedBrands(db);
  app.get("/api/website-piano-brands",auth,admin,(_req,res)=>{
    const values=brandRows(db).map(row=>({ ...row, piano_count:db.prepare("SELECT COUNT(*) AS n FROM website_showroom_pianos WHERE brand=? COLLATE NOCASE").get(row.name).n }));
    res.setHeader("Cache-Control","no-store");res.json({items:values});
  });
  app.get("/api/public/piano-brands",(_req,res)=>{
    const active=visibleBrandRows(db);
    res.setHeader("Cache-Control","no-store");
    const preference=new Map(savedBrandOrder(db).map((slug,index)=>[slug,index]));
    // Preserve the previous customer-facing order when no explicit CMS sort was saved.
    // Registry insertion order can differ (e.g. pre-existing brands are seeded alphabetically).
    const visibleGroups=brandGroups(activePianoRows(db),savedBrandOrder(db));
    const firstOccurrence=new Map(visibleGroups.map((row,index)=>[row.id,index]));
    active.sort((a,b)=>(preference.get(a.slug)??Infinity)-(preference.get(b.slug)??Infinity)
      ||(firstOccurrence.get(a.slug)??Infinity)-(firstOccurrence.get(b.slug)??Infinity)
      ||a.created_at.localeCompare(b.created_at)||a.slug.localeCompare(b.slug));
    res.json(active.map(row=>({slug:row.slug,name:row.name,
      cover_url:row.cover_url.startsWith("/uploads/")&&erpBaseUrl?(erpBaseUrl.endsWith("/")?erpBaseUrl.slice(0,-1):erpBaseUrl)+row.cover_url:row.cover_url,count:row.count})));
  });
  app.post("/api/website-piano-brands",auth,admin,(req,res)=>{
    try{
      const name=validateName(req.body?.name),slug=pianoBrandSlug(name),cover=safeCover(req.body?.cover_url);
      if(!slug)throw new Error("INVALID_BRAND_NAME");
      if(db.prepare("SELECT 1 FROM website_piano_brands WHERE slug=? OR name=? COLLATE NOCASE").get(slug,name))return res.status(409).json({error:"BRAND_ALREADY_EXISTS"});
      db.prepare("INSERT INTO website_piano_brands(slug,name,cover_url) VALUES(?,?,?)").run(slug,name,cover);
      const row=db.prepare("SELECT * FROM website_piano_brands WHERE slug=?").get(slug);
      audit(req,"CREATE","website_piano_brands",slug,null,row,1,"Public piano brand created");
      res.status(201).json(row);
    }catch(error){res.status(400).json({error:error.message});}
  });
  app.put("/api/website-piano-brands/:slug",auth,admin,(req,res)=>{
    const current=db.prepare("SELECT * FROM website_piano_brands WHERE slug=?").get(req.params.slug);
    if(!current)return res.status(404).json({error:"BRAND_NOT_FOUND"});
    try{
      const name=validateName(req.body?.name ?? current.name),cover=safeCover(req.body?.cover_url ?? current.cover_url);
      if(db.prepare("SELECT 1 FROM website_piano_brands WHERE name=? COLLATE NOCASE AND slug<>?").get(name,current.slug))return res.status(409).json({error:"BRAND_ALREADY_EXISTS"});
      const change=db.transaction(()=>{
        db.prepare("UPDATE website_piano_brands SET name=?,cover_url=?,updated_at=CURRENT_TIMESTAMP WHERE slug=?").run(name,cover,current.slug);
        // Rename all connected showroom records, never customer-owned ERP pianos.
        db.prepare("UPDATE website_showroom_pianos SET brand=?,updated_at=CURRENT_TIMESTAMP WHERE brand=? COLLATE NOCASE").run(name,current.name);
        return db.prepare("SELECT * FROM website_piano_brands WHERE slug=?").get(current.slug);
      })();
      audit(req,"UPDATE","website_piano_brands",current.slug,current,change,1,"Public piano brand renamed");
      res.json(change);
    }catch(error){res.status(400).json({error:error.message});}
  });
  app.delete("/api/website-piano-brands/:slug",auth,admin,(req,res)=>{
    const before=db.prepare("SELECT * FROM website_piano_brands WHERE slug=?").get(req.params.slug);
    if(!before)return res.status(404).json({error:"BRAND_NOT_FOUND"});
    db.prepare("UPDATE website_piano_brands SET archived=1,updated_at=CURRENT_TIMESTAMP WHERE slug=?").run(before.slug);
    const after=db.prepare("SELECT * FROM website_piano_brands WHERE slug=?").get(before.slug);
    audit(req,"ARCHIVE","website_piano_brands",before.slug,before,after,1,"Public piano brand archived; piano records retained");
    res.json({ok:true,archived:true,slug:before.slug});
  });
  app.post("/api/website-piano-brands/:slug/restore",auth,admin,(req,res)=>{
    const before=db.prepare("SELECT * FROM website_piano_brands WHERE slug=?").get(req.params.slug);
    if(!before)return res.status(404).json({error:"BRAND_NOT_FOUND"});
    db.prepare("UPDATE website_piano_brands SET archived=0,updated_at=CURRENT_TIMESTAMP WHERE slug=?").run(before.slug);
    const after=db.prepare("SELECT * FROM website_piano_brands WHERE slug=?").get(before.slug);
    audit(req,"RESTORE","website_piano_brands",before.slug,before,after,1,"Public piano brand restored");
    res.json(after);
  });
}
module.exports={ seedBrands,brandRows,brandFor,activePianoRows,visibleBrandRows,registerPianoBrandRoutes };
