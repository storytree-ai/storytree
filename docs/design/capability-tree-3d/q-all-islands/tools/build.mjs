// Builds the mock's page from the real map's code: tools/page.tsx mounts the forest's own view (@storytree/forest/view's
// PlanetView, the one the desktop app mounts) on the snapshot in data.json, and tools/overlay.ts lays the mock on its island.
// One classic script and one stylesheet, so index.html opens from disk with no network. They go to the checkout's ignored
// .evidence-builds/ (page-folder.mjs), which the tools serve; --retake rewrites the committed page in this folder instead.
// Run from the checkout root: node docs/design/capability-tree-3d/q-all-islands/tools/build.mjs [--retake]
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { built } from './page-folder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), out = path.dirname(here);
const root = path.resolve(here, '../../../../..');
// The forest's own package holds the view and every dependency this page needs (react, three, the drawing engine).
const website = path.join(root, 'packages/forest');
const require = createRequire(path.join(website, 'package.json'));
const { build } = require('esbuild');
const retake = process.argv.includes('--retake'), to = retake ? out : built;
if (retake) rmSync(built, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
// Round 13: every arrangement in layouts/ (not its measures), for `?layout=<name>` (layouts.ts).
const names = readdirSync(path.join(out, 'layouts')).filter(f => f.endsWith('.json') && !f.endsWith('.measures.json')).map(f => f.slice(0, -5)).sort();
writeFileSync(path.join(here, 'layouts.gen.ts'), `// Written by build.mjs: every arrangement in layouts/.\n${names.map((n, i) => `import l${i} from "../layouts/${n}.json" with { type: "json" };`).join('\n')}\nexport const LAYOUTS = { ${names.map((n, i) => `${JSON.stringify(n)}: l${i}`).join(', ')} };\n`);
await build({
  absWorkingDir: website,
  entryPoints: { page: path.join(here, 'page.tsx') },
  outdir: to, bundle: true, minify: !process.argv.includes('--debug'), logLevel: 'warning', legalComments: 'none',
  platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
  // The mock's own layer reaches three.js where the drawing engine does, so both draw with one copy of it.
  // The app's frame reaches the forest by its own name, so its folder lends that one.
  nodePaths: [path.join(website, 'node_modules'), path.join(root, 'packages/forest-world/node_modules'), path.join(root, 'packages/app/node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  // The link layout reaches the map through its own territories module: every import of it (the map's and the mock's) is
  // pointed at territories-shim.ts, which re-exports it and lays The library's cells out by the links.
  plugins: [{ name: 'link-layout', setup(b) {
    b.onResolve({ filter: /territories\/territories\.js$/ }, (args) => args.importer.endsWith('territories-shim.ts') ? undefined : { path: path.join(here, 'territories-shim.ts') });
  } }],
  loader: { '.glb': 'binary', '.png': 'dataurl', '.webp': 'dataurl', '.woff2': 'dataurl' },
});
copyFileSync(path.join(here, 'index.template.html'), path.join(to, 'index.html'));
console.log(`Built index.html, page.js and page.css from the real map code into ${to}.`);
