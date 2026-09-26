// map-texels.test.ts — the base-colour mean a tint is rotated from, proved without a browser.
//
// ⚠⚠ WHY THE ARITHMETIC IS A SEPARATE FUNCTION. Reading a texture's texels needs a 2D canvas and
// therefore a browser; the arithmetic over them does not, and it is where every claim lives. Left
// inside the canvas read, this module was 65 mutants nothing could reach and `check:mutation-diff`
// said so. The remedy was not a better browser fixture — the subject of the assertions was never
// the canvas.

import assert from 'node:assert/strict';
import test from 'node:test';

import { decodedSize, mapMeans, meansOverTexels, texelMeans } from './map-texels.js';
import type { DecodedMap, TexelCanvas, TexelContext } from './map-texels.js';
import { OPAQUE_TEXEL_CUT, srgbToLinearUnit } from './texture-convention.js';

/** RGBA bytes for a run of texels. */
function rgba(...texels: readonly (readonly [number, number, number, number])[]): Uint8ClampedArray {
  return Uint8ClampedArray.from(texels.flat());
}

test('the raw mean is the mean of the solid texels, per channel', () => {
  // ⚠ THREE CHANNELS WITH THREE DIFFERENT ANSWERS. A fixture whose channels agreed would pass for
  // an implementation that computed one of them and copied it into the other two.
  const means = texelMeans(rgba([10, 40, 90, 255], [30, 80, 150, 255]));
  assert.equal(means.raw.r, 20);
  assert.equal(means.raw.g, 60);
  assert.equal(means.raw.b, 120);
  assert.equal(means.opaque, 2);
});

test('⚠ the linear mean is mean(srgb_to_linear(texel)), NOT srgb_to_linear(mean(texel))', () => {
  // ⚠⚠ THE CURVE IS CONVEX, so those two differ — and predicting with the wrong one leaves a
  // systematic error that a tolerance then has to absorb. A tolerance absorbing a modelling error
  // has stopped discriminating. Both are computed here so the assertion is that the RIGHT one was
  // taken, rather than that some plausible number came out.
  const lo = 10;
  const hi = 240;
  const means = texelMeans(rgba([lo, lo, lo, 255], [hi, hi, hi, 255]));
  const perTexel = (srgbToLinearUnit(lo / 255) * 255 + srgbToLinearUnit(hi / 255) * 255) / 2;
  const ofTheMean = srgbToLinearUnit((lo + hi) / 2 / 255) * 255;
  assert.ok(Math.abs(means.linear.r - perTexel) < 1e-9, 'the linear mean is not per-texel');
  assert.ok(Math.abs(perTexel - ofTheMean) > 1, 'the fixture does not separate the two readings');
});


test('the linear mean DIVIDES by the count, on every channel', () => {
  // ⚠ THREE CHANNELS WITH THREE DIFFERENT SUMS AND MORE THAN ONE TEXEL. With a single texel a
  // divide and a multiply by the count agree, and with equal channels an implementation that
  // computed one and copied it agrees too — so the fixture has to break both at once.
  const means = texelMeans(rgba([10, 60, 200, 255], [30, 100, 240, 255], [20, 80, 220, 255]));
  const lin = (a: number, b: number, c: number): number =>
    (srgbToLinearUnit(a / 255) + srgbToLinearUnit(b / 255) + srgbToLinearUnit(c / 255)) * (255 / 3);
  assert.ok(Math.abs(means.linear.r - lin(10, 30, 20)) < 1e-9, `r ${means.linear.r}`);
  assert.ok(Math.abs(means.linear.g - lin(60, 100, 80)) < 1e-9, `g ${means.linear.g}`);
  assert.ok(Math.abs(means.linear.b - lin(200, 240, 220)) < 1e-9, `b ${means.linear.b}`);
  assert.equal(means.opaque, 3);
});

