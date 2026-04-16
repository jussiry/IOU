/*
Trust-limit commands: raising/lowering the amount you allow a friend to owe
you, responding to a suggestion from them, withdrawing your own pending
suggestion, and dismissing the "they lowered it" notification.

The asymmetry between raising and lowering is load-bearing: lowering takes
effect immediately (you can always reduce your own exposure), while raising
requires the peer's agreement and sits in a pending state until they echo
it back.
*/

import { normalizeCurrencyAmount } from "../models/data-model.js";
import { isPeerEligibleFriendshipStatus, FRIENDSHIP_STATUS_PENDING_INCOMING, FRIENDSHIP_STATUS_REJECTED } from "../utils/friendships.js";
import { asTrimmedString, hasUser } from "../state-utils.js";
import { buildView } from "../ui/view-model.js";
import {
  loadData,
  loadState,
  persistAndBuildView,
} from "../app-state.js";
import { queueTrustLimitSuggestion } from "../peer/outbox.js";
import { getDisplayName, getUserConnection } from "../connection-helpers.js";
import { appendLedgerEntryFromMessage } from "../ledger.js";

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
      const msg = await queueTrustLimitSuggestion(state, normalizedFriendId, normalizedTrustLimit);
      appendLedgerEntryFromMessage(state, msg);
    }
  } else {
    // New or higher limit: don't apply locally yet, wait for peer to accept
    userConnection.pending_credit_limit_eur = normalizedTrustLimit;
    userConnection.pending_credit_limit_is_incoming = false;
    if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
      const msg = await queueTrustLimitSuggestion(state, normalizedFriendId, normalizedTrustLimit);
      appendLedgerEntryFromMessage(state, msg);
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
  }

  userConnection.pending_credit_limit_eur = null;
  userConnection.pending_credit_limit_is_incoming = null;

  if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
    const msg = await queueTrustLimitSuggestion(state, normalizedFriendId, responseLimit);
    appendLedgerEntryFromMessage(state, msg);
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

  const userConnection = getUserConnection(state, normalizedFriendId);
  if (!userConnection || userConnection.pending_credit_limit_is_incoming !== false) {
    return loadData();
  }

  const currentLimit = userConnection.trust_credit_limit_eur || 0;
  userConnection.pending_credit_limit_eur = null;
  userConnection.pending_credit_limit_is_incoming = null;

  if (isPeerEligibleFriendshipStatus(userConnection.friendship_status)) {
    const msg = await queueTrustLimitSuggestion(state, normalizedFriendId, currentLimit);
    appendLedgerEntryFromMessage(state, msg);
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
