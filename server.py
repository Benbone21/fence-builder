#!/usr/bin/env python3
"""Fence Builder server.

Serves the web app, saves your data to a JSON file, and does the three jobs a
browser can't do by itself: read a price off a store page, look up elevation,
and search an address. Python standard library only, no pip installs.

Env settings:
  PORT=8787            port to listen on
  HOST=0.0.0.0         address to bind
  FENCE_DATA=./data/fence-data.json
  FENCE_PASS=secret    turn on a login (user name from FENCE_USER, default "fence")

Run from source, the data lives in data/ next to this file. The installed Windows app
(FenceBuilder.exe, built with PyInstaller) keeps it in %LOCALAPPDATA%\\Fence Builder\\data
instead, so installing an update or uninstalling never touches it.
"""
import base64, glob, gzip, hashlib, hmac, io, ipaddress, json, os, re, shutil, socket, subprocess, sys, tempfile, threading, time, zipfile, zlib
import urllib.error, urllib.parse, urllib.request
from html import unescape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FROZEN = bool(getattr(sys, "frozen", False))  # running as the installed FenceBuilder.exe
# the app's own files (static/, VERSION, update.json); PyInstaller unpacks them into sys._MEIPASS
ROOT = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")


def data_dir():
    """Where jobs, prices and settings live. The web server (python server.py) keeps them next to the
    code. The desktop app (installed, or app.py) keeps its own copy in the user's app-data folder, so
    it never shares anything with a web server. On its first run it brings the jobs over: it moves a
    data/ folder left next to the installed exe, or copies the one next to the code."""
    if not (FROZEN or os.environ.get("FENCE_APP")):
        return os.path.join(ROOT, "data")
    d = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Fence Builder", "data")
    if not os.path.exists(os.path.join(d, "fence-data.json")):
        olds = [(os.path.join(os.path.dirname(sys.executable), "data"), True)] if FROZEN else [(os.path.join(ROOT, "data"), False)]
        for old, move in olds:
            if os.path.isfile(os.path.join(old, "fence-data.json")):
                try:
                    os.makedirs(os.path.dirname(d), exist_ok=True)
                    if os.path.isdir(d) and not os.listdir(d):
                        os.rmdir(d)
                    if not os.path.exists(d):
                        if move:
                            shutil.move(old, d)
                        else:
                            os.makedirs(d)
                            shutil.copy2(os.path.join(old, "fence-data.json"), os.path.join(d, "fence-data.json"))
                except OSError:
                    pass
                break
    return d


DATA = os.environ.get("FENCE_DATA") or os.path.join(data_dir(), "fence-data.json")
PORT = int(os.environ.get("PORT", "8787"))
# the installed desktop app only needs to be reached from this computer (and so never trips the
# Windows firewall prompt); set HOST=0.0.0.0 to open it to phones on the network
HOST = os.environ.get("HOST", "127.0.0.1" if FROZEN else "0.0.0.0")
USER = os.environ.get("FENCE_USER", "fence")
PASS = os.environ.get("FENCE_PASS", "")
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
LOCK = threading.Lock()
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
         ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json",
         ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"}


# ---------- safe outbound fetch (no reaching into your LAN) ----------
def public_host(host):
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified):
            return False
    return True


def check_url(url):
    u = urllib.parse.urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname or not public_host(u.hostname):
        raise ValueError("That address is not allowed")


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(SafeRedirect)


def fetch(url, limit=4_000_000, accept="text/html,application/xhtml+xml,*/*;q=0.8", ua=UA):
    check_url(url)
    req = urllib.request.Request(url, headers={
        "User-Agent": ua, "Accept": accept, "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate"})
    with OPENER.open(req, timeout=20) as r:
        raw = r.read(limit)
        enc = (r.headers.get("Content-Encoding") or "").lower()
        if enc == "gzip":
            raw = gzip.decompress(raw)
        elif enc == "deflate":
            raw = zlib.decompress(raw)
        return raw.decode(r.headers.get_content_charset() or "utf-8", "replace")


