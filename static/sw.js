/* Fence Builder's service worker: lets the app open on a phone with no signal (out in a field).
   - The app's own files (the page, its script, its look, the map library, the icons) are kept in a cache named after
     the app's version. The server puts that version in below, so a new version of the app makes a new cache and the
     old one is thrown away: updates still arrive whenever there is a connection.
   - The page itself is always asked for first (so signing in and updates work as usual); the kept copy is only used
     when there is no connection.
   - Nothing from the server's api/ is ever kept here. Jobs, prices and points dropped with no signal are kept by the
     page itself (92-phone.js, 08-offline.js).
   - USGS map pieces (the aerial photo and LiDAR bare earth) that someone saved on this phone for offline (60-offline-area.js
     puts them in the fb-tiles cache, under their own USGS addresses) are answered from there; anything else from USGS,
     and every other site, goes to the network as usual. */
const VERSION = '__APP_VERSION__';
const APP = 'fb-app-' + VERSION, TILES = 'fb-tiles';
const SCOPE = new URL(self.registration.scope);
const PAGE = new URL('./', SCOPE).href;
// the 3D view's library is big and not needed in a field: left out
const SKIP = /vendor\/(three|jsm)/;
// the USGS map pieces that can be saved for offline (usgsTileUrl in 40-map.js)
const USGS_TILE = /^https:\/\/(basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSImageryOnly\/MapServer\/tile\/|imagery\.nationalmap\.gov\/arcgis\/rest\/services\/USGSNAIPImagery\/ImageServer\/exportImage\?|elevation\.nationalmap\.gov\/arcgis\/rest\/services\/3DEPElevation\/ImageServer\/exportImage\?bbox=[^&]*&bboxSR=3857&imageSR=3857&size=256,256&)/;

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
  if (u.origin !== SCOPE.origin) {                    // maps and other sites: the browser as usual,
    if (USGS_TILE.test(req.url)) e.respondWith(savedTile(req));   // except a USGS map piece saved on this phone
    return;
  }
  if (isApi(u)) return;                               // the server's data: never kept here
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
// a saved map piece (only the page saves them; nothing is added here), else the network
async function savedTile(req) {
  let hit = null;
  try { hit = await (await caches.open(TILES)).match(req.url, {ignoreVary: true}); } catch (err) { /* no cache */ }
  return hit || fetch(req);
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
