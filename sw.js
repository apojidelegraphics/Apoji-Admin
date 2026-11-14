// Apoji Admin service worker: keeps the app shell so it opens instantly (and installs like an app). Your data and
// chat always come live from Supabase; nothing from your account is cached here.
const SHELL = 'apoji-admin-v1.0.0';
const FILES = ['./', './index.html', './admin.css', './admin.js', './crypto.js', './charts.js', './chat.js', './pages.js', './manifest.webmanifest', './icons/icon-192.png', './icons/logo.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('apoji-admin-') && x !== SHELL).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./'))));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => { for (const w of ws) if ('focus' in w) return w.focus(); return self.clients.openWindow('./'); }));
});
