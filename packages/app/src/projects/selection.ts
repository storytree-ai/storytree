/** Storytree projects (app 2): the remembered picker choice and the current list. */
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export interface ProjectSelection {
  projects: string[];
  current: string | undefined;
}

interface Remembered {
  projects: string[];
  current?: string;
}

/** One app owns this file. Reads and choices are serialized so an older read cannot undo a click. */
export function projectSelection({ listProjects, file }: { listProjects(): Promise<string[]>; file: string }) {
  let remembered = load(file);
  let requested: string | undefined;
  let queue = Promise.resolve();

  function serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action);
    queue = result.then(() => {}, () => {});
    return result;
  }

  async function read(choice?: string, explicit = false): Promise<ProjectSelection> {
    const projects = await listProjects();
    if (explicit && (choice === undefined || !projects.includes(choice))) {
      throw new Error(`there is no project called ${JSON.stringify(choice)}`);
    }
    if (choice !== undefined) requested = choice;
    const added = remembered === undefined ? [] : projects.filter((name) => !remembered!.projects.includes(name));
    const previous = remembered?.current;
    // With one arrival, the existing setup flow's new database is enough to observe the yes.
    // A batch of arrivals has no ordering in listProjects; keep the existing choice in that case.
    const current = requested ?? (added.length === 1 ? added[0] : undefined)
      ?? (previous !== undefined && projects.includes(previous) ? previous : projects[0]);
    const next: Remembered = {
      projects,
      ...(current !== undefined && projects.includes(current) ? { current } : previous === undefined ? {} : { current: previous }),
    };
    if (JSON.stringify(next) !== JSON.stringify(remembered)) {
      writeFileSync(`${file}.tmp`, `${JSON.stringify(next)}\n`, "utf8");
      renameSync(`${file}.tmp`, file);
      remembered = next;
    }
    if (current !== undefined && projects.includes(current)) requested = undefined;
    return { projects, current };
  }

  return {
    read: (requested?: string) => serialize(() => read(requested)),
    choose: (name: unknown) => serialize(() => {
      if (typeof name !== "string") throw new Error("there is no project with that name");
      return read(name, true);
    }),
  };
}

function load(file: string): Remembered | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (value !== null && typeof value === "object" && "projects" in value
      && Array.isArray(value.projects) && value.projects.every((name) => typeof name === "string")
      && (!("current" in value) || typeof value.current === "string")) return value as Remembered;
  } catch { /* An interrupted/old preference is not a reason to hide the projects. */ }
  return undefined;
}
