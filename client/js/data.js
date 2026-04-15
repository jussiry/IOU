/*
Orchestrates persistent client state for the IOU app.

This module owns the cached state, IndexedDB persistence, and change
notification lifecycle. Domain logic for connections, peer messages, and
view models lives in dedicated sibling modules — this file wires them
together behind the public API that UI modules and realtime transport consume.
*/

import {
  createEmptyAppState,
  createLedgerEntryModel,
  createPeerMessageModel,
  createPersonModel,
  createTransactionModel,
  normalizeCurrencyAmount,
  normalizeAppState,
} from "./models/data-model.js";
import {
  clearAppState,
  loadAppState,
  saveAppState,
} from "./storage/indexeddb.js";
import {
  PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
  PEER_MESSAGE_TYPE_FRIEND_REQUEST,
  PEER_MESSAGE_TYPE_NAME_CHANGED,
  PEER_MESSAGE_TYPE_PAYMENT_REQUEST,
  PEER_MESSAGE_TYPE_PAYMENT_REQUEST_RESPONSE,
  PEER_MESSAGE_TYPE_TRANSACTION_CREATED,
} from "./realtime/peer-messages.js";
import {
  FRIENDSHIP_STATUS_ACCEPTED,
  FRIENDSHIP_STATUS_PENDING_INCOMING,
  FRIENDSHIP_STATUS_PENDING_OUTGOING,
  FRIENDSHIP_STATUS_REJECTED,
  isAcceptedFriendshipStatus,
  isPeerEligibleFriendshipStatus,
} from "./utils/friendships.js";
import {
  generateNostrKeyPair,
  decodeNsecToHex,
  deriveNostrPublicKeyHex,
  encodeNpubFromPublicKeyHex,
  encodeNsecFromPrivateKeyHex,
} from "./utils/nostr-keys.js";
import { appendLedgerEntry, asTrimmedString, createId, hasUser } from "./state-utils.js";

const addLedgerEntryFromMessage = (state, message) => {
  if (!message) return;
  appendLedgerEntry(state, {
    id: message.id,
    type: message.type,
    fromUserId: message.from_user_id,
    toUserId: message.to_user_id,
    payload: message.payload,
  });
};
import { buildView } from "./view-model.js";
import {
  ensureOutbox,
  queueTrustLimitSuggestion,
  queuePeerMessage,
  removeQueuedPeerMessage,
} from "./peer-outbox.js";
import {
  cancelPendingFriendRequest,
  ensureUserConnection,
  findConnection,
  getDisplayName,
  getUserConnection,
  syncUserNameAcrossContacts,
} from "./connection-helpers.js";
import {
  createInboundProcessingResult,
  routeInboundMessage,
} from "./peer-message-handlers.js";
import { showNotification } from "./notifications.js";

const VERSION_KEY = "iou_version";

let cachedState = null;
const dataListeners = new Set();

const emitDataChange = (state) => {
  const view = buildView(state);
  dataListeners.forEach((listener) => {
    try {
      listener(view);
    } catch {
      // ignore listener failures so persistence remains reliable
    }
  });
  return view;
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

const persistAndBuildView = async (state) => {
  const persistedState = await persistState(state);
  return emitDataChange(persistedState);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const subscribeToDataChanges = (listener) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  dataListeners.add(listener);
  return () => {
    dataListeners.delete(listener);
  };
};

export const hasUserData = async () => {
  const state = await loadState();
  return hasUser(state);
};

export const createUser = async (name, { existingNsec } = {}) => {
  const trimmedName = asTrimmedString(name);

  let privateKeyHex, privateKeyNsec, publicKeyHex, publicKeyNpub;

  if (existingNsec) {
    privateKeyHex = decodeNsecToHex(existingNsec);
    privateKeyNsec = existingNsec;
    publicKeyHex = deriveNostrPublicKeyHex(privateKeyHex);
    publicKeyNpub = encodeNpubFromPublicKeyHex(publicKeyHex);
  } else {
    ({ privateKeyHex, privateKeyNsec, publicKeyHex, publicKeyNpub } = generateNostrKeyPair());
  }

  const userName = trimmedName || publicKeyNpub;

  const user = createPersonModel({
    id: publicKeyNpub,
    name: userName,
    public_key: publicKeyNpub,
    public_key_hex: publicKeyHex,
    private_key: privateKeyNsec,
    private_key_hex: privateKeyHex,
    connections: [],
  });

  const state = createEmptyAppState(user);
  return persistAndBuildView(state);
};

export const loadData = async () => {
  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }
  return buildView(state);
};

