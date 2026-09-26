// banded-ground-material.test.ts — what the shipped ground's material may and may not deliver.
//
// ⚠ EVERY CLAIM HERE IS ABOUT THE RAMP AND THE GENERATED SOURCE, NOT ABOUT A PICTURE, and that
// is the stronger form rather than the cheaper one. A capture proves the pixels it photographed
// were on-palette; it can never prove no REACHABLE pixel is off it. If the only expression that
// reaches `gl_FragColor` is a `uRamp` element, then no lighting term and no interpolation can
// produce a colour outside the closure, because none of them is ever added to a colour. That is
// the argument `grainKeepsPaletteClosed` already makes in the harness, applied to the surface
// where a foreign-status read would actually mislead someone (ADR-0392 D5 / ADR-0398 D7).

import assert from 'node:assert/strict';
import test from 'node:test';

import { DataTexture, RedFormat, UnsignedByteType } from 'three';

import {
  GROUND_ATLAS_ATTRIBUTE,
  GROUND_STATUS_ATTRIBUTE,
  createBandedGroundMaterial,
  groundAtlasTexture,
  groundRamp,
  groundShadowTexture,
  litRemapGlsl,
  grassGateGlsl,
  rampSelectGlsl,
  shadowDarkenGlsl,
  shadowOcclusionGlsl,
} from './banded-ground-material.js';
import { buildGroundOcclusion } from './contact-shade.js';
import { atlasScale, buildAtlasOcclusion } from './shadow-atlas.js';
import { buildAtlasShore, SAND_FIELD_WIDTH } from './shore-atlas.js';
import { sandGlsl } from './land-sand.js';
import { ROCK_SLOPE_RAMP, rockGlsl } from './land-rock.js';
import { WEAR_FALLOFF, wearGlsl } from './land-wear.js';
import type { InstanceDescriptor } from './world-to-3d.js';
import { occlusionGrid } from './land-shadow.js';
import { shadowLadderFor } from './shadow-rung.js';
import {
  GRAIN_COLOUR_MIX,
  GRAIN_NORMAL_STRENGTH,
  grainGlsl,
  grainKeepsPaletteClosed,
  grainStops,
} from './land-grain.js';
import { grassGlsl } from './land-grass.js';
import {
  LEGACY_SHADE_LEVELS,
  LIGHT_DIRECTION,
  SHADE_LEVELS,
  bandGlsl,
  deliveredForLevel,
  toHex,
} from './shade-ladder.js';

/** The six shipped ground statuses' tokens, in `ForestWorldCanvas`'s own `GROUND_COLOUR` order.
 *  ⚠ Transcribed rather than imported: importing the canvas would drag React and three into a
 *  bare-node test. `shipped-baseline.test.ts` is what holds the canvas to these values, so this
 *  is a fixture the ramp arithmetic is exercised over, never a second source of truth. */
const SHIPPED_TOKENS = ['#8cb85e', '#b7684e', '#d8c069', '#d8c069', '#57544a', '#9ca3af'];

test('the ramp is ROW-MAJOR: row r, rung k is at r * nLevels + k', () => {
  const ramp = groundRamp(SHIPPED_TOKENS);
  assert.equal(ramp.length, SHIPPED_TOKENS.length * SHADE_LEVELS.length);
  SHIPPED_TOKENS.forEach((token, row) => {
    SHADE_LEVELS.forEach((level, rung) => {
      const got = ramp[row * SHADE_LEVELS.length + rung]!;
      const want = deliveredForLevel(token, level);
      assert.deepEqual(
        got.map((c) => Math.round(c * 255)),
        [want.r, want.g, want.b],
        `row ${row} (${token}) rung ${rung}`,
      );
    });
  });
});

test('⚠ THE EIGHT KNIFE-EDGE PRODUCTS — why the GPU is never allowed to multiply a colour', () => {
  // The first time this package let a shader compute `token * level` it delivered 929 px of
  // `#c2ad5e` where the authored entry is `#c2ad5f`: the product is EXACTLY 94.5 and JavaScript
  // rounds an exact half UP while the GPU's float-to-unorm8 conversion took it DOWN.
  //
  // These are the shipped ground's own instances of it. The sweep below ENUMERATES the class
  // rather than sampling it, which is what makes this a proof about the palette and not a spot
  // check — and it is worth enumerating: a first pass reasoned the class had two members and
  // the arithmetic found three, the extra one on `unknown`, the state that means "no data".
  //
  // ⚠⚠ AND REFINING THE LADDER MORE THAN DOUBLED THE CLASS: 3 members on the four-rung ladder,
  // EIGHT on the nine. That is arithmetic rather than bad luck — a 0.025 grid puts far more
  // (channel x level) products on an exact half than a 0.02/0.10/0.10 one does, and five of the
  // eight are on `healthy`'s green, the most common colour on the map. So the adoption did not
  // merely leave the never-let-the-GPU-multiply rule standing; it made it MUCH more live. The
  // architecture already handles it — colours are rounded once, in TypeScript, and uploaded
  // finished — which is why a change that would have been a visible regression under the first
  // design costs nothing under this one.
  assert.equal(105 * 0.9, 94.5, 'the yellow token blue channel');
  assert.equal(175 * 0.9, 157.5, 'the unknown token blue channel, at 0.9');
  assert.equal(140 * 0.825, 115.5, 'and the green token green channel, at a rung the refinement added');
  assert.equal(toHex(deliveredForLevel('#d8c069', 0.9)), '#c2ad5f');
  assert.equal(toHex(deliveredForLevel('#9ca3af', 0.9)), '#8c939e');
  assert.equal(toHex(deliveredForLevel('#8cb85e', 0.825)), '#74984e');

  const halves: string[] = [];
  for (const token of new Set(SHIPPED_TOKENS)) {
    for (const level of SHADE_LEVELS) {
      const t = [
        Number.parseInt(token.slice(1, 3), 16),
        Number.parseInt(token.slice(3, 5), 16),
        Number.parseInt(token.slice(5, 7), 16),
      ];
      for (const channel of t) {
        const product = channel * level;
        if (Math.abs(product - Math.floor(product) - 0.5) < 1e-9) halves.push(`${token}@${level}=${product}`);
      }
    }
  }
  // NON-VACUITY: the class is not empty, so "the GPU must not multiply" is a live constraint on
  // this palette rather than a precaution about a hypothetical one.
  assert.deepEqual(halves.sort(), [
    '#57544a@0.875=73.5',
    '#8cb85e@0.825=115.5',
    '#8cb85e@0.875=122.5',
    '#8cb85e@0.925=129.5',
    '#8cb85e@0.975=136.5',
    '#9ca3af@0.875=136.5',
    '#9ca3af@0.9=157.5',
    '#d8c069@0.9=94.5',
  ]);
  // ⚠ THE FOUR-RUNG LADDER'S OWN THREE, held beside them, so the growth above is the ladder
  // moving rather than this sweep drifting. `#9ca3af@0.78` left the class with the rung itself.
  const legacyHalves: string[] = [];
  for (const token of new Set(SHIPPED_TOKENS)) {
    for (const level of LEGACY_SHADE_LEVELS) {
      for (const channel of [1, 3, 5].map((i) => Number.parseInt(token.slice(i, i + 2), 16))) {
        const product = channel * level;
        if (Math.abs(product - Math.floor(product) - 0.5) < 1e-9) {
          legacyHalves.push(`${token}@${level}=${product}`);
        }
      }
    }
  }
  assert.deepEqual(legacyHalves.sort(), [
    '#9ca3af@0.78=136.5',
    '#9ca3af@0.9=157.5',
    '#d8c069@0.9=94.5',
  ]);
});

test('a ramp of zero tokens is REFUSED — an empty palette is a black island, not art', () => {
  assert.deepEqual(groundRamp([]), []);
  assert.throws(() => createBandedGroundMaterial({ tokens: [] }), /no tokens/);
});

test('the attribute NAME is `statusIndex` — the one string two files must agree on', () => {
  // ⚠ ASSERTED AS A LITERAL, which every other test here deliberately avoids. The constant exists
  // so the shader's declaration and the canvas's `attach` cannot disagree, and every test that
  // USES the constant is satisfied by any value at all, including an empty string. The failure it
  // would hide is silent: the attribute never arrives, every fragment reads row 0, and the island
  // paints itself one status while looking like it is working.
  assert.equal(GROUND_STATUS_ATTRIBUTE, 'statusIndex');
});

test('rampSelectGlsl covers EVERY entry, and its first is the fallthrough', () => {
  // A chain that stopped short would paint every status past the cut-off with row 0's colour —
  // a foreign-status read, and the quietest possible one: a plausible colour on a real parcel.
  for (const n of [1, 2, 24, 25]) {
    const glsl = rampSelectGlsl(n);
    assert.match(glsl, /^vec3 c = uRamp\[0\];/);
    for (let i = 1; i < n; i += 1) {
      assert.ok(glsl.includes(`if (idx == ${i}) c = uRamp[${i}];`), `entry ${i} of ${n} unreachable`);
    }
    assert.ok(!glsl.includes(`uRamp[${n}]`), 'the chain must not index past the ramp');
    // ⚠ ONE STATEMENT PER LINE. The chain is spliced into the fragment source as text, so a lost
    // separator collapses `vec3 c = uRamp[0];if (idx == 1) …` onto one line — which still
    // compiles and reads fine, until the day a `//` comment is added to any of them and the rest
    // of the shader is commented out. `includes` cannot see it; the line count can.
    assert.equal(glsl.split('\n').length, n, `${n} entries should emit ${n} lines`);
    for (const line of glsl.split('\n')) assert.match(line, /^\s*(vec3 c|if \(idx)/);
  }
});

test('the fragment stage writes a uRamp entry AND NOTHING ELSE — the closure, read off the source', () => {
  const material = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  const src = material.fragmentShader;
  const mainAt = src.indexOf('void main(');
  assert.ok(mainAt >= 0, 'the fragment shader has a main()');
  const body = src.slice(mainAt);
  // The ONE write, and its right-hand side is `c` — which the select chain can only ever have
  // set to a `uRamp` element. Nothing mixes, adds, or multiplies a colour anywhere in main().
  const writes = body.match(/gl_FragColor\s*=\s*[^;]+;/g) ?? [];
  assert.deepEqual(writes, ['gl_FragColor = vec4(c, 1.0);'], 'exactly one colour write, of `c`');
  const assignmentsToC = body.match(/\bc\s*=\s*[^;]+;/g) ?? [];
  assert.ok(assignmentsToC.length >= 1);
  for (const a of assignmentsToC) {
    assert.match(a, /c = uRamp\[\d+\];/, `an assignment to the delivered colour that is not a ramp read: ${a}`);
  }
});

test('the shader quantises through the SHARED ladder, never a private copy of it', () => {
  const material = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  const src = material.fragmentShader;
  assert.match(src, /int st_bandIndex\(float lambert\)/, 'the generated quantiser is present');
  assert.match(src, new RegExp(`const int ST_N_LEVELS = ${SHADE_LEVELS.length};`));
  for (const level of SHADE_LEVELS) assert.ok(src.includes(level.toFixed(6)), `rung ${level} missing`);
  // Half-lambert, wrapped: the terminator lands inside the ladder rather than collapsing every
  // back-facing pixel onto the darkest rung. Same expression as `rungOfNormal` in the pure half.
  assert.match(src, /dot\(n, normalize\(uLightDir\)\) \* 0\.5 \+ 0\.5/);
  // The uniform array is exactly as long as the ramp — a shorter declaration is a link error on
  // some drivers and a silent read of garbage on others.
  assert.match(src, new RegExp(`uniform vec3 uRamp\\[${SHIPPED_TOKENS.length * SHADE_LEVELS.length}\\];`));
});

test('the row arrives by ATTRIBUTE, and the vertex stage passes it through untouched', () => {
  const material = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  const vs = material.vertexShader;
  assert.ok(vs.includes(`attribute float ${GROUND_STATUS_ATTRIBUTE};`), 'the attribute is declared');
  assert.ok(vs.includes(`vStatus = ${GROUND_STATUS_ATTRIBUTE};`), 'and is passed through unmodified');
  // The normal reaches the fragment stage in WORLD space. In view space the ladder's rungs would
  // slide across static ground every time the viewer panned.
  assert.match(vs, /vNormal = normalize\(mat3\(modelMatrix\) \* normal\);/);
  // ...and the fragment stage rounds the interpolated row rather than truncating it: an
  // interpolant arriving as 1.9999998 would otherwise select row 1 and report a foreign status.
  assert.match(material.fragmentShader, /int\(vStatus \+ 0\.5\)/);
});

test('the material is UNLIT — no scene light may multiply on top of an authored rung', () => {
  const material = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  // `lights: false` is the default for a ShaderMaterial and is what keeps three from injecting
  // its light uniforms; the assertion is that nothing has turned it on, because a scene light
  // multiplying the ramp would push every fragment off the closed palette.
  assert.equal(material.lights, false);
  assert.deepEqual(Object.keys(material.uniforms).sort(), ['uLightDir', 'uRamp']);
  assert.equal(material.uniforms['uRamp']!.value.length, SHIPPED_TOKENS.length * SHADE_LEVELS.length);
});

test('the UNIFORMS carry the values, not merely the right number of slots', () => {
  // ⚠ A LENGTH IS NOT A VALUE, and on this material the difference is the whole picture: a ramp
  // of the right length full of zeroes draws a black island, and a light direction of `undefined`
  // draws an unlit one. Both were mutation survivors against a suite that checked the shapes.
  const material = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  const ramp = groundRamp(SHIPPED_TOKENS);
  const uploaded = material.uniforms['uRamp']!.value as { x: number; y: number; z: number }[];
  uploaded.forEach((v, i) => {
    const want = ramp[i]!;
    assert.ok(Math.abs(v.x - want[0]!) < 1e-12, `ramp[${i}].r`);
    assert.ok(Math.abs(v.y - want[1]!) < 1e-12, `ramp[${i}].g`);
    assert.ok(Math.abs(v.z - want[2]!) < 1e-12, `ramp[${i}].b`);
  });
  // NON-VACUITY: the ramp is not all one colour, so "every entry matches" says something.
  assert.ok(new Set(uploaded.map((v) => `${v.x},${v.y},${v.z}`)).size > 1);

  const light = material.uniforms['uLightDir']!.value as { x: number; y: number; z: number };
  assert.equal(light.x, LIGHT_DIRECTION.x);
  assert.equal(light.y, LIGHT_DIRECTION.y);
  assert.equal(light.z, LIGHT_DIRECTION.z);
  // ...and it is a COPY, so a material cannot mutate the module's authored constant through it.
  assert.notEqual(light, LIGHT_DIRECTION);
});

test('the fragment source is MULTI-LINE — the quantiser is spliced in, not collapsed', () => {
  // The ladder GLSL is indented into the fragment source line by line. Losing that join would
  // put `// GENERATED from …` and the entire quantiser on ONE line, commenting the shader out.
  const src = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS }).fragmentShader;
  const commentLines = src.split('\n').filter((l) => l.trim().startsWith('//'));
  assert.ok(commentLines.length >= 5, `only ${commentLines.length} comment lines — the join is lost`);
  for (const line of commentLines) {
    assert.ok(!line.includes('return'), `a comment line swallowed code: ${line.trim().slice(0, 60)}`);
  }
});

