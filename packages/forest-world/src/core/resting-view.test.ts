// resting-view.test.ts — the designed resting frame, held to its own stated composition.
//
// ⚠ EVERY EXPECTATION HERE IS DERIVED INDEPENDENTLY OF THE MODULE UNDER TEST, from the
// composition sentence rather than from `restingFrame`'s own arithmetic. That is deliberate and it
// is the fault class this repo keeps hitting: an expectation computed from its subject vanishes at
// exactly the moment the thing it guards does (`an-expectation-derived-from-its-subject-cannot-
// fail`). The one thing read back off the module is `RESTING_ISLAND_SPANS` itself — because the
// constant IS the decision, and a test that hard-coded 9 would fail on an owner look that moved it
// rather than on a regression. Its VALUE is bounded separately below so that reading it back
// cannot go vacuous.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_EXTENT_SHOWN,
  RESTING_ISLAND_SPANS,
  restingFrame,
  type RestingFrameInput,
} from './resting-view.js';

/** The live 35-story corpus, measured 2026-08-28 (`web/src/data/forest-snapshot.json` through
 *  `placeStories`/`frameFor`): a portrait forest, median island 196 units across. Frozen here as a
 *  FIXTURE rather than re-derived, so this suite stays pure and credential-free — and so a change
 *  to the corpus cannot silently move what these assertions mean. */
const CORPUS: Omit<RestingFrameInput, 'frameWidth' | 'frameHeight'> = {
  islandDiameters: [154.4, 196, 196, 196, 196, 366.2],
  contentWidth: 3238,
  contentHeight: 4005,
};
const MEDIAN_ISLAND = 196;

const laptop = (over: Partial<RestingFrameInput> = {}): RestingFrameInput => ({
  ...CORPUS,
  frameWidth: 1600,
  frameHeight: 900,
  ...over,
});

test('the composition constants — states a resting span that is neither the whole world nor a single island', () => {
  // A non-vacuity guard on the value the assertions below read back. Outside this band the
  // constant would not be a composition at all: below ~3 the frame holds one island and its
  // neighbours' edges, above ~30 it is a fit by another name on any corpus this project will
  // have. It is deliberately WIDE — it exists to stop the constant going to zero or infinity
  // unnoticed, not to second-guess an owner look inside the band.
  assert.ok(RESTING_ISLAND_SPANS > 3, `RESTING_ISLAND_SPANS=${RESTING_ISLAND_SPANS} is too tight to read as a forest`);
  assert.ok(RESTING_ISLAND_SPANS < 30, `RESTING_ISLAND_SPANS=${RESTING_ISLAND_SPANS} is a fit by another name`);
});

test('the composition constants — keeps the extent floor a floor — strictly short of the whole world, and not a token crop', () => {
  assert.ok(MAX_EXTENT_SHOWN < 1, 'a floor of 1 would permit the fitted view it exists to forbid');
  assert.ok(MAX_EXTENT_SHOWN > 0.25, 'a floor this tight would be the rule, not a floor');
});

test('restingFrame — the designed composition — spans exactly RESTING_ISLAND_SPANS median islands on the frame’s shorter side', () => {
  const frame = restingFrame(laptop());
  // Derived from the composition SENTENCE: the short side shows N median islands, so the world
  // width the short side covers is N * island, and scale is px-per-world-unit.
  const shortSidePx = 900;
  const expected = shortSidePx / (RESTING_ISLAND_SPANS * MEDIAN_ISLAND);
  assert.ok(Math.abs(frame.scale - expected) < 1e-12, `scale ${frame.scale} != ${expected}`);
  assert.equal(frame.bound, 'designed');
});

