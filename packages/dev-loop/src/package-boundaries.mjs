// Capability 3 · Package boundaries. Which parts of this repo break the package boundaries of ADR-0649 D1-D3 (in storytree 0.2's
// decision log). The rule's code is the Guardrails story's (packages/guardrails, ADR-0911 D2), the same
// code a user's project runs as `storytree check`; this file holds only storytree's own declarations, and
// packages/dev-loop/src/package-boundaries.test.mjs runs the rule over the repo with them in `pnpm test` and CI.
//
// - The frame is the app story's `packages/app` and `apps/desktop` (startup, lifecycle, updates and
//   mounting each story's surface); the front door is the cli story's `packages/cli` (command families
//   that call the story package owning the work), and the MCP server story's `packages/mcp-server` is the
//   second front door (ADR-0969 D1). None holds another story's code.
// - No story leans on the frame or the front door (ADR-0847 D1) unless the owner sanctioned that edge
//   in the repo's storytree.check.json, with his own words and the date (D2), where `storytree check` reads it too. The list holds only
//   his exceptions; a lane never adds one.
//
// The stories live only in the library (ADR-0641), which CI cannot read, so their ids are declared
// here: a story added to the library is added to STORIES with its package, in the same change.

import { readFileSync } from "node:fs";
import { packageProblems } from "@storytree/guardrails";
import { ALSO_OWNED } from "@storytree/map/package-of";

/** 0.3's own stories, each by the id its package has (packages/<id>); one that owns several declares the others in the map's ALSO_OWNED (ADR-1066 D3). */
export const STORIES = ["app", "app-setup", "arc-surface", "ci-health", "claude-code-mod", "cli", "dev-loop", "experiments", "forest", "forest-world", "guardrails", "journey-events", "lag-in-use", "learning-as-you-build", "knowledge-core", "librarian", "library", "local-postgres", "map", "mcp-server", "plugin-loader", "processes", "project-and-caller", "quality-assurance", "reading-the-front-doors", "session-management", "website"];
// app-setup: story_b91056a06337 (The app setup).
// processes: story_9abd84ab493f (Process ledger).
// dev-loop: story_95ed402f9bd3 (The dev loop, ADR-0805 D3).
// forest-world: story_ca702fee28cb (The world, ADR-0805 D1).
// local-postgres: story_1d360b6227d8 (The local database, ADR-0805 D2).
// journey-events: story_9eb523952644 (Journey events).
// ci-health: story_5c212e7a9a6c (CI health, ADR-0902).
// guardrails: Guardrails, ADR-0911 D2.
// mcp-server: The MCP server, ADR-0969 D1.
// quality-assurance: story_421e473f0a99 (Quality assurance, ADR-0956 D2).
// reading-the-front-doors: story_f8cd75d15d57 (Reading the front doors, ADR-0998).
// lag-in-use: story_1c73ed7506ca (Lag in real use, ADR-1001 D4).
// project-and-caller: story_6def59292b78 (Context, ADR-1025), which owns keys and identity too (ADR-1066 D4).
// plugin-loader: story_09e58d68f87c (Plugin loader, ADR-1021).
// learning-as-you-build: story_7d7b0ffccf55 (Learning as you build, ADR-1048).
// experiments: story_c2dbcf855db2 (Experiments, ADR-1064 D1).
// claude-code-mod: story_3def3732e802 (The Claude Code mod, ADR-1056 D3).

/** STORIES with the packages each owns beyond its own (ADR-1066 D3), as the package and allocation rules take them. */
export const OWNED = STORIES.map((story) => Object.hasOwn(ALSO_OWNED, story) ? { story, packages: [story, ...ALSO_OWNED[story]] } : story);

/**
 * Story code the frame still holds, each with the open question on storytree-0-3-scales-arc that
 * decides when it moves into its story's package. An entry that no longer holds anything is a
 * problem too, so the list is emptied as the code moves.
 */
export const NOT_YET_MOVED = [];

/**
 * The frame and the two front doors, which mount and front the stories and hold none of their code: the
 * command line, and the MCP server an agent's harness starts (ADR-0969 D1), on which no story may depend either.
 * They are declared in the repo's storytree.check.json, which `storytree check` reads too, so the two agree.
 */
const DECLARED = JSON.parse(readFileSync(new URL("../../../storytree.check.json", import.meta.url), "utf8"));
export const FRAMES = DECLARED.frames;

/** The owner's exceptions to the frame rule: { edges: [{ from, to, said, on }] }, each in his own words, with the date. */
export const EDGES = { edges: DECLARED.edges };

/** What in the repo at `root` breaks the boundaries, one sentence each; empty when nothing does. */
export function boundaryProblems(root) {
  return packageProblems(root, { stories: OWNED, frames: FRAMES, notYetMoved: NOT_YET_MOVED, edges: EDGES });
}
