import assert from 'node:assert/strict';
import test from 'node:test';
import { AmbientLight, BackSide, Box3, DirectionalLight, DoubleSide, FrontSide, Group, Mesh as ThreeMesh, MeshLambertMaterial, MeshStandardMaterial, PerspectiveCamera, Quaternion, Raycaster, Vector3, type BufferAttribute, type Mesh } from 'three';
import { PLATE_CLEARANCE, plateTransform } from './planet.js';
import { hollowIsland, islandSurface } from './island-surface.js';
import { applySheetEye, clearGlass, hangUnderTheGlass, SHEET_FOV, SHEET_GLASS_THICKNESS, SHEET_LAND_LIFT, SHEET_LAND_THICKNESS, SHEET_RADIUS, SHEET_TILT, sheetEyeZoom, sheetGlass, sheetLights, sheetPoint, sheetSpot } from './sheet.js';

/** The page's eye on the sheet: a perspective one looking straight down at the glass's middle, framed to `zoom`. */
function sheetEye(zoom: number, reach: number, size = { width: 1440, height: 960 }) {
  const camera = new PerspectiveCamera(SHEET_FOV, size.width / size.height, 0.1, 1000);
  camera.position.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  applySheetEye(camera, reach, zoom, size);
  camera.updateMatrixWorld();
  return camera;
}

