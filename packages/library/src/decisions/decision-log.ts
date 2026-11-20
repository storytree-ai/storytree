// Capability 13 · Decision log
import { createHash } from "node:crypto";

import { byCreation } from "../creation-order.js";
import { checkReference, checkReferences, liveRecord, type Expected } from "../references.js";
import type { FieldsOf, SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import { NumberTakenError, type HistoryEntry } from "../transactions/index.js";

const COVERABLE: Expected = { name: "story or capability", types: ["story", "capability"] };

export function checkFrontCover(records: SchemaRecords, frontCoverOf: unknown): Promise<void> {
  return checkReference(records, "frontCoverOf", frontCoverOf, COVERABLE);
}

export type NewDecision = Omit<FieldsOf<"decision">, "composed">;
export type DecisionStatus = FieldsOf<"decision">["status"] | "superseded";
export interface DecisionView {
  readonly record: SchemaRecord<"decision">;
  readonly status: DecisionStatus;
  readonly supersededBy: string[];
  readonly composed?: { readonly statement: string; readonly composedAt: string; readonly stale: boolean };
}

export type ClauseSupersession = NonNullable<FieldsOf<"decision">["supersedesClauses"]>[number];

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

const PAIRS_FROM = "2026-11-20";

export function partlySupersedes(fields: Pick<FieldsOf<"decision">, "supersedesClauses" | "narrows">): ClauseSupersession[] {
  const entries: ClauseSupersession[] = [...(fields.supersedesClauses ?? [])];
  for (const decision of fields.narrows ?? []) if (!entries.some((entry) => entry.decision === decision)) entries.push({ decision });
  return entries;
}

export async function checkClauseSupersession(records: SchemaRecords, edit: object): Promise<void> {
  const fields = edit as { readonly narrows?: unknown; readonly supersedesClauses?: unknown };
  if (Array.isArray(fields.narrows) && fields.narrows.length > 0) {
    throw new RangeError('a decision no longer writes "narrows": name the decision it supersedes in part, and its clauses, in "supersedesClauses" (ADR-1379 D1)');
  }
  if (Array.isArray(fields.supersedesClauses)) {
    await checkReferences(records, "supersedesClauses", fields.supersedesClauses.map((entry: unknown) => (entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>).decision : entry)), "decision");
  }
}

export type ArchivedLink = NonNullable<FieldsOf<"decision">["archivedLinks"]>[number];

export interface ArchivedDecisionLink extends ArchivedLink {
  readonly from: string;
}

export interface DecisionLinkBacklog {
  readonly links: number;
  readonly decisions: number;
}

const EDGE_FIELDS = ["links", "supersedes", "supersedesClauses", "narrows", "justifications"];

export function decisionEdgeTargets(fields: object): string[] {
  const at = fields as Record<string, unknown>;
  const clauses = listOf(at.supersedesClauses).map((entry) => (entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>).decision : entry));
  const ids = [...listOf(at.links), ...listOf(at.supersedes), ...clauses, ...listOf(at.narrows)];
  return [...new Set(ids.filter((id): id is string => typeof id === "string"))];
}

export async function justifiedEdit<T extends object>(records: SchemaRecords, from: string | undefined, before: object | undefined, edit: T): Promise<T> {
  if (before !== undefined && !EDGE_FIELDS.some((field) => field in edit)) return edit;
  const given = (edit as { readonly justifications?: unknown }).justifications;
  if (given !== undefined && (given === null || typeof given !== "object" || Array.isArray(given))) return edit;
  const stored = (before as { readonly justifications?: Readonly<Record<string, string>> } | undefined)?.justifications;
  const merged: Record<string, unknown> = { ...stored, ...(given as object | undefined) };
  const targets = decisionEdgeTargets({ ...before, ...edit });
  const held = new Set(before === undefined ? [] : decisionEdgeTargets(before));
  for (const target of targets) {
    if (held.has(target) || merged[target] !== undefined) continue;
    if ((await liveRecord(records, target, ["decision"])) === null) continue;
    throw new RangeError(
      `${from ?? "a new decision"} → ${target}: a link to a decision is written with its justification, at most two lines (why an agent would follow it, why it was linked): pass justifications ${JSON.stringify({ [target]: "…" })} (ADR-1379 D2)`,
    );
  }
  const kept = Object.fromEntries(Object.entries(merged).filter(([target]) => targets.includes(target)));
  const { justifications: _given, ...rest } = edit as Record<string, unknown>;
  if (Object.keys(kept).length > 0) return { ...rest, justifications: kept } as T;
  return (stored === undefined ? rest : { ...rest, justifications: undefined }) as T;
}

