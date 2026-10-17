// The globe-exterior capture's page: the planet canvas bundled for Chromium, with its source map.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';
const here = path.dirname(fileURLToPath(import.meta.url));
export async function buildPage(out) {
  mkdirSync(out, { recursive: true });
  try {
    await build({
      entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(out, 'bundle.js'), bundle: true, sourcemap: 'external',
      format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2023', logLevel: 'warning',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    writeFileSync(path.join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;width:100%;height:100%;background:#101418}#globe{position:absolute;inset:0}</style>
</head><body><div id="globe"></div><script src="/bundle.js"></script></body></html>`);
  } finally { stop(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPage(path.join(here, 'dist'));
