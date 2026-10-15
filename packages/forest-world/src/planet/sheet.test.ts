import assert from 'node:assert/strict';
import test from 'node:test';
import { OrthographicCamera, Quaternion, Vector3 } from 'three';
import { plateTransform } from './planet.js';
import { applyPlanetFraming } from './camera.js';
import { applySheetEye, SHEET_RADIUS, sheetPoint, sheetSpot } from './sheet.js';

test('6.22 on the glass sheet each island stands where it is placed and faces the eye square-on, within a degree, and the eye keeps a tight depth range round the sheet', () => {
  // The globe turned to face the eye, as the page does: its own +z toward the eye, which looks straight down at the sheet.
  const camera = new OrthographicCamera(-720, 720, 480, -480, 0.1, 1000);
  camera.position.set(0, 0, 1000);
  camera.lookAt(0, 0, 0);
  const reach = Math.hypot(3200, 900);
  applyPlanetFraming(camera, SHEET_RADIUS, 0.002, { width: 1440, height: 960 });
  applySheetEye(camera, reach);
  camera.updateMatrixWorld();
  const toEye = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  for (const at of [{ x: 0, y: 0 }, { x: -1600, y: 450 }, { x: 1600, y: -450 }, { x: 1200, y: 300 }]) {
    const spot = sheetSpot(at);
    const back = sheetPoint(spot);
    assert.ok(Math.abs(back.x - at.x) < 1e-6 && Math.abs(back.y - at.y) < 1e-6, 'a spot on the sheet reads back as the place given');
    const { position, quaternion } = plateTransform(spot, SHEET_RADIUS);
    const plate = new Vector3(...position);
    assert.ok(Math.hypot(plate.x - at.x, plate.y - at.y) < 0.1, `the island stands at ${at.x}, ${at.y} on the sheet`);
    const up = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w));
    assert.ok(up.angleTo(toEye) < Math.PI / 180, 'and faces the eye within a degree');
    const depth = plate.clone().project(camera).z;
    assert.ok(depth > -1 && depth < 1, 'between the eye\'s near and far planes');
  }
  assert.ok(camera.far - camera.near <= 8 * reach, `the depth range is ${camera.far - camera.near} units, not the whole sphere's`);
});
