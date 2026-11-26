// Capability 5 · Capability tree scorecard
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Library } from "@storytree/library";
import { VerbRefusal } from "@storytree/library/verbs";

import { groupingOf, pairsOf, readCoChange, RUNS, topOf, type Grouping, type Pair } from "./co-change.js";
import { commitOf } from "./read.js";
import { kindOf } from "./source.js";
import { planTreeOf, proposedTreeOf, type ProposedNode, type Tree, type TreeNode } from "./tree.js";
import { refactored, type Refactor, type Retarget, type Split } from "./tree-refactor.js";
import { exportsOf, importsOf, treeStructureOf, type Import, type OutsideImport, type TreeStructure } from "./tree-structure.js";

export const MERGE_LIFT = 2;
export const FAMILY_LIFT = 1;

export type Lead =
  | { readonly kind: "merge-or-nest"; readonly a: string; readonly b: string; readonly lift: number }
  | { readonly kind: "no-change-family"; readonly parent: string; readonly lift: number };

export interface Scorecard {
  readonly nodes: readonly TreeNode[];
  readonly readings: TreeStructure & {
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

export function scorecardOf({ tree, units, imports, exports, refactor, outside }: { tree: Tree; units: readonly { files: readonly string[] }[]; imports: readonly Import[]; exports?: ReadonlyMap<string, readonly string[]>; refactor?: Refactor; outside?: readonly OutsideImport[] }): Scorecard {
  const shaped = refactor === undefined ? { imports, exports } : refactored(imports, exports, refactor);
  const structure = treeStructureOf(tree, shaped.imports, shaped.exports, outside);
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
  const { nodes, cycles, inversions, cycleGate, depths, meetDepths, boundaries, entries, reuse, splitCandidates, technicalNames, pairs, grouping, unplaced } = card.readings;
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
  const spread = (name: string, read: Grouping["mq"], shown: (value: number) => string) => `${name} ${shown(read.value)} (mean ${shown(read.mean)}, 95th percentile ${shown(read.p95)} over ${RUNS} random groupings of the same sizes)`;
  const lines = [
    "Readings",
    `  grouping    ${spread("TurboMQ", grouping.mq, two)}`,
    `              ${spread("co-change inside groups", grouping.inside, percent)}`,
    `  pairs       ${pairs.length === 0 ? "none at support 5 or more" : "node pairs changing together at support 5 or more, by lift:"}`,
    ...pairs.map(({ a, b, support, lift, jaccard }) => `    ${title(a)} and ${title(b)}: support ${support}, lift ${two(lift)}, Jaccard ${two(jaccard)}`),
    "  nodes       level among siblings, instability, common reuse:",
    ...nodes.map(({ id, level, instability, commonReuse }) => `    ${title(id)}: level ${level}, instability ${orNone(instability)}, common reuse ${orNone(commonReuse, percent)}`),
    `  cycle gate  ${cycleGate}: ${cycles.length === 0 ? "no import cycle among siblings at any level" : cycles.map(({ parent, members }) => `under ${title(parent)}, ${members.map(title).join(", ")}`).join("; ")}`,
    "  depths",
    ...depths.map(({ depth, nodes: count, edges }) => `    depth ${depth}: ${count} node${count === 1 ? "" : "s"}, ${edges} sibling import edge${edges === 1 ? "" : "s"}`),
    `  boundaries  ${boundaries.length === 0 ? "none" : "import edges between nodes, with the types crossing each:"}`,
    ...boundaries.map(({ from, to, types }) => `    ${title(from)} → ${title(to)}: ${types.length === 0 ? "no types" : types.join(", ")}`),
    `  meet depth  imports by the depth their two ends' nodes meet at, deeper better: ${meetDepths.length === 0 ? "none" : meetDepths.map(({ depth, imports }) => `depth ${depth}: ${plural(imports, "import")}`).join(", ")}`,
    `  entries     ${entries.share === null ? "no import between siblings" : `${entries.through} of ${entries.total} imports between siblings (${percent(entries.share)}) land on the imported sibling's entry${entries.offenders.length === 0 ? "" : "; the rest, by file:"}`}`,
    ...entries.offenders.map(({ from, to, sibling }) => `    ${from} → ${to} (into ${title(sibling)})`),
    ...(entries.nodes.length === 0 ? [] : ["  entry size  each imported sibling's entry, its exported names against those of every file behind it:"]),
    ...entries.nodes.map(({ id, entry, exported, behind }) => `    ${title(id)}: entry ${entry ?? "none"}, ${plural(exported, "exported name")} against ${behind} behind it`),
    `  reuse       ${reuse.length === 0 ? "none" : "share of each dependency's exported names its consumer imports:"}`,
    ...reuse.map(({ consumer, dependency, used, exported, share }) => `    ${title(consumer)} → ${title(dependency)}: ${used} of ${exported} (${orNone(share, percent)})`),
    `  split       ${splitCandidates.length === 0 ? "no consumer imports under a quarter of a dependency's names" : `candidates, a consumer importing under a quarter of a dependency's names: ${splitCandidates.map(({ consumer, dependency, share }) => `${title(consumer)} of ${title(dependency)} (${orNone(share, percent)})`).join("; ")}`}`,
    `  technical   ${technicalNames.length === 0 ? "no top-level node named for a technical layer" : `top-level nodes named for a technical layer: ${technicalNames.map(({ id, word }) => `${title(id)} (${word})`).join(", ")}`}`,
    `  inverted    ${inversions.length === 0 ? "none: no edge in a sibling cycle runs from the more widely imported sibling" : `edges in a sibling cycle from the more widely imported sibling, by fan-in: ${inversions.map(({ parent, from, to, fanIn, imports }) => `under ${title(parent)}, ${title(from)} (fan-in ${fanIn.from}) → ${title(to)} (fan-in ${fanIn.to}) [${imports.map((one) => `${title(one.from)} → ${title(one.to)}: ${one.types.length === 0 ? "no types" : one.types.join(", ")}`).join("; ")}]`).join("; ")}`}`,
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

const strings = (value: unknown): boolean => Array.isArray(value) && value.every((one) => typeof one === "string");

const isSplit = (one: unknown): boolean => {
  const { file, into } = (one ?? {}) as { file?: unknown; into?: unknown };
  return typeof file === "string" && typeof into === "object" && into !== null && !Array.isArray(into) && Object.values(into).every(strings);
};

const isRetarget = (one: unknown): boolean => {
  const { file, from, to, names } = (one ?? {}) as { file?: unknown; from?: unknown; to?: unknown; names?: unknown };
  return typeof file === "string" && typeof from === "string" && (to === undefined || typeof to === "string") && (names === undefined || strings(names));
};

async function proposalAt(folder: string, file: string): Promise<{ nodes: ProposedNode[] } & Refactor> {
  let read: unknown;
  try {
    read = JSON.parse(await readFile(path.resolve(folder, file), "utf8"));
  } catch (error) {
    throw new VerbRefusal(`Cannot read the proposed tree ${file}: ${(error as Error).message}`, { misuse: true });
  }
  const nodes = (read as { nodes?: unknown } | null)?.nodes;
  const named = (node: unknown): boolean => typeof (node as { id?: unknown } | null)?.id === "string" && typeof (node as { title?: unknown }).title === "string";
  if (!Array.isArray(nodes) || !nodes.every(named)) throw new VerbRefusal(`The proposed tree ${file} is not {"nodes": [{"id", "title", "parent"?, "entry"?, "files"?, "capabilities"?}, …]}.`, { misuse: true });
  const { splits, retargets } = read as { splits?: unknown; retargets?: unknown };
  if (splits !== undefined && !(Array.isArray(splits) && splits.every(isSplit))) throw new VerbRefusal(`The proposed tree ${file}'s splits are not [{"file", "into": {"<part>": [names]}}, …].`, { misuse: true });
  if (retargets !== undefined && !(Array.isArray(retargets) && retargets.every(isRetarget))) throw new VerbRefusal(`The proposed tree ${file}'s retargets are not [{"file", "from", "to"?, "names"?: [names]}, …].`, { misuse: true });
  return { nodes: nodes as ProposedNode[], ...(splits === undefined ? {} : { splits: splits as Split[] }), ...(retargets === undefined ? {} : { retargets: retargets as Retarget[] }) };
}

export async function scorecardAt({ folder, library, story, proposal }: { readonly folder: string; readonly library: Pick<Library, "projectTree">; readonly story: string; readonly proposal?: string }): Promise<Scorecard> {
  const [{ branchPlan }, { codeSurveyReader, packageOf, surveyCodeName }] = await Promise.all([import("@storytree/map/read"), import("@storytree/map/code-survey")]);
  const plan = await branchPlan(library, folder);
  const found = plan.stories.find((one) => one.id === story || one.title.toLowerCase() === story.toLowerCase());
  if (found === undefined) throw new VerbRefusal(`No story "${story}": give a story's id or its title.`, { misuse: true });
  const survey = await codeSurveyReader({ checkout: "current", codeName: () => surveyCodeName() }).read(folder, plan);
  const read = survey[found.id];
  const pathname = (file: string): string => read?.mapped !== undefined
    ? `${read.mapped.folder.replaceAll("\\", "/").replace(/\/$/, "")}/${file}`
    : path.posix.normalize(`packages/${packageOf(found)}/${file}`.replaceAll("\\", "/"));
  const isSource = (file: string): boolean => kindOf({ path: file, text: "" }) === "source";
  const planned = planTreeOf(
    found.capabilities.map(({ id, title, parent }) => ({ id, title, ...(parent === undefined ? {} : { parent }) })),
    [...found.capabilities.map(({ id }) => id), undefined].flatMap((capability) => (read?.files ?? [])
      .filter((file) => file.capability === capability)
      .map((file) => ({ path: pathname(file.path), ...(capability === undefined ? {} : { capability }) }))).filter((file) => isSource(file.path)),
  );
  const outside = plan.stories.filter(({ id }) => id !== found.id).flatMap(({ id }) => (survey[id]?.edges ?? [])
    .filter((edge) => edge.story === found.id)
    .flatMap((edge) => edge.files.flatMap((file) => (file.to === undefined ? [] : [{ story: id, to: pathname(file.to) }]))));
  const proposed = proposal === undefined ? undefined : await proposalAt(folder, proposal);
  const tree = proposed === undefined ? planned : proposedTreeOf(proposed, planned);
  const paths = [...Object.keys(planned.ownerOf), ...planned.unplaced];
  const [files, history] = await Promise.all([
    Promise.all(paths.map(async (file) => ({ path: file, text: await readFile(path.join(folder, file), "utf8").catch(() => "") }))),
    commitOf(folder, undefined).then((commit) => readCoChange(folder, commit)),
  ]);
  return scorecardOf({ tree, units: history.kept, imports: importsOf(files), exports: exportsOf(files), outside, ...(proposed === undefined ? {} : { refactor: proposed }) });
}
