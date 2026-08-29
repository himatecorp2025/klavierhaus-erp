"use strict";

const SAMPLE_VERSION_KEY = "website_sample_content_v2";
const SAMPLE_IMAGE_REPLACEMENTS = Object.freeze([
  ["klavierhaus-artists-salon.jpg", "klavierhaus-artist-salon.png"]
]);

function publicAsset(baseUrl, fileName) {
  const base = String(baseUrl || "https://klavierhaus-home.onrender.com").replace(/\/$/, "");
  return `${base}/assets/media/${fileName}`;
}

function repairSampleAssetReferences(db) {
  const columns = [
    ["website_artists", "portrait_url"],
    ["website_artists", "gallery_json"],
    ["website_reviews", "portrait_url"],
    ["website_showroom_pianos", "image_url"],
    ["website_showroom_pianos", "gallery_json"],
    ["website_services", "image_url"],
    ["events", "hero_image_url"],
    ["events", "gallery_json"]
  ];
  for (const [from, to] of SAMPLE_IMAGE_REPLACEMENTS) {
    for (const [table, column] of columns) {
      db.prepare(`UPDATE ${table} SET ${column}=replace(${column},?,?),updated_at=CURRENT_TIMESTAMP WHERE is_sample=1 AND ${column} LIKE ?`)
        .run(from, to, `%${from}%`);
    }
  }
}

function ensureSampleGalleriesAndLinks(db, publicWebsiteUrl) {
  const asset = (name) => publicAsset(publicWebsiteUrl, name);
  const salon = asset("klavierhaus-salon.jpg");
  const artistSalon = asset("klavierhaus-artist-salon.png");
  const craft = asset("klavierhaus-craft.jpg");
  const hero = asset("klavierhaus-hero.jpg");
  const gallery = (items) => JSON.stringify(items.map((url) => ({ url, alt_en: "Klavierhaus editorial photograph", alt_hu: "Klavierhaus szerkesztőségi fénykép" })));
  const artistGalleries = [
    ["SAMPLE-ARTIST-1", gallery([artistSalon, salon])],
    ["SAMPLE-ARTIST-2", gallery([salon, craft])],
    ["SAMPLE-ARTIST-3", gallery([craft, hero])]
  ];
  const pianoGalleries = [
    ["SAMPLE-PIANO-1", gallery([hero, salon])], ["SAMPLE-PIANO-2", gallery([salon, hero])],
    ["SAMPLE-PIANO-3", gallery([hero, salon])], ["SAMPLE-PIANO-4", gallery([salon, hero])],
    ["SAMPLE-PIANO-5", gallery([hero, salon])], ["SAMPLE-PIANO-6", gallery([salon, hero])]
  ];
  const updateGallery = db.prepare("UPDATE website_artists SET gallery_json=? WHERE id=? AND is_sample=1 AND (gallery_json IS NULL OR trim(gallery_json) IN ('','[]'))");
  artistGalleries.forEach(([id, value]) => updateGallery.run(value, id));
  const updatePianoGallery = db.prepare("UPDATE website_showroom_pianos SET gallery_json=? WHERE id=? AND is_sample=1 AND (gallery_json IS NULL OR trim(gallery_json) IN ('','[]'))");
  pianoGalleries.forEach(([id, value]) => updatePianoGallery.run(value, id));
  const artistLinks = db.prepare("UPDATE events SET artist_id=? WHERE id=? AND is_sample=1 AND (artist_id IS NULL OR trim(artist_id)='')");
  for (let index = 1; index <= 3; index += 1) artistLinks.run(`SAMPLE-ARTIST-${index}`, `SAMPLE-EVENT-${index}`);
}

