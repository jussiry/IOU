#!/usr/bin/env node
/*
Client build pipeline — esbuild per-file transpile of every .ts / .js under
`app/js/**` and `app/ui-modules/**` into `app/dist/`, preserving the
source directory layout.

Why per-file (bundle: false):
  - Import paths stay clean: `import "./foo.js"` in source still resolves to
    `./foo.js` at runtime, so nothing in the codebase needs rewriting when a
    file moves from .js to .ts.
  - Lazy-loaded modules (dev seeds, vendor loaders) keep working because each
    source file still maps 1:1 to an output file the browser can fetch.
  - Vendor files (app/js/vendor/*.js) pass through untouched — esbuild
    emits them as-is since they contain no TS syntax.

Watch mode (--watch) is incremental: esbuild only reprocesses files whose
mtime changed. Cold builds touch everything once; after that it's
change-driven and fast enough to pair with nodemon's backend restarts.
*/

const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const CLIENT_DIR = path.join(ROOT, "app");
const OUT_DIR = path.join(CLIENT_DIR, "dist");

const WATCH = process.argv.includes("--watch");

/**
 * Recursively walks a directory and returns absolute paths of every file
 * matching the given extensions. Skips the dist output dir so we never feed
 * a previous build back into itself.
 */
const collectEntryPoints = (dir, extensions) => {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === OUT_DIR) continue;
      results.push(...collectEntryPoints(full, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        results.push(full);
      }
    }
  }
  return results;
};

const buildOptions = () => {
  const entryPoints = [
    ...collectEntryPoints(path.join(CLIENT_DIR, "js"), [".ts", ".js"]),
    ...collectEntryPoints(path.join(CLIENT_DIR, "ui-modules"), [".ts", ".js"]),
  ];

  return {
    entryPoints,
    outdir: OUT_DIR,
    outbase: CLIENT_DIR,
    bundle: false,
    format: "esm",
    target: "es2022",
    platform: "browser",
    sourcemap: "linked",
    logLevel: "info",
    // Ensure TS imports written as `./foo.js` continue to resolve after
    // transpilation — esbuild emits the extension verbatim by default with
    // bundle:false, so no rewriting is needed.
  };
};

const run = async () => {
  const options = buildOptions();

  // Clean the dist dir so a renamed or deleted source file does not leave a
  // stale output behind. Cheap — rm -rf of a build output.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  if (WATCH) {
    const ctx = await esbuild.context(options);
    await ctx.rebuild();
    await ctx.watch();
    console.log(`[build-client] watching ${options.entryPoints.length} files`);
    // Leave the process alive; esbuild's watcher runs in the background.
  } else {
    const result = await esbuild.build(options);
    if (result.errors && result.errors.length > 0) {
      process.exit(1);
    }
    console.log(`[build-client] built ${options.entryPoints.length} files → app/dist`);
  }
};

run().catch((error) => {
  console.error("[build-client] failed:", error);
  process.exit(1);
});
