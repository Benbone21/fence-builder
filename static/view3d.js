// 3D view: USGS 3DEP LiDAR terrain with the satellite photo laid on top and your fence lines standing on it.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const USGS = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
const FT = 3.28084;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// Reads the uncompressed 32-bit float GeoTIFF that USGS sends back (striped or tiled).
function readTiff(buf) {
  const dv = new DataView(buf), le = dv.getUint16(0) === 0x4949;
  const u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
  const size = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8};
  const ifd = u32(4), n = u16(ifd), T = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), typ = u16(e + 2), cnt = u32(e + 4);
    if (typ !== 3 && typ !== 4) continue;
    const at = (size[typ] * cnt) <= 4 ? e + 8 : u32(e + 8), v = [];
    for (let k = 0; k < cnt; k++) v.push(typ === 3 ? u16(at + k * 2) : u32(at + k * 4));
    T[tag] = v;
  }
  const W = T[256][0], H = T[257][0];
  if ((T[259] || [1])[0] !== 1 || (T[258] || [32])[0] !== 32) throw Error('Unexpected elevation file');
  const out = new Float32Array(W * H);
  if (T[322]) {
    const tw = T[322][0], th = T[323][0], across = Math.ceil(W / tw);
    T[324].forEach((o, t) => {
      const tx = (t % across) * tw, ty = Math.floor(t / across) * th;
      for (let y = 0; y < th && ty + y < H; y++)
        for (let x = 0; x < tw && tx + x < W; x++) out[(ty + y) * W + tx + x] = dv.getFloat32(o + (y * tw + x) * 4, le);
    });
  } else {
    const rps = (T[278] || [H])[0];
    T[273].forEach((o, si) => {
      for (let r = 0; r < rps && si * rps + r < H; r++)
        for (let x = 0; x < W; x++) out[(si * rps + r) * W + x] = dv.getFloat32(o + (r * W + x) * 4, le);
    });
  }
  return {W, H, data: out};
}

