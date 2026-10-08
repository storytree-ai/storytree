/**
 * Capability 6 · Knowledge artifacts (the library story): alongside the plan, the library keeps
 * what the project has learned: decisions, definitions and the other proper artifact kinds. An
 * artifact links to the other artifacts it relates to, and is found again by searching its words.
 *
 * Knowledge is also the one door to the knowledge entrances (capability 9, front-covers.ts), which
 * every link and front cover it writes is checked against, and to the decision log (capability 13,
 * decision-log.ts), which numbers and reads its decisions.
 *
 * ADR-0640 grows it by eight kinds, written with writeKnowledge: principles, guardrails, patterns,
 * processes, agent roles, friction, re-steers and tech stack. They are artifacts like decisions and definitions:
 * searched, linked only to artifacts, and edited with editNote. An agent role's required reading, rules,
 * anti-patterns and step reading, and a process's branch edges, are links to artifacts too (6-a).
 *
 * Knowledge is a layer over capability 3's SchemaRecords, so it runs unchanged on the in-memory
 * twin and on Postgres. Every link, and every front cover, is checked BEFORE the write, and a
 * broken one throws with nothing written; the artifact itself is then checked against its type inside
 * the write, as capability 3 checks every write.
 */
import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord, type Expected } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import { unstorable } from "../schema/records.js";
import type { FieldsOf, KnowledgeKind } from "../schema/types.js";
import { defaultEmbedder } from "./bge-small.js";
import { DecisionLog, type DecisionNumberPlan, type DecisionView, type NewDecision } from "./decision-log.js";
import { MemoryVectors, rankByMeaning, renderNote, type EmbedderSource, type VectorStore } from "./embedding.js";
import { artifactsOnly, checkFrontCover, frontCovers } from "./front-covers.js";
import { relatedEach, relatedTo, type Related, type RelatedOptions, type SimilarityDoc } from "./similarity.js";

/**
 * The fields that link an artifact to other artifacts (6-a), which the loop check follows: its links,
 * and an agent role's required reading, rules, anti-patterns and step reading, and a process's
 * branch edges.
 */
const LINK_FIELDS = ["links", "context", "rules", "antiPatterns", "stepRefs", "branchEdges"] as const;

/** The kinds of artifact: decisions, definitions, and the eight kinds of ADR-0640. */
export type NoteType = "decision" | "definition" | KnowledgeKind;
/** A new artifact of one of the eight kinds: its fields. Every reference in it must name a live artifact. */
export type NewKnowledge<K extends KnowledgeKind = KnowledgeKind> = FieldsOf<K>;
/** A stored artifact of any kind. */
export type Note = SchemaRecord<NoteType>;
/** What a ranked search is computed with: the embedder, and where its vectors are kept (capability 14). */
export interface Ranking {
  readonly embedder: EmbedderSource;
  readonly vectors: VectorStore;
}
/** How many artifacts a ranked search gives back unless told. */
export const RANK_LIMIT = 10;
/** The plan's records a search also finds by their own wording: what an agent amends by meaning. */
export type PlanKind = "story" | "capability" | "contract";
/** A record rankAll can give back: an artifact, or a story, capability or contract of the plan. */
export type Findable = Note | SchemaRecord<PlanKind>;
/** A ranked search's answer (capability 14). */
export interface Ranked<T extends SchemaRecord = Note> {
  /** "meaning" when ranked by the embedding model; "words" when it could not be, and why is said. */
  readonly by: "meaning" | "words";
  /** Why it fell back to words; absent when ranked by meaning. */
  readonly why?: string;
  /** The artifacts, best first. A score, the cosine of its best chunk with the question, comes with meaning only. */
  readonly hits: { readonly note: T; readonly score?: number }[];
}
/** A ranked search's options: how many artifacts to give back, RANK_LIMIT unless told. */
export interface RankOptions {
  readonly limit?: number;
}
/** Literal lookup includes knowledge artifacts and the plan's work records. */
export type PhraseKind = NoteType | PlanKind | "arc" | "increment" | "question";
export interface PhraseOptions {
  /** All PhraseKinds unless selected; an empty list matches nothing. */
  readonly kinds?: readonly PhraseKind[];
  /** Stored top-level string fields to match, all unless selected; an empty list matches nothing. */
  readonly fields?: readonly string[];
  /** Page size: 1–100, default 10. */
  readonly limit?: number;
  /** Last returned id, exclusive. Continue with the same phrase and selections. */
  readonly after?: string;
}
export interface PhrasePage {
  readonly records: SchemaRecord<PhraseKind>[];
  /** Absent when complete; otherwise pass as after on the next call. */
  readonly next?: string;
}
/** One embedder per process for every library not handed another, so the model loads once. */
const SHARED_EMBEDDER = defaultEmbedder();

