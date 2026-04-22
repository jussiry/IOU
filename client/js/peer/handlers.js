/*
Routes verified, deduplicated, already-appended ledger entries to
type-specific handlers that derive app-state mutations from them.

The pipeline is ledger-first: the caller (peer/bridge.js) appends the
entry to the ledger and then calls routeInboundEntry(state, entry) or
routeOutboundEntry(state, entry) on that stored entry. State is always
derived from the ledger, never the other way around, whether the entry
was produced by a local user action, received from a peer, or synced
from another device of the same user.

Each apply*Entry function takes (state, entry) and returns null if the
entry was inapplicable, or a notification object { text, hash, friendId }
on success. The notification text is reused for both the toast and the
log entry, keeping the two in sync without duplication.
*/

import {
  createPeerMessageModel,
  createTransactionModel,
  normalizeCurrencyAmount,
} from "../models/data-model.js";
import {
  cancelPendingFriendRequest,
  ensureContact,
  ensureContactBackLink,
  ensureUserConnection,
  getDisplayName,
  getUserConnection,
  removeFriendRelationshipData,
} from "../connection-helpers.js";
import { formatCurrency } from "../ui/format.js";
import { queuePeerMessage } from "./outbox.js";
import {
  PEER_MESSAGE_TYPE_TRUST_LIMIT_SUGGESTION,
  PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
  PEER_MESSAGE_TYPE_FRIEND_REJECT,
  PEER_MESSAGE_TYPE_FRIEND_REQUEST,
  PEER_MESSAGE_TYPE_NAME_CHANGED,
  PEER_MESSAGE_TYPE_PAYMENT_REQUEST,
  PEER_MESSAGE_TYPE_PAYMENT_REQUEST_RESPONSE,
  PEER_MESSAGE_TYPE_TRANSACTION_CREATED,
} from "./messages.js";
import { asTrimmedString, createId } from "../state-utils.js";
import {
  FRIENDSHIP_STATUS_ACCEPTED,
  FRIENDSHIP_STATUS_PENDING_INCOMING,
  FRIENDSHIP_STATUS_PENDING_OUTGOING,
  FRIENDSHIP_STATUS_REJECTED,
  isAcceptedFriendshipStatus,
  isPeerEligibleFriendshipStatus,
} from "../utils/friendships.js";

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

const warnIllegalPeerEntry = (entry) => {
  console.warn("[LedgerEntry] Illegal ledger entry:", serializePeerMessageData(entry));
};

const notification = (text, friendId, hash) => ({ text, friendId, hash });
const friendNotification = (text, friendId) => notification(text, friendId, `friend/${friendId}`);

const applyInboundFriendRequest = async (state, entry) => {
  const requesterName =
    asTrimmedString(entry.payload?.requester_name) || entry.from_user_id;
  const existingConnection = getUserConnection(state, entry.from_user_id);

  if (existingConnection?.friendship_status === FRIENDSHIP_STATUS_PENDING_OUTGOING) {
    existingConnection.friendship_status = FRIENDSHIP_STATUS_ACCEPTED;
    existingConnection.person_name = requesterName;
    ensureContact(state, entry.from_user_id, requesterName);
    await queuePeerMessage(state, {
      toUserId: entry.from_user_id,
      type: PEER_MESSAGE_TYPE_FRIEND_ACCEPT,
      payload: {
        accepter_name: state.user.name,
      },
    });
    return friendNotification(`${requesterName} is now your friend`, entry.from_user_id);
  }

  if (isAcceptedFriendshipStatus(existingConnection?.friendship_status)) {
    return null;
  }

  if (existingConnection?.friendship_status === FRIENDSHIP_STATUS_PENDING_INCOMING) {
    return null;
  }

  const userConnection = ensureUserConnection(
    state,
    entry.from_user_id,
    requesterName,
    {
      friendshipStatus: FRIENDSHIP_STATUS_PENDING_INCOMING,
    }
  );
  if (!userConnection) {
    return null;
  }

  ensureContactBackLink(state, entry.from_user_id, requesterName);
  const suggestedTrustLimit = getIncomingTrustLimitFromPayload(entry.payload);
  if (suggestedTrustLimit !== null) {
    userConnection.trust_credit_limit_eur = suggestedTrustLimit;
  }

  userConnection.friendship_status = FRIENDSHIP_STATUS_PENDING_INCOMING;
  userConnection.person_name = requesterName;
  return friendNotification(`Friend request from ${requesterName}`, entry.from_user_id);
};

