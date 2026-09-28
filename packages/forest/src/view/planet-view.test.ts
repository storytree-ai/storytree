/** The page's planet joins: permanent places, mesh picking, and failure markers after orbiting. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DoubleSide, Euler, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Quaternion, Raycaster, SphereGeometry, Vector2, Vector3 } from "three";
import { smokeProblems } from "@storytree/app";
import { workStates } from "@storytree/arc-surface";
import { forestDrawn, forestScene, openingTurn, placeOnGlobe, PLANET_RADIUS, storyNodes, type FacingIsland } from "@storytree/forest";
import type { AnnotatedTree, Change } from "@storytree/library";
import { focusRotation, hiddenMarkers, pickIsland, planetLayout } from "./planet-navigation.js";

test("the globe opens every story with its grove at its permanent place, readable by the smoke check", () => {
  const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
  const tree: AnnotatedTree = { arcs: [], stories: [
    { id: "new", title: "A new story", health, capabilities: [] },
    { id: "kept", title: "An older story", health, capabilities: [
      { id: "cap", title: "Its capability", dependsOn: [], proposed: true, status: "proposed" as const, contracts: [], health },
    ] },
  ] };
  const history = ["retired", "kept", "new"].map((id, index): Change => ({
    seq: index + 1, recordId: id, type: "story", action: "created",
    record: { id, type: "story", version: 1, fields: { title: id }, createdAt: new Date(index).toISOString(), updatedAt: new Date(index).toISOString() },
  }));
  const scene = forestScene(tree, history, workStates([]));
  const places = new Map(storyNodes(tree, history).map(node => [node.id, node.place]));
  const layout = planetLayout(scene, places);
  assert.ok(layout.islands.every(i => i.spot.z > 0.75), "the page uses the packed front patch");
  assert.deepEqual([...layout.spots.keys()], ["new", "kept"]);
  for (const [id, place] of [["new", 3], ["kept", 2]] as const) {
    const position = placeOnGlobe(place);
    assert.deepEqual(layout.spots.get(id), { x: position.x / PLANET_RADIUS, y: position.y / PLANET_RADIUS, z: position.z / PLANET_RADIUS });
  }
  assert.deepEqual(layout.scene.islands.map(i => i.trees.map(t => t.capability)), [[undefined], ["cap"]]);
  assert.deepEqual(smokeProblems("ready", tree, JSON.stringify(forestDrawn(layout.scene))), []);
});

test("a click picks the rotated island mesh, while the see-through shell keeps far-side islands unselectable", () => {
  const world = new Group();
  const globe = new Group();
  globe.rotation.y = Math.PI / 2;
  world.add(globe);
  const sea = new Mesh(new SphereGeometry(10, 32, 16), new MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false }));
  sea.name = "planet:shell";
  globe.add(sea);
  const plate = new Group();
  plate.name = "planet:story";
  plate.position.x = -11;
  plate.rotation.y = -Math.PI / 2;
  plate.add(new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial({ side: DoubleSide })));
  globe.add(plate);
  const camera = new OrthographicCamera(-15, 15, 15, -15, 0.1, 100);
  camera.position.z = 40;
  camera.updateMatrixWorld();
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(0, 0), camera);
  world.updateMatrixWorld(true);
  assert.equal(pickIsland(ray, world), "story");
  globe.rotation.y = -Math.PI / 2;
  world.updateMatrixWorld(true);
  assert.equal(pickIsland(ray, world), undefined, "clicking the shell cannot pick the back plate");
  ray.setFromCamera(new Vector2(0.95, 0.95), camera);
  assert.equal(pickIsland(ray, world), undefined, "empty space clears selection too");
});

test("a hidden failure has a marker in the camera's frame, and its click turns it to the eye after orbiting", () => {
  const islands: FacingIsland[] = [
    { story: "first", spot: { x: 0, y: 0, z: 1 }, trees: [{ form: "dead" }] },
    { story: "behind", spot: { x: 3, y: 4, z: -12 }, trees: [{ form: "dead" }] },
  ];
  const eye = new Quaternion().setFromEuler(new Euler(-0.65, 0.8, 0.2));
  const rotation = focusRotation(openingTurn(islands), eye);
  const [marker] = hiddenMarkers(islands, rotation, eye);
  assert.equal(marker?.story, "behind");
  assert.ok(Math.abs(marker!.at.x - 0.6) < 1e-10);
  assert.ok(Math.abs(marker!.at.y - 0.8) < 1e-10);
  const orbitedEye = new Quaternion().setFromEuler(new Euler(0.3, -0.7, 0));
  const focused = focusRotation(marker!.turn, orbitedEye);
  const target = new Vector3(3, 4, -12).normalize().applyQuaternion(focused).applyQuaternion(orbitedEye.clone().invert());
  assert.ok(target.distanceTo(new Vector3(0, 0, 1)) < 1e-10, "the selected failure faces the actual camera");
  assert.ok(hiddenMarkers(islands, focused, orbitedEye).every(m => m.story !== "behind"));
});

test("Forest never hides a failing island; only an explicit Library choice suppresses its marker", () => {
  const islands: FacingIsland[] = [
    { story: "failure", spot: { x: 0, y: 0, z: -1 }, trees: [{ form: "dead" }] },
  ];
  const rotation = new Quaternion(), eye = new Quaternion();
  assert.deepEqual(hiddenMarkers(islands, rotation, eye).map(m => m.story), ["failure"], "Forest is the default");
  assert.deepEqual(hiddenMarkers(islands, rotation, eye, "library"), []);
  const [marker] = hiddenMarkers(islands, rotation, eye, "forest");
  assert.equal(marker?.story, "failure", "returning to Forest restores attention");
  const focused = focusRotation(marker!.turn, eye);
  const facing = new Vector3(0, 0, -1).applyQuaternion(focused);
  assert.ok(facing.z > 0.999999, "the marker still turns the failure into view");
});
