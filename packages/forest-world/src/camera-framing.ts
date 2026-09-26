// camera-framing.ts — HOW THE SHIPPED CANVAS FRAMES A WORLD. Pure, and behind the provability
// firewall with `world-to-3d.ts`: no React, no three, no drei, so it is `node:test`-provable and
// the framing is checkable without a browser or a GPU.
//
// ⚠ IT WAS NOT ALWAYS PURE, and that is the point of the move. `frameWorld` lived inside
// `ForestWorldCanvas.tsx` beside the JSX, so nothing could reach it: the harness's baseline page
// TRANSCRIBED it instead ("⚠ Transcribed from ForestWorldCanvas.tsx:158-168", against line numbers
// that had already moved), and the shipped map's delivered scale was then reported off the copy.
// Splitting the arithmetic out is what lets a test assert it and the instrument stop guessing at
// it (`harness/projection-probe.ts` reads the projection off the wire instead).
//
// THE PROJECTION IS ORTHOGRAPHIC (ADR-0380 D6 fence 4). Everything here sizes an orthographic
// frustum; the eye's DISTANCE no longer affects the delivered scale, so `position` sets only the
// view direction and the clip range.
//
// ⚠⚠ `frameWorld` IS THE FIT, AND IT IS NO LONGER THE ONLY FRAMING HERE. `restingFrame`
// (`packages/forest-world/src/resting-view.ts`, ADR-0471) is the ONE place that decides how much
// forest a surface opens on, and this module ADOPTS it — see {@link restingWorldFraming} at the
// foot of the file, which is ADR-0471 D8's conversion performed. The two rules now divide by
// AUDIENCE rather than by surface: a product view opens on the designed resting frame, and a
// harness capture page opens on the fit, because an evidence picture wants the whole of whatever
// it is measuring.
//
// ⚠ D8's STATED BLOCKER — "`InstanceDescriptor` carries no island identity, so there is nothing
// here to pin a composition to" — IS DISCHARGED, and the ADR is corrected in place rather than
// argued with here. The `island` field landed on `cell-ground` and `uat-bloom` on 2026-08-31
// (`1ac19fc8`), three days after D8 was written and for an unrelated reason.
//
// ⚠ AND THE SURFACE COUNT IN THIS HEADER MOVED WITH IT. Until 2026-09-08 `<ForestWorldCanvas>` was
// mounted only in this package's own dev harness — verified 2026-08-30 with the `web/` submodule
// checked out: the website syncs this whole directory but imports from it ONLY `act2-director`'s
// pure zod state machine (`web/src/scripts/act2-{walkthrough,script,validate}.ts`). The studio's
// LAND VIEW (`apps/studio/src/components/LandView.tsx`, ADR-0530's route C staged as its first
// half) is now a second mount, beside the SVG map and never instead of it. The website is still
// not one.
//
// ⚠ WHAT THIS RULE ACTUALLY FRAMES — about 2x the vertical room a flat world can occupy, and the
// margin is NOT headroom. `spread` is a max over GROUND |x| and |z|, but the eye looks down at
// `SHIPPED_ELEVATION_DEG`, so a ground span of z delivers only `sin(elev)` of SCREEN height.
// `back * FRAME_HALF_HEIGHT_PER_BACK` is `spread * 1.5230` — the retired perspective camera's own
// margin, carried forward on purpose — and dividing that by `sin(50°)` gives 1.988 (it was 2.1539
// at the 45° this canvas looked down at until 2026-09-05). That figure is re-derived here from
// this file's own constants and needs no instrument.
//
// ⚠ AND IT IS DELIBERATELY LEFT THAT WAY — do not "fix" it with a `sin(elev)` factor. The repair
// was proposed, costed at ~1.3x more delivered detail, and declined: nothing a visitor sees is
// framed by this function, so that 1.3x accrues to nobody, and `resting-view.ts` says the framing
// is ONE decision now and a second must not be added. That declining is what
// {@link restingWorldFraming} discharges: the mounted view adopts `restingFrame` instead of
// growing a better fit here, so repairing the fit would still be building the wrong thing better —
// and `frameWorld`'s remaining audience, the capture pages, wants the margin it has. The
// `2.6` was born in the original spike commit `ee675ad3`, where `back` was a perspective camera's
// eye DISTANCE, beside a comment reading "the camera backs off proportionally to the world's
// spread"; it was never a headroom decision by anyone.
// (Increment `does-the-shipped-framing-waste-a-third-of-the-screen`, settled 2026-08-29.)
//
// ⚠⚠ THIS ANNOTATION IS RECOVERED, AND TWO OF ITS FIGURES ARE NOT REPRODUCED HERE. It was written
// by session `land-framing` settling `does-the-shipped-framing-waste-a-third-of-the-screen` on
// 2026-08-29, and it landed ONLY as a hand-edit of the generated mirror
// (`storytree-web` commit `bfcc0c4`, whose message calls itself a "re-sync" of this file). The
// parent-side change was never committed on any branch here, so the next legitimate sync would
// have silently deleted a settled decision from the public repo — which is how it was found. Its
// closing sentence cited "all four figures measured in `camera-framing.test.ts` with a
// 30°-elevation control and a corrected-rule control"; those tests do not exist in this repo and
// that sentence is dropped rather than carried, because a citation to a test nobody has is worse
// than none. Two figures go with it and are recorded as UNVERIFIED HERE: raising every instance to
// a 92-unit hero-tree crown was measured to move the over-frame only 2.154 → 1.972, and tall
// objects were said to need a factor of 1.09 against the 2.15 reserved. Anyone re-opening this
// re-measures those two; the decision above rests on the 2.154 that this file can re-derive.

