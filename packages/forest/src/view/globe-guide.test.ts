import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Quaternion, Vector3 } from "three";
import { createGlobeGuide, type GlobePose, type ScreenPosition } from "./globe-guide.js";
import { globeLocator } from "./globe-locator.js";
import type { DrawnName } from "./nameplates.js";
import { focusRotation, pickGlobe } from "./planet-navigation.js";

function fixture() {
  const world = new Group(), globe = new Group(), story = new Group();
  globe.name = "globe"; story.name = "planet:shop"; story.position.set(10, 0, 0);
  const cap = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()); cap.name = "territory:checkout";
  const core = new Group(); core.name = "globe-core";
  story.add(cap); globe.add(story, core); world.add(globe);
  const camera = new OrthographicCamera(-400, 400, 300, -300, 0.1, 1000);
  camera.position.z = 100; camera.zoom = 10; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  let size = { width: 800, height: 600 };
  let pose: GlobePose = { turn: { yaw: 0, pitch: 0 }, framing: 3, sideOffset: 0 };
  const guide = createGlobeGuide({ world: () => world, camera: () => camera, size: () => size,
    read: () => pose, write: next => { pose = next; globe.quaternion.copy(focusRotation(next.turn, camera.quaternion)); }, invalidate() {}, opening: () => pose });
  return { world, globe, story, cap, core, camera, guide, pose: () => pose, resize: (next: typeof size) => { size = next; } };
}

test("3.21 camera stops face the actual story and capability, interpolate framing and offset, and can be replaced or cancelled", () => {
  for (const target of [{ kind: "story", story: "shop" }, { kind: "capability", capability: "checkout" }] as const) {
    const f = fixture();
    assert.equal(f.guide.stop({ target, framing: 0.8, sideOffset: -160, duration: 1000 }), true);
    assert.equal(f.guide.frame(500), true);
    assert.equal(f.pose().framing, 1.9); assert.equal(f.pose().sideOffset, -80);
    assert.equal(f.guide.frame(500), false);
    assert.equal(f.pose().framing, 0.8); assert.equal(f.pose().sideOffset, -160);
    const point = f.story.getWorldPosition(new Vector3());
    assert.ok(point.normalize().dot(new Vector3(0, 0, 1)) > 0.99, "target faces the viewer");
    const before = f.pose();
    assert.equal(f.guide.stop({ target: { kind: "story", story: "missing" }, framing: 2 }), false);
    assert.deepEqual(f.pose(), before);
    assert.equal(f.guide.stop({ target: { kind: "core" }, framing: 2, duration: 0 }), true);
    assert.equal(f.pose().framing, 2); assert.deepEqual(f.pose().turn, before.turn, "core keeps the current turn");
    f.guide.stop({ target, framing: 4, duration: 1000 }); f.guide.frame(250);
    const interrupted = f.pose();
    f.guide.stop({ target, framing: 1, duration: 1000 });
    assert.deepEqual(f.pose(), interrupted, "replacement starts at the displayed pose");
    f.guide.frame(500); assert.equal(f.pose().framing, (interrupted.framing + 1) / 2);
    f.guide.cancel(); const cancelled = f.pose(); assert.equal(f.guide.frame(1000), false); assert.deepEqual(f.pose(), cancelled);
  }
});

