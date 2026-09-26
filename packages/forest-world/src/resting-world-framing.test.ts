// resting-world-framing.test.ts — the 3D canvas's adoption of ADR-0471's designed resting frame.
//
// ⚠ THE ASSERTIONS ARE RELATIONS AND INDEPENDENT DERIVATIONS, never numbers remembered from a run.
// The composition is `RESTING_ISLAND_SPANS` median islands across the frame's shorter side, so the
// test re-derives that from the shared constant and checks the CAMERA delivers it — which is the
// only thing that can fail if the conversion `halfHeight = shortSide / (2 * scale)` is inverted,
// dropped, or applied to the wrong side.
//
// ⚠ AND THE FORESHORTENING IS DERIVED HERE TOO. `restingFrame` compares island sizes against a
// frame in CSS px, so what it must be handed is what the eye DELIVERS — ground x at 1, ground z at
// `sin(elevation)`. A version that fed it raw ground depth would still return a plausible scale
// and would open the view on the wrong amount of forest; the fixtures below are deliberately
// oblong in z so that mistake is separable.

import assert from 'node:assert/strict';
import test from 'node:test';

import { RESTING_ISLAND_SPANS, groundFlattening } from './core/index.js';

import {
  CLIP_HEADROOM,
  SHIPPED_ELEVATION_DEG,
  SHIPPED_GROUND_FLATTENING,
  frameWorld,
  islandDeliveredDiameters,
  orthographicZoomFor,
  restingWorldFraming,
  type CameraFraming,
  type RestingWorldFraming,
} from './camera-framing.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/** A square parcel of side `side` centred on (`cx`, `cz`), attributed to island `id`. The ring is
 *  what an island's measured diameter comes from, so the fixture supplies rings rather than points. */
function parcel(id: string, cx: number, cz: number, side: number): InstanceDescriptor {
  const h = side / 2;
  return {
    kind: 'cell-ground',
    transform: { x: cx, y: 0, z: cz },
    group: 'cell-ground',
    material: 'healthy',
    island: id,
    points: [
      { x: cx - h, y: 0, z: cz - h },
      { x: cx + h, y: 0, z: cz - h },
      { x: cx + h, y: 0, z: cz + h },
      { x: cx - h, y: 0, z: cz + h },
    ],
  };
}

/** `count` same-sized islands strung down the z axis `pitch` apart — the real forest's own shape
 *  (a thin deep ribbon), which is what makes the z axis the binding one. */
function ribbon(count: number, side: number, pitch: number): InstanceDescriptor[] {
  return Array.from({ length: count }, (_, i) => parcel(`s-${i}`, 0, i * pitch, side));
}

const VIEWPORT = { width: 1600, height: 900 };

test('an island DIAMETER is the ground extent of its own parcels, not a prop count', () => {
  const island = [parcel('a', 0, 0, 40), parcel('a', 60, 0, 40)];
  // Two 40-wide parcels 60 apart span 100 across the ground; delivered depth is only
  // `40 · sin 50°`, so the larger side — the ground diameter — is the 100.
  assert.deepEqual(islandDeliveredDiameters(island), [100]);
});

test('a bloom or a cave on an island does not enlarge it', () => {
  const land = [parcel('a', 0, 0, 40)];
  const withProps: InstanceDescriptor[] = [
    ...land,
    { kind: 'uat-bloom', transform: { x: 500, y: 0, z: 0 }, group: 'uat-bloom', island: 'a' },
    { kind: 'cave-arch', transform: { x: -500, y: 0, z: 0 }, group: 'cave-arch', island: 'a' },
  ];
  assert.deepEqual(islandDeliveredDiameters(withProps), islandDeliveredDiameters(land));
});

test('an island with no id is not counted, rather than counted as one nameless island', () => {
  const anonymous: InstanceDescriptor = {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    points: [
      { x: -5, y: 0, z: -5 },
      { x: 5, y: 0, z: -5 },
      { x: 5, y: 0, z: 5 },
    ],
  };
  assert.deepEqual(islandDeliveredDiameters([anonymous]), []);
  assert.deepEqual(islandDeliveredDiameters([...ribbon(3, 40, 200), anonymous]).length, 3);
});

