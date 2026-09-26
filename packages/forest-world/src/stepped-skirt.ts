// stepped-skirt.ts — THE ISLAND'S EDGE AS SIX ROCK LEDGES INSTEAD OF ONE FLAT WALL.
//
// THE COMPONENT. `adopt-the-land-into-the-shipped-map-arc`'s approved treatment is six components,
// and this is the last of them: "the asset kit's cliff on a six-row stepped skirt". Until now the
// shipped 3D ground's edge was ONE quad per ring edge, falling straight to `-CELL_GROUND_DEPTH`
// and wearing the parcel's own status colour darkened by its facing — a single extruded face which
// the approved render's own author calls, in terms, "a lot of frame doing nothing at 1948 px"
// (`docs/research/chapter2-land-idiom-2026-08-27/build_land.py`).
//
// ⚠⚠ WHY THIS COMPONENT NEEDED THE OWNER AND THE OTHER FIVE DID NOT. Every colour on this map's
// ground is a capability's proof state (ADR-0392 D5 / ADR-0398 D7), and the edge wall inherits the
// parcel's tint, so it reports too. A ROCK-coloured cliff is the first ground surface that reports
// nothing — a change to what the map promises, not an art choice, and ADR-0414 D1 ("the shipped map
// carries no decoration") is what made it the owner's. He settled it on 2026-09-01
// (`oq-the-island-s-cliff-needs-a-rock-colour-may-a-ground-surfa`), and the answer granted MORE than
// the question asked:
//
//     "regarding rock color, yeah stamp it the test should be overall themse color, so we should
//      have flexibility for session to add additional colors as needed, the session should just
//      look at the final and ask itself can I tell what state this island is in."
//
// So the fence moved from COMPOSITION (every ground colour must report) to OUTCOME (the island's
// state must still be readable), and the judgement is the SESSION'S to apply on the final render
// rather than the owner's to re-issue per surface. That is why this module adds tokens without a
// second question, and why the evidence pages beside it are pictures of the arms rather than
// requests for a verdict.
//
// ⚠⚠ AND THERE ARE TWO ROCKS NOW, NOT ONE — corrected in place on 2026-09-01, the same day the
// single one landed. The cliff that shipped first is `chapter2-shipped-skirt-2026-09-01/`; the pair
// that ships now is `chapter2-skirt-tonal-range-2026-09-01/`, and {@link SKIRT_ROCK_LIT} carries
// the arithmetic that forced it. The median rock is KEPT — it is still drawn, as the comparison
// page's `rock` arm and therefore as the denominator the pair is measured against.
//
// ⚠ WHAT DOES NOT MOVE. The delivered pixel is still an authored `(token x level)` closure entry —
// each rock is one more ROW on the same ramp, quantised onto the same ladder, with no free shading,
// no gradient, no texture and no exception in the checker (ADR-0380 D6 fence 3). A SECOND token is
// not a second mechanism: `harness/palette-band.ts` already gives every prop material with a lit
// top and a shaded flank two tokens for exactly this reason, and the shadow rung already grew this
// closure without opening it. And no STATUS token moves: the rocks are family-less entries beside
// them, exactly as the harness's prop materials are (ADR-0406 D4), and
// `harness/skirt-rock-separation.test.ts` holds all three to the same obligation — no rock ledge
// may ever deliver a colour a status family delivers.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// THE PROFILE IS TRANSCRIBED, NOT INVENTED. Every constant below is read off the approved render's
// own build script (`build_land.py`, the `with_strata` fork), because the picture the owner stamped
// is the specification and a plausible-looking re-authoring would be a different cliff wearing this
// one's name. Two things are DELIBERATELY different, and both are the shipped map's own convention
// winning over the experiment's:
//
//  1. THE OUTWARD DIRECTION IS THE EDGE'S OWN NORMAL, NEVER A CENTROID RAY. `build_land.py` insets
//     each row along the ray from the ISLAND's centroid, which it can do because it builds one
//     island as one ring. The shipped ground is per-PARCEL, and `cell-ground-geometry.ts` already
//     carries the argument for why a centroid is wrong here: on an L-shaped parcel the centroid
//     sits in the notch, OUTSIDE the shape, so "away from the centre" points INTO the parcel along
//     the notch edges. The edge normal is a local fact and is right for every parcel shape.
//
//  2. THE LEDGES HANG FROM THE RELIEF, NOT FROM A FLAT SLAB BOTTOM. `build_land.py` interpolates
//     each row's height from the ring's top down to a constant `-SLAB_DEPTH`. The shipped prism is
//     CONSTANT-THICKNESS on purpose — the relief field reaches ±4.22 units against a 3-deep prism,
//     so a bottom pinned at `-depth` would sit ABOVE the top face wherever the land dips and every
//     wall there would be inside out. So `drop` here is a FRACTION of the parcel's own depth and
//     the ladder rides the land, which is the same interpolation with the shipped invariant kept.
//
// ⚠ AND THE SEED IS LESS MYSTERIOUS THAN IT LOOKS, which is worth writing down so nobody preserves
// it as magic. `(row * 7919) % 13` looks like a hash; for the six rows this profile has it is
// exactly `(2 * row) % 13` — 2, 4, 6, 8, 10, 12 — because 7919 ≡ 2 (mod 13). So the "seeded"
// jitter is a linear ramp over six rows, and the alternation that actually makes the bedding planes
// read comes from {@link SKIRT_INSET_IN} / {@link SKIRT_INSET_OUT}, not from the seed. It is
// transcribed rather than simplified because the render was taken with this arithmetic and a
// simplification would silently move the cliff at any other row count.

import { edgeKey, type CoastPoint } from './coast-clip.js';
import {
  SHADE_LEVELS,
  deliveredForLevel,
  lambertOfNormal,
  parseHex,
  toHex,
  type Rgb255,
} from './shade-ladder.js';

