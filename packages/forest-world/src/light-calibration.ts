// light-calibration.ts — WHAT "FULLY LIT" AND "UNLIT" MEAN FOR A BOUGHT OBJECT ON THIS MAP,
// measured against the renderer that will draw it rather than derived and hoped.
//
// THE INCREMENT: `cross-the-light-calibration-probe` on `adopt-the-land-into-the-shipped-map-arc`.
//
// THE PROBLEM IT CLOSES. The ground quantises its lighting onto `shade-ladder.ts`, so every ground
// pixel is an authored `token x level` entry. A `MeshStandardMaterial` standing on it computes its
// own lighting through a BRDF with three's own irradiance units and a reciprocal-pi, and there is
// no arithmetic anyone can write on this side that predicts the result — the first attempt at one
// (`ambient 0.7`, `directional 1.1`, chosen when every lit object here was a flat placeholder cone)
// delivered pale grey needles on PINK trunks the first time a TEXTURE was put in front of it.
// Deriving the pair off the ladder fixed the saturation and left the map still uncalibrated: the
// authored intent says a lit white face lands on the ladder's top rung, and nothing had measured
// whether it does.
//
// SO IT IS MEASURED. A white, fully rough, fully lit standard face is rendered in THIS context and
// read back, and both intensities are scaled by `target / probe`. After that a lit face delivers
// its own base colour at `SHADE_LEVELS`'s top and an unlit one at its floor — the same range the
// land beside it is quantised into, by construction rather than by eye.
//
// ⚠⚠ AND THE CORRECTION IS ONLY VALID IN EXACT-COLOUR MODE, WHICH IS WHY THIS REFUSES OUTSIDE IT.
// `target / probe` is a one-shot solve, and it is exact only where the delivered value is LINEAR in
// intensity. `exact-colour.ts` is what makes that true. Through @react-three/fiber's DEFAULT
// canvas — ACES filmic tone mapping and an sRGB output encode — it is not: the naive scale delivers
// 0.764 against a target of 1.0, and iterating does not rescue it, because ACES asymptotes and
// reaching 1.0 wants a scale near 1e6. A calibration that misses by 24% looks exactly like a
// calibration, so the mode is a REFUSAL rather than a comment.
//
// CROSSED as a SPLIT from `harness/pine-scene.ts`, which re-exports; `scope-fence.test.ts` carries
// the ADOPTED entry. The split is by what needs a browser: the rig, the arithmetic and the refusal
// are node-provable and live here; only `readProbePixel` touches a live context, and it is seamed
// so its callers are provable without one.

import * as THREE from 'three';

import { isExactColour, type ColourConfigurableRenderer } from './exact-colour.js';
import { SHADE_LEVELS } from './shade-ladder.js';

/** What the probe measured, and the correction it implies. */
export interface LightCalibration {
  /** What a white, fully-lit, fully-rough standard face delivered at unit intensities. */
  probe: number;
  /** The factor both intensities are multiplied by. */
  scale: number;
  /** The ladder rung the calibration targets — a fully lit face. */
  target: number;
  /** The floor an unlit face lands on — the ladder's own darkest rung. */
  floor: number;
}

/** What "unlit" and "lit" mean on a ladder: its darkest and brightest rungs. */
export interface LadderEnds {
  floor: number;
  target: number;
}

/**
 * The ladder's two ends, or a refusal.
 *
 * ⚠ ONE FUNCTION RATHER THAN THE SAME GUARD IN TWO PLACES, and the mutation rung is what said so.
 * `calibrationFrom` and `calibrateLights` each read `levels[0]` and `levels[length - 1]` and each
 * tested both for `undefined` — and for an ARRAY those two conditions are the same condition, since
 * an empty array has neither end. So every mutant of the `||` was equivalent, in two places, and
 * the only fixture that reaches either is the empty ladder. Asking `length` once says the same
 * thing with nothing left over.
 */
export function ladderEnds(levels: readonly number[]): LadderEnds {
  if (levels.length === 0) {
    throw new Error('light-calibration: a ladder with no rungs cannot say what "lit" means');
  }
  return { floor: levels[0]!, target: levels[levels.length - 1]! };
}

