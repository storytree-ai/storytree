/**
 * Capability 1 · Running services, contract 1.1 (ADR-1180 D2). A service started as its own child process: node running
 * the child entry, with this machine's storytree home, each line it prints written to the host's log after the
 * service's name, and its last lines kept for `storytree services` to show when it fails. The stop signal goes to the
 * child as a message on its IPC channel: on Windows a SIGTERM ends a process at once, before its service can stop.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { childArgs, STOP } from "./child.js";
import type { Declared } from "./declared.js";
import type { Child, Ended } from "./supervise.js";

/** How many of a service's last lines are kept. */
export const LAST_LINES = 20;

/** Start `service` as a child process, its lines to `log` after its name. */
export function startChild(service: Declared, home: string, log: (line: string) => void): Child {
  const child = spawn(process.execPath, childArgs({ service, home }), { env: { ...process.env, STORYTREE_HOME: home }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const last: string[] = [];
  const said = (line: string) => {
    last.push(line);
    if (last.length > LAST_LINES) last.shift();
    log(`${service.id}: ${line}`);
  };
  const outputs = [child.stdout, child.stderr].map((stream) => new Promise<void>((done) => createInterface({ input: stream }).on("line", said).once("close", done)));
  const ended = new Promise<Ended>((done) => {
    child.once("error", (error) => {
      said(`could not start: ${error.message}`);
      done({ code: null, signal: null });
    });
    child.once("exit", (code, signal) => void Promise.all(outputs).then(() => done({ code, signal })));
  });
  return {
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    ended,
    signal: (name) => {
      if (name === "SIGTERM" && child.connected) child.send(STOP, () => {});
      else child.kill(name);
    },
    lastLines: () => [...last],
  };
}
