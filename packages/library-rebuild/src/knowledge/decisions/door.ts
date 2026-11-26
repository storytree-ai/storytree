// Capability 31 · Decisions
import type { Library } from "../../index.js";
import { MissingReferenceError, type SchemaRecord, type WriteOptions } from "../../storage/rules/index.js";
import type { DecisionView, NewDecision } from "./knowledge.js";
import { adr } from "./numbering.js";

export type Successor = Omit<NewDecision, "status" | "supersedes">;

export interface Correction {
  readonly text?: string;
  readonly title?: string;
  readonly loadBearing?: boolean;
  readonly status?: "proposed" | "accepted";
}

export interface Annotation {
  readonly by: string;
  readonly note: string;
  readonly date?: string;
  readonly clauses?: readonly string[];
  readonly why?: string;
}

type Decision = SchemaRecord<"decision">;

async function live(library: Library, id: string, why: string): Promise<DecisionView> {
  const view = await library.decision(id);
  if (view === null) throw new Error(`${JSON.stringify(id)} is not a live decision: ${why}, so nothing was written`);
  return view;
}

export async function recordDecision(library: Library, decision: NewDecision, writer?: WriteOptions): Promise<Decision> {
  if (decision.status === "proposed") {
    throw new Error("a new decision is never written proposed (ADR-1232): what needs the owner's call is an open question, so raise it with question new; nothing was written");
  }
  return await library.recordDecision(decision, writer);
}

export async function correct(library: Library, id: string, fields: Correction, writer?: WriteOptions): Promise<Decision> {
  const view = await live(library, id, "only a decision is corrected");
  if (fields.status === "proposed" && view.record.fields.status === "accepted") {
    throw new Error(`${id} is accepted: only the owner turns an accepted decision back to proposed, so nothing was written`);
  }
  return (await library.editNote(id, fields, writer)) as Decision;
}

export async function annotate(library: Library, target: string, { by, note, date, clauses, why }: Annotation, writer?: WriteOptions): Promise<Decision> {
  const narrowing = await live(library, by, "only a live decision supersedes clauses of another");
  const annotated = await live(library, target, "only a decision is annotated");
  const entries = narrowing.record.fields.supersedesClauses ?? [];
  const entry = entries.find(({ decision }) => decision === target);
  const named = [...new Set([...(entry?.clauses ?? []), ...(clauses ?? [])])];
  const next = { decision: target, ...(named.length === 0 ? {} : { clauses: named }) };
  const supersedesClauses = entry === undefined ? [...entries, next] : entries.map((each) => (each === entry ? next : each));
  const { number, title } = narrowing.record.fields;
  const label = `${number === undefined ? "" : `${adr(number)} `}${JSON.stringify(title)}`;
  const text = `${annotated.record.fields.text}\n\nAnnotated ${date ?? new Date().toISOString().slice(0, 10)} by ${label}: ${note}`;
  return await library.inOneWrite(async () => {
    await library.editNote(by, { supersedesClauses, ...(why === undefined ? {} : { justifications: { [target]: why } }) }, writer);
    return (await library.editNote(target, { text }, writer)) as Decision;
  }, writer?.signal === undefined ? {} : { signal: writer.signal });
}

export async function supersede(
  library: Library,
  olds: readonly string[],
  successor: Successor | string,
  writer?: WriteOptions,
  justifications: Readonly<Record<string, string>> = {},
): Promise<Decision> {
  const old: DecisionView[] = [];
  for (const id of olds) {
    const view = await library.decision(id);
    if (view === null) throw new MissingReferenceError("supersedes", id, "decision", (await library.get(id))?.type);
    old.push(view);
  }
  const existing = typeof successor === "string" ? await library.decision(successor) : undefined;
  if (existing === null || (existing !== undefined && existing.status !== "accepted")) {
    throw new Error(`${JSON.stringify(successor)} cannot succeed: it is not a live, accepted decision that nothing supersedes, so nothing was written`);
  }
  const loadBearing = old.some(({ record }) => record.fields.loadBearing === true);
  const shelf = old.map(({ record }) => record.fields.frontCoverOf).find((cover) => cover !== undefined);
  return await library.inOneWrite(async () => {
    const written = existing === undefined
      ? await library.recordDecision(newSuccessor(successor as Successor, olds, justifications, loadBearing, shelf), writer)
      : ((await library.editNote(existing.record.id, joined(existing.record, olds, justifications, loadBearing, shelf), writer)) as Decision);
    for (const { record } of old) {
      if (record.fields.loadBearing === undefined && record.fields.frontCoverOf === undefined) continue;
      await library.editNote(record.id, { loadBearing: undefined, frontCoverOf: undefined }, writer);
    }
    return written;
  }, writer?.signal === undefined ? {} : { signal: writer.signal });
}

function newSuccessor(successor: Successor, olds: readonly string[], justifications: Readonly<Record<string, string>>, loadBearing: boolean, shelf: string | undefined): NewDecision {
  const given = { ...successor.justifications, ...justifications };
  return {
    ...successor,
    status: "accepted",
    supersedes: [...olds],
    ...(Object.keys(given).length === 0 ? {} : { justifications: given }),
    ...(loadBearing ? { loadBearing: true } : {}),
    ...(successor.frontCoverOf === undefined && shelf !== undefined ? { frontCoverOf: shelf } : {}),
  };
}

function joined(current: Decision, olds: readonly string[], justifications: Readonly<Record<string, string>>, loadBearing: boolean, shelf: string | undefined) {
  const { fields } = current;
  return {
    supersedes: [...new Set([...(fields.supersedes ?? []), ...olds])],
    ...(Object.keys(justifications).length === 0 ? {} : { justifications: { ...justifications } }),
    ...(loadBearing && fields.loadBearing !== true ? { loadBearing: true } : {}),
    ...(fields.frontCoverOf === undefined && shelf !== undefined ? { frontCoverOf: shelf } : {}),
  };
}
