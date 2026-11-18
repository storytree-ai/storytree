// Capability 8 · Page bridge
import { asReader } from "@storytree/library/reads";

import type { PageHandlers } from "../page-operations.js";

export function readerPerChannel(handlers: PageHandlers): PageHandlers {
  return {
    handle(channel, listener) {
      const reader = `app ${channel.replace(/^storytree:/, "")}`;
      handlers.handle(channel, (event: unknown, ...args: unknown[]) => asReader(reader, () => listener(event, ...args)));
    },
  };
}

export function lateReads<Reads extends object>(methods: readonly (keyof Reads & string)[], open: () => Reads): Reads {
  return Object.fromEntries(methods.map((method) => [method, (...asked: unknown[]) => {
    const now = open();
    return (now[method] as (...asked: unknown[]) => unknown).apply(now, asked);
  }])) as Reads;
}

export function projectAnswers<Project, Selection>({ reads, projects }: {
  reads(): { listProjects(): Project[] | Promise<Project[]> } | undefined;
  projects(): { read(): Selection; choose(name: unknown): unknown } | undefined;
}) {
  return {
    listProjects: () => reads()?.listProjects() ?? [],
    projectSelection: () => projects()?.read() ?? { projects: [], current: undefined },
    chooseProject: (name: unknown) => {
      const selection = projects();
      if (selection === undefined) throw new Error("The library is not open");
      return selection.choose(name);
    },
  };
}
