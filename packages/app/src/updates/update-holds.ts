// Capability 4 · Updates
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function heldUpdateRuns(home: string, now = Date.now()): string[] {
  const directory = path.join(home, "update-holds");
  let files: string[];
  try { files = readdirSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const runs: string[] = [];
  for (const file of files.filter(file => file.endsWith(".json"))) {
    let hold: unknown;
    try { hold = JSON.parse(readFileSync(path.join(directory, file), "utf8")); }
    catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (typeof hold !== "object" || hold === null) continue;
    const { run, startedAt, expiresAt } = hold as Record<string, unknown>;
    if (typeof run !== "string" || !run.trim() || typeof startedAt !== "number" || typeof expiresAt !== "number") continue;
    if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) continue;
    if (startedAt <= now && now < expiresAt && expiresAt - startedAt <= 6 * 60 * 60_000) runs.push(run);
  }
  return runs.sort();
}
