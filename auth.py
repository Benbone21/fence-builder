"""Accounts for the shared (multi-user) Fence Builder server: sign-in, sessions, the admin's list of
people, and a log of sign-ins and admin actions. Standard library only.

Only used when the server runs with FENCE_MODE=multi. The Windows app and a plain single-user server
never load any of this.

Files, all in <data folder>/accounts/ (readable only by the server's own user):
  users.json     the accounts: name, user name, role, and a scrypt hash of the password (never the password)
  sessions.json  who is signed in: a SHA-256 hash of each sign-in cookie (never the cookie itself)
  audit.log      one line per sign-in, sign-out and admin action (never a password, code or cookie)
Each person's jobs, prices and settings live in <data folder>/users/<their id>/fence-data.json.
"""
import base64, collections, hashlib, hmac, json, os, re, secrets, shutil, sys, threading, time, unicodedata

USER_RE = re.compile(r"[a-z0-9][a-z0-9._@-]{1,63}")
UID_RE = re.compile(r"[0-9a-f]{16}")
MIN_PW, MAX_PW = 10, 256
# a short list of passwords people pick first; the length rule rules out most of the rest
COMMON = {"password12", "password123", "password1234", "1234567890", "12345678910", "qwertyuiop", "fencebuilder",
          "fence12345", "fencing123", "letmein123", "welcome123", "iloveyou12", "abc1234567", "changeme12",
          "administrator", "qwerty12345", "0987654321", "1111111111", "passw0rd12", "fencebuilder1"}
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 15, 8, 1     # about 32 MB and a tenth of a second per try
PBKDF2_ITER = 600_000                             # only if this Python has no scrypt
_hash_slots = threading.BoundedSemaphore(4)       # at most 4 password checks at once (each uses 32 MB)
READABLE = "abcdefghjkmnpqrstuvwxyz23456789"      # no 0/o, 1/l/i: easy to read out and type
INVITE_DAYS = 7


def _b64(b):
    return base64.b64encode(b).decode()


def _pw_bytes(pw):
    return unicodedata.normalize("NFKC", pw).encode("utf-8")


def hash_password(pw):
    salt = secrets.token_bytes(16)
    with _hash_slots:
        try:
            dk = hashlib.scrypt(_pw_bytes(pw), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, maxmem=64 << 20, dklen=32)
            return "scrypt$%d$%d$%d$%s$%s" % (SCRYPT_N, SCRYPT_R, SCRYPT_P, _b64(salt), _b64(dk))
        except (AttributeError, ValueError):
            dk = hashlib.pbkdf2_hmac("sha256", _pw_bytes(pw), salt, PBKDF2_ITER)
            return "pbkdf2_sha256$%d$%s$%s" % (PBKDF2_ITER, _b64(salt), _b64(dk))


def verify_password(pw, stored):
    """True if pw matches the stored hash. Compares in constant time."""
    try:
        kind, rest = (stored or "").split("$", 1)
        with _hash_slots:
            if kind == "scrypt":
                n, r, p, salt, want = rest.split("$")
                want = base64.b64decode(want)
                got = hashlib.scrypt(_pw_bytes(pw), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                                     maxmem=128 << 20, dklen=len(want))
            elif kind == "pbkdf2_sha256":
                it, salt, want = rest.split("$")
                want = base64.b64decode(want)
                got = hashlib.pbkdf2_hmac("sha256", _pw_bytes(pw), base64.b64decode(salt), int(it))
            else:
                return False
        return hmac.compare_digest(got, want)
    except Exception:
        return False


def readable_code(groups=3, upper=False):
    """Something like k7mp-q3xd-9wte (about 59 bits): for temporary passwords and the setup code."""
    s = "-".join("".join(secrets.choice(READABLE) for _ in range(4)) for _ in range(groups))
    return s.upper() if upper else s


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def password_problem(pw, username="", name=""):
    """A plain-words reason a new password won't do, or None if it is fine."""
    if not isinstance(pw, str) or len(pw) < MIN_PW:
        return "Use at least %d letters, numbers or spaces. A short sentence you will remember works well." % MIN_PW
    if len(pw) > MAX_PW:
        return "That password is too long."
    low = pw.lower().strip()
    if low in COMMON or len(set(low)) < 4 or low == (username or "").lower() or low == (name or "").lower().strip():
        return "That password is too easy to guess. Try a short sentence, like three or four words."
    return None


