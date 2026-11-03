// Takes round 13's stills from the built page (run build.mjs first) in the desktop capture kit's Chromium, at a 1440 x 900
// window: at rest on the chosen arrangement; round 12's island (round 11's arrangement, each link its own entrance) beside
// it; the knot round Library API close up on both; a link lit; a shared entrance clicked; the queue by a wrench (with
// `?queue=demo`, marked made up) clicked; and a second angle. Each click is a real click where the mark stands, and the
// panel's heading it opens is checked; shots.json records the clicks, each page's counts and crowding, and that the pages
// logged no errors.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/m-height/tools/shots.mjs [--retake]
// Without --retake the stills go to the kit's scratch folder; with it, into stills/.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const VIEW = { width: 1440, height: 900 };
/** Round 12's island on this page: round 11's arrangement, every link its own entrance, no price near the coast. */
const ROUND12 = '?layout=r11&net={"shareEntrance":0,"edge":0}';
await withCapture({ folder: path.join(dist, 'stills'), dist }, async ({ browser, origin, out, settle }) => {
  const report = { clicks: [], pages: {} }, errors = [];
  const open = async query => {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: 'dark' });
    page.on('pageerror', e => errors.push(String(e.stack ?? e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${origin}/index.html${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180000 }).catch(e => { console.error(errors); throw e; });
    for (let k = 0; k < 200 && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
    await settle(page, 12);
    report.pages[query || 'chosen'] ??= await page.evaluate(() => window.mock.layer.stats);
    return page;
  };
  const shot = async (page, name) => { await settle(page, 8); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.error(`took ${name}.png`); };
  const wheel = async (page, at, clicks) => { await page.mouse.move(at.x, at.y); for (let k = 0; k < Math.abs(clicks); k++) { await page.mouse.wheel(0, clicks > 0 ? -300 : 300); await settle(page, 2); } };
  /** Drags the map so `at` sits at the map's middle. */
  const centre = async (page, at) => { await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(544, 450, { steps: 16 }); await page.mouse.up(); await settle(page, 6); };
  const idOf = (page, title) => page.evaluate(t => [...window.mock.layer.links.values()].flatMap(l => [[l.from, l.fromTitle], [l.to, l.toTitle]]).find(([, x]) => x === t)?.[0], title);
  const town = async (page, title) => { const id = await idOf(page, title); return id && page.evaluate(i => window.mock.layer.point('town', i), id); };
  const click = async (page, at, kind, mark, want) => {
    await page.mouse.click(at.x, at.y); await settle(page, 4);
    const heading = (await page.locator('.mock-picked h3').first().textContent()).trim();
    report.clicks.push({ kind, mark, at: { x: Math.round(at.x), y: Math.round(at.y) }, heading });
    assert.match(heading, want);
  };
  /** The knot round Library API close up. */
  const knot = async page => { await centre(page, await town(page, '7 · Library API')); await wheel(page, { x: 544, y: 450 }, 10); };

  // 1. At rest on the chosen arrangement, and round 12's island on the same page.
  const page = await open('');
  await shot(page, 'resting');
  const before = await open(ROUND12);
  await shot(before, 'resting-round12');
  // 2. The knot close up, before (round 12) and after.
  await knot(before);
  await shot(before, 'knot-before');
  await before.close();
  await knot(page);
  await shot(page, 'knot-after');
  // 3. A link lit: Rounds calls Library API, clicked at its entrance gate (or the shared gate it enters by).
  const lit = await page.evaluate(() => {
    const l = [...window.mock.layer.links.values()].find(x => x.fromTitle === '26 · Rounds' && x.toTitle === '7 · Library API');
    return l && { key: l.key, at: window.mock.layer.point('gate', l.key) };
  });
  if (lit?.at) { await page.evaluate(k => window.mock.pick('link', k), lit.key); await settle(page, 4); report.clicks.push({ kind: 'link', mark: lit.key, picked: true }); await shot(page, 'link-lit'); }
  // 4. A shared entrance clicked where it stands: the panel lists the links that enter by it.
  const shared = await page.evaluate(() => { for (let i = 0; i < 40; i++) { const at = window.mock.layer.point('gate', `gate:${i}`); if (at && at.x > 40 && at.x < 1040 && at.y > 40 && at.y < 860) { const hit = window.mock.layer.pick(at.x, at.y); if (hit?.kind === 'road' && hit.id === `gate:${i}`) return { i, at }; } } return undefined; });
  if (shared) { await click(page, shared.at, 'shared entrance', `gate:${shared.i}`, /links enter by/); await shot(page, 'gate-shared'); }
  await page.close();
  // 5. The queue by a wrench, made up for the still (?queue=demo): Library API's wrench clicked.
  const queued = await open('?queue=demo');
  const api = await idOf(queued, '7 · Library API');
  await centre(queued, await town(queued, '7 · Library API'));
  await wheel(queued, { x: 544, y: 450 }, 7);
  const wrench = await queued.evaluate(i => window.mock.layer.point('wrench', i), api);
  if (wrench) { await click(queued, wrench, 'wrench', '7 · Library API', /Library API/); await shot(queued, 'queue'); }
  await queued.close();
  // 6. A second angle: turned by a right-drag, tipped nearer level.
  const turned = await open('');
  await turned.mouse.move(540, 600); await turned.mouse.down({ button: 'right' });
  await turned.mouse.move(360, 600, { steps: 16 }); await turned.mouse.up({ button: 'right' });
  await settle(turned, 6);
  for (let k = 0; k < 2; k++) { await turned.keyboard.press('f'); await settle(turned, 2); }
  await shot(turned, 'orbited');
  await turned.close();
  // Round 12's island beside round 13's, and the knot before and after, side by side.
  const img = file => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  const pair = async (name, a, b, crop) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 520 }, deviceScaleFactor: 1 });
    await p.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 14px system-ui;display:flex;gap:10px;padding:10px">
      ${[a, b].map(([f, t]) => `<figure style="margin:0"><div style="width:705px;height:470px;overflow:hidden"><img src="${img(path.join(out, f))}" style="width:1440px;transform:scale(${crop.scale});transform-origin:${crop.origin}"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
    await p.screenshot({ path: path.join(out, `${name}.png`) });
    await p.close();
  };
  await pair('side-by-side', ['resting-round12.png', "Round 12: round 11's arrangement, each link its own entrance"], ['resting.png', 'Round 13: a minimum size, a network-scored layout, shared entrances'], { scale: 0.64, origin: '-40px -110px' });
  await pair('knot-side-by-side', ['knot-before.png', 'Round 12, round Library API'], ['knot-after.png', 'Round 13, round Library API'], { scale: 0.8, origin: '-120px -200px' });
  report.errors = errors;
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
});
