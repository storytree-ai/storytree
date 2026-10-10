/**
 * Capability 8 · Setup check (the app setup story since ADR-0969 D3): the user installs only the storytree tool
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
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { codexHookTrust, findProject, readAppRecords, storytreeHome, type AppPlaces, type AppReading } from "@storytree/session-management";

import { suggestedName } from "../project/making.js";
import { defaultHomes, disconnectedHarnesses, registeredHookScripts, registerHooks, type HookCommand, type Homes, type HooksReport } from "./hooks-config.js";
import { hooksRelease, type HooksRelease, type LatestRelease } from "./hooks-release.js";
import { openStorytree, type StorytreeOpened } from "./open-storytree.js";
import { ghState, putCommandOnPath, type CommandInstall, type CommandPath, type GhState } from "./command.js";
import { setupLines, type SetupLine } from "./diagnostics.js";
import { machineState, type MachineState } from "./machine.js";


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
  /**
   * Whether a Codex session in the folder starts storytree's tool server, and from which config.toml; `broken`
   * names the `missing` command or server file. Undefined without a Codex home here, or with Codex disconnected.
   */
  readonly codexServer: { readonly state: "registered" | "missing" | "broken"; readonly config: string; readonly missing?: string } | undefined;
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
  const codexServer = disconnected.has("codex") ? undefined : codexServerState(homes.codex, options.folder);
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

const SERVER_TABLE = /^\s*\[\s*mcp_servers\s*\.\s*(?:storytree|"storytree")\s*\]/m;

/**
 * Whether a Codex session in `folder` starts storytree's tool server, where Codex has a home here (8.23).
 * Codex reads a project's own .codex/config.toml over its home's, as 0.3's checkouts serve their own
 * source (ADR-0793 D2); a registration naming a command or server file that is not there (a removed
 * install) starts nothing.
 */
function codexServerState(home: string | undefined, folder: string): SetupReport["codexServer"] {
  if (home === undefined) return undefined;
  try {
    if (!statSync(home).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const own = path.join(home, "config.toml");
  // The layer nearest the folder that names the server is the one Codex starts.
  const config = [own, ...projectConfigs(folder, home)].filter((file) => SERVER_TABLE.test(readText(file))).at(-1);
  if (config === undefined) return { state: "missing", config: own };
  const gone = serverFiles(readText(config)).find((file) => path.isAbsolute(file) && !existsSync(file));
  return gone === undefined ? { state: "registered", config } : { state: "broken", config, missing: gone };
}

/** The project configs Codex reads for `folder`: from its repository's root (the nearest .git above it) down to it, or only its own outside a repository; never Codex's home. */
function projectConfigs(folder: string, home: string): string[] {
  const dirs: string[] = [];
  for (let dir = path.resolve(folder); ; dir = path.dirname(dir)) {
    dirs.unshift(dir);
    if (existsSync(path.join(dir, ".git"))) break;
    if (path.dirname(dir) === dir) {
      dirs.splice(0, dirs.length - 1);
      break;
    }
  }
  const fold = (file: string) => (process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file));
  return dirs.map((dir) => path.join(dir, ".codex")).filter((codex) => fold(codex) !== fold(home)).map((codex) => path.join(codex, "config.toml"));
}

/** The command and first argument storytree's table names, read as machine.ts reads CODEX_CLI_PATH: TOML strings, no TOML parser. */
function serverFiles(config: string): string[] {
  const start = SERVER_TABLE.exec(config);
  if (start === null) return [];
  const rest = config.slice(start.index + start[0].length);
  const next = rest.search(/^\s*\[/m);
  const table = next === -1 ? rest : rest.slice(0, next);
  const named = [/^\s*command\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/m.exec(table)?.[1], /^\s*args\s*=\s*\[\s*("(?:[^"\\]|\\.)*"|'[^']*')/m.exec(table)?.[1]];
  return named.flatMap((literal) => {
    if (literal === undefined) return [];
    if (literal.startsWith("'")) return [literal.slice(1, -1)];
    try {
      return [JSON.parse(literal) as string];
    } catch {
      return [];
    }
  });
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
export { builtFromMain } from "./built-from-main.js";
export type { FollowMainOptions } from "./built-from-main.js";
