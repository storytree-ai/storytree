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
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { connect, type ConnectOptions } from "@storytree/library";
import { codexHookTrust, readAppRecords, type AppPlaces, type AppReading } from "@storytree/session-management";
import { findProject, PROJECT_FILE, ROOT_MARKER_FILE, storytreeHome } from "@storytree/project-and-caller";
import { HARNESS_IDS } from "@storytree/project-and-caller/caller";

import { firstCommit, suggestedName } from "../project/making.js";
import { connectedHarnesses, defaultHomes, disconnectedHarnesses, registeredHookScripts, registerHooks, type Harness, type HookCommand, type Homes, type HooksReport } from "./hooks-config.js";
import { hooksRelease, type HooksRelease, type LatestRelease } from "./hooks-release.js";
import { openStorytree, type StorytreeOpened } from "./open-storytree.js";
import { putCommandOnPath, type CommandInstall, type CommandPath } from "./command.js";
import { setupLines, type SetupLine } from "./diagnostics.js";
import { installedCodexVersion } from "../connect/codex.js";
import { ghState, machineState, type GhState, type MachineState } from "./machine.js";


export type { SetupLine } from "./diagnostics.js";
export { installedCodexVersion, runsElevated } from "../connect/codex.js";
export { ghState, machineState, NODE_FLOOR } from "./machine.js";
export type { AgentCliState, GhState, MachineOptions, MachineState, ToolState } from "./machine.js";

export { putCommandOnPath, removeCommand } from "./command.js";
export type { CommandInstall, CommandPath } from "./command.js";

export { connectedHarnesses, defaultHomes, disconnectedHarnesses, markDisconnected, registerHooks, removeHooks } from "./hooks-config.js";
export type { Harness, HookRegistration, Homes, HooksReport, RemovalReport } from "./hooks-config.js";
export type { HookCommand } from "./built-from-main.js";
export { openStorytree } from "./open-storytree.js";
export type { StorytreeOpened } from "./open-storytree.js";

export interface SetupOptions {
  /** The folder being checked, with or without an agent session. */
  readonly folder: string;
  /** The hook command to register; without one, no hooks are registered. */
  readonly hook?: HookCommand;
  /** Only look: register no hooks, install no status line and put no command on the path, but say what each would change (the doctor without --repair). */
  readonly look?: boolean;
  /** Where the harnesses keep their settings. By default, CLAUDE_CONFIG_DIR or ~/.claude, and CODEX_HOME or ~/.codex. */
  readonly homes?: Homes;
  /** The version of the Codex its hooks are registered for, which sets their shape. By default, asked of this machine's Codex with the default homes, and none with homes given. */
  readonly codexVersion?: string;
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
  /** The harness of the session asking, when it is an MCP client storytree has no hooks for (6.64). */
  readonly connected?: string;
  /**
   * The agent CLI of the session asking, which is signed in, since its session is calling: a sign-in the tool
   * server cannot see (CLAUDE_CODE_OAUTH_TOKEN, held by the session, not its children) is not reported as signed out (8.11).
   */
  readonly asking?: "claude" | "codex";
  /**
   * The harness of the session asking, whose hooks the check registers even where its settings carry none yet: the user
   * connected it by starting storytree's tools in it. Every other harness gets hooks only where it already has some (8.43).
   */
  readonly calling?: Harness;
  /** The plugins in this computer's factory that no part setting names, as the host that mounts them reads them; none without it. */
  readonly unnamedPlugins?: () => readonly UnnamedPlugin[];
}

/** A factory plugin no part setting names, and the part `storytree settings set part <part> plugin <plugin>` names it as. */
export interface UnnamedPlugin {
  readonly plugin: string;
  readonly part: string;
}

