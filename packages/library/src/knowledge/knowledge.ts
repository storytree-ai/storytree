/**
 * Capability 6 · Knowledge artifacts (the library story): alongside the plan, the library keeps
 * what the project has learned: decisions, definitions and the other proper artifact kinds. An
 * artifact links to the other artifacts it relates to, and is found again by searching its words.
 *
 * Capability 9 · Knowledge entrances: every story and capability has its own shelf of front-cover
 * decisions, and a decision can be a front cover of one of them at most. Artifacts link only to other
 * artifacts, so the only way from the work into the knowledge is through a front cover. A decision
 * names the node it is a cover of in its one `frontCoverOf` field, so no decision can be the cover
 * of two, and nothing has to check for it.
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
import { createHash } from "node:crypto";

import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord, type Expected } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { FieldsOf, KnowledgeKind } from "../schema/types.js";
import { NumberTakenError, type HistoryEntry } from "../transactions/index.js";
import { defaultEmbedder } from "./bge-small.js";
import { MemoryVectors, rankByMeaning, renderNote, type EmbedderSource, type VectorStore } from "./embedding.js";
import { relatedTo, type Related, type RelatedOptions, type SimilarityDoc } from "./similarity.js";

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
/**
 * A new decision's fields. Every link must name a live artifact, `frontCoverOf` a live story or
 * capability, and each decision it supersedes a live decision. Its number is handed out when it is
 * recorded, unless it is brought in under its own (N1); its composed statement is composeStatement's.
 */
export type NewDecision = Omit<FieldsOf<"decision">, "composed">;
/** A decision's status as a read works it out: its own, or superseded once an accepted decision names it. */
export type DecisionStatus = FieldsOf<"decision">["status"] | "superseded";
/** A decision as the decision log reads it (capability 13). */
export interface DecisionView {
  /** The decision, its full text included, whatever its status. */
  readonly record: SchemaRecord<"decision">;
  readonly status: DecisionStatus;
  /** The accepted decisions that name it in `supersedes`, oldest first. */
  readonly supersededBy: string[];
  /** Its composed statement, marked stale once its text has changed since; absent until one is composed. */
  readonly composed?: { readonly statement: string; readonly composedAt: string; readonly stale: boolean };
}
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
const NOTE: Expected = {
  name: "artifact",
  types: NOTE_TYPES,
  why: "artifacts link only to other artifacts: a story or capability is reached through its front covers, the decisions whose frontCoverOf names it",
};

/** What a decision may be the front cover of (capability 9). */
const COVERABLE: Expected = { name: "story or capability", types: ["story", "capability"] };

/** A read-only proposal from a decision's own Full record line; refusals are never hidden. */
export interface DecisionNumberPlan {
  readonly id: string;
  readonly oldNumber: number | undefined;
  readonly number: number | undefined;
  readonly refusal?: string;
}

const NUMBER_FLOOR_ID = "project-decision-number-floor";

type NumberingMove = "full-record" | "founding-books";

export class Knowledge {
  readonly #records: SchemaRecords;
  readonly #project: string | undefined;
  readonly #ranking: Ranking;

  constructor(records: SchemaRecords, project?: string, ranking: Partial<Ranking> = {}) {
    this.#records = records;
    this.#project = project;
    this.#ranking = { embedder: ranking.embedder ?? SHARED_EMBEDDER, vectors: ranking.vectors ?? new MemoryVectors() };
  }

