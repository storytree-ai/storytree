// Rollout 1: the measures table per island for the README, from two captures' measures (islands.mjs), biggest island first.
// Run from the checkout root: node docs/design/capability-tree-3d/q-all-islands/tools/table.mjs before after
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const [a = 'before', b = 'after'] = process.argv.slice(2);
const read = t => JSON.parse(readFileSync(path.join(dist, 'stills', 'islands', `${t}.measures.json`), 'utf8'));
const A = read(a), B = read(b);
const survey = JSON.parse(readFileSync(path.join(dist, 'survey.json'), 'utf8')).sort((x, y) => y.land - x.land);
const cell = m => !m ? 'not laid out' : !m.island ? 'no roads drawn' : `${m.island.overlaps} / ${m.island.within4px}`;
const busy = m => m?.island ? `${m.busy.overlaps} / ${m.busy.within4px}` : '';
const num = (m, k) => m?.island ? String(k === 'unplaced' ? m.unplaced.length : m[k]) : '';
console.log(`| Island (capabilities, links inside, lanes) | Overlapping / within 4 px, ${a} | ${b} | Busiest part, ${a} | ${b} | Gates | Road drawn | Over a third | Road on the edge | Links not placed |`);
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const s of survey) {
  const x = A[s.story], y = B[s.story], pair = k => `${num(x, k) || '–'} → ${num(y, k) || '–'}`;
  console.log(`| ${s.title} (${s.capabilities}, ${s.inside}, ${s.arriving + s.leaving}) | ${cell(x)} | ${cell(y)} | ${busy(x)} | ${busy(y)} | ${pair('gates')} | ${pair('roadDrawn')} | ${pair('overThird')} | ${pair('roadOnEdge')} | ${pair('unplaced')} |`);
}
