// banded-ground-material.ts — THE SHIPPED GROUND'S MATERIAL: the authored shade ladder, on the
// GPU, over a merged multi-status buffer. Browser-bound (it imports three), so it is exported
// via the `./canvas` subpath alongside `ForestWorldCanvas` and NEVER from the pure root barrel
// — the provability firewall holds (`world-to-3d.ts` stays importable under bare `node:test`).
// Its thinking half is `shade-ladder.ts`, which is pure and node-provable; this file only
// carries that contract onto a GPU.
//
// ⚠⚠ WHY THIS IS A SECOND MATERIAL AND NOT `harness/banded-material.ts` MOVED. That one takes
// ONE authored token per material, because the experiment island builds a mesh per prop role and
// can afford a material each. The shipped ground is the opposite shape by construction: 164
// arbitrary polygons that cannot share a geometry, merged into ONE buffer so the island costs one
// draw call instead of 164 (`cell-ground-geometry.ts`). One buffer carrying many statuses cannot
// wear a one-token material. What the two DO share — the ladder, the light, the quantiser, the
// `token x level` arithmetic — is `shade-ladder.ts`, which both import and neither copies.
//
// ⚠⚠ THE GPU PERFORMS NO COLOUR ARITHMETIC, AND THAT IS THE WHOLE DESIGN. The obvious shader
// takes the parcel's colour as a vertex attribute and multiplies it by the rung's level. It is
// wrong here for a measured reason: the GPU's float-to-unorm8 conversion resolves an exact half
// DOWN where `Math.round` takes it UP, which delivered 929 px of `#c2ad5e` against the authored
// `#c2ad5f` the first time this package tried it (`bandLevelIndex`). THREE of this map's own
// products land on exactly that knife edge — `#d8c069`'s blue at level 0.9 (94.5) and
// `#9ca3af`'s at both 0.9 (157.5) and 0.78 (136.5), so TWO of `unknown`'s four rungs are on it
// — and multiplying on the GPU would ship the same defect on the state that means "no data".
// Instead the ramp is built ONCE in TypeScript by `deliveredForLevel`, uploaded as
// finished colours, and the fragment stage SELECTS one. "The delivered pixel is an authored
// entry" is then a bit-identity rather than an approximation.
//
// ⚠ THE FRAGMENT WRITES AUTHORED sRGB STRAIGHT THROUGH, and this is deliberate rather than an
// oversight about colour management. three appends no output transform to a `ShaderMaterial`'s
// `main()` — the `<colorspace_fragment>` chunk lives inside the BUILT-IN materials' sources — so
// what this shader writes is what the framebuffer holds. The ramp is therefore uploaded as the
// authored bytes over 255, with no `THREE.Color` in the path to linearise it. Everything ELSE on
// the canvas (crowns, the story tree's bole, the wisps) keeps three's ordinary colour-managed
// path; nothing here disables `ColorManagement`, because doing so would silently repaint them.
//
// ⚠ AND IT IS UNLIT — no `ambientLight`, no `directionalLight`, no scene light of any kind
// reaches it. The lambert term is computed here against `LIGHT_DIRECTION`, the authored world
// direction the whole land is shaded by, because the ladder's rungs are only meaningful against
// the light they were authored under. A scene light multiplying on top would push every fragment
// off the ladder — which is what a banded ground under `MeshStandardMaterial` would be, and the
// reason this is a material rather than a vertex-colour trick.

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RedFormat,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from 'three';

import {
  GRAIN_COLOUR_MIX,
  GRAIN_NORMAL_STRENGTH,
  grainGlsl,
  grainStops,
} from './land-grain.js';
import { grassGlsl } from './land-grass.js';
import { wheatGlsl } from './land-wheat.js';
import { blightGlsl, type BlightPalette } from './land-blight.js';
import { rockGlsl } from './land-rock.js';
import { sandGlsl } from './land-sand.js';
import { wearGlsl } from './land-wear.js';
import { type ShadowField } from './land-shadow.js';
import { atlasScale, type AtlasField } from './shadow-atlas.js';
import { LIGHT_DIRECTION, SHADE_LEVELS, bandGlsl, deliveredForLevel } from './shade-ladder.js';
import { shadowLadderFor, type ShadowDepthOptions, type ShadowLadder } from './shadow-rung.js';

/** The attribute a merged ground buffer carries its parcel's RAMP ROW in — the name the shader
 *  declares and the name `ForestWorldCanvas` attaches `CellGroundGeometry.statuses` under. It is
 *  a constant rather than two string literals because a mismatch between them is silent: the
 *  attribute simply never arrives, every fragment reads row 0, and the island paints itself one
 *  status while looking like it is working. */
export const GROUND_STATUS_ATTRIBUTE = 'statusIndex';

/** The attribute a merged ground buffer carries its island's ATLAS ORIGIN in, when the occlusion
 *  field is packed rather than allocated over the ground's rect. Same argument as
 *  {@link GROUND_STATUS_ATTRIBUTE}: a mismatch between the shader's spelling and the canvas's is
 *  silent — every island reads the atlas's top-left corner, and the map wears one island's
 *  shadow everywhere while looking like it is working. */
export const GROUND_ATLAS_ATTRIBUTE = 'atlasOrigin';

/**
 * WHICH HALF of the grain octave the shipped ground wears — and they are separate options rather
 * than one switch because THEY LAND ON OPPOSITE SIDES OF THIS MATERIAL'S WHOLE GUARANTEE.
 *
 *   - `normal` perturbs the lambert BEFORE the quantiser, so the fragment still writes a
 *     `uRamp[...]` entry and the palette closure is untouched. It is what ships.
 *   - `both` additionally mixes a noise-driven ramp INTO the delivered colour, which is the
 *     mechanism the approved Cycles render used and is OFF-PALETTE BY CONSTRUCTION.
 *
 * ⚠⚠ `both` IS NOT ADOPTABLE ON THIS SURFACE TODAY, AND THAT IS A MEASUREMENT RATHER THAN A
 * POLICY. `harness/grain-status-reading.ts` drove all six shipped ground tokens through the
 * colour half's mix arithmetically — exhaustively, since the mix is linear in the grain scalar —
 * and asked the house reader model whether every reachable colour still reports its own status.
 * At the authored fac of 0.13 it does not: the `proposed`/`building` yellow at the ladder's two
 * darkest rungs (0.78, 0.80) walks into `healthy`'s green, and the largest fac every reading
 * survives is 0.031. That is a fence-1 failure (ADR-0392 D5 / ADR-0398 D7) rather than an
 * aesthetic one. `both` exists here so the comparison the owner looks at can show what the
 * closure costs, and so the fork can be put to him against a picture.
 *
 * There is deliberately NO `colour`-only mode, which `harness/banded-material.ts` does have: the
 * experiment needed to isolate the two halves to cost them separately, and that costing is done
 * (`docs/research/chapter2-frame-cost-2026-08-28/`). A mode nothing on this surface would ever
 * ask for is a branch no test can motivate.
 */
export type GroundGrainMode = 'normal' | 'both';

/**
 * LAYER 1 OF THE APPROVED GROUND, as this material wears it: the grass base and its cool/warm
 * hue drift (`src/land-grass.ts`, transcribed from `build_land.py`'s `mat_attribute()`).
 *
 * ⚠⚠ IT IS OFF-PALETTE BY CONSTRUCTION, AND THAT IS WHAT ADR-0490 D5 AUTHORISES RATHER THAN AN
 * OVERSIGHT. The decision names this exact seam — "every layer here enters through the same seam
 * the grain already uses (`uGrainColourMix`) — as a mix INTO the selected status colour, not as
 * a replacement for it" — and a mix into the delivered colour is not a `uRamp` entry. So a
 * grassed material makes `grainKeepsPaletteClosed` report OPEN, correctly, and
 * `banded-ground-material.test.ts` asserts that rather than working around it.
 *
 * ⚠⚠ WHAT REPLACES THE CLOSURE IS A MEASUREMENT AND THEN A LOOK, NOT NOTHING. ADR-0489 D3/D4
 * moved the fence from composition to outcome: the ground may carry colours that report nothing,
 * and the test is whether a viewer can still tell what state an island is in.
 * `harness/grass-status-reading.ts` answers the arithmetic half exhaustively — which mix factors
 * leave every reachable colour reading as its own status — and the session adding the layer
 * applies the look to the picture. Neither half is optional.
 *
 * ⚠ ABSENT MEANS THE EMITTED SOURCE IS BYTE-IDENTICAL to the one this file produced before the
 * grass existed, which is the claim every measured figure about the banded ground rests on.
 */
export interface GroundGrassLayer {
  /** How much of the grass colour enters the delivered pixel — the `fac` of
   *  `mix(statusColour, grassColour, fac)`. There is no default on purpose: the admissible value
   *  is a measurement about the palette this material was handed, so a caller that has not made
   *  one has nothing to inherit. */
  mix: number;
  /**
   * WHICH RAMP ROWS WEAR THE LAYER — ADR-0492 D1's per-token gate, as this material spells it.
   * Row `i` here is the same row `i` {@link BandedGroundMaterialOptions.tokens} indexes, so the
   * caller that owns the token ordering owns this too rather than a second list agreeing with it.
   *
   * ⚠⚠ THE GATE IS WHAT MAKES THE LAYER ADMISSIBLE AT A VISIBLE STRENGTH, not a refinement of
   * it. The admissible mix factor is a per-TOKEN property: `healthy` admits 0.4065 while the
   * `building`/`proposed` yellow admits 0.0095, because at the ladder's darkest rungs a grassed
   * yellow walks into `healthy`'s green and an in-progress parcel reports as signed off. A
   * material handed every row has to hold the yellow's ceiling for all of them, which is forty
   * times smaller and provably invisible. Ungated, this layer cannot ship.
   *
   * ⚠ NO DEFAULT, AND EMPTY IS REFUSED — the same argument {@link mix} makes. "Every row" is not
   * a safe fallback here but the precise input the measurement forbids, and an empty list is a
   * layer that is switched on and gates everything out, which costs a full shader's fragment
   * work to deliver the pixels it delivered before.
   */
  rows: readonly number[];
}

/**
 * THE WHEAT FIELD — LAYER 1 RE-PALETTISED ONTO THE IN-PROGRESS YELLOW (`src/land-wheat.ts`,
 * `paint-every-land-type-arc-inc-01`): the grass's own structure, the wheat's colour, on the rows
 * this layer names.
 *
 * ⚠⚠ IT WIDENS ADR-0492 D1's GATE BY TOKEN, IT DOES NOT DELETE IT. The grass keeps its rows and
 * its factor; the wheat has its own rows and its own factor, and the two enter through ONE seam —
 * the paint line — as `mix(c, paint * level, uGrassMix * grassGate + uWheatMix * wheatGate)`,
 * where `paint` is the grass on a grass row and the wheat on a wheat row. A row named by BOTH
 * gates is REFUSED: it would be painted twice through one seam, which is neither layer.
 *
 * ⚠⚠ A MIX INTO THE STATUS COLOUR, NEVER A COVER (ADR-0490 D5). The 2026-08-27 cover path drew
 * `wheat` as a whole-island token in place of the status colour; this option modulates the
 * island's own yellow and leaves `1 - mix` of it in every fragment. It is the shape the owner
 * asked for on 2026-09-05 ("rather then have a whole separate base for it").
 *
 * ⚠ THE LAYERS ABOVE RIDE THE WHEAT TOO. After the paint line the material promotes the wheat's
 * gate into the grass gate (`grassGate = max(grassGate, wheatGate)`), so the sand, the path and
 * the rock — whose colours are the recipe's own neutrals and not green — composite over a wheat
 * island exactly as they do over a grass one. "Every land type is painted" means the stack, not
 * one layer of it.
 *
 * ⚠ IT REQUIRES {@link BandedGroundMaterialOptions.grass} and is refused without it: its ramps
 * ride `st_grassScalar` / `st_grassDrift` / `st_grassSrgb`, which only the grass source declares,
 * and it evaluates no octave of its own. ABSENT means the emitted source is byte-identical to
 * the one this file produced before the wheat existed.
 */
