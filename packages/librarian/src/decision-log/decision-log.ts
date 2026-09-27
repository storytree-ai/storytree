/**
 * Capability 2 · Decision log (the librarian story): every accepted decision stays true in full.
 * The dividing question is the agent's: did the decision change? No, and it is corrected in place
 * (`correct`); yes, and a successor supersedes it (`supersede`); a decision that narrows another
 * leaves a note in it (`annotate`). Finished business nothing points at is retired (capability 3's
 * `retire`), and one something points at is consolidated: superseded by a successor restating what
 * is still true. The health report (the owner's G1) is what a write cannot refuse: an edge to a
 * record retired since.
 */
import type { Library, SchemaRecord, WriteOptions } from "@storytree/library";

import { allNotes, LibrarianRefusal, referencesOf, type Reference } from "../notes.js";

/** A successor's own words; it is recorded accepted, superseding the decisions it replaces. */
export interface Successor {
  readonly title: string;
  readonly text: string;
  /** The story or capability it is a front cover of. By default, the shelf the first one it replaces covered. */
  readonly frontCoverOf?: string;
}

/** What a correction in place may change. */
export interface Correction {
  readonly text?: string;
  readonly title?: string;
  readonly loadBearing?: boolean;
  readonly status?: "proposed" | "accepted";
}

/** A narrowing note: the decision that narrows the target, what it narrows, and the day (today by default). */
export interface Annotation {
  readonly by: string;
  readonly note: string;
  readonly date?: string;
}

/** An edge the health report found pointing at a record no longer live. */
export type BrokenEdge = Reference;

/**
 * Record `successor` as an accepted decision superseding `olds`. It takes the shelf the first of
 * them covered, unless it names its own, and the load-bearing mark if any of them carried it; the
 * old ones leave the reading list, and stay readable as superseded. The library refuses an old one
 * that is not a live decision, and a supersession loop.
 */
export async function supersede(library: Library, olds: readonly string[], successor: Successor, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const replaced = await Promise.all(olds.map(async (id) => (await library.decision(id))?.record));
  const frontCoverOf = successor.frontCoverOf ?? replaced[0]?.fields.frontCoverOf;
  const loadBearing = replaced.some((old) => old?.fields.loadBearing === true);
  const recorded = await library.recordDecision({
    title: successor.title,
    text: successor.text,
    status: "accepted",
    supersedes: [...olds],
    ...(frontCoverOf === undefined ? {} : { frontCoverOf }),
    ...(loadBearing ? { loadBearing } : {}),
  }, writer);
  for (const old of replaced) if (old?.fields.loadBearing === true) await library.editNote(old.id, { loadBearing: undefined }, writer);
  return recorded;
}

/**
 * Correct decision `id` in place, for a decision that did not change: its text, title or
 * load-bearing mark. The library's history keeps the old wording. Turning an accepted decision back
 * to proposed is refused: only the owner un-decides.
 */
export async function correct(library: Library, id: string, fields: Correction, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const decision = await liveDecision(library, id);
  if (fields.status === "proposed" && decision.fields.status === "accepted") {
    throw new LibrarianRefusal(`${label(decision)} is accepted, and only the owner turns an accepted decision back to proposed`);
  }
  return (await library.editNote(id, fields, writer)) as SchemaRecord<"decision">;
}

/**
 * Leave a dated note in decision `target`, naming the decision that narrows it: the in-place
 * annotation a narrowing owes its target in the same landing, and the only record of it.
 */
export async function annotate(library: Library, target: string, { by, note, date }: Annotation, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const decision = await liveDecision(library, target);
  const narrowing = await liveDecision(library, by);
  const day = date ?? new Date().toISOString().slice(0, 10);
  const text = `${decision.fields.text}\n\n*Annotated ${day} by ${label(narrowing)}:* ${note}`;
  return (await library.editNote(target, { text }, writer)) as SchemaRecord<"decision">;
}

/** The health report: each note's link, supersession or other reference naming a record no longer live, in creation order. */
export async function brokenEdges(library: Library): Promise<BrokenEdge[]> {
  const notes = await allNotes(library);
  const live = new Set(notes.map((note) => note.id));
  return notes.flatMap(referencesOf).filter((reference) => !live.has(reference.to));
}

async function liveDecision(library: Library, id: string): Promise<SchemaRecord<"decision">> {
  const decision = (await library.decision(id))?.record;
  if (decision === undefined) throw new LibrarianRefusal(`${id} is not a live decision`);
  return decision;
}

/** A decision as a note names it: its number and title, or its title alone. */
function label(decision: SchemaRecord<"decision">): string {
  const title = `"${decision.fields.title}"`;
  return decision.fields.number === undefined ? title : `ADR-${String(decision.fields.number).padStart(4, "0")} ${title}`;
}
