// Capability 13 · Heavy runs, coverage and the test ratio. Storytree's own `pnpm test`: the base dev loop's test runner
// (packages/base-dev-loop/src/test.mjs, which says what a run does) holding the machine's heavy-run lock (heavy-lock.mjs)
// past its scope decision, so concurrent sessions' runs on one machine queue and a waiting run names whose it waits for.
// Under `pnpm gate`, the gate holds the lock and this run's hold takes nothing (STORYTREE_HEAVY_LOCK_HOLDER).
import path from "node:path";
import { fileURLToPath } from "node:url";

import { testCommand } from "@storytree/base-dev-loop/test";

import { acquireHeavyLock } from "./heavy-lock.mjs";

/** Run the base test runner on `argv`, holding the heavy-run lock for its heavy part. */
export function storytreeTest(argv = process.argv.slice(2)) {
  testCommand({ argv, hold: acquireHeavyLock });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) storytreeTest();
