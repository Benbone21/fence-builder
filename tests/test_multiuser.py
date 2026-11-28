#!/usr/bin/env python3
"""Security and accounts test for Fence Builder's shared (multi-user) server, plus the single-user mode
the Windows app uses.

    py tests/test_multiuser.py           # add --no-browser to skip the part that opens a hidden browser

It starts server.py on new temp folders (never the real data), signs people in and out, and checks that:
nobody gets in without signing in, wrong passwords are refused and then locked out, one person can't read
or change another's data, people who are not admins can't use the admin page, requests from other websites
are refused, a turned-off account's sign-in stops working at once, files outside the app can't be read,
the self-update can't be used on a shared server, and the single-user mode still works with no sign-in.
Exits 0 when everything passed, 1 with a list of problems otherwise. The release workflow runs it.
"""
import argparse, gzip, http.client, json, os, re, shutil, socket, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
problems = []
passed = 0



def launch_browser(pw, **kw):
    """Playwright's own Chromium, or the installed Microsoft Edge when Playwright's browser isn't downloaded."""
    try:
        return pw.chromium.launch(**kw)
    except Exception as e:
        if "Executable doesn't exist" not in str(e) and "playwright install" not in str(e):
            raise
        print("  (Playwright's Chromium is not installed here: using Microsoft Edge)")
        return pw.chromium.launch(channel="msedge", args=["--no-proxy-server"], **kw)

def check(ok, what):
    global passed
    if ok:
        passed += 1
    else:
        problems.append(what)
        print("  FAILED: " + what)
    return ok


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    def __init__(self, extra_env, legacy=None):
        self.tmp = tempfile.mkdtemp(prefix="fence-mu-")
        self.data = os.path.join(self.tmp, "data")
        os.makedirs(self.data)
        if legacy is not None:
            with open(os.path.join(self.data, "fence-data.json"), "w", encoding="utf-8") as f:
                json.dump(legacy, f)
        self.port = free_port()
        env = dict(os.environ, FENCE_DATA=os.path.join(self.data, "fence-data.json"), PORT=str(self.port),
                   HOST="127.0.0.1", PYTHONUNBUFFERED="1")
        for k in ("FENCE_PASS", "FENCE_APP", "FENCE_MODE", "FENCE_ADMIN_USER", "FENCE_ADMIN_PASSWORD",
                  "FENCE_TRUSTED_PROXY", "FENCE_HTTPS", "FENCE_ALLOWED_HOSTS", "FENCE_PUBLIC_URL"):
            env.pop(k, None)
        env.update(extra_env)
        self.logf = os.path.join(self.tmp, "server.log")
        self.log = open(self.logf, "w", encoding="utf-8")
        self.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py")], cwd=self.tmp, env=env,
                                     stdout=self.log, stderr=subprocess.STDOUT)
        end = time.time() + 40
        while time.time() < end:
            if self.proc.poll() is not None:
                raise RuntimeError("server.py exited early:\n" + self.output())
            try:
                if self.req("GET", "/api/health")[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.3)
        raise RuntimeError("the server did not start")

    def output(self):
        self.log.flush()
        with open(self.logf, encoding="utf-8", errors="replace") as f:
            return f.read()

    def req(self, method, path, body=None, headers=None, cookie=None, raw=False):
        """(status, headers dict (lower-case names, Set-Cookie as a list), body bytes)"""
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"Host": "127.0.0.1:%d" % self.port}
        if method not in ("GET", "HEAD"):
            h["Origin"] = "http://127.0.0.1:%d" % self.port
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        if cookie:
            h["Cookie"] = cookie
        h.update(headers or {})
        h = {k: v for k, v in h.items() if v is not None}
        if raw:
            c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            for k, v in h.items():
                c.putheader(k, v)
            c.endheaders(body)
        else:
            c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        hd = {}
        for k, v in r.getheaders():
            if k.lower() == "set-cookie":
                hd.setdefault("set-cookie", []).append(v)
            else:
                hd[k.lower()] = v
        c.close()
        return r.status, hd, data

    def stop(self):
        if self.proc.poll() is None:
            self.proc.kill()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                pass
        self.log.close()
        shutil.rmtree(self.tmp, ignore_errors=True)


