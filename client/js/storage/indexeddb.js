/*
This module provides a minimal IndexedDB wrapper for the IOU app state. It centralizes database opening, object store setup, and basic get/put/delete operations under one stable API.

By isolating IndexedDB transaction boilerplate here, data modules can focus on business logic and state shape instead of browser storage wiring details.
*/

const DATABASE_NAME = "iou_client_db";
const DATABASE_VERSION = 1;
const STORE_NAME = "app_state";
const APP_STATE_KEY = "root_state";

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

    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () =>
      reject(openRequest.error || new Error("Failed to open IndexedDB database."));
  });
};

const getDatabase = async () => {
  if (!databasePromise) {
    databasePromise = openDatabase();
  }
  return databasePromise;
};

const withStore = async (mode, runOperation) => {
  const database = await getDatabase();
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
    return await withStore("readonly", (store) => store.get(APP_STATE_KEY));
  } catch (error) {
    return null;
  }
};

export const saveAppState = async (state) => {
  await withStore("readwrite", (store) => store.put(state, APP_STATE_KEY));
  return state;
};

export const deleteAppDatabase = async () => {
  try {
    if (databasePromise) {
      const database = await databasePromise;
      database.close();
    }
  } catch (error) {
    // ignore close failures
  } finally {
    databasePromise = null;
  }

  return new Promise((resolve, reject) => {
    const deleteRequest = window.indexedDB.deleteDatabase(DATABASE_NAME);
    deleteRequest.onsuccess = () => resolve();
    deleteRequest.onblocked = () =>
      reject(new Error("IndexedDB database deletion was blocked."));
    deleteRequest.onerror = () =>
      reject(deleteRequest.error || new Error("Failed to delete IndexedDB database."));
  });
};