import { groundFlattening, restingFrame, type RestingFrame } from './core/index.js';

import { RENDER_ELEV_DEG } from './kit-vocabulary.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/**
 * THE ELEVATION THE SHIPPED CANVAS LOOKS DOWN AT — the owner-signed 50° every approved render was
 * taken at (`build_land.py`'s `RENDER_ELEV_DEG`, mirrored as `kit-vocabulary.ts`'s constant), by
 * import rather than by a second `50` (ADR-0517 D2).
 *
 * ⚠ IT WAS 45° UNTIL 2026-09-05, and the five degrees were taken WITH the footprint fix and never
 * instead of it: PR #1820's ladder measured the elevation alone as worth 7.5% of the island's
 * on-screen height against the footprint's 129%. Moving it is what makes every instrument that
 * already read `RENDER_ELEV_DEG` — the crowd layout's `ELEV_RAD`, `deliveredHeightPx`, the
 * object floor the prop sizes were chosen against — report against the camera that actually
 * ships, where before they reported against one five degrees higher than the canvas looked from
 * (ADR-0517 D3). `shippedElevationDeg()` READS the angle back off {@link frameWorld} so a test can
 * hold that the eye and this constant agree.
 */
export const SHIPPED_ELEVATION_DEG: number = RENDER_ELEV_DEG;

/** How far the eye sits from the target per unit of `back`: the retired perspective camera sat
 *  `back` up and `back` along +z, i.e. `back · √2` away, and the orthographic eye keeps that
 *  distance so the same `near`/`far` range still contains the world. */
const EYE_DISTANCE_PER_BACK = Math.SQRT2;

/** The eye's offset from the target: `y` up and `z` along +z. */
interface EyeOffset {
  y: number;
  z: number;
}

/** The eye's offset from the target for a given `back`: `EYE_DISTANCE_PER_BACK · back` away,
 *  along +z, raised to {@link SHIPPED_ELEVATION_DEG}. */
function eyeOffset(back: number): EyeOffset {
  const elev = (SHIPPED_ELEVATION_DEG * Math.PI) / 180;
  const dist = back * EYE_DISTANCE_PER_BACK;
  return { y: dist * Math.sin(elev), z: dist * Math.cos(elev) };
}

/** The elevation the eye actually looks down at, read back off {@link frameWorld}'s own output —
 *  never a transcription of the constant it was built from. */
