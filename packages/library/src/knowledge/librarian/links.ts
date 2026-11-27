// Capability 21 · Links
import type { Library, SchemaRecord, WriteOptions } from "../../index.js";
import { byCreation } from "../decisions/index.js";
import { NOTE_TYPES, relatedOf, type Note, type Related } from "../notes/index.js";

export class LibrarianRefusal extends Error {
  override name = "LibrarianRefusal";

  constructor(message: string) {
    super(message);
  }
}

export interface Reference {
  readonly from: string;
  readonly field: string;
  readonly to: string;
}

export type BrokenEdge = Reference;

export type NotesRead = Promise<readonly Note[]> | readonly Note[];

const ID = /^[a-z][A-Za-z]*_[0-9a-f]{12}$/;
const LISTS = ["links", "context", "rules", "antiPatterns", "supersedes", "enforces"];

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function entries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
}

export function edgesOf(fields: object): { field: string; to: string }[] {
  const shaped = fields as Record<string, unknown>;
  const edges = LISTS.flatMap((field) => strings(shaped[field]).map((to) => ({ field, to })));
  edges.push(...entries(shaped["stepRefs"]).flatMap((step) => strings(step["refs"]).map((to) => ({ field: "stepRefs", to }))));
  edges.push(...entries(shaped["branchEdges"]).flatMap((edge) => strings([edge["to"]]).map((to) => ({ field: "branchEdges", to }))));
  edges.push(...entries(shaped["supersedesClauses"]).flatMap((entry) => strings([entry["decision"]]).map((to) => ({ field: "supersedesClauses", to }))));
  edges.push(...strings([shaped["frontCoverOf"]]).map((to) => ({ field: "frontCoverOf", to })));
  return edges.filter(({ to }) => ID.test(to));
}

export function isNote(record: { readonly type: string }): boolean {
  return NOTE_TYPES.includes(record.type);
}

export async function notesOf(library: Library, read?: NotesRead): Promise<readonly Note[]> {
  return await (read ?? library.search(""));
}

export async function link(library: Library, from: string, to: string, writer?: WriteOptions, why?: string): Promise<Note | SchemaRecord<"question">> {
  const source = await library.get(from);
  if (source === null || !(isNote(source) || source.type === "question")) {
    throw new LibrarianRefusal(`${from} is not a live note or question: only a live note or question rests on a note, so nothing was written`);
  }
  const target = await library.get(to);
  if (target === null || !isNote(target)) {
    throw new LibrarianRefusal(`${to} is not a live note${target === null ? "" : ` but a ${target.type}`}: a link rests only on a live note, so nothing was written`);
  }
  if (source.type === "definition" && target.type !== "decision") {
    throw new LibrarianRefusal(`a definition rests only on a decision: ${to} is a ${target.type}, so nothing was written`);
  }
  if (source.type === "friction" || source.type === "resteer") {
    throw new LibrarianRefusal(`a ${source.type} rests on nothing: ${from} cannot link ${to}, so nothing was written`);
  }
  const had = strings((source.fields as Record<string, unknown>)["links"]);
  if (had.includes(to)) return source as Note | SchemaRecord<"question">;
  const links = [...had, to];
  if (source.type === "question") return (await library.editQuestion(from, { links }, writer)) as SchemaRecord<"question">;
  const justified = why !== undefined && source.type === "decision" ? { justifications: { [to]: why } } : {};
  return (await library.editNote(from, { links, ...justified }, writer)) as Note;
}

export async function unrestedDecisions(library: Library, read?: NotesRead): Promise<SchemaRecord<"decision">[]> {
  const notes = await notesOf(library, read);
  const restedOn = new Set(notes.flatMap((note) => edgesOf(note.fields).map(({ to }) => to)));
  return notes
    .filter((note): note is SchemaRecord<"decision"> => note.type === "decision")
    .filter(({ id, fields }) => fields.status === "accepted" && fields.frontCoverOf === undefined && !restedOn.has(id))
    .sort(byCreation);
}

export async function relatedUnlinked(library: Library, cursor: number, read?: NotesRead): Promise<Related[]> {
  const notes = await notesOf(library, read);
  const live = new Map(notes.map((note) => [note.id, note]));
  const written = await library.history({ since: cursor, types: NOTE_TYPES });
  const sources = [...new Set(written.map(({ recordId }) => recordId))].flatMap((id) => live.get(id) ?? []);
  return sources.map((source) => relatedOf(source, notes, { unlinked: true }));
}

export async function brokenEdges(library: Library, read?: NotesRead): Promise<BrokenEdge[]> {
  const notes = await notesOf(library, read);
  const live = new Set(notes.map(({ id }) => id));
  for (const kind of ["story", "capability"] as const) for (const { id } of await library.list(kind)) live.add(id);
  return notes.flatMap((note) => edgesOf(note.fields).filter(({ to }) => !live.has(to)).map(({ field, to }) => ({ from: note.id, field, to })));
}