export interface GroundWheatLayer {
  /** How much of the wheat colour enters the delivered pixel on a wheat row — the wheat's OWN
   *  factor, separate from the grass's, so a scale-back on one never moves the other. Never 1.0
   *  (ADR-0490 D5's seam, kept literally). No default, for the grass's reason. */
  mix: number;
  /** WHICH RAMP ROWS WEAR THE WHEAT — `WHEAT_STATUS_GATE` resolved through the caller's own row
   *  ordering, like the grass's `rows`. Empty is refused; a row shared with the grass is refused. */
  rows: readonly number[];
  /** The anchor colour the wheat's ramps are rebased onto (`#rrggbb`) — one rung of
   *  `WHEAT_ANCHORS`, the ladder the owner scales along. Written into the source, like the ramp
   *  stops: a page comparing rungs compiles one shader per rung, which is the shape the stops
   *  already impose. */
  anchor: string;
  /** HOW PALE the field is — the stop-luma lift on the six rebased stops (`WheatPalette.lift`,
   *  one rung of `WHEAT_LIFTS`), orthogonal to the anchor: the anchor decides the hue, the lift
   *  the brightness. Written into the source with the stops it scales. `1` is the derivation as
   *  it stood on 2026-09-06 morning; below 1 would darken a field the recipe already darkens
   *  and is refused, as is a lift that is not a finite number. No default — a wheat handed
   *  without its lift is the shape a comparison page's control goes stale in. */
  lift: number;
}

/**
 * THE UNHEALTHY GROUND, PAINTED FOR THE READ (`src/land-blight.ts`,
 * `paint-the-unhealthy-ground-for-the-read-not-the-richness`): layer 1's structure re-palettised
 * onto the charred `unhealthy` token and burned toward black, split by a crack network the
 * approved recipe does not contain — because the recipe paints a HEALTHY island and the read this
 * token needs is the structure a green island never shows.
 *
 * ⚠⚠ IT WIDENS ADR-0492 D1's GATE BY A THIRD TOKEN, IT DOES NOT DELETE IT. The grass and the
 * wheat keep their rows and their factors; the blight has its own row and its own factor, and it
 * enters through the SAME paint seam as its own `mix` immediately after theirs. A row named by
 * this gate and either of the others is REFUSED: it would be painted twice through one seam,
 * which is neither layer.
 *
 * ⚠⚠ AND — UNLIKE THE WHEAT — ITS GATE IS NOT PROMOTED INTO `grassGate`. That single absence is
 * the whole of the increment's "the layers are chosen, not copied": layers 2, 3 and 4 (the shore
 * sand, the worn path, the slope rock) all ride `grassGate`, so a blighted row wears none of
 * them. Each exclusion is an argument about the read and `land-blight.ts` carries all three; the
 * shortest is layer 4's, which was measured on 2026-09-08 to desaturate a real-map island past
 * its own status, and which would therefore push the unhealthy ground toward exactly the grey the
 * healthy islands already deliver.
 *
 * ⚠ A MIX INTO THE STATUS COLOUR, NEVER A COVER (ADR-0490 D5): `mix(c, blight * level,
 * uBlightMix * blightGate)` with the factor below 1, so the island's own charred token stays in
 * every fragment.
 *
 * ⚠ IT REQUIRES {@link BandedGroundMaterialOptions.grass} and is refused without it: its base
 * rides `st_grassScalar` / `st_grassDrift` / `st_grassSrgb`, which only the grass source declares.
 * Its crack network is its own and is the only field it evaluates. ABSENT means the emitted
 * source is byte-identical to the one this file produced before the blight existed.
 */
export interface GroundBlightLayer {
  /** How much of the blight colour enters the delivered pixel on a blighted row — its OWN factor,
   *  so a scale-back here never moves the grass or the wheat. Never 1.0 (ADR-0490 D5's seam, kept
   *  literally). No default, for the grass's reason. */
  mix: number;
  /** WHICH RAMP ROWS WEAR THE BLIGHT — `BLIGHT_STATUS_GATE` resolved through the caller's own row
   *  ordering. Empty is refused; a row shared with the grass or the wheat is refused. */
  rows: readonly number[];
  /** HOW FAR THE GROUND HAS DIED — the burn and the crack strength of one `BLIGHT_RUNGS` rung,
   *  the ladder the owner scales along. Written into the source, like the ramp stops: a page
   *  comparing rungs compiles one shader per rung. A burn outside [0, 1) is refused (1 is black,
   *  and black is the sea); a crack strength outside [0, 1] is refused. */
  palette: BlightPalette;
}

/**
 * LAYER 2 OF THE APPROVED GROUND: the shore sand and the band that carries it
 * (`src/land-sand.ts`, transcribed from `build_land.py`'s `mat_attribute()`).
 *
 * ⚠⚠ IT DOES NOT ADD A SECOND MIX — IT CHANGES WHAT LAYER 1 MIXES IN, and that is the recipe's
 * own structure rather than a saving. In `mat_attribute()` the sand blend's OUTPUT is what the
 * grass output was, and everything downstream composites over it; the beach is not painted on top
 * of the grass, it is the ground being a different colour there. So the delivered pixel is still
 * `mix(statusColour, layerColour, uGrassMix)` — the same seam, at the same strength, through the
 * same ADR-0490 D5 fence — with `layerColour` now `mix(sand, grass, band)` instead of bare grass.
 *
 * ⚠⚠ AND IT THEREFORE INHERITS LAYER 1'S PER-TOKEN GATE, which is the honest answer to "does
 * layer 2 carry a truth cost?" rather than an assumption. Riding `uGrassMix * grassGate` means an
 * ungated row multiplies the whole layer by zero and delivers exactly the pixel it delivered
 * before — so no ungated token's reading can move, by construction. What is NOT free is the GATED
 * token: sand is a genuinely new colour family on the green, and whether green still reads as
 * green through it is a measurement (`harness/grass-status-reading.ts`), not an inference.
 *
 * ⚠ IT NEEDS THE PACKED ATLAS, not the rect occlusion form, and is refused without it. The shore
 * field is sampled through the SAME `shUv` the shadow uses — one tile corner on the mesh, one
 * scale on the material — so a second packing cannot disagree with the first about where an
 * island sits. Under the rect form there is no per-island tile to ride.
 */
export interface GroundSandLayer {
  /** The packed distance-to-coast field, over the OCCLUSION atlas's own tiles
   *  (`buildAtlasShore`). Single-channel bytes; the shader decodes to ground units. */
  shore: Texture;
  /**
   * How much of the sand colour enters the delivered pixel, INSIDE the band.
   *
   * ⚠⚠ ITS OWN FACTOR, SEPARATE FROM LAYER 1'S, AND THAT SEPARATION IS WHAT MAKES THE LAYER
   * ADMISSIBLE AT ALL. Under one shared factor the two layers have one joint ceiling — 0.235 —
   * which is BELOW layer 1's shipped 0.32, so adopting the sand that way would have quietly
   * dimmed the grass that already ships. Fenced on its own, the sand's ceiling with layer 1 held
   * at 0.32 is 0.16, and layer 1 is untouched. Same argument as ADR-0492's, one level down: do
   * not force one component's ceiling onto another's.
   */
  mix: number;
  /**
   * The beach's width in ground units, as the `BEACH + 0.9` divisor the recipe applies.
   *
   * ⚠ A UNIFORM RATHER THAN A WRITTEN-IN CONSTANT, so a page varying the width compiles ONE
   * shader and its arms differ in one number — which is what makes a difference between two arms
   * attributable to the width their captions name.
   *
   * ⚠⚠ IT MUST EQUAL THE WIDTH THE SHORE FIELD WAS BUILT FOR. The field caps its distances at its
   * own band, so a wider divisor here reads a field that has already flattened, and the beach
   * stops dead at the old width — a hard step that looks like a bug in the edge noise rather than
   * a mismatch between two numbers.
   */
  width: number;
}

/**
 * LAYER 3 OF THE APPROVED GROUND: the worn path and the distance field that carries it
 * (`src/land-wear.ts`, transcribed from `build_land.py`'s `mat_attribute()` for the colour and
 * `build_land_grid()` for the wear scalar).
 *
 * ⚠ THE SAND'S SHAPE, FOR THE SAND'S REASONS. It is its own seam with its own factor, because one
 * shared factor has one joint ceiling and the path's admissible strength is a measurement of its
 * own; it rides the packed atlas's `shUv`, because a second packing would be a second answer to
 * "where is this island"; and the texel is decoded to ground units through the same width the
 * field was built for, because `st_wearOf` is an arithmetic in ground units.
 *
 * ⚠⚠ WHAT IT DOES NOT DELIVER, named so the gap is known rather than quiet (`land-wear.ts`'s
 * header carries the detail): the recipe's geometry dip under the path (`z -= 0.30 * wear`,
 * `:496`) and the prop-exclusion mask (`:1046`). This is the COLOUR of a worn track; the mesh is
 * not lowered under it and nothing here keeps a tree off it.
 *
 * ⚠ IT NEEDS THE GRASS AND THE PACKED ATLAS, and is refused without either — the dirt ramp is
 * driven by layer 1's own base scalar and the break noise reuses the one lattice hash, and the
 * field has no per-island coordinate to ride under the rect occlusion form.
 */
export interface GroundWearLayer {
  /** The packed distance-to-path field, over the OCCLUSION atlas's own tiles. Single-channel
   *  bytes encoding `distance / width`; the shader decodes to ground units. */
  field: Texture;
  /** How much of the dirt colour enters the delivered pixel, ON the path. No default, for the
   *  reason the sand's has none: the admissible value is read off a rendered ladder (ADR-0503),
   *  and a caller that has not looked has nothing to inherit. */
  mix: number;
  /**
   * The path's falloff in ground units — the distance at which wear reaches 0 — AND the width
   * the field was encoded for. ONE number, on purpose: `st_wearOf` reaches zero at exactly the
   * distance the field caps at, so a widened path cannot read a field that has already
   * flattened, which would deliver a track that stops dead and steps. The recipe's own 3.0
   * (`WEAR_FALLOFF`) is the provenance rung; a uniform rather than a written-in constant so a
   * page comparing widths compiles ONE shader.
   */
  width: number;
}

/**
 * LAYER 4 OF THE APPROVED GROUND: rock on anything steep (`src/land-rock.ts`, transcribed from
 * `build_land.py:912-925`, `mat_attribute()`).
 *
 * ⚠ DRIVEN BY THE SURFACE'S OWN NORMAL, NOT BY A NOISE — the recipe's own comment. It samples
 * no field and adds no octave: the mask is a ramp on the normal's up-component the shader
 * already holds.
 *
 * ⚠⚠ THE RAMP ENDS ARE OPTIONS BECAUSE OF A MEASURED FACT. On the shipped mesh the interior's
 * up-component never drops below 0.91 (`interiorMinimumUp()`), so the recipe's 0.72 / 0.90 bite
 * only on the beach's ring chain, whose authored fall is the one steep place. Which ends the map
 * wears is therefore a ladder the owner reads (ADR-0503), and `ROCK_SLOPE_RAMP` is the provenance
 * those rungs are stated against — never a taste value baked in here.
 *
 * ⚠⚠ AND THE MASK READS THE GEOMETRIC NORMAL, WHICH IS THE RECIPE'S OWN AND NOT THE STAGE'S
 * CONVENIENT ONE. Until ADR-0553 it read the BUMPED normal — the one the detail map and the
 * grain have already tilted — which is why the fact above did not deliver: the interior was
 * flat enough, and the bump made it steep anyway. The shader captures `geoN` before either
 * bump touches it.
 *
 * ⚠ IT NEEDS THE GRASS, and is refused without it: the rock ramp is driven by layer 1's own base
 * scalar, which only the grass source declares.
 */
