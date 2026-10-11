// The capture page's build, with its --before variant: the panel's measured width withheld from the globe.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const codeRows = path.resolve(here, '../../src/view/evidence/code-rows');

export async function buildPage(out, { before = false } = {}) {
  const seed = JSON.parse(gunzipSync(readFileSync(path.join(codeRows, 'seed.json.gz'))));
  const survey = JSON.parse(readFileSync(path.join(codeRows, 'survey.json')));
  mkdirSync(out, { recursive: true });
  try {
    await build({
      entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(out, 'bundle.js'), bundle: true,
      format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2023', loader: { '.glb': 'binary' }, logLevel: 'warning',
      define: { __SEED__: JSON.stringify(seed), __SURVEY__: JSON.stringify(survey), 'process.env.NODE_ENV': '"production"' },
      plugins: before ? [{ name: 'before', setup(builder) {
        builder.onLoad({ filter: /forest-view\.tsx$/ }, ({ path: file }) => {
          const source = readFileSync(file, 'utf8'), changed = source.replace('aside={drawn.aside}', 'aside={0}');
          assert.notEqual(changed, source, 'the before build withholds the measured width');
          return { contents: changed, loader: 'tsx' };
        });
      } }] : [],
    });
  } finally { stop(); }
  writeFileSync(path.join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/bundle.css">
<style>html,body{margin:0;width:100%;height:100%;background:#101418;color:#e7edf0;font:14px system-ui}#content{position:absolute;inset:0}#globe{position:absolute;inset:0}</style>
</head><body><div id="content" class="forest-workspace" data-theme="dark"><div id="globe"></div><aside class="story-panel" hidden></aside></div><script src="/bundle.js"></script></body></html>`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPage(path.join(here, 'dist'));