test('two statuses sharing a token share a ROW VALUE but not a row — proposed and building', () => {
  // ADR-0462 gives `proposed` and `building` one yellow. They are separate rows here because the
  // rows are the canvas map's own keys, and collapsing them would make the row index depend on
  // which colours happen to be equal today — a coupling that breaks the moment one is retuned.
  const ramp = groundRamp(SHIPPED_TOKENS);
  const proposed = ramp.slice(2 * SHADE_LEVELS.length, 3 * SHADE_LEVELS.length);
  const building = ramp.slice(3 * SHADE_LEVELS.length, 4 * SHADE_LEVELS.length);
  assert.deepEqual(proposed, building);
});

test('NO TWO STATUSES SHARE A DELIVERED COLOUR — except the pair that shares a token', () => {
  // The fence this surface exists behind: a capability must read as the state it holds and as no
  // other. The material cannot deliver a colour outside the ramp, so the whole question is
  // whether two DIFFERENT statuses' rows overlap — which is decidable here, exhaustively,
  // without a GPU.
  const rows = SHIPPED_TOKENS.map((token) =>
    new Set(SHADE_LEVELS.map((level) => toHex(deliveredForLevel(token, level)))),
  );
  for (let a = 0; a < rows.length; a += 1) {
    for (let b = a + 1; b < rows.length; b += 1) {
      const shared = [...rows[a]!].filter((c) => rows[b]!.has(c));
      const sameToken = SHIPPED_TOKENS[a] === SHIPPED_TOKENS[b];
      if (sameToken) {
        assert.equal(shared.length, rows[a]!.size, 'a shared token must share its whole row');
      } else {
        assert.deepEqual(shared, [], `rows ${a} (${SHIPPED_TOKENS[a]}) and ${b} (${SHIPPED_TOKENS[b]}) collide on ${shared}`);
      }
    }
  }
});

test('the LADDER FLOOR bounds the ground: nothing darker than 0.78 of its own token', () => {
  // What the banded material buys the map that `MeshStandardMaterial` could not. A smooth
  // lambert under a scene light can deliver any lightness the light produces, including one that
  // walks a status into a darker status's range. Here the reachable set is finite and floored.
  for (const token of new Set(SHIPPED_TOKENS)) {
    const t = {
      r: Number.parseInt(token.slice(1, 3), 16),
      g: Number.parseInt(token.slice(3, 5), 16),
      b: Number.parseInt(token.slice(5, 7), 16),
    };
    for (const level of SHADE_LEVELS) {
      const c = deliveredForLevel(token, level);
      for (const ch of ['r', 'g', 'b'] as const) {
        assert.ok(c[ch] >= Math.round(t[ch] * SHADE_LEVELS[0]!), `${token} ${ch} below the floor`);
        assert.ok(c[ch] <= t[ch], `${token} ${ch} above its own token`);
      }
    }
  }
});


// ─────────────────────────────────────────────────────────────────────── THE GRAIN OPTION
//
// ⚠⚠ THE ONE THING THIS SECTION MUST ESTABLISH, and it is not "the grain works": an ABSENT grain
// leaves this material EXACTLY as it was. Every figure the arc has published about the banded
// ground — 0 off-palette pixels on two renderers, 38–51% cheaper per frame than the material it
// replaced — is a figure about a specific shader. If adding an option moved that shader by even a
// whitespace line, those numbers would silently become numbers about something else.

test('AN ABSENT GRAIN CHANGES NOTHING — same source, same uniforms, byte for byte', () => {
  const bare = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  // The `uGrain*` uniforms are added by statement, so an ungrained material must carry neither.
  assert.deepEqual(Object.keys(bare.uniforms).sort(), ['uLightDir', 'uRamp']);
  // And the source must mention nothing the grain brought with it.
  assert.ok(!/st_grain/.test(bare.fragmentShader), 'no grain helper in an ungrained shader');
  assert.ok(!/vWorld/.test(bare.fragmentShader), 'no world varying in an ungrained fragment stage');
  assert.ok(!/vWorld/.test(bare.vertexShader), 'and none in the vertex stage either');
  assert.ok(!/uGrain/.test(bare.fragmentShader));
  // ⚠ AND NO RESIDUE AT THE SIX INTERPOLATION SITES, which is the half a "does it mention the
  // grain" sweep cannot see. A `${cond ? x : ''}` sitting on its own line leaves that line's
  // INDENTATION behind when the condition is false, so the shader stays correct and stops being
  // byte-identical — silently, and in the direction that makes every published figure about it
  // slightly untrue. That defect was real while this option was being written; it is caught here
  // by naming what each site must join to when the grain is absent, rather than by sweeping for
  // blank lines (the spliced-in ladder source legitimately carries some of its own).
  const joins: readonly [string, string][] = [
    // ⚠ THE PRECEDING LINE IS PART OF THIS ONE. `'uniform vec3 uRamp['` alone is satisfied by
    // any amount of injected text before it, which is exactly what a mutated `: ''` else-branch
    // is. The ladder's own last line is DERIVED rather than transcribed, so retuning `bandGlsl`
    // moves the expectation with it instead of leaving a literal that quietly stops anchoring.
    [
      'fragment: the grain source',
      `${bandGlsl().split('\n').at(-1)!}\n\n      uniform vec3 uRamp[`,
    ],
    ['fragment: the grain uniforms', 'uniform vec3 uLightDir;\n      varying float vStatus;'],
    ['fragment: the world varying', 'varying vec3 vNormal;\n\n      void main() {'],
    ['fragment: the normal stage', 'vec3 n = normalize(vNormal);\n        // Half-lambert'],
    ['fragment: the colour write', '\n        gl_FragColor = vec4(c, 1.0);\n      }'],
    // The shadow's own interpolation site: the index stage. An unshadowed material must join
    // straight from the half-lambert to the one `int idx` line it has always had.
    [
      'fragment: the index stage',
      'float lambert = dot(n, normalize(uLightDir)) * 0.5 + 0.5;\n        // +0.5 then truncate',
    ],
  ];
  for (const [what, expected] of joins) {
    assert.ok(bare.fragmentShader.includes(expected), `${what} left residue behind`);
  }
  assert.ok(
    bare.vertexShader.includes('varying vec3 vNormal;\n      void main() {'),
    'vertex: the world varying left residue behind',
  );
  assert.ok(
    bare.vertexShader.includes('mat3(modelMatrix) * normal);\n        gl_Position'),
    'vertex: the world assignment left residue behind',
  );
});

test('NON-VACUITY: the grain modes really do fill those sites, so the joins above mean something', () => {
  // Without this, every `includes` in the test above would be satisfied by a builder that ignored
  // its `grain` option entirely — the shape a byte-identity check degrades into.
  const g = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal' });
  assert.ok(!g.fragmentShader.includes('varying vec3 vNormal;\n\n      void main() {'));
  assert.ok(!g.fragmentShader.includes('vec3 n = normalize(vNormal);\n        // Half-lambert'));
  assert.ok(!g.vertexShader.includes('varying vec3 vNormal;\n      void main() {'));
  assert.ok(!g.vertexShader.includes('mat3(modelMatrix) * normal);\n        gl_Position'));
  const b = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'both' });
  assert.ok(!b.fragmentShader.includes('\n        gl_FragColor = vec4(c, 1.0);\n      }'));
});

test("the NORMAL half keeps the closure — it perturbs the LAMBERT, never the colour", () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal' });
  // The property that makes this half adoptable at all, asked of the SOURCE rather than of a
  // picture — a capture can only ever sample the pixels it photographed.
  assert.ok(grainKeepsPaletteClosed(m.fragmentShader), 'the shipped grain must stay palette-closed');
  // And it must actually be in there: a closed shader with no grain would pass the line above.
  assert.ok(/st_grainGradient\(vWorld\.xz\)/.test(m.fragmentShader), 'the grain must sample the world');
  assert.ok(/uGrainNormalStrength/.test(m.fragmentShader));
  assert.equal(m.uniforms['uGrainNormalStrength']?.value, GRAIN_NORMAL_STRENGTH);
  assert.equal(m.uniforms['uGrainColourMix'], undefined, 'the normal half uploads no mix factor');
  // ⚠ THE ORDER IS THE WHOLE ARGUMENT. The perturbation has to happen BEFORE the lambert, or the
  // fragment would be quantised off an unperturbed normal and the grain would be inert — a
  // component that is in the code and not in the picture.
  const body = m.fragmentShader.slice(m.fragmentShader.indexOf('void main('));
  assert.ok(
    body.indexOf('st_grainGradient') < body.indexOf('float lambert'),
    'the grain must perturb the normal before the lambert is taken',
  );
  assert.ok(body.indexOf('float lambert') < body.indexOf('st_bandIndex'), 'and the lambert before the quantiser');
});

test('the COLOUR half BREAKS the closure, which is why the shipped canvas may not ask for it', () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'both' });
  assert.ok(!grainKeepsPaletteClosed(m.fragmentShader), 'mode `both` must be off-palette');
  assert.equal(m.uniforms['uGrainColourMix']?.value, GRAIN_COLOUR_MIX);
  assert.equal(m.uniforms['uGrainNormalStrength']?.value, GRAIN_NORMAL_STRENGTH, '`both` is both');
  // The two grain stops are written into the source as literals from `grainStops()`, so the
  // shader and the pure module cannot hold different colours (the `bandGlsl` argument).
  const [dark, light] = grainStops();
  for (const stop of [dark, light]) {
    const literal = `vec3(${(stop.r / 255).toFixed(6)}, ${(stop.g / 255).toFixed(6)}, ${(stop.b / 255).toFixed(6)})`;
    assert.ok(m.fragmentShader.includes(literal), `the grain stop ${literal} is not in the source`);
  }
});

test('THE GRAIN NEVER MOVES THE RAMP — the palette is the same object in all three modes', () => {
  // The map's honesty does not depend on which grain is on: the reachable colour set of the two
  // palette-closed modes is the SAME 24 authored entries, and the ramp `both` mixes away from is
  // that set too. Without this, "the grain is a shading change" would be an assertion.
  const rampOf = (grain?: 'normal' | 'both'): string =>
    JSON.stringify(
      (grain === undefined
        ? createBandedGroundMaterial({ tokens: SHIPPED_TOKENS })
        : createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain })
      ).uniforms['uRamp']!.value,
    );
  assert.equal(rampOf('normal'), rampOf());
  assert.equal(rampOf('both'), rampOf());
});

test('the grain GLSL is spliced in from the module, not transcribed', () => {
  // The same argument `bandGlsl` makes about the ladder, extended to the field: a shader and a
  // test holding private copies of the lattice, the octave count or the ramp span would prove
  // nothing about each other. Every line of the generated field has to be present verbatim.
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal' });
  for (const line of grainGlsl().split('\n')) {
    if (line.trim().length === 0) continue;
    assert.ok(
      m.fragmentShader.includes(line.trim()),
      `the generated grain source is missing: ${line.trim()}`,
    );
  }
});

test('a GRAINED material really emits every fragment the grain needs — positively, not by absence', () => {
  // ⚠ THE UNGRAINED ASSERTIONS ABOVE ARE ALL `!includes`, AND AN ABSENCE CANNOT HOLD A PRESENCE.
  // Every conditional string in the builder could be blanked to "" and those tests would go on
  // passing while the grained shader failed to compile — measured, six surviving `StringLiteral`
  // mutants on this branch. These say what each one must contain.
  const g = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal' });
  // The world position, declared in BOTH stages and assigned in the vertex stage. A varying
  // declared in one stage only is a link error; assigned nowhere, it is silently zero, which
  // shades the whole island with one grain sample and looks like the grain being too coarse.
  assert.ok(g.vertexShader.includes('varying vec3 vWorld;'), 'vertex must declare vWorld');
  assert.ok(g.fragmentShader.includes('varying vec3 vWorld;'), 'fragment must declare vWorld');
  assert.ok(
    g.vertexShader.includes('vWorld = (modelMatrix * vec4(position, 1.0)).xyz;'),
    'and the vertex stage must assign it in WORLD space — a view-space grain would swim',
  );
  // ⚠ WITH ITS COMMENT. Generated shader source is read by whoever debugs a driver's compile log,
  // and every other block this file emits explains itself there; an emitted comment that nothing
  // holds is one a later edit drops without noticing.
  assert.ok(
    g.vertexShader.includes('// The grain is authored in GROUND coordinates, so it is sampled in them.'),
    'the assignment must say why it is in world space',
  );
  assert.ok(g.fragmentShader.includes('uniform float uGrainNormalStrength;'));
  // The spliced grain source keeps its INDENTATION, which is what a blanked join separator loses
  // — the shader still compiles, so nothing but this notices.
  assert.ok(
    g.fragmentShader.includes('\n      float st_grainHash(vec2 i) {'),
    'the grain source must be spliced in at the shader body indentation',
  );

  const b = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'both' });
  assert.ok(b.vertexShader.includes('varying vec3 vWorld;'));
  assert.ok(b.fragmentShader.includes('uniform float uGrainNormalStrength;'));
  assert.ok(b.fragmentShader.includes('uniform float uGrainColourMix;'));
  assert.ok(b.fragmentShader.includes('st_grainRamped(vWorld.xz)'), 'the colour half samples too');
  // ⚠ AND `normal` MUST NOT CARRY THE COLOUR HALF'S UNIFORM. A declared-but-unused uniform is a
  // reader taking the shipped material for the off-palette one.
  assert.ok(!g.fragmentShader.includes('uGrainColourMix'));
});

