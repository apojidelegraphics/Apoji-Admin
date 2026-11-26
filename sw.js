// Apoji Admin service worker: keeps the app shell so it opens instantly (and installs like an app), and shows
// phone notifications your Mac hub sends over Tailscale (web push). Your data and chat always come live from
// Supabase; nothing from your account is cached here.
const SHELL = 'apoji-admin-v3.4.0';
const FILES = ['./', './index.html', './admin.css', './admin.js', './crypto.js', './charts.js', './chat.js', './pages.js', './extras.js', './features.js', './v18.js', './v19.js', './v23.js', './mindtree.js', './v25.js', './terms-data.js', './v26.js', './v261.js', './v27.js', './v28.js', './v31.js', './v32.js', './v33.js', './v34.js', './icons.js', './cosmetics.js', './fonts/nxp-pixel.woff2', './fonts/nxp-hand.woff2', './fonts/nxp-rounded.woff2', './fonts/nxp-display.woff2', './orb.js', './manifest.webmanifest', './icons/icon-192.png', './icons/logo.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('apoji-admin-') && x !== SHELL).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./'))));
});
// From your Mac hub
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Apoji Admin', body: e.data ? e.data.text() : '' }; }
  const hash = /^#[\w/-]*$/.test(d.url || '') ? d.url : '';
  e.waitUntil(self.registration.showNotification(String(d.title || 'Apoji Admin').slice(0, 80), {
    body: String(d.body || '').slice(0, 240), icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || d.kind || 'apoji', renotify: true, data: { hash }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hash = e.notification.data?.hash || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ('focus' in w) { if (hash) w.postMessage({ go: hash }); return w.focus(); }
    return self.clients.openWindow('./' + hash);
  }));
});
