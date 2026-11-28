"""Map areas saved on this computer, for working with no internet.

You pick an area on the map and Fence Builder downloads, from USGS (public domain):
  - aerial photos (USGS NAIP, about 1 ft per pixel), as map tiles
  - LiDAR bare-earth shading (USGS 3DEP), as map tiles
  - the LiDAR ground heights themselves (USGS 3DEP, about 1 m apart), for slope footage and the 3D view

They live in an "offline" folder next to the data file. The map asks this server for its tiles, and the
server answers from the saved copy first, so a saved area works the same with or without internet.
Standard library only.

On a shared (multi-user) server the map pieces are one shared copy of public USGS data, but each saved
area belongs to the person who saved it: only they see it in their list, and only they can finish or
delete it. There are limits on how many areas each person keeps and downloads at once.
"""
import concurrent.futures, json, math, os, re, struct, threading, time, urllib.parse, urllib.request, uuid

NAIP = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
DEM = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
R = 20037508.342789244
UA = "FenceBuilder/1 (offline map download)"
# what can be saved: map tiles from zoom `min` to `max` (the most the source has)
LAYERS = {
    "naip": {"min": 12, "max": 19, "ext": ".jpg", "ctype": "image/jpeg"},
    "hill": {"min": 12, "max": 18, "ext": ".png", "ctype": "image/png"},
}
# county parcel lines (approximate, for reference): public ArcGIS layers. Only the parcel number and acres
# are asked for, never owner names. The app asks the same list (PARCEL_SOURCES in index.html).
PARCELS = [
    {"name": "Gem County", "url": "https://services7.arcgis.com/IG8lUXQpcTiHlZLc/arcgis/rest/services/Parcels_Public_view/FeatureServer/0", "id": "PIN", "acres": None},
    {"name": "Canyon County", "url": "https://maps.canyoncounty.id.gov/arcgisserver/rest/services/General/Canyon_County_Public_Tax_Parcels/FeatureServer/0", "id": "PIN", "acres": "ACRES"},
    {"name": "Valley County", "url": "https://services6.arcgis.com/ikurHvtarxfN6u3u/arcgis/rest/services/Valley_County_Parcels_Open_Data/FeatureServer/0", "id": "PARCELNO", "acres": "LegalAc"},
    {"name": "Ada County Assessor", "url": "https://services2.arcgis.com/dgGjZc6xAH5m5JyP/arcgis/rest/services/Parcels/FeatureServer/5", "id": "PARCEL", "acres": "ACRES"},
    {"name": "State of Idaho", "url": "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7", "id": "PARCEL_ID", "acres": "ASR_ACRES", "county": "County"},
]
MAX_TILES = 60000          # about 100 square km at full detail
MAX_AREAS_EACH = 10        # shared server: saved areas per person
MAX_RUNNING_EACH = 1       # shared server: downloads at once per person
MAX_RUNNING = 2            # shared server: downloads at once in all
MIN_FREE = 2_000_000_000   # shared server: bytes of disk that must stay free
DEM_STEP = 1.0             # meters between saved ground heights
DEM_BLOCK = 2000           # pixels per side of each saved height file
WORKERS = 6

ROOT = None
LOCK = threading.Lock()
JOBS = {}                  # area id -> thread, while downloading
OWNERS = {}                # area id -> who started the download (shared server)
START_LOCK = threading.Lock()


def init(data_file):
    global ROOT
    ROOT = os.path.join(os.path.dirname(os.path.abspath(data_file)), "offline")
    os.makedirs(os.path.join(ROOT, "areas"), exist_ok=True)


