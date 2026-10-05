import assert from 'node:assert/strict';
import test from 'node:test';
import { BackSide, DoubleSide, FrontSide, Quaternion, Raycaster, Vector3, type Material } from 'three';
import { SHIPPED_ELEVATION_DEG } from '../camera-framing.js';
import { LIGHT_DIRECTION } from '../shade-ladder.js';
import { landHeightRange } from '../land-relief.js';
import { SHORE_DIP } from '../shore-fall.js';
import { plateTransform, lightForCamera } from './planet.js';
import * as planet from './planet.js';

const up = new Vector3(0, 1, 0);
const sun = new Vector3(LIGHT_DIRECTION.x, LIGHT_DIRECTION.y, LIGHT_DIRECTION.z).normalize();
const close = (actual: Vector3, expected: Vector3) =>
  assert.ok(actual.distanceTo(expected) < 1e-10, `${actual.toArray()} != ${expected.toArray()}`);

test('6.1 each island is a flat tangent plate at its spot, with its low ground above the shell', () => {
  const radius = 390;
  for (const spot of [up, new Vector3(0, -1, 0), new Vector3(2, 3, -4).normalize()]) {
    const { position, quaternion } = plateTransform(spot, radius);
    const centre = new Vector3(...position);
    close(centre.clone().normalize(), spot);
    close(up.clone().applyQuaternion(quaternion), spot);
    assert.ok(centre.length() - Math.max(landHeightRange(), SHORE_DIP) > radius);
    // Two points on the plate stay in its tangent plane; the engine's land is never bent.
    for (const point of [new Vector3(35, 0, 12), new Vector3(-18, 0, -40)]) {
      const world = point.clone().applyQuaternion(quaternion).add(centre);
      assert.ok(Math.abs(world.dot(spot) - centre.length()) < 1e-10);
      assert.ok(Math.abs(world.distanceTo(centre) - point.length()) < 1e-10);
    }
  }
});

test('6.2 L1 gives the island under the flat viewing angle its original local light, wherever it sits', () => {
  const flatEye = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -SHIPPED_ELEVATION_DEG * Math.PI / 180);
  for (const spot of [up, new Vector3(0, -1, 0), new Vector3(2, 3, -4).normalize()]) {
    const { quaternion } = plateTransform(spot, 390);
    const camera = quaternion.clone().multiply(flatEye);
    const worldLight = lightForCamera(camera);
    close(worldLight.clone().applyQuaternion(quaternion.clone().invert()), sun);
    // The lamp stays over the same shoulder as the eye turns, for ground and kit alike.
    close(worldLight.clone().applyQuaternion(camera.clone().invert()), sun.clone().applyQuaternion(flatEye.clone().invert()));
  }
  const turnedEye = new Quaternion().setFromAxisAngle(up, Math.PI / 2).multiply(flatEye);
  assert.ok(lightForCamera(turnedEye).distanceTo(lightForCamera(flatEye)) > 0.5);
});

// The globe mounts this actual Three mesh; material/depth behaviour is observable without WebGL.
test('6.3 from outside, the glass is a one-way mirror: its far face hides the far side, its near face stays nearly clear over the core', () => {
  const surface = planet.createPlanetSurface(160);
  try {
    const far = surface.material.find(material => material.side === BackSide)!;
    const near = surface.material.find(material => material.side === FrontSide)!;
    // ADR-0919 D1: the far face is solid, drawn in the opaque pass and writing depth, so nothing beyond it is drawn over it.
    assert.equal(far.transparent, false, 'the far face is opaque');
    assert.equal(far.depthWrite, true, 'the far face hides what lies beyond it');
    // The near face is the glass the core is seen through, and hides nothing.
    assert.ok(near.transparent);
    const opacity = near.uniforms.opacity!.value as number;
    assert.ok(opacity > 0 && opacity < 1, 'the ball still has a visible, transparent surface');
    assert.ok(1 - opacity >= 0.95, `the clear middle leaves only ${1 - opacity} of the core`);
    assert.equal(near.depthWrite, false, 'the near face must not hide the core');
    assert.equal(surface.geometry.parameters.radius, 160);
  } finally {
    surface.geometry.dispose();
    for (const material of surface.material) material.dispose();
  }
});

// Three draws a see-through, double-sided material in two passes, re-versioning it before each, so every frame
// would re-derive its shader program twice (WebGLRenderer's renderObject; ADR-0836 D1).
test('5.4 an animating globe redraws the glass, far face then near face, without re-deriving a shader program', () => {
  const surface = planet.createPlanetSurface(160);
  try {
    const materials: Material[] = surface.material;
    assert.deepEqual(materials.filter(material => material.transparent && material.side === DoubleSide && !material.forceSinglePass), []);
    // Both faces of the ball remain, each with its own program: three draws an object's groups in order.
    const whole = surface.geometry.index!.count;
    assert.deepEqual(surface.geometry.groups.map(group => ({ start: group.start, count: group.count, side: materials[group.materialIndex!]!.side })),
      [{ start: 0, count: whole, side: BackSide }, { start: 0, count: whole, side: FrontSide }]);
  } finally {
    surface.geometry.dispose();
    for (const material of surface.material) material.dispose();
  }
});

test('6.3 the globe occluder hides what sits behind the sphere, and only that, without a mesh', () => {
  const radius = 390;
  const occluder = planet.globeOccluder(radius);
  const raycaster = new Raycaster();
  // The globe's camera is orthographic: every view ray is parallel, along -z here.
  const hitsBefore = (target: Vector3) => {
    const eye = target.clone().add(new Vector3(0, 0, radius * 4));
    raycaster.set(eye, new Vector3(0, 0, -1));
    return raycaster.intersectObjects([occluder], true).filter(hit => hit.distance < eye.distanceTo(target)).length;
  };
  // A name over an island facing the viewer, and one over an island on the far side.
  assert.equal(hitsBefore(new Vector3(0, 0, radius + 30)), 0);
  assert.equal(hitsBefore(new Vector3(0, 0, -(radius + 30))), 1);
  // Just clear of the limb stays visible; just inside the far limb is hidden.
  assert.equal(hitsBefore(new Vector3(radius + 5, 0, 0)), 0);
  assert.equal(hitsBefore(new Vector3(radius - 5, 0, -40)), 1);
});