test('restingFrame — the designed composition — delivers the stated island size, and it is a large multiple of what the fit delivered', () => {
  const frame = restingFrame(laptop());
  // The fitted view, computed here rather than asked of the module: contain the whole bbox.
  const fitScale = Math.min(1600 / 3238, 900 / 4005);
  const fittedIslandPx = MEDIAN_ISLAND * fitScale;

  assert.ok(Math.abs(frame.islandPx - MEDIAN_ISLAND * frame.scale) < 1e-9);
  assert.ok(
    frame.islandPx > 2 * fittedIslandPx,
    `designed island ${frame.islandPx.toFixed(1)}px is not a decisive gain on the fitted ${fittedIslandPx.toFixed(1)}px`,
  );
});

test('restingFrame — the designed composition — shows strictly less than the whole world, and says how much', () => {
  const frame = restingFrame(laptop());
  assert.ok(frame.extentShown < 1, 'a designed frame that shows everything has not cropped anything');
  assert.ok(frame.extentShown > 0, 'the frame shows nothing at all');
  // Independently derived from the returned scale: what fraction of each axis lands in frame.
  const shownW = Math.min(1, 1600 / (3238 * frame.scale));
  const shownH = Math.min(1, 900 / (4005 * frame.scale));
  assert.ok(Math.abs(frame.extentShown - shownW * shownH) < 1e-12);
});

test('restingFrame — the designed composition — is a CROP of a portrait forest, not a re-fit — it fills the frame’s width', () => {
  // The finding the whole increment answers: fitting a 3238x4005 world into a 1600x900 frame
  // leaves 55% of the frame empty, because the forest is portrait and the viewport is not.
  const fitScale = Math.min(1600 / 3238, 900 / 4005);
  const fittedFill = (3238 * fitScale * (4005 * fitScale)) / (1600 * 900);
  assert.ok(fittedFill < 0.5, `the fitted view is expected to waste the frame; it filled ${fittedFill}`);

  const frame = restingFrame(laptop());
  const drawnW = Math.min(1600, 3238 * frame.scale);
  const drawnH = Math.min(900, 4005 * frame.scale);
  const designedFill = (drawnW * drawnH) / (1600 * 900);
  assert.ok(
    designedFill > 0.9,
    `the designed frame should fill the frame it was designed for; it filled ${designedFill}`,
  );
});

test('restingFrame — the rules that bound it — shows a small world WHOLE rather than cropping it', () => {
  // One island, alone. The crop exists to imply there is more; here there is not, so cropping
  // would only hide what little there is. This is the case a flat `fit * 0.75` gets wrong.
  const frame = restingFrame({
    islandDiameters: [196],
    contentWidth: 400,
    contentHeight: 300,
    frameWidth: 1600,
    frameHeight: 900,
  });
  assert.equal(frame.bound, 'whole-world');
  assert.ok(frame.extentShown > 1 - 1e-9);
  const fitScale = Math.min(1600 / 400, 900 / 300);
  assert.ok(Math.abs(frame.scale - fitScale) < 1e-12);
});

test('restingFrame — the rules that bound it — applies the extent floor when the designed frame would show nearly everything', () => {
  // A world just larger than the designed frame: the legibility rule alone would open onto
  // almost all of it, so the floor tightens the view until something is out of frame.
  // Sized so the fit is between `designed` and `designed / MAX_EXTENT_SHOWN`.
  const shortSide = 900;
  const island = 196;
  const designed = shortSide / (RESTING_ISLAND_SPANS * island);
  const contentHeight = shortSide / (designed * 0.92); // fit is 0.92 of the designed scale
  const frame = restingFrame({
    islandDiameters: [island],
    contentWidth: 100,
    contentHeight,
    frameWidth: 1600,
    frameHeight: shortSide,
  });
  assert.equal(frame.bound, 'extent-floor');
  // The binding axis shows exactly MAX_EXTENT_SHOWN of the world — derived, not read back.
  const shownOnBindingAxis = shortSide / (contentHeight * frame.scale);
  assert.ok(
    Math.abs(shownOnBindingAxis - MAX_EXTENT_SHOWN) < 1e-9,
    `binding axis showed ${shownOnBindingAxis}, floor is ${MAX_EXTENT_SHOWN}`,
  );
});

