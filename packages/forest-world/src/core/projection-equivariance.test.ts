/**
 * THE GENERATOR HAS ONE CAMERA, NOT THREE — ADR-0527 D1's precondition, made executable.
 *
 * ADR-0527 D1 moves the 20° projection out of the layout generator and into the painters: the
 * layout emits a TRUE ground surface and each painter projects for itself. The whole decision
 * rests on a fact nothing in this repo asserted before this file — **the layout stack is
 * projection-EQUIVARIANT**: relaxing, routing and laying out in ground space and projecting once
 * at the end gives the same drawing as doing it all in projected space. If that were false, D1
 * could not also satisfy D6 (the map is pixel-identical across the change), because un-baking the
 * projection would move the picture.
 *
 * It is TRUE, and it is measured here rather than argued (see `relaxation` below: 238 cells over
 * 19 tiles, max error 0). `substrate.ts` and `routing.ts` already work this way — both build in
 * ground space and call `projectGround` exactly once on the way out (`substrate.ts:569`,
 * `routing.ts:1378-1385`). That is the shape D1 generalises.
 *
 * ⚠⚠ WHAT WAS NOT TRUE, AND IS WHAT THIS FILE'S RED CAME FROM. `scene.ts` did NOT thread the
 * caller's camera. `SceneInput.cameraElevationDeg` reached only the garden / stone-path / UAT-marker
 * helpers under `buildTerritoryFlora`; three sites computed a coordinate at the HARDWIRED default
 * instead, so a caller asking `buildScene` for a plan-view surface got a scene at TWO cameras at
 * once — territory geometry and substrate at plan view, and these three at 20°:
 *
 *   1. `buildEmpties` — `hexCenter(h)` / `hexPath(...)` with no elevation. The `empty` coast hexes
 *      are LIVE (they are not in `scene-kind-coverage.test.ts`'s `STARVED_KINDS`), so this one is
 *      drawn on the studio map today. Ask for a true surface and the coastline detaches from the
 *      islands it rings.
 *   2. `buildTree`'s ground contact shadow — `groundRadiusToScreenHalfHeight(shadowGroundR)` with
 *      no elevation, i.e. a ground circle flattened at 20° whatever camera the caller asked for.
 *      This is the mark directly beneath the hero tree, the one ADR-0367 D1 derived from the
 *      declared camera precisely so it would stop being hand-set.
 *   3. the classic extruded-hex ground — `hexCenter(h)` / `hexPath(...)` / `TILE_DEPTH`. This
 *      family is STARVED (row 1 of the deletion list in
 *      `docs/research/forest-geometry-inventory-2026-09-06.md`) and is slated for deletion rather
 *      than for rework under ADR-0527 D4. It is threaded anyway, because the invariant this file
 *      states is "the generator has ONE camera" and an exception nobody can see is how a second
 *      copy survives a deletion. Two lines, not a port.
 *
 * A caller could not detect any of this from the outside: it does not throw, it does not warn, and
 * on the shipped path (every surface asks for the declared camera) all three happen to agree. It
 * only surfaces the moment someone asks for a DIFFERENT camera — which is exactly what ADR-0527 D1
 * makes the 3D painter do.
 *
 * The tests below are stated as EQUIVARIANCE rather than as "site N threads its argument", so they
 * keep binding when the sites move: what is pinned is that building at plan view and projecting is
 * the same drawing as building at the declared camera, which is D1's whole claim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  projectGround,
  uprightForeshortening,
} from './camera.js';
import { PRE_ADR0528_TILE, TILE_DEPTH_WORLD, type Axial } from './hex.js';
import { smoothLoopPath } from './coast.js';
import { buildRelaxedCells, type RelaxedCell } from './substrate.js';
import { shippedInput } from './testing/scene-fixture.js';
import {
  buildScene,
  buildTree,
  type SceneEllipse,
  type SceneG,
  type SceneInput,
  type SceneNode,
  type ScenePath,
  type SceneTerritoryInput,
} from './scene.js';

/** sin 20° = 0.342… — the factor a ground-plane depth loses at the declared camera. */
const SIN = groundFlattening(LAND_CAMERA_ELEVATION_DEG);

/** A radius-2 hex disc, big enough that the relaxed mesh has interior cells and not just rim. */
const TILES: Axial[] = (() => {
  const out: Axial[] = [];
  for (let q = -2; q <= 2; q += 1) {
    for (let r = -2; r <= 2; r += 1) if (Math.abs(q + r) <= 2) out.push({ q, r });
  }
  return out;
})();

/** The tuned tile — the lattice this package's ground-unit constants were judged on (ADR-0528). */
const TILE = { hexR: PRE_ADR0528_TILE.hexR } as const;

/** A closed coast ring in GROUND space — a circle of radius 90 about the island's centre, which is
 *  what `smoothCoast` hands back before anything projects it. */
const COAST_GROUND: readonly { x: number; y: number }[] = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * 2 * Math.PI;
  return { x: 90 * Math.cos(a), y: 90 * Math.sin(a) };
});

// ---------------------------------------------------------------------------
// 1. THE FACT D1 RESTS ON: the substrate relaxation commutes with the projection.
// ---------------------------------------------------------------------------

