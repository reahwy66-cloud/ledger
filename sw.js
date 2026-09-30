/* Cleanup worker: the live admin service worker now lives under /dashboard/. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys
      .filter(k=>k.indexOf('studio-ledger')===0 && k!=='studio-ledger-v67-verified-delivery-save')
      .map(k=>caches.delete(k)));
    await self.registration.unregister();
    await self.clients.claim();
  })());
});
