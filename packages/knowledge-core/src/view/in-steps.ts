// Capability 1 · Knowledge under its shelves
import { useEffect, useState, type DependencyList } from "react";

export type NextTask = (run: () => void) => void;

export function runInSteps<T>(steps: () => Generator<void, T, void>, built: (value: T) => void,
  nextTask: NextTask = (run) => { setTimeout(run, 0); }, budgetMs = 40, now: () => number = () => performance.now()): () => void {
  let running: Generator<void, T, void> | undefined, overtaken = false;
  const task = () => {
    if (overtaken) return;
    running ??= steps();
    const start = now();
    for (let longest = 0; ;) {
      const began = now();
      const at = running.next();
      if (at.done) { built(at.value); return; }
      const end = now();
      longest = Math.max(longest, end - began);
      if (end - start + longest > budgetMs) break;
    }
    nextTask(task);
  };
  nextTask(task);
  return () => { overtaken = true; running?.return(undefined as T); };
}

export function useInSteps<T>(steps: (() => Generator<void, T, void>) | undefined, deps: DependencyList): T | undefined {
  const [built, setBuilt] = useState<{ value: T }>();
  useEffect(() => steps === undefined ? undefined : runInSteps(steps, (value) => setBuilt({ value })), deps);
  return steps === undefined ? undefined : built?.value;
}
