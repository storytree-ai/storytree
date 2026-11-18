// Capability 3 · Hooks
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readLibrary } from "@storytree/project-and-caller";

export const TURN_FILE = "remote-turn";

const UNWRITTEN_GRACE_MS = 5000;

export function remoteAddress(address: string | undefined): boolean {
  return address !== undefined && address.startsWith("wss:");
}

export function remoteLibrary(home: string): boolean {
  try {
    const library = readLibrary(home);
    return library.location === "postgres" && remoteAddress(library.address);
  } catch {
    return false;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

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
        if (!(Number.isInteger(holder) && holder > 0) && Date.now() - statSync(file).mtimeMs <= UNWRITTEN_GRACE_MS) return undefined;
      } catch {
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
      }
    };
    process.on("exit", release);
    return release;
  }
  return undefined;
}
