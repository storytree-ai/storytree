// A PLANT STANDS ON THE GROUND WHOSE CAPABILITY STATUS TINTED IT (ADR-0226 + ADR-0367 D5).
//
// Increment: `driftspot-plants-stand-on-the-ground-that-tinted-them` on `ground-space-truth-arc`.
//
// WHAT WAS WRONG. `driftSpot` returned `{ x: a.x + cos(ang)·rr, y: a.y + sin(ang)·rr·0.6 }` from an
// anchor cell's centroid with NO containment test of ANY kind — nothing asked whether the point fell
// inside the cell, inside the parcel, or inside the island. `buildTerritorySurface` then stamps every
// mark the surface emits with its parcel's `capId`, and the parcel's ground wears that capability's
// STATUS TINT. So a placement that drifted over the boundary carried capability A's proof state while
// standing on capability B's ground — an assertion about B that is simply false. ADR-0226 makes the
// vegetation MEAN something and ADR-0367 D5 puts semantic state above the art, so this is a lie the
// map tells, not a cosmetic wobble.
//
// ⚠ MEASURED ON TODAY'S CODE BEFORE THE FIX, not carried forward from the increment. The increment
// cites 10.9%. This arc's other two increments each cited a measured consequence and NEITHER
// reproduced, so the figure was re-measured with a fresh instrument over 90,800 placements across
// 227 parcels, all three substrate modes, islands of 7-61 tiles, 1-8 capabilities: **10.21% of
// placements landed outside the parcel that tinted them.** It reproduces — direction, class and
// magnitude. The rate is a function of the bed size, running 5.55% on a bare parcel (spread 7.00)
// to 22.18% on the largest bed the density budget builds (tests = 20, spread 18.00).
//
// ⚠ THE SUITE BELOW SWEEPS A SUBSET of that probe — 108 parcels x 120 placements rather than
// 227 x 400 — so it stays inside the gate's seconds budget. On the subset the same two figures read
// 7.40% -> 0.00% and 11.81x -> 12.44x. The bands asserted below are generous enough to hold on
// EITHER sweep on purpose: they exist to catch a fixture that stopped describing the defect, not to
// pin a value the sample size moves.
//
// ⚠ THOSE SUBSET FIGURES MOVED ONCE, AND THE REASON IS NOT THIS FIX. They read 8.08% -> 0.00% and
// 11.60x -> 12.28x until `studio-island-layout-moves-to-ground-space` re-mirrored `capSeeds` below
// onto the studio's new GROUND-space ring — different Voronoi seeds, so a different partition of the
// same mesh, so a different set of parcels to escape from. The 90,800-placement figures in the
// paragraphs above were measured against the OLD seeds and are left as the historical record of
// what the driftSpot fix itself did; the re-mirrored subset is what this file measures today.
//
// THE FIX is reject-and-resample against the parcel's own cells, and the choice of reject over clamp
// is the MASSING: see `DRIFT_CONTAINMENT_TRIES` in scene.ts. After it, 0 of the same 90,800.
//
// ⚠ THE MASSING IS A DECISION, NOT A SIDE EFFECT (owner, 2026-07-18: massed vegetation with open
// lawn between reads as a garden, not static). A fix that flattened the drift beds would have
// repaired a bug by breaking a decision, so the concentration is re-measured here and pinned:
// 8.20x before, 8.73x after, against a uniform scatter over the same parcel area. It TIGHTENS
// slightly, which is the arithmetic working — the placements the fix removes are by construction the
// outermost ones.
//
// ⚠ THE TEETH. A containment assertion is exactly the shape of test that can pass while measuring
// nothing: it is satisfied by a positioner that plants every mark on one point, and it is satisfied
// vacuously by a fixture whose parcels could not be escaped in the first place. So three controls sit
// beside it. (a) `the defect was real` replays the PRE-FIX formula on the SAME fixture and requires
// it to escape — if it ever stopped escaping, the fixture went vacuous and this whole file with it.
// (b) `the massing survived` requires the beds to stay ~9x a uniform scatter AND the placements to
// stay almost all distinct, which is what a collapse-to-the-anchor "fix" fails. (c) the containment
// is required to span the WHOLE parcel, not just the anchor's own cell, which is what a narrowed
// test would fail.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HEX_R, axialKey, hexCenter, pixelToHex, type Axial, type Pt } from './hex.js';
import { PLAN_VIEW_ELEVATION_DEG, projectGround } from './camera.js';
import { hash, rand01 } from './rng.js';
import { crownRadius } from './sizing.js';
import { buildRelaxedCells, type DrawTile, type SubstrateMode } from './substrate.js';
import { DRIFT_CONTAINMENT_TRIES, driftSpot, type ParcelCell } from './scene.js';

