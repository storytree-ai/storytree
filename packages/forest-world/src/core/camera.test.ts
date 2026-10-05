// The land's DECLARED CAMERA (ADR-0367 D1) — red-green on the one fact this increment brings
// into existence.
//
// BEFORE this suite the land had no camera at all. `hexCenter` mapped axial coordinates to pixels
// with no y-scale, no elevation and no projection matrix, and every stage downstream — the relaxed
// substrate mesh, the coast, the scene builders — worked in that same untransformed space. The
// hero-tree sprite, meanwhile, is authored at an explicitly declared camera: `ELEV_DEG = 20.0` in
// `docs/research/chapter2-code-only-art-2026-08-01/blender-hero-v1/blender_tree.py`, projecting
// world to screen as `sy = p[1]*sin(EL) + (p[2]-TZ)*cos(EL)`. So ground depth foreshortens by
// sin(elevation) and upright height by cos(elevation) — and the land applied NEITHER.
//
// ADR-0367 D1: the land gets a declared camera, it is the SAME one the hero tree declares, it is
// expressed ONCE as a named constant carrying an angle in degrees, and both the land's coordinate
// mapping and the object sprites read that one value. These tests fence that: the land side here,
// the land/sprite composition in `@storytree/app-surface`'s `land-camera-composition.test.ts`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  uprightForeshortening,
  projectGround,
  unprojectGround,
} from './camera.js';
import {
  HEX_R,
  HEX_W,
  AXIAL_DIRS,
  hexCenter,
  hexCorners,
  pixelToHex,
  type Axial,
  type Pt,
} from './hex.js';

const RAD = Math.PI / 180;

/**
 * The declared value, plus a sweep either side of it — the range every invariant below holds
 * over. 26.565 is the classic 2:1 dimetric angle and 30 the classic isometric one; they are here
 * because "across the range of the constant" has to mean the angles the land could plausibly be
 * re-declared at, not a numerical neighbourhood of 20.
 */
const SWEEP = [12, 15, 20, 26.565, 30, 45, 60] as const;

/** Ray-cast point-in-polygon; polygons here are convex, but the cast needs no convexity. */
function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const straddles = a.y > p.y !== b.y > p.y;
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------- the constant itself ----------

test('the land declares ONE camera elevation, in degrees, above the ground plane', () => {
  assert.ok(
    Number.isFinite(LAND_CAMERA_ELEVATION_DEG),
    'the land camera must be a finite angle in degrees',
  );
  assert.ok(
    LAND_CAMERA_ELEVATION_DEG > 0 && LAND_CAMERA_ELEVATION_DEG < PLAN_VIEW_ELEVATION_DEG,
    `a land camera at ${LAND_CAMERA_ELEVATION_DEG} deg is not an angled view: 0 is edge-on and ` +
      `${PLAN_VIEW_ELEVATION_DEG} is the plan view the land used to be drawn in`,
  );
});

test("the land's projection is DERIVED from the declared elevation, never a second literal", () => {
  // If either of these ever stops being sin/cos of the ONE constant, the land has grown a second
  // camera — which is exactly the state ADR-0367 D1 was written to end.
  assert.equal(groundFlattening(), Math.sin(LAND_CAMERA_ELEVATION_DEG * RAD));
  assert.equal(uprightForeshortening(), Math.cos(LAND_CAMERA_ELEVATION_DEG * RAD));
  for (const deg of SWEEP) {
    assert.equal(groundFlattening(deg), Math.sin(deg * RAD), `groundFlattening(${deg})`);
    assert.equal(uprightForeshortening(deg), Math.cos(deg * RAD), `uprightForeshortening(${deg})`);
  }
});

test('the plan view is the elevation the land used to be drawn at, and it is the identity', () => {
  assert.equal(groundFlattening(PLAN_VIEW_ELEVATION_DEG), 1);
  assert.deepEqual(projectGround({ x: 3, y: 7 }, PLAN_VIEW_ELEVATION_DEG), { x: 3, y: 7 });
});

// ---------- the land's coordinate mapping reads it ----------

test('hexCenter reads the declared camera: ground depth foreshortens, screen x does not', () => {
  // The lattice pitch is a GROUND-plane quantity, so the r axis carries the flattening and the q
  // axis does not. Pinned against the constant, not against 0.342, so re-declaring the camera
  // moves the assertion with the code.
  assert.equal(hexCenter({ q: 0, r: 1 }).y, 1.5 * HEX_R * groundFlattening());
  assert.equal(hexCenter({ q: 1, r: 0 }).x, HEX_W);
  assert.equal(hexCenter({ q: 1, r: 0 }).y, 0);

  // ...and at the plan-view limit it is byte-for-byte the pre-camera mapping.
  assert.equal(hexCenter({ q: 0, r: 1 }, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }).y, 1.5 * HEX_R);
  assert.equal(hexCenter({ q: 2, r: 3 }, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }).y, 1.5 * HEX_R * 3);
});

test('a lower camera flattens the land strictly more: hexCenter.y is monotone in the elevation', () => {
  const h: Axial = { q: 0, r: 4 };
  for (let i = 1; i < SWEEP.length; i++) {
    const lo = SWEEP[i - 1]!;
    const hi = SWEEP[i]!;
    assert.ok(
      hexCenter(h, { elevationDeg: lo }).y < hexCenter(h, { elevationDeg: hi }).y,
      `expected the land to flatten as the camera drops: y(${lo}) < y(${hi})`,
    );
  }
});

