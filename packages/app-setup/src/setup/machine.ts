/**
 * Capability 8 · Setup check. What a first run needs on the machine (ADR-0716, ported from 0.2's doctor): Claude Code or Codex
 * installed and signed in, git, and a Node of at least {@link NODE_FLOOR}. Each is asked of the
 * user's own command by name, as their shell would find it (Codex also where its desktop app keeps it), and only its exit code is read for a
 * sign-in: nothing a tool prints about the account is kept.
 *
 * A tool that does not answer within `waitMs` is reported as not answering and left behind, so the
 * check never hangs on one (a sign-in prompt, a stuck update, a network wait).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { ask, pathEnv, type Answer } from "@storytree/session-management";

export { ask, pathEnv, type Answer };

/** The Node major storytree's workspace declares (package.json `engines.node`). */
export const NODE_FLOOR = 24;

/** An agent CLI, as its `--version` and its sign-in status answer. */
export type AgentCliState = "signed in" | "signed out" | "missing" | "not answering";
export type ToolState = "present" | "missing" | "not answering";

export interface MachineState {
  readonly claude: AgentCliState;
  readonly codex: AgentCliState;
  readonly git: ToolState;
  /** The Node on the path, with the version it gave. */
  readonly node: { readonly state: "ok" | "old" | "missing" | "not answering"; readonly version?: string };
  /** How long each tool was given to answer. */
  readonly waitMs: number;
  /**
   * Whether this runs as a Windows administrator (an elevated terminal, or a session started from one):
   * Codex's Windows sandbox cannot run commands there (8.17). Never so elsewhere.
   */
  readonly elevated?: boolean;
}

export interface MachineOptions {
  /** The PATH to find the tools on; by default, this process's. */
  readonly path?: string;
  /** How long to give each tool to answer. */
  readonly waitMs?: number;
  /** Codex's home, whose config.toml may name where its CLI is (CODEX_CLI_PATH). By default, CODEX_HOME or ~/.codex. */
  readonly codexHome?: string;
  /** Where Windows keeps a user's apps (%LOCALAPPDATA%), under which the Codex desktop app installs its CLI. By default, LOCALAPPDATA. */
  readonly localAppData?: string;
  /** Where macOS keeps apps, in which the Codex or ChatGPT app bundles its CLI. By default, /Applications and ~/Applications on a Mac, none elsewhere. */
  readonly applications?: readonly string[];
}


async function agentCli(command: string, signIn: readonly string[], env: NodeJS.ProcessEnv, waitMs: number, shell?: boolean): Promise<AgentCliState> {
  const how = shell === undefined ? {} : { shell };
  const version = await ask(command, ["--version"], env, waitMs, how);
  if (!version.answered) return "not answering";
  if (version.code !== 0) return "missing";
  const status = await ask(command, signIn, env, waitMs, how);
  if (!status.answered) return "not answering";
  return status.code === 0 ? "signed in" : "signed out";
}

/**
 * Where a Codex off the PATH may be: the Codex desktop app puts its CLI at
 * %LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe and names it as CODEX_CLI_PATH in Codex's
 * config.toml, and puts neither on the PATH (increment_820b7d460eb9). On a Mac the Codex app, or the
 * ChatGPT app it merged into, bundles it in one of {@link BUNDLED_CODEX}'s places (increment_ebe913930972).
 */
function desktopCodex(codexHome: string, localAppData: string | undefined, applications: readonly string[]): string[] {
  const found: string[] = [];
  try {
    const named = /^\s*CODEX_CLI_PATH\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/m.exec(readFileSync(path.join(codexHome, "config.toml"), "utf8"))?.[1];
    if (named !== undefined) found.push(named.startsWith("'") ? named.slice(1, -1) : (JSON.parse(named) as string));
  } catch {
    // No config, or no path in it that reads.
  }
  if (localAppData !== undefined) {
    const bin = path.join(localAppData, "OpenAI", "Codex", "bin");
    try {
      for (const hash of readdirSync(bin)) found.push(path.join(bin, hash, "codex.exe"));
    } catch {
      // No desktop app here.
    }
  }
  for (const folder of applications) {
    for (const app of ["Codex.app", "ChatGPT.app"]) {
      for (const layout of BUNDLED_CODEX) {
        const file = path.join(folder, app, "Contents", "Resources", ...layout);
        if (existsSync(file)) found.push(file);
      }
    }
  }
  return found;
}

