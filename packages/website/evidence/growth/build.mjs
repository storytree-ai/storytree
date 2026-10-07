// Bundles the growth capture's page (page.tsx); no browser.
// Run alone (`node build.mjs`), it only checks that the page still builds.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildGrowthPage(outfile) {
  return build({
    entryPoints: [path.join(here, 'page.tsx')], ...(outfile ? { outfile } : { write: false, outdir: here }),
    bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.json': 'json', '.glb': 'binary', '.png': 'file', '.webp': 'file' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = await buildGrowthPage();
  const code = built.outputFiles.find(file => file.path.endsWith('.js')).text;
  if (!code.includes('growthProof')) throw new Error('the growth page bundle no longer exposes growthProof');
  console.log(`Built the growth capture's page (${code.length} bytes).`);
}
