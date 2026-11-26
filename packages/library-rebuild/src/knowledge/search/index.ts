// Capability 14 · Ranked search
export { defaultEmbedder, modelsFolder, verifyModelFolder, type Embedder, type EmbedderSource } from "./model.js";
export { throughProxy } from "./proxy.js";
export { findPhrase, type PhraseKind, type PhraseOptions, type PhrasePage } from "./phrase.js";
export {
  NOTE_KINDS as NOTE_TYPES,
  RankedSearch,
  SEARCHABLE_KINDS,
  type Findable,
  type KnowledgeKind,
  type NarrowingDecision,
  type Note,
  type NoteType,
  type PlanKind,
  type Ranked,
  type Ranking,
  type RankOptions,
} from "./rank.js";
export { chunksOf, renderNote, searchableText } from "./render.js";
export { MemoryVectors, PgVectors, VECTOR_TABLES, vectorServerIdentity, type VectorDomain, type VectorStore } from "./vectors.js";
