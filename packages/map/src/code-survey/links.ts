/**
 * Capability 3 · Counts before detail: a mapped story's links checked against its code's own imports (3.15,
 * question_23191b4f2a29 option D, building option A's check from the crossing's readers).
 *
 * - The story's explored capabilities are the ones that cover folders or files (ADR-0993 D5); a file belongs to the one
 *   the survey gives it. An import from a file of capability A to a file of capability B backs the link A depends on B.
 * - Missing: imports from A's files to B's files with no link A depends on B. Unbacked: a link A depends on B, both
 *   explored in this story, that no import from A's files to B's backs; the imports from B's files to A's, if any, are
 *   listed with it, since the link may be drawn the wrong way round. A link to a capability that covers nothing, or to
 *   another story's, cannot be checked here, and is named as such.
 * - Imports within one capability, or from or to a file in none, are no link's. Each link's imports are listed, or above
 *   the ceiling only counted. It informs: it writes no plan record. Code reached through the database, events or a name
 *   this cannot resolve is not counted, and the answer says so.
 */
import path from "node:path";

import type { AnnotatedTree, StorySurvey } from "@storytree/library";

import { CEILING, CROSSING_NOTE, islandImports } from "./crossings.js";

type Named = { readonly id: string; readonly title: string };

/** One import behind a link, by paths from the import's folder. */
export type LinkImport = { readonly from: string; readonly to: string };

/** A link, A depends on B, with how many imports run from A's files to B's and, below the ceiling, each of them. */
export type LinkRow = { readonly from: Named; readonly to: Named; readonly count: number; readonly imports: readonly LinkImport[] };

export type LinksAnswer = {
  readonly story: Named;
  /** The folder this machine imports the story from. */
  readonly island: string;
  /** How many of the story's capabilities cover files. */
  readonly explored: number;
  /** Imports between two explored capabilities' files that no link covers. */
  readonly missing: readonly LinkRow[];
  /** Links between two explored capabilities that no import backs, each with the imports running the other way. */
  readonly unbacked: readonly (LinkRow & { readonly reverse: readonly LinkImport[] })[];
  /** Links this cannot check, and why. */
  readonly unchecked: readonly { readonly from: Named; readonly to: Named; readonly why: string }[];
  readonly refused: boolean;
  readonly ceiling: number;
  readonly note: string;
};

const posix = (file: string): string => path.resolve(file).split(path.sep).join("/");

