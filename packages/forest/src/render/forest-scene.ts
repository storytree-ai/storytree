/**
 * Capability 3 · Story node render (the forest story): the plan the page draws the globe from.
 * The page itself (apps/desktop) only turns this plan into meshes, so everything the forest decides
 * about what is drawn where is here, and tested without a browser.
 *
 * - Every story node is an island at its place (capability 1), in world units, carrying its
 *   capabilities (capability 2's grove, one entry per capability in build order) and, once its code is
 *   surveyed, their files and code-sized territories. Before then, a verified project shows health
 *   on equal capability shares without inventing code. No tree is drawn (ADR-0804 D1, ADR-0920): the island is
 *   a flat surface cut into capability territories, and a grove entry is only its capability's record.
 * - Each island is named with its story's title (the label the page keeps facing the camera).
 * - What the page drew is said as the smoke check reads it (ADR-0634 D2), with each capability's form.
 * - An island's key changes only when something drawn on it changes, so a change redraws only the
 *   islands it touched, without a reload.
 * - The project's sentence sits above the plan it governs, with what the plan has not yet said (ADR-1085 D1).
 */
import { PLACE_WIDTH, type CapabilityWord, type ForestScene as WorldScene, type Island, type PlacedTree, type Plumbing, type PlumbingKind, type TreeForm } from "@storytree/forest-world/scene";
import type { AnnotatedTree, Change, StorySurvey } from "@storytree/library";
import type { PinReading } from "@storytree/map/pins";
import { linkedStores } from "@storytree/map/stores";

import { grove, type PartStates } from "../capability-tree/capability-tree.js";
import { islandArea, mappedArea, MIN_ISLAND_AREA, unsurveyedArea } from "../planet-places/island-growth.js";
import { storyNodes } from "../story-nodes/story-nodes.js";
import { sceneParts, type SceneParts } from "./scene-parts.js";
import { rolledWord, topParts, type TopPart } from "./top-parts.js";

export { PLACE_WIDTH };
export type { Island, PlacedTree };

/** An edge inside one story that holds contracts (ADR-1282 D1): `from` depends on `to`, and its contracts' ids. */
export type SceneEdge = { readonly from: string; readonly to: string; readonly contracts: readonly string[] };
/** A capability that holds contracts, and its contracts' ids (3.99). */
export type SceneContracts = { readonly capability: string; readonly contracts: readonly string[] };
/**
 * The drawing engine's scene, with the edges inside stories that hold contracts, whose gates an arc's open work on them rings
 * (3.92), and the capabilities that hold contracts, which an arc's open work linking one rings (3.99); the project's sentence
 * is shown in Settings → Projects, not on the map (ADR-1085 D1 as narrowed); and each capability's code parts, which it opens
 * into at the parts level (3.112); and the agents' pins, each live or stale (3.119).
 */
export type ForestScene = WorldScene & { readonly edges?: readonly SceneEdge[]; readonly contracts?: readonly SceneContracts[]; readonly parts?: readonly SceneParts[]; readonly pins?: readonly PinReading[] };

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
 * story (capability 8): a surveyed story's island is cut into its capabilities' territories. The project's shared stores
 * are the ones its capabilities' store links name (map 8.66, ADR-1347 D3), each drawn as its own object beside the islands
 * with its linked tables inside it (ADR-1332 D1). `pins`
 * are the agents' pins (3.119): one on a capability an imported island groups into a top part is drawn on that top part, and
 * on the capability once the top part opens.
 */
