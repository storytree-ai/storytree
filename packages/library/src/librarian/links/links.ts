// Capability 21 · Links
import type { Library, Note, Related, SchemaRecord, WriteOptions } from "../../index.js";

import { allNotes, LibrarianRefusal, noteOf, referencesOf, typesOf, type Reference } from "../notes.js";

const UNLINKED = { friction: "friction", resteer: "a re-steer" } as const;

export async function link(library: Library, from: string, to: string, writer?: WriteOptions): Promise<Note | SchemaRecord<"question">> {
  const question = await library.get(from);
  if (question?.type === "question") {
    const links = (question as SchemaRecord<"question">).fields.links ?? [];
    if (links.includes(to)) return question as SchemaRecord<"question">;
    const linked = await library.editQuestion(from, { links: [...links, to] }, writer);
    if (linked === null) throw new LibrarianRefusal(`there is no live question ${from}`);
    return linked;
  }
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

export async function unrestedDecisions(library: Library, read: Promise<readonly Note[]> | readonly Note[] = allNotes(library)): Promise<SchemaRecord<"decision">[]> {
  const notes = await read;
  const restedOn = new Set(notes.flatMap((note) => note.fields.links ?? []));
  const accepted = new Set((await library.decisions()).filter(({ status }) => status === "accepted").map(({ record }) => record.id));
  return notes.filter((note): note is SchemaRecord<"decision"> =>
    note.type === "decision" && note.fields.frontCoverOf === undefined && !restedOn.has(note.id) && accepted.has(note.id));
}

export async function relatedUnlinked(library: Library, cursor: number, read: Promise<readonly Note[]> | readonly Note[] = allNotes(library)): Promise<Related[]> {
  const notes = await read;
  const written = new Set((await library.history({ since: cursor, types: typesOf(notes) })).map((change) => change.recordId));
  return library.relatedEach(notes.filter((note) => written.has(note.id)).map((note) => note.id), { unlinked: true });
}

export type BrokenEdge = Reference;

export async function brokenEdges(library: Library, read: Promise<readonly Note[]> | readonly Note[] = allNotes(library)): Promise<BrokenEdge[]> {
  const notes = await read;
  const live = new Set(notes.map((note) => note.id));
  const covers = notes.flatMap(frontCoverOf);
  const shelves = covers.length === 0 ? [] : [...(await library.list("story")), ...(await library.list("capability"))];
  const plan = new Set(shelves.map((node) => node.id));
  return [
    ...notes.flatMap(referencesOf).filter((reference) => !live.has(reference.to)),
    ...covers.filter((cover) => !plan.has(cover.to)),
  ];
}

function frontCoverOf(note: Note): BrokenEdge[] {
  return note.type === "decision" && note.fields.frontCoverOf !== undefined ? [{ from: note.id, field: "frontCoverOf", to: note.fields.frontCoverOf }] : [];
}