// ---------------------------------------------------------------------------------------------
// the fixture — the parcels the SHIPPED path builds, not a hand-drawn stand-in
// ---------------------------------------------------------------------------------------------
//
// `buildTerritorySurface` partitions an island's relaxed mesh among its capabilities by nearest
// seed, and the studio's `capToParcel` hands it each capability's ring position as that seed. Both
// are mirrored here so the polygons under test are the polygons the map actually draws: a hand-drawn
// square would be a fixture whose containment nobody could escape, and the control below would then
// have nothing to report.

/** The vertex mean — `scene.ts`'s own `cellCentroid`, which is what an anchor is. */
function cellCentroid(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  const n = poly.length || 1;
  return { x: x / n, y: y / n };
}

/** `scene.ts`'s equal-weight Voronoi assignment. */
function nearestParcel(centroid: Pt, seeds: readonly Pt[]): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]!;
    const d = (centroid.x - s.x) ** 2 + (centroid.y - s.y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** `scene.ts`'s ray-cast point-in-polygon, replicated so the assertion does not ask the subject
 *  whether it is right (`an-expectation-derived-from-its-subject-cannot-fail`). */
function pointInPoly(x: number, y: number, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** `scene.ts`'s `streamRand` — the seeded mulberry32 stream a `SurfaceFn` draws from. */
function streamRand(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The shoelace area of a cell ring — the denominator the concentration index needs. */
function polyArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j]!.x + poly[i]!.x) * (poly[j]!.y - poly[i]!.y);
  }
  return Math.abs(a / 2);
}

function discTiles(rings: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -rings; q <= rings; q++) {
    for (let r = -rings; r <= rings; r++) if (Math.abs(q + r) <= rings) out.push({ q, r });
  }
  return out;
}

/** The studio's capability ring (`TreeView.tsx`'s `caps` walk) — each capability's layout position,
 *  which is the Voronoi seed its parcel is grown from.
 *
 *  ⚠ RE-MIRRORED by `studio-island-layout-moves-to-ground-space`, the increment this fixture named
 *  as the owner of the question. The studio now takes BOTH decisions on the ground: the hero tile is
 *  the tile nearest the island's centroid in PLAN VIEW, and the ring is a ground CIRCLE projected
 *  once through the declared camera, where the retired code used a hand-picked `0.66` squash (a
 *  1.93x ground ellipse) around a hero tile the projection had chosen. The seeds below track that,
 *  because a fixture mirroring a formula the map no longer runs stops describing the map — which is
 *  the same reason it was mirrored verbatim before. */
function capSeeds(storyId: string, capIds: readonly string[], tiles: readonly Axial[]): Pt[] {
  const groundCenters = tiles.map((h) => hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }));
  const groundCentroid: Pt = {
    x: groundCenters.reduce((s, p) => s + p.x, 0) / groundCenters.length,
    y: groundCenters.reduce((s, p) => s + p.y, 0) / groundCenters.length,
  };
  // ground-space: `groundCenters` are `hexCenter` at PLAN_VIEW_ELEVATION_DEG — the pre-camera tile
  // positions — so this radius is isotropic, exactly as the studio's `groundRadius` is.
  const groundGaps = groundCenters.map((p) =>
    Math.hypot(p.x - groundCentroid.x, p.y - groundCentroid.y),
  );
  const groundRadius = Math.max(0, ...groundGaps) + HEX_R;
  const owned = new Set(tiles.map(axialKey));
  // The studio's `groundHeroTile`: the tile nearest the centroid ON THE GROUND, ties to the earliest.
  let heroIdx = 0;
  for (let k = 1; k < groundGaps.length; k++) {
    if (groundGaps[k]! < groundGaps[heroIdx]!) heroIdx = k;
  }
  const treeSpot = hexCenter(tiles[heroIdx] ?? tiles[0]!);
  const ringR = Math.max(
    crownRadius(capIds.length) * 0.9,
    Math.min(crownRadius(capIds.length) + 18, groundRadius - HEX_R * 0.55),
  );
  const ARC = (Math.PI * 4) / 3;
  return capIds.map((capId, j) => {
    const slot = -Math.PI / 6 + ((j + 0.5) / capIds.length) * ARC;
    const angle = slot + (rand01(hash(`${storyId}:${capId}:a`)) - 0.5) * (ARC / capIds.length) * 0.5;
    const rr = ringR + (rand01(hash(`${storyId}:${capId}:r`)) - 0.5) * 10;
    // The studio's `groundPolarOffset`: a GROUND circle of radius `rr`, projected once.
    const off = projectGround({ x: Math.cos(angle) * rr, y: Math.sin(angle) * rr });
    let x = treeSpot.x + off.x;
    let y = treeSpot.y + off.y;
    for (let k = 0; k < 4 && !owned.has(axialKey(pixelToHex({ x, y }))); k++) {
      x += (treeSpot.x - x) * 0.25;
      y += (treeSpot.y - y) * 0.25;
    }
    return { x, y };
  });
}

