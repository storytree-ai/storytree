// Which source files of a story package no numbered test reaches (ADR-0838 D5): the guardrail that keeps
// every line of code on an island inside a capability's territory. The rule's code is the Guardrails
// story's (packages/guardrails, ADR-0911 D2), the same a user's project runs as `storytree check`;
// packages/dev-loop/src/allocation.test.mjs runs it over the checkout, with storytree's declared stories,
// in every `pnpm test`, and so in CI.

import { allocationProblems as problemsOf } from "@storytree/guardrails";
import { STORIES } from "./package-boundaries.mjs";

/** One sentence per unallocated source file of storytree's story packages at `root`, each with the three ways out. */
export function allocationProblems(root) {
  return problemsOf(root, STORIES);
}
