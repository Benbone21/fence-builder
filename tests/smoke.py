#!/usr/bin/env python3
"""Smoke test for Fence Builder: start the server on an empty data folder, open the app in a
headless browser, click every page, add a job with a fence line, and check the Final bill.

    py -m pip install playwright
    py -m playwright install chromium
    py tests/smoke.py            # add --headed to watch it, --online to let the page reach the internet

Exits 0 when everything passed, 1 with a list of problems otherwise. The release workflow runs it
before building the installer. It never touches the real data: the server gets a new temp folder.

It runs twice: once the way the Windows app runs (single user, no sign-in), and once as a shared
server with accounts (FENCE_MODE=multi), signed in as a test admin. --only single|multi runs one.

It only relies on things a user sees (the page names on the tab buttons, the job name, the
"Fence length" and "Total" figures) and on the saved-data format (api/data), not on how
index.html is put together inside, so the page can be reorganised without breaking it.
"""
import argparse, json, os, re, shutil, socket, subprocess, sys, tempfile, time
import urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ["Jobs", "Builder", "Final bill", "Fence types", "Braces", "Materials", "Settings"]
JOB = "Smoke Test Job"

# console noise that is about the network, not about our code (CI internet can be flaky, and by
# default the test blocks every request to another host)
NET_NOISE = re.compile(r"Failed to load resource|net::ERR_|ERR_INTERNET|ERR_NAME|ERR_CONNECTION|"
                       r"ERR_FAILED|ERR_BLOCKED|CORS policy|Failed to fetch|NetworkError|Load failed|"
                       r"AbortError|signal is aborted|timed? ?out", re.I)



def launch_browser(pw, **kw):
    """Playwright's own Chromium, or the installed Microsoft Edge when Playwright's browser isn't downloaded."""
    try:
        return pw.chromium.launch(**kw)
    except Exception as e:
        if "Executable doesn't exist" not in str(e) and "playwright install" not in str(e):
            raise
        print("  (Playwright's Chromium is not installed here: using Microsoft Edge)")
        return pw.chromium.launch(channel="msedge", args=["--no-proxy-server"], **kw)

def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


SIGNED_IN = {}   # multi mode: the test admin's cookie and safety token, sent with every request


def http(base, path, method="GET", body=None, headers=None, timeout=20):
    h = dict(headers or {})
    if SIGNED_IN:
        h["Cookie"] = SIGNED_IN["cookie"]
        if method != "GET":
            h.update({"X-CSRF-Token": SIGNED_IN["csrf"], "Origin": base})
    req = urllib.request.Request(base + path, method=method, data=body, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def wait_for_server(base, proc, seconds=60):
    end = time.time() + seconds
    while time.time() < end:
        if proc.poll() is not None:
            raise RuntimeError("server.py exited early with code %s" % proc.returncode)
        try:
            st, body = http(base, "/api/health", timeout=15)
            if st == 200 and json.loads(body).get("ok"):
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise RuntimeError("server did not answer /api/health within %ds" % seconds)


def sign_in(base):
    """Multi mode: sign in as the test admin made from FENCE_ADMIN_USER, and pick the new password it asks for."""
    def post(path, body, extra=None):
        h = {"Content-Type": "application/json", "Origin": base, **(extra or {})}
        req = urllib.request.Request(base + path, method="POST", data=json.dumps(body).encode(), headers=h)
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.headers.get_all("Set-Cookie") or [], json.loads(r.read())

    def cookie_of(lines):
        return next(c.split(";", 1)[0] for c in lines if c.startswith("fb_session="))

    def me(cookie):
        req = urllib.request.Request(base + "/api/auth/me", headers={"Cookie": cookie})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())["csrf"]

    lines, j = post("/api/auth/login", {"username": "smoke", "password": "smoke test first password"})
    cookie = cookie_of(lines)
    if j.get("must_change"):
        lines, _ = post("/api/auth/password", {"old": "smoke test first password", "new": "smoke test real password"},
                        {"Cookie": cookie, "X-CSRF-Token": me(cookie)})
        cookie = cookie_of(lines)
    SIGNED_IN.update(cookie=cookie, csrf=me(cookie))


