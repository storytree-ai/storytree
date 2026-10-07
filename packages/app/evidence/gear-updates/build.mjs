// Bundles the production update view for the gear-updates capture to re-mount; no browser.
// Run alone (`node build.mjs`), it only checks that the bundle still builds.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(root, 'apps/desktop/build.mjs'));

export async function buildUpdatesView() {
  const { build } = require('esbuild');
  const mounted = await build({ entryPoints: [path.join(root, 'packages/app/src/view/updates.ts')], bundle: true, write: false, format: 'iife', globalName: 'gearUpdateCapture', platform: 'browser' });
  return mounted.outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await buildUpdatesView();
  if (!code.includes('mountUpdates')) throw new Error('the update view bundle no longer exposes mountUpdates');
  console.log(`Built the update view for the gear-updates capture (${code.length} bytes).`);
}
