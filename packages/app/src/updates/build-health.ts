/** Capability 4 · Updates, contract 4.3: the running main build checks its own verified health. */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RunningBuild } from "./follow-main.js";

export interface OwnHealthOptions {
  /** The slot that has already started, never the slot being built for a later restart. */
  readonly running: RunningBuild;
  /** The app's home (including a STORYTREE_HOME override), whose database the check joins. */
  readonly home: string;
  /** The app's logger, which appends to <home>/app.log. */
  readonly log: (line: string) => void;
}

/**
 * Called in the background after the app opens its database and window, once per running commit.
 * Follow-main awaits it before polling, so even the interval before the child takes the library
 * writing lock cannot be interrupted by an update. The command itself uses appLibraryServer with
 * writes: true: it joins the running app and holds that lock through testing and recording.
 *
 * Remember attempts, including failures, so reopening the same build does not keep retrying.
 * Missing/corrupt state bootstraps a check of the current build. Nothing here rejects startup.
 * Installed releases have no checkout and never call this.
 */
export async function refreshOwnHealth({ running, home, log }: OwnHealthOptions): Promise<void> {
  try {
    const record = path.join(home, "own-health.json");
    let previous: { sha?: string } | undefined;
    try {
      previous = JSON.parse(await readFile(record, "utf8")) as { sha?: string };
    } catch { /* First use, or an interrupted write: check this build. */ }
    if (previous?.sha === running.sha) return;
    await writeFile(record, `${JSON.stringify({ sha: running.sha })}\n`);
    log(`own-health: checking ${running.sha} from slot ${running.slot} (${running.dir})`);
    await new Promise<void>((resolve, reject) => {
      // pnpm is a .cmd on Windows. The shell sees only this fixed command, never a path or input.
      const child = spawn("pnpm", ["check:own-health"], {
        cwd: running.dir,
        env: { ...process.env, STORYTREE_HOME: home },
        shell: process.platform === "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const output of [child.stdout, child.stderr]) {
        output.setEncoding("utf8");
        output.on("data", (chunk: string) => log(`own-health: ${chunk.trimEnd()}`));
      }
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(signal === null ? `exit code ${code}` : `signal ${signal}`));
      });
    });
    log(`own-health: completed ${running.sha}`);
  } catch (error) {
    log(`own-health: failed for ${running.sha}: ${error instanceof Error ? error.message : String(error)}; will try again at the next update`);
  }
}
