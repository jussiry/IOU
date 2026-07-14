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
 * The PORT env var wins over the CLI arg when set, so a launcher that assigns
 * a free port per session (autoPort) doesn't collide with a hardcoded arg —
 * lets multiple sessions each run their own instance instead of fighting over
 * one port.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const ROOT = join(fileURLToPath(import.meta.url), '..', '..'); // GraphEditor/
const PORT = Number(process.env.PORT) || Number(process.argv[2]) || 8088;

// The analysed codebase relative to GraphEditor/: `../<root>`, where <root> is
// the label the analyser wrote into graph.json (default "app").
async function analysedRoot() {
  for (const f of ['data/graph.json', 'data/graph.sample.json']) {
    try {
      const root = JSON.parse(await readFile(join(ROOT, f), 'utf8')).root;
      if (root) return join(ROOT, '..', root);
    } catch { /* try next */ }
  }
  return join(ROOT, '..', 'app');
}

// Files changed since the last commit (working tree + untracked), as paths
// relative to the analysed root — i.e. the same form as graph node ids. Runs
// `git status` in the analysed codebase; returns [] if it isn't a git repo.
async function gitModifiedFiles() {
  const dir = await analysedRoot();
  const [{ stdout: prefixOut }, { stdout: statusOut }] = await Promise.all([
    execFileP('git', ['-C', dir, 'rev-parse', '--show-prefix']),
    execFileP('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=all']),
  ]);
  const prefix = prefixOut.trim(); // repo-root → analysed-root, e.g. "app/"
  const files = [];
  for (const line of statusOut.split('\n')) {
    if (!line.trim()) continue;
    let p = line.slice(3); // strip the two-char status code + space
    if (p.includes(' -> ')) p = p.split(' -> ')[1]; // rename: take the new path
    p = p.replace(/^"|"$/g, ''); // git quotes paths containing special chars
    if (!prefix) files.push(p);
    else if (p.startsWith(prefix)) files.push(p.slice(prefix.length)); // drop others
  }
  return files;
}

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

  // API: the set of files modified since the last commit (git status). Always
  // 200 with JSON — an empty list on any failure so the app degrades quietly.
  if (path === '/api/git-modified') {
    let files = [];
    try { files = await gitModifiedFiles(); } catch { /* not a git repo / no git */ }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ files }));
    return;
  }

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
