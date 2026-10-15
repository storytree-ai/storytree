/** The forest on the glass sheet: what moves it, and where it opens (ADR-1043 D4). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, Mesh, OrthographicCamera, Vector3 } from "three";
import { workStates } from "@storytree/arc-surface";
import { forestScene, storyNodes } from "@storytree/forest";
import type { AnnotatedTree, Change } from "@storytree/library";
import { applyPlanetFraming, applySheetEye, plateTransform, SHEET_RADIUS, SHEET_TILT, sheetSpot, SHIPPED_ELEVATION_DEG, type SheetPoint } from "@storytree/forest-world/planet";
import { createGlobeGuide, type GlobePose } from "./globe-guide.js";
import { focusRotation, markerSpot } from "./planet-navigation.js";
import { compassNorth, headingHome, opensBare, sheetCentre, sheetDrag, sheetKey, sheetKeyPan, sheetLayout, sheetMarkers, sheetOpening, sheetPan, sheetSpin, sheetTurnedOver, sheetTwist } from "./sheet-navigation.js";
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

/** The page's eye and its globe group, posed as the canvas poses them, the sheet turned `over` radians and spun to `heading`. */
function eye(pose: GlobePose, extent: { width: number; height: number }, over = 0, heading = 0) {
  const camera = new OrthographicCamera(-size.width / 2, size.width / 2, size.height / 2, -size.height / 2, 0.1, 1000);
  const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  camera.position.set(0, Math.sin(elevation), Math.cos(elevation));
  camera.lookAt(0, 0, 0);
  applyPlanetFraming(camera, SHEET_RADIUS, pose.framing, size);
  applySheetEye(camera, Math.hypot(extent.width, extent.height));
  camera.updateMatrixWorld();
  const globe = new Group();
  const turned = sheetTurnedOver(focusRotation(pose.turn, camera.quaternion), camera.quaternion, over, heading);
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
  return { camera, globe, screen, facing, distance };
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

test("3.56 under the glass sheet the knowledge graph visibly hangs: at the resting tilt each computed depth hangs well below the one above it, toward the eye on the Library face", () => {
  const layout = sheet(12), { extent, under } = layout, opening = sheetOpening(extent, size);
  const below = eye(opening, extent, Math.PI);
  const shelf = under.shelfAt("s3")!;
  for (let depth = 0; depth < 4; depth++) {
    const z = -depth * under.depthStep, deeper = z - under.depthStep;
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

/** Headings the key, spin and compass tests read the sheet at: none, a quarter, odd ones, a half and past it backwards. */
const headings = [0, Math.PI / 2, 1.1, Math.PI, -2.3];
const keyed = (key: string, target?: unknown, extra: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => sheetKey({ type: "keydown", key, target, ...extra });

test("3.57 on the glass sheet WASD and the arrow keys pan it the way they point on the window, whatever its heading and on either face, at a speed that keeps pace with the zoom", () => {
  const { extent } = sheet(12), opening = sheetOpening(extent, size), zoom = eye(opening, extent).camera.zoom;
  const ways: Record<string, { x: number; y: number }> = { w: { x: 0, y: 1 }, arrowup: { x: 0, y: 1 }, s: { x: 0, y: -1 }, arrowdown: { x: 0, y: -1 }, a: { x: 1, y: 0 }, arrowleft: { x: 1, y: 0 }, d: { x: -1, y: 0 }, arrowright: { x: -1, y: 0 } };
  // From the middle of the sheet, so no edge stops the pan.
  const turn = sheetPan(opening.turn, { x: -extent.width / 2 * zoom + size.width / 2, y: 0 }, zoom, extent);
  for (const [key, way] of Object.entries(ways)) {
    const pressed = keyed(key === "w" || key === "a" || key === "s" || key === "d" ? key.toUpperCase() : key.replace("arrow", "Arrow").replace(/(Arrow)(\w)/, (_, a, b) => a + b.toUpperCase()));
    assert.deepEqual(pressed, { kind: "pan", key }, `${key} pans`);
    const drag = sheetKeyPan(new Set([key]), 0.25);
    for (const under of [false, true]) for (const heading of headings) {
      const over = under ? Math.PI : 0, held = sheetCentre(turn), at = { x: held.x + 30, y: held.y - 20 };
      const before = eye({ ...opening, turn }, extent, over, heading).screen(at);
      const moved = sheetPan(turn, drag, zoom, extent, under, heading);
      const after = eye({ ...opening, turn: moved }, extent, over, heading).screen(at);
      const dx = after.x - before.x, dy = after.y - before.y;
      // W is away from you: the view goes up the window, so what is under it slides down; A goes left, so it slides right.
      assert.ok(Math.abs(dx - drag.x) < 0.5 && Math.abs(dy - drag.y) < 0.5 && Math.sign(Math.round(dx)) === way.x && Math.sign(Math.round(dy)) === way.y,
        `${key} at heading ${heading.toFixed(2)}${under ? " underneath" : ""} slides the sheet (${dx.toFixed(1)}, ${dy.toFixed(1)})`);
    }
  }
  // The same key held as long crosses the same distance on the window at any zoom, so half the ground at twice the zoom.
  const near = sheetCentre(sheetPan(turn, sheetKeyPan(new Set(["d"]), 0.25), zoom * 2, extent)).x - sheetCentre(turn).x;
  const far = sheetCentre(sheetPan(turn, sheetKeyPan(new Set(["d"]), 0.25), zoom, extent)).x - sheetCentre(turn).x;
  assert.ok(far > 0 && Math.abs(near - far / 2) < 1e-6, `twice the zoom, half the ground (${near.toFixed(2)} of ${far.toFixed(2)})`);
  assert.deepEqual(sheetKeyPan(new Set(["w", "s"]), 0.25), { x: 0, y: 0 }, "opposite keys cancel");
});

test("3.58 Q and E spin the glass sheet a quarter turn about its upright axis, the same way on the window on either face, and change nothing else: the tilt, the zoom and the place in the middle of the view hold", () => {
  const { extent } = sheet(12), opening = sheetOpening(extent, size);
  assert.deepEqual(keyed("q"), { kind: "spin", by: -1 });
  assert.deepEqual(keyed("E"), { kind: "spin", by: 1 });
  for (const under of [false, true]) for (const heading of headings) {
    const over = under ? Math.PI : 0, before = eye(opening, extent, over, heading), held = sheetCentre(opening.turn);
    for (const by of [-1, 1] as const) {
      const next = sheetSpin(heading, by * Math.PI / 2, under);
      assert.ok(Math.abs(Math.abs(next - heading) - Math.PI / 2) < 1e-12, "exactly a quarter turn");
      const after = eye(opening, extent, over, next);
      assert.equal(after.camera.zoom, before.camera.zoom, "the zoom holds");
      const angle = after.facing(held);
      assert.ok(Math.abs((under ? Math.PI - angle : angle) - SHEET_TILT) < 1e-6, "the tilt holds");
      const middle = before.screen(held), still = after.screen(held);
      assert.ok(Math.hypot(still.x - middle.x, still.y - middle.y) < 1e-3, "it pivots on the middle of the view");
      // A road running east from the middle turns a quarter of the way round on the window, clockwise for E on either face.
      const east = (face: ReturnType<typeof eye>) => { const a = face.screen(held), b = face.screen({ x: held.x + 50, y: held.y }); return Math.atan2(b.y - a.y, b.x - a.x); };
      const turned = Math.atan2(Math.sin(east(after) - east(before)), Math.cos(east(after) - east(before)));
      // Clockwise on the window is a growing angle with y down; the tilt squashes the quarter turn, so read its sense, not its size.
      assert.ok(Math.sign(turned) === by && Math.abs(turned) > 0.5, `${by > 0 ? "E" : "Q"} at ${heading.toFixed(2)}${under ? " underneath" : ""} turns it ${(turned * 180 / Math.PI).toFixed(0)}° on the window`);
    }
  }
});

test("3.59 a plain drag pans the glass sheet; a right-drag or a Ctrl+drag spins it smoothly about its upright axis, and so does a two-finger twist, never changing the tilt", () => {
  assert.equal(sheetDrag({ button: 0, ctrlKey: false, isPrimary: true }), "pan", "a plain drag pans");
  assert.equal(sheetDrag({ button: 2, ctrlKey: false, isPrimary: true }), "spin", "a right-drag spins");
  assert.equal(sheetDrag({ button: 0, ctrlKey: true, isPrimary: true }), "spin", "a Ctrl+drag spins");
  assert.equal(sheetDrag({ button: 1, ctrlKey: false, isPrimary: true }), undefined, "the middle button does nothing");
  const { extent } = sheet(12), opening = sheetOpening(extent, size), held = sheetCentre(opening.turn);
  for (const under of [false, true]) {
    const over = under ? Math.PI : 0;
    let heading = 0.3;
    for (const step of [12, 40, -7, 95]) {
      const next = sheetSpin(heading, step * Math.PI / 600, under);
      assert.ok(Math.abs(Math.abs(next - heading) - Math.abs(step) * Math.PI / 600) < 1e-12, "a small drag, a small spin");
      const angle = eye(opening, extent, over, next).facing(held);
      assert.ok(Math.abs((under ? Math.PI - angle : angle) - SHEET_TILT) < 1e-6, "the tilt holds");
      heading = next;
    }
  }
  // Two fingers turned a tenth of a turn clockwise on the window spin it a tenth of a turn that way.
  const twist = sheetTwist([{ x: 100, y: 100 }, { x: 300, y: 100 }], [{ x: 100, y: 100 }, { x: 100 + 200 * Math.cos(Math.PI / 5), y: 100 + 200 * Math.sin(Math.PI / 5) }]);
  assert.ok(Math.abs(twist - Math.PI / 5) < 1e-12, `clockwise on the window (${twist.toFixed(3)})`);
  assert.ok(Math.abs(sheetTwist([{ x: 0, y: 0 }, { x: -1, y: 0.01 }], [{ x: 0, y: 0 }, { x: -1, y: -0.01 }]) - 0.02) < 1e-3, "and across the half-turn without a jump");
});

test("3.60 the compass points to the glass sheet's starting north on the window, and a click on it or the Home key spins it back and returns to the opening view", () => {
  const { extent } = sheet(12), opening = sheetOpening(extent, size), held = sheetCentre(opening.turn);
  assert.deepEqual(keyed("Home"), { kind: "home" });
  for (const under of [false, true]) for (const heading of headings) {
    const face = eye(opening, extent, under ? Math.PI : 0, heading);
    const a = face.screen(held), b = face.screen({ x: held.x, y: held.y + 50 });
    const drawn = Math.atan2(-(b.y - a.y), b.x - a.x), north = compassNorth(heading, under);
    // The tilt squashes the window's up and down, so the drawn north is the compass's needle squashed the same way.
    const squashed = Math.atan2(Math.sin(north) * Math.cos(SHEET_TILT), Math.cos(north));
    assert.ok(Math.abs(Math.atan2(Math.sin(drawn - squashed), Math.cos(drawn - squashed))) < 0.02, `the needle at ${heading.toFixed(2)}${under ? " underneath" : ""} points north`);
  }
  assert.ok(Math.abs(compassNorth(0, false) - Math.PI / 2) < 1e-12, "facing its starting heading, north is up");
  // Spun three and a half turns and panned and zoomed, Home brings it back by the short way round, to the opening view.
  let pose: GlobePose = opening;
  const guide = createGlobeGuide({ world: () => new Group(), camera: () => new OrthographicCamera(), size: () => size, read: () => pose, write: next => { pose = next; }, invalidate() {} });
  pose = { ...pose, turn: sheetPan(pose.turn, { x: -600, y: 90 }, 1, extent), framing: pose.framing / 2 };
  const spun = 7 * Math.PI + 0.4, home = headingHome(spun);
  assert.ok(Math.abs(home - 8 * Math.PI) < 1e-12, "the nearest starting heading, not seven half-turns back");
  assert.equal(guide.home(sheetOpening(extent, size), 600), true);
  guide.frame(300);
  guide.frame(300);
  const opened = eye(opening, extent), back = eye(pose, extent, 0, home);
  for (const p of [held, { x: held.x + 200, y: held.y - 60 }]) {
    const was = opened.screen(p), is = back.screen(p);
    assert.ok(Math.hypot(was.x - is.x, was.y - is.y) < 1e-3, "back to the opening view");
  }
});

test("3.61 the sheet's keys are WASD, the arrows, Q, E, Home and T to turn it over, and none of them acts while you type in a text field or hold Ctrl, Alt or the command key", () => {
  assert.deepEqual(keyed("t"), { kind: "turn" });
  assert.deepEqual(keyed("x"), undefined);
  for (const key of ["w", "ArrowUp", "q", "E", "Home", "t"]) {
    for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) assert.equal(keyed(key, target), undefined, `${key} in a ${target.tagName}`);
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) assert.equal(keyed(key, { tagName: "BODY" }, extra), undefined, `${key} with ${Object.keys(extra)[0]}`);
    assert.notEqual(keyed(key, { tagName: "BODY" }), undefined, `${key} on the page`);
  }
  assert.equal(sheetKey({ type: "keyup", key: "w" }), undefined, "only a press");
});

test("3.63 an island-less sheet, the user's factory, opens on its Library face over a pool wide enough to spread its notes", () => {
  const empty = sheetLayout(forestScene({ arcs: [], stories: [] }, [], workStates([])), new Map());
  assert.ok(empty.under.pool.width >= empty.under.pool.height, `pool ${empty.under.pool.width} wide`);
  assert.ok(empty.extent.width >= empty.under.pool.width, "the glass runs under the whole pool");
  assert.equal(opensBare("library"), true);
  assert.equal(opensBare("forest"), false);
  // Turned over to the Library face, a note hung in its pool is on show, so its first-encounter card anchors at its dot.
  const opened = eye(sheetOpening(empty.extent, size), empty.extent, Math.PI), world = new Group(), glass = new Group(), dot = new Mesh();
  opened.globe.name = "globe";
  glass.name = "sheet:under";
  dot.name = "knowledge-point:agent_builder";
  const { pool } = empty.under, at = empty.under.place({ x: pool.x + pool.width / 2, y: pool.y + pool.height / 2, z: -20 });
  dot.position.set(at.x, at.y, at.z);
  world.add(opened.globe.add(glass.add(dot)));
  let pose = sheetOpening(empty.extent, size);
  const guide = createGlobeGuide({ world: () => world, camera: () => opened.camera, size: () => size, read: () => pose, write: next => { pose = next; }, invalidate() {} });
  assert.equal(guide.position({ kind: "note", note: "agent_builder" })?.visible, true);
});
