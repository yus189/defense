# tools/ — performance verification harness

Repeatable, headless performance checks that drive the running app through the Chrome DevTools
Protocol (no Playwright/Puppeteer needed — just system Chrome and the `ws` dependency). These are
how the performance claims in ARCHITECTURE.md were measured, and they double as a CI-ready gate.

## Usage

```bash
# 1) start the app
npm run dev

# 2) launch headless Chrome with remote debugging
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-perf http://localhost:5173 &

# 3) run a check
node tools/perf-fps-under-load.mjs        # FPS at high feed rate, idle + continuous scroll
node tools/perf-filter-under-churn.mjs    # search/filter correctness + FPS while data churns
```

Each script injects an independent rAF-based FPS meter, drives the UI (feed rate slider, filter
chips, scrolling) via CDP, asserts the invariants, and writes screenshots to `/tmp`.

Measured on a 120Hz display: sustained 120fps at 800 updates/sec (idle and scrolling); 0 rows
violating an active filter under ~2000 updates/sec of churn.

> Next step: port these into a Playwright spec so they run in CI on every change.
