// Offline cache for the app shell. Bump VERSION when files change.
const VERSION = 'v3';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/scene.js', 'js/player.js', 'js/speech.js', 'js/audio.js', 'js/store.js', 'js/epub.js', 'js/zip.js',
  'sessions/index.json', 'sessions/breath-counting.json', 'sessions/square-breath.json',
  'sessions/long-exhale.json', 'sessions/body-scan.json', 'sessions/sitting-quietly.json',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so edits show up), cache as fallback when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