test("3.23 screen positions follow actual transforms, zoom, viewport and camera offset; missing and hidden targets are honest", () => {
  const f = fixture(), target = { kind: "note", note: "pay" } as const;
  // A point standing off the island's middle, to read screen positions by.
  const point = new Group(); point.name = "knowledge-point:pay"; point.position.set(1, 2, 3); f.story.add(point);
  const at = (actual: ScreenPosition | undefined, x: number, y: number) => {
    assert.ok(actual?.visible); assert.ok(Math.abs(actual.x - x) < 1e-8); assert.ok(Math.abs(actual.y - y) < 1e-8);
  };
  at(f.guide.position(target), 510, 280);
  f.camera.zoom = 20; f.camera.updateProjectionMatrix();
  at(f.guide.position(target), 620, 260);
  f.camera.setViewOffset(800, 600, 100, 0, 800, 600);
  at(f.guide.position(target), 520, 260);
  f.globe.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  assert.equal(f.guide.position(target)?.visible, false, "far side");
  // On the glass sheet nothing is round the back: the same point, tilted past level, is on show.
  const glass = new Group(); glass.name = "sheet:glass"; f.world.add(glass);
  assert.equal(f.guide.position(target)?.visible, true, "no far side on the sheet");
  f.world.remove(glass);
  f.globe.quaternion.copy(new Quaternion()); f.story.visible = false;
  assert.equal(f.guide.position(target)?.visible, false);
  f.story.visible = true; point.position.x = 100;
  assert.equal(f.guide.position(target)?.visible, false, "off screen");
  assert.equal(f.guide.position({ kind: "capability", capability: "missing" }), undefined);
  f.core.visible = false; assert.equal(f.guide.position({ kind: "core" })?.visible, false);
  f.core.visible = true; f.camera.clearViewOffset();
  f.resize({ width: 400, height: 300 });
  assert.deepEqual(f.guide.position({ kind: "core" }), { x: 200, y: 150, visible: true });
  for (const child of f.story.children) child.visible = false;
  assert.equal(f.guide.position({ kind: "story", story: "shop" })?.visible, false, "an island with no shown marks is hidden");
});

test("3.22 hidden land cannot be picked, including through an invisible parent", () => {
  const f = fixture();
  const box = { left: 0, top: 0, width: 800, height: 600 }, cursor = { x: 500, y: 300 };
  assert.equal(pickGlobe(f.world, f.camera, box, cursor, "forest")?.id, "shop");
  f.story.visible = false;
  assert.equal(pickGlobe(f.world, f.camera, box, cursor, "forest"), undefined);
});

test("3.37 home eases the view back to the turn and zoom it opened on, the short way round", () => {
  const f = fixture();
  const home: GlobePose = { turn: { yaw: 0.4, pitch: 0 }, framing: 1.18, sideOffset: 0 };
  f.guide.stop({ target: { kind: "story", story: "shop" }, framing: 5, sideOffset: 40, duration: 0 });
  // Spun more than once round and tilted: home is the opening view, not a rewind of every turn.
  const wound = { ...f.pose(), turn: { yaw: 0.4 + 4 * Math.PI + 0.3, pitch: 0.6 } };
  Object.assign(f.pose(), wound);
  assert.equal(f.guide.home(home, 1000), true);
  assert.equal(f.guide.frame(500), true, "it eases, rather than jumping");
  const halfway = f.pose().turn.yaw;
  assert.ok(Math.abs(halfway - wound.turn.yaw) <= 0.3, "the short way round, never unwinding whole turns");
  assert.equal(f.guide.frame(500), false);
  const back = f.pose();
  assert.equal(back.framing, 1.18); assert.equal(back.sideOffset, 0); assert.equal(back.turn.pitch, 0);
  assert.ok(Math.abs(Math.sin(back.turn.yaw - 0.4)) < 1e-9 && Math.cos(back.turn.yaw - 0.4) > 0, "facing the way it opened");
});

test("3.40 a slide eases the zoom and side offset only, never the turn; a drag or wheel cutting it short still lands the offset", () => {
  const f = fixture();
  const turn = { ...f.pose().turn };
  assert.equal(f.guide.slide({ framing: 2, sideOffset: -246 }, 1000), true);
  f.guide.frame(500);
  assert.equal(f.pose().sideOffset, -123, "a glide, not a jump"); assert.equal(f.pose().framing, 2.5);
  f.guide.frame(500);
  assert.deepEqual(f.pose(), { turn, framing: 2, sideOffset: -246 });
  f.guide.slide({ framing: 3, sideOffset: 0 }, 1000);
  f.guide.frame(500);
  f.guide.cancel();
  assert.equal(f.pose().sideOffset, 0, "the globe still ends centred in the free space");
  assert.equal(f.pose().framing, 2.5, "the zoom is left to the wheel");
  assert.equal(f.guide.frame(16), false);
  f.guide.slide({ framing: 1, sideOffset: 40 }, 0);
  assert.deepEqual(f.pose(), { turn, framing: 1, sideOffset: 40 }, "reduced motion: at once");
});