  /**
   * Record a decision. Its links are checked against live artifacts, its `frontCoverOf`, if it
   * has one, must name a live story or capability, and each decision it supersedes must be live.
   * It is numbered inside the write: one past the highest number any decision has ever held, so
   * writers at the same time never share one and a retired decision's is never reused. A decision
   * brought in with its own number keeps it, unless another has held it (NumberTakenError).
   * Storytree auto-numbers only after its one-time floor is set (ADR-0662).
   */
  async recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    const own = this.#project === "storytree";
    const floor = own && decision.number === undefined ? this.#numberFloor(await this.#records.history({ id: NUMBER_FLOOR_ID })).floor : undefined;
    await this.#checkLinks(decision.links);
    await this.#checkFrontCover(decision.frontCoverOf);
    await checkReferences(this.#records, "supersedes", decision.supersedes, "decision");
    return this.#records.create("decision", decision, {
      ...options, sequence: "number",
      ...(floor === undefined ? {} : { sequenceFloor: floor }),
      ...(own ? { sequenceNeverHeld: true } : {}),
    });
  }

  /** Preview the explicit ADR-0662 switch; only apply stores it, once, under the project lock. */
  async setDecisionNumberFloor(floor: number, options: WriteOptions & { readonly apply?: boolean } = {}): Promise<number> {
    this.#requireStorytree();
    if (!Number.isSafeInteger(floor) || floor < 1) throw new RangeError("decision number floor must be a positive safe integer");
    const history = await this.#records.history({ id: NUMBER_FLOOR_ID });
    if (history.length > 0) throw new RangeError(`decision number floor is already set to ${this.#numberFloor(history).floor}; it cannot be lowered or set twice`);
    if (options.apply === true) {
      await this.#records.create("decisionNumbering", { floor }, { ...options, id: NUMBER_FLOOR_ID, onlyIfNew: true });
    }
    return floor;
  }

  #numberFloor(history: HistoryEntry[]): { floor: number; seq: number } {
    const entry = history.find((entry) => entry.recordId === NUMBER_FLOOR_ID);
    const floor = entry?.record.fields.floor;
    if (entry === undefined || typeof floor !== "number" || !Number.isSafeInteger(floor) || floor < 1) {
      throw new RangeError("decision number floor is unset; storytree requires its persisted numbering floor before automatic numbering");
    }
    return { floor, seq: entry.seq };
  }

  /**
   * Repair an imported storytree decision once. The record stays live and keeps its identity,
   * fields and old number in history. The sequence check runs under the same lock as new decisions.
   */
  async numberDecision(id: string, number: number, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    return this.#numberDecision(id, number, "full-record", options);
  }

  async #numberDecision(id: string, number: number, move: NumberingMove, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    this.#requireStorytree();
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) throw new RangeError(`${id} is not a live decision`);
    this.#checkNumber(record, number, await this.#records.history(), move);
    const updated = await this.#records.edit(id, { number }, {
      ...options,
      sequence: "number",
      sequenceNeverHeld: true,
      checkCurrent: (current) => {
        if (current.type !== "decision" || current.fields.number !== record.fields.number || current.fields.text !== record.fields.text) {
          throw new RangeError(`${id} changed or was already numbered; read it again before numbering`);
        }
      },
    });
    if (updated === null) throw new RangeError(`${id} is not a live decision`);
    return updated as SchemaRecord<"decision">;
  }

  /** Propose every Full record repair without writing. No Full record line means no proposal. */
  async decisionNumberPlan(): Promise<DecisionNumberPlan[]> {
    this.#requireStorytree();
    const records = await this.#records.list("decision");
    const history = await this.#records.history();
    const rows = records.filter((record) => {
      const target = fullRecordNumber(record.fields.text);
      return fullRecordLines(record.fields.text).length > 0 && (target === undefined || target !== record.fields.number);
    }).map((record) => {
      const number = fullRecordNumber(record.fields.text);
      try {
        this.#checkNumber(record, number, history);
        return { id: record.id, oldNumber: record.fields.number, number };
      } catch (error) {
        if (!(error instanceof RangeError || error instanceof NumberTakenError)) throw error;
        return { id: record.id, oldNumber: record.fields.number, number, refusal: error.message };
      }
    });
    return rows.map((row) => row.refusal === undefined && rows.some((other) => other.id !== row.id && other.number === row.number)
      ? { ...row, refusal: "another decision proposes the same Full record number" }
      : row);
  }

  /**
   * The one-time N1 move, previewed unless apply is explicit. Every write rechecks the live
   * decision and history. Refused rows stay in the result; independent repairs can still succeed.
   * No Full record line, or a number already matching it, means no proposal and no write.
   */
  async numberDecisionsFromFullRecord(options: WriteOptions & { readonly apply?: boolean } = {}): Promise<DecisionNumberPlan[]> {
    return this.#applyNumberPlan(await this.decisionNumberPlan(), "full-record", options);
  }

  async #applyNumberPlan(plan: DecisionNumberPlan[], move: NumberingMove, options: WriteOptions & { readonly apply?: boolean }): Promise<DecisionNumberPlan[]> {
    if (options.apply !== true) return plan;
    const result: DecisionNumberPlan[] = [];
    for (const row of plan) {
      if (row.refusal !== undefined || row.number === undefined) {
        result.push(row);
        continue;
      }
      try {
        await this.#numberDecision(row.id, row.number, move, options);
        result.push(row);
      } catch (error) {
        if (!(error instanceof RangeError || error instanceof NumberTakenError)) throw error;
        result.push({ ...row, refusal: error.message });
      }
    }
    return result;
  }

  /**
   * ADR-0662's one-time move: live decisions present at switch-on, with no Full record line.
   * Creation history orders them even when timestamps tie. Decisions created after switch-on
   * already use the new sequence; completed moves are omitted so retries can finish a partial run.
   */
  async numberFoundingDecisions(options: WriteOptions & { readonly apply?: boolean } = {}): Promise<DecisionNumberPlan[]> {
    this.#requireStorytree();
    const records = await this.#records.list("decision");
    const history = await this.#records.history();
    const { floor, seq } = this.#numberFloor(history);
    const originals = new Map<string, HistoryEntry>();
    for (const entry of history) {
      if (entry.type === "decision" && entry.seq < seq && !originals.has(entry.recordId)) originals.set(entry.recordId, entry);
    }
    let highest = history.reduce((max, entry) => typeof entry.record.fields.number === "number" ? Math.max(max, entry.record.fields.number) : max, floor);
    const plan = records.filter((record) => originals.has(record.id) && fullRecordLines(record.fields.text).length === 0 && !this.#foundingMoved(record.id, history, seq))
      .sort((a, b) => originals.get(a.id)!.seq - originals.get(b.id)!.seq)
      .map((record): DecisionNumberPlan => {
        const number = ++highest;
        try {
          this.#checkNumber(record, number, history, "founding-books");
          return { id: record.id, oldNumber: record.fields.number, number };
        } catch (error) {
          if (!(error instanceof RangeError || error instanceof NumberTakenError)) throw error;
          return { id: record.id, oldNumber: record.fields.number, number, refusal: error.message };
        }
      });
    return this.#applyNumberPlan(plan, "founding-books", options);
  }

  #foundingMoved(id: string, history: HistoryEntry[], floorSeq: number): boolean {
    const entries = history.filter((entry) => entry.recordId === id);
    return entries.some((entry, index) => entry.seq > floorSeq && index > 0 && entry.record.fields.number !== entries[index - 1]!.record.fields.number);
  }

  #requireStorytree(): void {
    if (this.#project !== "storytree") throw new RangeError("decision numbering moves are only available in the storytree project");
  }

  #checkNumber(record: SchemaRecord<"decision">, number: number | undefined, history: HistoryEntry[], move: NumberingMove = "full-record"): void {
    if (move === "full-record") {
      if (number === undefined || !Number.isSafeInteger(number) || number < 1 || fullRecordNumber(record.fields.text) !== number) {
        throw new RangeError(`${record.id}: number must match its own single Full record: ADR-NNNN line`);
      }
      if (record.fields.number === number || history.some((entry) => entry.recordId === record.id && entry.record.fields.number !== record.fields.number)) {
        throw new RangeError(`${record.id} has already been numbered; the Full record repair is one-time`);
      }
    } else {
      const { floor, seq } = this.#numberFloor(history);
      if (fullRecordLines(record.fields.text).length > 0 || !history.some((entry) => entry.recordId === record.id && entry.seq < seq)) {
        throw new RangeError(`${record.id}: founding-books move requires a decision present at switch-on with no Full record line`);
      }
      if (this.#foundingMoved(record.id, history, seq)) throw new RangeError(`${record.id} has already been numbered; the founding-books move is one-time`);
      if (number === undefined || !Number.isSafeInteger(number) || number <= floor) {
        throw new RangeError(`${record.id}: founding-books number must be a safe integer above the floor ${floor}`);
      }
    }
    if (history.some((entry) => entry.record.fields.number === number)) {
      throw new NumberTakenError("decision", "number", number!);
    }
  }

  /**
   * A decision as the decision log reads it: its record, full text included; its status, which is
   * superseded exactly when an accepted decision names it in `supersedes`; those decisions; and its
   * composed statement, stale once its text has changed since it was composed. Null if `id` is not
   * a live decision.
   */
  async decision(id: string): Promise<DecisionView | null> {
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) return null;
    return decisionView(record, await this.#records.list("decision"));
  }

  /**
   * Every live decision as decision() reads it, oldest first, from one reading of the decisions
   * (13.9): what the decision log's listing asks, in place of a decision() per id, each of which
   * reads every decision again.
   */
  async decisions(): Promise<DecisionView[]> {
    const all = await this.#records.list("decision");
    return [...all].sort(byCreation).map((record) => decisionView(record, all));
  }

  /**
   * Compose a decision's one statement (C2): a maintained paragraph beside its text, never in its
   * place, replacing any statement before it. It remembers the text it was composed against. Null,
   * with nothing written, if `id` is not a live decision.
   */
  async composeStatement(id: string, statement: string, options?: WriteOptions): Promise<SchemaRecord<"decision"> | null> {
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) return null;
    const composed = { statement, composedAt: new Date().toISOString(), fingerprint: fingerprintOf(record.fields.text) };
    return (await this.#records.edit(id, { composed }, options)) as SchemaRecord<"decision"> | null;
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
    const ranked = await rankByMeaning(notes.map((note) => ({ item: note, text: renderNote(note) })), query, embedder, this.#ranking.vectors);
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

  /**
   * A story's or capability's shelf (capability 9): the live decisions whose `frontCoverOf` is
   * `nodeId`, founding (oldest) first, except a superseded one, which leaves its shelf for its
   * successor (13-b) and is still read with decision(). Empty for any other id.
   */
  async frontCovers(nodeId: string): Promise<SchemaRecord<"decision">[]> {
    const decisions = await this.#records.list("decision");
    const superseded = new Set(decisions.filter((decision) => decision.fields.status === "accepted").flatMap((decision) => decision.fields.supersedes ?? []));
    return decisions.filter((decision) => decision.fields.frontCoverOf === nodeId && !superseded.has(decision.id)).sort(byCreation);
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
    return checkReference(this.#records, "frontCoverOf", frontCoverOf, COVERABLE);
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

/** A fingerprint of a decision's text: what a composed statement remembers, to tell when it changed. */
function fingerprintOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Only an explicit line in the decision itself authorizes the repair, never an incidental mention. */
function fullRecordLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => /^[ \t]*Full record:/.test(line));
}

function fullRecordNumber(text: string): number | undefined {
  const lines = fullRecordLines(text);
  if (lines.length !== 1) return undefined;
  const digits = /^[ \t]*Full record:[ \t]+ADR-(\d{4,})(?=[ \t.,;]|$)/.exec(lines[0]!)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/** `record` as the decision log reads it, superseded by the accepted decisions among `all` that name it. */
function decisionView(record: SchemaRecord<"decision">, all: readonly SchemaRecord<"decision">[]): DecisionView {
  const supersededBy = all
    .filter((other) => other.fields.status === "accepted" && other.fields.supersedes?.includes(record.id) === true)
    .sort(byCreation)
    .map((other) => other.id);
  const composed = record.fields.composed;
  return {
    record,
    status: supersededBy.length > 0 ? "superseded" : record.fields.status,
    supersededBy,
    ...(composed === undefined
      ? {}
      : {
          composed: {
            statement: composed.statement,
            composedAt: composed.composedAt,
            stale: composed.fingerprint !== fingerprintOf(record.fields.text),
          },
        }),
  };
}
