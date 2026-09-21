/* رِواء ستوديو — offline shell.
   The app itself is cached so it opens without a connection.
   Live data always goes to the network; it is never served stale. */
const CACHE = 'studio-ledger-v49-scroll-pill-nav';
const SHELL = ['./', './index.html', './manifest.webmanifest',
               './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon.png', './push.js', './mobile.css', './desktop.css', './staff-portal.html', './client-portal.html', './portal.css', './portal.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // never cache the database or auth
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => {
        if (r) return r;
        if (url.pathname === '/staff' || url.pathname.endsWith('/staff-portal.html')) return caches.match('./staff-portal.html');
        if (url.pathname === '/client' || url.pathname.endsWith('/client-portal.html')) return caches.match('./client-portal.html');
        return caches.match('./index.html');
      }))
  );
});


self.addEventListener('push', event => {
  if (self.registration && self.registration.index && self.registration.index.setAppBadge) {
    // no-op: compatibility placeholder
  }
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'رِواء ستوديو';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    dir: data.dir || 'auto',
    lang: data.lang || 'ar',
    tag: data.tag || 'riwa-studio',
    renotify: data.renotify !== false,
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(target) : undefined;
    })
  );
});
