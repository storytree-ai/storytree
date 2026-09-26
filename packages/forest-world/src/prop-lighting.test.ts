// prop-lighting.test.ts — a bought prop's ambient-to-key split, proved without a GPU.
//
// Everything here is arithmetic over two numbers and string surgery on a shader, plus the two
// invariants that make it safe: a lit white face still lands on the ladder's top rung at EVERY
// fraction, and the ladder floor is the identity (so the shipped map draws what it drew). The
// one thing a GPU would add — that three actually calls `onBeforeCompile` — is three's contract,
// and the anchor test below holds that the seam still exists in three's own standard shader.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import type { LoadedKit } from './kit-mesh.js';
import { kitMeshes, prepareKitMaterial, setKitPropLighting, tintedMaterial } from './kit-mesh.js';
import { tintedStates } from './kit-vocabulary.js';
import { ladderEnds } from './light-calibration.js';
import {
  KIT_PROP_INDIRECT_FRACTION,
  PROP_INDIRECT_FRACTION_FLOOR,
  PROP_INDIRECT_FRACTION_RUNGS,
  PROP_LIGHTING_ANCHOR,
  PROP_LIGHTING_CACHE_KEY,
  PROP_LIGHTING_DECLARATION_ANCHOR,
  PROP_LIGHTING_DECLARATION_GLSL,
  PROP_LIGHTING_GLSL,
  PROP_LIGHTING_UNIFORM_DIRECT,
  PROP_LIGHTING_UNIFORM_INDIRECT,
  installPropLighting,
  propLightingFragment,
  propLightingHook,
  propLightingOf,
  propLightingScales,
  setPropLighting,
  type PropLightingShader,
} from './prop-lighting.js';
import { SHADE_LEVELS } from './shade-ladder.js';

const ENDS = ladderEnds(SHADE_LEVELS);

/** What three hands `onBeforeCompile`, reduced to the two fields this module touches. */
function shaderOf(fragmentShader: string = THREE.ShaderLib.standard.fragmentShader): PropLightingShader {
  const uniforms: Record<string, { value: unknown }> = {};
  return { uniforms, fragmentShader };
}

/** Run a material's `onBeforeCompile` the way three would, on a real or synthetic shader. The hook
 *  three stores takes its full parameter object; ours reads the two fields every such object has. */
function compile(material: THREE.MeshStandardMaterial, shader: PropLightingShader = shaderOf()): PropLightingShader {
  const hook = material.onBeforeCompile as (s: PropLightingShader) => void;
  hook(shader);
  return shader;
}

test('the floor is READ off the ground ladder, and at the floor both scales are exactly one — the identity', () => {
  assert.equal(PROP_INDIRECT_FRACTION_FLOOR, ENDS.floor);
  assert.equal(PROP_INDIRECT_FRACTION_FLOOR, SHADE_LEVELS[0]);
  const scales = propLightingScales(PROP_INDIRECT_FRACTION_FLOOR);
  assert.equal(scales.indirect, 1);
  assert.equal(scales.direct, 1);
});

test('the shipped fraction is a rung the owner was shown — the boldest one, 0.30 — never a number off the sheet', () => {
  assert.ok(PROP_INDIRECT_FRACTION_RUNGS.includes(KIT_PROP_INDIRECT_FRACTION), 'the pick is on the rendered ladder');
  assert.equal(KIT_PROP_INDIRECT_FRACTION, 0.3);
  const s = propLightingScales(KIT_PROP_INDIRECT_FRACTION);
  assert.ok(s.indirect < 1 && s.direct > 1, 'bolder than the floor: less ambient, more key');
});

test('the hook itself wires both uniforms and patches, and refuses a second pass over one shader', () => {
  const uniforms = { fraction: 0.5, indirect: { value: 1 }, direct: { value: 1 } };
  const shader = shaderOf();
  propLightingHook(uniforms)(shader);
  assert.equal(shader.uniforms[PROP_LIGHTING_UNIFORM_INDIRECT], uniforms.indirect);
  assert.equal(shader.uniforms[PROP_LIGHTING_UNIFORM_DIRECT], uniforms.direct);
  assert.ok(shader.fragmentShader.includes(PROP_LIGHTING_GLSL));
  assert.throws(() => propLightingHook(uniforms)(shader), /already carries/);
});

