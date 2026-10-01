// Bundles the actual desktop page of a checkout for the capture, adding only observation hooks (R3F
// state, the navigation rotation). `node build.mjs <checkout root> <before|after>`; the root defaults to
// the checkout this folder is in. Output goes to the ignored dist/<label>/. See README.md.
import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.resolve(here, '../../../../../..'));
const label = process.argv[3] ?? 'after';
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
function replace(source, needle, value) {
  if (!source.includes(needle)) throw new Error(`Capture observation hook moved: ${needle}`);
  return source.replace(needle, value);
}
const out = path.join(here, 'dist', label);
mkdirSync(out, { recursive: true });
await build({
  absWorkingDir: path.join(root, 'apps/desktop'),
  entryPoints: [path.join(root, 'apps/desktop/src/renderer/renderer.ts')],
  outfile: path.join(out, 'renderer.js'), bundle: true, logLevel: 'warning',
  sourcemap: true, platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
  plugins: [{ name: 'circles-fit-observation', setup(builder) {
    builder.onLoad({ filter: /PlanetWorldCanvas\.tsx$/ }, args => ({
      contents: replace(readFileSync(args.path, 'utf8'), '<Framing radius={radius} framing={framing} />', '<Framing radius={radius} framing={framing} /><CaptureProbe />')
        + '\nfunction CaptureProbe() { const state = useThree(); globalThis.__globe = state; return null; }\n',
      loader: 'tsx', resolveDir: path.dirname(args.path),
    }));
    builder.onLoad({ filter: /planet-view\.tsx$/ }, args => ({
      contents: replace(readFileSync(args.path, 'utf8'),
        'const { camera, gl, scene, size } = useThree();',
        'const { camera, gl, scene, size } = useThree(); globalThis.__nav = { rotation, onRotate };'),
      loader: 'tsx', resolveDir: path.dirname(args.path),
    }));
  } }],
});
for (const name of ['index.html', 'styles.css']) copyFileSync(path.join(root, 'apps/desktop/src/renderer', name), path.join(out, name));
copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(out, 'arc-surface.css'));
copyFileSync(require.resolve('@storytree/app-setup/view/styles.css'), path.join(out, 'app-setup.css'));
copyFileSync(require.resolve('@storytree/forest/view/styles.css'), path.join(out, 'forest.css'));
console.log(`Built ${root}'s desktop page into dist/${label}.`);
