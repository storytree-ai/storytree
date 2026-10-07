/** Capability 2 · Storytree projects. Storytree projects (app 2): the remembered picker choice and the current list. */
import { readProjectChoice, recordProjectChoice } from "@storytree/agent-link";

export interface ProjectSelection {
  projects: string[];
  current: string | undefined;
}

/** Setup and the app share the choice record. Passive reads never write over a user's choice. */
export function projectSelection({ listProjects, file }: { listProjects(): Promise<string[]>; file: string }) {
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
    // Read after the async query: setup may have completed while that query was in flight.
    const previous = readProjectChoice(file);
    const current = requested
      ?? (previous !== undefined && projects.includes(previous) ? previous : projects[0]);
    if (requested !== undefined && projects.includes(requested)) {
      recordProjectChoice(file, requested);
      requested = undefined;
    }
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