export function forestScene(tree: AnnotatedTree, history: readonly Pick<Change, "type" | "action" | "recordId">[], states: PartStates, survey: Readonly<Record<string, StorySurvey>> = {}, pins: readonly PinReading[] = []): ForestScene {
  const nodes = new Map(storyNodes(tree, history, survey).map((node) => [node.id, node]));
  // An imported island opens top-down: its capabilities grouped by their top folders (top-parts.ts).
  const tops = new Map(tree.stories.flatMap((story) => story.mapped === undefined ? [] : [[story.id, topParts(story.id, story.capabilities, survey[story.id])] as const]));
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
    const land = story.mapped === undefined ? landOf(story.capabilities, survey[story.id], tree.unverified !== true) : mappedLand(story.capabilities, survey[story.id], tops.get(story.id) ?? []);
    // ADR-0993 D3: a mapped island's land follows its lines, capped; before its survey, it is the least an island has.
    // ADR-0804 D3, D7, ADR-1212 D2: a surveyed story's land follows its lines of code alone (its files', not the line a capability with no code holds); unsurveyed, it follows its capabilities, a one-capability floor's worth of land each, so it grows in step with the surveyed ones.
    const area = story.mapped !== undefined ? mappedArea(land!.territories.reduce((sum, { lines }) => sum + lines, 0)) : land === undefined || land.files.length === 0 ? unsurveyedArea(story.capabilities.length) : islandArea(land.files.reduce((sum, { lines }) => sum + lines, 0));
    const key = JSON.stringify([story.title, x, z, placed.map(({ capability, form, status, contracts }) => [capability, form, status, contracts]), land?.territories, area]);
    return { story: story.id, title: story.title, x, z, trees: placed, ...(land === undefined ? {} : { land }), area, key };
  });
  const plumbing = plumbingCalls(tree, survey);
  const topOf = new Map([...tops.values()].flat().flatMap(({ id, members }) => members.map((member) => [member.id, id] as const)));
  const edges = rolledEdges(tree.stories.flatMap(({ edges = [] }) => edges.flatMap(({ from, to, contracts }): SceneEdge[] => contracts.length === 0 ? [] : [{ from, to, contracts: contracts.map(({ id }) => id) }])), topOf);
  const deepest = capabilityLinks(tree, survey);
  const contracts = tree.stories.flatMap(({ capabilities }) => capabilities.flatMap(({ id, contracts }): SceneContracts[] => contracts.length === 0 ? [] : [{ capability: id, contracts: contracts.map(({ id }) => id) }]));
  const drawn = linkedStores(tree.stories).map(({ address, medium, tables }) => ({ address, medium, tables: tables.map(({ name }) => name) }));
  const parts = [...sceneParts(survey, new Map(tree.stories.flatMap(({ capabilities }) => capabilities.map(({ id, title }) => [id, title] as const)))),
    ...[...tops].flatMap(([story, own]) => own.map((top) => topScene(story, top, deepest, topOf)))];
  const pinned = pins.map((reading) => inTopPart(reading, topOf));
  return { islands, links: rolledLinks(deepest, topOf), ...(plumbing.length === 0 ? {} : { plumbing }), ...(edges.length === 0 ? {} : { edges }), ...(contracts.length === 0 ? {} : { contracts }), ...(drawn.length === 0 ? {} : { stores: drawn }), ...(parts.length === 0 ? {} : { parts }), ...(pinned.length === 0 ? {} : { pins: pinned }) };
}

/** A pin on a capability grouped into a top part, anchored on that top part with the capability as its part there (3.119). */
function inTopPart(reading: PinReading, topOf: ReadonlyMap<string, string>): PinReading {
  const { anchor } = reading.pin.fields;
  const top = "capability" in anchor ? topOf.get(anchor.capability) : undefined;
  if (top === undefined || !("capability" in anchor)) return reading;
  return { ...reading, pin: { ...reading.pin, fields: { ...reading.pin.fields, anchor: { capability: top, part: anchor.capability } } } };
}

/**
 * The plumbing calls between stories (ADR-1085 D3, ADR-1078 rule 5): each survey edge file marked a forwarder, or
 * declared a build step or cleanup, gathered into one island-to-island entry per (story, story, kind) with its files.
 * The map draws each as one more link between its islands (ADR-1277 D1); the kinds stay in the scene's data.
 */
function plumbingCalls(tree: AnnotatedTree, survey: Readonly<Record<string, StorySurvey>>): Plumbing[] {
  const calls = new Map<string, { from: string; to: string; kind: PlumbingKind; files: Set<string> }>();
  for (const story of tree.stories) for (const edge of survey[story.id]?.edges ?? []) for (const file of edge.files) {
    const kind: PlumbingKind | undefined = file.forwarder === true ? "forwarder" : file.plumbing;
    if (kind === undefined || edge.story === story.id) continue;
    const key = JSON.stringify([story.id, edge.story, kind]);
    const call = calls.get(key) ?? { from: story.id, to: edge.story, kind, files: new Set<string>() };
    call.files.add(file.from);
    calls.set(key, call);
  }
  return [...calls.values()].map(({ files, ...call }) => ({ ...call, files: [...files].sort() }))
    .sort((a, b) => (a.from + a.to + a.kind < b.from + b.to + b.kind ? -1 : 1));
}

