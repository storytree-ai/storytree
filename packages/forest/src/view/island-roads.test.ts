/**
 * Capability 3 · Story node render: the selected island's roads drawn sandy and faint, the borders quietened and cut
 * open at each gate, a post either side of every gate (ADR-1236 D1, rollout 2 step 3); a road takes no click, so a click on
 * it picks what lies under it (3.15), and a picked gate is ringed (3.88).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3, type Object3D } from "three";

import { islandRoads } from "../territories/island-roads.js";
import { islandRelief } from "../territories/island-relief.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import type { Coast, Point } from "../territories/territories.js";
import { capabilityPlates } from "./nameplates.js";
import { presentTerritories } from "./globe-surfaces.js";
import { gateOf, islandRoadMarks, landFill, LIT, PORTAL, ringGate, ROAD } from "./island-roads.js";
import { RING_PX, sizeOpenWork } from "./open-work.js";
import { FEEDBACK_PICK_EVENT, feedbackPick, gateAfterSelection, pickClick } from "./planet-navigation.js";
import { GLYPHS, kindOf, settlementSymbols, SYMBOL_INK } from "./settlement-symbols.js";
import { territoryLand } from "./territory-land.js";

const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 }, { capability: "d", title: "4 · Delta", lines: 300 }];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "c", to: "a" }, { from: "d", to: "c" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a", "z2->b"] }];
const map = linkLayout(shares, coast, links, docks);
const roads = islandRoads(map, links, docks, capabilityPlates(map));
// Six capabilities where b's road to e must go under a third territory (ADR-1253 D3).
const sixShares = ["a", "b", "c", "d", "e", "f"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability.toUpperCase()}`, lines: 900 - 120 * i }));
const sixLinks = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "a", to: "b" }, { from: "c", to: "a" }, { from: "b", to: "e" }, { from: "a", to: "f" },
  { from: "e", to: "c" }, { from: "b", to: "a" }, { from: "c", to: "e" }];
const sixMap = linkLayout(sixShares, coast, sixLinks, docks);
const flat = (p: Point) => new Vector3(p.x, 0, p.z);
const toSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};

test("3.77 the selected island's borders are quietened and cut open at every gate and every stretch of open road; any other island's are whole", () => {
  assert.ok(roads.gates.length > 0);
  const ground = (lines: LineSegments) => { const g = lines.userData.ground as number[]; return Array.from({ length: g.length / 4 }, (_, i) => [{ x: g[4 * i]!, z: g[4 * i + 1]! }, { x: g[4 * i + 2]!, z: g[4 * i + 3]! }] as const); };
  // The six capabilities' island has open road as well as gates.
  const sixRoads = islandRoads(sixMap, sixLinks, docks, capabilityPlates(sixMap));
  assert.ok(sixRoads.passes.length > 0, "open road to cut");
  for (const [island, routed] of [[map, roads], [sixMap, sixRoads]] as const) {
    const whole = territoryLand(island, flat, coast).getObjectByName("territory-borders") as LineSegments;
    const cut = territoryLand(island, flat, coast, new Map(), routed).getObjectByName("territory-borders") as LineSegments;
    const openings = [...routed.gates, ...routed.passes], wholeEnds = ground(whole).flat();
    for (const opening of openings) {
      assert.ok(ground(whole).some(([a, b]) => toSegment(opening.at, a, b) < 1e-6), "it stands on a border");
      for (const [a, b] of ground(cut)) assert.ok(toSegment(opening.at, a, b) > opening.opening / 2 - 1e-6, "no border line across its opening");
    }
    // A line cut short stops at an opening's edge, on the line it stands on or one meeting it at a corner, and no further back.
    for (const end of ground(cut).flat()) if (!wholeEnds.some((p) => Math.hypot(p.x - end.x, p.z - end.z) < 1e-9)) {
      assert.ok(openings.some((o) => Math.abs(Math.hypot(o.at.x - end.x, o.at.z - end.z) - o.opening / 2) < 1e-6), "a border line stops at the edge of an opening");
    }
    assert.ok((cut.material as LineBasicMaterial).opacity < (whole.material as LineBasicMaterial).opacity, "quieter under the roads");
  }
});

test("3.77 each road is a sandy ribbon as wide as the links it carries, its sand mixed into the land under it, with a post either side of every gate", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  const ribbons = marks.children.filter((o) => o.name.startsWith("road:")) as Mesh[];
  assert.equal(ribbons.length, roads.segments.length);
  ribbons.forEach((ribbon, i) => {
    const at = ribbon.geometry.getAttribute("position"), colour = ribbon.geometry.getAttribute("color");
    assert.ok(Math.abs(Math.hypot(at.getX(1) - at.getX(0), at.getZ(1) - at.getZ(0)) - roads.segments[i]!.width) < 1e-4, "its width");
    const shown = new Color(colour.getX(0), colour.getY(0), colour.getZ(0)), sand = new Color(ROAD.colour);
    assert.ok(Math.abs(shown.r - sand.r) < 0.25 && Math.abs(shown.g - sand.g) < 0.25 && !shown.equals(sand), "sand mixed into the land");
  });
  const discs = marks.children.filter((o) => o.name.startsWith("road-junction:")) as Mesh[];
  assert.ok(roads.junctions.length > 0 && discs.length === roads.junctions.length, "a disc at each junction");
  discs.forEach((disc, i) => {
    const { at, width } = roads.junctions[i]!, rim = disc.geometry.getAttribute("position");
    assert.ok(Math.abs(Math.hypot(rim.getX(1) - at.x, rim.getZ(1) - at.z) - width / 2) < 1e-4, "as wide as the widest road meeting there");
    assert.ok(roads.segments.some((s) => s.width >= width - 1e-9 && s.pts.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 1e-6)));
    const colour = (disc.material as MeshBasicMaterial).color, sand = new Color(ROAD.colour);
    assert.ok(Math.abs(colour.r - sand.r) < 0.25 && !colour.equals(sand), "the road's sand mixed into the land");
  });
  assert.equal(marks.children.filter((o) => o.name.startsWith("gate-post:")).length, roads.gates.length * 2, "a post either side of every gate");
  assert.equal(marks.children.filter((o) => o.name.startsWith("gate-face:")).length, roads.gates.length * 2, "each with its paper face");
});

test("3.77 a gate where a tunnel's road comes up into the territory it calls has no posts: the portal stands for it, and every other gate keeps its two (Mick, 2026-11-06)", () => {
  const tunnelled = islandRoads(sixMap, sixLinks, docks, capabilityPlates(sixMap)), relief = islandRelief(sixMap, tunnelled);
  const drawn = islandRoadMarks(tunnelled, flat, landFill(sixMap, territoryLand(sixMap, flat, coast, new Map(), tunnelled)), relief);
  const atMouth = (g: { at: Point }) => tunnelled.portals.some((p) => Math.hypot(p.border.x - g.at.x, p.border.z - g.at.z) < 1e-6);
  assert.ok(tunnelled.gates.some(atMouth), "b's road comes out of its tunnel by its own gate into e");
  assert.ok(tunnelled.gates.some((g) => !atMouth(g)), "and the island has gates on open land too");
  tunnelled.gates.forEach((g, i) => {
    const posts = [-1, 1].filter((sign) => drawn.getObjectByName(`gate-post:${i}:${sign}`) !== undefined).length;
    assert.equal(posts, atMouth(g) ? 0 : 2, atMouth(g) ? "no posts beside a tunnel's mouth" : "a post either side of any other gate");
  });
  tunnelled.portals.forEach((_, i) => assert.ok(drawn.getObjectByName(`tunnel-portal:${i}`), "every portal still drawn"));
});

test("3.77 the selected island's roads show and hide with its territories", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  land.add(marks);
  presentTerritories(land, false);
  assert.equal(marks.visible, false, "hidden with the territories");
  presentTerritories(land, "plain");
  assert.equal(marks.visible, true);
  presentTerritories(land, "health");
  assert.equal(marks.visible, true);
});

test("3.79 each settlement is drawn flat on the land as its kind's symbol, ink on paper over a faint casing, as large as its settlement", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  const drawn = marks.getObjectByName("settlements")!.children;
  assert.ok(roads.settlements.size > 0);
  assert.deepEqual(drawn.map((o) => o.name).sort(), [...roads.settlements.keys()].map((id) => `settlement:${id}`).sort(), "one symbol per settlement");
  for (const symbol of drawn) {
    const { at, size } = roads.settlements.get(symbol.userData.capability)!;
    assert.equal(symbol.userData.kind, "service", "a capability outside The library is a service");
    const meshes = symbol.children as Mesh[];
    const colours = meshes.map((m) => `#${(m.material as MeshBasicMaterial).color.getHexString()}`);
    assert.deepEqual([colours[0], colours[1], colours[2]], [SYMBOL_INK.casing, SYMBOL_INK.paper, SYMBOL_INK.ink], "casing, then paper, then its ink");
    assert.ok((meshes[0]!.material as MeshBasicMaterial).opacity < 1, "the casing faint");
    meshes.slice(1).forEach((m, i) => assert.ok(m.renderOrder > meshes[i]!.renderOrder, "each layer drawn over the one before"));
    let reach = 0;
    for (const m of meshes) {
      const p = m.geometry.getAttribute("position");
      for (let k = 0; k < p.count; k++) { reach = Math.max(reach, Math.abs(p.getX(k) - at.x), Math.abs(p.getZ(k) - at.z)); assert.ok(p.getY(k) > 0, "above the land"); }
    }
    assert.ok(reach > size * 0.4 && reach < size * 28 / 48, `${symbol.name} as large as its settlement, ${size} across`);
  }
});

test("3.79 The library's capabilities are drawn as their kinds, each kind its own symbol", () => {
  assert.equal(kindOf("capability_5e0362aae607"), "store", "Project libraries");
  assert.equal(kindOf("capability_a7f068502213"), "queue", "Work in flight");
  assert.equal(kindOf("capability_556e276756c9"), "index", "Ranked search");
  assert.equal(kindOf("capability_a954e1eb16f6"), "link", "Cloud connection");
  assert.equal(kindOf("capability_f27ac2abb10b"), "log", "Health record");
  assert.equal(kindOf("capability_75d059640d9d"), "service", "Library API");
  const ids = ["capability_5e0362aae607", "capability_a7f068502213", "capability_556e276756c9", "capability_a954e1eb16f6", "capability_f27ac2abb10b", "capability_75d059640d9d"];
  const one = { ...roads, settlements: new Map(ids.map((id, i) => [id, { at: { x: i * 10, z: 0 }, roads: 1, size: 3.4 }])) };
  const symbols = settlementSymbols(one, flat, 0.1).children;
  const shapes = symbols.map((s) => s.children.map((m) => `${m.name}:${(m as Mesh).geometry.getAttribute("position").count}`).join());
  assert.equal(new Set(shapes).size, ids.length, "six kinds, six different symbols");
  assert.deepEqual(symbols.map((s) => s.userData.kind), ["store", "queue", "index", "link", "log", "service"]);
});

test("3.79 each kind's symbol keeps the mock's outline in its 24-unit box", () => {
  const box = (lines: readonly (readonly (readonly [number, number])[])[]) => {
    const pts = lines.flat(), r = (v: number) => Math.round(v * 100) / 100;
    return [r(Math.min(...pts.map((p) => p[0]))), r(Math.min(...pts.map((p) => p[1]))), r(Math.max(...pts.map((p) => p[0]))), r(Math.max(...pts.map((p) => p[1])))];
  };
  // Worked from kinds.mjs's paths: the cylinder's ends bulge 3 past its sides' 6.5, and its two bands sag 3 below their ends.
  assert.deepEqual(box(GLYPHS.store.parts), [-8, -9.5, 8, 9.5], "a store's cylinder");
  assert.deepEqual(GLYPHS.store.lines.map((l) => box([l])), [[-8, -6.5, 8, -3.5], [-8, 0, 8, 3]], "its rim and its band");
  assert.deepEqual(box(GLYPHS.service.parts), [-10, -8, 9, 8], "a service's box and tabs");
  assert.deepEqual(box(GLYPHS.queue.parts), [-10.5, -5, 10.5, 5], "a queue's row");
  assert.equal(GLYPHS.queue.lines.length, 3, "of four cells");
  assert.deepEqual(box(GLYPHS.index.parts), [-8, -8, 4, 4], "an index's lens, 6 round about (-2, -2)");
  assert.deepEqual(box(GLYPHS.link.parts), [-6.5, -3, 6.5, 7.5], "a connection's plug, rounded below");
  assert.deepEqual(box(GLYPHS.log.parts), [-9, -10, 9, 10], "a record's two pages");
});

test("3.88 · a gate picks the pair of capabilities whose territories it joins, whichever way their links run", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  roads.gates.forEach((g, i) => assert.deepEqual(gateOf(marks.getObjectByName(`gate-post:${i}:1`)!), { gate: i, between: g.between }, "every gate picks itself and its two sides"));
  // Its two sides are the land either side of the border it stands on: each a capability's territory, or open land.
  const sideAt = (m: typeof map, p: Point) => { const cell = m.cells.reduce((b, c) => (Math.hypot(c.site.x - p.x, c.site.z - p.z) < Math.hypot(b.site.x - p.x, b.site.z - p.z) ? c : b)); return cell.territory < 0 ? "open" : m.territories[cell.territory]!.capability!; };
  const sides = (m: typeof map, g: (typeof roads.gates)[number]) => [-1, 1].map((k) => sideAt(m, { x: g.at.x - g.along.z * k * 0.8, z: g.at.z + g.along.x * k * 0.8 })).sort();
  roads.gates.forEach((g) => assert.deepEqual(g.between, sides(map, g), "a gate joins the two territories either side of it"));
  const into = (link: string) => roads.gates.find((g) => g.entrances.includes(link))!;
  assert.deepEqual(into("d->c").between, ["c", "d"], "d depends on c: the gate joins c and d");
  assert.deepEqual(into("c->a").between, ["a", "c"], "c depends on a: the gate joins a and c");
  // A link from d to a shares one gate into a with c's: whichever way they run, it picks the two sides it stands between.
  const through = [...links, { from: "d", to: "a" }], laid = linkLayout(shares, coast, through, docks), more = islandRoads(laid, through, docks, capabilityPlates(laid));
  const shared = more.gates.findIndex((g) => g.entrances.length > 1);
  assert.deepEqual(more.gates[shared]!.entrances, ["c->a", "d->a"], "two links' gates together shared");
  const posts = islandRoadMarks(more, flat, landFill(laid, territoryLand(laid, flat, coast, new Map(), more)), islandRelief(laid, more));
  assert.deepEqual(more.gates[shared]!.between, sides(laid, more.gates[shared]!));
  assert.deepEqual(gateOf(posts.getObjectByName(`gate-post:${shared}:-1`)!), { gate: shared, between: more.gates[shared]!.between }, "a gate two links enter by picks the pair it joins");
});

test("3.88 · a picked gate is ringed: one hollow gold ring round its posts, its line one width on screen at any zoom; none picked puts it out", () => {
  const relief = islandRelief(map, roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, territoryLand(map, flat, coast, new Map(), roads)), relief);
  const rings = () => marks.getObjectByName("gate-ring")!.children.map((o) => o.name);
  assert.deepEqual(rings(), [], "no ring until a gate is picked");
  const i = roads.gates.findIndex((g) => g.entrances.includes("d->c")), gate = roads.gates[i]!;
  ringGate(marks, roads, { gate: i, between: gate.between }, 2);
  assert.deepEqual(rings(), [`gate-ring:${i}`], "the picked gate's ring alone");
  const ring = marks.getObjectByName(`gate-ring:${i}`) as Mesh;
  assert.equal(`#${(ring.material as MeshBasicMaterial).color.getHexString()}`, LIT.gold, "in the pick's gold");
  const spread = (m: Mesh) => { const a = m.geometry.getAttribute("position"); return Array.from({ length: a.count }, (_, k) => Math.hypot(a.getX(k) - gate.at.x, a.getZ(k) - gate.at.z)); };
  const posts = [-1, 1].flatMap((sign) => spread(marks.getObjectByName(`gate-post:${i}:${sign}`) as Mesh));
  const width = (m: Mesh) => Math.max(...spread(m)) - Math.min(...spread(m));
  assert.ok(Math.min(...spread(ring)) > Math.max(...posts), "round the gate's posts, clear of them");
  assert.ok(Math.abs(width(ring) - RING_PX / 2) < 1e-3, "hollow: a line RING_PX wide on screen at zoom 2");
  assert.ok(sizeOpenWork(marks.getObjectByName("gate-ring") as Group, 8));
  assert.ok(Math.abs(width(marks.getObjectByName(`gate-ring:${i}`) as Mesh) - RING_PX / 8) < 1e-3, "and still RING_PX wide on screen at zoom 8");
  ringGate(marks, roads, { gate: i, between: gate.between });
  ringGate(marks, roads, undefined);
  assert.deepEqual(rings(), [], "nothing picked: no ring");
});

test("3.88 · a click on a gate picks the gate, and the selection that click makes keeps its ring; another selection puts it out", () => {
  const world = new Group();
  world.name = "planet:story";
  const land = territoryLand(map, flat, coast, new Map(), roads);
  world.add(land, islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads)));
  const i = roads.gates.findIndex((g) => g.entrances.includes("d->c")), gate = roads.gates[i]!;
  const post = (world.getObjectByName(`gate-post:${i}:1`) as Mesh).geometry;
  post.computeBoundingBox();
  const on = post.boundingBox!.getCenter(new Vector3()), camera = new PerspectiveCamera(30, 1, 0.1, 1000);
  camera.position.set(on.x, 300, on.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(camera.position.x, 0, camera.position.z);
  const clicked = pickClick(world, camera, { left: 0, top: 0, width: 100, height: 100 }, { x: 50, y: 50 }, "forest");
  assert.deepEqual(clicked, { gate: { story: "story", pick: { gate: i, between: ["c", "d"] } }, hit: { kind: "story", id: "story", gate: ["c", "d"] } },
    "the gate and its two sides, and its island selected with that pair");
  const picked = clicked.gate!;
  assert.equal(gateAfterSelection(picked, "story"), picked, "selecting the gate's own island keeps its ring");
  assert.equal(gateAfterSelection(picked, "other"), undefined, "selecting another puts it out");
});

/** A click straight down on `at` over `world`, as an eye far above it sees it. */
const clickAt = (world: Object3D, at: Point) => {
  const camera = new PerspectiveCamera(30, 1, 0.1, 1000);
  camera.position.set(at.x, 300, at.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(at.x, 0, at.z);
  return pickClick(world, camera, { left: 0, top: 0, width: 100, height: 100 }, { x: 50, y: 50 }, "forest");
};

test("3.15 · a road takes no click: a click on one picks the capability's territory, or the island, under it, and lights nothing", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads), marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  const world = new Group(), bare = new Group();
  world.name = bare.name = "planet:story";
  world.add(land, marks);
  bare.add(territoryLand(map, flat, coast, new Map(), roads));
  const clear = (p: Point) => roads.gates.every((g) => Math.hypot(g.at.x - p.x, g.at.z - p.z) > 4) && [...roads.settlements.values()].every((s) => Math.hypot(s.at.x - p.x, s.at.z - p.z) > s.size);
  const onRoads = roads.segments.flatMap((s) => s.pts.slice(1, -1)).filter(clear);
  assert.ok(onRoads.length > 0, "roads clear of gates and settlements to click on");
  const picked = onRoads.map((p) => clickAt(world, p));
  picked.forEach((clicked, k) => assert.deepEqual(clicked, { gate: undefined, hit: clickAt(bare, onRoads[k]!).hit }, "what the land under the road picks, as if the road were not there"));
  assert.ok(picked.some(({ hit }) => hit?.kind === "story" && hit.capability !== undefined), "a road on a capability's territory selects that capability");
  const ribbon = marks.getObjectByName("road:0")!;
  assert.equal(gateOf(ribbon), undefined, "a road picks nothing of its own");
  const named: string[] = [];
  marks.traverse((o) => named.push(o.name));
  assert.deepEqual(named.filter((n) => n.startsWith("road-lit")), [], "no road is drawn to be lit gold");
  assert.ok(roads.gates.every((_, i) => `#${((marks.getObjectByName(`gate-face:${i}:1`) as Mesh).material as MeshBasicMaterial).color.getHexString()}` !== LIT.gold), "and no gate face is gold");
});

