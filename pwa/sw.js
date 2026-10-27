/* Mesélő · service worker: az app internet nélkül is induljon */
const VERSION = '@@VERSION@@';
const APP_CACHE = `meselo-app-${VERSION}`;
const FONT_CACHE = 'meselo-fonts-v1';
const SHELL = @@SHELL@@;
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((c) => c.addAll(SHELL.map((p) => new Request(new URL(p, self.registration.scope), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('meselo-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // betűtípusok: első letöltés után a gyorsítótárból
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // az oldal: hálózatról, hogy a frissítés megérkezzen; offline a tárolt változat
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(APP_CACHE)).put(new URL('./', self.registration.scope).href, res.clone());
        return res;
      } catch (e) {
        const c = await caches.open(APP_CACHE);
        return (await c.match(new URL('./', self.registration.scope).href)) || (await c.match(new URL('index.html', self.registration.scope).href)) || Response.error();
      }
    })());
    return;
  }

  // az app saját kis fájljai a gyorsítótárból; a nagy hangfájlokat a hangmotor maga tárolja
  if (SHELL_URLS.has(url.href.split('#')[0].split('?')[0])) {
    event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
  }
});
