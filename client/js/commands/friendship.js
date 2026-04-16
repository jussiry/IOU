/*
Friend lifecycle commands: sending and accepting requests, rejecting them,
withdrawing outgoing ones.

Each command follows the same shape — load state, validate, mutate the user's
connection, queue a peer message, mirror it into the ledger, and persist.
That shape is repeated by design: it's the only way a command mutates state,
and keeping the boilerplate visible makes each command easy to audit against
the others.
*/

import { normalizeCurrencyAmount } from "../models/data-model.js";
import {
  PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
  PEER_MESSAGE_TYPE_FRIEND_REQUEST,
} from "../peer/messages.js";
import {
  FRIENDSHIP_STATUS_ACCEPTED,
  FRIENDSHIP_STATUS_PENDING_INCOMING,
  FRIENDSHIP_STATUS_PENDING_OUTGOING,
  FRIENDSHIP_STATUS_REJECTED,
  isAcceptedFriendshipStatus,
} from "../utils/friendships.js";
import { asTrimmedString, hasUser } from "../state-utils.js";
import { buildView } from "../ui/view-model.js";
import {
  loadData,
  loadState,
  persistAndBuildView,
} from "../app-state.js";
import { queuePeerMessage } from "../peer/outbox.js";
import {
  cancelPendingFriendRequest,
  ensureUserConnection,
  findConnection,
  getDisplayName,
  getUserConnection,
} from "../connection-helpers.js";
import { appendLedgerEntryFromMessage } from "../ledger.js";

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
    const acceptMsg = await queuePeerMessage(state, {
      toUserId: normalizedFriendId,
      type: PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
      payload: {
        accepter_name: state.user.name,
        trust_credit_limit_eur: userConnection.trust_credit_limit_eur || 0,
      },
    });
    appendLedgerEntryFromMessage(state, acceptMsg);
    return persistAndBuildView(state);
  }

  if (existingStatus === FRIENDSHIP_STATUS_ACCEPTED) {
    return persistAndBuildView(state);
  }

  userConnection.friendship_status = FRIENDSHIP_STATUS_PENDING_OUTGOING;
  const requestMsg = await queuePeerMessage(state, {
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
  appendLedgerEntryFromMessage(state, requestMsg);
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
  const acceptMsg = await queuePeerMessage(state, {
    toUserId: normalizedFriendId,
    type: PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
    payload: {
      accepter_name: state.user.name,
      trust_credit_limit_eur: userConnection.trust_credit_limit_eur || 0,
    },
  });
  appendLedgerEntryFromMessage(state, acceptMsg);

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

  await cancelPendingFriendRequest(state, normalizedFriendId, {
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

  await cancelPendingFriendRequest(state, normalizedFriendId, {
    direction: "to",
    displayName,
    notifyPeer: true,
  });

  return persistAndBuildView(state);
};
