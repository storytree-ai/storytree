/** Updates 4.12: short-lived, per-run holds shared with the standalone hold-run.mjs wrapper. */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Read again immediately before automatic installation, even if the app predates the run. */
export function heldUpdateRuns(home: string, now = Date.now()): string[] {
  const directory = path.join(home, "update-holds");
  let files: string[];
  try { files = readdirSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error; // An unreadable hold is not permission to replace a running trial's tools.
  }
  const runs: string[] = [];
  for (const file of files.filter(file => file.endsWith(".json"))) {
    let hold: unknown;
    try { hold = JSON.parse(readFileSync(path.join(directory, file), "utf8")); }
    catch (error) {
      // A run can finish while this directory is being read. Broken or abandoned files hold nothing.
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (typeof hold !== "object" || hold === null) continue;
    const { run, startedAt, expiresAt } = hold as Record<string, unknown>;
    if (typeof run !== "string" || !run.trim() || typeof startedAt !== "number" || typeof expiresAt !== "number") continue;
    if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) continue;
    // The wrapper accepts at most six hours. A crash never leaves an indefinite off switch.
    if (startedAt <= now && now < expiresAt && expiresAt - startedAt <= 6 * 60 * 60_000) runs.push(run);
  }
  return runs.sort();
}
