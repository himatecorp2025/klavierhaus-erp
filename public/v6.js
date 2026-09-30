"use strict";

/* Klavierhaus Admin UX v6
 * Loaded after app.js / round2.js / round3.js and before boot().
 * The public website bundle remains untouched; this file only extends ERP admin UX.
 */

const v6Original={
  showLogin,showApp,setSession,loadBranding,renderProfile,openUserDialog,renderCms,renderIntake,openIntakeDialog,openConvertToJobDialog,r3OpenDirectExpenses
};

function v6UserThemeKey(){return state.user?.id?`kh_theme_user_${state.user.id}`:"kh_theme";}
function v6ResolveTheme(){
  if(state.user?.theme_preference&&["dark","light"].includes(state.user.theme_preference))return state.user.theme_preference;
  const local=state.user?localStorage.getItem(v6UserThemeKey()):null;
  return local==="light"?"light":"dark";
}
function v6BrandAssetUrl(url){
  if(!url)return "";const version=state.v6Branding?.branding_version||"1";return `${url}${url.includes("?")?"&":"?"}v=${encodeURIComponent(version)}`;
}
function v6ApplyBrandLogo(){
  const branding=state.v6Branding||{},theme=document.documentElement.dataset.theme==="light"?"light":"dark";
  const appUrl=theme==="light"?(branding.erp_logo_light_url||branding.logo_url):(branding.erp_logo_dark_url||branding.logo_url);
  const loginUrl=branding.login_logo_url||branding.erp_logo_dark_url||branding.logo_url;
  if(loginUrl&&$("#loginBrandLogo"))$("#loginBrandLogo").src=v6BrandAssetUrl(loginUrl);
  if(appUrl){for(const img of [$("#headerBrandLogo"),$("#mobileBrandLogo")])if(img)img.src=v6BrandAssetUrl(appUrl);}
}
function v6ApplyTheme(theme,{save=false}={}){
  const next=state.user&&theme==="light"?"light":"dark";
  document.documentElement.dataset.theme=next;
  document.documentElement.style.colorScheme=next;
  v6ApplyBrandLogo();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",next==="dark"?"#0f1115":"#f6f7f9");
  if(state.user)localStorage.setItem(v6UserThemeKey(),next);
  $("#themeToggle")?.setAttribute("aria-pressed",String(next==="dark"));
  if(save&&state.user){
    state.user.theme_preference=next;
    void api("/api/me/preferences",{method:"PUT",body:JSON.stringify({theme:next})}).catch(error=>toast(humanError(error),"error"));
  }
}
function v6ToggleTheme(){if(state.user)v6ApplyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark",{save:true});}
function v6SidebarKey(){return state.user?.id?`kh_sidebar_collapsed_${state.user.id}`:"kh_sidebar_collapsed";}
function v6ApplySidebar(){
  const collapsed=localStorage.getItem(v6SidebarKey())==="1";
  $("#appShell")?.classList.toggle("sidebar-collapsed",collapsed);
  $("#sidebarToggle")?.setAttribute("aria-expanded",String(!collapsed));
}
function v6ToggleSidebar(){
  const shell=$("#appShell"),collapsed=!shell.classList.contains("sidebar-collapsed");
  shell.classList.toggle("sidebar-collapsed",collapsed);localStorage.setItem(v6SidebarKey(),collapsed?"1":"0");
}
function v6CloseMore(){
  const popover=$("#mobileMorePopover");if(!popover)return;
  popover.hidden=true;$("#mobileMoreButton")?.setAttribute("aria-expanded","false");
}
function v6OpenMore(){
  const popover=$("#mobileMorePopover"),grid=$("#mobileMoreGrid");if(!popover||!grid)return;
  if(!popover.hidden){v6CloseMore();return;}
  grid.innerHTML=`
    <button class="mobile-more-card" type="button" data-nav="planned"><span>◷</span><strong>${tr("Planned Jobs","Tervezett munkák")}</strong></button>
    <button class="mobile-more-card" type="button" data-nav="finance"><span>$</span><strong>${tr("Finance","Pénzügy")}</strong></button>
    <button class="mobile-more-card" type="button" data-nav="documents"><span>▤</span><strong>${tr("Documents","Dokumentumok")}</strong></button>
    <button class="mobile-more-card" type="button" data-nav="cms"><span>◎</span><strong>${tr("Website CMS","Weboldal CMS")}</strong></button>
    <button class="mobile-more-card" type="button" data-nav="profile"><span>◉</span><strong>${tr("Profile","Profil")}</strong></button>
    <button class="mobile-more-card" type="button" data-nav="settings"><span>⚙</span><strong>${tr("Settings","Beállítások")}</strong></button>`;
  popover.hidden=false;$("#mobileMoreButton")?.setAttribute("aria-expanded","true");
}
function v6SyncAccountChrome(){
  if(!state.user)return;
  const image=state.user.profile_image_url||"",initial=initials(state.user.name);
  $("#profileInitials").textContent=initial;
  const avatar=$("#profileAvatarImage");
  if(avatar){avatar.hidden=!image;if(image)avatar.src=image;$("#profileInitials").hidden=Boolean(image);}
  $("#profileMenuName").textContent=state.user.name||"";
  $("#profileMenuRole").textContent=roleLabel(state.user.role);
  const menuAvatar=$("#profileMenuAvatar");
  if(menuAvatar)menuAvatar.innerHTML=image?`<img src="${esc(image)}" alt="">`:esc(initial);
  const welcome=$("#headerWelcome");if(welcome)welcome.textContent=tr(`Welcome to the Klavierhaus System, ${state.user.name}.`,`Üdvözöllek a Klavierhaus rendszerében, ${state.user.name}.`);
}
function v6CloseProfileMenu(){
  const menu=$("#profileMenu");if(menu)menu.hidden=true;$("#profileButton")?.setAttribute("aria-expanded","false");
}
async function v6Logout(){
  try{await api("/api/logout",{method:"POST"});}catch(_error){}
  clearSession();v6CloseProfileMenu();showLogin();
}
function v6BindShell(){
  $("#themeToggle")?.addEventListener("click",v6ToggleTheme);
  $("#sidebarToggle")?.addEventListener("click",v6ToggleSidebar);
  $("#mobileMoreButton")?.addEventListener("click",event=>{event.stopPropagation();v6OpenMore();});
  $("#mobileMoreClose")?.addEventListener("click",v6CloseMore);
  $("#profileButton")?.addEventListener("click",event=>{event.stopPropagation();const menu=$("#profileMenu");if(!menu)return;menu.hidden=!menu.hidden;$("#profileButton").setAttribute("aria-expanded",String(!menu.hidden));});
  $("#profileMenu")?.addEventListener("click",event=>{const action=event.target.closest("[data-profile-menu]")?.dataset.profileMenu;if(!action)return;v6CloseProfileMenu();if(action==="logout")void v6Logout();else void navTo(action);});
  document.addEventListener("click",event=>{
    const popover=$("#mobileMorePopover");if(popover&&!popover.hidden&&!event.target.closest("#mobileMorePopover,#mobileMoreButton"))v6CloseMore();
    if(!event.target.closest("#profileMenu,#profileButton"))v6CloseProfileMenu();
  });
}
showLogin=function(){
  v6Original.showLogin();
  state.user=null;
  document.documentElement.dataset.theme="dark";
  document.documentElement.style.colorScheme="dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content","#0f1115");
  v6ApplyBrandLogo();
};
setSession=function(payload){
  v6Original.setSession(payload);
  state.user=payload.user;
  const language=state.user.language_preference==="hu"?"hu":"en";
  setLanguage(language,{save:false});
  v6ApplyTheme(state.user.theme_preference||localStorage.getItem(v6UserThemeKey())||"dark");
};
showApp=function(){
  v6Original.showApp();
  v6ApplyTheme(v6ResolveTheme());
  v6ApplySidebar();
  v6SyncAccountChrome();
};
loadBranding=async function(){
  try{
    const branding=await fetch("/api/public/branding",{cache:"no-store"}).then(response=>response.json());
    state.v6Branding=branding;v6ApplyBrandLogo();
    if(branding.login_background_url){
      $("#loginScreen")?.style.setProperty("--login-background",`url("${String(branding.login_background_url).replaceAll('"','%22')}")`);
      $("#loginScreen")?.classList.add("has-custom-background");
    }else{
      $("#loginScreen")?.style.removeProperty("--login-background");$("#loginScreen")?.classList.remove("has-custom-background");
    }
    const favicon=branding.favicon_url;
    if(favicon)$("#appFavicon")?.setAttribute("href",v6BrandAssetUrl(favicon));
    const touch=branding.app_icon_url;
    if(touch)$("#appTouchIcon")?.setAttribute("href",v6BrandAssetUrl(touch));
    document.title=`${branding.company_name||"Klavierhaus"} System`;
  }catch(_error){}
};

/* ---------- Website CMS / mini site builder ---------- */

