// Service worker: rede primeiro (para receber sempre a versão nova) e cache como reserva offline.
const CACHE = 'aurora-v4';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/alerts.js',
  './js/backup.js',
  './js/calc.js',
  './js/config.js',
  './js/data/stocks.js',
  './js/format.js',
  './js/fx.js',
  './js/history.js',
  './js/main.js',
  './js/net.js',
  './js/pwa.js',
  './js/quotes/crypto.js',
  './js/quotes/index.js',
  './js/quotes/stocks.js',
  './js/stocks.js',
  './js/tax.js',
  './js/store.js',
  './js/ui/background.js',
  './js/ui/dom.js',
  './js/ui/lot-form.js',
  './js/ui/modal-alert.js',
  './js/ui/modal-cash.js',
  './js/ui/modal-position.js',
  './js/ui/modal-settings.js',
  './js/ui/modal-tax.js',
  './js/ui/render.js',
  './js/ui/theme.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(async () =>
        (await caches.match(req, { ignoreSearch: true }))
        ?? (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())),
  );
});
