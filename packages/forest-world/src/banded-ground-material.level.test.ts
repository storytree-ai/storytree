// banded-ground-material.level.test.ts — THE LEVEL STAGE (ADR-0506): every colour layer wears
// the fragment's own lighting rung before its mix, and an unlayered shader is untouched by it.
//
// ⚠⚠ WHY THIS STAGE EXISTS, stated once here so the assertions read as claims rather than as
// string-matching. Until 2026-09-03 every colour seam was `mix(c, layerColour, factor)` with `c`
// the LIT ramp entry (`token x level`) and `layerColour` the recipe's UNLIT albedo. At 0.32 that
// is invisible; at the bold factors ADR-0503 directs it flattens the ground in proportion — the
// relief's banding and the contact shadow under a tree faded exactly as the recipe arrived, which
// is the mechanism behind the owner's "not the picture I stamped" on the finished stack. Cycles
// shades the composited albedo; multiplying each layer by the recovered rung is that order here.

import assert from 'node:assert/strict';
import test from 'node:test';

import { DataTexture, RedFormat, UnsignedByteType } from 'three';

import {
  createBandedGroundMaterial,
  groundAtlasTexture,
  levelSelectGlsl,
} from './banded-ground-material.js';
import { SHADE_LEVELS } from './shade-ladder.js';
import { buildAtlasOcclusion } from './shadow-atlas.js';
import { shadowLadderFor } from './shadow-rung.js';
import type { InstanceDescriptor } from './world-to-3d.js';

const SHIPPED_TOKENS = ['#8cb85e', '#b7684e', '#d8c069', '#d8c069', '#57544a', '#9ca3af'];

const cellOf = (island: string, x: number): InstanceDescriptor => ({
  kind: 'cell-ground',
  group: 'cell-ground',
  transform: { x: x + 10, y: 0, z: 10 },
  island,
  points: [
    { x, y: 0, z: 0 },
    { x: x + 20, y: 0, z: 0 },
    { x: x + 20, y: 0, z: 20 },
    { x, y: 0, z: 20 },
  ],
});

const atlas = (): ReturnType<typeof groundAtlasTexture> =>
  groundAtlasTexture(
    buildAtlasOcclusion({
      cells: [cellOf('a', 0), cellOf('b', 60)],
      relief: 2.2,
      casters: [{ x: 10, z: 10, radius: 5, height: 19 }],
    }),
  );

const GRASS = { mix: 0.85, rows: [0] };

/** A field texture of the right TYPE for a layer's uniform — the source-level claims below read
 *  the emitted GLSL and never sample it, so its texels do not matter. */
const fieldTexture = (): DataTexture => new DataTexture(new Uint8Array(4), 2, 2, RedFormat, UnsignedByteType);

// ---------------------------------------------------------------- the emitter, as an exact golden

test('levelSelectGlsl emits the chain EXACTLY — the first level unconditionally, the rest by lvl', () => {
  // ⚠ AN EXACT GOLDEN, not a containment sweep: every line of an emitter is a string literal, so
  // a mutant that blanks one leaves a chain that still CONTAINS `level` and every number.
  assert.equal(levelSelectGlsl([0.8]), 'float level = 0.800000;');
  assert.equal(
    levelSelectGlsl([0.8, 0.9, 1]),
    ['float level = 0.800000;', 'if (lvl == 1) level = 0.900000;', 'if (lvl == 2) level = 1.000000;'].join(
      '\n        ',
    ),
  );
  // ⚠ SIX PLACES, the precision every other authored float in this shader is written at — a
  // rung written at fewer places would round `token x level` away from the ramp entry it was
  // built from.
  assert.equal(levelSelectGlsl([0.825]), 'float level = 0.825000;');
});

// ---------------------------------------------------------------- where the stage is, and is not

