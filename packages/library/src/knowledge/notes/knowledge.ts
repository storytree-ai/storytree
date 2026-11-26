// Capability 6 · Notes
import { byCreation, checkReference, checkReferences, type Expected, type FieldsOf, liveRecord, SchemaError, type SchemaRecord, type SchemaRecords, unstorable, type WriteOptions } from "../../records/index.js";
import { judgedState, type KnowledgeKind } from "../../schema/index.js";
import { defaultEmbedder } from "../search/embedding-model.js";
import { ARTIFACT_KINDS } from "./kinds.js";
import { addedEdges, checkClauseSupersession, checkFrontCover, DecisionLog, justifiedEdit, partlySupersedes, prunedEdit, restoredEdit, type ArchivedDecisionLink, type DecisionLinkBacklog, type DecisionLinkChanges, type DecisionLinkSpan, type DecisionNumberPlan, type DecisionView, type NarrowsMove, type NewDecision, type SupersessionPairs } from "../../decisions/index.js";
import { MemoryVectors, rankByMeaning, renderNote, type EmbedderSource, type VectorStore } from "../search/embedding.js";
import { artifactsOnly, frontCovers } from "./front-covers.js";
import { relatedEach, relatedTo, type Related, type RelatedOptions, type SimilarityDoc } from "./similarity.js";
import { holdsName, normalisedWords } from "../search/whole-words.js";

export const REFERENCE_FIELD_NAMES = ["links", "context", "rules", "antiPatterns", "enforces", "supersedes", "supersedesClauses", "narrows", "stepRefs", "branchEdges"] as const;

const SUPERSESSION_FIELDS: readonly string[] = ["supersedes", "supersedesClauses", "narrows"];

const LINK_FIELDS = REFERENCE_FIELD_NAMES.filter((field) => !SUPERSESSION_FIELDS.includes(field));

export type NoteType = "decision" | "definition" | KnowledgeKind;
export type NewKnowledge<K extends KnowledgeKind = KnowledgeKind> = K extends "friction" ? Omit<FieldsOf<K>, "state"> : FieldsOf<K>;
export type Note = SchemaRecord<NoteType>;
export interface Ranking {
  readonly embedder: EmbedderSource;
  readonly vectors: VectorStore;
}
export const RANK_LIMIT = 10;
export type PlanKind = "story" | "capability" | "contract" | "arc" | "increment";
export type Findable = Note | SchemaRecord<PlanKind>;
export interface Ranked<T extends SchemaRecord = Note> {
  readonly by: "meaning" | "words";
  readonly why?: string;
  readonly hits: { readonly note: T; readonly score?: number; readonly narrowedBy?: readonly NarrowingDecision[] }[];
}
export interface NarrowingDecision {
  readonly id: string;
  readonly number?: number;
  readonly clauses?: readonly string[];
}
export interface RankOptions {
  readonly limit?: number;
  readonly history?: boolean;
  readonly kinds?: readonly (NoteType | PlanKind)[];
}
export type PhraseKind = NoteType | PlanKind | "question";
export interface PhraseOptions {
  readonly kinds?: readonly PhraseKind[];
  readonly fields?: readonly string[];
  readonly limit?: number;
  readonly after?: string;
}
export interface PhrasePage {
  readonly records: SchemaRecord<PhraseKind>[];
  readonly next?: string;
}
const SHARED_EMBEDDER = defaultEmbedder();

export type NewDefinition = FieldsOf<"definition">;
type EditOptions = WriteOptions & { readonly checkCurrent?: (note: Note) => void };

function movedEdges(stored: object, edit: NoteEdit): NoteEdit {
  return addedEdges(stored as Partial<FieldsOf<"decision">>, edit as Partial<FieldsOf<"decision">>) as NoteEdit;
}