/**
 * THE INDICES 0..count-1, MATERIALISED — so every loop in this module is a `for … of` and carries
 * no counter to mutate.
 *
 * ⚠⚠ IT IS HERE FOR THE MUTATION RUNG, AND THE REASON IS SPECIFIC. `for (let i = 0; i < n; i += 1)`
 * carries mutants that flip `+=` to `-=` and `<=` to `>`. NEITHER FAILS AN ASSERTION — both run
 * forever, Stryker scores the timeout as `Timeout`, and `check:mutation-diff` maps that to UNPROVEN:
 * neither a pass nor a survivor, and it reds the rung. Three of this module's mutants landed there,
 * printing `no test named`, which reads exactly like a coverage-attribution problem and is not one.
 * A materialised range has nothing to mutate into a hang, so the mutants stop existing rather than
 * needing a `Stryker disable` somebody would have to justify.
 *
 * `Math.max(0, count)` is the only decision left, and it is a real one: a negative count would make
 * `Array.from` throw rather than yield nothing.
 */
function indices(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => i);
}
import type { LinearRgb, P2, P3 } from './cell-ground-geometry.js';
import { LAND_SCALE } from './land-per-capability.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/** How many ledges an island's edge is cut into — the approved treatment's own number
 *  (`build_land.py`: `rows = 6 if with_strata else 1`). */
export const SKIRT_ROWS = 6;

/** The prime the row jitter is drawn from. See the module header: for six rows it reduces to
 *  `(2 * row) % 13`, and it is kept in this form because that is the arithmetic the approved
 *  render was taken with. */
export const SKIRT_INSET_SEED = 7919;

/** The jitter's period. */
export const SKIRT_INSET_PERIOD = 13;

/** The inset an ODD ledge takes, in ground units, POSITIVE MEANING INWARD (`build_land.py`
 *  subtracts `inset * outward`). Odd rows cut back into the island and are what makes the cliff
 *  read as bedding planes rather than as one face. */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const SKIRT_INSET_IN = 0.55 * LAND_SCALE;

/** The inset an EVEN ledge takes — NEGATIVE, so it stands PROUD of the ring above it. The base
 *  course ends up ~0.16 units outboard of the parcel's own outline, which is what gives the
 *  island a plinth rather than a taper. */
export const SKIRT_INSET_OUT = -0.12 * LAND_SCALE;

/** The jitter's floor and range: each row's inset is its side's magnitude times
 *  `SKIRT_JITTER_BASE + SKIRT_JITTER_SPAN * ((row * SEED) % PERIOD) / PERIOD`. */
export const SKIRT_JITTER_BASE = 0.6;
export const SKIRT_JITTER_SPAN = 0.8;

/**
 * THE ROCK, AND IT IS A MEASUREMENT RATHER THAN A CHOICE — which is the half of the owner's
 * settlement that said "have one proposed against your approved picture".
 *
 * ⚠ HOW IT WAS TAKEN, because the method is what makes it a transcription rather than an eyedropper
 * guess. `land-combined-1948px.png` and `land-strata-1948px.png` are the SAME render differing in
 * NOTHING but the skirt material (`build_land.py`'s `with_strata` fork, and the README's §6 says so
 * in terms). So the set of pixels where the two images differ IS the skirt, exactly — no hand-drawn
 * mask and no "the dark ring is probably the cliff". Over that mask, on 76,297 skirt pixels
 * (6.67% of the island's own pixels), the approved render's MEDIAN skirt colour is
 * `rgb(77, 77, 79)`. That is this token, unrounded.
 *
 * ⚠ IT IS NEUTRAL AND THAT IS THE POINT, not a failure to find a hue. Every status family sits on
 * the green / ochre / brown axis, and the harness's prop palette already establishes the rule this
 * follows: an ornament's colour is chosen WELL OFF the axis the statuses occupy, so it can never be
 * read as one of them (ADR-0406 D4, `harness/palette-band.ts`). A neutral dark grey is as far off
 * that axis as this map has room for.
 *
 * ⚠ WHAT THE SINGLE TOKEN CANNOT DO, stated here rather than discovered later. The approved skirt
 * spans luma 20.7 (p2) to 117.6 (p90) — a 5.7x range, because a path tracer lights it. This map's
 * ladder spans 0.80 to 1.00, a 1.25x range, so ONE token cannot reproduce that spread and the
 * shipped cliff is flatter than the render's. That is the arc's standing finding arriving again —
 * a component can cross correctly and still not deliver the look — and it is measured on the
 * comparison page rather than inferred.
 */
export const SKIRT_ROCK = '#4d4d4f';