class Person:
    """One browser: its sign-in cookie and safety token."""

    def __init__(self, srv):
        self.srv, self.cookie, self.csrf = srv, None, ""

    def take_cookie(self, hd):
        for c in hd.get("set-cookie", []):
            k, _, rest = c.partition("=")
            v = rest.split(";", 1)[0]
            self.cookie = "%s=%s" % (k, v) if v else None
        return self

    def call(self, method, path, body=None, headers=None, csrf=True):
        h = dict(headers or {})
        if csrf and method not in ("GET", "HEAD") and self.csrf:
            h.setdefault("X-CSRF-Token", self.csrf)
        st, hd, data = self.srv.req(method, path, body, h, self.cookie)
        self.take_cookie(hd) if hd.get("set-cookie") else None
        try:
            j = json.loads(data) if data else None
        except ValueError:
            j = None
        return st, j, hd, data

    def login(self, username, password, remember=False):
        st, j, hd, _ = self.call("POST", "/api/auth/login", {"username": username, "password": password, "remember": remember})
        if st == 200:
            self.refresh()
        return st, j, hd

    def refresh(self):
        st, j, _, _ = self.call("GET", "/api/auth/me")
        self.csrf = (j or {}).get("csrf", "") if st == 200 else ""
        return st, j


def job(name):
    return {"id": "p_" + re.sub(r"\W", "", name.lower()), "name": name, "stage": "bid", "lines": [], "log": []}


def put_data(p, data, base):
    return p.call("PUT", "/api/data", data, {"X-Base-Rev": str(base)})