test('a lit white face lands on the top rung at EVERY fraction — the calibration invariant', () => {
  for (const fraction of [0.05, 0.3, 0.45, 0.6, ENDS.floor, 0.95]) {
    const s = propLightingScales(fraction);
    const lit = ENDS.floor * s.indirect + (ENDS.target - ENDS.floor) * s.direct;
    const unlit = ENDS.floor * s.indirect;
    assert.ok(Math.abs(lit - ENDS.target) < 1e-12, `lit face at ${fraction} delivered ${lit}`);
    assert.ok(Math.abs(unlit - fraction) < 1e-12, `unlit face at ${fraction} delivered ${unlit}`);
  }
});

test('the scales are the fraction over the floor and the remainder over the range', () => {
  const s = propLightingScales(0.45, { floor: 0.78, target: 1 });
  assert.ok(Math.abs(s.indirect - 0.45 / 0.78) < 1e-12);
  assert.ok(Math.abs(s.direct - 0.55 / 0.22) < 1e-12);
  const wide = propLightingScales(0.5, { floor: 0.25, target: 0.75 });
  assert.equal(wide.indirect, 2);
  assert.equal(wide.direct, 1);
});

test('a bolder fraction scales the ambient DOWN and the key UP, monotonically', () => {
  let prev = propLightingScales(PROP_INDIRECT_FRACTION_RUNGS[0]!);
  for (const fraction of PROP_INDIRECT_FRACTION_RUNGS.slice(1)) {
    const next = propLightingScales(fraction);
    assert.ok(next.indirect < prev.indirect, `indirect did not fall at ${fraction}`);
    assert.ok(next.direct > prev.direct, `direct did not rise at ${fraction}`);
    prev = next;
  }
});

test('the ladder starts at the floor and descends — the first rung is today’s picture', () => {
  assert.equal(PROP_INDIRECT_FRACTION_RUNGS[0], ENDS.floor);
  for (const [i, f] of PROP_INDIRECT_FRACTION_RUNGS.entries()) {
    if (i > 0) assert.ok(f < PROP_INDIRECT_FRACTION_RUNGS[i - 1]!, `rung ${i} does not descend`);
  }
});

test('a fraction that is not a split between two lights is refused, and the refusal says so in full', () => {
  for (const bad of [0, 1, -0.1, 1.2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => propLightingScales(bad),
      new RegExp(`strictly inside \\(0, 1\\); ${String(bad).replace(/[.+]/g, '\\$&')} is not a split between two lights`),
      `accepted ${bad}`,
    );
  }
});

test('the uniform names are the GLSL identifiers the patch declares — literal, non-empty, distinct', () => {
  assert.equal(PROP_LIGHTING_UNIFORM_INDIRECT, 'uPropIndirectScale');
  assert.equal(PROP_LIGHTING_UNIFORM_DIRECT, 'uPropDirectScale');
  assert.equal(PROP_LIGHTING_DECLARATION_GLSL, 'uniform float uPropIndirectScale;\nuniform float uPropDirectScale;');
  const patched = propLightingFragment(THREE.ShaderLib.standard.fragmentShader);
  assert.ok(!/uniform float\s*;/.test(patched), 'no nameless declaration');
  assert.ok(!/\*=\s*;/.test(patched), 'no nameless rescale');
  assert.ok(patched.includes('reflectedLight.directDiffuse *= uPropDirectScale;'));
  assert.ok(patched.includes('reflectedLight.indirectDiffuse *= uPropIndirectScale;'));
});

test('the program cache key is a real, non-empty key that differs from an unpatched material’s', () => {
  assert.equal(PROP_LIGHTING_CACHE_KEY, 'storytree-prop-lighting');
  const material = new THREE.MeshStandardMaterial();
  installPropLighting(material, 0.5);
  assert.equal(material.customProgramCacheKey(), 'storytree-prop-lighting');
  assert.notEqual(material.customProgramCacheKey(), new THREE.MeshStandardMaterial().customProgramCacheKey());
  assert.ok(material.customProgramCacheKey().length > 0);
});

