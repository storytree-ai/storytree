/** Capability 5 · Claims: contract 5.39, a claim's mark is one shape and one colour wherever it is drawn. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { pennantOutline, quietColour, quietHsl, sessionColour } from "./claim-mark.js";

test("5.39 a quiet holder's colour is a third less saturated and four points darker, on a session's colour or on plain numbers", () => {
  assert.match(sessionColour("session-1"), /^hsl\(\d+, 80%, 68%\)$/, "the form quietColour reads");
  assert.equal(quietColour("hsl(200, 80%, 68%)", 0), "hsl(200, 80%, 68%)");
  assert.equal(quietColour("hsl(200, 80%, 68%)", 1), "hsl(200, 53.33%, 64%)");
  const half = quietHsl({ h: 0.5, s: 0.6, l: 0.02 }, 1);
  assert.deepEqual([half.h, Number(half.s.toFixed(4)), half.l], [0.5, 0.4, 0], "lightness never goes below zero");
});

test("5.39 the pennant runs from the pole's top out to its tip and back, and a quiet one furls narrower and droops", () => {
  const held = pennantOutline(1, 0), quiet = pennantOutline(1, 1);
  assert.deepEqual(held[0], [0.6, 26], "it starts at the pole's top");
  const widest = (outline: readonly (readonly [number, number])[]) => outline.reduce((best, point) => point[0] > best[0] ? point : best);
  assert.deepEqual(widest(held), [17, 20], "its tip is 17 out, half its 12 down");
  assert.ok(Math.abs(widest(quiet)[0] - 17 * 0.42) < 1e-9, "furled to 0.42 of its width");
  assert.ok(widest(quiet)[1] < widest(held)[1], "drooped");
  assert.deepEqual(pennantOutline(0.5, 0)[0], [0.3, 13], "it scales with k");
});
