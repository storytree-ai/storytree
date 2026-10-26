/** Capability 2 · Storytree projects. Storytree projects (app 2): the remembered picker choice and the current list. */
import { projectOnShow, readProjectChoice, recordProjectChoice } from "@storytree/project-and-caller";
import type { FactoryLink } from "@storytree/library";

/**
 * Where the project on show sits among factories (ADR-1040), for the app bar's switch (ADR-1048 D3): a product with
 * its factory here, the factory with the product to go back to (none when no product here builds with it) and whether
 * it builds itself (ADR-1086 D3), or no factory yet.
 */
export type FactoryPlace =
  | { place: "product"; factory: string }
  | { place: "factory"; product: string | undefined; itself?: true }
  | { place: "none" };

export interface ProjectSelection {
  projects: string[];
  current: string | undefined;
  /** Where the project on show sits among factories; absent where the app reads no lineage. */
  factory?: FactoryPlace;
}

/** Setup and the app share the choice record. Passive reads never write over a user's choice. */
export function projectSelection({ listProjects, file, lineageOf, buildsItself }: {
  listProjects(): Promise<string[]>;
  file: string;
  /** A project's factory link, as its library keeps it (library 1.19). */
  lineageOf?(name: string): Promise<FactoryLink>;
  /** Whether a factory builds itself: it has a folder of its own, as a factory the user brought may (ADR-1086 D3). */
  buildsItself?(name: string): Promise<boolean>;
}) {
  let requested: string | undefined;
  /** The product last on show for each factory, which the factory's switch goes back to. */
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
    // Read after the async query: setup may have completed while that query was in flight.
    const current = requested ?? projectOnShow(projects, readProjectChoice(file));
    if (requested !== undefined && projects.includes(requested)) {
      recordProjectChoice(file, requested);
      requested = undefined;
    }
    if (lineageOf === undefined || current === undefined || !projects.includes(current)) return { projects, current };
    return { projects, current, factory: await placeOf(current, projects, lineageOf) };
  }

  async function placeOf(current: string, projects: string[], lineageOf: (name: string) => Promise<FactoryLink>): Promise<FactoryPlace> {
    // A lineage that cannot be read is no factory, never a broken selection.
    const link = (name: string) => lineageOf(name).catch((): FactoryLink => ({ kind: "none" }));
    const here = await link(current);
    if (here.kind === "product" && projects.includes(here.factory)) {
      cameFrom.set(here.factory, current);
      return { place: "product", factory: here.factory };
    }
    if (here.kind !== "factory") return { place: "none" };
    // A factory that cannot be told to build itself reads as the library-only one storytree ships.
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