interface Parcel {
  readonly capId: string;
  readonly cells: ParcelCell[];
  readonly testCount: number;
}

/** One island's parcels, exactly as `buildTerritorySurface` derives them. */
function islandParcels(
  storyId: string,
  rings: number,
  capCount: number,
  mode: SubstrateMode,
  tests: readonly number[],
): Parcel[] {
  const tiles = discTiles(rings);
  const draw: DrawTile[] = tiles.map((h) => ({ h, owner: 0 }));
  const own = buildRelaxedCells(draw, [new Set()], mode).filter((c) => c.owner === 0);
  const capIds = Array.from({ length: capCount }, (_, i) => `${storyId}#cap-${i}`);
  const seeds = capSeeds(storyId, capIds, tiles);
  const groups: ParcelCell[][] = capIds.map(() => []);
  for (const c of own) {
    const cen = cellCentroid(c.poly);
    groups[nearestParcel(cen, seeds)]!.push({ poly: c.poly, cx: cen.x, cy: cen.y });
  }
  return capIds.map((capId, i) => ({
    capId,
    cells: groups[i]!,
    testCount: tests[i % tests.length]!,
  }));
}

/** The sweep: all three substrate modes, four island sizes, the density budget's whole test range. */
const MODES: readonly SubstrateMode[] = ['relaxed-hex', 'relaxed-quad', 'mesh'];
const TESTS = [0, 2, 4, 7, 12, 20] as const;

function sweep(): Parcel[] {
  const out: Parcel[] = [];
  for (const mode of MODES) {
    for (const rings of [1, 2, 3, 4]) {
      for (const capCount of [1, 3, 5]) {
        out.push(...islandParcels(`story-${rings}-${capCount}`, rings, capCount, mode, TESTS));
      }
    }
  }
  return out.filter((p) => p.cells.length > 0);
}

/** How many placements each parcel is asked for. The real budgets run to a few dozen; more samples
 *  measure the same distribution more tightly, and the concentration index is normalised by count. */
const SAMPLES = 120;

/** The pre-fix positioner, as three literal lines. A CONTROL, not a reference implementation: it is
 *  what makes the containment assertion falsifiable on this fixture. */
function preFixSpot(cells: ParcelCell[], tests: number, rand: () => number): () => Pt {
  const anchors: Pt[] = [];
  const n = tests >= 7 ? 2 : 1;
  for (let d = 0; d < n; d++) {
    const c = cells[Math.floor(rand() * cells.length)]!;
    anchors.push({ x: c.cx, y: c.cy });
  }
  const spread = 7 + Math.max(0, tests) * 0.55;
  return (): Pt => {
    const a = anchors[Math.floor(rand() * anchors.length)]!;
    const ang = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * spread;
    return { x: a.x + Math.cos(ang) * rr, y: a.y + Math.sin(ang) * rr * 0.6 };
  };
}

function placementsOf(
  positioner: (c: ParcelCell[], t: number, r: () => number) => () => Pt,
  p: Parcel,
): Pt[] {
  const spot = positioner(p.cells, p.testCount, streamRand(`parcel:drift-test:${p.capId}`));
  return Array.from({ length: SAMPLES }, () => spot());
}

const onParcel = (q: Pt, cells: readonly ParcelCell[]): boolean =>
  cells.some((c) => pointInPoly(q.x, q.y, c.poly));

// ---------------------------------------------------------------------------------------------
// THE FIX'S OWN PROOF
// ---------------------------------------------------------------------------------------------

