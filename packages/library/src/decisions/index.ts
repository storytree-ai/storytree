// Capability 31 · Decisions
export { checkClauseSupersession, checkFrontCover, decisionEdgeTargets, DecisionLog, justifiedEdit, partlySupersedes, prunedEdit, restoredEdit, withClauses } from "./decision-log.js";
export type { ArchivedDecisionLink, ArchivedLink, ClauseSupersession, DecisionLinkBacklog, DecisionNumberPlan, DecisionStatus, DecisionView, NarrowsMove, NewDecision, SupersessionPair, SupersessionPairs } from "./decision-log.js";
export { annotate, correct } from "./corrections.js";
export type { Annotation, Correction } from "./corrections.js";
export { DecisionRefusal, editDecision, recordDecision, supersede } from "./supersede.js";
export type { Successor } from "./supersede.js";
export { ADR_FAMILY } from "./adr.js";
