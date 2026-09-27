/**
 * Capability 3 · Catalogue (the librarian story): each note that lands is new, or an edit to the
 * note that covers it. Whether one covers it, whether a piece is shared by two current notes, and
 * whether a note fails the blind test are the agent's judgements; what is code is the worklist that
 * puts each new note beside what might already cover it, and the one rule a write can keep: a note
 * is retired only if nothing points at it.
 */
import type { Library, Note, WriteOptions } from "@storytree/library";

import { allNotes, LibrarianRefusal, noteOf, referencesOf, type Reference } from "../notes.js";

/** A note written new since the worklist's cursor, and the live notes that might already cover it. */
export interface NewNote {
  readonly note: Note;
  readonly lookalikes: Note[];
}

/**
 * Retire note `id` with `reason`, if nothing live points at it: no note's link, supersession or
 * other reference, no increment's remedies, and no question it settled. Otherwise refused, naming
 * each record that points at it, and nothing is written.
 */
export async function retire(library: Library, id: string, reason: string, writer?: WriteOptions): Promise<void> {
  await noteOf(library, id);
  const pointers = (await pointersTo(library)).filter((reference) => reference.to === id);
  if (pointers.length > 0) {
    const named = pointers.map((pointer) => `${pointer.from} (${pointer.field})`).join(", ");
    throw new LibrarianRefusal(`${id} is not retired: live records point at it: ${named}. Retire only what nothing points at`);
  }
  await library.retire(id, reason, writer);
}

/**
 * The worklist's catalogue: each note written new after `cursor` and still live, in the order
 * written, with the other live notes a plain search for any word of its title finds (words of four
 * letters or more; a memory's text stands for its title).
 */
export async function newNotes(library: Library, cursor: number): Promise<NewNote[]> {
  const created = new Set((await library.changesSince(cursor)).changes.filter((change) => change.action === "created").map((change) => change.recordId));
  const notes = await allNotes(library);
  const listed: NewNote[] = [];
  for (const note of notes.filter((candidate) => created.has(candidate.id))) {
    const found = new Set<string>();
    for (const word of titleWords(note)) for (const hit of await library.search(word)) found.add(hit.id);
    found.delete(note.id);
    listed.push({ note, lookalikes: notes.filter((other) => found.has(other.id)) });
  }
  return listed;
}

/** Every reference a live record makes to a note: the notes' own, increments' remedies, and questions' settling decisions. */
async function pointersTo(library: Library): Promise<Reference[]> {
  const references = (await allNotes(library)).flatMap(referencesOf);
  for (const arc of (await library.projectTree()).arcs) {
    for (const increment of (await library.arcView(arc.id))?.increments ?? []) {
      for (const to of increment.fields.remedies ?? []) references.push({ from: increment.id, field: "remedies", to });
    }
    for (const question of await library.questions(arc.id)) {
      if (question.fields.settledBy !== undefined) references.push({ from: question.id, field: "settledBy", to: question.fields.settledBy });
    }
  }
  return references;
}

/** The words of a note's title, term or (for a memory) text, of four letters or more, lower-cased, each once. */
function titleWords(note: Note): string[] {
  const fields = note.fields as Readonly<Record<string, unknown>>;
  const title = String(fields.title ?? fields.term ?? fields.text ?? "");
  return [...new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4))];
}