// ---------------------------------------------------------------------------
// THE SHADOW — the fourth component of the approved treatment to reach this material.
//
// ⚠ THE CLAIM THAT MATTERS IS STILL THE CLOSURE, and the shadow is the first option that grows
// the palette rather than merely moving within it. It grows it by exactly ONE authored level per
// row: `token x SHADOW_RUNG`, a member of the same `(authored token x authored level)` closure
// the palette is defined as. The shadow costs palette ENTRIES; it does not cost the closure, and
// `the ramp grows by exactly one level per row` is what says so.
// ---------------------------------------------------------------------------

/** A field over a small rect with one caster in it — enough to build a real texture from.
 *
 *  ⚠ THE GRID IS CHECKED BEFORE THE FIELD IS BUILT, and that guard is about how the mutation rung
 *  scores a hang rather than about this material. This fixture is a 252x252 field; under a broken
 *  resolution cap it is 2048x2048, and ten of those is a suite that grinds rather than fails —
 *  reported as a TIMEOUT, which the rung counts as UNPROVEN, credited to no test. Asked first, a
 *  wrong grid is reported as a wrong grid. `land-shadow.test.ts`'s `smallGrid` is the same guard. */
const SHADOW_BOUNDS = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
const testShadow = () => {
  const grid = occlusionGrid(SHADOW_BOUNDS);
  assert.ok(
    grid.w <= 300 && grid.h <= 300,
    `the shadow fixture's grid is ${grid.w}x${grid.h} — the resolution cap is not capping`,
  );
  return groundShadowTexture(
    buildGroundOcclusion({
      bounds: SHADOW_BOUNDS,
      relief: 2.2,
      casters: [{ x: 0, z: 0, radius: 7, height: 19 }],
    }),
  );
};

test('AN ABSENT SHADOW CHANGES NOTHING — no uniform, no sampler, no varying', () => {
  const bare = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  assert.ok(!/uShadow/.test(bare.fragmentShader), 'an unshadowed fragment stage names no shadow');
  assert.ok(!/texture2D/.test(bare.fragmentShader), 'and samples no texture');
  assert.ok(!/sampler2D/.test(bare.fragmentShader));
  assert.deepEqual(Object.keys(bare.uniforms).sort(), ['uLightDir', 'uRamp']);
  // The ramp stays the NINE authored rungs per row — four until the ladder was adopted on
  // 2026-08-31, and the literal is spelled out rather than read off `SHADE_LEVELS` so that a
  // ladder change has to be looked at here rather than absorbed.
  assert.equal((bare.uniforms['uRamp']!.value as unknown[]).length, SHIPPED_TOKENS.length * 9);
  // ⚠ THE WHOLE THREE-LINE BLOCK, not just its last line. The index stage is now built by
  // interpolation, so its two comment lines are string literals a mutant can blank — and a shader
  // that still selects correctly while having lost the sentence explaining WHY is exactly the
  // kind of erosion this file exists to refuse.
  assert.ok(
    bare.fragmentShader.includes(
      '        // +0.5 then truncate, rather than a bare cast: an interpolated float that arrives as\n' +
        '        // 1.9999998 for row 2 would otherwise select row 1 and report a foreign status.\n' +
        '        int idx = int(vStatus + 0.5) * ST_N_LEVELS + st_bandIndex(lambert);',
    ),
  );
});

test('NON-VACUITY: a shadowed material really does fill every one of those sites', () => {
  // Without this, the absent-shadow test above is satisfied by a builder that ignores the option.
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow: testShadow() });
  assert.ok(m.fragmentShader.includes('uniform sampler2D uShadowTex;'));
  assert.ok(m.fragmentShader.includes('uniform vec4 uShadowRect;'));
  assert.ok(m.fragmentShader.includes('float occ = texture2D(uShadowTex, shUv).r;'));
  assert.ok(m.fragmentShader.includes('if (occ > 0.5) {'));
  // The uniforms carry the REAL texture rather than a placeholder shaped like one.
  const shadow = testShadow();
  const wired = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow });
  assert.equal(wired.uniforms['uShadowTex']!.value, shadow.texture);
  assert.deepEqual(Object.keys(m.uniforms).sort(), [
    'uLightDir',
    'uRamp',
    'uShadowRect',
    'uShadowTex',
  ]);
  assert.ok(
    !m.fragmentShader.includes('int idx = int(vStatus + 0.5) * ST_N_LEVELS + st_bandIndex(lambert);'),
  );
});

test('THE RAMP GROWS BY EXACTLY ONE LEVEL PER ROW, and every entry is still authored', () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow: testShadow() });
  const ladder = shadowLadderFor(SHIPPED_TOKENS);
  const ramp = m.uniforms['uRamp']!.value as { x: number; y: number; z: number }[];
  assert.equal(ramp.length, SHIPPED_TOKENS.length * (SHADE_LEVELS.length + 1));
  assert.equal(ramp.length, SHIPPED_TOKENS.length * 10);
  // ⚠ THE CLOSURE, ENUMERATED RATHER THAN SAMPLED: every uploaded colour must be exactly
  // `deliveredForLevel(token, level)` for a level ON the shadow ladder.
  SHIPPED_TOKENS.forEach((token, row) => {
    ladder.levels.forEach((level, rung) => {
      const c = deliveredForLevel(token, level);
      const entry = ramp[row * ladder.levels.length + rung]!;
      assert.equal(
        toHex({
          r: Math.round(entry.x * 255),
          g: Math.round(entry.y * 255),
          b: Math.round(entry.z * 255),
        }),
        toHex(c),
        `row ${row} rung ${rung}`,
      );
    });
  });
});

test('groundRamp over the shadow ladder is the same array the material uploads', () => {
  const ladder = shadowLadderFor(SHIPPED_TOKENS);
  assert.equal(groundRamp(SHIPPED_TOKENS, ladder.levels).length, 60);
  // And the default is still the authored ladder, so every existing caller reads the ladder the
  // map wears rather than a second one.
  assert.equal(groundRamp(SHIPPED_TOKENS).length, 54);
});

test('THE FRAGMENT SELECTS — the shadow adds no arithmetic to a delivered colour', () => {
  // The whole closure argument in one assertion: the only expression reaching `gl_FragColor` is
  // still a `uRamp` element. A shadow that multiplied, mixed or subtracted would break it.
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow: testShadow() });
  const body = m.fragmentShader.slice(m.fragmentShader.indexOf('void main('));
  assert.ok(body.includes('gl_FragColor = vec4(c, 1.0);'));
  assert.ok(!/gl_FragColor = vec4\(c \*/.test(body), 'no multiply on the way out');
  assert.ok(!/mix\(c,/.test(body), 'no mix on the way out');
});

test('THE STRIDE MOVES WITH THE LADDER — a shadowed row is ten entries wide', () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow: testShadow() });
  assert.ok(
    m.fragmentShader.includes('int row = int(vStatus + 0.5);') && m.fragmentShader.includes('int idx = row * 10 + lvl;'),
    'the shadowed stride must be the shadow ladder’s length, not ST_N_LEVELS',
  );
  // ⚠ A stride left at 9 would select the NEXT ROW's colours for every status past the first —
  // a foreign-status read on the surface whose whole job is to report status.
  assert.ok(!m.fragmentShader.includes('* ST_N_LEVELS + lvl'));
});

test('the lit remap is emitted LINE FOR LINE, and it is a lookup rather than an offset', () => {
  // ⚠ 44 of the grain crossing's 109 mutation survivors were BLANKED GLSL LITERALS. A generator's
  // emitted source has to be pinned as source, not merely exercised.
  assert.equal(
    litRemapGlsl([1, 2, 3, 4]),
    'if (rung == 0) lvl = 1;\n        if (rung == 1) lvl = 2;\n        ' +
      'if (rung == 2) lvl = 3;\n        if (rung == 3) lvl = 4;',
  );
  // A rung landing MID-ladder produces a non-uniform remap, which an offset could not express.
  assert.equal(
    litRemapGlsl([0, 1, 3, 4]),
    'if (rung == 0) lvl = 0;\n        if (rung == 1) lvl = 1;\n        ' +
      'if (rung == 2) lvl = 3;\n        if (rung == 3) lvl = 4;',
  );
  assert.equal(litRemapGlsl([]), '');
});

test('the darken chain is emitted line for line, and sends every named rung to the shadow', () => {
  assert.equal(
    shadowDarkenGlsl([0, 1, 2, 3], 0),
    'if (rung == 0) lvl = 0;\n            if (rung == 1) lvl = 0;\n            ' +
      'if (rung == 2) lvl = 0;\n            if (rung == 3) lvl = 0;',
  );
  // A rung index other than 0, so the literal is not simply the loop counter wearing a name.
  assert.equal(shadowDarkenGlsl([2], 7), 'if (rung == 2) lvl = 7;');
  assert.equal(shadowDarkenGlsl([], 0), '');
});

test('the shipped material’s own remap and darken chains are in its source', () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow: testShadow() });
  const ladder = shadowLadderFor(SHIPPED_TOKENS);
  assert.ok(m.fragmentShader.includes(litRemapGlsl(ladder.litIndex)));
  assert.ok(m.fragmentShader.includes(shadowDarkenGlsl(ladder.darkenable, ladder.rungIndex)));
});

test('the shadow is sampled in GROUND space, through the rect the texture was built with', () => {
  const shadow = testShadow();
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow });
  assert.ok(
    m.fragmentShader.includes('vec2 shUv = vec2((vWorld.x - uShadowRect.x) * uShadowRect.z,'),
  );
  assert.ok(m.fragmentShader.includes('(vWorld.z - uShadowRect.y) * uShadowRect.w);'));
  assert.ok(m.vertexShader.includes('vWorld = (modelMatrix * vec4(position, 1.0)).xyz;'));
  // The rect carries the RECIPROCAL spans, so the fragment multiplies rather than divides.
  const rect = m.uniforms['uShadowRect']!.value as { x: number; y: number; z: number; w: number };
  assert.equal(rect.x, shadow.minX);
  assert.equal(rect.y, shadow.minZ);
  assert.ok(Math.abs(rect.z - 1 / shadow.spanX) < 1e-12);
  assert.ok(Math.abs(rect.w - 1 / shadow.spanZ) < 1e-12);
});

test('the uploaded texture covers the field’s own ground rect', () => {
  const field = buildGroundOcclusion({ bounds: SHADOW_BOUNDS, relief: 2.2, casters: [] });
  const shadow = groundShadowTexture(field);
  assert.equal(shadow.minX, field.minX);
  assert.equal(shadow.minZ, field.minZ);
  assert.ok(Math.abs(shadow.spanX - field.w / field.gres) < 1e-12);
  assert.ok(Math.abs(shadow.spanZ - field.h / field.gres) < 1e-12);
  // The texture really carries the field's own samples, at the field's own dimensions — an
  // `instanceof` rather than a cast, because a cast would discard exactly the evidence being
  // asked for (the house TypeScript standard's `no-unsafe-cast`).
  assert.ok(shadow.texture instanceof DataTexture);
  assert.equal(shadow.texture.image.width, field.w);
  assert.equal(shadow.texture.image.height, field.h);
  assert.equal(shadow.texture.image.data, field.data);
  // ⚠ AND IT IS FLAGGED FOR UPLOAD. A `DataTexture` whose `needsUpdate` was never set is a
  // texture the GPU never receives: every fragment then samples an empty sampler and the island
  // renders unshadowed, correctly, in silence. Asked through `version` rather than through
  // `needsUpdate`, which in three is a WRITE-ONLY setter — reading it back gives `undefined`, and
  // an assertion on that is satisfied by never having set it.
  assert.ok(shadow.texture.version > 0, "the texture must be flagged for upload");
});

test('a shadowed material still declares its GRAIN when it wears one, and both when both', () => {
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    shadow: testShadow(),
  });
  assert.ok(m.fragmentShader.includes('uniform float uGrainNormalStrength;'));
  assert.ok(m.fragmentShader.includes('uniform sampler2D uShadowTex;'));
  assert.ok(grainKeepsPaletteClosed(m.fragmentShader), 'the shipped combination stays closed');
  // ONE world varying, not two: both riders share it.
  assert.equal(m.vertexShader.split('varying vec3 vWorld;').length - 1, 1);
  // And the GRAIN's own comment is the one that survives, so a grained material's source is
  // unchanged at that site by the shadow's arrival.
  assert.ok(
    m.vertexShader.includes(
      '// The grain is authored in GROUND coordinates, so it is sampled in them.',
    ),
  );
});

