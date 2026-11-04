/**
 * Capability 13 · Decision log (The library story), its supersession: a decision is superseded one way, and every door
 * that records or edits a decision comes through it, so the load-bearing mark and the shelf move the same way whichever
 * door wrote it (ADR-1243 D1: the rule once split between 13 and 22 is 13's alone).
 */
import type { Library, NewDecision, Note, NoteEdit, SchemaRecord, WriteOptions } from "../../index.js";

import { LibrarianRefusal } from "../notes.js";

/**
 * A successor's own words, and any other field a new decision takes (its number, the day it was decided, who decided
 * it, its links); it is recorded accepted, superseding the decisions it replaces. `frontCoverOf` is the story or
 * capability it is a front cover of: by default, the shelf the first one it replaces covered.
 */
export type Successor = Omit<NewDecision, "status" | "supersedes">;

/**
 * Record `successor` as an accepted decision superseding `olds`, or use an existing accepted
 * decision's ID, preserving its fields and earlier supersession links. It takes the shelf the first of
 * them covered, unless it has its own, and the load-bearing mark if any of them carried it; the
 * old ones leave the reading list, and stay readable as superseded. The library refuses an old one
 * that is not a live decision, and a supersession loop. It is the one way a decision is superseded
 * (every door that records or edits one comes here, through `recordDecision` and `editDecision`),
 * and all of it is one write: one that fails part-way leaves every decision as it was.
 */
export function supersede(library: Library, olds: readonly string[], successor: Successor | string, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  return library.inOneWrite(async () => {
    const existing = typeof successor === "string" ? await library.decision(successor) : undefined;
    if (existing === null) throw new LibrarianRefusal(`${successor} is not a live decision`);
    if (existing !== undefined && existing.status !== "accepted") {
      throw new LibrarianRefusal(`${label(existing.record)} must be accepted to supersede other decisions; it reads ${existing.status}`);
    }
    const replaced = await Promise.all([...new Set(olds)].map(async (id) => (await library.decision(id))?.record));
    const own = typeof successor === "string" ? existing?.record.fields : successor;
    const frontCoverOf = own?.frontCoverOf ?? replaced[0]?.fields.frontCoverOf;
    const loadBearing = own?.loadBearing === true || replaced.some((old) => old?.fields.loadBearing === true);
    const fields = {
      supersedes: [...new Set([...(existing?.record.fields.supersedes ?? []), ...olds])],
      ...(frontCoverOf === undefined ? {} : { frontCoverOf }),
      ...(loadBearing ? { loadBearing } : {}),
    };
    const recorded = typeof successor === "string"
      ? await library.editNote(successor, fields, writer) as SchemaRecord<"decision"> | null
      : await library.recordDecision({ ...successor, status: "accepted", ...fields }, writer);
    if (recorded === null) throw new LibrarianRefusal(`${successor} is not a live decision`);
    for (const old of replaced) if (old?.fields.loadBearing === true) await library.editNote(old.id, { loadBearing: undefined }, writer);
    return recorded;
  }, writer?.signal === undefined ? undefined : { signal: writer.signal });
}

/**
 * Record a new decision; an accepted one that supersedes others is recorded by `supersede`. A `supersedes` that is not
 * a list goes to the library as given, which refuses it. A new one written proposed is refused before anything is
 * written (ADR-1232 D1): what needs the owner's call is an open question.
 */
export async function recordDecision(library: Library, fields: NewDecision, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const { status, supersedes, ...successor } = fields;
  if (status === "proposed") {
    throw new LibrarianRefusal("A decision is no longer born proposed (ADR-1232 D1): record it accepted only when the owner directed it, and raise what needs his call as an open question on its arc (storytree question new, or the raise_question tool), with the drafted decision in its context");
  }
  return status === "accepted" && Array.isArray(supersedes) && supersedes.length > 0
    ? supersede(library, supersedes, successor, writer)
    : library.recordDecision(fields, writer);
}

/**
 * Edit note `id`'s fields, or null when it is not live. An edit of what a decision supersedes or its status that leaves
 * it accepted and superseding others goes on to `supersede`, in the same write, so the ones it supersedes lose their
 * load-bearing mark and shelf as they do there.
 */
export function editDecision(library: Library, id: string, changes: NoteEdit, writer?: WriteOptions): Promise<Note | null> {
  return library.inOneWrite(async () => {
    const edited = await library.editNote(id, changes, writer);
    if (edited?.type !== "decision" || !("supersedes" in changes || "status" in changes)) return edited;
    const supersedes = edited.fields.supersedes ?? [];
    return edited.fields.status === "accepted" && supersedes.length > 0 ? supersede(library, supersedes, id, writer) : edited;
  }, writer?.signal === undefined ? undefined : { signal: writer.signal });
}

/** A decision as a note names it: its number and title, or its title alone. */
export function label(decision: SchemaRecord<"decision">): string {
  const title = `"${decision.fields.title}"`;
  return decision.fields.number === undefined ? title : `ADR-${String(decision.fields.number).padStart(4, "0")} ${title}`;
}
