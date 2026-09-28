/** Story node render 3.6/3.7: real capability edges survive the join, with continuous shore docks. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { forestScene, placeOnPackedGlobe, PLANET_RADIUS } from '../index.js';
import { workStates } from '@storytree/arc-surface';
import { clipToCoast, rimLoops, SHIPPED_COAST } from '../../../forest-world/src/coast-clip.js';
import { trailFillWidth } from '../../../forest-world/src/core/routing.js';
import type { InstanceDescriptor } from '../../../forest-world/src/world-to-3d.js';
import { RIBBON_GROUND_SCALE } from '../../../forest-world/src/trail-ribbon-width.js';
import { plateTransform } from '../../../forest-world/src/planet/planet.js';
import { buildPlanetPathways } from '../../../forest-world/src/planet/pathways.js';

const health = { reported: { state: 'not-checked' as const }, verified: { state: 'not-checked' as const } };
const capability = (id: string, dependsOn: string[]) => ({ id, title: id, dependsOn, proposed: true, status: "proposed" as const, contracts: [], health });
const tree = { arcs: [], stories: [
  { id: 'a', title: 'A', health, capabilities: [capability('a1', []), capability('a2', ['a1'])] },
  { id: 'b', title: 'B', health, capabilities: [capability('b1', ['a1']), capability('b2', ['b1', 'a2'])] },
  { id: 'c', title: 'C', health, capabilities: [capability('c1', ['a1', 'b2']), capability('c2', ['c1'])] },
] };
const scene = forestScene(tree, [], workStates([]));
const spots = new Map(tree.stories.map((s, i) => [s.id, placeOnPackedGlobe(i + 1)]));
const links = tree.stories.flatMap(s => s.capabilities.flatMap(c => c.dependsOn.map(to => `${c.id}->${to}`))).sort();

test('3.6 every recorded builds-on link has one continuous trail chain, with shared trunks drawn once', () => {
  const plan = buildPlanetPathways(scene, spots, PLANET_RADIUS);
  assert.deepEqual(plan.edges.map(e => `${e.from}->${e.to}`).sort(), links);
  const segments = new Map(plan.segments.map(s => [s.id, s]));
  assert.equal(segments.size, plan.segments.length, 'a shared segment is drawn once');
  const users = new Map<string, Set<string>>();
  for (const edge of plan.edges) {
    assert.ok(edge.segments.length, 'no empty trail stands for a link');
    let end: Vector3 | undefined;
    for (const ref of edge.segments) {
      const segment = segments.get(ref.id)!;
      assert.ok(segment && segment.points.length >= 2, 'every chain ref is drawable');
      const points = ref.reversed ? [...segment.points].reverse() : segment.points;
      if (end) assert.ok(end.distanceTo(points[0]!) < 0.05, 'the chain has no break at a junction or shore');
      end = points.at(-1)!;
      const set = users.get(ref.id) ?? new Set<string>();
      set.add(`${edge.from}->${edge.to}`); users.set(ref.id, set);
    }
  }
  for (const segment of plan.segments) {
    assert.deepEqual([...segment.links].sort(), [...users.get(segment.id)!].sort(), 'no invented or orphan trail');
    assert.equal(segment.width, trailFillWidth(segment.links.length) * RIBBON_GROUND_SCALE);
  }
  assert.ok(plan.segments.some(s => s.links.length > 1), 'the cost-grid still merges trails');
  assert.equal(buildPlanetPathways(forestScene({ arcs: [], stories: [] }, [], workStates([])), new Map(), PLANET_RADIUS).edges.length, 0);
});

test('3.7 cross-story chains land at both actual clipped shores and continue into their capability parcels', () => {
  const plan = buildPlanetPathways(scene, spots, PLANET_RADIUS);
  const owner = new Map(tree.stories.flatMap(s => s.capabilities.map(c => [c.id, s.id])));
  for (const edge of plan.edges.filter(e => owner.get(e.from) !== owner.get(e.to))) {
    const key = `${edge.from}->${edge.to}`;
    const docks = plan.docks.filter(d => d.links.includes(key));
    assert.deepEqual(docks.map(d => d.story).sort(), [owner.get(edge.from), owner.get(edge.to)].sort());
    for (const dock of docks) {
      const plate = plan.plates.get(dock.story)!;
      const cells = clipToCoast(plate.descriptors.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground'), SHIPPED_COAST);
      const rings = rimLoops(cells.map(c => c.points!));
      let distance = Infinity;
      for (const ring of rings) for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
        const dx = b.x-a.x, dz = b.z-a.z;
        const t = Math.max(0, Math.min(1, ((dock.local.x-a.x)*dx+(dock.local.z-a.z)*dz)/(dx*dx+dz*dz)));
        distance = Math.min(distance, Math.hypot(dock.local.x-a.x-t*dx, dock.local.z-a.z-t*dz));
      }
      assert.ok(distance < 1e-7, `dock on ${dock.story} is on the coast, not the enclosing disc`);
      const transform = plateTransform(spots.get(dock.story)!, PLANET_RADIUS);
      const local = dock.point.clone().sub(new Vector3(...transform.position)).applyQuaternion(transform.quaternion.clone().invert());
      assert.ok(Math.hypot(local.x-dock.local.x, local.z-dock.local.z) < 1e-7);
      const cross = plan.segments.filter(s => s.island === undefined && s.links.includes(key));
      assert.ok(cross.some(s => [s.points[0]!, s.points.at(-1)!].some(p => p.distanceTo(dock.point) < 1e-7)));
      assert.ok((plate.paths.get(dock.story)?.length ?? 0) > 0, 'the worn trail continues onto the island');
    }
  }
});

// Routing errors must never take a failing island off the page (ADR-0646 D4).
test('3.6 routing failure is visible while every island and its failing trees still draw', async () => {
  const { planetPathwayDrawing } = await import('../../../forest-world/src/planet/pathways.js');
  const broken = { ...scene, links: [{ from: 'a1', to: 'missing-capability' }],
    islands: scene.islands.map(island => ({ ...island, trees: island.trees.map(t => ({ ...t, form: 'dead' as const })) })) };
  const drawing = planetPathwayDrawing(broken, spots, PLANET_RADIUS);
  assert.match(drawing.issue ?? '', /missing-capability/);
  assert.deepEqual([...drawing.plan.plates.keys()], tree.stories.map(s => s.id));
  assert.ok([...drawing.plan.plates.values()].every(plate => plate.descriptors.some(d => d.kind === 'cell-ground')));
  assert.equal(drawing.plan.edges.length, 0, 'the failure must not invent a completed trail');
});