/**
 * The roads (ADR-0991 D1, D3): each recorded capability dependsOn, drawn by value, then each edge the code survey
 * derives with a capability at both ends that no recorded one already joins, marked type-only when only types join them.
 * A derived edge with no capability at an end is a story edge with no road, unless it carries a plumbing call, which
 * is a link like any other (ADR-1277 D1), island to island. A built story whose package depends on a
 * mapped story's has a road from its island to the mapped island as a whole: a mapped island has no capability to name,
 * and the survey names no importing one.
 */
function capabilityLinks(tree: AnnotatedTree, survey: Readonly<Record<string, StorySurvey>>): { from: string; to: string; typeOnly?: true }[] {
  const links = new Map<string, { from: string; to: string; typeOnly?: true }>(tree.stories.flatMap(story => story.capabilities.flatMap(capability =>
    capability.dependsOn.map(to => [`${capability.id}->${to}`, { from: capability.id, to }] as const))));
  for (const story of tree.stories) for (const { story: other, from, to, typeOnly, files } of survey[story.id]?.edges ?? []) {
    if (from !== undefined && to !== undefined) {
      if (!links.has(`${from}->${to}`)) links.set(`${from}->${to}`, { from, to, ...(typeOnly ? { typeOnly } : {}) });
    // A plumbing call is drawn as a link like any other (ADR-1277 D1): with no capability end, from its island to the other as a whole.
    } else if (other !== story.id && files.some((file) => file.forwarder === true || file.plumbing !== undefined)) links.set(`${story.id}->${other}`, { from: story.id, to: other });
  }
  const mapped = new Set(tree.stories.filter(story => story.mapped !== undefined).map(({ id }) => id));
  for (const story of tree.stories) if (story.mapped === undefined) for (const to of survey[story.id]?.dependsOn ?? []) {
    if (mapped.has(to)) links.set(`${story.id}->${to}`, { from: story.id, to });
  }
  return [...links.values()];
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

/** Where `id` is drawn: the top part holding it, or itself. */
const drawnAt = (id: string, topOf: ReadonlyMap<string, string>): string => topOf.get(id) ?? id;

/**
 * The links as drawn (3.117): each end inside a top part is that top part, so roads join top parts and a road from outside
 * reaches the top part; a link inside one top part is no road at that level, and the links two top parts share are one,
 * type-only only when every one of them is.
 */
function rolledLinks(links: readonly { from: string; to: string; typeOnly?: true }[], topOf: ReadonlyMap<string, string>): { from: string; to: string; typeOnly?: true }[] {
  const rolled = new Map<string, { from: string; to: string; typeOnly?: true }>();
  for (const link of links) {
    const [from, to] = [drawnAt(link.from, topOf), drawnAt(link.to, topOf)];
    if (from === to) continue;
    const key = `${from}->${to}`, held = rolled.get(key);
    rolled.set(key, held === undefined ? { from, to, ...(link.typeOnly ? { typeOnly: true as const } : {}) } : held.typeOnly && link.typeOnly ? held : { from, to });
  }
  return [...rolled.values()];
}

/** The edges holding contracts as drawn: rolled up as the links are, each top-part pair's contracts gathered. */
function rolledEdges(edges: readonly SceneEdge[], topOf: ReadonlyMap<string, string>): SceneEdge[] {
  const rolled = new Map<string, { from: string; to: string; contracts: Set<string> }>();
  for (const edge of edges) {
    const [from, to] = [drawnAt(edge.from, topOf), drawnAt(edge.to, topOf)];
    if (from === to) continue;
    const held = rolled.get(`${from}->${to}`) ?? { from, to, contracts: new Set<string>() };
    for (const contract of edge.contracts) held.contracts.add(contract);
    rolled.set(`${from}->${to}`, held);
  }
  return [...rolled.values()].map(({ contracts, ...edge }) => ({ ...edge, contracts: [...contracts] }));
}

/**
 * A top part opened (3.118): its capabilities as its parts, each carrying its word, the links between them as its roads,
 * and, for each rolled-up link reaching it, the capabilities inside it that link stands for.
 */
function topScene(story: string, top: TopPart, links: readonly { from: string; to: string }[], topOf: ReadonlyMap<string, string>): SceneParts {
  const inside = new Set(top.members.map(({ id }) => id));
  const lanes = new Map<string, Set<string>>();
  for (const { from, to } of links) {
    const [a, b] = [drawnAt(from, topOf), drawnAt(to, topOf)];
    if (a === b || (a !== top.id && b !== top.id)) continue;
    const key = `${a}->${b}`;
    lanes.set(key, (lanes.get(key) ?? new Set()).add(a === top.id ? from : to));
  }
  return {
    story,
    capability: top.id,
    shares: top.members.map(({ id, title, description, status, parkedOn, lines }) => ({ capability: id, title, lines, status, ...(parkedOn === undefined ? {} : { parked: true as const }), ...(description === undefined ? {} : { description }) })),
    links: links.filter(({ from, to }) => from !== to && inside.has(from) && inside.has(to)).map(({ from, to }) => ({ from, to })),
    lanes: Object.fromEntries([...lanes].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, set]) => [key, [...set].sort()])),
  };
}

