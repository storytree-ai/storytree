// land-blight.ts — THE UNHEALTHY GROUND, PAINTED FOR THE READ: the approved stack's layer-1
// structure re-palettised onto the charred `unhealthy` token and BURNED toward black, plus one
// layer the approved recipe does not contain at all — a network of pale CRACKS that no other
// island on this map shows (`paint-the-unhealthy-ground-for-the-read-not-the-richness`).
//
// ⚠⚠ THE SAME TECHNIQUE AS THE WHEAT, TUNED THE OPPOSITE WAY, AND THAT INVERSION IS THE WHOLE
// POINT OF THE ROW. `unhealthy` is not a resting state: it is the rollup of a FAILED proof, it
// appears suddenly, it is rare, and it is the one state a viewer most needs to catch at a glance.
// On the green islands and on the wheat, richness and legibility point the same way; here they
// pull apart, and a subtle, beautiful unhealthy island that takes a second to identify is a WORSE
// outcome than a stark one. So the standing "be adventurous" direction (ADR-0503 D1) is not
// inverted here — it is AIMED: bold about STRUCTURE (dead ground, cracked plates, an obviously
// different surface), conservative about anything that makes the island harder to pick out of a
// forest of green ones.
//
// ⚠⚠ WHY THE SECOND SIGNAL CHANNEL HAS TO DO THE WORK, measured rather than assumed. The
// `unhealthy` token is `#57544a` = rgb(87, 84, 74). On the REAL map (2026-09-08,
// `docs/research/chapter2-real-forest-2026-09-08/`) a HEALTHY island delivers rgb(87, 97, 74),
// because the slope-gated rock layer greys a small island across its whole surface. Those two
// colours differ by THIRTEEN units on one channel and by nothing at all on the other two: an
// unhealthy island drawn as a flat token would be, on the map as it draws today, very nearly the
// same colour as the healthy islands around it. Hue alone therefore cannot carry this token, and
// the separation has to come from PATTERN — which is ADR-0492's own "second signal channel (texture
// presence) alongside hue", itself a reading of ADR-0414 D1's general "everything on the map is
// signal for something", and which this row is the strongest case for. ⚠ The clause is ADR-0492's
// and NOT ADR-0414's; ADR-0551 D1 carries a dated in-place correction of exactly this attribution,
// which the librarian pass caught on the landing.
//
// ⚠⚠ THE LAYER SET IS CHOSEN, NOT COPIED, AND A DROPPED LAYER IS A FINDING. The green wears six.
// The unhealthy ground wears the base paint, the cracks, the detail normal and the grain — and
// DROPS the shore sand (layer 2), the worn path (layer 3) and the slope rock (layer 4). Each
// exclusion is an argument about the read:
//   layer 2, the shore sand   — a bright warm band around the rim is the single largest bright
//                               region on a small island, and it is exactly the region a fitted
//                               forest resolves first. A dying island has a dead shore.
//   layer 3, the worn path    — a path is a trace of USE. Nothing walks a failed capability, and a
//                               lush worn trail is the increment's own example of a layer that
//                               works against the read.
//   layer 4, the slope rock   — the layer measured on 2026-09-08 to desaturate a real-map island
//                               past its own status. Wearing it would push the unhealthy ground
//                               toward the same grey the healthy islands already deliver, which is
//                               the one direction this token cannot afford to move.
// The mechanism is the material's, not this module's: layers 2, 3 and 4 all ride `grassGate`, and
// the blight gate is NOT promoted into it the way the wheat's is. Dropping them is therefore the
// ABSENCE of a promotion rather than a subtraction — and nothing about the green or wheat islands
// changes, which `banded-ground-material.blight.test.ts` asserts by byte-comparing the emitted
// shader of an unblighted material.
//
// ⚠⚠ IT ENTERS AS A MIX INTO THE STATUS COLOUR, NEVER AS A REPLACEMENT (ADR-0490 D5), through the
// one seam every colour layer uses — `banded-ground-material.ts`'s paint line, where the blight is
// selected by its own per-token gate exactly as the grass and the wheat are by theirs.
//
// ⚠ ZERO INVENTED COLOURS. Every colour below is the authored `unhealthy` token scaled in LINEAR
// space, ratio-preserving: the base ramps are the grass's stops rebased onto the token and then
// multiplied down by `burn`, and the crack colour is the same token multiplied UP by
// {@link BLIGHT_CRACK_LIFT}. So the module authors no hue at all — it authors how far the ground
// has died and how hard the cracks read, which is what the owner scales along.
//
// ⚠ THE RE-PALETTISING ALGEBRA IS THE WHEAT'S, IMPORTED RATHER THAN COPIED. `rebaseStop`,
// `liftStop` and `hexToLinear` were first authored in `land-wheat.ts` for the in-progress yellow;
// they are palette algebra rather than anything wheaten, and a second spelling of them here would
// be two derivations of one arc's technique that could drift apart.

