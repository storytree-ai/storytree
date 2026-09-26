// Hex grid (pointy-top, axial coordinates) — the lattice the forest world's
// territories grow on, plus the small SVG-path helpers the cells/coast render
// from. Pure geometry, browser-safe; the constants here are the studio's
// CANONICAL numbers (the studio wins every divergence from the website seed,
// ADR-0093).
//
// THE TILE IS DERIVED FROM THE LAND RATIO, NOT AUTHORED (ADR-0528 D1). Owner, 2026-09-06, verbatim:
// "option 1, we have time dont take shortcuts." `HEX_R` was 27 by eye and each island was drawn on
// `max(3, capabilities + 2)` of them — a footprint about seven times the island ADR-0520 sizes in
// 3D (`capabilities × 318 units²`), so every island stood in a slot seven times its size and no gap
// ratio (ADR-0521) could close it. Now ONE hex is ONE capability's land: the hex is sized so that
// `HEX_TILES_PER_CAPABILITY` of them cover exactly `LAND_AREA_PER_CAPABILITY`, and an island's quota
// is its capability count (`sizing.ts`'s `tileQuota`). A drawn island IS the island it represents,
// the 2D and 3D maps agree about size for the first time since ADR-0517, and the lattice's growth
// floor — which sets the spacing at gap ratio 0 — shrinks with the islands.
//
// ⚠ EVERY LENGTH THIS ENGINE AUTHORED AGAINST THE OLD TILE IS RE-BASED THROUGH `tileUnits()`. The
// props, keep-outs, offsets and strokes were judged in ground units on a radius-27 tile; a length
// that meant "so much of a tile" keeps meaning that by multiplying by `TILE_SCALE`, and the old
// value stays visible at the call site as `tileUnits(<old>)`. What does NOT re-base is named where
// it stands: a dimensionless ratio, a SCREEN quantity (a hit slop, a padding in CSS px), and the
// trail width the 3D mapper reads directly (`routing.ts`'s one width rule). The memory
// `land-scale-has-three-classes-of-constant` is the same discipline on the 3D side.
//
// THE LATTICE IS A GROUND PLANE, AND IT IS SEEN THROUGH THE DECLARED CAMERA (ADR-0367 D1).
// `HEX_R` / `HEX_W` and the corner offsets are GROUND-plane quantities; every function here that
// hands back SCREEN coordinates projects them through `./camera.js` — the lattice pitch and the
// corner offsets by `groundFlattening` (sin θ), the tile extrusion by `uprightForeshortening`
// (cos θ), because an extrusion is a world height and not a ground distance. Pass an explicit
// `elevationDeg` to ask what the land looks like at another camera; `PLAN_VIEW_ELEVATION_DEG`
// recovers the pre-camera mapping exactly.

import {
  LAND_CAMERA_ELEVATION_DEG,
  groundFlattening,
  uprightForeshortening,
} from './camera.js';

export interface Pt {
  x: number;
  y: number;
}

export interface Axial {
  q: number;
  r: number;
}

/**
 * THE LAND-PER-CAPABILITY RATIO, in ground units² — ADR-0520 D2's constant, and the number the whole
 * lattice below derives from, which is why it lives in this root package (`forest-world-r3f`
 * re-exports it; the mapper still sizes every 3D island to exactly `capabilities × this`).
 *
 * Provenance (ADR-0520 D2): PICKED ON THE LOOK from a rendered ladder (2,239 / 318 / 200 / 108) at
 * both zooms on the RTX 2060 (`docs/research/chapter2-land-per-capability-2026-09-05/`). 318 is the
 * density of the picture the owner called nicer on 2026-09-05 — 72 trees on the fixture island, about
 * 318 units² of land per tree — and the approved Cycles render's own density read in the true basis
 * (≈ 316 per pine; `land-per-capability.test.ts` holds the two within a few percent). A constant
 * with no provenance is how the old ratio drifted unchosen; change this one on a rendered ladder,
 * never by hand.
 */
export const LAND_AREA_PER_CAPABILITY = 318;

/**
 * HOW MANY HEXES DRAW ONE CAPABILITY'S LAND — the shape-granularity lever ADR-0528 D1 names beside
 * the radius. Modelled on the live corpus before choosing (README in
 * `docs/research/chapter2-tile-footprint-2026-09-06/`): 1 keeps the map's hex count near what it
 * was (207 hexes for 35 islands against 277) and makes the parcel partition literal — each
 * capability's parcel is its own hex, which is what the `+ 2` quota approximated; 2–4 multiply the
 * relaxed mesh's cells and shrink the hex below the props drawn on it for no reading the map needs.
 * Radius alone could not do this job: one radius for the whole lattice leaves `(caps + 2) / caps`
 * of the footprint authored, so a one-capability island is drawn at twice its land; quota alone
 * cannot either — at radius 27 a capability is 0.17 of a hex and 18 of 31 islands cannot be drawn.
 */