async function terrainSource(lat, lng) {
  try {
    const q = new URLSearchParams({geometry: JSON.stringify({points: [[lng, lat]], spatialReference: {wkid: 4326}}),
      geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', outFields: 'Name,AcquisitionDate', f: 'json'});
    const j = await (await fetch(USGS + '/getSamples', {method: 'POST', body: q})).json();
    const s = j.samples?.[0];
    if (!s) return '';
    const r = s.resolution, kind = r <= 1.5 ? '1 m LiDAR' : r <= 5 ? '3 m' : r <= 15 ? '10 m' : '30 m';
    const yr = s.attributes?.AcquisitionDate ? ' (' + new Date(s.attributes.AcquisitionDate).getUTCFullYear() + ')' : '';
    return 'USGS 3DEP ' + kind + (s.attributes?.Name ? ', survey ' + s.attributes.Name + yr : '');
  } catch (e) { return ''; }
}

// ----- saved downloads: the ground heights and photo for an area are kept in this browser (IndexedDB,
// which also works on a plain http address on the office network) so opening the same spot again is quick.
// Keeps the newest 40 files, about 300 MB at most. Never throws: if saving is not allowed it just skips it.
const KEEP = 40, KEEP_BYTES = 300e6;
let dbP = null;
function cacheDb() {
  if (!dbP) dbP = new Promise(ok => {
    try {
      const rq = indexedDB.open('fence3d', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('files');
      rq.onsuccess = () => ok(rq.result);
      rq.onerror = () => ok(null);
    } catch (e) { ok(null); }
  });
  return dbP;
}
async function cacheGet(url) {
  try {
    const db = await cacheDb();
    if (!db) return null;
    const v = await new Promise((ok, no) => {
      const rq = db.transaction('files').objectStore('files').get(url);
      rq.onsuccess = () => ok(rq.result); rq.onerror = () => no(rq.error);
    });
    return v?.buf ? v : null;
  } catch (e) { return null; }
}
async function cachePut(url, value) {
  try {
    const db = await cacheDb();
    if (!db) return;
    const st = db.transaction('files', 'readwrite').objectStore('files');
    st.put(value, url);
    // throw out the oldest files beyond the limits
    const all = [], rq = st.openCursor();
    rq.onsuccess = () => {
      const c = rq.result;
      if (c) { const b = c.value?.buf; all.push({k: c.key, at: c.value?.at || 0, size: b?.byteLength ?? b?.size ?? 0}); c.continue(); return; }
      all.sort((a, b) => b.at - a.at);   // newest first
      let bytes = 0;
      all.forEach((x, i) => { bytes += x.size; if (i >= KEEP || bytes > KEEP_BYTES) st.delete(x.k); });
    };
  } catch (e) { /* no room or not allowed: just skip saving */ }
}

let open = null;

// looks for the building tools (Draw fence, Add brace, Add gate); added here so the 3D view carries its own
const EDIT_CSS = `#v3d .v3tools{display:flex;gap:8px;flex-wrap:wrap}#v3d .v3tools[hidden]{display:none}
#v3d .v3tool{font-size:15px;font-weight:600;padding:7px 14px}
#v3d .v3tool.on{background:#ffd21f;border-color:#ffd21f;color:#1b1e22}
#v3d .v3mode{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:8px 12px;background:#3b3214;border-bottom:1px solid #6e5c1d;color:#fff4c7}
#v3d .v3mode[hidden]{display:none}
#v3d .v3help{flex:1 1 280px;font-size:16px;font-weight:600}
#v3d .v3mode .btn{font-size:15px;padding:7px 14px}
#v3d .v3mode .v3fin{background:#2f7d3b;border-color:#2f7d3b;color:#fff}
#v3d .v3draw{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
#v3d .v3nav{position:absolute;right:14px;bottom:14px;z-index:5;display:grid;grid-template-columns:repeat(3,48px);gap:6px;user-select:none;touch-action:none}
#v3d .v3nav[hidden]{display:none}
#v3d .v3nav button{width:48px;height:48px;font-size:22px;line-height:1;border-radius:10px;border:1px solid #0006;background:#fffffff0;color:#1b1e22;box-shadow:0 2px 8px #0005;cursor:pointer;padding:0}
#v3d .v3nav button:active{background:#ffd21f}
#v3d .v3nav .gap{visibility:hidden}`;

export async function open3D({bounds, lines, types, nodes, key, focus, braces, materials, postRule, layoutOf, edit}) {
  if (open) open.close();
  if (!document.getElementById('v3edit-css')) { const st = document.createElement('style'); st.id = 'v3edit-css'; st.textContent = EDIT_CSS; document.head.appendChild(st); }
  const ov = document.createElement('div');
  ov.id = 'v3d';
  ov.innerHTML = `<div class="v3bar"><b>3D view</b>
    <span class="v3tools"${edit ? '' : ' hidden'}>
      <button class="btn v3tool v3t-draw" title="Click the ground to place each corner of a new fence">Draw fence</button>
      <button class="btn v3tool v3t-brace" title="Click on a fence line to put a brace there">Add brace</button>
      <button class="btn v3tool v3t-gate" title="Click one side of the gap, then the other">Add gate</button></span>
    <span class="v3msg">Loading LiDAR terrain…</span>
    <label class="v3l">Height stretch <input type="range" min="1" max="4" step="0.25" value="1" aria-label="Height stretch"><output>1×</output></label>
    <label class="v3l"><input type="checkbox" class="v3fences" checked> Fences</label>
    <label class="v3l"><input type="checkbox" class="v3bld" checked> <span class="v3bldt">Buildings</span></label>
    <span class="v3counts v3l"></span>
    <button class="btn sm v3walk" title="Stand at the start of the fence at eye level (V)">Walk the fence</button>
    <button class="btn sm v3over" title="Back to the view from above">Overview</button>
    <button class="btn sm v3close">Close</button></div>
    <div class="v3mode" hidden><span class="v3help"></span>
      <button class="btn v3fin">Finish line</button>
      <button class="btn v3undo">Undo last point</button>
      <button class="btn v3cancel">Cancel</button></div>
    <div class="v3c"><div class="v3nav" aria-label="Turn, tilt and zoom">
      <button data-nav="turn" data-v="1" title="Turn left (Left arrow)">⟲</button><button data-nav="tilt" data-v="1" title="Look up, toward the horizon (Up arrow)">▲</button><button data-nav="turn" data-v="-1" title="Turn right (Right arrow)">⟳</button>
      <button data-nav="zoom" data-v="-1" title="Zoom in">+</button><button data-nav="tilt" data-v="-1" title="Look down, more from above (Down arrow)">▼</button><button data-nav="zoom" data-v="1" title="Zoom out">−</button></div></div>
    <div class="v3note v3src" hidden></div>
    <div class="v3note">Drag to slide the ground. Right-drag (or <kbd>Ctrl</kbd>-drag) to turn and tilt. Zoom the same way as on the map: the mouse wheel, two fingers up and down on a trackpad, or a pinch. Keys: <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to move, the arrow keys to turn and tilt the camera, <kbd>R</kbd> <kbd>F</kbd> up and down, hold <kbd>Shift</kbd> to go faster. Lost? Press Overview. Click a post to see what it is and the spacing.</div>`;
  document.body.appendChild(ov);
  const msg = ov.querySelector('.v3msg'), box = ov.querySelector('.v3c'), note = ov.querySelector('.v3note:not(.v3src)'), counts = ov.querySelector('.v3counts');
  let raf = 0, renderer, disposed = false;
  const trash = [];
  const close = () => {
    disposed = true; cancelAnimationFrame(raf); ro?.disconnect();
    trash.forEach(t => t.dispose?.()); renderer?.dispose(); ov.remove();
    document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); open = null;
  };
  let onKeyDown = e => { if (e.key === 'Escape') close(); }, onKeyUp = () => {};
  const kd = e => onKeyDown(e), ku = e => onKeyUp(e);
  document.addEventListener('keydown', kd); document.addEventListener('keyup', ku);
  ov.querySelector('.v3close').onclick = close;
  open = {close};
  let ro;

  // snap the area outward to a fixed grid (about 200 m) so a small change to the fence lines still
  // asks for the very same area, and the saved ground and photo from last time can be used
  const G = 0.002, snapDown = v => +(Math.floor(v / G) * G).toFixed(3), snapUp = v => +(Math.ceil(v / G) * G).toFixed(3);
  const s = snapDown(bounds.getSouth()), n = snapUp(bounds.getNorth()), w = snapDown(bounds.getWest()), e = snapUp(bounds.getEast());
  const lat0 = (s + n) / 2, mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110574;
  const Wm = (e - w) * mx, Hm = (n - s) * my, degAsp = (e - w) / (n - s);
  const N = 400, gw = degAsp >= 1 ? N : Math.max(40, Math.round(N * degAsp)), gh = degAsp >= 1 ? Math.max(40, Math.round(N / degAsp)) : N;
  const bbox = [w, s, e, n].map(v => v.toFixed(7)).join(',');
  const demUrl = `${USGS}/exportImage?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${gw},${gh}&format=tiff&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&compression=None&f=image`;
  // photo: about 0.25 m per pixel at most (asking for more detail than Esri has makes it fail), smaller tries after that
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  // the photo addresses to try, biggest first
  function satUrls(maxPx = 4096) {
    const urls = [];
    let px = Math.min(maxPx, Math.round(Math.max(Wm, Hm) / 0.15));
    for (let tries = 0; tries < 4; tries++, px = Math.round(px * 0.6)) {
      const tw = degAsp >= 1 ? px : Math.round(px * degAsp), th = degAsp >= 1 ? Math.round(px / degAsp) : px;
      urls.push(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${tw},${th}&format=jpg&f=image`);
    }
    return urls;
  }
  // one photo: the saved copy if there is one, otherwise download it and save it for next time
  async function loadTex(url) {
    let blob = (await cacheGet(url))?.buf, fresh = false;
    if (!(blob instanceof Blob)) {
      let r;
      try { r = await fetch(url, {mode: 'cors'}); }
      catch (e) { return loader.loadAsync(url); }   // the browser blocked it: load it the old way, just not saved
      if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) throw Error('no photo');
      blob = await r.blob(); fresh = true;
    }
    const ou = URL.createObjectURL(blob);
    try {
      const t = await loader.loadAsync(ou);
      if (fresh) cachePut(url, {buf: blob, at: Date.now()});   // only save photos that opened fine
      return t;
    } finally { URL.revokeObjectURL(ou); }
  }
  async function loadSat(maxPx = 4096) {
    for (const url of satUrls(maxPx)) {
      try { return await loadTex(url); }
      catch (e) { /* try smaller */ }
    }
    return savedPhoto(maxPx);
  }
  // no internet: put the photo together from the aerial photo saved for offline (map pieces from Fence Builder)
  async function savedPhoto(maxPx) {
    try {
      const R = 6378137, X = lng => R * lng * Math.PI / 180, Y = lat => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
      let z = 19; for (; z > 12; z--) { const m = 2 * Math.PI * R / 2 ** z / 256; if (Math.max(X(e) - X(w), Y(n) - Y(s)) / m <= maxPx) break; }
      const nT = 2 ** z, tx = lng => (lng + 180) / 360 * nT, ty = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * nT;
      const fx0 = tx(w), fx1 = tx(e), fy0 = ty(n), fy1 = ty(s), x0 = Math.floor(fx0), x1 = Math.floor(fx1), y0 = Math.floor(fy0), y1 = Math.floor(fy1);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1200) return null;
      const big = new OffscreenCanvas((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256), g = big.getContext('2d');
      let got = 0; const jobs = [];
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
        jobs.push(fetch(`api/off/tile/naip/${z}/${x}/${y}`).then(r => { if (!r.ok) throw 0; return r.blob(); }).then(createImageBitmap).then(bm => { g.drawImage(bm, (x - x0) * 256, (y - y0) * 256); got++; }).catch(() => {}));
      await Promise.all(jobs);
      if (!got) return null;
      // the photo is in map (Mercator) rows; the ground is in even latitude steps, so lay each row where it belongs
      const W = Math.round((fx1 - fx0) * 256), H = Math.round((fy1 - fy0) * 256), out = document.createElement('canvas');
      out.width = W; out.height = H; const o = out.getContext('2d'), rows = 64;
      for (let k = 0; k < rows; k++) {
        const la0 = n - (n - s) * k / rows, la1 = n - (n - s) * (k + 1) / rows;
        const sy0 = (ty(la0) - y0) * 256, sy1 = (ty(la1) - y0) * 256;
        o.drawImage(big, (fx0 - x0) * 256, sy0, (fx1 - fx0) * 256, sy1 - sy0, 0, H * k / rows, W, H / rows + 1);
      }
      const t = new THREE.CanvasTexture(out); t.colorSpace = THREE.SRGBColorSpace; return t;
    } catch (e) { return null; }
  }

  // Elevation for the 3D ground: USGS 3DEP LiDAR first. When USGS is down or the spot is outside the
  // US, AWS Terrain Tiles (built from USGS 10 m data and others, about 5 to 10 m apart) fill in.
  const timeout = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Error('timed out')), ms))]);
  async function terrainTiles(maxTiles = 64, grid = N) {
    let z = 15, nT, tx, ty, x0, x1, y0, y1;
    for (; z >= 8; z--) {
      nT = 2 ** z;
      tx = lng => (lng + 180) / 360 * nT; ty = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * nT;
      x0 = Math.floor(tx(w)); x1 = Math.floor(tx(e)); y0 = Math.floor(ty(n)); y1 = Math.floor(ty(s));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= maxTiles) break;
    }
    const cv = new OffscreenCanvas((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256), g = cv.getContext('2d');
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
      jobs.push(fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`)
        .then(r => { if (!r.ok) throw Error('tile'); return r.blob(); }).then(createImageBitmap).then(bm => g.drawImage(bm, (x - x0) * 256, (y - y0) * 256)));
    await Promise.all(jobs);
    const k = grid / N, gw2 = Math.max(16, Math.round(gw * k)), gh2 = Math.max(16, Math.round(gh * k));
    const px = g.getImageData(0, 0, cv.width, cv.height).data, out = new Float32Array(gw2 * gh2);
    const at = (X, Y) => { X = Math.min(cv.width - 1, Math.max(0, X)); Y = Math.min(cv.height - 1, Math.max(0, Y)); const i = (Y * cv.width + X) * 4; return px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768; };
    for (let r = 0; r < gh2; r++) for (let c = 0; c < gw2; c++) {
      const lat = n - r / (gh2 - 1) * (n - s), lng = w + c / (gw2 - 1) * (e - w);
      const fx = (tx(lng) - x0) * 256, fy = (ty(lat) - y0) * 256, X = Math.floor(fx), Y = Math.floor(fy), dx = fx - X, dy = fy - Y;
      out[r * gw2 + c] = (at(X, Y) * (1 - dx) + at(X + 1, Y) * dx) * (1 - dy) + (at(X, Y + 1) * (1 - dx) + at(X + 1, Y + 1) * dx) * dy;
    }
    return {W: gw2, H: gh2, data: out, fallback: true};
  }
  async function loadDem() {
    const saved = await cacheGet(demUrl);
    if (saved) try { return readTiff(saved.buf); } catch (e) { /* saved copy is no good, download it again */ }
    try {
      const r = await timeout(25000, fetch(demUrl));
      if (!r.ok) throw Error('USGS answered ' + r.status);
      const buf = await r.arrayBuffer(), d = readTiff(buf);   // readTiff only reads buf, so it is still whole to save
      cachePut(demUrl, {buf, at: Date.now()});   // only the USGS file is saved, never the AWS fill-in
      return d;
    } catch (e) {
      // no internet? the LiDAR saved for offline, if this area was saved
      try {
        const r = await timeout(30000, fetch(`api/off/dem?bbox=${bbox}&w=${gw}&h=${gh}`));
        if (r.ok) { const d = readTiff(await r.arrayBuffer()); d.offline = true; return d; }
      } catch (e2) { /* not saved here */ }
      console.warn('USGS elevation not available, using AWS Terrain Tiles', e);
      return terrainTiles();
    }
  }
  // ----- loading: a rough version first (a few map tiles and a small photo) so you can look around in a
  // moment, then the sharp USGS LiDAR ground and the full photo swap in when they arrive -----
  const srcBox = ov.querySelector('.v3src');
  let srcText = '', srcFallback = false;
  const showSrc = () => { const t = srcFallback ? 'AWS Terrain Tiles, about 10 m detail (USGS LiDAR is not answering right now)' : srcText; srcBox.hidden = !t; srcBox.textContent = t ? 'Terrain from ' + t + '.' : ''; };
  timeout(8000, terrainSource(lat0, (w + e) / 2)).then(t => { srcText = t; showSrc(); }).catch(() => {});
  const fullDem = loadDem().catch(() => null), fullSat = loadSat();   // start the sharp ones now, they take longer
  // already saved from last time? then skip the rough version and show the sharp one straight away
  const [savedDem, savedSat] = await Promise.all([cacheGet(demUrl), cacheGet(satUrls()[0])]);
  let dem, tex, rough;
  if (savedDem && savedSat) {
    [dem, tex] = await Promise.all([fullDem, fullSat]);
    rough = false; if (dem?.fallback) srcFallback = true;
  } else {
    [dem, tex] = await Promise.all([terrainTiles(16, 160).catch(() => null), loadSat(1024)]);
    rough = !!dem;
  }
  if (!dem) { dem = await fullDem; rough = false; if (dem?.fallback) srcFallback = true; }
  if (!dem) { msg.textContent = 'Could not load the terrain right now. The elevation services did not answer, so try again in a little while.'; return; }
  if (disposed) return;
  let W, H, data, zmin, zmax, step;
  // take in a grid of heights: fill any holes, find the lowest and highest
  function takeDem(d) {
    let lo = Infinity, hi = -Infinity;
    for (const v of d.data) if (v > -1000) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) return false;
    for (let i = 0; i < d.data.length; i++) if (!(d.data[i] > -1000)) d.data[i] = lo;
    ({W, H, data} = d); zmin = lo; zmax = hi; step = Wm / W;
    return true;
  }
  if (!takeDem(dem)) { msg.textContent = 'USGS has no elevation for this spot.'; return; }
  const rangeText = () => `${Math.round((zmax - zmin) * FT).toLocaleString()} ft from lowest to highest point`;
  msg.textContent = rangeText() + (rough ? '. Sharpening the ground and photo…' : '');

  // ----- scene -----
  renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb9cfe0);
  const size = Math.max(Wm, Hm);
  scene.fog = new THREE.Fog(0xb9cfe0, size * 2.2, size * 5);
  const camera = new THREE.PerspectiveCamera(45, 1, Math.max(0.5, size / 2000), size * 20);
  const controls = new OrbitControls(camera, renderer.domElement);
  // the mouse works like a map: left-drag grabs the ground and slides it, right-drag (or Ctrl/Shift + drag) turns and tilts
  // around the spot in the middle of the screen, the wheel zooms toward the mouse. OrbitControls only does the turning;
  // sliding and zooming are done below ("flying over the map") so the ground stays under the mouse.
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.rotateSpeed = 0.6;
  controls.enablePan = false; controls.enableZoom = false; controls.screenSpacePanning = false;
  controls.mouseButtons = {LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE};   // PAN + Ctrl/Shift = turn
  controls.touches = {ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE};
  controls.minPolarAngle = 0.03; controls.maxPolarAngle = Math.PI * 0.44;   // from straight down to a bit above the horizon, never upside down
  controls.minDistance = 0.5; controls.maxDistance = Infinity;   // height limits are kept below
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-size, size * 1.2, size * 0.6); scene.add(sun);

  // ----- terrain -----
  const prepTex = t => { if (t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); } return t; };
  prepTex(tex);
  let pos;
  function terrainGeo() {
    pos = new Float32Array(W * H * 3); const uv = new Float32Array(W * H * 2);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      pos[i * 3] = -Wm / 2 + c / (W - 1) * Wm; pos[i * 3 + 2] = -Hm / 2 + r / (H - 1) * Hm;
      uv[i * 2] = c / (W - 1); uv[i * 2 + 1] = 1 - r / (H - 1);
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6); let k = 0;
    for (let r = 0; r < H - 1; r++) for (let c = 0; c < W - 1; c++) {
      const a = r * W + c, b = a + 1, d = a + W, f = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = f;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }
  let geo = terrainGeo();
  const mat = tex ? new THREE.MeshLambertMaterial({map: tex}) : new THREE.MeshLambertMaterial({color: 0x9c9a86});
  const terrain = new THREE.Mesh(geo, mat);
  scene.add(terrain);
  trash.push(mat, {dispose: () => { terrain.geometry.dispose(); mat.map?.dispose(); }});

  // ----- fences: every post, wire, brace and gate at real size -----
  const fences = new THREE.Group(); scene.add(fences);
  const hAt = (lat, lng) => {
    const fx = Math.min(W - 1, Math.max(0, (lng - w) / (e - w) * (W - 1))), fy = Math.min(H - 1, Math.max(0, (n - lat) / (n - s) * (H - 1)));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const g = (x, y) => data[y * W + x];
    return (g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty;
  };
  const xz = (lat, lng) => [-Wm / 2 + (lng - w) / (e - w) * Wm, -Hm / 2 + (n - lat) / (n - s) * Hm];
  const llOf = (x, z) => [n - (z + Hm / 2) / Hm * (n - s), w + (x + Wm / 2) / Wm * (e - w)];
  const inView = (x, z) => Math.abs(x) <= Wm / 2 && Math.abs(z) <= Hm / 2;
  let ex = 1;
  const ground = (x, z) => { const [la, ln] = llOf(x, z); return (hAt(la, ln) - zmin) * ex; };
  const M = 1 / FT, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const kitById = Object.fromEntries((braces || []).map(b => [b.id, b]));
  const matName = id => (materials || []).find(m => m.id === id)?.name || '';
  const matOf = id => (materials || []).find(m => m.id === id);
  const lookOf = wr => wr.look || matOf(wr.m)?.look || (/woven|field|mesh|knot|net|hinge|panel|no.?climb/i.test(matName(wr.m)) ? 'mesh' : /barb/i.test(matName(wr.m)) ? 'barbed' : 'smooth');

  // where everything goes along one line (distances in metres along the line)
  function postMade(mm, p) {
    if (mm?.made) return mm.made;
    const n = mm?.name || p.what || '';
    if (/\bstay|dropper|spacer|twist/i.test(n)) return 'stay';
    if (/t-?\s?post|studded|\bu-?post|steel post/i.test(n)) return 'tpost';
    if (/pipe|tube|tubing/i.test(n)) return 'pipe';
    if (/wood|treated|cedar|pine|pole|timber|lumber|cca|cac/i.test(n)) return 'wood';
    return p.kind === 't' ? 'tpost' : 'wood';
  }
  function layout(l, t) {
    const pts = l.pts.map(p => { const [x, z] = xz(p.lat, p.lng); return {x, z, o: nodes.get(key(p))}; });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const total = cum[cum.length - 1];
    const at = d => {
      d = clamp(d, 0, total); let i = 0;
      while (i < pts.length - 2 && cum[i + 1] < d) i++;
      const a = pts[i], b = pts[i + 1], len = (cum[i + 1] - cum[i]) || 1, f = (d - cum[i]) / len;
      return {x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len};
    };
    const stops = [];
    pts.forEach((q, i) => {
      const b = q.o?.brace ?? 'none';
      if (i === 0 || i === pts.length - 1 || b !== 'none') stops.push({d: cum[i], i, b, gw: b === 'gate' ? (+q.o.pt.gw || 0) * M : 0});
    });
    const sp = Math.max(1, +t.spacing || 12) * M, pe = (+t.pullEvery || 0) * M;
    const posts = [], spots = [], gates = [], stretches = [], SI = layoutOf ? layoutOf(l.id) : null;
    for (const st of stops) {
      if (st.b === 'gate') {
        const d0 = clamp(st.d - st.gw / 2, 0, total), d1 = clamp(st.d + st.gw / 2, 0, total);
        gates.push({d0, d1, gm: pts[st.i].o?.pt?.gm || t.gateM});
        spots.push({d: d0, kit: t.braceGate, dirs: d0 > 0 ? [-1] : [], what: 'Gate post'}, {d: d1, kit: t.braceGate, dirs: d1 < total ? [1] : [], what: 'Gate post'});
      } else if (st.b !== 'none' && kitById[st.b]) {
        spots.push({d: st.d, kit: st.b, dirs: st.i === 0 ? [1] : st.i === pts.length - 1 ? [-1] : [-1, 1], what: st.i === 0 || st.i === pts.length - 1 ? 'End brace' : 'Corner brace'});
      } else posts.push({d: st.d, kind: 'wood'});
    }
    for (let k = 1; k < stops.length; k++) {
      const a = stops[k - 1], b = stops[k], d0 = a.d + a.gw / 2, d1 = b.d - b.gw / 2;
      if (d1 <= d0) continue;
      stretches.push([d0, d1]);
      const len = d1 - d0, parts = pe > 0 && len > pe ? Math.ceil(len / pe) : 1;
      // use the same layout as the estimate, including any posts placed by hand
      const pre = SI?.[k - 1]?.items;
      if (pre) {
        for (const it of pre) {
          const d = d0 + len * it.f;
          if (it.k === 'p') spots.push({d, kit: t.bracePull, dirs: [-1, 1], what: 'Pull brace'});
          else posts.push({d, mid: it.k >= 0 ? t.posts?.[it.k]?.m : t.postM, kind: it.k >= 0 ? 'wood' : 't', what: it.k >= 0 ? matName(t.posts?.[it.k]?.m) : matName(t.postM)});
        }
        // posts set "in between each post" (often stays that hang on the wire)
        for (const m of SI[k - 1].mids || []) posts.push({d: d0 + len * m.f, mid: t.posts?.[m.i]?.m, kind: 'mid', what: matName(t.posts?.[m.i]?.m)});
        continue;
      }
      for (let p = 0; p < parts; p++) {
        const s0 = d0 + len * p / parts, s1 = d0 + len * (p + 1) / parts;
        if (p > 0) spots.push({d: s0, kit: t.bracePull, dirs: [-1, 1], what: 'Pull brace'});
        const cnt = Math.max(0, Math.ceil((s1 - s0) / sp - 1e-9) - 1);
        for (let j = 1; j <= cnt; j++) { const ri = postRule ? postRule(t, j, (s1 - s0) / (cnt + 1) * FT, cnt) : -1; posts.push({d: s0 + (s1 - s0) * j / (cnt + 1), mid: ri >= 0 ? t.posts[ri].m : t.postM, kind: ri >= 0 ? 'wood' : 't', what: ri >= 0 ? matName(t.posts[ri].m) : matName(t.postM)}); }
      }
    }
    return {at, total, cum, posts, spots, gates, stretches};
  }

  // woven wire look: a see-through grid
  const meshTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.strokeStyle = 'rgba(225,229,232,1)'; g.lineWidth = 7;
    g.strokeRect(0, 0, 64, 64);
    const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
    return tx;
  })();
  trash.push(meshTex);
  let infos = [], layouts = new Map();

  function buildFences() {
    fences.traverse(o => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    fences.clear(); infos = []; layouts = new Map();
    const tposts = [], stays = [], woods = [], pipes = [], cyls = [], wire = {barbed: [], smooth: []}, meshV = [], meshUV = [], meshI = [], braceWire = [];
    const up = new THREE.Vector3(0, 1, 0);
    const cyl = (a, b, r, color) => cyls.push({a, b, r, color});
    for (const l of lines) {
      if (l.pts.length < 2) continue;
      const t = types.find(x => x.id === l.type) || types[0]; if (!t) continue;
      const col = new THREE.Color(t.color || '#ffffff'), dim = focus && l.id !== focus;
      const L = layout(l, t); layouts.set(l.id, L);
      const Hf = (+t.height || 4.5) * M;                       // fence height
      const P = d => { const q = L.at(d); return {...q, y: ground(q.x, q.z)}; };
      // route on the ground in the fence type's colour, so the line is easy to follow from far off
      const route = [];
      for (let d = 0; d <= L.total; d += Math.max(1, step)) { const q = P(d); if (inView(q.x, q.z)) route.push(new THREE.Vector3(q.x, q.y + 0.06, q.z)); }
      if (route.length > 1) fences.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(route), new THREE.LineBasicMaterial({color: col, transparent: true, opacity: dim ? 0.35 : 0.9})));
      // wire: woven wire as a grid panel, barbed and smooth wire as single strands, post to post
      const rows = (t.wires || []).map(wr => ({look: lookOf(wr), n: Math.max(0, Math.round(+wr.strands || 0)), name: matName(wr.m), h: +matOf(wr.m)?.height || 0, start: wr.start, gap: wr.gap})).filter(r => r.n > 0);
      // the wires go up the fence in the order they are listed: woven wire takes its height, strands share what is left
      const meshH = r => { const inch = r.h || +(r.name.match(/(\d+(?:\.\d+)?)\s*(?:"|in\b|inch)/i)?.[1] || 0); return inch ? inch * 0.0254 : Hf * 0.8; };
      // "starts at" and "apart" on a wire row (inches) place it exactly; without them it is spaced out evenly
      const INCH = 0.0254, isSetV = v => v !== undefined && v !== null && v !== '' && +v >= 0;
      const nStr = rows.filter(r => r.look !== 'mesh').reduce((a, r) => a + r.n, 0), meshSum = rows.filter(r => r.look === 'mesh').reduce((a, r) => a + meshH(r), 0);
      const autoGap = nStr ? Math.max(0.08, (Hf - 0.05 - meshSum) / nStr) : 0;
      const heights = [], meshes = []; // strands: [height, look]; woven panels: [bottom, top]
      { let y = 0.05; for (const r of rows) {
          if (r.look === 'mesh') { if (isSetV(r.start)) y = +r.start * INCH; const h = meshH(r); meshes.push([y, y + h]); y += h; }
          else { const g = isSetV(r.gap) && +r.gap > 0 ? +r.gap * INCH : autoGap;
            for (let k = 0; k < r.n; k++) { y = k === 0 && isSetV(r.start) ? +r.start * INCH : y + g; heights.push([y, r.look]); } }
      } }
      const wireLo = Math.min(...heights.map(h => h[0]), ...meshes.map(m => m[0]), Infinity), wireHi = Math.max(...heights.map(h => h[0]), ...meshes.map(m => m[1]), -Infinity);
      const stayLo = isFinite(wireLo) ? Math.max(0.05, wireLo - 0.04) : 0.15, stayHi = isFinite(wireHi) ? wireHi + 0.04 : Hf;
      // line posts
      const marks = [];
      for (const p of L.posts) {
        const q = P(p.d); if (!inView(q.x, q.z)) continue;
        // drawn from the material's details when they are filled in: what it's made of and how thick it is
        const mm = matOf(p.mid), made = postMade(mm, p);
        const rad = +mm?.dia > 0 ? mm.dia * 0.0127 : made === 'pipe' ? 0.045 : made === 'stay' ? 0.009 : 0.075;
        if (made === 'stay') { stays.push({x: q.x - (q.dz || 0) * 0.014, y: q.y + stayLo, z: q.z + (q.dx || 0) * 0.014, h: stayHi - stayLo, r: rad}); continue; }   // just off the wire, where it clips on   // hangs on the wire, not in the ground
        if (made === 'tpost') tposts.push({x: q.x, y: q.y, z: q.z, h: Hf + 0.1, dx: q.dx, dz: q.dz});
        else (made === 'pipe' ? pipes : woods).push({x: q.x, y: q.y, z: q.z, h: Hf + 0.15, r: rad});
        if (p.kind !== 'mid') marks.push({d: p.d, q, what: p.what || (p.kind === 't' ? 'Line post' : 'Post')});
      }
      // braces: built from each brace's own measurements (style, post heights, distance between posts, thickness)
      for (const sp of L.spots) {
        const kit = kitById[sp.kit], q = P(sp.d);
        if (!inView(q.x, q.z)) continue;
        const sh = kit?.shape, name = kit?.name || '';
        const h1 = sh ? (+sh.h1 || 4.5) * M : Hf + 0.25, r1 = sh ? (+sh.dia || 6) * 0.0127 : 0.085;
        const list = sh?.steel ? pipes : woods, rcol = sh?.steel ? 0x9aa3ab : 0x8a6a48;
        list.push({x: q.x, y: q.y, z: q.z, h: h1, r: r1});
        marks.push({d: sp.d, q, what: sp.what + (name ? ' (' + name + ')' : '')});
        if (!sh || sh.style === 'single') continue;
        const isA = sh.style === 'a' || sh.style === 'aa';
        const bays = isA ? 1 : Math.max(1, Math.round(+sh.bays || 1)), span = Math.max(1, +sh.span || 8) * M, rr = (+sh.rail || 4) * 0.0127;
        // a double A brace has a short post on both sides, even at the end of a line (it runs on past the end)
        const Pext = d => { if (d >= 0 && d <= L.total) return P(d); const e0 = d < 0 ? 0 : L.total, a = L.at(e0), x = a.x + a.dx * (d - e0), z = a.z + a.dz * (d - e0); return {x, z, y: ground(x, z)}; };
        for (const dir of (sh.style === 'aa' ? [-1, 1] : sp.dirs)) {
          let prev = q, ph = h1;
          for (let b = 1; b <= bays; b++) {
            const d2 = sp.d + dir * span * b; if (sh.style !== 'aa' && (d2 < 0 || d2 > L.total)) break;
            const r2 = Pext(d2), h2 = isA ? (+sh.h2 || 1) * M : h1;
            list.push({x: r2.x, y: r2.y, z: r2.z, h: h2, r: r1});
            const ya = sh.style === 'h' ? h1 * 0.8 : sh.style === 'n' ? ph * 0.92 : Math.max(0.09, ph - 0.15);
            const yb = sh.style === 'h' ? h1 * 0.8 : sh.style === 'n' ? 0.12 : Math.max(0.05, h2 - 0.08);
            cyl(new THREE.Vector3(prev.x, prev.y + ya, prev.z), new THREE.Vector3(r2.x, r2.y + yb, r2.z), rr, rcol);
            if (sh.style === 'h' && sh.wire) cyl(new THREE.Vector3(prev.x, prev.y + 0.1, prev.z), new THREE.Vector3(r2.x, r2.y + ya, r2.z), 0.009, 0xc4c8cc);
            prev = r2; ph = h2;
          }
        }
      }
      // gates: a tube gate across each opening. A tall gate (its material says how tall, like an 8 ft elk gate) is a
      // pipe frame filled with wire mesh, braced corner to corner; a farm gate is five tubes about 4 ft tall.
      for (const g of L.gates) {
        const a = P(g.d0 + 0.08), b = P(g.d1 - 0.08); if (!inView(a.x, a.z) || g.d1 - g.d0 < 0.5) continue;
        const gH = +matOf(g.gm)?.height > 0 ? +matOf(g.gm).height * 0.0254 : 0;
        if (gH > 1.6) {
          const lo = 0.1, hi = Math.min(gH, Hf + 0.1), fr = 0x7d878f, rr = 0.026;
          for (const hh of [lo, hi, (lo + hi) / 2]) cyl(new THREE.Vector3(a.x, a.y + hh, a.z), new THREE.Vector3(b.x, b.y + hh, b.z), hh === (lo + hi) / 2 ? 0.018 : rr, fr);
          const n = Math.max(1, Math.round((g.d1 - g.d0) / 2.5));
          for (let k = 0; k <= n; k++) { const m = P(g.d0 + 0.08 + (g.d1 - g.d0 - 0.16) * k / n); cyl(new THREE.Vector3(m.x, m.y + lo, m.z), new THREE.Vector3(m.x, m.y + hi, m.z), k === 0 || k === n ? rr : 0.018, fr); }
          cyl(new THREE.Vector3(a.x, a.y + lo, a.z), new THREE.Vector3(b.x, b.y + hi, b.z), 0.018, fr);   // the diagonal that keeps it from sagging
          const o = meshV.length / 3, w = (g.d1 - g.d0) / 0.15;
          meshV.push(a.x, a.y + lo, a.z, a.x, a.y + hi, a.z, b.x, b.y + lo, b.z, b.x, b.y + hi, b.z);
          meshUV.push(0, lo / 0.15, 0, hi / 0.15, w, lo / 0.15, w, hi / 0.15); meshI.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
          marks.push({d: (g.d0 + g.d1) / 2, q: P((g.d0 + g.d1) / 2), what: 'Gate, ' + ((g.d1 - g.d0) * FT).toFixed(0) + ' ft wide, ' + (gH * FT).toFixed(0) + ' ft tall'});
          continue;
        }
        const gh = Math.min(Hf, 1.3), bars = 5;
        for (let i = 0; i < bars; i++) { const hh = 0.2 + (gh - 0.2) * i / (bars - 1); cyl(new THREE.Vector3(a.x, a.y + hh, a.z), new THREE.Vector3(b.x, b.y + hh, b.z), 0.022, 0x8f9aa3); }
        for (const f of [0, 0.5, 1]) { const m = P(g.d0 + 0.08 + (g.d1 - g.d0 - 0.16) * f); cyl(new THREE.Vector3(m.x, m.y + 0.2, m.z), new THREE.Vector3(m.x, m.y + gh, m.z), 0.022, 0x8f9aa3); }
        marks.push({d: (g.d0 + g.d1) / 2, q: P((g.d0 + g.d1) / 2), what: 'Gate, ' + ((g.d1 - g.d0) * FT).toFixed(0) + ' ft wide'});
      }
      for (const [d0, d1] of L.stretches) {
        const ds = [d0, d1, ...L.posts.filter(p => p.d > d0 && p.d < d1).map(p => p.d), ...L.spots.filter(p => p.d > d0 && p.d < d1).map(p => p.d), ...L.cum.filter(c => c > d0 && c < d1)].sort((a, b) => a - b);
        const qs = ds.map(P);
        for (let i = 1; i < qs.length; i++) {
          const a = qs[i - 1], b = qs[i]; if (!inView(a.x, a.z) && !inView(b.x, b.z)) continue;
          for (const [hh, look] of heights) cyl(new THREE.Vector3(a.x, a.y + hh, a.z), new THREE.Vector3(b.x, b.y + hh, b.z), look === 'barbed' ? 0.013 : 0.011, look === 'barbed' ? 0x5c5f63 : 0xe6e8ea);
          for (const [m0, m1] of meshes) {
            for (const hh of [m0, m1]) cyl(new THREE.Vector3(a.x, a.y + hh, a.z), new THREE.Vector3(b.x, b.y + hh, b.z), 0.009, 0xd5d9dc);
            const o = meshV.length / 3, u0 = ds[i - 1] / 0.15, u1 = ds[i] / 0.15, v0 = m0 / 0.15, v1 = m1 / 0.15;
            meshV.push(a.x, a.y + m0, a.z, a.x, a.y + m1, a.z, b.x, b.y + m0, b.z, b.x, b.y + m1, b.z);
            meshUV.push(u0, v0, u0, v1, u1, v0, u1, v1); meshI.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
          }
        }
      }
      // what to say when a post is clicked
      marks.sort((a, b) => a.d - b.d);
      marks.forEach((mk, i) => {
        const nx = marks[i + 1], pv = marks[i - 1], f = d => (d * FT).toFixed(1) + ' ft';
        infos.push({x: mk.q.x, z: mk.q.z, text: `${l.name}: ${mk.what}` + (nx ? `, ${f(nx.d - mk.d)} to the next post` : '') + (pv ? `, ${f(mk.d - pv.d)} from the last one` : '') + `. ${t.name}, posts set every ${+t.spacing || 12} ft`});
      });
    }
    // draw them (posts are instanced so thousands stay fast)
    const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const inst = (list, geo, mat) => {
      if (!list.length) { geo.dispose(); mat.dispose(); return; }
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => { ps.set(p.x, p.y + p.h / 2, p.z); sc.set(p.r * 2, p.h, p.r * 2); im.setMatrixAt(i, m4.compose(ps, qn.identity(), sc)); });
      im.instanceMatrix.needsUpdate = true; fences.add(im);
    };
    // a steel T-post: the flat face the wire clips to, along the fence, and the stem behind it, painted green with a white top
    if (tposts.length) {
      const yaw = new THREE.Quaternion(), flange = 0.035, thick = 0.0045, stem = 0.03, tip = 0.1;
      const part = (geo, color, place) => {
        const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({color}), tposts.length);
        tposts.forEach((p, i) => { yaw.setFromAxisAngle(up, Math.atan2(-(p.dz || 0), p.dx ?? 1)); const [ox, oy, oz, h] = place(p); const off = new THREE.Vector3(ox, 0, oz).applyQuaternion(yaw);
          ps.set(p.x + off.x, p.y + oy, p.z + off.z); sc.set(1, h, 1); im.setMatrixAt(i, m4.compose(ps, yaw, sc)); });
        im.instanceMatrix.needsUpdate = true; fences.add(im);
      };
      part(new THREE.BoxGeometry(flange, 1, thick), 0x2f6b3a, p => [0, (p.h - tip) / 2, 0, p.h - tip]);
      part(new THREE.BoxGeometry(thick, 1, stem), 0x2f6b3a, p => [0, (p.h - tip) / 2, stem / 2, p.h - tip]);
      part(new THREE.BoxGeometry(flange, 1, thick), 0xf2f2ee, p => [0, p.h - tip / 2, 0, tip]);
      part(new THREE.BoxGeometry(thick, 1, stem), 0xf2f2ee, p => [0, p.h - tip / 2, stem / 2, tip]);
      // the studs down the face that hold the clips
      const studs = [];
      for (const p of tposts) for (let y = 0.12; y < p.h - tip; y += 0.1) studs.push({x: p.x, y: p.y + y, z: p.z, dx: p.dx, dz: p.dz});
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.008, 0.012, 0.006), new THREE.MeshLambertMaterial({color: 0x2f6b3a}), studs.length || 1);
      studs.forEach((p, i) => { yaw.setFromAxisAngle(up, Math.atan2(-(p.dz || 0), p.dx ?? 1)); const off = new THREE.Vector3(0, 0, -0.004).applyQuaternion(yaw); ps.set(p.x + off.x, p.y, p.z + off.z); sc.set(1, 1, 1); im.setMatrixAt(i, m4.compose(ps, yaw, sc)); });
      im.count = studs.length; im.instanceMatrix.needsUpdate = true; fences.add(im);
    }
    // stays: a thin rod clipped to the wires, from just under the bottom wire to just over the top one
    inst(stays, new THREE.CylinderGeometry(0.5, 0.5, 1, 8), new THREE.MeshLambertMaterial({color: 0x4f565c}));
    inst(woods, new THREE.CylinderGeometry(0.5, 0.5, 1, 10), new THREE.MeshLambertMaterial({color: 0x8a6a48}));
    inst(pipes, new THREE.CylinderGeometry(0.5, 0.5, 1, 12), new THREE.MeshLambertMaterial({color: 0x9aa3ab}));
    // a cap on top of every pipe post
    inst(pipes.map(p => ({x: p.x, y: p.y + p.h, z: p.z, h: 0.035, r: p.r * 1.18})), new THREE.CylinderGeometry(0.5, 0.42, 1, 12), new THREE.MeshLambertMaterial({color: 0x4a5056}));
    for (const color of new Set(cyls.map(c => c.color))) {
      const list = cyls.filter(c => c.color === color), im = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshLambertMaterial({color}), list.length);
      list.forEach((c, i) => { const dv = c.b.clone().sub(c.a), len = dv.length() || 0.01; ps.copy(c.a).addScaledVector(dv, 0.5); qn.setFromUnitVectors(up, dv.normalize()); sc.set(c.r, len, c.r); im.setMatrixAt(i, m4.compose(ps, qn, sc)); });
      im.instanceMatrix.needsUpdate = true; fences.add(im);
    }
    const segs = (arr, color) => { if (!arr.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); fences.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({color}))); };
    segs(wire.barbed, 0x6f6f6f); segs(wire.smooth, 0xe2e2e2); segs(braceWire, 0xbdbdbd);
    if (meshV.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(meshV, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(meshUV, 2)); g.setIndex(meshI);
      fences.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({map: meshTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide})));
    }
    counts.textContent = `${tposts.length.toLocaleString()} T-posts, ${(woods.length + pipes.length).toLocaleString()} other and brace posts${stays.length ? `, ${stays.length.toLocaleString()} stays` : ''} shown`;
  }
  function setStretch(v) {
    ex = v;
    for (let i = 0; i < W * H; i++) pos[i * 3 + 1] = (data[i] - zmin) * ex;
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
    buildFences();
  }
  const range = ov.querySelector('input[type=range]'), out = ov.querySelector('output');
  setStretch(+range.value);
  // the sharp versions, as they come in
  fullSat.then(t => {
    if (t === tex) return;   // already showing it
    if (disposed || !t) { t?.dispose(); return; }
    const old = mat.map; mat.map = prepTex(t); mat.color.set(0xffffff); mat.needsUpdate = true; if (old && old !== t) old.dispose();
  });
  if (rough) fullDem.then(d => {
    if (disposed) return;
    if (!d || !takeDem(d)) { msg.textContent = rangeText(); return; }
    if (d.fallback) { srcFallback = true; showSrc(); }
    const old = terrain.geometry; geo = terrain.geometry = terrainGeo(); old.dispose();
    setStretch(ex); buildBuildings(); if (walking) dropToGround();
    msg.textContent = rangeText();
  });
  range.oninput = () => { out.textContent = range.value + '×'; setStretch(+range.value); buildBuildings(); if (walking) dropToGround(); };
  ov.querySelector('.v3fences').onchange = ev => { fences.visible = ev.target.checked; };

  // ----- buildings: outlines and heights from FEMA's USA Structures, stood up as plain blocks -----
  const buildings = new THREE.Group(); scene.add(buildings);
  const bldMat = new THREE.MeshLambertMaterial({color: 0xd6d9dc}), bldEdge = new THREE.LineBasicMaterial({color: 0x4c5055});
  trash.push(bldMat, bldEdge);
  let bldData = null;
  function buildBuildings() {
    buildings.traverse(o => o.geometry?.dispose()); buildings.clear();
    if (!bldData) return;
    for (const b of bldData) {
      const pts = b.ring.map(([ln, la]) => xz(la, ln));
      if (pts.length < 4 || pts.some(([x, z]) => !inView(x, z))) continue;
      let lo = Infinity, hi = -Infinity;
      for (const [x, z] of pts) { const y = ground(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), {depth: hi - lo + b.h, bevelEnabled: false});
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, bldMat); m.position.y = lo; buildings.add(m);
      const eg = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), bldEdge); eg.position.y = lo; buildings.add(eg);
    }
  }
  ov.querySelector('.v3bld').onchange = ev => { buildings.visible = ev.target.checked; };
  fetch('https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query?' + new URLSearchParams({
    geometry: [w, s, e, n].map(v => v.toFixed(6)).join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'HEIGHT', resultRecordCount: '1500', f: 'geojson'}))
    .then(r => r.json()).then(j => {
      if (disposed) return;
      bldData = (j.features || []).flatMap(f => {
        const g = f.geometry, polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        return polys.map(pl => ({ring: pl[0], h: Math.max(2.5, +f.properties?.HEIGHT || 4.5)}));   // HEIGHT is in metres
      });
      buildBuildings();
      ov.querySelector('.v3bldt').textContent = 'Buildings (' + (buildings.children.length / 2) + ')';
    }).catch(() => { ov.querySelector('.v3bldt').textContent = 'Buildings (none loaded)'; });

  // ----- moving around: W A S D to move, the arrow keys (or Q E) turn and tilt the camera, R F up and down, Shift to go faster -----
  const held = new Set(), MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'];
  // ----- walk mode: you, at eye level, like a first-person game. Mouse looks, W A S D walks, Shift runs, Space jumps -----
  let walking = false, locked = false, unlockedAt = 0; const EYE = 1.7;
  const me = {x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, phase: 0, moving: 0};
  const fwdOf = () => new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
  const dropToGround = () => { me.y = ground(me.x, me.z); me.vy = 0; };
  const hud = document.createElement('div'); hud.className = 'v3hud'; hud.hidden = true;
  hud.innerHTML = '<div class="v3cross"></div><div class="v3tip" hidden></div>';
  box.appendChild(hud);
  const tip = hud.querySelector('.v3tip');
  const NOTE_FLY = note.innerHTML;
  const NOTE_WALK = 'Move the mouse to look around (hold it near the edge to keep turning). <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> walk, the arrow keys look around, <kbd>Shift</kbd> run, <kbd>Space</kbd> jump. <kbd>Esc</kbd> frees the mouse, <kbd>V</kbd> leaves walk mode. Click a post to see what it is.';
  function setWalk(on) {
    if (on && tool) setTool(null);   // building tools work from above, not on foot
    walking = on; ov.querySelector('.v3nav').hidden = on; walkBtn.classList.toggle('on', on); walkBtn.textContent = on ? 'Leave walk mode' : 'Walk the fence';
    controls.enabled = !on; hud.hidden = !on; cvs.style.cursor = on ? 'none' : ''; note.innerHTML = on ? NOTE_WALK : NOTE_FLY;
    if (on) {
      const l = lines.find(x => x.id === focus && x.pts.length > 1) || lines.find(x => x.pts.length > 1), L = l && layouts.get(l.id);
      const q = L ? L.at(0) : {x: 0, z: 0, dx: 0, dz: -1};
      // stand a few steps to the side of the start of the line, looking along it
      me.x = q.x - q.dz * 3 - q.dx * 4; me.z = q.z + q.dx * 3 - q.dz * 4; dropToGround();
      me.yaw = Math.atan2(-q.dx, -q.dz); me.pitch = -0.08;
      camera.near = 0.05; camera.updateProjectionMatrix();
      grabMouse();   // the mouse steers your view right away, like a game
    } else {
      if (locked) document.exitPointerLock?.();
      zoomLeft = 0; grab = null;
      controls.target.set(me.x, ground(me.x, me.z), me.z);
      const f = fwdOf(); camera.position.set(me.x - f.x * 40, controls.target.y + 35, me.z - f.z * 40);
      controls.update();
    }
  }
  const walkBtn = ov.querySelector('.v3walk'); walkBtn.onclick = () => setWalk(!walking);
  ov.querySelector('.v3over').onclick = () => { if (walking) setWalk(false); overview(); };
  // mouse look: pointer lock after a click, or drag with the button held
  const cvs = renderer.domElement;
  // take over the mouse (pointer lock): moving it turns your head, no clicking or dragging needed
  function grabMouse() {
    if (locked || !cvs.requestPointerLock) return;
    try {
      const r = cvs.requestPointerLock({unadjustedMovement: true});
      r?.catch?.(() => { try { cvs.requestPointerLock()?.catch?.(() => {}); } catch (e) {} });   // if the window won't lock the mouse, plain mouse moves still steer
    } catch (e) { try { cvs.requestPointerLock(); } catch (e2) {} }
  }
  const look = (dx, dy) => { me.yaw -= dx * 0.0024; me.pitch = clamp(me.pitch - dy * 0.0024, -1.35, 1.25); };
  const onLockChange = () => { locked = document.pointerLockElement === cvs; if (!locked) unlockedAt = performance.now(); tip.hidden = true; };
  // moving the mouse turns your head, locked or not; near the left or right edge you keep turning
  let edge = 0;
  const onMouseMove = ev => {
    if (!walking) return;
    if (locked) return look(ev.movementX, ev.movementY);
    const rc = cvs.getBoundingClientRect();
    if (ev.clientX < rc.left || ev.clientX > rc.right || ev.clientY < rc.top || ev.clientY > rc.bottom) { edge = 0; return; }
    if (Math.abs(ev.movementX) < 120 && Math.abs(ev.movementY) < 120) look(ev.movementX, ev.movementY);   // skip the jump when the mouse first comes onto the view
    const nx = (ev.clientX - rc.left) / rc.width * 2 - 1;
    edge = Math.abs(nx) > 0.82 ? Math.sign(nx) * (Math.abs(nx) - 0.82) / 0.18 : 0;
  };
  cvs.addEventListener('mouseleave', () => { edge = 0; });
  document.addEventListener('pointerlockchange', onLockChange); document.addEventListener('mousemove', onMouseMove);
  trash.push({dispose: () => { document.removeEventListener('pointerlockchange', onLockChange); document.removeEventListener('mousemove', onMouseMove); if (locked) document.exitPointerLock?.(); }});
  cvs.addEventListener('pointerdown', () => { if (walking && !locked) grabMouse(); });

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  function stepWalk(dt) {
    const f = fwdOf(), r = new THREE.Vector3(-f.z, 0, f.x);
    const kf = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    const kr = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
    me.yaw += ((held.has('KeyQ') || held.has('ArrowLeft') ? 1 : 0) - (held.has('KeyE') || held.has('ArrowRight') ? 1 : 0)) * dt * 2 - (locked ? 0 : edge * dt * 2.2);
    const lookUp = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
    if (lookUp) me.pitch = clamp(me.pitch + lookUp * dt * 1.2, -1.35, 1.25);
    const run = held.has('Shift'), speed = run ? 7 : 3;
    mv.set(0, 0, 0).addScaledVector(f, kf).addScaledVector(r, kr);
    const moving = mv.lengthSq() > 0;
    if (moving) {
      mv.normalize().multiplyScalar(speed * dt);
      let nx = me.x + mv.x, nz = me.z + mv.z;
      // bump into posts instead of walking through them
      if (fences.visible) for (const it of infos) { const dx = nx - it.x, dz = nz - it.z, d = Math.hypot(dx, dz); if (d < 0.38 && d > 1e-6) { nx = it.x + dx / d * 0.38; nz = it.z + dz / d * 0.38; } }
      me.x = clamp(nx, -Wm / 2 + 1, Wm / 2 - 1); me.z = clamp(nz, -Hm / 2 + 1, Hm / 2 - 1);
    }
    // jumping and falling, landing on the ground
    const gy = ground(me.x, me.z);
    if (held.has('Space') && me.y <= gy + 0.02) me.vy = 4.6;
    me.vy -= 14 * dt; me.y += me.vy * dt;
    if (me.y < gy) { me.y = gy; me.vy = 0; }
    // a little step in your stride while you walk
    me.moving += ((moving ? 1 : 0) - me.moving) * Math.min(1, dt * 10);
    if (moving) me.phase += dt * (run ? 11 : 7);
    const dir = new THREE.Vector3(-Math.sin(me.yaw) * Math.cos(me.pitch), Math.sin(me.pitch), -Math.cos(me.yaw) * Math.cos(me.pitch));
    const bob = Math.abs(Math.sin(me.phase)) * (run ? 0.06 : 0.035) * me.moving;
    camera.position.set(me.x, me.y + EYE + bob, me.z);
    camera.lookAt(camera.position.clone().add(dir));
  }
  // ----- flying over the map (the overview camera) -----
  // controls.target always sits ON THE GROUND at the middle of the screen, so turning, tilting and Q E all pivot around
  // the spot you are looking at, and speeds follow your height above the ground.
  const LOW = 2;                                          // closest the camera gets to the ground, m
  const topY = () => (zmax - zmin) * ex + size * 2.5;     // highest it goes
  const camH = () => camera.position.y - ground(camera.position.x, camera.position.z);
  const look3 = new THREE.Vector3(), hitV = new THREE.Vector3(), zoomAt = new THREE.Vector3(), ray3 = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let zoomLeft = 0, grab = null;
  const shift = (v) => { camera.position.add(v); controls.target.add(v); };   // slide the whole view, nothing turns
  // where a line of sight first meets the ground, or null if it never does
  function groundHit(o, d, out) {
    if (d.y > -0.005) return null;
    let t = 0, prev = 0; const far = size * 10;
    for (let i = 0; i < 500 && t < far; i++) {
      const h = o.y + d.y * t - ground(o.x + d.x * t, o.z + d.z * t);
      if (h <= 0) {
        let a = prev, b = t;   // narrow it down between the last point above the ground and this one
        for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (o.y + d.y * m - ground(o.x + d.x * m, o.z + d.z * m) > 0) a = m; else b = m; }
        return out.copy(d).multiplyScalar(b).add(o);
      }
      prev = t; t += Math.max(0.2, h * 0.5);
    }
    return null;
  }
  const cursorRay = ev => {
    const rc = cvs.getBoundingClientRect();
    ndc.set((ev.clientX - rc.left) / rc.width * 2 - 1, -(ev.clientY - rc.top) / rc.height * 2 + 1);
    camera.updateMatrixWorld(); ray3.setFromCamera(ndc, camera); return ray3.ray;
  };
  // put the pivot back on the ground in the middle of the screen (the view itself doesn't change)
  function anchor() {
    look3.subVectors(controls.target, camera.position); const d = look3.length(); if (d < 1e-6) return;
    look3.divideScalar(d);
    if (groundHit(camera.position, look3, hitV) && Math.abs(hitV.distanceTo(camera.position) - d) > d * 0.0005) controls.target.copy(hitV);
  }
  // stay over the map, above the ground and not too high
  function keepInRange() {
    const c = camera.position;   // the camera may hang back past the edge of the map to look at it, but not wander off
    mv.set(clamp(c.x, -Wm / 2 - size, Wm / 2 + size) - c.x, 0, clamp(c.z, -Hm / 2 - size, Hm / 2 + size) - c.z);
    const floor = ground(camera.position.x, camera.position.z) + LOW, top = topY();
    if (camera.position.y < floor) mv.y = floor - camera.position.y; else if (camera.position.y > top) mv.y = top - camera.position.y;
    if (mv.lengthSq()) shift(mv);
  }
  // zoom toward the spot under the mouse, which stays under the mouse
  function zoomBy(ev, amount) {
    const r = cursorRay(ev);
    if (!groundHit(r.origin, r.direction, zoomAt)) zoomAt.copy(controls.target);
    zoomLeft = clamp(zoomLeft + amount, -3, 3);
  }
  // turn (left and right) and tilt (up and down) around the spot in the middle of the screen
  const orbS = new THREE.Spherical(), orbV = new THREE.Vector3();
  function orbit(dTurn, dTilt) {
    orbV.subVectors(camera.position, controls.target); orbS.setFromVector3(orbV);
    orbS.theta += dTurn; orbS.phi = clamp(orbS.phi + dTilt, controls.minPolarAngle, controls.maxPolarAngle); orbS.makeSafe();
    orbV.setFromSpherical(orbS); camera.position.copy(controls.target).add(orbV); camera.lookAt(controls.target);
  }
  // Scrolling zooms the same way the map does (the same sums as Leaflet's wheel zoom): one mouse-wheel notch is about
  // one map zoom level, twice as near or as far; a trackpad's two fingers up and down, or a pinch, zoom at the same rate.
  // Shift (or Alt) + scroll turns and tilts instead.
  const mapLevels = ev => {
    const px = ev.deltaMode === 1 ? ev.deltaY * 20 : ev.deltaMode === 2 ? ev.deltaY * 60 : ev.deltaY / (devicePixelRatio || 1);
    const d = Math.abs(px) / 240;   // Leaflet: wheelPxPerZoomLevel 60, times 4
    return Math.sign(px) * 4 * Math.log2(2 / (1 + Math.exp(-d)));
  };
  cvs.addEventListener('wheel', ev => {
    if (walking) return;
    ev.preventDefault();
    if ((ev.shiftKey || ev.altKey) && !ev.ctrlKey) {
      const k = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1, dx = (ev.deltaX || 0) * k, dy = (ev.deltaY || 0) * k;
      const sideOnly = ev.shiftKey && !dy;   // some systems turn Shift + scroll into a sideways scroll
      return orbit(-(sideOnly ? 0 : dx) * 0.006, (sideOnly ? dx : dy) * 0.004);
    }
    zoomBy(ev, clamp(mapLevels(ev), -2, 2) * Math.LN2);
  }, {passive: false});
  // Safari on a Mac sends pinches and two-finger turns as gestures
  let gest = null;
  cvs.addEventListener('gesturestart', ev => { ev.preventDefault(); gest = {s: ev.scale || 1, r: ev.rotation || 0}; });
  cvs.addEventListener('gesturechange', ev => {
    ev.preventDefault(); if (!gest || walking) return;
    zoomBy(ev, clamp(-Math.log((ev.scale || 1) / gest.s), -0.5, 0.5)); orbit(-((ev.rotation || 0) - gest.r) * Math.PI / 180, 0);
    gest = {s: ev.scale || 1, r: ev.rotation || 0};
  });
  cvs.addEventListener('gestureend', ev => { ev.preventDefault(); gest = null; });
  // the buttons in the corner: hold one down to keep turning, tilting or zooming
  const nav = {turn: 0, tilt: 0, zoom: 0}, navBox = ov.querySelector('.v3nav');
  const navStop = () => { nav.turn = nav.tilt = nav.zoom = 0; };
  navBox.addEventListener('pointerdown', ev => {
    const b = ev.target.closest('[data-nav]'); if (!b) return;
    ev.preventDefault(); navStop(); nav[b.dataset.nav] = +b.dataset.v;
    try { navBox.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) navBox.addEventListener(t, navStop);
  addEventListener('pointerup', navStop); addEventListener('blur', navStop);
  trash.push({dispose: () => { removeEventListener('pointerup', navStop); removeEventListener('blur', navStop); }});
  navBox.addEventListener('contextmenu', ev => ev.preventDefault());
  function stepNav(dt) {
    if (nav.turn) orbit(nav.turn * dt * 1.1, 0);
    if (nav.tilt) orbit(0, nav.tilt * dt * 0.7);
    if (nav.zoom) { zoomAt.copy(controls.target); zoomLeft = clamp(zoomLeft + nav.zoom * dt * 1.6, -3, 3); }
  }
  function stepZoom(dt) {
    if (!zoomLeft) return;
    let k = zoomLeft * Math.min(1, dt * 14); if (Math.abs(zoomLeft) < 1e-3) k = zoomLeft;
    zoomLeft -= k;
    if (k > 0 && camera.position.y >= topY() - 1) { zoomLeft = 0; return; }
    const d = camera.position.distanceTo(zoomAt), nd = clamp(d * Math.exp(k), LOW, size * 5);
    shift(mv.subVectors(camera.position, zoomAt).multiplyScalar(nd / d - 1));
  }
  // left-drag: grab the ground and slide it, like a paper map (Ctrl/Shift + drag turns instead, see the controls setup)
  const fingers = new Set();
  cvs.addEventListener('pointerdown', ev => {
    fingers.add(ev.pointerId);
    if (walking || fingers.size > 1) { grab = null; return; }
    if (ev.button !== 0 || ev.ctrlKey || ev.shiftKey || ev.metaKey) return;
    const r = cursorRay(ev), p = new THREE.Vector3();
    if (!groundHit(r.origin, r.direction, p)) return;
    grab = {p, id: ev.pointerId}; zoomLeft = 0; cvs.style.cursor = 'grabbing';
    try { cvs.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  cvs.addEventListener('pointermove', ev => {
    if (!grab || walking || ev.pointerId !== grab.id) return;
    const r = cursorRay(ev);
    if (r.direction.y > -0.02) return;   // pointing at the sky
    const t = (grab.p.y - r.origin.y) / r.direction.y;
    hitV.copy(r.direction).multiplyScalar(t).add(r.origin);
    mv.set(grab.p.x - hitV.x, 0, grab.p.z - hitV.z);
    const most = Math.max(5, camH() * 3); if (mv.length() > most) mv.setLength(most);   // no wild jumps near the horizon
    shift(mv);
  });
  const letGo = ev => { fingers.delete(ev.pointerId); if (grab && ev.pointerId === grab.id) { grab = null; if (!walking) cvs.style.cursor = tool ? 'crosshair' : ''; } };
  cvs.addEventListener('pointerup', letGo); cvs.addEventListener('pointercancel', letGo);

  function moveBy(dt) {
    if (walking) return stepWalk(dt);
    if (!held.size) return;
    const speed = Math.max(3, camH()) * (held.has('Shift') ? 3 : 1);   // about your own height above the ground each second
    fwd.subVectors(controls.target, camera.position); fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1); fwd.normalize(); right.crossVectors(fwd, yAxis);
    const f = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    const r = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
    const u = (held.has('KeyR') || held.has('PageUp') ? 1 : 0) - (held.has('KeyF') || held.has('PageDown') ? 1 : 0);
    mv.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, r);
    if (mv.lengthSq()) mv.normalize().multiplyScalar(speed * dt);
    mv.y = u * speed * dt * 0.7;
    if (mv.lengthSq()) shift(mv);   // flat over the ground (or straight up and down), same tilt
    // the left and right arrows (or Q and E) turn, the up and down arrows tilt, around the spot in the middle of the screen
    const turn = (held.has('KeyQ') || held.has('ArrowLeft') ? 1 : 0) - (held.has('KeyE') || held.has('ArrowRight') ? 1 : 0);
    const tilt = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
    if (turn || tilt) orbit(turn * dt * 1.2, tilt * dt * 0.8);
  }

  // start looking at the fences from the south, a bit above
  const overview = () => {
    zoomLeft = 0; grab = null;
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;   // drop any leftover spin from a drag
    const cy = ground(0, 0);
    controls.target.set(0, cy, 0); camera.position.set(-size * 0.15, cy + size * 0.55, size * 0.8); controls.update();
  };
  overview();  onKeyDown = ev => {
    if (ev.target.closest?.('input,select,textarea')) return;
    // while building: Esc stops, Enter finishes the line, Backspace (or Ctrl+Z) takes back the last point
    if (tool && !walking) {
      if (ev.key === 'Escape') { ev.preventDefault(); return cancelTool(); }
      if (ev.key === 'Enter' && tool === 'draw') { ev.preventDefault(); return finishLine(); }
      if (tool === 'draw' && (ev.key === 'Backspace' || ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyZ'))) { ev.preventDefault(); return undoPoint(); }
      if (ev.code === 'KeyV') return;   // don't drop what you're building by walking off
    }
    if (ev.key === 'Escape') {
      // Esc first frees the mouse, then leaves walk mode, then closes the 3D view
      if (locked || performance.now() - unlockedAt < 400) return;
      return walking ? setWalk(false) : close();
    }
    if (ev.key === 'Shift') held.add('Shift');
    if (ev.code === 'KeyV') return setWalk(!walking);
    if (walking && ev.code === 'Space') { held.add('Space'); ev.preventDefault(); return; }
    if (MOVE.includes(ev.code) && !ev.ctrlKey && !ev.metaKey) { held.add(ev.code); ev.preventDefault(); }
  };
  onKeyUp = ev => { held.delete(ev.code); if (ev.key === 'Shift') held.delete('Shift'); };
  addEventListener('blur', () => held.clear());

  // click the ground to read its height, or a post to see what it is and how far to the next one
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener('pointerdown', ev => { down = [ev.clientX, ev.clientY]; });
  renderer.domElement.addEventListener('pointerup', ev => {
    // building: a plain click (no drag) places the point; a drag still slides the ground
    if (tool && !walking) {
      if (down && ev.button === 0 && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) <= 6) toolClick(ev);
      down = null; return;
    }
    if (walking && locked) { ptr.set(0, 0); }
    else {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) return;
      if (walking) return;
      const rc = renderer.domElement.getBoundingClientRect();
      ptr.set((ev.clientX - rc.left) / rc.width * 2 - 1, -(ev.clientY - rc.top) / rc.height * 2 + 1);
    }
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObject(terrain)[0];
    if (!hit) return;
    const reach = Math.max(1.2, hit.distance * 0.03); let best = null, bd = reach;
    if (fences.visible) for (const it of infos) { const d = Math.hypot(it.x - hit.point.x, it.z - hit.point.z); if (d < bd) { bd = d; best = it; } }
    const [lat, lng] = llOf(hit.point.x, hit.point.z);
    msg.textContent = best ? best.text : `That spot is ${Math.round(hAt(lat, lng) * FT).toLocaleString()} ft above sea level`;
  });

  // ----- building fence from in here: Draw fence, Add brace, Add gate -----
  // The points go to the main app (edit.addLine and friends), which saves the job, recounts the bill and redraws the map,
  // then hands back fresh lines to stand up here. Nothing in the terrain is reloaded.
  const modeBar = ov.querySelector('.v3mode'), helpEl = ov.querySelector('.v3help');
  const drawBtn = ov.querySelector('.v3t-draw'), braceBtn = ov.querySelector('.v3t-brace'), gateBtn = ov.querySelector('.v3t-gate');
  const finBtn = ov.querySelector('.v3fin'), undoBtn = ov.querySelector('.v3undo'), cancelBtn = ov.querySelector('.v3cancel');
  const dc = document.createElement('canvas'); dc.className = 'v3draw'; box.appendChild(dc);
  const g2 = dc.getContext('2d');
  let tool = null, draft = [], hover = null, gateA = null, drewLast = false;
  const fmt = m => Math.round(m * FT).toLocaleString() + ' ft';
  const draftLen = () => draft.reduce((a, p, i) => i ? a + Math.hypot(p.x - draft[i - 1].x, p.z - draft[i - 1].z) : 0, 0);
  const lineXZ = l => l.pts.map(p => xz(p.lat, p.lng));
  const drawColor = () => { try { return edit?.drawColor?.() || '#ffffff'; } catch (e) { return '#ffffff'; } };
  function showHelp() {
    if (!tool) return;
    helpEl.textContent = tool === 'draw'
      ? (draft.length === 0 ? 'Click the ground where the fence starts.'
        : draft.length === 1 ? 'Now click the ground at the next corner.'
        : `${fmt(draftLen())} so far. Click the ground to place each corner, then press Finish line (or Enter).` + (draft.length >= 3 ? ' Click the first point again to close a loop.' : ''))
      : tool === 'brace' ? 'Click on a fence line where the brace goes, or click a corner to brace it. Press Done when you are finished.'
      : gateA ? 'Now click where the other gate post goes, across the gap.'
      : 'Click on a fence line where the first gate post goes.';
    undoBtn.disabled = !draft.length;
  }
  function setTool(t) {
    if (t && t !== 'draw' && !lines.some(l => l.pts.length > 1)) { msg.textContent = 'Draw a fence first, then you can add braces and gates to it.'; t = null; }
    if (t && walking) setWalk(false);
    tool = t; draft = []; gateA = null; hover = null;
    for (const [b, k] of [[drawBtn, 'draw'], [braceBtn, 'brace'], [gateBtn, 'gate']]) b.classList.toggle('on', tool === k);
    modeBar.hidden = !tool;
    finBtn.style.display = undoBtn.style.display = tool === 'draw' ? '' : 'none';
    cancelBtn.textContent = tool === 'draw' ? 'Cancel' : 'Done';
    cvs.style.cursor = tool ? 'crosshair' : '';
    showHelp();
  }
  function cancelTool() {
    if (tool === 'draw' && draft.length >= 3 && !confirm(`Throw away the ${draft.length} points you placed?`)) return;
    if (tool === 'draw' && draft.length) msg.textContent = 'Cancelled. No fence was added.';
    setTool(null);
  }
  function undoPoint() { if (tool !== 'draw' || !draft.length) return; draft.pop(); showHelp(); }
  // take the main app's fresh lines and stand the fences back up
  function rebuild(res) {
    if (disposed || !res) return;
    if (res.lines) lines = res.lines;
    if (res.nodes) nodes = res.nodes;
    buildFences();
  }
  function apply(res) {
    if (!res) return false;
    if (res.error) { msg.textContent = res.error; return false; }
    rebuild(res); if (res.msg) msg.textContent = res.msg;
    return true;
  }
  function finishLine() {
    if (tool !== 'draw') return;
    if (draft.length < 2) { msg.textContent = 'A fence needs at least two points. Click the ground to place them.'; return; }
    const len = draftLen(), was = focus; focus = null;   // show every line at full strength, the new one too
    let res; try { res = edit.addLine(draft.map(p => ({lat: p.lat, lng: p.lng}))); } catch (err) { console.error(err); res = {error: 'The fence could not be added'}; }
    if (!apply(res)) { focus = was; return; }
    msg.textContent = (res.msg || 'Fence added') + ` (${fmt(len)}). Press Draw fence to draw another.`;
    setTool(null);
  }
  // what a click would hit right now: a spot on the ground, a corner to join, or a spot on a fence line
  function pick(ev) {
    const r = cursorRay(ev), p = new THREE.Vector3();
    if (!groundHit(r.origin, r.direction, p)) return null;
    if (!inView(p.x, p.z)) return {miss: true, x: p.x, z: p.z, label: 'Outside the map area'};
    const dist = p.distanceTo(camera.position), snapR = Math.max(0.5, dist * 0.02), lineR = Math.max(1, dist * 0.04);
    if (tool === 'draw') {
      if (draft.length >= 3 && Math.hypot(draft[0].x - p.x, draft[0].z - p.z) < snapR) return {...draft[0], close: true, label: 'Close the loop'};
      // a corner of fence already there: join onto it exactly
      let best = null, bd = snapR;
      for (const l of lines) for (const q of l.pts) { const [x, z] = xz(q.lat, q.lng), d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; best = {x, z, lat: q.lat, lng: q.lng, join: true}; } }
      if (best) return {...best, label: 'Join this corner'};
      const [lat, lng] = llOf(p.x, p.z);
      return {x: p.x, z: p.z, lat, lng};
    }
    // add gate, second post: it slides along the same stretch of fence as the first one
    if (tool === 'gate' && gateA) {
      const l = lines.find(x => x.id === gateA.lineId); if (!l || !l.pts[gateA.i]) { gateA = null; showHelp(); return null; }
      const P = lineXZ(l), [ax, az] = P[gateA.i - 1], [bx, bz] = P[gateA.i], dx = bx - ax, dz = bz - az;
      const u = clamp(((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1), x = ax + dx * u, z = az + dz * u, [lat, lng] = llOf(x, z);
      return {x, z, lat, lng, lineId: l.id, i: gateA.i, label: 'Gate ' + fmt(Math.hypot(x - gateA.x, z - gateA.z))};
    }
    // add brace or the first gate post: the nearest spot on a fence line (for a brace, a corner when you're on one)
    let best = null;
    for (const l of lines) {
      if (l.pts.length < 2) continue;
      const P = lineXZ(l);
      if (tool === 'brace') P.forEach(([x, z], i) => { const d = Math.hypot(x - p.x, z - p.z) - snapR; if (d < 0 && (!best || d < best.d)) best = {d, x, z, lat: l.pts[i].lat, lng: l.pts[i].lng, lineId: l.id, i, corner: true}; });
      for (let i = 1; i < P.length; i++) {
        const [ax, az] = P[i - 1], [bx, bz] = P[i], dx = bx - ax, dz = bz - az;
        const u = clamp(((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1), x = ax + dx * u, z = az + dz * u, d = Math.hypot(x - p.x, z - p.z);
        if (d >= lineR || (best && d >= best.d)) continue;
        const [lat, lng] = llOf(x, z);
        if (tool === 'brace' && (u < 0.002 || u > 0.998)) { const j = u < 0.5 ? i - 1 : i; best = {d, x: P[j][0], z: P[j][1], lat: l.pts[j].lat, lng: l.pts[j].lng, lineId: l.id, i: j, corner: true}; }
        else best = {d, x, z, lat, lng, lineId: l.id, i};
      }
    }
    if (!best) return {miss: true, x: p.x, z: p.z, label: 'Move closer to a fence line'};
    return {...best, label: tool === 'brace' ? (best.corner ? 'Brace this corner' : 'Brace here') : 'First gate post here'};
  }
  function toolClick(ev) {
    const h = pick(ev); hover = h;
    if (!h) { msg.textContent = 'Click on the ground (not the sky).'; return; }
    if (h.miss) { msg.textContent = tool === 'draw' ? 'Click inside the map area.' : 'Click right on a fence line (the coloured line on the ground).'; return; }
    if (tool === 'draw') {
      if (h.close) { draft.push({...draft[0]}); return finishLine(); }
      const last = draft[draft.length - 1];
      if (last && Math.hypot(last.x - h.x, last.z - h.z) < 0.3) return;   // the same spot twice
      draft.push({x: h.x, z: h.z, lat: h.lat, lng: h.lng}); showHelp(); return;
    }
    let res;
    try {
      if (tool === 'brace') res = edit.addBrace(h.lineId, h.i, h.corner ? null : {lat: h.lat, lng: h.lng});
      else if (!gateA) { gateA = h; showHelp(); return; }
      else { const a = gateA; gateA = null; res = edit.addGate(a.lineId, a.i, {lat: a.lat, lng: a.lng}, {lat: h.lat, lng: h.lng}); }
    } catch (err) { console.error(err); res = {error: 'That could not be added'}; }
    if (apply(res)) msg.textContent = res.msg + (tool === 'brace' ? '. Click to add another, or press Done.' : '. Click to add another gate, or press Done.');
    hover = null; showHelp();
  }
  const toolBtn = (b, t) => { b.onclick = () => {
    b.blur();
    if (tool !== t) return setTool(t);
    if (t === 'draw' && draft.length >= 2) return finishLine();   // pressing Draw fence again finishes what you drew
    cancelTool();
  }; };
  toolBtn(drawBtn, 'draw'); toolBtn(braceBtn, 'brace'); toolBtn(gateBtn, 'gate');
  finBtn.onclick = () => { finBtn.blur(); finishLine(); };
  undoBtn.onclick = () => { undoBtn.blur(); undoPoint(); };
  cancelBtn.onclick = () => { cancelBtn.blur(); cancelTool(); };
  cvs.addEventListener('pointermove', ev => { if (tool && !walking) hover = pick(ev); });
  cvs.addEventListener('pointerleave', () => { hover = null; });
  // the main app changed the lines on its own (roads and rivers found along a new line): stand them up again
  if (edit) {
    edit.onOutsideChange = text => { if (disposed) return; rebuild(edit.fresh?.()); if (text) msg.textContent = text; };
    trash.push({dispose: () => { edit.onOutsideChange = null; }});
  }

  // what you're building, drawn over the 3D picture: points, lines along the ground, the side to the mouse with its length
  const pv = new THREE.Vector3();
  const scr = (x, z, lift = 0.15) => { pv.set(x, ground(x, z) + lift, z).project(camera); return pv.z > 1 || pv.z < -1 ? null : [(pv.x + 1) / 2 * dc.clientWidth, (1 - pv.y) / 2 * dc.clientHeight]; };
  function along(a, b) {   // a side, following the ground, as screen points (null where it goes behind you)
    const len = Math.hypot(b.x - a.x, b.z - a.z), k = clamp(Math.ceil(len / Math.max(1, step)), 1, 80), out = [];
    for (let j = 0; j <= k; j++) out.push(scr(a.x + (b.x - a.x) * j / k, a.z + (b.z - a.z) * j / k));
    return out;
  }
  function stroke(sides, color, width, dash) {
    for (const [c, wd] of [['rgba(0,0,0,0.55)', width + 4], [color, width]]) {
      g2.beginPath(); g2.setLineDash(dash || []); g2.strokeStyle = c; g2.lineWidth = wd; g2.lineJoin = g2.lineCap = 'round';
      for (const s of sides) { let pen = false; for (const q of s) { if (!q) { pen = false; continue; } if (pen) g2.lineTo(q[0], q[1]); else { g2.moveTo(q[0], q[1]); pen = true; } } }
      g2.stroke();
    }
    g2.setLineDash([]);
  }
  function dot(x, z, r, fill) {
    const q = scr(x, z); if (!q) return null;
    g2.beginPath(); g2.arc(q[0], q[1], r, 0, Math.PI * 2); g2.fillStyle = fill; g2.fill(); g2.lineWidth = 2.5; g2.strokeStyle = '#17191b'; g2.stroke();
    return q;
  }
  function tag(text, q, dy = -22) {
    if (!q || !text) return;
    g2.font = '600 15px system-ui, sans-serif'; const w2 = g2.measureText(text).width + 14, x = q[0] - w2 / 2, y = q[1] + dy - 13;
    g2.fillStyle = 'rgba(0,0,0,0.75)'; g2.beginPath(); g2.roundRect ? g2.roundRect(x, y, w2, 24, 5) : g2.rect(x, y, w2, 24); g2.fill();
    g2.fillStyle = '#fff'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(text, q[0], y + 12);
  }
  function drawOverlay() {
    if (!tool && !drewLast) return;
    const dpr = dc.width / Math.max(1, dc.clientWidth);
    g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, dc.clientWidth, dc.clientHeight);
    drewLast = !!tool; if (!tool) return;
    if (tool === 'draw') {
      const col = drawColor();
      if (draft.length > 1) stroke(draft.slice(1).map((p, i) => along(draft[i], p)), col, 4);
      const last = draft[draft.length - 1];
      if (last && hover && !hover.miss) {
        stroke([along(last, hover)], col, 3, [10, 8]);
        const m = scr((last.x + hover.x) / 2, (last.z + hover.z) / 2); tag(fmt(Math.hypot(hover.x - last.x, hover.z - last.z)), m, 0);
      }
      draft.forEach((p, i) => dot(p.x, p.z, i === 0 && draft.length >= 3 ? 8 : 6, i === 0 ? '#ffd21f' : '#ffffff'));
    }
    if (tool === 'gate' && gateA) {
      if (hover && !hover.miss) stroke([along(gateA, hover)], '#ffd21f', 5, [8, 7]);
      dot(gateA.x, gateA.z, 7, '#ffd21f');
    }
    if (hover) {
      const q = dot(hover.x, hover.z, hover.miss ? 5 : 8, hover.miss ? '#9aa0a6' : hover.close || hover.join || hover.corner ? '#ffd21f' : tool === 'draw' ? '#ffffff' : '#4cd964');
      tag(hover.label, q);
    }
  }

  const resize = () => {
    const r = box.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
    const dpr = Math.min(devicePixelRatio, 2); dc.width = Math.round(r.width * dpr); dc.height = Math.round(r.height * dpr); drewLast = true;
  };
  ro = new ResizeObserver(resize); ro.observe(box); resize();
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    moveBy(dt);
    if (!walking) {
      stepNav(dt); stepZoom(dt); controls.update(); keepInRange(); anchor();
      // keep close-up posts from being clipped when you're right next to them
      const near = clamp(camera.position.distanceTo(controls.target) / 100, 0.05, Math.max(0.5, size / 2000));
      if (Math.abs(near - camera.near) / camera.near > 0.2) { camera.near = near; camera.updateProjectionMatrix(); }
    }
    renderer.render(scene, camera); drawOverlay(); raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
