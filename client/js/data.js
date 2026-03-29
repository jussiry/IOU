/*
Orchestrates persistent client state for the IOU app.

This module owns the cached state, IndexedDB persistence, and change
notification lifecycle. Domain logic for connections, peer messages, and
view models lives in dedicated sibling modules — this file wires them
together behind the public API that UI modules and realtime transport consume.
*/

import {
  createEmptyAppState,
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
import { generateNostrKeyPair } from "./utils/nostr-keys.js";
import { appendLog, asTrimmedString, createId, hasUser } from "./state-utils.js";
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

export const createUser = async (name) => {
  const trimmedName = asTrimmedString(name);
  const userName = trimmedName || "You";
  const {
    privateKeyHex,
    privateKeyNsec,
    publicKeyHex,
    publicKeyNpub,
  } = generateNostrKeyPair();

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
  appendLog(state, {
    text: `User **${userName}** created`,
  });
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

  const relationshipPeerIds = (Array.isArray(state.user.connections) ? state.user.connections : [])
    .filter((connection) => isPeerEligibleFriendshipStatus(connection.friendship_status))
    .map((connection) => connection.person_id)
    .filter(Boolean);
  const queuedPeerIds = (Array.isArray(state.outbox) ? state.outbox : [])
    .map((message) => message.to_user_id)
    .filter(Boolean);

  return {
    userId: state.user.id,
    userName: state.user.name,
    peerIds: Array.from(new Set([...relationshipPeerIds, ...queuedPeerIds])),
    outbox: Array.isArray(state.outbox) ? state.outbox.map((entry) => createPeerMessageModel(entry)) : [],
  };
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
    appendLog(state, {
      text: `You accepted **${getDisplayName(state, normalizedFriendId)}** as a friend`,
      friendId: normalizedFriendId,
    });
    queuePeerMessage(state, {
      toUserId: normalizedFriendId,
      type: PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
      payload: {
        accepter_name: state.user.name,
      },
    });
    return persistAndBuildView(state);
  }

  if (existingStatus === FRIENDSHIP_STATUS_ACCEPTED) {
    return persistAndBuildView(state);
  }

  userConnection.friendship_status = FRIENDSHIP_STATUS_PENDING_OUTGOING;
  appendLog(state, {
    text: `Friend request send to ${normalizedFriendId}`,
    friendId: normalizedFriendId,
  });
  queuePeerMessage(state, {
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
  appendLog(state, {
    text: `You accepted **${displayName}** as a friend`,
    friendId: normalizedFriendId,
  });
  queuePeerMessage(state, {
    toUserId: normalizedFriendId,
    type: PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
    payload: {
      accepter_name: state.user.name,
    },
  });

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

  if (existingLimit > 0 && normalizedTrustLimit < existingLimit) {
    // Lowering existing limit: apply locally immediately, peer auto-applies on receive
    userConnection.trust_credit_limit_eur = normalizedTrustLimit;
    userConnection.pending_credit_limit_eur = null;
    userConnection.pending_credit_limit_is_incoming = null;
    if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
      queueTrustLimitSuggestion(state, normalizedFriendId, normalizedTrustLimit);
    }
    appendLog(state, {
      text: `You lowered the trust limit for **${displayName}** to €${normalizedTrustLimit.toFixed(2)}`,
      friendId: normalizedFriendId,
      amount: normalizedTrustLimit,
    });
  } else {
    // New or higher limit: don't apply locally yet, wait for peer to accept
    userConnection.pending_credit_limit_eur = normalizedTrustLimit;
    userConnection.pending_credit_limit_is_incoming = false;
    if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
      queueTrustLimitSuggestion(state, normalizedFriendId, normalizedTrustLimit);
    }
    appendLog(state, {
      text: `You suggested a trust limit of €${normalizedTrustLimit.toFixed(2)} to **${displayName}**`,
      friendId: normalizedFriendId,
      amount: normalizedTrustLimit,
    });
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

  if (accepted) {
    userConnection.trust_credit_limit_eur = pendingLimit;
    appendLog(state, {
      text: `You accepted the trust limit of €${pendingLimit.toFixed(2)} with **${displayName}**`,
      friendId: normalizedFriendId,
      amount: pendingLimit,
    });
  } else {
    appendLog(state, {
      text: `You declined the trust limit suggestion from **${displayName}**`,
      friendId: normalizedFriendId,
    });
  }

  userConnection.pending_credit_limit_eur = null;
  userConnection.pending_credit_limit_is_incoming = null;

  if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
    queueTrustLimitSuggestion(state, normalizedFriendId, responseLimit);
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

  appendLog(state, {
    text: `You cancelled your trust limit suggestion to **${displayName}**`,
    friendId: normalizedFriendId,
  });

  if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
    queueTrustLimitSuggestion(state, normalizedFriendId, currentLimit);
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

  appendLog(state, {
    text: `You sent €${normalizedAmount.toFixed(2)} to **${displayName}**`,
    message: trimmedMessage,
    friendId: normalizedFriendId,
    amount: normalizedAmount,
    transactionId,
  });

  queuePeerMessage(state, {
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

  return persistAndBuildView(state);
};

// ---------------------------------------------------------------------------
// Peer message transport interface
// ---------------------------------------------------------------------------

export const markPeerMessageReceived = async (messageId) => {
  const normalizedMessageId = asTrimmedString(messageId);
  if (!normalizedMessageId) {
    return loadData();
  }

  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const didRemoveMessage = removeQueuedPeerMessage(state, normalizedMessageId);
  if (!didRemoveMessage) {
    return buildView(state);
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
