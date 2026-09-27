// Reproduce the landing's geometry measurements against its native seeded links.
// Uses the product routing plan; no look-test links or drawing substitutions.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Vector3 } from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { forestScene, storyNodes, placeOnPackedGlobe, PLANET_RADIUS, PLANET_CAPACITY } =
  await import(pathToFileURL(require.resolve('@storytree/forest')));
const { workStates } = await import(pathToFileURL(require.resolve('@storytree/arc-surface')));
const engine = async name => import(pathToFileURL(path.join(root, 'packages/forest-world/src', name)));
const { buildPlanetPathways } = await engine('planet/pathways.ts');
const { plateTransform } = await engine('planet/planet.ts');
const { clipToCoast, rimLoops, SHIPPED_COAST } = await engine('coast-clip.ts');
const { trailFillWidth } = await engine('core/routing.ts');
const { RIBBON_GROUND_SCALE } = await engine('trail-ribbon-width.ts');
const seed = JSON.parse(readFileSync(path.join(here, 'seed.json'), 'utf8'));
const scene = forestScene(seed.tree, seed.changes.changes, workStates(seed.lines.lines));
const places = new Map(storyNodes(seed.tree, seed.changes.changes).map(story => [story.id, story.place]));
const spots = new Map([...places].map(([id, place]) => [id, placeOnPackedGlobe(place)]));
const plan = buildPlanetPathways(scene, spots, PLANET_RADIUS);

