#!/usr/bin/env python3
"""Fence Builder server.

Serves the web app, saves your data to a JSON file, and does the jobs a browser can't do by
itself: read a price off a store page, look up elevation, and search an address. Python standard
library only, no pip installs.

It runs one of two ways:
  single  one person's data, no sign-in (the Windows app always runs this way, on 127.0.0.1 only)
  multi   a shared server: everyone signs in and has their own jobs, prices and settings, and an
          admin manages the accounts (FENCE_MODE=multi; the Docker image starts this way)

Env settings:
  PORT=8787            port to listen on
  HOST=0.0.0.0         address to bind
  FENCE_DATA=./data/fence-data.json   the data file (single), or a file in the data folder (multi)
  FENCE_MODE=single    or multi
  FENCE_PASS=secret    single mode only: a simple login (user name from FENCE_USER, default "fence")
  Multi mode only (see README.md and SECURITY.md):
  FENCE_ADMIN_USER / FENCE_ADMIN_PASSWORD   make the first admin (used once, only while there are no accounts)
  FENCE_PUBLIC_URL=https://fence.example.com   the address people use (for invite links)
  FENCE_TRUSTED_PROXY=172.30.87.10   address(es) of a reverse proxy (Caddy) whose X-Forwarded-* headers to believe
  FENCE_HTTPS=1        the site is only ever reached over https (secure cookies even without a trusted proxy)
  FENCE_ALLOWED_HOSTS=fence.example.com,192.168.1.20   only answer to these host names (optional)
  FENCE_SESSION_HOURS=12, FENCE_REMEMBER_DAYS=30   how long a sign-in lasts
  FENCE_OFFLINE=all    who may save map areas for offline use: all, admin or off

Run from source, the data lives in data/ next to this file. The installed Windows app
(FenceBuilder.exe, built with PyInstaller) keeps it in %LOCALAPPDATA%\\Fence Builder\\data
instead, so installing an update or uninstalling never touches it.
"""
import base64, glob, gzip, hashlib, hmac, http.client, io, ipaddress, json, os, re, shutil, socket, ssl, subprocess, sys, tempfile, threading, time, traceback, zipfile, zlib
import urllib.error, urllib.parse, urllib.request
from html import unescape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import offline
import ground   # the ground along a fence line: soil, water, trees (public federal map data)

FROZEN = bool(getattr(sys, "frozen", False))  # running as the installed FenceBuilder.exe
# the app's own files (static/, VERSION, update.json); PyInstaller unpacks them into sys._MEIPASS
ROOT = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DESKTOP = bool(FROZEN or os.environ.get("FENCE_APP"))   # the Windows app (app.py) runs this server inside itself


def data_dir():
    """Where jobs, prices and settings live. The web server (python server.py) keeps them next to the
    code. The desktop app (installed, or app.py) keeps its own copy in the user's app-data folder, so
    it never shares anything with a web server. On its first run it brings the jobs over: it moves a
    data/ folder left next to the installed exe, or copies the one next to the code."""
    if not DESKTOP:
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


def env(name, default=""):
    return (os.environ.get(name) or default).strip()


# The Windows app is always single-user with no sign-in, whatever the environment says.
MODE = "single" if DESKTOP else env("FENCE_MODE", "single").lower()
if MODE not in ("single", "multi"):
    raise SystemExit("FENCE_MODE must be single or multi (it is %r)" % MODE)
MULTI = MODE == "multi"
DATA = env("FENCE_DATA") or os.path.join(data_dir(), "fence-data.json")
DATA_ROOT = os.path.dirname(os.path.abspath(DATA))
offline.init(DATA)   # map areas saved for working with no internet live next to the data
PORT = int(env("PORT", "8787"))
# the installed desktop app only needs to be reached from this computer (and so never trips the
# Windows firewall prompt); set HOST=0.0.0.0 to open it to phones on the network
HOST = env("HOST", "127.0.0.1" if FROZEN else "0.0.0.0")
USER = env("FENCE_USER", "fence")
PASS = "" if MULTI else os.environ.get("FENCE_PASS", "")   # the old shared login is replaced by accounts in multi mode
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
LOCK = threading.Lock()
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json",
         ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg", ".gif": "image/gif"}
LOOPBACK_NAMES = {"localhost", "127.0.0.1", "[::1]", "::1"}
# single mode on this computer only (the Windows app): answer only to this computer's own names
LOCAL_ONLY = not MULTI and (DESKTOP or HOST in ("127.0.0.1", "localhost", "::1"))


def _networks(spec):
    if spec.lower() in ("1", "true", "yes", "on"):   # any address on this machine or a private network (a Docker network)
        spec = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"
    out = []
    for part in spec.split(","):
        part = part.strip()
        if part:
            try:
                out.append(ipaddress.ip_network(part, strict=False))
            except ValueError:
                raise SystemExit("FENCE_TRUSTED_PROXY has a bad address: %r" % part)
    return out


TRUSTED_PROXY = _networks(env("FENCE_TRUSTED_PROXY")) if MULTI else []
PUBLIC_URL = env("FENCE_PUBLIC_URL").rstrip("/")
FORCE_HTTPS = env("FENCE_HTTPS") in ("1", "true", "yes", "on")
ALLOWED_HOSTS = {h.strip().lower() for h in env("FENCE_ALLOWED_HOSTS").split(",") if h.strip()}
if ALLOWED_HOSTS and PUBLIC_URL:
    ALLOWED_HOSTS.add(urllib.parse.urlsplit(PUBLIC_URL).hostname or "")
OFFLINE_WHO = env("FENCE_OFFLINE", "all").lower() if MULTI else "all"
# store catalogs the server may ask for products (Adobe Commerce stores; Shopify stores are read by the browser)
STORE_HOSTS = {"www.dbsupply.com"} | {h.strip().lower() for h in env("FENCE_STORE_HOSTS").split(",") if h.strip()}
ACCOUNTS = None
if MULTI:
    import auth
    ACCOUNTS = auth.Accounts(DATA_ROOT, legacy_file=DATA, session_hours=int(env("FENCE_SESSION_HOURS", "12")),
                             remember_days=int(env("FENCE_REMEMBER_DAYS", "30")))
    LIMITS = auth.Buckets()


# ---------- safe outbound fetch (no reaching into your LAN) ----------
def public_ip(ip):
    ip = ipaddress.ip_address(ip)
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified) and ip.is_global