def test_multi(args):
    legacy = {"materials": [{"id": "m1", "name": "Old wire", "price": 10}], "fenceTypes": [], "projects": [job("Legacy Ranch Job")], "rev": 7}
    srv = Server({"FENCE_MODE": "multi"}, legacy=legacy)
    try:
        print("multi mode: before anyone signs in")
        anon = Person(srv)
        st, hd, _ = srv.req("GET", "/")
        check(st == 302 and hd.get("location", "").endswith("login"), "opening the app without signing in should go to the sign-in page (got %s)" % st)
        for path in ("/api/data", "/api/rev", "/api/admin/users", "/api/off/areas", "/api/price?url=https://example.com",
                     "/api/store?host=www.dbsupply.com&op=cats", "/api/geocode?q=boise", "/api/version", "/app.js", "/view3d.js", "/admin"):
            st, _, _ = srv.req("GET", path)
            check(st in (401, 302), "GET %s without signing in should be refused (got %s)" % (path, st))
        for method, path in (("PUT", "/api/data"), ("POST", "/api/update"), ("PUT", "/api/seed"), ("POST", "/api/off/areas"),
                             ("POST", "/api/admin/users")):
            st, _, _ = srv.req(method, path, {"x": 1})
            check(st in (401, 403, 404), "%s %s without signing in should be refused (got %s)" % (method, path, st))
        st, hd, body = srv.req("GET", "/login")
        check(st == 200 and b"Sign in" in body, "the sign-in page should open without signing in")
        csp = hd.get("content-security-policy", "")
        check("frame-ancestors 'none'" in csp and "script-src 'self'" in csp and "unsafe-eval" not in csp and "'unsafe-inline'" not in csp.split("style-src")[0],
              "the Content-Security-Policy should allow scripts only from the server (got %r)" % csp)
        check(hd.get("x-content-type-options") == "nosniff" and hd.get("x-frame-options") == "DENY" and "referrer-policy" in hd,
              "security headers should be sent")
        st, j, _, _ = anon.call("GET", "/api/auth/status")
        check(st == 200 and j.get("setup") is True and j.get("mode") == "multi", "status should say setup is needed")

        print("multi mode: first admin from the setup code")
        m = re.search(r"^\s+([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})\s*$", srv.output(), re.M)
        if not check(m is not None, "the setup code should be printed to the server log"):
            return
        code = m.group(1)
        admin = Person(srv)
        st, _, _, _ = admin.call("POST", "/api/auth/setup", {"code": "AAAA-BBBB-CCCC", "name": "Ben", "username": "ben", "password": "a good long password"})
        check(st == 401, "a wrong setup code should be refused (got %s)" % st)
        st, _, _, _ = admin.call("POST", "/api/auth/setup", {"code": code, "name": "Ben", "username": "ben", "password": "short"})
        check(st == 400, "a short password should be refused (got %s)" % st)
        st, _, hd, _ = admin.call("POST", "/api/auth/setup", {"code": code.lower(), "name": "Ben", "username": "ben", "password": "red barn by the creek"})
        check(st == 200 and admin.cookie, "the right setup code should make the first admin (got %s)" % st)
        cookie_line = " ".join(hd.get("set-cookie", []))
        check("HttpOnly" in cookie_line and "SameSite=Strict" in cookie_line and "Secure" not in cookie_line,
              "the sign-in cookie should be HttpOnly and SameSite=Strict (and not Secure over plain http): %r" % cookie_line)
        admin.refresh()
        st, _, _, _ = Person(srv).call("POST", "/api/auth/setup", {"code": code, "name": "X", "username": "x", "password": "another long password"})
        check(st == 409, "setup should not work a second time (got %s)" % st)

        st, j, _, _ = admin.call("GET", "/api/data")
        check(st == 200 and any(p["name"] == "Legacy Ranch Job" for p in (j or {}).get("projects", [])),
              "the data from before accounts should move into the first admin's account")
        check(not os.path.exists(os.path.join(srv.data, "fence-data.json")) and
              any(f.startswith("fence-data.json.moved-to-") for f in os.listdir(srv.data)), "the old data file should be kept under a new name")

        print("multi mode: adding people")
        st, j, _, _ = admin.call("POST", "/api/admin/users", {"name": "Maria", "username": "maria", "role": "user", "how": "temp"})
        check(st == 200 and j.get("password"), "the admin should be able to add a person with a temporary password")
        maria_temp, maria_id = (j or {}).get("password"), ((j or {}).get("user") or {}).get("id")
        st, j, _, _ = admin.call("POST", "/api/admin/users", {"name": "Carl", "username": "carl", "role": "user", "how": "link"})
        check(st == 200 and "/login#invite=" in (j or {}).get("link", ""), "the admin should be able to add a person with a one-time link")
        carl_link, carl_id = (j or {}).get("link", ""), ((j or {}).get("user") or {}).get("id")
        st, j, _, _ = admin.call("POST", "/api/admin/users", {"name": "Dee", "username": "dee", "role": "user", "how": "temp"})
        dee_temp = (j or {}).get("password")
        st, _, _, _ = admin.call("POST", "/api/admin/users", {"name": "Maria 2", "username": "MARIA", "role": "user"})
        check(st == 400, "two accounts can't have the same user name (got %s)" % st)

        maria = Person(srv)
        st, j, _ = maria.login("maria", maria_temp)
        check(st == 200 and j.get("must_change") is True, "a temporary password should sign in and ask for a new password")
        st, j, _, _ = maria.call("GET", "/api/data")
        check(st == 403 and (j or {}).get("error") == "change_password", "nothing should work before the temporary password is changed (got %s)" % st)
        st, _, _, _ = maria.call("POST", "/api/auth/password", {"old": maria_temp, "new": "maria's own fence password"})
        check(st == 200, "changing the temporary password should work (got %s)" % st)
        maria.refresh()

        print("multi mode: each person's data is their own")
        st, j, _, _ = maria.call("GET", "/api/data")
        check(st == 200 and not (j or {}).get("projects"), "a new account should start with no jobs")
        mdata = {"materials": [], "fenceTypes": [], "projects": [job("Maria Secret Job")]}
        st, j, _, _ = put_data(maria, mdata, 0)
        check(st == 200 and j.get("rev") == 1, "a person should be able to save their own data (got %s)" % st)
        st, j, _, _ = admin.call("GET", "/api/data")
        names = [p["name"] for p in (j or {}).get("projects", [])]
        check("Maria Secret Job" not in names and "Legacy Ranch Job" in names, "the admin's data must not show another person's jobs")
        st, j, _, _ = maria.call("GET", "/api/data")
        check("Legacy Ranch Job" not in json.dumps(j), "a person must not see another person's jobs")
        admin_id = admin.refresh()[1]["user"]["id"]
        for path in ("/api/data?user=%s" % admin_id, "/api/data?uid=%s" % admin_id, "/api/users/%s/data" % admin_id):
            st, j, _, _ = maria.call("GET", path)
            check("Legacy Ranch Job" not in json.dumps(j or {}), "%s must not give another person's data" % path)
        st, j, _, _ = maria.call("GET", "/api/data", headers={"X-User": admin_id, "X-User-Id": admin_id})
        check("Legacy Ranch Job" not in json.dumps(j or {}), "headers must not switch whose data is read")
        st, j, _, _ = admin.call("GET", "/api/rev")
        check(st == 200 and j.get("rev") == 7, "each person has their own version number (admin %s)" % (j or {}).get("rev"))

        print("multi mode: compressed saves and the starting setup")
        st, j, _, _ = admin.call("GET", "/api/data")
        j["projects"].append(job("Packed Job"))
        st, r, _, _ = admin.call("PUT", "/api/data", gzip.compress(json.dumps(j).encode()),
                                 {"X-Base-Rev": "7", "Content-Encoding": "gzip", "Content-Type": "application/json"})
        check(st == 200 and r.get("rev") == 8, "a compressed save should work (got %s)" % st)
        st, j, _, _ = admin.call("GET", "/api/data")
        check("Packed Job" in json.dumps(j), "a compressed save should be readable afterwards")
        bomb = gzip.compress(b" " * 40_000_000)
        st, _, _, _ = admin.call("PUT", "/api/data", bomb, {"X-Base-Rev": "8", "Content-Encoding": "gzip", "Content-Type": "application/json"})
        check(st in (400, 413), "a small upload that unpacks to something huge should be refused (got %s)" % st)
        seed = {"materials": [{"id": "ms", "name": "Seed wire"}], "fenceTypes": [{"id": "fs", "name": "Seed fence"}], "braces": [],
                "settings": {"tax": 6, "biz": {"name": "Ben's Fencing", "phone": "555-0100"}, "crew": [{"name": "Joe", "wage": 20}]}}
        st, _, _, _ = admin.call("PUT", "/api/seed", seed)
        check(st == 200, "an admin should be able to save the starting setup for new accounts (got %s)" % st)
        st, hd, body = srv.req("GET", "/seed.json", cookie=maria.cookie)
        check(st == 200 and b"Seed wire" in body and b"Ben's Fencing" not in body and b"Joe" not in body and b'"tax": 6' in body,
              "new accounts should get the starting setup without the admin's business details and crew")
        check(not os.path.exists(os.path.join(ROOT, "static", "seed.json.tmp")) and b"Seed wire" not in open(os.path.join(ROOT, "static", "seed.json"), "rb").read(),
              "a shared server must not change the app's own seed.json")

        print("multi mode: admin-only things")
        for method, path, body in (("GET", "/api/admin/users", None), ("GET", "/api/admin/events", None), ("GET", "/api/admin/info", None),
                                   ("POST", "/api/admin/users", {"name": "Evil", "username": "evil"}),
                                   ("POST", "/api/admin/users/%s/disable" % admin_id, {}),
                                   ("POST", "/api/admin/users/%s/reset" % admin_id, {}),
                                   ("PUT", "/api/seed", {"materials": [], "fenceTypes": []})):
            st, _, _, _ = maria.call(method, path, body)
            check(st == 403, "someone who is not an admin must not use %s %s (got %s)" % (method, path, st))
        st, hd, _ = srv.req("GET", "/admin", cookie=maria.cookie)
        check(st == 302, "the accounts page should send people who are not admins back to the app (got %s)" % st)
        st, _, _, _ = maria.call("POST", "/api/update", {})
        check(st == 404, "the self-update must not exist on a shared server (got %s)" % st)
        st, _, _, _ = admin.call("POST", "/api/update", {})
        check(st == 404, "the self-update must not exist on a shared server, even for admins (got %s)" % st)
        st, j, _, _ = maria.call("GET", "/api/version")
        check(st == 200 and j.get("available") is False and j.get("server") is True, "the version check should never offer an install on a shared server")

        print("multi mode: requests from other websites")
        st, _, _, _ = maria.call("PUT", "/api/data", mdata, {"X-Base-Rev": "1"}, csrf=False)
        check(st == 403, "a change without the safety token should be refused (got %s)" % st)
        st, _, _, _ = maria.call("PUT", "/api/data", mdata, {"X-Base-Rev": "1", "Origin": "https://evil.example"})
        check(st == 403, "a change from another website should be refused (got %s)" % st)
        st, _, _, _ = maria.call("PUT", "/api/data", mdata, {"X-Base-Rev": "1", "Origin": None, "Referer": None})
        check(st == 403, "a change that doesn't say where it came from should be refused (got %s)" % st)
        st, _, _ = srv.req("POST", "/api/auth/login", {"username": "maria", "password": "maria's own fence password"},
                           {"Origin": "https://evil.example"})
        check(st == 403, "signing in from another website's page should be refused (got %s)" % st)
        st, _, _ = srv.req("POST", "/api/auth/login", b"username=maria&password=x", {"Content-Type": "application/x-www-form-urlencoded"})
        check(st == 415, "a sign-in sent as a plain web form should be refused (got %s)" % st)
        st, _, _ = srv.req("GET", "/api/data", headers={"Host": "evil.example"}, cookie=maria.cookie)
        check(st == 200, "(a shared server answers any host name unless FENCE_ALLOWED_HOSTS is set)")

        print("multi mode: wrong passwords")
        st1, j1, _ = Person(srv).login("dee", "not the password at all")
        st2, j2, _ = Person(srv).login("nobody-has-this-name", "not the password at all")
        check(st1 == st2 == 401 and j1 == j2, "a wrong password and an unknown user name should get the same answer (%s %s)" % (st1, st2))
        for _ in range(4):
            Person(srv).login("dee", "still not the password")
        st, j, _ = Person(srv).login("dee", dee_temp)
        check(st == 429, "after 5 wrong passwords the account should wait, even with the right one (got %s)" % st)
        st, j, _ = Person(srv).login("nobody-has-this-name", "x" * 12)
        check(st == 401, "(other names from this address are not locked yet)")
        for _ in range(16):
            Person(srv).login("someone%d" % _, "wrong password here")
        st, j, _ = Person(srv).login("maria", "maria's own fence password")
        check(st == 429, "after 20 wrong passwords from one address, that address should wait (got %s)" % st)
        # the rest of the test signs in from 'other addresses' through a trusted proxy on a second server

        print("multi mode: turning an account off, resetting, deleting")
        st, j, _, _ = admin.call("POST", "/api/admin/users/%s/disable" % maria_id, {})
        check(st == 200 and j["user"]["active"] is False, "the admin should be able to turn an account off")
        st, _, _, _ = maria.call("GET", "/api/data")
        check(st == 401, "a turned-off account's open sign-in should stop working at once (got %s)" % st)
        st, _, _, _ = admin.call("POST", "/api/admin/users/%s/disable" % admin_id, {})
        check(st == 400, "an admin can't turn off their own account (got %s)" % st)
        st, _, _, _ = admin.call("POST", "/api/admin/users/%s/role" % admin_id, {"role": "user"})
        check(st == 400, "the last admin can't stop being an admin (got %s)" % st)
        st, _, _, _ = admin.call("POST", "/api/admin/users/%s/delete" % admin_id, {"confirm": "ben"})
        check(st == 400, "an admin can't delete their own account (got %s)" % st)
        st, _, _, _ = admin.call("POST", "/api/admin/users/%s/delete" % carl_id, {"confirm": "wrong"})
        check(st == 400, "deleting needs the user name typed (got %s)" % st)
        st, j, _, _ = admin.call("POST", "/api/admin/users/%s/delete" % maria_id, {"confirm": "maria"})
        check(st == 200 and j.get("kept"), "the admin should be able to delete an account")
        kept = os.path.join(srv.data, *(j or {}).get("kept", "x").replace("\\", "/").split("/"))
        check(os.path.isfile(os.path.join(kept, "fence-data.json")) and "Maria Secret Job" in open(os.path.join(kept, "fence-data.json"), encoding="utf-8").read(),
              "a deleted account's data should be kept in deleted/")
        st, j, _, _ = admin.call("GET", "/api/admin/users")
        check(st == 200 and "maria" not in [u["username"] for u in j["users"]], "the deleted account should be gone from the list")

        print("multi mode: files outside the app")
        for path in ("/../server.py", "/..%2fserver.py", "/%2e%2e/%2e%2e/data/accounts/users.json", "/vendor/../../auth.py",
                     "/static/../server.py", "/..\\server.py", "/%2e%2e%5cserver.py", "/.git/config", "/js/../../offline.py",
                     "/" + "/".join([".."] * 6) + "/Windows/win.ini", "/C:/Windows/win.ini", "/accounts/users.json", "/users/%s/fence-data.json" % admin_id):
            st, _, body = srv.req("GET", path, cookie=admin.cookie, raw=True)
            check(b"import " not in body and b'"users"' not in body and b"[fonts]" not in body and b"Legacy Ranch" not in body,
                  "%s must not give a file outside the app (got %s)" % (path, st))

        print("multi mode: outside requests")
        for url in ("http://127.0.0.1:%d/api/health" % srv.port, "http://localhost/", "http://169.254.169.254/latest/meta-data/",
                    "http://10.0.0.1/", "http://[::1]/", "file:///etc/passwd", "https://example.com:8443/", "http://user:pw@example.com/"):
            st, j, _, _ = admin.call("GET", "/api/price?url=" + url)
            check(st == 400, "the price reader must not fetch %s (got %s)" % (url, st))
        st, _, _, _ = admin.call("GET", "/api/store?host=evil.example&op=cats")
        check(st == 400, "the store search should only ask the stores it knows (got %s)" % st)

        print("multi mode: offline areas are each person's own")
        areas = os.path.join(srv.data, "offline", "areas")
        os.makedirs(areas, exist_ok=True)
        for aid, owner in (("aaaaaaaaaa", admin_id), ("bbbbbbbbbb", None), ("cccccccccc", carl_id)):
            a = {"id": aid, "name": "Area " + aid, "bbox": [-116.6, 43.6, -116.59, 43.61], "maxz": 14, "created": time.time(), "status": "done", "dem": []}
            if owner:
                a["owner"] = owner
            json.dump(a, open(os.path.join(areas, aid + ".json"), "w"))
        st, j, _, _ = admin.call("GET", "/api/off/areas")
        ids = sorted(a["id"] for a in (j or {}).get("areas", []))
        check(ids == ["aaaaaaaaaa", "bbbbbbbbbb"] and all("owner" not in a for a in j["areas"]), "the admin sees their own areas and the ones from before accounts (%s)" % ids)

        print("multi mode: invite links")
        carl = Person(srv)
        code_c = carl_link.split("#invite=", 1)[1]
        st, _, _, _ = carl.call("POST", "/api/auth/invite", {"code": code_c, "password": "carl picks a password"})
        check(st == 200 and carl.cookie, "a one-time link should let the person pick a password and sign in (got %s)" % st)
        carl.refresh()
        st, j, _, _ = carl.call("GET", "/api/off/areas")
        check([a["id"] for a in (j or {}).get("areas", [])] == ["cccccccccc"], "a person sees only their own saved areas")
        st, _, _, _ = carl.call("POST", "/api/off/areas/aaaaaaaaaa/delete", {})
        check(st == 404 and os.path.exists(os.path.join(areas, "aaaaaaaaaa.json")), "a person can't delete someone else's saved area (got %s)" % st)
        st, _, _, _ = Person(srv).call("POST", "/api/auth/invite", {"code": code_c, "password": "someone else again"})
        check(st == 400, "a one-time link must not work twice (got %s)" % st)
        st, j, _, _ = admin.call("POST", "/api/admin/users/%s/reset" % carl_id, {"how": "temp"})
        check(st == 200 and j.get("password"), "the admin should be able to reset a password")
        st, _, _, _ = carl.call("GET", "/api/data")
        check(st == 401, "a reset password should sign the person out everywhere (got %s)" % st)

        print("multi mode: signing out, sizes, the log")
        st, _, _, _ = admin.call("PUT", "/api/data", b"x" * 100, {"Content-Length": "30000000", "Content-Type": "application/json", "X-Base-Rev": "8"})
        check(st == 413, "a save that is far too big should be refused (got %s)" % st)
        st, _, _, _ = admin.call("POST", "/api/auth/logout", {})
        check(st == 200, "signing out should work")
        st, _, _, _ = admin.call("GET", "/api/data")
        check(st == 401, "after signing out the old cookie must not work (got %s)" % st)
        audit = open(os.path.join(srv.data, "accounts", "audit.log"), encoding="utf-8").read()
        users_db = open(os.path.join(srv.data, "accounts", "users.json"), encoding="utf-8").read()
        sessions_db = open(os.path.join(srv.data, "accounts", "sessions.json"), encoding="utf-8").read()
        out = srv.output()
        for secret in ("red barn by the creek", maria_temp or "-", "maria's own fence password", code, code_c, "carl picks a password"):
            for where, text in (("security log", audit), ("users.json", users_db), ("sessions.json", sessions_db), ("server log", out)):
                if secret == code and where == "server log":
                    continue   # the setup code is printed there on purpose, for the owner to read
                check(secret not in text, "a password or code must never be written to the %s" % where)
        for ev in ("first_admin_created", "signin", "signin_failed", "user_created", "user_disabled", "user_deleted", "password_reset_by_admin", "blocked_cross_site_request"):
            check('"%s"' % ev in audit, "the security log should have %s" % ev)
        check(re.search(r'"pw": "scrypt\$32768\$8\$1\$', users_db) is not None, "passwords should be kept as scrypt hashes")
    finally:
        srv.stop()