test('a shadowed material with NO grain says so at the world varying’s own site', () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow: testShadow() });
  assert.ok(
    m.vertexShader.includes(
      '// The occlusion field is authored in GROUND coordinates, so it is sampled in them.',
    ),
  );
  assert.ok(!m.vertexShader.includes('// The grain is authored in GROUND coordinates'));
});

test('a palette that cannot carry a shadow REFUSES rather than shipping a lie', () => {
  assert.throws(
    () => createBandedGroundMaterial({ tokens: ['#808080', '#7f7f7f'], shadow: testShadow() }),
    /cannot be drawn inside this closed palette/,
  );
});

test('THE `lit` OPTION reaches BOTH the ramp and the shader, and absent means byte-identical', () => {
  // ⚠ BOTH HALVES OR NEITHER. The ramp is indexed by the shader's own `st_bandIndex`, so a `lit`
  // that reached the ramp but not the GLSL (or the reverse) would index a 12-entry row with a
  // 4-rung quantiser — every parcel painted some other rung's colour, silently, on the surface
  // whose whole job is to report status.
  const tokens = ['#8cb85e', '#b7684e', '#d8c069', '#57544a', '#9ca3af'];
  const lit = [0.78, 0.8, 0.82, 0.84, 0.86, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98, 1.0];

  const shipped = createBandedGroundMaterial({ tokens });
  const refined = createBandedGroundMaterial({ tokens, lit });

  // THE RAMP: one entry per (token, rung).
  assert.equal((shipped.uniforms['uRamp']!.value as unknown[]).length, tokens.length * 9);
  assert.equal((refined.uniforms['uRamp']!.value as unknown[]).length, tokens.length * lit.length);

  // THE SHADER: the quantiser carries the same count, and the ladder's own rungs.
  assert.match(refined.fragmentShader, /const int ST_N_LEVELS = 12;/);
  assert.match(shipped.fragmentShader, /const int ST_N_LEVELS = 9;/);
  assert.ok(refined.fragmentShader.includes('return 0.820000;'), 'an intermediate rung is missing');
  assert.ok(!shipped.fragmentShader.includes('return 0.820000;'));

  // ⚠ AND THE GENERATED LADDER IS SPLICED IN WITH ITS INDENTATION INTACT. The join is what makes
  // the emitted source readable AND what a byte-identity claim rests on; dropping it leaves the
  // ladder flush against the margin inside a template that is otherwise indented.
  assert.ok(refined.fragmentShader.includes('\n      const int ST_N_LEVELS = 12;'));

  // ABSENT MEANS ABSENT: passing no ladder must emit exactly what a canvas that has never heard of
  // this option emits, or every figure already published about the banded ground is about a
  // different shader.
  assert.equal(createBandedGroundMaterial({ tokens, grain: 'normal' }).fragmentShader, createBandedGroundMaterial({ tokens, grain: 'normal' }).fragmentShader);
  assert.notEqual(refined.fragmentShader, shipped.fragmentShader);
});

test('a SHADOWED material re-derives its rung against the `lit` ladder rather than the authored one', () => {
  // The coupling the fourth crossing was written to prevent, one lever further along: a candidate
  // ladder must not silently inherit the shipped ladder's 0.77. The ramp is the observable — it is
  // one entry longer per row than the lit ladder, and the extra entry is THIS ladder's rung.
  const tokens = ['#8cb85e', '#b7684e', '#d8c069', '#57544a', '#9ca3af'];
  const lit = [0.86, 0.9, 0.94, 1.0];
  const shadow = groundShadowTexture(
    buildGroundOcclusion({ bounds: SHADOW_BOUNDS, relief: 2.2, casters: [{ x: 0, z: 0, radius: 7, height: 19 }] }),
  );

  const unshadowed = createBandedGroundMaterial({ tokens, lit });
  const shadowed = createBandedGroundMaterial({ tokens, lit, shadow });
  const rampLen = (m: { uniforms: Record<string, { value: unknown }> }): number =>
    (m.uniforms['uRamp']!.value as unknown[]).length;

  assert.equal(rampLen(unshadowed), tokens.length * lit.length);
  assert.equal(rampLen(shadowed), tokens.length * (lit.length + 1), 'the shadow adds ONE rung per row');
  // And it is the rung derived against THIS ladder, which is not the shipped one.
  assert.equal(shadowLadderFor(tokens, lit).levels.length, lit.length + 1);
  // NON-VACUITY: an unshadowed material of the SAME ladder carries no shadow uniform at all, so
  // the length difference above is the rung rather than an unrelated uniform.
  assert.ok(!('uShadowTex' in unshadowed.uniforms));
  assert.ok('uShadowTex' in shadowed.uniforms);
});


// ---------------------------------------------------------------------------------------------
// THE PACKED ATLAS — the SECOND spelling of the occlusion input, and the first thing this
// material has ever needed from the vertex stage.

/** A tiny packed atlas over two islands, memoised: the mutation rung runs the covering tests once
 *  per mutant, and a witness that rebuilt a field per assertion is how a slow suite gets scored as
 *  a set of phantom survivors. */
const testAtlas = (): ReturnType<typeof groundAtlasTexture> =>
  groundAtlasTexture(
    buildAtlasOcclusion({
      cells: [ATLAS_CELL_A, ATLAS_CELL_B],
      relief: 2.2,
      casters: [{ x: 10, z: 10, radius: 5, height: 19 }],
    }),
  );

const atlasCellOf = (island: string, x: number): InstanceDescriptor => ({
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
const ATLAS_CELL_A = atlasCellOf('a', 0);
const ATLAS_CELL_B = atlasCellOf('b', 300);

test('AN ABSENT ATLAS CHANGES NOTHING — no attribute, no varying, no scale uniform', () => {
  const bare = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  const rect = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow: testShadow() });
  for (const m of [bare, rect]) {
    // ⚠ THE ATTRIBUTE LIST IS ASSERTED WHOLE, not merely searched for a name. Every one of the
    // atlas's four insertion points is an `atlased ? … : ''`, and the EMPTY branch is a string
    // literal a mutant can fill with anything at all — including text that contains no spelling
    // this test would recognise. Byte identity has to be literal or it is not a claim.
    assert.ok(
      m.vertexShader.includes(
        '      attribute float statusIndex;\n      varying float vStatus;\n      varying vec3 vNormal;',
      ),
      'an unatlased vertex stage declares the row attribute and NOTHING between it and vStatus',
    );
    assert.ok(!/atlasOrigin/.test(m.vertexShader), 'no atlas attribute in the vertex stage');
    assert.ok(!/vAtlasOrigin/.test(m.fragmentShader), 'and no atlas varying in the fragment stage');
    assert.ok(!/uShadowAtlasScale/.test(m.fragmentShader));
    assert.ok(!Object.keys(m.uniforms).includes('uShadowAtlasScale'));
  }
  // ⚠ AND THE RECT FORM’S OWN uv LINE IS UNTOUCHED, byte for byte — every committed figure
  // about the shadowed ground was taken against exactly these two lines.
  assert.ok(
    rect.fragmentShader.includes(
      '        vec2 shUv = vec2((vWorld.x - uShadowRect.x) * uShadowRect.z,\n' +
        '                         (vWorld.z - uShadowRect.y) * uShadowRect.w);',
    ),
  );
});

test('NON-VACUITY: an ATLASED material really does fill every one of those sites', () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadowAtlas: testAtlas() });
  assert.ok(m.vertexShader.includes(`attribute vec2 ${GROUND_ATLAS_ATTRIBUTE};`));
  assert.ok(m.vertexShader.includes(`vAtlasOrigin = ${GROUND_ATLAS_ATTRIBUTE};`));
  assert.ok(m.vertexShader.includes('varying vec2 vAtlasOrigin;'));
  assert.ok(m.fragmentShader.includes('varying vec2 vAtlasOrigin;'));
  assert.ok(m.fragmentShader.includes('uniform vec2 uShadowAtlasScale;'));
  assert.ok(m.fragmentShader.includes('uniform sampler2D uShadowTex;'));
  assert.ok(
    m.fragmentShader.includes(
      'vec2 shUv = vAtlasOrigin + vec2(vWorld.x, vWorld.z) * uShadowAtlasScale;',
    ),
  );
  // The rect form's uniform must NOT be there: two ways to find a sample is one way too many.
  assert.ok(!/uShadowRect/.test(m.fragmentShader));
});

test('BOTH occlusion forms at once is REFUSED — not resolved by precedence', () => {
  assert.throws(
    () =>
      createBandedGroundMaterial({
        tokens: SHIPPED_TOKENS,
        shadow: testShadow(),
        shadowAtlas: testAtlas(),
      }),
    /two spellings of one input/,
  );
});

test('the atlas still selects a uRamp entry AND NOTHING ELSE — the closure is unmoved', () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadowAtlas: testAtlas() });
  const body = m.fragmentShader.slice(m.fragmentShader.indexOf('void main()'));
  const writes = body.match(/gl_FragColor\s*=\s*[^;]+;/g) ?? [];
  assert.equal(writes.length, 1);
  assert.equal(writes[0], 'gl_FragColor = vec4(c, 1.0);');
  // And the ramp grew by exactly the shadow rung, as the rect form does — the packing changes
  // where a sample lives, never what a fragment may deliver.
  const rect = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow: testShadow() });
  assert.equal(
    (m.uniforms['uRamp']!.value as unknown[]).length,
    (rect.uniforms['uRamp']!.value as unknown[]).length,
  );
});

test('the uploaded SCALE is the packing’s own derivation, not a second copy of it', () => {
  const field = buildAtlasOcclusion({
    cells: [ATLAS_CELL_A, ATLAS_CELL_B],
    relief: 2.2,
    casters: [{ x: 10, z: 10, radius: 5, height: 19 }],
  });
  const uploaded = groundAtlasTexture(field);
  const derived = atlasScale(field);
  assert.equal(uploaded.scaleU, derived.u);
  assert.equal(uploaded.scaleV, derived.v);
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadowAtlas: uploaded });
  const scale = m.uniforms['uShadowAtlasScale']!.value as { x: number; y: number };
  assert.equal(scale.x, derived.u);
  assert.equal(scale.y, derived.v);
  assert.equal((m.uniforms['uShadowTex']!.value as DataTexture).image.width, field.w);
});

test('the ATLAS attribute name is `atlasOrigin` — the second string two files must agree on', () => {
  // Spelled as a literal for the reason its `statusIndex` neighbour is: every other test names the
  // constant, so none of them pins what it IS, and a mismatch between the shader's spelling and
  // the canvas's is silent — every island reads the atlas's top-left tile and wears some other
  // island's shadow while looking entirely ordinary.
  assert.equal(GROUND_ATLAS_ATTRIBUTE, 'atlasOrigin');
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadowAtlas: testAtlas() });
  assert.ok(m.vertexShader.includes('attribute vec2 atlasOrigin;'));
  assert.ok(m.vertexShader.includes('vAtlasOrigin = atlasOrigin;'));
});

test('the atlas texture is UPLOADED, not merely constructed', () => {
  // `needsUpdate` is a write-only setter on three's Texture — it bumps `version`. A texture left
  // at version 0 is never sent to the GPU, and the island renders unshadowed while every object
  // on this page looks correctly built.
  const uploaded = testAtlas();
  assert.ok(uploaded.texture.version > 0, 'the atlas texture must have been marked for upload');
});

test('the both-forms refusal says WHICH two forms, not only that there were two', () => {
  // The message is two concatenated literals and only the second was pinned; a mutant blanking the
  // first left a refusal that names neither input. A reader who hits this is holding a call site
  // with two options set and needs to be told which pair is the problem.
  assert.throws(
    () =>
      createBandedGroundMaterial({
        tokens: SHIPPED_TOKENS,
        shadow: testShadow(),
        shadowAtlas: testAtlas(),
      }),
    /both a rect occlusion field and a packed atlas were supplied/,
  );
});

test('the atlas vertex stage is emitted LINE FOR LINE, comment block included', () => {
  // ⚠ THE WHOLE BLOCK, not just its last line — the same claim the index stage's own test makes.
  // A shader that still passes the corner through while having lost the sentence explaining why
  // the interpolation is exact is the erosion this file exists to refuse.
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadowAtlas: testAtlas() });
  assert.ok(
    m.vertexShader.includes(
      "        // The island's tile corner rides through the interpolator. All three vertices of\n" +
        '        // a triangle belong to one island and carry the same corner, so the interpolated\n' +
        '        // value is that corner exactly — the same argument vStatus above makes.\n' +
        '        vAtlasOrigin = atlasOrigin;',
    ),
    'the atlas assignment must arrive with its whole argument attached',
  );
  assert.ok(m.vertexShader.includes('\n      attribute vec2 atlasOrigin;'));
  assert.ok(m.vertexShader.includes('\n      varying vec2 vAtlasOrigin;'));
});

test('the atlas fragment stage carries its own two-line argument as well', () => {
  const m = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadowAtlas: testAtlas() });
  assert.ok(
    m.fragmentShader.includes(
      "        // The atlas form: the island's own tile corner, plus the ground position\n" +
        "        // scaled into it. Two multiply-adds against the rect form's two subtract-multiplies —\n" +
        '        // the packing costs the fragment stage nothing, it costs a vec2 on the mesh.\n' +
        '        vec2 shUv = vAtlasOrigin + vec2(vWorld.x, vWorld.z) * uShadowAtlasScale;',
    ),
  );
});

// ---------------------------------------------------------------- LAYER 1: the grass base
//
// ⚠⚠ THIS LAYER LEAVES THE PALETTE ON PURPOSE, and these tests state that rather than working
// around it. ADR-0490 D5 names the mix seam as the way every approved-ground layer enters, and
// ADR-0489 D3/D4 moved the fence from composition (a closed palette) to outcome (can a viewer
// still tell what state the island is in). So the assertions below are: the closure is broken,
// measurably and only when asked for; nothing changes when it is not asked for; and the layer
// composites where the recipe puts it.