def public_host(host):
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError):
        return False
    return bool(infos) and all(public_ip(info[4][0]) for info in infos)


def check_url(url):
    u = urllib.parse.urlsplit(url)
    try:
        port = u.port
    except ValueError:
        port = -1
    if (u.scheme not in ("http", "https") or not u.hostname or u.username or u.password
            or (MULTI and port not in (None, 80, 443)) or not public_host(u.hostname)):
        raise ValueError("That address is not allowed")


def _public_addrs(host, port):
    """The addresses to connect to, checked again at connect time so a name can't switch to a private
    address between the check and the connection (DNS rebinding)."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise urllib.error.URLError("can't find that site")
    if not infos or not all(public_ip(i[4][0]) for i in infos):
        raise ValueError("That address is not allowed")
    return [i[4][:2] for i in infos]


def _connect_public(host, port, timeout):
    err = None
    for addr in _public_addrs(host, port):
        try:
            return socket.create_connection(addr, timeout)
        except OSError as e:
            err = e
    raise err or OSError("could not connect")


class _PublicHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = _connect_public(self.host, self.port, self.timeout)


class _PublicHTTPS(http.client.HTTPSConnection):
    def connect(self):
        sock = _connect_public(self.host, self.port, self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _PublicHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_PublicHTTP, req)


class _PublicHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_PublicHTTPS, req, context=ssl.create_default_context())


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 5

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


if MULTI:
    # a shared server reaches only public sites, checked when connecting, with no proxy from the environment
    OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _PublicHTTPHandler, _PublicHTTPSHandler, SafeRedirect)
else:
    OPENER = urllib.request.build_opener(SafeRedirect)


def inflate(raw, enc, limit):
    """Unpack a gzip or deflate body, refusing one that unpacks to more than limit bytes."""
    if enc not in ("gzip", "deflate"):
        return raw
    d = zlib.decompressobj(16 + zlib.MAX_WBITS if enc == "gzip" else zlib.MAX_WBITS)
    out = d.decompress(raw, limit)
    if d.unconsumed_tail:
        raise ValueError("That answer is too big")
    return out


def fetch(url, limit=4_000_000, accept="text/html,application/xhtml+xml,*/*;q=0.8", ua=UA):
    check_url(url)
    req = urllib.request.Request(url, headers={
        "User-Agent": ua, "Accept": accept, "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate"})
    with OPENER.open(req, timeout=20) as r:
        raw = r.read(limit)
        raw = inflate(raw, (r.headers.get("Content-Encoding") or "").lower(), limit * 4)
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
    if host not in STORE_HOSTS or op not in STORE_Q:
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
class Store:
    """One data file (one person's jobs, prices and settings) with its version number and hourly backups."""

    def __init__(self, path):
        self.path = path
        self.rev = None
        self.lock = threading.Lock()

    def _rev(self):
        """Version of the data on disk. Call with the lock held."""
        if self.rev is None:
            self.rev = 0
            try:
                with open(self.path, "rb") as f:
                    self.rev = int(json.load(f).get("rev") or 0)
            except Exception:
                pass
        return self.rev

    def current_rev(self):
        with self.lock:
            return self._rev()

    def read(self):
        with self.lock:
            if os.path.exists(self.path):
                with open(self.path, "rb") as f:
                    return f.read()
        return None

    def save(self, obj, base):
        """(True, new version), or (False, current version) if base is not the version on disk."""
        with self.lock:
            cur = self._rev()
            if base != str(cur):
                return False, cur
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            self._keep_backup()
            obj["rev"] = cur + 1
            tmp = self.path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(json.dumps(obj).encode())
            os.replace(tmp, self.path)
            self.rev = cur + 1
            return True, self.rev

    def _keep_backup(self):
        """Before the first change of each hour, set aside the file as it was. Call with the lock held."""
        if not os.path.exists(self.path):
            return
        bdir = os.path.join(os.path.dirname(self.path) or ".", "backups")
        os.makedirs(bdir, exist_ok=True)
        name = os.path.join(bdir, time.strftime("fence-%Y-%m-%d-%H00.json"))
        if not os.path.exists(name):
            shutil.copyfile(self.path, name)
            old = sorted(glob.glob(os.path.join(bdir, "fence-*-*-*-*.json")))
            for f in old[:-200]:
                try:
                    os.remove(f)
                except OSError:
                    pass


STORE = Store(DATA)     # single mode: the one data file
_stores = {}            # multi mode: user id -> that person's Store


def store_for(uid):
    """The data of the signed-in person. The path comes only from their account id, never from the request."""
    if not MULTI:
        return STORE
    with LOCK:
        s = _stores.get(uid)
        if s is None:
            s = _stores[uid] = Store(ACCOUNTS.data_file(uid))
        return s


def current_rev():   # kept for anything that still asks the old way
    return STORE.current_rev()


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



# ---------- the app's own files: joined, versioned, compressed and cached in memory ----------
COMPRESSIBLE = ("text/", "application/json", "application/manifest+json", "image/svg+xml")
# pages people open by name; everything else is a file in static/
PAGES = {"": "index.html", "index.html": "index.html", "login": "login.html", "login.html": "login.html",
         "admin": "admin.html", "admin.html": "admin.html"}
# what the sign-in page needs before anyone has signed in (multi mode); everything else needs a sign-in
PUBLIC_FILES = {"login.html", "login.js", "look.js", "app.css", "icon-256.png", "icon-512.png", "manifest.webmanifest"}
REF_RE = re.compile(r'((?:href|src)="|"\./)((?:vendor/)?[\w./-]+?\.(?:js|css))"')
IMPORTMAP_RE = re.compile(r'<script type="importmap">(.*?)</script>', re.S)


def safe_path(base, rel):
    """base/rel, or None if rel would leave base (.., absolute paths, drive letters, links out)."""
    if not rel or "\x00" in rel or "\\" in rel:
        return None
    parts = rel.split("/")
    if any(p in ("", ".", "..") or p.startswith(".") or ":" in p for p in parts):
        return None
    root = os.path.realpath(base)
    full = os.path.realpath(os.path.join(root, *parts))
    return full if full.startswith(root + os.sep) else None


class Asset:
    __slots__ = ("body", "gz", "etag", "ver", "ctype")

    def __init__(self, body, ctype):
        self.body, self.ctype = body, ctype
        self.ver = hashlib.sha256(body).hexdigest()[:16]
        self.etag = '"%s"' % self.ver
        self.gz = gzip.compress(body, 9, mtime=0) if len(body) > 1024 and ctype.startswith(COMPRESSIBLE) else None


class Assets:
    """Files are read once and kept, already compressed, until they change on disk. Pages link the
    others with ?v=<version>, so the browser can keep them for good and asks again only after a change."""

    def __init__(self):
        self.lock = threading.Lock()
        self.cache = {}
        self.inline = {}   # page -> hashes of its inline import map (allowed by the Content-Security-Policy)

    @staticmethod
    def _sig(paths):
        out = []
        for p in paths:
            try:
                st = os.stat(p)
                out.append((p, st.st_mtime_ns, st.st_size))
            except OSError:
                out.append((p, 0, 0))
        return tuple(out)

    def get(self, rel):
        if rel == "app.js":
            parts = sorted(glob.glob(os.path.join(STATIC, "js", "*.js")))
            sig = self._sig(parts + [os.path.join(STATIC, "view3d.js")])
            with self.lock:
                c = self.cache.get(rel)
                if c and c[0] == sig:
                    return c[1]
            a = Asset(app_js(self.version("view3d.js")), TYPES[".js"])
        elif rel == "sw.js":
            # the phone's offline copy of the app (static/sw.js) is named after the app's own files, so a new
            # version of the app makes the phone fetch it again
            full = os.path.join(STATIC, "sw.js")
            if not os.path.isfile(full):
                return None
            sig = self._sig([full] + app_files())
            with self.lock:
                c = self.cache.get(rel)
                if c and c[0] == sig:
                    return c[1]
            with open(full, "rb") as f:
                raw = f.read()
            ver = hashlib.sha256("|".join(self.version(x) for x in ("index.html", "app.js", "app.css", "look.js")).encode()).hexdigest()[:16]
            a = Asset(raw.replace(b"__APP_VERSION__", ver.encode()), TYPES[".js"])
        else:
            full = safe_path(STATIC, rel)
            if not full or not os.path.isfile(full):
                return None
            sig = self._sig([full])
            raw = None
            if rel.endswith(".html"):
                with open(full, "rb") as f:
                    raw = f.read()
                refs = [m[1] for m in REF_RE.findall(raw.decode("utf-8", "replace"))]
                sig += self._sig([os.path.join(STATIC, *r.split("/")) for r in refs if r != "app.js"]) + (
                    self._sig(sorted(glob.glob(os.path.join(STATIC, "js", "*.js")))) if "app.js" in refs else ())
            with self.lock:
                c = self.cache.get(rel)
                if c and c[0] == sig:
                    return c[1]
            if raw is None:
                with open(full, "rb") as f:
                    raw = f.read()
            if rel.endswith(".html"):
                raw = self.link_versions(rel, raw.decode("utf-8")).encode("utf-8")
            a = Asset(raw, TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))
        with self.lock:
            self.cache[rel] = (sig, a)
        return a

    def version(self, rel):
        a = self.get(rel)
        return a.ver if a else ""

    def link_versions(self, page, html):
        def ver(m):
            v = self.version(m.group(2))
            return '%s%s%s"' % (m.group(1), m.group(2), "?v=" + v if v else "")
        html = REF_RE.sub(ver, html)
        self.inline[page] = {base64.b64encode(hashlib.sha256(s.encode("utf-8")).digest()).decode()
                             for s in IMPORTMAP_RE.findall(html)}
        return html

    def script_hashes(self):
        return sorted({h for hs in self.inline.values() for h in hs})


