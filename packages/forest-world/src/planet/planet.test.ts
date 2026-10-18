import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { landHeightRange } from '../land-relief.js';
import { SHORE_DIP } from '../shore-fall.js';
import { plateTransform } from './planet.js';

const up = new Vector3(0, 1, 0);
const close = (actual: Vector3, expected: Vector3) =>
  assert.ok(actual.distanceTo(expected) < 1e-10, `${actual.toArray()} != ${expected.toArray()}`);

test('4.1 each island is a flat tangent plate at its spot, with its low ground above the sphere', () => {
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
