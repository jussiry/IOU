/**
 * add-categories.mjs — one-off migration that stamps an `@category <name>` tag
 * into the leading description comment of every source file under a root.
 *
 * Category is the visualiser's only classification signal, and it lives in the
 * file's own comment (written/maintained by the AI that wrote the file). This
 * script seeds those tags from a directory→category mapping plus a few
 * per-file overrides for the loose top-level files. It is idempotent: files
 * that already contain an `@category` are skipped.
 *
 * Usage:  node scripts/add-categories.mjs <root>   (default: ../app)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { walk } from '../src/analyser/scan.js';

const root = process.argv[2]
  || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

// Most specific directory prefix wins. Paths are relative to <root>, POSIX-style.
const DIR_MAP = [
  ['js/ui', 'ui'],
  ['js/peer', 'network'],
  ['js/signaling', 'network'],
  ['js/push', 'network'],
  ['js/notify', 'ui'],
  ['js/crypto', 'crypto'],
  ['js/utils', 'util'],
  ['js/commands', 'command'],
  ['js/models', 'data'],
  ['js/storage', 'data'],
  ['js/dev', 'util'],
  ['ui-modules', 'ui'],
];

const FILE_MAP = {
  'js/app.js': 'entry',
  'js/app-state.js': 'data',
  'js/ledger.ts': 'data',
  'js/state-utils.ts': 'util',
  'js/friends-helpers.js': 'util',
  'js/version.js': 'util',
  'sw.js': 'entry',
  'sw-crypto-entry.js': 'entry',
};

const DEFAULT = 'util';

function categoryFor(relPath) {
  if (FILE_MAP[relPath]) return FILE_MAP[relPath];
  for (const [prefix, cat] of DIR_MAP) {
    if (relPath === prefix || relPath.startsWith(prefix + '/')) return cat;
  }
  return DEFAULT;
}

/** Insert `@category <cat>` into the leading block comment, or prepend one. */
function stamp(src, cat) {
  if (/@category\b/.test(src)) return null; // already tagged

  const start = src.match(/^\s*\/\*/);
  if (start) {
    const idx = src.indexOf('*/');
    const before = src.slice(0, idx);
    const after = src.slice(idx);
    const sep2 = before.endsWith('\n') ? '' : '\n';
    return `${before}${sep2}@category ${cat}\n${after}`;
  }
  // No leading block comment (e.g. a barrel starting with //): prepend one.
  return `/*\n@category ${cat}\n*/\n${src}`;
}

let changed = 0;
let skipped = 0;
const counts = {};
for (const abs of walk(root)) {
  const rel = relative(root, abs).split(sep).join('/');
  const cat = categoryFor(rel);
  const src = readFileSync(abs, 'utf8');
  const out = stamp(src, cat);
  counts[cat] = (counts[cat] || 0) + 1;
  if (out === null) { skipped++; continue; }
  writeFileSync(abs, out);
  changed++;
}

console.log(`Tagged ${changed} file(s), skipped ${skipped} already-tagged.`);
console.log('Category distribution:', counts);
