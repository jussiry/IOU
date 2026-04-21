/*
This module manages WebRTC peer connections and JSON data channels between
eligible IOU clients. It's used for two parallel overlays:

  1. Friend mesh — one peer per friend npub (the key is the peer user id).
  2. Self-mesh — one peer per *other device* of the same user (the key is
     the server-assigned peer device id; peerUserId is always my own npub).

Both overlays are instances of `createPeerMesh` with different `peerKey`
conventions. The mesh is agnostic to the key's meaning — it just maps a
key to an RTCPeerConnection + data channel, and every signalling message
carries both `peerUserId` and `peerDeviceId` so the server can route to
the exact remote device even when a user has several connected.

Offer/answer negotiation follows the "perfect negotiation" pattern: the
non-initiator side is treated as polite and yields during simultaneous
offer collisions (e.g. during an ICE restart). Because the signaling
server assigns exactly one initiator per connection — deterministically
picked from peer device ids — both sides always agree on who yields
without any extra coordination.
*/

const RTC_CONFIGURATION = {
  iceServers: [
    { urls: "stun:junction.proxy.rlwy.net:20947" },
    {
      urls: "turn:junction.proxy.rlwy.net:20947?transport=tcp",
      username: "iou",
      credential: "not-so-secret",
    },
  ],
};

const DATA_CHANNEL_LABEL = "iou-json";
const DISCONNECTED_PEER_GRACE_PERIOD_MS = 15000;
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