/**
 * Where a Mac app bundle has kept Codex's CLI under Contents/Resources, newest first: codex-cli's
 * bin/codex and CodexCLI.app since app 26.924 moved it (openai/codex#48214), a bare codex before.
 */
const BUNDLED_CODEX: readonly (readonly string[])[] = [
  ["codex-cli", "bin", "codex"],
  ["codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"],
  ["codex"],
];

/** Codex on the PATH, else the desktop app's own CLI, asked with no shell (its path may hold spaces). */
async function codexCli(env: NodeJS.ProcessEnv, waitMs: number, options: MachineOptions): Promise<AgentCliState> {
  const onPath = await agentCli("codex", ["login", "status"], env, waitMs);
  if (onPath !== "missing") return onPath;
  for (const file of desktopCodex(options.codexHome ?? (process.env.CODEX_HOME || path.join(homedir(), ".codex")), options.localAppData ?? process.env.LOCALAPPDATA, options.applications ?? macApplications())) {
    const state = await agentCli(file, ["login", "status"], env, waitMs, false);
    if (state !== "missing") return state;
  }
  return "missing";
}

function macApplications(): string[] {
  return process.platform === "darwin" ? ["/Applications", path.join(homedir(), "Applications")] : [];
}

async function git(env: NodeJS.ProcessEnv, waitMs: number): Promise<ToolState> {
  const answer = await ask("git", ["--version"], env, waitMs);
  return !answer.answered ? "not answering" : answer.code === 0 ? "present" : "missing";
}

async function node(env: NodeJS.ProcessEnv, waitMs: number): Promise<MachineState["node"]> {
  const answer = await ask("node", ["--version"], env, waitMs);
  if (!answer.answered) return { state: "not answering" };
  const version = answer.out.trim();
  const major = /^v?(\d+)\./.exec(version)?.[1];
  if (answer.code !== 0 || major === undefined) return { state: "missing" };
  return { state: Number(major) >= NODE_FLOOR ? "ok" : "old", version };
}

/** Ask the machine for each tool at once. */
export async function machineState(options: MachineOptions = {}): Promise<MachineState> {
  const waitMs = options.waitMs ?? 5_000;
  const env = pathEnv(options.path);
  const [claude, codex, gitState, nodeState, elevatedState] = await Promise.all([
    agentCli("claude", ["auth", "status"], env, waitMs),
    codexCli(env, waitMs, options),
    git(env, waitMs),
    node(env, waitMs),
    elevated(env, waitMs),
  ]);
  return { claude, codex, git: gitState, node: nodeState, waitMs, elevated: elevatedState };
}

/**
 * Whether this process runs elevated, read from its integrity label: an administrator's elevated token
 * is labelled high (S-1-16-12288) or system (S-1-16-16384), a normal desktop session medium. Measured on
 * the owner's laptop, 2026-09-30: an SSH login as an administrator is high, the desktop session medium.
 */
/** Whether this process runs as a Windows administrator (8.17), asked alone: for the installer's connect step. */
export function runsElevated(options: { readonly path?: string; readonly waitMs?: number } = {}): Promise<boolean> {
  return elevated(pathEnv(options.path), options.waitMs ?? 5_000);
}

async function elevated(env: NodeJS.ProcessEnv, waitMs: number): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const answer = await ask("whoami", ["/groups", "/fo", "csv"], env, waitMs);
  return answer.answered && answer.code === 0 && /S-1-16-(12288|16384)\b/.test(answer.out);
}
