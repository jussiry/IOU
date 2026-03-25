/*
This module manages WebRTC peer connections and JSON data channels between eligible IOU clients.

It keeps peer session state, offer/answer exchange, and data-channel delivery concerns in one place so the higher-level realtime coordinator can focus on queued application messages, state sync, and UI-facing connection status.

Offer/answer negotiation follows the "perfect negotiation" pattern: peers are assigned polite or impolite roles by comparing user IDs so both sides independently agree on who yields during simultaneous offer collisions.
*/

const RTC_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const DATA_CHANNEL_LABEL = "iou-json";
const DISCONNECTED_GRACE_PERIOD_MS = 15000;
const REMOTE_INITIATED_PEER_GRACE_PERIOD_MS = 15000;

const safeParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const logPeerEvent = (title, detail) => {
  if (typeof detail === "undefined") {
    console.log(`[WebRTC] ${title}`);
    return;
  }

  console.log(`[WebRTC] ${title}`, detail);
};

// The polite peer yields during offer collisions by accepting implicit rollback.
// Determined by comparing user IDs so both sides always agree on roles.
const isPoliteRole = (localUserId, peerUserId) => localUserId < peerUserId;

const createPeerMesh = (
  {
    getLocalUserId = () => "",
    sendSignal = () => {},
    onPeerMessage = null,
    onPeerReady = null,
    onPeerStatusChange = null,
  } = {}
) => {
  const peers = new Map();

  const getConnectedPeerIds = () => {
    return Array.from(peers.values())
      .filter((peer) => peer?.channel?.readyState === "open")
      .map((peer) => peer.peerUserId)
      .filter(Boolean);
  };

  const notifyPeerStatusChange = () => {
    if (typeof onPeerStatusChange === "function") {
      onPeerStatusChange(getConnectedPeerIds());
    }
  };

  const notifyPeerReady = (peerUserId) => {
    if (typeof onPeerReady === "function") {
      onPeerReady(peerUserId);
    }
  };

  const clearDisconnectTimer = (peer) => {
    if (!peer?.disconnectTimer) {
      return;
    }

    window.clearTimeout(peer.disconnectTimer);
    peer.disconnectTimer = null;
  };

  const clearRemoteAllowanceTimer = (peer) => {
    if (!peer?.remoteAllowanceTimer) {
      return;
    }

    window.clearTimeout(peer.remoteAllowanceTimer);
    peer.remoteAllowanceTimer = null;
  };

  const scheduleRemoteAllowanceTimeout = (peer) => {
    if (!peer || peer.allowedBySnapshot || peer.remoteAllowanceTimer) {
      return;
    }

    peer.remoteAllowanceTimer = window.setTimeout(() => {
      peer.remoteAllowanceTimer = null;
      if (!peers.has(peer.peerUserId) || peer.allowedBySnapshot) {
        return;
      }

      closePeer(peer.peerUserId, {
        reason: "remote_allowance_timeout",
      });
    }, REMOTE_INITIATED_PEER_GRACE_PERIOD_MS);
  };

  const closePeer = (peerUserId, detail = {}) => {
    const peer = peers.get(peerUserId);
    if (!peer) {
      return;
    }

    clearDisconnectTimer(peer);
    clearRemoteAllowanceTimer(peer);
    logPeerEvent("Peer connection disconnecting", {
      peerUserId,
      ...detail,
    });
    peer.channel?.close();
    peer.connection?.close();
    peers.delete(peerUserId);
    notifyPeerStatusChange();
  };

  const bindChannel = (peerUserId, channel) => {
    const peer = peers.get(peerUserId);
    if (!peer) {
      return;
    }

    peer.channel = channel;
    channel.addEventListener("open", () => {
      logPeerEvent("Peer connection established", {
        peerUserId,
        channelLabel: channel.label,
      });
      notifyPeerStatusChange();
      notifyPeerReady(peerUserId);
    });
    channel.addEventListener("close", () => {
      logPeerEvent("Peer connection disconnected", {
        peerUserId,
        channelLabel: channel.label,
      });
      peer.inflightMessageIds.clear();
      peer.channel = null;
      clearDisconnectTimer(peer);
      notifyPeerStatusChange();
      if (peers.get(peerUserId) !== peer) {
        return;
      }

      closePeer(peerUserId, {
        reason: "channel_closed",
      });
    });
    channel.addEventListener("message", (event) => {
      const message = safeParseJson(event.data);
      logPeerEvent("Peer data received", {
        peerUserId,
        data: message ?? event.data,
      });
      if (!message || typeof onPeerMessage !== "function") {
        return;
      }

      onPeerMessage({
        peerUserId,
        message,
      });
    });
  };

  const ensurePeer = (peerUserId, { initiator = false } = {}) => {
    const normalizedPeerUserId =
      typeof peerUserId === "string" ? peerUserId.trim() : "";
    if (!normalizedPeerUserId || normalizedPeerUserId === getLocalUserId()) {
      return null;
    }

    if (peers.has(normalizedPeerUserId)) {
      return peers.get(normalizedPeerUserId);
    }

    const connection = new RTCPeerConnection(RTC_CONFIGURATION);
    const isPolite = isPoliteRole(getLocalUserId(), normalizedPeerUserId);
    const peer = {
      peerUserId: normalizedPeerUserId,
      connection,
      channel: null,
      isPolite,
      inflightMessageIds: new Set(),
      pendingCandidates: [],
      makingOffer: false,
      disconnectTimer: null,
      remoteAllowanceTimer: null,
      allowedBySnapshot: initiator,
    };
    peers.set(normalizedPeerUserId, peer);
    logPeerEvent("Establishing peer connection", {
      peerUserId: normalizedPeerUserId,
      initiator,
      isPolite,
    });

    if (!initiator) {
      scheduleRemoteAllowanceTimeout(peer);
    }

    // Perfect negotiation: onnegotiationneeded handles both initial offers and
    // ICE restarts. setLocalDescription() with no args creates offer or answer
    // as appropriate for the current signaling state.
    connection.addEventListener("negotiationneeded", async () => {
      try {
        peer.makingOffer = true;
        await connection.setLocalDescription();
        logPeerEvent("Sending peer offer", {
          peerUserId: normalizedPeerUserId,
          description: connection.localDescription,
        });
        sendSignal(normalizedPeerUserId, {
          type: "description",
          description: connection.localDescription,
        });
      } catch (error) {
        logPeerEvent("Offer creation failed", {
          peerUserId: normalizedPeerUserId,
          error: String(error?.message || error),
        });
      } finally {
        peer.makingOffer = false;
      }
    });

    connection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) {
        return;
      }

      sendSignal(normalizedPeerUserId, {
        type: "candidate",
        candidate: event.candidate,
      });
    });

    connection.addEventListener("connectionstatechange", () => {
      logPeerEvent("Peer connection state changed", {
        peerUserId: normalizedPeerUserId,
        connectionState: connection.connectionState,
      });

      if (
        connection.connectionState === "connecting" ||
        connection.connectionState === "connected"
      ) {
        clearDisconnectTimer(peer);
        return;
      }

      if (connection.connectionState === "disconnected") {
        if (peer.disconnectTimer) {
          return;
        }

        // Attempt ICE restart before giving up. restartIce() fires
        // negotiationneeded which sends a new offer with fresh ICE credentials.
        logPeerEvent("Attempting ICE restart", { peerUserId: normalizedPeerUserId });
        try {
          connection.restartIce();
        } catch {
          // restartIce not available — fall through to close after timeout
        }

        peer.disconnectTimer = window.setTimeout(() => {
          peer.disconnectTimer = null;
          if (!peers.has(normalizedPeerUserId)) {
            return;
          }
          if (
            connection.connectionState === "connected" ||
            connection.connectionState === "connecting"
          ) {
            return;
          }

          closePeer(normalizedPeerUserId, {
            reason: "disconnected_timeout",
          });
        }, DISCONNECTED_GRACE_PERIOD_MS);
        return;
      }

      if (["failed", "closed"].includes(connection.connectionState)) {
        closePeer(normalizedPeerUserId, {
          reason: connection.connectionState,
        });
      }
    });

    connection.addEventListener("datachannel", (event) => {
      bindChannel(normalizedPeerUserId, event.channel);
    });

    if (initiator) {
      const channel = connection.createDataChannel(DATA_CHANNEL_LABEL);
      bindChannel(normalizedPeerUserId, channel);
      // createDataChannel triggers negotiationneeded, which sends the initial offer
    }

    return peer;
  };

  const handleDescription = async (peer, description) => {
    if (!peer || !description) {
      return;
    }

    // Perfect negotiation: detect a collision where both sides are trying to offer
    // simultaneously. The impolite peer ignores the incoming offer and keeps its own.
    // The polite peer proceeds — setRemoteDescription implicitly rolls back its
    // in-progress offer so the remote offer can be accepted.
    const offerCollision =
      description.type === "offer" &&
      (peer.makingOffer || peer.connection.signalingState !== "stable");

    if (offerCollision && !peer.isPolite) {
      logPeerEvent("Ignoring colliding offer (impolite peer)", { peerUserId: peer.peerUserId });
      return;
    }

    logPeerEvent("Received peer description", {
      peerUserId: peer.peerUserId,
      description,
    });
    await peer.connection.setRemoteDescription(description);

    if (description.type === "offer") {
      await peer.connection.setLocalDescription();
      logPeerEvent("Sending peer answer", {
        peerUserId: peer.peerUserId,
        description: peer.connection.localDescription,
      });
      sendSignal(peer.peerUserId, {
        type: "description",
        description: peer.connection.localDescription,
      });
    }

    while (peer.pendingCandidates.length) {
      const candidate = peer.pendingCandidates.shift();
      if (!candidate) continue;
      await peer.connection.addIceCandidate(candidate);
    }
  };

  const handleCandidate = async (peer, candidate) => {
    if (!peer || !candidate) {
      return;
    }

    logPeerEvent("Received peer ICE candidate", {
      peerUserId: peer.peerUserId,
      candidate,
    });
    if (!peer.connection.remoteDescription) {
      peer.pendingCandidates.push(candidate);
      return;
    }

    await peer.connection.addIceCandidate(candidate);
  };

  return {
    ensurePeer,
    hasPeer: (peerUserId) => {
      const normalizedPeerUserId =
        typeof peerUserId === "string" ? peerUserId.trim() : "";
      if (!normalizedPeerUserId) {
        return false;
      }

      return peers.has(normalizedPeerUserId);
    },
    handleSignal: async (peerUserId, signal) => {
      if (!signal || typeof signal !== "object") {
        return;
      }

      const peer = ensurePeer(peerUserId, { initiator: false });
      if (!peer) {
        return;
      }

      if (signal.type === "description") {
        await handleDescription(peer, signal.description);
      } else if (signal.type === "candidate") {
        await handleCandidate(peer, signal.candidate);
      }
    },
    canSend: (peerUserId) => {
      const peer = peers.get(peerUserId);
      return peer?.channel?.readyState === "open";
    },
    hasInflightMessage: (peerUserId, messageId) => {
      const peer = peers.get(peerUserId);
      if (!peer) {
        return false;
      }

      return peer.inflightMessageIds.has(messageId);
    },
    clearInflightMessage: (messageId) => {
      peers.forEach((peer) => {
        peer.inflightMessageIds.delete(messageId);
      });
    },
    sendPeerMessage: (peerUserId, message) => {
      const peer = peers.get(peerUserId);
      if (!peer?.channel || peer.channel.readyState !== "open") {
        return false;
      }

      logPeerEvent("Peer data sent", {
        peerUserId,
        data: message,
      });
      peer.channel.send(JSON.stringify(message));
      if (message?.id) {
        peer.inflightMessageIds.add(message.id);
      }
      return true;
    },
    sendControlMessage: (peerUserId, message) => {
      const peer = peers.get(peerUserId);
      if (!peer?.channel || peer.channel.readyState !== "open") {
        return false;
      }

      logPeerEvent("Peer control data sent", {
        peerUserId,
        data: message,
      });
      peer.channel.send(JSON.stringify(message));
      return true;
    },
    closePeersNotInSet: (allowedPeerIds) => {
      const allowedIds = new Set(Array.isArray(allowedPeerIds) ? allowedPeerIds : []);
      Array.from(peers.entries()).forEach(([peerUserId, peer]) => {
        peer.allowedBySnapshot = allowedIds.has(peerUserId);
        if (peer.allowedBySnapshot) {
          clearRemoteAllowanceTimer(peer);
          return;
        }

        if (peer.remoteAllowanceTimer) {
          return;
        }

        closePeer(peerUserId);
      });
    },
    destroy: () => {
      Array.from(peers.keys()).forEach((peerUserId) => {
        closePeer(peerUserId);
      });
      notifyPeerStatusChange();
    },
  };
};

export {
  createPeerMesh,
};
