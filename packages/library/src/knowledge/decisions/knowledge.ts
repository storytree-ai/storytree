// Capability 13 · Decision log
import { createHash } from "node:crypto";

import { Knowledge as Notes, type Note, type NoteEdit, type NoteEditOptions } from "../notes/index.js";
import type { Ranking } from "../search/index.js";
import { checkReferences, findLoop, liveOf, SchemaError, type FieldsOf, type Reference, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../storage/rules/index.js";
import { NumberTakenError } from "../../storage/store/index.js";
import { archivedLinksOf, linkBacklog, linkChanges, pruneLink, restoreLink, type ArchivedDecisionLink, type DecisionLinkBacklog, type DecisionLinkChanges, type DecisionLinkSpan } from "./links.js";
import { adr, fullRecordNumber, heldNumbers, mentionsFullRecord, renumbered, STORYTREE, switchedOn, type DecisionNumberPlan } from "./numbering.js";
import { moveNarrows, supersessionPairs, type NarrowsMove, type SupersessionPairs } from "./pairs.js";

export type NewDecision = Omit<FieldsOf<"decision">, "composed">;
export type DecisionStatus = FieldsOf<"decision">["status"] | "superseded";
export type ClauseSupersession = NonNullable<FieldsOf<"decision">["supersedesClauses"]>[number];

export interface DecisionView {
  readonly record: SchemaRecord<"decision">;
  readonly status: DecisionStatus;
  readonly supersededBy: string[];
  readonly supersededInPart: ClauseSupersession[];
  readonly composed?: { readonly statement: string; readonly composedAt: string; readonly stale: boolean };
}

type Apply = WriteOptions & { readonly apply?: boolean };
type Fields = Record<string, unknown>;
type Decision = SchemaRecord<"decision">;

export class SupersessionLoopError extends Error {
  override name = "SupersessionLoopError";
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`a supersession loop is refused: ${path.join(" → ")}; nothing was written`);
    this.path = path;
  }
}

export function byCreation(a: { readonly id: string; readonly createdAt: string }, b: { readonly id: string; readonly createdAt: string }): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function clauseTargets(fields: Fields): string[] {
  const entries = Array.isArray(fields["supersedesClauses"]) ? (fields["supersedesClauses"] as { decision?: unknown }[]) : [];
  return entries.flatMap(({ decision }) => (typeof decision === "string" ? [decision] : []));
}

