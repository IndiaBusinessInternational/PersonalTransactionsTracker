const CACHE = 'ptt-v6.18.0';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(
      ASSETS.map(u => fetch(new Request(u, {cache: 'reload'}))
        .then(r => r.ok ? c.put(u, r) : null)
        .catch(() => null))
    ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    // v6.18: only this app's own old caches — the Mini app shares this github.io origin
    Promise.all(keys.filter(k => k !== CACHE && k.indexOf('ptt-') === 0).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if(e.request.url.includes('script.google.com') ||
     e.request.url.includes('fonts.googleapis.com') ||
     e.request.url.includes('cdn.jsdelivr.net')) {
    return; // Always fetch live for GAS, fonts, icons
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
