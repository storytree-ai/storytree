// Capability 8 · Setup check.
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
  readonly folder: string;
  readonly hook?: HookCommand;
  readonly look?: boolean;
  readonly homes?: Homes;
  readonly codexVersion?: string;
  readonly storytreeHome?: string;
  readonly openWaitMs?: number;
  readonly command?: CommandPath;
  readonly gh?: () => Promise<GhState>;
  readonly machine?: () => Promise<MachineState>;
  readonly appPlaces?: AppPlaces;
  readonly latestRelease?: LatestRelease;
  readonly connected?: string;
  readonly asking?: "claude" | "codex";
  readonly calling?: Harness;
  readonly unnamedPlugins?: () => readonly UnnamedPlugin[];
}

export interface UnnamedPlugin {
  readonly plugin: string;
  readonly part: string;
}

export interface SetupReport {
  readonly lines: readonly SetupLine[];
  readonly storytree: StorytreeOpened;
  readonly hooks: HooksReport | undefined;
  readonly project: { status: "set up"; name: string } | { status: "ask"; suggestion: string } | { status: "missing"; name: string };
  readonly codexServer: { readonly state: "registered" | "missing" | "broken"; readonly config: string; readonly missing?: string } | undefined;
  readonly codexHooks: "running" | "waiting" | undefined;
  readonly command: CommandInstall | undefined;
  readonly gh: GhState;
  readonly machine: MachineState;
  readonly archives: readonly AppReading[];
  readonly hooksRelease: HooksRelease;
  readonly serverEntry: ServerEntry | undefined;
  readonly connected?: string;
  readonly repository?: "no repository" | "no origin" | "no CI";
  readonly firstCommit?: "made" | "no identity";
  readonly rootMarker?: RootMarker;
  readonly unnamedPlugins?: readonly UnnamedPlugin[];
}

export interface RootMarker {
  readonly both: boolean;
  readonly tracked: boolean;
}

export interface ServerEntry {
  readonly command: string;
  readonly args: readonly string[];
}

export async function runSetupCheck(options: SetupOptions): Promise<SetupReport> {
  const storytree = await openStorytree({
    ...(options.storytreeHome === undefined ? {} : { home: options.storytreeHome }),
    ...(options.openWaitMs === undefined ? {} : { waitMs: options.openWaitMs }),
  });
  const disconnected = disconnectedHarnesses(options.storytreeHome ?? storytreeHome());
  const homes = options.homes ?? defaultHomes();
  const connected = connectedHarnesses(homes);
  if (options.calling !== undefined) connected.add(options.calling);
  const unconnected = new Set(HARNESS_IDS.filter((harness) => !connected.has(harness) && !disconnected.has(harness)));
  const codexVersion = options.codexVersion ?? (options.homes === undefined && options.hook !== undefined && connected.has("codex") ? installedCodexVersion() : undefined);
  const hooks = options.hook === undefined ? undefined : registerHooks(homes, options.hook, disconnected, codexVersion, options.look === true, unconnected);
  const server = disconnected.has("codex") ? undefined : codexServerState(homes.codex, options.folder);
  const codexServer = server?.state === "missing" && unconnected.has("codex") ? undefined : server;
  const codexHooks = codexHooksState(options);
  const found = findProject(options.folder);
  const missing = found.project !== undefined && storytree.state !== "not running" && (await lacksProject(storytree.library, found.project));
  const project = found.project === undefined ? { status: "ask" as const, suggestion: suggestedName(options.folder) } : missing ? { status: "missing" as const, name: found.project } : { status: "set up" as const, name: found.project };
  const here = found.project !== undefined && project.status === "set up" ? found.folder : undefined;
  const command = options.hook === undefined || options.command === undefined ? undefined : putCommandOnPath(options.command, options.hook.node, path.join(path.dirname(options.hook.script), "storytree.mjs"), options.look === true);
  const [gh, machine, archives, released] = await Promise.all([
    (options.gh ?? ghState)(),
    (options.machine ?? (() => machineState(homes.codex === undefined ? {} : { codexHome: homes.codex })))().then((state) => signedInAsking(state, options.asking)),
    readAppRecords(options.appPlaces),
    hooksRelease(registeredHookScripts(homes), options.latestRelease),
  ]);
  const serverEntry = options.hook === undefined ? undefined : { command: options.hook.node, args: [path.join(path.dirname(options.hook.script), "storytree-mcp.mjs")] };
  const committed = here === undefined ? undefined : firstCommit(here)?.state;
  const first = committed === "made" || committed === "no identity" ? committed : undefined;
  const repository = here === undefined ? undefined : repositoryLack(here);
  const rootMarker = here === undefined ? undefined : rootMarkerIn(here);
  const unnamedPlugins = options.unnamedPlugins?.();
  const report = { storytree, hooks, codexServer, codexHooks, project, command, gh, machine, archives, hooksRelease: released, serverEntry, ...(options.connected === undefined ? {} : { connected: options.connected }), ...(repository === undefined ? {} : { repository }), ...(first === undefined ? {} : { firstCommit: first }), ...(rootMarker === undefined ? {} : { rootMarker }), ...(unnamedPlugins === undefined ? {} : { unnamedPlugins }) };
  return { ...report, lines: setupLines(report) };
}


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

