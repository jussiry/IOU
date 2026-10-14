/*
Owns the service-worker lifecycle and the app's "update available" state.

The service worker (../sw.js) precaches the whole app and installs new versions
into a "waiting" state without auto-activating, so the running page is never
reloaded mid-interaction. This module registers the worker, watches for a
waiting worker to appear, and exposes that as a single piece of global UI state:

  - isUpdateAvailable() — true once a new version is installed and waiting
  - onUpdateChange(cb)  — subscribe to availability changes (for nav badge etc.)
  - applyUpdate()       — tell the waiting worker to take over, then reload

Keeping this separate from the data model lets the nav badge, the settings page
banner, and the new-version toast all read one source of truth without threading
update state through the per-page data payload.
@category ui
*/

// How often an open tab polls for a new version, and the minimum gap between
// any two checks (visibility/focus events can fire in quick bursts).
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const UPDATE_CHECK_MIN_GAP_MS = 60 * 1000;

let updateAvailable = false;
let waitingWorker = null;
let reloading = false;
const listeners = new Set();

export const isUpdateAvailable = () => updateAvailable;

export const onUpdateChange = (callback) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};

const setWaitingWorker = (worker) => {
  if (!worker || updateAvailable) return;
  waitingWorker = worker;
  updateAvailable = true;
  listeners.forEach((callback) => callback(true));
};

export const applyUpdate = () => {
  if (!waitingWorker) {
    window.location.reload();
    return;
  }
  // When the new worker activates it claims this client; controllerchange then
  // fires and we reload onto the fresh assets.
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
};

/**
 * Registers the service worker and begins watching for updates. Safe to call
 * once at startup; a no-op when service workers are unsupported (e.g. plain
 * http on some browsers) so the app still runs without offline support.
 */
export const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register("sw.js", {
      updateViaCache: "none",
    });

    // A worker already waiting at page-load time means an update was installed
    // on an earlier visit but never activated. A load (manual reload or fresh
    // open) is a safe moment to switch versions, so apply it now — this is what
    // makes a normal browser reload pick up the newest version. The controller-
    // change listener below then reloads onto the fresh assets. (In-session
    // updates are handled by `updatefound` and stay parked in "waiting" so we
    // never reload the page out from under an active interaction.)
    const appliedAtLoad = Boolean(registration.waiting && navigator.serviceWorker.controller);
    if (appliedAtLoad) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    // Surface a worker that has finished installing as an update — but only
    // when one is already in control, i.e. this is an update to a running
    // app and not the very first install.
    const surfaceWaiting = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        setWaitingWorker(registration.waiting);
      }
    };
    const watchInstalling = (worker) => {
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") surfaceWaiting();
      });
    };
    registration.addEventListener("updatefound", () => watchInstalling(registration.installing));
    // The browser runs its own update check on page load, and that install can
    // begin before the listener above exists — its updatefound is then lost
    // and the update would surface only after another reload. Pick up any
    // install already in flight, or one that finished in the meantime.
    watchInstalling(registration.installing);
    if (!appliedAtLoad) surfaceWaiting();

    // Browsers check for a new worker only on navigation (plus a lazy ~24h
    // check). An installed mobile app is reopened constantly, so it notices
    // updates on its own; a desktop tab can stay open for days without ever
    // navigating. So ask explicitly: whenever the app comes back into view or
    // back online, and on a timer while it stays open. update() is a cheap
    // conditional fetch of sw.js, throttled here so focus churn can't spam it.
    let lastCheck = Date.now();
    const checkForUpdate = () => {
      if (updateAvailable || Date.now() - lastCheck < UPDATE_CHECK_MIN_GAP_MS) return;
      lastCheck = Date.now();
      registration.update().then(surfaceWaiting, () => {});
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
    window.addEventListener("focus", checkForUpdate);
    window.addEventListener("online", checkForUpdate);
    window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

    // Reload exactly once when a new worker replaces the current one. On a
    // first visit the page has no controller and the fresh worker's
    // clients.claim() also fires controllerchange — the page already runs the
    // newest assets then, so reloading would only interrupt it.
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    });
  } catch {
    // Registration failure should never break the app; it just means no
    // offline support this session.
  }
};