/** A new definition's fields. Every link must name a live artifact. */
export type NewDefinition = FieldsOf<"definition">;
/** An edit of an artifact: some of its kind's fields. A field set to undefined is removed. */
export type NoteEdit = {
  [K in NoteType]: { [F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined };
}[NoteType];

/** The eight kinds writeKnowledge writes. */
export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = [
  "principle",
  "guardrail",
  "pattern",
  "process",
  "agent",
  "friction",
  "resteer",
  "techstack",
];

const NOTE_TYPES: readonly NoteType[] = ["decision", "definition", ...KNOWLEDGE_KINDS];
const PLAN_KINDS: readonly PlanKind[] = ["story", "capability", "contract"];
const PHRASE_KINDS: readonly PhraseKind[] = [...NOTE_TYPES, ...PLAN_KINDS, "arc", "increment", "question"];

/**
 * The fields that name other artifacts rather than hold words: never searched. (`refs` sits inside an
 * agent role's `stepRefs`, `to` inside a process's `branchEdges`.)
 */
const REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  "links",
  "frontCoverOf",
  "context",
  "rules",
  "antiPatterns",
  "refs",
  "to",
  "supersedes",
  "fingerprint",
  "story",
  "capability",
  "dependsOn",
]);

/** Decision fields that editNote cannot change. */
const OWN_VERBS: Readonly<Record<string, string>> = {
  number: "a decision keeps its assigned number",
  composed: "a composed statement is written with composeStatement",
};

/** What an artifact may link to: another artifact, never the work (capability 9). */
const NOTE: Expected = artifactsOnly(NOTE_TYPES);

export class Knowledge {
  readonly #records: SchemaRecords;
  readonly #ranking: Ranking;
  readonly #log: DecisionLog;

  constructor(records: SchemaRecords, project?: string, ranking: Partial<Ranking> = {}) {
    this.#records = records;
    this.#log = new DecisionLog(records, project, NOTE);
    this.#ranking = { embedder: ranking.embedder ?? SHARED_EMBEDDER, vectors: ranking.vectors ?? new MemoryVectors() };
  }

