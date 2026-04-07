/*
Handles inbound peer-to-peer messages by routing them to type-specific
handlers that mutate app state.

Each apply* function takes (state, message) and returns null if the message
could not be applied, or a notification object { text, hash, friendId } on
success. The notification text is reused for both the toast and the log entry,
keeping the two in sync without duplication.
*/

import {
  createPeerMessageModel,
  createTransactionModel,
  normalizeCurrencyAmount,
} from "./models/data-model.js";
import {
  cancelPendingFriendRequest,
  ensureContact,
  ensureContactBackLink,
  ensureUserConnection,
  getDisplayName,
  getUserConnection,
} from "./connection-helpers.js";
import { formatCurrency } from "./utils/format.js";
import {
  hasProcessedPeerMessage,
  markProcessedPeerMessage,
  queuePeerMessage,
} from "./peer-outbox.js";
import {
  PEER_MESSAGE_TYPE_TRUST_LIMIT_SUGGESTION,
  PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
  PEER_MESSAGE_TYPE_FRIEND_REJECT,
  PEER_MESSAGE_TYPE_FRIEND_REQUEST,
  PEER_MESSAGE_TYPE_NAME_CHANGED,
  PEER_MESSAGE_TYPE_RECEIVED,
  PEER_MESSAGE_TYPE_TRANSACTION_CREATED,
  PEER_RECEIPT_RESULT_IGNORED,
  PEER_RECEIPT_RESULT_PROCESSED,
} from "./realtime/peer-messages.js";
import { appendLog, asTrimmedString, createId } from "./state-utils.js";
import {
  FRIENDSHIP_STATUS_ACCEPTED,
  FRIENDSHIP_STATUS_PENDING_INCOMING,
  FRIENDSHIP_STATUS_PENDING_OUTGOING,
  FRIENDSHIP_STATUS_REJECTED,
  isAcceptedFriendshipStatus,
  isPeerEligibleFriendshipStatus,
} from "./utils/friendships.js";

