/*
This module manages WebRTC peer connections and JSON data channels between eligible IOU clients.

It keeps peer session state, offer/answer exchange, and data-channel delivery concerns in one place so the higher-level realtime coordinator can focus on queued application messages, state sync, and UI-facing connection status.
*/

const RTC_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const DATA_CHANNEL_LABEL = "iou-json";
const DISCONNECTED_GRACE_PERIOD_MS = 5000;
const REMOTE_INITIATED_PEER_GRACE_PERIOD_MS = 15000;
const NEGOTIATION_ERROR_PATTERN =
  /have-remote-offer|setLocalDescription|ICE restart|ice-ufrag|ice-pwd|Cannot set local offer/i;

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

const isRecoverableNegotiationError = (error) => {
  const message = String(error?.message || error || "");
  return NEGOTIATION_ERROR_PATTERN.test(message);
};

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

  const recreatePeer = (peerUserId, detail = {}, options = {}) => {
    closePeer(peerUserId, detail);
    return ensurePeer(peerUserId, options);
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
      const existingPeer = peers.get(normalizedPeerUserId);
      if (initiator && !existingPeer.channel && !existingPeer.makingOffer) {
        if (existingPeer.connection?.signalingState !== "stable") {
          return recreatePeer(
            normalizedPeerUserId,
            {
              reason: "replace_unstable_peer_before_offer",
              signalingState: existingPeer.connection?.signalingState,
            },
            { initiator }
          );
        }
        void createOffer(existingPeer);
      }
      return existingPeer;
    }

    const connection = new RTCPeerConnection(RTC_CONFIGURATION);
    const peer = {
      peerUserId: normalizedPeerUserId,
      connection,
      channel: null,
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
    });

    if (!initiator) {
      scheduleRemoteAllowanceTimeout(peer);
    }

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

        peer.disconnectTimer = window.setTimeout(() => {
          peer.disconnectTimer = null;
          if (!peers.has(normalizedPeerUserId)) {
            return;
          }
          if (connection.connectionState !== "disconnected") {
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
      void createOffer(peer);
    }

    return peer;
  };

  const createOffer = async (peer) => {
    if (!peer || peer.makingOffer) {
      return;
    }
    if (peer.connection?.signalingState !== "stable") {
      return;
    }

    peer.makingOffer = true;
    try {
      const offer = await peer.connection.createOffer();
      if (peer.connection?.signalingState !== "stable") {
        return;
      }
      await peer.connection.setLocalDescription(offer);
      logPeerEvent("Sending peer offer", {
        peerUserId: peer.peerUserId,
        description: peer.connection.localDescription,
      });
      sendSignal(peer.peerUserId, {
        type: "description",
        description: peer.connection.localDescription,
      });
    } catch (error) {
      if (isRecoverableNegotiationError(error)) {
        logPeerEvent("Skipping peer offer after negotiation race", {
          peerUserId: peer.peerUserId,
          message: String(error?.message || error),
        });
        return;
      }

      throw error;
    } finally {
      peer.makingOffer = false;
    }
  };

  const handleDescription = async (peer, description) => {
    if (!peer || !description) {
      return;
    }

    logPeerEvent("Received peer description", {
      peerUserId: peer.peerUserId,
      description,
    });
    await peer.connection.setRemoteDescription(description);

    if (description.type === "offer") {
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
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

      let peer = ensurePeer(peerUserId, { initiator: false });
      if (!peer) {
        return;
      }

      if (signal.type === "description") {
        if (
          signal.description?.type === "offer" &&
          peer.connection?.signalingState !== "stable"
        ) {
          peer = recreatePeer(
            peerUserId,
            {
              reason: "replace_unstable_peer_before_remote_offer",
              signalingState: peer.connection?.signalingState,
            },
            { initiator: false }
          );
          if (!peer) {
            return;
          }
        }
        try {
          await handleDescription(peer, signal.description);
        } catch (error) {
          if (
            signal.description?.type === "offer" &&
            isRecoverableNegotiationError(error)
          ) {
            peer = recreatePeer(
              peerUserId,
              {
                reason: "recover_after_remote_description_error",
                message: String(error?.message || error),
              },
              { initiator: false }
            );
            if (!peer) {
              return;
            }
            await handleDescription(peer, signal.description);
            return;
          }

          throw error;
        }
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
