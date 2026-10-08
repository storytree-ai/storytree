/**
 * Capability 13 · Decision log (the library story): decisions are numbered inside the write, one past
 * the highest number any decision has ever held, so a retired decision's number is never reused; a
 * decision is read whole, with its status worked out (superseded exactly when an accepted decision
 * names it) and its composed statement, marked stale once its text has changed since. Storytree's own
 * project numbers only after its one-time floor is set (ADR-0662), and its imported decisions are
 * renumbered once, from their own Full record line or, with none, in founding order.
 *
 * Knowledge (capability 6) is the one door to it: it hands each decision verb here.
 */
import { createHash } from "node:crypto";

import { byCreation } from "../creation-order.js";
import { checkReferences, liveRecord, type Expected } from "../references.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../schema/index.js";
import type { FieldsOf } from "../schema/types.js";
import { NumberTakenError, type HistoryEntry } from "../transactions/index.js";
import { checkFrontCover } from "./front-covers.js";

/**
 * A new decision's fields. Every link must name a live artifact, `frontCoverOf` a live story or
 * capability, and each decision it supersedes a live decision. Its number is handed out when it is
 * recorded, unless it is brought in under its own (N1); its composed statement is composeStatement's.
 */
export type NewDecision = Omit<FieldsOf<"decision">, "composed">;
/** A decision's status as a read works it out: its own, or superseded once an accepted decision names it. */
export type DecisionStatus = FieldsOf<"decision">["status"] | "superseded";
/** A decision as the decision log reads it (capability 13). */
export interface DecisionView {
  /** The decision, its full text included, whatever its status. */
  readonly record: SchemaRecord<"decision">;
  readonly status: DecisionStatus;
  /** The accepted decisions that name it in `supersedes`, oldest first. */
  readonly supersededBy: string[];
  /** Its composed statement, marked stale once its text has changed since; absent until one is composed. */
  readonly composed?: { readonly statement: string; readonly composedAt: string; readonly stale: boolean };
}

/** A read-only proposal from a decision's own Full record line; refusals are never hidden. */
export interface DecisionNumberPlan {
  readonly id: string;
  readonly oldNumber: number | undefined;
  readonly number: number | undefined;
  readonly refusal?: string;
}

const NUMBER_FLOOR_ID = "project-decision-number-floor";

type NumberingMove = "full-record" | "founding-books";

/** The decision log of one project's library, over capability 3's SchemaRecords. */
export class DecisionLog {
  readonly #records: SchemaRecords;
  readonly #project: string | undefined;
  /** What a decision's links may name: an artifact (capability 9). */
  readonly #links: Expected;

  constructor(records: SchemaRecords, project: string | undefined, links: Expected) {
    this.#records = records;
    this.#project = project;
    this.#links = links;
  }

