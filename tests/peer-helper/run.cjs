/*
Peer helper — drives a second user (Bob or Carol) headlessly via Playwright
while the preview browser shows Alice's UI. Use this to test how Alice's UI
reacts to actions taken by another user.

Usage:
  node tests/peer-helper/run.cjs --user bob --action changeName --value Robert
  node tests/peer-helper/run.cjs --user carol --action changeName --value Caroline
  node tests/peer-helper/run.cjs --user bob --action acceptFriend
  node tests/peer-helper/run.cjs --user bob --action sendPaymentRequest --amount 25 --note "Dinner"
  node tests/peer-helper/run.cjs --user bob --action cancelPaymentRequest

Options:
  --user      bob | carol (required)
  --action    Action to perform (required, see list below)
  --value     String value for changeName
  --amount    Euro amount for sendPaymentRequest
  --note      Note for sendPaymentRequest
  --port      Dev server port (default: 3000)
  --headed    Show the browser window (useful for debugging)
  --wait      Extra ms to wait after action before closing (default: 2000)

Available actions:
  changeName            Change the user's display name (requires --value)
  acceptFriend          Accept the first incoming friend request
  rejectFriend          Reject the first incoming friend request
  sendPaymentRequest    Send a payment request to first friend (requires --amount)
  cancelPaymentRequest  Cancel the outgoing payment request to first friend

The browser is always opened headless (unless --headed) and closed after the
action completes. The helper connects to the same dev server as the preview
browser, so peer messages flow naturally via WebSocket signaling + WebRTC.
*/

const { chromium } = require("playwright");

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const parseArgs = (argv) => {
  const opts = {
    user: null,
    action: null,
    value: null,
    amount: null,
    note: "",
    port: Number(process.env.TEST_PORT) || 3000,
    headed: false,
    wait: 2000,
  };

  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--user" && argv[i + 1]) { opts.user = argv[++i]; continue; }
    if (v === "--action" && argv[i + 1]) { opts.action = argv[++i]; continue; }
    if (v === "--value" && argv[i + 1]) { opts.value = argv[++i]; continue; }
    if (v === "--amount" && argv[i + 1]) { opts.amount = Number(argv[++i]); continue; }
    if (v === "--note" && argv[i + 1]) { opts.note = argv[++i]; continue; }
    if (v === "--port" && argv[i + 1]) { opts.port = Number(argv[++i]); continue; }
    if (v === "--headed") { opts.headed = true; continue; }
    if (v === "--wait" && argv[i + 1]) { opts.wait = Number(argv[++i]); continue; }
  }

  return opts;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const actions = {
  async changeName(page, opts) {
    if (!opts.value) throw new Error("--value required for changeName");
    // Navigate to settings
    await page.click('nav button:last-child');
    await page.waitForSelector('[data-action="edit-user-name"]');
    await page.click('[data-action="edit-user-name"]');
    await page.waitForSelector('[data-action="name-input"]');
    await page.fill('[data-action="name-input"]', opts.value);
    await page.click('.settings-name-save');
    console.log(`  → ${opts.user} changed name to "${opts.value}"`);
  },

  async acceptFriend(page) {
    // Navigate to friends list
    await page.click('nav button:nth-child(2)');
    await page.waitForSelector('.friends-list');
    // Open first friend row
    const rows = await page.$$('.friends-list button');
    if (!rows.length) throw new Error("No friend rows found");
    await rows[0].click();
    // Click accept
    await page.waitForSelector('[data-action="accept-friend"]');
    await page.click('[data-action="accept-friend"]');
    console.log(`  → ${opts.user} accepted friend request`);
  },

  async rejectFriend(page, opts) {
    await page.click('nav button:nth-child(2)');
    await page.waitForSelector('.friends-list');
    const rows = await page.$$('.friends-list button');
    if (!rows.length) throw new Error("No friend rows found");
    await rows[0].click();
    await page.waitForSelector('[data-action="reject-friend"]');
    await page.click('[data-action="reject-friend"]');
    console.log(`  → ${opts.user} rejected friend request`);
  },

  async sendPaymentRequest(page, opts) {
    if (!opts.amount || !Number.isFinite(opts.amount)) {
      throw new Error("--amount required for sendPaymentRequest");
    }
    // Navigate to friends, open first accepted friend
    await page.click('nav button:nth-child(2)');
    await page.waitForSelector('.friends-list');
    const rows = await page.$$('.friends-list button');
    if (!rows.length) throw new Error("No friend rows found");
    await rows[0].click();
    // Click Send button in header
    await page.waitForSelector('[data-action="send"]');
    await page.click('[data-action="send"]');
    // Fill amount and note
    await page.waitForSelector('[data-bind="send-amount"]');
    await page.fill('[data-bind="send-amount"]', String(opts.amount));
    if (opts.note) await page.fill('[data-bind="send-note"]', opts.note);
    // Submit as request
    await page.click('[data-action="request"]');
    console.log(`  → ${opts.user} sent payment request €${opts.amount}${opts.note ? ` (${opts.note})` : ""}`);
  },

  async cancelPaymentRequest(page, opts) {
    await page.click('nav button:nth-child(2)');
    await page.waitForSelector('.friends-list');
    const rows = await page.$$('.friends-list button');
    if (!rows.length) throw new Error("No friend rows found");
    await rows[0].click();
    await page.waitForSelector('[data-action="cancel-payment-request"]');
    await page.click('[data-action="cancel-payment-request"]');
    console.log(`  → ${opts.user} cancelled payment request`);
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const run = async () => {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.user) {
    console.error("Error: --user is required (bob | carol)");
    process.exitCode = 1;
    return;
  }
  if (!opts.action) {
    console.error("Error: --action is required");
    process.exitCode = 1;
    return;
  }
  const actionFn = actions[opts.action];
  if (!actionFn) {
    console.error(`Error: unknown action "${opts.action}". Available: ${Object.keys(actions).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const url = `http://127.0.0.1:${opts.port}/?seed=${opts.user}`;
  console.log(`[peer-helper] Opening ${opts.user} at ${url}`);

  const browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await context.newPage();

  try {
    await page.goto(url);
    // Wait for the app to finish seeding and reach the main UI
    await page.waitForSelector('nav button', { timeout: 15000 });
    // Brief settle — signaling connection needs a moment
    await page.waitForTimeout(1500);

    console.log(`[peer-helper] Running action: ${opts.action}`);
    await actionFn(page, opts);

    // Wait for peer message delivery before closing
    await page.waitForTimeout(opts.wait);
  } finally {
    await browser.close();
  }

  console.log(`[peer-helper] Done.`);
};

run().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
