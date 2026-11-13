/**
 * Capability 2 · Storytree projects. The capture kit's shared seeds: read-only library snapshots a capture replays instead of
 * exporting its own, each refreshed by the script beside it. A capture names a story's file through `seedFile`, by the package
 * the seed's own story title gives, never a live package name: the globe draws the seed's stories, so a later rename of the
 * live package cannot desync a capture's rows from the snapshot it pictures.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { packageOf } from "@storytree/map";

import type { CaptureSeed, SeededCaptureOptions } from "./runner.js";

const seeds = path.resolve(import.meta.dirname, "../../../../packages/forest/testing/view");

/**
 * The shared seeds by name. `code-rows` is storytree's own library and its code survey (refresh: `node --import tsx seed.mts`
 * in its folder, which reads the library and writes nothing to it; a capture naming islands it lacks takes fresh-seed.ts's
 * `seedHolding` instead); `forest` is the eight-story isolated forest snapshot
 * (refresh: its `export.mjs`, with STORYTREE_HOME set to the isolated capture seed).
 */
const SEEDS = {
  "code-rows": { folder: "code-rows", seed: "seed.json.gz", survey: "survey.json" },
  forest: { folder: "library-dots-clickable", seed: "seed.json", survey: undefined },
} as const;

export type CaptureSeedName = keyof typeof SEEDS;

/**
 * A fresh copy of a shared seed, with its code survey when it has one and the layouts its map kept once settled
 * (`layouts.json.gz` beside it, refreshed by `layouts.mts` in code-rows): a capture may change its copy freely.
 */
export function captureSeed(name: CaptureSeedName): { seed: CaptureSeed; survey: SeededCaptureOptions["survey"]; layouts: Record<string, string> } {
  const { folder, seed, survey } = SEEDS[name];
  const read = (file: string): string => {
    const bytes = readFileSync(path.join(seeds, folder, file));
    return (file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8");
  };
  const layouts = JSON.parse(read("layouts.json.gz")) as Record<string, string>;
  lastLayouts = layouts;
  return { seed: JSON.parse(read(seed)) as CaptureSeed, survey: survey === undefined ? undefined : JSON.parse(read(survey)), layouts: { ...layouts } };
}

let lastLayouts: Readonly<Record<string, string>> = {};

/**
 * The kept layouts of the shared seed this process read last, none before it reads one: what a capture's stand-in bridge
 * opens the page with unless handed its own (2.64). Never two seeds' at once: each keeps one arrangement per story, and the
 * seeds share stories laid out differently.
 */
export const loadedSeedLayouts = (): Record<string, string> => ({ ...lastLayouts });

/** Where a shared seed's `layouts.json.gz` lies, which its `layouts.mts` refresh writes. */
export const seedLayoutsFile = (name: CaptureSeedName): string => path.join(seeds, SEEDS[name].folder, "layouts.json.gz");

/** A seed story's file, `packages/<package>/<path in the package>`, the story found by id or title; a story the seed lacks fails naming the ones it has. */
export function seedFile(seed: { tree: { stories: readonly { id: string; title: string }[] } }, story: string, pathInPackage: string): string {
  const found = seed.tree.stories.find(one => one.id === story || one.title === story);
  if (found === undefined) throw new Error(`The capture seed has no story ${story}; its stories are ${seed.tree.stories.map(one => one.title).join(", ")}.`);
  return `packages/${packageOf(found)}/${pathInPackage}`;
}
