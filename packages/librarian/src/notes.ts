/**
 * Capability 1 · Links. What every capability of the librarian reads the library with: its notes, found through the
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

/**
 * Every record `note` names: its links (what it rests on), a decision's supersessions, a process's
 * hand-ons, and an agent role's reading, rules, anti-patterns and step reading.
 */
export function referencesOf(note: Note): Reference[] {
  const fields = note.fields as Readonly<Record<string, unknown>>;
  const named: [string, unknown][] = [
    ["links", fields.links],
    ["supersedes", fields.supersedes],
    ["branchEdges", (fields.branchEdges as { to: string }[] | undefined)?.map((edge) => edge.to)],
    ["context", fields.context],
    ["rules", fields.rules],
    ["antiPatterns", fields.antiPatterns],
    ["stepRefs", (fields.stepRefs as { refs: string[] }[] | undefined)?.flatMap((step) => step.refs)],
  ];
  return named.flatMap(([field, ids]) => ((ids as string[] | undefined) ?? []).map((to) => ({ from: note.id, field, to })));
}