test('the delivered SCALE spans RESTING_ISLAND_SPANS median islands across the shorter side', () => {
  const side = 40;
  const framing = restingWorldFraming(ribbon(9, side, 300), VIEWPORT);
  const zoom = orthographicZoomFor(framing.halfHeight, Math.min(VIEWPORT.width, VIEWPORT.height));
  // `zoom` IS the delivered CSS px per world unit, so the composition is checkable end to end:
  // nine median islands must fill the shorter side exactly.
  const shortSide = Math.min(VIEWPORT.width, VIEWPORT.height);
  assert.ok(Math.abs(zoom * side * RESTING_ISLAND_SPANS - shortSide) < 1e-6, `zoom ${zoom}`);
  assert.equal(framing.resting.bound, 'designed');
  // And the round trip is exact: the scale the rule chose is the zoom the camera lands at.
  assert.ok(Math.abs(zoom - framing.resting.scale) < 1e-9);
});

test('the frame is measured in DELIVERED space — ground depth counts at sin(elevation)', () => {
  // A forest of one very deep island. Fed raw ground depth its extent would be `depth`; delivered
  // it is `depth · sin 50°`, which is what decides whether the whole world already fits inside the
  // designed frame ('whole-world') or has to be cropped to it ('designed').
  assert.ok(Math.abs(SHIPPED_GROUND_FLATTENING - groundFlattening(SHIPPED_ELEVATION_DEG)) < 1e-12);
  assert.ok(SHIPPED_GROUND_FLATTENING < 1, 'the shipped eye is not plan view');

  const framing = restingWorldFraming(ribbon(9, 40, 300), VIEWPORT);
  const zoom = orthographicZoomFor(framing.halfHeight, Math.min(VIEWPORT.width, VIEWPORT.height));
  // The world's delivered height, at the scale the rule chose, against the frame it was given.
  const groundDepth = 8 * 300 + 40;
  const deliveredHeightPx = groundDepth * SHIPPED_GROUND_FLATTENING * zoom;
  const rawHeightPx = groundDepth * zoom;
  assert.ok(deliveredHeightPx > VIEWPORT.height, 'the ribbon still runs off the frame');
  assert.ok(
    Math.abs(deliveredHeightPx / rawHeightPx - SHIPPED_GROUND_FLATTENING) < 1e-9,
    'the two readings differ by exactly the foreshortening, so the choice is separable',
  );
  // ⚠ AND THE SEPARATION IS ASSERTED, not merely shown to exist. `extentShown` is the fraction of
  // the world the frame opens on, so it is computed from the world's own extent — feeding raw
  // ground depth there reports a view onto LESS of the forest than the eye actually shows, and the
  // two answers differ by exactly `sin 50°` on a world this frame is height-bound by.
  assert.ok(Math.abs(framing.resting.extentShown - VIEWPORT.height / deliveredHeightPx) < 1e-9);
  assert.ok(
    Math.abs(framing.resting.extentShown - VIEWPORT.height / rawHeightPx) > 0.04,
    'the raw-depth reading is a different number, so this assertion chooses between them',
  );
});

test('the view is BOTTOM-ANCHORED on the world, the way the 2D map is', () => {
  const framing = restingWorldFraming(ribbon(9, 40, 300), VIEWPORT);
  const zoom = orthographicZoomFor(framing.halfHeight, Math.min(VIEWPORT.width, VIEWPORT.height));
  // The world's bottom edge is its LARGEST ground z (SVG y → 3D z, so +z is the bottom of the
  // page): the last island's far parcel edge.
  const worldBottomZ = 8 * 300 + 20;
  // The frame's own bottom edge, in ground z: the target plus half a frame-height of delivered
  // depth converted back to ground.
  const halfFrameGroundZ = VIEWPORT.height / (2 * zoom) / SHIPPED_GROUND_FLATTENING;
  const frameBottomZ = framing.target[2] + halfFrameGroundZ;
  assert.ok(Math.abs(frameBottomZ - worldBottomZ) < 1e-6, `frame bottom ${frameBottomZ}`);
  // Horizontally centred on the world, which the ribbon puts at x = 0.
  assert.ok(Math.abs(framing.target[0]) < 1e-9);
  // ⚠ The crop is the point: a resting scale tighter than the fit must leave the canopy off the
  // top, or bottom-anchoring would be a distinction with no consequence.
  const worldTopZ = -20;
  assert.ok(framing.target[2] - halfFrameGroundZ > worldTopZ, 'the top of the forest is cropped');
});

