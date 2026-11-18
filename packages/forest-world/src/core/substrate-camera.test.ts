import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  projectGround,
  unprojectGround,
} from './camera.js';
import { HEX_R, type Axial, type Pt } from './hex.js';
import { hash } from './rng.js';
import {
  MESH_TUNING,
  buildRelaxedCells,
  type DrawTile,
  type RelaxedCell,
  type SubstrateMode,
} from './substrate.js';

const SWEEP = [PLAN_VIEW_ELEVATION_DEG, 60, 45, 30, 26.565, LAND_CAMERA_ELEVATION_DEG, 12] as const;

const TOLERANCE = 1e-6;

function discTiles(rings: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -rings; q <= rings; q++) {
    for (let r = -rings; r <= rings; r++) if (Math.abs(q + r) <= rings) out.push({ q, r });
  }
  return out;
}

const TILES: DrawTile[] = [
  ...discTiles(2).map((h) => ({ h, owner: 0 })),
  ...discTiles(1).map((h) => ({ h: { q: h.q + 6, r: h.r }, owner: 1 })),
];
const WHEAT: ReadonlySet<string>[] = [new Set(['0,0', '1,-1', '-1,1']), new Set(['6,0'])];

const MODES: SubstrateMode[] = ['mesh', 'relaxed-hex', 'relaxed-quad'];

function build(mode: SubstrateMode, elevationDeg: number): RelaxedCell[] {
  return buildRelaxedCells(TILES, WHEAT, mode, {}, { elevationDeg });
}

for (const mode of MODES) {
  test(`${mode}: the same ground island decomposes into the same cells at every camera`, () => {
    const reference = build(mode, PLAN_VIEW_ELEVATION_DEG);
    assert.ok(reference.length > 0, 'the fixture produced no cells');

    for (const elevationDeg of SWEEP) {
      const got = build(mode, elevationDeg);
      assert.equal(
        got.length,
        reference.length,
        `${mode} at ${elevationDeg}°: ${got.length} cells against ${reference.length} in plan view. ` +
          'The mesh re-decomposed because the camera moved — which is the defect, not a rounding ' +
          'difference: a cell count is an integer and the ground island did not change.',
      );

      for (let i = 0; i < got.length; i++) {
        const a = got[i] as RelaxedCell;
        const b = reference[i] as RelaxedCell;
        assert.equal(a.owner, b.owner, `${mode} at ${elevationDeg}°: cell ${i} changed owner`);
        assert.equal(a.variant, b.variant, `${mode} at ${elevationDeg}°: cell ${i} changed variant`);
        assert.equal(a.wheat, b.wheat, `${mode} at ${elevationDeg}°: cell ${i} changed wheat`);
        assert.equal(
          a.poly.length,
          b.poly.length,
          `${mode} at ${elevationDeg}°: cell ${i} changed vertex count`,
        );
        for (let v = 0; v < a.poly.length; v++) {
          const ga = unprojectGround(a.poly[v] as Pt, elevationDeg);
          const gb = unprojectGround(b.poly[v] as Pt, PLAN_VIEW_ELEVATION_DEG);
          assert.ok(
            Math.abs(ga.x - gb.x) < TOLERANCE && Math.abs(ga.y - gb.y) < TOLERANCE,
            `${mode} at ${elevationDeg}°: cell ${i} vertex ${v} sits at a different GROUND spot — ` +
              `(${ga.x.toFixed(4)}, ${ga.y.toFixed(4)}) against ` +
              `(${gb.x.toFixed(4)}, ${gb.y.toFixed(4)}). Only the SCREEN position may move.`,
          );
        }
      }
    }
  });
}