export const getRealtimeSnapshot = async () => {
  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const connections = Array.isArray(state.user.connections) ? state.user.connections : [];
  const eligibleConnections = connections.filter((connection) => isPeerEligibleFriendshipStatus(connection.friendship_status));
  const relationshipPeerIds = eligibleConnections
    .map((connection) => connection.person_id)
    .filter(Boolean);
  const queuedPeerIds = (Array.isArray(state.outbox) ? state.outbox : [])
    .map((message) => message.to_user_id)
    .filter(Boolean);

  const peerNames = {};
  eligibleConnections.forEach((connection) => {
    if (connection.person_id && connection.person_name) {
      peerNames[connection.person_id] = connection.person_name;
    }
  });

  return {
    userId: state.user.id,
    userName: state.user.name,
    userPrivateKeyHex: state.user.private_key_hex || "",
    peerIds: Array.from(new Set([...relationshipPeerIds, ...queuedPeerIds])),
    peerNames,
    outbox: Array.isArray(state.outbox) ? state.outbox.map((entry) => createPeerMessageModel(entry)) : [],
    ledger: Array.isArray(state.ledger) ? state.ledger.map((entry) => createLedgerEntryModel(entry)) : [],
  };
};

/**
 * Merges a batch of ledger entries from a sync peer. Entries with ids already
 * present (either in the ledger or processed_peer_message_ids) are skipped.
 * Returns the count of entries actually added.
 */
export const addLedgerEntries = async (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 0;
  }
  const state = await loadState();
  if (!hasUser(state)) return 0;

  state.ledger = Array.isArray(state.ledger) ? state.ledger : [];
  const existingIds = new Set(state.ledger.map((entry) => entry.id));
  let added = 0;
  entries.forEach((entry) => {
    const normalized = createLedgerEntryModel(entry);
    if (!normalized.id || existingIds.has(normalized.id)) return;
    state.ledger.unshift(normalized);
    existingIds.add(normalized.id);
    added += 1;
  });

  if (added > 0) {
    state.ledger.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    await persistAndBuildView(state);
  }
  return added;
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

  const connections = Array.isArray(state.user.connections) ? state.user.connections : [];
  connections
    .filter((connection) => isPeerEligibleFriendshipStatus(connection.friendship_status))
    .forEach((connection) => {
      queuePeerMessage(state, {
        toUserId: connection.person_id,
        type: PEER_MESSAGE_TYPE_NAME_CHANGED,
        payload: { name: trimmedName },
      });
    });

  return persistAndBuildView(state);
};

export const ensureVersion = async (version) => {
  try {
    const storedVersion = window.localStorage.getItem(VERSION_KEY);
    if (version && storedVersion !== version) {
      window.localStorage.setItem(VERSION_KEY, version);
    }
  } catch {
    // ignore version storage failures
  }
};

export const resetState = async () => {
  cachedState = null;
  try {
    await clearAppState();
  } catch {
    // ignore clear failures
  }

  try {
    window.localStorage.removeItem(VERSION_KEY);
  } catch {
    // ignore clear failures
  }
};

// ---------------------------------------------------------------------------
// Friend lifecycle
// ---------------------------------------------------------------------------

