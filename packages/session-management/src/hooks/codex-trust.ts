/**
 * Capability 3 · Hooks. Whether Codex runs storytree's hooks on this machine (contract 3.18). Codex runs a newly registered
 * hook only after the user trusts it once ("Hooks need review" when Codex starts, or /hooks), and
 * storytree cannot read that trust: Codex keeps it as hashes of its own. So the proof is an event:
 * each Codex hook that runs notes it in the storytree home, and Codex's hooks count as running while
 * that note is newer than the hooks.json they were registered in. A registration written later (a
 * new install's path) is one Codex asks about again, so it reads as waiting until a hook runs again.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The note a Codex hook leaves in the storytree home when it runs. */
const NOTE = "codex-hooks-ran";

/** What storytree knows of Codex's hooks here: running, registered but not run since, or not registered. */
export type CodexHookTrust = "running" | "waiting" | "not registered";

export interface CodexHomes {
  readonly storytreeHome: string;
  readonly codexHome: string;
}

/** Note that one of Codex's hooks ran, unless a note newer than Codex's hooks.json is already there. Never throws. */
export function noteCodexHookRan({ storytreeHome, codexHome }: CodexHomes): void {
  try {
    if (codexHookTrust({ storytreeHome, codexHome }) !== "waiting") return;
    mkdirSync(storytreeHome, { recursive: true });
    // Written, not touched: the file system stamps a write at its own precision, where a Date given to
    // utimes is cut to the millisecond and can read as older than a hooks.json written in the same one.
    writeFileSync(path.join(storytreeHome, NOTE), `${new Date().toISOString()}\n`);
  } catch {
    // A hook never fails on its own bookkeeping.
  }
}

/** Whether Codex has storytree's hooks registered, and whether one has run since they were. */
export function codexHookTrust({ storytreeHome, codexHome }: CodexHomes): CodexHookTrust {
  const hooks = path.join(codexHome, "hooks.json");
  const registered = modified(hooks);
  if (registered === undefined || !holdsStorytrees(hooks)) return "not registered";
  const ran = modified(path.join(storytreeHome, NOTE));
  return ran !== undefined && ran >= registered ? "running" : "waiting";
}

function holdsStorytrees(file: string): boolean {
  try {
    return readFileSync(file, "utf8").includes("storytree-hook.mjs");
  } catch {
    return false;
  }
}

function modified(file: string): number | undefined {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}