def clean_name(s):
    s = re.sub(r"[\x00-\x1f\x7f]", "", str(s or "")).strip()
    return s[:80]


def clean_username(s):
    s = str(s or "").strip().lower()
    return s if USER_RE.fullmatch(s) else None


def _private(path):
    """Only the server's own user can read it (no effect on Windows, where the folder rights do this)."""
    try:
        os.chmod(path, 0o700 if os.path.isdir(path) else 0o600)
    except OSError:
        pass


def _write_json(path, obj):
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    for _ in range(10):
        try:
            os.replace(tmp, path)
            break
        except PermissionError:   # Windows: antivirus or OneDrive looking at it, try again in a moment
            time.sleep(0.2)
    else:
        os.replace(tmp, path)
    _private(path)


def _now_iso(t=None):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t or time.time()))


# ---------- counting tries: sign-in lockouts and limits on costly requests ----------
class Limiter:
    """Failed tries per key (an account or an address) in a sliding window; too many locks the key a while."""

    def __init__(self):
        self.lock = threading.Lock()
        self.fails = {}
        self.until = {}

    def wait(self, key):
        """Seconds this key must still wait (0 if it may try)."""
        with self.lock:
            t = self.until.get(key, 0) - time.time()
            if t <= 0:
                self.until.pop(key, None)
            return max(0, int(t + 0.999))

    def fail(self, key, limit, window, lock_for):
        """Count a failed try. True if that locked the key."""
        now = time.time()
        with self.lock:
            q = self.fails.setdefault(key, collections.deque())
            q.append(now)
            while q and q[0] < now - window:
                q.popleft()
            if len(q) >= limit:
                q.clear()
                self.until[key] = now + lock_for
                return True
            if len(self.fails) > 20000:   # keep memory bounded
                for k in [k for k, v in self.fails.items() if not v or v[-1] < now - 3600]:
                    self.fails.pop(k, None)
            return False

    def clear(self, key):
        with self.lock:
            self.fails.pop(key, None)


