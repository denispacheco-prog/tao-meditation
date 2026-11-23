// Offline cache for the app shell. Bump VERSION when files change.
const VERSION = 'v5';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/scene.js', 'js/player.js', 'js/speech.js', 'js/audio.js', 'js/ambience.js', 'js/store.js', 'js/epub.js', 'js/zip.js',
  'sessions/index.json', 'sessions/breath-counting.json', 'sessions/square-breath.json',
  'sessions/long-exhale.json', 'sessions/body-scan.json', 'sessions/sitting-quietly.json',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so edits show up), cache as fallback when offline.
// 'no-cache' makes the browser revalidate with the server, so a stale HTTP-cached
// file can never be mixed with fresh ones after an update.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
