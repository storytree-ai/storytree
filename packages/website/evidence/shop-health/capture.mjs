// The shop's globe coloured by its CI, stage by stage (increment_a0e1efc68913): pictures of chosen saved stages, the
// last stage as exported before CI health for contrast, a strip of them, and a clip of the whole growth playing.
// node packages/website/evidence/shop-health/capture.mjs <the same growth exported without --ci> [<scratch dir>]
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const [beforeFile, scratch = path.join(tmpdir(), 'shop-health-capture')] = process.argv.slice(2);
if (!beforeFile) throw new Error('Name the shop growth as exported without --ci.');
mkdirSync(scratch, { recursive: true });
const forestCss = readFileSync(path.join(here, '../../../forest/src/view/styles.css'), 'utf8');
const VIEW = { width: 1440, height: 900 };
const SHOTS = [
  { file: 'shop-pr2.png', query: 'stage=pr2', caption: 'after PR 2: no code in story packages yet, so no land' },
  { file: 'shop-pr3.png', query: 'stage=pr3', caption: 'after PR 3: the first CI run on story packages colours its parts healthy' },
  { file: 'shop-pr7.png', query: 'stage=pr7', caption: 'after PR 7: every part with code healthy by CI' },
  { file: 'shop-complete.png', query: 'stage=complete', caption: 'complete: 63 contracts verified passing by the shop\'s CI' },
  { file: 'shop-complete-before.png', query: 'stage=complete&before=1', caption: 'complete, the same growth without CI health: every part untested' },
];
let browser, server;
try {
  await build({
    entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(scratch, 'bundle.js'), alias: { 'before-snapshot': path.resolve(beforeFile) },
    bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.json': 'json', '.glb': 'binary', '.png': 'file', '.webp': 'file' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  server = createServer((req, res) => {
    const file = req.url.split('?')[0];
    if (file === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(path.join(scratch, 'bundle.js'))); return; }
    if (file.endsWith('.png')) { res.setHeader('Content-Type', 'image/png'); res.end(readFileSync(path.join(here, path.basename(file)))); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><style>${forestCss}</style><style>html,body{margin:0;background:#101418}#globe{width:100vw;height:100vh}</style><div id="globe"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const open = async (query, options = {}) => {
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, ...options });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}/?${query}`);
    await page.waitForFunction(() => window.shopProof?.draws() > 0, null, { timeout: 120_000 });
    return { page, context };
  };
  for (const shot of SHOTS) {
    const { page, context } = await open(shot.query);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(here, shot.file) });
    await context.close();
  }
  const strip = await browser.newPage({ viewport: { width: 1800, height: 420 }, deviceScaleFactor: 1 });
  await strip.goto(`${url}/blank`);
  await strip.setContent(`<body style="margin:0;background:#101418;font:14px sans-serif;color:#d8dde3;display:flex;flex-wrap:wrap;gap:4px;padding:4px">${
    SHOTS.map(s => `<figure style="margin:0;width:352px"><img src="${url}/${s.file}" style="width:352px;display:block"><figcaption>${s.caption}</figcaption></figure>`).join('')}</body>`);
  await strip.waitForLoadState('networkidle');
  await strip.screenshot({ path: path.join(here, 'shop-health-strip.png'), fullPage: true });
  await strip.close();
  const clip = await open('play=1&seconds=15', { recordVideo: { dir: scratch, size: { width: 960, height: 600 } } });
  await clip.page.waitForTimeout(16_500);
  await clip.context.close();
  renameSync(await clip.page.video().path(), path.join(here, 'shop-health-growth.webm'));
  if (errors.length) throw new Error(`the page reported errors:\n${errors.join('\n')}`);
  console.log(`Saved ${SHOTS.length} pictures, the strip and the clip in ${path.relative(process.cwd(), here)}.`);
} finally {
  await browser?.close();
  server?.close();
}
