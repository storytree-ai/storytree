// Build the public guided-globe capture without opening Chromium.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';
const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.join(here, 'dist');
try {
  mkdirSync(dist, { recursive: true });
  const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '../../src/view/evidence/code-rows/seed.json.gz'))));
  const survey = JSON.parse(readFileSync(path.join(here, '../../src/view/evidence/code-rows/survey.json')));
  await build({ entryPoints: [path.join(here, 'entry.tsx')], outfile: path.join(dist, 'entry.js'), bundle: true,
    format: 'esm', jsx: 'automatic', loader: { '.glb': 'file' }, define: { __SEED__: JSON.stringify(seed), __SURVEY__: JSON.stringify(survey) } });
  writeFileSync(path.join(dist, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/entry.css"><style>
html,body{margin:0;width:100%;height:100%;background:#101418;color:#e7edf0;font:16px system-ui}#globe{position:absolute;inset:0;isolation:isolate}#arcs{position:relative;transform:translateZ(0);z-index:4}aside{position:absolute;right:28px;top:100px;width:265px;padding:24px;background:#1a252e;border:1px solid #526878;border-radius:10px;z-index:3;pointer-events:none}h1{font-size:22px}p{line-height:1.5}.tag{color:#8cb6d1;font-size:12px;text-transform:uppercase;letter-spacing:.1em}@media(max-width:600px){aside{top:auto;bottom:20px;right:20px;left:20px;width:auto;padding:14px}aside p{display:none}}
#pointer{position:absolute;z-index:3;pointer-events:none;width:18px;height:18px;margin:-10px;border:2px solid #5cdeec;border-radius:50%;box-shadow:0 0 0 5px #10141880}#pointer span{position:absolute;left:24px;top:-6px;font-size:12px;padding:5px 8px;white-space:nowrap;background:#101418;border:1px solid #5cdeec;border-radius:4px}
</style></head><body><div id="globe"></div><div id="arcs"></div><div id="pointer" hidden><span></span></div><aside><div class="tag">App controls · evidence</div><h1>One place, in focus</h1><p>The app turns the globe and keeps this card clear of its target. The host reads the same target’s screen position.</p></aside><script type="module" src="/entry.js"></script></body></html>`);

} finally { stop(); }
