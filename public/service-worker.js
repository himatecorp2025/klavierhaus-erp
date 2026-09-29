const CACHE_NAME="klavierhaus-admin-v13-appointment-approval";
const APP_SHELL=["/","/index.html","/styles.css","/app.js","/round2.js","/round3.js","/messenger.js","/v6.js","/icons/icon-192.png","/icons/icon-512.png"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==self.location.origin||url.pathname.startsWith("/api/")||url.pathname.startsWith("/uploads/")||url.pathname==="/manifest.webmanifest")return;
  const critical=request.mode==="navigate"||["/","/index.html","/styles.css","/app.js","/round2.js","/round3.js","/messenger.js","/v6.js"].includes(url.pathname);
  const network=caches.open(CACHE_NAME).then(cache=>fetch(request,{cache:"no-cache"}).then(async response=>{if(response.ok)await cache.put(request,response.clone());return response;}));
  if(critical){
    event.respondWith(network.catch(async()=>request.mode==="navigate"?(await caches.match("/index.html"))||Response.error():(await caches.match(request))||Response.error()));
    return;
  }
  event.waitUntil(network.catch(()=>{}));
  event.respondWith(caches.match(request).then(cached=>cached||network.catch(()=>Response.error())));
});


self.addEventListener("push",event=>{
  let payload={};try{payload=event.data?.json?.()||{};}catch(_error){try{payload={body:event.data?.text?.()||""};}catch(_ignored){}}
  const title=payload.title||"Klavierhaus",body=payload.body||"",url=payload.url||"/",count=Math.max(0,Number(payload.count)||0),id=payload.id||"";
  event.waitUntil((async()=>{
    try{if(count>0&&self.navigator?.setAppBadge)await self.navigator.setAppBadge(count);else if(count<=0&&self.navigator?.clearAppBadge)await self.navigator.clearAppBadge();}catch(_error){}
    await self.registration.showNotification(title,{
      body,icon:"/icons/icon-192.png",badge:"/icons/icon-192.png",tag:id||undefined,renotify:Boolean(id),
      data:{url,id},requireInteraction:false
    });
  })());
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const data=event.notification.data||{},url=data.url||"/",id=data.id||"";
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    let client=windows.find(item=>item.url&&new URL(item.url).origin===self.location.origin);
    if(client){await client.focus();if(url&&client.navigate)try{await client.navigate(new URL(url,self.location.origin).href);}catch(_error){}}
    else client=await self.clients.openWindow(new URL(url,self.location.origin).href);
    for(const item of windows)try{item.postMessage({type:"NOTIFICATION_OPENED",id});}catch(_error){}
    if(client)try{client.postMessage({type:"NOTIFICATION_OPENED",id});}catch(_error){}
  })());
});
