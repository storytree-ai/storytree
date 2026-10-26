import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { applyPlanetSideOffset } from './camera.js';

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function screen(point: Vector3, camera: PerspectiveCamera, width: number, height: number) {
  const projected = point.clone().project(camera);
  return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 };
}

test("4.6 the sideways projection moves the sheet's perspective picture by CSS pixels while preserving the eye", () => {
  const width = 1000, height = 600;
  const camera = new PerspectiveCamera(30, width / height, 0.1, 4000);
  camera.position.set(175, 230, 510);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const position = camera.position.clone(), orientation = camera.quaternion.clone();
  const points = [new Vector3(), new Vector3(40, -20, 60), new Vector3(-90, 10, -30)];
  const before = points.map(point => screen(point, camera, width, height));
  for (const sideOffset of [147, -75, 0]) {
    applyPlanetSideOffset(camera, { width, height }, sideOffset);
    points.forEach((point, index) => {
      const at = screen(point, camera, width, height);
      near(at.x, before[index]!.x + sideOffset);
      near(at.y, before[index]!.y);
    });
    assert.deepEqual(camera.position, position);
    assert.deepEqual(camera.quaternion.toArray(), orientation.toArray());
  }
});