test('a ladder with no lit/unlit range is refused rather than dividing by zero', () => {
  assert.throws(() => propLightingScales(0.5, { floor: 0.8, target: 0.8 }), /no lit\/unlit range/);
  assert.throws(() => propLightingScales(0.5, { floor: 0.9, target: 0.8 }), /no lit\/unlit range/);
  assert.throws(() => propLightingScales(0.5, { floor: 0, target: 1 }), /no lit\/unlit range/);
});

test('⚠ three’s own standard fragment shader still carries both anchors, once each', () => {
  const frag = THREE.ShaderLib.standard.fragmentShader;
  assert.equal(frag.split(PROP_LIGHTING_DECLARATION_ANCHOR).length, 2, 'the declaration anchor');
  assert.equal(frag.split(PROP_LIGHTING_ANCHOR).length, 2, 'the rescale anchor');
  assert.ok(
    frag.indexOf(PROP_LIGHTING_ANCHOR) < frag.indexOf('#include <opaque_fragment>'),
    'the rescale must precede the sum in <opaque_fragment>',
  );
});

test('the patch declares the uniforms after <common> and rescales right after <lights_fragment_end>', () => {
  const patched = propLightingFragment(THREE.ShaderLib.standard.fragmentShader);
  assert.ok(patched.includes(`${PROP_LIGHTING_DECLARATION_ANCHOR}\n${PROP_LIGHTING_DECLARATION_GLSL}`));
  assert.ok(patched.includes(`${PROP_LIGHTING_ANCHOR}\n${PROP_LIGHTING_GLSL}`));
  assert.equal(patched.split(`uniform float ${PROP_LIGHTING_UNIFORM_INDIRECT};`).length, 2, 'declared once');
  assert.equal(patched.split(`uniform float ${PROP_LIGHTING_UNIFORM_DIRECT};`).length, 2, 'declared once');
  for (const term of ['indirectDiffuse', 'indirectSpecular', 'directDiffuse', 'directSpecular']) {
    assert.ok(PROP_LIGHTING_GLSL.includes(`reflectedLight.${term} *=`), `${term} is rescaled`);
  }
  assert.ok(PROP_LIGHTING_GLSL.includes(`reflectedLight.indirectDiffuse *= ${PROP_LIGHTING_UNIFORM_INDIRECT}`));
  assert.ok(PROP_LIGHTING_GLSL.includes(`reflectedLight.directDiffuse *= ${PROP_LIGHTING_UNIFORM_DIRECT}`));
  assert.equal(patched.length, THREE.ShaderLib.standard.fragmentShader.length + PROP_LIGHTING_DECLARATION_GLSL.length + PROP_LIGHTING_GLSL.length + 2);
});

test('a shader missing an anchor, or already patched, is refused by name — and the refusal names the consequence', () => {
  assert.throws(
    () => propLightingFragment('void main() {}'),
    /has no #include <common> to patch at — three moved the seam, and every prop would otherwise be lit at the ladder floor with no error/,
  );
  assert.throws(
    () => propLightingFragment('#include <common>\nvoid main() {}'),
    /has no #include <lights_fragment_end> to patch at — three moved the seam, and every prop would otherwise be lit at the ladder floor with no error/,
  );
  const once = propLightingFragment(THREE.ShaderLib.standard.fragmentShader);
  assert.throws(() => propLightingFragment(once), /already carries the prop-lighting patch/);
});

