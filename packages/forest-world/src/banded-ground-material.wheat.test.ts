// banded-ground-material.wheat.test.ts — THE WHEAT OPTION on the shipped ground's material: absent
// means byte-identical, present means one paint seam carrying two gated layers, and the three
// refusals that keep a wheat from being drawn where no measurement admitted it.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBandedGroundMaterial,
  gateGlsl,
  grassGateGlsl,
  groundAtlasTexture,
  type BandedGroundMaterialOptions,
} from './banded-ground-material.js';
import { wheatGlsl } from './land-wheat.js';
import { buildAtlasOcclusion } from './shadow-atlas.js';
import { buildAtlasShore, SAND_FIELD_WIDTH } from './shore-atlas.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/** The shipped ground's six status rows — five colours over six states, transcribed rather than
 *  imported (the canvas drags React and three in). Row 2 and 3 are the in-progress yellow. */
const SHIPPED_TOKENS = ['#8cb85e', '#b7684e', '#d8c069', '#d8c069', '#57544a', '#9ca3af'];
const GREEN_ROWS = [0];
const YELLOW_ROWS = [2, 3];

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
const occlusion = () => buildAtlasOcclusion({ cells: CELLS, relief: 2.2, casters: [{ x: 10, z: 10, radius: 5, height: 19 }] });
const atlas = () => groundAtlasTexture(occlusion());
const shore = () => groundAtlasTexture(buildAtlasShore(CELLS, occlusion()));

const grassed = (): BandedGroundMaterialOptions => ({
  tokens: SHIPPED_TOKENS,
  grain: 'normal',
  grass: { mix: 0.85, rows: GREEN_ROWS },
});
const WHEAT = { mix: 0.85, rows: YELLOW_ROWS, anchor: '#b0b040', lift: 1 } as const;
const wheated = (): BandedGroundMaterialOptions => ({ ...grassed(), wheat: { ...WHEAT } });
const sandedOpts = (base: BandedGroundMaterialOptions): BandedGroundMaterialOptions => ({
  ...base,
  shadowAtlas: atlas(),
  sand: { shore: shore().texture, mix: 0.65, width: SAND_FIELD_WIDTH },
});

// ---------------------------------------------------------------- absent

test('AN ABSENT WHEAT CHANGES NOTHING — grassed, sanded and stacked shaders are byte-identical, and no uniform is uploaded', () => {
  const plain = createBandedGroundMaterial(grassed());
  assert.ok(!/uWheat/.test(plain.fragmentShader), 'no wheat uniform declared');
  assert.ok(!/st_wheat|st_paintColour|wheatGate/.test(plain.fragmentShader), 'no wheat source spliced in');
  assert.equal(plain.uniforms['uWheatMix'], undefined, 'and none uploaded');
  // The grass line is the one it always was, and it is the ONLY paint line.
  assert.ok(plain.fragmentShader.includes('        c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);\n'));
  assert.equal([...plain.fragmentShader.matchAll(/c = mix\(c, st_/g)].length, 1);
  // ⚠ THE JOINS, EXACTLY — the three sites an absent wheat leaves empty must close straight onto
  // what follows them, which is the only assertion that can see a non-empty "absent" (a sweep for
  // `st_wheat` cannot): the grass source onto the ramp declaration, the grass uniform onto the
  // varyings, and the unsanded paint line onto the write.
  assert.ok(plain.fragmentShader.includes('}\n\n      uniform vec3 uRamp['), 'the grass source must close straight onto the ramp declaration');
  assert.ok(plain.fragmentShader.includes('uniform float uGrassMix;\n      varying float vStatus;'), 'the grass uniform must close straight onto the varyings');
  assert.ok(
    plain.fragmentShader.includes('uGrassMix * grassGate);\n        gl_FragColor = vec4(c, 1.0);'),
    'the unsanded paint line must close straight onto the write',
  );
  // An explicit-absent key and a missing key build the same bytes — under exactOptionalPropertyTypes
  // the option is simply not there.
  const sandedPlain = createBandedGroundMaterial(sandedOpts(grassed()));
  assert.ok(!/uWheat|st_wheat|wheatGate/.test(sandedPlain.fragmentShader));
  assert.ok(
    sandedPlain.fragmentShader.includes(
      '        c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);\n        // LAYER 2 — the shore sand',
    ),
    'the grass line still joins straight onto the sand block',
  );
});

// ---------------------------------------------------------------- refusals

test('the wheat REFUSES without the grass — it is the grass`s structure re-palettised', () => {
  assert.throws(
    () => createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal', wheat: { ...WHEAT } }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the wheat layer needs the grass — it is layer 1’s own structure ' +
          're-palettised, and reads the scalar, drift and transfer only the grass source declares',
      );
      return true;
    },
  );
  assert.doesNotThrow(() => createBandedGroundMaterial(wheated()));
});