const createPeerMesh = (
  {
    // Returns the local key ("self identifier"), used only as a sanity
    // check so we never create a peer for our own key. For the friend mesh
    // this is our own user id; for the self-mesh it can stay empty — the
    // server already guarantees we never get a peer_connect for our own
    // device.
    getLocalKey = () => "",
    sendSignal = () => {},
    onPeerMessage = null,
    onPeerReady = null,
    onPeerStatusChange = null,
    // If true, remote-initiated peers are trusted on arrival and never
    // subject to the 15-second allowance timer. Used by the self-mesh:
    // same-user devices are always welcome and shouldn't be reaped.
    alwaysAllow = false,
  } = {}
) => {
  const resolveLocalKey = typeof getLocalKey === "function" ? getLocalKey : () => "";
  const peers = new Map();

  const getConnectedPeerKeys = () => {
    return Array.from(peers.values())
      .filter((peer) => peer?.channel?.readyState === "open")
      .map((peer) => peer.peerKey)
      .filter(Boolean);
  };

  const notifyPeerStatusChange = () => {
    if (typeof onPeerStatusChange === "function") {
      onPeerStatusChange(getConnectedPeerKeys());
    }
  };

  const notifyPeerReady = (peer) => {
    if (typeof onPeerReady === "function") {
      onPeerReady({
        peerKey: peer.peerKey,
        peerUserId: peer.peerUserId,
        peerDeviceId: peer.peerDeviceId,
      });
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
      if (!peers.has(peer.peerKey) || peer.allowedBySnapshot) {
        return;
      }

      closePeer(peer.peerKey, {
        reason: "remote_allowance_timeout",
      });
    }, REMOTE_INITIATED_PEER_GRACE_PERIOD_MS);
  };

  const closePeer = (peerKey, detail = {}) => {
    const peer = peers.get(peerKey);
    if (!peer) {
      return;
    }

    clearDisconnectTimer(peer);
    clearRemoteAllowanceTimer(peer);
    logPeerEvent("Peer connection disconnecting", {
      peerKey,
      peerUserId: peer.peerUserId,
      peerDeviceId: peer.peerDeviceId,
      ...detail,
    });
    peer.channel?.close();
    peer.connection?.close();
    peers.delete(peerKey);
    notifyPeerStatusChange();
  };

  const bindChannel = (peerKey, channel) => {
    const peer = peers.get(peerKey);
    if (!peer) {
      return;
    }

    peer.channel = channel;
    channel.addEventListener("open", () => {
      logPeerEvent("Peer connection established", {
        peerKey,
        peerUserId: peer.peerUserId,
        peerDeviceId: peer.peerDeviceId,
        channelLabel: channel.label,
      });
      notifyPeerStatusChange();
      notifyPeerReady(peer);
    });
    channel.addEventListener("close", () => {
      logPeerEvent("Peer connection disconnected", {
        peerKey,
        peerUserId: peer.peerUserId,
        channelLabel: channel.label,
      });
      peer.inflightMessageIds.clear();
      peer.channel = null;
      clearDisconnectTimer(peer);
      notifyPeerStatusChange();
      if (peers.get(peerKey) !== peer) {
        return;
      }

      closePeer(peerKey, {
        reason: "channel_closed",
      });
    });
    channel.addEventListener("message", (event) => {
      const message = safeParseJson(event.data);
      logPeerEvent("Peer data received", {
        peerKey,
        peerUserId: peer.peerUserId,
        data: message ?? event.data,
      });
      if (!message || typeof onPeerMessage !== "function") {
        return;
      }

      onPeerMessage({
        peerKey,
        peerUserId: peer.peerUserId,
        peerDeviceId: peer.peerDeviceId,
        message,
      });
    });
  };

  const dispatchSignal = (peer, signal) => {
    sendSignal(peer.peerKey, signal, {
      peerUserId: peer.peerUserId,
      peerDeviceId: peer.peerDeviceId,
    });
  };

  const ensurePeer = (peerKey, {
    initiator = false,
    peerUserId = "",
    peerDeviceId = "",
  } = {}) => {
    const normalizedPeerKey =
      typeof peerKey === "string" ? peerKey.trim() : "";
    if (!normalizedPeerKey || normalizedPeerKey === resolveLocalKey()) {
      return null;
    }

    if (peers.has(normalizedPeerKey)) {
      const existingPeer = peers.get(normalizedPeerKey);
      // Refresh metadata in case the remote device's id/user id arrived
      // in a later signal (e.g. the first peer_connect landed without it).
      if (peerUserId) existingPeer.peerUserId = peerUserId;
      if (peerDeviceId) existingPeer.peerDeviceId = peerDeviceId;
      const state = existingPeer.connection?.connectionState;
      if (state === "closed" || state === "failed") {
        logPeerEvent("Replacing stale peer connection", {
          peerKey: normalizedPeerKey,
          connectionState: state,
        });
        closePeer(normalizedPeerKey, { reason: "stale_replaced" });
      } else {
        return existingPeer;
      }
    }

    const connection = new RTCPeerConnection(RTC_CONFIGURATION);
    // Perfect negotiation: the non-initiator yields during offer collisions
    // (e.g. on ICE restart). The server deterministically picks exactly one
    // initiator per connection, so both sides always disagree on isPolite.
    const isPolite = !initiator;
    const peer = {
      peerKey: normalizedPeerKey,
      peerUserId: typeof peerUserId === "string" ? peerUserId : "",
      peerDeviceId: typeof peerDeviceId === "string" ? peerDeviceId : "",
      connection,
      channel: null,
      isPolite,
      inflightMessageIds: new Set(),
      pendingCandidates: [],
      makingOffer: false,
      disconnectTimer: null,
      remoteAllowanceTimer: null,
      allowedBySnapshot: initiator || alwaysAllow,
    };
    peers.set(normalizedPeerKey, peer);
    logPeerEvent("Establishing peer connection", {
      peerKey: normalizedPeerKey,
      peerUserId: peer.peerUserId,
      peerDeviceId: peer.peerDeviceId,
      initiator,
      isPolite,
    });

    if (!initiator && !alwaysAllow) {
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
          peerKey: normalizedPeerKey,
          description: connection.localDescription,
        });
        dispatchSignal(peer, {
          type: "description",
          description: connection.localDescription,
        });
      } catch (error) {
        logPeerEvent("Offer creation failed", {
          peerKey: normalizedPeerKey,
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

      dispatchSignal(peer, {
        type: "candidate",
        candidate: event.candidate,
      });
    });

    connection.addEventListener("connectionstatechange", () => {
      logPeerEvent("Peer connection state changed", {
        peerKey: normalizedPeerKey,
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
        logPeerEvent("Attempting ICE restart", { peerKey: normalizedPeerKey });
        try {
          connection.restartIce();
        } catch {
          // restartIce not available — fall through to close after timeout
        }

        peer.disconnectTimer = window.setTimeout(() => {
          peer.disconnectTimer = null;
          if (!peers.has(normalizedPeerKey)) {
            return;
          }
          if (
            connection.connectionState === "connected" ||
            connection.connectionState === "connecting"
          ) {
            return;
          }

          closePeer(normalizedPeerKey, {
            reason: "disconnected_timeout",
          });
        }, DISCONNECTED_PEER_GRACE_PERIOD_MS);
        return;
      }

      if (["failed", "closed"].includes(connection.connectionState)) {
        closePeer(normalizedPeerKey, {
          reason: connection.connectionState,
        });
      }
    });

    connection.addEventListener("datachannel", (event) => {
      bindChannel(normalizedPeerKey, event.channel);
    });

    if (initiator) {
      const channel = connection.createDataChannel(DATA_CHANNEL_LABEL);
      bindChannel(normalizedPeerKey, channel);
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
      logPeerEvent("Ignoring colliding offer (impolite peer)", { peerKey: peer.peerKey });
      return;
    }

    logPeerEvent("Received peer description", {
      peerKey: peer.peerKey,
      description,
    });
    await peer.connection.setRemoteDescription(description);

    if (description.type === "offer") {
      await peer.connection.setLocalDescription();
      logPeerEvent("Sending peer answer", {
        peerKey: peer.peerKey,
        description: peer.connection.localDescription,
      });
      dispatchSignal(peer, {
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
      peerKey: peer.peerKey,
      candidate,
    });
    if (!peer.connection.remoteDescription) {
      peer.pendingCandidates.push(candidate);
      return;
    }

    await peer.connection.addIceCandidate(candidate);
  };

  const normalizeKey = (value) =>
    typeof value === "string" ? value.trim() : "";

  return {
    ensurePeer,
    closePeer: (peerKey) => {
      const normalizedPeerKey = normalizeKey(peerKey);
      if (normalizedPeerKey) {
        closePeer(normalizedPeerKey, { reason: "server_disconnect" });
      }
    },
    hasPeer: (peerKey) => {
      const normalizedPeerKey = normalizeKey(peerKey);
      if (!normalizedPeerKey) {
        return false;
      }

      return peers.has(normalizedPeerKey);
    },
    handleSignal: async (peerKey, signal, context = {}) => {
      if (!signal || typeof signal !== "object") {
        return;
      }

      const peer = ensurePeer(peerKey, {
        initiator: false,
        peerUserId: context.peerUserId || "",
        peerDeviceId: context.peerDeviceId || "",
      });
      if (!peer) {
        return;
      }

      if (signal.type === "description") {
        await handleDescription(peer, signal.description);
      } else if (signal.type === "candidate") {
        await handleCandidate(peer, signal.candidate);
      }
    },
    canSend: (peerKey) => {
      const peer = peers.get(peerKey);
      return peer?.channel?.readyState === "open";
    },
    hasInflightMessage: (peerKey, messageId) => {
      const peer = peers.get(peerKey);
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
    sendPeerMessage: (peerKey, message) => {
      const peer = peers.get(peerKey);
      if (!peer?.channel || peer.channel.readyState !== "open") {
        return false;
      }

      logPeerEvent("Peer data sent", {
        peerKey,
        data: message,
      });
      peer.channel.send(JSON.stringify(message));
      if (message?.id) {
        peer.inflightMessageIds.add(message.id);
      }
      return true;
    },
    sendControlMessage: (peerKey, message) => {
      const peer = peers.get(peerKey);
      if (!peer?.channel || peer.channel.readyState !== "open") {
        return false;
      }

      logPeerEvent("Peer control data sent", {
        peerKey,
        data: message,
      });
      peer.channel.send(JSON.stringify(message));
      return true;
    },
    // Iterate currently-open peers. The self-mesh uses this to broadcast
    // fresh ledger entries to every other connected device in one pass.
    forEachConnectedPeer: (callback) => {
      peers.forEach((peer) => {
        if (peer?.channel?.readyState !== "open") return;
        callback({
          peerKey: peer.peerKey,
          peerUserId: peer.peerUserId,
          peerDeviceId: peer.peerDeviceId,
        });
      });
    },
    closePeersNotInSet: (allowedPeerKeys) => {
      const allowedIds = new Set(Array.isArray(allowedPeerKeys) ? allowedPeerKeys : []);
      Array.from(peers.entries()).forEach(([peerKey, peer]) => {
        peer.allowedBySnapshot = allowedIds.has(peerKey) || alwaysAllow;
        if (peer.allowedBySnapshot) {
          clearRemoteAllowanceTimer(peer);
          return;
        }

        if (peer.remoteAllowanceTimer) {
          return;
        }

        closePeer(peerKey);
      });
    },
    destroy: () => {
      Array.from(peers.keys()).forEach((peerKey) => {
        closePeer(peerKey);
      });
      notifyPeerStatusChange();
    },
  };
};

export {
  createPeerMesh,
};
