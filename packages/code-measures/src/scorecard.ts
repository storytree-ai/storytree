// Capability 5 · Capability tree scorecard
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Library } from "@storytree/library";
import { VerbRefusal } from "@storytree/library/verbs";

import { groupingOf, pairsOf, readCoChange, RUNS, topOf, type Grouping, type Pair } from "./co-change.js";
import { commitOf } from "./read.js";
import { kindOf } from "./source.js";
import { planTreeOf, proposedTreeOf, type ProposedNode, type Tree, type TreeNode } from "./tree.js";
import { importsOf, treeStructureOf, type Boundary, type Cycle, type Depth, type Import, type NodeStructure } from "./tree-structure.js";

export const MERGE_LIFT = 2;
export const FAMILY_LIFT = 1;

export type Lead =
  | { readonly kind: "merge-or-nest"; readonly a: string; readonly b: string; readonly lift: number }
  | { readonly kind: "no-change-family"; readonly parent: string; readonly lift: number };

export interface Scorecard {
  readonly nodes: readonly TreeNode[];
  readonly readings: {
    readonly nodes: readonly NodeStructure[];
    readonly cycles: readonly Cycle[];
    readonly depths: readonly Depth[];
    readonly boundaries: readonly Boundary[];
    readonly pairs: readonly Pair[];
    readonly grouping: Grouping;
    readonly unplaced: readonly string[];
  };
  readonly guidance: readonly Lead[];
}

function leadsOf(tree: Tree, pairs: readonly Pair[]): Lead[] {
  const top = topOf(tree.nodes);
  const leads: Lead[] = pairs
    .filter(({ a, b, lift }) => lift >= MERGE_LIFT && top(a) !== top(b))
    .map(({ a, b, lift }) => ({ kind: "merge-or-nest", a, b, lift }));
  const parentOf = new Map(tree.nodes.flatMap(({ id, parent }) => (parent === undefined ? [] : [[id, parent] as const])));
  const childUnder = (node: string, parent: string): string | undefined => {
    const seen = new Set<string>();
    for (let at: string | undefined = node; at !== undefined && !seen.has(at); at = parentOf.get(at)) {
      seen.add(at);
      if (parentOf.get(at) === parent) return at;
    }
    return undefined;
  };
  for (const parent of new Set(parentOf.values())) {
    const lifts = pairs.flatMap(({ a, b, lift }) => {
      const ca = childUnder(a, parent);
      const cb = childUnder(b, parent);
      return ca === undefined || cb === undefined || ca === cb ? [] : [lift];
    });
    if (lifts.length === 0) continue;
    const average = lifts.reduce((sum, lift) => sum + lift, 0) / lifts.length;
    if (average <= FAMILY_LIFT) leads.push({ kind: "no-change-family", parent, lift: average });
  }
  return leads;
}

export function scorecardOf({ tree, units, imports }: { tree: Tree; units: readonly { files: readonly string[] }[]; imports: readonly Import[] }): Scorecard {
  const structure = treeStructureOf(tree, imports);
  const pairs = pairsOf(units, tree.ownerOf);
  return {
    nodes: tree.nodes,
    readings: { ...structure, pairs, grouping: groupingOf(units, tree), unplaced: tree.unplaced },
    guidance: leadsOf(tree, pairs),
  };
}