test('install wires the SAME uniform objects into every compile and patches the fragment', () => {
  const material = new THREE.MeshStandardMaterial();
  const before = material.version;
  const uniforms = installPropLighting(material, 0.45);
  assert.ok(material.version > before, 'needsUpdate was raised so the program recompiles');
  assert.equal(material.customProgramCacheKey(), PROP_LIGHTING_CACHE_KEY);
  const a = compile(material);
  const b = compile(material);
  assert.equal(a.uniforms[PROP_LIGHTING_UNIFORM_INDIRECT], uniforms.indirect);
  assert.equal(b.uniforms[PROP_LIGHTING_UNIFORM_INDIRECT], uniforms.indirect);
  assert.equal(a.uniforms[PROP_LIGHTING_UNIFORM_DIRECT], uniforms.direct);
  assert.ok(a.fragmentShader.includes(PROP_LIGHTING_GLSL));
  assert.equal(propLightingOf(material), uniforms);
  assert.equal(uniforms.fraction, 0.45);
  const expected = propLightingScales(0.45);
  assert.equal(uniforms.indirect.value, expected.indirect);
  assert.equal(uniforms.direct.value, expected.direct, 'the direct uniform carries its scale from the first install');
  assert.equal((a.uniforms[PROP_LIGHTING_UNIFORM_DIRECT] as { value: number }).value, expected.direct);
  assert.ok(Math.abs(uniforms.indirect.value - 0.45 / ENDS.floor) < 1e-12);
});

test('a tinted clone of a base that was NEVER installed still gets the shipped fraction', () => {
  const leaf = new THREE.MeshStandardMaterial({ name: 'Pine_Branches' });
  const bark = new THREE.MeshStandardMaterial({ name: 'Pine_Trunks' });
  assert.equal(propLightingOf(leaf), undefined, 'the base carries nothing');
  const kit = kitWith(leaf, bark);
  const clone = tintedMaterial(kit, leaf, 'Pine_Branches', tintedStates()[0]!, new Map());
  assert.equal(propLightingOf(clone)?.fraction, KIT_PROP_INDIRECT_FRACTION);
});

test('an untouched material carries nothing, and a default install sits at the shipped fraction', () => {
  const material = new THREE.MeshStandardMaterial();
  assert.equal(propLightingOf(material), undefined);
  assert.equal(installPropLighting(material).fraction, KIT_PROP_INDIRECT_FRACTION);
});

test('setPropLighting moves the fraction IN PLACE — the compiled program’s uniforms follow', () => {
  const material = new THREE.MeshStandardMaterial();
  const uniforms = installPropLighting(material, ENDS.floor);
  const compiled = compile(material);
  setPropLighting(material, 0.3);
  assert.equal(propLightingOf(material), uniforms, 'the same record');
  assert.equal(uniforms.fraction, 0.3);
  const s = propLightingScales(0.3);
  assert.equal((compiled.uniforms[PROP_LIGHTING_UNIFORM_INDIRECT] as { value: number }).value, s.indirect);
  assert.equal((compiled.uniforms[PROP_LIGHTING_UNIFORM_DIRECT] as { value: number }).value, s.direct);
});

test('a refused fraction leaves an installed material exactly where it was', () => {
  const material = new THREE.MeshStandardMaterial();
  installPropLighting(material, 0.6);
  assert.throws(() => setPropLighting(material, 1.5));
  assert.equal(propLightingOf(material)?.fraction, 0.6);
});

/** A kit holding one leaf part and one bark part — enough to prove the clone and the sweep. */
function kitWith(leaf: THREE.MeshStandardMaterial, bark: THREE.MeshStandardMaterial): LoadedKit {
  const box = (): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(1, 2, 1);
    g.computeBoundingBox();
    return g;
  };
  const objects = [
    { name: 'Pine_Trunk_01', geometry: box(), material: bark, materialName: bark.name },
    { name: 'Pine_Leaves_01', geometry: box(), material: leaf, materialName: leaf.name },
  ];
  return {
    assemblies: new Map([['pine-a', { objects, names: ['Pine_Trunk_01', 'Pine_Leaves_01'], height: 2, width: 1 }]]),
    materials: [bark.name, leaf.name],
    leafMeans: new Map([[leaf.name, { r: 70, g: 90, b: 69 }]]),
    triangles: 24,
    wireBytes: 0,
    textures: [],
    gpuBytes: 0,
  };
}

test('prepareKitMaterial installs the shipped fraction on every kit material', () => {
  const leaf = new THREE.MeshStandardMaterial({ name: 'Pine_Branches' });
  leaf.transparent = true;
  prepareKitMaterial(leaf);
  assert.equal(propLightingOf(leaf)?.fraction, KIT_PROP_INDIRECT_FRACTION);
  assert.equal(leaf.customProgramCacheKey(), PROP_LIGHTING_CACHE_KEY);
  const bark = new THREE.MeshStandardMaterial({ name: 'Pine_Trunks' });
  prepareKitMaterial(bark);
  assert.equal(propLightingOf(bark)?.fraction, KIT_PROP_INDIRECT_FRACTION);
});