/** The links of the mapped story `select` names (story:<name|id>) checked against its imports, read from disk only now. */
export async function linksOf(
  tree: AnnotatedTree, survey: Readonly<Record<string, StorySurvey>>, checkout: string, select: string,
  { ceiling = CEILING, readText = async (file: string) => (await import("node:fs/promises")).readFile(file, "utf8") }: { ceiling?: number; readText?: (file: string) => Promise<string> } = {},
): Promise<LinksAnswer> {
  const wanted = select.startsWith("story:") ? select.slice(6) : select;
  const story = tree.stories.find((each) => each.id === wanted || each.title.toLowerCase() === wanted.toLowerCase());
  const mapped = story === undefined ? undefined : survey[story.id]?.mapped;
  if (story === undefined || story.mapped === undefined || mapped === undefined) throw new Error(`${wanted} is not a mapped story this machine imports.`);
  const island = posix(mapped.folder);
  const named = new Map<string, Named>();
  for (const each of tree.stories) for (const { id, title } of each.capabilities) named.set(id, { id, title });
  const explored = new Set(story.capabilities.filter(({ covers }) => covers !== undefined && covers.length > 0).map(({ id }) => id));

  // Each file of an explored capability, by full path, and the capability it belongs to.
  const owner = new Map<string, string>();
  for (const file of survey[story.id]!.files) if (file.capability !== undefined && explored.has(file.capability)) owner.set(`${island}/${file.path}`, file.capability);

  const { known, importsFrom } = await islandImports(tree, survey, checkout, island, readText);
  // The imports from one capability's files to another's, by `from>to` capability ids.
  const between = new Map<string, LinkImport[]>();
  await Promise.all([...owner.keys()].map(async (full) => {
    const from = owner.get(full)!;
    for (const to of new Set(await importsFrom(known.get(full)!))) {
      const target = owner.get(to);
      if (target === undefined || target === from) continue;
      const key = `${from}>${target}`;
      between.set(key, [...between.get(key) ?? [], { from: known.get(full)!.shown, to: known.get(to)!.shown }]);
    }
  }));
  const sorted = (rows: readonly LinkImport[] = []): LinkImport[] => [...rows].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const linked = new Set<string>();
  const unbacked: (LinkRow & { reverse: LinkImport[] })[] = [];
  const unchecked: { from: Named; to: Named; why: string }[] = [];
  for (const capability of story.capabilities) {
    for (const on of capability.dependsOn) {
      const from = named.get(capability.id)!;
      const to = named.get(on) ?? { id: on, title: on };
      linked.add(`${capability.id}>${on}`);
      const elsewhere = !story.capabilities.some(({ id }) => id === on);
      if (elsewhere || !explored.has(on) || !explored.has(capability.id)) {
        unchecked.push({ from, to, why: elsewhere ? "another story's capability" : `${explored.has(on) ? from.title : to.title} covers no files` });
      } else if (!between.has(`${capability.id}>${on}`)) {
        unbacked.push({ from, to, count: 0, imports: [], reverse: sorted(between.get(`${on}>${capability.id}`)) });
      }
    }
  }
  const missing: LinkRow[] = [...between].filter(([key]) => !linked.has(key)).map(([key, imports]) => {
    const [from, to] = key.split(">") as [string, string];
    return { from: named.get(from)!, to: named.get(to)!, count: imports.length, imports: sorted(imports) };
  });
  const byTitles = (a: { from: Named; to: Named }, b: { from: Named; to: Named }) => a.from.title.localeCompare(b.from.title) || a.to.title.localeCompare(b.to.title);
  missing.sort(byTitles);
  unbacked.sort(byTitles);
  unchecked.sort(byTitles);

  const listed = missing.reduce((sum, row) => sum + row.count, 0) + unbacked.reduce((sum, row) => sum + row.reverse.length, 0);
  const refused = listed > ceiling;
  return {
    story: { id: story.id, title: story.title }, island: path.resolve(mapped.folder), explored: explored.size,
    missing: refused ? missing.map((row) => ({ ...row, imports: [] })) : missing,
    unbacked: refused ? unbacked.map((row) => ({ ...row, reverse: [] })) : unbacked,
    unchecked, refused, ceiling, note: CROSSING_NOTE,
  };
}

/** The CLI and the focus tool share this readable answer as well as the JSON. */
export function formatLinks(answer: LinksAnswer): string {
  const imports = (count: number) => `${count} ${count === 1 ? "import" : "imports"}`;
  const rows = (list: readonly LinkImport[]) => list.map(({ from, to }) => `    ${from} -> ${to}`);
  const lines = [`Links of ${answer.story.title} checked against its imports, from ${answer.island}: ${answer.explored} explored ${answer.explored === 1 ? "capability" : "capabilities"}.`];
  lines.push(`Missing links (imports no link covers): ${answer.missing.length}`);
  for (const row of answer.missing) lines.push(`  ${row.from.title} -> ${row.to.title}: ${imports(row.count)}`, ...rows(row.imports));
  lines.push(`Unbacked links (no import backs them): ${answer.unbacked.length}`);
  for (const row of answer.unbacked) lines.push(`  ${row.from.title} -> ${row.to.title}${row.reverse.length === 0 ? "" : "; imports run the other way:"}`, ...rows(row.reverse));
  if (answer.unchecked.length > 0) {
    lines.push(`Not checked: ${answer.unchecked.length}`);
    for (const row of answer.unchecked) lines.push(`  ${row.from.title} -> ${row.to.title}: ${row.why}`);
  }
  if (answer.refused) lines.push(`Imports not listed: more than the ceiling of ${answer.ceiling}; each link keeps its count. Use crossing with cap:<id> on one capability to list its imports.`);
  lines.push(answer.note);
  return lines.join("\n");
}