test('every drift placement stands inside the parcel whose status tints it', () => {
  const parcels = sweep();
  assert.ok(parcels.length >= 100, `the sweep must actually build parcels, got ${parcels.length}`);

  let placements = 0;
  let escaped = 0;
  const worst: string[] = [];
  for (const p of parcels) {
    for (const q of placementsOf(driftSpot, p)) {
      placements += 1;
      if (!onParcel(q, p.cells)) {
        escaped += 1;
        if (worst.length < 5) worst.push(`${p.capId} (tests=${p.testCount}) → ${q.x.toFixed(2)},${q.y.toFixed(2)}`);
      }
    }
  }
  assert.ok(placements >= 10_000, `too few placements to mean anything: ${placements}`);
  assert.equal(
    escaped,
    0,
    `${escaped} of ${placements} placements carry a capability's tint while standing off its ` +
      `parcel — a false claim about the capability they land on. First few: ${worst.join('; ')}`,
  );
});

// ---------------------------------------------------------------------------------------------
// (a) THE TEETH — the defect was real, and this fixture can express it
// ---------------------------------------------------------------------------------------------

test('the defect was real: the pre-fix positioner escapes this same fixture', () => {
  const parcels = sweep();
  let placements = 0;
  let escaped = 0;
  for (const p of parcels) {
    for (const q of placementsOf(preFixSpot, p)) {
      placements += 1;
      if (!onParcel(q, p.cells)) escaped += 1;
    }
  }
  const rate = escaped / placements;
  // Re-measured on today's code at 10.21% over 90,800 placements; this sweep is a subset of that
  // one, so the band is generous either side. What it forbids is the fixture quietly becoming one
  // nothing could escape, which would make the assertion above vacuous without failing it.
  assert.ok(
    rate > 0.05 && rate < 0.25,
    `the pre-fix positioner escaped on ${(rate * 100).toFixed(2)}% of ${placements} placements; ` +
      `outside 5-25% means the fixture no longer describes the defect, so the containment test ` +
      `above is no longer proving anything`,
  );
});

test('the escape rate grows with the bed, which is why the density budget made it worse', () => {
  // The spread is `7 + tests·0.55`, so a well-tested capability plants over a wider bed and drifts
  // further off it. Pinning the DIRECTION (not a value) keeps the control honest about the mechanism
  // rather than about one number.
  const parcels = sweep();
  const rateAt = (tests: number): number => {
    let placements = 0;
    let escaped = 0;
    for (const p of parcels) {
      for (const q of placementsOf(preFixSpot, { ...p, testCount: tests })) {
        placements += 1;
        if (!onParcel(q, p.cells)) escaped += 1;
      }
    }
    return escaped / placements;
  };
  const bare = rateAt(0);
  const dense = rateAt(20);
  assert.ok(
    dense > bare * 2,
    `a bed of spread 18.0 should escape far more than one of spread 7.0; got ` +
      `${(bare * 100).toFixed(2)}% vs ${(dense * 100).toFixed(2)}%`,
  );
});

// ---------------------------------------------------------------------------------------------
// (b) THE TEETH — the massing survived, and the fix did not collapse the bed onto its anchor
// ---------------------------------------------------------------------------------------------

/** Mean neighbours within {@link NEIGHBOUR_R} per placement, over the count a UNIFORM scatter of the
 *  same population across the same parcel area would give. 1.0 is a uniform scatter; the owner's
 *  2026-07-18 drift beds measure ~9. */
const NEIGHBOUR_R = 4;

function concentration(parcels: readonly Parcel[]): number {
  let num = 0;
  let den = 0;
  for (const p of parcels) {
    const area = p.cells.reduce((s, c) => s + polyArea(c.poly), 0);
    if (area <= 0) continue;
    const pts = placementsOf(driftSpot, p);
    let neigh = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue;
        // ground-space: a separation between two placements inside ONE parcel, compared against
        // that parcel's own area, so both sides of the ratio wear the projection identically and it
        // cancels. The index is dimensionless and camera-independent by construction.
        if (Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y) <= NEIGHBOUR_R) neigh += 1;
      }
    }
    num += neigh / pts.length;
    den += ((pts.length - 1) * Math.PI * NEIGHBOUR_R * NEIGHBOUR_R) / area;
  }
  return num / den;
}

