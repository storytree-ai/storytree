// map-texels.ts — READ A DECODED BASE-COLOUR MAP'S OWN TEXELS, over its solid ones only.
//
// ⚠ CROSSED INTO `src/` ON 2026-08-30, whole, with the bought kit. A tinted crown needs its map's
// own mean, and the mean has to be read from the ASSET's decoded texels rather than from the
// delivered frame — an expectation derived from its own subject cannot fail. `harness/` re-exports
// it so the experiment and the product read one mean by one arithmetic.
//
// Extracted from `colour-convention-scene.ts` when a SECOND caller needed the same number:
// `kit-scene.ts` derives a leaf tint's gain from the map's own mean (`leaf-tint.ts`), and the
// colour guard judges delivered pixels against it. Two copies of this loop would agree today and
// disagree the first time either one's opaque cut moved — and the whole point of the cut is that
// the source mean and the delivered mean are means of the SAME SET of texels.
//
// ⚠ ONLY FULLY OPAQUE TEXELS, AND THIS IS NOT A DETAIL. Reading a map's texels means drawing it
// into a 2D canvas, and `getImageData` un-premultiplies — so every texel with alpha 0 comes back
// BLACK whatever its real colour is, while the GPU samples that colour perfectly happily. On the
// pine's foliage map that dragged the JavaScript mean to rgb(30,38,29) against a frame delivering
// rgb(72,91,71): a real disagreement, about the wrong thing.

import { OPAQUE_TEXEL_CUT, srgbToLinearUnit } from './texture-convention.js';
import type { Rgb } from './texture-convention.js';

/** A decoded texture image, in the one shape both the 2D canvas and three's loaders answer. */
export type DecodedMap = CanvasImageSource & { width?: number; height?: number };

/** What one decoded base-colour map is, measured over its solid texels only. */
export interface MapMeans {
  raw: Rgb;
  linear: Rgb;
  width: number;
  height: number;
  opaqueFraction: number;
}

/** RGBA bytes, in the one shape a canvas readback and a hand-built fixture both answer.
 *
 *  ⚠ ITS OWN KEY ITERATOR IS PART OF THE CONTRACT. The means are taken over `data.keys()` rather
 *  than over a counter, because a `for (let i = 0; i < n; i += 4)` carries mutants that flip `+=`
 *  to `-=` and `<` to `>` — neither fails an assertion, both run forever, and the mutation rung
 *  scores a hang as unproven. */
export type TexelBuffer = ArrayLike<number> & { keys(): IterableIterator<number> };

/** What a run of texels averages to, raw and linearised, and how many of them counted. */
export interface TexelMeans {
  raw: Rgb;
  linear: Rgb;
  /** How many texels passed the opaque cut — a COUNT, which {@link MapMeans} turns into a
   *  fraction of the whole map. */
  opaque: number;
}

/** A decoded map's own pixel dimensions. */
export interface DecodedSize {
  width: number;
  height: number;
}

/**
 * ⚠ BOTH MEANS ARE COMPUTED FROM THE SAME TEXELS IN THE SAME PASS. The linearised one is
 * `mean(srgb_to_linear(texel))` and NOT `srgb_to_linear(mean(texel))` — the curve is convex, so
 * those differ, and predicting with the wrong one leaves a systematic error that a tolerance
 * would then have to absorb. A tolerance absorbing a modelling error has stopped discriminating.
 */
/**
 * THE MEANS THEMSELVES — the arithmetic, over raw RGBA bytes, with no canvas anywhere.
 *
 * ⚠⚠ EXTRACTED FROM {@link mapMeans} SO IT CAN BE PROVED. Reading a texture's texels needs a 2D
 * canvas and therefore a browser; the arithmetic over them does not, and it is where every claim
 * lives — which mean is which, that only solid texels count, and what "no solid texels at all"
 * does. Left inside the canvas read it was 65 mutants nothing could reach, and
 * `check:mutation-diff` said so. The remedy is not a better browser fixture: it is that the
 * subject of the assertions was never the canvas.
 *
 * ⚠ IT ITERATES `data.keys()` RATHER THAN A COUNTER. A `for (let i = 0; i < n; i += 4)` carries
 * mutants that flip `+=` to `-=` and `<` to `>`; neither fails an assertion, both run forever, and
 * the rung scores a hang UNPROVEN — credited to nobody. A typed array's own key iterator has
 * nothing to mutate into one.
 */
