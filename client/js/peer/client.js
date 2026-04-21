/*
This module orchestrates websocket signaling, WebRTC peer sessions, and queued
peer-message delivery for the IOU client.

It subscribes to persisted app-state changes so presence, friendship
eligibility, and unsent messages stay in sync with the transport layer
without requiring page-specific code to know about networking internals.

Two parallel WebRTC overlays:

  * **Friend mesh** — one peer per friend npub (keyed by peer user id).
    Ledger state is exchanged bilaterally (`getLedgerEntriesForPeer`).

  * **Self-mesh** — one peer per *other device of the same user* (keyed by
    the server-assigned `peerDeviceId`). Both devices sync the entire
    ledger between them (`getAllLedgerEntries`) so each device stays in
    lock-step. Whenever a new entry is appended locally (by applying an
    inbound peer message or by the local user acting) we push it to every
    connected self-device via `sync_data`, so the other device doesn't
    have to wait for the next sync_hello round-trip to see it.

Both overlays use the same `createPeerMesh` factory and the same sync
wire format (`sync_hello` / `sync_data`); only the sender-side slice and
the mesh key differ.

Application-level peer messages travel inside encrypted envelopes wrapped
here so the WebRTC channel and the signaling server's fallback queue see
only ciphertext. Transport-only messages (ping/pong/receipts) keep flowing
as plaintext over the data channel — they are local to a live WebRTC
session and never need to be forwarded by the server.
*/

import {
  addLedgerEntries,
  applyInboundPeerMessage,
  applyOwnNameFromLedger,
  getRealtimeSnapshot,
  markPeerMessageReceived,
  updateLastSyncedAt,
} from "./bridge.js";
import { subscribeToDataChanges } from "../app-state.js";
import {
  createPeerReceiptMessage,
  PEER_MESSAGE_TYPE_PING,
  PEER_MESSAGE_TYPE_PONG,
  PEER_MESSAGE_TYPE_RECEIVED,
  PEER_MESSAGE_TYPE_SYNC_HELLO,
  PEER_MESSAGE_TYPE_SYNC_DATA,
} from "./messages.js";
import {
  isPeerEnvelope,
  unwrapPeerEnvelope,
  wrapPeerMessage,
} from "./envelope.js";
import {
  getAllLedgerEntries,
  getLedgerEntriesForPeer,
  verifyLedgerEntrySignature,
} from "../ledger.js";
import { createSignalingClient } from "../signaling/socket-client.js";
import { createPeerMesh } from "./mesh.js";
import {
  replaceConnectedPeerIds,
  replaceConnectedSelfDeviceIds,
  addServerPresentPeer,
  removeServerPresentPeer,
  clearServerPresentPeers,
} from "./status.js";

const SCOPE_FRIEND = "friend";
const SCOPE_SELF = "self";

const logRealtimeEvent = (message) => {
  console.log(`[Realtime] ${message}`);
};