test('the wheat gate REFUSES an empty row list, a row outside the ramp, and a row the grass already names', () => {
  assert.throws(
    () => createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, rows: [] } }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the wheat layer was given no rows to dress — a gate that ' +
          'matches nothing draws the flat yellow at the painted yellow’s cost',
      );
      return true;
    },
  );
  assert.throws(
    () => createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, rows: [6] } }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the wheat layer names row 6, which is not a ramp row of the 6 this material was handed',
      );
      return true;
    },
  );
  assert.throws(() => createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, rows: [1.5] } }), /names row 1.5/);
  assert.throws(() => createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, rows: [-1] } }), /names row -1/);
  // ⚠⚠ THE SHARED ROW: row 0 is the grass's, so a wheat naming it would be painted twice.
  assert.throws(
    () => createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, rows: [2, 0] } }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: row 0 is named by BOTH the grass gate and the wheat gate — one row wears one painted layer, never the sum of two',
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------- present

test('a WHEATED material uploads the caller`s mix and splices the generated wheat in after the grass', () => {
  const m = createBandedGroundMaterial(wheated());
  assert.equal(m.uniforms['uWheatMix']?.value, 0.85, 'the fac is UPLOADED, never written in');
  assert.equal(m.uniforms['uGrassMix']?.value, 0.85, 'and the grass keeps its own');
  assert.ok(/uniform float uGrassMix;\n      uniform float uWheatMix;/.test(m.fragmentShader), 'declared after the grass`s');
  const spliced = wheatGlsl({ anchor: '#b0b040', lift: 1 }).split('\n').join('\n      ');
  assert.ok(m.fragmentShader.includes(spliced), 'the wheat source is not spliced with its lines intact');
  assert.ok(m.fragmentShader.includes('\n      // GENERATED from land-wheat.ts'), 'indented into the shader, not flattened');
  // AFTER the grass source (it calls the grass's functions), and each declared exactly once.
  assert.ok(m.fragmentShader.indexOf('vec3 st_grassColour(') < m.fragmentShader.indexOf('vec3 st_paintColour('));
  assert.equal([...m.fragmentShader.matchAll(/vec3 st_paintColour\(/g)].length, 1);
  assert.equal([...m.fragmentShader.matchAll(/vec3 st_wheatCool\(/g)].length, 1);
  assert.equal([...m.fragmentShader.matchAll(/vec3 st_grassSrgb\(/g)].length, 1, 'one transfer, the grass`s');
  // A different anchor writes different stops into the source — the rung is in the bytes.
  const other = createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, anchor: '#d6b271' } });
  assert.notEqual(other.fragmentShader, m.fragmentShader);
  assert.ok(other.fragmentShader.includes('onto the anchor #d6b271'));
  // And a different LIFT on the same anchor — the paleness rung is in the bytes, with the stops.
  const paler = createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, lift: 2 } });
  assert.notEqual(paler.fragmentShader, m.fragmentShader);
  assert.ok(paler.fragmentShader.includes('then lifted by 2.00 in'));
  assert.ok(paler.fragmentShader.includes(wheatGlsl({ anchor: '#b0b040', lift: 2 }).split('\n').join('\n      ')));
  assert.equal(paler.uniforms['uWheatMix']?.value, 0.85, 'the lift is in the source, never a uniform');
  assert.ok(!/uWheatLift/.test(paler.fragmentShader));
});

test('a lift below 1, or not a finite number, is REFUSED with the ladder`s floor named', () => {
  for (const lift of [0.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, lift } }),
      /lift is .* the paleness ladder runs from 1 \(the derivation as it stands\) upward, and a lift below it darkens a field the recipe already darkens/,
    );
  }
  // Exactly 1 is the floor, and admitted.
  assert.doesNotThrow(() => createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, lift: 1 } }));
  assert.doesNotThrow(() => createBandedGroundMaterial({ ...grassed(), wheat: { ...WHEAT, lift: 1.25 } }));
});

