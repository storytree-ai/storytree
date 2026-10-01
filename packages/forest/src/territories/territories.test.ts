/**
 * Capability 3 · Story node render (the forest story): each capability's territory on its story's
 * island (ADR-0804 D2, D3). An island is cut into cells; each capability holds one connected run of
 * them, its area following its lines of code, with a border where two territories meet.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { circleDiameter, fileCircles, territories, territoryAt, type CircleFile } from "./territories.js";

const shares = [
  { capability: "cap-a", lines: 600 },
  { capability: "cap-b", lines: 250 },
  { capability: "cap-c", lines: 100 },
  { lines: 50 },
];
const map = territories(shares, 10);
const area = (polygon: readonly { x: number; z: number }[]) =>
  Math.abs(polygon.reduce((sum, p, at) => { const q = polygon[(at + 1) % polygon.length]!; return sum + p.x * q.z - q.x * p.z; }, 0)) / 2;

test("3.14 each capability is one connected territory whose share of the island follows its share of the lines, Unclaimed code its own, bordered where two territories meet", () => {
  assert.deepEqual(map.territories.map(({ capability }) => capability), ["cap-a", "cap-b", "cap-c", undefined]);
  const total = map.cells.reduce((sum, cell) => sum + area(cell.polygon), 0);
  map.territories.forEach((territory, at) => {
    const cells = map.cells.filter((cell) => cell.territory === at);
    const share = cells.reduce((sum, cell) => sum + area(cell.polygon), 0) / total;
    const wanted = shares[at]!.lines / 1000;
    assert.ok(Math.abs(share - wanted) <= wanted * 0.1, `${territory.capability ?? "Unclaimed"} holds ${share.toFixed(3)} of the island, wanted ${wanted}`);
    // One connected run: every cell of the territory is reached from its first across shared edges.
    const reached = new Set([cells[0]!.index]);
    for (let grew = true; grew;) {
      grew = false;
      for (const cell of cells) if (!reached.has(cell.index) && cell.neighbours.some((n) => reached.has(n))) { reached.add(cell.index); grew = true; }
    }
    assert.equal(reached.size, cells.length, `${territory.capability ?? "Unclaimed"} is in one piece`);
  });
  assert.ok(map.borders.length > 0);
  for (const border of map.borders) {
    const [one, other] = [map.cells[border.between[0]]!, map.cells[border.between[1]]!];
    assert.notEqual(one.territory, other.territory);
    const middle = { x: (border.from.x + border.to.x) / 2, z: (border.from.z + border.to.z) / 2 };
    const distance = (cell: typeof one) => Math.hypot(middle.x - cell.site.x, middle.z - cell.site.z);
    assert.ok(Math.abs(distance(one) - distance(other)) < 1e-6, "a border lies exactly between its two cells");
  }
});

test("3.15 a point on a territory's land picks that capability; open sea picks none", () => {
  for (const cell of map.cells) assert.equal(territoryAt(map, cell.site.x, cell.site.z), map.territories[cell.territory]);
  assert.equal(territoryAt(map, 30, 0), undefined);
});

test("3.16 every file is one circle whose middle lies on its capability's territory, a longer file never drawn smaller", () => {
  const files: CircleFile[] = [
    ...Array.from({ length: 9 }, (_, at) => ({ path: `src/a/${at}.ts`, lines: 20 + at * 60, capability: "cap-a" })),
    ...Array.from({ length: 4 }, (_, at) => ({ path: `src/b/${at}.ts`, lines: 40 + at * 20, capability: "cap-b" })),
    { path: "src/c/only.ts", lines: 100, capability: "cap-c" },
    { path: "src/bins/run.ts", lines: 50 },
  ];
  const circles = fileCircles(map, files);
  assert.deepEqual(circles.map(({ path }) => path), files.map(({ path }) => path));
  for (const circle of circles) {
    const file = files.find(({ path }) => path === circle.path)!;
    assert.equal(territoryAt(map, circle.x, circle.z)?.capability, file.capability, `${circle.path} lies on its own territory`);
  }
  const bySize = [...circles].sort((a, b) => files.find(({ path }) => path === a.path)!.lines - files.find(({ path }) => path === b.path)!.lines);
  bySize.slice(1).forEach((circle, at) => assert.ok(circle.radius >= bySize[at]!.radius));
});

test("3.14 and 3.16 cut to a real coast, every territory's cells and every file's circle lie on the land, the areas following the lines", () => {
  // A C-shaped island: a square 20 across with a bay cut into its east side.
  const coast = [[{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: -3 }, { x: 0, z: -3 }, { x: 0, z: 3 }, { x: 10, z: 3 }, { x: 10, z: 10 }, { x: -10, z: 10 }]];
  const onLand = (x: number, z: number) => Math.abs(x) <= 10 && Math.abs(z) <= 10 && !(x > 0 && Math.abs(z) < 3);
  const cut = territories(shares, coast);
  for (const cell of cut.cells) assert.ok(onLand(cell.site.x, cell.site.z), "every cell is on the land");
  cut.territories.forEach((_, at) => {
    const share = cut.cells.filter((cell) => cell.territory === at).length / cut.cells.length;
    assert.ok(Math.abs(share - shares[at]!.lines / 1000) <= 0.02, "cells follow the lines");
  });
  assert.equal(territoryAt(cut, 5, 0), undefined, "the bay is sea");
  const files = [{ path: "a.ts", lines: 400, capability: "cap-a" }, { path: "b.ts", lines: 90, capability: "cap-b" }, { path: "u.ts", lines: 30 }];
  for (const circle of fileCircles(cut, files)) assert.ok(onLand(circle.x, circle.z), `${circle.path} is on the land`);
});

/** How far `p` lies inside its own territory: its distance to the nearest border of that territory or the coast (negative off it). */
function clearance(cut: ReturnType<typeof territories>, p: { x: number; z: number }, coastSegments: readonly (readonly [{ x: number; z: number }, { x: number; z: number }])[]): number {
  const toSegment = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const [dx, dz] = [b.x - a.x, b.z - a.z];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
  };
  return Math.min(...cut.borders.map(({ from, to }) => toSegment(from, to)), ...coastSegments.map(([a, b]) => toSegment(a, b)));
}

