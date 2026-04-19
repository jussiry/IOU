/*
User-profile commands: renaming yourself (which notifies every peer so
their display stays current), and dismissing the "they renamed themselves"
notification on a friend.

Identity creation lives in `app-state.js` rather than here — it's part of
initializing the state store, not a mutation of an already-running one.
*/

import { PEER_MESSAGE_TYPE_NAME_CHANGED } from "../peer/messages.js";
import { isPeerEligibleFriendshipStatus } from "../utils/friendships.js";
import { asTrimmedString, hasUser } from "../state-utils.js";
import {
  loadData,
  loadState,
  persistAndBuildView,
} from "../app-state.js";
import { queuePeerMessage } from "../peer/outbox.js";
import { appendLedgerEntryFromMessage } from "../ledger.js";
import {
  getUserConnection,
  syncUserNameAcrossContacts,
} from "../connection-helpers.js";

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

  const connections = Array.isArray(state.user.connections) ? state.user.connections : [];
  const eligibleConnections = connections.filter((connection) =>
    isPeerEligibleFriendshipStatus(connection.friendship_status)
  );
  for (const connection of eligibleConnections) {
    const message = await queuePeerMessage(state, {
      toUserId: connection.person_id,
      type: PEER_MESSAGE_TYPE_NAME_CHANGED,
      payload: { name: trimmedName },
    });
    if (message) {
      appendLedgerEntryFromMessage(state, message);
    }
  }

  return persistAndBuildView(state);
};

export const dismissNameChangeNotification = async (friendId) => {
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

  userConnection.pending_name_change = null;
  return persistAndBuildView(state);
};
