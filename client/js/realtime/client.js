/*
This module orchestrates websocket signaling, WebRTC peer sessions, and queued peer-message delivery for the IOU client.

It subscribes to persisted app-state changes so presence, friendship eligibility, and unsent messages stay in sync with the transport layer without requiring page-specific code to know about networking internals.

Application-level peer messages travel inside encrypted envelopes wrapped here so the WebRTC channel and the signaling server's fallback queue see only ciphertext. Transport-only messages (ping/pong/receipts) keep flowing as plaintext over the data channel — they are local to a live WebRTC session and never need to be forwarded by the server.
*/

import {
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
} from "./peer-messages.js";
import {
  isPeerEnvelope,
  unwrapPeerEnvelope,
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

  const peerMesh = createPeerMesh({
    getLocalUserId: () => currentSnapshot?.userId || "",
    sendSignal: (peerUserId, signal) => {
      signalingClient.sendPeerSignal(peerUserId, signal);
    },
    onPeerReady: (peerUserId) => {
      void updateLastSyncedAt(peerUserId);
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
      void syncRealtimeState();
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
