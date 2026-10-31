// Capability 13 · Heavy runs, coverage and the test ratio. Storytree's own `pnpm test`: the base dev loop's test runner
// (packages/base-dev-loop/src/test.mjs, which says what a run does) holding the machine's heavy-run lock (heavy-lock.mjs)
// past its scope decision, so concurrent sessions' runs on one machine queue and a waiting run names whose it waits for,
// and handing it storytree's own lists: the checks every scoped run carries and the proofs run alone.
// Under `pnpm gate`, the gate holds the lock and this run's hold takes nothing (STORYTREE_HEAVY_LOCK_HOLDER).
import path from "node:path";
import { fileURLToPath } from "node:url";

import { testCommand } from "@storytree/base-dev-loop/test";

import { acquireHeavyLock } from "./heavy-lock.mjs";

/**
 * Checks that a change inside any one package can fail, so every scoped run carries them as units
 * of their own (a full run has them in their package already). The package-boundary check (ADR-0649 D3)
 * is one: a story's code landing in the frame is a change to the frame alone. The code allocation guardrail
 * (ADR-0838 D5) is another: a file left unreached in one package is a change to that package alone.
 */
export const ALWAYS_RUN = ["packages/repo-checks/src/package-boundaries.test.mjs", "packages/repo-checks/src/allocation.test.mjs"];

/**
 * Test files that run as a unit of their own, after every other unit has ended and with nothing
 * beside them, whenever their package runs; their package's unit runs its other files. Forest's
 * browser proof: its software-GL frames starve when other units and files share a 3-CPU macOS
 * runner (load average 42 in run 38038938459; arc_2a8dbc47a5f9, increment_ba747f54277d), and its
 * 15 s no-new-frame wait is not widened instead. The world's road-reveal proof likewise: on macOS it
 * took 12-15 s in most merge queue runs, but 76 s in one and past its 80 s bound in another (runs 38092380077 and
 * 38032277103; increment_58dcb2d5c9a5). Knowledge-core's traversal proof too: beside other units on macOS it took 72 s in one
 * run and was killed past 180 s in four others (run 39187115227 among them; increment_724389f3f21d). The desktop's named-surfaces
 * proof drives the whole renderer's globe too: about 14 s alone, it pushed its package's unit past 60 s beside the
 * gate's other units on the Mint box (increment_2fd57d63cfae).
 */
export const ALONE = ["packages/forest/src/view/desktop-renderer-smoke.test.ts", "packages/forest-world/src/planet/road-reveal.test.ts",
  "packages/knowledge-core/src/traversal-smoke.test.ts", "apps/desktop/src/renderer/named-surfaces.test.ts"];

/** Run the base test runner on `argv` with storytree's own lists, holding the heavy-run lock for its heavy part. */
export function storytreeTest(argv = process.argv.slice(2)) {
  testCommand({ argv, hold: acquireHeavyLock, alwaysRun: ALWAYS_RUN, alone: ALONE });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) storytreeTest();