export type NoteEdit = {
  [K in NoteType]: { [F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined };
}[NoteType];

export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = Object.keys(ARTIFACT_KINDS) as KnowledgeKind[];

const NOTE_TYPES: readonly NoteType[] = ["decision", "definition", ...KNOWLEDGE_KINDS];
const PLAN_KINDS: readonly PlanKind[] = ["story", "capability", "contract", "arc", "increment"];
const FINDABLE_KINDS: readonly (NoteType | PlanKind)[] = [...NOTE_TYPES, ...PLAN_KINDS];
const HISTORY_KINDS: readonly string[] = ["resteer", "friction"];
const PHRASE_KINDS: readonly PhraseKind[] = [...NOTE_TYPES, ...PLAN_KINDS, "question"];

const REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  "links",
  "frontCoverOf",
  "context",
  "rules",
  "antiPatterns",
  "enforces",
  "refs",
  "to",
  "supersedes",
  "supersedesClauses",
  "narrows",
  "justifications",
  "archivedLinks",
  "fingerprint",
  "story",
  "capability",
  "dependsOn",
]);

const OWN_VERBS: Readonly<Record<string, string>> = {
  number: "a decision keeps its assigned number",
  composed: "a composed statement is written with composeStatement",
};

const UNNAMED_STATE = "a friction report's state is never named: filing makes it open, and routing, a recurrence or closing the increment that remedies it moves it (ADR-1016 D2)";

type FrictionEdit = { [F in keyof FieldsOf<"friction">]?: FieldsOf<"friction">[F] | undefined };

function frictionMove(before: FieldsOf<"friction">, edit: FrictionEdit): FrictionEdit {
  const after = { ...before, ...edit };
  const recurred = (after.reinforcedBy?.length ?? 0) > (before.reinforcedBy?.length ?? 0);
  if (recurred && (before.state === "resolved" || before.state === "dismissed")) {
    return { ...edit, state: "open", route: undefined, routeReason: undefined, dischargedBy: undefined };
  }
  if (!("route" in edit) && !("dischargedBy" in edit)) return edit;
  return { ...edit, state: after.route === undefined ? "open" : judgedState(after.route, after.dischargedBy) };
}

export type RemedyClose =
  | { readonly landed: true; readonly stamp: string }
  | { readonly landed: false; readonly undoing?: string | undefined; readonly remediedElsewhere: boolean };

function refuseFrozenEdit(note: Note, change: object): void {
  if (note.type !== "experiment") return;
  const frozen = (note.fields as FieldsOf<"experiment">).frozen;
  if (frozen === undefined) return;
  const changed = Object.keys(change).filter((field) => field !== "outcome");
  if (changed.length > 0) {
    throw new RangeError(`experiment ${note.id} was frozen at ${frozen}: only its outcome may be added, not ${changed.map((field) => JSON.stringify(field)).join(", ")}`);
  }
}

const MEASURE_READING = ["reads", "howRead", "unit", "better", "machine", "runs", "base", "story"] as const;

function refuseUnversionedEdit(note: Note, change: object): void {
  if (note.type !== "measure") return;
  const before = note.fields as FieldsOf<"measure">;
  const edit = change as Partial<Record<keyof FieldsOf<"measure">, unknown>>;
  const version = "version" in edit ? edit.version : before.version;
  const raised = typeof version === "number" && version > before.version;
  if (typeof version === "number" && version < before.version) {
    throw new SchemaError("measure", [{ field: "version", problem: `measure ${note.id} is at version ${before.version}: its version never falls, not to ${version}` }]);
  }
  const changed = MEASURE_READING.filter((field) => field in edit && edit[field] !== before[field]);
  if (changed.length > 0 && !raised) {
    throw new SchemaError("measure", [{ field: "version", problem: `changing what measure ${note.id} reads (${changed.map((field) => JSON.stringify(field)).join(", ")}) raises its version above ${before.version}` }]);
  }
}

const NOTE: Expected = artifactsOnly(NOTE_TYPES);
const ENFORCEABLE: Expected = { name: "principle or guardrail", types: ["principle", "guardrail"], why: "a check enforces the principle or guardrail note that carries its rule's reason" };
const REPLANTABLE: Expected = { name: "escape pattern", types: ["escape"], why: "a drill replants a harvested escape pattern" };
const MEASURED: Expected = { name: "story", types: ["story"], why: "a measure is of the story whose package reads it" };

