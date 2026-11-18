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

const SWEEP = [12, 15, 20, 26.565, 30, 45, 60] as const;

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
  const near = (actual: number, expected: number, what: string): void =>
    assert.ok(Math.abs(actual - expected) < 1e-4, `${what}: ${actual}, worked ${expected}`);
  assert.equal(groundFlattening(), groundFlattening(LAND_CAMERA_ELEVATION_DEG));
  assert.equal(uprightForeshortening(), uprightForeshortening(LAND_CAMERA_ELEVATION_DEG));
  near(groundFlattening(50), 0.766, 'groundFlattening(50)');
  near(uprightForeshortening(50), 0.6428, 'uprightForeshortening(50)');
  near(groundFlattening(0), 0, 'groundFlattening(0)');
  near(uprightForeshortening(0), 1, 'uprightForeshortening(0)');
  near(groundFlattening(90), 1, 'groundFlattening(90)');
  near(uprightForeshortening(90), 0, 'uprightForeshortening(90)');
  const worked: Record<(typeof SWEEP)[number], [ground: number, upright: number]> = {
    12: [0.2079, 0.9781],
    15: [0.2588, 0.9659],
    20: [0.342, 0.9397],
    26.565: [0.4472, 0.8944],
    30: [0.5, 0.866],
    45: [0.7071, 0.7071],
    60: [0.866, 0.5],
  };
  for (const deg of SWEEP) {
    near(groundFlattening(deg), worked[deg][0], `groundFlattening(${deg})`);
    near(uprightForeshortening(deg), worked[deg][1], `uprightForeshortening(${deg})`);
  }
});

test('the plan view is the elevation the land used to be drawn at, and it is the identity', () => {
  assert.equal(groundFlattening(PLAN_VIEW_ELEVATION_DEG), 1);
  assert.deepEqual(projectGround({ x: 3, y: 7 }, PLAN_VIEW_ELEVATION_DEG), { x: 3, y: 7 });
});

test('hexCenter reads the declared camera: ground depth foreshortens, screen x does not', () => {
  assert.equal(hexCenter({ q: 0, r: 1 }).y, 1.5 * HEX_R * groundFlattening());
  assert.equal(hexCenter({ q: 1, r: 0 }).x, HEX_W);
  assert.equal(hexCenter({ q: 1, r: 0 }).y, 0);

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
  for (const c of hexCorners(10, 20, HEX_R, PLAN_VIEW_ELEVATION_DEG)) {
    assert.ok(Math.abs(Math.hypot(c.x - 10, c.y - 20) - HEX_R) < 1e-9);
  }
});

test('the projected lattice still CLOSES: neighbouring cells share their edge corners exactly', () => {
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

test('a ground contact anchored to a cell lands ON that cell, across the sweep', () => {
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
  const h: Axial = { q: 0, r: 3 };
  const hc = hexCenter(h, { elevationDeg: LAND_CAMERA_ELEVATION_DEG });
  const cell = hexCorners(hc.x, hc.y, HEX_R, LAND_CAMERA_ELEVATION_DEG);
  const planViewAnchor = hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
  assert.ok(
    !pointInPolygon(planViewAnchor, cell),
    'a plan-view anchor on an angled cell should NOT be judged planted',
  );
});