test('the drift-bed massing survived the fix — it is a decision, not a side effect', () => {
  const parcels = sweep();
  const ratio = concentration(parcels);
  // Measured 8.20x before the fix and 8.73x after, over 90,800 placements. It tightens slightly, and
  // that is the arithmetic working: the placements the fix removes are the outermost ones. The floor
  // is what matters — a "fix" that spread the marks evenly over the parcel to guarantee containment
  // would land near 1.0 and would have broken the owner's 2026-07-18 garden.
  assert.ok(
    ratio > 5 && ratio < 20,
    `the beds measure ${ratio.toFixed(2)}x a uniform scatter; below ~5 the massing has been ` +
      `flattened (an owner decision traded away to fix a bug), above ~20 it has collapsed`,
  );
});

test('the placements stay distinct — the fix resamples, it does not pile marks on the anchor', () => {
  // The cheapest way to pass the containment test is to return the anchor every time. It is inside
  // the parcel, it is deterministic, and it would draw every plant in a capability's garden on one
  // spot. This is the assertion that forbids it.
  const parcels = sweep();
  let total = 0;
  let distinct = 0;
  for (const p of parcels) {
    const pts = placementsOf(driftSpot, p);
    total += pts.length;
    distinct += new Set(pts.map((q) => `${q.x.toFixed(4)},${q.y.toFixed(4)}`)).size;
  }
  assert.ok(
    distinct / total > 0.98,
    `only ${distinct} of ${total} placements are distinct — the positioner is falling back to its ` +
      `anchor instead of resampling (measured 99.99% distinct after the fix)`,
  );
});

test("the bed keeps its top-down SQUASH — the massing has a shape, not just a density", () => {
  // The concentration index above says how TIGHT the bed is; it says nothing about its shape, and a
  // bed stretched along the depth axis would pass it while looking wrong on a map whose ground is
  // seen at 20 degrees. The y-radius wears the same squash the wisp orbit uses (`* 0.6`), so the bed
  // is drawn WIDER THAN IT IS TALL, in that ratio. Turning the squash into a stretch is a one-
  // character change and it moves the owner's 2026-07-18 massing, which is the thing this fix is
  // required not to touch.
  //
  // Measured on one whole-island parcel so containment clips as little as possible: the resample
  // conditions the bed on the parcel, and near a boundary that shortens whichever axis runs into it.
  const parcel = islandParcels('squash-fixture', 4, 1, 'mesh', [4])[0]!;
  assert.ok(parcel.cells.length > 30, 'the fixture must be a whole island, so the bed is barely clipped');
  const spot = driftSpot(parcel.cells, parcel.testCount, streamRand('squash'));
  const pts = Array.from({ length: 3000 }, () => spot());
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = (xs: number[]): number => {
    const m = mean(xs);
    return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
  };
  const ratio = sd(pts.map((p) => p.x)) / sd(pts.map((p) => p.y));
  assert.ok(
    ratio > 1.25 && ratio < 2.2,
    `the bed measures ${ratio.toFixed(2)}x wider than tall; the 0.6 squash puts it near 1.67, and a ` +
      `ratio near 0.6 means the squash became a STRETCH — the drift bed's shape has moved`,
  );
});

// ---------------------------------------------------------------------------------------------
// (c) THE TEETH — containment spans the WHOLE parcel, not the anchor's own cell
// ---------------------------------------------------------------------------------------------

test('a drift bed spreads across its parcel, not just the cell its anchor came from', () => {
  // `onParcel` asks `cells.some(...)`. Narrowing it to the anchor's own cell would also pass the
  // containment test — and would confine every capability's whole garden to one mesh cell, which is
  // a different, quieter version of the same lie. So require the bed to reach cells the anchor is
  // not in.
  const parcels = sweep().filter((p) => p.cells.length >= 4 && p.testCount >= 7);
  assert.ok(parcels.length > 0, 'the sweep must contain multi-cell parcels with a real bed');
  let spanning = 0;
  for (const p of parcels) {
    const pts = placementsOf(driftSpot, p);
    const hit = new Set<number>();
    for (const q of pts) {
      const idx = p.cells.findIndex((c) => pointInPoly(q.x, q.y, c.poly));
      if (idx >= 0) hit.add(idx);
    }
    if (hit.size >= 2) spanning += 1;
  }
  assert.ok(
    spanning / parcels.length > 0.9,
    `only ${spanning} of ${parcels.length} beds reach more than one of their parcel's cells; the ` +
      `containment test has been narrowed to the anchor's own cell`,
  );
});