class Buckets:
    """At most `limit` requests per `window` seconds per key (proxies, store look-ups, map downloads)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.q = {}

    def allow(self, key, limit, window):
        now = time.time()
        with self.lock:
            q = self.q.setdefault(key, collections.deque())
            while q and q[0] < now - window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


# ---------- the accounts ----------
class Accounts:
    def __init__(self, root, legacy_file=None, session_hours=12, remember_days=30):
        self.root = os.path.abspath(root)
        self.dir = os.path.join(self.root, "accounts")
        os.makedirs(self.dir, exist_ok=True)
        _private(self.dir)
        self.users_path = os.path.join(self.dir, "users.json")
        self.sessions_path = os.path.join(self.dir, "sessions.json")
        self.audit_path = os.path.join(self.dir, "audit.log")
        self.legacy_file = legacy_file
        self.session_s = max(1, session_hours) * 3600
        self.remember_s = max(1, remember_days) * 86400
        self.lock = threading.RLock()
        self.audit_lock = threading.Lock()
        self.limits = Limiter()
        self.setup_hash = None
        self._dummy = None
        self._sess_saved = 0
        self.db = self._load(self.users_path, {"users": {}})
        self.db.setdefault("users", {})
        self.sessions = self._load(self.sessions_path, {})
        self._prune_sessions(save=True)

    @staticmethod
    def _load(path, default):
        try:
            with open(path, encoding="utf-8") as f:
                v = json.load(f)
            return v if isinstance(v, type(default)) else default
        except FileNotFoundError:
            return default
        except (OSError, ValueError):
            # never start with an empty user list over a damaged file: stop and say so
            raise SystemExit("Fence Builder can't read %s. Restore it from a backup copy." % path)

    def _save_users(self):
        _write_json(self.users_path, self.db)

    def _save_sessions(self):
        self._sess_saved = time.time()
        _write_json(self.sessions_path, self.sessions)

    # ----- paths: only ever from the user's id, which the server made -----
    def user_dir(self, uid):
        if not UID_RE.fullmatch(uid or ""):
            raise ValueError("bad user id")
        return os.path.join(self.root, "users", uid)

    def data_file(self, uid):
        return os.path.join(self.user_dir(uid), "fence-data.json")

    # ----- looking people up -----
    def get(self, uid):
        return self.db["users"].get(uid)

    def find(self, username):
        username = (username or "").strip().lower()
        return next((u for u in self.db["users"].values() if u["username"] == username), None)

    def needs_setup(self):
        return not self.db["users"]

    def admins(self, active_only=True):
        return [u for u in self.db["users"].values() if u["role"] == "admin" and (u.get("active") or not active_only)]

    @staticmethod
    def public(u, sessions=0):
        return {"id": u["id"], "username": u["username"], "name": u.get("name") or u["username"], "role": u["role"],
                "active": bool(u.get("active")), "created": u.get("created"), "last_login": u.get("last_login"),
                "must_change": bool(u.get("must_change")), "invite": bool(u.get("invite")),
                "invite_expires": (u.get("invite") or {}).get("expires"), "sessions": sessions}

    def list_users(self):
        with self.lock:
            self._prune_sessions()
            n = collections.Counter(s["uid"] for s in self.sessions.values())
            return sorted((self.public(u, n[u["id"]]) for u in self.db["users"].values()),
                          key=lambda u: (u["name"] or "").lower())

    # ----- the log -----
    def audit(self, event, ip=None, by=None, user=None, **extra):
        """One line in the security log. Never put a password, code or cookie in here."""
        rec = {"t": _now_iso(), "ev": event}
        if ip:
            rec["ip"] = str(ip)[:64]
        if by:
            rec["by"] = by
        if user:
            rec["user"] = user
        for k, v in extra.items():
            if v is not None:
                rec[k] = str(v)[:200]
        line = json.dumps(rec) + "\n"
        with self.audit_lock:
            try:
                if os.path.exists(self.audit_path) and os.path.getsize(self.audit_path) > 2_000_000:
                    for i in (3, 2, 1):
                        old = "%s.%d" % (self.audit_path, i)
                        if i == 3 and os.path.exists(old):
                            os.remove(old)
                        prev = self.audit_path if i == 1 else "%s.%d" % (self.audit_path, i - 1)
                        if os.path.exists(prev):
                            os.replace(prev, old)
                fd = os.open(self.audit_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                with os.fdopen(fd, "a", encoding="utf-8") as f:
                    f.write(line)
            except OSError as e:
                sys.stderr.write("could not write the security log: %s\n" % e)
        sys.stderr.write("security: %s" % line)

    def events(self, n=200):
        """The newest n lines of the log, newest first."""
        lines = []
        for p in (self.audit_path + ".1", self.audit_path):
            try:
                with open(p, encoding="utf-8") as f:
                    lines += f.read().splitlines()
            except OSError:
                pass
        out = []
        for ln in reversed(lines[-n:]):
            try:
                out.append(json.loads(ln))
            except ValueError:
                pass
        return out

    # ----- sessions -----
    def _prune_sessions(self, save=False):
        now = time.time()
        dead = [k for k, s in self.sessions.items()
                if s.get("expires", 0) < now or now - s.get("seen", 0) > s.get("idle", self.session_s)
                or s.get("uid") not in self.db["users"]]
        for k in dead:
            self.sessions.pop(k, None)
        if dead or save:
            self._save_sessions()

    def new_session(self, u, ip, ua, remember=False):
        token = secrets.token_urlsafe(32)
        now = time.time()
        life = self.remember_s if remember else self.session_s
        with self.lock:
            self.sessions[sha(token)] = {"uid": u["id"], "created": now, "seen": now, "expires": now + life,
                                         "idle": min(life, 7 * 86400) if remember else self.session_s,
                                         "csrf": secrets.token_urlsafe(24), "ip": str(ip)[:64], "ua": str(ua or "")[:160],
                                         "remember": bool(remember)}
            self._save_sessions()
        return token, (life if remember else None)

    def session(self, token):
        """(session, user) for a sign-in cookie, or None if it is unknown, expired, or the account is off."""
        if not token or len(token) > 200:
            return None
        k = sha(token)
        now = time.time()
        with self.lock:
            s = self.sessions.get(k)
            if not s:
                return None
            u = self.db["users"].get(s["uid"])
            if (not u or not u.get("active") or s["expires"] < now or now - s["seen"] > s["idle"]
                    or s["created"] < u.get("sessions_after", 0)):
                self.sessions.pop(k, None)
                self._save_sessions()
                return None
            s["seen"] = now
            if now - self._sess_saved > 300:   # last-seen times are written now and then, not on every click
                self._save_sessions()
            return s, u

    def end_session(self, token):
        with self.lock:
            if self.sessions.pop(sha(token or ""), None) is not None:
                self._save_sessions()

    def end_all_sessions(self, uid):
        with self.lock:
            for k in [k for k, s in self.sessions.items() if s["uid"] == uid]:
                self.sessions.pop(k, None)
            u = self.db["users"].get(uid)
            if u:
                u["sessions_after"] = time.time()
            self._save_sessions()

    # ----- signing in -----
    def _dummy_hash(self):
        if self._dummy is None:
            self._dummy = hash_password(secrets.token_urlsafe(16))
        return self._dummy

    def login(self, username, password, ip):
        """('ok', user) | ('bad', None) | ('locked', seconds) | ('off', None). Never says whether the name exists."""
        name = str(username or "").strip().lower()[:64]
        akey, ikey = "acct:" + name, "ip:" + str(ip)
        wait = max(self.limits.wait(akey), self.limits.wait(ikey))
        if wait:
            self.audit("signin_blocked", ip=ip, user=name or None, why="too many tries")
            return "locked", wait
        with self.lock:
            u = self.find(name)
            stored = u["pw"] if u and u.get("pw") else None
        ok = verify_password(str(password or "")[:MAX_PW], stored or self._dummy_hash()) and stored is not None
        if not ok:
            locked = self.limits.fail(akey, 5, 900, 900)       # 5 wrong tries in 15 minutes: that account waits 15 minutes
            locked = self.limits.fail(ikey, 20, 900, 1800) or locked   # 20 from one address: it waits 30 minutes
            self.audit("signin_failed", ip=ip, user=name or None, locked="yes" if locked else None)
            return ("locked", 900) if locked else ("bad", None)
        if not u.get("active"):
            self.audit("signin_refused", ip=ip, user=u["username"], why="account turned off")
            return "off", None
        self.limits.clear(akey)
        with self.lock:
            u["last_login"] = _now_iso()
            self._save_users()
        self.audit("signin", ip=ip, user=u["username"])
        return "ok", u

    # ----- first admin -----
    def new_setup_code(self):
        code = readable_code(3, upper=True)
        self.setup_hash = sha(code.replace("-", "").upper())
        return code

    def check_setup_code(self, code, ip):
        ikey = "setup:" + str(ip)
        if self.limits.wait(ikey) or self.limits.wait("setup:all"):
            return "locked"
        good = self.setup_hash and hmac.compare_digest(sha(re.sub(r"[\s-]", "", str(code or "")).upper()), self.setup_hash)
        if not good:
            self.limits.fail(ikey, 5, 900, 1800)
            self.limits.fail("setup:all", 50, 3600, 3600)
            self.audit("setup_code_wrong", ip=ip)
            return "bad"
        return "ok"

    def _make_user(self, username, name, role, pw_hash=None, must_change=False, by=None):
        uid = secrets.token_hex(8)
        u = {"id": uid, "username": username, "name": clean_name(name) or username, "role": role, "active": True,
             "created": _now_iso(), "last_login": None, "pw": pw_hash, "must_change": bool(must_change),
             "pw_changed": _now_iso() if pw_hash else None, "created_by": by}
        self.db["users"][uid] = u
        os.makedirs(self.user_dir(uid), exist_ok=True)
        _private(self.user_dir(uid))
        return u

    def create_first_admin(self, username, name, password, ip=None, must_change=False, how="setup"):
        username = clean_username(username)
        if not username:
            raise ValueError("Pick a user name: 2 to 64 small letters or numbers, no spaces.")
        prob = password_problem(password, username, name)
        if prob:
            raise ValueError(prob)
        h = hash_password(password)
        with self.lock:
            if not self.needs_setup():
                raise ValueError("Fence Builder is already set up. Sign in instead.")
            u = self._make_user(username, name, "admin", h, must_change=must_change)
            if how == "setup":
                u["last_login"] = _now_iso()   # signed in straight away
            self.setup_hash = None
            self._save_users()
        self.audit("first_admin_created", ip=ip, user=username, how=how)
        self.migrate_legacy(u)
        return u

    def migrate_legacy(self, u):
        """The data of a server that ran before accounts existed becomes the first admin's."""
        src = self.legacy_file
        with self.lock:
            if self.db.get("migrated") or not src or not os.path.isfile(src):
                return False
            dst = self.data_file(u["id"])
            if os.path.exists(dst):
                return False
            shutil.copy2(src, dst)
            _private(dst)
            moved = src + ".moved-to-" + u["username"]
            try:
                os.replace(src, moved)
            except OSError:
                moved = src
            self.db["migrated"] = {"to": u["id"], "at": _now_iso(), "kept": os.path.basename(moved)}
            self._save_users()
        self.audit("data_moved_into_account", user=u["username"], kept=os.path.basename(moved))
        return True

    def bootstrap_from_env(self, username, password):
        """FENCE_ADMIN_USER / FENCE_ADMIN_PASSWORD: used once, only while there are no accounts. The password
        must be changed at the first sign-in, so the one in the server's settings stops working."""
        if not (username and password) or not self.needs_setup():
            return None
        return self.create_first_admin(username, "Admin", password, must_change=True, how="FENCE_ADMIN_USER")

    # ----- the admin's actions -----
    def _secret_for(self, u, how):
        """A temporary password (to change at first sign-in) or a one-time link code. Returns the secret."""
        if how == "link":
            code = secrets.token_urlsafe(32)
            u["invite"] = {"hash": sha(code), "expires": _now_iso(time.time() + INVITE_DAYS * 86400)}
            u["pw"] = None
            u["must_change"] = False
            return code
        pw = readable_code(3)
        u["pw"] = hash_password(pw)
        u["must_change"] = True
        u.pop("invite", None)
        u["pw_changed"] = _now_iso()
        return pw

    def create_user(self, username, name, role, how, by, ip):
        username = clean_username(username)
        if not username:
            raise ValueError("Pick a user name: 2 to 64 small letters or numbers (you can use . _ - @), no spaces.")
        if role not in ("admin", "user"):
            raise ValueError("bad role")
        with self.lock:
            if self.find(username):
                raise ValueError("Someone already has the user name %s." % username)
            u = self._make_user(username, name, role, by=by["username"])
            secret = self._secret_for(u, how)
            self._save_users()
        self.audit("user_created", ip=ip, by=by["username"], user=username, role=role, how=how)
        return u, secret

    def _target(self, uid, by, action):
        u = self.get(uid)
        if not u:
            raise LookupError("No such account")
        if u["id"] == by["id"] and action in ("disable", "delete", "role"):
            raise ValueError("You can't do that to your own account. Ask another admin.")
        return u

    def _keep_an_admin(self, u):
        """Refuse a change that would leave no admin who can sign in."""
        if u["role"] == "admin" and u.get("active") and not [a for a in self.admins() if a["id"] != u["id"]]:
            raise ValueError("This is the last admin. Make someone else an admin first.")

    def set_active(self, uid, active, by, ip):
        with self.lock:
            u = self._target(uid, by, "disable" if not active else "enable")
            if not active:
                self._keep_an_admin(u)
            u["active"] = bool(active)
            self._save_users()
        if not active:
            self.end_all_sessions(uid)
        self.audit("user_enabled" if active else "user_disabled", ip=ip, by=by["username"], user=u["username"])
        return u

    def set_role(self, uid, role, by, ip):
        if role not in ("admin", "user"):
            raise ValueError("bad role")
        with self.lock:
            u = self._target(uid, by, "role")
            if role == "user":
                self._keep_an_admin(u)
            u["role"] = role
            self._save_users()
        self.audit("role_changed", ip=ip, by=by["username"], user=u["username"], role=role)
        return u

    def rename(self, uid, name, by, ip):
        with self.lock:
            u = self._target(uid, by, "rename")
            u["name"] = clean_name(name) or u["username"]
            self._save_users()
        self.audit("user_renamed", ip=ip, by=by["username"], user=u["username"])
        return u

    def reset(self, uid, how, by, ip):
        with self.lock:
            u = self._target(uid, by, "reset")
            secret = self._secret_for(u, how)
            self._save_users()
        self.end_all_sessions(uid)
        self.audit("password_reset_by_admin", ip=ip, by=by["username"], user=u["username"], how=how)
        return u, secret

    def delete(self, uid, confirm, by, ip):
        """Removes the account. Their data is kept in <data>/deleted/, in case it was a mistake."""
        with self.lock:
            u = self._target(uid, by, "delete")
            if str(confirm or "").strip().lower() != u["username"]:
                raise ValueError("Type the user name %s to delete this account." % u["username"])
            self._keep_an_admin(u)
            del self.db["users"][uid]
            self._save_users()
        self.end_all_sessions(uid)
        kept = None
        src = self.user_dir(uid)
        if os.path.isdir(src):
            ddir = os.path.join(self.root, "deleted")
            os.makedirs(ddir, exist_ok=True)
            _private(ddir)
            kept = os.path.join(ddir, "%s-%s-%s" % (time.strftime("%Y%m%d-%H%M%S"), u["username"], uid))
            shutil.move(src, kept)
            with open(os.path.join(kept, "account.json"), "w", encoding="utf-8") as f:
                json.dump({k: u.get(k) for k in ("id", "username", "name", "role", "created")}
                          | {"deleted": _now_iso(), "deleted_by": by["username"]}, f, indent=1)
        self.audit("user_deleted", ip=ip, by=by["username"], user=u["username"], kept=os.path.basename(kept or "") or None)
        return u, kept

    # ----- people changing their own password -----
    def change_password(self, u, old, new, ip):
        akey = "acct:" + u["username"]
        if self.limits.wait(akey):
            return "Too many tries. Please wait 15 minutes, then try again."
        if not verify_password(str(old or "")[:MAX_PW], u.get("pw") or self._dummy_hash()) or not u.get("pw"):
            self.limits.fail(akey, 5, 900, 900)
            self.audit("password_change_failed", ip=ip, user=u["username"])
            return "Your current password is not right."
        prob = password_problem(new, u["username"], u.get("name"))
        if prob:
            return prob
        if new == old:
            return "Pick a new password, not the one you have now."
        h = hash_password(new)
        with self.lock:
            u["pw"], u["must_change"], u["pw_changed"] = h, False, _now_iso()
            self._save_users()
        self.end_all_sessions(u["id"])   # signed out everywhere else; the server signs this window in again
        self.audit("password_changed", ip=ip, user=u["username"])
        return None

    def redeem_invite(self, code, new, ip):
        """('ok', user) | ('bad', message). The link works once, until it expires."""
        ikey = "invite:" + str(ip)
        if self.limits.wait(ikey):
            return "bad", "Too many tries. Please wait a while, then try again."
        h = sha(str(code or "")[:200])
        with self.lock:
            u = next((x for x in self.db["users"].values()
                      if x.get("invite") and hmac.compare_digest(x["invite"]["hash"], h)), None)
        if not u or u["invite"]["expires"] < _now_iso():
            self.limits.fail(ikey, 10, 900, 1800)
            self.audit("invite_link_bad", ip=ip)
            return "bad", "This link does not work any more. Ask the person who runs Fence Builder for a new one."
        if not u.get("active"):
            return "bad", "This account is turned off. Ask the person who runs Fence Builder to turn it back on."
        prob = password_problem(new, u["username"], u.get("name"))
        if prob:
            return "bad", prob
        hpw = hash_password(new)
        with self.lock:
            u["pw"], u["must_change"], u["pw_changed"], u["last_login"] = hpw, False, _now_iso(), _now_iso()
            u.pop("invite", None)
            self._save_users()
        self.end_all_sessions(u["id"])
        self.audit("invite_link_used", ip=ip, user=u["username"])
        return "ok", u