def test_proxy():
    """A second server behind a 'reverse proxy' (this test pretends to be it): https cookies and real addresses."""
    print("multi mode behind https: cookies and addresses")
    srv = Server({"FENCE_MODE": "multi", "FENCE_ADMIN_USER": "boss", "FENCE_ADMIN_PASSWORD": "first time password here",
                  "FENCE_TRUSTED_PROXY": "127.0.0.1", "FENCE_ALLOWED_HOSTS": "fence.example.com"})
    try:
        via = {"X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.9", "Host": "fence.example.com", "Origin": "https://fence.example.com"}
        st, hd, body = srv.req("POST", "/api/auth/login", {"username": "boss", "password": "first time password here"}, via)
        j = json.loads(body)
        c = " ".join(hd.get("set-cookie", []))
        check(st == 200 and j.get("must_change") is True, "FENCE_ADMIN_USER should make the first admin, who must pick a new password (got %s)" % st)
        check(c.startswith("__Host-fb_session=") and "Secure" in c, "over https the cookie should be Secure with the __Host- prefix: %r" % c)
        check("strict-transport-security" in hd, "over https the server should send Strict-Transport-Security")
        audit = open(os.path.join(srv.data, "accounts", "audit.log"), encoding="utf-8").read()
        check('"ip": "203.0.113.9"' in audit, "the log should have the person's address from the trusted proxy")
        st, _, _ = srv.req("GET", "/api/auth/status", headers={"Host": "evil.example"})
        check(st == 421, "with FENCE_ALLOWED_HOSTS, other host names should be refused (got %s)" % st)
        st, _, body = srv.req("GET", "/api/auth/status", headers={"Host": "fence.example.com", "X-Forwarded-For": "8.8.8.8"})
        check(st == 200 and json.loads(body).get("warn_plain") is True, "plain http from outside the network should be warned about")
        st, _, body = srv.req("GET", "/api/auth/status", headers={"Host": "fence.example.com", "X-Forwarded-For": "192.168.1.30"})
        check(st == 200 and json.loads(body).get("warn_plain") is False, "plain http inside the network is fine")
    finally:
        srv.stop()


