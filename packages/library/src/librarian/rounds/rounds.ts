/**
 * Capability 26 · Rounds (The library story, its curation tooling): when the librarian's pass runs, and what it looks
 * at. Graduation is due at every landing, because only this session knows what it learned; the friction drain is
 * Friction's own, which the landing's pass drains apart from this worklist (ADR-1077 D4); the
 * rest is due when the library's change feed since the session started shows a write to a curated
 * kind, and when there is no start to read from, since the trigger fires when unsure (0.2's
 * `pre-merge-librarian-pass`). The worklist gathers each capability's list into one report.
 */
import type { Library, Related, SchemaRecord } from "../../index.js";

import { newNotes, type NewNote } from "../catalogue/index.js";
import { brokenEdges, type BrokenEdge } from "../decision-log/index.js";
import { memoryWorklist, processGaps, type MemoryItem, type ProcessGaps } from "../graduation/index.js";
import { relatedUnlinked, unrestedDecisions } from "../links/index.js";
import { allNotes } from "../notes.js";
import { openQuestions } from "../lapsed-questions/index.js";

/** The curated kinds: a write to any of them since the session started makes the whole pass due. */
export const CURATED: readonly string[] = ["decision", "question", "principle", "guardrail", "pattern", "process", "definition", "agent"];

/** What the pass has to do: graduation always, the rest when the trigger fired. */
export interface RoundDue {
  readonly graduation: true;
  readonly rest: boolean;
}

/** What the worklist is gathered from. */
export interface WorklistOptions {
  /** The change feed's cursor when the session started. Without it the trigger fires. */
  readonly since?: number;
  /** The agent's memory folders. */
  readonly memoryFolders?: readonly string[];
  /** The tools served, to match against the processes; without them, processes are not matched. */
  readonly tools?: readonly string[];
  readonly now?: Date;
  /** Told each phase as it starts; a rejection stops the worklist before that phase reads anything. */
  readonly progress?: (phase: string) => Promise<void>;
}

/** The librarian's worklist: each capability's list. */
export interface Worklist {
  /** Graduation (4): memories new, changed or lapsed. Always there. */
  readonly graduation: MemoryItem[];
  /** The rest, when the trigger fired. */
  readonly rest?: {
    /** Links (1): accepted decisions on no shelf that nothing rests on. */
    readonly links: SchemaRecord<"decision">[];
    /** Links (1): related but unlinked neighbours for notes written since the session started; unread with no start. */
    readonly related?: Related[];
    /** Decision log (2), the health report: edges to records no longer live. */
    readonly health: BrokenEdge[];
    /** Catalogue (3): notes written new since the session started, with what might already cover them; unread with no start. */
    readonly catalogue?: NewNote[];
    /** Why a list was left unread: with no session start, which notes it wrote is unknown. */
    readonly unread?: string;
    /** Graduation (4): processes and tools that match nothing, when the tools served are known. */
    readonly processes?: ProcessGaps;
    /** Lapsed questions (5): open questions whose review lease has lapsed, longest lapsed first. */
    readonly questions: SchemaRecord<"question">[];
  };
}

/** Whether the pass is due: graduation always; the rest on a curated write since `since`, or with no `since`. */
export async function roundDue(library: Library, { since }: { since?: number }): Promise<RoundDue> {
  if (since === undefined) return { graduation: true, rest: true };
  // Whether one curated change came after `since`: one entry at most, never the changes themselves (6.6).
  const curated = await library.history({ since, types: CURATED, oldest: 1 });
  return { graduation: true, rest: curated.length > 0 };
}

