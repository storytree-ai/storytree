import type { Library, Reached } from "../../index.js";
import { VerbRefusal, type VerbContext } from "./verb.js";
import { outsideCircle } from "./where.js";

export const PROJECT_INPUT = {
  kind: "text",
  optional: true,
  describe: "Read this project's library instead of this folder's: its factory's, or a project that factory builds",
} as const;

export const PROJECTS_INPUT = {
  kind: "text",
  many: true,
  optional: true,
  describe: "Search these projects' libraries instead of this folder's (its factory's, or projects it builds), each result under its project; all for every one",
} as const;

export async function libraryNamed(library: Library, project: string | undefined): Promise<Library> {
  if (project === undefined || project === library.name) return library;
  try {
    return await library.reach(project);
  } catch (error) {
    if (outsideCircle(error)) throw new VerbRefusal(error.message, { misuse: true });
    throw error;
  }
}

export async function contextIn<C extends VerbContext>(context: C, project: string | undefined): Promise<C> {
  const there = await libraryNamed(context.library, project);
  return there === context.library ? context : { ...context, library: there, project: there.name };
}

export async function librariesNamed(library: Library, projects: readonly string[] = []): Promise<Reached<Library>[]> {
  const own: Reached<Library> = { project: library.name, opened: library };
  if (projects.length === 0) return [own];
  if (projects.includes("all")) return [own, ...(await library.reachAll()).filter(({ project }) => project !== library.name)];
  const reached: Reached<Library>[] = [];
  for (const project of new Set(projects)) reached.push({ project, opened: await libraryNamed(library, project) });
  return reached;
}

export function unopenedSaid(project: string, why: string): string {
  return `project ${project}: not read: it could not be opened from this computer: ${why}`;
}
