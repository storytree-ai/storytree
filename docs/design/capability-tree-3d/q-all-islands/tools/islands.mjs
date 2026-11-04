// Rollout 1's check: for every story's island (each with an arrangement in layouts/), the built page at rest and a close-up
// of its busiest part (the settlement most links meet at, `stats.hub`, centred and zoomed in), with round 13's measures at
// rest as polish round 3's shots.mjs took them: marks overlapping and within 4 px across the island and in the busiest
// part, gates, road drawn, inside links over a third territory, road on the coast's edge; and what the layer could not
// place. The stills are stills/islands/<tag>/<story>-rest.png and -busy.png, the measures stills/islands/<tag>.measures.json.
// Run from the checkout root (build.mjs first): node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/islands.mjs <tag> [query] [story ...] [--retake]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const [tag = 'look', query = ''] = args, asked = args.slice(2);
const data = JSON.parse(readFileSync(path.join(dist, 'data.json'), 'utf8'));
// `{id}` in the query stands for each story's id (`?layout={id}.before` draws each island's before arrangement).
const layoutOf = id => new URLSearchParams(query.replaceAll('{id}', id)).get('layout') ?? id;
const ids = (asked.length ? asked : Object.keys(data.stories)).filter(id => existsSync(path.join(dist, 'layouts', `${layoutOf(id)}.json`)));
const VIEW = { width: 1440, height: 900 };
const file = path.join(dist, 'stills', 'islands', `${tag}.measures.json`);
mkdirSync(path.dirname(file), { recursive: true });
const rows = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
// PAGE=<folder> serves a built page kept elsewhere (a copy of an earlier build), with this folder's data and stills.
await withCapture({ folder: path.join(dist, 'stills', 'islands', tag), dist: process.env.PAGE ?? dist }, async ({ browser, origin, out, settle }) => {
  for (const id of ids) {
    const errors = [];
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: 'dark' });
    page.on('pageerror', e => errors.push(String(e.stack ?? e).split('\n')[0]));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().split('\n')[0]); });
    const q = `?story=${id}${query ? `&${query.replace(/^\?/, '').replaceAll('{id}', id)}` : ''}`;
    await page.goto(`${origin}/index.html${q}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const ready = await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 180000 }).then(() => true, () => false);
    if (!ready) { rows[id] = { story: data.stories[id].story.title, errors }; console.log(`${data.stories[id].story.title}: never ready ${errors.join('; ')}`); await page.close(); continue; }
    for (let k = 0; k < 200 && await page.evaluate(() => document.body.dataset.framed) !== 'yes'; k++) await settle(page, 3);
    await settle(page, 12);
    const m = await page.evaluate(() => {
      const st = window.mock.layer.stats, c = st.crowding;
      return { roadDrawn: st.roadDrawn, roadOnEdge: st.roadOnEdge, gates: st.gates, gatesOnOpenLand: st.gatesOnOpenLand, overThird: st.overThird.length, inside: st.inside, ways: st.ways,
        unplaced: st.unplaced, noEntrance: st.noEntrance.length, hub: st.hub, busiest: st.busiest,
        island: { overlaps: c.island.overlaps, within4px: c.island.within4px, byKind: c.island.byKind, pairs: c.island.pairs },
        busy: { overlaps: c.knot.overlaps, within4px: c.knot.within4px },
        ...(st.crowdingRound13Knot ? { round13Knot: { overlaps: st.crowdingRound13Knot.knot.overlaps, within4px: st.crowdingRound13Knot.knot.within4px } } : {}),
        ports: st.ports };
    });
    await page.screenshot({ path: path.join(out, `${id}-rest.png`) });
    // The busiest part, close: its settlement dragged to the map's middle, then the wheel turned in.
    const hub = await page.evaluate(() => { const st = window.mock.layer.stats, t = st.towns.find(x => x.capability === st.hub); return t && [...window.mock.layer.links.values()].flatMap(l => [[l.from, l.fromTitle], [l.to, l.toTitle]]).find(([, x]) => x === st.hub)?.[0]; });
    if (hub) {
      const at = await page.evaluate(i => window.mock.layer.point('town', i), hub);
      await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(544, 450, { steps: 16 }); await page.mouse.up(); await settle(page, 6);
      await page.mouse.move(544, 450); for (let k = 0; k < Number(process.env.ZOOM ?? 10); k++) { await page.mouse.wheel(0, -300); await settle(page, 2); }
      await settle(page, 8);
      await page.screenshot({ path: path.join(out, `${id}-busy.png`) });
    }
    rows[id] = { story: data.stories[id].story.title, query: q, ...m, errors };
    console.log(`${data.stories[id].story.title}: ${m.island.overlaps} overlapping (${m.busy.overlaps} busiest), ${m.island.within4px} within 4px, ${m.gates} gates, road ${m.roadDrawn}, over a third ${m.overThird}, edge ${m.roadOnEdge}, unplaced ${m.unplaced.length}${errors.length ? `, errors ${errors.length}` : ''}`);
    await page.close();
    writeFileSync(file, JSON.stringify(rows, null, 1) + '\n');
  }
});
