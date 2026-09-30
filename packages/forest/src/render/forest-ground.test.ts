/**
 * The one join between 0.3's forest and 0.2's drawing engine (the forest story, capability 3):
 * 0.3 places each story node on its spiral (P1) and grows its grove (G1); 0.2's engine draws the
 * ground, coast and kit trees from islands it is handed. These tests hold what the join decides:
 * where each island's ground lands, that every capability gets its own parcel of it, and which of
 * 0.2's statuses each of 0.3's four tree forms is drawn as.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { workStates } from "@storytree/arc-surface";
import type { NewLine } from "@storytree/agent-link";
import { forestDescriptors, GROUND_PER_PLACE, GROUND_PER_WORLD_UNIT, islandAt, islandReach, statusOf, type Descriptor3D, type InstanceDescriptor } from "@storytree/forest-world";
import type { AnnotatedCapability, AnnotatedStory, Change } from "@storytree/library";

import { capabilityFactsFrom, parcelCellsFrom, stateForm } from "@storytree/forest-world/geometry";

import { forestScene, PLACE_WIDTH, type ForestScene } from "../index.js";

const NO_HEALTH = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };

/** A project of `sizes.length` stories, story i holding sizes[i] capabilities, as the app hands it to the page. */
function scene(sizes: number[], lines: NewLine[] = [], contracts = 0): ForestScene {
  const stories = sizes.map((size, s): AnnotatedStory => ({
    id: `story_${s}`,
    title: `Story ${s}`,
    health: NO_HEALTH,
    capabilities: Array.from({ length: size }, (_, c): AnnotatedCapability => ({
      id: `cap_${s}_${c}`,
      title: `Cap ${s}.${c}`,
      dependsOn: [], proposed: true, status: "proposed" as const, 
      contracts: Array.from({ length: contracts }, (_, k) => ({ id: `con_${s}_${c}_${k}`, title: `Contract ${k}`, health: NO_HEALTH })),
      health: NO_HEALTH,
    })),
  }));
  const history = stories.map(({ id, title }, index): Change => {
    const at = new Date(Date.UTC(2026, 8, 27, 12, 0, index)).toISOString();
    return { seq: index + 1, recordId: id, type: "story", action: "created", record: { id, type: "story", version: 1, fields: { title }, createdAt: at, updatedAt: at } };
  });
  const log = lines.map((line, index) => ({ ...line, seq: index + 1, project: "shop", at: new Date(0).toISOString() }));
  return forestScene({ stories, arcs: [] }, history, workStates(log));
}

const ground = (descriptors: Descriptor3D[], island: string): InstanceDescriptor[] =>
  descriptors.filter((d): d is InstanceDescriptor => d.kind === "cell-ground" && d.island === island);

function extent(cells: InstanceDescriptor[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const points = cells.flatMap((cell) => cell.points ?? []);
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  };
}

test("each of 0.3's four tree forms is drawn as one of 0.2's statuses: a seedling and a pale tree are tinted pines, a green tree the kit's own pine, a dead tree a bare trunk", () => {
  assert.deepEqual(
    (["seedling", "pale", "green", "dead"] as const).map((form) => [form, statusOf(form), stateForm(statusOf(form))]),
    [
      ["seedling", "building", { role: "tree", tint: "building" }],
      ["pale", "mapped", { role: "tree", tint: "mapped" }],
      ["green", "healthy", { role: "tree", tint: null }],
      ["dead", "unhealthy", { role: "deadTree", tint: null }],
    ],
  );
});

test("every story node's ground is drawn at its place on the spiral, one parcel per capability, each wearing its tree's form", () => {
  const forest = scene([3, 2], [{ kind: "landed", session: "s1", source: "tool", capability: "cap_0_1" }]);
  const descriptors = forestDescriptors(forest);
  const scale = GROUND_PER_PLACE / PLACE_WIDTH;
  for (const island of forest.islands) {
    const cells = ground(descriptors, island.story);
    assert.ok(cells.length > 0, `${island.story} has ground`);
    const { minX, maxX, minZ, maxZ } = extent(cells);
    assert.ok(Math.abs((minX + maxX) / 2 - island.x * scale) < GROUND_PER_PLACE * 0.15, `${island.story} is centred on its place in x`);
    assert.ok(Math.abs((minZ + maxZ) / 2 - island.z * scale) < GROUND_PER_PLACE * 0.15, `${island.story} is centred on its place in z`);
    const facts = capabilityFactsFrom(parcelCellsFrom(cells));
    assert.deepEqual(
      facts.map(({ capId, status }) => [capId, status]).sort(),
      island.trees.map(({ capability, form }) => [capability, statusOf(form)]).sort(),
    );
  }
});

test("a story with no capabilities yet still gets ground and its one seedling", () => {
  const forest = scene([0]);
  const cells = ground(forestDescriptors(forest), "story_0");
  assert.ok(cells.length > 0);
  assert.deepEqual(capabilityFactsFrom(parcelCellsFrom(cells)).map(({ status }) => status), ["building"]);
});

test("neighbouring story nodes never overlap, even when every story is large", () => {
  const forest = scene(Array.from({ length: 12 }, () => 12));
  const descriptors = forestDescriptors(forest);
  const centres = new Map(forest.islands.map((island) => [island.story, { x: island.x * GROUND_PER_WORLD_UNIT, z: island.z * GROUND_PER_WORLD_UNIT }]));
  const reach = islandReach(descriptors, centres);
  for (const [i, a] of forest.islands.entries()) {
    assert.ok((reach.get(a.story) ?? 0) > 0, `${a.story} has ground`);
    for (const b of forest.islands.slice(i + 1)) {
      const apart = Math.hypot(centres.get(a.story)!.x - centres.get(b.story)!.x, centres.get(a.story)!.z - centres.get(b.story)!.z);
      assert.ok(apart > reach.get(a.story)! + reach.get(b.story)!, `${a.story} and ${b.story} overlap`);
    }
  }
});

test("a capability landing changes only its own story node's ground, so only that island is redrawn", () => {
  const before = forestDescriptors(scene([2, 2]));
  const after = forestDescriptors(scene([2, 2], [{ kind: "landed", session: "s1", source: "tool", capability: "cap_1_0" }]));
  assert.deepEqual(ground(after, "story_0"), ground(before, "story_0"), "story_0's ground is untouched");
  assert.notDeepEqual(ground(after, "story_1"), ground(before, "story_1"), "story_1's ground shows the landing");
});

test("a click on the ground picks the story node whose land is under it, and open sea picks none", () => {
  const forest = scene([3, 1]);
  const descriptors = forestDescriptors(forest);
  for (const island of forest.islands) {
    assert.equal(islandAt(descriptors, island.x * GROUND_PER_WORLD_UNIT, island.z * GROUND_PER_WORLD_UNIT), island.story);
  }
  const [first] = forest.islands;
  assert.equal(islandAt(descriptors, first!.x * GROUND_PER_WORLD_UNIT + GROUND_PER_PLACE * 0.45, first!.z * GROUND_PER_WORLD_UNIT), undefined, "the sea between places");
});

test("a capability's contracts grow ground cover on its parcel, as 0.2's test counts did, and a capability with none grows none", () => {
  const cover = (contracts: number): string[] =>
    forestDescriptors(scene([2], [], contracts)).flatMap((d) => (d.kind === "coverage-flora" && "capability" in d ? [d.capability] : []));
  assert.deepEqual([...new Set(cover(4))].sort(), ["cap_0_0", "cap_0_1"]);
  assert.deepEqual(cover(0), []);
});