test('the eye keeps the FIT’s offset, so near/far still contain a world the viewer pans across', () => {
  const world = ribbon(9, 40, 300);
  const fit = frameWorld([...world]);
  const framing = restingWorldFraming(world, VIEWPORT);
  const fitOffset = [fit.position[1] - fit.target[1], fit.position[2] - fit.target[2]];
  const restingOffset = [
    framing.position[1] - framing.target[1],
    framing.position[2] - framing.target[2],
  ];
  assert.ok(Math.abs(restingOffset[0]! - fitOffset[0]!) < 1e-9);
  assert.ok(Math.abs(restingOffset[1]! - fitOffset[1]!) < 1e-9);
  // …and the framing itself is NOT the fit's, or there would be nothing to adopt.
  assert.ok(Math.abs(framing.halfHeight - fit.halfHeight) > 1);
});

test('an empty world falls through to the fit rather than inventing a composition', () => {
  const framing = restingWorldFraming([], VIEWPORT);
  const fit = frameWorld([]);
  assert.deepEqual(framing.target, fit.target);
  assert.deepEqual(framing.position, fit.position);
  assert.equal(framing.halfHeight, fit.halfHeight);
  assert.equal(framing.resting.bound, 'undetermined');
});

test('a zero-sized viewport falls through to the fit rather than dividing by it', () => {
  const world = ribbon(3, 40, 300);
  for (const viewport of [{ width: 0, height: 900 }, { width: 1600, height: 0 }]) {
    const framing = restingWorldFraming(world, viewport);
    assert.equal(framing.halfHeight, frameWorld([...world]).halfHeight);
    assert.equal(framing.resting.bound, 'undetermined');
  }
});

test('a world with land but no NAMED island still frames, on the extent floor', () => {
  // The composition has nothing to pin to, so `restingFrame` reports `undetermined` and falls back
  // to the fit — which must still be a fit of the DELIVERED world, not a divide by zero.
  const anonymous: InstanceDescriptor = {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    points: [
      { x: -100, y: 0, z: -100 },
      { x: 100, y: 0, z: -100 },
      { x: 100, y: 0, z: 100 },
      { x: -100, y: 0, z: 100 },
    ],
  };
  const framing = restingWorldFraming([anonymous], VIEWPORT);
  assert.equal(framing.resting.bound, 'undetermined');
  assert.ok(Number.isFinite(framing.halfHeight) && framing.halfHeight > 0);
});

// ---------------------------------------------------------------------------
// ONE AWKWARD WORLD — off-centre, mixed-shape, and carrying the two descriptor shapes the
// symmetric ribbon above cannot separate.
// ---------------------------------------------------------------------------
//
// ⚠ THE RIBBON FIXTURE IS SYMMETRIC ABOUT x = 0 AND ITS ISLANDS ARE SQUARE, and a symmetric
// fixture cannot tell a difference from a sum: `minU + maxU` and `maxU - minU` are the same number
// when the world straddles the origin, and an island's delivered box binds on whichever side you
// like when it is as wide as it is deep. `check:mutation-diff` found exactly that hole — five
// mutants of the world's own arithmetic survived it. So this world is deliberately awkward:
//
//   · OFF-CENTRE in x, so a centre is not a half-width and a span is not a sum;
//   · WIDE ENOUGH that the frame does not contain its width, so `extentShown`'s width term is a
//     real reading rather than a clamp at 1;
//   · one island far DEEPER than it is wide and far from the origin, so its delivered depth is
//     what its diameter binds on;
//   · a POINT-LIKE instance (a wisp carries no ring) standing at the world's far edge, so the
//     extent has to read an anchor rather than only rings;
//   · and an island whose only cell has an EMPTY ring, which bounds nothing and must be passed
//     over rather than counted as an island of no size.

/** A rectangular parcel from (`x0`, `z0`) to (`x1`, `z1`) on the ground. */
function box(island: string, x0: number, z0: number, x1: number, z1: number): InstanceDescriptor {
  return {
    kind: 'cell-ground',
    transform: { x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2 },
    group: 'cell-ground',
    material: 'healthy',
    island,
    points: [
      { x: x0, y: 0, z: z0 },
      { x: x1, y: 0, z: z0 },
      { x: x1, y: 0, z: z1 },
      { x: x0, y: 0, z: z1 },
    ],
  };
}

const AWKWARD: InstanceDescriptor[] = [
  // 120 across, 40 deep, off to the +x side of the origin.
  box('wide', 1000, 0, 1120, 40),
  // 10 across, 200 deep, far down the +z axis — its DELIVERED depth (200 · sin 50° = 153) is what
  // its diameter binds on, and its z centre is nowhere near the origin.
  box('deep', 1000, 2000, 1010, 2200),
  // Carries no ring at all: a point-like family standing at the world's far +x edge.
  { kind: 'wisp-sprite', transform: { x: 3200, y: 0, z: 0 }, group: 'wisp-sprite' },
  // An island whose only cell bounds nothing. It is not an island of size zero — it is an island
  // there is nothing to measure, and folding a zero in would drag the median toward a size no
  // island has.
  { kind: 'cell-ground', transform: { x: 1000, y: 0, z: 0 }, group: 'cell-ground', island: 'ghost', points: [] },
];

