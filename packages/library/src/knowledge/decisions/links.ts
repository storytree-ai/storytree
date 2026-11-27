// Capability 13 · Decision log
import { isDeepStrictEqual } from "node:util";

import type { NoteEdit } from "../notes/index.js";
import { liveOf, liveRecord, type EditOptions, type FieldsOf, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../storage/rules/index.js";
import type { HistoryEntry } from "../../storage/store/index.js";

type Decision = SchemaRecord<"decision">;
type Fields = Record<string, unknown>;
type LinkField = "links" | "supersedes" | "supersedesClauses";
type ArchivedLink = NonNullable<FieldsOf<"decision">["archivedLinks"]>[number];
type Edit = (id: string, fields: NoteEdit, options: EditOptions) => Promise<unknown>;

export interface ArchivedDecisionLink extends ArchivedLink {
  readonly from: string;
}

export interface DecisionLinkTarget {
  readonly number: number | undefined;
  readonly title: string;
  readonly links: number;
}

export interface DecisionLinkBacklog {
  readonly links: number;
  readonly decisions: number;
  readonly targets: readonly DecisionLinkTarget[];
}

export interface DecisionLinkCounts {
  readonly pruned: number;
  readonly restored: number;
  readonly justified: number;
  readonly corrected: number;
  readonly added: number;
  readonly decisions: number;
}

export interface DecisionLinkDay extends DecisionLinkCounts {
  readonly day: string;
}

export interface DecisionLinkChanges {
  readonly days: DecisionLinkDay[];
  readonly total: DecisionLinkCounts;
}

export interface DecisionLinkSpan {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly by?: string | undefined;
}

interface Edge {
  readonly field: LinkField;
  readonly to: string;
  readonly clauses?: readonly string[];
}

interface Tally {
  pruned: number;
  restored: number;
  justified: number;
  corrected: number;
  added: number;
  readonly touched: Set<string>;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function edgesOf(fields: Fields): Edge[] {
  const entries = Array.isArray(fields["supersedesClauses"]) ? (fields["supersedesClauses"] as { decision: string; clauses?: string[] }[]) : [];
  return [
    ...strings(fields["links"]).map((to) => ({ field: "links" as const, to })),
    ...strings(fields["supersedes"]).map((to) => ({ field: "supersedes" as const, to })),
    ...entries.map(({ decision, clauses }) => ({ field: "supersedesClauses" as const, to: decision, ...(clauses === undefined ? {} : { clauses }) })),
  ];
}

function justificationOf(fields: Fields, to: string): string | undefined {
  return (fields["justifications"] as Readonly<Record<string, string>> | undefined)?.[to];
}

function archiveOf(fields: Fields): ArchivedLink[] {
  return (fields["archivedLinks"] as ArchivedLink[] | undefined) ?? [];
}

export function linkBacklog(decisions: readonly Decision[]): DecisionLinkBacklog {
  const live = new Map(decisions.map((decision) => [decision.id, decision]));
  const counts = new Map<string, number>();
  const holding = new Set<string>();
  let links = 0;
  for (const { id, fields } of decisions) {
    for (const { to } of edgesOf(fields)) {
      if (!live.has(to) || justificationOf(fields, to) !== undefined) continue;
      links += 1;
      holding.add(id);
      counts.set(to, (counts.get(to) ?? 0) + 1);
    }
  }
  const targets = [...counts].map(([to, count]) => ({ number: live.get(to)!.fields.number, title: live.get(to)!.fields.title, links: count }));
  targets.sort((a, b) => b.links - a.links || (a.number ?? Number.POSITIVE_INFINITY) - (b.number ?? Number.POSITIVE_INFINITY));
  return { links, decisions: holding.size, targets };
}

export function archivedLinksOf(decisions: readonly Decision[], from?: string): ArchivedDecisionLink[] {
  return decisions.filter(({ id }) => from === undefined || id === from).flatMap(({ id, fields }) => archiveOf(fields).map((entry) => ({ from: id, ...entry })));
}

function without(fields: Fields, edge: Edge): Fields {
  if (edge.field === "supersedesClauses") {
    const kept = (fields["supersedesClauses"] as { decision: string }[]).filter(({ decision }) => decision !== edge.to);
    return { supersedesClauses: kept.length === 0 ? undefined : kept };
  }
  const kept = strings(fields[edge.field]).filter((to) => to !== edge.to);
  return { [edge.field]: kept.length === 0 ? undefined : kept };
}

function withEdge(fields: Fields, entry: ArchivedLink): Fields {
  if (entry.field === "supersedesClauses") {
    const held = (fields["supersedesClauses"] as object[] | undefined) ?? [];
    return { supersedesClauses: [...held, { decision: entry.to, ...(entry.clauses === undefined ? {} : { clauses: entry.clauses }) }] };
  }
  return { [entry.field]: [...strings(fields[entry.field]), entry.to] };
}

async function decisionOf(records: SchemaRecords, id: string): Promise<Decision> {
  const record = await liveOf(records, "decision", id);
  if (record === null) throw new Error(`${JSON.stringify(id)} is not a live decision, so nothing was written`);
  return record;
}

export async function pruneLink(records: SchemaRecords, edit: Edit, from: string, to: string, reason: string, options: WriteOptions): Promise<Decision> {
  if (reason.trim() === "") throw new Error(`a pruned decision link is archived with the reason it was pruned: give one; nothing was written`);
  const { fields } = await decisionOf(records, from);
  const edge = edgesOf(fields).find((one) => one.to === to);
  if (edge === undefined) throw new Error(`${from} holds no decision link to ${to}, so nothing was pruned or written`);
  const justification = justificationOf(fields, to);
  const entry: ArchivedLink = {
    to,
    field: edge.field,
    ...(edge.clauses === undefined ? {} : { clauses: [...edge.clauses] }),
    ...(justification === undefined ? {} : { justification }),
    reason,
    by: options.actor ?? "unknown",
    at: new Date().toISOString(),
  };
  await edit(from, { ...without(fields, edge), archivedLinks: [...archiveOf(fields), entry] } as NoteEdit, options);
  return await decisionOf(records, from);
}

export async function restoreLink(records: SchemaRecords, edit: Edit, from: string, to: string, justification: string | undefined, options: WriteOptions): Promise<Decision> {
  const { fields } = await decisionOf(records, from);
  const archive = archiveOf(fields);
  const index = archive.findLastIndex((entry) => entry.to === to);
  if (index === -1) throw new Error(`${from} has no archived link to ${to}, so nothing was restored or written`);
  if ((await liveRecord(records, to)) === null) throw new Error(`${to} is retired or missing, so ${from}'s link to it is not restored; nothing was written`);
  const entry = archive[index]!;
  const why = justification ?? entry.justification;
  if (why === undefined) throw new Error(`${from}'s link to ${to} comes back only with a justification: give one with --why; nothing was written`);
  const rest = archive.filter((_, at) => at !== index);
  await edit(from, { ...withEdge(fields, entry), justifications: { [to]: why }, archivedLinks: rest.length === 0 ? undefined : rest } as NoteEdit, options);
  return await decisionOf(records, from);
}

function keyOf({ field, to }: Edge): string {
  return `${field} ${to}`;
}

function tallied(before: Fields, after: Fields, decisions: ReadonlySet<string>): Omit<Tally, "touched"> {
  const was = new Map(edgesOf(before).filter(({ to }) => decisions.has(to)).map((edge) => [keyOf(edge), edge]));
  const now = edgesOf(after).filter(({ to }) => decisions.has(to));
  const archivedBefore = archiveOf(before).map((entry) => JSON.stringify(entry));
  const archivedAfter = archiveOf(after).map((entry) => JSON.stringify(entry));
  const pruned = archivedAfter.filter((entry) => !archivedBefore.includes(entry)).length;
  const back = new Set(archiveOf(before).filter((entry) => !archivedAfter.includes(JSON.stringify(entry))).map(({ field, to }) => keyOf({ field, to })));
  let restored = 0;
  let added = 0;
  let justified = 0;
  let corrected = 0;
  for (const edge of now) {
    const old = was.get(keyOf(edge));
    if (old === undefined) {
      if (back.has(keyOf(edge))) restored += 1;
      else added += 1;
      continue;
    }
    const said = justificationOf(before, edge.to);
    const says = justificationOf(after, edge.to);
    if (said === undefined && says !== undefined) justified += 1;
    else if (said !== says || !isDeepStrictEqual(old.clauses, edge.clauses)) corrected += 1;
  }
  return { pruned, restored, justified, corrected, added };
}

function emptyTally(): Tally {
  return { pruned: 0, restored: 0, justified: 0, corrected: 0, added: 0, touched: new Set() };
}

function countsOf({ touched, ...counts }: Tally): DecisionLinkCounts {
  return { ...counts, decisions: touched.size };
}

export function linkChanges(entries: readonly HistoryEntry[], span: DecisionLinkSpan): DecisionLinkChanges {
  const decisions = new Set(entries.map(({ recordId }) => recordId));
  const state = new Map<string, Fields>();
  const days = new Map<string, Tally>();
  const total = emptyTally();
  for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (entry.action === "retired") continue;
    const before = state.get(entry.recordId) ?? {};
    state.set(entry.recordId, entry.record.fields);
    const day = new Date(entry.at).toISOString().slice(0, 10);
    if ((span.from !== undefined && day < span.from) || (span.to !== undefined && day > span.to) || (span.by !== undefined && entry.actor !== span.by)) continue;
    const counts = tallied(before, entry.record.fields, decisions);
    if (Object.values(counts).every((count) => count === 0)) continue;
    const tally = days.get(day) ?? emptyTally();
    days.set(day, tally);
    for (const one of [tally, total]) {
      for (const [name, count] of Object.entries(counts) as [keyof typeof counts, number][]) one[name] += count;
      one.touched.add(entry.recordId);
    }
  }
  return { days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, tally]) => ({ day, ...countsOf(tally) })), total: countsOf(total) };
}
