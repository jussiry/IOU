/*
IOU transaction command. Records that the user has taken on debt toward a
friend (a "sent IOU"), updates the running debt balance, and propagates the
transaction to the peer so both sides agree on the balance.

Only `createTransaction` lives here for now — receiving a transaction is
handled inbound by `peer/handlers.js`.
*/

import {
  createTransactionModel,
  normalizeCurrencyAmount,
} from "../models/data-model.js";
import { PEER_MESSAGE_TYPE_TRANSACTION_CREATED } from "../peer/messages.js";
import { isAcceptedFriendshipStatus } from "../utils/friendships.js";
import { asTrimmedString, createId, hasUser } from "../state-utils.js";
import {
  loadData,
  loadState,
  persistAndBuildView,
} from "../app-state.js";
import { queuePeerMessage } from "../peer/outbox.js";
import { getDisplayName, getUserConnection } from "../connection-helpers.js";
import { appendLedgerEntryFromMessage } from "../ledger.js";

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

  const txMsg = await queuePeerMessage(state, {
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
  appendLedgerEntryFromMessage(state, txMsg);

  return persistAndBuildView(state);
};
