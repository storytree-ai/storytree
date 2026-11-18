// Capability 2 · Storytree projects
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { packageOf } from "@storytree/map";

import type { CaptureSeed, SeededCaptureOptions } from "./runner.js";

const seeds = path.resolve(import.meta.dirname, "../../../../packages/forest/testing/view");

const SEEDS = {
  "code-rows": { folder: "code-rows", seed: "seed.json.gz", survey: "survey.json" },
  forest: { folder: "library-dots-clickable", seed: "seed.json", survey: undefined },
} as const;

export type CaptureSeedName = keyof typeof SEEDS;

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

export const loadedSeedLayouts = (): Record<string, string> => ({ ...lastLayouts });

export const seedLayoutsFile = (name: CaptureSeedName): string => path.join(seeds, SEEDS[name].folder, "layouts.json.gz");

export function seedFile(seed: { tree: { stories: readonly { id: string; title: string }[] } }, story: string, pathInPackage: string): string {
  const found = seed.tree.stories.find(one => one.id === story || one.title === story);
  if (found === undefined) throw new Error(`The capture seed has no story ${story}; its stories are ${seed.tree.stories.map(one => one.title).join(", ")}.`);
  return `packages/${packageOf(found)}/${pathInPackage}`;
}