# ---------- store catalogs (stores built on Adobe Commerce / Magento, like dbsupply.com) ----------
# These stores answer product searches at /graphql, the same public service their own website uses.
# Only the three fixed questions below are ever sent: list categories, list a category, search by words.
STORE_ITEMS = "total_count items { name sku url_key url_suffix small_image { url } price_range { minimum_price { final_price { value } } } }"
STORE_Q = {
    # one branch of the store only (for example "shop/farm-ranch"); the whole tree is too slow to ask for
    "cats": "query($path: String!) { categories(filters: {url_path: {eq: $path}}) { items { children { uid name product_count children { uid name product_count } } } } }",
    "topcats": "{ categories { items { children { uid name product_count } } } }",
    "cat": "query($uid: String!) { products(filter: {category_uid: {eq: $uid}}, pageSize: 80) { %s } }" % STORE_ITEMS,
    "search": "query($q: String!, $uids: [String]) { products(search: $q, filter: {category_uid: {in: $uids}}, pageSize: 50) { %s } }" % STORE_ITEMS,
    # one product, by the last part of its page address
    "key": "query($uid: String!) { products(filter: {url_key: {eq: $uid}}, pageSize: 1) { %s } }" % STORE_ITEMS,
}


# Only the fencing part of a general farm store is shown: categories whose name matches this,
# found under the branch given (D&B Supply: Farm & Ranch). Everything else in the store is left out.
FENCE_CATS = re.compile(r"fenc|gate|panel", re.I)
_fence_uids = {}


def fence_uids(host, path):
    """The fencing categories (and everything under them) of a store branch, looked up once."""
    k = (host, path)
    if k not in _fence_uids:
        cats = store_query(host, "cats", path=path, _raw=True)["cats"]
        tops = [c for c in cats if " › " not in c["title"] and FENCE_CATS.search(c["title"])]
        keep = [c for c in cats if FENCE_CATS.search(c["title"].split(" › ")[0])]
        _fence_uids[k] = {"tops": [c["uid"] for c in tops], "all": {c["uid"] for c in keep}, "cats": keep}
    return _fence_uids[k]


def store_query(host, op, uid="", q="", path="", _raw=False):
    if not re.fullmatch(r"[a-z0-9.-]{3,80}", host or "") or op not in STORE_Q:
        raise ValueError("That store or request is not allowed")
    url = "https://%s/graphql" % host
    check_url(url)
    if op == "cats" and not path:
        op = "topcats"
    fence = None
    if path and not _raw:
        fence = fence_uids(host, path)
        if op == "cats":
            return {"cats": fence["cats"]}
        if op == "cat" and uid not in fence["all"]:
            raise ValueError("That category is not part of fencing")
    variables = {"uid": uid[:80], "q": q[:120], "path": path[:120]}
    if op == "search":
        variables["uids"] = fence["tops"] if fence else None
    body = json.dumps({"query": STORE_Q[op], "variables": variables}).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json", "Accept": "application/json", "Store": "default",
        "User-Agent": "FenceEstimator/1.0 (self-hosted)"})
    with OPENER.open(req, timeout=25) as r:
        data = json.loads(r.read(6_000_000).decode("utf-8", "replace")).get("data") or {}
    if op in ("cats", "topcats"):
        out = []

        def walk(nodes, trail):
            for c in nodes or []:
                name = trail + [c.get("name") or ""]
                if c.get("product_count"):
                    out.append({"uid": c.get("uid"), "title": " › ".join(name[-2:]), "n": c.get("product_count")})
                walk(c.get("children"), name)
        for top in (data.get("categories") or {}).get("items") or []:
            walk(top.get("children"), [])
        return {"cats": out}
    prods = data.get("products") or {}
    items = []
    for it in prods.get("items") or []:
        price = (((it.get("price_range") or {}).get("minimum_price") or {}).get("final_price") or {}).get("value") or 0
        items.append({"name": it.get("name") or "", "sku": it.get("sku") or "", "price": price,
                      "image": ((it.get("small_image") or {}).get("url") or ""),
                      "url": "https://%s/%s%s" % (host, it.get("url_key") or "", it.get("url_suffix") or "")})
    return {"items": items, "total": prods.get("total_count") or len(items)}


