import assert from 'node:assert/strict';
import test from 'node:test';
import { DoubleSide, Quaternion, Raycaster, Vector3 } from 'three';
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
test('6.3 the glass has a nearly clear middle, retaining the 80% far-side minimum through both faces', () => {
  const surface = planet.createPlanetSurface(160);
  try {
    const material = surface.material;
    assert.ok(material.transparent);
    const opacity = material.uniforms.opacity!.value as number;
    assert.ok(opacity > 0 && opacity < 1, 'the ball still has a visible, transparent surface');
    // The owner found #90 too opaque: each shell face blends over the far side.
    const farSideTransmission = (1 - opacity) ** 2;
    assert.ok(farSideTransmission >= 0.8, `both shell faces leave only ${farSideTransmission} of the far side`);
    // The glass request follows #93: move the visible shell toward the rim, clearing its middle.
    assert.ok(farSideTransmission >= 0.95, `the clear middle leaves only ${farSideTransmission} of the far side`);
    assert.equal(material.depthWrite, false, 'the shell must not hide interior or far-side draws');
    assert.equal(material.side, DoubleSide, 'both faces of the ball remain visible');
    assert.equal(surface.geometry.parameters.radius, 160);
  } finally {
    surface.geometry.dispose();
    surface.material.dispose();
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
