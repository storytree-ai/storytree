// Capability 1 · Base structure measures
import { functionsOf } from "./complexity.js";
import { linesOf, sourcesOf, type SourceText } from "./source.js";

export const TOP_FILES = 10;

export interface ChurnFile {
  readonly path: string;
  readonly churn: number;
  readonly complexity: number;
  readonly score: number;
}

export interface ChurnReading {
  readonly added: number;
  readonly deleted: number;
  readonly relative: number;
  readonly top: readonly ChurnFile[];
}

function renamed(path: string): [string, string] {
  const tidy = (one: string) => one.replace(/\/{2,}/g, "/");
  const open = path.lastIndexOf("{");
  const middle = open < 0 ? -1 : path.indexOf(" => ", open + 1);
  const close = middle < 0 ? -1 : path.indexOf("}", middle + 4);
  if (close >= 0) {
    const [before, from, to, after] = [path.slice(0, open), path.slice(open + 1, middle), path.slice(middle + 4, close), path.slice(close + 1)];
    return [tidy(`${before}${from}${after}`), tidy(`${before}${to}${after}`)];
  }
  const arrow = path.indexOf(" => ");
  return arrow < 0 ? [path, path] : [path.slice(0, arrow), path.slice(arrow + 4)];
}

export function churnOf(numstat: string, files: readonly SourceText[]): ChurnReading {
  const sources = sourcesOf(files);
  const measured = new Set(sources.map((file) => file.path));
  const now = new Map<string, string>();
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
