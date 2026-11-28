"""The ground along a fence line: soil and rock, water, trees and brush.

The app sends the points of one fence line; this asks public federal map services about the ground under it
and answers in feet along the line. Every source is US government data (public domain):
  - soil:      USDA NRCS soil survey (SSURGO), through Soil Data Access
  - streams:   USGS National Hydrography Dataset (NHD) streams, rivers, canals and ditches
  - flood:     FEMA National Flood Hazard Layer (NFHL) flood zones
  - wetlands:  US Fish and Wildlife Service National Wetlands Inventory (NWI)
  - cover:     LANDFIRE existing vegetation cover (trees, shrubs), USGS / US Forest Service

Only the fixed addresses below are ever asked (no address from the app, no redirects to anywhere else), with
short timeouts and a size limit on each answer, so it is safe to open to the internet.
Standard library only. server.py calls handle_post() for POST api/ground/<topic>.
"""
import concurrent.futures, json, math, re, sys, threading, time, urllib.error, urllib.parse, urllib.request

SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
NHD = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query"
NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
NWI = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query"
EVC = "https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVC_CONUS/ImageServer/getSamples"
HOSTS = {urllib.parse.urlparse(u).hostname for u in (SDA, NHD, NFHL, NWI, EVC)}
UA = "FenceBuilder/1 (fence estimating; ground check)"
FT = 3.28084
MAX_LEN_M = 40000          # longest line checked (about 25 miles)
MAX_PTS = 3000
TIMEOUT = 30
LIMIT = 12_000_000         # biggest answer read from a service
DEPTH_CM = 102             # "near the surface": the top 40 inches, where posts and brace holes go
BRUSH_MIN = 25             # shrubs covering at least this % of the ground count as brush


