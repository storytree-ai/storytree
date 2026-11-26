// Capability 31 · Decisions
export type { NewDefinition, NoteEdit } from "../notes/index.js";
export { annotate, correct, recordDecision, supersede, type Annotation, type Correction, type Successor } from "./door.js";
export { byCreation, Knowledge, SupersessionLoopError, type ClauseSupersession, type DecisionStatus, type DecisionView, type NewDecision } from "./knowledge.js";
export type { DecisionNumberPlan } from "./numbering.js";