  /**
   * Record a decision. Its links are checked against live artifacts, its `frontCoverOf`, if it
   * has one, must name a live story or capability, and each decision it supersedes must be live.
   * It is numbered inside the write: one past the highest number any decision has ever held, so
   * writers at the same time never share one and a retired decision's is never reused. A decision
   * brought in with its own number keeps it, unless another has held it (NumberTakenError).
   * Storytree auto-numbers only after its one-time floor is set (ADR-0662).
   */
  async recordDecision(decision: NewDecision, options?: WriteOptions): Promise<SchemaRecord<"decision">> {
    const own = this.#project === "storytree";
    const floor = own && decision.number === undefined ? this.#numberFloor(await this.#records.history({ id: NUMBER_FLOOR_ID })).floor : undefined;
    await this.#checkLinks(decision.links);
    await this.#checkFrontCover(decision.frontCoverOf);
    await checkReferences(this.#records, "supersedes", decision.supersedes, "decision");
    return this.#records.create("decision", decision, {
      ...options, sequence: "number",
      ...(floor === undefined ? {} : { sequenceFloor: floor }),
      ...(own ? { sequenceNeverHeld: true } : {}),
    });
  }

  /** Preview the explicit ADR-0662 switch; only apply stores it, once, under the project lock. */
  async setDecisionNumberFloor(floor: number, options: WriteOptions & { readonly apply?: boolean } = {}): Promise<number> {
    this.#requireStorytree();
    if (!Number.isSafeInteger(floor) || floor < 1) throw new RangeError("decision number floor must be a positive safe integer");
    const history = await this.#records.history({ id: NUMBER_FLOOR_ID });
    if (history.length > 0) throw new RangeError(`decision number floor is already set to ${this.#numberFloor(history).floor}; it cannot be lowered or set twice`);
    if (options.apply === true) {
      await this.#records.create("decisionNumbering", { floor }, { ...options, id: NUMBER_FLOOR_ID, onlyIfNew: true });
    }
    return floor;
  }

  #numberFloor(history: HistoryEntry[]): { floor: number; seq: number } {
    const entry = history.find((entry) => entry.recordId === NUMBER_FLOOR_ID);
    const floor = entry?.record.fields.floor;
    if (entry === undefined || typeof floor !== "number" || !Number.isSafeInteger(floor) || floor < 1) {
      throw new RangeError("decision number floor is unset; storytree requires its persisted numbering floor before automatic numbering");
    }
    return { floor, seq: entry.seq };
  }

  /**
   * Repair an imported storytree decision once. The record stays live and keeps its identity,
   * fields and old number in history. The sequence check runs under the same lock as new decisions.
   */
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

  /** Propose every Full record repair without writing. No Full record line means no proposal. */
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

  /**
   * The one-time N1 move, previewed unless apply is explicit. Every write rechecks the live
   * decision and history. Refused rows stay in the result; independent repairs can still succeed.
   * No Full record line, or a number already matching it, means no proposal and no write.
   */
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

  /**
   * ADR-0662's one-time move: live decisions present at switch-on, with no Full record line.
   * Creation history orders them even when timestamps tie. Decisions created after switch-on
   * already use the new sequence; completed moves are omitted so retries can finish a partial run.
   */
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

  /** Match the write-time allocator: retain legacy reservations, exclude health-only input. */
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

  /**
   * A decision as the decision log reads it: its record, full text included; its status, which is
   * superseded exactly when an accepted decision names it in `supersedes`; those decisions; and its
   * composed statement, stale once its text has changed since it was composed. Null if `id` is not
   * a live decision.
   */
  async decision(id: string): Promise<DecisionView | null> {
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) return null;
    return decisionView(record, await this.#records.list("decision"));
  }

  /**
   * Every live decision as decision() reads it, oldest first, from one reading of the decisions
   * (13.9): what the decision log's listing asks, in place of a decision() per id, each of which
   * reads every decision again.
   */
  async decisions(): Promise<DecisionView[]> {
    const all = await this.#records.list("decision");
    return [...all].sort(byCreation).map((record) => decisionView(record, all));
  }

  /**
   * Compose a decision's one statement (C2): a maintained paragraph beside its text, never in its
   * place, replacing any statement before it. It remembers the text it was composed against. Null,
   * with nothing written, if `id` is not a live decision.
   */
  async composeStatement(id: string, statement: string, options?: WriteOptions): Promise<SchemaRecord<"decision"> | null> {
    const record = await liveRecord(this.#records, id, ["decision"]);
    if (record === null) return null;
    const composed = { statement, composedAt: new Date().toISOString(), fingerprint: fingerprintOf(record.fields.text) };
    return (await this.#records.edit(id, { composed }, options)) as SchemaRecord<"decision"> | null;
  }

  /** A decision may link to a live artifact, and to nothing else. */
  #checkLinks(links: unknown): Promise<void> {
    return checkReferences(this.#records, "links", links, this.#links);
  }

  /** A decision may be the front cover of a live story or capability, and of nothing else. */
  #checkFrontCover(frontCoverOf: unknown): Promise<void> {
    return checkFrontCover(this.#records, frontCoverOf);
  }
}

/** A fingerprint of a decision's text: what a composed statement remembers, to tell when it changed. */
function fingerprintOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Only an explicit line in the decision itself authorizes the repair, never an incidental mention. */
function fullRecordLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => /^[ \t]*Full record:/.test(line));
}

function fullRecordNumber(text: string): number | undefined {
  const lines = fullRecordLines(text);
  if (lines.length !== 1) return undefined;
  const digits = /^[ \t]*Full record:[ \t]+ADR-(\d{4,})(?=[ \t.,;]|$)/.exec(lines[0]!)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/** `record` as the decision log reads it, superseded by the accepted decisions among `all` that name it. */
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
