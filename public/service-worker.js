const CACHE_NAME="klavierhaus-admin-v6-shell-v1";
const APP_SHELL=["/","/index.html","/styles.css","/app.js","/round2.js","/round3.js","/v6.js","/icons/icon-192.png","/icons/icon-512.png"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==self.location.origin||url.pathname.startsWith("/api/")||url.pathname.startsWith("/uploads/")||url.pathname==="/manifest.webmanifest")return;
  const refresh=caches.open(CACHE_NAME).then(cache=>fetch(request,{cache:"no-cache"}).then(async response=>{if(response.ok)await cache.put(request,response.clone());return response;}));
  event.waitUntil(refresh.catch(()=>{}));
  event.respondWith(caches.match(request).then(cached=>cached||refresh.catch(async()=>request.mode==="navigate"?(await caches.match("/index.html"))||Response.error():Response.error())));
});
