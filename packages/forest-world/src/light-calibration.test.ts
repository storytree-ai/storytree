// light-calibration.test.ts — THE PROBE'S ARITHMETIC, AND THE PREMISE OF ITS REFUSAL.
//
// THE TEST THIS FILE IS REALLY FOR is `the one-shot solve is EXACT through a linear transfer and
// MISSES through ACES`. Everything else supports it. `calibrateLights` returns `target / probe` and
// applies it once; that is a correct solve only where the delivered value is linear in intensity,
// and `assertExactColourForCalibration` is the fence that says so. A fence whose premise lives only
// in a comment is a fence a later session removes — so the premise is HELD HERE, with a reference
// implementation of the transform the fence exists to keep the calibration away from.
//
// ⚠ THE ACES REFERENCE BELOW IS A TEST FIXTURE AND NOT A SECOND IMPLEMENTATION OF ANYTHING. It is
// transcribed from three's own `tonemapping_pars_fragment.glsl.js` so this file can state what a
// tone-mapped canvas does to the probe. Nothing in `src/` reads it, and nothing should: the product
// does not tone-map, which is the whole point.

import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { configureExactColour } from './exact-colour.js';
import {
  PROBE_SIZE,
  buildProbeRig,
  calibrateLights,
  calibrationFrom,
  intensitiesFor,
  ladderEnds,
  probeTexel,
  probeValueOf,
  readProbePixel,
  type ProbeRenderer,
  type ProbeRig,
} from './light-calibration.js';
import { LEGACY_SHADE_LEVELS, SHADE_LEVELS } from './shade-ladder.js';

// ─────────────────────────────────────────────────────────────── the two transfer functions

/**
 * What a white, fully-rough, fully-lit standard face radiates at these intensities, in LINEAR
 * units — three's own model: direct diffuse `dotNL * intensity / PI`, indirect `ambient / PI`.
 *
 * ⚠ THE SPECULAR TERM IS ABSENT HERE ON PURPOSE. This models the transfer's SHAPE — is the
 * delivered value proportional to intensity? — which is the only question the refusal turns on. The
 * real specular term is exactly what the live probe is for, and modelling it would make this file
 * a second renderer.
 */
function litWhite(ambient: number, directional: number): number {
  return (ambient + directional) / Math.PI;
}

/** three's `ACESFilmicToneMapping`, transcribed from its shader chunk (exposure 1). */
function acesFilmic(x: number): number {
  // Columns, exactly as three's `mat3` constructor takes them.
  const IN: readonly (readonly number[])[] = [
    [0.59719, 0.076, 0.0284],
    [0.35458, 0.90834, 0.13383],
    [0.04823, 0.01566, 0.83777],
  ];
  const OUT: readonly (readonly number[])[] = [
    [1.60475, -0.10208, -0.00327],
    [-0.53108, 1.10813, -0.07276],
    [-0.07367, -0.00605, 1.07602],
  ];
  const mul = (m: readonly (readonly number[])[], v: readonly number[]): number[] =>
    [0, 1, 2].map((r) => m[0]![r]! * v[0]! + m[1]![r]! * v[1]! + m[2]![r]! * v[2]!);
  const scaled = [x / 0.6, x / 0.6, x / 0.6];
  const fit = mul(IN, scaled).map((v) => {
    const a = v * (v + 0.0245786) - 0.000090537;
    const b = v * (0.983729 * v + 0.432951) + 0.238081;
    return a / b;
  });
  return Math.min(1, Math.max(0, mul(OUT, fit)[0]!));
}

