/** The forest on the glass sheet: what moves it, and where it opens (ADR-1043 D4). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, Mesh, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { workStates } from "@storytree/arc-surface";
import { forestScene, storyNodes } from "@storytree/forest";
import type { AnnotatedTree, Change } from "@storytree/library";
import { applySheetEye, plateTransform, SHEET_FOV, SHEET_RADIUS, SHEET_TILT, sheetEyeZoom, sheetSpot, SHIPPED_ELEVATION_DEG, type SheetPoint } from "@storytree/forest-world/planet";
import { createGlobeGuide, type GlobePose } from "./globe-guide.js";
import { focusRotation, markerSpot } from "./planet-navigation.js";
import { compassNorth, headingHome, opensBare, seesUnderside, sheetCentre, sheetDrag, sheetHome, sheetKey, sheetKeyPan, sheetLayout, sheetMarkers, sheetOpening, sheetPan, sheetSpin, sheetPanUnder, sheetSpinTilt, sheetTilted, sheetTiltBy, sheetTwist, sheetUnder, TILT_STEP } from "./sheet-navigation.js";
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

/** The zoom a pose frames, in CSS pixels per ground unit at the middle of the view. */
const zoomOf = (pose: GlobePose) => Math.min(size.width, size.height) / (2 * pose.framing * SHEET_RADIUS);
/** The tilt from below that mirrors the top resting one: the Library's resting view. */
const UNDERNEATH = Math.PI - SHEET_TILT;

/** The page's perspective eye and its globe group, posed as the canvas poses them, the sheet tilted `tilt` and spun to `heading`. */
function eye(pose: GlobePose, extent: { width: number; height: number }, tilt = SHEET_TILT, heading = 0) {
  const camera = new PerspectiveCamera(SHEET_FOV, size.width / size.height, 0.1, 1000);
  const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  camera.position.set(0, Math.sin(elevation), Math.cos(elevation));
  camera.lookAt(0, 0, 0);
  applySheetEye(camera, Math.hypot(extent.width, extent.height), zoomOf(pose), size);
  camera.updateMatrixWorld();
  const globe = new Group();
  const turned = sheetTilted(focusRotation(pose.turn, camera.quaternion), camera.quaternion, tilt, heading);
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
  /** A drag on the window from `from` by `drag`, as the page pans by it: the grabbed place kept under the pointer. */
  const dragged = (from: { x: number; y: number }, drag: { x: number; y: number }) => {
    const grabbed = sheetUnder(camera, globe, pose.turn, from, size, extent), now = sheetUnder(camera, globe, pose.turn, { x: from.x + drag.x, y: from.y + drag.y }, size, extent);
    assert.ok(grabbed !== undefined && now !== undefined, "the pointer is over the glass");
    return sheetPanUnder(pose.turn, grabbed, now, extent);
  };
  return { camera, globe, screen, facing, distance, dragged, zoom: sheetEyeZoom(camera, size) };
}

