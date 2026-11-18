import { HEX_R, PRE_ADR0528_TILE } from './hex.js';

const R27 = PRE_ADR0528_TILE.hexR;
const TUNED_AT_27 = {
  cellSize: R27 / 2,
  clearance: 0.6 * R27,
  falloff: 2.5 * R27,
  meanderWavelength: 4 * R27,
  meanderTaper: 4 * R27,
} as const;
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeTrails,
  trailFillWidth,
  type TrailIsland,
  type TrailEdgeIn,
  type TrailEdgeOut,
  type TrailNetwork,
  type TrailSegment,
} from './routing.js';
import { hash, rand01 } from './rng.js';

function isle(id: string, x: number, y: number, r: number): TrailIsland {
  return { id, x, y, r };
}

function segById(net: TrailNetwork, id: string): TrailSegment {
  const seg = net.segments.find((s) => s.id === id);
  assert.ok(seg, `segment ${id} exists`);
  return seg;
}

function orientedPoints(net: TrailNetwork, ref: { id: string; reversed: boolean }): { x: number; y: number }[] {
  const pts = [...segById(net, ref.id).points];
  return ref.reversed ? pts.reverse() : pts;
}

function assertChainContinuous(net: TrailNetwork, islands: readonly TrailIsland[], edge: TrailEdgeOut): void {
  const byId = new Map(islands.map((i) => [i.id, i]));
  assert.ok(edge.segments.length > 0, `${edge.from}->${edge.to} has segments`);
  let prev: { x: number; y: number } | undefined;
  for (const ref of edge.segments) {
    const pts = orientedPoints(net, ref);
    assert.ok(pts.length >= 2, 'segment has at least two points');
    const first = pts[0]!;
    if (prev) {
      assert.ok(
        Math.hypot(first.x - prev.x, first.y - prev.y) < 1e-9,
        `${edge.from}->${edge.to}: chain connects at ${ref.id}`,
      );
    } else {
      const from = byId.get(edge.from)!;
      assert.ok(
        Math.abs(Math.hypot(first.x - from.x, first.y - from.y) - from.r) < 1e-6,
        `${edge.from}->${edge.to}: docks on the from rim`,
      );
    }
    prev = pts[pts.length - 1]!;
  }
  const to = byId.get(edge.to)!;
  assert.ok(
    prev !== undefined && Math.abs(Math.hypot(prev.x - to.x, prev.y - to.y) - to.r) < 1e-6,
    `${edge.from}->${edge.to}: docks on the to rim`,
  );
}

function foreignIslandsOf(net: TrailNetwork, segId: string, islands: readonly TrailIsland[]): TrailIsland[] {
  const endpoints = new Set<string>();
  for (const e of net.edges) {
    if (e.segments.some((r) => r.id === segId)) {
      endpoints.add(e.from);
      endpoints.add(e.to);
    }
  }
  return islands.filter((i) => !endpoints.has(i.id));
}

test('1.2 rc-trail-router-deterministic-network: routeTrails is deterministic: same input, deep-equal network + byte-identical d', () => {
  const islands = [isle('A', 0, 0, 40), isle('B', 520, 0, 40), isle('O', 260, 10, 55)];
  const edges: TrailEdgeIn[] = [
    { from: 'A', to: 'B', title: 'a to b' },
    { from: 'A', to: 'O' },
    { from: 'O', to: 'B' },
  ];
  const n1 = routeTrails(islands, edges, 'seed-1');
  const n2 = routeTrails(islands, edges, 'seed-1');
  assert.deepEqual(n1, n2);
  assert.deepEqual(
    n1.segments.map((s) => s.d),
    n2.segments.map((s) => s.d),
  );
  assert.ok(n1.segments.length > 0);
  for (const s of n1.segments) assert.match(s.d, /^M -?\d/);
});

