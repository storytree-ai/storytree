// Builds the desktop app's own page once per option (variants.mjs), as the capture kit's buildCapture does, with that
// option's edits applied to the bundle: the page, its road worker and its territory search worker alike, so the layout
// searched off the page is the option's too. Each goes to the checkout's ignored .evidence-builds/, one folder per option.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/r-room/tools/build.mjs [option ...]
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageBuild } from '../../../../../apps/desktop/src/renderer/page-build.ts';
import { roadWorkerBuild, territoryWorkerBuild } from '../../../../../apps/desktop/src/renderer/road-worker.ts';
import { buildFolder } from '../../../../../apps/desktop/src/capture/index.ts';
import { OPTIONS, optionPlugin } from './variants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../../../..');
const desktop = path.join(root, 'apps/desktop');
const require = createRequire(path.join(desktop, 'package.json'));
const { build, stop } = require('esbuild');

/** Where option `name`'s page is built. */
export const optionFolder = name => buildFolder(here, name);

export async function buildOption(name) {
  const dist = optionFolder(name);
  mkdirSync(dist, { recursive: true });
  const plugins = [optionPlugin(name, root, { readFileSync, path })];
  await build({
    ...pageBuild(dist, desktop), logLevel: 'warning', loader: { '.glb': 'binary' }, plugins,
    banner: { js: "globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__nav = nav; };" },
  });
  await build({ ...roadWorkerBuild(dist, desktop), absWorkingDir: desktop, logLevel: 'warning', plugins });
  await build({ ...territoryWorkerBuild(dist, desktop), absWorkingDir: desktop, logLevel: 'warning', plugins });
  for (const file of ['index.html', 'styles.css']) copyFileSync(path.join(desktop, 'src/renderer', file), path.join(dist, file));
  for (const [pkg, file] of [['arc-surface', 'arc-surface.css'], ['app-setup', 'app-setup.css'], ['forest', 'forest.css']]) {
    copyFileSync(require.resolve(`@storytree/${pkg}/view/styles.css`), path.join(dist, file));
  }
  return dist;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
  try {
    for (const name of asked.length ? asked : Object.keys(OPTIONS)) console.log(`${name}: built into ${await buildOption(name)}`);
  } finally { stop(); }
}
