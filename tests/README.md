# Tests

`smoke.py` starts the server on a new, empty temp data folder (your real jobs are never touched),
opens the app in a hidden Chromium browser, clicks every page, adds a test job with a fence line,
and checks the Final bill shows a fence length and a total. It fails on any JavaScript error.

Run it from the repository folder:

    py -m pip install playwright
    py -m playwright install chromium
    py tests/smoke.py

Options: `--headed` shows the browser, `--online` lets the page load maps and other sites (by
default every request to another site is blocked so the result does not depend on the internet),
`--shot fail.png` saves a screenshot when something fails.

The release workflow runs this before it builds the installer; if it fails, no installer is made.
