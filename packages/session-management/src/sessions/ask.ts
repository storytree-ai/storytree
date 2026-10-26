/**
 * Capability 4 · Sessions. Asking a command on this machine, never hanging on it: the sessions' and claims' reads of git and
 * gh go through it, and the app setup story's machine check uses the same (ADR-0969 D3 left it here, beneath both).
 */
import { spawn } from "node:child_process";

export type Answer = { readonly answered: false } | { readonly answered: true; readonly code: number; readonly out: string };

/** How long a tool's output may trail its exit: something it started can hold the pipe for good. */
const TRAIL_MS = 250;

/** This process's environment with `path` as its PATH, or unchanged without one. */
export function pathEnv(path: string | undefined): NodeJS.ProcessEnv {
  if (path === undefined) return process.env;
  // Windows spells it Path and matches without case: leave one spelling, the given one.
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  env.PATH = path;
  return env;
}

/**
 * Run `command args` found on the path in `env`, giving up after `waitMs`; never rejects. It answers
 * when the tool exits, not when its output closes, which a process it started (gh's tzutil, a
 * console host) may never let happen.
 *
 * On Windows a user's tool is often a .cmd shim, which only a shell runs, so by default the words
 * go through one there; pass `shell: false` for any argument that is not fixed, such as a branch.
 */
export function ask(command: string, args: readonly string[], env: NodeJS.ProcessEnv, waitMs: number, options: { readonly cwd?: string; readonly shell?: boolean } = {}): Promise<Answer> {
  return new Promise((resolve) => {
    const cwd = options.cwd === undefined ? {} : { cwd: options.cwd };
    const child = (options.shell ?? process.platform === "win32")
      ? spawn([command, ...args].join(" "), { env, ...cwd, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      : spawn(command, args, { env, ...cwd, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
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
    child.on("exit", (code) => {
      setTimeout(() => done({ answered: true, code: code ?? -1, out }), TRAIL_MS).unref();
    });
  });
}
