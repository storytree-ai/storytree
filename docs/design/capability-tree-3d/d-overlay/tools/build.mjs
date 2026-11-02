// Builds the mock's page from the real map's code: tools/page.tsx mounts the forest's own view (@storytree/forest/view's
// PlanetView, the one the desktop app mounts) on the snapshot in data.json, and tools/overlay.ts lays the overlay lines on its island.
// One classic script and one stylesheet, so index.html opens from disk with no network.
// Run from the checkout root: node docs/design/capability-tree-3d/d-overlay/tools/build.mjs
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), out = path.dirname(here);
const root = path.resolve(here, '../../../../..');
// The website already mounts the forest's view on its own page, so its dependencies are the ones this page needs.
const website = path.join(root, 'packages/website');
const require = createRequire(path.join(website, 'package.json'));
const { build } = require('esbuild');
await build({
  absWorkingDir: website,
  entryPoints: { page: path.join(here, 'page.tsx') },
  outdir: out, bundle: true, minify: !process.argv.includes('--debug'), logLevel: 'warning', legalComments: 'none',
  platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
  // The mock's own layer reaches three.js where the drawing engine does, so both draw with one copy of it.
  nodePaths: [path.join(website, 'node_modules'), path.join(root, 'packages/forest-world/node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.glb': 'binary', '.png': 'dataurl', '.webp': 'dataurl', '.woff2': 'dataurl' },
});
copyFileSync(path.join(here, 'index.template.html'), path.join(out, 'index.html'));
console.log('Built index.html, page.js and page.css from the real map code.');
