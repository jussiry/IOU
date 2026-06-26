/**
 * imports.js — extracts dependency specifiers from a source file and resolves
 * the in-project (relative) ones to actual files.
 *
 * Handles static `import`/`export … from`, dynamic `import()`, and `require()`.
 * Only *relative* specifiers become edges — bare specifiers are external
 * packages and are ignored (the graph is about the project's own structure).
 *
 * Resolution mirrors how bundlers/TS behave here: the codebase imports with
 * `.js` extensions even when the real file is `.ts`, so we try a `.ts` sibling,
 * extensionless variants, and `index.*` directory entries, accepting only
 * targets that exist in the scanned file set.
 */

import { dirname, resolve } from 'node:path';

const PATTERNS = [
  /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g, // import … from '…' / import '…'
  /\bexport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g,       // export … from '…'
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,                  // dynamic import('…')
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,                 // require('…')
];

export function extractSpecifiers(src) {
  const out = new Set();
  for (const re of PATTERNS) {
    let m;
    while ((m = re.exec(src))) out.add(m[1]);
  }
  return [...out];
}

const EXTS = ['.js', '.ts', '.mjs', '.cjs'];

function candidates(base) {
  const list = [base];
  // .js/.mjs/.cjs import that actually points at a .ts source
  const swapped = base.replace(/\.(js|mjs|cjs)$/, '.ts');
  if (swapped !== base) list.push(swapped);
  // extensionless
  for (const e of EXTS) list.push(base + e);
  // directory index
  for (const e of EXTS) list.push(resolve(base, 'index' + e));
  return list;
}

/** Resolve a relative specifier to an absolute path in `knownSet`, or null. */
export function resolveImport(fromFile, spec, knownSet) {
  if (!spec.startsWith('.')) return null; // bare / external
  const base = resolve(dirname(fromFile), spec);
  for (const c of candidates(base)) {
    if (knownSet.has(c)) return c;
  }
  return null;
}
