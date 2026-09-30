/**
 * Capability 3 · Story node render (the forest story): each capability's territory on its story's
 * island (ADR-0804 D2, D3). An island is cut into cells; each capability holds one connected run of
 * them, its area following its lines of code, with a border where two territories meet.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { territories, territoryAt } from "./territories.js";

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