import {
  GRASS_COOL,
  GRASS_DRIFT_RAMP,
  GRASS_WARM,
  clamp01,
  grassDrift,
  grassScalar,
  grassNoiseField,
  noiseGlsl,
  rampGlsl,
  rampLinear,
  type CyclesNoise,
  type LinearRgb,
  type RampStop,
} from './land-grass.js';
import { hexToLinear, liftStop, rebaseStop, GRASS_TOKEN_REFERENCE } from './land-wheat.js';
import { linearToSrgb255 } from './land-grain.js';
import type { Rgb255 } from './shade-ladder.js';

/**
 * WHICH GROUND STATUSES WEAR THE BLIGHT — the third arm of ADR-0492 D1's per-token gate, and the
 * ONE spelling of it. The canvas turns these names into ramp ROWS and the shader tests `vStatus`
 * against them.
 *
 * ⚠ ONE STATUS, AND NO NEIGHBOUR FOLDS INTO IT. Unlike `building`/`proposed` (one authored token
 * across two keys, ADR-0462), `unhealthy` stands alone: nothing else in `GROUND_COLOUR` carries
 * `#57544a`, so a single key names the whole token.
 *
 * ⚠ DISJOINT FROM BOTH OTHER PAINT GATES BY CONSTRUCTION, and the material REFUSES a row named by
 * more than one: a row in two gates would be painted twice through one seam.
 */
export const BLIGHT_STATUS_GATE: readonly string[] = ['unhealthy'];

/**
 * THE TOKEN THE BLIGHT'S RAMPS ARE STATED AGAINST — the shipped `unhealthy` ground token, the
 * charred near-black ADR-0470's vocabulary settled.
 *
 * ⚠ A LITERAL HERE, AND PINNED AGAINST THE SHIPPED PALETTE by
 * `harness/shipped-blight-scene.test.ts` (this module is `src/` and may not import the harness's
 * transcription), exactly as {@link GRASS_TOKEN_REFERENCE} is. Every colour in this module is this
 * value scaled; if the vocabulary ever moves the token, the whole treatment moves with it and
 * nothing here has to be re-authored.
 */
export const BLIGHT_TOKEN = '#57544a';

/**
 * HOW HARD THE CRACKS READ — the token multiplied UP in linear space, ratio-preserving, so the
 * cracks are the same colour family as the ground they split and no hue is invented.
 *
 * ⚠ THE ONE AUTHORED NUMBER IN THE PALETTE, and it is stated as a ratio rather than as a hex so
 * that it cannot silently become a colour of its own. At 4.0 the token's linear
 * (0.0930, 0.0876, 0.0684) delivers `rgb(166, 162, 145)` — a pale bone, plainly lighter than every
 * ground colour on the map and plainly not white. {@link blightCrackColour} derives it, and the
 * evidence sheet prints what it delivered rather than quoting this line.
 *
 * ⚠ ACHROMATIC BY CONSTRUCTION, AND THAT IS THE POINT rather than a limitation. Every other island
 * on this map separates by HUE — olive, gold, clay, slate. There is no warm direction left free:
 * `mapped` owns the clay and the in-progress token owns the gold. So the unhealthy island is given
 * the one channel nothing else uses: high INTERNAL contrast between a near-black ground and a pale
 * bone line network, at a scale a fitted forest can still resolve as texture.
 */
