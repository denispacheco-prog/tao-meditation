// Offline cache for the app shell. Bump VERSION when files change.
const VERSION = 'v8';
// Kept across versions: the voice engine (vendor/, ~33 MB, versioned paths),
// natural voice models and synthesized sentences (see js/neural.js).
const KEEP = ['tao-engine', 'tao-voices', 'tao-speech'];
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/scene.js', 'js/tao.js', 'js/player.js', 'js/speech.js', 'js/audio.js', 'js/ambience.js', 'js/store.js', 'js/epub.js', 'js/zip.js',
  'js/neural.js', 'js/piper-worker.js', 'js/piper-core.js',
  'sessions/index.json', 'sessions/breath-counting.json', 'sessions/square-breath.json',
  'sessions/long-exhale.json', 'sessions/body-scan.json', 'sessions/sitting-quietly.json',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so edits show up), cache as fallback when offline.
// 'no-cache' makes the browser revalidate with the server, so a stale HTTP-cached
// file can never be mixed with fresh ones after an update.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // e.g. voice models: js/neural.js caches them
  // Voice engine: big and never changes under the same (versioned) path,
  // so cache first, downloaded only when a natural voice is first used.
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.open('tao-engine').then(c => c.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
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
