/**
 * scan.js — walks a project root and yields source files to analyse.
 *
 * Recursively descends directories, skipping build output, vendored code, VCS,
 * and dependency folders (these are noise in a dependency graph and often huge).
 * Yields absolute paths to `.js` / `.ts` / `.mjs` / `.cjs` files.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'vendor', '.git', 'build', 'coverage']);
const EXTS = new Set(['.js', '.ts', '.mjs', '.cjs']);

function ext(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i);
}

/** Generator over absolute file paths under `root`. */
export function* walk(root) {
  for (const entry of readdirSync(root)) {
    const abs = join(root, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walk(abs);
    } else if (EXTS.has(ext(entry)) && !entry.endsWith('.d.ts')) {
      yield abs;
    }
  }
}
