/**
 * Capability 1 · Knowledge under its shelves. The sheet laid out across the page's tasks (1.17): opening the map moves the
 * shelves as its islands settle, and each move lays the notes out again, which on storytree's own library took 176 to 275 ms
 * in one task. Laid out in steps, a few to a task, no task runs long, and the layout before stays drawn meanwhile.
 */
import { useEffect, useState, type DependencyList } from "react";

/** Hands `run` to the page's next task. */
export type NextTask = (run: () => void) => void;

/**
 * Runs `steps` a few to a task, each `yield` ending one, and hands `built` what it returns. A task runs the next step only
 * while its steps so far, and the longest of them again, fit in `budgetMs`. The call it returns overtakes the run: no more
 * of its steps run, and the one begun is returned.
 */
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

/** What `steps` built across the page's tasks, run again whenever `deps` change, the value before kept meanwhile; undefined with no steps. */
export function useInSteps<T>(steps: (() => Generator<void, T, void>) | undefined, deps: DependencyList): T | undefined {
  const [built, setBuilt] = useState<{ value: T }>();
  // The caller names what the steps read.
  useEffect(() => steps === undefined ? undefined : runInSteps(steps, (value) => setBuilt({ value })), deps);
  return steps === undefined ? undefined : built?.value;
}
