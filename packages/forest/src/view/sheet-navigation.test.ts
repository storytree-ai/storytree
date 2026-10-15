/** The forest on the glass sheet: what moves it, and where it opens (ADR-1043 D4). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, OrthographicCamera, Vector3 } from "three";
import { workStates } from "@storytree/arc-surface";
import { forestScene, storyNodes } from "@storytree/forest";
import type { AnnotatedTree, Change } from "@storytree/library";
import { applyPlanetFraming, applySheetEye, plateTransform, SHEET_RADIUS, SHEET_TILT, sheetSpot, SHIPPED_ELEVATION_DEG, type SheetPoint } from "@storytree/forest-world/planet";
import { createGlobeGuide, type GlobePose } from "./globe-guide.js";
import { focusRotation, markerSpot } from "./planet-navigation.js";
import { sheetCentre, sheetLayout, sheetMarkers, sheetOpening, sheetPan, sheetTurnedOver } from "./sheet-navigation.js";
import { sheetPoint } from "@storytree/forest-world/planet";

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
  const world = (p: SheetPoint, z = 0) => new Vector3(...plateTransform(sheetSpot(p), SHEET_RADIUS, z).position).applyMatrix4(globe.matrixWorld);
  const screen = (p: SheetPoint, z = 0) => {
    const at = world(p, z).project(camera);
    return { x: (at.x + 1) * size.width / 2, y: (1 - at.y) * size.height / 2 };
  };
  // The angle between the top face's outward normal at `p` and the direction to the eye.
  const facing = (p: SheetPoint) => new Vector3(...plateTransform(sheetSpot(p), SHEET_RADIUS).position).normalize().applyQuaternion(globe.quaternion)
    .angleTo(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion));
  // How far from the eye a place on the sheet lies, along its line of sight.
  const distance = (p: SheetPoint, z = 0) => -world(p, z).applyMatrix4(camera.matrixWorldInverse).z;
  return { camera, screen, facing, distance };
}

test("3.52 on the glass sheet the eye rests at one fixed tabletop tilt, the north edge away from it: a drag or a sideways scroll pans the sheet, the wheel zooms it, the turn turns it over, and none of them changes the tilt; it opens framing the sheet's height from its west edge", () => {
  const layout = sheet(12), { extent } = layout;
  assert.ok(extent.width > extent.height, "a deep library lies wider than tall");
  assert.ok(SHEET_TILT > 30 * Math.PI / 180 && SHEET_TILT < 50 * Math.PI / 180, `a tabletop tilt, neither top-down nor edge-on (${(SHEET_TILT * 180 / Math.PI).toFixed(1)}°)`);
  const opening = sheetOpening(extent, size);
  const opened = eye(opening, extent);
  const west = opened.screen({ x: -extent.width / 2, y: 0 }), north = opened.screen({ x: -extent.width / 2, y: extent.height / 2 }), south = opened.screen({ x: -extent.width / 2, y: -extent.height / 2 });
  assert.ok(Math.abs(west.x) < 1, `the west edge is at the window's left (${west.x.toFixed(2)} px)`);
  assert.ok(north.y > 0 && south.y < size.height && south.y - north.y > 0.75 * size.height, "the sheet's whole height fills the window");
  assert.ok(opened.screen({ x: extent.width / 2, y: 0 }).x > size.width, "and the east runs on past the window's right, to scroll to");
  /** The tilt the eye sees at `face` and over `p`, within the degree the big sphere bends across the sheet: the face's
   * angle from the eye, with the edge at the window's top farther from the eye than the edge at its bottom. */
  const tilted = (face: ReturnType<typeof eye>, p: SheetPoint, under = false) => {
    const angle = face.facing(p);
    assert.ok(Math.abs((under ? Math.PI - angle : angle) - SHEET_TILT) < Math.PI / 180, `the tilt is ${((under ? Math.PI - angle : angle) * 180 / Math.PI).toFixed(2)}°`);
    const far = face.distance({ x: p.x, y: p.y + (under ? -50 : 50) }), near = face.distance({ x: p.x, y: p.y + (under ? 50 : -50) });
    assert.ok(far > near + 50, "the edge at the window's top lies farther from the eye than the edge at its bottom");
  };
  tilted(opened, sheetCentre(opening.turn));
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
      assert.ok(Math.abs(moved.x - grabbed.x - step.drag.x) < 0.5 && Math.abs(moved.y - grabbed.y - step.drag.y) < 0.5, `the sheet follows the drag (${(moved.x - grabbed.x).toFixed(1)}, ${(moved.y - grabbed.y).toFixed(1)})`);
    }
    for (const p of [sheetCentre(turn), { x: -extent.width / 2, y: extent.height / 2 }, { x: extent.width / 2, y: -extent.height / 2 }]) tilted(after, p);
  }
  // Turned over, and back: the underside rests at the same tilt, and so does the top face again.
  tilted(eye({ ...opening, turn }, extent, Math.PI), sheetCentre(turn), true);
  tilted(eye({ ...opening, turn }, extent, 0), sheetCentre(turn));
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
  // Turned from the top face's rest at the tilt, the sheet stands edge-on to the eye a tilt past a quarter of the way over.
  const top = eye(opening, extent), under = eye(opening, extent, Math.PI), edgeOn = eye(opening, extent, Math.PI / 2 + SHEET_TILT);
  const held = sheetCentre(opening.turn);
  const west = { x: held.x - 200, y: held.y }, east = { x: held.x + 200, y: held.y }, north = { x: held.x, y: held.y + 100 }, south = { x: held.x, y: held.y - 100 };
  assert.ok(Math.abs(top.facing(held) - SHEET_TILT) < 1e-6 && Math.abs(under.facing(held) - (Math.PI - SHEET_TILT)) < 1e-6, "the top face looks at the eye, then the underside does, each at the tilt");
  assert.ok(Math.abs(edgeOn.facing(held) - Math.PI / 2) < 1e-6, "on its way over, the sheet passes edge-on");
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

