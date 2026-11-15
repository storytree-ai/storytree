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
import { hiddenByOpening, hideForOpening, namesShown, openedAt, openedMarks, OpenedStore, opensAt, readsUnder, rollUp, touches, UNDER_READS } from "./opened-capability.js";
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
  assert.equal(openedAt("parts", { kind: "story", id: "s", capability: "a" }, "library"), undefined, "the Library's outlines open nothing");
  assert.deepEqual([opensAt("parts"), opensAt("near"), opensAt("parts", "library")], [true, false, false]);
});

test("3.112 · at the parts level what lies under the middle of the view is read often while the eye moves, and still read while it rests", () => {
  const last = { eye: "e1", at: 10 };
  assert.equal(readsUnder(10 + UNDER_READS.moving / 2, "e2", last), false, "not again within a fifth of a second, however the eye moves");
  assert.equal(readsUnder(10 + UNDER_READS.moving * 1.5, "e2", last), true, "the eye moved: read again");
  assert.equal(readsUnder(10 + UNDER_READS.moving * 1.5, "e1", last), false, "the eye at rest: not yet");
  assert.equal(readsUnder(10 + UNDER_READS.resting * 1.01, "e1", last), true, "the eye at rest a second: read again, so a capability laid out under it opens");
  assert.equal(readsUnder(0, "e1", { eye: "", at: -Infinity }), true, "the first read is at once");
});

test("3.112 · an opened capability's name gives way to its parts' names once they are laid out; any other capability keeps its own", () => {
  const plates = [{ capability: "a", title: "Alpha" }, { capability: "b", title: "Beta" }];
  const parts = [{ part: "p", title: "p", x: 0, z: 0 }, { part: "q", title: "q", x: 1, z: 1 }];
  assert.deepEqual(namesShown(plates, parts, "a"), { plates: [{ capability: "b", title: "Beta" }], parts });
  assert.deepEqual(namesShown(plates, undefined, "a"), { plates, parts: [] }, "while its parts are laid out it keeps its name");
  assert.deepEqual(namesShown(plates, undefined, undefined), { plates, parts: [] });
});

test("3.112 · an opened capability's parts are drawn as border lines on its land, with their roads, junctions and gate posts", () => {
  const { marks, inner } = opened(3);
  const { layout } = opened(3);
  const borders = marks.getObjectByName("part-borders") as LineSegments;
  const points = ends(borders);
  const partAt = (p: Point) => { const at = { x: p.x - layout.centre.x, z: p.z - layout.centre.z }; return layout.map.cells.reduce((b, c) => (Math.hypot(c.site.x - at.x, c.site.z - at.z) < Math.hypot(b.site.x - at.x, b.site.z - at.z) ? c : b)).territory; };
  // Each border line lies on Alpha's land and parts two of its parts: a step either side of its middle are different parts.
  const parted = new Set<string>();
  for (let k = 0; k + 1 < points.length; k += 2) {
    const [a, b] = [points[k]!, points[k + 1]!], mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, l = Math.hypot(b.x - a.x, b.z - a.z);
    assert.equal(territoryAt(map, mid.x, mid.z), map.territories[A], "on Alpha's land");
    const n = { x: -(b.z - a.z) / l * 0.3, z: (b.x - a.x) / l * 0.3 };
    const sides = [partAt({ x: mid.x + n.x, z: mid.z + n.z }), partAt({ x: mid.x - n.x, z: mid.z - n.z })];
    assert.notEqual(sides[0], sides[1], "between two parts");
    parted.add(sides.sort().join("|"));
  }
  assert.ok(parted.size >= 3, `the lines part ${parted.size} pairs of its four territories`);
  const count = (name: string) => ((marks.getObjectByName(name) as Mesh).geometry as BufferGeometry).getAttribute("position").count;
  // Two posts a gate, each a box of 36 corners; a disc of 16 triangles at each junction and where each part's roads end.
  assert.equal(count("part-gates"), inner.gates.length * 2 * 36, "a post either side of each part gate");
  // p, q and r each meet their roads at a junction of their own; Alpha's own files, which no road reaches, have none.
  assert.equal(count("part-junctions"), (inner.junctions.length + 3) * 16 * 3, "a junction where roads meet and where each part's end");
  // Every road's way is drawn: a ribbon of two triangles each half unit along it.
  assert.ok(count("part-roads") >= inner.segments.reduce((sum, s) => sum + s.pts.slice(1).reduce((l, p, i) => l + Math.hypot(p.x - s.pts[i]!.x, p.z - s.pts[i]!.z), 0) / 0.5 * 6 * 0.9, 0), "the parts' roads are drawn their whole way");
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
  assert.ok(elsewhere >= 0, "the island has a road with no end at Alpha");
  assert.equal(shown(`road:${elsewhere}`), true, "a road with no end at Alpha stays");
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
  // d's files reach p and r, so its road in rolls up two.
  for (const post of posts) assert.deepEqual(post.userData.partRoads, { a: 2 });
  const sea = roads.gates.findIndex((g) => g.entrances.includes("arrive:0->a"));
  let seaPosts = 0;
  marks.traverse((o) => { if (o.userData.gate === true && o.userData.index === sea) { seaPosts++; assert.deepEqual(o.userData.partRoads, { a: 2 }, "the sea road in carries z1's to p and z2's to q"); } });
  assert.ok(seaPosts > 0);
});

test("3.112 · the island's roads it hides are drawn again by the opened capability off its land, up to its border", () => {
  const { roads: hidden, kept } = hiddenByOpening(map, roads, "a");
  assert.ok(hidden.length > 0);
  const own = map.territories[A];
  for (const stretch of kept) {
    if (stretch.links.some((key) => !touches(key, "a"))) continue;
    for (const p of stretch.pts) assert.notEqual(territoryAt(map, p.x, p.z), own, "a road of Alpha's alone is drawn again only off its land");
  }
  // d's road is drawn again from d's junction to within a step of Alpha's border.
  const d = kept.filter((s) => s.links.includes("d->a") && s.links.every((key) => touches(key, "a")));
  assert.ok(d.length > 0);
  const gate = roads.gates.find((g) => g.entrances.includes("d->a"))!;
  assert.ok(d.some((s) => [s.pts[0]!, s.pts.at(-1)!].some((p) => Math.hypot(p.x - gate.at.x, p.z - gate.at.z) < 1.5)), "up to its gate into Alpha");
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
