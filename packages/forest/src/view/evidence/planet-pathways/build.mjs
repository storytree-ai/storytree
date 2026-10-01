// One landing's capture instrument, adapted from spike/globe-pathways.
// Bundle the real desktop page. The only additions expose rendering/navigation state.
import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
const out = path.join(here, 'dist');
mkdirSync(out, { recursive: true });

function replace(source, needle, value) {
  if (!source.includes(needle)) throw new Error(`Capture observation hook moved: ${needle}`);
  return source.replace(needle, value);
}

await build({
  absWorkingDir: path.join(root, 'apps/desktop'),
  entryPoints: [path.join(root, 'apps/desktop/src/renderer/renderer.ts')],
  outfile: path.join(out, 'renderer.js'), bundle: true, logLevel: 'warning',
  sourcemap: true, platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
  banner: { js: "globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true });" },
  plugins: [{ name: 'planet-pathways-observation', setup(builder) {
    builder.onLoad({ filter: /planet-view\.tsx$/ }, args => ({
      contents: replace(readFileSync(args.path, 'utf8'),
        'const { camera, gl, scene, size } = useThree();',
        'const { camera, gl, scene, size } = useThree(); globalThis.__nav = { rotation, onRotate };'),
      loader: 'tsx', resolveDir: path.dirname(args.path),
    }));
  } }],
});
for (const name of ['index.html', 'styles.css']) {
  copyFileSync(path.join(root, 'apps/desktop/src/renderer', name), path.join(out, name));
}
copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(out, 'arc-surface.css'));
console.log('Built the actual desktop page with rendering/navigation observation hooks.');