export function prunedEdit(record: SchemaRecord<"decision">, to: string, reason: string, by: string): Partial<FieldsOf<"decision">> {
  const fields = record.fields;
  const justification = fields.justifications?.[to];
  const at = new Date().toISOString();
  const archived = (field: ArchivedLink["field"], clauses?: readonly string[]): ArchivedLink => ({
    to, field, ...(clauses === undefined ? {} : { clauses: [...clauses] }), ...(justification === undefined ? {} : { justification }), reason, by, at,
  });
  const without = (ids: readonly string[]): string[] | undefined => (ids.length === 1 ? undefined : ids.filter((id) => id !== to));
  const edit: Partial<FieldsOf<"decision">> = {};
  const moved: ArchivedLink[] = [];
  if (fields.links?.includes(to) === true) {
    moved.push(archived("links"));
    edit.links = without(fields.links);
  }
  if (fields.supersedes?.includes(to) === true) {
    moved.push(archived("supersedes"));
    edit.supersedes = without(fields.supersedes);
  }
  const entry = fields.supersedesClauses?.find((one) => one.decision === to);
  if (entry !== undefined) {
    moved.push(archived("supersedesClauses", entry.clauses));
    const rest = fields.supersedesClauses!.filter((one) => one !== entry);
    edit.supersedesClauses = rest.length === 0 ? undefined : rest;
  }
  if (moved.length === 0) throw new RangeError(`${record.id} has no link to ${to} to prune`);
  return { ...edit, archivedLinks: [...(fields.archivedLinks ?? []), ...moved] };
}

export function restoredEdit(record: SchemaRecord<"decision">, to: string, justification?: string): Partial<FieldsOf<"decision">> {
  const fields = record.fields;
  const archived = fields.archivedLinks ?? [];
  const back = archived.filter((one) => one.to === to);
  if (back.length === 0) throw new RangeError(`${record.id} has no archived link to ${to} to restore`);
  const rest = archived.filter((one) => one.to !== to);
  const edit: Partial<FieldsOf<"decision">> = { archivedLinks: rest.length === 0 ? undefined : rest };
  for (const { field, clauses } of back) {
    if (field === "supersedesClauses") edit.supersedesClauses = withClauses(edit.supersedesClauses ?? fields.supersedesClauses ?? [], to, clauses ?? []);
    else edit[field] = [...new Set([...(edit[field] ?? fields[field] ?? []), to])];
  }
  const why = justification ?? back.find((one) => one.justification !== undefined)?.justification;
  return why === undefined ? edit : { ...edit, justifications: { [to]: why } };
}

export interface DecisionNumberPlan {
  readonly id: string;
  readonly oldNumber: number | undefined;
  readonly number: number | undefined;
  readonly refusal?: string;
}

const NUMBER_FLOOR_ID = "project-decision-number-floor";

type NumberingMove = "full-record" | "founding-books";

export class DecisionLog {
  readonly #records: SchemaRecords;
  readonly #project: string | undefined;
  readonly #links: Expected;

  constructor(records: SchemaRecords, project: string | undefined, links: Expected) {
    this.#records = records;
    this.#project = project;
    this.#links = links;
  }

