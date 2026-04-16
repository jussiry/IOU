/*
The interface between the persisted app state and the realtime transport.

`peer/client.js` is the only caller. It needs a snapshot of who to
connect to and what to deliver (`getRealtimeSnapshot`), a way to merge ledger
batches received during sync (`addLedgerEntries`), receipts of its own
deliveries (`markPeerMessageReceived`, `updateLastSyncedAt`), and a handler
for verified inbound peer messages (`applyInboundPeerMessage`).

Keeping this surface in its own file makes the transport dependency on app
state explicit — command modules don't reach for these functions, and
transport code doesn't reach into command modules.
*/

import {
  createLedgerEntryModel,
  createPeerMessageModel,
} from "../models/data-model.js";
import { isPeerEligibleFriendshipStatus } from "../utils/friendships.js";
import { asTrimmedString, hasUser } from "../state-utils.js";
import { buildView } from "../ui/view-model.js";
import {
  loadData,
  loadState,
  persistAndBuildView,
  persistState,
} from "../app-state.js";
import { removeQueuedPeerMessage } from "./outbox.js";
import { findConnection } from "../connection-helpers.js";
import {
  createInboundProcessingResult,
  routeInboundMessage,
} from "./handlers.js";
import { mergeSyncedLedgerEntries } from "../ledger.js";
import { showNotification } from "../ui/notifications.js";

// Everything the realtime client needs to decide who to connect to and what
// to re-deliver after a reconnect. The ledger is included so sync_hello can
// send the `known_ids` list without taking another round-trip to the store.
export const getRealtimeSnapshot = async () => {
  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }

  const connections = Array.isArray(state.user.connections) ? state.user.connections : [];
  const eligibleConnections = connections.filter((connection) => isPeerEligibleFriendshipStatus(connection.friendship_status));
  const relationshipPeerIds = eligibleConnections
    .map((connection) => connection.person_id)
    .filter(Boolean);
  const queuedPeerIds = (Array.isArray(state.outbox) ? state.outbox : [])
    .map((message) => message.to_user_id)
    .filter(Boolean);

  const peerNames = {};
  eligibleConnections.forEach((connection) => {
    if (connection.person_id && connection.person_name) {
      peerNames[connection.person_id] = connection.person_name;
    }
  });

  return {
    userId: state.user.id,
    userName: state.user.name,
    userPrivateKeyHex: state.user.private_key_hex || "",
    peerIds: Array.from(new Set([...relationshipPeerIds, ...queuedPeerIds])),
    peerNames,
    outbox: Array.isArray(state.outbox) ? state.outbox.map((entry) => createPeerMessageModel(entry)) : [],
    ledger: Array.isArray(state.ledger) ? state.ledger.map((entry) => createLedgerEntryModel(entry)) : [],
  };
};

/**
 * Thin persistence wrapper around `mergeSyncedLedgerEntries` — the signature
 * verification and de-duplication live there. Returns the count added so the
 * caller can decide whether to re-emit a view.
 */
export const addLedgerEntries = async (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 0;
  }
  const state = await loadState();
  if (!hasUser(state)) return 0;

  const added = await mergeSyncedLedgerEntries(state, entries);
  if (added > 0) {
    await persistAndBuildView(state);
  }
  return added;
};

export const updateLastSyncedAt = async (peerId) => {
  const normalizedPeerId = asTrimmedString(peerId);
  if (!normalizedPeerId) return;

  const state = await loadState();
  if (!hasUser(state)) return;

  const connection = findConnection(state, normalizedPeerId);
  if (!connection) return;

  connection.last_synced_at = new Date().toISOString();
  await persistState(state);
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

  const removedMessage = removeQueuedPeerMessage(state, normalizedMessageId);
  if (!removedMessage) {
    return buildView(state);
  }

  const peerId = removedMessage.to_user_id;
  if (peerId) {
    const connection = findConnection(state, peerId);
    if (connection) {
      connection.last_synced_at = new Date().toISOString();
    }
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

  const result = await routeInboundMessage(state, message);

  if (!result.applied && !result.persisted) {
    return createInboundProcessingResult(
      buildView(state),
      result.acknowledgeResult
    );
  }

  if (result.notification) {
    showNotification(result.notification);
  }

  return createInboundProcessingResult(
    await persistAndBuildView(state),
    result.acknowledgeResult
  );
};
