// Bundles the actual desktop page of a checkout for the capture, adding only observation hooks (R3F
// state, the navigation rotation). `node build.mjs <checkout root> <before|after>`; the root defaults to
// the checkout this folder is in. Output goes to the ignored dist/<label>/. See README.md.
import { mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.resolve(here, '../../../../../..'));
const label = process.argv[3] ?? 'after';
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
const out = path.join(here, 'dist', label);
mkdirSync(out, { recursive: true });
await build({
  absWorkingDir: path.join(root, 'apps/desktop'),
  entryPoints: [path.join(root, 'apps/desktop/src/renderer/renderer.ts')],
  outfile: path.join(out, 'renderer.js'), bundle: true, logLevel: 'warning',
  sourcemap: true, platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
  banner: { js: "globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__nav = nav; };" },
});
for (const name of ['index.html', 'styles.css']) copyFileSync(path.join(root, 'apps/desktop/src/renderer', name), path.join(out, name));
copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(out, 'arc-surface.css'));
copyFileSync(require.resolve('@storytree/app-setup/view/styles.css'), path.join(out, 'app-setup.css'));
copyFileSync(require.resolve('@storytree/forest/view/styles.css'), path.join(out, 'forest.css'));
console.log(`Built ${root}'s desktop page into dist/${label}.`);