test("3.88 · a tunnel portal that stands as its road's gate is picked as that gate; any other portal picks nothing of its own", () => {
  const tunnelled = islandRoads(sixMap, sixLinks, docks, capabilityPlates(sixMap));
  const drawn = islandRoadMarks(tunnelled, flat, landFill(sixMap, territoryLand(sixMap, flat, coast, new Map(), tunnelled)), islandRelief(sixMap, tunnelled));
  assert.ok(tunnelled.portals.length > 0);
  let asGate = 0;
  tunnelled.portals.forEach((p, i) => {
    const gate = tunnelled.gates.findIndex((g) => Math.hypot(g.at.x - p.border.x, g.at.z - p.border.z) < 1e-6);
    const arch = drawn.getObjectByName(`tunnel-portal:${i}`)!;
    if (gate < 0) {
      assert.equal(gateOf(arch), undefined, "a portal that is no gate picks nothing");
      const box = new Box3().setFromObject(arch), centre = box.getCenter(new Vector3());
      assert.ok(!box.isEmpty());
      assert.deepEqual(new Raycaster(new Vector3(centre.x, 300, centre.z), new Vector3(0, -1, 0)).intersectObject(arch), [], "and takes no click, so the land under it is picked");
    } else {
      asGate++;
      assert.deepEqual(gateOf(arch), { gate, between: tunnelled.gates[gate]!.between }, "a portal at its road's gate picks that gate");
    }
  });
  assert.ok(asGate > 0, "a portal stands as its road's gate");
});

