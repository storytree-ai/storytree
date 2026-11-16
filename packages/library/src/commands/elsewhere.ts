/**
 * Capability 17 · The library's commands: reading another library of the folder's factory's circle (29.7, ADR-1348 D2).
 * A read verb takes a `project`, naming the factory's library or a library of a project it builds, so a session reads
 * them all from either folder: from the factory's checkout or from one of its projects'. With none named it reads the
 * folder's own, as before; a project outside the circle, or one not on this library, is refused saying so. Writes never
 * take it (ADR-1348 D3 is its own work).
 */
import type { Library, Reached } from "../index.js";
import { VerbRefusal, type VerbContext } from "../verbs/verb.js";

/** The `project` input a read verb declares: one other library to read. */
export const PROJECT_INPUT = {
  kind: "text",
  optional: true,
  describe: "Read this project's library instead of this folder's: its factory's, or a project that factory builds",
} as const;

/** The `project` input a search declares: the libraries to search, `all` for every library of the circle. */
export const PROJECTS_INPUT = {
  kind: "text",
  many: true,
  optional: true,
  describe: "Search these projects' libraries instead of this folder's (its factory's, or projects it builds), each result under its project; all for every one",
} as const;

/** The library `project` names, read from `library`: its own when none is named, else one of its factory's circle. */
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

/**
 * The caller's context reading `project`'s library, under that project's name, so what a verb reads beside the library
 * (claims, sessions) is that project's too; the caller's own when none is named.
 */
export async function contextIn<C extends VerbContext>(context: C, project: string | undefined): Promise<C> {
  const library = await libraryNamed(context.library, project);
  return library === context.library ? context : { ...context, library, project: library.name };
}

/**
 * The libraries `projects` names, read from `library`, in the order named: its own alone when none is named, and for
 * `all`, its own then every other of its factory's circle, a project it could not open named with why.
 */
export async function librariesNamed(library: Library, projects: readonly string[] = []): Promise<Reached<Library>[]> {
  if (projects.length === 0) return [{ project: library.name, opened: library }];
  const reached: Reached<Library>[] = [];
  for (const project of new Set(projects)) {
    if (project === "all") reached.push({ project: library.name, opened: library }, ...(await library.reachAll()));
    else reached.push({ project, opened: await libraryNamed(library, project) });
  }
  return reached.filter((each, index) => reached.findIndex((other) => other.project === each.project) === index);
}

/** The line naming a project the tooling could not open from here, and why. */
export function unopenedSaid(project: string, why: string): string {
  return `project ${project}: not read: it could not be opened from this computer: ${why}`;
}