# ---------- tiles ----------
def tile_url(layer, z, x, y):
    n = 2 ** z
    sz = 2 * R / n
    x0, y1 = -R + x * sz, R - y * sz
    bbox = ",".join("%.2f" % v for v in (x0, y1 - sz, x0 + sz, y1))
    if layer == "naip":
        return NAIP + "?bbox=%s&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image" % bbox
    rule = urllib.parse.quote(json.dumps({"rasterFunction": "Hillshade Gray"}, separators=(",", ":")))
    return DEM + "?bbox=%s&bboxSR=3857&imageSR=3857&size=256,256&format=png32&interpolation=RSP_BilinearInterpolation&renderingRule=%s&f=image" % (bbox, rule)


def tile_path(layer, z, x, y):
    return os.path.join(ROOT, "tiles", layer, str(z), str(x), "%d%s" % (y, LAYERS[layer]["ext"]))


def get_url(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if r.status != 200:
            raise OSError("answered %s" % r.status)
        ct = r.headers.get("Content-Type", "")
        body = r.read()
    if not (ct.startswith("image/") or ct.startswith("application/octet") or body[:2] in (b"II", b"MM")):
        raise OSError("not an image")
    return body


def tile(layer, z, x, y):
    """A map tile: the saved one, or straight from USGS when it isn't saved (not kept). None if neither."""
    if layer not in LAYERS or not (0 <= z <= 22) or not (0 <= x < 2 ** z) or not (0 <= y < 2 ** z):
        return None
    p = tile_path(layer, z, x, y)
    if os.path.isfile(p):
        with open(p, "rb") as f:
            return f.read()
    try:
        return get_url(tile_url(layer, z, x, y), timeout=12)
    except Exception:
        return None


def tiles_in(bbox, layer, maxz):
    w, s, e, n = bbox
    L = LAYERS[layer]
    for z in range(L["min"], min(maxz, L["max"]) + 1):
        N = 2 ** z
        tx = lambda lng: int((lng + 180) / 360 * N)
        ty = lambda lat: int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * N)
        for x in range(max(0, tx(w)), min(N - 1, tx(e)) + 1):
            for y in range(max(0, ty(n)), min(N - 1, ty(s)) + 1):
                yield z, x, y


def count_tiles(bbox, maxz):
    return sum(1 for layer in LAYERS for _ in tiles_in(bbox, layer, maxz))