def test_single():
    print("single mode (the Windows app's way): no sign-in, only this computer")
    srv = Server({"FENCE_MODE": "single"})
    try:
        st, _, body = srv.req("GET", "/")
        check(st == 200 and b"app.js?v=" in body, "the app should open with no sign-in (got %s)" % st)
        st, _, body = srv.req("GET", "/api/auth/me")
        check(st == 200 and json.loads(body).get("mode") == "single", "the single-user mode should say so")
        st, _, _ = srv.req("PUT", "/api/data", {"materials": [], "projects": []}, {"X-Base-Rev": "0", "Origin": None})
        check(st == 200, "a script on this computer can still save (got %s)" % st)
        st, _, _ = srv.req("GET", "/api/data", headers={"Host": "evil.example:%d" % srv.port})
        check(st == 421, "another site's name pointed at this computer must be refused (DNS rebinding) (got %s)" % st)
        st, _, _ = srv.req("PUT", "/api/data", {"materials": []}, {"X-Base-Rev": "1", "Origin": "https://evil.example"})
        check(st == 403, "a change from another website must be refused (got %s)" % st)
        st, _, _ = srv.req("POST", "/api/update", b"", {"Origin": "https://evil.example"})
        check(st == 403, "another website must not start an update (got %s)" % st)
        st, hd, body = srv.req("GET", "/app.js?v=nope", headers={"Accept-Encoding": "gzip"})
        check(st == 200 and hd.get("content-encoding") == "gzip" and hd.get("etag"), "the script should be sent compressed with an ETag")
        st2, _, _ = srv.req("GET", "/app.js", headers={"If-None-Match": hd.get("etag", "")})
        check(st2 == 304, "an unchanged script should answer 304 (got %s)" % st2)
        for path in ("/../server.py", "/..%2fserver.py", "/%2e%2e/server.py"):
            st, _, body = srv.req("GET", path, raw=True)
            check(b"import " not in body, "%s must not give a file outside the app" % path)
    finally:
        srv.stop()
    srv = Server({"FENCE_MODE": "multi", "FENCE_APP": "1"})
    try:
        st, _, body = srv.req("GET", "/api/auth/me")
        check(st == 200 and json.loads(body).get("mode") == "single", "the Windows app must stay single-user even if FENCE_MODE=multi is set")
    finally:
        srv.stop()


