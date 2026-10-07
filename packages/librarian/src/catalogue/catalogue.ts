/**
 * Capability 3 · Catalogue (the librarian story): each note that lands is new, or an edit to the
 * note that covers it. Whether one covers it, whether a piece is shared by two current notes, and
 * whether a note fails the blind test are the agent's judgements; what is code is the worklist that
 * puts each new note beside what might already cover it, and the one rule a write can keep: a note
 * is retired only if nothing points at it.
 */
import type { Library, Note, WriteOptions } from "@storytree/library";

import { allNotes, LibrarianRefusal, noteOf, referencesOf, typesOf, type Reference } from "../notes.js";

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
export async function newNotes(library: Library, cursor: number, read: Promise<readonly Note[]> | readonly Note[] = allNotes(library)): Promise<NewNote[]> {
  const notes = await read;
  const created = new Set((await library.history({ since: cursor, types: typesOf(notes) })).filter((change) => change.action === "created").map((change) => change.recordId));
  const written = notes.filter((candidate) => created.has(candidate.id));
  // Every title word of every new note searched from one reading of the notes, never one each (6.7).
  const words = [...new Set(written.flatMap(titleWords))];
  const searched = await library.searchEach(words);
  const hits = new Map(words.map((word, at) => [word, searched[at]!]));
  return written.map((note) => {
    const found = new Set(titleWords(note).flatMap((word) => hits.get(word)!.map((hit) => hit.id)));
    found.delete(note.id);
    return { note, lookalikes: notes.filter((other) => found.has(other.id)) };
  });
}

/** Every reference a live record makes to a note: the notes' own, increments' remedies, and questions' settling decisions. */
async function pointersTo(library: Library): Promise<Reference[]> {
  const [notes, views] = await Promise.all([allNotes(library), library.arcViews()]);
  const references = notes.flatMap(referencesOf);
  for (const view of views) {
    for (const increment of view.increments) {
      for (const to of increment.fields.remedies ?? []) references.push({ from: increment.id, field: "remedies", to });
    }
    for (const question of view.questions) {
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
