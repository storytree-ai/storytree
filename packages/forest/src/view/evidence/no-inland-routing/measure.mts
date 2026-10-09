// Times `planetPathwayDrawing` on two saved scenes, cold and on a one-island change, as the desktop page lays them out.
// One measurement per process, so "cold" starts with every routing cache empty. Run from the repository root:
// tsx packages/forest/src/view/evidence/no-inland-routing/measure.mts [runs]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workStates } from '@storytree/arc-surface';
import { planetPathwayDrawing } from '@storytree/forest-world/geometry';
import { forestScene, storyNodes } from '../../../index.js';
import { planetLayout } from '../../planet-navigation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCENES = {
  // The saved desktop fixture: 15 stories, 131 links, with its code survey's territories.
  desktop: { seed: '../code-rows/seed.json.gz', survey: '../code-rows/survey.json' },
  // storytree's own plan on 2026-10-09: 20 stories, 115 capabilities, no survey.
  own: { seed: '../lanes-at-the-coast/seed.json.gz' },
} as const;

function once(name: keyof typeof SCENES) {
  const { seed: file, ...rest } = SCENES[name];
  const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, file))).toString('utf8'));
  const survey = 'survey' in rest ? JSON.parse(readFileSync(path.join(here, rest.survey as string), 'utf8')) : {};
  const history = seed.changes.changes;
  const places = new Map(storyNodes(seed.tree, history).map(s => [s.id, s.place]));
  const scene = forestScene(seed.tree, history, workStates([]), survey);
  const layout = planetLayout(scene, places);
  let at = performance.now();
  const cold = planetPathwayDrawing(layout.scene, layout.spots, layout.radius);
  const coldMs = performance.now() - at;
  // One capability on the first story turns healthy; the page hands on every other island as the object on show.
  const story = seed.tree.stories[0].id;
  const tree = { ...seed.tree, stories: seed.tree.stories.map((s: { id: string; capabilities: { status: string }[] }) => s.id !== story ? s
    : { ...s, capabilities: s.capabilities.map((c, i) => i === 0 ? { ...c, proposed: false, status: c.status === 'healthy' ? 'failing' : 'healthy' } : c) }) };
  const changed = forestScene(tree, history, workStates([]), survey);
  const next = { ...changed, islands: changed.islands.map(island => scene.islands.find(old => old.key === island.key) ?? island) };
  const nextLayout = planetLayout(next, places, layout);
  at = performance.now();
  planetPathwayDrawing(nextLayout.scene, nextLayout.spots, nextLayout.radius);
  const changeMs = performance.now() - at;
  return { coldMs, changeMs, routedLinks: cold.plan.edges.length, segments: cold.plan.segments.length, issue: cold.issue };
}

const [, , only] = process.argv;
if (only === 'desktop' || only === 'own') console.log(JSON.stringify(once(only)));
else {
  const runs = Number(only ?? 5);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  for (const name of Object.keys(SCENES)) {
    const results = Array.from({ length: runs }, () => JSON.parse(execFileSync(process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), name], { encoding: 'utf8' })));
    console.log(JSON.stringify({ scene: name, runs, coldMs: +median(results.map(r => r.coldMs)).toFixed(0),
      changeMs: +median(results.map(r => r.changeMs)).toFixed(0), routedLinks: results[0].routedLinks, segments: results[0].segments, issue: results[0].issue }));
  }
}