test("3.77 a road that must cross a third territory goes under it: at each portal a stone arch standing up in the rise's face, its dark mouth where the road ends, a little wider than the road (ADR-1253 D3, question_921aee319481)", () => {
  const tunnelled = islandRoads(sixMap, sixLinks, docks, capabilityPlates(sixMap)), relief = islandRelief(sixMap, tunnelled);
  const drawn = islandRoadMarks(tunnelled, flat, landFill(sixMap, territoryLand(sixMap, flat, coast, new Map(), tunnelled)), relief);
  assert.ok(tunnelled.portals.length >= 2, "b's road to e goes under a third territory");
  tunnelled.portals.forEach((p, i) => {
    const arch = drawn.getObjectByName(`tunnel-portal:${i}`) as Mesh, mouth = drawn.getObjectByName(`tunnel-mouth:${i}`) as Mesh;
    assert.ok(arch !== undefined && mouth !== undefined, "an arch and its mouth at every portal");
    const points = (m: Mesh) => { const a = m.geometry.getAttribute("position"); return Array.from({ length: a.count }, (_, k) => ({ x: a.getX(k), y: a.getY(k), z: a.getZ(k) })); };
    const base = relief.raise(p.at), across = (v: { x: number; z: number }) => Math.abs((v.x - p.at.x) * p.along.x + (v.z - p.at.z) * p.along.z);
    const inward = (v: { x: number; z: number }) => (v.x - p.at.x) * p.into.x + (v.z - p.at.z) * p.into.z;
    assert.ok(points(mouth).every((v) => inward(v) > -1e-4), "its mouth leaning into the land it goes under");
    assert.ok(points(arch).every((v) => inward(v) > -1e-4), "and its stone");
    assert.ok(Math.max(...points(mouth).map((v) => v.y)) - base >= p.width / 2 * 0.9, "its mouth stands up as high as half its width");
    assert.ok(Math.max(...points(mouth).map(across)) >= p.width / 2 - 1e-4, "and as wide as the portal");
    assert.ok(Math.max(...points(arch).map(across)) > p.width / 2, "the stone round the mouth");
    assert.ok(p.width < Math.max(...tunnelled.segments.filter((s) => s.links.join() === p.links.join()).map((s) => s.width)) + 1.2, "a little wider than its road: a small footprint");
    assert.equal(`#${((mouth.material as MeshBasicMaterial).color.getHexString())}`, PORTAL.mouth, "its mouth dark");
  });
});


