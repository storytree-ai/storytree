/**
 * Capability 13 · Decision log. The decision register's one entry (ADR-1343): the decision log and capability 22 ·
 * Decision corrections, as one part of the library. Below the library's API, the log Knowledge hands each decision
 * verb to (decision-log.ts); above it, what reaches decisions through a Library: one way to supersede, through which
 * every door that records or edits a decision comes (supersede.ts), corrections in place and narrowing notes
 * (corrections.ts), and the `adr` verbs the command line mounts (adr.ts).
 */
export { checkFrontCover, DecisionLog } from "./decision-log.js";
export type { DecisionNumberPlan, DecisionStatus, DecisionView, NewDecision } from "./decision-log.js";
export { annotate, correct } from "./corrections.js";
export type { Annotation, Correction } from "./corrections.js";
export { DecisionRefusal, editDecision, recordDecision, supersede } from "./supersede.js";
export type { Successor } from "./supersede.js";
export { ADR_FAMILY } from "./adr.js";