function present(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function writer(options: WriteOptions): WriteOptions {
  return {
    ...(options.actor === undefined ? {} : { actor: options.actor }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.outsideRead === undefined ? {} : { outsideRead: options.outsideRead }),
  };
}

function viewOf(record: Decision, all: readonly Decision[]): DecisionView {
  const accepted = all.filter(({ fields }) => fields.status === "accepted").sort(byCreation);
  const supersededBy = accepted.filter(({ fields }) => (fields.supersedes ?? []).includes(record.id)).map(({ id }) => id);
  const supersededInPart = accepted.flatMap(({ id, fields }) => [
    ...(fields.supersedesClauses ?? []).filter(({ decision }) => decision === record.id).map(({ clauses }) => ({ decision: id, ...(clauses === undefined ? {} : { clauses }) })),
    ...(fields.narrows ?? []).filter((narrowed) => narrowed === record.id).map(() => ({ decision: id })),
  ]);
  const composed = record.fields.composed;
  return {
    record,
    status: supersededBy.length > 0 ? "superseded" : record.fields.status,
    supersededBy,
    supersededInPart,
    ...(composed === undefined ? {} : { composed: { statement: composed.statement, composedAt: composed.composedAt, stale: composed.fingerprint !== fingerprint(record.fields.text) } }),
  };
}

function refuseNarrows(candidate: Fields, stored: Fields): void {
  const had = strings(stored["narrows"]);
  if (strings(candidate["narrows"]).every((id) => had.includes(id))) return;
  throw new SchemaError("decision", [{
    field: "narrows",
    problem: `"narrows" is no longer written: a narrowing is stored once, as a supersedesClauses entry { decision, clauses } naming the decision and the clauses D<n> it supersedes`,
  }]);
}

export class Knowledge extends Notes {
  readonly #records: SchemaRecords;
  readonly #project: string | undefined;

  constructor(records: SchemaRecords, project?: string, ranking: Partial<Ranking> = {}) {
    super(records, project, ranking);
    this.#records = records;
    this.#project = project;
  }

  override async recordDecision(decision: NewDecision, options: WriteOptions = {}): Promise<Decision> {
    const fields = decision as Fields;
    this.#records.check("decision", fields);
    refuseNarrows(fields, {});
    await this.#checkTargets(fields, {});
    return await this.#records.inOneWrite(async () => {
      const number = decision.number === undefined ? await this.#nextNumber() : await this.#free(decision.number);
      return await super.recordDecision({ ...decision, number }, options);
    }, options.signal);
  }

  override async editNote(id: string, fields: NoteEdit, options: NoteEditOptions = {}): Promise<Note | null> {
    const current = await liveOf(this.#records, "decision", id);
    if (current !== null) {
      if (Object.hasOwn(fields, "number")) {
        throw new RangeError(`editNote does not change a decision's number: ${id} keeps ${String(current.fields.number)}, and numberDecision repairs a number once from its Full record line`);
      }
      const stored = current.fields as Fields;
      const candidate = present({ ...stored, ...fields });
      this.#records.check("decision", candidate);
      refuseNarrows(candidate, stored);
      await this.#checkTargets(candidate, stored);
      await this.#checkLoop(id, candidate);
    }
    return await super.editNote(id, fields, options);
  }

  async decision(id: string): Promise<DecisionView | null> {
    const record = await liveOf(this.#records, "decision", id);
    return record === null ? null : viewOf(record, await this.#records.list("decision"));
  }

  async decisions(): Promise<DecisionView[]> {
    const all = await this.#records.list("decision");
    return [...all].sort(byCreation).map((record) => viewOf(record, all));
  }

  override async frontCovers(nodeId: string): Promise<Decision[]> {
    const all = await this.#records.list("decision");
    return all.filter((record) => record.fields.frontCoverOf === nodeId && viewOf(record, all).status !== "superseded").sort(byCreation);
  }

  async composeStatement(id: string, statement: string, options: WriteOptions = {}): Promise<Decision | null> {
    const record = await liveOf(this.#records, "decision", id);
    if (record === null) return null;
    const composed = { statement, composedAt: new Date().toISOString(), fingerprint: fingerprint(record.fields.text) };
    return (await this.#records.edit(id, { composed }, writer(options))) as Decision | null;
  }

  async moveNarrowsToClauses(options: WriteOptions = {}): Promise<NarrowsMove> {
    return await moveNarrows(this.#records, writer(options));
  }

  async supersessionPairs(): Promise<SupersessionPairs> {
    return supersessionPairs(await this.#records.list("decision"));
  }

  async decisionLinkBacklog(): Promise<DecisionLinkBacklog> {
    return linkBacklog(await this.#records.list("decision"));
  }

  async decisionLinkChanges(span: DecisionLinkSpan = {}): Promise<DecisionLinkChanges> {
    return linkChanges(await this.#records.history({ types: ["decision"] }), span);
  }

  async archivedLinks(from?: string): Promise<ArchivedDecisionLink[]> {
    return archivedLinksOf(await this.#records.list("decision"), from);
  }

  async pruneLink(from: string, to: string, reason: string, options: WriteOptions = {}): Promise<Decision> {
    return await pruneLink(this.#records, (id, fields, edit) => this.editNote(id, fields, edit), from, to, reason, options);
  }

  async restoreLink(from: string, to: string, justification?: string, options: WriteOptions = {}): Promise<Decision> {
    return await restoreLink(this.#records, (id, fields, edit) => this.editNote(id, fields, edit), from, to, justification, options);
  }

  async setDecisionNumberFloor(floor: number, options: Apply = {}): Promise<number> {
    this.#inStorytree("setDecisionNumberFloor");
    if (!Number.isSafeInteger(floor) || floor <= 0) throw new RangeError(`the decision number floor is a positive safe integer, not ${floor}`);
    const unset = async (): Promise<void> => {
      const set = await this.#floor();
      if (set !== undefined) throw new Error(`the decision number floor is already set to ${set}: it is set once`);
    };
    await unset();
    if (options.apply !== true) return floor;
    await this.#records.inOneWrite(async () => {
      await unset();
      await this.#records.create("decisionNumbering", { floor }, { ...writer(options), id: "decisionNumbering" });
    }, options.signal);
    return floor;
  }

  async numberDecision(id: string, number: number, options: WriteOptions = {}): Promise<Decision> {
    this.#inStorytree("numberDecision");
    await this.#repairable(id, number);
    return await this.#records.inOneWrite(async () => {
      await this.#repairable(id, number);
      return (await this.#records.edit(id, { number }, writer(options))) as Decision;
    }, options.signal);
  }

  async decisionNumberPlan(): Promise<DecisionNumberPlan[]> {
    this.#inStorytree("decisionNumberPlan");
    const entries = await this.#records.history();
    const rows: DecisionNumberPlan[] = [];
    for (const { id, fields } of await this.#records.list("decision")) {
      if (!mentionsFullRecord(fields.text)) continue;
      const named = fullRecordNumber(fields.text);
      if (named !== undefined && named === fields.number) continue;
      const row = { id, oldNumber: fields.number, number: named };
      if (named === undefined) rows.push({ ...row, refusal: `${id} has no single "Full record: ADR-NNNN" line` });
      else if (renumbered(entries, id)) rows.push({ ...row, refusal: `${id}'s number was already repaired once` });
      else rows.push(row);
    }
    const held = heldNumbers(entries);
    const targets = rows.flatMap(({ number, refusal }) => (refusal === undefined && number !== undefined ? [number] : []));
    return rows.map((row) => {
      if (row.refusal !== undefined || row.number === undefined) return row;
      if (targets.filter((number) => number === row.number).length > 1) return { ...row, refusal: `another decision names the same Full record number, ${adr(row.number)}` };
      if (held.has(row.number)) return { ...row, refusal: new NumberTakenError("decision", "number", row.number).message };
      return row;
    });
  }

  async numberDecisionsFromFullRecord(options: Apply = {}): Promise<DecisionNumberPlan[]> {
    this.#inStorytree("numberDecisionsFromFullRecord");
    const plan = await this.decisionNumberPlan();
    if (options.apply !== true) return plan;
    const done: DecisionNumberPlan[] = [];
    for (const row of plan) {
      if (row.refusal !== undefined || row.number === undefined) {
        done.push(row);
        continue;
      }
      try {
        await this.numberDecision(row.id, row.number, writer(options));
        done.push(row);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        done.push({ ...row, refusal: error.message });
      }
    }
    return done;
  }

  async numberFoundingDecisions(options: Apply = {}): Promise<DecisionNumberPlan[]> {
    this.#inStorytree("numberFoundingDecisions");
    const floor = await this.#floor();
    if (floor === undefined) throw new Error("the decision number floor is unset: set it with setDecisionNumberFloor before moving the founding decisions above it");
    if (options.apply !== true) return await this.#foundingPlan(floor);
    return await this.#records.inOneWrite(async () => {
      const plan = await this.#foundingPlan(floor);
      for (const { id, number } of plan) await this.#records.edit(id, { number }, writer(options));
      return plan;
    }, options.signal);
  }

  async #foundingPlan(floor: number): Promise<DecisionNumberPlan[]> {
    const entries = await this.#records.history();
    const switched = switchedOn(entries);
    const live = new Map((await this.#records.list("decision")).map((record) => [record.id, record]));
    const books = [...new Set(entries.filter((entry) => entry.type === "decision" && entry.action === "created" && entry.seq < switched).map(({ recordId }) => recordId))];
    let next = Math.max(floor, ...heldNumbers(entries));
    const rows: DecisionNumberPlan[] = [];
    for (const id of books) {
      const record = live.get(id);
      if (record === undefined || mentionsFullRecord(record.fields.text) || renumbered(entries, id)) continue;
      next += 1;
      rows.push({ id, oldNumber: record.fields.number, number: next });
    }
    return rows;
  }

  async #repairable(id: string, number: number): Promise<void> {
    const record = await liveOf(this.#records, "decision", id);
    if (record === null) throw new Error(`${JSON.stringify(id)} is not a live decision: only a live decision's number is repaired`);
    const entries = await this.#records.history();
    if (renumbered(entries, id)) throw new Error(`${id}'s number was already repaired once: a decision's number is repaired only once`);
    const named = fullRecordNumber(record.fields.text);
    if (named === undefined) throw new Error(`${id} has no single "Full record: ADR-NNNN" line to repair its number from`);
    if (named !== number) throw new Error(`${id}'s Full record line names ${adr(named)}, not ${number}`);
    if (heldNumbers(entries).has(number)) throw new NumberTakenError("decision", "number", number);
  }

  async #floor(): Promise<number | undefined> {
    const [setting] = await this.#records.list("decisionNumbering");
    return setting?.fields.floor;
  }

  async #nextNumber(): Promise<number> {
    const floor = await this.#floor();
    if (this.#project === STORYTREE && floor === undefined) {
      throw new Error("the decision number floor is unset: in the storytree project a decision is numbered for itself only once setDecisionNumberFloor has stored 0.2's final number");
    }
    return Math.max(floor ?? 0, ...heldNumbers(await this.#records.history())) + 1;
  }

  async #free(number: number): Promise<number> {
    if (heldNumbers(await this.#records.history()).has(number)) throw new NumberTakenError("decision", "number", number);
    return number;
  }

  async #checkTargets(candidate: Fields, stored: Fields): Promise<void> {
    const references: Reference[] = [];
    const cover = candidate["frontCoverOf"];
    if (typeof cover === "string" && cover !== stored["frontCoverOf"]) references.push({ field: "frontCoverOf", to: cover, expected: "story or capability", kinds: ["story", "capability"] });
    const had = strings(stored["supersedes"]);
    for (const to of strings(candidate["supersedes"])) if (!had.includes(to)) references.push({ field: "supersedes", to, expected: "decision", kinds: ["decision"] });
    const clauses = clauseTargets(stored);
    for (const to of clauseTargets(candidate)) if (!clauses.includes(to)) references.push({ field: "supersedesClauses", to, expected: "decision", kinds: ["decision"] });
    await checkReferences(this.#records, references);
  }

  async #checkLoop(id: string, candidate: Fields): Promise<void> {
    const supersedes = new Map((await this.#records.list("decision")).map((record) => [record.id, record.fields.supersedes ?? []]));
    const loop = findLoop(id, strings(candidate["supersedes"]), (step) => supersedes.get(step) ?? []);
    if (loop !== undefined) throw new SupersessionLoopError(loop);
  }

  #inStorytree(method: string): void {
    if (this.#project !== STORYTREE) throw new Error(`${method} runs only in the storytree project`);
  }
}
