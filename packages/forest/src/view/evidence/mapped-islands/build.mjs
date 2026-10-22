// Bundles the actual desktop page for the mapped-islands capture, adding only observation hooks (R3F state, the
// navigation rotation). `node build.mjs <cap>` bundles it with MAPPED_ISLAND_CAP set to <cap> instead, into cap-<cap> in its build folder,
// so the cap can be chosen from pictures; with no argument it is the shipped page, in shipped/ there. See README.md.
import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFolder } from '../../../../../../apps/desktop/src/capture/output.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
function replace(source, needle, value) {
  if (!source.includes(needle)) throw new Error(`Capture observation hook moved: ${needle}`);
  return source.replace(needle, value);
}
const cap = process.argv[2];
const out = buildFolder(here, cap === undefined ? 'shipped' : `cap-${cap}`);
mkdirSync(out, { recursive: true });
await build({
  absWorkingDir: path.join(root, 'apps/desktop'),
  entryPoints: [path.join(root, 'apps/desktop/src/renderer/renderer.ts')],
  outfile: path.join(out, 'renderer.js'), bundle: true, logLevel: 'warning',
  sourcemap: true, platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
  banner: { js: "globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__nav = nav; };" },
  plugins: [{ name: 'mapped-islands-observation', setup(builder) {
    if (cap !== undefined) builder.onLoad({ filter: /island-growth\.ts$/ }, args => ({
      contents: replace(readFileSync(args.path, 'utf8'), 'export const MAPPED_ISLAND_CAP = 12_000;', `export const MAPPED_ISLAND_CAP = ${Number(cap)};`),
      loader: 'ts', resolveDir: path.dirname(args.path),
    }));
  } }],
});
for (const name of ['index.html', 'styles.css']) copyFileSync(path.join(root, 'apps/desktop/src/renderer', name), path.join(out, name));
copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(out, 'arc-surface.css'));
copyFileSync(require.resolve('@storytree/app-setup/view/styles.css'), path.join(out, 'app-setup.css'));
copyFileSync(require.resolve('@storytree/forest/view/styles.css'), path.join(out, 'forest.css'));
console.log(`Built the actual desktop page for the mapped-islands capture in ${path.relative(here, out)}.`);
