# Fence Estimator

Draw fence lines on a satellite map and get the footage (following the ground slope),
every post, brace and roll of wire you need, what it costs, and a final bill with labor
and fees. Runs as a Windows app or as a small web server for your whole network.

## Install on Windows

1. Install [Python 3](https://www.python.org/downloads/) (tick "Add python.exe to PATH").
2. Download the newest release from the **Releases** page of this repository
   (Source code, zip) and unzip it where you want it to live.
3. Double-click `app.py`, or make a shortcut to it with `pyw.exe app.py` and the icon
   `fence.ico`. It opens in its own window and stops when you close the window.

### Updates

The app checks this repository when it opens and every few hours. When a newer release is
out, a green bar says so, with **Update now**. Updating downloads the release, replaces the
app's own files and restarts. Your jobs, prices and settings in `data/` are never touched,
and the files it replaced are kept in `_previous/`. You can also check from
**Settings → Version and updates**.

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
  see their pages (like Premier 1 Supplies), use the **Add to Fence Estimator** bookmark
  on the Materials page.

## How the counts work

- Wire is counted per fence type from strands, roll length and extra for sag and splices.
  All lines of the same type are added up before rounding.
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