  async recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    const own = this.#project === "storytree";
    const floor = own && decision.number === undefined ? this.#numberFloor(await this.#records.history({ id: NUMBER_FLOOR_ID })).floor : undefined;
    await this.#checkLinks(decision.links);
    await this.#checkFrontCover(decision.frontCoverOf);
    await checkReferences(this.#records, "supersedes", decision.supersedes, "decision");
    await checkClauseSupersession(this.#records, decision);
    const justified = await justifiedEdit(this.#records, undefined, undefined, decision);
    return this.#records.create("decision", justified, {
      ...options, sequence: "number",
      ...(floor === undefined ? {} : { sequenceFloor: floor }),
      ...(own ? { sequenceNeverHeld: true } : {}),
    });
  }

  async setDecisionNumberFloor(floor: number, options: WriteOptions & { readonly apply?: boolean } = {}): Promise<number> {
    this.#requireStorytree();
    if (!Number.isSafeInteger(floor) || floor < 1) throw new RangeError("decision number floor must be a positive safe integer");
    const history = (await this.#records.history({ id: NUMBER_FLOOR_ID })).filter((entry) => entry.type === "decisionNumbering");
    if (history.length > 0) throw new RangeError(`decision number floor is already set to ${this.#numberFloor(history).floor}; it cannot be lowered or set twice`);
    if (options.apply === true) {
      await this.#records.create("decisionNumbering", { floor }, { ...options, id: NUMBER_FLOOR_ID, onlyIfNew: true });
    }
    return floor;
  }

  #numberFloor(history: HistoryEntry[]): { floor: number; seq: number } {
    const entry = history.find((entry) => entry.recordId === NUMBER_FLOOR_ID && entry.type === "decisionNumbering");
    const floor = entry?.record.fields.floor;
    if (entry === undefined || typeof floor !== "number" || !Number.isSafeInteger(floor) || floor < 1) {
      throw new RangeError("decision number floor is unset; storytree requires its persisted numbering floor before automatic numbering");
    }
    return { floor, seq: entry.seq };
  }

  async numberDecision(id: string, number: number, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    return this.#numberDecision(id, number, "full-record", options);
  }