test('restingFrame — the rules that bound it — never opens onto more of the binding axis than the floor allows, at any world size', () => {
  // The floor's whole job, swept rather than sampled: for every world from far smaller than the
  // designed frame to far larger, either the world is shown whole or the binding axis is cropped
  // to at most MAX_EXTENT_SHOWN. There is no third outcome, and no size that slips between.
  for (let h = 200; h <= 20000; h += 137) {
    const frame = restingFrame({
      islandDiameters: [196],
      contentWidth: 800,
      contentHeight: h,
      frameWidth: 1600,
      frameHeight: 900,
    });
    if (frame.bound === 'whole-world') {
      assert.ok(
        frame.extentShown > 1 - 1e-9,
        `h=${h} claimed whole-world but showed ${frame.extentShown}`,
      );
      continue;
    }
    const shownW = Math.min(1, 1600 / (800 * frame.scale));
    const shownH = Math.min(1, 900 / (h * frame.scale));
    assert.ok(
      Math.min(shownW, shownH) <= MAX_EXTENT_SHOWN + 1e-9,
      `h=${h} (${frame.bound}) showed ${Math.min(shownW, shownH)} of its binding axis`,
    );
  }
});

test('restingFrame — the rules that bound it — holds the same composition across viewports — the pixels adapt, the decision does not', () => {
  // A responsive framing is still designed when the adaptation IS the decision. The invariant
  // is that the short side always spans the same number of islands; what changes is how many
  // pixels that is.
  const sizes: [number, number][] = [[1600, 900], [1440, 800], [1280, 800], [390, 740]];
  for (const [w, h] of sizes) {
    const frame = restingFrame(laptop({ frameWidth: w, frameHeight: h }));
    const shortSide = Math.min(w, h);
    const spans = shortSide / (frame.scale * MEDIAN_ISLAND);
    assert.ok(
      Math.abs(spans - RESTING_ISLAND_SPANS) < 1e-9,
      `${w}x${h} spanned ${spans} islands, not ${RESTING_ISLAND_SPANS}`,
    );
  }
});

test('restingFrame — degenerate input is reported, never guessed — falls back to the fit and SAYS so when no island can be measured', () => {
  for (const islandDiameters of [[], [0, 0], [Number.NaN], [-40]]) {
    const frame = restingFrame(laptop({ islandDiameters }));
    assert.equal(frame.bound, 'undetermined', `${JSON.stringify(islandDiameters)} was not reported`);
    const fitScale = Math.min(1600 / 3238, 900 / 4005);
    assert.ok(Math.abs(frame.scale - fitScale) < 1e-12);
  }
});

test('restingFrame — degenerate input is reported, never guessed — ignores unusable island sizes rather than averaging them into the composition', () => {
  // A zero-radius or NaN island is missing data, not a small island. Folding it in would drag
  // the composition toward a size no island actually has. The fixture is chosen so that KEEPING
  // the junk would change the answer: five real islands median 300, and four junk entries which,
  // if counted, would drag the median down to 200.
  const clean = restingFrame(laptop({ islandDiameters: [100, 200, 300, 400, 500] }));
  const dirty = restingFrame(
    laptop({ islandDiameters: [0, 100, Number.NaN, 200, -5, 300, 400, Number.NEGATIVE_INFINITY, 500] }),
  );
  assert.equal(dirty.scale, clean.scale);
});

test('the median is SORTED and is the LOWER middle island — never the input order, never an average', () => {
  // Three properties in one fixture, each of which a plausible simplification would break.
  // Sizes deliberately unsorted, and an EVEN count whose two middle values differ.
  const unsorted = [500, 100, 400, 200];   // sorted: 100 200 400 500 — lower median 200
  const frame = restingFrame(laptop({ islandDiameters: unsorted }));

  // (a) SORTED: the input order's own middle pair is 100/400, so an unsorted read lands elsewhere.
  // (b) LOWER median: 200, not the upper 400 and not the average 300.
  // (c) an actual island size: 200 is a value in the list.
  assert.ok(unsorted.includes(frame.islandPx / frame.scale));
  assert.ok(Math.abs(frame.islandPx / frame.scale - 200) < 1e-9, `median was ${frame.islandPx / frame.scale}`);
});