test("3.16 every circle lies wholly inside its own territory and on the land, and no two circles overlap or stack", () => {
  // A crowded C-shaped island: more files than its territories had spots before, of mixed sizes.
  const coast = [[{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: -3 }, { x: 0, z: -3 }, { x: 0, z: 3 }, { x: 10, z: 3 }, { x: 10, z: 10 }, { x: -10, z: 10 }]];
  const ring = coast[0]!;
  const segments = ring.map((a, at) => [a, ring[(at + 1) % ring.length]!] as const);
  const cut = territories(shares, coast);
  const files: CircleFile[] = [
    ...Array.from({ length: 30 }, (_, at) => ({ path: `src/a/${at}.ts`, lines: 5 + ((at * 37) % 200), capability: "cap-a" })),
    ...Array.from({ length: 12 }, (_, at) => ({ path: `src/b/${at}.ts`, lines: 3 + ((at * 53) % 120), capability: "cap-b" })),
    ...Array.from({ length: 6 }, (_, at) => ({ path: `src/c/${at}.ts`, lines: 10 + at * 15, capability: "cap-c" })),
    ...Array.from({ length: 4 }, (_, at) => ({ path: `src/bins/${at}.ts`, lines: 8 + at * 4 })),
  ];
  const circles = fileCircles(cut, files);
  assert.equal(circles.length, files.length, "every file is one circle");
  for (const circle of circles) {
    const file = files.find(({ path }) => path === circle.path)!;
    assert.equal(territoryAt(cut, circle.x, circle.z)?.capability, file.capability, `${circle.path} lies on its own territory`);
    assert.ok(clearance(cut, circle, segments) >= circle.radius - 1e-9, `${circle.path} lies wholly inside its territory (clearance ${clearance(cut, circle, segments).toFixed(2)}, radius ${circle.radius.toFixed(2)})`);
  }
  for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) {
    const [a, b] = [circles[i]!, circles[j]!];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= a.radius + b.radius, `${a.path} and ${b.path} do not overlap`);
  }
});

test("3.16 a circle grows gently with its file's lines: a 1,000-line file is under six units across, under five times a one-line file (the old curve: 8.8 across, 5.7 times)", () => {
  assert.ok(circleDiameter(1000) < 6);
  assert.ok(circleDiameter(1000) < 5 * circleDiameter(1));
  assert.ok(circleDiameter(101) > circleDiameter(100));
});
