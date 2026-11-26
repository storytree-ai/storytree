// Capability 35 · The librarian
import { referenceEdgesOf, type DecisionLibrary, type Knowledge, type Note } from "../knowledge/index.js";
import type { SchemaRecord, SchemaRecords, WriteOptions } from "../records/index.js";

export interface LibrarianLibrary
  extends Pick<Knowledge, "search" | "searchEach" | "editNote" | "defineTerm" | "writeKnowledge" | "relatedEach">,
    Pick<DecisionLibrary, "inOneWrite" | "decision" | "decisions" | "recordDecision" | "get" | "list">,
    Pick<SchemaRecords, "history"> {
  retire(id: string, reason: string, options?: WriteOptions): Promise<void>;
  editQuestion(id: string, fields: { readonly links?: readonly string[] }, options?: WriteOptions): Promise<SchemaRecord<"question"> | null>;
  lapsedQuestions(at?: Date): Promise<SchemaRecord<"question">[]>;
  arcViews(): Promise<readonly { readonly increments: readonly SchemaRecord<"increment">[]; readonly questions: readonly SchemaRecord<"question">[] }[]>;
}

export class LibrarianRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibrarianRefusal";
  }
}

export function allNotes(library: Pick<LibrarianLibrary, "search">): Promise<Note[]> {
  return library.search("");
}

export function typesOf(notes: readonly Note[]): string[] {
  return [...new Set(notes.map((note) => note.type))];
}

export async function noteOf(library: Pick<LibrarianLibrary, "search">, id: string): Promise<Note> {
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
