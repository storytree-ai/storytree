/**
 * What a first run needs on the machine (ADR-0716, ported from 0.2's doctor): Claude Code or Codex
 * installed and signed in, git, and a Node of at least {@link NODE_FLOOR}. Each is asked of the
 * user's own command by name, as their shell would find it, and only its exit code is read for a
 * sign-in: nothing a tool prints about the account is kept.
 *
 * A tool that does not answer within `waitMs` is reported as not answering and left behind, so the
 * check never hangs on one (a sign-in prompt, a stuck update, a network wait).
 */
import { spawn } from "node:child_process";

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
}

export interface MachineOptions {
  /** The PATH to find the tools on; by default, this process's. */
  readonly path?: string;
  /** How long to give each tool to answer. */
  readonly waitMs?: number;
}

type Answer = { readonly answered: false } | { readonly answered: true; readonly code: number; readonly out: string };

/** Run `command args` found on the path in `env`, giving up after `waitMs`; never rejects. */
function ask(command: string, args: readonly string[], env: NodeJS.ProcessEnv, waitMs: number): Promise<Answer> {
  return new Promise((resolve) => {
    // On Windows a user's tool is often a .cmd shim, which only a shell runs. The words are fixed.
    const child = process.platform === "win32"
      ? spawn([command, ...args].join(" "), { env, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      : spawn(command, args, { env, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    const timer = setTimeout(() => {
      done({ answered: false });
      if (process.platform === "win32" && child.pid !== undefined) {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }).on("error", () => {});
      } else {
        child.kill("SIGKILL");
      }
    }, waitMs);
    let settled = false;
    function done(answer: Answer): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      resolve(answer);
    }
    child.on("error", () => done({ answered: true, code: -1, out: "" }));
    child.on("close", (code) => done({ answered: true, code: code ?? -1, out }));
  });
}

async function agentCli(command: string, signIn: readonly string[], env: NodeJS.ProcessEnv, waitMs: number): Promise<AgentCliState> {
  const version = await ask(command, ["--version"], env, waitMs);
  if (!version.answered) return "not answering";
  if (version.code !== 0) return "missing";
  const status = await ask(command, signIn, env, waitMs);
  if (!status.answered) return "not answering";
  return status.code === 0 ? "signed in" : "signed out";
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
  let env: NodeJS.ProcessEnv = process.env;
  if (options.path !== undefined) {
    // Windows spells it Path and matches without case: leave one spelling, the given one.
    env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
    env.PATH = options.path;
  }
  const [claude, codex, gitState, nodeState] = await Promise.all([
    agentCli("claude", ["auth", "status"], env, waitMs),
    agentCli("codex", ["login", "status"], env, waitMs),
    git(env, waitMs),
    node(env, waitMs),
  ]);
  return { claude, codex, git: gitState, node: nodeState, waitMs };
}
