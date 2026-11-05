const CACHE_NAME = 'vocab-master-v51';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/srs.js',
  './js/engine.js',
  './js/swipe.js',
  './js/importer.js',
  './js/speech.js',
  './js/sync.js',
  './js/firebase-config.js',
  './manifest.json',
  './samples/sample_words.csv',
  './samples/kin_no_phrase.csv'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((k) => {
        if (k !== CACHE_NAME) return caches.delete(k);
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Firebase SDK や外部スクリプトも動的にキャッシュして完全オフラインに備える
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((response) => {
        // gstatic.com の SDK ファイルであればキャッシュに保存
        if (e.request.url.includes('gstatic.com/firebasejs')) {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        }
        return response;
      }).catch(() => {
        // オフライン時のフォールバック
        return cached;
      });
    })
  );
});

