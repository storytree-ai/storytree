import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseHex } from './shade-ladder.js';
import {
  LEAF_TINT_TOKEN,
  MIN_TINTABLE_CHANNEL,
  TINT_LUMA_TOLERANCE,
  leafTintGain,
  leafTintGainFor,
  luma,
  tintDeliveries,
  tintedMean,
} from './leaf-tint.js';
import type { Rgb } from './texture-convention.js';

/**
 * The kit's own foliage base-colour mean, as PR #1686 measured it off the delivered frame:
 * rgb(70,90,69). Used here as a REPRESENTATIVE map rather than as a pinned expectation — every
 * property below is a property of the arithmetic and holds for any map, which is why the sweep
 * at the bottom runs over a range of means rather than this one.
 */
const FOLIAGE_MEAN: Rgb = { r: 70, g: 90, b: 69 };

/**
 * THE SHIPPED CANVAS'S OWN TOKEN TABLES, read out of its source.
 *
 * ⚠⚠ RE-ASKED AGAINST THE SHIPPED TOKENS, NOT INHERITED FROM THE HARNESS'S. Before this module
 * crossed, these assertions bound `LEAF_TINT_TOKEN` to `harness/palette-band.ts`'s `STATUS_TOKENS`
 * / `TREE_TOKENS`. Those are a MIRROR of what `ForestWorldCanvas` draws, not the thing itself —
 * and the fourth crossing on this arc established that a derived constant carried across on the
 * harness's authority is unfounded even when the number turns out identical (`SHADOW_RUNG`, which
 * agreed at 0.77 and had to be re-derived to say so). A crown's tint is a claim about a
 * capability's proof state on the SHIPPED map; the tables that map draws from are the ones it has
 * to agree with.
 *
 * They agree today and that agreement is MEASURED here rather than assumed: it will move the day
 * either palette does, and this test is what says so.
 *
 * ⚠ Parsed rather than transcribed, for the reason `shipped-baseline.ts` gives: a fourth
 * uncheckable copy of the palette would be strictly worse than none.
 */
function canvasPalette(binding: string): Map<string, string> {
  const source = readFileSync(
    fileURLToPath(new URL('./ForestWorldCanvas.tsx', import.meta.url)),
    'utf8',
  );
  // Located by INDEX rather than by an interpolated RegExp: a binding name spliced into a pattern
  // is one stray metacharacter away from matching something else, and the failure would be a
  // palette silently read from the wrong table.
  const opens = `const ${binding}: ReadonlyMap<string, string> = new Map([`;
  const from = source.indexOf(opens);
  assert.notEqual(from, -1, `${binding} is no longer a ReadonlyMap literal in ForestWorldCanvas.tsx`);
  const to = source.indexOf(']);', from);
  assert.notEqual(to, -1, `${binding}'s literal is not closed`);
  const block = source.slice(from + opens.length, to);
  const out = new Map<string, string>();
  for (const [, key, hex] of block.matchAll(/\['([a-z]+)',\s*'(#[0-9a-f]{6})'\]/g)) {
    out.set(key!, hex!);
  }
  assert.ok(out.size >= 6, `${binding} parsed to ${out.size} entries — the parse, not the palette`);
  return out;
}

test('every declared tint is an EXISTING authored token, not a colour invented here', () => {
  // ⚠ ADR-0392 D5 / ADR-0398 D7: an art change may not decide a semantic question, and a crown's
  // colour is a claim about a capability's proof state. Three new hues authored in this file
  // would be exactly that. Both entries point at a table the SHIPPED map already draws from.
  const ground = canvasPalette('GROUND_COLOUR');
  const crown = canvasPalette('CROWN_COLOUR');
  assert.equal(LEAF_TINT_TOKEN.get('proposed'), ground.get('proposed'));
  assert.equal(LEAF_TINT_TOKEN.get('building'), ground.get('building'));
  assert.equal(LEAF_TINT_TOKEN.get('mapped'), crown.get('mapped'));
});

test('proposed and building share ONE token, because ADR-0462 holds them as one', () => {
  assert.equal(LEAF_TINT_TOKEN.get('proposed'), LEAF_TINT_TOKEN.get('building'));
  // And the SHIPPED ground table is where that sharing is decided — five colours over six states.
  const ground = canvasPalette('GROUND_COLOUR');
  assert.equal(ground.get('proposed'), ground.get('building'));
});

