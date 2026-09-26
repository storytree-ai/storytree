// land-relief.ts — the ground's own relief field, on the SHIPPED side of the package.
//
// ⚠⚠ THIS IS THE FIRST MODULE THIS ARC HAS PUT IN `src/`, AND THAT IS AN OWNER DECISION
// RATHER THAN A REFACTOR. `src/` is MIRRORED into the public storytree-web repo by
// `pnpm sync:web-engine`, so a file landing here is PUBLISHED. ADR-0380 D6 and ADR-0406 D2
// held that crossing as a separate, deliberate event and the owner's to authorise; he
// authorised it on 2026-08-29 looking at `docs/research/chapter2-vocabulary-2026-08-29/`:
// "This looks better, stamp it, i'm still hoping for future iterations to improve the ground
// texture and add shadows." `harness/scope-fence.test.ts` is where that record lives, and it
// is deliberately the same test that used to forbid this.
//
// ⚠ IT IS A MOVE, NOT A COPY. `harness/land-definition.ts` re-exports every symbol below and
// its twenty-odd consumers are untouched. A second relief field would be two lands that
// diverge silently — the exact shape this package already paid for once with three
// disagreeing status palettes.
//
// WHAT IT IS FOR, unchanged from where it was written: the 2026-08-19 island render was the
// first BARE island this arc had drawn, and it showed the land as a SINGLE FLAT GREEN FIELD.
// Every scrap of the island's visual interest then rested on vegetation marks a handful of
// pixels across. Relief is a LIGHTING operation on geometry the land already has — a surface
// normal that varies — so it makes room for shadow instead of competing with it, which is the
// test the owner's 2026-08-16 refusal set ("in 3d its very noisy and doesnt make space for
// shadows which is one of the bigger wins of going 3d").
//
// SEMANTICS DO NOT MOVE (ADR-0367 D5 / ADR-0392 D5). The field is a function of POSITION
// ONLY — not of status, not of test count, not of capability identity — so it asserts nothing
// about any unit's proof state. The parcel still wears its capability's status colour and
// nothing here names a colour at all.
//
// ⚠ THE WAVELENGTHS ARE AUTHORED AGAINST A MEASURED CELL PITCH, AND THE SHIPPED SUBSTRATE
// HAPPENS TO SHARE IT. They were picked against the harness fixture's 16.5-unit mean cell;
// the relaxed-mesh island the studio ships measures 16.57 units mean parcel diameter over its
// 164 parcels (191 distinct ring vertices, 185 of them shared by more than one parcel). So the
// field crosses at its authored scale rather than needing to be re-tuned — and the vertex
// sharing is what makes a CONTINUOUS field watertight across every interior seam for free.
// A per-parcel offset would tear those seams open and re-draw exactly what the owner removed.

//
// A sum of three sine waves at long wavelengths relative to a cell. THE WAVELENGTHS ARE
// THE ART CALL, and they are chosen against a measured cell size rather than by taste:
// the fixture's cells average 16.5 ground units across, so the shortest component here
// (27 units) is still wider than a cell and the longest (62) spans about four of them.
// Anything at or below the cell pitch would land back on exactly what was rejected — a
// per-cell pattern — while wearing relief's clothes.
//
// It is a CONTINUOUS function of position, and that is load-bearing rather than tidy. The
// relaxed substrate interns its vertices, so neighbouring cells share vertex coordinates
// exactly; sampling a continuous field at those coordinates makes the displaced ground
// watertight across every interior seam for free. A per-cell offset would tear it open and
// re-draw the very seams the owner removed.

/** The three components: `[kx, kz, weight, phase]`. Wavelengths 62 / 41 / 27 ground units
 *  against a 16.5-unit mean cell — see the note above for why none may go below it. */
import { LAND_SCALE } from './land-per-capability.js';

const TUNED_WAVES: readonly (readonly [number, number, number, number])[] = [
  [0.0811, 0.0608, 1.0, 0.0],
  [0.0536, -0.1439, 0.6, 1.7],
  [-0.1396, 0.1862, 0.32, 4.1],
];

// ⚠ ÷ LAND_SCALE (`land-per-capability.ts`): the wavenumbers above were judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, so the wavelengths shrink with it and each
// stays the same fraction of the island (and the same multiple of a cell).
const WAVES: readonly (readonly [number, number, number, number])[] = TUNED_WAVES.map(
  ([kx, kz, w, phase]) => [kx / LAND_SCALE, kz / LAND_SCALE, w, phase] as const,
);