const two = (value: number): string => value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const percent = (share: number): string => `${(share * 100).toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
const orNone = (value: number | null, shown: (value: number) => string = two): string => (value === null ? "none" : shown(value));

export function scorecardText(card: Scorecard): string {
  const titles = new Map(card.nodes.map(({ id, title }) => [id, title]));
  const title = (id: string | null): string => (id === null ? "the top level" : titles.get(id) ?? id);
  const top = topOf(card.nodes);
  const { nodes, cycles, depths, boundaries, pairs, grouping, unplaced } = card.readings;
  const spread = (name: string, read: Grouping["mq"], shown: (value: number) => string) => `${name} ${shown(read.value)} (mean ${shown(read.mean)}, 95th percentile ${shown(read.p95)} over ${RUNS} random groupings of the same sizes)`;
  const lines = [
    "Readings",
    `  grouping    ${spread("TurboMQ", grouping.mq, two)}`,
    `              ${spread("co-change inside groups", grouping.inside, percent)}`,
    `  pairs       ${pairs.length === 0 ? "none at support 5 or more" : "node pairs changing together at support 5 or more, by lift:"}`,
    ...pairs.map(({ a, b, support, lift, jaccard }) => `    ${title(a)} and ${title(b)}: support ${support}, lift ${two(lift)}, Jaccard ${two(jaccard)}`),
    "  nodes       level among siblings, instability, common reuse:",
    ...nodes.map(({ id, level, instability, commonReuse }) => `    ${title(id)}: level ${level}, instability ${orNone(instability)}, common reuse ${orNone(commonReuse, percent)}`),
    `  cycles      ${cycles.length === 0 ? "none among siblings" : "import cycles among siblings:"}`,
    ...cycles.map(({ parent, members }) => `    under ${title(parent)}: ${members.map(title).join(", ")}`),
    "  depths",
    ...depths.map(({ depth, nodes: count, edges }) => `    depth ${depth}: ${count} node${count === 1 ? "" : "s"}, ${edges} sibling import edge${edges === 1 ? "" : "s"}`),
    `  boundaries  ${boundaries.length === 0 ? "none" : "import edges between nodes, with the types crossing each:"}`,
    ...boundaries.map(({ from, to, types }) => `    ${title(from)} → ${title(to)}: ${types.length === 0 ? "no types" : types.join(", ")}`),
    `  unplaced    ${unplaced.length === 0 ? "none" : `${unplaced.length} source file${unplaced.length === 1 ? "" : "s"} in no node:`}`,
    ...unplaced.map((file) => `    ${file}`),
    "",
    "Guidance (leads for a story author to weigh, not readings)",
    ...(card.guidance.length === 0 ? ["  none"] : card.guidance.map((lead) => lead.kind === "merge-or-nest"
      ? `  merge-or-nest: ${title(lead.a)} and ${title(lead.b)} change together at lift ${two(lead.lift)} across ${title(top(lead.a))} and ${title(top(lead.b))}`
      : `  no change family: ${title(lead.parent)}'s children change together at an average lift of ${two(lead.lift)}`)),
  ];
  return lines.join("\n");
}

async function proposalAt(folder: string, file: string): Promise<{ nodes: ProposedNode[] }> {
  let read: unknown;
  try {
    read = JSON.parse(await readFile(path.resolve(folder, file), "utf8"));
  } catch (error) {
    throw new VerbRefusal(`Cannot read the proposed tree ${file}: ${(error as Error).message}`, { misuse: true });
  }
  const nodes = (read as { nodes?: unknown } | null)?.nodes;
  const named = (node: unknown): boolean => typeof (node as { id?: unknown } | null)?.id === "string" && typeof (node as { title?: unknown }).title === "string";
  if (!Array.isArray(nodes) || !nodes.every(named)) throw new VerbRefusal(`The proposed tree ${file} is not {"nodes": [{"id", "title", "parent"?, "files"?, "capabilities"?}, …]}.`, { misuse: true });
  return { nodes: nodes as ProposedNode[] };
}

export async function scorecardAt({ folder, library, story, proposal }: { readonly folder: string; readonly library: Pick<Library, "projectTree">; readonly story: string; readonly proposal?: string }): Promise<Scorecard> {
  const { capabilityTreeProject } = await import("@storytree/map/read");
  const plan = await library.projectTree();
  const found = plan.stories.find((one) => one.id === story || one.title.toLowerCase() === story.toLowerCase());
  if (found === undefined) throw new VerbRefusal(`No story "${story}": give a story's id or its title.`, { misuse: true });
  const surveyed = await capabilityTreeProject(library, folder, found.id);
  const parentOf = new Map(found.capabilities.flatMap(({ id, parent }) => (parent === undefined ? [] : [[id, parent] as const])));
  const isSource = (file: { path: string }): boolean => kindOf({ path: file.path, text: "" }) === "source";
  const planned = planTreeOf(
    surveyed.capabilities.map(({ id, title }) => ({ id, title, ...(parentOf.has(id) ? { parent: parentOf.get(id)! } : {}) })),
    [...surveyed.capabilities.flatMap(({ id, files }) => files.map((file) => ({ path: file.path, capability: id }))), ...surveyed.unclaimed.map((file) => ({ path: file.path }))].filter(isSource),
  );
  const tree = proposal === undefined ? planned : proposedTreeOf(await proposalAt(folder, proposal), planned);
  const paths = [...Object.keys(planned.ownerOf), ...planned.unplaced];
  const [files, history] = await Promise.all([
    Promise.all(paths.map(async (file) => ({ path: file, text: await readFile(path.join(folder, file), "utf8").catch(() => "") }))),
    commitOf(folder, undefined).then((commit) => readCoChange(folder, commit)),
  ]);
  return scorecardOf({ tree, units: history.kept, imports: importsOf(files) });
}