test("3.41 the page's locator gives each drawn island's capability count and client point, each note's point, turns to face one at once, and says when the glide is over", () => {
  const f = fixture();
  const note = new Group(); note.name = "knowledge-point:note_1"; note.position.set(0, 5, 0); f.globe.add(note);
  const island = (story: string, capabilities: (string | undefined)[]) => ({ story, title: story, x: 0, z: 0, key: story,
    trees: capabilities.map(capability => ({ capability, form: "pale" as const, contracts: 0 })) });
  const scene = { islands: [island("shop", ["checkout", "cart"]), island("gone", [undefined])] };
  let controls: (typeof f.guide & { aside(): number }) | undefined;
  const locator = globeLocator({ controls: () => controls, scene: () => scene, box: () => ({ left: 100, top: 50 }), aside: () => 0 });
  assert.deepEqual(locator.islands(), [], "nothing is placed before the globe hands over its controls");
  assert.equal(locator.still(), false);
  assert.equal(locator.face({ kind: "story", story: "shop" }), false);
  controls = { ...f.guide, aside: () => 0 };
  const shop = f.guide.position({ kind: "story", story: "shop" })!;
  // An island the world has not drawn is left out, and a story's one seedling is no capability.
  assert.deepEqual(locator.islands(), [{ story: "shop", title: "shop", capabilities: 2, x: shop.x + 100, y: shop.y + 50, visible: shop.visible }]);
  const dot = f.guide.position({ kind: "note", note: "note_1" })!;
  assert.deepEqual(locator.notes(), [{ note: "note_1", x: dot.x + 100, y: dot.y + 50, visible: dot.visible }]);
  assert.equal(locator.still(), true);
  f.guide.stop({ target: { kind: "core" }, framing: 2, duration: 1000 });
  assert.equal(locator.still(), false, "a glide is under way");
  f.guide.frame(1000);
  assert.equal(locator.still(), true);
  f.globe.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  assert.equal(locator.face({ kind: "story", story: "shop" }), true);
  assert.equal(locator.still(), true, "facing turns at once, with no glide");
  const faced = locator.islands()[0]!;
  assert.ok(faced.visible && Math.abs(faced.x - 500) < 1e-6 && Math.abs(faced.y - 350) < 1e-6, "the island faces the viewer, mid-canvas");
  assert.equal(locator.face({ kind: "story", story: "missing" }), false);
  // A point of the scene off the faced island: facing it turns the globe so the point, not the island, is mid-canvas.
  const off = new Group(); off.position.set(8, 6, 0); f.globe.add(off); f.world.updateMatrixWorld(true);
  assert.equal(locator.face({ kind: "point", at: off.getWorldPosition(new Vector3()).toArray() }), true);
  assert.equal(locator.still(), true, "facing a point turns at once too");
  const point = f.guide.position({ kind: "point", at: off.getWorldPosition(new Vector3()).toArray() })!;
  assert.ok(point.visible && Math.abs(point.x - 400) < 1e-6 && Math.abs(point.y - 300) < 1e-6, "the point faces the viewer, mid-canvas");
  const moved = locator.islands()[0]!;
  assert.ok(Math.hypot(moved.x - 500, moved.y - 350) > 1, "the island is no longer mid-canvas");
  assert.equal(locator.face({ kind: "point", at: [Number.NaN, 0, 0] }), false, "no point to face");
});

