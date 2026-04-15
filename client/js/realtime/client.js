/*
This module orchestrates websocket signaling, WebRTC peer sessions, and queued peer-message delivery for the IOU client.

It subscribes to persisted app-state changes so presence, friendship eligibility, and unsent messages stay in sync with the transport layer without requiring page-specific code to know about networking internals.

Application-level peer messages travel inside encrypted envelopes wrapped here so the WebRTC channel and the signaling server's fallback queue see only ciphertext. Transport-only messages (ping/pong/receipts) keep flowing as plaintext over the data channel — they are local to a live WebRTC session and never need to be forwarded by the server.
*/

import {
  addLedgerEntries,
  applyInboundPeerMessage,
  getRealtimeSnapshot,
  markPeerMessageReceived,
  subscribeToDataChanges,
  updateLastSyncedAt,
} from "../data.js";
import {
  createPeerReceiptMessage,
  PEER_MESSAGE_TYPE_PING,
  PEER_MESSAGE_TYPE_PONG,
  PEER_MESSAGE_TYPE_RECEIVED,
  PEER_MESSAGE_TYPE_SYNC_HELLO,
  PEER_MESSAGE_TYPE_SYNC_DATA,
} from "./peer-messages.js";
import {
  isPeerEnvelope,
  unwrapPeerEnvelope,
  verifyLedgerEntrySignature,
  wrapPeerMessage,
} from "./peer-envelope.js";
import { createSignalingClient } from "../signaling/socket-client.js";
import { createPeerMesh } from "./peer-mesh.js";
import { replaceConnectedPeerIds } from "./peer-status.js";

