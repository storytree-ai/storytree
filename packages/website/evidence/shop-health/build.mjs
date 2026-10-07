// Bundles the shop-health capture's page (page.tsx), with the growth exported without CI health as `before-snapshot`; no browser.
// Run alone (`node build.mjs`), it only checks that the page still builds, with the saved shop growth standing in as the before.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildShopHealthPage(beforeFile, outfile) {
  return build({
    entryPoints: [path.join(here, 'page.tsx')], ...(outfile ? { outfile } : { write: false, outdir: here }), alias: { 'before-snapshot': path.resolve(beforeFile) },
    bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.json': 'json', '.glb': 'binary', '.png': 'file', '.webp': 'file' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = await buildShopHealthPage(path.join(here, '../../src/shop-snapshot.json'));
  const code = built.outputFiles.find(file => file.path.endsWith('.js')).text;
  if (!code.includes('shopProof')) throw new Error('the shop-health page bundle no longer exposes shopProof');
  console.log(`Built the shop-health capture's page (${code.length} bytes).`);
}
