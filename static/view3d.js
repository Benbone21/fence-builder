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

let open = null;

export async function open3D({bounds, lines, types, nodes, key, focus, braces, materials, postRule, layoutOf}) {
  if (open) open.close();
  const ov = document.createElement('div');
  ov.id = 'v3d';
  ov.innerHTML = `<div class="v3bar"><b>3D view</b><span class="v3msg">Loading LiDAR terrain…</span>
    <label class="v3l">Height stretch <input type="range" min="1" max="4" step="0.25" value="1.5" aria-label="Height stretch"><output>1.5×</output></label>
    <label class="v3l"><input type="checkbox" class="v3fences" checked> Fences</label>
    <label class="v3l"><input type="checkbox" class="v3bld" checked> <span class="v3bldt">Buildings</span></label>
    <span class="v3counts v3l"></span>
    <button class="btn sm v3walk" title="Stand at the start of the fence at eye level (V)">Walk the fence</button>
    <button class="btn sm v3over" title="Back to the view from above">Overview</button>
    <button class="btn sm v3close">Close</button></div>
    <div class="v3c"></div>
    <div class="v3note">Move with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrow keys, turn with <kbd>Q</kbd> <kbd>E</kbd>, up and down with <kbd>R</kbd> <kbd>F</kbd>, hold <kbd>Shift</kbd> to go faster. Drag to look around, right-drag to slide, scroll to zoom. Click a post to see what it is and the spacing.</div>`;
  document.body.appendChild(ov);
  const msg = ov.querySelector('.v3msg'), box = ov.querySelector('.v3c'), note = ov.querySelector('.v3note'), counts = ov.querySelector('.v3counts');
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

  const s = bounds.getSouth(), n = bounds.getNorth(), w = bounds.getWest(), e = bounds.getEast();
  const lat0 = (s + n) / 2, mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110574;
  const Wm = (e - w) * mx, Hm = (n - s) * my, degAsp = (e - w) / (n - s);
  const N = 400, gw = degAsp >= 1 ? N : Math.max(40, Math.round(N * degAsp)), gh = degAsp >= 1 ? Math.max(40, Math.round(N / degAsp)) : N;
  const bbox = [w, s, e, n].map(v => v.toFixed(7)).join(',');
  const demUrl = `${USGS}/exportImage?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${gw},${gh}&format=tiff&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&compression=None&f=image`;
  // photo: about 0.25 m per pixel at most (asking for more detail than Esri has makes it fail), smaller tries after that
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  async function loadSat() {
    let px = Math.min(4096, Math.round(Math.max(Wm, Hm) / 0.15));
    for (let tries = 0; tries < 4; tries++, px = Math.round(px * 0.6)) {
      const tw = degAsp >= 1 ? px : Math.round(px * degAsp), th = degAsp >= 1 ? Math.round(px / degAsp) : px;
      try { return await loader.loadAsync(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${tw},${th}&format=jpg&f=image`); }
      catch (e) { /* try smaller */ }
    }
    return null;
  }

  // Elevation for the 3D ground: USGS 3DEP LiDAR first. When USGS is down or the spot is outside the
  // US, AWS Terrain Tiles (built from USGS 10 m data and others, about 5 to 10 m apart) fill in.
  const timeout = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Error('timed out')), ms))]);
  async function terrainTiles() {
    const span = Math.max(Wm, Hm), z = span < 3000 ? 15 : span < 8000 ? 14 : 13, nT = 2 ** z;
    const tx = lng => (lng + 180) / 360 * nT, ty = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * nT;
    const x0 = Math.floor(tx(w)), x1 = Math.floor(tx(e)), y0 = Math.floor(ty(n)), y1 = Math.floor(ty(s));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) throw Error('area too large');
    const cv = new OffscreenCanvas((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256), g = cv.getContext('2d');
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
      jobs.push(fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`)
        .then(r => { if (!r.ok) throw Error('tile'); return r.blob(); }).then(createImageBitmap).then(bm => g.drawImage(bm, (x - x0) * 256, (y - y0) * 256)));
    await Promise.all(jobs);
    const px = g.getImageData(0, 0, cv.width, cv.height).data, gw2 = gw, gh2 = gh, out = new Float32Array(gw2 * gh2);
    const at = (X, Y) => { X = Math.min(cv.width - 1, Math.max(0, X)); Y = Math.min(cv.height - 1, Math.max(0, Y)); const i = (Y * cv.width + X) * 4; return px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768; };
    for (let r = 0; r < gh2; r++) for (let c = 0; c < gw2; c++) {
      const lat = n - r / (gh2 - 1) * (n - s), lng = w + c / (gw2 - 1) * (e - w);
      const fx = (tx(lng) - x0) * 256, fy = (ty(lat) - y0) * 256, X = Math.floor(fx), Y = Math.floor(fy), dx = fx - X, dy = fy - Y;
      out[r * gw2 + c] = (at(X, Y) * (1 - dx) + at(X + 1, Y) * dx) * (1 - dy) + (at(X, Y + 1) * (1 - dx) + at(X + 1, Y + 1) * dx) * dy;
    }
    return {W: gw2, H: gh2, data: out, fallback: true};
  }
  async function loadDem() {
    try {
      const r = await timeout(25000, fetch(demUrl));
      if (!r.ok) throw Error('USGS answered ' + r.status);
      return readTiff(await r.arrayBuffer());
    } catch (e) {
      console.warn('USGS elevation not available, using AWS Terrain Tiles', e);
      return terrainTiles();
    }
  }
  let dem, tex, srcText;
  try {
    [dem, tex, srcText] = await Promise.all([loadDem(), loadSat(), timeout(8000, terrainSource(lat0, (w + e) / 2)).catch(() => '')]);
  } catch (err) {
    console.error(err);
    msg.textContent = 'Could not load the terrain right now. The elevation services did not answer, so try again in a little while.';
    return;
  }
  if (dem.fallback) srcText = 'AWS Terrain Tiles, about 10 m detail (USGS LiDAR is not answering right now)';
  if (disposed) return;
  const {W, H, data} = dem;
  let zmin = Infinity, zmax = -Infinity;
  for (const v of data) if (v > -1000) { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); }
  if (!isFinite(zmin)) { msg.textContent = 'USGS has no elevation for this spot.'; return; }
  for (let i = 0; i < data.length; i++) if (!(data[i] > -1000)) data[i] = zmin;
  msg.textContent = `${Math.round((zmax - zmin) * FT).toLocaleString()} ft from lowest to highest point`;
  note.innerHTML = esc(srcText ? 'Terrain from ' + srcText + '. ' : '') + note.innerHTML;

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
  controls.enableDamping = true; controls.zoomToCursor = true; controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 1.2; controls.maxDistance = size * 4;
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-size, size * 1.2, size * 0.6); scene.add(sun);

  // ----- terrain -----
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
  const pos = new Float32Array(W * H * 3), uv = new Float32Array(W * H * 2);
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = tex ? new THREE.MeshLambertMaterial({map: tex}) : new THREE.MeshLambertMaterial({color: 0x9c9a86});
  const terrain = new THREE.Mesh(geo, mat);
  scene.add(terrain);
  trash.push(geo, mat); if (tex) trash.push(tex);

  const step = Wm / W;
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
  let ex = 1.5;
  const ground = (x, z) => { const [la, ln] = llOf(x, z); return (hAt(la, ln) - zmin) * ex; };
  const M = 1 / FT, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const kitById = Object.fromEntries((braces || []).map(b => [b.id, b]));
  const matName = id => (materials || []).find(m => m.id === id)?.name || '';
  const matOf = id => (materials || []).find(m => m.id === id);
  const lookOf = wr => wr.look || matOf(wr.m)?.look || (/woven|field|mesh|knot|net|hinge|panel|no.?climb/i.test(matName(wr.m)) ? 'mesh' : /barb/i.test(matName(wr.m)) ? 'barbed' : 'smooth');

  // where everything goes along one line (distances in metres along the line)
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
        gates.push({d0, d1});
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
    const tposts = [], woods = [], pipes = [], cyls = [], wire = {barbed: [], smooth: []}, meshV = [], meshUV = [], meshI = [], braceWire = [];
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
      // line posts
      const marks = [];
      for (const p of L.posts) {
        const q = P(p.d); if (!inView(q.x, q.z)) continue;
        // drawn from the material's details when they are filled in: what it's made of and how thick it is
        const mm = matOf(p.mid), made = mm?.made || (p.kind === 't' ? 'tpost' : /pipe|steel/i.test(p.what || '') ? 'pipe' : 'wood');
        const rad = +mm?.dia > 0 ? mm.dia * 0.0127 : made === 'tpost' ? 0.04 : made === 'pipe' ? 0.045 : 0.075;
        (made === 'tpost' ? tposts : made === 'pipe' ? pipes : woods).push({x: q.x, y: q.y, z: q.z, h: Hf + 0.15, r: rad});
        marks.push({d: p.d, q, what: p.what || (p.kind === 't' ? 'Line post' : 'Post')});
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
      // gates: a tube gate across each opening
      for (const g of L.gates) {
        const a = P(g.d0 + 0.08), b = P(g.d1 - 0.08); if (!inView(a.x, a.z) || g.d1 - g.d0 < 0.5) continue;
        const gh = Math.min(Hf, 1.3), bars = 5;
        for (let i = 0; i < bars; i++) { const hh = 0.2 + (gh - 0.2) * i / (bars - 1); cyl(new THREE.Vector3(a.x, a.y + hh, a.z), new THREE.Vector3(b.x, b.y + hh, b.z), 0.022, 0x8f9aa3); }
        for (const f of [0, 0.5, 1]) { const m = P(g.d0 + 0.08 + (g.d1 - g.d0 - 0.16) * f); cyl(new THREE.Vector3(m.x, m.y + 0.2, m.z), new THREE.Vector3(m.x, m.y + gh, m.z), 0.022, 0x8f9aa3); }
        marks.push({d: (g.d0 + g.d1) / 2, q: P((g.d0 + g.d1) / 2), what: 'Gate, ' + ((g.d1 - g.d0) * FT).toFixed(0) + ' ft wide'});
      }
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
    inst(tposts, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({color: 0x2f5d3a}));
    inst(woods, new THREE.CylinderGeometry(0.5, 0.5, 1, 10), new THREE.MeshLambertMaterial({color: 0x8a6a48}));
    inst(pipes, new THREE.CylinderGeometry(0.5, 0.5, 1, 12), new THREE.MeshLambertMaterial({color: 0x9aa3ab}));
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
    counts.textContent = `${tposts.length.toLocaleString()} line posts, ${(woods.length + pipes.length).toLocaleString()} other and brace posts shown`;
  }
  function setStretch(v) {
    ex = v;
    for (let i = 0; i < W * H; i++) pos[i * 3 + 1] = (data[i] - zmin) * ex;
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
    buildFences();
  }
  const range = ov.querySelector('input[type=range]'), out = ov.querySelector('output');
  setStretch(+range.value);
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

  // start looking at the fences from the south, a bit above
  const overview = () => {
    const midY = (zmax - zmin) * ex / 2;
    controls.target.set(0, midY, 0); camera.position.set(-size * 0.15, midY + size * 0.55, size * 0.8); controls.update();
  };
  overview();

  // ----- moving around: W A S D or arrows, Q E to turn, R F up and down, Shift to go faster -----
  const held = new Set(), MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'];
  let walking = false; const EYE = 1.7;
  const dropToGround = () => { const dy = ground(camera.position.x, camera.position.z) + EYE - camera.position.y; camera.position.y += dy; controls.target.y += dy; };
  function setWalk(on) {
    walking = on; walkBtn.classList.toggle('on', on); walkBtn.textContent = on ? 'Leave walk mode' : 'Walk the fence';
    if (on) {
      const l = lines.find(x => x.id === focus && x.pts.length > 1) || lines.find(x => x.pts.length > 1), L = l && layouts.get(l.id);
      const q = L ? L.at(0) : {x: 0, z: 0, dx: 0, dz: -1};
      // stand a few steps to the side of the start of the line, looking along it
      camera.position.set(q.x - q.dz * 3 - q.dx * 4, 0, q.z + q.dx * 3 - q.dz * 4);
      controls.target.set(camera.position.x + q.dx * 0.6 + q.dz * 0.12, 0, camera.position.z + q.dz * 0.6 - q.dx * 0.12);
      camera.position.y = controls.target.y = 0; dropToGround();
      controls.minDistance = 0.3; controls.maxDistance = 1; controls.enableZoom = false; controls.maxPolarAngle = Math.PI * 0.75;
    } else {
      controls.minDistance = 1.2; controls.maxDistance = size * 4; controls.enableZoom = true; controls.maxPolarAngle = Math.PI * 0.48;
      const t = controls.target.clone(); t.y = ground(t.x, t.z);
      controls.target.copy(t); camera.position.set(t.x - 30, t.y + 40, t.z + 60);
    }
    controls.update();
  }
  const walkBtn = ov.querySelector('.v3walk'); walkBtn.onclick = () => setWalk(!walking);
  ov.querySelector('.v3over').onclick = () => { if (walking) setWalk(false); overview(); };
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  function moveBy(dt) {
    if (!held.size) return;
    const dist = camera.position.distanceTo(controls.target), fast = held.has('Shift') ? 3 : 1;
    const speed = (walking ? 5 : Math.max(4, dist * 0.9)) * fast;
    fwd.subVectors(controls.target, camera.position); fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1); fwd.normalize(); right.crossVectors(fwd, yAxis);
    const f = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0);
    const r = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
    const u = (held.has('KeyR') || held.has('PageUp') ? 1 : 0) - (held.has('KeyF') || held.has('PageDown') ? 1 : 0);
    mv.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, r);
    if (mv.lengthSq()) mv.normalize().multiplyScalar(speed * dt);
    if (!walking) mv.y = u * speed * dt * 0.6;
    camera.position.add(mv); controls.target.add(mv);
    const turn = (held.has('KeyQ') ? 1 : 0) - (held.has('KeyE') ? 1 : 0);
    if (turn) {
      // walking: turn your head; flying: swing around the spot you're looking at
      const ang = turn * dt * 1.4, pivot = walking ? camera.position : controls.target, moved = walking ? controls.target : camera.position;
      moved.sub(pivot).applyAxisAngle(yAxis, walking ? ang : -ang).add(pivot);
    }
    if (walking) dropToGround();
    else { const floor = ground(clamp(camera.position.x, -Wm / 2, Wm / 2), clamp(camera.position.z, -Hm / 2, Hm / 2)) + 1; if (camera.position.y < floor) camera.position.y = floor; }
  }
  onKeyDown = ev => {
    if (ev.target.closest?.('input,select,textarea')) return;
    if (ev.key === 'Escape') return close();
    if (ev.key === 'Shift') held.add('Shift');
    if (ev.code === 'KeyV') return setWalk(!walking);
    if (MOVE.includes(ev.code) && !ev.ctrlKey && !ev.metaKey) { held.add(ev.code); ev.preventDefault(); }
  };
  onKeyUp = ev => { held.delete(ev.code); if (ev.key === 'Shift') held.delete('Shift'); };
  addEventListener('blur', () => held.clear());

  // click the ground to read its height, or a post to see what it is and how far to the next one
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener('pointerdown', ev => { down = [ev.clientX, ev.clientY]; });
  renderer.domElement.addEventListener('pointerup', ev => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) return;
    const rc = renderer.domElement.getBoundingClientRect();
    ptr.set((ev.clientX - rc.left) / rc.width * 2 - 1, -(ev.clientY - rc.top) / rc.height * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObject(terrain)[0];
    if (!hit) return;
    const reach = Math.max(1.2, hit.distance * 0.03); let best = null, bd = reach;
    if (fences.visible) for (const it of infos) { const d = Math.hypot(it.x - hit.point.x, it.z - hit.point.z); if (d < bd) { bd = d; best = it; } }
    const [lat, lng] = llOf(hit.point.x, hit.point.z);
    msg.textContent = best ? best.text : `That spot is ${Math.round(hAt(lat, lng) * FT).toLocaleString()} ft above sea level`;
  });

  const resize = () => {
    const r = box.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  };
  ro = new ResizeObserver(resize); ro.observe(box); resize();
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    moveBy(dt);
    // keep close-up posts from being clipped when you're right next to them
    const near = clamp(camera.position.distanceTo(controls.target) / 100, 0.05, Math.max(0.5, size / 2000));
    if (Math.abs(near - camera.near) / camera.near > 0.2) { camera.near = walking ? 0.05 : near; camera.updateProjectionMatrix(); }
    controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