const applyInboundFriendAccept = (state, entry) => {
  const accepterName =
    asTrimmedString(entry.payload?.accepter_name) || entry.from_user_id;
  let userConnection = getUserConnection(state, entry.from_user_id);
  // Track whether this is a recovery case *before* ensureUserConnection runs,
  // because that call sets friendship_status to ACCEPTED immediately — which
  // would otherwise make `wasAccepted` true and suppress the return value.
  const isRecovery = !userConnection;
  if (!userConnection) {
    // Recovery path: the peer is telling us we're friends but we don't remember.
    // Since they could only encrypt this message to us via ECDH (proving prior
    // relationship), trust it and re-establish the connection.
    userConnection = ensureUserConnection(state, entry.from_user_id, accepterName, {
      friendshipStatus: FRIENDSHIP_STATUS_ACCEPTED,
    });
    if (!userConnection) return null;
    ensureContactBackLink(state, entry.from_user_id, accepterName);
  }
  if (userConnection.friendship_status === FRIENDSHIP_STATUS_REJECTED) {
    return null;
  }

  const wasAccepted = !isRecovery && isAcceptedFriendshipStatus(userConnection.friendship_status);
  userConnection.friendship_status = FRIENDSHIP_STATUS_ACCEPTED;
  userConnection.person_name = accepterName;
  ensureContact(state, entry.from_user_id, accepterName);

  // Restore the trust limit the accepter agreed to. This is the value the
  // peer echoes back from the suggested_credit_limit_eur in our friend_request,
  // so replaying a friend_accept during sync recovery fully reconstitutes the
  // established trust limit without any extra negotiation round-trips.
  const agreedLimit = normalizeCurrencyAmount(entry.payload?.trust_credit_limit_eur, NaN);
  if (Number.isFinite(agreedLimit) && agreedLimit >= 0) {
    userConnection.trust_credit_limit_eur = agreedLimit;
  }

  if (wasAccepted) {
    return null;
  }
  return friendNotification(`${accepterName} accepted your friend request`, entry.from_user_id);
};

const applyInboundFriendReject = async (state, entry) => {
  const displayName = getDisplayName(state, entry.from_user_id);
  const applied = await cancelPendingFriendRequest(state, entry.from_user_id, {
    direction: "from",
    displayName,
    skipLog: true,
  });
  if (!applied) {
    return null;
  }
  return notification(`${displayName} rejected your friend request`, entry.from_user_id, "friends");
};

const applyInboundTrustLimitSuggestion = (state, entry) => {
  const trustLimit = normalizeCurrencyAmount(entry.payload?.credit_limit_eur, NaN);
  if (!Number.isFinite(trustLimit) || trustLimit < 0) {
    return null;
  }

  const displayName = getDisplayName(state, entry.from_user_id);
  const userConnection = getUserConnection(state, entry.from_user_id);
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
      entry.from_user_id,
    );
  }

  if (trustLimit === existingLimit && userConnection.pending_credit_limit_eur !== null) {
    // Peer cancelled or declined — clear pending
    userConnection.pending_credit_limit_eur = null;
    userConnection.pending_credit_limit_is_incoming = null;
    if (wasIncoming) {
      return friendNotification(`${displayName} cancelled trust limit suggestion`, entry.from_user_id);
    }
    return friendNotification(`${displayName} rejected trust limit suggestion`, entry.from_user_id);
  }

  if (trustLimit < existingLimit) {
    // Lower: apply automatically, show notification
    userConnection.trust_credit_limit_eur = trustLimit;
    userConnection.pending_credit_limit_eur = trustLimit;
    userConnection.pending_credit_limit_is_incoming = "lowered";
    return friendNotification(
      `${displayName} lowered trust limit to ${formatCurrency(trustLimit)}`,
      entry.from_user_id,
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
    entry.from_user_id,
  );
};

