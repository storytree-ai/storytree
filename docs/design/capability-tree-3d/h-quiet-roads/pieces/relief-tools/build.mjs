import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), out = path.dirname(here);
const root = path.resolve(here, '../../../../../..');
const forest = path.join(root, 'packages/forest');
const require = createRequire(path.join(forest, 'package.json'));
const { build } = require('esbuild');
await build({
  absWorkingDir: forest,
  entryPoints: { 'relief.min': path.join(here, 'relief.ts') },
  outdir: out, bundle: true, minify: !process.argv.includes('--debug'), logLevel: 'warning', legalComments: 'none',
  platform: 'browser', format: 'iife', target: 'es2022',
  nodePaths: [path.join(root, 'packages/forest-world/node_modules'), path.join(forest, 'node_modules')],
});
console.log('Built pieces/relief.min.js.');