/**
 * A mapped story's land (ADR-0993 D3, D5, D7): a black box but where an agent explored it, so one territory for each
 * explored capability with surveyed code, in the story's order, then one brown territory for the unexplored rest, side by
 * side and sized by their lines; the whole island is one brown territory before its survey (a weight of 1) or until explored.
 * An explored capability carries its word, so it is drawn green or red by its verified health and yellow with no tests tied
 * (question_7e73e1c75c0d). Its files are never drawn, whether or not the project is verified. Capabilities sharing a top
 * folder are drawn as one top part where the first of them would be (3.50, `tops`), the brown rest once beside them.
 */
function mappedLand(capabilities: readonly { id: string; title: string; description?: string; status: CapabilityWord; parkedOn?: readonly unknown[] }[], survey: StorySurvey | undefined, tops: readonly TopPart[]): NonNullable<Island["land"]> {
  const files = survey?.files ?? [];
  const linesOf = (capability: string | undefined) => files.filter((file) => file.capability === capability).reduce((sum, file) => sum + file.lines, 0);
  const topOf = new Map(tops.flatMap((top) => top.members.map(({ id }) => [id, top] as const)));
  const territories = [
    ...capabilities.flatMap(({ id, title, description, status, parkedOn }) => {
      const top = topOf.get(id);
      if (top === undefined) return [{ capability: id, title, ...(description === undefined ? {} : { description }), status, ...(parkedOn === undefined ? {} : { parked: true as const }), mapped: true as const, lines: linesOf(id) }];
      if (top.members[0]!.id !== id) return [];
      return [{ capability: top.id, title: top.folder, description: top.members.map((member) => member.title).join(", "), ...rolledWord(top.members), mapped: true as const, lines: top.members.reduce((sum, { lines }) => sum + lines, 0) }];
    }),
    { mapped: true as const, lines: linesOf(undefined) },
  ].filter(({ lines }) => lines > 0);
  return { territories: territories.length > 0 ? territories : [{ mapped: true, lines: 1 }], files: [] };
}

/**
 * A surveyed story's land: one territory per capability, in the story's order, then Unclaimed code, and
 * its files. A capability with no code yet holds a share of one line, so it gets the least land a territory
 * has (rollout 1's every capability holds land): its links have somewhere to reach. Before a survey, a verified project's capabilities get equal shares (weight 1),
 * with no files asserted. A project never verified keeps its existing bare land.
 * The page cuts it to the island's coast, which only the drawing knows.
 */
function landOf(capabilities: readonly { id: string; title: string; description?: string; status: CapabilityWord; parkedOn?: readonly unknown[] }[], survey: StorySurvey | undefined, verified: boolean): Island["land"] {
  // A capability not proven and parked on purpose is drawn grey (ADR-0992); the library decides which.
  const territory = ({ id, title, description, status, parkedOn }: (typeof capabilities)[number], lines: number) =>
    ({ capability: id, title, ...(description === undefined ? {} : { description }), status, ...(parkedOn === undefined ? {} : { parked: true as const }), lines });
  if (survey === undefined || survey.files.length === 0) return !verified || capabilities.length === 0 ? undefined : {
    territories: capabilities.map((capability) => territory(capability, 1)),
    files: [],
  };
  const linesOf = (capability: string | undefined) => survey.files.filter((file) => file.capability === capability).reduce((sum, file) => sum + file.lines, 0);
  return {
    territories: [...capabilities.map((capability) => territory(capability, Math.max(1, linesOf(capability.id)))), { lines: linesOf(undefined) }].filter(({ lines }) => lines > 0),
    files: survey.files,
  };
}