export const BLIGHT_CRACK_LIFT = 4;

/**
 * THE CRACK NETWORK'S TWO LATTICES — the coarse plates and the finer splits that break them.
 *
 * ⚠⚠ THESE ARE AUTHORED, NOT TRANSCRIBED, AND THE FILE SAYS SO PLAINLY. `build_land.py` has no
 * cracked-earth layer — it is a recipe for a HEALTHY island, and the increment asks for exactly
 * the structure a green island never shows. So there is no `mat_attribute()` anchor to cite here
 * and no decoy to avoid: what is reused is the octave MACHINERY (`land-grass.ts`'s `CyclesNoise`
 * ladder, the same lattice hash, the same amplitude normalisation), which is what keeps this field
 * and the shader that evaluates it one field rather than two.
 *
 * ⚠ THE LATTICES ARE ISLAND-RELATIVE like every other field in the stack: `grassLattice` divides
 * {@link SHIPPED_ISLAND_SPAN} by the scale, so the plates keep their size relative to an island as
 * ADR-0520 sizes islands by capability count. A crack network authored in absolute ground units
 * would be the same fault the rock layer has.
 */
export const BLIGHT_CRACK_COARSE: CyclesNoise = { scale: 4.5, detail: 3, roughness: 0.5 };
export const BLIGHT_CRACK_FINE: CyclesNoise = { scale: 11, detail: 3, roughness: 0.5 };

/**
 * HALF THE CRACK LINE'S WIDTH, in field units either side of the contour it traces.
 *
 * ⚠ THE CRACKS ARE AN ISO-CONTOUR, which is why they form a connected network of closed plates
 * rather than a scatter of blobs — the level set of a continuous field is a set of curves, and
 * that topology is what mud actually cracks into. `blightCrackBand` is `1 - smoothstep(0, W, |n -
 * 0.5|)`: full crack exactly on the median contour, none beyond W. Two lattices unioned give big
 * plates split by finer ones.
 */
export const BLIGHT_CRACK_WIDTH = 0.045;

/**
 * THE BLIGHT'S PALETTE — the two numbers that decide how dead the ground reads: how far the base
 * is BURNED toward black, and how much of the crack colour reaches the delivered pixel.
 *
 * One object rather than two loose arguments, for the reason `WheatPalette` gives: a caller that
 * could hand a function the burn and forget the cracks would render a "shipped" arm that is not
 * the shipped treatment, which is the control-that-is-not-a-control shape this arc has shipped
 * before.
 */
export interface BlightPalette {
  /** How far the rebased stops are multiplied DOWN in linear space, ratio-preserving: `0` is the
   *  grass's own ramp re-expressed on the charred token, `0.8` is four-fifths burned away. Never
   *  1 — a fully burned ground is black, and black is the sea. */
  burn: number;
  /** How much of the crack colour enters the delivered pixel where the network is at full
   *  strength. `0` draws the base alone, which is the arm that isolates the crack layer. */
  crackMix: number;
}

/** One rung of the starkness ladder: a palette and what it is. */
export interface BlightRung {
  id: string;
  palette: BlightPalette;
  /** What the rung is, for a caption. */
  what: string;
}