test('⚠ the palette parse can fail — it is not a regex that matches anything', () => {
  // NON-VACUITY. A parse that silently returned an empty map would make both tests above pass by
  // comparing `undefined` with `undefined`, which is the exact shape of a green check that
  // verified nothing. The floor inside `canvasPalette` is what refuses that; this proves the
  // floor binds, and that the two tables are genuinely DIFFERENT tables rather than one read twice.
  const ground = canvasPalette('GROUND_COLOUR');
  const crown = canvasPalette('CROWN_COLOUR');
  for (const status of ['healthy', 'mapped', 'building', 'proposed', 'unhealthy', 'unknown']) {
    assert.match(ground.get(status) ?? '', /^#[0-9a-f]{6}$/, `no ground token for ${status}`);
    assert.match(crown.get(status) ?? '', /^#[0-9a-f]{6}$/, `no crown token for ${status}`);
  }
  assert.notDeepEqual([...ground], [...crown], 'the two bindings parsed to the same table');
  assert.throws(() => canvasPalette('NO_SUCH_BINDING'), 'a missing binding parsed to something');
});

test('healthy and unhealthy declare NO tint, and that is the vocabulary rather than an omission', () => {
  // A green pine is the kit's own needles — the arm the owner looked at and approved — and a
  // bare dead trunk has no leaves at all. A tint that reproduced the asset's own colour would be
  // arithmetic pretending to be a decision.
  assert.equal(LEAF_TINT_TOKEN.has('healthy'), false);
  assert.equal(LEAF_TINT_TOKEN.has('unhealthy'), false);
  assert.equal(LEAF_TINT_TOKEN.has('unknown'), false);
  assert.equal(leafTintGainFor('healthy', FOLIAGE_MEAN), null);
});

// ------------------------------------------------------------------ the rotation itself

test('A TINT ROTATES HUE AND DOES NOT CHANGE VALUE — the whole rule, on every declared tint', () => {
  // ⚠⚠ THIS IS WHAT SEPARATES A DELIBERATE TINT FROM THE TRAP. `MeshStandardMaterial` delivers
  // `color x map`, and the failure `texture-convention.ts` exists to catch is a map coming out
  // about 3.5x dark and LOOKING LIKE A DELIBERATE ART DIRECTION. A tint is a second multiplier on
  // exactly those pixels. Holding the luminance means a tinted crown can never BE the dark
  // picture, so the two cases stay distinguishable by construction rather than by inspection.
  for (const delivery of tintDeliveries(FOLIAGE_MEAN)) {
    assert.ok(
      Math.abs(delivery.lumaRatio - 1) <= TINT_LUMA_TOLERANCE,
      `${delivery.status} delivers ${delivery.lumaRatio.toFixed(4)}x the map's own luminance`,
    );
  }
});

test('the delivered mean carries the TOKEN\'s chromaticity, not the map\'s', () => {
  // The other half: it must actually rotate. `gain * mapMean` is a scalar multiple of the token,
  // so every channel ratio matches the token's own.
  for (const delivery of tintDeliveries(FOLIAGE_MEAN)) {
    const token = parseHex(delivery.token);
    const scale = delivery.delivered.r / token.r;
    for (const c of ['r', 'g', 'b'] as const) {
      assert.ok(
        Math.abs(delivery.delivered[c] / token[c] - scale) < 1e-9,
        `${delivery.status} delivered a colour that is not the token's own hue`,
      );
    }
  }
});

test('the yellow tint really is yellower than the kit\'s green, and the brown browner', () => {
  // A rule that preserved value could in principle be satisfied by a gain of exactly 1. It is
  // not: both tints move the map's channel ORDER, which is what a reader sees.
  const green = FOLIAGE_MEAN;
  assert.ok(green.g > green.r, 'the fixture mean is not a green, so this test proves nothing');

  const yellow = tintDeliveries(green).find((d) => d.status === 'proposed')!.delivered;
  assert.ok(yellow.r > yellow.b * 1.5, 'the yellow crown is not warm');
  assert.ok(yellow.r > green.r, 'the yellow crown is no redder than the green it came from');

  const brown = tintDeliveries(green).find((d) => d.status === 'mapped')!.delivered;
  assert.ok(brown.r > brown.g && brown.g > brown.b, 'the mapped crown is not a yellowish brown');
});

test('the gain is exact arithmetic, checkable by hand', () => {
  // gain_c = token_c * luma(mapMean) / (luma(token) * mapMean_c). Recomputed here from the
  // definition rather than from the implementation, so a change to either is a two-place edit.
  const token = parseHex('#d8c069');
  const gain = leafTintGain(token, FOLIAGE_MEAN);
  const scale = luma(FOLIAGE_MEAN) / luma(token);
  for (const c of ['r', 'g', 'b'] as const) {
    assert.ok(Math.abs(gain[c] - (token[c] * scale) / FOLIAGE_MEAN[c]) < 1e-12);
  }
  assert.ok(Math.abs(luma(tintedMean(gain, FOLIAGE_MEAN)) - luma(FOLIAGE_MEAN)) < 1e-9);
});

test('the rule holds over a RANGE of maps, not only the one the kit happens to ship', () => {
  // The kit can be re-exported at another texture rung, or replaced. The claim is about the
  // arithmetic, so it is checked against a sweep rather than against one measured mean.
  for (let v = 10; v <= 200; v += 10) {
    for (const mean of [
      { r: v, g: v * 1.3, b: v * 0.98 },
      { r: v * 1.4, g: v, b: v * 0.6 },
      { r: v, g: v, b: v },
    ]) {
      for (const delivery of tintDeliveries(mean)) {
        assert.ok(
          Math.abs(delivery.lumaRatio - 1) <= TINT_LUMA_TOLERANCE,
          `${delivery.status} broke the rule at mean ${JSON.stringify(mean)}`,
        );
      }
    }
  }
});

test('IT REFUSES A MAP IT CANNOT ROTATE rather than delivering a clipped primary', () => {
  // ⚠ Fail-closed, the same shape `MIN_HYPOTHESIS_SEPARATION` takes in the colour guard. A
  // base-colour channel at or near zero sends its gain to infinity, and a gain of a thousand
  // delivers a saturated primary that looks like a decision.
  const token = parseHex('#d8c069');
  assert.throws(
    () => leafTintGain(token, { r: MIN_TINTABLE_CHANNEL - 0.01, g: 90, b: 69 }),
    /below 4/,
  );
  // ⚠ AND THE REFUSAL SAYS WHY, not just that. What it costs to get this wrong — a clipped
  // primary standing in for the token — is the whole reason the floor is there, and a message
  // that had lost that half would send a reader looking for a broken asset instead of a map this
  // arithmetic cannot rotate.
  assert.throws(
    () => leafTintGain(token, { r: MIN_TINTABLE_CHANNEL - 0.01, g: 90, b: 69 }),
    (e: Error) => {
      assert.match(e.message, /clipped primary rather than the token/);
      assert.match(e.message, /refuses rather than drawing a plausible wrong colour/);
      return true;
    },
  );
  assert.throws(() => leafTintGain(token, { r: 0, g: 0, b: 0 }), /no luminance/);
  assert.throws(() => leafTintGain({ r: 0, g: 0, b: 0 }, FOLIAGE_MEAN), /no luminance/);
  // And a map it CAN rotate is not refused — otherwise the refusal above proves nothing.
  assert.ok(leafTintGain(token, { r: MIN_TINTABLE_CHANNEL, g: 90, b: 69 }));
});

test('luma is the Rec709 weighting the rest of the harness measures with', () => {
  assert.ok(Math.abs(luma({ r: 255, g: 0, b: 0 }) - 0.2126 * 255) < 1e-9);
  assert.ok(Math.abs(luma({ r: 0, g: 255, b: 0 }) - 0.7152 * 255) < 1e-9);
  assert.ok(Math.abs(luma({ r: 0, g: 0, b: 255 }) - 0.0722 * 255) < 1e-9);
  assert.ok(Math.abs(luma({ r: 255, g: 255, b: 255 }) - 255) < 1e-9);
});

test('⚠ a base-colour channel too dark to tint is REFUSED, and the floor binds exactly', () => {
  // ⚠⚠ THE GAIN IS `token * scale / mapMean`, so a mapMean near zero answers an enormous gain and
  // the delivered channel CLIPS at 255 — a crown wearing a blown primary instead of the token,
  // which looks like a colour choice. `MIN_TINTABLE_CHANNEL` is where the run refuses instead, and
  // the boundary is asserted on both sides because a floor nothing tests is a floor that can move.
  const at = (b: number): Rgb => ({ r: 70, g: 90, b });
  assert.throws(
    () => leafTintGain(parseHex('#d8c069'), at(MIN_TINTABLE_CHANNEL - 0.01)),
    /below/,
    'a channel below the floor was tinted anyway',
  );
  assert.ok(leafTintGain(parseHex('#d8c069'), at(MIN_TINTABLE_CHANNEL)), 'the floor itself refused');
  // And the refusal names the number, so the failure says what to fix.
  assert.throws(() => leafTintGain(parseHex('#d8c069'), at(0)), /0\.00/);
});

test('a map with no luminance at all is refused before any per-channel gain', () => {
  // A black map has no hue to rotate. Dividing by its luminance answers Infinity for every
  // channel, and three would render that as pure white.
  assert.throws(() => leafTintGain(parseHex('#d8c069'), { r: 0, g: 0, b: 0 }), /no luminance/);
});
