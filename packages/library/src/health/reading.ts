// Capability 5 · Health record
import type { FieldsOf, SchemaRecords } from "../storage/rules/index.js";
import type { HistoryEntry } from "../storage/store/index.js";
import type { HealthColumn, HealthColumnName, HealthEntry, HealthOptions, HealthState, NodeHealth, SkipKind } from "./types.js";
import { OBSERVED } from "./word.js";

export type HealthFields = FieldsOf<"health">;
type ContractProof = NonNullable<FieldsOf<"contract">["proof"]>;

const SIDES = { ci: "health_ci_", pending: "health_pending_", observed: "health_observed_" } as const;
type Side = keyof typeof SIDES;

export function sideId(side: Side, node: string): string {
  return `${SIDES[side]}${node}`;
}

export function sideOf(id: string): Side | undefined {
  return (Object.keys(SIDES) as Side[]).find((side) => id.startsWith(SIDES[side]));
}

export interface Stored {
  readonly id: string;
  readonly fields: HealthFields;
  readonly at: string;
}

export interface Reading {
  readonly reported: Map<string, Stored>;
  readonly verified: Map<string, Stored>;
  readonly ci: Map<string, Stored>;
  readonly pending: Map<string, Stored>;
  readonly observed: Map<string, Stored>;
  readonly entries: readonly HistoryEntry[];
  readonly checked: boolean;
}

export async function readHealth(records: SchemaRecords): Promise<Reading> {
  const entries = await records.history({ types: ["health"] });
  const last = new Map<string, HistoryEntry>();
  for (const entry of entries) last.set(entry.recordId, entry);
  const maps = { reported: new Map<string, Stored>(), verified: new Map<string, Stored>(), ci: new Map<string, Stored>(), pending: new Map<string, Stored>(), observed: new Map<string, Stored>() };
  for (const [id, entry] of last) {
    if (entry.action === "retired") continue;
    const fields = records.current(entry.record).fields as HealthFields;
    const map: Map<string, Stored> | undefined = maps[sideOf(id) ?? fields.column];
    map?.set(fields.node, { id, fields, at: entry.at });
  }
  return { ...maps, entries, checked: maps.verified.size > 0 || maps.observed.size > 0 };
}

export function healthFields(node: string, column: HealthColumnName, state: HealthState, options: HealthOptions): HealthFields {
  const { by, note, skip, was, source, tests, flaky } = options;
  return {
    node,
    column,
    state,
    ...(by === undefined ? {} : { by }),
    ...(note === undefined ? {} : { note }),
    ...(skip === undefined ? {} : { skip }),
    ...(was === undefined ? {} : { was: was.state, wasAt: was.at }),
    ...(source === undefined ? {} : { source }),
    ...(tests === undefined ? {} : { tests: tests as string[] }),
    ...(flaky === undefined ? {} : { flaky: flaky as string[] }),
  };
}

export function columnOf({ fields, at }: Pick<Stored, "fields" | "at">): HealthColumn {
  return {
    state: fields.state,
    ...(fields.by === undefined ? {} : { by: fields.by }),
    at,
    ...(fields.note === undefined ? {} : { note: fields.note }),
    ...(fields.skip === undefined ? {} : { skip: fields.skip as SkipKind }),
    ...(fields.was === undefined ? {} : { was: { state: fields.was, at: fields.wasAt ?? at } }),
    ...(fields.source === undefined ? {} : { source: fields.source }),
    ...(fields.tests === undefined ? {} : { tests: [...fields.tests] }),
    ...(fields.flaky === undefined ? {} : { flaky: [...fields.flaky] }),
  };
}

export function entryOf(stored: Pick<Stored, "fields" | "at">): HealthEntry {
  return { column: stored.fields.column, ...columnOf(stored), at: stored.at };
}

export function unchecked(): NodeHealth {
  return { reported: { state: "not-checked" }, verified: { state: "not-checked" } };
}

export function contractHealth(reading: Reading, contract: { readonly id: string; readonly proof?: ContractProof | undefined }, now: Date): NodeHealth {
  const reported = reading.reported.get(contract.id);
  const ci = reading.ci.get(contract.id);
  return {
    reported: reported === undefined ? { state: "not-checked" } : columnOf(reported),
    verified: verifiedOf(reading, contract, now),
    ...(ci === undefined ? {} : { ci: columnOf(ci) }),
  };
}

function verifiedOf(reading: Reading, contract: { readonly id: string; readonly proof?: ContractProof | undefined }, now: Date): HealthColumn {
  const stored = reading.verified.get(contract.id);
  const column: HealthColumn = stored === undefined ? { state: "not-checked" } : columnOf(stored);
  const proof = contract.proof;
  if (proof?.by !== OBSERVED || column.state === "failing") return column;
  const observed = reading.observed.get(contract.id);
  if (observed === undefined) return { state: "not-checked" };
  const seen = columnOf(observed);
  const { span, said } = freshness(proof.freshness);
  if (seen.state === "failing" || now.getTime() - Date.parse(observed.at) <= span) return seen;
  return {
    ...seen,
    state: "not-checked",
    was: { state: "passing", at: observed.at },
    note: `not re-run: its newest live reading, at ${observed.at}, is older than its freshness of ${said}: ${seen.note ?? ""}`,
  };
}

function freshness(text: string): { span: number; said: string } {
  const count = Number(text.slice(0, -1));
  const hours = text.endsWith("h");
  return { span: count * (hours ? 3_600_000 : 86_400_000), said: `${count} ${hours ? "hour" : "day"}${count === 1 ? "" : "s"}` };
}

export function keptVerdict(entries: readonly HistoryEntry[]): HealthState | undefined {
  const states = entries.map(({ record }) => (record.fields as HealthFields).state).filter((state) => state !== "not-checked");
  return states.at(-1);
}

export type Turn = "red" | "green" | "still";

export function turnOf(kept: HealthState | undefined, state: HealthState): Turn | undefined {
  if (state === "failing") return kept === "failing" ? "still" : "red";
  return state === "passing" && kept === "failing" ? "green" : undefined;
}

export function verdictEntries(reading: Reading): Map<string, HistoryEntry[]> {
  const byRecord = new Map<string, HistoryEntry[]>();
  for (const entry of reading.entries) {
    if (entry.action === "retired" || sideOf(entry.recordId) !== undefined || entry.record.fields["column"] !== "verified") continue;
    byRecord.set(entry.recordId, [...(byRecord.get(entry.recordId) ?? []), entry]);
  }
  return byRecord;
}