export interface GroundRockLayer {
  /** How much of the rock colour enters the delivered pixel where the mask is 1. No default —
   *  a rung of the rendered ladder, like every strength on this material. */
  mix: number;
  /** The slope ramp's two ends `[lo, hi]` on the normal's up-component: at or below `lo` full
   *  rock, at or above `hi` none. The ramp FALLS with the up-component. Uploaded as two uniforms
   *  so a page comparing rungs varies two numbers on ONE compiled shader. */
  slope: readonly [number, number];
}

/**
 * LAYER 6 OF THE APPROVED GROUND: the bought kit's cliff normal map as DETAIL RELIEF — "its
 * relief, not its colour" (`build_land.py:943-965`, `mat_attribute()`;
 * `src/detail-normal-texture.ts` owns the texture and the two recipe numbers).
 *
 * ⚠⚠ IT PERTURBS THE NORMAL BEFORE THE GRAIN'S BUMP, which is the recipe's own order
 * (NormalMap → Bump) and not merely a convenient place: the grain relieves an already-detailed
 * normal, so the two reliefs compose the way the approved render composed them.
 *
 * ⚠ IT TOUCHES NO COLOUR. Like the grain's normal half it moves the lambert before the
 * quantiser, so on an ungrassed material it can only move a fragment between authored rungs of
 * its own token's ramp — the palette closure is untouched by this layer.
 *
 * ⚠ IT NEEDS THE GRAIN, and is refused without it: it bends the normal the grain stage then
 * reads, and it samples the world position that stage is what carries through.
 */
export interface GroundDetailLayer {
  /** The tiling normal map, linear data (`detailNormalTexture()`). */
  map: Texture;
  /** How far the sampled tangent-space normal bends the surface normal. The recipe's 0.30
   *  (`DETAIL_STRENGTH_RECIPE`) is provenance; the shipped value is a rung of the rendered
   *  ladder. At 0.55 the recipe names the failure: the map's striation shows as whorls. */
  strength: number;
  /** Ground units one repeat of the map covers (`DETAIL_TILE_UNITS`, 2.4 — the plane's UV is
   *  `xy / 6` under a Mapping scale of 2.5, so NOT a 2.5-unit tile). Sampled at
   *  `vWorld.xz / tile`. */
  tile: number;
}

export interface BandedGroundMaterialOptions {
  /** The authored `#rrggbb` ground token for each ramp ROW, in row order. Row `i` is what a
   *  vertex carrying `statusIndex === i` wears. The caller owns the ordering and must use the
   *  same one for `cellGroundGeometry`'s `index` resolver — `ForestWorldCanvas` derives both
   *  from one `Map`, so there is one ordering rather than two that agree today. */
  tokens: readonly string[];
  /** WEAR the high-frequency grain octave. Absent means the generated shader source is
   *  byte-identical to the one this file emitted before the grain existed — the same claim
   *  `harness/banded-material.ts` makes about its own options, and
   *  `banded-ground-material.test.ts` asserts it rather than stating it. */
  grain?: GroundGrainMode;
  /** WEAR the approved ground's LAYER 1 — the grass base and its hue drift. See
   *  {@link GroundGrassLayer}; absent leaves the emitted source byte-identical.
   *
   *  ⚠ IT REQUIRES {@link grain}, and the material REFUSES the combination without it rather
   *  than emitting a shader that will not link. `grassGlsl()` calls `st_grainOctave`, which
   *  `grainGlsl()` declares — one lattice hash serving both layers, because two spellings of one
   *  field in one shader is a GLSL redefinition error at best and a silent divergence at worst.
   *  Every material this map builds is grained already, so the constraint costs a real caller
   *  nothing; what it buys is that the failure is a message rather than a black island. */
  grass?: GroundGrassLayer;
  /** WEAR the wheat field on the in-progress rows — layer 1 re-palettised. See
   *  {@link GroundWheatLayer}; absent leaves the emitted source byte-identical.
   *
   *  ⚠ IT REQUIRES {@link grass}, and is refused without it: it reads the grass's own scalar,
   *  drift and transfer, which only the grass source declares. */
  wheat?: GroundWheatLayer;
  /** WEAR the blight on the unhealthy rows — layer 1 re-palettised onto the charred token and
   *  split by a crack network. See {@link GroundBlightLayer}; absent leaves the emitted source
   *  byte-identical.
   *
   *  ⚠ IT REQUIRES {@link grass}, and is refused without it: its base reads the grass's own
   *  scalar, drift and transfer, which only the grass source declares. */
  blight?: GroundBlightLayer;
  /** WEAR the approved ground's LAYER 2 — the shore sand and its band. See
   *  {@link GroundSandLayer}; absent leaves the emitted source byte-identical.
   *
   *  ⚠ IT REQUIRES {@link grass} AND {@link shadowAtlas}, and the material refuses either
   *  combination rather than emitting a shader that will not link or one that samples a field
   *  through coordinates nothing computed. */
  sand?: GroundSandLayer;
  /** WEAR the approved ground's LAYER 3 — the worn path. See {@link GroundWearLayer}; absent
   *  leaves the emitted source byte-identical.
   *
   *  ⚠ IT REQUIRES {@link grass} AND {@link shadowAtlas}, for the sand's two reasons: its ramp
   *  and break noise call what only the grass source declares, and its field rides the packed
   *  atlas's own per-island coordinate. Refused rather than repaired either way. */
  wear?: GroundWearLayer;
  /** WEAR the approved ground's LAYER 4 — rock on slope. See {@link GroundRockLayer}; absent
   *  leaves the emitted source byte-identical.
   *
   *  ⚠ IT REQUIRES {@link grass}: the rock ramp is driven by layer 1's own base scalar. It needs
   *  no atlas — the mask is the normal, which every fragment already holds. */
  rock?: GroundRockLayer;
  /** WEAR the approved ground's LAYER 6 — the cliff normal map as detail relief. See
   *  {@link GroundDetailLayer}; absent leaves the emitted source byte-identical.
   *
   *  ⚠ IT REQUIRES {@link grain}: it perturbs the normal BEFORE the grain-normal stage (the
   *  recipe's NormalMap → Bump order) and samples the world position that stage carries
   *  through. Refused without it rather than emitting a stage that reads a varying nothing
   *  declared. */
  detail?: GroundDetailLayer;
  /** RECEIVE the ground-space occlusion field — the cast shadows and contact pools of whatever
   *  stands on this land, merged into one scalar. Absent means this material is not shadowed and
   *  its ramp stays the four authored rungs, so an unshadowed island delivers exactly the pixels
   *  it delivered before shadows existed. Built by {@link groundShadowTexture}, so the texture
   *  and the rect it is sampled through can never disagree about which ground the samples cover. */
  shadow?: GroundShadow;
  /** RECEIVE the occlusion field as a PACKED ATLAS instead — one texture holding every island's
   *  own field at the authored resolution, side by side, with the sea between them left out of
   *  the allocation.
   *
   *  ⚠ MUTUALLY EXCLUSIVE WITH {@link shadow}, and refused rather than resolved by precedence: the
   *  two forms disagree about how a fragment finds its sample, so a material handed both would
   *  shade correctly under whichever one the code happened to check first and the other option
   *  would sit there reading as though it were doing something.
   *
   *  ⚠ IT NEEDS THE MESH'S HELP, which {@link shadow} does not. The origin is a per-vertex
   *  attribute ({@link GROUND_ATLAS_ATTRIBUTE}), so a geometry built without
   *  `CellGroundGeometryInput.atlasOrigin` draws every island through the atlas's top-left tile.
   *  That is the one failure mode of this form that looks like art rather than like a bug. */
  shadowAtlas?: GroundShadowAtlas;
  /** HOW DEEP AND HOW SOFT the shadow is drawn (`shadow-rung.ts`'s `SHADOW_DEPTH` /
   *  `SHADOW_EDGE`): the deep tokens' full rung, and whether the field's penumbra reaches the
   *  picture through a halfway rung. Absent, every token wears the one derived rung with a hard
   *  edge — the material as it was until 2026-09-06. Ignored without an occlusion field. */
  shadowDepth?: ShadowDepthOptions;
  /** THE LIT LADDER this material quantises its lighting scalar onto. Absent means the authored
   *  `SHADE_LEVELS`, and the shipped canvas passes nothing — so the source it emits is
   *  byte-identical to the one every measured figure about the banded ground was taken against.
   *
   *  ⚠ IT IS HERE FOR THE COMPARISON, NOT AS A DIAL SOMEBODY MAY TURN IN PRODUCTION. Which
   *  ladder the map wears decides how dark a shaded parcel gets, and therefore how much reading
   *  margin the ground has left over for anything else — a look decision with a semantic cost,
   *  which ADR-0392 D5 reserves to the owner. What the option buys is that candidate ladders
   *  render through THIS material rather than through a second implementation, so an arm on the
   *  comparison page can honestly claim to differ in exactly one thing.
   *
   *  ⚠ THE SHADOW RUNG IS RE-DERIVED AGAINST IT. A shadowed material asks `shadowLadderFor` how
   *  dark THIS ladder's tokens may go, so a candidate does not silently inherit the shipped
   *  ladder's 0.77 — a stale derived number of exactly the class the fourth crossing was written
   *  to prevent. */
  lit?: readonly number[];
}

/** The occlusion field, uploaded, with the ground rect it covers. */
export interface GroundShadow {
  texture: Texture;
  minX: number;
  minZ: number;
  spanX: number;
  spanZ: number;
}

/** A packed occlusion atlas, uploaded, with the ground→UV SCALE every tile shares. The per-tile
 *  ORIGIN is not here: it rides on the mesh, because it is what differs per island. */
export interface GroundShadowAtlas {
  texture: Texture;
  /** Atlas UV per ground unit, x and z. `gres / atlasEdge` — derived by `atlasScale` rather than
   *  spelled here, so the packing and the shader cannot hold two copies of one number. */
  scaleU: number;
  scaleV: number;
}

/**
 * Upload a packed {@link AtlasField} as a single-channel texture.
 *
 * SAME FILTERING AND WRAPPING AS {@link groundShadowTexture}, and the tile borders do not need
 * more. `OCCLUSION_PAD` already leaves six texels of empty field between an island's own land and
 * its tile's edge at the authored resolution, and a bilinear tap reaches one — so no fragment
 * over ground the mesh actually covers can sample a neighbouring tile. `shadow-atlas.ts`'s
 * `tileMargin` is what says so, and would say so loudly if the pad ever moved.
 */
