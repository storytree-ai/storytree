import assert from 'node:assert/strict';
import test from 'node:test';
import { OrthographicCamera, Vector3 } from 'three';
import { applyPlanetFraming, applyPlanetSideOffset, wheelFloor } from './camera.js';

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function cameraFor(width: number, height: number) {
  const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 4000);
  camera.position.set(175, 230, 510);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function screen(point: Vector3, camera: OrthographicCamera, width: number, height: number) {
  const projected = point.clone().project(camera);
  return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 };
}

test('6.6 framing delivers the requested globe radii on the short side without changing the eye', () => {
  for (const [width, height] of [[1000, 600], [450, 900], [800, 800]] as const) {
    const camera = cameraFor(width, height);
    const position = camera.position.clone(), orientation = camera.quaternion.clone();
    const radius = 210, framing = 1.4;
    applyPlanetFraming(camera, radius, framing, { width: width, height: height });
    const centre = screen(new Vector3(), camera, width, height);
    const limb = screen(new Vector3(radius, 0, 0).applyQuaternion(camera.quaternion), camera, width, height);
    near(limb.x - centre.x, Math.min(width, height) / (2 * framing));
    near(centre.x, width / 2);
    near(centre.y, height / 2);
    assert.deepEqual(camera.position, position);
    assert.deepEqual(camera.quaternion.toArray(), orientation.toArray());
  }
});

test('6.6 the sideways projection moves by CSS pixels while preserving user zoom and the eye', () => {
  const width = 1000, height = 600;
  const camera = cameraFor(width, height);
  const position = camera.position.clone(), orientation = camera.quaternion.clone();
  applyPlanetFraming(camera, 210, 1.18, { width, height });
  // A wheel or pinch has changed the initial framing before the host moves its card.
  camera.zoom *= 1.7;
  camera.updateProjectionMatrix();
  const zoom = camera.zoom;
  for (const sideOffset of [147, -75, 0]) {
    applyPlanetSideOffset(camera, { width, height }, sideOffset);
    const centre = screen(new Vector3(), camera, width, height);
    near(centre.x, width / 2 + sideOffset);
    near(centre.y, height / 2);
    assert.equal(camera.zoom, zoom);
    assert.deepEqual(camera.position, position);
    assert.deepEqual(camera.quaternion.toArray(), orientation.toArray());
  }
});

test('6.6 framing and sideways offset still land at the same requested positions after resize', () => {
  const camera = cameraFor(1000, 600);
  for (const [width, height] of [[1000, 600], [420, 850], [900, 500]] as const) {
    // R3F updates its CSS-pixel orthographic frustum when the canvas resizes.
    camera.left = -width / 2; camera.right = width / 2;
    camera.top = height / 2; camera.bottom = -height / 2;
    applyPlanetFraming(camera, 210, 1.18, { width: width, height: height });
    applyPlanetSideOffset(camera, { width: width, height: height }, 86);
    const centre = screen(new Vector3(), camera, width, height);
    const limb = screen(new Vector3(210, 0, 0).applyQuaternion(camera.quaternion), camera, width, height);
    near(centre.x, width / 2 + 86);
    near(centre.y, height / 2);
    near(limb.x - centre.x, Math.min(width, height) / (2 * 1.18));
  }
});

test('6.18 the wheel floor is half the framed size: at it, the globe spans half the radii its framing gives it', () => {
  for (const [width, height] of [[1000, 600], [450, 900]] as const) {
    const camera = cameraFor(width, height);
    const radius = 210, framing = 1.18;
    applyPlanetFraming(camera, radius, framing, { width, height });
    const opened = camera.zoom;
    near(wheelFloor(radius, framing, { width, height }), opened / 2);
    // A host's framing that pulls further back (a tour's wide shot) lowers the floor with it.
    near(wheelFloor(radius, framing * 7, { width, height }), opened / 14);
  }
});
