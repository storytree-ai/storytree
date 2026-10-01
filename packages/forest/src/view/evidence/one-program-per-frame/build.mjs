// Usage: node build.mjs <checkout-root> <out-dir>. The actual desktop page whose globe hands its R3F state to __globe through the canvas's capture seam.
import { mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const [root, out] = process.argv.slice(2).map(p => path.resolve(p));
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
mkdirSync(out, { recursive: true });
await build({
  absWorkingDir: path.join(root, 'apps/desktop'),
  entryPoints: [path.join(root, 'apps/desktop/src/renderer/renderer.ts')],
  outfile: path.join(out, 'renderer.js'), bundle: true, logLevel: 'warning',
  sourcemap: true, platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
  banner: { js: "globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true });" },
});
for (const name of ['index.html', 'styles.css']) copyFileSync(path.join(root, 'apps/desktop/src/renderer', name), path.join(out, name));
copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(out, 'arc-surface.css'));
copyFileSync(require.resolve('@storytree/app-setup/view/styles.css'), path.join(out, 'app-setup.css'));
copyFileSync(require.resolve('@storytree/forest/view/styles.css'), path.join(out, 'forest.css'));
console.log('built', out);