const getIncomingTrustLimitFromPayload = (payload) => {
  const suggestedTrustLimit = normalizeCurrencyAmount(
    payload?.suggested_credit_limit_eur,
    NaN
  );
  return Number.isFinite(suggestedTrustLimit) && suggestedTrustLimit >= 0
    ? suggestedTrustLimit
    : null;
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

const notification = (text, friendId, hash) => ({ text, friendId, hash });
const friendNotification = (text, friendId) => notification(text, friendId, `friend/${friendId}`);

const applyFriendRequestMessage = (state, message) => {
  const requesterName =
    asTrimmedString(message.payload?.requester_name) || message.from_user_id;
  const existingConnection = getUserConnection(state, message.from_user_id);

  if (existingConnection?.friendship_status === FRIENDSHIP_STATUS_PENDING_OUTGOING) {
    existingConnection.friendship_status = FRIENDSHIP_STATUS_ACCEPTED;
    existingConnection.person_name = requesterName;
    ensureContact(state, message.from_user_id, requesterName);
    queuePeerMessage(state, {
      toUserId: message.from_user_id,
      type: PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
      payload: {
        accepter_name: state.user.name,
      },
    });
    return friendNotification(`${requesterName} is now your friend`, message.from_user_id);
  }

  if (isAcceptedFriendshipStatus(existingConnection?.friendship_status)) {
    return null;
  }

  if (existingConnection?.friendship_status === FRIENDSHIP_STATUS_PENDING_INCOMING) {
    return null;
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
    return null;
  }

  ensureContactBackLink(state, message.from_user_id, requesterName);
  const suggestedTrustLimit = getIncomingTrustLimitFromPayload(message.payload);
  if (suggestedTrustLimit !== null) {
    userConnection.trust_credit_limit_eur = suggestedTrustLimit;
  }

  userConnection.friendship_status = FRIENDSHIP_STATUS_PENDING_INCOMING;
  userConnection.person_name = requesterName;
  return friendNotification(`Friend request from ${requesterName}`, message.from_user_id);
};

const applyFriendAcceptMessage = (state, message) => {
  const accepterName =
    asTrimmedString(message.payload?.accepter_name) || message.from_user_id;
  const userConnection = getUserConnection(state, message.from_user_id);
  if (!userConnection) {
    return null;
  }
  if (userConnection.friendship_status === FRIENDSHIP_STATUS_REJECTED) {
    return null;
  }

  const wasAccepted = isAcceptedFriendshipStatus(userConnection.friendship_status);
  userConnection.friendship_status = FRIENDSHIP_STATUS_ACCEPTED;
  userConnection.person_name = accepterName;
  ensureContact(state, message.from_user_id, accepterName);

  if (wasAccepted) {
    return null;
  }
  return friendNotification(`${accepterName} accepted your friend request`, message.from_user_id);
};

const applyFriendRejectMessage = (state, message) => {
  const displayName = getDisplayName(state, message.from_user_id);
  const applied = cancelPendingFriendRequest(state, message.from_user_id, {
    direction: "from",
    displayName,
    skipLog: true,
  });
  if (!applied) {
    return null;
  }
  return notification(`${displayName} rejected your friend request`, message.from_user_id, "friends");
};

const applyTrustLimitSuggestionMessage = (state, message) => {
  const trustLimit = normalizeCurrencyAmount(message.payload?.credit_limit_eur, NaN);
  if (!Number.isFinite(trustLimit) || trustLimit < 0) {
    return null;
  }

  const displayName = getDisplayName(state, message.from_user_id);
  const userConnection = getUserConnection(state, message.from_user_id);
  if (
    !userConnection ||
    !isPeerEligibleFriendshipStatus(userConnection.friendship_status)
  ) {
    return null;
  }

  const existingLimit = userConnection.trust_credit_limit_eur || 0;
  const pendingOutgoing = userConnection.pending_credit_limit_is_incoming === false
    ? userConnection.pending_credit_limit_eur
    : null;
  const wasIncoming = userConnection.pending_credit_limit_is_incoming === true;

  if (Number.isFinite(pendingOutgoing) && trustLimit === pendingOutgoing) {
    // Peer accepted our suggestion — apply it locally now
    userConnection.trust_credit_limit_eur = trustLimit;
    userConnection.pending_credit_limit_eur = null;
    userConnection.pending_credit_limit_is_incoming = null;
    return friendNotification(
      `${displayName} agreed on trust limit of ${formatCurrency(trustLimit)}`,
      message.from_user_id,
    );
  }

  if (trustLimit === existingLimit && userConnection.pending_credit_limit_eur !== null) {
    // Peer cancelled or declined — clear pending
    userConnection.pending_credit_limit_eur = null;
    userConnection.pending_credit_limit_is_incoming = null;
    if (wasIncoming) {
      return friendNotification(`${displayName} cancelled trust limit suggestion`, message.from_user_id);
    }
    return friendNotification(`${displayName} rejected trust limit suggestion`, message.from_user_id);
  }

  if (trustLimit < existingLimit) {
    // Lower: apply automatically, show notification
    userConnection.trust_credit_limit_eur = trustLimit;
    userConnection.pending_credit_limit_eur = trustLimit;
    userConnection.pending_credit_limit_is_incoming = "lowered";
    return friendNotification(
      `${displayName} lowered trust limit to ${formatCurrency(trustLimit)}`,
      message.from_user_id,
    );
  }

  if (trustLimit === existingLimit) {
    // Same as current with no pending: no-op
    return null;
  }

  // Higher than current: let user decide
  userConnection.pending_credit_limit_eur = trustLimit;
  userConnection.pending_credit_limit_is_incoming = true;
  return friendNotification(
    `${displayName} suggested trust limit of ${formatCurrency(trustLimit)}`,
    message.from_user_id,
  );
};

const applyNameChangedMessage = (state, message) => {
  const newName = asTrimmedString(message.payload?.name);
  if (!newName) return null;

  const displayName = getDisplayName(state, message.from_user_id);
  const userConnection = getUserConnection(state, message.from_user_id);
  if (!userConnection || !isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
    return null;
  }

  const oldName = userConnection.person_name || message.from_user_id;
  userConnection.person_name = newName;
  ensureContact(state, message.from_user_id, newName);

  if (oldName === newName) return null;
  return friendNotification(`${oldName} changed their name to ${newName}`, message.from_user_id);
};

const applyTransactionCreatedMessage = (state, message) => {
  const amount = normalizeCurrencyAmount(message.payload?.amount_eur, NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const displayName = getDisplayName(state, message.from_user_id);
  const userConnection = getUserConnection(state, message.from_user_id);
  if (!userConnection || !isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return null;
  }

  const transactionId =
    asTrimmedString(message.payload?.transaction_id) || createId("tx");
  const date =
    asTrimmedString(message.payload?.date) || new Date().toISOString().slice(0, 10);
  const note =
    asTrimmedString(message.payload?.note) || "IOU received";

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

  return friendNotification(`${displayName} sent €${amount.toFixed(2)} to you`, message.from_user_id);
};

const createInboundProcessingResult = (view, acknowledgeResult = null) => {
  return {
    acknowledgeResult,
    view,
  };
};

/**
 * Routes an inbound peer message through deduplication and type-specific
 * handlers. Returns { applied, acknowledgeResult, notification } so the
 * caller can decide whether to persist, which receipt to send, and
 * whether to show a toast.
 */
export const routeInboundMessage = (state, message) => {
  if (message.to_user_id && message.to_user_id !== state.user.id) {
    return { applied: false, acknowledgeResult: null };
  }

  if (hasProcessedPeerMessage(state, message.id)) {
    return { applied: false, acknowledgeResult: PEER_RECEIPT_RESULT_PROCESSED };
  }

  if (message.type === PEER_MESSAGE_TYPE_RECEIVED) {
    return { applied: false, acknowledgeResult: null };
  }

  let result = null;
  switch (message.type) {
    case PEER_MESSAGE_TYPE_FRIEND_REQUEST:
      result = applyFriendRequestMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_FRIEND_ACCEPT:
      result = applyFriendAcceptMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_FRIEND_REJECT:
      result = applyFriendRejectMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_TRUST_LIMIT_SUGGESTION:
      result = applyTrustLimitSuggestionMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_TRANSACTION_CREATED:
      result = applyTransactionCreatedMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_NAME_CHANGED:
      result = applyNameChangedMessage(state, message);
      break;
    default:
      appendIllegalPeerMessageLog(state, message);
      return { applied: false, acknowledgeResult: PEER_RECEIPT_RESULT_IGNORED, persisted: true };
  }

  if (!result) {
    appendIllegalPeerMessageLog(state, message);
    return { applied: false, acknowledgeResult: PEER_RECEIPT_RESULT_IGNORED, persisted: true };
  }

  markProcessedPeerMessage(state, message.id);
  appendLog(state, {
    text: result.text,
    friendId: result.friendId,
  });

  return {
    applied: true,
    acknowledgeResult: PEER_RECEIPT_RESULT_PROCESSED,
    notification: { text: result.text, hash: result.hash },
  };
};

export { createInboundProcessingResult };
