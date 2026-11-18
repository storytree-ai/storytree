// Capability 8 · Setup check.
import { ask, pathEnv, type Answer } from "@storytree/session-management";

import { desktopCodex, runsElevated, type CodexOptions } from "../connect/codex.js";

export { ask, pathEnv, type Answer };

export const NODE_FLOOR = 24;

export type GhState = "signed in" | "signed out" | "missing" | "not answering";

export type AgentCliState = "signed in" | "signed out" | "missing" | "not answering";
export type ToolState = "present" | "missing" | "not answering";

export interface MachineState {
  readonly claude: AgentCliState;
  readonly codex: AgentCliState;
  readonly cursor?: ToolState;
  readonly pi?: ToolState;
  readonly antigravity?: ToolState;
  readonly git: ToolState;
  readonly node: { readonly state: "ok" | "old" | "missing" | "not answering"; readonly version?: string };
  readonly waitMs: number;
  readonly elevated?: boolean;
}

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

async function codexCli(env: NodeJS.ProcessEnv, waitMs: number, options: MachineOptions): Promise<AgentCliState> {
  const onPath = await agentCli("codex", ["login", "status"], env, waitMs);
  if (onPath !== "missing") return onPath;
  for (const file of desktopCodex(options)) {
    const state = await agentCli(file, ["login", "status"], env, waitMs, false);
    if (state !== "missing") return state;
  }
  return "missing";
}

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

export async function ghState(options: MachineOptions = {}): Promise<GhState> {
  const env = pathEnv(options.path);
  const waitMs = options.waitMs ?? 15_000;
  const version = await ask("gh", ["--version"], env, waitMs);
  if (!version.answered) return "not answering";
  if (version.code !== 0) return "missing";
  const status = await ask("gh", ["auth", "status"], env, waitMs);
  if (!status.answered) return "not answering";
  return status.code === 0 ? "signed in" : "signed out";
}