export const HEX_TILES_PER_CAPABILITY = 1;

/** The area of a regular hexagon of circumradius 1: `(3√3 / 2)`. */
export const HEX_UNIT_AREA = (3 * Math.sqrt(3)) / 2;

/**
 * The hex circumradius, centre → corner, in the GROUND plane — DERIVED: the radius at which
 * `HEX_TILES_PER_CAPABILITY` hexes cover exactly `LAND_AREA_PER_CAPABILITY`. ≈ 11.06.
 */
// Stryker disable next-line ArithmeticOperator: EQUIVALENT WHILE HEX_TILES_PER_CAPABILITY IS 1 —
// the `k` lever of ADR-0528 D1's model ships at 1 (one hex per capability), so dividing by it and
// multiplying by it give the same radius and no test can separate them. Re-picking `k` makes the
// mutant killable, and the landing that re-picks it owes this line its test.
export const HEX_R = Math.sqrt(LAND_AREA_PER_CAPABILITY / HEX_TILES_PER_CAPABILITY / HEX_UNIT_AREA);
export const HEX_W = Math.sqrt(3) * HEX_R;
/** One hex's ground-plane area — `LAND_AREA_PER_CAPABILITY / HEX_TILES_PER_CAPABILITY` by construction. */
export const HEX_AREA = HEX_UNIT_AREA * HEX_R * HEX_R;

/** How an island's tile quota follows its capability count, as prose for a manifest or a caption. */
export const TILE_QUOTA_RULE = `max(1, capabilities) × ${HEX_TILES_PER_CAPABILITY} hexes`;

/**
 * THE TILE THIS ENGINE'S ART WAS AUTHORED ON, TYPED AS HISTORY (ADR-0528). `HEX_R = 27` was the one
 * by-eye number left on the layout path, and every prop, keep-out and offset in `scene.ts`,
 * `coast.ts` and the studio's packer was judged in ground units against it. It is kept here for two
 * readers and nothing on the shipped path draws it: `tileUnits()` re-bases those lengths, and a
 * comparison page's control arm (`shipped-tile-scene.ts`) records which tile the map as it shipped
 * stood on. The quota rule is the old `max(3, capabilities + 2)`.
 */
export const PRE_ADR0528_TILE = Object.freeze({ hexR: 27, quota: 'max(3, capabilities + 2) hexes' });

/**
 * The linear factor from the tile the art was authored on to the derived one — `HEX_R / 27`,
 * ≈ 0.41. Every ground-unit length that meant "so much of a tile" multiplies by it (see
 * {@link tileUnits}); the camera's resting view is pinned to island count (ADR-0471), so a uniformly
 * re-based drawing opens at the same on-screen composition it did — which is the baseline the 2D
 * art pass is judged FROM, never the pass itself.
 */
export const TILE_SCALE = HEX_R / PRE_ADR0528_TILE.hexR;

/**
 * A ground-unit length authored against the pre-ADR-0528 tile, re-based to the derived one. The
 * argument is the historical value, so `tileUnits(7)` reads as "7 on the old tile" at the call site
 * and the classification (this is a tile-relative distance) is visible without a comment.
 */
export function tileUnits(authoredAgainstOldTile: number): number {
  return authoredAgainstOldTile * TILE_SCALE;
}

/**
 * The extrusion below a claimed tile, as a world HEIGHT. Named separately from the projected
 * offset so the two paint sites keep reading one already-projected number, and so the depth stops
 * being a bare screen constant the moment the land has a camera.
 */
export const TILE_DEPTH_WORLD = tileUnits(8);

/**
 * The tile extrusion ON SCREEN — an upright world height through the declared camera, so it carries
 * cos θ where the lattice carries sin θ. Read by the two `tile-side` / `hex-side` paint sites, and
 * (as a layout term) by the studio's nameplate baseline and scene bounds.
 */
export const TILE_DEPTH = TILE_DEPTH_WORLD * uprightForeshortening();

export const axialKey = (h: Axial): string => `${h.q},${h.r}`;

