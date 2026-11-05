/**
 * Capability 3 · Story node render (the forest story): the islands' heavy builds take turns, a few to a task (3.87).
 */
import { useEffect, useState, type DependencyList } from "react";

/** Hands `run` to the page's next task. */
export type NextTask = (run: () => void) => void;

/** One build, or one step of a build that hands back its next step. */
export type Turn = () => Turn | void;

/**
 * 3.87: the islands' heavy builds (a layout settled, a land's meshes built) take turns in the order asked, so
 * opening the map, with every island laid out and its roads arriving, never runs several islands' builds in one long task. A
 * task runs the next build only while its builds so far, and the longest of them again, fit in `budgetMs`: every task that
 * builds is a frame the map draws, which a computer drawing without a graphics card pays most for (PR #495 on macOS).
 * A build in steps hands back its next step, which waits ahead of the builds asked after it, so an island's build is finished
 * first. A build overtaken while it waits (`signal` aborted), between steps too, is passed over without running.
 */
export class BuildTurns {
  private readonly waiting: { build: Turn; signal: AbortSignal }[] = [];
  private scheduled = false;

  constructor(
    private readonly nextTask: NextTask = (run) => { setTimeout(run, 0); },
    private readonly budgetMs = 50,
    private readonly now: () => number = () => performance.now(),
  ) {}

  ask(build: Turn, signal: AbortSignal): void {
    if (signal.aborted) return;
    this.waiting.push({ build, signal });
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || this.waiting.length === 0) return;
    this.scheduled = true;
    this.nextTask(() => {
      this.scheduled = false;
      const start = this.now();
      try {
        for (let longest = 0; ;) {
          let turn = this.waiting.shift();
          while (turn !== undefined && turn.signal.aborted) turn = this.waiting.shift();
          if (turn === undefined) break;
          const began = this.now();
          const next = turn.build();
          if (typeof next === "function") this.waiting.unshift({ build: next, signal: turn.signal });
          const end = this.now();
          longest = Math.max(longest, end - began);
          if (end - start + longest > this.budgetMs) break;
        }
      } finally { this.schedule(); }
    });
  }
}

/** The page's one queue, which every island's builds share. */
const pageTurns = new BuildTurns();

/**
 * What `build` made when its turn came (3.87), and undefined until the first one has. Asked again whenever `deps` change; the
 * value built for the deps before stays meanwhile, and a build their next change overtakes before its turn is never run.
 */
export function useBuiltInTurn<T>(build: () => T, deps: DependencyList, turns: BuildTurns = pageTurns): T | undefined {
  return useBuiltInSteps(function* () { return build(); }, deps, turns);
}

/**
 * As `useBuiltInTurn`, for a build too long for one turn: each `yield` ends a step, and the next runs in a later turn. A build
 * overtaken between steps runs no more of them, and is returned (its `finally` blocks run) to let go of what it made.
 */
export function useBuiltInSteps<T>(steps: () => Generator<void, T, void>, deps: DependencyList, turns: BuildTurns = pageTurns): T | undefined {
  const [built, setBuilt] = useState<{ value: T }>();
  useEffect(() => {
    const overtaken = new AbortController();
    let running: Generator<void, T, void> | undefined;
    const step: Turn = () => {
      running ??= steps();
      const at = running.next();
      if (!at.done) return step;
      setBuilt({ value: at.value });
    };
    turns.ask(step, overtaken.signal);
    return () => { overtaken.abort(); running?.return(undefined as T); };
    // The caller names what the build reads.
  }, [turns, ...deps]);
  return built?.value;
}
