/*
Manages the bidirectional connection and contact graph.

Provides helpers to find, create, and update friend connections on both the
user and their contacts. Also handles friend request cancellation and
relationship cleanup.
*/

import {
  createConnectionModel,
  createPublicPersonModel,
} from "./models/data-model.js";
import {
  ensureOutbox,
  hasQueuedPeerMessage,
  queuePeerMessage,
} from "./peer-outbox.js";
import {
  PEER_MESSAGE_TYPE_FRIEND_REJECT,
  PEER_MESSAGE_TYPE_FRIEND_REQUEST,
} from "./realtime/peer-messages.js";
import { appendLog, asTrimmedString, hasUser } from "./state-utils.js";
import {
  FRIENDSHIP_STATUS_ACCEPTED,
  FRIENDSHIP_STATUS_PENDING_INCOMING,
  FRIENDSHIP_STATUS_PENDING_OUTGOING,
} from "./utils/friendships.js";

export const ensureContacts = (state) => {
  if (!state.contacts || typeof state.contacts !== "object") {
    state.contacts = {};
  }
};

export const findConnection = (person, friendId) => {
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

export const getUserConnection = (state, friendId) => {
  if (!hasUser(state)) {
    return null;
  }

  return findConnection(state.user, friendId);
};

export const ensureConnection = (person, friendId, friendName, options = {}) => {
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

export const ensureContact = (state, contactId, contactName) => {
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

export const ensureUserConnection = (state, friendId, friendName, options = {}) => {
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

export const ensureContactBackLink = (state, contactId, contactName) => {
  if (!hasUser(state)) {
    return null;
  }

  const contact = ensureContact(state, contactId, contactName);
  if (!contact) {
    return null;
  }

  return ensureConnection(contact, state.user.id, state.user.name);
};

export const syncUserNameAcrossContacts = (state) => {
  if (!hasUser(state)) return;

  Object.values(state.contacts || {}).forEach((contact) => {
    const userConnection = Array.isArray(contact.connections)
      ? contact.connections.find((entry) => entry.person_id === state.user.id)
      : null;
    if (!userConnection) return;
    userConnection.person_name = state.user.name;
  });
};

export const getDisplayName = (state, friendId) => {
  const normalizedFriendId = asTrimmedString(friendId);
  const userConnection = getUserConnection(state, normalizedFriendId);
  const contact = state.contacts?.[normalizedFriendId];
  return (
    contact?.name ||
    userConnection?.person_name ||
    normalizedFriendId
  );
};

export const removeFriendRelationshipData = (state, friendId) => {
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

export const cancelPendingFriendRequest = (
  state,
  friendId,
  { direction, displayName, notifyPeer = false, skipLog = false } = {}
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
  if (!skipLog) {
    appendLog(state, {
      text: `Friend request cancelled ${direction} ${normalizedDisplayName}`,
      friendId: normalizedFriendId,
    });
  }
  return true;
};