export class Knowledge {
  readonly #records: SchemaRecords;
  readonly #ranking: Ranking;
  readonly #log: DecisionLog;

  constructor(records: SchemaRecords, project?: string, ranking: Partial<Ranking> = {}) {
    this.#records = records;
    this.#log = new DecisionLog(records, project, NOTE);
    this.#ranking = { embedder: ranking.embedder ?? SHARED_EMBEDDER, vectors: ranking.vectors ?? new MemoryVectors() };
  }

  recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    return this.#log.recordDecision(decision, options);
  }

  setDecisionNumberFloor(floor: number, options: WriteOptions & { readonly apply?: boolean } = {}): Promise<number> {
    return this.#log.setDecisionNumberFloor(floor, options);
  }

  numberDecision(id: string, number: number, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    return this.#log.numberDecision(id, number, options);
  }

  decisionNumberPlan(): Promise<DecisionNumberPlan[]> {
    return this.#log.decisionNumberPlan();
  }

  numberDecisionsFromFullRecord(options: WriteOptions & { readonly apply?: boolean } = {}): Promise<DecisionNumberPlan[]> {
    return this.#log.numberDecisionsFromFullRecord(options);
  }

  numberFoundingDecisions(options: WriteOptions & { readonly apply?: boolean } = {}): Promise<DecisionNumberPlan[]> {
    return this.#log.numberFoundingDecisions(options);
  }

  decision(id: string): Promise<DecisionView | null> {
    return this.#log.decision(id);
  }

  decisions(): Promise<DecisionView[]> {
    return this.#log.decisions();
  }

  composeStatement(id: string, statement: string, options?: WriteOptions): Promise<SchemaRecord<"decision"> | null> {
    return this.#log.composeStatement(id, statement, options);
  }

  moveNarrowsToClauses(options?: WriteOptions): Promise<NarrowsMove> {
    return this.#log.moveNarrowsToClauses(options);
  }

  supersessionPairs(): Promise<SupersessionPairs> {
    return this.#log.supersessionPairs();
  }

  decisionLinkBacklog(): Promise<DecisionLinkBacklog> {
    return this.#log.decisionLinkBacklog();
  }

  decisionLinkChanges(span?: DecisionLinkSpan): Promise<DecisionLinkChanges> {
    return this.#log.decisionLinkChanges(span);
  }

  archivedLinks(from?: string): Promise<ArchivedDecisionLink[]> {
    return this.#log.archivedLinks(from);
  }

  async pruneLink(from: string, to: string, reason: string, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    const decision = await this.#liveDecision(from);
    return (await this.#editNote(from, prunedEdit(decision, to, reason, options?.actor ?? "unknown"), options, movedEdges)) as SchemaRecord<"decision">;
  }

  async restoreLink(from: string, to: string, justification?: string, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    const decision = await this.#liveDecision(from);
    return (await this.#editNote(from, restoredEdit(decision, to, justification), options, movedEdges)) as SchemaRecord<"decision">;
  }

  async #liveDecision(id: string): Promise<SchemaRecord<"decision">> {
    const decision = await liveRecord(this.#records, id, ["decision"]);
    if (decision === null) throw new RangeError(`${id} is not a live decision`);
    return decision;
  }

  async writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K>> {
    if (!KNOWLEDGE_KINDS.includes(kind)) {
      throw new RangeError(`writeKnowledge writes ${KNOWLEDGE_KINDS.join(", ")}, not ${JSON.stringify(kind)}`);
    }
    await this.#checkNoteReferences(fields);
    if (kind === "friction") {
      if ("state" in fields) throw new RangeError(UNNAMED_STATE);
      return this.#records.create(kind, { ...fields, state: "open" } as FieldsOf<K>, options);
    }
    const written = await this.#records.create(kind, fields as FieldsOf<K>, options);
    if (kind === "research") await this.#offerResearch(written as SchemaRecord<"research">, options);
    if (kind === "experiment" && (written as SchemaRecord<"experiment">).fields.frozen !== undefined) await this.#offerFrozenPlan(written as SchemaRecord<"experiment">, options);
    return written;
  }

  async #offerResearch({ id, fields }: SchemaRecord<"research">, options?: WriteOptions): Promise<void> {
    const fyi = { title: `Research report: ${fields.title}`, what: fields.description, about: id, by: options?.actor ?? "storytree", at: new Date().toISOString() };
    await this.#records.create("fyi", fyi, options);
  }

  async #offerFrozenPlan({ id, fields }: SchemaRecord<"experiment">, options?: WriteOptions): Promise<void> {
    const fyi = { title: `Plan frozen: ${fields.title} (no results yet)`, what: fields.description, about: id, by: options?.actor ?? "storytree", at: new Date().toISOString() };
    await this.#records.create("fyi", fyi, options);
  }

  async defineTerm(definition: NewDefinition, options?: WriteOptions): Promise<SchemaRecord<"definition">> {
    await this.#checkLinks(definition.links);
    return this.#records.create("definition", definition, options);
  }

  async refile<K extends KnowledgeKind>(id: string, kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K> | null> {
    if (!KNOWLEDGE_KINDS.includes(kind) || kind === "friction" || kind === "resteer") {
      throw new RangeError(`refile writes ${KNOWLEDGE_KINDS.filter((one) => one !== "friction" && one !== "resteer").join(", ")}, not ${JSON.stringify(kind)}`);
    }
    const note = await liveRecord(this.#records, id, NOTE_TYPES);
    if (note === null) return null;
    refuseFrozenEdit(note as Note, { type: kind });
    await this.#checkNoteReferences(fields);
    await this.#refuseLinkLoop(id, fields);
    const refiled = await this.#records.create(kind, fields as FieldsOf<K>, { ...options, id });
    if (kind === "research" && note.type !== "research") await this.#offerResearch(refiled as SchemaRecord<"research">, options);
    return refiled;
  }

  async editNote(id: string, fields: NoteEdit, options?: EditOptions): Promise<Note | null> {
    const edited = await this.#editNote(id, fields, options, (_stored, edit) => edit);
    if (edited?.type === "experiment" && "frozen" in fields && fields.frozen !== undefined) await this.#offerFrozenPlan(edited as SchemaRecord<"experiment">, options);
    return edited;
  }

  async #editNote(id: string, fields: NoteEdit, options: EditOptions | undefined, checked: (stored: object, edit: NoteEdit) => NoteEdit): Promise<Note | null> {
    const own = Object.keys(fields).find((field) => Object.hasOwn(OWN_VERBS, field));
    if (own !== undefined) throw new RangeError(`editNote does not change ${JSON.stringify(own)}: ${OWN_VERBS[own]}`);
    const note = await liveRecord(this.#records, id, NOTE_TYPES);
    if (note === null) return null;
    if (note.type === "friction") {
      if ("state" in fields) throw new RangeError(UNNAMED_STATE);
      fields = frictionMove(note.fields, fields as FrictionEdit);
    }
    const references = checked(note.fields, fields);
    await this.#checkNoteReferences(references);
    if (LINK_FIELDS.some((field) => field in fields)) await this.#refuseLinkLoop(id, { ...note.fields, ...fields });
    if ("frontCoverOf" in fields) await this.#checkFrontCover(fields.frontCoverOf);
    if ("supersedes" in fields) {
      await checkReferences(this.#records, "supersedes", (references as Partial<FieldsOf<"decision">>).supersedes, "decision");
      if (Array.isArray(fields.supersedes)) await this.#refuseSupersessionLoop(id, fields.supersedes);
    }
    await checkClauseSupersession(this.#records, references);
    if (note.type === "decision") fields = await justifiedEdit(this.#records, id, note.fields, fields);
    const { checkCurrent, ...writer } = options ?? {};
    return (await this.#records.edit(id, fields, {
      ...writer,
      checkCurrent: (current) => {
        refuseFrozenEdit(current as Note, fields);
        refuseUnversionedEdit(current as Note, fields);
        checkCurrent?.(current as Note);
      },
    })) as Note | null;
  }

  async settleRemedy(id: string, close: RemedyClose, options?: WriteOptions): Promise<SchemaRecord<"friction"> | null> {
    const report = await liveRecord(this.#records, id, ["friction"]);
    if (report === null) return null;
    const { state, route, dischargedBy } = report.fields as FieldsOf<"friction">;
    if (close.landed) {
      if (state === "resolved") return null;
      return (await this.#records.edit(id, { state: "resolved", dischargedBy: close.stamp }, options)) as SchemaRecord<"friction"> | null;
    }
    const owed = close.undoing === undefined ? state === "routed" : state === "resolved" && dischargedBy === close.undoing;
    if (!owed) return null;
    const reopen = close.remediedElsewhere && route !== undefined
      ? { state: "routed" as const, dischargedBy: undefined }
      : { state: "open" as const, route: undefined, routeReason: undefined, dischargedBy: undefined };
    return (await this.#records.edit(id, reopen, options)) as SchemaRecord<"friction"> | null;
  }

  async search(query: string): Promise<Note[]> {
    return holdingEvery(await this.#notes(), query);
  }

  async searchEach(queries: readonly string[]): Promise<Note[][]> {
    const notes = await this.#notes();
    return queries.map((query) => holdingEvery(notes, query));
  }

  async rank(query: string, options: RankOptions = {}): Promise<Ranked> {
    return this.#rankAmong(() => this.#notes(), query, options);
  }

  async rankAll(query: string, options: RankOptions = {}): Promise<Ranked<Findable>> {
    const { kinds, history = false } = options;
    for (const kind of kinds ?? []) if (!FINDABLE_KINDS.includes(kind)) throw new RangeError(`unknown kind to search: ${kind}; one of ${FINDABLE_KINDS.join(", ")}`);
    const narrowedBy = new Map<string, NarrowingDecision[]>();
    const closed = new Set<string>();
    const ranked = await this.#rankAmong(async () => {
      const [notes, questions, ...plan] = await Promise.all([this.#notes(), this.#records.list("question"), ...PLAN_KINDS.map((type) => this.#records.list(type))]);
      const all: Findable[] = [...notes, ...plan.flat()].sort(byCreation);
      for (const id of closedWork(all, questions)) closed.add(id);
      const accepted = all.filter((record): record is SchemaRecord<"decision"> => record.type === "decision" && record.fields.status === "accepted");
      const superseded = new Set(accepted.flatMap((decision) => decision.fields.supersedes ?? []));
      for (const decision of accepted) {
        for (const { decision: target, clauses } of partlySupersedes(decision.fields)) {
          narrowedBy.set(target, [...(narrowedBy.get(target) ?? []), { id: decision.id, ...(decision.fields.number === undefined ? {} : { number: decision.fields.number }), ...(clauses === undefined ? {} : { clauses }) }]);
        }
      }
      return all.filter((record) => {
        if (kinds !== undefined && !kinds.includes(record.type)) return false;
        if (history) return true;
        if (HISTORY_KINDS.includes(record.type)) return kinds !== undefined;
        return !superseded.has(record.id);
      });
    }, query, options, (record) => closed.has(record.id));
    return { ...ranked, hits: ranked.hits.map((hit) => (narrowedBy.has(hit.note.id) ? { ...hit, narrowedBy: narrowedBy.get(hit.note.id)! } : hit)) };
  }

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

  async #rankAmong<T extends SchemaRecord>(read: () => Promise<T[]>, query: string, options: RankOptions, isClosed: (record: T) => boolean = () => false): Promise<Ranked<T>> {
    const limit = options.limit ?? RANK_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`limit is how many to give back, a whole number above 0; got ${limit}`);
    if (query.trim() === "") throw new RangeError("a ranked search needs words to rank by");
    let embedder;
    try {
      embedder = await this.#ranking.embedder();
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return { by: "words", why, hits: openFirst(holdingEvery(await read(), query), isClosed).slice(0, limit).map((note) => ({ note })) };
    }
    const notes = await read();
    const lifted = liftByTitle(await rankByMeaning(notes.map((note) => ({ item: note, text: renderNote(note) })), query, embedder, this.#ranking.vectors), query);
    const ranked = openFirst(lifted, ({ item }) => isClosed(item));
    return { by: "meaning", hits: ranked.slice(0, limit).map(({ item, score }) => ({ note: item, score })) };
  }

  async measures(story?: string): Promise<SchemaRecord<"measure">[]> {
    const measures = (await this.#records.list("measure")).sort(byCreation);
    return story === undefined ? measures : measures.filter(({ fields }) => fields.story === story);
  }

  async definitions(): Promise<SchemaRecord<"definition">[]> {
    return (await this.#records.list("definition")).sort(byCreation);
  }

  async relatedNotes(noteId: string): Promise<Note[]> {
    return (await this.#notes()).filter((note) => note.fields.links?.includes(noteId) === true);
  }

  async related(noteId: string, options: RelatedOptions = {}): Promise<Related | null> {
    const notes = await this.#notes();
    if (!notes.some((note) => note.id === noteId)) return null;
    return relatedTo(notes.map(similarityDocOf), noteId, options);
  }

  async relatedEach(noteIds: readonly string[], options: RelatedOptions = {}): Promise<Related[]> {
    const notes = await this.#notes();
    const live = new Set(notes.map((note) => note.id));
    return relatedEach(notes.map(similarityDocOf), noteIds.filter((id) => live.has(id)), options);
  }

  frontCovers(nodeId: string): Promise<SchemaRecord<"decision">[]> {
    return frontCovers(this.#records, nodeId);
  }

  async #refuseSupersessionLoop(id: string, supersedes: readonly unknown[]): Promise<void> {
    const graph = new Map<string, readonly unknown[]>();
    for (const decision of await this.#records.list("decision")) graph.set(decision.id, decision.fields.supersedes ?? []);
    graph.set(id, supersedes);
    const path = loopThrough(graph, id);
    if (path !== null) throw new SupersessionLoopError(path);
  }

  async #refuseLinkLoop(id: string, fields: object): Promise<void> {
    const graph = new Map<string, readonly unknown[]>();
    for (const note of await this.#notes()) graph.set(note.id, linksOf(note.fields));
    graph.set(id, linksOf(fields));
    const path = loopThrough(graph, id);
    if (path !== null) throw new LinkLoopError(path);
  }

  async #notes(): Promise<Note[]> {
    const lists = await Promise.all(NOTE_TYPES.map((type) => this.#records.list(type)));
    return lists.flat().sort(byCreation);
  }

  async #checkNoteReferences(fields: object): Promise<void> {
    const at = fields as Record<string, unknown>;
    for (const field of ["links", "context", "rules", "antiPatterns"]) {
      await checkReferences(this.#records, field, at[field], NOTE);
    }
    for (const step of listOf(at["stepRefs"])) await checkReferences(this.#records, "stepRefs", fieldOf(step, "refs"), NOTE);
    for (const edge of listOf(at["branchEdges"])) await checkReference(this.#records, "branchEdges", fieldOf(edge, "to"), NOTE);
    await checkReferences(this.#records, "enforces", at["enforces"], ENFORCEABLE);
    await checkReference(this.#records, "pattern", at["pattern"], REPLANTABLE);
    await checkReference(this.#records, "story", at["story"], MEASURED);
  }

  #checkLinks(links: unknown): Promise<void> {
    return checkReferences(this.#records, "links", links, NOTE);
  }

  #checkFrontCover(frontCoverOf: unknown): Promise<void> {
    return checkFrontCover(this.#records, frontCoverOf);
  }
}

function textsOf(note: SchemaRecord): string[] {
  return textsIn(note.fields);
}

function openFirst<T>(ranked: readonly T[], isClosed: (item: T) => boolean): T[] {
  return [...ranked.filter((item) => !isClosed(item)), ...ranked.filter(isClosed)];
}

function closedWork(records: readonly Findable[], questions: readonly SchemaRecord<"question">[]): string[] {
  const increments = records.filter((record): record is SchemaRecord<"increment"> => record.type === "increment");
  const asking = new Set(questions.filter(({ fields }) => fields.lifecycle === "open").map(({ fields }) => fields.arc));
  const closedArcs = records.filter(({ id, type }) => {
    if (type !== "arc" || asking.has(id)) return false;
    const own = increments.filter(({ fields }) => fields.arc === id);
    return own.length > 0 && own.every(({ fields }) => fields.status === "closed");
  });
  return [...increments.filter(({ fields }) => fields.status === "closed"), ...closedArcs].map(({ id }) => id);
}

function liftByTitle<T extends SchemaRecord>(ranked: readonly { item: T; score: number }[], query: string): { item: T; score: number }[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const search = normalisedWords(query);
  const tier = ({ item }: { item: T }): number => {
    const fields = item.fields as Record<string, unknown>;
    const heading = (typeof fields.title === "string" ? fields.title : typeof fields.term === "string" ? fields.term : "").toLowerCase();
    if (heading === "") return 3;
    if (normalisedWords(heading.replace(/^\d+(?:\.\d+)*\s*·\s*/, "")) === search) return 0;
    const number = /^(\d+(?:\.\d+)+)(?![\d.])/.exec(heading)?.[1];
    if (number !== undefined && words.includes(number)) return 1;
    const titleWords = heading.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
    if (search.split(" ").every((word) => titleWords.some((titleWord) => holdsName(word, titleWord)))) return 2;
    return 3;
  };
  return ranked.map((hit) => ({ hit, tier: tier(hit) })).sort((a, b) => a.tier - b.tier).map(({ hit }) => hit);
}

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

function similarityDocOf(note: Note): SimilarityDoc {
  const { title, term, description, ...rest } = note.fields as Record<string, unknown>;
  const heading = typeof title === "string" ? title : typeof term === "string" ? term : note.id;
  return {
    id: note.id,
    type: note.type,
    title: heading,
    ...(typeof description === "string" ? { description } : {}),
    body: textsIn(rest).join("\n"),
    links: referenceEdgesOf(note.fields),
  };
}

export function referenceEdgesOf(fields: object): { field: string; to: string }[] {
  const at = fields as Record<string, unknown>;
  return REFERENCE_FIELD_NAMES.flatMap((field) => {
    const ids =
      field === "stepRefs"
        ? listOf(at[field]).flatMap((step) => listOf(fieldOf(step, "refs")))
        : field === "branchEdges"
          ? listOf(at[field]).map((edge) => fieldOf(edge, "to"))
          : field === "supersedesClauses"
            ? listOf(at[field]).map((entry) => fieldOf(entry, "decision"))
            : listOf(at[field]);
    return ids.filter((id): id is string => typeof id === "string").map((to) => ({ field, to }));
  });
}

function linksOf(fields: object): string[] {
  return referenceEdgesOf(fields).flatMap(({ field, to }) => (SUPERSESSION_FIELDS.includes(field) ? [] : [to]));
}

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

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function fieldOf(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

export class SupersessionLoopError extends Error {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`supersession loop: ${path.join(" → ")} (a decision may not supersede itself, directly or through others)`);
    this.name = "SupersessionLoopError";
    this.path = [...path];
  }
}

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

export const knowledgeGuidance: readonly string[] = [
  [
  "Record what you learned.",
  "- `write_note` a decision, definition, principle, guardrail, pattern, process, agent role or tech stack artifact when you learn something worth keeping; give the chosen kind its required fields. With no place named, it goes onto the shelf of the capability you hold. `correct_note` fixes an artifact's wording in place. Before moving or renaming something records point at (a heading, a path, a name), `find_text` finds every record holding that text exactly, so none is missed. Give storytree text holding a dollar sign followed by a name, or a line break, through its tools, or to its command line as a file (--body @body.txt), never typed on the command line itself: the shell reads typed words first, and swaps the name for its value, or stops on an unset one, before storytree runs.",
  ].join("\n"),
];
