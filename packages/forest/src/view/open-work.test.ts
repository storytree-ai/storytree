/**
 * Capability 3 · Story node render: an arc selected draws a hollow ring round each capability its open work names, round its
 * settlement or its nameplate, dimming nothing (3.83, ADR-1299); with no arc selected open work draws nothing (3.84); at every
 * zoom, every ring one width on screen (3.86) (ADR-1253 D1, ADR-1272 D2); a selected capability ringed in the pick's gold (3.91);
 * and the gate of an edge whose contract the open work makes true ringed the same (3.92, ADR-1279 D4).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Mesh, MeshBasicMaterial, type Object3D, Vector3 } from "three";

import { islandRoads } from "../territories/island-roads.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import type { Coast, Point } from "../territories/territories.js";
import { capabilityPlates } from "./nameplates.js";
import { IslandOpenWork, OPEN_WORK, openWorkLayer, openWorkMarks, PICK_GOLD, ringedCapabilities, RING_LEAST_PX, RING_PX, rungLinks, sizeOpenWork } from "./open-work.js";

const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 }, { capability: "d", title: "4 · Delta", lines: 300 }, { lines: 200 }];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "c", to: "a" }, { from: "d", to: "c" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a", "z2->b"] }];
const map = linkLayout(shares, coast, links, docks);
const roads = islandRoads(map, links, docks, capabilityPlates(map));
const plates = new Map(capabilityPlates(map).map((plate) => [plate.capability, plate]));
const flat = (p: Point) => new Vector3(p.x, 0, p.z);
/** The distances from `centre` of every corner of `mesh`'s triangles. */
const reaches = (mesh: Mesh, centre: Point) => {
  const position = mesh.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => Math.hypot(position.getX(i) - centre.x, position.getZ(i) - centre.z));
};

test("3.83 · an arc selected rings each capability its open work names, a hollow circle round its settlement", () => {
  const marks = openWorkMarks(map, new Set(["a", "c", "elsewhere"]), roads);
  assert.deepEqual(marks.rings.map(({ capability }) => capability), ["a", "c"], "a capability on another island rings nothing here");
  for (const ring of marks.rings) {
    const settlement = roads.settlements.get(ring.capability)!;
    assert.deepEqual({ x: ring.x, z: ring.z }, settlement.at, "round its settlement");
    // The symbol's 24-unit box is as large as its size: its corners lie 0.71 of the size from its middle.
    assert.ok(ring.radius > settlement.size * 0.71 && ring.radius < settlement.size * 1.2, "sized to the symbol, with a little room");
  }
  const bare = openWorkMarks(map, new Set(["a"]));
  assert.deepEqual(bare.rings.map(({ capability, x, z }) => ({ capability, x, z })), [{ capability: "a", x: plates.get("a")!.x, z: plates.get("a")!.z }], "round its nameplate where it has no settlement");
  assert.deepEqual(openWorkMarks(map, new Set(["elsewhere"]), roads), { rings: [] }, "an island the arc rings nothing on draws nothing");
});

test("3.83 · the open-work layer draws each ring hollow on the land, dims no territory, and takes no pointer", () => {
  const marks = openWorkMarks(map, new Set(["a"]), roads);
  // Near enough that the ring is sized to its settlement, not to the least it is across on screen.
  const zoom = 40, width = RING_PX / zoom;
  const layer = openWorkLayer(marks, flat, zoom);
  const ring = layer.getObjectByName("open-work-ring:a") as Mesh;
  const distances = reaches(ring, marks.rings[0]!);
  assert.ok(Math.min(...distances) >= marks.rings[0]!.radius - width, "nothing filled inside the ring");
  assert.ok(Math.max(...distances) <= marks.rings[0]!.radius + width, "a thin line");
  assert.deepEqual(layer.children.map(({ name }) => name), ["open-work-ring:a"], "its ring alone: every territory keeps its own fill (ADR-1299)");
  const hits: unknown[] = [];
  layer.traverse((object) => { if (object instanceof Mesh) object.raycast({} as never, hits as never); });
  assert.equal(hits.length, 0);
});

