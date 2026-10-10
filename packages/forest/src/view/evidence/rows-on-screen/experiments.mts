// What each way of making the rows read would cost, on measure.mts's seed and survey: the same layout code with one
// constant changed at a time (a patched copy of island-growth.ts, written beside this file and removed again), and the
// rows ranked by the plan's dependencies instead of the code's. Also the fewest islands each turning limit leaves
// readable. Writes experiments.json. Run after measure.mts: node --import tsx experiments.mts
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workStates } from '@storytree/arc-surface';
import { islandCoastReach } from '@storytree/forest-world/geometry';
import { forestScene, storyNodes } from '../../../index.js';
import { rowOf } from '../../../planet-places/planet-places.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));
const { tree } = seed, changes = seed.changes.changes;
const scene = forestScene(tree, changes, workStates([]), survey);
const title = new Map<string, string>(tree.stories.map((s: any) => [s.id, s.title]));
const reach = new Map(scene.islands.map(i => [i.story, islandCoastReach(i)]));
const land = scene.islands.reduce((sum, i) => sum + (i.area ?? 0), 0);
const known = new Set(tree.stories.map((s: any) => s.id));
const owner = new Map<string, string>(tree.stories.flatMap((s: any) => s.capabilities.map((c: any) => [c.id, s.id])));
const planEdges: { from: string; on: string }[] = [...new Map((scene.links ?? []).flatMap(l => { const from = owner.get(l.from), on = owner.get(l.to); return from && on && from !== on ? [[`${from}>${on}`, { from, on }] as const] : []; })).values()];
// The dependencies the rows are built from, as measure.mts reads them: the code's package edges, the plan's for a story with no surveyed package.
const codeEdges: { from: string; on: string }[] = tree.stories.flatMap((s: any) => (survey[s.id]?.dependsOn?.filter((o: string) => known.has(o) && o !== s.id) ?? planEdges.filter(e => e.from === s.id).map(e => e.on)).map((on: string) => ({ from: s.id, on })));

/** growPlanet with constants replaced in a copy of the layout's source. */
async function variant(name: string, replace: [RegExp, string][]) {
  let source = readFileSync(path.join(here, '../../../planet-places/island-growth.ts'), 'utf8').replace('"./planet-places.js"', '"../../../planet-places/planet-places.js"');
  let places = readFileSync(path.join(here, '../../../planet-places/planet-places.ts'), 'utf8');
  for (const [from, to] of replace) {
    if (from.test(source)) source = source.replace(from, to);
    else if (from.test(places)) places = places.replace(from, to);
    else throw new Error(`${name}: nothing matches ${from}`);
  }
  const placesFile = path.join(here, `.variant-${name}-places.ts`), file = path.join(here, `.variant-${name}.ts`);
  writeFileSync(placesFile, places);
  writeFileSync(file, source.replace('"../../../planet-places/planet-places.js"', `"./.variant-${name}-places.js"`));
  try { return await import(pathToFileURL(file).href) as typeof import('../../../planet-places/island-growth.js'); }
  finally { rmSync(file); rmSync(placesFile); }
}

const deg = (r: number) => +(r * 180 / Math.PI).toFixed(1);
function project(spot: { x: number; y: number; z: number }, yaw: number, pitch: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x = spot.x * cy + spot.z * sy, z1 = -spot.x * sy + spot.z * cy;
  return { x, y: spot.y * cp - z1 * sp, depth: spot.y * sp + z1 * cp };
}

/** One layout, read at a level opening: spun to the islands' middle, no tilt. */
function read(label: string, grown: { radius: number; spots: ReadonlyMap<string, { x: number; y: number; z: number }> }, nodes: { id: string; place: number }[], edges: { from: string; on: string }[], today?: number) {
  const spots = [...grown.spots.values()];
  const middle = spots.reduce((sum, s) => ({ x: sum.x + s.x, z: sum.z + s.z }), { x: 0, z: 0 });
  const yaw = -Math.atan2(middle.x, middle.z);
  const at = new Map([...grown.spots].map(([story, spot]) => [story, project(spot, yaw, 0)]));
  const facing = [...at.values()].map(p => p.depth);
  const north = edges.filter(e => at.get(e.from)!.depth >= 0.5 && at.get(e.on)!.depth >= 0.5 && at.get(e.from)!.y > at.get(e.on)!.y).length;
  const rows = Math.max(...nodes.map(n => rowOf(n.place).row)) + 1;
  const spans = [...new Set(nodes.map(n => rowOf(n.place).row))].map(row => { const lon = nodes.filter(n => rowOf(n.place).row === row).map(n => { const s = grown.spots.get(n.id)!; return Math.atan2(s.x, s.z); }); return Math.max(...lon) - Math.min(...lon); });
  return { layout: label, rows, radius: +grown.radius.toFixed(1), islandsDrawnAt: today === undefined ? '100%' : `${Math.round(100 * today / grown.radius)}% of today's width`, landShareOfTheGlobe: `${(100 * land / (4 * Math.PI * grown.radius ** 2)).toFixed(1)}%`,
    widestRowSpansDegrees: deg(Math.max(...spans)), readable: facing.filter(d => d >= 0.5).length, atTheRim: facing.filter(d => d > 0 && d < 0.5).length, behindTheGlobe: facing.filter(d => d <= 0).length,
    dependenciesSeenPointingNorth: `${north} of ${edges.length}`, behind: [...at].filter(([, p]) => p.depth <= 0).map(([story]) => title.get(story)) };
}

