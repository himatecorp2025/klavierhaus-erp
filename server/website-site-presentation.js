"use strict";

// Website-only contact details: deliberately unrelated to finance_company_* invoice fields.
const { globalCopy } = require("../website/server/site-content");
const NAV_KEY="website_navigation_presentation_v1";
const CONTACT_KEY="website_public_contact_v1";
const SOCIAL_KEYS=Object.freeze(["instagram","facebook","youtube","linkedin","tiktok"]);
const NAV_KEYS=Object.freeze(globalCopy.en.nav.map(row=>row.key));

function clean(v,max=350) {return String(v??"").replace(/\u0000/g,"").trim().slice(0,max);}
function readSetting(db,key) {
  const raw=db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(key)?.setting_value;
  try{return raw?JSON.parse(raw):null;}catch(_error){return null;}
}
function writeSetting(db,key,value,actor) {
  db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").run(key,JSON.stringify(value),actor);
}
function initialNav(db) {
  const documentFor=(language)=>{
    const row=db.prepare("SELECT content_json FROM website_content_pages WHERE page_key='global' AND language=?").get(language);
    try{return JSON.parse(row?.content_json||"null")?.nav||[];}catch(_error){return [];}
  };
  const en=documentFor("en"),hu=documentFor("hu");
  return NAV_KEYS.map(key=>{
    const enRow=en.find(x=>x?.key===key)||globalCopy.en.nav.find(x=>x.key===key);
    const huRow=hu.find(x=>x?.key===key)||globalCopy.hu.nav.find(x=>x.key===key);
    return {key,label_en:clean(enRow?.label||key,80),label_hu:clean(huRow?.label||key,80)};
  });
}
function navigation(db) {return readSetting(db,NAV_KEY)||initialNav(db);}
function normalizeNavigation(value) {
  if(!Array.isArray(value)||value.length!==NAV_KEYS.length||new Set(value.map(x=>x?.key)).size!==NAV_KEYS.length||value.some(x=>!NAV_KEYS.includes(x?.key)))throw new Error("INVALID_NAVIGATION_ITEMS");
  return value.map(item=>{
    const label_en=clean(item.label_en,80),label_hu=clean(item.label_hu,80);
    if(!label_en||!label_hu||/[<>]/.test(label_en+label_hu))throw new Error("INVALID_NAVIGATION_LABEL");
    return {key:item.key,label_en,label_hu};
  });
}
function initialContact() {
  const b=globalCopy.en.brand;
  return {display_name:b.name||"Klavierhaus",venue_name:"Klavierhaus Showroom",
    street_address:b.schemaStreetAddress||"",address_line2:"",
    city:b.schemaLocality||"",region:b.schemaRegion||"",postal_code:b.schemaPostalCode||"",country:b.schemaCountry||"US",
    phone:b.phoneDisplay||"",email:b.emailDisplay||"",social:Object.fromEntries(SOCIAL_KEYS.map(x=>[x,""]))};
}
function publicContact(db){return readSetting(db,CONTACT_KEY)||initialContact();}
function normalizeContact(input) {
  if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("INVALID_CONTACT");
  const fields=["display_name","venue_name","street_address","address_line2","city","region","postal_code","country","phone","email"];
  const contact=Object.fromEntries(fields.map(key=>[key,clean(input[key],key==="email"?320:250)]));
  if(!contact.display_name||!contact.street_address||!contact.city||!contact.email||!contact.phone)throw new Error("REQUIRED_PUBLIC_CONTACT_FIELDS");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))throw new Error("INVALID_PUBLIC_EMAIL");
  if(!/^[+\d(][\d ()+.\-]{5,35}$/.test(contact.phone))throw new Error("INVALID_PUBLIC_PHONE");
  const links={};
  for(const key of SOCIAL_KEYS) {
    const value=clean(input.social?.[key],500);
    if(value) {
      try {
        const uri=new URL(value);
        if(uri.protocol!=="https:"||uri.username||uri.password||!uri.hostname.includes("."))throw new Error();
      } catch(_error) {throw new Error("INVALID_SOCIAL_LINK");}
    }
    links[key]=value;
  }
  contact.social=links;
  return contact;
}
function applySitePresentation(db,pageKey,language,content) {
  if(pageKey!=="global"&&pageKey!=="contact")return content;
  const contact=publicContact(db);
  if(pageKey==="global") {
    const nav=navigation(db).map(item=>({key:item.key,label:item["label_"+language]}));
    const b=content.brand||{};
    const phone=contact.phone.replace(/[^+\d]/g,"");
    return {...content,nav,brand:{...b,
      name:contact.display_name,
      addressLine1:contact.venue_name||contact.display_name,
      addressLine2:[contact.street_address,contact.address_line2,contact.city,contact.region,contact.postal_code,contact.country].filter(Boolean).join(", "),
      phoneDisplay:contact.phone,phoneHref:"tel:"+phone,
      emailDisplay:contact.email,emailHref:"mailto:"+contact.email,
      footerLocations:[contact.city,contact.region,contact.country].filter(Boolean).join(" · "),
      schemaStreetAddress:contact.street_address,schemaLocality:contact.city,
      schemaRegion:contact.region,schemaPostalCode:contact.postal_code,schemaCountry:contact.country
    },social_links:SOCIAL_KEYS.filter(key=>contact.social?.[key]).map(key=>({platform:key,url:contact.social[key]}))};
  }
  const value=[contact.venue_name,contact.street_address,contact.address_line2,
    [contact.city,contact.region,contact.postal_code].filter(Boolean).join(" "),contact.country].filter(Boolean).join("\n");
  return {...content,sections:Array.isArray(content.sections)?content.sections.map(section=>{
    if(section.type!=="contact")return section;
    const current=Array.isArray(section.details)?section.details:[];
    const values=[
      {label:current[0]?.label||"Address",value},
      {label:current[1]?.label||"Telephone",value:contact.phone,href:"tel:"+contact.phone.replace(/[^+\d]/g,"")},
      {label:current[2]?.label||"Email",value:contact.email,href:"mailto:"+contact.email}
    ];
    return {...section,details:values};
  }):content.sections};
}
function registerWebsitePresentationRoutes({app,db,auth,permit,audit}) {
  const admin=permit("ADMIN");
  app.get("/api/website-presentation",auth,admin,(_req,res)=>{res.setHeader("Cache-Control","no-store");res.json({navigation:navigation(db),contact:publicContact(db)});});
  app.put("/api/website-presentation/navigation",auth,admin,(req,res)=>{
    try {
      const next=normalizeNavigation(req.body?.items),before=navigation(db);
      writeSetting(db,NAV_KEY,next,req.user.name||req.user.id);
      audit(req,"UPDATE_NAV","website",NAV_KEY,before,next,1,"Navigation order and bilingual labels saved");
      res.json({items:next});
    }catch(error){res.status(400).json({error:error.message});}
  });
  app.put("/api/website-presentation/contact",auth,admin,(req,res)=>{
    try {
      const next=normalizeContact(req.body),before=publicContact(db);
      writeSetting(db,CONTACT_KEY,next,req.user.name||req.user.id);
      audit(req,"UPDATE_PUBLIC_CONTACT","website",CONTACT_KEY,before,next,1,"Public footer and showroom contact updated, invoice address unchanged");
      res.json({contact:next});
    }catch(error){res.status(400).json({error:error.message});}
  });
}
module.exports={NAV_KEY,CONTACT_KEY,SOCIAL_KEYS,navigation,publicContact,applySitePresentation,registerWebsitePresentationRoutes};
