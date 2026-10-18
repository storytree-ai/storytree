/** Story node render 3.6/3.7: real capability edges between stories survive the join, as continuous roads between shore docks. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { forestScene, selectionLanes, storyNodes } from '../index.js';
import { workStates } from '@storytree/arc-surface';
import { sheetLayout } from '../view/sheet-navigation.js';
import { territories, territoryAt } from '../territories/territories.js';
import type { InstanceDescriptor } from '@storytree/forest-world';
import { buildPlanetPathways, clipToCoast, plateTransform, RIBBON_GROUND_SCALE, rimLoops, routeTrails, SHIPPED_COAST, trailFillWidth } from '@storytree/forest-world/geometry';

const health = { reported: { state: 'not-checked' as const }, verified: { state: 'not-checked' as const } };
const capability = (id: string, dependsOn: string[]) => ({ id, title: id, dependsOn, proposed: true, status: "proposed" as const, contracts: [], health });
const tree = { arcs: [], stories: [
  { id: 'a', title: 'A', health, capabilities: [capability('a1', []), capability('a2', ['a1'])] },
  { id: 'b', title: 'B', health, capabilities: [capability('b1', ['a1']), capability('b2', ['b1', 'a2'])] },
  { id: 'c', title: 'C', health, capabilities: [capability('c1', ['a1', 'b2']), capability('c2', ['c1'])] },
] };
const scene = forestScene(tree, [], workStates([]));
// The islands where the glass sheet lays them, on its big sphere.
const { spots, radius: RADIUS } = sheetLayout(scene, new Map(storyNodes(tree, []).map(({ id, place }) => [id, place])));
const owner = new Map(tree.stories.flatMap(s => s.capabilities.map(c => [c.id, s.id])));
// Links between stories; a link within one story has no road (3.26 never lights one, and nothing else draws it).
const links = tree.stories.flatMap(s => s.capabilities.flatMap(c => c.dependsOn.filter(to => owner.get(to) !== s.id).map(to => `${c.id}->${to}`))).sort();

test('3.6 every recorded builds-on link between stories has one continuous trail chain, with shared trunks drawn once', () => {
  const plan = buildPlanetPathways(scene, spots, RADIUS);
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
  assert.equal(buildPlanetPathways(forestScene({ arcs: [], stories: [] }, [], workStates([])), new Map(), RADIUS).edges.length, 0);
});

test('3.7 cross-story chains land at both actual clipped shores', () => {
  const plan = buildPlanetPathways(scene, spots, RADIUS);
  for (const edge of plan.edges) {
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
      const transform = plateTransform(spots.get(dock.story)!, RADIUS);
      const local = dock.point.clone().sub(new Vector3(...transform.position)).applyQuaternion(transform.quaternion.clone().invert());
      assert.ok(Math.hypot(local.x-dock.local.x, local.z-dock.local.z) < 1e-7);
      const cross = plan.segments.filter(s => s.links.includes(key));
      assert.ok(cross.some(s => [s.points[0]!, s.points.at(-1)!].some(p => p.distanceTo(dock.point) < 1e-7)));
    }
  }
});

// Routing errors must never take a failing island off the page (ADR-0646 D4).
test('3.6 routing failure is visible while every island and its failing trees still draw', async () => {
  const { planetPathwayDrawing } = await import('@storytree/forest-world/geometry');
  const broken = { ...scene, links: [{ from: 'a1', to: 'missing-capability' }],
    islands: scene.islands.map(island => ({ ...island, trees: island.trees.map(t => ({ ...t, form: 'dead' as const })) })) };
  const drawing = planetPathwayDrawing(broken, spots, RADIUS);
  assert.match(drawing.issue ?? '', /missing-capability/);
  assert.deepEqual([...drawing.plan.plates.keys()], tree.stories.map(s => s.id));
  assert.ok([...drawing.plan.plates.values()].every(plate => plate.descriptors.some(d => d.kind === 'cell-ground')));
  assert.equal(drawing.plan.edges.length, 0, 'the failure must not invent a completed trail');
});

test('3.6 a change on one island routes nothing again (ADR-0836 D1)', () => {
  const routed: string[] = [];
  const route: typeof routeTrails = (...args) => { routed.push(args[2]); return routeTrails(...args); };
  const before = buildPlanetPathways(scene, spots, RADIUS, route);
  const healthy = { ...tree, stories: tree.stories.map(s => s.id !== 'c' ? s : { ...s, capabilities: s.capabilities.map(c => c.id !== 'c2' ? c : { ...c, proposed: false, status: 'healthy' as const }) }) };
  const changed = forestScene(healthy, [], workStates([]));
  // The page hands on unchanged islands as the objects already on show (ForestView.show).
  const next = { ...changed, islands: changed.islands.map(island => scene.islands.find(old => old.key === island.key) ?? island) };
  assert.notEqual(next.islands[2], scene.islands[2], 'island c changed');
  routed.length = 0;
  const after = buildPlanetPathways(next, spots, RADIUS, route);
  assert.deepEqual(routed, []);
  assert.deepEqual(after.edges, before.edges, 'the same pathways are drawn');
});

test('3.6 the roads are the survey\'s derived capability edges with the recorded dependsOn, each saying whether it is type-only (ADR-0991 D1, D3)', () => {
  const edge = (story: string, from: string | undefined, to: string | undefined, typeOnly: boolean) =>
    ({ story, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), typeOnly, files: [] });
  // b's code takes types from a1 and a2, and b1 → a1 is also recorded; c's import of a reaches no capability on a.
  const survey = {
    b: { files: [], imports: [], edges: [edge('a', 'b1', 'a1', true), edge('a', 'b1', 'a2', true)] },
    c: { files: [], imports: [], edges: [edge('a', 'c1', undefined, false)] },
  };
  const small = { arcs: [], stories: [
    { id: 'a', title: 'A', health, capabilities: [capability('a1', []), capability('a2', [])] },
    { id: 'b', title: 'B', health, capabilities: [capability('b1', ['a1'])] },
    { id: 'c', title: 'C', health, capabilities: [capability('c1', [])] },
  ] };
  const derived = forestScene(small, [], workStates([]), survey);
  assert.deepEqual([...derived.links!].sort((m, n) => `${m.from}${m.to}`.localeCompare(`${n.from}${n.to}`)), [
    { from: 'b1', to: 'a1' },
    { from: 'b1', to: 'a2', typeOnly: true },
  ], 'a recorded link is drawn by value; the code\'s types alone are type-only; an edge with no capability end has no road');
  assert.equal('rowLinks' in derived, false, 'nothing else is handed on to draw');
  assert.deepEqual(forestScene(small, [], workStates([])).links, [{ from: 'b1', to: 'a1' }], 'with no survey the recorded links stand');
});

test('3.43 a built story whose package depends on a mapped story\'s has a road from its island to the mapped island as a whole, lit when either is selected', () => {
  const mapped = { id: 'old', title: 'old', health, capabilities: [], mapped: { from: '/code/shop', package: 'packages/old', folders: ['packages/old'] } };
  const built = { id: 'new', title: 'new', health, capabilities: [capability('n1', [])] };
  const other = { id: 'b', title: 'b', health, capabilities: [capability('b1', [])] };
  // new's package names the mapped old and the built b; only the mapped one has no capability edge to stand for it.
  const survey = { new: { files: [], imports: [], dependsOn: ['old', 'b'] }, old: { files: [], imports: [], dependsOn: [], mapped: { folder: '/code/shop' } } };
  const scene = forestScene({ arcs: [], stories: [mapped, built, other] }, [], workStates([]), survey);
  assert.deepEqual(scene.links, [{ from: 'new', to: 'old' }], 'one road, island to island; a built-to-built package dependency draws none');
  assert.deepEqual(selectionLanes(scene, 'new'), [{ from: 'new', to: 'old', dir: 'up' }]);
  assert.deepEqual(selectionLanes(scene, 'old'), [{ from: 'new', to: 'old', dir: 'down' }]);
});