/**
 * THE LIT ROCK — the same mask's UPPER quartile, `rgb(115, 114, 116)`.
 *
 * ⚠⚠ WHY A SECOND AND THIRD TOKEN EXIST AT ALL, AND IT IS ARITHMETIC RATHER THAN TASTE. The
 * median above shipped on 2026-09-01 and the landing measured what it could not do: the approved
 * skirt spans luma 20.7 (p2) to 117.6 (p90), a **5.7x** range, because a path tracer lights it,
 * while {@link SHADE_LEVELS} spans 0.80 to 1.00, a **1.25x** range. One token stepped down that
 * ladder cannot reach 5.7x — so no re-pick of a single rock closes the gap, and the remedy is a
 * SECOND colour rather than a better first one.
 *
 * ⚠⚠ AND THE LADDER IS WORSE THAN ITS OWN 1.25x, WHICH IS THE MEASUREMENT THAT CHOSE THE
 * SELECTION RULE. Swept over 36 rim azimuths (`stepped-skirt.test.ts` re-derives it), the three
 * DOWN-facing ledges land on rung 0.800 at **every single azimuth** — 36 of 36, no exceptions —
 * and the three UP-facing ledges land there at 19, 17 and 15 of 36. The ladder's darkest rung is
 * a FLOOR, and more than half the cliff is piled on it: the shipped cliff delivers luma 62.1 to
 * 77.1 and most of it is 62.1. So the faces a second token must carry are not "the odd rows" or
 * "the ones facing away" — they are exactly the faces whose true lighting falls BELOW the ladder,
 * where the quantiser has saturated and a token is the only lever left. That is
 * {@link ledgeBelowLadderFloor}, and it is derived from the ladder rather than authored beside it.
 *
 * THE HOUSE PATTERN, NOT A NEW INVENTION. `harness/palette-band.ts` already states the rule for
 * exactly this situation and states the reason in the same terms: *"each material that has a lit
 * top and a shaded flank gets TWO tokens rather than relying on the ladder: at `LIGHT_DIRECTION`
 * every vertical face lands on rung 0 … so a one-token wall delivers exactly two colours and reads
 * as a silhouette. A separate `-Light` coping or `-Dark` base is what gives built things their
 * edge."* The cliff is that material; `stoneLight`/`stone`/`stoneDark` is that pair, one tier up.
 *
 * ⚠ IT IS THE SAME TRANSCRIPTION, EXTENDED — never a hue picked to look right. `SKIRT_ROCK` is
 * the MEDIAN over the difference mask between `land-combined-1948px.png` and
 * `land-strata-1948px.png`; these two are that same population's UPPER and LOWER quartiles, i.e.
 * the median of its lit half and the median of its shaded half. One measurement, split at its own
 * median, over the same 76,297 pixels. Nothing here was eyedroppered and nothing was tuned to a
 * target.
 *
 * ⚠ AND THEY ARE NOT LIFTED TO COMPENSATE FOR THE LADDER FLOOR, which was considered and dropped
 * on the instrument's own arithmetic. A shaded ledge always lands on rung 0.80, so authoring
 * `quartile / 0.80` would make the DELIVERED pixel equal the measurement instead of the token.
 * The difference is `rgb(23,26,30)` against `rgb(29,32,37)` — a largest-channel move of **7**,
 * against ADR-0490 D6's visibility bar of 20. It is an arm no reader could tell from this one, so
 * it is not built: the raw quartile keeps the convention {@link SKIRT_ROCK} already set, where the
 * token IS the measurement and the ladder is what it is.
 */
export const SKIRT_ROCK_LIT = '#737274';

/**
 * THE SHADED ROCK THE SEA SWALLOWED — the same mask's LOWER quartile, `rgb(29, 32, 37)`, shipped
 * on 2026-09-01 (PR #1792) and WITHDRAWN the next day. It is kept as the comparison page's
 * `two-token-sunk` arm — the "before" every re-pick below is read against — and the map draws it
 * nowhere.
 *
 * ⚠⚠ WHY IT WAS WRONG, STATED SO IT IS NOT REPEATED. The transcription was sound about the RENDER
 * and unsound about OUR SCENE: `land-combined-1948px.png` is RGBA and 53.8% transparent, so its
 * dark values sit against whatever composites them — never against this map's sea, `#101418`,
 * luma 19.4. Delivered at the ladder's floor this token is `rgb(23, 26, 30)`: a largest-channel
 * move of **7** from the water against ADR-0490 D6's bar of **20**. Twelve of the cliff's
 * eighteen pixels merged into the sea and the cliff read **6 px tall where the single rock had read
 * 18**. The owner saw it by looking ("looks thinner, but if i look closer you have colored the
 * bottom half a blackish color"); the instrument REWARDED it — `imageStats` anchors on the
 * island's own pixels with the background excluded, so the darker the base, the better it scored,
 * right up to invisibility. A colour lifted from one picture's mask is only valid against that
 * picture's background.
 *
 * The fence that now holds it is `harness/skirt-rock-separation.test.ts` ("EVERY PIXEL A SHIPPING
 * ROCK CAN DELIVER CLEARS THE SEA"); the record is `the-cliffs-dark-base-must-read-against-the-sea`.
 */
export const SKIRT_ROCK_SHADED_SUNK = '#1d2025';

/**
 * THE APPROVED SKIRT'S LUMA LANDMARKS over its own 76,297-pixel mask (Rec.709, 0..255): the 2nd
 * percentile, the LOWER QUARTILE — which is {@link SKIRT_ROCK_SHADED_SUNK}'s own luma — and the
 * 90th percentile. Measured in `chapter2-skirt-tonal-range-2026-09-01/`; the pair of ends is the
 * 5.7x range one token cannot span, restated by `stepped-skirt.test.ts`.
 */
export const APPROVED_SKIRT_LUMA = { p2: 20.7, lowerQuartile: 31.7, p90: 117.6 } as const;

/** Rec.709 luma over delivered 0..255 channels — the axis every dark anchor on this arc is read on,
 *  and the same weights `imageStats` reads its own anchor with. */
export function lumaOf(c: Rgb255): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * A SHADED ROCK WHOSE DARKEST DELIVERED PIXEL SITS A STATED LUMA ABOVE THE SEA.
 *
 * The chroma is the measured quartile's ({@link SKIRT_ROCK_SHADED_SUNK}) — the hue the approved
 * render's shaded rock actually has — scaled per channel so that, delivered at `darkestRung`, its
 * luma is `lumaOf(sea) + aboveSea`. Rounded to a hex ONCE, here, so the map and every page that
 * reads the hex deliver the same bytes. This is the ladder's rung-maker: the comparison page
 * renders it at several `aboveSea` values and the owner scales back along rungs already rendered
 * (ADR-0503 D3).
 *
 * ⚠ LUMA ABOVE THE SEA IS NOT THE FENCE. The fence is a largest-CHANNEL move of more than 20/255
 * on every rung (ADR-0490 D6), and a luma clearance of exactly 20 delivers channel moves of 20 —
 * on the bar, not over it. The harness test holds the fence; this function only makes rungs.
 */