export interface SetupReport {
  /** Each diagnostic and its fix, usable from a terminal without creating an agent session. */
  readonly lines: readonly SetupLine[];
  readonly storytree: StorytreeOpened;
  /** What registering the hooks found; undefined when this server has no hook command to register. */
  readonly hooks: HooksReport | undefined;
  /** The project the folder is set up as, or the name to suggest when asking the user. */
  readonly project: { status: "set up"; name: string } | { status: "ask"; suggestion: string } | { status: "missing"; name: string };
  /**
   * Whether a Codex session in the folder starts storytree's tool server, and from which config.toml; `broken`
   * names the `missing` command or server file. Undefined without a Codex home here, with Codex disconnected, or with none named where Codex is not connected.
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
  /**
   * storytree's stdio tool server, built beside the hook script, as any MCP client takes it by hand (8.27):
   * undefined when this check has no installed hook command to find it by.
   */
  readonly serverEntry: ServerEntry | undefined;
  /** The harness of the session asking, when it is a connected one: an MCP client storytree has no hooks for (6.64). */
  readonly connected?: string;
  /**
   * What a project's folder lacks that review, landing and verified health read (8.31): a git repository, its
   * origin remote, or a CI workflow storytree reads. Undefined outside a project, where git cannot be asked, or when nothing is missing.
   */
  readonly repository?: "no repository" | "no origin" | "no CI";
  /**
   * The first commit of a repository set_up_project began with no git identity (8.31): made by this check, now that
   * git has one, or still waiting for one. Undefined for every other folder.
   */
  readonly firstCommit?: "made" | "no identity";
  /**
   * A project folder's marker still at its root as `.storytree.json` (ADR-1191 D5): alone, or beside a
   * `.storytree/project.json`, which wins; and whether git tracks it. Undefined for every other folder.
   */
  readonly rootMarker?: RootMarker;
  /** The factory plugins no part setting names (friction_f1d8f14c01e2); undefined when the check was given no reading of them. */
  readonly unnamedPlugins?: readonly UnnamedPlugin[];
}

/** A root `.storytree.json` the setup check found (ADR-1191 D5). */
export interface RootMarker {
  /** Whether the folder also holds `.storytree/project.json`, which routing reads instead. */
  readonly both: boolean;
  /** Whether git tracks it, so the move is a `git mv` (or the delete a `git rm`). */
  readonly tracked: boolean;
}

/** A stdio server entry: the command and arguments an MCP client starts storytree's tool server with. */
export interface ServerEntry {
  readonly command: string;
  readonly args: readonly string[];
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
  // Connecting is the user's act (the app's Connect, `storytree setup connect`): the check keeps current only the harnesses
  // whose settings already carry storytree's hooks, and the one whose session is asking, and writes nothing for another (8.43).
  const connected = connectedHarnesses(homes);
  if (options.calling !== undefined) connected.add(options.calling);
  const unconnected = new Set(HARNESS_IDS.filter((harness) => !connected.has(harness) && !disconnected.has(harness)));
  const codexVersion = options.codexVersion ?? (options.homes === undefined && options.hook !== undefined && connected.has("codex") ? installedCodexVersion() : undefined);
  const hooks = options.hook === undefined ? undefined : registerHooks(homes, options.hook, disconnected, codexVersion, options.look === true, unconnected);
  const server = disconnected.has("codex") ? undefined : codexServerState(homes.codex, options.folder);
  // A Codex the user has not connected is not told to have storytree's tool server; one naming a removed install still is.
  const codexServer = server?.state === "missing" && unconnected.has("codex") ? undefined : server;
  const codexHooks = codexHooksState(options);
  const found = findProject(options.folder);
  // A marker naming a project this library lacks (set up against another library, or deleted here) is no project here.
  const missing = found.project !== undefined && storytree.state !== "not running" && (await lacksProject(storytree.library, found.project));
  const project = found.project === undefined ? { status: "ask" as const, suggestion: suggestedName(options.folder) } : missing ? { status: "missing" as const, name: found.project } : { status: "set up" as const, name: found.project };
  // Only a project here has a repository, a first commit or a marker's move to judge.
  const here = found.project !== undefined && project.status === "set up" ? found.folder : undefined;
  // The `storytree` command runs the front door built beside the hook script (ADR-0643 D1, 8).
  const command = options.hook === undefined || options.command === undefined ? undefined : putCommandOnPath(options.command, options.hook.node, path.join(path.dirname(options.hook.script), "storytree.mjs"), options.look === true);
  const [gh, machine, archives, released] = await Promise.all([
    (options.gh ?? ghState)(),
    (options.machine ?? (() => machineState(homes.codex === undefined ? {} : { codexHome: homes.codex })))().then((state) => signedInAsking(state, options.asking)),
    readAppRecords(options.appPlaces),
    hooksRelease(registeredHookScripts(homes), options.latestRelease),
  ]);
  // The tool server is built beside the hook script, as the `storytree` command is.
  const serverEntry = options.hook === undefined ? undefined : { command: options.hook.node, args: [path.join(path.dirname(options.hook.script), "storytree-mcp.mjs")] };
  const committed = here === undefined ? undefined : firstCommit(here)?.state;
  const first = committed === "made" || committed === "no identity" ? committed : undefined;
  const repository = here === undefined ? undefined : repositoryLack(here);
  const rootMarker = here === undefined ? undefined : rootMarkerIn(here);
  const unnamedPlugins = options.unnamedPlugins?.();
  const report = { storytree, hooks, codexServer, codexHooks, project, command, gh, machine, archives, hooksRelease: released, serverEntry, ...(options.connected === undefined ? {} : { connected: options.connected }), ...(repository === undefined ? {} : { repository }), ...(first === undefined ? {} : { firstCommit: first }), ...(rootMarker === undefined ? {} : { rootMarker }), ...(unnamedPlugins === undefined ? {} : { unnamedPlugins }) };
  return { ...report, lines: setupLines(report) };
}


