// Builds the mock page into this folder from the real scene code: esbuild bundles the desktop app's own renderer
// (apps/desktop/src/renderer/renderer.ts, which draws the map's islands with packages/forest and packages/forest-world)
// behind boot.ts's stand-in bridge, with timber.ts's fences, gates, pathways and wrenches on top. Nothing is copied.
// Run from anywhere: node docs/design/capability-tree-3d/b-timber/tools/build.mjs
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..');
const root = path.resolve(here, '../../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
await build({
  absWorkingDir: path.join(root, 'apps/desktop'),
  entryPoints: [path.join(here, 'entry.ts')],
  outfile: path.join(out, 'renderer.js'), bundle: true, minify: true, logLevel: 'warning', legalComments: 'none',
  platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
  // timber.ts draws with the very three.js the map draws with, not a second copy.
  nodePaths: [path.join(root, 'packages/forest/node_modules')],
});
// The renderer's own page, its stylesheet links kept; the policy line goes, since a page opened from disk has no 'self'.
const html = readFileSync(path.join(root, 'apps/desktop/src/renderer/index.html'), 'utf8')
  .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  // No road worker either: a page from disk cannot start one, so the map routes its roads on the page, as it does without one.
  .replace(/\s*<meta name="storytree-road-worker"[^>]*>/, '')
  .replace('<title>storytree 0.3</title>', '<title>Capability tree 3D, mock B: timber</title>')
  .replace('</head>', '    <link rel="stylesheet" href="timber.css" />\n  </head>');
writeFileSync(path.join(out, 'index.html'), html);
copyFileSync(path.join(root, 'apps/desktop/src/renderer/styles.css'), path.join(out, 'styles.css'));
copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(out, 'arc-surface.css'));
copyFileSync(require.resolve('@storytree/app-setup/view/styles.css'), path.join(out, 'app-setup.css'));
copyFileSync(require.resolve('@storytree/forest/view/styles.css'), path.join(out, 'forest.css'));
copyFileSync(path.join(here, 'timber.css'), path.join(out, 'timber.css'));
console.log(`built ${path.relative(root, out)}/index.html`);
