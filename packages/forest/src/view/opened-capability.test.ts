/**
 * Capability 3 · Story node render: the capability open on the map and its parts' marks (3.112, ADR-1339 D1), within the
 * map's frame budget (3.115), rolled up to its gates when closed (3.114).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, Group, LineSegments, Mesh, OrthographicCamera, Vector3, type BufferGeometry, type Object3D } from "three";

import { islandRoads } from "../territories/island-roads.js";
import { islandRelief } from "../territories/island-relief.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import { nestedLayout, partCrossings, regionOf } from "../territories/nested-territories.js";
import { territoryAt, type Coast, type Point } from "../territories/territories.js";
import { capabilityPlates } from "./nameplates.js";
import { islandRoadMarks, landFill } from "./island-roads.js";
import { CLASH, hiddenByOpening, hideForOpening, namesShown, openedAt, openedMarks, OpenedStore, opensAt, reachPlates, readsUnder, rollUp, touches, UNDER_READS } from "./opened-capability.js";
import { globeHover, pickGlobe } from "./planet-navigation.js";
import { PARKED_FILL, territoryLand, WORD_FILL } from "./territory-land.js";
import { landColour } from "./island-roads.js";

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
const opened = (n: number, words?: Parameters<typeof openedMarks>[8], id = "a", clashes?: Parameters<typeof openedMarks>[9]) => {
  const layout = nestedLayout(regionOf(map, A), sized(n), partLinks, crossings)!;
  const local = crossings.map((c) => ({ local: { x: c.local.x - layout.centre.x, z: c.local.z - layout.centre.z }, links: c.links }));
  const inner = islandRoads(layout.map, [...partLinks, ...crossings.flatMap((c) => c.links.map((key) => { const [from, to] = key.split("->") as [string, string]; return { from, to }; }))], local, capabilityPlates(layout.map));
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const cells = map.cells.filter((cell) => cell.territory === A).map((cell) => cell.polygon);
  return { layout, inner, marks: openedMarks(id, layout, inner, [], cells, coast, flat, landFill(map, land), words, clashes) };
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

test("3.118 · an opened top part fills each capability inside it by its own word, and the land there picks that capability within the top part", () => {
  const words = new Map([["p", { status: "unhealthy" as const, title: "src/ui/p" }], ["q", { status: "healthy" as const, title: "src/ui/q" }], ["r", { status: "proposed" as const, parked: true as const, title: "src/ui/r" }]]);
  const { layout, marks } = opened(3, words, "top:s:ui");
  assert.equal(drawables(marks), 5, "one mesh fills them all: still within 3.115's five draws");
  // The top part is territory a of the island, drawn under the id a top part has.
  const top = { ...map, territories: map.territories.map((t) => (t.capability === "a" ? { ...t, capability: "top:s:ui" } : t)) };
  const planet = new Group();
  planet.name = "planet:s";
  planet.add(territoryLand(top, flat, coast), marks);
  const world = new Group().add(planet);
  const box = { left: 0, top: 0, width: 200, height: 200 };
  const above = (p: Point) => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(p.x, 50, p.z); camera.up.set(0, 0, -1); camera.lookAt(p.x, 0, p.z);
    return camera;
  };
  const at = (p: Point) => pickGlobe(world, above(p), box, { x: 100, y: 100 }, "forest");
  // The middle of each part's largest cell on a's land, in the island's coordinates.
  const middleOf = (part: string) => {
    const index = layout.map.territories.findIndex((t) => t.capability === part);
    const cell = layout.map.cells.filter((c) => c.territory === index).map((c) => ({ x: c.site.x + layout.centre.x, z: c.site.z + layout.centre.z })).find((p) => territoryAt(map, p.x, p.z) === map.territories[A]);
    assert.ok(cell, `${part} has land on a's`);
    return cell;
  };
  const fills = marks.getObjectByName("part-fills") as Mesh;
  const colours = fills.geometry.getAttribute("color");
  const faces = fills.userData.faces as string[];
  for (const [part, fill] of [["p", WORD_FILL.unhealthy], ["q", WORD_FILL.healthy], ["r", PARKED_FILL]] as const) {
    assert.deepEqual(at(middleOf(part)), { kind: "story", id: "s", capability: part, within: "top:s:ui" }, `${part}'s land picks ${part}, within the top part`);
    const face = faces.indexOf(part), shown = new Color(colours.getX(face * 3), colours.getY(face * 3), colours.getZ(face * 3));
    const word = landColour(() => ({ colour: new Color(fill.colour), opacity: fill.opacity }))({ x: 0, z: 0 });
    assert.ok(Math.max(Math.abs(shown.r - word.r), Math.abs(shown.g - word.g), Math.abs(shown.b - word.b)) < 1e-6, `${part} is filled by its own word over the ground`);
  }
  assert.equal(globeHover(world, above(middleOf("q")), box, { x: 100, y: 100 }, "forest").title, "src/ui/q", "hovering a capability inside names it");
  assert.deepEqual(at(middleOf("a")), { kind: "story", id: "s", within: "top:s:ui" }, "the top part's land with no capability filled picks the island within the top part, never a capability of that id");
  assert.deepEqual(openedAt("parts", { kind: "story", id: "s", capability: "p", within: "top:s:ui" }), { story: "s", capability: "top:s:ui" }, "the eye over a capability inside keeps the top part open");
});

test("3.120 · an opened capability marks each road an import reaching round a part's front door rides on, and its gate into that part, naming the part it reaches when it is deeper than those shown", () => {
  const clashes = { "p->q": ["q/deep/payments"], "z1->p": ["p"] };
  const plain = opened(3), marked = opened(3, undefined, "a", clashes);
  assert.equal(drawables(marked.marks), 4, "the marks add no draw: still within 3.115's five");
  const tint = new Color(CLASH.colour);
  const near = (c: Color) => Math.abs(c.r - tint.r) + Math.abs(c.g - tint.g) + Math.abs(c.b - tint.b) < 0.05;
  const coloured = (marks: Object3D, name: string) => { const g = (marks.getObjectByName(name) as Mesh).geometry as BufferGeometry, c = g.getAttribute("color"), p = g.getAttribute("position"); return Array.from({ length: c.count }, (_, k) => ({ tinted: near(new Color(c.getX(k), c.getY(k), c.getZ(k))), at: { x: p.getX(k), z: p.getZ(k) } })); };
  assert.ok(coloured(plain.marks, "part-roads").every(({ tinted }) => !tinted), "no clash, no road tinted");
  const roads = coloured(marked.marks, "part-roads");
  const centre = marked.layout.centre;
  const onRoad = (at: Point, keys: readonly string[]) => marked.inner.segments.some((s) => s.links.some((key) => keys.includes(key)) && s.pts.some((p, i) => i > 0 && Math.hypot(at.x - centre.x - (p.x + s.pts[i - 1]!.x) / 2, at.z - centre.z - (p.z + s.pts[i - 1]!.z) / 2) < Math.hypot(p.x - s.pts[i - 1]!.x, p.z - s.pts[i - 1]!.z) / 2 + s.width));
  assert.ok(roads.some(({ tinted }) => tinted), "the clash's roads are tinted");
  assert.ok(roads.filter(({ tinted }) => tinted).every(({ at }) => onRoad(at, Object.keys(clashes))), "only along a road a clash rides on");
  const gates = marked.inner.gates.filter((gate) => gate.entrances.some((key) => key in clashes));
  assert.ok(gates.length > 0, "a clash road enters its part by a gate");
  assert.equal(coloured(marked.marks, "part-gates").filter(({ tinted }) => tinted).length, gates.length * 2 * 36, "both posts of each gate a clash enters by are tinted, and no other");
  assert.ok(coloured(plain.marks, "part-gates").every(({ tinted }) => !tinted));
  // Named where the part reached lies deeper than the parts shown: payments, within q, at its gate; z1's reaches p itself.
  const plates = reachPlates(marked.layout, marked.inner, clashes);
  assert.deepEqual(plates.map(({ part, title, reach }) => [part, title, reach]), [["p->q", "into deep/payments", true]]);
  const gate = marked.inner.gates.find((g) => g.entrances.includes("p->q"))!;
  assert.deepEqual([plates[0]!.x, plates[0]!.z], [gate.at.x + centre.x, gate.at.z + centre.z], "at its gate into q");
  assert.deepEqual(reachPlates(plain.layout, plain.inner, {}), []);
});
