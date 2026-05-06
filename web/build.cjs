const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const ctx = esbuild.context({
  entryPoints: ['entry.jsx'],
  bundle: true,
  outfile: 'dist/tally-teaching.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch,
  logLevel: 'info',
});

ctx.then(c => watch ? c.watch() : c.rebuild().then(() => c.dispose()));
