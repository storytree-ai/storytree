/** The page's planet joins: permanent places, mesh picking, and failure markers after orbiting. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, DoubleSide, Euler, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Quaternion, Raycaster, SphereGeometry, Vector2, Vector3 } from "three";
import { smokeProblems } from "@storytree/app";
import { workStates } from "@storytree/arc-surface";
import { forestDrawn, forestScene, openingTurn, storyNodes, type FacingIsland } from "@storytree/forest";
import type { AnnotatedTree, Change } from "@storytree/library";
import { focusRotation, globeFraming, hiddenMarkers, pickGlobe, pickIsland, planetLayout, pointedFile } from "./planet-navigation.js";
import { codePathKey } from "@storytree/knowledge-core";
import { circleStops, fileCircleMarks, lightFileCircles } from "./file-circles.js";
import { lightTerritories, territoryLand } from "./territory-land.js";
import { coastTintMarks } from "./session-tints.js";

test("the globe opens every story with its grove at its place in the rows, readable by the smoke check", () => {
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
  assert.equal(layout.spots.get("new")!.y, layout.spots.get("kept")!.y, "neither depends on anything: one row");
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

test("3.11 a hidden failure has a marker in the camera's frame, and its click turns it to the eye after orbiting", () => {
  const islands: FacingIsland[] = [
    { story: "first", spot: { x: 0, y: 0, z: 1 }, trees: [{ status: "unhealthy" }] },
    { story: "behind", spot: { x: 3, y: 4, z: -12 }, trees: [{ status: "unhealthy" }] },
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

test("3.11 the rim marker reads storytree's verified word, never the agent's report alone", () => {
  const health = (reported: "passing" | "failing" | "not-checked", verified: "passing" | "failing" | "not-checked") => ({ reported: { state: reported }, verified: { state: verified } });
  const capability = (id: string, status: "healthy" | "unhealthy" | "untested", reported: "passing" | "failing" | "not-checked") =>
    ({ id, title: id, dependsOn: [], proposed: false, status, contracts: [], health: health(reported, status === "unhealthy" ? "failing" : "not-checked") });
  const tree: AnnotatedTree = { arcs: [], stories: [
    { id: "verified", title: "Verified failing", health: health("not-checked", "failing"), capabilities: [capability("cap-v", "unhealthy", "not-checked")] },
    { id: "reported", title: "Reported failing", health: health("failing", "not-checked"), capabilities: [capability("cap-r", "untested", "failing")] },
  ] };
  const scene = forestScene(tree, [], workStates([]));
  const layout = planetLayout(scene, new Map([["verified", 1], ["reported", 2]]));
  const behind = layout.islands.map(island => ({ ...island, spot: { x: island.spot.x, y: island.spot.y, z: -Math.abs(island.spot.z) - 1 } }));
  assert.deepEqual(hiddenMarkers(behind, new Quaternion(), new Quaternion()).map(m => m.story), ["verified"]);
});

test("3.11 Forest never hides a failing island; only an explicit Library choice suppresses its marker", () => {
  const islands: FacingIsland[] = [
    { story: "failure", spot: { x: 0, y: 0, z: -1 }, trees: [{ status: "unhealthy" }] },
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

test("the globe's opening zoom: the whole planet fills 85% of the short side by default, as today; close up fills more, room around less (ADR-0750)", () => {
  const fills = (choice: Parameters<typeof globeFraming>[0]) => 1 / globeFraming(choice);
  assert.equal(globeFraming("whole-planet"), 1.18, "today's framing: half the short side is 1.18 radii");
  assert.ok(fills("close") > 1, "close up: the planet runs past the short side");
  assert.ok(fills("far") < 0.7, "room around: the planet stands well inside the window");
});

test("3.15 a click on a capability's territory picks its story with that capability; Unclaimed land picks the story alone", () => {
  const land = {
    radius: 2,
    territories: [{ capability: "cap-a" }, {}],
    cells: [
      { polygon: [{ x: -2, z: -2 }, { x: 0, z: -2 }, { x: 0, z: 2 }, { x: -2, z: 2 }], territory: 0 },
      { polygon: [{ x: 0, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: 0, z: 2 }], territory: 1 },
    ],
    borders: [{ from: { x: 0, z: -2 }, to: { x: 0, z: 2 } }],
  };
  const world = new Group();
  const plate = new Group();
  plate.name = "planet:story";
  plate.rotation.x = Math.PI / 2;
  plate.add(territoryLand(land, (p) => new Vector3(p.x, 0, p.z)));
  world.add(plate);
  world.updateMatrixWorld(true);
  const camera = new OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
  camera.position.z = 40;
  camera.updateMatrixWorld();
  const box = { left: 0, top: 0, width: 800, height: 800 };
  assert.deepEqual(pickGlobe(world, camera, box, { x: 300, y: 400 }, "forest"), { kind: "story", id: "story", capability: "cap-a" });
  assert.deepEqual(pickGlobe(world, camera, box, { x: 500, y: 400 }, "forest"), { kind: "story", id: "story" });
  assert.equal(world.getObjectByName("territory-borders")?.userData.borders, 1);
});

test("3.14 a territory's land and borders stop at its island's coast", () => {
  const land = {
    radius: 2,
    territories: [{ capability: "cap-a" }, {}],
    cells: [
      { polygon: [{ x: -2, z: -2 }, { x: 0, z: -2 }, { x: 0, z: 2 }, { x: -2, z: 2 }], territory: 0 },
      { polygon: [{ x: 0, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: 0, z: 2 }], territory: 1 },
    ],
    borders: [{ from: { x: 0, z: -2 }, to: { x: 0, z: 2 } }],
  };
  // A diamond coast inside the square cells, reaching 1 from the middle.
  const coast = [[{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }]];
  const drawn = territoryLand(land, (p) => new Vector3(p.x, 0, p.z), coast);
  const onLand = (x: number, z: number) => Math.abs(x) + Math.abs(z) <= 1 + 1e-6;
  drawn.traverse((object) => {
    const position = (object as Mesh).geometry?.getAttribute("position");
    for (let at = 0; position !== undefined && at < position.count; at++) assert.ok(onLand(position.getX(at), position.getZ(at)), `${object.name} stays on the land`);
  });
  const area = (mesh: Mesh) => { const p = mesh.geometry.getAttribute("position"); let sum = 0; for (let at = 0; at < p.count; at += 3) sum += Math.abs((p.getX(at + 1) - p.getX(at)) * (p.getZ(at + 2) - p.getZ(at)) - (p.getX(at + 2) - p.getX(at)) * (p.getZ(at + 1) - p.getZ(at))) / 2; return sum; };
  assert.ok(Math.abs(area(drawn.getObjectByName("territory:cap-a") as Mesh) - 1) < 1e-6, "the half of the diamond west of the border");
  // A bay cut into the land: a concave coast is followed too.
  const bay = [[{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }, { x: -2, z: 1 }, { x: 1, z: 1 }, { x: 1, z: -1 }, { x: -2, z: -1 }]];
  const inBay = (x: number, z: number) => x < 1 - 1e-6 && z > -1 + 1e-6 && z < 1 - 1e-6;
  const cut = territoryLand(land, (p) => new Vector3(p.x, 0, p.z), bay);
  const west = cut.getObjectByName("territory:cap-a") as Mesh;
  const p = west.geometry.getAttribute("position");
  for (let at = 0; at < p.count; at += 3) {
    const [x, z] = [(p.getX(at) + p.getX(at + 1) + p.getX(at + 2)) / 3, (p.getZ(at) + p.getZ(at + 1) + p.getZ(at + 2)) / 3];
    assert.ok(!inBay(x, z), "no land is drawn in the bay");
  }
  assert.ok(Math.abs(area(west) - 4) < 1e-6, "the western half less the bay's western part");
});

test("3.16, 3.17 a file circle lies flat on the island's surface; pointing at it names the file, its lines and its capability", () => {
  const onSurface = (p: { x: number; z: number }) => new Vector3(p.x, -(p.x * p.x + p.z * p.z) / 40, p.z);
  const normalAt = (p: { x: number; z: number }) => new Vector3(p.x / 20, 1, p.z / 20).normalize();
  const circles = fileCircleMarks([{ path: "src/a/one.ts", lines: 120, capability: "cap-a", x: 3, z: -2, radius: 0.5 }], onSurface, normalAt);
  const mark = circles.getObjectByName("file:src/a/one.ts")!;
  assert.deepEqual(mark.userData, { file: "src/a/one.ts", lines: 120, capability: "cap-a" });
  const up = new Vector3(0, 0, 1).applyQuaternion(mark.quaternion);
  assert.ok(up.angleTo(normalAt({ x: 3, z: -2 })) < 1e-6, "the circle's face turns to the surface's normal");
  assert.ok(mark.position.distanceTo(onSurface({ x: 3, z: -2 })) <= 0.2, "the circle rests just on the surface");

  const world = new Group();
  const plate = new Group();
  plate.name = "planet:story";
  plate.add(fileCircleMarks([{ path: "src/a/one.ts", lines: 120, capability: "cap-a", x: 0, z: 0, radius: 1 }], (p) => new Vector3(p.x, 0, p.z), () => new Vector3(0, 1, 0)));
  world.add(plate);
  world.updateMatrixWorld(true);
  const camera = new OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
  camera.position.y = 40;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  assert.deepEqual(pointedFile(world, camera, { left: 0, top: 0, width: 800, height: 800 }, { x: 400, y: 400 }), { file: "src/a/one.ts", lines: 120, capability: "cap-a" });
  assert.equal(pointedFile(world, camera, { left: 0, top: 0, width: 800, height: 800 }, { x: 700, y: 700 }), undefined);
});

const flat = { onSurface: (p: { x: number; z: number }) => new Vector3(p.x, 0, p.z), normalAt: () => new Vector3(0, 1, 0) };
const circlesOf = () => fileCircleMarks([
  { path: "src/a.ts", lines: 40, capability: "cap-a", x: -3, z: 0, radius: 1 },
  { path: "src/b.ts", lines: 90, capability: "cap-a", x: 3, z: 0, radius: 1.5 },
], flat.onSurface, flat.normalAt);
const mark = (group: Group, path: string) => group.getObjectByName(`file:${path}`) as Mesh;
const colourOf = (object: Mesh) => (object.material as MeshBasicMaterial).color.getHexString();

test("3.18 the forest hands the core each circle's place on the globe: where it lies once its island is set on the sphere, keyed by its package and path", () => {
  const circles = circlesOf();
  const plate = new Group();
  plate.position.set(4, -7, 9);
  plate.quaternion.setFromEuler(new Euler(0.4, -1.1, 0.7));
  plate.add(circles);
  plate.updateMatrixWorld(true);
  const stops = circleStops(circles, "agent-link", { position: plate.position, quaternion: plate.quaternion });
  assert.deepEqual([...stops.keys()], [codePathKey("agent-link", "src/a.ts"), codePathKey("agent-link", "src/b.ts")]);
  assert.equal(codePathKey("agent-link", "src/a.ts"), "packages/agent-link/src/a.ts");
  for (const path of ["src/a.ts", "src/b.ts"]) {
    const world = mark(circles, path).getWorldPosition(new Vector3());
    assert.ok(new Vector3().copy(stops.get(codePathKey("agent-link", path))!).distanceTo(world) < 1e-9, path);
  }
});

test("3.18 a file circle the selected session opened is lit in its colour with the in-view ring, a compacted one lighter with none, and letting go restores it", () => {
  const circles = circlesOf();
  const [a, b] = [mark(circles, "src/a.ts"), mark(circles, "src/b.ts")];
  const resting = [a.material, b.material];
  lightFileCircles(circles, new Map([[codePathKey("story", "src/a.ts"), "in-window" as const], [codePathKey("story", "src/b.ts"), "faded" as const]]), "#e69f00", "story");
  const [litA, litB] = [a.getObjectByName("file-lit:src/a.ts") as Mesh, b.getObjectByName("file-lit:src/b.ts") as Mesh];
  assert.equal(colourOf(litA), "e69f00");
  assert.ok(new Color(`#${colourOf(litB)}`).getHSL({ h: 0, s: 0, l: 0 }).l > new Color("#e69f00").getHSL({ h: 0, s: 0, l: 0 }).l, "lighter, as a compacted note is");
  assert.ok((litB.material as MeshBasicMaterial).opacity < (litA.material as MeshBasicMaterial).opacity);
  assert.equal(a.userData.window, "in-window");
  assert.equal(b.userData.window, "faded");
  assert.ok(a.getObjectByName("file-ring:src/a.ts"), "the in-view ring");
  assert.equal(b.getObjectByName("file-ring:src/b.ts"), undefined, "a compacted read has no ring");
  assert.deepEqual([a.material, b.material], resting, "the circles themselves are not swapped for anything, so nothing that dims or restores them can undo the lighting");
  assert.equal(litA.userData.traversal, true, "and the lighting is marked, for the session emphasis to leave alone");
  assert.deepEqual({ file: a.userData.file, lines: a.userData.lines }, { file: "src/a.ts", lines: 40 }, "pointing still names it");
  lightFileCircles(circles, new Map(), "#e69f00", "story");
  assert.equal(a.userData.window, undefined);
  assert.deepEqual([a.getObjectByName("file-lit:src/a.ts"), a.getObjectByName("file-ring:src/a.ts"), b.getObjectByName("file-lit:src/b.ts")], [undefined, undefined, undefined]);
});

test("3.18 a capability the selected session opened fills its territory in the session's colour, faintly lighter when compacted, and letting go restores its tint", () => {
  const land = {
    radius: 2,
    territories: [{ capability: "cap-a" }, { capability: "cap-b" }],
    cells: [
      { polygon: [{ x: -2, z: -2 }, { x: 0, z: -2 }, { x: 0, z: 2 }, { x: -2, z: 2 }], territory: 0 },
      { polygon: [{ x: 0, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: 0, z: 2 }], territory: 1 },
    ],
    borders: [],
  };
  const drawn = territoryLand(land, (p) => new Vector3(p.x, 0, p.z));
  const [a, b] = ["cap-a", "cap-b"].map((id) => drawn.getObjectByName(`territory:${id}`) as Mesh);
  const resting = [colourOf(a!), (a!.material as MeshBasicMaterial).opacity];
  lightTerritories(drawn, new Map([["cap-a", "in-window" as const], ["cap-b", "faded" as const]]), "#e69f00");
  const [litA, litB] = [a!.getObjectByName("territory-lit:cap-a") as Mesh, b!.getObjectByName("territory-lit:cap-b") as Mesh];
  assert.equal(colourOf(litA), "e69f00");
  assert.ok((litB.material as MeshBasicMaterial).opacity < (litA.material as MeshBasicMaterial).opacity, "a compacted read is fainter");
  assert.ok(new Color(`#${colourOf(litB)}`).getHSL({ h: 0, s: 0, l: 0 }).l > new Color("#e69f00").getHSL({ h: 0, s: 0, l: 0 }).l, "and lighter");
  assert.equal(a!.userData.window, "in-window");
  assert.equal(b!.userData.window, "faded");
  assert.equal(litA.userData.traversal, true);
  assert.equal(a!.userData.capability, "cap-a", "picking still names it");
  assert.deepEqual([colourOf(a!), (a!.material as MeshBasicMaterial).opacity], resting, "the tint itself is untouched");
  lightTerritories(drawn, new Map(), "#e69f00");
  assert.deepEqual([a!.getObjectByName("territory-lit:cap-a"), b!.getObjectByName("territory-lit:cap-b"), a!.userData.window], [undefined, undefined, undefined]);
});

test("3.20 each territory is filled by its capability's word, green, red or yellow, never grey, and a claim leaves the fill alone", () => {
  const words = ["healthy", "unhealthy", "proposed", "untested"] as const;
  const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
  const tree: AnnotatedTree = { arcs: [], stories: [{ id: "story", title: "The shop", health, capabilities: words.map((status, at) =>
    ({ id: `cap-${status}`, title: `${at + 1} · ${status}`, dependsOn: [], proposed: status === "proposed", status, contracts: [], health })) }] };
  const survey = { story: { files: [...words.map((status) => ({ path: `src/${status}.ts`, lines: 10, capability: `cap-${status}` })), { path: "src/loose.ts", lines: 10 }], imports: [] } };
  const land = forestScene(tree, [], workStates([]), survey).islands[0]!.land!;
  assert.deepEqual(land.territories.map(({ status }) => status), [...words, undefined], "the scene carries each capability's word to its territory");

  const cells = land.territories.map((_, territory) => ({ polygon: [{ x: 2 * territory, z: 0 }, { x: 2 * territory + 2, z: 0 }, { x: 2 * territory + 2, z: 2 }, { x: 2 * territory, z: 2 }], territory }));
  const flat = (p: { x: number; z: number }) => new Vector3(p.x, 0, p.z);
  const fill = (group: Group, name: string) => (group.getObjectByName(name) as Mesh).material as MeshBasicMaterial;
  const drawn = territoryLand({ territories: land.territories, cells, borders: [] }, flat);
  const expected = { healthy: "#97c459", unhealthy: "#e24b4a", proposed: "#f2d16b", untested: "#f2d16b" };
  for (const word of words) {
    assert.equal(`#${fill(drawn, `territory:cap-${word}`).color.getHexString()}`, expected[word], `${word} fills its territory`);
    assert.equal(drawn.getObjectByName(`territory:cap-${word}`)!.userData.word, word);
  }
  drawn.traverse((object) => {
    const material = (object as Mesh).material as MeshBasicMaterial | undefined;
    if (!(object instanceof Mesh) || material === undefined || object.name === "territory:unclaimed") return;
    const hsl = material.color.getHSL({ h: 0, s: 0, l: 0 });
    assert.ok(hsl.s > 0.3, `${object.name} is drawn in a colour, not grey`);
  });
  // Unclaimed code is uncharted land: a night-dark fill that hides the grey ground, hatched, never a hue (no-data convention).
  const uncharted = fill(drawn, "territory:unclaimed");
  const unchartedHsl = uncharted.color.getHSL({ h: 0, s: 0, l: 0 });
  assert.ok(uncharted.opacity > 0.5, "Unclaimed code's land is drawn, so the island's grey ground does not show through");
  assert.ok(!(unchartedHsl.s < 0.1 && unchartedHsl.l > 0.3 && unchartedHsl.l < 0.75), "and its fill is not a mid grey, which is kept for mapped");
  for (const word of words) assert.ok(!uncharted.color.equals(fill(drawn, `territory:cap-${word}`).color), `nor ${word}'s colour`);
  assert.deepEqual(drawn.getObjectByName("territory:unclaimed")!.userData, { territory: true }, "it stays pickable as land");
  const hatch = drawn.getObjectByName("territory-hatch:unclaimed") as LineSegments;
  const at = hatch.geometry.attributes.position!;
  const ends = Array.from({ length: at.count }, (_, i) => ({ x: at.getX(i), z: at.getZ(i) }));
  assert.ok(ends.length >= 4, "a hatch lies across Unclaimed code's land");
  assert.ok(ends.every(({ x, z }) => x >= 8 - 1e-6 && x <= 10 + 1e-6 && z >= -1e-6 && z <= 2 + 1e-6), "every hatch line stays inside that territory's cell");
  assert.ok(ends.some((p, i) => i % 2 === 0 && Math.abs((ends[i + 1]!.x - p.x) * (ends[i + 1]!.z - p.z)) > 1e-6), "the hatch runs diagonally");
  assert.equal((hatch.material as LineBasicMaterial).opacity < 0.85 && hatch.renderOrder > 1 && hatch.renderOrder < 2, true, "fainter than the white borders, between fill and borders");
  assert.equal(drawn.getObjectByName("territory-hatch:cap-healthy"), undefined, "only land no contract has surveyed is hatched");

  const claimed = territoryLand({ territories: land.territories, cells, borders: [] }, flat, undefined, new Map([["cap-healthy", { colour: "hsl(200, 80%, 68%)", faded: false }]]));
  assert.ok(fill(claimed, "territory:cap-healthy").color.equals(fill(drawn, "territory:cap-healthy").color), "a claim never changes the fill");
  assert.equal(fill(claimed, "territory:cap-healthy").opacity, fill(drawn, "territory:cap-healthy").opacity);
});

/**
 * Three draws a see-through, double-sided material in two passes, back faces then front, re-versioning it
 * before each (WebGLRenderer's renderObject), so every frame re-derives its shader program twice (ADR-0836 D1).
 */
