/**
 * Capability 3 · Story node render: the capability open on the map and its parts' marks (3.112, ADR-1339 D1), within the
 * map's frame budget (3.115), rolled up to its gates when closed (3.114).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { LineSegments, Mesh, Vector3, type BufferGeometry, type Object3D } from "three";

import { islandRoads } from "../territories/island-roads.js";
import { islandRelief } from "../territories/island-relief.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import { nestedLayout, partCrossings, regionOf } from "../territories/nested-territories.js";
import { territoryAt, type Coast, type Point } from "../territories/territories.js";
import { capabilityPlates } from "./nameplates.js";
import { islandRoadMarks, landFill } from "./island-roads.js";
import { hideForOpening, openedAt, openedMarks, OpenedStore, rollUp, touches } from "./opened-capability.js";
import { territoryLand } from "./territory-land.js";

const round = (radius: number): Coast => [Array.from({ length: 96 }, (_, i) => ({ x: radius * Math.cos(i * Math.PI / 48), z: radius * Math.sin(i * Math.PI / 48) }))];
const R = Math.sqrt(LIBRARY_LAND / Math.PI), coast = round(R);
const shares = [
  { capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 },
  { capability: "d", title: "4 · Delta", lines: 300 }, { capability: "e", title: "5 · Epsilon", lines: 200 }, { lines: 150 },
];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "a" }, { from: "z3", to: "b" }, { from: "c", to: "y" },
  { from: "d", to: "a" }, { from: "e", to: "d" }, { from: "e", to: "b" }, { from: "a", to: "c" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a", "z2->a", "z3->b"] }, { local: { x: -R, z: 0 }, links: ["c->y"] }];
const map = linkLayout(shares, coast, links, docks);
const roads = islandRoads(map, links, docks, capabilityPlates(map));
const flat = (p: Point) => new Vector3(p.x, 0, p.z);
const A = map.territories.findIndex((t) => t.capability === "a");
const lanes = { "d->a": ["p", "r"], "z1->a": ["p"], "z2->a": ["q"], "a->c": ["q"] };
const crossings = partCrossings(map, roads, "a", lanes, docks);
const partLinks = [{ from: "p", to: "q" }, { from: "q", to: "r" }];
const sized = (n: number) => [...Array.from({ length: n }, (_, k) => ({ capability: ["p", "q", "r", "s", "t", "u", "v", "w"][k]!, title: `part ${k}`, lines: 400 - k * 40 })), { capability: "a", title: "1 · Alpha", lines: 50 }];
const opened = (n: number) => {
  const layout = nestedLayout(regionOf(map, A), sized(n), partLinks, crossings)!;
  const local = crossings.map((c) => ({ local: { x: c.local.x - layout.centre.x, z: c.local.z - layout.centre.z }, links: c.links }));
  const inner = islandRoads(layout.map, [...partLinks, ...crossings.flatMap((c) => c.links.map((key) => { const [from, to] = key.split("->") as [string, string]; return { from, to }; }))], local, capabilityPlates(layout.map));
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const cells = map.cells.filter((cell) => cell.territory === A).map((cell) => cell.polygon);
  return { layout, inner, marks: openedMarks("a", layout, inner, [], cells, coast, flat, landFill(map, land)) };
};
const drawables = (group: Object3D) => { let n = 0; group.traverse((o) => { if (o instanceof Mesh || o instanceof LineSegments) n++; }); return n; };
const ends = (lines: LineSegments): Point[] => { const p = lines.geometry.getAttribute("position"); return Array.from({ length: p.count }, (_, k) => ({ x: p.getX(k), z: p.getZ(k) })); };

test("3.112 · at the parts level the capability under the middle of the view opens; nearer than that, or off a capability, none does", () => {
  assert.deepEqual(openedAt("parts", { kind: "story", id: "s", capability: "a" }), { story: "s", capability: "a" });
  assert.equal(openedAt("near", { kind: "story", id: "s", capability: "a" }), undefined);
  assert.equal(openedAt("parts", { kind: "story", id: "s" }), undefined, "an island's land in no capability opens nothing");
  assert.equal(openedAt("parts", undefined), undefined);
});

test("3.112 · an opened capability's parts are drawn as border lines on its land, with their roads, junctions and gate posts", () => {
  const { marks, inner } = opened(3);
  const borders = marks.getObjectByName("part-borders") as LineSegments;
  const points = ends(borders);
  assert.ok(points.length > 0, "its parts' borders are drawn");
  // Each border's middle lies on Alpha's land: the parts are inside it.
  for (let k = 0; k + 1 < points.length; k += 2) {
    const mid = { x: (points[k]!.x + points[k + 1]!.x) / 2, z: (points[k]!.z + points[k + 1]!.z) / 2 };
    assert.equal(territoryAt(map, mid.x, mid.z), map.territories[A]);
  }
  for (const name of ["part-roads", "part-junctions", "part-gates"]) {
    const mesh = marks.getObjectByName(name) as Mesh;
    assert.ok((mesh.geometry as BufferGeometry).getAttribute("position").count > 0, `${name} are drawn`);
  }
  assert.ok(inner.gates.length > 0);
  assert.equal(marks.getObjectByName("territory:p"), undefined, "a part has no fill of its own: it keeps its capability's colour");
});

test("3.112 · opening a capability hides the island's roads into it and its junction, and the parts' roads carry them on from its border; closing shows them as they were", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  const shown = (name: string) => marks.getObjectByName(name)!.visible;
  const into = roads.segments.flatMap((s, i) => (s.links.includes("d->a") ? [i] : []));
  const elsewhere = roads.segments.findIndex((s) => s.links.every((key) => !touches(key, "a")));
  assert.ok(shown("territory-junction:a") && into.every((i) => shown(`road:${i}`)));
  const close = hideForOpening(marks, map, roads, "a");
  assert.equal(shown("territory-junction:a"), false, "Alpha's junction gives way to its parts'");
  for (const i of into) assert.equal(shown(`road:${i}`), false, "d's road into Alpha is drawn again by the opened marks");
  if (elsewhere >= 0) assert.equal(shown(`road:${elsewhere}`), true, "a road with no end at Alpha stays");
  close();
  assert.ok(shown("territory-junction:a") && into.every((i) => shown(`road:${i}`)), "closed, the island is as it was");
});

test("3.114 · closed, the island's gate on the capability's border carries the count of part roads it rolls up", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), islandRelief(map, roads));
  rollUp(marks, "a", crossings);
  const gate = roads.gates.findIndex((g) => g.entrances.includes("d->a"));
  const posts: Object3D[] = [];
  marks.traverse((o) => { if (o.userData.gate === true && o.userData.index === gate) posts.push(o); });
  assert.ok(posts.length > 0);
  const expected = crossings.find((c) => c.gate === gate)!.links.length;
  for (const post of posts) assert.deepEqual(post.userData.partRoads, { a: expected });
  assert.ok(expected >= 2, "d's road rolls up its roads to p and r");
});

test("3.115 · an opened capability adds at most five draws however many parts it has, and one capability is open at a time", () => {
  assert.equal(drawables(opened(2).marks), 4);
  assert.equal(drawables(opened(7).marks), 4, "seven parts draw no more than two");
  const store = new OpenedStore();
  let heard = 0;
  store.subscribe(() => heard++);
  store.open({ story: "s", capability: "a" });
  store.open({ story: "s", capability: "a" });
  store.open({ story: "s", capability: "b" });
  assert.deepEqual([store.get(), heard], [{ story: "s", capability: "b" }, 2], "opening b closes a");
  store.name("s", "a", [{ part: "p", title: "p", x: 0, z: 0 }]);
  assert.equal(store.platesOn("s"), undefined, "a closed capability's names are not shown");
  store.open(undefined);
  assert.equal(store.get(), undefined);
});
