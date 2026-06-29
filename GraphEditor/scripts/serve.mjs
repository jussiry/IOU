/**
 * serve.mjs — a minimal static file server for local development.
 *
 * Identical in spirit to `python -m http.server`, but sends `Cache-Control:
 * no-store` on every response so the browser always re-fetches edited ES
 * modules. Without this, browsers heuristically cache modules and keep running
 * stale code after edits (a reload won't pick up changes), which is maddening
 * during iterative UI work.
 *
 * Usage: node scripts/serve.mjs [port]   (default 8088, serves the repo root)
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..'); // GraphEditor/
const PORT = Number(process.argv[2]) || 8088;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  // Strip query string, prevent path traversal, default to index.html.
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path.endsWith('/')) path += 'index.html';
  const abs = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));

  try {
    const body = await readFile(abs);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(abs)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}).listen(PORT, () => console.log(`GraphEditor dev server → http://localhost:${PORT}/`));
