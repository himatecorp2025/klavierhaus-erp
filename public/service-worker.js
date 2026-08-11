const CACHE_NAME="klavierhaus-shell-v6.5.0-ui4";
const APP_SHELL=["/","/index.html","/styles.css","/app.js","/icons/icon-192.png","/icons/icon-512.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname.startsWith("/api/")||url.pathname.startsWith("/uploads/")||url.pathname==="/manifest.webmanifest") return;
  event.respondWith((async()=>{
    const cached=await caches.match(request);
    const network=fetch(request).then(async response=>{
      if(response.ok){const cache=await caches.open(CACHE_NAME);await cache.put(request,response.clone());}
      return response;
    });
    if(cached){event.waitUntil(network.catch(()=>{}));return cached;}
    try{return await network;}catch(_error){return (await caches.match("/index.html"))||Response.error();}
  })());
});

async function updateAppBadge(count){
  const normalized=Math.max(0,Number(count||0));
  if(normalized>0&&self.registration.setAppBadge)await self.registration.setAppBadge(normalized);
  else if(self.registration.clearAppBadge)await self.registration.clearAppBadge();
}
async function reportActivationReceipt(token){
  if(!token)return;
  await fetch('/api/push/test-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store'});
}
self.addEventListener('push',event=>{
 let data={};try{data=event.data?event.data.json():{}}catch(_e){data={body:event.data?.text()||''}}
 const title=data.title||data.title_en||'Klavierhaus';const body=data.body||data.custom_message||data.body_en||'';
 const options={body,icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',data:{url:data.url||'/?openNotifications=1',notificationId:data.notificationId,activationTest:Boolean(data.activationTest)},tag:data.activationTest?'kh-activation-test':(data.notificationId||undefined),renotify:true};
 event.waitUntil((async()=>{
   await self.registration.showNotification(title,options);
   await updateAppBadge(data.unreadCount||0);
   if(data.activationTest&&data.activationToken)await reportActivationReceipt(data.activationToken);
 })());
});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||'/?openNotifications=1';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus'in client){client.postMessage({type:'OPEN_NOTIFICATIONS'});return client.focus();}}return clients.openWindow(url);}));});
self.addEventListener('message',event=>{
 const data=event.data||{};
 if(data.type==='SET_BADGE'){event.waitUntil(updateAppBadge(data.count).catch(()=>{}));return;}
 if(data.type==='ACKNOWLEDGE_NOTIFICATION'){
   event.waitUntil((async()=>{
     await updateAppBadge(data.count);
     const notifications=await self.registration.getNotifications({tag:data.notificationId});
     notifications.forEach(notification=>notification.close());
   })().catch(()=>{}));
 }
});
