/*
This module owns persistent client state for the IOU app. It stores and reads user data from IndexedDB, derives view models for page binders, and keeps mutation logic centralized.

It also manages first-time user creation with Nostr-compatible key material so the local user ID is an `npub` public key that can be used across compatible ecosystems.
*/

import {
  createConnectionModel,
  createEmptyAppState,
  createLogEntryModel,
  createPersonModel,
  createPublicPersonModel,
  createTransactionModel,
  normalizeCurrencyAmount,
  normalizeAppState,
} from "./models/data-model.js";
import {
  clearAppState,
  loadAppState,
  saveAppState,
} from "./storage/indexeddb.js";
import { generateNostrKeyPair } from "./utils/nostr-keys.js";

const VERSION_KEY = "iou_version";

let cachedState = null;

const hasUser = (state) => {
  return Boolean(
    state?.user?.id &&
      state?.user?.public_key &&
      state.user.id === state.user.public_key
  );
};

const loadState = async () => {
  if (cachedState) return cachedState;
  const persistedState = await loadAppState();
  cachedState = normalizeAppState(persistedState);
  return cachedState;
};

const persistState = async (state) => {
  const normalizedState = normalizeAppState(state);
  if (!normalizedState) {
    throw new Error("Cannot persist invalid application state.");
  }

  cachedState = normalizedState;
  await saveAppState(normalizedState);
  return normalizedState;
};

const ensureContacts = (state) => {
  if (!state.contacts || typeof state.contacts !== "object") {
    state.contacts = {};
  }
};

const asTrimmedString = (value) => {
  return typeof value === "string" ? value.trim() : "";
};

const ensureConnection = (person, friendId, friendName) => {
  const normalizedFriendId = asTrimmedString(friendId);
  const normalizedFriendName = asTrimmedString(friendName);
  if (!normalizedFriendId) {
    return null;
  }

  if (!Array.isArray(person.connections)) {
    person.connections = [];
  }

  let connection = person.connections.find(
    (entry) => entry.person_id === normalizedFriendId
  );
  if (!connection) {
    connection = createConnectionModel({
      person_id: normalizedFriendId,
      person_name: normalizedFriendName || normalizedFriendId,
      debt_eur: 0,
      trust_credit_limit_eur: 0,
      recent_transactions: [],
    });
    person.connections.push(connection);
  }

  connection.person_name =
    normalizedFriendName || connection.person_name || normalizedFriendId;
  if (!Array.isArray(connection.recent_transactions)) {
    connection.recent_transactions = [];
  }

  return connection;
};

const ensureContact = (state, contactId, contactName) => {
  const normalizedContactId = asTrimmedString(contactId);
  const normalizedContactName = asTrimmedString(contactName);
  if (!normalizedContactId) {
    return null;
  }

  ensureContacts(state);
  if (state.contacts[normalizedContactId]) {
    const existingContact = state.contacts[normalizedContactId];
    if (normalizedContactName) {
      existingContact.name = normalizedContactName;
    }
    return existingContact;
  }

  const contact = createPublicPersonModel({
    id: normalizedContactId,
    name: normalizedContactName || normalizedContactId,
    public_key: normalizedContactId,
    connections: [],
  });
  state.contacts[contact.id] = contact;
  return contact;
};

const createId = (prefix = "tx") => {
  if (window.crypto?.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }

  const randomToken = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${randomToken}`;
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
    you: createPublicPersonModel(user),
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

const syncUserNameAcrossContacts = (state) => {
  if (!hasUser(state)) return;

  Object.values(state.contacts || {}).forEach((contact) => {
    const userConnection = Array.isArray(contact.connections)
      ? contact.connections.find((entry) => entry.person_id === state.user.id)
      : null;
    if (!userConnection) return;
    userConnection.person_name = state.user.name;
  });
};

export const hasUserData = async () => {
  const state = await loadState();
  return hasUser(state);
};

export const createUser = async (name) => {
  const trimmedName = asTrimmedString(name);
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
  const persistedState = await persistState(state);
  return buildView(persistedState);
};

export const loadData = async () => {
  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }
  return buildView(state);
};

export const updateUserName = async (name) => {
  const trimmedName = asTrimmedString(name);
  if (!trimmedName) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  state.user.name = trimmedName;
  syncUserNameAcrossContacts(state);
  const persistedState = await persistState(state);
  return buildView(persistedState);
};

export const ensureVersion = async (version) => {
  try {
    const storedVersion = window.localStorage.getItem(VERSION_KEY);
    if (version && storedVersion !== version) {
      //await resetState();
      window.localStorage.setItem(VERSION_KEY, version);
    }
  } catch (error) {
    // ignore version storage failures
  }
};

export const resetState = async () => {
  cachedState = null;
  try {
    await clearAppState();
  } catch (error) {
    // ignore clear failures
  }

  try {
    window.localStorage.removeItem(VERSION_KEY);
  } catch (error) {
    // ignore clear failures
  }
};

export const createTransaction = async ({ friendId, amount, message }) => {
  const normalizedFriendId = asTrimmedString(friendId);
  const normalizedAmount = normalizeCurrencyAmount(amount, NaN);
  if (!normalizedFriendId || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }
  if (normalizedFriendId === state.user.id) {
    return loadData();
  }

  const user = state.user;
  const friend = ensureContact(state, normalizedFriendId, normalizedFriendId);
  if (!friend) {
    return loadData();
  }

  const friendName = friend.name || normalizedFriendId;
  const trimmedMessage = asTrimmedString(message);

  const userConnection = ensureConnection(user, normalizedFriendId, friendName);
  const friendConnection = ensureConnection(friend, user.id, user.name);
  if (!userConnection || !friendConnection) {
    return loadData();
  }

  userConnection.debt_eur = (userConnection.debt_eur || 0) - normalizedAmount;
  friendConnection.debt_eur = (friendConnection.debt_eur || 0) + normalizedAmount;

  const timestamp = new Date();
  const date = timestamp.toISOString().slice(0, 10);
  const transactionId = createId("tx");
  const note = trimmedMessage.length ? trimmedMessage : "IOU sent";

  userConnection.recent_transactions.unshift(
    createTransactionModel({
      id: transactionId,
      date,
      amount_eur: -normalizedAmount,
      note,
    })
  );

  friendConnection.recent_transactions.unshift(
    createTransactionModel({
      id: transactionId,
      date,
      amount_eur: normalizedAmount,
      note,
    })
  );

  const logText = `You sent ${normalizedAmount.toFixed(2)}€ to ${friendName}`;
  const logEntry = createLogEntryModel({
    id: createId("log"),
    transaction_id: transactionId,
    timestamp: timestamp.toISOString(),
    text: logText,
    message: trimmedMessage,
    friend_id: normalizedFriendId,
    amount_eur: normalizedAmount,
  });

  state.logs = Array.isArray(state.logs) ? state.logs : [];
  state.logs.unshift(logEntry);

  const persistedState = await persistState(state);
  return buildView(persistedState);
};