/**
 * The correction, from a measured probe and the ladder it is aimed at.
 *
 * THE WHOLE ARITHMETIC OF THE CALIBRATION IS THESE FOUR LINES, and they are here rather than inside
 * the render so they can be proved against numbers instead of against a GPU.
 *
 * @param probe what a white fully-lit fully-rough face delivered at unit intensities, in [0, 1]
 * @param levels the shade ladder — defaulted to what ships, passed explicitly by a frozen arm
 */
export function calibrationFrom(
  probe: number,
  levels: readonly number[] = SHADE_LEVELS,
): LightCalibration {
  const { floor, target } = ladderEnds(levels);
  if (!Number.isFinite(probe) || probe <= 0) {
    // A calibration that cannot see its own control is not a calibration. It fails LOUDLY rather
    // than returning an identity, because an identity here is indistinguishable from a correction
    // that happened to be 1 and would ship a 3.14x-dark map reporting success.
    throw new Error(
      `light-calibration: the probe delivered ${probe}. A calibration that cannot see its own control is not a calibration.`,
    );
  }
  return { probe, scale: target / probe, target, floor };
}

/** The two intensities a scene hangs, at the calibrated strengths. */
export interface CalibratedIntensities {
  ambient: number;
  directional: number;
}

/**
 * The pair `<ambientLight>` and `<directionalLight>` are given.
 *
 * ⚠ THE UNCALIBRATED PAIR IS THIS SAME FUNCTION AT `scale = 1`, and that is deliberate: the
 * authored intent and the measured correction differ in ONE factor, so a comparison between them
 * is a comparison of one thing. `ForestWorldCanvas` hung `{ambient: floor, directional: target -
 * floor}` before this crossed, which is exactly `intensitiesFor({...cal, scale: 1})`.
 */
export function intensitiesFor(cal: LightCalibration): CalibratedIntensities {
  return {
    ambient: cal.floor * cal.scale,
    directional: (cal.target - cal.floor) * cal.scale,
  };
}

/**
 * THE RENDERER THIS MODULE ACTUALLY NEEDS — four methods, not a `WebGLRenderer`.
 *
 * ⚠ NAMED RATHER THAN CAST. The probe is the one browser-bound inch here, and the tempting way to
 * test it is `{...} as unknown as THREE.WebGLRenderer` — a chain the house standard refuses because
 * it discards exactly the evidence a reader needs. Declaring the seam instead says what the module
 * depends on (it never touches the scene graph, the render lists or the XR state), lets a recording
 * stub satisfy it honestly, and a real `THREE.WebGLRenderer` satisfies it structurally.
 */
export interface ProbeRenderer extends ColourConfigurableRenderer {
  getSize(target: THREE.Vector2): THREE.Vector2;
  getContext(): ProbeContext;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
}

/** The four things the probe asks of a GL context. A real WebGL2 context satisfies it. */
export interface ProbeContext {
  readonly RGBA: number;
  readonly UNSIGNED_BYTE: number;
  finish(): void;
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void;
}

/** The probe scene: the smallest thing that answers "what does a lit white face deliver here?" */
export interface ProbeRig {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  dispose(): void;
}

/**
 * Build the probe rig — a plane facing the camera with the key light straight down its normal.
 *
 * White albedo, `roughness: 1`, `metalness: 0` — as close to pure Lambert as the standard material
 * gets. ⚠ A small specular term survives at that roughness and is deliberately LEFT IN: it is part
 * of what the real material will deliver, so calibrating it away would leave every asset slightly
 * bright. That is the term the increment's own framing named, and measuring it is all this rig was
 * ever going to do — the transfer function it is measured THROUGH is the larger half, and lives in
 * `exact-colour.ts`.
 *
 * ⚠ THE LIGHT IS DOWN THE NORMAL AND NOT ALONG `LIGHT_DIRECTION`. The probe asks what the material
 * does at `dot(n, L) = 1`; aiming it at the map's own sun would fold the island's authored geometry
 * into a measurement about the renderer.
 */
