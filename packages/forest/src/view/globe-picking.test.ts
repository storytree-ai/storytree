/** Forest capability 3: a small library dot is picked in screen space (ADR-0661 D1). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickProjectedNote, type ProjectedNote } from "./globe-picking.js";
import { Group, Mesh, MeshBasicMaterial, Object3D, OrthographicCamera, PlaneGeometry, SphereGeometry } from "three";
import { pickGlobe } from "./planet-navigation.js";

const dot = (id: string, x: number, distance = 20, z = 0): ProjectedNote => ({ id, x, y: 50, z, distance, visible: true });

test("the closest dot within an eight-pixel screen radius wins; depth breaks equal screen distances", () => {
  assert.equal(pickProjectedNote([dot("far", 56), dot("near", 52)], { x: 50, y: 50 }), "near");
  assert.equal(pickProjectedNote([dot("back", 50, 30), dot("front", 50, 20)], { x: 50, y: 50 }), "front");
  assert.equal(pickProjectedNote([dot("small", 57.9)], { x: 50, y: 50 }), "small");
  assert.equal(pickProjectedNote([dot("miss", 59)], { x: 50, y: 50 }), undefined);
});

test("land in front wins in Forest; without land in Library every visible dot can be picked", () => {
  const notes = [dot("behind land", 50, 30)];
  assert.equal(pickProjectedNote(notes, { x: 50, y: 50 }, 15), undefined);
  assert.equal(pickProjectedNote(notes, { x: 50, y: 50 }), "behind land");
  assert.equal(pickProjectedNote([dot("before land", 50, 10)], { x: 50, y: 50 }, 15), "before land");
});

test("a far-side masked dot, a dot outside the viewport, and a clipped dot cannot win", () => {
  assert.equal(pickProjectedNote([{ ...dot("far-side", 50), visible: false }], { x: 50, y: 50 }), undefined);
  assert.equal(pickProjectedNote([{ ...dot("off-screen", -1), visible: false }], { x: 0, y: 50 }), undefined);
  for (const z of [-1.01, 1.01]) assert.equal(pickProjectedNote([dot("clipped", 50, 20, z)], { x: 50, y: 50 }), undefined);
});

test("the transparent near shell permits a dot; land and the far shell retain Forest occlusion", () => {
  const world = new Group();
  const shell = new Mesh(new SphereGeometry(10), new MeshBasicMaterial());
  shell.name = "planet:shell";
  world.add(shell);
  const note = new Object3D();
  note.name = "knowledge-point:note";
  note.position.z = 5;
  world.add(note);
  const camera = new OrthographicCamera(-15, 15, 15, -15, 0.1, 100);
  camera.position.z = 40;
  camera.updateMatrixWorld();
  const box = { left: 0, top: 0, width: 300, height: 300 }, cursor = { x: 150, y: 150 };
  const pick = (mode: "forest" | "library") => pickGlobe(world, camera, box, cursor, mode);
  assert.deepEqual(pick("forest"), { kind: "note", id: "note" });
  note.position.z = -5;
  assert.equal(pick("forest"), undefined, "the back half is not selectable through the shell");
  assert.deepEqual(pick("library"), { kind: "note", id: "note" }, "Library removes the shell occlusion");
  note.position.z = 5;
  const land = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
  land.name = "planet:story";
  land.position.z = 11;
  world.add(land);
  assert.deepEqual(pick("forest"), { kind: "story", id: "story" }, "land before the note opens its story");
  assert.deepEqual(pick("library"), { kind: "note", id: "note" }, "Library never picks hidden land");
  note.position.x = 16;
  assert.equal(pickGlobe(world, camera, box, { x: 299, y: 150 }, "library"), undefined);
});
