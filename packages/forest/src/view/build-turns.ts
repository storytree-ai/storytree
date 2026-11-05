/**
 * Capability 3 · Story node render (the forest story): the islands' heavy builds take turns, one per task (3.87).
 */
import { useEffect, useState, type DependencyList } from "react";

/** Hands `run` to the page's next task. */
export type NextTask = (run: () => void) => void;

/**
 * 3.87: the islands' heavy builds (a layout settled, a land's meshes built) take turns, one per task, in the order asked, so
 * opening the map, with every island laid out and its roads arriving, never runs several islands' builds in one long task.
 * A build overtaken while it waits (`signal` aborted) is passed over without running.
 */
export class BuildTurns {
  private readonly waiting: { build: () => void; signal: AbortSignal }[] = [];
  private scheduled = false;

  constructor(private readonly nextTask: NextTask = (run) => { setTimeout(run, 0); }) {}

  ask(build: () => void, signal: AbortSignal): void {
    if (signal.aborted) return;
    this.waiting.push({ build, signal });
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || this.waiting.length === 0) return;
    this.scheduled = true;
    this.nextTask(() => {
      this.scheduled = false;
      let turn = this.waiting.shift();
      while (turn !== undefined && turn.signal.aborted) turn = this.waiting.shift();
      try { turn?.build(); } finally { this.schedule(); }
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
  const [built, setBuilt] = useState<{ value: T }>();
  useEffect(() => {
    const overtaken = new AbortController();
    turns.ask(() => setBuilt({ value: build() }), overtaken.signal);
    return () => overtaken.abort();
    // The caller names what the build reads.
  }, [turns, ...deps]);
  return built?.value;
}