test('⚠ a tinted clone is re-installed at the BASE’s fraction — the state crown is lit like an untinted one', () => {
  const leaf = new THREE.MeshStandardMaterial({ name: 'Pine_Branches' });
  const bark = new THREE.MeshStandardMaterial({ name: 'Pine_Trunks' });
  prepareKitMaterial(leaf);
  prepareKitMaterial(bark);
  const kit = kitWith(leaf, bark);
  setKitPropLighting(kit, 0.45);
  const tint = tintedStates()[0]!;
  const clone = tintedMaterial(kit, leaf, 'Pine_Branches', tint, new Map());
  assert.notEqual(clone, leaf, 'a tint really clones');
  assert.equal(propLightingOf(clone)?.fraction, 0.45, 'the clone carries the base’s fraction');
  assert.notEqual(propLightingOf(clone), propLightingOf(leaf), 'with its own uniform record');
  assert.equal(clone.customProgramCacheKey(), PROP_LIGHTING_CACHE_KEY, 'and its own patched program key');
  assert.ok(compile(clone).fragmentShader.includes(PROP_LIGHTING_GLSL), 'and really patches on compile');
});

test('setKitPropLighting reaches every material, keeps ONE record for a material shared by parts, and leaves strangers alone', () => {
  const leaf = new THREE.MeshStandardMaterial({ name: 'Pine_Branches' });
  const bark = new THREE.MeshStandardMaterial({ name: 'Pine_Trunks' });
  const kit = kitWith(leaf, bark);
  // A second assembly re-uses the SAME bark material — the sweep must move it in place, not mint a second record.
  const spare = kit.assemblies.get('pine-a')!.objects[0]!;
  kit.assemblies.set('pine-b', { objects: [spare], names: ['Pine_Trunk_04'], height: 2, width: 1 });
  setKitPropLighting(kit, 0.3);
  assert.equal(propLightingOf(leaf)?.fraction, 0.3);
  assert.equal(propLightingOf(bark)?.fraction, 0.3);
  const barkRecord = propLightingOf(bark);
  const stranger = new THREE.MeshStandardMaterial({ name: 'not-in-the-kit' });
  assert.equal(propLightingOf(stranger), undefined);
  const leafRecord = propLightingOf(leaf);
  setKitPropLighting(kit, 0.6);
  assert.equal(propLightingOf(leaf), leafRecord, 'moved in place, not re-created');
  assert.equal(propLightingOf(bark), barkRecord, 'the shared material keeps its one record');
  assert.equal(leafRecord?.fraction, 0.6);
  assert.equal(barkRecord?.fraction, 0.6);
});

test('the meshes a dressing merges wear materials that ALL carry the patch', () => {
  const leaf = new THREE.MeshStandardMaterial({ name: 'Pine_Branches' });
  const bark = new THREE.MeshStandardMaterial({ name: 'Pine_Trunks' });
  prepareKitMaterial(leaf);
  prepareKitMaterial(bark);
  const kit = kitWith(leaf, bark);
  setKitPropLighting(kit, 0.6);
  const tint = tintedStates()[0]!;
  const meshes = kitMeshes(kit, [
    { role: 'tree', assembly: 'pine-a', capId: 'a', tint, at: { x: 0, z: 0 }, y: 0, yaw: 0, scale: 1 },
    { role: 'tree', assembly: 'pine-a', capId: 'b', tint: null, at: { x: 20, z: 0 }, y: 0, yaw: 0, scale: 1 },
  ]);
  assert.equal(meshes.length, 3, 'bark, green leaves, tinted leaves');
  for (const m of meshes) {
    const record = propLightingOf(m.material as THREE.Material);
    assert.ok(record, `${(m.material as THREE.Material).name} carries no prop lighting`);
    assert.equal(record.fraction, 0.6);
  }
});
