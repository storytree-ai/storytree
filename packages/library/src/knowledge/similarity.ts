/**
 * Capability 6 · the related-but-unlinked search (ADR-0654, owner L1): rank the other artifacts by
 * how alike they are to one artifact, and say of each whether a link already joins them. It is 0.2's
 * `relatedArtifacts` (`packages/library/src/search.ts` in storytree 0.2), which its librarian ran in
 * the Links round, ported whole: the same tokeniser and removal-only stemmer, BM25 with the standard
 * constants, and the source's own most distinguishing words (tf·idf) as the query.
 *
 * Three properties carry over because they are what makes the answer honest:
 * - it can return nothing: an artifact sharing no word with the source is never listed;
 * - every answer carries its denominator (`scanned`), so "nothing is unlinked" and "nothing was read"
 *   read differently;
 * - linked and unlinked come from ONE ranking, and `linkedCount` counts the whole of it, so it checks
 *   the link reading rather than measuring something else.
 *
 * Pure: the caller hands in the artifacts as plain documents.
 */

/** An artifact as the ranking sees it. */
export interface SimilarityDoc {
  readonly id: string;
  readonly type: string;
  /** Its title, or a definition's term. */
  readonly title: string;
  /** Its one-line description, if it has one. */
  readonly description?: string;
  /** The rest of its words. */
  readonly body: string;
  /** Every artifact it links to, with the field the link is in. */
  readonly links: readonly { readonly field: string; readonly to: string }[];
}

/** What related() may be asked. */
export interface RelatedOptions {
  /** Show only the artifacts no link reaches, in either direction. */
  readonly unlinked?: boolean;
  /** Rank only artifacts of this kind. */
  readonly kind?: string;
  /** How many to show, 20 unless given. The counts always describe the whole ranking. */
  readonly limit?: number;
}

/** One ranked artifact. */
export interface RelatedHit {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  /** BM25 over the source's terms this artifact holds: comparable within one answer only. */
  readonly score: number;
  /** The source's terms it holds, rarest first. */
  readonly matched: string[];
  /** Whether a link joins it to the source, in either direction. */
  readonly linked: boolean;
  /** How: the field of a link the source holds, or `<field> → this` for one it holds to the source. */
  readonly linkVia: string[];
}

/** The artifacts ranked by likeness to one. */
export interface Related {
  readonly source: string;
  /** The source's most distinguishing words, which the ranking searched with. */
  readonly terms: string[];
  /** How many artifacts were ranked: the denominator. */
  readonly scanned: number;
  /** How many of the ranked artifacts a link already joins to the source, before any filter or limit. */
  readonly linkedCount: number;
  /** Best first. */
  readonly hits: RelatedHit[];
}

/** Words too common in English to say which artifact is wanted. Generic only: BM25 discounts the rest. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "do", "does", "for", "from",
  "had", "has", "have", "how", "in", "into", "is", "it", "its", "not", "of", "on", "or", "our",
  "that", "the", "their", "them", "then", "there", "these", "they", "this", "to", "was", "we",
  "were", "what", "when", "which", "who", "why", "will", "with", "would", "you", "your",
]);

const MIN_TOKEN_LENGTH = 2;

/** Suffixes a stem is made by removing, longest first. Removal only, so a stem is a prefix of its word. */
const SUFFIXES: readonly string[] = [
  "ability", "ations", "ements", "ation", "ement", "ments", "ingly", "able", "edly", "ible", "ings",
  "ment", "ness", "est", "ies", "ing", "ed", "es", "ly", "s", "y",
];

/** A stem shorter than this is a fragment (at three, `capability` would become `cap`). */
const MIN_STEM_LENGTH = 4;

const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** A field's weight, applied by repeating its words: a title match outweighs one in a long body. */
const TITLE_WEIGHT = 6;
const DESCRIPTION_WEIGHT = 3;
const BODY_WEIGHT = 1;

const DEFAULT_LIMIT = 20;
/** How many of the source's words the ranking searches with. */
const TERM_COUNT = 12;

/** The stem of one word, or null when it is its own stem. */
function stemOf(word: string): string | null {
  for (const suffix of SUFFIXES) {
    if (!word.endsWith(suffix)) continue;
    if (suffix === "s" && word.endsWith("ss")) continue;
    const stem = word.slice(0, -suffix.length);
    if (stem.length < MIN_STEM_LENGTH) continue;
    return stem;
  }
  if (word.endsWith("e") && word.length - 1 >= MIN_STEM_LENGTH) return word.slice(0, -1);
  return null;
}

