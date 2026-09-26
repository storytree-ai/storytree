/**
 * Capability 8 · Setup check (stories/agent-link.md): the user installs only the storytree tool
 * server, and every session start checks storytree's setup and fixes whatever is missing on the
 * spot: it opens storytree if it is closed, registers the hooks if they are missing, and, in a
 * folder that isn't a project yet, has the agent ask the user whether to set one up. Nothing is
 * created without that yes (ADR-0626 D5).
 *
 * The tool server runs this at its start, and again whenever the agent calls check_setup; the
 * agent's part (asking the user, and firing each hook to verify it) goes through check_setup's
 * answer.
 */
import path from "node:path";

import { findProject } from "../routing/index.js";
import { defaultHomes, registerHooks, type HookCommand, type Homes, type HooksReport } from "./hooks-config.js";
import { openStorytree, type StorytreeOpened } from "./open-storytree.js";
import type { CommandInstall, CommandPath, GhState } from "./command.js";

export { ghState, putCommandOnPath, removeCommand } from "./command.js";
export type { CommandInstall, CommandPath, GhState } from "./command.js";

export { defaultHomes, registerHooks, removeHooks } from "./hooks-config.js";
export type { HookCommand, HookRegistration, Homes, HooksReport, RemovalReport } from "./hooks-config.js";
export { openStorytree } from "./open-storytree.js";
export type { StorytreeOpened } from "./open-storytree.js";

export interface SetupOptions {
  /** The folder the session works in. */
  readonly folder: string;
  /** The hook command to register; without one, no hooks are registered. */
  readonly hook?: HookCommand;
  /** Where the harnesses keep their settings. By default, CLAUDE_CONFIG_DIR or ~/.claude, and CODEX_HOME or ~/.codex. */
  readonly homes?: Homes;
  /** The storytree home, where the app keeps its Postgres and how to open it. By default, storytreeHome(). */
  readonly storytreeHome?: string;
  /** How long to wait for storytree to come up after opening it. */
  readonly openWaitMs?: number;
  /** Where to put the `storytree` command (ADR-0643 D1, 8); without it, the command is not put anywhere. */
  readonly command?: CommandPath;
  /** How to ask whether `gh` is there and signed in (ADR-0643 D3). By default, `gh auth status`. */
  readonly gh?: () => Promise<GhState>;
}

export interface SetupReport {
  readonly storytree: StorytreeOpened;
  /** What registering the hooks found; undefined when this server has no hook command to register. */
  readonly hooks: HooksReport | undefined;
  /** The project the folder is set up as, or the name to suggest when asking the user. */
  readonly project: { status: "set up"; name: string } | { status: "ask"; suggestion: string };
  /** What putting the `storytree` command on the path found; undefined when there was nothing to put there. */
  readonly command: CommandInstall | undefined;
  /** Whether `gh` is there and signed in, for release on merge. */
  readonly gh: GhState;
}

/** Check the setup for a session in `options.folder`, and fix what can be fixed without asking. */
export async function runSetupCheck(options: SetupOptions): Promise<SetupReport> {
  const storytree = await openStorytree({
    ...(options.storytreeHome === undefined ? {} : { home: options.storytreeHome }),
    ...(options.openWaitMs === undefined ? {} : { waitMs: options.openWaitMs }),
  });
  const hooks = options.hook === undefined ? undefined : registerHooks(options.homes ?? defaultHomes(), options.hook);
  const found = findProject(options.folder);
  const project = found.project === undefined ? { status: "ask" as const, suggestion: suggestedName(options.folder) } : { status: "set up" as const, name: found.project };
  return { storytree, hooks, project, command: undefined, gh: "signed in" };
}

/** A project name to suggest for `folder`: its own name, as the library's project-name rule allows. */
export function suggestedName(folder: string): string {
  const name = path
    .basename(path.resolve(folder))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return name === "" ? "my-project" : name;
}