/**
 * THE LADDER — HOW FAR THE GROUND HAS DIED, four rungs from a sick ground to a scorched one.
 *
 * ⚠ A COMPOUND RUNG, DELIBERATELY, AND THE SHEET PRINTS BOTH NUMBERS. The diagnostic rule of "one
 * thing moves per step" belongs to ATTRIBUTION — separating which of several causes produced a
 * result — and it is honoured elsewhere on this page by the `flat` control (what the map draws
 * today) and the `nocracks` arm (the shipped burn with the crack layer switched off), which
 * between them attribute the treatment to its two halves. What the OWNER picks between is not a
 * burn or a crack strength but a single question — how dead does an unhealthy island look — and a
 * ladder that made him compose two numbers would be a worse instrument for that, not a stricter
 * one (ADR-0503 D3: one image, one pick, scale-back is one edit).
 *
 * ⚠ THE RUNGS RISE TOGETHER because they are the same signal: burning the base and strengthening
 * the cracks both widen the island's internal contrast, which is the channel this token is being
 * given. A rung that burned hard and cracked faintly would be a dark blob, which is the outcome
 * the sea-separation report below exists to catch.
 *
 * ⚠ THE PICK IS NOT HERE. `SHIPPED_BLIGHT_RUNG` in `ForestWorldCanvas.tsx` names the rung that
 * ships and the sheet it was chosen from; this list is the ladder the owner scales along.
 */
export const BLIGHT_RUNGS: readonly BlightRung[] = [
  { id: 'sick', palette: { burn: 0.2, crackMix: 0.3 }, what: 'sick — the ground is going, the cracks are hairline' },
  { id: 'dying', palette: { burn: 0.45, crackMix: 0.55 }, what: 'dying — the plates are visible and the ground is well down' },
  { id: 'dead', palette: { burn: 0.65, crackMix: 0.75 }, what: 'dead — a dark ground split by a plain bone-pale network' },
  { id: 'scorched', palette: { burn: 0.8, crackMix: 0.9 }, what: 'scorched — the boldest rung, a near-black scar under bright cracks' },
];

/** One rung by id — refused rather than `undefined`, so a typo in a caption cannot render an arm
 *  that quietly wears no rung. */
export function blightRung(id: string): BlightRung {
  const found = BLIGHT_RUNGS.find((r) => r.id === id);
  if (found === undefined) throw new Error(`land-blight: no blight rung "${id}"`);
  return found;
}

/** The BURN as the multiplier it is: `1 - burn`, the factor every rebased stop is scaled by. A
 *  named function rather than an inline expression, so the mutation rung can attribute a mutant in
 *  the arithmetic to the test that kills it. */
export function burnScale(burn: number): number {
  return 1 - burn;
}

/** A whole ramp rebased onto the charred token and then burned — rebase FIRST, so the burn scales
 *  the derived colour, exactly as the wheat lifts a rebased stop. */
export function blightRamp(stops: readonly RampStop[], palette: BlightPalette): RampStop[] {
  const anchor = hexToLinear(BLIGHT_TOKEN);
  const reference = hexToLinear(GRASS_TOKEN_REFERENCE);
  const scale = burnScale(palette.burn);
  return stops.map((stop) => liftStop(rebaseStop(stop, anchor, reference), scale));
}

/** THE BLIGHT'S COOL RAMP — the grass's cool ramp rebased onto the charred token and burned. */
export function blightCool(palette: BlightPalette): RampStop[] {
  return blightRamp(GRASS_COOL, palette);
}

/** THE BLIGHT'S WARM RAMP — the grass's warm ramp rebased onto the charred token and burned. */
export function blightWarm(palette: BlightPalette): RampStop[] {
  return blightRamp(GRASS_WARM, palette);
}

/** THE CRACK COLOUR in LINEAR space — the token lifted by {@link BLIGHT_CRACK_LIFT}, clamped per
 *  channel at linear white, which is the same ratio-preserving lift the wheat's paleness ladder
 *  applies to a stop. */