export function shadedRockAboveSea(
  sea: Rgb255,
  aboveSea: number,
  darkestRung: number = SHADE_LEVELS[0]!,
): string {
  const quartile = parseHex(SKIRT_ROCK_SHADED_SUNK);
  const scale = (lumaOf(sea) + aboveSea) / darkestRung / lumaOf(quartile);
  const q = (v: number): number => Math.min(255, Math.max(0, Math.round(v * scale)));
  return toHex({ r: q(quartile.r), g: q(quartile.g), b: q(quartile.b) });
}

/**
 * THE APPROVED RANGE MAPPED INTO THE HEADROOM THIS SEA LEAVES — the principled candidate, and the
 * one rung of the ladder that is derived rather than stepped.
 *
 * The approved skirt runs from p2 to p90 and its lower quartile sits a fixed FRACTION of the way
 * up that range (11.4%). Our range cannot start at the render's p2, because the sea occupies it:
 * it starts at the sea plus `clearance`, and it ends where the lit rock ends at full light. The
 * shaded rock keeps its fraction of the range it is now allowed — so it is the same split the
 * picture made, re-based onto our own floor, rather than a value copied absolutely from a picture
 * whose floor was transparency.
 */
export function mappedShadedRock(sea: Rgb255, clearance: number, lit: string = SKIRT_ROCK_LIT): string {
  const { p2, lowerQuartile, p90 } = APPROVED_SKIRT_LUMA;
  const fraction = (lowerQuartile - p2) / (p90 - p2);
  const floor = lumaOf(sea) + clearance;
  const ceiling = lumaOf(deliveredForLevel(lit, SHADE_LEVELS[SHADE_LEVELS.length - 1]!));
  return shadedRockAboveSea(sea, clearance + fraction * (ceiling - floor));
}

/**
 * THE DARKEST SHADED ROCK THE SEA FENCE ADMITS — found by search, never authored.
 *
 * Walks `aboveSea` up from the bar one luma at a time and returns the first rung whose EVERY
 * delivered pixel (each level in `levels` — the caller passes the nine authored rungs and the
 * shadow rung) moves more than `bar` on its largest channel from the sea. That is the floor the
 * fence in `harness/skirt-rock-separation.test.ts` permits, stated as a colour: the boldest dark
 * base that still reads against the water. Refuses past `maxAboveSea` rather than returning a
 * rock that could not be found, which would be a sea no rock can clear.
 */
/** One rung of the shaded-rock ladder: the hex and how far, in luma, its darkest delivered pixel
 *  sits above the sea. */
export interface ShadedRockRung {
  hex: string;
  aboveSea: number;
}

export function darkestShadedRock(
  sea: Rgb255,
  bar: number,
  levels: readonly number[],
  maxAboveSea: number = 120,
): ShadedRockRung {
  const move = (c: Rgb255): number =>
    Math.max(Math.abs(c.r - sea.r), Math.abs(c.g - sea.g), Math.abs(c.b - sea.b));
  for (let aboveSea = Math.ceil(bar); aboveSea <= maxAboveSea; aboveSea += 1) {
    const hex = shadedRockAboveSea(sea, aboveSea);
    if (levels.every((level) => move(deliveredForLevel(hex, level)) > bar)) return { hex, aboveSea };
  }
  throw new Error(
    `stepped-skirt: no shaded rock within ${maxAboveSea} luma of the sea ${toHex(sea)} clears a ` +
      `${bar}/255 bar on every rung — the sea leaves no headroom for a cliff base`,
  );
}

/**
 * THE SHADED ROCK — RE-PICKED AGAINST THIS SCENE'S OWN SEA, 2026-09-02, AT THE FENCE'S FLOOR.
 *
 * `darkestShadedRock(#101418, 20, nine rungs + the shadow rung)` = 21 luma above the water: the
 * darkest base whose every delivered pixel still clears ADR-0490 D6's 20/255 bar on some channel
 * (the rung below it, 20, delivers moves OF 20 at the ladder floor — on the bar, not over it).
 * Delivered at the ladder's darkest rung it is `rgb(37, 41, 47)`, luma 40.6; at the shadow rung
 * its worst channel still moves 21. The harness test pins this hex to that search, so a hand edit
 * that drifts from it fails by name.
 *
 * ⚠ WHY THE FLOOR AND NOT THE MAPPED QUARTILE (`mappedShadedRock`, 28.5 luma, `#373c46`). Both
 * were rendered as a ladder beside 36, 44 and the sunk rock, at one island and 8 px per unit
 * (`docs/research/chapter2-cliff-sea-read-2026-09-02/`), and judged by the look per ADR-0503 D3.
 * The floor reads as the deepest two-tone cliff that is still plainly a cliff and not the sea;
 * every lighter rung compresses the pair toward the single median rock. It is also the rung whose
 * island dark anchor lands nearest the approved render's (about 4 luma off, against the mapped
 * quartile's 13). The owner directed bold, judged by a picture per step, with "scale it back" as
 * his lever: the ladder is rendered, and scaling back is one constant moved to a rung already
 * pictured. The mapped quartile stays on the page as `two-token-mapped` for exactly that reason.
 *
 * ⚠ IT STILL BUYS SEPARATION FROM THE STATUSES RATHER THAN SPENDING IT. Its whole ramp sits
 * below `unhealthy`'s (delivered 40.6–50.7 against unhealthy's 67.1–83.9), it stays the island's
 * darkest value, and it clears its nearest status pixel by more than the single median rock's 9.0
 * — `harness/skirt-rock-separation.test.ts` re-derives all three on every run.
 *
 * ⚠ WHAT IT CANNOT DO, so nobody re-derives it: the pair no longer reaches the approved 5.7x
 * range — against THIS sea no pair can, because the range now starts above the water rather than
 * at the render's transparent p2. The reachable span is the lit rock's full light over the sea
 * floor, about 2.9x, and this pair delivers about 2.8x of it. That is the sea's arithmetic, not a
 * timid pick.
 */
