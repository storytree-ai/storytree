// Times, on storytree's own globe (../derived-roads' seed and survey, 2026-10-11), the pathway build
// (`planetPathwayDrawing`, cold and on a one-island change) and the lit lanes of The library and The app setup
// (`laneRoutes`, with each checkout's way inland where it has one), as the desktop page lays them out. One measurement
// per process, so "cold" starts with every routing cache empty. Run from the repository root:
// tsx packages/forest/src/view/evidence/lanes-inland/measure.mts <checkout> [runs]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SELECTED = ['The library', 'The app setup'];

async function once(checkout: string) {
  const { workStates } = await import(path.join(checkout, 'packages/arc-surface/src/index.ts'));
  const world = await import(path.join(checkout, 'packages/forest-world/src/geometry.ts'));
  const { forestScene, storyNodes, selectionLanes } = await import(path.join(checkout, 'packages/forest/src/index.ts'));
  const { planetLayout } = await import(path.join(checkout, 'packages/forest/src/view/planet-navigation.ts'));
  const ways = await import(path.join(checkout, 'packages/forest/src/view/border-route.ts')).catch(() => undefined);
  const { islandTerritories } = await import(path.join(checkout, 'packages/forest/src/territories/territories.ts'));
  const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, '../derived-roads/seed.json.gz'))).toString('utf8'));
  const survey = JSON.parse(readFileSync(path.join(here, '../derived-roads/survey.json'), 'utf8'));
  const history = seed.changes.changes;
  const places = new Map(storyNodes(seed.tree, history, survey).map((s: { id: string; place: unknown }) => [s.id, s.place]));
  const scene = forestScene(seed.tree, history, workStates([]), survey);
  const layout = planetLayout(scene, places);
  let at = performance.now();
  const cold = world.planetPathwayDrawing(layout.scene, layout.spots, layout.radius);
  const coldMs = performance.now() - at;
  // One capability on the first story turns healthy; the page hands on every other island as the object on show.
  const story = seed.tree.stories[0].id;
  const tree = { ...seed.tree, stories: seed.tree.stories.map((s: { id: string; capabilities: { status: string }[] }) => s.id !== story ? s
    : { ...s, capabilities: s.capabilities.map((c, i) => i === 0 ? { ...c, proposed: false, status: c.status === 'healthy' ? 'failing' : 'healthy' } : c) }) };
  const changed = forestScene(tree, history, workStates([]), survey);
  const next = { ...changed, islands: changed.islands.map((island: { key: string }) => scene.islands.find((old: { key: string }) => old.key === island.key) ?? island) };
  const nextLayout = planetLayout(next, places, layout);
  at = performance.now();
  world.planetPathwayDrawing(nextLayout.scene, nextLayout.spots, nextLayout.radius);
  const changeMs = performance.now() - at;
  // The page has cut each island into territories to draw them before anything is selected.
  for (const island of layout.scene.islands) if (island.land !== undefined) islandTerritories?.(island.land.territories, world.islandCoast(island));
  const lanes = Object.fromEntries(SELECTED.map(title => {
    const id = seed.tree.stories.find((s: { title: string }) => s.title === title).id;
    const lit = selectionLanes(layout.scene, id);
    at = performance.now();
    // As the globe does it (PlanetWorldCanvas): a fresh set of ways for the layout, each island's territories cut once.
    const host = ways?.laneWays(layout.scene.islands);
    const inland = host && ((dock: { story: string; local: unknown }, capability: string) => {
      const way = host(dock.story, capability, dock.local);
      return way && way.length > 1 ? world.onIsland(way, layout.spots.get(dock.story), layout.radius) : undefined;
    });
    const routes = world.laneRoutes(cold.plan, lit, inland);
    const ms = performance.now() - at;
    return [title, { ms, lanes: routes.length, typeOnly: routes.filter((r: { typeOnly?: true }) => r.typeOnly).length }];
  }));
  return { coldMs, changeMs, routedLinks: cold.plan.edges.length, segments: cold.plan.segments.length,
    // Roads carrying a type-only link, and of those, roads only type-only links use.
    typedSegments: cold.plan.segments.filter((s: { typeOnlyLinks?: number }) => s.typeOnlyLinks).length,
    typeOnlySegments: cold.plan.segments.filter((s: { links: string[]; typeOnlyLinks?: number }) => s.typeOnlyLinks === s.links.length).length, issue: cold.issue, lanes };
}

const [, , checkout, runsArg] = process.argv;
if (checkout === undefined) throw new Error('pass <checkout> [runs]');
if (runsArg === 'once') console.log(JSON.stringify(await once(path.resolve(checkout))));
else {
  const runs = Number(runsArg ?? 5);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const results = Array.from({ length: runs }, () => JSON.parse(execFileSync(process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), checkout, 'once'], { encoding: 'utf8' })));
  const first = results[0];
  console.log(JSON.stringify({ checkout, runs, coldMs: +median(results.map(r => r.coldMs)).toFixed(0),
    changeMs: +median(results.map(r => r.changeMs)).toFixed(0), routedLinks: first.routedLinks, segments: first.segments,
    typedSegments: first.typedSegments, typeOnlySegments: first.typeOnlySegments, issue: first.issue,
    lanes: Object.fromEntries(SELECTED.map(title => [title, { ...first.lanes[title], ms: +median(results.map(r => r.lanes[title].ms)).toFixed(1) }])) }));
}
