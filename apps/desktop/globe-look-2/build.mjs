// Throwaway substitutions in the actual desktop renderer; no product source is edited.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const dist = path.join(here, 'dist');
const research = path.join(root, 'docs/research/globe-look-2');
mkdirSync(dist, { recursive: true });
mkdirSync(path.join(research, 'changes'), { recursive: true });
const read = name => readFileSync(path.join(root, name), 'utf8');
const snippet = name => readFileSync(path.join(here, `${name}.txt`), 'utf8');
const turnPath = 'packages/forest/src/never-hidden/never-hidden.ts';
const canvasPath = 'packages/forest-world/src/planet/PlanetWorldCanvas.tsx';
const turn = read(turnPath);
const canvas = read(canvasPath);
const mean = source => source.replace(/\/\*\* Face the first failing island[\s\S]*?\n}\n/, snippet('middle'));
const fit = source => source.replace('/** A second mount', `${snippet('fit')}\n/** A second mount`)
  .replace('<Framing radius={radius} />', '<Framing radius={radius} />\n    {scene.islands.length > 0 && scene.islands.length <= 12 && <IslandFraming count={scene.islands.length} />}');
const sea = source => source.replace('DirectionalLight, Group, Quaternion', 'DirectionalLight, Group, MeshStandardMaterial, Quaternion')
  .replace('/** A second mount', `${snippet('sea')}\n/** A second mount`)
  .replace('<meshStandardMaterial color="#101418" roughness={1} />', '<SeaMaterial />');

// Save reviewable, independent diffs; counts exclude the capture instrumentation.
const counts = {};
for (const [name, file, original, changed] of [
  ['1-middle', turnPath, turn, mean(turn)],
  ['2-fit', canvasPath, canvas, fit(canvas)],
  ['3-sea', canvasPath, canvas, sea(canvas)],
]) {
  const before = path.join(dist, `${name}.before`), after = path.join(dist, `${name}.after`);
  writeFileSync(before, original); writeFileSync(after, changed);
  let diff;
  try { diff = execFileSync('diff', ['-u', '--label', `a/${file}`, '--label', `b/${file}`, before, after], { encoding: 'utf8' }); }
  catch (error) { if (error.status !== 1) throw error; diff = error.stdout; }
  writeFileSync(path.join(research, 'changes', `${name}.patch`), diff);
  counts[name] = { added: diff.split('\n').filter(s => s.startsWith('+') && !s.startsWith('+++')).length,
    removed: diff.split('\n').filter(s => s.startsWith('-') && !s.startsWith('---')).length };
}
writeFileSync(path.join(research, 'changes', 'lines.json'), JSON.stringify(counts, null, 2) + '\n');

for (const [name, middle, zoom, water] of [['0-today', false, false, false], ['1-middle', true, false, false],
  ['2-fit', false, true, false], ['3-sea', false, false, true], ['4-together', true, true, true]]) {
  const folder = path.join(dist, name);
  mkdirSync(folder, { recursive: true });
  await build({
    absWorkingDir: path.join(root, 'apps/desktop'),
    entryPoints: [path.join(root, 'apps/desktop/src/renderer/renderer.ts')],
    outfile: path.join(folder, 'renderer.js'), bundle: true, logLevel: 'warning', sourcemap: true,
    platform: 'browser', format: 'iife', target: 'es2023', loader: { '.glb': 'binary' },
    plugins: [{ name: 'look-only', setup(build) {
      build.onLoad({ filter: /never-hidden\.ts$/ }, () => ({ contents: middle ? mean(turn) : turn, loader: 'ts', resolveDir: path.dirname(path.join(root, turnPath)) }));
      build.onLoad({ filter: /PlanetWorldCanvas\.tsx$/ }, () => {
        let contents = canvas;
        if (zoom) contents = fit(contents);
        if (water) contents = sea(contents);
        // A read-only view of the actual mounted R3F objects, never a replacement drawing.
        contents = contents.replace('camera.lookAt(0, 0, 0);', 'camera.lookAt(0, 0, 0);')
          .replace('    <Lights />', `    <Lights />\n    <CaptureProbe />`);
        contents += '\nfunction CaptureProbe() { const state = useThree(); globalThis.__globe = state; return null; }\n';
        return { contents, loader: 'tsx', resolveDir: path.dirname(path.join(root, canvasPath)) };
      });
    }}],
  });
  for (const file of ['index.html', 'styles.css']) copyFileSync(path.join(root, 'apps/desktop/src/renderer', file), path.join(folder, file));
}
console.log(JSON.stringify(counts));
