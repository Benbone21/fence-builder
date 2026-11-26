#!/usr/bin/env python3
"""Fence Builder as a Windows app.

Runs its own private copy of the Fence Builder server inside itself (only this computer can
reach it, and it keeps its own data, apart from any web server) and shows it in a real Windows app window (Microsoft's
WebView2, through pywebview): its own taskbar button and icon, and it pins to the taskbar like any
program. If WebView2 isn't there it falls back to Edge or Chrome in "app" mode. Close the window and
the app stops. Its jobs, prices and settings live in %LOCALAPPDATA%/Fence Builder/data.

Run it with:  pyw app.py     (or double-click the "Fence Builder" shortcut)

The Windows installer packs this file into FenceBuilder.exe with PyInstaller. An in-app update
closes the app, installs the new version and opens it again (--updated --port=N).
"""
import importlib, json, os, shutil, socket, subprocess, sys, threading, time, urllib.request, webbrowser
from http.server import ThreadingHTTPServer

ROOT = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
os.chdir(ROOT)
if sys.stderr is None:  # pythonw has no console; the server logs to stderr
    sys.stderr = open(os.devnull, "w")
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
os.environ.setdefault("FENCE_APP", "1")  # the app keeps its own data, apart from any web server
import server  # noqa: E402

if getattr(sys, "frozen", False):  # the installed app keeps a short log, to find out what went wrong if it won't open
    import logging
    try:
        _log = os.path.join(os.environ.get("LOCALAPPDATA") or ROOT, "Fence Builder", "app.log")
        os.makedirs(os.path.dirname(_log), exist_ok=True)
        if os.path.exists(_log) and os.path.getsize(_log) > 1_000_000:
            os.remove(_log)
        logging.basicConfig(filename=_log, level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
        if os.environ.get("FENCE_DEBUG"):
            logging.getLogger().setLevel(logging.DEBUG)
            for h in logging.getLogger().handlers:
                logging.getLogger("pywebview").addHandler(h)
            logging.getLogger("pywebview").setLevel(logging.DEBUG)
    except OSError:
        pass


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


APP_ID = "FenceBuilder.App"  # the installer's shortcuts carry the same id, so a pinned icon is this window


def data_home():
    return os.path.join(os.environ.get("LOCALAPPDATA") or ROOT, "Fence Builder")


def set_app_id():
    """Group the window under Fence Builder on the taskbar (its own button and icon, not Python's)."""
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass


def native_window(url):
    """A real app window. Returns False if it can't be made here (no pywebview or no WebView2)."""
    try:
        import webview
    except Exception:
        return False
    try:
        webview.settings["ALLOW_DOWNLOADS"] = True                 # Download backup
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True  # store links open in your browser
    except Exception:
        pass
    store = os.path.join(data_home(), "window")  # keeps the saved 3D ground and photos between runs
    os.makedirs(store, exist_ok=True)
    try:
        webview.create_window("Fence Builder", url, width=1600, height=1000, min_size=(1000, 640),
                              text_select=True, background_color="#16181b", maximized=True)  # fills the screen
        webview.start(gui="edgechromium", private_mode=False, storage_path=store)
        return True
    except Exception:
        import logging
        logging.getLogger("app").exception("the app window could not open")
        return False


def browser_window(url, updated):
    """The old way: Edge or Chrome in app mode, waited on until it closes."""
    browser = find_browser()
    if not browser:
        webbrowser.open(url)
        return None
    profile = os.path.join(os.environ.get("LOCALAPPDATA") or ROOT, "FenceEstimator", "window")
    os.makedirs(profile, exist_ok=True)
    lock = os.path.join(profile, "lockfile")
    if not (updated and os.path.exists(lock)):
        subprocess.Popen([browser, "--app=" + url, "--user-data-dir=" + profile, "--no-first-run",
                          "--no-default-browser-check", "--start-maximized"]).wait()
    # Edge and Chrome hand the window to another process and return at once: wait on the lock file
    t0 = time.time()
    while not os.path.exists(lock) and time.time() - t0 < 20:
        time.sleep(0.5)
    while os.path.exists(lock):
        time.sleep(1)
    return True


def arg(name):
    """--name=value from the command line ("" if not given, "1" for a bare --name)."""
    for a in sys.argv[1:]:
        if a == "--" + name:
            return "1"
        if a.startswith("--%s=" % name):
            return a.split("=", 1)[1]
    return ""


APP_PORT = 8790  # the app's own private address (not the web server's 8787), kept the same so saved 3D maps stay


def main():
    # The app always runs its own server inside itself, reachable only from this computer. It never
    # opens onto a web server that happens to be running, and it keeps its own data.
    want = int(arg("port")) if arg("port").isdigit() else APP_PORT
    updated = arg("updated") == "1"  # started by the installer after an in-app update
    port = want
    if not port_free(port):
        with socket.socket() as s:  # that port is busy (another copy of the app, or something else): take any free one
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
    state = {}

    def start():
        state["srv"] = ThreadingHTTPServer(("127.0.0.1", port), server.Handler)
        threading.Thread(target=state["srv"].serve_forever, daemon=True).start()

    def restart():
        # after an update from source: stop the server, load the new code, start it again on the same port
        state["srv"].shutdown()
        state["srv"].server_close()
        importlib.reload(server)
        server.RESTART = restart
        start()

    start()
    server.RESTART = restart
    url = "http://localhost:%d/" % port
    set_app_id()
    if not native_window(url) and browser_window(url, updated) is None:
        threading.Event().wait()  # opened in the normal browser: keep serving
    state["srv"].shutdown()


if __name__ == "__main__":
    main()
