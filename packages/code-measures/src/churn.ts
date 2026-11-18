/**
 * Capability 1 · Base structure measures. Relative churn (contract 1.6, B8), from `git log --numstat -M --format=` over a
 * window, newest commit first: the lines added and deleted to a story's source files over its source lines at the commit
 * measured. A rename is followed back, so an older commit's lines under a file's old name count to its name now; a rename
 * changing no lines adds nothing, and one with edits adds only those. Binary files, other folders and tests count nothing.
 * The top files, ten unless fewer, are ranked by their churn times their summed cognitive complexity.
 */
import { functionsOf } from "./complexity.js";
import { linesOf, sourcesOf, type SourceText } from "./source.js";

/** The most top files a reading lists. */
export const TOP_FILES = 10;

/** One top file: its churn in the window, its summed complexity at the commit, and their product. */
export interface ChurnFile {
  readonly path: string;
  readonly churn: number;
  readonly complexity: number;
  readonly score: number;
}

/** A story's churn: lines added and deleted in the window, their sum over its source lines, and its top files. */
export interface ChurnReading {
  readonly added: number;
  readonly deleted: number;
  readonly relative: number;
  readonly top: readonly ChurnFile[];
}

/** The path before and after a numstat line's rename (the same path when it is none): `a => b`, or `pre/{old => new}/post`. */
function renamed(path: string): [string, string] {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  const tidy = (one: string) => one.replace(/\/{2,}/g, "/");
  if (brace !== null) {
    const [, before, from, to, after] = brace;
    return [tidy(`${before}${from}${after}`), tidy(`${before}${to}${after}`)];
  }
  const arrow = path.indexOf(" => ");
  return arrow < 0 ? [path, path] : [path.slice(0, arrow), path.slice(arrow + 4)];
}

/** `files`' churn over the `numstat` of a window, newest commit first. */
export function churnOf(numstat: string, files: readonly SourceText[]): ChurnReading {
  const sources = sourcesOf(files);
  const measured = new Set(sources.map((file) => file.path));
  const now = new Map<string, string>(); // an older name, to the file's name at the commit measured
  const churned = new Map<string, number>();
  let added = 0;
  let deleted = 0;
  for (const line of numstat.split("\n")) {
    const [plus, minus, ...rest] = line.split("\t");
    if (rest.length === 0) continue;
    const [from, to] = renamed(rest.join("\t"));
    const current = now.get(to) ?? to;
    if (from !== to) now.set(from, current);
    if (plus === "-" || minus === "-" || !measured.has(current)) continue;
    added += Number(plus);
    deleted += Number(minus);
    churned.set(current, (churned.get(current) ?? 0) + Number(plus) + Number(minus));
  }
  const lines = sources.reduce((total, file) => total + linesOf(file), 0);
  const top = sources
    .filter((file) => (churned.get(file.path) ?? 0) > 0)
    .map((file): ChurnFile => {
      const churn = churned.get(file.path)!;
      const complexity = functionsOf(file).reduce((total, fn) => total + fn.complexity, 0);
      return { path: file.path, churn, complexity, score: churn * complexity };
    })
    .sort((a, b) => b.score - a.score || b.churn - a.churn || (a.path < b.path ? -1 : 1))
    .slice(0, TOP_FILES);
  return { added, deleted, relative: lines === 0 ? 0 : (added + deleted) / lines, top };
}