export const SKIRT_ROCK_SHADED = '#2e333b';

/** One ledge of the cliff: how far it is cut back from the parcel's own outline, and how far down
 *  the prism its lower edge hangs. */
export interface SkirtLedge {
  /** 1-based, top ledge first — the row index the jitter is keyed on. */
  row: number;
  /** Ground units, POSITIVE INWARD. The point is `p - inset * outward`. */
  inset: number;
  /** Fraction of the parcel's depth this ledge's LOWER edge hangs at. The last ledge is exactly
   *  1, so a stepped wall ends where the single-quad wall ended and the prism keeps its
   *  thickness. */
  drop: number;
  /** Ground units this ledge steps horizontally from the one ABOVE it, POSITIVE INWARD — the
   *  ledge's own run, as opposed to {@link SkirtLedge.inset}, which is its position. Carried on
   *  the ledge rather than differenced in the wall loop so the profile's shape is a property of
   *  {@link skirtLedges} that a node test can read directly. */
  step: number;
  /** Fraction of the parcel's depth this ledge FALLS through — its own rise, as opposed to
   *  {@link SkirtLedge.drop}, which is where it ends up. */
  fall: number;
}

/**
 * THE INSET FOR ONE LEDGE, transcribed from `build_land.py`.
 *
 * ⚠ ROWS ARE 1-BASED because the source is: row 0 IS the parcel's own ring, at inset 0, and is not
 * a ledge. Asking for row 0 here would be asking for the ring, so it returns 0 rather than
 * throwing — the honest answer, and the one that keeps {@link skirtLedges} a plain loop.
 */
export function skirtInset(row: number): number {
  if (row <= 0) return 0;
  const side = row % 2 === 1 ? SKIRT_INSET_IN : SKIRT_INSET_OUT;
  const jitter =
    SKIRT_JITTER_BASE +
    (SKIRT_JITTER_SPAN * ((row * SKIRT_INSET_SEED) % SKIRT_INSET_PERIOD)) / SKIRT_INSET_PERIOD;
  return side * jitter;
}

/**
 * THE WHOLE PROFILE — every ledge, top first.
 *
 * ⚠ `rows === 1` IS THE SHIPPED WALL EXACTLY, and that is what makes the before/after a controlled
 * comparison rather than a claim: one ledge at inset 0 and drop 1 is the single quad this map has
 * always drawn, emitted by the same code path. The flat arm is not a second implementation.
 */
export function skirtLedges(rows: number = SKIRT_ROWS): readonly SkirtLedge[] {
  // ⚠ THERE IS NO `rows < 1` GUARD, AND ADDING ONE BACK WOULD BE DEAD CODE. The loop below runs
  // from 1 to `rows`, so a row count of 0 or less emits nothing by construction. A guard sat here
  // until `check:mutation-diff` showed it could be deleted — or inverted to `false` — without any
  // test noticing, which is what an unreachable branch looks like from outside. Same argument, and
  // the same evidence, as `cellGroundGeometry`'s absent empty-input guard.
  return indices(rows).map((i) => {
    const row = i + 1;
    // ⚠ THE SINGLE-ROW CASE TAKES NO INSET AT ALL. A lone ledge cut back from its own ring would
    // be a shipped map that moved when nothing was added to it, which would make every "byte
    // identical without the skirt" claim on the comparison page false.
    const inset = rows === 1 ? 0 : skirtInset(row);
    // ⚠ THE LEDGE ABOVE ROW 1 IS THE PARCEL'S OWN RING, at inset 0 and drop 0 — which is why the
    // previous position is spelled as `skirtInset(row - 1)` rather than read back out of an array
    // being built. `skirtInset(0)` is 0 by its own documented contract, so the top ledge's step is
    // its whole inset and no boundary case is written down twice.
    //
    // ⚠ AND THERE IS NO `rows === 1 ?` HERE, WHICH THERE WAS — it read `rows === 1 ? 0 :
    // skirtInset(row - 1)`, and `check:mutation-diff` showed the condition could be replaced by
    // `false` with no test noticing. That is what a guard against a case the callee already handles
    // looks like from outside: the single-row skirt's only row is 1, and `skirtInset(0)` is 0. The
    // line above it still needs its guard — a lone ledge must take NO inset of its own — so the two
    // are deliberately not symmetrical.
    const prevInset = skirtInset(row - 1);
    return { row, inset, drop: row / rows, step: inset - prevInset, fall: 1 / rows };
  });
}

/**
 * THE LEDGE QUAD'S OWN OUTWARD NORMAL — the surface direction its whole face points, before the
 * relief tilts either end of it.
 *
 * `step` is the ledge's horizontal run POSITIVE INWARD and `fall` is how far it drops, both in the
 * same units, so the face's downhill tangent is `(-step * outward, -fall)` and its outward normal
 * is `(fall * outward, -step)`. A ledge that steps INWARD as it falls is an undercut and points
 * DOWN; one that steps OUTWARD stands proud and points UP. That alternation is the whole bedding-
 * plane read, and it is a property of the profile rather than of any parcel.
 *
 * ⚠⚠ IT IS DELIBERATELY THE IDEALISED NORMAL AND NOT THE ONE `pushTriangle` DERIVES, and the
 * reason is that this one picks a TOKEN rather than a rung. The wall's two triangles get their own
 * winding-derived normals — which differ from each other whenever the relief tilts the ring edge —
 * and that is right for SHADING. It is wrong for a colour: a quad whose two triangles disagreed
 * about which rock they are would split along its own diagonal, which reads as a tear rather than
 * as a facet. One normal per quad makes that unrepresentable.
 *
 * ⚠ A ZERO-LENGTH FACE HAS NO DIRECTION, and the honest answer is the outward normal itself: at
 * `step === 0` and `fall === 0` there is no quad to face anywhere, and returning the edge's own
 * outward direction is the same answer {@link FLAT_WALL} gets — a vertical wall — rather than a
 * NaN propagated into a lighting term.
 */
