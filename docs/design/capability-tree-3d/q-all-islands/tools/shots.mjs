// Polish round 1's stills and measures from the built page (run build.mjs first), in the desktop capture kit's Chromium at
// a 1440 x 900 window: at rest (the whole island), the mouth close, Keys' landfall close, the knot round Library API close,
// a link lit (Rounds calls Library API), and a second angle. With the stills, the page's counts at rest (round 13's
// measures: overlapping marks across the island and in the knot, road drawn, links over a third territory, road on the
// coast's edge) go to stills/<tag>.measures.json, with any errors the page logged.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/shots.mjs <tag> [query]
// The stills are stills/<tag>-<view>.png; `sheet.mjs` lays a before and an after side by side.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
// Flags (the capture kit's --retake) are not the query, wherever they stand.
const [tag = 'look', query = ''] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const VIEW = { width: 1440, height: 900 };
await withCapture({ folder: path.join(dist, 'stills'), dist }, async ({ browser, origin, out, settle }) => {
  const errors = [];
  const open = async () => {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: 'dark' });
    page.on('pageerror', e => errors.push(String(e.stack ?? e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${origin}/index.html${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180000 }).catch(e => { console.error(errors); throw e; });
    for (let k = 0; k < 200 && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
    await settle(page, 12);
    return page;
  };
  const shot = async (page, view) => { await settle(page, 8); await page.screenshot({ path: path.join(out, `${tag}-${view}.png`) }); console.error(`took ${tag}-${view}.png`); };
  const wheel = async (page, at, clicks) => { await page.mouse.move(at.x, at.y); for (let k = 0; k < Math.abs(clicks); k++) { await page.mouse.wheel(0, clicks > 0 ? -300 : 300); await settle(page, 2); } };
  /** Drags the map so `at` sits at the map's middle. */
  const centre = async (page, at) => { await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(544, 450, { steps: 16 }); await page.mouse.up(); await settle(page, 6); };
  const idOf = (page, title) => page.evaluate(t => [...window.mock.layer.links.values()].flatMap(l => [[l.from, l.fromTitle], [l.to, l.toTitle]]).find(([, x]) => x === t)?.[0], title);
  const close = async (page, kind, id, clicks) => { await centre(page, await page.evaluate(([k, i]) => window.mock.layer.point(k, i), [kind, id])); await wheel(page, { x: 544, y: 450 }, clicks); };

  // At rest: the whole island, and the measures.
  let page = await open();
  const measures = await page.evaluate(() => { const st = window.mock.layer.stats; return { roadDrawn: st.roadDrawn, roadOnEdge: st.roadOnEdge, segments: st.segments, gates: st.gates, overThird: st.overThird.length, crowding: window.mock.layer.crowding() }; });
  await shot(page, 'rest');
  // The mouth close, Keys' landfall close, the knot close.
  await close(page, 'mouth', '', 10); await shot(page, 'mouth'); await page.close();
  page = await open(); await close(page, 'keys', '', 10); await shot(page, 'keys'); await page.close();
  page = await open(); await close(page, 'town', await idOf(page, '7 · Library API'), 10); await shot(page, 'knot');
  // A link lit: Rounds calls Library API, picked through the page's own mock.pick (its gate is shared).
  const lit = await page.evaluate(() => [...window.mock.layer.links.values()].find(x => x.fromTitle === '26 · Rounds' && x.toTitle === '7 · Library API')?.key);
  assert.ok(lit, 'Rounds calls Library API');
  await page.evaluate(k => window.mock.pick('link', k), lit); await settle(page, 4);
  await shot(page, 'link-lit'); await page.close();
  // A second angle: turned by a right-drag, tipped nearer level.
  page = await open();
  await page.mouse.move(540, 600); await page.mouse.down({ button: 'right' });
  await page.mouse.move(360, 600, { steps: 16 }); await page.mouse.up({ button: 'right' });
  await settle(page, 6);
  for (let k = 0; k < 2; k++) { await page.keyboard.press('f'); await settle(page, 2); }
  await shot(page, 'orbited'); await page.close();
  writeFileSync(path.join(out, `${tag}.measures.json`), JSON.stringify({ query, ...measures, errors }, null, 1) + '\n');
  console.log(JSON.stringify({ ...measures, crowding: { ...measures.crowding, pairs: undefined } }));
  assert.deepEqual(errors, []);
});
