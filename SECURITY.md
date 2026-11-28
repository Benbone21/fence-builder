# Fence Builder security

Fence Builder runs two ways:

- **The Windows app** (and `python server.py` with no settings): one person's data, no sign-in. The app's
  server listens only on this computer (127.0.0.1).
- **A shared server** (`FENCE_MODE=multi`, which the Docker image uses): everyone signs in and has their own
  jobs, fence types, braces, materials, prices and settings. An admin manages the accounts.

This page is about the shared server, plus what protects the Windows app. To report a problem, open a private
security advisory on GitHub (Security > Report a vulnerability) instead of a public issue.

## What we protect, and from whom

| What | Kept from |
| --- | --- |
| Each business's jobs, customers, prices, crew pay and settings | everyone without an account, and **every other account** (admins included: managing accounts does not open anyone's jobs) |
| Passwords | everyone, including whoever reads the server's disk or logs |
| The server itself (its files, its network, other machines on its network) | everyone using the site, signed in or not |

The people we expect to try something:

1. **Strangers on the internet** once the port is published: guessing passwords, scanning for files, using the
   server's outbound requests to reach other machines (SSRF), flooding it.
2. **Other websites** a signed-in person visits, trying to make changes in their name (CSRF), or to reach
   the Windows app on 127.0.0.1 (DNS rebinding).
3. **A signed-in person** trying to read or change another person's data, or to use admin actions.
4. **Someone on the same network** when the site is plain http.

Not covered: someone who controls the server machine or its Docker host, someone who has a person's
unlocked computer or password, and denial of service by a large botnet (put the site behind a firewall or
a service like Cloudflare if that matters).

## What is in place

**Accounts and passwords**
- Passwords are stored only as scrypt hashes (N=32768, r=8, p=1, 16-byte random salt per password),
  compared in constant time. At most 4 are checked at once, so password checks can't eat the memory.
- New passwords: at least 10 characters, not a well-known one, not the user name.
- New accounts get either a temporary password (they must pick their own at first sign-in) or a one-time
  link that works for 7 days. Only a hash of the link's code is stored. The link carries the code after `#`,
  so it never reaches server logs or other sites.
- The first admin comes from a one-time setup code printed in the server log (a new one each start, while
  there is no account; 5 wrong tries per address lock it for 30 minutes, 50 in all for an hour), or once
  from `FENCE_ADMIN_USER`/`FENCE_ADMIN_PASSWORD`, which must be changed at the first sign-in.
- The last admin can't be removed, and an admin can't turn off, demote or delete their own account.
- Deleting an account moves its data to `data/deleted/` (kept, not destroyed) and ends its sign-ins.

**Signing in**
- Wrong password or unknown name: the same answer, the same status and about the same time (a dummy hash
  is checked), so nobody can find out which user names exist.
- 5 wrong passwords for one account in 15 minutes lock that account for 15 minutes. 20 wrong tries from one
  address lock that address for 30 minutes. (This means someone could lock a person out for 15 minutes
  on purpose. It is the usual trade-off, and the admin sees it in the log.)
- Sessions: a random 256-bit token in a cookie that is `HttpOnly`, `SameSite=Strict`, and `Secure` with the
  `__Host-` prefix over https. The server keeps only a SHA-256 hash of it. A sign-in lasts 12 hours, or 30
  days with "Keep me signed in" (and ends after 7 days unused). Changing a password, a reset by the admin,
  turning an account off or deleting it ends every sign-in of that account at once. Each sign-in starts a
  new session.

**Every request**
- Every API route, file and page needs a signed-in account, except the sign-in page and what it needs
  (`login.html`, `login.js`, `app.css`, icons) and `api/health`. Admin routes check the admin role on the
  server, on every request.
- Each person's data file is found only from their account id, which the server made
  (`data/users/<16 hex>/fence-data.json`). Nothing in a request (path, query or header) can point at
  another account's data. Each account has its own version counter and hourly backups.
- Changes (POST/PUT/DELETE) must come from a page of the same site (the `Origin` header must match the
  host) **and** carry the session's own CSRF token in `X-CSRF-Token`. JSON bodies must say
  `Content-Type: application/json`, which a plain form on another site can't send.
- Request bodies are limited (sign-in 16 KB, saves 20 MB, map requests 2 MB); a compressed body is limited
  to the same size unpacked. Chunked uploads are refused. A connection that sends nothing for 2 minutes is
  closed, and at most 200 connections are served at once.
- Files: only from `static/`. A path with `..`, `\`, a drive letter, a hidden name or a link out of the
  folder is refused.
- Security headers on pages: a Content-Security-Policy that allows scripts only from the server (no inline
  scripts except the hashed import map, no `eval`; the formula evaluator no longer uses `new Function`),
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`; on everything: `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Cross-Origin-Resource-Policy: same-origin`, and over https `Strict-Transport-Security`. Pictures and
  requests may go to any https site, because map tiles, store pictures and the map/LiDAR/parcel services
  the page asks directly live on many https hosts. `Permissions-Policy` lets pages use the location and keep
  the screen on (Walk the fence) for this site only, and turns off the camera, microphone, payment and USB.