test('4.22 on the glass sheet each island stands where it is placed and faces the eye square-on, within a degree, and the eye keeps a tight depth range round the sheet', () => {
  // The globe turned to face the eye, as the page does: its own +z toward the eye, which looks straight down at the sheet.
  const reach = Math.hypot(3200, 900), camera = sheetEye(0.5, reach);
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

test('4.26 the glass sheet is seen in perspective: nearer is drawn bigger, a zoom moves the eye toward the middle of the view and reads back as the zoom asked for, and the sheet stays between the near and far planes (ADR-1062 D1)', () => {
  const size = { width: 1440, height: 960 }, reach = Math.hypot(3000, 1200);
  for (const zoom of [0.4, 1, 3]) {
    const camera = sheetEye(zoom, reach, size);
    assert.ok(Math.abs(sheetEyeZoom(camera, size) - zoom) < 1e-9, `the eye reads back the zoom it was framed to (${zoom})`);
    // A 100-unit road across the middle of the view is drawn `zoom` pixels a unit wide there.
    const middle = new Vector3(0, 0, SHEET_RADIUS + PLATE_CLEARANCE), across = middle.clone().add(new Vector3(100, 0, 0));
    const px = (a: Vector3, b: Vector3) => { const p = a.clone().project(camera), q = b.clone().project(camera); return Math.abs(q.x - p.x) * size.width / 2; };
    assert.ok(Math.abs(px(middle, across) - 100 * zoom) < 1e-6, `${px(middle, across).toFixed(2)} px for 100 units at zoom ${zoom}`);
    // The same road nearer the eye (raised toward it) is drawn bigger, and farther, smaller.
    const lifted = (by: number) => px(middle.clone().setZ(middle.z + by), across.clone().setZ(across.z + by));
    assert.ok(lifted(300) > px(middle, across) * 1.05 && lifted(-300) < px(middle, across) / 1.05, 'nearer is bigger, farther smaller');
    assert.ok(camera.near > 0 && camera.near < camera.position.length() - SHEET_RADIUS - PLATE_CLEARANCE && camera.far >= camera.position.length() - SHEET_RADIUS + reach / 2, 'the sheet lies between the near and far planes');
  }
  // Zooming in moves the eye, not the lens: it stands half as far off at twice the zoom.
  const off = (zoom: number) => sheetEye(zoom, reach, size).position.length() - SHEET_RADIUS - PLATE_CLEARANCE;
  assert.ok(Math.abs(off(1) / off(2) - 2) < 1e-9 && sheetEye(2, reach, size).zoom === 1, 'twice the zoom, half the distance, the lens unchanged');
});

test('4.27 the glass sheet is a lit slab: the glass has a visible thickness with a rim round both faces, and its edge and every island\'s sides are shaded by the scene\'s lights (ADR-1062 D1)', () => {
  const glass = sheetGlass({ width: 1200, height: 600 });
  const top = glass.getObjectByName('sheet:pane') as Mesh, bottom = glass.getObjectByName('sheet:pane-under') as Mesh, edge = glass.getObjectByName('sheet:edge') as Mesh;
  assert.ok(top !== undefined && bottom !== undefined && edge !== undefined, 'a top face, an underside and an edge');
  const zAt = (mesh: Mesh) => { const box = new Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as BufferAttribute); return box.max.z; };
  assert.ok(Math.abs(zAt(top) - zAt(bottom) - SHEET_GLASS_THICKNESS) < 1e-6 && SHEET_GLASS_THICKNESS >= 3, `the glass is ${SHEET_GLASS_THICKNESS} units thick`);
  assert.equal(glass.children.filter(o => o.name.startsWith('sheet:rim')).length, 2, 'a rim round each face');
  const lit = (mesh: Mesh) => [mesh.material].flat().every(material => material instanceof MeshLambertMaterial || material instanceof MeshStandardMaterial);
  assert.ok(lit(edge), 'the glass\'s edge takes the light');
  const island = islandSurface([[{ x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: 20 }, { x: -20, z: 20 }]], SHEET_RADIUS, 'lit', SHEET_LAND_THICKNESS);
  const sides = island.getObjectByName('island-side') as Mesh;
  assert.ok(lit(sides) && sides.geometry.getAttribute('normal') !== undefined, 'an island\'s sides take the light');
  // Each wall faces outward from the island, level with its land, so the light shades the four walls of a square four ways.
  const normals = sides.geometry.getAttribute('normal'), position = sides.geometry.getAttribute('position'), facing = new Set<string>();
  for (let i = 0; i < normals.count; i++) {
    const n = new Vector3().fromBufferAttribute(normals, i), p = new Vector3().fromBufferAttribute(position, i);
    assert.ok(Math.abs(n.y) < 1e-6 && n.x * p.x + n.z * p.z > 0, 'outward and level');
    facing.add(`${Math.round(n.x)} ${Math.round(n.z)}`);
  }
  assert.equal(facing.size, 4);
  const lights = sheetLights();
  assert.ok(lights.some(light => light instanceof DirectionalLight) && lights.some(light => light instanceof AmbientLight), 'a lamp and soft light all round');
});

test('4.23 on the glass sheet every island is a raised plate of one shared thickness, its sides running from its land down to the glass', () => {
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

test('4.24 on the glass sheet a hollow island is its coast line alone, hiding nothing beneath it, and turns solid again (ADR-1061 D2)', () => {
  const coast = [[{ x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: 20 }, { x: -20, z: 20 }]];
  const island = islandSurface(coast, SHEET_RADIUS, 'hollow', SHEET_LAND_THICKNESS);
  const shown = () => {
    const meshes: ThreeMesh[] = [];
    island.traverseVisible(o => { if (o instanceof ThreeMesh) meshes.push(o); });
    return meshes;
  };
  const solid = shown().map(o => o.name).sort();
  hollowIsland(island, true);
  island.updateMatrixWorld(true);
  assert.ok(shown().length > 0 && shown().every(o => o.name.startsWith('island-coast')), `only its coast shows: ${shown().map(o => o.name)}`);
  assert.ok(shown().every(o => !(o.material as { depthWrite: boolean }).depthWrite), 'and the coast writes no depth');
  // A note under the island's middle, looked at from either side of the glass: nothing of the island is drawn over it.
  for (const way of [1, -1]) {
    const hits = new Raycaster(new Vector3(0, -40 * way, 0), new Vector3(0, way, 0)).intersectObject(island, true).filter(hit => hit.object.visible);
    assert.deepEqual(hits.map(hit => hit.object.name), [], `nothing covers the note from ${way > 0 ? 'below' : 'above'}`);
  }
  hollowIsland(island, false);
  assert.deepEqual(shown().map(o => o.name).sort(), solid, 'turned back, it is whole again');
});

test('4.25 what hangs under the glass sheet shows by the angle: hidden from well above, at the top resting tilt, in view from near level and from below, drawn behind the glass from above and over it from below (ADR-1062 D4)', () => {
  const sheet = new Group(), under = new Group();
  sheet.add(under);
  under.add(new ThreeMesh());
  const camera = new PerspectiveCamera(SHEET_FOV, 1.5, 0.1, 100);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const at = (tilt: number) => {
    sheet.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -tilt);
    sheet.updateMatrixWorld(true);
    hangUnderTheGlass(under, camera);
    return { shown: under.visible, order: under.children[0]!.renderOrder };
  };
  const degrees = (d: number) => d * Math.PI / 180;
  for (const tilt of [0, SHEET_TILT, degrees(55)]) assert.equal(at(tilt).shown, false, `from well above (${(tilt * 180 / Math.PI).toFixed(0)}°) none of it shows`);
  for (const tilt of [degrees(75), degrees(89)]) {
    const seen = at(tilt);
    assert.ok(seen.shown && seen.order < -1, `near level from above (${(tilt * 180 / Math.PI).toFixed(0)}°) it shows, drawn before the glass it hangs behind`);
  }
  for (const tilt of [degrees(91), Math.PI - SHEET_TILT, Math.PI]) {
    const seen = at(tilt);
    assert.ok(seen.shown && seen.order > 20, `from below (${(tilt * 180 / Math.PI).toFixed(0)}°) it shows, drawn over the glass`);
  }
});

test('4.28 under clear glass (the Library look) what hangs beneath shows at every angle, from straight above to straight below, and the glass clears and smokes again without moving (ADR-1062 D3, D4)', () => {
  const sheet = new Group(), under = new Group();
  sheet.add(under);
  under.add(new ThreeMesh());
  const camera = new PerspectiveCamera(SHEET_FOV, 1.5, 0.1, 100);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  for (const tilt of [0, SHEET_TILT, Math.PI / 2, Math.PI - SHEET_TILT, Math.PI]) {
    sheet.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -tilt);
    sheet.updateMatrixWorld(true);
    hangUnderTheGlass(under, camera, true);
    assert.equal(under.visible, true, `clear, at ${(tilt * 180 / Math.PI).toFixed(0)}° it shows`);
  }
  const glass = sheetGlass({ width: 400, height: 300 });
  const opacity = () => ['sheet:pane', 'sheet:pane-under', 'sheet:edge'].flatMap(name => [(glass.getObjectByName(name) as ThreeMesh).material].flat().map(face => face.opacity));
  const smoked = opacity(), where = glass.position.clone();
  clearGlass(glass, true);
  const clear = opacity();
  clear.forEach((value, at) => assert.ok(value <= smoked[at]! / 3, `clear, part ${at} is far fainter than smoked (${value} against ${smoked[at]})`));
  assert.ok(clear[0]! <= 0.1, "the top pane all but vanishes");
  clearGlass(glass, false);
  assert.deepEqual(opacity(), smoked, "smoked again");
  assert.ok(glass.position.equals(where), "the glass never moves");
});

// Three draws a see-through, double-sided material in two passes and re-versions it before each, re-deriving its shader
// program twice a frame (ADR-0836 D1); each glass part instead draws its far face then its near face, one material each.
test('3.9 an animating glass sheet redraws its panes and edge, far face then near face, without re-deriving a shader program', () => {
  const glass = sheetGlass({ width: 400, height: 300 });
  for (const name of ['sheet:pane', 'sheet:pane-under', 'sheet:edge']) {
    const part = glass.getObjectByName(name) as Mesh;
    const materials = [part.material].flat();
    assert.deepEqual(materials.filter(material => material.transparent && material.side === DoubleSide && !material.forceSinglePass).map(() => name), []);
    const whole = part.geometry.index!.count;
    assert.deepEqual(part.geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, side: materials[materialIndex!]!.side })),
      [{ start: 0, count: whole, side: BackSide }, { start: 0, count: whole, side: FrontSide }], `${name} draws both faces, far first`);
  }
});