export const createFriend = async ({ friendId, trustLimit }) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state) || normalizedFriendId === state.user.id) {
    return null;
  }

  const existingConnection = findConnection(state.user, normalizedFriendId);
  const existingStatus = existingConnection?.friendship_status || "";
  const userConnection = ensureUserConnection(
    state,
    normalizedFriendId,
    normalizedFriendId
  );
  if (!userConnection) {
    return loadData();
  }

  const normalizedTrustLimit = normalizeCurrencyAmount(trustLimit, NaN);
  if (Number.isFinite(normalizedTrustLimit) && normalizedTrustLimit >= 0) {
    userConnection.trust_credit_limit_eur = normalizedTrustLimit;
  }

  if (existingStatus === FRIENDSHIP_STATUS_PENDING_INCOMING) {
    userConnection.friendship_status = FRIENDSHIP_STATUS_ACCEPTED;
    const acceptMsg = queuePeerMessage(state, {
      toUserId: normalizedFriendId,
      type: PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
      payload: {
        accepter_name: state.user.name,
      },
    });
    addLedgerEntryFromMessage(state, acceptMsg);
    return persistAndBuildView(state);
  }

  if (existingStatus === FRIENDSHIP_STATUS_ACCEPTED) {
    return persistAndBuildView(state);
  }

  userConnection.friendship_status = FRIENDSHIP_STATUS_PENDING_OUTGOING;
  const requestMsg = queuePeerMessage(state, {
    toUserId: normalizedFriendId,
    type: PEER_MESSAGE_TYPE_FRIEND_REQUEST,
    payload: {
      requester_name: state.user.name,
      suggested_credit_limit_eur:
        Number.isFinite(normalizedTrustLimit) && normalizedTrustLimit >= 0
          ? normalizedTrustLimit
          : 0,
    },
  });
  addLedgerEntryFromMessage(state, requestMsg);
  return persistAndBuildView(state);
};

export const acceptFriend = async (friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const displayName = getDisplayName(state, normalizedFriendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection) {
    return loadData();
  }
  if (isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return buildView(state);
  }
  if (userConnection.friendship_status !== FRIENDSHIP_STATUS_PENDING_INCOMING) {
    return buildView(state);
  }

  userConnection.friendship_status = FRIENDSHIP_STATUS_ACCEPTED;
  userConnection.person_name = displayName;
  const acceptMsg = queuePeerMessage(state, {
    toUserId: normalizedFriendId,
    type: PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
    payload: {
      accepter_name: state.user.name,
    },
  });
  addLedgerEntryFromMessage(state, acceptMsg);

  return persistAndBuildView(state);
};

export const rejectFriend = async (friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const displayName = getDisplayName(state, normalizedFriendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection) {
    return loadData();
  }
  if (userConnection.friendship_status === FRIENDSHIP_STATUS_REJECTED) {
    return buildView(state);
  }
  if (userConnection.friendship_status !== FRIENDSHIP_STATUS_PENDING_INCOMING) {
    return buildView(state);
  }

  cancelPendingFriendRequest(state, normalizedFriendId, {
    direction: "from",
    displayName,
    notifyPeer: true,
  });

  return persistAndBuildView(state);
};

export const removeFriendRequest = async (friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const displayName = getDisplayName(state, normalizedFriendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection) {
    return loadData();
  }
  if (userConnection.friendship_status !== FRIENDSHIP_STATUS_PENDING_OUTGOING) {
    return buildView(state);
  }

  cancelPendingFriendRequest(state, normalizedFriendId, {
    direction: "to",
    displayName,
    notifyPeer: true,
  });

  return persistAndBuildView(state);
};

// ---------------------------------------------------------------------------
// Trust limit management
// ---------------------------------------------------------------------------

export const updateTrustLimit = async (friendId, trustLimit) => {
  const normalizedFriendId = asTrimmedString(friendId);
  const normalizedTrustLimit = normalizeCurrencyAmount(trustLimit, NaN);
  if (!normalizedFriendId || !Number.isFinite(normalizedTrustLimit) || normalizedTrustLimit < 0) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const displayName = getDisplayName(state, normalizedFriendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection) {
    return loadData();
  }
  if (
    userConnection.friendship_status === FRIENDSHIP_STATUS_PENDING_INCOMING ||
    userConnection.friendship_status === FRIENDSHIP_STATUS_REJECTED
  ) {
    return buildView(state);
  }

  userConnection.person_name = displayName;
  const existingLimit = userConnection.trust_credit_limit_eur || 0;

  if (normalizedTrustLimit === existingLimit) {
    return buildView(state);
  }

  void displayName;
  if (existingLimit > 0 && normalizedTrustLimit < existingLimit) {
    // Lowering existing limit: apply locally immediately, peer auto-applies on receive
    userConnection.trust_credit_limit_eur = normalizedTrustLimit;
    userConnection.pending_credit_limit_eur = null;
    userConnection.pending_credit_limit_is_incoming = null;
    if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
      const msg = queueTrustLimitSuggestion(state, normalizedFriendId, normalizedTrustLimit);
      addLedgerEntryFromMessage(state, msg);
    }
  } else {
    // New or higher limit: don't apply locally yet, wait for peer to accept
    userConnection.pending_credit_limit_eur = normalizedTrustLimit;
    userConnection.pending_credit_limit_is_incoming = false;
    if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
      const msg = queueTrustLimitSuggestion(state, normalizedFriendId, normalizedTrustLimit);
      addLedgerEntryFromMessage(state, msg);
    }
  }

  return persistAndBuildView(state);
};

