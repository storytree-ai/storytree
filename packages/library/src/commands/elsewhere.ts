// Capability 17 · The library's commands
import { VerbRefusal, type VerbContext } from "../verbs/verb.js";

export type Reach<L> = { readonly project: string; readonly opened: L; readonly unopened?: undefined } | { readonly project: string; readonly opened?: undefined; readonly unopened: string };

export interface Reachable<L> {
  readonly name: string;
  reach(project: string): Promise<L>;
  reachAll(): Promise<readonly Reach<L>[]>;
}

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

export async function libraryNamed<L extends Reachable<L>>(library: L, project: string | undefined): Promise<L> {
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

export async function contextIn<L extends Reachable<L>, C extends VerbContext<L>>(context: C & { readonly library: L }, project: string | undefined): Promise<C> {
  const library = await libraryNamed(context.library, project);
  return library === context.library ? context : { ...context, library, project: library.name };
}

export async function librariesNamed<L extends Reachable<L>>(library: L, projects: readonly string[] = []): Promise<Reach<L>[]> {
  if (projects.length === 0) return [{ project: library.name, opened: library }];
  const reached: Reach<L>[] = [];
  for (const project of new Set(projects)) {
    if (project === "all") reached.push({ project: library.name, opened: library }, ...(await library.reachAll()));
    else reached.push({ project, opened: await libraryNamed(library, project) });
  }
  return reached.filter((each, index) => reached.findIndex((other) => other.project === each.project) === index);
}

export function unopenedSaid(project: string, why: string): string {
  return `project ${project}: not read: it could not be opened from this computer: ${why}`;
}
