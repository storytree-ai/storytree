// Usage: node build.mjs <checkout-root> <out-dir>. The actual desktop page plus a probe exposing R3F state as __globe.
import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
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
  plugins: [{ name: 'probe', setup(b) {
    b.onLoad({ filter: /PlanetWorldCanvas\.tsx$/ }, args => {
      const src = readFileSync(args.path, 'utf8');
      if (!src.includes('<Framing radius={radius} framing={framing} />')) throw new Error('probe moved');
      return { contents: src.replace('<Framing radius={radius} framing={framing} />', '<Framing radius={radius} framing={framing} /><CaptureProbe />') + '\nfunction CaptureProbe() { const state = useThree(); globalThis.__globe = state; return null; }\n', loader: 'tsx', resolveDir: path.dirname(args.path) };
    });
  } }],
});
for (const name of ['index.html', 'styles.css']) copyFileSync(path.join(root, 'apps/desktop/src/renderer', name), path.join(out, name));
copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(out, 'arc-surface.css'));
copyFileSync(require.resolve('@storytree/app-setup/view/styles.css'), path.join(out, 'app-setup.css'));
copyFileSync(require.resolve('@storytree/forest/view/styles.css'), path.join(out, 'forest.css'));
console.log('built', out);
