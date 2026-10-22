/**
 * Capability 1 · Lifecycle. The page's answers that wait on the library: the page asks before it opens, and again after
 * it reopens, so each answer reaches for the library open at the time it is asked (contract 1.29).
 */

/** Each of `methods` answered by the reads `open` gives when asked, which throws while the library is not open. */
export function lateReads<Reads extends object>(methods: readonly (keyof Reads & string)[], open: () => Reads): Reads {
  return Object.fromEntries(methods.map((method) => [method, (...asked: unknown[]) => {
    const now = open();
    return (now[method] as (...asked: unknown[]) => unknown).apply(now, asked);
  }])) as Reads;
}

/** The project choice the page reads and makes: none to choose from before the library opens, and no choosing then. */
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
