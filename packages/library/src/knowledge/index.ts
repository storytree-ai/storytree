/** Capability 6 · Knowledge artifacts. */
export { Knowledge, KNOWLEDGE_KINDS, RANK_LIMIT, LinkLoopError, SupersessionLoopError } from "./knowledge.js";
export type { Findable, NewDefinition, NewKnowledge, Note, NoteEdit, NoteType, PhraseKind, PhraseOptions, PhrasePage, PlanKind, Ranked, Ranking, RankOptions } from "./knowledge.js";
export type { DecisionNumberPlan, DecisionStatus, DecisionView, NewDecision } from "./decision-log.js";
export { MemoryVectors } from "./embedding.js";
export type { Embedder, EmbedderSource, VectorStore } from "./embedding.js";
export type { Related, RelatedHit, RelatedOptions } from "./similarity.js";
