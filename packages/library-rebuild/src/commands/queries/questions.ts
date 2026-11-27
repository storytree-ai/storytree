// Capability 27 · Fixed data questions
import type { Pool } from "pg";

import type { SchemaRecord, SchemaRecords } from "../../storage/rules/index.js";

export interface KindCount {
  readonly kind: string;
  readonly count: number;
  readonly statuses: readonly { readonly status: string; readonly count: number }[];
}

export interface Counts {
  readonly kinds: readonly KindCount[];
  readonly openByArc: readonly { readonly arc: string; readonly title: string | null; readonly open: number }[];
}

export interface RecentChange {
  readonly seq: number;
  readonly at: string;
  readonly action: string;
  readonly type: string;
  readonly id: string;
  readonly title: string | null;
}

export interface TitleHit {
  readonly id: string;
  readonly type: string;
  readonly title: string | null;
}

export interface WriterChange {
  readonly id: string;
  readonly type: string;
  readonly writes: number;
  readonly before: SchemaRecord | null;
  readonly after: SchemaRecord | null;
  readonly retired?: string;
  readonly later?: { readonly seq: number; readonly actor?: string };
}

export interface DataQuestions {
  counts(): Promise<Counts>;
  latestChanges(limit?: number): Promise<RecentChange[]>;
  findByTitle(words: readonly string[], options?: { readonly history?: boolean }): Promise<TitleHit[]>;
  decisionNumbered(number: number): Promise<TitleHit | null>;
}

export const MOST_ROWS = 20;

const HISTORY_KINDS: readonly string[] = ["resteer", "friction"];
const DECISION_NUMBER = /^(?:adr-)?(\d+)$/i;

export function decisionNumberOf(word: string): number | undefined {
  const matched = DECISION_NUMBER.exec(word.trim());
  return matched === null ? undefined : Number(matched[1]);
}

function holdsWord(title: string, word: string): boolean {
  const text = title.toLowerCase();
  const sought = word.toLowerCase();
  for (let at = text.indexOf(sought); at >= 0; at = text.indexOf(sought, at + 1)) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1]!)) return true;
  }
  return false;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

interface TitleRow {
  id: string;
  type: string;
  title: string | null;
  number: number | null;
  changed: Date;
}

export function dataQuestions(pool: Pool): DataQuestions {
  return {
    async counts() {
      const { rows } = await pool.query<{ kind: string; status: string | null; count: number }>(
        `SELECT type AS kind, coalesce(fields->>'status', fields->>'lifecycle') AS status, count(*)::int AS count
           FROM record WHERE type <> 'health' GROUP BY 1, 2`,
      );
      const kinds = new Map<string, { count: number; statuses: { status: string; count: number }[] }>();
      for (const { kind, status, count } of rows) {
        const held = kinds.get(kind) ?? { count: 0, statuses: [] };
        held.count += count;
        if (status !== null) held.statuses.push({ status, count });
        kinds.set(kind, held);
      }
      const { rows: arcs } = await pool.query<{ arc: string; title: string | null; open: number }>(
        `SELECT i.fields->>'arc' AS arc, a.fields->>'title' AS title, count(*)::int AS open
           FROM record i LEFT JOIN record a ON a.id = i.fields->>'arc'
          WHERE i.type = 'increment' AND i.fields->>'status' <> 'closed'
          GROUP BY 1, 2 ORDER BY 3 DESC, 1`,
      );
      return {
        kinds: [...kinds].sort(([one], [other]) => (one < other ? -1 : 1)).map(([kind, { count, statuses }]) => ({
          kind,
          count,
          statuses: statuses.sort((one, other) => other.count - one.count || (one.status < other.status ? -1 : 1)),
        })),
        openByArc: arcs,
      };
    },

    async latestChanges(limit = MOST_ROWS) {
      const { rows } = await pool.query<{ seq: string; at: Date; action: string; type: string; id: string; title: string | null }>(
        `SELECT seq, at, action, type, record_id AS id, coalesce(record->'fields'->>'title', record->'fields'->>'term') AS title
           FROM record_event WHERE type <> 'health' ORDER BY seq DESC LIMIT $1`,
        [limit],
      );
      return rows.map(({ seq, at, ...rest }) => ({ seq: Number(seq), at: at.toISOString(), ...rest }));
    },

    async findByTitle(words, { history = false } = {}) {
      const { rows } = await pool.query<TitleRow>(
        `SELECT id, type, coalesce(fields->>'title', fields->>'term') AS title,
                CASE WHEN type = 'decision' AND jsonb_typeof(fields->'number') = 'number' THEN (fields->>'number')::int END AS number,
                updated_at AS changed
           FROM record WHERE type <> 'health'`,
      );
      const { rows: accepted } = await pool.query<{ supersedes: unknown; clauses: unknown; narrows: unknown }>(
        `SELECT fields->'supersedes' AS supersedes, fields->'supersedesClauses' AS clauses, fields->'narrows' AS narrows
           FROM record WHERE type = 'decision' AND fields->>'status' = 'accepted'`,
      );
      const replaced = new Set(accepted.flatMap(({ supersedes }) => strings(supersedes)));
      const inPart = new Set(accepted.flatMap(({ clauses, narrows }) => [
        ...(Array.isArray(clauses) ? clauses.map((entry) => (entry as { decision?: unknown }).decision).filter((id): id is string => typeof id === "string") : []),
        ...strings(narrows),
      ]));
      const tierOf = ({ id, type }: TitleRow): number => (HISTORY_KINDS.includes(type) || replaced.has(id) ? 2 : inPart.has(id) ? 1 : 0);
      const holds = (row: TitleRow, word: string): boolean => (row.title !== null && holdsWord(row.title, word)) || (row.number !== null && row.number === decisionNumberOf(word));
      return rows
        .filter((row) => words.length > 0 && words.every((word) => holds(row, word)) && (history || tierOf(row) < 2))
        .sort((one, other) => tierOf(one) - tierOf(other) || other.changed.getTime() - one.changed.getTime() || (one.id < other.id ? -1 : 1))
        .slice(0, MOST_ROWS)
        .map(({ id, type, title }) => ({ id, type, title }));
    },

    async decisionNumbered(number) {
      const { rows } = await pool.query<TitleHit>(
        `SELECT id, type, fields->>'title' AS title FROM record WHERE type = 'decision' AND fields->'number' = to_jsonb($1::int)`,
        [number],
      );
      return rows[0] ?? null;
    },
  };
}

export async function writtenBy(records: Pick<SchemaRecords, "history" | "current">, of: string): Promise<WriterChange[]> {
  const own = (await records.history({ actor: of })).filter(({ type }) => type !== "health");
  const ids = [...new Set(own.map(({ recordId }) => recordId))].sort();
  const changes: WriterChange[] = [];
  for (const id of ids) {
    const entries = await records.history({ id });
    const mine = entries.filter(({ actor }) => actor === of);
    const first = mine[0]!;
    const last = mine.at(-1)!;
    const prior = entries.filter(({ seq }) => seq < first.seq).at(-1);
    const later = entries.find(({ seq, actor }) => seq > first.seq && actor !== of);
    changes.push({
      id,
      type: first.type,
      writes: mine.length,
      before: prior === undefined || prior.action === "retired" ? null : records.current(prior.record),
      after: last.action === "retired" ? null : records.current(last.record),
      ...(last.action === "retired" ? { retired: last.reason ?? "" } : {}),
      ...(later === undefined ? {} : { later: { seq: later.seq, ...(later.actor === undefined ? {} : { actor: later.actor }) } }),
    });
  }
  return changes;
}