export const respondToTrustLimitSuggestion = async (friendId, accepted) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const displayName = getDisplayName(state, normalizedFriendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection || userConnection.pending_credit_limit_is_incoming !== true) {
    return loadData();
  }

  const pendingLimit = userConnection.pending_credit_limit_eur;

  // On agree: apply the suggested limit. On disagree: keep current limit (sends it back so peer reverts).
  const responseLimit = accepted && Number.isFinite(pendingLimit) && pendingLimit >= 0
    ? pendingLimit
    : userConnection.trust_credit_limit_eur || 0;

  void displayName;
  if (accepted) {
    userConnection.trust_credit_limit_eur = pendingLimit;
  }

  userConnection.pending_credit_limit_eur = null;
  userConnection.pending_credit_limit_is_incoming = null;

  if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
    const msg = queueTrustLimitSuggestion(state, normalizedFriendId, responseLimit);
    addLedgerEntryFromMessage(state, msg);
  }

  return persistAndBuildView(state);
};

export const cancelTrustLimitSuggestion = async (friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const displayName = getDisplayName(state, normalizedFriendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection || userConnection.pending_credit_limit_is_incoming !== false) {
    return loadData();
  }

  const currentLimit = userConnection.trust_credit_limit_eur || 0;
  userConnection.pending_credit_limit_eur = null;
  userConnection.pending_credit_limit_is_incoming = null;
  void displayName;

  if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
    const msg = queueTrustLimitSuggestion(state, normalizedFriendId, currentLimit);
    addLedgerEntryFromMessage(state, msg);
  }

  return persistAndBuildView(state);
};

export const dismissTrustLimitNotification = async (friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection || userConnection.pending_credit_limit_is_incoming !== "lowered") {
    return loadData();
  }

  userConnection.pending_credit_limit_eur = null;
  userConnection.pending_credit_limit_is_incoming = null;

  return persistAndBuildView(state);
};

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

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

  const displayName = getDisplayName(state, normalizedFriendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection || !isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return loadData();
  }

  const trimmedMessage = asTrimmedString(message);
  const timestamp = new Date();
  const date = timestamp.toISOString().slice(0, 10);
  const transactionId = createId("tx");
  const note = trimmedMessage.length ? trimmedMessage : "IOU sent";

  userConnection.person_name = displayName;
  userConnection.debt_eur = (userConnection.debt_eur || 0) - normalizedAmount;
  userConnection.recent_transactions.unshift(
    createTransactionModel({
      id: transactionId,
      date,
      amount_eur: -normalizedAmount,
      note,
    })
  );

  const txMsg = queuePeerMessage(state, {
    toUserId: normalizedFriendId,
    type: PEER_MESSAGE_TYPE_TRANSACTION_CREATED,
    payload: {
      transaction_id: transactionId,
      amount_eur: normalizedAmount,
      date,
      note,
      message: trimmedMessage,
    },
  });
  addLedgerEntryFromMessage(state, txMsg);

  return persistAndBuildView(state);
};

// ---------------------------------------------------------------------------
// Payment requests
// ---------------------------------------------------------------------------

