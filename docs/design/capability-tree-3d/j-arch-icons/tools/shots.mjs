// Takes round 12's stills from the built page (run build.mjs first) in the desktop capture kit's Chromium, at a 1440 x 900
// window: at rest, round 11's discs on the same page (?icons=disc) beside it, close up round Library API and round the
// knowledge's corner, a settlement clicked, and a second angle. Each click is a real click where the mark stands, and the
// panel's heading it opens is checked; shots.json records the clicks, the layer's counts and that the page logged no errors.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/j-arch-icons/tools/shots.mjs [--retake]
// Without --retake the stills go to the kit's scratch folder; with it, into stills/.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const VIEW = { width: 1440, height: 900 };
await withCapture({ folder: path.join(dist, 'stills'), dist }, async ({ browser, origin, out, settle }) => {
  const report = { clicks: [] }, errors = [];
  const open = async query => {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: 'dark' });
    page.on('pageerror', e => errors.push(String(e.stack ?? e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${origin}/index.html${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 }).catch(e => { console.error(errors); throw e; });
    for (let k = 0; k < 200 && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
    await settle(page, 12);
    return page;
  };
  const shot = async (page, name) => { await settle(page, 8); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.error(`took ${name}.png`); };
  const wheel = async (page, at, clicks) => { await page.mouse.move(at.x, at.y); for (let k = 0; k < Math.abs(clicks); k++) { await page.mouse.wheel(0, clicks > 0 ? -300 : 300); await settle(page, 2); } };
  /** Drags the map so `at` sits at the map's middle. */
  const centre = async (page, at) => { await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(544, 450, { steps: 16 }); await page.mouse.up(); await settle(page, 6); };
  const town = (page, title) => page.evaluate(t => {
    const id = [...window.mock.layer.links.values()].flatMap(l => [[l.from, l.fromTitle], [l.to, l.toTitle]]).find(([, x]) => x === t)?.[0];
    return id && window.mock.layer.point('town', id);
  }, title);

  // 1. At rest, The library selected; and round 11's discs on the same page.
  const page = await open('');
  report.layer = await page.evaluate(() => window.mock.layer.stats);
  await shot(page, 'resting');
  const disc = await open('?icons=disc');
  await shot(disc, 'resting-disc');
  await disc.close();
  // 2. Close up round Library API, then a settlement clicked: the panel names its kind.
  const api = await town(page, '7 · Library API');
  await centre(page, api);
  await wheel(page, { x: 544, y: 450 }, 10);
  await shot(page, 'api-close');
  const store = await town(page, '6 · Knowledge artifacts');
  if (store) {
    await page.mouse.click(store.x, store.y); await settle(page, 4);
    const shown = (await page.locator('.mock-picked h3').first().textContent()).trim(), facts = (await page.locator('.mock-facts').first().textContent()).trim();
    report.clicks.push({ kind: 'town', mark: '6 · Knowledge artifacts', at: { x: Math.round(store.x), y: Math.round(store.y) }, heading: shown, facts });
    assert.match(shown, /Knowledge artifacts/); assert.match(facts, /store/);
    await shot(page, 'town-picked');
  }
  await page.close();
  // 3. Close up round the knowledge's corner (Links, Catalogue, Graduation, Decision log, Lapsed questions), where they crowd.
  const corner = await open('');
  const links = await town(corner, '21 · Links');
  await centre(corner, links);
  await wheel(corner, { x: 544, y: 450 }, 12);
  await shot(corner, 'knowledge-close');
  await corner.close();
  // 4. A second angle: turned by a right-drag, tipped nearer level, then closer.
  const turned = await open('');
  await turned.mouse.move(540, 600); await turned.mouse.down({ button: 'right' });
  await turned.mouse.move(360, 600, { steps: 16 }); await turned.mouse.up({ button: 'right' });
  await settle(turned, 6);
  for (let k = 0; k < 2; k++) { await turned.keyboard.press('f'); await settle(turned, 2); }
  await shot(turned, 'orbited');
  await wheel(turned, { x: 544, y: 450 }, 8);
  await shot(turned, 'orbited-close');
  await turned.close();
  // Round 11's settlements beside round 12's, at rest.
  const pair = await browser.newPage({ viewport: { width: 1440, height: 520 }, deviceScaleFactor: 1 });
  const img = file => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  await pair.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 14px system-ui;display:flex;gap:10px;padding:10px">
    ${[[path.join(out, 'resting-disc.png'), "Round 11's settlements: paper discs"], [path.join(out, 'resting.png'), 'Round 12: each settlement the symbol for its kind']].map(([f, t]) =>
      `<figure style="margin:0"><div style="width:705px;height:470px;overflow:hidden"><img src="${img(f)}" style="width:1440px;transform:scale(0.64);transform-origin:-40px -110px"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
  await pair.screenshot({ path: path.join(out, 'side-by-side.png') });
  await pair.close();
  report.errors = errors;
  writeFileSync(path.join(out, 'shots.json'), JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(report.errors, []);
});
