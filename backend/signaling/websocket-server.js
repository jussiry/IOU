/*
This module owns the backend websocket connection used by the IOU client during development. It attaches to the existing HTTP server through an upgrade handler and keeps websocket-specific concerns out of the main server bootstrap.

It only accepts websocket connections on a dedicated path and tracks their lifecycle. The server does not need to send explicit messages, because the connection itself acts as the development liveness signal.
*/

const { WebSocketServer } = require("ws");

const SIGNALING_PATH = "/ws";

const createSignalingServer = (server) => {
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname !== SIGNALING_PATH) {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
    });
  });

  return websocketServer;
};

module.exports = {
  createSignalingServer,
};