test("3.84 · with no arc selected open work draws nothing on the map", () => {
  assert.equal(openWorkLayer(openWorkMarks(map, undefined, roads), flat, 1).children.length, 0);
});

test("3.86 · an arc selected rings its capabilities at every zoom, with no ring round the island; one width on screen at every zoom", () => {
  const layer = openWorkLayer(openWorkMarks(map, new Set(["a", "c"]), roads), flat, 1);
  /** A ring's line across, in CSS pixels at `zoom`. */
  const onScreen = (name: string, centre: Point, zoom: number) => { const d = reaches(layer.getObjectByName(name) as Mesh, centre); return (Math.max(...d) - Math.min(...d)) * zoom; };
  const far = 0.3, near = 3;
  assert.deepEqual([...new Set(layer.children.map((mark) => mark.name.split(":")[0]!))].sort(), ["open-work-ring"], "the capabilities' rings, no dim and no island ring");
  sizeOpenWork(layer, far);
  const ring = layer.getObjectByName("open-work-ring:a")!, at = roads.settlements.get("a")!.at;
  const farWidth = onScreen("open-work-ring:a", at, far);
  assert.ok(Math.max(...reaches(ring as Mesh, at)) * 2 * far >= RING_LEAST_PX, "zoomed out, the ring is still at least its least across on screen");
  assert.equal(sizeOpenWork(layer, near), true);
  const nearWidth = onScreen("open-work-ring:a", at, near);
  assert.ok(Math.abs(nearWidth - farWidth) < 0.01 * farWidth && farWidth > 1, `one width on screen, far ${farWidth} px and near ${nearWidth} px`);
  const drawn = (ring as Mesh).geometry;
  assert.equal(sizeOpenWork(layer, near * 1.01), false, "a zoom that barely moves redraws nothing");
  assert.equal((ring as Mesh).geometry, drawn);
  // Where its settlement is drawn only a few pixels wide, the ring keeps the least it is across on screen, so it still reads.
  const settlement = roads.settlements.get("a")!, small = RING_LEAST_PX / 4 / settlement.size;
  sizeOpenWork(layer, small);
  const across = Math.max(...reaches(ring as Mesh, settlement.at)) * 2 * small;
  assert.ok(across >= RING_LEAST_PX && across <= RING_LEAST_PX + 2 * RING_PX, `at least ${RING_LEAST_PX} px across, ${across} px`);
});

test("3.91 · a selected capability is ringed in the pick's gold round its settlement, beside an arc's blue rings and clear of them, at least its least across at any zoom, and takes no pointer", () => {
  assert.deepEqual(openWorkLayer(openWorkMarks(map, undefined, roads), flat, 2).children, [], "nothing selected: no ring");
  const settlement = roads.settlements.get("c")!;
  const layer = openWorkLayer(openWorkMarks(map, undefined, roads, "c"), flat, 2);
  assert.deepEqual(layer.children.map((o) => o.name), ["picked-ring:c"], "the selected capability's ring alone, and no territory dimmed");
  const ring = layer.children[0] as Mesh;
  assert.equal(`#${(ring.material as MeshBasicMaterial).color.getHexString()}`, PICK_GOLD, "in the pick's gold");
  const spread = reaches(ring, settlement.at), width = Math.max(...spread) - Math.min(...spread);
  assert.ok(Math.min(...spread) > settlement.size * 0.71, "round its settlement, clear of the symbol");
  assert.ok(Math.abs(width - RING_PX / 2) < 1e-3, "hollow: a line RING_PX wide on screen");
  const small = RING_LEAST_PX / 4 / settlement.size;
  sizeOpenWork(layer, small);
  assert.ok(Math.max(...reaches(layer.children[0] as Mesh, settlement.at)) * 2 * small >= RING_LEAST_PX, `zoomed out, still at least ${RING_LEAST_PX} px across`);
  const hits: unknown[] = [];
  ring.raycast({} as never, hits as never);
  assert.deepEqual(hits, [], "it takes no pointer, so a click still picks the land");
  // An arc selected that rings the same capability: its blue ring, and the gold one round it, each still seen.
  const both = openWorkLayer(openWorkMarks(map, new Set(["a", "c"]), roads, "c"), flat, 2);
  const named = (name: string) => both.getObjectByName(name) as Mesh;
  assert.deepEqual(both.children.filter((o) => o.name.includes("ring:")).map((o) => o.name).sort(), ["open-work-ring:a", "open-work-ring:c", "picked-ring:c"]);
  assert.equal(`#${(named("open-work-ring:c").material as MeshBasicMaterial).color.getHexString()}`, OPEN_WORK, "blue keeps meaning open work");
  assert.ok(Math.min(...reaches(named("picked-ring:c"), settlement.at)) > Math.max(...reaches(named("open-work-ring:c"), settlement.at)), "the gold ring outside the blue, so neither hides the other");
  for (const zoom of [small, 0.5]) {
    sizeOpenWork(both, zoom);
    assert.ok(Math.min(...reaches(named("picked-ring:c"), settlement.at)) > Math.max(...reaches(named("open-work-ring:c"), settlement.at)), `still outside it at zoom ${zoom}`);
  }
});