def add_job(base):
    """Add a job with one fence line straight through the saved-data API, like another window would."""
    st, raw = http(base, "/api/data")
    data = json.loads(raw or b"{}")
    if not data.get("materials"):
        # nothing saved yet: start from the setup that ships with the app, as the page does
        data = {**json.loads(http(base, "/seed.json")[1]), **{k: v for k, v in data.items() if k == "rev"}}
    types = data.get("fenceTypes") or []
    if not types:
        raise RuntimeError("the saved data / seed.json has no fence types")
    rev = data.get("rev") or 0
    # a straight fence about 0.002 degrees of latitude long (roughly 730 ft), 3 points
    lat, lng = 43.6, -116.6
    pts = [{"lat": lat + d, "lng": lng, "brace": None} for d in (0.0, 0.001, 0.002)]
    job = {"id": "p_smoke", "name": JOB, "stage": "bid", "log": [],
           "lines": [{"id": "l_smoke", "name": "Fence 1", "type": types[0]["id"], "pts": pts}]}
    data["projects"] = [p for p in (data.get("projects") or []) if p.get("id") != job["id"]] + [job]
    data["cur"] = job["id"]
    st, _ = http(base, "/api/data", "PUT", json.dumps(data).encode(),
                 {"Content-Type": "application/json", "X-Base-Rev": str(rev)})
    if st != 200:
        raise RuntimeError("saving the test job answered %s" % st)


