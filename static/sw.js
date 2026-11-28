/* Fence Builder's service worker: lets the app open on a phone with no signal (out in a field).
   - The app's own files (the page, its script, its look, the map library, the icons) are kept in a cache named after
     the app's version. The server puts that version in below, so a new version of the app makes a new cache and the
     old one is thrown away: updates still arrive whenever there is a connection.
   - The page itself is always asked for first (so signing in and updates work as usual); the kept copy is only used
     when there is no connection.
   - Nothing from the server's api/ is kept here, except the aerial photo map pieces (api/off/tile/...) that someone
     chose to keep on this phone with "Keep this area's map on this phone" (the page puts those in the fb-tiles cache).
     Jobs, prices and points dropped with no signal are kept by the page itself (92-phone.js, 08-offline.js). */
const VERSION = '__APP_VERSION__';
const APP = 'fb-app-' + VERSION, TILES = 'fb-tiles';
const SCOPE = new URL(self.registration.scope);
const PAGE = new URL('./', SCOPE).href;
// the 3D view's library is big and not needed in a field: left out
const SKIP = /vendor\/(three|jsm)/;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    try {
      const r = await fetch(PAGE, {cache: 'no-store', credentials: 'same-origin'});
      if (r.ok && !r.redirected && (r.headers.get('Content-Type') || '').startsWith('text/html')) {
        const html = await r.clone().text();
        await c.put(PAGE, r);
        const refs = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map(m => m[1]).filter(u => !SKIP.test(u));
        refs.push('vendor/images/layers.png', 'vendor/images/layers-2x.png', 'icon-512.png');
        await Promise.all(refs.map(u => c.add(new URL(u, SCOPE).href).catch(() => {})));
      }
    } catch (err) { /* no connection while installing: the files are kept as they are used instead */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys())
      if (k.startsWith('fb-app-') && k !== APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isApi = u => u.pathname.startsWith(SCOPE.pathname + 'api/') || u.pathname.includes('/api/');

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== SCOPE.origin) return;              // maps and other sites: the browser as usual
  if (isApi(u)) {
    // a map piece kept on this phone; everything else from the server is never kept here
    if (u.pathname.includes('/api/off/tile/'))
      e.respondWith(caches.open(TILES).then(c => c.match(req.url)).then(hit => hit || fetch(req)));
    return;
  }
  if (req.mode === 'navigate') { e.respondWith(page(req)); return; }
  if (u.searchParams.has('v')) { e.respondWith(keptFirst(req)); return; }   // a versioned file never changes
  e.respondWith(freshFirst(req));
});

// the page: from the server when it answers (sign-in and updates as usual), else the copy kept here
async function page(req) {
  try {
    const r = await withTimeout(fetch(req), 8000);
    const path = new URL(r.url || req.url).pathname;
    if (r.ok && !r.redirected && (path === SCOPE.pathname || path === SCOPE.pathname + 'index.html'))
      (await caches.open(APP)).put(PAGE, r.clone());
    return r;
  } catch (err) {
    const hit = await caches.match(PAGE, {cacheName: APP});
    if (hit) return hit;
    throw err;
  }
}
async function keptFirst(req) {
  const c = await caches.open(APP), hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && !SKIP.test(req.url)) c.put(req, r.clone());
  return r;
}
async function freshFirst(req) {
  const c = await caches.open(APP);
  try {
    const r = await withTimeout(fetch(req), 8000);
    if (r.ok && !SKIP.test(req.url)) c.put(req, r.clone());
    return r;
  } catch (err) {
    const hit = await c.match(req, {ignoreSearch: true});
    if (hit) return hit;
    throw err;
  }
}
function withTimeout(p, ms) {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
}