test("3.92 · an arc selected whose open work makes an edge's contract true rings that edge's gate, hollow", () => {
  const edges = [{ from: "c", to: "a", contracts: ["contract_ca"] }, { from: "d", to: "c", contracts: ["contract_dc"] }, { from: "z1", to: "a", contracts: ["contract_far"] }];
  const rung = rungLinks(edges, ["contract_ca", "contract_none"]);
  assert.deepEqual([...rung ?? []], ["c->a"], "only the edges whose contracts it links");
  assert.equal(rungLinks(edges, undefined), undefined, "no arc selected rings no gate");
  const gate = roads.gates.findIndex(({ entrances }) => entrances.includes("c->a"));
  assert.ok(gate >= 0);
  const marks = openWorkMarks(map, new Set(["b"]), roads, undefined, rung);
  assert.deepEqual(marks.gates?.map(({ gate }) => gate), [gate], "one gate, its edge's");
  assert.deepEqual({ x: marks.gates![0]!.x, z: marks.gates![0]!.z }, roads.gates[gate]!.at, "round the gate");
  assert.deepEqual(marks.rings.map(({ capability }) => capability), ["b"], "a capability's own work rings its marker as before");
  const only = openWorkMarks(map, new Set(), roads, undefined, rung);
  assert.equal(only.gates?.length, 1, "a gate rings with no capability ringed");
  assert.equal(openWorkMarks(map, undefined, roads, undefined, rung).gates, undefined, "no arc selected rings no gate");

  const zoom = 40, width = RING_PX / zoom;
  const layer = openWorkLayer(marks, flat, zoom);
  assert.deepEqual(layer.children.map(({ name }) => name).sort(), [`open-work-gate:${gate}`, "open-work-ring:b"], "the rings alone: no territory dimmed, the gate's two capabilities or any other (ADR-1299)");
  const ring = layer.getObjectByName(`open-work-gate:${gate}`) as Mesh;
  assert.equal((ring.material as MeshBasicMaterial).color.getHexString(), OPEN_WORK.slice(1), "in the open work's cyan");
  const distances = reaches(ring, roads.gates[gate]!.at);
  assert.ok(Math.min(...distances) >= marks.gates![0]!.radius - width && Math.max(...distances) <= marks.gates![0]!.radius + width, "hollow, a thin line");
  assert.ok(marks.gates![0]!.radius >= roads.gates[gate]!.opening / 2, "round the gate's opening");
  const hits: unknown[] = [];
  ring.raycast({} as never, hits as never);
  assert.equal(hits.length, 0, "it takes no pointer");
});