export function ledgeNormal(outward: P2, step: number, fall: number): P3 {
  const len = Math.hypot(step, fall);
  if (len === 0) return { x: outward.x, y: 0, z: outward.z };
  return { x: (fall * outward.x) / len, y: -step / len, z: (fall * outward.z) / len };
}

/**
 * IS THIS FACE BELOW THE LADDER'S FLOOR — i.e. darker than {@link SHADE_LEVELS} can express?
 *
 * ⚠⚠ THIS IS THE SELECTION RULE FOR THE SECOND ROCK, AND IT IS READ OFF THE LADDER RATHER THAN
 * AUTHORED. `SHADE_LEVELS[0]` is the darkest multiplier any surface on this map may wear, so a
 * face whose half-lambert falls under it is one the quantiser has SATURATED: every such face is
 * delivered at exactly the same lightness however much darker its true lighting is. Those faces
 * are precisely the ones a token can still move and a rung cannot, so they are the ones the shaded
 * rock carries. Any other rule — alternate rows, "the ones facing away", a hand-picked set — would
 * be a decision about the picture; this one is a report about the instrument.
 *
 * ⚠ THE COMPARISON IS AGAINST THE FLOOR, NOT AGAINST THE FIRST BIN. `bandLevelIndex` sends
 * everything below 0.8125 to rung 0, so a "quantises to rung 0" test would also claim faces the
 * ladder represents perfectly well (0.80 to 0.8125) and is merely rounding. Saturation is the
 * narrower and the true claim: BELOW the darkest rung, the ladder has run out.
 *
 * ⚠ THE TIE GOES TO THE LADDER — a face sitting exactly ON the floor is representable, so it is
 * NOT below it and keeps the lit rock. `floor` is a parameter for the reason `nearestLevelIndex`'s
 * ladder is one: over the authored `SHADE_LEVELS[0]` no reachable face lands on an exact tie, so
 * the `<`-versus-`<=` rule is unobservable there and its mutant is equivalent. Injected a floor
 * that a constructible normal hits exactly, the rule is decidable in one assertion. Nothing in the
 * product passes it.
 */
export function ledgeBelowLadderFloor(normal: P3, floor: number = SHADE_LEVELS[0]!): boolean {
  return lambertOfNormal(normal) < floor;
}

/**
 * WHICH ROCK ONE LEDGE WEARS — injected, exactly as `isRim` and `resolve` are, so the choice is a
 * property of the SKIRT rather than a constant compiled into the wall loop.
 *
 * ⚠⚠ IT IS INJECTED BECAUSE THE OBVIOUS RULE WAS MEASURED AND LOST, and a comparison page cannot
 * put two rules beside each other if one of them is hard-coded in the builder. See
 * {@link shadeBelowLadderFloor} for what it lost to and why.
 */
export type SkirtShadeRule = (ledge: SkirtLedge, outward: P2, depth: number) => boolean;

/** NEVER — the one-token cliff, where both entries of the pair are the same rock anyway. Named
 *  rather than written as `() => false` at each call site so "this cliff wears one rock" reads as a
 *  choice. */
export const shadeNever: SkirtShadeRule = () => false;

/**
 * THE RULE THAT LOST, KEPT AS AN ARM — shade the faces whose lighting falls BELOW the ladder's
 * darkest rung ({@link ledgeBelowLadderFloor}), i.e. the ones the quantiser has saturated.
 *
 * ⚠⚠ IT IS THE OBVIOUS RULE AND IT IS THE WRONG ONE, MEASURED RATHER THAN ARGUED, and it is kept
 * so the next reader inherits the measurement instead of re-deriving it. The reasoning is sound as
 * far as it goes: a face under the floor is delivered at one lightness however much darker it truly
 * is, so a token is the only lever left on it. What that reasoning omits is the CAMERA. On this
 * map's fixed 2.5D view the saturated faces are 74.7% of the cliff's TRIANGLES, 54.5% of its
 * front-facing triangles — and **19.0% of its projected AREA**, because a face turned away from the
 * light is also turned away from a camera only 52° from the light, and is therefore seen nearly
 * edge-on. Measured on the shipped fixture, it paints 1.05% of the island, and the island's dark
 * anchor is its SECOND PERCENTILE: a band covering one percent of the picture is one the anchor
 * cannot see by construction. The arm renders, moves visible pixels, and moves the anchor the WRONG
 * WAY — up 34 luma — because the lit rock it puts on everything else is lighter than the single
 * median rock it replaced.
 *
 * The lesson generalises past this cliff: SELECTING BY LIGHTING SELECTS BY FORESHORTENING TOO,
 * whenever the light and the camera sit near one another.
 */
export const shadeBelowLadderFloor: SkirtShadeRule = (ledge, outward, depth) =>
  ledgeBelowLadderFloor(ledgeNormal(outward, ledge.step, depth * ledge.fall));