const programsEveryFrame = (root: Group): string[] => {
  const found: string[] = [];
  root.traverse(object => {
    for (const material of [(object as Mesh).material ?? []].flat()) if (material.transparent && material.side === DoubleSide && !material.forceSinglePass) found.push(object.name);
  });
  return found;
};

test("5.4 an animating globe redraws a session-lit island's land, circles and tints without re-deriving a shader program", () => {
  const land = {
    radius: 2,
    territories: [{ capability: "cap-a", status: "healthy" as const }, { capability: "cap-b" }],
    cells: [
      { polygon: [{ x: -2, z: -2 }, { x: 0, z: -2 }, { x: 0, z: 2 }, { x: -2, z: 2 }], territory: 0 },
      { polygon: [{ x: 0, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: 0, z: 2 }], territory: 1 },
    ],
    borders: [],
  };
  const plate = new Group();
  const drawn = territoryLand(land, flat.onSurface, undefined, new Map([["cap-a", { colour: "#e69f00", faded: false }]]));
  lightTerritories(drawn, new Map([["cap-a", "in-window" as const], ["cap-b", "faded" as const]]), "#e69f00");
  const circles = circlesOf();
  lightFileCircles(circles, new Map([[codePathKey("story", "src/a.ts"), "in-window" as const], [codePathKey("story", "src/b.ts"), "faded" as const]]), "#e69f00", "story");
  const coast = [[{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }]];
  plate.add(drawn, circles, coastTintMarks(coast, [{ session: "A", colour: "#e69f00", faded: false, from: 0, to: 1 }], flat.onSurface));
  assert.ok(plate.getObjectByName("territory-claim:cap-a") && plate.getObjectByName("file-ring:src/a.ts") && plate.getObjectByName("coast-tint:A"), "the fixture draws every kind of mark");
  assert.deepEqual(programsEveryFrame(plate), []);
});
