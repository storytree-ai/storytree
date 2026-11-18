// Capability 4 · Sessions
import { spawn } from "node:child_process";

export type Answer = { readonly answered: false } | { readonly answered: true; readonly code: number; readonly out: string };

const TRAIL_MS = 250;

export function pathEnv(path: string | undefined): NodeJS.ProcessEnv {
  if (path === undefined) return process.env;
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  env.PATH = path;
  return env;
}

export function ask(command: string, args: readonly string[], env: NodeJS.ProcessEnv, waitMs: number, options: { readonly cwd?: string; readonly shell?: boolean } = {}): Promise<Answer> {
  return new Promise((resolve) => {
    const cwd = options.cwd === undefined ? {} : { cwd: options.cwd };
    const child = (options.shell ?? process.platform === "win32")
      ? spawn([command, ...args].join(" "), { env, ...cwd, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      : spawn(command, args, { env, ...cwd, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    let exited = false;
    const timer = setTimeout(() => setImmediate(() => {
      if (exited) return;
      done({ answered: false });
      if (process.platform === "win32" && child.pid !== undefined) {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }).on("error", () => {});
      } else {
        child.kill("SIGKILL");
      }
    }), waitMs);
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
      exited = true;
      setTimeout(() => done({ answered: true, code: code ?? -1, out }), TRAIL_MS).unref();
    });
  });
}