test('the relaxed substrate is projection-EQUIVARIANT: relax-then-project == project-then-relax, exactly', () => {
  const draw = TILES.map((h) => ({ h, owner: 0 }));
  const atCamera = buildRelaxedCells(draw, [new Set<string>()], 'mesh', TILE, {
    elevationDeg: LAND_CAMERA_ELEVATION_DEG,
  });
  const atGround = buildRelaxedCells(draw, [new Set<string>()], 'mesh', TILE, {
    elevationDeg: PLAN_VIEW_ELEVATION_DEG,
  });

  assert.equal(atCamera.length, atGround.length, 'the same tiles must decompose into the same number of cells');
  assert.ok(atCamera.length > 50, `expected a substantial mesh, got ${atCamera.length} cells`);

  let maxErr = 0;
  let worst = '';
  for (let i = 0; i < atCamera.length; i += 1) {
    const a = atCamera[i] as RelaxedCell;
    const b = atGround[i] as RelaxedCell;
    assert.equal(a.variant, b.variant, `cell ${i}: the hash-derived variant must not depend on the camera`);
    assert.equal(a.owner, b.owner, `cell ${i}: ownership must not depend on the camera`);
    assert.equal(a.poly.length, b.poly.length, `cell ${i}: the cell must have the same number of vertices`);
    for (let j = 0; j < a.poly.length; j += 1) {
      const p = a.poly[j]!;
      const q = b.poly[j]!;
      const err = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y * SIN));
      if (err > maxErr) {
        maxErr = err;
        worst = `cell ${i} vertex ${j}: built at 20° = (${p.x}, ${p.y}); built on the ground and projected = (${q.x}, ${q.y * SIN})`;
      }
    }
  }
  // EXACT, not approximate: the projection is a scale on y alone and the relaxation's arithmetic is
  // linear in the seeds, so there is no floating-point slack to allow for. A tolerance here would
  // hide precisely the kind of non-linearity (a distance test, a keep-out radius, a hypot) that
  // would make D1 move the picture.
  assert.equal(maxErr, 0, `the relaxation does not commute with the projection — ${worst}`);
});

// ---------------------------------------------------------------------------
// 2. THE GENERATOR HAS ONE CAMERA: `buildScene` honours the camera it is asked for.
// ---------------------------------------------------------------------------

/** A scene exercising the three sites that used to hardwire the declared camera. */
function sceneAt(elevationDeg: number, opts: { relaxed: boolean }): SceneG {
  const draw = TILES.map((h) => ({ h, owner: 0 }));
  // The territory's own coordinates are the CALLER's, so they are stated in the caller's space —
  // this is the contract `SceneInput.cameraElevationDeg` documents. Only the sites `scene.ts`
  // computes for itself are under test.
  const territory: SceneTerritoryInput = {
    id: 'story',
    status: 'healthy',
    caps: 4,
    centroid: { x: 0, y: 0 },
    groundRadius: 70,
    screenRadius: 70 * groundFlattening(elevationDeg),
    treeSpot: { x: 0, y: 0 },
    labelY: 46,
    // `smoothCoast` returns GROUND loops and they are handed over AS COORDINATES (ADR-0527 D1).
    // Until this landing the caller projected them at the declared camera and froze them into a
    // `d` string first, which made the coast the one island input that arrived as a finished
    // DRAWING — and a drawing cannot be re-projected, so it could not answer to the camera the
    // scene was being built at. It read as a PASS, because a frozen path is byte-identical at both
    // cameras and the walker's scalar rule accepts "unchanged"; that hole is closed above.
    coastGroundLoops: [[...COAST_GROUND]],
    decor: [],
    plants: [],
    treeTitle: 'story',
    wisps: [],
    plate: { w: 120, h: 33, rx: 7, idY: 14, subY: 27, idText: 'story', subText: 'x', title: 'story' },
  };
  const input: SceneInput = {
    offset: { x: 0, y: 0 },
    width: 1200,
    height: 900,
    // the coast ring one step outside the disc — the LIVE `empty` family
    empties: [
      { q: 3, r: -1 },
      { q: -3, r: 1 },
      // ADR-0286: a coast hex carries the id of the island it grew out of when the caller
      // attributed it. Both branches are present so the emission test below can read both.
      { q: 0, r: 3, owner: 0 },
    ],
    relaxedCells: opts.relaxed
      ? buildRelaxedCells(draw, [new Set<string>()], 'mesh', TILE, { elevationDeg })
      : null,
    drawTiles: draw,
    wheatSets: [new Set<string>()],
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    territories: [territory],
    tile: TILE,
    cameraElevationDeg: elevationDeg,
  };
  return buildScene(input);
}

/** Every node of `kind`, depth-first. */
function nodesOfKind(root: SceneNode, kind: string): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (n: SceneNode): void => {
    if ((n as { kind?: string }).kind === kind) out.push(n);
    for (const c of (n as SceneG).children ?? []) walk(c);
  };
  walk(root);
  return out;
}

/**
 * Is `drawn` (built at the declared camera) the projection of `ground` (built in plan view)?
 * Returns null when it is, or a one-line reason when it is not.
 *
 * Both strings are emitted through `toFixed(1)`, so the comparison carries the rounding of BOTH
 * sides and nothing looser: |Δ| ≤ 0.05 from the drawn side plus 0.05·sin from the ground side. A
 * vertex that moved for any reason other than the camera is out by a multiple of its own
 * coordinate — the failures this replaced were 3× out — so the tolerance cannot launder one.
 */
