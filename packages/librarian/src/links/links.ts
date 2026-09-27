/**
 * Capability 1 · Links (the librarian story): a note links to another only where it rests on it.
 * A link means "rests on" and nothing weaker; a definition rests only on the decision that created
 * its term; friction and re-steers carry no links. Neighbours nobody linked are found with the
 * library's related-but-unlinked search (ADR-0654), alongside plain search when the agent needs it.
 */
import type { Library, Note, Related, SchemaRecord, WriteOptions } from "@storytree/library";

import { allNotes, LibrarianRefusal, noteOf } from "../notes.js";

/** The kinds that carry no links: signals to act on, not notes anyone reasons from. */
const UNLINKED = { friction: "friction", resteer: "a re-steer" } as const;

/**
 * Make note `from` rest on note `to`, keeping its other links. A link it already has writes nothing.
 * Refused, with nothing written, when either is not a live note or the link breaks a rule above.
 */
export async function link(library: Library, from: string, to: string, writer?: WriteOptions): Promise<Note> {
  const note = await noteOf(library, from);
  const target = await noteOf(library, to);
  if (note.type === "friction" || note.type === "resteer") {
    throw new LibrarianRefusal(`${UNLINKED[note.type]} rests on nothing: friction and re-steers carry no links`);
  }
  if (note.type === "definition" && target.type !== "decision") {
    throw new LibrarianRefusal(`a definition rests only on a decision, the one that created its term; ${to} is a ${target.type}`);
  }
  const links = note.fields.links ?? [];
  if (links.includes(to)) return note;
  const linked = await library.editNote(from, { links: [...links, to] }, writer);
  if (linked === null) throw new LibrarianRefusal(`there is no live note ${from}`);
  return linked;
}

/**
 * The worklist's links: each accepted decision on no shelf that no note rests on, in creation
 * order. These are the decisions about the whole project that are found only by search until the
 * covers that rest on them link to them (ADR-0631 D2).
 */
export async function unrestedDecisions(library: Library): Promise<SchemaRecord<"decision">[]> {
  const notes = await allNotes(library);
  const restedOn = new Set(notes.flatMap((note) => note.fields.links ?? []));
  const unrested: SchemaRecord<"decision">[] = [];
  for (const note of notes) {
    if (note.type !== "decision" || note.fields.frontCoverOf !== undefined || restedOn.has(note.id)) continue;
    if ((await library.decision(note.id))?.status === "accepted") unrested.push(note);
  }
  return unrested;
}

/** Related but unlinked neighbours for each live note written since `cursor`, including edits. */
export async function relatedUnlinked(library: Library, cursor: number): Promise<Related[]> {
  const written = new Set((await library.changesSince(cursor)).changes.map((change) => change.recordId));
  const related: Related[] = [];
  for (const note of await allNotes(library)) {
    if (!written.has(note.id)) continue;
    const result = await library.related(note.id, { unlinked: true });
    if (result !== null) related.push(result);
  }
  return related;
}
