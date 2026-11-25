#!/usr/bin/env python3
"""Fence Builder as a Windows app.

Starts the same server the website uses and opens it in its own window (Microsoft Edge or
Chrome in "app" mode: no address bar, no tabs, its own taskbar icon). Close the window and
the app stops. It reads and writes the same data file as the website, so both show the same
jobs, fence types and prices.

Run it with:  pyw app.py     (or double-click the "Fence Builder" shortcut)
"""
import importlib, json, os, shutil, socket, subprocess, sys, threading, time, urllib.request, webbrowser
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
os.chdir(ROOT)
if sys.stderr is None:  # pythonw has no console; the server logs to stderr
    sys.stderr = open(os.devnull, "w")
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
import server  # noqa: E402


def already_running(port):
    """True if a Fence Builder server is already answering on this port (for example the website)."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/rev" % port, timeout=1.5) as r:
            return "rev" in json.loads(r.read())
    except Exception:
        return False


def port_free(port):
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def find_browser():
    env = os.environ
    places = [
        os.path.join(env.get("ProgramFiles(x86)", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(env.get("ProgramFiles", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(env.get("ProgramFiles", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(env.get("ProgramFiles(x86)", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(env.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
    ]
    for p in places:
        if p and os.path.isfile(p):
            return p
    return shutil.which("msedge") or shutil.which("chrome")


def main():
    port = server.PORT
    srv = None
    if already_running(port):
        pass  # the website's server is up: just open a window onto it
    else:
        if not port_free(port):
            with socket.socket() as s:  # something else has that port: take any free one
                s.bind(("127.0.0.1", 0))
                port = s.getsockname()[1]
        state = {}

        def start():
            state["srv"] = ThreadingHTTPServer((server.HOST, port), server.Handler)
            threading.Thread(target=state["srv"].serve_forever, daemon=True).start()

        def restart():
            # after an update: stop the server, load the new code, start it again on the same port
            state["srv"].shutdown()
            state["srv"].server_close()
            importlib.reload(server)
            server.RESTART = restart
            start()

        start()
        server.RESTART = restart
        srv = True
    url = "http://localhost:%d/" % port
    browser = find_browser()
    if not browser:
        webbrowser.open(url)  # no Edge or Chrome found: fall back to the normal browser
        if srv:
            threading.Event().wait()
        return
    # its own profile folder makes the window a separate program we can wait on
    profile = os.path.join(os.environ.get("LOCALAPPDATA") or ROOT, "FenceEstimator", "window")
    os.makedirs(profile, exist_ok=True)
    win = subprocess.Popen([browser, "--app=" + url, "--user-data-dir=" + profile, "--no-first-run",
                            "--no-default-browser-check", "--window-size=1600,1000"])
    win.wait()
    # Edge and Chrome often hand the window to another process and return at once, so wait on the
    # profile's lock file instead: it exists for exactly as long as the window is open.
    lock = os.path.join(profile, "lockfile")
    t0 = time.time()
    while not os.path.exists(lock) and time.time() - t0 < 20:
        time.sleep(0.5)
    while os.path.exists(lock):
        time.sleep(1)
    if srv:
        state["srv"].shutdown()


if __name__ == "__main__":
    main()
