// Rollout 1's contact sheet: every island's still from islands.mjs, the map's side of each cropped, in a grid with its name
// and its measures under it. With two tags, each island's two stills stand side by side (before, after).
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/contact.mjs <name> <tag> [tag2] [--view busy] [--retake]
// It writes stills/<name>.png (and, past ROWS rows, stills/<name>-2.png and so on).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here), islands = path.join(dist, 'stills', 'islands');
const argv = process.argv.slice(2), viewAt = argv.indexOf('--view'), view = viewAt >= 0 ? argv.splice(viewAt, 2)[1] : 'rest';
const [name, ...tags] = argv.filter(a => !a.startsWith('--'));
const data = JSON.parse(readFileSync(path.join(dist, 'data.json'), 'utf8'));
const measures = tags.map(t => JSON.parse(readFileSync(path.join(islands, `${t}.measures.json`), 'utf8')));
// Biggest island first, as the survey sizes them.
const survey = JSON.parse(readFileSync(path.join(dist, 'survey.json'), 'utf8'));
// An island a tag has no still of (its rules laid out no arrangement there, or its page never drew) shows the map's own
// still (stills/today/, from docks.mjs) with the reason.
const shotOf = (t, id) => { const own = path.join(islands, t, `${id}-${view}.png`); return existsSync(own) ? own : view === 'rest' ? path.join(dist, 'stills', 'today', `${id}.png`) : undefined; };
const ids = survey.sort((a, b) => b.land - a.land).map(r => r.story).filter(id => tags.some(t => existsSync(path.join(islands, t, `${id}-${view}.png`))) && tags.every(t => shotOf(t, id) && existsSync(shotOf(t, id))));
const CELL = tags.length > 1 ? 340 : 270, PER_ROW = tags.length > 1 ? 2 : 4, ROWS = Number(process.env.ROWS ?? 8);
const NONE = 'no arrangement routes every link (no border long enough for a gate); the map as it draws the island';
const caption = (m, label) => !m || !m.island ? `${label ? `<b>${label}</b> · ` : ''}${m?.errors?.length ? `the page drew no roads: ${m.errors[0].replace(/capability_\w+/g, 'a capability').slice(0, 90)}` : NONE}` : `${label ? `<b>${label}</b> · ` : ''}${m.island.overlaps} overlapping (${m.busy.overlaps} busiest), ${m.island.within4px} within 4 px · ${m.gates} gates · road ${m.roadDrawn} · over a third ${m.overThird} · edge ${m.roadOnEdge}${m.unplaced.length ? ` · ${m.unplaced.length} unplaced` : ''}`;
await withCapture({ folder: path.join(dist, 'stills'), dist }, async ({ browser, out }) => {
  const img = file => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  for (let page = 0; page * ROWS * PER_ROW < ids.length; page++) {
    const chunk = ids.slice(page * ROWS * PER_ROW, (page + 1) * ROWS * PER_ROW);
    const cells = chunk.map(id => {
      const shots = tags.map((t, k) => `<figure><div class="crop"><img src="${img(shotOf(t, id))}"></div><figcaption>${caption(measures[k][id], tags.length > 1 ? t : '')}</figcaption></figure>`).join('');
      return `<section><h3>${data.stories[id].story.title}</h3><div class="pair">${shots}</div></section>`;
    }).join('');
    const p = await browser.newPage({ viewport: { width: PER_ROW * (tags.length * (CELL + 8) + 16) + 16, height: 400 }, deviceScaleFactor: 1 });
    await p.setContent(`<style>
      body { margin: 0; padding: 8px; background: #0e1418; color: #e8eef0; font: 12px system-ui; display: grid; grid-template-columns: repeat(${PER_ROW}, auto); gap: 8px; justify-content: start; }
      section { padding: 4px 8px 8px; background: #141c21; border-radius: 6px; } h3 { margin: 2px 0 6px; font-size: 14px; }
      .pair { display: flex; gap: 8px; } figure { margin: 0; width: ${CELL}px; }
      .crop { width: ${CELL}px; height: ${Math.round(CELL * 810 / 1088)}px; overflow: hidden; }
      .crop img { width: ${Math.round(CELL * 1440 / 1088)}px; transform: translateY(-${Math.round(CELL * 90 / 1088)}px); }
      figcaption { padding-top: 4px; line-height: 1.35; color: #b8c4c8; } b { color: #fff; }
    </style>${cells}`);
    const file = path.join(out, `${name}${page ? `-${page + 1}` : ''}.png`);
    await p.screenshot({ path: file, fullPage: true });
    await p.close();
    console.error(file);
  }
});
