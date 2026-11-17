// Capability 5 · Package boundaries. Which parts of this repo break the package boundaries of ADR-0649 D1-D3 (in storytree 0.2's
// decision log). The rule's code is this package's capability 9 (src/rules/package-rule, ADR-1199 D5), the same
// code the owner's dev-loop plugin runs as `storytree check`; this file holds only storytree's own declarations, and
// `pnpm lint` (lint.mjs) runs the rule over the repo with them, in `pnpm gate` and in CI on every pull request.
//
// - The frame is the app story's `packages/app` and `apps/desktop` (startup, lifecycle, updates and
//   mounting each story's surface); the front door is the cli story's `packages/cli` (command families
//   that call the story package owning the work), and the MCP server story's `packages/mcp-server` is the
//   second front door (ADR-0969 D1). None holds another story's code.
// - No story leans on the frame or the front door (ADR-0847 D1) unless the owner sanctioned that edge
//   in the repo's storytree.check.json, with his own words and the date (D2), where `storytree check` reads it too. The list holds only
//   his exceptions; a lane never adds one.
//
// The stories live only in the library (ADR-0641), which CI cannot read, so they are not declared
// here: each package's own package.json names its story at a top-level "story" field
// ("story": "story_<12 hex>", contract 5.4), so a new story's package needs no edit of this file.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageProblems } from "./rules/package-rule/package-rule.ts";

/** A story's id as a package names it: "story_" and twelve lower-case hex digits. */
const STORY_ID = /^story_[0-9a-f]{12}$/;

/** The packages under `root`'s packages/ whose package.json names a story, each folder with the story id it names. */
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

/** A sentence for each story id two or more packages name: a story owns exactly one package (ADR-1078 rule 4). */
function sharedStoryProblems(marked) {
  const byStory = new Map();
  for (const { folder, story } of marked) byStory.set(story, [...(byStory.get(story) ?? []), folder]);
  return [...byStory]
    .filter(([, folders]) => folders.length > 1)
    .map(([story, folders]) => `${folders.map((folder) => `packages/${folder}`).join(" and ")} name the same story ${story} in their package.json: a story owns exactly one package (ADR-1078 rule 4)`);
}

/** 0.3's own stories, each by the folder of the package whose package.json names it (packages/<folder>). */
export const STORIES = markedPackages(fileURLToPath(new URL("../../..", import.meta.url))).map(({ folder }) => folder);

/**
 * Story code the frame still holds, each with the open question on storytree-0-3-scales-arc that
 * decides when it moves into its story's package. An entry that no longer holds anything is a
 * problem too, so the list is emptied as the code moves.
 */
export const NOT_YET_MOVED = [];

/**
 * The frame and the two front doors, which mount and front the stories and hold none of their code: the
 * command line and the MCP server an agent's harness starts (ADR-0969 D1), on which no story may depend either.
 * The voice door (ADR-1132 D2) is a plugin in the owner's factory now (ADR-1174), not in this repo.
 * They are declared in the repo's storytree.check.json, which `storytree check` reads too, so the two agree.
 */
const DECLARED = JSON.parse(readFileSync(new URL("../../../storytree.check.json", import.meta.url), "utf8"));
export const FRAMES = DECLARED.frames;

/** The owner's exceptions to the frame rule: { edges: [{ from, to, said, on }] }, each in his own words, with the date. */
export const EDGES = { edges: DECLARED.edges };

/** What in the repo at `root` breaks the boundaries, one sentence each; empty when nothing does. */
export function boundaryProblems(root) {
  const marked = markedPackages(root);
  const stories = marked.map(({ folder }) => folder);
  return [...sharedStoryProblems(marked), ...packageProblems(root, { stories, frames: FRAMES, notYetMoved: NOT_YET_MOVED, edges: EDGES })];
}
