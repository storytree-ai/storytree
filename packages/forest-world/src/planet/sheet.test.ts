import assert from 'node:assert/strict';
import test from 'node:test';
import { OrthographicCamera, Quaternion, Vector3, type Mesh } from 'three';
import { plateTransform } from './planet.js';
import { islandSurface } from './island-surface.js';
import { applyPlanetFraming } from './camera.js';
import { applySheetEye, SHEET_LAND_LIFT, SHEET_LAND_THICKNESS, SHEET_RADIUS, sheetGlass, sheetPoint, sheetSpot } from './sheet.js';

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

test('6.23 on the glass sheet every island is a raised plate of one shared thickness, its sides running from its land down to the glass', () => {
  const square = [[{ x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: 20 }, { x: -20, z: 20 }]];
  const wide = [[{ x: -45, z: -10 }, { x: 45, z: -30 }, { x: 10, z: 40 }]];
  for (const [story, coast] of [['square', square], ['wide', wide]] as const) {
    const island = islandSurface(coast, SHEET_RADIUS, story, SHEET_LAND_THICKNESS);
    const sides = island.getObjectByName('island-side') as Mesh | undefined;
    assert.ok(sides !== undefined, `the ${story} island has sides`);
    // The land's own height at each coast point, read off its drawn ground.
    const ground = (island.getObjectByName('island-ground') as Mesh).geometry.getAttribute('position'), land = new Map<string, number>();
    for (let i = 0; i < ground.count; i++) land.set(`${ground.getX(i).toFixed(3)} ${ground.getZ(i).toFixed(3)}`, ground.getY(i));
    const position = sides.geometry.getAttribute('position');
    const drops = new Set<number>();
    for (let i = 0; i < position.count; i++) drops.add(Math.round((land.get(`${position.getX(i).toFixed(3)} ${position.getZ(i).toFixed(3)}`)! - position.getY(i)) * 1e4) / 1e4);
    assert.deepEqual([...drops].sort((a, b) => a - b), [0, SHEET_LAND_THICKNESS], `the ${story} island's sides run from its land down by the shared thickness`);
    assert.equal(islandSurface(coast, SHEET_RADIUS, story).getObjectByName('island-side'), undefined, 'and an island on the globe has none');
  }
  // Raised on the sheet, an island's land stands that thickness above the glass as drawn, wherever it is placed.
  const glass = sheetGlass({ width: 1200, height: 600 });
  glass.updateMatrixWorld(true);
  const pane = glass.getObjectByName('sheet:pane') as Mesh, corners = pane.geometry.getAttribute('position');
  for (const index of [0, corners.count - 1]) {
    const under = new Vector3().fromBufferAttribute(corners, index).applyMatrix4(pane.matrixWorld);
    const { position } = plateTransform(sheetSpot(sheetPoint(under)), SHEET_RADIUS, SHEET_LAND_LIFT);
    const land = new Vector3(...position).length(), drawn = under.length();
    assert.ok(Math.abs(land - drawn - SHEET_LAND_THICKNESS) < 1e-3, `the land stands ${(land - drawn).toFixed(3)} units above the glass at its corner`);
  }
  assert.ok(SHEET_LAND_THICKNESS >= 6, `thick enough to be seen at the tilt (${SHEET_LAND_THICKNESS} units)`);
});
