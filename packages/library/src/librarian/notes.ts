/**
 * Capability 21 · Links. What every capability of the librarian reads the library with: its notes, found through the
 * library's public API alone (a plain search for nothing returns every live note), and the refusal
 * the librarian's own rules end in.
 */
import { referenceEdgesOf, type Library, type Note } from "../index.js";

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

/**
 * The types `notes` are of: what a read of the history since a cursor narrows to when it is after
 * notes written. A type no live note has can name no note written either.
 */
export function typesOf(notes: readonly Note[]): string[] {
  return [...new Set(notes.map((note) => note.type))];
}

/** The live note `id`, or a refusal saying there is none. */
export async function noteOf(library: Library, id: string): Promise<Note> {
  const note = (await allNotes(library)).find((candidate) => candidate.id === id);
  if (note === undefined) throw new LibrarianRefusal(`there is no live note ${id}`);
  return note;
}

/** One note's reference to another: which note, in which field, names which record. */
export interface Reference {
  readonly from: string;
  readonly field: string;
  readonly to: string;
}

/** Every record `note` names, in each of the library's reference fields (its links, a check's enforces, a decision's supersessions, …). */
export function referencesOf(note: Note): Reference[] {
  return referenceEdgesOf(note.fields).map(({ field, to }) => ({ from: note.id, field, to }));
}