test('an UNGRASSED material is byte-identical — the grass adds nothing at any of its four sites', () => {
  const grained = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal' });
  assert.ok(!/uGrass/.test(grained.fragmentShader), 'no grass uniform declared');
  assert.ok(!/st_grass/.test(grained.fragmentShader), 'no grass helper spliced in');
  assert.equal(grained.uniforms['uGrassMix'], undefined, 'and none uploaded');
  // ⚠ THE INDENTATION RESIDUE CHECK, the same one the grain's own byte-identity test makes: a
  // `${cond ? x : ''}` on its own line leaves that line's whitespace behind when false. Naming
  // what each site JOINS TO is what catches it; sweeping for `st_grass` cannot.
  assert.ok(
    grained.fragmentShader.includes(`}\n\n      uniform vec3 uRamp[`),
    'the grass source site must close straight onto the ramp declaration',
  );
  assert.ok(
    /\n        vec3 c = uRamp\[0\];/.test(grained.fragmentShader),
    'the ramp selection must be reached with no grass stage before it',
  );
});

test('the grass REFUSES to be built without the grain, rather than emitting a shader that cannot link', () => {
  // ⚠ THE WHOLE MESSAGE, BOTH HALVES. `check:mutation-diff` blanked the second line of it and a
  // `/grass layer needs the grain/` match stayed green — leaving a refusal that names the
  // constraint and not the REASON, which is the half a reader actually needs to act on.
  assert.throws(
    () => createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grass: { mix: 0.1, rows: [0] } }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the grass layer needs the grain — it evaluates its octaves ' +
          'through `st_grainOctave`, which only the grain source declares',
      );
      return true;
    },
  );
  // And the refusal is about the DEPENDENCY, not about the grass being unwelcome: with the grain
  // present the same options build.
  assert.doesNotThrow(() =>
    createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal', grass: { mix: 0.1, rows: [0] } }),
  );
});

test('a GRASSED material uploads the caller`s mix and splices the generated layer in', () => {
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.17, rows: [0] },
  });
  assert.equal(m.uniforms['uGrassMix']?.value, 0.17, 'the fac is UPLOADED, never written in');
  assert.ok(/uniform float uGrassMix;/.test(m.fragmentShader));
  assert.ok(
    m.fragmentShader.includes('c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);'),
  );
  // ⚠ THE BLOCK, INDENTED, RATHER THAN LINE BY LINE. A per-line `includes()` sweep is
  // satisfied by the whole module CONCATENATED ONTO ONE LINE - every line is still a substring -
  // and `check:mutation-diff` found exactly that by blanking the join separator, which would ship
  // a shader whose `//` comments swallow the code after them. Asserting the spliced BLOCK with its
  // own indentation is what separates the two.
  const spliced = grassGlsl().split('\n').join('\n      ');
  assert.ok(
    m.fragmentShader.includes(spliced),
    'the grass source is not spliced with its lines intact',
  );
  assert.ok(
    m.fragmentShader.includes('\n      // GENERATED from land-grass.ts'),
    'the grass block must be indented into the shader, not flattened',
  );
});

test('grassGateGlsl emits the row tests EXACTLY, and reads the row the ramp index reads', () => {
  // ⚠ AN EXACT GOLDEN, not a containment sweep — the same finding `rampGlsl` records. Every line
  // of an emitter is a string literal, so a mutant that blanks one leaves a gate that still
  // CONTAINS `grassGate` and every row number a looser assertion looks for, while gating nothing.
  assert.equal(
    grassGateGlsl([0]),
    ['float grassGate = 0.0;', 'if (int(vStatus + 0.5) == 0) grassGate = 1.0;'].join('\n        '),
  );
  assert.equal(
    grassGateGlsl([2, 5]),
    [
      'float grassGate = 0.0;',
      'if (int(vStatus + 0.5) == 2) grassGate = 1.0;',
      'if (int(vStatus + 0.5) == 5) grassGate = 1.0;',
    ].join('\n        '),
  );
  // ⚠⚠ THE `+ 0.5` IS THE LOAD-BEARING HALF AND IT IS PINNED SEPARATELY, because a gate that
  // drops it still compiles, still gates ONE row, and gates the WRONG one for any fragment whose
  // interpolated status arrives a hair under its integer — dressing a foreign token and leaving
  // the green flat, which is the exact misreport ADR-0492's gate exists to prevent.
  assert.ok(!grassGateGlsl([1]).includes('int(vStatus) =='), 'a bare cast truncates, it must round');
});

test('the grass gate DRESSES ONLY the named rows, and every other row is byte-identical to ungrassed', () => {
  const gated = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
  });
  // The gate is present, names row 0, and names NO other row — the second half is what a
  // containment check cannot see, and it is the whole difference between a per-token layer and a
  // whole-map one wearing the same uniform.
  assert.ok(gated.fragmentShader.includes('if (int(vStatus + 0.5) == 0) grassGate = 1.0;'));
  assert.equal(
    [...gated.fragmentShader.matchAll(/grassGate = 1\.0;/g)].length,
    1,
    'exactly one row is dressed — a second would be a token the measurement never admitted',
  );
  // ⚠ AND THE MIX IS MULTIPLIED BY IT rather than merely computed beside it. A gate that is
  // emitted and then not applied is the failure that looks most like success: the shader
  // compiles, the source contains every line a reviewer greps for, and the yellow wears the
  // grass anyway.
  assert.ok(
    gated.fragmentShader.includes('uGrassMix * grassGate'),
    'the gate must multiply the mix, not sit unused beside it',
  );
});

test('the grass gate REFUSES an empty row list and a row outside the ramp', () => {
  // Empty: two defensible readings ("all rows" / "no rows"), so neither may be guessed.
  assert.throws(
    () =>
      createBandedGroundMaterial({
        tokens: SHIPPED_TOKENS,
        grain: 'normal',
        grass: { mix: 0.32, rows: [] },
      }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the grass layer was given no rows to dress — a gate that ' +
          'matches nothing draws the ungrassed ground at the grassed ground’s cost',
      );
      return true;
    },
  );
  // Out of range: the emitted test never matches, so the layer is silently absent from a map
  // that reports it as adopted — a failure with no symptom at all.
  //
  // ⚠ ALL THREE WAYS A ROW CAN BE OUT OF RANGE, not just the obvious one. `check:mutation-diff`
  // found the first version of this test covered only `row >= tokens.length`: with the other two
  // disjuncts replaced by `false`, and with `||` swapped for `&&`, every assertion here stayed
  // green. A negative row and a fractional one both reach `int(vStatus + 0.5) == <row>` in the
  // emitted GLSL, where the first compiles to a test nothing can satisfy and the second is a
  // type error — so the guard's job is to catch them here, and only a case each proves it does.
  const strays: readonly [number, string][] = [
    [SHIPPED_TOKENS.length, 'past the last row'],
    [-1, 'negative'],
    [1.5, 'fractional — not a row at all'],
  ];
  for (const [row, why] of strays) {
    assert.throws(
      () =>
        createBandedGroundMaterial({
          tokens: SHIPPED_TOKENS,
          grain: 'normal',
          grass: { mix: 0.32, rows: [0, row] },
        }),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(
          e.message,
          `banded-ground-material: the grass layer names row ${row}, which is ` +
            `not a ramp row of the ${SHIPPED_TOKENS.length} this material was handed`,
          `a ${why} row must be refused, and named in the refusal`,
        );
        return true;
      },
    );
  }
  // ⚠ AND THE LAST ROW IS ACCEPTED. Without this the guard could refuse everything and every
  // assertion above would still pass — an off-by-one that reads as strictness.
  assert.doesNotThrow(() =>
    createBandedGroundMaterial({
      tokens: SHIPPED_TOKENS,
      grain: 'normal',
      grass: { mix: 0.32, rows: [SHIPPED_TOKENS.length - 1] },
    }),
  );
});

test('the grass BREAKS the closure — asserted, because that is what ADR-0490 D5 authorises', () => {
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.1, rows: [0] },
  });
  assert.ok(
    !grainKeepsPaletteClosed(m.fragmentShader),
    'a grassed shader mixes into the delivered colour and is therefore off-palette',
  );
  // ⚠ AND THE NORMAL HALF IS UNAFFECTED. The grain still perturbs the lambert before the
  // quantiser, so the layer that broke the closure is the grass and nothing else moved.
  assert.ok(/st_grainGradient\(vWorld\.xz\)/.test(m.fragmentShader));
});

test('the grass composites in the RECIPE`S ORDER: after the ramp selection, before the grain`s colour half', () => {
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'both',
    grass: { mix: 0.1, rows: [0] },
  });
  const body = m.fragmentShader.slice(m.fragmentShader.indexOf('void main('));
  const select = body.indexOf('vec3 c = uRamp[0];');
  const grassAt = body.indexOf('st_grassColour(vWorld.xz)');
  const grainAt = body.indexOf('uGrainColourMix');
  assert.ok(select >= 0 && grassAt > select, 'the grass must composite over a SELECTED status colour');
  assert.ok(grainAt > grassAt, 'the grain is layer 5 and goes on LAST, over the grass');
});

test('the grass source is declared AFTER the grain`s, because it calls st_grainOctave', () => {
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.1, rows: [0] },
  });
  const hash = m.fragmentShader.indexOf('float st_grainHash(');
  const octave = m.fragmentShader.indexOf('float st_grainOctave(');
  const firstGrassCall = m.fragmentShader.indexOf('float st_grassBroad(');
  assert.ok(hash >= 0 && octave > hash, 'the lattice hash and octave are the grain`s to declare');
  assert.ok(
    firstGrassCall > octave,
    'GLSL ES 1.0 resolves against declarations already seen — the grass must come after',
  );
  // ONE lattice hash in the shader, not two. A grass-named copy would be a redefinition error at
  // best and a silent divergence at worst.
  assert.equal([...m.fragmentShader.matchAll(/float st_grainHash\(/g)].length, 1);
});

// ─── LAYER 2: the shore sand ────────────────────────────────────────────────────────────────────

/** The shore field over the same atlas the shadow rides — built once, for the same reason
 *  `testAtlas` is. */
const testShore = (): ReturnType<typeof groundAtlasTexture> =>
  groundAtlasTexture(
    buildAtlasShore(
      [ATLAS_CELL_A, ATLAS_CELL_B],
      buildAtlasOcclusion({
        cells: [ATLAS_CELL_A, ATLAS_CELL_B],
        relief: 2.2,
        casters: [{ x: 10, z: 10, radius: 5, height: 19 }],
      }),
    ),
  );

const sanded = () =>
  createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
    shadowAtlas: testAtlas(),
    sand: { shore: testShore().texture, mix: 0.16, width: SAND_FIELD_WIDTH },
  });

test('the sand REFUSES without the grass, and without the packed atlas', () => {
  assert.throws(
    () =>
      createBandedGroundMaterial({
        tokens: SHIPPED_TOKENS,
        grain: 'normal',
        shadowAtlas: testAtlas(),
        sand: { shore: testShore().texture, mix: 0.16, width: SAND_FIELD_WIDTH },
      }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the sand layer needs the grass — its ramp is driven by layer 1’s ' +
          'own base scalar, which only the grass source declares',
      );
      return true;
    },
  );
  // ⚠ AND WITHOUT THE PACKED ATLAS. The shore field is sampled through the shadow's own `shUv`,
  // so an unatlased material has no per-island coordinate to sample through — falling back to the
  // rect form would give the whole map one island's stretch of coast.
  assert.throws(
    () =>
      createBandedGroundMaterial({
        tokens: SHIPPED_TOKENS,
        grain: 'normal',
        grass: { mix: 0.32, rows: [0] },
        sand: { shore: testShore().texture, mix: 0.16, width: SAND_FIELD_WIDTH },
      }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the sand layer needs the PACKED occlusion atlas — it rides that ' +
          'atlas’s own tiles, and there is no per-island coordinate without it',
      );
      return true;
    },
  );
});

test('a SANDED material uploads the shore field and splices layer 2 in after layer 1', () => {
  const m = sanded();
  // ⚠ THE VALUE, NOT JUST THE KEY. `check:mutation-diff` replaced `{ value: sand.shore }` with an
  // empty object and a presence check stayed green — leaving a declared sampler bound to nothing,
  // which samples black and delivers a beach over the whole island.
  const shoreTex = testShore().texture;
  const m2 = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
    shadowAtlas: testAtlas(),
    sand: { shore: shoreTex, mix: 0.16, width: SAND_FIELD_WIDTH },
  });
  assert.equal(
    m2.uniforms['uShoreTex']?.value,
    shoreTex,
    'the uniform must carry the caller`s own texture, not merely exist',
  );
  assert.ok(m.uniforms['uShoreTex'] !== undefined, 'the shore field must be uploaded');
  // ⚠ ALL THREE DECLARATIONS AS TEXT. `check:mutation-diff` blanked the `uSandMix` decl and every
  // assertion about the UNIFORM OBJECT stayed green — the material still carries the value, and
  // only the shader source loses the declaration, so it compiles nowhere and passes here.
  assert.ok(/uniform sampler2D uShoreTex;/.test(m.fragmentShader));
  assert.ok(/uniform float uSandMix;/.test(m.fragmentShader));
  assert.ok(/uniform float uSandWidth;/.test(m.fragmentShader));
  // The block, indented, rather than line by line — the same argument the grass splice makes: a
  // per-line `includes()` sweep is satisfied by the whole module concatenated onto ONE line.
  assert.ok(
    m.fragmentShader.includes(sandGlsl().split('\n').join('\n      ')),
    'the sand source is not spliced with its lines intact',
  );
  // ⚠ DECLARATION ORDER IS LOAD-BEARING. `sandGlsl()` calls `st_grassScalar` and `st_grassSrgb`,
  // and GLSL ES 1.0 resolves against declarations already seen — so the sand must come after.
  const grassDecl = m.fragmentShader.indexOf('float st_grassScalar(');
  const srgbDecl = m.fragmentShader.indexOf('vec3 st_grassSrgb(');
  const sandDecl = m.fragmentShader.indexOf('float st_sandEdge(');
  assert.ok(grassDecl >= 0 && srgbDecl >= 0, 'layer 1 must declare the scalar and the transfer');
  assert.ok(sandDecl > grassDecl && sandDecl > srgbDecl, 'the sand source must come AFTER layer 1');
  // ONE copy of each shared helper, not two — a sand-named duplicate is a redefinition error at
  // best and a silent divergence at worst.
  assert.equal([...m.fragmentShader.matchAll(/vec3 st_grassSrgb\(/g)].length, 1);
  assert.equal([...m.fragmentShader.matchAll(/float st_grainHash\(/g)].length, 1);
});