test("3.41 the page's locator gives each drawn island's ground box in client pixels, which a teaching card keeps clear of", () => {
  const f = fixture();
  const ground = new Mesh(new BoxGeometry(4, 2, .2), new MeshBasicMaterial()); ground.name = "island-ground"; f.story.add(ground);
  const scene = { islands: [{ story: "shop", title: "shop", x: 0, z: 0, key: "shop", trees: [] }] };
  const locator = globeLocator({ controls: () => ({ ...f.guide, aside: () => 0 }), scene: () => scene, box: () => ({ left: 100, top: 50 }), aside: () => 0 });
  // The ground's canvas box (480, 290, 40 by 20, as 3.51 measures it), moved by the canvas's place on the page.
  const box = locator.islands()[0]!.box!;
  for (const [side, want] of Object.entries({ left: 580, top: 340, right: 620, bottom: 360 })) assert.ok(Math.abs(box[side as keyof typeof box] - want) < 1e-6, `${side} ${box[side as keyof typeof box]} is ${want}`);
});

test("3.49 the locator places every island in one walk of the scene, so a large map is read as cheaply each frame as a small one", () => {
  const f = fixture();
  const stories = Array.from({ length: 50 }, (_, index) => `s${index}`);
  for (const [index, story] of stories.entries()) {
    const island = new Group(); island.name = `planet:${story}`; island.position.set(index % 10, Math.floor(index / 10), 0);
    island.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())); f.globe.add(island);
  }
  const scene = { islands: stories.map(story => ({ story, title: story, x: 0, z: 0, key: story, trees: [] })) };
  const locator = globeLocator({ controls: () => ({ ...f.guide, aside: () => 0 }), scene: () => scene, box: () => ({ left: 0, top: 0 }), aside: () => 0 });
  const one = f.guide.position({ kind: "story", story: "s17" })!;
  let walks = 0;
  const update = f.world.updateMatrixWorld.bind(f.world);
  f.world.updateMatrixWorld = force => { walks++; update(force); };
  const placed = locator.islands();
  assert.equal(placed.length, 50);
  assert.deepEqual(placed.find(island => island.story === "s17"), { story: "s17", title: "s17", capabilities: 0, ...one }, "each island where the guide alone puts it");
  assert.ok(walks <= 2, `the world's matrices updated ${walks} times for 50 islands`);
});

test("3.41 the locator's point for an island is one a click there picks it by: under another story's name, its own name", () => {
  const f = fixture();
  const scene = { islands: [{ story: "shop", title: "shop", x: 0, z: 0, key: "shop", trees: [] }] };
  let names: DrawnName[] = [];
  const locator = globeLocator({ controls: () => ({ ...f.guide, aside: () => 0 }), scene: () => scene, box: () => ({ left: 100, top: 50 }), aside: () => 0,
    names: () => names });
  const middle = locator.islands()[0]!;
  const around = (x: number, y: number, half = 4) => ({ left: x - half, top: y - half, right: x + half, bottom: y + half });
  const own: DrawnName = { story: "shop", box: around(middle.x, middle.y + 30) };
  names = [own];
  assert.deepEqual([locator.islands()[0]!.x, locator.islands()[0]!.y], [middle.x, middle.y], "no other name over its middle: the middle");
  // On a crowded map a neighbour's name lies over the island's middle, and a click on a name picks that name's story (3.104).
  names = [{ story: "cart", box: around(middle.x, middle.y) }, own];
  assert.deepEqual([locator.islands()[0]!.x, locator.islands()[0]!.y], [middle.x, middle.y + 30], "its own name instead");
  names = [{ story: "shop", capability: "checkout", box: around(middle.x, middle.y) }, own];
  assert.deepEqual([locator.islands()[0]!.x, locator.islands()[0]!.y], [middle.x, middle.y + 30], "a part's name picks the part, not the story alone");
});