test("3.56 under the glass sheet the knowledge graph visibly hangs: at the resting tilt each computed depth hangs well below the one above it, lower in the window on the top face and toward the eye on the underside", () => {
  const layout = sheet(12), { extent, under } = layout, opening = sheetOpening(extent, size);
  const top = eye(opening, extent), below = eye(opening, extent, Math.PI);
  const shelf = under.shelfAt("s3")!;
  for (let depth = 0; depth < 4; depth++) {
    const z = -depth * under.depthStep, deeper = z - under.depthStep;
    const drop = top.screen(shelf, deeper).y - top.screen(shelf, z).y;
    assert.ok(drop >= 12, `on the top face a depth deeper is ${drop.toFixed(1)} px lower in the window`);
    const nearer = below.distance(shelf, z) - below.distance(shelf, deeper);
    assert.ok(nearer >= under.depthStep * 0.7, `on the underside a depth deeper hangs ${nearer.toFixed(1)} units nearer the eye`);
    assert.ok(Math.abs(below.screen(shelf, deeper).y - below.screen(shelf, z).y) >= 12, "and is seen apart from the one above it");
  }
});

test("3.11 on the glass sheet a failing island past the window's edge gets a marker at the edge nearest it, and its turn pans it into view", () => {
  const layout = sheet(12), { extent } = layout, opening = sheetOpening(extent, size);
  const opened = eye(opening, extent), zoom = opened.camera.zoom;
  const failing = (story: string) => layout.islands.map(island => island.story === story ? { ...island, trees: [{ status: "unhealthy" as const }] } : island);
  const where = (story: string) => sheetPoint(layout.spots.get(story)!);
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= size.width && p.y >= 0 && p.y <= size.height;
  assert.ok(!inside(opened.screen(where("s11"))), "the deepest island opens past the window's right");
  assert.ok(inside(opened.screen(where("s0"))), "the first lies in the window");
  assert.deepEqual(sheetMarkers(layout.islands, opening.turn, zoom, size), [], "nothing failing, no marker");
  assert.deepEqual(sheetMarkers(failing("s0"), opening.turn, zoom, size), [], "a failing island in the window needs none");
  const [marker, ...rest] = sheetMarkers(failing("s11"), opening.turn, zoom, size);
  assert.equal(rest.length, 0);
  assert.equal(marker!.story, "s11");
  const drawn = opened.screen(where("s11"));
  assert.ok(Math.abs(marker!.left - drawn.x) < 0.5 && Math.abs(marker!.top - drawn.y) < 0.5, "it points where the island is drawn");
  const spot = markerSpot(marker!, size, []);
  assert.equal(spot.left, size.width - 20, "at the window's right edge, the edge nearest the island");
  assert.ok(Math.abs(spot.top - drawn.y) < 0.5, "level with it");
  assert.deepEqual(sheetMarkers(failing("s11"), opening.turn, zoom, size, undefined, "library"), [], "only the Library's face hides it (ADR-0660 D4)");
  // Its click pans the island to the middle of the view, at the same zoom, and the marker goes.
  const centred = sheetCentre(marker!.turn), at = where("s11");
  assert.ok(Math.abs(centred.x - at.x) < 1e-6 && Math.abs(centred.y - at.y) < 1e-6, "the island comes to the middle of the view");
  assert.deepEqual(sheetMarkers(failing("s11"), marker!.turn, zoom, size), []);
});
