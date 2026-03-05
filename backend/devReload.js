/*
This module encapsulates development-only live reload behavior for the IOU backend. It handles the SSE connection used by browsers, explicit reload trigger requests, and app entry injection for loading the client reload listener in dev mode.

The API is intentionally small: the server creates one reload controller and delegates relevant routes and shutdown handling to it. That keeps `server.js` focused on static file serving while this module owns all reload-specific state.
*/

const fsp = require("fs").promises;

const DEV_RELOAD_EVENTS_PATH = "/__dev/reload";
const DEV_RELOAD_TRIGGER_PATH = "/__dev/reload-trigger";
const DEV_APP_ENTRY_PATH = "/js/app.js";
const DEV_RELOAD_IMPORT_LINE = 'import "./reload.js";';

const createDevReload = ({ isDevServer, sendText }) => {
  const devReloadClients = new Set();

  const openDevReloadStream = (request, response) => {
    if (!isDevServer) {
      sendText(response, 404, "Not found.");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    });
    response.write(": connected\n\n");
    devReloadClients.add(response);

    request.on("close", () => {
      devReloadClients.delete(response);
    });
  };

  const broadcastDevReload = () => {
    devReloadClients.forEach((clientResponse) => {
      try {
        clientResponse.write("data: reload\n\n");
        clientResponse.end();
      } catch {
        // ignore client disconnects
      }
    });
    devReloadClients.clear();
  };

  const triggerDevReload = (response) => {
    if (!isDevServer) {
      sendText(response, 404, "Not found.");
      return;
    }

    broadcastDevReload();
    response.writeHead(204);
    response.end();
  };

  const handleDevReloadRoute = ({ method, pathname, request, response }) => {
    if (pathname === DEV_RELOAD_EVENTS_PATH) {
      if (method !== "GET") {
        response.setHeader("Allow", "GET");
        sendText(response, 405, "Method not allowed.");
        return true;
      }

      openDevReloadStream(request, response);
      return true;
    }

    if (pathname === DEV_RELOAD_TRIGGER_PATH) {
      if (!["GET", "POST"].includes(method)) {
        response.setHeader("Allow", "GET, POST");
        sendText(response, 405, "Method not allowed.");
        return true;
      }

      triggerDevReload(response);
      return true;
    }

    return false;
  };

  const sendDevAppEntry = async (request, response, filePath) => {
    try {
      const sourceCode = await fsp.readFile(filePath, "utf8");
      const outputCode = sourceCode.includes(DEV_RELOAD_IMPORT_LINE)
        ? sourceCode
        : `${sourceCode}\n${DEV_RELOAD_IMPORT_LINE}\n`;
      const outputBytes = Buffer.byteLength(outputCode);

      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": String(outputBytes),
        "Content-Type": "text/javascript; charset=utf-8",
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      response.end(outputCode);
    } catch {
      sendText(response, 404, "Not found.");
    }
  };

  const isDevAppEntryPath = (pathname) => isDevServer && pathname === DEV_APP_ENTRY_PATH;

  const bindShutdownSignals = (server) => {
    if (!isDevServer) return;

    let isStopping = false;
    const stopDevServer = () => {
      if (isStopping) return;
      isStopping = true;
      broadcastDevReload();
      server.close(() => {
        process.exit(0);
      });
      setTimeout(() => {
        process.exit(0);
      }, 250).unref();
    };

    process.on("SIGTERM", stopDevServer);
    process.on("SIGINT", stopDevServer);
  };

  return {
    bindShutdownSignals,
    handleDevReloadRoute,
    isDevAppEntryPath,
    sendDevAppEntry,
  };
};

module.exports = {
  createDevReload,
};
