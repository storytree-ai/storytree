// Capability 33 · Knowledge
import type { Library, Storytree } from "../index.js";
import type { Verb, VerbInputs } from "../verbs/verb.js";
import { NOTE_TOOLS as NOTES_TOOLS, type NoteToolContext as NotesToolContext } from "./notes/notes.js";

export { Knowledge, KNOWLEDGE_KINDS, knowledgeGuidance, RANK_LIMIT, LinkLoopError, referenceEdgesOf, SupersessionLoopError } from "./notes/knowledge.js";
export type { Findable, NewDefinition, NewKnowledge, Note, NoteEdit, NoteType, PhraseKind, PhraseOptions, PhrasePage, NarrowingDecision, PlanKind, Ranked, Ranking, RankOptions } from "./notes/knowledge.js";
export { ARTIFACT_KINDS, WRITTEN_KINDS } from "./notes/kinds.js";
export { MemoryVectors } from "./search/embedding.js";
export type { Embedder, EmbedderSource, VectorStore } from "./search/embedding.js";
export type { Related, RelatedHit, RelatedOptions } from "./notes/similarity.js";
export { modelsFolder } from "./search/embedding-model.js";
export { PgVectors, vectorServerIdentity } from "./search/embeddings.js";
export type { VectorDomain } from "./search/embeddings.js";
export { pendingMemories, upgradeMemories } from "./notes/memory-upgrade.js";
export { attachedTo, everyHolding, holdingLines, labelOf, partsBeside, recordLines } from "./notes/notes.js";
export type { Found, HeldClaim, NoteRead, PhraseHit, Presenter } from "./notes/notes.js";
export { narrowedSaid, rankedSearch } from "./notes/ranked.js";
export { refuseStaleEdit } from "./notes/stale-edit.js";
export { contextIn, libraryNamed, librariesNamed, PROJECT_INPUT, PROJECTS_INPUT, unopenedSaid } from "./notes/elsewhere.js";

export type NoteToolContext = NotesToolContext<Library, Pick<Storytree, "ownDatabase">>;

export const NOTE_TOOLS: readonly Verb<VerbInputs, NoteToolContext>[] = NOTES_TOOLS;