test("3.99 · an arc selected rings each capability its open increments name and each one owning a contract they link, before any claims it", () => {
  const owned = [{ capability: "a", contracts: ["contract_a1", "contract_a2"] }, { capability: "b", contracts: ["contract_b1"] }, { capability: "c", contracts: ["contract_c1"] }];
  assert.deepEqual([...ringedCapabilities([], ["contract_a2", "contract_c1", "contract_edge"], owned)!].sort(), ["a", "c"], "planned work, no capability named yet, rings the parts its contracts sit on");
  assert.deepEqual([...ringedCapabilities(["d"], ["contract_b1"], owned)!].sort(), ["b", "d"], "named and linked alike");
  assert.deepEqual([...ringedCapabilities(["d"], undefined, owned)!], ["d"]);
  assert.equal(ringedCapabilities(undefined, undefined, owned), undefined, "no arc selected rings nothing (3.84)");
});

test("3.102 · a pick after an arc is selected draws only its gold ring: the arc's rings stand, and no ring's material is made or freed", () => {
  const work = new IslandOpenWork(), arc = new Set(["a", "c"]);
  const meshes = () => { const found: Mesh[] = []; work.root.traverse((o) => { if (o instanceof Mesh) found.push(o); }); return found; };
  const names = (layers: readonly Object3D[]) => layers.flatMap((layer) => layer.children.map(({ name }) => name)).sort();
  const freed: string[] = [];
  const watch = () => { for (const mesh of meshes()) if (mesh.material instanceof MeshBasicMaterial && mesh.material.userData.watched !== true) {
    mesh.material.userData.watched = true;
    mesh.material.addEventListener("dispose", () => freed.push(mesh.name));
  } };
  assert.deepEqual(names(work.show(openWorkMarks(map, arc, roads), flat, 2)), ["open-work-ring:a", "open-work-ring:c"], "the arc selected: its rings drawn");
  watch();
  const standing = new Map(meshes().map((mesh) => [mesh.name, mesh]));
  assert.deepEqual(names(work.show(openWorkMarks(map, arc, roads, "c"), flat, 2)), ["picked-ring:c"], "the first pick after it draws its gold ring alone");
  for (const [name, mesh] of standing) assert.equal(work.root.getObjectByName(name), mesh, `${name} stands, not rebuilt`);
  watch();
  const gold = (work.root.getObjectByName("picked-ring:c") as Mesh).material;
  assert.deepEqual(names(work.show(openWorkMarks(map, arc, roads, "a"), flat, 2)), ["picked-ring:a"], "another pick: its gold ring alone");
  assert.equal((work.root.getObjectByName("picked-ring:a") as Mesh).material, gold, "in the same gold material");
  assert.equal(work.root.getObjectByName("picked-ring:c"), undefined, "the last pick's ring gone");
  for (const [name, mesh] of standing) assert.equal(work.root.getObjectByName(name), mesh, `${name} still stands`);
  assert.deepEqual(names(work.show(openWorkMarks(map, arc, roads, "a"), flat, 2)), [], "the same marks again draw nothing");
  assert.deepEqual(freed, [], "no ring's material freed, so its shader stays built");
  assert.equal(new Set(meshes().map(({ material }) => material)).size, 2, "one material for the arc's rings, one for the pick's");
  assert.deepEqual(names(work.show(openWorkMarks(map, undefined, roads, "a"), flat, 2)), [], "the arc put away: nothing new to draw");
  assert.deepEqual(meshes().map(({ name }) => name), ["picked-ring:a"], "its rings gone, the pick's standing");
  work.show(openWorkMarks(map, new Set(["a"]), roads, "a"), flat, 2);
  const geometries = new Map(meshes().map((mesh) => [mesh.name, mesh.geometry]));
  assert.ok(work.size(0.5), "redrawn for another zoom");
  for (const mesh of meshes()) {
    assert.notEqual(mesh.geometry, geometries.get(mesh.name), `${mesh.name} redrawn`);
    const spread = reaches(mesh, roads.settlements.get("a")!.at);
    assert.ok(Math.abs(Math.max(...spread) - Math.min(...spread) - RING_PX / 0.5) < 1e-3, `${mesh.name}'s line RING_PX wide on screen at the new zoom`);
  }
  assert.equal(work.size(0.5), false, "a still eye redraws nothing");
  work.dispose();
  assert.deepEqual(freed.sort(), ["open-work-ring:a", "picked-ring:c"], "freed once the island goes");
  assert.deepEqual(meshes(), [], "and its rings with them");
});
