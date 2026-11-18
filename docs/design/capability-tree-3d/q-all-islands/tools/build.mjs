import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { built } from './page-folder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), out = path.dirname(here);
const root = path.resolve(here, '../../../../..');
const website = path.join(root, 'packages/forest');
const require = createRequire(path.join(website, 'package.json'));
const { build } = require('esbuild');
const retake = process.argv.includes('--retake'), to = retake ? out : built;
if (retake) rmSync(built, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const names = readdirSync(path.join(out, 'layouts')).filter(f => f.endsWith('.json') && !f.endsWith('.measures.json')).map(f => f.slice(0, -5)).sort();
writeFileSync(path.join(here, 'layouts.gen.ts'), `// Written by build.mjs: every arrangement in layouts/.\n${names.map((n, i) => `import l${i} from "../layouts/${n}.json" with { type: "json" };`).join('\n')}\nexport const LAYOUTS = { ${names.map((n, i) => `${JSON.stringify(n)}: l${i}`).join(', ')} };\n`);
await build({
  absWorkingDir: website,
  entryPoints: { page: path.join(here, 'page.tsx') },
  outExtension: { '.js': '.min.js' },
  outdir: to, bundle: true, minify: !process.argv.includes('--debug'), logLevel: 'warning', legalComments: 'none',
  platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
  nodePaths: [path.join(website, 'node_modules'), path.join(root, 'packages/forest-world/node_modules'), path.join(root, 'packages/app/node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'link-layout', setup(b) {
    b.onResolve({ filter: /territories\/territories\.js$/ }, (args) => args.importer.endsWith('territories-shim.ts') ? undefined : { path: path.join(here, 'territories-shim.ts') });
  } }],
  loader: { '.glb': 'binary', '.png': 'dataurl', '.webp': 'dataurl', '.woff2': 'dataurl' },
});
await build({
  absWorkingDir: website, entryPoints: [path.join(website, 'src/territories/search-worker.ts')], outfile: path.join(to, 'territory-worker.min.js'),
  bundle: true, minify: true, logLevel: 'warning', legalComments: 'none', platform: 'browser', format: 'iife', target: 'es2022',
});
copyFileSync(path.join(here, 'index.template.html'), path.join(to, 'index.html'));
console.log(`Built index.html, page.min.js, territory-worker.min.js and page.css from the real map code into ${to}.`);