# ---------- ground heights (an uncompressed 32-bit float GeoTIFF, as USGS sends it) ----------
def read_tiff(buf):
    le = buf[:2] == b"II"
    E = "<" if le else ">"
    u16 = lambda o: struct.unpack_from(E + "H", buf, o)[0]
    u32 = lambda o: struct.unpack_from(E + "I", buf, o)[0]
    ifd = u32(4)
    T = {}
    for i in range(u16(ifd)):
        e = ifd + 2 + i * 12
        tag, typ, cnt = u16(e), u16(e + 2), u32(e + 4)
        if typ not in (3, 4):
            continue
        size = 2 if typ == 3 else 4
        at = e + 8 if size * cnt <= 4 else u32(e + 8)
        T[tag] = [u16(at + k * 2) if typ == 3 else u32(at + k * 4) for k in range(cnt)]
    W, H = T[256][0], T[257][0]
    if T.get(259, [1])[0] != 1 or T.get(258, [32])[0] != 32:
        raise ValueError("unexpected elevation file")
    out = [0.0] * (W * H)
    if 322 in T:
        tw, th = T[322][0], T[323][0]
        across = -(-W // tw)
        for t, o in enumerate(T[324]):
            tx0, ty0 = (t % across) * tw, (t // across) * th
            for yy in range(th):
                if ty0 + yy >= H:
                    break
                row = struct.unpack_from(E + "%df" % tw, buf, o + yy * tw * 4)
                n = min(tw, W - tx0)
                out[(ty0 + yy) * W + tx0:(ty0 + yy) * W + tx0 + n] = row[:n]
    else:
        rps = T.get(278, [H])[0]
        for si, o in enumerate(T[273]):
            rows = min(rps, H - si * rps)
            if rows <= 0:
                break
            out[si * rps * W:(si * rps + rows) * W] = struct.unpack_from(E + "%df" % (rows * W), buf, o)
    return W, H, out


def write_tiff(W, H, vals):
    """The same kind of file back, so the 3D view reads it like one from USGS."""
    data = struct.pack("<%df" % (W * H), *vals)
    tags = [(256, 4, W), (257, 4, H), (258, 3, 32), (259, 3, 1), (262, 3, 1), (273, 4, 0),
            (277, 3, 1), (278, 4, H), (279, 4, len(data)), (339, 3, 3)]
    ifd_at = 8
    data_at = ifd_at + 2 + len(tags) * 12 + 4
    out = bytearray(b"II*\x00" + struct.pack("<I", ifd_at) + struct.pack("<H", len(tags)))
    for tag, typ, val in tags:
        if tag == 273:
            val = data_at
        out += struct.pack("<HHI", tag, typ, 1) + (struct.pack("<HH", val, 0) if typ == 3 else struct.pack("<I", val))
    out += struct.pack("<I", 0)
    return bytes(out) + data


_grids = {}   # file -> (W, H, values), the few most recently used


def grid(path):
    g = _grids.get(path)
    if g is None:
        with open(path, "rb") as f:
            g = read_tiff(f.read())
        if len(_grids) >= 4:
            _grids.pop(next(iter(_grids)))
        _grids[path] = g
    return g


def blocks():
    out = []
    for a in areas():
        for b in a.get("dem") or []:
            p = os.path.join(ROOT, "dem", b["file"])
            if os.path.isfile(p):
                out.append((b["bbox"], p))
    return out


def height_at(lat, lng, bl=None):
    """Ground height in meters from the saved LiDAR, or None outside every saved area."""
    for (w, s, e, n), p in bl if bl is not None else blocks():
        if not (w <= lng <= e and s <= lat <= n):
            continue
        W, H, v = grid(p)
        fx = (lng - w) / (e - w) * W - 0.5
        fy = (n - lat) / (n - s) * H - 0.5
        x0, y0 = max(0, min(W - 1, int(math.floor(fx)))), max(0, min(H - 1, int(math.floor(fy))))
        x1, y1 = min(W - 1, x0 + 1), min(H - 1, y0 + 1)
        tx, ty = max(0.0, min(1.0, fx - x0)), max(0.0, min(1.0, fy - y0))
        c = [v[y0 * W + x0], v[y0 * W + x1], v[y1 * W + x0], v[y1 * W + x1]]
        if any(z < -1000 for z in c):
            good = [z for z in c if z > -1000]
            if not good:
                continue
            return sum(good) / len(good)
        top = c[0] + (c[1] - c[0]) * tx
        bot = c[2] + (c[3] - c[2]) * tx
        return top + (bot - top) * ty
    return None


def heights(pts):
    bl = blocks()
    return [height_at(float(la), float(ln), bl) for la, ln in pts]


def dem_grid(bbox, W, H):
    """A W x H grid of heights over bbox from the saved LiDAR, as a GeoTIFF. The 3D view's area is a bit
    bigger than what was saved, so edges that weren't saved take the nearest saved height in their row
    (or column). None if less than a third of it is saved."""
    w, s, e, n = bbox
    bl = blocks()
    vals, have = [], 0
    for j in range(H):
        lat = n - (j + 0.5) / H * (n - s)
        for i in range(W):
            z = height_at(lat, w + (i + 0.5) / W * (e - w), bl)
            vals.append(z)
            have += z is not None
    if have < W * H / 3:
        return None
    def fill(get, put, count, length):
        for k in range(count):
            row = [get(k, i) for i in range(length)]
            known = [i for i, z in enumerate(row) if z is not None]
            if not known:
                continue
            for i, z in enumerate(row):
                if z is None:
                    put(k, i, row[min(known, key=lambda q: abs(q - i))])
    fill(lambda j, i: vals[j * W + i], lambda j, i, z: vals.__setitem__(j * W + i, z), H, W)
    fill(lambda i, j: vals[j * W + i], lambda i, j, z: vals.__setitem__(j * W + i, z), W, H)
    known = [z for z in vals if z is not None]
    avg = sum(known) / len(known)
    return write_tiff(W, H, [avg if z is None else z for z in vals])


# ---------- saved areas ----------
def meta_path(aid):
    return os.path.join(ROOT, "areas", aid + ".json")


def save_meta(a, new=False):
    if not new and not os.path.exists(meta_path(a["id"])):
        return   # deleted
    tmp = meta_path(a["id"]) + ".tmp"
    with LOCK:   # Windows won't replace a file another thread is reading
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(a, f)
        for attempt in range(10):
            try:
                os.replace(tmp, meta_path(a["id"]))
                return
            except PermissionError:   # antivirus or OneDrive looking at it: try again in a moment
                time.sleep(0.2)
        os.replace(tmp, meta_path(a["id"]))


def areas():
    out = []
    d = os.path.join(ROOT, "areas")
    for fn in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if fn.endswith(".json"):
            try:
                with LOCK, open(os.path.join(d, fn), encoding="utf-8") as f:
                    a = json.load(f)
                if a.get("status") == "downloading" and a["id"] not in JOBS:
                    a["status"] = "stopped"   # the app was closed part way through
                out.append(a)
            except (OSError, ValueError):
                pass
    return sorted(out, key=lambda a: a.get("created", 0))


def get_area(aid):
    return next((a for a in areas() if a["id"] == aid), None)


def check_bbox(b):
    w, s, e, n = [float(v) for v in b]
    if not (-180 <= w < e <= 180 and -85 < s < n < 85):
        raise ValueError("That area is not on the map")
    return [w, s, e, n]


def mine(a, owner, admin):
    """Shared server: is this saved area this person's? (Areas from before accounts are the admins'.)"""
    return owner is None or a.get("owner") == owner or (not a.get("owner") and admin)


def check_room(owner):
    """Shared server: refuse a download that would go over the limits."""
    if owner is None:
        return
    if sum(1 for a in areas() if a.get("owner") == owner) >= MAX_AREAS_EACH:
        raise ValueError("You have %d saved areas, the most you can keep. Delete one in Settings, Offline maps." % MAX_AREAS_EACH)
    if sum(1 for o in OWNERS.values() if o == owner) >= MAX_RUNNING_EACH:
        raise ValueError("One area is still downloading. Wait for it to finish, then save the next one.")
    if len(JOBS) >= MAX_RUNNING:
        raise ValueError("The server is busy saving other areas. Please try again in a few minutes.")
    try:
        import shutil
        if shutil.disk_usage(ROOT).free < MIN_FREE:
            raise ValueError("The server is running out of room for map downloads. Ask the person who runs it.")
    except OSError:
        pass


def start(name, bbox, maxz, owner=None):
    bbox = check_bbox(bbox)
    maxz = max(14, min(19, int(maxz)))
    total = count_tiles(bbox, maxz)
    if total > MAX_TILES:
        raise ValueError("That area is too big to save (%d map pieces). Pick a smaller area or less detail." % total)
    with START_LOCK:   # one start at a time, so two can't both squeeze under the limits
        check_room(owner)
        a = {"id": uuid.uuid4().hex[:10], "name": re.sub(r"[\x00-\x1f]", "", str(name or "Saved area")).strip()[:80] or "Saved area",
             "bbox": bbox, "maxz": maxz, "created": time.time(), "status": "downloading", "done": 0, "total": total,
             "failed": 0, "bytes": 0, "dem": []}
        if owner:
            a["owner"] = owner
        save_meta(a, new=True)
        run(a)
    return a


def resume(aid, owner=None, admin=True):
    a = get_area(aid)
    if not a or not mine(a, owner, admin):
        raise ValueError("No such area")
    if aid in JOBS:
        return a
    if owner is not None:
        if sum(1 for o in OWNERS.values() if o == owner) >= MAX_RUNNING_EACH or len(JOBS) >= MAX_RUNNING:
            raise ValueError("Another area is still downloading. Please try again when it is done.")
    a.update(status="downloading", failed=0)
    save_meta(a)
    run(a)
    return a


def run(a):
    t = threading.Thread(target=download, args=(a,), daemon=True)
    JOBS[a["id"]] = t
    OWNERS[a["id"]] = a.get("owner")
    t.start()


def download(a):
    aid = a["id"]
    try:
        jobs = [(layer, z, x, y) for layer in LAYERS for z, x, y in tiles_in(a["bbox"], layer, a["maxz"])]
        a["total"] = len(jobs) + dem_count(a["bbox"])
        done = failed = size = 0
        last = time.time()

        def one(j):
            p = tile_path(*j)
            if os.path.isfile(p):
                return os.path.getsize(p)
            for attempt in range(3):
                try:
                    body = get_url(tile_url(*j))
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    with open(p + ".part", "wb") as f:
                        f.write(body)
                    os.replace(p + ".part", p)
                    return len(body)
                except Exception:
                    time.sleep(1 + attempt * 2)
            return None

        with concurrent.futures.ThreadPoolExecutor(WORKERS) as ex:
            for r in ex.map(one, jobs):
                if not os.path.exists(meta_path(aid)):   # deleted while downloading
                    return
                done += 1
                if r is None:
                    failed += 1
                else:
                    size += r
                if time.time() - last > 1.5:
                    a.update(done=done, failed=failed, bytes=size)
                    save_meta(a)
                    last = time.time()
        a.update(done=done, failed=failed, bytes=size)
        save_meta(a)
        # the ground heights, in blocks
        a["dem"] = []
        for b in dem_blocks(a["bbox"]):
            fn = "%s_%d.tif" % (aid, len(a["dem"]))
            p = os.path.join(ROOT, "dem", fn)
            ok = False
            for attempt in range(3):
                try:
                    w, s, e, n = b["bbox"]
                    url = DEM + "?bbox=%.7f,%.7f,%.7f,%.7f&bboxSR=4326&imageSR=4326&size=%d,%d&format=tiff&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&compression=None&f=image" % (w, s, e, n, b["w"], b["h"])
                    body = get_url(url, timeout=90)
                    read_tiff(body)   # make sure it is a good one
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    with open(p, "wb") as f:
                        f.write(body)
                    a["dem"].append({"file": fn, **b})
                    size += len(body)
                    ok = True
                    break
                except Exception:
                    time.sleep(2 + attempt * 3)
            done += 1
            if not ok:
                failed += 1
            a.update(done=done, failed=failed, bytes=size)
            save_meta(a)
        # the property lines, from the county parcel maps (not needed for the rest, so a failure here is no matter)
        try:
            feats = fetch_parcels(a["bbox"])
            os.makedirs(os.path.join(ROOT, "parcels"), exist_ok=True)
            with open(os.path.join(ROOT, "parcels", aid + ".json"), "w", encoding="utf-8") as f:
                json.dump(feats, f)
            a["parcels"] = len(feats)
        except Exception:
            pass
        a["status"] = "done" if not failed else "partly"
        a["finished"] = time.time()
        save_meta(a)
    except Exception as e:
        import sys, traceback
        traceback.print_exc(file=sys.stderr)
        a.update(status="error", error=str(e))
        try:
            save_meta(a)
        except OSError:
            pass
    finally:
        JOBS.pop(aid, None)
        OWNERS.pop(aid, None)


def dem_blocks(bbox):
    """The saved heights in blocks. Pixels are square in degrees (as USGS sends them for a
    lat/long area), about DEM_STEP meters north to south, so the file covers exactly the area asked for."""
    w, s, e, n = bbox
    step = DEM_STEP / 110574.0
    W, H = max(2, round((e - w) / step)), max(2, round((n - s) / step))
    nx, ny = -(-W // DEM_BLOCK), -(-H // DEM_BLOCK)
    out = []
    for j in range(ny):
        for i in range(nx):
            bw, be = w + (e - w) * i / nx, w + (e - w) * (i + 1) / nx
            bn, bs = n - (n - s) * j / ny, n - (n - s) * (j + 1) / ny
            out.append({"bbox": [bw, bs, be, bn], "w": max(2, round((be - bw) / step)), "h": max(2, round((bn - bs) / step))})
    return out


def fetch_parcels(bbox):
    """Parcel outlines in bbox from every county source, as GeoJSON features with only
    {pid, acres, county, src}. Sources outside their county just return nothing."""
    w, s, e, n = bbox
    out, seen = [], set()
    for src in PARCELS:
        fields = ",".join(f for f in (src["id"], src["acres"], src.get("county")) if f)
        off = 0
        for page in range(20):
            q = urllib.parse.urlencode({"where": "1=1", "geometry": "%.6f,%.6f,%.6f,%.6f" % (w, s, e, n), "geometryType": "esriGeometryEnvelope",
                                        "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outSR": 4326, "outFields": fields,
                                        "returnGeometry": "true", "geometryPrecision": 6, "f": "geojson", "resultRecordCount": 2000, "resultOffset": off})
            try:
                req = urllib.request.Request(src["url"] + "/query?" + q, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=40) as r:
                    j = json.loads(r.read())
            except Exception:
                break
            feats = j.get("features") or []
            for f in feats:
                pr = f.get("properties") or {}
                pid = str(pr.get(src["id"]) or "").strip()
                county = str(pr.get(src.get("county") or "") or "").strip() or src["name"].replace(" Assessor", "")
                k = (county, pid)
                if not f.get("geometry") or (pid and k in seen):
                    continue
                seen.add(k)
                ac = pr.get(src["acres"]) if src["acres"] else None
                out.append({"type": "Feature", "geometry": f["geometry"],
                            "properties": {"pid": pid, "acres": ac if isinstance(ac, (int, float)) else None, "county": county, "src": src["name"]}})
            if not (j.get("exceededTransferLimit") or (j.get("properties") or {}).get("exceededTransferLimit")) or not feats:
                break
            off += len(feats)
    return out


def _fbox(geom):
    xs, ys = [], []
    def walk(c):
        if c and isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for x in c or []:
                walk(x)
    walk(geom.get("coordinates"))
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def saved_parcels(bbox):
    """Parcel outlines saved with offline areas that touch bbox."""
    w, s, e, n = bbox
    out, seen = [], set()
    d = os.path.join(ROOT, "parcels")
    for a in areas():
        aw, as_, ae, an = a["bbox"]
        p = os.path.join(d, a["id"] + ".json")
        if ae < w or aw > e or an < s or as_ > n or not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                feats = json.load(f)
        except (OSError, ValueError):
            continue
        for ft in feats:
            b = _fbox(ft.get("geometry") or {})
            k = (ft["properties"].get("county"), ft["properties"].get("pid"), b)
            if b and not (b[2] < w or b[0] > e or b[3] < s or b[1] > n) and k not in seen:
                seen.add(k)
                out.append(ft)
    return out


def dem_count(bbox):
    return len(dem_blocks(bbox))


def delete(aid):
    a = get_area(aid)
    if not a:
        return False
    with LOCK:
        os.remove(meta_path(aid))
    others = areas()
    # map pieces only this area uses
    for layer in LAYERS:
        for z, x, y in tiles_in(a["bbox"], layer, a["maxz"]):
            if any(o["maxz"] >= z and _covers(o["bbox"], layer, z, x, y) for o in others):
                continue
            try:
                os.remove(tile_path(layer, z, x, y))
            except OSError:
                pass
    try:
        os.remove(os.path.join(ROOT, "parcels", aid + ".json"))
    except OSError:
        pass
    for b in a.get("dem") or []:
        try:
            os.remove(os.path.join(ROOT, "dem", b["file"]))
            _grids.pop(os.path.join(ROOT, "dem", b["file"]), None)
        except OSError:
            pass
    return True


def delete_owned(owner):
    """A deleted account's saved areas go too (map pieces other areas use are kept)."""
    for a in areas():
        if owner and a.get("owner") == owner:
            delete(a["id"])


def _covers(bbox, layer, z, x, y):
    w, s, e, n = bbox
    N = 2 ** z
    tx = lambda lng: int((lng + 180) / 360 * N)
    ty = lambda lat: int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * N)
    return tx(w) <= x <= tx(e) and ty(n) <= y <= ty(s)


# ---------- the web side: called from server.py ----------
TILE_RE = re.compile(r"off/tile/(naip|hill)/(\d+)/(\d+)/(\d+)")


def handle_get(h, api, q, owner=None, admin=True, private=False):
    """GET api/off/... ; returns True if it answered. owner: the signed-in person on a shared server."""
    m = TILE_RE.fullmatch(api)
    if m:
        body = tile(m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4)))
        if body is None:
            h.send_response(404)
            h.send_header("Content-Length", "0")
            h.end_headers()
            return True
        h.send_response(200)
        h.send_header("Content-Type", LAYERS[m.group(1)]["ctype"])
        h.send_header("Content-Length", str(len(body)))
        h.send_header("Cache-Control", ("private, " if private else "") + "max-age=86400")
        h.end_headers()
        h.wfile.write(body)
        return True
    if api == "off/areas":
        h.send(200, {"areas": [{k: v for k, v in a.items() if k != "owner"} for a in areas() if mine(a, owner, admin)]})
        return True
    if api == "off/estimate":
        b = check_bbox((q.get("bbox") or [""])[0].split(","))
        h.send(200, {str(z): count_tiles(b, z) for z in (17, 18, 19)})
        return True
    if api == "off/parcels":
        h.send(200, {"type": "FeatureCollection", "features": saved_parcels(check_bbox((q.get("bbox") or [""])[0].split(",")))})
        return True
    if api == "off/dem":
        b = check_bbox((q.get("bbox") or [""])[0].split(","))
        W, H = int((q.get("w") or ["0"])[0]), int((q.get("h") or ["0"])[0])
        if not (2 <= W <= 600 and 2 <= H <= 600):
            raise ValueError("bad size")
        body = dem_grid(b, W, H)
        if body is None:
            h.send(404, {"error": "not saved"})
        else:
            h.send(200, body, "image/tiff")
        return True
    return False


def handle_post(h, api, body, owner=None, admin=True, may_save=True):
    """POST api/off/... with a JSON body; returns True if it answered."""
    if api == "off/areas":
        if not may_save:
            raise ValueError("Saving map areas for offline use is turned off on this server. Ask the person who runs it.")
        a = start(body.get("name"), body.get("bbox") or [], body.get("maxz") or 19, owner=owner)
        h.send(200, {"area": {k: v for k, v in a.items() if k != "owner"}})
        return True
    if api == "off/elev":
        pts = body.get("pts") or []
        if not isinstance(pts, list) or len(pts) > 5000:
            raise ValueError("bad points")
        h.send(200, {"z": heights(pts)})
        return True
    m = re.fullmatch(r"off/areas/([0-9a-f]{10})/(delete|resume)", api)
    if m:
        a = get_area(m.group(1))
        if not a or not mine(a, owner, admin):
            h.send(404, {"error": "No such area"})
        elif m.group(2) == "delete":
            h.send(200, {"ok": delete(m.group(1))})
        else:
            h.send(200, {"area": {k: v for k, v in resume(m.group(1), owner, admin).items() if k != "owner"}})
        return True
    return False
