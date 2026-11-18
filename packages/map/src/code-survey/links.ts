// Capability 3 · Counts before detail
import path from "node:path";

import type { AnnotatedTree, StorySurvey } from "@storytree/library";

import { readersReady, type SourceFile } from "./code-survey.js";
import { CEILING, CROSSING_NOTE } from "./crossings.js";
import { importedLinks, manifestsOf } from "./drawing.js";

type Named = { readonly id: string; readonly title: string };

export type LinkImport = { readonly from: string; readonly to: string };

export type LinkRow = { readonly from: Named; readonly to: Named; readonly count: number; readonly imports: readonly LinkImport[] };

export type LinksAnswer = {
  readonly story: Named;
  readonly island: string;
  readonly covering: number;
  readonly missing: readonly LinkRow[];
  readonly unbacked: readonly (LinkRow & { readonly reverse: readonly LinkImport[] })[];
  readonly unchecked: readonly { readonly from: Named; readonly to: Named; readonly why: string }[];
  readonly refused: boolean;
  readonly ceiling: number;
  readonly note: string;
};

const posix = (file: string): string => path.resolve(file).split(path.sep).join("/");

export async function linksOf(
  tree: AnnotatedTree, survey: Readonly<Record<string, StorySurvey>>, checkout: string, select: string,
  { ceiling = CEILING, readText = async (file: string) => (await import("node:fs/promises")).readFile(file, "utf8") }: { ceiling?: number; readText?: (file: string) => Promise<string> } = {},
): Promise<LinksAnswer> {
  const wanted = select.startsWith("story:") ? select.slice(6) : select;
  const story = tree.stories.find((each) => each.id === wanted || each.title.toLowerCase() === wanted.toLowerCase());
  const mapped = story === undefined ? undefined : survey[story.id]?.mapped;
  if (story === undefined || story.mapped === undefined || mapped === undefined) throw new Error(`${wanted} is not an imported story this machine imports.`);
  const island = posix(mapped.folder);
  const named = new Map<string, Named>();
  for (const each of tree.stories) for (const { id, title } of each.capabilities) named.set(id, { id, title });
  const covering = new Set(story.capabilities.filter(({ covers }) => covers !== undefined && covers.length > 0).map(({ id }) => id));

  const owner = new Map<string, string>();
  for (const file of survey[story.id]!.files) if (file.capability !== undefined && covering.has(file.capability)) owner.set(file.path, file.capability);

  const code = (await Promise.all(survey[story.id]!.files.map(async ({ path: file }): Promise<SourceFile | undefined> => {
    const text = await readText(`${island}/${file}`).catch(() => undefined);
    return text === undefined ? undefined : { path: file, text };
  }))).filter((file): file is SourceFile => file !== undefined);
  await readersReady(code.map((file) => file.path));
  const between = new Map<string, LinkImport[]>();
  const manifests = await manifestsOf(code, (file) => readText(`${island}/${file}`).catch(() => undefined));
  for (const { from, to, files } of importedLinks(story.mapped.package, [...code, ...manifests], owner)) {
    if (from !== undefined && to !== undefined) between.set(`${from}>${to}`, files.flatMap((each) => each.to === undefined ? [] : [{ from: each.from, to: each.to }]));
  }
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
      if (elsewhere || !covering.has(on) || !covering.has(capability.id)) {
        unchecked.push({ from, to, why: elsewhere ? "another story's capability" : `${covering.has(on) ? from.title : to.title} covers no files` });
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
    story: { id: story.id, title: story.title }, island: path.resolve(mapped.folder), covering: covering.size,
    missing: refused ? missing.map((row) => ({ ...row, imports: [] })) : missing,
    unbacked: refused ? unbacked.map((row) => ({ ...row, reverse: [] })) : unbacked,
    unchecked, refused, ceiling, note: CROSSING_NOTE,
  };
}

export function formatLinks(answer: LinksAnswer): string {
  const imports = (count: number) => `${count} ${count === 1 ? "import" : "imports"}`;
  const rows = (list: readonly LinkImport[]) => list.map(({ from, to }) => `    ${from} -> ${to}`);
  const lines = [`Links of ${answer.story.title} checked against its imports, from ${answer.island}: ${answer.covering} ${answer.covering === 1 ? "capability covers" : "capabilities cover"} files.`];
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