/** The awkward world's expected numbers, DERIVED here from the fixture and the shared constants
 *  rather than recalled from a run. */
function awkwardExpectation(viewport: { width: number; height: number }) {
  const f = SHIPPED_GROUND_FLATTENING;
  const wide = Math.max(120, 40 * f);
  const deep = Math.max(10, 200 * f);
  // Two islands, so `restingFrame` takes the LOWER median — a size an island really is.
  const median = Math.min(wide, deep);
  const scale = Math.min(viewport.width, viewport.height) / (RESTING_ISLAND_SPANS * median);
  const minU = 1000;
  const maxU = 3200; // the wisp, which carries no ring
  const contentWidth = maxU - minU;
  const contentHeight = 2200 * f; // v runs from -2200·f (the deep island's far edge) up to 0
  const shown = (framePx: number, units: number) => Math.min(1, framePx / (units * scale));
  return {
    scale,
    targetX: (minU + maxU) / 2,
    extentShown: shown(viewport.width, contentWidth) * shown(viewport.height, contentHeight),
  };
}

test('an island with an EMPTY ring is passed over, not counted as an island of no size', () => {
  // Two islands have land; the third bounds nothing. A zero diameter would become the median and
  // blow the composition open — and reading its box without checking would be a crash.
  assert.equal(islandDeliveredDiameters(AWKWARD).length, 2);
  assert.ok(islandDeliveredDiameters(AWKWARD).every((d) => d > 0));
});

test('a DEEP island’s diameter binds on its delivered depth, wherever it sits', () => {
  const deepOnly = [box('deep', 1000, 2000, 1010, 2200)];
  const [d] = islandDeliveredDiameters(deepOnly);
  // 200 units of ground depth deliver `200 · sin 50°`, which is still more than its 10-unit width.
  assert.ok(d !== undefined && Math.abs(d - 200 * SHIPPED_GROUND_FLATTENING) < 1e-9, `diameter ${d}`);
});

test('the awkward world frames on its own extent, centre and anchor — every term read', () => {
  const viewport = { width: 1600, height: 900 };
  const want = awkwardExpectation(viewport);
  const framing = restingWorldFraming(AWKWARD, viewport);
  assert.equal(framing.resting.bound, 'designed');
  assert.ok(Math.abs(framing.resting.scale - want.scale) < 1e-9, `scale ${framing.resting.scale}`);
  // The horizontal centre is a MIDPOINT of the world's own edges — and the +x edge is the wisp's
  // anchor, which is the point-like instance the ring-only reading would have dropped.
  assert.ok(Math.abs(framing.target[0] - want.targetX) < 1e-9, `target x ${framing.target[0]}`);
  // `extentShown` reads both spans, and neither is clamped here — this world is wider than the
  // frame shows and deeper than it shows.
  assert.ok(framing.resting.extentShown < 1 && framing.resting.extentShown > 0);
  assert.ok(
    Math.abs(framing.resting.extentShown - want.extentShown) < 1e-9,
    `extentShown ${framing.resting.extentShown} wanted ${want.extentShown}`,
  );
});

test('dropping the point-like instance would move the frame — so its anchor really is read', () => {
  // The separation, stated: without the wisp the world is 120 units wide instead of 2200, so both
  // the centre and the fraction shown move. This is what makes the assertions above choose.
  const withoutWisp = AWKWARD.filter((d) => d.kind !== 'wisp-sprite');
  const viewport = { width: 1600, height: 900 };
  const full = restingWorldFraming(AWKWARD, viewport);
  const short = restingWorldFraming(withoutWisp, viewport);
  assert.ok(Math.abs(full.target[0] - short.target[0]) > 100);
  assert.ok(full.resting.extentShown < short.resting.extentShown);
});

