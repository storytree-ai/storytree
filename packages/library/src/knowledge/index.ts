// Capability 33 · Knowledge
export { Knowledge, KNOWLEDGE_KINDS, knowledgeGuidance, RANK_LIMIT, LinkLoopError, referenceEdgesOf, SupersessionLoopError } from "./notes/knowledge.js";
export type { Findable, NewDefinition, NewKnowledge, Note, NoteEdit, NoteType, PhraseKind, PhraseOptions, PhrasePage, NarrowingDecision, PlanKind, Ranked, Ranking, RankOptions } from "./notes/knowledge.js";
export { ARTIFACT_KINDS, WRITTEN_KINDS } from "./notes/kinds.js";
export type { KnowledgeKind } from "./schema.js";
export { MemoryVectors } from "./search/embedding.js";
export type { Embedder, EmbedderSource, VectorStore } from "./search/embedding.js";
export type { Related, RelatedHit, RelatedOptions } from "./notes/similarity.js";
export { modelsFolder } from "./search/embedding-model.js";
export { PgVectors, vectorServerIdentity } from "./search/embeddings.js";
export type { VectorDomain } from "./search/embeddings.js";
export { pendingMemories, upgradeMemories } from "./notes/memory-upgrade.js";
export { attachedTo, everyHolding, holdingLines, labelOf, NOTE_TOOLS, partsBeside, recordLines } from "./notes/notes.js";
export type { Found, HeldClaim, NoteRead, NoteToolContext, PhraseHit, Presenter } from "./notes/notes.js";
export { narrowedSaid, rankedSearch } from "./notes/ranked.js";
export { refuseStaleEdit } from "./notes/stale-edit.js";
export { contextIn, libraryNamed, librariesNamed, PROJECT_INPUT, PROJECTS_INPUT, unopenedSaid } from "./notes/elsewhere.js";
export { ADR_FAMILY, annotate, correct, editDecision, justificationSaid, recordDecision, supersede, supersededLines } from "./decisions/index.js";
export type { Annotation, Correction, DecisionLibrary, DecisionNumberPlan, DecisionStatus, DecisionView, NewDecision, Successor } from "./decisions/index.js";
