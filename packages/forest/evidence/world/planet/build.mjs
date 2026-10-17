// Build the off-screen frame proof without opening Chromium.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';
const here = path.dirname(fileURLToPath(import.meta.url));
export async function buildPage(out) {
  mkdirSync(out, { recursive: true });
  try {
    await build({
      entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(out, 'bundle.js'),
      bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
  } finally { stop(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPage(path.join(here, 'dist'));
