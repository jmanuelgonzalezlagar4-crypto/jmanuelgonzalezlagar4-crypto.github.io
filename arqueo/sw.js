// Service worker: app shell en caché y mapas guardados para usar sin cobertura
const SHELL = 'arq-shell-v4';
const TILES = 'arq-tiles';
const FILES = ['./', 'index.html', 'app.js', 'data.enc.json', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'lib/leaflet.js', 'lib/leaflet.css', 'lib/geotiff.js', 'lib/three.min.js', 'score.js', 'terrain.js', 'view3d.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('arq-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isTile = u => /ign\.es|idee\.es|catastro/.test(u);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (isTile(url)) {
    // mapas: primero lo guardado; si no está, red y se guarda para la próxima
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(url);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r && (r.ok || r.type === 'opaque')) c.put(url, r.clone());
        return r;
      } catch (err) {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }
  if (new URL(url).origin === location.origin) {
    // app: red primero (para recibir actualizaciones), caché si no hay cobertura
    e.respondWith(fetch(req).then(r => {
      if (r.ok) caches.open(SHELL).then(c => c.put(req, r.clone()));
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
