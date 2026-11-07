/**
 * Capability 3 · Story node render: the selected island's relief (ADR-1236 D1, rollout 2 step 3b): every territory a
 * plateau above the open land, walls and rims round it, a ramp only where a road climbs from the open land, and the
 * gate posts standing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, Mesh, Vector3 } from "three";

import { islandRelief, LIGHT } from "../territories/island-relief.js";
import { islandRoads } from "../territories/island-roads.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import type { Coast, Point } from "../territories/territories.js";
import { presentTerritories } from "./globe-surfaces.js";
import { islandReliefMarks } from "./island-relief.js";
import { islandRoadMarks, landColour, landFill, shade } from "./island-roads.js";
import { capabilityPlates } from "./nameplates.js";
import { territoryLand } from "./territory-land.js";

const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const shares = [{ capability: "a", title: "1 · Alpha", lines: 900 }, { capability: "b", title: "2 · Beta", lines: 700 }, { capability: "c", title: "3 · Gamma", lines: 500 }, { capability: "d", title: "4 · Delta", lines: 300 }];
const links = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "c", to: "a" }, { from: "d", to: "c" }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->a", "z2->b"] }];
const map = linkLayout(shares, coast, links, docks);
const roads = islandRoads(map, links, docks, capabilityPlates(map));
const relief = islandRelief(map, roads);
const flat = (p: Point) => new Vector3(p.x, 0, p.z);
const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const toSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const at = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, z: p.z + d.z * k });
/** The territory whose cell outline holds `p` (-1 open land), read from the outlines, not the sites. */
const territoryOf = (p: Point) => map.cells.find((c) => c.polygon.every((a, i) => { const b = c.polygon[(i + 1) % c.polygon.length]!; return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= -1e-9; }))?.territory;
const open = map.cells.filter((c) => c.territory < 0);

test("3.78 every territory on the selected island stands one plateau's height above its open land, all at one height", () => {
  assert.ok(open.length > 0 && relief.height > 0);
  for (const cell of map.cells) {
    if (cell.territory >= 0) assert.equal(relief.raise(cell.site), relief.height, "a territory's land on the plateau");
    else if (relief.ramps.every((r) => far(r.at, cell.site) > relief.rampWidth + relief.rampDepth)) assert.equal(relief.raise(cell.site), 0, "open land stays low");
  }
  assert.equal(relief.raise({ x: R * 2, z: 0 }), 0, "nothing off the coast");
});

test("3.78 a ramp only where a road climbs from the open land onto a territory, at a gate or open road, sloping from the plateau's edge down to the open land", () => {
  const crossings = [...roads.gates, ...roads.passes];
  const onto = crossings.filter((g) => { const n = { x: -g.along.z, z: g.along.x }; const sides = [territoryOf(at(g.at, n, 0.8)), territoryOf(at(g.at, n, -0.8))]; return sides.includes(-1) && sides.some((t) => t !== undefined && t >= 0); });
  assert.ok(onto.length > 0 && onto.length < crossings.length, "some crossings between territories, some onto the open land");
  assert.equal(relief.ramps.length, onto.length, "a ramp wherever a road crosses onto the open land, and nowhere else");
  for (const g of roads.gates.filter((g) => onto.includes(g))) assert.equal(relief.ramps.filter((r) => r.gate === g).length, 1, "a gate onto the open land has its ramp, its posts beside it");
  for (const r of relief.ramps) {
    assert.ok(onto.some((c) => far(c.at, r.at) < 1e-9 && (r.gate === undefined || r.gate === c)));
    assert.equal(territoryOf(at(r.at, r.out, 0.8)), -1, "it runs out onto the open land");
    assert.equal(territoryOf(at(r.at, r.out, -0.8)), r.territory, "from its territory");
    const h = (k: number) => relief.raise(at(r.at, r.out, relief.rampDepth * k));
    assert.ok(Math.abs(h(0.01) - relief.height) < relief.height * 0.05 && Math.abs(h(0.5) - relief.height / 2) < 1e-9 && h(1.01) === 0, "a slope from the plateau's edge to the open land");
  }
});

