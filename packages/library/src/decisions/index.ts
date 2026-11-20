// Capability 13 · Decision log
export { checkClauseSupersession, checkFrontCover, DecisionLog, partlySupersedes, withClauses } from "./decision-log.js";
export type { ClauseSupersession, DecisionNumberPlan, DecisionStatus, DecisionView, NarrowsMove, NewDecision, SupersessionPair, SupersessionPairs } from "./decision-log.js";
export { annotate, correct } from "./corrections.js";
export type { Annotation, Correction } from "./corrections.js";
export { DecisionRefusal, editDecision, recordDecision, supersede } from "./supersede.js";
export type { Successor } from "./supersede.js";
export { ADR_FAMILY } from "./adr.js";
