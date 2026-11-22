// Capability 3 · Story node render
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

export type SceneEdge = { readonly from: string; readonly to: string; readonly contracts: readonly string[] };
export type SceneContracts = { readonly capability: string; readonly contracts: readonly string[] };
export type ForestScene = WorldScene & { readonly edges?: readonly SceneEdge[]; readonly contracts?: readonly SceneContracts[]; readonly parts?: readonly SceneParts[]; readonly pins?: readonly PinReading[] };

const FLAT_SPREAD = Math.sqrt(MIN_ISLAND_AREA / 318);
export interface ForestDrawn {
  surface: "forest";
  stories: string[];
  capabilities: string[];
  labels: string[];
  trees: { capability: string | undefined; form: TreeForm }[];
}

export function forestScene(tree: AnnotatedTree, history: readonly Pick<Change, "type" | "action" | "recordId">[], states: PartStates, survey: Readonly<Record<string, StorySurvey>> = {}, pins: readonly PinReading[] = []): ForestScene {
  const nodes = new Map(storyNodes(tree, history, survey).map((node) => [node.id, node]));
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
    const land = story.mapped === undefined ? landOf(story.capabilities, survey[story.id]) : mappedLand(story.capabilities, survey[story.id], tops.get(story.id) ?? []);
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

function inTopPart(reading: PinReading, topOf: ReadonlyMap<string, string>): PinReading {
  const { anchor } = reading.pin.fields;
  const top = "capability" in anchor ? topOf.get(anchor.capability) : undefined;
  if (top === undefined || !("capability" in anchor)) return reading;
  return { ...reading, pin: { ...reading.pin, fields: { ...reading.pin.fields, anchor: { capability: top, part: anchor.capability } } } };
}

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

function capabilityLinks(tree: AnnotatedTree, survey: Readonly<Record<string, StorySurvey>>): { from: string; to: string; typeOnly?: true }[] {
  const links = new Map<string, { from: string; to: string; typeOnly?: true }>(tree.stories.flatMap(story => story.capabilities.flatMap(capability =>
    capability.dependsOn.map(to => [`${capability.id}->${to}`, { from: capability.id, to }] as const))));
  for (const story of tree.stories) for (const { story: other, from, to, typeOnly, files } of survey[story.id]?.edges ?? []) {
    if (from !== undefined && to !== undefined) {
      if (!links.has(`${from}->${to}`)) links.set(`${from}->${to}`, { from, to, ...(typeOnly ? { typeOnly } : {}) });
    } else if (other !== story.id && files.some((file) => file.forwarder === true || file.plumbing !== undefined)) links.set(`${story.id}->${other}`, { from: story.id, to: other });
  }
  const mapped = new Set(tree.stories.filter(story => story.mapped !== undefined).map(({ id }) => id));
  for (const story of tree.stories) if (story.mapped === undefined) for (const to of survey[story.id]?.dependsOn ?? []) {
    if (mapped.has(to)) links.set(`${story.id}->${to}`, { from: story.id, to });
  }
  return [...links.values()];
}

export function changedIslands(before: ForestScene, after: ForestScene): string[] {
  const was = new Map(before.islands.map((island) => [island.story, island.key]));
  const now = new Set(after.islands.map(({ story }) => story));
  return [
    ...after.islands.filter(({ story, key }) => was.get(story) !== key).map(({ story }) => story),
    ...before.islands.filter(({ story }) => !now.has(story)).map(({ story }) => story),
  ];
}

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

const drawnAt = (id: string, topOf: ReadonlyMap<string, string>): string => topOf.get(id) ?? id;

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

function landOf(capabilities: readonly { id: string; title: string; description?: string; status: CapabilityWord; parkedOn?: readonly unknown[] }[], survey: StorySurvey | undefined): Island["land"] {
  const territory = ({ id, title, description, status, parkedOn }: (typeof capabilities)[number], lines: number) =>
    ({ capability: id, title, ...(description === undefined ? {} : { description }), status, ...(parkedOn === undefined ? {} : { parked: true as const }), lines });
  if (survey === undefined || survey.files.length === 0) return capabilities.length === 0 ? undefined : {
    territories: capabilities.map((capability) => territory(capability, 1)),
    files: [],
  };
  const linesOf = (capability: string | undefined) => survey.files.filter((file) => file.capability === capability).reduce((sum, file) => sum + file.lines, 0);
  return {
    territories: [...capabilities.map((capability) => territory(capability, Math.max(1, linesOf(capability.id)))), { lines: linesOf(undefined) }].filter(({ lines }) => lines > 0),
    files: survey.files,
  };
}
