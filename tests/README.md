# Tests

`smoke.py` starts the server on a new, empty temp data folder (your real jobs are never touched),
opens the app in a hidden Chromium browser, clicks every page, adds a test job with a fence line,
and checks the Final bill shows a fence length and a total. It fails on any JavaScript error, and on
anything the page's security policy blocks. Then it opens the app at phone size (390 × 844) with a fake GPS
near Emmett: the bottom bar and the map's slide-up panel, then Walk the fence (two corners, a gate, one more
corner with the browser offline, the page reopened offline from the phone's copy, the line finished), and checks
that the walked line reached the server once back online and shows on the Final bill, and that a page that isn't
secure explains that the location needs https. The walk holds still 3 seconds per point, so this adds about half a
minute. It does this twice: the single-user way (like the Windows
app) and as a shared server with accounts, signed in as a test admin (`--only single` or `--only multi`
runs one).

Run it from the repository folder:

    py -m pip install playwright
    py -m playwright install chromium
    py tests/smoke.py

Options: `--headed` shows the browser, `--online` lets the page load maps and other sites (by
default every request to another site is blocked so the result does not depend on the internet),
`--shot fail.png` saves a screenshot when something fails.

`test_multiuser.py` checks the shared server (`FENCE_MODE=multi`) and the Windows app's single-user
mode: nobody gets in without signing in, wrong passwords get the same answer whether or not the user name
exists and are then locked out, one person can't read or change another's data, people who are not admins
can't use admin actions, requests from other websites and requests without the safety token are refused,
a turned-off account's sign-in stops at once, files outside the app can't be read, the price reader can't
reach private addresses, the self-update doesn't exist on a shared server, no password or code reaches a
log, and the sign-in, app and Accounts pages work in a hidden browser.

    py tests/test_multiuser.py           # --no-browser skips the hidden-browser part

The release workflow runs both before it builds the installer; if either fails, no installer is made.