/** The sRGB output encode a colour-managed canvas applies on the way to the framebuffer. */
function srgbEncode(x: number): number {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Exact-colour mode: the shader's value reaches the framebuffer untouched. */
const deliverExact = (linear: number): number => linear;
/** @react-three/fiber's default canvas: a filmic curve, then an sRGB encode. */
const deliverAces = (linear: number): number => srgbEncode(acesFilmic(linear));

/** Run the whole calibration loop against a modelled transfer, and report what it lands on. */
function calibrateThrough(deliver: (linear: number) => number, levels: readonly number[] = SHADE_LEVELS) {
  const floor = levels[0]!;
  const target = levels[levels.length - 1]!;
  const probe = deliver(litWhite(floor, target - floor));
  const { scale } = calibrationFrom(probe, levels);
  const lit = intensitiesFor({ probe, scale, target, floor });
  return { probe, scale, delivered: deliver(litWhite(lit.ambient, lit.directional)), target };
}

// ─────────────────────────────────────────────────────────────── the premise of the refusal

test('through a LINEAR transfer the one-shot solve lands exactly on the ladder top', () => {
  const run = calibrateThrough(deliverExact);
  assert.ok(Math.abs(run.delivered - run.target) < 1e-12, `delivered ${run.delivered}`);
  // And the scale it derives is pi, which is the reciprocal-pi in three's own Lambert BRDF
  // arriving back out. Pinned because it is the number a reader will want to sanity-check the
  // live probe against — the live one differs from it only by the specular term.
  assert.ok(Math.abs(run.scale - Math.PI) < 1e-9, `scale ${run.scale}`);
});

test('through ACES + an sRGB encode the SAME solve misses, and iterating does not rescue it', () => {
  const run = calibrateThrough(deliverAces);
  // ⚠ THIS IS THE FENCE'S WHOLE JUSTIFICATION. The calibration reports success and delivers ~0.76
  // of the rung it aimed at — a 24% miss wearing a measurement's clothes.
  assert.ok(run.delivered < run.target * 0.8, `delivered ${run.delivered} of ${run.target}`);
  assert.ok(run.delivered > run.target * 0.7, `delivered ${run.delivered} of ${run.target}`);
  // ⚠ AND IT IS NOT A CONVERGENCE PROBLEM. The curve asymptotes: a hundredfold scale still does
  // not reach the rung, so no number of iterations of `target / probe` gets there.
  const floor = SHADE_LEVELS[0]!;
  const target = SHADE_LEVELS[SHADE_LEVELS.length - 1]!;
  const at = (s: number): number => deliverAces(litWhite(floor * s, (target - floor) * s));
  assert.ok(at(100) < target, `even a 100x scale delivers ${at(100)}`);
  // NON-VACUITY: the two transfers really are different functions, so the test above is not
  // comparing a thing with itself.
  assert.notEqual(deliverAces(0.3), deliverExact(0.3));
});

// ─────────────────────────────────────────────────────────────── the arithmetic

test('calibrationFrom reads the ladder ends, and scales onto the top rung', () => {
  const cal = calibrationFrom(0.25);
  assert.equal(cal.probe, 0.25);
  assert.equal(cal.floor, SHADE_LEVELS[0]);
  assert.equal(cal.target, SHADE_LEVELS[SHADE_LEVELS.length - 1]);
  assert.equal(cal.scale, cal.target / 0.25);
  // ⚠ THE ENDS ARE THE FIRST AND LAST RUNG, NOT `0.8` AND `1.0`. A frozen arm hands the ladder it
  // was measured on; the nine-rung adoption moved the floor from 0.78 and would silently move any
  // literal written here.
  const legacy = calibrationFrom(0.25, LEGACY_SHADE_LEVELS);
  assert.equal(legacy.floor, LEGACY_SHADE_LEVELS[0]);
  assert.equal(legacy.target, LEGACY_SHADE_LEVELS[LEGACY_SHADE_LEVELS.length - 1]);
  assert.notEqual(legacy.floor, cal.floor);
});

test('a probe that saw nothing is REFUSED, not quietly treated as an identity', () => {
  // ⚠ EACH OF THESE IS A DIFFERENT WAY FOR A LIVE PROBE TO FAIL, and none of them may return. A
  // calibration that came back `scale: 1` on a black readback would ship a map 3.14x too dark
  // while reporting success — indistinguishable, from the outside, from a correction that happened
  // to be 1.
  for (const bad of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calibrationFrom(bad), /cannot see its own control/, `probe ${bad}`);
  }
  // The smallest readable byte is fine — 1/255 is a measurement, not a failure.
  assert.ok(calibrationFrom(1 / 255).scale > 0);
});

