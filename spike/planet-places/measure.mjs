// Throwaway measurement; run from the worktree root:
// flock /tmp/storytree-heavy.lock node --import tsx spike/planet-places/measure.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { storyNodes } from '../../packages/forest/src/story-nodes/story-nodes.ts';
import { forestScene } from '../../packages/forest/src/render/forest-scene.ts';
import {
  forestDescriptors, groundInput, islandReach, GROUND_PER_PLACE, GROUND_PER_WORLD_UNIT,
} from '../../packages/forest-world/src/forest-ground/forest-ground.ts';
import { clipToCoast, rimLoops, SHIPPED_COAST } from '../../packages/forest-world/src/coast-clip.ts';
import { measureShore } from './shore-geometry.mjs';

const OUT = new URL('./results/', import.meta.url);
const COUNTS = [5, 36, 100];
const CAPABILITIES = [1, 6, 19];
// Continue beyond the requested pictures so the large-island failure at the
// recommended R is observed, as well as the conservative circular capacity.
const SAMPLE_COUNT = 256;
const SCAN_COUNT = 10000;
const health = { reported: { state: 'not-checked' }, verified: { state: 'not-checked' } };
function tree(count, caps) {
  return { arcs: [], stories: Array.from({ length: count }, (_, s) => ({
    id: `story_${s}`, title: `Story ${s + 1}`, health,
    capabilities: Array.from({ length: caps }, (_, c) => ({
      id: `cap_${s}_${c}`, title: `Capability ${c + 1}`, health, dependsOn: [], contracts: [],
    })),
  })) };
}

// placeOnSpiral is private: exercise it through storyNodes, never copy its rule.
// Empty history makes creation order the fixture tree order, with consecutive places.
const places = storyNodes(tree(SCAN_COUNT, 0), []).map(({ place, at }) => ({
  place, x: at.x * GROUND_PER_PLACE, y: at.y * GROUND_PER_PLACE,
  distance: Math.hypot(at.x, at.y) * GROUND_PER_PLACE,
  azimuth: Math.atan2(at.y, at.x),
}));
const radii = [
  { name: '150-degrees', radius: places[99].distance / (150 * Math.PI / 180) },
  { name: 'middle', radius: 500 },
  { name: 'large', radius: 1100 },
];

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
function wrap(place, radius) {
  const alpha = place.distance / radius;
  const c = Math.cos(place.azimuth), s = Math.sin(place.azimuth);
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  return { ...place, polarRadians: alpha,
    normal: [sa * c, sa * s, ca],
    // Shortest rotation from the front tangent plane (parallel transport on its meridian).
    east: [1 + (ca - 1) * c * c, (ca - 1) * c * s, -sa * c],
    north: [(ca - 1) * c * s, 1 + (ca - 1) * s * s, -sa * s],
  };
}

const shapes = [];
for (const caps of CAPABILITIES) {
  const scene = forestScene(tree(SAMPLE_COUNT, caps), [], { part: () => 'planned' });
  const input = groundInput(scene);
  const descriptors = forestDescriptors(scene);
  const cells = descriptors.filter(d => d.kind === 'cell-ground' && d.points);
  // This is the same pure coast operation the shipped canvas applies after forestDescriptors.
  const coast = clipToCoast(cells, SHIPPED_COAST);
  const centres = new Map(scene.islands.map(i => [i.story, { x: i.x * GROUND_PER_WORLD_UNIT, z: i.z * GROUND_PER_WORLD_UNIT }]));
  const meshReach = islandReach(cells, centres);
  const shoreReach = islandReach(coast, centres);
  const islands = scene.islands.map((i, index) => {
    const centre = centres.get(i.story);
    const loops = rimLoops(coast.filter(c => c.island === i.story).map(c => c.points));
    assert.equal(loops.length, 1, `${i.story}: a single exterior coast`);
    return {
      id: i.story, place: index + 1,
      inputCoastRadius: input.territories[index].groundRadius,
      descriptorRadius: meshReach.get(i.story),
      shoreRadius: shoreReach.get(i.story),
      coast: loops.map(loop => loop.map(p => [p.x - centre.x, p.z - centre.z])),
    };
  });
  const range = key => ({ min: Math.min(...islands.map(i => i[key])), max: Math.max(...islands.map(i => i[key])) });
  const sample = { capabilities: caps, inputCoastRadius: range('inputCoastRadius'), descriptorRadius: range('descriptorRadius'), shoreRadius: range('shoreRadius'), islands };
  shapes.push(sample);
  console.log(JSON.stringify({ capabilities: caps, input: sample.inputCoastRadius, descriptor: sample.descriptorRadius, shore: sample.shoreRadius }));
}

function closest(wrapped, count, radius, reach) {
  let best = { gap: Infinity };
  for (let i = 0; i < count; i++) for (let j = 0; j < i; j++) {
    const centreArc = radius * angle(wrapped[i].normal, wrapped[j].normal);
    const gap = centreArc - 2 * reach;
    if (gap < best.gap) best = {
      places: [j + 1, i + 1], centreArc, gap,
      tangentCapGap: centreArc - 2 * radius * Math.atan(reach / radius),
    };
  }
  return best;
}

