// Builds the hedgerow mock's page into this folder's parent: index.html, mock.js and mock.css, which open from disk with
// no network. The bundle is the real map's own code (forest's PlanetView and everything it draws with, from packages/forest,
// packages/forest-world and packages/knowledge-core, imported, never copied) plus hedgerow.ts and mock.tsx, with data.json inlined.
// Run from anywhere: node docs/design/capability-tree-3d/c-hedgerow/tools/build.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..');
const root = path.resolve(here, '../../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
await build({
  entryPoints: [path.join(here, 'mock.tsx')], outfile: path.join(out, 'mock.js'), bundle: true, minify: !process.env.DEBUG, sourcemap: process.env.DEBUG ? 'inline' : false, logLevel: 'warning',
  platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic', loader: { '.glb': 'binary' },
  // The packages resolve as the desktop app resolves them; React and three as the forest package does, so there is one copy of each.
  nodePaths: [path.join(root, 'apps/desktop/node_modules'), path.join(root, 'packages/forest/node_modules'), path.join(root, 'packages/forest-world/node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none',
});
writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The library · hedgerow mock</title><link rel="stylesheet" href="mock.css"></head>
<body data-state="loading"><div id="root"></div><script src="mock.js"></script></body></html>
`);
console.log('Built the hedgerow mock: index.html, mock.js, mock.css');
