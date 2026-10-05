/**
 * Capability 3 · Story node render (the forest story): the plan the page draws the globe from.
 * The page itself (apps/desktop) only turns this plan into meshes, so everything the forest decides
 * about what is drawn where is here, and tested without a browser.
 *
 * - Every story node is an island at its place (capability 1), in world units, carrying its
 *   capabilities (capability 2's grove, one entry per capability in build order) and, once its code is
 *   surveyed, their territories and files. No tree is drawn (ADR-0804 D1, ADR-0920): the island is
 *   a flat surface cut into capability territories, and a grove entry is only its capability's record.
 * - Each island is named with its story's title (the label the page keeps facing the camera).
 * - What the page drew is said as the smoke check reads it (ADR-0634 D2), with each capability's form.
 * - An island's key changes only when something drawn on it changes, so a change redraws only the
 *   islands it touched, without a reload.
 */
import type { WorkStates } from "@storytree/arc-surface";
import { PLACE_WIDTH, type CapabilityWord, type ForestScene, type Island, type PlacedTree, type TreeForm } from "@storytree/forest-world/scene";
import type { AnnotatedTree, Change } from "@storytree/library";

import { grove } from "../capability-tree/capability-tree.js";
import { packageOf, type StorySurvey } from "@storytree/map";
import { islandArea, MIN_ISLAND_AREA, unsurveyedArea } from "../planet-places/island-growth.js";
import { storyNodes } from "../story-nodes/story-nodes.js";
import { landForCircles } from "../territories/territories.js";

export { PLACE_WIDTH };
export type { ForestScene, Island, PlacedTree };

/**
 * The flat forest's places are spread out as far as the land grew (ADR-0910: 318 to {@link MIN_ISLAND_AREA} ground
 * units² for each capability an unsurveyed story draws), so neighbouring story nodes still never overlap on it.
 */
const FLAT_SPREAD = Math.sqrt(MIN_ISLAND_AREA / 318);
/** What the forest says it drew: the smoke check's fields (ADR-0634 D2), with the forest's own added. */
export interface ForestDrawn {
  surface: "forest";
  stories: string[];
  capabilities: string[];
  /** The story names on show, one per island. */
  labels: string[];
  /** Every capability (0.2's tree), with its form. */
  trees: { capability: string | undefined; form: TreeForm }[];
}

/**
 * The forest for a project: `tree` is its projectTree(), `history` its changesSince(0) changes, and
 * `states` the arc surface's work states over its agent activity log, and `survey` its code's survey by
 * story (capability 8): a surveyed story's island is cut into its capabilities' territories.
 */
export function forestScene(tree: AnnotatedTree, history: readonly Change[], states: WorkStates, survey: Readonly<Record<string, StorySurvey>> = {}): ForestScene {
  const nodes = new Map(storyNodes(tree, history, survey).map((node) => [node.id, node]));
  const islands = tree.stories.map((story): Island => {
    const node = nodes.get(story.id);
    const trees = grove(story, states);
    const x = (node?.at.x ?? 0) * PLACE_WIDTH * FLAT_SPREAD;
    const z = (node?.at.y ?? 0) * PLACE_WIDTH * FLAT_SPREAD;
    const contractsOf = new Map(story.capabilities.map(({ id, contracts }) => [id, contracts.length]));
    const placed = trees.map(({ capability, form, status }): PlacedTree => ({
      capability,
      form,
      ...(status === undefined ? {} : { status }),
      contracts: capability === undefined ? 0 : (contractsOf.get(capability) ?? 0),
    }));
    const land = landOf(story.capabilities, survey[story.id], packageOf(story.title));
    // ADR-0804 D3, D7: a surveyed story's land follows its lines of code, grown where its files' circles need more room; unsurveyed, it follows its capabilities, a one-capability floor's worth of land each, so it grows in step with the surveyed ones.
    const area = land === undefined ? unsurveyedArea(story.capabilities.length) : landForCircles(land.territories, land.files, islandArea(land.territories.reduce((sum, { lines }) => sum + lines, 0)));
    const key = JSON.stringify([story.title, x, z, placed.map(({ capability, form, status, contracts }) => [capability, form, status, contracts]), land?.territories, area]);
    return { story: story.id, title: story.title, x, z, trees: placed, ...(land === undefined ? {} : { land }), area, key };
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

/**
 * A surveyed story's land: one territory per capability with code, in the story's order, then Unclaimed
 * code, and its files. The page cuts it to the island's coast, which only the drawing knows.
 */
function landOf(capabilities: readonly { id: string; title: string; description?: string; status: CapabilityWord }[], survey: StorySurvey | undefined, pkg: string): Island["land"] {
  if (survey === undefined || survey.files.length === 0) return undefined;
  const linesOf = (capability: string | undefined) => survey.files.filter((file) => file.capability === capability).reduce((sum, file) => sum + file.lines, 0);
  return {
    territories: [...capabilities.map(({ id, title, description, status }) => ({ capability: id, title, ...(description === undefined ? {} : { description }), status, lines: linesOf(id) })), { lines: linesOf(undefined) }].filter(({ lines }) => lines > 0),
    files: survey.files,
    package: pkg,
    imports: survey.imports,
  };
}