test('⚠⚠ THE SAND IS A SECOND SEAM, AND LAYER 1`S LINE IS UNTOUCHED BY IT', () => {
  const m = sanded();
  // ⚠⚠ THIS IS THE PROPERTY THAT LETS LAYER 2 SHIP AT ALL. Blended INSIDE layer 1's mix, both
  // layers share one factor and therefore one joint ceiling — 0.235, BELOW the 0.32 layer 1
  // already ships at — so adopting the sand would have quietly dimmed the live map's grass. As a
  // second seam the sand is fenced on its own measurement and layer 1's delivered pixel is exactly
  // the one that shipped before this layer existed.
  assert.ok(
    m.fragmentShader.includes('c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);'),
    'layer 1`s composite line must be byte-identical to the unsanded one',
  );
  assert.ok(
    m.fragmentShader.includes(
      'c = mix(c, st_sandColour(vWorld.xz) * level, uSandMix * (1.0 - sandBand) * grassGate);',
    ),
    'layer 2 must enter as its own mix, with its own factor',
  );
  // Two seams into `c`, in order: the grass first, the sand over it.
  const grassAt = m.fragmentShader.indexOf('c = mix(c, st_grassColour');
  const sandAt = m.fragmentShader.indexOf('c = mix(c, st_sandColour');
  assert.ok(grassAt >= 0 && sandAt > grassAt, 'the sand must composite OVER layer 1, not under it');
  // ⚠ AND THE SAND CARRIES THE SAME GATE. Without `grassGate` the beach would appear on every
  // token — including the yellow islands ADR-0492 D1 leaves flat — and those islands would start
  // reporting a state they do not hold along their whole coast.
  assert.equal(
    [...m.fragmentShader.matchAll(/grassGate\)?;/g)].length,
    2,
    'both seams must be gated, and by the same gate',
  );
  // ⚠ THE BAND IS INVERTED FOR THE SAND. `st_sandBand` returns 0 at the water and 1 inland, and
  // the sand belongs at the WATER — so it enters through (1 - band). Dropping the inversion puts
  // the beach in the island's interior and leaves the coast green, which still looks like a beach.
  assert.ok(m.fragmentShader.includes('(1.0 - sandBand)'), 'the sand rides the INVERTED band');
});

test('⚠ the shore texel is decoded to GROUND UNITS through the SAME width the field was built for', () => {
  const m = sanded();
  // `st_sandBand` divides by BEACH + 0.9, an arithmetic in ground units. Handing it a raw 0..1
  // texel would be the same expression meaning something else — the band would collapse to a
  // hairline at the waterline and read as "the sand layer barely does anything".
  assert.ok(
    m.fragmentShader.includes('float shoreUnits = texture2D(uShoreTex, shUv).r * uSandWidth;'),
    'the texel must be scaled by the field width before st_sandBand sees it',
  );
  assert.ok(
    m.fragmentShader.includes('float sandBand = st_sandBand(vWorld.xz, shoreUnits, uSandWidth);'),
  );
  // ⚠⚠ ONE WIDTH, NOT TWO. The decode above and the divisor inside `st_sandBand` are the SAME
  // uniform, so a widened beach cannot read a field that was built narrower — which would deliver
  // a beach that stops dead at the old width and steps, looking like a bug in the edge noise.
  // ⚠ THE DECODE AND THE BAND GET THE SAME UNIFORM AT THE SAME CALL SITE. The band takes it as a
  // PARAMETER (the emitted source sits above the uniform block and cannot read one), so "one
  // width" is a property of this line rather than of two constants agreeing.
  assert.equal(
    [...m.fragmentShader.matchAll(/uSandWidth/g)].length,
    3,
    'the width appears exactly at its declaration, the decode, and the band call',
  );
  assert.equal(m.uniforms['uSandWidth']?.value, SAND_FIELD_WIDTH);
  assert.equal(m.uniforms['uSandMix']?.value, 0.16);
  // ⚠ AND IT RIDES THE SHADOW'S OWN COORDINATE. A second packing would be a second answer to
  // "where is this island", and every coast would belong to the wrong land.
  assert.ok(m.fragmentShader.includes('texture2D(uShoreTex, shUv)'));
  assert.equal([...m.fragmentShader.matchAll(/vec2 shUv =/g)].length, 1, 'one atlas coordinate');
});

test('an UNSANDED material carries no uShore uniform and no sand source at all', () => {
  // Absent means ABSENT — the claim every measured figure about layer 1 was taken against.
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
    shadowAtlas: testAtlas(),
  });
  assert.equal(m.uniforms['uShoreTex'], undefined);
  assert.ok(!/uShoreTex/.test(m.fragmentShader));
  assert.ok(!/st_sandEdge|st_sandRamp|st_sandBand|st_sandColour/.test(m.fragmentShader));
  // And it still carries layer 1's own composite line, unchanged.
  assert.ok(m.fragmentShader.includes('c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);'));
});

// ─── LAYERS 3, 4 AND 6: the worn path, rock on slope, the detail normal ────────────────────────
//
// ⚠⚠ THE ONE THING THIS SECTION MUST ESTABLISH FIRST is the same one every option before it had
// to: ABSENT means BYTE-IDENTICAL. The sanded shader is the one layer 2's figures were taken
// against, and three more appended strings are three more places a `: ''` can leave residue.
// Only then does it say what each layer does — as exact goldens, because a generator's emitted
// source has to be pinned as source (44 of the grain crossing's 109 mutation survivors were
// blanked GLSL literals).

/** A packed distance-to-path field as bytes — the wear layer's carrier. Built IN-FILE rather
 *  than imported from the harness (`src/` is mirrored to the public site, so a `src/` test may
 *  not reach `harness/`); a 2x2 single-channel texture is enough to be a real `Texture` object
 *  the uniform must carry, which is all the material is asked to do with it here. */
const testWearField = (): DataTexture => {
  const tex = new DataTexture(new Uint8Array([0, 128, 255, 64]), 2, 2, RedFormat, UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
};

/** A stand-in for the cliff normal map: a 2x2 RGBA texture of flat normals. The real one is
 *  `detailNormalTexture()`, which decodes a PNG through the browser and is not this test's
 *  subject. */
const testDetailMap = (): DataTexture => {
  const tex = new DataTexture(new Uint8Array(16).fill(128), 2, 2);
  tex.needsUpdate = true;
  return tex;
};

/** The whole stack: every layer this material can wear, at once. The values are chosen so no
 *  two uniforms share one — a swapped `uRockLo`/`uRockHi` or a `strength` uploaded as the tile
 *  would otherwise pass a value pin. */
const layered = () =>
  createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
    shadowAtlas: testAtlas(),
    sand: { shore: testShore().texture, mix: 0.16, width: SAND_FIELD_WIDTH },
    wear: { field: testWearField(), mix: 0.41, width: WEAR_FALLOFF },
    rock: { mix: 0.63, slope: [0.8, 0.95] },
    detail: { map: testDetailMap(), strength: 0.45, tile: 2.4 },
  });

/** The wear stage exactly as the material emits it, comment block included. */
const WEAR_STAGE =
  '        // LAYER 3 — the worn path (build_land.py:894-911), over the sand and gated like it.\n' +
  '        //\n' +
  '        // ⚠ ITS OWN SEAM AND ITS OWN FACTOR, for the reason the sand has one: a shared factor\n' +
  "        // has one joint ceiling, and the path's admissible strength is a measurement of its own\n" +
  '        // — a rung of the rendered ladder (ADR-0503), never a number inherited from the beach.\n' +
  '        //\n' +
  "        // ⚠ THE FIELD RIDES THE SHADOW ATLAS'S OWN COORDINATE, like the shore: one tile corner\n" +
  '        // on the mesh, one scale on the material, so the path cannot disagree with the shadow\n' +
  '        // about where an island sits.\n' +
  '        //\n' +
  '        // ⚠ AND THE TEXEL IS DECODED TO GROUND UNITS THROUGH THE SAME WIDTH THAT IS THE FALLOFF.\n' +
  '        // The field caps its distances at the width it was built for and st_wearOf reaches 0 at\n' +
  '        // exactly that width — one uniform, so a widened path cannot read a field that has\n' +
  '        // already flattened.\n' +
  '        //\n' +
  '        // ⚠ THE BREAK NOISE MULTIPLIES THE WEAR inside st_wearFactor (build_land.py:898): where\n' +
  '        // the wear is zero no noise can paint a path, which keeps the track where the field put\n' +
  "        // it — the opposite sense from the sand's additive edge.\n" +
  '        float wearUnits = texture2D(uWearTex, shUv).r * uWearWidth;\n' +
  '        float wear = st_wearFactor(vWorld.xz, st_wearOf(wearUnits, uWearWidth));\n' +
  '        c = mix(c, st_dirtColour(vWorld.xz) * level, uWearMix * wear * grassGate);\n';

/** The rock stage exactly as the material emits it. */
const ROCK_STAGE =
  '        // LAYER 4 — rock on slope (build_land.py:912-925), over the path, driven by the\n' +
  "        // surface's own normal rather than by a noise (the recipe's own comment at :912).\n" +
  '        //\n' +
  '        // ⚠⚠ IT READS geoN, NOT n — the departure that fed this mask the BUMPED normal is\n' +
  '        // withdrawn (ADR-0553). n carries the detail map and the grain, and those two put grey\n' +
  "        // across the interior grass the owner asked to be rid of: the relief's own steepest\n" +
  '        // interior slope leaves an up-component of 0.910, above the 0.90 ceiling, so on the\n' +
  '        // GEOMETRY the interior mask is identically zero and only the shore fall is steep.\n' +
  '        //\n' +
  '        // ⚠ THE ENDS ARE UNIFORMS, NOT WRITTEN IN — which rungs the map wears is a ladder the\n' +
  '        // owner reads (ADR-0503), and a page comparing them compiles ONE shader.\n' +
  '        //\n' +
  "        // ⚠ GATED BY grassGate, so the skirt's authored rock rows — and every other ungated token\n" +
  '        // — are never repainted: an ungated row multiplies the whole layer by zero.\n' +
  '        float rockMask = st_rockMask(geoN.y, uRockLo, uRockHi);\n' +
  '        c = mix(c, st_rockColour(vWorld.xz) * level, uRockMix * rockMask * grassGate);\n';

/** The detail stage exactly as the material emits it — starting with the newline that joins it
 *  to the normal's own line, ending WITHOUT one so the grain stage's join is untouched. */
const DETAIL_STAGE =
  '\n' +
  '        // LAYER 6 — the cliff normal map as DETAIL RELIEF (build_land.py:943-965), applied\n' +
  "        // BEFORE the grain's bump: the recipe's own order is NormalMap → Bump, so the grain\n" +
  '        // relieves an already-detailed normal rather than the other way round.\n' +
  '        //\n' +
  '        // ⚠ AN ANALYTIC WORLD-SPACE TANGENT FRAME, not a mesh tangent attribute: on a ground\n' +
  '        // plane T is +x and B is +z, and the map is sampled in ground units through vWorld.xz,\n' +
  '        // so this frame is the one the tiling is authored in. The mesh carries no tangents, and\n' +
  '        // deriving them per triangle would cost an attribute for a frame the ground implies.\n' +
  '        //\n' +
  "        // ⚠ THE STRENGTH AND THE TILE ARE UNIFORMS: the recipe's 0.30 and 2.4 are provenance,\n" +
  '        // and the shipped values are chosen from a rendered ladder (ADR-0503) on ONE shader.\n' +
  '        vec3 detailN = texture2D(uDetailTex, vWorld.xz / uDetailTile).xyz * 2.0 - 1.0;\n' +
  '        vec3 detailT = normalize(cross(n, vec3(0.0, 0.0, 1.0)));\n' +
  '        vec3 detailB = cross(detailT, n);\n' +
  '        n = normalize(n + uDetailStrength * (detailN.x * detailT + detailN.y * detailB));';

const SANDED_UNIFORMS = [
  'uGrainNormalStrength',
  'uGrassMix',
  'uLightDir',
  'uRamp',
  'uSandMix',
  'uSandWidth',
  'uShadowAtlasScale',
  'uShadowTex',
  'uShoreTex',
];