function v6CmsPath(path){return encodeURIComponent(JSON.stringify(path));}
function v6CmsPathRead(value){try{return JSON.parse(decodeURIComponent(value));}catch(_error){return [];}}
function v6CmsGet(path){return path.reduce((node,key)=>node?.[key],state.cmsDraft);}
function v6CmsSet(path,value){if(!path.length)return;let node=state.cmsDraft;for(let i=0;i<path.length-1;i+=1)node=node[path[i]];node[path.at(-1)]=value;}
function v6CmsImageKey(key){const value=String(key||"");return !/alt/i.test(value)&&/(^image$|image_url|imageurl|portrait_url|portraiturl|logoimage|logo_url|background|hero_image|photo|thumbnail)/i.test(value);}
function v6CmsPreviewUrl(value){
  const raw=String(value||"").trim();if(!raw)return "";
  if(raw.startsWith("/uploads/website/"))return raw;
  try{
    const url=new URL(raw,window.location.origin);
    if(url.pathname.startsWith("/uploads/website/"))return url.pathname+url.search;
  }catch(_error){}
  return raw;
}
function v6CmsMeta(){
  if(!state.cmsDraft._cms_media||typeof state.cmsDraft._cms_media!=="object")state.cmsDraft._cms_media={};
  return state.cmsDraft._cms_media;
}
function v6CmsMetaKey(path){return path.join(".");}
function v6CmsSectionTitle(key,index){
  const special={hero:tr("Hero section","Hero szekció"),seo:"SEO",sections:tr("Page sections","Oldalszekciók"),brand:tr("Brand identity","Arculat"),nav:tr("Navigation","Navigáció"),items:tr("Cards / items","Kártyák / elemek")};
  return special[key]||cmsFieldLabel(key,index);
}
function v6CmsImageField(value,path,key){
  const meta=v6CmsMeta()[v6CmsMetaKey(path)]||{focal_x:50,focal_y:50};
  const src=String(value||"");
  return `<article class="cms-media-card">
    <div class="cms-media-preview" style="--focal-x:${Number(meta.focal_x??50)}%;--focal-y:${Number(meta.focal_y??50)}%">
      ${src?`<img src="${esc(v6CmsPreviewUrl(src))}" data-cms-original-src="${esc(src)}" alt="">`:`<div class="cms-media-empty">＋<span>${tr("No image","Nincs kép")}</span></div>`}
    </div>
    <div class="cms-media-body">
      <strong>${esc(v6CmsSectionTitle(key,0))}</strong>
      <small>${tr("Upload a replacement image. The stored public path is managed automatically.","Tölts fel új képet. A publikus elérési utat a rendszer automatikusan kezeli.")}</small>
      <div class="cms-media-actions">
        <label class="file-picker"><input type="file" accept="image/*" data-cms-image-upload="${v6CmsPath(path)}"><span>↑ ${tr(src?"Replace image":"Upload image",src?"Kép cseréje":"Kép feltöltése")}</span></label>
        ${src?`<button class="text-button danger-text" type="button" data-cms-image-remove="${v6CmsPath(path)}">${tr("Remove","Eltávolítás")}</button>`:""}
      </div>
      <div class="cms-focal-controls">
        <label><span>${tr("Horizontal focus","Vízszintes fókusz")}</span><input type="range" min="0" max="100" value="${Number(meta.focal_x??50)}" data-cms-focal-x="${v6CmsPath(path)}"></label>
        <label><span>${tr("Vertical focus","Függőleges fókusz")}</span><input type="range" min="0" max="100" value="${Number(meta.focal_y??50)}" data-cms-focal-y="${v6CmsPath(path)}"></label>
      </div>
    </div>
  </article>`;
}
function v6CmsRender(value,path=[],key="",index=0){
  if(key==="_cms_media")return "";
  const label=v6CmsSectionTitle(key,index);
  if(Array.isArray(value)){
    return `<section class="cms-builder-section"><header><div><span class="eyebrow">${tr("COLLECTION","GYŰJTEMÉNY")}</span><h3>${esc(label)}</h3><p>${value.length} ${tr("items","elem")}</p></div><button type="button" class="secondary-button" data-cms-add="${v6CmsPath(path)}">＋ ${tr("Add item","Elem hozzáadása")}</button></header><div class="cms-builder-list">${value.map((item,itemIndex)=>`<article class="cms-builder-item"><div class="cms-builder-item-head"><strong>${esc(label)} #${itemIndex+1}</strong><button class="text-button danger-text" type="button" data-cms-remove="${v6CmsPath([...path,itemIndex])}">${tr("Remove","Eltávolítás")}</button></div>${v6CmsRender(item,[...path,itemIndex],key,itemIndex)}</article>`).join("")||`<div class="cms-empty">${tr("No items yet.","Még nincs elem.")}</div>`}</div></section>`;
  }
  if(value&&typeof value==="object"){
    return `<section class="cms-builder-section"><header><div><span class="eyebrow">${String(key||"SECTION").toUpperCase()}</span><h3>${esc(label)}</h3></div></header><div class="cms-builder-fields">${Object.entries(value).map(([childKey,child],childIndex)=>v6CmsRender(child,[...path,childKey],childKey,childIndex)).join("")}</div></section>`;
  }
  if(typeof value==="boolean")return `<label class="cms-toggle-row"><span>${esc(label)}</span><input type="checkbox" data-cms-path="${v6CmsPath(path)}" ${value?"checked":""}></label>`;
  if(v6CmsImageKey(key))return v6CmsImageField(value,path,key);
  const str=String(value??""),long=/text|body|description|quote|biography|lead|intro/i.test(key)||str.length>110;
  return `<label class="field cms-primitive"><span>${esc(label)}</span>${long?`<textarea data-cms-path="${v6CmsPath(path)}">${esc(str)}</textarea>`:`<input data-cms-path="${v6CmsPath(path)}" value="${esc(str)}">`}</label>`;
}
async function v6UploadWebsiteImage(file){
  const form=new FormData();form.append("website_image",file);
  return api("/api/website-content/image",{method:"POST",body:form});
}
function v6BindCmsFields(){
  const host=$("#cmsVisualFields");if(!host)return;
  $$("[data-cms-path]",host).forEach(input=>input.addEventListener(input.type==="checkbox"?"change":"input",event=>{
    const path=v6CmsPathRead(event.currentTarget.dataset.cmsPath),old=v6CmsGet(path);
    v6CmsSet(path,event.currentTarget.type==="checkbox"?event.currentTarget.checked:typeof old==="number"?Number(event.currentTarget.value||0):event.currentTarget.value);
  }));
  $$("[data-cms-image-upload]",host).forEach(input=>input.addEventListener("change",async event=>{
    const file=event.currentTarget.files?.[0];if(!file)return;
    const path=v6CmsPathRead(event.currentTarget.dataset.cmsImageUpload);
    try{const uploaded=await v6UploadWebsiteImage(file);v6CmsSet(path,uploaded.absolute_url||uploaded.image_url);toast(tr("Image uploaded.","Kép feltöltve."),"success");v6RenderCmsFields();}catch(error){toast(humanError(error),"error");}
  }));
  $$("[data-cms-image-remove]",host).forEach(button=>button.addEventListener("click",()=>{v6CmsSet(v6CmsPathRead(button.dataset.cmsImageRemove),"");v6RenderCmsFields();}));
  for(const axis of ["x","y"])$$(`[data-cms-focal-${axis}]`,host).forEach(input=>input.addEventListener("input",event=>{
    const path=v6CmsPathRead(event.currentTarget.dataset[`cmsFocal${axis.toUpperCase()}`]),key=v6CmsMetaKey(path),meta=v6CmsMeta()[key]||{focal_x:50,focal_y:50};
    meta[`focal_${axis}`]=Number(event.currentTarget.value);v6CmsMeta()[key]=meta;
    const card=event.currentTarget.closest(".cms-media-card");card?.querySelector(".cms-media-preview")?.style.setProperty(`--focal-${axis}`,`${event.currentTarget.value}%`);
  }));
  $$("[data-cms-remove]",host).forEach(button=>button.addEventListener("click",()=>{const path=v6CmsPathRead(button.dataset.cmsRemove),parent=v6CmsGet(path.slice(0,-1));if(Array.isArray(parent)){parent.splice(Number(path.at(-1)),1);v6RenderCmsFields();}}));
  $$("[data-cms-add]",host).forEach(button=>button.addEventListener("click",()=>{const path=v6CmsPathRead(button.dataset.cmsAdd),arr=v6CmsGet(path);if(Array.isArray(arr)){arr.push(arr.length?cmsEmptyClone(arr[0]):"");v6RenderCmsFields();}}));
}
function v6RenderCmsFields(){
  const host=$("#cmsVisualFields");if(!host)return;
  const entries=Object.entries(state.cmsDraft||{}).filter(([key])=>key!=="_cms_media");
  host.innerHTML=entries.map(([key,value],index)=>v6CmsRender(value,[key],key,index)).join("")||`<div class="cms-empty">${tr("No editable content.","Nincs szerkeszthető tartalom.")}</div>`;
  v6BindCmsFields();
}
async function v6LoadCmsPage(){
  const host=$("#cmsEditor");host.innerHTML=loading();
  const page=await api(`/api/website-content/${encodeURIComponent(state.cmsPage)}?lang=${state.cmsLanguage}`);
  state.cmsDraft=structuredClone(page.content||{});
  const meta=state.cmsPages.find(item=>item.page_key===state.cmsPage)||{};
  host.innerHTML=`<div class="cms-toolbar"><div><span class="eyebrow">${tr("PAGE BUILDER","OLDALSZERKESZTŐ")}</span><h2>${esc(state.language==="hu"?(meta.title_hu||meta.title_en||state.cmsPage):(meta.title_en||state.cmsPage))}</h2><p>${tr("Edit text and images exactly where they belong in the page structure.","A szövegeket és képeket az oldal tényleges szerkezetében szerkesztheted.")}</p></div><label class="field cms-language-field"><span>${tr("Content language","Tartalom nyelve")}</span><select id="cmsLanguage"><option value="en" ${state.cmsLanguage==="en"?"selected":""}>English</option><option value="hu" ${state.cmsLanguage==="hu"?"selected":""}>Magyar</option></select></label></div>
  <div id="cmsVisualFields" class="cms-visual-fields"></div>
  <div class="cms-publish-bar"><span>${tr("Changes publish through the existing website content API.","A változások a meglévő weboldal-tartalmi API-n keresztül publikálódnak.")}</span><button id="saveCmsBtn" class="primary-button" type="button">${tr("Save & publish","Mentés és publikálás")}</button></div>`;
  v6RenderCmsFields();
  $("#cmsLanguage").addEventListener("change",async event=>{state.cmsLanguage=event.target.value;await v6LoadCmsPage();});
  $("#saveCmsBtn").addEventListener("click",async()=>{try{await api(`/api/website-content/${encodeURIComponent(state.cmsPage)}`,{method:"PUT",body:JSON.stringify({language:state.cmsLanguage,content:state.cmsDraft})});toast(tr("Website content published.","Weboldal tartalma publikálva."),"success");}catch(error){toast(humanError(error),"error");}});
}