test('1.2 visible trails avoid foreign islands and the meander never enters one', () => {
  const islands = [isle('A', 0, 0, 40), isle('B', 520, 0, 40), isle('O', 260, 0, 55)];
  const net = routeTrails(islands, [{ from: 'A', to: 'B' }], 'seed-2');
  assert.equal(net.caves.length, 0, 'no cave when a route around exists');
  for (const seg of net.segments) {
    assert.equal(seg.hidden, false, 'no hidden segment when a route around exists');
    const foreign = foreignIslandsOf(net, seg.id, islands);
    for (const p of seg.points) {
      for (const isl of foreign) {
        const d = Math.hypot(p.x - isl.x, p.y - isl.y);
        assert.ok(d > isl.r, `point (${p.x},${p.y}) stays outside ${isl.id} (${d} <= ${isl.r})`);
      }
    }
  }
});

test('an explicit meanderAmp override is clamped below clearance — never into an island', () => {
  const islands = [isle('A', 0, 0, 40), isle('B', 520, 0, 40), isle('O', 260, 0, 55)];
  const net = routeTrails(islands, [{ from: 'A', to: 'B' }], 'seed-amp', { meanderAmp: 500 });
  assert.equal(net.caves.length, 0);
  for (const seg of net.segments) {
    for (const p of seg.points) {
      const d = Math.hypot(p.x - 260, p.y - 0);
      assert.ok(d > 55, `meander point (${p.x},${p.y}) stays outside O (${d} <= 55)`);
    }
  }
});

test('a pinched-out third island keeps its hard clearance (three block slots, not two)', () => {
  const X = isle('X', 45, 24, 10);
  const islands = [isle('A', 0, 0, 40), isle('B', 90, 0, 40), X];
  const net = routeTrails(islands, [{ from: 'A', to: 'B' }], 'seed-pinch');
  assert.equal(net.caves.length, 0, 'the pinch routes around, never under');
  const clearance = 0.6 * HEX_R;
  for (const seg of net.segments) {
    for (const p of seg.points) {
      const d = Math.hypot(p.x - X.x, p.y - X.y);
      assert.ok(d > X.r + clearance, `point (${p.x},${p.y}) honours X's clearance (${d} <= ${X.r + clearance})`);
    }
  }
});

test('near-parallel edges to one destination share a trunk segment (usage >= 2)', () => {
  const islands = [isle('A', -800, -60, 35), isle('B', -800, 60, 35), isle('C', 0, 0, 45)];
  const net = routeTrails(
    islands,
    [
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
    ],
    'seed-3',
  );
  const ac = net.edges.find((e) => e.from === 'A')!;
  const bc = net.edges.find((e) => e.from === 'B')!;
  const acIds = new Set(ac.segments.map((r) => r.id));
  const shared = bc.segments.filter((r) => acIds.has(r.id));
  assert.ok(shared.length > 0, 'the two edges share at least one segment');
  for (const r of shared) assert.ok(segById(net, r.id).usage >= 2, 'shared segment counts both edges');
  assert.ok(net.segments.some((s) => s.usage === 1), 'each edge keeps its own spur');
});