/** Neighbour directions, indexed so AXIAL_DIRS[i] faces the edge corner i → i+1. */
export const AXIAL_DIRS: Axial[] = [
  { q: 1, r: -1 }, // NE  (edge between corners 0 and 1)
  { q: 1, r: 0 }, //  E  (1 → 2)
  { q: 0, r: 1 }, //  SE (2 → 3)
  { q: -1, r: 1 }, // SW (3 → 4)
  { q: -1, r: 0 }, // W  (4 → 5)
  { q: 0, r: -1 }, // NW (5 → 0)
];

/**
 * The camera options {@link hexCenter}/{@link pixelToHex} take — an OBJECT, not a bare positional
 * `number`, and that shape is deliberate (ADR-0367 D1 / the `bare-map-hexcenter-feeds-array-index-
 * as-elevation` increment). `Array.prototype.map` calls its callback `(element, index, array)`; a
 * positional `elevationDeg: number` is exactly the type of `index`, so `xs.map(hexCenter)` used to
 * type-check while silently flattening every tile at its own array position instead of the declared
 * camera (the classic `['1','2'].map(parseInt)` trap — it cost `land-camera-consumers-reconcile` a
 * measured content-extent collapse). `index` is never assignable to `ElevationOpts | undefined`, so
 * that same bare `.map(hexCenter)` now FAILS TO COMPILE instead of silently misbehaving.
 */
export interface ElevationOpts {
  elevationDeg?: number;
  /** The lattice radius to lay the hexes out on. Defaults to the derived {@link HEX_R}; an
   *  INSTRUMENT'S option (ADR-0528) — the r3f harness draws its fixture island on the tile its
   *  ground constants were tuned on (`PRE_ADR0528_TILE.hexR`), so the tuned island stays the tuned
   *  island while the shipped lattice follows the ratio. Nothing on a shipped path passes it. */
  hexR?: number;
}

/**
 * Axial coordinates → SCREEN pixels, through the declared land camera. The `r` axis runs into the
 * ground plane so its pitch foreshortens; the `q` axis runs across the screen so it does not.
 *
 * Pass `{ elevationDeg }` to ask what the land looks like at another camera — never a bare number
 * (see {@link ElevationOpts}), and never point-free to `Array.prototype.map`: wrap even the default
 * case as `xs.map((h) => hexCenter(h))`.
 */
export function hexCenter(h: Axial, opts?: ElevationOpts): Pt {
  const elevationDeg = opts?.elevationDeg ?? LAND_CAMERA_ELEVATION_DEG;
  const R = opts?.hexR ?? HEX_R;
  return {
    x: Math.sqrt(3) * R * (h.q + h.r / 2),
    y: 1.5 * R * h.r * groundFlattening(elevationDeg),
  };
}

/**
 * The inverse of {@link hexCenter} — the map's hit test. It MUST read the same camera: an inverse
 * still dividing by a plan-view pitch would mis-key every click on an angled map.
 *
 * Same `{ elevationDeg }` options shape as {@link hexCenter}, for the same reason — see
 * {@link ElevationOpts}.
 */
export function pixelToHex(p: Pt, opts?: ElevationOpts): Axial {
  const elevationDeg = opts?.elevationDeg ?? LAND_CAMERA_ELEVATION_DEG;
  const R = opts?.hexR ?? HEX_R;
  const rf = p.y / (1.5 * R * groundFlattening(elevationDeg));
  const qf = p.x / (Math.sqrt(3) * R) - rf / 2;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // Normalise negative zero. Projecting the pitch and dividing it back out leaves a coordinate that
  // should be 0 sitting a few ulps below it, so `Math.round` hands back -0 — indistinguishable in
  // arithmetic but NOT under `assert.deepEqual`/`Object.is`, and this key is compared and interned.
  return { q: q + 0, r: r + 0 };
}

export function hexDist(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/**
 * The six corners around the SCREEN point (cx, cy), corner 0 at the top, clockwise.
 *
 * `R` is a GROUND radius, so the corner offsets are ground-plane displacements and their y carries
 * the camera's flattening: the corners land on an ellipse of semi-axes (R, R·sin θ), not a circle.
 * Applying the same affine map to the pitch (in {@link hexCenter}) and to these offsets is what
 * keeps every shared edge shared — a projected lattice still CLOSES, where an arbitrary squash of
 * one but not the other would tear the substrate mesh open along its seams.
 */
export function hexCorners(
  cx: number,
  cy: number,
  R: number,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
): Pt[] {
  const f = groundFlattening(elevationDeg);
  const pts: Pt[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) * f });
  }
  return pts;
}

export function hexPath(
  cx: number,
  cy: number,
  R: number,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
): string {
  return (
    hexCorners(cx, cy, R, elevationDeg)
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ') + ' Z'
  );
}

/** A closed polygon `d` string. */
export function polyPath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  return (
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z'
  );
}