# ---------- price reading ----------
def num(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if v > 0 else None
    m = re.search(r"\d[\d,]*(?:\.\d+)?", str(v))
    if not m:
        return None
    try:
        f = float(m.group(0).replace(",", ""))
    except ValueError:
        return None
    return f if f > 0 else None


def ld_price(o, depth=0):
    if depth > 10:
        return None
    if isinstance(o, list):
        for x in o:
            p = ld_price(x, depth + 1)
            if p:
                return p
    elif isinstance(o, dict):
        for k in ("offers", "priceSpecification"):
            if k in o:
                p = ld_price(o[k], depth + 1)
                if p:
                    return p
        for k in ("price", "lowPrice"):
            if k in o:
                p = num(o[k])
                if p:
                    return p
        for k in ("@graph", "mainEntity", "itemListElement", "hasVariant"):
            if k in o:
                p = ld_price(o[k], depth + 1)
                if p:
                    return p
    return None


def attrs(tag):
    return {k.lower(): unescape(v) for k, _, v in re.findall(r'([\w:-]+)\s*=\s*(["\'])(.*?)\2', tag, re.S)}


def extract_price(html):
    title = ""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    if m:
        title = re.sub(r"\s+", " ", unescape(m.group(1))).strip()[:160]
    for m in re.finditer(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", html, re.S | re.I):
        try:
            data = json.loads(m.group(1).strip())
        except Exception:
            continue
        p = ld_price(data)
        if p:
            return p, "product data", title
    for tag in re.findall(r"<meta\b[^>]*>", html, re.I):
        a = attrs(tag)
        name = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
        if name in ("product:price:amount", "og:price:amount", "price") and a.get("content"):
            p = num(a["content"])
            if p:
                return p, "page tags", title
    for tag in re.findall(r"<[^>]+itemprop=[\"']price[\"'][^>]*>", html, re.I):
        p = num(attrs(tag).get("content"))
        if p:
            return p, "page tags", title
    m = re.search(r'"(?:price|salePrice|currentPrice|finalPrice|offerPrice)"\s*:\s*"?\$?(\d[\d,]*\.?\d*)', html)
    if m and num(m.group(1)):
        return num(m.group(1)), "page script", title
    m = re.search(r"\$\s?(\d{1,3}(?:,\d{3})*\.\d{2})", html)
    if m:
        return num(m.group(1)), "first $ amount on the page (double check it)", title
    return None, None, title


# ---------- saved data: every save gets a version number ----------
# A window can only save on top of the version it loaded. If another window saved in between,
# the save is refused (409) and that window loads the latest instead of wiping out the other's work.
REV = None


def current_rev():
    """Version of the data on disk. Call with LOCK held."""
    global REV
    if REV is None:
        REV = 0
        try:
            with open(DATA, "rb") as f:
                REV = int(json.load(f).get("rev") or 0)
        except Exception:
            pass
    return REV


def keep_backup():
    """Before the first change of each hour, set aside the file as it was. Call with LOCK held."""
    if not os.path.exists(DATA):
        return
    bdir = os.path.join(os.path.dirname(DATA) or ".", "backups")
    os.makedirs(bdir, exist_ok=True)
    name = os.path.join(bdir, time.strftime("fence-%Y-%m-%d-%H00.json"))
    if not os.path.exists(name):
        shutil.copyfile(DATA, name)
        old = sorted(glob.glob(os.path.join(bdir, "fence-*-*-*-*.json")))
        for f in old[:-200]:
            try:
                os.remove(f)
            except OSError:
                pass


# ---------- updates from GitHub ----------
# The app's version is in the VERSION file. update.json names the GitHub repository ("owner/name").
# A newer published release there can be installed from inside the app: its files replace the app's
# own files (the data folder is never touched), the old files are kept in _previous/, and the server restarts.
VERSION_FILE = os.path.join(ROOT, "VERSION")
UPDATE_CFG = os.path.join(ROOT, "update.json")
KEEP = {"data", ".git", "_previous", "__pycache__"}
RESTART = None          # app.py sets this; a plain "python server.py" restarts itself
_upd = {"at": 0, "info": None}


def app_version():
    try:
        with open(VERSION_FILE, encoding="utf-8") as f:
            return f.read().strip() or "0.0.0"
    except OSError:
        return "0.0.0"


def update_repo():
    try:
        with open(UPDATE_CFG, encoding="utf-8") as f:
            repo = (json.load(f).get("repo") or "").strip()
    except (OSError, ValueError):
        repo = ""
    return repo if re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) else ""


def vtuple(v):
    return tuple(int(x) for x in (re.findall(r"\d+", v or "") + ["0", "0", "0"])[:3])


def check_update(force=False):
    cur, repo = app_version(), update_repo()
    if not repo:
        return {"version": cur, "available": False, "reason": "No GitHub repository is set in update.json"}
    if not force and _upd["info"] and time.time() - _upd["at"] < 3600:
        return with_status(_upd["info"], cur)
    rel = json.loads(fetch("https://api.github.com/repos/%s/releases/latest" % repo,
                           accept="application/vnd.github+json", ua="FenceEstimator-updater"))
    tag = rel.get("tag_name") or ""
    info = {"repo": repo, "tag": tag, "latest": tag.lstrip("vV"), "notes": (rel.get("body") or "")[:3000],
            "url": rel.get("html_url") or "https://github.com/%s/releases" % repo,
            "mode": "installer" if FROZEN else "files"}
    if FROZEN:
        # the installed app updates by running the release's installer, attached by the release workflow
        setup = [a for a in rel.get("assets") or []
                 if re.fullmatch(r"FenceBuilder-Setup-[\w.-]+\.exe", a.get("name") or "", re.I)]
        if setup:
            a = setup[0]
            info["setup"] = {"name": a["name"], "url": a.get("browser_download_url") or "",
                             "size": int(a.get("size") or 0), "digest": a.get("digest") or ""}
    _upd.update(at=time.time(), info=info)
    return with_status(info, cur)


def with_status(info, cur):
    out = dict(info, version=cur, available=vtuple(info["latest"]) > vtuple(cur))
    if FROZEN and out["available"] and not info.get("setup"):
        # the release is out but its installer is still being built (or failed to build)
        out.update(available=False, reason="%s is out, but its installer is not ready yet" % info["latest"])
    return out


def install_update():
    info = check_update(force=True)
    if not info.get("available"):
        raise ValueError(info.get("reason") or "You already have the newest version (%s)" % info["version"])
    if FROZEN:
        return download_setup(info)
    url = "https://codeload.github.com/%s/zip/refs/tags/%s" % (info["repo"], urllib.parse.quote(info["tag"]))
    check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": "FenceEstimator-updater"})
    with OPENER.open(req, timeout=60) as r:
        blob = r.read(80_000_000)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    names = [n for n in zf.namelist() if not n.endswith("/")]
    top = names[0].split("/")[0] + "/" if names else ""
    rels = {n[len(top):]: n for n in names if n.startswith(top)}
    if "server.py" not in rels or "static/index.html" not in rels:
        raise ValueError("That release does not look like Fence Builder")
    # keep the current app files, in case the new version needs to be undone by hand
    back = os.path.join(ROOT, "_previous", "%s-%s" % (app_version(), time.strftime("%Y%m%d-%H%M%S")))
    for dirpath, dirs, files in os.walk(ROOT):
        relp = os.path.relpath(dirpath, ROOT)
        if relp.split(os.sep)[0] in KEEP:
            dirs[:] = []
            continue
        for fn in files:
            src = os.path.join(dirpath, fn)
            dst = os.path.join(back, os.path.relpath(src, ROOT))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    root_real = os.path.realpath(ROOT)
    for rel, n in rels.items():
        parts = rel.replace("\\", "/").split("/")
        if not rel or parts[0] in KEEP or ".." in parts or os.path.isabs(rel):
            continue
        dst = os.path.realpath(os.path.join(ROOT, *parts))
        if not dst.startswith(root_real + os.sep):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        tmp = dst + ".new"
        with zf.open(n) as fsrc, open(tmp, "wb") as fdst:
            shutil.copyfileobj(fsrc, fdst)
        os.replace(tmp, dst)
    _upd.update(at=0, info=None)
    return app_version()


SETUP_DIR = os.path.join(tempfile.gettempdir(), "FenceBuilder-update")
_setup = {"path": None}


def download_setup(info):
    """Installed app: download the new release's installer. restart_soon() runs it."""
    s = info["setup"]
    if not s["url"].startswith("https://github.com/"):
        raise ValueError("The installer is not on GitHub")
    req = urllib.request.Request(s["url"], headers={"User-Agent": "FenceEstimator-updater",
                                                    "Accept": "application/octet-stream"})
    os.makedirs(SETUP_DIR, exist_ok=True)
    path = os.path.join(SETUP_DIR, os.path.basename(s["name"]))
    h, n = hashlib.sha256(), 0
    with OPENER.open(req, timeout=60) as r, open(path + ".part", "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            n += len(chunk)
            if n > 400_000_000:
                raise ValueError("The installer is far too big")
            h.update(chunk)
            f.write(chunk)
    if s["size"] and n != s["size"]:
        raise ValueError("The download was cut short, try again")
    if s["digest"].startswith("sha256:") and not hmac.compare_digest(s["digest"][7:].lower(), h.hexdigest()):
        raise ValueError("The download does not match the release, try again")
    os.replace(path + ".part", path)
    _setup["path"] = path
    _upd.update(at=0, info=None)
    return info["latest"]


def run_setup(port):
    """Run the downloaded installer silently once this app has quit, then start the new version
    (the installer starts it, on the same port, so the open window finds it again)."""
    path = _setup["path"]
    log = os.path.join(SETUP_DIR, "install.log")
    # the short wait lets this app exit first so the installer can replace its files
    cmd = ('cmd.exe /d /s /c "ping -n 4 127.0.0.1 >nul & "%s" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART '
           '/CLOSEAPPLICATIONS /LOG="%s" /RELAUNCH=1 /PORT=%d"' % (path, log, int(port)))
    flags = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED_PROCESS, NEW_PROCESS_GROUP, NO_WINDOW
    try:
        subprocess.Popen(cmd, creationflags=flags | 0x01000000, close_fds=True)  # + BREAKAWAY_FROM_JOB
    except OSError:
        subprocess.Popen(cmd, creationflags=flags, close_fds=True)


def restart_soon(port=None):
    def go():
        time.sleep(1.0)
        if FROZEN and _setup["path"]:
            run_setup(port or PORT)
            os._exit(0)
        elif RESTART:
            RESTART()
        else:
            os.execv(sys.executable, [sys.executable] + sys.argv)
    threading.Thread(target=go, daemon=True).start()


# ---------- request handler ----------
class Handler(BaseHTTPRequestHandler):
    server_version = "FenceEstimator/1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def authed(self):
        if not PASS:
            return True
        h = self.headers.get("Authorization", "")
        if h.startswith("Basic "):
            try:
                u, _, p = base64.b64decode(h[6:]).decode().partition(":")
            except Exception:
                u = p = ""
            if hmac.compare_digest(u, USER) and hmac.compare_digest(p, PASS):
                return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Fence Builder"')
        self.send_header("Content-Length", "0")
        self.end_headers()
        return False

    def send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def route(self):
        u = urllib.parse.urlparse(self.path)
        api = u.path.split("/api/", 1)[1] if "/api/" in u.path else None
        return u, api, urllib.parse.parse_qs(u.query)

    def do_GET(self):
        if not self.authed():
            return
        u, api, q = self.route()
        try:
            if api == "data":
                with LOCK:
                    if os.path.exists(DATA):
                        with open(DATA, "rb") as f:
                            return self.send(200, f.read())
                return self.send(200, {})
            if api == "version":
                try:
                    return self.send(200, check_update(force=(q.get("force") or [""])[0] == "1"))
                except Exception as e:  # offline, or GitHub not answering: just say so
                    return self.send(200, {"version": app_version(), "available": False, "reason": "Could not check for updates (%s)" % e})
            if api == "rev":
                # "app" changes whenever the app's own files change, so an open window can tell it is out of date
                app = max((int(os.path.getmtime(os.path.join(STATIC, f))) for f in ("index.html", "view3d.js")
                           if os.path.exists(os.path.join(STATIC, f))), default=0)
                with LOCK:
                    return self.send(200, {"rev": current_rev(), "app": app})
            if api == "store":
                g = lambda k: (q.get(k) or [""])[0].strip()
                return self.send(200, store_query(g("host").lower(), g("op"), g("uid"), g("q"), g("path")))
            if api == "price":
                url = (q.get("url") or [""])[0].strip()
                price, source, title = extract_price(fetch(url))
                if not price:
                    return self.send(422, {"error": "Couldn't find a price on that page. Some stores load prices with scripts or block bots, so type this one in.", "title": title})
                return self.send(200, {"price": round(price, 2), "source": source, "title": title})
            if api == "elevation":
                lat, lng = (q.get("latitude") or [""])[0], (q.get("longitude") or [""])[0]
                if not re.fullmatch(r"[-\d.,]{1,3000}", lat) or not re.fullmatch(r"[-\d.,]{1,3000}", lng):
                    return self.send(400, {"error": "bad coordinates"})
                body = fetch("https://api.open-meteo.com/v1/elevation?latitude=%s&longitude=%s" % (lat, lng), accept="application/json")
                return self.send(200, body)
            if api == "geocode":
                term = (q.get("q") or [""])[0][:200]
                body = fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&q=" + urllib.parse.quote(term),
                             accept="application/json", ua="FenceEstimator/1.0 (self-hosted)")
                return self.send(200, body)
            if api is not None:
                return self.send(404, {"error": "not found"})
            return self.static(u.path)
        except urllib.error.HTTPError as e:
            return self.send(502, {"error": "That site answered with error %s. Some stores block automated price checks, so type that price in." % e.code})
        except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
            return self.send(502, {"error": "Couldn't reach that site (%s)" % getattr(e, "reason", e)})
        except ValueError as e:
            return self.send(400, {"error": str(e)})

    def do_POST(self):
        if not self.authed():
            return
        _, api, _ = self.route()
        if api != "update":
            return self.send(404, {"error": "not found"})
        try:
            v = install_update()
        except Exception as e:
            return self.send(500, {"error": "The update did not install: %s" % e})
        restart_soon(self.server.server_address[1])
        return self.send(200, {"ok": True, "version": v, "mode": "installer" if FROZEN else "files"})

    def do_PUT(self):
        if not self.authed():
            return
        _, api, _ = self.route()
        if api == "seed":
            return self.put_seed()
        if api != "data":
            return self.send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 20_000_000:
            return self.send(413, {"error": "too large"})
        raw = self.rfile.read(n)
        try:
            obj = json.loads(raw)
            if not isinstance(obj, dict):
                raise ValueError
        except Exception:
            return self.send(400, {"error": "not JSON"})
        base = (self.headers.get("X-Base-Rev") or "").strip()
        with LOCK:
            cur = current_rev()
            if base != str(cur):
                # saved from a window that has not seen the latest version
                return self.send(409, {"error": "stale", "rev": cur})
            global REV
            os.makedirs(os.path.dirname(DATA) or ".", exist_ok=True)
            keep_backup()
            obj["rev"] = cur + 1
            tmp = DATA + ".tmp"
            with open(tmp, "wb") as f:
                f.write(json.dumps(obj).encode())
            os.replace(tmp, DATA)
            REV = cur + 1
            return self.send(200, {"ok": True, "rev": REV})

    def put_seed(self):
        """Save the fence types, braces and materials as the starting setup that ships with the app
        (static/seed.json). A new install with no saved data starts from it."""
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 5_000_000:
            return self.send(413, {"error": "too large"})
        try:
            obj = json.loads(self.rfile.read(n))
            seed = {k: obj[k] for k in ("materials", "fenceTypes", "braces", "settings", "drawType") if k in obj}
            if not isinstance(seed.get("materials"), list) or not isinstance(seed.get("fenceTypes"), list):
                raise ValueError
        except Exception:
            return self.send(400, {"error": "not a setup"})
        with LOCK:
            tmp = os.path.join(STATIC, "seed.json.tmp")
            with open(tmp, "wb") as f:
                f.write(json.dumps(seed, indent=1).encode())
            os.replace(tmp, os.path.join(STATIC, "seed.json"))
        return self.send(200, {"ok": True, "materials": len(seed["materials"]), "fenceTypes": len(seed["fenceTypes"]), "braces": len(seed.get("braces") or [])})

    def static(self, path):
        path = urllib.parse.unquote(path)
        rel = path.lstrip("/") or "index.html"
        full = os.path.realpath(os.path.join(STATIC, rel))
        if not full.startswith(os.path.realpath(STATIC)) or not os.path.isfile(full):
            full = os.path.join(STATIC, "index.html")
        with open(full, "rb") as f:
            body = f.read()
        self.send(200, body, TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))


if __name__ == "__main__":
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Fence Builder on http://%s:%d  (data: %s%s)" % (HOST, PORT, DATA, ", login on" if PASS else ""))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
