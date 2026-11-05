/**
 * Capability 3 · Story node render: the selected island's roads drawn sandy and faint, the borders quietened and cut
 * open at each gate, a post either side of every gate (ADR-1236 D1, rollout 2 step 3); a picked link's way lit in gold (3.81).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3, type Object3D } from "three";

import { islandRoads } from "../territories/island-roads.js";
import { islandRelief } from "../territories/island-relief.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import type { Coast, Point } from "../territories/territories.js";
import { capabilityPlates } from "./nameplates.js";
import { presentTerritories } from "./globe-surfaces.js";
import { islandRoadMarks, landFill, lightRoute, LIT, PORTAL, ROAD, routeOf } from "./island-roads.js";
import { pickClick } from "./planet-navigation.js";
import { GLYPHS, kindOf, settlementSymbols, SYMBOL_INK } from "./settlement-symbols.js";
import { territoryLand } from "./territory-land.js";

const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 }, { capability: "d", title: "4 · Delta", lines: 300 }];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "c", to: "a" }, { from: "d", to: "c" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a", "z2->b"] }];
const map = linkLayout(shares, coast, links, docks);
const roads = islandRoads(map, links, docks, capabilityPlates(map));
// Six capabilities where the arrival to a must go under e (ADR-1253 D3).
const sixShares = ["a", "b", "c", "d", "e", "f"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability.toUpperCase()}`, lines: 900 - 120 * i }));
const sixLinks = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "e", to: "a" }, { from: "c", to: "f" }, { from: "f", to: "b" }, { from: "c", to: "a" }];
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
    for (const opening of [...routed.gates, ...routed.passes]) {
      assert.ok(ground(whole).some(([a, b]) => toSegment(opening.at, a, b) < 1e-6), "it stands on a border");
      for (const [a, b] of ground(cut)) assert.ok(toSegment(opening.at, a, b) > opening.opening / 2 - 1e-6, "no border line across its opening");
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

test("3.81 a road carrying one link picks that link; a gate picks the pair it joins (ADR-1253 D3); a tunnel's portal the links it carries; a shared road picks itself", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  const ribbons = marks.children.filter((o) => o.name.startsWith("road:"));
  const single = ribbons.find((o) => o.userData.links.length === 1), shared = ribbons.find((o) => o.userData.links.length > 1);
  assert.ok(single !== undefined && shared !== undefined, "the island has both kinds of road");
  assert.deepEqual(routeOf(single), { kind: "link", links: single.userData.links });
  assert.deepEqual(routeOf(shared), { kind: "road", links: shared.userData.links });
  assert.equal(routeOf(marks.getObjectByName("settlements")!), undefined, "anything else picks nothing");
  roads.gates.forEach((g, i) => assert.deepEqual(routeOf(marks.getObjectByName(`gate-post:${i}:1`)!), { kind: "link", links: g.entrances }, "every gate picks the links whose gate it is"));
  // A link from d through c to a shares c's gate into a.
  const through = [...links, { from: "d", to: "a" }], laid = linkLayout(shares, coast, through, docks), more = islandRoads(laid, through, docks, capabilityPlates(laid));
  assert.deepEqual(more.gates.map((g) => g.entrances), [["arrive:0->a"], ["arrive:0->b"], ["d->c"], ["c->a", "d->a"]], "one gate per link, two links' gates together shared");
  const posts = islandRoadMarks(more, flat, landFill(laid, territoryLand(laid, flat, coast, new Map(), more)), islandRelief(laid, more));
  assert.deepEqual(routeOf(posts.getObjectByName("gate-post:3:1")!), { kind: "link", links: ["c->a", "d->a"] }, "a gate two links enter by picks both");
  // The arrival to a must go under e.
  const tunnelled = islandRoads(sixMap, sixLinks, docks, capabilityPlates(sixMap)), drawn = islandRoadMarks(tunnelled, flat, landFill(sixMap, territoryLand(sixMap, flat, coast, new Map(), tunnelled)), islandRelief(sixMap, tunnelled));
  assert.ok(tunnelled.portals.length > 0);
  tunnelled.portals.forEach((p, i) => assert.deepEqual(routeOf(drawn.getObjectByName(`tunnel-portal:${i}`)!), { kind: "link", links: p.links }, "a portal picks the links it carries"));
  assert.equal(routeOf(drawn.getObjectByName("tunnel-mouth:0")!), undefined, "its mouth is no pick of its own");
});

test("3.77 a road that must cross a third territory goes under it: at each portal an arch laid on that territory's land at its border, its dark mouth where the road ends (ADR-1253 D3)", () => {
  const tunnelled = islandRoads(sixMap, sixLinks, docks, capabilityPlates(sixMap)), relief = islandRelief(sixMap, tunnelled);
  const drawn = islandRoadMarks(tunnelled, flat, landFill(sixMap, territoryLand(sixMap, flat, coast, new Map(), tunnelled)), relief);
  assert.ok(tunnelled.portals.length >= 2, "the arrival to a goes under e");
  tunnelled.portals.forEach((p, i) => {
    const arch = drawn.getObjectByName(`tunnel-portal:${i}`) as Mesh, mouth = drawn.getObjectByName(`tunnel-mouth:${i}`) as Mesh;
    assert.ok(arch !== undefined && mouth !== undefined, "an arch and its mouth at every portal");
    const points = (m: Mesh) => { const a = m.geometry.getAttribute("position"); return Array.from({ length: a.count }, (_, k) => ({ x: a.getX(k), y: a.getY(k), z: a.getZ(k) })); };
    const under = relief.raise({ x: p.at.x + p.into.x * 0.6, z: p.at.z + p.into.z * 0.6 });
    for (const v of [...points(arch), ...points(mouth)]) {
      assert.ok((v.x - p.at.x) * p.into.x + (v.z - p.at.z) * p.into.z > -1e-4, "on the side of the land it goes under");
      assert.ok(v.y > under && v.y < under + 0.2, "laid on that land, just over it");
    }
    assert.ok(Math.max(...points(mouth).map((v) => Math.hypot(v.x - p.at.x, v.z - p.at.z))) >= p.width / 2 - 1e-4, "its mouth as wide as the road's opening");
    assert.ok(points(arch).every((v) => Math.hypot(v.x - p.at.x, v.z - p.at.z) >= p.width / 2 * 0.8 - 1e-4), "the stone round the mouth");
    assert.equal(`#${((mouth.material as MeshBasicMaterial).color.getHexString())}`, PORTAL.mouth, "its mouth dark");
  });
});

test("3.81 a picked link lights every road it travels and its entrance gate in gold, and nothing else; picking nothing puts the gold out", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  const lit = () => marks.children.filter((o) => o.name.startsWith("road-lit:") && o.visible).map((o) => Number(o.name.slice("road-lit:".length))).sort((a, b) => a - b);
  const hex = (o: Object3D) => `#${((o as Mesh).material as MeshBasicMaterial).color.getHexString()}`;
  const gold = () => roads.gates.flatMap((_, i) => (hex(marks.getObjectByName(`gate-face:${i}:1`)!) === LIT.gold ? [i] : []));
  assert.deepEqual(lit(), [], "nothing lit until a pick");
  const link = "d->c", travels = roads.segments.flatMap((s, i) => (s.links.includes(link) ? [i] : []));
  assert.ok(travels.length > 0 && roads.segments.some((s) => !s.links.includes(link)), "a link, and roads it does not travel");
  lightRoute(marks, roads, { kind: "link", links: [link] });
  assert.deepEqual(lit(), travels, "its whole way, every road it travels");
  assert.deepEqual(gold(), roads.gates.flatMap((g, i) => (g.entrances.includes(link) ? [i] : [])), "its entrance gate gold");
  assert.ok(gold().length > 0);
  const way = marks.getObjectByName(`road-lit:${travels[0]}`)!;
  assert.deepEqual(way.children.slice(0, 2).map(hex), [LIT.edge, LIT.gold], "gold on a dark edge");
  const shared = roads.segments.findIndex((s) => s.links.length > 1);
  lightRoute(marks, roads, { kind: "road", links: roads.segments[shared]!.links });
  assert.deepEqual(lit(), [shared], "a picked shared road lights itself alone");
  assert.deepEqual(gold(), []);
  lightRoute(marks, roads, undefined);
  assert.deepEqual([...lit(), ...gold()], [], "picking nothing puts it out");
});

test("3.81 a click on a road picks its route ahead of the land under it and picks no selection; a click on the land picks no route, and its territory", () => {
  const world = new Group();
  world.name = "planet:story";
  const land = territoryLand(map, flat, coast, new Map(), roads);
  world.add(land, islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads)));
  const looking = (at: Point, mode: "forest" | "library" = "forest") => {
    const camera = new PerspectiveCamera(30, 1, 0.1, 1000);
    camera.position.set(at.x, 300, at.z);
    camera.up.set(0, 0, -1);
    camera.lookAt(at.x, 0, at.z);
    return pickClick(world, camera, { left: 0, top: 0, width: 100, height: 100 }, { x: 50, y: 50 }, mode);
  };
  const one = roads.segments.find((s) => s.links.length === 1)!, mid = one.pts[Math.floor(one.pts.length / 2)]!;
  assert.deepEqual(looking(mid), { route: { story: "story", pick: { kind: "link", links: one.links } } }, "the road's link, and no selection");
  assert.deepEqual(looking(mid, "library"), { route: undefined, hit: undefined }, "in Library no road is picked");
  const clear = (p: Point) => Math.hypot(p.x, p.z) < R * 0.8 && roads.segments.every((s) => s.pts.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 6)) && roads.gates.every((g) => Math.hypot(g.at.x - p.x, g.at.z - p.z) > 6);
  const away = map.cells.find((c) => c.territory >= 0 && clear(c.site));
  assert.ok(away !== undefined, "land clear of every road");
  const clicked = looking(away.site);
  assert.equal(clicked.route, undefined, "the land picks no route, so the gold goes out");
  assert.deepEqual(clicked.route === undefined && clicked.hit, { kind: "story", id: "story", capability: map.territories[away.territory]!.capability }, "and the territory under it");
});
