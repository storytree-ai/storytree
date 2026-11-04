/** Capability 22 · Decision corrections, and capability 13 · Decision log's supersession. */
export { annotate, correct } from "./decision-log.js";
export type { Annotation, Correction } from "./decision-log.js";
export { editDecision, recordDecision, supersede } from "./supersede.js";
export type { Successor } from "./supersede.js";
