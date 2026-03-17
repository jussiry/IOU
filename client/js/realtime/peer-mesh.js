/*
This module manages WebRTC peer connections and JSON data channels between eligible IOU clients.

It keeps peer session state, offer/answer exchange, and data-channel delivery concerns in one place so the higher-level realtime coordinator can focus on queued application messages, state sync, and UI-facing connection status.
*/

const RTC_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const DATA_CHANNEL_LABEL = "iou-json";

const safeParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

  const closePeer = (peerUserId) => {
    const peer = peers.get(peerUserId);
    if (!peer) {
      return;
    }

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
      notifyPeerStatusChange();
      notifyPeerReady(peerUserId);
    });
    channel.addEventListener("close", () => {
      peer.inflightMessageIds.clear();
      peer.channel = null;
      notifyPeerStatusChange();
    });
    channel.addEventListener("message", (event) => {
      const message = safeParseJson(event.data);
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
    };
    peers.set(normalizedPeerUserId, peer);

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
      if (["failed", "closed", "disconnected"].includes(connection.connectionState)) {
        closePeer(normalizedPeerUserId);
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

    peer.makingOffer = true;
    try {
      const offer = await peer.connection.createOffer();
      await peer.connection.setLocalDescription(offer);
      sendSignal(peer.peerUserId, {
        type: "description",
        description: peer.connection.localDescription,
      });
    } finally {
      peer.makingOffer = false;
    }
  };

  const handleDescription = async (peer, description) => {
    if (!peer || !description) {
      return;
    }

    await peer.connection.setRemoteDescription(description);

    if (description.type === "offer") {
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
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

    if (!peer.connection.remoteDescription) {
      peer.pendingCandidates.push(candidate);
      return;
    }

    await peer.connection.addIceCandidate(candidate);
  };

  return {
    ensurePeer,
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

      peer.channel.send(JSON.stringify(message));
      return true;
    },
    closePeersNotInSet: (allowedPeerIds) => {
      const allowedIds = new Set(Array.isArray(allowedPeerIds) ? allowedPeerIds : []);
      Array.from(peers.keys()).forEach((peerUserId) => {
        if (allowedIds.has(peerUserId)) {
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
