// Capability 17 · The library's commands
import type { Library, Reached } from "../index.js";
import { VerbRefusal, type VerbContext } from "../verbs/verb.js";

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
    if (error instanceof Error && (error.name === "OutsideCircleError" || error.name === "ProjectGoneError")) {
      throw new VerbRefusal(error.message, { next: [{ command: "library search <words…> --project all", tool: "search_notes", why: "search every library this folder reads" }] });
    }
    throw error;
  }
}

export async function contextIn<C extends VerbContext>(context: C, project: string | undefined): Promise<C> {
  const library = await libraryNamed(context.library, project);
  return library === context.library ? context : { ...context, library, project: library.name };
}

export async function librariesNamed(library: Library, projects: readonly string[] = []): Promise<Reached<Library>[]> {
  if (projects.length === 0) return [{ project: library.name, opened: library }];
  const reached: Reached<Library>[] = [];
  for (const project of new Set(projects)) {
    if (project === "all") reached.push({ project: library.name, opened: library }, ...(await library.reachAll()));
    else reached.push({ project, opened: await libraryNamed(library, project) });
  }
  return reached.filter((each, index) => reached.findIndex((other) => other.project === each.project) === index);
}

export function unopenedSaid(project: string, why: string): string {
  return `project ${project}: not read: it could not be opened from this computer: ${why}`;
}
