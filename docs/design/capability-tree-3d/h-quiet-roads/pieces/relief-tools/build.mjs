// Builds pieces/relief.min.js from relief-tools/relief.ts: three.js bundled in, one classic script, so relief.html opens from disk
// with no network. Run from the checkout root: node docs/design/capability-tree-3d/h-quiet-roads/pieces/relief-tools/build.mjs
// A minified bundle committed under docs/design is named *.min.js: CodeQL's JavaScript extractor skips files so named by
// default (github/codeql javascript/extractor AutoBuild.java, "exclude files whose name strongly suggests they are
// minified"), so the bundled third-party code (three.js here) raises no alerts while hand-written sketch code stays scanned.
// The --debug build is unminified, for reading in a debugger only: it is never committed.
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
  // three.js lives with the drawing engine.
  nodePaths: [path.join(root, 'packages/forest-world/node_modules'), path.join(forest, 'node_modules')],
});
console.log('Built pieces/relief.min.js.');
