// Capability 8 · Storytree's own test and gate entries. Storytree's own `pnpm test`: the base dev loop's test runner
// (packages/base-dev-loop/src/test.mjs, which says what a run does) handed storytree's own list of the proofs run alone, and holding past its scope decision the run holds this computer's parts contribute
// (the base dev loop's contributedHold): where Mick's factory plugin micks-dev-loop is named, the machine's heavy-run lock,
// so concurrent sessions' runs on one machine queue and a waiting run names whose it waits for (ADR-1192 D2). Under
// `pnpm gate`, the gate holds it and this run's hold takes nothing (STORYTREE_HEAVY_LOCK_HOLDER); with no plugin named
// (CI, a clone of storytree) it holds nothing.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { contributedHold } from "@storytree/base-dev-loop";
import { testCommand } from "@storytree/base-dev-loop/test";

const root = fileURLToPath(new URL("../../..", import.meta.url));

// No check rides along in every scoped run: the package-boundary and allocation rules, which a change inside any one
// package can break, run once per pull request in `pnpm lint` (lint.mjs, ADR-1199 D2), in the gate and in CI.

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

/** Run the base test runner on `argv` with storytree's own list, holding the parts' run holds for its heavy part. */
export function storytreeTest(argv = process.argv.slice(2)) {
  testCommand({ argv, root, hold: contributedHold({ root }), alone: ALONE });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) storytreeTest();
