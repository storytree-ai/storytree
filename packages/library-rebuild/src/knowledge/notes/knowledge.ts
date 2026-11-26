// Capability 14 · Ranked search
import { RECORD_SCHEMAS, type FieldsOf, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../storage/rules/index.js";
import {
  defaultEmbedder,
  findPhrase,
  MemoryVectors,
  NOTE_TYPES,
  RankedSearch,
  searchableText,
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

export type NewKnowledge<K extends KnowledgeKind = KnowledgeKind> = K extends "friction" ? Omit<FieldsOf<K>, "state"> : FieldsOf<K>;
export type NewDefinition = FieldsOf<"definition">;
export type NewDecision = FieldsOf<"decision">;
export type NoteEdit = {
  [K in NoteType]: { [F in keyof FieldsOf<K>]?: FieldsOf<K>[F] | undefined };
}[NoteType];

export class Knowledge {
  readonly #records: SchemaRecords;
  readonly #search: RankedSearch;

  constructor(records: SchemaRecords, _project?: string, ranking: Partial<Ranking> = {}) {
    this.#records = records;
    this.#search = new RankedSearch(records, { embedder: ranking.embedder ?? defaultEmbedder(), vectors: ranking.vectors ?? new MemoryVectors() });
  }

  async recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    return await this.#records.create("decision", decision, options);
  }

  async writeKnowledge<K extends KnowledgeKind>(kind: K, fields: NewKnowledge<K>, options?: WriteOptions): Promise<SchemaRecord<K>> {
    const shaped = kind === "friction" ? { state: "open", ...fields } : fields;
    return await this.#records.create(kind, shaped as FieldsOf<K>, options);
  }

  async defineTerm(definition: NewDefinition, options?: WriteOptions): Promise<SchemaRecord<"definition">> {
    return await this.#records.create("definition", definition, options);
  }

  async editNote(id: string, fields: NoteEdit, options?: WriteOptions): Promise<Note | null> {
    return (await this.#records.edit(id, fields, options)) as Note | null;
  }

  async rank(query: string, options?: RankOptions): Promise<Ranked> {
    return await this.#search.rank(query, options);
  }

  async rankAll(query: string, options?: RankOptions): Promise<Ranked<Findable>> {
    return await this.#search.rankAll(query, options);
  }

  async search(query: string): Promise<Note[]> {
    const words = query.toLowerCase();
    const notes = await this.#records.list(NOTE_TYPES.filter((kind): kind is NoteType => Object.hasOwn(RECORD_SCHEMAS, kind)));
    return notes.filter((note) => searchableText(note).toLowerCase().includes(words));
  }

  async findPhrase(phrase: string, options?: PhraseOptions): Promise<PhrasePage> {
    return await findPhrase(this.#records, phrase, options);
  }
}
