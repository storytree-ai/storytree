/**
 * Capability 22 · Decision corrections (The library story, its librarian package): every accepted decision stays true
 * in full. The dividing question is the agent's: did the decision change? No, and it is corrected in place
 * (`correct`); yes, and a successor supersedes it (capability 13's `supersede`); a decision that narrows another
 * leaves a note in it (`annotate`). Finished business nothing points at is retired (capability 23's
 * `retire`), and one something points at is consolidated: superseded by a successor restating what
 * is still true.
 */
import type { Library, SchemaRecord, WriteOptions } from "../../index.js";

import { LibrarianRefusal } from "../notes.js";
import { label } from "./supersede.js";

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
 * annotation a narrowing owes its target in the same landing. The narrowing decision names the
 * target in its `narrows`, so a search shows the target with the decision that narrowed it.
 */
export async function annotate(library: Library, target: string, { by, note, date }: Annotation, writer?: WriteOptions): Promise<SchemaRecord<"decision">> {
  const decision = await liveDecision(library, target);
  const narrowing = await liveDecision(library, by);
  const day = date ?? new Date().toISOString().slice(0, 10);
  const text = `${decision.fields.text}\n\n*Annotated ${day} by ${label(narrowing)}:* ${note}`;
  const narrows = narrowing.fields.narrows ?? [];
  if (!narrows.includes(target)) await library.editNote(by, { narrows: [...narrows, target] }, writer);
  return (await library.editNote(target, { text }, writer)) as SchemaRecord<"decision">;
}

async function liveDecision(library: Library, id: string): Promise<SchemaRecord<"decision">> {
  const decision = (await library.decision(id))?.record;
  if (decision === undefined) throw new LibrarianRefusal(`${id} is not a live decision`);
  return decision;
}
