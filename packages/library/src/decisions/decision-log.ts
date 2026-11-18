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
    await checkReferences(this.#records, "narrows", decision.narrows, "decision");
    return this.#records.create("decision", decision, {
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

  #checkLinks(links: unknown): Promise<void> {
    return checkReferences(this.#records, "links", links, this.#links);
  }

  #checkFrontCover(frontCoverOf: unknown): Promise<void> {
    return checkFrontCover(this.#records, frontCoverOf);
  }
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
