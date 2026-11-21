// Capability 13 · Decision log
import type { Library, Note, NoteEdit, SchemaRecord, WriteOptions } from "../index.js";

import type { NewDecision } from "./decision-log.js";

export class DecisionRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionRefusal";
  }
}

export type Successor = Omit<NewDecision, "status" | "supersedes">;

export function supersede(library: Library, olds: readonly string[], successor: Successor | string, writer?: WriteOptions, justifications?: Readonly<Record<string, string>>): Promise<SchemaRecord<"decision">> {
  return library.inOneWrite(async () => {
    const existing = typeof successor === "string" ? await library.decision(successor) : undefined;
    if (existing === null) throw new DecisionRefusal(`${successor} is not a live decision`);
    if (existing !== undefined && existing.status !== "accepted") {
      throw new DecisionRefusal(`${label(existing.record)} must be accepted to supersede other decisions; it reads ${existing.status}`);
    }
    const replaced = await Promise.all([...new Set(olds)].map(async (id) => (await library.decision(id))?.record));
    const own = typeof successor === "string" ? existing?.record.fields : successor;
    const frontCoverOf = own?.frontCoverOf ?? replaced[0]?.fields.frontCoverOf;
    const loadBearing = own?.loadBearing === true || replaced.some((old) => old?.fields.loadBearing === true);
    const why = { ...(typeof successor === "string" ? {} : successor.justifications), ...justifications };
    const fields = {
      supersedes: [...new Set([...(existing?.record.fields.supersedes ?? []), ...olds])],
      ...(Object.keys(why).length === 0 ? {} : { justifications: why }),
      ...(frontCoverOf === undefined ? {} : { frontCoverOf }),
      ...(loadBearing ? { loadBearing } : {}),
    };
    const recorded = typeof successor === "string"
      ? await library.editNote(successor, fields, writer) as SchemaRecord<"decision"> | null
      : await library.recordDecision({ ...successor, status: "accepted", ...fields }, writer);
    if (recorded === null) throw new DecisionRefusal(`${successor} is not a live decision`);
    for (const old of replaced) if (old?.fields.loadBearing === true) await library.editNote(old.id, { loadBearing: undefined }, writer);
    return recorded;
  }, writer?.signal === undefined ? undefined : { signal: writer.signal });
}

export async function recordDecision(library: Library, fields: NewDecision, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const { status, supersedes, ...successor } = fields;
  if (status === "proposed") {
    throw new DecisionRefusal("A decision is no longer born proposed (ADR-1232 D1): record it accepted only when the owner directed it, and raise what needs his call as an open question on its arc (storytree question new, or the raise_question tool), with the drafted decision in its context");
  }
  return status === "accepted" && Array.isArray(supersedes) && supersedes.length > 0
    ? supersede(library, supersedes, successor, writer)
    : library.recordDecision(fields, writer);
}

export function editDecision(library: Library, id: string, changes: NoteEdit, writer?: WriteOptions): Promise<Note | null> {
  return library.inOneWrite(async () => {
    const edited = await library.editNote(id, changes, writer);
    if (edited?.type !== "decision" || !("supersedes" in changes || "status" in changes)) return edited;
    const supersedes = edited.fields.supersedes ?? [];
    return edited.fields.status === "accepted" && supersedes.length > 0 ? supersede(library, supersedes, id, writer) : edited;
  }, writer?.signal === undefined ? undefined : { signal: writer.signal });
}

export function label(decision: SchemaRecord<"decision">): string {
  const title = `"${decision.fields.title}"`;
  return decision.fields.number === undefined ? title : `ADR-${String(decision.fields.number).padStart(4, "0")} ${title}`;
}