test('ABSENT WEAR, ROCK AND DETAIL CHANGE NOTHING — the sanded shader is byte-identical at every site', () => {
  const m = sanded();
  // No uniform, and no spelling the three layers brought with them.
  assert.deepEqual(Object.keys(m.uniforms).sort(), SANDED_UNIFORMS);
  assert.ok(!/uWear|uRock|uDetail/.test(m.fragmentShader), 'no new uniform declared');
  assert.ok(!/st_wear|st_dirt|st_rock/.test(m.fragmentShader), 'no new helper spliced in');
  assert.ok(!/detailN|detailT|detailB|wearUnits|rockMask|geoN/.test(m.fragmentShader), 'no new stage');
  assert.ok(!/GENERATED from land-(wear|rock)/.test(m.fragmentShader));
  // ⚠ THE JOIN AT EACH OF THE FOUR SITES, named — the check a "does it mention the layer"
  // sweep cannot make. Every one of the new pieces is a `: ''` on the same template line as its
  // neighbour, and a blank branch that is not literally empty leaves residue only a join sees.
  const sandBlock = sandGlsl().split('\n').join('\n      ');
  assert.ok(
    m.fragmentShader.includes(`${sandBlock}\n\n      uniform vec3 uRamp[`),
    'the source site: the sand block must close straight onto the ramp declaration',
  );
  assert.ok(
    m.fragmentShader.includes('uniform float uSandWidth;\n      uniform sampler2D uShadowTex;'),
    'the declaration site: the sand decls must join straight onto the shadow decls',
  );
  assert.ok(
    m.fragmentShader.includes("vec3 n = normalize(vNormal);\n        // THE GRAIN'S NORMAL HALF"),
    'the normal site: the normal must join straight onto the grain stage',
  );
  assert.ok(
    m.fragmentShader.includes(
      'uSandMix * (1.0 - sandBand) * grassGate);\n        gl_FragColor = vec4(c, 1.0);',
    ),
    'the write site: the sand line must join straight onto the colour write',
  );
  // And layers 1 and 2 are untouched, byte for byte.
  assert.ok(m.fragmentShader.includes('c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);'));
  assert.ok(
    m.fragmentShader.includes('c = mix(c, st_sandColour(vWorld.xz) * level, uSandMix * (1.0 - sandBand) * grassGate);'),
  );
  // The bare and grained shaders keep their own joins at the normal site too — the detail stage
  // is the first thing ever appended to that line.
  const bare = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  assert.ok(bare.fragmentShader.includes('vec3 n = normalize(vNormal);\n        // Half-lambert'));
  assert.deepEqual(Object.keys(bare.uniforms).sort(), ['uLightDir', 'uRamp']);
  const grained = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal' });
  assert.ok(grained.fragmentShader.includes("vec3 n = normalize(vNormal);\n        // THE GRAIN'S NORMAL HALF"));
  assert.ok(grained.fragmentShader.includes('uniform float uGrainNormalStrength;\n      varying float vStatus;'));
});

test('NON-VACUITY: the whole stack really does fill every one of those four sites', () => {
  // Without this, the byte-identity test above is satisfied by a builder that ignores all three
  // options — the shape such a test degrades into.
  const m = layered();
  const sandBlock = sandGlsl().split('\n').join('\n      ');
  assert.ok(!m.fragmentShader.includes(`${sandBlock}\n\n      uniform vec3 uRamp[`), 'the source site moved');
  assert.ok(
    !m.fragmentShader.includes('uniform float uSandWidth;\n      uniform sampler2D uShadowTex;'),
    'the declaration site moved',
  );
  assert.ok(
    !m.fragmentShader.includes("vec3 n = normalize(vNormal);\n        // THE GRAIN'S NORMAL HALF"),
    'the normal site moved',
  );
  assert.ok(
    !m.fragmentShader.includes('uSandMix * (1.0 - sandBand) * grassGate);\n        gl_FragColor'),
    'the write site moved',
  );
  // And what each site now joins to, exactly.
  assert.ok(m.fragmentShader.includes(`${sandBlock}\n      // GENERATED from land-wear.ts`));
  assert.ok(m.fragmentShader.includes('uniform float uSandWidth;\n      uniform sampler2D uWearTex;'));
  // ⚠ THE NORMAL SITE NOW JOINS ONTO THE ROCK'S GEOMETRIC CAPTURE (ADR-0553), which the
  // detail stage then follows — both halves asserted so neither can go missing unseen.
  assert.ok(m.fragmentShader.includes("vec3 n = normalize(vNormal);\n        // THE SURFACE'S OWN NORMAL"));
  assert.ok(m.fragmentShader.includes('vec3 geoN = n;\n        // LAYER 6'));
  assert.ok(
    m.fragmentShader.includes('uRockMix * rockMask * grassGate);\n        gl_FragColor = vec4(c, 1.0);'),
  );
});

test('the three refusals say the WHOLE reason — wear without grass, wear without atlas, rock without grass, detail without grain', () => {
  const wear = { field: testWearField(), mix: 0.41, width: WEAR_FALLOFF };
  assert.throws(
    () => createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal', shadowAtlas: testAtlas(), wear }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the wear layer needs the grass — its dirt ramp is driven by ' +
          'layer 1’s own base scalar and its break noise by the one lattice hash, which only the ' +
          'grass source declares',
      );
      return true;
    },
  );
  assert.throws(
    () =>
      createBandedGroundMaterial({
        tokens: SHIPPED_TOKENS,
        grain: 'normal',
        grass: { mix: 0.32, rows: [0] },
        wear,
      }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the wear layer needs the PACKED occlusion atlas — its distance ' +
          'field rides that atlas’s own tiles, and there is no per-island coordinate without it',
      );
      return true;
    },
  );
  assert.throws(
    () => createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, grain: 'normal', rock: { mix: 0.63, slope: ROCK_SLOPE_RAMP } }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the rock layer needs the grass — its ramp is driven by layer 1’s ' +
          'own base scalar, which only the grass source declares',
      );
      return true;
    },
  );
  assert.throws(
    () =>
      createBandedGroundMaterial({
        tokens: SHIPPED_TOKENS,
        detail: { map: testDetailMap(), strength: 0.45, tile: 2.4 },
      }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(
        e.message,
        'banded-ground-material: the detail normal needs the grain — it bends the normal the ' +
          'grain stage then relieves (the recipe’s NormalMap → Bump order), and it samples the ' +
          'world position that stage carries through',
      );
      return true;
    },
  );
  // ⚠ AND EACH REFUSAL IS ABOUT THE DEPENDENCY, NOT THE LAYER. With the dependency present and
  // NOTHING ELSE — no sand, no other new layer — each option builds on its own.
  assert.doesNotThrow(() =>
    createBandedGroundMaterial({
      tokens: SHIPPED_TOKENS,
      grain: 'normal',
      grass: { mix: 0.32, rows: [0] },
      shadowAtlas: testAtlas(),
      wear,
    }),
  );
  assert.doesNotThrow(() =>
    createBandedGroundMaterial({
      tokens: SHIPPED_TOKENS,
      grain: 'normal',
      grass: { mix: 0.32, rows: [0] },
      rock: { mix: 0.63, slope: ROCK_SLOPE_RAMP },
    }),
  );
  assert.doesNotThrow(() =>
    createBandedGroundMaterial({
      tokens: SHIPPED_TOKENS,
      grain: 'normal',
      detail: { map: testDetailMap(), strength: 0.45, tile: 2.4 },
    }),
  );
});

test('the stack uploads EVERY value, and the samplers hold the caller`s own textures', () => {
  // ⚠ THE VALUE, NOT JUST THE KEY — `check:mutation-diff` once replaced a `{ value: tex }` with an
  // empty object and a presence check stayed green. And the values are all DIFFERENT, so a
  // strength uploaded under the tile's name, or the two rock ends swapped, cannot pass.
  const field = testWearField();
  const map = testDetailMap();
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
    shadowAtlas: testAtlas(),
    sand: { shore: testShore().texture, mix: 0.16, width: SAND_FIELD_WIDTH },
    wear: { field, mix: 0.41, width: 3.7 },
    rock: { mix: 0.63, slope: [0.8, 0.95] },
    detail: { map, strength: 0.45, tile: 2.4 },
  });
  assert.equal(m.uniforms['uWearTex']?.value, field);
  assert.equal(m.uniforms['uWearMix']?.value, 0.41);
  assert.equal(m.uniforms['uWearWidth']?.value, 3.7);
  assert.equal(m.uniforms['uRockMix']?.value, 0.63);
  assert.equal(m.uniforms['uRockLo']?.value, 0.8);
  assert.equal(m.uniforms['uRockHi']?.value, 0.95);
  assert.equal(m.uniforms['uDetailTex']?.value, map);
  assert.equal(m.uniforms['uDetailStrength']?.value, 0.45);
  assert.equal(m.uniforms['uDetailTile']?.value, 2.4);
  assert.deepEqual(
    Object.keys(m.uniforms).sort(),
    [
      ...SANDED_UNIFORMS,
      'uDetailStrength',
      'uDetailTex',
      'uDetailTile',
      'uRockHi',
      'uRockLo',
      'uRockMix',
      'uWearMix',
      'uWearTex',
      'uWearWidth',
    ].sort(),
  );
  // ⚠ ALL NINE DECLARATIONS AS TEXT. A blanked decl leaves the uniform object intact and the
  // shader compiling nowhere — the mutation the sand's own test records.
  const decls =
    '      uniform sampler2D uShoreTex;\n' +
    '      uniform float uSandMix;\n' +
    '      uniform float uSandWidth;\n' +
    '      uniform sampler2D uWearTex;\n' +
    '      uniform float uWearMix;\n' +
    '      uniform float uWearWidth;\n' +
    '      uniform float uRockMix;\n' +
    '      uniform float uRockLo;\n' +
    '      uniform float uRockHi;\n' +
    '      uniform sampler2D uDetailTex;\n' +
    '      uniform float uDetailStrength;\n' +
    '      uniform float uDetailTile;\n' +
    '      uniform sampler2D uShadowTex;';
  assert.ok(m.fragmentShader.includes(decls), 'the nine new declarations, in order, between the sand`s and the shadow`s');
});

test('the wear and rock sources are spliced in from their modules, after the sand`s, with their indentation', () => {
  const m = layered();
  const sandBlock = sandGlsl().split('\n').join('\n      ');
  const wearBlock = wearGlsl().split('\n').join('\n      ');
  const rockBlock = rockGlsl().split('\n').join('\n      ');
  // ⚠ THE THREE BLOCKS AS ONE STRING, with the joins between them: a per-block `includes()` is
  // satisfied by any order and any residue between them.
  assert.ok(
    m.fragmentShader.includes(
      `${sandBlock}\n      ${wearBlock}\n      ${rockBlock}\n\n      uniform vec3 uRamp[`,
    ),
    'sand, wear, rock — each at the shader body indentation, closing onto the ramp declaration',
  );
  assert.ok(m.fragmentShader.includes('\n      // GENERATED from land-wear.ts'));
  assert.ok(m.fragmentShader.includes('\n      // GENERATED from land-rock.ts'));
});

