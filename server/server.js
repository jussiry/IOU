/*
This backend module starts the IOU HTTP server and keeps the browser client and development websocket connection behind the same Node.js entry point. That lets the app serve static assets and expose a simple liveness channel without splitting runtime concerns across multiple processes.

The implementation keeps static file resolution explicit and safe against path traversal, while delegating websocket transport details to a focused signaling module. The main file stays responsible only for composing the server pieces together.
*/

const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const path = require("path");
const { createSignalingServer } = require("./signaling/websocket-server");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ROOT = path.resolve(__dirname, "..", "app");
const INDEX_FILE = path.join(CLIENT_ROOT, "index.html");
const WEB_ROOT = path.resolve(__dirname, "..", "web");
const WEB_PREFIX = "/web";
const WEB_DOMAINS = new Set(["tally.earth", "www.tally.earth"]);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const isInsideRoot = (rootPath, targetPath) => {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const tryResolvePath = (requestPath) => {
  try {
    const decodedPath = decodeURIComponent(requestPath);
    const resolvedPath = path.resolve(CLIENT_ROOT, `.${decodedPath}`);
    return isInsideRoot(CLIENT_ROOT, resolvedPath) ? resolvedPath : null;
  } catch {
    return null;
  }
};

const resolveFilePath = async (requestPath) => {
  const normalizedRequestPath = requestPath === "/" ? "/index.html" : requestPath;
  const initialPath = tryResolvePath(normalizedRequestPath);
  if (!initialPath) return null;

  try {
    const initialStats = await fsp.stat(initialPath);
    if (initialStats.isDirectory()) {
      const indexPath = path.join(initialPath, "index.html");
      const indexStats = await fsp.stat(indexPath);
      return indexStats.isFile() ? indexPath : null;
    }

    if (initialStats.isFile()) {
      return initialPath;
    }
  } catch {
    if (!path.extname(normalizedRequestPath)) {
      return INDEX_FILE;
    }
    return null;
  }

  return null;
};

const getContentType = (filePath) => MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";

const sendText = (response, statusCode, message) => {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
};

const sendFile = async (request, response, filePath) => {
  try {
    const fileStats = await fsp.stat(filePath);
    const headers = {
      "Cache-Control": "no-cache",
      "Content-Length": String(fileStats.size),
      "Content-Type": getContentType(filePath),
    };

    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const readStream = fs.createReadStream(filePath);
    readStream.on("error", () => {
      if (!response.headersSent) {
        sendText(response, 500, "Unable to read file.");
        return;
      }

      response.destroy();
    });
    readStream.pipe(response);
  } catch {
    sendText(response, 404, "Not found.");
  }
};

const resolveWebFilePath = async (requestPath) => {
  const normalizedPath = requestPath === "/" || requestPath === "" ? "/index.html" : requestPath;
  try {
    const decoded = decodeURIComponent(normalizedPath);
    const resolved = path.resolve(WEB_ROOT, `.${decoded}`);
    if (!isInsideRoot(WEB_ROOT, resolved)) return null;
    const stats = await fsp.stat(resolved);
    if (stats.isDirectory()) {
      const indexPath = path.join(resolved, "index.html");
      const indexStats = await fsp.stat(indexPath);
      return indexStats.isFile() ? indexPath : null;
    }
    return stats.isFile() ? resolved : null;
  } catch {
    return null;
  }
};

const server = http.createServer(async (request, response) => {
  const method = request.method || "GET";
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (!["GET", "HEAD"].includes(method)) {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method not allowed.");
    return;
  }

  // Serve landing page for tally.earth domain or /web/ path prefix
  const hostname = (request.headers.host || "").split(":")[0].toLowerCase();
  const isWebDomain = WEB_DOMAINS.has(hostname);
  const isWebPrefix = requestUrl.pathname === WEB_PREFIX || requestUrl.pathname.startsWith(WEB_PREFIX + "/");

  if (isWebDomain || isWebPrefix) {
    const webPath = isWebPrefix
      ? requestUrl.pathname.slice(WEB_PREFIX.length) || "/"
      : requestUrl.pathname;
    const webFilePath = await resolveWebFilePath(webPath);
    if (!webFilePath) {
      sendText(response, 404, "Not found.");
      return;
    }
    await sendFile(request, response, webFilePath);
    return;
  }

  const filePath = await resolveFilePath(requestUrl.pathname);
  if (!filePath) {
    sendText(response, 404, "Not found.");
    return;
  }

  await sendFile(request, response, filePath);
});

createSignalingServer(server);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`IOU backend server listening on http://${HOST}:${PORT}`);
});
