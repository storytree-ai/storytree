// banded-ground-material.layers.test.ts — THE LAYER UNIFORM RECORDS, PINNED IN A SMALL FILE.
//
// ⚠ WHY A SECOND FILE FOR CLAIMS `banded-ground-material.test.ts` ALREADY MAKES. The mutation rung's
// Bun runner attributes a kill by scraping `bun test`'s console output, and under CI's
// GitHub-Actions output mode a node:test failure from a LARGE, SLOW test file can be printed after
// its file's `::group::` has closed — under the next file's header, or after the summary, or not at
// all — so the kill cannot be credited to any test and the mutant is scored UNPROVEN (PR #1802,
// three CI runs, mutants at `banded-ground-material.ts:755-773`; `docs/research/
// stryker-bun-attribution-2026-08-26.md` Defect C). Locally every one of them is killed with a
// named killer. The tests here are the same claims made CHEAP and SYNCHRONOUS — one material built
// lazily, then plain property reads — so their failure lines land inside their own group and the
// credit routes. Nothing here is a new claim about the material; it is the old claim made
// attributable.
//
// ⚠ THE FIXTURE IS BUILT LAZILY (`STACK()`), never at module scope: a module-scope build makes
// every mutant it reaches "static" and scores it against the whole suite on a per-mutant timeout
// (`mutation-rung-scores-a-hang-as-unproven` §11).

import assert from 'node:assert/strict';
import test from 'node:test';
import { DataTexture, RedFormat, UnsignedByteType } from 'three';

import { createBandedGroundMaterial, groundAtlasTexture } from './banded-ground-material.js';
import { buildAtlasOcclusion } from './shadow-atlas.js';
import { buildAtlasShore, SAND_FIELD_WIDTH } from './shore-atlas.js';
import { WEAR_FALLOFF } from './land-wear.js';
import type { InstanceDescriptor } from './world-to-3d.js';

const TOKENS = ['#8cb85e', '#b7684e', '#d8c069', '#d8c069', '#57544a', '#9ca3af'];

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
const CELLS = [cellOf('a', 0), cellOf('b', 300)];
const occlusion = () =>
  buildAtlasOcclusion({ cells: CELLS, relief: 2.2, casters: [{ x: 10, z: 10, radius: 5, height: 19 }] });

const wearField = (): DataTexture => {
  const tex = new DataTexture(new Uint8Array([0, 128, 255, 64]), 2, 2, RedFormat, UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
};
const detailMap = (): DataTexture => {
  const tex = new DataTexture(new Uint8Array(16).fill(128), 2, 2);
  tex.needsUpdate = true;
  return tex;
};

/**
 * The whole stack, built INSIDE EACH TEST — the textures are returned so identity can be asserted.
 *
 * ⚠ NOT MEMOISED ACROSS TESTS, and that is load-bearing for the rung: Stryker selects the tests to
 * run against a mutant from PER-TEST coverage, so a shared fixture built by the first test that
 * touches it makes every later test look as though it never executed the material — and a mutant
 * on the detail record was then run against the wear test alone, which cannot see it (measured:
 * `773:20` and `773:36` were killed by the large file only, never by this one). A build per test
 * costs a few milliseconds and makes each claim its own witness.
 */
const STACK = () => {
  const wear = wearField();
  const detail = detailMap();
  const material = createBandedGroundMaterial({
    tokens: TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
    shadowAtlas: groundAtlasTexture(occlusion()),
    sand: { shore: groundAtlasTexture(buildAtlasShore(CELLS, occlusion())).texture, mix: 0.16, width: SAND_FIELD_WIDTH },
    wear: { field: wear, mix: 0.41, width: WEAR_FALLOFF },
    rock: { mix: 0.63, slope: [0.8, 0.95] },
    detail: { map: detail, strength: 0.45, tile: 2.4 },
  });
  return { material, wear, detail };
};

test('LAYER UNIFORMS (dedicated): the wear record is keyed exactly uWearTex and carries the field by identity', () => {
  const { material, wear } = STACK();
  const u = material.uniforms['uWearTex'];
  assert.notEqual(u, undefined, 'no uWearTex uniform — the wear record was not written');
  assert.equal(u!.value, wear, 'uWearTex does not carry the very texture the option was given');
});

test('LAYER UNIFORMS (dedicated): uWearMix and uWearWidth carry the option’s own two numbers', () => {
  const { material } = STACK();
  assert.equal(material.uniforms['uWearMix']?.value, 0.41);
  assert.equal(material.uniforms['uWearWidth']?.value, WEAR_FALLOFF);
});

test('LAYER UNIFORMS (dedicated): the detail record is keyed exactly uDetailTex and carries the map by identity', () => {
  const { material, detail } = STACK();
  const u = material.uniforms['uDetailTex'];
  assert.notEqual(u, undefined, 'no uDetailTex uniform — the detail record was not written');
  assert.equal(u!.value, detail, 'uDetailTex does not carry the very texture the option was given');
});

test('LAYER UNIFORMS (dedicated): uDetailStrength and uDetailTile carry the option’s own two numbers', () => {
  const { material } = STACK();
  assert.equal(material.uniforms['uDetailStrength']?.value, 0.45);
  assert.equal(material.uniforms['uDetailTile']?.value, 2.4);
});

test('LAYER UNIFORMS (dedicated): a material given no wear and no detail carries none of the six keys', () => {
  const bare = createBandedGroundMaterial({
    tokens: TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
    shadowAtlas: groundAtlasTexture(occlusion()),
  });
  for (const key of ['uWearTex', 'uWearMix', 'uWearWidth', 'uDetailTex', 'uDetailStrength', 'uDetailTile']) {
    assert.equal(bare.uniforms[key], undefined, `${key} is present on a material that wears no such layer`);
  }
});
