// Capability 14 · Ranked search
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { checkReferences, SchemaError, type EditOptions, type FieldsOf, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../storage/rules/index.js";
import {
  defaultEmbedder,
  findPhrase,
  MemoryVectors,
  RankedSearch,
  type Findable,
  type KnowledgeKind,
  type Note,
  type NoteType,
  type PhraseOptions,
  type PhrasePage,
  type Ranked,
  type Ranking,
  type RankOptions,
} from "../search/index.js";
import { frictionState } from "./kinds.js";
import { ARTIFACT_KINDS, checkLoops, gained, referencesOf } from "./links.js";
import { matches, relatedOf, type Related, type RelatedOptions } from "./related.js";

export type NewKnowledge<K extends KnowledgeKind = KnowledgeKind> = K extends "friction" ? Omit<FieldsOf<K>, "state"> : FieldsOf<K>;
export type NewDefinition = FieldsOf<"definition">;
export type NewDecision = FieldsOf<"decision">;
export type NoteEdit = {
  [K in NoteType]: { [F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined };
}[NoteType];

type Fields = Record<string, unknown>;

const READING = ["story", "base", "reads", "unit", "better", "howRead", "machine", "runs"];
const JUDGEMENT = ["route", "routeReason", "dischargedBy"];

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function decisionTargets(fields: Fields): string[] {
  const clauses = Array.isArray(fields["supersedesClauses"]) ? (fields["supersedesClauses"] as { decision?: unknown }[]) : [];
  return [...strings(fields["links"]), ...strings(fields["supersedes"]), ...clauses.flatMap(({ decision }) => (typeof decision === "string" ? [decision] : []))];
}

function oldestFirst<T extends SchemaRecord>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function present(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export class Knowledge {
  readonly #records: SchemaRecords;
  readonly #search: RankedSearch;

  constructor(records: SchemaRecords, _project?: string, ranking: Partial<Ranking> = {}) {
    this.#records = records;
    this.#search = new RankedSearch(records, { embedder: ranking.embedder ?? defaultEmbedder(), vectors: ranking.vectors ?? new MemoryVectors() });
  }

  async recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    const number = decision.number ?? (await this.#nextNumber());
    return (await this.#create("decision", { ...decision, number }, options)) as SchemaRecord<"decision">;
  }

  async decision(id: string): Promise<{ readonly record: SchemaRecord<"decision"> } | null> {
    const record = await this.#note(id);
    return record?.type === "decision" ? { record } : null;
  }

  async writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K>> {
    if (kind === "friction" && Object.hasOwn(fields, "state")) throw new RangeError("a friction report is filed naming no state: the library files it open and moves its state as it is routed");
    const shaped = kind === "friction" ? { ...fields, state: frictionState(fields as Fields) } : fields;
    return (await this.#create(kind, shaped, options)) as SchemaRecord<K>;
  }

  async defineTerm(definition: NewDefinition, options?: WriteOptions): Promise<SchemaRecord<"definition">> {
    return (await this.#create("definition", definition, options)) as SchemaRecord<"definition">;
  }

  async refile<K extends KnowledgeKind>(id: string, kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K> | null> {
    if (kind === "friction" || kind === "resteer") throw new RangeError(`nothing is refiled as a ${kind}: a ${kind} is captured by its own rules`);
    const current = await this.#note(id);
    if (current === null) return null;
    this.#refuseFrozen(current);
    const links = (current.fields as Fields)["links"];
    return (await this.#create(kind, { ...(links === undefined ? {} : { links }), ...fields }, options, current)) as SchemaRecord<K>;
  }

  async editNote(id: string, fields: NoteEdit, options: EditOptions = {}): Promise<Note | null> {
    const current = await this.#note(id);
    if (current === null) return null;
    const stored = current.fields as Fields;
    const edit: Fields = { ...fields };
    if (current.type === "friction") {
      if (Object.hasOwn(edit, "state")) throw new RangeError("a friction report's state is never edited: it moves as the report is routed");
      const recurred = count(Object.hasOwn(edit, "reinforcedBy") ? edit["reinforcedBy"] : stored["reinforcedBy"]) > count(stored["reinforcedBy"]);
      if (recurred && (stored["state"] === "resolved" || stored["state"] === "dismissed")) for (const field of JUDGEMENT) edit[field] = undefined;
      edit["state"] = frictionState(present({ ...stored, ...edit }));
    }
    const candidate = present({ ...stored, ...edit });
    this.#records.check(current.type, candidate);
    if (current.type === "experiment" && stored["frozen"] !== undefined) {
      const changed = [...new Set([...Object.keys(stored), ...Object.keys(candidate)])].filter((field) => field !== "outcome" && !isDeepStrictEqual(stored[field], candidate[field]));
      if (changed.length > 0) this.#refuseFrozen(current);
    }
    if (current.type === "measure") this.#versioned(stored, candidate);
    if (current.type === "decision") edit["justifications"] = await this.#justified(candidate, stored, edit);
    const get = (target: string) => this.#records.get(target);
    await checkReferences(this.#records, gained(referencesOf(current.type, candidate), referencesOf(current.type, stored)));
    await checkLoops(id, candidate, get);
    return (await this.#records.edit(id, edit as NoteEdit, {
      ...options,
      checkCurrent: (now) => {
        if (now.updatedAt !== current.updatedAt) throw new Error(`${id} was written while it was being edited: read it again and edit it then`);
        options.checkCurrent?.(now);
      },
    })) as Note | null;
  }

  async search(query: string): Promise<Note[]> {
    return (await this.#notes()).filter((note) => matches(note, query));
  }

  async searchEach(queries: readonly string[]): Promise<Note[][]> {
    const notes = await this.#notes();
    return queries.map((query) => notes.filter((note) => matches(note, query)));
  }

  async related(noteId: string, options?: RelatedOptions): Promise<Related | null> {
    const notes = await this.#notes();
    const source = notes.find(({ id }) => id === noteId);
    return source === undefined ? null : relatedOf(source, notes, options);
  }

  async relatedEach(noteIds: readonly string[], options?: RelatedOptions): Promise<Related[]> {
    const notes = await this.#notes();
    return noteIds.flatMap((noteId) => {
      const source = notes.find(({ id }) => id === noteId);
      return source === undefined ? [] : [relatedOf(source, notes, options)];
    });
  }

  async relatedNotes(noteId: string): Promise<Note[]> {
    return (await this.#notes()).filter((note) => strings((note.fields as Fields)["links"]).includes(noteId));
  }

  async definitions(): Promise<SchemaRecord<"definition">[]> {
    return oldestFirst(await this.#records.list("definition"));
  }

  async frontCovers(nodeId: string): Promise<SchemaRecord<"decision">[]> {
    return oldestFirst((await this.#records.list("decision")).filter((decision) => decision.fields.frontCoverOf === nodeId));
  }

  async measures(story?: string): Promise<SchemaRecord<"measure">[]> {
    return oldestFirst((await this.#records.list("measure")).filter((measure) => story === undefined || measure.fields.story === story));
  }

  async rank(query: string, options?: RankOptions): Promise<Ranked> {
    return await this.#search.rank(query, options);
  }

  async rankAll(query: string, options?: RankOptions): Promise<Ranked<Findable>> {
    return await this.#search.rankAll(query, options);
  }

  async findPhrase(phrase: string, options?: PhraseOptions): Promise<PhrasePage> {
    return await findPhrase(this.#records, phrase, options);
  }

  async #notes(): Promise<Note[]> {
    return oldestFirst(await this.#records.list(ARTIFACT_KINDS as NoteType[]));
  }

  async #note(id: string): Promise<Note | null> {
    if (id.includes("\u0000")) return null;
    const record = await this.#records.get(id);
    return record !== null && ARTIFACT_KINDS.includes(record.type) ? (record as Note) : null;
  }

  async #nextNumber(): Promise<number> {
    const numbers = (await this.#records.list("decision")).map(({ fields }) => fields.number ?? 0);
    return Math.max(0, ...numbers) + 1;
  }

  async #create(kind: NoteType, fields: object, options: WriteOptions = {}, replacing?: Note): Promise<SchemaRecord> {
    const shaped = fields as Fields;
    this.#records.check(kind, shaped);
    if (kind === "decision") await this.#justified(shaped, {}, shaped);
    const get = (target: string) => this.#records.get(target);
    const before = replacing === undefined ? [] : referencesOf(replacing.type, replacing.fields);
    await checkReferences(this.#records, gained(referencesOf(kind, shaped), before));
    if (replacing !== undefined) await checkLoops(replacing.id, shaped, get);
    const id = replacing?.id ?? `${kind}_${randomBytes(6).toString("hex")}`;
    if (kind !== "research" || replacing?.type === "research") return await this.#records.create(kind, shaped as never, { ...options, id });
    const fyi = { title: `Research report: ${String(shaped["title"])}`, what: String(shaped["description"]), at: new Date().toISOString(), about: id, by: options.actor ?? "unknown" };
    const [saved] = await this.#records.createAll<NoteType | "fyi">([
      { type: kind, fields: shaped as never, options: { ...options, id } },
      { type: "fyi", fields: fyi, options: options.actor === undefined ? {} : { actor: options.actor } },
    ], options.signal);
    return saved!;
  }

  async #justified(candidate: Fields, stored: Fields, edit: Fields): Promise<Record<string, string> | undefined> {
    const targets = decisionTargets(candidate);
    const had = new Set(decisionTargets(stored));
    const given = { ...(stored["justifications"] as Record<string, string> | undefined), ...(edit["justifications"] as Record<string, string> | undefined) };
    for (const target of targets) {
      if (had.has(target) || Object.hasOwn(given, target)) continue;
      if ((await this.#records.get(target))?.type !== "decision") continue;
      throw new SchemaError("decision", [{
        field: "justifications",
        problem: `"justifications": ${JSON.stringify(target)} is a decision newly linked with no justification for the link; pass justifications: { ${JSON.stringify(target)}: "<why this decision follows it, in at most two lines>" }`,
      }]);
    }
    const kept = Object.fromEntries(Object.entries(given).filter(([target]) => targets.includes(target)));
    return Object.keys(kept).length === 0 ? undefined : kept;
  }

  #versioned(stored: Fields, candidate: Fields): void {
    const before = stored["version"] as number;
    const after = candidate["version"] as number;
    const reads = READING.some((field) => !isDeepStrictEqual(stored[field], candidate[field]));
    if (after < before || (reads && after <= before)) {
      throw new SchemaError("measure", [{
        field: "version",
        problem: `"version": a measure's version never falls, and a change to what or how it reads raises it above ${before} (it is ${after})`,
      }]);
    }
  }

  #refuseFrozen(note: Note): void {
    if (note.type === "experiment" && note.fields.frozen !== undefined) {
      throw new Error(`${note.id} is a frozen experiment (frozen ${note.fields.frozen}): only its outcome may be added`);
    }
  }
}
