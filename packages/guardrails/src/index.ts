/**
 * Capability 3 · The check command. Guardrails (ADR-0911 D2): storytree's package rule and allocation rule, run from a checkout alone. A
 * user's project runs them as `storytree check`; storytree's own dev loop runs the same code.
 */
export { packageProblems, storiesOf, type Declarations, type Edge, type Frame, type NotYetMoved } from "./package-rule/package-rule.js";
export { allocationProblems, misdeclaredCode, unallocatedCode, undeclaredCode, type AllocationOptions, type Misdeclared, type Unallocated, type Undeclared } from "./allocation-rule/allocation-rule.js";
export { check, checkoutOf, type CheckReport } from "./check/check.js";