export const requestPayment = async ({ friendId, amount, message }) => {
  const normalizedFriendId = asTrimmedString(friendId);
  const normalizedAmount = normalizeCurrencyAmount(amount, NaN);
  if (!normalizedFriendId || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const displayName = getDisplayName(state, normalizedFriendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection || !isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return loadData();
  }

  const trimmedMessage = asTrimmedString(message);
  const requestId = createId("pr");

  userConnection.pending_payment_request = {
    id: requestId,
    amount_eur: normalizedAmount,
    note: trimmedMessage || "",
    is_incoming: false,
    created_at: new Date().toISOString(),
  };

  const prMsg = queuePeerMessage(state, {
    toUserId: normalizedFriendId,
    type: PEER_MESSAGE_TYPE_PAYMENT_REQUEST,
    payload: {
      request_id: requestId,
      amount_eur: normalizedAmount,
      note: trimmedMessage,
    },
  });
  addLedgerEntryFromMessage(state, prMsg);

  return persistAndBuildView(state);
};

export const respondToPaymentRequest = async (friendId, accepted) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const displayName = getDisplayName(state, normalizedFriendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection || !isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return loadData();
  }

  const pendingRequest = userConnection.pending_payment_request;
  if (!pendingRequest || !pendingRequest.is_incoming) {
    return loadData();
  }

  const requestId = pendingRequest.id;
  const requestAmount = pendingRequest.amount_eur;
  const requestNote = pendingRequest.note;

  userConnection.pending_payment_request = null;

  const responseMsg = queuePeerMessage(state, {
    toUserId: normalizedFriendId,
    type: PEER_MESSAGE_TYPE_PAYMENT_REQUEST_RESPONSE,
    payload: {
      request_id: requestId,
      accepted,
    },
  });
  addLedgerEntryFromMessage(state, responseMsg);

  if (accepted) {
    // Create the transaction as if the user sent an IOU
    const transactionId = createId("tx");
    const date = new Date().toISOString().slice(0, 10);
    const note = requestNote || "Payment request accepted";

    userConnection.debt_eur = (userConnection.debt_eur || 0) - requestAmount;
    userConnection.recent_transactions.unshift(
      createTransactionModel({
        id: transactionId,
        date,
        amount_eur: -requestAmount,
        note,
      })
    );

    const txMsg = queuePeerMessage(state, {
      toUserId: normalizedFriendId,
      type: PEER_MESSAGE_TYPE_TRANSACTION_CREATED,
      payload: {
        transaction_id: transactionId,
        amount_eur: requestAmount,
        date,
        note,
        message: requestNote,
      },
    });
    addLedgerEntryFromMessage(state, txMsg);
  }
  void displayName;

  return persistAndBuildView(state);
};

export const dismissNameChangeNotification = async (friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection) {
    return loadData();
  }

  userConnection.pending_name_change = null;
  return persistAndBuildView(state);
};

export const dismissPaymentRequest = async (friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection) {
    return loadData();
  }

  userConnection.pending_payment_request = null;
  return persistAndBuildView(state);
};

// ---------------------------------------------------------------------------
// Peer message transport interface
// ---------------------------------------------------------------------------

export const updateLastSyncedAt = async (peerId) => {
  const normalizedPeerId = asTrimmedString(peerId);
  if (!normalizedPeerId) return;

  const state = await loadState();
  if (!hasUser(state)) return;

  const connection = findConnection(state, normalizedPeerId);
  if (!connection) return;

  connection.last_synced_at = new Date().toISOString();
  await persistState(state);
};

export const markPeerMessageReceived = async (messageId) => {
  const normalizedMessageId = asTrimmedString(messageId);
  if (!normalizedMessageId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const removedMessage = removeQueuedPeerMessage(state, normalizedMessageId);
  if (!removedMessage) {
    return buildView(state);
  }

  const peerId = removedMessage.to_user_id;
  if (peerId) {
    const connection = findConnection(state, peerId);
    if (connection) {
      connection.last_synced_at = new Date().toISOString();
    }
  }

  return persistAndBuildView(state);
};

export const applyInboundPeerMessage = async (incomingMessage) => {
  const message = createPeerMessageModel(incomingMessage);
  if (!message.id || !message.from_user_id || !message.type) {
    return createInboundProcessingResult(await loadData());
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return createInboundProcessingResult(null);
  }

  const result = routeInboundMessage(state, message);

  if (!result.applied && !result.persisted) {
    return createInboundProcessingResult(
      buildView(state),
      result.acknowledgeResult
    );
  }

  if (result.notification) {
    showNotification(result.notification);
  }

  return createInboundProcessingResult(
    await persistAndBuildView(state),
    result.acknowledgeResult
  );
};