export function blightCrackLinear(): LinearRgb {
  const token = hexToLinear(BLIGHT_TOKEN);
  return [
    clamp01(token[0] * BLIGHT_CRACK_LIFT),
    clamp01(token[1] * BLIGHT_CRACK_LIFT),
    clamp01(token[2] * BLIGHT_CRACK_LIFT),
  ];
}

/** {@link blightCrackLinear} as a delivered sRGB pixel — what the sheet prints. */
export function blightCrackColour(): Rgb255 {
  const [r, g, b] = blightCrackLinear();
  return { r: linearToSrgb255(r), g: linearToSrgb255(g), b: linearToSrgb255(b) };
}

/** ONE LATTICE'S CRACK BAND at a field value: full on the median contour, zero beyond
 *  {@link BLIGHT_CRACK_WIDTH}. Smoothstep so the line has an edge the grain can break rather than
 *  a hard aliasing boundary. */
export function blightCrackBand(field: number): number {
  // ⚠ NO EARLY RETURN FOR `d >= 1`, AND ITS ABSENCE IS DELIBERATE. One was written here and the
  // mutation rung showed BOTH of its mutants equivalent: `clamp01` already pins `t` at 1 past the
  // width, and the smoothstep polynomial is exactly 0 at t = 1 (1 - 1 x (3 - 2)). A branch whose
  // two arms provably agree is not a guard — it is a line no test can discriminate.
  const t = clamp01(Math.abs(field - 0.5) / BLIGHT_CRACK_WIDTH);
  return 1 - t * t * (3 - 2 * t);
}

/** THE CRACK NETWORK at a ground point — the two lattices' bands unioned, so the coarse plates
 *  are split by the finer ones rather than averaged with them. */
export function blightCrackAt(x: number, z: number): number {
  const coarse = blightCrackBand(grassNoiseField(BLIGHT_CRACK_COARSE, x, z));
  const fine = blightCrackBand(grassNoiseField(BLIGHT_CRACK_FINE, x, z));
  return Math.max(coarse, fine);
}

/**
 * THE BLIGHT COLOUR from its scalars, in LINEAR space — the burned base from the cool/warm ramps,
 * then the crack colour mixed over it by the network times the palette's crack strength.
 *
 * ⚠ IT TAKES THE SCALARS RATHER THAN A GROUND COORDINATE, for the reason `grassLinearOf` gives:
 * the layer's reachable colour set is a property of the scalars' range, and the reader instrument
 * enumerates it rather than sampling an island.
 */
export function blightLinearOf(palette: BlightPalette, t: number, d: number, crack: number): LinearRgb {
  const cool = rampLinear(blightCool(palette), t);
  const warm = rampLinear(blightWarm(palette), t);
  const bone = blightCrackLinear();
  const f = crack * palette.crackMix;
  return [
    mixLinear(cool[0] + (warm[0] - cool[0]) * d, bone[0], f),
    mixLinear(cool[1] + (warm[1] - cool[1]) * d, bone[1], f),
    mixLinear(cool[2] + (warm[2] - cool[2]) * d, bone[2], f),
  ];
}