test('⚠⚠ THE PAINT LINE: one seam, both gates, each layer`s own factor — and the wheat`s gate is promoted for the layers above', () => {
  const m = createBandedGroundMaterial(wheated());
  const src = m.fragmentShader;
  // The grass line is GONE — the paint line replaces it rather than following it, so a fragment
  // never mixes layer 1 twice.
  assert.ok(!src.includes('c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);'));
  // The paint line, exactly.
  assert.ok(
    src.includes(
      '        c = mix(c, st_paintColour(vWorld.xz, grassGate, wheatGate) * level, uGrassMix * grassGate + uWheatMix * wheatGate);\n',
    ),
  );
  assert.equal([...src.matchAll(/c = mix\(c, st_/g)].length, 1, 'ONE paint seam');
  // Both gates are declared, the wheat's right after the grass's, naming exactly the yellow rows.
  assert.ok(src.includes('if (int(vStatus + 0.5) == 0) grassGate = 1.0;'));
  assert.ok(src.includes('if (int(vStatus + 0.5) == 2) wheatGate = 1.0;'));
  assert.ok(src.includes('if (int(vStatus + 0.5) == 3) wheatGate = 1.0;'));
  assert.equal([...src.matchAll(/wheatGate = 1\.0;/g)].length, 2, 'exactly the two yellow rows');
  assert.equal([...src.matchAll(/grassGate = 1\.0;/g)].length, 1);
  assert.ok(src.indexOf('float grassGate = 0.0;') < src.indexOf('float wheatGate = 0.0;'));
  assert.ok(src.indexOf('float wheatGate = 0.0;') < src.indexOf('st_paintColour(vWorld.xz'));
  // The promotion, AFTER the paint line — so the paint itself is never doubled, and the sand,
  // path and rock composite over the wheat.
  const paint = src.indexOf('c = mix(c, st_paintColour');
  const promote = src.indexOf('        grassGate = max(grassGate, wheatGate);\n');
  assert.ok(promote > paint, 'the gate is promoted after the paint, not before');
  // Unsanded, the promotion closes straight onto the write — the absent sand block is EMPTY.
  assert.ok(src.includes('grassGate = max(grassGate, wheatGate);\n        gl_FragColor = vec4(c, 1.0);'));
});

test('the layers above ride the promoted gate — a sanded, worn, rocked wheat shader keeps their lines byte for byte', () => {
  const sanded = createBandedGroundMaterial(sandedOpts(wheated()));
  const src = sanded.fragmentShader;
  assert.ok(src.includes('c = mix(c, st_sandColour(vWorld.xz) * level, uSandMix * (1.0 - sandBand) * grassGate);'));
  // The promotion sits between the paint line and the sand block.
  const promote = src.indexOf('grassGate = max(grassGate, wheatGate);');
  const sandLine = src.indexOf('// LAYER 2 — the shore sand');
  assert.ok(promote > 0 && promote < sandLine);
  // Recipe order in the declarations: grass → wheat → sand.
  assert.ok(src.indexOf('GENERATED from land-grass.ts') < src.indexOf('GENERATED from land-wheat.ts'));
  assert.ok(src.indexOf('GENERATED from land-wheat.ts') < src.indexOf('GENERATED from land-sand.ts'));
});

// ---------------------------------------------------------------- the emitter

test('gateGlsl emits a gate under any name EXACTLY, and grassGateGlsl is that emitter under its own', () => {
  assert.equal(
    gateGlsl('wheatGate', [2, 3]),
    [
      'float wheatGate = 0.0;',
      'if (int(vStatus + 0.5) == 2) wheatGate = 1.0;',
      'if (int(vStatus + 0.5) == 3) wheatGate = 1.0;',
    ].join('\n        '),
  );
  assert.equal(gateGlsl('grassGate', [0]), grassGateGlsl([0]));
  assert.equal(gateGlsl('g', []), 'float g = 0.0;');
  assert.ok(!gateGlsl('wheatGate', [1]).includes('int(vStatus) =='), 'a bare cast truncates, it must round');
});
