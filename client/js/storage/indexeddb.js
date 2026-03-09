/*
This module provides a minimal IndexedDB wrapper for the IOU app state. It centralizes database opening, object store setup, and basic get/put/delete operations under one stable API.

By isolating IndexedDB transaction boilerplate here, data modules can focus on business logic and state shape instead of browser storage wiring details.
*/

const DATABASE_NAME = "iou_client_db";
const DATABASE_VERSION = 1;
const STORE_NAME = "app_state";
const APP_STATE_KEY = "root_state";
const APP_STATE_LOAD_TIMEOUT_MS = 2000;
const APP_STATE_WRITE_TIMEOUT_MS = 4000;

let databasePromise = null;

const ensureIndexedDb = () => {
  if (!window.indexedDB) {
    throw new Error("IndexedDB is not available in this browser.");
  }
};

const waitForRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });

const waitForTransaction = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });

const withTimeoutFallback = (promise, timeoutMs, fallbackValue, onTimeout = null) =>
  new Promise((resolve, reject) => {
    let settled = false;

    const settle = (callback) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      callback();
    };

    const timer = window.setTimeout(() => {
      settle(() => {
        if (typeof onTimeout === "function") {
          onTimeout();
        }
        resolve(fallbackValue);
      });
    }, timeoutMs);

    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error))
    );
  });

const withTimeoutError = (promise, timeoutMs, errorFactory, onTimeout = null) =>
  new Promise((resolve, reject) => {
    let settled = false;

    const settle = (callback) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      callback();
    };

    const timer = window.setTimeout(() => {
      settle(() => {
        if (typeof onTimeout === "function") {
          onTimeout();
        }
        reject(errorFactory());
      });
    }, timeoutMs);

    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error))
    );
  });

const openDatabase = () => {
  ensureIndexedDb();

  return new Promise((resolve, reject) => {
    const openRequest = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    openRequest.onupgradeneeded = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    openRequest.onblocked = () => {
      reject(new Error("Opening IndexedDB database was blocked."));
    };

    openRequest.onsuccess = () => {
      const database = openRequest.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };

    openRequest.onerror = () => {
      reject(openRequest.error || new Error("Failed to open IndexedDB database."));
    };
  });
};

const getDatabase = async () => {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
};

const withStore = async (mode, runOperation, { timeoutMs = null, timeoutFallback = null } = {}) => {
  const currentDatabasePromise = getDatabase();
  const resetStalledPromise = () => {
    if (databasePromise === currentDatabasePromise) {
      databasePromise = null;
    }
  };

  const database = timeoutMs == null
    ? await currentDatabasePromise
    : timeoutFallback !== null
    ? await withTimeoutFallback(currentDatabasePromise, timeoutMs, timeoutFallback, resetStalledPromise)
    : await withTimeoutError(
        currentDatabasePromise,
        timeoutMs,
        () => new Error("Timed out while opening IndexedDB database."),
        resetStalledPromise
      );

  if (!database) {
    return timeoutFallback;
  }

  const transaction = database.transaction(STORE_NAME, mode);
  const transactionDone = waitForTransaction(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const request = runOperation(store);
  const requestResult = await waitForRequest(request);
  await transactionDone;
  return requestResult;
};

export const loadAppState = async () => {
  try {
    return await withStore(
      "readonly",
      (store) => store.get(APP_STATE_KEY),
      {
        timeoutMs: APP_STATE_LOAD_TIMEOUT_MS,
        timeoutFallback: null,
      }
    );
  } catch (error) {
    return null;
  }
};

export const saveAppState = async (state) => {
  await withStore(
    "readwrite",
    (store) => store.put(state, APP_STATE_KEY),
    { timeoutMs: APP_STATE_WRITE_TIMEOUT_MS }
  );
  return state;
};

export const clearAppState = async () => {
  await withStore(
    "readwrite",
    (store) => store.delete(APP_STATE_KEY),
    { timeoutMs: APP_STATE_WRITE_TIMEOUT_MS }
  );
};

window.clearAppState = clearAppState