/** `a + (b - a) * f`. A named function for the attribution reason `cyclesMixFloat` gives. */
export function mixLinear(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** {@link blightLinearOf} as a delivered sRGB pixel — interpolated in linear, converted once. */
export function blightColourOf(palette: BlightPalette, t: number, d: number, crack: number): Rgb255 {
  const [r, g, b] = blightLinearOf(palette, t, d, crack);
  return { r: linearToSrgb255(r), g: linearToSrgb255(g), b: linearToSrgb255(b) };
}

/** THE BLIGHT COLOUR at a ground point — the GRASS's own base scalar and drift (the structure this
 *  layer shares with every painted token), this module's crack network, the blight's ramps. */
export function blightColourAt(palette: BlightPalette, x: number, z: number): Rgb255 {
  return blightColourOf(palette, grassScalar(x, z), grassDrift(x, z), blightCrackAt(x, z));
}

/**
 * HOW MANY LATTICE-NOISE OCTAVES THE CRACK NETWORK ADDS per fragment on a blighted row — the
 * number the frame-cost question is asked about, derived rather than counted by hand. The base
 * paint adds none of its own: it reads the scalar and drift the grass already evaluates.
 */
export const BLIGHT_OCTAVES = BLIGHT_CRACK_COARSE.detail + BLIGHT_CRACK_FINE.detail;

/**
 * GLSL source for the blight, with the burned stops and the crack colour written in from this
 * module.
 *
 * ⚠⚠ IT DEPENDS ON `st_grassScalar`, `st_grassDrift`, `st_grainOctave` AND `st_grassSrgb`, WHICH
 * `grassGlsl()` DECLARES, and the material refuses a `blight` option without a `grass` one for
 * that reason — the base paint is the grass's structure wearing another colour and has no field of
 * its own to stand on. What it DOES declare is the crack network, which is this layer's alone.
 *
 * ⚠ `st_paintColour` is the one seam's colour for ALL THREE painted layers: on any given row two
 * of the three terms are multiplied by zero, which is what lets the material composite one line
 * rather than three.
 */
export function blightGlsl(palette: BlightPalette): string {
  const [lo, hi] = GRASS_DRIFT_RAMP;
  const bone = blightCrackLinear();
  return [
    '// GENERATED from land-blight.ts — do not hand-edit these constants.',
    `// The unhealthy ground: layer 1's structure (build_land.py:836-868, mat_attribute())`,
    `// re-palettised onto the authored token ${BLIGHT_TOKEN} and burned by ${palette.burn.toFixed(2)}`,
    `// in linear space, split by a crack network this module authors (NOT in the recipe — the`,
    `// recipe paints a healthy island) at strength ${palette.crackMix.toFixed(2)}.`,
    ...noiseGlsl('st_blightCoarse', BLIGHT_CRACK_COARSE),
    '',
    ...noiseGlsl('st_blightFine', BLIGHT_CRACK_FINE),
    '',
    '// One lattice’s crack band: full on the field’s median contour, none beyond the width.',
    'float st_blightBand(float n) {',
    `  float d = clamp(abs(n - 0.5) / ${BLIGHT_CRACK_WIDTH.toFixed(6)}, 0.0, 1.0);`,
    '  return 1.0 - (d * d * (3.0 - 2.0 * d));',
    '}',
    '',
    '// THE CRACK NETWORK — two lattices’ contours unioned, so coarse plates are split by finer.',
    'float st_blightCracks(vec2 p) {',
    '  return max(st_blightBand(st_blightCoarse(p)), st_blightBand(st_blightFine(p)));',
    '}',
    '',
    ...rampGlsl('st_blightCool', blightCool(palette)),
    '',
    ...rampGlsl('st_blightWarm', blightWarm(palette)),
    '',
    '// THE BLIGHT COLOUR at a ground point, in LINEAR space: the burned base, split by the bone.',
    'vec3 st_blightLinear(vec2 p) {',
    '  float t = st_grassScalar(p);',
    `  float d = clamp((st_grassDrift(p) - ${lo.toFixed(6)}) / ${(hi - lo).toFixed(6)}, 0.0, 1.0);`,
    '  vec3 base = mix(st_blightCool(t), st_blightWarm(t), d);',
    `  float f = st_blightCracks(p) * ${palette.crackMix.toFixed(6)};`,
    `  return mix(base, vec3(${bone[0].toFixed(6)}, ${bone[1].toFixed(6)}, ${bone[2].toFixed(6)}), f);`,
    '}',
    '',
    '// The same colour as a delivered sRGB triple, through the grass’s own transfer function —',
    '// one spelling of the transfer in the shader, not a second copy under a blight name.',
    'vec3 st_blightColour(vec2 p) {',
    '  return st_grassSrgb(st_blightLinear(p));',
    '}',
  ].join('\n');
}