/** Gather the worklist: graduation's list always, the rest when the trigger fired. */
export async function worklist(library: Library, options: WorklistOptions): Promise<Worklist> {
  const phase = async (name: string): Promise<void> => options.progress?.(name);
  await phase("graduation");
  const graduation = await memoryWorklist(options.memoryFolders ?? [], options.now === undefined ? {} : { now: options.now });
  await phase("trigger");
  if (!(await roundDue(library, options)).rest) return { graduation };
  const { since } = options;
  // The live notes, read once for every list that needs them (6.7).
  const notes = await allNotes(library);
  await phase("links");
  const links = await unrestedDecisions(library, notes);
  // With no start the notes this session wrote are unknown; every note's history is never read instead (6.7).
  if (since !== undefined) await phase("related");
  const related = since === undefined ? undefined : await relatedUnlinked(library, since, notes);
  await phase("health");
  const health = await brokenEdges(library, notes);
  if (since !== undefined) await phase("catalogue");
  const catalogue = since === undefined ? undefined : await newNotes(library, since, notes);
  if (options.tools !== undefined) await phase("processes");
  const processes = options.tools === undefined ? undefined : await processGaps(library, options.tools, notes);
  await phase("questions");
  const questions = await openQuestions(library, options.now);
  return {
    graduation,
    rest: {
      links,
      ...(related === undefined || catalogue === undefined
        ? { unread: "No session start is recorded, so the notes this session wrote are unknown: the catalogue and related lists were not gathered. Search for each note you wrote, and read its related notes, by hand." }
        : { related, catalogue }),
      health,
      ...(processes === undefined ? {} : { processes }),
      questions,
    },
  };
}

/** How many items of each rest list a session is shown; the counts say how many there are. */
export const SHOWN = 5;

/** A note named by what a session needs to pick it: its ID, kind and title. Read it whole with its ID. */
export interface NoteRef {
  readonly id: string;
  readonly type: string;
  readonly title: string;
}

/**
 * The worklist as a session reads it (6.9): graduation whole, and each rest list's first few items, named only, with how many each holds. The full
 * records once took fifteen million characters; any one is read whole by its ID.
 */
export interface WorklistView {
  readonly graduation: MemoryItem[];
  readonly rest?: {
    readonly links: NoteRef[];
    readonly related?: { source: string; hits: (NoteRef & { readonly linked: boolean })[] }[];
    readonly health: BrokenEdge[];
    readonly catalogue?: { note: NoteRef; lookalikes: NoteRef[] }[];
    readonly unread?: string;
    readonly processes?: { processes: NoteRef[]; tools: string[] };
    readonly questions: NoteRef[];
    /** How many each list holds, of which the first few are shown. */
    readonly counts: { links: number; related?: number; health: number; catalogue?: number; processes?: number; questions: number };
  };
}

/** Bound a worklist to what a session can read: SHOWN items a list, named only, with counts. */
export function worklistView(full: Worklist): WorklistView {
  const view: WorklistView = {
    graduation: full.graduation,
  };
  const { rest } = full;
  if (rest === undefined) return view;
  const shown = <T>(list: readonly T[]): T[] => list.slice(0, SHOWN);
  return {
    ...view,
    rest: {
      links: shown(rest.links).map(ref),
      ...(rest.related === undefined ? {} : { related: shown(rest.related).map(({ source, hits }) => ({ source, hits: shown(hits).map((hit) => ({ id: hit.id, type: hit.type, title: hit.title, linked: hit.linked })) })) }),
      health: shown(rest.health),
      ...(rest.catalogue === undefined ? {} : { catalogue: shown(rest.catalogue).map(({ note, lookalikes }) => ({ note: ref(note), lookalikes: shown(lookalikes).map(ref) })) }),
      ...(rest.unread === undefined ? {} : { unread: rest.unread }),
      ...(rest.processes === undefined ? {} : { processes: { processes: shown(rest.processes.processes).map(ref), tools: rest.processes.tools } }),
      questions: shown(rest.questions).map(ref),
      counts: {
        links: rest.links.length,
        ...(rest.related === undefined ? {} : { related: rest.related.length }),
        health: rest.health.length,
        ...(rest.catalogue === undefined ? {} : { catalogue: rest.catalogue.length }),
        ...(rest.processes === undefined ? {} : { processes: rest.processes.processes.length }),
        questions: rest.questions.length,
      },
    },
  };
}

function ref(note: { readonly id: string; readonly type: string; readonly fields: object }): NoteRef {
  const fields = note.fields as Readonly<Record<string, unknown>>;
  return { id: note.id, type: note.type, title: String(fields.title ?? fields.term ?? fields.name ?? note.id) };
}
