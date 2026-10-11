/**
 * Capability 3 · Story node render: a lit link's way inland, from its dock along the borders drawn between an
 * island's territories to its capability's territory (ADR-0991 D4).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { territories, territoryAt, type Point } from "../territories/territories.js";
import { borderRoute } from "./border-route.js";

// A square island 20 across with a bay cut into its east side, its land shared by four territories.
const coast = [[{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: -3 }, { x: 0, z: -3 }, { x: 0, z: 3 }, { x: 10, z: 3 }, { x: 10, z: 10 }, { x: -10, z: 10 }]];
const map = territories([{ capability: "cap-a", lines: 400 }, { capability: "cap-b", lines: 300 }, { capability: "cap-c", lines: 200 }, { lines: 100 }], coast);

const toSegment = (p: Point, a: Point, b: Point) => {
  const [dx, dz] = [b.x - a.x, b.z - a.z];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const onCoast = (p: Point) => Math.min(...coast[0]!.map((a, i) => toSegment(p, a, coast[0]![(i + 1) % coast[0]!.length]!))) < 1e-6;
const onBorder = (p: Point) => Math.min(...map.borders.map(({ from, to }) => toSegment(p, from, to))) < 1e-6;
/** The coast all the way round, sampled finely: the docks a road may land on. */
const docks = coast[0]!.flatMap((a, i) => {
  const b = coast[0]![(i + 1) % coast[0]!.length]!;
  return Array.from({ length: 10 }, (_, k): Point => ({ x: a.x + (b.x - a.x) * k / 10, z: a.z + (b.z - a.z) * k / 10 }));
});
/** The territory whose drawn cell outline holds the land a hair inland of `p`. */
const territoryOf = (p: Point) => {
  const at = [[0.02, 0.02], [-0.02, 0.02], [0.02, -0.02], [-0.02, -0.02]].map(([dx, dz]) => ({ x: p.x + dx!, z: p.z + dz! }))
    .find((q) => territoryAt(map, q.x, q.z) !== undefined)!;
  const inside = (polygon: readonly Point[]) => {
    let odd = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [a, b] = [polygon[i]!, polygon[j]!];
      if ((a.z > at.z) !== (b.z > at.z) && at.x < ((b.x - a.x) * (at.z - a.z)) / (b.z - a.z) + a.x) odd = !odd;
    }
    return odd;
  };
  const cell = map.cells.find((one) => inside(one.polygon));
  return cell === undefined ? undefined : map.territories[cell.territory]!.capability;
};

test("3.7 a lit link's way inland runs from its dock only along drawn lines, the territories' borders and the coast between them, and enters its capability's territory along that territory's own border", () => {
  let inland = 0;
  for (const dock of docks) for (const capability of ["cap-a", "cap-b", "cap-c"]) {
    const route = borderRoute(map, capability, dock);
    assert.ok(route !== undefined && route.length >= 1, `a way from ${JSON.stringify(dock)} to ${capability}`);
    assert.deepEqual(route[0], dock, "it starts on the dock");
    if (territoryOf(dock) === capability) {
      assert.equal(route.length, 1, "a dock already on its capability's territory needs nothing more");
      continue;
    }
    inland++;
    // Every stretch lies on a drawn line, a border or the coast, never across land or sea.
    route.slice(1).forEach((p, i) => {
      const a = route[i]!, middle = { x: (a.x + p.x) / 2, z: (a.z + p.z) / 2 };
      assert.ok(onBorder(middle) || onCoast(middle), `stretch ${i} to ${capability} follows a border or the coast`);
      assert.ok(territoryAt(map, middle.x, middle.z) !== undefined || onCoast(middle), "it stays on the land");
    });
    // It enters its capability's territory along that territory's own border.
    const [a, b] = route.slice(-2), last = { x: (a!.x + b!.x) / 2, z: (a!.z + b!.z) / 2 };
    const along = map.borders.filter(({ from, to }) => toSegment(last, from, to) < 1e-6)
      .flatMap(({ between }) => between.map((cell) => map.territories[map.cells[cell]!.territory]!.capability));
    assert.ok(along.includes(capability), `its last stretch runs along a border of ${capability}`);
  }
  assert.ok(inland > docks.length, "most ways go inland");
  assert.equal(borderRoute(map, "cap-z", docks[0]!), undefined, "a capability with no territory here has no way inland");
});
