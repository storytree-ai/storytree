// Builds the claim-flag capture page (ADR-0968) without opening Chromium: the code-rows reading, with one island's survey
// left out so it has no code yet. See README.md.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';
const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.join(here, 'dist');
try {
  mkdirSync(dist, { recursive: true });
  copyFileSync(createRequire(import.meta.url).resolve('@storytree/forest/view/styles.css'), path.join(dist, 'forest.css'));
  const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '../code-rows/seed.json.gz'))));
  const survey = JSON.parse(readFileSync(path.join(here, '../code-rows/survey.json')));
  await build({ entryPoints: [path.join(here, 'entry.tsx')], outfile: path.join(dist, 'entry.js'), bundle: true,
    format: 'esm', jsx: 'automatic', loader: { '.glb': 'file' }, define: { __SEED__: JSON.stringify(seed), __SURVEY__: JSON.stringify(survey) } });
  writeFileSync(path.join(dist, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/forest.css"><style>
html,body{margin:0;width:100%;height:100%;background:#101418;color:#e7edf0;font:16px system-ui}#globe{position:absolute;inset:0;isolation:isolate}
#stage{position:absolute;left:16px;top:12px;z-index:3;font-size:13px;padding:6px 10px;background:#101418cc;border:1px solid #526878;border-radius:6px}
</style></head><body><div id="globe"></div><div id="stage"></div><script type="module" src="/entry.js"></script></body></html>`);
} finally { stop(); }
