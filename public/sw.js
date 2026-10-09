// Network-first for the app shell and API so people always see current numbers;
// the last good API answer is kept for weak-signal moments and flagged as cached.
const CACHE = 'kf-cc-v2';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/push/')) return; // alert text is single-use, never cache it
  const isApi = url.pathname.startsWith('/api/');
  if (isApi && (url.pathname === '/api/admin/codes')) return; // never cache the access-code list
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && !(isApi && req.headers.get('x-access-code') && url.pathname.startsWith('/api/admin'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit ? new Response(hit.body, { status: hit.status, headers: new Headers([...hit.headers, ['x-from-cache', '1']]) }) : Response.error()))
  );
});

// Phone alerts: the push carries no text, so ask the server what this phone should show.
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let alert = { title: 'KiuFunza 4', body: 'Open the dashboard for the latest update.', url: '/' };
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const h = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint))).slice(0, 22);
        const res = await fetch('/api/push/alert?h=' + h, { cache: 'no-store' });
        if (res.ok) alert = await res.json();
      }
    } catch (e) {}
    await self.registration.showNotification(alert.title, { body: alert.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: alert.url || '/' }, tag: 'kf-alert' });
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => { for (const c of list) { if ('focus' in c) { c.navigate(event.notification.data.url); return c.focus(); } } return self.clients.openWindow(event.notification.data.url || '/'); }));
});
