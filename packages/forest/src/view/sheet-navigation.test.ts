/** The forest on the glass sheet: what moves it, and where it opens (ADR-1043 D4). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, OrthographicCamera, Vector3 } from "three";
import { workStates } from "@storytree/arc-surface";
import { forestScene, storyNodes } from "@storytree/forest";
import type { AnnotatedTree, Change } from "@storytree/library";
import { applyPlanetFraming, applySheetEye, plateTransform, SHEET_RADIUS, sheetSpot, SHIPPED_ELEVATION_DEG, type SheetPoint } from "@storytree/forest-world/planet";
import { createGlobeGuide, type GlobePose } from "./globe-guide.js";
import { focusRotation } from "./planet-navigation.js";
import { sheetCentre, sheetLayout, sheetOpening, sheetPan, sheetTurnedOver } from "./sheet-navigation.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const size = { width: 1440, height: 960 };

/** A deep, narrow library: a chain of `depth` stories, each building on the last, beside two foundations. */
function sheet(depth: number) {
  const ids = [...Array.from({ length: depth }, (_, k) => `s${k}`), "loose-a", "loose-b"];
  const tree: AnnotatedTree = { arcs: [], stories: ids.map((id, k) => ({ id, title: `Story ${id}`, health, capabilities: [
    { id: `${id}-cap`, title: "A part", dependsOn: id.startsWith("s") && k > 0 ? [`s${k - 1}-cap`] : [], proposed: true, status: "proposed" as const, contracts: [], health },
  ] })) };
  const history = ids.map((id, index): Change => ({ seq: index + 1, recordId: id, type: "story", action: "created",
    record: { id, type: "story", version: 1, fields: { title: id }, createdAt: new Date(index).toISOString(), updatedAt: new Date(index).toISOString() } }));
  const scene = forestScene(tree, history, workStates([]));
  return sheetLayout(scene, new Map(storyNodes(tree, history).map(node => [node.id, node.place])));
}

/** The page's eye and its globe group, posed as the canvas poses them, the sheet turned `over` radians. */
function eye(pose: GlobePose, extent: { width: number; height: number }, over = 0) {
  const camera = new OrthographicCamera(-size.width / 2, size.width / 2, size.height / 2, -size.height / 2, 0.1, 1000);
  const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  camera.position.set(0, Math.sin(elevation), Math.cos(elevation));
  camera.lookAt(0, 0, 0);
  applyPlanetFraming(camera, SHEET_RADIUS, pose.framing, size);
  applySheetEye(camera, Math.hypot(extent.width, extent.height));
  camera.updateMatrixWorld();
  const globe = new Group();
  const turned = sheetTurnedOver(focusRotation(pose.turn, camera.quaternion), camera.quaternion, over);
  globe.quaternion.copy(turned.quaternion);
  globe.position.copy(turned.position);
  globe.updateMatrixWorld();
  const world = (p: SheetPoint) => new Vector3(...plateTransform(sheetSpot(p), SHEET_RADIUS).position).applyMatrix4(globe.matrixWorld);
  const screen = (p: SheetPoint) => {
    const at = world(p).project(camera);
    return { x: (at.x + 1) * size.width / 2, y: (1 - at.y) * size.height / 2 };
  };
  // The angle between the top face's outward normal at `p` and the direction to the eye.
  const facing = (p: SheetPoint) => new Vector3(...plateTransform(sheetSpot(p), SHEET_RADIUS).position).normalize().applyQuaternion(globe.quaternion)
    .angleTo(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion));
  return { camera, screen, facing };
}

