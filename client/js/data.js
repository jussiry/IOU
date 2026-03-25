/*
This module owns persistent client state for the IOU app. It stores and reads user data from IndexedDB, derives view models for page binders, and keeps mutation logic centralized.

It also manages friendship lifecycle changes, queued peer-to-peer messages, and inbound message application so UI modules and realtime transport can coordinate through one consistent state layer.
*/

import {
  createConnectionModel,
  createEmptyAppState,
  createLogEntryModel,
  createPeerMessageModel,
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
import {
  PEER_RECEIPT_RESULT_IGNORED,
  PEER_RECEIPT_RESULT_PROCESSED,
  PEER_MESSAGE_TYPE_CREDIT_LIMIT_UPDATE,
  PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
  PEER_MESSAGE_TYPE_FRIEND_REJECT,
  PEER_MESSAGE_TYPE_FRIEND_REQUEST,
  PEER_MESSAGE_TYPE_RECEIVED,
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

const VERSION_KEY = "iou_version";
const PROCESSED_MESSAGE_ID_LIMIT = 500;

let cachedState = null;
const dataListeners = new Set();

const hasUser = (state) => {
  return Boolean(
    state?.user?.id &&
      state?.user?.public_key &&
      state.user.id === state.user.public_key
  );
};

const asTrimmedString = (value) => {
  return typeof value === "string" ? value.trim() : "";
};

const ensureContacts = (state) => {
  if (!state.contacts || typeof state.contacts !== "object") {
    state.contacts = {};
  }
};

const ensureOutbox = (state) => {
  if (!Array.isArray(state.outbox)) {
    state.outbox = [];
  }
};

const ensureProcessedPeerMessageIds = (state) => {
  if (!Array.isArray(state.processed_peer_message_ids)) {
    state.processed_peer_message_ids = [];
  }
};

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

const findConnection = (person, friendId) => {
  if (!Array.isArray(person?.connections)) {
    return null;
  }

  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId) {
    return null;
  }

  return (
    person.connections.find((entry) => entry.person_id === normalizedFriendId) || null
  );
};

const getUserConnection = (state, friendId) => {
  if (!hasUser(state)) {
    return null;
  }

  return findConnection(state.user, friendId);
};

const ensureConnection = (person, friendId, friendName, options = {}) => {
  const normalizedFriendId = asTrimmedString(friendId);
  const normalizedFriendName = asTrimmedString(friendName);
  if (!normalizedFriendId) {
    return null;
  }

  if (!Array.isArray(person.connections)) {
    person.connections = [];
  }

  let connection = findConnection(person, normalizedFriendId);
  if (!connection) {
    connection = createConnectionModel({
      person_id: normalizedFriendId,
      person_name: normalizedFriendName || normalizedFriendId,
      friendship_status: options.friendshipStatus || FRIENDSHIP_STATUS_ACCEPTED,
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
  if (options.friendshipStatus) {
    connection.friendship_status = options.friendshipStatus;
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

const ensureUserConnection = (state, friendId, friendName, options = {}) => {
  if (!hasUser(state)) {
    return null;
  }

  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId || normalizedFriendId === state.user.id) {
    return null;
  }

  ensureContact(state, normalizedFriendId, friendName);
  return ensureConnection(state.user, normalizedFriendId, friendName, options);
};

const ensureContactBackLink = (state, contactId, contactName) => {
  if (!hasUser(state)) {
    return null;
  }

  const contact = ensureContact(state, contactId, contactName);
  if (!contact) {
    return null;
  }

  return ensureConnection(contact, state.user.id, state.user.name);
};

const createId = (prefix = "tx") => {
  if (window.crypto?.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }

  const randomToken = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${randomToken}`;
};

const appendLog = (
  state,
  {
    text,
    message = "",
    friendId = "",
    amount = 0,
    transactionId = "",
  } = {}
) => {
  state.logs = Array.isArray(state.logs) ? state.logs : [];
  state.logs.unshift(
    createLogEntryModel({
      id: createId("log"),
      transaction_id: transactionId,
      timestamp: new Date().toISOString(),
      text,
      message,
      friend_id: friendId,
      amount_eur: amount,
    })
  );
};

const queuePeerMessage = (state, { toUserId, type, payload = {} } = {}) => {
  if (!hasUser(state)) {
    return null;
  }

  const normalizedTargetUserId = asTrimmedString(toUserId);
  if (!normalizedTargetUserId) {
    return null;
  }

  ensureOutbox(state);
  const message = createPeerMessageModel({
    id: createId("peer"),
    type,
    from_user_id: state.user.id,
    to_user_id: normalizedTargetUserId,
    created_at: new Date().toISOString(),
    payload,
  });
  state.outbox.push(message);
  return message;
};

const markProcessedPeerMessage = (state, messageId) => {
  const normalizedMessageId = asTrimmedString(messageId);
  if (!normalizedMessageId) {
    return;
  }

  ensureProcessedPeerMessageIds(state);
  if (state.processed_peer_message_ids.includes(normalizedMessageId)) {
    return;
  }

  state.processed_peer_message_ids.unshift(normalizedMessageId);
  if (state.processed_peer_message_ids.length > PROCESSED_MESSAGE_ID_LIMIT) {
    state.processed_peer_message_ids.length = PROCESSED_MESSAGE_ID_LIMIT;
  }
};

const hasProcessedPeerMessage = (state, messageId) => {
  const normalizedMessageId = asTrimmedString(messageId);
  if (!normalizedMessageId) {
    return false;
  }

  ensureProcessedPeerMessageIds(state);
  return state.processed_peer_message_ids.includes(normalizedMessageId);
};

const removeQueuedPeerMessage = (state, messageId) => {
  const normalizedMessageId = asTrimmedString(messageId);
  if (!normalizedMessageId) {
    return false;
  }

  ensureOutbox(state);
  const previousLength = state.outbox.length;
  state.outbox = state.outbox.filter((message) => message.id !== normalizedMessageId);
  return state.outbox.length !== previousLength;
};

const hasQueuedPeerMessage = (state, { toUserId = "", type = "" } = {}) => {
  const normalizedTargetUserId = asTrimmedString(toUserId);
  const normalizedType = asTrimmedString(type);
  ensureOutbox(state);

  return state.outbox.some((message) => {
    if (normalizedTargetUserId && message.to_user_id !== normalizedTargetUserId) {
      return false;
    }
    if (normalizedType && message.type !== normalizedType) {
      return false;
    }
    return true;
  });
};

const createInboundProcessingResult = (view, acknowledgeResult = null) => {
  return {
    acknowledgeResult,
    view,
  };
};

const serializePeerMessageData = (message) => {
  try {
    return JSON.stringify(createPeerMessageModel(message));
  } catch {
    return String(message);
  }
};

const appendIllegalPeerMessageLog = (state, message) => {
  appendLog(state, {
    text: `Illegal peer message received: ${serializePeerMessageData(message)}`,
  });
};

const removeFriendRelationshipData = (state, friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  if (!normalizedFriendId || !hasUser(state)) {
    return;
  }

  state.user.connections = Array.isArray(state.user.connections)
    ? state.user.connections.filter((connection) => connection.person_id !== normalizedFriendId)
    : [];
  ensureContacts(state);
  delete state.contacts[normalizedFriendId];
  ensureOutbox(state);
  state.outbox = state.outbox.filter((message) => {
    return (
      message.to_user_id !== normalizedFriendId &&
      message.from_user_id !== normalizedFriendId
    );
  });
};

const cancelPendingFriendRequest = (
  state,
  friendId,
  { direction, displayName, notifyPeer = false } = {}
) => {
  const normalizedFriendId = asTrimmedString(friendId);
  const normalizedDisplayName = asTrimmedString(displayName) || normalizedFriendId;
  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection) {
    return false;
  }
  if (
    userConnection.friendship_status !== FRIENDSHIP_STATUS_PENDING_INCOMING &&
    userConnection.friendship_status !== FRIENDSHIP_STATUS_PENDING_OUTGOING
  ) {
    return false;
  }

  const hasUnsentOutgoingRequest =
    userConnection.friendship_status === FRIENDSHIP_STATUS_PENDING_OUTGOING &&
    hasQueuedPeerMessage(state, {
      toUserId: normalizedFriendId,
      type: PEER_MESSAGE_TYPE_FRIEND_REQUEST,
    });
  removeFriendRelationshipData(state, normalizedFriendId);
  if (notifyPeer && !hasUnsentOutgoingRequest) {
    queuePeerMessage(state, {
      toUserId: normalizedFriendId,
      type: PEER_MESSAGE_TYPE_FRIEND_REJECT,
      payload: {},
    });
  }
  appendLog(state, {
    text: `Friend request cancelled ${direction} ${normalizedDisplayName}`,
    friendId: normalizedFriendId,
  });
  return true;
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

  const acceptedConnections = connectionsWithInbound.filter((connection) =>
    isAcceptedFriendshipStatus(connection.friendship_status)
  );

  const creditAgreements = acceptedConnections.reduce((sum, connection) => {
    return sum + (connection.trust_credit_limit_eur || 0);
  }, 0);

  const friendsOweTotal = acceptedConnections.reduce((sum, connection) => {
    return sum + Math.max(connection.debt_eur || 0, 0);
  }, 0);
  const youOweTotal = acceptedConnections.reduce((sum, connection) => {
    return sum + Math.max(-(connection.debt_eur || 0), 0);
  }, 0);
  const netBalance = friendsOweTotal - youOweTotal;

  const availableCredit = acceptedConnections.reduce((sum, connection) => {
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

const getDisplayName = (state, friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  const contact = state.contacts?.[normalizedFriendId];
  return (
    contact?.name ||
    userConnection?.person_name ||
    normalizedFriendId
  );
};

const getIncomingCreditLimitFromPayload = (payload) => {
  const suggestedCreditLimit = normalizeCurrencyAmount(
    payload?.suggested_credit_limit_eur,
    NaN
  );
  return Number.isFinite(suggestedCreditLimit) && suggestedCreditLimit >= 0
    ? suggestedCreditLimit
    : null;
};

const queueCurrentCreditLimitUpdate = (state, friendId, creditLimit) => {
  if (!Number.isFinite(creditLimit) || creditLimit < 0) {
    return null;
  }

  return queuePeerMessage(state, {
    toUserId: friendId,
    type: PEER_MESSAGE_TYPE_CREDIT_LIMIT_UPDATE,
    payload: {
      credit_limit_eur: creditLimit,
    },
  });
};

const applyFriendRequestMessage = (state, message) => {
  const requesterName =
    asTrimmedString(message.payload?.requester_name) || message.from_user_id;
  const existingConnection = getUserConnection(state, message.from_user_id);

  if (existingConnection?.friendship_status === FRIENDSHIP_STATUS_PENDING_OUTGOING) {
    existingConnection.friendship_status = FRIENDSHIP_STATUS_ACCEPTED;
    existingConnection.person_name = requesterName;
    ensureContact(state, message.from_user_id, requesterName);
    appendLog(state, {
      text: `Friendship with **${requesterName}** accepted`,
      friendId: message.from_user_id,
    });
    queuePeerMessage(state, {
      toUserId: message.from_user_id,
      type: PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
      payload: {
        accepter_name: state.user.name,
      },
    });
    queueCurrentCreditLimitUpdate(
      state,
      message.from_user_id,
      existingConnection.trust_credit_limit_eur || 0
    );
    return true;
  }

  if (isAcceptedFriendshipStatus(existingConnection?.friendship_status)) {
    return false;
  }

  if (existingConnection?.friendship_status === FRIENDSHIP_STATUS_PENDING_INCOMING) {
    return false;
  }

  const userConnection = ensureUserConnection(
    state,
    message.from_user_id,
    requesterName,
    {
      friendshipStatus: FRIENDSHIP_STATUS_PENDING_INCOMING,
    }
  );
  if (!userConnection) {
    return false;
  }

  const contactBackLink = ensureContactBackLink(
    state,
    message.from_user_id,
    requesterName
  );
  const suggestedCreditLimit = getIncomingCreditLimitFromPayload(message.payload);
  if (contactBackLink && suggestedCreditLimit !== null) {
    contactBackLink.trust_credit_limit_eur = suggestedCreditLimit;
  }

  userConnection.friendship_status = FRIENDSHIP_STATUS_PENDING_INCOMING;
  userConnection.person_name = requesterName;
  appendLog(state, {
    text: `Friend request received from ${requesterName}`,
    friendId: message.from_user_id,
  });
  return true;
};

const applyFriendAcceptMessage = (state, message) => {
  const accepterName =
    asTrimmedString(message.payload?.accepter_name) || message.from_user_id;
  const userConnection = getUserConnection(state, message.from_user_id);
  if (!userConnection) {
    return false;
  }
  if (userConnection.friendship_status === FRIENDSHIP_STATUS_REJECTED) {
    return false;
  }

  const wasAccepted = isAcceptedFriendshipStatus(userConnection.friendship_status);
  userConnection.friendship_status = FRIENDSHIP_STATUS_ACCEPTED;
  userConnection.person_name = accepterName;
  ensureContact(state, message.from_user_id, accepterName);

  if (!wasAccepted) {
    appendLog(state, {
      text: `**${accepterName}** accepted your friend request`,
      friendId: message.from_user_id,
    });
  }
  return true;
};

const applyFriendRejectMessage = (state, message) => {
  const displayName = getDisplayName(state, message.from_user_id);
  return cancelPendingFriendRequest(state, message.from_user_id, {
    direction: "from",
    displayName,
  });
};

const applyCreditLimitUpdateMessage = (state, message) => {
  const creditLimit = normalizeCurrencyAmount(message.payload?.credit_limit_eur, NaN);
  if (!Number.isFinite(creditLimit) || creditLimit < 0) {
    return false;
  }

  const displayName = getDisplayName(state, message.from_user_id);
  const userConnection = getUserConnection(state, message.from_user_id);
  if (
    !userConnection ||
    !isPeerEligibleFriendshipStatus(userConnection.friendship_status)
  ) {
    return false;
  }

  const contactBackLink = ensureContactBackLink(
    state,
    message.from_user_id,
    displayName
  );
  if (!contactBackLink) {
    return false;
  }

  contactBackLink.trust_credit_limit_eur = creditLimit;
  appendLog(state, {
    text: `**${displayName}** updated their credit limit to ${creditLimit.toFixed(2)}€`,
    friendId: message.from_user_id,
    amount: creditLimit,
  });
  return true;
};

const applyTransactionCreatedMessage = (state, message) => {
  const amount = normalizeCurrencyAmount(message.payload?.amount_eur, NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    return false;
  }

  const displayName = getDisplayName(state, message.from_user_id);
  const userConnection = getUserConnection(state, message.from_user_id);
  if (!userConnection || !isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return false;
  }

  const transactionId =
    asTrimmedString(message.payload?.transaction_id) || createId("tx");
  const date =
    asTrimmedString(message.payload?.date) || new Date().toISOString().slice(0, 10);
  const note =
    asTrimmedString(message.payload?.note) || "IOU received";
  const messageText = asTrimmedString(message.payload?.message);

  userConnection.person_name = displayName;
  userConnection.debt_eur = (userConnection.debt_eur || 0) + amount;
  userConnection.recent_transactions.unshift(
    createTransactionModel({
      id: transactionId,
      date,
      amount_eur: amount,
      note,
    })
  );

  appendLog(state, {
    text: `**${displayName}** sent ${amount.toFixed(2)}€ to you`,
    message: messageText,
    friendId: message.from_user_id,
    amount,
    transactionId,
  });
  return true;
};

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

export const createFriend = async ({ friendId, creditLimit }) => {
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

  const normalizedCreditLimit = normalizeCurrencyAmount(creditLimit, NaN);
  if (Number.isFinite(normalizedCreditLimit) && normalizedCreditLimit >= 0) {
    userConnection.trust_credit_limit_eur = normalizedCreditLimit;
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
    queueCurrentCreditLimitUpdate(
      state,
      normalizedFriendId,
      userConnection.trust_credit_limit_eur || 0
    );
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
        Number.isFinite(normalizedCreditLimit) && normalizedCreditLimit >= 0
          ? normalizedCreditLimit
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
  queueCurrentCreditLimitUpdate(
    state,
    normalizedFriendId,
    userConnection.trust_credit_limit_eur || 0
  );

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

export const updateCreditLimit = async (friendId, creditLimit) => {
  const normalizedFriendId = asTrimmedString(friendId);
  const normalizedCreditLimit = normalizeCurrencyAmount(creditLimit, NaN);
  if (!normalizedFriendId || !Number.isFinite(normalizedCreditLimit) || normalizedCreditLimit < 0) {
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

  userConnection.trust_credit_limit_eur = normalizedCreditLimit;
  userConnection.person_name = displayName;
  if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
    queueCurrentCreditLimitUpdate(
      state,
      normalizedFriendId,
      normalizedCreditLimit
    );
  }

  appendLog(state, {
    text: `You updated the credit limit for **${displayName}** to ${normalizedCreditLimit.toFixed(2)}€`,
    friendId: normalizedFriendId,
    amount: normalizedCreditLimit,
  });

  return persistAndBuildView(state);
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
    text: `You sent ${normalizedAmount.toFixed(2)}€ to **${displayName}**`,
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

  if (message.to_user_id && message.to_user_id !== state.user.id) {
    return createInboundProcessingResult(buildView(state));
  }

  if (hasProcessedPeerMessage(state, message.id)) {
    return createInboundProcessingResult(
      buildView(state),
      PEER_RECEIPT_RESULT_PROCESSED
    );
  }

  let didApplyMessage = false;
  switch (message.type) {
    case PEER_MESSAGE_TYPE_FRIEND_REQUEST:
      didApplyMessage = applyFriendRequestMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_FRIEND_ACCEPT:
      didApplyMessage = applyFriendAcceptMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_FRIEND_REJECT:
      didApplyMessage = applyFriendRejectMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_CREDIT_LIMIT_UPDATE:
      didApplyMessage = applyCreditLimitUpdateMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_TRANSACTION_CREATED:
      didApplyMessage = applyTransactionCreatedMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_RECEIVED:
      return createInboundProcessingResult(buildView(state));
    default:
      appendIllegalPeerMessageLog(state, message);
      return createInboundProcessingResult(
        await persistAndBuildView(state),
        PEER_RECEIPT_RESULT_IGNORED
      );
  }

  if (!didApplyMessage) {
    appendIllegalPeerMessageLog(state, message);
    return createInboundProcessingResult(
      await persistAndBuildView(state),
      PEER_RECEIPT_RESULT_IGNORED
    );
  }

  markProcessedPeerMessage(state, message.id);
  return createInboundProcessingResult(
    await persistAndBuildView(state),
    PEER_RECEIPT_RESULT_PROCESSED
  );
};