const islandsFor = (nodes: { id: string; place: number }[]) => nodes.map(n => ({ story: n.id, place: n.place, reach: reach.get(n.id)! }));
const byCode = storyNodes(tree, changes, survey), byPlan = storyNodes(tree, changes);
const shipped = await variant('shipped', []);
const todayLayout = shipped.growPlanet(islandsFor(byCode));
const layouts = [read('today', todayLayout, byCode, codeEdges)];
// Islands may be pushed no further from their row place than before ADR-0910 (0.3 radians, 17 degrees), and half-way (0.6): the globe grows instead.
for (const nudge of [0.6, 0.3]) {
  const made = await variant(`nudge-${nudge}`, [[/export const MAX_NUDGE = 1\.2;/, `export const MAX_NUDGE = ${nudge};`]]);
  layouts.push(read(`islands pushed at most ${deg(nudge)} degrees from their row place; the globe grows instead`, made.growPlanet(islandsFor(byCode)), byCode, codeEdges, todayLayout.radius));
}
// The rows spread from 60 south to 60 north instead of 46.
{
  const made = await variant('band-60', [[/export const ROW_LATITUDE = 46 \* Math\.PI \/ 180;/, 'export const ROW_LATITUDE = 60 * Math.PI / 180;']]);
  layouts.push(read('rows from 60 south to 60 north', made.growPlanet(islandsFor(byCode)), byCode, codeEdges, todayLayout.radius));
}
// The sea gap as it was before ADR-0910 (12).
{
  const made = await variant('gap-12', [[/export const SEA_GAP = 36;/, 'export const SEA_GAP = 12;']]);
  layouts.push(read('sea between islands as before ADR-0910 (12, not 36)', made.growPlanet(islandsFor(byCode)), byCode, codeEdges, todayLayout.radius));
}
// The rows ranked by the plan's capability dependencies (the pathways drawn) rather than the code's package edges.
layouts.push(read('rows ranked by the plan\'s dependencies, the ones drawn as pathways', shipped.growPlanet(islandsFor(byPlan)), byPlan, planEdges, todayLayout.radius));

// Turning: the fewest islands each limit leaves readable (facing the eye at 0.5 or more), over every turn it allows, sampled every 2.5 degrees.
const spots = [...todayLayout.spots.values()];
const lon = spots.map(s => Math.atan2(s.x, s.z) * 180 / Math.PI), lat = spots.map(s => Math.asin(s.y) * 180 / Math.PI);
const box = { west: Math.min(...lon), east: Math.max(...lon), south: Math.min(...lat), north: Math.max(...lat) };
function fewest(label: string, allowed: (centreLongitude: number, tilt: number) => boolean) {
  let worst = { readable: Infinity, facing: Infinity, centreLongitude: 0, tilt: 0 }, turns = 0;
  for (let centre = -180; centre < 180; centre += 2.5) for (let tilt = -87.5; tilt <= 87.5; tilt += 2.5) {
    if (!allowed(centre, tilt)) continue;
    turns++;
    const depths = spots.map(s => project(s, -centre * Math.PI / 180, tilt * Math.PI / 180).depth);
    const readable = depths.filter(d => d >= 0.5).length, facing = depths.filter(d => d > 0).length;
    if (readable < worst.readable || (readable === worst.readable && facing < worst.facing)) worst = { readable, facing, centreLongitude: centre, tilt };
  }
  return { limit: label, shareOfAllTurnsAllowed: `${Math.round(100 * turns / (144 * 71))}%`, fewestReadable: worst.readable, fewestFacingTheEye: worst.facing, at: { centreLongitude: worst.centreLongitude, tilt: worst.tilt } };
}
const within = (margin: number) => (centre: number, tilt: number) => centre >= box.west - margin && centre <= box.east + margin && tilt >= box.south - margin && tilt <= box.north + margin;
const turning = { islandsLieBetween: { west: +box.west.toFixed(1), east: +box.east.toFixed(1), south: +box.south.toFixed(1), north: +box.north.toFixed(1) }, limits: [
  fewest('today: any spin, tilt to 88 degrees', () => true),
  fewest('the point facing the eye stays among the islands (west-most to east-most island, bottom row to top row)', within(0)),
  fewest('the same, with 25 degrees of margin', within(25)),
  fewest('spin among the islands, tilt at most 20 degrees', (centre, tilt) => centre >= box.west && centre <= box.east && Math.abs(tilt) <= 20),
  fewest('spin among the islands, no tilt', (centre, tilt) => centre >= box.west && centre <= box.east && tilt === 0),
] };
const result = { seedTaken: seed.stats.taken, stories: tree.stories.length, layouts, turning };
writeFileSync(path.join(here, 'experiments.json'), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify(result, null, 1));
