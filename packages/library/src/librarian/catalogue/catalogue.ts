// Capability 23 · Catalogue
import type { Library, Note, WriteOptions } from "../../index.js";

import { allNotes, LibrarianRefusal, noteOf, referencesOf, typesOf, type Reference } from "../notes.js";

export interface NewNote {
  readonly note: Note;
  readonly lookalikes: Note[];
}

export async function retire(library: Library, id: string, reason: string, writer?: WriteOptions): Promise<void> {
  await noteOf(library, id);
  const pointers = (await pointersTo(library)).filter((reference) => reference.to === id);
  if (pointers.length > 0) {
    const named = pointers.map((pointer) => `${pointer.from} (${pointer.field})`).join(", ");
    throw new LibrarianRefusal(`${id} is not retired: live records point at it: ${named}. Retire only what nothing points at`);
  }
  await library.retire(id, reason, writer);
}

export async function newNotes(library: Library, cursor: number, read: Promise<readonly Note[]> | readonly Note[] = allNotes(library)): Promise<NewNote[]> {
  const notes = await read;
  const created = new Set((await library.history({ since: cursor, types: typesOf(notes) })).filter((change) => change.action === "created").map((change) => change.recordId));
  const written = notes.filter((candidate) => created.has(candidate.id));
  const words = [...new Set(written.flatMap(titleWords))];
  const searched = await library.searchEach(words);
  const hits = new Map(words.map((word, at) => [word, searched[at]!]));
  return written.map((note) => {
    const found = new Set(titleWords(note).flatMap((word) => hits.get(word)!.map((hit) => hit.id)));
    found.delete(note.id);
    return { note, lookalikes: notes.filter((other) => found.has(other.id)) };
  });
}

export interface MarkedWrite {
  readonly id: string;
  readonly type: string;
  readonly seq: number;
  readonly action: "created" | "updated" | "retired";
  readonly at: string;
  readonly actor?: string;
  readonly outsideRead: readonly string[];
  readonly fields: object;
}

const REVIEWED: readonly string[] = ["agent", "principle"];

export async function markedWrites(library: Library, cursor: number): Promise<MarkedWrite[]> {
  return (await library.history({ since: cursor, types: REVIEWED })).flatMap((entry) => entry.outsideRead === undefined ? [] : [{
    id: entry.recordId,
    type: entry.type,
    seq: entry.seq,
    action: entry.action,
    at: entry.at,
    ...(entry.actor === undefined ? {} : { actor: entry.actor }),
    outsideRead: entry.outsideRead,
    fields: entry.record.fields,
  }]);
}

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

function titleWords(note: Note): string[] {
  const fields = note.fields as Readonly<Record<string, unknown>>;
  const title = String(fields.title ?? fields.term ?? fields.text ?? "");
  return [...new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4))];
}
