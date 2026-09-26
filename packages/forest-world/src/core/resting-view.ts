// resting-view.ts — THE ONE PLACE THAT DECIDES HOW MUCH FOREST A SURFACE OPENS ON.
//
// Every map in this project used to answer that question with a fit: the studio's
// `fitWorld(..., 'contain')`, the website's full-extent `viewBox`, the R3F canvas's
// `frameWorld`. All three were correct and none of them was a decision — which is exactly the
// failure `the-resting-view-is-designed-not-fitted` names: "the framing is what the function
// returns for this data" is a true sentence that answers a question nobody asked.
//
// ⚠ THIS IS NOT `fit * 0.75`. That would be the undesigned view with a constant on it, and it
// fails for the stated reason: a forest of one island crops badly where a forest of eighty crops
// well, so a flat multiplier makes the composition a function of how much work happens to exist.
// The rule here is PINNED TO SOMETHING IT MUST SATISFY — a stated on-screen size for one island —
// and the fraction survives only as a FLOOR, a guarantee that the view never opens all the way
// out even when the legibility rule alone would allow it.
//
// WHAT THE COMPOSITION IS, so that a later reader can disagree with a decision rather than
// reverse-engineer an accident:
//
//   THE FRAME'S SHORTER SIDE SPANS `RESTING_ISLAND_SPANS` MEDIAN ISLANDS.
//
// At the reference viewport (a 900 px-tall laptop frame) that puts a median island at ~100 CSS px
// across — four hex parcels wide, which is the size at which an island stops being a coloured dot
// and starts visibly being MADE OF capabilities. That is the property the pitch rests on: the
// forest's floor is the capability tree (ADR-0453 D6), and a resting view that cannot show an
// island has an inside has thrown that argument away before the visitor reads a word.
//
// The measured alternative it replaces, on the live 35-story corpus at 1600x900: the fitted view
// delivers a 44 px island and leaves 55% OF THE FRAME EMPTY, because the forest is portrait
// (3238 x 4005 world units) and a laptop is landscape. "A scene sitting in a small central patch
// of a large frame is a finding on its face, and the finding is a number, not a taste"
// (`legible-at-the-resting-view`).
//
// WHAT IT DELIBERATELY CUTS OFF, and what that invites. The frame is bottom-anchored by both
// shipped surfaces (`align: 'bottom'` is already the house convention), and the forest is ranked
// bottom-up — the most foundational stories at the bottom, everything that depends on them fanning
// upward. So the resting view opens ON THE FOUNDATION and cuts off the canopy. The visitor sees
// the ground the system is built on and, above the top edge, evidence that there is more of it;
// panning up is the discovery gesture the crop exists to provoke. Zoom and pan are untouched on
// every surface — a resting frame short of the whole world is only honest if the rest is reachable.
//
// ⚠ THE CONSTANT BELOW IS A COMPOSITION, NOT A CALIBRATION. Moving it is a change to the
// designed state and owes an ADR-0070 stage-2 operator look, whatever file the diff lands in.
// "The tell that this rule was skipped is a diff that changes framing while describing itself
// purely as maths."

/** How many median-island diameters the frame's SHORTER side spans at rest.
 *
 *  At a 900 px-tall reference frame and the live corpus's 196-unit median island, this delivers a
 *  ~100 CSS px island — about four hex parcels across, the size at which an island reads as made
 *  of capabilities rather than as a coloured blob. It is expressed in ISLANDS rather than in
 *  pixels on purpose: stated that way the composition is the same decision on a phone and on a
 *  desktop, and only its delivered pixel size adapts. A responsive framing is still designed when
 *  the adaptation IS the decision (`the-resting-view-is-designed-not-fitted`). */
export const RESTING_ISLAND_SPANS = 9;

/** The most of the world's own extent the resting view may ever show on the binding axis.
 *
 *  ⚠ THIS IS A FLOOR ON TIGHTNESS, NOT THE RULE. The owner's "we dont have the zoom go all the way
 *  out to show the whole storytree forrest, probably needs to stop 3/4 of the way" (2026-08-22) is
 *  a guarantee that arriving never means arriving at everything. On the live corpus it does not
 *  bind at all — `RESTING_ISLAND_SPANS` is far tighter — and that is the intended relationship.
 *  It bites only in the middle band, where a forest is just slightly larger than the designed
 *  frame and the legibility rule alone would let the view open onto effectively all of it. */
export const MAX_EXTENT_SHOWN = 0.75;

/** Which rule actually chose the scale. Reported rather than inferred, so a surface's evidence can
 *  say WHY it framed the way it did instead of leaving a reader to re-derive it from the number. */
export type RestingBound =
  /** `RESTING_ISLAND_SPANS` bound — the designed composition. The ordinary case. */
  | 'designed'
  /** `MAX_EXTENT_SHOWN` bound — the forest was small enough that the designed frame would have
   *  shown nearly all of it, so the view was tightened to keep something out of frame. */
  | 'extent-floor'
  /** The whole world already fits INSIDE the designed frame, so it is shown whole. A forest with
   *  one island is not improved by cropping it; the crop exists to imply more, and here there is
   *  no more. */
  | 'whole-world'
  /** No island had a usable diameter (an empty or degenerate world). Falls back to the fit, which
   *  is the honest answer when there is nothing to size the composition against. */
  | 'undetermined';

