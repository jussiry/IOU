/*
This module orchestrates websocket signaling, WebRTC peer sessions, and queued peer-message delivery for the IOU client.

It subscribes to persisted app-state changes so presence, friendship eligibility, and unsent messages stay in sync with the transport layer without requiring page-specific code to know about networking internals.
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

  const flushOutbox = () => {
    if (!currentSnapshot) {
      return;
    }

    currentSnapshot.outbox.forEach((message) => {
      if (!peerMesh.canSend(message.to_user_id)) {
        return;
      }

      if (peerMesh.hasInflightMessage(message.to_user_id, message.id)) {
        return;
      }

      peerMesh.sendPeerMessage(message.to_user_id, message);
    });
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
    flushOutbox();
  };

  const pendingPings = new Map();

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
      const receivedMessageId =
        typeof message.payload?.message_id === "string" ? message.payload.message_id.trim() : "";
      if (!receivedMessageId) {
        return;
      }

      logRealtimeEvent("Peer receipt received", {
        peerUserId,
        data: message,
      });
      peerMesh.clearInflightMessage(receivedMessageId);
      await markPeerMessageReceived(receivedMessageId);
      await syncRealtimeState();
      return;
    }

    const processingResult = await applyInboundPeerMessage(message);
    if (processingResult?.acknowledgeResult && currentSnapshot?.userId) {
      const receipt = createPeerReceiptMessage({
        fromUserId: currentSnapshot.userId,
        toUserId: peerUserId,
        messageId: message.id,
        result: processingResult.acknowledgeResult,
      });
      logRealtimeEvent("Sending peer receipt", {
        peerUserId,
        data: receipt,
      });
      peerMesh.sendControlMessage(peerUserId, receipt);
    }
    await syncRealtimeState();
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
