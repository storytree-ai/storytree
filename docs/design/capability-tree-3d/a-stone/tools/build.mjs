import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), out = path.dirname(here);
const root = path.resolve(here, '../../../../..');
const website = path.join(root, 'packages/website');
const require = createRequire(path.join(website, 'package.json'));
const { build } = require('esbuild');
await build({
  absWorkingDir: website,
  entryPoints: { page: path.join(here, 'page.tsx') },
  outExtension: { '.js': '.min.js' },
  outdir: out, bundle: true, minify: !process.argv.includes('--debug'), logLevel: 'warning', legalComments: 'none',
  platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
  nodePaths: [path.join(website, 'node_modules'), path.join(root, 'packages/forest-world/node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.glb': 'binary', '.png': 'dataurl', '.webp': 'dataurl', '.woff2': 'dataurl' },
});
copyFileSync(path.join(here, 'index.template.html'), path.join(out, 'index.html'));
console.log('Built index.html, page.min.js and page.css from the real map code.');