export interface RestingFrameInput {
  /** Every island's ground-plane DIAMETER, world units. The median is what the composition is
   *  pinned to — the median rather than the mean because island size is long-tailed (the live
   *  corpus runs 154 → 366 units) and one very large story should not quietly zoom the whole map
   *  out for everyone else. */
  readonly islandDiameters: readonly number[];
  /** The laid-out world's full extent, world units — the same bounding box a fit would use. */
  readonly contentWidth: number;
  readonly contentHeight: number;
  /** The frame the map is delivered into, CSS px. */
  readonly frameWidth: number;
  readonly frameHeight: number;
}

export interface RestingFrame {
  /** CSS px per world unit at rest — the ONE number every surface converts from. The studio's
   *  `Camera.scale` is this directly; the website divides its frame by it to get a `viewBox`; an
   *  orthographic canvas turns it into `halfHeight = shortSide / (2 * scale)`. */
  readonly scale: number;
  /** The median island's delivered diameter at that scale, CSS px — the stated property the
   *  composition is pinned to, returned so a caller can assert it rather than recompute it. */
  readonly islandPx: number;
  /** The fraction of the world's own extent the frame shows, as an AREA (width fraction x height
   *  fraction, 0..1). The number `legible-at-the-resting-view` asks for, and the one that makes
   *  "short of the whole world" checkable instead of asserted.
   *
   *  ⚠ Do not read this against {@link MAX_EXTENT_SHOWN}. That floor is LINEAR and applies to the
   *  binding axis alone; this is the product of both axes and is therefore normally the smaller
   *  number. They measure different things on purpose — the floor is a guarantee about the axis
   *  the frame is tightest on, and this is what a reader actually sees. */
  readonly extentShown: number;
  /** Which rule chose `scale`. */
  readonly bound: RestingBound;
}

/** The median island size, or `undefined` when nothing usable is in the list.
 *
 *  Finite positives only: a zero-radius or NaN island is not a small island, it is missing data,
 *  and folding it in would drag the composition toward a value no island actually has.
 *
 *  It is the LOWER median on an even count — a size some island really is, rather than the average
 *  of two it interpolates between. That is a deliberate choice and not merely the cheaper one: the
 *  composition is stated as "the frame spans nine median islands", and that sentence is only
 *  literally true if the median is an island. It also removes the even/odd branch entirely, which
 *  is worth having on a function whose whole job is to be boring. The empty case falls out of the
 *  same expression — `Math.floor(-1 / 2)` is -1, and nothing is at -1. */
function medianPositive(values: readonly number[]): number | undefined {
  const usable = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  return usable[Math.floor((usable.length - 1) / 2)];
}

/** The scale at which the whole world is contained by the frame — the fitted view, kept here only
 *  as the thing the resting view is measured AGAINST and as the fallback when the composition
 *  cannot be determined. */
function containScale(input: RestingFrameInput): number {
  const { contentWidth, contentHeight, frameWidth, frameHeight } = input;
  if (contentWidth <= 0 || contentHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) return 1;
  return Math.min(frameWidth / contentWidth, frameHeight / contentHeight);
}

/**
 * The designed resting frame: how much forest a surface opens on, and why.
 *
 * Pure arithmetic over a bounding box and a list of island sizes — no DOM, no camera convention,
 * no coordinate handedness — so every surface can be held to the same composition without any of
 * them agreeing about which way y points.
 */
export function restingFrame(input: RestingFrameInput): RestingFrame {
  const fit = containScale(input);
  const { frameWidth, frameHeight, contentWidth, contentHeight } = input;
  const shortSide = Math.min(frameWidth, frameHeight);
  const island = medianPositive(input.islandDiameters);

  const report = (scale: number, bound: RestingBound): RestingFrame => {
    // A degenerate axis is reported as FULLY shown rather than as a hole. `0 / 0` is the only shape
    // that reaches the fallback — a zero-sized frame over a zero-sized world — and there is no
    // honest fraction for it; every other degenerate combination already divides to Infinity and is
    // clamped by the `min` to 1, so testing finiteness is the whole guard rather than a nest of
    // dimension checks that would each be true whenever it mattered.
    const shownAxis = (framePx: number, contentUnits: number): number => {
      const shown = framePx / (contentUnits * scale);
      return Number.isFinite(shown) ? Math.min(1, shown) : 1;
    };
    return {
      scale,
      islandPx: (island ?? 0) * scale,
      extentShown: shownAxis(frameWidth, contentWidth) * shownAxis(frameHeight, contentHeight),
      bound,
    };
  };

  // Nothing to pin the composition to. Fall back to the fit and SAY SO, rather than inventing a
  // crop of a world whose islands we could not measure.
  if (island === undefined || shortSide <= 0) return report(fit, 'undetermined');

  // The composition: the frame's shorter side spans `RESTING_ISLAND_SPANS` median islands.
  const designed = shortSide / (RESTING_ISLAND_SPANS * island);

  // The whole world already sits inside the designed frame — show it whole. The crop exists to
  // imply that there is more; where there is not, cropping only hides what little there is.
  if (fit >= designed) return report(fit, 'whole-world');

  // The floor: never open onto more than `MAX_EXTENT_SHOWN` of the world on the binding axis.
  // Expressed as a scale, "show less extent" means "scale up", so the floor is a MINIMUM scale.
  const floor = fit / MAX_EXTENT_SHOWN;
  return designed >= floor ? report(designed, 'designed') : report(floor, 'extent-floor');
}