export function buildProbeRig(cal: Pick<LightCalibration, 'floor' | 'target'>): ProbeRig {
  const scene = new THREE.Scene();
  const geometry = new THREE.PlaneGeometry(2, 2);
  // Stryker disable next-line ObjectLiteral: EQUIVALENT — three's own MeshStandardMaterial defaults
  // are already white / rough / non-metal, so `{}` builds the identical material. The options stay
  // because they are the SPECIFICATION of the control, not a tweak of it; `light-calibration.test.ts`
  // pins the premise, and that test fails the day three's defaults move, which is exactly when this
  // annotation should stop being true.
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  scene.add(new THREE.Mesh(geometry, material));
  scene.add(new THREE.AmbientLight(0xffffff, cal.floor));
  const key = new THREE.DirectionalLight(0xffffff, cal.target - cal.floor);
  key.position.set(0, 0, 1);
  scene.add(key);

  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  camera.position.set(0, 0, 2);
  // Stryker disable next-line CallExpression: EQUIVALENT — a fresh camera's orientation is already
  // down -z, and the rig puts it at +z looking back at a plane on the origin plane, so this states
  // an orientation it already has. Kept because it is what makes the framing readable; the test
  // pins the premise, so moving the camera off the +z axis fails there rather than silently here.
  camera.lookAt(0, 0, 0);

  return {
    scene,
    camera,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** The size the probe renders at. Small on purpose: one texel is read and the rest is waste. */
export const PROBE_SIZE = 8;

/**
 * Which texel to read out of a `size x size` probe frame.
 *
 * ⚠ ITS OWN FUNCTION SO THE ARITHMETIC IS PROVABLE. Everything else in {@link readProbePixel}
 * needs a live context, and a browser-bound body is a hundred mutants no fixture reaches — the
 * shape this package has now paid for three times. The rig fills the whole frame, so any interior
 * texel would do; reading the CENTRE is what keeps that true if the plane ever stops filling it.
 */
export interface ProbeTexel {
  x: number;
  y: number;
}

export function probeTexel(size: number = PROBE_SIZE): ProbeTexel {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`light-calibration: a ${size}-texel probe frame has no centre to read`);
  }
  const centre = Math.floor(size / 2);
  return { x: centre, y: centre };
}

/** A read-back byte as the [0, 1] value the calibration is arithmetic over. */
export function probeValueOf(byte: number | undefined): number {
  return (byte ?? 0) / 255;
}

/** The one inch of this module that needs a live context. Seamed so its callers do not. */
export type ProbeReader = (renderer: ProbeRenderer, rig: ProbeRig) => number;

/**
 * Render the rig and read the centre texel back, as a [0, 1] red channel.
 *
 * ⚠ THE RENDERER'S SIZE IS SAVED AND RESTORED. The probe runs on the canvas that is about to draw
 * the map; leaving it 8x8 is a blank frame that looks like a mount failure.
 */
export const readProbePixel: ProbeReader = (renderer, rig) => {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const gl = renderer.getContext();
  const { x, y } = probeTexel();
  renderer.setSize(PROBE_SIZE, PROBE_SIZE, false);
  renderer.render(rig.scene, rig.camera);
  gl.finish();
  const px = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  renderer.setSize(size.x, size.y, false);
  return probeValueOf(px[0]);
};

/**
 * Measure how a `MeshStandardMaterial` responds in THIS context, and return the correction.
 *
 * @param renderer the renderer that will draw the map — it must already be in exact-colour mode
 * @param levels the shade ladder, defaulted to what ships
 * @param read the browser inch, seamed for tests
 */
export function calibrateLights(
  renderer: ProbeRenderer,
  levels: readonly number[] = SHADE_LEVELS,
  read: ProbeReader = readProbePixel,
): LightCalibration {
  assertExactColourForCalibration(renderer);
  const rig = buildProbeRig(ladderEnds(levels));
  try {
    return calibrationFrom(read(renderer, rig), levels);
  } finally {
    rig.dispose();
  }
}

/**
 * Refuse to calibrate a renderer whose transfer is not linear in intensity.
 *
 * Its own function so the refusal is provable without a renderer, and so the message can say the
 * thing that took a session to establish rather than naming a flag.
 */
export function assertExactColourForCalibration(renderer: ColourConfigurableRenderer): void {
  if (isExactColour(renderer)) return;
  throw new Error(
    'light-calibration: this renderer is not in exact-colour mode, and `target / probe` is a ' +
      'one-shot solve that is only exact where the delivered value is LINEAR in intensity. Through ' +
      "a tone-mapped or sRGB-encoded output it is not — the naive scale lands at 0.764 of the " +
      'ladder top and no iteration reaches 1.0, because the curve asymptotes. Call ' +
      'configureExactColour(renderer) first.',
  );
}
