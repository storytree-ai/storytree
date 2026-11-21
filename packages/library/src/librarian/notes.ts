// Capability 35 · The librarian
import { referenceEdgesOf, type Library, type Note } from "../index.js";

export class LibrarianRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibrarianRefusal";
  }
}

export function allNotes(library: Library): Promise<Note[]> {
  return library.search("");
}

export function typesOf(notes: readonly Note[]): string[] {
  return [...new Set(notes.map((note) => note.type))];
}

export async function noteOf(library: Library, id: string): Promise<Note> {
  const note = (await allNotes(library)).find((candidate) => candidate.id === id);
  if (note === undefined) throw new LibrarianRefusal(`there is no live note ${id}`);
  return note;
}

export interface Reference {
  readonly from: string;
  readonly field: string;
  readonly to: string;
}

export function referencesOf(note: Note): Reference[] {
  return referenceEdgesOf(note.fields).map(({ field, to }) => ({ from: note.id, field, to }));
}
