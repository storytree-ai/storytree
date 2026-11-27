// Capability 13 · Decision log
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../../storage/rules/index.js";

type Decision = SchemaRecord<"decision">;
type Entry = { decision: string; clauses?: string[] };

export interface NarrowsMove {
  readonly decisions: string[];
  readonly edges: number;
  readonly partial: number;
}

export interface SupersessionPair {
  readonly kind: "no-note" | "no-edge";
  readonly from: string;
  readonly to: string;
}

export interface SupersessionPairs {
  readonly flagged: SupersessionPair[];
  readonly backlog: number;
}

const BACKLOG_BEFORE = Date.parse("2026-11-20T00:00:00.000Z");
const MENTION = /ADR-(\d+)/g;
const SEGMENT_END = /ADR-\d|[.;\n]/;
const CLAUSE = /\bD[1-9]\d*\b/g;
const IN_PLACE = /\b(?:narrowed|annotated|amended|superseded|replaced|overtaken)\b[^.\n:]*?\bby\s+\**(ADR-(\d+)|[a-z][A-Za-z]*_[0-9a-f]{12})/gi;

function clausesNamed(text: string, number: number | undefined): string[] {
  if (number === undefined) return [];
  const named: string[] = [];
  for (const mention of text.matchAll(MENTION)) {
    if (Number(mention[1]) !== number) continue;
    const after = text.slice(mention.index + mention[0].length);
    const end = after.search(SEGMENT_END);
    for (const [clause] of (end === -1 ? after : after.slice(0, end)).matchAll(CLAUSE)) if (!named.includes(clause)) named.push(clause);
  }
  return named;
}

export async function moveNarrows(records: SchemaRecords, options: WriteOptions): Promise<NarrowsMove> {
  return await records.inOneWrite(async () => {
    const decisions = await records.list("decision");
    const numbers = new Map(decisions.map(({ id, fields }) => [id, fields.number]));
    const moved: string[] = [];
    let edges = 0;
    let partial = 0;
    for (const { id, fields } of decisions) {
      if (fields.narrows === undefined) continue;
      const entries: Entry[] = (fields.supersedesClauses ?? []).map(({ decision, clauses }) => ({ decision, ...(clauses === undefined ? {} : { clauses: [...clauses] }) }));
      for (const narrowed of fields.narrows) {
        const clauses = clausesNamed(fields.text, numbers.get(narrowed));
        const held = entries.find(({ decision }) => decision === narrowed);
        if (held === undefined) entries.push({ decision: narrowed, ...(clauses.length === 0 ? {} : { clauses }) });
        else if (clauses.length > 0) held.clauses = [...new Set([...(held.clauses ?? []), ...clauses])];
        edges += 1;
        if (clauses.length === 0) partial += 1;
      }
      await records.edit(id, { supersedesClauses: entries, narrows: undefined }, options);
      moved.push(id);
    }
    return { decisions: moved, edges, partial };
  }, options.signal);
}

function notesIn(text: string, numbered: ReadonlyMap<number, string>): Set<string> {
  const named = new Set<string>();
  for (const [, name, number] of text.matchAll(IN_PLACE)) {
    const id = number === undefined ? name : numbered.get(Number(number));
    if (id !== undefined) named.add(id);
  }
  return named;
}

function scopedTargets({ fields }: Decision): string[] {
  return [...(fields.supersedesClauses ?? []).map(({ decision }) => decision), ...(fields.narrows ?? [])];
}

export function supersessionPairs(decisions: readonly Decision[]): SupersessionPairs {
  const live = new Map(decisions.map((decision) => [decision.id, decision]));
  const numbered = new Map(decisions.flatMap(({ id, fields }) => (fields.number === undefined ? [] : [[fields.number, id] as const])));
  const notes = new Map(decisions.map(({ id, fields }) => [id, notesIn(fields.text, numbered)]));
  const pairs: SupersessionPair[] = [];
  for (const decision of decisions) {
    for (const to of scopedTargets(decision)) {
      if (live.has(to) && !notes.get(to)!.has(decision.id)) pairs.push({ kind: "no-note", from: decision.id, to });
    }
    for (const from of notes.get(decision.id)!) {
      const superseding = live.get(from);
      if (superseding === undefined || from === decision.id) continue;
      if (![...(superseding.fields.supersedes ?? []), ...scopedTargets(superseding)].includes(decision.id)) pairs.push({ kind: "no-edge", from, to: decision.id });
    }
  }
  const old = (pair: SupersessionPair): boolean => Date.parse(live.get(pair.from)!.createdAt) < BACKLOG_BEFORE;
  return { flagged: pairs.filter((pair) => !old(pair)), backlog: pairs.filter(old).length };
}
