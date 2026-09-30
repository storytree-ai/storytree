/**
 * Capability 3 · Story node render (the forest story): the plan the page draws the 3D forest from.
 * The page itself (apps/desktop) only turns this plan into meshes, so everything the forest decides
 * about what is drawn where is here, and tested without a browser.
 *
 * - Every story node is an island at its place (capability 1), in world units, carrying its grove
 *   (capability 2): one tree per capability, set out from the island's middle in build order.
 * - Each island is named with its story's title (the label the page keeps facing the camera).
 * - What the page drew is said as the smoke check reads it (ADR-0634 D2), with each tree's form.
 * - An island's key changes only when something drawn on it changes, so a change redraws only the
 *   islands it touched, without a reload.
 * - A click is turned into a point on the ground, and the island under it is the one selected.
 */
import type { WorkStates } from "@storytree/arc-surface";
import { PLACE_WIDTH, type ForestScene, type Island, type PlacedTree, type TreeForm } from "@storytree/forest-world/scene";
import type { AnnotatedTree, Change } from "@storytree/library";

import { grove } from "../capability-tree/capability-tree.js";
import type { StorySurvey } from "../code-survey/code-survey.js";
import { fileCircles, territories } from "../territories/territories.js";
import { storyNodes } from "../story-nodes/story-nodes.js";

export { PLACE_WIDTH };
export type { ForestScene, Island, PlacedTree };

/** The largest an island grows, so it always fits its place. */
const MAX_RADIUS = PLACE_WIDTH * 0.42;
/** How far apart trees stand on an island. */
const TREE_SPACING = 1.9;

/** What the forest says it drew: the smoke check's fields (ADR-0634 D2), with the forest's own added. */
export interface ForestDrawn {
  surface: "forest";
  stories: string[];
  capabilities: string[];
  /** The story names on show, one per island. */
  labels: string[];
  /** Every tree, with its form. */
  trees: { capability: string | undefined; form: TreeForm }[];
}

/** How tall each form stands: a seedling is small, every landed tree full size. */
const HEIGHT: Readonly<Record<TreeForm, number>> = { seedling: 0.5, pale: 1, green: 1, dead: 0.9 };

/**
 * The forest for a project: `tree` is its projectTree(), `history` its changesSince(0) changes, and
 * `states` the arc surface's work states over its agent activity log, and `survey` its code's survey by
 * story (capability 8): a surveyed story's island is cut into its capabilities' territories.
 */
export function forestScene(tree: AnnotatedTree, history: readonly Change[], states: WorkStates, survey: Readonly<Record<string, StorySurvey>> = {}): ForestScene {
  const nodes = new Map(storyNodes(tree, history).map((node) => [node.id, node]));
  const islands = tree.stories.map((story): Island => {
    const node = nodes.get(story.id);
    const trees = grove(story, states);
    const spots = sunflower(trees.length);
    const reach = Math.max(...spots.map(({ r }) => r));
    const radius = Math.min(MAX_RADIUS, reach + 2.4);
    const squeeze = reach + 2.4 > MAX_RADIUS ? (MAX_RADIUS - 2.4) / reach : 1;
    const x = (node?.at.x ?? 0) * PLACE_WIDTH;
    const z = (node?.at.y ?? 0) * PLACE_WIDTH;
    const contractsOf = new Map(story.capabilities.map(({ id, contracts }) => [id, contracts.length]));
    const placed = trees.map(({ capability, form }, index): PlacedTree => {
      const spot = spots[index] ?? { r: 0, angle: 0 };
      return {
        capability,
        form,
        contracts: capability === undefined ? 0 : (contractsOf.get(capability) ?? 0),
        x: x + Math.cos(spot.angle) * spot.r * squeeze,
        z: z + Math.sin(spot.angle) * spot.r * squeeze,
        scale: HEIGHT[form],
        turn: (index * 2.39996) % (2 * Math.PI),
      };
    });
    const land = landOf(story.capabilities, survey[story.id], radius);
    const key = JSON.stringify([story.title, x, z, placed.map(({ capability, form, contracts }) => [capability, form, contracts]), land?.territories]);
    return { story: story.id, title: story.title, x, z, radius, trees: placed, ...(land === undefined ? {} : { land }), key };
  });
  const links = tree.stories.flatMap(story => story.capabilities.flatMap(capability =>
    capability.dependsOn.map(to => ({ from: capability.id, to }))));
  return { islands, links };
}

/** The stories whose islands differ between two scenes: redrawn, added or gone, in `after`'s order then `before`'s. */
export function changedIslands(before: ForestScene, after: ForestScene): string[] {
  const was = new Map(before.islands.map((island) => [island.story, island.key]));
  const now = new Set(after.islands.map(({ story }) => story));
  return [
    ...after.islands.filter(({ story, key }) => was.get(story) !== key).map(({ story }) => story),
    ...before.islands.filter(({ story }) => !now.has(story)).map(({ story }) => story),
  ];
}

/** The story whose island is under the ground point (x, z), or undefined over open sea. */
export function storyAt(scene: ForestScene, x: number, z: number): string | undefined {
  return scene.islands.find((island) => Math.hypot(x - island.x, z - island.z) <= island.radius)?.story;
}

/** What the page says it drew, once it has drawn `scene`. */
export function forestDrawn(scene: ForestScene): ForestDrawn {
  const trees = scene.islands.flatMap((island) => island.trees.map(({ capability, form }) => ({ capability, form })));
  return {
    surface: "forest",
    stories: scene.islands.map(({ story }) => story),
    capabilities: trees.flatMap(({ capability }) => (capability === undefined ? [] : [capability])),
    labels: scene.islands.map(({ title }) => title),
    trees,
  };
}

/** A surveyed story's territories: one per capability with code, in the story's order, then Unclaimed code. */
function landOf(capabilities: readonly { id: string; title: string }[], survey: StorySurvey | undefined, radius: number): Island["land"] {
  if (survey === undefined || survey.files.length === 0) return undefined;
  const linesOf = (capability: string | undefined) => survey.files.filter((file) => file.capability === capability).reduce((sum, file) => sum + file.lines, 0);
  const shares = [...capabilities.map(({ id }) => ({ capability: id, lines: linesOf(id) })), { lines: linesOf(undefined) }];
  const map = territories(shares, radius);
  return {
    radius,
    territories: map.territories.map(({ capability }) => (capability === undefined ? {} : { capability, title: capabilities.find(({ id }) => id === capability)?.title ?? capability })),
    files: fileCircles(map, survey.files),
    cells: map.cells.map(({ polygon, territory }) => ({ polygon, territory })),
    borders: map.borders.map(({ from, to }) => ({ from, to })),
  };
}

/** `count` spots set out from the middle like a sunflower's seeds, evenly spread and never crowded. */
function sunflower(count: number): { r: number; angle: number }[] {
  if (count <= 1) return [{ r: 0, angle: 0 }];
  return Array.from({ length: count }, (_, index) => ({ r: TREE_SPACING * Math.sqrt(index + 0.5), angle: index * 2.39996 }));
}