function v6MediaUrlCard(url){return url?`<div class="collection-image-preview"><img src="${esc(v6CmsPreviewUrl(url))}" data-cms-original-src="${esc(url)}" alt=""></div>`:`<div class="collection-image-preview empty">＋</div>`;}
async function v6CollectionImageUpload(input,setter){
  const file=input.files?.[0];if(!file)return;try{const result=await v6UploadWebsiteImage(file);setter(result.absolute_url||result.image_url);toast(tr("Image uploaded.","Kép feltöltve."),"success");}catch(error){toast(humanError(error),"error");}
}
function v6GalleryParse(value){try{const rows=Array.isArray(value)?value:JSON.parse(value||"[]");return rows.map(item=>typeof item==="string"?{url:item,alt_en:"",alt_hu:""}:item).filter(item=>item?.url);}catch(_error){return [];}}
function v6GalleryMarkup(rows){
  return `<div class="cms-gallery-grid">${rows.map((row,index)=>`<article><img src="${esc(v6CmsPreviewUrl(row.url))}" data-cms-original-src="${esc(row.url)}" alt=""><input data-gallery-alt-en="${index}" placeholder="Alt text EN" value="${esc(row.alt_en||"")}"><input data-gallery-alt-hu="${index}" placeholder="Alt text HU" value="${esc(row.alt_hu||"")}"><button type="button" class="text-button danger-text" data-gallery-remove="${index}">${tr("Remove","Eltávolítás")}</button></article>`).join("")}<label class="file-picker gallery-add"><input id="galleryFiles" type="file" accept="image/*" multiple><span>＋ ${tr("Add gallery images","Galériaképek hozzáadása")}</span></label></div>`;
}
async function v6OpenCollectionEditor(type,row=null,refresh){
  const definitions={
    piano:{title:tr(row?"Edit showroom piano":"New showroom piano",row?"Bemutatótermi zongora szerkesztése":"Új bemutatótermi zongora"),route:"showroom-pianos",image:"image_url",gallery:true},
    service:{title:tr(row?"Edit service":"New service",row?"Szolgáltatás szerkesztése":"Új szolgáltatás"),route:"website-services",image:"image_url",gallery:true},
    artist:{title:tr(row?"Edit artist":"New artist",row?"Művész szerkesztése":"Új művész"),route:"website-artists",image:"portrait_url",gallery:true},
    review:{title:tr(row?"Edit review":"New review",row?"Vélemény szerkesztése":"Új vélemény"),route:"website-reviews",image:"portrait_url"}
  },def=definitions[type];
  let gallery=def.gallery?v6GalleryParse(row?.gallery_json):[],image=row?.[def.image]||"";
  const common=`
    <div class="cms-collection-media full" id="collectionMainImage">${v6MediaUrlCard(image)}<label class="file-picker"><input id="collectionImageFile" type="file" accept="image/*"><span>↑ ${tr(image?"Replace main image":"Upload main image",image?"Főkép cseréje":"Főkép feltöltése")}</span></label></div>`;
  let fields="";
  if(type==="piano")fields=`<label class="field"><span>${tr("Brand","Márka")} *</span><input name="brand" value="${esc(row?.brand||"")}" required></label><label class="field"><span>${tr("Model","Modell")}</span><input name="model" value="${esc(row?.model||"")}"></label>`;
  if(type==="artist")fields=`<label class="field full"><span>${tr("Artist name","Művész neve")} *</span><input name="name" value="${esc(row?.name||"")}" required></label><label class="field"><span>Role EN</span><input name="role_en" value="${esc(row?.role_en||"")}"></label><label class="field"><span>Szerep HU</span><input name="role_hu" value="${esc(row?.role_hu||"")}"></label><label class="field full"><span>Biography EN</span><textarea name="biography_en">${esc(row?.biography_en||"")}</textarea></label><label class="field full"><span>Bemutatkozás HU</span><textarea name="biography_hu">${esc(row?.biography_hu||"")}</textarea></label>`;
  else if(type==="review")fields=`<label class="field full"><span>${tr("Person name","Személy neve")} *</span><input name="person_name" value="${esc(row?.person_name||"")}" required></label><label class="field"><span>Role EN</span><input name="role_en" value="${esc(row?.role_en||"")}"></label><label class="field"><span>Szerep HU</span><input name="role_hu" value="${esc(row?.role_hu||"")}"></label><label class="field full"><span>Quote EN *</span><textarea name="quote_en" required>${esc(row?.quote_en||"")}</textarea></label><label class="field full"><span>Idézet HU *</span><textarea name="quote_hu" required>${esc(row?.quote_hu||"")}</textarea></label>`;
  else fields+=`<label class="field full"><span>Title EN *</span><input name="title_en" value="${esc(row?.title_en||"")}" required></label><label class="field full"><span>Cím HU *</span><input name="title_hu" value="${esc(row?.title_hu||"")}" required></label><label class="field full"><span>Summary EN</span><textarea name="summary_en">${esc(row?.summary_en||"")}</textarea></label><label class="field full"><span>Összefoglaló HU</span><textarea name="summary_hu">${esc(row?.summary_hu||"")}</textarea></label><label class="field full"><span>Description EN</span><textarea name="description_en">${esc(row?.description_en||"")}</textarea></label><label class="field full"><span>Leírás HU</span><textarea name="description_hu">${esc(row?.description_hu||"")}</textarea></label>`;
  const alt=`<label class="field"><span>Image alt EN</span><input name="${type==="artist"||type==="review"?"portrait_alt_en":"image_alt_en"}" value="${esc(row?.[type==="artist"||type==="review"?"portrait_alt_en":"image_alt_en"]||"")}"></label><label class="field"><span>Kép alt HU</span><input name="${type==="artist"||type==="review"?"portrait_alt_hu":"image_alt_hu"}" value="${esc(row?.[type==="artist"||type==="review"?"portrait_alt_hu":"image_alt_hu"]||"")}"></label>`;
  openDialog({title:def.title,eyebrow:tr("PUBLIC WEBSITE","PUBLIKUS WEBOLDAL"),body:`<form id="collectionEditor" class="form-grid">${common}${fields}${alt}${def.gallery?`<section class="full cms-gallery-editor"><div class="panel-head inline-panel-head"><h3>${tr("Gallery","Galéria")}</h3></div><div id="collectionGallery">${v6GalleryMarkup(gallery)}</div></section>`:""}<div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save","Mentés")}</button></div></form>`});
  $("#collectionImageFile").addEventListener("change",event=>v6CollectionImageUpload(event.currentTarget,url=>{image=url;$("#collectionMainImage").querySelector(".collection-image-preview").outerHTML=v6MediaUrlCard(image);}));
  function bindGallery(){
    if(!def.gallery)return;
    $("#galleryFiles")?.addEventListener("change",async event=>{for(const file of [...event.currentTarget.files||[]]){try{const up=await v6UploadWebsiteImage(file);gallery.push({url:up.absolute_url||up.image_url,alt_en:"",alt_hu:""});}catch(error){toast(humanError(error),"error");}}$("#collectionGallery").innerHTML=v6GalleryMarkup(gallery);bindGallery();});
    $$("[data-gallery-remove]").forEach(button=>button.addEventListener("click",()=>{gallery.splice(Number(button.dataset.galleryRemove),1);$("#collectionGallery").innerHTML=v6GalleryMarkup(gallery);bindGallery();}));
  }
  bindGallery();
  $("#collectionEditor").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body[def.image]=image;
    if(def.gallery){$$("[data-gallery-alt-en]").forEach(input=>gallery[Number(input.dataset.galleryAltEn)].alt_en=input.value);$$("[data-gallery-alt-hu]").forEach(input=>gallery[Number(input.dataset.galleryAltHu)].alt_hu=input.value);body.gallery=gallery;}
    if(type==="piano"){body.published=row?.published??true;body.availability_status=row?.availability_status||"AVAILABLE";}
    if(type==="service")body.visible=row?.visible??true;
    if(type==="artist")body.published=row?.published??true;
    if(type==="review")body.visible=row?.visible??true;
    try{const saved=await api(`/api/${def.route}${row?"/"+encodeURIComponent(row.id):""}`,{method:row?"PUT":"POST",body:JSON.stringify(body)});if(type==="service"&&def.gallery)await api(`/api/v6/website-services/${encodeURIComponent(saved.id)}/gallery`,{method:"PUT",body:JSON.stringify({gallery})});closeDialog();toast(tr("Website item saved.","Weboldalelem mentve."),"success");await refresh();}catch(error){toast(humanError(error),"error");}
  });
}
async function v6RenderCollections(){
  const host=$("#cmsMain");
  const [pianos,services,artists,reviews]=await Promise.all([api("/api/showroom-pianos"),api("/api/website-services"),api("/api/website-artists"),api("/api/website-reviews")]);
  const groups=[
    ["piano",tr("Showroom pianos","Bemutatótermi zongorák"),pianos,row=>row.image_url,row=>row.title_en||row.brand],
    ["service",tr("Services","Szolgáltatások"),services,row=>row.image_url,row=>row.title_en],
    ["artist",tr("Artists","Művészek"),artists,row=>row.portrait_url,row=>row.name],
    ["review",tr("Reviews","Vélemények"),reviews,row=>row.portrait_url,row=>row.person_name]
  ];
  host.innerHTML=`<div class="cms-collection-groups">${groups.map(([type,title,rows,imageFn,titleFn])=>`<section class="panel cms-collection-group"><div class="panel-head"><div><span class="eyebrow">${esc(type.toUpperCase())}</span><h2>${esc(title)}</h2></div><button class="primary-button" type="button" data-new-collection="${type}">＋ ${tr("Add","Hozzáadás")}</button></div><div class="cms-collection-grid">${rows.map(row=>`<button class="cms-collection-card" type="button" data-edit-collection="${type}" data-id="${esc(row.id)}">${v6MediaUrlCard(imageFn(row))}<span><strong>${esc(titleFn(row)||"—")}</strong><small>${tr("Edit content & media","Tartalom és média szerkesztése")}</small></span></button>`).join("")||`<div class="empty-state">${tr("No items yet.","Még nincs elem.")}</div>`}</div></section>`).join("")}</div>`;
  $$("[data-new-collection]",host).forEach(button=>button.addEventListener("click",()=>v6OpenCollectionEditor(button.dataset.newCollection,null,v6RenderCollections)));
  $$("[data-edit-collection]",host).forEach(button=>button.addEventListener("click",()=>{const group=groups.find(g=>g[0]===button.dataset.editCollection);const row=group?.[2].find(item=>String(item.id)===button.dataset.id);if(row)v6OpenCollectionEditor(button.dataset.editCollection,row,v6RenderCollections);}));
}
async function v6RenderBranding(){
  const host=$("#cmsMain");
  const [branding,assets,design]=await Promise.all([api("/api/settings/branding"),api("/api/settings/branding/assets"),api("/api/website-design-settings")]);
  const palette=[
    ["black",tr("Primary dark","Elsődleges sötét"),design.black||"#080807"],
    ["ivory",tr("Ivory","Elefántcsont"),design.ivory||"#f2efe8"],
    ["cream",tr("Cream","Krém"),design.cream||"#e8e1d5"],
    ["gold",tr("Accent","Kiemelő szín"),design.gold||"#b79a60"],
    ["gold_bright",tr("Bright accent","Világos kiemelés"),design.gold_bright||"#d9bd7a"],
    ["muted",tr("Muted text","Másodlagos szöveg"),design.muted||"#aaa49a"]
  ];
  host.innerHTML=`<div class="branding-grid">
    ${v6BrandAssetCard("websiteLogo",tr("Public website logo","Publikus weboldal logó"),design.logo_url,tr("Independent header logo on the public website.","A publikus weboldal önálló fejléc-logója."))}
    ${v6BrandAssetCard("websiteFavicon",tr("Public website favicon","Publikus weboldal favicon"),design.favicon_url,tr("Independent browser-tab icon for the public website.","A publikus weboldal önálló böngészőfül-ikonja."))}
    ${v6BrandAssetCard("erpLogoDark",tr("ERP logo · dark mode","ERP logó · sötét mód"),assets.erp_logo_dark_url,tr("ERP and login logo while dark mode is active.","ERP és login logó sötét módban."))}
    ${v6BrandAssetCard("erpLogoLight",tr("ERP logo · light mode","ERP logó · világos mód"),assets.erp_logo_light_url,tr("ERP and login logo while light mode is active.","ERP és login logó világos módban."))}
    ${v6BrandAssetCard("appIcon",tr("PWA / app icon","PWA / alkalmazásikon"),assets.app_icon_url,tr("Independent installed-app and touch icon.","Önálló telepített alkalmazás- és touch ikon."))}
    ${v6BrandAssetCard("loginBackground",tr("Login background","Login háttérkép"),assets.login_background_url,tr("Independent responsive background behind the login card.","Önálló reszponzív háttérkép a login kártya mögött."))}
  </div>
  <section class="panel website-design-panel"><div class="panel-head"><div><span class="eyebrow">${tr("PUBLIC WEBSITE DESIGN","PUBLIKUS WEBOLDAL DIZÁJN")}</span><h2>${tr("Colors & typography","Színek és tipográfia")}</h2></div></div>
    <form id="websiteDesignForm" class="website-design-form">
      <div class="design-color-grid">${palette.map(([key,label,value])=>`<label class="design-color-field"><input type="color" name="${key}" value="${esc(value)}"><span><strong>${esc(label)}</strong><small>${esc(value)}</small></span></label>`).join("")}</div>
      <div class="form-grid design-font-grid"><label class="field"><span>${tr("Display font","Címbetűtípus")}</span><input name="display" value="${esc(design.display||"Cormorant Garamond")}"></label><label class="field"><span>${tr("Body font","Szövegbetűtípus")}</span><input name="sans" value="${esc(design.sans||"Inter")}"></label></div>
      <div class="form-actions"><button class="primary-button" type="submit">${tr("Save website design","Weboldal-dizájn mentése")}</button></div>
    </form>
  </section>`;
  async function uploadBranding(endpoint,file){const form=new FormData();form.append("file",file);return api(endpoint,{method:"POST",body:form});}
  $("#websiteDesignForm")?.addEventListener("submit",async event=>{
    event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));
    try{await api("/api/website-design-settings",{method:"PUT",body:JSON.stringify({...design,...values,logo_url:design.logo_url||"",favicon_url:design.favicon_url||""})});toast(tr("Website design saved.","Weboldal-dizájn mentve."),"success");await v6RenderBranding();}catch(error){toast(humanError(error),"error");}
  });
  $$("[data-brand-file]",host).forEach(input=>input.addEventListener("change",async event=>{
    const file=event.currentTarget.files?.[0],kind=event.currentTarget.dataset.brandFile;if(!file)return;
    try{
      if(kind==="websiteLogo"){
        const out=await uploadBranding("/api/settings/branding/public-logo",file),url=out.absolute_url||out.url;
        await api("/api/website-design-settings",{method:"PUT",body:JSON.stringify({...design,logo_url:url})});
      }else if(kind==="websiteFavicon"){
        const out=await uploadBranding("/api/settings/branding/public-favicon",file),url=out.absolute_url||out.url;
        await api("/api/website-design-settings",{method:"PUT",body:JSON.stringify({...design,favicon_url:url})});
      }else if(kind==="erpLogoDark")await uploadBranding("/api/settings/branding/erp-logo-dark",file);
      else if(kind==="erpLogoLight")await uploadBranding("/api/settings/branding/erp-logo-light",file);
      else if(kind==="appIcon")await uploadBranding("/api/settings/branding/app-icon",file);
      else if(kind==="loginBackground"){
        const form=new FormData();form.append("background",file);await api("/api/settings/branding/background",{method:"POST",body:form});
      }
      toast(tr("Brand asset updated.","Arculati elem frissítve."),"success");await loadBranding();await v6RenderBranding();
    }catch(error){toast(humanError(error),"error");}
  }));
}
function v6BrandAssetCard(kind,title,url,description){
  return `<section class="panel branding-card"><div class="branding-preview ${kind==="loginBackground"?"wide":""}">${url?`<img src="${esc(url)}" alt="">`:`<div class="cms-media-empty">＋</div>`}</div><div><span class="eyebrow">${esc(kind.toUpperCase())}</span><h3>${esc(title)}</h3><p>${esc(description)}</p><label class="file-picker"><input type="file" accept="image/*" data-brand-file="${kind}"><span>↑ ${tr(url?"Replace":"Upload",url?"Csere":"Feltöltés")}</span></label></div></section>`;
}
const V6_ARCHIVE_CATEGORIES={
  deleted_invoice:["Invalidated / deleted invoices","Érvénytelenített / törölt számlák"],
  financial_document:["Financial documents","Pénzügyi dokumentumok"],
  contract:["Contracts","Szerződések"],
  intake_assessment:["Intake assessment PDFs","Igényfelmérési PDF-ek"],
  deleted_intake:["Deleted intake requests","Törölt igények"],
  exported_report:["Exported reports / PDFs","Exportált riportok / PDF-ek"],
  internal_correspondence:["Internal correspondence","Belső levelezés"],
  company_message:["Company messages","Vállalati üzenetek"],
  company_document:["Company documents","Vállalati dokumentumok"]
};
function v6ArchiveLabel(key){const pair=V6_ARCHIVE_CATEGORIES[key]||[key,key];return state.language==="hu"?pair[1]:pair[0];}
function v6ArchiveDate(value){try{return new Intl.DateTimeFormat(state.language==="hu"?"hu-HU":"en-US",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}catch(_error){return value||"";}}
async function v6DownloadArchive(row){
  try{
    const response=await fetch("/api/archive/documents/"+row.id+"/download",{headers:{Authorization:"Bearer "+state.token},cache:"no-store"});
    if(!response.ok){const payload=await response.json().catch(()=>({}));throw new Error(payload.error||("HTTP_"+response.status));}
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=row.original_name||row.title||"archive-document";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }catch(error){toast(humanError(error),"error");}
}
function v6OpenArchiveUpload(refresh){
  openDialog({title:tr("Add Archive Document","Archív dokumentum hozzáadása"),eyebrow:tr("DOCUMENT ARCHIVE","DOKUMENTUM ARCHÍVUM"),body:`<form id="archiveUploadForm" class="form-grid">
    <label class="field"><span>${tr("Category","Kategória")} *</span><select name="category" required><option value="financial_document">${v6ArchiveLabel("financial_document")}</option><option value="contract">${v6ArchiveLabel("contract")}</option><option value="exported_report">${v6ArchiveLabel("exported_report")}</option><option value="internal_correspondence">${v6ArchiveLabel("internal_correspondence")}</option><option value="company_message">${v6ArchiveLabel("company_message")}</option><option value="company_document">${v6ArchiveLabel("company_document")}</option></select></label>
    <label class="field"><span>${tr("File","Fájl")}</span><input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp,.gif"></label>
    <label class="field full"><span>${tr("Title","Cím")} *</span><input name="title" required autofocus></label>
    <label class="field full"><span>${tr("Description / note","Leírás / megjegyzés")}</span><textarea name="description"></textarea></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Archive","Archiválás")}</button></div></form>`});
  $("[data-close-dialog]").addEventListener("click",closeDialog);
  $("#archiveUploadForm").addEventListener("submit",async event=>{
    event.preventDefault();const form=event.currentTarget,data=new FormData(form);
    try{await api("/api/archive/documents",{method:"POST",body:data});closeDialog();toast(tr("Document archived.","Dokumentum archiválva."),"success");await refresh();}catch(error){toast(humanError(error),"error");}
  });
}
async function v6RenderArchive(target="#cmsMain"){
  const main=$(target);if(!main)return;
  state.archiveCategory=state.archiveCategory||"deleted_invoice";state.archiveQuery=state.archiveQuery||"";
  const data=await api("/api/archive/documents?category="+encodeURIComponent(state.archiveCategory)+"&q="+encodeURIComponent(state.archiveQuery));
  const rows=data.rows||[];
  main.innerHTML=`<section class="panel archive-center"><div class="archive-toolbar">
    <div><span class="eyebrow">${tr("DOCUMENT CUSTODY","DOKUMENTUMKEZELÉS")}</span><h2>${tr("Documents / Archive","Dokumentumok / Archívum")}</h2><p>${tr("Financial records, contracts, exported PDFs, intake assessments and internal documents stay searchable without polluting active operational lists.","A pénzügyi iratok, szerződések, exportált PDF-ek, igényfelmérések és belső dokumentumok kereshetők maradnak anélkül, hogy az aktív operatív listákat terhelnék.")}</p></div>
    <button id="archiveAddDocument" class="primary-button" type="button">＋ ${tr("Add document","Dokumentum hozzáadása")}</button>
  </div>
  <div class="archive-filters"><select id="archiveCategory">${Object.keys(V6_ARCHIVE_CATEGORIES).map(key=>`<option value="${key}" ${key===state.archiveCategory?"selected":""}>${esc(v6ArchiveLabel(key))}</option>`).join("")}</select><div class="search-field"><input id="archiveSearch" type="search" value="${esc(state.archiveQuery)}" placeholder="${tr("Search title, reference or file…","Keresés cím, hivatkozás vagy fájl alapján…")}"></div></div>
  <div class="archive-list">${rows.length?rows.map(row=>`<article class="archive-row"><div class="archive-row-icon">${row.category==="deleted_invoice"?"🧾":"📄"}</div><div class="archive-row-main"><div class="archive-row-title"><strong>${esc(row.title)}</strong><span class="badge">${esc(v6ArchiveLabel(row.category))}</span></div><small>${esc(v6ArchiveDate(row.archived_at))}${row.archived_by_name?" · "+esc(row.archived_by_name):""}${row.entity_id?" · #"+esc(row.entity_id):""}</small>${row.description?`<p>${esc(row.description)}</p>`:""}${row.original_name?`<small>📎 ${esc(row.original_name)}</small>`:""}</div><div class="archive-row-actions">${row.file_path?`<button class="secondary-button" type="button" data-archive-download="${row.id}">${tr("Download","Letöltés")}</button>`:""}<button class="text-button" type="button" data-archive-details="${row.id}">${tr("Details","Részletek")}</button></div></article>`).join(""):`<div class="empty-state">${tr("No archived records in this category.","Ebben a kategóriában nincs archivált tétel.")}</div>`}</div></section>`;
  $("#archiveCategory").addEventListener("change",async event=>{state.archiveCategory=event.target.value;state.archiveQuery="";await v6RenderArchive(target);});
  $("#archiveSearch").addEventListener("input",debounce(async event=>{state.archiveQuery=event.target.value.trim();await v6RenderArchive(target);},220));
  $("#archiveAddDocument").addEventListener("click",()=>v6OpenArchiveUpload(()=>v6RenderArchive(target)));
  $$("[data-archive-download]",main).forEach(button=>button.addEventListener("click",()=>v6DownloadArchive(rows.find(row=>String(row.id)===button.dataset.archiveDownload))));
  $$("[data-archive-details]",main).forEach(button=>button.addEventListener("click",()=>{
    const row=rows.find(item=>String(item.id)===button.dataset.archiveDetails),invoice=row?.metadata?.invoice,intake=row?.metadata?.intake,intakeItems=row?.metadata?.items||[];
    openDialog({title:row?.title||tr("Archive record","Archív tétel"),eyebrow:v6ArchiveLabel(row?.category||""),body:`<div class="archive-detail">${row?.description?`<p>${esc(row.description)}</p>`:""}${invoice?`<div class="invoice-detail-kpis"><div><small>${tr("Invoice","Számla")}</small><strong>${esc(invoice.invoice_number||"")}</strong></div><div><small>${tr("Client","Ügyfél")}</small><strong>${esc(invoice.counterparty_name||"")}</strong></div><div><small>${tr("Total","Összesen")}</small><strong>${typeof r3Money==="function"?r3Money(invoice.total_amount):esc(invoice.total_amount)}</strong></div></div>`:""}${intake?`<div class="invoice-detail-kpis"><div><small>${tr("Intake","Igényfelmérés")}</small><strong>#${esc(intake.id)}</strong></div><div><small>${tr("Client","Ügyfél")}</small><strong>${esc(intake.client_name||intake.raw_client_name||"—")}</strong></div><div><small>${tr("Estimated total","Becsült összeg")}</small><strong>${typeof r3Money==="function"?r3Money(intake.estimated_total):esc(intake.estimated_total)}</strong></div></div><div class="archive-intake-items">${intakeItems.map(item=>`<div><span>${esc(state.language==="hu"?item.item_title_hu:item.item_title_en)}</span><strong>${typeof r3Money==="function"?r3Money(item.price):esc(item.price)}</strong></div>`).join("")}</div>`:""}<div class="detail-note">${tr("Archived","Archiválva")}: ${esc(v6ArchiveDate(row?.archived_at))}</div></div>`});
  }));
}
async function renderDocuments(){
  const workspace=$("#workspace");if(!workspace)return;
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role)){
    workspace.innerHTML=pageHead(tr("Documents","Dokumentumok"),tr("Admin access is required for company document custody.","A vállalati dokumentumtárhoz admin jogosultság szükséges."))+"<section class='panel empty-state'>"+tr("You do not have access to company documents.","Nincs jogosultságod a vállalati dokumentumokhoz.")+"</section>";return;
  }
  workspace.innerHTML=pageHead(tr("Documents","Dokumentumok"),tr("Company document custody, financial records, contracts, intake PDFs and archived operational documents.","Vállalati dokumentumkezelés, pénzügyi iratok, szerződések, igényfelmérési PDF-ek és archivált operatív dokumentumok."))+"<div id='documentsMain'></div>";
  await v6RenderArchive("#documentsMain");
}

function v6RecoveryScopeLabel(scope){const labels={pages:[tr("Pages","Oldalak"),"▤"],collections:[tr("Pianos · Services · Artists · Reviews","Zongorák · Szolgáltatások · Művészek · Vélemények"),"◫"],branding:[tr("Branding & Login","Arculat és Login"),"◉"],all:[tr("Full website","Teljes weboldal"),"⚠"]};return labels[scope]||[scope,""];}
function v6OpenRecoveryConfirm({mode,scope="all",backup=null,refresh=v6RenderWebsiteRecovery}){
  const restore=mode==="restore",pair=v6RecoveryScopeLabel(scope),phrase=restore?"RESTORE WEBSITE":scope==="all"?"RESET WEBSITE":`RESET ${scope.toUpperCase()}`;
  openDialog({title:restore?tr("Restore website backup","Weboldal biztonsági mentés visszaállítása"):tr("Factory reset","Gyári visszaállítás"),eyebrow:restore?tr("WEBSITE RECOVERY","WEBOLDAL HELYREÁLLÍTÁS"):tr("DESTRUCTIVE ACTION","DESTRUKTÍV MŰVELET"),body:`<form id="websiteRecoveryConfirm" class="form-grid"><div class="detail-note full"><strong>${restore?tr("The current website state will be backed up automatically before restore.","A jelenlegi weboldalállapotról a visszaállítás előtt automatikus mentés készül."):tr("A full website backup will be created automatically before reset.","A visszaállítás előtt automatikusan teljes weboldal-mentés készül.")}</strong><small>${restore?tr("ERP operational data is not replaced. Website CMS data and linked CMS references are restored from the selected backup.","Az ERP operatív adatai nem kerülnek cserére. A Website CMS adatok és a hozzájuk tartozó CMS-kapcsolatok a kiválasztott mentésből állnak vissza."):tr("Only the selected Website CMS scope is reset. Clients, ERP pianos, jobs, finance and Messenger data are not deleted.","Csak a kiválasztott Website CMS terület áll gyári alapra. Az ügyfelek, ERP-zongorák, munkák, pénzügy és Messenger adatok nem törlődnek.")}</small></div>${backup?`<div class="full recovery-target"><span>${tr("Backup","Mentés")}</span><strong>${esc(backup.label||backup.id)}</strong><small>${esc(v6ArchiveDate(backup.created_at))}</small></div>`:`<div class="full recovery-target"><span>${tr("Scope","Terület")}</span><strong>${esc(pair[0])}</strong></div>`}<label class="field full"><span>${tr("Type the confirmation phrase","Írd be a megerősítő kifejezést")}: <strong>${esc(phrase)}</strong></span><input id="websiteRecoveryPhrase" autocomplete="off" required></label><label class="field full"><span>${tr("Reason / note (optional)","Indoklás / megjegyzés (opcionális)")}</span><textarea name="reason"></textarea></label><div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="danger-button" type="submit">${restore?tr("Restore backup","Mentés visszaállítása"):tr("Run factory reset","Gyári visszaállítás indítása")}</button></div></form>`});
  $("[data-close-dialog]")?.addEventListener("click",closeDialog);
  $("#websiteRecoveryConfirm")?.addEventListener("submit",async event=>{
    event.preventDefault();const confirmation=String($("#websiteRecoveryPhrase")?.value||"").trim(),reason=String(new FormData(event.currentTarget).get("reason")||"").trim(),button=event.currentTarget.querySelector('button[type="submit"]');
    if(confirmation!==phrase){toast(tr("Confirmation phrase does not match.","A megerősítő kifejezés nem egyezik."),"error");return;}
    button.disabled=true;
    try{
      if(restore)await api(`/api/website-recovery/backups/${encodeURIComponent(backup.id)}/restore`,{method:"POST",body:JSON.stringify({confirmation})});
      else await api("/api/website-recovery/factory-reset",{method:"POST",body:JSON.stringify({scope,confirmation,reason})});
      closeDialog();state.cmsDraft={};state.cmsPages=[];await loadBranding();toast(restore?tr("Website restored from backup.","A weboldal visszaállt a biztonsági mentésből."):tr("Factory reset completed.","A gyári visszaállítás befejeződött."),"success");await refresh();
    }catch(error){button.disabled=false;toast(humanError(error),"error");}
  });
}
async function v6RenderWebsiteRecovery(){
  const host=$("#cmsMain");if(!host)return;host.innerHTML=loading();
  const data=await api("/api/website-recovery"),backups=data.backups||[],last=data.last_backup||null,isSuper=state.user?.role==="SUPERADMIN"||Number(state.user?.is_superadmin||0)===1;
  const scopes=[["pages",tr("Pages","Oldalak"),tr("Published page overrides, routes, SEO and landing section state return to bundled defaults.","A publikált oldal-felülírások, útvonalak, SEO és landing szekciók visszaállnak a beépített alapokra.")],["collections",tr("Pianos · Services · Artists · Reviews","Zongorák · Szolgáltatások · Művészek · Vélemények"),tr("Website collections return to the bundled factory sample set. Operational records remain intact.","A weboldali gyűjtemények visszaállnak a gyári mintakészletre. Az operatív rekordok megmaradnak.")],["branding",tr("Branding & Login","Arculat és Login"),tr("Website design, logos, icons and login background return to factory defaults.","A weboldal-dizájn, logók, ikonok és login háttér visszaállnak gyári alapra.")]];
  host.innerHTML=`<div class="website-recovery"><section class="panel recovery-overview"><div class="panel-head"><div><span class="eyebrow">${tr("WEBSITE SAFETY","WEBOLDAL BIZTONSÁG")}</span><h2>${tr("Backup & factory recovery","Biztonsági mentés és gyári visszaállítás")}</h2><p>${tr("Website CMS recovery is isolated from ERP operational data.","A Website CMS helyreállítása elkülönül az ERP operatív adataitól.")}</p></div><button id="websiteBackupNow" class="primary-button" type="button">＋ ${tr("Create backup","Biztonsági mentés készítése")}</button></div><div class="recovery-last-backup"><small>${tr("Last backup","Legutóbbi biztonsági mentés")}</small><strong>${last?esc(v6ArchiveDate(last.created_at)):tr("No backup yet","Még nincs biztonsági mentés")}</strong>${last?`<span>${esc(last.trigger_type)} · ${esc(last.id)}</span>`:""}</div></section><div class="website-recovery-grid">${scopes.map(([scope,title,copy])=>`<section class="panel recovery-scope-card"><span class="eyebrow">${esc(scope.toUpperCase())}</span><h3>${esc(title)}</h3><p>${esc(copy)}</p><button class="secondary-button" type="button" data-factory-reset="${scope}">${tr("Reset this area","Terület gyári visszaállítása")}</button></section>`).join("")}<section class="panel recovery-scope-card recovery-danger-card"><span class="eyebrow">${tr("FULL WEBSITE","TELJES WEBOLDAL")}</span><h3>${tr("Full website factory reset","Teljes weboldal gyári visszaállítása")}</h3><p>${tr("Creates a pre-reset backup, then resets Pages, Collections and Branding together. ERP operational data remains untouched.","Pre-reset mentést készít, majd az Oldalak, Gyűjtemények és Arculat együtt áll gyári alapra. Az ERP operatív adatai érintetlenek maradnak.")}</p>${isSuper?`<button class="danger-button" type="button" data-factory-reset="all">${tr("Reset full website","Teljes weboldal visszaállítása")}</button>`:`<small>${tr("Superadmin permission required.","Szuperadmin jogosultság szükséges.")}</small>`}</section></div><section class="panel recovery-backup-list"><div class="panel-head"><div><h3>${tr("Website backups","Weboldal biztonsági mentések")}</h3><p>${tr("Every reset and restore creates an automatic safety snapshot.","Minden reset és restore automatikus biztonsági snapshotot készít.")}</p></div><span class="badge">${backups.length}</span></div><div class="backup-list">${backups.length?backups.map(row=>`<article class="backup-row"><div><strong>${esc(row.label||row.id)}</strong><small>${esc(v6ArchiveDate(row.created_at))} · ${esc(row.trigger_type)} · ${esc(row.scope)}</small><small>${tr("Pages","Oldalak")}: ${Number(row.metadata?.counts?.website_content_pages||0)} · ${tr("Services","Szolgáltatások")}: ${Number(row.metadata?.counts?.website_services||0)} · ${tr("Pianos","Zongorák")}: ${Number(row.metadata?.counts?.website_showroom_pianos||0)}</small></div>${isSuper?`<button class="secondary-button" type="button" data-website-restore="${esc(row.id)}">${tr("Restore","Visszaállítás")}</button>`:""}</article>`).join(""):`<div class="empty-state">${tr("No website backups yet.","Még nincs weboldal-biztonsági mentés.")}</div>`}</div></section></div>`;
  $("#websiteBackupNow")?.addEventListener("click",async()=>{const button=$("#websiteBackupNow");button.disabled=true;try{await api("/api/website-recovery/backups",{method:"POST",body:JSON.stringify({label:tr("Manual website backup","Manuális weboldal-mentés")})});toast(tr("Website backup created.","A weboldal biztonsági mentése elkészült."),"success");await v6RenderWebsiteRecovery();}catch(error){button.disabled=false;toast(humanError(error),"error");}});
  $$("[data-factory-reset]",host).forEach(button=>button.addEventListener("click",()=>v6OpenRecoveryConfirm({mode:"reset",scope:button.dataset.factoryReset})));
  $$("[data-website-restore]",host).forEach(button=>button.addEventListener("click",()=>{const backup=backups.find(row=>String(row.id)===button.dataset.websiteRestore);if(backup)v6OpenRecoveryConfirm({mode:"restore",backup});}));
}

renderCms=async function(){
  const workspace=$("#workspace");
  if(!["ADMIN","SUPERADMIN"].includes(state.user?.role)){workspace.innerHTML=pageHead(tr("Website CMS","Weboldal CMS"),tr("Admin access required.","Admin jogosultság szükséges."));return;}
  state.cmsMode=state.cmsMode||"pages";if(state.cmsMode==="archive")state.cmsMode="recovery";
  const meta=await api("/api/website-content/pages");state.cmsPages=meta.pages||[];if(!state.cmsPages.some(page=>page.page_key===state.cmsPage))state.cmsPage="home";
  workspace.innerHTML=pageHead(tr("Website CMS","Weboldal CMS"),tr("A visual mini-site builder for every public text, image and collection.","Vizuális mini weboldal-szerkesztő minden publikus szöveghez, képhez és gyűjteményhez."))+
    `<div class="cms-mode-tabs segmented-control"><button class="${state.cmsMode==="pages"?"active":""}" data-cms-mode="pages">${tr("Pages","Oldalak")}</button><button class="${state.cmsMode==="collections"?"active":""}" data-cms-mode="collections">${tr("Pianos · Services · Artists · Reviews","Zongorák · Szolgáltatások · Művészek · Vélemények")}</button><button class="${state.cmsMode==="branding"?"active":""}" data-cms-mode="branding">${tr("Branding & Login","Arculat és Login")}</button><button class="${state.cmsMode==="recovery"?"active":""}" data-cms-mode="recovery">↺ ${tr("Factory recovery","Gyári adatok visszaállítása")}</button></div><div id="cmsMain"></div>`;
  $$("[data-cms-mode]").forEach(button=>button.addEventListener("click",async()=>{state.cmsMode=button.dataset.cmsMode;await renderCms();}));
  const main=$("#cmsMain");
  if(state.cmsMode==="collections")return v6RenderCollections();
  if(state.cmsMode==="branding")return v6RenderBranding();
  if(state.cmsMode==="recovery")return v6RenderWebsiteRecovery();
  main.innerHTML=`<div class="cms-layout"><aside class="panel cms-sidebar" id="cmsPageList">${state.cmsPages.map(page=>`<button class="cms-page-button ${page.page_key===state.cmsPage?"active":""}" data-cms-page="${esc(page.page_key)}" type="button">${esc(state.language==="hu"?(page.title_hu||page.title_en||page.page_key):(page.title_en||page.page_key))}</button>`).join("")}</aside><section class="panel cms-editor" id="cmsEditor">${loading()}</section></div>`;
  $$("[data-cms-page]").forEach(button=>button.addEventListener("click",async()=>{state.cmsPage=button.dataset.cmsPage;await renderCms();}));
  await v6LoadCmsPage();
};

/* ---------- Intake Center / assessment / direct conversion ---------- */

function v6CatalogLabel(item){return state.language==="hu"?item.title_hu:item.title_en;}
function v6CatalogDescription(item){return state.language==="hu"?item.description_hu:item.description_en;}
function v6AssessmentIcon(item){
  const text=`${item?.category||""} ${item?.title_en||""} ${item?.title_hu||""}`.toLowerCase();
  if(text.includes("tuning")||text.includes("hangol"))return "◉";
  if(text.includes("mechan")||text.includes("regulat")||text.includes("mechanika"))return "⚙";
  if(text.includes("string")||text.includes("húr"))return "≋";
  if(text.includes("voic")||text.includes("inton"))return "◌";
  if(text.includes("clean")||text.includes("tiszt"))return "✦";
  return "◇";
}
function v6AssessmentRows(catalog,selectedItems=[]){
  const selected=new Map((selectedItems||[]).map(item=>[Number(item.catalog_item_id),item]));
  return `<div class="assessment-grid assessment-grid--continuous">${(catalog||[]).map(item=>{const chosen=selected.get(Number(item.id)),checked=Boolean(chosen),price=Number(chosen?.price??item.default_price??0);return `<label class="assessment-option ${checked?"selected":""}"><span class="assessment-option-category">${esc(item.category||"")}</span><input type="checkbox" data-assessment-check="${item.id}" ${checked?"checked":""}><span class="assessment-option-icon">${v6AssessmentIcon(item)}</span><strong>${esc(v6CatalogLabel(item))}</strong><small>${esc(v6CatalogDescription(item)||"")}</small><span class="assessment-price"><span>$</span><input data-assessment-price="${item.id}" type="number" min="0" step="0.01" value="${price.toFixed(2)}" ${checked?"":"disabled"}></span></label>`;}).join("")}</div>`;
}
function v6AssessmentCollect(){
  return $$("[data-assessment-check]:checked").map(box=>({catalog_item_id:Number(box.dataset.assessmentCheck),price:Number($(`[data-assessment-price="${box.dataset.assessmentCheck}"]`)?.value||0)}));
}
function v6AssessmentTotal(){return v6AssessmentCollect().reduce((sum,row)=>sum+Number(row.price||0),0);}
function v6AssessmentRefreshTotal(){const node=$("#assessmentTotal");if(node)node.textContent=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(v6AssessmentTotal());}
async function v6OpenIntakeCenter(){
  const rows=await api("/api/intake-catalog?include_inactive=1");
  openDialog({title:tr("Intake Center","Igényközpont"),eyebrow:tr("ASSESSMENT CATALOG","IGÉNYFELMÉRÉSI KATALÓGUS"),body:`<div class="intake-center"><div class="panel-head inline-panel-head"><p>${tr("Create reusable piano issue/work items with a default quoted price.","Hozz létre újrahasználható zongorahiba-/munkatételeket alapértelmezett ajánlati árral.")}</p><div class="page-actions"><button id="handoffPresetCenterBtn" class="secondary-button" type="button">⚙ ${tr("Handoff presets","Átadási presetek")}</button><button id="newCatalogItem" class="primary-button" type="button">＋ ${tr("New item","Új tétel")}</button></div></div><div class="catalog-admin-list">${rows.map(row=>`<button class="catalog-admin-row ${Number(row.active)?"":"inactive"}" type="button" data-catalog-edit="${row.id}"><span><strong>${esc(state.language==="hu"?row.title_hu:row.title_en)}</strong><small>${esc(row.category)} · ${r3Money(row.default_price)} · ${Number(row.active)?tr("Active","Aktív"):tr("Inactive","Inaktív")}</small></span><span>›</span></button>`).join("")||`<div class="empty-state">${tr("No catalog items yet.","Még nincs katalógustétel.")}</div>`}</div></div>`});
  const edit=row=>v6OpenCatalogEditor(row,v6OpenIntakeCenter);
  $("#handoffPresetCenterBtn").addEventListener("click",v6OpenHandoffPresetCenter);
  $("#newCatalogItem").addEventListener("click",()=>edit(null));
  $$("[data-catalog-edit]").forEach(button=>button.addEventListener("click",()=>edit(rows.find(row=>Number(row.id)===Number(button.dataset.catalogEdit)))));
}
function v6OpenCatalogEditor(row,back){
  openDialog({title:row?tr("Edit intake item","Igénytétel szerkesztése"):tr("New intake item","Új igénytétel"),eyebrow:tr("INTAKE CENTER","IGÉNYKÖZPONT"),body:`<form id="catalogEditor" class="form-grid">
    <label class="field"><span>${tr("Category","Kategória")} *</span><input name="category" value="${esc(row?.category||"")}" required></label><label class="field"><span>${tr("Default price","Alapár")} (USD) *</span><input name="default_price" type="number" min="0" step="0.01" value="${Number(row?.default_price||0)}" required></label>
    <label class="field"><span>Title EN *</span><input name="title_en" value="${esc(row?.title_en||"")}" required></label><label class="field"><span>Cím HU *</span><input name="title_hu" value="${esc(row?.title_hu||"")}" required></label>
    <label class="field full"><span>Description EN</span><textarea name="description_en">${esc(row?.description_en||"")}</textarea></label><label class="field full"><span>Leírás HU</span><textarea name="description_hu">${esc(row?.description_hu||"")}</textarea></label>
    <label class="cms-toggle-row full"><span>${tr("Active","Aktív")}</span><input name="active" type="checkbox" ${row?.active===0?"":"checked"}></label>
    <div class="form-actions full">${row?`<button id="deleteCatalogItem" class="danger-button" type="button">${tr("Delete / archive","Törlés / archiválás")}</button>`:""}<button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save","Mentés")}</button></div></form>`});
  $("#catalogEditor").addEventListener("submit",async event=>{event.preventDefault();const fd=new FormData(event.currentTarget),body=Object.fromEntries(fd);body.default_price=Number(body.default_price);body.active=fd.get("active")==="on";try{await api(row?`/api/intake-catalog/${row.id}`:"/api/intake-catalog",{method:row?"PUT":"POST",body:JSON.stringify(body)});toast(tr("Catalog item saved.","Katalógustétel mentve."),"success");await back();}catch(error){toast(humanError(error),"error");}});
  $("#deleteCatalogItem")?.addEventListener("click",async()=>{try{await api(`/api/intake-catalog/${row.id}`,{method:"DELETE"});toast(tr("Catalog item removed.","Katalógustétel eltávolítva."),"success");await back();}catch(error){toast(humanError(error),"error");}});
}
async function v6OpenHandoffPresetCenter(){
  const rows=await api("/api/handoff-presets?include_inactive=1");
  openDialog({title:tr("Handoff presets","Átadási presetek"),eyebrow:tr("WORKFLOW QUICK ENTRY","MUNKAFOLYAMAT GYORSBEVITEL"),body:`<div class="intake-center"><div class="panel-head inline-panel-head"><p>${tr("Reusable labor/material/duration values for fast mobile handoff.","Újrahasználható munka-/anyag-/időtartam értékek gyors mobilos átadáshoz.")}</p><div class="page-actions"><button id="inventoryCenterBtn" class="secondary-button" type="button">▦ ${tr("Inventory & procurement","Készlet és beszerzés")}</button><button id="newHandoffPreset" class="primary-button" type="button">＋ ${tr("New preset","Új preset")}</button></div></div><div class="catalog-admin-list">${rows.map(row=>`<button class="catalog-admin-row ${Number(row.active)?"":"inactive"}" type="button" data-handoff-preset-edit="${row.id}"><span><strong>${esc(state.language==="hu"?row.title_hu:row.title_en)}</strong><small>${r3Money(row.default_labor_cost)} + ${r3Money(row.default_material_cost)} ${tr("materials","anyag")} · ${Number(row.default_duration_min||0)} min</small></span><span>›</span></button>`).join("")||`<div class="empty-state">${tr("No handoff presets yet.","Még nincs átadási preset.")}</div>`}</div></div>`});
  const edit=row=>v6OpenHandoffPresetEditor(row,v6OpenHandoffPresetCenter);
  $("#inventoryCenterBtn").addEventListener("click",v6OpenInventoryCenter);
  $("#newHandoffPreset").addEventListener("click",()=>edit(null));
  $$("[data-handoff-preset-edit]").forEach(button=>button.addEventListener("click",()=>edit(rows.find(row=>Number(row.id)===Number(button.dataset.handoffPresetEdit)))));
}
async function v6OpenHandoffPresetEditor(row,back){
  const inventory=await api("/api/inventory").catch(()=>[]),selectedMaterials=new Map((row?.materials||[]).map(item=>[Number(item.inventory_item_id),Number(item.default_quantity||0)]));
  openDialog({title:row?tr("Edit handoff preset","Átadási preset szerkesztése"):tr("New handoff preset","Új átadási preset"),eyebrow:tr("WORKFLOW PRESET","MUNKAFOLYAMAT PRESET"),body:`<form id="handoffPresetEditor" class="form-grid">
    <label class="field"><span>Title EN *</span><input name="title_en" value="${esc(row?.title_en||"")}" required></label>
    <label class="field"><span>Cím HU *</span><input name="title_hu" value="${esc(row?.title_hu||"")}" required></label>
    <label class="field"><span>${tr("Labor","Munkadíj")} (USD)</span><input name="default_labor_cost" type="number" min="0" step="0.01" value="${Number(row?.default_labor_cost||0)}"></label>
    <label class="field"><span>${tr("Materials","Anyag")} (USD)</span><input name="default_material_cost" type="number" min="0" step="0.01" value="${Number(row?.default_material_cost||0)}"></label>
    <label class="field"><span>${tr("Duration","Időtartam")} (min)</span><input name="default_duration_min" type="number" min="0" step="15" value="${Number(row?.default_duration_min||0)}"></label>
    <label class="field"><span>${tr("Sort order","Sorrend")}</span><input name="sort_order" type="number" step="1" value="${Number(row?.sort_order||0)}"></label>
    <div class="full detail-note"><strong>${tr("Stock materials","Készletanyagok")}</strong><small>${tr("Checked materials are prefilled during mobile handoff and deducted only when the technician confirms the handoff.","A kijelölt anyagok mobil átadáskor előtöltődnek, és csak a technikus jóváhagyott átadásakor kerülnek levonásra.")}</small><div class="form-grid">${inventory.length?inventory.map(item=>`<label class="field"><span><input data-preset-material-check data-inventory-item-id="${Number(item.id)}" type="checkbox" ${selectedMaterials.has(Number(item.id))?"checked":""}> ${esc(state.language==="hu"?item.name_hu:item.name_en)} · ${esc(item.sku)} <small>${tr("on hand","készleten")}: ${Number(item.quantity_on_hand||0)} ${esc(item.unit||"")}</small></span><input data-preset-material-qty data-inventory-item-id="${Number(item.id)}" type="number" min="0.01" step="0.01" value="${selectedMaterials.get(Number(item.id))||1}"></label>`).join(""):`<p>${tr("No inventory items yet. Add stock items from Inventory & procurement first.","Még nincs készlettétel. Előbb adj hozzá tételt a Készlet és beszerzés felületen.")}</p>`}</div></div>
    <label class="cms-toggle-row full"><span>${tr("Active","Aktív")}</span><input name="active" type="checkbox" ${row?.active===0?"":"checked"}></label>
    <div class="form-actions full">${row?`<button id="archiveHandoffPreset" class="danger-button" type="button">${tr("Archive","Archiválás")}</button>`:""}<button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save","Mentés")}</button></div>
  </form>`});
  $("#handoffPresetEditor").addEventListener("submit",async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget),body=Object.fromEntries(fd);
    body.default_labor_cost=Number(body.default_labor_cost||0);body.default_material_cost=Number(body.default_material_cost||0);body.default_duration_min=Number(body.default_duration_min||0);body.sort_order=Number(body.sort_order||0);body.active=fd.get("active")==="on";
    body.materials=$$("[data-preset-material-check]",event.currentTarget).filter(input=>input.checked).map(input=>{const id=Number(input.dataset.inventoryItemId),qty=event.currentTarget.querySelector(`[data-preset-material-qty][data-inventory-item-id="${id}"]`);return {inventory_item_id:id,default_quantity:Number(qty?.value||0)};}).filter(item=>item.inventory_item_id&&item.default_quantity>0);
    try{await api(row?`/api/handoff-presets/${row.id}`:"/api/handoff-presets",{method:row?"PUT":"POST",body:JSON.stringify(body)});toast(tr("Handoff preset saved.","Átadási preset mentve."),"success");await back();}catch(error){toast(humanError(error),"error");}
  });
  $("#archiveHandoffPreset")?.addEventListener("click",async()=>{try{await api(`/api/handoff-presets/${row.id}`,{method:"DELETE"});toast(tr("Handoff preset archived.","Átadási preset archiválva."),"success");await back();}catch(error){toast(humanError(error),"error");}});
}
async function v6OpenInventoryCenter(){
  const [items,requests]=await Promise.all([api("/api/inventory?include_inactive=1"),api("/api/purchase-requests")]);
  openDialog({title:tr("Inventory & procurement","Készlet és beszerzés"),eyebrow:tr("WORKSHOP MATERIALS","MŰHELY ANYAGOK"),body:`<div class="intake-center"><div class="panel-head inline-panel-head"><p>${tr("Stock is deducted only from confirmed handoffs. Low stock creates a purchase request; it never purchases automatically.","A készlet csak jóváhagyott átadáskor csökken. Alacsony készlet beszerzési igényt hoz létre, automatikus vásárlás nincs.")}</p><button id="newInventoryItem" class="primary-button" type="button">＋ ${tr("New stock item","Új készlettétel")}</button></div><div class="catalog-admin-list">${items.map(item=>`<button class="catalog-admin-row ${Number(item.active)?"":"inactive"}" type="button" data-inventory-edit="${item.id}"><span><strong>${esc(item.sku)} · ${esc(state.language==="hu"?item.name_hu:item.name_en)}</strong><small>${Number(item.quantity_on_hand||0)} ${esc(item.unit||"")} · ${tr("reorder at","újrarendelés")}: ${Number(item.reorder_point||0)} · ${r3Money(item.unit_cost||0)}/${esc(item.unit||"")}</small></span><span>›</span></button>`).join("")||`<div class="empty-state">${tr("No stock items yet.","Még nincs készlettétel.")}</div>`}</div><div class="panel-head"><h3>${tr("Purchase requests","Beszerzési igények")}</h3></div><div class="catalog-admin-list">${requests.map(req=>`<button class="catalog-admin-row" type="button" data-purchase-request="${req.id}"><span><strong>#${req.id} · ${esc(req.sku)} · ${esc(state.language==="hu"?req.name_hu:req.name_en)}</strong><small>${esc(req.status)} · ${Number(req.requested_quantity||0)} ${esc(req.unit||"")} · ${tr("on hand","készleten")}: ${Number(req.quantity_on_hand||0)}</small></span><span>›</span></button>`).join("")||`<div class="empty-state">${tr("No purchase requests.","Nincs beszerzési igény.")}</div>`}</div></div>`});
  $("#newInventoryItem").addEventListener("click",()=>v6OpenInventoryItemEditor(null));
  $$("[data-inventory-edit]").forEach(button=>button.addEventListener("click",()=>v6OpenInventoryItemEditor(items.find(item=>Number(item.id)===Number(button.dataset.inventoryEdit)))));
  $$("[data-purchase-request]").forEach(button=>button.addEventListener("click",()=>v6OpenPurchaseRequestEditor(requests.find(item=>Number(item.id)===Number(button.dataset.purchaseRequest)))));
}
function v6OpenInventoryItemEditor(row){
  openDialog({title:row?tr("Edit stock item","Készlettétel szerkesztése"):tr("New stock item","Új készlettétel"),eyebrow:tr("INVENTORY","KÉSZLET"),body:`<form id="inventoryItemEditor" class="form-grid"><label class="field"><span>SKU *</span><input name="sku" required value="${esc(row?.sku||"")}"></label><label class="field"><span>Name EN *</span><input name="name_en" required value="${esc(row?.name_en||"")}"></label><label class="field"><span>Név HU *</span><input name="name_hu" required value="${esc(row?.name_hu||"")}"></label><label class="field"><span>${tr("Unit","Egység")}</span><input name="unit" value="${esc(row?.unit||"pcs")}"></label>${row?`<label class="field"><span>${tr("On hand","Készleten")}</span><input value="${Number(row.quantity_on_hand||0)}" disabled></label><label class="field"><span>${tr("Stock adjustment (+ / -)","Készletkorrekció (+ / -)")}</span><input name="quantity_adjustment" type="number" step="0.01" value="0"></label>`:`<label class="field"><span>${tr("Opening quantity","Nyitókészlet")}</span><input name="quantity_on_hand" type="number" min="0" step="0.01" value="0"></label>`}<label class="field"><span>${tr("Reorder point","Újrarendelési pont")}</span><input name="reorder_point" type="number" min="0" step="0.01" value="${Number(row?.reorder_point||0)}"></label><label class="field"><span>${tr("Reorder quantity","Újrarendelési mennyiség")}</span><input name="reorder_quantity" type="number" min="0.01" step="0.01" value="${Number(row?.reorder_quantity||1)}"></label><label class="field"><span>${tr("Unit cost","Egységköltség")} USD</span><input name="unit_cost" type="number" min="0" step="0.01" value="${Number(row?.unit_cost||0)}"></label><label class="cms-toggle-row full"><span>${tr("Active","Aktív")}</span><input name="active" type="checkbox" ${row?.active===0?"":"checked"}></label><div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Save","Mentés")}</button></div></form>`});
  $("#inventoryItemEditor").addEventListener("submit",async event=>{event.preventDefault();const fd=new FormData(event.currentTarget),body=Object.fromEntries(fd),adjustment=Number(body.quantity_adjustment||0);body.quantity_on_hand=Number(body.quantity_on_hand||0);body.reorder_point=Number(body.reorder_point||0);body.reorder_quantity=Number(body.reorder_quantity||0);body.unit_cost=Number(body.unit_cost||0);body.active=fd.get("active")==="on";delete body.quantity_adjustment;try{const saved=await api(row?`/api/inventory/${row.id}`:"/api/inventory",{method:row?"PUT":"POST",body:JSON.stringify(body)});if(row&&adjustment)await api(`/api/inventory/${row.id}/adjust`,{method:"POST",body:JSON.stringify({quantity_delta:adjustment,movement_type:"adjustment",reference:"admin-ui"})});toast(tr("Inventory saved.","Készlet mentve."),"success");await v6OpenInventoryCenter();}catch(error){toast(humanError(error),"error");}});
}
function v6OpenPurchaseRequestEditor(row){
  if(!row)return;openDialog({title:tr("Purchase request","Beszerzési igény")+" #"+row.id,eyebrow:esc(row.sku||""),body:`<form id="purchaseRequestEditor" class="form-grid"><div class="detail-note full">${tr("Requested","Igényelt")}: <strong>${Number(row.requested_quantity||0)} ${esc(row.unit||"")}</strong> · ${tr("Current stock","Jelenlegi készlet")}: <strong>${Number(row.quantity_on_hand||0)} ${esc(row.unit||"")}</strong></div><label class="field"><span>${tr("Next status","Következő státusz")}</span><select name="status"><option value="approved">${tr("Approved","Jóváhagyva")}</option><option value="ordered">${tr("Ordered","Megrendelve")}</option><option value="received">${tr("Received","Beérkezett")}</option><option value="cancelled">${tr("Cancelled","Törölve")}</option></select></label><label class="field"><span>${tr("Received quantity","Beérkezett mennyiség")}</span><input name="received_quantity" type="number" min="0.01" step="0.01" value="${Number(row.requested_quantity||0)}"></label><label class="field full"><span>${tr("Note","Megjegyzés")}</span><textarea name="note"></textarea></label><div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Update","Frissítés")}</button></div></form>`});
  $("#purchaseRequestEditor").addEventListener("submit",async event=>{event.preventDefault();const fd=new FormData(event.currentTarget),body=Object.fromEntries(fd);body.received_quantity=Number(body.received_quantity||0);try{await api(`/api/purchase-requests/${row.id}/status`,{method:"POST",body:JSON.stringify(body)});toast(tr("Purchase request updated.","Beszerzési igény frissítve."),"success");await v6OpenInventoryCenter();}catch(error){toast(humanError(error),"error");}});
}


renderIntake=async function(){
  const workspace=$("#workspace"),[intake,clients]=await Promise.all([api("/api/intake"),loadClients(),loadUsers()]);
  state.intake=intake;const open=intake.filter(row=>["new","under_review"].includes(row.status)),urgent=open.filter(row=>row.estimated_urgency==="urgent"),admin=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  workspace.innerHTML=pageHead(tr("Intake","Igényfelmérés"),tr("Structured assessment, media and pricing before work is approved.","Strukturált felmérés, média és árazás a munka jóváhagyása előtt."),`${admin?`<button id="intakeCenterBtn" class="secondary-button" type="button">⚙ ${tr("Intake Center","Igényközpont")}</button>`:""}<button id="newIntakeBtn" class="primary-button" type="button">＋ ${tr("New intake","Új igény")}</button>`)+
    `<div class="stats-grid"><div class="stat-card"><small>${tr("Open","Nyitott")}</small><strong>${open.length}</strong></div><div class="stat-card"><small>${tr("Urgent","Sürgős")}</small><strong>${urgent.length}</strong></div><div class="stat-card"><small>${tr("Converted","Konvertált")}</small><strong>${intake.filter(row=>row.status==="converted").length}</strong></div><div class="stat-card"><small>${tr("Estimated open value","Nyitott becsült érték")}</small><strong>${r3Money(open.reduce((sum,row)=>sum+Number(row.estimated_total||0),0))}</strong></div></div>
    <div class="intake-toolbar"><div class="search-field"><input id="intakeSearch" type="search" placeholder="${tr("Search name, issue or contact…","Keresés név, probléma vagy kontakt alapján…")}"></div><select id="intakeStatusFilter"><option value="">${tr("All statuses","Minden státusz")}</option><option value="new">${tr("New","Új")}</option><option value="under_review">${tr("Under review","Ellenőrzés alatt")}</option><option value="converted">${tr("Converted","Konvertált")}</option><option value="archived">${tr("Archived","Archivált")}</option></select></div><div id="intakeList" class="intake-list"></div>`;
  $("#newIntakeBtn").addEventListener("click",openIntakeDialog);$("#intakeCenterBtn")?.addEventListener("click",v6OpenIntakeCenter);
  $("#intakeSearch").addEventListener("input",v6RenderIntakeList);$("#intakeStatusFilter").addEventListener("change",v6RenderIntakeList);v6RenderIntakeList();
  if(state.pendingIntakeEditId){const pending=state.intake.find(row=>Number(row.id)===Number(state.pendingIntakeEditId));state.pendingIntakeEditId=null;if(pending)await openIntakeDialog({lead:pending});}
};
function v6RenderIntakeList(){
  const host=$("#intakeList"),q=String($("#intakeSearch")?.value||"").trim().toLowerCase(),status=$("#intakeStatusFilter")?.value||"";
  const rows=state.intake.filter(row=>(!status||row.status===status)&&(!q||`${row.raw_client_name||""} ${row.client_name||""} ${row.raw_contact||""} ${row.reported_issue||""}`.toLowerCase().includes(q)));
  host.innerHTML=rows.length?rows.map(row=>`<article class="intake-card ${esc(row.estimated_urgency)}"><div class="urgency-bar"></div><div><h3>${esc(row.client_name||row.raw_client_name||tr("New prospect","Új érdeklődő"))}</h3><p>${esc(row.reported_issue)}</p><div class="intake-meta"><span class="badge">${esc(intakeStatusLabel(row.status))}</span><span class="badge">📎 ${Array.isArray(row.media_urls)?row.media_urls.length:0}</span><span class="badge estimate-badge">${tr("Estimate","Becsült ár")}: ${r3Money(row.estimated_total||0)}</span></div></div><div class="intake-card-actions">${row.status!=="converted"?`<button class="secondary-button icon-text-button" type="button" data-intake-edit="${row.id}">✎ ${tr("Edit","Szerkesztés")}</button>`:""}<button class="secondary-button icon-text-button" type="button" data-intake-pdf="${row.id}" title="${tr("Export PDF and archive it","PDF export és archiválás")}">📄 PDF</button><button class="secondary-button icon-text-button" type="button" data-intake-send="${row.id}">✉ ${tr("Send assessment","Felmérés küldése")}</button>${row.job_id?`<button class="secondary-button" type="button" data-nav="planned">✓ ${esc(row.job_code||tr("Job","Munka"))}</button>`:row.status!=="archived"?`<button class="primary-button" type="button" data-convert-job="${row.id}">${tr("Approve / create job","Jóváhagyás / munka létrehozása")}</button>`:""}</div></article>`).join(""):`<section class="panel empty-state">${tr("No intake requests to display.","Nincs megjeleníthető igény.")}</section>`;
  $$("[data-convert-job]",host).forEach(button=>button.addEventListener("click",()=>openConvertToJobDialog(state.intake.find(row=>Number(row.id)===Number(button.dataset.convertJob)))));
  $$("[data-intake-edit]",host).forEach(button=>button.addEventListener("click",()=>openIntakeDialog({lead:state.intake.find(row=>Number(row.id)===Number(button.dataset.intakeEdit))})));
  $$("[data-intake-pdf]",host).forEach(button=>button.addEventListener("click",()=>v6ExportIntakePdf(Number(button.dataset.intakePdf))));
  $$("[data-intake-send]",host).forEach(button=>button.addEventListener("click",()=>v6OpenSendAssessment(state.intake.find(row=>Number(row.id)===Number(button.dataset.intakeSend)))));
}
async function v6ExportIntakePdf(id){
  try{
    const response=await fetch("/api/intake/"+id+"/export-pdf",{method:"POST",headers:{Authorization:"Bearer "+state.token},cache:"no-store"});
    if(!response.ok){const payload=await response.json().catch(()=>({}));throw new Error(payload.error||("HTTP_"+response.status));}
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download="intake-assessment-"+id+".pdf";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
    toast(tr("Assessment PDF exported and saved to Documents.","Az igényfelmérési PDF elkészült és a Dokumentumok közé került."),"success");
  }catch(error){toast(humanError(error),"error");}
}
async function v6OpenSendAssessment(lead){
  if(!lead)return;
  const suggested=String(lead.client_email||lead.raw_contact||"").includes("@")?String(lead.client_email||lead.raw_contact||""):"";
  openDialog({title:tr("Send assessment","Igényfelmérés küldése"),eyebrow:tr("CUSTOMER COMMUNICATION","ÜGYFÉLKOMMUNIKÁCIÓ"),body:`<form id="sendAssessmentForm" class="form-grid">
    <label class="field full"><span>${tr("Recipient email","Címzett e-mail")} *</span><input name="recipient_email" type="email" required value="${esc(suggested)}" autocomplete="email"></label>
    <label class="field"><span>${tr("Language","Nyelv")}</span><select name="language"><option value="en" ${(lead.client_preferred_language||state.language)==="en"?"selected":""}>English</option><option value="hu" ${(lead.client_preferred_language||state.language)==="hu"?"selected":""}>Magyar</option></select></label>
    <label class="field"><span>${tr("PDF attachment","PDF melléklet")}</span><select name="attach_pdf"><option value="yes">${tr("Attach PDF","PDF csatolása")}</option><option value="no">${tr("Email summary only","Csak e-mail összefoglaló")}</option></select></label>
    <label class="field full"><span>${tr("Optional message","Opcionális üzenet")}</span><textarea name="message" placeholder="${tr("Add a short personal note if needed…","Szükség esetén írj rövid személyes üzenetet…")}"></textarea></label>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">✉ ${tr("Send assessment","Felmérés küldése")}</button></div>
  </form>`});
  $("#sendAssessmentForm").addEventListener("submit",async event=>{
    event.preventDefault();const form=new FormData(event.currentTarget),button=event.currentTarget.querySelector('button[type="submit"]');
    const body={recipient_email:String(form.get("recipient_email")||"").trim(),language:String(form.get("language")||"en"),message:String(form.get("message")||""),attach_pdf:form.get("attach_pdf")!=="no"};
    button.disabled=true;
    try{
      await api(`/api/intake/${lead.id}/send-assessment`,{method:"POST",body:JSON.stringify(body)});
      closeDialog();toast(tr("Assessment sent and archived.","Az igényfelmérés elküldve és archiválva."),"success");await renderIntake();
    }catch(error){button.disabled=false;toast(humanError(error),"error");}
  });
}
openIntakeDialog=async function(options={}){
  const lead=options?.lead||null,seed=options?.seed||{},editing=Boolean(lead),base=lead||seed||{};
  const [catalog,assessment]=await Promise.all([api("/api/intake-catalog"),editing?api(`/api/intake/${lead.id}/assessment`):Promise.resolve({items:[],estimated_total:0}),loadUsers()]);
  const technicianOptions=state.users.filter(user=>["WORKER","MANAGER","ADMIN"].includes(user.role)).map(user=>`<option value="${esc(user.id)}" ${String(base.assigned_technician_id||"")===String(user.id)?"selected":""}>${esc(user.name)}</option>`).join("");
  const existingMedia=Array.isArray(base.media_urls)?base.media_urls:[],sourceConversationId=options.sourceConversationId||base.source_conversation_id||"";
  openDialog({title:editing?tr("Edit intake","Igény szerkesztése"):tr("New intake","Új igény"),eyebrow:sourceConversationId?"MESSENGER → INTAKE":tr("STRUCTURED ASSESSMENT","STRUKTURÁLT FELMÉRÉS"),body:`<form id="intakeEditor" class="form-grid">
    ${sourceConversationId?`<div class="detail-note full"><strong>${tr("Messenger source linked","Messenger forrás kapcsolva")}</strong><small>${tr("Review every field before saving. No Job is created from this step.","Mentés előtt ellenőrizd az összes mezőt. Ebből a lépésből még nem jön létre munka.")}</small></div>`:""}
    <label class="field full typeahead-field"><span>${tr("Find existing client — name, phone or email","Meglévő ügyfél — név, telefon vagy e-mail")}</span><input id="intakeClientSearch" autocomplete="off" value="${esc(base.client_name||base.raw_client_name||"")}" placeholder="${tr("Start typing…","Kezdj el gépelni…")}"><div id="intakeClientSuggestions" class="typeahead-menu hidden"></div></label><input type="hidden" name="client_id" id="intakeClientId" value="${esc(base.client_id||"")}"><input type="hidden" name="source_conversation_id" value="${esc(sourceConversationId)}">
    <label class="field full ${base.client_id?"":"hidden"}" id="intakePianoField"><span>${tr("Client piano","Ügyfél zongorája")}</span><select name="piano_id" id="intakePianoSelect"><option value="">${tr("Select later / new piano","Később választom / új zongora")}</option></select></label>
    <label class="field"><span>${tr("New / raw client name","Új / nyers név")}</span><input name="raw_client_name" id="rawClientName" value="${esc(base.raw_client_name||base.client_name||"")}"></label><label class="field"><span>${tr("Contact","Kontakt")}</span><input name="raw_contact" id="rawContact" value="${esc(base.raw_contact||base.client_email||base.client_phone||"")}"></label>
    <label class="field"><span>${tr("Service location","Helyszín")}</span><select name="service_location"><option value="workshop" ${(base.service_location||"workshop")==="workshop"?"selected":""}>${tr("Workshop","Műhely")}</option><option value="on_site" ${base.service_location==="on_site"?"selected":""}>${tr("On site","Helyszíni")}</option></select></label><label class="field"><span>${tr("Urgency","Sürgősség")}</span><select name="estimated_urgency"><option value="low" ${base.estimated_urgency==="low"?"selected":""}>${tr("Low","Alacsony")}</option><option value="normal" ${!base.estimated_urgency||base.estimated_urgency==="normal"?"selected":""}>${tr("Normal","Normál")}</option><option value="urgent" ${base.estimated_urgency==="urgent"?"selected":""}>${tr("Urgent","Sürgős")}</option></select></label>
    <label class="field full"><span>${tr("Technician","Technikus")}</span><select name="assigned_technician_id"><option value="">${tr("Unassigned","Nincs kiosztva")}</option>${technicianOptions}</select></label>
    <label class="field full"><span>${tr("Requested service / issue","Jelzett probléma / igény")} *</span><textarea name="reported_issue" required>${esc(base.reported_issue||"")}</textarea></label>
    <section class="full assessment-panel"><div class="assessment-head"><div><span class="eyebrow">${tr("PIANO ASSESSMENT","ZONGORAFELMÉRÉS")}</span><h3>${tr("Select required work","Válaszd ki a szükséges munkákat")}</h3></div><div class="assessment-total"><small>${tr("Estimated total","Becsült összeg")}</small><strong id="assessmentTotal">${r3Money(assessment.estimated_total||0)}</strong></div></div>${v6AssessmentRows(catalog,assessment.items||[])}</section>
    <label class="field full"><span>${tr("Photos / videos","Fotók / videók")}</span><label class="file-picker large"><input id="intakeMediaFiles" type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm"><span>↑ ${tr("Choose photos or videos","Fotók vagy videók kiválasztása")}</span></label><small id="intakeMediaCount">${existingMedia.length?`${existingMedia.length} ${tr("existing files preserved","meglévő fájl megtartva")}`:""}</small></label>
    <div class="form-actions full">${editing?`<button id="intakeDeleteButton" type="button" class="danger-button">${tr("Delete intake","Igény törlése")}</button>`:""}<button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${editing?tr("Save changes","Módosítások mentése"):tr("Save intake","Igény rögzítése")}</button></div>${editing?`<div id="intakeDeletePanel" class="detail-note full hidden"><strong>${tr("Delete and archive this intake?","Törlöd és archiválod ezt az igényt?")}</strong><small>${tr("The client and linked operational records remain. A full snapshot and PDF will be stored under Documents → Deleted intake requests.","Az ügyfél és a kapcsolódó operatív adatok megmaradnak. Teljes snapshot és PDF kerül a Dokumentumok → Törölt igények kategóriába.")}</small><label class="field"><span>${tr("Reason (optional)","Indoklás (opcionális)")}</span><input id="intakeDeleteReason" maxlength="3000"></label><div class="form-actions"><button id="intakeDeleteCancel" type="button" class="secondary-button">${tr("Keep intake","Igény megtartása")}</button><button id="intakeDeleteConfirm" type="button" class="danger-button">${tr("Delete and archive","Törlés és archiválás")}</button></div></div>`:""}</form>`});
  const search=$("#intakeClientSearch"),suggestions=$("#intakeClientSuggestions"),clientId=$("#intakeClientId"),pianoField=$("#intakePianoField"),pianoSelect=$("#intakePianoSelect");
  async function populatePianos(client,selectedPianoId=null){const pianos=await api(`/api/clients/${client.id}/pianos`);pianoField.classList.remove("hidden");pianoSelect.innerHTML=`<option value="">${tr("Select later / new piano","Később választom / új zongora")}</option>`+pianos.map(p=>`<option value="${p.id}" ${String(selectedPianoId||"")===String(p.id)?"selected":""}>${esc([p.brand,p.model,p.serial_number].filter(Boolean).join(" · "))}</option>`).join("");}
  async function selectClient(client,selectedPianoId=null){clientId.value=client.id;search.value=client.name;suggestions.classList.add("hidden");$("#rawClientName").value=client.name;$("#rawContact").value=client.email||client.phone||"";await populatePianos(client,selectedPianoId);}
  if(base.client_id){const client=(await loadClients()).find(row=>Number(row.id)===Number(base.client_id));if(client)await selectClient(client,base.piano_id);}
  search.addEventListener("input",debounce(async event=>{const q=event.target.value.trim();clientId.value="";pianoField.classList.add("hidden");if(q.length<2){suggestions.classList.add("hidden");return;}const clients=await loadClients(q);suggestions.innerHTML=clientSuggestionMarkup(clients);suggestions.classList.toggle("hidden",!clients.length);$$("[data-intake-client]",suggestions).forEach(button=>button.addEventListener("click",()=>selectClient(clients.find(c=>Number(c.id)===Number(button.dataset.intakeClient)))));},160));
  $$("[data-assessment-check]").forEach(box=>box.addEventListener("change",()=>{const price=$(`[data-assessment-price="${box.dataset.assessmentCheck}"]`);if(price)price.disabled=!box.checked;box.closest(".assessment-option")?.classList.toggle("selected",box.checked);v6AssessmentRefreshTotal();}));
  $$("[data-assessment-price]").forEach(input=>input.addEventListener("input",v6AssessmentRefreshTotal));v6AssessmentRefreshTotal();
  $("#intakeMediaFiles").addEventListener("change",event=>{$("#intakeMediaCount").textContent=`${existingMedia.length+event.currentTarget.files.length} ${tr("files total","fájl összesen")}`;});
  if(editing){
    $("#intakeDeleteButton")?.addEventListener("click",()=>$("#intakeDeletePanel")?.classList.remove("hidden"));
    $("#intakeDeleteCancel")?.addEventListener("click",()=>$("#intakeDeletePanel")?.classList.add("hidden"));
    $("#intakeDeleteConfirm")?.addEventListener("click",async()=>{
      const button=$("#intakeDeleteConfirm"),reason=String($("#intakeDeleteReason")?.value||"").trim();button.disabled=true;
      try{
        await api(`/api/intake/${lead.id}`,{method:"DELETE",body:JSON.stringify({reason})});
        closeDialog();toast(tr("Intake deleted and archived.","Az igény törölve és archiválva."),"success");await renderIntake();
      }catch(error){button.disabled=false;toast(humanError(error),"error");}
    });
  }
  $("#intakeEditor").addEventListener("submit",async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));if(!body.client_id)delete body.client_id;if(!body.piano_id)delete body.piano_id;if(!body.assigned_technician_id)delete body.assigned_technician_id;if(!body.source_conversation_id)delete body.source_conversation_id;
    const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const files=[...$("#intakeMediaFiles").files||[]];let uploaded=[];if(files.length){const data=new FormData();files.forEach(file=>data.append("media",file));uploaded=(await api("/api/intake/media",{method:"POST",body:data})).urls||[];}body.media_urls=[...existingMedia,...uploaded];
      const saved=await api(editing?`/api/intake/${lead.id}`:"/api/intake",{method:editing?"PUT":"POST",body:JSON.stringify(body)});
      const items=v6AssessmentCollect();await api(`/api/intake/${saved.id}/assessment`,{method:"PUT",body:JSON.stringify({items})});
      closeDialog();if(typeof options.onSaved==="function")await options.onSaved(saved);else{toast(editing?tr("Intake updated.","Igény frissítve."):tr("Intake saved.","Igény rögzítve."),"success");await renderIntake();}
    }catch(error){button.disabled=false;toast(humanError(error),"error");}
  });
};
openConvertToJobDialog=async function(lead){
  const [assessment,settings]=await Promise.all([api(`/api/intake/${lead.id}/assessment`),api("/api/workflow/settings"),loadUsers()]);
  state.r2Workflow={...(state.r2Workflow||{}),stages:settings.stages};const pianos=lead.client_id?await api(`/api/clients/${lead.client_id}/pianos`):[],pianoOptions=pianos.map(p=>`<option value="${p.id}">${esc([p.brand,p.model,p.serial_number].filter(Boolean).join(" · "))}</option>`).join("");
  openDialog({title:tr("Approve intake & create job","Igény jóváhagyása és munka létrehozása"),eyebrow:tr("ONE-STEP CONVERSION","EGYLÉPÉSES KONVERZIÓ"),body:`<form id="convertJobEditor" class="form-grid">
    <div class="full intake-quote-summary"><span>${tr("Estimated quoted work","Becsült ajánlati munka")}</span><strong>${r3Money(assessment.estimated_total||0)}</strong><div>${assessment.items.map(item=>`<small>${esc(state.language==="hu"?item.item_title_hu:item.item_title_en)} · ${r3Money(item.price)}</small>`).join("")}</div></div>
    ${lead.client_id?`<div class="full detail-note"><strong>${tr("Client","Ügyfél")}:</strong> ${esc(lead.client_name||lead.raw_client_name||lead.client_id)}</div>`:`<label class="field"><span>${tr("Client name","Ügyfél neve")} *</span><input name="client_name" value="${esc(lead.raw_client_name||"")}" required></label><label class="field"><span>${tr("Piano location / address","Zongora helye / cím")} *</span><input name="client_address" required></label><label class="field"><span>Email</span><input name="client_email" type="email"></label><label class="field"><span>${tr("Phone","Telefon")}</span><input name="client_phone"></label>`}
    ${lead.piano_id?`<div class="full detail-note">${tr("Piano already linked.","A zongora már kapcsolva van.")}</div>`:`${pianos.length?`<label class="field full"><span>${tr("Existing piano","Meglévő zongora")}</span><select name="piano_id"><option value="">${tr("Create new piano","Új zongora létrehozása")}</option>${pianoOptions}</select></label>`:""}<label class="field"><span>${tr("Piano brand","Zongora márkája")} *</span><input name="brand"></label><label class="field"><span>${tr("Model","Modell")}</span><input name="model"></label><label class="field"><span>${tr("Serial","Gyári szám")}</span><input name="serial_number"></label><label class="field"><span>${tr("Piano location","Zongora helye")}</span><input name="location_notes"></label>`}
    <label class="field full"><span>${tr("Job title","Munka címe")}</span><input name="title" value="${esc(lead.reported_issue)}"></label><label class="field"><span>${tr("Estimated duration","Becsült időtartam")} (min)</span><input name="estimated_duration_min" type="number" min="15" step="15" value="120"></label><label class="field"><span>${tr("Estimated revenue","Becsült bevétel")} (USD)</span><input name="estimated_revenue" type="number" min="0" step="0.01" value="${Number(assessment.estimated_total||0).toFixed(2)}"></label>
    <label class="field"><span>${tr("Start · New York (optional)","Kezdés · New York (opcionális)")}</span><input name="scheduled_at" type="datetime-local" step="900"></label><label class="field"><span>${tr("Technician","Technikus")}</span><select name="assigned_technician_id"><option value="">${tr("Choose when scheduling","Ütemezéskor választom")}</option>${r2TechnicianOptions(lead.assigned_technician_id)}</select></label>
    <label class="field full"><span>${tr("Workflow owner","Fő felelős")}</span><select name="workflow_owner_user_id" required>${r2ResponsibleOptions(state.user?.id)}</select></label>
    <section class="full workflow-plan-editor"><div class="panel-head inline-panel-head"><h3>${tr("Workflow phases","Munkafázisok")}</h3></div>${r2WorkflowPlanRows(null,{defaultResponsible:state.user?.id})}</section>
    <div class="form-actions full"><button type="button" class="secondary-button" data-close-dialog>${tr("Cancel","Mégse")}</button><button class="primary-button" type="submit">${tr("Approve & create job","Jóváhagyás és munka létrehozása")}</button></div></form>`});
  $("#convertJobEditor").addEventListener("submit",async event=>{
    event.preventDefault();const form=Object.fromEntries(new FormData(event.currentTarget)),body={title:form.title,estimated_duration_min:Number(form.estimated_duration_min||120),estimated_revenue:Number(form.estimated_revenue||0),workflow_owner_user_id:form.workflow_owner_user_id||state.user?.id,workflow_phases:r2ReadWorkflowPlan(event.currentTarget)};
    if(form.scheduled_at){if(!form.assigned_technician_id){toast(tr("Choose a technician for a scheduled job.","Ütemezett munkához válassz technikust."),"error");return;}body.scheduled_at=r2NyInputToIso(form.scheduled_at);body.assigned_technician_id=form.assigned_technician_id;const received=body.workflow_phases.find(phase=>phase.stage_key==="received");if(received&&!received.starts_at)received.starts_at=body.scheduled_at;}
    else if(form.assigned_technician_id)body.assigned_technician_id=form.assigned_technician_id;
    if(!lead.client_id)body.client={name:form.client_name,email:form.client_email,phone:form.client_phone,address:form.client_address};
    if(!lead.piano_id){if(form.piano_id)body.piano_id=Number(form.piano_id);else body.piano={brand:form.brand,model:form.model,serial_number:form.serial_number,location_notes:form.location_notes||form.client_address};}
    try{const result=await api(`/api/intake/${lead.id}/convert-to-job`,{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Job created from approved intake.","Munka létrehozva a jóváhagyott igényből."),"success");navTo(body.scheduled_at?"workshop":"planned");}catch(error){toast(humanError(error),"error");}
  });
};

/* ---------- Profile / team deletion ---------- */

renderProfile=async function(){
  const workspace=$("#workspace"),users=await loadUsers(),admin=["ADMIN","SUPERADMIN"].includes(state.user?.role);
  workspace.innerHTML=pageHead(tr("Profile & Settings","Profil és beállítások"),tr("Your account, team, theme and application language.","Saját fiók, csapat, megjelenés és alkalmazásnyelv."),admin?`<button id="newUserBtn" class="primary-button" type="button">＋ ${tr("New user","Új felhasználó")}</button>`:"")+
    `<div class="profile-grid"><section class="panel profile-card"><div class="profile-avatar">${esc(initials(state.user?.name))}</div><h2>${esc(state.user?.name)}</h2><p class="muted">${esc(state.user?.email||"")}</p><span class="role-chip">${esc(roleLabel(state.user?.role))}</span><div class="profile-theme-row"><span>${tr("Theme","Megjelenés")}</span><button class="secondary-button" id="profileThemeBtn" type="button">${document.documentElement.dataset.theme==="dark"?tr("Dark","Sötét"):tr("Light","Világos")}</button></div><div class="form-actions"><button id="logoutBtn" class="danger-button" type="button">${tr("Sign out","Kijelentkezés")}</button></div></section>
    <section class="panel"><div class="panel-head"><h2>${tr("Team","Csapat")}</h2><span class="badge">${users.length}</span></div><div class="team-list">${users.map(user=>`<div class="team-row"><span><strong>${esc(user.name)}</strong><small>${esc(user.email||user.contact_email||"")}</small></span><span class="role-chip">${esc(roleLabel(user.role))}</span>${admin?`<div class="team-actions"><button class="secondary-button" type="button" data-edit-user="${esc(user.id)}">${tr("Edit","Szerkesztés")}</button>${String(user.id)!==String(state.user.id)&&user.role!=="SUPERADMIN"?`<button class="text-button danger-text" type="button" data-delete-user="${esc(user.id)}">${tr("Delete","Törlés")}</button>`:""}</div>`:""}</div>`).join("")}</div></section></div>`;
  $("#profileThemeBtn").addEventListener("click",()=>{v6ToggleTheme();void renderProfile();});
  $("#logoutBtn").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"});}catch(_error){}localStorage.setItem("kh_login_theme",document.documentElement.dataset.theme||"dark");clearSession();showLogin();});
  $("#newUserBtn")?.addEventListener("click",()=>openUserDialog());$$("[data-edit-user]").forEach(button=>button.addEventListener("click",()=>openUserDialog(users.find(user=>String(user.id)===button.dataset.editUser))));
  $$("[data-delete-user]").forEach(button=>button.addEventListener("click",async()=>{const user=users.find(row=>String(row.id)===button.dataset.deleteUser);if(!user)return;if(!confirm(tr(`Delete ${user.name}? Historical jobs and audit records will remain intact.`,`Törlöd ${user.name} felhasználót? A korábbi munkák és audit adatok megmaradnak.`)))return;try{await api(`/api/users/${encodeURIComponent(user.id)}`,{method:"DELETE"});toast(tr("User deleted.","Felhasználó törölve."),"success");await renderProfile();}catch(error){toast(humanError(error),"error");}}));
};

/* ---------- Direct expense document upload ---------- */

r3OpenDirectExpenses=async function(refresh=renderFinance){
  const expenses=await api("/api/direct-expenses?month="+encodeURIComponent(state.r3Month||r3CurrentMonth()));
  openDialog({title:tr("Direct Expenses","Közvetlen költségek"),eyebrow:tr("DOCUMENTED COSTS","DOKUMENTÁLT KÖLTSÉGEK"),body:`<form id="directExpenseForm" class="form-grid">
    <label class="field"><span>${tr("Category","Kategória")} *</span><input name="category" required></label><label class="field"><span>${tr("Date","Dátum")} *</span><input name="expense_date" type="date" value="${r2Today()}" required></label>
    <label class="field full"><span>${tr("Description","Leírás")} *</span><input name="description" required></label><label class="field"><span>${tr("Amount","Összeg")} (USD) *</span><input name="amount" type="number" min="0" step="0.01" required></label>
    <label class="field"><span>${tr("Receipt / document","Nyugta / dokumentum")}</span><label class="file-picker"><input id="expenseReceiptFile" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"><span>↑ ${tr("Choose file","Fájl kiválasztása")}</span></label><small id="expenseReceiptName"></small></label>
    <div class="form-actions full"><button class="primary-button" type="submit">＋ ${tr("Add Expense","Költség hozzáadása")}</button></div></form>
    <div class="expense-list">${expenses.length?expenses.map(expense=>`<article class="expense-row"><div><strong>${esc(expense.category)}</strong><small>${esc(expense.expense_date)} · ${esc(expense.description)}</small>${expense.receipt_url?`<a class="receipt-link" href="${esc(expense.receipt_url)}" target="_blank" rel="noopener">${tr("Open receipt","Nyugta megnyitása")}</a>`:""}</div><strong>${r3Money(expense.amount)}</strong>${["ADMIN","SUPERADMIN"].includes(state.user?.role)?`<button class="text-button danger-text" type="button" data-delete-expense="${expense.id}">${tr("Delete","Törlés")}</button>`:""}</article>`).join(""):`<div class="empty-state">${tr("No direct expenses this month.","Nincs közvetlen költség ebben a hónapban.")}</div>`}</div>`});
  $("#expenseReceiptFile").addEventListener("change",event=>{$("#expenseReceiptName").textContent=event.currentTarget.files?.[0]?.name||"";});
  $("#directExpenseForm").addEventListener("submit",async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.amount=Number(body.amount);try{const file=$("#expenseReceiptFile").files?.[0];if(file){const form=new FormData();form.append("file",file);body.receipt_url=(await api("/api/v6/direct-expense-receipt",{method:"POST",body:form})).url;}await api("/api/direct-expenses",{method:"POST",body:JSON.stringify(body)});closeDialog();toast(tr("Expense added.","Költség hozzáadva."),"success");await refresh();}catch(error){toast(humanError(error),"error");}});
  $$("[data-delete-expense]").forEach(button=>button.addEventListener("click",async()=>{try{await api("/api/direct-expenses/"+button.dataset.deleteExpense,{method:"DELETE"});closeDialog();toast(tr("Expense deleted.","Költség törölve."),"success");await refresh();}catch(error){toast(humanError(error),"error");}}));
};

/* ---------- final init ---------- */

chromeText.mobile_more=["More","Továbbiak"];
applyChromeLanguage();
v6ApplyTheme(localStorage.getItem("kh_login_theme")==="light"?"light":"dark");
v6BindShell();
void boot();