function chainLength(net: TrailNetwork, edge: TrailEdgeOut): number {
  let L = 0;
  for (const ref of edge.segments) {
    const pts = segById(net, ref.id).points;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return L;
}
function sharedLength(net: TrailNetwork, edge: TrailEdgeOut): number {
  let L = 0;
  for (const ref of edge.segments) {
    const seg = segById(net, ref.id);
    if (seg.usage < 2) continue;
    for (let i = 1; i < seg.points.length; i++)
      L += Math.hypot(seg.points[i]!.x - seg.points[i - 1]!.x, seg.points[i]!.y - seg.points[i - 1]!.y);
  }
  return L;
}

test('near-parallel edges MERGE onto one trunk for most of their length (no side-by-side lanes)', () => {
  const islands = [isle('A', -800, -40, 35), isle('B', -800, 40, 35), isle('C', 0, 0, 45)];
  const net = routeTrails(
    islands,
    [
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
    ],
    'seed-merge',
  );
  for (const edge of net.edges) {
    const frac = sharedLength(net, edge) / chainLength(net, edge);
    assert.ok(frac > 0.6, `${edge.from}->${edge.to} shares the trunk for most of its length (${frac.toFixed(2)})`);
  }
});

function dockPointOn(net: TrailNetwork, edge: TrailEdgeOut, isl: TrailIsland): { x: number; y: number } {
  const firstRef = edge.segments[0]!;
  const lastRef = edge.segments[edge.segments.length - 1]!;
  const firstPts = orientedPoints(net, firstRef);
  const lastPts = orientedPoints(net, lastRef);
  const head = firstPts[0]!;
  const tail = lastPts[lastPts.length - 1]!;
  const onRim = (p: { x: number; y: number }): boolean =>
    Math.abs(Math.hypot(p.x - isl.x, p.y - isl.y) - isl.r) < 1e-6;
  if (edge.to === isl.id) {
    assert.ok(onRim(tail), `${edge.from}->${edge.to} docks on ${isl.id} rim`);
    return tail;
  }
  assert.ok(onRim(head), `${edge.from}->${edge.to} docks on ${isl.id} rim`);
  return head;
}

test('near-coincident approaches to one island share ONE dock trunk, not separate lines', () => {
  const C = isle('C', 0, 0, 45);
  const islands = [isle('A', -800, -50, 30), isle('B', -800, 0, 30), isle('D', -800, 50, 30), C];
  const net = routeTrails(
    islands,
    [
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
      { from: 'D', to: 'C' },
    ],
    'seed-single-dock',
  );
  const docks = new Set<string>();
  for (const e of net.edges) {
    const p = dockPointOn(net, e, C);
    docks.add(`${p.x.toFixed(4)},${p.y.toFixed(4)}`);
  }
  assert.equal(docks.size, 1, 'the three edges share exactly ONE dock point into C');
  assert.ok(
    net.segments.some((s) => s.usage === 3),
    'a usage-3 trunk exists where the three approaches merge',
  );
  assert.equal(net.edges.length, 3);
  assert.equal(net.dropped.length, 0);
});

test('opposite-side approaches keep their own dock — merging never forces a detour', () => {
  const C = isle('C', 0, 0, 45);
  const islands = [
    isle('A', -800, -50, 30),
    isle('B', -800, 0, 30),
    isle('D', -800, 50, 30),
    isle('E', 800, 0, 30),
    C,
  ];
  const net = routeTrails(
    islands,
    [
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
      { from: 'D', to: 'C' },
      { from: 'E', to: 'C' },
    ],
    'seed-two-dock',
  );
  const docks = new Set<string>();
  for (const e of net.edges) {
    const p = dockPointOn(net, e, C);
    docks.add(`${p.x.toFixed(4)},${p.y.toFixed(4)}`);
  }
  assert.equal(docks.size, 2, 'left trio shares one dock; the right edge keeps its own');
  const ec = net.edges.find((e) => e.from === 'E')!;
  const eDock = dockPointOn(net, ec, C);
  const eSeg = orientedPoints(net, ec.segments[ec.segments.length - 1]!);
  assert.ok(
    Math.hypot(eSeg[eSeg.length - 1]!.x - eDock.x, eSeg[eSeg.length - 1]!.y - eDock.y) < 1e-9,
    'E docks on its own bearing (right side)',
  );
  assert.ok(net.segments.some((s) => s.usage === 3), 'the left trio still merges into a usage-3 trunk');
  for (const edge of net.edges) assertChainContinuous(net, islands, edge);
});

test('a moderate ~95° fan docks as ONE trunk (dockMergeSpan 100°, owner 2026-07-08)', () => {
  const C = isle('C', 0, 0, 45);
  const islands = [isle('A', 546, -585, 30), isle('B', 800, 0, 30), isle('D', 546, 585, 30), C];
  const net = routeTrails(
    islands,
    [
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
      { from: 'D', to: 'C' },
    ],
    'seed-fan-95',
  );
  const docks = new Set<string>();
  for (const e of net.edges) {
    const p = dockPointOn(net, e, C);
    docks.add(`${p.x.toFixed(4)},${p.y.toFixed(4)}`);
  }
  assert.equal(docks.size, 1, 'the ~94° fan shares ONE dock (would be two under the old 90° cap)');
  assert.ok(net.segments.some((s) => s.usage === 3), 'a usage-3 trunk carries the merged fan');
  assert.equal(net.dropped.length, 0);
  assert.deepEqual(routeTrails(islands, [{ from: 'A', to: 'C' }, { from: 'B', to: 'C' }, { from: 'D', to: 'C' }], 'seed-fan-95'), net);
});

test('a genuinely wide ~110° fan keeps ≥2 docks — the span cap still bites (no rim-wrap)', () => {
  const C = isle('C', 0, 0, 45);
  const islands = [isle('A', 459, -655, 30), isle('B', 800, 0, 30), isle('D', 459, 655, 30), C];
  const net = routeTrails(
    islands,
    [
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
      { from: 'D', to: 'C' },
    ],
    'seed-fan-110',
  );
  const docks = new Set<string>();
  for (const e of net.edges) {
    const p = dockPointOn(net, e, C);
    docks.add(`${p.x.toFixed(4)},${p.y.toFixed(4)}`);
  }
  assert.ok(docks.size >= 2, `a 110° fan keeps ≥2 docks (got ${docks.size})`);
  assert.equal(net.dropped.length, 0);
  for (const edge of net.edges) assertChainContinuous(net, islands, edge);
});

test('edges that FUNNEL together dock ONCE — approach recluster collapses the rim Y-fork (owner 2026-07-08)', () => {
  const C = isle('C', 0, 0, 45);
  const P = isle('P', -700, 500, 40);
  const Q = isle('Q', 700, 500, 40);
  const islands = [C, P, Q];
  const edges: TrailEdgeIn[] = [
    { from: 'P', to: 'Q' },
    { from: 'P', to: 'C' },
    { from: 'Q', to: 'C' },
  ];
  const docksInto = (net: TrailNetwork): number => {
    const s = new Set<string>();
    for (const e of net.edges) {
      if (e.from !== 'C' && e.to !== 'C') continue;
      const p = dockPointOn(net, e, C);
      s.add(`${p.x.toFixed(4)},${p.y.toFixed(4)}`);
    }
    return s.size;
  };
  const chordOnly = routeTrails(islands, edges, 'seed-funnel', { ...TUNED_AT_27, reclusterOnApproach: false });
  assert.equal(docksInto(chordOnly), 2, 'without the recluster the wide chords split into two docks (the Y-fork)');
  const net = routeTrails(islands, edges, 'seed-funnel', TUNED_AT_27);
  assert.equal(docksInto(net), 1, 'the funnelled C→P and C→Q share ONE dock after the approach recluster');
  assert.equal(net.dropped.length, 0, '§5 honesty: nothing dropped by the merge');
  assert.equal(net.caves.length, 0, 'a shared dock never forces a cave (cost only rises)');
  for (const edge of net.edges) assertChainContinuous(net, islands, edge);
  assert.deepEqual(routeTrails(islands, edges, 'seed-funnel', TUNED_AT_27), net);
});

test('meander stays on open runs but is suppressed at junctions and near other trails (owner 2026-07-08)', () => {
  const A = isle('A', 0, 0, 30);
  const B = isle('B', 900, 0, 30);
  const maxDevOf = (net: TrailNetwork, from: string): number => {
    const e = net.edges.find((x) => x.from === from)!;
    const seg = net.segments.find((s) => e.segments.some((r) => r.id === s.id))!;
    return Math.max(...seg.points.map((p) => Math.abs(p.y)));
  };
  const solo = routeTrails([A, B], [{ from: 'A', to: 'B' }], 'seed-meander', TUNED_AT_27);
  const flat = routeTrails([A, B], [{ from: 'A', to: 'B' }], 'seed-meander', { ...TUNED_AT_27, meanderTaper: 100000 });
  const soloDev = maxDevOf(solo, 'A');
  const flatDev = maxDevOf(flat, 'A');
  assert.ok(soloDev > flatDev + 1, `the open solo run wanders well above the tapered baseline (${soloDev} vs ${flatDev})`);

  const C = isle('C', 0, 400, 30);
  const D = isle('D', 900, 400, 30);
  const geo = [A, B, C, D];
  const eds: TrailEdgeIn[] = [{ from: 'A', to: 'B' }, { from: 'C', to: 'D' }];
  const proxOff = routeTrails(geo, eds, 'seed-meander', { ...TUNED_AT_27, meanderClearInner: 0, meanderClearOuter: 0 });
  const proxOn = routeTrails(geo, eds, 'seed-meander', { ...TUNED_AT_27, meanderClearInner: 0, meanderClearOuter: 100000 });
  assert.ok(
    maxDevOf(proxOff, 'A') > maxDevOf(proxOn, 'A') + 1,
    `a neighbour within the clear band suppresses the wander (${maxDevOf(proxOn, 'A')} vs ${maxDevOf(proxOff, 'A')})`,
  );
});

test('near-coincident junctions weld into one — the ~1-cell merge stub is gone (owner 2026-07-08)', () => {
  const islands = [
    isle('H', 0, 0, 50),
    isle('A', -600, -300, 30),
    isle('B', -600, 0, 30),
    isle('D', -600, 300, 30),
    isle('E', 600, -200, 30),
    isle('F', 600, 200, 30),
  ];
  const edges: TrailEdgeIn[] = [
    { from: 'A', to: 'H' }, { from: 'B', to: 'H' }, { from: 'D', to: 'H' },
    { from: 'E', to: 'H' }, { from: 'F', to: 'H' }, { from: 'A', to: 'E' }, { from: 'D', to: 'F' },
  ];
  const junctionsOf = (net: TrailNetwork): { x: number; y: number }[] => {
    const count = new Map<string, number>();
    for (const s of net.segments) {
      if (s.hidden || s.points.length < 2) continue;
      for (const p of [s.points[0]!, s.points[s.points.length - 1]!]) {
        const k = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    return [...count.entries()].filter(([, n]) => n >= 3).map(([k]) => {
      const [x, y] = k.split(',').map(Number);
      return { x: x!, y: y! };
    });
  };
  const minJunctionGap = (js: { x: number; y: number }[]): number => {
    let m = Infinity;
    for (let i = 0; i < js.length; i++)
      for (let j = i + 1; j < js.length; j++) m = Math.min(m, Math.hypot(js[i]!.x - js[j]!.x, js[i]!.y - js[j]!.y));
    return m;
  };
  const WELD = 200;
  const off = routeTrails(islands, edges, 'seed-weld', { junctionWeld: 0 });
  const on = routeTrails(islands, edges, 'seed-weld', { junctionWeld: WELD });
  assert.ok(minJunctionGap(junctionsOf(off)) < WELD, 'without welding, junctions sit within the weld radius (the stub)');
  assert.ok(minJunctionGap(junctionsOf(on)) > WELD, 'after welding, no two junctions sit within the weld radius');
  assert.ok(on.segments.length < off.segments.length, 'welding removes the tiny stub segments');
  assert.equal(on.dropped.length, 0, '§5 honesty: welding drops no edge');
  for (const edge of on.edges) assertChainContinuous(on, islands, edge);
  assert.deepEqual(routeTrails(islands, edges, 'seed-weld', { junctionWeld: WELD }), on);
});

test('the reuse-halo MOAT knob threads through — routes join the trunk or clear it, no 1-cell lane (item 4)', () => {
  const islands = [
    isle('A', -800, -70, 32),
    isle('B', -800, 0, 32),
    isle('C', -800, 70, 32),
    isle('D', 0, 0, 45),
  ];
  const edges: TrailEdgeIn[] = [
    { from: 'A', to: 'D' },
    { from: 'B', to: 'D' },
    { from: 'C', to: 'D' },
  ];
  const moatOpts = { dockMergeGap: 0 } as const;
  const cheapOpts = { dockMergeGap: 0, reuseHaloInner: 0.4, reuseHaloOuter: 0.7, discountFloor: 0.25 } as const;
  const moat = routeTrails(islands, edges, 'seed-moat', moatOpts);
  const cheap = routeTrails(islands, edges, 'seed-moat', cheapOpts);
  assert.notDeepEqual(
    moat.segments.map((s) => s.d),
    cheap.segments.map((s) => s.d),
    'the halo shaping actually changes the routed network',
  );
  for (const net of [moat, cheap]) {
    assert.deepEqual(net, routeTrails(islands, edges, 'seed-moat', net === cheap ? cheapOpts : moatOpts));
    assert.equal(net.dropped.length, 0);
    assert.equal(net.caves.length, 0, 'a moat only raises cost — it never forces a cave');
    for (const edge of net.edges) assertChainContinuous(net, islands, edge);
    assert.ok(net.segments.some((s) => s.usage >= 2), 'the fan still merges onto a shared trunk');
  }
});

test('a walled-in edge routes under the wall: hidden segments + cave portal pair', () => {
  const islands: TrailIsland[] = [isle('A', 0, 0, 30), isle('B', 600, 0, 30)];
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI / 4) * k;
    islands.push(isle(`ring${k}`, 150 * Math.cos(a), 150 * Math.sin(a), 60));
  }
  const net = routeTrails(islands, [{ from: 'A', to: 'B' }], 'seed-4');
  const edge = net.edges[0]!;
  const hiddenRefs = edge.segments.filter((r) => segById(net, r.id).hidden);
  assert.ok(hiddenRefs.length > 0, 'the forced route has an under-island ghost run');
  assert.ok(net.caves.length >= 2, 'entry + exit portals on the blocking island');
  for (const cave of net.caves) {
    assert.match(cave.islandId, /^ring/, 'portals sit on wall islands, never endpoints');
    assert.deepEqual(cave.edgeIds, ['A->B']);
    assert.equal(cave.width, trailFillWidth(1));
    const isl = islands.find((i) => i.id === cave.islandId)!;
    const rim = Math.hypot(cave.x - isl.x, cave.y - isl.y);
    assert.ok(Math.abs(rim - isl.r) < 1.5, `portal sits on the rim (${rim} vs r ${isl.r})`);
    const bx = Math.cos(cave.bearing);
    const by = Math.sin(cave.bearing);
    assert.ok(Math.hypot(isl.x + bx * rim - cave.x, isl.y + by * rim - cave.y) < 1e-6);
  }
  for (const seg of net.segments.filter((s) => !s.hidden)) {
    for (const p of seg.points) {
      for (const isl of islands) {
        const d = Math.hypot(p.x - isl.x, p.y - isl.y);
        assert.ok(d >= isl.r - 1e-6, `visible point (${p.x},${p.y}) not inside ${isl.id}`);
      }
    }
  }
  assertChainContinuous(net, islands, edge);
});

test('an unobstructed edge produces zero caves and zero hidden segments', () => {
  const islands = [isle('A', 0, 0, 40), isle('B', 400, 0, 40)];
  const net = routeTrails(islands, [{ from: 'A', to: 'B' }], 'seed-5');
  assert.equal(net.caves.length, 0);
  assert.ok(net.segments.every((s) => !s.hidden));
  assert.equal(net.edges.length, 1);
});

test('a blocked dock cell re-bearings around the blocker instead of flipping into cave mode', () => {
  const islands: TrailIsland[] = [isle('A', 0, 0, 40), isle('B', 1200, 0, 40)];
  for (let k = -66; k <= 66; k++) islands.push(isle(`w${k}`, 600, k * 30, 20));
  const open = routeTrails(islands, [{ from: 'A', to: 'B' }], 'seed-dock');
  assert.equal(open.caves.length, 0, 'a route around the wall exists');
  const withIslet = [...islands, isle('X', 70, 0, 12)];
  const net = routeTrails(withIslet, [{ from: 'A', to: 'B' }], 'seed-dock');
  assert.equal(net.caves.length, 0, 'the dock scans to an unblocked bearing — no cave');
  assert.ok(net.segments.every((s) => !s.hidden), 'no hidden run either');
  assert.equal(net.dropped.length, 0);
  assertChainContinuous(net, withIslet, net.edges[0]!);
});

test('every edge chain is continuous from the from-rim to the to-rim', () => {
  const islands = [
    isle('A', -800, -60, 35),
    isle('B', -800, 60, 35),
    isle('C', 0, 0, 45),
    isle('O', -400, 0, 50),
  ];
  const edges: TrailEdgeIn[] = [
    { from: 'A', to: 'C' },
    { from: 'B', to: 'C' },
    { from: 'A', to: 'B' },
    { from: 'C', to: 'O' },
  ];
  const net = routeTrails(islands, edges, 'seed-6');
  assert.equal(net.edges.length, edges.length);
  for (const edge of net.edges) assertChainContinuous(net, islands, edge);
});

test('shuffling the input edge array yields the same network', () => {
  const islands = [
    isle('A', -800, -60, 35),
    isle('B', -800, 60, 35),
    isle('C', 0, 0, 45),
    isle('O', -400, 0, 50),
  ];
  const edges: TrailEdgeIn[] = [
    { from: 'A', to: 'C' },
    { from: 'B', to: 'C' },
    { from: 'A', to: 'B' },
    { from: 'C', to: 'O' },
  ];
  const shuffled = [edges[2]!, edges[3]!, edges[0]!, edges[1]!];
  assert.deepEqual(routeTrails(islands, edges, 'seed-7'), routeTrails(islands, shuffled, 'seed-7'));
});

test('unknown endpoints, self-edges and duplicates are dropped; empty input is empty', () => {
  const islands = [isle('A', 0, 0, 40), isle('B', 400, 0, 40)];
  const net = routeTrails(
    islands,
    [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'B' },
      { from: 'A', to: 'A' },
      { from: 'A', to: 'ghost' },
    ],
    'seed-8',
  );
  assert.equal(net.edges.length, 1);
  assert.deepEqual(net.dropped, [{ from: 'A', to: 'ghost' }]);
  assert.deepEqual(routeTrails([], [{ from: 'A', to: 'B' }], 'seed-8'), {
    segments: [],
    edges: [],
    caves: [],
    dropped: [{ from: 'A', to: 'B' }],
  });
  assert.deepEqual(routeTrails(islands, [], 'seed-8'), {
    segments: [],
    edges: [],
    caves: [],
    dropped: [],
  });
});

