/**
 * Capability 1 · Base structure measures (story Code measures, ADR-1365): each story's base code-structure measures,
 * read from a checkout's source at a commit, report-only, never a gate (ADR-1354, ADR-1238). The readings over files,
 * and the reading of every story at a commit.
 */
export { churnOf, TOP_FILES, type ChurnFile, type ChurnReading } from "./churn.js";
export { complexityOf, functionsOf, p90, type ComplexityReading, type FunctionReading } from "./complexity.js";
export { couplingOf, publicSurfaceOf, specifiersOf, type CouplingReading, type WorkspacePackage } from "./coupling.js";
export { CLONE_TOKENS, duplicationOf, type DuplicationReading } from "./duplication.js";
export { loosenessOf, type LoosenessCounts, type LoosenessReading } from "./looseness.js";
export { DEFAULT_DAYS, readStoryMeasures, type MeasuresReading, type StoryMeasures } from "./read.js";
export { measuresText } from "./report.js";
export { kindOf, sizeOf, type FileKind, type Size, type SourceText } from "./source.js";