test('an UNGRASSED material carries NO level stage — byte-identical to before ADR-0506 at that site', () => {
  for (const m of [
    createBandedGroundMaterial({ tokens: SHIPPED_TOKENS }),
    createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal' }),
  ]) {
    assert.ok(!m.fragmentShader.includes('float level'), 'no colour layer, no level stage');
    assert.ok(!m.fragmentShader.includes('* level'), 'and nothing multiplies by a level it has not got');
    // ⚠ THE JOIN IS PINNED, not only the absence: the index line runs straight into the ramp
    // select, so NOTHING — not a level stage, not any other text — is spliced between them. An
    // absence check alone lets a stage that emits some other string survive.
    assert.ok(
      m.fragmentShader.includes(
        '        int idx = int(vStatus + 0.5) * ST_N_LEVELS + st_bandIndex(lambert);\n        vec3 c = uRamp[0];',
      ),
      'the unshadowed index line must join the ramp select directly',
    );
  }
  const shadowed = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal', shadowAtlas: atlas() });
  assert.ok(!shadowed.fragmentShader.includes('float level'));
  assert.ok(!shadowed.fragmentShader.includes('* level'));
  assert.ok(
    shadowed.fragmentShader.includes('+ lvl;\n        vec3 c = uRamp[0];'),
    'the shadowed index line must join the ramp select directly',
  );
});

test('the UNSHADOWED grassed shader declares its own lvl from the band index, then the chain', () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal', grass: GRASS });
  // The unshadowed index line is pinned elsewhere and reads `st_bandIndex` directly, so this form
  // has no `lvl` of its own to recover the rung from — the stage declares one.
  assert.ok(
    m.fragmentShader.includes(
      '        int idx = int(vStatus + 0.5) * ST_N_LEVELS + st_bandIndex(lambert);\n' +
        '        int lvl = st_bandIndex(lambert);\n' +
        `        ${levelSelectGlsl(SHADE_LEVELS)}`,
    ),
    'the level stage must follow the index line, declare lvl, and list the LIT ladder',
  );
  // The chain covers every lit rung and no more — nine rungs since 2026-08-31.
  assert.equal(SHADE_LEVELS.length, 9);
  assert.ok(m.fragmentShader.includes(`if (lvl == ${SHADE_LEVELS.length - 1}) level =`));
  assert.ok(!m.fragmentShader.includes(`if (lvl == ${SHADE_LEVELS.length}) level =`));
});

test('the SHADOWED grassed shader reuses the remapped-and-darkened lvl and lists the SHADOW ladder', () => {
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    shadowAtlas: atlas(),
    grass: GRASS,
  });
  // ONE `int lvl` — the index stage's own (`int lvl = 0;`), never a second declaration: the rung
  // a shadowed fragment's layers wear is the one the ramp used, shadow rung included.
  assert.equal([...m.fragmentShader.matchAll(/int lvl = /g)].length, 1);
  assert.ok(!m.fragmentShader.includes('int lvl = st_bandIndex(lambert);'));
  const ladder = shadowLadderFor(SHIPPED_TOKENS, SHADE_LEVELS);
  assert.ok(
    m.fragmentShader.includes(`+ lvl;\n        ${levelSelectGlsl(ladder.levels)}`),
    'the chain must list the shadow-extended ladder the ramp was built from, right after the index line',
  );
  assert.equal(ladder.levels.length, SHADE_LEVELS.length + 1, 'the shadow rung is one more level');
});

test('EVERY colour seam multiplies its colour by the level — grass, sand, dirt and rock', () => {
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    shadowAtlas: atlas(),
    grass: GRASS,
    sand: { shore: fieldTexture(), mix: 0.65, width: 9 },
    wear: { field: fieldTexture(), mix: 0.85, width: 3 },
    rock: { mix: 0.85, slope: [0.72, 0.9] },
  });
  const f = m.fragmentShader;
  assert.ok(f.includes('c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);'));
  assert.ok(f.includes('c = mix(c, st_sandColour(vWorld.xz) * level, uSandMix * (1.0 - sandBand) * grassGate);'));
  assert.ok(f.includes('c = mix(c, st_dirtColour(vWorld.xz) * level, uWearMix * wear * grassGate);'));
  assert.ok(f.includes('c = mix(c, st_rockColour(vWorld.xz) * level, uRockMix * rockMask * grassGate);'));
  // And the level is declared BEFORE the first seam reads it.
  assert.ok(f.indexOf('float level = ') < f.indexOf('* level, uGrassMix'));
  // Exactly one declaration, however many layers read it.
  assert.equal([...f.matchAll(/float level = /g)].length, 1);
});
