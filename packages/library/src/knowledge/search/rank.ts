// Capability 14 · Ranked search
import { createHash } from "node:crypto";

import { RECORD_SCHEMAS, type RecordType, type SchemaRecord, type SchemaRecords } from "../../storage/rules/index.js";
import type { Embedder, EmbedderSource } from "./model.js";
import { chunksOf, renderNote, searchableText, titleOf } from "./render.js";
import type { VectorStore } from "./vectors.js";

const KNOWLEDGE_KINDS = [
  "principle", "guardrail", "pattern", "process", "agent", "friction", "resteer", "techstack", "check", "research", "experiment", "escape", "drill", "measure",
] as const;
const NOTE_KINDS = ["decision", "definition", ...KNOWLEDGE_KINDS] as const;
const PLAN_KINDS = ["story", "capability", "contract", "arc", "increment"] as const;
const HISTORY_KINDS: readonly string[] = ["resteer", "friction"];

export type KnowledgeKind = Extract<RecordType, (typeof KNOWLEDGE_KINDS)[number]>;
export type NoteType = Extract<RecordType, (typeof NOTE_KINDS)[number]>;
export type PlanKind = Extract<RecordType, (typeof PLAN_KINDS)[number]>;
export type Note = SchemaRecord<NoteType>;
export type Findable = Note | SchemaRecord<PlanKind>;

export interface Ranking {
  readonly embedder: EmbedderSource;
  readonly vectors: VectorStore;
}

export interface NarrowingDecision {
  readonly id: string;
  readonly number?: number;
  readonly clauses?: readonly string[];
}

export interface Ranked<T extends SchemaRecord = Note> {
  readonly by: "meaning" | "words";
  readonly why?: string;
  readonly hits: {
    readonly note: T;
    readonly score?: number;
    readonly narrowedBy?: readonly NarrowingDecision[];
  }[];
}

export interface RankOptions {
  readonly limit?: number;
  readonly history?: boolean;
  readonly kinds?: readonly (NoteType | PlanKind)[];
}

interface Candidate {
  readonly record: SchemaRecord;
  readonly closed: boolean;
  readonly tier: number;
  readonly narrowedBy?: readonly NarrowingDecision[];
}

export const SEARCHABLE_KINDS: readonly string[] = [...NOTE_KINDS, ...PLAN_KINDS];

export class RankedSearch {
  readonly #records: Pick<SchemaRecords, "list">;
  readonly #ranking: Ranking;

  constructor(records: Pick<SchemaRecords, "list">, ranking: Ranking) {
    this.#records = records;
    this.#ranking = ranking;
  }

  async rank(query: string, options: RankOptions = {}): Promise<Ranked> {
    return (await this.#rank(query, options, NOTE_KINDS)) as Ranked;
  }

  async rankAll(query: string, options: RankOptions = {}): Promise<Ranked<Findable>> {
    return (await this.#rank(query, options, [...PLAN_KINDS, ...NOTE_KINDS])) as Ranked<Findable>;
  }

  async #rank(query: string, options: RankOptions, universe: readonly string[]): Promise<Ranked<SchemaRecord>> {
    for (const kind of options.kinds ?? []) {
      if (!SEARCHABLE_KINDS.includes(kind)) throw new Error(`unknown kind to search: ${kind}`);
    }
    const named: readonly string[] | undefined = options.kinds;
    const kinds = universe.filter((kind) => Object.hasOwn(RECORD_SCHEMAS, kind) && (named === undefined ? options.history === true || !HISTORY_KINDS.includes(kind) : named.includes(kind)));
    const candidates = await this.#candidates(query, kinds, options.history === true);
    const limit = options.limit ?? 10;
    let embedder: Embedder;
    try {
      embedder = await this.#ranking.embedder();
    } catch (error) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = candidates.filter(({ record }) => {
        const text = searchableText(record).toLowerCase();
        return words.length > 0 && words.every((word) => text.includes(word));
      });
      return {
        by: "words",
        why: `ranked by words, not meaning: the embedding model is not to hand (${(error as Error).message})`,
        hits: ordered(matches.map((candidate) => ({ candidate, score: 0 }))).slice(0, limit).map(({ candidate }) => hit(candidate)),
      };
    }
    const scores = await this.#scores(embedder, query, candidates.map(({ record }) => record));
    const scored = candidates.map((candidate, index) => ({ candidate, score: scores[index]! }));
    return { by: "meaning", hits: ordered(scored).slice(0, limit).map(({ candidate, score }) => ({ ...hit(candidate), score })) };
  }