  async #numberDecision(id: string, number: number, move: NumberingMove, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    this.#requireStorytree();
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) throw new RangeError(`${id} is not a live decision`);
    this.#checkNumber(record, number, await this.#numberHistory(), move);
    const updated = await this.#records.edit(id, { number }, {
      ...options,
      sequence: "number",
      sequenceNeverHeld: true,
      checkCurrent: (current) => {
        if (current.type !== "decision" || current.fields.number !== record.fields.number || current.fields.text !== record.fields.text) {
          throw new RangeError(`${id} changed or was already numbered; read it again before numbering`);
        }
      },
    });
    if (updated === null) throw new RangeError(`${id} is not a live decision`);
    return updated as SchemaRecord<"decision">;
  }

  async decisionNumberPlan(): Promise<DecisionNumberPlan[]> {
    this.#requireStorytree();
    const records = await this.#records.list("decision");
    const history = await this.#numberHistory();
    const rows = records.filter((record) => {
      const target = fullRecordNumber(record.fields.text);
      return fullRecordLines(record.fields.text).length > 0 && (target === undefined || target !== record.fields.number);
    }).map((record) => {
      const number = fullRecordNumber(record.fields.text);
      try {
        this.#checkNumber(record, number, history);
        return { id: record.id, oldNumber: record.fields.number, number };
      } catch (error) {
        if (!(error instanceof RangeError || error instanceof NumberTakenError)) throw error;
        return { id: record.id, oldNumber: record.fields.number, number, refusal: error.message };
      }
    });
    return rows.map((row) => row.refusal === undefined && rows.some((other) => other.id !== row.id && other.number === row.number)
      ? { ...row, refusal: "another decision proposes the same Full record number" }
      : row);
  }

  async numberDecisionsFromFullRecord(options: WriteOptions & { readonly apply?: boolean } = {}): Promise<DecisionNumberPlan[]> {
    return this.#applyNumberPlan(await this.decisionNumberPlan(), "full-record", options);
  }

  async #applyNumberPlan(plan: DecisionNumberPlan[], move: NumberingMove, options: WriteOptions & { readonly apply?: boolean }): Promise<DecisionNumberPlan[]> {
    if (options.apply !== true) return plan;
    const result: DecisionNumberPlan[] = [];
    for (const row of plan) {
      if (row.refusal !== undefined || row.number === undefined) {
        result.push(row);
        continue;
      }
      try {
        await this.#numberDecision(row.id, row.number, move, options);
        result.push(row);
      } catch (error) {
        if (!(error instanceof RangeError || error instanceof NumberTakenError)) throw error;
        result.push({ ...row, refusal: error.message });
      }
    }
    return result;
  }

  async numberFoundingDecisions(options: WriteOptions & { readonly apply?: boolean } = {}): Promise<DecisionNumberPlan[]> {
    this.#requireStorytree();
    const records = await this.#records.list("decision");
    const history = await this.#numberHistory();
    const { floor, seq } = this.#numberFloor(history);
    const originals = new Map<string, HistoryEntry>();
    for (const entry of history) {
      if (entry.type === "decision" && entry.seq < seq && !originals.has(entry.recordId)) originals.set(entry.recordId, entry);
    }
    let highest = history.reduce((max, entry) => typeof entry.record.fields.number === "number" ? Math.max(max, entry.record.fields.number) : max, floor);
    const plan = records.filter((record) => originals.has(record.id) && fullRecordLines(record.fields.text).length === 0 && !this.#foundingMoved(record.id, history, seq))
      .sort((a, b) => originals.get(a.id)!.seq - originals.get(b.id)!.seq)
      .map((record): DecisionNumberPlan => {
        const number = ++highest;
        try {
          this.#checkNumber(record, number, history, "founding-books");
          return { id: record.id, oldNumber: record.fields.number, number };
        } catch (error) {
          if (!(error instanceof RangeError || error instanceof NumberTakenError)) throw error;
          return { id: record.id, oldNumber: record.fields.number, number, refusal: error.message };
        }
      });
    return this.#applyNumberPlan(plan, "founding-books", options);
  }

  async #numberHistory(): Promise<HistoryEntry[]> {
    return (await this.#records.history()).filter((entry) => entry.type !== "health");
  }

  #foundingMoved(id: string, history: HistoryEntry[], floorSeq: number): boolean {
    const entries = history.filter((entry) => entry.recordId === id);
    return entries.some((entry, index) => entry.seq > floorSeq && index > 0 && entry.record.fields.number !== entries[index - 1]!.record.fields.number);
  }

  #requireStorytree(): void {
    if (this.#project !== "storytree") throw new RangeError("decision numbering moves are only available in the storytree project");
  }

  #checkNumber(record: SchemaRecord<"decision">, number: number | undefined, history: HistoryEntry[], move: NumberingMove = "full-record"): void {
    if (move === "full-record") {
      if (number === undefined || !Number.isSafeInteger(number) || number < 1 || fullRecordNumber(record.fields.text) !== number) {
        throw new RangeError(`${record.id}: number must match its own single Full record: ADR-NNNN line`);
      }
      if (record.fields.number === number || history.some((entry) => entry.recordId === record.id && entry.record.fields.number !== record.fields.number)) {
        throw new RangeError(`${record.id} has already been numbered; the Full record repair is one-time`);
      }
    } else {
      const { floor, seq } = this.#numberFloor(history);
      if (fullRecordLines(record.fields.text).length > 0 || !history.some((entry) => entry.recordId === record.id && entry.seq < seq)) {
        throw new RangeError(`${record.id}: founding-books move requires a decision present at switch-on with no Full record line`);
      }
      if (this.#foundingMoved(record.id, history, seq)) throw new RangeError(`${record.id} has already been numbered; the founding-books move is one-time`);
      if (number === undefined || !Number.isSafeInteger(number) || number <= floor) {
        throw new RangeError(`${record.id}: founding-books number must be a safe integer above the floor ${floor}`);
      }
    }
    if (history.some((entry) => entry.record.fields.number === number)) {
      throw new NumberTakenError("decision", "number", number!);
    }
  }

  async decision(id: string): Promise<DecisionView | null> {
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) return null;
    return decisionView(record, await this.#records.list("decision"));
  }

  async decisions(): Promise<DecisionView[]> {
    const all = await this.#records.list("decision");
    return [...all].sort(byCreation).map((record) => decisionView(record, all));
  }

  async composeStatement(id: string, statement: string, options?: WriteOptions): Promise<SchemaRecord<"decision"> | null> {
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) return null;
    const composed = { statement, composedAt: new Date().toISOString(), fingerprint: fingerprintOf(record.fields.text) };
    return (await this.#records.edit(id, { composed }, options)) as SchemaRecord<"decision"> | null;
  }

  async moveNarrowsToClauses(options?: WriteOptions): Promise<NarrowsMove> {
    const all = [...(await this.#records.list("decision"))].sort(byCreation);
    const numbers = new Map(all.map((record) => [record.id, record.fields.number]));
    const decisions: string[] = [];
    let edges = 0;
    let partial = 0;
    for (const record of all) {
      const narrows = record.fields.narrows;
      if (narrows === undefined) continue;
      let entries: ClauseSupersession[] = [...(record.fields.supersedesClauses ?? [])];
      for (const target of narrows) {
        const clauses = clausesNamed(record.fields.text, numbers.get(target));
        edges += 1;
        if (clauses.length === 0) partial += 1;
        entries = withClauses(entries, target, clauses);
      }
      await this.#records.edit(record.id, { narrows: undefined, supersedesClauses: entries.length === 0 ? undefined : entries }, options);
      decisions.push(record.id);
    }
    return { decisions, edges, partial };
  }

  async supersessionPairs(): Promise<SupersessionPairs> {
    const all = await this.#records.list("decision");
    const byNumber = new Map(all.flatMap((record) => (record.fields.number === undefined ? [] : [[record.fields.number, record.id] as const])));
    const created = new Map(all.map((record) => [record.id, record.createdAt]));
    const pair = (from: string, to: string): string => `${from} ${to}`;
    const edges = new Set<string>();
    const clauseEdges: [string, string][] = [];
    for (const record of all.filter((one) => one.fields.status === "accepted")) {
      for (const to of record.fields.supersedes ?? []) edges.add(pair(record.id, to));
      for (const { decision } of partlySupersedes(record.fields)) {
        edges.add(pair(record.id, decision));
        clauseEdges.push([record.id, decision]);
      }
    }
    const notes = new Set<string>();
    const noted: [string, string][] = [];
    for (const record of all) {
      for (const from of notesIn(record.fields.text, byNumber)) {
        if (from === record.id || !created.has(from) || notes.has(pair(from, record.id))) continue;
        notes.add(pair(from, record.id));
        noted.push([from, record.id]);
      }
    }
    const unpaired: SupersessionPair[] = [
      ...clauseEdges.filter(([from, to]) => !notes.has(pair(from, to))).map(([from, to]) => ({ kind: "no-note" as const, from, to })),
      ...noted.filter(([from, to]) => !edges.has(pair(from, to))).map(([from, to]) => ({ kind: "no-edge" as const, from, to })),
    ];
    const backlog = unpaired.filter(({ from }) => (created.get(from) ?? "") < PAIRS_FROM);
    return { flagged: unpaired.filter((one) => !backlog.includes(one)), backlog: backlog.length };
  }

  async decisionLinkBacklog(): Promise<DecisionLinkBacklog> {
    const all = await this.#records.list("decision");
    const live = new Set(all.map((record) => record.id));
    let links = 0;
    let decisions = 0;
    for (const record of all) {
      const justified = record.fields.justifications ?? {};
      const old = decisionEdgeTargets(record.fields).filter((target) => live.has(target) && justified[target] === undefined).length;
      links += old;
      if (old > 0) decisions += 1;
    }
    return { links, decisions };
  }

  async archivedLinks(from?: string): Promise<ArchivedDecisionLink[]> {
    const all = [...(await this.#records.list("decision"))].sort(byCreation);
    return all.filter((record) => from === undefined || record.id === from).flatMap((record) => (record.fields.archivedLinks ?? []).map((archived) => ({ from: record.id, ...archived })));
  }

  #checkLinks(links: unknown): Promise<void> {
    return checkReferences(this.#records, "links", links, this.#links);
  }

  #checkFrontCover(frontCoverOf: unknown): Promise<void> {
    return checkFrontCover(this.#records, frontCoverOf);
  }
}

export function withClauses(entries: readonly ClauseSupersession[], decision: string, clauses: readonly string[]): ClauseSupersession[] {
  const entry = entries.find((one) => one.decision === decision);
  const merged = [...new Set([...(entry?.clauses ?? []), ...clauses])];
  const next = { decision, ...(merged.length === 0 ? {} : { clauses: merged }) };
  return entry === undefined ? [...entries, next] : entries.map((one) => (one === entry ? next : one));
}

function clausesNamed(text: string, number: number | undefined): string[] {
  if (number === undefined) return [];
  const named = new RegExp(`ADR-0*${number}(?!\\d)(?:['’]s)?((?:(?:\\s*,\\s*and\\s+|\\s*,\\s*|\\s+and\\s+|\\s*&\\s*|\\s+)D\\d+(?!\\d))+)`, "g");
  return [...new Set([...text.matchAll(named)].flatMap((match) => match[1]!.match(/D\d+/g) ?? []))];
}

const IN_PLACE_NOTE = /\b(?:narrowed|annotated|replaced|superseded|amended|overtaken|withdrawn)\b[^.\n]*?\bby\s+(ADR-\d+|decision_[0-9a-f]{12})(?![0-9a-f])/gi;

function notesIn(text: string, byNumber: ReadonlyMap<number, string>): string[] {
  return [...text.matchAll(IN_PLACE_NOTE)].flatMap((match) => {
    const named = match[1]!;
    if (!/^ADR-/i.test(named)) return [named];
    const id = byNumber.get(Number(named.slice(4)));
    return id === undefined ? [] : [id];
  });
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function fingerprintOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function fullRecordLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => /^[ \t]*Full record:/.test(line));
}

function fullRecordNumber(text: string): number | undefined {
  const lines = fullRecordLines(text);
  if (lines.length !== 1) return undefined;
  const digits = /^[ \t]*Full record:[ \t]+ADR-(\d{4,})(?=[ \t.,;]|$)/.exec(lines[0]!)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

function decisionView(record: SchemaRecord<"decision">, all: readonly SchemaRecord<"decision">[]): DecisionView {
  const supersededBy = all
    .filter((other) => other.fields.status === "accepted" && other.fields.supersedes?.includes(record.id) === true)
    .sort(byCreation)
    .map((other) => other.id);
  const composed = record.fields.composed;
  return {
    record,
    status: supersededBy.length > 0 ? "superseded" : record.fields.status,
    supersededBy,
    ...(composed === undefined
      ? {}
      : {
          composed: {
            statement: composed.statement,
            composedAt: composed.composedAt,
            stale: composed.fingerprint !== fingerprintOf(record.fields.text),
          },
        }),
  };
}