export function shippedElevationDeg(): number {
  // ⚠ READ OFF A WORLD AWAY FROM THE ORIGIN. Framing an empty world targets (0, 0, 0), where
  // `position - target` and `position + target` are the same number and a reader that got the
  // subtraction wrong would still report the right angle — `check:mutation-diff` found exactly
  // that. One stand-in instance off-origin makes the target non-zero, so the arithmetic is real.
  // Stryker disable next-line StringLiteral: EQUIVALENT — `frameWorld` reads only `transform`; the
  // family and group of the probe are not consulted, so any string here is the same probe.
  const probe: InstanceDescriptor = { kind: 'wisp-sprite', transform: { x: 37, y: 0, z: 91 }, group: 'wisp-sprite' };
  // Stryker disable next-line ArrayDeclaration: EQUIVALENT — an empty world targets the origin and
  // still reports the same angle; the probe exists so the x/z subtractions below are non-trivial.
  const frame = frameWorld([probe]);
  const dx = frame.position[0] - frame.target[0];
  // Stryker disable next-line ArithmeticOperator: EQUIVALENT — the target's y is always 0 (the
  // ground plane), so adding and subtracting it are the same number.
  const dy = frame.position[1] - frame.target[1];
  const dz = frame.position[2] - frame.target[2];
  return (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

/** Where the camera sits and what it looks at — a `[x, y, z]` pair the drei `MapControls` reads.
 *  Named rather than written inline on {@link frameWorld}'s return, because
 *  `anti-slop/no-known-value-widening` reads an anonymous object return annotation as discarded
 *  type evidence and inc-08's refactor panel settled the fork toward NAMING rather than deleting
 *  (deleting it would infer the tuples as `number[]` and break the drei props). */
export interface CameraFraming {
  target: [number, number, number];
  position: [number, number, number];
  /** How much world, in units, the view shows above and below the target. On an orthographic
   *  camera this is the whole framing — the eye's DISTANCE no longer affects the delivered scale,
   *  so `position` now sets only the view DIRECTION and the clip range. */
  halfHeight: number;
  /** The near clip plane, world units along the view direction from the eye. */
  near: number;
  /** The far clip plane, world units along the view direction from the eye. */
  far: number;
}

/**
 * HOW MUCH ROOM THE CLIP RANGE LEAVES FOR WHAT STANDS ON THE GROUND, world units.
 *
 * Everything this module measures is a ground-plane footprint — cell rings, ribbons, anchors — but
 * what the canvas DRAWS also has height: the kit's trees reach about 90 units, and a wisp floats
 * above its island. Bracketing the range on the ground alone would clip the tops off the near row.
 */
export const CLIP_HEADROOM = 200;

/** The near and far clip planes, world units along the view direction from the eye. Named rather
 *  than returned anonymously, because `anti-slop/no-known-value-widening` reads an anonymous object
 *  return annotation as discarded type evidence — and because a test that re-derives the rule needs
 *  a contract to derive against. */
export interface ClipRange {
  near: number;
  far: number;
}

/**
 * THE CLIP RANGE THAT CONTAINS THE WORLD — and it is derived rather than declared, because the one
 * that was declared did not.
 *
 * ⚠⚠ THE CANVAS SHIPPED WITH `near: 1, far: 4000` WRITTEN INTO ITS JSX, and that pair is only ever
 * correct for a small world. The eye backs off with the world's spread — `frameWorld` puts it
 * `max(260, spread · 2.6) · √2` from the target — so a world whose spread passes about 850 units
 * puts its own ground BEHIND the far plane and the canvas draws an empty frame. Measured 2026-09-08
 * on storytree's real 35-island forest, the first world of that size this canvas was ever handed:
 * the ground sat **6227 to 8492 units** along the view direction against a far plane at 4000, and
 * the studio's land view came up 99.8% background. Nothing errored, nothing warned, and every test
 * in this package was green — a fixed clip range cannot fail on a fixture smaller than itself.
 *
 * ⚠ THE `2 ·` IS FOR THE VIEWER, not for safety margin. `MapControls` pans, which moves the target
 * and the eye together across a forest 3,524 units deep; a range bracketed tightly around the
 * OPENING view would clip the far end the moment someone panned to it. Twice the radius is exactly
 * the worst case — the target at one edge of the world, the geometry at the other.
 *
 * ⚠ AND A GENEROUS RANGE COSTS AN ORTHOGRAPHIC CAMERA NOTHING. Its depth is linear in world units,
 * so widening the range does not trade away precision the way it would under perspective; there is
 * no reason to make this tight and one measured reason not to. `near` may come out NEGATIVE on a
 * world wider than the eye is far, which is legal for an orthographic frustum (the near plane is
 * simply behind the eye) and is what containing the world actually requires — clamping it to a
 * positive number would reintroduce the same clipping at the near edge.
 */
function clipRange(
  instances: readonly InstanceDescriptor[],
  target: readonly [number, number, number],
  position: readonly [number, number, number],
): ClipRange {
  // Stryker disable next-line ArithmeticOperator: EQUIVALENT for the `y` term only, and stated
  // precisely. `target[1]` is 0 on EVERY path that produces a `CameraFraming` — the target is a
  // point on the ground plane, and both producers write the 0 as a literal — so adding and
  // subtracting it are the same number and no fixture can separate them. The x and z terms are NOT
  // equivalent and are killed by `assertClipRangeRule`, which re-derives this expression over a
  // world whose target is nowhere near the origin.
  const eyeDistance = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
  let radius = 0;
  for (const instance of instances) {
    for (const p of instance.points ?? [instance.transform]) {
      // Stryker disable next-line ArithmeticOperator: EQUIVALENT for the `y` term only, same reason
      // as above — `target[1]` is always 0. It is worth keeping the term rather than dropping it:
      // an instance's own `p.y` is not always 0 (a wisp is drawn above its island, and the ADR-0517
      // families carry height), so the DISTANCE this measures is genuinely three-dimensional even
      // where the target's own height is not.
      radius = Math.max(radius, Math.hypot(p.x - target[0], p.y - target[1], p.z - target[2]));
    }
  }
  const reach = 2 * radius + CLIP_HEADROOM;
  return { near: eyeDistance - reach, far: eyeDistance + reach };
}

/** How much world half-height the RETIRED perspective camera framed per unit it backed off.
 *
 *  ⚠ IT IS INHERITED ON PURPOSE, and it is not a live field of view. That camera sat `back` units
 *  up and `back` units along +z — a 45° elevation, so `back * √2` from the target — and framed
 *  `distance * tan(fov / 2)` of world at the target plane at `fov = 45°`. Reproducing the number
 *  it delivered is what makes the before/after pictures a comparison of PROJECTIONS rather than of
 *  framings: the island lands at the same size in the frame, and the only thing that changes is
 *  whether its near edge is drawn bigger than its far one. Recomputing rather than writing 0.5858
 *  down keeps the derivation legible; `ForestWorldCanvas.test.ts` pins the value. */
export const FRAME_HALF_HEIGHT_PER_BACK = Math.SQRT2 * Math.tan(Math.PI / 8);

/** The framed half-height for an empty world — what the retired perspective camera's own
 *  `max(260, …)` floor delivered, so an empty canvas frames exactly as much world as before. */
const EMPTY_WORLD_HALF_HEIGHT = 260 * FRAME_HALF_HEIGHT_PER_BACK;

/** Frame the whole world on load: the instance centroid is the MapControls target, the camera
 *  looks down at {@link SHIPPED_ELEVATION_DEG} from the +z side (azimuth fixed — ADR-0380 D6
 *  fence 4, no viewer rotation), and the framed half-height grows with the world's spread. */
export function frameWorld(instances: InstanceDescriptor[]): CameraFraming {
  if (instances.length === 0) {
    const eye = eyeOffset(260);
    const target: [number, number, number] = [0, 0, 0];
    const position: [number, number, number] = [0, eye.y, eye.z];
    return { target, position, halfHeight: EMPTY_WORLD_HALF_HEIGHT, ...clipRange(instances, target, position) };
  }
  let sx = 0;
  let sz = 0;
  for (const i of instances) {
    sx += i.transform.x;
    sz += i.transform.z;
  }
  const cx = sx / instances.length;
  const cz = sz / instances.length;
  let spread = 0;
  for (const i of instances) {
    spread = Math.max(spread, Math.abs(i.transform.x - cx), Math.abs(i.transform.z - cz));
  }
  const back = Math.max(260, spread * 2.6);
  const eye = eyeOffset(back);
  const target: [number, number, number] = [cx, 0, cz];
  const position: [number, number, number] = [cx, eye.y, cz + eye.z];
  return {
    target,
    position,
    halfHeight: back * FRAME_HALF_HEIGHT_PER_BACK,
    ...clipRange(instances, target, position),
  };
}


/** The orthographic `zoom` that frames `halfHeight` world units of a viewport whose SHORTER side
 *  is `shortSideCssPx` CSS pixels.
 *
 *  R3F sizes a default orthographic frustum in CSS pixels (`left/right = ∓width/2`,
 *  `top/bottom = ±height/2`) and divides by `zoom`, so `zoom` IS the delivered CSS-px per world
 *  unit — ONE number, everywhere in the frame. That is the whole substance of fence 4: a
 *  perspective camera has no single such number, and the shipped canvas measurably delivered 5.1%
 *  more px/unit at the near edge of an island than at the far one (PR #1679, reproduced 2026-08-28).
 *
 *  The SHORTER side is the binding one: fitting the longer side would let the island overflow the
 *  other axis on any non-square canvas. */
export function orthographicZoomFor(halfHeight: number, shortSideCssPx: number): number {
  return Math.max(shortSideCssPx, 1) / (2 * Math.max(halfHeight, Number.EPSILON));
}

// ---------------------------------------------------------------------------
// THE DESIGNED RESTING FRAME, ADOPTED (ADR-0471 D1/D8)
// ---------------------------------------------------------------------------
//
// ⚠⚠ D8'S STATED BLOCKER IS DISCHARGED, AND THE ADR IS CORRECTED IN PLACE RATHER THAN RESTATED
// HERE. When ADR-0471 was accepted (2026-08-28) it recorded that this canvas could not adopt
// `restingFrame` because "`InstanceDescriptor` carries no island identity except on `cave-arch`,
// so its framing has no island size to pin to", and that supplying one meant threading
// `SceneTerritoryInput.groundRadius` through `worldTo3D`. Island identity landed three days later
// for an unrelated reason — `1ac19fc8`, "the shipped map can say whose signature that is", which
// put `island` on `cell-ground` and `uat-bloom` so a UAT bloom could be attributed to the story
// that signed it. So the field exists, and it did NOT arrive by the route D8 predicted: nothing
// threads `groundRadius`, because an island's ground diameter is MEASURED off the parcel rings the
// mapper already emits rather than asserted by its layout. That is the better answer of the two —
// the size this frames on is the size the canvas actually draws.
//
// WHAT IS ADOPTED, AND IT IS THE WHOLE COMPOSITION RATHER THAN THE SCALE ALONE. `restingFrame`
// decides how much forest a surface opens on (the frame's shorter side spans
// `RESTING_ISLAND_SPANS` median islands) and the two shipped 2D surfaces also bottom-anchor it, so
// the crop opens on the forest's FOUNDATION and runs the canopy off the top edge. Taking the scale
// without the anchor would put this view on the MIDDLE of the corridor while the map beside it
// shows the bottom — two surfaces framed by the same rule and opening on different forest, which
// reads as a defect and not as a composition. Both halves come from the shared rule; neither is
// invented here.
//
// ⚠ IT DOES NOT REPLACE {@link frameWorld}, which stays the FIT the dev harness opens on. A
// harness page renders one island or a synthetic crowd into a fixed capture buffer and wants the
// whole of it; the resting view is a product composition about arrival, and pinning a capture to
// it would crop evidence pages for a reason that has nothing to do with what they measure.

/**
 * GROUND-PLANE FORESHORTENING AT THE SHIPPED EYE — how much of a ground DEPTH this camera
 * delivers, as a fraction of the ground WIDTH it delivers for the same distance.
 *
 * The eye sits at {@link SHIPPED_ELEVATION_DEG} above the ground plane with its azimuth fixed
 * (ADR-0380 D6 fence 4), so the camera's right axis is world +x and its up axis is
 * `(0, cos θ, -sin θ)`. A ground displacement along x projects onto right at full length; one
 * along z projects onto up at `sin θ` of its length. `restingFrame` compares an island's size
 * against a frame in CSS px, so every extent handed to it has to be in the space the frame
 * actually delivers — which is this one, not raw ground.
 *
 * It is `groundFlattening` at THIS camera rather than a second `Math.sin`: the same function the
 * land's own projection uses, asked about a different eye (ADR-0367 D1 — one projection scalar,
 * never a second copy).
 */
export const SHIPPED_GROUND_FLATTENING: number = groundFlattening(SHIPPED_ELEVATION_DEG);

/** A point in the space the camera DELIVERS: `u` across the frame, `v` up it, both in world units.
 *  `v` runs OPPOSITE to ground z, because SVG y → 3D z means +z is the bottom of the page. */
interface Delivered {
  u: number;
  v: number;
}

/** An axis-aligned box in delivered space; `null` stands for "nothing to bound". */
interface DeliveredBox {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

/** Every ground point an instance occupies: its parcel/ribbon `points` when it carries a footprint,
 *  and otherwise the single point it stands at. A `cell-ground` ring is what gives an island its
 *  measured size; a point-like family contributes its anchor so the world's extent still contains
 *  it. */
function deliveredPointsOf(instance: InstanceDescriptor): Delivered[] {
  const pts = instance.points ?? [instance.transform];
  return pts.map((p) => ({ u: p.x, v: -p.z * SHIPPED_GROUND_FLATTENING }));
}

/** The delivered bounding box of a point set, or `null` when the set is empty. */
function boxOf(points: readonly Delivered[]): DeliveredBox | null {
  const first = points[0];
  if (first === undefined) return null;
  let box: DeliveredBox = { minU: first.u, maxU: first.u, minV: first.v, maxV: first.v };
  for (const p of points) {
    box = {
      minU: Math.min(box.minU, p.u),
      maxU: Math.max(box.maxU, p.u),
      minV: Math.min(box.minV, p.v),
      maxV: Math.max(box.maxV, p.v),
    };
  }
  return box;
}

/**
 * EVERY ISLAND'S DELIVERED DIAMETER, world units — the quantity `restingFrame` pins the
 * composition to, one entry per island the descriptors name.
 *
 * ⚠ MEASURED OFF THE GROUND THE CANVAS DRAWS, never asserted by the layout. An island's cells are
 * the `cell-ground` descriptors carrying its {@link InstanceDescriptor.island}, and each one's
 * `points` is the parcel's own closed ring — so the diameter here is the extent of the land this
 * canvas will actually stand, including whatever the relaxation and the per-capability sizing did
 * to it. Reading a `groundRadius` through the mapper instead (what ADR-0471 D8 expected to be
 * necessary) would state a size the drawn island need not have.
 *
 * ⚠ THE LARGER SIDE OF THE DELIVERED BOX, because "diameter" has to mean one number and the
 * delivered box of a round island is anisotropic by construction: at 50° a ground disc of diameter
 * D delivers `D` across and `D · sin 50°` up. The larger side is therefore the island's own GROUND
 * diameter, which is the quantity the 2D map pins its composition to as well — so the two surfaces
 * span nine of the same thing rather than nine of two different things.
 *
 * ⚠ ONLY `cell-ground` COUNTS. A bloom or a cave carries an island id too, but it is a point on the
 * island rather than a part of its land, and folding those in would report a diameter that shrinks
 * as an island's props do.
 */
export function islandDeliveredDiameters(instances: readonly InstanceDescriptor[]): number[] {
  const byIsland = new Map<string, Delivered[]>();
  for (const instance of instances) {
    if (instance.kind !== 'cell-ground') continue;
    const id = instance.island;
    if (id === undefined) continue;
    const points = byIsland.get(id) ?? [];
    points.push(...deliveredPointsOf(instance));
    byIsland.set(id, points);
  }
  const diameters: number[] = [];
  for (const points of byIsland.values()) {
    const box = boxOf(points);
    if (box === null) continue;
    diameters.push(Math.max(box.maxU - box.minU, box.maxV - box.minV));
  }
  return diameters;
}

/** The framing this canvas opens on when it opens on the designed resting view, plus the report of
 *  WHICH rule chose the scale — carried through so a surface's evidence can say why it framed the
 *  way it did rather than leaving a reader to re-derive it from the number (`RestingBound`). */
export interface RestingWorldFraming extends CameraFraming {
  readonly resting: RestingFrame;
}

/** The viewport the framing is delivered into, CSS px. */
export interface FramingViewport {
  readonly width: number;
  readonly height: number;
}

/**
 * FRAME THE WORLD ON THE DESIGNED RESTING VIEW — this canvas's half of ADR-0471 D1.
 *
 * The scale is `restingFrame`'s, converted exactly as D8 says: `halfHeight = shortSide / (2 *
 * scale)`, which is the inverse of {@link orthographicZoomFor} and therefore lands the camera at a
 * `zoom` of `scale` — one delivered CSS px per world unit, the same number the studio's SVG map
 * puts on its own `<g class="world-camera">`.
 *
 * The ANCHOR is `restingWorld`'s: horizontally centred, vertically bottom-aligned on the world's
 * own bottom edge. A resting scale is deliberately tighter than the fit, so where the anchor sits
 * decides which forest you see; bottom-anchoring is what opens the view on the foundation the
 * system is built on and runs the canopy off the top, which is the composition rather than an
 * overflow (`resting-view.ts`).
 *
 * ⚠ THE EYE'S DISTANCE IS STILL THE FIT'S, and that is deliberate rather than an oversight. On an
 * orthographic camera `position` sets only the view DIRECTION and the clip range — it cannot
 * affect the delivered scale — so the eye keeps backing off with the world's spread, which is what
 * keeps `near`/`far` containing a forest the viewer has since panned across.
 *
 * An empty world falls through to {@link frameWorld} rather than inventing a composition for a
 * forest with no islands in it.
 */
export function restingWorldFraming(
  instances: readonly InstanceDescriptor[],
  viewport: FramingViewport,
): RestingWorldFraming {
  const fit = frameWorld([...instances]);
  const world = boxOf(instances.flatMap((i) => deliveredPointsOf(i)));
  if (world === null || viewport.width <= 0 || viewport.height <= 0) {
    return { ...fit, resting: { scale: 1, islandPx: 0, extentShown: 1, bound: 'undetermined' } };
  }
  const resting = restingFrame({
    islandDiameters: islandDeliveredDiameters(instances),
    contentWidth: world.maxU - world.minU,
    contentHeight: world.maxV - world.minV,
    frameWidth: viewport.width,
    frameHeight: viewport.height,
  });
  const shortSide = Math.min(viewport.width, viewport.height);
  const halfHeight = shortSide / (2 * resting.scale);
  // Bottom-aligned: the frame's own bottom edge sits on the world's, so the target is half a
  // frame-height above it. The frame's vertical half-extent is the FULL height over the scale —
  // not `halfHeight`, which is measured against the shorter side and is the same number only on a
  // portrait viewport.
  const centreV = world.minV + viewport.height / (2 * resting.scale);
  const target: [number, number, number] = [
    (world.minU + world.maxU) / 2,
    0,
    -centreV / SHIPPED_GROUND_FLATTENING,
  ];
  // Stryker disable next-line ArithmeticOperator: EQUIVALENT for the mutant generated, stated
  // precisely rather than claimed in general. Stryker rewrites the `y` term to
  // `fit.position[1] + fit.target[1]`, and `frameWorld` returns `target: [cx, 0, cz]` on EVERY
  // path — the empty-world branch included — because the target is a point on the ground plane and
  // the ground plane is y = 0. Adding and subtracting zero are the same number, so no fixture can
  // separate the two. ⚠ The `z` term is NOT equivalent and is not disabled: `fit.target[2]` is the
  // world's own depth centroid and is routinely non-zero.
  const eye = { y: fit.position[1] - fit.target[1], z: fit.position[2] - fit.target[2] };
  const position: [number, number, number] = [target[0], target[1] + eye.y, target[2] + eye.z];
  return {
    target,
    position,
    halfHeight,
    ...clipRange(instances, target, position),
    resting,
  };
}
