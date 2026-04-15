/*
This module owns the backend websocket signaling server for the IOU app. It keeps track of online users, their eligible peer targets, and the signaling messages needed to establish direct WebRTC sessions.

The server intentionally limits itself to presence and offer/answer/ICE routing. Once peers are connected, application data stays on the WebRTC data channel and the websocket layer only needs to reconnect or re-initiate peer setup when availability changes.
*/

const { WebSocket, WebSocketServer } = require("ws");

const SIGNALING_PATH = "/ws";

const safeParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const sendJson = (socket, payload) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  socket.send(JSON.stringify(payload));
  return true;
};

const normalizePeerIds = (peerIds) => {
  if (!Array.isArray(peerIds)) {
    return [];
  }

  return Array.from(
    new Set(
      peerIds
        .map((peerId) => (typeof peerId === "string" ? peerId.trim() : ""))
        .filter(Boolean)
    )
  );
};

// The server stores opaque ciphertext envelopes for offline recipients so peers
// can hand off messages without waiting for both sides to be online at once.
// Envelopes are kept in memory only; on restart any undelivered messages are
// lost and the senders' client outboxes will eventually re-queue them.
const PER_RECIPIENT_ENVELOPE_LIMIT = 500;

const createSignalingServer = (server) => {
  const websocketServer = new WebSocketServer({ noServer: true });
  const clientsBySocket = new Map();
  const clientsByUserId = new Map();
  const envelopesByRecipient = new Map();

  const getStoredEnvelopes = (userId) => {
    const existing = envelopesByRecipient.get(userId);
    if (existing) return existing;
    const created = new Map();
    envelopesByRecipient.set(userId, created);
    return created;
  };

  const storeEnvelopeForRecipient = (recipientUserId, envelope) => {
    if (!recipientUserId || !envelope?.id) {
      return;
    }

    const stored = getStoredEnvelopes(recipientUserId);
    if (stored.has(envelope.id)) {
      return;
    }

    if (stored.size >= PER_RECIPIENT_ENVELOPE_LIMIT) {
      // Drop the oldest stored envelope to keep the per-recipient queue bounded.
      const oldestKey = stored.keys().next().value;
      if (oldestKey) {
        stored.delete(oldestKey);
      }
    }

    stored.set(envelope.id, envelope);
  };

  const flushStoredEnvelopes = (client) => {
    if (!client?.userId) {
      return;
    }

    const stored = envelopesByRecipient.get(client.userId);
    if (!stored || stored.size === 0) {
      return;
    }

    Array.from(stored.values()).forEach((envelope) => {
      const delivered = sendJson(client.socket, {
        type: "peer_envelope",
        envelope,
      });
      if (delivered) {
        stored.delete(envelope.id);
      }
    });

    if (stored.size === 0) {
      envelopesByRecipient.delete(client.userId);
    }
  };

  const handleQueuePeerEnvelope = (sendingClient, envelope) => {
    if (!sendingClient?.userId || !envelope || typeof envelope !== "object") {
      return;
    }

    const recipientUserId =
      typeof envelope.to_user_id === "string" ? envelope.to_user_id.trim() : "";
    if (!recipientUserId || recipientUserId === sendingClient.userId) {
      return;
    }
    if (!envelope.id || !envelope.from_user_id || !envelope.ciphertext) {
      return;
    }

    const recipientClient = clientsByUserId.get(recipientUserId);
    const delivered = recipientClient
      ? sendJson(recipientClient.socket, { type: "peer_envelope", envelope })
      : false;
    if (!delivered) {
      storeEnvelopeForRecipient(recipientUserId, envelope);
    }
  };

  const getClient = (socket) => {
    return clientsBySocket.get(socket) || null;
  };

  const notifyPeersOfDisconnect = (client) => {
    if (!client?.userId) {
      return;
    }

    clientsByUserId.forEach((otherClient) => {
      if (!otherClient || otherClient === client) {
        return;
      }

      if (areClientsEligiblePeers(client, otherClient)) {
        sendJson(otherClient.socket, {
          type: "peer_disconnect",
          peer_user_id: client.userId,
        });
      }
    });
  };

  const unregisterClient = (client) => {
    if (!client) {
      return;
    }

    notifyPeersOfDisconnect(client);
    clientsBySocket.delete(client.socket);
    if (client.userId && clientsByUserId.get(client.userId) === client) {
      clientsByUserId.delete(client.userId);
    }
  };

  const areClientsEligiblePeers = (leftClient, rightClient) => {
    if (!leftClient?.userId || !rightClient?.userId) {
      return false;
    }

    return (
      leftClient.peerIds.has(rightClient.userId) ||
      rightClient.peerIds.has(leftClient.userId)
    );
  };

  const getInitiatorUserId = (leftClient, rightClient) => {
    const leftWantsRight = leftClient.peerIds.has(rightClient.userId);
    const rightWantsLeft = rightClient.peerIds.has(leftClient.userId);

    if (leftWantsRight && !rightWantsLeft) {
      return leftClient.userId;
    }
    if (rightWantsLeft && !leftWantsRight) {
      return rightClient.userId;
    }

    return leftClient.userId < rightClient.userId
      ? leftClient.userId
      : rightClient.userId;
  };

  const initiatePeerConnection = (leftClient, rightClient) => {
    if (!areClientsEligiblePeers(leftClient, rightClient)) {
      return;
    }

    const initiatorUserId = getInitiatorUserId(leftClient, rightClient);
    sendJson(leftClient.socket, {
      type: "peer_connect",
      peer_user_id: rightClient.userId,
      initiator: leftClient.userId === initiatorUserId,
    });
    sendJson(rightClient.socket, {
      type: "peer_connect",
      peer_user_id: leftClient.userId,
      initiator: rightClient.userId === initiatorUserId,
    });
  };

  const syncClientPeers = (sourceClient) => {
    if (!sourceClient?.userId) {
      return;
    }

    clientsByUserId.forEach((otherClient) => {
      if (!otherClient || otherClient === sourceClient) {
        return;
      }

      initiatePeerConnection(sourceClient, otherClient);
    });
  };

  const registerClient = (client, userId) => {
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      return;
    }

    const previousClient = clientsByUserId.get(normalizedUserId);
    if (previousClient && previousClient !== client) {
      unregisterClient(previousClient);
      previousClient.socket.close();
    }

    if (client.userId && client.userId !== normalizedUserId) {
      clientsByUserId.delete(client.userId);
    }

    client.userId = normalizedUserId;
    clientsByUserId.set(normalizedUserId, client);
    flushStoredEnvelopes(client);
    sendJson(client.socket, { type: "queue_drained" });
    syncClientPeers(client);
  };

  const updatePeerCandidates = (client, peerIds) => {
    client.peerIds = new Set(normalizePeerIds(peerIds));
    syncClientPeers(client);
  };

  const handleConnectPeer = (client, peerUserId) => {
    const normalizedPeerUserId =
      typeof peerUserId === "string" ? peerUserId.trim() : "";
    if (!client?.userId || !normalizedPeerUserId) {
      return;
    }

    const targetClient = clientsByUserId.get(normalizedPeerUserId);
    if (!targetClient) {
      return;
    }

    initiatePeerConnection(client, targetClient);
  };

  const handlePeerSignal = (client, peerUserId, signal) => {
    const normalizedPeerUserId =
      typeof peerUserId === "string" ? peerUserId.trim() : "";
    if (!client?.userId || !normalizedPeerUserId || !signal) {
      return;
    }

    const targetClient = clientsByUserId.get(normalizedPeerUserId);
    if (!targetClient || !areClientsEligiblePeers(client, targetClient)) {
      return;
    }

    sendJson(targetClient.socket, {
      type: "webrtc_signal",
      peer_user_id: client.userId,
      signal,
    });
  };

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname !== SIGNALING_PATH) {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (clientSocket) => {
      websocketServer.emit("connection", clientSocket, request);
    });
  });

  websocketServer.on("connection", (socket) => {
    const client = {
      socket,
      userId: "",
      peerIds: new Set(),
    };
    clientsBySocket.set(socket, client);

    socket.on("message", (rawMessage) => {
      const payload = safeParseJson(rawMessage.toString());
      if (!payload || typeof payload !== "object") {
        return;
      }

      if (payload.type === "register") {
        registerClient(client, payload.user_id);
        return;
      }

      if (payload.type === "peer_candidates") {
        updatePeerCandidates(client, payload.peer_user_ids);
        return;
      }

      if (payload.type === "connect_peer") {
        handleConnectPeer(client, payload.peer_user_id);
        return;
      }

      if (payload.type === "webrtc_signal") {
        handlePeerSignal(client, payload.peer_user_id, payload.signal);
        return;
      }

      if (payload.type === "queue_peer_envelope") {
        handleQueuePeerEnvelope(client, payload.envelope);
      }
    });

    socket.on("close", () => {
      unregisterClient(client);
    });

    socket.on("error", () => {
      socket.close();
    });
  });

  return websocketServer;
};

module.exports = {
  createSignalingServer,
};