def test_browser():
    """A fresh shared server (the one above has locked out this computer's address on purpose)."""
    srv = Server({"FENCE_MODE": "multi", "FENCE_ADMIN_USER": "boss", "FENCE_ADMIN_PASSWORD": "first time password here"})
    try:
        boss = Person(srv)
        boss.login("boss", "first time password here")
        boss.call("POST", "/api/auth/password", {"old": "first time password here", "new": "the boss password now"})
        boss.refresh()
        st, j, _, _ = boss.call("POST", "/api/admin/users", {"name": "Dee", "username": "dee", "role": "user", "how": "temp"})
        if check(st == 200, "making a test account for the browser part"):
            try:
                browser_part(srv, "boss", "the boss password now", "dee", j["password"])
            except Exception:
                print(srv.output()[-3000:])
                raise
    finally:
        srv.stop()


def browser_part(srv, admin_user, admin_pw, user, temp_pw):
    """The pages themselves in a hidden browser: signing in, the app, the accounts page, signing out."""
    from playwright.sync_api import sync_playwright
    print("multi mode in a browser")
    base = "http://127.0.0.1:%d" % srv.port
    with sync_playwright() as pw:
        b = launch_browser(pw)
        ctx = b.new_context(viewport={"width": 1400, "height": 900}, service_workers="block")
        ctx.route(re.compile(r"^(?!%s)" % re.escape(base)), lambda route: route.abort())
        page = ctx.new_page()
        page.set_default_timeout(15000)
        errors = []
        page.on("pageerror", lambda e: errors.append("JS exception: %s" % e))
        page.on("console", lambda m: m.type == "error" and ("Content Security Policy" in m.text or "Refused" in m.text) and errors.append(m.text))
        page.goto(base + "/")
        page.wait_for_selector("#fSignin:not([hidden])")
        check(page.url.endswith("/login"), "the app should send you to the sign-in page")
        page.fill("#u", user)
        page.fill("#p", temp_pw)
        page.click("#fSignin button")
        page.wait_for_selector("#fNew:not([hidden])")
        page.fill("#n1", "dee picks her own password")
        page.fill("#n2", "dee picks her own password")
        page.click("#fNew button")
        page.wait_for_selector("#tabs button")
        page.wait_for_timeout(1500)
        check(page.locator("#bMe").inner_text().strip() == "Dee", "the app should show who is signed in")
        page.click("#bMe")
        page.wait_for_timeout(500)
        txt = page.evaluate("() => document.body.innerText")
        check("Your account" in txt and "Sign out" in txt and "Manage accounts" not in txt, "Settings should have Your account (no admin button for a user)")
        check(page.evaluate("() => Object.keys(localStorage).some(k => k === 'fence-est')") is False, "a shared server must not keep jobs in the browser")
        page.goto(base + "/admin")
        page.wait_for_timeout(800)
        check(not page.url.endswith("/admin"), "the accounts page should not open for someone who is not an admin")
        page.goto(base + "/")
        page.wait_for_selector("#tabs button")
        page.click("#bMe")
        page.click("[data-act=signOut]")
        page.wait_for_selector("#fSignin:not([hidden])")
        check(page.evaluate("() => Object.keys(localStorage).filter(k => k.startsWith('fence')).length") == 0, "signing out should clear what the browser kept")
        page.fill("#u", admin_user)
        page.fill("#p", admin_pw)
        page.click("#fSignin button")
        page.wait_for_selector("#tabs button")
        page.goto(base + "/admin")
        page.wait_for_selector("table.ptable")
        txt = page.evaluate("() => document.body.innerText")
        check("Dee" in txt and "Signed in" in txt, "the accounts page should list people and sign-ins")
        page.click("#bAdd")
        page.fill("#an", "Eve")
        page.fill("#au", "eve")
        page.click("#dlg [data-a=ok]")
        page.wait_for_selector("#secret")
        check(re.fullmatch(r"[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}", page.inner_text("#secret").strip()) is not None, "adding a person should show their temporary password")
        page.click("#dlg [data-a=ok]")
        for e in errors:
            check(False, "browser: " + e)
        b.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--no-browser", dest="browser", action="store_false", help="skip the part that opens a hidden browser")
    args = ap.parse_args()
    for t in (test_single, test_proxy, lambda: test_multi(args)) + ((test_browser,) if args.browser else ()):
        try:
            t()
        except Exception as e:
            import traceback
            traceback.print_exc()
            problems.append("%s: %s" % (type(e).__name__, e))
    if problems:
        print("\nMULTI-USER TEST FAILED (%d problem%s, %d passed):" % (len(problems), "" if len(problems) == 1 else "s", passed))
        for p in problems:
            print("  - " + p)
        return 1
    print("\nMULTI-USER TEST PASSED (%d checks)" % passed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
