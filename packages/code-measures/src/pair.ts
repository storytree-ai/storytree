/**
 * Capability 2 · Measures paired with their readers (contract 2.1, ADR-1354). A package declares its readers in its
 * package.json, under `storytree.measures`: each entry a module, by the package's export path (`from`), and the export
 * holding an array of readers, each naming the measure record's id and the version it reads. Pairing reads the live
 * measure records and every workspace package's readers and names, per story, each measure that does not pair, with why.
 * It reads no value: a reader's `read` is never called.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** One reader as a package declares it, with the package's folder and that package's story. */
export interface MeasureReader {
  /** The package's folder, `packages/<dir>`. */
  readonly package: string;
  /** The story its package.json names, if it names one. */
  readonly story: string | undefined;
  readonly measure: string;
  readonly version: number;
}

/**
 * Why a measure does not pair: no package of its story reads it, a reader names no live record, its one reader reads
 * another version, its one reader is in another story's package, or two readers read it.
 */
export type UnpairedWhy = "no-reader" | "no-record" | "version" | "wrong-story" | "two-readers";

/** A measure that does not pair, with why and the packages whose readers name it. */
export interface Unpaired {
  readonly measure: string;
  readonly why: UnpairedWhy;
  readonly packages: readonly string[];
}

/** One story's pairing: the measures paired, and each one that does not pair. */
export interface StoryPairing {
  readonly story: string;
  readonly paired: string[];
  readonly unpaired: Unpaired[];
}

/** A live measure record as pairing reads it: its id, and its fields' story and version. */
export interface MeasureRecord {
  readonly id: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** The file an export path of a package's exports map names: the path itself, or its import (else default) condition. */
function exportTarget(exports: unknown, from: string): string | undefined {
  if (typeof exports !== "object" || exports === null) return undefined;
  const target = (exports as Record<string, unknown>)[from];
  if (typeof target === "string") return target;
  if (typeof target !== "object" || target === null) return undefined;
  const conditions = target as Record<string, unknown>;
  const chosen = conditions["import"] ?? conditions["default"];
  return typeof chosen === "string" ? chosen : undefined;
}

/**
 * Every reader the workspace packages under `folder`/packages declare, each with its package folder and that package's
 * story. A package declaring none adds none. Each module is imported and its export's array read; no reader is read.
 */
export async function measureReadersOf(folder: string): Promise<MeasureReader[]> {
  const root = path.join(folder, "packages");
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
  const readers: MeasureReader[] = [];
  for (const dir of dirs) {
    const home = path.join(root, dir);
    const text = await readFile(path.join(home, "package.json"), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const manifest = JSON.parse(text) as { story?: unknown; exports?: unknown; storytree?: { measures?: unknown } };
    const entries = manifest.storytree?.measures;
    if (!Array.isArray(entries)) continue;
    const story = typeof manifest.story === "string" ? manifest.story : undefined;
    for (const entry of entries as { from?: unknown; export?: unknown }[]) {
      const target = typeof entry.from === "string" ? exportTarget(manifest.exports, entry.from) : undefined;
      if (target === undefined || typeof entry.export !== "string") {
        throw new Error(`packages/${dir} declares measure readers from ${JSON.stringify(entry.from)}, which its exports map does not name`);
      }
      const module = (await import(pathToFileURL(path.join(home, target)).href)) as Record<string, unknown>;
      const listed = module[entry.export];
      if (!Array.isArray(listed)) throw new Error(`packages/${dir}'s ${target} exports no array of measure readers as ${entry.export}`);
      for (const reader of listed as { measure?: unknown; version?: unknown }[]) {
        readers.push({ package: `packages/${dir}`, story, measure: String(reader.measure), version: Number(reader.version) });
      }
    }
  }
  return readers;
}

/**
 * Pair each live measure record with the readers of its id (contract 2.1), per story: a record read once, at its version,
 * in a package of its story is paired; any other is named with why. A reader of no live record is named under its
 * package's story. One entry for each story with a record or a reader, in story id order.
 */
export function pairMeasures(records: readonly MeasureRecord[], readers: readonly MeasureReader[]): StoryPairing[] {
  const stories = new Map<string, StoryPairing>();
  const of = (story: string): StoryPairing => {
    let pairing = stories.get(story);
    if (pairing === undefined) stories.set(story, (pairing = { story, paired: [], unpaired: [] }));
    return pairing;
  };
  for (const { id, fields } of records) {
    const pairing = of(String(fields["story"]));
    const reading = readers.filter(({ measure }) => measure === id);
    const packages = reading.map((reader) => reader.package);
    const only = reading[0];
    if (only === undefined) pairing.unpaired.push({ measure: id, why: "no-reader", packages });
    else if (reading.length > 1) pairing.unpaired.push({ measure: id, why: "two-readers", packages });
    else if (only.story !== fields["story"]) pairing.unpaired.push({ measure: id, why: "wrong-story", packages });
    else if (only.version !== fields["version"]) pairing.unpaired.push({ measure: id, why: "version", packages });
    else pairing.paired.push(id);
  }
  const live = new Set(records.map(({ id }) => id));
  const recordless = new Map<string, Unpaired & { packages: string[] }>();
  for (const reader of readers) {
    const pairing = of(reader.story ?? "");
    if (live.has(reader.measure)) continue;
    const key = `${pairing.story} ${reader.measure}`;
    const named = recordless.get(key);
    if (named !== undefined) named.packages.push(reader.package);
    else {
      const fresh = { measure: reader.measure, why: "no-record" as const, packages: [reader.package] };
      recordless.set(key, fresh);
      pairing.unpaired.push(fresh);
    }
  }
  return [...stories.values()].sort((a, b) => a.story.localeCompare(b.story));
}

const WHY: Readonly<Record<UnpairedWhy, (packages: readonly string[]) => string>> = {
  "no-reader": () => "no reader: no package reads it",
  "no-record": (packages) => `no record: read in ${packages.join(", ")}, but no live measure has this id`,
  version: (packages) => `read at another version than its record's, in ${packages.join(", ")}`,
  "wrong-story": (packages) => `read only in another story's package: ${packages.join(", ")}`,
  "two-readers": (packages) => `read twice, in ${packages.join(" and ")}: one reader each`,
};

/** The pairing as text (contract 2.2): per story by title, each measure by title, paired or with why it does not pair. */
export function pairingText(pairings: readonly StoryPairing[], titles: ReadonlyMap<string, string>): string {
  if (pairings.length === 0) return "Nothing to pair: no measure record and no measure reader.";
  const lines: string[] = [];
  for (const { story, paired, unpaired } of pairings) {
    if (lines.length > 0) lines.push("");
    lines.push(story === "" ? "A package of no story" : `${titles.get(story) ?? story} (${story})`);
    const named = (measure: string) => (titles.has(measure) ? `${titles.get(measure)} (${measure})` : measure);
    for (const measure of paired) lines.push(`  ${named(measure)}: paired`);
    for (const { measure, why, packages } of unpaired) lines.push(`  ${named(measure)}: ${WHY[why](packages)}`);
  }
  return lines.join("\n");
}
