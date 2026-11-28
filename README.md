# Fence Builder

Draw fence lines on a satellite map and get the footage (following the ground slope),
every post, brace and roll of wire you need, what it costs, and a final bill with labor
and fees. It runs in a web browser: on your own computer, or as a shared server where each person signs
in to their own account.

## Use it in a web browser on this computer

1. Install [Python 3](https://www.python.org/downloads/) (tick "Add python.exe to PATH") and
   [Git](https://git-scm.com/download/win).
2. Get the code once: `git clone https://github.com/Benbone21/fence-builder.git`
3. Start it: in that folder, `py server.py` (or `pyw server.py` to run it with no window). Set
   `FENCE_DATA` to the full path of your data file to keep your jobs somewhere other than `data/`.
4. Open **http://localhost:8787** in your browser. Make a Startup shortcut to `pyw server.py` so
   it starts with Windows.
5. To update: `git pull` in that folder, then start it again.

Only this computer can reach it unless you set `HOST=0.0.0.0` (then use the shared-server setup below,
with sign-in, before other people use it).

The Windows app (`app.py`, `installer/`) still works from the source but is no longer built or
updated with each release.

## Run it as a shared server (Ubuntu and Docker)

A shared server is Fence Builder on one machine that you and your team open in a web browser. Everyone
signs in with their own account and has their own jobs, fence types, braces, materials, prices and
settings, like separate businesses. Nobody sees anyone else's. You, the admin, add people and manage
their accounts on the **Accounts** page. What protects it is written down in [SECURITY.md](SECURITY.md).

### 1. Install Docker (once)

On the Ubuntu server, in a terminal:

    sudo apt update
    sudo apt install -y docker.io docker-compose-v2 git
    sudo usermod -aG docker $USER

Log out and back in (so the last line counts), then check it works: `docker compose version`.

### 2. Get Fence Builder and start it

    git clone https://github.com/Benbone21/fence-builder.git
    cd fence-builder
    docker compose up -d --build

The first start takes a minute or two. `docker compose ps` should then show `fence-builder` as
`running (healthy)`. It starts again by itself after a restart of the server.

### 3. Make your admin account

Look in the server's log for the setup code:

    docker compose logs fence

It is under **FIRST-TIME SETUP** and looks like `K7MP-Q3XD-9WTE`. Open
`http://<the server's address>:8787` in a browser (to find the address: `hostname -I`). Fence Builder asks
for the setup code, your name, a user name and a password. That is the admin account. A new code is made
each time the server starts, until the first account exists, and it stops working once used.

If a Fence Builder server already ran here before accounts (a `data/fence-data.json` file), its jobs,
prices and settings become this first admin's. The old file is kept as `data/fence-data.json.moved-to-<name>`.

### 4. Add people

Open **Settings → Your account → Manage accounts** (or go to `/admin`). **+ Add a person**: their name, a
user name, and either a temporary password you give them (they pick their own when they first sign in) or
a one-time link to send them (it works for 7 days). The same page resets passwords, turns accounts off and
on, makes someone an admin, deletes accounts (their data is kept in `data/deleted/`), and shows who signed
in and every wrong password.

New accounts start with the fence types, braces and materials of the starting setup. To make yours the
starting setup, set it up in your account, then **Settings → Backup → Save my setup as the starting setup
for new accounts**. Your jobs, business details and crew are never copied.

### Where your data is, and backups

Everything is in the `data` folder next to `docker-compose.yml`:

- `data/accounts/`: the accounts (passwords only as scrambled hashes), sign-ins and the security log
- `data/users/<id>/fence-data.json`: each person's jobs, prices and settings, with an hourly copy in
  `data/users/<id>/backups/` (the last 200 kept)
- `data/offline/`: saved map areas; `data/deleted/`: data of deleted accounts

The files belong to the server's own user, so use `sudo` to copy them. To back everything up (the
server can keep running):

    sudo tar czf fence-backup-$(date +%F).tar.gz data

Keep the backup somewhere else too (another computer, a USB drive). To restore: `docker compose down`,
put the `data` folder back (`sudo tar xzf fence-backup-<date>.tar.gz`), `docker compose up -d`.

### Updating the server

When a new version is out (admins see a green bar in the app), in the `fence-builder` folder:

    git pull
    docker compose build --pull
    docker compose up -d

Nobody's jobs, prices or settings are touched. The in-app **Update now** is only for the Windows app; a
shared server is always updated this way.

### Settings

Put settings in a file called `.env` next to `docker-compose.yml` (start from `.env.example`:
`cp .env.example .env`), then `docker compose up -d` again. The ones you might use: `FENCE_PUBLISH` (the
port, default 8787), `FENCE_OFFLINE` (who may save map areas for offline: `all`, `admin` or `off`), and the
https ones below. More are listed at the top of `server.py`.

### Later: a domain name and https

Inside your own network, plain `http://` is fine. **Before people sign in from outside it, turn on https**:
over plain http their passwords and jobs travel unencrypted. Fence Builder warns about this on the sign-in
page and the Accounts page.

1. Get a domain name (or a subdomain, like `fence.yourbusiness.com`) and point it at the server's public
   address (an `A` record at your domain seller). On a VPS that is the VPS's address; at home, forward ports
   80 and 443 on your router to the server.
2. Make sure ports 80 and 443 are open (on Ubuntu with ufw: `sudo ufw allow 80,443/tcp`).
3. In `.env` set:

       FENCE_DOMAIN=fence.yourbusiness.com
       FENCE_PUBLIC_URL=https://fence.yourbusiness.com
       FENCE_PUBLISH=127.0.0.1:8787
       FENCE_ALLOWED_HOSTS=fence.yourbusiness.com

4. Start it with Caddy, which gets and renews the certificate by itself:

       docker compose --profile https up -d --build

Open `https://fence.yourbusiness.com`. From now on add `--profile https` to the `docker compose up -d` of an update too.

**Moving to a VPS**: install Docker and clone Fence Builder there (steps 1 and 2), stop the old server
(`docker compose down`), copy the whole `data` folder over (for example
`sudo tar czf data.tgz data`, copy `data.tgz`, then `sudo tar xzf data.tgz` in the new `fence-builder`
folder), set up the domain and https as above, and start it. Everyone signs in as before.

### Without Docker

`FENCE_MODE=multi python3 server.py` runs the same shared server (Python 3.10 or newer, nothing to
install); `fence-estimator.service` is a systemd example, `nginx-fence.conf` an nginx one. Plain
`python server.py` is the single-user way, with no sign-in: only for your own computer.

## Using it

- **Jobs** is a board of every job by stage: Bid, Scheduled, In progress, Done.
- **Builder** is the map. Set up the fence on the left (wire, posts, braces), then
  **Draw fence** (F) and click each corner. Ends, corners and gates get braces, and posts
  space themselves evenly between braces. Zoom in to drag single posts or pull braces.
- **Final bill** lists every material to buy, what each one is for, and a link to buy it,
  then labor (each fence type's $ per foot), headache charges and other fees.
- **Save estimate** on the Final bill keeps the price on the jobs board, with the date.
- **Customer quote** (on the Final bill or a job's page) makes a clean, printable quote: your
  business name and logo, the work to be done with a price for each part (or the total only), a
  drawing of the fence to scale, deposit, terms and signature lines. Print it or save it as a PDF.
  Your business details, deposit, terms and quote numbers are in **Settings → Your business**.
- **How the job really went** on each job's page: type the days, crew and what the materials
  really cost, and it compares that with the estimate and shows your profit. From your finished
  jobs it suggests a labor price per foot for each fence type (shown on the fence type too), using
  each person's pay and the profit you want, set in **Settings → Crew**.
- A short **how-to card** at the top of each page says how it works. **Got it** hides it;
  **Settings → Text size and help** brings them back. The big **Undo** button at the top of the
  map takes back the last change to the fence.
- **Fence types**, **Braces** and **Materials** are your own library. **+ Add material** offers
  Kencove, D&B Supply, a store link, or your own. Changes there wait
  for **Save**. Materials can be found in Kencove or D&B Supply from inside the app, and
  prices from store links update on their own once a day. For stores that only let people
  see their pages (like Premier 1 Supplies), use the **Add to Fence Builder** bookmark
  on the Materials page.

## On a phone

Open the same address as on the computer (your shared server's address, for example
`https://fence.yourbusiness.com`) in the phone's browser and sign in. On a phone the pages are made for one hand:
a bar of big buttons at the bottom (**Jobs**, **Map**, **Final bill**, **Walk the fence**, **More** for the setup
pages), the map fills the screen, and the fence setup and the details slide up from the bottom when you tap the bar
that says the fence's length and price.

**Put it on the home screen**, so it opens like an app: on an iPhone, Safari's Share button, then **Add to Home
Screen**; on Android, Chrome's menu (⋮), then **Add to Home screen** or **Install app**.

**Walk the fence** (with the phone's GPS):

1. Tap **Walk the fence**, pick the fence type and tap **Start walking a new fence line**.
2. Stand at the corner where the fence starts and tap **Drop a point here**. Hold still for 3 seconds while it
   steadies the GPS reading. Walk to the next corner (or brace) and tap again, and so on. The length so far is at the top.
3. For a gate, stand at one gate post and tap **Add a gate here**, then walk to the other post and tap **Other gate
   post here**. **Undo last point** takes back the last point (a gate comes off whole).
4. Tap **Finish line** at the end. The braces at ends and corners, gates at roads, braces at creeks and on hills go in
   the same as for a line drawn on the map. **Cancel** throws the line away.

It shows how sure the GPS is (for example ±12 ft) and warns when it is rough (worse than ±30 ft): wait a moment or
move into the open. **Follow me** keeps the map on you; the screen stays on while you walk where the phone's browser
allows it. Each point is saved as soon as it goes in.

**No signal out in the country?** GPS works without signal. Once you have opened Fence Builder on the phone (signed
in, with signal) it opens and walks with no signal too: the points are kept on the phone and sent on their own when
you are back in range (if the job was changed somewhere else meanwhile, both are kept). The map photo can't load with
no signal, so before you go, tap **Keep this area's map on this phone** on the Walk screen: it keeps the USGS aerial
photo of the area on the screen (at least about half a mile across; zoom out first to take in more; up to 150 MB, and
it says how big before it starts; use Wi-Fi if you can). Without it you still see your dot and the fence on a blank map. Signing out removes
what was kept on the phone.

**The phone only shares its location with https websites** (and with `localhost`). Plain `http://` to the server's
address works for everything else, but the Walk screen will say so: turn on https as in
[Later: a domain name and https](#later-a-domain-name-and-https). Working with no signal needs https too.

## How the counts work

- Wire is counted per fence type from strands, roll length and extra for sag and splices.
  All lines of the same type are added up before rounding. If you list the other roll sizes a
  wire comes in, the wire is laid out in full rolls of the main size (a roll carries on past
  braces), and the end is finished with the cheapest mix of the other sizes. Wires are listed bottom to top, with their height and spacing in inches.
- Posts are counted per stretch between braces: `ceil(stretch / spacing) - 1`, spaced
  evenly. Added posts (for example every 5th post, or one every 100 ft) are centred in
  each stretch so both ends match.
- A bend sharper than the corner angle (25 degrees to start) is a corner.
- A run longer than the longest stretch for its wire (660 ft for woven wire, by default)
  gets a pull brace to stretch into.
- Heights come from USGS 3DEP LiDAR (1 m in most of the US), or Open-Meteo outside it.

## LiDAR map layers and 3D

- Layers: satellite, USGS aerial photo, streets, LiDAR bare earth, topo, contour lines, slope.
- **Property lines** (zoom in close): county parcel maps for Gem, Canyon, Valley and Ada counties and
  the State of Idaho parcel layer (Ada, Boise, Washington and others), elsewhere Regrid's free
  nationwide lines. Click a line for its parcel number and acres. While drawing, fence points snap to
  property corners and lines. They are approximate, from county records: for reference only, not a
  survey. **Section lines** show the BLM land survey.
- **Right-click the map** for a menu: start a fence line, a gate or brace on a line, delete a stretch of
  fence or a brace, **Fence this property** (one parcel), **Fence this owner's land** (the owner's
  neighbouring parcels as one fence; owner names are used only to group parcels and are never shown or
  saved), or **Pick several parcels to fence together**.
- **Elk fence 8 ft (Idaho)** is one of the starting fence types (added once to older setups too): 96"
  high-tensile woven wire plus a top wire, 2-1/8" pipe line posts (3/16" wall) every 20 ft driven 4 ft in,
  welded pipe H-braces with 2-7/8" posts (7/32" wall) set 3 ft in concrete, and an 8 ft elk gate. It checks
  itself against Idaho's elk fence rules (8 ft tall, post sizes, no more than 24 ft between posts) and says
  what isn't met. Prices are samples.
- **More starting fence types** (added once to older setups too), each with its posts, corner posts or
  braces, gate and the hardware that can be counted: wood board fence (4 boards), chain link 6 ft, wood
  privacy 6 ft, split rail (3 rails), no-climb horse fence with a top board, steel pipe rail (3 rails), vinyl
  privacy 6 ft, and a government standard 4-strand barbed wire fence that wildlife can pass (wires at 18",
  22", 28" and 40", barbless bottom wire; it checks itself against that). Boards, rails, pickets and
  panels are counted like rolls of wire. Prices are local where found (D&B Supply links, so they update
  on their own); the rest are marked as estimates on each material.
- **Braces added for you** (top of the Builder, and Settings → Drawing on the map): four switches,
  **Gates at roads**, **Braces at rivers and creeks**, **Braces at hilltops** and **Braces at the
  bottoms of hills**. Hill braces go where the ground's slope bends by at least the fence type's
  "Hill braces: slope change %" (15% to start) over 50 ft, using the LiDAR ground heights. Turning a
  switch off takes out only what it added.
- The 3D view has **Draw fence**, **Add brace** and **Add gate** too.
- 3D view shows the terrain with the satellite photo, every post, wire, brace and gate at
  real size, and nearby buildings. Move with W A S D or the arrow keys.

## The ground along a fence

When you draw or change a fence line, Fence Builder looks up the ground under it on public US government maps
(it needs the internet; drawing never waits for it). These lookups now run in your own browser or phone, not on the
Fence Builder server, and the answers are kept in your browser so opening a job again doesn't ask again:

- **Soil and rock** (USDA soil survey), in plain words: first **What this means for posts**, for example "Mostly rocky
  ground: hard digging. About 5,550 ft is rocky, and 3,400 ft of it has solid rock 1–2 ft down. Plan on a rock bar or
  auger, or set those posts in concrete." Then each soil along the line as a short card: what the ground is like
  ("Rocky clay loam on hillsides — big rocks all over; solid rock 25 in down"), how hard the digging is, and what to
  expect for posts. It covers rocks, solid rock and hardpan, wet ground and ground water, flooding, loose sand,
  clay that swells, and steep slopes. The soil survey's own name and map label are kept in small print under each card.
- **Water**: streams, rivers, canals and ditches it crosses (USGS), feet in a flood zone (FEMA), and feet through
  wetlands (US Fish and Wildlife). Wetlands and flood zones may need a permit: check before you build.
- **Trees and brush** (LANDFIRE): feet through trees and through thick brush.

You see it under **Ground along this fence** on each line's page, and for the whole job under **The ground** on the
Final bill, with two buttons:

- **Use 10%** (or whatever it suggests) sets the site difficulty: up to 15% for rocky ground and up to 15% for solid rock or
  hardpan within 40 inches, by how much of the fence is on it.
- **Add a clearing fee** adds "Clearing trees and brush" to the other fees, at $ per foot for trees and for brush set in
  **Settings → Ground and clearing** (starting guesses: $4 and $1.50 a foot).

Nothing on the bill changes until you press a button. The braces on each bank of a river or creek ("Gates at roads, braces
at rivers") come from the same USGS stream map, which has many ditches the street map misses; the street map is the backup
when USGS doesn't answer.

The Builder map's layer list has **Soils**, **Streams and ditches**, **Flood zones**, **Wetlands** and **Trees and brush**
(off to start; zoom in to see them). With **Soils** on, the legend says what the letters on the soil map mean for the
soils on this job's fence lines, in plain words ("VsF Rocky loam on steep hillsides (hard digging)"). These maps are a
guide for planning, not a survey. They are not saved with offline
areas yet.

## Offline maps

On the Builder map, press **Save area for offline**, click two corners of the area, name it and
press **Download**. Fence Builder saves, from USGS (public domain): the aerial photo (NAIP, about
1 ft per pixel), the LiDAR bare-earth map, and the LiDAR ground heights (about 1 m apart). With no
internet the map switches to the saved aerial photo on its own, and slope footage and the 3D view
use the saved ground heights. Esri's satellite photo can't be saved for offline use under Esri's
terms, so offline you see the USGS photo instead.

Saved areas are listed in **Settings → Offline maps** (show, finish a stopped download, delete).
They are kept in an `offline` folder next to the data file: `%LOCALAPPDATA%\Fence Builder\data\offline`
for the app, `data/offline` for the web server. About 4 MB per 50 acres at full detail.

## How the code is laid out

- `server.py` runs the app (the Windows app starts it inside its window), with `offline.py` for
  saved offline areas and `auth.py` for the accounts of a shared server (`FENCE_MODE=multi`).
- `static/login.html`/`login.js` is the sign-in page and `static/admin.html`/`admin.js` the Accounts page
  of a shared server. `static/js/05-account.js` is the app's side of accounts.
- `static/js/67-ground-fetch.js` looks up the ground along a fence line (soil, water, trees) on public federal maps,
  straight from the browser; `static/js/68-ground.js` shows it. (`ground.py` is the old server route for the same
  lookups; the page no longer uses it.)
- `static/index.html` is the page, `static/app.css` its look, and `static/view3d.js` the 3D view. `static/js/92-phone.js` is the phone's
  layout and Walk the fence, `static/js/08-offline.js` and `static/sw.js` let a phone work with no signal; pictures are in
  `docs/phone/`. The colours of
  each look in **Settings → Look and text size** (Clean, Warm, Ranch, High contrast, Dark) are at the top of `app.css`;
  `static/look.js` puts the one picked on this computer on the page before it shows (the app, sign-in and Accounts
  pages all load it). Pictures of each look are in `docs/looks/`.
- The app's script is kept in pieces in `static/js/`, numbered in the order they run
  (`00-basics.js` … `95-start.js`). The server joins them into one script, `app.js`, so the
  pieces share everything, as if they were one file.
- `tests/smoke.py` opens the app in a hidden browser and checks every page, the single-user way and as a
  shared server; `tests/test_multiuser.py` checks the shared server's sign-in and security (see `tests/README.md`).

## Making a release

1. Put the new version number in `VERSION` (for example `1.8.3`) and commit it.
2. Tag that commit and push the tag:

       git tag v1.8.3
       git push origin v1.8.3

   The **Release** workflow (`.github/workflows/release.yml`) first checks the app still works:
   it starts it on an empty data folder in a hidden browser, opens every page, adds a test job
   and checks the Final bill, and checks the shared server's sign-in and security
   (`tests/smoke.py` and `tests/test_multiuser.py`, see `tests/README.md`). If that passes it
   makes the GitHub release. If it fails, no release is made; the Actions page shows what went
   wrong. The tag must match `VERSION`. You can run the same checks yourself first with
   `py tests/smoke.py` and `py tests/test_multiuser.py` (they use Playwright's Chromium, or
   Microsoft Edge if Playwright's browser isn't installed).
