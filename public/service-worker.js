const CACHE_NAME="klavierhaus-shell-v21";
const APP_SHELL=["/","/index.html","/styles.css","/app.js","/icons/icon-192.png","/icons/icon-512.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname.startsWith("/api/")||url.pathname.startsWith("/uploads/")||url.pathname==="/manifest.webmanifest") return;
  const isShell=["/","/index.html","/styles.css","/app.js","/service-worker.js"].includes(url.pathname);
  event.respondWith((async()=>{
    try{
      const response=await fetch(request,{cache:isShell?"no-store":"default"});
      if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)));}
      return response;
    }catch(_error){
      return (await caches.match(request))||(await caches.match("/index.html"))||Response.error();
    }
  })());
});

self.addEventListener('push',event=>{
 let data={};try{data=event.data?event.data.json():{}}catch(_e){data={body:event.data?.text()||''}}
 const title=data.title||data.title_en||'Klavierhaus';const body=data.body||data.custom_message||data.body_en||'';
 event.waitUntil(Promise.all([self.registration.showNotification(title,{body,icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',data:{url:data.url||'/?openNotifications=1',notificationId:data.notificationId},tag:data.notificationId||undefined,renotify:true}),Number(data.unreadCount||0)>0&&self.registration.setAppBadge?self.registration.setAppBadge(Number(data.unreadCount)):self.registration.clearAppBadge?self.registration.clearAppBadge():Promise.resolve()]));
});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||'/?openNotifications=1';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus'in client){client.postMessage({type:'OPEN_NOTIFICATIONS'});return client.focus();}}return clients.openWindow(url);}));});
self.addEventListener('message',event=>{if(event.data?.type!=='SET_BADGE')return;const count=Math.max(0,Number(event.data.count||0));const task=count>0&&self.registration.setAppBadge?self.registration.setAppBadge(count):self.registration.clearAppBadge?self.registration.clearAppBadge():Promise.resolve();event.waitUntil(Promise.resolve(task).catch(()=>{}));});
