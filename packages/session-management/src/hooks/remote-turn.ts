/**
 * Capability 3 · Hooks. Hooks over a wss:// library (ADR-1093; ADR-1207 D1, D2): a cloud session's, whose every round trip crosses
 * Cloudflare and a tunnel to the library's box (about 290 ms a round trip and 2.2 s a connection, measured from a cloud
 * container on 2026-11-02, friction_60f175431c21). There a hook nothing waits for is given longer (deadlines.ts), and
 * one hook at a time on the machine reaches the library: the turn. A hook that finds it held leaves its lines waiting
 * (queue.ts) and exits without connecting; the holder uploads what waits before it lets go. So a cloud machine holds
 * one connection and one transaction at a time under a project's write lock, which other machines' hooks wait on too,
 * rather than one per hook, each cut off at its deadline with the backlog it was uploading.
 *
 * The turn is a file under the storytree home naming its holder's process: taken when absent, or when the process it
 * names has gone; let go when the holder is done, or when its process exits, the deadline's exit included.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readLibrary } from "@storytree/project-and-caller";

/** The turn's file, under the storytree home. */
export const TURN_FILE = "remote-turn";

/** Whether `address`, a library's, is reached over HTTPS as a wss:// address. */
export function remoteAddress(address: string | undefined): boolean {
  return address !== undefined && address.startsWith("wss:");
}

/** Whether this machine's library, as the storytree home `home` names it, is a wss:// address. */
export function remoteLibrary(home: string): boolean {
  const library = readLibrary(home);
  return library.location === "postgres" && remoteAddress(library.address);
}

/** Whether process `pid` is still running here. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Take the machine's turn to reach a wss:// library, for this process: how to let it go, or undefined while another
 * live process holds it. A turn whose holder has gone, or whose file cannot be read as a process, is taken.
 */
export function takeTurn(home: string): (() => void) | undefined {
  const file = path.join(home, TURN_FILE);
  const mine = String(process.pid);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, mine, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return undefined;
      let holder = Number.NaN;
      try {
        holder = Number(readFileSync(file, "utf8").trim());
      } catch {
        // Let go between the two reads: try again.
      }
      if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && alive(holder)) return undefined;
      rmSync(file, { force: true });
      continue;
    }
    let held = true;
    const release = (): void => {
      if (!held) return;
      held = false;
      process.removeListener("exit", release);
      try {
        if (readFileSync(file, "utf8").trim() === mine) rmSync(file, { force: true });
      } catch {
        // Already gone.
      }
    };
    process.on("exit", release);
    return release;
  }
  return undefined;
}
