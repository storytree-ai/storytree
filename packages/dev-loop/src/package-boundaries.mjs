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

/** 0.3's own stories, each by the id its one package has (packages/<id>): a story owns exactly one package (ADR-1078 rule 4). */
export const STORIES = ["agent-pool", "app", "app-setup", "arc-surface", "base-dev-loop", "ci-health", "cli", "dev-loop", "experiments", "forest", "forest-world", "guardrails", "keys", "knowledge-core", "library", "local-postgres", "map", "mark", "mcp-server", "plugin-loader", "project-and-caller", "quality-assurance", "service-host", "session-management", "surface-feedback", "test-waits", "voice", "website"];
// agent-pool: story_b2051c0f7372 (Agent runner, ADR-1071 D3), which holds the Claude Code mod in src/claude-code-mod (ADR-1076 D5).
// app-setup: story_b91056a06337 (Setup), which holds Journey events in src/journey-events (ADR-1076 D3).
// app: story_a93c6fb1a257 (Desktop app), which holds Lag in real use in src/lag (ADR-1071 D3).
// base-dev-loop: Base dev loop (ADR-1170 D1): the gate runner, its step interface and its results table.
// dev-loop: story_95ed402f9bd3 (Mick's dev loop, ADR-0805 D3, ADR-1170 D3), the personal half around the base dev loop.
// forest: story_deee4230348c (Map view).
// forest-world: story_ed2c6b55715d (The drawing engine, ADR-1076 D2), out of Map view again: Map view and the Website call it.
// library: story_754e87e7d531 (The library), which holds the librarian in its own package (ADR-1071 D3).
// keys: story_d47051f035f0 (Keys, ADR-1075), out of The library again: The library and Experiments call it.
// local-postgres: story_5e19e65c3433 (The local database, ADR-1076 D1), out of The library again: Setup and the dev loop call it.
// ci-health: story_5c212e7a9a6c (CI health, ADR-0902).
// guardrails: Guardrails, ADR-0911 D2.
// mcp-server: The MCP server, ADR-0969 D1, which reads its own tools' use (ADR-1071 D3).
// quality-assurance: story_421e473f0a99 (Quality assurance, ADR-0956 D2).
// project-and-caller: story_6def59292b78 (Context, ADR-1025), which owns identity too (ADR-1066 D4).
// plugin-loader: story_09e58d68f87c (Plugin loader, ADR-1021).
// website: story_769e230c466d (Website), which holds Onboarding overlays in src/overlays (ADR-1076 D4).
// experiments: story_c2dbcf855db2 (Experiments, ADR-1064 D1).
// mark: story_08790ee19bbf (Marketing artifacts, ADR-1071 D3), out of Website again.
// voice: story_28e1eb40e8c1 (Voice, ADR-1132), a front door: claude.ai's voice mode reaching storytree read-only.
// surface-feedback: story_6c75e0587cc6 (Surface feedback): the feedback corner, mounted by the frame.
// service-host: story_44a8cd58a7cf (Service host, ADR-1180 D2): one host per machine runs the mounted parts' declared services.
// test-waits: story_9299f25282ad (Test waits, ADR-1156): every package's tests import it, so it depends on no workspace package.

/**
 * Story code the frame still holds, each with the open question on storytree-0-3-scales-arc that
 * decides when it moves into its story's package. An entry that no longer holds anything is a
 * problem too, so the list is emptied as the code moves.
 */
export const NOT_YET_MOVED = [];

/**
 * The frame and the three front doors, which mount and front the stories and hold none of their code: the
 * command line, the MCP server an agent's harness starts (ADR-0969 D1), and the voice door claude.ai calls
 * (ADR-1132 D2), on which no story may depend either.
 * They are declared in the repo's storytree.check.json, which `storytree check` reads too, so the two agree.
 */
const DECLARED = JSON.parse(readFileSync(new URL("../../../storytree.check.json", import.meta.url), "utf8"));
export const FRAMES = DECLARED.frames;

/** The owner's exceptions to the frame rule: { edges: [{ from, to, said, on }] }, each in his own words, with the date. */
export const EDGES = { edges: DECLARED.edges };

/** What in the repo at `root` breaks the boundaries, one sentence each; empty when nothing does. */
export function boundaryProblems(root) {
  return packageProblems(root, { stories: STORIES, frames: FRAMES, notYetMoved: NOT_YET_MOVED, edges: EDGES });
}
