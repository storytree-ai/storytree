// Capability 3 · Story node render
import { useEffect, useState, type DependencyList } from "react";

export type NextTask = (run: () => void) => void;

export type Turn = () => Turn | void;

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

const pageTurns = new BuildTurns();

export function useBuiltInSteps<T>(steps: () => Generator<void, T, void>, deps: DependencyList, turns: BuildTurns = pageTurns): T | undefined {
  const [built, setBuilt] = useState<{ value: T }>();
  useEffect(() => buildInSteps(turns, steps, (value) => setBuilt({ value })), [turns, ...deps]);
  return built?.value;
}

export function buildInSteps<T>(turns: BuildTurns, steps: () => Generator<void, T, void>, built: (value: T) => void): () => void {
  const overtaken = new AbortController();
  let running: Generator<void, T, void> | undefined;
  const step: Turn = () => {
    running ??= steps();
    const at = running.next();
    if (!at.done) return step;
    built(at.value);
  };
  turns.ask(step, overtaken.signal);
  return () => { overtaken.abort(); running?.return(undefined as T); };
}
