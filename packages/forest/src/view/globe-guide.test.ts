import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Quaternion, Vector3 } from "three";
import { createGlobeGuide, type GlobePose } from "./globe-guide.js";
import { focusRotation } from "./planet-navigation.js";

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
  assert.deepEqual(f.guide.position(target), { x: 510, y: 280, visible: true });
  f.camera.zoom = 20; f.camera.updateProjectionMatrix();
  assert.deepEqual(f.guide.position(target), { x: 620, y: 260, visible: true });
  f.camera.setViewOffset(800, 600, 100, 0, 800, 600);
  assert.deepEqual(f.guide.position(target), { x: 520, y: 260, visible: true });
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
});
