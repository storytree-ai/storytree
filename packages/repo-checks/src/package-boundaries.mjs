// Capability 5 · Package boundaries

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageProblems } from "./rules/package-rule/package-rule.ts";

const STORY_ID = /^story_[0-9a-f]{12}$/;

function markedPackages(root) {
  const dir = path.join(root, "packages");
  let folders;
  try {
    folders = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
  const marked = [];
  for (const folder of folders) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, folder, "package.json"), "utf8").replace(/^\uFEFF/, ""));
    } catch {
      continue;
    }
    const story = manifest?.story;
    if (typeof story === "string" && STORY_ID.test(story)) marked.push({ folder, story });
  }
  return marked;
}

function sharedStoryProblems(marked) {
  const byStory = new Map();
  for (const { folder, story } of marked) byStory.set(story, [...(byStory.get(story) ?? []), folder]);
  return [...byStory]
    .filter(([, folders]) => folders.length > 1)
    .map(([story, folders]) => `${folders.map((folder) => `packages/${folder}`).join(" and ")} name the same story ${story} in their package.json: a story owns exactly one package (ADR-1078 rule 4)`);
}

export const STORIES = markedPackages(fileURLToPath(new URL("../../..", import.meta.url))).map(({ folder }) => folder);

export const NOT_YET_MOVED = [];

const DECLARED = JSON.parse(readFileSync(new URL("../../../storytree.check.json", import.meta.url), "utf8"));
export const FRAMES = DECLARED.frames;

export const EDGES = { edges: DECLARED.edges };

export function boundaryProblems(root) {
  const marked = markedPackages(root);
  const stories = marked.map(({ folder }) => folder);
  return [...sharedStoryProblems(marked), ...packageProblems(root, { stories, frames: FRAMES, notYetMoved: NOT_YET_MOVED, edges: EDGES })];
}
