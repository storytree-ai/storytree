// This landing's bounded acceptance instrument: the real desktop page with read-only scene hooks.
// Run through `node ~/.storytree/your-factory/plugins/micks-dev-loop/src/heavy-lock.mjs --`, from storytree's checkout root.
import { mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFolder } from '../../../../apps/desktop/src/capture/output.ts';
import { roadWorkerBuild } from '../../../../apps/desktop/src/renderer/road-worker.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
const out = buildFolder(here, 'production');
mkdirSync(out, { recursive: true });

await build({
  absWorkingDir: path.join(root, 'apps/desktop'),
  entryPoints: [path.join(root, 'apps/desktop/src/renderer/renderer.ts')],
  outfile: path.join(out, 'renderer.js'), bundle: true, logLevel: 'warning',
  sourcemap: true, platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
  banner: { js: "globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__nav = nav; };" },
});
await build({ ...roadWorkerBuild(out, path.join(root, 'apps/desktop')), absWorkingDir: path.join(root, 'apps/desktop'), logLevel: 'warning' });
for (const name of ['index.html', 'styles.css']) {
  copyFileSync(path.join(root, 'apps/desktop/src/renderer', name), path.join(out, name));
}
copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(out, 'arc-surface.css'));
copyFileSync(require.resolve('@storytree/app-setup/view/styles.css'), path.join(out, 'app-setup.css'));
copyFileSync(require.resolve('@storytree/forest/view/styles.css'), path.join(out, 'forest.css'));
console.log('Built the actual desktop page with read-only scene observation hooks.');