test("3.78 open road onto the open land climbs a ramp with no gate; a road in a tunnel climbs none, a low rise standing over it from mouth to mouth (ADR-1253 D3, question_921aee319481)", () => {
  // Six capabilities where the arrivals climb onto a by open road, and b's road to e goes under a third territory.
  const sixShares = ["a", "b", "c", "d", "e", "f"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability.toUpperCase()}`, lines: 900 - 120 * i }));
  const sixLinks = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "a", to: "b" }, { from: "c", to: "a" }, { from: "b", to: "e" }, { from: "a", to: "f" },
  { from: "e", to: "c" }, { from: "b", to: "a" }, { from: "c", to: "e" }];
  const six = linkLayout(sixShares, coast, sixLinks, docks), sixRoads = islandRoads(six, sixLinks, docks, capabilityPlates(six)), sixRelief = islandRelief(six, sixRoads);
  const gateless = sixRelief.ramps.filter((r) => r.gate === undefined);
  assert.ok(gateless.length > 0 && gateless.every((r) => sixRoads.passes.some((p) => far(p.at, r.at) < 1e-9)), "a ramp at open road");
  assert.ok(sixRoads.portals.length > 0 && sixRoads.tunnels.length > 0);
  const H = sixRelief.height, { height: rise, halfWidth } = sixRelief.rise;
  for (const p of sixRoads.portals) {
    assert.ok(sixRelief.ramps.every((r) => far(r.at, p.at) > 1e-6), "no ramp at a portal's mouth");
    assert.ok(sixRelief.rims.every((r) => toSegment(p.border, r.from, r.to) > 1e-6), "the rim broken where its road crosses onto the land it goes under");
  }
  const way = (q: Point) => Math.min(...sixRoads.tunnels.flatMap((t) => t.pts.slice(1).map((b, i) => toSegment(q, t.pts[i]!, b))));
  for (const t of sixRoads.tunnels) for (let i = 1; i < t.pts.length; i++) {
    const a = t.pts[i - 1]!, b = t.pts[i]!, mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, l = far(a, b) || 1, n = { x: -(b.z - a.z) / l, z: (b.x - a.x) / l };
    if (far(mid, t.pts[0]!) < halfWidth || far(mid, t.pts.at(-1)!) < halfWidth) continue;
    assert.ok(sixRelief.raise(mid) > H + rise * 0.4 && sixRelief.raise(mid) <= H + rise + 1e-9, "the rise over the tunnel, at most its height");
    for (const side of [1, -1]) {
      const beside = at(mid, n, side * halfWidth * 1.05);
      if (way(beside) > halfWidth && territoryOf(beside) !== undefined && territoryOf(beside)! >= 0) assert.equal(sixRelief.raise(beside), H, "and none beside it: a small footprint");
    }
  }
  assert.ok(rise > 0 && rise < H && halfWidth < 3, "low, and narrow");
  // Each end hipped down to its mouth: no rise at the mouth, most of it a little way in along the tunnel.
  const walk = (pts: readonly Point[], d: number): Point => {
    for (let i = 1; i < pts.length; i++) { const l = far(pts[i - 1]!, pts[i]!); if (d <= l) return at(pts[i - 1]!, { x: (pts[i]!.x - pts[i - 1]!.x) / l, z: (pts[i]!.z - pts[i - 1]!.z) / l }, d); d -= l; }
    return pts.at(-1)!;
  };
  for (const t of sixRoads.tunnels) for (const way of [t.pts, [...t.pts].reverse()]) {
    assert.ok(Math.abs(sixRelief.raise(way[0]!) - H) < 1e-9, "the rise starts at the mouth");
    assert.ok(sixRelief.raise(walk(way, sixRelief.rise.inset)) > H + rise * 0.5, "and climbs from it to most of its height within its inset");
  }
});

test("3.78 a tunnel too short for a rise along it stands under a flat-topped knoll, reaching past both its mouths and no wider than a rise (question_921aee319481)", () => {
  // The six capabilities' tunnel cut down to a short way under the middle of its land, a mouth at each end.
  const sixShares = ["a", "b", "c", "d", "e", "f"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability.toUpperCase()}`, lines: 900 - 120 * i }));
  const sixLinks = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "a", to: "b" }, { from: "c", to: "a" }, { from: "b", to: "e" }, { from: "a", to: "f" },
  { from: "e", to: "c" }, { from: "b", to: "a" }, { from: "c", to: "e" }];
  const six = linkLayout(sixShares, coast, sixLinks, docks), sixRoads = islandRoads(six, sixLinks, docks, capabilityPlates(six));
  const long = sixRoads.tunnels[0]!, mid = long.pts[Math.floor(long.pts.length / 2)]!, d = { x: long.pts.at(-1)!.x - long.pts[0]!.x, z: long.pts.at(-1)!.z - long.pts[0]!.z }, l = Math.hypot(d.x, d.z);
  const along = { x: d.x / l, z: d.z / l }, ends = [at(mid, along, -1.5), at(mid, along, 1.5)] as const;
  const short = { ...sixRoads, tunnels: [{ pts: [ends[0], mid, ends[1]], links: long.links }], portals: ends.map((m) => ({ ...sixRoads.portals[0]!, at: m })) };
  const relief = islandRelief(six, short), H = relief.height;
  assert.ok(Math.abs(relief.raise(mid) - (H + relief.rise.height)) < 1e-9, "its top at the rise's height");
  for (const [k, m] of ends.entries()) {
    assert.ok(relief.raise(m) > H, "its mouth in the knoll's flank");
    const beyond = at(m, along, k === 0 ? -0.3 : 0.3);
    if (territoryOf(beyond) !== undefined && territoryOf(beyond)! >= 0) assert.ok(relief.raise(beyond) > H, "reaching past it");
  }
  const across = at(mid, { x: -along.z, z: along.x }, relief.rise.halfWidth * 1.05);
  if (territoryOf(across) !== undefined && territoryOf(across)! >= 0) assert.equal(relief.raise(across), H, "no wider than a rise");
});

