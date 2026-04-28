/*
This module owns the backend websocket signaling server for the IOU app. It
keeps track of online devices, their eligible peer targets, and the signaling
messages needed to establish direct WebRTC sessions.

A single user may be connected from multiple devices at the same time. Every
websocket gets its own server-assigned `deviceId` (opaque to the client — it
just gets routed back in peer_connect / webrtc_signal payloads). Routing is
device-scoped so the right device's RTCPeerConnection gets the right ICE
candidate, even when two of the user's devices are negotiating in parallel.

The server intentionally limits itself to presence and offer/answer/ICE
routing. Once peers are connected, application data stays on the WebRTC data
channel and the websocket layer only needs to reconnect or re-initiate peer
setup when availability changes.

Cross-user peering uses the existing `peer_candidates` eligibility rule
(mutual opt-in). Same-user device pairs are *always* eligible — the user
naturally trusts their own other devices, and they sync ledger state over
WebRTC the same way peers do during recovery.
*/

const { WebSocket, WebSocketServer } = require("ws");
const { randomUUID } = require("crypto");

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
  // userId -> Set<client>. Multiple devices of the same user coexist here.
  const clientsByUserId = new Map();
  // deviceId -> client. Used to route webrtc_signal to a specific device when
  // a user has more than one online.
  const clientsByDeviceId = new Map();
  const envelopesByRecipient = new Map();

  const getUserClients = (userId) => {
    if (!userId) return [];
    const set = clientsByUserId.get(userId);
    if (!set) return [];
    return Array.from(set);
  };

  const addUserClient = (userId, client) => {
    if (!userId || !client) return;
    let set = clientsByUserId.get(userId);
    if (!set) {
      set = new Set();
      clientsByUserId.set(userId, set);
    }
    set.add(client);
  };

  const removeUserClient = (userId, client) => {
    if (!userId || !client) return;
    const set = clientsByUserId.get(userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) {
      clientsByUserId.delete(userId);
    }
  };

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

    // Deliver to every online device of the recipient. Each device's
    // processed_peer_message_ids dedupes the same envelope.id so the
    // overlap is harmless, and it keeps all devices in lock-step even
    // before they've opened a same-user WebRTC channel to each other.
    const recipientClients = getUserClients(recipientUserId);
    let deliveredToAny = false;
    recipientClients.forEach((recipientClient) => {
      const ok = sendJson(recipientClient.socket, {
        type: "peer_envelope",
        envelope,
      });
      if (ok) deliveredToAny = true;
    });

    if (!deliveredToAny) {
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

    clientsBySocket.forEach((otherClient) => {
      if (!otherClient || otherClient === client) {
        return;
      }

      if (areClientsEligiblePeers(client, otherClient)) {
        sendJson(otherClient.socket, {
          type: "peer_disconnect",
          peer_user_id: client.userId,
          peer_device_id: client.deviceId,
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
    if (client.deviceId) {
      clientsByDeviceId.delete(client.deviceId);
    }
    if (client.userId) {
      removeUserClient(client.userId, client);
    }
  };

  const areClientsEligiblePeers = (leftClient, rightClient) => {
    if (!leftClient?.userId || !rightClient?.userId) {
      return false;
    }

    // Same user, different devices: always eligible — a user's own devices
    // sync ledger state over WebRTC just like peers do.
    if (leftClient.userId === rightClient.userId) {
      return leftClient !== rightClient;
    }

    return (
      leftClient.peerIds.has(rightClient.userId) ||
      rightClient.peerIds.has(leftClient.userId)
    );
  };

  const getInitiatorClient = (leftClient, rightClient) => {
    // Same user: pick by device id so both sides agree deterministically.
    if (leftClient.userId === rightClient.userId) {
      return leftClient.deviceId < rightClient.deviceId ? leftClient : rightClient;
    }

    const leftWantsRight = leftClient.peerIds.has(rightClient.userId);
    const rightWantsLeft = rightClient.peerIds.has(leftClient.userId);

    if (leftWantsRight && !rightWantsLeft) {
      return leftClient;
    }
    if (rightWantsLeft && !leftWantsRight) {
      return rightClient;
    }

    // Tie-break by user id, then by device id for determinism when two
    // devices of the same friend both request each other simultaneously.
    if (leftClient.userId !== rightClient.userId) {
      return leftClient.userId < rightClient.userId ? leftClient : rightClient;
    }
    return leftClient.deviceId < rightClient.deviceId ? leftClient : rightClient;
  };

  const initiatePeerConnection = (leftClient, rightClient) => {
    if (!areClientsEligiblePeers(leftClient, rightClient)) {
      return;
    }

    const initiatorClient = getInitiatorClient(leftClient, rightClient);
    sendJson(leftClient.socket, {
      type: "peer_connect",
      peer_user_id: rightClient.userId,
      peer_device_id: rightClient.deviceId,
      initiator: leftClient === initiatorClient,
    });
    sendJson(rightClient.socket, {
      type: "peer_connect",
      peer_user_id: leftClient.userId,
      peer_device_id: leftClient.deviceId,
      initiator: rightClient === initiatorClient,
    });
  };

  const syncClientPeers = (sourceClient) => {
    if (!sourceClient?.userId) {
      return;
    }

    clientsBySocket.forEach((otherClient) => {
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

    // Unlike the single-device era, we no longer kick out existing clients
    // for the same user — the server now supports multiple devices per user
    // and same-user pairs get their own WebRTC mesh.
    if (client.userId && client.userId !== normalizedUserId) {
      removeUserClient(client.userId, client);
    }

    client.userId = normalizedUserId;
    addUserClient(normalizedUserId, client);
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

    // Trigger a peer_connect with every device of the requested user id.
    // In the common single-device-per-friend case this is exactly one client.
    getUserClients(normalizedPeerUserId).forEach((targetClient) => {
      initiatePeerConnection(client, targetClient);
    });
  };

  const handlePeerSignal = (client, peerUserId, peerDeviceId, signal) => {
    const normalizedPeerUserId =
      typeof peerUserId === "string" ? peerUserId.trim() : "";
    const normalizedPeerDeviceId =
      typeof peerDeviceId === "string" ? peerDeviceId.trim() : "";
    if (!client?.userId || !normalizedPeerUserId || !signal) {
      return;
    }

    // Prefer device-id routing so two devices of the same user get their
    // own ICE candidates. Fall back to user-id lookup for legacy clients.
    let targetClient = null;
    if (normalizedPeerDeviceId) {
      targetClient = clientsByDeviceId.get(normalizedPeerDeviceId) || null;
    }
    if (!targetClient) {
      const candidates = getUserClients(normalizedPeerUserId);
      targetClient = candidates.length === 1 ? candidates[0] : null;
    }
    if (!targetClient || !areClientsEligiblePeers(client, targetClient)) {
      return;
    }

    sendJson(targetClient.socket, {
      type: "webrtc_signal",
      peer_user_id: client.userId,
      peer_device_id: client.deviceId,
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
    const deviceId = randomUUID();
    const client = {
      socket,
      deviceId,
      userId: "",
      peerIds: new Set(),
    };
    clientsBySocket.set(socket, client);
    clientsByDeviceId.set(deviceId, client);

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
        handlePeerSignal(
          client,
          payload.peer_user_id,
          payload.peer_device_id,
          payload.signal
        );
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