/** Whether the library at `library` has no project `name`; a library that cannot be asked is not said to lack it. */
async function lacksProject(library: ConnectOptions, name: string): Promise<boolean> {
  try {
    const storytree = await connect(library);
    try {
      return !(await storytree.listProjects()).includes(name);
    } finally {
      await storytree.close();
    }
  } catch {
    return false;
  }
}

/** `machine`, with the asking session's own agent CLI signed in where its ask said signed out (8.11). */
function signedInAsking(machine: MachineState, asking: SetupOptions["asking"]): MachineState {
  return asking !== undefined && machine[asking] === "signed out" ? { ...machine, [asking]: "signed in" } : machine;
}

/** The root `.storytree.json` a project's `folder` still holds (ADR-1191 D5), or undefined when it holds none. */
function rootMarkerIn(folder: string): RootMarker | undefined {
  if (!existsSync(path.join(folder, ROOT_MARKER_FILE))) return undefined;
  let tracked = false;
  try {
    tracked = execFileSync("git", ["ls-files", "--", ROOT_MARKER_FILE], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim() !== "";
  } catch {
    // No git, or no repository: a plain move.
  }
  return { both: existsSync(path.join(folder, PROJECT_FILE)), tracked };
}

/**
 * What `folder`, a project's, lacks that review, landing and verified health read (8.31): a review diffs against
 * origin's default branch, land and the health record read fetched origin/main, and `health ci` reads a GitHub
 * origin's workflow runs. Undefined when git cannot be asked.
 */
function repositoryLack(folder: string): SetupReport["repository"] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  try {
    git("rev-parse", "--show-toplevel");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : "no repository";
  }
  let origin: string;
  try {
    origin = git("remote", "get-url", "origin");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : "no origin";
  }
  // The CI `health local` defers to (ci-health's ciOf): a GitHub origin and a workflow under the folder's .github/workflows.
  const workflows = path.join(folder, ".github", "workflows");
  const read = /github\.com[:/]/.test(origin) && existsSync(workflows) && readdirSync(workflows).some((file) => /\.ya?ml$/.test(file));
  return read ? undefined : "no CI";
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

/** Its section of the habits card (ADR-1021, the guidance kind): what a project's setup asks of the agent through App setup's tools; the setup check's own paragraph is the server's. */
export const setupGuidance: readonly string[] = [
  "When `check_setup` offers a newer starter pack, call `take_starter_pack` only if the user says yes: it never overwrites what they edited. A project set up before the user's factory moves onto it with `move_onto_factory`, only if the user says yes: copies they never edited give way to the factory's, and every edit stays theirs. Once the project is set up, or when it adopts a pipeline, call `wire_pipeline` with its test command: it adds the tests and storytree's check to the project's CI, the checks storytree owns, so never write your own. Branch protection is a repository setting: propose it as `wire_pipeline` words it, and turn it on only if the user approves. To build on an existing JavaScript, TypeScript or Python project, call `import_project` with its folder (this one, if the code is here) before planning stories: each package becomes an imported story, for an agent to map, and nothing is written into it.",
];