/**
 * The relief amplitude, in ground units, at the island page's default.
 *
 * PICKED BY LOOKING, WHICH IS THIS SESSION'S CALL UNDER ADR-0392 D2, and the reason is
 * recorded on the increment rather than left in a constant. The number that actually
 * matters is not the height — it is the SLOPE, because the shader quantises `dot(n, L)`
 * onto a four-rung ladder and only slope moves a pixel between rungs. At the authored
 * light the flat ground sits at rung 0.9; reaching rung 1.0 needs the normal tilted about
 * 9 degrees toward the light and reaching rung 0.8 about 11 degrees away from it. The
 * gradient of the wave sum above peaks at `0.26 * amplitude`, so an amplitude near 2.2
 * puts peak slope around 30 degrees — comfortably across both thresholds, so all three
 * visually distinct rungs appear, while the total height range stays under +/-5 units on a
 * 234-unit island. That is a swell, not terrain.
 */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const LAND_RELIEF_AMPLITUDE = 2.2 * LAND_SCALE;

/** Ground height at a point, in ground units. Deterministic, continuous, C-infinity, and a
 *  function of POSITION ONLY — see the semantics note at the top of this file. */
export function landHeight(x: number, z: number, amplitude = LAND_RELIEF_AMPLITUDE): number {
  let h = 0;
  for (const [kx, kz, weight, phase] of WAVES) h += Math.sin(x * kx + z * kz + phase) * weight;
  return h * amplitude;
}

/** The largest height the field can reach at this amplitude — the sum of the wave weights,
 *  which every component hits together only in principle but which bounds the field exactly.
 *  A camera framing the island needs it: relief is an UPRIGHT extent, so it grows the
 *  island's on-screen height and would otherwise crop. */
export function landHeightRange(amplitude = LAND_RELIEF_AMPLITUDE): number {
  return WAVES.reduce((s, [, , weight]) => s + Math.abs(weight), 0) * Math.abs(amplitude);
}

export interface LandGradientResult { dx: number; dz: number }

/** The field's gradient `[dh/dx, dh/dz]`. Analytic rather than sampled: a finite-difference
 *  normal is a function of the step you happened to pick, and on a banded material a
 *  slightly-wrong normal is not a slightly-wrong colour — it is a different rung. */
export function landGradient(
  x: number,
  z: number,
  amplitude = LAND_RELIEF_AMPLITUDE,
): LandGradientResult {
  let dx = 0;
  let dz = 0;
  for (const [kx, kz, weight, phase] of WAVES) {
    const c = Math.cos(x * kx + z * kz + phase) * weight;
    dx += c * kx;
    dz += c * kz;
  }
  return { dx: dx * amplitude, dz: dz * amplitude };
}

export interface LandNormalResult { x: number; y: number; z: number }

/**
 * The unit surface normal of the relief field at a point.
 *
 * SUPPLIED PER VERTEX, NOT PER FACE, AND THE DIFFERENCE IS THE WHOLE LOOK. A face normal
 * would make every triangle of the ground a flat facet, the ladder would quantise each one
 * whole, and the land would come out as a mosaic of hard triangles — which is the rejected
 * per-cell noise arriving by another route. Interpolating an analytic vertex normal and
 * quantising in the FRAGMENT stage instead puts the rung boundary wherever the surface
 * actually crosses it, so the land reads as broad soft zones with clean edges: the same
 * language a shadow speaks, which is what "makes room for shadow" means in practice.
 */
export function landNormal(
  x: number,
  z: number,
  amplitude = LAND_RELIEF_AMPLITUDE,
): LandNormalResult {
  const { dx, dz } = landGradient(x, z, amplitude);
  const len = Math.hypot(dx, 1, dz);
  return { x: -dx / len, y: 1 / len, z: -dz / len };
}


// ---------------------------------------------------------------------------
// THE PAIR THE GROUND MESH ASKS FOR
// ---------------------------------------------------------------------------

/** The shipped map's ground relief, as the height/normal pair `cellGroundGeometry` takes.
 *
 *  ⚠ NO IMPORT EITHER WAY, DELIBERATELY. This satisfies `GroundRelief` structurally rather than
 *  by declaration, so the geometry module stays arithmetic that a test can drive with any field
 *  it likes — including the constant-zero one that proves the flat ground is this path's own
 *  special case — and neither module has to know the other exists.
 *
 *  ⚠ THE AMPLITUDE IS BOUND HERE AND NOWHERE ELSE ON THE SHIPPED PATH. `landHeight` and
 *  `landNormal` both default it, and a caller that passed a different one to only one of them
 *  would get a surface lit for a shape it does not have — normals that belong to a different
 *  land. Pairing them in one object is what makes that unrepresentable for the map. */
export const landRelief = {
  height: (x: number, z: number): number => landHeight(x, z),
  normal: (x: number, z: number): LandNormalResult => landNormal(x, z),
};
