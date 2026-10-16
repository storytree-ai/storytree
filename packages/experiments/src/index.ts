/** The Experiments story's public API (ADR-1064): capability 1 · Arm switch and capability 4 · Experiment record and freeze. */
export { ARMS, verdictOf, type ArmRecord, type Verdict } from "./arms.js";
export { ExperimentRefusal, freeze, frozenExperiment, type Experiment } from "./record/record.js";