ASSETS = Assets()


def app_js(view3d_ver=""):
    """The app's script, kept in pieces in static/js/ (numbered in the order they run) and served as one.
    The pieces share one block, exactly like the single script they came from."""
    parts = sorted(glob.glob(os.path.join(STATIC, "js", "*.js")))
    body = "{\n" + "".join(open(f, encoding="utf-8").read() for f in parts) + "\n}\n"
    if view3d_ver:   # the 3D view loads only when opened; this lets the browser keep it between visits
        body = body.replace("import('./view3d.js')", "import('./view3d.js?v=%s')" % view3d_ver)
    return body.encode("utf-8")


def app_files():
    """The app's own files: when one changes, an open window offers to refresh."""
    names = [os.path.join(STATIC, f) for f in ("index.html", "app.css", "look.js", "view3d.js")]
    return [f for f in names + glob.glob(os.path.join(STATIC, "js", "*.js")) if os.path.exists(f)]


_appver = {"at": 0, "v": 0}


def app_mtime():
    if time.time() - _appver["at"] > 3:   # every open window asks every few seconds: look at the files now and then
        _appver.update(at=time.time(), v=max((int(os.path.getmtime(f)) for f in app_files()), default=0))
    return _appver["v"]


def csp():
    hashes = "".join(" 'sha256-%s'" % h for h in ASSETS.script_hashes())
    # Map tiles, store pictures and the map/LiDAR/parcel services the page asks directly are all on https
    # sites, so those are allowed for pictures and requests. Scripts only come from this server.
    return ("default-src 'self'; script-src 'self'%s; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self' data:; "
            "worker-src 'self' blob:; manifest-src 'self'; media-src 'self' blob: data:; object-src 'none'; "
            "base-uri 'none'; form-action 'self'; frame-ancestors 'none'" % hashes)


# ---------- the desktop app's choice: its own copy, or a Fence Builder server ----------
DESKTOP_NOTE = ""   # app.py sets this when the chosen server could not be reached at start


def desktop_settings_path():
    return os.path.join(os.path.dirname(DATA_ROOT), "app-settings.json")


def desktop_settings():
    try:
        with open(desktop_settings_path(), encoding="utf-8") as f:
            s = json.load(f)
        return s if isinstance(s, dict) else {}
    except (OSError, ValueError):
        return {}


def clean_server_url(url):
    """A Fence Builder server's address as people type it, tidied: http(s)://name[:port][/path]."""
    url = str(url or "").strip()
    if not url:
        return ""
    if not re.match(r"^https?://", url, re.I):
        url = "http://" + url
    u = urllib.parse.urlsplit(url)
    try:
        port = u.port
    except ValueError:
        raise ValueError("That address has a bad port number.")
    if u.scheme.lower() not in ("http", "https") or not u.hostname or u.username or u.password or u.query or u.fragment:
        raise ValueError("Type the server's address, for example https://fence.example.com or http://192.168.1.20:8787")
    if not re.fullmatch(r"[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\]", u.netloc.rsplit(":", 1)[0] if port else u.netloc):
        raise ValueError("That address has characters a server address can't have.")
    path = re.sub(r"/(login|index\.html|admin)?$", "", u.path or "")
    return "%s://%s%s" % (u.scheme.lower(), u.netloc.lower(), path)


