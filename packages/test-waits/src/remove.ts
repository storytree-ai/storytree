// Capability 3 · Removing a test's folders
import { rm as removeTree } from "node:fs/promises";

import { scaled } from "./factor.js";
import { nextPause, realClock, type WaitOptions } from "./wait.js";

export interface RemoveOptions extends WaitOptions {
  readonly rm?: (target: string) => Promise<void>;
  readonly warn?: (text: string) => void;
}

const HELD = new Set(["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]);

export async function removeTemp(target: string, budgetMs = 10_000, options: RemoveOptions = {}): Promise<void> {
  const { platform = process.platform, clock = realClock, rm = (at) => removeTree(at, { recursive: true, force: true }), warn = console.warn } = options;
  const budget = scaled(budgetMs, platform);
  const start = clock.now();
  let previous: number | undefined;
  for (;;) {
    try {
      await rm(target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!HELD.has(code)) throw error;
      const left = budget - (clock.now() - start);
      if (left <= 0) {
        warn(`left the test folder ${target} behind: still held after ${Math.round(clock.now() - start)} ms (${code})`);
        return;
      }
      previous = nextPause(previous, left);
      await clock.sleep(previous);
    }
  }
}