test("3.52 on the glass sheet the eye always looks straight down on the top face: a drag or a sideways scroll pans it, the wheel zooms it, and nothing turns or tilts it; it opens framing the sheet's height from its west edge", () => {
  const layout = sheet(12), { extent } = layout;
  assert.ok(extent.width > extent.height, "a deep library lies wider than tall");
  const opening = sheetOpening(extent, size);
  const opened = eye(opening, extent);
  const west = opened.screen({ x: -extent.width / 2, y: 0 }), north = opened.screen({ x: -extent.width / 2, y: extent.height / 2 }), south = opened.screen({ x: -extent.width / 2, y: -extent.height / 2 });
  assert.ok(Math.abs(west.x) < 1, `the west edge is at the window's left (${west.x.toFixed(2)} px)`);
  assert.ok(north.y > 0 && south.y < size.height && south.y - north.y > 0.75 * size.height, "the sheet's whole height fills the window");
  assert.ok(opened.screen({ x: extent.width / 2, y: 0 }).x > size.width, "and the east runs on past the window's right, to scroll to");
  // A drag right and down, then a sideways scroll east, then a zoom by the wheel: a point under the pointer follows it.
  let turn = opening.turn, zoom = opened.camera.zoom;
  const steps: { drag: { x: number; y: number }; zoom?: number }[] = [{ drag: { x: 300, y: 120 } }, { drag: { x: -900, y: 0 } }, { drag: { x: 0, y: 0 }, zoom: 2.5 }, { drag: { x: -400, y: -200 } }];
  for (const step of steps) {
    const held = sheetCentre(turn);
    const before = eye({ ...opening, turn, framing: opening.framing * opened.camera.zoom / zoom }, extent);
    const grabbed = before.screen({ x: held.x + 40, y: held.y - 30 });
    zoom *= step.zoom ?? 1;
    turn = sheetPan(turn, step.drag, zoom, extent);
    const after = eye({ ...opening, turn, framing: opening.framing * opened.camera.zoom / zoom }, extent);
    if (step.zoom === undefined) {
      const moved = after.screen({ x: held.x + 40, y: held.y - 30 });
      assert.ok(Math.abs(moved.x - grabbed.x - step.drag.x) < 0.5 && Math.abs(moved.y - grabbed.y - step.drag.y) < 0.5, "the sheet follows the drag");
    }
    for (const p of [sheetCentre(turn), { x: -extent.width / 2, y: extent.height / 2 }, { x: extent.width / 2, y: -extent.height / 2 }])
      assert.ok(after.facing(p) < Math.PI / 180, "every part of the sheet faces the eye: it never turns or tilts");
  }
  const far = sheetPan(turn, { x: -1e7, y: 1e7 }, zoom, extent), edge = sheetCentre(far);
  assert.ok(Math.abs(edge.x - extent.width / 2) < 1e-6 && Math.abs(edge.y - extent.height / 2) < 1e-6, "a pan stops with the sheet's north-east corner in the middle of the view");
});

test("3.53 on the glass sheet, Home eases the view back to the one it opened on, however it was panned and zoomed", () => {
  const { extent } = sheet(9), opening = sheetOpening(extent, size);
  let pose: GlobePose = opening;
  const guide = createGlobeGuide({ world: () => new Group(), camera: () => new OrthographicCamera(), size: () => size,
    read: () => pose, write: next => { pose = next; }, invalidate() {} });
  pose = { ...pose, turn: sheetPan(sheetPan(pose.turn, { x: -700, y: 80 }, 1, extent), { x: -300, y: -50 }, 2, extent), framing: pose.framing / 3 };
  assert.ok(Math.abs(sheetCentre(pose.turn).x - sheetCentre(opening.turn).x) > 100, "panned east");
  assert.equal(guide.home(sheetOpening(extent, size), 600), true);
  guide.frame(300);
  guide.frame(300);
  const home = sheetCentre(pose.turn), opened = sheetCentre(opening.turn);
  assert.ok(Math.abs(home.x - opened.x) < 1e-6 && Math.abs(home.y - opened.y) < 1e-6, "back over the place it opened on");
  assert.equal(pose.framing, opening.framing, "at the zoom it opened at");
});

test("3.54 the glass sheet turns over north to south about its west-east axis: on the underside depth still runs west to east, the north edge lies at the bottom, and a drag still pans it the way the pointer moves", () => {
  const { extent } = sheet(12), opening = sheetOpening(extent, size);
  const top = eye(opening, extent), under = eye(opening, extent, Math.PI), edgeOn = eye(opening, extent, Math.PI / 2);
  const held = sheetCentre(opening.turn);
  const west = { x: held.x - 200, y: held.y }, east = { x: held.x + 200, y: held.y }, north = { x: held.x, y: held.y + 100 }, south = { x: held.x, y: held.y - 100 };
  assert.ok(top.facing(held) < 1e-6 && Math.abs(under.facing(held) - Math.PI) < 1e-6, "the top face looks at the eye, then the underside does");
  assert.ok(Math.abs(edgeOn.facing(held) - Math.PI / 2) < 1e-6, "half way, the sheet is edge-on");
  for (const face of [top, under]) assert.ok(face.screen(west).x < face.screen(east).x - 300, "depth runs west to east on both faces");
  assert.ok(top.screen(north).y < top.screen(south).y && under.screen(north).y > under.screen(south).y + 100, "turned over north to south: the north edge comes to the bottom");
  for (const face of [under, edgeOn]) {
    const at = face.screen(held), was = top.screen(held);
    assert.ok(Math.hypot(at.x - was.x, at.y - was.y) < 1e-3, "the turn pivots on the middle of the view, so nothing slides away");
  }
  // A drag on the underside: the point under the pointer follows it.
  const grabbed = under.screen({ x: held.x + 40, y: held.y - 30 });
  const panned = sheetPan(opening.turn, { x: 120, y: 80 }, top.camera.zoom, extent, true);
  const moved = eye({ ...opening, turn: panned }, extent, Math.PI).screen({ x: held.x + 40, y: held.y - 30 });
  assert.ok(Math.abs(moved.x - grabbed.x - 120) < 0.5 && Math.abs(moved.y - grabbed.y - 80) < 0.5, `the underside follows the drag (${(moved.x - grabbed.x).toFixed(1)}, ${(moved.y - grabbed.y).toFixed(1)})`);
});
