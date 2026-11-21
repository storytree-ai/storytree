// Capability 33 · Notes and search
export { Knowledge, KNOWLEDGE_KINDS, knowledgeGuidance, RANK_LIMIT, LinkLoopError, referenceEdgesOf, SupersessionLoopError } from "./knowledge.js";
export type { Findable, NewDefinition, NewKnowledge, Note, NoteEdit, NoteType, PhraseKind, PhraseOptions, PhrasePage, NarrowingDecision, PlanKind, Ranked, Ranking, RankOptions } from "./knowledge.js";
export { ARTIFACT_KINDS, WRITTEN_KINDS } from "./kinds.js";
export { MemoryVectors } from "./embedding.js";
export type { Embedder, EmbedderSource, VectorStore } from "./embedding.js";
export type { Related, RelatedHit, RelatedOptions } from "./similarity.js";
export { modelsFolder } from "./embedding-model.js";
export { PgVectors, vectorServerIdentity } from "./embeddings.js";
export type { VectorDomain } from "./embeddings.js";
export { pendingMemories, upgradeMemories } from "./memory-upgrade.js";