def run(args, multi=False):
    from playwright.sync_api import sync_playwright, Error as PwError

    problems = []
    SIGNED_IN.clear()
    tmp = tempfile.mkdtemp(prefix="fence-smoke-")
    port = free_port()
    base = "http://127.0.0.1:%d" % port
    env = dict(os.environ, FENCE_DATA=os.path.join(tmp, "data", "fence-data.json"), PORT=str(port),
               HOST="127.0.0.1", PYTHONUNBUFFERED="1")
    for k in ("FENCE_PASS", "FENCE_APP", "FENCE_MODE", "FENCE_ADMIN_USER", "FENCE_ADMIN_PASSWORD"):
        env.pop(k, None)
    env["FENCE_MODE"] = "multi" if multi else "single"
    if multi:
        env.update(FENCE_ADMIN_USER="smoke", FENCE_ADMIN_PASSWORD="smoke test first password")
    log = open(os.path.join(tmp, "server.log"), "w", encoding="utf-8")
    proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py")], cwd=tmp, env=env,
                            stdout=log, stderr=subprocess.STDOUT)
    try:
        wait_for_server(base, proc)
        print("server up on", base, "data in", tmp, "(%s)" % env["FENCE_MODE"])
        if multi:
            sign_in(base)
        with sync_playwright() as pw:
            browser = launch_browser(pw, headless=not args.headed)
            ctx = browser.new_context(viewport={"width": 1400, "height": 900}, service_workers="block")
            if multi:
                k, _, v = SIGNED_IN["cookie"].partition("=")
                ctx.add_cookies([{"name": k, "value": v, "url": base + "/"}])
            if not args.online:
                ctx.route(re.compile(r"^(?!%s)" % re.escape(base)), lambda route: route.abort())
            page = ctx.new_page()
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda e: errors.append("JS exception: %s" % e))

            def on_console(m):
                if m.type != "error" or NET_NOISE.search(m.text or ""):
                    return
                src = (m.location or {}).get("url") or ""
                if src and not src.startswith(base):
                    return   # an error inside some other site's script
                errors.append("console error: %s%s" % (m.text, " (%s)" % src if src else ""))
            page.on("console", on_console)

            def tab(name):
                """The page button with exactly this text, preferring the ones in a tab bar."""
                exact = re.compile(r"^\s*%s\s*$" % re.escape(name), re.I)
                for loc in (page.get_by_role("navigation").get_by_role("button", name=exact),
                            page.get_by_role("tab", name=exact),
                            page.get_by_role("button", name=exact),
                            page.get_by_role("link", name=exact)):
                    loc = loc.filter(visible=True)
                    if loc.count():
                        return loc.first
                return None

            def visible_text():
                return page.evaluate("() => document.body.innerText || ''")

            def settle():
                try:
                    page.wait_for_load_state("networkidle", timeout=5000)
                except PwError:
                    pass
                page.wait_for_timeout(400)

            def check_pages(label):
                for name in PAGES:
                    b = tab(name)
                    if b is None:
                        problems.append("%s: no button for the %r page" % (label, name))
                        continue
                    before = len(errors)
                    b.click()
                    settle()
                    txt = visible_text()
                    words = re.sub(r"\s+", " ", txt).strip()
                    if len(words) < 200:
                        problems.append("%s: the %r page looks empty (%d characters of text)" % (label, name, len(words)))
                    for bad in ("NaN", "undefined", "[object Object]"):
                        if re.search(r"(?<![\w-])%s(?![\w-])" % re.escape(bad), txt):
                            problems.append("%s: the %r page shows %r" % (label, name, bad))
                    for e in errors[before:]:
                        problems.append("%s, %r page: %s" % (label, name, e))
                    print("  %-12s ok, %d characters" % (name, len(words)) if len(errors) == before else "  %-12s had errors" % name)

            # 1. fresh install: empty data folder
            print("fresh start, every page:")
            page.goto(base + "/")
            page.wait_for_load_state("load")
            settle()
            for e in errors:
                problems.append("opening the app: %s" % e)
            errors.clear()
            check_pages("fresh start")
            page.wait_for_timeout(1200)   # let any save the page makes land first

            # 2. a job with a fence line, then the Final bill
            add_job(base)
            errors.clear()
            page.reload()
            page.wait_for_load_state("load")
            settle()
            print("with a job:")
            check_pages("with a job")

            b = tab("Jobs")
            if b:
                b.click()
                settle()
                if JOB not in visible_text():
                    problems.append("the Jobs page does not show the test job %r" % JOB)
            b = tab("Final bill")
            if b:
                b.click()
                settle()
                txt = visible_text()
                if JOB not in txt:
                    problems.append("the Final bill does not name the test job %r" % JOB)
                ft = re.search(r"Fence length\s*([\d,]+)\s*ft", txt)
                tot = [float(x.replace(",", "")) for x in re.findall(r"Total\s*\$\s*([\d,]+(?:\.\d+)?)", txt)]
                if not ft or int(ft.group(1).replace(",", "")) <= 0:
                    problems.append("the Final bill shows no fence length (found %r)" % (ft.group(0) if ft else None))
                else:
                    print("  Final bill fence length:", ft.group(1), "ft")
                if not tot or max(tot) <= 0:
                    problems.append("the Final bill shows no total above $0 (found %r)" % tot)
                else:
                    print("  Final bill total: $%.2f" % max(tot))
                if "The ground" not in txt:
                    problems.append("the Final bill has no 'The ground' part (soil, water, trees)")
            for e in errors:
                problems.append("Final bill check: %s" % e)
            errors.clear()

            # 3. the ground along a fence line (soil, water, trees): the line's page shows it, and it stays calm
            # when the outside map services can't be reached (they are blocked here unless --online)
            b = tab("Builder")
            if b:
                b.click()
                settle()
                page.locator("#side").get_by_text("Fence 1", exact=True).first.click()
                settle()
                if "Ground along this fence" not in visible_text():
                    problems.append("a fence line's page has no 'Ground along this fence' part")
                else:
                    print("  fence line page: ground part shown")
            for e in errors:
                problems.append("ground check: %s" % e)
            try:
                http(base, "/api/ground/soil", "POST", b'{"pts": [[43.6, -116.6]]}', {"Content-Type": "application/json"})
                problems.append("api/ground/soil took a line with one point")
            except urllib.error.HTTPError as e:
                if e.code != 400:
                    problems.append("api/ground/soil answered %s to a bad line, not 400" % e.code)
            if problems and args.shot:
                page.screenshot(path=args.shot, full_page=True)
            browser.close()
    except Exception as e:  # anything unexpected is a failure too
        problems.append("%s: %s" % (type(e).__name__, e))
    finally:
        if proc.poll() is None:
            proc.kill()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                pass
        log.close()
        if problems:
            try:
                with open(os.path.join(tmp, "server.log"), encoding="utf-8", errors="replace") as f:
                    tail = f.read()[-3000:]
                if tail.strip():
                    print("---- server output ----\n" + tail)
            except OSError:
                pass
        shutil.rmtree(tmp, ignore_errors=True)
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    ap.add_argument("--online", action="store_true", help="let the page reach other sites (maps, LiDAR)")
    ap.add_argument("--shot", help="save a screenshot here when something fails")
    ap.add_argument("--only", choices=("single", "multi"), help="run only one of the two ways")
    args = ap.parse_args()
    try:
        import playwright  # noqa: F401
    except ImportError:
        print("SMOKE TEST FAILED: Playwright is not installed. Run:\n"
              "  py -m pip install playwright\n  py -m playwright install chromium")
        return 1
    problems = []
    for mode in ("single", "multi"):
        if args.only in (None, mode):
            print("==== %s ====" % ("single user, no sign-in (the Windows app)" if mode == "single" else "shared server with accounts"))
            problems += ["%s: %s" % (mode, p) for p in run(args, multi=mode == "multi")]
    if problems:
        print("\nSMOKE TEST FAILED (%d problem%s):" % (len(problems), "" if len(problems) == 1 else "s"))
        for p in problems:
            print("  - " + p)
        return 1
    print("\nSMOKE TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
