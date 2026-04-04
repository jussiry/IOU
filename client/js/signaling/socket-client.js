/*
This module owns the browser-side websocket signaling connection used by the IOU app for online presence and WebRTC signaling.

It keeps websocket lifecycle concerns isolated from the peer transport layer, so higher-level realtime code can focus on peer sessions and queued delivery instead of reconnect and JSON routing details.
*/

const RECONNECT_DELAY_MS = 2500;

const getSocketUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
};

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

const createSignalingClient = (
  {
    onPeerConnect = null,
    onPeerDisconnect = null,
    onPeerSignal = null,
  } = {}
) => {
  let socket = null;
  let reconnectTimer = null;
  let session = {
    userId: "",
    peerIds: [],
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }

    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const sendRegistration = () => {
    if (!session.userId) {
      return;
    }

    sendJson(socket, {
      type: "register",
      user_id: session.userId,
    });
    sendJson(socket, {
      type: "peer_candidates",
      peer_user_ids: session.peerIds,
    });
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) {
      return;
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  const handleMessage = (event) => {
    const payload = safeParseJson(event.data);
    if (!payload || typeof payload !== "object") {
      return;
    }

    if (payload.type === "peer_connect" && typeof onPeerConnect === "function") {
      onPeerConnect({
        peerUserId: payload.peer_user_id,
        initiator: payload.initiator === true,
      });
      return;
    }

    if (payload.type === "peer_disconnect" && typeof onPeerDisconnect === "function") {
      onPeerDisconnect({
        peerUserId: payload.peer_user_id,
      });
      return;
    }

    if (payload.type === "webrtc_signal" && typeof onPeerSignal === "function") {
      onPeerSignal({
        peerUserId: payload.peer_user_id,
        signal: payload.signal || null,
      });
    }
  };

  const connect = () => {
    socket = new WebSocket(getSocketUrl());

    socket.addEventListener("open", () => {
      clearReconnectTimer();
      sendRegistration();
    });

    socket.addEventListener("message", handleMessage);

    socket.addEventListener("close", () => {
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  };

  connect();

  return {
    setSession: ({ userId = "", peerIds = [] } = {}) => {
      session = {
        userId: typeof userId === "string" ? userId.trim() : "",
        peerIds: normalizePeerIds(peerIds),
      };

      if (socket?.readyState === WebSocket.OPEN) {
        sendRegistration();
      }
    },
    requestPeerConnection: (peerUserId) => {
      const normalizedPeerUserId =
        typeof peerUserId === "string" ? peerUserId.trim() : "";
      if (!normalizedPeerUserId) {
        return;
      }

      sendJson(socket, {
        type: "connect_peer",
        peer_user_id: normalizedPeerUserId,
      });
    },
    sendPeerSignal: (peerUserId, signal) => {
      const normalizedPeerUserId =
        typeof peerUserId === "string" ? peerUserId.trim() : "";
      if (!normalizedPeerUserId || !signal) {
        return;
      }

      sendJson(socket, {
        type: "webrtc_signal",
        peer_user_id: normalizedPeerUserId,
        signal,
      });
    },
    destroy: () => {
      clearReconnectTimer();
      socket?.close();
      socket = null;
    },
  };
};

export {
  createSignalingClient,
};