test("3.45 the locator reads still only once the globe has placed itself beside the panel as the page measures it now", () => {
  const f = fixture();
  let placed = 0, measured = 0;
  const controls = { ...f.guide, aside: () => placed };
  const locator = globeLocator({ controls: () => controls, scene: () => ({ islands: [] }), box: () => ({ left: 0, top: 0 }), aside: () => measured });
  assert.equal(locator.still(), true);
  // The panel closes: the page measures its new width before the globe's slide back has begun.
  measured = 0; placed = 380;
  assert.equal(locator.still(), false, "the slide has not started");
  placed = 0; f.guide.slide({ framing: 1, sideOffset: 0 }, 600);
  assert.equal(locator.still(), false, "the slide is under way");
  f.guide.frame(600);
  assert.equal(locator.still(), true);
});

test("3.44 a pose written but not yet drawn still counts: the guide reads moving until the host draws it, and a stop starts from it", () => {
  // The page draws a written pose on its next render, so the camera trails the guide's writes.
  const world = new Group(), globe = new Group(), story = new Group();
  globe.name = "globe"; story.name = "planet:shop"; story.position.set(0, 0, 10); globe.add(story); world.add(globe);
  const camera = new OrthographicCamera(-400, 400, 300, -300, 0.1, 1000);
  let drawn: GlobePose = { turn: { yaw: 0, pitch: 0 }, framing: 1, sideOffset: 0 }, queued: GlobePose | undefined;
  const guide = createGlobeGuide({ world: () => world, camera: () => camera, size: () => ({ width: 800, height: 600 }),
    read: () => ({ ...drawn }), write: next => { queued = next; }, invalidate() {}, opening: () => ({ ...drawn }) });
  const render = () => { if (queued !== undefined) drawn = queued; queued = undefined; };
  guide.slide({ framing: 1, sideOffset: -200 }, 600);
  guide.frame(600);
  assert.equal(guide.moving(), true, "the slide's last pose is not drawn yet");
  guide.stop({ target: { kind: "core" }, duration: 0 });
  render();
  assert.equal(drawn.sideOffset, -200, "the stop keeps the slide's end, not the stale drawn offset");
  assert.equal(guide.moving(), false);
});

test("3.51 each drawn island's screen box follows actual transforms and zoom; islands on the far side or hidden are left out", () => {
  const f = fixture();
  const ground = new Mesh(new BoxGeometry(4, 2, .2), new MeshBasicMaterial()); ground.name = "island-ground"; f.story.add(ground);
  const shell = new Group(); shell.name = "planet:shell"; f.globe.add(shell);
  const near = (actual: readonly { story: string; x: number; y: number; width: number; height: number }[], x: number, y: number, width: number, height: number) => {
    assert.equal(actual.length, 1); assert.equal(actual[0]!.story, "shop");
    for (const [got, want] of [[actual[0]!.x, x], [actual[0]!.y, y], [actual[0]!.width, width], [actual[0]!.height, height]]) assert.ok(Math.abs(got! - want!) < 1e-6, `${got} is ${want}`);
  };
  near(f.guide.islands(), 480, 290, 40, 20);
  f.camera.zoom = 20; f.camera.updateProjectionMatrix();
  near(f.guide.islands(), 560, 280, 80, 40);
  f.story.position.set(0, 0, 10);
  near(f.guide.islands(), 360, 280, 80, 40);
  f.globe.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  assert.deepEqual(f.guide.islands(), [], "far side");
  // On the glass sheet no island is round the back, whatever the tilt: the same turn still boxes it.
  const glass = new Group(); glass.name = "sheet:glass"; f.world.add(glass);
  assert.equal(f.guide.islands().length, 1, "no far side on the sheet");
  f.world.remove(glass);
  f.globe.quaternion.copy(new Quaternion()); f.story.visible = false;
  assert.deepEqual(f.guide.islands(), [], "hidden");
});