  async #candidates(query: string, kinds: readonly string[], history: boolean): Promise<Candidate[]> {
    const listed = new Map<string, SchemaRecord[]>();
    const list = async (kind: string): Promise<SchemaRecord[]> => {
      if (!listed.has(kind)) listed.set(kind, Object.hasOwn(RECORD_SCHEMAS, kind) ? await this.#records.list(kind as RecordType) : []);
      return listed.get(kind)!;
    };
    const records: SchemaRecord[] = [];
    for (const kind of kinds) records.push(...(await list(kind)));
    const decisions = kinds.includes("decision") ? await list("decision") : [];
    const accepted = decisions.filter((decision) => field(decision, "status") === "accepted");
    const superseded = new Set(accepted.flatMap((decision) => strings(field(decision, "supersedes"))));
    const arcs = kinds.includes("arc");
    const increments = arcs ? await list("increment") : [];
    const questions = arcs ? await list("question") : [];
    const lift = titleLift(query);
    return records
      .filter((record) => history || !superseded.has(record.id))
      .map((record) => {
        const narrowedBy = record.type === "decision" ? narrowingOf(record, accepted) : [];
        return {
          record,
          closed: closedOf(record, increments, questions),
          tier: lift(record),
          ...(narrowedBy.length === 0 ? {} : { narrowedBy }),
        };
      });
  }

  async #scores(embedder: Embedder, query: string, records: readonly SchemaRecord[]): Promise<number[]> {
    const chunked = records.map((record) => chunksOf(renderNote(record)).map((text) => ({ text, key: createHash("sha256").update(text).digest("hex") })));
    const texts = new Map(chunked.flat().map(({ key, text }) => [key, text]));
    const vectors = await this.#ranking.vectors.get(embedder.model, [...texts.keys()]);
    const missing = [...texts].filter(([key]) => !vectors.has(key));
    if (missing.length > 0) {
      const made = await embedder.embed(missing.map(([, text]) => text));
      const fresh = new Map(missing.map(([key], index) => [key, made[index]!]));
      await this.#ranking.vectors.put(embedder.model, fresh);
      for (const [key, vector] of fresh) vectors.set(key, vector);
    }
    const [asked] = await embedder.embed([`${embedder.queryPrefix ?? ""}${query}`]);
    return chunked.map((chunks) => Math.max(...chunks.map(({ key }) => cosine(asked!, vectors.get(key)!))));
  }
}

function hit(candidate: Candidate): Ranked<SchemaRecord>["hits"][number] {
  return { note: candidate.record, ...(candidate.narrowedBy === undefined ? {} : { narrowedBy: candidate.narrowedBy }) };
}

function ordered<T extends { readonly candidate: Candidate; readonly score: number }>(scored: readonly T[]): T[] {
  return scored
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      Number(a.entry.candidate.closed) - Number(b.entry.candidate.closed) ||
      a.entry.candidate.tier - b.entry.candidate.tier ||
      b.entry.score - a.entry.score ||
      a.index - b.index)
    .map(({ entry }) => entry);
}

function field(record: SchemaRecord, name: string): unknown {
  return (record.fields as Record<string, unknown>)[name];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function narrowingOf(decision: SchemaRecord, accepted: readonly SchemaRecord[]): NarrowingDecision[] {
  const found: NarrowingDecision[] = [];
  for (const other of accepted) {
    const clauses = field(other, "supersedesClauses");
    for (const entry of Array.isArray(clauses) ? (clauses as { decision: string; clauses?: string[] }[]) : []) {
      if (entry.decision === decision.id) found.push({ id: other.id, number: field(other, "number") as number, clauses: entry.clauses! });
    }
    if (strings(field(other, "narrows")).includes(decision.id)) found.push({ id: other.id });
  }
  return found;
}

function closedOf(record: SchemaRecord, increments: readonly SchemaRecord[], questions: readonly SchemaRecord[]): boolean {
  if (record.type === "increment") return field(record, "status") === "closed";
  if (record.type !== "arc") return false;
  const own = increments.filter((increment) => field(increment, "arc") === record.id);
  const asking = questions.some((question) => field(question, "arc") === record.id && field(question, "lifecycle") === "open");
  return own.length > 0 && own.every((increment) => field(increment, "status") === "closed") && !asking;
}

const NUMBER = /^\d+(?:\.\d+)+$/;
const NUMBERED = /^\s*(\d+(?:\.\d+)+)\s*·\s*/;

function wordsIn(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function plain(title: string): string {
  return title.replace(NUMBERED, "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

function singulars(word: string): string[] {
  const forms = [word];
  if (word.endsWith("ies")) forms.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) forms.push(word.slice(0, -2));
  if (word.endsWith("s")) forms.push(word.slice(0, -1));
  return forms;
}

function titleLift(query: string): (record: SchemaRecord) => number {
  const exact = plain(query);
  const numbers = query.split(/\s+/).filter((word) => NUMBER.test(word));
  const wanted = wordsIn(query).map(singulars);
  return (record) => {
    const title = titleOf(record);
    if (exact !== "" && plain(title) === exact) return 0;
    const number = record.type === "contract" ? NUMBERED.exec(title)?.[1] : undefined;
    if (number !== undefined && numbers.includes(number)) return 1;
    if (wanted.length > 0) {
      const held = new Set(wordsIn(title));
      if (wanted.every((forms) => forms.some((form) => held.has(form)))) return 2;
    }
    return 3;
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * (b[index] ?? 0);
    left += a[index]! * a[index]!;
    right += (b[index] ?? 0) * (b[index] ?? 0);
  }
  return left === 0 || right === 0 ? 0 : dot / Math.sqrt(left * right);
}
