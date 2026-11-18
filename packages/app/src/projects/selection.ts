// Capability 2 · Storytree projects
import { projectOnShow, readProjectChoice, recordProjectChoice } from "@storytree/project-and-caller";
import type { FactoryLink } from "@storytree/library";

export type FactoryPlace =
  | { place: "product"; factory: string }
  | { place: "factory"; product: string | undefined; itself?: true }
  | { place: "none" };

export interface ProjectSelection {
  projects: string[];
  current: string | undefined;
  factory?: FactoryPlace;
}

export function projectSelection({ listProjects, file, lineageOf, buildsItself }: {
  listProjects(): Promise<string[]>;
  file: string;
  lineageOf?(name: string): Promise<FactoryLink>;
  buildsItself?(name: string): Promise<boolean>;
}) {
  let requested: string | undefined;
  const cameFrom = new Map<string, string>();
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
    const current = requested ?? projectOnShow(projects, readProjectChoice(file));
    if (requested !== undefined && projects.includes(requested)) {
      recordProjectChoice(file, requested);
      requested = undefined;
    }
    if (lineageOf === undefined || current === undefined || !projects.includes(current)) return { projects, current };
    return { projects, current, factory: await placeOf(current, projects, lineageOf) };
  }

  async function placeOf(current: string, projects: string[], lineageOf: (name: string) => Promise<FactoryLink>): Promise<FactoryPlace> {
    const link = (name: string) => lineageOf(name).catch((): FactoryLink => ({ kind: "none" }));
    const here = await link(current);
    if (here.kind === "product" && projects.includes(here.factory)) {
      cameFrom.set(here.factory, current);
      return { place: "product", factory: here.factory };
    }
    if (here.kind !== "factory") return { place: "none" };
    const itself = (await buildsItself?.(current).catch(() => false)) === true ? { itself: true as const } : {};
    const remembered = cameFrom.get(current);
    if (remembered !== undefined && projects.includes(remembered)) return { place: "factory", product: remembered, ...itself };
    for (const name of projects) {
      const other = await link(name);
      if (other.kind === "product" && other.factory === current) return { place: "factory", product: name, ...itself };
    }
    return { place: "factory", product: undefined, ...itself };
  }

  return {
    read: (requested?: string) => serialize(() => read(requested)),
    choose: (name: unknown) => serialize(() => {
      if (typeof name !== "string") throw new Error("there is no project with that name");
      return read(name, true);
    }),
  };
}