const applyInboundNameChanged = (state, entry) => {
  const newName = asTrimmedString(entry.payload?.name);
  if (!newName) return null;

  const userConnection = getUserConnection(state, entry.from_user_id);
  if (!userConnection || !isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
    return null;
  }

  const oldName = userConnection.person_name || entry.from_user_id;
  userConnection.person_name = newName;
  ensureContact(state, entry.from_user_id, newName);

  if (oldName === newName) return null;
  userConnection.pending_name_change = { oldName, newName };
  return friendNotification(`${oldName} changed their name to ${newName}`, entry.from_user_id);
};

const applyInboundPaymentRequest = (state, entry) => {
  const amount = normalizeCurrencyAmount(entry.payload?.amount_eur, NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const displayName = getDisplayName(state, entry.from_user_id);
  const userConnection = getUserConnection(state, entry.from_user_id);
  if (!userConnection || !isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return null;
  }

  const note = asTrimmedString(entry.payload?.note) || "";
  const requestId = asTrimmedString(entry.payload?.request_id) || entry.id;

  userConnection.pending_payment_request = {
    id: requestId,
    amount_eur: amount,
    note,
    is_incoming: true,
    created_at: entry.originated_at || entry.timestamp || new Date().toISOString(),
  };

  return friendNotification(
    `${displayName} requested €${amount.toFixed(2)}`,
    entry.from_user_id,
  );
};

const applyInboundPaymentRequestResponse = (state, entry) => {
  const displayName = getDisplayName(state, entry.from_user_id);
  const userConnection = getUserConnection(state, entry.from_user_id);
  if (!userConnection || !isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return null;
  }

  const pendingRequest = userConnection.pending_payment_request;
  if (!pendingRequest || pendingRequest.is_incoming) {
    return null;
  }

  const requestId = asTrimmedString(entry.payload?.request_id);
  if (requestId && pendingRequest.id && requestId !== pendingRequest.id) {
    return null;
  }

  const accepted = entry.payload?.accepted === true;
  userConnection.pending_payment_request = null;

  if (accepted) {
    return friendNotification(
      `${displayName} accepted your payment request`,
      entry.from_user_id,
    );
  }
  return friendNotification(
    `${displayName} declined your payment request`,
    entry.from_user_id,
  );
};

const applyInboundTransactionCreated = (state, entry) => {
  const amount = normalizeCurrencyAmount(entry.payload?.amount_eur, NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const displayName = getDisplayName(state, entry.from_user_id);
  const userConnection = getUserConnection(state, entry.from_user_id);
  if (!userConnection || !isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return null;
  }

  const transactionId =
    asTrimmedString(entry.payload?.transaction_id) || asTrimmedString(entry.id) || createId("tx");

  // Idempotent: if we already recorded this transaction (e.g. the entry is
  // being replayed during recovery), don't double-count.
  if (
    Array.isArray(userConnection.recent_transactions) &&
    userConnection.recent_transactions.some((tx) => tx.id === transactionId)
  ) {
    return null;
  }

  const date =
    asTrimmedString(entry.payload?.date) || new Date().toISOString().slice(0, 10);
  const note =
    asTrimmedString(entry.payload?.note) || "IOU received";

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

  return friendNotification(`${displayName} sent €${amount.toFixed(2)} to you`, entry.from_user_id);
};

const createInboundProcessingResult = (view, acknowledgeResult = null) => {
  return {
    acknowledgeResult,
    view,
  };
};

/**
 * Derive app-state mutations from a ledger entry authored by a peer
 * (from_user_id = peer, to_user_id = me). The caller owns appending the
 * entry to the ledger, deduplication, last_synced_at, and persistence —
 * this function only derives the state change.
 *
 * Returns a notification `{ text, hash, friendId }` on success or `null`
 * if the entry was inapplicable (e.g. already-accepted friend_request).
 */
export const routeInboundEntry = async (state, entry) => {
  switch (entry.type) {
    case PEER_MESSAGE_TYPE_FRIEND_REQUEST:
      return await applyInboundFriendRequest(state, entry);
    case PEER_MESSAGE_TYPE_FRIEND_ACCEPT:
      return applyInboundFriendAccept(state, entry);
    case PEER_MESSAGE_TYPE_FRIEND_REJECT:
      return await applyInboundFriendReject(state, entry);
    case PEER_MESSAGE_TYPE_TRUST_LIMIT_SUGGESTION:
      return applyInboundTrustLimitSuggestion(state, entry);
    case PEER_MESSAGE_TYPE_PAYMENT_REQUEST:
      return applyInboundPaymentRequest(state, entry);
    case PEER_MESSAGE_TYPE_PAYMENT_REQUEST_RESPONSE:
      return applyInboundPaymentRequestResponse(state, entry);
    case PEER_MESSAGE_TYPE_TRANSACTION_CREATED:
      return applyInboundTransactionCreated(state, entry);
    case PEER_MESSAGE_TYPE_NAME_CHANGED:
      return applyInboundNameChanged(state, entry);
    default:
      warnIllegalPeerEntry(entry);
      return null;
  }
};

export { createInboundProcessingResult };

// ---------------------------------------------------------------------------
// Outbound entry application
// ---------------------------------------------------------------------------
// The symmetric counterpart to routeInboundEntry. Applies a ledger entry
// authored by this user (from_user_id === myId, to_user_id === peerId) to
// local app state. Called both when a command runs on this device AND when
// the same entry arrives via self-mesh sync from another device.
//
// Returning true means state was mutated; false means the entry was a no-op
// (already applied or not applicable). Callers own persistence.

const applyOutboundFriendRequest = (state, entry) => {
  const toId = asTrimmedString(entry.to_user_id);
  if (!toId) return false;
  // Create PENDING_OUTGOING only when no connection exists — don't overwrite
  // an already-accepted or already-pending connection.
  if (!getUserConnection(state, toId)) {
    ensureUserConnection(state, toId, toId, {
      friendshipStatus: FRIENDSHIP_STATUS_PENDING_OUTGOING,
    });
    return true;
  }
  return false;
};

const applyOutboundFriendAccept = (state, entry) => {
  const toId = asTrimmedString(entry.to_user_id);
  if (!toId) return false;
  let conn = getUserConnection(state, toId);
  let changed = false;
  if (!conn) {
    // No prior connection on this device — create it as accepted.
    conn = ensureUserConnection(state, toId, toId, {
      friendshipStatus: FRIENDSHIP_STATUS_ACCEPTED,
    });
    changed = !!conn;
  } else if (conn.friendship_status !== FRIENDSHIP_STATUS_ACCEPTED) {
    conn.friendship_status = FRIENDSHIP_STATUS_ACCEPTED;
    changed = true;
  }
  // Restore the trust limit that was agreed to (echoed back in the accept payload).
  if (conn) {
    const limit = normalizeCurrencyAmount(entry.payload?.trust_credit_limit_eur, NaN);
    if (Number.isFinite(limit) && limit >= 0) {
      conn.trust_credit_limit_eur = limit;
    }
  }
  return changed;
};

const applyOutboundFriendReject = (state, entry) => {
  const toId = asTrimmedString(entry.to_user_id);
  if (!toId) return false;
  if (!getUserConnection(state, toId)) return false;
  removeFriendRelationshipData(state, toId);
  return true;
};

const applyOutboundTransactionCreated = (state, entry) => {
  const toId = asTrimmedString(entry.to_user_id);
  if (!toId) return false;
  const conn = getUserConnection(state, toId);
  if (!conn || !isAcceptedFriendshipStatus(conn.friendship_status)) return false;

  // Idempotent: skip if this transaction is already recorded.
  const txId = asTrimmedString(entry.payload?.transaction_id) || asTrimmedString(entry.id);
  if (
    txId &&
    Array.isArray(conn.recent_transactions) &&
    conn.recent_transactions.some((tx) => tx.id === txId)
  ) {
    return false;
  }

  const amount = normalizeCurrencyAmount(entry.payload?.amount_eur, NaN);
  if (!Number.isFinite(amount) || amount <= 0) return false;

  const date = asTrimmedString(entry.payload?.date) || new Date().toISOString().slice(0, 10);
  const note = asTrimmedString(entry.payload?.note) || "IOU sent";

  if (!Array.isArray(conn.recent_transactions)) conn.recent_transactions = [];
  conn.debt_eur = (conn.debt_eur || 0) - amount;
  conn.recent_transactions.unshift(
    createTransactionModel({ id: txId || createId("tx"), date, amount_eur: -amount, note })
  );
  return true;
};

const applyOutboundPaymentRequest = (state, entry) => {
  const toId = asTrimmedString(entry.to_user_id);
  if (!toId) return false;
  const conn = getUserConnection(state, toId);
  if (!conn || !isAcceptedFriendshipStatus(conn.friendship_status)) return false;
  // Don't overwrite — a later payment_request_response may have cleared it.
  if (conn.pending_payment_request) return false;

  const amount = normalizeCurrencyAmount(entry.payload?.amount_eur, NaN);
  if (!Number.isFinite(amount) || amount <= 0) return false;

  conn.pending_payment_request = {
    id: asTrimmedString(entry.payload?.request_id) || asTrimmedString(entry.id),
    amount_eur: amount,
    note: asTrimmedString(entry.payload?.note) || "",
    is_incoming: false,
    created_at: entry.originated_at || entry.timestamp || new Date().toISOString(),
  };
  return true;
};

const applyOutboundPaymentRequestResponse = (state, entry) => {
  const toId = asTrimmedString(entry.to_user_id);
  if (!toId) return false;
  const conn = getUserConnection(state, toId);
  if (!conn || conn.pending_payment_request === null) return false;
  conn.pending_payment_request = null;
  return true;
};

const applyOutboundCreditLimitSuggestion = (state, entry) => {
  const toId = asTrimmedString(entry.to_user_id);
  if (!toId) return false;
  const conn = getUserConnection(state, toId);
  if (!conn || !isPeerEligibleFriendshipStatus(conn.friendship_status)) return false;

  const suggestedLimit = normalizeCurrencyAmount(entry.payload?.credit_limit_eur, NaN);
  if (!Number.isFinite(suggestedLimit) || suggestedLimit < 0) return false;

  const existingLimit = conn.trust_credit_limit_eur || 0;

  // Acceptance echo: the outbound value matches a currently-incoming pending
  // suggestion, meaning we accepted the peer's proposal on another device.
  if (
    conn.pending_credit_limit_is_incoming === true &&
    conn.pending_credit_limit_eur === suggestedLimit
  ) {
    conn.trust_credit_limit_eur = suggestedLimit;
    conn.pending_credit_limit_eur = null;
    conn.pending_credit_limit_is_incoming = null;
    return true;
  }

  if (existingLimit > 0 && suggestedLimit < existingLimit) {
    // Lowering: apply immediately; peer auto-applies on receive.
    conn.trust_credit_limit_eur = suggestedLimit;
    conn.pending_credit_limit_eur = null;
    conn.pending_credit_limit_is_incoming = null;
  } else if (suggestedLimit === existingLimit) {
    // Sending back current value = cancel or rejection echo; clear pending.
    conn.pending_credit_limit_eur = null;
    conn.pending_credit_limit_is_incoming = null;
  } else {
    // New or higher limit: wait for peer to agree.
    conn.pending_credit_limit_eur = suggestedLimit;
    conn.pending_credit_limit_is_incoming = false;
  }
  return true;
};

/**
 * Apply an outbound ledger entry (authored by this user, sent to a peer) to
 * local app state. The mutation is identical whether the entry was just
 * created by a local command or arrived via self-mesh sync from another
 * device. Returns true if state was mutated.
 */
export const routeOutboundEntry = (state, entry) => {
  if (!entry || !state.user?.id) return false;
  if (entry.from_user_id !== state.user.id) return false;
  const toId = asTrimmedString(entry.to_user_id);
  if (!toId || toId === state.user.id) return false;

  switch (entry.type) {
    case PEER_MESSAGE_TYPE_FRIEND_REQUEST:
      return applyOutboundFriendRequest(state, entry);
    case PEER_MESSAGE_TYPE_FRIEND_ACCEPT:
      return applyOutboundFriendAccept(state, entry);
    case PEER_MESSAGE_TYPE_FRIEND_REJECT:
      return applyOutboundFriendReject(state, entry);
    case PEER_MESSAGE_TYPE_TRANSACTION_CREATED:
      return applyOutboundTransactionCreated(state, entry);
    case PEER_MESSAGE_TYPE_PAYMENT_REQUEST:
      return applyOutboundPaymentRequest(state, entry);
    case PEER_MESSAGE_TYPE_PAYMENT_REQUEST_RESPONSE:
      return applyOutboundPaymentRequestResponse(state, entry);
    case PEER_MESSAGE_TYPE_TRUST_LIMIT_SUGGESTION:
      return applyOutboundCreditLimitSuggestion(state, entry);
    default:
      return false;
  }
};
