/** The explicit project choice shared by setup and the app (ADR-0657 D3). */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Read afresh: another process may have completed setup since the last poll. */
export function readProjectChoice(file: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const value: unknown = JSON.parse(text);
    // Also reads the earlier app's { projects, current } preference.
    if (value !== null && typeof value === "object" && "current" in value
      && typeof value.current === "string") return value.current;
  } catch { /* A damaged preference is not a reason to hide the projects. */ }
  return undefined;
}

/**
 * Successful choices replace one record; the last completed write wins, without clock ties.
 * Each writer has its own temporary file, so concurrent setup and picker writes cannot mix.
 * Polling and ordinary agent starts must never call this.
 */
export function recordProjectChoice(file: string, project: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ current: project })}\n`, { encoding: "utf8", flag: "wx", flush: true });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const REMOVED_FILE = "removed-projects.json";

/** The projects taken off this computer's list (the app's Projects picker), kept in the app's home. */
export function removedProjects(home: string): string[] {
  try {
    const { removed } = JSON.parse(readFileSync(path.join(home, REMOVED_FILE), "utf8")) as { removed?: unknown };
    return Array.isArray(removed) ? removed.filter((name): name is string => typeof name === "string") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function recordRemovedProjects(home: string, removed: readonly string[]): void {
  mkdirSync(home, { recursive: true });
  const file = path.join(home, REMOVED_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ removed: [...new Set(removed)].sort() }, null, 2)}\n`);
  renameSync(temp, file);
}

/** Put `project` back on this computer's list, if it was taken off: adding its folder again, or joining it on purpose. */
export function keepOnThisComputer(project: string, home: string): void {
  const removed = removedProjects(home);
  if (removed.includes(project)) recordRemovedProjects(home, removed.filter((name) => name !== project));
}
