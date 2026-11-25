# Fence Builder

Draw fence lines on a satellite map and get the footage (following the ground slope),
every post, brace and roll of wire you need, what it costs, and a final bill with labor
and fees. Runs as a Windows app or as a small web server for your whole network.

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

## Run it as a server for your network

    python server.py
    # open http://localhost:8787, or http://<this computer's address>:8787 from a phone

With Docker (TrueNAS custom app works too):

    docker compose up -d --build

Your data is saved to `data/fence-data.json`, with hourly copies in `data/backups/`.
Set `FENCE_PASS` to require a login (user name `fence`) before opening it to other people.
"My location" on a phone only works over https, so put it behind nginx with a certificate
(see `nginx-fence.conf`).

## Using it

- **Jobs** is a board of every job by stage: Bid, Scheduled, In progress, Done.
- **Builder** is the map. Set up the fence on the left (wire, posts, braces), then
  **Draw fence** (F) and click each corner. Ends, corners and gates get braces, and posts
  space themselves evenly between braces. Zoom in to drag single posts or pull braces.
- **Final bill** lists every material to buy, what each one is for, and a link to buy it,
  then labor (each fence type's $ per foot), headache charges and other fees.
- **Fence types**, **Braces** and **Materials** are your own library. Changes there wait
  for **Save**. Materials can be found in Kencove or D&B Supply from inside the app, and
  prices from store links update on their own once a day. For stores that only let people
  see their pages (like Premier 1 Supplies), use the **Add to Fence Builder** bookmark
  on the Materials page.

## How the counts work

- Wire is counted per fence type from strands, roll length and extra for sag and splices.
  All lines of the same type are added up before rounding. If you list the other roll sizes a
  wire comes in, each stretch gets the cheapest mix of rolls instead, so short stretches use
  short rolls. Wires are listed bottom to top, with their height and spacing in inches.
- Posts are counted per stretch between braces: `ceil(stretch / spacing) - 1`, spaced
  evenly. Added posts (for example every 5th post, or one every 100 ft) are centred in
  each stretch so both ends match.
- A bend sharper than the corner angle (25 degrees to start) is a corner.
- A run longer than the longest stretch for its wire (660 ft for woven wire, by default)
  gets a pull brace to stretch into.
- Heights come from USGS 3DEP LiDAR (1 m in most of the US), or Open-Meteo outside it.

## LiDAR map layers and 3D

- Layers: satellite, streets, LiDAR bare earth, topo, contour lines, slope.
- 3D view shows the terrain with the satellite photo, every post, wire, brace and gate at
  real size, and nearby buildings. Move with W A S D or the arrow keys.

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

To build it on your own computer: `pip install pyinstaller`, then
`python -m PyInstaller installer/fence-builder.spec` (makes `dist/FenceBuilder/`), then with
[Inno Setup 6](https://jrsoftware.org/isdl.php): `iscc /DAppVersion=1.1.0 installer/fence-builder.iss`
(makes `dist/installer/`).