// ---------------------------------------------------------------------------------------------
// EXHAUSTION — the escape hatch cannot itself escape
// ---------------------------------------------------------------------------------------------

/** A pathological parcel: one cell far smaller than the bed drawn over it, so almost every candidate
 *  is rejected and the resample bound is what actually runs. Real parcels never look like this — the
 *  point is to reach the branch a real parcel reaches 12 times in 90,800. */
const TINY_CELL: ParcelCell[] = [
  { poly: [{ x: 100, y: 100 }, { x: 100.5, y: 100 }, { x: 100.5, y: 100.5 }, { x: 100, y: 100.5 }], cx: 100.25, cy: 100.25 },
];

test('when the bed cannot be satisfied, the placement falls back onto its anchor — and stays inside', () => {
  const spot = driftSpot(TINY_CELL, 20, streamRand('exhaustion'));
  const pts = Array.from({ length: 300 }, () => spot());
  const anchor = { x: TINY_CELL[0]!.cx, y: TINY_CELL[0]!.cy };

  for (const q of pts) {
    assert.ok(
      pointInPoly(q.x, q.y, TINY_CELL[0]!.poly),
      `exhaustion put a placement at ${q.x},${q.y}, outside the only cell there is — the fallback ` +
        `must be a point the parcel provably contains`,
    );
  }
  const onAnchor = pts.filter((q) => q.x === anchor.x && q.y === anchor.y).length;
  assert.ok(
    onAnchor > 250,
    `a 0.5-unit cell under a spread-18 bed rejects almost every candidate, so the fallback branch ` +
      `should carry almost all of these; it carried ${onAnchor} of ${pts.length}`,
  );
});

test('the resample bound is exactly what it says — a counted stream, not a promise', () => {
  // The bound is not decoration: every `spot()` draws from the parcel's SHARED seeded stream, so how
  // many values it takes decides where every LATER mark on that parcel lands. An unbounded retry
  // would make the whole surface a function of how awkward one parcel's geometry happened to be.
  //
  // Counting the draws is the only way to see the bound from outside — the placements a bounded and
  // an off-by-one loop produce are indistinguishable on any real parcel, which is exactly why the
  // constant's own doc calls it a bound rather than a tuning knob. On the pathological cell below
  // every candidate is rejected, so the loop runs to exhaustion and the count is exact.
  const base = streamRand('draw-count');
  let draws = 0;
  const counting = (): number => {
    draws += 1;
    return base();
  };
  const spot = driftSpot(TINY_CELL, 20, counting);
  const afterBuild = draws;
  assert.equal(afterBuild, 2, 'two anchors are picked at tests >= 7, one draw each');
  spot();
  assert.equal(
    draws - afterBuild,
    1 + 2 * DRIFT_CONTAINMENT_TRIES,
    'one draw to choose the anchor, then an angle and a radius per attempt, and no more',
  );
});

test('every anchor is a point its own parcel contains — what licenses the fallback at all', () => {
  // The fallback returns the anchor, so the whole guarantee rests on an anchor being inside. An
  // anchor is a mesh cell's vertex-mean centroid, and the mesh's cells are convex, so it is — but
  // "so it is" is exactly the kind of claim this repo has been wrong about, so it is measured.
  let anchors = 0;
  let outside = 0;
  for (const p of sweep()) {
    for (const c of p.cells) {
      anchors += 1;
      if (!onParcel({ x: c.cx, y: c.cy }, p.cells)) outside += 1;
    }
  }
  assert.ok(anchors > 1000, `too few anchors to mean anything: ${anchors}`);
  assert.equal(outside, 0, `${outside} of ${anchors} anchors sit outside their own parcel`);
});

// ---------------------------------------------------------------------------------------------
// determinism — the seam's own frozen contract (ADR-0208): draw only from `rand`
// ---------------------------------------------------------------------------------------------

test('the positioner stays deterministic — same cells, same tests, same seed, same bed', () => {
  const p = sweep().find((q) => q.cells.length >= 4 && q.testCount >= 7)!;
  const once = placementsOf(driftSpot, p);
  const twice = placementsOf(driftSpot, p);
  assert.deepEqual(once, twice);
  // …and a different seed really does give a different bed, so the equality above is not the trivial
  // consequence of a positioner that ignores its stream.
  const spot = driftSpot(p.cells, p.testCount, streamRand('a-different-parcel'));
  const other = Array.from({ length: SAMPLES }, () => spot());
  assert.notDeepEqual(once, other);
});