test('a ladder with no rungs cannot say what "lit" means', () => {
  assert.throws(() => ladderEnds([]), /no rungs/);
  assert.throws(() => calibrationFrom(0.25, []), /no rungs/);
  // ⚠ AND A LADDER WITH RUNGS MUST NOT REFUSE — the half that stops the guard reading as "always
  // throw", which is what a `length === 0` flipped to `length !== 0` would be.
  assert.deepEqual(ladderEnds([0.4]), { floor: 0.4, target: 0.4 });
  assert.deepEqual(ladderEnds([0.4, 0.6, 0.9]), { floor: 0.4, target: 0.9 });
  assert.deepEqual(ladderEnds(SHADE_LEVELS), {
    floor: SHADE_LEVELS[0],
    target: SHADE_LEVELS[SHADE_LEVELS.length - 1],
  });
});

test('intensitiesFor splits the ladder across the two lights, and scale multiplies both', () => {
  const floor = SHADE_LEVELS[0]!;
  const target = SHADE_LEVELS[SHADE_LEVELS.length - 1]!;
  const plain = intensitiesFor({ probe: 1, scale: 1, target, floor });
  // At scale 1 this is EXACTLY the pair the canvas hung before the crossing, which is what makes
  // "with and without the probe" a comparison of one thing.
  assert.equal(plain.ambient, floor);
  assert.equal(plain.directional, target - floor);
  // ⚠ NON-VACUITY: an unlit face lands on the FLOOR and a lit one on the TOP. A pair that summed
  // to 1.8 satisfied "the two agree" and saturated every texture put in front of it.
  assert.equal(plain.ambient + plain.directional, target);
  assert.ok(plain.ambient > 0 && plain.directional > 0);

  const scaled = intensitiesFor({ probe: 0.25, scale: 4, target, floor });
  assert.equal(scaled.ambient, floor * 4);
  assert.equal(scaled.directional, (target - floor) * 4);
  // ⚠ AND THE SCALE REACHES BOTH. A correction applied to only the key light moves the CONTRAST
  // as well as the exposure — the picture changes in two ways and the probe still reads right.
  assert.equal(scaled.ambient / plain.ambient, scaled.directional / plain.directional);
});

// ─────────────────────────────────────────────────────────────── the rig