test('TEETH (a) — the cells really do foreshorten, so the sweep is not comparing identical runs', () => {
  const plan = build('mesh', PLAN_VIEW_ELEVATION_DEG);
  const angled = build('mesh', LAND_CAMERA_ELEVATION_DEG);
  const heightOf = (cells: RelaxedCell[]): number => {
    const ys = cells.flatMap((c) => c.poly.map((p) => p.y));
    return Math.max(...ys) - Math.min(...ys);
  };
  const widthOf = (cells: RelaxedCell[]): number => {
    const xs = cells.flatMap((c) => c.poly.map((p) => p.x));
    return Math.max(...xs) - Math.min(...xs);
  };
  const f = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  const planH = heightOf(plan);
  const angledH = heightOf(angled);
  assert.ok(planH > 0, 'the plan-view fixture has no vertical extent');
  assert.ok(
    Math.abs(angledH / planH - f) < 0.02,
    `the mesh did not foreshorten as the camera declares: ${angledH.toFixed(2)} / ${planH.toFixed(2)} = ` +
      `${(angledH / planH).toFixed(4)}, expected sin(20°) = ${f.toFixed(4)}. If the two runs are not ` +
      'genuinely different pictures, the invariance test above proves nothing.',
  );
  assert.ok(
    Math.abs(widthOf(angled) - widthOf(plan)) < TOLERANCE,
    'the WIDTH must not move — only the depth axis foreshortens',
  );
});

test('TEETH (b) — the key the old rule used really was camera-dependent, and the new one is not', () => {
  const cells = build('mesh', PLAN_VIEW_ELEVATION_DEG);
  const groundVerts = cells.flatMap((c) => c.poly);
  assert.ok(groundVerts.length > 0, 'the fixture produced no vertices');

  const screenKey = (p: Pt, elevationDeg: number): string => {
    const q = projectGround(p, elevationDeg);
    return `${Math.round(q.x * 10)},${Math.round(q.y * 10)}`;
  };
  const groundKey = (p: Pt): string => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;

  let screenKeyMoved = 0;
  for (const v of groundVerts) {
    if (screenKey(v, LAND_CAMERA_ELEVATION_DEG) !== screenKey(v, PLAN_VIEW_ELEVATION_DEG)) {
      screenKeyMoved += 1;
    }
  }
  assert.ok(
    screenKeyMoved > groundVerts.length * 0.5,
    `only ${screenKeyMoved} of ${groundVerts.length} vertices changed their SCREEN key between plan ` +
      'view and the declared camera. The old rule keyed on that value, so if it barely moves, this ' +
      'suite can no longer tell the fix from what it replaced.',
  );

  const a: Pt = { x: 0, y: 0 };
  const b: Pt = { x: 0, y: 0.06 };
  assert.equal(
    screenKey(a, LAND_CAMERA_ELEVATION_DEG),
    screenKey(b, LAND_CAMERA_ELEVATION_DEG),
    'the screen key must merge these two — 0.06 ground units is well under half a 0.1-px bucket at sin(50°)',
  );
  assert.notEqual(groundKey(a), groundKey(b), 'the ground key must keep them apart');
});

test('each mode routes to its OWN builder — the three decompositions differ', () => {
  const counts = new Map(MODES.map((m) => [m, build(m, PLAN_VIEW_ELEVATION_DEG).length]));
  const mesh = counts.get('mesh') as number;
  const quad = counts.get('relaxed-quad') as number;
  const hex = counts.get('relaxed-hex') as number;
  assert.ok(hex > 0 && quad > 0 && mesh > 0, `a mode produced no cells: ${[...counts].join(', ')}`);
  assert.equal(hex, TILES.length, 'relaxed-hex is one cell per claimed tile');
  assert.ok(quad > hex, `relaxed-quad (${quad}) must be denser than relaxed-hex (${hex})`);
  assert.ok(mesh > quad, `mesh (${mesh}) must be denser than relaxed-quad (${quad})`);
});