  /**
   * Record a decision (capability 13): its links, front cover and supersessions checked, numbered
   * inside the write.
   */
  recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    return this.#log.recordDecision(decision, options);
  }

  /** Preview, or with apply store once, storytree's decision number floor (ADR-0662). */
  setDecisionNumberFloor(floor: number, options: WriteOptions & { readonly apply?: boolean } = {}): Promise<number> {
    return this.#log.setDecisionNumberFloor(floor, options);
  }

  /** Repair an imported storytree decision's number once, from its own Full record line. */
  numberDecision(id: string, number: number, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    return this.#log.numberDecision(id, number, options);
  }

  /** Propose every Full record repair without writing. */
  decisionNumberPlan(): Promise<DecisionNumberPlan[]> {
    return this.#log.decisionNumberPlan();
  }

  /** The one-time Full record renumbering, previewed unless apply is explicit. */
  numberDecisionsFromFullRecord(options: WriteOptions & { readonly apply?: boolean } = {}): Promise<DecisionNumberPlan[]> {
    return this.#log.numberDecisionsFromFullRecord(options);
  }

  /** ADR-0662's one-time founding-books renumbering, previewed unless apply is explicit. */
  numberFoundingDecisions(options: WriteOptions & { readonly apply?: boolean } = {}): Promise<DecisionNumberPlan[]> {
    return this.#log.numberFoundingDecisions(options);
  }

  /** A decision as the decision log reads it (capability 13); null if `id` is not a live decision. */
  decision(id: string): Promise<DecisionView | null> {
    return this.#log.decision(id);
  }

  /** Every live decision as decision() reads it, oldest first, from one reading (13.9). */
  decisions(): Promise<DecisionView[]> {
    return this.#log.decisions();
  }

  /** Compose a decision's one statement beside its text (C2). */
  composeStatement(id: string, statement: string, options?: WriteOptions): Promise<SchemaRecord<"decision"> | null> {
    return this.#log.composeStatement(id, statement, options);
  }

  /**
   * Write an artifact of one of the eight kinds (ADR-0640). Its links, and an agent role's or a process's
   * other references, must each name a live artifact, like ordinary links; its fields are then
   * checked against its kind inside the write. A kind that is not one of the eight is refused.
   */
  async writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K>> {
    if (!KNOWLEDGE_KINDS.includes(kind)) {
      throw new RangeError(`writeKnowledge writes ${KNOWLEDGE_KINDS.join(", ")}, not ${JSON.stringify(kind)}`);
    }
    await this.#checkNoteReferences(fields);
    return this.#records.create(kind, fields, options);
  }

  /** Define a term. Its links are checked against live artifacts. */
  async defineTerm(definition: NewDefinition, options?: WriteOptions): Promise<SchemaRecord<"definition">> {
    await this.#checkLinks(definition.links);
    return this.#records.create("definition", definition, options);
  }

  /**
   * Change only the named fields of an artifact, as capability 3's edit does; new links, and a new
   * front cover, are checked as they are when the artifact is written. Setting `frontCoverOf` to
   * undefined takes a decision off its node's shelf. The artifact's earlier wording stays in its
   * history. Returns null, and writes nothing, if `id` is not a live artifact.
   */
  async editNote(id: string, fields: NoteEdit, options?: WriteOptions): Promise<Note | null> {
    const own = Object.keys(fields).find((field) => Object.hasOwn(OWN_VERBS, field));
    if (own !== undefined) throw new RangeError(`editNote does not change ${JSON.stringify(own)}: ${OWN_VERBS[own]}`);
    const note = await liveRecord(this.#records, id, NOTE_TYPES);
    if (note === null) return null;
    await this.#checkNoteReferences(fields);
    if (LINK_FIELDS.some((field) => field in fields)) await this.#refuseLinkLoop(id, { ...note.fields, ...fields });
    if ("frontCoverOf" in fields) await this.#checkFrontCover(fields.frontCoverOf);
    if ("supersedes" in fields) {
      await checkReferences(this.#records, "supersedes", fields.supersedes, "decision");
      if (Array.isArray(fields.supersedes)) await this.#refuseSupersessionLoop(id, fields.supersedes);
    }
    return (await this.#records.edit(id, fields, options)) as Note | null;
  }

  /**
   * The live artifacts in which every whitespace-separated word of `query` appears, ignoring case,
   * somewhere in their text: a decision's title or text, a definition's
   * term or meaning. Links are ids, not words, and are not searched. A word is found wherever it
   * appears, part of a longer word included. A query with no words has none for an artifact to miss,
   * so it matches every artifact. In creation order.
   */
  async search(query: string): Promise<Note[]> {
    return holdingEvery(await this.#notes(), query);
  }

  /** search() for each of `queries`, in order, from one reading of the artifacts. */
  async searchEach(queries: readonly string[]): Promise<Note[][]> {
    const notes = await this.#notes();
    return queries.map((query) => holdingEvery(notes, query));
  }

  /**
   * The live artifacts ranked by how close their meaning is to `query`, best first, at most
   * `limit` of them (capability 14, ADR-0732). Each artifact's rendered text is embedded in chunks
   * and it scores by its best chunk's cosine with the question; a chunk not embedded before (a new
   * or edited artifact) is embedded now. With no embedding model to hand, it gives search()'s
   * word matches instead, in creation order, and says why.
   */
  async rank(query: string, options: RankOptions = {}): Promise<Ranked> {
    return this.#rankAmong(() => this.#notes(), query, options);
  }

  /**
   * rank(), over the live artifacts and the plan's stories, capabilities and contracts together,
   * each labelled by its type: what `storytree library search` answers, so a contract is found by
   * its own wording. A plan record's parent (a contract's capability, a capability's story) is an
   * id, not words, and is not searched.
   */
  async rankAll(query: string, options: RankOptions = {}): Promise<Ranked<Findable>> {
    return this.#rankAmong(async () => {
      const lists = await Promise.all([this.#notes(), ...PLAN_KINDS.map((type) => this.#records.list(type))]);
      return lists.flat().sort(byCreation);
    }, query, options);
  }

  /**
   * Exact, case-sensitive contiguous text inside one stored top-level string field, without
   * tokenisation, wildcard syntax or whitespace normalisation. Filter and limit in the store;
   * return whole current records in id byte order. Each page sees live state, not a snapshot:
   * edits or insertions behind the cursor need a fresh sweep to be seen.
   */
  async findPhrase(phrase: string, options: PhraseOptions = {}): Promise<PhrasePage> {
    if (phrase.length === 0 || unstorable(phrase) !== undefined) throw new RangeError("a phrase must be nonempty storable text");
    const limit = options.limit ?? RANK_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("phrase limit must be a whole number from 1 to 100");
    const kinds = options.kinds ?? PHRASE_KINDS;
    for (const kind of kinds) if (!PHRASE_KINDS.includes(kind)) throw new RangeError(`unknown phrase kind: ${kind}`);
    if (options.after !== undefined && (options.after.length === 0 || unstorable(options.after) !== undefined)) throw new RangeError("phrase after must be a nonempty record id");
    for (const field of options.fields ?? []) if (field.length === 0 || unstorable(field) !== undefined) throw new RangeError("phrase fields must be nonempty field names");
    const found = await this.#records.list(kinds, {
      phrase: { text: phrase, ...(options.fields === undefined ? {} : { fields: options.fields }) },
      limit: limit + 1,
      ...(options.after === undefined ? {} : { after: options.after }),
    });
    const records = found.slice(0, limit);
    return { records, ...(found.length > limit ? { next: records.at(-1)!.id } : {}) };
  }

  async #rankAmong<T extends SchemaRecord>(read: () => Promise<T[]>, query: string, options: RankOptions): Promise<Ranked<T>> {
    const limit = options.limit ?? RANK_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`limit is how many to give back, a whole number above 0; got ${limit}`);
    if (query.trim() === "") throw new RangeError("a ranked search needs words to rank by");
    let embedder;
    try {
      embedder = await this.#ranking.embedder();
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return { by: "words", why, hits: holdingEvery(await read(), query).slice(0, limit).map((note) => ({ note })) };
    }
    const notes = await read();
    const ranked = liftByTitle(await rankByMeaning(notes.map((note) => ({ item: note, text: renderNote(note) })), query, embedder, this.#ranking.vectors), query);
    return { by: "meaning", hits: ranked.slice(0, limit).map(({ item, score }) => ({ note: item, score })) };
  }

  /**
   * Every live definition, in creation order: what a reader that looks terms up by name (the agent
   * link's prompt-time lookup, ADR-0636 D1) matches against.
   */
  async definitions(): Promise<SchemaRecord<"definition">[]> {
    return (await this.#records.list("definition")).sort(byCreation);
  }

  /**
   * The live artifacts whose links include `noteId`, in creation order. Artifacts link only to artifacts, so a
   * story or capability has none: its knowledge is reached through frontCovers.
   */
  async relatedNotes(noteId: string): Promise<Note[]> {
    return (await this.#notes()).filter((note) => note.fields.links?.includes(noteId) === true);
  }

  /**
   * The other live artifacts ranked by how alike they are to artifact `noteId`, each saying whether a
   * link already joins them, in either direction (ADR-0654; 0.2's `library related`). With
   * `unlinked`, only those no link reaches: the connections nobody has made yet. An artifact sharing
   * no distinguishing word with it is never listed. Null if `noteId` is not a live artifact.
   */
  async related(noteId: string, options: RelatedOptions = {}): Promise<Related | null> {
    const notes = await this.#notes();
    if (!notes.some((note) => note.id === noteId)) return null;
    return relatedTo(notes.map(similarityDocOf), noteId, options);
  }

  /** related() for each of `noteIds` that is a live artifact, in order, from one reading of the artifacts. */
  async relatedEach(noteIds: readonly string[], options: RelatedOptions = {}): Promise<Related[]> {
    const notes = await this.#notes();
    const live = new Set(notes.map((note) => note.id));
    return relatedEach(notes.map(similarityDocOf), noteIds.filter((id) => live.has(id)), options);
  }

  /**
   * A story's or capability's shelf (capability 9): the live decisions whose `frontCoverOf` is
   * `nodeId`, founding (oldest) first, except a superseded one. Empty for any other id.
   */
  frontCovers(nodeId: string): Promise<SchemaRecord<"decision">[]> {
    return frontCovers(this.#records, nodeId);
  }

  /**
   * Throw a SupersessionLoopError if decision `id` superseding `supersedes` would close a loop:
   * a decision may not supersede itself, directly or through others.
   */
  async #refuseSupersessionLoop(id: string, supersedes: readonly unknown[]): Promise<void> {
    const graph = new Map<string, readonly unknown[]>();
    for (const decision of await this.#records.list("decision")) graph.set(decision.id, decision.fields.supersedes ?? []);
    graph.set(id, supersedes);
    const path = loopThrough(graph, id);
    if (path !== null) throw new SupersessionLoopError(path);
  }

  /**
   * Throw a LinkLoopError if artifact `id`, holding `fields`, would close a loop through the artifacts it
   * links to (ADR-0647 D2): the knowledge is a DAG under its covers, so an artifact may not rest on
   * itself, directly or through others.
   */
  async #refuseLinkLoop(id: string, fields: object): Promise<void> {
    const graph = new Map<string, readonly unknown[]>();
    for (const note of await this.#notes()) graph.set(note.id, linksOf(note.fields));
    graph.set(id, linksOf(fields));
    const path = loopThrough(graph, id);
    if (path !== null) throw new LinkLoopError(path);
  }

  /** Every live artifact, of every supported kind, in creation order. */
  async #notes(): Promise<Note[]> {
    const lists = await Promise.all(NOTE_TYPES.map((type) => this.#records.list(type)));
    return lists.flat().sort(byCreation);
  }

  /**
   * Every reference an artifact's fields hold must name a live artifact: its links, and an agent role's
   * required reading, rules, anti-patterns and step reading, and a process's branch edges.
   */
  async #checkNoteReferences(fields: object): Promise<void> {
    const at = fields as Record<string, unknown>;
    for (const field of ["links", "context", "rules", "antiPatterns"]) {
      await checkReferences(this.#records, field, at[field], NOTE);
    }
    for (const step of listOf(at["stepRefs"])) await checkReferences(this.#records, "stepRefs", fieldOf(step, "refs"), NOTE);
    for (const edge of listOf(at["branchEdges"])) await checkReference(this.#records, "branchEdges", fieldOf(edge, "to"), NOTE);
  }

  /** An artifact may link to a live artifact, and to nothing else. */
  #checkLinks(links: unknown): Promise<void> {
    return checkReferences(this.#records, "links", links, NOTE);
  }

  /** A decision may be the front cover of a live story or capability, and of nothing else. */
  #checkFrontCover(frontCoverOf: unknown): Promise<void> {
    return checkFrontCover(this.#records, frontCoverOf);
  }
}

/**
 * The text an artifact is searched by: every piece of text in its fields, inside lists and objects
 * included, except the ones that name other artifacts. A decision is searched by its title and text,
 * a definition by its term and meaning, and friction by its
 * statement, evidence and impact among the rest.
 */
function textsOf(note: SchemaRecord): string[] {
  return textsIn(note.fields);
}

/**
 * A meaning ranking with the records the search names by their title put first, each group keeping
 * its meaning order: those whose contract number (a title's leading `7.17`) is one of its words, then
 * those whose title (a definition's term) holds every word, ignoring case. A long title's later
 * words weigh little in its meaning, so without this a search in its own words can miss it.
 */
function liftByTitle<T extends SchemaRecord>(ranked: readonly { item: T; score: number }[], query: string): { item: T; score: number }[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const tier = ({ item }: { item: T }): number => {
    const fields = item.fields as Record<string, unknown>;
    const heading = (typeof fields.title === "string" ? fields.title : typeof fields.term === "string" ? fields.term : "").toLowerCase();
    const number = /^(\d+(?:\.\d+)+)(?![\d.])/.exec(heading)?.[1];
    if (number !== undefined && words.includes(number)) return 0;
    if (heading !== "" && words.every((word) => heading.includes(word))) return 1;
    return 2;
  };
  return ranked.map((hit) => ({ hit, tier: tier(hit) })).sort((a, b) => a.tier - b.tier).map(({ hit }) => hit);
}

/** The records among `records` holding every whitespace-separated word of `query`, ignoring case, in order. */
function holdingEvery<T extends SchemaRecord>(records: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  return records.filter((record) => {
    const texts = textsOf(record).map((text) => text.toLowerCase());
    return words.every((word) => texts.some((text) => text.includes(word)));
  });
}

function textsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => (REFERENCE_FIELDS.has(key) ? [] : textsIn(item)));
  }
  return [];
}

/** An artifact as the related search ranks it: its title (a definition's term) and description apart, weighted. */
function similarityDocOf(note: Note): SimilarityDoc {
  const { title, term, description, ...rest } = note.fields as Record<string, unknown>;
  const heading = typeof title === "string" ? title : typeof term === "string" ? term : note.id;
  return {
    id: note.id,
    type: note.type,
    title: heading,
    ...(typeof description === "string" ? { description } : {}),
    body: textsIn(rest).join("\n"),
    links: linkEdgesOf(note.fields),
  };
}

/** Every link an artifact's fields hold, with the field it is in: LINK_FIELDS, and the decisions it supersedes. */
function linkEdgesOf(fields: object): { field: string; to: string }[] {
  const at = fields as Record<string, unknown>;
  const edges = (field: string, ids: unknown[]): { field: string; to: string }[] =>
    ids.filter((id): id is string => typeof id === "string").map((to) => ({ field, to }));
  return [
    ...["links", "context", "rules", "antiPatterns", "supersedes"].flatMap((field) => edges(field, listOf(at[field]))),
    ...edges("stepRefs", listOf(at["stepRefs"]).flatMap((step) => listOf(fieldOf(step, "refs")))),
    ...edges("branchEdges", listOf(at["branchEdges"]).map((edge) => fieldOf(edge, "to"))),
  ];
}

/** Every artifact id an artifact's fields link it to, through each of LINK_FIELDS. */
function linksOf(fields: object): unknown[] {
  const at = fields as Record<string, unknown>;
  return [
    ...["links", "context", "rules", "antiPatterns"].flatMap((field) => listOf(at[field])),
    ...listOf(at["stepRefs"]).flatMap((step) => listOf(fieldOf(step, "refs"))),
    ...listOf(at["branchEdges"]).map((edge) => fieldOf(edge, "to")),
  ];
}

/**
 * The first loop in `graph` from `id` back round to it, as the ids along it (`[id, …, id]`), or
 * null if there is none. Only ids that are strings are followed.
 */
function loopThrough(graph: ReadonlyMap<string, readonly unknown[]>, id: string): string[] | null {
  const path = [id];
  const seen = new Set([id]);
  const walk = (at: string): boolean => {
    for (const next of graph.get(at) ?? []) {
      if (typeof next !== "string") continue;
      path.push(next);
      if (next === id) return true;
      if (!seen.has(next)) {
        seen.add(next);
        if (walk(next)) return true;
      }
      path.pop();
    }
    return false;
  };
  return walk(id) ? path : null;
}

/** `value` when it is a list, and an empty one otherwise (the schema check refuses it inside the write). */
function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The field `key` of `value` when it is an object, and undefined otherwise. */
function fieldOf(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * A decision would supersede itself, directly or through others. The message names the loop, from
 * the decision being written back round to it: `A → B → A`.
 */
export class SupersessionLoopError extends Error {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`supersession loop: ${path.join(" → ")} (a decision may not supersede itself, directly or through others)`);
    this.name = "SupersessionLoopError";
    this.path = [...path];
  }
}

/**
 * An artifact would rest on itself, directly or through others (ADR-0647 D2). The message names the loop
 * from the artifact being written back round to it, `A → B → A`, so the chain it would close,
 * `B → A`, is plain. A loop that seems needed is a discussion with the owner first.
 */
export class LinkLoopError extends Error {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    const [from, ...rest] = path;
    const chain = rest.length > 1 ? `the existing chain ${rest.join(" → ")}` : "a link to itself";
    super(`link loop between artifacts: ${path.join(" → ")} (the link from ${from} would close ${chain}; artifacts form a DAG under their covers, so an artifact may not rest on itself, directly or through others)`);
    this.name = "LinkLoopError";
    this.path = [...path];
  }
}