test('the probe rig is a white fully-rough face lit straight down its own normal', () => {
  const rig = buildProbeRig({ floor: 0.8, target: 1 });
  try {
    const mesh = rig.scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    assert.ok(mesh, 'the rig must contain the face it is measuring');
    const material = mesh.material;
    assert.ok(material instanceof THREE.MeshStandardMaterial, 'it must be the standard material');
    // ⚠ THE MATERIAL IS THE SUBJECT. The whole reason for a live probe is that a
    // `MeshStandardMaterial` carries a specular term the arithmetic here does not predict; a rig
    // that measured a basic material would return a number about nothing.
    assert.equal(material.roughness, 1);
    assert.equal(material.metalness, 0);
    assert.equal(material.color.getHex(), 0xffffff);

    const ambient = rig.scene.children.find(
      (c): c is THREE.AmbientLight => c instanceof THREE.AmbientLight,
    );
    const key = rig.scene.children.find(
      (c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight,
    );
    assert.ok(ambient && key);
    assert.equal(ambient.intensity, 0.8);
    assert.equal(key.intensity, 1 - 0.8);
    // ⚠ STRAIGHT DOWN THE NORMAL, so `dot(n, L)` is 1 and the reading is about the material rather
    // than about an angle. The plane faces +z and the light sits on +z.
    assert.deepEqual(key.position.toArray(), [0, 0, 1]);
    assert.deepEqual(rig.camera.position.toArray(), [0, 0, 2]);
    // ⚠ THE FRUSTUM IS A UNIT SQUARE INSIDE A 2x2 PLANE, so every texel of the probe frame is the
    // face and none of it is background. A frustum whose left and right agree is degenerate and
    // renders nothing — and a blank readback is a `probe` of 0, which `calibrationFrom` refuses,
    // so the failure would be loud rather than silent. It is asserted anyway: the refusal would
    // name the probe, not the frustum.
    assert.equal(rig.camera.left, -0.5);
    assert.equal(rig.camera.right, 0.5);
    assert.equal(rig.camera.top, 0.5);
    assert.equal(rig.camera.bottom, -0.5);
    assert.ok(rig.camera.right - rig.camera.left > 0 && rig.camera.top - rig.camera.bottom > 0);
    const geometry = mesh.geometry;
    assert.ok(geometry instanceof THREE.PlaneGeometry);
    assert.ok(
      geometry.parameters.width > rig.camera.right - rig.camera.left,
      'the face must overhang the frustum, or the probe reads background at its edges',
    );
  } finally {
    rig.dispose();
  }
});

test("the rig's two EQUIVALENT annotations are annotations, and here is why", () => {
  // ⚠ THIS TEST EXISTS TO PIN TWO `Stryker disable … EQUIVALENT` CLAIMS IN `buildProbeRig`. An
  // equivalence claim can be falsified by a later change — this package has already had one go
  // stale — so each one is held by an assertion rather than by the comment beside it.

  // (1) The material options restate three's own defaults, so `{}` builds the identical material.
  const bare = new THREE.MeshStandardMaterial();
  try {
    assert.equal(bare.color.getHex(), 0xffffff, "three's default albedo is white");
    assert.equal(bare.roughness, 1, "three's default roughness is 1");
    assert.equal(bare.metalness, 0, "three's default metalness is 0");
  } finally {
    bare.dispose();
  }

  // (2) `camera.lookAt(0, 0, 0)` restates an orientation the camera already has: a fresh camera
  // looks down -z, and the rig puts it on +z above a plane on the origin plane. So the claim is
  // that the call changes nothing FROM THIS POSITION — which stops being true the moment the
  // camera moves off the axis, and that is what this half catches.
  const onAxis = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  onAxis.position.set(0, 0, 2);
  const before = onAxis.quaternion.clone();
  onAxis.lookAt(0, 0, 0);
  assert.ok(before.angleTo(onAxis.quaternion) < 1e-12, 'on the axis, lookAt is a restatement');
  // NON-VACUITY: off the axis it is NOT a restatement, so the assertion above is about the rig's
  // own placement rather than about `lookAt` being inert in general.
  const offAxis = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  offAxis.position.set(2, 0, 2);
  const beforeOff = offAxis.quaternion.clone();
  offAxis.lookAt(0, 0, 0);
  assert.ok(beforeOff.angleTo(offAxis.quaternion) > 0.1, 'off the axis, lookAt turns the camera');

  // And the rig really is the on-axis case.
  const rig = buildProbeRig({ floor: 0.8, target: 1 });
  try {
    assert.deepEqual(rig.camera.position.toArray(), [0, 0, 2]);
  } finally {
    rig.dispose();
  }
});

test('the rig disposes what it allocated', () => {
  const rig = buildProbeRig({ floor: 0.8, target: 1 });
  const mesh = rig.scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
  const disposed: string[] = [];
  const geo = THREE.BufferGeometry.prototype.dispose;
  const mat = THREE.Material.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function disposeGeometry(this: THREE.BufferGeometry) {
    disposed.push('geometry');
    geo.call(this);
  };
  THREE.Material.prototype.dispose = function disposeMaterial(this: THREE.Material) {
    disposed.push('material');
    mat.call(this);
  };
  try {
    rig.dispose();
  } finally {
    THREE.BufferGeometry.prototype.dispose = geo;
    THREE.Material.prototype.dispose = mat;
  }
  assert.deepEqual(disposed.sort(), ['geometry', 'material']);
  assert.ok(mesh, 'the mesh the rig built is what those belonged to');
});

test('the texel read is the centre of the probe frame, and a frame with no centre is refused', () => {
  assert.deepEqual(probeTexel(8), { x: 4, y: 4 });
  assert.deepEqual(probeTexel(1), { x: 0, y: 0 });
  assert.deepEqual(probeTexel(9), { x: 4, y: 4 });
  assert.deepEqual(probeTexel(), probeTexel(PROBE_SIZE));
  // ⚠ THE CENTRE HAS TO BE INSIDE THE FRAME. `size / 2` un-floored reads texel 4 of a 9-wide
  // frame correctly and texel 4.5 of an 8-wide one, which WebGL rounds somewhere unstated.
  for (const size of [1, 2, 3, 8, 9, 64]) {
    const { x, y } = probeTexel(size);
    assert.ok(Number.isInteger(x) && x >= 0 && x < size, `x ${x} of ${size}`);
    assert.ok(Number.isInteger(y) && y >= 0 && y < size, `y ${y} of ${size}`);
  }
  for (const bad of [0, -8, 1.5, Number.NaN]) {
    assert.throws(() => probeTexel(bad), /no centre to read/, `size ${bad}`);
  }
});

test('a read-back byte becomes the [0, 1] value the arithmetic is over', () => {
  assert.equal(probeValueOf(255), 1);
  assert.equal(probeValueOf(0), 0);
  assert.equal(probeValueOf(51), 0.2);
  // ⚠ AN ABSENT BYTE READS AS ZERO AND IS THEN REFUSED BY `calibrationFrom`, which is the intended
  // route: a readback that produced nothing must not become a silent identity.
  assert.equal(probeValueOf(undefined), 0);
  assert.throws(() => calibrationFrom(probeValueOf(undefined)), /cannot see its own control/);
});

// ─────────────────────────────────────────────────────────────── the composition

/**
 * A renderer stub carrying only what `calibrateLights` reads before it reaches its seam.
 *
 * ⚠ IT IS A `ProbeRenderer`, NOT A CAST `WebGLRenderer`. The module declares the four methods it
 * depends on precisely so a stub can satisfy them honestly; an `as unknown as` chain here would
 * discard that and would also stop the compiler noticing if the module started reaching for a fifth.
 * The three render methods throw: the exact-colour refusal must fire BEFORE any of them is called,
 * and a stub that returned quietly would let a regression pass as a pass.
 */
function stubRenderer(): ProbeRenderer {
  return {
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    getSize: (target) => target.set(1400, 900),
    getContext: () => {
      throw new Error('stubRenderer: the seam should have been used instead of a live context');
    },
    setSize: () => {
      throw new Error('stubRenderer: nothing may resize the canvas behind the seam');
    },
    render: () => {
      throw new Error('stubRenderer: nothing may render behind the seam');
    },
  };
}

test('calibrateLights REFUSES a renderer that is not in exact-colour mode', () => {
  const before = THREE.ColorManagement.enabled;
  try {
    THREE.ColorManagement.enabled = true;
    let read = 0;
    assert.throws(
      () =>
        calibrateLights(stubRenderer(), SHADE_LEVELS, () => {
          read += 1;
          return 0.25;
        }),
      /not in exact-colour mode/,
    );
    // ⚠ IT REFUSES BEFORE IT PROBES. A calibration that rendered first and then complained would
    // still have resized the canvas that is about to draw the map.
    assert.equal(read, 0);
  } finally {
    THREE.ColorManagement.enabled = before;
  }
});

test('calibrateLights composes the rig, the seam and the arithmetic — and disposes the rig', () => {
  const before = THREE.ColorManagement.enabled;
  const renderer = stubRenderer();
  configureExactColour(renderer);
  try {
    const seen: ProbeRig[] = [];
    const cal = calibrateLights(renderer, SHADE_LEVELS, (_gl, rig) => {
      seen.push(rig);
      return 0.32;
    });
    assert.equal(cal.probe, 0.32);
    assert.equal(cal.scale, SHADE_LEVELS[SHADE_LEVELS.length - 1]! / 0.32);
    assert.equal(seen.length, 1, 'exactly one rig is built and read');
    // The rig it handed the seam is the one built from THIS ladder's ends.
    const key = seen[0]!.scene.children.find(
      (c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight,
    )!;
    assert.ok(
      Math.abs(key.intensity - (SHADE_LEVELS[SHADE_LEVELS.length - 1]! - SHADE_LEVELS[0]!)) < 1e-12,
    );
    // ⚠ AND A THROWING SEAM STILL DISPOSES. The probe runs on the canvas the map draws on; a rig
    // leaked on the error path is GPU memory held for the life of the page.
    assert.throws(
      () =>
        calibrateLights(renderer, SHADE_LEVELS, () => {
          throw new Error('the context went away');
        }),
      /the context went away/,
    );
  } finally {
    THREE.ColorManagement.enabled = before;
  }
});

test('calibrateLights carries the ladder it was given all the way through', () => {
  const before = THREE.ColorManagement.enabled;
  const renderer = stubRenderer();
  configureExactColour(renderer);
  try {
    const cal = calibrateLights(renderer, LEGACY_SHADE_LEVELS, () => 0.25);
    assert.equal(cal.floor, LEGACY_SHADE_LEVELS[0]);
    assert.equal(cal.target, LEGACY_SHADE_LEVELS[LEGACY_SHADE_LEVELS.length - 1]);
    assert.throws(() => calibrateLights(renderer, [], () => 0.25), /no rungs/);
  } finally {
    THREE.ColorManagement.enabled = before;
  }
});

// ─────────────────────────────────────────────────────────────── the browser inch, seamed

/**
 * A renderer and a context that record what was asked of them.
 *
 * ⚠⚠ THIS IS WHAT MAKES `readProbePixel` PROVABLE AT ALL. It is the one function here that touches
 * a live context, and a browser-bound body is a hundred mutants no fixture reaches — the shape this
 * package has paid for three times. But nothing in it needs a GPU to be CHECKED: what it must get
 * right is the SEQUENCE (save the size, shrink, render, finish, read, restore) and the fact that it
 * restores. Both are observable against a stub. Only the delivered byte is the GPU's, and that is
 * the thing the whole module treats as an input.
 */
function recordingRenderer(byte: number) {
  const log: string[] = [];
  const sizes: [number, number, boolean][] = [];
  const reads: [number, number][] = [];
  const gl = {
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    finish() {
      log.push('finish');
    },
    readPixels(x: number, y: number, _w: number, _h: number, _f: number, _t: number, px: Uint8Array) {
      log.push('readPixels');
      reads.push([x, y]);
      px[0] = byte;
      px[1] = byte;
      px[2] = byte;
      px[3] = 255;
    },
  };
  const renderer: ProbeRenderer = {
    outputColorSpace: THREE.LinearSRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    getSize(target: THREE.Vector2) {
      log.push('getSize');
      // The size the map is drawn at, so a failure to restore is visible as a wrong number rather
      // than as a plausible one.
      return target.set(1400, 900);
    },
    getContext: () => gl,
    setSize(w: number, h: number, updateStyle: boolean) {
      log.push(`setSize ${w}x${h}`);
      sizes.push([w, h, updateStyle]);
    },
    render() {
      log.push('render');
    },
  };
  return { renderer, log, sizes, reads };
}

test('readProbePixel renders small, reads the centre texel, and puts the canvas back', () => {
  const { renderer, log, sizes, reads } = recordingRenderer(51);
  const rig = buildProbeRig({ floor: 0.8, target: 1 });
  try {
    assert.equal(readProbePixel(renderer, rig), 0.2);
  } finally {
    rig.dispose();
  }
  // ⚠ THE ORDER IS THE CONTRACT. Reading before `finish` returns whatever the driver had; reading
  // before `render` returns the previous frame; restoring the size before reading reads a frame
  // that was never drawn at that size. Every one of those is a plausible-looking number.
  assert.deepEqual(log, [
    'getSize',
    `setSize ${PROBE_SIZE}x${PROBE_SIZE}`,
    'render',
    'finish',
    'readPixels',
    'setSize 1400x900',
  ]);
  // ⚠ AND IT MUST RESTORE. The probe runs on the canvas that is about to draw the map; leaving it
  // 8x8 is a blank frame that reads exactly like a mount failure.
  assert.deepEqual(sizes, [
    [PROBE_SIZE, PROBE_SIZE, false],
    [1400, 900, false],
  ]);
  // ⚠ `updateStyle: false` ON BOTH. Passing `true` writes the canvas element's CSS width and
  // height, so an 8x8 probe would visibly collapse the map's DOM node for a frame.
  assert.ok(sizes.every(([, , updateStyle]) => updateStyle === false));
  assert.deepEqual(reads, [[probeTexel().x, probeTexel().y]]);
});

test('readProbePixel reads the RED channel, and a black frame becomes a refusal', () => {
  const dark = recordingRenderer(0);
  const rig = buildProbeRig({ floor: 0.8, target: 1 });
  try {
    const probe = readProbePixel(dark.renderer, rig);
    assert.equal(probe, 0);
    // The route a dead context takes: the read is honest, and `calibrationFrom` is what refuses.
    assert.throws(() => calibrationFrom(probe), /cannot see its own control/);
    const bright = recordingRenderer(255);
    assert.equal(readProbePixel(bright.renderer, rig), 1);
  } finally {
    rig.dispose();
  }
});

test('calibrateLights disposes its rig on BOTH paths', () => {
  const before = THREE.ColorManagement.enabled;
  const renderer = stubRenderer();
  configureExactColour(renderer);
  const disposed: string[] = [];
  const geo = THREE.BufferGeometry.prototype.dispose;
  const mat = THREE.Material.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function disposeGeometry(this: THREE.BufferGeometry) {
    disposed.push('geometry');
    geo.call(this);
  };
  THREE.Material.prototype.dispose = function disposeMaterial(this: THREE.Material) {
    disposed.push('material');
    mat.call(this);
  };
  try {
    calibrateLights(renderer, SHADE_LEVELS, () => 0.32);
    assert.deepEqual(disposed.sort(), ['geometry', 'material'], 'the success path disposes');
    disposed.length = 0;
    // ⚠ AND THE ERROR PATH. The probe runs on the canvas the map draws on, so a rig leaked when the
    // context goes away is GPU memory held for the life of the page — and the throw makes it look
    // like nothing was allocated.
    assert.throws(
      () =>
        calibrateLights(renderer, SHADE_LEVELS, () => {
          throw new Error('the context went away');
        }),
      /the context went away/,
    );
    assert.deepEqual(disposed.sort(), ['geometry', 'material'], 'the error path disposes too');
  } finally {
    THREE.BufferGeometry.prototype.dispose = geo;
    THREE.Material.prototype.dispose = mat;
    THREE.ColorManagement.enabled = before;
  }
});

test('the refusal says WHY, because the why is the whole finding', () => {
  // ⚠ THE MESSAGE IS PINNED AND THAT IS DELIBERATE. This fence looks like pedantry from the
  // outside — the call site is a renderer that "obviously" works — and the only thing standing
  // between a later session and deleting it is the message explaining that `target / probe` is a
  // one-shot solve. A message reduced to "wrong mode" would leave the fence undefended.
  const before = THREE.ColorManagement.enabled;
  try {
    THREE.ColorManagement.enabled = true;
    let message = '';
    try {
      calibrateLights(stubRenderer(), SHADE_LEVELS, () => 0.25);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    for (const phrase of [
      'not in exact-colour mode',
      'LINEAR in intensity',
      'naive scale lands at 0.764',
      'asymptotes',
      'configureExactColour(renderer) first',
    ]) {
      assert.ok(message.includes(phrase), `the refusal must say "${phrase}" — it said: ${message}`);
    }
  } finally {
    THREE.ColorManagement.enabled = before;
  }
});