test('pixelToHex inverts hexCenter at the same camera, across the sweep', () => {
  // The land's forward and inverse mappings must read the SAME value: an inverse still dividing by
  // a plan-view pitch would mis-key every hit target on the map.
  for (const deg of [...SWEEP, PLAN_VIEW_ELEVATION_DEG]) {
    for (let q = -4; q <= 4; q++) {
      for (let r = -4; r <= 4; r++) {
        const h: Axial = { q, r };
        assert.deepEqual(
          pixelToHex(hexCenter(h, { elevationDeg: deg }), { elevationDeg: deg }),
          h,
          `round-trip failed at ${q},${r} under a ${deg} deg camera`,
        );
      }
    }
  }
});

test('projectGround / unprojectGround are inverses at the same camera', () => {
  for (const deg of SWEEP) {
    const p = { x: -17.5, y: 42.25 };
    const back = unprojectGround(projectGround(p, deg), deg);
    assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
  }
});

// ---------- the cells project as ground polygons, and the lattice still closes ----------

test('hexCorners project onto the camera ground ellipse, not a circle', () => {
  for (const deg of SWEEP) {
    const f = groundFlattening(deg);
    for (const c of hexCorners(10, 20, HEX_R, deg)) {
      const nx = (c.x - 10) / HEX_R;
      const ny = (c.y - 20) / (HEX_R * f);
      assert.ok(
        Math.abs(Math.hypot(nx, ny) - 1) < 1e-9,
        `corner (${c.x}, ${c.y}) is off the ${deg} deg ground ellipse`,
      );
    }
  }
  // At the plan view the ellipse is the circle the pre-camera code drew.
  for (const c of hexCorners(10, 20, HEX_R, PLAN_VIEW_ELEVATION_DEG)) {
    assert.ok(Math.abs(Math.hypot(c.x - 10, c.y - 20) - HEX_R) < 1e-9);
  }
});

test('the projected lattice still CLOSES: neighbouring cells share their edge corners exactly', () => {
  // This is what separates a ground PROJECTION from an arbitrary vertical squash: the same affine
  // map applied to the pitch and to the corner offsets keeps every shared edge shared, so the
  // relaxed substrate mesh and the territory boundary still weld. Tear this and the island grows
  // seams no test downstream would name.
  for (const deg of SWEEP) {
    for (let q = -2; q <= 2; q++) {
      for (let r = -2; r <= 2; r++) {
        const h: Axial = { q, r };
        const hc = hexCenter(h, { elevationDeg: deg });
        const mine = hexCorners(hc.x, hc.y, HEX_R, deg);
        AXIAL_DIRS.forEach((d, e) => {
          const n: Axial = { q: q + d.q, r: r + d.r };
          const nc = hexCenter(n, { elevationDeg: deg });
          const theirs = hexCorners(nc.x, nc.y, HEX_R, deg);
          // My edge e runs corner e -> e+1; the neighbour across it draws the same two points as
          // its own corners e+3 and e+4 (the opposite edge), reversed.
          const a = mine[e]!;
          const b = mine[(e + 1) % 6]!;
          const a2 = theirs[(e + 4) % 6]!;
          const b2 = theirs[(e + 3) % 6]!;
          assert.ok(
            Math.hypot(a.x - a2.x, a.y - a2.y) < 1e-9,
            `${deg} deg: cell ${q},${r} edge ${e} corner A does not meet its neighbour`,
          );
          assert.ok(
            Math.hypot(b.x - b2.x, b.y - b2.y) < 1e-9,
            `${deg} deg: cell ${q},${r} edge ${e} corner B does not meet its neighbour`,
          );
        });
      }
    }
  }
});

// ---------- the tile extrusion is UPRIGHT, so it foreshortens by cos ----------

// ---------- the composition property, in land terms ----------

test('a ground contact anchored to a cell lands ON that cell, across the sweep', () => {
  // Proof assertion 2, land half: the anchor and the cell polygon must be computed at the SAME
  // declared camera. The sprite half (the rendered contact row) is fenced in app-surface.
  for (const deg of SWEEP) {
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        const h: Axial = { q, r };
        const contact = hexCenter(h, { elevationDeg: deg });
        const hc = hexCenter(h, { elevationDeg: deg });
        const cell = hexCorners(hc.x, hc.y, HEX_R, deg);
        assert.ok(
          pointInPolygon(contact, cell),
          `${deg} deg: contact for cell ${q},${r} fell off its own cell`,
        );
      }
    }
  }
});

test('the contact assertion has TEETH: an anchor at a different camera falls off the cell', () => {
  // Without this control the test above would pass vacuously for any mapping whatsoever. A cell
  // drawn at the declared camera with its anchor still placed by the pre-camera (plan-view)
  // mapping is exactly today's mismatch, and it must be caught.
  const h: Axial = { q: 0, r: 3 };
  const hc = hexCenter(h, { elevationDeg: LAND_CAMERA_ELEVATION_DEG });
  const cell = hexCorners(hc.x, hc.y, HEX_R, LAND_CAMERA_ELEVATION_DEG);
  const planViewAnchor = hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
  assert.ok(
    !pointInPolygon(planViewAnchor, cell),
    'a plan-view anchor on an angled cell should NOT be judged planted',
  );
});
