// Bundles the real settings panel (mountSettings) for the library-address capture; no browser.
// Run alone (`node build.mjs`), it only checks that the bundle still builds.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(pkg, 'package.json'));

export async function buildSettingsPanel() {
  const { build } = require('esbuild');
  const bundled = await build({
    stdin: { contents: 'import { mountSettings } from "./src/view/index.ts"; window.mountSettings = mountSettings;', resolveDir: pkg, loader: 'ts' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
  });
  return bundled.outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await buildSettingsPanel();
  if (!code.includes('mountSettings')) throw new Error('the settings panel bundle no longer exposes mountSettings');
  console.log(`Built the settings panel for the library-address capture (${code.length} bytes).`);
}