export function texelMeans(data: TexelBuffer): TexelMeans {
  let rr = 0;
  let gg = 0;
  let bb = 0;
  let lr = 0;
  let lg = 0;
  let lb = 0;
  let n = 0;
  for (const i of data.keys()) {
    if (i % 4 !== 0) continue;
    if (data[i + 3]! < OPAQUE_TEXEL_CUT) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    rr += r;
    gg += g;
    bb += b;
    lr += srgbToLinearUnit(r / 255) * 255;
    lg += srgbToLinearUnit(g / 255) * 255;
    lb += srgbToLinearUnit(b / 255) * 255;
    n += 1;
  }
  if (n === 0) throw new Error('map-texels: a map has no solid texels at all');
  return {
    raw: { r: rr / n, g: gg / n, b: bb / n },
    linear: { r: lr / n, g: lg / n, b: lb / n },
    opaque: n,
  };
}

/**
 * A DECODED MAP'S OWN PIXEL DIMENSIONS — refused when it has none, never defaulted.
 *
 * ⚠ THE REFUSAL IS THE POINT. A texture whose image never decoded answers `undefined` for both,
 * and a zero-sized read returns an empty buffer — which {@link texelMeans} would then refuse as
 * "no solid texels", naming the wrong fault. This says the true one, and it is arithmetic rather
 * than canvas work, so it is proved here rather than only in a browser.
 */
export function decodedSize(image: { width?: number; height?: number }): DecodedSize {
  const width = Number(image.width ?? 0);
  const height = Number(image.height ?? 0);
  if (!(width > 0 && height > 0)) throw new Error('map-texels: a map has no decoded pixels');
  return { width, height };
}

/** {@link MapMeans} over an already-read texel buffer of known dimensions — the whole answer,
 *  assembled, with the opaque COUNT turned into the fraction a caller reads. */
export function meansOverTexels(data: TexelBuffer, width: number, height: number): MapMeans {
  const means = texelMeans(data);
  return {
    raw: means.raw,
    linear: means.linear,
    width,
    height,
    opaqueFraction: means.opaque / (width * height),
  };
}

/** The 2D drawing surface a decoded map's texels are read back through. */
export interface TexelContext {
  drawImage(image: DecodedMap, dx: number, dy: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
}

/** A canvas that surface is got from — sized before it is drawn into. */
export interface TexelCanvas {
  width: number;
  height: number;
  getContext(id: '2d', opts: { willReadFrequently: boolean }): TexelContext | null;
}

/** Where that canvas comes from: the document in a browser, a double in a test.
 *
 *  ⚠⚠ A SEAM, NOT INDIRECTION, AND IT NAMES THE ACTUAL BROWSER-BOUND PART. What needs a browser
 *  here is DECODING an image; sizing a canvas to the map's own dimensions, asking for a readback
 *  context, drawing at the origin and refusing a surface that has none are all claims about this
 *  module and none of them need one. Left behind `document` they were mutants nothing could
 *  reach — the same finding that pulled {@link texelMeans} out of the read above it. */
export type TexelCanvasFactory = () => TexelCanvas;

// Stryker disable next-line all: UNWITNESSABLE, and this is the one line in the module that is.
// It is the module's ONLY DOM access and it cannot execute outside a browser, so no test can kill a
// mutant in it — which is exactly why the factory is a parameter: everything ABOUT the readback
// (that the canvas is sized to the map's own dimensions, that a readback context is asked for, that
// the image is drawn at the origin, that a surface with no context is refused) is proved through the
// seam in `map-texels.test.ts`. Its own delivery is proved on a real GPU by the colour guard.
const domCanvas: TexelCanvasFactory = () => document.createElement('canvas');

/**
 * Draw a decoded texture image into a 2D canvas and answer its raw and linearised means.
 *
 * ⚠ THE ARITHMETIC IS {@link texelMeans}'S and the assembly is {@link meansOverTexels}'S. What is
 * left here is the READBACK — get the texels out of a decoded image — and it is the only part of
 * this module that depends on where the canvas came from.
 */
export function mapMeans(image: DecodedMap, canvasFor: TexelCanvasFactory = domCanvas): MapMeans {
  const { width, height } = decodedSize(image);

  const canvas = canvasFor();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('map-texels: no 2d context to read a map with');
  ctx.drawImage(image, 0, 0);
  return meansOverTexels(ctx.getImageData(0, 0, width, height).data, width, height);
}
