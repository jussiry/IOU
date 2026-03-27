/*
Handles inbound peer-to-peer messages by routing them to type-specific
handlers that mutate app state.

Each apply* function takes (state, message) and returns true if the message
was successfully applied, false otherwise. The top-level routeInboundMessage
function handles deduplication, routing, and logging for unrecognized messages.
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
import {
  hasProcessedPeerMessage,
  markProcessedPeerMessage,
  queuePeerMessage,
} from "./peer-outbox.js";
import {
  PEER_MESSAGE_TYPE_CREDIT_LIMIT_SUGGESTION,
  PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
  PEER_MESSAGE_TYPE_FRIEND_REJECT,
  PEER_MESSAGE_TYPE_FRIEND_REQUEST,
  PEER_MESSAGE_TYPE_RECEIVED,
  PEER_MESSAGE_TYPE_TRANSACTION_CREATED,
  PEER_RECEIPT_RESULT_IGNORED,
  PEER_RECEIPT_RESULT_PROCESSED,
} from "./realtime/peer-messages.js";
import { appendLog, asTrimmedString, createId, hasUser } from "./state-utils.js";
import {
  FRIENDSHIP_STATUS_ACCEPTED,
  FRIENDSHIP_STATUS_PENDING_INCOMING,
  FRIENDSHIP_STATUS_PENDING_OUTGOING,
  FRIENDSHIP_STATUS_REJECTED,
  isAcceptedFriendshipStatus,
  isPeerEligibleFriendshipStatus,
} from "./utils/friendships.js";

const getIncomingCreditLimitFromPayload = (payload) => {
  const suggestedCreditLimit = normalizeCurrencyAmount(
    payload?.suggested_credit_limit_eur,
    NaN
  );
  return Number.isFinite(suggestedCreditLimit) && suggestedCreditLimit >= 0
    ? suggestedCreditLimit
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

const applyCreditLimitSuggestionMessage = (state, message) => {
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

  const existingLimit = userConnection.trust_credit_limit_eur || 0;
  const pendingOutgoing = userConnection.pending_credit_limit_is_incoming === false
    ? userConnection.pending_credit_limit_eur
    : null;

  if (Number.isFinite(pendingOutgoing) && creditLimit === pendingOutgoing) {
    // Peer accepted our suggestion — apply it locally now
    userConnection.trust_credit_limit_eur = creditLimit;
    userConnection.pending_credit_limit_eur = null;
    userConnection.pending_credit_limit_is_incoming = null;
    appendLog(state, {
      text: `**${displayName}** accepted the credit limit of ${creditLimit.toFixed(2)}€`,
      friendId: message.from_user_id,
      amount: creditLimit,
    });
  } else if (creditLimit === existingLimit && userConnection.pending_credit_limit_eur !== null) {
    // Peer cancelled or declined — clear our pending suggestion
    userConnection.pending_credit_limit_eur = null;
    userConnection.pending_credit_limit_is_incoming = null;
    appendLog(state, {
      text: `**${displayName}** cancelled credit limit suggestion`,
      friendId: message.from_user_id,
    });
  } else if (creditLimit < existingLimit) {
    // Lower: apply automatically, show notification
    userConnection.trust_credit_limit_eur = creditLimit;
    userConnection.pending_credit_limit_eur = creditLimit;
    userConnection.pending_credit_limit_is_incoming = "lowered";
    appendLog(state, {
      text: `**${displayName}** lowered credit limit to ${creditLimit.toFixed(2)}€`,
      friendId: message.from_user_id,
      amount: creditLimit,
    });
  } else if (creditLimit === existingLimit) {
    // Same as current with no pending: no-op
    return false;
  } else {
    // Higher than current: let user decide
    userConnection.pending_credit_limit_eur = creditLimit;
    userConnection.pending_credit_limit_is_incoming = true;
    appendLog(state, {
      text: `**${displayName}** suggested a credit limit of ${creditLimit.toFixed(2)}€`,
      friendId: message.from_user_id,
      amount: creditLimit,
    });
  }
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

const createInboundProcessingResult = (view, acknowledgeResult = null) => {
  return {
    acknowledgeResult,
    view,
  };
};

/**
 * Routes an inbound peer message through deduplication and type-specific
 * handlers. Returns { applied, acknowledgeResult } so the caller can
 * decide whether to persist and which receipt to send.
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
    case PEER_MESSAGE_TYPE_CREDIT_LIMIT_SUGGESTION:
      didApplyMessage = applyCreditLimitSuggestionMessage(state, message);
      break;
    case PEER_MESSAGE_TYPE_TRANSACTION_CREATED:
      didApplyMessage = applyTransactionCreatedMessage(state, message);
      break;
    default:
      appendIllegalPeerMessageLog(state, message);
      return { applied: false, acknowledgeResult: PEER_RECEIPT_RESULT_IGNORED, persisted: true };
  }

  if (!didApplyMessage) {
    appendIllegalPeerMessageLog(state, message);
    return { applied: false, acknowledgeResult: PEER_RECEIPT_RESULT_IGNORED, persisted: true };
  }

  markProcessedPeerMessage(state, message.id);
  return { applied: true, acknowledgeResult: PEER_RECEIPT_RESULT_PROCESSED };
};

export { createInboundProcessingResult };