const logRealtimeEvent = (title, detail) => {
  if (typeof detail === "undefined") {
    console.log(`[Realtime] ${title}`);
    return;
  }

  console.log(`[Realtime] ${title}`, detail);
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
  const pendingSyncPeers = new Set();
  const syncedPeers = new Set();

  const getLedgerEntriesForPeer = (ledger, myId, peerId) => {
    if (!Array.isArray(ledger)) return [];
    return ledger.filter((entry) =>
      (entry.from_user_id === myId && entry.to_user_id === peerId) ||
      (entry.from_user_id === peerId && entry.to_user_id === myId)
    );
  };

  const sendSyncMessage = async (peerUserId, type, payload) => {
    if (!currentSnapshot?.userPrivateKeyHex || !currentSnapshot?.userId) return;
    if (!peerMesh.canSend(peerUserId)) return;

    const randomId = (window.crypto?.randomUUID && window.crypto.randomUUID())
      || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const message = {
      id: `sync_${randomId}`,
      type,
      from_user_id: currentSnapshot.userId,
      to_user_id: peerUserId,
      created_at: new Date().toISOString(),
      payload,
    };
    try {
      const envelope = await wrapPeerMessage(message, {
        privateKeyHex: currentSnapshot.userPrivateKeyHex,
      });
      peerMesh.sendPeerMessage(peerUserId, envelope);
    } catch (error) {
      logRealtimeEvent("Failed to wrap sync message", {
        type,
        peerUserId,
        error: String(error?.message || error),
      });
    }
  };

  const sendSyncHello = async (peerUserId) => {
    if (!currentSnapshot) return;
    const entries = getLedgerEntriesForPeer(
      currentSnapshot.ledger,
      currentSnapshot.userId,
      peerUserId,
    );
    syncedPeers.add(peerUserId);
    logRealtimeEvent("Sending sync_hello", {
      peerUserId,
      knownCount: entries.length,
    });
    await sendSyncMessage(peerUserId, PEER_MESSAGE_TYPE_SYNC_HELLO, {
      known_ids: entries.map((entry) => entry.id),
    });
  };

  const handleSyncHello = async (peerUserId, payload) => {
    if (!currentSnapshot) return;
    const knownIds = new Set(
      Array.isArray(payload?.known_ids) ? payload.known_ids : []
    );
    const myEntries = getLedgerEntriesForPeer(
      currentSnapshot.ledger,
      currentSnapshot.userId,
      peerUserId,
    );
    const missing = myEntries.filter((entry) => !knownIds.has(entry.id));
    logRealtimeEvent("Received sync_hello, replying with sync_data", {
      peerUserId,
      peerKnownCount: knownIds.size,
      sendingCount: missing.length,
    });
    await sendSyncMessage(peerUserId, PEER_MESSAGE_TYPE_SYNC_DATA, {
      entries: missing,
    });
  };

  const handleSyncData = async (peerUserId, payload) => {
    if (!currentSnapshot) return;
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    if (entries.length === 0) return;

    const myId = currentSnapshot.userId;
    const inboundLike = [];
    const outboundOnly = [];
    for (const entry of entries) {
      // Every synced entry must carry a valid Schnorr signature by its
      // claimed `from_user_id`. Without this check a peer could backfill
      // forged ledger history during recovery — AES-GCM on the envelope only
      // proves the sync *envelope* came from `peerUserId`, not that the
      // enclosed entries were authored by whoever they claim.
      const signatureValid = await verifyLedgerEntrySignature(entry);
      if (!signatureValid) {
        logRealtimeEvent("Rejected synced ledger entry with invalid signature", {
          peerUserId,
          entryId: entry?.id,
          entryFrom: entry?.from_user_id,
        });
        continue;
      }
      if (entry.to_user_id === myId) {
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

    logRealtimeEvent("Received sync_data", {
      peerUserId,
      total: entries.length,
      inboundLike: inboundLike.length,
      outboundOnly: outboundOnly.length,
    });

    for (const entry of inboundLike) {
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
    }
    if (outboundOnly.length > 0) {
      await addLedgerEntries(outboundOnly);
    }
    await syncRealtimeState();
  };

  const trySyncPendingPeers = () => {
    if (!serverQueueDrained) return;
    Array.from(pendingSyncPeers).forEach((peerId) => {
      if (!peerMesh.canSend(peerId)) return;
      if (syncedPeers.has(peerId)) {
        pendingSyncPeers.delete(peerId);
        return;
      }
      pendingSyncPeers.delete(peerId);
      void sendSyncHello(peerId);
    });
  };

  const peerMesh = createPeerMesh({
    getLocalUserId: () => currentSnapshot?.userId || "",
    sendSignal: (peerUserId, signal) => {
      signalingClient.sendPeerSignal(peerUserId, signal);
    },
    onPeerReady: (peerUserId) => {
      void updateLastSyncedAt(peerUserId);
      pendingSyncPeers.add(peerUserId);
      trySyncPendingPeers();
      void syncRealtimeState();
    },
    onPeerStatusChange: (connectedPeerIds) => {
      replaceConnectedPeerIds(connectedPeerIds);
    },
    onPeerMessage: ({ peerUserId, message }) => {
      void handlePeerMessage(peerUserId, message);
    },
  });

  const signalingClient = createSignalingClient({
    onPeerConnect: ({ peerUserId, initiator }) => {
      peerMesh.ensurePeer(peerUserId, { initiator });
    },
    onPeerDisconnect: ({ peerUserId }) => {
      logRealtimeEvent("Peer disconnected (server)", { peerUserId });
      peerMesh.closePeer(peerUserId);
    },
    onPeerSignal: ({ peerUserId, signal }) => {
      void peerMesh.handleSignal(peerUserId, signal);
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
      syncedPeers.clear();
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

    logRealtimeEvent(logTitle, {
      peerUserId,
    });
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
        logRealtimeEvent("Failed to wrap outgoing peer message", {
          messageId: message.id,
          error: String(error?.message || error),
        });
        continue;
      }

      if (directlyConnected) {
        peerMesh.sendPeerMessage(message.to_user_id, envelope);
        continue;
      }

      const queued = signalingClient.queuePeerEnvelopeOnServer(envelope);
      if (queued) {
        envelopesSentToServer.add(message.id);
        logRealtimeEvent("Queued peer envelope on server", {
          messageId: message.id,
          peerUserId: message.to_user_id,
        });
      }
    }
  };

  const syncRealtimeState = async () => {
    currentSnapshot = await getRealtimeSnapshot();
    if (!currentSnapshot) {
      signalingClient.setSession({ userId: "", peerIds: [] });
      peerMesh.closePeersNotInSet([]);
      replaceConnectedPeerIds([]);
      return;
    }

    signalingClient.setSession({
      userId: currentSnapshot.userId,
      peerIds: currentSnapshot.peerIds,
    });
    peerMesh.closePeersNotInSet(currentSnapshot.peerIds);

    currentSnapshot.peerIds.forEach((peerUserId) => {
      requestPeerConnectionIfNeeded(peerUserId);
    });
    await flushOutbox();
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

    logRealtimeEvent("Peer receipt received", { data: receiptMessage });
    peerMesh.clearInflightMessage(receivedMessageId);
    envelopesSentToServer.delete(receivedMessageId);
    await markPeerMessageReceived(receivedMessageId);
    await syncRealtimeState();
  };

  const sendReceiptForInnerMessage = async (innerMessage, acknowledgeResult, preferredPeerId) => {
    if (!acknowledgeResult || !currentSnapshot?.userId) {
      return;
    }

    const receipt = createPeerReceiptMessage({
      fromUserId: currentSnapshot.userId,
      toUserId: innerMessage.from_user_id,
      messageId: innerMessage.id,
      result: acknowledgeResult,
    });

    const targetPeerId = preferredPeerId || innerMessage.from_user_id;
    if (peerMesh.canSend(targetPeerId)) {
      peerMesh.sendControlMessage(targetPeerId, receipt);
      logRealtimeEvent("Sent peer receipt over WebRTC", {
        peerUserId: targetPeerId,
        data: receipt,
      });
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
      logRealtimeEvent(queued ? "Queued peer receipt on server" : "Receipt queue rejected", {
        peerUserId: targetPeerId,
        receiptId: receipt.id,
      });
    } catch (error) {
      logRealtimeEvent("Failed to wrap receipt for server delivery", {
        error: String(error?.message || error),
      });
    }
  };

  const processInnerPeerMessage = async (innerMessage, { receiptChannelPeerId } = {}) => {
    if (innerMessage.type === PEER_MESSAGE_TYPE_RECEIVED) {
      await handleReceiptMessage(innerMessage);
      return;
    }

    if (innerMessage.type === PEER_MESSAGE_TYPE_SYNC_HELLO) {
      await handleSyncHello(innerMessage.from_user_id, innerMessage.payload);
      return;
    }

    if (innerMessage.type === PEER_MESSAGE_TYPE_SYNC_DATA) {
      await handleSyncData(innerMessage.from_user_id, innerMessage.payload);
      return;
    }

    const processingResult = await applyInboundPeerMessage(innerMessage);
    await sendReceiptForInnerMessage(
      innerMessage,
      processingResult?.acknowledgeResult,
      receiptChannelPeerId,
    );
    await syncRealtimeState();
  };

  const handlePeerMessage = async (peerUserId, message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === PEER_MESSAGE_TYPE_PING) {
      logRealtimeEvent("Ping received", { peerUserId });
      peerMesh.sendControlMessage(peerUserId, {
        type: PEER_MESSAGE_TYPE_PONG,
        timestamp: message.timestamp,
      });
      return;
    }

    if (message.type === PEER_MESSAGE_TYPE_PONG) {
      const sentAt = message.timestamp;
      const roundTripMs = sentAt ? Date.now() - sentAt : null;
      logRealtimeEvent("Pong received", { peerUserId, roundTripMs });
      const resolve = pendingPings.get(peerUserId);
      if (resolve) {
        pendingPings.delete(peerUserId);
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
      logRealtimeEvent("Dropping non-envelope application message", {
        peerUserId,
        type: message.type,
      });
      return;
    }

    const innerMessage = await unwrapEnvelopeOrLog(message, peerUserId);
    if (!innerMessage) {
      return;
    }

    await processInnerPeerMessage(innerMessage, { receiptChannelPeerId: peerUserId });
  };

  const unwrapEnvelopeOrLog = async (envelope, sourcePeerId) => {
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
      logRealtimeEvent("Failed to unwrap peer envelope", {
        peerUserId: sourcePeerId,
        envelopeId: envelope?.id,
        error: String(error?.message || error),
      });
      return null;
    }
  };

  const handleServerDeliveredEnvelope = async (envelope) => {
    if (!isPeerEnvelope(envelope)) {
      return;
    }

    logRealtimeEvent("Peer envelope received from server", {
      envelopeId: envelope.id,
      from: envelope.from_user_id,
    });

    const innerMessage = await unwrapEnvelopeOrLog(envelope, envelope.from_user_id);
    if (!innerMessage) {
      return;
    }

    await processInnerPeerMessage(innerMessage, {
      receiptChannelPeerId: innerMessage.from_user_id,
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
      unsubscribe();
      peerMesh.destroy();
      signalingClient.destroy();
      delete window.ping;
    },
  };
};

export {
  createRealtimeClient,
};