test('an odd count takes the true middle island', () => {
  const frame = restingFrame(laptop({ islandDiameters: [400, 100, 900] }));
  assert.ok(Math.abs(frame.islandPx / frame.scale - 400) < 1e-9);
});

test('restingFrame — degenerate input is reported, never guessed — survives a zero-sized frame and a zero-sized world without producing a non-finite scale', () => {
  for (const input of [
    laptop({ frameWidth: 0, frameHeight: 0 }),
    laptop({ contentWidth: 0, contentHeight: 0 }),
    laptop({ frameHeight: 0 }),
  ]) {
    const frame = restingFrame(input);
    assert.ok(Number.isFinite(frame.scale) && frame.scale > 0, `scale was ${frame.scale}`);
    assert.ok(Number.isFinite(frame.extentShown), `extentShown was ${frame.extentShown}`);
  }
});

test('EACH degenerate dimension alone falls back to the reference scale — not just all of them at once', () => {
  // Tested one at a time because a single combined fixture leaves every individual guard free to
  // be wrong: with all four dimensions zero, any one of them still short-circuits the check.
  // Exactly ZERO on each, because zero is the boundary the guard is written on and `< 0` would
  // pass it straight through to a division by zero.
  for (const over of [
    { contentWidth: 0 },
    { contentHeight: 0 },
    { frameWidth: 0 },
    { frameHeight: 0 },
  ]) {
    const frame = restingFrame(laptop(over));
    assert.equal(frame.scale, 1, `${JSON.stringify(over)} gave scale ${frame.scale}, not the fallback`);
  }
});

test('a zero-sized SHORT SIDE is undetermined, even with islands to measure', () => {
  // `shortSide <= 0` and not `< 0`: at exactly zero the designed span is zero, which would read as
  // "the whole world already fits" and report a confident framing for a frame with no extent.
  for (const over of [{ frameWidth: 0 }, { frameHeight: 0 }]) {
    assert.equal(restingFrame(laptop(over)).bound, 'undetermined', JSON.stringify(over));
  }
});

test('the fit/designed comparison is inclusive — an exact tie shows the world WHOLE', () => {
  // Constructed so `fit` and `designed` are exactly equal: island 100 over a 900px short side puts
  // the designed scale at 1, and a 1600x900 world contains at exactly 1 too. On a tie the world
  // fits the designed frame precisely, so there is nothing outside it to imply and it is shown
  // whole; the exclusive form would instead crop a world that exactly fits.
  const tie = restingFrame({
    islandDiameters: [100],
    contentWidth: 1600,
    contentHeight: 900,
    frameWidth: 1600,
    frameHeight: 900,
  });
  assert.equal(tie.scale, 1);
  assert.equal(tie.bound, 'whole-world');
});

test('the extent floor is inclusive — landing exactly ON the floor is the designed view, not the floor', () => {
  // designed === floor exactly: short side 900, island 100 → designed 1; fit 0.75 → floor 1.
  // Both arms return the same SCALE, so only `bound` can tell them apart — which is the whole
  // reason `bound` is reported rather than inferred from the number.
  const onFloor = restingFrame({
    islandDiameters: [100],
    contentWidth: 1600 / 0.75,
    contentHeight: 1200,
    frameWidth: 1600,
    frameHeight: 900,
  });
  assert.equal(onFloor.scale, 1);
  assert.equal(onFloor.bound, 'designed');
});

test('restingFrame — degenerate input is reported, never guessed — takes the median, not the mean — one giant story does not zoom the map out for everyone', () => {
  const typical = restingFrame(laptop({ islandDiameters: [196, 196, 196, 196, 196] }));
  const withGiant = restingFrame(laptop({ islandDiameters: [196, 196, 196, 196, 196, 4000] }));
  assert.equal(withGiant.scale, typical.scale);
});
