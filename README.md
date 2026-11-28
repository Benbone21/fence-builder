# Fence Builder

Draw fence lines on a satellite map and get the footage (following the ground slope),
every post, brace and roll of wire you need, what it costs, and a final bill with labor
and fees. Runs as a Windows app, or as a shared server where each person signs in to their own account.

## Install on Windows

1. Go to the **[Releases](https://github.com/Benbone21/fence-builder/releases/latest)** page and
   download **FenceBuilder-Setup-<version>.exe**.
2. Run it. It installs for your Windows user only (no administrator needed), adds
   **Fence Builder** to the Start menu and the desktop, and opens it. Windows may say
   "Windows protected your PC" the first time because the installer isn't signed: click
   **More info**, then **Run anyway**.

Fence Builder is a normal Windows app: its own window and taskbar button, and you can pin it to
the taskbar or Start. It runs entirely on its own (nothing else needs to be running, and other
computers can't reach it) and stops when you close the window. It needs Microsoft's WebView2,
which comes with Windows 10 and 11. To remove it, use
**Settings → Apps → Installed apps → Fence Builder → Uninstall**.

Your jobs, prices and settings are kept in `%LOCALAPPDATA%\Fence Builder\data`, not in the
app's folder, so updating, uninstalling or reinstalling never touches them. To move jobs over
from a copy that ran from source, close Fence Builder and copy that copy's `data` folder there.

### Updates

The app checks this repository when it opens and every few hours. When a newer release is
out, a green bar says so, with **Update now**. The installed app downloads the new installer,
runs it quietly, and comes back on the new version in under a minute. You can also check from
**Settings → Version and updates**.

### Advanced: run it from the Python source

1. Install [Python 3](https://www.python.org/downloads/) (tick "Add python.exe to PATH").
2. Download the newest release from **Releases** (Source code, zip) and unzip it where you want
   it to live.
3. Install the window library once: `py -m pip install pywebview`.
4. Double-click `app.py`, or make a shortcut to it with `pyw.exe app.py` and the icon
   `fence.ico`.

The app keeps its own data in `%LOCALAPPDATA%\Fence Builder\data` (the first time, it copies
your jobs from `data/` next to the code). The web server (`python server.py`) keeps using
`data/`, so the two are separate. From source, **Update now** downloads the
release's source, replaces the app's own files (never `data/`; the replaced files are kept in
`_previous/`) and restarts.

### Use a shared Fence Builder server from the app

If your business runs a shared Fence Builder server (see below), the app can open it instead of its own copy:
**Settings → Fence Builder server**, type the server's address (for example `https://fence.example.com` or
`http://192.168.1.20:8787`) and press **Use this server**. The window then shows the server's sign-in page,
also the next times the app opens. The jobs on this computer stay where they are. To go back to them, press
**Use the copy on this computer** on the server's sign-in page or in its **Settings → Your account**. If the
server can't be reached when the app opens, the app shows this computer's copy and says so.

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
(it needs the internet and the Fence Builder app or server; drawing never waits for it):

- **Soil and rock** (USDA soil survey): which soils the line crosses and for how many feet, rocks bigger than 3 inches,
  and how deep bedrock or hardpan is. For example: "Rocky ground on 620 ft. Bedrock as shallow as 20 in."
- **Water**: streams, rivers, canals and ditches it crosses (USGS), feet in a flood zone (FEMA), and feet through
  wetlands (US Fish and Wildlife). Wetlands and flood zones may need a permit: check before you build.
- **Trees and brush** (LANDFIRE): feet through trees and through thick brush.

You see it under **Ground along this fence** on each line's page, and for the whole job under **The ground** on the
Final bill, with two buttons:

- **Use 10%** (or whatever it suggests) sets the site difficulty: up to 15% for rocky ground and up to 15% for bedrock or
  hardpan within 40 inches, by how much of the fence is on it.
- **Add a clearing fee** adds "Clearing trees and brush" to the other fees, at $ per foot for trees and for brush set in
  **Settings → Ground and clearing** (starting guesses: $4 and $1.50 a foot).

Nothing on the bill changes until you press a button. The braces on each bank of a river or creek ("Gates at roads, braces
at rivers") come from the same USGS stream map, which has many ditches the street map misses; the street map is the backup
when USGS doesn't answer.

The Builder map's layer list has **Soils**, **Streams and ditches**, **Flood zones**, **Wetlands** and **Trees and brush**
(off to start; zoom in to see them). These maps are a guide for planning, not a survey. They are not saved with offline
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
- `ground.py` looks up the ground along a fence line (soil, water, trees) on public federal maps for the
  app; `static/js/68-ground.js` shows it.
- `static/index.html` is the page, `static/app.css` its look, and `static/view3d.js` the 3D view.
- The app's script is kept in pieces in `static/js/`, numbered in the order they run
  (`00-basics.js` … `95-start.js`). The server joins them into one script, `app.js`, so the
  pieces share everything, as if they were one file.
- `tests/smoke.py` opens the app in a hidden browser and checks every page, the single-user way and as a
  shared server; `tests/test_multiuser.py` checks the shared server's sign-in and security (see `tests/README.md`).

## Making a release

1. Put the new version number in `VERSION` (for example `1.1.0`) and commit it.
2. Tag that commit and push the tag:

       git tag v1.1.0
       git push origin v1.1.0

   The **Release installer** workflow (`.github/workflows/release.yml`) builds
   `FenceBuilder.exe` with PyInstaller (`installer/fence-builder.spec`), wraps it with
   Inno Setup (`installer/fence-builder.iss`), and creates the GitHub release with
   `FenceBuilder-Setup-1.1.0.exe` attached. Installed apps offer the update once the
   installer is attached. The tag must match `VERSION` or the build stops.

   Before it builds anything, the workflow checks the app still works: it starts it on an
   empty data folder in a hidden browser, opens every page, adds a test job and checks the
   Final bill (`tests/smoke.py`, see `tests/README.md`). If that check fails, the build
   stops and no installer is made, so a broken version never reaches anyone. The Actions
   page shows what went wrong. You can run the same check yourself first with
   `py tests/smoke.py`.

### Signing the installer (optional)

Right now the installer is not signed, so Windows shows a blue "Windows protected your PC"
box the first time someone runs it (they click **More info**, then **Run anyway**). Signing
it with a code-signing certificate makes that warning go away (right away with an EV
certificate or Azure Trusted Signing; an ordinary OV certificate earns trust over time as
more people install it). Nothing needs to change in the code to turn it on:

1. Get a code-signing certificate. Either buy an **OV or EV code-signing certificate**
   from a company such as DigiCert, Sectigo or SSL.com, or sign up for **Azure Trusted
   Signing** from Microsoft. (EV certificates and Azure Trusted Signing keep the key on a
   hardware token or in the cloud and cannot be saved as a .pfx file. Ask the seller for
   a certificate you can export as a `.pfx` file, or ask someone to help set up their
   signing service in the workflow.)
2. Save the certificate as a `.pfx` file with a password (the seller explains how; in
   Windows it is the certificate's **Export** button, choosing "Yes, export the private key").
3. Turn the file into text. In PowerShell, in the folder with the file:

       [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\certificate.pfx")) | Set-Clipboard

   That copies a long block of letters and numbers.
4. On GitHub open the repository, then **Settings** > **Secrets and variables** >
   **Actions** > **New repository secret**, and add two secrets:
   - `WINDOWS_CERT_PFX`: paste the long text from step 3.
   - `WINDOWS_CERT_PASSWORD`: the password of the .pfx file.
5. Make the next release as usual. The workflow signs `FenceBuilder.exe` and the setup
   file with it. Without these two secrets it just skips signing, as now.

Keep the .pfx file and its password private. Do not put them in the repository.

To build it on your own computer: `pip install pyinstaller`, then
`python -m PyInstaller installer/fence-builder.spec` (makes `dist/FenceBuilder/`), then with
[Inno Setup 6](https://jrsoftware.org/isdl.php): `iscc /DAppVersion=1.1.0 installer/fence-builder.iss`
(makes `dist/installer/`).
