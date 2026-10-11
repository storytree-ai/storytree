import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Quaternion, Vector3 } from "three";
import { createGlobeGuide, type GlobePose, type ScreenPosition } from "./globe-guide.js";
import { globeLocator } from "./globe-locator.js";
import { focusRotation, pickGlobe, pointedFile } from "./planet-navigation.js";

function fixture() {
  const world = new Group(), globe = new Group(), story = new Group();
  globe.name = "globe"; story.name = "planet:shop"; story.position.set(10, 0, 0);
  const cap = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()); cap.name = "territory:checkout";
  const file = new Group(); file.name = "file:src/pay.ts"; file.position.set(1, 2, 3);
  const core = new Group(); core.name = "globe-core";
  story.add(cap, file); globe.add(story, core); world.add(globe);
  const camera = new OrthographicCamera(-400, 400, 300, -300, 0.1, 1000);
  camera.position.z = 100; camera.zoom = 10; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  let size = { width: 800, height: 600 };
  let pose: GlobePose = { turn: { yaw: 0, pitch: 0 }, framing: 3, sideOffset: 0 };
  const guide = createGlobeGuide({ world: () => world, camera: () => camera, size: () => size,
    read: () => pose, write: next => { pose = next; globe.quaternion.copy(focusRotation(next.turn, camera.quaternion)); }, invalidate() {} });
  return { world, globe, story, cap, file, core, camera, guide, pose: () => pose, resize: (next: typeof size) => { size = next; } };
}

test("3.21 camera stops face the actual story, capability and file, interpolate framing and offset, and can be replaced or cancelled", () => {
  for (const target of [{ kind: "story", story: "shop" }, { kind: "capability", capability: "checkout" }, { kind: "file", story: "shop", path: "src/pay.ts" }] as const) {
    const f = fixture();
    assert.equal(f.guide.stop({ target, framing: 0.8, sideOffset: -160, duration: 1000 }), true);
    assert.equal(f.guide.frame(500), true);
    assert.equal(f.pose().framing, 1.9); assert.equal(f.pose().sideOffset, -80);
    assert.equal(f.guide.frame(500), false);
    assert.equal(f.pose().framing, 0.8); assert.equal(f.pose().sideOffset, -160);
    const point = target.kind === "file" ? f.file.getWorldPosition(new Vector3()) : f.story.getWorldPosition(new Vector3());
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
  const f = fixture(), target = { kind: "file", story: "shop", path: "src/pay.ts" } as const;
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
  f.globe.quaternion.copy(new Quaternion()); f.story.visible = false;
  assert.equal(f.guide.position(target)?.visible, false);
  f.story.visible = true; f.file.position.x = 100;
  assert.equal(f.guide.position(target)?.visible, false, "off screen");
  assert.equal(f.guide.position({ kind: "capability", capability: "missing" }), undefined);
  f.core.visible = false; assert.equal(f.guide.position({ kind: "core" })?.visible, false);
  f.core.visible = true; f.camera.clearViewOffset();
  f.resize({ width: 400, height: 300 });
  assert.deepEqual(f.guide.position({ kind: "core" }), { x: 200, y: 150, visible: true });
  // A link's pathway is its own stretch of road where roads merge, and its point is on the ribbon, the given share of the way along
  // it (its middle by default), not its bounding box's centre.
  const road = (name: string, links: string[], points: number[]) => {
    const ribbon = new BufferGeometry(); ribbon.setAttribute("position", new Float32BufferAttribute(points, 3));
    const mesh = new Mesh(ribbon, new MeshBasicMaterial()); mesh.name = name; mesh.userData.links = links; f.globe.add(mesh);
  };
  road("pathway:trunk", ["cart->shop", "orders->shop"], [-8, 0, 0, -8, 2, 0, -8, 4, 0, -8, 6, 0, -8, 8, 0, -8, 10, 0]);
  road("pathway:branch", ["cart->shop"], [0, 0, 0, 0, 2, 0, 8, 0, 0, 8, 2, 0, 8, 8, 0, 8, 10, 0]);
  at(f.guide.position({ kind: "pathway", link: "cart->shop" }), 200 + 8 * 10, 150 - 1 * 10);
  at(f.guide.position({ kind: "pathway", link: "cart->shop", along: 0 }), 200, 150 - 1 * 10);
  at(f.guide.position({ kind: "pathway", link: "orders->shop" }), 200 - 8 * 10, 150 - 5 * 10);
  assert.equal(f.guide.position({ kind: "pathway", link: "missing" }), undefined);
  for (const child of f.story.children) child.visible = false;
  assert.equal(f.guide.position({ kind: "story", story: "shop" })?.visible, false, "an island with no shown marks is hidden");
});

test("3.22 hidden land and file circles cannot be picked, including through an invisible parent", () => {
  const f = fixture();
  const file = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()); file.name = "file:src/pay.ts";
  file.position.z = 2; file.userData = { file: "src/pay.ts", lines: 20, capability: "checkout" }; f.story.add(file);
  const box = { left: 0, top: 0, width: 800, height: 600 }, cursor = { x: 500, y: 300 };
  assert.equal(pickGlobe(f.world, f.camera, box, cursor, "forest")?.id, "shop");
  assert.equal(pointedFile(f.world, f.camera, box, cursor)?.file, "src/pay.ts");
  f.story.visible = false;
  assert.equal(pickGlobe(f.world, f.camera, box, cursor, "forest"), undefined);
  assert.equal(pointedFile(f.world, f.camera, box, cursor), undefined);
});

test("3.37 home eases the globe back to the turn and zoom it opened on, the short way round", () => {
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

test("3.40 the page's locator gives each drawn island's capability count and client point, each note's point, turns to face one at once, and says when the glide is over", () => {
  const f = fixture();
  const note = new Group(); note.name = "knowledge-point:note_1"; note.position.set(0, 5, 0); f.globe.add(note);
  const island = (story: string, capabilities: (string | undefined)[]) => ({ story, title: story, x: 0, z: 0, key: story,
    trees: capabilities.map(capability => ({ capability, form: "pale" as const, contracts: 0 })) });
  const scene = { islands: [island("shop", ["checkout", "cart"]), island("gone", [undefined])] };
  let controls: typeof f.guide | undefined;
  const locator = globeLocator({ controls: () => controls, scene: () => scene, box: () => ({ left: 100, top: 50 }) });
  assert.deepEqual(locator.islands(), [], "nothing is placed before the globe hands over its controls");
  assert.equal(locator.still(), false);
  assert.equal(locator.face({ kind: "story", story: "shop" }), false);
  controls = f.guide;
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
});