test("island ids containing '->' never fold two distinct edges into one", () => {
  const islands = [
    isle('a->b', 0, 0, 30),
    isle('c', 400, 0, 30),
    isle('a', 0, 300, 30),
    isle('b->c', 400, 300, 30),
  ];
  const net = routeTrails(
    islands,
    [
      { from: 'a->b', to: 'c' },
      { from: 'a', to: 'b->c' },
    ],
    'seed-arrow',
  );
  assert.equal(net.edges.length, 2, 'no false duplicate-key drop');
  assert.equal(net.dropped.length, 0);
});

test('trailFillWidth is 1.2 + 1.8*sqrt(n): a thin spur, a legible thin→thick trunk ladder', () => {
  assert.equal(trailFillWidth(1), 3.0);
  assert.equal(trailFillWidth(4), 4.8);
  assert.equal(trailFillWidth(0), 1.2);
  assert.ok(trailFillWidth(1) < 4.5, 'spur is thinner than before');
  assert.ok(trailFillWidth(2) > trailFillWidth(1), 'a shared trunk steps up');
  assert.ok(trailFillWidth(4) > trailFillWidth(2), 'more sharing, thicker still');
});

test('30 islands / 60 edges route correctly (2s bound opt-in via STORYTREE_PERF=1)', (t) => {
  const islands: TrailIsland[] = [];
  for (let i = 0; i < 30; i++) {
    const col = i % 6;
    const row = (i / 6) | 0;
    islands.push(
      isle(
        `i${i}`,
        col * 300 + 80 * (rand01(hash(`px${i}`)) - 0.5),
        row * 300 + 80 * (rand01(hash(`py${i}`)) - 0.5),
        25 + 20 * rand01(hash(`pr${i}`)),
      ),
    );
  }
  const edges: TrailEdgeIn[] = [];
  for (let k = 0; k < 60; k++) {
    const from = k % 30;
    const to = (from + 1 + (k % 7)) % 30;
    edges.push({ from: `i${from}`, to: `i${to}` });
  }
  const t0 = performance.now();
  const net = routeTrails(islands, edges, 'seed-perf');
  const elapsed = performance.now() - t0;
  assert.ok(net.edges.length > 0);
  t.diagnostic(`routed in ${elapsed.toFixed(0)}ms`);
  if (process.env.STORYTREE_PERF === '1') {
    assert.ok(elapsed < 2000, `routed in ${elapsed.toFixed(0)}ms`);
  }
  assert.equal(new Set(net.segments.map((s) => s.id)).size, net.segments.length);
  for (const edge of net.edges) assertChainContinuous(net, islands, edge);
});