class GroundError(Exception):
    """A map service didn't answer, or answered with something unusable."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None   # a redirect becomes an error: answers only ever come from the hosts above


_OPENER = urllib.request.build_opener(_NoRedirect)
_SLOTS = threading.BoundedSemaphore(8)   # outside requests at once, from everyone together


def _ask(url, form=None, js=None):
    """POST a form or JSON to one of the fixed services and return its JSON answer."""
    u = urllib.parse.urlparse(url)
    if u.scheme != "https" or u.hostname not in HOSTS or u.username or u.port not in (None, 443):
        raise ValueError("That map service is not allowed")
    if js is not None:
        data, ctype = json.dumps(js).encode(), "application/json"
    else:
        data, ctype = urllib.parse.urlencode(form or {}).encode(), "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Content-Type": ctype, "Accept": "application/json"})
    if not _SLOTS.acquire(timeout=TIMEOUT):
        raise GroundError("busy")
    try:
        with _OPENER.open(req, timeout=TIMEOUT) as r:
            body = r.read(LIMIT + 1)
    except (urllib.error.URLError, OSError) as e:   # HTTPError, timeouts and no internet
        raise GroundError(str(getattr(e, "reason", e)))
    finally:
        _SLOTS.release()
    if len(body) > LIMIT:
        raise GroundError("answer too big")
    try:
        j = json.loads(body.decode("utf-8", "replace") or "{}")
    except ValueError:
        raise GroundError("not a map answer")
    if not isinstance(j, dict) or j.get("error"):
        raise GroundError("the service said no")
    return j


# ---------- the line, in meters on a flat local map ----------
class Line:
    def __init__(self, pts):
        self.ll = pts                                   # [(lat, lng)]
        lat0 = pts[0][0]
        self.lat0, self.lng0 = lat0, pts[0][1]
        self.mx, self.my = 111320 * math.cos(math.radians(lat0)), 110574.0
        self.xy = [self.to_xy(lat, lng) for lat, lng in pts]
        self.cum = [0.0]
        for i in range(1, len(self.xy)):
            self.cum.append(self.cum[-1] + math.dist(self.xy[i - 1], self.xy[i]))
        self.length = self.cum[-1]
        xs, ys = [p[0] for p in self.xy], [p[1] for p in self.xy]
        self.box = (min(xs), min(ys), max(xs), max(ys))

    def to_xy(self, lat, lng):
        return ((lng - self.lng0) * self.mx, (lat - self.lat0) * self.my)

    def esri(self):
        return json.dumps({"paths": [[[round(lng, 7), round(lat, 7)] for lat, lng in self.ll]], "spatialReference": {"wkid": 4326}})

    def wkt(self):
        return "LINESTRING(" + ", ".join("%.7f %.7f" % (lng, lat) for lat, lng in self.ll) + ")"

    def at(self, d):
        """lat, lng at distance d meters along the line"""
        for i in range(1, len(self.cum)):
            if self.cum[i] >= d or i == len(self.cum) - 1:
                seg = self.cum[i] - self.cum[i - 1] or 1
                t = max(0.0, min(1.0, (d - self.cum[i - 1]) / seg))
                (a, b), (c, e) = self.ll[i - 1], self.ll[i]
                return a + (c - a) * t, b + (e - b) * t
        return self.ll[0]


def parse_line(body):
    pts = body.get("pts") if isinstance(body, dict) else None
    if not isinstance(pts, list) or not 2 <= len(pts) <= MAX_PTS:
        raise ValueError("A fence line needs 2 to %d points" % MAX_PTS)
    out = []
    for p in pts:
        lat, lng = float(p[0]), float(p[1])
        if not (math.isfinite(lat) and math.isfinite(lng) and -85 < lat < 85 and -180 <= lng <= 180):
            raise ValueError("That point is not on the map")
        out.append((lat, lng))
    lats, lngs = [p[0] for p in out], [p[1] for p in out]
    if max(lats) - min(lats) > 0.5 or max(lngs) - min(lngs) > 0.7:
        raise ValueError("That fence line is too long to check (more than 25 miles)")
    line = Line(out)
    if line.length < 1:
        raise ValueError("That fence line is too short to check")
    if line.length > MAX_LEN_M:
        raise ValueError("That fence line is too long to check (more than 25 miles)")
    return line


def _cross(a, b, c, d):
    """Where segment a-b meets segment c-d: (t along a-b, u along c-d), or None"""
    rx, ry, sx, sy = b[0] - a[0], b[1] - a[1], d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-12:
        return None
    qx, qy = c[0] - a[0], c[1] - a[1]
    t, u = (qx * sy - qy * sx) / den, (qx * ry - qy * rx) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return t, u
    return None


def _inside(x, y, edges):
    c = False
    for x1, y1, x2, y2 in edges:
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def inside_runs(line, rings_xy):
    """The stretches of the line inside one polygon (its rings, even-odd), as [(from m, to m)]"""
    edges = []
    for r in rings_xy:
        for i in range(len(r)):
            (x1, y1), (x2, y2) = r[i - 1], r[i]
            if (x1, y1) != (x2, y2):
                edges.append((x1, y1, x2, y2))
    if not edges:
        return []
    runs = []
    for i in range(1, len(line.xy)):
        a, b = line.xy[i - 1], line.xy[i]
        lo_x, hi_x, lo_y, hi_y = min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1])
        ts = [0.0, 1.0]
        for x1, y1, x2, y2 in edges:
            if max(x1, x2) < lo_x or min(x1, x2) > hi_x or max(y1, y2) < lo_y or min(y1, y2) > hi_y:
                continue
            h = _cross(a, b, (x1, y1), (x2, y2))
            if h:
                ts.append(h[0])
        ts.sort()
        seg = line.cum[i] - line.cum[i - 1]
        for t0, t1 in zip(ts, ts[1:]):
            if t1 - t0 < 1e-9:
                continue
            tm = (t0 + t1) / 2
            if _inside(a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm, edges):
                d0, d1 = line.cum[i - 1] + seg * t0, line.cum[i - 1] + seg * t1
                if runs and abs(runs[-1][1] - d0) < 0.01:
                    runs[-1] = (runs[-1][0], d1)
                else:
                    runs.append((d0, d1))
    return runs


def _merge(runs):
    out = []
    for a, b in sorted(runs):
        if out and a <= out[-1][1] + 0.5:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _ft(m):
    return round(m * FT)


def _arcgis_polys(url, line, fields, where="1=1"):
    """Polygons of an ArcGIS layer that touch the line: [(attributes, rings in local meters)]"""
    j = _ask(url, form={"where": where, "geometry": line.esri(), "geometryType": "esriGeometryPolyline", "inSR": 4326,
                        "spatialRel": "esriSpatialRelIntersects", "outFields": fields, "returnGeometry": "true", "outSR": 4326,
                        "geometryPrecision": 6, "maxAllowableOffset": 0.00001, "f": "json"})
    out = []
    for f in j.get("features") or []:
        rings = [[line.to_xy(p[1], p[0]) for p in r] for r in ((f.get("geometry") or {}).get("rings") or []) if len(r) > 2]
        if rings:
            out.append((f.get("attributes") or {}, rings))
    return out


def _tally(line, polys, label_of):
    """feet of the line inside each kind of polygon: {label: [runs]}"""
    by = {}
    for attrs, rings in polys:
        lab = label_of(attrs)
        if lab:
            by.setdefault(lab, []).extend(inside_runs(line, rings))
    return {k: _merge(v) for k, v in by.items()}


def _runs_out(runs):
    return [[_ft(a), _ft(b)] for a, b in runs if b - a > 0.3]


# ---------- soil and rock (USDA NRCS soil survey) ----------
# The soil survey's answer is boiled down here to the few things that matter for setting posts; the page
# (static/js/68-ground.js) turns them into plain words. Soil survey names and map labels are kept, but only
# as a footnote there.
SOIL_V = 2                 # answers without this (kept in a browser from before) are asked again
BEDROCK = re.compile(r"bedrock", re.I)
HARDPAN = re.compile(r"duripan|petrocalcic|petrogypsic|petroferric|ortstein|fragipan|placic|cemented|densic material", re.I)
ROCKY_NAME = re.compile(r"\b(stony|very stony|extremely stony|cobbly|bouldery|rubbly|rocky|rock outcrop|rock land)\b", re.I)
# hard layers, in the words a fence builder uses
PAN_WORDS = {"duripan": "hardpan (cemented layer)", "petrocalcic": "caliche hardpan", "petrogypsic": "gypsum hardpan",
             "ortstein": "hardpan (cemented layer)", "fragipan": "hard, packed layer", "placic": "thin iron hardpan",
             "petroferric": "ironstone hardpan", "cemented": "hardpan (cemented layer)", "densic": "hard, packed layer"}
TEXTURES = ("sand", "sandy", "sandyloam", "loam", "silty", "clayloam", "clay", "muck")
DRAIN = ("Excessively drained", "Somewhat excessively drained", "Well drained", "Moderately well drained",
         "Somewhat poorly drained", "Poorly drained", "Very poorly drained", "Subaqueous")
FLOODS = ("Very rare", "Rare", "Occasional", "Frequent", "Very frequent")


def _level(name, word):
    """how strongly the soil survey name says stony / cobbly / gravelly: 0 not at all, 1, 2 very, 3 extremely"""
    lv = 0
    for m in re.finditer(r"\b(very |extremely )?(%s)\b" % word, name, re.I):
        lv = max(lv, {"": 1, "very ": 2, "extremely ": 3}[(m.group(1) or "").lower()])
    return lv


def _texture(sand, clay, name):
    """the kind of dirt in the top 40 inches, from sand and clay percent (or the name when they're missing)"""
    if re.search(r"\b(muck|mucky|peat|peaty)\b", name, re.I):
        return "muck"
    if sand is None or clay is None:
        for w, t in (("clay loam", "clayloam"), ("sandy loam", "sandyloam"), ("loamy sand", "sandy"), ("silt", "silty"),
                     ("clay", "clay"), ("sand", "sand"), ("loam", "loam")):
            if re.search(r"\b%s" % w, name, re.I):
                return t
        return ""
    silt = 100 - sand - clay
    if sand >= 85 and clay < 10:
        return "sand"
    if sand >= 70 and clay < 15:
        return "sandy"
    if clay >= 40:
        return "clay"
    if clay >= 27:
        return "clayloam"
    if silt >= 50:
        return "silty"
    if sand >= 52:
        return "sandyloam"
    return "loam"


def _sda(sql):
    j = _ask(SDA, js={"query": sql, "format": "JSON+COLUMNNAME"})
    t = j.get("Table") or []
    if not t:
        return []
    head = t[0]
    return [dict(zip(head, row)) for row in t[1:]]


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _wkt_len(line, wkt):
    """length in meters of a WKT line, multi-line or collection (points count nothing)"""
    m = 0.0
    for grp in re.findall(r"\(([-\d.eE+\s,]+)\)", wkt or ""):
        pts = []
        for pair in grp.split(","):
            v = pair.split()
            if len(v) >= 2:
                pts.append(line.to_xy(float(v[1]), float(v[0])))
        for i in range(1, len(pts)):
            m += math.dist(pts[i - 1], pts[i])
    return m


def soil(line):
    wkt = line.wkt()   # numbers only, made here
    rows = _sda("SELECT P.mukey, P.mupolygongeo.STIntersection(geometry::STGeomFromText('%s', 4326)).STAsText() AS part "
                "FROM mupolygon P WHERE P.mupolygongeo.STIntersects(geometry::STGeomFromText('%s', 4326)) = 1" % (wkt, wkt))
    meters = {}
    for r in rows:
        k = str(r.get("mukey") or "")
        if re.fullmatch(r"\d{1,12}", k):
            meters[k] = meters.get(k, 0.0) + _wkt_len(line, r.get("part"))
    if not meters:
        return {"v": SOIL_V, "units": [], "ft": 0, "covered": False}
    keys = ",".join("'%s'" % k for k in meters)
    qs = {
        "mu": "SELECT M.mukey, M.musym, M.muname FROM mapunit M WHERE M.mukey IN (%s)" % keys,
        "co": "SELECT C.mukey, C.cokey, C.compname, C.compkind, C.comppct_r, C.slope_l, C.slope_h, C.drainagecl, C.frostact, "
              "C.geomdesc FROM component C WHERE C.mukey IN (%s)" % keys,
        "res": "SELECT C.cokey, R.reskind, R.resdept_r FROM component C JOIN corestrictions R ON R.cokey = C.cokey WHERE C.mukey IN (%s)" % keys,
        "hz": "SELECT C.cokey, H.hzdept_r, H.hzdepb_r, H.frag3to10_r, H.fraggt10_r, H.sieveno10_r, H.sandtotal_r, H.claytotal_r, H.lep_r "
              "FROM component C JOIN chorizon H ON H.cokey = C.cokey WHERE C.mukey IN (%s) AND H.hzdept_r < %d" % (keys, DEPTH_CM),
        # one row per soil: how wet it is, how often it floods
        "ag": "SELECT A.mukey, A.wtdepannmin, A.flodfreqdcd, A.pondfreqprs, A.drclassdcd FROM muaggatt A WHERE A.mukey IN (%s)" % keys,
    }

    def ask(name):
        try:
            return _sda(qs[name])
        except GroundError:
            if name == "ag":   # the wet-ground summary is extra: the rest still answers without it
                return []
            raise
    with concurrent.futures.ThreadPoolExecutor(5) as ex:
        got = dict(zip(qs, ex.map(ask, qs)))
    hz, res = {}, {}
    for h in got["hz"]:
        hz.setdefault(str(h["cokey"]), []).append(h)
    for r in got["res"]:
        res.setdefault(str(r["cokey"]), []).append(r)
    comps = {}
    for c in got["co"]:
        comps.setdefault(str(c["mukey"]), []).append(c)
    ag = {str(a.get("mukey")): a for a in got["ag"]}
    units = []
    for mu in got["mu"]:
        k = str(mu["mukey"])
        name = mu.get("muname") or ""
        rock_w = stone_w = gravel_w = wsum = 0.0
        sand_w = clay_w = tex_w = 0.0
        swell = None
        bedrock = hardpan = None
        bed_kind = pan_kind = ""
        outcrop = 0.0
        cs = sorted(comps.get(k, []), key=lambda c: -(_num(c.get("comppct_r")) or 0))
        main = cs[0] if cs else {}
        for c in cs:
            pct = _num(c.get("comppct_r")) or 0
            cname = c.get("compname") or ""
            is_rock = bool(re.search(r"rock outcrop|rock land|rubble", cname, re.I))
            if is_rock:
                outcrop += pct
            # rock, sand and clay in the top 40 inches, by horizon thickness
            r_sum = s_sum = g_sum = th = 0.0
            sa_sum = cl_sum = tx = lep_sum = lep_th = 0.0
            for h in hz.get(str(c["cokey"]), []):
                top, bot = _num(h.get("hzdept_r")), _num(h.get("hzdepb_r"))
                if top is None or bot is None:
                    continue
                t = max(0.0, min(bot, DEPTH_CM) - max(top, 0))
                if t <= 0:
                    continue
                stones = _num(h.get("fraggt10_r")) or 0
                big = (_num(h.get("frag3to10_r")) or 0) + stones
                sv = _num(h.get("sieveno10_r"))
                small = (100 - sv) * (100 - big) / 100 if sv is not None else 0
                r_sum += big * t
                s_sum += stones * t
                g_sum += small * t
                th += t
                sa, cl, lep = _num(h.get("sandtotal_r")), _num(h.get("claytotal_r")), _num(h.get("lep_r"))
                if sa is not None and cl is not None:
                    sa_sum += sa * t
                    cl_sum += cl * t
                    tx += t
                if lep is not None:
                    lep_sum += lep * t
                    lep_th += t
            if is_rock:
                rock_w += 100 * pct
                wsum += pct
            elif th > 0:
                rock_w += pct * r_sum / th
                stone_w += pct * s_sum / th
                gravel_w += pct * g_sum / th
                wsum += pct
            if tx > 0 and not is_rock:
                sand_w += pct * sa_sum / tx
                clay_w += pct * cl_sum / tx
                tex_w += pct
            if lep_th > 0 and pct >= 30:   # clay that swells, in a soil that makes up a good part of the map unit
                swell = max(swell or 0, lep_sum / lep_th)
            if pct >= 15:   # the shallowest bedrock or hardpan of the soils that make up a good part of the map unit
                for r in res.get(str(c["cokey"]), []):
                    d, kind = _num(r.get("resdept_r")), r.get("reskind") or ""
                    if d is None:
                        continue
                    if BEDROCK.search(kind) and (bedrock is None or d < bedrock):
                        bedrock, bed_kind = d, "solid" if re.search(r"^lithic", kind, re.I) else "soft"
                    elif HARDPAN.search(kind) and (hardpan is None or d < hardpan):
                        hardpan, pan_kind = d, kind
                if is_rock and (bedrock is None or bedrock > 0):
                    bedrock, bed_kind = 0.0, "solid"
        rock = rock_w / wsum if wsum else None
        gravel = gravel_w / wsum if wsum else None
        rocky = (rock is not None and rock >= 15) or bool(ROCKY_NAME.search(name)) or outcrop >= 15
        shallow_cm = min([d for d in (bedrock, hardpan) if d is not None], default=None)
        water = bool(re.fullmatch(r"\s*water\s*", name, re.I))
        pk = next((v for kk, v in PAN_WORDS.items() if kk in pan_kind.lower()), "hard, packed layer" if hardpan is not None else "")
        # how steep: from the name ("30 to 60 percent slopes"), or the main soil's range
        m = re.search(r"(\d+) to (\d+) percent slopes?", name)
        slope = [int(m.group(1)), int(m.group(2))] if m else None
        if not slope and _num(main.get("slope_l")) is not None and _num(main.get("slope_h")) is not None:
            slope = [round(_num(main["slope_l"])), round(_num(main["slope_h"]))]
        a = ag.get(k, {})
        drain = a.get("drclassdcd") or main.get("drainagecl") or ""
        wt = _num(a.get("wtdepannmin"))
        fl = a.get("flodfreqdcd") or ""
        misc = (main.get("compname") or "").strip() if (main.get("compkind") or "") == "Miscellaneous area" and (_num(main.get("comppct_r")) or 0) >= 50 else ""
        units.append({"mukey": k, "sym": mu.get("musym") or "", "name": name, "ft": _ft(meters.get(k, 0)),
                      "rock": None if rock is None else round(rock), "gravel": None if gravel is None else round(gravel),
                      "stone": round(stone_w / wsum) if wsum else None,
                      "outcrop": round(outcrop), "rocky": bool(rocky and not water), "water": water,
                      "bedrock_in": None if bedrock is None else round(bedrock / 2.54), "bedrock": bed_kind if bedrock is not None else "",
                      "hardpan_in": None if hardpan is None else round(hardpan / 2.54), "hardpan": pk,
                      "shallow": shallow_cm is not None and shallow_cm < DEPTH_CM,
                      # the name's own words for rocks on and in the ground: 0 none, 1, 2 very, 3 extremely
                      "stony": max(_level(name, "stony|bouldery"), 3 if re.search(r"\brubbly\b", name, re.I) else 0),
                      "cobbly": _level(name, "cobbly|channery|flaggy"), "gravelly": _level(name, "gravelly"),
                      "tex": "" if water else _texture(sand_w / tex_w if tex_w else None, clay_w / tex_w if tex_w else None, name),
                      "swell": None if swell is None else round(swell, 1), "slope": slope,
                      "drain": drain if drain in DRAIN else "",
                      "wt_in": None if wt is None or wt >= 200 else round(wt / 2.54),
                      "flood": fl if fl in FLOODS else "", "pond": round(_num(a.get("pondfreqprs")) or 0),
                      "frost": (main.get("frostact") or "") if main.get("frostact") in ("Low", "Moderate", "High") else "",
                      "bottom": bool(re.search(r"flood ?plain|flood-plain", main.get("geomdesc") or "", re.I)),
                      "misc": misc[:40] if not water else ""})
    units.sort(key=lambda u: -u["ft"])
    tot = sum(u["ft"] for u in units)
    return {"v": SOIL_V, "units": units, "ft": tot, "covered": True,
            "rocky_ft": sum(u["ft"] for u in units if u["rocky"]),
            "shallow_ft": sum(u["ft"] for u in units if u["shallow"]),
            "bedrock_in": min([u["bedrock_in"] for u in units if u["bedrock_in"] is not None], default=None),
            "hardpan_in": min([u["hardpan_in"] for u in units if u["hardpan_in"] is not None], default=None),
            "hardpan": next((u["hardpan"] for u in sorted(units, key=lambda u: u["hardpan_in"] if u["hardpan_in"] is not None else 1e9) if u["hardpan"]), "")}


# ---------- streams, rivers, canals and ditches (USGS NHD) ----------
NHD_TYPES = {460: "stream", 336: "ditch", 558: "stream"}   # stream/river, canal/ditch, path through a lake or wide river
FLOW = {46003: "dry part of the year", 46007: "only after storms", 46006: "flows all year"}


def _kind(ftype, name):
    n = (name or "").lower()
    if ftype == 336:
        return "canal" if "canal" in n else "ditch"
    return "river" if "river" in n else "stream"


def streams(line):
    j = _ask(NHD, form={"where": "ftype IN (460,336,558)", "geometry": line.esri(), "geometryType": "esriGeometryPolyline", "inSR": 4326,
                        "spatialRel": "esriSpatialRelIntersects", "outFields": "gnis_name,ftype,fcode", "returnGeometry": "true",
                        "outSR": 4326, "geometryPrecision": 6, "f": "json"})
    ways, hits = [], []
    for f in j.get("features") or []:
        a = f.get("attributes") or {}
        ft = a.get("ftype")
        if ft not in NHD_TYPES:
            continue
        name = (a.get("gnis_name") or "").strip()
        kind = _kind(ft, name)
        for path in (f.get("geometry") or {}).get("paths") or []:
            if len(path) < 2:
                continue
            ways.append({"name": name, "kind": kind, "path": [[round(p[1], 6), round(p[0], 6)] for p in path]})
            P = [line.to_xy(p[1], p[0]) for p in path]
            for i in range(1, len(line.xy)):
                for k in range(1, len(P)):
                    h = _cross(line.xy[i - 1], line.xy[i], P[k - 1], P[k])
                    if h:
                        d = line.cum[i - 1] + (line.cum[i] - line.cum[i - 1]) * h[0]
                        hits.append({"at": d, "name": name, "kind": kind, "flow": FLOW.get(a.get("fcode"), "")})
    hits.sort(key=lambda h: h["at"])
    out = []
    for h in hits:   # one crossing where pieces of the same stream meet at the fence
        if out and h["at"] - out[-1]["at"] < 5 and h["kind"] == out[-1]["kind"]:
            continue
        out.append(h)
    for h in out:
        h["ll"] = [round(v, 6) for v in line.at(h["at"])]
        h["at"] = _ft(h["at"])
    return {"crossings": out, "ways": ways[:200]}


# ---------- flood zones (FEMA) ----------
def _flood_label(a):
    z, sub = (a.get("FLD_ZONE") or "").strip().upper(), (a.get("ZONE_SUBTY") or "").upper()
    if "FLOODWAY" in sub:
        return "floodway"
    if a.get("SFHA_TF") == "T" or z.startswith("A") or z.startswith("V"):
        return "100:" + z
    if "0.2 PCT" in sub:
        return "500"
    return None


def flood(line):
    polys = _arcgis_polys(NFHL, line, "FLD_ZONE,ZONE_SUBTY,SFHA_TF", "SFHA_TF = 'T' OR ZONE_SUBTY LIKE '0.2 PCT%'")
    by = _tally(line, polys, _flood_label)
    f100 = _merge([r for k, v in by.items() if k.startswith("100:") or k == "floodway" for r in v])
    ln = lambda runs: _ft(sum(b - a for a, b in runs))
    return {"f100_ft": ln(f100), "floodway_ft": ln(by.get("floodway", [])), "f500_ft": ln(by.get("500", [])),
            "zones": sorted({k[4:] for k in by if k.startswith("100:")} | ({"AE"} if "floodway" in by else set())),
            "runs100": _runs_out(f100), "runs500": _runs_out(by.get("500", []))}


# ---------- wetlands (US Fish and Wildlife Service) ----------
WET_WORDS = {"Freshwater Emergent Wetland": "marsh or wet meadow", "Freshwater Forested/Shrub Wetland": "wooded or brushy wetland",
             "Freshwater Pond": "pond", "Lake": "lake", "Riverine": "stream channel", "Estuarine and Marine Wetland": "salt marsh",
             "Estuarine and Marine Deepwater": "open water", "Other": "other wetland"}


def wetlands(line):
    polys = _arcgis_polys(NWI, line, "WETLAND_TYPE,ATTRIBUTE")
    by = _tally(line, polys, lambda a: a.get("WETLAND_TYPE") or "Other")
    types = [{"type": WET_WORDS.get(k, k.lower()), "ft": _ft(sum(b - a for a, b in v)), "channel": k == "Riverine"} for k, v in by.items()]
    types = [t for t in types if t["ft"] > 0]
    types.sort(key=lambda t: -t["ft"])
    wet = _merge([r for k, v in by.items() if k != "Riverine" for r in v])
    return {"wet_ft": _ft(sum(b - a for a, b in wet)), "types": types, "runs": _runs_out(wet)}


# ---------- trees and brush (LANDFIRE existing vegetation cover, 30 m) ----------
def cover(line):
    step = max(10.0, line.length / 1500)
    n = max(1, int(math.ceil(line.length / step)))
    step = line.length / n
    ds = [(i + 0.5) * step for i in range(n)]
    vals = [None] * n
    for s in range(0, n, 1000):
        chunk = ds[s:s + 1000]
        pts = [[round(lng, 7), round(lat, 7)] for lat, lng in (line.at(d) for d in chunk)]
        j = _ask(EVC, form={"geometry": json.dumps({"points": pts, "spatialReference": {"wkid": 4326}}),
                            "geometryType": "esriGeometryMultipoint", "returnFirstValueOnly": "true", "f": "json"})
        samples = j.get("samples")
        if not isinstance(samples, list):
            raise GroundError("no samples")
        for sm in samples:
            i, v = sm.get("locationId"), _num(sm.get("value"))
            if isinstance(i, int) and 0 <= i < len(chunk) and v is not None and v >= 0:
                vals[s + i] = int(v)
    kinds = []
    for v in vals:
        if v is None:
            kinds.append(None)
        elif 100 <= v < 200:
            kinds.append("t")       # trees, any tree cover of 10% or more
        elif 200 <= v < 300:
            kinds.append("b" if v - 200 >= BRUSH_MIN else "s")   # thick brush, or thin shrubs (sagebrush flats)
        else:
            kinds.append("o")
    if all(k is None for k in kinds):
        return {"covered": False, "trees_ft": 0, "brush_ft": 0, "thin_ft": 0, "runs": []}
    runs = []
    for i, k in enumerate(kinds):
        if k in ("t", "b"):
            a, b = i * step, (i + 1) * step
            if runs and runs[-1][2] == k and abs(runs[-1][1] - a) < 0.01:
                runs[-1][1] = b
            else:
                runs.append([a, b, k])
    ft = lambda k: _ft(step * kinds.count(k))
    return {"covered": True, "trees_ft": ft("t"), "brush_ft": ft("b"), "thin_ft": ft("s"), "open_ft": ft("o"),
            "step_ft": round(step * FT, 1), "runs": [[_ft(a), _ft(b), k] for a, b, k in runs]}


# ---------- the web side ----------
TOPICS = {"soil": soil, "streams": streams, "flood": flood, "wetlands": wetlands, "cover": cover}
SAID = {"soil": "The USDA soil survey", "streams": "The USGS stream map", "flood": "FEMA's flood map",
        "wetlands": "The wetlands map", "cover": "The tree and brush map"}
_cache, _cache_lock, CACHE_S, CACHE_N = {}, threading.Lock(), 6 * 3600, 400


def handle_post(h, api, body=None):
    """POST api/ground/<topic> with {"pts": [[lat, lng], ...]}; returns True if it answered.
    body: the request already read and parsed by the server (otherwise it is read here)."""
    m = re.fullmatch(r"ground/(soil|streams|flood|wetlands|cover)", api or "")
    if not m:
        return False
    topic = m.group(1)
    try:
        if body is None:
            n = int(h.headers.get("Content-Length") or 0)
            if not 0 < n <= 400_000:
                raise ValueError("That fence line is too big to check")
            body = json.loads(h.rfile.read(n))
        line = parse_line(body)
    except (ValueError, TypeError, IndexError, KeyError) as e:
        h.send(400, {"error": str(e) if isinstance(e, ValueError) and str(e)[:1].isupper() else "That is not a fence line"})
        return True
    key = (topic, tuple((round(a, 6), round(b, 6)) for a, b in line.ll))
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_S:
        h.send(200, hit[1])
        return True
    try:
        res = TOPICS[topic](line)
    except (GroundError, ValueError, KeyError, TypeError) as e:
        sys.stderr.write("ground %s: %s\n" % (topic, e))
        h.send(502, {"error": "%s did not answer. Try again later." % SAID[topic]})
        return True
    res["at"] = int(now)
    with _cache_lock:
        if len(_cache) >= CACHE_N:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:CACHE_N // 4]:
                _cache.pop(k, None)
        _cache[key] = (now, res)
    h.send(200, res)
    return True
