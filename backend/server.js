/*
This backend module starts a local Node.js server for the IOU app. It serves the browser client as static files from the `/client` folder so development and deployment can use the same entry point.

The implementation keeps static file resolution explicit and safe against path traversal. It also falls back to `index.html` for extensionless routes so the client can be loaded reliably before route handling takes over.
*/

const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const path = require("path");
const { createDevReload } = require("./devReload");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ROOT = path.resolve(__dirname, "..", "client");
const INDEX_FILE = path.join(CLIENT_ROOT, "index.html");
const IS_DEV_SERVER = process.env.IOU_DEV_SERVER === "1";

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

const devReload = createDevReload({ isDevServer: IS_DEV_SERVER, sendText });

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

const server = http.createServer(async (request, response) => {
  const method = request.method || "GET";
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (devReload.handleDevReloadRoute({ method, pathname: requestUrl.pathname, request, response })) {
    return;
  }

  if (!["GET", "HEAD"].includes(method)) {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method not allowed.");
    return;
  }

  const filePath = await resolveFilePath(requestUrl.pathname);
  if (!filePath) {
    sendText(response, 404, "Not found.");
    return;
  }

  if (devReload.isDevAppEntryPath(requestUrl.pathname)) {
    await devReload.sendDevAppEntry(request, response, filePath);
    return;
  }

  await sendFile(request, response, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`IOU backend server listening on http://${HOST}:${PORT}`);
});
devReload.bindShutdownSignals(server);