const createRealtimeClient = () => {
  let currentSnapshot = null;
  // Tracks envelope ids already pushed to the server queue this WebSocket session.
  // Reset whenever the WebSocket re-registers so a server restart causes
  // outbox messages to be re-queued instead of stranded.
  const envelopesSentToServer = new Set();

  // Sync protocol state.
  // We defer sync_hello until the server has finished flushing any queued
  // envelopes for us — that way we won't re-request ledger entries we're
  // about to receive anyway via the regular inbound path.
  let serverQueueDrained = false;
  // Friend-mesh sync tracking — keyed by peerUserId.
  const pendingFriendSync = new Set();
  const syncedFriends = new Set();
  // Self-mesh sync tracking — keyed by peerDeviceId.
  const pendingSelfSync = new Map(); // deviceId -> peerUserId (= my userId)
  const syncedSelfDevices = new Set();

  // Tracks ledger entry ids already broadcast to self-devices in this session.
  // Every locally-applied or locally-merged entry is a candidate for re-send,
  // but replaying entries we just received would bounce back-and-forth
  // between devices. Seeding this with incoming entries (after merge) breaks
  // the loop.
  const broadcastedLedgerIds = new Set();

  const sendSyncMessage = async (peerKey, { scope }, type, payload, peerUserId) => {
    if (!currentSnapshot?.userPrivateKeyHex || !currentSnapshot?.userId) return;
    const mesh = scope === SCOPE_SELF ? selfMesh : peerMesh;
    if (!mesh.canSend(peerKey)) return;

    const randomId = (window.crypto?.randomUUID && window.crypto.randomUUID())
      || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const targetUserId = peerUserId || currentSnapshot.userId;
    const message = {
      id: `sync_${randomId}`,
      type,
      from_user_id: currentSnapshot.userId,
      to_user_id: targetUserId,
      created_at: new Date().toISOString(),
      payload,
    };
    try {
      const envelope = await wrapPeerMessage(message, {
        privateKeyHex: currentSnapshot.userPrivateKeyHex,
      });
      mesh.sendPeerMessage(peerKey, envelope);
    } catch (error) {
      logRealtimeEvent(
        `Failed to wrap sync message (${scope}/${type}): ${String(error?.message || error)}`
      );
    }
  };

  const getScopeEntries = (scope, peerUserId) => {
    if (!currentSnapshot) return [];
    if (scope === SCOPE_SELF) {
      return getAllLedgerEntries(currentSnapshot.ledger);
    }
    return getLedgerEntriesForPeer(
      currentSnapshot.ledger,
      currentSnapshot.userId,
      peerUserId,
    );
  };

  const sendSyncHello = async (peerKey, { scope, peerUserId }) => {
    if (!currentSnapshot) return;
    const entries = getScopeEntries(scope, peerUserId);
    if (scope === SCOPE_SELF) {
      syncedSelfDevices.add(peerKey);
    } else {
      syncedFriends.add(peerKey);
    }
    logRealtimeEvent(
      `Sending sync_hello (${scope}, ${entries.length} known entries)`
    );
    await sendSyncMessage(
      peerKey,
      { scope },
      PEER_MESSAGE_TYPE_SYNC_HELLO,
      { known_ids: entries.map((entry) => entry.id) },
      peerUserId,
    );
  };

  const handleSyncHello = async (peerKey, payload, { scope, peerUserId }) => {
    if (!currentSnapshot) return;
    const knownIds = new Set(
      Array.isArray(payload?.known_ids) ? payload.known_ids : []
    );
    const myEntries = getScopeEntries(scope, peerUserId);
    const missing = myEntries.filter((entry) => !knownIds.has(entry.id));
    logRealtimeEvent(
      `Received sync_hello (${scope}), sending ${missing.length} missing of ${knownIds.size} known`
    );
    // Seed the broadcast cache so we don't immediately re-push these entries
    // again through the subscribeToDataChanges path.
    if (scope === SCOPE_SELF) {
      missing.forEach((entry) => {
        if (entry?.id) broadcastedLedgerIds.add(entry.id);
      });
    }
    await sendSyncMessage(
      peerKey,
      { scope },
      PEER_MESSAGE_TYPE_SYNC_DATA,
      { entries: missing },
      peerUserId,
    );
  };

  const handleSyncData = async (peerKey, payload, { scope, peerUserId }) => {
    if (!currentSnapshot) return;
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    if (entries.length === 0) return;

    const myId = currentSnapshot.userId;
    const inboundLike = [];
    const outboundOnly = [];
    // Self-addressed entries (from_user_id === to_user_id === myId) are
    // authored by the local user on another device — e.g. the initial
    // name_changed entry created at account creation. They go to the ledger
    // but are not routed through the inbound message handler.
    const selfAddressed = [];
    for (const entry of entries) {
      // Every synced entry must carry a valid Schnorr signature by its
      // claimed `from_user_id`. This check applies to self-sync too — the
      // signing key is the same for both devices (both hold the user's
      // private key), so entries authored on device A verify cleanly on
      // device B. We keep the check so a compromised same-user channel
      // can't inject forged third-party history.
      const signatureValid = await verifyLedgerEntrySignature(entry);
      if (!signatureValid) {
        logRealtimeEvent(
          `Rejected entry with invalid signature (${scope}, from ${entry?.from_user_id?.slice(0, 10)}…)`
        );
        continue;
      }
      if (entry.from_user_id === myId && entry.to_user_id === myId) {
        selfAddressed.push(entry);
      } else if (entry.to_user_id === myId) {
        inboundLike.push(entry);
      } else if (entry.from_user_id === myId) {
        outboundOnly.push(entry);
      }
    }

    // Replay chronologically: a later tx_created can only apply after an
    // earlier friend_accept has re-created the connection during recovery.
    inboundLike.sort((a, b) => {
      const aTs = a.timestamp || "";
      const bTs = b.timestamp || "";
      return aTs < bTs ? -1 : aTs > bTs ? 1 : 0;
    });

    logRealtimeEvent(
      `Received sync_data (${scope}): ${entries.length} entries — ${inboundLike.length} inbound, ${outboundOnly.length} outbound, ${selfAddressed.length} self`
    );

    for (const entry of inboundLike) {
      // Seed the broadcast cache *before* the handler runs so the resulting
      // subscribeToDataChanges tick doesn't echo this entry back to peers.
      // If processing fails we remove the id so a future sync can retry it.
      if (entry?.id) broadcastedLedgerIds.add(entry.id);
      try {
        await applyInboundPeerMessage({
          id: entry.id,
          type: entry.type,
          from_user_id: entry.from_user_id,
          to_user_id: entry.to_user_id,
          // Preserve the sender's original `created_at` — it's what the
          // Schnorr signature was computed over, and what `originated_at`
          // should track in the resulting ledger entry.
          created_at: entry.originated_at || entry.timestamp,
          payload: entry.payload,
          signature: entry.signature,
        });
      } catch (err) {
        if (entry?.id) broadcastedLedgerIds.delete(entry.id);
        throw err;
      }
    }
    if (outboundOnly.length > 0) {
      outboundOnly.forEach((entry) => {
        if (entry?.id) broadcastedLedgerIds.add(entry.id);
      });
      await addLedgerEntries(outboundOnly);
    }
    if (selfAddressed.length > 0) {
      selfAddressed.forEach((entry) => {
        if (entry?.id) broadcastedLedgerIds.add(entry.id);
      });
      await addLedgerEntries(selfAddressed);
    }

    // After the ledger has been updated, scan it for the most recent
    // name_changed entry this user authored on any device and apply it as
    // the local display name. Scanning the persisted ledger (rather than the
    // in-flight classification arrays) is robust to signature failures and
    // handles the case where the key entry arrived in an earlier sync batch.
    if (scope === SCOPE_SELF) {
      await applyOwnNameFromLedger();
    }

    await syncRealtimeState();
  };

  const trySyncPendingPeers = () => {
    if (!serverQueueDrained) return;
    // Friend-mesh pending hellos.
    Array.from(pendingFriendSync).forEach((peerUserId) => {
      if (!peerMesh.canSend(peerUserId)) return;
      if (syncedFriends.has(peerUserId)) {
        pendingFriendSync.delete(peerUserId);
        return;
      }
      pendingFriendSync.delete(peerUserId);
      void sendSyncHello(peerUserId, {
        scope: SCOPE_FRIEND,
        peerUserId,
      });
    });
    // Self-mesh pending hellos.
    Array.from(pendingSelfSync.entries()).forEach(([deviceId, peerUserId]) => {
      if (!selfMesh.canSend(deviceId)) return;
      if (syncedSelfDevices.has(deviceId)) {
        pendingSelfSync.delete(deviceId);
        return;
      }
      pendingSelfSync.delete(deviceId);
      void sendSyncHello(deviceId, {
        scope: SCOPE_SELF,
        peerUserId,
      });
    });
  };

  // --- Friend mesh --------------------------------------------------------

  const peerMesh = createPeerMesh({
    getLocalKey: () => currentSnapshot?.userId || "",
    sendSignal: (peerKey, signal, ctx) => {
      // Friend mesh: peerKey is the peer user id, and we route the signal
      // via whatever peerDeviceId we captured on the incoming peer_connect.
      signalingClient.sendPeerSignal(peerKey, ctx?.peerDeviceId || "", signal);
    },
    onPeerReady: ({ peerKey, peerUserId }) => {
      const pid = peerUserId || peerKey;
      void updateLastSyncedAt(pid);
      pendingFriendSync.add(pid);
      trySyncPendingPeers();
      void syncRealtimeState();
    },
    onPeerStatusChange: (connectedPeerKeys) => {
      replaceConnectedPeerIds(connectedPeerKeys);
    },
    onPeerMessage: ({ peerKey, peerUserId, message }) => {
      void handlePeerMessage(peerKey, peerUserId || peerKey, message, SCOPE_FRIEND);
    },
    // When a friend peer drops unexpectedly, ask the server to re-pair us.
    // We only retry if the connection had previously reached "connected" —
    // otherwise the network likely blocks WebRTC outright and retrying in
    // a tight loop is pointless. Intentional closes (server_disconnect,
    // stale_replaced, remote_allowance_timeout) are skipped.
    onPeerClosed: ({ peerUserId, peerKey, reason, wasConnected }) => {
      if (!wasConnected) return;
      if (
        reason === "server_disconnect" ||
        reason === "stale_replaced" ||
        reason === "remote_allowance_timeout"
      ) {
        return;
      }
      requestPeerConnectionIfNeeded(
        peerUserId || peerKey,
        "Retrying peer connection after unexpected close"
      );
    },
  });

  // --- Self-mesh ----------------------------------------------------------

  const selfMesh = createPeerMesh({
    // Self-check is a no-op for the self-mesh: the server never emits
    // peer_connect for our own device id, so we leave the local key empty.
    getLocalKey: () => "",
    alwaysAllow: true,
    sendSignal: (peerKey, signal, ctx) => {
      // Self-mesh: peerKey is the peer's device id; peerUserId is our own
      // user id (same on both sides), which the server also requires for
      // eligibility checks.
      signalingClient.sendPeerSignal(
        ctx?.peerUserId || currentSnapshot?.userId || "",
        peerKey,
        signal
      );
    },
    onPeerReady: ({ peerKey, peerUserId }) => {
      pendingSelfSync.set(peerKey, peerUserId || currentSnapshot?.userId || "");
      trySyncPendingPeers();
    },
    onPeerStatusChange: (connectedDeviceIds) => {
      replaceConnectedSelfDeviceIds(connectedDeviceIds);
    },
    onPeerMessage: ({ peerKey, peerUserId, message }) => {
      void handlePeerMessage(peerKey, peerUserId || currentSnapshot?.userId || "", message, SCOPE_SELF);
    },
  });

  // --- Signaling ----------------------------------------------------------

  const signalingClient = createSignalingClient({
    onPeerConnect: ({ peerUserId, peerDeviceId, initiator }) => {
      const myUserId = currentSnapshot?.userId || "";
      if (myUserId && peerUserId === myUserId) {
        // Same user, different device → self-mesh keyed by peerDeviceId.
        if (!peerDeviceId) return;
        selfMesh.ensurePeer(peerDeviceId, {
          initiator,
          peerUserId,
          peerDeviceId,
        });
        return;
      }
      // Different user → friend mesh keyed by peerUserId.
      // Track server presence so the UI can show a "partly online" state
      // when the relay sees the friend but WebRTC hasn't established yet.
      addServerPresentPeer(peerUserId, peerDeviceId);
      peerMesh.ensurePeer(peerUserId, {
        initiator,
        peerUserId,
        peerDeviceId,
      });
    },
    onPeerDisconnect: ({ peerUserId, peerDeviceId }) => {
      const myUserId = currentSnapshot?.userId || "";
      if (myUserId && peerUserId === myUserId && peerDeviceId) {
        logRealtimeEvent(`Self-device disconnected from server (${peerDeviceId?.slice(0, 8)}…)`);
        selfMesh.closePeer(peerDeviceId);
        syncedSelfDevices.delete(peerDeviceId);
        pendingSelfSync.delete(peerDeviceId);
        return;
      }
      logRealtimeEvent(`Peer disconnected from server (${peerUserId?.slice(0, 10)}…)`);
      removeServerPresentPeer(peerUserId, peerDeviceId);
      peerMesh.closePeer(peerUserId);
    },
    onPeerSignal: ({ peerUserId, peerDeviceId, signal }) => {
      const myUserId = currentSnapshot?.userId || "";
      if (myUserId && peerUserId === myUserId && peerDeviceId) {
        void selfMesh.handleSignal(peerDeviceId, signal, {
          peerUserId,
          peerDeviceId,
        });
        return;
      }
      void peerMesh.handleSignal(peerUserId, signal, {
        peerUserId,
        peerDeviceId,
      });
    },
    onPeerEnvelopeFromServer: ({ envelope }) => {
      void handleServerDeliveredEnvelope(envelope);
    },
    onSessionReady: () => {
      // The WebSocket just (re-)registered, so any envelopes the server held
      // for us are about to arrive. Forget what we previously asked the server
      // to queue so a server restart doesn't strand undelivered messages.
      envelopesSentToServer.clear();
      // Wait for `queue_drained` before initiating sync_hello so we don't
      // re-request ledger entries the server is about to redeliver.
      serverQueueDrained = false;
      syncedFriends.clear();
      syncedSelfDevices.clear();
      void syncRealtimeState();
    },
    onQueueDrained: () => {
      logRealtimeEvent("Server queue drained");
      serverQueueDrained = true;
      trySyncPendingPeers();
    },
  });

  const requestPeerConnectionIfNeeded = (peerUserId, logTitle = "Requesting peer connection") => {
    if (!peerUserId || peerMesh.canSend(peerUserId) || peerMesh.hasPeer(peerUserId)) {
      return;
    }

    logRealtimeEvent(`${logTitle} (${peerUserId?.slice(0, 10)}…)`);
    signalingClient.requestPeerConnection(peerUserId);
  };

  const flushOutbox = async () => {
    if (!currentSnapshot) {
      return;
    }

    const privateKeyHex = currentSnapshot.userPrivateKeyHex;
    if (!privateKeyHex) {
      return;
    }

    for (const message of currentSnapshot.outbox) {
      const directlyConnected = peerMesh.canSend(message.to_user_id);
      if (directlyConnected && peerMesh.hasInflightMessage(message.to_user_id, message.id)) {
        continue;
      }
      if (!directlyConnected && envelopesSentToServer.has(message.id)) {
        continue;
      }

      let envelope;
      try {
        envelope = await wrapPeerMessage(message, { privateKeyHex });
      } catch (error) {
        logRealtimeEvent(
          `Failed to wrap outgoing message ${message.id?.slice(0, 10)}…: ${String(error?.message || error)}`
        );
        continue;
      }

      if (directlyConnected) {
        peerMesh.sendPeerMessage(message.to_user_id, envelope);
        continue;
      }

      const queued = signalingClient.queuePeerEnvelopeOnServer(envelope);
      if (queued) {
        envelopesSentToServer.add(message.id);
        logRealtimeEvent(
          `Queued envelope on server → ${message.to_user_id?.slice(0, 10)}…`
        );
      }
    }
  };

  // Broadcasts locally-added ledger entries to every connected self-device.
  // Called from syncRealtimeState after the snapshot refreshes, so the
  // ledger we iterate is the one that was just persisted.
  const broadcastNewLedgerEntriesToSelfDevices = async () => {
    if (!currentSnapshot) return;
    const connected = [];
    selfMesh.forEachConnectedPeer((ctx) => connected.push(ctx));
    if (connected.length === 0) {
      // Still keep broadcastedLedgerIds up to date so future sends don't
      // re-push the entire ledger the moment a self-device connects.
      currentSnapshot.ledger.forEach((entry) => {
        if (entry?.id) broadcastedLedgerIds.add(entry.id);
      });
      return;
    }

    const freshEntries = currentSnapshot.ledger.filter(
      (entry) => entry?.id && !broadcastedLedgerIds.has(entry.id)
    );
    if (freshEntries.length === 0) return;

    freshEntries.forEach((entry) => broadcastedLedgerIds.add(entry.id));

    for (const { peerKey, peerUserId } of connected) {
      await sendSyncMessage(
        peerKey,
        { scope: SCOPE_SELF },
        PEER_MESSAGE_TYPE_SYNC_DATA,
        { entries: freshEntries },
        peerUserId || currentSnapshot.userId,
      );
    }
    logRealtimeEvent(`Broadcast ${freshEntries.length} ledger entries to ${connected.length} self-devices`);
  };

  const syncRealtimeState = async () => {
    currentSnapshot = await getRealtimeSnapshot();
    if (!currentSnapshot) {
      signalingClient.setSession({ userId: "", peerIds: [] });
      peerMesh.closePeersNotInSet([]);
      selfMesh.closePeersNotInSet([]);
      replaceConnectedPeerIds([]);
      replaceConnectedSelfDeviceIds([]);
      clearServerPresentPeers();
      return;
    }

    signalingClient.setSession({
      userId: currentSnapshot.userId,
      peerIds: currentSnapshot.peerIds,
    });
    peerMesh.closePeersNotInSet(currentSnapshot.peerIds);
    // Self-mesh never closes on snapshot (alwaysAllow=true) — passing an
    // empty set just updates internal bookkeeping harmlessly.
    selfMesh.closePeersNotInSet([]);

    currentSnapshot.peerIds.forEach((peerUserId) => {
      requestPeerConnectionIfNeeded(peerUserId);
    });
    await flushOutbox();
    await broadcastNewLedgerEntriesToSelfDevices();
  };

  const pendingPings = new Map();

  const handleReceiptMessage = async (receiptMessage) => {
    const receivedMessageId =
      typeof receiptMessage.payload?.message_id === "string"
        ? receiptMessage.payload.message_id.trim()
        : "";
    if (!receivedMessageId) {
      return;
    }

    logRealtimeEvent(`Receipt received for msg ${receivedMessageId?.slice(0, 10)}…`);
    peerMesh.clearInflightMessage(receivedMessageId);
    envelopesSentToServer.delete(receivedMessageId);
    await markPeerMessageReceived(receivedMessageId);
    await syncRealtimeState();
  };

  const sendReceiptForInnerMessage = async (innerMessage, acknowledgeResult, preferredPeerKey) => {
    if (!acknowledgeResult || !currentSnapshot?.userId) {
      return;
    }

    const receipt = createPeerReceiptMessage({
      fromUserId: currentSnapshot.userId,
      toUserId: innerMessage.from_user_id,
      messageId: innerMessage.id,
      result: acknowledgeResult,
    });

    // Prefer replying on the same WebRTC channel we received on, then fall
    // back to the user-id-based friend mesh. Self-mesh receipts are a no-op:
    // the sender sees its own broadcast land on its own ledger, no ack needed.
    if (preferredPeerKey && peerMesh.canSend(preferredPeerKey)) {
      peerMesh.sendControlMessage(preferredPeerKey, receipt);
      logRealtimeEvent(`Sent receipt via WebRTC (preferred channel)`);
      return;
    }
    const fallbackKey = innerMessage.from_user_id;
    if (fallbackKey && peerMesh.canSend(fallbackKey)) {
      peerMesh.sendControlMessage(fallbackKey, receipt);
      logRealtimeEvent(`Sent receipt via WebRTC (fallback channel)`);
      return;
    }

    // No live data channel — wrap the receipt as an envelope and let the
    // signaling server hold it until the original sender comes back online.
    if (!currentSnapshot.userPrivateKeyHex) {
      return;
    }

    try {
      const envelope = await wrapPeerMessage(receipt, {
        privateKeyHex: currentSnapshot.userPrivateKeyHex,
      });
      const queued = signalingClient.queuePeerEnvelopeOnServer(envelope);
      logRealtimeEvent(queued ? "Queued receipt on server" : "Receipt queue rejected by server");
    } catch (error) {
      logRealtimeEvent(`Failed to wrap receipt for server: ${String(error?.message || error)}`);
    }
  };

  const processInnerPeerMessage = async (
    innerMessage,
    { receiptChannelPeerKey, scope = SCOPE_FRIEND, peerKey, peerUserId } = {}
  ) => {
    if (innerMessage.type === PEER_MESSAGE_TYPE_RECEIVED) {
      await handleReceiptMessage(innerMessage);
      return;
    }

    if (innerMessage.type === PEER_MESSAGE_TYPE_SYNC_HELLO) {
      await handleSyncHello(peerKey, innerMessage.payload, {
        scope,
        peerUserId: peerUserId || innerMessage.from_user_id,
      });
      return;
    }

    if (innerMessage.type === PEER_MESSAGE_TYPE_SYNC_DATA) {
      await handleSyncData(peerKey, innerMessage.payload, {
        scope,
        peerUserId: peerUserId || innerMessage.from_user_id,
      });
      return;
    }

    const processingResult = await applyInboundPeerMessage(innerMessage);
    // Receipts are only meaningful on the friend mesh — a self-device
    // doesn't need one because both sides share the same processed-id set
    // after the sync completes.
    if (scope === SCOPE_FRIEND) {
      await sendReceiptForInnerMessage(
        innerMessage,
        processingResult?.acknowledgeResult,
        receiptChannelPeerKey,
      );
    }
    await syncRealtimeState();
  };

  const handlePeerMessage = async (peerKey, peerUserId, message, scope = SCOPE_FRIEND) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === PEER_MESSAGE_TYPE_PING) {
      logRealtimeEvent(`Ping received (${scope})`);
      const mesh = scope === SCOPE_SELF ? selfMesh : peerMesh;
      mesh.sendControlMessage(peerKey, {
        type: PEER_MESSAGE_TYPE_PONG,
        timestamp: message.timestamp,
      });
      return;
    }

    if (message.type === PEER_MESSAGE_TYPE_PONG) {
      const sentAt = message.timestamp;
      const roundTripMs = sentAt ? Date.now() - sentAt : null;
      logRealtimeEvent(`Pong received (${scope}, ${roundTripMs}ms RTT)`);
      const resolve = pendingPings.get(peerKey);
      if (resolve) {
        pendingPings.delete(peerKey);
        resolve(roundTripMs);
      }
      return;
    }

    if (message.type === PEER_MESSAGE_TYPE_RECEIVED) {
      // Plaintext receipt over WebRTC — used as the fast path when both peers
      // have a live data channel. Same handling as a server-delivered receipt.
      await handleReceiptMessage(message);
      return;
    }

    if (!isPeerEnvelope(message)) {
      logRealtimeEvent(`Dropping non-envelope message (${scope}, type: ${message.type})`);
      return;
    }

    const innerMessage = await unwrapEnvelopeOrLog(message, peerKey);
    if (!innerMessage) {
      return;
    }

    await processInnerPeerMessage(innerMessage, {
      receiptChannelPeerKey: scope === SCOPE_FRIEND ? peerKey : "",
      scope,
      peerKey,
      peerUserId,
    });
  };

  const unwrapEnvelopeOrLog = async (envelope, sourcePeerKey) => {
    const privateKeyHex = currentSnapshot?.userPrivateKeyHex;
    if (!privateKeyHex || !currentSnapshot?.userId) {
      return null;
    }

    try {
      return await unwrapPeerEnvelope(envelope, {
        privateKeyHex,
        expectedRecipientId: currentSnapshot.userId,
      });
    } catch (error) {
      logRealtimeEvent(
        `Failed to unwrap envelope from ${sourcePeerKey?.slice(0, 10)}…: ${String(error?.message || error)}`
      );
      return null;
    }
  };

  const handleServerDeliveredEnvelope = async (envelope) => {
    if (!isPeerEnvelope(envelope)) {
      return;
    }

    logRealtimeEvent(
      `Envelope received from server (from ${envelope.from_user_id?.slice(0, 10)}…)`
    );

    const innerMessage = await unwrapEnvelopeOrLog(envelope, envelope.from_user_id);
    if (!innerMessage) {
      return;
    }

    // Server-delivered envelopes are always friend-scope (the server never
    // mediates same-user syncing — that only travels over the self-mesh).
    await processInnerPeerMessage(innerMessage, {
      receiptChannelPeerKey: innerMessage.from_user_id,
      scope: SCOPE_FRIEND,
      peerKey: innerMessage.from_user_id,
      peerUserId: innerMessage.from_user_id,
    });
  };

  const unsubscribe = subscribeToDataChanges(() => {
    void syncRealtimeState();
  });

  void syncRealtimeState();

  const ping = (nameOrKey) => {
    if (!nameOrKey || !currentSnapshot) {
      console.log("[Ping] No target specified or not connected");
      return Promise.resolve(null);
    }

    const target = String(nameOrKey).trim().toLowerCase();
    const connectedIds = currentSnapshot.peerIds.filter((id) => peerMesh.canSend(id));
    const peerNames = currentSnapshot.peerNames || {};

    // Match by exact public key, key prefix, or friend name
    let peerId = connectedIds.find((id) => id === nameOrKey.trim());

    if (!peerId) {
      peerId = connectedIds.find((id) => {
        const name = (peerNames[id] || "").toLowerCase();
        return name === target || name.startsWith(target) || id.includes(target);
      });
    }

    if (!peerId) {
      console.log(`[Ping] No connected peer matching "${target}". Connected peers:`, connectedIds);
      return Promise.resolve(null);
    }

    peerMesh.sendControlMessage(peerId, {
      type: PEER_MESSAGE_TYPE_PING,
      timestamp: Date.now(),
    });

    return new Promise((resolve) => {
      pendingPings.set(peerId, resolve);
      setTimeout(() => {
        if (pendingPings.has(peerId)) {
          pendingPings.delete(peerId);
          console.log(`[Ping] Timeout — no pong from ${peerId}`);
          resolve(null);
        }
      }, 5000);
    }).then((ms) => {
      if (ms !== null) {
        console.log(`[Ping] ${peerId} responded in ${ms}ms`);
      }
      return ms;
    });
  };

  window.ping = ping;

  return {
    ping,
    destroy: () => {
      replaceConnectedPeerIds([]);
      replaceConnectedSelfDeviceIds([]);
      clearServerPresentPeers();
      unsubscribe();
      peerMesh.destroy();
      selfMesh.destroy();
      signalingClient.destroy();
      delete window.ping;
    },
  };
};

export {
  createRealtimeClient,
};
