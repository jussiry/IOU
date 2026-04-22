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
import { findConnection, syncUserNameAcrossContacts } from "../connection-helpers.js";
import {
  createInboundProcessingResult,
  routeInboundMessage,
  routeOutboundEntry,
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

// Like addLedgerEntries, but also applies outbound entries to user-connection
// state via routeOutboundEntry. This is the unified pipeline: the same state
// transition runs whether the entry was created by a local command or received
// via self-mesh sync from another device.
//
// Entries must be pre-sorted chronologically by the caller so causal
// dependencies (e.g. friend_request before friend_accept) are honoured.
export const addOutboundLedgerEntries = async (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  const state = await loadState();
  if (!hasUser(state)) return 0;

  const added = await mergeSyncedLedgerEntries(state, entries);

  // Apply every entry regardless of whether it was newly added — the
  // connection record may be missing even if the ledger entry was already
  // stored (e.g. a previous sync that crashed before persisting contacts).
  let stateChanged = added;
  for (const entry of entries) {
    if (routeOutboundEntry(state, entry)) stateChanged += 1;
  }

  if (stateChanged > 0) {
    await persistAndBuildView(state);
  }
  return added;
};

// The localStorage key and version that tracks whether the one-time ledger
// migration has been run on this device. Bump LEDGER_MIGRATION_VERSION
// whenever a future change requires a full ledger replay.
const LEDGER_MIGRATION_KEY = "iou_ledger_migration_v";
const LEDGER_MIGRATION_VERSION = 1;

// Run the full ledger repair exactly once per device, the first time this
// version of the app starts. On all subsequent starts the localStorage flag
// is set and this is a cheap no-op. Bump LEDGER_MIGRATION_VERSION to
// re-trigger for future migrations.
export const runLedgerMigrationIfNeeded = async () => {
  try {
    const stored = parseInt(localStorage.getItem(LEDGER_MIGRATION_KEY) || "0", 10);
    if (stored >= LEDGER_MIGRATION_VERSION) return;
    await repairConnectionsFromLedger();
    localStorage.setItem(LEDGER_MIGRATION_KEY, String(LEDGER_MIGRATION_VERSION));
  } catch {
    // Non-fatal — if localStorage is unavailable the repair still ran; the
    // flag just won't persist, so it will run again next startup (acceptable).
  }
};

// Scans the full persisted ledger for outbound entries and re-applies them
// via routeOutboundEntry. Normally called only via runLedgerMigrationIfNeeded.
// Can also be triggered explicitly for corrupted-state recovery.
export const repairConnectionsFromLedger = async () => {
  const state = await loadState();
  if (!hasUser(state)) return;

  const myId = state.user.id;
  const ledger = Array.isArray(state.ledger) ? state.ledger : [];

  // Sort ascending so causal dependencies are processed first.
  const outboundEntries = ledger
    .filter((e) => e.from_user_id === myId && e.to_user_id && e.to_user_id !== myId)
    .sort((a, b) => {
      const aTs = a.originated_at || a.timestamp || "";
      const bTs = b.originated_at || b.timestamp || "";
      return aTs < bTs ? -1 : aTs > bTs ? 1 : 0;
    });

  let changed = 0;
  for (const entry of outboundEntries) {
    if (routeOutboundEntry(state, entry)) changed += 1;
  }

  if (changed > 0) {
    await persistAndBuildView(state);
  }
};

export const updateLastSyncedAt = async (peerId) => {
  const normalizedPeerId = asTrimmedString(peerId);
  if (!normalizedPeerId) return;

  const state = await loadState();
  if (!hasUser(state)) return;

  const connection = findConnection(state.user, normalizedPeerId);
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
    const connection = findConnection(state.user, peerId);
    if (connection) {
      connection.last_synced_at = new Date().toISOString();
    }
  }

  return persistAndBuildView(state);
};

// Scans the full persisted ledger for name_changed entries authored by the
// local user and applies the most recently-originated one as the display name.
// Called after any self-mesh sync so both devices converge on the same name
// without relying on in-flight entry classification being perfect.
export const applyOwnNameFromLedger = async () => {
  const state = await loadState();
  if (!hasUser(state)) return;

  const myId = state.user.id;
  const nameEntries = (Array.isArray(state.ledger) ? state.ledger : []).filter(
    (e) =>
      e.type === "name_changed" &&
      e.from_user_id === myId &&
      typeof e.payload?.name === "string" &&
      e.payload.name.trim()
  );
  if (nameEntries.length === 0) return;

  nameEntries.sort((a, b) => {
    const aTs = a.originated_at || a.timestamp || "";
    const bTs = b.originated_at || b.timestamp || "";
    return aTs < bTs ? -1 : aTs > bTs ? 1 : 0;
  });
  const latestName = nameEntries[nameEntries.length - 1].payload.name.trim();

  if (!latestName || state.user.name === latestName) return;

  state.user.name = latestName;
  syncUserNameAcrossContacts(state);
  await persistAndBuildView(state);
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
