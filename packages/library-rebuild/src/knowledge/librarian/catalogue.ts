// Capability 23 · Catalogue
import type { Library, WriteOptions } from "../../index.js";
import { ARTIFACT_KINDS, matches, type Note } from "../notes/index.js";
import { edgesOf, LibrarianRefusal, notesOf, type NotesRead } from "./links.js";

export interface NewNote {
  readonly note: Note;
  readonly lookalikes: Note[];
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

const MARKED_KINDS = ["agent", "principle"];

function titleWords(note: Note): string[] {
  const fields = note.fields as Record<string, unknown>;
  const title = String(fields["title"] ?? fields["term"] ?? "");
  return [...new Set((title.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 2))];
}

export async function retire(library: Library, id: string, reason: string, writer?: WriteOptions): Promise<void> {
  const notes = await library.search("");
  if (!notes.some((note) => note.id === id)) throw new LibrarianRefusal(`${id} is not a live note: only a live note is retired, so nothing was written`);
  const arcs = await library.arcViews();
  const pointing = [
    ...notes.flatMap((note) => edgesOf(note.fields).filter(({ to }) => to === id).map(({ field }) => `${note.id} (${field})`)),
    ...arcs.flatMap(({ increments }) => increments).filter(({ fields }) => (fields.remedies ?? []).includes(id)).map((increment) => `${increment.id} (remedies)`),
    ...arcs.flatMap(({ questions }) => questions).flatMap(({ id: question, fields }) => [
      ...(fields.settledBy === id ? [`${question} (settledBy)`] : []),
      ...((fields.links ?? []).includes(id) ? [`${question} (links)`] : []),
    ]),
  ];
  if (pointing.length > 0) throw new LibrarianRefusal(`${id} is pointed at by ${[...new Set(pointing)].join(", ")}: a note something live points at is not retired, so nothing was written`);
  await library.retire(id, reason, writer);
}

export async function newNotes(library: Library, cursor: number, read?: NotesRead): Promise<NewNote[]> {
  const notes = await notesOf(library, read);
  const live = new Map(notes.map((note) => [note.id, note]));
  const created = await library.history({ since: cursor, types: ARTIFACT_KINDS, actions: ["created"] });
  return [...new Set(created.map(({ recordId }) => recordId))].flatMap((id) => {
    const note = live.get(id);
    if (note === undefined) return [];
    const words = titleWords(note);
    return [{ note, lookalikes: notes.filter((other) => other.id !== id && words.some((word) => matches(other, word))) }];
  });
}

export async function markedWrites(library: Library, cursor: number): Promise<MarkedWrite[]> {
  const written = await library.history({ since: cursor, types: MARKED_KINDS });
  return written.flatMap(({ recordId, type, seq, action, at, actor, outsideRead, record }) =>
    outsideRead === undefined || outsideRead.length === 0 ? [] : [{ id: recordId, type, seq, action, at, ...(actor === undefined ? {} : { actor }), outsideRead, fields: record.fields }]);
}
