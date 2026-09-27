// Borrowed from spike/globe-pathways, via the #114 capture instrument.
// Bundle the real desktop page; all look substitutions stay in the bundle, never in src/.
import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
const layer = JSON.stringify(path.join(here, 'knowledge.tsx'));
function replace(source, needle, value) {
  if (!source.includes(needle)) throw new Error(`Capture hook moved: ${needle}`);
  return source.replace(needle, value);
}
for (const variant of ['baseline', 'k1', 'k2']) {
  const out = path.join(here, 'dist', variant);
  mkdirSync(out, { recursive: true });
  await build({
    absWorkingDir: path.join(root, 'apps/desktop'),
    entryPoints: [path.join(root, 'apps/desktop/src/renderer/renderer.ts')],
    outfile: path.join(out, 'renderer.js'), bundle: true, logLevel: 'warning',
    sourcemap: true, platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
    plugins: [{ name: 'knowledge-look', setup(builder) {
      builder.onLoad({ filter: /globe-knowledge\/knowledge\.tsx$/ }, args => ({
        contents: readFileSync(args.path, 'utf8'), loader: 'tsx',
        resolveDir: path.join(root, 'packages/knowledge-core'),
      }));
      builder.onLoad({ filter: /PlanetWorldCanvas\.tsx$/ }, args => ({
        contents: replace(readFileSync(args.path, 'utf8'), '<Lights />', '<Lights /><CaptureProbe />')
          + '\nfunction CaptureProbe() { const state = useThree(); globalThis.__globe = state; return null; }\n',
        loader: 'tsx', resolveDir: path.dirname(args.path),
      }));
      builder.onLoad({ filter: /planet-view\.tsx$/ }, args => {
        let contents = replace(readFileSync(args.path, 'utf8'),
          'const { camera, gl, scene, size } = useThree();',
          'const { camera, gl, scene, size } = useThree(); globalThis.__nav = { rotation, onRotate };');
        if (variant !== 'baseline') {
          contents = `import { KnowledgePoints } from ${layer};\n` + contents;
          contents = replace(contents, 'PlanetView({ scene,', 'PlanetView({ core, scene,');
          contents = replace(contents, 'rotation={rotation.toArray()} kitBytes={kitBytes}',
            `inside={<KnowledgePoints core={core} spots={layout.spots} radius={PLANET_RADIUS} threads={${variant === 'k2'}} />} rotation={rotation.toArray()} kitBytes={kitBytes}`);
        }
        return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) };
      });
      if (variant !== 'baseline') builder.onLoad({ filter: /forest-view\.tsx$/ }, args => ({
        contents: replace(readFileSync(args.path, 'utf8'), '<PlanetView scene=', '<PlanetView core={core} scene='),
        loader: 'tsx', resolveDir: path.dirname(args.path),
      }));
    } }],
  });
  for (const name of ['index.html', 'styles.css']) copyFileSync(path.join(root, 'apps/desktop/src/renderer', name), path.join(out, name));
  copyFileSync(require.resolve('@storytree/arc-surface/view/styles.css'), path.join(out, 'arc-surface.css'));
}
console.log('Built baseline, K1 points, and K2 points with shelf threads on the real desktop page.');
