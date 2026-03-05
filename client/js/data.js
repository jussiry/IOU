/*
This module owns persistent client state for the IOU app. It stores and reads user data from IndexedDB, derives view models for page binders, and keeps mutation logic centralized.

It also manages first-time user creation with Nostr-compatible key material so the local user ID is an `npub` public key that can be used across compatible ecosystems.
*/

import {
  createConnectionModel,
  createEmptyAppState,
  createLogEntryModel,
  createPersonModel,
  createTransactionModel,
  normalizeAppState,
} from "./models/data-model.js";
import { deleteAppDatabase, loadAppState, saveAppState } from "./storage/indexeddb.js";
import { generateNostrKeyPair } from "./utils/nostr-keys.js";

const VERSION_KEY = "iou_version";
const LEGACY_STORAGE_KEY = "iou_state";

let cachedState = null;

const hasUser = (state) => {
  return Boolean(state?.user?.id && state?.user?.public_key);
};

const loadState = async () => {
  if (cachedState) return cachedState;
  const persistedState = await loadAppState();
  cachedState = normalizeAppState(persistedState);
  return cachedState;
};

const persistState = async (state) => {
  cachedState = state;
  await saveAppState(state);
  return state;
};

const ensureContacts = (state) => {
  if (!state.contacts || typeof state.contacts !== "object") {
    state.contacts = {};
  }
};

const ensureConnection = (person, friendId, friendName) => {
  if (!Array.isArray(person.connections)) {
    person.connections = [];
  }

  let connection = person.connections.find((entry) => entry.person_id === friendId);
  if (!connection) {
    connection = createConnectionModel({
      person_id: friendId,
      person_name: friendName || friendId,
      debt_eur: 0,
      trust_credit_limit_eur: 0,
      recent_transactions: [],
    });
    person.connections.push(connection);
  }

  connection.person_name = connection.person_name || friendName || friendId;
  if (!Array.isArray(connection.recent_transactions)) {
    connection.recent_transactions = [];
  }

  return connection;
};

const ensureContact = (state, contactId, contactName) => {
  ensureContacts(state);
  if (state.contacts[contactId]) {
    return state.contacts[contactId];
  }

  const contact = createPersonModel({
    id: contactId,
    name: contactName || contactId,
    public_key: contactId,
    private_key: "",
    connections: [],
  });
  state.contacts[contact.id] = contact;
  return contact;
};

const createId = (prefix = "tx") => {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
};

const buildView = (state) => {
  const user = state.user;
  const connections = Array.isArray(user.connections) ? user.connections : [];

  const connectionsWithInbound = connections.map((connection) => {
    const contact = state.contacts?.[connection.person_id];
    const backLink = contact?.connections?.find(
      (entry) => entry.person_id === user.id
    );
    const inboundCreditLimit = backLink?.trust_credit_limit_eur || 0;

    return {
      ...connection,
      person_name: contact?.name || connection.person_name || connection.person_id,
      inbound_credit_limit_eur: inboundCreditLimit,
    };
  });

  const creditAgreements = connectionsWithInbound.reduce((sum, connection) => {
    return sum + (connection.trust_credit_limit_eur || 0);
  }, 0);

  const friendsOweTotal = connectionsWithInbound.reduce((sum, connection) => {
    return sum + Math.max(connection.debt_eur || 0, 0);
  }, 0);
  const youOweTotal = connectionsWithInbound.reduce((sum, connection) => {
    return sum + Math.max(-(connection.debt_eur || 0), 0);
  }, 0);
  const netBalance = friendsOweTotal - youOweTotal;

  const availableCredit = connectionsWithInbound.reduce((sum, connection) => {
    const creditLimit = connection.inbound_credit_limit_eur || 0;
    const debtUsed = Math.max(connection.debt_eur || 0, 0);
    const remainingCredit = Math.max(creditLimit - debtUsed, 0);
    return sum + remainingCredit;
  }, 0);

  return {
    you: user,
    connections: connectionsWithInbound,
    totals: {
      netBalance,
      friendsOweTotal,
      youOweTotal,
      creditAgreements,
      availableCredit,
    },
    logs: Array.isArray(state.logs) ? state.logs : [],
  };
};

export const hasUserData = async () => {
  const state = await loadState();
  return hasUser(state);
};

export const createUser = async (name) => {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const {
    privateKeyHex,
    privateKeyNsec,
    publicKeyHex,
    publicKeyNpub,
  } = generateNostrKeyPair();

  const user = createPersonModel({
    id: publicKeyNpub,
    name: trimmedName || "You",
    public_key: publicKeyNpub,
    public_key_hex: publicKeyHex,
    private_key: privateKeyNsec,
    private_key_hex: privateKeyHex,
    connections: [],
  });

  const state = createEmptyAppState(user);
  await persistState(state);
  return buildView(state);
};

export const loadData = async () => {
  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }
  return buildView(state);
};

export const updateUserName = async (name) => {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  state.user.name = trimmedName;
  await persistState(state);
  return buildView(state);
};

export const ensureVersion = async (version) => {
  try {
    const storedVersion = window.localStorage.getItem(VERSION_KEY);
    if (version && storedVersion !== version) {
      await resetState();
      window.localStorage.setItem(VERSION_KEY, version);
    }
  } catch (error) {
    // ignore version storage failures
  }
};

export const resetState = async () => {
  cachedState = null;
  try {
    await deleteAppDatabase();
  } catch (error) {
    // ignore delete failures
  }

  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    window.localStorage.removeItem(VERSION_KEY);
  } catch (error) {
    // ignore clear failures
  }
};

export const createTransaction = async ({ friendId, amount, message }) => {
  if (!friendId || !amount || amount <= 0) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const user = state.user;
  const friend = ensureContact(state, friendId, friendId);
  const friendName = friend?.name || friendId;
  const trimmedMessage = typeof message === "string" ? message.trim() : "";

  const userConnection = ensureConnection(user, friendId, friendName);
  const friendConnection = ensureConnection(friend, user.id, user.name);

  userConnection.debt_eur = (userConnection.debt_eur || 0) - amount;
  friendConnection.debt_eur = (friendConnection.debt_eur || 0) + amount;

  const timestamp = new Date();
  const date = timestamp.toISOString().slice(0, 10);
  const transactionId = createId("tx");
  const note = trimmedMessage.length ? trimmedMessage : "IOU sent";

  userConnection.recent_transactions.unshift(
    createTransactionModel({
      id: transactionId,
      date,
      amount_eur: -amount,
      note,
    })
  );

  friendConnection.recent_transactions.unshift(
    createTransactionModel({
      id: transactionId,
      date,
      amount_eur: amount,
      note,
    })
  );

  const logText = `You sent ${amount.toFixed(2)}€ to ${friendName}`;
  const logEntry = createLogEntryModel({
    id: createId("log"),
    transaction_id: transactionId,
    timestamp: timestamp.toISOString(),
    text: logText,
    message: trimmedMessage,
    friend_id: friendId,
    amount_eur: amount,
  });

  state.logs = Array.isArray(state.logs) ? state.logs : [];
  state.logs.unshift(logEntry);

  await persistState(state);
  return buildView(state);
};