test('the jitter displaces interior vertices, isotropically and within its own budget', () => {
  const still = buildRelaxedCells(TILES, WHEAT, 'mesh', { jitter: 0, iters: 0, relax: 0 }, {
    elevationDeg: PLAN_VIEW_ELEVATION_DEG,
  });
  const moved = buildRelaxedCells(TILES, WHEAT, 'mesh', { iters: 0, relax: 0 }, {
    elevationDeg: PLAN_VIEW_ELEVATION_DEG,
  });
  assert.equal(moved.length, still.length, 'the jitter must not change the decomposition');

  let maxDx = 0;
  let maxDy = 0;
  let anyMoved = false;
  for (let i = 0; i < moved.length; i++) {
    const a = moved[i] as RelaxedCell;
    const b = still[i] as RelaxedCell;
    for (let v = 0; v < a.poly.length; v++) {
      const dx = Math.abs((a.poly[v] as Pt).x - (b.poly[v] as Pt).x);
      const dy = Math.abs((a.poly[v] as Pt).y - (b.poly[v] as Pt).y);
      if (dx > 1e-9 || dy > 1e-9) anyMoved = true;
      maxDx = Math.max(maxDx, dx);
      maxDy = Math.max(maxDy, dy);
    }
  }
  assert.ok(anyMoved, 'the default tuning jittered nothing at all');

  const budget = HEX_R * (MESH_TUNING.jitter as number) + 1e-9;
  assert.ok(maxDx <= budget, `x displacement ${maxDx.toFixed(3)} exceeds the budget ${budget.toFixed(3)}`);
  assert.ok(maxDy <= budget, `y displacement ${maxDy.toFixed(3)} exceeds the budget ${budget.toFixed(3)}`);

  assert.ok(
    maxDy / maxDx > 0.75 && maxDy / maxDx < 1.34,
    `the jitter is not isotropic on the ground: max dy/dx = ${(maxDy / maxDx).toFixed(3)}. ` +
      'On the ground plane the displacement is a circle, not an ellipse — if this is ~0.34 the ' +
      "camera's flattening has leaked back in.",
  );
});

test('wheat covers the share of the island its own hexes cover — the cell keeps its hex key', () => {
  const cells = build('mesh', PLAN_VIEW_ELEVATION_DEG);
  const wheatHexes = WHEAT.reduce((n, set) => n + set.size, 0);
  const expected = (wheatHexes / TILES.length) * 0.72;
  const share = cells.filter((c) => c.wheat).length / cells.length;
  assert.ok(
    share > expected * 0.6 && share < expected * 1.4,
    `wheat covers ${(share * 100).toFixed(1)}% of the cells; ${wheatHexes} of ${TILES.length} tiles ` +
      `are wheat and the scatter keeps ~72%, so ~${(expected * 100).toFixed(1)}% was expected. A ` +
      'share near zero means the cells resolved to hexes nobody tinted.',
  );
  assert.ok(cells.some((c) => !c.wheat), 'every cell is wheat — the scatter did nothing');
});

test('the default camera IS the declared camera — an omitted option is not a different mesh', () => {
  const declared = build('mesh', LAND_CAMERA_ELEVATION_DEG);
  const defaulted = buildRelaxedCells(TILES, WHEAT, 'mesh');
  assert.equal(defaulted.length, declared.length, 'the default build has a different cell count');
  for (let i = 0; i < declared.length; i++) {
    const a = defaulted[i] as RelaxedCell;
    const b = declared[i] as RelaxedCell;
    assert.equal(a.wheat, b.wheat, `cell ${i} differs in wheat between the default and 20 degrees`);
    for (let v = 0; v < a.poly.length; v++) {
      assert.ok(
        Math.abs((a.poly[v] as Pt).x - (b.poly[v] as Pt).x) < TOLERANCE &&
          Math.abs((a.poly[v] as Pt).y - (b.poly[v] as Pt).y) < TOLERANCE,
        `cell ${i} vertex ${v} moved between the default build and an explicit ` +
          `LAND_CAMERA_ELEVATION_DEG. The default must BE the declared camera.`,
      );
    }
  }
});

test('THE MESH IS A FIXED ARTIFACT — if this digest moves, the land moved, and it must be said out loud', () => {
  const cells = build('mesh', PLAN_VIEW_ELEVATION_DEG);
  const digest = hash(
    cells
      .map(
        (c) =>
          `${c.owner}:${c.variant}:${c.wheat ? 1 : 0}:` +
          c.poly.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';'),
      )
      .join('|'),
  );
  assert.equal(cells.length, 326, 'the fixture no longer decomposes into 326 cells');
  assert.equal(
    digest,
    1938404724,
    'the ground mesh this fixture produces has changed. That is not automatically wrong — but it ' +
      'is never invisible: name what moved and why in the landing, then re-record it here.',
  );
});
