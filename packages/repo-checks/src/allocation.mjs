// Capability 6 · Code allocation guardrail. Which source files of a story package no numbered test reaches (ADR-0838 D5): the guardrail that keeps
// every line of code on an island inside a capability's territory. The rule's code is this package's
// capability 10 (src/rules/allocation-rule, ADR-1199 D5), the same the owner's dev-loop plugin runs as `storytree check`;
// `pnpm lint` (lint.mjs) runs it over the checkout, with storytree's declared stories, in `pnpm gate` and in CI
// on every pull request. Every one of storytree's own source files declares its capability, so
// here an undeclared one fails too (ADR-0925 D2), which a user's `storytree check` is not asked to do.

import { allocationProblems as problemsOf } from "./rules/allocation-rule/allocation-rule.ts";
import { STORIES } from "./package-boundaries.mjs";

/** One sentence per unallocated, misdeclared or undeclared source file of storytree's story packages at `root`, each with its ways out. */
export function allocationProblems(root) {
  return problemsOf(root, STORIES, { undeclaredFails: true });
}