// ---------------------------------------------------------------------------
// THE CLIP RANGE — the defect the first real mount found, and the shape of the fixture that
// finds it again.
// ---------------------------------------------------------------------------
//
// ⚠⚠ THE FIXTURE HAS TO BE BIG, and that is the whole finding. The canvas shipped with
// `near: 1, far: 4000` written into its JSX and a comment asserting that range contained the
// world. It did — for every fixture this package had. storytree's real forest is 661 x 3524 ground
// units, and at that size the eye backs off far enough that the GROUND sits behind the far plane:
// measured 2026-09-08, 6227 to 8492 along the view direction, and the studio's land view came up
// 99.8% background with nothing erroring and every test here green. A fixed clip range cannot fail
// on a fixture smaller than itself, so the assertions below are stated at the REAL forest's scale.

/** The ground extent of storytree's real 35-island forest, measured off the live studio's own
 *  scene on 2026-09-08 — the size that broke the shipped pair. */
const REAL_FOREST = { width: 661, depth: 3524 };

/** A forest of that extent: islands strung down the depth axis, which is the real shape. */
function realScaleForest(): InstanceDescriptor[] {
  const count = 35;
  const pitch = REAL_FOREST.depth / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    parcel(`s-${i}`, (i % 2) * REAL_FOREST.width, i * pitch, 48),
  );
}

/** Every ground point's distance from the eye ALONG THE VIEW DIRECTION — what `near`/`far` clip. */
function depthsAlongView(instances: readonly InstanceDescriptor[], framing: RestingWorldFraming | CameraFraming): number[] {
  const [ex, ey, ez] = framing.position;
  const dx = framing.target[0] - ex;
  const dy = framing.target[1] - ey;
  const dz = framing.target[2] - ez;
  const len = Math.hypot(dx, dy, dz);
  const out: number[] = [];
  for (const i of instances) {
    for (const p of i.points ?? [i.transform]) {
      out.push(((p.x - ex) * dx + (p.y - ey) * dy + (p.z - ez) * dz) / len);
    }
  }
  return out;
}

test('the REAL forest’s ground is inside the clip range — the fixed 1/4000 pair was not', () => {
  const world = realScaleForest();
  const framing = restingWorldFraming(world, VIEWPORT);
  const depths = depthsAlongView(world, framing);
  const nearest = Math.min(...depths);
  const farthest = Math.max(...depths);
  assert.ok(framing.near < nearest, `near ${framing.near} must be in front of ${nearest}`);
  assert.ok(framing.far > farthest, `far ${framing.far} must be behind ${farthest}`);
  // ⚠ NON-VACUITY, and it is the whole point: the range this replaces really did cut the world out.
  // Without it the assertions above would pass on any fixture and prove nothing.
  assert.ok(farthest > 4000, `the shipped far plane was 4000 and this world reaches ${farthest}`);
});

test('the range survives a PAN to the far end of the forest, which is what MapControls allows', () => {
  // The viewer drags the target across the world; the eye follows. A range bracketed around the
  // OPENING view would clip the moment someone panned to the other end, which is the same defect
  // arriving a gesture later instead of at mount.
  const world = realScaleForest();
  const framing = restingWorldFraming(world, VIEWPORT);
  const [ex, ey, ez] = framing.position;
  const [tx, ty, tz] = framing.target;
  for (const shift of [-REAL_FOREST.depth, REAL_FOREST.depth]) {
    const panned: CameraFraming = {
      target: [tx, ty, tz + shift],
      position: [ex, ey, ez + shift],
      halfHeight: framing.halfHeight,
      near: framing.near,
      far: framing.far,
    };
    const depths = depthsAlongView(world, panned);
    assert.ok(framing.near < Math.min(...depths), `panned by ${shift}: near clips`);
    assert.ok(framing.far > Math.max(...depths), `panned by ${shift}: far clips`);
  }
});

test('the FIT framing gets the same range — the defect was the canvas’s, not one framing rule’s', () => {
  // `frameWorld` is what the harness's own pages open on, and it backs the eye off by the same
  // rule. Fixing only the resting path would leave the fit clipping a big world.
  const world = realScaleForest();
  const fit = frameWorld([...world]);
  const depths = depthsAlongView(world, fit);
  assert.ok(fit.near < Math.min(...depths));
  assert.ok(fit.far > Math.max(...depths));
});

test('an empty world still gets a usable range rather than a degenerate one', () => {
  const fit = frameWorld([]);
  assert.ok(Number.isFinite(fit.near) && Number.isFinite(fit.far));
  assert.ok(fit.far > fit.near);
});

/** What a re-derivation of the clip rule measured: the radius the rule was derived against, and the
 *  radius the RINGS alone would have given. Named rather than returned anonymously — the anti-slop
 *  rule that binds source binds tests too (`overrides` is empty). */
