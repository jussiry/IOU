/*
This module owns the browser-side websocket connection used for development reloads in the IOU app. It watches the backend connection state and reloads the page after the server disappears and becomes reachable again.

The reconnect loop is intentionally small and self-contained. The websocket close event signals that the backend restarted, and a successful reconnect is treated as the point where reloading the browser is safe.
*/

const RECONNECT_DELAY_MS = 5000;
const isDevServer = window.location.hostname === 'localhost'

const getSocketUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
};

const createSignalingClient = () => {
  let isWaitingForReconnect = false;
  let reconnectTimer = null;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
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

  const connect = () => {
    const socket = new WebSocket(getSocketUrl());
    window.socket = socket
    socket.addEventListener("open", () => {
      clearReconnectTimer();
      if (isWaitingForReconnect && isDevServer) {
        window.location.reload();
      }
    });

    socket.addEventListener("close", () => {
      isWaitingForReconnect = true;
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  };

  connect();
};

export {
  createSignalingClient,
};