// The spike measured shortest point-to-minor-great-circle-arc distance, including
// both perpendicular feet. Project the complete clipped coast, beaches included.
function arcDistance(p, a, b) {
  const normal = a.clone().cross(b).normalize();
  const foot = p.clone().addScaledVector(normal, -p.dot(normal)).normalize();
  const ab = a.angleTo(b);
  let distance = Math.min(p.angleTo(a), p.angleTo(b));
  for (const q of [foot, foot.clone().negate()]) {
    if (a.angleTo(q) + q.angleTo(b) <= ab + 1e-9) distance = Math.min(distance, p.angleTo(q));
  }
  return distance * PLANET_RADIUS;
}
const shores = scene.islands.map(island => {
  const descriptors = plan.plates.get(island.story).descriptors;
  const cells = clipToCoast(descriptors.filter(d => d.kind === 'cell-ground' && d.points), SHIPPED_COAST);
  const transform = plateTransform(spots.get(island.story), PLANET_RADIUS);
  const at = new Vector3(...transform.position);
  const rings = rimLoops(cells.map(cell => cell.points)).map(ring => ring.map(point =>
    new Vector3(point.x, 0, point.z).applyQuaternion(transform.quaternion).add(at).normalize()));
  assert.ok(rings.length && rings.every(ring => ring.length > 2), 'measure complete, closed coast rings');
  const spot = spots.get(island.story);
  return { story: island.story, title: island.title, place: places.get(island.story), rings,
    normal: new Vector3(spot.x, spot.y, spot.z).normalize() };
});
function overlaps(a, b) {
  const reach = shore => Math.max(...shore.rings.flat().map(point => point.angleTo(shore.normal)));
  if (a.normal.angleTo(b.normal) > reach(a) + reach(b)) return false;
  const front = a.normal.clone().add(b.normal).normalize();
  const x = b.normal.clone().sub(a.normal).normalize(), y = front.clone().cross(x);
  const project = point => ({ x: point.dot(x) / point.dot(front), y: point.dot(y) / point.dot(front) });
  const first = a.rings.map(ring => ring.map(project)), second = b.rings.map(ring => ring.map(project));
  const inside = (point, rings) => {
    let yes = false;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const p = ring[i], q = ring[j];
      if ((p.y > point.y) !== (q.y > point.y)
        && point.x < (q.x - p.x) * (point.y - p.y) / (q.y - p.y) + p.x) yes = !yes;
    }
    return yes;
  };
  if (inside(first[0][0], second) || inside(second[0][0], first)) return true;
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (const one of first) for (const other of second) {
    for (let i = 0; i < one.length; i++) for (let j = 0; j < other.length; j++) {
      const p = one[i], q = one[(i + 1) % one.length], u = other[j], v = other[(j + 1) % other.length];
      if (cross(p, q, u) * cross(p, q, v) < 0 && cross(u, v, p) * cross(u, v, q) < 0) return true;
    }
  }
  return false;
}
function gap(a, b) {
  let minimum = Infinity;
  for (const one of a.rings) for (const other of b.rings) {
    for (let i = 0; i < one.length; i++) for (let j = 0; j < other.length; j++) {
      minimum = Math.min(minimum,
        arcDistance(one[i], other[j], other[(j + 1) % other.length]),
        arcDistance(other[j], one[i], one[(i + 1) % one.length]));
    }
  }
  return minimum;
}
const nearest = shores.map(() => Infinity), pairs = [];
for (let i = 0; i < shores.length; i++) for (let j = 0; j < i; j++) {
  assert.equal(overlaps(shores[i], shores[j]), false, `${shores[j].title} and ${shores[i].title} have disjoint coasts`);
  const distance = gap(shores[i], shores[j]);
  nearest[i] = Math.min(nearest[i], distance); nearest[j] = Math.min(nearest[j], distance);
  pairs.push({ from: shores[j].story, to: shores[i].story, gap: distance });
}
const sorted = [...nearest].sort((a, b) => a - b);
const coastGaps = {
  minimum: sorted[0], median: (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2,
  maximum: sorted.at(-1),
  nearest: shores.map((shore, index) => ({ story: shore.title, place: shore.place, gap: nearest[index] })), pairs,
};

const linkKey = link => `${link.from}->${link.to}`;
const expected = seed.tree.stories.flatMap(story => story.capabilities.flatMap(capability =>
  capability.dependsOn.map(to => `${capability.id}->${to}`))).sort();
assert.deepEqual(scene.links.map(linkKey).sort(), expected, 'the forest joins every native recorded link');
const actual = plan.edges.map(linkKey).sort();
const dropped = expected.filter(key => !actual.includes(key));
const duplicateChains = actual.filter((key, index) => actual.indexOf(key) !== index);
assert.deepEqual(actual, expected, 'each actual recorded link has exactly one trail chain');
assert.equal(actual.length, seed.stats.links);
const byId = new Map(plan.segments.map(segment => [segment.id, segment]));
assert.equal(byId.size, plan.segments.length, 'each shared segment draws once');
const users = new Map();
let maximumChainJoinGap = 0;
for (const edge of plan.edges) {
  assert.ok(edge.segments.length, 'each trail chain has drawable segments');
  let end;
  for (const ref of edge.segments) {
    const segment = byId.get(ref.id);
    assert.ok(segment?.points.length >= 2, 'each chain segment has drawable geometry');
    const points = ref.reversed ? [...segment.points].reverse() : segment.points;
    if (end) maximumChainJoinGap = Math.max(maximumChainJoinGap, end.distanceTo(points[0]));
    end = points.at(-1);
    const links = users.get(ref.id) ?? new Set();
    links.add(linkKey(edge)); users.set(ref.id, links);
  }
}
assert.ok(maximumChainJoinGap < 0.05, 'all chains are continuous at junctions and shore docks');
for (const segment of plan.segments) {
  assert.deepEqual([...segment.links].sort(), [...users.get(segment.id)].sort());
  assert.equal(segment.width, trailFillWidth(segment.links.length) * RIBBON_GROUND_SCALE);
}
function widths(segments) {
  return { segments: segments.length, minimum: Math.min(...segments.map(segment => segment.width)),
    maximum: Math.max(...segments.map(segment => segment.width)),
    maximumUsage: Math.max(...segments.map(segment => segment.links.length)) };
}
const withinWidths = widths(plan.segments.filter(segment => segment.island !== undefined));
const crossWidths = widths(plan.segments.filter(segment => segment.island === undefined));
const approvedGap = 4 * trailFillWidth(22) * RIBBON_GROUND_SCALE;
assert.ok(coastGaps.minimum >= approvedGap, 'the native seed meets the approved fixed coast gap');
assert.ok(coastGaps.minimum >= Math.max(withinWidths.maximum, crossWidths.maximum), 'coasts leave the actual ribbon width');
assert.throws(() => placeOnPackedGlobe(PLANET_CAPACITY + 1), RangeError);
const result = {
  radius: PLANET_RADIUS, capacity: PLANET_CAPACITY, nextPlaceRefused: true,
  seed: seed.stats, chainCount: plan.edges.length, segmentCount: plan.segments.length,
  withinWidths, crossWidths,
  oneLinkWidth: trailFillWidth(1) * RIBBON_GROUND_SCALE,
  approvedSpacing: { trunkUsage: 22, ribbonWidths: 4, gap: approvedGap },
  coastGaps, maximumChainJoinGap, dropped, duplicateChains,
  docks: plan.docks.map(dock => ({ story: dock.story, local: dock.local, point: dock.point.toArray(), links: dock.links })),
};
writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ radius: result.radius, capacity: result.capacity, seed: result.seed,
  chainCount: result.chainCount, withinWidths, crossWidths, dropped, duplicateChains,
  gaps: { minimum: coastGaps.minimum, median: coastGaps.median, maximum: coastGaps.maximum } }));
