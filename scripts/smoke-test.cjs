#!/usr/bin/env node
/*
Post-deploy smoke test. Fetches each URL and checks that:
  - the response status is 2xx
  - the response body has non-zero content length

Exit code 0 = all passed, 1 = one or more failed.

To add a new URL, append an entry to the URLS array below.
*/

const https = require("https");
const http = require("http");

// ---------------------------------------------------------------------------
// URLs to check
// ---------------------------------------------------------------------------
const URLS = [
  "https://tally.earth",
  "https://app.tally.earth",
  "https://app.tally.earth/dist/js/app.js",
  "https://iou-ui.up.railway.app",
  "https://tally.earth/tally-teaching.html",
  "https://tally.earth/dist/tally-teaching.js"
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TIMEOUT_MS = 15_000;
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const MUTED = "\x1b[2m";

const pass = (msg) => `${GREEN}✓${RESET} ${msg}`;
const fail = (msg) => `${RED}✗${RESET} ${msg}`;

const fetchUrl = (url) =>
  new Promise((resolve) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { timeout: TIMEOUT_MS }, (res) => {
      const status = res.statusCode;
      let bytes = 0;
      res.on("data", (chunk) => { bytes += chunk.length; });
      res.on("end", () => resolve({ ok: status >= 200 && status < 300 && bytes > 0, status, bytes, error: null }));
      res.resume();
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: null, bytes: 0, error: "timeout" }); });
    req.on("error", (err) => resolve({ ok: false, status: null, bytes: 0, error: err.message }));
  });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log(`\n${BOLD}Smoke test — ${new Date().toUTCString()}${RESET}\n`);

  const results = await Promise.all(
    URLS.map(async (url) => {
      const { ok, status, bytes, error } = await fetchUrl(url);
      return { url, ok, status, bytes, error };
    })
  );

  const maxLen = Math.max(...URLS.map((u) => u.length));
  let failures = 0;

  for (const { url, ok, status, bytes, error } of results) {
    const padded = url.padEnd(maxLen);
    if (ok) {
      console.log(pass(`${padded}  ${MUTED}${status}  ${(bytes / 1024).toFixed(1)} kB${RESET}`));
    } else {
      const detail = error || `status ${status}, ${bytes} bytes`;
      console.log(fail(`${padded}  ${RED}${detail}${RESET}`));
      failures++;
    }
  }

  console.log(`\n${failures === 0 ? `${GREEN}All ${results.length} URLs OK${RESET}` : `${RED}${failures} of ${results.length} failed${RESET}`}\n`);
  process.exit(failures > 0 ? 1 : 0);
})();
