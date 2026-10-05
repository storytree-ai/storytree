// The same capture build, including its optional red-proof mutations.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '../..');
export const mutation = process.argv.find(arg => arg.startsWith('--mutate='))?.slice('--mutate='.length);
// Each mutation changes only this capture's bundle, removing one real behaviour a proof below checks.
const MUTATIONS = {
  mode: [/forest-view\.tsx$/, '    render({ mode });\n', '    render({});\n'],
  emphasis: [/session-emphasis\.tsx$/, 'emphasis === "held" ? 1.16 : 0.24', '1'],
  fit: [/tree-space\.ts$/, '() => moving.fit()', '() => {}'],
};
assert.ok(mutation === undefined || MUTATIONS[mutation], `--mutate is one of ${Object.keys(MUTATIONS).join(', ')}`);
const codeRows = path.join(pkgDir, 'src/view/evidence/code-rows');
export const seed = JSON.parse(gunzipSync(readFileSync(path.join(codeRows, 'seed.json.gz'))));
const survey = JSON.parse(readFileSync(path.join(codeRows, 'survey.json')));
export async function buildPage(out) {
  mkdirSync(out, { recursive: true });
  try {
    await build({
      entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(out, 'bundle.js'), bundle: true, sourcemap: 'external',
      format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2023', loader: { '.glb': 'binary' }, logLevel: 'warning',
      define: { __SEED__: JSON.stringify(seed), __SURVEY__: JSON.stringify(survey), 'process.env.NODE_ENV': '"production"' },
      plugins: mutation === undefined ? [] : [{ name: `red-${mutation}`, setup(builder) {
        const [filter, from, to] = MUTATIONS[mutation];
        builder.onLoad({ filter }, ({ path: sourcePath }) => {
          const source = readFileSync(sourcePath, 'utf8');
          const changed = source.replace(from, to);
          assert.notEqual(changed, source, `the ${mutation} mutation must change the real source`);
          return { contents: changed, loader: sourcePath.endsWith('x') ? 'tsx' : 'ts' };
        });
      } }],
    });
    writeFileSync(path.join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/bundle.css">
<style>html,body{margin:0;width:100%;height:100%;background:#101418;color:#e7edf0;font:14px system-ui}#content{position:absolute;inset:0}#globe{position:absolute;inset:0}#panel{position:absolute;right:0;top:0;width:360px}</style>
</head><body><div id="content" class="forest-workspace" data-theme="dark"><div id="globe"></div><aside id="panel"></aside></div><script src="/bundle.js"></script></body></html>`);

  } finally { stop(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPage(path.join(here, 'dist'));