test('⚠ ONLY FULLY OPAQUE TEXELS COUNT, and the cut is exactly where it is declared', () => {
  // ⚠⚠ TWO THINGS BREAK ON A CUT-OUT MAP, and the first produced a wrong answer before this
  // existed. `getImageData` un-premultiplies, so an alpha-0 texel comes back BLACK whatever colour
  // the GPU samples there; and a partly transparent texel is blended against whatever is behind
  // it, so its delivered colour is not its own. Cutting at fully-opaque removes both, and makes
  // the source mean and the delivered mean means of the SAME set.
  const means = texelMeans(
    rgba(
      [200, 200, 200, 255],
      [0, 0, 0, 0], // the un-premultiplied black that dragged a mean to rgb(30,38,29)
      [0, 0, 0, OPAQUE_TEXEL_CUT - 1],
      [200, 200, 200, OPAQUE_TEXEL_CUT],
    ),
  );
  assert.equal(means.opaque, 2, 'a texel below the cut was counted');
  assert.equal(means.raw.r, 200, 'a transparent texel reached the mean');
});

test('a map with no solid texels at all is refused, not averaged over zero', () => {
  // Dividing by zero here answers `NaN` for every channel, and a `NaN` gain paints a crown black
  // in a way that looks like an art direction.
  assert.throws(() => texelMeans(rgba([9, 9, 9, 0])), /no solid texels/);
  assert.throws(() => texelMeans(new Uint8ClampedArray(0)), /no solid texels/);
});

test('the alpha channel is read at offset 3 — the stride is not off by one', () => {
  // ⚠ An implementation reading alpha at +2 (or colour at +1) passes every test whose fixture is
  // grey or whose alphas are all 255. This one is neither: the texel that must be DROPPED has a
  // distinctive blue, so if the stride slipped the mean would carry it.
  const means = texelMeans(rgba([10, 20, 30, 255], [0, 0, 255, 0]));
  assert.deepEqual(means.raw, { r: 10, g: 20, b: 30 });
  assert.equal(means.opaque, 1);
});

test('a single opaque texel is its own mean, in both readings', () => {
  const means = texelMeans(rgba([70, 90, 69, 255]));
  assert.deepEqual(means.raw, { r: 70, g: 90, b: 69 });
  assert.ok(Math.abs(means.linear.r - srgbToLinearUnit(70 / 255) * 255) < 1e-9);
  assert.ok(Math.abs(means.linear.g - srgbToLinearUnit(90 / 255) * 255) < 1e-9);
  assert.ok(Math.abs(means.linear.b - srgbToLinearUnit(69 / 255) * 255) < 1e-9);
});

test('the linear reading is DARKER than the raw one — the curve runs the right way', () => {
  // NON-VACUITY on the transfer function itself. `srgb_to_linear` of a mid grey is well below it;
  // an implementation that applied the INVERSE curve would still produce two different numbers and
  // satisfy every equality above, because those compare against the same function.
  const means = texelMeans(rgba([128, 128, 128, 255]));
  assert.ok(means.linear.r < means.raw.r * 0.6, `linear ${means.linear.r} vs raw ${means.raw.r}`);
});

test('every texel is visited — the stride does not skip or double-count', () => {
  // A stride bug that read every EIGHTH byte would halve the count and change the mean; one that
  // read every byte would quadruple it. The count is asserted alongside the mean so both
  // directions are closed.
  const many = Array.from({ length: 16 }, (_, i) => [i * 4, 0, 0, 255] as const);
  const means = texelMeans(rgba(...many));
  assert.equal(means.opaque, 16);
  assert.equal(means.raw.r, (0 + 15) * 4 / 2);
});

// ---------------------------------------------------------------------------
// the decoded size, and the readback the canvas seam makes provable
// ---------------------------------------------------------------------------

test('a map that never decoded is REFUSED by its size, not defaulted to zero', () => {
  // ⚠ A zero-sized read returns an empty buffer, and `texelMeans` would then refuse it as "no
  // solid texels" — naming the wrong fault. The true one is that the image never decoded, which
  // is what a headless run of the real loader hits.
  assert.throws(() => decodedSize({}), /no decoded pixels/);
  assert.throws(() => decodedSize({ width: 8 }), /no decoded pixels/);
  assert.throws(() => decodedSize({ width: 8, height: 0 }), /no decoded pixels/);
  assert.throws(() => decodedSize({ width: 0, height: 8 }), /no decoded pixels/);
  assert.deepEqual(decodedSize({ width: 8, height: 3 }), { width: 8, height: 3 });
});

