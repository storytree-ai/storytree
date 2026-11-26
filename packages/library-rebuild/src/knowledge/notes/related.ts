// Capability 6 · Knowledge artifacts
import type { Note } from "../search/index.js";
import { referenceEdgesOf } from "./links.js";

export interface RelatedOptions {
  readonly unlinked?: boolean;
  readonly kind?: string;
  readonly limit?: number;
}

export interface RelatedHit {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly score: number;
  readonly matched: string[];
  readonly linked: boolean;
  readonly linkVia: string[];
}

export interface Related {
  readonly source: string;
  readonly terms: string[];
  readonly scanned: number;
  readonly linkedCount: number;
  readonly hits: RelatedHit[];
}

const ID = /^[a-z][A-Za-z]*_[0-9a-f]{12}$/;

const STOPWORDS = new Set([
  "about", "after", "all", "and", "are", "but", "can", "each", "for", "from", "has", "have", "into", "its", "not", "now", "one", "our", "out", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "was", "were", "what", "when", "where", "which", "who", "why", "will", "with", "you", "your",
]);

function texts(value: unknown): string[] {
  if (typeof value === "string") return ID.test(value) ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(texts);
  return [];
}

export function wordsOf(note: Note): string {
  return texts(note.fields).join("\n").normalize("NFC").toLowerCase();
}

export function matches(note: Note, query: string): boolean {
  const words = query.normalize("NFC").toLowerCase().split(/\s+/).filter(Boolean);
  const text = wordsOf(note);
  return words.every((word) => text.includes(word));
}

function termsOf(note: Note): Set<string> {
  return new Set((wordsOf(note).match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 2 && !STOPWORDS.has(word)));
}

function titleOf(note: Note): string {
  const fields = note.fields as Record<string, unknown>;
  return String(fields["title"] ?? fields["term"] ?? "");
}

export function relatedOf(source: Note, notes: readonly Note[], options: RelatedOptions = {}): Related {
  const terms = new Map(notes.map((note) => [note.id, termsOf(note)]));
  const weight = (term: string): number => Math.log(1 + notes.length / notes.filter((note) => terms.get(note.id)!.has(term)).length);
  const own = [...terms.get(source.id)!].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  const others = notes.filter((note) => note.id !== source.id && (options.kind === undefined || note.type === options.kind));
  const ranked = others
    .map((note) => {
      const matched = own.filter((term) => terms.get(note.id)!.has(term));
      const linkVia = [
        ...referenceEdgesOf(source.fields).filter(({ to }) => to === note.id).map(({ field }) => field),
        ...referenceEdgesOf(note.fields).filter(({ to }) => to === source.id).map(({ field }) => `${field} → this`),
      ];
      const via = [...new Set(linkVia)];
      return { id: note.id, type: note.type, title: titleOf(note), score: matched.reduce((sum, term) => sum + weight(term), 0), matched, linked: via.length > 0, linkVia: via };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  return {
    source: source.id,
    terms: own,
    scanned: others.length,
    linkedCount: ranked.filter(({ linked }) => linked).length,
    hits: ranked.filter(({ linked }) => options.unlinked !== true || !linked).slice(0, options.limit ?? 10),
  };
}