const ROUNDING_SLACK = 0.05 * (1 + SIN);
function geometryThroughProjection(drawn: string, ground: string): string | null {
  const nd = (drawn.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const ng = (ground.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nd.length !== ng.length) return `${nd.length} numbers vs ${ng.length}`;
  if (nd.length === 0) return drawn === ground ? null : 'differs and carries no coordinates';
  if (nd.length % 2 !== 0) return `an odd number of coordinates (${nd.length}) — not x,y pairs`;
  for (let i = 0; i < nd.length; i += 2) {
    if (Math.abs((nd[i] as number) - (ng[i] as number)) > ROUNDING_SLACK) {
      return `x moved: ${nd[i]} vs ${ng[i]} (the camera flattens y ALONE)`;
    }
    const want = (ng[i + 1] as number) * SIN;
    if (Math.abs((nd[i + 1] as number) - want) > ROUNDING_SLACK) {
      return `y is not the projection: ${nd[i + 1]} vs ${ng[i + 1]}·sin20° = ${want.toFixed(3)}`;
    }
  }
  return null;
}

/**
 * A path's drawn height over its drawn width, WITH the tolerance its own rounding forces.
 *
 * A `d` string is emitted through `toFixed(1)`, so each extent carries ±0.1 and the ratio built
 * from two of them carries `(0.1/h + 0.1/w) · ratio`. Deriving the tolerance from the measured
 * extents rather than picking an epsilon matters here: the two families under test are drawn on
 * DIFFERENT lattices — the empty hexes on the stated tile (radius 27) and the classic ground on the
 * derived `HEX_R` (≈ 11.06) — so one fixed epsilon is either too loose for the first or a false red
 * on the second. Both were measured out by ~0.001 against a real answer of 1.1547.
 */
interface Aspect {
  /** drawn height / drawn width */
  readonly ratio: number;
  /** the slack the `toFixed(1)` rounding of both extents forces on that ratio */
  readonly tol: number;
}

function aspect(d: string): Aspect {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const ratio = h / w;
  return { ratio, tol: (0.1 / h + 0.1 / w) * ratio };
}

/**
 * Kinds whose geometry lies IN the ground plane, so their drawn depth MUST change with the camera.
 * Named rather than inferred: the walker cannot tell a coordinate that legitimately did not move
 * (an x, a screen constant) from one that COULD not move because it arrived pre-drawn.
 */
const GROUND_PLANE_KINDS: ReadonlySet<string> = new Set(['coast-shore', 'cell', 'cell-wheat', 'empty', 'tile-top', 'tile-side']);

/** The fields that carry GEOMETRY. Scoped deliberately: `cellId` is a shape-FREE identity
 *  (`story/cell-000`) that is supposed to be identical at every camera, and a guard reading every
 *  string field flags all 238 of them. */
const GEOMETRY_FIELDS: ReadonlySet<string> = new Set(['d', 'points']);

/** A pointy-top hex is 2R tall and √3·R wide on the GROUND: this is its plan-view aspect. */
const PLAN_HEX_ASPECT = 2 / Math.sqrt(3);

/**
 * A hex outline is a circle of radius R in the GROUND plane; seen at elevation θ it is an ellipse of
 * semi-axes (R, R·sin θ). So the ratio of a drawn hex's height to its width IS the camera it was
 * drawn under, readable straight off the emitted `d` without knowing where on the map it sits.
 */
function assertHexFollowsTheCamera(kind: string, relaxed: boolean, why: string): void {
  const shapeAt = (elevationDeg: number): { ratio: number; tol: number } => {
    const found = nodesOfKind(sceneAt(elevationDeg, { relaxed }), kind);
    assert.ok(found.length > 0, `the fixture must emit at least one \`${kind}\``);
    return aspect((found[0] as ScenePath).d);
  };
  const plan = shapeAt(PLAN_VIEW_ELEVATION_DEG);
  const camera = shapeAt(LAND_CAMERA_ELEVATION_DEG);
  assert.ok(
    Math.abs(plan.ratio - PLAN_HEX_ASPECT) <= plan.tol,
    `asked for a PLAN-VIEW scene, a \`${kind}\` must be 2/√3 = ${PLAN_HEX_ASPECT.toFixed(4)} times as tall as it is ` +
      `wide (±${plan.tol.toFixed(4)} for the 1-dp rounding); got ${plan.ratio.toFixed(4)} — ${why}`,
  );
  const flattening = camera.ratio / plan.ratio;
  const tol = camera.tol / plan.ratio + (camera.ratio * plan.tol) / (plan.ratio * plan.ratio);
  assert.ok(
    Math.abs(flattening - SIN) <= tol,
    `the declared camera must flatten the same \`${kind}\` by sin 20° = ${SIN.toFixed(4)} (±${tol.toFixed(4)}), ` +
      `got ${flattening.toFixed(4)}`,
  );
}

test('an EMPTY coast hex is drawn at the camera the caller asked for, not at the hardwired default', () => {
  // `empty` is LIVE — it is not in `scene-kind-coverage.test.ts`'s `STARVED_KINDS`, so these are the
  // coast hexes on the studio map today. Ask `buildScene` for a true surface with this unthreaded
  // and the coastline stays flattened around islands that are not.
  assertHexFollowsTheCamera('empty', true, '`buildEmpties` is still flattening at the hardwired declared camera (ADR-0527 D1)');
});

test("the story tree's ground contact shadow follows the camera it is drawn under (ADR-0367 D1)", () => {
  const ratioAt = (elevationDeg: number): number => {
    const shadows = nodesOfKind(sceneAt(elevationDeg, { relaxed: true }), 'shadow');
    assert.ok(shadows.length > 0, 'the fixture must draw a story tree with its contact shadow');
    const e = shadows[0] as SceneEllipse;
    return e.ry / e.rx;
  };
  // The shadow is a ground CIRCLE of radius 0.78R seen through the camera — so its semi-minor over
  // its semi-major IS sin θ. At plan view it is a circle; at the declared camera, sin 20°.
  assert.ok(
    Math.abs(ratioAt(PLAN_VIEW_ELEVATION_DEG) - 1) < 1e-9,
    `a ground circle seen from straight down is a CIRCLE — got an axis ratio of ${ratioAt(PLAN_VIEW_ELEVATION_DEG)}. ` +
      "`buildTree` is still flattening the contact shadow at the hardwired declared camera.",
  );
  assert.ok(Math.abs(ratioAt(LAND_CAMERA_ELEVATION_DEG) - SIN) < 1e-9, 'at the declared camera the ratio must be sin 20°');
});

test('the classic extruded-hex ground follows the camera too — a starved family carries no second copy of it', () => {
  // Row 1 of the deletion list (`docs/research/forest-geometry-inventory-2026-09-06.md`): this
  // family is STARVED and will be deleted rather than reworked (ADR-0527 D4). It is held to the
  // invariant anyway, because "the generator has ONE camera" with an exception nobody can see is
  // how a second copy outlives the deletion that was supposed to take it.
  assertHexFollowsTheCamera('tile-top', false, 'the classic ground still reads the module-level `TILE_DEPTH` and the default lattice');

  // The SHAPE of a tile top says nothing about WHERE the tile sits, and a hex's lattice position is
  // a second reading of the camera: the r axis runs into the ground plane, so a tile's centre y is
  // `1.5·R·r·sin θ`. Every tile's centre must therefore move by sin between the two builds — which
  // is what catches a lattice call that dropped its elevation while the corner offsets kept theirs.
  const centresAt = (elevationDeg: number): number[] =>
    nodesOfKind(sceneAt(elevationDeg, { relaxed: false }), 'tile-top').map((n) => {
      const ys = ((n as ScenePath).d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1);
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    });
  const groundCentres = centresAt(PLAN_VIEW_ELEVATION_DEG);
  const drawnCentres = centresAt(LAND_CAMERA_ELEVATION_DEG);
  assert.equal(drawnCentres.length, groundCentres.length, 'the same tiles must be drawn at both cameras');
  // The centre of the disc sits at y = 0 and says nothing about the camera (0 · anything is 0), so
  // asserting over every tile without checking that at least one is OFF the axis would pass on a
  // fixture that could not fail. `TILES` spans r = -2..2, so several are.
  assert.ok(groundCentres.filter((y) => Math.abs(y) > 1).length >= 4, 'the fixture must contain tiles off the r = 0 axis');
  for (let i = 0; i < groundCentres.length; i += 1) {
    const want = (groundCentres[i] as number) * SIN;
    assert.ok(
      Math.abs((drawnCentres[i] as number) - want) <= 0.11,
      `tile ${i}: its centre must ride the same camera as its outline — drawn at ${drawnCentres[i]}, ` +
        `expected ${want.toFixed(3)} (its ground centre ${groundCentres[i]} times sin 20°)`,
    );
  }
});

test('the COAST follows the camera — the layout hands over a surface, not a finished drawing', () => {
  // The smoothed coastline is the one island input that arrived as a `d` STRING rather than as
  // coordinates: `smoothCoast` produces GROUND loops, and `TreeView.tsx:895-896` projected them at
  // the declared camera and froze them into a path before `buildScene` saw them. A drawing cannot
  // be re-projected, so the coast could not follow a camera the caller did not already apply —
  // which is ADR-0527's title condition sitting in one field.
  const depthAt = (elevationDeg: number): number => {
    const shores = nodesOfKind(sceneAt(elevationDeg, { relaxed: true }), 'coast-shore');
    assert.ok(shores.length > 0, 'the fixture must draw a coastline');
    const ys = ((shores[0] as ScenePath).d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1);
    return Math.max(...ys) - Math.min(...ys);
  };
  const ground = depthAt(PLAN_VIEW_ELEVATION_DEG);
  const drawn = depthAt(LAND_CAMERA_ELEVATION_DEG);
  assert.ok(
    Math.abs(drawn / ground - SIN) <= 0.01,
    `asked for a plan-view surface the coast must be ${(1 / SIN).toFixed(2)}x deeper than at the declared camera; ` +
      `got ${ground.toFixed(1)} vs ${drawn.toFixed(1)} (ratio ${(drawn / ground).toFixed(4)}, expected sin 20° = ${SIN.toFixed(4)}). ` +
      'A ratio of 1 means the coast arrived already drawn and cannot answer to the camera at all.',
  );

  // The SHARED fixture too, not only this file's own. `scene-fixture.ts`'s island is what the
  // byte-golden, tile-art, parcel-repair and kind-coverage suites all build on, and NOTHING asserted
  // that it draws a coast at all — so emptying its loops changed no test's verdict. A fixture whose
  // content no test reads is a fixture that can quietly stop representing the map it stands for.
  const fixtureShores = (elevationDeg: number): ScenePath[] =>
    nodesOfKind(buildScene({ ...shippedInput(), cameraElevationDeg: elevationDeg }), 'coast-shore') as ScenePath[];
  const fixtureGround = fixtureShores(PLAN_VIEW_ELEVATION_DEG);
  assert.ok(fixtureGround.length > 0, 'the SHARED shipped fixture must carry a coast — its loops are not decoration');
  const depthOf = (n: ScenePath): number => {
    const ys = (n.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1);
    return Math.max(...ys) - Math.min(...ys);
  };
  const fixtureDrawn = fixtureShores(LAND_CAMERA_ELEVATION_DEG);
  assert.equal(fixtureDrawn.length, fixtureGround.length, 'the same coast loops at both cameras');
  for (let i = 0; i < fixtureGround.length; i += 1) {
    const g0 = depthOf(fixtureGround[i] as ScenePath);
    assert.ok(g0 > 0, `fixture coast loop ${i} must have real depth to say anything about the camera`);
    assert.ok(
      Math.abs(depthOf(fixtureDrawn[i] as ScenePath) / g0 - SIN) <= 0.05,
      `the shared fixture's coast must follow the camera too (loop ${i})`,
    );
  }
});

test('moving the coast drawing into the core draws the SAME coast — ADR-0527 D6 for this field', () => {
  // D6: the map is pixel-identical across the change, DEMONSTRATED rather than assumed. Until this
  // landing the studio did exactly this, at `TreeView.tsx:895-896`:
  //
  //     const screen = groundLoops.map((loop) => loop.map((p) => projectGround(p)));
  //     const paths  = screen.map(smoothLoopPath);
  //
  // `buildCoast` now does it, at the camera the scene was asked for. This asserts the emitted path
  // is BYTE-IDENTICAL to that expression — not merely close — so the coast on the studio map is the
  // coast it was. It is a separate claim from the equivariance test above: that one says the coast
  // follows the camera, this one says following it lands where the old pipeline landed.
  const wasDrawnBy = smoothLoopPath(COAST_GROUND.map((p) => projectGround(p)));
  const shores = nodesOfKind(sceneAt(LAND_CAMERA_ELEVATION_DEG, { relaxed: true }), 'coast-shore');
  assert.equal(shores.length, 1, 'the fixture draws one coast loop');
  assert.equal(
    (shores[0] as ScenePath).d,
    wasDrawnBy,
    'the coast the core now draws must be byte-identical to the one the caller used to hand over',
  );

  // And the order is free, which is the property that made the move safe: `smoothLoopPath` builds
  // its curve from MIDPOINTS and is therefore LINEAR in its input points, so projecting-then-
  // smoothing and smoothing-then-projecting are the same curve. Pinned rather than believed — if a
  // later change makes the smoothing non-linear (a distance test, a normal, a clamp) this fails and
  // says why, instead of the coast quietly moving.
  //
  // ⚠ THE SAME CURVE, NOT THE SAME BYTES, and the distinction is the rounding rather than the
  // maths. `smoothLoopPath` emits through `toFixed(1)`, so smoothing first rounds at GROUND scale
  // and then multiplies by sin, where projecting first multiplies and then rounds — measured 0.1
  // apart at one vertex (26.7 against 26.6). `TreeView.tsx:895-896`'s own comment said the two
  // orders "reproduce exactly what the other would draw", which is true of the real-valued curve
  // and NOT of the emitted string; the assertion above is the byte-exact one, and it holds because
  // the core now applies the SAME order the caller did.
  const smoothedThenProjected = smoothLoopPath([...COAST_GROUND]);
  const a = (wasDrawnBy.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const b = (smoothedThenProjected.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  assert.equal(a.length, b.length, 'both orders must produce the same number of control points');
  // 0.05 from rounding the projected y, plus 0.05·sin from rounding the ground y before scaling it.
  const slack = 0.05 * (1 + SIN);
  for (let i = 0; i < a.length; i += 2) {
    assert.ok(Math.abs((a[i] as number) - (b[i] as number)) <= slack, `x moved between the two orders at ${i}`);
    const want = (b[i + 1] as number) * SIN;
    assert.ok(
      Math.abs((a[i + 1] as number) - want) <= slack,
      `smoothing is NOT linear in its input points: projecting first gave ${a[i + 1]} where smoothing ` +
        `first gave ${b[i + 1]} (×sin20° = ${want.toFixed(3)}), ${slack.toFixed(3)} of rounding allowed`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. THE REST OF WHAT THE CHANGED LINES EMIT — the mutation rung's witnesses.
// ---------------------------------------------------------------------------
//
// Threading the camera rewrote `buildEmpties`' emission line and `buildTree`'s signature whole, so
// `check:mutation-diff` asks THIS branch's tests about everything those lines decide — not only the
// camera. The two tests below answer for the rest of each line. They are not restatements of the
// equivariance claim above: they pin the coast hex's INSET and its ATTRIBUTION, and the signpost
// default, none of which any test in this file would otherwise notice.

test('an empty coast hex is inset from the lattice, and carries its island id only when attributed', () => {
  const empties = nodesOfKind(sceneAt(PLAN_VIEW_ELEVATION_DEG, { relaxed: true }), 'empty');
  assert.equal(empties.length, 3, 'the fixture states three empty hexes');

  // The coast hex is drawn INSIDE its lattice cell — `art.hexR - art.units(0.6)` — which is the gap
  // that keeps a ring of coast hexes reading as separate tiles rather than as one field. A pointy-top
  // hex of ground radius R is √3·R wide, and in plan view its drawn width is that exactly.
  const inset = PRE_ADR0528_TILE.hexR - 0.6;
  const drawnXs = ((empties[0] as ScenePath).d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);
  const w = Math.max(...drawnXs) - Math.min(...drawnXs);
  assert.ok(
    Math.abs(w - Math.sqrt(3) * inset) <= 0.11,
    `a coast hex must be drawn at the inset radius ${inset} (√3·R = ${(Math.sqrt(3) * inset).toFixed(2)} wide), got ${w.toFixed(2)} ` +
      '— an inset that GREW instead of shrinking closes the gap between coast hexes',
  );

  // ADR-0286: attribution is what a per-story hide has to hold on to on this layer. The fixture
  // states two unattributed hexes and one attributed to territory 0.
  // `Object.hasOwn` rather than `!== undefined`, and the difference is the whole assertion: an
  // emission that always took the attributed branch would hand back `{ kind: 'empty', id: undefined }`
  // for a hex nobody attributed — indistinguishable from `{ kind: 'empty' }` under an `undefined`
  // check, and a real difference to any consumer that enumerates the node's keys.
  const withId = empties.filter((n) => Object.hasOwn(n, 'id'));
  assert.equal(withId.length, 1, 'exactly the attributed hex carries an id KEY — an unattributed one has no key at all');
  assert.equal((withId[0] as { id?: string }).id, 'story', 'and it is the id of the island it grew out of');
  for (const n of empties) assert.equal((n as { kind?: string }).kind, 'empty', 'every one is classed `empty`, attributed or not');
});

test('buildTree draws the human-witness signpost by DEFAULT — the unified vegetation vocabulary is what retires it', () => {
  // `buildTree`'s signature changed whole to take a camera, so its `unifiedVeg = false` default is a
  // line this branch owns. The default is what a direct caller gets, and it is `false`: the signpost
  // is drawn unless ADR-0226's unified vocabulary is in play, which is the only thing that flag does
  // inside this function.
  const territory: SceneTerritoryInput = {
    id: 'story',
    status: 'healthy',
    caps: 4,
    centroid: { x: 0, y: 0 },
    groundRadius: 70,
    screenRadius: 70,
    treeSpot: { x: 0, y: 0 },
    labelY: 46,
    coastGroundLoops: [],
    decor: [],
    plants: [],
    treeTitle: 'story',
    wisps: [],
    signpost: { outcome: null },
    plate: { w: 120, h: 33, rx: 7, idY: 14, subY: 27, idText: 'story', subText: 'x', title: 'story' },
  };
  assert.equal(nodesOfKind(buildTree(territory), 'sign-blank').length, 1, 'the default draws the signpost');
  assert.equal(nodesOfKind(buildTree(territory, true), 'sign-blank').length, 0, 'the unified vocabulary retires it');
});

test("a claimed tile's EXTRUSION is an upright world height, so it carries cos θ where the lattice carries sin θ", () => {
  // ADR-0367 D1's other half, and the half nothing asserted. The classic ground draws a `tile-side`
  // one extrusion BELOW its `tile-top`; that extrusion is a world HEIGHT, not a ground distance, so
  // it foreshortens by cos θ and not by sin θ — the two are opposite functions of the camera, and
  // at plan view (θ = 90°) the extrusion vanishes entirely, which is the reading that separates
  // them most sharply. Pinning the offset is what stops the depth silently reverting to a screen
  // constant when the module-level `TILE_DEPTH` is no longer read here.
  const offsetAt = (elevationDeg: number): number => {
    const tiles = nodesOfKind(sceneAt(elevationDeg, { relaxed: false }), 'tile');
    assert.ok(tiles.length > 0, 'the classic-ground fixture must emit tiles');
    const kids = (tiles[0] as SceneG).children ?? [];
    const side = kids.find((k) => (k as { kind?: string }).kind === 'tile-side');
    const top = kids.find((k) => (k as { kind?: string }).kind === 'tile-top');
    assert.ok(side && top, 'a tile must carry both a side and a top');
    const firstY = (n: SceneNode): number =>
      Number(((n as ScenePath).d.match(/-?\d+(?:\.\d+)?/g) ?? [])[1]);
    return firstY(side as SceneNode) - firstY(top as SceneNode);
  };

  const world = TILE_DEPTH_WORLD;
  assert.ok(world > 0, 'the extrusion must be a positive world height');
  // At the declared camera: exactly `TILE_DEPTH_WORLD · cos 20°`, and BELOW the top (positive y is
  // down in this coordinate space), which is what fixes the sign.
  assert.ok(
    Math.abs(offsetAt(LAND_CAMERA_ELEVATION_DEG) - world * uprightForeshortening(LAND_CAMERA_ELEVATION_DEG)) <= 0.11,
    `at the declared camera the side must sit ${(world * uprightForeshortening(LAND_CAMERA_ELEVATION_DEG)).toFixed(3)} ` +
      `below the top, got ${offsetAt(LAND_CAMERA_ELEVATION_DEG).toFixed(3)}`,
  );
  // Seen from straight down an upright height projects to NOTHING — the side collapses into the top.
  // This is the arm that separates cos from sin (sin would be at its MAXIMUM here) and the arm that
  // catches a divide where a multiply belongs, since dividing by cos 90° diverges.
  assert.ok(
    Math.abs(offsetAt(PLAN_VIEW_ELEVATION_DEG)) <= 0.11,
    `in plan view an upright extrusion has no on-screen height at all, got ${offsetAt(PLAN_VIEW_ELEVATION_DEG)}`,
  );
});

// ---------------------------------------------------------------------------
// 3. THE WHOLE DRAWING, NOT THE THREE SITES: build on the ground, project, and get today's map.
// ---------------------------------------------------------------------------

test('buildScene is EQUIVARIANT end to end: the ground-built scene projected IS the camera-built scene', () => {
  // This is ADR-0527 D1 and D6 stated together and checked in one assertion — the layout may be
  // handed a true surface, and the picture does not move. It compares STRUCTURE as well as
  // coordinates: a different child count or a different node type would mean some choice inside
  // the builder read a projected coordinate (a distance test, a keep-out, a hash of a position),
  // and that is the one way D1 could silently change the map.
  const camera = sceneAt(LAND_CAMERA_ELEVATION_DEG, { relaxed: true });
  const ground = sceneAt(PLAN_VIEW_ELEVATION_DEG, { relaxed: true });

  const problems: string[] = [];
  const walk = (a: SceneNode, b: SceneNode, path: string): void => {
    // `Object.entries` rather than an indexed lookup: the node types are a discriminated union, so
    // there is no key type that indexes all of them, and casting one in to get there would throw
    // away the very evidence the walk is checking.
    const fa = new Map<string, unknown>(Object.entries(a));
    const fb = new Map<string, unknown>(Object.entries(b));
    const ka = [...fa.keys()].sort();
    const kb = [...fb.keys()].sort();
    if (ka.join(',') !== kb.join(',')) {
      problems.push(`${path}: field sets differ — ${ka.join('|')} vs ${kb.join('|')}`);
      return;
    }
    for (const k of ka) {
      if (k === 'children') continue;
      const x = fa.get(k);
      const y = fb.get(k);
      if (GEOMETRY_FIELDS.has(k) && typeof x === 'string' && x === y && GROUND_PLANE_KINDS.has(path.split('/').pop() ?? '')) {
        // ⚠ IDENTICAL IS A FINDING HERE, and it is the hole this walker shipped with. The scalar
        // rule below accepts "unchanged" because an x-ish quantity IS unchanged — but a whole
        // GROUND-PLANE path that is byte-identical at two different cameras did not stay still, it
        // was FROZEN: something handed the builder a finished drawing it cannot re-project. That is
        // exactly the defect a caller-supplied `d` string is, and it read as a pass.
        problems.push(`${path}.${k}: a ground-plane path is byte-IDENTICAL at both cameras — it is frozen, not invariant: "${x}"`);
      } else if (typeof x === 'string' && typeof y === 'string' && x !== y) {
        // A geometry string (`d`, `points`, a `transform`) is compared COORDINATE-WISE through the
        // projection rather than byte-wise: every number is an alternating x, y pair, so the x's
        // must match and each y must be its ground y times sin. This is the strong half of the
        // assertion — it is what would catch a vertex that moved for a reason other than the camera.
        const cmp = geometryThroughProjection(x, y);
        if (cmp !== null) problems.push(`${path}.${k}: ${cmp} — "${x}" vs "${y}"`);
      } else if (typeof x === 'number' && typeof y === 'number') {
        // A scalar carries no axis in its type, and this walker cannot tell an x-ish field from a
        // y-ish one by name (`hit`'s `x`/`width` derive from the territory's own `screenRadius`,
        // which the CALLER states per camera, so they scale where the names suggest they should
        // not). So a scalar is accepted if it is unchanged OR projected, and rejected if it is
        // neither — which is still the signal that matters: a value that is some THIRD number came
        // from a choice that read a projected coordinate.
        if (x !== y && Math.abs(x - y * SIN) > 1e-9) problems.push(`${path}.${k}: ${x} is neither ${y} nor ${y}·sin20°`);
      } else if (typeof x !== 'object' && x !== y) {
        problems.push(`${path}.${k}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
      }
    }
    const ca = (a as SceneG).children ?? [];
    const cb = (b as SceneG).children ?? [];
    if (ca.length !== cb.length) {
      problems.push(`${path}: ${ca.length} children vs ${cb.length} — a choice inside the builder read a PROJECTED coordinate`);
      return;
    }
    for (let i = 0; i < ca.length; i += 1) walk(ca[i] as SceneNode, cb[i] as SceneNode, `${path}/${(ca[i] as { kind?: string }).kind ?? i}`);
  };
  walk(camera, ground, 'scene');

  assert.deepEqual(problems.slice(0, 12), [], `buildScene is not equivariant (${problems.length} findings; first 12 shown)`);
});

// ---------------------------------------------------------------------------
// 5. THE CALLER MAY HAND OVER GROUND ANCHORS — ADR-0527 D1, the caller-side half.
//
// Until this landing every island ANCHOR (`centroid`, `treeSpot`, each plant spot, each decor
// seed) arrived already projected, at whatever camera the caller happened to build it at, and
// `SceneInput.cameraElevationDeg` said so in terms: *"it never re-projects the geometry, which the
// surface has already done"*. That sentence is what these tests retire.
//
// WHY IT MATTERED, and it is not tidiness. Asking `buildScene` for a PLAN-VIEW scene returned one
// whose lattice, coast and substrate were plan-view while its anchors were still frozen at the
// declared camera — a scene at two cameras at once. That is precisely the state ADR-0527 D2's
// deletion needed not to be in: `worldTo3D` cannot map a TRUE ground surface while the surface's own
// anchors are a drawing. ✅ THAT DELETION HAS SINCE LANDED (ADR-0546 D1, 2026-09-08):
// `restoreTrueFootprint` and `stretchAboutIslands` are gone, the mapper un-projects nothing, and a
// plan-view scene is what the 3D map now asks for rather than an instrument's curiosity. So this
// section is no longer describing groundwork — it is the fence under a landed change, and the
// property it holds is what makes "the shipped 2D map cannot see the difference" a proved statement
// rather than a belief.
//
// THE SEAM IS ONE TAG, NOT A SECOND SET OF GROUND TWINS. `anchorSpace` says which space the
// anchors above arrived in and defaults to `screen`, so every caller that has not moved — the
// public website, which authors its anchors by hand rather than deriving them (see below) — is
// byte-for-byte unchanged and needs to learn nothing. A tag deletes itself when the last caller
// converts; a twin field has to be carried forever by everyone.
//
// ⚠ `labelY` IS AN ANCHOR AND DOES MOVE WITH THE TAG (ADR-0545) — and the paragraph that stood here
// saying otherwise was wrong on its own premise. It read: "all four of its consumers are declared
// screen art (the nameplate band), so converting it would be pure tax with no ground-space reading
// to gain". Two of the four are not screen art. `clearsPlate` in the marker scatter and in
// `placeGardenHeroes` decide where a thing STANDS ON THE GROUND, and measuring that against an
// unprojected baseline is the last surviving member of the bug class `scatter-camera.test.ts`
// fences — a different camera accepted a different candidate, and ten UAT markers landed on
// different ground at every angle. The two that ARE screen art, the plate's own drawing and the
// delegation hit rect, read the PROJECTED baseline and are unchanged at the declared camera.
// ---------------------------------------------------------------------------

/** The fixture territory, with its anchors stated in one space or the other. */
function territoryWithAnchors(
  space: 'screen' | 'ground',
  elevationDeg: number,
  // ⚠ BOTH ARMS ARE NEEDED AND ONE FIXTURE CANNOT CARRY THEM. A parcels-PRESENT island RETIRES its
  // decorative conifers and its one-plant-per-cap ring (the parcel flora replaces them), so on that
  // island `decor` and `plants` are never drawn and mutating their projection changes nothing —
  // measured, as six surviving mutants, when this fixture carried parcels only.
  opts: { parcels: boolean } = { parcels: true },
): SceneTerritoryInput {
  // One ground-plane anchor set, deliberately OFF-AXIS in y so the projection has something to do:
  // a y of 0 is its own projection at every camera, which is exactly the frozen-path false green
  // this file's own header warns about.
  const GROUND_CENTROID = { x: 12, y: 40 };
  /** The nameplate's GROUND baseline. Rides the tag with every other anchor since ADR-0545, and is
   *  off-axis for the same reason the centroid is: a y of 0 is its own projection at every camera. */
  const GROUND_LABEL_Y = 46;
  const GROUND_TREE = { x: 12, y: 22 };
  const GROUND_PLANTS = [
    { x: -18, y: 55 },
    { x: 44, y: 31 },
  ];
  const GROUND_DECOR = [
    { x: 27, y: -34 },
    { x: -41, y: 18 },
  ];
  const toScreen = (p: { x: number; y: number }): { x: number; y: number } =>
    projectGround(p, elevationDeg);
  const anchors = space === 'ground' ? <T extends { x: number; y: number }>(p: T): T => p : toScreen;
  const territory: SceneTerritoryInput = {
    id: 'story',
    status: 'healthy',
    caps: 2,
    centroid: anchors(GROUND_CENTROID),
    groundRadius: 70,
    screenRadius: 70 * groundFlattening(elevationDeg),
    treeSpot: anchors(GROUND_TREE),
    labelY: anchors({ x: 0, y: GROUND_LABEL_Y }).y,
    coastGroundLoops: [[...COAST_GROUND]],
    // Conifer seeds and parcel seeds ride the tag with the rest, and they are STATED here rather
    // than left empty because an empty list exercises neither branch: a diff-scoped mutation run
    // over this landing reported the decor map and the `parcels` conditional as uncovered, which is
    // the honest reading of a fixture whose island had no decor and no parcels.
    decor: GROUND_DECOR.map((p, i) => {
      const at = anchors(p);
      return { x: at.x, y: at.y, seed: i + 1 };
    }),
    plants: GROUND_PLANTS.map((p, i) => {
      const at = anchors(p);
      return { id: `cap-${i}`, status: 'healthy' as const, x: at.x, y: at.y, title: `cap ${i}` };
    }),
    treeTitle: 'story',
    wisps: [],
    plate: { w: 120, h: 33, rx: 7, idY: 14, subY: 27, idText: 'story', subText: 'x', title: 'story' },
  };
  if (opts.parcels) {
    territory.parcels = GROUND_PLANTS.map((p, i) => {
      const at = anchors(p);
      return {
        capId: `cap-${i}`,
        status: 'healthy' as const,
        testCount: i + 1,
        theme: i === 0 ? ('meadow' as const) : ('woodland' as const),
        // The Voronoi seed is matched against `relaxedCells`, which arrive already projected — so a
        // seed left in the ground plane re-partitions the island's own ground under its flora.
        seed: { x: at.x, y: at.y },
      };
    });
  }
  // Stated only on the ground arm, and ABSENT on the other — the screen arm's whole job is to be
  // the caller that never learned this field, so writing `anchorSpace: 'screen'` there would test
  // a different thing than the one that ships.
  if (space === 'ground') territory.anchorSpace = 'ground';
  return territory;
}

/** The fixture scene, with its territory's anchors stated in one space or the other. */
function sceneWithAnchors(
  space: 'screen' | 'ground',
  elevationDeg: number,
  opts: { parcels: boolean } = { parcels: true },
): SceneG {
  const draw = TILES.map((h) => ({ h, owner: 0 }));
  return buildScene({
    offset: { x: 0, y: 0 },
    width: 1200,
    height: 900,
    empties: [{ q: 3, r: -1 }, { q: -3, r: 1 }, { q: 0, r: 3, owner: 0 }],
    relaxedCells: buildRelaxedCells(draw, [new Set<string>()], 'mesh', TILE, { elevationDeg }),
    drawTiles: draw,
    wheatSets: [new Set<string>()],
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    territories: [territoryWithAnchors(space, elevationDeg, opts)],
    tile: TILE,
    cameraElevationDeg: elevationDeg,
  });
}

test('GROUND anchors draw the SAME island the caller used to hand over projected — ADR-0527 D6', () => {
  // The D6 claim for this field, demonstrated rather than assumed, and it is the same shape as the
  // coast test above: hand over the GROUND anchors and let the core project, against the caller
  // projecting them itself and handing over the result. The two scenes must be the same scene.
  //
  // This is the whole safety argument for the change. `projectGround` is a per-point map, so
  // projecting at the boundary and projecting at the caller are the same points — but only if the
  // core really does apply it to every anchor and to nothing else. Comparing the emitted trees
  // proves that over the actual consumers rather than over the field.
  // Both islands, because a parcels-PRESENT island retires the conifers and the plant ring: run
  // only that one and the projection of `decor` and `plants` is asserted by nothing.
  for (const parcels of [true, false]) {
    const ground = sceneWithAnchors('ground', LAND_CAMERA_ELEVATION_DEG, { parcels });
    const screen = sceneWithAnchors('screen', LAND_CAMERA_ELEVATION_DEG, { parcels });
    assert.deepEqual(
      ground,
      screen,
      `a territory handed GROUND anchors must draw exactly what the same territory handed the ` +
        `projected ones draws — otherwise the change moves the map (parcels: ${parcels})`,
    );
  }
});

test('GROUND anchors FOLLOW the camera, where projected ones are frozen — ADR-0527 D1', () => {
  // The claim the byte-identity test above cannot make on its own, and the one the header's own
  // lesson demands: an anchor set that is genuinely ground data lands somewhere DIFFERENT when the
  // scene is built at a different camera, where one the caller already projected is frozen and
  // lands in the same place at every camera. Without this, a `buildScene` that quietly ignored
  // `anchorSpace` would pass the test above (both arms would be the screen arm) and prove nothing.
  const atDeclared = sceneWithAnchors('ground', LAND_CAMERA_ELEVATION_DEG);
  const atPlan = sceneWithAnchors('ground', PLAN_VIEW_ELEVATION_DEG);
  const treeAt = (s: SceneG): string => {
    const [tree] = nodesOfKind(s, 'tree');
    assert.ok(tree, 'the fixture draws a story tree');
    // `transform` is on `SceneNodeBase`, so every node kind carries it — no narrowing needed.
    return tree.transform ?? '';
  };
  assert.notEqual(
    treeAt(atDeclared),
    treeAt(atPlan),
    'a GROUND tree spot must land at a different screen y once the camera foreshortens it — if ' +
      'these agree the anchors were never projected and the tag is doing nothing',
  );

  // And it moves by the CAMERA's own ratio, not by some other amount: the declared-camera depth of
  // the ground tree spot is `sin 20°` of its plan-view depth. Pinned so a projection applied at the
  // wrong place (twice, or with the wrong elevation) is a failure rather than merely a difference.
  const yOf = (s: SceneG): number => {
    const m = /translate\(\s*-?[\d.]+\s+(-?[\d.]+)/.exec(treeAt(s));
    assert.ok(m?.[1], 'the tree transform states a y');
    return Number(m[1]);
  };
  assert.ok(
    Math.abs(yOf(atDeclared) / yOf(atPlan) - SIN) <= 0.02,
    `the ground tree spot must foreshorten by sin 20° (got ${yOf(atDeclared) / yOf(atPlan)})`,
  );
});

test('the anchor tag DEFAULTS to screen, so an unconverted caller is untouched — ADR-0527 D6', () => {
  // The public website authors its anchors in screen space by hand — `treeSpot: tr({x: cx, y: cy - 6})`
  // and a plant ring at `cos(a)*r*1.2` / `sin(a)*r*0.85 + 8` — where the studio DERIVES its from
  // `hexCenter`. Those constants are a LOOK, not a projection (the camera's own ratio is 0.342, not
  // 0.85), so no un-projection reproduces them and converting that caller is an owner LOOK on a live
  // public page, not a re-expression. It therefore keeps handing screen anchors, and this pins that
  // omitting the tag is exactly today's behaviour rather than an unstated default.
  const tagged = territoryWithAnchors('screen', LAND_CAMERA_ELEVATION_DEG);
  assert.equal(tagged.anchorSpace, undefined, 'the screen arm states no tag — that is the point');
  const draw = TILES.map((h) => ({ h, owner: 0 }));
  const base = {
    offset: { x: 0, y: 0 },
    width: 1200,
    height: 900,
    empties: [{ q: 3, r: -1 }, { q: -3, r: 1 }, { q: 0, r: 3, owner: 0 }],
    relaxedCells: buildRelaxedCells(draw, [new Set<string>()], 'mesh', TILE, {
      elevationDeg: LAND_CAMERA_ELEVATION_DEG,
    }),
    drawTiles: draw,
    wheatSets: [new Set<string>()],
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    tile: TILE,
    cameraElevationDeg: LAND_CAMERA_ELEVATION_DEG,
  };
  assert.deepEqual(
    buildScene({ ...base, territories: [tagged] }),
    buildScene({ ...base, territories: [{ ...tagged, anchorSpace: 'screen' }] }),
    'an absent tag must mean `screen` — the unconverted caller may not be asked to learn a field',
  );
});