/**
 * Text as search words: a hyphenated run whole and each of its parts, and each word's stem beside
 * it, never instead of it.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const emit = (token: string): void => {
    if (token.length < MIN_TOKEN_LENGTH || STOP_WORDS.has(token)) return;
    out.push(token);
    const stem = stemOf(token);
    if (stem !== null && !STOP_WORDS.has(stem)) out.push(stem);
  };
  for (const run of text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
    emit(run);
    if (run.includes("-")) for (const part of run.split("-")) emit(part);
  }
  return out;
}

interface Indexed {
  readonly doc: SimilarityDoc;
  readonly tf: Map<string, number>;
  readonly length: number;
}

interface Index {
  readonly docs: readonly Indexed[];
  readonly documentFrequency: ReadonlyMap<string, number>;
  readonly averageLength: number;
}

function indexOf(docs: readonly SimilarityDoc[]): Index {
  const documentFrequency = new Map<string, number>();
  let total = 0;
  const indexed = docs.map((doc) => {
    const bag: string[] = [];
    const push = (text: string | undefined, weight: number): void => {
      if (text === undefined || text === "") return;
      const tokens = tokenize(text);
      for (let i = 0; i < weight; i += 1) bag.push(...tokens);
    };
    push(doc.title, TITLE_WEIGHT);
    push(doc.description, DESCRIPTION_WEIGHT);
    push(doc.body, BODY_WEIGHT);
    const tf = new Map<string, number>();
    for (const token of bag) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const term of tf.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    total += bag.length;
    return { doc, tf, length: bag.length };
  });
  return { docs: indexed, documentFrequency, averageLength: docs.length === 0 ? 0 : total / docs.length };
}

/** BM25's inverse document frequency, in the form that never goes negative. */
function idf(df: number, total: number): number {
  return Math.log(1 + (total - df + 0.5) / (df + 0.5));
}

/**
 * The words that most distinguish `entry` from the rest (tf·idf), leaving out any no other artifact
 * holds: such a word can match nothing, so it would only take the place of one that can.
 */
function salientTerms(index: Index, entry: Indexed): string[] {
  const total = index.docs.length;
  const scored: { term: string; weight: number }[] = [];
  for (const [term, f] of entry.tf) {
    const df = index.documentFrequency.get(term) ?? 0;
    if (df <= 1) continue;
    scored.push({ term, weight: f * idf(df, total) });
  }
  scored.sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
  return scored.slice(0, TERM_COUNT).map(({ term }) => term);
}

function scoreOf(index: Index, entry: Indexed, terms: readonly string[]): { score: number; matched: string[] } {
  const total = index.docs.length;
  const norm = index.averageLength === 0 ? 1 : 1 - BM25_B + (BM25_B * entry.length) / index.averageLength;
  let score = 0;
  const hits: { term: string; df: number }[] = [];
  for (const term of terms) {
    const f = entry.tf.get(term) ?? 0;
    if (f === 0) continue;
    const df = index.documentFrequency.get(term) ?? 0;
    hits.push({ term, df });
    score += idf(df, total) * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * norm));
  }
  hits.sort((a, b) => a.df - b.df || a.term.localeCompare(b.term));
  return { score, matched: hits.map(({ term }) => term) };
}

/** Every artifact a link joins to `sourceId`, either way, with how. */
function linksTo(docs: readonly SimilarityDoc[], sourceId: string): Map<string, string[]> {
  const via = new Map<string, string[]>();
  const add = (id: string, how: string): void => {
    if (id === sourceId) return;
    const known = via.get(id);
    if (known === undefined) via.set(id, [how]);
    else if (!known.includes(how)) known.push(how);
  };
  for (const doc of docs) {
    for (const link of doc.links) {
      if (doc.id === sourceId) add(link.to, link.field);
      else if (link.to === sourceId) add(doc.id, `${link.field} → this`);
    }
  }
  return via;
}

/**
 * Rank `docs` by likeness to the one with id `sourceId`, which must be among them. Every artifact is
 * ranked against the whole corpus's word counts; `kind` narrows which are listed and counted.
 */
export function relatedTo(docs: readonly SimilarityDoc[], sourceId: string, options: RelatedOptions = {}): Related {
  const index = indexOf(docs);
  const source = index.docs.find(({ doc }) => doc.id === sourceId);
  const terms = source === undefined ? [] : salientTerms(index, source);
  const links = linksTo(docs, sourceId);
  const pool = index.docs.filter(({ doc }) => doc.id !== sourceId && (options.kind === undefined || doc.type === options.kind));
  const hits: RelatedHit[] = [];
  for (const entry of pool) {
    const { score, matched } = scoreOf(index, entry, terms);
    if (matched.length === 0) continue;
    const linkVia = links.get(entry.doc.id) ?? [];
    hits.push({ id: entry.doc.id, type: entry.doc.type, title: entry.doc.title, score, matched, linked: linkVia.length > 0, linkVia });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const shown = options.unlinked === true ? hits.filter(({ linked }) => !linked) : hits;
  return {
    source: sourceId,
    terms,
    scanned: pool.length,
    linkedCount: hits.filter(({ linked }) => linked).length,
    hits: shown.slice(0, options.limit ?? DEFAULT_LIMIT),
  };
}