/** Headings the key, spin and compass tests read the sheet at: none, a quarter, odd ones, a half and past it backwards. */
const headings = [0, Math.PI / 2, 1.1, Math.PI, -2.3];
const keyed = (key: string, target?: unknown, extra: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => sheetKey({ type: "keydown", key, target, ...extra });

/** Whether a drag of `drag` moved a point from `before` to `after` on the window, to within half a pixel. */
const followed = (before: { x: number; y: number }, after: { x: number; y: number }, drag: { x: number; y: number }) =>
  Math.hypot(after.x - before.x - drag.x, after.y - before.y - drag.y) < 0.5;

test("3.52 on the glass sheet the eye rests at a tabletop tilt from above, the north edge away from it, and opens there framing the sheet's height in perspective from its west edge; a drag or a sideways scroll pans it and the wheel zooms it, and neither changes the tilt", () => {
  const layout = sheet(12), { extent } = layout;
  assert.ok(extent.width > extent.height, "a deep library lies wider than tall");
  assert.ok(SHEET_TILT > 30 * Math.PI / 180 && SHEET_TILT < 50 * Math.PI / 180, `a tabletop tilt, neither top-down nor edge-on (${(SHEET_TILT * 180 / Math.PI).toFixed(1)}°)`);
  const opening = sheetOpening(extent, size);
  const opened = eye(opening, extent), middle = sheetCentre(opening.turn);
  const north = opened.screen({ x: middle.x, y: extent.height / 2 }), south = opened.screen({ x: middle.x, y: -extent.height / 2 });
  // The Sessions strip's 170 px are kept clear, half at the top and half at the bottom.
  assert.ok(Math.abs(north.y - 85) < 1 && Math.abs(south.y - (size.height - 85)) < 1, `the sheet's whole height fills the window (${north.y.toFixed(1)} to ${south.y.toFixed(1)})`);
  assert.ok(middle.y < 0, "the nearer south half drawn bigger, the middle of the view lies south of the sheet's middle");
  const southWest = opened.screen({ x: -extent.width / 2, y: -extent.height / 2 }), northWest = opened.screen({ x: -extent.width / 2, y: extent.height / 2 });
  assert.ok(Math.abs(southWest.x) < 1 && northWest.x > 0, `the whole west edge in view, its nearest corner at the window's left (${southWest.x.toFixed(2)} px)`);
  assert.ok(opened.screen({ x: extent.width / 2, y: 0 }).x > size.width, "and the east runs on past the window's right, to scroll to");
  /** The tilt the eye sees at `face` and over `p`, within the degree the big sphere bends across the sheet and the eye's
   * own angle to `p`: the face's angle from the eye, with the edge at the window's top farther from the eye than the edge at its bottom. */
  const tilted = (face: ReturnType<typeof eye>, p: SheetPoint) => {
    const angle = face.facing(p);
    assert.ok(Math.abs(angle - SHEET_TILT) < Math.PI / 180, `the tilt is ${(angle * 180 / Math.PI).toFixed(2)}°`);
    const far = face.distance({ x: p.x, y: p.y + 50 }), near = face.distance({ x: p.x, y: p.y - 50 });
    assert.ok(far > near + 50, "the edge at the window's top lies farther from the eye than the edge at its bottom");
  };
  tilted(opened, middle);
  // A drag right and down, then a sideways scroll east, then a zoom by the wheel: a point under the pointer follows it.
  let turn = opening.turn, zoom = opened.zoom;
  const steps: { drag: { x: number; y: number }; zoom?: number }[] = [{ drag: { x: 300, y: 120 } }, { drag: { x: -900, y: 0 } }, { drag: { x: 0, y: 0 }, zoom: 2.5 }, { drag: { x: -400, y: -200 } }];
  for (const step of steps) {
    const held = sheetCentre(turn);
    zoom *= step.zoom ?? 1;
    const before = eye({ ...opening, turn, framing: opening.framing * opened.zoom / zoom }, extent);
    const grabbed = before.screen({ x: held.x + 40, y: held.y - 30 });
    turn = before.dragged(grabbed, step.drag);
    const after = eye({ ...opening, turn, framing: opening.framing * opened.zoom / zoom }, extent);
    if (step.zoom === undefined) {
      const moved = after.screen({ x: held.x + 40, y: held.y - 30 });
      assert.ok(followed(grabbed, moved, step.drag), `the sheet follows the drag (${(moved.x - grabbed.x).toFixed(1)}, ${(moved.y - grabbed.y).toFixed(1)})`);
    }
    tilted(after, sheetCentre(turn));
  }
  const far = sheetPanUnder(turn, { x: 1e7, y: 1e7 }, { x: 0, y: 0 }, extent), edge = sheetCentre(far);
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

test("3.54 seen from below, the glass sheet's depth still runs west to east, its north edge lies at the window's bottom, and a drag still pans it the way the pointer moves", () => {
  const { extent } = sheet(12), opening = sheetOpening(extent, size);
  const top = eye(opening, extent), under = eye(opening, extent, UNDERNEATH);
  const held = sheetCentre(opening.turn);
  const west = { x: held.x - 200, y: held.y }, east = { x: held.x + 200, y: held.y }, north = { x: held.x, y: held.y + 100 }, south = { x: held.x, y: held.y - 100 };
  assert.ok(Math.abs(under.facing(held) - UNDERNEATH) < 1e-6, "the underside looks at the eye at the mirror of the top's tilt");
  for (const face of [top, under]) assert.ok(face.screen(west).x < face.screen(east).x - 300, "depth runs west to east from above and below");
  assert.ok(top.screen(north).y < top.screen(south).y && under.screen(north).y > under.screen(south).y + 100, "from below, the north edge comes to the bottom");
  // A drag on the underside: the point under the pointer follows it.
  const grabbed = under.screen({ x: held.x + 40, y: held.y - 30 });
  const panned = under.dragged(grabbed, { x: 120, y: 80 });
  const moved = eye({ ...opening, turn: panned }, extent, UNDERNEATH).screen({ x: held.x + 40, y: held.y - 30 });
  assert.ok(followed(grabbed, moved, { x: 120, y: 80 }), `the underside follows the drag (${(moved.x - grabbed.x).toFixed(1)}, ${(moved.y - grabbed.y).toFixed(1)})`);
});

test("3.64 the glass sheet tilts like a table: a rotating drag's up-and-down part, or R and F a step at a time, tips it from straight down on the islands, through edge-on with the islands above and the graph below, to straight up at the underside, stopping at both ends, never rolling, pivoting on the middle of the view, and a tilt never changes the heading nor a spin the tilt", () => {
  const { extent } = sheet(12), opening = sheetOpening(extent, size), held = sheetCentre(opening.turn);
  assert.deepEqual(keyed("r"), { kind: "tilt", by: -1 });
  assert.deepEqual(keyed("F"), { kind: "tilt", by: 1 });
  assert.ok(TILT_STEP > 0 && TILT_STEP < Math.PI / 6, "a key tilts a step, not a face");
  assert.equal(sheetTiltBy(0.1, -1), 0, "a tilt stops at straight down");
  assert.equal(sheetTiltBy(Math.PI - 0.1, 1), Math.PI, "and at straight up");
  assert.equal(sheetSpinTilt(0.4, 0.2, { x: 0, y: 4000 }).tilt, 0, "a long drag down stops at straight down");
  assert.equal(sheetSpinTilt(0.4, 0.2, { x: 0, y: -4000 }).tilt, Math.PI, "and a long drag up at straight up");
  for (const heading of [0, 1.1, -2.3]) {
    assert.equal(sheetSpinTilt(heading, 0.9, { x: 0, y: -60 }).heading, heading, "tilting never changes the heading");
    assert.equal(sheetSpinTilt(heading, 0.9, { x: 80, y: 0 }).tilt, 0.9, "spinning never changes the tilt");
  }
  const pivot = eye(opening, extent).screen(held);
  for (const degrees of [5, 25, 60, 90, 120, 160, 175]) for (const heading of [0, 1.1]) {
    const tilt = degrees * Math.PI / 180, face = eye(opening, extent, tilt, heading);
    assert.ok(Math.abs(face.facing(held) - tilt) < 1e-6, `tipped ${degrees}° from straight down`);
    const at = face.screen(held);
    assert.ok(Math.hypot(at.x - pivot.x, at.y - pivot.y) < 1e-3, "it pivots on the middle of the view");
    // The sheet's upright axis at the middle stays upright on the window: no roll, whatever the heading.
    const up = face.screen(held, 30);
    assert.ok(Math.abs(up.x - at.x) < 1e-3 && up.y < at.y, `its upright axis points up the window at ${degrees}°`);
  }
  // Edge-on: the islands stand above the glass's line and the graph hangs below it.
  const level = eye(opening, extent, Math.PI / 2), glass = level.screen(held);
  assert.ok(level.screen(held, 9).y < glass.y - 3 && level.screen(held, -60).y > glass.y + 20, "edge-on, the islands above and the graph below");
  // Edge-on, a pointer above the glass's line is over no place on it; a drag there still pans the sheet the way it moves.
  assert.equal(sheetUnder(level.camera, level.globe, opening.turn, { x: glass.x, y: glass.y - 200 }, size, extent), undefined);
  const along = sheetCentre(sheetPan(opening.turn, { x: 100, y: 0 }, level.zoom, extent, Math.PI / 2)).x - held.x;
  assert.ok(Math.abs(along + 100 / level.zoom) < 1e-6, `a drag right brings the west into view (${along.toFixed(2)} units)`);
  // The keys' steps and the drag's tilt agree on the way: R toward the top face, F toward the underside.
  assert.ok(sheetTiltBy(SHEET_TILT, -TILT_STEP) < SHEET_TILT && sheetSpinTilt(0, SHEET_TILT, { x: 0, y: -20 }).tilt > SHEET_TILT, "F and a drag up tip it toward the underside");
});

test("3.56 under the glass sheet the knowledge graph visibly hangs: seen from below at the mirror of the opening tilt, each computed depth hangs well below the one above it, toward the eye", () => {
  const layout = sheet(12), { extent, under } = layout, opening = sheetOpening(extent, size);
  const below = eye(opening, extent, UNDERNEATH);
  const shelf = under.shelfAt("s3")!;
  for (let depth = 0; depth < 4; depth++) {
    const z = -depth * under.depthStep, deeper = z - under.depthStep;
    const nearer = below.distance(shelf, z) - below.distance(shelf, deeper);
    assert.ok(nearer >= under.depthStep * 0.7, `from below a depth deeper hangs ${nearer.toFixed(1)} units nearer the eye`);
    assert.ok(Math.abs(below.screen(shelf, deeper).y - below.screen(shelf, z).y) >= 12, "and is seen apart from the one above it");
  }
});

test("3.11 on the glass sheet a failing island past the window's edge gets a marker at the edge nearest it, and its turn pans it into view", () => {
  const layout = sheet(12), { extent } = layout, opening = sheetOpening(extent, size);
  const opened = eye(opening, extent);
  const failing = (story: string) => layout.islands.map(island => island.story === story ? { ...island, trees: [{ status: "unhealthy" as const }] } : island);
  const where = (story: string) => sheetPoint(layout.spots.get(story)!);
  const drawn = (island: { spot: { x: number; y: number; z: number } }) => { const at = opened.screen(sheetPoint(island.spot)); return { left: at.x, top: at.y }; };
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= size.width && p.y >= 0 && p.y <= size.height;
  assert.ok(!inside(opened.screen(where("s11"))), "the deepest island opens past the window's right");
  assert.ok(inside(opened.screen(where("s0"))), "the first lies in the window");
  assert.deepEqual(sheetMarkers(layout.islands, drawn, size), [], "nothing failing, no marker");
  assert.deepEqual(sheetMarkers(failing("s0"), drawn, size), [], "a failing island in the window needs none");
  const [marker, ...rest] = sheetMarkers(failing("s11"), drawn, size);
  assert.equal(rest.length, 0);
  assert.equal(marker!.story, "s11");
  const at11 = opened.screen(where("s11"));
  const spot = markerSpot(marker!, size, []);
  assert.equal(spot.left, size.width - 20, "at the window's right edge, the edge nearest the island");
  assert.ok(Math.abs(spot.top - at11.y) < 0.5, "level with where it is drawn");
  assert.deepEqual(sheetMarkers(failing("s11"), drawn, size, "library"), [], "in Library, where the islands are outlines over the knowledge, none is marked (ADR-0660 D4)");
  // Its click pans the island to the middle of the view, at the same zoom, and the marker goes.
  const centred = sheetCentre(marker!.turn), at = where("s11");
  assert.ok(Math.abs(centred.x - at.x) < 1e-6 && Math.abs(centred.y - at.y) < 1e-6, "the island comes to the middle of the view");
  const there = eye({ ...opening, turn: marker!.turn }, extent);
  assert.deepEqual(sheetMarkers(failing("s11"), island => { const p = there.screen(sheetPoint(island.spot)); return { left: p.x, top: p.y }; }, size), []);
});

test("3.57 on the glass sheet WASD and the arrow keys pan it the way they point on the window, whatever its heading and tilt, from above or below, at a speed that keeps pace with the zoom", () => {
  const { extent } = sheet(12), opening = sheetOpening(extent, size);
  const ways: Record<string, { x: number; y: number }> = { w: { x: 0, y: 1 }, arrowup: { x: 0, y: 1 }, s: { x: 0, y: -1 }, arrowdown: { x: 0, y: -1 }, a: { x: 1, y: 0 }, arrowleft: { x: 1, y: 0 }, d: { x: -1, y: 0 }, arrowright: { x: -1, y: 0 } };
  // From the middle of the sheet, so no edge stops the pan.
  const turn = sheetPanUnder(opening.turn, { x: 0, y: 0 }, sheetCentre(opening.turn), extent);
  for (const [key, way] of Object.entries(ways)) {
    const pressed = keyed(key === "w" || key === "a" || key === "s" || key === "d" ? key.toUpperCase() : key.replace("arrow", "Arrow").replace(/(Arrow)(\w)/, (_, a, b) => a + b.toUpperCase()));
    assert.deepEqual(pressed, { kind: "pan", key }, `${key} pans`);
    // A tenth of a second: steeply tilted, a held key's pixels cross far more of the far ground.
    const drag = sheetKeyPan(new Set([key]), 0.1);
    for (const tilt of [SHEET_TILT, 1.2, UNDERNEATH]) for (const heading of headings) {
      // A held key drags the middle of the view.
      const held = sheetCentre(turn), from = eye({ ...opening, turn }, extent, tilt, heading), before = from.screen(held);
      const moved = from.dragged(before, drag);
      const after = eye({ ...opening, turn: moved }, extent, tilt, heading).screen(held);
      const dx = after.x - before.x, dy = after.y - before.y;
      // W is away from you: the view goes up the window, so what is under it slides down; A goes left, so it slides right.
      assert.ok(followed(before, after, drag) && Math.sign(Math.round(dx)) === way.x && Math.sign(Math.round(dy)) === way.y,
        `${key} at heading ${heading.toFixed(2)}, tilted ${tilt.toFixed(2)}, slides the sheet (${dx.toFixed(1)}, ${dy.toFixed(1)})`);
    }
  }
  // The same key held as long crosses the same distance on the window at any zoom, so half the ground at twice the zoom.
  const ground = (framing: number) => {
    const at = eye({ ...opening, turn, framing }, extent), middle = at.screen(sheetCentre(turn));
    return sheetCentre(at.dragged(middle, sheetKeyPan(new Set(["d"]), 0.25))).x - sheetCentre(turn).x;
  };
  const near = ground(opening.framing / 2), far = ground(opening.framing);
  assert.ok(far > 0 && Math.abs(near - far / 2) < 1e-6, `twice the zoom, half the ground (${near.toFixed(2)} of ${far.toFixed(2)})`);
  assert.deepEqual(sheetKeyPan(new Set(["w", "s"]), 0.25), { x: 0, y: 0 }, "opposite keys cancel");
});

test("3.58 Q and E spin the glass sheet a quarter turn about its upright axis, the same way on the window from above or below, and change nothing else: the tilt, the zoom and the place in the middle of the view hold", () => {
  const { extent } = sheet(12), opening = sheetOpening(extent, size);
  assert.deepEqual(keyed("q"), { kind: "spin", by: -1 });
  assert.deepEqual(keyed("E"), { kind: "spin", by: 1 });
  for (const tilt of [SHEET_TILT, 1.2, 2, UNDERNEATH]) for (const heading of headings) {
    const under = seesUnderside(tilt), before = eye(opening, extent, tilt, heading), held = sheetCentre(opening.turn);
    for (const by of [-1, 1] as const) {
      const next = sheetSpin(heading, by * Math.PI / 2, under);
      assert.ok(Math.abs(Math.abs(next - heading) - Math.PI / 2) < 1e-12, "exactly a quarter turn");
      const after = eye(opening, extent, tilt, next);
      assert.equal(after.zoom, before.zoom, "the zoom holds");
      assert.ok(Math.abs(after.facing(held) - tilt) < 1e-6, "the tilt holds");
      const middle = before.screen(held), still = after.screen(held);
      assert.ok(Math.hypot(still.x - middle.x, still.y - middle.y) < 1e-3, "it pivots on the middle of the view");
      // A road running east from the middle turns a quarter of the way round on the window, clockwise for E from above or below.
      const east = (face: ReturnType<typeof eye>) => { const a = face.screen(held), b = face.screen({ x: held.x + 50, y: held.y }); return Math.atan2(b.y - a.y, b.x - a.x); };
      const turned = Math.atan2(Math.sin(east(after) - east(before)), Math.cos(east(after) - east(before)));
      // Clockwise on the window is a growing angle with y down; the tilt squashes the quarter turn, so read its sense, not its size.
      assert.ok(Math.sign(turned) === by && Math.abs(turned) > 0.3, `${by > 0 ? "E" : "Q"} at ${heading.toFixed(2)}, tilted ${tilt.toFixed(2)}, turns it ${(turned * 180 / Math.PI).toFixed(0)}° on the window`);
    }
  }
});

test("3.59 a plain drag pans the glass sheet; a right-drag or a Ctrl+drag spins it smoothly about its upright axis with its sideways part and tilts it with its up-and-down part, and so do two fingers, twisting and sliding", () => {
  assert.equal(sheetDrag({ button: 0, ctrlKey: false, isPrimary: true }), "pan", "a plain drag pans");
  assert.equal(sheetDrag({ button: 2, ctrlKey: false, isPrimary: true }), "spin", "a right-drag spins and tilts");
  assert.equal(sheetDrag({ button: 0, ctrlKey: true, isPrimary: true }), "spin", "a Ctrl+drag spins and tilts");
  assert.equal(sheetDrag({ button: 1, ctrlKey: false, isPrimary: true }), undefined, "the middle button does nothing");
  const { extent } = sheet(12), opening = sheetOpening(extent, size), held = sheetCentre(opening.turn);
  for (const start of [SHEET_TILT, UNDERNEATH]) {
    let heading = 0.3, tilt = start;
    for (const step of [{ x: 12, y: 0 }, { x: 40, y: -9 }, { x: -7, y: 14 }, { x: 95, y: 3 }]) {
      const next = sheetSpinTilt(heading, tilt, step);
      assert.ok(Math.abs(Math.abs(next.heading - heading) - Math.abs(step.x) * Math.PI / 600) < 1e-12, "a small drag across, a small spin");
      assert.ok(Math.abs(Math.abs(next.tilt - tilt) - Math.abs(step.y) * Math.PI / 600) < 1e-12, "a small drag up or down, a small tilt");
      assert.ok(Math.abs(eye(opening, extent, next.tilt, next.heading).facing(held) - next.tilt) < 1e-6, "and the sheet is drawn at that tilt");
      ({ heading, tilt } = next);
    }
  }
  // Two fingers turned a tenth of a turn clockwise on the window spin it a tenth of a turn that way.
  const twist = sheetTwist([{ x: 100, y: 100 }, { x: 300, y: 100 }], [{ x: 100, y: 100 }, { x: 100 + 200 * Math.cos(Math.PI / 5), y: 100 + 200 * Math.sin(Math.PI / 5) }]);
  assert.ok(Math.abs(twist - Math.PI / 5) < 1e-12, `clockwise on the window (${twist.toFixed(3)})`);
  assert.ok(Math.abs(sheetTwist([{ x: 0, y: 0 }, { x: -1, y: 0.01 }], [{ x: 0, y: 0 }, { x: -1, y: -0.01 }]) - 0.02) < 1e-3, "and across the half-turn without a jump");
});

test("3.60 the compass points to the glass sheet's starting north on the window, and a click on it or the Home key spins it back, tilts it to the top resting view and returns to the opening view", () => {
  const { extent } = sheet(12), opening = sheetOpening(extent, size), held = sheetCentre(opening.turn);
  assert.deepEqual(keyed("Home"), { kind: "home" });
  for (const tilt of [SHEET_TILT, 1.2, 2, UNDERNEATH]) for (const heading of headings) {
    const face = eye(opening, extent, tilt, heading);
    const a = face.screen(held), b = face.screen({ x: held.x, y: held.y + 1 });
    const drawn = Math.atan2(-(b.y - a.y), b.x - a.x), north = compassNorth(heading, seesUnderside(tilt));
    // The tilt squashes the window's up and down, so the drawn north is the compass's needle squashed the same way.
    const squashed = Math.atan2(Math.sin(north) * Math.abs(Math.cos(tilt)), Math.cos(north));
    assert.ok(Math.abs(Math.atan2(Math.sin(drawn - squashed), Math.cos(drawn - squashed))) < 0.02, `the needle at ${heading.toFixed(2)}, tilted ${tilt.toFixed(2)}, points north`);
  }
  assert.ok(Math.abs(compassNorth(0, false) - Math.PI / 2) < 1e-12, "facing its starting heading, north is up");
  // Spun three and a half turns, tilted under, panned and zoomed: Home brings it back by the short way round, to the opening view.
  let pose: GlobePose = opening;
  const guide = createGlobeGuide({ world: () => new Group(), camera: () => new OrthographicCamera(), size: () => size, read: () => pose, write: next => { pose = next; }, invalidate() {} });
  pose = { ...pose, turn: sheetPan(pose.turn, { x: -600, y: 90 }, 1, extent), framing: pose.framing / 2 };
  const spun = 7 * Math.PI + 0.4, home = sheetHome(spun);
  assert.ok(Math.abs(home.heading - 8 * Math.PI) < 1e-12 && home.heading === headingHome(spun), "the nearest starting heading, not seven half-turns back");
  assert.equal(home.tilt, SHEET_TILT, "and the top resting tilt");
  assert.equal(guide.home(sheetOpening(extent, size), 600), true);
  guide.frame(300);
  guide.frame(300);
  const opened = eye(opening, extent), back = eye(pose, extent, home.tilt, home.heading);
  for (const p of [held, { x: held.x + 200, y: held.y - 60 }]) {
    const was = opened.screen(p), is = back.screen(p);
    assert.ok(Math.hypot(was.x - is.x, was.y - is.y) < 1e-3, "back to the opening view");
  }
});

test("3.61 the sheet's keys are WASD, the arrows, Q, E, R, F and Home, no key swings it between Stories and Library, and none of them acts while you type in a text field or hold Ctrl, Alt or the command key", () => {
  for (const key of ["t", "x"]) assert.deepEqual(keyed(key), undefined, `${key} does nothing`);
  for (const key of ["w", "ArrowUp", "q", "E", "r", "F", "Home"]) {
    for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) assert.equal(keyed(key, target), undefined, `${key} in a ${target.tagName}`);
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) assert.equal(keyed(key, { tagName: "BODY" }, extra), undefined, `${key} with ${Object.keys(extra)[0]}`);
    assert.notEqual(keyed(key, { tagName: "BODY" }), undefined, `${key} on the page`);
  }
  assert.equal(sheetKey({ type: "keyup", key: "w" }), undefined, "only a press");
});

test("3.63 an island-less sheet, the user's factory, opens on the Library look at the view from above, over a sea floor wide enough to spread its notes", () => {
  const empty = sheetLayout(forestScene({ arcs: [], stories: [] }, [], workStates([])), new Map());
  assert.ok(empty.under.floor.width >= 120 && empty.under.floor.height >= 120, `floor ${empty.under.floor.width} by ${empty.under.floor.height}`);
  assert.ok(empty.extent.width >= empty.under.floor.width && empty.extent.height >= empty.under.floor.height, "the glass runs over the whole floor");
  assert.equal(opensBare("library"), true);
  assert.equal(opensBare("forest"), false);
  // At the opening view from above, through the Library's clear glass, a note on its floor is on show, so its
  // first-encounter card anchors at its dot.
  const opened = eye(sheetOpening(empty.extent, size), empty.extent), world = new Group(), glass = new Group(), dot = new Mesh();
  opened.globe.name = "globe";
  glass.name = "sheet:under";
  dot.name = "knowledge-point:agent_builder";
  const { floor } = empty.under, at = empty.under.place({ x: floor.x + floor.width / 2, y: floor.y + floor.height / 2, z: -20 });
  dot.position.set(at.x, at.y, at.z);
  world.add(opened.globe.add(glass.add(dot)));
  let pose = sheetOpening(empty.extent, size);
  const guide = createGlobeGuide({ world: () => world, camera: () => opened.camera, size: () => size, read: () => pose, write: next => { pose = next; }, invalidate() {} });
  assert.equal(guide.position({ kind: "note", note: "agent_builder" })?.visible, true);
});