function capacity(wrapped, radius, reach) {
  for (let i = 1; i < wrapped.length; i++) {
    let min = Infinity, pair;
    for (let j = 0; j < i; j++) {
      const gap = radius * angle(wrapped[i].normal, wrapped[j].normal) - 2 * reach;
      if (gap < min) { min = gap; pair = [j + 1, i + 1]; }
    }
    if (min <= 0) return { safeThroughPlace: i, firstConflictPlace: i + 1, places: pair, gap: min };
  }
  throw new Error(`No conflict within ${SCAN_COUNT} places: extend the scan`);
}

const measurements = radii.map(candidate => {
  const R = candidate.radius;
  const wrapped = places.map(p => wrap(p, R));
  // The back-pole crossing is read from real places, including the fractional position
  // obtained by linearly interpolating squared radius (linear in place for this spiral).
  const afterPole = places.findIndex(p => p.distance >= Math.PI * R);
  assert.ok(afterPole > 0);
  const before = places[afterPole - 1], after = places[afterPole];
  const backPolePlace = before.place + ((Math.PI * R) ** 2 - before.distance ** 2) / (after.distance ** 2 - before.distance ** 2);
  const shores = shapes.map(s => ({ capabilities: s.capabilities, ...measureShore(s.islands, wrapped, R, COUNTS) }));
  console.log(JSON.stringify({ radius: R, shores }));
  return {
    ...candidate, radiusPlaceWidths: R / GROUND_PER_PLACE,
    backPolePlace, firstPlacePastBackPole: after.place,
    shores,
    counts: COUNTS.map(count => ({
      count, lastPolarDegrees: wrapped[count - 1].polarRadians * 180 / Math.PI,
      frontCentres: wrapped.slice(0, count).filter(p => p.normal[2] >= 0).length,
      backCentres: wrapped.slice(0, count).filter(p => p.normal[2] < 0).length,
      sizes: shapes.map(s => ({ capabilities: s.capabilities, radius: s.shoreRadius.max, ...closest(wrapped, count, R, s.shoreRadius.max) })),
    })),
    sizes: shapes.map(s => {
      const r = s.shoreRadius.max;
      return {
        capabilities: s.capabilities, radius: r,
        rimLiftApprox: r * r / (2 * R), rimLiftShare: r * r / (2 * R * R),
        rimLiftRadialExact: Math.hypot(R, r) - R,
        rimLiftNormalExact: R - Math.sqrt(R * R - r * r),
        capacity: capacity(wrapped, R, r),
        tangentCapCapacity: capacity(wrapped, R, R * Math.atan(r / R)),
      };
    }),
    places: wrapped.slice(0, SAMPLE_COUNT),
  };
});

const sourcePaths = [
  'packages/forest/src/story-nodes/story-nodes.ts',
  'packages/forest/src/render/forest-scene.ts',
  'packages/forest-world/src/forest-ground/forest-ground.ts',
  'packages/forest-world/src/coast-clip.ts',
];
// A radius threshold is a measurement for this shore bound, not a fit applied
// by placement. The recommendation remains one fixed constant for every project.
let low = 500, high = 2000;
const biggest = shapes.at(-1).shoreRadius.max;
for (let step = 0; step < 45; step++) {
  const R = (low + high) / 2;
  if (closest(places.slice(0, 100).map(p => wrap(p, R)), 100, R, biggest).gap > 0) high = R;
  else low = R;
}
let flatMinimum = Infinity;
for (let i = 1; i < 100; i++) for (let j = 0; j < i; j++) {
  flatMinimum = Math.min(flatMinimum, Math.hypot(places[i].x - places[j].x, places[i].y - places[j].y));
}
const output = {
  groundPerPlace: GROUND_PER_PLACE, counts: COUNTS, capabilities: CAPABILITIES,
  sample: `${SAMPLE_COUNT} deterministic ids, story_0 through story_${SAMPLE_COUNT - 1}, at consecutive historical places 1 through ${SAMPLE_COUNT}; each size measured separately. Requested gap/picture counts remain 5, 36 and 100.`,
  minimumRadiusFor100Envelope: high,
  flat100: { centreGap: flatMinimum, biggestEnvelopeGap: flatMinimum - 2 * biggest },
  method: 'R * great-circle angle - 2 * largest measured shore radius: a conservative signed shore-envelope clearance. Negative means the envelopes overlap, not necessarily the irregular coasts. tangentCapGap uses R * atan(r / R), the exact radial footprint of a rigid tangent disc. Capacity is the first envelope conflict in the consecutive place prefix, not a count of surviving stories.',
  actualShoreMethod: 'Project the shipped coast from rigid tangent plates radially onto the globe, with the shortest rotation from the front normal. Measure the minimum great-circle arc separation of polygon edges, including intersections and containment. Overlap is reported as zero actual gap and an overlap flag; signed negative depths are only for the enclosing circles. This measures surface footprints, not tree crowns, relief or 3D plate/mesh intersections.',
  sources: Object.fromEntries(sourcePaths.map(p => [p, createHash('sha256').update(readFileSync(new URL(`../../${p}`, import.meta.url))).digest('hex')])),
  shapes, measurements,
};
await mkdir(OUT, { recursive: true });
// One line per island keeps the raw coast coordinates reviewable without a 200k-line file.
const serialised = JSON.stringify(output, null, 2).replace(/"coast": \[[\s\S]*?\n {10}\]/g, value => value.replace(/\s+/g, ' '));
await writeFile(new URL('measurements.json', OUT), `${serialised}\n`);
console.log(JSON.stringify(measurements.map(({ places, ...m }) => m), null, 2));
