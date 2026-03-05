#!/usr/bin/env node
/*
This script runs the IOU development server and restarts it whenever files under `/backend` or `/client` change. It adds a debounce window so rapid bursts of edits trigger a single restart.

The watcher logic keeps directory subscriptions in sync recursively, including newly created folders, without external dependencies. This replaces `node --watch` to provide deterministic restart behavior across all client and server files.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SERVER_ENTRY = path.join(PROJECT_ROOT, "backend", "server.js");
const WATCH_ROOTS = [
  path.join(PROJECT_ROOT, "backend"),
  path.join(PROJECT_ROOT, "client"),
];

const RESTART_DELAY_MS = Number.parseInt(
  process.env.DEV_RESTART_DELAY_MS || "250",
  10
);
const RELOAD_SIGNAL_DELAY_MS = Number.parseInt(
  process.env.DEV_RELOAD_SIGNAL_DELAY_MS || "120",
  10
);
const DEV_SERVER_HOST = process.env.DEV_SERVER_HOST || "127.0.0.1";
const DEV_SERVER_PORT = Number.parseInt(process.env.PORT || "3000", 10);

const activeWatchers = new Map();
const refreshTimersByRoot = new Map();

let serverProcess = null;
let restartTimer = null;
let restartQueued = false;
let isShuttingDown = false;

const isSubPath = (targetPath, rootPath) => {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
};

const listDirectoriesRecursively = (rootPath) => {
  if (!fs.existsSync(rootPath)) return [];
  const directoryQueue = [rootPath];
  const directories = [];

  while (directoryQueue.length > 0) {
    const currentDirectory = directoryQueue.shift();
    directories.push(currentDirectory);

    let entries = [];
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    entries.forEach((entry) => {
      if (!entry.isDirectory()) return;
      directoryQueue.push(path.join(currentDirectory, entry.name));
    });
  }

  return directories;
};

const startServer = () => {
  if (isShuttingDown) return;

  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      IOU_DEV_SERVER: "1",
    },
    stdio: "inherit",
  });

  serverProcess.once("exit", () => {
    serverProcess = null;
    if (isShuttingDown) return;
    if (!restartQueued) return;

    restartQueued = false;
    startServer();
  });
};

const notifyClientsToReload = () =>
  new Promise((resolve) => {
    const request = http.request(
      {
        host: DEV_SERVER_HOST,
        method: "POST",
        path: "/__dev/reload-trigger",
        port: DEV_SERVER_PORT,
        timeout: 400,
      },
      (response) => {
        response.resume();
        response.on("end", resolve);
      }
    );

    request.on("error", resolve);
    request.on("timeout", () => {
      request.destroy();
      resolve();
    });
    request.end();
  });

const requestRestart = async () => {
  if (isShuttingDown) return;
  if (restartQueued) return;

  restartQueued = true;
  if (!serverProcess) {
    restartQueued = false;
    startServer();
    return;
  }

  await notifyClientsToReload();
  await new Promise((resolve) => {
    setTimeout(resolve, RELOAD_SIGNAL_DELAY_MS);
  });
  serverProcess.kill("SIGTERM");
};

const scheduleRestart = () => {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    void requestRestart();
  }, RESTART_DELAY_MS);
};

const scheduleRootRefresh = (rootPath) => {
  const existingTimer = refreshTimersByRoot.get(rootPath);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    refreshTimersByRoot.delete(rootPath);
    syncWatchersForRoot(rootPath);
  }, 120);

  refreshTimersByRoot.set(rootPath, timer);
};

const registerWatcher = (directoryPath, rootPath) => {
  if (activeWatchers.has(directoryPath)) return;

  try {
    const watcher = fs.watch(directoryPath, () => {
      scheduleRestart();
      scheduleRootRefresh(rootPath);
    });

    watcher.on("error", () => {
      if (activeWatchers.get(directoryPath) === watcher) {
        activeWatchers.delete(directoryPath);
      }
      scheduleRootRefresh(rootPath);
    });

    activeWatchers.set(directoryPath, watcher);
  } catch (error) {
    // ignore transient watch failures
  }
};

const removeWatcher = (directoryPath) => {
  const watcher = activeWatchers.get(directoryPath);
  if (!watcher) return;
  watcher.close();
  activeWatchers.delete(directoryPath);
};

function syncWatchersForRoot(rootPath) {
  const discoveredDirectories = new Set(listDirectoriesRecursively(rootPath));

  activeWatchers.forEach((_, watchedPath) => {
    if (!isSubPath(watchedPath, rootPath)) return;
    if (discoveredDirectories.has(watchedPath)) return;
    removeWatcher(watchedPath);
  });

  discoveredDirectories.forEach((directoryPath) => {
    registerWatcher(directoryPath, rootPath);
  });
}

const stopServer = () =>
  new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    const runningProcess = serverProcess;
    const killTimeout = setTimeout(() => {
      if (runningProcess.exitCode == null && runningProcess.signalCode == null) {
        runningProcess.kill("SIGKILL");
      }
    }, 1500);

    runningProcess.once("exit", () => {
      clearTimeout(killTimeout);
      resolve();
    });

    runningProcess.kill("SIGTERM");
  });

const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  refreshTimersByRoot.forEach((timer) => clearTimeout(timer));
  refreshTimersByRoot.clear();

  activeWatchers.forEach((watcher) => watcher.close());
  activeWatchers.clear();

  await stopServer();
  process.exit(0);
};

WATCH_ROOTS.forEach((rootPath) => {
  syncWatchersForRoot(rootPath);
});

startServer();

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
