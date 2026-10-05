// Build the capture page without opening Chromium.
import { build, stop } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
export async function buildPage() {
  try {
    return await build({ entryPoints: [path.join(here, 'entry.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', absWorkingDir: root, loader: { '.png': 'dataurl', '.glb': 'dataurl' }, logLevel: 'error' });
  } finally { stop(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPage();
