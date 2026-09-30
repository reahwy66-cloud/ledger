/* رِواء ستوديو — live GitHub Pages shell */
const CACHE='studio-ledger-live-v66-ad-faces';
const SHELL=['./','./index.html','./favicon.png','./apple-touch-icon.png','./daily-tasks.html','./push.js','./manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  if(url.hostname.endsWith('supabase.co')||url.hostname.endsWith('supabase.in'))return;
  e.respondWith(fetch(e.request).then(res=>{
    if(res&&res.status===200&&url.origin===location.origin){
      const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));
    }
    return res;
  }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
self.addEventListener('push',event=>{
  let data={};try{data=event.data?event.data.json():{};}catch(_e){data={body:event.data?event.data.text():''};}
  event.waitUntil(self.registration.showNotification(data.title||'رِواء ستوديو',{
    body:data.body||'',icon:data.icon||'./favicon.png',badge:data.badge||'./favicon.png',
    dir:data.dir||'auto',lang:data.lang||'ar',tag:data.tag||'riwa-studio',
    renotify:data.renotify!==false,data:{url:data.url||'./'}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=(event.notification.data&&event.notification.data.url)||'./';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const client of list){if('focus' in client){if('navigate' in client)client.navigate(target).catch(()=>{});return client.focus();}}
    return clients.openWindow?clients.openWindow(target):undefined;
  }));
});
