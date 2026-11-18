// Capability 2 · Settings
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

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
    if (value !== null && typeof value === "object" && "current" in value
      && typeof value.current === "string") return value.current;
  } catch {}
  return undefined;
}

export function projectOnShow(projects: readonly string[], choice: string | undefined): string | undefined {
  return choice !== undefined && projects.includes(choice) ? choice : projects[0];
}

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

export interface HiddenProject {
  readonly name: string;
  readonly identity?: string;
  readonly folder?: string;
}

export function removedProjects(home: string): HiddenProject[] {
  try {
    const { removed, identities, folders } = JSON.parse(readFileSync(path.join(home, REMOVED_FILE), "utf8")) as { removed?: unknown; identities?: unknown; folders?: unknown };
    const record = (value: unknown) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
    const known = record(identities), at = record(folders);
    if (!Array.isArray(removed)) return [];
    return removed
      .filter((name): name is string => typeof name === "string")
      .map((name) => ({
        name,
        ...(typeof known[name] === "string" ? { identity: known[name] } : {}),
        ...(typeof at[name] === "string" ? { folder: at[name] } : {}),
      }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function recordRemovedProjects(home: string, removed: readonly HiddenProject[]): void {
  mkdirSync(home, { recursive: true });
  const file = path.join(home, REMOVED_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  const identities = Object.fromEntries(removed.flatMap((each) => (each.identity === undefined ? [] : [[each.name, each.identity]])));
  const folders = Object.fromEntries(removed.flatMap((each) => (each.folder === undefined ? [] : [[each.name, each.folder]])));
  writeFileSync(temp, `${JSON.stringify({ removed: [...new Set(removed.map((each) => each.name))].sort(), identities, folders }, null, 2)}\n`);
  renameSync(temp, file);
}

export function keepOnThisComputer(project: string, home: string): void {
  const removed = removedProjects(home);
  if (removed.some((each) => each.name === project)) recordRemovedProjects(home, removed.filter((each) => each.name !== project));
}