test('the opaque FRACTION is over the whole map, not over the texels that counted', () => {
  // ⚠ `opaque / (width * height)` and not `opaque / opaque`. Half of a 2x2 map solid is 0.5, and
  // an implementation dividing by the count would answer 1 for every map ever read — a number
  // that always says "fully opaque" is the shape of a check that cannot fail.
  const data = rgba([10, 20, 30, 255], [50, 60, 70, 255], [0, 0, 0, 0], [0, 0, 0, 0]);
  const means = meansOverTexels(data, 2, 2);
  assert.equal(means.opaqueFraction, 0.5);
  assert.equal(means.width, 2);
  assert.equal(means.height, 2);
  assert.equal(means.raw.r, 30);
  // The dimensions are carried through as given, not re-derived from the buffer's length.
  assert.equal(meansOverTexels(data, 4, 1).opaqueFraction, 0.5);
});

/** A canvas double and the log of what the readback asked it for. */
interface CanvasDouble {
  canvas: TexelCanvas;
  log: string[];
}

/**
 * A decoded image stand-in.
 *
 * ⚠ ONE HOP THROUGH `unknown`, DELIBERATELY, AND IT IS NOT HIDING ANYTHING. `DecodedMap` is
 * `CanvasImageSource`, a union of six browser classes none of which node has — and the readback
 * only ever asks this for its DIMENSIONS before handing it to `drawImage`, which the double below
 * records rather than executes. There is no narrower type that says that.
 */
function decodedImage(size: { width?: number; height?: number }): DecodedMap {
  return size as DecodedMap;
}

/** A canvas double: it records what it was asked for and answers a buffer of known texels. */
function fakeCanvas(data: Uint8ClampedArray, over: { context?: null } = {}): CanvasDouble {
  const log: string[] = [];
  const ctx: TexelContext = {
    drawImage: (_image, dx, dy) => log.push(`draw ${dx},${dy}`),
    getImageData: (sx, sy, sw, sh) => {
      log.push(`read ${sx},${sy},${sw},${sh}`);
      return { data };
    },
  };
  const canvas: TexelCanvas = {
    width: -1,
    height: -1,
    getContext: (id, opts) => {
      log.push(`context ${id} willReadFrequently=${opts.willReadFrequently}`);
      return over.context === null ? null : ctx;
    },
  };
  return { canvas, log };
}

test('the readback sizes the canvas to the MAP’s dimensions and reads all of it back', () => {
  // ⚠⚠ THE CANVAS IS THE ONLY BROWSER-BOUND PART, AND THE CLAIMS AROUND IT ARE NOT. A canvas left
  // at its default 300x150 would silently crop a 1024-wide foliage map to its top-left corner and
  // deliver a mean of whatever happened to be there — a perfectly ordinary-looking wrong colour.
  const data = rgba([12, 34, 56, 255], [12, 34, 56, 255]);
  const { canvas, log } = fakeCanvas(data);
  const means = mapMeans(decodedImage({ width: 2, height: 1 }), () => canvas);
  assert.equal(canvas.width, 2);
  assert.equal(canvas.height, 1);
  assert.deepEqual(log, ['context 2d willReadFrequently=true', 'draw 0,0', 'read 0,0,2,1']);
  assert.equal(means.raw.r, 12);
  assert.equal(means.raw.g, 34);
  assert.equal(means.raw.b, 56);
  assert.equal(means.opaqueFraction, 1);
});

test('a surface with no 2d context is refused rather than read as an empty map', () => {
  const { canvas } = fakeCanvas(rgba([1, 2, 3, 255]), { context: null });
  assert.throws(
    () => mapMeans(decodedImage({ width: 1, height: 1 }), () => canvas),
    /no 2d context/,
  );
});

test('the size is checked BEFORE a canvas is asked for at all', () => {
  // An undecoded image must not reach `drawImage` — it is the refusal above, and the order is what
  // keeps the message about the image rather than about the surface.
  const { canvas, log } = fakeCanvas(rgba([1, 2, 3, 255]));
  assert.throws(() => mapMeans(decodedImage({}), () => canvas), /no decoded pixels/);
  assert.deepEqual(log, []);
});