interface ClipDerivation {
  radius: number;
  ringRadius: number;
}

/** Re-derive the clip rule for one world and hold the framing to it, so a caller can state which of
 *  the two radii its fixture actually exercises. */
function assertClipRangeRule(
  world: readonly InstanceDescriptor[],
  viewport: { width: number; height: number },
): ClipDerivation {
  const framing = restingWorldFraming(world, viewport);
  const [ex, ey, ez] = framing.position;
  const [tx, ty, tz] = framing.target;
  const eyeDistance = Math.hypot(ex - tx, ey - ty, ez - tz);
  const far = (p: { x: number; y: number; z: number }) => Math.hypot(p.x - tx, p.y - ty, p.z - tz);
  let radius = 0;
  let ringRadius = 0;
  for (const instance of world) {
    // ⚠ THE POINT-LIKE FALLBACK IS PART OF THE RULE: an instance with no ring contributes the point
    // it stands at, and where that point is the farthest thing in the world, dropping it brings the
    // far plane in ahead of something the canvas draws.
    for (const p of instance.points ?? [instance.transform]) radius = Math.max(radius, far(p));
    for (const p of instance.points ?? []) ringRadius = Math.max(ringRadius, far(p));
  }
  const reach = 2 * radius + CLIP_HEADROOM;
  assert.ok(Math.abs(framing.far - (eyeDistance + reach)) < 1e-9, `far ${framing.far}`);
  assert.ok(Math.abs(framing.near - (eyeDistance - reach)) < 1e-9, `near ${framing.near}`);
  // NON-VACUITY: the target is nowhere near the origin, so every `a - b` in the derivation really
  // is a different number from `a + b`.
  assert.ok(Math.abs(tx) > 100 || Math.abs(tz) > 100, 'the target is off the origin, so signs matter');
  return { radius, ringRadius };
}

test('the clip range IS the stated rule, re-derived \u2014 containment alone acquits a sign error', () => {
  // ⚠⚠ CONTAINMENT IS NOT ENOUGH, and `check:mutation-diff` said so: every sign error inside
  // `clipRange` makes the range WIDER, so a test that only asks "is the world inside?" passes on
  // all of them. Six mutants survived exactly that — the eye distance's three terms, the radius's
  // three, and dropping the point-like fallback. So the rule is re-derived here instead: bracket
  // the eye's OWN distance from the target by twice the world's radius about that target, plus
  // `CLIP_HEADROOM` for what stands on the ground.
  assertClipRangeRule(AWKWARD, { width: 1600, height: 900 });
  assertClipRangeRule(realScaleForest(), VIEWPORT);
});

test('a POINT-LIKE instance at the world\u2019s far edge sets the range, ring or no ring', () => {
  // ⚠ A SEPARATE FIXTURE, AND ITS SHAPE IS FORCED. In the awkward world above the deep island is
  // farther from the target than the wisp, so that world exercises the rule but cannot show that
  // the ringless fallback matters — and neither can the obvious "wisp far past the land", because
  // the frame BOTTOM-ANCHORS on the world's own bottom edge, so a wisp that defines that edge drags
  // the target to itself. What separates the two is a ringless instance at the world's TOP, which
  // the anchor runs AWAY from: the land sits deep, the frame anchors on the land, and the wisp is
  // then the farthest thing from the target by a wide margin.
  const world: InstanceDescriptor[] = [
    parcel('home', 0, 3000, 40),
    parcel('home', 60, 3000, 40),
    { kind: 'wisp-sprite', transform: { x: 30, y: 0, z: 0 }, group: 'wisp-sprite' },
  ];
  const { radius, ringRadius } = assertClipRangeRule(world, VIEWPORT);
  assert.ok(radius > ringRadius * 2, `the ringless instance sets the radius (${radius} vs ${ringRadius})`);

  // AND THE SEPARATION: read off the rings alone, the far plane would come in AHEAD of the wisp —
  // an instance the canvas draws, clipped out by a range that never heard of it.
  const framing = restingWorldFraming(world, VIEWPORT);
  const wispDepth = Math.max(...depthsAlongView(world.slice(2), framing));
  const eyeDistance = Math.hypot(
    framing.position[0] - framing.target[0],
    framing.position[1] - framing.target[1],
    framing.position[2] - framing.target[2],
  );
  assert.ok(wispDepth > eyeDistance + 2 * ringRadius + CLIP_HEADROOM, 'a rings-only far plane would clip it');
  assert.ok(framing.far > wispDepth, 'and the real one does not');
});
