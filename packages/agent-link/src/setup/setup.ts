/**
 * Capability 8 · Setup check (the agent link story): the user installs only the storytree tool
 * server, and every session start checks storytree's setup and fixes whatever is missing on the
 * spot: it opens storytree if it is closed, registers the hooks if they are missing, and says
 * whether the folder is a project. Nothing is created unless the user asks: the installer's folder
 * step, the app's Add project, `storytree doctor --set-up`, or the user asking their agent
 * (ADR-0626 D5, ADR-0752). It also puts the `storytree` command on the user's path,
 * and looks for GitHub's `gh`, signed in, which a claim's release on merge needs (ADR-0643 D1, D3),
 * and for what a first run needs on the machine: Claude Code or Codex signed in, git and Node (ADR-0716).
 *
 * The tool server runs this at its start, and again whenever the agent calls check_setup; the
 * agent's part (firing each hook to verify it) goes through check_setup's answer.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { codexHookTrust } from "../hooks/codex-trust.js";
import { findProject, storytreeHome, suggestedName } from "../routing/index.js";
import { defaultHomes, disconnectedHarnesses, registeredHookScripts, registerHooks, type HookCommand, type Homes, type HooksReport } from "./hooks-config.js";
import { hooksRelease, type HooksRelease, type LatestRelease } from "./hooks-release.js";
import { openStorytree, type StorytreeOpened } from "./open-storytree.js";
import { ghState, putCommandOnPath, type CommandInstall, type CommandPath, type GhState } from "./command.js";
import { setupLines, type SetupLine } from "./diagnostics.js";
import { machineState, type MachineState } from "./machine.js";
import { readAppRecords, type AppPlaces, type AppReading } from "../sessions/app-records.js";

export { suggestedName };

export type { SetupLine } from "./diagnostics.js";
export { machineState, NODE_FLOOR, runsElevated } from "./machine.js";
export type { AgentCliState, MachineOptions, MachineState, ToolState } from "./machine.js";

export { ghState, putCommandOnPath, removeCommand } from "./command.js";
export type { CommandInstall, CommandPath, GhState } from "./command.js";

export { defaultHomes, disconnectedHarnesses, markDisconnected, registerHooks, removeHooks } from "./hooks-config.js";
export type { Harness, HookCommand, HookRegistration, Homes, HooksReport, RemovalReport } from "./hooks-config.js";
export { openStorytree } from "./open-storytree.js";
export type { StorytreeOpened } from "./open-storytree.js";

export interface SetupOptions {
  /** The folder being checked, with or without an agent session. */
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
  /** How to ask the machine for an agent CLI, git and Node (ADR-0716). By default, each by name on the PATH. */
  readonly machine?: () => Promise<MachineState>;
  /** Where the Claude desktop app and Codex keep their session records (ADR-0754 D4). By default, where each app puts them for this user. */
  readonly appPlaces?: AppPlaces;
  /** How to ask for the latest release, to compare the hooks' with (contract 8.18). By default, `gh release view`. */
  readonly latestRelease?: LatestRelease;
}

export interface SetupReport {
  /** Each diagnostic and its fix, usable from a terminal without creating an agent session. */
  readonly lines: readonly SetupLine[];
  readonly storytree: StorytreeOpened;
  /** What registering the hooks found; undefined when this server has no hook command to register. */
  readonly hooks: HooksReport | undefined;
  /** The project the folder is set up as, or the name to suggest when asking the user. */
  readonly project: { status: "set up"; name: string } | { status: "ask"; suggestion: string };
  /** Whether Codex's config.toml has storytree's tool server; undefined without a Codex home here, or with Codex disconnected. */
  readonly codexServer: { readonly state: "registered" | "missing"; readonly config: string } | undefined;
  /** Whether Codex runs storytree's hooks, or waits for the user to trust them; undefined where Codex has none. */
  readonly codexHooks: "running" | "waiting" | undefined;
  /** What putting the `storytree` command on the path found; undefined when there was nothing to put there. */
  readonly command: CommandInstall | undefined;
  /** Whether `gh` is there and signed in, for release on merge. */
  readonly gh: GhState;
  /** Whether Claude Code or Codex is signed in, and whether git and a usable Node are there. */
  readonly machine: MachineState;
  /** Whether the Claude desktop app's and Codex's session records could be read, and how many sessions each keeps. */
  readonly archives: readonly AppReading[];
  /** Which release the registered hooks run, against the latest release. */
  readonly hooksRelease: HooksRelease;
}

/** Check `options.folder`, inside or outside a session, and fix what needs no user decision. Never creates a project. */
export async function runSetupCheck(options: SetupOptions): Promise<SetupReport> {
  const storytree = await openStorytree({
    ...(options.storytreeHome === undefined ? {} : { home: options.storytreeHome }),
    ...(options.openWaitMs === undefined ? {} : { waitMs: options.openWaitMs }),
  });
  // A harness the user disconnected gets no hooks back until they connect it again (app-setup's connect).
  const disconnected = disconnectedHarnesses(options.storytreeHome ?? storytreeHome());
  const homes = options.homes ?? defaultHomes();
  const hooks = options.hook === undefined ? undefined : registerHooks(homes, options.hook, disconnected);
  const codexServer = disconnected.has("codex") ? undefined : codexServerState(homes.codex);
  const codexHooks = codexHooksState(options);
  const found = findProject(options.folder);
  const project = found.project === undefined ? { status: "ask" as const, suggestion: suggestedName(options.folder) } : { status: "set up" as const, name: found.project };
  // The `storytree` command runs the front door built beside the hook script (ADR-0643 D1, 8).
  const command = options.hook === undefined || options.command === undefined ? undefined : putCommandOnPath(options.command, options.hook.node, path.join(path.dirname(options.hook.script), "storytree.mjs"));
  const [gh, machine, archives, released] = await Promise.all([
    (options.gh ?? ghState)(),
    (options.machine ?? (() => machineState(homes.codex === undefined ? {} : { codexHome: homes.codex })))(),
    readAppRecords(options.appPlaces),
    hooksRelease(registeredHookScripts(homes), options.latestRelease),
  ]);
  const report = { storytree, hooks, codexServer, codexHooks, project, command, gh, machine, archives, hooksRelease: released };
  return { ...report, lines: setupLines(report) };
}


/**
 * Whether a Codex hook has run since storytree's were registered, the only sign the user trusted them (3.18):
 * undefined where Codex has none of storytree's hooks or the user disconnected it.
 */
export function codexHooksState(options: Pick<SetupOptions, "homes" | "storytreeHome">): "running" | "waiting" | undefined {
  const home = options.storytreeHome ?? storytreeHome();
  const codexHome = (options.homes ?? defaultHomes()).codex;
  if (codexHome === undefined || disconnectedHarnesses(home).has("codex")) return undefined;
  const trust = codexHookTrust({ storytreeHome: home, codexHome });
  return trust === "not registered" ? undefined : trust;
}

/** Whether Codex's config.toml in `home` registers storytree's tool server, where Codex has a home here. */
function codexServerState(home: string | undefined): SetupReport["codexServer"] {
  if (home === undefined) return undefined;
  try {
    if (!statSync(home).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const config = path.join(home, "config.toml");
  let text = "";
  try {
    text = readFileSync(config, "utf8");
  } catch {
    // No config yet: no server either.
  }
  return { state: /^\s*\[\s*mcp_servers\s*\.\s*(?:storytree|"storytree")\s*\]/m.test(text) ? "registered" : "missing", config };
}
export { builtFromMain } from "./built-from-main.js";
export type { FollowMainOptions } from "./built-from-main.js";
