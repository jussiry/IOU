/*
This module provides a reusable two-client browser test harness for the IOU app. It starts a dedicated local server, launches isolated Playwright browser contexts, and exposes helper actions for driving the app through realistic multi-user flows.

The harness stays intentionally generic: scenarios receive low-level client handles plus a set of higher-level navigation and query helpers, so we can reuse the same command to test different behaviors between two peers without rewriting the server or browser setup each time.
*/

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium, firefox, webkit } = require("playwright");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;
const DEFAULT_WAIT_MS = 15000;
const DEFAULT_VIEWPORT = {
  width: 430,
  height: 932,
};

const BROWSER_TYPES = {
  chromium,
  firefox,
  webkit,
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createConsoleCollector = (label, sink) => async (message) => {
  const parts = [];
  for (const arg of message.args()) {
    try {
      const value = await arg.jsonValue();
      parts.push(typeof value === "string" ? value : JSON.stringify(value));
    } catch {
      parts.push(arg.toString());
    }
  }

  sink.push({
    label,
    type: message.type(),
    text: parts.length ? parts.join(" ") : message.text(),
  });
};

const waitForServerReady = async (baseUrl, timeoutMs = DEFAULT_WAIT_MS) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, {
        method: "HEAD",
      });
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling until timeout
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for server at ${baseUrl}`);
};

const createTwoClientHarness = ({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  browserName = "chromium",
  headless = true,
  waitMs = DEFAULT_WAIT_MS,
} = {}) => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const serverEntry = path.join(repoRoot, "backend", "server.js");
  const baseUrl = `http://${host}:${port}`;

  let browser = null;
  let serverProcess = null;
  let serverStartedByHarness = false;
  const serverLogs = [];
  const clients = new Map();

  const startServer = async () => {
    if (serverProcess) {
      return;
    }

    serverProcess = spawn(process.execPath, [serverEntry], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOST: host,
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverStartedByHarness = true;

    serverProcess.stdout.on("data", (chunk) => {
      serverLogs.push(String(chunk));
    });
    serverProcess.stderr.on("data", (chunk) => {
      serverLogs.push(String(chunk));
    });

    await waitForServerReady(baseUrl, waitMs);
  };

  const ensureBrowser = async () => {
    if (!browser) {
      const browserType = BROWSER_TYPES[browserName];
      if (!browserType) {
        throw new Error(`Unsupported browser: ${browserName}`);
      }
      browser = await browserType.launch({ headless });
    }

    return browser;
  };

  const getClient = (label) => {
    return clients.get(label) || null;
  };

  const clearClientEvents = (client) => {
    if (!client) {
      return;
    }

    client.consoleEntries.length = 0;
  };

  const attachPageListeners = (client) => {
    client.page.on("console", createConsoleCollector(client.label, client.consoleEntries));
    client.page.on("pageerror", (error) => {
      client.consoleEntries.push({
        label: client.label,
        type: "pageerror",
        text: String(error?.stack || error),
      });
    });
  };

  const createClient = async ({ label, userName = "", initScripts = [] } = {}) => {
    assert(label, "Client label is required");
    await ensureBrowser();

    const context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
    });
    const page = await context.newPage();
    const consoleEntries = [];

    const client = {
      label,
      userName,
      context,
      page,
      consoleEntries,
    };
    attachPageListeners(client);
    clients.set(label, client);

    for (const script of initScripts) {
      await page.addInitScript(script);
    }

    await page.goto(`${baseUrl}/#welcome`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('[data-bind="welcome-name"]', {
      timeout: waitMs,
    });

    if (userName) {
      await bootstrapUser(client, userName);
    }

    return client;
  };

  const createSeededClient = async ({ label, seed, hash = "balance", initScripts = [] } = {}) => {
    assert(label, "Client label is required");
    assert(seed && typeof seed === "object", "Seed state is required");
    await ensureBrowser();

    const context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
    });
    const page = await context.newPage();
    const consoleEntries = [];

    const client = {
      label,
      userName: seed?.user?.name || "",
      context,
      page,
      consoleEntries,
    };
    attachPageListeners(client);
    clients.set(label, client);

    // addInitScript runs at document_start on every navigation in this
    // context. It sets window.__IOU_SEED_STATE before any app module loads;
    // client/js/dev/seed.js awaits on this blob inside initApp (before
    // loadData), so the state is in IndexedDB by the time the first route
    // renders.
    await context.addInitScript((state) => {
      window.__IOU_SEED_STATE = state;
    }, seed);

    for (const script of initScripts) {
      await page.addInitScript(script);
    }

    await page.goto(`${baseUrl}/#${hash}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('nav [data-page="friends"]', {
      timeout: waitMs,
    });
    await page.waitForFunction(() => window.location.hash !== "#welcome", {
      timeout: waitMs,
    });
    await delay(750);

    return client;
  };

  const reopenClient = async (client, { hash = "friends" } = {}) => {
    await client.page.close();
    const page = await client.context.newPage();
    client.page = page;
    attachPageListeners(client);
    await page.goto(`${baseUrl}/#${hash}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('nav [data-page="friends"]', {
      timeout: waitMs,
    });
    await delay(1000);
  };

  const bootstrapUser = async (client, userName) => {
    client.userName = userName;
    await client.page.fill('[data-bind="welcome-name"]', userName);
    // Call .click() inside the page to trigger form submission. Going through
    // page.click() hangs on Playwright's auto-wait-for-navigation because the
    // form handler preventDefaults and routes via hash change instead.
    await client.page.evaluate(() => {
      document.querySelector('[data-action="create-user"]').click();
    });
    await client.page.waitForSelector('nav [data-page="friends"]', {
      timeout: waitMs,
    });
    await client.page.waitForFunction(() => window.location.hash !== "#welcome", {
      timeout: waitMs,
    });
    await delay(750);
  };

  const navigateHash = async (client, hash, waitSelector) => {
    await client.page.evaluate((nextHash) => {
      window.location.hash = nextHash;
    }, hash);
    if (waitSelector) {
      await client.page.waitForSelector(waitSelector, {
        timeout: waitMs,
      });
    }
    await delay(600);
  };

  const clickNav = async (client, pageName, waitSelector) => {
    await client.page.click(`nav [data-page="${pageName}"]`);
    if (waitSelector) {
      await client.page.waitForSelector(waitSelector, {
        timeout: waitMs,
      });
    }
    await delay(600);
  };

  const reloadClient = async (client, waitSelector = 'nav [data-page="friends"]') => {
    await client.page.reload({
      waitUntil: "domcontentloaded",
    });
    if (waitSelector) {
      await client.page.waitForSelector(waitSelector, {
        timeout: waitMs,
      });
    }
    await delay(1000);
  };

  const readMyKey = async (client) => {
    await navigateHash(client, "add-friend", '[data-bind="my-key"]');
    return client.page.inputValue('[data-bind="my-key"]');
  };

  const submitFriendRequest = async (client, friendKey) => {
    await navigateHash(client, "add-friend", '[data-bind="friend-key"]');
    await client.page.fill('[data-bind="friend-key"]', friendKey);
    await client.page.click('[data-bind="add-friend-submit"]');
    await client.page.waitForFunction(() => window.location.hash.startsWith("#friend/"), {
      timeout: waitMs,
    });
    await delay(1000);
  };

  const waitForFriendRows = async (client, expectedCount = 1) => {
    await clickNav(client, "friends", "#page-content");
    await client.page.waitForFunction(
      (count) => document.querySelectorAll(".friend-row").length >= count,
      expectedCount,
      {
        timeout: waitMs,
      }
    );
    await delay(750);
  };

  const openFirstFriend = async (client) => {
    await waitForFriendRows(client, 1);
    await client.page.locator(".friend-row").first().click();
    await client.page.waitForSelector('.friend-content', {
      timeout: waitMs,
    });
    await delay(600);
  };

  const acceptFirstFriend = async (client) => {
    await openFirstFriend(client);
    await client.page.waitForSelector('[data-action="accept-friend"]', {
      timeout: waitMs,
    });
    await client.page.click('[data-action="accept-friend"]');
    await delay(1000);
  };

  const rejectFirstFriend = async (client) => {
    await openFirstFriend(client);
    await client.page.waitForSelector('[data-action="reject-friend"]', {
      timeout: waitMs,
    });
    await client.page.click('[data-action="reject-friend"]');
    await delay(1000);
  };

  const removeFirstRequest = async (client) => {
    await openFirstFriend(client);
    await client.page.waitForSelector('[data-action="remove-request"]', {
      timeout: waitMs,
    });
    await client.page.click('[data-action="remove-request"]');
    await delay(1000);
  };

  const getPeerConnectionCount = async (client) => {
    await clickNav(client, "logs", '[data-bind="peer-connections"]');
    const text = await client.page.locator('[data-bind="peer-connections"]').textContent();
    return text ? text.trim() : "";
  };

  const waitForPeerConnectionCount = async (client, expectedCount) => {
    await clickNav(client, "logs", '[data-bind="peer-connections"]');
    await client.page.waitForFunction(
      (expectedValue) => {
        const valueElement = document.querySelector('[data-bind="peer-connections"]');
        return valueElement?.textContent?.trim() === String(expectedValue);
      },
      expectedCount,
      {
        timeout: waitMs,
      }
    );
    return String(expectedCount);
  };

  const getFriendIconClass = async (client, index = 0) => {
    await waitForFriendRows(client, index + 1);
    return client.page
      .locator('[data-bind="friend-icon"]')
      .nth(index)
      .evaluate((element) => element.getAttribute("class"));
  };

  const getFriendRowText = async (client, index = 0) => {
    await waitForFriendRows(client, index + 1);
    return client.page.locator(".friend-row").nth(index).innerText();
  };

  const getPageText = async (client) => {
    return client.page.locator("#page-content").innerText();
  };

  const getHash = async (client) => {
    return client.page.evaluate(() => window.location.hash);
  };

  const getTransportLogs = (client, pattern = /(Realtime|WebRTC|Peer)/) => {
    return client.consoleEntries.filter((entry) => pattern.test(entry.text));
  };

  const getClientErrors = (client, pattern = /.*/) => {
    return client.consoleEntries.filter((entry) => {
      const isErrorType =
        entry.type === "pageerror" ||
        entry.type === "error" ||
        entry.type === "warning";
      return isErrorType && pattern.test(entry.text);
    });
  };

  const close = async () => {
    for (const client of clients.values()) {
      await client.context.close();
    }
    clients.clear();

    if (browser) {
      await browser.close();
      browser = null;
    }

    if (serverProcess && serverStartedByHarness) {
      serverProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        serverProcess.once("exit", resolve);
      });
    }

    serverProcess = null;
    serverStartedByHarness = false;
  };

  return {
    assert,
    baseUrl,
    host,
    port,
    browserName,
    waitMs,
    delay,
    startServer,
    createClient,
    createSeededClient,
    getClient,
    getServerLogs: () => [...serverLogs],
    helpers: {
      bootstrapUser,
      clearClientEvents,
      navigateHash,
      clickNav,
      reloadClient,
      reopenClient,
      readMyKey,
      submitFriendRequest,
      waitForFriendRows,
      openFirstFriend,
      acceptFirstFriend,
      rejectFirstFriend,
      removeFirstRequest,
      getPeerConnectionCount,
      waitForPeerConnectionCount,
      getFriendIconClass,
      getFriendRowText,
      getPageText,
      getHash,
      getTransportLogs,
      getClientErrors,
    },
    close,
  };
};

module.exports = {
  createTwoClientHarness,
};