def probe_server(url, timeout=8):
    """Does a Fence Builder server answer at url? Asked by the desktop app only, for an address its user typed."""
    req = urllib.request.Request(url + "/api/auth/status", headers={"User-Agent": "FenceBuilder-app", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        j = json.loads(r.read(100_000))
    if not isinstance(j, dict) or j.get("mode") != "multi":
        raise ValueError("That address answers, but it is not a Fence Builder server with accounts.")
    return j


def save_desktop_server(url):
    s = desktop_settings()
    s["server"] = url
    path = desktop_settings_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(s, f, indent=1)
    os.replace(path + ".tmp", path)


# ---------- request handler ----------
UNSAFE = ("POST", "PUT", "DELETE", "PATCH")
LOG_ALL = env("FENCE_LOG_REQUESTS") in ("1", "true", "yes")
# requests a signed-in person may make in 10 minutes, for things that cost the server or other sites
RATE = {"tile": 4000, "fetch": 600, "geo": 300, "heavy": 200}


class Handler(BaseHTTPRequestHandler):
    server_version = "FenceBuilder"
    sys_version = ""
    protocol_version = "HTTP/1.1"   # keep the connection open between requests (much faster for map tiles)
    timeout = 120                   # a connection that sends nothing for 2 minutes is closed

    # ----- who is asking, and how -----
    def hdr(self, name):
        h = getattr(self, "headers", None)
        return (h.get(name) if h else None) or ""

    def peer_trusted(self):
        try:
            ip = ipaddress.ip_address(self.client_address[0])
        except (ValueError, IndexError, TypeError):
            return False
        return any(ip in n for n in TRUSTED_PROXY)

    def client_ip(self):
        ip = self.client_address[0] if self.client_address else "?"
        if TRUSTED_PROXY and self.peer_trusted():
            for x in reversed([x.strip() for x in self.hdr("X-Forwarded-For").split(",") if x.strip()]):
                try:
                    a = ipaddress.ip_address(x)
                except ValueError:
                    break
                ip = x
                if not any(a in n for n in TRUSTED_PROXY):
                    break
        return ip

    def is_https(self):
        if FORCE_HTTPS:
            return True
        if TRUSTED_PROXY and self.peer_trusted():
            return self.hdr("X-Forwarded-Proto").split(",")[0].strip().lower() == "https"
        return False

    def plain_from_outside(self):
        """True when this is plain http from outside the local network: passwords travel unencrypted."""
        if self.is_https():
            return False
        try:
            return public_ip(self.client_ip())
        except ValueError:
            return False

    def host_parts(self):
        h = self.hdr("Host").strip().lower()
        m = re.fullmatch(r"(\[[0-9a-f:.]+\]|[a-z0-9_.-]+)(?::(\d{1,5}))?", h)
        return (m.group(1), int(m.group(2)) if m.group(2) else None) if m else (None, None)

    def host_ok(self):
        if not self.hdr("Host"):
            return not MULTI
        name, _ = self.host_parts()
        if not name:
            return False
        if LOCAL_ONLY and name not in LOOPBACK_NAMES:   # the desktop app: no other site can pose as it (DNS rebinding)
            return False
        if ALLOWED_HOSTS and name not in ALLOWED_HOSTS and name not in LOOPBACK_NAMES:
            return False
        return True

    def origin_ok(self):
        """A change (POST/PUT) must come from a page of this same site. Browsers always say where a
        request comes from (Origin), so a page on another website can't make changes here."""
        o = self.hdr("Origin") or self.hdr("Referer")
        if not o:
            return not MULTI   # scripts and tests on a private single-user server
        if o == "null":
            return False
        u = urllib.parse.urlsplit(o)
        try:
            oport = u.port or {"http": 80, "https": 443}.get(u.scheme)
        except ValueError:
            return False
        name, port = self.host_parts()
        if not name or (u.hostname or "") != name.strip("[]"):
            return False
        return port is None and oport in (80, 443) or port == oport

    # ----- answering -----
    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        if getattr(self, "_page", True):   # pages only: these say what a page may do (the small API answers skip them)
            self.send_header("Permissions-Policy", "geolocation=(self), screen-wake-lock=(self), camera=(), microphone=(), payment=(), usb=()")
            self.send_header("Content-Security-Policy", csp())
        if MULTI and self.is_https():
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        for c in getattr(self, "_cookies", ()):
            self.send_header("Set-Cookie", c)
        self._cookies = []
        super().end_headers()

    def gzip_ok(self):
        ae = self.hdr("Accept-Encoding").lower()
        return "gzip" in ae and not re.search(r"gzip\s*;\s*q=0(\.0*)?\s*(,|$)", ae)

    def send(self, code, body, ctype="application/json", cache="no-store", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        text = ctype.startswith(COMPRESSIBLE)
        gz = text and len(body) > 1024 and self.gzip_ok()
        if gz:
            body = gzip.compress(body, 5)
        self._page = ctype.startswith("text/html")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        if gz:
            self.send_header("Content-Encoding", "gzip")
        if text:
            self.send_header("Vary", "Accept-Encoding")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self._sent = True
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_asset(self, a, q):
        priv = "private, " if MULTI else ""
        v = (q.get("v") or [""])[0]
        cache = priv + ("max-age=31536000, immutable" if v and v == a.ver else "no-cache")
        self._page = a.ctype.startswith("text/html")
        if a.etag in [x.strip() for x in self.hdr("If-None-Match").split(",")]:
            self.send_response(304)
            self.send_header("ETag", a.etag)
            self.send_header("Cache-Control", cache)
            self.end_headers()
            self._sent = True
            return
        gz = a.gz is not None and self.gzip_ok()
        body = a.gz if gz else a.body
        self.send_response(200)
        self.send_header("Content-Type", a.ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("ETag", a.etag)
        if a.gz is not None:
            self.send_header("Vary", "Accept-Encoding")
        if gz:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        self._sent = True
        self.wfile.write(body)

    def redirect(self, path, target):
        self.send_response(302)
        self.send_header("Location", path[:path.rfind("/") + 1] + target)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self._sent = True

    # ----- request bodies -----
    def read_body(self, limit):
        """The request body (unpacked if sent gzipped), or None after answering with an error."""
        if self.hdr("Transfer-Encoding"):
            self.send(411, {"error": "Content-Length is needed"})
            return None
        try:
            n = int(self.hdr("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > limit:
            self.send(413, {"error": "That is too large to save"})
            return None
        raw = self.rfile.read(n) if n else b""
        self._body_read = True
        enc = self.hdr("Content-Encoding").strip().lower()
        if enc and enc != "identity":
            try:
                if enc != "gzip":
                    raise ValueError
                raw = inflate(raw, "gzip", limit)
            except (ValueError, zlib.error):
                self.send(400, {"error": "That could not be unpacked"})
                return None
        return raw

    def read_json(self, limit, required=True):
        raw = self.read_body(limit)
        if raw is None:
            return None
        if not raw.strip():
            if required:
                self.send(400, {"error": "Nothing was sent"})
                return None
            return {}
        if self.hdr("Content-Type").split(";")[0].strip().lower() != "application/json":
            self.send(415, {"error": "Send JSON"})
            return None
        try:
            obj = json.loads(raw)
        except ValueError:
            obj = None
        if not isinstance(obj, dict):
            self.send(400, {"error": "not JSON"})
            return None
        return obj

    # ----- sign-in cookie -----
    def cookie_name(self):
        return "__Host-fb_session" if self.is_https() else "fb_session"

    def cookie_token(self):
        want = self.cookie_name()
        for part in self.hdr("Cookie").split(";"):
            k, _, v = part.strip().partition("=")
            if k == want and v:
                return v.strip()
        return ""

    def set_session_cookie(self, token, max_age=None):
        c = "%s=%s; Path=/; HttpOnly; SameSite=Strict" % (self.cookie_name(), token)
        if self.is_https():
            c += "; Secure"
        if max_age:
            c += "; Max-Age=%d" % max_age
        self._cookies.append(c)

    def clear_session_cookie(self):
        self._cookies.append("%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0%s"
                             % (self.cookie_name(), "; Secure" if self.is_https() else ""))

    # ----- logging: no addresses people searched for, no codes -----
    def log_request(self, code="-", size="-"):
        try:
            code = int(code)
        except (TypeError, ValueError):
            code = 0
        if LOG_ALL or code >= 400 or self.command not in ("GET", "HEAD"):
            sys.stderr.write("%s %s %s %s\n" % (self.client_ip(), self.command, (self.path or "").split("?", 1)[0][:200], code))

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.client_ip(), (fmt % args)[:300]))

    # ----- the old shared login (single mode only) -----
    def authed(self):
        if not PASS:
            return True
        h = self.hdr("Authorization")
        if h.startswith("Basic "):
            try:
                u, _, p = base64.b64decode(h[6:]).decode().partition(":")
            except Exception:
                u = p = ""
            if hmac.compare_digest(u.encode(), USER.encode()) and hmac.compare_digest(p.encode(), PASS.encode()):
                return True
        self.send(401, b"", "text/plain", headers={"WWW-Authenticate": 'Basic realm="Fence Builder"'})
        return False

    # ----- every request comes through here -----
    def do_GET(self):
        self.answer("GET")

    def do_POST(self):
        self.answer("POST")

    def do_PUT(self):
        self.answer("PUT")

    def do_DELETE(self):
        self.answer("DELETE")

    def answer(self, method):
        self._body_read, self._sent, self._cookies, self._page = False, False, [], True
        self.user = self.sess = None
        try:
            self.dispatch(method)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.timeout):
            self.close_connection = True
        except Exception:
            traceback.print_exc(file=sys.stderr)
            if not self._sent:
                try:
                    self.send(500, {"error": "Something went wrong on the server. Please try again."})
                except OSError:
                    pass
            self.close_connection = True
        finally:
            # a body that was never read would be taken for the next request on this connection
            if not self._body_read and (self.hdr("Transfer-Encoding") or self.hdr("Content-Length") not in ("", "0")):
                self.close_connection = True

    def dispatch(self, method):
        u = urllib.parse.urlsplit(self.path)
        path = u.path or "/"
        api = path.split("/api/", 1)[1] if "/api/" in path else None
        q = urllib.parse.parse_qs(u.query)
        self._page = api is None
        if not self.host_ok():
            return self.send(421, {"error": "This server does not answer to that address."})
        if method in UNSAFE and not self.origin_ok():
            if MULTI:
                ACCOUNTS.audit("blocked_cross_site_request", ip=self.client_ip(), path=path[:100],
                               origin=(self.hdr("Origin") or self.hdr("Referer"))[:100])
            return self.send(403, {"error": "This request came from another website, so it was blocked."})
        if api == "health":
            return self.send(200, {"ok": True, "mode": MODE})
        if MULTI:
            return self.multi(method, path, api, q)
        if not self.authed():
            return
        if api in ("auth/me", "auth/status"):
            info = {"mode": "single", "desktop": DESKTOP}
            if DESKTOP:
                info.update(server_url=desktop_settings().get("server") or "", note=DESKTOP_NOTE)
            return self.send(200, info)
        return self.app(method, path, api, q, None, True)

    def multi(self, method, path, api, q):
        if api is not None and api.startswith("auth/"):
            return self.auth_api(method, api[5:])
        rel = urllib.parse.unquote(path).lstrip("/")
        if api is None and method == "GET" and PAGES.get(rel, rel) in PUBLIC_FILES:
            return self.static(rel, q)
        found = ACCOUNTS.session(self.cookie_token())
        if not found:
            if api is not None:
                return self.send(401, {"error": "signin", "message": "You were signed out. Please sign in again."})
            if rel in PAGES:
                return self.redirect(path, "login")
            return self.send(401, b"", "text/plain")
        self.sess, self.user = found
        if method in UNSAFE and not hmac.compare_digest(self.hdr("X-CSRF-Token").encode(), self.sess["csrf"].encode()):
            ACCOUNTS.audit("blocked_request_without_token", ip=self.client_ip(), user=self.user["username"], path=path[:100])
            return self.send(403, {"error": "Please refresh the page, then try again."})
        if self.user.get("must_change"):
            if api is not None:
                return self.send(403, {"error": "change_password", "message": "Choose a new password first."})
            return self.redirect(path, "login")
        admin = self.user["role"] == "admin"
        if api is not None and api.startswith("admin/"):
            if not admin:
                ACCOUNTS.audit("blocked_admin_request", ip=self.client_ip(), user=self.user["username"], path=path[:100])
                return self.send(403, {"error": "Only an admin can do that."})
            return self.admin_api(method, api[6:], q)
        if api is None and PAGES.get(rel) == "admin.html" and not admin:
            return self.redirect(path, "./")
        return self.app(method, path, api, q, self.user["id"], admin)

    def limited(self, uid, kind):
        """Multi mode: True (after saying so) if this person has asked for too much of this lately."""
        if not MULTI or LIMITS.allow("%s:%s" % (kind, uid), RATE[kind], 600):
            return False
        self.send(429, {"error": "That is a lot of requests in a short time. Please wait a few minutes, then try again."})
        return True

    # ----- the app itself: the same for everyone, on each person's own data -----
    def app(self, method, path, api, q, uid, admin):
        if api is None:
            if method != "GET":
                return self.send(405, {"error": "not allowed"})
            return self.static(urllib.parse.unquote(path).lstrip("/"), q)
        try:
            if method == "GET":
                return self.app_get(api, q, uid, admin)
            if method == "PUT":
                return self.app_put(api, uid, admin)
            if method == "POST":
                return self.app_post(api, uid, admin)
            return self.send(405, {"error": "not allowed"})
        except urllib.error.HTTPError as e:
            return self.send(502, {"error": "That site answered with error %s. Some stores block automated price checks, so type that price in." % e.code})
        except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
            return self.send(502, {"error": "Couldn't reach that site (%s)" % getattr(e, "reason", e)})
        except (ValueError, KeyError, TypeError) as e:
            return self.send(400, {"error": str(e)})

    def app_get(self, api, q, uid, admin):
        g = lambda k: (q.get(k) or [""])[0].strip()
        if api == "data":
            body = store_for(uid).read()
            return self.send(200, body if body is not None else b"{}")
        if api == "rev":
            # "app" changes whenever the app's own files change, so an open window can tell it is out of date
            return self.send(200, {"rev": store_for(uid).current_rev(), "app": app_mtime()})
        if api == "version":
            if MULTI:
                # a shared server is updated by whoever runs it (a new Docker image), never from the page
                info = {"version": app_version(), "available": False, "server": True}
                if admin:
                    try:
                        c = check_update(force=g("force") == "1")
                        info.update(latest=c.get("latest"), url=c.get("url"),
                                    newer=bool(c.get("latest")) and vtuple(c.get("latest")) > vtuple(info["version"]))
                    except Exception as e:
                        info["reason"] = "Could not check for updates (%s)" % e
                return self.send(200, info)
            try:
                return self.send(200, check_update(force=g("force") == "1"))
            except Exception as e:  # offline, or GitHub not answering: just say so
                return self.send(200, {"version": app_version(), "available": False, "reason": "Could not check for updates (%s)" % e})
        if api == "store":
            if self.limited(uid, "fetch"):
                return
            return self.send(200, store_query(g("host").lower(), g("op"), g("uid"), g("q"), g("path")))
        if api == "price":
            if self.limited(uid, "fetch"):
                return
            price, source, title = extract_price(fetch(g("url")))
            if not price:
                return self.send(422, {"error": "Couldn't find a price on that page. Some stores load prices with scripts or block bots, so type this one in.", "title": title})
            return self.send(200, {"price": round(price, 2), "source": source, "title": title})
        if api == "elevation":
            if self.limited(uid, "geo"):
                return
            lat, lng = g("latitude"), g("longitude")
            if not re.fullmatch(r"[-\d.,]{1,3000}", lat) or not re.fullmatch(r"[-\d.,]{1,3000}", lng):
                return self.send(400, {"error": "bad coordinates"})
            body = fetch("https://api.open-meteo.com/v1/elevation?latitude=%s&longitude=%s" % (lat, lng), accept="application/json")
            return self.send(200, body)
        if api == "geocode":
            if self.limited(uid, "geo"):
                return
            term = (q.get("q") or [""])[0][:200]
            body = fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&q=" + urllib.parse.quote(term),
                         accept="application/json", ua="FenceEstimator/1.0 (self-hosted)")
            return self.send(200, body)
        if api.startswith("off/"):
            kind = "tile" if api.startswith("off/tile/") else "heavy" if api.startswith("off/dem") else None
            if kind and self.limited(uid, kind):
                return
            if offline.handle_get(self, api, q, owner=uid, admin=admin, private=MULTI):
                return
        if api == "app/server" and DESKTOP:
            return self.send(200, {"server_url": desktop_settings().get("server") or ""})
        return self.send(404, {"error": "not found"})

    def app_put(self, api, uid, admin):
        if api == "seed":
            return self.put_seed(admin)
        if api != "data":
            return self.send(404, {"error": "not found"})
        raw = self.read_body(20_000_000)
        if raw is None:
            return
        if MULTI and self.hdr("Content-Type").split(";")[0].strip().lower() != "application/json":
            return self.send(415, {"error": "Send JSON"})
        try:
            obj = json.loads(raw)
            if not isinstance(obj, dict):
                raise ValueError
        except Exception:
            return self.send(400, {"error": "not JSON"})
        ok, rev = store_for(uid).save(obj, self.hdr("X-Base-Rev").strip())
        if not ok:   # saved from a window that has not seen the latest version
            return self.send(409, {"error": "stale", "rev": rev})
        return self.send(200, {"ok": True, "rev": rev})

    def app_post(self, api, uid, admin):
        if api.startswith("ground/"):
            if self.limited(uid, "geo"):
                return
            body = self.read_json(400_000)
            if body is None:
                return
            if ground.handle_post(self, api, body):
                return
            return self.send(404, {"error": "not found"})
        if api.startswith("off/"):
            kind = "heavy" if api == "off/elev" else "fetch" if api == "off/areas" else None
            if kind and self.limited(uid, kind):
                return
            body = self.read_json(2_000_000, required=False)
            if body is None:
                return
            may_save = not MULTI or OFFLINE_WHO == "all" or (OFFLINE_WHO == "admin" and admin)
            if offline.handle_post(self, api, body, owner=uid, admin=admin, may_save=may_save):
                return
            return self.send(404, {"error": "not found"})
        if api == "update" and not MULTI:
            if self.read_body(4096) is None:
                return
            try:
                v = install_update()
            except Exception as e:
                return self.send(500, {"error": "The update did not install: %s" % e})
            restart_soon(self.server.server_address[1])
            return self.send(200, {"ok": True, "version": v, "mode": "installer" if FROZEN else "files"})
        if api == "app/server" and DESKTOP:
            body = self.read_json(4096)
            if body is None:
                return
            url = clean_server_url(body.get("url"))
            if url:
                name, port = self.host_parts()
                if re.match(r"https?://(localhost|127\.0\.0\.1|\[::1\]):%d(/|$)" % (port or 0), url):
                    raise ValueError("That is this app's own address. Type the address of the Fence Builder server.")
                try:
                    probe_server(url)
                except (urllib.error.URLError, socket.timeout, TimeoutError, OSError):
                    raise ValueError("Fence Builder could not reach %s. Check the address, and that the server is running." % url)
                except ValueError as e:
                    raise ValueError(str(e) if "Fence Builder" in str(e) else "That address does not answer like a Fence Builder server.")
            save_desktop_server(url)
            return self.send(200, {"ok": True, "url": url})
        return self.send(404, {"error": "not found"})

    def put_seed(self, admin):
        """Save the fence types, braces and materials as the starting setup. Single mode: the one that
        ships with the app (static/seed.json), which a new install starts from. Multi mode: an admin
        sets what new accounts start with (kept in the data folder; never anyone's business details)."""
        if MULTI and not admin:
            return self.send(403, {"error": "Only an admin can do that."})
        raw = self.read_body(5_000_000)
        if raw is None:
            return
        if MULTI and self.hdr("Content-Type").split(";")[0].strip().lower() != "application/json":
            return self.send(415, {"error": "Send JSON"})
        try:
            obj = json.loads(raw)
            seed = {k: obj[k] for k in ("materials", "fenceTypes", "braces", "settings", "drawType") if k in obj}
            if not isinstance(seed.get("materials"), list) or not isinstance(seed.get("fenceTypes"), list):
                raise ValueError
        except Exception:
            return self.send(400, {"error": "not a setup"})
        if MULTI and isinstance(seed.get("settings"), dict):
            seed["settings"] = {k: v for k, v in seed["settings"].items()
                                if k not in ("biz", "crew", "priceRun", "priceRunAt", "nextQuote", "shop")}
        dest = os.path.join(DATA_ROOT, "seed.json") if MULTI else os.path.join(STATIC, "seed.json")
        with LOCK:
            with open(dest + ".tmp", "wb") as f:
                f.write(json.dumps(seed, indent=1).encode())
            os.replace(dest + ".tmp", dest)
        if MULTI:
            ACCOUNTS.audit("starting_setup_saved", ip=self.client_ip(), by=self.user["username"])
        return self.send(200, {"ok": True, "materials": len(seed["materials"]), "fenceTypes": len(seed["fenceTypes"]), "braces": len(seed.get("braces") or [])})

    def static(self, rel, q):
        rel = PAGES.get(rel, rel)
        if rel == "seed.json" and MULTI:
            p = os.path.join(DATA_ROOT, "seed.json")   # the starting setup an admin saved for new accounts
            if os.path.isfile(p):
                with open(p, "rb") as f:
                    return self.send(200, f.read(), cache="private, no-cache")
        a = ASSETS.get(rel)
        if a is None:
            if "." in rel.rsplit("/", 1)[-1]:
                return self.send(404, b"Not found", "text/plain")
            a = ASSETS.get("index.html")
        return self.send_asset(a, q)

    # ----- signing in (multi mode) -----
    def auth_api(self, method, name):
        A, ip, ua = ACCOUNTS, self.client_ip(), self.hdr("User-Agent")
        token = self.cookie_token()
        if method == "GET" and name in ("status", "me"):
            found = A.session(token)
            if name == "me":
                if not found:
                    return self.send(401, {"error": "signin"})
                s, u = found
                return self.send(200, {"mode": "multi", "user": A.public(u), "csrf": s["csrf"], "secure": self.is_https(),
                                       "warn_plain": self.plain_from_outside(), "offline": OFFLINE_WHO})
            return self.send(200, {"mode": "multi", "setup": A.needs_setup(), "signed_in": bool(found),
                                   "must_change": bool(found and found[1].get("must_change")),
                                   "name": found[1].get("name") if found else None, "secure": self.is_https(),
                                   "warn_plain": self.plain_from_outside()})
        if method != "POST":
            return self.send(404, {"error": "not found"})
        body = self.read_json(16_384, required=name != "logout")
        if body is None:
            return
        if name == "login":
            st, x = A.login(body.get("username"), body.get("password"), ip)
            if st == "locked":
                return self.send(429, {"error": "Too many tries. Please wait %d minutes, then try again." % max(1, round(x / 60))})
            if st == "bad":
                return self.send(401, {"error": "That user name and password don't match. Check them and try again."})
            if st == "off":
                return self.send(403, {"error": "This account is turned off. Ask the person who runs Fence Builder to turn it back on."})
            if token:
                A.end_session(token)   # a sign-in always starts a new session; an old one from this browser ends
            self.set_session_cookie(*A.new_session(x, ip, ua, remember=bool(body.get("remember"))))
            return self.send(200, {"ok": True, "must_change": bool(x.get("must_change"))})
        if name == "logout":
            found = A.session(token)
            A.end_session(token)
            if found:
                A.audit("signout", ip=ip, user=found[1]["username"])
            self.clear_session_cookie()
            return self.send(200, {"ok": True})
        if name == "setup":
            if not A.needs_setup():
                return self.send(409, {"error": "Fence Builder is already set up. Sign in instead."})
            r = A.check_setup_code(body.get("code"), ip)
            if r == "locked":
                return self.send(429, {"error": "Too many tries. Please wait 30 minutes, then try again."})
            if r != "ok":
                return self.send(401, {"error": "That setup code is not right. Look in the server's log for the newest one."})
            try:
                u = A.create_first_admin(body.get("username"), body.get("name"), body.get("password"), ip=ip)
            except ValueError as e:
                return self.send(400, {"error": str(e)})
            self.set_session_cookie(*A.new_session(u, ip, ua))
            return self.send(200, {"ok": True})
        if name == "invite":
            st, x = A.redeem_invite(body.get("code"), body.get("password"), ip)
            if st != "ok":
                return self.send(400, {"error": x})
            self.set_session_cookie(*A.new_session(x, ip, ua))
            return self.send(200, {"ok": True})
        if name == "password":
            found = A.session(token)
            if not found:
                return self.send(401, {"error": "signin"})
            s, u = found
            if not hmac.compare_digest(self.hdr("X-CSRF-Token").encode(), s["csrf"].encode()):
                return self.send(403, {"error": "Please refresh the page, then try again."})
            err = A.change_password(u, body.get("old"), body.get("new"), ip)
            if err:
                return self.send(400, {"error": err})
            tok, age = A.new_session(u, ip, ua, remember=s.get("remember"))
            self.set_session_cookie(tok, age)
            return self.send(200, {"ok": True, "csrf": A.session(tok)[0]["csrf"]})
        return self.send(404, {"error": "not found"})

    # ----- the admin's page (multi mode, admins only: checked before this is called) -----
    def link_base(self):
        if PUBLIC_URL:
            return PUBLIC_URL + "/"
        name, port = self.host_parts()
        path = (self.path or "/").split("?", 1)[0]
        prefix = path.split("/api/", 1)[0] + "/"
        return "%s://%s%s%s" % ("https" if self.is_https() else "http", name, ":%d" % port if port else "", prefix)

    def secret_reply(self, u, secret, how):
        out = {"user": ACCOUNTS.public(u)}
        if how == "link":
            out.update(link=self.link_base() + "login#invite=" + secret, days=auth.INVITE_DAYS)
        else:
            out["password"] = secret
        return out

    def admin_api(self, method, name, q):
        A, ip, me = ACCOUNTS, self.client_ip(), self.user
        if method == "GET":
            if name == "users":
                return self.send(200, {"users": A.list_users(), "me": me["id"]})
            if name == "events":
                try:
                    n = max(1, min(1000, int((q.get("n") or ["200"])[0])))
                except ValueError:
                    n = 200
                return self.send(200, {"events": A.events(n)})
            if name == "info":
                try:
                    free = shutil.disk_usage(DATA_ROOT).free
                except OSError:
                    free = None
                return self.send(200, {"version": app_version(), "https": self.is_https(), "warn_plain": self.plain_from_outside(),
                                       "your_ip": self.client_ip(), "trusted_proxy": bool(TRUSTED_PROXY), "public_url": PUBLIC_URL,
                                       "offline": OFFLINE_WHO, "disk_free": free, "data_folder": DATA_ROOT,
                                       "session_hours": A.session_s // 3600, "remember_days": A.remember_s // 86400})
            return self.send(404, {"error": "not found"})
        if method != "POST":
            return self.send(405, {"error": "not allowed"})
        body = self.read_json(65_536, required=False)
        if body is None:
            return
        how = "link" if body.get("how") == "link" else "temp"
        try:
            if name == "users":
                u, secret = A.create_user(body.get("username"), body.get("name"), body.get("role") or "user", how, me, ip)
                return self.send(200, self.secret_reply(u, secret, how))
            m = re.fullmatch(r"users/([0-9a-f]{16})/(disable|enable|reset|role|rename|delete)", name)
            if not m:
                return self.send(404, {"error": "not found"})
            uid, act = m.groups()
            if act in ("disable", "enable"):
                u = A.set_active(uid, act == "enable", me, ip)
            elif act == "role":
                u = A.set_role(uid, body.get("role"), me, ip)
            elif act == "rename":
                u = A.rename(uid, body.get("name"), me, ip)
            elif act == "reset":
                u, secret = A.reset(uid, how, me, ip)
                return self.send(200, self.secret_reply(u, secret, how))
            else:
                u, kept = A.delete(uid, body.get("confirm"), me, ip)
                with LOCK:
                    _stores.pop(uid, None)
                offline.delete_owned(uid)
                return self.send(200, {"ok": True, "kept": os.path.relpath(kept, DATA_ROOT) if kept else None})
            return self.send(200, {"user": A.public(u)})
        except LookupError as e:
            return self.send(404, {"error": str(e)})
        except ValueError as e:
            return self.send(400, {"error": str(e)})


class Server(ThreadingHTTPServer):
    """A thread per connection, but no more than max_conn at once (the rest are turned away)."""
    daemon_threads = True
    request_queue_size = 64
    allow_reuse_address = os.name != "nt"   # on Windows this would let two servers share one port without a word

    def __init__(self, addr, handler, max_conn=200):
        self._slots = threading.BoundedSemaphore(max_conn)
        super().__init__(addr, handler)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


def start_message():
    if not MULTI:
        if PASS:
            return "login on"
        if not LOCAL_ONLY:
            sys.stderr.write("NOTE: anyone who can reach this computer can open Fence Builder and your data. "
                             "For a shared server use FENCE_MODE=multi (see README.md).\n")
        return "single user"
    if os.environ.get("FENCE_PASS"):
        sys.stderr.write("NOTE: FENCE_PASS is not used in multi mode. Everyone signs in with their own account.\n")
    u = ACCOUNTS.bootstrap_from_env(env("FENCE_ADMIN_USER"), os.environ.get("FENCE_ADMIN_PASSWORD", ""))
    if u:
        print("Made the first admin, %s, from FENCE_ADMIN_USER. Sign in and pick a new password." % u["username"])
    if ACCOUNTS.needs_setup():
        code = ACCOUNTS.new_setup_code()
        bar = "=" * 64
        print("\n%s\n  FIRST-TIME SETUP\n  Open Fence Builder in a web browser and type this setup code:\n\n      %s\n\n"
              "  It makes the first admin account. It works until someone uses it,\n"
              "  and a new one is made each time the server starts.\n%s\n" % (bar, code, bar), flush=True)
    return "accounts on, %d account%s" % (len(ACCOUNTS.db["users"]), "" if len(ACCOUNTS.db["users"]) == 1 else "s")


if __name__ == "__main__":
    if MULTI:
        os.umask(0o077)   # everything the server writes (accounts, data, backups) is readable only by its own user
        try:
            os.makedirs(os.path.join(DATA_ROOT, "users"), exist_ok=True)
            probe = os.path.join(DATA_ROOT, ".write-test")
            with open(probe, "w") as f:
                f.write("ok")
            os.remove(probe)
        except OSError as e:
            raise SystemExit("Fence Builder can't write to its data folder %s (%s). In Docker, check the volume "
                             "is owned by the server's user (see README.md)." % (DATA_ROOT, e))
    note = start_message()
    srv = Server((HOST, PORT), Handler)
    print("Fence Builder %s on http://%s:%d  (%s mode, %s; data: %s)" % (app_version(), HOST, PORT, MODE, note,
                                                                          DATA_ROOT if MULTI else DATA), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
