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
*/

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

    // A worker already waiting from a previous visit.
    if (registration.waiting && navigator.serviceWorker.controller) {
      setWaitingWorker(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        // "installed" + an existing controller means this is an update to an
        // already-running app, not the very first install.
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting || installing);
        }
      });
    });

    // Reload exactly once when the new worker takes control.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  } catch {
    // Registration failure should never break the app; it just means no
    // offline support this session.
  }
};
