/**
 * What every capability of the librarian reads the library with: its notes, found through the
 * library's public API alone (a plain search for nothing returns every live note), and the refusal
 * the librarian's own rules end in.
 */
import type { Library, Note } from "@storytree/library";

/** A write the librarian refuses, because it breaks one of its rules; its message names the rule. */
export class LibrarianRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibrarianRefusal";
  }
}

/** Every live note, in creation order. */
export function allNotes(library: Library): Promise<Note[]> {
  return library.search("");
}

/** The live note `id`, or a refusal saying there is none. */
export async function noteOf(library: Library, id: string): Promise<Note> {
  const note = (await allNotes(library)).find((candidate) => candidate.id === id);
  if (note === undefined) throw new LibrarianRefusal(`there is no live note ${id}`);
  return note;
}
