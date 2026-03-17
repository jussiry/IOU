/*
This module orchestrates websocket signaling, WebRTC peer sessions, and queued peer-message delivery for the IOU client.

It subscribes to persisted app-state changes so presence, friendship eligibility, and unsent messages stay in sync with the transport layer without requiring page-specific code to know about networking internals.
*/

import {
  applyInboundPeerMessage,
  getRealtimeSnapshot,
  markPeerMessageReceived,
  subscribeToDataChanges,
} from "../data.js";
import {
  createPeerReceiptMessage,
  PEER_MESSAGE_TYPE_RECEIVED,
} from "./peer-messages.js";
import { createSignalingClient } from "../signaling/socket-client.js";
import { createPeerMesh } from "./peer-mesh.js";
import { replaceConnectedPeerIds } from "./peer-status.js";

const createRealtimeClient = () => {
  let currentSnapshot = null;

  const peerMesh = createPeerMesh({
    getLocalUserId: () => currentSnapshot?.userId || "",
    sendSignal: (peerUserId, signal) => {
      signalingClient.sendPeerSignal(peerUserId, signal);
    },
    onPeerReady: () => {
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
    onPeerSignal: ({ peerUserId, signal }) => {
      void peerMesh.handleSignal(peerUserId, signal);
    },
  });

  const flushOutbox = () => {
    if (!currentSnapshot) {
      return;
    }

    currentSnapshot.outbox.forEach((message) => {
      if (!peerMesh.canSend(message.to_user_id)) {
        signalingClient.requestPeerConnection(message.to_user_id);
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
      signalingClient.requestPeerConnection(peerUserId);
    });
    flushOutbox();
  };

  const handlePeerMessage = async (peerUserId, message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === PEER_MESSAGE_TYPE_RECEIVED) {
      const receivedMessageId =
        typeof message.payload?.message_id === "string" ? message.payload.message_id.trim() : "";
      if (!receivedMessageId) {
        return;
      }

      peerMesh.clearInflightMessage(receivedMessageId);
      await markPeerMessageReceived(receivedMessageId);
      await syncRealtimeState();
      return;
    }

    if (currentSnapshot?.userId) {
      const receipt = createPeerReceiptMessage({
        fromUserId: currentSnapshot.userId,
        toUserId: peerUserId,
        messageId: message.id,
      });
      peerMesh.sendControlMessage(peerUserId, receipt);
    }

    await applyInboundPeerMessage(message);
    await syncRealtimeState();
  };

  const unsubscribe = subscribeToDataChanges(() => {
    void syncRealtimeState();
  });

  void syncRealtimeState();

  return {
    destroy: () => {
      replaceConnectedPeerIds([]);
      unsubscribe();
      peerMesh.destroy();
      signalingClient.destroy();
    },
  };
};

export {
  createRealtimeClient,
};
