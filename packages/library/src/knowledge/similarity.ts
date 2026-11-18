// Capability 6 · Knowledge artifacts

export interface SimilarityDoc {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly description?: string;
  readonly body: string;
  readonly links: readonly { readonly field: string; readonly to: string }[];
}

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

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "do", "does", "for", "from",
  "had", "has", "have", "how", "in", "into", "is", "it", "its", "not", "of", "on", "or", "our",
  "that", "the", "their", "them", "then", "there", "these", "they", "this", "to", "was", "we",
  "were", "what", "when", "which", "who", "why", "will", "with", "would", "you", "your",
]);

const MIN_TOKEN_LENGTH = 2;

const SUFFIXES: readonly string[] = [
  "ability", "ations", "ements", "ation", "ement", "ments", "ingly", "able", "edly", "ible", "ings",
  "ment", "ness", "est", "ies", "ing", "ed", "es", "ly", "s", "y",
];

const MIN_STEM_LENGTH = 4;

const BM25_K1 = 1.2;
const BM25_B = 0.75;

const TITLE_WEIGHT = 6;
const DESCRIPTION_WEIGHT = 3;
const BODY_WEIGHT = 1;

const DEFAULT_LIMIT = 20;
const TERM_COUNT = 12;

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

function idf(df: number, total: number): number {
  return Math.log(1 + (total - df + 0.5) / (df + 0.5));
}

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

export function relatedTo(docs: readonly SimilarityDoc[], sourceId: string, options: RelatedOptions = {}): Related {
  return relatedEach(docs, [sourceId], options)[0]!;
}

export function relatedEach(docs: readonly SimilarityDoc[], sourceIds: readonly string[], options: RelatedOptions = {}): Related[] {
  const index = indexOf(docs);
  return sourceIds.map((sourceId) => relatedIn(index, docs, sourceId, options));
}

function relatedIn(index: Index, docs: readonly SimilarityDoc[], sourceId: string, options: RelatedOptions): Related {
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
