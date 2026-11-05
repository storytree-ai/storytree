/**
 * Capability 8 · Setup check. What a first run needs on the machine (ADR-0716, ported from 0.2's doctor): Claude Code or Codex
 * installed and signed in, or Cursor or Pi installed, git, and a Node of at least {@link NODE_FLOOR}. Each is asked of the
 * user's own command by name, as their shell would find it (Codex also where its desktop app keeps it), and only its exit code is read for a
 * sign-in: nothing a tool prints about the account is kept. Cursor is asked only whether it is there: its
 * `cursor-agent status` said "Logged in" and exited 0 on the owner's laptop (2026-10-12) while every real
 * call answered "Authentication required", so no answer of it says Cursor is signed in.
 *
 * A tool that does not answer within `waitMs` is reported as not answering and left behind, so the
 * check never hangs on one (a sign-in prompt, a stuck update, a network wait).
 */
import { ask, pathEnv, type Answer } from "@storytree/session-management";

import { desktopCodex, runsElevated, type CodexOptions } from "../connect/codex.js";

export { ask, pathEnv, type Answer };

/** The Node major storytree's workspace declares (package.json `engines.node`). */
export const NODE_FLOOR = 24;

/** Whether GitHub's `gh` is there and signed in. */
export type GhState = "signed in" | "signed out" | "missing" | "not answering";

/** An agent CLI, as its `--version` and its sign-in status answer. */
export type AgentCliState = "signed in" | "signed out" | "missing" | "not answering";
export type ToolState = "present" | "missing" | "not answering";

export interface MachineState {
  readonly claude: AgentCliState;
  readonly codex: AgentCliState;
  /** Cursor's command line, there or not: never whether it is signed in, which it does not tell truly. Absent where the machine was not asked. */
  readonly cursor?: ToolState;
  /** Pi's command line, there or not: Pi signs in to each model provider on its own. Absent where the machine was not asked. */
  readonly pi?: ToolState;
  /** Antigravity CLI's command line (`agy`), there or not: it has no command that says whether it is signed in (1.3.3). Absent where the machine was not asked. */
  readonly antigravity?: ToolState;
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

/** Where to find the tools, how long each is given, and where Codex's desktop app may keep its CLI. */
export type MachineOptions = CodexOptions;


async function agentCli(command: string, signIn: readonly string[], env: NodeJS.ProcessEnv, waitMs: number, shell?: boolean): Promise<AgentCliState> {
  const how = shell === undefined ? {} : { shell };
  const version = await ask(command, ["--version"], env, waitMs, how);
  if (!version.answered) return "not answering";
  if (version.code !== 0) return "missing";
  const status = await ask(command, signIn, env, waitMs, how);
  if (!status.answered) return "not answering";
  return status.code === 0 ? "signed in" : "signed out";
}

/** Codex on the PATH, else the desktop app's own CLI, asked with no shell (its path may hold spaces). */
async function codexCli(env: NodeJS.ProcessEnv, waitMs: number, options: MachineOptions): Promise<AgentCliState> {
  const onPath = await agentCli("codex", ["login", "status"], env, waitMs);
  if (onPath !== "missing") return onPath;
  for (const file of desktopCodex(options)) {
    const state = await agentCli(file, ["login", "status"], env, waitMs, false);
    if (state !== "missing") return state;
  }
  return "missing";
}

/** Whether the tool `command` names is there, by its `--version`. */
async function tool(command: string, env: NodeJS.ProcessEnv, waitMs: number): Promise<ToolState> {
  const answer = await ask(command, ["--version"], env, waitMs);
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
  const [claude, codex, cursor, pi, antigravity, gitState, nodeState, elevatedState] = await Promise.all([
    agentCli("claude", ["auth", "status"], env, waitMs),
    codexCli(env, waitMs, options),
    tool("cursor-agent", env, waitMs),
    tool("pi", env, waitMs),
    tool("agy", env, waitMs),
    tool("git", env, waitMs),
    node(env, waitMs),
    runsElevated({ ...(options.path === undefined ? {} : { path: options.path }), waitMs }),
  ]);
  return { claude, codex, cursor, pi, antigravity, git: gitState, node: nodeState, waitMs, elevated: elevatedState };
}

/** Whether `gh` is installed and signed in, as `gh auth status` says. */
export async function ghState(options: MachineOptions = {}): Promise<GhState> {
  // `gh auth status` asks GitHub, which takes seconds (about ten on a Windows arm64 machine, 2026-09-28).
  const env = pathEnv(options.path);
  const waitMs = options.waitMs ?? 15_000;
  const version = await ask("gh", ["--version"], env, waitMs);
  if (!version.answered) return "not answering";
  if (version.code !== 0) return "missing";
  const status = await ask("gh", ["auth", "status"], env, waitMs);
  if (!status.answered) return "not answering";
  return status.code === 0 ? "signed in" : "signed out";
}