test("3.93 · the feedback pick answers a gate with its story, pair and name, else a capability's territory, else the island, each with its box in the window, and answers nothing in Library or over open water", () => {
  const world = new Group();
  world.name = "planet:story";
  const land = territoryLand(map, flat, coast, new Map(), roads);
  world.add(land, islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads)));
  const titles = new Map([["story", "Story One"]]);
  const box = { left: 0, top: 0, width: 100, height: 100 };
  const above = (at: Point) => {
    const camera = new PerspectiveCamera(30, 1, 0.1, 1000);
    camera.position.set(at.x, 300, at.z);
    camera.up.set(0, 0, -1);
    camera.lookAt(at.x, 0, at.z);
    return camera;
  };
  const i = roads.gates.findIndex((g) => g.entrances.includes("d->c"));
  const post = (world.getObjectByName(`gate-post:${i}:1`) as Mesh).geometry;
  post.computeBoundingBox();
  const on = post.boundingBox!.getCenter(new Vector3());
  const gate = feedbackPick(world, above({ x: on.x, z: on.z }), box, { x: 50, y: 50 }, "forest", titles)!;
  assert.deepEqual({ kind: gate.kind, story: gate.story, between: gate.between, name: gate.name }, { kind: "gate", story: "story", between: ["c", "d"], name: "Gamma ↔ Delta" });
  assert.ok(gate.box.width > 0 && gate.box.height > 0 && gate.box.x < 50 && gate.box.x + gate.box.width > 50 && gate.box.y < 50 && gate.box.y + gate.box.height > 50, "the gate's box is round the pointer");

  const clear = (p: Point) => roads.gates.every((g) => Math.hypot(g.at.x - p.x, g.at.z - p.z) > 6);
  const spot = [...roads.settlements.values()].map((s) => s.at).find(clear)!;
  const territory = feedbackPick(world, above(spot), box, { x: 50, y: 50 }, "forest", titles)!;
  assert.equal(territory.story, "story");
  assert.equal(territory.kind, "capability");
  assert.ok(["a", "b", "c", "d"].includes(territory.capability!), "a territory is named by its capability id");
  assert.ok(territory.name !== "" && !/^\d+ · /.test(territory.name), "named without its number, as the sheet names it");

  assert.equal(feedbackPick(world, above({ x: on.x, z: on.z }), box, { x: 50, y: 50 }, "library", titles), undefined, "Library answers nothing for now");
  assert.equal(feedbackPick(world, above({ x: 9999, z: 9999 }), box, { x: 50, y: 50 }, "forest", titles), undefined, "open water answers nothing");
  assert.equal(FEEDBACK_PICK_EVENT, "storytree:feedback-pick", "the name the picker's package dispatches");
});