export function groundAtlasTexture(field: AtlasField): GroundShadowAtlas {
  const tex = new DataTexture(field.data, field.w, field.h, RedFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const scale = atlasScale(field);
  return { texture: tex, scaleU: scale.u, scaleV: scale.v };
}

/**
 * Upload a {@link ShadowField} as a single-channel texture.
 *
 * LINEAR FILTERING, ON PURPOSE, AND IT COSTS NOTHING. The fragment stage THRESHOLDS this scalar
 * (one shadow rung means the decision is binary), so interpolation cannot introduce a colour — it
 * only moves WHERE the edge falls, to sub-texel precision, and the palette closure is untouched
 * either way. Nearest filtering would staircase the shadow's outline along the field's own grid
 * at the zoomed read, which looks like a defect in the shadow rather than in the sampling.
 */
export function groundShadowTexture(field: ShadowField): GroundShadow {
  const tex = new DataTexture(field.data, field.w, field.h, RedFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return {
    texture: tex,
    minX: field.minX,
    minZ: field.minZ,
    spanX: field.w / field.gres,
    spanZ: field.h / field.gres,
  };
}

/** A delivered colour as a GLSL literal, 0..1 per channel. The grain stops are AUTHORED
 *  constants, so they are written into the source rather than uploaded — the same argument
 *  `bandGlsl` makes about the ladder: a shader and a test holding private copies of one number
 *  prove nothing about each other. */
function glslVec3(c: { r: number; g: number; b: number }): string {
  return `vec3(${(c.r / 255).toFixed(6)}, ${(c.g / 255).toFixed(6)}, ${(c.b / 255).toFixed(6)})`;
}

/**
 * THE RAMP, FLATTENED — every `(token, level)` product this material can deliver, row-major, as
 * 0..1 channel triples ready to upload.
 *
 * Row-major and not level-major, so `row * levels.length + rung` is the index, which is the one
 * arithmetic the shader does. Exported because it is what a test enumerates to prove the closure:
 * the reachable set of this material is exactly this array, with no sampling.
 *
 * ⚠ `levels` DEFAULTS TO THE AUTHORED LADDER AND IS AN ARGUMENT ONLY BECAUSE OF THE SHADOW. A
 * shadowed material's ramp is one entry longer per row and NOTHING ELSE CHANGES: the extra entry
 * is `token x SHADOW_RUNG`, a member of the same `(authored token x authored level)` closure the
 * palette is defined as. The shadow costs palette ENTRIES; it does not cost the closure.
 */
export function groundRamp(
  tokens: readonly string[],
  levels: readonly number[] = SHADE_LEVELS,
): number[][] {
  const out: number[][] = [];
  for (const token of tokens) {
    for (const level of levels) {
      const c = deliveredForLevel(token, level);
      out.push([c.r / 255, c.g / 255, c.b / 255]);
    }
  }
  return out;
}

/** The generated fragment-stage selection: a comparison chain rather than `uRamp[idx]`, because
 *  GLSL ES 1.0 forbids a dynamic index into a uniform array. Generated from the ramp's own length
 *  so it cannot fall short of it — a hand-typed chain that stopped early would paint every status
 *  past the cut-off with row 0's colour, which is a foreign-status read on the surface whose whole
 *  job is to report status. */
export function rampSelectGlsl(entries: number): string {
  // ⚠ BUILT WITH `Array.from` RATHER THAN AN INDEXED `for`, and that is a mutation-rung finding
  // rather than a style preference. The loop's `i < entries` and `i += 1` came back UNPROVEN —
  // killed, but with no test named — which the rung treats as neither a pass nor a survivor, and
  // which the `bun` runner's coverage attribution does to inline single-statement loop bodies
  // (`mutation-rung-misreports-inline-chains`). With the counter gone there is nothing left to
  // mis-attribute, and every remaining mutant lands on arithmetic a test names directly.
  const rest = Array.from(
    { length: Math.max(0, entries - 1) },
    (_, i) => `if (idx == ${i + 1}) c = uRamp[${i + 1}];`,
  );
  return ['vec3 c = uRamp[0];', ...rest].join('\n        ');
}

/**
 * THE PER-TOKEN GATE, as GLSL — one scalar that is 1.0 on the rows the layer dresses and 0.0
 * everywhere else, so the mix below it is a multiply rather than a branch around the write.
 *
 * ⚠ THE ROWS ARE WRITTEN INTO THE SOURCE RATHER THAN UPLOADED, unlike the mix factor, and the
 * reason is the same one {@link rampSelectGlsl} exists for: GLSL ES 1.0 will not let a fragment
 * shader index a uniform array with a computed index, so a `uGrassRows[row]` lookup is not
 * available to write even if it were wanted. It is also the right shape — the mix factor is the
 * one number a comparison arm varies, while WHICH tokens wear the layer is structural, so
 * writing it in keeps a four-arm page compiling one shader per factor rather than per gate.
 *
 * ⚠ THE ROW TEST IS `int(vStatus + 0.5)`, THE SAME SPELLING THE RAMP INDEX USES, and that is
 * load-bearing rather than tidy: `vStatus` arrives interpolated, so a bare cast would read
 * 1.9999998 as row 1 and gate the wrong token — dressing a foreign status and leaving the green
 * flat, which is precisely the misreport the gate exists to prevent.
 */
export function grassGateGlsl(rows: readonly number[]): string {
  return gateGlsl('grassGate', rows);
}

/** A PER-TOKEN GATE UNDER ANY NAME — the grass's and the wheat's are the same emitter, so the two
 *  cannot disagree about the `+ 0.5` the row test rests on. Exported for the same exact-golden
 *  reason {@link grassGateGlsl} is. */
export function gateGlsl(name: string, rows: readonly number[]): string {
  const tests = rows.map((row) => gateTestLine(name, row));
  return [`float ${name} = 0.0;`, ...tests].join('\n        ');
}

/** One row test of a gate. Named rather than an inline arrow, for the mutation rung's attribution. */
function gateTestLine(name: string, row: number): string {
  return `if (int(vStatus + 0.5) == ${row}) ${name} = 1.0;`;
}

/** One ladder level as a GLSL literal — six places, the precision every other authored float in
 *  this shader is written at. */
function glslLevel(level: number): string {
  return level.toFixed(6);
}

/** One line of the level chain. Named for the reason {@link litRemapLine} is: a mutant inside an
 *  inline arrow body cannot be attributed to the test that kills it. */
function levelSelectLine(i: number, level: number): string {
  return `if (lvl == ${i}) level = ${glslLevel(level)};`;
}

/**
 * THE FRAGMENT'S OWN LIGHTING RUNG, AS A SCALAR — the level the ramp entry the fragment landed on
 * was built from (`token x level`, `deliveredForLevel`), recovered from `lvl` by the same
 * comparison-chain shape {@link rampSelectGlsl} uses, and for the same GLSL ES 1.0 reason.
 *
 * ⚠⚠ WHY A COLOUR LAYER NEEDS IT (2026-09-03). Every layer above the ramp — the grass, the sand,
 * the dirt, the rock — enters as `mix(c, layerColour, factor)`, and until this existed
 * `layerColour` was the recipe's UNLIT albedo while `c` was the LIT ramp entry. At a timid factor
 * that is invisible; at the bold factors ADR-0503 directs, it is the mechanism that flattened
 * the ground — 85% of a fragment carrying no lighting rung at all, so the relief's banding and
 * the contact shadow under a tree faded in proportion to how much of the recipe the ground wore.
 * Cycles shades the composited albedo; multiplying each layer's colour by this scalar before the
 * mix is that order on this ladder, and it is what keeps a shadow a shadow on bold ground.
 *
 * ⚠ IT IS EMITTED ONLY WHEN A COLOUR LAYER IS PRESENT, so an unlayered shader stays byte-identical
 * to the one every committed figure about the banded ground was taken against.
 */
export function levelSelectGlsl(levels: readonly number[]): string {
  const rest = Array.from({ length: Math.max(0, levels.length - 1) }, (_, i) =>
    levelSelectLine(i + 1, levels[i + 1]!),
  );
  return [`float level = ${glslLevel(levels[0]!)};`, ...rest].join('\n        ');
}

/** One line of the LIT-rung remap. A named function rather than an expression inside a callback:
 *  the mutation rung cannot attribute a mutant inside an inline arrow body to the test that kills
 *  it, and an unattributable mutant reds the rung from inside well-covered arithmetic. */
function litRemapLine(from: number, to: number): string {
  return `if (rung == ${from}) lvl = ${to};`;
}

/** GLSL mapping each `SHADE_LEVELS` index onto its index in the SHADOW-EXTENDED ladder.
 *
 *  ⚠ IT IS A REMAP RATHER THAN AN OFFSET, and that is not defensive. `deepestAdmissibleRung` can
 *  in principle return a level sitting BETWEEN two authored rungs, in which case the sorted ladder
 *  does not simply shift every lit rung up by one. Assuming it does would paint the wrong colour
 *  for every fragment on the map the day the palette moves, silently. */
export function litRemapGlsl(litIndex: readonly number[]): string {
  return Array.from({ length: litIndex.length }, (_, i) => litRemapLine(i, litIndex[i]!)).join(
    '\n        ',
  );
}

/** One line of the shadow's own remap. Named for the same reason as {@link litRemapLine}. */
function darkenLine(from: number, rungIndex: number): string {
  return `if (rung == ${from}) lvl = ${rungIndex};`;
}

/** GLSL sending every DARKENABLE lit rung to the shadow rung — those LIGHTER than it. A fragment
 *  already darker keeps its own level, because a shadow that BRIGHTENED a surface would be a
 *  shadow lighting something up. */
export function shadowDarkenGlsl(darkenable: readonly number[], rungIndex: number): string {
  return Array.from({ length: darkenable.length }, (_, i) =>
    darkenLine(darkenable[i]!, rungIndex),
  ).join('\n            ');
}

/** One row's guard around its own darken lines. Named for the reason {@link litRemapLine} is. */
function rowDarkenBlock(row: number, lines: string): string {
  return `if (row == ${row}) { ${lines} }`;
}

/**
 * GLSL sending an occluded fragment to ITS OWN TOKEN'S shadow rung — the full rung past 0.5, the
 * soft rung between 0.25 and 0.5 under a soft edge — with `occ` the field's sample and `row` the
 * fragment's ramp row already read.
 *
 * ⚠ IT COLLAPSES TO THE ONE-RUNG FORM WHEN THE LADDER IS THE ONE-RUNG LADDER — hard edge, every
 * token on the derived rung — so a material built without `shadowDepth` emits the exact source
 * every committed figure about the shadowed ground was taken against. The per-row form is emitted
 * only when a token's rung differs from another's or a soft rung exists, because a per-row chain
 * on a six-row palette is thirty comparisons a fragment that needs none of them would still pay.
 */
export function shadowOcclusionGlsl(ladder: ShadowLadder): string {
  const oneRung = ladder.edge === 'hard' && ladder.tokens.every((t) => t.fullIndex === ladder.rungIndex);
  if (oneRung) {
    return [
      'if (occ > 0.5) {',
      `            ${shadowDarkenGlsl(ladder.darkenable, ladder.rungIndex)}`,
      '        }',
    ].join('\n');
  }
  const full = ladder.tokens.map((t, row) => rowDarkenBlock(row, shadowDarkenGlsl(t.darkenable, t.fullIndex)));
  const out = ['if (occ > 0.5) {', ...full.map((l) => `            ${l}`), '        }'];
  if (ladder.edge === 'soft') {
    const half = ladder.tokens.map((t, row) =>
      rowDarkenBlock(row, shadowDarkenGlsl(t.halfDarkenable, t.halfIndex ?? t.fullIndex)),
    );
    out.push('        else if (occ > 0.25) {', ...half.map((l) => `            ${l}`), '        }');
  }
  return out.join('\n');
}

/**
 * The banded ground material: `colour = ramp[statusRow * nLevels + bandIndex(lambert)]`.
 *
 * The ladder in the fragment source is INTERPOLATED by `bandGlsl` from the material's own lit
 * ladder (`SHADE_LEVELS` unless a caller overrides it) and the ramp is computed by
 * `deliveredForLevel`, so a shader and a test holding private copies of the same numbers is
 * unrepresentable — the argument `bandGlsl` already makes about the ladder, extended to the
 * colours.
 *
 * THE AMBIENT FLOOR IS DELIBERATELY ABSENT. Adding a constant AFTER quantisation would produce
 * `token * level + ambient`, which is not a closure member. The ladder's darkest rung IS the
 * ambient floor; that is what a locked palette means, and on this surface it is also the fence
 * that stops a shaded `healthy` parcel walking into `unhealthy`'s territory.
 */
export function createBandedGroundMaterial(opts: BandedGroundMaterialOptions): ShaderMaterial {
  // ⚠ THE SHADOW'S RUNG IS DERIVED FROM THIS MATERIAL'S OWN TOKENS, never inherited and never
  // typed. `shadowLadderFor` asks how dark every one of them may go before it reads as another,
  // and THROWS if the answer is "not at all" — a palette that cannot carry a shadow honestly has
  // to fail loudly, because the failure IS the finding (ADR-0392 D5 / ADR-0398 D7).
  const lit = opts.lit ?? SHADE_LEVELS;
  // ⚠ REFUSED, NOT RESOLVED BY PRECEDENCE. The two occlusion forms disagree about how a fragment
  // finds its sample; a material handed both would shade through one of them and leave the other
  // reading as though it were doing something.
  if (opts.shadow !== undefined && opts.shadowAtlas !== undefined) {
    throw new Error(
      'banded-ground-material: both a rect occlusion field and a packed atlas were supplied — ' +
        'they are two spellings of one input and only one of them can be the one being drawn',
    );
  }
  const occluded = opts.shadow !== undefined || opts.shadowAtlas !== undefined;
  const ladder = occluded ? shadowLadderFor(opts.tokens, lit, opts.shadowDepth) : null;
  const ramp = groundRamp(opts.tokens, ladder === null ? lit : ladder.levels);
  if (ramp.length === 0) {
    // A material with an empty ramp compiles to `uRamp[0]` on a zero-length uniform array, which
    // is a link error on some drivers and a black island on others. Refusing is the only reading
    // that cannot be mistaken for art.
    throw new Error('banded-ground-material: no tokens — a ground material with no palette');
  }
  const grainNormal = opts.grain === 'normal' || opts.grain === 'both';
  const grainColour = opts.grain === 'both';
  const grained = grainNormal || grainColour;
  const grass = opts.grass;
  // ⚠ REFUSED, NOT SILENTLY REPAIRED BY EMITTING A SECOND LATTICE HASH. `grassGlsl()` calls
  // `st_grainOctave`, which only `grainGlsl()` declares. Emitting a grass-named copy would put
  // two spellings of one field in one shader — which is how this package once acquired three
  // disagreeing status palettes — and repairing it by turning the grain on would silently give
  // the caller a component it did not ask for.
  if (grass !== undefined && !grained) {
    throw new Error(
      'banded-ground-material: the grass layer needs the grain — it evaluates its octaves ' +
        'through `st_grainOctave`, which only the grain source declares',
    );
  }
  // ⚠ AN EMPTY GATE IS REFUSED RATHER THAN TREATED AS "EVERY ROW". Both readings are defensible
  // from the value alone, which is exactly why neither may be guessed: "every row" is the input
  // ADR-0492's measurement forbids, and "no row" is a layer that is switched on, pays a full
  // shader's fragment work, and delivers the pixels the ground drew before it — a landing that
  // looks clean and changes nothing, which is this arc's named failure shape.
  if (grass !== undefined && grass.rows.length === 0) {
    throw new Error(
      'banded-ground-material: the grass layer was given no rows to dress — a gate that ' +
        'matches nothing draws the ungrassed ground at the grassed ground’s cost',
    );
  }
  // ⚠ AND A ROW OUTSIDE THE RAMP IS REFUSED TOO, because it fails INVISIBLY: the emitted test
  // simply never matches, so the shader compiles, the island draws, and the layer is silently
  // absent from a map that reports it as adopted.
  const sand = opts.sand;
  // ⚠ REFUSED FOR THE SAME REASON THE GRASS IS. `sandGlsl()` calls `st_grassScalar` (the sand ramp
  // is driven by layer 1's own base scalar) and `st_grassSrgb` — both of which only `grassGlsl()`
  // declares. Emitting a sand-named copy of either would put two spellings of one field in one
  // shader, and the beach would drift away from the grass it is supposed to be part of.
  if (sand !== undefined && grass === undefined) {
    throw new Error(
      'banded-ground-material: the sand layer needs the grass — its ramp is driven by layer 1’s ' +
        'own base scalar, which only the grass source declares',
    );
  }
  // ⚠ AND IT NEEDS THE PACKED ATLAS. The shore field is sampled through the SAME `shUv` the
  // shadow computes, so without the atlas form there is no per-island tile to ride and no
  // coordinate to sample through. Refused rather than silently falling back to the rect form,
  // which would sample one island's stretch of coast for the whole map.
  if (sand !== undefined && opts.shadowAtlas === undefined) {
    throw new Error(
      'banded-ground-material: the sand layer needs the PACKED occlusion atlas — it rides that ' +
        'atlas’s own tiles, and there is no per-island coordinate without it',
    );
  }
  const wear = opts.wear;
  // ⚠ REFUSED FOR THE SAND'S REASON, ONE LAYER ON. `wearGlsl()` calls `st_grassScalar` and
  // `st_grassSrgb` (the dirt ramp is driven by layer 1's base scalar) and `st_grainOctave` (the
  // break noise reuses the one lattice hash), which only the grass and grain sources declare.
  if (wear !== undefined && grass === undefined) {
    throw new Error(
      'banded-ground-material: the wear layer needs the grass — its dirt ramp is driven by ' +
        'layer 1’s own base scalar and its break noise by the one lattice hash, which only the ' +
        'grass source declares',
    );
  }
  // ⚠ AND THE PACKED ATLAS, like the sand: the distance field is sampled through the SAME `shUv`
  // the shadow computes, so without the atlas form there is no per-island tile to ride.
  if (wear !== undefined && opts.shadowAtlas === undefined) {
    throw new Error(
      'banded-ground-material: the wear layer needs the PACKED occlusion atlas — its distance ' +
        'field rides that atlas’s own tiles, and there is no per-island coordinate without it',
    );
  }
  const rock = opts.rock;
  // ⚠ REFUSED FOR THE SAME REASON. `rockGlsl()` calls `st_grassScalar` and `st_grassSrgb`. It
  // needs NO atlas: the mask is the normal, which every fragment holds already.
  if (rock !== undefined && grass === undefined) {
    throw new Error(
      'banded-ground-material: the rock layer needs the grass — its ramp is driven by layer 1’s ' +
        'own base scalar, which only the grass source declares',
    );
  }
  const detail = opts.detail;
  // ⚠ REFUSED WITHOUT THE GRAIN. The detail stage bends the normal the grain stage then relieves
  // (the recipe's NormalMap → Bump order), and it samples `vWorld`, which only the grain or a
  // shadow carries through. Turning the grain on to repair it would hand the caller a component
  // it did not ask for; emitting the stage alone would read a varying nothing declared.
  if (detail !== undefined && !grained) {
    throw new Error(
      'banded-ground-material: the detail normal needs the grain — it bends the normal the ' +
        'grain stage then relieves (the recipe’s NormalMap → Bump order), and it samples the ' +
        'world position that stage carries through',
    );
  }
  const strayRow = grass?.rows.find((row) => !Number.isInteger(row) || row < 0 || row >= opts.tokens.length);
  if (strayRow !== undefined) {
    throw new Error(
      `banded-ground-material: the grass layer names row ${strayRow}, which is not a ramp row ` +
        `of the ${opts.tokens.length} this material was handed`,
    );
  }
  const wheat = opts.wheat;
  // ⚠ REFUSED FOR THE SAND'S REASON. `wheatGlsl()` calls `st_grassScalar`, `st_grassDrift`,
  // `st_grassCool`, `st_grassWarm` and `st_grassSrgb`, which only the grass source declares — the
  // wheat is the grass's structure wearing another colour, and has no field of its own to stand on.
  if (wheat !== undefined && grass === undefined) {
    throw new Error(
      'banded-ground-material: the wheat layer needs the grass — it is layer 1’s own structure ' +
        're-palettised, and reads the scalar, drift and transfer only the grass source declares',
    );
  }
  // ⚠ AN EMPTY GATE IS REFUSED, for the grass's reason: it is a layer switched on that dresses
  // nothing, at a full shader's cost, and it looks like a clean landing.
  if (wheat !== undefined && wheat.rows.length === 0) {
    throw new Error(
      'banded-ground-material: the wheat layer was given no rows to dress — a gate that ' +
        'matches nothing draws the flat yellow at the painted yellow’s cost',
    );
  }
  // ⚠ A LIFT BELOW 1 OR NOT A NUMBER IS REFUSED. The ladder runs from the derivation (1) upward
  // (`wheat-paleness-ladder`); a lift under 1 darkens a field the recipe already darkens, and NaN
  // would write `NaN` into six stop constants and compile a shader that draws black.
  if (wheat !== undefined && !(Number.isFinite(wheat.lift) && wheat.lift >= 1)) {
    throw new Error(
      `banded-ground-material: the wheat layer's lift is ${wheat.lift}; the paleness ladder runs from 1 ` +
        '(the derivation as it stands) upward, and a lift below it darkens a field the recipe already darkens',
    );
  }
  const strayWheatRow = wheat?.rows.find((row) => !Number.isInteger(row) || row < 0 || row >= opts.tokens.length);
  if (strayWheatRow !== undefined) {
    throw new Error(
      `banded-ground-material: the wheat layer names row ${strayWheatRow}, which is not a ramp row ` +
        `of the ${opts.tokens.length} this material was handed`,
    );
  }
  // ⚠⚠ A ROW IN BOTH GATES IS REFUSED. The paint line composites `grass * grassGate + wheat *
  // wheatGate` and mixes at `uGrassMix * grassGate + uWheatMix * wheatGate`; a row both gates name
  // would deliver the SUM of two layers at the sum of two factors — a colour neither layer's
  // instrument ever measured, on a token that reads as whichever it happens to land near.
  // The grass rows to test against — `[]` only when there is no grass, and then there is no wheat
  // either (refused above), so nothing is ever tested against the empty list.
  // Stryker disable next-line ConditionalExpression,ArrayDeclaration: EQUIVALENT — a wheat without a grass was
  // refused above, so this branch is reached with `grass` defined whenever `wheat` is; the `[]` arm
  // exists only to type the constant and no `find` ever runs over it.
  const grassRows: readonly number[] = grass === undefined ? [] : grass.rows;
  const sharedRow = wheat?.rows.find((row) => grassRows.includes(row));
  if (sharedRow !== undefined) {
    throw new Error(
      `banded-ground-material: row ${sharedRow} is named by BOTH the grass gate and the wheat ` +
        'gate — one row wears one painted layer, never the sum of two',
    );
  }
  const blight = opts.blight;
  // ⚠ REFUSED FOR THE WHEAT'S REASON. `blightGlsl()` calls `st_grassScalar`, `st_grassDrift` and
  // `st_grassSrgb`, which only the grass source declares — the blight's BASE is the grass's
  // structure wearing a burned colour. Its crack network is its own and is the one field it adds.
  if (blight !== undefined && grass === undefined) {
    throw new Error(
      'banded-ground-material: the blight layer needs the grass — its base is layer 1’s own ' +
        'structure re-palettised, and reads the scalar, drift and transfer only the grass source declares',
    );
  }
  // ⚠ AN EMPTY GATE IS REFUSED, for the grass's and the wheat's reason.
  if (blight !== undefined && blight.rows.length === 0) {
    throw new Error(
      'banded-ground-material: the blight layer was given no rows to dress — a gate that ' +
        'matches nothing draws the flat charcoal at the painted charcoal’s cost',
    );
  }
  // ⚠⚠ A BURN OF 1 IS BLACK, AND BLACK IS THE SEA. The scene background is a near-black
  // (`#101418`), and a metric that scores an island in isolation rewards painting it darker right
  // up to the point it merges with the water (measured, PR #1792). The ladder therefore runs
  // strictly below 1, and NaN would write `NaN` into six stop constants and compile a shader that
  // draws black — the same failure by another route.
  if (blight !== undefined && !(Number.isFinite(blight.palette.burn) && blight.palette.burn >= 0 && blight.palette.burn < 1)) {
    throw new Error(
      `banded-ground-material: the blight layer's burn is ${blight.palette.burn}; it runs from 0 ` +
        '(the ramps re-expressed on the charred token) up to but never reaching 1, which is black',
    );
  }
  if (blight !== undefined && !(Number.isFinite(blight.palette.crackMix) && blight.palette.crackMix >= 0 && blight.palette.crackMix <= 1)) {
    throw new Error(
      `banded-ground-material: the blight layer's crack strength is ${blight.palette.crackMix}; ` +
        'it is a mix factor and runs from 0 (the base alone) to 1',
    );
  }
  const strayBlightRow = blight?.rows.find((row) => !Number.isInteger(row) || row < 0 || row >= opts.tokens.length);
  if (strayBlightRow !== undefined) {
    throw new Error(
      `banded-ground-material: the blight layer names row ${strayBlightRow}, which is not a ramp row ` +
        `of the ${opts.tokens.length} this material was handed`,
    );
  }
  // ⚠⚠ A ROW IN TWO PAINT GATES IS REFUSED, for the grass/wheat pair's reason: a row two gates
  // name would deliver the SUM of two layers at the sum of two factors — a colour neither layer's
  // instrument ever measured. The wheat rows to test against — `[]` only when there is no wheat.
  // Stryker disable next-line ConditionalExpression,ArrayDeclaration: EQUIVALENT — the `[]` arm exists only
  // to type the constant, and a material with no wheat has no wheat row for a blight row to share.
  const wheatRows: readonly number[] = wheat === undefined ? [] : wheat.rows;
  const sharedBlightRow = blight?.rows.find((row) => grassRows.includes(row) || wheatRows.includes(row));
  if (sharedBlightRow !== undefined) {
    throw new Error(
      `banded-ground-material: row ${sharedBlightRow} is named by the blight gate AND another ` +
        'painted gate — one row wears one painted layer, never the sum of two',
    );
  }
  const shadowed = ladder !== null;
  const [grainDark, grainLight] = grainStops();

  // ⚠ THE WORLD POSITION RIDES THROUGH ONLY WHEN SOMETHING NEEDS IT. A material with neither
  // the grain nor a shadow must stay byte-identical to the one this file emitted before either
  // existed — otherwise every figure already measured about the banded ground (0 off-palette
  // pixels, 51% cheaper per frame than `MeshStandardMaterial`) would be a figure about a different
  // shader. The REASON line is picked by whichever asked for it, so a GRAINED material's source is
  // unchanged by the shadow's arrival too — the same claim, one rider further along.
  const needsWorld = grained || shadowed;
  const worldReason = grained
    ? '\n        // The grain is authored in GROUND coordinates, so it is sampled in them.'
    : '\n        // The occlusion field is authored in GROUND coordinates, so it is sampled in them.';
  const worldVarying = needsWorld ? '\n      varying vec3 vWorld;' : '';
  const worldAssign = needsWorld
    ? worldReason + '\n        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;'
    : '';

  // ⚠ THE GRAIN UNIFORMS ARE ADDED BY STATEMENT — the same shape `harness/banded-material.ts`
  // uses, and for the same reason plus one the lint rules make sharper. The reason: an ungrained
  // material must carry NO `uGrain*` uniform at all, because a uniform the shader never declares
  // is dead weight a reader would take as evidence the grain is active. The sharper one: the two
  // shorter spellings are both refused, and correctly — annotating the WHOLE uniform object as an
  // open dictionary discards the fact that `uRamp` and `uLightDir` are always there
  // (`no-known-value-widening`), and a `...(cond ? {x} : {})` hides an omission behind an empty
  // object (`no-conditional-empty-object-spread`). An empty dictionary that starts empty discards
  // nothing and omits nothing.
  const grainUniforms: Record<string, { value: number }> = {};
  if (grainNormal) grainUniforms['uGrainNormalStrength'] = { value: GRAIN_NORMAL_STRENGTH };
  if (grainColour) grainUniforms['uGrainColourMix'] = { value: GRAIN_COLOUR_MIX };
  // The grass layer's own factor, by statement for the same two reasons: an ungrassed material
  // must carry NO `uGrass*` uniform at all, and the shorter spellings are refused by the
  // anti-slop rules. It is UPLOADED rather than written into the source, unlike the grain's mix,
  // because it is the one number on this layer a comparison arm varies — a page carrying four
  // facs would otherwise compile four shaders that differ in a constant.
  const grassUniforms: Record<string, { value: number }> = {};
  if (grass !== undefined) grassUniforms['uGrassMix'] = { value: grass.mix };
  // The wheat's own factor, by statement for the grass's two reasons: an unwheated material must
  // carry NO `uWheat*` uniform at all, and the shorter spellings are refused by the anti-slop
  // rules. Uploaded rather than written in, like the grass's — it is the number a scale-back moves.
  const wheatUniforms: Record<string, { value: number }> = {};
  if (wheat !== undefined) wheatUniforms['uWheatMix'] = { value: wheat.mix };
  // The blight's own factor, by statement for the wheat's two reasons: an unblighted material must
  // carry no uniform the shader never declares, and the factor must be the layer's own.
  const blightUniforms: Record<string, { value: number }> = {};
  if (blight !== undefined) blightUniforms['uBlightMix'] = { value: blight.mix };
  // Layer 2's field, by statement for the same two reasons: an unsanded material must carry NO
  // `uShore*` uniform at all, and the shorter spellings are refused by the anti-slop rules.
  const sandUniforms: Record<string, { value: Texture } | { value: number }> = {};
  if (sand !== undefined) {
    sandUniforms['uShoreTex'] = { value: sand.shore };
    sandUniforms['uSandMix'] = { value: sand.mix };
    sandUniforms['uSandWidth'] = { value: sand.width };
  }
  // Layer 3's field and two factors, by statement for the same two reasons: an unworn material
  // must carry NO `uWear*` uniform at all, and the shorter spellings are refused by the
  // anti-slop rules. The WIDTH is uploaded, never written in — it is the number a page comparing
  // path widths varies on one compiled shader.
  const wearUniforms: Record<string, { value: Texture } | { value: number }> = {};
  if (wear !== undefined) {
    wearUniforms['uWearTex'] = { value: wear.field };
    wearUniforms['uWearMix'] = { value: wear.mix };
    wearUniforms['uWearWidth'] = { value: wear.width };
  }
  // Layer 4's factor and its two ramp ends, by statement. The ENDS are uniforms rather than
  // written in, because on the shipped mesh which ends bite anywhere is the whole question
  // (`land-rock.ts`) — a page comparing rungs varies two numbers on one shader.
  const rockUniforms: Record<string, { value: number }> = {};
  if (rock !== undefined) {
    rockUniforms['uRockMix'] = { value: rock.mix };
    rockUniforms['uRockLo'] = { value: rock.slope[0] };
    rockUniforms['uRockHi'] = { value: rock.slope[1] };
  }
  // Layer 6's map, strength and tile, by statement. Both numbers are uniforms: the recipe's
  // 0.30 and 2.4 are provenance, and the shipped values are read off a rendered ladder.
  const detailUniforms: Record<string, { value: Texture } | { value: number }> = {};
  if (detail !== undefined) {
    detailUniforms['uDetailTex'] = { value: detail.map };
    detailUniforms['uDetailStrength'] = { value: detail.strength };
    detailUniforms['uDetailTile'] = { value: detail.tile };
  }
  // The occlusion field's two uniforms follow the same by-statement shape, for the same two
  // reasons: an unshadowed material must carry NO `uShadow*` uniform at all, and both shorter
  // spellings are refused by the anti-slop rules.
  const shadowUniforms: Record<
    string,
    { value: Texture } | { value: Vector4 } | { value: Vector2 }
  > = {};
  if (opts.shadowAtlas !== undefined) {
    shadowUniforms['uShadowTex'] = { value: opts.shadowAtlas.texture };
    // The SCALE only — every tile shares it, because the packing puts them all at one resolution.
    // The per-island ORIGIN rides on the mesh; see GROUND_ATLAS_ATTRIBUTE.
    shadowUniforms['uShadowAtlasScale'] = {
      value: new Vector2(opts.shadowAtlas.scaleU, opts.shadowAtlas.scaleV),
    };
  }
  if (opts.shadow !== undefined) {
    shadowUniforms['uShadowTex'] = { value: opts.shadow.texture };
    // The RECT carries the RECIPROCAL spans rather than the spans, so the fragment stage does two
    // multiplies instead of two divides per pixel — and so a zero span surfaces as an Infinity in
    // a uniform here rather than as a whole island quietly reading unshadowed.
    shadowUniforms['uShadowRect'] = {
      value: new Vector4(
        opts.shadow.minX,
        opts.shadow.minZ,
        1 / opts.shadow.spanX,
        1 / opts.shadow.spanZ,
      ),
    };
  }
  const uniforms = {
    uRamp: { value: ramp.map(([r, g, b]) => new Vector3(r, g, b)) },
    uLightDir: {
      value: new Vector3(LIGHT_DIRECTION.x, LIGHT_DIRECTION.y, LIGHT_DIRECTION.z),
    },
    ...grainUniforms,
    ...grassUniforms,
    ...wheatUniforms,
    ...blightUniforms,
    ...sandUniforms,
    ...wearUniforms,
    ...rockUniforms,
    ...detailUniforms,
    ...shadowUniforms,
  };

  const grainSource = grained ? `\n      ${grainGlsl().split('\n').join('\n      ')}\n` : '';
  // APPENDED AFTER THE GRAIN'S SOURCE, and the order is a requirement rather than a habit: GLSL
  // ES 1.0 resolves calls against declarations already seen, and every grass octave calls
  // `st_grainOctave`.
  const grassSource = grass === undefined ? '' : `      ${grassGlsl().split('\n').join('\n      ')}\n`;
  // Appended AFTER the grass source, because `wheatGlsl()` calls the grass's scalar, drift, ramps
  // and transfer — it declares no field of its own. Before the sand's, so a sanded-and-wheated
  // shader carries the recipe's order grass → wheat → sand → wear → rock.
  const wheatSource = wheat === undefined ? '' : `      ${wheatGlsl(wheat).split('\n').join('\n      ')}\n`;
  // Appended after the wheat's, and it declares a field of its own (the crack network) on top of
  // the grass's scalar, drift and transfer. Absent leaves the source byte-identical.
  const blightSource =
    blight === undefined ? '' : `      ${blightGlsl(blight.palette).split('\n').join('\n      ')}\n`;
  // Appended AFTER the grass source, because `sandGlsl()` calls `st_grassScalar` and
  // `st_grassSrgb`, and GLSL ES 1.0 resolves calls against declarations already seen.
  const sandSource = sand === undefined ? '' : `      ${sandGlsl().split('\n').join('\n      ')}\n`;
  // Appended AFTER the sand source, for the same reason: `wearGlsl()` calls `st_grassScalar`,
  // `st_grassSrgb` and `st_grainOctave`. The order among the three layer sources is the
  // recipe's own (grass → sand → wear → rock), and none of them calls a later one.
  const wearSource = wear === undefined ? '' : `      ${wearGlsl().split('\n').join('\n      ')}\n`;
  // Appended AFTER the wear source. `rockGlsl()` calls `st_grassScalar` and `st_grassSrgb`.
  const rockSource = rock === undefined ? '' : `      ${rockGlsl().split('\n').join('\n      ')}\n`;
  // The two grain uniforms are declared as ONE appended string rather than as two
  // interpolated ternaries, and that IS the byte-identity claim rather than a formatting
  // preference: a `${cond ? x : ''}` sitting on its own line leaves that line's indentation
  // behind, so an ungrained shader would differ from the one measured on 2026-08-30 by two
  // whitespace-only lines. Byte-identical has to be literal or it is not a claim.
  const grainUniformDecls =
    (grainNormal ? '\n      uniform float uGrainNormalStrength;' : '') +
    (grainColour ? '\n      uniform float uGrainColourMix;' : '');
  // Appended after the grain's, so an ungrassed shader is byte-identical.
  const grassUniformDecls = grass === undefined ? '' : '\n      uniform float uGrassMix;';
  // Appended after the grass's, so an unwheated shader is byte-identical.
  const wheatUniformDecls = wheat === undefined ? '' : '\n      uniform float uWheatMix;';
  /** Appended after the wheat's, so an unblighted shader is byte-identical. */
  const blightUniformDecls = blight === undefined ? '' : '\n      uniform float uBlightMix;';
  // Appended after the grass's, so an unsanded shader is byte-identical.
  const sandUniformDecls =
    sand === undefined
      ? ''
      : '\n      uniform sampler2D uShoreTex;' +
        '\n      uniform float uSandMix;' +
        '\n      uniform float uSandWidth;';
  // Appended after the sand's, so an unworn shader is byte-identical.
  const wearUniformDecls =
    wear === undefined
      ? ''
      : '\n      uniform sampler2D uWearTex;' +
        '\n      uniform float uWearMix;' +
        '\n      uniform float uWearWidth;';
  // Appended after the wear's, so an unrocked shader is byte-identical.
  const rockUniformDecls =
    rock === undefined
      ? ''
      : '\n      uniform float uRockMix;' + '\n      uniform float uRockLo;' + '\n      uniform float uRockHi;';
  // Appended after the rock's, so an undetailed shader is byte-identical.
  const detailUniformDecls =
    detail === undefined
      ? ''
      : '\n      uniform sampler2D uDetailTex;' +
        '\n      uniform float uDetailStrength;' +
        '\n      uniform float uDetailTile;';
  // Same appended-string shape, same reason: an unshadowed shader must not merely fail to USE
  // these, it must not declare them.
  const shadowUniformDecls =
    (opts.shadow !== undefined
      ? '\n      uniform sampler2D uShadowTex;' + '\n      uniform vec4 uShadowRect;'
      : '') +
    (opts.shadowAtlas !== undefined
      ? '\n      uniform sampler2D uShadowTex;' + '\n      uniform vec2 uShadowAtlasScale;'
      : '');
  // The atlas is the ONLY form that needs anything from the VERTEX stage, and every one of these
  // is empty for the other two — so an unshadowed shader and a rect-shadowed one both stay
  // byte-identical to the ones every committed figure was taken against.
  const atlased = opts.shadowAtlas !== undefined;
  const atlasAttribute = atlased ? `\n      attribute vec2 ${GROUND_ATLAS_ATTRIBUTE};` : '';
  const atlasVarying = atlased ? '\n      varying vec2 vAtlasOrigin;' : '';
  const atlasAssign = atlased
    ? '\n        // The island\'s tile corner rides through the interpolator. All three vertices of' +
      '\n        // a triangle belong to one island and carry the same corner, so the interpolated' +
      '\n        // value is that corner exactly — the same argument vStatus above makes.' +
      `\n        vAtlasOrigin = ${GROUND_ATLAS_ATTRIBUTE};`
    : '';
  // LAYER 6, APPENDED TO THE NORMAL'S OWN LINE and therefore BEFORE the grain-normal stage —
  // the recipe's order (NormalMap → Bump, build_land.py:958-965), so the grain relieves an
  // already-detailed normal. It starts with its own newline and ends without one, so the line it
  // rides on joins to the grain stage exactly as it did when the layer was absent.
  // THE GEOMETRIC NORMAL, CAPTURED BEFORE ANY BUMP TOUCHES IT — layer 4's only input, emitted
  // ONLY when there is a rock layer so a rock-less shader stays byte-identical.
  const rockGeoCapture =
    rock === undefined
      ? ''
      : `
        // THE SURFACE'S OWN NORMAL, TAKEN BEFORE THE DETAIL MAP AND THE GRAIN — the slope mask
        // below reads THIS and never \`n\`. Cycles feeds the rock ramp \`Geometry.Normal\`, which is
        // evaluated before the normal map and the bump (build_land.py:912-925), and a mask fed the
        // BUMPED normal answers a different question: not "is this ground steep" but "did a texel
        // of a 128-texel cliff map tilt this fragment". See land-rock.ts for what that cost.
        vec3 geoN = n;`;
  const detailStage =
    detail === undefined
      ? ''
      : `
        // LAYER 6 — the cliff normal map as DETAIL RELIEF (build_land.py:943-965), applied
        // BEFORE the grain's bump: the recipe's own order is NormalMap → Bump, so the grain
        // relieves an already-detailed normal rather than the other way round.
        //
        // ⚠ AN ANALYTIC WORLD-SPACE TANGENT FRAME, not a mesh tangent attribute: on a ground
        // plane T is +x and B is +z, and the map is sampled in ground units through vWorld.xz,
        // so this frame is the one the tiling is authored in. The mesh carries no tangents, and
        // deriving them per triangle would cost an attribute for a frame the ground implies.
        //
        // ⚠ THE STRENGTH AND THE TILE ARE UNIFORMS: the recipe's 0.30 and 2.4 are provenance,
        // and the shipped values are chosen from a rendered ladder (ADR-0503) on ONE shader.
        vec3 detailN = texture2D(uDetailTex, vWorld.xz / uDetailTile).xyz * 2.0 - 1.0;
        vec3 detailT = normalize(cross(n, vec3(0.0, 0.0, 1.0)));
        vec3 detailB = cross(detailT, n);
        n = normalize(n + uDetailStrength * (detailN.x * detailT + detailN.y * detailB));`;
  const grainNormalStage = grainNormal
    ? `        // THE GRAIN'S NORMAL HALF — the palette-safe one, and the only one the shipped
        // ground wears. The linearised heightfield normal: a displacement h(x,z) has normal
        // normalize(vec3(-dh/dx, 1, -dh/dz)), so subtracting the gradient from an arbitrary
        // normal is that construction on a surface that is not already flat — which the
        // relief'd land is not.
        //
        // It runs BEFORE the lambert and therefore before the quantiser, so it can only move a
        // fragment between AUTHORED RUNGS of its own token's ramp. That is what keeps the
        // closure, and it is also this half's ceiling: on a four-rung ladder the delivered
        // grain is a stipple between two authored colours rather than the continuous
        // micro-variation Cycles delivers. See land-grain.ts.
        vec2 gradient = st_grainGradient(vWorld.xz);
        n = normalize(n - uGrainNormalStrength * vec3(gradient.x, 0.0, gradient.y));
`
    : '';
  // THE PAINT LINE — the one seam layer 1 enters through, in its two shapes. Without the wheat it
  // is the grass line, BYTE FOR BYTE what it was before the wheat existed. With the wheat it is
  // the same seam carrying both painted layers: the wheat's gate is declared beside the grass's,
  // `st_paintColour` returns the grass on a grass row and the wheat on a wheat row (the fields run
  // ONCE), the factor is each layer's own, and the wheat's gate is then promoted into the grass
  // gate so the sand, the path and the rock below composite over the wheat exactly as over the
  // grass — the stack, not one layer of it. Every line the sand, wear and rock stages emit is
  // untouched by that promotion, which is what keeps their goldens standing.
  // ⚠ NOT GATED ON `grass` HERE: it is spliced only inside `grassStage`, which is empty without the
  // grass, so a grass-less paint line is computed and never emitted — a condition on it would be a
  // branch no material can observe.
  // ⚠⚠ THE BLIGHT'S OWN LINE, AND WHY IT IS A SECOND `mix` RATHER THAN A THIRD TERM IN
  // `st_paintColour`. The grass and the wheat share one combiner because they are ONE treatment on
  // two palettes and the layers above ride both. The blight is neither: its gate is deliberately
  // NOT promoted into `grassGate` (that absence is what drops the shore sand, the worn path and
  // the slope rock from an unhealthy island — `land-blight.ts` carries the three arguments), so
  // folding it into the shared combiner would have bought nothing and would have moved every byte
  // of the wheat's emitted shader, retiring a golden this arc's own control arms stand on.
  // On a grass or wheat row `blightGate` is 0 and the mix is the identity.
  const blightLine =
    blight === undefined
      ? ''
      : `        // THE UNHEALTHY GROUND — layer 1 re-palettised onto the charred token and burned,
        // split by a crack network no other island wears (src/land-blight.ts), on its own row at
        // its own factor, through this same seam (ADR-0490 D5): a mix INTO the island's charcoal.
        ${gateGlsl('blightGate', blight.rows)}
        c = mix(c, st_blightColour(vWorld.xz) * level, uBlightMix * blightGate);
`;
  const paintLine =
    wheat === undefined
        ? '        c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);\n'
        : `        // THE WHEAT FIELD — layer 1 re-palettised onto the in-progress yellow (src/land-wheat.ts),
        // on its own rows at its own factor, through this same seam (ADR-0490 D5): a mix INTO
        // the island's yellow, never a cover over it.
        ${gateGlsl('wheatGate', wheat.rows)}
        c = mix(c, st_paintColour(vWorld.xz, grassGate, wheatGate) * level, uGrassMix * grassGate + uWheatMix * wheatGate);
        // The layers above ride ONE painted gate: a wheat island wears the sand, the path and
        // the rock as a grass island does.
        grassGate = max(grassGate, wheatGate);
`;
  const paintStage = paintLine + blightLine;
  // LAYER 1, COMPOSITED BETWEEN THE RAMP SELECTION AND THE WRITE — which is the recipe's own
  // order and not merely a convenient place. In `mat_attribute()` the grass is the BASE and the
  // grain is applied LAST, over everything; here the base is the parcel's status colour, so the
  // grass mixes into that and the grain's colour half (when a comparison arm asks for it) mixes
  // over the result. Composing them the other way round would grain the status colour and then
  // paint grass over the grain, which is a different picture wearing the same two names.
  const grassStage =
    grass === undefined
      ? ''
      : `        // LAYER 1 — the grass base and its cool/warm hue drift (ADR-0490 D2 row 1),
        // transcribed from build_land.py:836-868 and generated by src/land-grass.ts.
        // ⚠ THIS IS THE LINE THAT LEAVES THE PALETTE. It is authorised by ADR-0490 D5, which
        // names this seam, and fenced by ADR-0489 D3's outcome test rather than by the closure.
        //
        // ⚠⚠ GATED PER TOKEN (ADR-0492 D1), AND THE GATE IS WHAT MAKES THE FACTOR ABOVE LEGAL.
        // Ungated, this layer has to hold the tightest token's ceiling — the yellow's 0.0095,
        // at which the maximum channel shift is under 1/255 and nothing moves. On the rows the
        // gate names, the same measurement admits 0.4065. Every other row multiplies the mix by
        // zero and delivers exactly the pixel it delivered before this layer existed.
        ${grassGateGlsl(grass.rows)}
${paintStage}${
  sand === undefined
    ? ''
    : `        // LAYER 2 — the shore sand, over layer 1 and masked to the beach (build_land.py:869-893).
        //
        // ⚠⚠ A SECOND SEAM RATHER THAN A BLEND INSIDE LAYER 1'S, AND THE DIFFERENCE IS THE WHOLE
        // REASON THIS LAYER CAN SHIP. The recipe blends sand and grass and mixes the result in
        // ONCE, which forces both layers through one factor — and one factor has one joint
        // ceiling, 0.235, BELOW the 0.32 layer 1 already ships at. Composited that way, adopting
        // the sand would have quietly dimmed the grass on the live map. Given its own factor the
        // sand is fenced on its own measurement (0.16 at layer 1's 0.32) and layer 1's delivered
        // pixel above is byte-identical to the one that ships today. ADR-0490 D5 names the SEAM,
        // not the arity: layer 5's grain already enters as a second mix over the result.
        //
        // ⚠ AND IT INHERITS THE PER-TOKEN GATE — grassGate again, not a gate of its own. An
        // ungated row multiplies the whole layer by zero, so the yellow, red, slate and grey
        // islands deliver exactly the pixel they delivered before this layer existed.
        //
        // ⚠ THE SHORE FIELD RIDES THE SHADOW ATLAS'S OWN COORDINATE. shUv is the tile corner plus
        // the scaled ground position; sampling a second packing here would be a second answer to
        // "where is this island" and every coast would belong to the wrong land.
        //
        // ⚠ AND THE TEXEL IS DECODED TO GROUND UNITS BEFORE THE RECIPE TOUCHES IT, through the
        // SAME width the field was built for. st_sandBand divides by BEACH + 0.9, an arithmetic in
        // ground units; a raw 0..1 texel would be the same expression meaning something else.
        float shoreUnits = texture2D(uShoreTex, shUv).r * uSandWidth;
        float sandBand = st_sandBand(vWorld.xz, shoreUnits, uSandWidth);
        c = mix(c, st_sandColour(vWorld.xz) * level, uSandMix * (1.0 - sandBand) * grassGate);
`
}`;
  // LAYER 3, APPENDED AFTER THE GRASS STAGE (which carries the sand when there is one), so the
  // path composites over the beach — the recipe's order. It is its own appended string rather
  // than a third branch inside the grass template so that a grassed-and-sanded shader is
  // byte-identical to the one every figure about layer 2 was taken against.
  const wearStage =
    wear === undefined
      ? ''
      : `        // LAYER 3 — the worn path (build_land.py:894-911), over the sand and gated like it.
        //
        // ⚠ ITS OWN SEAM AND ITS OWN FACTOR, for the reason the sand has one: a shared factor
        // has one joint ceiling, and the path's admissible strength is a measurement of its own
        // — a rung of the rendered ladder (ADR-0503), never a number inherited from the beach.
        //
        // ⚠ THE FIELD RIDES THE SHADOW ATLAS'S OWN COORDINATE, like the shore: one tile corner
        // on the mesh, one scale on the material, so the path cannot disagree with the shadow
        // about where an island sits.
        //
        // ⚠ AND THE TEXEL IS DECODED TO GROUND UNITS THROUGH THE SAME WIDTH THAT IS THE FALLOFF.
        // The field caps its distances at the width it was built for and st_wearOf reaches 0 at
        // exactly that width — one uniform, so a widened path cannot read a field that has
        // already flattened.
        //
        // ⚠ THE BREAK NOISE MULTIPLIES THE WEAR inside st_wearFactor (build_land.py:898): where
        // the wear is zero no noise can paint a path, which keeps the track where the field put
        // it — the opposite sense from the sand's additive edge.
        float wearUnits = texture2D(uWearTex, shUv).r * uWearWidth;
        float wear = st_wearFactor(vWorld.xz, st_wearOf(wearUnits, uWearWidth));
        c = mix(c, st_dirtColour(vWorld.xz) * level, uWearMix * wear * grassGate);
`;
  // LAYER 4, APPENDED AFTER THE WEAR STAGE: rock over the path, the recipe's order.
  const rockStage =
    rock === undefined
      ? ''
      : `        // LAYER 4 — rock on slope (build_land.py:912-925), over the path, driven by the
        // surface's own normal rather than by a noise (the recipe's own comment at :912).
        //
        // ⚠⚠ IT READS geoN, NOT n — the departure that fed this mask the BUMPED normal is
        // withdrawn (ADR-0553). n carries the detail map and the grain, and those two put grey
        // across the interior grass the owner asked to be rid of: the relief's own steepest
        // interior slope leaves an up-component of 0.910, above the 0.90 ceiling, so on the
        // GEOMETRY the interior mask is identically zero and only the shore fall is steep.
        //
        // ⚠ THE ENDS ARE UNIFORMS, NOT WRITTEN IN — which rungs the map wears is a ladder the
        // owner reads (ADR-0503), and a page comparing them compiles ONE shader.
        //
        // ⚠ GATED BY grassGate, so the skirt's authored rock rows — and every other ungated token
        // — are never repainted: an ungated row multiplies the whole layer by zero.
        float rockMask = st_rockMask(geoN.y, uRockLo, uRockHi);
        c = mix(c, st_rockColour(vWorld.xz) * level, uRockMix * rockMask * grassGate);
`;
  const writeColour = grainColour
    ? `        // THE GRAIN'S COLOUR HALF — the mechanism Cycles used, and the one that BREAKS THE
        // CLOSURE. Mixing anything into the delivered colour produces a value that is not an
        // authored ramp entry. It is measured off this surface rather than argued about:
        // harness/grain-status-reading.ts found the authored 0.13 walks the yellow at the two
        // darkest rungs into healthy's green, and 0.031 is the largest fac that does not. This
        // branch exists so a comparison can SHOW what holding the closure costs.
        vec3 grainCol = mix(${glslVec3(grainDark)}, ${glslVec3(grainLight)}, st_grainRamped(vWorld.xz));
        gl_FragColor = vec4(mix(c, grainCol, uGrainColourMix), 1.0);`
    : '        gl_FragColor = vec4(c, 1.0);';

  // WHICH RAMP ENTRY A FRAGMENT LANDS ON. Unshadowed, this is the one line it has always been,
  // byte for byte. Shadowed, the ladder has grown an entry, so the lit rung is REMAPPED into the
  // longer ladder and the occlusion field may then send it to the shadow rung.
  //
  // ⚠ ONE SHADOW RUNG, SO THE DECISION IS BINARY. That is not a simplification — it is what a
  // closed palette with a measured confusability ceiling leaves room for. A penumbra needs
  // INTERMEDIATE rungs, and every one of them costs palette entries and walks a status closer to
  // its neighbour: this palette's tightest reading margin is 3.0 weighted channel units already.
  const indexStage =
    ladder === null
      ? '        // +0.5 then truncate, rather than a bare cast: an interpolated float that arrives as' +
        '\n        // 1.9999998 for row 2 would otherwise select row 1 and report a foreign status.' +
        '\n        int idx = int(vStatus + 0.5) * ST_N_LEVELS + st_bandIndex(lambert);'
      : `${
          atlased
            ? `        // The atlas form: the island's own tile corner, plus the ground position
        // scaled into it. Two multiply-adds against the rect form's two subtract-multiplies —
        // the packing costs the fragment stage nothing, it costs a vec2 on the mesh.
        vec2 shUv = vAtlasOrigin + vec2(vWorld.x, vWorld.z) * uShadowAtlasScale;`
            : `        vec2 shUv = vec2((vWorld.x - uShadowRect.x) * uShadowRect.z,
                         (vWorld.z - uShadowRect.y) * uShadowRect.w);`
        }
        int rung = st_bandIndex(lambert);
        int lvl = 0;
        ${litRemapGlsl(ladder.litIndex)}
        // +0.5 then truncate, rather than a bare cast: an interpolated float that arrives as
        // 1.9999998 for row 2 would otherwise select row 1 and report a foreign status.
        int row = int(vStatus + 0.5);
        float occ = texture2D(uShadowTex, shUv).r;
        ${shadowOcclusionGlsl(ladder)}
        int idx = row * ${ladder.levels.length} + lvl;`;

  // THE LEVEL STAGE — the fragment's lighting rung as a scalar every colour layer multiplies its
  // colour by before its mix (see `levelSelectGlsl`). Keyed on the GRASS alone rather than on
  // "any layer": the sand, the dirt and the rock are each REFUSED above without the grass, so a
  // second condition here would be a branch no material can reach. The unshadowed form has no
  // `lvl` of its own (its index line reads `st_bandIndex` directly, and that line is pinned), so
  // it declares one; the shadowed form's `lvl` is the remapped-and-darkened one the ramp used,
  // which is exactly the rung a shadowed fragment's layers must wear.
  const levelStage =
    grass === undefined
      ? ''
      : (ladder === null ? '\n        int lvl = st_bandIndex(lambert);' : '') +
        '\n        ' +
        levelSelectGlsl(ladder === null ? lit : ladder.levels);

  return new ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute float ${GROUND_STATUS_ATTRIBUTE};${atlasAttribute}
      varying float vStatus;
      varying vec3 vNormal;${worldVarying}${atlasVarying}
      void main() {
        // The ramp ROW rides through the interpolator. All three vertices of a triangle carry
        // the same parcel's row, so the interpolated value is that row exactly — GLSL ES 1.0
        // has no flat qualifier and does not need one here.
        vStatus = ${GROUND_STATUS_ATTRIBUTE};
        // The normal reaches the fragment stage in WORLD space: the light is an authored world
        // direction, so shading in view space would swing the lighting whenever the camera
        // moved — which on a banded material means visible rungs sliding across static ground.
        vNormal = normalize(mat3(modelMatrix) * normal);${worldAssign}${atlasAssign}
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      ${bandGlsl(lit).split('\n').join('\n      ')}
${grainSource}${grassSource}${wheatSource}${blightSource}${sandSource}${wearSource}${rockSource}
      uniform vec3 uRamp[${ramp.length}];
      uniform vec3 uLightDir;${grainUniformDecls}${grassUniformDecls}${wheatUniformDecls}${blightUniformDecls}${sandUniformDecls}${wearUniformDecls}${rockUniformDecls}${detailUniformDecls}${shadowUniformDecls}
      varying float vStatus;
      varying vec3 vNormal;${worldVarying}${atlasVarying}

      void main() {
        vec3 n = normalize(vNormal);${rockGeoCapture}${detailStage}
${grainNormalStage}        // Half-lambert: wrapped so the terminator lands inside the ladder's range instead of
        // collapsing every back-facing pixel onto the darkest rung. Still a single scalar, so
        // the closure argument is untouched.
        float lambert = dot(n, normalize(uLightDir)) * 0.5 + 0.5;
${indexStage}${levelStage}
        ${rampSelectGlsl(ramp.length)}
${grassStage}${wearStage}${rockStage}${writeColour}
      }
    `,
  });
}