/**
 * THE RULE THAT SHIPS — the cliff's own LOWER HALF wears the shaded rock.
 *
 * ⚠⚠ IT KEYS ON THE ONE VARIABLE THE LADDER IS BLIND TO, which is what makes it a token's job
 * rather than a rung's. Every rung on this map is a function of a surface NORMAL and of nothing
 * else, so no ladder however refined can express *how deep this face sits*. The ground already has
 * an answer for "less sky reaches here" — the occlusion atlas — and it is packed over the islands'
 * GROUND, so it stops exactly at the rim and never reaches the cliff. A rock that darkens with
 * depth is that missing term, at the one surface the atlas leaves out.
 *
 * ⚠ AND IT IS THE SPLIT THE PICTURE ALREADY MADE, not a tuned threshold. The two tokens are the
 * approved skirt mask's own two halves, split at its median; this splits the cliff at its own
 * half-depth. One move, applied once to the colours and once to the geometry — and the alternative
 * (choosing which courses look best) is exactly the authored-threshold this arc's fences forbid.
 *
 * ⚠ WHAT IT BUYS, MEASURED. The visible cliff is three courses and not six: the three UNDERCUT
 * courses are back-facing to this camera and contribute 15.4, 0.0 and 0.0 projected units against
 * the proud courses' 200.7, 267.0 and 333.3. Shading the lower half puts the shaded rock on courses
 * 4 and 6 — 600.3 of the cliff's 816.4 visible units, 73.5% — so the anchor can see it, which
 * {@link shadeBelowLadderFloor} could not manage at 19%.
 */
export const shadeBelowHalfDepth: SkirtShadeRule = (ledge) => ledge.drop > 0.5;

/**
 * THE EDGE'S OUTWARD UNIT NORMAL, in the module's one orientation convention.
 *
 * ⚠ `(-dz, dx)` IS OUTWARD ONLY FOR A NEGATIVELY-WOUND RING, which is the orientation
 * `normalisedRing` puts every parcel into and `cell-ground-geometry.ts` states its whole wall
 * convention against. Handed a positively-wound ring this points INTO the parcel and every ledge
 * would step the wrong way — so callers pass normalised rings, exactly as the wall loop does.
 *
 * A degenerate edge (both endpoints equal) has no direction, and the honest answer is the zero
 * vector: a zero-length edge bounds no wall, so the ledge it would inset is a quad of no area.
 */
export function outwardNormal(a: P2, b: P2): P2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return { x: 0, z: 0 };
  return { x: -dz / len, z: dx / len };
}

/** A ring point moved onto a ledge: `p - inset * outward`, so a POSITIVE inset cuts inward. */
export function insetPoint(p: P2, outward: P2, inset: number): P2 {
  return { x: p.x - inset * outward.x, z: p.z - inset * outward.z };
}

/**
 * THE ISLAND'S RIM EDGES, as the keys {@link isRimEdge} tests against.
 *
 * A parcel set tiles its island with no gaps and no overlaps, so an edge used TWICE is an interior
 * seam and an edge used ONCE is the shore — the same census `coast-clip.ts`'s {@link rimLoops}
 * takes, and it reads the same {@link edgeKey} so the two can never disagree about which edges are
 * the shore. Measured on the shipped fixture: 354 edges, 302 interior, 52 boundary.
 *
 * ⚠⚠ THE SKIRT IS RIM-ONLY, AND THAT IS A CORRECTNESS REQUIREMENT RATHER THAN AN OPTIMISATION.
 * Every parcel emits a wall on EVERY edge, and all but the rim are buried inside the island. Cutting
 * a buried seam into six inset ledges would pull two neighbouring parcels apart along the seam they
 * share — a crack running through the island's interior, visible the moment the camera is not
 * directly overhead — while buying nothing, because nothing can see it. It is also what makes the
 * cost the ~624 triangles the arc sized this component at rather than six times the whole ground.
 */
