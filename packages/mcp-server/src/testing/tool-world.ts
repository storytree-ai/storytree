/**
 * A project for the agent tools' tests (capability 6): a throwaway folder set up as a fresh project, with its
 * library and activity log, and the plan most tests start from, planned through the tools. Shared by the
 * agent-tools test files, which are split so a unit runs them side by side.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { connect, type Library } from "@storytree/library";

import { openActivityLog, type ActivityLog } from "@storytree/session-management";
import { MARKER_FILE } from "@storytree/session-management";
import { idOf, type Agent } from "./agent.js";
import { withTempDir } from "@storytree/session-management/testing/folders";
import { approveCheckout, dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/session-management/testing/pg";

/** The toolbox: every tool the server offers. */
export const TOOLS = [
  "add_remedies",
  "attach_workspace",
  "check_setup",
  "claim",
  "clear_own_runs",
  "clear_wait",
  "close_increment",
  "close_out",
  "correct_note",
  "correct_question",
  "edit_plan",
  "focus",
  "health_worklist",
  "land",
  "list_all_runs",
  "list_own_runs",
  "make_workspace",
  "mark_built",
  "move_increment",
  "name_session",
  "open",
  "park_arc",
  "park_increment",
  "plan_arc",
  "plan_capability",
  "plan_contract",
  "plan_story",
  "present_question",
  "raise_question",
  "read_context",
  "record_friction",
  "record_resteer",
  "reinforce",
  "release",
  "report",
  "retire_from_plan",
  "retire_question",
  "search_notes",
  "set_up_project",
  "set_wait",
  "settle_question",
  "show_plan",
  "stale_claims",
  "stop_own_run",
  "wire_pipeline",
  "write_note",
];

/** A founding decision: every story and capability planned through the tools is born with one (ADR-0627 D5). */
export const FOUNDED = { founding: { title: "Email first", text: "Signing up by email is the smallest thing that works" } };

export interface World {
  folder: string;
  project: string;
  library: Library;
  log: ActivityLog;
}

/** Run `body` with a throwaway folder set up as a fresh project, and that project's library and log. */
export async function withProject(body: (world: World) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    await approveCheckout(folder, project);
    const storytree = await connect({ url: testServerUrl() });
    const log = await openActivityLog(testServerUrl());
    try {
      await body({ folder, project, library: await storytree.openProject(project), log });
    } finally {
      try {
        await log.close();
        await storytree.close();
      } finally {
        await dropTestProjects([project]);
      }
    }
  });
}

/** A story, an arc growing it, and a capability, planned through the tools. */
export async function planned(agent: Agent) {
  const story = idOf(await agent.call("plan_story", { title: "Visitor can sign up", ...FOUNDED }));
  const arc = idOf(await agent.call("plan_arc", { title: "Launch v1", intent: "Ship sign-up", end_state: "Visitors can sign up", stories: [story] }));
  const capability = idOf(await agent.call("plan_capability", { story, title: "Email form", ...FOUNDED }));
  return { story, arc, capability };
}