function sampleContentComplete(db) {
  const required = [
    ["website_artists", ["SAMPLE-ARTIST-1", "SAMPLE-ARTIST-2", "SAMPLE-ARTIST-3"]],
    ["website_services", ["SAMPLE-SERVICE-1", "SAMPLE-SERVICE-2", "SAMPLE-SERVICE-3"]],
    ["website_showroom_pianos", ["SAMPLE-PIANO-1", "SAMPLE-PIANO-2", "SAMPLE-PIANO-3", "SAMPLE-PIANO-4", "SAMPLE-PIANO-5", "SAMPLE-PIANO-6"]],
    ["website_reviews", ["SAMPLE-REVIEW-1", "SAMPLE-REVIEW-2", "SAMPLE-REVIEW-3"]],
    ["events", ["SAMPLE-EVENT-1", "SAMPLE-EVENT-2", "SAMPLE-EVENT-3"]]
  ];
  return required.every(([table, ids]) => ids.every((id) => db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND is_sample=1 AND ${table === "events" ? "status='PUBLISHED' AND published_at IS NOT NULL" : table === "website_reviews" ? "visible=1" : table === "website_showroom_pianos" ? "published=1" : table === "website_artists" ? "published=1" : "visible=1"}`).get(id)));
}

function installSampleContent({ db, userId = null, updatedBy = "SYSTEM", publicWebsiteUrl = "" }) {
  repairSampleAssetReferences(db);
  ensureSampleGalleriesAndLinks(db, publicWebsiteUrl);
  if (db.prepare("SELECT 1 FROM app_settings WHERE setting_key=?").get(SAMPLE_VERSION_KEY) && sampleContentComplete(db)) {
    return { alreadyInstalled: true, installed: null };
  }

  const asset = (name) => publicAsset(publicWebsiteUrl, name);
  const salon = asset("klavierhaus-salon.jpg");
  const artistSalon = asset("klavierhaus-artist-salon.png");
  const craft = asset("klavierhaus-craft.jpg");
  const hero = asset("klavierhaus-hero.jpg");
  const gallery = (items) => JSON.stringify(items.map((url) => ({ url, alt_en: "Klavierhaus editorial photograph", alt_hu: "Klavierhaus szerkesztőségi fénykép" })));

  const installed = db.transaction(() => {
    const artists = [
      { id: "SAMPLE-ARTIST-1", slug_en: "elena-varga", slug_hu: "elena-varga", name: "Elena Varga", role_en: "Concert Pianist", role_hu: "Koncertzongorista", biography_en: "Elena Varga brings rare intimacy and color to every Klavierhaus encounter.", biography_hu: "Elena Varga minden Klavierhaus-találkozásba kivételes intimitást és színt hoz.", portrait_url: artistSalon, gallery_json: gallery([artistSalon, salon]), sort_order: 1 },
      { id: "SAMPLE-ARTIST-2", slug_en: "julian-moreau", slug_hu: "julian-moreau", name: "Julian Moreau", role_en: "Pianist & Curator", role_hu: "Zongoraművész és kurátor", biography_en: "Julian Moreau connects repertoire, instruments, and listeners through considered programmes.", biography_hu: "Julian Moreau átgondolt programokon keresztül kapcsolja össze a repertoárt, a hangszereket és a közönséget.", portrait_url: salon, gallery_json: gallery([salon, craft]), sort_order: 2 },
      { id: "SAMPLE-ARTIST-3", slug_en: "marcus-lee", slug_hu: "marcus-lee", name: "Marcus Lee", role_en: "Artist in Residence", role_hu: "Rezidens művész", biography_en: "Marcus Lee explores the expressive possibilities of the concert grand in close listening settings.", biography_hu: "Marcus Lee a koncertzongora kifejezési lehetőségeit kutatja az elmélyült hallgatás tereiben.", portrait_url: craft, gallery_json: gallery([craft, hero]), sort_order: 3 }
    ];
    const insertArtist = db.prepare(`INSERT OR IGNORE INTO website_artists(
      id,slug_en,slug_hu,name,role_en,role_hu,biography_en,biography_hu,portrait_url,portrait_alt_en,portrait_alt_hu,gallery_json,featured,published,sort_order,is_sample,created_by_user_id,updated_by_user_id
    ) VALUES(@id,@slug_en,@slug_hu,@name,@role_en,@role_hu,@biography_en,@biography_hu,@portrait_url,@name,@name,@gallery_json,1,1,@sort_order,1,@user_id,@user_id)`);
    artists.forEach((row) => insertArtist.run({ ...row, user_id: userId }));

    const services = [
      { id: "SAMPLE-SERVICE-1", slug_en: "rebuilding-restoration", slug_hu: "ujjaepites-restauralas", title_en: "Rebuilding & Restoration", title_hu: "Újjáépítés és restaurálás", image_url: craft, sort_order: 1 },
      { id: "SAMPLE-SERVICE-2", slug_en: "tuning-technical-care", slug_hu: "hangolas-technikai-gondoskodas", title_en: "Tuning & Technical Care", title_hu: "Hangolás és technikai gondoskodás", image_url: hero, sort_order: 2 },
      { id: "SAMPLE-SERVICE-3", slug_en: "concert-piano-services", slug_hu: "koncertzongora-szolgaltatas", title_en: "Concert Piano Services", title_hu: "Koncertzongora-szolgáltatás", image_url: salon, sort_order: 3 }
    ];
    const insertService = db.prepare(`INSERT OR IGNORE INTO website_services(
      id,slug_en,slug_hu,title_en,title_hu,summary_en,summary_hu,description_en,description_hu,image_url,image_alt_en,image_alt_hu,visible,featured,sort_order,is_sample,created_by_user_id,updated_by_user_id
    ) VALUES(@id,@slug_en,@slug_hu,@title_en,@title_hu,'Private, instrument-led care shaped around sound, room, and artist.','Személyes, hangszerközpontú gondoskodás a hanghoz, térhez és művészhez igazítva.','A private consultation begins every engagement.','Minden együttműködés személyes konzultációval kezdődik.',@image_url,@title_en,@title_hu,1,1,@sort_order,1,@user_id,@user_id)`);
    services.forEach((row) => insertService.run({ ...row, user_id: userId }));

    const pianos = [
      ["SAMPLE-PIANO-1", "steinway-model-b-new-york", "steinway-b-new-york", "Steinway & Sons", "Model B", "Steinway Model B - New York", "Steinway B-modell - New York", hero],
      ["SAMPLE-PIANO-2", "steinway-model-d-hamburg", "steinway-d-hamburg", "Steinway & Sons", "Model D", "Steinway Model D - Hamburg", "Steinway D-modell - Hamburg", salon],
      ["SAMPLE-PIANO-3", "fazioli-f212", "fazioli-f212", "Fazioli", "F212", "Fazioli F212", "Fazioli F212", hero],
      ["SAMPLE-PIANO-4", "fazioli-f278", "fazioli-f278", "Fazioli", "F278", "Fazioli F278", "Fazioli F278", salon],
      ["SAMPLE-PIANO-5", "bosendorfer-214vc", "bosendorfer-214vc", "Bösendorfer", "214VC", "Bösendorfer 214VC", "Bösendorfer 214VC", hero],
      ["SAMPLE-PIANO-6", "bosendorfer-280vc", "bosendorfer-280vc", "Bösendorfer", "280VC", "Bösendorfer 280VC", "Bösendorfer 280VC", salon]
    ];
    const insertPiano = db.prepare(`INSERT OR IGNORE INTO website_showroom_pianos(
      id,slug_en,slug_hu,brand,model,title_en,title_hu,summary_en,summary_hu,description_en,description_hu,image_url,image_alt_en,image_alt_hu,gallery_json,availability_status,featured,published,sort_order,is_sample,created_by_user_id,updated_by_user_id
    ) VALUES(?,?,?,?,?,?,?,'A singular showroom instrument selected for tone, touch, and character.','Egyedi bemutatótermi hangszer, hangszín, érintés és karakter alapján válogatva.','Available for a private listening appointment.','Privát meghallgatásra elérhető.',?,?,?,?,'AVAILABLE',1,1,?,1,?,?)`);
    pianos.forEach((row, index) => insertPiano.run(...row, row[5], row[6], gallery([row[7], index % 2 ? hero : salon]), index + 1, userId, userId));

    const reviews = [
      ["SAMPLE-REVIEW-1", "Amelia Grant", "Private collector", "Magángyűjtő", artistSalon],
      ["SAMPLE-REVIEW-2", "Daniel Kovács", "Concert artist", "Koncertművész", salon],
      ["SAMPLE-REVIEW-3", "Claire Morel", "Cultural patron", "Kulturális mecénás", craft]
    ];
    const insertReview = db.prepare(`INSERT OR IGNORE INTO website_reviews(
      id,person_name,role_en,role_hu,quote_en,quote_hu,portrait_url,portrait_alt_en,portrait_alt_hu,visible,sort_order,is_sample,created_by_user_id,updated_by_user_id
    ) VALUES(?,?,?,?,'Klavierhaus turns listening into a deeply personal encounter.','A Klavierhaus a zenehallgatást mélyen személyes találkozássá formálja.',?,?,?,1,?,1,?,?)`);
    reviews.forEach((row, index) => insertReview.run(...row, row[1], row[1], index + 1, userId, userId));

    const category = db.prepare("SELECT id FROM event_categories ORDER BY sort_order,id LIMIT 1").get();
    if (!category) throw new Error("SAMPLE_EVENT_CATEGORY_REQUIRED");
    const dates = [["2027-10-15T23:00:00.000Z", "2027-10-16T01:00:00.000Z"], ["2027-11-12T00:00:00.000Z", "2027-11-12T02:00:00.000Z"], ["2027-12-04T23:30:00.000Z", "2027-12-05T01:30:00.000Z"]];
    const titlesEn = ["An Evening of Ravel", "The Art of the Singing Line", "Young Artists Salon"];
    const titlesHu = ["Ravel estje", "Az éneklő dallam művészete", "Fiatal művészek szalonja"];
    const insertEvent = db.prepare(`INSERT OR IGNORE INTO events(
      id,event_key,category_id,access_type,status,slug_en,slug_hu,title_en,title_hu,description_en,description_hu,artist_id,performer_name,hero_image_url,hero_image_alt_en,hero_image_alt_hu,gallery_json,venue_name,venue_street,venue_city,venue_region,venue_postal_code,venue_country,timezone,start_at,end_at,capacity_total,price_cents,currency,published_at,is_sample,created_by_user_id,updated_by_user_id
    ) VALUES(?,?,?,?,'PUBLISHED',?,?,?,?,?,?,?,?,?,?,?,?, 'Klavierhaus','790 11th Avenue','New York','NY','10019','US','America/New_York',?,?,40,?,'USD',CURRENT_TIMESTAMP,1,?,?)`);
    artists.forEach((artist, index) => insertEvent.run(
      `SAMPLE-EVENT-${index + 1}`, `SAMPLE-EV-${index + 1}`, category.id, index === 2 ? "PUBLIC_FREE" : "PUBLIC_PAID",
      `klavierhaus-salon-${index + 1}`, `klavierhaus-szalon-${index + 1}`, titlesEn[index], titlesHu[index],
      "An intimate Klavierhaus salon shaped around tone, conversation, and presence.", "Intim Klavierhaus-szalon a hang, a párbeszéd és a jelenlét köré formálva.",
      artist.id, artist.name, index === 0 ? salon : index === 1 ? artistSalon : hero, titlesEn[index], titlesHu[index], gallery([salon, artistSalon]), dates[index][0], dates[index][1], index === 2 ? 0 : 12500, userId, userId
    ));

    db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at)
      VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
      .run(SAMPLE_VERSION_KEY, "1", updatedBy);
    return { artists: 3, services: 3, pianos: 6, reviews: 3, events: 3 };
  })();
  return { alreadyInstalled: false, installed };
}

module.exports = { SAMPLE_VERSION_KEY, installSampleContent, repairSampleAssetReferences };
