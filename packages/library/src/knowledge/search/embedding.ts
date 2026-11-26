// Capability 14 · Search
import { createHash } from "node:crypto";

import type { SchemaRecord } from "../../records/index.js";

export interface Embedder {
  readonly model: string;
  readonly queryPrefix?: string;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

export type EmbedderSource = () => Promise<Embedder>;

export interface VectorStore {
  get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>>;
  put(model: string, vectors: ReadonlyMap<string, Float32Array>): Promise<void>;
}

export class MemoryVectors implements VectorStore {
  readonly #vectors = new Map<string, Float32Array>();

  async get(model: string, keys: readonly string[]): Promise<Map<string, Float32Array>> {
    const found = new Map<string, Float32Array>();
    for (const key of keys) {
      const vector = this.#vectors.get(`${model}\u0000${key}`);
      if (vector !== undefined) found.set(key, vector);
    }
    return found;
  }

  async put(model: string, vectors: ReadonlyMap<string, Float32Array>): Promise<void> {
    for (const [key, vector] of vectors) this.#vectors.set(`${model}\u0000${key}`, vector);
  }
}

export const CHUNK = 1600;

const UNRENDERED: ReadonlySet<string> = new Set([
  "title",
  "term",
  "description",
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
  "number",
  "story",
  "capability",
  "dependsOn",
]);

export function renderNote(note: SchemaRecord): string {
  const fields = note.fields as Record<string, unknown>;
  const heading = typeof fields.title === "string" ? fields.title : typeof fields.term === "string" ? fields.term : note.id;
  const out = [`# ${heading}`, `[${note.type}] ${note.id}`];
  if (typeof fields.description === "string" && fields.description !== "") out.push(fields.description);
  for (const [key, value] of Object.entries(fields)) {
    if (UNRENDERED.has(key)) continue;
    const words = wordsIn(value).join("\n");
    if (words !== "") out.push(`## ${key}\n${words}`);
  }
  return out.join("\n\n");
}

function wordsIn(value: unknown): string[] {
  if (typeof value === "string") return value === "" ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(wordsIn);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => (UNRENDERED.has(key) ? [] : wordsIn(item)));
  }
  return [];
}

export function chunksOf(text: string, size = CHUNK): string[] {
  const out: string[] = [];
  let current = "";
  for (let paragraph of text.split("\n\n")) {
    while (paragraph.length > size) {
      if (current !== "") out.push(current);
      current = "";
      out.push(paragraph.slice(0, size));
      paragraph = paragraph.slice(size);
    }
    if (current !== "" && current.length + 2 + paragraph.length > size) {
      out.push(current);
      current = paragraph;
    } else {
      current = current === "" ? paragraph : `${current}\n\n${paragraph}`;
    }
  }
  if (current !== "") out.push(current);
  return out;
}

export interface Scored<T> {
  readonly item: T;
  readonly score: number;
}

export async function rankByMeaning<T>(
  items: readonly { readonly item: T; readonly text: string }[],
  query: string,
  embedder: Embedder,
  vectors: VectorStore,
): Promise<Scored<T>[]> {
  const chunked = items.map(({ item, text }) => ({ item, keys: chunksOf(text).map((chunk) => ({ key: keyOf(chunk), chunk })) }));
  const keys = [...new Set(chunked.flatMap(({ keys }) => keys.map(({ key }) => key)))];
  const kept = await vectors.get(embedder.model, keys);
  const missing = new Map<string, string>();
  for (const { keys } of chunked) for (const { key, chunk } of keys) if (!kept.has(key)) missing.set(key, chunk);
  if (missing.size > 0) {
    const made = await embedInBatches(embedder, [...missing.values()]);
    const fresh = new Map([...missing.keys()].map((key, index) => [key, made[index]!] as const));
    await vectors.put(embedder.model, fresh);
    for (const [key, vector] of fresh) kept.set(key, vector);
  }
  const [question] = await embedder.embed([`${embedder.queryPrefix ?? ""}${query}`]);
  const scored = chunked.map(({ item, keys }, order) => ({
    item,
    order,
    score: Math.max(...keys.map(({ key }) => dot(kept.get(key)!, question!))),
  }));
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map(({ item, score }) => ({ item, score }));
}

async function embedInBatches(embedder: Embedder, texts: readonly string[], batch = 16): Promise<Float32Array[]> {
  const order = texts.map((_, index) => index).sort((a, b) => texts[a]!.length - texts[b]!.length);
  const out: Float32Array[] = new Array(texts.length);
  for (let start = 0; start < order.length; start += batch) {
    const indices = order.slice(start, start + batch);
    const made = await embedder.embed(indices.map((index) => texts[index]!));
    indices.forEach((index, at) => (out[index] = made[at]!));
  }
  return out;
}

function keyOf(chunk: string): string {
  return createHash("sha256").update(chunk).digest("hex");
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}
