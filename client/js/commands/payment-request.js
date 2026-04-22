/*
Payment-request commands: asking a friend to pay you, responding to a
request from them, and dismissing a stale request after the fact.

When a friend accepts a request, this module also creates the mirroring
IOU transaction locally — the acceptance is equivalent to the friend
sending us an IOU, so we materialize that transaction in the same tick so
balances stay consistent.

State mutations go through routeOutboundEntry so the same logic runs
whether the action happened on this device or synced from another device.
*/

import {
  normalizeCurrencyAmount,
} from "../models/data-model.js";
import {
  PEER_MESSAGE_TYPE_PAYMENT_REQUEST,
  PEER_MESSAGE_TYPE_PAYMENT_REQUEST_RESPONSE,
  PEER_MESSAGE_TYPE_TRANSACTION_CREATED,
} from "../peer/messages.js";
import { isAcceptedFriendshipStatus } from "../utils/friendships.js";
import { asTrimmedString, createId, hasUser } from "../state-utils.js";
import {
  loadData,
  loadState,
  persistAndBuildView,
} from "../app-state.js";
import { queuePeerMessage } from "../peer/outbox.js";
import { getUserConnection } from "../connection-helpers.js";
import { appendLedgerEntryFromMessage } from "../ledger.js";
import { routeOutboundEntry } from "../peer/handlers.js";

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

  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection || !isAcceptedFriendshipStatus(userConnection.friendship_status)) {
    return loadData();
  }

  const trimmedMessage = asTrimmedString(message);
  const requestId = createId("pr");

  const prMsg = await queuePeerMessage(state, {
    toUserId: normalizedFriendId,
    type: PEER_MESSAGE_TYPE_PAYMENT_REQUEST,
    payload: {
      request_id: requestId,
      amount_eur: normalizedAmount,
      note: trimmedMessage,
    },
  });
  appendLedgerEntryFromMessage(state, prMsg);
  routeOutboundEntry(state, prMsg);

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

  const responseMsg = await queuePeerMessage(state, {
    toUserId: normalizedFriendId,
    type: PEER_MESSAGE_TYPE_PAYMENT_REQUEST_RESPONSE,
    payload: {
      request_id: requestId,
      accepted,
    },
  });
  appendLedgerEntryFromMessage(state, responseMsg);
  routeOutboundEntry(state, responseMsg);

  if (accepted) {
    const transactionId = createId("tx");
    const date = new Date().toISOString().slice(0, 10);
    const note = requestNote || "Payment request accepted";

    const txMsg = await queuePeerMessage(state, {
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
    appendLedgerEntryFromMessage(state, txMsg);
    routeOutboundEntry(state, txMsg);
  }

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
