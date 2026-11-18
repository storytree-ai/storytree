// Capability 6 · Code allocation guardrail

import { allocationProblems as problemsOf } from "./rules/allocation-rule/allocation-rule.ts";
import { STORIES } from "./package-boundaries.mjs";

export function allocationProblems(root) {
  return problemsOf(root, STORIES, { undeclaredFails: true });
}
