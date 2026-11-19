// Capability 2 · Measures paired with their readers
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { StoryMeasures } from "./read.js";

export interface MeasureReader {
  readonly package: string;
  readonly story: string | undefined;
  readonly measure: string;
  readonly version: number;
  readonly read?: (story: StoryMeasures) => unknown;
  readonly sample?: (at: { folder: string; commit: string; tree: unknown; project: string; server: unknown }) => Promise<unknown>;
}

export type UnpairedWhy = "no-reader" | "no-record" | "version" | "wrong-story" | "two-readers";

export interface Unpaired {
  readonly measure: string;
  readonly why: UnpairedWhy;
  readonly packages: readonly string[];
}

export interface StoryPairing {
  readonly story: string;
  readonly paired: string[];
  readonly unpaired: Unpaired[];
}

export interface MeasureRecord {
  readonly id: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

function exportTarget(exports: unknown, from: string): string | undefined {
  if (typeof exports !== "object" || exports === null) return undefined;
  const target = (exports as Record<string, unknown>)[from];
  return typeof target === "string" ? target : undefined;
}

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
      for (const reader of listed as { measure?: unknown; version?: unknown; read?: unknown; sample?: unknown }[]) {
        const read = typeof reader.read === "function" ? { read: reader.read.bind(reader) as (story: StoryMeasures) => unknown } : {};
        const sample = typeof reader.sample === "function" ? { sample: reader.sample.bind(reader) as (at: { folder: string; commit: string; tree: unknown; project: string; server: unknown }) => Promise<unknown> } : {};
        readers.push({ package: `packages/${dir}`, story, measure: String(reader.measure), version: Number(reader.version), ...read, ...sample });
      }
    }
  }
  return readers;
}

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
    if (live.has(reader.measure)) continue;
    const pairing = of(reader.story ?? "");
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
