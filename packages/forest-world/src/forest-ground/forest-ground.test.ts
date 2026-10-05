import assert from "node:assert/strict";
import { test } from "node:test";

import type { ForestScene, PlacedTree, TreeForm } from "../scene.js";
import { forestDescriptors } from "./forest-ground.js";

const tree = (capability: string | undefined, form: TreeForm): PlacedTree => ({ capability, form, contracts: 0 });

const forest = (): ForestScene => ({
  islands: [
    { story: "story_a", title: "A", x: 0, z: 0, key: "a", trees: [tree("cap_a1", "green"), tree("cap_a2", "dead"), tree("cap_a3", "seedling")] },
    { story: "story_b", title: "B", x: 40, z: 10, key: "b", trees: [tree(undefined, "seedling")] },
    { story: "story_c", title: "C", x: -30, z: 25, key: "c", trees: [], area: 9000 },
  ],
});

test("1.1 the same forest always builds byte-identical ground", () => {
  assert.equal(JSON.stringify(forestDescriptors(forest())), JSON.stringify(forestDescriptors(forest())));
});

test("1.3 every ground cell names its island, and a capability's cells name its parcel and wear its status", () => {
  const cells = forestDescriptors(forest());
  assert.ok(cells.every((cell) => cell.kind === "cell-ground" && cell.points!.length >= 3));
  const parcels = new Map<string | undefined, Set<string | undefined>>();
  for (const cell of cells) parcels.set(cell.parcel, (parcels.get(cell.parcel) ?? new Set()).add(`${cell.island} ${cell.material}`));
  assert.deepEqual(Object.fromEntries([...parcels].map(([parcel, owners]) => [String(parcel), [...owners]])), {
    cap_a1: ["story_a healthy"],
    cap_a2: ["story_a unhealthy"],
    cap_a3: ["story_a building"],
    "story_b#seedling": ["story_b building"],
    undefined: ["story_c building"],
  });
});