function signedInAsking(machine: MachineState, asking: SetupOptions["asking"]): MachineState {
  return asking !== undefined && machine[asking] === "signed out" ? { ...machine, [asking]: "signed in" } : machine;
}

function rootMarkerIn(folder: string): RootMarker | undefined {
  if (!existsSync(path.join(folder, ROOT_MARKER_FILE))) return undefined;
  let tracked = false;
  try {
    tracked = execFileSync("git", ["ls-files", "--", ROOT_MARKER_FILE], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim() !== "";
  } catch {
  }
  return { both: existsSync(path.join(folder, PROJECT_FILE)), tracked };
}

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
  const workflows = path.join(folder, ".github", "workflows");
  const read = /github\.com[:/]/.test(origin) && existsSync(workflows) && readdirSync(workflows).some((file) => /\.ya?ml$/.test(file));
  return read ? undefined : "no CI";
}

export function codexHooksState(options: Pick<SetupOptions, "homes" | "storytreeHome">): "running" | "waiting" | undefined {
  const home = options.storytreeHome ?? storytreeHome();
  const codexHome = (options.homes ?? defaultHomes()).codex;
  if (codexHome === undefined || disconnectedHarnesses(home).has("codex")) return undefined;
  const trust = codexHookTrust({ storytreeHome: home, codexHome });
  return trust === "not registered" ? undefined : trust;
}

const SERVER_TABLE = /^[^\S\n\r\u2028\u2029]*\[\s*mcp_servers\s*\.\s*(?:storytree|"storytree")\s*\]/m;

function codexServerState(home: string | undefined, folder: string): SetupReport["codexServer"] {
  if (home === undefined) return undefined;
  try {
    if (!statSync(home).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const own = path.join(home, "config.toml");
  const config = [own, ...projectConfigs(folder, home)].filter((file) => SERVER_TABLE.test(readText(file))).at(-1);
  if (config === undefined) return { state: "missing", config: own };
  const gone = serverFiles(readText(config)).find((file) => path.isAbsolute(file) && !existsSync(file));
  return gone === undefined ? { state: "registered", config } : { state: "broken", config, missing: gone };
}

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

function serverFiles(config: string): string[] {
  const start = SERVER_TABLE.exec(config);
  if (start === null) return [];
  const rest = config.slice(start.index + start[0].length);
  const next = rest.search(/^[^\S\n\r\u2028\u2029]*\[/m);
  const table = next === -1 ? rest : rest.slice(0, next);
  const named = [/^[^\S\n\r\u2028\u2029]*command\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/m.exec(table)?.[1], /^[^\S\n\r\u2028\u2029]*args\s*=\s*\[\s*("(?:[^"\\]|\\.)*"|'[^']*')/m.exec(table)?.[1]];
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

export const setupGuidance: readonly string[] = [
  "When `check_setup` offers a newer starter pack, call `take_starter_pack` only if the user says yes: it never overwrites what they edited. A project set up before the user's factory moves onto it with `move_onto_factory`, only if the user says yes: copies they never edited give way to the factory's, and every edit stays theirs. When the user wants a repository or CI, or they suit the project (you may suggest them), make a hosted repository only on their yes, then call `wire_pipeline` with the test command: it adds storytree's checks to CI (never write your own) and proposes branch protection, turned on only if the user approves. Health then reads CI. To build on an existing JavaScript, TypeScript or Python project, call `import_project` with its folder (this one, if the code is here) before planning stories: each package becomes an imported story; nothing is written into it.",
];

export const selfMergeGuidance: readonly string[] = [
  "When CI is to merge pull requests by itself, merge with your own sign-in, never from a workflow with its own token: GitHub starts no run for a push that token makes, so main goes untested. Turn on GitHub's auto-merge for each pull request (gh pr merge --auto, once the user allows auto-merge in the repository's settings), or, where branch protection is refused, merge after gh pr checks passes.",
];