export function rimEdgeKeys(cells: readonly InstanceDescriptor[]): ReadonlySet<string> {
  const uses = new Map<string, number>();
  for (const cell of cells) {
    const pts = cell.points;
    if (pts === undefined || pts.length < 3) continue;
    for (const [i, a] of pts.entries()) {
      const k = edgeKey(a, pts[(i + 1) % pts.length]!);
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  const rim = new Set<string>();
  for (const [k, n] of uses) if (n === 1) rim.add(k);
  return rim;
}

/** Is this undirected edge on the island's rim? A thin wrapper so callers never re-spell
 *  {@link edgeKey}, which is the one place the rounding convention lives. */
export function isRimEdge(rim: ReadonlySet<string>, a: CoastPoint, b: CoastPoint): boolean {
  return rim.has(edgeKey(a, b));
}

/** How many of ONE ring's edges are on the rim — what the buffer must be sized for before a
 *  single triangle is written. Kept here beside {@link skirtExtraTriangles} rather than inlined in
 *  the builder, so the count that SIZES the buffer and the predicate that FILLS it are the same
 *  question asked once: a builder that sized off one rule and wrote off another would overrun or
 *  leave a tail of zeroed vertices, which draws as a black triangle at the origin. */
export function rimEdgeCount(ring: readonly P2[], isRim: (a: P2, b: P2) => boolean): number {
  if (ring.length < 3) return 0;
  return ring.filter((a, i) => isRim(a, ring[(i + 1) % ring.length]!)).length;
}

/**
 * THE EXTRA TRIANGLES A SKIRT COSTS, over the single-quad wall the map already draws.
 *
 * ⚠ IT IS THE RIM'S COST ALONE and it is stated as a DELTA rather than a total, so it composes
 * with `cellGroundTriangles` instead of replacing it — which is what keeps this component's
 * arithmetic out of the shared count every other component's buffer is sized by.
 */
export function skirtExtraTriangles(rimEdges: number, rows: number): number {
  // ⚠ THE ZERO CASES ARE ARITHMETIC, NOT BRANCHES, and that is a correction rather than a
  // flourish. This read `if (rimEdges <= 0 || rows <= 1) return 0;` and every mutation of that line
  // SURVIVED — `<=` to `<`, and the whole condition to `false` — because at the boundary the
  // arithmetic already returns 0: one row means `rows - 1` is 0, and no rim edges means the product
  // is 0. A guard whose every mutant is equivalent is a guard that tests nothing, and it hid the one
  // case that IS a real decision: a NEGATIVE count, which the product would happily turn into a
  // negative triangle budget and under-size the buffer a caller then writes into.
  return Math.max(0, rimEdges) * Math.max(0, rows - 1) * 2;
}

/**
 * WHAT A GROUND BUILDER NEEDS TO CUT THE SKIRT — the whole component as one optional input, so a
 * caller that supplies none gets the buffer it always got.
 */
export interface SkirtRock {
  /** The ramp ROW this rock wears — an index into the material's authored token table, exactly as
   *  a parcel's own status row is. */
  row: number;
  /** Its LINEAR colour. Carried beside {@link SkirtRock.row} for the same reason
   *  `cellGroundGeometry` takes both a `resolve` and an `index`: the banded material selects by
   *  row, and the comparison instrument's pre-adoption arms read the colour buffer. */
  colour: LinearRgb;
}

export interface GroundSkirt {
  /** Ledges per rim edge. {@link SKIRT_ROWS} is the approved treatment's six; 1 is the map as it
   *  drew before this component and is emitted by the same code path. */
  rows: number;
  /** The rock a ledge wears when the ladder can still express its lighting. */
  lit: SkirtRock;
  /**
   * The rock a ledge wears when its face falls BELOW the ladder's darkest rung
   * ({@link ledgeBelowLadderFloor}) — the faces the quantiser has saturated.
   *
   * ⚠⚠ A ONE-TOKEN CLIFF IS THE SPECIAL CASE WHERE THIS EQUALS {@link GroundSkirt.lit}, NOT A
   * SEPARATE MODE, and that is deliberate. There is no boolean, no `twoToken` flag and no second
   * branch in the wall loop: {@link oneRock} builds the degenerate pair, the loop always picks one
   * of the two, and the map as it drew before this landing is emitted by exactly the same code
   * path — the same argument `rows: 1` already makes about the flat wall. A flag would put the two
   * cliffs on two paths and make "the control arm is the shipped map" a claim rather than a fact.
   */
  shaded: SkirtRock;
  /** WHICH of the two a ledge wears. Injected like {@link GroundSkirt.isRim}, so a comparison page
   *  can put two rules beside each other and the shipped map can name the one it chose. */
  isShaded: SkirtShadeRule;
  /** How many ledges from the TOP keep the parcel's own status tint instead of the rock.
   *
   *  ⚠ THIS IS THE OWNER'S OPTION B, KEPT AS A NUMBER RATHER THAN A BOOLEAN. His settled answer
   *  did not pick between "all six ledges are rock" and "the top ledge keeps the health tint"; it
   *  handed the session the outcome test instead. So both are arms on the comparison page and the
   *  shipped value is chosen against the picture — see `SHIPPED_SKIRT` in `ForestWorldCanvas.tsx`. */
  soilLedges: number;
  /** Is this edge on the island's rim? Injected rather than computed here so the builder does the
   *  census ONCE per call instead of once per parcel. */
  isRim: (a: P2, b: P2) => boolean;
}

/** THE UNCUT WALL — one ledge, no inset, the full drop. Every buried seam takes this, and so does
 *  every edge when no skirt was asked for at all, so it is the profile the shipped map has always
 *  drawn. Frozen at module scope because the wall loop reaches for it once per edge. */
export const FLAT_WALL: readonly SkirtLedge[] = skirtLedges(1);

/** The direction an UNCUT edge is inset along. It has none, and zero is the honest spelling: an
 *  inset of 0 along it is `p - 0 * 0`, so the emitted vertex is the ring's own coordinate to the
 *  bit rather than to within a rounding — which is what lets the no-skirt buffer be byte-identical
 *  to the one every pre-skirt figure was measured on. */
export const ZERO_NORMAL: P2 = { x: 0, z: 0 };

/**
 * THE ABSENT SKIRT, AS A VALUE — what {@link cellGroundGeometry} uses when the caller supplies none.
 *
 * ⚠⚠ IT EXISTS SO THE WALL LOOP HAS NO NULL CHECK AT ALL, and that is a mutation finding rather
 * than a style preference. The loop used to ask `skirt !== undefined` a second time, INSIDE a branch
 * that already implied it — a check that could never fire, so mutating it to `true` changed nothing
 * and survived. Spelling the absence as a skirt whose `isRim` is always false makes the same fact
 * true by construction: no edge is rim, so no ledge is rock, so the rock's colour is never read.
 *
 * ⚠ ITS COLOURS ARE UNREACHABLE AND THAT IS ASSERTED RATHER THAN ASSUMED — `stepped-skirt.test.ts`
 * drives {@link NO_SKIRT.isRim} directly, so "never read" is a claim a test makes rather than one a
 * reader has to trace. Both entries of the pair are held to it, not just the lit one.
 */
export const NO_SKIRT: GroundSkirt = {
  rows: 1,
  ...oneRock({ row: 0, colour: { r: 0, g: 0, b: 0 } }),
  soilLedges: 1,
  isRim: () => false,
};

/** ONE ROCK ON BOTH SIDES OF THE PAIR — the single-token cliff, as a value.
 *
 *  ⚠ IT IS THE DEGENERATE {@link GroundSkirt} RATHER THAN A MODE, which is what lets the map as it
 *  drew before this landing stay a valid control arm: a caller that hands the same rock twice gets
 *  the same buffer it always got, through the same loop, because the selection still runs and both
 *  answers are the same. Named rather than spelled `{ lit: r, shaded: r }` at each call site so
 *  "the one-token cliff" has one definition and reads as a choice rather than as a duplication. */
export function oneRock(rock: SkirtRock): Pick<GroundSkirt, 'lit' | 'shaded' | 'isShaded'> {
  return { lit: rock, shaded: rock, isShaded: shadeNever };
}

/** A skirt that changes nothing: one ledge, no inset, the parcel's own tint. Named rather than
 *  spelled inline wherever a control arm is built, so "the flat wall" has one definition. */
export function flatSkirt(skirt: Omit<GroundSkirt, 'rows' | 'soilLedges'>): GroundSkirt {
  return { ...skirt, rows: 1, soilLedges: 1 };
}