- On a phone (or the app added to a home screen), for working with no signal: a service worker (`sw.js`, served
  only to someone signed in) keeps the app's own files, never answers from `api/` except aerial-photo map pieces
  the person chose to keep; the page keeps, in the phone's IndexedDB, who signed in last (name and user name, no
  password or session token), the last copy of their own data and any change not sent yet. Changes made with no
  signal go out through the normal save with the normal sign-in, safety token and version check. Signing out
  deletes all of it. Nothing of this kind is kept in a computer's browser (unless Fence Builder is installed as
  an app there).
- `FENCE_ALLOWED_HOSTS` (optional) makes the server answer only to its own names.

**Requests the server makes to other sites (SSRF)**
- The store search talks only to the stores on a fixed list (`www.dbsupply.com`, plus `FENCE_STORE_HOSTS`).
  Address search, elevation, the update check and offline map downloads go only to their fixed hosts.
- The price reader (any store page a person pastes) may only reach public internet addresses on ports 80
  and 443, with no user name in the address. The address is checked **when connecting** (so a name can't
  switch to a private address after the check: DNS rebinding) and again on every redirect (at most 5).
  Proxies from the environment are ignored. Compressed answers are size-limited when unpacked.
- Each person may make 600 store/price look-ups, 300 address/elevation look-ups, 4000 map pieces and 200
  heavy height requests per 10 minutes.

**Updates**
- On a shared server, the in-app "Update now" does not exist (`api/update` answers 404 to everyone, admins
  included), and the page never offers it. The server is updated by pulling a new image (README). Admins
  only see a note that a new version is out.

**Offline map areas**
- The downloaded map pieces are public USGS data, kept once and shared, which saves disk and requests.
  Each saved *area* belongs to the person who saved it: only they see it in their list and only they can
  finish or delete it (areas from before accounts belong to the admins). Limits: 10 areas per person,
  one download per person and two on the whole server at a time, and none when less than 2 GB of disk is
  free. `FENCE_OFFLINE=admin` or `off` lets only admins save areas, or nobody.
- As before: parcel owner names are never shown, saved or kept offline; Esri imagery is never saved offline;
  IDWR parcel data is not used.

**Logs and files**
- `data/accounts/audit.log` (and the container log) records sign-ins, failed tries, lockouts, sign-outs,
  password changes, every admin action and blocked requests, with time, account and address. Never a
  password, code, token or cookie. The admin page shows the newest 300. It rotates at 2 MB and keeps 3
  old files.
- Request logs leave out query strings (addresses people search for) and routine page loads.
- On Linux the server writes everything with `umask 077`: accounts, data and backups are readable only by
  its own user. The Docker container runs as user 10001, not root, with a read-only file system, no Linux
  capabilities and `no-new-privileges`. A one-time helper gives that user the `data` folder.
- Behind a reverse proxy, `X-Forwarded-For`/`X-Forwarded-Proto` are believed only from `FENCE_TRUSTED_PROXY`
  (the Caddy container in `docker-compose.yml`).

**Plain http**
- Plain http is allowed (inside your own network it is fine), but the sign-in page, the account settings
  and the admin page warn in plain words when the site is used over http from outside the local network,
  because passwords would travel unencrypted. `docker compose --profile https` adds Caddy, which gets a
  certificate by itself once the server has a domain name.

**The Windows app**
- It listens only on 127.0.0.1 and answers only to `localhost`/`127.0.0.1`, so a web page that points its
  own name at 127.0.0.1 (DNS rebinding) gets nothing. Changes coming from another website (any `Origin`
  that is not the app itself) are refused, so a page can't save over your data or start an update.
- When it is set to use a Fence Builder server, the server's pages can ask the app window only one
  thing: go back to the copy on this computer.
- The old `FENCE_PASS` login still works for a single-user server; it is ignored in multi mode.

## Things deliberately not done

- **No password reset by email.** The server has no mail settings, and email links are a common weak spot.
  The admin resets passwords and hands over a temporary password or a one-time link.
- **No two-step sign-in (TOTP) yet.** It would add a phone app to the routine of people who are not
  technical. With https, scrypt, lockouts and the log, it can come later if needed.
- **No admin view of other people's jobs.** Managing accounts was the need; reading someone's jobs would
  need their consent. Their data can still be found on the server's disk by whoever runs it.
- **No built-in TLS in `server.py`.** Caddy does it better (automatic certificates and renewals).
- **Lockouts are kept in memory**, so a restart clears them. Sign-ins are kept on disk (hashed).
- **`style-src 'unsafe-inline'`** stays, because the pages set many inline styles. Scripts, the part that
  matters, can't run inline.
