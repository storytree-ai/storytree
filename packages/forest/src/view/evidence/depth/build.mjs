// Build after against this checkout; before remains available to the comparison capture.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../..');
const BEFORE = process.env.BEFORE ?? 'c8018334';
const require = createRequire(path.join(ROOT, 'apps/desktop/package.json'));
const { build, stop } = require('esbuild');
const CHANGED = ['packages/forest-world/src/planet/planet.ts', 'packages/forest-world/src/planet/island-surface.ts',
  'packages/forest/src/view/globe-surfaces.ts', 'packages/forest/src/view/planet-view.tsx'];
const atBase = file => execFileSync('git', ['show', `${BEFORE}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const HOOK = 'const { camera, gl, scene, size, invalidate } = useThree();';

export async function bundle(which) {
  const dist = path.join(HERE, 'dist', which);
  mkdirSync(dist, { recursive: true });
  const base = new Map(CHANGED.map(file => [path.resolve(ROOT, file).toLowerCase(), file]));
  try {
    await build({
      absWorkingDir: path.join(ROOT, 'apps/desktop'),
      entryPoints: [path.join(ROOT, 'apps/desktop/src/renderer/renderer.ts')],
      outfile: path.join(dist, 'renderer.js'), bundle: true, logLevel: 'warning',
      sourcemap: false, platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
      banner: { js: "globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true });" },
      plugins: [{ name: 'before-after', setup(b) {
        b.onLoad({ filter: /(planet|island-surface|globe-surfaces|planet-view)\.tsx?$/ }, args => {
          const file = base.get(path.resolve(args.path).toLowerCase());
          if (file === undefined) return undefined;
          let contents = which === 'before' ? atBase(file) : readFileSync(args.path, 'utf8');
          if (file.endsWith('planet-view.tsx')) {
            if (!contents.includes(HOOK)) throw new Error('observation hook moved');
            contents = contents.replace(HOOK, `${HOOK} globalThis.__nav = { rotation, onRotate };`);
          }
          return { contents, loader: file.endsWith('x') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) };
        });
      } }],
    });
  } finally { stop(); }
  for (const name of ['index.html', 'styles.css']) copyFileSync(path.join(ROOT, 'apps/desktop/src/renderer', name), path.join(dist, name));
  copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(dist, 'arc-surface.css'));
  copyFileSync(require.resolve('@storytree/app-setup/view/styles.css'), path.join(dist, 'app-setup.css'));
  copyFileSync(require.resolve('@storytree/forest/view/styles.css'), path.join(dist, 'forest.css'));
  return dist;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await bundle('after');