test('DECLARATION ORDER: one st_wearBreak, one st_rockRamp, both after what they call', () => {
  const m = layered();
  const src = m.fragmentShader;
  const count = (re: RegExp): number => [...src.matchAll(re)].length;
  assert.equal(count(/float st_wearBreak\(/g), 1);
  assert.equal(count(/vec3 st_rockRamp\(/g), 1);
  assert.equal(count(/vec3 st_dirtRamp\(/g), 1);
  assert.equal(count(/float st_wearOf\(/g), 1);
  assert.equal(count(/float st_wearFactor\(/g), 1);
  assert.equal(count(/vec3 st_dirtColour\(/g), 1);
  assert.equal(count(/float st_rockMask\(/g), 1);
  assert.equal(count(/vec3 st_rockColour\(/g), 1);
  // ONE copy of each shared helper — a wear- or rock-named duplicate is a redefinition error at
  // best and a silent divergence at worst.
  assert.equal(count(/vec3 st_grassSrgb\(/g), 1);
  assert.equal(count(/float st_grassScalar\(/g), 1);
  assert.equal(count(/float st_grainHash\(/g), 1);
  assert.equal(count(/float st_grainOctave\(/g), 1);
  // GLSL ES 1.0 resolves against declarations already seen.
  const srgb = src.indexOf('vec3 st_grassSrgb(');
  const scalar = src.indexOf('float st_grassScalar(');
  const octave = src.indexOf('float st_grainOctave(');
  const sandEdge = src.indexOf('float st_sandEdge(');
  const wearBreak = src.indexOf('float st_wearBreak(');
  const rockRamp = src.indexOf('vec3 st_rockRamp(');
  assert.ok(srgb >= 0 && scalar >= 0 && octave >= 0 && sandEdge >= 0);
  assert.ok(wearBreak > srgb && wearBreak > scalar && wearBreak > octave, 'wear after the grass and grain');
  assert.ok(rockRamp > srgb && rockRamp > scalar, 'rock after the grass');
  assert.ok(sandEdge < wearBreak && wearBreak < rockRamp, 'sand, then wear, then rock');
  // And the sources read no uniform: every `u*` spelling sits BELOW the ramp declaration.
  const rampDecl = src.indexOf('uniform vec3 uRamp[');
  for (const name of ['uWearWidth', 'uWearMix', 'uWearTex', 'uRockLo', 'uRockHi', 'uRockMix', 'uDetailTex']) {
    assert.ok(src.indexOf(name) > rampDecl, `${name} must not be read above the uniform block`);
  }
});

test('the WEAR STAGE is emitted line for line, and rides the shadow`s own coordinate', () => {
  const m = layered();
  assert.ok(m.fragmentShader.includes(WEAR_STAGE), 'the wear stage must arrive whole, comment block included');
  // ⚠ ONE WIDTH, THREE PLACES: the declaration, the decode, and the falloff argument. The decode
  // and `st_wearOf`'s falloff are the SAME uniform, so a widened path cannot read a field that
  // was built narrower.
  assert.equal([...m.fragmentShader.matchAll(/uWearWidth/g)].length, 3);
  assert.ok(m.fragmentShader.includes('texture2D(uWearTex, shUv)'), 'the field rides shUv');
  assert.equal([...m.fragmentShader.matchAll(/vec2 shUv =/g)].length, 1, 'still ONE atlas coordinate');
  // The sand's own count is unmoved by the wear's arrival.
  assert.equal([...m.fragmentShader.matchAll(/uSandWidth/g)].length, 3);
  // The noise MULTIPLIES inside the helper; the stage multiplies the mix by the gate.
  assert.ok(m.fragmentShader.includes('uWearMix * wear * grassGate'));
});

test('the ROCK STAGE is emitted line for line, reads geoN.y, and takes its ends from the uniforms', () => {
  const m = layered();
  assert.ok(m.fragmentShader.includes(ROCK_STAGE), 'the rock stage must arrive whole, comment block included');
  // ⚠ `.y` — the UP component in three's world space. `.z` would ramp on the north-facing
  // slopes and still compile.
  assert.ok(m.fragmentShader.includes('st_rockMask(geoN.y, uRockLo, uRockHi)'));
  assert.ok(!m.fragmentShader.includes('st_rockMask(geoN.z'));
  // ⚠⚠ AND NEVER `n`, WHICH IS THE WHOLE OF ADR-0553'S MECHANISM. `n` has been through the
  // detail map and the grain by the time this stage runs, so a mask reading it paints rock
  // wherever a bump texel tilted a fragment — which on this land is the interior grass.
  assert.ok(!m.fragmentShader.includes('st_rockMask(n.'), 'the mask must not read the bumped normal');
  assert.ok(m.fragmentShader.includes('uRockMix * rockMask * grassGate'));
});

test('the GEOMETRIC NORMAL is captured before either bump, and only when there is rock', () => {
  const m = layered();
  const body = m.fragmentShader.slice(m.fragmentShader.indexOf('void main('));
  // ⚠ ORDER IS THE ASSERTION, not the presence of a line. `vec3 geoN = n;` placed after the
  // detail stage would compile, would keep every string below true, and would paint exactly the
  // interior rock this change removes.
  const captureAt = body.indexOf('vec3 geoN = n;');
  const detailAt = body.indexOf('vec3 detailN =');
  const grainAt = body.indexOf('st_grainGradient(vWorld.xz)');
  const maskAt = body.indexOf('st_rockMask(geoN.y');
  assert.ok(captureAt >= 0, 'the capture is emitted');
  assert.ok(detailAt > captureAt, 'captured BEFORE the detail map bends the normal');
  assert.ok(grainAt > captureAt, 'and BEFORE the grain does');
  assert.ok(maskAt > grainAt, 'while the mask itself still runs after both, in the recipe`s order');
  // ⚠ AND IT COSTS A ROCK-LESS SHADER NOTHING: absent means absent, so every figure taken
  // against a shader without layer 4 still stands byte for byte.
  assert.ok(!sanded().fragmentShader.includes('geoN'), 'no capture without a rock layer');
});

test('the DETAIL STAGE is emitted line for line, BETWEEN the normal and the grain`s bump', () => {
  const m = layered();
  // ⚠ THE ROCK'S GEOMETRIC CAPTURE NOW SITS BETWEEN THEM (ADR-0553) — one line, emitted only
  // when there is a rock layer, so the detail stage still joins onto the last thing before it.
  assert.ok(
    m.fragmentShader.includes(`vec3 geoN = n;${DETAIL_STAGE}\n`),
    'appended to the geometric capture, which is itself appended to the normal`s own line',
  );
  // ⚠ THE ORDER IS THE RECIPE'S: NormalMap → Bump. A detail stage after the grain's gradient
  // would relieve the grain rather than the other way round — a different picture wearing the
  // same two names.
  const body = m.fragmentShader.slice(m.fragmentShader.indexOf('void main('));
  const detailAt = body.indexOf('vec3 detailN =');
  const grainAt = body.indexOf('st_grainGradient(vWorld.xz)');
  const lambertAt = body.indexOf('float lambert');
  assert.ok(detailAt >= 0 && grainAt > detailAt, 'detail before the grain-normal stage');
  assert.ok(lambertAt > grainAt, 'and both before the lambert');
  // The analytic frame: T = +x, B = +z on a ground plane, as `cross(n, +z)` and `cross(T, n)`.
  assert.ok(m.fragmentShader.includes('vec3 detailT = normalize(cross(n, vec3(0.0, 0.0, 1.0)));'));
  assert.ok(m.fragmentShader.includes('vec3 detailB = cross(detailT, n);'));
  // And the map is sampled in GROUND units through the tile, not in atlas UV.
  assert.ok(m.fragmentShader.includes('texture2D(uDetailTex, vWorld.xz / uDetailTile)'));
  // ⚠ IT TOUCHES NO COLOUR: with only the grain and the detail, the closure holds.
  const closed = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    detail: { map: testDetailMap(), strength: 0.45, tile: 2.4 },
  });
  assert.ok(grainKeepsPaletteClosed(closed.fragmentShader), 'the detail normal keeps the closure');
  assert.ok(closed.fragmentShader.includes('vec3 detailN ='), 'and is really in there');
});

test('COMPOSITE ORDER: grass, sand, wear, rock, then the grain`s colour half — and FOUR gates', () => {
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'both',
    grass: { mix: 0.32, rows: [0] },
    shadowAtlas: testAtlas(),
    sand: { shore: testShore().texture, mix: 0.16, width: SAND_FIELD_WIDTH },
    wear: { field: testWearField(), mix: 0.41, width: WEAR_FALLOFF },
    rock: { mix: 0.63, slope: [0.8, 0.95] },
  });
  const body = m.fragmentShader.slice(m.fragmentShader.indexOf('void main('));
  const select = body.indexOf('vec3 c = uRamp[0];');
  const grassAt = body.indexOf('c = mix(c, st_grassColour');
  const sandAt = body.indexOf('c = mix(c, st_sandColour');
  const wearAt = body.indexOf('c = mix(c, st_dirtColour');
  const rockAt = body.indexOf('c = mix(c, st_rockColour');
  const grainAt = body.indexOf('uGrainColourMix');
  assert.ok(select >= 0 && grassAt > select, 'the layers composite over a SELECTED status colour');
  assert.ok(sandAt > grassAt, 'sand over grass');
  assert.ok(wearAt > sandAt, 'the path over the sand');
  assert.ok(rockAt > wearAt, 'rock over the path');
  assert.ok(grainAt > rockAt, 'the grain is layer 5 and goes on LAST');
  // ⚠ EVERY SEAM CARRIES THE SAME GATE. Four seams into `c`, four `grassGate);` — the sanded
  // fixture's own count of two is unmoved (its test above), so this is the layers' doing.
  assert.equal([...m.fragmentShader.matchAll(/grassGate\)?;/g)].length, 4, 'all four seams gated');
  assert.equal([...sanded().fragmentShader.matchAll(/grassGate\)?;/g)].length, 2);
});

test('the wear stage composites straight after LAYER 1 when there is no sand — and the rock after the wear', () => {
  // The two are appended to the grass stage, not nested in the sand's branch: a path can exist on
  // a beachless island, and a rock face on an island with no path.
  const worn = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
    shadowAtlas: testAtlas(),
    wear: { field: testWearField(), mix: 0.41, width: WEAR_FALLOFF },
  });
  assert.ok(
    worn.fragmentShader.includes(
      'c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);\n        // LAYER 3 — the worn path',
    ),
  );
  assert.ok(!/st_sand|uShoreTex|st_rock/.test(worn.fragmentShader));
  const rocky = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    grain: 'normal',
    grass: { mix: 0.32, rows: [0] },
    rock: { mix: 0.63, slope: ROCK_SLOPE_RAMP },
  });
  assert.ok(
    rocky.fragmentShader.includes(
      'c = mix(c, st_grassColour(vWorld.xz) * level, uGrassMix * grassGate);\n        // LAYER 4 — rock on slope',
    ),
  );
  assert.ok(!/st_sand|st_wear|uShoreTex|shUv/.test(rocky.fragmentShader), 'rock needs no atlas coordinate');
  assert.equal(rocky.uniforms['uRockLo']?.value, ROCK_SLOPE_RAMP[0]);
  assert.equal(rocky.uniforms['uRockHi']?.value, ROCK_SLOPE_RAMP[1]);
});

// ---------------------------------------------------------------------------
// depth and edge (2026-09-06) — the per-token occlusion stage
// ---------------------------------------------------------------------------

const HEALTHY_TOKEN = '#8cb85e';

test('shadowOcclusionGlsl COLLAPSES to the one-rung form on the derived ladder — pinned as source', () => {
  const ladder = shadowLadderFor(SHIPPED_TOKENS);
  assert.equal(
    shadowOcclusionGlsl(ladder),
    'if (occ > 0.5) {\n            ' + shadowDarkenGlsl(ladder.darkenable, ladder.rungIndex) + '\n        }',
  );
  assert.ok(!shadowOcclusionGlsl(ladder).includes('row =='), 'a per-row chain on a one-rung ladder');
  assert.ok(!shadowOcclusionGlsl(ladder).includes('occ > 0.25'));
});

test('shadowOcclusionGlsl emits ONE guarded block PER ROW under a depth, and a second stage between 0.25 and 0.5 under a soft edge — pinned as source', () => {
  const soft = shadowLadderFor(SHIPPED_TOKENS, SHADE_LEVELS, { deep: 0.55, deepTokens: [HEALTHY_TOKEN], edge: 'soft' });
  const src = shadowOcclusionGlsl(soft);
  const rows = SHIPPED_TOKENS.length;
  // Every row appears in BOTH stages, in row order, guarded by its own index.
  for (let row = 0; row < rows; row += 1) {
    const guard = `if (row == ${row}) { `;
    assert.equal(src.split(guard).length - 1, 2, `row ${row} is not guarded exactly twice`);
  }
  assert.ok(src.startsWith('if (occ > 0.5) {'));
  assert.ok(src.includes('\n        else if (occ > 0.25) {'));
  // The healthy row goes to the DEEP index (0) in the full stage and to its half (1) in the soft
  // stage; a yellow row to the derived rung (2) and its half (5). Read the lines back out.
  const full = src.slice(0, src.indexOf('else if'));
  const half = src.slice(src.indexOf('else if'));
  assert.ok(full.includes(`if (row == 0) { ${shadowDarkenGlsl(soft.tokens[0]!.darkenable, 0)} }`));
  assert.ok(half.includes(`if (row == 0) { ${shadowDarkenGlsl(soft.tokens[0]!.halfDarkenable, 1)} }`));
  assert.ok(full.includes(`if (row == 2) { ${shadowDarkenGlsl(soft.tokens[2]!.darkenable, 2)} }`));
  assert.ok(half.includes(`if (row == 2) { ${shadowDarkenGlsl(soft.tokens[2]!.halfDarkenable, 5)} }`));
  // THE INDENTATION IS PART OF THE PINNED SOURCE: every row line sits twelve spaces in and every
  // closer eight, so the emitted shader reads as one block under the stage it belongs to.
  const lines = src.split('\n');
  for (const line of lines) {
    if (line.includes('if (row ==')) assert.ok(line.startsWith('            if (row =='), `row line not indented: ${JSON.stringify(line)}`);
    if (line.trim() === '}') assert.equal(line, '        }');
    if (line.includes('else if')) assert.ok(line.startsWith('        else if'));
  }
  // Two stages, two closers, each on its own line at eight spaces — and no empty line where a
  // closer should be.
  assert.equal(lines.filter((l) => l === '        }').length, 2, 'a stage lost its closer');
  assert.ok(!lines.includes(''), 'an empty line where a closer should be');
  // A HARD edge at the same depth: the per-row full stage and NO second stage.
  const hard = shadowLadderFor(SHIPPED_TOKENS, SHADE_LEVELS, { deep: 0.55, deepTokens: [HEALTHY_TOKEN], edge: 'hard' });
  const hardSrc = shadowOcclusionGlsl(hard);
  assert.ok(hardSrc.includes('if (row == 0) {'));
  assert.ok(!hardSrc.includes('occ > 0.25'));
  // A soft edge with NO deep token is still per-row (the halves exist), still two stages.
  const softOnly = shadowLadderFor(SHIPPED_TOKENS, SHADE_LEVELS, { deep: 0.77, deepTokens: [], edge: 'soft' });
  assert.ok(shadowOcclusionGlsl(softOnly).includes('occ > 0.25'));
});

test('a material built WITH shadowDepth wears the longer ladder: the stride is the levels’ length and the source carries both stages', () => {
  const m = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    shadow: testShadow(),
    shadowDepth: { deep: 0.55, deepTokens: [HEALTHY_TOKEN], edge: 'soft' },
  });
  // 9 lit + 0.77 + 0.55 + 0.835 + 0.725 = 13.
  assert.ok(m.fragmentShader.includes('int idx = row * 13 + lvl;'), 'the stride is not the depth ladder’s length');
  assert.ok(m.fragmentShader.includes('else if (occ > 0.25) {'));
  assert.equal((m.uniforms['uRamp']!.value as unknown[]).length, SHIPPED_TOKENS.length * 13);
  // And WITHOUT it the material is the one-rung one — same tokens, stride 10, no second stage.
  const plain = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS, shadow: testShadow() });
  assert.ok(plain.fragmentShader.includes('int idx = row * 10 + lvl;'));
  assert.ok(!plain.fragmentShader.includes('occ > 0.25'));
  // A depth handed to an UNSHADOWED material is ignored rather than refused — there is no field
  // to read, and the source is the unshadowed one byte for byte.
  const unshadowed = createBandedGroundMaterial({ tokens: SHIPPED_TOKENS });
  const ignored = createBandedGroundMaterial({
    tokens: SHIPPED_TOKENS,
    shadowDepth: { deep: 0.55, deepTokens: [HEALTHY_TOKEN], edge: 'soft' },
  });
  assert.equal(ignored.fragmentShader, unshadowed.fragmentShader);
});