test("3.78 a tunnel's rise drawn over it, shaded by the light: lighter on its side toward the light than away (question_921aee319481)", () => {
  const sixShares = ["a", "b", "c", "d", "e", "f"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability.toUpperCase()}`, lines: 900 - 120 * i }));
  const sixLinks = [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "a", to: "b" }, { from: "c", to: "a" }, { from: "b", to: "e" }, { from: "a", to: "f" },
  { from: "e", to: "c" }, { from: "b", to: "a" }, { from: "c", to: "e" }];
  const six = linkLayout(sixShares, coast, sixLinks, docks), sixRoads = islandRoads(six, sixLinks, docks, capabilityPlates(six)), sixRelief = islandRelief(six, sixRoads);
  const land = territoryLand(six, flat, coast, new Map(), sixRoads), marks = islandReliefMarks(sixRelief, flat, landFill(six, land));
  const rise = marks.getObjectByName("relief-rise") as Mesh;
  assert.ok(rise !== undefined, "the rise drawn");
  const pos = rise.geometry.getAttribute("position"), col = rise.geometry.getAttribute("color");
  const ys = Array.from({ length: pos.count }, (_, k) => pos.getY(k));
  assert.ok(Math.max(...ys) > sixRelief.height + sixRelief.rise.height * 0.4 && Math.max(...ys) <= sixRelief.height + sixRelief.rise.height + 0.05, "up to the rise's height over the plateau, just over it");
  // Each vertex's brightness against the land under it, by whether the slope there faces the light.
  const toward: number[] = [], away: number[] = [], fill = landFill(six, land), under = landColour(fill);
  for (let k = 0; k < pos.count; k++) {
    const q = { x: pos.getX(k), z: pos.getZ(k) }, e = 0.2, slope = { x: sixRelief.raise({ x: q.x + e, z: q.z }) - sixRelief.raise({ x: q.x - e, z: q.z }), z: sixRelief.raise({ x: q.x, z: q.z + e }) - sixRelief.raise({ x: q.x, z: q.z - e }) };
    if (Math.hypot(slope.x, slope.z) < 0.05) continue;
    const ground = under(q), here = new Color(col.getX(k), col.getY(k), col.getZ(k)), k2 = here.r + here.g + here.b - (ground.r + ground.g + ground.b);
    // Downhill toward the light faces it.
    ((-slope.x * LIGHT.x - slope.z * LIGHT.z) > 0 ? toward : away).push(k2);
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(toward.length > 0 && away.length > 0 && mean(toward) > 0 && mean(away) < 0, "lit toward the light, shaded away");
});

test("3.78 a wall wherever a plateau meets the open land or the coast, open at each ramp; a bevel rim inside each border on every territory's side, broken wherever a road crosses it", () => {
  assert.ok(relief.walls.some((w) => w.onto === "open") && relief.walls.some((w) => w.onto === "coast"));
  for (const w of relief.walls) {
    const mid = at({ x: (w.from.x + w.to.x) / 2, z: (w.from.z + w.to.z) / 2 }, w.out, 0.3);
    assert.equal(w.onto === "open" ? territoryOf(mid) : Math.hypot(mid.x, mid.z) > R - 0.5, w.onto === "open" ? -1 : true, "it faces off the plateau");
    for (const r of relief.ramps) assert.ok(toSegment(r.at, w.from, w.to) > 0.6 || [w.from, w.to].every((p) => far(p, r.at) >= relief.rampWidth / 2 - 1e-6), "no wall across a ramp");
  }
  const onto = map.borders.filter((b) => { const t = b.between.map((c) => map.cells[c]!.territory); return t.includes(-1) && t.some((x) => x >= 0); });
  assert.ok(onto.length > 0);
  for (const b of onto) {
    const mid = { x: (b.from.x + b.to.x) / 2, z: (b.from.z + b.to.z) / 2 };
    if (Math.hypot(mid.x, mid.z) > R - 1 || relief.ramps.some((r) => far(r.at, mid) < relief.rampWidth)) continue;
    assert.ok(relief.walls.some((w) => w.onto === "open" && toSegment(mid, w.from, w.to) < 1e-6), "a wall on every border between a territory and the open land");
  }
  assert.ok(relief.rims.length > 0);
  for (const rim of relief.rims) {
    assert.equal(territoryOf(at({ x: (rim.from.x + rim.to.x) / 2, z: (rim.from.z + rim.to.z) / 2 }, rim.into, 0.4)), rim.territory, "inside its territory");
    for (const g of [...roads.gates, ...roads.passes]) assert.ok(toSegment(g.at, rim.from, rim.to) > 0.6 || [rim.from, rim.to].every((p) => far(p, g.at) >= g.opening / 2 - 1e-6), "broken where a road crosses it");
  }
  const between = map.borders.filter((b) => map.cells[b.between[0]]!.territory >= 0 && map.cells[b.between[1]]!.territory >= 0);
  assert.ok(between.length > 0 && relief.rims.filter((r) => between.some((b) => toSegment(r.from, b.from, b.to) < 1e-6 && toSegment(r.to, b.from, b.to) < 1e-6)).length >= 2, "both sides of a border between territories");
});

test("3.78 the walls, ramps and rims are drawn, a face toward the light lighter than one turned away, and they show and hide with the territories", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandReliefMarks(relief, flat, landFill(map, land));
  const vertices = (name: string) => {
    const mesh = marks.getObjectByName(name) as Mesh, p = mesh.geometry.getAttribute("position"), c = mesh.geometry.getAttribute("color");
    return Array.from({ length: p.count }, (_, i) => ({ x: p.getX(i), y: p.getY(i), z: p.getZ(i), colour: new Color(c.getX(i), c.getY(i), c.getZ(i)) }));
  };
  const H = relief.height, near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  const walls = vertices("relief-walls");
  assert.ok(walls.every((v) => relief.walls.some((w) => toSegment(v, w.from, w.to) < 1e-4) && (near(v.y, H) || v.y < 0)), "each wall standing on its edge, from the open land up to the plateau");
  for (const w of relief.walls) assert.ok([w.from, w.to].every((e) => walls.some((v) => far(v, e) < 1e-4 && near(v.y, H)) && walls.some((v) => far(v, e) < 1e-4 && v.y < 0)), "every wall drawn");
  const slopes = vertices("relief-ramps");
  for (const r of relief.ramps) for (const s of [-1, 1]) {
    const top = at(r.at, r.along, s * relief.rampWidth / 2), foot = at(top, r.out, relief.rampDepth);
    assert.ok(slopes.some((v) => far(v, top) < 1e-4 && near(v.y, H)) && slopes.some((v) => far(v, foot) < 1e-4 && v.y < 0.05), "a slope from the plateau's edge down to the open land");
  }
  const rims = vertices("relief-rims");
  assert.ok(rims.every((v) => v.y > H && relief.rims.some((r) => toSegment(v, r.from, r.to) < 1e-4 || near(toSegment(v, at(r.from, r.into, relief.rimWidth * 0.45), at(r.to, r.into, relief.rimWidth * 0.45)), 0) || near(toSegment(v, at(r.from, r.into, relief.rimWidth), at(r.to, r.into, relief.rimWidth)), 0))), "each rim on the plateau, a band inside its border");
  // The shadows: on the open land, beside the walls that face away from the light, darker than the bare ground.
  const ground = new Color("#686d70"), shadows = vertices("relief-shadows"), shadowed = relief.walls.filter((w) => w.onto === "open" && w.out.x * LIGHT.x + w.out.z * LIGHT.z < 0);
  assert.ok(shadowed.length > 0 && shadows.length > 0);
  assert.ok(shadows.every((v) => near(v.y, 0.02) && shadowed.some((w) => toSegment(v, w.from, w.to) < 1.9 + 1e-4 && (v.x - w.from.x) * w.out.x + (v.z - w.from.z) * w.out.z > -1e-4)), "beside a wall turned from the light, on its open land's side");
  assert.ok(shadows.every((v) => v.colour.r <= ground.r + 1e-6) && shadows.some((v) => v.colour.r < ground.r - 0.02), "darker than the ground");
  const grey = new Color("#808080"), lit = shade(grey, LIGHT), away = shade(grey, { x: -LIGHT.x, z: -LIGHT.z });
  assert.ok(lit.r > away.r, "a face toward the light shows lighter");
  land.add(marks);
  presentTerritories(land, false);
  assert.equal(marks.visible, false);
  presentTerritories(land, "health");
  assert.equal(marks.visible, true);
});

test("3.78 the roads follow the relief, and every gate's posts stand up from the land, clear of its ramp", () => {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const marks = islandRoadMarks(roads, flat, landFill(map, land), relief);
  for (const road of marks.children.filter((o) => o.name.startsWith("road:")) as Mesh[]) {
    const p = road.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i += 7) {
      // Stored as 32-bit floats, so a point on a border may read from either side of it.
      const near = [[0, 0], [1e-4, 0], [-1e-4, 0], [0, 1e-4], [0, -1e-4]].map(([dx, dz]) => relief.raise({ x: p.getX(i) + dx!, z: p.getZ(i) + dz! }));
      assert.ok(near.some((h) => Math.abs(p.getY(i) - h) < 1e-4), "on the land under it");
    }
  }
  const posts = marks.children.filter((o) => o.name.startsWith("gate-post:")) as Mesh[];
  assert.equal(posts.length, roads.gates.length * 2);
  for (const post of posts) {
    const p = post.geometry.getAttribute("position"), ys = Array.from({ length: p.count }, (_, i) => p.getY(i));
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - post.userData.height) < 1e-5 && post.userData.height > 0, "standing its height");
    const [, gate, sign] = post.name.split(":"), g = roads.gates[Number(gate)]!, ramp = relief.ramps.find((r) => r.gate === g);
    const middle = { x: (Math.max(...Array.from({ length: p.count }, (_, i) => p.getX(i))) + Math.min(...Array.from({ length: p.count }, (_, i) => p.getX(i)))) / 2, z: (Math.max(...Array.from({ length: p.count }, (_, i) => p.getZ(i))) + Math.min(...Array.from({ length: p.count }, (_, i) => p.getZ(i)))) / 2 };
    if (ramp !== undefined) assert.ok(Math.abs((middle.x - g.at.x) * g.along.x + (middle.z - g.at.z) * g.along.z) > relief.rampWidth / 2, `post ${gate}:${sign} beside its ramp`);
    // Its shadow lies away from the light, darker than the land it falls on.
    const shadow = marks.getObjectByName(`gate-shadow:${gate}:${sign}`) as Mesh, s = shadow.geometry.getAttribute("position"), c = shadow.geometry.getAttribute("color");
    const centre = { x: Array.from({ length: s.count }, (_, i) => s.getX(i)).reduce((a, b) => a + b) / s.count, z: Array.from({ length: s.count }, (_, i) => s.getZ(i)).reduce((a, b) => a + b) / s.count };
    assert.ok((centre.x - middle.x) * LIGHT.x + (centre.z - middle.z) * LIGHT.z < 0, "its shadow away from the light");
    const land = landColour(landFill(map, territoryLand(map, flat, coast)))(centre);
    assert.ok(c.getX(0) < land.r && c.getY(0) < land.g, "a shadow darker than the land under it");
  }
  for (const post of posts) assert.equal(post.userData.height, relief.post.height, "every gate a pair's, its posts one height");
});

test("3.78 a road leaving a gate or open road onto the open land runs straight down its ramp to the ramp's foot, never across its side (Mick, 2026-11-07)", () => {
  // Islands whose roads leave their gates at an angle: the four and six above, and others laid out by other links.
  const islands = [{ shares, links }, ...[
    [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "a", to: "b" }, { from: "c", to: "a" }, { from: "b", to: "e" }, { from: "a", to: "f" }, { from: "e", to: "c" }, { from: "b", to: "a" }, { from: "c", to: "e" }],
    [{ from: "z1", to: "a" }, { from: "z2", to: "c" }, { from: "b", to: "a" }, { from: "d", to: "b" }, { from: "e", to: "d" }, { from: "f", to: "c" }],
    [{ from: "z1", to: "b" }, { from: "z2", to: "a" }, { from: "a", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "e" }, { from: "e", to: "f" }, { from: "f", to: "a" }],
  ].map((l) => ({ shares: ["a", "b", "c", "d", "e", "f"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability.toUpperCase()}`, lines: 900 - 120 * i })), links: l })),
  // And one whose open road climbs a ramp onto a plateau to a tunnel's mouth set back on it.
  { shares: ["a", "b", "c", "d", "e", "f", "g"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability}`, lines: 823 - 100 * i })),
    links: [{ from: "z1", to: "a" }, { from: "z2", to: "b" }, { from: "b", to: "a" }, { from: "c", to: "b" }, { from: "d", to: "c" }, { from: "e", to: "d" }, { from: "f", to: "b" }, { from: "g", to: "f" }] }];
  let ramps = 0;
  for (const island of islands) {
    const m = linkLayout(island.shares, coast, island.links, docks), r = islandRoads(m, island.links, docks, capabilityPlates(m)), rel = islandRelief(m, r);
    for (const ramp of rel.ramps) {
      // The road through the ramp's top, walked from there onto the ramp.
      const road = r.segments.find((s) => s.pts.some((p, i) => i > 0 && toSegment(ramp.at, s.pts[i - 1]!, p) < 1e-6))!;
      assert.ok(road !== undefined, "a road through every ramp");
      const i = road.pts.findIndex((p, k) => k > 0 && toSegment(ramp.at, road.pts[k - 1]!, p) < 1e-6);
      const w = (p: Point) => (p.x - ramp.at.x) * ramp.out.x + (p.z - ramp.at.z) * ramp.out.z;
      const down = w(road.pts[i]!) > w(road.pts[i - 1]!) ? [ramp.at, ...road.pts.slice(i)] : [ramp.at, ...road.pts.slice(0, i).reverse()];
      let walked = 0;
      for (let k = 1; k < down.length && walked < 3 * rel.rampDepth; k++) {
        const a = down[k - 1]!, b = down[k]!, l = far(a, b);
        for (let t = 0; t <= 1 && walked + t * l <= 3 * rel.rampDepth; t += 0.05) {
          const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, u = (p.x - ramp.at.x) * ramp.along.x + (p.z - ramp.at.z) * ramp.along.z, d = walked + t * l;
          if (d <= rel.rampDepth) assert.ok(Math.abs(u) <= rel.rampWidth / 2 - road.width / 2, `the road ${d.toFixed(2)} down the ramp at ${ramp.at.x.toFixed(1)},${ramp.at.z.toFixed(1)} stands ${u.toFixed(2)} off its middle`);
          // Past the foot it turns on the open land, never back up the ramp's side or under its wall.
          else if (w(p) < 3 * rel.rampDepth) assert.ok(w(p) >= rel.rampDepth - 1e-6 && rel.territoryAt(p) === -1, `the road ${d.toFixed(2)} from the ramp at ${ramp.at.x.toFixed(1)},${ramp.at.z.toFixed(1)} turns ${w(p).toFixed(2)} out from its top, on ${rel.territoryAt(p)}`);
        }
        walked += l;
      }
      ramps++;
    }
  }
  assert.ok(ramps > 4, "ramps enough to try");
});
